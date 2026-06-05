/* ============================================================
   MediFinder — UserReminders.js  (Due tab)

   v3.2 changes:
   - "Taken" button now deletes the reminder_instances row for
     the specific due instance, rather than setting reminders.status
     = 'taken'. The server scheduler creates instances; the user
     marks individual occurrences done. The parent reminder
     definition stays active so future instances keep generating.
   - "Remove" button deletes the reminders row (cascades to all
     instances and notification_log rows via FK on delete cascade).
   - Tabs (Taken / Missed) removed from this page — only Due shown.
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
    function renderSidebarAvatar(imageUrl, initialsText) {
        const container = document.getElementById('sidebarAvatarInner');
        if (!container) return;
        container.innerHTML = '';

        const img     = document.createElement('img');
        img.alt       = 'Avatar';
        img.className = 'avatar-photo';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';

        img.onerror = () => {
            if (!img.src.includes('ProfileAvatar')) {
                img.src = 'Images/ProfileAvatar.jpg';
            } else {
                container.innerHTML = '';
                const span       = document.createElement('span');
                span.className   = 'avatar-initials-text';
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

    /* ============================================================
       CARD HELPERS
       ============================================================ */
    function fmtTime(t) {
        if (!t) return '--:-- --';
        const [h, m] = t.split(':');
        const hr   = +h;
        const ampm = hr < 12 ? 'AM' : 'PM';
        return `${hr % 12 || 12}:${m} ${ampm}`;
    }
    function freqLabel(r) {
        if ((r.reminder_type === 'Weekly' || r.reminder_type === 'Specific Days') && r.active_days?.length)
            return r.active_days.join(', ');
        return r.reminder_type || 'Daily';
    }

    const COLOR_CLASSES = ['reminder-card__visual--blue', 'reminder-card__visual--amber', 'reminder-card__visual--purple'];

    function buildDueCard(r, idx) {
        // r is a reminder_instances row joined with reminders definition
        // r.reminder_id  = the reminders.id (for deletion of definition)
        // r.id           = the reminder_instances.id (for marking taken)
        // r.reminders    = the joined reminders definition object

        const def       = r.reminders || r;           // joined or flat
        const timeStr   = fmtTime(def.times?.[0]?.time || '');
        const timeParts = timeStr.split(' ');
        const hrMin     = timeParts[0];
        const ampm      = timeParts[1] || '';
        const now       = new Date();
        const dayName   = now.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

        const el = document.createElement('article');
        el.className = 'reminder-card';
        el.dataset.instanceId  = r.id;           // reminder_instances.id
        el.dataset.reminderId  = r.reminder_id;  // reminders.id (for Remove)
        el.innerHTML = `
            <div class="reminder-card__visual ${COLOR_CLASSES[idx % 3]}">
                <i class="fa-solid fa-kit-medical"></i>
            </div>
            <div class="reminder-card__content">
                <h3 class="reminder-card__name">${def.med_name}</h3>
                <div class="reminder-card__details">
                    <div class="detail-cell">
                        <span class="detail-cell__label">Dosage</span>
                        <span class="detail-cell__value"><i class="fa-solid fa-kit-medical"></i> ${def.dosage}</span>
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
                    <button class="btn-taken">
                        <i class="fa-solid fa-circle-check"></i> Taken
                    </button>
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

    /* ============================================================
       INIT
       ============================================================ */
    async function init() {
        if (!db) return;

        const { data: { session } } = await db.auth.getSession();
        if (!session?.user) { window.location.href = 'Login.html'; return; }

        const user = session.user;
        const list = document.getElementById('reminderList');

        // ── Fetch profile + due reminder instances in parallel ─────
        // reminder_instances joined with reminders definition
        const [profileResult, instancesResult] = await Promise.all([
            db.from('profiles').select('full_name,profile_img').eq('user_id', user.id).single(),
            db.from('reminder_instances')
              .select(`
                id,
                reminder_id,
                scheduled_for,
                reminders (
                  med_name,
                  dosage,
                  med_form,
                  reminder_type,
                  active_days,
                  notifications,
                  times
                )
              `)
              .eq('user_id', user.id)
              .eq('status', 'due')
              .order('scheduled_for', { ascending: true })
        ]);

        /* ── Sidebar ── */
        const p        = profileResult.data;
        const fullName = p?.full_name || 'User';
        const initials = getInitials(fullName);

        const nameEl  = document.getElementById('sidebarUserName');
        const emailEl = document.getElementById('sidebarUserEmail');
        if (nameEl)  nameEl.textContent  = fullName;
        if (emailEl) emailEl.textContent = user.email || '';
        renderSidebarAvatar(p?.profile_img || null, initials);

        /* ── Cards ── */
        if (!list) return;
        list.innerHTML = '';

        const instances = instancesResult.data;
        if (!instances?.length) { showEmpty(list); return; }
        instances.forEach((r, i) => list.appendChild(buildDueCard(r, i)));

        /* ── Taken button ──────────────────────────────────────────
           Marks the reminder_instances row as 'taken'.
           Does NOT touch reminders.status so future instances
           continue to be generated by the scheduler.
        ────────────────────────────────────────────────────────── */
        list.querySelectorAll('.btn-taken').forEach(btn => {
            btn.addEventListener('click', async function () {
                const card       = this.closest('.reminder-card');
                const instanceId = card.dataset.instanceId;

                const { error } = await db
                    .from('reminder_instances')
                    .update({ status: 'taken' })
                    .eq('id', instanceId);

                if (error) { console.error('Taken update failed:', error); return; }
                animateOut(card);
            });
        });

        /* ── Remove button ─────────────────────────────────────────
           Deletes the reminders definition row. The FK cascade
           automatically removes all reminder_instances and
           notification_log rows for this reminder.
        ────────────────────────────────────────────────────────── */
        list.querySelectorAll('.btn-remove').forEach(btn => {
            btn.addEventListener('click', async function () {
                const card       = this.closest('.reminder-card');
                const reminderId = card.dataset.reminderId;

                const { error } = await db
                    .from('reminders')
                    .delete()
                    .eq('id', reminderId);

                if (error) { console.error('Remove failed:', error); return; }
                animateOut(card);
            });
        });
    }

    init();
})();
