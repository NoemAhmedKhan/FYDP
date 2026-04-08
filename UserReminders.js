/* ============================================================
   MediFinder — UserReminders.js  (Due tab)
   - Fetches reminders with status='due' from Supabase
   - Loads real user name/email/avatar in sidebar
   - Mark as Taken updates status in DB
   - Remove deletes from DB
   ============================================================ */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

    const db = window.supabaseClient
        || (window.supabase && window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

    /* ── Sidebar toggle ── */
    const sidebar      = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const overlay      = document.getElementById('sidebarOverlay');

    hamburgerBtn && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open')
            ? sidebar.classList.remove('sidebar--open')
            : sidebar.classList.add('sidebar--open'));
    overlay && overlay.addEventListener('click', () => sidebar.classList.remove('sidebar--open'));
    document.addEventListener('keydown', e => e.key === 'Escape' && sidebar.classList.remove('sidebar--open'));

    /* ── Set Reminder button ── */
    const setReminderBtn = document.getElementById('setReminderBtn');
    setReminderBtn && setReminderBtn.addEventListener('click', () => {
        window.location.href = 'SetRemindersDaily.html';
    });

    /* ── Search live filter ── */
    const searchInput = document.querySelector('.search-bar__input');
    document.querySelector('.search-bar__input') && searchInput.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('.reminder-card').forEach(c => {
            const name = c.querySelector('.reminder-card__name')?.textContent.toLowerCase() || '';
            c.style.display = (!q || name.includes(q)) ? '' : 'none';
        });
    });

    /* ============================================================
       SIDEBAR — load real user info
       ============================================================ */
    function renderSidebarAvatar(url, initials) {
        const wrap = document.getElementById('sidebarAvatarWrap');
        if (!wrap) return;
        wrap.innerHTML = '';
        const img = document.createElement('img');
        img.alt = 'Avatar';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
        wrap.appendChild(img);
        img.onload  = () => {};
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

        const { data: profile } = await db
            .from('users').select('first_name,last_name,profile_img').eq('id', user.id).single();

        const firstName = profile?.first_name || '';
        const lastName  = profile?.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';
        const initials  = ((firstName[0] || '') + (lastName[0] || '')).toUpperCase() || '?';

        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';

        renderSidebarAvatar(profile?.profile_img || null, initials);
    }

    /* ============================================================
       LOAD DUE REMINDERS
       ============================================================ */
    const reminderList = document.getElementById('reminderList');

    /* Icon colours cycle — all use the medical-kit icon */
    const VISUAL_COLORS = ['--blue-bg:var(--blue-bg);--icon-color:var(--blue)',
                           '--amber-bg:var(--amber-bg);--icon-color:var(--amber)',
                           '--purple-bg:var(--purple-bg);--icon-color:var(--purple)'];

    /* Single shared icon — medical kit bag with + */
    const MED_ICON = 'fa-solid fa-kit-medical';

    function formatTime(t) {
        if (!t) return '--';
        const [h, m] = t.split(':');
        const hr = parseInt(h);
        return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
    }

    function frequencyLabel(r) {
        if (r.reminder_type === 'Weekly' && r.active_days?.length)
            return r.active_days.join(', ');
        if (r.reminder_type === 'Specific Days' && r.active_days?.length)
            return r.active_days.join(', ');
        if (r.reminder_type === 'As Needed') return 'As Needed';
        return 'Daily';
    }

    function buildDueCard(r, idx) {
        const time      = r.times?.[0]?.time || '';
        const timeStr   = formatTime(time);
        const [hrMin, ampm] = timeStr.split(' ');
        const now       = new Date();
        const dayName   = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

        /* Rotate visual colours */
        const colorClass = ['reminder-card__visual--blue',
                            'reminder-card__visual--amber',
                            'reminder-card__visual--purple'][idx % 3];

        const card = document.createElement('article');
        card.className = 'reminder-card';
        card.dataset.id = r.id;
        card.innerHTML = `
            <div class="reminder-card__visual ${colorClass}">
                <i class="${MED_ICON}"></i>
            </div>
            <div class="reminder-card__content">
                <h3 class="reminder-card__name">${r.med_name}</h3>
                <div class="reminder-card__details">
                    <div class="detail-cell">
                        <span class="detail-cell__label">Dosage</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-kit-medical"></i> ${r.dosage}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Frequency</span>
                        <span class="detail-cell__value"><i class="fa-regular fa-clock"></i> ${frequencyLabel(r)}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Notification</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-bell"></i> ${(r.notifications || []).join(', ') || '—'}</span>
                    </div>
                    <div class="detail-cell detail-cell--time">
                        <span class="detail-cell__day">${dayName}</span>
                        <span class="detail-cell__time">${hrMin}</span>
                        <span class="detail-cell__date">${dateStr}</span>
                    </div>
                </div>
                <div class="reminder-card__actions">
                    <button class="btn-remove" data-id="${r.id}">Remove</button>
                    <button class="btn-taken" data-id="${r.id}">
                        <i class="fa-solid fa-circle-check"></i> Taken
                    </button>
                </div>
            </div>`;
        return card;
    }

    function showEmpty() {
        if (!reminderList) return;
        reminderList.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--gray);">
                <i class="fa-solid fa-bell-slash" style="font-size:48px;opacity:.3;margin-bottom:16px;display:block;"></i>
                <p style="font-size:16px;font-weight:500;">No due reminders</p>
                <p style="font-size:13px;margin-top:6px;">Click "Set Reminder" to add one.</p>
            </div>`;
    }

    async function loadDueReminders() {
        if (!db || !reminderList) return;

        const { data: { user } } = await db.auth.getUser();
        if (!user) return;

        const { data: reminders, error } = await db
            .from('reminders')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'due')
            .order('created_at', { ascending: false });

        if (error) { console.error('[Reminders]', error); return; }

        reminderList.innerHTML = '';
        if (!reminders || reminders.length === 0) { showEmpty(); return; }

        reminders.forEach((r, i) => reminderList.appendChild(buildDueCard(r, i)));

        /* ── Taken button ── */
        reminderList.querySelectorAll('.btn-taken').forEach(btn => {
            btn.addEventListener('click', async function () {
                const id   = this.dataset.id;
                const card = this.closest('.reminder-card');

                const { error } = await db
                    .from('reminders').update({ status: 'taken' }).eq('id', id);

                if (error) { console.error(error); return; }

                card.style.transition = 'opacity .3s ease, transform .3s ease';
                card.style.opacity    = '0';
                card.style.transform  = 'translateY(-8px)';
                setTimeout(() => card.remove(), 320);
            });
        });

        /* ── Remove button ── */
        reminderList.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', async function () {
                const id   = this.dataset.id;
                const card = this.closest('.reminder-card');

                const { error } = await db
                    .from('reminders').delete().eq('id', id);

                if (error) { console.error(error); return; }

                card.style.transition = 'opacity .3s ease, transform .3s ease';
                card.style.opacity    = '0';
                card.style.transform  = 'translateY(-8px)';
                setTimeout(() => card.remove(), 320);
            });
        });
    }

    /* ── Logout ── */
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn && logoutBtn.addEventListener('click', async () => {
        if (db) await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ── Init ── */
    loadSidebarUser();
    loadDueReminders();

})();
