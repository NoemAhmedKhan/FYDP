/* ============================================================
   MediFinder — UserRemindersTaken.js  (Taken tab)
   Parallel fetch: sidebar + reminders loaded simultaneously
   ============================================================ */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
    const db = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

    /* ── Sidebar toggle ── */
    const sidebar = document.getElementById('sidebar');
    document.getElementById('hamburgerBtn')?.addEventListener('click', () => sidebar.classList.toggle('sidebar--open'));
    document.getElementById('sidebarOverlay')?.addEventListener('click', () => sidebar.classList.remove('sidebar--open'));
    document.addEventListener('keydown', e => e.key === 'Escape' && sidebar.classList.remove('sidebar--open'));

    document.getElementById('setReminderBtn')?.addEventListener('click', () => { window.location.href = 'SetRemindersDaily.html'; });
    document.querySelector('.search-bar__input')?.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('.reminder-card').forEach(c => {
            c.style.display = (!q || (c.querySelector('.reminder-card__name')?.textContent.toLowerCase() || '').includes(q)) ? '' : 'none';
        });
    });
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        if (db) await db.auth.signOut();
        window.location.href = 'Login.html';
    });

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

    /* ============================================================
       SERVER TIME FETCH
       ─────────────────────────────────────────────────────────
       Fetches the current server timestamp via Supabase RPC so
       the "Marked by MM/YYYY" label is always authoritative —
       never dependent on the user's potentially wrong device
       clock. Falls back to device time only if the RPC fails.
       ============================================================ */
    async function fetchServerMonthYear() {
        try {
            const { data, error } = await db.rpc('get_server_time');
            if (error || !data) throw error;
            const d = new Date(data);
            return d.toLocaleDateString('en-US', { month: '2-digit', year: 'numeric' });
        } catch (_) {
            /* Fallback to device time — acceptable on RPC failure */
            const d = new Date();
            return d.toLocaleDateString('en-US', { month: '2-digit', year: 'numeric' });
        }
    }

    function fmtTime(t) {
        if (!t) return '--:-- --';
        const [h, m] = t.split(':');
        const hr = +h;
        const ampm = hr < 12 ? 'AM' : 'PM';
        return `${hr % 12 || 12}:${m} ${ampm}`;
    }

    function buildTakenCard(r, markedMonthYear) {
        const timeStr = fmtTime(r.times?.[0]?.time || '');
        const timeParts = timeStr.split(' ');
        const hrMin     = timeParts[0];
        const ampm      = timeParts[1] || '';
        const now       = new Date();
        const dayName   = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

        const el = document.createElement('article');
        el.className = 'reminder-card reminder-card--taken';
        el.innerHTML = `
            <div class="reminder-card__visual reminder-card__visual--taken">
                <i class="fa-solid fa-kit-medical card-icon"></i>
                <span class="status-badge status-badge--taken"><i class="fa-solid fa-circle-check"></i> Completed</span>
            </div>
            <div class="reminder-card__content">
                <div class="card-top-row">
                    <div class="card-name-col">
                        <h3 class="reminder-card__name">${r.med_name}</h3>
                        <span class="green-underline"></span>
                    </div>
                    <div class="card-time-col">
                        <span class="time-day">${dayName}</span>
                        <span class="time-value">${hrMin} <span class="time-ampm">${ampm}</span></span>
                        <span class="time-date">${dateStr}</span>
                    </div>
                </div>
                <div class="reminder-card__details reminder-card__details--taken">
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
                <div class="taken-status-row">
                    <span class="taken-dot"></span>
                    <span class="taken-label">Marked by ${markedMonthYear}</span>
                </div>
            </div>`;
        return el;
    }

    async function init() {
        if (!db) return;
        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) { window.location.href = 'Login.html'; return; }

        const user = session.user;
        const list = document.getElementById('reminderList');

        /* Parallel fetch — profile, reminders, and server time simultaneously */
        const [profileResult, remindersResult, markedMonthYear] = await Promise.all([
            db.from('users').select('first_name,last_name,profile_img').eq('id', user.id).single(),
            db.from('reminders').select('*').eq('user_id', user.id).eq('status', 'taken').order('created_at', { ascending: false }),
            fetchServerMonthYear()
        ]);

        /* Sidebar */
        const p  = profileResult.data;
        const fn = p?.first_name || '', ln = p?.last_name || '';
        const fullName = [fn, ln].filter(Boolean).join(' ') || 'User';
        const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase() || '?';
        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';
        renderSidebarAvatar(p?.profile_img || null, initials);

        /* Cards */
        if (!list) return;
        list.innerHTML = '';
        const reminders = remindersResult.data;
        if (!reminders?.length) {
            list.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--gray);">
                <i class="fa-solid fa-circle-check" style="font-size:48px;opacity:.3;display:block;margin-bottom:16px;color:var(--green);"></i>
                <p style="font-size:16px;font-weight:500;">No taken reminders yet</p></div>`;
            return;
        }
        reminders.forEach(r => list.appendChild(buildTakenCard(r, markedMonthYear)));
    }

    init();
})();
