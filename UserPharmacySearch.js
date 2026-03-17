/* =============================================
   MediFinder — UserPharmacySearch.js
   
   What this file does:
   1. Auth guard — redirects to login if no session
   2. Loads user name/email into the sidebar
   3. Listens to the search input (debounced 400ms)
   4. Queries Supabase "Pharmacy Data" table
   5. Groups results by pharmacy (future-proof for multi-pharmacy)
   6. Sorts by Nearest (GPS) or Cheapest (price)
   7. Renders pharmacy cards dynamically
   8. Handles sidebar toggle on mobile
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       COLUMN NAME CONSTANTS
       Your exact Supabase "Pharmacy Data" column names.
       If you ever rename a column, just change it here — 
       no need to hunt through the rest of the code.
       ============================================= */
    const COL = {
        product_name:    'product_name',
        brand:           'brand',
        category:        'category',
        generic_name:    'generic_name',
        used_for:        'used_for',
        discounted_price:'discounted_price',
        original_price:  'original_price',
        pack_size:       'pack_size',
        quantity:        'quantity',
        prescription:    'prescription_required',
        indication:      'indication',
        side_effects:    'side_effects',
    };

    /* =============================================
       TEST PHARMACY PROFILE
       Since your current dataset is a medicine catalogue
       (not yet per-pharmacy), we use this test pharmacy
       for the current single-pharmacy testing phase.
       
       When real pharmacies connect and upload their own
       stock tables, this will be replaced by actual
       pharmacy data fetched from a "pharmacies" table.
       ============================================= */
    const TEST_PHARMACY = {
        name:    'MediFinder Test Pharmacy',
        address: 'Karachi, Pakistan',
        phone:   '+92 300 0000000',
        hours:   '9:00 AM – 11:00 PM',
        lat:     24.8607,   // Karachi coordinates
        lng:     67.0011,
    };

    /* =============================================
       DOM REFERENCES
       ============================================= */
    const searchInput  = document.getElementById('searchInput');
    const pharmacyList = document.getElementById('pharmacyList');
    const resultsCount = document.getElementById('resultsCount');
    const sortBtns     = document.querySelectorAll('.sort-btn');
    const logoutBtn    = document.getElementById('logoutBtn');

    /* =============================================
       STATE
       ============================================= */
    let currentSort    = 'nearest';
    let currentResults = [];        // raw rows from Supabase
    let debounceTimer  = null;
    let userLat        = null;
    let userLng        = null;

    /* =============================================
       STEP 1 — AUTH GUARD + LOAD USER PROFILE
       Checks if user is logged in.
       If not → redirect to Login.html
       If yes → show their name/email in sidebar
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();

        if (error || !session) {
            window.location.href = 'Login.html';
            return;
        }

        // Load user profile from the "users" table
        try {
            const { data: profile } = await supabaseClient
                .from('users')
                .select('first_name, last_name')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                document.getElementById('sidebarUserName').textContent  = fullName  || 'User';
                document.getElementById('sidebarUserEmail').textContent = session.user.email || '';
            }
        } catch (err) {
            // Profile load failed — not critical, page still works
            console.warn('Could not load profile:', err.message);
        }
    }

    /* =============================================
       STEP 2 — GET USER GPS LOCATION
       Used for the "Nearest" sort.
       If user denies location, Nearest sort just
       keeps the original order from Supabase.
       ============================================= */
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLat = pos.coords.latitude;
                userLng = pos.coords.longitude;
            },
            err => {
                console.warn('Location access denied:', err.message);
                // Not a problem — Nearest sort will skip distance calculation
            }
        );
    }

    /* =============================================
       STEP 3 — SEARCH FUNCTION
       Queries Supabase across 5 columns:
       product_name, brand, category, generic_name, used_for
       
       Only returns rows where quantity > 0 (in stock).
       Limits to 200 rows — enough for any realistic search.
       ============================================= */
    async function searchMedicines(query) {
        query = query.trim();

        // Don't search for 1 character — too broad, too many results
        if (query.length < 2) {
            showInitialState();
            return;
        }

        showLoadingState();

        try {
            const { data, error } = await supabaseClient
                .from('Pharmacy Data')               // ← Your Supabase table name
                .select(`
                    ${COL.product_name},
                    ${COL.brand},
                    ${COL.category},
                    ${COL.generic_name},
                    ${COL.used_for},
                    ${COL.discounted_price},
                    ${COL.original_price},
                    ${COL.pack_size},
                    ${COL.quantity},
                    ${COL.prescription},
                    ${COL.indication},
                    ${COL.side_effects}
                `)
                // Search across 5 columns — case-insensitive
                .or([
                    `${COL.product_name}.ilike.%${query}%`,
                    `${COL.brand}.ilike.%${query}%`,
                    `${COL.category}.ilike.%${query}%`,
                    `${COL.generic_name}.ilike.%${query}%`,
                    `${COL.used_for}.ilike.%${query}%`,
                ].join(','))
                .gt(COL.quantity, 0)                 // Only in-stock items
                .limit(200);                         // Future-proof for multi-pharmacy

            if (error) throw error;

            currentResults = data || [];
            renderResults(currentResults, currentSort);

        } catch (err) {
            console.error('Supabase search error:', err.message);
            showErrorState('Search failed. Check your connection and try again.');
        }
    }

    /* =============================================
       STEP 4 — GROUP RESULTS BY PHARMACY
       
       RIGHT NOW (single pharmacy testing):
       All rows are grouped under TEST_PHARMACY.
       
       FUTURE (multiple pharmacies connected):
       Each pharmacy will upload their own stock table
       OR have a pharmacy_id column. The grouping logic
       below will automatically group them correctly —
       no changes needed to this function.
       ============================================= */
    function groupByPharmacy(rows) {
        const map = {};

        rows.forEach(row => {
            // Future: replace 'TEST_PHARMACY.name' with row['pharmacy_name']
            const key = TEST_PHARMACY.name;

            if (!map[key]) {
                map[key] = {
                    // Pharmacy info — future: from row['pharmacy_*'] columns
                    name:     TEST_PHARMACY.name,
                    address:  TEST_PHARMACY.address,
                    phone:    TEST_PHARMACY.phone,
                    hours:    TEST_PHARMACY.hours,
                    lat:      TEST_PHARMACY.lat,
                    lng:      TEST_PHARMACY.lng,
                    items:    [],
                    lowestPrice: Infinity,
                    totalUnits:  0,
                };
            }

            const price = getPrice(row);
            map[key].items.push(row);
            map[key].totalUnits  += parseInt(row[COL.quantity] || 0);
            if (price < map[key].lowestPrice) map[key].lowestPrice = price;
        });

        return Object.values(map);
    }

    /* =============================================
       STEP 5 — SORT PHARMACIES
       Nearest: sorts by GPS distance (Haversine formula)
       Cheapest: sorts by lowest medicine price
       ============================================= */
    function sortPharmacies(pharmacies, sortMode) {
        if (sortMode === 'cheapest') {
            return [...pharmacies].sort((a, b) => a.lowestPrice - b.lowestPrice);
        }

        // Nearest — calculate distance only if we have user GPS
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

        return pharmacies; // No GPS — keep original order
    }

    /* =============================================
       STEP 6 — RENDER RESULTS
       Groups → sorts → builds HTML → injects into page
       ============================================= */
    function renderResults(rows, sortMode) {
        if (rows.length === 0) {
            showEmptyState('No medicines found in stock matching your search.');
            return;
        }

        const pharmacies = sortPharmacies(groupByPharmacy(rows), sortMode);

        // Update result count
        const count = pharmacies.length;
        resultsCount.innerHTML =
            `Found <strong>${count} ${count === 1 ? 'pharmacy' : 'pharmacies'}</strong> with <strong>${rows.length} matching item${rows.length !== 1 ? 's' : ''}</strong> in stock`;

        // Render all cards
        pharmacyList.innerHTML = pharmacies.map(p => buildPharmacyCard(p)).join('');

        // Attach toggle listeners for "View Details" panels
        attachDetailToggleListeners();
    }

    /* =============================================
       STEP 7 — BUILD PHARMACY CARD HTML
       Creates one card per pharmacy with:
       - Pharmacy name, address, hours, phone
       - Lowest price found
       - Total units available
       - List of matched medicines (expandable)
       ============================================= */
    function buildPharmacyCard(pharmacy) {
        const priceDisplay = pharmacy.lowestPrice === Infinity
            ? 'N/A'
            : `Rs. ${pharmacy.lowestPrice.toFixed(2)}`;

        const units = pharmacy.totalUnits;

        // Distance text (only shown if GPS available)
        const distText = (pharmacy.distance != null && pharmacy.distance < 9999)
            ? `<strong>${pharmacy.distance.toFixed(1)}km away</strong>`
            : '';

        const addressLine = distText
            ? `${pharmacy.address} &bull; ${distText}`
            : pharmacy.address;

        // Availability styling based on unit count
        let availClass, availIcon, availLabel, statusPillClass, statusPillLabel;
        if (units <= 0) {
            availClass      = 'info-cell__value--red';
            availIcon       = 'fa-ban';
            availLabel      = 'Out of Stock';
            statusPillClass = 'status-pill--closed';
            statusPillLabel = 'Out of Stock';
        } else if (units <= 10) {
            availClass      = 'info-cell__value--amber';
            availIcon       = 'fa-triangle-exclamation';
            availLabel      = `${units} Units (Low)`;
            statusPillClass = 'status-pill--low';
            statusPillLabel = 'Low Stock';
        } else {
            availClass      = 'info-cell__value--green';
            availIcon       = 'fa-box-archive';
            availLabel      = `${units} Units`;
            statusPillClass = 'status-pill--open';
            statusPillLabel = 'In Stock';
        }

        // Build expandable medicine list (max 10 shown)
        const itemsToShow = pharmacy.items.slice(0, 10);
        const moreCount   = pharmacy.items.length - itemsToShow.length;

        const medicineRows = itemsToShow.map(row => {
            const price        = getPrice(row);
            const origPrice    = parseFloat(row[COL.original_price] || 0);
            const hasDiscount  = origPrice > 0 && price < origPrice;
            const rxRequired   = row[COL.prescription] === true || row[COL.prescription] === 'Yes' || row[COL.prescription] === '1';
            const qty          = parseInt(row[COL.quantity] || 0);

            // Stock badge per item
            let itemStockColor = '#208B3A';
            if (qty <= 0)  itemStockColor = '#ef4444';
            if (qty <= 10) itemStockColor = '#d97706';

            return `
            <li class="medicine-row">
                <div class="medicine-row__main">
                    <div class="medicine-row__info">
                        <span class="medicine-row__name">${row[COL.product_name] || 'Unknown'}</span>
                        ${row[COL.brand] ? `<span class="medicine-row__brand">${row[COL.brand]}</span>` : ''}
                        ${row[COL.category] ? `<span class="medicine-row__category">${row[COL.category]}</span>` : ''}
                        ${rxRequired ? `<span class="medicine-row__rx"><i class="fa-solid fa-prescription"></i> Rx Required</span>` : ''}
                    </div>
                    <div class="medicine-row__pricing">
                        ${hasDiscount ? `<span class="medicine-row__orig-price">Rs. ${origPrice.toFixed(2)}</span>` : ''}
                        <span class="medicine-row__price">Rs. ${price.toFixed(2)}</span>
                        ${row[COL.pack_size] ? `<span class="medicine-row__pack">${row[COL.pack_size]}</span>` : ''}
                    </div>
                </div>
                <div class="medicine-row__stock" style="color:${itemStockColor}">
                    <i class="fa-solid fa-cubes"></i> ${qty} in stock
                </div>
            </li>`;
        }).join('');

        const moreNote = moreCount > 0
            ? `<p class="medicine-more">+${moreCount} more items matched — refine your search to narrow down.</p>`
            : '';

        return `
        <article class="pharmacy-card">

            <!-- Card Top: Image | Info | Price -->
            <div class="card-top">
                <div class="card-image card-image--fallback">
                    <span class="status-pill ${statusPillClass}">
                        <i class="fa-solid fa-circle"></i> ${statusPillLabel}
                    </span>
                </div>

                <div class="card-info">
                    <div class="card-info__name-row">
                        <h2 class="card-info__name">${pharmacy.name}</h2>
                        <span class="badge badge--verified">
                            <i class="fa-solid fa-circle-check"></i> Verified
                        </span>
                    </div>
                    <ul class="card-info__details">
                        <li>
                            <i class="fa-solid fa-location-dot"></i>
                            <span>${addressLine}</span>
                        </li>
                        <li>
                            <i class="fa-regular fa-clock"></i>
                            <span>${pharmacy.hours}</span>
                        </li>
                    </ul>
                </div>

                <div class="card-price">
                    <span class="price">${priceDisplay}</span>
                    <span class="price-label">starting from</span>
                </div>
            </div>

            <!-- Card Footer: Availability | Contact | Live -->
            <div class="card-footer">
                <div class="info-cell">
                    <span class="info-cell__label">Availability</span>
                    <span class="info-cell__value ${availClass}">
                        <i class="fa-solid ${availIcon}"></i> ${availLabel}
                    </span>
                </div>
                <div class="info-cell">
                    <span class="info-cell__label">Contact</span>
                    <span class="info-cell__value">
                        <i class="fa-solid fa-phone"></i> ${pharmacy.phone}
                    </span>
                </div>
                <div class="live-badge live-badge--live">
                    <span class="live-dot"></span> Live
                </div>
            </div>

            <!-- Expandable Matched Medicines -->
            <button class="alternatives-btn detail-toggle-btn">
                <i class="fa-solid fa-pills" style="margin-right:6px"></i>
                View Matched Medicines (${pharmacy.items.length})
                <i class="fa-solid fa-chevron-down" style="margin-left:auto"></i>
            </button>

            <div class="medicine-list-panel" style="display:none">
                <ul class="medicine-list">
                    ${medicineRows}
                </ul>
                ${moreNote}
            </div>

        </article>`;
    }

    /* =============================================
       HELPER — Get Effective Price
       Uses discounted_price if available, falls back
       to original_price.
       ============================================= */
    function getPrice(row) {
        const discounted = parseFloat(row[COL.discounted_price] || 0);
        const original   = parseFloat(row[COL.original_price]   || 0);
        if (discounted > 0) return discounted;
        if (original   > 0) return original;
        return 0;
    }

    /* =============================================
       HELPER — Haversine Distance Formula
       Calculates straight-line distance in km
       between two GPS coordinates.
       ============================================= */
    function getDistanceKm(lat1, lng1, lat2, lng2) {
        const R    = 6371; // Earth radius in km
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
       UI STATE HELPERS
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
       EXPAND/COLLAPSE — Matched Medicines Panel
       ============================================= */
    function attachDetailToggleListeners() {
        document.querySelectorAll('.detail-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const panel  = btn.nextElementSibling;
                const icon   = btn.querySelector('.fa-chevron-down, .fa-chevron-up');
                const isOpen = panel.style.display === 'block';

                panel.style.display = isOpen ? 'none' : 'block';
                if (icon) {
                    icon.classList.toggle('fa-chevron-down', isOpen);
                    icon.classList.toggle('fa-chevron-up',  !isOpen);
                }
            });
        });
    }

    /* =============================================
       SORT BUTTONS
       Clicking a sort button re-sorts the already-
       fetched results — no new Supabase query needed.
       ============================================= */
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sortBtns.forEach(b => b.classList.remove('sort-btn--active'));
            btn.classList.add('sort-btn--active');
            currentSort = btn.dataset.sort || 'nearest';

            if (currentResults.length > 0) {
                renderResults(currentResults, currentSort);
            }
        });
    });

    /* =============================================
       SEARCH INPUT — Debounced (400ms)
       Waits 400ms after the user stops typing before
       sending the query. Prevents flooding Supabase
       with a request on every single keystroke.
       ============================================= */
    searchInput && searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();

        if (query.length === 0) {
            showInitialState();
            return;
        }

        debounceTimer = setTimeout(() => {
            searchMedicines(query);
        }, 400);
    });

    /* =============================================
       LOGOUT
       ============================================= */
    logoutBtn && logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* =============================================
       SIDEBAR TOGGLE (Mobile)
       ============================================= */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function openSidebar()  { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* =============================================
       INIT — Run on page load
       ============================================= */
    initPage();

})();
