/* ============================================================
   MediFinder — SetReminders.js  v2.0
   Shared across: Daily, Weekly, As Needed, Specific Days

   CHANGES IN v2.0:
   A. Step-2 heading renamed "Reminder Time" (was "Reminder Times").
   B. "Add Another Time" button and footer completely removed.
   C. Native <input type="time"> replaced by a custom AM/PM
      scroll-drum picker — shows all hours/minutes clearly,
      fixes the incomplete number display from the browser
      native picker. Writes to a hidden input for save logic.
   D. Save reads .time-input-value (hidden) first, with fallback
      to native .time-input so nothing breaks.
   ============================================================ */

const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

const db = window.supabaseClient
    || (window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY));

/* ============================================================
   TOAST
   ============================================================ */
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
        `background:${type==='success'?'#208B3A':type==='error'?'#ef4444':'#3b82f6'}`,
        'opacity:0;transform:translateY(-10px)',
        'transition:opacity .3s ease,transform .3s ease'
    ].join(';');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; });
    setTimeout(() => {
        t.style.opacity='0';
        t.style.transform='translateY(-10px)';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

/* ============================================================
   DOM READY — runs all setup after HTML is parsed
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

    /* ── A. Rename Step-2 heading to "Reminder Time" ── */
    const timeBox = document.getElementById('timeRows');
    if (timeBox) {
        const stepSection = timeBox.closest('.step-section');
        if (stepSection) {
            const titleEl = stepSection.querySelector('.step-title');
            if (titleEl) titleEl.textContent = 'Reminder Time';
        }
    }

    /* ── B. Remove "Add Another Time" footer entirely ── */
    document.querySelectorAll('.times-footer').forEach(el => el.remove());

    /* ── C. Build custom AM/PM picker for every .time-row ── */
    document.querySelectorAll('.time-row').forEach(row => buildScrollPicker(row));

    /* ── Notification card toggles ── */
    document.querySelectorAll('.notif-card').forEach(card => {
        card.addEventListener('click', () => {
            const cb    = card.querySelector('.hidden-check');
            const check = card.querySelector('.custom-check');
            if (!cb) return;
            cb.checked = !cb.checked;
            card.classList.toggle('notif-card--active',    cb.checked);
            check.classList.toggle('custom-check--checked', cb.checked);
        });
    });

    /* ── Day buttons ── */
    const dayBtnsEl  = document.getElementById('dayBtns');
    const dayCountEl = document.getElementById('dayCount');
    if (dayBtnsEl) {
        const isWeekly = document.title.includes('Weekly');
        dayBtnsEl.querySelectorAll('.day-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (isWeekly) {
                    dayBtnsEl.querySelectorAll('.day-btn')
                        .forEach(b => b.classList.remove('day-btn--active'));
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

    /* ── As Needed — date tags ── */
    const calendarBtn      = document.getElementById('calendarBtn');
    const hiddenDatePicker = document.getElementById('hiddenDatePicker');
    const dateTagRow       = document.getElementById('dateTagRow');
    if (calendarBtn && hiddenDatePicker && dateTagRow) {
        calendarBtn.addEventListener('click', () => {
            if (hiddenDatePicker.showPicker) hiddenDatePicker.showPicker();
            else hiddenDatePicker.click();
        });
        hiddenDatePicker.addEventListener('change', () => {
            const v = hiddenDatePicker.value;   // ISO: "2026-06-05"
            if (!v) return;
            const label = new Date(v + 'T00:00:00')
                .toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
            const exists = [...dateTagRow.querySelectorAll('.date-tag')]
                .some(tag => tag.dataset.isoDate === v);
            if (exists) { hiddenDatePicker.value = ''; return; }
            const tag = document.createElement('span');
            tag.className = 'date-tag';
            tag.dataset.isoDate = v;   // store ISO value on the element
            tag.innerHTML = `${label}<button class="date-tag__remove" onclick="removeDateTag(this)" aria-label="Remove date"><i class="fa-solid fa-xmark"></i></button>`;
            dateTagRow.insertBefore(tag, document.getElementById('dateAddInput'));
            hiddenDatePicker.value = '';
        });
    }
});

/* ============================================================
   C. CUSTOM AM/PM TIME PICKER  (v3 — dropdown panel)
   ─────────────────────────────────────────────────────────────
   Collapsed state : a styled chip that shows "8:00 AM".
   Expanded state  : a dropdown panel with 3 scrollable columns
                     (Hour 1–12 | Minute 00/15/30/45 | AM/PM).
   A hidden input  (.time-input-value) stores the 24-h value
   for the save function.
   ============================================================ */
function buildScrollPicker(row) {
    const nativeInput = row.querySelector('.time-input');
    if (!nativeInput) return;

    /* ── Parse initial value from native input ── */
    const initVal  = nativeInput.value || '08:00';
    const parts    = initVal.split(':');
    const initH24  = parseInt(parts[0], 10) || 8;
    const initMin  = parseInt(parts[1], 10) || 0;
    const initAmpm = initH24 < 12 ? 'AM' : 'PM';
    const initH12  = initH24 % 12 || 12;
    const initMinR = Math.round(initMin / 15) * 15 % 60;

    /* ── Hide native input (keep in DOM, 0-size) ── */
    nativeInput.style.cssText =
        'position:absolute;opacity:0;pointer-events:none;width:0;height:0;flex:0 0 0;';

    /* ── Hidden 24-h value input (read by save logic) ── */
    const hiddenVal = document.createElement('input');
    hiddenVal.type      = 'hidden';
    hiddenVal.className = 'time-input-value';
    hiddenVal.value     = initVal;
    row.appendChild(hiddenVal);

    /* ── Data arrays ── */
    const HOURS   = Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0'));
    const MINUTES = ['00', '15', '30', '45'];
    const AMPMS   = ['AM', 'PM'];

    /* ── State ── */
    let selH12  = String(initH12).padStart(2, '0');
    let selMin  = String(initMinR).padStart(2, '0');
    let selAmpm = initAmpm;

    /* ── Sync hidden value + display label ── */
    function syncValue() {
        let h24 = parseInt(selH12, 10) % 12;
        if (selAmpm === 'PM') h24 += 12;
        hiddenVal.value = `${String(h24).padStart(2, '0')}:${selMin}`;
        if (displayEl) displayEl.textContent = `${selH12}:${selMin} ${selAmpm}`;
    }

    /* ── Build one drum column ── */
    function buildDrum(values, selected, ariaLabel, cssExtra) {
        const wrap  = document.createElement('div');
        wrap.className = 'tp-drum' + (cssExtra ? ' ' + cssExtra : '');

        const label = document.createElement('div');
        label.className   = 'tp-col-label';
        label.textContent = ariaLabel;

        const list = document.createElement('ul');
        list.className = 'tp-drum__list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', ariaLabel);

        values.forEach(v => {
            const li = document.createElement('li');
            li.className   = 'tp-drum__item';
            li.textContent = v;
            li.setAttribute('role', 'option');

            if (v === selected) {
                li.classList.add('tp-drum__item--active');
                li.setAttribute('aria-selected', 'true');
            }

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                list.querySelectorAll('.tp-drum__item--active').forEach(el => {
                    el.classList.remove('tp-drum__item--active');
                    el.removeAttribute('aria-selected');
                });
                li.classList.add('tp-drum__item--active');
                li.setAttribute('aria-selected', 'true');

                /* Update state */
                if (cssExtra === 'tp-drum--ampm') selAmpm = v;
                else if (ariaLabel === 'Hour')    selH12  = v;
                else                              selMin  = v;

                syncValue();
            });

            list.appendChild(li);
        });

        wrap.appendChild(label);
        wrap.appendChild(list);
        return { wrap, list };
    }

    const hourCol  = buildDrum(HOURS,   selH12,  'Hour',  '');
    const minCol   = buildDrum(MINUTES, selMin,  'Min',   '');
    const ampmCol  = buildDrum(AMPMS,   selAmpm, 'AM/PM', 'tp-drum--ampm');

    /* ── Colon separator ── */
    const sep = document.createElement('span');
    sep.className   = 'tp-sep';
    sep.textContent = ':';
    sep.setAttribute('aria-hidden', 'true');

    /* ── Dropdown panel ── */
    const panel = document.createElement('div');
    panel.className = 'tp-panel';
    panel.appendChild(hourCol.wrap);
    panel.appendChild(sep);
    panel.appendChild(minCol.wrap);
    panel.appendChild(ampmCol.wrap);

    /* ── Collapsed display chip ── */
    const iconEl    = document.createElement('i');
    iconEl.className = 'fa-regular fa-clock tp-icon';

    const displayEl = document.createElement('span');
    displayEl.className   = 'tp-display';
    displayEl.textContent = `${selH12}:${selMin} ${selAmpm}`;

    const chevronEl = document.createElement('i');
    chevronEl.className = 'fa-solid fa-chevron-down tp-chevron';

    /* ── Assemble picker shell ── */
    const picker = document.createElement('div');
    picker.className = 'custom-time-picker';
    picker.setAttribute('role', 'button');
    picker.setAttribute('aria-haspopup', 'listbox');
    picker.setAttribute('aria-expanded', 'false');
    picker.setAttribute('tabindex', '0');
    picker.setAttribute('aria-label', 'Time picker');

    picker.appendChild(iconEl);
    picker.appendChild(displayEl);
    picker.appendChild(chevronEl);
    picker.appendChild(panel);   /* panel lives INSIDE picker for z-index stacking */

    /* ── Insert picker before meal select, or append ── */
    const mealSelect = row.querySelector('.time-meal-select');
    if (mealSelect) row.insertBefore(picker, mealSelect);
    else            row.appendChild(picker);

    /* ── Toggle open / close ── */
    function openPicker() {
        picker.classList.add('custom-time-picker--open');
        picker.setAttribute('aria-expanded', 'true');
        /* Scroll active items into view */
        [hourCol.list, minCol.list, ampmCol.list].forEach(list => {
            const active = list.querySelector('.tp-drum__item--active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        });
    }

    function closePicker() {
        picker.classList.remove('custom-time-picker--open');
        picker.setAttribute('aria-expanded', 'false');
    }

    picker.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = picker.classList.contains('custom-time-picker--open');
        /* Close any other open pickers first */
        document.querySelectorAll('.custom-time-picker--open').forEach(p => {
            p.classList.remove('custom-time-picker--open');
            p.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) openPicker();
    });

    /* Keyboard support */
    picker.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            picker.click();
        }
        if (e.key === 'Escape') closePicker();
    });

    /* Click outside closes picker */
    document.addEventListener('click', () => closePicker());
}

/* ============================================================
   REMOVE TIME ROW — guard: never removes last row
   ============================================================ */
function removeTimeRow(btn) {
    const box = document.getElementById('timeRows');
    if (box && box.querySelectorAll('.time-row').length > 1) {
        btn.closest('.time-row').remove();
    }
}

/* ============================================================
   DATE TAG REMOVAL (As Needed)
   ============================================================ */
function removeDateTag(btn) { btn.closest('.date-tag').remove(); }

/* ============================================================
   SAVE REMINDER
   ============================================================ */
document.getElementById('saveBtn')?.addEventListener('click', async () => {

    const medName = document.getElementById('med-name')?.value.trim();
    const dosage  = document.getElementById('dosage')?.value.trim();

    if (!medName) { showToast('Please enter a medication name.', 'error'); return; }
    if (!dosage)  { showToast('Please enter a dosage amount.',   'error'); return; }
    if (!db)      { showToast('Connection error. Please refresh.', 'error'); return; }

    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) {
        showToast('You must be logged in to save reminders.', 'error');
        setTimeout(() => window.location.href = 'Login.html', 1500);
        return;
    }

    const user = session.user;

    const reminderType = document.title.includes('Weekly')    ? 'Weekly'
                       : document.title.includes('As Needed') ? 'As Needed'
                       : document.title.includes('Specific')  ? 'Specific Days'
                       : 'Daily';

    const medForm   = document.getElementById('med-form')?.value   || null;
    const startDate = document.getElementById('start-date')?.value || null;

    /* Read hidden picker value first, fall back to native input */
    const times = [...document.querySelectorAll('.time-row')].map(row => ({
        time: row.querySelector('.time-input-value')?.value
           || row.querySelector('.time-input')?.value
           || '',
        meal: row.querySelector('.select-input')?.value || ''
    })).filter(t => t.time);

    const activeDays = [...document.querySelectorAll('.day-btn--active')]
        .map(b => b.dataset.day).filter(Boolean);

    const activeDates = [...document.querySelectorAll('.date-tag')]
        .map(t => t.dataset.isoDate).filter(Boolean);

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

    showToast('Reminder saved successfully!', 'success');
    setTimeout(() => window.location.href = 'UserReminders.html', 1200);
});
