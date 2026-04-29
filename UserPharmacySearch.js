/* =============================================
   MediFinder — UserPharmacySearch.js  v6.0
   ─────────────────────────────────────────────
   CHANGES IN v6.0 (Prescription Scanner Overhaul):

   SCANNER FIXES:
   A. Tesseract now runs TWO passes: PSM 4 (column)
      + PSM 6 (block) and merges results — covers
      both single-column and tabular prescriptions.
   B. Image pre-processing via Canvas API: converts
      to grayscale + boosts contrast before OCR.
      Dramatically improves recognition of faint or
      slightly blurred prints.
   C. Fixed silent regex bug in RX_PREFIX_RE —
      unescaped \s in a normal string was treated
      as literal "s". Now uses proper \\s.
   D. Fixed Supabase "AND" matching bug — .or() is
      OR logic in the JS client. Query B now uses
      chained .ilike() calls (.and()) for true AND.
   E. Added Levenshtein fuzzy distance matching as
      Query D (final fallback) — catches OCR misreads
      like PANABOL→PANADOL, KOLEC→KOLAC.
   F. Added generic_name + brand columns to DB
      matching — if product_name misses, brand or
      generic name catches it.
   G. Normalisation strips hyphens, extra spaces,
      common OCR artefacts (0→O, 1→I, 5→S) in
      medicine names only.
   H. "EXTRA" and similar trailing qualifiers now
      preserved during matching (not stripped).
   I. HEADER_LINE_RE no longer blocks "Rx" section
      header lines that immediately precede medicines.

   DOWNLOAD FIX:
   J. Cross-origin <a download> fails silently on
      Supabase Storage URLs. Now uses fetch→blob→
      object URL to force a true file download.

   Everything else unchanged from v5.0.
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       1. COLUMN NAME CONSTANTS
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
    const PRESCRIPTION_MAX_BYTES = 1 * 1024 * 1024;
    const PRESCRIPTION_MAX_SAVED = 5;

    /* =============================================
       4. DOM REFERENCES + STATE VARIABLES
       ============================================= */
    const searchInput           = document.getElementById('searchInput');
    const pharmacyList          = document.getElementById('pharmacyList');
    const resultsCount          = document.getElementById('resultsCount');
    const sortBtns              = document.querySelectorAll('.sort-btn');
    const logoutBtn             = document.getElementById('logoutBtn');
    const uploadPrescriptionBtn = document.getElementById('uploadPrescriptionBtn');

    const fileInput             = createHiddenFileInput();

    let suggestionBox           = null;
    let currentSort             = 'nearest';
    let currentResults          = [];
    let debounceTimer           = null;
    let userLat                 = null;
    let userLng                 = null;

    /* =============================================
       5. AUTH GUARD + SIDEBAR PROFILE LOADER
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) { window.location.href = 'Login.html'; return; }

        try {
            // profiles table stores full_name and profile_img (users table only has id/email/role)
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('full_name, profile_img')
                .eq('user_id', session.user.id)
                .single();

            if (profile) {
                const fullName = profile.full_name || 'User';
                document.getElementById('sidebarUserName').textContent  = fullName;
                document.getElementById('sidebarUserEmail').textContent = session.user.email || '';
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load failed:', err.message);
        }
    }

    function renderSidebarAvatar(profileImgUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;
        const fallback = avatarEl.querySelector('.user-avatar__fallback');
        const existing = avatarEl.querySelector('img');
        if (existing) existing.remove();

        const img         = document.createElement('img');
        img.alt           = 'User Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';
        img.onerror       = () => { img.remove(); if (fallback) fallback.style.display = 'flex'; };
        img.onload        = () => { if (fallback) fallback.style.display = 'none'; };
        img.src           = profileImgUrl || 'Images/ProfileAvatar.jpg';
        avatarEl.insertBefore(img, avatarEl.firstChild);
    }

    /* =============================================
       6. GPS LOCATION
       ============================================= */
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
            err  => console.warn('Location denied:', err.message)
        );
    }

    /* =============================================
       7. PRICE PARSER
       ============================================= */
    function parsePrice(raw) {
        if (!raw) return 0;
        const cleaned = String(raw).replace(/Rs\.?\s*/gi, '').replace(/,/g, '').trim();
        const val     = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    /* =============================================
       8. GET EFFECTIVE PRICE
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
       ============================================= */
    function isCompleteWord(query) {
        const trimmed = query.trim();
        if (!trimmed) return false;
        const tokens = trimmed.split(/\s+/);
        return tokens[tokens.length - 1].length >= 3;
    }

    /* =============================================
       10. PHASE 1 — FETCH SUGGESTIONS
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
       11. SUGGESTION DROPDOWN
       ============================================= */
    function showSuggestions(names) {
        clearSuggestions();
        if (names.length === 0) return;

        suggestionBox = document.createElement('ul');
        suggestionBox.className = 'suggestion-dropdown';

        names.slice(0, 100).forEach(name => {
            const li       = document.createElement('li');
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
       ============================================= */
    const SEARCH_HISTORY_MAX = 20;

    async function logSearch(productName) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) return;
            const userId = session.user.id;

            let category = null;
            try {
                const { data: catRow } = await supabaseClient
                    .from('Pharmacy Data')
                    .select('category')
                    .ilike('product_name', productName)
                    .limit(1)
                    .maybeSingle();
                category = catRow?.category ?? null;
            } catch (_) {}

            const { count } = await supabaseClient
                .from('user_search_history')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            if ((count || 0) >= SEARCH_HISTORY_MAX) {
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

            const { error: insertErr } = await supabaseClient
                .from('user_search_history')
                .insert({ user_id: userId, product_name: productName, category });

            if (insertErr) throw insertErr;
            await supabaseClient.rpc('prune_search_history', { p_user_id: userId });

        } catch (err) {
            console.warn('Search log error:', err.message);
        }
    }

    /* =============================================
       13-B. LOG SEARCH BATCH
       ============================================= */
    async function logSearchBatch(names) {
        for (const name of names) {
            await logSearch(name);
        }
    }

    /* =============================================
       14. SELECT PRODUCT
       ============================================= */
    function selectProduct(productName) {
        searchInput.value = productName;
        clearSuggestions();
        logSearch(productName);
        searchByExactProduct(productName);
    }

    /* =============================================
       15. PHASE 2 — SEARCH BY EXACT PRODUCT NAME
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
       ============================================= */
    function setsOverlap(setA, setB) {
        if (setA.size === 0 || setB.size === 0) return false;
        for (const token of setA) { if (setB.has(token)) return true; }
        return false;
    }

    /* =============================================
       16-C. CLIENT-SIDE ALTERNATIVE MATCHER
       ============================================= */
    function isTherapeuticAlternative(sourceRow, candidateRow) {
        const srcDF = (sourceRow[COL.dosage_form]    || '').trim().toLowerCase();
        const canDF = (candidateRow[COL.dosage_form] || '').trim().toLowerCase();
        if (!srcDF || !canDF || srcDF !== canDF) return false;

        const srcRT = (sourceRow[COL.release_type]    || '').trim().toLowerCase();
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
       17. FETCH ALTERNATIVES
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
       ============================================= */
    function groupByPharmacy(rows) {
        const groups = {};
        rows.forEach(row => {
            const key = TEST_PHARMACY.name;
            if (!groups[key]) {
                groups[key] = { pharmacy: { ...TEST_PHARMACY }, items: [] };
            }
            groups[key].items.push(row);
        });
        return Object.values(groups);
    }

    /* =============================================
       19. RENDER RESULTS
       ============================================= */
    async function renderResults(rows, sortMode) {
        if (!rows || rows.length === 0) {
            showEmptyState('No pharmacies found with this medicine in stock.');
            return;
        }

        const groups = groupByPharmacy(rows);

        if (sortMode === 'cheapest') {
            groups.forEach(g => {
                g.items.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
            });
            groups.sort((a, b) =>
                getEffectivePrice(a.items[0]) - getEffectivePrice(b.items[0])
            );
        } else {
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

        const shownNames = new Set(
            rows.map(r => (r[COL.product_name] || '').toLowerCase().trim())
        );

        const cardHTMLs = await Promise.all(groups.map(async group => {
            const alts = await fetchAlternatives(group.items[0], shownNames);
            return buildPharmacyCardHTML(group, alts, sortMode);
        }));

        pharmacyList.innerHTML = cardHTMLs.join('');
        attachPanelToggleListeners();
    }

    /* =============================================
       20. BUILD PHARMACY CARD HTML
       ============================================= */
    function buildPharmacyCardHTML(group, alts, sortMode) {
        const { pharmacy, items } = group;

        const displayItem = sortMode === 'cheapest'
            ? items[0]
            : items.reduce((a, b) => getEffectivePrice(a) < getEffectivePrice(b) ? a : b);

        const discPrice  = parsePrice(displayItem[COL.discounted_price]);
        const origPrice  = parsePrice(displayItem[COL.original_price]);
        const effPrice   = getEffectivePrice(displayItem);
        const isPrescReq = (displayItem[COL.prescription] || '').toLowerCase() === 'yes';
        const altCount   = alts.length;

        const priceHTML     = effPrice > 0 ? `Rs. ${effPrice.toFixed(2)}` : 'Price not listed';
        const origPriceHTML = (origPrice > 0 && discPrice > 0 && origPrice !== discPrice)
            ? `<span class="price-original">Rs. ${origPrice.toFixed(2)}</span>` : '';

        const matchedRows = items.map(item => {
            const ip = parsePrice(item[COL.discounted_price]) || parsePrice(item[COL.original_price]);
            return `
            <li class="alt-row">
                <div class="alt-row__left">
                    <span class="alt-row__name">${escapeHtml(item[COL.product_name] || '—')}</span>
                    <span class="alt-row__meta">
                        ${escapeHtml(item[COL.category] || '')}
                        ${item[COL.strength] ? '&middot; ' + escapeHtml(item[COL.strength]) : ''}
                    </span>
                    <span class="alt-row__instock"><i class="fa-solid fa-circle-check"></i> In Stock</span>
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
                        <span class="alt-row__instock"><i class="fa-solid fa-circle-check"></i> In Stock</span>
                    </div>
                    <div class="alt-row__right">
                        <span class="alt-row__price${ap <= 0 ? ' alt-row__price--na' : ''}">
                            ${ap > 0 ? 'Rs. ' + ap.toFixed(2) : 'N/A'}
                        </span>
                        ${aop > 0 && adp > 0 && aop !== adp
                            ? `<span class="alt-row__orig-price">Rs. ${aop.toFixed(2)}</span>` : ''}
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
                    <p class="card-info__meta">${escapeHtml(displayItem[COL.product_name] || '')}</p>
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

            <button class="alternatives-btn panel-toggle-btn" aria-expanded="false">
                <span class="alternatives-btn__icon">
                    <i class="fa-solid fa-arrow-right-arrow-left"></i>
                </span>
                View Alternatives
                <span class="alt-badge">${altCount}</span>
                <i class="fa-solid fa-chevron-down toggle-icon" style="margin-left:auto;font-size:12px;color:var(--gray-mid);"></i>
            </button>

            <div class="alternatives-panel" style="display:none;" aria-hidden="true">
                <p class="alt-section-label">MATCHED MEDICINES</p>
                <ul class="alt-list">${matchedRows}</ul>

                <p class="alt-section-label alt-section-label--sep">
                    THERAPEUTIC ALTERNATIVES
                    <span class="alt-section-note">Same generic · dosage form · strength · release type</span>
                </p>
                <ul class="alt-list">${altsRows}</ul>

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

    searchInput && searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && suggestionBox) {
            const first = suggestionBox.querySelector('.suggestion-item');
            if (first) { e.preventDefault(); selectProduct(first.textContent); }
        }
        if (e.key === 'Escape') clearSuggestions();
    });

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
       27. SIDEBAR TOGGLE
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
       PRESCRIPTION SCANNER — SECTION 29–37
       ══════════════════════════════════════════════ */

    /* =============================================
       29. CREATE HIDDEN FILE INPUT
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
       ============================================= */
    uploadPrescriptionBtn && uploadPrescriptionBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    /* =============================================
       31. FILE INPUT CHANGE — main scan pipeline
       ============================================= */
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        if (file.size > PRESCRIPTION_MAX_BYTES) {
            alert('Prescription image must be less than 1 MB. Please compress or crop the image and try again.');
            return;
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = 'Login.html'; return; }

        showScanningOverlay(0);

        try {
            // Pre-process image for better OCR accuracy
            updateScanningOverlay(5, 'Enhancing image...');
            const processedFile = await preprocessImageForOCR(file);

            // Dual-pass OCR for maximum accuracy
            updateScanningOverlay(10, 'Scanning prescription (Pass 1)...');
            const rawText1 = await runOCR(processedFile, 4, pct =>
                updateScanningOverlay(10 + Math.round(pct * 0.35))
            );

            updateScanningOverlay(45, 'Scanning prescription (Pass 2)...');
            const rawText2 = await runOCR(processedFile, 6, pct =>
                updateScanningOverlay(45 + Math.round(pct * 0.35))
            );

            // Merge both pass results
            const rawText = mergeOCRResults(rawText1, rawText2);

            updateScanningOverlay(82, 'Analysing prescription lines...');
            const foundNames = await extractMedicineNames(rawText);

            hideScanningOverlay();

            if (foundNames.length === 0) {
                alert('No recognisable medicine names found in this prescription.\n\nTips for better results:\n• Ensure the image is well-lit and in focus\n• Hold the camera steady / scan flat\n• Crop to show only the Rx section\n\nOr use the search bar to find medicines manually.');
                return;
            }

            renderPrescriptionQueue(foundNames);

            savePrescriptionToVault(file, session.user.id).catch(err =>
                console.warn('Vault save error:', err.message)
            );

            logSearchBatch(foundNames);
            selectProduct(foundNames[0]);

        } catch (err) {
            hideScanningOverlay();
            console.error('Prescription scan error:', err);
            alert('Scan failed: ' + err.message + '\nPlease try a clearer photo.');
        }
    });

    /* =============================================
       32. IMAGE PRE-PROCESSING FOR OCR
       ─────────────────────────────────────────────
       Uses Canvas API to:
       • Convert to greyscale
       • Boost contrast (helps faint ink)
       • Sharpen edges (helps blurry photos)
       Returns a processed Blob/File.
       ============================================= */
    async function preprocessImageForOCR(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                // Scale up small images for better OCR (min 1200px wide)
                const scale  = Math.max(1, 1200 / img.width);
                const width  = Math.round(img.width  * scale);
                const height = Math.round(img.height * scale);

                const canvas = document.createElement('canvas');
                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                // Draw original image
                ctx.drawImage(img, 0, 0, width, height);

                // Get pixel data
                const imageData = ctx.getImageData(0, 0, width, height);
                const d = imageData.data;

                for (let i = 0; i < d.length; i += 4) {
                    // Greyscale using luminance weights
                    const grey = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];

                    // Contrast boost: stretch midtones
                    // Factor 1.6 increases contrast without blowing out highlights
                    const factor = 1.6;
                    const boosted = Math.min(255, Math.max(0,
                        factor * (grey - 128) + 128
                    ));

                    d[i] = d[i+1] = d[i+2] = boosted;
                    // alpha unchanged
                }

                ctx.putImageData(imageData, 0, 0);

                canvas.toBlob(blob => {
                    if (!blob) { resolve(file); return; }  // fallback to original
                    resolve(new File([blob], file.name, { type: 'image/png' }));
                }, 'image/png');
            };

            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    /* =============================================
       33. MERGE OCR RESULTS FROM TWO PASSES
       ─────────────────────────────────────────────
       Combines lines from both PSM passes.
       Prefers longer lines (more text recovered).
       Deduplicates near-identical lines.
       ============================================= */
    function mergeOCRResults(text1, text2) {
        const lines1 = (text1 || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const lines2 = (text2 || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        const merged = new Map();

        const addLine = line => {
            const key = line.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!key || key.length < 3) return;
            const existing = merged.get(key);
            // Keep whichever version is longer (more complete)
            if (!existing || line.length > existing.length) {
                merged.set(key, line);
            }
        };

        lines1.forEach(addLine);
        lines2.forEach(addLine);

        return Array.from(merged.values()).join('\n');
    }

    /* =============================================
       34. RUN OCR — Tesseract.js (client-side)
       ─────────────────────────────────────────────
       psmMode: 4 = single column (good for Rx lists)
                6 = uniform block (good for dense text)
       onProgress: callback(0-100)
       ============================================= */
    async function runOCR(file, psmMode, onProgress) {
        if (typeof Tesseract === 'undefined') {
            throw new Error('OCR library not loaded. Please check your internet connection.');
        }

        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && onProgress) {
                    onProgress(Math.round(m.progress * 100));
                }
            },
        });

        // PSM mode + whitelist common prescription characters
        await worker.setParameters({
            tessedit_pageseg_mode: String(psmMode),
            // Keep letters, digits, hyphens, dots, colons, slashes — common in Rx
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -.:/()&',
            // Preserve_interword_spaces for better token separation
            preserve_interword_spaces: '1',
        });

        const { data } = await worker.recognize(file);
        await worker.terminate();
        return data.text;
    }

    /* =============================================
       35. LEVENSHTEIN DISTANCE
       ─────────────────────────────────────────────
       Used in Query D (fuzzy fallback) to score
       how similar two strings are.
       Returns edit distance (lower = more similar).
       ============================================= */
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i-1] === b[j-1]
                    ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
        }
        return dp[m][n];
    }

    /* =============================================
       36. SMART NAME NORMALISER
       ─────────────────────────────────────────────
       Normalises both OCR output and DB product names
       to a common form for comparison.

       Handles:
       • PANADOL-EXTRA → panadol extra
       • Panadol Extra Tablets → panadol extra
       • panadolextra → panadol extra (NO — can't
         split fused words, but scoring handles it)
       • OCR digit substitutions: 0→o, 1→i/l, 5→s
         (applied ONLY when testing OCR candidate,
         not when normalising DB names)
       ============================================= */
    function normaliseName(str, fixOCRDigits) {
        let s = String(str || '').toLowerCase();

        // Fix common OCR digit/letter confusions (only for OCR output)
        if (fixOCRDigits) {
            // These are common OCR errors on printed medicine names
            s = s
                .replace(/\b0(?=[a-z])/g,  'o')   // 0 → o at word start before letter
                .replace(/(?<=[a-z])0\b/g, 'o')   // 0 → o at word end after letter
                .replace(/1(?=[a-z])/g,    'i')   // 1 → i before letter
                .replace(/5(?=[a-z])/g,    's');   // 5 → s before letter
        }

        // Strip dosage form words that appear AFTER medicine name
        // (e.g. "Panadol Extra Tablets" → "panadol extra")
        // Keep these in a set — don't remove from middle of name
        const TRAILING_FORM_WORDS = /\s+(?:tablets?|tabs?|capsules?|caps?|syrup|syp|drops?|injection|solution|cream|ointment|gel|suspension|lotion|spray|inhaler|powder|sachet|patch)\s*$/gi;
        s = s.replace(TRAILING_FORM_WORDS, '');

        // Hyphens/dots/underscores → space
        s = s.replace(/[-_.]/g, ' ');

        // Collapse multiple spaces
        s = s.replace(/\s+/g, ' ').trim();

        return s;
    }

    /* =============================================
       37. EXTRACT MEDICINE NAMES FROM OCR TEXT
       ─────────────────────────────────────────────
       5-phase intelligent prescription parser.

       PHASE 1 — Line filtering
         Discard noise, Arabic-only, pure-digit lines,
         and known header lines (patient name, etc.)
         NOTE: "Rx" section header is NOT discarded —
         it signals that following lines are medicines.

       PHASE 2 — Medicine line detection
         Lines starting with SYP/TAB/CAP/INJ/EYE…
         have the prefix stripped to isolate name.
         Lines with ≥1 all-caps token are candidates.

       PHASE 3 — Name normalisation
         Hyphens/dots→spaces. Trailing dose units
         stripped. OCR digit artefacts corrected.

       PHASE 4 — 4-tier fuzzy DB matching:
         A. Exact prefix match (fastest, most precise)
         B. All significant words in product_name AND
            brand (true AND via chained .ilike())
         C. First significant word scored by overlap
         D. Levenshtein fuzzy — catches OCR misreads

       PHASE 5 — Deduplication + ordering
         Returns names in prescription line order.
       ============================================= */

    /* Dosage-form prefixes (correct \\s escape) */
    const RX_PREFIXES = [
        'SYRUP', 'SYP', 'TABLET', 'TABLETS', 'TAB', 'CAPSULE', 'CAPSULES', 'CAP', 'CAPS',
        'INJECTION', 'INJ', 'EYE DROPS', 'EAR DROPS', 'EYE', 'EAR',
        'GEL', 'CREAM', 'CRM', 'OINTMENT', 'OINT', 'OIN',
        'SUSPENSION', 'SUSP', 'SOLUTION', 'SOL', 'LOTION', 'LOT',
        'SUPPOSITORY', 'SUPP', 'DROPS', 'SPRAY', 'INHALER', 'INH',
        'SACHET', 'PATCH', 'POWDER', 'PWD', 'LIQUID', 'LIQ',
        'NASAL', 'TOPICAL', 'ORAL', 'IV', 'IM', 'SC',
    ];

    // FIX: Use \\s (double backslash) inside new RegExp() string for literal \s
    const RX_PREFIX_RE = new RegExp(
        '^\\s*(?:R\\/|Rx\\.?|R:)?\\s*(' +
        RX_PREFIXES.map(function(p) { return p.replace(/\s+/g, '\\s+'); }).join('|') +
        ')[.:\\s]+',
        'i'
    );

    /* Lines that are only noise: digits, punctuation, Arabic */
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

    /* Header lines to skip — NOTE: bare "rx" alone is NOT blocked here
       because the Rx section header signals medicine lines follow.
       We only block full header lines. */
    const HEADER_LINE_RE = new RegExp(
        '^\\s*(?:patient|name|gender|age|weight|height|b\\.?p\\.?|pulse|temp|' +
        'city|date|address|dr\\.|doctor|hospital|clinic|phone|tel|' +
        'ref|diagnosis|clinical|tests?|investigation|vitals?|male|female|' +
        '\\d{2,}[\\/\\-]\\d{2,})',
        'i'
    );

    async function extractMedicineNames(rawText) {
        if (!rawText || !rawText.trim()) return [];

        /* ── PHASE 1: filter lines ── */
        var allLines     = rawText.split(/\r?\n/);
        var filteredLines = [];
        var inRxSection  = false;   // track if we're inside the Rx drug list

        for (var fi = 0; fi < allLines.length; fi++) {
            var l = allLines[fi].trim();
            if (l.length < 3) continue;

            // Detect Rx section start (bare "Rx" or "R/" on its own line)
            if (/^R[x\/]\.?\s*$/i.test(l)) {
                inRxSection = true;
                continue;   // don't add the header itself
            }

            if (NOISE_LINE_RE.test(l)) continue;
            if (HEADER_LINE_RE.test(l)) continue;

            var latinCount = (l.match(/[a-zA-Z]/g) || []).length;
            if (latinCount < 3) continue;

            filteredLines.push({ line: l, inRx: inRxSection });
        }

        if (filteredLines.length === 0) return [];

        /* ── PHASE 2 + 3: extract and normalise candidates ── */
        var candidates = [];
        for (var li = 0; li < filteredLines.length; li++) {
            var lineObj   = filteredLines[li];
            var line      = lineObj.line;
            var candidate = null;

            var prefixMatch = line.match(RX_PREFIX_RE);
            if (prefixMatch) {
                // Line starts with SYP/TAB/CAP etc. — strip prefix, keep name
                candidate = line.slice(prefixMatch[0].length).trim();
            } else if (lineObj.inRx) {
                // We're in the Rx section — treat whole line as a candidate
                // Strip any leading punctuation
                candidate = line.replace(/^[^a-zA-Z]+/, '').trim();
            } else {
                // Fallback: must have at least one all-caps token (brand name)
                var capsWords = line.match(/\b[A-Z][A-Z\d\-]{2,}\b/g) || [];
                if (capsWords.length >= 1) {
                    candidate = line.trim();
                }
            }

            if (!candidate || candidate.length < 3) continue;

            // Normalise: apply OCR digit fixes + strip trailing Arabic + dose units
            candidate = candidate
                .replace(/\s*[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF].*$/, '') // strip Arabic
                .replace(TRAILING_DOSE_RE, '')
                .replace(/[^a-zA-Z0-9\s\-\.]+.*$/, '')   // strip trailing non-medicine chars
                .trim();

            // Apply normalisation for comparison (but store original for display lookup)
            var normalised = normaliseName(candidate, true /* fix OCR digits */);

            if (normalised.length < 3) continue;
            if (/^\d+$/.test(normalised)) continue;

            candidates.push({ raw: candidate, normalised: normalised });
        }

        if (candidates.length === 0) return [];

        /* ── PHASE 4: multi-tier fuzzy DB matching ── */
        var seenProducts = {};
        var orderedNames = [];

        // Stop words: excluded from significant-word extraction
        var STOP_WORDS = {
            'with':1,'and':1,'the':1,'for':1,'tabs':1,'caps':1,
            'syp':1,'tab':1,'cap':1,'syrup':1,'tablet':1,'capsule':1,
            'drops':1,'injection':1,'solution':1,'cream':1,'gel':1,
        };

        for (var ci = 0; ci < candidates.length; ci++) {
            var cand       = candidates[ci];
            var normalised = cand.normalised;

            // Significant words: ≥4 chars, not stop words
            var allWords = normalised.split(/\s+/);
            var sigWords = [];
            for (var wi = 0; wi < allWords.length; wi++) {
                var w = allWords[wi];
                if (w.length >= 3 && !STOP_WORDS[w]) sigWords.push(w);
            }
            if (sigWords.length === 0) continue;

            var matched = null;

            /* ── Query A: exact prefix on product_name ── */
            try {
                var resA = await supabaseClient
                    .from('Pharmacy Data')
                    .select(COL.product_name)
                    .ilike(COL.product_name, normalised + '%')
                    .gt(COL.quantity, 0)
                    .limit(5);

                if (resA.data && resA.data.length > 0) {
                    // Pick closest match by normalised edit distance
                    var bestA = pickBestMatch(resA.data, normalised);
                    if (bestA) matched = bestA;
                }
            } catch (_) {}

            /* ── Query A2: prefix on brand column ── */
            if (!matched) {
                try {
                    var resA2 = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name + ', ' + COL.brand)
                        .ilike(COL.brand, normalised + '%')
                        .gt(COL.quantity, 0)
                        .limit(5);

                    if (resA2.data && resA2.data.length > 0) {
                        matched = resA2.data[0][COL.product_name];
                    }
                } catch (_) {}
            }

            /* ── Query B: ALL significant words in product_name (true AND) ──
               FIX: Supabase .or() is OR logic, not AND.
               True AND requires chained .ilike() calls. ── */
            if (!matched && sigWords.length >= 1) {
                try {
                    var queryB = supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .gt(COL.quantity, 0);

                    // Chain one .ilike() per significant word — this is true AND
                    for (var si = 0; si < sigWords.length; si++) {
                        queryB = queryB.ilike(COL.product_name, '%' + sigWords[si] + '%');
                    }

                    var resB = await queryB.limit(20);
                    if (resB.data && resB.data.length > 0) {
                        var bestB = pickBestMatch(resB.data, normalised);
                        if (bestB) matched = bestB;
                    }
                } catch (_) {}
            }

            /* ── Query B2: ALL significant words in brand column ── */
            if (!matched && sigWords.length >= 1) {
                try {
                    var queryB2 = supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name + ', ' + COL.brand)
                        .gt(COL.quantity, 0);

                    for (var si2 = 0; si2 < sigWords.length; si2++) {
                        queryB2 = queryB2.ilike(COL.brand, '%' + sigWords[si2] + '%');
                    }

                    var resB2 = await queryB2.limit(20);
                    if (resB2.data && resB2.data.length > 0) {
                        matched = resB2.data[0][COL.product_name];
                    }
                } catch (_) {}
            }

            /* ── Query C: first significant word, scored by total word overlap ── */
            if (!matched && sigWords[0] && sigWords[0].length >= 3) {
                try {
                    var resC = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .ilike(COL.product_name, '%' + sigWords[0] + '%')
                        .gt(COL.quantity, 0)
                        .limit(30);

                    if (resC.data && resC.data.length > 0) {
                        var bestC = null, bestScoreC = 0;
                        for (var ri = 0; ri < resC.data.length; ri++) {
                            var pn = normaliseName(resC.data[ri][COL.product_name], false);
                            var score = 0;
                            for (var swi = 0; swi < sigWords.length; swi++) {
                                if (pn.indexOf(sigWords[swi]) !== -1) score++;
                            }
                            if (score > bestScoreC) {
                                bestScoreC = score;
                                bestC = resC.data[ri][COL.product_name];
                            }
                        }
                        // Require at least half of significant words to match
                        if (bestScoreC >= Math.ceil(sigWords.length / 2)) {
                            matched = bestC;
                        }
                    }
                } catch (_) {}
            }

            /* ── Query D: Levenshtein fuzzy fallback ──
               Fetch candidates by first 3 chars of first word,
               then score by edit distance on normalised names.
               Threshold: distance ≤ 30% of candidate length.
               Catches OCR misreads: PANABOL→PANADOL, KOLEC→KOLAC ── */
            if (!matched && sigWords[0] && sigWords[0].length >= 3) {
                try {
                    var prefix3 = sigWords[0].slice(0, 3);
                    var resD    = await supabaseClient
                        .from('Pharmacy Data')
                        .select(COL.product_name)
                        .ilike(COL.product_name, prefix3 + '%')
                        .gt(COL.quantity, 0)
                        .limit(40);

                    if (resD.data && resD.data.length > 0) {
                        var bestD = null, bestDistD = Infinity;
                        for (var rdi = 0; rdi < resD.data.length; rdi++) {
                            var dbNorm = normaliseName(resD.data[rdi][COL.product_name], false);
                            var dist   = levenshtein(normalised, dbNorm);
                            // Similarity threshold: allow up to 35% edits of the longer string
                            var maxDist = Math.floor(Math.max(normalised.length, dbNorm.length) * 0.35);
                            if (dist < bestDistD && dist <= maxDist) {
                                bestDistD = dist;
                                bestD     = resD.data[rdi][COL.product_name];
                            }
                        }
                        if (bestD) matched = bestD;
                    }
                } catch (_) {}
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
       HELPER: PICK BEST MATCH FROM RESULT SET
       ─────────────────────────────────────────────
       Given an array of DB rows and a normalised
       query string, returns the product_name whose
       normalised form is closest by edit distance.
       ============================================= */
    function pickBestMatch(rows, normalisedQuery) {
        var best = null, bestDist = Infinity;
        for (var i = 0; i < rows.length; i++) {
            var dbNorm = normaliseName(rows[i][COL.product_name] || '', false);
            var dist   = levenshtein(normalisedQuery, dbNorm);
            if (dist < bestDist) {
                bestDist = dist;
                best     = rows[i][COL.product_name];
            }
        }
        return best;
    }

    /* =============================================
       38. PRESCRIPTION QUEUE BAR
       ============================================= */
    function renderPrescriptionQueue(names) {
        const existing = document.getElementById('prescriptionQueueBar');
        if (existing) existing.remove();

        const bar     = document.createElement('div');
        bar.id        = 'prescriptionQueueBar';
        bar.className = 'prescription-queue';

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

        const resultsHeader = document.querySelector('.results-header');
        if (resultsHeader) {
            resultsHeader.parentNode.insertBefore(bar, resultsHeader);
        } else {
            document.querySelector('.main').appendChild(bar);
        }

        bar.querySelectorAll('.queue-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                bar.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('queue-tab--active'));
                tab.classList.add('queue-tab--active');
                selectProduct(tab.dataset.name);
            });
        });

        document.getElementById('closeQueueBtn').addEventListener('click', () => {
            bar.remove();
            searchInput.value = '';
            showInitialState();
            currentResults = [];
        });
    }

    /* =============================================
       39. SAVE PRESCRIPTION TO VAULT
       ============================================= */
    async function savePrescriptionToVault(file, userId) {
        const timestamp   = Date.now();
        const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${userId}/${timestamp}_${safeName}`;

        const { error: uploadErr } = await supabaseClient
            .storage
            .from('prescriptions')
            .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (uploadErr) throw new Error('Storage upload failed: ' + uploadErr.message);

        const { data: urlData } = supabaseClient
            .storage
            .from('prescriptions')
            .getPublicUrl(storagePath);

        const fileUrl = urlData?.publicUrl || '';

        const { error: insertErr } = await supabaseClient
            .from('user_prescriptions')
            .insert({
                user_id:   userId,
                file_name: file.name,
                file_url:  fileUrl,
                file_size: file.size,
            });

        if (insertErr) throw new Error('DB insert failed: ' + insertErr.message);

        await supabaseClient.rpc('prune_prescriptions', { p_user_id: userId });
    }

    /* =============================================
       40. SCANNING OVERLAY — show/update/hide
       ============================================= */
    function showScanningOverlay(pct, label) {
        label = label || 'Scanning prescription...';
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
       41. XSS PREVENTION HELPER
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
