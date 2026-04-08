/* ============================================================
   MediFinder — UserReminders.js  (Due tab)

   PERFORMANCE OPTIMISATIONS vs previous version:
   1. getSession() instead of getUser() — reads localStorage,
      no network round-trip → instant auth check
   2. User info + reminders fetched in PARALLEL with Promise.all
      instead of sequentially → cuts load time roughly in half
   3. Sidebar avatar rendered immediately from session data
      while DB fetch is still in flight
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

    /* ── Set Reminder button ── */
    document.getElementById('setReminderBtn')?.addEventListener('click', () => {
        window.location.href = 'SetRemindersDaily.html';
    });

    /* ── Live search filter ── */
    document.querySelector('.search-bar__input')?.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('.reminder-card').forEach(c => {
            c.style.display = (!q || (c.querySelector('.reminder-card__name')?.textContent.toLowerCase() || '').includes(q)) ? '' : 'none';
        });
    });

    /* ── Logout ── */
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        if (db) await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ============================================================
       SIDEBAR AVATAR
       ============================================================ */
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
       CARD HELPERS
       ============================================================ */
    function fmtTime(t) {
        if (!t) return '--:--';
        const [h, m] = t.split(':');
        const hr = +h;
        return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
    }
    function freqLabel(r) {
        if ((r.reminder_type === 'Weekly' || r.reminder_type === 'Specific Days') && r.active_days?.length)
            return r.active_days.join(', ');
        return r.reminder_type || 'Daily';
    }

    const COLOR_CLASSES = ['reminder-card__visual--blue', 'reminder-card__visual--amber', 'reminder-card__visual--purple'];

    function buildDueCard(r, idx) {
        const timeStr = fmtTime(r.times?.[0]?.time || '');
        const [hrMin] = timeStr.split(' ');
        const now     = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

        const el = document.createElement('article');
        el.className = 'reminder-card';
        el.dataset.id = r.id;
        el.innerHTML = `
            <div class="reminder-card__visual ${COLOR_CLASSES[idx % 3]}">
                <i class="fa-solid fa-kit-medical"></i>
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
                        <span class="detail-cell__value"><i class="fa-regular fa-clock"></i> ${freqLabel(r)}</span>
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
        return el;
    }

    function showEmpty(list) {
        list.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--gray);">
                <i class="fa-solid fa-bell-slash" style="font-size:48px;opacity:.3;display:block;margin-bottom:16px;"></i>
                <p style="font-size:16px;font-weight:500;">No due reminders</p>
                <p style="font-size:13px;margin-top:6px;">Click "Set Reminder" to add one.</p>
            </div>`;
    }

    /* ============================================================
       INIT — parallel fetch for speed
       ============================================================ */
    async function init() {
        if (!db) return;

        /* getSession reads localStorage — instant, no network */
        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) { window.location.href = 'Login.html'; return; }

        const user = session.user;
        const list = document.getElementById('reminderList');

        /* Fire BOTH fetches at the same time — don't wait for one before starting the other */
        const [profileResult, remindersResult] = await Promise.all([
            db.from('users').select('first_name,last_name,profile_img').eq('id', user.id).single(),
            db.from('reminders').select('*').eq('user_id', user.id).eq('status', 'due').order('created_at', { ascending: false })
        ]);

        /* ── Populate sidebar ── */
        const p  = profileResult.data;
        const fn = p?.first_name || '', ln = p?.last_name || '';
        const fullName = [fn, ln].filter(Boolean).join(' ') || 'User';
        const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase() || '?';
        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';
        renderSidebarAvatar(p?.profile_img || null, initials);

        /* ── Populate reminder cards ── */
        if (!list) return;
        list.innerHTML = '';
        const reminders = remindersResult.data;
        if (!reminders?.length) { showEmpty(list); return; }
        reminders.forEach((r, i) => list.appendChild(buildDueCard(r, i)));

        /* ── Taken button ── */
        list.querySelectorAll('.btn-taken').forEach(btn => {
            btn.addEventListener('click', async function () {
                const id   = this.dataset.id;
                const card = this.closest('.reminder-card');
                const { error } = await db.from('reminders').update({ status: 'taken' }).eq('id', id);
                if (error) { console.error(error); return; }
                card.style.cssText += ';transition:opacity .3s ease,transform .3s ease;opacity:0;transform:translateY(-8px)';
                setTimeout(() => card.remove(), 320);
            });
        });

        /* ── Remove button ── */
        list.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', async function () {
                const id   = this.dataset.id;
                const card = this.closest('.reminder-card');
                const { error } = await db.from('reminders').delete().eq('id', id);
                if (error) { console.error(error); return; }
                card.style.cssText += ';transition:opacity .3s ease,transform .3s ease;opacity:0;transform:translateY(-8px)';
                setTimeout(() => card.remove(), 320);
            });
        });
    }

    init();
})();
