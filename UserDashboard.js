/* =============================================
   MediFinder — UserDashboard.js  v4.0
   ─────────────────────────────────────────────
   CHANGES IN v4.0:
   • loadRecentSearches() now also drives the
     Search Analytics card (most frequent +
     last search) — reuses the same 3-row fetch.
   • loadTotalReminders() added — COUNT of all
     reminders rows for the user.
   • loadUpcomingReminders() added — queries
     reminder_instances JOIN reminders for the
     next 3 due instances (scheduled_for >= now).
   ============================================= */

/* =============================================
   1. AUTH GUARD + USER PROFILE LOADER
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
            .from('profiles')
            .select('full_name, profile_img')
            .eq('user_id', session.user.id)
            .single();

        if (profileError) throw profileError;

        const fullName  = profile.full_name || 'User';
        const firstName = fullName.split(' ')[0] || 'User';
        const email     = session.user.email;

        const welcomeEl = document.querySelector('.topbar__welcome h1');
        if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}!`;

        const userNameEl  = document.querySelector('.user-name');
        const userEmailEl = document.querySelector('.user-email');
        if (userNameEl)  userNameEl.textContent  = fullName || 'User';
        if (userEmailEl) userEmailEl.textContent = email    || '';

        renderSidebarAvatar(profile.profile_img || null);

    } catch (err) {
        console.error('Profile load error:', err.message);
    }

    // CHANGED v4.0: Run all three data loaders in parallel.
    // loadRecentSearches already existed; the other two are new.
    await Promise.all([
        loadRecentSearches(session.user.id),
        loadTotalReminders(session.user.id),
        loadUpcomingReminders(session.user.id),
    ]);
}

/* =============================================
   2. RECENT SEARCHES + SEARCH ANALYTICS LOADER
   ─────────────────────────────────────────────
   CHANGED v4.0: After rendering the recent
   searches list, also populates:
     • #mostSearchedValue  (most frequent name
       computed client-side from the same 3 rows,
       same logic as UserHistory.js)
     • #lastSearchValue    (rows[0].product_name)
   No extra DB round-trip needed.
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

        // CHANGED v4.0: Populate Search Analytics card from the same rows.
        renderSearchAnalytics(rows);

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
   3. SEARCH ANALYTICS RENDERER  (NEW — v4.0)
   ─────────────────────────────────────────────
   Populates the Search Analytics stat card.
   rows are newest-first (same array passed in
   from loadRecentSearches).

   Most Frequent: frequency-count across the 3
   rows (same algorithm as UserHistory.js
   renderMostFrequent, so behaviour is identical).
   Last Search: rows[0] is the newest row.
   ============================================= */
function renderSearchAnalytics(rows) {
    const mostEl = document.getElementById('mostSearchedValue');
    const lastEl = document.getElementById('lastSearchValue');

    if (rows.length === 0) {
        if (mostEl) mostEl.textContent = 'No searches yet';
        if (lastEl) lastEl.textContent = '—';
        return;
    }

    // Most frequent — frequency map, then pick winner
    const freq = {};
    rows.forEach(r => {
        const key = (r.product_name || '').trim().toLowerCase();
        if (!key) return;
        if (!freq[key]) freq[key] = { name: r.product_name, count: 0 };
        freq[key].count++;
    });
    const top = Object.values(freq).sort((a, b) => b.count - a.count)[0];
    if (mostEl) mostEl.textContent = top ? top.name : '—';

    // Last search — rows are newest-first so index 0 is the most recent
    if (lastEl) lastEl.textContent = rows[0].product_name || '—';
}

/* =============================================
   4. TOTAL REMINDERS LOADER  (NEW — v4.0)
   ─────────────────────────────────────────────
   Counts ALL reminders rows for this user
   (all statuses — represents "total reminders
   created"). Uses the reminders table directly.
   The partial index idx_reminders_user_active
   covers only status='due'; a full count across
   all statuses is a simple table scan filtered
   by user_id which is acceptable for this card.
   ============================================= */
async function loadTotalReminders(userId) {
    const countEl = document.getElementById('totalRemindersCount');
    if (!countEl) return;

    try {
        const { count, error } = await supabaseClient
            .from('reminders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (error) throw error;

        countEl.textContent = count ?? 0;

    } catch (err) {
        console.warn('Total reminders load error:', err.message);
        if (countEl) countEl.textContent = '—';
    }
}

/* =============================================
   5. UPCOMING REMINDERS LOADER  (NEW — v4.0)
   ─────────────────────────────────────────────
   Queries reminder_instances for this user:
     status = 'due'
     scheduled_for >= now()
     ORDER BY scheduled_for ASC
     LIMIT 3

   Joins to the reminders table (via the FK
   reminder_instances.reminder_id → reminders.id)
   using Supabase's embedded select syntax to
   get med_name and dosage.

   Times are formatted as "08:30 AM" in
   Asia/Karachi timezone (consistent with the
   send-reminder-notification edge function).

   Tag logic:
     scheduled_for within the next 2 hours → UPCOMING (green)
     otherwise                             → LATER    (gray)

   Icon: fa-kit-medical on every item, matching
   the original hardcoded design.
   ============================================= */
async function loadUpcomingReminders(userId) {
    const listEl = document.getElementById('upcomingReminderList');
    if (!listEl) return;

    try {
        const now = new Date().toISOString();

        const { data, error } = await supabaseClient
            .from('reminder_instances')
            .select(`
                id,
                scheduled_for,
                reminders (
                    med_name,
                    dosage,
                    med_form
                )
            `)
            .eq('user_id', userId)
            .eq('status', 'due')
            .gte('scheduled_for', now)
            .order('scheduled_for', { ascending: true })
            .limit(3);

        if (error) throw error;

        const rows = data || [];

        if (rows.length === 0) {
            listEl.innerHTML = `
                <li class="reminder-item">
                    <div class="reminder-item__icon">
                        <i class="fa-solid fa-kit-medical"></i>
                    </div>
                    <div class="reminder-item__info">
                        <span class="reminder-item__name" style="color:var(--gray-mid)">No upcoming reminders</span>
                        <span class="reminder-item__dose">Your scheduled reminders will appear here</span>
                    </div>
                </li>`;
            return;
        }

        const twoHoursFromNow = Date.now() + 2 * 60 * 60 * 1000;

        listEl.innerHTML = rows.map(row => {
            const reminder = row.reminders || {};
            const name     = reminder.med_name || '—';
            const dosage   = reminder.dosage   || '';
            const medForm  = reminder.med_form  || '';

            // Format time in PKT (Asia/Karachi) — same timezone used by the edge function
            const scheduledDate = new Date(row.scheduled_for);
            const timeLabel = scheduledDate.toLocaleTimeString('en-US', {
                hour:   '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Karachi',
            });

            // Dose line: "500mg · Tablet" or just "500mg" if no form
            const doseLine = [dosage, medForm].filter(Boolean).join(' · ');

            // Tag: UPCOMING if within next 2 hours, otherwise LATER
            const isUpcoming = scheduledDate.getTime() <= twoHoursFromNow;
            const tagClass   = isUpcoming ? 'reminder-item__tag--upcoming' : 'reminder-item__tag--later';
            const clockClass = isUpcoming ? 'reminder-item__clock--upcoming' : 'reminder-item__clock--later';
            const tagText    = isUpcoming ? 'UPCOMING' : 'LATER';

            return `
            <li class="reminder-item">
                <div class="reminder-item__icon">
                    <i class="fa-solid fa-kit-medical"></i>
                </div>
                <div class="reminder-item__info">
                    <span class="reminder-item__name">${escapeHtml(name)}</span>
                    <span class="reminder-item__dose">${escapeHtml(doseLine)}</span>
                </div>
                <div class="reminder-item__time">
                    <span class="reminder-item__clock ${clockClass}">${timeLabel}</span>
                    <span class="reminder-item__tag ${tagClass}">${tagText}</span>
                </div>
            </li>`;
        }).join('');

    } catch (err) {
        console.warn('Upcoming reminders load error:', err.message);
        if (listEl) {
            listEl.innerHTML = `
                <li class="reminder-item">
                    <div class="reminder-item__info">
                        <span class="reminder-item__name" style="color:var(--gray-mid)">
                            Could not load reminders
                        </span>
                    </div>
                </li>`;
        }
    }
}

/* =============================================
   6. SIDEBAR AVATAR RENDERER  (unchanged)
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
   7. UTILITY HELPERS  (unchanged)
   ============================================= */
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

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#39;');
}

/* =============================================
   8. LOGOUT  (unchanged)
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
   9. SIDEBAR TOGGLE  (unchanged)
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
