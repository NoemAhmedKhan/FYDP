/* =============================================
   MediFinder — UserPharmacySearch.js  v5.0
   ─────────────────────────────────────────────
   CHANGES IN v5.0 (Prescription Scanner Integration):

   NEW — Prescription Scanner:
   A. uploadPrescriptionBtn now opens a hidden file
      input (image only, max 1 MB client-side guard).
   B. Tesseract.js (CDN) is used client-side — zero
      server cost, zero Supabase cost.
   C. After OCR, a "Prescription Queue" bar appears
      above the results section showing pill-shaped
      tabs for every detected medicine name.
   D. User clicks a tab → selectProduct() is called
      exactly as if they had clicked a suggestion.
      This means logSearch(), renderResults(), and
      history are all handled identically to a normal
      search. No separate code path needed.
   E. All medicines found via prescription are logged
      individually to user_search_history via the
      existing logSearch() function.
   F. The prescription image (≤1 MB) is uploaded to
      Supabase Storage bucket "prescriptions" and a
      row is inserted into user_prescriptions table
      (max 5 per user — oldest pruned by RPC).

   NEW — Prescription Vault save:
   G. savePrescriptionToVault(file, userId) uploads
      to storage and inserts metadata into DB.
   H. prune_prescriptions RPC keeps max 5 rows.

   Everything else is unchanged from v4.2.
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       1. COLUMN NAME CONSTANTS
       ─────────────────────────────────────────────
       Single source of truth for all "Pharmacy Data"
       column names. Change here only if DB renamed.
       ============================================= */
    const COL = {
        product_name:     'product_name',
        brand:            'brand',
        category:         'category',
        generic_name:     'generic_name',
        strength:         'strength',
        dosage_form:      'dosage_form',
        release_type:     'release_type',
        used_for:         'used_for',
        discounted_price: 'discounted_price',
        original_price:   'original_price',
        pack_size:        'pack_size',
        quantity:         'quantity',
        prescription:     'prescription_required',
    };

    /* =============================================
       2. TEST PHARMACY PROFILE
       ─────────────────────────────────────────────
       Single test pharmacy placeholder.
       FUTURE: Replace with row['pharmacy_name'] etc.
       when multi-pharmacy support is added.
       ============================================= */
    const TEST_PHARMACY = {
        name:  'MediFinder Test Pharmacy',
        phone: '+92 300 0000000',
        lat:   24.8607,
        lng:   67.0011,
    };

    /* =============================================
       3. PRESCRIPTION SCANNER CONSTANTS
       ============================================= */
    const PRESCRIPTION_MAX_BYTES = 1 * 1024 * 1024;  // 1 MB hard limit
    const PRESCRIPTION_MAX_SAVED = 5;                 // max stored per user in Supabase

    /* =============================================
       4. DOM REFERENCES + STATE VARIABLES
       ============================================= */
    const searchInput          = document.getElementById('searchInput');
    const pharmacyList         = document.getElementById('pharmacyList');
    const resultsCount         = document.getElementById('resultsCount');
    const sortBtns             = document.querySelectorAll('.sort-btn');
    const logoutBtn            = document.getElementById('logoutBtn');
    const uploadPrescriptionBtn= document.getElementById('uploadPrescriptionBtn');

    // Hidden file input for prescription images — created once, reused
    const fileInput            = createHiddenFileInput();

    // Suggestion dropdown container (created dynamically)
    let suggestionBox          = null;

    let currentSort            = 'nearest';
    let currentResults         = [];     // cached rows for sort re-use
    let debounceTimer          = null;
    let userLat                = null;
    let userLng                = null;

    /* =============================================
       5. AUTH GUARD + SIDEBAR PROFILE LOADER
       ─────────────────────────────────────────────
       • No session → redirect to Login.html
       • Session OK → load name/email/avatar into sidebar
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) { window.location.href = 'Login.html'; return; }

        try {
            const { data: profile } = await supabaseClient
                .from('users')
                .select('first_name, last_name, profile_img')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                document.getElementById('sidebarUserName').textContent  = fullName || 'User';
                document.getElementById('sidebarUserEmail').textContent = session.user.email || '';
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load failed:', err.message);
        }
    }

    /* ─────────────────────────────────────────────
       SIDEBAR AVATAR RENDERER
       Shows Supabase profile photo if available,
       else falls back to Images/ProfileAvatar.jpg.
       ───────────────────────────────────────────── */
    function renderSidebarAvatar(profileImgUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;
        const fallback = avatarEl.querySelector('.user-avatar__fallback');
        const existing = avatarEl.querySelector('img');
        if (existing) existing.remove();

        const img       = document.createElement('img');
        img.alt         = 'User Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';
        img.onerror     = () => { img.remove(); if (fallback) fallback.style.display = 'flex'; };
        img.onload      = () => { if (fallback) fallback.style.display = 'none'; };
        img.src         = profileImgUrl || 'Images/ProfileAvatar.jpg';
        avatarEl.insertBefore(img, avatarEl.firstChild);
    }

    /* =============================================
       6. GPS LOCATION — background, non-blocking
       ─────────────────────────────────────────────
       Used for "Nearest" sort. Failure is silent.
       ============================================= */
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
            err  => console.warn('Location denied:', err.message)
        );
    }

    /* =============================================
       7. PRICE PARSER
       ─────────────────────────────────────────────
       "Rs. 2,280.00" → 2280.00 | null/"" → 0
       ============================================= */
    function parsePrice(raw) {
        if (!raw) return 0;
        const cleaned = String(raw).replace(/Rs\.?\s*/gi, '').replace(/,/g, '').trim();
        const val     = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    /* =============================================
       8. GET EFFECTIVE PRICE
       ─────────────────────────────────────────────
       Returns discounted price if valid (>0),
       otherwise falls back to original price.
       ============================================= */
    function getEffectivePrice(row) {
        const disc = parsePrice(row[COL.discounted_price]);
        const orig = parsePrice(row[COL.original_price]);
        if (disc > 0) return disc;
        if (orig > 0) return orig;
        return 0;
    }

    /* =============================================
       9. SMART WORD-BOUNDARY DETECTION
       ─────────────────────────────────────────────
       Fires suggestion search only when last typed
       word is ≥ 3 characters (avoids "G", "Pa" etc.)
       ============================================= */
    function isCompleteWord(query) {
        const trimmed = query.trim();
        if (!trimmed) return false;
        const tokens = trimmed.split(/\s+/);
        return tokens[tokens.length - 1].length >= 3;
    }

    /* =============================================
       10. PHASE 1 — FETCH SUGGESTIONS
       ─────────────────────────────────────────────
       Fetches product names matching the query
       across all pharmacies. Returns deduplicated,
       sorted name list for the dropdown.
       Only fetches product_name (lean query).
       quantity > 0 ensures only in-stock items shown.
       ============================================= */
    async function fetchSuggestions(query) {
        try {
            const { data, error } = await supabaseClient
                .from('Pharmacy Data')
                .select(COL.product_name)
                .or([
                    `${COL.product_name}.ilike.%${query}%`,
                    `${COL.brand}.ilike.%${query}%`,
                    `${COL.generic_name}.ilike.%${query}%`,
                ].join(','))
                .gt(COL.quantity, 0)
                .limit(300);

            if (error) throw error;

            // Deduplicate — same product may appear in multiple pharmacies
            const seen  = new Set();
            const names = [];
            (data || []).forEach(row => {
                const name = row[COL.product_name];
                if (name && !seen.has(name.toLowerCase())) {
                    seen.add(name.toLowerCase());
                    names.push(name);
                }
            });
            return names.sort();
        } catch (err) {
            console.warn('Suggestion fetch error:', err.message);
            return [];
        }
    }

    /* =============================================
       11. SUGGESTION DROPDOWN — show
       ─────────────────────────────────────────────
       Renders a scrollable dropdown below the search
       bar. Clicking an item triggers selectProduct().
       ============================================= */
    function showSuggestions(names) {
        clearSuggestions();
        if (names.length === 0) return;

        suggestionBox = document.createElement('ul');
        suggestionBox.className = 'suggestion-dropdown';

        names.slice(0, 100).forEach(name => {
            const li = document.createElement('li');
            li.className   = 'suggestion-item';
            li.textContent = name;
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                selectProduct(name);
            });
            suggestionBox.appendChild(li);
        });

        if (names.length > 100) {
            const note       = document.createElement('li');
            note.className   = 'suggestion-more';
            note.textContent = `+${names.length - 100} more results — type more letters`;
            suggestionBox.appendChild(note);
        }

        const inputWrap = searchInput.closest('.search-bar__input-wrap') || searchInput.parentElement;
        inputWrap.style.position = 'relative';
        inputWrap.appendChild(suggestionBox);
    }

    /* =============================================
       12. SUGGESTION DROPDOWN — clear
       ============================================= */
    function clearSuggestions() {
        if (suggestionBox) { suggestionBox.remove(); suggestionBox = null; }
    }

    /* =============================================
       13. LOG SEARCH TO user_search_history
       ─────────────────────────────────────────────
       Fire-and-forget from selectProduct() and from
       prescription scanner (one call per medicine).
       Never awaited — never blocks the UI.

       FIX v5.1 — Race condition causing 21+ rows:
         OLD BUG: When prescription scanning logged
         multiple medicines simultaneously with
         `foundNames.forEach(name => logSearch(name))`,
         all logSearch calls ran concurrently. Each
         one did: INSERT → prune. But if 3 INSERTs
         fired before any prune ran, 3 rows were added
         before pruning could remove any, leaving 21+.

         FIX: Sequential logging for prescription
         batch via logSearchBatch() below. Individual
         logSearch() calls (manual search) are still
         fire-and-forget but include a defensive
         hard-limit COUNT check before INSERT.

       DB write flow:
         1. Hard-limit guard: if already ≥ 20 rows,
            DELETE the oldest row first (one row, not
            full prune — fast and race-safe).
         2. INSERT new row (searched_at = DB now()).
         3. RPC prune_search_history() as safety net
            (handles any edge case the guard missed).
       ============================================= */
    const SEARCH_HISTORY_MAX = 20;

    async function logSearch(productName) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) return;
            const userId = session.user.id;

            // Resolve category (non-critical — stays null on miss)
            let category = null;
            try {
                const { data: catRow } = await supabaseClient
                    .from('Pharmacy Data')
                    .select('category')
                    .ilike('product_name', productName)
                    .limit(1)
                    .maybeSingle();
                category = catRow?.category ?? null;
            } catch (_) { /* non-critical */ }

            // Hard-limit guard: count current rows for this user
            // If already at max, delete the single oldest row before inserting
            // This is faster + more race-safe than running prune every time
            const { count } = await supabaseClient
                .from('user_search_history')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            if ((count || 0) >= SEARCH_HISTORY_MAX) {
                // Delete the single oldest row to make room
                const { data: oldest } = await supabaseClient
                    .from('user_search_history')
                    .select('id')
                    .eq('user_id', userId)
                    .order('searched_at', { ascending: true })
                    .limit(1)
                    .maybeSingle();

                if (oldest?.id) {
                    await supabaseClient
                        .from('user_search_history')
                        .delete()
                        .eq('id', oldest.id);
                }
            }

            // INSERT new search row (searched_at set by DB default now())
            const { error: insertErr } = await supabaseClient
                .from('user_search_history')
                .insert({ user_id: userId, product_name: productName, category });

            if (insertErr) throw insertErr;

            // RPC prune as final safety net — catches any race that slipped through
            await supabaseClient.rpc('prune_search_history', { p_user_id: userId });

        } catch (err) {
            console.warn('Search log error:', err.message);
        }
    }

    /* =============================================
       13-B. LOG SEARCH BATCH (prescription scanner)
       ─────────────────────────────────────────────
       Called when prescription scan finds multiple
       medicines. Logs them SEQUENTIALLY (one await
       after another) so the prune always runs after
       each INSERT — no concurrent race condition.

       Replaces the old:
         foundNames.forEach(name => logSearch(name))
       which fired all logs simultaneously.
       ============================================= */
    async function logSearchBatch(names) {
        for (const name of names) {
            await logSearch(name);   // sequential — each INSERT+prune completes before next
        }
    }

    /* =============================================
       14. SELECT PRODUCT (Phase 1 → Phase 2)
       ─────────────────────────────────────────────
       Called by: suggestion click, Enter key,
       URL auto-search, and prescription queue tab.
       One unified path for ALL search triggers.
       ============================================= */
    function selectProduct(productName) {
        searchInput.value = productName;
        clearSuggestions();
        logSearch(productName);          // fire-and-forget
        searchByExactProduct(productName);
    }

    /* =============================================
       15. PHASE 2 — SEARCH BY EXACT PRODUCT NAME
       ─────────────────────────────────────────────
       Fetches ALL rows matching this exact product
       name across ALL pharmacies (quantity > 0).
       Results grouped into pharmacy cards.
       ============================================= */
    async function searchByExactProduct(productName) {
        showLoadingState();

        try {
            const { data, error } = await supabaseClient
                .from('Pharmacy Data')
                .select([
                    COL.product_name,
                    COL.brand,
                    COL.category,
                    COL.generic_name,
                    COL.strength,
                    COL.dosage_form,
                    COL.release_type,
                    COL.discounted_price,
                    COL.original_price,
                    COL.pack_size,
                    COL.quantity,
                    COL.prescription,
                ].join(', '))
                .ilike(COL.product_name, productName)
                .gt(COL.quantity, 0)
                .limit(200);

            if (error) throw error;

            currentResults = data || [];
            await renderResults(currentResults, currentSort);

        } catch (err) {
            console.error('Product search error:', err.message);
            showErrorState('Search failed. Check your connection and try again.');
        }
    }

    /* =============================================
       16-A. SMART FIELD TOKENISER
       ─────────────────────────────────────────────
       Splits multi-value field strings into a
       normalised Set of individual tokens.
       Used for therapeutic alternative matching.
       ============================================= */
    const NOISE_WORDS = /^(and|or|with)\s+|\s+(and|or|with)$/gi;

    function tokeniseField(raw, splitChar) {
        if (!raw) return new Set();
        return new Set(
            String(raw)
                .split(splitChar)
                .map(t => t.replace(NOISE_WORDS, '').trim().toLowerCase())
                .filter(Boolean)
        );
    }

    /* =============================================
       16-B. FIELD OVERLAP CHECKER
       ─────────────────────────────────────────────
       Returns true when sets A and B share ≥1 token.
       Core of the therapeutic alternative matching.
       ============================================= */
    function setsOverlap(setA, setB) {
        if (setA.size === 0 || setB.size === 0) return false;
        for (const token of setA) { if (setB.has(token)) return true; }
        return false;
    }

    /* =============================================
       16-C. CLIENT-SIDE ALTERNATIVE MATCHER
       ─────────────────────────────────────────────
       Match criteria (ALL must pass):
         • generic_name  : ≥1 token overlaps (split ',')
         • dosage_form   : exact normalised match
         • strength      : ≥1 token overlaps (split '/')
         • release_type  : exact normalised match
       ============================================= */
    function isTherapeuticAlternative(sourceRow, candidateRow) {
        const srcDF = (sourceRow[COL.dosage_form]  || '').trim().toLowerCase();
        const canDF = (candidateRow[COL.dosage_form] || '').trim().toLowerCase();
        if (!srcDF || !canDF || srcDF !== canDF) return false;

        const srcRT = (sourceRow[COL.release_type]  || '').trim().toLowerCase();
        const canRT = (candidateRow[COL.release_type] || '').trim().toLowerCase();
        if (!srcRT || !canRT || srcRT !== canRT) return false;

        const srcGN = tokeniseField(sourceRow[COL.generic_name],    ',');
        const canGN = tokeniseField(candidateRow[COL.generic_name], ',');
        if (!setsOverlap(srcGN, canGN)) return false;

        const srcST = tokeniseField(sourceRow[COL.strength],    '/');
        const canST = tokeniseField(candidateRow[COL.strength], '/');
        if (!setsOverlap(srcST, canST)) return false;

        return true;
    }

    /* =============================================
       17. FETCH ALTERNATIVES (per matched item)
       ─────────────────────────────────────────────
       Two-phase: broad DB fetch on single-value
       fields, then smart client-side token filter.
       ============================================= */
    async function fetchAlternatives(row, excludeNames) {
        const gn = row[COL.generic_name];
        const df = row[COL.dosage_form];
        const st = row[COL.strength];
        const rt = row[COL.release_type];
        if (!gn || !df || !st || !rt) return [];

        try {
            const { data, error } = await supabaseClient
                .from('Pharmacy Data')
                .select([
                    COL.product_name, COL.brand, COL.category, COL.generic_name,
                    COL.strength, COL.dosage_form, COL.release_type,
                    COL.discounted_price, COL.original_price, COL.quantity, COL.prescription,
                ].join(', '))
                .eq(COL.dosage_form,  df)
                .eq(COL.release_type, rt)
                .gt(COL.quantity, 0)
                .limit(200);

            if (error) throw error;

            return (data || []).filter(candidate => {
                const name = (candidate[COL.product_name] || '').toLowerCase().trim();
                if (excludeNames.has(name)) return false;
                return isTherapeuticAlternative(row, candidate);
            });
        } catch (err) {
            console.warn('Alternatives fetch error:', err.message);
            return [];
        }
    }

    /* =============================================
       18. GROUP RESULTS BY PHARMACY
       ─────────────────────────────────────────────
       Currently all rows → TEST_PHARMACY (one card).
       FUTURE: Use row['pharmacy_name'] for real
       multi-pharmacy grouping.
       ============================================= */
    function groupByPharmacy(rows) {
        const groups = {};
        rows.forEach(row => {
            const key = TEST_PHARMACY.name;
            if (!groups[key]) {
                groups[key] = {
                    pharmacy: { ...TEST_PHARMACY },
                    items:    [],
                };
            }
            groups[key].items.push(row);
        });
        return Object.values(groups);
    }

    /* =============================================
       19. RENDER RESULTS
       ─────────────────────────────────────────────
       Entry point after Phase 2 fetch.
       Calls groupByPharmacy(), sorts, then renders
       one pharmacy card per group including
       alternative medicines panel.
       ============================================= */
    async function renderResults(rows, sortMode) {
        if (!rows || rows.length === 0) {
            showEmptyState('No pharmacies found with this medicine in stock.');
            return;
        }

        const groups = groupByPharmacy(rows);

        // Sort groups
        if (sortMode === 'cheapest') {
            groups.forEach(g => {
                g.items.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
            });
            groups.sort((a, b) =>
                getEffectivePrice(a.items[0]) - getEffectivePrice(b.items[0])
            );
        } else {
            // Nearest — sort by distance if GPS available
            if (userLat !== null && userLng !== null) {
                groups.sort((a, b) =>
                    haversine(userLat, userLng, a.pharmacy.lat, a.pharmacy.lng) -
                    haversine(userLat, userLng, b.pharmacy.lat, b.pharmacy.lng)
                );
            }
        }

        const totalPharmacies = groups.length;
        resultsCount.innerHTML =
            `Found <strong>${totalPharmacies}</strong> pharmacy${totalPharmacies !== 1 ? 's' : ''} with this medicine`;

        // Collect all product names currently shown so alternatives can exclude them
        const shownNames = new Set(
            rows.map(r => (r[COL.product_name] || '').toLowerCase().trim())
        );

        // Render each pharmacy card with its alternatives panel
        const cardHTMLs = await Promise.all(groups.map(async group => {
            const alts = await fetchAlternatives(group.items[0], shownNames);
            return buildPharmacyCardHTML(group, alts, sortMode);
        }));

        pharmacyList.innerHTML = cardHTMLs.join('');
        attachPanelToggleListeners();
    }

    /* =============================================
       20. BUILD PHARMACY CARD HTML
       ─────────────────────────────────────────────
       Builds the full HTML string for one pharmacy
       card including matched medicines and
       therapeutic alternatives panel.
       ============================================= */
    function buildPharmacyCardHTML(group, alts, sortMode) {
        const { pharmacy, items } = group;

        // Show cheapest item in the card header
        const displayItem = sortMode === 'cheapest'
            ? items[0]
            : items.reduce((a, b) => getEffectivePrice(a) < getEffectivePrice(b) ? a : b);

        const discPrice   = parsePrice(displayItem[COL.discounted_price]);
        const origPrice   = parsePrice(displayItem[COL.original_price]);
        const effPrice    = getEffectivePrice(displayItem);
        const isPrescReq  = (displayItem[COL.prescription] || '').toLowerCase() === 'yes';
        const altCount    = alts.length;

        // Price display
        const priceHTML = effPrice > 0
            ? `Rs. ${effPrice.toFixed(2)}`
            : 'Price not listed';
        const origPriceHTML = (origPrice > 0 && discPrice > 0 && origPrice !== discPrice)
            ? `<span class="price-original">Rs. ${origPrice.toFixed(2)}</span>`
            : '';

        // Matched medicines list (all items from this pharmacy)
        const matchedRows = items.map(item => {
            const ip  = parsePrice(item[COL.discounted_price]) || parsePrice(item[COL.original_price]);
            return `
            <li class="alt-row">
                <div class="alt-row__left">
                    <span class="alt-row__name">${escapeHtml(item[COL.product_name] || '—')}</span>
                    <span class="alt-row__meta">
                        ${escapeHtml(item[COL.category] || '')}
                        ${item[COL.strength] ? '&middot; ' + escapeHtml(item[COL.strength]) : ''}
                    </span>
                    <span class="alt-row__instock">
                        <i class="fa-solid fa-circle-check"></i> In Stock
                    </span>
                </div>
                <div class="alt-row__right">
                    <span class="alt-row__price${ip <= 0 ? ' alt-row__price--na' : ''}">
                        ${ip > 0 ? 'Rs. ' + ip.toFixed(2) : 'N/A'}
                    </span>
                    ${parsePrice(item[COL.original_price]) > 0 && parsePrice(item[COL.discounted_price]) > 0 && parsePrice(item[COL.original_price]) !== parsePrice(item[COL.discounted_price])
                        ? `<span class="alt-row__orig-price">Rs. ${parsePrice(item[COL.original_price]).toFixed(2)}</span>`
                        : ''}
                </div>
            </li>`;
        }).join('');

        // Therapeutic alternatives list
        const altsRows = alts.length > 0
            ? alts.map(alt => {
                const ap  = parsePrice(alt[COL.discounted_price]) || parsePrice(alt[COL.original_price]);
                const aop = parsePrice(alt[COL.original_price]);
                const adp = parsePrice(alt[COL.discounted_price]);
                return `
                <li class="alt-row">
                    <div class="alt-row__left">
                        <span class="alt-row__name">${escapeHtml(alt[COL.product_name] || '—')}</span>
                        <span class="alt-row__meta">
                            ${escapeHtml(alt[COL.category] || '')}
                            ${alt[COL.strength] ? '&middot; ' + escapeHtml(alt[COL.strength]) : ''}
                        </span>
                        <span class="alt-row__instock">
                            <i class="fa-solid fa-circle-check"></i> In Stock
                        </span>
                    </div>
                    <div class="alt-row__right">
                        <span class="alt-row__price${ap <= 0 ? ' alt-row__price--na' : ''}">
                            ${ap > 0 ? 'Rs. ' + ap.toFixed(2) : 'N/A'}
                        </span>
                        ${aop > 0 && adp > 0 && aop !== adp
                            ? `<span class="alt-row__orig-price">Rs. ${aop.toFixed(2)}</span>`
                            : ''}
                    </div>
                </li>`;
            }).join('')
            : '<li><p class="alt-empty">No therapeutic alternatives found in stock.</p></li>';

        return `
        <div class="pharmacy-card">
            <div class="card-top">
                <div class="card-image card-image--fallback">
                    <span class="status-pill">
                        <i class="fa-solid fa-circle" style="font-size:7px;color:var(--green)"></i>
                        In Stock
                    </span>
                </div>
                <div class="card-info">
                    <div class="card-info__header">
                        <div>
                            <h2 class="card-info__name">${escapeHtml(pharmacy.name)}</h2>
                            <span class="card-info__badge">
                                <i class="fa-solid fa-circle-check"></i> Verified
                            </span>
                        </div>
                    </div>
                    <p class="card-info__meta">
                        ${escapeHtml(displayItem[COL.product_name] || '')}
                    </p>
                    <p class="card-info__meta" style="color:var(--gray-mid);font-size:12px;">
                        ${escapeHtml(displayItem[COL.category] || '')}
                        ${displayItem[COL.strength] ? '&middot; ' + escapeHtml(displayItem[COL.strength]) : ''}
                    </p>
                    <p class="card-info__phone">
                        <i class="fa-solid fa-phone"></i> ${escapeHtml(pharmacy.phone)}
                    </p>
                </div>
                <div class="card-price">
                    <span class="price">${escapeHtml(priceHTML)}</span>
                    ${origPriceHTML}
                    ${isPrescReq
                        ? '<span class="price-tag price-tag--rx">Rx</span>'
                        : '<span class="price-tag price-tag--otc">OTC</span>'}
                    <span class="price-label">STARTING FROM</span>
                </div>
            </div>

            <!-- Alternatives toggle button -->
            <button class="alternatives-btn panel-toggle-btn" aria-expanded="false">
                <span class="alternatives-btn__icon">
                    <i class="fa-solid fa-arrow-right-arrow-left"></i>
                </span>
                View Alternatives
                <span class="alt-badge">${altCount}</span>
                <i class="fa-solid fa-chevron-down toggle-icon" style="margin-left:auto;font-size:12px;color:var(--gray-mid);"></i>
            </button>

            <!-- Alternatives panel (hidden by default) -->
            <div class="alternatives-panel" style="display:none;" aria-hidden="true">

                <!-- Matched Medicines -->
                <p class="alt-section-label">MATCHED MEDICINES</p>
                <ul class="alt-list">${matchedRows}</ul>

                <!-- Therapeutic Alternatives -->
                <p class="alt-section-label alt-section-label--sep">
                    THERAPEUTIC ALTERNATIVES
                    <span class="alt-section-note">Same generic · dosage form · strength · release type</span>
                </p>
                <ul class="alt-list">${altsRows}</ul>

                <!-- Safety note -->
                <div class="alt-safety-note">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Always consult your doctor before switching to an alternative medicine,
                    even if it contains the same active ingredient.
                </div>

            </div>
        </div>`;
    }

    /* =============================================
       21. HAVERSINE DISTANCE (km)
       ─────────────────────────────────────────────
       Used by "Nearest" sort to calculate distance
       between user GPS and pharmacy coordinates.
       ============================================= */
    function haversine(lat1, lng1, lat2, lng2) {
        const R    = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a    =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /* =============================================
       22. UI STATE HELPERS
       ============================================= */
    function showInitialState() {
        resultsCount.textContent = 'Type a medicine name above to search';
        pharmacyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-pills"></i>
                <p>Search for a medicine to see available pharmacies</p>
            </div>`;
    }

    function showLoadingState() {
        resultsCount.textContent = 'Searching...';
        pharmacyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-spinner fa-spin"></i>
                <p>Searching pharmacies...</p>
            </div>`;
    }

    function showEmptyState(msg) {
        resultsCount.textContent = 'No results found';
        pharmacyList.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-magnifying-glass"></i>
                <p>${msg}</p>
            </div>`;
    }

    function showErrorState(msg) {
        resultsCount.textContent = 'Search error';
        pharmacyList.innerHTML = `
            <div class="empty-state" style="color:var(--red)">
                <i class="fa-solid fa-circle-exclamation"></i>
                <p>${msg}</p>
            </div>`;
    }

    /* =============================================
       23. PANEL TOGGLE — View Alternatives
       ─────────────────────────────────────────────
       Re-attached after every renderResults() because
       the DOM is fully replaced on each render.
       ============================================= */
    function attachPanelToggleListeners() {
        document.querySelectorAll('.panel-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const panel  = btn.nextElementSibling;
                const icon   = btn.querySelector('.toggle-icon');
                const isOpen = panel.style.display === 'block';
                panel.style.display = isOpen ? 'none'  : 'block';
                panel.ariaHidden    = isOpen ? 'true'  : 'false';
                btn.ariaExpanded    = isOpen ? 'false' : 'true';
                if (icon) {
                    icon.classList.toggle('fa-chevron-down', isOpen);
                    icon.classList.toggle('fa-chevron-up',  !isOpen);
                }
            });
        });
    }

    /* =============================================
       24. SORT BUTTONS
       ─────────────────────────────────────────────
       Re-sorts cached currentResults without a new
       Supabase query — purely client-side re-render.
       ============================================= */
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sortBtns.forEach(b => b.classList.remove('sort-btn--active'));
            btn.classList.add('sort-btn--active');
            currentSort = btn.dataset.sort || 'nearest';
            if (currentResults.length > 0) renderResults(currentResults, currentSort);
        });
    });

    /* =============================================
       25. SEARCH INPUT — smart debounced handler
       ─────────────────────────────────────────────
       Every keystroke:
       1. Clear previous debounce timer
       2. Empty → initial state + clear dropdown
       3. Wait 400ms → check isCompleteWord()
       4. Fetch suggestions → show dropdown
       Enter / Escape keys handled separately.
       ============================================= */
    searchInput && searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();

        if (query.length === 0) {
            clearSuggestions();
            showInitialState();
            currentResults = [];
            return;
        }

        debounceTimer = setTimeout(async () => {
            if (!isCompleteWord(query)) { clearSuggestions(); return; }
            const names = await fetchSuggestions(query);
            showSuggestions(names);
        }, 400);
    });

    // Enter → select first suggestion
    searchInput && searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && suggestionBox) {
            const first = suggestionBox.querySelector('.suggestion-item');
            if (first) { e.preventDefault(); selectProduct(first.textContent); }
        }
        if (e.key === 'Escape') clearSuggestions();
    });

    // Click outside → close suggestions
    document.addEventListener('click', e => {
        if (!searchInput.contains(e.target) && (!suggestionBox || !suggestionBox.contains(e.target))) {
            clearSuggestions();
        }
    });

    /* =============================================
       26. LOGOUT
       ============================================= */
    logoutBtn && logoutBtn.addEventListener('click', async e => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* =============================================
       27. SIDEBAR TOGGLE — mobile hamburger
       ============================================= */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const openSidebar  = () => { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; };
    const closeSidebar = () => { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; };

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* =============================================
       28. AUTO-SEARCH FROM URL PARAM
       ─────────────────────────────────────────────
       ?q=ProductName triggers automatic search.
       Called from Dashboard "Recent Searches" links.
       logSearch() called so the re-search is also
       recorded in user_search_history.
       ============================================= */
    function autoSearchFromUrl() {
        const params     = new URLSearchParams(window.location.search);
        const queryParam = params.get('q');
        if (queryParam && queryParam.trim()) {
            const productName = queryParam.trim();
            searchInput.value = productName;
            logSearch(productName);
            searchByExactProduct(productName);
        }
    }

    /* =============================================
       ══════════════════════════════════════════════
       PRESCRIPTION SCANNER — SECTION 29–35
       ══════════════════════════════════════════════
       How it works end-to-end:

       29. createHiddenFileInput() — creates an <input
           type="file"> that is never shown in the DOM.
           It is triggered programmatically when the
           "Upload Prescription" button is clicked.

       30. uploadPrescriptionBtn click → fileInput.click()

       31. fileInput change → validateFile() → if OK:
           a. showScanningOverlay() — dim the page and
              show a spinner with percentage progress.
           b. runOCR(file) — loads Tesseract.js from
              CDN, runs recognition, returns raw text.
           c. extractMedicineNames(rawText) — matches
              OCR output against live Supabase product
              names using prefix/substring matching.
           d. hideScanningOverlay()
           e. renderPrescriptionQueue(names) — shows a
              sticky pill-tab bar above results section.
              Each tab = one found medicine name.
           f. savePrescriptionToVault(file, userId) —
              uploads image to Supabase Storage and
              inserts a metadata row (max 5, pruned by
              RPC prune_prescriptions).
           g. Auto-selects the FIRST found medicine so
              the user immediately sees results.

       32. Each tab click → selectProduct(name) — uses
           the EXACT SAME path as a normal suggestion
           click, so: logSearch(), renderResults(),
           history tracking all work identically.

       33. All found medicines are logged to
           user_search_history one-by-one via
           logSearch() — they appear in History and
           Dashboard "Recent Searches" exactly like
           manual searches.
       ══════════════════════════════════════════════
       ============================================= */

    /* =============================================
       29. CREATE HIDDEN FILE INPUT
       ─────────────────────────────────────────────
       Appended to body once. Reused across scans.
       accept: only common image types.
       ============================================= */
    function createHiddenFileInput() {
        const input     = document.createElement('input');
        input.type      = 'file';
        input.accept    = 'image/jpeg,image/png,image/webp,image/gif';
        input.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
        document.body.appendChild(input);
        return input;
    }

    /* =============================================
       30. UPLOAD PRESCRIPTION BUTTON
       ─────────────────────────────────────────────
       Triggers the hidden file input on click.
       ============================================= */
    uploadPrescriptionBtn && uploadPrescriptionBtn.addEventListener('click', () => {
        fileInput.value = '';   // reset so same file can be re-uploaded
        fileInput.click();
    });

    /* =============================================
       31. FILE INPUT CHANGE — main scan pipeline
       ─────────────────────────────────────────────
       Validates → scans → extracts → saves → renders.
       ============================================= */
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        // ── Client-side 1 MB guard ──
        if (file.size > PRESCRIPTION_MAX_BYTES) {
            alert('Prescription image must be less than 1 MB. Please compress or crop the image and try again.');
            return;
        }

        // ── Auth check ──
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = 'Login.html'; return; }

        showScanningOverlay(0);

        try {
            // ── OCR ──
            const rawText = await runOCR(file, pct => updateScanningOverlay(pct));

            // ── Extract medicine names from OCR text ──
            showScanningOverlay(90, 'Matching medicines...');
            const foundNames = await extractMedicineNames(rawText);

            hideScanningOverlay();

            if (foundNames.length === 0) {
                alert('No recognisable medicine names found in this prescription. Please try a clearer photo, or use the search bar.');
                return;
            }

            // ── Render the prescription queue bar ──
            renderPrescriptionQueue(foundNames);

            // ── Save image + metadata to Supabase ──
            // fire-and-forget — vault save should not block the search UI
            savePrescriptionToVault(file, session.user.id).catch(err =>
                console.warn('Vault save error:', err.message)
            );

            // ── Log all found medicines sequentially — prevents 21+ row race ──
            logSearchBatch(foundNames);

            // ── Auto-select first medicine to show results immediately ──
            selectProduct(foundNames[0]);

        } catch (err) {
            hideScanningOverlay();
            console.error('Prescription scan error:', err);
            alert('Scan failed: ' + err.message + '\nPlease try a clearer photo.');
        }
    });

    /* =============================================
       32. RUN OCR — Tesseract.js (client-side)
       ─────────────────────────────────────────────
       WHY client-side?
         • Zero server cost — runs entirely in the
           user's browser via WebAssembly.
         • No new API, no Supabase functions needed.
         • Works for printed prescriptions very well.
           Handwritten: partial support (~40–60%).

       Tesseract is loaded from CDN in the HTML
       (see <script src="...tesseract..."> added to
       UserPharmacySearch.html).

       onProgress callback updates the scanning
       overlay percentage indicator.

       Returns raw OCR text string.
       ============================================= */
    async function runOCR(file, onProgress) {
        // Tesseract.js must be loaded as a CDN script in the HTML
        if (typeof Tesseract === 'undefined') {
            throw new Error('OCR library not loaded. Please check your internet connection.');
        }

        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && onProgress) {
                    onProgress(Math.round(m.progress * 85)); // 0-85%, remaining for matching
                }
            },
        });

        // PSM 6 = Assume a single uniform block of text — good for prescriptions
        await worker.setParameters({ tessedit_pageseg_mode: '6' });

        const { data } = await worker.recognize(file);
        await worker.terminate();
        return data.text;
    }

    /* =============================================
       33. EXTRACT MEDICINE NAMES FROM OCR TEXT
       ─────────────────────────────────────────────
       COMPLETE REWRITE in v5.1 — intelligent
       prescription line parser replacing the broken
       N-gram approach.

       ROOT CAUSE OF OLD APPROACH'S FAILURE:
         N-grams of ALL tokens (including "SYP", "TAB",
         "2", dosage numbers, Arabic text fragments,
         patient info words) were queried with ilike
         against the entire stock, producing 25+
         unrelated false-positive matches.

       NEW STRATEGY — 4-phase pipeline:

       PHASE 1 — OCR LINE EXTRACTION
         Split raw OCR text into lines. Each line is
         processed independently. Lines shorter than
         3 chars or consisting only of digits/symbols
         are discarded immediately.

       PHASE 2 — PRESCRIPTION LINE DETECTION
         A prescription line almost always starts with
         a dosage-form keyword (SYP, TAB, CAP, INJ,
         EYE, EAR, GEL, CRM, SUPP, SUSP, SOL, LOT,
         OIN, OINT, DROPS, SYRUP, TABLET, CAPSULE,
         INJECTION…) followed by the medicine name.
         We detect these prefix patterns and STRIP them
         to isolate the raw medicine name token.

         Lines NOT starting with these keywords are
         also considered as fallback candidates if they
         contain ≥ 2 capitalised words (typical of
         medicine brand names like "PANADOL EXTRA").

       PHASE 3 — NAME NORMALISATION
         Each extracted name candidate is normalised:
         • Remove hyphens/dots between words → spaces
           ("PANADOL-EXTRA" → "PANADOL EXTRA")
         • Collapse multiple spaces
         • Remove trailing dosage noise (numbers + units
           like "500mg", "20ml") from the END only —
           keep the brand name intact
         • Strip trailing Roman numerals (I, II, III)
           that OCR sometimes appends
         • Lowercase for matching

       PHASE 4 — FUZZY DB MATCHING (smart ilike)
         For each normalised candidate we run up to 3
         progressively broader Supabase queries:

         Query A — exact normalised name prefix:
           ilike 'candidate%'  (highest precision)

         Query B — each significant word (≥4 chars)
           individually, keeping only DB results whose
           product_name contains ALL significant words
           from the candidate (AND logic, not OR).
           This handles:
             "PANADOL EXTRA" → matches "Panadol Extra
              Tablets 500mg" because both "panadol" and
              "extra" appear in the product name.

         Query C — first word only (≥4 chars) as
           broader fallback. Results ranked by how
           many candidate words appear in the DB name.
           Only the best-scoring result is kept from
           this query to avoid noise.

         De-duplication: once a DB product_name is
         matched by any candidate, it is added to a
         "seen" set so the same product never appears
         twice in the final list even if multiple OCR
         lines reference it.

       RESULT ORDERING:
         Medicines are returned in the order their
         prescription lines appear in the OCR output
         (top-to-bottom reading order), which matches
         the doctor's intended prescription sequence.

       HANDLES GRACEFULLY:
         • "PANADOL-EXTRA" → "Panadol Extra Tablets"
         • "KOLAC" → "Kolac Syrup" / "Kolac Tablets"
         • "BABYNOL" → "Babynol Drops" / "Babynol Syrup"
         • Mixed case: panadol extra, PANADOL EXTRA
         • Typos: "PANODOL" → still matches via word B
         • Arabic text lines: discarded in Phase 1
         • Patient name / date lines: discarded (no
           dosage-form keyword, no cap words)
         • Dose instructions ("2 مرات يومياً"): discarded
       ============================================= */

    /* ── Dosage-form prefix keywords to strip ── */
    const RX_PREFIXES = [
        'SYRUP', 'SYP', 'TABLET', 'TAB', 'CAPSULE', 'CAP', 'CAPS',
        'INJECTION', 'INJ', 'EYE DROPS', 'EAR DROPS', 'EYE', 'EAR',
        'GEL', 'CREAM', 'CRM', 'OINTMENT', 'OINT', 'OIN',
        'SUSPENSION', 'SUSP', 'SOLUTION', 'SOL', 'LOTION', 'LOT',
        'SUPPOSITORY', 'SUPP', 'DROPS', 'SPRAY', 'INHALER', 'INH',
        'SACHET', 'PATCH', 'POWDER', 'PWD', 'LIQUID', 'LIQ',
        'NASAL', 'TOPICAL', 'ORAL', 'IV', 'IM', 'SC',
    ];

    /* Regex: matches a line starting with a dosage-form prefix */
    const RX_PREFIX_RE = new RegExp(
        '^\\s*(?:R\\/|Rx\\.?|R:)?\\s*(' +
        RX_PREFIXES.map(p => p.replace(/\s+/g, '\\s+')).join('|') +
        ')[.:\\s]+',
        'i'
    );

    /* Regex: matches a line that is ONLY noise (digits, units, arabic, punct) */
    const NOISE_LINE_RE = /^[\d\s\.\,\-\+\/\\\(\)\[\]%مرات يومياًصباحاًمساءًبعدقبلالأكلوجبات]+$/u;

    /* Regex: strip trailing dosage info — e.g. "500mg", "20 ml", "1/2 tab" */
    const TRAILING_DOSE_RE = /[\s\-]+\d[\d\s\/\.]*\s*(?:mg|mcg|ml|g|iu|units?|tab[s]?|cap[s]?|drop[s]?)[\s\d]*$/i;

    async function extractMedicineNames(rawText) {
        if (!rawText || !rawText.trim()) return [];

        /* ── PHASE 1: split into lines, discard garbage ── */
        const lines = rawText
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l.length >= 3)
            .filter(l => !NOISE_LINE_RE.test(l))
            // Discard lines that are mostly non-latin (Arabic / Urdu OCR noise)
            .filter(l => {
                const latinChars = (l.match(/[a-zA-Z]/g) || []).length;
                return latinChars >= 3;
            });

        if (lines.length === 0) return [];

        /* ── PHASE 2: extract candidate medicine name from each line ── */
        const candidates = [];

        for (const line of lines) {
            let candidate = null;

            // Check if line starts with a dosage-form prefix
            const prefixMatch = line.match(RX_PREFIX_RE);
            if (prefixMatch) {
                // Strip the prefix, keep the rest as the medicine name candidate
                candidate = line.slice(prefixMatch[0].length).trim();
            } else {
                // Fallback: check if line has ≥ 2 capitalised word tokens
                // (typical of medicine brand names: "PANADOL EXTRA", "BABY NOL")
                const upperWords = (line.match(/\b[A-Z][A-Z\d\-]{2,}\b/g) || []);
                if (upperWords.length >= 1) {
                    candidate = line.trim();
                }
            }

            if (!candidate || candidate.length < 3) continue;

            /* ── PHASE 3: normalise the candidate ── */
            candidate = candidate
                .replace(/[-\.]/g, ' ')           // hyphens/dots → spaces
                .replace(/\s+/g, ' ')              // collapse spaces
                .replace(TRAILING_DOSE_RE, '')     // strip trailing dose info
                .trim();

            // Discard very short or purely numeric candidates after normalisation
            if (candidate.length < 3) continue;
            if (/^\d+$/.test(candidate)) continue;

            candidates.push(candidate);
        }

        if (candidates.length === 0) return [];

        /* ── PHASE 4: fuzzy DB matching for each candidate ── */
        const seenProducts = new Set(); // deduplicate across all candidates
        const orderedNames = [];        // preserve prescription line order

        // Process candidates sequentially to keep prescription order
        for (const candidate of candidates) {
            const normalised = candidate.toLowerCase().trim();

            // Significant words: ≥ 4 chars, not common noise words
            const STOP_WORDS = new Set(['with','and','the','for','tabs','caps','syp','tab','cap']);
            const sigWords = normalised
                .split(/\s+/)
                .filter(w => w.length >= 4 && !STOP_WORDS.has(w));

            if (sigWords.length === 0) continue;

            let matched = null;

            /* ── Query A: prefix match (most precise) ── */
            try {
                const { data: dataA } = await supabaseClient
                    .from('Pharmacy Data')
                    .select(COL.product_name)
                    .ilike(COL.product_name, `${normalised}%`)
                    .gt(COL.quantity, 0)
                    .limit(3);

                if (dataA && dataA.length > 0) {
                    matched = dataA[0][COL.product_name];
                }
            } catch (_) { /* continue to Query B */ }

            /* ── Query B: ALL significant words must appear in product name ── */
            if (!matched && sigWords.length >= 1) {
                try {
                    // Build an OR filter for all sig words, then client-filter for AND
                    const orFilter = sigWords
                        .map(w => `${COL.product_name}.ilike.%${w}%`)
                        .join(',');

                    const { data: dataB } = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .or(orFilter)
                        .gt(COL.quantity, 0)
                        .limit(50);

                    if (dataB && dataB.length > 0) {
                        // Client-side AND filter: product must contain ALL sig words
                        const andMatch = dataB.find(row => {
                            const pn = (row[COL.product_name] || '').toLowerCase();
                            return sigWords.every(w => pn.includes(w));
                        });
                        if (andMatch) matched = andMatch[COL.product_name];
                    }
                } catch (_) { /* continue to Query C */ }
            }

            /* ── Query C: first significant word only (broadest fallback) ── */
            if (!matched && sigWords[0] && sigWords[0].length >= 4) {
                try {
                    const { data: dataC } = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .ilike(COL.product_name, `%${sigWords[0]}%`)
                        .gt(COL.quantity, 0)
                        .limit(20);

                    if (dataC && dataC.length > 0) {
                        // Score each result: count how many sig words appear in it
                        const scored = dataC.map(row => {
                            const pn = (row[COL.product_name] || '').toLowerCase();
                            const score = sigWords.filter(w => pn.includes(w)).length;
                            return { name: row[COL.product_name], score };
                        });
                        // Only keep if at least 1 sig word matched
                        scored.sort((a, b) => b.score - a.score);
                        if (scored[0].score >= 1) matched = scored[0].name;
                    }
                } catch (_) { /* no match for this candidate */ }
            }

            // Add to ordered list if found and not already included
            if (matched) {
                const key = matched.toLowerCase().trim();
                if (!seenProducts.has(key)) {
                    seenProducts.add(key);
                    orderedNames.push(matched);
                }
            }
        }

        return orderedNames;
    }

    /* =============================================
       34. PRESCRIPTION QUEUE BAR
       ─────────────────────────────────────────────
       Shows a horizontal scrollable row of pill-tabs
       above the pharmacy results section.
       Each tab = one medicine found in prescription.

       Tab click → selectProduct(name) — same flow
       as clicking a suggestion in the dropdown.
       The active tab gets a green highlight.

       The bar has an × close button to dismiss it
       and reset to the initial search state.
       ============================================= */
    function renderPrescriptionQueue(names) {
        // Remove any previous queue bar
        const existing = document.getElementById('prescriptionQueueBar');
        if (existing) existing.remove();

        const bar       = document.createElement('div');
        bar.id          = 'prescriptionQueueBar';
        bar.className   = 'prescription-queue';

        bar.innerHTML = `
            <div class="prescription-queue__header">
                <span class="prescription-queue__label">
                    <i class="fa-solid fa-file-prescription"></i>
                    Prescription Scan &mdash; ${names.length} medicine${names.length !== 1 ? 's' : ''} found
                </span>
                <button class="prescription-queue__close" id="closeQueueBtn" aria-label="Close prescription queue">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="prescription-queue__tabs" id="queueTabs">
                ${names.map((name, i) => `
                    <button class="queue-tab${i === 0 ? ' queue-tab--active' : ''}"
                            data-name="${escapeHtml(name)}"
                            title="${escapeHtml(name)}">
                        ${escapeHtml(name)}
                    </button>`).join('')}
            </div>`;

        // Insert ABOVE the results-header section
        const resultsHeader = document.querySelector('.results-header');
        if (resultsHeader) {
            resultsHeader.parentNode.insertBefore(bar, resultsHeader);
        } else {
            document.querySelector('.main').appendChild(bar);
        }

        // Tab click → selectProduct + active highlight
        bar.querySelectorAll('.queue-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                bar.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('queue-tab--active'));
                tab.classList.add('queue-tab--active');
                selectProduct(tab.dataset.name);
            });
        });

        // Close button → remove bar + reset
        document.getElementById('closeQueueBtn').addEventListener('click', () => {
            bar.remove();
            searchInput.value = '';
            showInitialState();
            currentResults = [];
        });
    }

    /* =============================================
       35. SAVE PRESCRIPTION TO VAULT
       ─────────────────────────────────────────────
       Uploads image to Supabase Storage bucket
       "prescriptions/{userId}/{timestamp}_{filename}".
       Then inserts a row into user_prescriptions
       table with the public URL and filename.
       Calls RPC prune_prescriptions to keep ≤5.

       TABLE: user_prescriptions
         id          uuid        PK  gen_random_uuid()
         user_id     uuid        FK  auth.users(id) NOT NULL
         file_name   text        original filename
         file_url    text        public storage URL
         file_size   int8        bytes
         uploaded_at timestamptz default now()

       STORAGE BUCKET: prescriptions
         Path: {userId}/{timestamp}_{filename}
         Public: true (so file_url can be shown)
         Max file size enforced client-side (1 MB).
       ============================================= */
    async function savePrescriptionToVault(file, userId) {
        const timestamp = Date.now();
        const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${userId}/${timestamp}_${safeName}`;

        // Upload to Supabase Storage
        const { error: uploadErr } = await supabaseClient
            .storage
            .from('prescriptions')
            .upload(storagePath, file, {
                cacheControl: '3600',
                upsert:       false,
            });

        if (uploadErr) throw new Error('Storage upload failed: ' + uploadErr.message);

        // Get public URL
        const { data: urlData } = supabaseClient
            .storage
            .from('prescriptions')
            .getPublicUrl(storagePath);

        const fileUrl = urlData?.publicUrl || '';

        // Insert metadata row into user_prescriptions
        const { error: insertErr } = await supabaseClient
            .from('user_prescriptions')
            .insert({
                user_id:   userId,
                file_name: file.name,
                file_url:  fileUrl,
                file_size: file.size,
                // uploaded_at: DB default now()
            });

        if (insertErr) throw new Error('DB insert failed: ' + insertErr.message);

        // Atomic prune — keeps only 5 most-recent prescriptions per user
        await supabaseClient.rpc('prune_prescriptions', { p_user_id: userId });
    }

    /* =============================================
       36. SCANNING OVERLAY — show/update/hide
       ─────────────────────────────────────────────
       A full-viewport dim overlay with a spinner and
       percentage counter shown during OCR processing.
       Prevents user interaction during the scan.
       ============================================= */
    function showScanningOverlay(pct = 0, label = 'Scanning prescription...') {
        let overlay = document.getElementById('scanOverlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'scanOverlay';
            overlay.innerHTML = `
                <div class="scan-overlay__box">
                    <i class="fa-solid fa-spinner fa-spin scan-overlay__spinner"></i>
                    <p class="scan-overlay__label" id="scanLabel">${label}</p>
                    <p class="scan-overlay__pct" id="scanPct">${pct}%</p>
                </div>`;
            document.body.appendChild(overlay);
        } else {
            document.getElementById('scanLabel').textContent = label;
            document.getElementById('scanPct').textContent  = pct + '%';
        }
    }

    function updateScanningOverlay(pct, label) {
        const lEl = document.getElementById('scanLabel');
        const pEl = document.getElementById('scanPct');
        if (lEl && label) lEl.textContent = label;
        if (pEl) pEl.textContent = pct + '%';
    }

    function hideScanningOverlay() {
        const overlay = document.getElementById('scanOverlay');
        if (overlay) overlay.remove();
    }

    /* =============================================
       37. XSS PREVENTION HELPER
       ─────────────────────────────────────────────
       Always used when injecting user/DB data into
       innerHTML to prevent script injection.
       ============================================= */
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,  '&amp;')
            .replace(/</g,  '&lt;')
            .replace(/>/g,  '&gt;')
            .replace(/"/g,  '&quot;')
            .replace(/'/g,  '&#39;');
    }

    /* ─── INIT ─── */
    initPage();
    autoSearchFromUrl();

})();
