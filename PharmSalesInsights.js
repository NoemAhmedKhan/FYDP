// ==========================================
//  MEDIFINDER – SALES INSIGHTS
//  All data sourced from Supabase live queries
// ==========================================

(function () {
  'use strict';

  // ── SUPABASE CLIENT ──────────────────────────────────────────
  const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── SIDEBAR ──────────────────────────────────────────────────
  const sidebar  = document.getElementById('sidebar');
  const hamBtn   = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');

  function toggleSidebar() {
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (hamBtn) hamBtn.setAttribute('aria-expanded', String(isOpen));
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (hamBtn) hamBtn.setAttribute('aria-expanded', 'false');
  }

  if (hamBtn)   hamBtn.addEventListener('click', toggleSidebar);
  if (sOverlay) sOverlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSidebar(); });

  // ── HELPERS ──────────────────────────────────────────────────

  /**
   * Format a number as PKR with no decimal places.
   * e.g.  142482 → "PKR 142,482"
   */
  function fmtPKR(val) {
    const n = parseFloat(val) || 0;
    return 'PKR ' + Math.round(n).toLocaleString('en-PK');
  }

  /**
   * Format a plain number with commas.
   */
  function fmtNum(val) {
    return (parseInt(val, 10) || 0).toLocaleString('en-PK');
  }

  /**
   * Calculate month-over-month growth %.
   * Returns null if previous is 0 (can't divide).
   */
  function growthPct(current, previous) {
    if (!previous || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Render a trend badge element's innerHTML.
   * pct: number or null
   * el: the DOM element to update
   */
  function renderTrend(el, pct, suffix) {
    suffix = suffix || 'vs last month';
    if (pct === null) {
      el.innerHTML = '<i class="fa-solid fa-minus"></i> No prior data';
      el.className = 'stat-trend stat-trend--neutral';
      return;
    }
    const abs = Math.abs(pct).toFixed(1);
    if (pct > 0) {
      el.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i> ' + abs + '% ' + suffix;
      el.className = 'stat-trend';
    } else if (pct < 0) {
      el.innerHTML = '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i> ' + abs + '% ' + suffix;
      el.className = 'stat-trend stat-trend--down';
    } else {
      el.innerHTML = '<i class="fa-solid fa-minus"></i> 0% ' + suffix;
      el.className = 'stat-trend stat-trend--neutral';
    }
  }

  /**
   * Returns UTC ISO start/end timestamps for current and previous calendar month.
   * Using ISO strings so Supabase's timestamptz comparison works correctly.
   */
  function getMonthBounds() {
    const now   = new Date();
    // Current month: 1st 00:00 local → end of month
    const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const curEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1); // exclusive

    // Previous month
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd   = curStart; // exclusive

    return {
      curStart:  curStart.toISOString(),
      curEnd:    curEnd.toISOString(),
      prevStart: prevStart.toISOString(),
      prevEnd:   prevEnd.toISOString(),
    };
  }

  /**
   * Generate chart bucket labels and DB date windows for a given period key.
   * Returns { buckets: [{label, start, end}], groupFn }
   *   groupFn(isoDate) → bucket index (for grouping bill rows into buckets)
   */
  function buildChartBuckets(periodKey) {
    const now  = new Date();
    const buckets = [];

    if (periodKey === '1m') {
      // Last 4 weeks (Mon→Sun ISO weeks) ending today
      for (let w = 3; w >= 0; w--) {
        const wEnd   = new Date(now);
        wEnd.setDate(now.getDate() - w * 7);
        wEnd.setHours(23, 59, 59, 999);

        const wStart = new Date(wEnd);
        wStart.setDate(wEnd.getDate() - 6);
        wStart.setHours(0, 0, 0, 0);

        const label = 'W' + (4 - w);
        buckets.push({ label, start: wStart, end: new Date(wEnd.getTime() + 1) });
      }
    } else if (periodKey === '3m') {
      // Last 3 calendar months (oldest → newest)
      for (let m = 2; m >= 0; m--) {
        const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const label = start.toLocaleString('en', { month: 'short' }).toUpperCase();
        buckets.push({ label, start, end });
      }
    } else if (periodKey === '6m') {
      for (let m = 5; m >= 0; m--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const label = start.toLocaleString('en', { month: 'short' }).toUpperCase();
        buckets.push({ label, start, end });
      }
    } else {
      // 1y — last 12 calendar months
      for (let m = 11; m >= 0; m--) {
        const d     = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const label = start.toLocaleString('en', { month: 'short' }).toUpperCase();
        buckets.push({ label, start, end });
      }
    }

    return buckets;
  }

  // ── STATE ────────────────────────────────────────────────────
  var pharmacyId   = null;   // resolved once after auth check
  var revenueChart = null;   // Chart.js instance
  var chartPeriod  = '1y';   // currently active tab

  // ── INIT ─────────────────────────────────────────────────────
  async function init() {
    // 1. Auth check
    const { data: { session }, error: sessErr } = await sb.auth.getSession();
    if (sessErr || !session) {
      window.location.href = 'Login.html';
      return;
    }

    const userId = session.user.id;

    // 2. Role check
    const { data: userRow } = await sb
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (!userRow || userRow.role !== 'pharmacist') {
      window.location.href = 'Login.html';
      return;
    }

    // 3. Resolve pharmacy_id
    const { data: pharmRow } = await sb
      .from('pharmacies')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!pharmRow) {
      window.location.href = 'Login.html';
      return;
    }

    pharmacyId = pharmRow.id;

    // 4. Load profile (sidebar + welcome msg)
    loadProfile(userId, session.user.email);

    // 5. Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        await sb.auth.signOut();
        window.location.href = 'Login.html';
      });
    }

    // 6. Load all dashboard data
    await Promise.all([
      loadKPIs(),
      loadChart(chartPeriod),
      loadTopProducts(),
    ]);
  }

  // ── PROFILE ──────────────────────────────────────────────────
  async function loadProfile(userId, email) {
    const { data: profile } = await sb
      .from('profiles')
      .select('full_name, profile_img')
      .eq('user_id', userId)
      .single();

    const name = (profile && profile.full_name) ? profile.full_name : (email || 'Pharmacist');

    // Welcome message
    const welcomeEl = document.getElementById('welcomeMsg');
    if (welcomeEl) welcomeEl.textContent = 'Welcome back, ' + name + '.';

    // Sidebar name
    const nameEl = document.getElementById('sidebarName');
    if (nameEl) nameEl.textContent = name;

    // Sidebar email
    const emailEl = document.getElementById('sidebarEmail');
    if (emailEl) emailEl.textContent = email || '';

    // Sidebar avatar
    const avatarInner = document.getElementById('sidebarAvatarInner');
    if (avatarInner) {
      if (profile && profile.profile_img) {
        avatarInner.innerHTML =
          '<img src="' + profile.profile_img + '" alt="' + name + '" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<span class="s-avatar-initials-text" style="display:none">' + initials(name) + '</span>';
      } else {
        avatarInner.innerHTML =
          '<span class="s-avatar-initials-text">' + initials(name) + '</span>';
      }
    }
  }

  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  // ── KPI CARDS ────────────────────────────────────────────────
  async function loadKPIs() {
    const bounds = getMonthBounds();

    // Fetch current-month and previous-month aggregates from bill_headers
    // Both queries are scoped by pharmacy_id (RLS also enforces this, but explicit is cleaner)
    const [curRes, prevRes, paymentRes, itemsRes] = await Promise.all([
      // Current month aggregate
      sb.from('bill_headers')
        .select('grand_total, total_discount')
        .eq('pharmacy_id', pharmacyId)
        .gte('billed_at', bounds.curStart)
        .lt('billed_at', bounds.curEnd),

      // Previous month aggregate
      sb.from('bill_headers')
        .select('grand_total, total_discount')
        .eq('pharmacy_id', pharmacyId)
        .gte('billed_at', bounds.prevStart)
        .lt('billed_at', bounds.prevEnd),

      // All-time payment method distribution
      sb.rpc('get_billing_stats', { p_pharmacy_id: pharmacyId }),

      // Current month units sold — need bill_ids first, then sum quantities
      sb.from('bill_headers')
        .select('id')
        .eq('pharmacy_id', pharmacyId)
        .gte('billed_at', bounds.curStart)
        .lt('billed_at', bounds.curEnd),
    ]);

    // ── Current month calculations
    const curRows   = curRes.data   || [];
    const prevRows  = prevRes.data  || [];

    const curRevenue   = curRows.reduce(function (s, r) { return s + parseFloat(r.grand_total   || 0); }, 0);
    const curDiscount  = curRows.reduce(function (s, r) { return s + parseFloat(r.total_discount || 0); }, 0);
    const curOrders    = curRows.length;
    const curAvgOrder  = curOrders > 0 ? curRevenue / curOrders : 0;

    const prevRevenue  = prevRows.reduce(function (s, r) { return s + parseFloat(r.grand_total   || 0); }, 0);
    const prevDiscount = prevRows.reduce(function (s, r) { return s + parseFloat(r.total_discount || 0); }, 0);
    const prevOrders   = prevRows.length;
    const prevAvgOrder = prevOrders > 0 ? prevRevenue / prevOrders : 0;

    // ── Units sold this month
    var curUnitsSold = 0;
    var prevUnitsSold = 0;
    const curBillIds = (itemsRes.data || []).map(function (r) { return r.id; });

    if (curBillIds.length > 0) {
      const { data: itemRows } = await sb
        .from('bill_items')
        .select('quantity')
        .in('bill_id', curBillIds);
      curUnitsSold = (itemRows || []).reduce(function (s, r) { return s + (r.quantity || 0); }, 0);
    }

    // Previous month units sold
    const prevBillIds = (prevRes.data || []);  // we already fetched headers but need IDs
    const { data: prevHeaders } = await sb
      .from('bill_headers')
      .select('id')
      .eq('pharmacy_id', pharmacyId)
      .gte('billed_at', bounds.prevStart)
      .lt('billed_at', bounds.prevEnd);

    const prevIds = (prevHeaders || []).map(function (r) { return r.id; });
    if (prevIds.length > 0) {
      const { data: prevItemRows } = await sb
        .from('bill_items')
        .select('quantity')
        .in('bill_id', prevIds);
      prevUnitsSold = (prevItemRows || []).reduce(function (s, r) { return s + (r.quantity || 0); }, 0);
    }

    // ── Render KPI 1: Gross Revenue
    document.getElementById('kpiGrossRevenue').textContent = fmtPKR(curRevenue);
    renderTrend(document.getElementById('kpiRevenueTrend'), growthPct(curRevenue, prevRevenue));

    // ── Render KPI 2: Total Orders
    document.getElementById('kpiTotalOrders').textContent = fmtNum(curOrders);
    renderTrend(document.getElementById('kpiOrdersTrend'), growthPct(curOrders, prevOrders));

    // ── Render KPI 3: Avg Order Value
    document.getElementById('kpiAvgOrder').textContent = fmtPKR(curAvgOrder);
    renderTrend(document.getElementById('kpiAvgOrderTrend'), growthPct(curAvgOrder, prevAvgOrder));

    // ── Render KPI 4: Total Discounts
    document.getElementById('kpiDiscounts').textContent = fmtPKR(curDiscount);
    renderTrend(document.getElementById('kpiDiscountsTrend'), growthPct(curDiscount, prevDiscount));

    // ── Render KPI 5: Units Sold
    document.getElementById('kpiUnitsSold').textContent = fmtNum(curUnitsSold);
    renderTrend(document.getElementById('kpiUnitsTrend'), growthPct(curUnitsSold, prevUnitsSold));

    // ── Render KPI 6: Top Payment Method
    const stats = paymentRes.data;
    const topPayEl    = document.getElementById('kpiTopPayment');
    const topPaySub   = document.getElementById('kpiTopPaymentSub');
    if (stats && stats.top_payment_method) {
      const methodLabel = {
        cash:       'Cash',
        jazzcash:   'JazzCash',
        easypaisa:  'Easypaisa',
        card:       'Card',
      };
      topPayEl.textContent  = methodLabel[stats.top_payment_method] || stats.top_payment_method;
      topPaySub.textContent = (stats.top_payment_method_pct || 0) + '% of transactions';
    } else {
      topPayEl.textContent  = '—';
      topPaySub.textContent = 'No transactions yet';
    }

    // ── Render KPI 7: Revenue Growth (same as KPI 1 trend, but shown as its own card)
    const growthEl    = document.getElementById('kpiRevenueGrowth');
    const growthSub   = document.getElementById('kpiRevenueGrowthSub');
    const gPct        = growthPct(curRevenue, prevRevenue);
    if (gPct === null) {
      growthEl.textContent  = '—';
      growthEl.className    = 'stat-val stat-val--large';
      growthSub.textContent = 'No previous month data';
    } else {
      const sign = gPct >= 0 ? '+' : '';
      growthEl.textContent = sign + gPct.toFixed(1) + '%';
      if (gPct > 0) {
        growthEl.className = 'stat-val stat-val--large stat-val--green';
      } else if (gPct < 0) {
        growthEl.className = 'stat-val stat-val--large stat-val--red';
      } else {
        growthEl.className = 'stat-val stat-val--large';
      }
      growthSub.textContent = fmtPKR(prevRevenue) + ' last month';
    }
  }

  // ── REVENUE CHART ────────────────────────────────────────────
  async function loadChart(periodKey) {
    const loadingEl = document.getElementById('chartLoading');
    const canvas    = document.getElementById('revenueChart');

    if (loadingEl) { loadingEl.style.display = 'flex'; }
    if (canvas)    { canvas.style.display    = 'none'; }

    const buckets = buildChartBuckets(periodKey);
    if (!buckets.length) return;

    // Fetch all bill_headers in the overall window for this pharmacy
    const windowStart = buckets[0].start.toISOString();
    const windowEnd   = buckets[buckets.length - 1].end.toISOString();

    const { data: bills } = await sb
      .from('bill_headers')
      .select('billed_at, grand_total')
      .eq('pharmacy_id', pharmacyId)
      .gte('billed_at', windowStart)
      .lt('billed_at', windowEnd);

    // Assign each bill to a bucket and sum grand_total
    const sums = new Array(buckets.length).fill(0);

    (bills || []).forEach(function (bill) {
      const billedTs = new Date(bill.billed_at).getTime();
      for (var i = 0; i < buckets.length; i++) {
        if (billedTs >= buckets[i].start.getTime() && billedTs < buckets[i].end.getTime()) {
          sums[i] += parseFloat(bill.grand_total || 0);
          break;
        }
      }
    });

    const labels = buckets.map(function (b) { return b.label; });
    const data   = sums.map(function (v) { return Math.round(v); });

    // Determine chart Y-axis max (rounded up to nearest nice number)
    const maxVal  = Math.max.apply(null, data.concat([0]));
    const yMax    = computeYMax(maxVal);

    const FONT       = { family: 'Roboto', size: 11 };
    const TICK_COLOR = '#9ca3af';

    if (loadingEl) loadingEl.style.display = 'none';
    if (canvas)    canvas.style.display    = 'block';

    if (revenueChart) {
      // Update existing chart
      revenueChart.data.labels            = labels;
      revenueChart.data.datasets[0].data  = data;
      revenueChart.options.scales.y.max   = yMax;
      revenueChart.update();
    } else {
      // Create chart
      var ctx = canvas.getContext('2d');
      revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data:                 data,
            borderColor:          '#208B3A',
            backgroundColor:      'rgba(32,139,58,0.07)',
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
                label: function (c) {
                  return ' ' + fmtPKR(c.parsed.y);
                },
              },
            },
          },
          scales: {
            x: {
              grid:  { display: false },
              ticks: { font: FONT, color: TICK_COLOR },
            },
            y: {
              grid:  { color: '#f3f4f6' },
              min:   0,
              max:   yMax,
              ticks: {
                font: FONT,
                color: TICK_COLOR,
                callback: function (v) {
                  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
                  if (v >= 1000)    return (v / 1000).toFixed(0) + 'k';
                  return v;
                },
              },
            },
          },
        },
      });
    }
  }

  /**
   * Compute a clean Y-axis ceiling for a given data max.
   * Always rounds up to a value that produces nice tick intervals.
   */
  function computeYMax(maxVal) {
    if (maxVal === 0) return 10000;
    // Find magnitude
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    const nice      = Math.ceil(maxVal / magnitude) * magnitude;
    // Add ~20% headroom and round up again
    return Math.ceil((nice * 1.2) / magnitude) * magnitude;
  }

  // ── CHART TAB SWITCHER ───────────────────────────────────────
  document.querySelectorAll('.ctab').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (this.dataset.period === chartPeriod) return;
      document.querySelectorAll('.ctab').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      this.classList.add('active');
      this.setAttribute('aria-pressed', 'true');
      chartPeriod = this.dataset.period;
      if (pharmacyId) await loadChart(chartPeriod);
    });
  });

  // ── TOP PRODUCTS TABLE ───────────────────────────────────────
  async function loadTopProducts() {
    const tbody = document.getElementById('topProductsBody');
    if (!tbody) return;

    // Step 1: Get all bill_ids for this pharmacy (all time)
    const { data: headers } = await sb
      .from('bill_headers')
      .select('id')
      .eq('pharmacy_id', pharmacyId);

    if (!headers || headers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">No sales data yet.</td></tr>';
      return;
    }

    const billIds = headers.map(function (h) { return h.id; });

    // Step 2: Fetch all bill_items for those bills, including inventory_id for joining to products
    // We fetch in a single query — Supabase handles the IN filter
    const { data: items } = await sb
      .from('bill_items')
      .select('product_name, strength, dosage_form, quantity, line_subtotal, inventory_id')
      .in('bill_id', billIds);

    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">No sales data yet.</td></tr>';
      return;
    }

    // Step 3: Aggregate by (product_name, strength, dosage_form) composite key
    // This is snapshot-safe: uses what was actually billed, not the live products table
    var aggregates = {};
    var totalRevenue = 0;

    items.forEach(function (item) {
      var key = (item.product_name || '') + '||' + (item.strength || '') + '||' + (item.dosage_form || '');
      if (!aggregates[key]) {
        aggregates[key] = {
          product_name: item.product_name,
          strength:     item.strength,
          dosage_form:  item.dosage_form,
          inventory_id: item.inventory_id,   // we'll try to resolve category from this
          units_sold:   0,
          revenue:      0,
        };
      }
      aggregates[key].units_sold += (item.quantity      || 0);
      aggregates[key].revenue    += parseFloat(item.line_subtotal || 0);
      totalRevenue                += parseFloat(item.line_subtotal || 0);
    });

    // Step 4: Sort by units_sold DESC, take top 10
    var sorted = Object.values(aggregates).sort(function (a, b) {
      return b.units_sold - a.units_sold;
    }).slice(0, 10);

    // Step 5: Resolve categories via inventory_id → products.category
    // Collect unique inventory_ids from top 10
    var invIds = sorted
      .map(function (r) { return r.inventory_id; })
      .filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });

    var categoryMap = {};   // inventory_id → category

    if (invIds.length > 0) {
      const { data: invRows } = await sb
        .from('inventory')
        .select('id, product_id')
        .in('id', invIds);

      var productIds = (invRows || [])
        .map(function (r) { return r.product_id; })
        .filter(function (id, i, arr) { return id && arr.indexOf(id) === i; });

      if (productIds.length > 0) {
        const { data: prodRows } = await sb
          .from('products')
          .select('id, category')
          .in('id', productIds);

        // Build product_id → category map
        var prodCatMap = {};
        (prodRows || []).forEach(function (p) {
          prodCatMap[p.id] = p.category || '—';
        });

        // Build inventory_id → category map
        (invRows || []).forEach(function (inv) {
          categoryMap[inv.id] = prodCatMap[inv.product_id] || '—';
        });
      }
    }

    // Step 6: Render table rows
    var fragment = document.createDocumentFragment();
    sorted.forEach(function (product, idx) {
      var rank        = idx + 1;
      var category    = categoryMap[product.inventory_id] || '—';
      var contribPct  = totalRevenue > 0
        ? ((product.revenue / totalRevenue) * 100).toFixed(1)
        : '0.0';
      var barWidth    = Math.min(parseFloat(contribPct), 100);

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="td-rank ' + (rank <= 3 ? 'td-rank-top' : '') + '">' + rank + '</td>' +
        '<td><strong>' + escHtml(product.product_name) + '</strong>' +
          '<br><span style="font-size:12px;color:var(--clr-gray-md)">' +
            escHtml(product.strength) + ' · ' + escHtml(product.dosage_form) +
          '</span></td>' +
        '<td class="td-category">' + escHtml(category) + '</td>' +
        '<td><strong>' + fmtNum(product.units_sold) + '</strong></td>' +
        '<td>' + fmtPKR(product.revenue) + '</td>' +
        '<td class="td-contribution">' +
          '<div class="contrib-bar-wrap">' +
            '<div class="contrib-bar-bg">' +
              '<div class="contrib-bar-fill" style="width:' + barWidth + '%"></div>' +
            '</div>' +
            '<span class="contrib-pct">' + contribPct + '%</span>' +
          '</div>' +
        '</td>';
      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function escHtml(str) {
    if (!str) return '—';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── BOOT ─────────────────────────────────────────────────────
  init().catch(function (err) {
    console.error('SalesInsights init error:', err);
  });

}());
