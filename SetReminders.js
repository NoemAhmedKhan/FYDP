// ============================
// NOTIFICATION CARD TOGGLE
// ============================

document.querySelectorAll('.notif-card').forEach(card => {
    card.addEventListener('click', () => {
        const checkbox = card.querySelector('.hidden-check');
        const check    = card.querySelector('.custom-check');
        checkbox.checked = !checkbox.checked;
        card.classList.toggle('notif-card--active', checkbox.checked);
        check.classList.toggle('custom-check--checked', checkbox.checked);
    });
});

// ============================
// REMOVE TIME ROW
// ============================

function removeTimeRow(btn) {
    const box = document.getElementById('timeRows');
    if (box && box.querySelectorAll('.time-row').length > 1) {
        btn.closest('.time-row').remove();
    }
}

// ============================
// ADD TIME ROW
// ============================

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
            <button class="time-remove" title="Remove" onclick="removeTimeRow(this)" aria-label="Remove this time">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        box.appendChild(row);
        box.scrollTop = box.scrollHeight;
    });
}

// ============================
// WEEKLY / SPECIFIC DAYS — DAY BUTTONS
// (single select for Weekly, multi for Specific Days)
// ============================

const dayBtnsContainer = document.getElementById('dayBtns');
const dayCount         = document.getElementById('dayCount');

if (dayBtnsContainer) {
    const isWeekly = document.title.includes('Weekly');

    dayBtnsContainer.querySelectorAll('.day-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (isWeekly) {
                // Single select for Weekly
                dayBtnsContainer.querySelectorAll('.day-btn').forEach(b => b.classList.remove('day-btn--active'));
                btn.classList.add('day-btn--active');
            } else {
                // Multi select for Specific Days
                btn.classList.toggle('day-btn--active');
            }
            updateDayCount();
        });
    });

    function updateDayCount() {
        if (!dayCount) return;
        const selected = dayBtnsContainer.querySelectorAll('.day-btn--active').length;
        dayCount.textContent = selected === 1 ? '1 day selected' : `${selected} days selected`;
    }
}

// ============================
// AS NEEDED — DATE TAGS
// ============================

const calendarBtn      = document.getElementById('calendarBtn');
const hiddenDatePicker = document.getElementById('hiddenDatePicker');
const dateTagRow       = document.getElementById('dateTagRow');

if (calendarBtn && hiddenDatePicker && dateTagRow) {
    // Open native date picker on calendar button click
    calendarBtn.addEventListener('click', () => hiddenDatePicker.showPicker());

    hiddenDatePicker.addEventListener('change', () => {
        const val = hiddenDatePicker.value; // e.g. "2026-03-15"
        if (!val) return;

        // Format: "Mar 15, 2026"
        const date    = new Date(val + 'T00:00:00');
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const label   = date.toLocaleDateString('en-US', options);

        // Check for duplicates
        const existing = [...dateTagRow.querySelectorAll('.date-tag')].map(t => t.firstChild.textContent.trim());
        if (existing.includes(label)) {
            hiddenDatePicker.value = '';
            return;
        }

        const tag = document.createElement('span');
        tag.classList.add('date-tag');
        tag.innerHTML = `${label}
            <button class="date-tag__remove" onclick="removeDateTag(this)" aria-label="Remove date">
                <i class="fa-solid fa-xmark"></i>
            </button>`;

        // Insert before the add-input
        const addInput = document.getElementById('dateAddInput');
        dateTagRow.insertBefore(tag, addInput);
        hiddenDatePicker.value = '';
    });
}

function removeDateTag(btn) {
    btn.closest('.date-tag').remove();
}

// ============================
// SAVE REMINDER — VALIDATION
// ============================

const saveBtn = document.getElementById('saveBtn');

if (saveBtn) {
    saveBtn.addEventListener('click', () => {
        const medName = document.getElementById('med-name')?.value.trim();
        const dosage  = document.getElementById('dosage')?.value.trim();

        if (!medName) {
            alert('Please enter a medication name.');
            return;
        }

        if (!dosage) {
            alert('Please enter a dosage amount.');
            return;
        }

        // Collect times
        const times = [];
        document.querySelectorAll('.time-row').forEach(row => {
            const time = row.querySelector('.time-input')?.value;
            const meal = row.querySelector('.select-input')?.value;
            if (time) times.push({ time, meal });
        });

        // Collect selected days (Weekly / Specific Days)
        const activeDays = [...document.querySelectorAll('.day-btn--active')].map(b => b.dataset.day);

        // Collect date tags (As Needed)
        const activeDates = [...document.querySelectorAll('.date-tag')].map(t => t.firstChild.textContent.trim());

        // Collect notification preferences
        const notifications = [];
        document.querySelectorAll('.notif-card').forEach(card => {
            if (card.querySelector('.hidden-check')?.checked) {
                notifications.push(card.querySelector('.notif-title')?.textContent.trim());
            }
        });

        // Placeholder — connect to your backend API here
        console.log('%c💊 Reminder Saved', 'font-size: 14px; font-weight: bold; color: #208B3A;');
        console.log({ medName, dosage, times, activeDays, activeDates, notifications });

        alert(`Reminder saved!\n\nMedication: ${medName} (${dosage})\nTimes: ${times.map(t => t.time).join(', ')}`);
    });
}

// ============================
// CONSOLE MESSAGE
// ============================

console.log('%c🏥 MediFinder – Set Reminders', 'font-size: 18px; font-weight: bold; color: #208B3A;');
console.log('%cDeveloped with ❤️', 'font-size: 13px; color: #666;');
console.log('%cColor Scheme: White (#F8FAF8), Forest Green (#208B3A), Light Green (#52B167)', 'font-size: 12px; color: #999;');
