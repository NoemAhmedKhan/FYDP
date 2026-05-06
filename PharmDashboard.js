// ============================================================
//  PharmDashboard.js — MediFinder Pharmacist Dashboard
//  Loads real pharmacist name/role from Supabase profiles.
//  Redirects to Login if not authenticated as pharmacist.
// ============================================================

(function () {
  'use strict';

  // ── Supabase Client ────────────────────────────────────────
  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── DOM Elements ───────────────────────────────────────────
  const sidebar          = document.getElementById('sidebar');
  const hamBtn           = document.getElementById('hamBtn');
  const sOverlay         = document.getElementById('sOverlay');
  const salesChartCanvas = document.getElementById('salesChart');

  // ── Auth Guard + Load User ─────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession();

    // Not logged in → redirect to login
    if (!session) {
      window.location.href = 'Login.html';
      return;
    }

    const userId = session.user.id;

    // Verify this user has role = 'pharmacist'
    const { data: userRow } = await sb
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!userRow || userRow.role !== 'pharmacist') {
      // Not a pharmacist — redirect to correct dashboard or login
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    // Load profile to get real name
    const { data: profile } = await sb
      .from('profiles')
      .select('full_name')
      .eq('user_id', userId)
      .single();

    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';

    // Update sidebar user info
    const nameEl = document.querySelector('.s-uname');
    const roleEl = document.querySelector('.s-urole');
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = 'Pharmacist';

    // Update topbar greeting
    const greetEl = document.querySelector('.topbar-title p');
    if (greetEl) greetEl.textContent = `Welcome back, ${displayName}.`;

    // Wire logout button (the avatar/bottom user area)
    const sUser = document.querySelector('.s-user');
    if (sUser) {
      sUser.style.cursor = 'pointer';
      sUser.title        = 'Click to log out';
      sUser.addEventListener('click', handleLogout);
    }

    // Initialise sidebar + chart
    initSidebar();
    initChart();
  }

  // ── Logout ─────────────────────────────────────────────────
  async function handleLogout() {
    await sb.auth.signOut();
    window.location.href = 'Login.html';
  }

  // ── Sidebar ────────────────────────────────────────────────
  function initSidebar() {
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') sidebar?.classList.remove('open');
    });
  }

  // ── Sales Chart ────────────────────────────────────────────
  function initChart() {
    if (!salesChartCanvas || typeof Chart === 'undefined') return;

    const chartData = {
      '6m': {
        labels: ['JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data:   [3800, 5200, 4600, 6100, 7400, 8200]
      },
      '1y': {
        labels: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
        data:   [2200, 2800, 3400, 4200, 4800, 5600, 5900, 6100, 5400, 5800, 7100, 8200]
      }
    };

    const ctx        = salesChartCanvas.getContext('2d');
    const salesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   chartData['1y'].labels,
        datasets: [{
          data:               chartData['1y'].data,
          borderColor:        '#208B3A',
          backgroundColor:    'rgba(32, 139, 58, 0.07)',
          borderWidth:        2.5,
          pointRadius:        ctx => [4, 7, 9].includes(ctx.dataIndex) ? 6 : 0,
          pointBackgroundColor: '#208B3A',
          pointHoverRadius:   6,
          tension:            0.45,
          fill:               true
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: ctx => 'PKR ' + ctx.parsed.y.toLocaleString() } }
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: { font: { family: 'Roboto', size: 11 }, color: '#9ca3af' }
          },
          y: {
            grid:  { color: '#f3f4f6' },
            min: 0, max: 10000,
            ticks: {
              font:     { family: 'Roboto', size: 11 },
              color:    '#9ca3af',
              callback: v => v / 1000 + 'k'
            }
          }
        }
      }
    });

    document.querySelectorAll('.ctab').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const d = chartData[this.dataset.period];
        if (d) {
          salesChart.data.labels              = d.labels;
          salesChart.data.datasets[0].data   = d.data;
          salesChart.update();
        }
      });
    });
  }

  // ── Pharmacist Heartbeat ────────────────────────────────
// Paste this into PharmacistDashboard.js (or equivalent)
// Keeps this pharmacy visible in user search results.
async function sendHeartbeat() {
    const { error } = await supabaseClient.rpc('pharmacy_heartbeat');
    if (error) console.warn('Heartbeat failed:', error.message);
}

// Ping immediately on dashboard load, then every 60 seconds
sendHeartbeat();
const heartbeatInterval = setInterval(sendHeartbeat, 60_000);

// Stop pinging if pharmacist closes/leaves the tab
window.addEventListener('beforeunload', () => {
    clearInterval(heartbeatInterval);
});
  
  // ── Boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
