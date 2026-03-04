'use strict';

/* ============================================================
   PharmInfoUpdate.js
   Pharmacy Profile Update — Page Scripts
   ============================================================

   SECTIONS
   1. Sidebar Toggle
   2. Operating Hours Builder
   ============================================================ */

/* ─────────────────────────────────────────
   1. SIDEBAR TOGGLE
   ───────────────────────────────────────── */
(function () {
  const sidebar = document.getElementById('sidebar');
  const hamBtn  = document.getElementById('hamBtn');
  const overlay = document.getElementById('sOverlay');

  function closeSidebar() {
    sidebar.classList.remove('open');
    hamBtn.setAttribute('aria-expanded', 'false');
  }

  hamBtn.addEventListener('click', function () {
    const isOpen = sidebar.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
  });

  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });
}());

/* ─────────────────────────────────────────
   2. OPERATING HOURS BUILDER
   ───────────────────────────────────────── */
(function () {
  const DAYS = [
    { label: 'Monday',    open: true,  from: '09:00 AM', to: '10:00 PM' },
    { label: 'Tuesday',   open: true,  from: '09:00 AM', to: '10:00 PM' },
    { label: 'Wednesday', open: true,  from: '09:00 AM', to: '10:00 PM' },
    { label: 'Thursday',  open: true,  from: '09:00 AM', to: '10:00 PM' },
    { label: 'Friday',    open: true,  from: '09:00 AM', to: '10:00 PM' },
    { label: 'Saturday',  open: true,  from: '10:00 AM', to: '06:00 PM' },
    { label: 'Sunday',    open: false, from: '',         to: ''          },
  ];

  const container = document.getElementById('hoursContainer');
  const fragment  = document.createDocumentFragment();

  DAYS.forEach(function (d, i) {
    const fromId = 'from-' + i;
    const toId   = 'to-'   + i;
    const chkId  = 'chk-'  + i;

    const row = document.createElement('div');
    row.className = 'hours-row';
    row.setAttribute('role', 'listitem');

    row.innerHTML =
      '<span class="hours-day">' + d.label + '</span>' +

      '<div class="hours-time">' +
        '<label class="sr-only" for="' + fromId + '">Open time for ' + d.label + '</label>' +
        '<input id="' + fromId + '" type="text" value="' + d.from + '" placeholder="Closed"' + (d.open ? '' : ' disabled') + '>' +
        '<i class="fa-regular fa-clock hours-icon" aria-hidden="true"></i>' +
        '<span class="hours-sep" aria-hidden="true">to</span>' +
        '<label class="sr-only" for="' + toId + '">Close time for ' + d.label + '</label>' +
        '<input id="' + toId + '" type="text" value="' + d.to + '" placeholder="Closed"' + (d.open ? '' : ' disabled') + '>' +
        '<i class="fa-regular fa-clock hours-icon" aria-hidden="true"></i>' +
      '</div>' +

      '<label class="toggle" aria-label="' + d.label + ' open">' +
        '<input type="checkbox" id="' + chkId + '"' + (d.open ? ' checked' : '') + '>' +
        '<span class="toggle-slider"></span>' +
      '</label>';

    /* Toggle: enable / disable time inputs */
    const checkbox   = row.querySelector('input[type="checkbox"]');
    const timeInputs = row.querySelectorAll('.hours-time input');

    checkbox.addEventListener('change', function () {
      timeInputs.forEach(function (inp) {
        inp.disabled = !checkbox.checked;
      });
    });

    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}());
