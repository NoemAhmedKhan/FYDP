// ============================================================
//  PharmDashboard.js — MediFinder Pharmacist Dashboard  v2.0
//  ─────────────────────────────────────────────────────────
//  CHANGES IN v2.0:
//  · Fixed heartbeat: was calling supabaseClient (undefined here)
//    now correctly uses sb (the local Supabase client instance)
//  · Heartbeat fires on init() completion (after auth verified),
//    not at module load time — prevents firing before auth check
//  · clearInterval on beforeunload preserved
//  Everything else unchanged from v1.0.
// ============================================================

(function () {
  'use strict';

  // ── Supabase Client ───────────────────────────────────────
  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── DOM Elements ──────────────────────────────────────────
  const sidebar          = document.getElementById('sidebar');
  const hamBtn           = document.getElementById('hamBtn');
  const sOverlay         = document.getElementById('sOverlay');
  const salesChartCanvas = document.getElementById('salesChart');

  let heartbeatInterval = null;

/* ─────────────────────────────────────────
   5. AVATAR RENDERING  (mirrors UserProfile)
   ───────────────────────────────────────── */
function renderAvatar(containerId, imageUrl, initialsText) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (imageUrl) {
    const img     = document.createElement('img');
    img.alt       = 'Profile Photo';
    img.className = 'avatar-photo';

    img.onerror = () => {
      container.innerHTML = '';
      const span       = document.createElement('span');
      span.className   = 'avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    };

    img.src = imageUrl;
    container.appendChild(img);
  } else {
    const span       = document.createElement('span');
    span.className   = 'avatar-initials-text';
    span.textContent = initialsText || '?';
    container.appendChild(span);
  }
}

/* Render into sidebar circle — uses its own class names */
function renderSidebarAvatar(imageUrl, initialsText) {
  const container = $('sidebarAvatarInner');
  if (!container) return;
  container.innerHTML = '';

  if (imageUrl) {
    const img     = document.createElement('img');
    img.alt       = 'Avatar';

    img.onerror = () => {
      container.innerHTML = '';
      const span       = document.createElement('span');
      span.className   = 's-avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    };

    img.src = imageUrl;
    container.appendChild(img);
  } else {
    const span       = document.createElement('span');
    span.className   = 's-avatar-initials-text';
    span.textContent = initialsText || '?';
    container.appendChild(span);
  }
}
  
  // ── Auth Guard + Load User ────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
      window.location.href = 'Login.html';
      return;
    }

    const userId = session.user.id;

    const { data: userRow } = await sb
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    const { data: profile } = await sb
      .from('profiles')
      .select('full_name')
      .eq('user_id', userId)
      .single();

const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
const email       = session.user.email || '';

// Sidebar user footer — matches PharmInfoUpdate pattern
const nameEl  = document.getElementById('sidebarName');
const emailEl = document.getElementById('sidebarEmail');
if (nameEl)  nameEl.textContent  = displayName;
if (emailEl) emailEl.textContent = email;

// Sidebar avatar — render initials (no profile_img fetch needed on dashboard)
renderSidebarAvatar(null, getInitials(displayName));

// Topbar welcome
const greetEl = document.querySelector('.topbar-title p');
if (greetEl) greetEl.textContent = `Welcome back, ${displayName}.`;

// Logout button — wire to #logoutBtn, not .s-user click
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    initSidebar();
    initChart();
    loadDemandPreview();

    // ── Start heartbeat AFTER auth is confirmed ─────────────
    // FIX: uses `sb` (local var), not `supabaseClient` (undefined here)
    startHeartbeat();
  }

  // ── Logout ────────────────────────────────────────────────
  async function handleLogout() {
    stopHeartbeat();
    await sb.auth.signOut();
    window.location.href = 'Login.html';
  }

  // ── Pharmacist Heartbeat ──────────────────────────────────
  // Keeps this pharmacy's last_seen timestamp fresh so
  // search_medicine RPC includes it in user results.
  // Fires immediately on auth, then every 60 seconds.
  // Stops when tab is closed or pharmacist logs out.
  async function sendHeartbeat() {
    const { error } = await sb.rpc('pharmacy_heartbeat');
    if (error) console.warn('Heartbeat failed:', error.message);
  }

  function startHeartbeat() {
    sendHeartbeat();                                    // fire immediately
    heartbeatInterval = setInterval(sendHeartbeat, 60_000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // Stop when tab closes / refreshes
  window.addEventListener('beforeunload', stopHeartbeat);

  // ── Sidebar ───────────────────────────────────────────────
  function initSidebar() {
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') sidebar?.classList.remove('open');
    });
  }

  // ── Sales Chart ───────────────────────────────────────────
  function initChart() {
    if (!salesChartCanvas || typeof Chart === 'undefined') return;

    const chartData = {
      '6m': {
        labels: ['JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
        data:   [3800, 5200, 4600, 6100, 7400, 8200],
      },
      '1y': {
        labels: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
        data:   [2200, 2800, 3400, 4200, 4800, 5600, 5900, 6100, 5400, 5800, 7100, 8200],
      },
    };

    const ctx        = salesChartCanvas.getContext('2d');
    const salesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   chartData['1y'].labels,
        datasets: [{
          data:                chartData['1y'].data,
          borderColor:         '#208B3A',
          backgroundColor:     'rgba(32, 139, 58, 0.07)',
          borderWidth:         2.5,
          pointRadius:         ctx => [4, 7, 9].includes(ctx.dataIndex) ? 6 : 0,
          pointBackgroundColor:'#208B3A',
          pointHoverRadius:    6,
          tension:             0.45,
          fill:                true,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend:  { display: false },
          tooltip: { callbacks: { label: ctx => 'PKR ' + ctx.parsed.y.toLocaleString() } },
        },
        scales: {
          x: {
            grid:  { display: false },
            ticks: { font: { family: 'Roboto', size: 11 }, color: '#9ca3af' },
          },
          y: {
            grid:  { color: '#f3f4f6' },
            min: 0, max: 10000,
            ticks: {
              font:     { family: 'Roboto', size: 11 },
              color:    '#9ca3af',
              callback: v => v / 1000 + 'k',
            },
          },
        },
      },
    });

    document.querySelectorAll('.ctab').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        const d = chartData[this.dataset.period];
        if (d) {
          salesChart.data.labels            = d.labels;
          salesChart.data.datasets[0].data  = d.data;
          salesChart.update();
        }
      });
    });
  }

  // ── Top searched medicines preview ────────────────────────
  async function loadDemandPreview() {
    const listEl = document.getElementById('demandTopList');
    if (!listEl) return;

    const { data, error } = await sb.rpc('get_top_searched_medicines', {
      p_limit: 5,
      p_days:  30,
    });

    if (error) {
      const hint = /function|not found|schema cache/i.test(error.message)
        ? 'Deploy the demand forecast SQL migration in Supabase.'
        : 'Could not load search trends.';
      listEl.innerHTML = '<li class="demand-top-empty">' + hint + '</li>';
      return;
    }

    if (!data || !data.length) {
      listEl.innerHTML = '<li class="demand-top-empty">No patient searches recorded yet.</li>';
      return;
    }

    listEl.innerHTML = data.map((row, i) => {
      const rank = row.rank != null ? row.rank : i + 1;
      const name = row.product_name || 'Unknown';
      const count = Number(row.search_count || 0).toLocaleString();
      return (
        '<li class="demand-top-item">' +
          '<span class="demand-top-rank">#' + rank + '</span>' +
          '<span class="demand-top-name" title="' + name.replace(/"/g, '&quot;') + '">' + name + '</span>' +
          '<span class="demand-top-count">' + count + '</span>' +
        '</li>'
      );
    }).join('');
  }

  // ── Boot ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
