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
            const v = hiddenDatePicker.value;
            if (!v) return;
            const label = new Date(v + 'T00:00:00')
                .toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
            const exists = [...dateTagRow.querySelectorAll('.date-tag')]
                .some(tag => tag.firstChild.textContent.trim() === label);
            if (exists) { hiddenDatePicker.value = ''; return; }
            const tag = document.createElement('span');
            tag.className = 'date-tag';
            tag.innerHTML = `${label}<button class="date-tag__remove" onclick="removeDateTag(this)" aria-label="Remove date"><i class="fa-solid fa-xmark"></i></button>`;
            dateTagRow.insertBefore(tag, document.getElementById('dateAddInput'));
            hiddenDatePicker.value = '';
        });
    }
});

/* ============================================================
   C. CUSTOM AM/PM SCROLL-DRUM PICKER
   ─────────────────────────────────────────────────────────────
   Replaces the native time input in each .time-row with a
   3-column picker: [ Hour ] : [ Minute ] [ AM|PM ]

   Each column is a scrollable list. Clicking any item selects
   it (highlighted). A hidden input (.time-input-value) stores
   the resulting 24h time string for the save function.

   The native <input type="time"> is hidden in place.
   ============================================================ */
function buildScrollPicker(row) {
    const nativeInput = row.querySelector('.time-input');
    if (!nativeInput) return;

    /* Parse initial value */
    const initVal = nativeInput.value || '08:00';
    const parts   = initVal.split(':');
    const initH24 = parseInt(parts[0], 10) || 8;
    const initMin = parseInt(parts[1], 10) || 0;
    const initAmpm  = initH24 < 12 ? 'AM' : 'PM';
    const initH12   = initH24 % 12 || 12;
    /* Round minute to nearest 5 for scroll list */
    const initMinR  = Math.round(initMin / 5) * 5 % 60;

    /* Hide native input — keep in DOM for CSS layout, 0-size */
    nativeInput.style.cssText =
        'position:absolute;opacity:0;pointer-events:none;width:0;height:0;flex:0 0 0;';

    /* Hidden value input — the picker writes 24h here */
    const hiddenVal = document.createElement('input');
    hiddenVal.type      = 'hidden';
    hiddenVal.className = 'time-input-value';
    hiddenVal.value     = initVal;
    row.appendChild(hiddenVal);

    /* Build picker shell */
    const picker = document.createElement('div');
    picker.className = 'custom-time-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Time picker');

    /* Values */
    const HOURS   = Array.from({length:12}, (_,i) => String(i+1).padStart(2,'0'));
    const MINUTES = Array.from({length:12}, (_,i) => String(i*5).padStart(2,'0'));
    const AMPMS   = ['AM','PM'];

    /* ── Build one drum column ── */
    function buildDrum(values, selectedVal, ariaLabel) {
        const wrap = document.createElement('div');
        wrap.className = 'tp-drum';
        wrap.setAttribute('aria-label', ariaLabel);

        const list = document.createElement('ul');
        list.className = 'tp-drum__list';

        values.forEach(v => {
            const li = document.createElement('li');
            li.className   = 'tp-drum__item';
            li.textContent = v;
            li.setAttribute('role', 'option');

            const match = String(selectedVal).padStart(2, '0');
            if (v === match || v === String(selectedVal)) {
                li.classList.add('tp-drum__item--active');
                li.setAttribute('aria-selected', 'true');
            }

            li.addEventListener('click', () => {
                list.querySelectorAll('.tp-drum__item--active').forEach(el => {
                    el.classList.remove('tp-drum__item--active');
                    el.removeAttribute('aria-selected');
                });
                li.classList.add('tp-drum__item--active');
                li.setAttribute('aria-selected', 'true');
                syncValue();
                li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });

            list.appendChild(li);
        });

        wrap.appendChild(list);
        return { wrap, list };
    }

    const hourCol   = buildDrum(HOURS,   String(initH12).padStart(2,'0'),  'Hour');
    const minCol    = buildDrum(MINUTES, String(initMinR).padStart(2,'0'), 'Minute');
    const ampmCol   = buildDrum(AMPMS,   initAmpm,                         'AM or PM');

    /* Separator */
    const sep = document.createElement('span');
    sep.className   = 'tp-sep';
    sep.textContent = ':';
    sep.setAttribute('aria-hidden', 'true');

    picker.appendChild(hourCol.wrap);
    picker.appendChild(sep);
    picker.appendChild(minCol.wrap);
    picker.appendChild(ampmCol.wrap);

    /* ── Sync selected → hidden 24h value ── */
    function syncValue() {
        const h12Str  = hourCol.list.querySelector('.tp-drum__item--active')?.textContent || '8';
        const minStr  = minCol.list.querySelector('.tp-drum__item--active')?.textContent  || '00';
        const ampmStr = ampmCol.list.querySelector('.tp-drum__item--active')?.textContent || 'AM';
        let h24 = parseInt(h12Str, 10) % 12;
        if (ampmStr === 'PM') h24 += 12;
        hiddenVal.value = `${String(h24).padStart(2,'0')}:${minStr}`;
    }

    /* Insert picker before the meal select, or append */
    const mealSelect = row.querySelector('.time-meal-select');
    if (mealSelect) row.insertBefore(picker, mealSelect);
    else            row.appendChild(picker);

    /* ── Click picker to expand/collapse ── */
    picker.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = picker.classList.contains('custom-time-picker--open');
        /* Close all other open pickers first */
        document.querySelectorAll('.custom-time-picker--open').forEach(p => {
            p.classList.remove('custom-time-picker--open');
            p.querySelectorAll('.tp-drum__list').forEach(l => {
                l.style.maxHeight = '30px';
                l.style.overflowY = 'hidden';
            });
        });
        if (!isOpen) {
            picker.classList.add('custom-time-picker--open');
            picker.querySelectorAll('.tp-drum__list').forEach(l => {
                l.style.maxHeight = '220px';
                l.style.overflowY = 'auto';
                /* Scroll active item into view */
                const active = l.querySelector('.tp-drum__item--active');
                if (active) active.scrollIntoView({ block: 'nearest' });
            });
        }
    });

    /* Click outside closes picker */
    document.addEventListener('click', () => {
        picker.classList.remove('custom-time-picker--open');
        picker.querySelectorAll('.tp-drum__list').forEach(l => {
            l.style.maxHeight = '30px';
            l.style.overflowY = 'hidden';
        });
    }, { capture: false });
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

    showToast('Reminder saved successfully!', 'success');
    setTimeout(() => window.location.href = 'UserReminders.html', 1200);
});
