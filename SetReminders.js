/* ============================================================
   MediFinder — SetReminders.js  v4.0  (Unified)

   SIMPLIFIED MODEL vs v3.x:
   - No frequency types (Daily / Weekly / Specific Days / As Needed)
   - User picks: start date + reminder time(s) + days of week
   - Always saved to DB as reminder_type = 'Specific Days'
   - active_days holds the selected days (Mon, Tue, …, Sun)
   - Picking all 7 days behaves exactly like the old "Daily" type
     because generate_reminder_instances iterates on active_days
     for the 'Specific Days' branch.
   - No DB schema changes required.
   ============================================================ */

'use strict';

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
        `background:${type === 'success' ? '#208B3A' : type === 'error' ? '#ef4444' : '#3b82f6'}`,
        'opacity:0;transform:translateY(-10px)',
        'transition:opacity .3s ease,transform .3s ease'
    ].join(';');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(-10px)';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}

/* ============================================================
   DAY SELECTOR
   ============================================================ */
const ALL_DAYS     = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS     = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKEND_DAYS = ['Sat', 'Sun'];

function getSelectedDays() {
    return [...document.querySelectorAll('.day-btn--active')]
        .map(b => b.dataset.day)
        .filter(Boolean);
}

function setDays(days) {
    const dayCountEl = document.getElementById('dayCount');
    document.querySelectorAll('.day-btn').forEach(btn => {
        const active = days.includes(btn.dataset.day);
        btn.classList.toggle('day-btn--active', active);
        btn.setAttribute('aria-pressed', String(active));
    });
    if (dayCountEl) {
        const n = days.length;
        dayCountEl.textContent = n === 0 ? '0 days selected'
            : n === 1 ? '1 day selected'
            : `${n} days selected`;
    }
}

/* ============================================================
   ADD TIME ROW
   ============================================================ */
function addTimeRow(timeValue = '08:00') {
    const box = document.getElementById('timeRows');
    if (!box) return;

    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `
        <input type="time" class="time-input" value="${timeValue}" aria-label="Reminder time">
        <div class="select-wrap time-meal-select">
            <select class="select-input" aria-label="Meal timing">
                <option>Before meal</option>
                <option>After meal</option>
                <option>With meal</option>
                <option>Empty stomach</option>
            </select>
            <i class="fa-solid fa-chevron-down select-arrow"></i>
        </div>
        <button class="time-remove" title="Remove time" onclick="removeTimeRow(this)">
            <i class="fa-solid fa-xmark"></i>
        </button>`;

    box.appendChild(row);
    buildScrollPicker(row);          // attach custom AM/PM picker
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
   DOM READY
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

    /* ── Default start date = today ── */
    const startDateEl = document.getElementById('start-date');
    if (startDateEl && !startDateEl.value) {
        startDateEl.value = new Date().toISOString().split('T')[0];
    }

    /* ── Day buttons — multi-select toggle ── */
    const dayBtnsEl = document.getElementById('dayBtns');
    if (dayBtnsEl) {
        dayBtnsEl.querySelectorAll('.day-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.classList.toggle('day-btn--active');
                btn.setAttribute('aria-pressed',
                    String(btn.classList.contains('day-btn--active')));
                const n = dayBtnsEl.querySelectorAll('.day-btn--active').length;
                const el = document.getElementById('dayCount');
                if (el) el.textContent = n === 1 ? '1 day selected' : `${n} days selected`;
            });
        });
    }

    /* ── Shortcut buttons ── */
    document.getElementById('selectAllDays')?.addEventListener('click', () => setDays(ALL_DAYS));
    document.getElementById('selectWeekdays')?.addEventListener('click', () => setDays(WEEKDAYS));
    document.getElementById('selectWeekend')?.addEventListener('click', () => setDays(WEEKEND_DAYS));
    document.getElementById('clearDays')?.addEventListener('click', () => setDays([]));

    /* ── Add Another Time ── */
    document.getElementById('addTimeBtn')?.addEventListener('click', () => addTimeRow());

    /* ── Notification card toggles ── */
    document.querySelectorAll('.notif-card').forEach(card => {
        card.addEventListener('click', () => {
            const cb    = card.querySelector('.hidden-check');
            const check = card.querySelector('.custom-check');
            if (!cb) return;
            cb.checked = !cb.checked;
            card.classList.toggle('notif-card--active', cb.checked);
            check.classList.toggle('custom-check--checked', cb.checked);
        });
    });

    /* ── Build custom AM/PM picker for each pre-existing time row ── */
    document.querySelectorAll('.time-row').forEach(row => buildScrollPicker(row));

    /* ── Show the Add Another Time footer (re-enable it) ── */
    document.querySelectorAll('.times-footer').forEach(el => {
        el.style.removeProperty('display');
    });
});

/* ============================================================
   CUSTOM AM/PM TIME PICKER  (unchanged from v3)
   ============================================================ */
function buildScrollPicker(row) {
    const nativeInput = row.querySelector('.time-input');
    if (!nativeInput) return;
    // Avoid double-init
    if (row.querySelector('.custom-time-picker')) return;

    const initVal  = nativeInput.value || '08:00';
    const parts    = initVal.split(':');
    const initH24  = parseInt(parts[0], 10) || 8;
    const initMin  = parseInt(parts[1], 10) || 0;
    const initAmpm = initH24 < 12 ? 'AM' : 'PM';
    const initH12  = initH24 % 12 || 12;
    const initMinR = Math.round(initMin / 15) * 15 % 60;

    nativeInput.style.cssText =
        'position:absolute;opacity:0;pointer-events:none;width:0;height:0;flex:0 0 0;';

    const hiddenVal = document.createElement('input');
    hiddenVal.type      = 'hidden';
    hiddenVal.className = 'time-input-value';
    hiddenVal.value     = initVal;
    row.appendChild(hiddenVal);

    const HOURS   = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const MINUTES = ['00', '15', '30', '45'];
    const AMPMS   = ['AM', 'PM'];

    let selH12  = String(initH12).padStart(2, '0');
    let selMin  = String(initMinR).padStart(2, '0');
    let selAmpm = initAmpm;
    let displayEl = null;

    function syncValue() {
        let h24 = parseInt(selH12, 10) % 12;
        if (selAmpm === 'PM') h24 += 12;
        hiddenVal.value = `${String(h24).padStart(2, '0')}:${selMin}`;
        if (displayEl) displayEl.textContent = `${selH12}:${selMin} ${selAmpm}`;
    }

    function buildDrum(values, selected, ariaLabel, cssExtra) {
        const wrap  = document.createElement('div');
        wrap.className = 'tp-drum' + (cssExtra ? ' ' + cssExtra : '');
        const label = document.createElement('div');
        label.className   = 'tp-col-label';
        label.textContent = ariaLabel;
        const list  = document.createElement('ul');
        list.className = 'tp-drum__list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', ariaLabel);

        values.forEach(val => {
            const li = document.createElement('li');
            li.className   = 'tp-drum__item' + (val === selected ? ' tp-drum__item--active' : '');
            li.textContent = val;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', val === selected ? 'true' : 'false');
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                list.querySelectorAll('.tp-drum__item').forEach(i => {
                    i.classList.remove('tp-drum__item--active');
                    i.setAttribute('aria-selected', 'false');
                });
                li.classList.add('tp-drum__item--active');
                li.setAttribute('aria-selected', 'true');
                if (ariaLabel === 'Hour')  selH12  = val;
                if (ariaLabel === 'Min')   selMin  = val;
                if (ariaLabel === 'AM/PM') selAmpm = val;
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

    const sep = document.createElement('span');
    sep.className   = 'tp-sep';
    sep.textContent = ':';
    sep.setAttribute('aria-hidden', 'true');

    const panel = document.createElement('div');
    panel.className = 'tp-panel';
    panel.appendChild(hourCol.wrap);
    panel.appendChild(sep);
    panel.appendChild(minCol.wrap);
    panel.appendChild(ampmCol.wrap);

    const iconEl = document.createElement('i');
    iconEl.className = 'fa-regular fa-clock tp-icon';
    displayEl = document.createElement('span');
    displayEl.className   = 'tp-display';
    displayEl.textContent = `${selH12}:${selMin} ${selAmpm}`;
    const chevronEl = document.createElement('i');
    chevronEl.className = 'fa-solid fa-chevron-down tp-chevron';

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
    picker.appendChild(panel);

    const mealSelect = row.querySelector('.time-meal-select');
    if (mealSelect) row.insertBefore(picker, mealSelect);
    else            row.appendChild(picker);

    function openPicker() {
        picker.classList.add('custom-time-picker--open');
        picker.setAttribute('aria-expanded', 'true');
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
        document.querySelectorAll('.custom-time-picker--open').forEach(p => {
            p.classList.remove('custom-time-picker--open');
            p.setAttribute('aria-expanded', 'false');
        });
        if (!isOpen) openPicker();
    });
    picker.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
        if (e.key === 'Escape') closePicker();
    });
    document.addEventListener('click', () => closePicker());
}

/* ============================================================
   SAVE REMINDER
   ============================================================ */
document.getElementById('saveBtn')?.addEventListener('click', async () => {

    const medName = document.getElementById('med-name')?.value.trim();
    const dosage  = document.getElementById('dosage')?.value.trim();

    if (!medName) { showToast('Please enter a medication name.', 'error'); return; }
    if (!dosage)  { showToast('Please enter a dosage amount.',   'error'); return; }

    const activeDays = getSelectedDays();
    if (activeDays.length === 0) {
        showToast('Please select at least one day for the reminder.', 'error');
        return;
    }

    if (!db) { showToast('Connection error. Please refresh.', 'error'); return; }

    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) {
        showToast('You must be logged in to save reminders.', 'error');
        setTimeout(() => window.location.href = 'Login.html', 1500);
        return;
    }

    const user      = session.user;
    const medForm   = document.getElementById('med-form')?.value   || null;
    const startDate = document.getElementById('start-date')?.value || null;

    /* Collect times — prefer hidden picker value, fall back to native input */
    const times = [...document.querySelectorAll('.time-row')].map(row => ({
        time: row.querySelector('.time-input-value')?.value
           || row.querySelector('.time-input')?.value
           || '',
        meal: row.querySelector('.select-input')?.value || ''
    })).filter(t => t.time);

    const notifications = [...document.querySelectorAll('.notif-card')]
        .filter(c => c.querySelector('.hidden-check')?.checked)
        .map(c => c.querySelector('.notif-title')?.textContent.trim())
        .filter(Boolean);

    /* ── Always save as 'Specific Days' ──────────────────────────
       The generate_reminder_instances RPC handles 'Specific Days'
       by checking active_days against the day name for each date,
       so selecting all 7 days = daily behaviour, 1 day = weekly,
       any subset = the specific-days pattern.
       No DB schema changes required.
    ──────────────────────────────────────────────────────────── */
    const payload = {
        user_id:       user.id,
        med_name:      medName,
        dosage:        dosage,
        med_form:      medForm,
        reminder_type: 'Specific Days',   // unified type for all selections
        start_date:    startDate,
        times:         times,
        active_days:   activeDays,
        active_dates:  [],                 // unused; kept for schema compat
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
