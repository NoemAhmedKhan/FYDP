/* ============================================================
   MediFinder — SetReminders.js
   Shared across: Daily, Weekly, As Needed, Specific Days

   FIX: "Connection error" was caused by SetReminders HTML pages
   not loading the Supabase SDK before this file. All four
   SetReminders HTML pages now include:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="supabase.js"></script>
     <script src="SetReminders.js"></script>
   ============================================================ */

const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

/* Reuse shared client if available, otherwise create own */
const db = window.supabaseClient
    || (window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY));

/* ── Inline toast (no dependency on other pages) ── */
function showToast(msg, type = 'success') {
    const old = document.getElementById('sr-toast');
    if (old) old.remove();

    const t = document.createElement('div');
    t.id = 'sr-toast';
    t.style.cssText = [
        'position:fixed;top:24px;right:24px;z-index:9999',
        'padding:14px 20px;border-radius:10px',
        "font-family:'Roboto',sans-serif;font-size:14px;font-weight:500",
        'color:white;max-width:340px;box-shadow:0 4px 14px rgba(0,0,0,.15)',
        `background:${type === 'success' ? '#208B3A' : type === 'error' ? '#ef4444' : '#3b82f6'}`,
        'opacity:0;transform:translateY(-10px)',
        'transition:opacity .3s ease,transform .3s ease'
    ].join(';');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-10px)'; setTimeout(() => t.remove(), 300); }, 4000);
}

/* ============================================================
   NOTIFICATION CARD TOGGLE
   ============================================================ */
document.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', () => {
        const cb    = card.querySelector('.hidden-check');
        const check = card.querySelector('.custom-check');
        cb.checked = !cb.checked;
        card.classList.toggle('notif-card--active', cb.checked);
        check.classList.toggle('custom-check--checked', cb.checked);
    });
});

/* ============================================================
   REMOVE / ADD TIME ROWS
   ============================================================ */
function removeTimeRow(btn) {
    const box = document.getElementById('timeRows');
    if (box && box.querySelectorAll('.time-row').length > 1) {
        btn.closest('.time-row').remove();
    }
}

document.getElementById('addTimeBtn')?.addEventListener('click', () => {
    const box = document.getElementById('timeRows');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `
        <input type="time" class="time-input" value="12:00" aria-label="Reminder time">
        <div class="select-wrap time-meal-select">
            <select class="select-input" aria-label="Meal timing">
                <option>After meal</option><option>Before meal</option>
                <option>With meal</option><option>Empty stomach</option>
            </select>
            <i class="fa-solid fa-chevron-down select-arrow"></i>
        </div>
        <button class="time-remove" title="Remove" onclick="removeTimeRow(this)">
            <i class="fa-solid fa-xmark"></i>
        </button>`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
});

/* ============================================================
   DAY BUTTONS (Weekly = single select, Specific Days = multi)
   ============================================================ */
const dayBtnsEl  = document.getElementById('dayBtns');
const dayCountEl = document.getElementById('dayCount');

if (dayBtnsEl) {
    const isWeekly = document.title.includes('Weekly');
    dayBtnsEl.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isWeekly) {
                dayBtnsEl.querySelectorAll('.day-btn').forEach(b => b.classList.remove('day-btn--active'));
                btn.classList.add('day-btn--active');
            } else {
                btn.classList.toggle('day-btn--active');
            }
            if (dayCountEl) {
                const n = dayBtnsEl.querySelectorAll('.day-btn--active').length;
                dayCountEl.textContent = n === 1 ? '1 day selected' : `${n} days selected`;
            }
        });
    });
}

/* ============================================================
   AS NEEDED — DATE TAGS
   ============================================================ */
const calendarBtn      = document.getElementById('calendarBtn');
const hiddenDatePicker = document.getElementById('hiddenDatePicker');
const dateTagRow       = document.getElementById('dateTagRow');

if (calendarBtn && hiddenDatePicker && dateTagRow) {
    calendarBtn.addEventListener('click', () => hiddenDatePicker.showPicker());

    hiddenDatePicker.addEventListener('change', () => {
        const v = hiddenDatePicker.value;
        if (!v) return;
        const label = new Date(v + 'T00:00:00')
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const exists = [...dateTagRow.querySelectorAll('.date-tag')]
            .some(t => t.firstChild.textContent.trim() === label);
        if (exists) { hiddenDatePicker.value = ''; return; }

        const tag = document.createElement('span');
        tag.className = 'date-tag';
        tag.innerHTML = `${label}<button class="date-tag__remove" onclick="removeDateTag(this)" aria-label="Remove date"><i class="fa-solid fa-xmark"></i></button>`;
        dateTagRow.insertBefore(tag, document.getElementById('dateAddInput'));
        hiddenDatePicker.value = '';
    });
}

function removeDateTag(btn) { btn.closest('.date-tag').remove(); }

/* ============================================================
   SAVE REMINDER
   Uses getSession() instead of getUser() — getSession reads
   from localStorage synchronously (no network call), making
   it instant. getUser() makes a network round-trip every time.
   ============================================================ */
document.getElementById('saveBtn')?.addEventListener('click', async () => {

    const medName = document.getElementById('med-name')?.value.trim();
    const dosage  = document.getElementById('dosage')?.value.trim();

    if (!medName) { showToast('Please enter a medication name.', 'error'); return; }
    if (!dosage)  { showToast('Please enter a dosage amount.', 'error');   return; }

    if (!db) { showToast('Connection error. Please refresh.', 'error'); return; }

    /* getSession is instant (reads localStorage) — no network delay */
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) {
        showToast('You must be logged in to save reminders.', 'error');
        setTimeout(() => window.location.href = 'Login.html', 1500);
        return;
    }

    const user = session.user;

    /* Detect reminder type from page title */
    const reminderType = document.title.includes('Weekly')   ? 'Weekly'
                       : document.title.includes('As Needed') ? 'As Needed'
                       : document.title.includes('Specific')  ? 'Specific Days'
                       : 'Daily';

    /* Collect all form data */
    const medForm   = document.getElementById('med-form')?.value   || null;
    const startDate = document.getElementById('start-date')?.value || null;

    const times = [...document.querySelectorAll('.time-row')].map(row => ({
        time: row.querySelector('.time-input')?.value || '',
        meal: row.querySelector('.select-input')?.value || ''
    })).filter(t => t.time);

    const activeDays = [...document.querySelectorAll('.day-btn--active')]
        .map(b => b.dataset.day).filter(Boolean);

    const activeDates = [...document.querySelectorAll('.date-tag')]
        .map(t => t.firstChild.textContent.trim());

    const notifications = [...document.querySelectorAll('.notif-card')]
        .filter(c => c.querySelector('.hidden-check')?.checked)
        .map(c => c.querySelector('.notif-title')?.textContent.trim())
        .filter(Boolean);

    const payload = {
        user_id:       user.id,
        med_name:      medName,
        dosage:        dosage,
        med_form:      medForm,
        reminder_type: reminderType,
        start_date:    startDate,
        times:         times,
        active_days:   activeDays,
        active_dates:  activeDates,
        notifications: notifications,
        status:        'due',
    };

    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

    const { error } = await db.from('reminders').insert(payload);

    saveBtn.disabled  = false;
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Reminder';

    if (error) {
        console.error('[SetReminders]', error);
        showToast('Failed to save: ' + error.message, 'error');
        return;
    }

    showToast('✓ Reminder saved successfully!', 'success');
    setTimeout(() => window.location.href = 'UserReminders.html', 1200);
});
