/* ==========================================================================
   MediFinder — UserPharmacySearch.js  v9.0
   ─────────────────────────────────────────────────────────────────────────
   CHANGES IN v9.0 (All 12 Fixes Applied):

   FIX 1  — N+1 query eliminated: fetchAlternatives() deleted, replaced by
             single fetchAlternativesBatch() RPC call before card render.
   FIX 2  — generic_tokens array overlap in get_alternatives_batch RPC;
             tokenizeGenericName() helper added for client-side param prep.
   FIX 3  — logSearch() consolidated from 6 round-trips to 1 RPC call
             (log_search RPC handles category fetch + insert + prune).
   FIX 4  — RLS policy added in SQL; fetchPharmaciesDirect fallback now
             only used if RPC is unavailable (SECURITY DEFINER search_medicine
             bypasses view RLS; direct view query benefits from new policy).
   FIX 5  — search_medicine RPC updated server-side (expiry + active status).
   FIX 6  — getRouteMatrix() now proxies through Supabase Edge Function;
             MAPS_KEY removed from client entirely.
   FIX 7  — fetchSuggestions() now calls search_products_autocomplete RPC
             (FTS + trigram, ranked, typo-tolerant).
   FIX 8  — search_medicine uses ph.lat/lng generated columns server-side;
             parseCoordinates() fallback untouched.
   FIX 9  — match_or_create_product uses atomic upsert server-side.
   FIX 10 — enrichWithRoadDistances() enriches only top-5 by Haversine;
             session-level distance cache added.
   FIX 11 — Pharmacy profile image: groupByPharmacy() maps profileImagePath;
             buildPharmacyCardHTML() renders <img> with initials fallback.
   FIX 12 — Indexes and extensions applied via SQL migration.

   PRESERVED EXACTLY (untouched):
     · Prescription OCR scanner (Sections 29–41)
     · Sidebar toggle + hamburger (Section 27)
     · Auth guard + sidebar loader (Section 4)
     · Sort buttons (Section 24)
     · haversine() (Section 8)
     · waitForMaps() + DistanceMatrixService Tier 1 (Sections 9–10)
     · Auto-search from URL params (Section 28)
     · escapeHtml() (Section 41)
     · All existing CSS (only .card-profile-img added in C_CSS_Addition.css)
   ========================================================================== */

(function () {
    'use strict';

    /* ==========================================================================
       SECTION 1 — COLUMN NAME CONSTANTS
       ========================================================================== */
    const COL = {
        /* products */
        product_id:       'product_id',
        product_name:     'product_name',
        brand:            'brand',
        category:         'category',
        generic_name:     'generic_name',
        strength:         'strength',
        dosage_form:      'dosage_form',
        release_type:     'release_type',
        /* inventory */
        discounted_price: 'discounted_price',
        original_price:   'original_price',
        pack_size:        'pack_size',
        box_quantity:     'box_quantity',
        prescription:     'prescription_required',
        /* pharmacy */
        pharmacy_id:      'pharmacy_id',
        pharmacy_name:    'pharmacy_name',
        phone:            'phone_no',
        coordinates:      'coordinates',
        profile_img: 'profile_img',
    };

    /* ==========================================================================
       SECTION 2 — PRESCRIPTION SCANNER CONSTANTS
       ========================================================================== */
    const PRESCRIPTION_MAX_BYTES = 1 * 1024 * 1024;  // 1 MB

    /* ==========================================================================
       SECTION 3 — DOM REFERENCES + STATE
       ========================================================================== */
    const searchInput           = document.getElementById('searchInput');
    const pharmacyList          = document.getElementById('pharmacyList');
    const resultsCount          = document.getElementById('resultsCount');
    const sortBtns              = document.querySelectorAll('.sort-btn');
    const logoutBtn             = document.getElementById('logoutBtn');
    const uploadPrescriptionBtn = document.getElementById('uploadPrescriptionBtn');
    const fileInput             = createHiddenFileInput();

    let suggestionBox           = null;
    let currentSort             = 'nearest';
    let currentPharmacyGroups   = [];
    let debounceTimer           = null;
    let userLat                 = null;
    let userLng                 = null;
    let selectedProductId       = null;
    let locationFetchPromise    = null;

    // FIX 10 — session-level distance cache
    const _distanceCache = new Map();

    function _distanceCacheKey(pharmacyId) {
        if (userLat === null || userLng === null) return null;
        return `${userLat.toFixed(3)},${userLng.toFixed(3)},${pharmacyId}`;
    }

    /* ==========================================================================
       SECTION 4 — AUTH GUARD + SIDEBAR LOADER  (UNTOUCHED)
       ========================================================================== */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) { window.location.href = 'Login.html'; return; }

        try {
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('full_name, profile_img')
                .eq('user_id', session.user.id)
                .single();

            if (profile) {
                document.getElementById('sidebarUserName').textContent  = profile.full_name || 'User';
                document.getElementById('sidebarUserEmail').textContent = session.user.email || '';
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load failed:', err.message);
        }
    }

    function renderSidebarAvatar(url) {
        const el = document.querySelector('.user-avatar');
        if (!el) return;
        const fallback = el.querySelector('.user-avatar__fallback');
        const existing = el.querySelector('img');
        if (existing) existing.remove();

        const img         = document.createElement('img');
        img.alt           = 'User';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';
        img.onerror       = () => { img.remove(); if (fallback) fallback.style.display = 'flex'; };
        img.onload        = () => { if (fallback) fallback.style.display = 'none'; };
        img.src           = url || 'Images/ProfileAvatar.jpg';
        el.insertBefore(img, el.firstChild);
    }

    /* ==========================================================================
       SECTION 5 — GPS LOCATION  (UNTOUCHED)
       ========================================================================== */
    function getUserLocation() {
        if (locationFetchPromise) return locationFetchPromise;

        locationFetchPromise = new Promise(resolve => {
            if (!navigator.geolocation) return resolve(false);
            navigator.geolocation.getCurrentPosition(
                pos => {
                    userLat = pos.coords.latitude;
                    userLng = pos.coords.longitude;
                    resolve(true);
                },
                err => {
                    console.warn('Geolocation denied/failed:', err.message);
                    resolve(false);
                },
                { timeout: 8000, maximumAge: 60000 }
            );
        });

        return locationFetchPromise;
    }

    getUserLocation();

    /* ==========================================================================
       SECTION 6 — COORDINATE PARSER  (UNTOUCHED)
       ========================================================================== */
    function parseCoordinates(raw) {
        if (!raw) return null;
        const parts = String(raw).split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return { lat: parts[0], lng: parts[1] };
        }
        return null;
    }

    /* ==========================================================================
       SECTION 7 — PRICE HELPERS  (UNTOUCHED)
       ========================================================================== */
    function parsePrice(raw) {
        if (!raw) return 0;
        const val = parseFloat(String(raw).replace(/Rs\.?\s*/gi, '').replace(/,/g, '').trim());
        return isNaN(val) ? 0 : val;
    }

    function getEffectivePrice(row) {
        const disc = parsePrice(row[COL.discounted_price]);
        const orig = parsePrice(row[COL.original_price]);
        if (disc > 0 && disc < orig) return disc;
        return orig > 0 ? orig : disc;
    }

    /* ==========================================================================
       SECTION 8 — HAVERSINE DISTANCE (km)  (UNTOUCHED)
       ========================================================================== */
    function haversine(lat1, lng1, lat2, lng2) {
        const R    = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a    =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /* ==========================================================================
       SECTION 9 — GOOGLE MAPS READY CHECK  (UNTOUCHED)
       ========================================================================== */
    function waitForMaps() {
        return new Promise(resolve => {
            if (window.__mapsReady) return resolve(true);
            const timeout = setTimeout(() => resolve(false), 10000);
            window.__mapsReadyCallbacks = window.__mapsReadyCallbacks || [];
            window.__mapsReadyCallbacks.push(() => {
                clearTimeout(timeout);
                resolve(true);
            });
        });
    }

    /* ==========================================================================
       SECTION 10 — DISTANCE MATRIX API  (FIX 6: getRouteMatrix proxied)
       ─────────────────────────────────────────────────────────────────────────
       THREE-TIER STRATEGY per search:
         Tier 1 — google.maps.DistanceMatrixService  (legacy, still works)
         Tier 2 — Supabase Edge Function → Routes API (FIX 6: key hidden)
         Tier 3 — Haversine straight-line (fallback)
       ========================================================================== */

    // ── Tier 2: Routes API via Supabase Edge Function (FIX 6) ────────────────
    async function getRouteMatrix(destinations) {
        // No MAPS_KEY in client — proxied through Edge Function (FIX 6)
        const body = {
            origins: [{
                waypoint: { location: { latLng: { latitude: userLat, longitude: userLng } } },
                routeModifiers: {}
            }],
            destinations: destinations.map(d => ({
                waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } }
            })),
        };

        const { data, error } = await supabaseClient.functions.invoke('route-matrix', {
            body: { origins: body.origins, destinations: body.destinations },
        });
        if (error) throw new Error('Edge Function error: ' + error.message);

        const rows    = Array.isArray(data) ? data : [];
        const results = destinations.map(() => null);

        rows.forEach(row => {
            const i = row.destinationIndex ?? 0;
            if (row.status && row.status !== 'OK') {
                results[i] = buildHaversineFallback(destinations[i]);
                return;
            }
            const distM  = row.distanceMeters ?? 0;
            const distKm = (distM / 1000).toFixed(1);
            const durSec  = row.duration ? parseInt(String(row.duration).replace('s', ''), 10) : null;
            const durText = durSec !== null
                ? (durSec >= 3600
                    ? Math.round(durSec / 3600) + ' hr ' + Math.round((durSec % 3600) / 60) + ' min'
                    : Math.round(durSec / 60) + ' min')
                : null;
            results[i] = {
                distanceM:    distM,
                distanceText: distKm + ' km',
                durationText: durText,
                isApprox:     false,
            };
        });

        return results.map((r, i) => r ?? buildHaversineFallback(destinations[i]));
    }

    // ── Tier 1 + orchestration (Tier 1 logic UNTOUCHED) ──────────────────────
    async function getDistanceMatrix(destinations) {
        if (userLat === null || userLng === null) {
            console.warn('Distance: No user location, using Haversine fallback');
            return destinations.map(dest => buildHaversineFallback(dest));
        }

        const mapsLoaded = await waitForMaps();

        // ── Tier 1: DistanceMatrixService (UNTOUCHED) ─────────────────────────
        if (mapsLoaded && window.google?.maps?.DistanceMatrixService) {
            try {
                const dmResults = await new Promise((resolve, reject) => {
                    const service = new google.maps.DistanceMatrixService();
                    service.getDistanceMatrix(
                        {
                            origins:      [{ lat: userLat, lng: userLng }],
                            destinations: destinations.map(d => ({ lat: d.lat, lng: d.lng })),
                            travelMode:   google.maps.TravelMode.DRIVING,
                            unitSystem:   google.maps.UnitSystem.METRIC,
                        },
                        (response, status) => {
                            if (status === 'OK' && response?.rows?.[0]?.elements) {
                                resolve(response.rows[0].elements.map((el, i) => {
                                    if (el.status !== 'OK') return null;
                                    return {
                                        distanceM:    el.distance.value,
                                        distanceText: el.distance.text,
                                        durationText: el.duration.text,
                                        isApprox:     false,
                                    };
                                }));
                            } else {
                                reject(new Error('DistanceMatrix status: ' + status));
                            }
                        }
                    );
                });

                if (dmResults.every(r => r !== null)) return dmResults;

                console.warn('DistanceMatrix: some elements failed, patching via Edge Function');
                const failedIdxs  = dmResults.map((r, i) => r === null ? i : -1).filter(i => i >= 0);
                const patchDests  = failedIdxs.map(i => destinations[i]);
                const patches     = await getRouteMatrix(patchDests).catch(() =>
                    patchDests.map(d => buildHaversineFallback(d))
                );
                failedIdxs.forEach((origIdx, pi) => { dmResults[origIdx] = patches[pi]; });
                return dmResults;

            } catch (err) {
                console.warn('DistanceMatrix failed (' + err.message + '), trying Edge Function...');
            }
        } else {
            console.warn('Distance Matrix: Maps API not loaded, trying Edge Function...');
        }

        // ── Tier 2: Supabase Edge Function → Routes API (FIX 6) ──────────────
        try {
            const routeResults = await getRouteMatrix(destinations);
            console.info('Edge Function (Routes API) succeeded.');
            return routeResults;
        } catch (err) {
            console.warn('Edge Function also failed (' + err.message + '), using Haversine fallback');
        }

        // ── Tier 3: Haversine (UNTOUCHED) ─────────────────────────────────────
        return destinations.map(dest => buildHaversineFallback(dest));
    }

    function buildHaversineFallback(dest) {
        if (userLat !== null && dest?.lat && dest?.lng) {
            const km = haversine(userLat, userLng, dest.lat, dest.lng);
            return {
                distanceM:    km * 1000,
                distanceText: km.toFixed(1) + ' km',
                durationText: null,
                isApprox:     true,
            };
        }
        return { distanceM: Infinity, distanceText: null, durationText: null, isApprox: true };
    }

    /* ==========================================================================
       SECTION 11 — SMART WORD BOUNDARY DETECTION  (UNTOUCHED)
       ========================================================================== */
    function isCompleteWord(query) {
        const tokens = query.trim().split(/\s+/);
        return tokens[tokens.length - 1].length >= 3;
    }

    /* ==========================================================================
       SECTION 12 — AUTOCOMPLETE: FETCH SUGGESTIONS  (FIX 7)
       Now calls search_products_autocomplete RPC (FTS + trigram, ranked).
       ========================================================================== */
    async function fetchSuggestions(query) {
        try {
            const { data, error } = await supabaseClient.rpc('search_products_autocomplete', {
                p_query: query.trim(),
                p_limit: 10,
            });
            if (error) throw error;
            return (data || []).map(row => ({ id: row.id, label: buildProductLabel(row) }));
        } catch (err) {
            console.warn('Suggestion fetch error:', err.message);
            return [];
        }
    }

    function buildProductLabel(row) {
        let label = row.product_name || '';
        if (row.dosage_form) label += ' ' + row.dosage_form;
        if (row.strength)    label += ' ' + row.strength;
        return label.trim();
    }

    /* ==========================================================================
       SECTION 13 — SUGGESTION DROPDOWN  (UNTOUCHED)
       ========================================================================== */
    function showSuggestions(items) {
        clearSuggestions();
        if (!items.length) return;

        suggestionBox           = document.createElement('ul');
        suggestionBox.className = 'suggestion-dropdown';

        items.forEach(item => {
            const li       = document.createElement('li');
            li.className   = 'suggestion-item';
            li.textContent = item.label;
            li.dataset.productId = item.id;
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                selectProduct(item.id, item.label);
            });
            suggestionBox.appendChild(li);
        });

        const wrap = searchInput.closest('.search-bar__input-wrap') || searchInput.parentElement;
        wrap.style.position = 'relative';
        wrap.appendChild(suggestionBox);
    }

    function clearSuggestions() {
        if (suggestionBox) { suggestionBox.remove(); suggestionBox = null; }
    }

    /* ==========================================================================
       SECTION 14 — LOG SEARCH TO user_search_history  (FIX 3)
       Consolidated from 6 sequential DB calls to 1 RPC call.
       ========================================================================== */
    async function logSearch(productName) {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session || !selectedProductId) return;
            await supabaseClient.rpc('log_search', {
                p_user_id:      session.user.id,
                p_product_id:   selectedProductId,
                p_product_name: productName,
            });
        } catch (err) {
            console.warn('Search log error:', err.message);
        }
    }

    /* ==========================================================================
       SECTION 15 — SELECT PRODUCT  (UNTOUCHED)
       ========================================================================== */
    function selectProduct(productId, productLabel) {
        searchInput.value  = productLabel;
        selectedProductId  = productId;
        clearSuggestions();

        logSearch(productLabel);
        locationFetchPromise = null;
        getUserLocation();

        fetchAndRenderPharmacies(productId);
    }

    /* ==========================================================================
       SECTION 16 — FETCH PHARMACIES FROM SUPABASE  (UNTOUCHED logic)
       ========================================================================== */
    async function fetchAndRenderPharmacies(productId) {
        showLoadingState();
        await getUserLocation();

        let rows = [];

        try {
            const { data: rpcData, error: rpcErr } = await supabaseClient.rpc('search_medicine', {
                p_product_id: productId,
                p_user_lat:   userLat  ?? 0,
                p_user_lng:   userLng  ?? 0,
            });

            if (rpcErr) {
                console.warn('RPC search_medicine failed, using fallback:', rpcErr.message);
                rows = await fetchPharmaciesDirect(productId);
            } else {
                rows = rpcData || [];
            }
        } catch (err) {
            console.error('fetchAndRenderPharmacies error:', err.message);
            showErrorState('Search failed. Check your connection and try again.');
            return;
        }

        if (!rows.length) {
            showEmptyState('No pharmacies found with this medicine in stock.');
            return;
        }

        const groups = groupByPharmacy(rows);
        await enrichWithRoadDistances(groups);

        currentPharmacyGroups = groups;
        renderSortedResults(currentSort);
    }

    /* ==========================================================================
       SECTION 16-B — DIRECT VIEW FALLBACK  (UNTOUCHED)
       ========================================================================== */
    async function fetchPharmaciesDirect(productId) {
        try {
            const { data, error } = await supabaseClient
                .from('pharmacy_inventory_view')
                .select([
                    'product_id', 'product_name', 'brand', 'category',
                    'generic_name', 'strength', 'dosage_form', 'release_type',
                    'discounted_price', 'original_price', 'pack_size',
                    'box_quantity', 'prescription_required',
                    'pharmacy_id', 'pharmacy_name', 'phone_no',
                    'coordinates', 'profile_image_path',
                ].join(', '))
                .eq('product_id', productId)
                .gt('box_quantity', 0)
                .limit(20);

            if (error) throw error;
            return data || [];
        } catch (err) {
            console.error('Direct view fallback error:', err.message);
            return [];
        }
    }

    /* ==========================================================================
       SECTION 17 — GROUP ROWS BY PHARMACY  (FIX 11: maps profileImagePath)
       ========================================================================== */
    function groupByPharmacy(rows) {
        const map = new Map();

        rows.forEach(row => {
            const pid   = row[COL.pharmacy_id];
            const coord = parseCoordinates(row[COL.coordinates]);

            if (!map.has(pid)) {
                map.set(pid, {
                    pharmacy: {
                        id:               pid,
                        name:             row[COL.pharmacy_name]  || 'Pharmacy',
                        phone:            row[COL.phone]          || '',
                        coord,
                        profileImagePath: row[COL.profile_img] || null,
                        distanceM:        coord && userLat !== null
                            ? haversine(userLat, userLng, coord.lat, coord.lng) * 1000
                            : Infinity,
                        distanceText: null,
                        durationText: null,
                        isApprox:     true,
                    },
                    items: [],
                });
            }
            map.get(pid).items.push(row);
        });

        return Array.from(map.values());
    }

    /* ==========================================================================
       SECTION 18 — ENRICH WITH ROAD DISTANCES  (FIX 10: TOP_N=5 + cache)
       ========================================================================== */
    async function enrichWithRoadDistances(groups) {
        const TOP_N      = 5;
        const withCoords = groups.filter(g => g.pharmacy.coord);
        if (!withCoords.length) return;

        // Sort by Haversine first to pick the nearest TOP_N
        const sorted = [...withCoords].sort(
            (a, b) => (a.pharmacy.distanceM ?? Infinity) - (b.pharmacy.distanceM ?? Infinity)
        );

        // Check cache for each; only call API for uncached pharmacies
        const toEnrich = [];
        sorted.slice(0, TOP_N).forEach(g => {
            const cacheKey = _distanceCacheKey(g.pharmacy.id);
            if (cacheKey && _distanceCache.has(cacheKey)) {
                // Apply cached result immediately
                const cached = _distanceCache.get(cacheKey);
                Object.assign(g.pharmacy, cached);
            } else {
                toEnrich.push(g);
            }
        });

        if (!toEnrich.length) return;

        const destinations = toEnrich.map(g => g.pharmacy.coord);
        const dmResults    = await getDistanceMatrix(destinations);

        dmResults.forEach((result, i) => {
            const pharm = toEnrich[i].pharmacy;
            pharm.distanceM    = result.distanceM;
            pharm.distanceText = result.distanceText;
            pharm.durationText = result.durationText;
            pharm.isApprox     = result.isApprox;

            // Cache the result
            const cacheKey = _distanceCacheKey(pharm.id);
            if (cacheKey) {
                _distanceCache.set(cacheKey, {
                    distanceM:    result.distanceM,
                    distanceText: result.distanceText,
                    durationText: result.durationText,
                    isApprox:     result.isApprox,
                });
            }
        });
        // Pharmacies beyond TOP_N keep Haversine isApprox: true — no API call
    }

    /* ==========================================================================
       SECTION 19 — SORT + RENDER RESULTS  (FIX 1: batch alts, no async forEach)
       ========================================================================== */
    async function renderSortedResults(sortMode) {
        const groups = [...currentPharmacyGroups];

        if (sortMode === 'cheapest') {
            groups.forEach(g => g.items.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b)));
            groups.sort((a, b) => getEffectivePrice(a.items[0]) - getEffectivePrice(b.items[0]));
        } else {
            groups.sort((a, b) => (a.pharmacy.distanceM ?? Infinity) - (b.pharmacy.distanceM ?? Infinity));
        }

        const total = groups.length;
        resultsCount.innerHTML =
            `Found <strong>${total}</strong> pharmacy${total !== 1 ? 's' : ''} with this medicine`;

        pharmacyList.innerHTML = '';

        // FIX 1 — ONE batch RPC call for all alternatives instead of N per-card calls
        const pharmacyIds = groups.map(g => g.pharmacy.id);
        const sourceRow   = groups[0]?.items[0];
        const altsMap     = sourceRow
            ? await fetchAlternativesBatch(pharmacyIds, sourceRow)
            : new Map();

        // Build all cards synchronously in a DocumentFragment — no async per-card
        const fragment = document.createDocumentFragment();
        groups.forEach(group => {
            const alts    = altsMap.get(group.pharmacy.id) || [];
            const wrapper = document.createElement('div');
            wrapper.innerHTML = buildPharmacyCardHTML(group, alts);
            fragment.appendChild(wrapper.firstElementChild);
        });

        pharmacyList.appendChild(fragment);
        attachPanelToggleListeners();
    }

    /* ==========================================================================
       SECTION 20 — FETCH ALTERNATIVES BATCH  (FIX 1 + FIX 2)
       Single RPC call replaces N per-card fetchAlternatives() calls.
       Returns Map<pharmacy_id, altRows[]>.
       ========================================================================== */

    // FIX 2 — tokenize generic name for GIN array overlap matching
    function tokenizeGenericName(genericName) {
        return (genericName || '')
            .toUpperCase()
            .replace(/\s+/g, ' ')
            .trim()
            .split(',')
            .map(t => t.trim())
            .filter(t => t.length > 0);
    }

    async function fetchAlternativesBatch(pharmacyIds, sourceRow) {
        const result = new Map();
        if (!pharmacyIds.length || !sourceRow) return result;

        const gn = sourceRow[COL.generic_name];
        const st = sourceRow[COL.strength];
        const df = sourceRow[COL.dosage_form];
        const rt = sourceRow[COL.release_type] || null;
        const pid = sourceRow[COL.product_id];

        if (!gn || !st || !df) return result;

        const genericTokens = tokenizeGenericName(gn);   // FIX 2
        if (!genericTokens.length) return result;

        try {
            const { data, error } = await supabaseClient.rpc('get_alternatives_batch', {
                p_pharmacy_ids:          pharmacyIds,
                p_product_id:            pid,
                p_strength:              st,
                p_dosage_form:           df,
                p_source_generic_tokens: genericTokens,  // FIX 2
                p_release_type:          rt,
            });

            if (error) throw error;

            // Group by pharmacy_id
            (data || []).forEach(row => {
                const phId = row.pharmacy_id;
                if (!result.has(phId)) result.set(phId, []);
                result.get(phId).push(row);
            });
        } catch (err) {
            console.warn('fetchAlternativesBatch error:', err.message);
        }

        return result;
    }

    /* ==========================================================================
       SECTION 21 — BUILD PHARMACY CARD HTML  (FIX 11: profile image support)
       All other card HTML (price, phone, route button, Rx/OTC, alternatives)
       stays identical to v8.0.
       ========================================================================== */
    function buildPharmacyCardHTML(group, alts) {
        const { pharmacy, items } = group;

        const displayItem = items.reduce((a, b) =>
            getEffectivePrice(a) <= getEffectivePrice(b) ? a : b
        );

        const discPrice  = parsePrice(displayItem[COL.discounted_price]);
        const origPrice  = parsePrice(displayItem[COL.original_price]);
        const effPrice   = getEffectivePrice(displayItem);
        const isPrescReq = displayItem[COL.prescription] === true ||
                           String(displayItem[COL.prescription]).toLowerCase() === 'yes';
        const altCount   = items.length - 1 + alts.length;

        /* ── Price HTML ── */
        const priceText     = effPrice > 0 ? `Rs. ${effPrice.toFixed(2)}` : 'Price not listed';
        const origPriceHTML = (origPrice > 0 && discPrice > 0 && origPrice > discPrice)
            ? `<span class="price-original">Rs. ${origPrice.toFixed(2)}</span>` : '';

        /* ── Distance + ETA badge ── */
        let distanceBadgeHTML = '';
        if (pharmacy.distanceText) {
            distanceBadgeHTML = `
                <div class="distance-badge">
                    <i class="fa-solid fa-route"></i>
                    <span>${escapeHtml(pharmacy.distanceText)}${pharmacy.isApprox ? ' (approx.)' : ''}</span>
                    ${pharmacy.durationText ? `<span class="eta-pill">${escapeHtml(pharmacy.durationText)}</span>` : ''}
                </div>`;
        }

        /* ── Profile image ── */
        const initials = (pharmacy.name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
        let profileImgHTML;
       if (pharmacy.profileImagePath) {
            profileImgHTML = `
                <img
                    src="${escapeHtml(pharmacy.profileImagePath)}"
                    alt="${escapeHtml(pharmacy.name)}"
                    class="card-profile-img"
                    loading="lazy"
                    onerror="this.style.display='none';this.nextElementSibling.style.removeProperty('display')"
                />
                <div class="card-image__initials" style="display:none">${escapeHtml(initials)}</div>`;
        } else {
            profileImgHTML = `<div class="card-image__initials">${escapeHtml(initials)}</div>`;
        }
        

        /* ── View Route button ── */
        let routeBtnHTML = '';
        if (pharmacy.coord) {
            const origin = (userLat !== null)
                ? `${userLat},${userLng}`
                : '';
            const dest   = `${pharmacy.coord.lat},${pharmacy.coord.lng}`;
            const mapsUrl = origin
                ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`
                : `https://www.google.com/maps/search/?api=1&query=${dest}`;
            routeBtnHTML = `
                <a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer"
                   class="route-btn">
                    <i class="fa-solid fa-diamond-turn-right"></i>
                    View Route
                </a>`;
        }

        /* ── Matched medicines list ── */
        const matchedRows = items.map(item => altRowHTML(item)).join('');

        /* ── Therapeutic alternatives list ── */
        const altsRows = alts.length > 0
            ? alts.map(alt => altRowHTML(alt)).join('')
            : '<li><p class="alt-empty">No therapeutic alternatives found in this pharmacy.</p></li>';

        return `
        <div class="pharmacy-card">
            <!-- Card Top -->
            <div class="card-top">
                <div class="card-image${pharmacy.profileImagePath ? '' : ' card-image--fallback'}">
                    ${profileImgHTML}
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
                        ${distanceBadgeHTML}
                    </div>
                    <p class="card-info__meta">${escapeHtml(displayItem[COL.product_name] || '')}</p>
                    <p class="card-info__meta card-info__meta--sub">
                        ${escapeHtml(displayItem[COL.category] || '')}
                        ${displayItem[COL.strength] ? '&middot; ' + escapeHtml(displayItem[COL.strength]) : ''}
                    </p>
                    <p class="card-info__phone">
                        <a href="tel:${escapeHtml(pharmacy.phone)}" class="phone-link">
                            <i class="fa-solid fa-phone"></i>
                            ${escapeHtml(pharmacy.phone)}
                        </a>
                    </p>
                </div>

                <div class="card-price">
                    <span class="price">${escapeHtml(priceText)}</span>
                    ${origPriceHTML}
                    ${isPrescReq
                        ? '<span class="price-tag price-tag--rx">Rx</span>'
                        : '<span class="price-tag price-tag--otc">OTC</span>'}
                    <span class="price-label">STARTING FROM</span>
                </div>
            </div>

            <!-- Card Actions -->
            <div class="card-actions">
                <button class="alternatives-btn panel-toggle-btn" aria-expanded="false">
                    <span class="alternatives-btn__icon">
                        <i class="fa-solid fa-arrow-right-arrow-left"></i>
                    </span>
                    View Alternatives
                    <span class="alt-badge">${altCount}</span>
                    <i class="fa-solid fa-chevron-down toggle-icon"
                       style="margin-left:auto;font-size:12px;color:var(--gray-mid);"></i>
                </button>
                ${routeBtnHTML}
            </div>

            <!-- Alternatives Panel (hidden by default) -->
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
                    Always consult your doctor before switching medicines,
                    even when the active ingredient is the same.
                </div>
            </div>
        </div>`;
    }

    /* ==========================================================================
       SECTION 21-B — ALT ROW HTML  (UNTOUCHED)
       ========================================================================== */
    function altRowHTML(item) {
        const dp  = parsePrice(item[COL.discounted_price]);
        const op  = parsePrice(item[COL.original_price]);
        const eff = (dp > 0 && dp < op) ? dp : (op > 0 ? op : dp);

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
                <span class="alt-row__price${eff <= 0 ? ' alt-row__price--na' : ''}">
                    ${eff > 0 ? 'Rs. ' + eff.toFixed(2) : 'N/A'}
                </span>
                ${op > 0 && dp > 0 && op > dp
                    ? `<span class="alt-row__orig-price">Rs. ${op.toFixed(2)}</span>` : ''}
            </div>
        </li>`;
    }

    /* ==========================================================================
       SECTION 22 — UI STATE HELPERS  (UNTOUCHED)
       ========================================================================== */
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
                <p>Searching pharmacies near you...</p>
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

    /* ==========================================================================
       SECTION 23 — PANEL TOGGLE (View Alternatives)  (UNTOUCHED)
       ========================================================================== */
    function attachPanelToggleListeners() {
        document.querySelectorAll('.panel-toggle-btn').forEach(btn => {
            if (btn._panelListenerAttached) return;
            btn._panelListenerAttached = true;
            btn.addEventListener('click', () => {
                const card   = btn.closest('.pharmacy-card');
                const panel  = card?.querySelector('.alternatives-panel');
                const icon   = btn.querySelector('.toggle-icon');
                if (!panel) return;
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

    /* ==========================================================================
       SECTION 24 — SORT BUTTONS  (UNTOUCHED)
       ========================================================================== */
    sortBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sortBtns.forEach(b => b.classList.remove('sort-btn--active'));
            btn.classList.add('sort-btn--active');
            currentSort = btn.dataset.sort || 'nearest';
            if (currentPharmacyGroups.length > 0) renderSortedResults(currentSort);
        });
    });

    /* ==========================================================================
       SECTION 25 — SEARCH INPUT (debounced, 300ms)  (UNTOUCHED)
       ========================================================================== */
    searchInput && searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();

        if (!query) {
            clearSuggestions();
            showInitialState();
            currentPharmacyGroups = [];
            selectedProductId     = null;
            return;
        }

        debounceTimer = setTimeout(async () => {
            if (!isCompleteWord(query)) { clearSuggestions(); return; }
            const items = await fetchSuggestions(query);
            showSuggestions(items);
        }, 300);
    });

    searchInput && searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && suggestionBox) {
            const first = suggestionBox.querySelector('.suggestion-item');
            if (first) {
                e.preventDefault();
                selectProduct(first.dataset.productId, first.textContent.trim());
            }
        }
        if (e.key === 'Escape') clearSuggestions();
    });

    document.addEventListener('click', e => {
        if (!searchInput?.contains(e.target) && !suggestionBox?.contains(e.target)) {
            clearSuggestions();
        }
    });

    /* ==========================================================================
       SECTION 26 — LOGOUT  (UNTOUCHED)
       ========================================================================== */
    logoutBtn && logoutBtn.addEventListener('click', async e => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ==========================================================================
       SECTION 27 — SIDEBAR TOGGLE  (UNTOUCHED)
       ========================================================================== */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    const openSidebar  = () => { sidebar?.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; };
    const closeSidebar = () => { sidebar?.classList.remove('sidebar--open'); document.body.style.overflow = ''; };

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar?.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* ==========================================================================
       SECTION 28 — AUTO-SEARCH FROM URL PARAM  (UNTOUCHED)
       ========================================================================== */
    async function autoSearchFromUrl() {
        const params    = new URLSearchParams(window.location.search);
        const queryName = params.get('q');
        const queryPid  = params.get('pid');

        if (!queryName) return;

        if (queryPid) {
            searchInput.value = queryName;
            selectProduct(queryPid, queryName);
            return;
        }

        try {
            const { data } = await supabaseClient
                .from('products')
                .select('id, product_name, strength, dosage_form')
                .ilike('product_name', queryName.trim())
                .limit(1)
                .maybeSingle();

            if (data) {
                const label = buildProductLabel(data);
                searchInput.value = label;
                selectProduct(data.id, label);
            }
        } catch (_) {}
    }

    /* ==========================================================================
       ============================================================================
       PRESCRIPTION SCANNER — SECTIONS 29–41
       Preserved exactly from v6.0 / v8.0. Zero changes.
       ============================================================================
       ========================================================================== */

    /* ==========================================================================
       SECTION 29 — CREATE HIDDEN FILE INPUT
       ========================================================================== */
    function createHiddenFileInput() {
        const input         = document.createElement('input');
        input.type          = 'file';
        input.accept        = 'image/jpeg,image/png,image/webp,image/gif';
        input.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
        document.body.appendChild(input);
        return input;
    }

    /* ==========================================================================
       SECTION 30 — UPLOAD PRESCRIPTION BUTTON
       ========================================================================== */
    uploadPrescriptionBtn && uploadPrescriptionBtn.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

    /* ==========================================================================
       SECTION 31 — FILE INPUT CHANGE — main scan pipeline
       ========================================================================== */
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
            updateScanningOverlay(5, 'Enhancing image...');
            const processedFile = await preprocessImageForOCR(file);

            updateScanningOverlay(10, 'Scanning prescription (Pass 1)...');
            const rawText1 = await runOCR(processedFile, 4, pct =>
                updateScanningOverlay(10 + Math.round(pct * 0.35))
            );

            updateScanningOverlay(45, 'Scanning prescription (Pass 2)...');
            const rawText2 = await runOCR(processedFile, 6, pct =>
                updateScanningOverlay(45 + Math.round(pct * 0.35))
            );

            const rawText  = mergeOCRResults(rawText1, rawText2);

            updateScanningOverlay(82, 'Analysing prescription lines...');
            const foundNames = await extractMedicineNames(rawText);

            hideScanningOverlay();

            if (foundNames.length === 0) {
                alert('No recognisable medicine names found.\n\nTips:\n• Ensure image is well-lit and in focus\n• Hold camera steady\n• Crop to show only the Rx section\n\nOr use the search bar to search manually.');
                return;
            }

            renderPrescriptionQueue(foundNames);

            savePrescriptionToVault(file, session.user.id).catch(err =>
                console.warn('Vault save error:', err.message)
            );

            for (const name of foundNames) logSearch(name);
            await resolveAndSelectByName(foundNames[0]);

        } catch (err) {
            hideScanningOverlay();
            console.error('Prescription scan error:', err);
            alert('Scan failed: ' + err.message + '\nPlease try a clearer photo.');
        }
    });

    /* ==========================================================================
       SECTION 31-B — RESOLVE MEDICINE NAME → product_id → selectProduct
       ========================================================================== */
    async function resolveAndSelectByName(productName) {
        try {
            const { data } = await supabaseClient
                .from('products')
                .select('id, product_name, strength, dosage_form')
                .or([
                    `product_name.ilike.%${productName}%`,
                    `generic_name.ilike.%${productName}%`,
                    `brand.ilike.%${productName}%`,
                ].join(','))
                .limit(1)
                .maybeSingle();

            if (data) {
                const label = buildProductLabel(data);
                searchInput.value = label;
                selectProduct(data.id, label);
            } else {
                searchInput.value = productName;
                showEmptyState(`"${productName}" was not found in the medicine catalogue.`);
            }
        } catch (err) {
            console.warn('resolveAndSelectByName error:', err.message);
        }
    }

    /* ==========================================================================
       SECTION 32 — IMAGE PRE-PROCESSING FOR OCR
       ========================================================================== */
    async function preprocessImageForOCR(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const scale  = Math.max(1, 1200 / img.width);
                const width  = Math.round(img.width  * scale);
                const height = Math.round(img.height * scale);

                const canvas    = document.createElement('canvas');
                canvas.width    = width;
                canvas.height   = height;
                const ctx       = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const imageData = ctx.getImageData(0, 0, width, height);
                const d         = imageData.data;

                for (let i = 0; i < d.length; i += 4) {
                    const grey    = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
                    const boosted = Math.min(255, Math.max(0, 1.6 * (grey - 128) + 128));
                    d[i] = d[i+1] = d[i+2] = boosted;
                }
                ctx.putImageData(imageData, 0, 0);

                canvas.toBlob(blob => {
                    if (!blob) { resolve(file); return; }
                    resolve(new File([blob], file.name, { type: 'image/png' }));
                }, 'image/png');
            };

            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    /* ==========================================================================
       SECTION 33 — MERGE OCR RESULTS FROM TWO PASSES
       ========================================================================== */
    function mergeOCRResults(text1, text2) {
        const lines1 = (text1 || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const lines2 = (text2 || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const merged = new Map();

        const addLine = line => {
            const key = line.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!key || key.length < 3) return;
            const existing = merged.get(key);
            if (!existing || line.length > existing.length) merged.set(key, line);
        };

        lines1.forEach(addLine);
        lines2.forEach(addLine);
        return Array.from(merged.values()).join('\n');
    }

    /* ==========================================================================
       SECTION 34 — RUN OCR (Tesseract.js)
       ========================================================================== */
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

        await worker.setParameters({
            tessedit_pageseg_mode:    String(psmMode),
            tessedit_char_whitelist:  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -.:/()&',
            preserve_interword_spaces: '1',
        });

        const { data } = await worker.recognize(file);
        await worker.terminate();
        return data.text;
    }

    /* ==========================================================================
       SECTION 35 — LEVENSHTEIN DISTANCE
       ========================================================================== */
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

    /* ==========================================================================
       SECTION 36 — SMART NAME NORMALISER
       ========================================================================== */
    function normaliseName(str, fixOCRDigits) {
        let s = String(str || '').toLowerCase();
        if (fixOCRDigits) {
            s = s
                .replace(/\b0(?=[a-z])/g,  'o')
                .replace(/(?<=[a-z])0\b/g, 'o')
                .replace(/1(?=[a-z])/g,    'i')
                .replace(/5(?=[a-z])/g,    's');
        }
        const TRAILING_FORM = /\s+(?:tablets?|tabs?|capsules?|caps?|syrup|syp|drops?|injection|solution|cream|ointment|gel|suspension|lotion|spray|inhaler|powder|sachet|patch)\s*$/gi;
        s = s.replace(TRAILING_FORM, '').replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
        return s;
    }

    /* ==========================================================================
       SECTION 37 — EXTRACT MEDICINE NAMES FROM OCR TEXT
       ========================================================================== */
    const RX_PREFIXES = [
        'SYRUP','SYP','TABLET','TABLETS','TAB','CAPSULE','CAPSULES','CAP','CAPS',
        'INJECTION','INJ','EYE DROPS','EAR DROPS','EYE','EAR',
        'GEL','CREAM','CRM','OINTMENT','OINT','OIN',
        'SUSPENSION','SUSP','SOLUTION','SOL','LOTION','LOT',
        'SUPPOSITORY','SUPP','DROPS','SPRAY','INHALER','INH',
        'SACHET','PATCH','POWDER','PWD','LIQUID','LIQ',
        'NASAL','TOPICAL','ORAL','IV','IM','SC',
    ];

    const RX_PREFIX_RE = new RegExp(
        '^\\s*(?:R\\/|Rx\\.?|R:)?\\s*(' +
        RX_PREFIXES.map(p => p.replace(/\s+/g, '\\s+')).join('|') +
        ')[.:\\s]+', 'i'
    );

    const NOISE_LINE_RE = new RegExp(
        '^[\\d\\s\\.,\\+\\-\\/\\\\\\(\\)\\[\\]\\%' +
        '\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF' +
        ']+$'
    );

    const TRAILING_DOSE_RE = new RegExp(
        '[\\s\\-]+\\d[\\d\\s\\.\\/]*\\s*' +
        '(?:mg|mcg|ml|g|iu|units?|tabs?|caps?|drops?)[\\s\\d]*$', 'i'
    );

    const HEADER_LINE_RE = new RegExp(
        '^\\s*(?:patient|name|gender|age|weight|height|b\\.?p\\.?|pulse|temp|' +
        'city|date|address|dr\\.|doctor|hospital|clinic|phone|tel|' +
        'ref|diagnosis|clinical|tests?|investigation|vitals?|male|female|' +
        '\\d{2,}[\\/\\-]\\d{2,})', 'i'
    );

    const NOISE_WORDS = /^(and|or|with)\s+|\s+(and|or|with)$/gi;

    function tokeniseField(raw, splitChar) {
        if (!raw) return new Set();
        return new Set(
            String(raw).split(splitChar)
                .map(t => t.replace(NOISE_WORDS, '').trim().toLowerCase())
                .filter(Boolean)
        );
    }

    function setsOverlap(setA, setB) {
        if (!setA.size || !setB.size) return false;
        for (const token of setA) { if (setB.has(token)) return true; }
        return false;
    }

    function pickBestMatch(rows, normalisedQuery) {
        let best = null, bestDist = Infinity;
        rows.forEach(row => {
            const dbNorm = normaliseName(row[COL.product_name] || '', false);
            const dist   = levenshtein(normalisedQuery, dbNorm);
            if (dist < bestDist) { bestDist = dist; best = row[COL.product_name]; }
        });
        return best;
    }

    async function extractMedicineNames(rawText) {
        if (!rawText?.trim()) return [];

        /* Phase 1 — Filter lines */
        const allLines      = rawText.split(/\r?\n/);
        const filteredLines = [];
        let inRxSection     = false;

        for (const l of allLines) {
            const line = l.trim();
            if (line.length < 3) continue;
            if (/^R[x\/]\.?\s*$/i.test(line)) { inRxSection = true; continue; }
            if (NOISE_LINE_RE.test(line) || HEADER_LINE_RE.test(line)) continue;
            if ((line.match(/[a-zA-Z]/g) || []).length < 3) continue;
            filteredLines.push({ line, inRx: inRxSection });
        }

        if (!filteredLines.length) return [];

        /* Phase 2+3 — Extract and normalise candidates */
        const candidates = [];
        for (const { line, inRx } of filteredLines) {
            let candidate = null;
            const pfxMatch = line.match(RX_PREFIX_RE);

            if (pfxMatch) {
                candidate = line.slice(pfxMatch[0].length).trim();
            } else if (inRx) {
                candidate = line.replace(/^[^a-zA-Z]+/, '').trim();
            } else {
                const tokens   = line.split(/\s+/);
                const capsCount = tokens.filter(t => /^[A-Z]{2,}/.test(t)).length;
                if (capsCount >= 1) candidate = line.replace(/^[^a-zA-Z]+/, '').trim();
            }

            if (!candidate || candidate.length < 3) continue;

            candidate = candidate
                .replace(TRAILING_DOSE_RE, '')
                .split(/\s{2,}|\t|\/\//)[0]
                .trim();

            if (candidate.length >= 3) {
                candidates.push(normaliseName(candidate, true));
            }
        }

        if (!candidates.length) return [];

        /* Phase 4 — 4-tier fuzzy DB matching */
        const orderedNames = [];
        const seenProducts = {};

        for (const normalised of candidates) {
            if (!normalised || normalised.length < 3) continue;

            const sigWords = normalised.split(/\s+/).filter(w => w.length >= 4);
            if (!sigWords.length) continue;

            let matched = null;

            /* Query A — exact prefix match */
            try {
                const { data: resA } = await supabaseClient
                    .from('products')
                    .select('product_name')
                    .ilike('product_name', sigWords[0] + '%')
                    .limit(10);
                if (resA?.length) matched = pickBestMatch(resA, normalised);
            } catch (_) {}

            /* Query B — all significant words AND brand */
            if (!matched && sigWords.length >= 2) {
                try {
                    let q = supabaseClient.from('products').select('product_name').limit(20);
                    sigWords.slice(0, 3).forEach(w => { q = q.ilike('product_name', `%${w}%`); });
                    const { data: resB } = await q;
                    if (resB?.length) matched = pickBestMatch(resB, normalised);
                } catch (_) {}
            }

            /* Query C — first word in generic_name overlap */
            if (!matched) {
                try {
                    const { data: resC } = await supabaseClient
                        .from('products')
                        .select('product_name, generic_name')
                        .ilike('generic_name', `%${sigWords[0]}%`)
                        .limit(20);
                    if (resC?.length) {
                        const srcGN = tokeniseField(normalised, ' ');
                        const filtered = resC.filter(r => {
                            const dbGN = tokeniseField(normaliseName(r.generic_name, false), ' ');
                            return setsOverlap(srcGN, dbGN);
                        });
                        if (filtered.length) matched = pickBestMatch(filtered, normalised);
                    }
                } catch (_) {}
            }

            /* Query D — Levenshtein fuzzy fallback */
            if (!matched && sigWords[0].length >= 4) {
                try {
                    const { data: resD } = await supabaseClient
                        .from('products')
                        .select('product_name')
                        .ilike('product_name', sigWords[0].slice(0, 3) + '%')
                        .limit(40);
                    if (resD?.length) {
                        let bestD = null, bestDistD = Infinity;
                        resD.forEach(row => {
                            const dbNorm = normaliseName(row.product_name, false);
                            const dist   = levenshtein(normalised, dbNorm);
                            const maxD   = Math.floor(Math.max(normalised.length, dbNorm.length) * 0.35);
                            if (dist < bestDistD && dist <= maxD) { bestDistD = dist; bestD = row.product_name; }
                        });
                        if (bestD) matched = bestD;
                    }
                } catch (_) {}
            }

            if (matched) {
                const key = matched.toLowerCase().trim();
                if (!seenProducts[key]) { seenProducts[key] = true; orderedNames.push(matched); }
            }
        }

        return orderedNames;
    }

    /* ==========================================================================
       SECTION 38 — PRESCRIPTION QUEUE BAR
       ========================================================================== */
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
                    Prescription Scan — ${names.length} medicine${names.length !== 1 ? 's' : ''} found
                </span>
                <button class="prescription-queue__close" id="closeQueueBtn" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <div class="prescription-queue__tabs" id="queueTabs">
                ${names.map((name, i) => `
                    <button class="queue-tab${i === 0 ? ' queue-tab--active' : ''}"
                            data-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
                        ${escapeHtml(name)}
                    </button>`).join('')}
            </div>`;

        const resultsHeader = document.querySelector('.results-header');
        if (resultsHeader) resultsHeader.parentNode.insertBefore(bar, resultsHeader);
        else document.querySelector('.main')?.appendChild(bar);

        bar.querySelectorAll('.queue-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                bar.querySelectorAll('.queue-tab').forEach(t => t.classList.remove('queue-tab--active'));
                tab.classList.add('queue-tab--active');
                resolveAndSelectByName(tab.dataset.name);
            });
        });

        document.getElementById('closeQueueBtn')?.addEventListener('click', () => {
            bar.remove();
            searchInput.value     = '';
            selectedProductId     = null;
            currentPharmacyGroups = [];
            showInitialState();
        });
    }

    /* ==========================================================================
       SECTION 39 — SAVE PRESCRIPTION TO VAULT
       ========================================================================== */
    async function savePrescriptionToVault(file, userId) {
        const timestamp   = Date.now();
        const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${userId}/${timestamp}_${safeName}`;

        const { error: upErr } = await supabaseClient.storage
            .from('prescriptions')
            .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (upErr) throw new Error('Storage upload failed: ' + upErr.message);

        const { data: urlData } = supabaseClient.storage
            .from('prescriptions')
            .getPublicUrl(storagePath);

        const { error: insErr } = await supabaseClient
            .from('user_prescriptions')
            .insert({
                user_id:   userId,
                file_name: file.name,
                file_url:  urlData?.publicUrl || '',
                file_size: file.size,
            });

        if (insErr) throw new Error('DB insert failed: ' + insErr.message);

        await supabaseClient.rpc('prune_prescriptions', { p_user_id: userId });
    }

    /* ==========================================================================
       SECTION 40 — SCANNING OVERLAY
       ========================================================================== */
    function showScanningOverlay(pct, label) {
        label = label || 'Scanning prescription...';
        let overlay = document.getElementById('scanOverlay');
        if (!overlay) {
            overlay    = document.createElement('div');
            overlay.id = 'scanOverlay';
            overlay.innerHTML = `
                <div class="scan-overlay__box">
                    <i class="fa-solid fa-spinner fa-spin scan-overlay__spinner"></i>
                    <p class="scan-overlay__label" id="scanLabel">${label}</p>
                    <p class="scan-overlay__pct"   id="scanPct">${pct}%</p>
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
        document.getElementById('scanOverlay')?.remove();
    }

    /* ==========================================================================
       SECTION 41 — XSS PREVENTION HELPER  (UNTOUCHED)
       ========================================================================== */
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,  '&amp;')
            .replace(/</g,  '&lt;')
            .replace(/>/g,  '&gt;')
            .replace(/"/g,  '&quot;')
            .replace(/'/g,  '&#39;');
    }

    /* ==========================================================================
       INIT
       ========================================================================== */
    initPage();
    autoSearchFromUrl();

})();
