/* =============================================
   MediFinder — UserPharmacySearch.js  v2.0
   ─────────────────────────────────────────────
   EXECUTION ORDER ON PAGE LOAD:
   1.  COL constants        — column name map
   2.  TEST_PHARMACY        — placeholder pharmacy
   3.  DOM refs + state     — variables
   4.  initPage()           — auth guard + sidebar
   5.  GPS request          — background, non-blocking
   6.  searchMedicines()    — called on user input
   7.  fetchAlternatives()  — called per matched item
   8.  groupByPharmacy()    — groups rows into cards
   9.  sortPharmacies()     — nearest or cheapest
   10. renderResults()      — orchestrates 8+9+card build
   11. buildPharmacyCard()  — main card HTML builder
   12. buildMedicineRow()   — matched item row HTML
   13. buildAlternativeRow()— alternative item row HTML
   14. Helpers              — price, distance, rx utils
   15. UI state helpers     — initial/loading/empty/error
   16. attachPanelToggle()  — expand/collapse listeners
   17. Sort button events   — re-sort without re-query
   18. Search input event   — 400ms debounced trigger
   19. Logout event
   20. Sidebar toggle       — mobile hamburger
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       1. COLUMN NAME CONSTANTS
       ─────────────────────────────────────────────
       Maps friendly names to exact Supabase column
       names from your "Pharmacy Data" table.
       Update ONLY here if you rename any column.
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
       Placeholder used during single-pharmacy testing.
       Your current dataset is a medicine catalogue —
       not per-pharmacy — so this fills in the blanks.

       FUTURE: When real pharmacies connect and have
       a pharmacy_name / pharmacy_phone column in the
       dataset, replace TEST_PHARMACY references with
       row['pharmacy_name'] etc. inside groupByPharmacy().
       ============================================= */
    const TEST_PHARMACY = {
        name:  'MediFinder Test Pharmacy',
        phone: '+92 300 0000000',
        lat:   24.8607,   // Karachi latitude
        lng:   67.0011,   // Karachi longitude
    };

    /* =============================================
       3. DOM REFERENCES + STATE VARIABLES
       ============================================= */
    const searchInput  = document.getElementById('searchInput');
    const pharmacyList = document.getElementById('pharmacyList');
    const resultsCount = document.getElementById('resultsCount');
    const sortBtns     = document.querySelectorAll('.sort-btn');
    const logoutBtn    = document.getElementById('logoutBtn');

    let currentSort    = 'nearest'; // active sort mode
    let currentResults = [];        // cached Supabase rows (avoids re-query on sort)
    let debounceTimer  = null;      // setTimeout handle for search debounce
    let userLat        = null;      // GPS latitude (null if denied)
    let userLng        = null;      // GPS longitude (null if denied)

    /* =============================================
       4. AUTH GUARD + SIDEBAR PROFILE LOADER
       ─────────────────────────────────────────────
       • No session  → redirect to Login.html
       • Session OK  → load first_name + last_name
                        from "users" table → sidebar
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error || !session) {
            window.location.href = 'Login.html';
            return;
        }

        try {
            const { data: profile } = await supabaseClient
                .from('users')
                .select('first_name, last_name')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                document.getElementById('sidebarUserName').textContent  = fullName || 'User';
                document.getElementById('sidebarUserEmail').textContent = session.user.email || '';
            }
        } catch (err) {
            // Non-critical — sidebar shows "Loading..." fallback
            console.warn('Profile load failed:', err.message);
        }
    }

    /* =============================================
       5. GPS LOCATION (background, non-blocking)
       ─────────────────────────────────────────────
       Runs in background as page loads.
       Sets userLat/userLng for Nearest sort.
       If denied → Nearest sort keeps Supabase order.
       ============================================= */
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLat = pos.coords.latitude;
                userLng = pos.coords.longitude;
            },
            err => console.warn('Location denied:', err.message)
        );
    }

    /* =============================================
       6. SEARCH FUNCTION
       ─────────────────────────────────────────────
       Called 400ms after user stops typing.
       • Searches 5 columns (case-insensitive ilike)
       • Filters: quantity > 0 (in-stock only)
       • Selects ONLY displayed columns (lean query —
         skips heavy text: how_it_works, warnings etc.)
       • limit(200) handles future multi-pharmacy scale
       ============================================= */
    async function searchMedicines(query) {
        query = query.trim();

        if (query.length < 2) {
            showInitialState();
            return;
        }

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
                .or([
                    `${COL.product_name}.ilike.%${query}%`,
                    `${COL.brand}.ilike.%${query}%`,
                    `${COL.category}.ilike.%${query}%`,
                    `${COL.generic_name}.ilike.%${query}%`,
                    `${COL.used_for}.ilike.%${query}%`,
                ].join(','))
                .gt(COL.quantity, 0)
                .limit(200);

            if (error) throw error;

            currentResults = data || [];
            renderResults(currentResults, currentSort);

        } catch (err) {
            console.error('Search error:', err.message);
            showErrorState('Search failed. Check your connection and try again.');
        }
    }

    /* =============================================
       7. FETCH ALTERNATIVES (per searched item)
       ─────────────────────────────────────────────
       Finds therapeutically equivalent products by
       matching ALL 4 fields EXACTLY:
         generic_name  — same active ingredient
         dosage_form   — same form (tablet, syrup…)
         strength      — same dose (500mg, 10mg…)
         release_type  — same release (immediate, ER…)

       Excludes the original product by product_name.
       Only returns in-stock items (quantity > 0).
       Returns [] if any matching field is missing
       or if no alternatives exist.
       ============================================= */
    async function fetchAlternatives(row) {
        const gn = row[COL.generic_name];
        const df = row[COL.dosage_form];
        const st = row[COL.strength];
        const rt = row[COL.release_type];

        // All 4 fields must be present for a meaningful match
        if (!gn || !df || !st || !rt) return [];

        try {
            const { data, error } = await supabaseClient
                .from('Pharmacy Data')
                .select([
                    COL.product_name,
                    COL.brand,
                    COL.category,
                    COL.strength,
                    COL.dosage_form,
                    COL.release_type,
                    COL.discounted_price,
                    COL.original_price,
                    COL.quantity,
                    COL.prescription,
                ].join(', '))
                .eq(COL.generic_name, gn)   // exact match
                .eq(COL.dosage_form,  df)   // exact match
                .eq(COL.strength,     st)   // exact match
                .eq(COL.release_type, rt)   // exact match
                .neq(COL.product_name, row[COL.product_name]) // exclude self
                .gt(COL.quantity, 0)        // in stock only
                .limit(10);

            if (error) throw error;
            return data || [];

        } catch (err) {
            console.warn('Alternatives fetch error:', err.message);
            return [];
        }
    }

    /* =============================================
       8. GROUP RESULTS BY PHARMACY
       ─────────────────────────────────────────────
       RIGHT NOW: All rows → single TEST_PHARMACY card.

       FUTURE: Replace `TEST_PHARMACY.name` with
       `row['pharmacy_name']` to auto-group rows from
       multiple pharmacies into separate cards.
       No other changes needed here.
       ============================================= */
    function groupByPharmacy(rows) {
        const map = {};

        rows.forEach(row => {
            const key = TEST_PHARMACY.name; // FUTURE: row['pharmacy_name']

            if (!map[key]) {
                map[key] = {
                    name:        TEST_PHARMACY.name,  // FUTURE: row['pharmacy_name']
                    phone:       TEST_PHARMACY.phone, // FUTURE: row['pharmacy_phone']
                    lat:         TEST_PHARMACY.lat,   // FUTURE: row['pharmacy_lat']
                    lng:         TEST_PHARMACY.lng,   // FUTURE: row['pharmacy_lng']
                    items:       [],
                    lowestPrice: Infinity,
                    lowestOrig:  Infinity,
                };
            }

            map[key].items.push(row);

            const eff  = getEffectivePrice(row);
            const orig = parseFloat(row[COL.original_price] || 0);
            if (eff  > 0 && eff  < map[key].lowestPrice) map[key].lowestPrice = eff;
            if (orig > 0 && orig < map[key].lowestOrig)  map[key].lowestOrig  = orig;
        });

        return Object.values(map);
    }

    /* =============================================
       9. SORT PHARMACIES
       ─────────────────────────────────────────────
       cheapest → sort by lowestPrice ascending
       nearest  → sort by GPS distance ascending
                  (skips if user denied location)
       ============================================= */
    function sortPharmacies(pharmacies, sortMode) {
        if (sortMode === 'cheapest') {
            return [...pharmacies].sort((a, b) => a.lowestPrice - b.lowestPrice);
        }
        if (userLat !== null && userLng !== null) {
            return [...pharmacies]
                .map(p => ({
                    ...p,
                    distance: (p.lat && p.lng)
                        ? getDistanceKm(userLat, userLng, p.lat, p.lng)
                        : 9999,
                }))
                .sort((a, b) => a.distance - b.distance);
        }
        return pharmacies; // no GPS → original order
    }

    /* =============================================
       10. RENDER RESULTS
       ─────────────────────────────────────────────
       Orchestrates: group → sort → build cards →
       inject into DOM → attach toggle listeners.
       Uses Promise.all so all alternatives are
       fetched in parallel (fast even with many items).
       ============================================= */
    async function renderResults(rows, sortMode) {
        if (rows.length === 0) {
            showEmptyState('No medicines found in stock matching your search.');
            return;
        }

        const pharmacies = sortPharmacies(groupByPharmacy(rows), sortMode);
        const count      = pharmacies.length;

        resultsCount.innerHTML =
            `Found <strong>${count} ${count === 1 ? 'pharmacy' : 'pharmacies'}</strong> ` +
            `with <strong>${rows.length} matching item${rows.length !== 1 ? 's' : ''}</strong> in stock`;

        // Build all pharmacy cards (alternatives fetched in parallel inside)
        const cardHTMLs = await Promise.all(pharmacies.map(p => buildPharmacyCard(p)));
        pharmacyList.innerHTML = cardHTMLs.join('');

        attachPanelToggleListeners();
    }

    /* =============================================
       11. BUILD PHARMACY CARD
       ─────────────────────────────────────────────
       CARD LAYOUT (updated per requirements):

       ┌──────────────────────────────────────────┐
       │ [In Stock]  Pharmacy Name  [✓ Verified]  │
       │             Product Name                 │
       │             Category · Strength          │
       │             [Rx Required] or [OTC]       │
       │             📞 Phone number              │
       │                          Rs.XX  Rs.YY~~  │
       ├──────────────────────────────────────────│
       │  [ View Alternatives ▼ ]                 │
       ├──────────────────────────────────────────│
       │  Matched Medicines                       │
       │    Product · Category · Str  ✓ In Stock  │
       │    Rs.XX  ~~Rs.YY~~                      │
       │  ─────────────────────────               │
       │  Therapeutic Alternatives                │
       │    Product · Category · Str  ✓ In Stock  │
       │    Rs.XX  ~~Rs.YY~~                      │
       └──────────────────────────────────────────┘

       REMOVED (per requirements):
       • Location / address / distance
       • Operational hours
       • Availability units count
       • card-footer section

       UPDATED:
       • Price: discounted + crossed-out original, OR original only
       • Contact phone moved into card-info body
       • Rx / OTC badge per matched product
       • Alternatives renamed from "View Matched Medicines"
       ============================================= */
    async function buildPharmacyCard(pharmacy) {

        /* ── Header price block ── */
        const hasHeaderDiscount =
            pharmacy.lowestPrice !== Infinity &&
            pharmacy.lowestOrig  !== Infinity &&
            pharmacy.lowestPrice < pharmacy.lowestOrig;

        let priceBlockHTML;
        if (hasHeaderDiscount) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestPrice.toFixed(2)}</span>
                <span class="price-orig">Rs. ${pharmacy.lowestOrig.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else if (pharmacy.lowestOrig !== Infinity) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestOrig.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else if (pharmacy.lowestPrice !== Infinity) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestPrice.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else {
            priceBlockHTML = `<span class="price-label">Price not available</span>`;
        }

        /* ── Matched items summary lines ── */
        const itemLinesHTML = pharmacy.items.map(row => {
            const meta    = [row[COL.category], row[COL.strength]].filter(Boolean).join(' · ');
            const rxBadge = isPrescriptionRequired(row)
                ? `<span class="rx-badge rx-badge--required"><i class="fa-solid fa-file-prescription"></i> Rx Required</span>`
                : `<span class="rx-badge rx-badge--otc"><i class="fa-solid fa-circle-check"></i> OTC</span>`;

            return `
            <div class="card-item-line">
                <div class="card-item-line__text">
                    <span class="card-item-line__name">${row[COL.product_name] || '—'}</span>
                    ${meta ? `<span class="card-item-line__meta">${meta}</span>` : ''}
                </div>
                ${rxBadge}
            </div>`;
        }).join('');

        /* ── Fetch alternatives for each matched item in parallel ── */
        const altResults  = await Promise.all(pharmacy.items.map(row => fetchAlternatives(row)));
        const allAlts     = altResults.flat();

        // Deduplicate: skip if already shown in main results
        const seenNames  = new Set(pharmacy.items.map(r => r[COL.product_name]));
        const uniqueAlts = allAlts.filter(alt => {
            const name = alt[COL.product_name];
            if (seenNames.has(name)) return false;
            seenNames.add(name);
            return true;
        });

        /* ── Build section HTML ── */
        const matchedRowsHTML = pharmacy.items.map(row => buildMedicineRow(row)).join('');
        const altRowsHTML     = uniqueAlts.length > 0
            ? uniqueAlts.map(alt => buildMedicineRow(alt)).join('')
            : `<li class="alt-empty">No therapeutically equivalent alternatives found in stock.</li>`;

        const altBadge = uniqueAlts.length > 0
            ? `<span class="alt-count-badge">${uniqueAlts.length}</span>` : '';

        return `
        <article class="pharmacy-card">

            <!-- CARD TOP -->
            <div class="card-top">

                <!-- Left: status image block -->
                <div class="card-image card-image--fallback">
                    <span class="status-pill status-pill--open">
                        <i class="fa-solid fa-circle"></i> In Stock
                    </span>
                </div>

                <!-- Centre: pharmacy name + product lines + phone -->
                <div class="card-info">
                    <div class="card-info__name-row">
                        <h2 class="card-info__name">${pharmacy.name}</h2>
                        <span class="badge badge--verified">
                            <i class="fa-solid fa-circle-check"></i> Verified
                        </span>
                    </div>

                    <!-- Product · Category · Strength + Rx badge per item -->
                    <div class="card-items-summary">
                        ${itemLinesHTML}
                    </div>

                    <!-- Contact phone -->
                    <div class="card-contact">
                        <i class="fa-solid fa-phone"></i>
                        <span>${pharmacy.phone}</span>
                    </div>
                </div>

                <!-- Right: price block -->
                <div class="card-price">
                    ${priceBlockHTML}
                </div>

            </div><!-- /.card-top -->

            <!-- VIEW ALTERNATIVES TOGGLE BUTTON -->
            <button class="alternatives-btn panel-toggle-btn" aria-expanded="false">
                <i class="fa-solid fa-pills" style="margin-right:6px"></i>
                View Alternatives
                ${altBadge}
                <i class="fa-solid fa-chevron-down toggle-icon" style="margin-left:auto"></i>
            </button>

            <!-- ALTERNATIVES PANEL (hidden by default) -->
            <div class="alternatives-panel" style="display:none" aria-hidden="true">

                <!-- Section 1: Matched Medicines -->
                <p class="alt-section-label">Matched Medicines</p>
                <ul class="alt-list">
                    ${matchedRowsHTML}
                </ul>

                <!-- Section 2: Therapeutic Alternatives -->
                <p class="alt-section-label alt-section-label--sep">
                    Therapeutic Alternatives
                    <span class="alt-section-note">Same generic · dosage form · strength · release type</span>
                </p>
                <ul class="alt-list">
                    ${altRowsHTML}
                </ul>

            </div><!-- /.alternatives-panel -->

        </article>`;
    }

    /* =============================================
       12 & 13. BUILD MEDICINE / ALTERNATIVE ROW
       ─────────────────────────────────────────────
       Shared builder for both "Matched Medicines"
       and "Therapeutic Alternatives" rows.

       Each row shows:
       • Product name
       • Category · Strength
       • ✓ In Stock  (no unit count — per requirement)
       • Price: discounted + ~~original~~ if discounted,
                OR just original price if no discount
       ============================================= */
    function buildMedicineRow(row) {
        const discPrice  = parseFloat(row[COL.discounted_price] || 0);
        const origPrice  = parseFloat(row[COL.original_price]   || 0);
        const hasDisc    = discPrice > 0 && origPrice > 0 && discPrice < origPrice;
        const meta       = [row[COL.category], row[COL.strength]].filter(Boolean).join(' · ');

        let rowPriceHTML;
        if (hasDisc) {
            // Show discounted price + original crossed out
            rowPriceHTML = `
                <span class="alt-row__price">Rs. ${discPrice.toFixed(2)}</span>
                <span class="alt-row__orig-price">Rs. ${origPrice.toFixed(2)}</span>`;
        } else if (origPrice > 0) {
            // No discount — show original price only
            rowPriceHTML = `<span class="alt-row__price">Rs. ${origPrice.toFixed(2)}</span>`;
        } else {
            rowPriceHTML = `<span class="alt-row__price alt-row__price--na">Price N/A</span>`;
        }

        return `
        <li class="alt-row">
            <div class="alt-row__left">
                <span class="alt-row__name">${row[COL.product_name] || '—'}</span>
                ${meta ? `<span class="alt-row__meta">${meta}</span>` : ''}
                <span class="alt-row__instock">
                    <i class="fa-solid fa-circle-check"></i> In Stock
                </span>
            </div>
            <div class="alt-row__right">
                ${rowPriceHTML}
            </div>
        </li>`;
    }

    /* =============================================
       14. UTILITY HELPERS
       ============================================= */

    // Returns discounted price if valid, else original price, else 0
    function getEffectivePrice(row) {
        const disc = parseFloat(row[COL.discounted_price] || 0);
        const orig = parseFloat(row[COL.original_price]   || 0);
        if (disc > 0) return disc;
        if (orig > 0) return orig;
        return 0;
    }

    // Returns true if prescription_required is set in any common truthy format
    function isPrescriptionRequired(row) {
        const val = row[COL.prescription];
        return val === true || val === 'Yes' || val === 'yes' || val === '1' || val === 1;
    }

    // Haversine formula: straight-line km distance between two lat/lng points
    function getDistanceKm(lat1, lng1, lat2, lng2) {
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
       15. UI STATE HELPERS
       ─────────────────────────────────────────────
       Four states for #pharmacyList:
       initial → nothing typed yet
       loading → query in progress
       empty   → zero results returned
       error   → Supabase threw an exception
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
       16. PANEL TOGGLE — View Alternatives
       ─────────────────────────────────────────────
       Must be called after every renderResults()
       because cards are replaced in the DOM each time.
       Toggles display + flips chevron icon.
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
       17. SORT BUTTONS
       ─────────────────────────────────────────────
       Re-sorts currentResults in memory.
       Does NOT send a new Supabase query.
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
       18. SEARCH INPUT — 400ms debounce
       ─────────────────────────────────────────────
       Resets timer on every keystroke.
       Fires searchMedicines() only after user pauses.
       ============================================= */
    searchInput && searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();
        if (query.length === 0) { showInitialState(); return; }
        debounceTimer = setTimeout(() => searchMedicines(query), 400);
    });

    /* =============================================
       19. LOGOUT
       ============================================= */
    logoutBtn && logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* =============================================
       20. SIDEBAR TOGGLE — mobile hamburger
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
       INIT — entry point
       ============================================= */
    initPage();

})();
