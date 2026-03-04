'use strict';

/* ============================================================
   PharmStockManagement.js
   Stock Management — Page Scripts

   SECTIONS
   1. Sidebar Toggle
   2. Inventory Table Builder
   3. Pagination
   4. Live Search Filter
   ============================================================ */

/* ─────────────────────────────────────────
   1. SIDEBAR TOGGLE
   ───────────────────────────────────────── */
(function () {
  const sidebar  = document.getElementById('sidebar');
  const hamBtn   = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');

  function closeSidebar() {
    sidebar.classList.remove('open');
    hamBtn.setAttribute('aria-expanded', 'false');
  }

  hamBtn.addEventListener('click', function () {
    const isOpen = sidebar.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
  });

  sOverlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });
}());

/* ─────────────────────────────────────────
   2. INVENTORY TABLE BUILDER
   ───────────────────────────────────────── */
(function () {
  /* First-letter → avatar background colour */
  var LETTER_COLORS = {
    P: '#dcfce7',
    A: '#dbeafe',
    S: '#fef9c3',
    C: '#fce7f3',
    I: '#ede9fe',
    M: '#fff7ed',
  };

  var inventory = [
    { name: 'Panadol CF',      sub: 'Paracetamol (500mg)',     batch: '#BN-88219', qty: '1,240', isLow: false, expiry: 'Dec 12, 2025', expiryAlert: false, supplier: 'GSK Pharma'     },
    { name: 'Augmentin 625mg', sub: 'Amoxicillin/Clavulanate', batch: '#BN-11044', qty: '42',    isLow: true,  expiry: 'Oct 15, 2024', expiryAlert: true,  supplier: 'Getz Healthcare' },
    { name: 'Surbex Z',        sub: 'Multivitamin/Zinc',       batch: '#BN-20339', qty: '4,500', isLow: false, expiry: 'May 20, 2026', expiryAlert: false, supplier: 'Abbott Labs'    },
    { name: 'Cetirizine 10mg', sub: 'Antihistamine',           batch: '#BN-33412', qty: '320',   isLow: false, expiry: 'Aug 05, 2025', expiryAlert: false, supplier: 'Hilton Pharma'  },
    { name: 'Metformin 500mg', sub: 'Antidiabetic',            batch: '#BN-55210', qty: '780',   isLow: false, expiry: 'Mar 18, 2026', expiryAlert: false, supplier: 'PharmEvo'       },
  ];

  var tbody    = document.getElementById('inventoryBody');
  var fragment = document.createDocumentFragment();

  inventory.forEach(function (item) {
    var letter  = item.name[0].toUpperCase();
    var bgColor = LETTER_COLORS[letter] || '#f3f4f6';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' +
        '<div class="drug-cell">' +
          '<span class="drug-letter" style="background:' + bgColor + '" aria-hidden="true">' + letter + '</span>' +
          '<div>' +
            '<p class="drug-name">' + item.name + '</p>' +
            '<p class="drug-sub">'  + item.sub  + '</p>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="td-batch">' + item.batch + '</td>' +
      '<td>' +
        '<span class="qty-val">' + item.qty + '</span> ' +
        (item.isLow
          ? '<span class="badge badge--red">LOW</span>'
          : '<span class="qty-unit">UNITS</span>') +
      '</td>' +
      '<td class="' + (item.expiryAlert ? 'expiry-red' : '') + '">' + item.expiry + '</td>' +
      '<td class="td-supplier">' + item.supplier + '</td>';

    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);

  /* ─────────────────────────────────────────
     3. PAGINATION
     ───────────────────────────────────────── */
  document.querySelectorAll('.page-btn').forEach(function (btn) {
    if (btn.querySelector('i')) return;           /* skip arrow buttons */
    btn.addEventListener('click', function () {
      document.querySelectorAll('.page-btn').forEach(function (b) {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
      });
      this.classList.add('active');
      this.setAttribute('aria-current', 'page');
    });
  });

  /* ─────────────────────────────────────────
     4. LIVE SEARCH FILTER
     ───────────────────────────────────────── */
  document.getElementById('inventorySearch').addEventListener('input', function () {
    var q = this.value.toLowerCase();
    document.querySelectorAll('#inventoryBody tr').forEach(function (row) {
      var nameEl = row.querySelector('.drug-name');
      var name   = nameEl ? nameEl.textContent.toLowerCase() : '';
      row.hidden = q.length > 0 && !name.includes(q);
    });
  });
}());
