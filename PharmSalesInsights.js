// ==========================================
//  MEDIFINDER PHARMACIST SALES INSIGHTS SCRIPTS
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

  // === REVENUE CHART ===
  var revenueChartCanvas = document.getElementById('revenueChart');
  if (revenueChartCanvas && typeof Chart !== 'undefined') {
    var FONT       = { family: 'Roboto', size: 11 };
    var TICK_COLOR = '#9ca3af';

    var CHART_DATA = {
      '6m': {
        labels: ['JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data:   [3800, 5200, 4600, 6100, 7400, 8200],
      },
      '1y': {
        labels: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data:   [2200, 2800, 3400, 4200, 4800, 5600, 5900, 6100, 5400, 5800, 7100, 8200],
      },
    };

    var HIGHLIGHT = new Set([4, 7, 9]);

    var ctx   = revenueChartCanvas.getContext('2d');
    var chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   CHART_DATA['1y'].labels,
        datasets: [{
          data:                 CHART_DATA['1y'].data,
          borderColor:          '#208B3A',
          backgroundColor:      'rgba(32,139,58,0.07)',
          borderWidth:          2.5,
          pointRadius:          function (c) { return HIGHLIGHT.has(c.dataIndex) ? 6 : 0; },
          pointBackgroundColor: '#208B3A',
          pointHoverRadius:     6,
          tension:              0.45,
          fill:                 true,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: function (c) { return 'PKR ' + c.parsed.y.toLocaleString(); } } },
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: { font: FONT, color: TICK_COLOR },
          },
          y: {
            grid:  { color: '#f3f4f6' },
            min:   0,
            max:   10000,
            ticks: { font: FONT, color: TICK_COLOR, callback: function (v) { return (v / 1000) + 'k'; } },
          },
        },
      },
    });

    // Period tab switcher
    document.querySelectorAll('.ctab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.ctab').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');

        var period = CHART_DATA[this.dataset.period];
        if (period) {
          chart.data.labels            = period.labels;
          chart.data.datasets[0].data = period.data;
          chart.update();
        }
      });
    });
  }

  // === TOP PRODUCTS TABLE ===
  var PRODUCTS = [
    { name: 'Panadol 500mg',      category: 'Analgesics',     units: '1,420', growth: '+12%', positive: true  },
    { name: 'Amoxicillin 250mg',  category: 'Antibiotics',    units: '890',   growth: '+5%',  positive: true  },
    { name: 'CeraVe Moisturizer', category: 'Skincare',       units: '750',   growth: '−2%',  positive: false },
    { name: 'Softin-72',          category: 'Antihistamines', units: '640',   growth: '+18%', positive: true  },
  ];

  (function renderProducts() {
    var tbody   = document.getElementById('topProductsBody');
    if (!tbody) return;

    var fragment = document.createDocumentFragment();
    PRODUCTS.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><strong>' + p.name + '</strong></td>' +
        '<td class="td-category">' + p.category + '</td>' +
        '<td><strong>' + p.units + '</strong></td>' +
        '<td><span class="' + (p.positive ? 'growth-pos' : 'growth-neg') + '">' + p.growth + '</span></td>';
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
  }());

}());
