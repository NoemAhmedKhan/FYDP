/* ============================================================
   MediFinder — SetReminders.js
   Shared across: Daily, Weekly, As Needed, Specific Days
   ============================================================ */

/* ── Supabase client (reuse from supabase.js or create own) ── */
const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

const db = (window.supabaseClient)
    || (window.supabase && window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

/* ── Toast helper (inline — no dependency on profile page) ── */
function showToast(msg, type = 'success') {
    /* Remove any existing toast */
    const existing = document.getElementById('sr-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sr-toast';
    toast.style.cssText = `
        position:fixed; top:24px; right:24px; z-index:9999;
        padding:14px 20px; border-radius:10px;
        font-family:'Roboto',sans-serif; font-size:14px; font-weight:500;
        color:white; max-width:340px; box-shadow:0 4px 14px rgba(0,0,0,.15);
        background:${type === 'success' ? '#208B3A' : type === 'error' ? '#ef4444' : '#3b82f6'};
        opacity:0; transform:translateY(-10px);
        transition:opacity .3s ease, transform .3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/* ============================================================
   NOTIFICATION CARD TOGGLE
   ============================================================ */
document.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', () => {
        const checkbox = card.querySelector('.hidden-check');
        const check    = card.querySelector('.custom-check');
        checkbox.checked = !checkbox.checked;
        card.classList.toggle('notif-card--active', checkbox.checked);
        check.classList.toggle('custom-check--checked', checkbox.checked);
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

const addTimeBtn = document.getElementById('addTimeBtn');
if (addTimeBtn) {
    addTimeBtn.addEventListener('click', () => {
        const box = document.getElementById('timeRows');
        if (!box) return;
        const row = document.createElement('div');
        row.classList.add('time-row');
        row.innerHTML = `
            <input type="time" class="time-input" value="12:00" aria-label="Reminder time">
            <div class="select-wrap time-meal-select">
                <select class="select-input" aria-label="Meal timing">
                    <option>After meal</option>
                    <option>Before meal</option>
                    <option>With meal</option>
                    <option>Empty stomach</option>
                </select>
                <i class="fa-solid fa-chevron-down select-arrow"></i>
            </div>
            <button class="time-remove" title="Remove" onclick="removeTimeRow(this)">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
    });
}

/* ============================================================
   WEEKLY / SPECIFIC DAYS — DAY BUTTONS
   ============================================================ */
const dayBtnsContainer = document.getElementById('dayBtns');
const dayCountEl       = document.getElementById('dayCount');

if (dayBtnsContainer) {
    const isWeekly = document.title.includes('Weekly');

    dayBtnsContainer.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isWeekly) {
                dayBtnsContainer.querySelectorAll('.day-btn').forEach(b => b.classList.remove('day-btn--active'));
                btn.classList.add('day-btn--active');
            } else {
                btn.classList.toggle('day-btn--active');
            }
            if (dayCountEl) {
                const n = dayBtnsContainer.querySelectorAll('.day-btn--active').length;
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

        const existing = [...dateTagRow.querySelectorAll('.date-tag')]
            .map(t => t.firstChild.textContent.trim());
        if (existing.includes(label)) { hiddenDatePicker.value = ''; return; }

        const tag = document.createElement('span');
        tag.classList.add('date-tag');
        tag.innerHTML = `${label}<button class="date-tag__remove" onclick="removeDateTag(this)" aria-label="Remove date"><i class="fa-solid fa-xmark"></i></button>`;
        dateTagRow.insertBefore(tag, document.getElementById('dateAddInput'));
        hiddenDatePicker.value = '';
    });
}

function removeDateTag(btn) { btn.closest('.date-tag').remove(); }

/* ============================================================
   SAVE REMINDER — AUTH + VALIDATION + SUPABASE INSERT
   ============================================================ */
const saveBtn = document.getElementById('saveBtn');

if (saveBtn) {
    saveBtn.addEventListener('click', async () => {

        /* ── Validate required fields ── */
        const medName = document.getElementById('med-name')?.value.trim();
        const dosage  = document.getElementById('dosage')?.value.trim();

        if (!medName) { showToast('Please enter a medication name.', 'error'); return; }
        if (!dosage)  { showToast('Please enter a dosage amount.', 'error');   return; }

        /* ── Get logged-in user ── */
        if (!db) { showToast('Connection error. Please refresh.', 'error'); return; }

        const { data: { user }, error: authErr } = await db.auth.getUser();
        if (authErr || !user) {
            showToast('You must be logged in to save reminders.', 'error');
            return;
        }

        /* ── Detect reminder type from page title ── */
        const reminderType = document.title.includes('Weekly')      ? 'Weekly'
                           : document.title.includes('As Needed')   ? 'As Needed'
                           : document.title.includes('Specific')    ? 'Specific Days'
                           : 'Daily';

        /* ── Collect form values ── */
        /* FIX: HTML uses id="med-form", not "form-select" */
        const medForm   = document.getElementById('med-form')?.value   || null;
        const startDate = document.getElementById('start-date')?.value || null;

        /* ── Times ── */
        const times = [];
        document.querySelectorAll('.time-row').forEach(row => {
            const t = row.querySelector('.time-input')?.value;
            const m = row.querySelector('.select-input')?.value;
            if (t) times.push({ time: t, meal: m || '' });
        });

        /* ── Days (Weekly / Specific Days) ── */
        const activeDays = [...document.querySelectorAll('.day-btn--active')]
            .map(b => b.dataset.day).filter(Boolean);

        /* ── Dates (As Needed) ── */
        const activeDates = [...document.querySelectorAll('.date-tag')]
            .map(t => t.firstChild.textContent.trim());

        /* ── Notifications ── */
        const notifications = [];
        document.querySelectorAll('.notif-card').forEach(card => {
            if (card.querySelector('.hidden-check')?.checked) {
                const title = card.querySelector('.notif-title')?.textContent.trim();
                if (title) notifications.push(title);
            }
        });

        /* ── Build payload ── */
        const payload = {
            user_id:       user.id,          /* links reminder to logged-in user */
            med_name:      medName,
            dosage:        dosage,
            med_form:      medForm,
            reminder_type: reminderType,
            start_date:    startDate,
            times:         times,            /* jsonb — no need to stringify */
            active_days:   activeDays,
            active_dates:  activeDates,
            notifications: notifications,
            status:        'due',            /* default — changed to taken/missed later */
        };

        /* ── Save to Supabase ── */
        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        const { error: insertErr } = await db
            .from('reminders')
            .insert(payload);

        saveBtn.disabled  = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Reminder';

        if (insertErr) {
            console.error('[SetReminders] Insert error:', insertErr);
            showToast('Failed to save: ' + insertErr.message, 'error');
            return;
        }

        console.log('[SetReminders] Saved:', payload);
        showToast('✓ Reminder saved successfully!', 'success');

        /* Redirect back to reminders list after short delay */
        setTimeout(() => { window.location.href = 'UserReminders.html'; }, 1500);
    });
}
