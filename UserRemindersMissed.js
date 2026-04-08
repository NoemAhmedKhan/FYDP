/* ============================================================
   MediFinder — UserRemindersMissed.js  (Missed tab)
   ============================================================ */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

    const db = window.supabaseClient
        || (window.supabase && window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

    /* ── Sidebar toggle ── */
    const sidebar = document.getElementById('sidebar');
    document.getElementById('hamburgerBtn')?.addEventListener('click', () =>
        sidebar.classList.toggle('sidebar--open'));
    document.getElementById('sidebarOverlay')?.addEventListener('click', () =>
        sidebar.classList.remove('sidebar--open'));
    document.addEventListener('keydown', e =>
        e.key === 'Escape' && sidebar.classList.remove('sidebar--open'));

    /* ── Set Reminder button ── */
    document.getElementById('setReminderBtn')?.addEventListener('click', () => {
        window.location.href = 'SetRemindersDaily.html';
    });

    /* ── Search ── */
    document.querySelector('.search-bar__input')?.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('.reminder-card').forEach(c => {
            const name = c.querySelector('.reminder-card__name')?.textContent.toLowerCase() || '';
            c.style.display = (!q || name.includes(q)) ? '' : 'none';
        });
    });

    /* ── Sidebar user ── */
    function renderSidebarAvatar(url, initials) {
        const wrap = document.getElementById('sidebarAvatarWrap');
        if (!wrap) return;
        wrap.innerHTML = '';
        const img = document.createElement('img');
        img.alt = 'Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
        wrap.appendChild(img);
        img.onerror = () => {
            wrap.innerHTML = '';
            const sp = document.createElement('span');
            sp.style.cssText = 'color:white;font-size:13px;font-weight:700;text-transform:uppercase;';
            sp.textContent = initials || '?';
            wrap.appendChild(sp);
        };
        img.src = url || 'Images/ProfileAvatar.jpg';
    }

    async function loadSidebarUser() {
        if (!db) return;
        const { data: { user } } = await db.auth.getUser();
        if (!user) return;
        const { data: p } = await db.from('users').select('first_name,last_name,profile_img').eq('id', user.id).single();
        const fn = p?.first_name || '', ln = p?.last_name || '';
        const fullName = [fn, ln].filter(Boolean).join(' ') || 'User';
        const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase() || '?';
        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';
        renderSidebarAvatar(p?.profile_img || null, initials);
    }

    /* ── Load Missed reminders ── */
    const reminderList = document.getElementById('reminderList');
    const MED_ICON = 'fa-solid fa-kit-medical';

    function formatTime(t) {
        if (!t) return '--:--';
        const [h, m] = t.split(':');
        const hr = parseInt(h);
        return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
    }

    function buildMissedCard(r) {
        const timeStr = formatTime(r.times?.[0]?.time || '');
        const now = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const [hrMin] = timeStr.split(' ');

        const card = document.createElement('article');
        card.className = 'reminder-card reminder-card--missed';
        card.dataset.id = r.id;
        card.innerHTML = `
            <div class="reminder-card__visual reminder-card__visual--missed">
                <i class="${MED_ICON} card-icon"></i>
                <span class="status-badge status-badge--missed">
                    <i class="fa-solid fa-circle-xmark"></i> I Missed
                </span>
            </div>
            <div class="reminder-card__content">
                <div class="card-top-row">
                    <div class="card-name-col">
                        <h3 class="reminder-card__name">${r.med_name}</h3>
                        <span class="missed-time-label">Missed at ${hrMin}</span>
                    </div>
                    <div class="card-time-col">
                        <span class="time-day">${dayName}</span>
                        <span class="time-value time-value--missed">${hrMin}</span>
                        <span class="time-date">${dateStr}</span>
                    </div>
                </div>
                <div class="reminder-card__details reminder-card__details--missed">
                    <div class="detail-cell">
                        <span class="detail-cell__label">Dosage</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-kit-medical"></i> ${r.dosage}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Frequency</span>
                        <span class="detail-cell__value"><i class="fa-regular fa-clock"></i> ${r.reminder_type}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Notification</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-bell"></i> ${(r.notifications || []).join(', ') || '—'}</span>
                    </div>
                </div>
            </div>`;
        return card;
    }

    async function loadMissedReminders() {
        if (!db || !reminderList) return;
        const { data: { user } } = await db.auth.getUser();
        if (!user) return;

        const { data: reminders, error } = await db
            .from('reminders').select('*')
            .eq('user_id', user.id).eq('status', 'missed')
            .order('created_at', { ascending: false });

        if (error) { console.error(error); return; }

        reminderList.innerHTML = '';
        if (!reminders?.length) {
            reminderList.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);">
                <i class="fa-solid fa-circle-check" style="font-size:48px;opacity:.3;margin-bottom:16px;display:block;color:var(--green);"></i>
                <p style="font-size:16px;font-weight:500;">No missed reminders</p>
                <p style="font-size:13px;margin-top:6px;">Keep it up!</p></div>`;
            return;
        }
        reminders.forEach(r => reminderList.appendChild(buildMissedCard(r)));
    }

    /* ── Logout ── */
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        if (db) await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    loadSidebarUser();
    loadMissedReminders();
})();
