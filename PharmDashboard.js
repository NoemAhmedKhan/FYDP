// ============================================================
//  PharmDashboard.js — MediFinder Pharmacist Dashboard  v3.0
// ============================================================

(function () {
  'use strict';

  // ── Supabase Client ───────────────────────────────────────
  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── DOM ───────────────────────────────────────────────────
  const sidebar          = document.getElementById('sidebar');
  const hamBtn           = document.getElementById('hamBtn');
  const sOverlay         = document.getElementById('sOverlay');
  const salesChartCanvas = document.getElementById('salesChart');

  // ── State ─────────────────────────────────────────────────
  let heartbeatInterval = null;
  let pharmacyId        = null;   // resolved once auth succeeds
  let salesChart        = null;   // Chart.js instance (reused across period changes)
  let chartPeriod       = '1y';   // active period tab

  // ── Avatar Helpers ────────────────────────────────────────
  function getInitials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    const f = parts[0]?.[0] || '';
    const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (f + l).toUpperCase() || '?';
  }

  function renderSidebarAvatar(imageUrl, initialsText) {
    const container = document.getElementById('sidebarAvatarInner');
    if (!container) return;
    container.innerHTML = '';
    if (imageUrl) {
      const img   = document.createElement('img');
      img.alt     = 'Avatar';
      img.onerror = () => {
        container.innerHTML = '';
        const span           = document.createElement('span');
        span.className       = 's-avatar-initials-text';
        span.textContent     = initialsText || '?';
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

  // ── Formatters ────────────────────────────────────────────

  /** Format a number as PKR with no decimal places. */
  function fmtPKR(val) {
    const n = parseFloat(val) || 0;
    return 'PKR ' + Math.round(n).toLocaleString('en-PK');
  }

  /** Format a plain integer with commas. */
  function fmtNum(val) {
    return (parseInt(val, 10) || 0).toLocaleString('en-PK');
  }

  // ── Chart Helpers (ported from PharmSalesInsights.js) ─────

  /**
   * Build time buckets for the revenue chart.
   * Returns array of { label, start, end } where start is inclusive, end is exclusive.
   *
   * '1m'  → 4 weekly buckets ending today
   * '3m'  → 3 monthly buckets
   * '6m'  → 6 monthly buckets
   * '1y'  → 12 monthly buckets
   */
  function buildChartBuckets(periodKey) {
    const now     = new Date();
    const buckets = [];

    if (periodKey === '1m') {
      // 4 weekly buckets ending today
      for (let w = 3; w >= 0; w--) {
        const wEnd = new Date(now);
        wEnd.setDate(now.getDate() - w * 7);
        wEnd.setHours(23, 59, 59, 999);

        const wStart = new Date(wEnd);
        wStart.setDate(wEnd.getDate() - 6);
        wStart.setHours(0, 0, 0, 0);

        buckets.push({
          label : 'W' + (4 - w),
          start : wStart,
          end   : new Date(wEnd.getTime() + 1),
        });
      }
    } else {
      // Monthly buckets for 3m / 6m / 1y
      const monthCount = periodKey === '3m' ? 3 : periodKey === '6m' ? 6 : 12;
      for (let m = monthCount - 1; m >= 0; m--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const label = start.toLocaleString('en', { month: 'short' }).toUpperCase();
        buckets.push({ label, start, end });
      }
    }

    return buckets;
  }

  /**
   * Compute a clean Y-axis ceiling for a given data max.
   * Ported from PharmSalesInsights.js.
   */
  function computeYMax(maxVal) {
    if (maxVal === 0) return 10000;
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const nice      = Math.ceil(maxVal / magnitude) * magnitude;
    return Math.ceil((nice * 1.2) / magnitude) * magnitude;
  }

  // ── Auth Guard + Boot ─────────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = 'Login.html';
      return;
    }

    const userId = session.user.id;

    // Role check
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

    // Resolve pharmacy_id for this pharmacist
    const { data: pharmRow } = await sb
      .from('pharmacies')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!pharmRow) {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    pharmacyId = pharmRow.id;

    // Profile
    const { data: profile } = await sb
      .from('profiles')
      .select('full_name, profile_img')
      .eq('user_id', userId)
      .single();

    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    const email       = session.user.email || '';

    // Sidebar user info
    const nameEl  = document.getElementById('sidebarName');
    const emailEl = document.getElementById('sidebarEmail');
    if (nameEl)  nameEl.textContent  = displayName;
    if (emailEl) emailEl.textContent = email;
    renderSidebarAvatar(profile?.profile_img || null, getInitials(displayName));

    // Topbar welcome — targets .topbar-welcome (updated in HTML)
    const greetEl = document.querySelector('.topbar-welcome');
    if (greetEl) greetEl.textContent = `Welcome back, ${displayName}.`;

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    initSidebar();
    initChartTabs();
    startHeartbeat();

    // Load all dashboard data in parallel
    await Promise.all([
      loadInventoryStats(),
      loadTotalSales(),
      loadChart(chartPeriod),
      loadDemandPreview(),
    ]);
  }

  // ── Logout ────────────────────────────────────────────────
  async function handleLogout() {
    stopHeartbeat();
    await sb.auth.signOut();
    window.location.href = 'Login.html';
  }

  // ── Heartbeat ─────────────────────────────────────────────
  async function sendHeartbeat() {
    const { error } = await sb.rpc('pharmacy_heartbeat');
    if (error) console.warn('Heartbeat failed:', error.message);
  }

  function startHeartbeat() {
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, 60_000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  window.addEventListener('beforeunload', stopHeartbeat);

  // ── Sidebar ───────────────────────────────────────────────
  function initSidebar() {
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') sidebar?.classList.remove('open');
    });
  }

  // ── TASK 2 + 3 + 4: Inventory Stat Cards ─────────────────
  /**
   * Calls the existing get_inventory_stats RPC.
   *
   * The RPC returns a JSON object with these fields (verified against schema):
   *   total_items    — COUNT(*) of all inventory rows for this pharmacy
   *   low_stock      — WHERE box_quantity > 0 AND box_quantity <= reorder_level
   *   expiring_30    — WHERE expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30
   *
   * Note: low_stock definition here (box_quantity > 0) is intentional — items
   * with box_quantity = 0 are counted separately as out_of_stock in the RPC.
   * This matches the PharmStockAlerts.js filter:
   *   box_quantity <= reorder_level (client-side, with expiry_date > today guard)
   * The only difference is the RPC does NOT filter out expired items from low_stock.
   * This is acceptable for the dashboard summary count; StockAlerts applies the
   * stricter expiry guard for its paginated list display.
   */
  async function loadInventoryStats() {
    const el1 = document.getElementById('statTotalProducts');
    const el2 = document.getElementById('statLowStock');
    const el3 = document.getElementById('statExpiringSoon');

    const { data, error } = await sb.rpc('get_inventory_stats', {
      p_pharmacy_id: pharmacyId,
    });

    if (error || !data) {
      console.error('get_inventory_stats error:', error?.message);
      if (el1) el1.textContent = '—';
      if (el2) el2.textContent = '—';
      if (el3) el3.textContent = '—';
      return;
    }

    // TASK 2: Total Products
    if (el1) el1.textContent = fmtNum(data.total_items);

    // TASK 3: Low Stock Alerts
    if (el2) el2.textContent = fmtNum(data.low_stock);

    // TASK 4: Expiring Soon (within 30 days)
    if (el3) el3.textContent = fmtNum(data.expiring_30);
  }

  // ── TASK 5: Total Sales ───────────────────────────────────
  /**
   * Sums grand_total from bill_headers scoped to this pharmacy.
   * No date filter — this is ALL-TIME total sales, not today's.
   * RLS on bill_headers also enforces pharmacy_id scoping server-side.
   */
  async function loadTotalSales() {
    const el = document.getElementById('statTotalSales');

    const { data, error } = await sb
      .from('bill_headers')
      .select('grand_total')
      .eq('pharmacy_id', pharmacyId);

    if (error) {
      console.error('Total sales error:', error.message);
      if (el) el.textContent = '—';
      return;
    }

    const total = (data || []).reduce(
      (sum, row) => sum + parseFloat(row.grand_total || 0),
      0
    );

    if (el) el.textContent = fmtPKR(total);
  }

  // ── TASK 6: Sales History Chart ───────────────────────────

  /** Wire period tab buttons — clicking fetches fresh data and re-renders. */
  function initChartTabs() {
    document.querySelectorAll('.ctab').forEach(btn => {
      btn.addEventListener('click', async function () {
        if (this.dataset.period === chartPeriod) return;

        document.querySelectorAll('.ctab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        chartPeriod = this.dataset.period;

        if (pharmacyId) await loadChart(chartPeriod);
      });
    });
  }

  /**
   * Fetches real billing data for the given period, buckets it, and
   * renders or updates the Chart.js line chart.
   *
   * Identical bucketing and rendering logic to PharmSalesInsights.js.
   * The chart instance is reused (not destroyed) on period change to
   * avoid flicker — only data and y-max are updated.
   */
  async function loadChart(periodKey) {
    const loadingEl = document.getElementById('chartLoading');
    const canvas    = salesChartCanvas;

    // Show loading, hide canvas
    if (loadingEl) loadingEl.style.display = 'flex';
    if (canvas)    canvas.style.display    = 'none';

    const buckets = buildChartBuckets(periodKey);
    if (!buckets.length) return;

    const windowStart = buckets[0].start.toISOString();
    const windowEnd   = buckets[buckets.length - 1].end.toISOString();

    const { data: bills, error } = await sb
      .from('bill_headers')
      .select('billed_at, grand_total')
      .eq('pharmacy_id', pharmacyId)
      .gte('billed_at', windowStart)
      .lt('billed_at', windowEnd);

    if (error) {
      console.error('Chart data error:', error.message);
      if (loadingEl) {
        loadingEl.innerHTML = '<span>Could not load chart data.</span>';
        loadingEl.style.display = 'flex';
      }
      return;
    }

    // Distribute each bill's grand_total into its bucket
    const sums = new Array(buckets.length).fill(0);
    (bills || []).forEach(bill => {
      const ts = new Date(bill.billed_at).getTime();
      for (let i = 0; i < buckets.length; i++) {
        if (ts >= buckets[i].start.getTime() && ts < buckets[i].end.getTime()) {
          sums[i] += parseFloat(bill.grand_total || 0);
          break;
        }
      }
    });

    const labels = buckets.map(b => b.label);
    const data   = sums.map(v => Math.round(v));
    const yMax   = computeYMax(Math.max(...data, 0));

    const FONT       = { family: 'Roboto', size: 11 };
    const TICK_COLOR = '#9ca3af';

    // Hide loading, show canvas
    if (loadingEl) loadingEl.style.display = 'none';
    if (canvas)    canvas.style.display    = 'block';

    if (salesChart) {
      // Reuse existing Chart.js instance — avoids flicker on tab switch
      salesChart.data.labels           = labels;
      salesChart.data.datasets[0].data = data;
      salesChart.options.scales.y.max  = yMax;
      salesChart.update();
    } else {
      // First render
      const ctx = canvas.getContext('2d');
      salesChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data,
            borderColor:          '#208B3A',
            backgroundColor:      'rgba(32, 139, 58, 0.07)',
            borderWidth:          2.5,
            pointRadius:          4,
            pointBackgroundColor: '#208B3A',
            pointHoverRadius:     6,
            tension:              0.4,
            fill:                 true,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          plugins: {
            legend:  { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ' ' + fmtPKR(ctx.parsed.y),
              },
            },
          },
          scales: {
            x: {
              grid:  { display: false },
              ticks: { font: FONT, color: TICK_COLOR },
            },
            y: {
              grid: { color: '#f3f4f6' },
              min:  0,
              max:  yMax,
              ticks: {
                font:     FONT,
                color:    TICK_COLOR,
                callback: v => {
                  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
                  if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'k';
                  return v;
                },
              },
            },
          },
        },
      });
    }
  }

  // ── Top Searched Medicines (unchanged — already working) ──
  async function loadDemandPreview() {
    const listEl = document.getElementById('demandTopList');
    if (!listEl) return;

    const { data, error } = await sb.rpc('get_top_searched_medicines', {
      p_limit: 5,
      p_days:  7,
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
      const rank  = row.rank  != null ? row.rank  : i + 1;
      const name  = row.product_name || 'Unknown';
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
