/* =============================================
   MediFinder — UserHistory.js  v3.0
   ─────────────────────────────────────────────
   CHANGES IN v3.0 (reverts v2.0 JSONB approach):
   • loadHistory() now queries multi-row relational
     table: SELECT product_name, category,
     searched_at ORDER BY searched_at DESC LIMIT 20.
     Uses composite index (user_id, searched_at DESC)
     for O(log n) reads — no full table scan.
   • Field names match table columns directly —
     no JSONB mapping/normalisation layer needed.
   • renderLastSearch / renderMostFrequent /
     renderTable unchanged — they already consumed
     the { product_name, category, searched_at }
     shape so zero changes needed there.
   ============================================= */

(function () {
    'use strict';

    /* =============================================
       CONSTANTS
       ============================================= */
    const PAGE_SIZE          = 8;   // rows shown per page
    const SEARCH_HISTORY_MAX = 20;  // max rows stored per user (enforced by DB prune)

    /* =============================================
       DOM REFERENCES
       ============================================= */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    /* =============================================
       1. SIDEBAR MOBILE TOGGLE
       ============================================= */
    function openSidebar()  { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* =============================================
       2. AUTH GUARD + PAGE INIT
       ============================================= */
    async function initPage() {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) { window.location.href = 'Login.html'; return; }

        /* Load sidebar profile */
        try {
            const { data: profile } = await supabaseClient
                .from('users')
                .select('first_name, last_name, profile_img')
                .eq('id', session.user.id)
                .single();

            if (profile) {
                const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
                const nameEl  = document.getElementById('sidebarUserName');
                const emailEl = document.getElementById('sidebarUserEmail');
                if (nameEl)  nameEl.textContent  = fullName || 'User';
                if (emailEl) emailEl.textContent = session.user.email || '';
                renderSidebarAvatar(profile.profile_img || null);
            }
        } catch (err) {
            console.warn('Profile load error:', err.message);
        }

        /* Load all search history for this user */
        loadHistory(session.user.id);
    }

    /* =============================================
       3. SIDEBAR AVATAR RENDERER
       ============================================= */
    function renderSidebarAvatar(profileImgUrl) {
        const avatarEl = document.querySelector('.user-avatar');
        if (!avatarEl) return;

        const fallback = avatarEl.querySelector('.user-avatar__fallback');
        const existing = avatarEl.querySelector('img');
        if (existing) existing.remove();

        const img = document.createElement('img');
        img.alt   = 'User Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;position:relative;z-index:1;';

        img.onerror = () => { img.remove(); if (fallback) fallback.style.display = 'flex'; };
        img.onload  = () => { if (fallback) fallback.style.display = 'none'; };

        img.src = profileImgUrl || 'Images/ProfileAvatar.jpg';
        avatarEl.insertBefore(img, avatarEl.firstChild);
    }

    /* =============================================
       4. LOAD HISTORY (main data fetch)
       ─────────────────────────────────────────────
       Fetches up to 20 rows for this user ordered
       newest-first using the composite index on
       (user_id, searched_at DESC) — O(log n), no
       full table scan.

       Fields returned match table columns directly:
         product_name, category, searched_at

       Derives from the result set:
         • Last Search    — rows[0]  (newest-first)
         • Most Frequent  — most-common product_name
         • Paginated table — 8 rows per page
       ============================================= */
    async function loadHistory(userId) {
        try {
            const { data, error } = await supabaseClient
                .from('user_search_history')
                .select('product_name, category, searched_at')
                .eq('user_id', userId)
                .order('searched_at', { ascending: false })
                .limit(SEARCH_HISTORY_MAX);

            if (error) throw error;

            const rows = data || [];

            renderLastSearch(rows);
            renderMostFrequent(rows);
            renderTable(rows, 1);

        } catch (err) {
            console.error('History load error:', err.message);
            renderTableError();
        }
    }

    /* =============================================
       5. LAST SEARCH
       ─────────────────────────────────────────────
       rows are already newest-first, so rows[0]
       is the most recent.
       ============================================= */
    function renderLastSearch(rows) {
        const el = document.getElementById('lastSearchValue');
        if (!el) return;
        el.textContent = rows.length > 0 ? rows[0].product_name : 'No searches yet';
    }

    /* =============================================
       6. MOST FREQUENT
       ─────────────────────────────────────────────
       Count occurrences of each product_name across
       all rows. The one with the highest count wins.
       Ties broken by whichever appears first in the
       frequency map (i.e., most recently searched).
       ============================================= */
    function renderMostFrequent(rows) {
        const el = document.getElementById('mostFrequentName');
        if (!el) return;

        if (rows.length === 0) {
            el.textContent = 'No data yet';
            return;
        }

        const freq = {};
        rows.forEach(r => {
            const key = (r.product_name || '').trim().toLowerCase();
            if (!key) return;
            if (!freq[key]) freq[key] = { name: r.product_name, count: 0 };
            freq[key].count++;
        });

        const top = Object.values(freq).sort((a, b) => b.count - a.count)[0];
        el.textContent = top ? top.name : '—';
    }

    /* =============================================
       7. RENDER TABLE (paginated)
       ─────────────────────────────────────────────
       Slices rows for the requested page and injects
       them into #historyTableBody. Renders the page
       slider below the table.
       ============================================= */
    const ICON_PALETTE = [
        { cls: 'med-icon--indigo', icon: 'fa-kit-medical' },
        { cls: 'med-icon--red',    icon: 'fa-pills' },
        { cls: 'med-icon--amber',  icon: 'fa-eye' },
        { cls: 'med-icon--cyan',   icon: 'fa-droplet' },
        { cls: 'med-icon--pink',   icon: 'fa-pump-soap' },
        { cls: 'med-icon--green',  icon: 'fa-capsules' },
        { cls: 'med-icon--purple', icon: 'fa-syringe' },
        { cls: 'med-icon--teal',   icon: 'fa-heart-pulse' },
    ];

    function getIconStyle(index) {
        return ICON_PALETTE[index % ICON_PALETTE.length];
    }

    function renderTable(rows, page) {
        const bodyEl   = document.getElementById('historyTableBody');
        const sliderEl = document.getElementById('paginationSlider');
        if (!bodyEl) return;

        const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        const safePage   = Math.min(Math.max(1, page), totalPages);
        const start      = (safePage - 1) * PAGE_SIZE;
        const pageRows   = rows.slice(start, start + PAGE_SIZE);

        /* ── Table rows ── */
        if (rows.length === 0) {
            bodyEl.innerHTML = `
                <li class="history-row history-row--empty">
                    <div class="history-row__query">
                        <div class="med-icon med-icon--indigo">
                            <i class="fa-solid fa-magnifying-glass"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name" style="color:var(--gray-mid)">No searches yet</span>
                            <span class="med-info__sub">Search for medicines to see history here</span>
                        </div>
                    </div>
                </li>`;
        } else {
            bodyEl.innerHTML = pageRows.map((row, i) => {
                const globalIndex = start + i;
                const palette     = getIconStyle(globalIndex);
                const category    = row.category || 'Medicine';
                const dateStr     = formatDate(row.searched_at);

                return `
                <li class="history-row">
                    <div class="history-row__query">
                        <div class="med-icon ${palette.cls}">
                            <i class="fa-solid ${palette.icon}"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name">${escapeHtml(row.product_name || '—')}</span>
                            <span class="med-info__sub">${escapeHtml(category)}</span>
                        </div>
                    </div>
                    <span class="history-row__category">Search</span>
                    <span class="history-row__date">${dateStr}</span>
                </li>`;
            }).join('');
        }

        /* ── Page slider ── */
        if (!sliderEl) return;

        if (totalPages <= 1) {
            sliderEl.innerHTML = '';
            return;
        }

        sliderEl.innerHTML = `
            <div class="page-slider">
                <button class="page-btn page-btn--prev"
                    ${safePage === 1 ? 'disabled' : ''}
                    aria-label="Previous page">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <span class="page-info">Page <strong>${safePage}</strong> of <strong>${totalPages}</strong></span>
                <button class="page-btn page-btn--next"
                    ${safePage === totalPages ? 'disabled' : ''}
                    aria-label="Next page">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>`;

        sliderEl.querySelector('.page-btn--prev').addEventListener('click', () => {
            renderTable(rows, safePage - 1);
        });
        sliderEl.querySelector('.page-btn--next').addEventListener('click', () => {
            renderTable(rows, safePage + 1);
        });
    }

    /* =============================================
       8. ERROR STATE
       ============================================= */
    function renderTableError() {
        const bodyEl = document.getElementById('historyTableBody');
        if (bodyEl) {
            bodyEl.innerHTML = `
                <li class="history-row history-row--empty">
                    <div class="history-row__query">
                        <div class="med-icon med-icon--red">
                            <i class="fa-solid fa-circle-exclamation"></i>
                        </div>
                        <div class="med-info">
                            <span class="med-info__name" style="color:var(--red)">Failed to load history</span>
                            <span class="med-info__sub">Check your connection and refresh</span>
                        </div>
                    </div>
                </li>`;
        }
    }

    /* =============================================
       9. LOGOUT
       ============================================= */
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await supabaseClient.auth.signOut();
            window.location.href = 'Login.html';
        });
    }

    /* =============================================
       10. UTILITY HELPERS
       ============================================= */

    /* Format ISO date → "Oct 24, 2024" */
    function formatDate(isoString) {
        if (!isoString) return '—';
        return new Date(isoString).toLocaleDateString('en-US', {
            day:   'numeric',
            month: 'short',
            year:  'numeric',
        });
    }

    /* Prevent XSS */
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

})();
