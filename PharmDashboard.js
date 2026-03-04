// ==========================================
//  MEDIFINDER PHARMACIST DASHBOARD SCRIPTS
// ==========================================

(function() {
  'use strict';

  // === DOM ELEMENTS ===
  const sidebar = document.getElementById('sidebar');
  const hamBtn = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');
  const salesChartCanvas = document.getElementById('salesChart');

  // === SIDEBAR FUNCTIONALITY ===
  function toggleSidebar() {
    if (sidebar) {
      sidebar.classList.toggle('open');
    }
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('open');
    }
  }

  if (hamBtn) {
    hamBtn.addEventListener('click', toggleSidebar);
  }

  if (sOverlay) {
    sOverlay.addEventListener('click', closeSidebar);
  }

  // Close sidebar on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeSidebar();
    }
  });

  // === SALES CHART ===
  if (salesChartCanvas && typeof Chart !== 'undefined') {
    const chartData = {
      '6m': {
        labels: ['JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data: [3800, 5200, 4600, 6100, 7400, 8200]
      },
      '1y': {
        labels: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data: [2200, 2800, 3400, 4200, 4800, 5600, 5900, 6100, 5400, 5800, 7100, 8200]
      }
    };

    const ctx = salesChartCanvas.getContext('2d');
    const salesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData['1y'].labels,
        datasets: [{
          data: chartData['1y'].data,
          borderColor: '#208B3A',
          backgroundColor: 'rgba(32, 139, 58, 0.07)',
          borderWidth: 2.5,
          pointRadius: function(context) {
            // Highlight specific data points
            return [4, 7, 9].includes(context.dataIndex) ? 6 : 0;
          },
          pointBackgroundColor: '#208B3A',
          pointHoverRadius: 6,
          tension: 0.45,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return 'PKR ' + context.parsed.y.toLocaleString();
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              font: {
                family: 'Roboto',
                size: 11
              },
              color: '#9ca3af'
            }
          },
          y: {
            grid: {
              color: '#f3f4f6'
            },
            min: 0,
            max: 10000,
            ticks: {
              font: {
                family: 'Roboto',
                size: 11
              },
              color: '#9ca3af',
              callback: function(value) {
                return value / 1000 + 'k';
              }
            }
          }
        }
      }
    });

    // Chart tabs functionality
    const chartTabs = document.querySelectorAll('.ctab');
    chartTabs.forEach(function(btn) {
      btn.addEventListener('click', function() {
        // Remove active class from all tabs
        chartTabs.forEach(function(tab) {
          tab.classList.remove('active');
        });
        
        // Add active class to clicked tab
        this.classList.add('active');
        
        // Update chart data
        const period = this.dataset.period;
        const data = chartData[period];
        
        if (data) {
          salesChart.data.labels = data.labels;
          salesChart.data.datasets[0].data = data.data;
          salesChart.update();
        }
      });
    });
  }

})();
