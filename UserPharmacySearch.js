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
    /* =============================================
       33. EXTRACT MEDICINE NAMES FROM OCR TEXT
       ─────────────────────────────────────────────
       4-phase intelligent prescription parser.

       PHASE 1 — Line filtering
         Split OCR into lines. Discard: pure digit/
         punctuation/arabic lines, lines with fewer
         than 3 Latin chars, known header lines
         (Patient Name, Gender, Age, City etc.).

       PHASE 2 — Medicine line detection
         Lines starting with a dosage-form keyword
         (SYP, TAB, CAP, EYE, INJ, DROPS…) have
         the prefix stripped to isolate the name.
         Lines with ≥1 all-caps token are candidates.

       PHASE 3 — Name normalisation
         Hyphens/dots → spaces. Trailing Arabic/
         non-Latin chars stripped. Trailing dose
         units (500mg, 20ml) stripped from end.

       PHASE 4 — 3-tier fuzzy DB matching
         A: exact prefix ilike match (most precise)
         B: ALL significant words must appear in
            product_name (AND logic across words)
         C: first word only, scored by word-overlap
         Results returned in prescription line order.

       Handles: PANADOL-EXTRA → "Panadol Extra Tablets"
                KOLAC → "Kolac Syrup"
                BABYNOL → "Babynol Drops"
                Mixed case, hyphens, trailing Arabic
       ============================================= */

    /* Dosage-form prefixes to detect + strip from prescription lines */
    const RX_PREFIXES = [
        'SYRUP', 'SYP', 'TABLET', 'TAB', 'CAPSULE', 'CAP', 'CAPS',
        'INJECTION', 'INJ', 'EYE DROPS', 'EAR DROPS', 'EYE', 'EAR',
        'GEL', 'CREAM', 'CRM', 'OINTMENT', 'OINT', 'OIN',
        'SUSPENSION', 'SUSP', 'SOLUTION', 'SOL', 'LOTION', 'LOT',
        'SUPPOSITORY', 'SUPP', 'DROPS', 'SPRAY', 'INHALER', 'INH',
        'SACHET', 'PATCH', 'POWDER', 'PWD', 'LIQUID', 'LIQ',
        'NASAL', 'TOPICAL', 'ORAL', 'IV', 'IM', 'SC',
    ];

    /* Matches a prescription line that starts with a dosage-form keyword */
    const RX_PREFIX_RE = new RegExp(
        '^\s*(?:R\/|Rx\.?|R:)?\s*(' +
        RX_PREFIXES.map(function(p) { return p.replace(/\s+/g, '\\s+'); }).join('|') +
        ')[.:\s]+',
        'i'
    );

    /* Matches lines that are ONLY noise: digits, punctuation, Arabic unicode ranges.
       Uses unicode code-point ranges so no /u flag needed (avoids strict-mode errors). */
    const NOISE_LINE_RE = new RegExp(
        '^[\\d\\s\\.,\\+\\-\\/\\\\\\(\\)\\[\\]\\%' +
        '\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF' +
        ']+$'
    );

    /* Strips trailing dose info: " 500mg", " 20ml", " 1/2 tab" etc. */
    const TRAILING_DOSE_RE = new RegExp(
        '[\\s\\-]+\\d[\\d\\s\\.\\/]*\\s*' +
        '(?:mg|mcg|ml|g|iu|units?|tabs?|caps?|drops?)' +
        '[\\s\\d]*$',
        'i'
    );

    /* Common prescription header words — lines starting with these are skipped */
    const HEADER_LINE_RE = new RegExp(
        '^\s*(?:patient|name|gender|age|weight|height|b\.?p\.?|pulse|temp|' +
        'city|date|address|dr\.|doctor|hospital|clinic|phone|tel|' +
        'ref|diagnosis|clinical|tests?|investigation|vitals?|male|female|rx\b|' +
        '\d{2,}[\\/\-]\d{2,})',
        'i'
    );

    async function extractMedicineNames(rawText) {
        if (!rawText || !rawText.trim()) return [];

        /* ── PHASE 1: filter lines ── */
        var allLines = rawText.split(/\r?\n/);
        var filteredLines = [];
        for (var fi = 0; fi < allLines.length; fi++) {
            var l = allLines[fi].trim();
            if (l.length < 3) continue;
            if (NOISE_LINE_RE.test(l)) continue;
            if (HEADER_LINE_RE.test(l)) continue;
            var latinCount = (l.match(/[a-zA-Z]/g) || []).length;
            if (latinCount < 3) continue;
            filteredLines.push(l);
        }

        if (filteredLines.length === 0) return [];

        /* ── PHASE 2 + 3: extract and normalise candidates ── */
        var candidates = [];
        for (var li = 0; li < filteredLines.length; li++) {
            var line = filteredLines[li];
            var candidate = null;

            var prefixMatch = line.match(RX_PREFIX_RE);
            if (prefixMatch) {
                /* Line starts with SYP/TAB/CAP etc. — strip prefix, keep name */
                candidate = line.slice(prefixMatch[0].length).trim();
            } else {
                /* Fallback: line with at least one all-caps token (brand name) */
                var capsWords = line.match(/\b[A-Z][A-Z\d\-]{2,}\b/g) || [];
                if (capsWords.length >= 1) {
                    candidate = line.trim();
                }
            }

            if (!candidate || candidate.length < 3) continue;

            /* Normalise: hyphens→spaces, collapse spaces, strip trailing arabic,
               strip trailing dose units */
            candidate = candidate
                .replace(/[-\.]/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(TRAILING_DOSE_RE, '')
                .replace(/[^a-zA-Z0-9\s]+.*$/, '')
                .trim();

            if (candidate.length < 3) continue;
            if (/^\d+$/.test(candidate)) continue;

            candidates.push(candidate);
        }

        if (candidates.length === 0) return [];

        /* ── PHASE 4: fuzzy DB matching (sequential for history race safety) ── */
        var seenProducts = {};
        var orderedNames = [];

        /* Stop words excluded from significant-word matching */
        var STOP_WORDS = { 'with':1,'and':1,'the':1,'for':1,'tabs':1,'caps':1,'syp':1,'tab':1,'cap':1 };

        for (var ci = 0; ci < candidates.length; ci++) {
            var candidate = candidates[ci];
            var normalised = candidate.toLowerCase().trim();

            /* Significant words: ≥4 chars, not stop words */
            var allWords = normalised.split(/\s+/);
            var sigWords = [];
            for (var wi = 0; wi < allWords.length; wi++) {
                var w = allWords[wi];
                if (w.length >= 4 && !STOP_WORDS[w]) sigWords.push(w);
            }
            if (sigWords.length === 0) continue;

            var matched = null;

            /* Query A: prefix match — most precise */
            try {
                var resA = await supabaseClient
                    .from('Pharmacy Data')
                    .select(COL.product_name)
                    .ilike(COL.product_name, normalised + '%')
                    .gt(COL.quantity, 0)
                    .limit(3);
                if (resA.data && resA.data.length > 0) {
                    matched = resA.data[0][COL.product_name];
                }
            } catch (_) { /* fall through to Query B */ }

            /* Query B: all significant words must appear in product_name (AND) */
            if (!matched && sigWords.length >= 1) {
                try {
                    var orParts = sigWords.map(function(w) {
                        return COL.product_name + '.ilike.%' + w + '%';
                    });
                    var resB = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .or(orParts.join(','))
                        .gt(COL.quantity, 0)
                        .limit(50);
                    if (resB.data && resB.data.length > 0) {
                        for (var ri = 0; ri < resB.data.length; ri++) {
                            var pn = (resB.data[ri][COL.product_name] || '').toLowerCase();
                            var allMatch = true;
                            for (var si = 0; si < sigWords.length; si++) {
                                if (pn.indexOf(sigWords[si]) === -1) { allMatch = false; break; }
                            }
                            if (allMatch) { matched = resB.data[ri][COL.product_name]; break; }
                        }
                    }
                } catch (_) { /* fall through to Query C */ }
            }

            /* Query C: first significant word, scored by overlap — broadest fallback */
            if (!matched && sigWords[0] && sigWords[0].length >= 4) {
                try {
                    var resC = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .ilike(COL.product_name, '%' + sigWords[0] + '%')
                        .gt(COL.quantity, 0)
                        .limit(20);
                    if (resC.data && resC.data.length > 0) {
                        var best = null;
                        var bestScore = 0;
                        for (var ri2 = 0; ri2 < resC.data.length; ri2++) {
                            var pn2 = (resC.data[ri2][COL.product_name] || '').toLowerCase();
                            var score = 0;
                            for (var si2 = 0; si2 < sigWords.length; si2++) {
                                if (pn2.indexOf(sigWords[si2]) !== -1) score++;
                            }
                            if (score > bestScore) { bestScore = score; best = resC.data[ri2][COL.product_name]; }
                        }
                        if (bestScore >= 1) matched = best;
                    }
                } catch (_) { /* no match for this candidate */ }
            }

            /* Add to results if found and not a duplicate */
            if (matched) {
                var key = matched.toLowerCase().trim();
                if (!seenProducts[key]) {
                    seenProducts[key] = true;
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
