/* ============================================================
   MediFinder — UserRemindersMissed.js  (Missed tab)
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

    function fmtTime(t) {
        if (!t) return '--:-- --';
        const [h, m] = t.split(':');
        const hr   = +h;
        const ampm = hr < 12 ? 'AM' : 'PM';
        return `${hr % 12 || 12}:${m} ${ampm}`;
    }

    function buildMissedCard(r) {
        const timeStr   = fmtTime(r.times?.[0]?.time || '');
        const timeParts = timeStr.split(' ');
        const hrMin     = timeParts[0];
        const ampm      = timeParts[1] || '';
        const now       = new Date();
        const dayName   = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const el = document.createElement('article');
        el.className = 'reminder-card reminder-card--missed';
        el.innerHTML = `
            <div class="reminder-card__visual reminder-card__visual--missed">
                <i class="fa-solid fa-kit-medical card-icon"></i>
                <span class="status-badge status-badge--missed"><i class="fa-solid fa-circle-xmark"></i> I Missed</span>
            </div>
            <div class="reminder-card__content">
                <div class="card-top-row">
                    <div class="card-name-col">
                        <h3 class="reminder-card__name">${r.med_name}</h3>
                        <span class="missed-time-label">Missed at ${hrMin} ${ampm}</span>
                    </div>
                    <div class="card-time-col">
                        <span class="time-day">${dayName}</span>
                        <span class="time-value time-value--missed">${hrMin} <span class="time-ampm">${ampm}</span></span>
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
        return el;
    }

    async function init() {
        if (!db) return;
        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) { window.location.href = 'Login.html'; return; }

        const user = session.user;
        const list = document.getElementById('reminderList');

        /* Parallel fetch */
        const [profileResult, remindersResult] = await Promise.all([
            db.from('users').select('first_name,last_name,profile_img').eq('id', user.id).single(),
            db.from('reminders').select('*').eq('user_id', user.id).eq('status', 'missed').order('created_at', { ascending: false })
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
                <p style="font-size:16px;font-weight:500;">No missed reminders</p>
                <p style="font-size:13px;margin-top:6px;">Keep it up!</p></div>`;
            return;
        }
        reminders.forEach(r => list.appendChild(buildMissedCard(r)));
    }

    init();
})();
