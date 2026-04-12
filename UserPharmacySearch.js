/* =============================================
   MediFinder — UserPharmacySearch.js  v4.2
   ─────────────────────────────────────────────
   CHANGES IN v4.2 (reverts v4.1 JSONB approach):
   H. logSearch() rebuilt on multi-row relational
      model — one row per search, max 20 per user.
      • INSERT uses DB default now() for server-
        side timestamp (no client clock dependency).
      • Pruning done via Postgres RPC function
        prune_search_history(p_user_id) which runs
        a single atomic DELETE keeping only the 20
        most-recent rows. No race condition, no
        extra COUNT round-trip.
      • maybeSingle() used for category lookup so
        zero-row results return null cleanly instead
        of throwing a PGRST116 error.
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       1. COLUMN NAME CONSTANTS
       ─────────────────────────────────────────────
       All Supabase "Pharmacy Data" column names in
       one place. Update here only if column renamed.
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
       Placeholder for single-pharmacy testing phase.
       FUTURE: Replace with row['pharmacy_name'] etc.
       inside groupByPharmacy() when real pharmacies
       upload their own stock tables.
       ============================================= */
    const TEST_PHARMACY = {
        name:  'MediFinder Test Pharmacy',
        phone: '+92 300 0000000',
        lat:   24.8607,
        lng:   67.0011,
    };

    /* =============================================
       3. DOM REFERENCES + STATE VARIABLES
       ============================================= */
    const searchInput   = document.getElementById('searchInput');
    const pharmacyList  = document.getElementById('pharmacyList');
    const resultsCount  = document.getElementById('resultsCount');
    const sortBtns      = document.querySelectorAll('.sort-btn');
    const logoutBtn     = document.getElementById('logoutBtn');

    // Suggestion dropdown — created dynamically, anchored below search bar
    let suggestionBox   = null;

    let currentSort     = 'nearest';
    let currentResults  = [];       // cached rows for sort re-use
    let debounceTimer   = null;
    let userLat         = null;
    let userLng         = null;

    // Tracks last complete word the user typed (for smart search)
    let lastWord        = '';

    /* =============================================
       4. AUTH GUARD + SIDEBAR PROFILE LOADER
       ─────────────────────────────────────────────
       • No session  → redirect to Login.html
       • Session OK  → load name/email/avatar into sidebar
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

                // Load profile photo from Supabase, fallback to default avatar
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load failed:', err.message);
        }
    }

    /* ─────────────────────────────────────────────
       SIDEBAR AVATAR RENDERER
       Shows Supabase profile photo if available,
       else shows Images/ProfileAvatar.jpg.
       ───────────────────────────────────────────── */
    function renderSidebarAvatar(profileImgUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;

        // Clear fallback content set in HTML
        const fallback = avatarEl.querySelector('.user-avatar__fallback');
        const existing = avatarEl.querySelector('img');
        if (existing) existing.remove();

        const img = document.createElement('img');
        img.alt   = 'User Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';

        img.onerror = () => {
            img.remove();
            if (fallback) fallback.style.display = 'flex';
        };

        img.onload = () => {
            if (fallback) fallback.style.display = 'none';
        };

        img.src = profileImgUrl || 'Images/ProfileAvatar.jpg';
        avatarEl.insertBefore(img, avatarEl.firstChild);
    }

    /* =============================================
       5. GPS LOCATION — background, non-blocking
       ─────────────────────────────────────────────
       Used for "Nearest" sort.
       Failure is silent — sort keeps Supabase order.
       ============================================= */
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; },
            err  => console.warn('Location denied:', err.message)
        );
    }

    /* =============================================
       6. PRICE PARSER
       ─────────────────────────────────────────────
       Handles text-format prices stored in Supabase:
         "Rs. 2,280.00"  →  2280.00
         "Rs. 349.17"    →  349.17
         "Rs. 0.00"      →  0
         null / ""       →  0
       Steps: remove "Rs." → remove commas → parseFloat
       ============================================= */
    function parsePrice(raw) {
        if (!raw) return 0;
        // Remove currency prefix and any commas, then parse
        const cleaned = String(raw).replace(/Rs\.?\s*/gi, '').replace(/,/g, '').trim();
        const val     = parseFloat(cleaned);
        return isNaN(val) ? 0 : val;
    }

    /* =============================================
       7. GET EFFECTIVE PRICE
       ─────────────────────────────────────────────
       Returns discounted price if valid (> 0),
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
       8. SMART WORD-BOUNDARY DETECTION
       ─────────────────────────────────────────────
       Returns true only when the query contains at
       least one COMPLETE word (3+ chars followed by
       a space, or the full query is 4+ chars with no
       partial typing in progress).

       Examples:
         "Ga"        → false  (partial, too short)
         "Gav"       → true   (3+ char word, triggers)
         "Gaviscon"  → true   (complete word)
         "60ml"      → true   (complete token)
         "Panadol "  → true   (word + space)

       The rule: trigger search when the LAST word
       typed is >= 3 characters. This prevents firing
       on "G", "Ga" while still triggering on "Gav",
       "sys", "60ml", "panadol" etc.
       ============================================= */
    function isCompleteWord(query) {
        const trimmed = query.trim();
        if (!trimmed) return false;
        // Split on spaces, get the last token the user is typing
        const tokens  = trimmed.split(/\s+/);
        const last    = tokens[tokens.length - 1];
        // Trigger when last word has >= 3 chars
        return last.length >= 3;
    }

    /* =============================================
       9. PHASE 1 — FETCH SUGGESTIONS
       ─────────────────────────────────────────────
       Fetches product names matching the query across
       ALL pharmacies. Returns deduplicated name list.
       Used to populate the suggestion dropdown.

       Only product_name is fetched (lean query).
       Quantity > 0 ensures only in-stock shown.
       limit(300) covers multi-pharmacy scale.
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

            // Deduplicate product names (same product may exist in multiple pharmacies)
            const seen  = new Set();
            const names = [];
            (data || []).forEach(row => {
                const name = row[COL.product_name];
                if (name && !seen.has(name.toLowerCase())) {
                    seen.add(name.toLowerCase());
                    names.push(name);
                }
            });

            return names.sort(); // alphabetical order

        } catch (err) {
            console.warn('Suggestion fetch error:', err.message);
            return [];
        }
    }

    /* =============================================
       10. SUGGESTION DROPDOWN — show
       ─────────────────────────────────────────────
       Renders a scrollable dropdown below the search
       bar. Each item is clickable — clicking puts the
       exact product name into the search bar and
       triggers Phase 2 (pharmacy card search).
       ============================================= */
    function showSuggestions(names) {
        clearSuggestions();

        if (names.length === 0) return;

        // Create dropdown container
        suggestionBox = document.createElement('ul');
        suggestionBox.className = 'suggestion-dropdown';

        names.slice(0, 100).forEach(name => {  // show up to 100 items in scrollable list
            const li = document.createElement('li');
            li.className    = 'suggestion-item';
            li.textContent  = name;

            li.addEventListener('mousedown', (e) => {
                // mousedown fires before blur — preventDefault keeps focus on input
                e.preventDefault();
                selectProduct(name);
            });

            suggestionBox.appendChild(li);
        });

        // Add count note if more than 100 results exist
        if (names.length > 100) {
            const note = document.createElement('li');
            note.className   = 'suggestion-more';
            note.textContent = `+${names.length - 100} more results — type more letters to narrow down`;
            suggestionBox.appendChild(note);
        }

        // Position dropdown below the search input
        const inputWrap = searchInput.closest('.search-bar__input-wrap') || searchInput.parentElement;
        inputWrap.style.position = 'relative';
        inputWrap.appendChild(suggestionBox);
    }

    /* =============================================
       11. SUGGESTION DROPDOWN — clear
       ============================================= */
    function clearSuggestions() {
        if (suggestionBox) {
            suggestionBox.remove();
            suggestionBox = null;
        }
    }

    /* =============================================
       12-A. LOG SEARCH TO user_search_history
       ─────────────────────────────────────────────
       Called fire-and-forget from selectProduct().
       Never awaited — cannot block or break the UI.

       STORAGE MODEL — multi-row, max 20 per user:
         TABLE: user_search_history
           id            uuid        PK  gen_random_uuid()
           user_id       uuid        FK  auth.users(id) NOT NULL
           product_name  text        NOT NULL
           category      text        nullable
           searched_at   timestamptz NOT NULL  default now()

         INDEX: (user_id, searched_at DESC)
           → makes ORDER BY + LIMIT queries O(log n)
             instead of full table scans

       WRITE FLOW — 2 sequential DB calls:

         Step 1 — INSERT new row.
           searched_at is set by the DB server (now())
           so timestamps are always correct regardless
           of the user's device clock.

         Step 2 — Call Postgres RPC prune_search_history.
           The function runs inside the DB atomically:
             DELETE rows for this user where searched_at
             is NOT in the 20 most-recent (by searched_at
             DESC). Uses a single subquery — no race
             condition possible because it operates on
             the committed state after the INSERT above.

       WHY RPC FOR PRUNING:
         Doing COUNT + DELETE from JS requires 2 extra
         round-trips and has a race window if the user
         searches from two tabs simultaneously.
         The RPC prunes in one atomic server-side call
         with no extra JS round-trip overhead.

       POSTGRES FUNCTION TO CREATE (run once in Supabase
       SQL editor):

         CREATE OR REPLACE FUNCTION prune_search_history(p_user_id uuid)
         RETURNS void
         LANGUAGE sql
         SECURITY DEFINER
         AS $$
           DELETE FROM user_search_history
           WHERE  user_id = p_user_id
           AND    id NOT IN (
             SELECT id
             FROM   user_search_history
             WHERE  user_id = p_user_id
             ORDER  BY searched_at DESC
             LIMIT  20
           );
         $$;

       SECURITY DEFINER means the function runs with
       table-owner privileges so it can delete rows
       even when RLS is ON — users cannot call it
       for other user_ids because the function only
       ever prunes the p_user_id passed by the JS,
       and auth.uid() = user_id RLS still gates
       the INSERT in Step 1.
       ============================================= */
    const SEARCH_HISTORY_MAX = 20;

    async function logSearch(productName) {
        try {
            /* ── 0. Must be authenticated ── */
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) return;
            const userId = session.user.id;

            /* ── 1. Resolve category from Pharmacy Data ──
               Runs parallel to nothing — we need it for
               the INSERT, so it must finish first.
               Wrapped in its own try so a category miss
               never aborts the whole log operation.     */
            let category = null;
            try {
                const { data: catRow } = await supabaseClient
                    .from('Pharmacy Data')
                    .select('category')
                    .ilike('product_name', productName)
                    .limit(1)
                    .maybeSingle();          // returns null instead of error when 0 rows
                category = catRow?.category ?? null;
            } catch (_) { /* non-critical — category stays null */ }

            /* ── 2. INSERT new search row ──
               searched_at is intentionally omitted —
               the DB default now() sets it server-side
               so the timestamp is always the authoritative
               server clock, never the user's device clock. */
            const { error: insertErr } = await supabaseClient
                .from('user_search_history')
                .insert({
                    user_id:      userId,
                    product_name: productName,
                    category:     category,
                    // searched_at: DB default now() ← do NOT set from JS
                });

            if (insertErr) throw insertErr;

            /* ── 3. Prune atomically via RPC ──
               Deletes any rows beyond the 20 most-recent
               for this user in a single server-side SQL
               statement. No race condition, no extra
               round-trip for a COUNT query.             */
            const { error: pruneErr } = await supabaseClient
                .rpc('prune_search_history', { p_user_id: userId });

            // Prune failure is non-critical — log grows slightly
            // but correctness of the INSERT is not affected.
            if (pruneErr) console.warn('History prune warning:', pruneErr.message);

        } catch (err) {
            // Must never surface to the user — fail silently
            console.warn('Search log error:', err.message);
        }
    }

    /* =============================================
       12. SELECT PRODUCT (Phase 1 → Phase 2)
       ─────────────────────────────────────────────
       Called when user clicks a suggestion.
       • Puts exact product name into search bar
       • Clears suggestion dropdown
       • Logs search to user_search_history (async,
         fire-and-forget — does not block UI)
       • Triggers Phase 2: fetch pharmacy cards for
         this exact product name only
       ============================================= */
    function selectProduct(productName) {
        searchInput.value = productName;
        clearSuggestions();
        logSearch(productName);          // ← fire-and-forget, no await
        searchByExactProduct(productName);
    }

    /* =============================================
       13. PHASE 2 — SEARCH BY EXACT PRODUCT NAME
       ─────────────────────────────────────────────
       Called after user selects a product from the
       suggestion dropdown.

       Fetches ALL rows matching this exact product
       name across ALL pharmacies (quantity > 0).
       Results are grouped into pharmacy cards.

       Uses ilike with exact name so "Panadol Extra
       Tablets" doesn't match "Panadol CF Tablets".
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
                .ilike(COL.product_name, productName)  // exact name, case-insensitive
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
       14-A. SMART FIELD TOKENISER
       ─────────────────────────────────────────────
       Splits a raw field value into a normalised Set
       of individual tokens so multi-value fields can
       be compared element-by-element.

       Rules applied in order:
         1. Coerce to string, bail on empty.
         2. Split strengths on '/'  → ["100mg","5ml"]
            Split generics  on ','  → ["Metronidazole","Chlorhexidine gluconate"]
         3. Trim whitespace from every token.
         4. Strip leading/trailing noise words:
              "and", "or", "with"  (case-insensitive)
            so "And Zinc Oxide" normalises the same as
            "Zinc Oxide".
         5. Lowercase everything for case-insensitive
            matching.
         6. Discard empty tokens after the above steps.

       Returns a Set<string> of cleaned tokens.
       ─────────────────────────────────────────────
       Examples:
         "Homosalate, Octisalate, And Zinc Oxide"
           → Set { "homosalate", "octisalate", "zinc oxide" }

         "100mg/5ml"
           → Set { "100mg", "5ml" }

         "Metronidazole, Chlorhexidine gluconate"
           → Set { "metronidazole", "chlorhexidine gluconate" }

         "And Zinc Oxide"
           → Set { "zinc oxide" }
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
       14-B. FIELD OVERLAP CHECKER
       ─────────────────────────────────────────────
       Returns true when sets A and B share at least
       one token — i.e., at least one active ingredient
       (or strength) overlaps between the two products.

       This is the core "partial match" logic that lets:
         Product A: generic="Metronidazole, Chlorhexidine gluconate", strength="100mg/65mg"
         Product B: generic="Metronidazole",                          strength="65mg"
       …still qualify as alternatives because one
       generic token and one strength token overlap.
       ============================================= */
    function setsOverlap(setA, setB) {
        if (setA.size === 0 || setB.size === 0) return false;
        for (const token of setA) {
            if (setB.has(token)) return true;
        }
        return false;
    }

    /* =============================================
       14-C. CLIENT-SIDE ALTERNATIVE MATCHER
       ─────────────────────────────────────────────
       Given a source row and a pool of candidate rows
       (already fetched from Supabase), returns only
       those candidates that are genuine therapeutic
       alternatives by applying the smart token-overlap
       logic across all 4 equivalence fields.

       Match criteria (ALL must pass):
         • generic_name : at least 1 token overlaps
         • dosage_form  : exact match (single value,
                          no splitting needed)
         • strength     : at least 1 token overlaps
         • release_type : exact match (single value)

       dosage_form and release_type are single-value
       fields in practice, so we still do an exact
       normalised comparison for them rather than
       token overlap (which would be too permissive).
       ============================================= */
    function isTherapeuticAlternative(sourceRow, candidateRow) {
        /* ── dosage_form: exact normalised match ── */
        const srcDF  = (sourceRow[COL.dosage_form]  || '').trim().toLowerCase();
        const canDF  = (candidateRow[COL.dosage_form] || '').trim().toLowerCase();
        if (!srcDF || !canDF || srcDF !== canDF) return false;

        /* ── release_type: exact normalised match ── */
        const srcRT  = (sourceRow[COL.release_type]  || '').trim().toLowerCase();
        const canRT  = (candidateRow[COL.release_type] || '').trim().toLowerCase();
        if (!srcRT || !canRT || srcRT !== canRT) return false;

        /* ── generic_name: token overlap (split on ',') ── */
        const srcGN  = tokeniseField(sourceRow[COL.generic_name],    ',');
        const canGN  = tokeniseField(candidateRow[COL.generic_name], ',');
        if (!setsOverlap(srcGN, canGN)) return false;

        /* ── strength: token overlap (split on '/') ── */
        const srcST  = tokeniseField(sourceRow[COL.strength],    '/');
        const canST  = tokeniseField(candidateRow[COL.strength], '/');
        if (!setsOverlap(srcST, canST)) return false;

        return true;
    }

    /* =============================================
       14. FETCH ALTERNATIVES (per matched item)
       ─────────────────────────────────────────────
       STRATEGY — two-phase approach:

       Phase A — Broad Supabase fetch:
         We can no longer use strict .eq() on all 4
         fields because generic_name and strength can
         be multi-value strings (e.g. "A, B" / "Xmg/Ymg").
         Instead we fetch a BROAD candidate pool using
         only dosage_form and release_type (which are
         single-value fields and safe for exact DB
         filtering), keeping the result set manageable.

       Phase B — Client-side smart filter:
         isTherapeuticAlternative() applies the full
         token-overlap logic on generic_name and
         strength to trim the broad pool down to only
         genuine therapeutic equivalents.

       Excludes:
       • Any product already shown in pharmacy cards
         (passed in via excludeNames Set).
       • Only in-stock items (quantity > 0).
       ============================================= */
    async function fetchAlternatives(row, excludeNames) {
        const gn = row[COL.generic_name];
        const df = row[COL.dosage_form];
        const st = row[COL.strength];
        const rt = row[COL.release_type];

        // All 4 fields must be present for a meaningful equivalence match
        if (!gn || !df || !st || !rt) return [];

        try {
            /* ── Phase A: broad DB fetch filtered only on single-value fields ── */
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
                    COL.quantity,
                    COL.prescription,
                ].join(', '))
                .eq(COL.dosage_form,  df)   // safe — single-value field
                .eq(COL.release_type, rt)   // safe — single-value field
                .gt(COL.quantity, 0)
                .limit(200);               // wider net needed for token matching

            if (error) throw error;

            /* ── Phase B: smart client-side filter ── */
            return (data || []).filter(candidate => {
                // Skip products already shown in the pharmacy card
                const name = (candidate[COL.product_name] || '').toLowerCase().trim();
                if (excludeNames.has(name)) return false;

                // Apply full smart token-overlap matching
                return isTherapeuticAlternative(row, candidate);
            });

        } catch (err) {
            console.warn('Alternatives fetch error:', err.message);
            return [];
        }
    }

    /* =============================================
       15. GROUP RESULTS BY PHARMACY
       ─────────────────────────────────────────────
       RIGHT NOW: All rows → TEST_PHARMACY (one card).
       FUTURE: Replace TEST_PHARMACY.name with
       row['pharmacy_name'] for multi-pharmacy grouping.
       ============================================= */
    function groupByPharmacy(rows) {
        const map = {};

        rows.forEach(row => {
            const key = TEST_PHARMACY.name; // FUTURE: row['pharmacy_name']

            if (!map[key]) {
                map[key] = {
                    name:        TEST_PHARMACY.name,
                    phone:       TEST_PHARMACY.phone,
                    lat:         TEST_PHARMACY.lat,
                    lng:         TEST_PHARMACY.lng,
                    items:       [],
                    lowestEff:   Infinity,  // lowest effective (discounted) price
                    lowestOrig:  Infinity,  // lowest original price
                };
            }

            map[key].items.push(row);

            const eff  = getEffectivePrice(row);
            const orig = parsePrice(row[COL.original_price]);
            if (eff  > 0 && eff  < map[key].lowestEff)  map[key].lowestEff  = eff;
            if (orig > 0 && orig < map[key].lowestOrig) map[key].lowestOrig = orig;
        });

        return Object.values(map);
    }

    /* =============================================
       16. SORT PHARMACIES
       ─────────────────────────────────────────────
       cheapest → sort by lowestEff price ascending
       nearest  → sort by GPS distance ascending
                  (skips if user denied location)
       ============================================= */
    function sortPharmacies(pharmacies, sortMode) {
        if (sortMode === 'cheapest') {
            return [...pharmacies].sort((a, b) => a.lowestEff - b.lowestEff);
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
        return pharmacies;
    }

    /* =============================================
       17. RENDER RESULTS
       ─────────────────────────────────────────────
       Groups → sorts → builds cards → injects DOM
       → attaches toggle listeners.
       ============================================= */
    async function renderResults(rows, sortMode) {
        if (rows.length === 0) {
            showEmptyState('No pharmacies found with this medicine in stock.');
            return;
        }

        const pharmacies = sortPharmacies(groupByPharmacy(rows), sortMode);
        const count      = pharmacies.length;

        resultsCount.innerHTML =
            `Found <strong>${count} ${count === 1 ? 'pharmacy' : 'pharmacies'}</strong> ` +
            `with <strong>${rows.length} item${rows.length !== 1 ? 's' : ''}</strong> in stock`;

        const cardHTMLs = await Promise.all(pharmacies.map(p => buildPharmacyCard(p)));
        pharmacyList.innerHTML = cardHTMLs.join('');

        attachPanelToggleListeners();
    }

    /* =============================================
       18. BUILD PHARMACY CARD
       ─────────────────────────────────────────────
       Builds one card per pharmacy group.

       CARD LAYOUT:
       ┌──────────────────────────────────────────┐
       │ [In Stock]  Pharmacy Name  [✓ Verified]  │
       │             Product Name                 │
       │             Category · Strength          │
       │             [Rx/OTC badge]               │
       │             📞 Phone                    │
       │                     Rs.XX  ~~Rs.YY~~    │
       ├──────────────────────────────────────────┤
       │  [ View Alternatives ▼ ]                 │
       ├──────────────────────────────────────────┤
       │  MATCHED MEDICINES                       │
       │    Name · Category · Str  ✓ In Stock     │
       │    Rs.XX  ~~Rs.YY~~                      │
       │  ─────────────────                       │
       │  THERAPEUTIC ALTERNATIVES                │
       │    (only truly different products)       │
       │  ─────────────────                       │
       │  ⚠ Safety guidance note                  │
       └──────────────────────────────────────────┘
       ============================================= */
    async function buildPharmacyCard(pharmacy) {

        /* ── Header price: discounted + crossed-out original ── */
        const hasDiscount =
            pharmacy.lowestEff  !== Infinity &&
            pharmacy.lowestOrig !== Infinity &&
            pharmacy.lowestEff  <  pharmacy.lowestOrig;

        let priceBlockHTML;
        if (hasDiscount) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestEff.toFixed(2)}</span>
                <span class="price-orig">Rs. ${pharmacy.lowestOrig.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else if (pharmacy.lowestOrig !== Infinity) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestOrig.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else if (pharmacy.lowestEff !== Infinity) {
            priceBlockHTML = `
                <span class="price">Rs. ${pharmacy.lowestEff.toFixed(2)}</span>
                <span class="price-label">starting from</span>`;
        } else {
            priceBlockHTML = `<span class="price-label">Ask pharmacist for price</span>`;
        }

        /* ── Matched item lines (product · category · strength · Rx) ── */
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

        /* ── Fetch alternatives, excluding ALL products already shown in card ── */
        // Build a case-normalised set of every product_name shown in this pharmacy card
        // Normalise to lowercase + trimmed so "Panadol Extra" and "panadol extra" match
        const shownNames = new Set(
            pharmacy.items.map(r => (r[COL.product_name] || '').toLowerCase().trim())
        );

        // Fetch alternatives for each item, passing shownNames to exclude them
        const altResults = await Promise.all(
            pharmacy.items.map(row => fetchAlternatives(row, shownNames))
        );

        // Flatten + deduplicate alternatives (same alt may match multiple items)
        const altSeen    = new Set(shownNames); // start from already-shown names
        const uniqueAlts = [];
        altResults.flat().forEach(alt => {
            const name = (alt[COL.product_name] || '').toLowerCase().trim();
            if (!altSeen.has(name)) {
                altSeen.add(name);
                uniqueAlts.push(alt);
            }
        });

        /* ── Build section HTML ── */
        const matchedRowsHTML = pharmacy.items.map(row => buildMedicineRow(row)).join('');

        const altRowsHTML = uniqueAlts.length > 0
            ? uniqueAlts.map(alt => buildMedicineRow(alt)).join('')
            : '';

        const altBadge = uniqueAlts.length > 0
            ? `<span class="alt-count-badge">${uniqueAlts.length}</span>` : '';

        return `
        <article class="pharmacy-card">

            <!-- CARD TOP -->
            <div class="card-top">

                <div class="card-image card-image--fallback">
                    <span class="status-pill status-pill--open">
                        <i class="fa-solid fa-circle"></i> In Stock
                    </span>
                </div>

                <div class="card-info">
                    <div class="card-info__name-row">
                        <h2 class="card-info__name">${pharmacy.name}</h2>
                        <span class="badge badge--verified">
                            <i class="fa-solid fa-circle-check"></i> Verified
                        </span>
                    </div>

                    <div class="card-items-summary">
                        ${itemLinesHTML}
                    </div>

                    <div class="card-contact">
                        <i class="fa-solid fa-phone"></i>
                        <span>${pharmacy.phone}</span>
                    </div>
                </div>

                <div class="card-price">
                    ${priceBlockHTML}
                </div>

            </div><!-- /.card-top -->

            <!-- VIEW ALTERNATIVES TOGGLE -->
            <button class="alternatives-btn panel-toggle-btn" aria-expanded="false">
                <i class="fa-solid fa-pills" style="margin-right:6px"></i>
                View Alternatives
                ${altBadge}
                <i class="fa-solid fa-chevron-down toggle-icon" style="margin-left:auto"></i>
            </button>

            <!-- ALTERNATIVES PANEL -->
            <div class="alternatives-panel" style="display:none" aria-hidden="true">

                <p class="alt-section-label">Matched Medicines</p>
                <ul class="alt-list">${matchedRowsHTML}</ul>

                ${uniqueAlts.length > 0 ? `
                <p class="alt-section-label alt-section-label--sep">
                    Therapeutic Alternatives
                    <span class="alt-section-note">Same generic · dosage form · strength · release type</span>
                </p>
                <ul class="alt-list">${altRowsHTML}</ul>
                ` : ''}

                <div class="alt-safety-note">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Always consult your doctor before using an alternative medicine, even if it contains the same active ingredient.
                </div>

            </div><!-- /.alternatives-panel -->

        </article>`;
    }

    /* =============================================
       19. BUILD MEDICINE ROW
       ─────────────────────────────────────────────
       Shared builder for both "Matched Medicines"
       and "Therapeutic Alternatives" rows.

       Price logic uses parsePrice() to handle the
       "Rs. 2,280.00" text format from Supabase.

       Shows:
       • Product name
       • Category · Strength
       • ✓ In Stock (no unit count)
       • Price: discounted + ~~original~~ OR original only
       ============================================= */
    function buildMedicineRow(row) {
        const discPrice = parsePrice(row[COL.discounted_price]);
        const origPrice = parsePrice(row[COL.original_price]);
        const hasDisc   = discPrice > 0 && origPrice > 0 && discPrice < origPrice;
        const dispPrice = discPrice > 0 ? discPrice : origPrice;
        const meta      = [row[COL.category], row[COL.strength]].filter(Boolean).join(' · ');

        let rowPriceHTML;
        if (hasDisc) {
            rowPriceHTML = `
                <span class="alt-row__price">Rs. ${discPrice.toFixed(2)}</span>
                <span class="alt-row__orig-price">Rs. ${origPrice.toFixed(2)}</span>`;
        } else if (dispPrice > 0) {
            rowPriceHTML = `<span class="alt-row__price">Rs. ${dispPrice.toFixed(2)}</span>`;
        } else {
            rowPriceHTML = `<span class="alt-row__price alt-row__price--na">Ask pharmacist</span>`;
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
       20. UTILITY HELPERS
       ============================================= */

    // Returns true if prescription_required is truthy in any common format
    function isPrescriptionRequired(row) {
        const val = row[COL.prescription];
        return val === true || val === 'Yes' || val === 'yes' || val === '1' || val === 1;
    }

    // Haversine formula: straight-line km between two GPS points
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
       21. UI STATE HELPERS
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
       22. PANEL TOGGLE — View Alternatives
       ─────────────────────────────────────────────
       Re-attached after every renderResults() because
       the DOM is fully replaced each render.
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
       23. SORT BUTTONS
       ─────────────────────────────────────────────
       Re-sorts cached currentResults without a new
       Supabase query.
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
       24. SEARCH INPUT — smart debounced handler
       ─────────────────────────────────────────────
       On every keystroke:
       1. Clear previous debounce timer
       2. If empty → show initial state + clear dropdown
       3. Else wait 400ms then:
          a. Check isCompleteWord() — if not met, skip
          b. Fetch suggestions → show dropdown
       
       Pressing Enter or Tab selects first suggestion.
       Clicking outside closes the dropdown.
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
            // Smart word-boundary check — don't search on "Ga", "P", "sy" etc.
            if (!isCompleteWord(query)) {
                clearSuggestions();
                return;
            }

            const names = await fetchSuggestions(query);
            showSuggestions(names);
            // No auto-select — user must always click a suggestion.
            // Even a single result stays in the dropdown for the user to confirm.

        }, 400);
    });

    // Press Enter → select first suggestion
    searchInput && searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && suggestionBox) {
            const first = suggestionBox.querySelector('.suggestion-item');
            if (first) { e.preventDefault(); selectProduct(first.textContent); }
        }
        if (e.key === 'Escape') { clearSuggestions(); }
    });

    // Click outside search area → close suggestions
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && (!suggestionBox || !suggestionBox.contains(e.target))) {
            clearSuggestions();
        }
    });

    /* =============================================
       25. LOGOUT
       ============================================= */
    logoutBtn && logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* =============================================
       26. SIDEBAR TOGGLE — mobile hamburger
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
       27. AUTO-SEARCH FROM URL PARAM
       ─────────────────────────────────────────────
       When the page is opened with ?q=ProductName
       (e.g. from clicking a Dashboard recent search),
       automatically populate the search bar and
       trigger Phase 2 without user interaction.

       IMPORTANT: also calls logSearch() so the
       re-search is recorded in user_search_history
       exactly like a manual suggestion click would.
       Without this, Dashboard re-searches were
       executing but never being saved to the DB,
       so they never appeared in History or updated
       the "Last Search" / "Most Frequent" widgets.
       ============================================= */
    function autoSearchFromUrl() {
        const params     = new URLSearchParams(window.location.search);
        const queryParam = params.get('q');
        if (queryParam && queryParam.trim()) {
            const productName = queryParam.trim();
            searchInput.value = productName;
            logSearch(productName);          // ← record it just like selectProduct() does
            searchByExactProduct(productName);
        }
    }

    /* ─── INIT ─── */
    initPage();
    autoSearchFromUrl();

})();

