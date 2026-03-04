// ==========================================
//  MEDIFINDER PHARMACIST BILLING HISTORY SCRIPTS
// ==========================================

(function () {
  'use strict';

  // === DOM ELEMENTS ===
  const sidebar  = document.getElementById('sidebar');
  const hamBtn   = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');

  // === SIDEBAR FUNCTIONALITY ===
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

  // === TRANSACTION DATA ===
  const AVATAR_COLORS = {
    ZS: '#dcfce7',
    MK: '#fce7f3',
    AA: '#ede9fe',
    FR: '#fff7ed',
    SQ: '#eff6ff',
  };

  const TRANSACTIONS = [
    { id: '#TXN-84920', name: 'Zeeshan Sheikh', initials: 'ZS', date: 'Oct 24, 2023', time: '10:30 AM', amount: '4,500',  paymentIcon: 'fa-credit-card',    payment: 'Visa •••• 4242',       status: 'PAID',     statusClass: 'badge--green' },
    { id: '#TXN-84921', name: 'Maryam Khan',    initials: 'MK', date: 'Oct 24, 2023', time: '11:15 AM', amount: '1,250',  paymentIcon: 'fa-money-bill-wave', payment: 'Cash on Counter',      status: 'PAID',     statusClass: 'badge--green' },
    { id: '#TXN-84922', name: 'Ahmed Ali',       initials: 'AA', date: 'Oct 23, 2023', time: '04:45 PM', amount: '8,900',  paymentIcon: 'fa-mobile-screen',   payment: 'JazzCash / EasyPaisa', status: 'PAID',     statusClass: 'badge--green' },
    { id: '#TXN-84923', name: 'Fahad Raza',      initials: 'FR', date: 'Oct 23, 2023', time: '01:20 PM', amount: '2,100',  paymentIcon: 'fa-credit-card',     payment: 'Mastercard •••• 9901', status: 'REFUNDED', statusClass: 'badge--red'   },
    { id: '#TXN-84924', name: 'Sara Qureshi',    initials: 'SQ', date: 'Oct 22, 2023', time: '03:10 PM', amount: '3,750',  paymentIcon: 'fa-credit-card',     payment: 'Visa •••• 8811',       status: 'PAID',     statusClass: 'badge--green' },
  ];

  // === RENDER TRANSACTION TABLE ===
  function renderTransactions(data) {
    const tbody = document.getElementById('txnBody');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();

    data.forEach(function (t) {
      const avatarBg = AVATAR_COLORS[t.initials] || '#f3f4f6';
      const tr = document.createElement('tr');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'link');
      tr.setAttribute('aria-label', 'View receipt for transaction ' + t.id);

      tr.addEventListener('click', function () {
        window.location.href = 'PharmBillingReceipt.html';
      });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') window.location.href = 'PharmBillingReceipt.html';
      });

      tr.innerHTML =
        '<td><span class="txn-id">' + t.id + '</span></td>' +
        '<td>' +
          '<div class="customer-cell">' +
            '<span class="avatar-chip" style="background:' + avatarBg + '" aria-hidden="true">' + t.initials + '</span>' +
            '<span>' + t.name + '</span>' +
          '</div>' +
        '</td>' +
        '<td>' +
          '<p class="date-primary">' + t.date + '</p>' +
          '<p class="date-secondary">' + t.time + '</p>' +
        '</td>' +
        '<td><strong>' + t.amount + '</strong></td>' +
        '<td>' +
          '<div class="payment-method">' +
            '<i class="fa-solid ' + t.paymentIcon + '" aria-hidden="true"></i>' +
            ' ' + t.payment +
          '</div>' +
        '</td>' +
        '<td><span class="badge ' + t.statusClass + '">' + t.status + '</span></td>';

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  // === SEARCH FUNCTIONALITY ===
  const searchInput = document.getElementById('txnSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const query = this.value.trim().toLowerCase();
      const filtered = TRANSACTIONS.filter(function (t) {
        return t.id.toLowerCase().includes(query) || t.name.toLowerCase().includes(query);
      });
      renderTransactions(filtered);
    });
  }

  // === FILTER TABS ===
  document.querySelectorAll('.ftab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ftab').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-pressed', 'true');
      // Re-render all (filter by date range logic can be added here)
      renderTransactions(TRANSACTIONS);
    });
  });

  // === PAGINATION ===
  document.querySelectorAll('.page-btn').forEach(function (btn) {
    if (btn.querySelector('i')) return; // skip arrow buttons
    btn.addEventListener('click', function () {
      document.querySelectorAll('.page-btn').forEach(function (b) {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
      });
      this.classList.add('active');
      this.setAttribute('aria-current', 'page');
    });
  });

  // === EXPORT BUTTON ===
  const exportBtn = document.querySelector('.export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      // Placeholder — wire up real CSV export here
      alert('Export feature coming soon!');
    });
  }

  // === INIT ===
  renderTransactions(TRANSACTIONS);

}());
