// ==========================================
//  MEDIFINDER PHARMACIST ADVANCED FORECAST SCRIPTS
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

  // === FORECAST CHART ===
  var forecastCanvas = document.getElementById('forecastChart');
  if (forecastCanvas && typeof Chart !== 'undefined') {
    var FONT       = { family: 'Roboto', size: 11 };
    var TICK_COLOR = '#9ca3af';

    var ctx = forecastCanvas.getContext('2d');

    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'APR'],
        datasets: [
          {
            label:       'Incidence',
            data:        [1200, 1400, 1600, 2000, 2600, 3200, 3600],
            borderColor: '#9ca3af',
            borderWidth: 2,
            borderDash:  [5, 4],
            pointRadius: 0,
            tension:     0.45,
            fill:        false,
          },
          {
            label:                'Medication Demand',
            data:                 [1000, 1200, 1500, 2100, 2900, 3800, 4200],
            borderColor:          '#208B3A',
            backgroundColor:      'rgba(32,139,58,0.07)',
            borderWidth:          2.5,
            pointRadius:          function (c) { return c.dataIndex === 4 ? 6 : 0; },
            pointBackgroundColor: '#208B3A',
            pointHoverRadius:     6,
            tension:              0.45,
            fill:                 true,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { mode: 'index', intersect: false },
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: { font: FONT, color: TICK_COLOR },
          },
          y: {
            grid:  { color: '#f3f4f6' },
            ticks: {
              font:     FONT,
              color:    TICK_COLOR,
              callback: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v; },
            },
          },
        },
      },
    });
  }

  // === RECOMMENDATIONS TABLE ===
  var REASON_COLORS = {
    red:   'var(--clr-red)',
    green: 'var(--clr-green)',
    amber: 'var(--clr-amber)',
  };

  var RECS = [
    { name: 'Tamiflu (Oseltamivir) 75mg', category: 'Antiviral Agent',       reason: 'Predicted high risk for Flu incidence', reasonColor: 'red',   conf: 94, qty: '350 Units'   },
    { name: 'Paracetamol 500mg',           category: 'Analgesic/Antipyretic', reason: 'Symptomatic treatment demand spike',    reasonColor: 'green', conf: 92, qty: '1,200 Units' },
    { name: 'Loratadine 10mg',             category: 'Antihistamine',          reason: 'Moderate seasonal allergy trend',       reasonColor: 'amber', conf: 78, qty: '600 Units'   },
  ];

  (function renderRecs() {
    var tbody = document.getElementById('recsBody');
    if (!tbody) return;

    var fragment = document.createDocumentFragment();
    RECS.forEach(function (r) {
      var dotColor = REASON_COLORS[r.reasonColor] || REASON_COLORS.green;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
          '<p class="med-name">'     + r.name     + '</p>' +
          '<p class="med-category">' + r.category + '</p>' +
        '</td>' +
        '<td>' +
          '<div class="rec-reason">' +
            '<i class="fa-solid fa-circle" aria-hidden="true" style="color:' + dotColor + '"></i>' +
            ' ' + r.reason +
          '</div>' +
        '</td>' +
        '<td>' +
          '<div class="conf-bar-wrap">' +
            '<span class="conf-val">' + r.conf + '%</span>' +
            '<div class="conf-bar" role="progressbar" aria-valuenow="' + r.conf + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + r.name + ' confidence ' + r.conf + '%">' +
              '<div class="conf-fill" style="width:' + r.conf + '%"></div>' +
            '</div>' +
          '</div>' +
        '</td>' +
        '<td><span class="sugg-qty">' + r.qty + '</span></td>';
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
  }());

}());
