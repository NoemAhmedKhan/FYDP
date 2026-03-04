// ==========================================
//  MEDIFINDER PHARMACIST EXPIRY ALERTS SCRIPTS
// ==========================================

(function () {
  'use strict';

  // === SIDEBAR ===
  const sidebar  = document.getElementById('sidebar');
  const hamBtn   = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');

  function toggleSidebar() {
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('open');
      if (hamBtn) hamBtn.setAttribute('aria-expanded', String(isOpen));
    }
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('open');
      if (hamBtn) hamBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (hamBtn)   hamBtn.addEventListener('click', toggleSidebar);
  if (sOverlay) sOverlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  // === LOW STOCK LIST ===
  const LOW_STOCK = [
    { name: 'Paracetamol 500mg', sub: 'Box of 100 tabs',  qty: 12, level: 'red',   threshold: '50 Units' },
    { name: 'Amoxicillin Syrup', sub: '100ml Bottle',     qty:  5, level: 'red',   threshold: '20 Units' },
    { name: 'Cetirizine 10mg',   sub: 'Leaf of 10 tabs',  qty:  0, level: 'red',   threshold: '40 Units' },
    { name: 'Insulin Glargine',  sub: 'Injection Pen',    qty:  3, level: 'red',   threshold: '10 Units' },
    { name: 'Amlodipine 5mg',    sub: 'Box of 30 tabs',   qty:  8, level: 'amber', threshold: '25 Units' },
    { name: 'Atorvastatin 20mg', sub: 'Box of 28 tabs',   qty:  4, level: 'red',   threshold: '30 Units' },
  ];

  (function renderLowStock() {
    const list = document.getElementById('lowStockList');
    if (!list) return;

    const fragment = document.createDocumentFragment();
    LOW_STOCK.forEach(function (item) {
      const li = document.createElement('li');
      li.className = 'stock-item';
      li.innerHTML =
        '<div class="stock-info">' +
          '<p class="stock-name">' + item.name + '</p>' +
          '<p class="stock-sub">'  + item.sub  + '</p>' +
        '</div>' +
        '<div class="stock-item-right">' +
          '<span class="qty-pill qty-pill--' + item.level + '">' + item.qty + ' Units</span>' +
          '<span class="threshold">' + item.threshold + '</span>' +
        '</div>';
      fragment.appendChild(li);
    });
    list.appendChild(fragment);
  }());

  // === NEAR EXPIRY LIST ===
  function statusInfo(days) {
    if (days <= 30) return { cls: 'exp-status--critical', icon: 'fa-solid fa-circle-exclamation' };
    if (days <= 60) return { cls: 'exp-status--warning',  icon: 'fa-solid fa-triangle-exclamation' };
    return               { cls: 'exp-status--safe',     icon: 'fa-regular fa-clock' };
  }

  const EXPIRY_ITEMS = [
    { name: 'Metformin 500mg',  batch: 'B-2901-X', date: 'Nov 24, 2024', days: 12 },
    { name: 'Loratadine',       batch: 'B-1142-L', date: 'Dec 05, 2024', days: 23 },
    { name: 'Omeprazole',       batch: 'B-8821-O', date: 'Jan 12, 2025', days: 61 },
    { name: 'Ventolin Inhaler', batch: 'B-3349-V', date: 'Nov 30, 2024', days: 18 },
    { name: 'Gliclazide 80mg',  batch: 'B-5521-G', date: 'Dec 20, 2024', days: 38 },
    { name: 'Simvastatin 40mg', batch: 'B-9902-S', date: 'Dec 15, 2024', days: 33 },
  ];

  (function renderExpiry() {
    const list = document.getElementById('expiryList');
    if (!list) return;

    const fragment = document.createDocumentFragment();
    EXPIRY_ITEMS.forEach(function (item) {
      var info = statusInfo(item.days);
      const li = document.createElement('li');
      li.className = 'expiry-item';
      li.innerHTML =
        '<p class="exp-name">'  + item.name  + '</p>' +
        '<p class="exp-batch">' + item.batch + '</p>' +
        '<p class="exp-date">'  + item.date  + '</p>' +
        '<p class="exp-status ' + info.cls + '">' +
          '<i class="' + info.icon + '" aria-hidden="true"></i>' +
          ' ' + item.days + ' Days left' +
        '</p>';
      fragment.appendChild(li);
    });
    list.appendChild(fragment);
  }());

}());
