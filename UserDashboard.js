/* =============================================
   MediFinder — UserDashboard.js  v3.0
   ─────────────────────────────────────────────
   CHANGES IN v3.0 (reverts v2.0 JSONB approach):
   • loadRecentSearches() queries multi-row table:
     SELECT product_name, category, searched_at
     ORDER BY searched_at DESC LIMIT 3.
     Uses the composite index (user_id, searched_at
     DESC) for fast indexed reads.
   • Reads row.product_name / row.category /
     row.searched_at directly — no JSONB unpacking.
   ============================================= */

/* =============================================
   1. AUTH GUARD + USER PROFILE LOADER
   ─────────────────────────────────────────────
   No session → redirect to Login.html.
   Session OK → load name / email / avatar
   and fetch recent searches.
   ============================================= */
async function initDashboard() {

    const { data: { session }, error: sessionError } =
        await supabaseClient.auth.getSession();

    if (sessionError || !session) {
        window.location.href = 'Login.html';
        return;
    }

    try {
        const { data: profile, error: profileError } = await supabaseClient
            .from('users')
            .select('first_name, last_name, city, profile_img')
            .eq('id', session.user.id)
            .single();

        if (profileError) throw profileError;

        const firstName = profile.first_name || 'User';
        const fullName  = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const email     = session.user.email;

        /* ── Welcome message ── */
        const welcomeEl = document.querySelector('.topbar__welcome h1');
        if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}!`;

        /* ── Sidebar text ── */
        const userNameEl  = document.querySelector('.user-name');
        const userEmailEl = document.querySelector('.user-email');
        if (userNameEl)  userNameEl.textContent  = fullName || 'User';
        if (userEmailEl) userEmailEl.textContent = email    || '';

        /* ── Sidebar avatar ── */
        renderSidebarAvatar(profile.profile_img || null);

    } catch (err) {
        console.error('Profile load error:', err.message);
    }

    /* ── Load recent searches panel (parallel, non-blocking) ── */
    loadRecentSearches(session.user.id);
}

/* =============================================
   2. RECENT SEARCHES LOADER
   ─────────────────────────────────────────────
   Fetches the 3 most-recent rows from
   user_search_history using the composite index
   on (user_id, searched_at DESC).

   Each rendered item:
     • Medicine name  (product_name)
     • Category       (category, fallback "Medicine")
     • Relative time  ("2 hours ago", "Yesterday"…)
     • Clickable      → UserPharmacySearch.html?q=name
   ============================================= */
async function loadRecentSearches(userId) {
    const listEl = document.getElementById('recentSearchList');
    if (!listEl) return;

    try {
        const { data, error } = await supabaseClient
            .from('user_search_history')
            .select('product_name, category, searched_at')
            .eq('user_id', userId)
            .order('searched_at', { ascending: false })
            .limit(3);

        if (error) throw error;

        const rows = data || [];

        if (rows.length === 0) {
            listEl.innerHTML = `
                <li class="search-item">
                    <div class="search-item__icon">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </div>
                    <div class="search-item__info">
                        <span class="search-item__name" style="color:var(--gray-mid)">No searches yet</span>
                        <span class="search-item__meta">Your recent searches will appear here</span>
                    </div>
                </li>`;
            return;
        }

        listEl.innerHTML = rows.map(row => {
            const name     = row.product_name || '—';
            const category = row.category     || 'Medicine';
            const timeAgo  = formatTimeAgo(row.searched_at);
            const encoded  = encodeURIComponent(name);

            return `
            <li class="search-item"
                role="button"
                tabindex="0"
                title="Search again for ${escapeHtml(name)}"
                onclick="window.location.href='UserPharmacySearch.html?q=${encoded}'"
                onkeydown="if(event.key==='Enter')window.location.href='UserPharmacySearch.html?q=${encoded}'"
                style="cursor:pointer">
                <div class="search-item__icon">
                    <i class="fa-solid fa-magnifying-glass"></i>
                </div>
                <div class="search-item__info">
                    <span class="search-item__name">${escapeHtml(name)}</span>
                    <span class="search-item__meta">${escapeHtml(category)} &bull; ${timeAgo}</span>
                </div>
                <a href="UserPharmacySearch.html?q=${encoded}"
                   class="search-item__arrow"
                   aria-label="Search again for ${escapeHtml(name)}"
                   onclick="event.stopPropagation()">
                    <i class="fa-solid fa-chevron-right"></i>
                </a>
            </li>`;
        }).join('');

    } catch (err) {
        console.warn('Recent searches load error:', err.message);
        if (listEl) {
            listEl.innerHTML = `
                <li class="search-item">
                    <div class="search-item__info">
                        <span class="search-item__name" style="color:var(--gray-mid)">
                            Could not load recent searches
                        </span>
                    </div>
                </li>`;
        }
    }
}

/* =============================================
   3. SIDEBAR AVATAR RENDERER
   ─────────────────────────────────────────────
   Shows Supabase profile photo if available,
   else falls back to Images/ProfileAvatar.jpg.
   ============================================= */
function renderSidebarAvatar(profileImgUrl) {
    const avatarEl = document.querySelector('.user-avatar');
    if (!avatarEl) return;

    avatarEl.innerHTML = '';

    const img = document.createElement('img');
    img.alt   = 'User Avatar';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';

    img.onerror = () => {
        if (!img.src.includes('ProfileAvatar')) {
            img.src = 'Images/ProfileAvatar.jpg';
        } else {
            avatarEl.innerHTML =
                '<span style="color:white;font-size:14px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">U</span>';
        }
    };

    img.src = profileImgUrl || 'Images/ProfileAvatar.jpg';
    avatarEl.appendChild(img);
}

/* =============================================
   4. UTILITY HELPERS
   ============================================= */

/* Human-readable relative time ("2 hours ago", "Yesterday", "3 days ago") */
function formatTimeAgo(isoString) {
    if (!isoString) return '';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins  <  1) return 'Just now';
    if (mins  < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`;
    if (hours <  2) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    if (days  ===1) return 'Yesterday';
    if (days  < 30) return `${days} days ago`;
    return new Date(isoString).toLocaleDateString('en-PK', { day:'numeric', month:'short' });
}

/* Prevent XSS when injecting user-controlled data into innerHTML */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

/* =============================================
   5. LOGOUT
   ============================================= */
const logoutBtn = document.querySelector('.user-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });
}

/* =============================================
   6. SIDEBAR TOGGLE (Mobile hamburger)
   ============================================= */
(function () {
    'use strict';

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
})();

/* ── Run on page load ── */
initDashboard();
