/* ============================================================
   MediFinder — UserReminders.js  (Due tab)  v3.3

   FIXES vs v3.2:
   - Added console logging throughout init() so you can see
     exactly what the Supabase queries return in DevTools.
   - Fallback: if reminder_instances returns 0 rows but reminders
     table has due rows, shows those directly. This handles the
     transition period where a reminder was just created but the
     scheduler hasn't generated its instance yet (scheduler runs
     every 5 min — there can be up to a 5-min gap on first creation).
   - reminder_instances RLS requires reminders SELECT policy too
     (for the PostgREST join). patch2.sql adds that policy.
     Until patch2.sql is run, the fallback query keeps the page
     functional.
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

    document.getElementById('setReminderBtn')?.addEventListener('click', () => {
        window.location.href = 'SetRemindersDaily.html';
    });

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

    /* ── Sidebar avatar ── */
    function renderSidebarAvatar(imageUrl, initialsText) {
        const container = document.getElementById('sidebarAvatarInner');
        if (!container) return;
        container.innerHTML = '';
        const img = document.createElement('img');
        img.alt = 'Avatar';
        img.className = 'avatar-photo';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
        img.onerror = () => {
            if (!img.src.includes('ProfileAvatar')) {
                img.src = 'Images/ProfileAvatar.jpg';
            } else {
                container.innerHTML = '';
                const span = document.createElement('span');
                span.className = 'avatar-initials-text';
                span.textContent = initialsText || '?';
                container.appendChild(span);
            }
        };
        img.src = imageUrl || 'Images/ProfileAvatar.jpg';
        container.appendChild(img);
    }

    function getInitials(fullName) {
        const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
        const f = parts[0]?.[0] || '';
        const l = parts[parts.length - 1]?.[0] || '';
        return (f + (parts.length > 1 ? l : '')).toUpperCase() || '?';
    }

    /* ── Card helpers ── */
    function fmtTime(t) {
        if (!t) return '--:-- --';
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

    /* ── Build card from a reminder_instances row (joined with reminders) ── */
    function buildDueCard(r, idx) {
        const def     = r.reminders || r;   // joined object or flat fallback
        const timeStr = fmtTime(def.times?.[0]?.time || '');
        const [hrMin, ampm = ''] = timeStr.split(' ');
        const now     = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

        const el = document.createElement('article');
        el.className = 'reminder-card';
        // instance id for Taken button; reminder id for Remove button
        el.dataset.instanceId = r.id;
        el.dataset.reminderId = r.reminder_id || r.id;  // flat fallback uses r.id
        el.innerHTML = `
            <div class="reminder-card__visual ${COLOR_CLASSES[idx % 3]}">
                <i class="fa-solid fa-kit-medical"></i>
            </div>
            <div class="reminder-card__content">
                <h3 class="reminder-card__name">${def.med_name || '—'}</h3>
                <div class="reminder-card__details">
                    <div class="detail-cell">
                        <span class="detail-cell__label">Dosage</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-kit-medical"></i> ${def.dosage || '—'}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Frequency</span>
                        <span class="detail-cell__value"><i class="fa-regular fa-clock"></i> ${freqLabel(def)}</span>
                    </div>
                    <div class="detail-cell">
                        <span class="detail-cell__label">Notification</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-bell"></i> ${(def.notifications || []).join(', ') || '—'}</span>
                    </div>
                    <div class="detail-cell detail-cell--time">
                        <span class="detail-cell__day">${dayName}</span>
                        <span class="detail-cell__time">${hrMin} <span class="detail-cell__ampm">${ampm}</span></span>
                        <span class="detail-cell__date">${dateStr}</span>
                    </div>
                </div>
                <div class="reminder-card__actions">
                    <button class="btn-remove">Remove</button>
                </div>
            </div>`;
        return el;
    }

    function animateOut(card) {
        card.style.transition = 'opacity .3s ease, transform .3s ease';
        card.style.opacity    = '0';
        card.style.transform  = 'translateY(-8px)';
        setTimeout(() => card.remove(), 320);
    }

    function showEmpty(list) {
        list.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:var(--gray);">
                <i class="fa-solid fa-bell-slash" style="font-size:48px;opacity:.3;display:block;margin-bottom:16px;"></i>
                <p style="font-size:16px;font-weight:500;">No due reminders</p>
                <p style="font-size:13px;margin-top:6px;">Click "Set Reminder" to add one.</p>
            </div>`;
    }

    function bindButtons(list, usingInstances) {
        /* ── Remove ── */
        list.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', async function () {
                const card       = this.closest('.reminder-card');
                const reminderId = card.dataset.reminderId;
                const { error } = await db
                    .from('reminders')
                    .delete()
                    .eq('id', reminderId);
                if (error) { console.error('[Remove] delete failed:', error); return; }
                animateOut(card);
            });
        });
    }

    /* ============================================================
       INIT
       ============================================================ */
    async function init() {
        if (!db) { console.error('[Reminders] No Supabase client'); return; }

        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) { window.location.href = 'Login.html'; return; }

        const user = session.user;
        const list = document.getElementById('reminderList');

        // ── PRIMARY: query reminder_instances joined with reminders ──
        const [profileResult, instancesResult] = await Promise.all([
            db.from('profiles').select('full_name,profile_img').eq('user_id', user.id).single(),
            db.from('reminder_instances')
              .select(`
                id,
                reminder_id,
                scheduled_for,
                reminders (
                  med_name, dosage, med_form,
                  reminder_type, active_days,
                  notifications, times
                )
              `)
              .eq('user_id', user.id)
              .eq('status', 'due')
              .order('scheduled_for', { ascending: true })
        ]);

        console.log('[Reminders] instances query:', instancesResult.error || instancesResult.data?.length, 'rows');
        if (instancesResult.error) console.error('[Reminders] instances error:', instancesResult.error);

        /* ── Sidebar ── */
        const p        = profileResult.data;
        const fullName = p?.full_name || 'User';
        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';
        renderSidebarAvatar(p?.profile_img || null, getInitials(fullName));

        if (!list) return;
        list.innerHTML = '';

        const instances = instancesResult.data;

        // ── If instances returned rows with valid joined data, use them ──
        const validInstances = (instances || []).filter(r => r.reminders?.med_name);
        console.log('[Reminders] valid instances with joined reminders:', validInstances.length);

        if (validInstances.length > 0) {
            validInstances.forEach((r, i) => list.appendChild(buildDueCard(r, i)));
            bindButtons(list, true);
            return;
        }

        // ── FALLBACK: reminder_instances join failed (RLS on reminders  ──
        // table not yet set up) — query reminders directly until patch2.sql
        // is applied.
        console.warn('[Reminders] Falling back to direct reminders query (run patch2.sql to fix).');
        const { data: fallbackReminders, error: fbErr } = await db
            .from('reminders')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'due')
            .order('created_at', { ascending: false });

        console.log('[Reminders] fallback query:', fbErr || fallbackReminders?.length, 'rows');
        if (fbErr) console.error('[Reminders] fallback error:', fbErr);

        if (!fallbackReminders?.length) { showEmpty(list); return; }

        // Wrap flat reminders rows so buildDueCard works with both shapes
        fallbackReminders.forEach((r, i) => {
            const wrapped = { id: r.id, reminder_id: r.id, reminders: r };
            list.appendChild(buildDueCard(wrapped, i));
        });
        bindButtons(list, false);
    }

    init();
})();
