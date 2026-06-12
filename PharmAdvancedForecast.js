// ============================================================
//  PharmAdvancedForecast.js  v5.0
//
//  UPGRADE: Demand Forecasting Overhaul
//  ─────────────────────────────────────────────────────────
//  OBJ 1 — Unique User Counting
//           search_count now = unique users (not raw rows).
//           platform_total  = total unique users in period.
//           All stat cards, table, chart, and restock labels
//           updated to say "users" instead of "searches".
//
//  OBJ 2 — 24-Hour Deduplication (server-side, migration 01)
//           log_search RPC silently skips duplicate searches
//           from the same user within 24 hours. No JS change
//           needed in UserPharmacySearch.js; logSearch() call
//           is identical.
//
//  OBJ 3 — Weighted Demand Score
//           get_top_searched_medicines now returns demand_score.
//           Ranking is by demand_score DESC (server-side).
//           Table adds a "Score" column. Chart tooltip shows it.
//
//  OBJ 4 — Category-Level Forecasting (NEW section)
//           loadCategoryDemand() calls get_category_demand RPC.
//           Rendered below Demand Trend as a category grid +
//           mini donut-style bar chart with trend arrows.
//
//  PRESERVED (unchanged from v4.1):
//    · Sidebar init, auth guard, logout
//    · Filter bar (7 / 15 / 30 days)
//    · loadPharmacyStock() with 4-tier aggregation (FIX #3)
//    · getStockStatus() 4-tier resolution (FIX #3)
//    · renderRestockSuggestions()
//    · renderDemandChart() — extended with demand_score tooltip
//    · loadDemandTrend() — now shows unique-user counts (RPC change)
//    · renderEmptyState()
// ============================================================

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────
  const TOP_LIMIT = 10;

  // ── State ─────────────────────────────────────────────────
  let activeDays    = 7;
  let pharmacyId    = null;
  let forecastChart = null;

  // Stock lookup maps (populated by loadPharmacyStock)
  let stockByProductId   = new Map();
  let stockByNormName    = new Map();
  let stockByNormGeneric = new Map();
  let stockByNormBrand   = new Map();

  // ── Supabase client ───────────────────────────────────────
  const sb = window.supabaseClient;

  // ── DOM helpers ───────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function norm(s) {
    return String(s ?? '')
      .toUpperCase()
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Sidebar ───────────────────────────────────────────────
  function initSidebar() {
    const sidebar  = $('sidebar');
    const hamBtn   = $('hamBtn');
    const sOverlay = $('sOverlay');

    const toggle = () => {
      const open = sidebar?.classList.toggle('open');
      hamBtn?.setAttribute('aria-expanded', String(!!open));
    };
    const close = () => {
      sidebar?.classList.remove('open');
      hamBtn?.setAttribute('aria-expanded', 'false');
    };

    hamBtn?.addEventListener('click', toggle);
    sOverlay?.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function getInitials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    const f = parts[0]?.[0] || '';
    const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (f + l).toUpperCase() || '?';
  }

  function renderSidebarAvatar(imageUrl, initials) {
    const container = $('sidebarAvatarInner');
    if (!container) return;
    container.innerHTML = '';

    if (imageUrl) {
      const img = document.createElement('img');
      img.alt = 'Avatar';
      img.onerror = () => {
        container.innerHTML = '';
        const span = document.createElement('span');
        span.className   = 's-avatar-initials-text';
        span.textContent = initials || '?';
        container.appendChild(span);
      };
      img.src = imageUrl;
      container.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.className   = 's-avatar-initials-text';
      span.textContent = initials || '?';
      container.appendChild(span);
    }
  }

  // ── Auth + Bootstrap ──────────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }

    const userId = session.user.id;

    const { data: userRow } = await sb
      .from('users').select('role').eq('id', userId).single();

    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    const [{ data: profile }, { data: pharmacy }] = await Promise.all([
      sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single(),
      sb.from('pharmacies').select('id').eq('user_id', userId).single(),
    ]);

    pharmacyId = pharmacy?.id || null;

    const displayName = profile?.full_name
      || session.user.email?.split('@')[0]
      || 'Pharmacist';

    const nameEl  = document.querySelector('.s-uname');
    const emailEl = document.querySelector('.s-uemail');
    if (nameEl)  nameEl.textContent  = displayName;
    if (emailEl) emailEl.textContent = session.user.email || '';

    renderSidebarAvatar(profile?.profile_img || null, getInitials(displayName));

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.href = 'Login.html';
      });
    }

    initSidebar();
    initFilterBar();

    await loadPharmacyStock();
    await refreshAll();
  }

  // ── Filter bar (7 / 15 / 30 days) ────────────────────────
  function initFilterBar() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', async function () {
        document.querySelectorAll('.filter-btn')
          .forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        activeDays = Number(this.dataset.days);
        await refreshAll();
      });
    });
  }

  // Single entry point — refresh all sections
  async function refreshAll() {
    updatePeriodLabels();
    await Promise.all([
      loadDemandForecast(),
      loadDemandTrend(),
      loadCategoryDemand(),   // OBJ 4 — new
    ]);
  }

  function updatePeriodLabels() {
    // OBJ 1: label now says "Unique Users" not "Total Searches"
    const totalLabel = $('statTotalLabel');
    if (totalLabel) totalLabel.textContent = 'Unique Users (' + activeDays + 'd)';

    const periodBadge = $('forecastPeriodBadge');
    if (periodBadge) periodBadge.innerHTML =
      '<i class="fa-solid fa-circle" aria-hidden="true"></i> Last ' + activeDays + ' days';

    const trendSub = $('trendSubtitle');
    if (trendSub) trendSub.textContent =
      'Comparing last ' + activeDays + ' days vs previous ' + activeDays + ' days (unique users)';

    const chartSub = $('chartSubtitle');
    if (chartSub) chartSub.textContent =
      'Unique patient demand on MediFinder (last ' + activeDays + ' days)';

    const catSub = $('categorySubtitle');
    if (catSub) catSub.textContent =
      'Category demand breakdown (last ' + activeDays + ' days)';
  }

  // ── FIX #3 (v4.1): Pharmacy stock with per-product aggregation ──
  async function loadPharmacyStock() {
    stockByProductId.clear();
    stockByNormName.clear();
    stockByNormGeneric.clear();
    stockByNormBrand.clear();
    if (!pharmacyId) return;

    const { data, error } = await sb
      .from('pharmacy_inventory_view')
      .select(
        'product_id, product_name, generic_name, strength, dosage_form, brand, ' +
        'box_quantity, reorder_level'
      )
      .eq('pharmacy_id', pharmacyId);

    if (error) {
      console.warn('Stock lookup failed:', error.message);
      return;
    }

    // Step 1: aggregate box_quantity per product_id (sum all batches)
    const aggregated = new Map();

    (data || []).forEach(row => {
      const pid = row.product_id;
      if (!pid) return;
      const qty     = Number(row.box_quantity)  || 0;
      const reorder = Number(row.reorder_level) || 0;

      if (aggregated.has(pid)) {
        const existing = aggregated.get(pid);
        existing.qty    += qty;
        existing.reorder = Math.max(existing.reorder, reorder);
      } else {
        aggregated.set(pid, {
          qty,
          reorder,
          product_name: row.product_name,
          generic_name: row.generic_name,
          strength:     row.strength,
          brand:        row.brand,
        });
      }
    });

    // Step 2: build lookup maps from aggregated data
    aggregated.forEach((agg, pid) => {
      const entry = {
        qty:    agg.qty,
        reorder: agg.reorder,
        low:    agg.reorder > 0 && agg.qty <= agg.reorder,
      };

      stockByProductId.set(pid, entry);

      const normName = norm(agg.product_name);
      if (normName) stockByNormName.set(normName, entry);

      const normGen = norm((agg.generic_name || '') + ' ' + (agg.strength || ''));
      if (normGen) stockByNormGeneric.set(normGen, entry);

      const normBrand = norm(agg.brand || '');
      if (normBrand) stockByNormBrand.set(normBrand, entry);
    });
  }

  // 4-tier stock resolution
  function getStockStatus(item) {
    if (!pharmacyId) return { label: '—', cls: 'stock-unknown' };

    const byId = item.product_id
      ? stockByProductId.get(item.product_id)
      : null;

    const byName = stockByNormName.get(norm(item.product_name));

    const byBrand = item.product_name
      ? stockByNormBrand.get(norm(item.product_name))
      : null;

    let byPartial = null;
    if (!byName && !byBrand) {
      const searchedNorm = norm(item.product_name);
      for (const [invName, entry] of stockByNormName) {
        if (searchedNorm.startsWith(invName) ||
            invName.startsWith(searchedNorm) ||
            searchedNorm.includes(invName) ||
            invName.includes(searchedNorm)) {
          byPartial = entry;
          break;
        }
      }
    }

    const byGeneric = (item.generic_name || item.strength)
      ? stockByNormGeneric.get(norm(
          (item.generic_name || '') + ' ' + (item.strength || '')
        ))
      : null;

    const stockEntry = byId || byName || byBrand || byPartial || byGeneric;

    if (!stockEntry)            return { label: 'Not In Stock', cls: 'stock-missing' };
    if (stockEntry.qty <= 0)    return { label: 'Out of Stock',  cls: 'stock-oos'    };
    if (stockEntry.low)         return { label: 'Low (' + stockEntry.qty + ')', cls: 'stock-low' };
    return { label: 'In Stock (' + stockEntry.qty + ')', cls: 'stock-ok' };
  }

  // ── Main demand forecast ──────────────────────────────────
  async function loadDemandForecast() {
    const tbody = $('top10Body');
    if (tbody) tbody.innerHTML =
      '<tr><td colspan="7" class="tbl-loading">Loading…</td></tr>';

    // Run both fetches in parallel: filtered period + fixed 7d for restock
    const [mainResult, restock7dResult] = await Promise.all([
      sb.rpc('get_top_searched_medicines', { p_limit: TOP_LIMIT, p_days: activeDays }),
      activeDays === 7
        ? Promise.resolve(null)
        : sb.rpc('get_top_searched_medicines', { p_limit: TOP_LIMIT, p_days: 7 }),
    ]);

    if (mainResult.error) {
      const hint = /function|not found|schema cache/i.test(mainResult.error.message)
        ? 'Deploy the demand forecast SQL migrations in Supabase.'
        : 'Could not load forecast: ' + mainResult.error.message;
      renderEmptyState(hint);
      const restockEl = $('restockList');
      if (restockEl) restockEl.innerHTML = '<p class="tbl-empty">' + esc(hint) + '</p>';
      return;
    }

    const rows = mainResult.data || [];

    if (!rows.length) {
      renderEmptyState('No search data in the last ' + activeDays + ' days.');
      const restockEl = $('restockList');
      if (restockEl)
        restockEl.innerHTML = '<p class="tbl-empty">No search data for this period.</p>';
      return;
    }

    // OBJ 1: platform_total is now unique-user count from RPC
    const rowSum   = rows.reduce((s, r) => s + Number(r.search_count || 0), 0);
    const rpcTotal = rows[0]?.platform_total ? Number(rows[0].platform_total) : 0;
    const totalUsers = rpcTotal > rowSum ? rpcTotal : rowSum;

    const top = rows[0];

    if ($('statTotalSearches'))
      $('statTotalSearches').textContent = totalUsers.toLocaleString();

    if ($('statTopShare'))
      $('statTopShare').textContent = (top.share_pct ?? 0) + '%';
    if ($('statTopName')) {
      $('statTopName').innerHTML =
        '<strong style="color:var(--clr-green);font-size:14px;">' +
        esc(top.product_name || '—') + '</strong>';
    }

    let missing = 0;
    rows.forEach(item => {
      const st = getStockStatus(item);
      if (st.cls === 'stock-missing' || st.cls === 'stock-oos') missing++;
    });
    if ($('statMissingStock'))
      $('statMissingStock').textContent = String(missing);

    renderTop10Table(rows);
    renderDemandChart(rows);

    // Restock: always 7d data
    const restockRows = activeDays === 7
      ? rows
      : (restock7dResult?.data || []);
    renderRestockSuggestions(restockRows);
  }

  function renderEmptyState(message) {
    const tbody = $('top10Body');
    if (tbody) tbody.innerHTML =
      '<tr><td colspan="7" class="tbl-empty">' + esc(message) + '</td></tr>';
    if ($('statTotalSearches')) $('statTotalSearches').textContent = '0';
    if ($('statTopShare'))      $('statTopShare').textContent      = '—';
    if ($('statTopName'))       $('statTopName').textContent       = 'No data';
    if ($('statMissingStock'))  $('statMissingStock').textContent  = '0';

    if (forecastChart) {
      forecastChart.destroy();
      forecastChart = null;
    }

    const chartWrap = $('forecastChart')?.parentElement;
    if (chartWrap) {
      chartWrap.innerHTML =
        '<canvas id="forecastChart" aria-label="Bar chart of top 10 searched products" role="img" style="display:none;"></canvas>' +
        '<p class="tbl-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;">' +
          esc(message) +
        '</p>';
    }
  }

  // ── OBJ 3: Table now shows demand_score column ────────────
  function renderTop10Table(rows) {
    const tbody = $('top10Body');
    if (!tbody) return;

    const frag = document.createDocumentFragment();
    rows.forEach((item, i) => {
      const rank  = item.rank ?? i + 1;
      const stock = getStockStatus(item);
      const score = Number(item.demand_score || 0).toFixed(1);
      const tr    = document.createElement('tr');
      tr.innerHTML =
        `<td><span class="rank-badge">#${esc(rank)}</span></td>` +
        `<td><p class="med-name">${esc(item.product_name)}</p></td>` +
        `<td><span class="med-category">${esc(item.category || '—')}</span></td>` +
        `<td><strong>${Number(item.search_count || 0).toLocaleString()}</strong></td>` +
        `<td>${item.share_pct ?? 0}%</td>` +
        `<td><span class="demand-score-pill">${esc(score)}</span></td>` +
        `<td><span class="stock-pill ${stock.cls}">${esc(stock.label)}</span></td>`;
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  // Restock: max 10, always 7d data, missing/oos only
  function renderRestockSuggestions(rows) {
    const el = $('restockList');
    if (!el) return;

    const needsAction = rows
      .filter(item => {
        const st = getStockStatus(item);
        return st.cls === 'stock-missing' || st.cls === 'stock-oos';
      })
      .sort((a, b) => Number(b.search_count || 0) - Number(a.search_count || 0))
      .slice(0, 10);

    if (!needsAction.length) {
      el.innerHTML =
        '<p class="tbl-empty">Your stock covers all top searched products.</p>';
      return;
    }

    el.innerHTML = needsAction.map(item => {
      const pct = item.share_pct ?? 0;
      return `
        <div class="risk-card">
          <div class="risk-head">
            <span class="risk-name">${esc(item.product_name)}</span>
            <span class="risk-badge risk-badge--high">Add to inventory</span>
          </div>
          <p class="risk-sub">
            ${Number(item.search_count || 0).toLocaleString()} unique users
            (${pct}% of demand)
          </p>
          <div class="risk-progress">
            <div class="progress-bar">
              <div class="progress-fill progress-fill--green"
                   style="width:${Math.min(100, pct)}%"></div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  // ── OBJ 3: Chart with demand_score tooltip ────────────────
  function renderDemandChart(rows) {
    const canvas = $('forecastChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }

    const labels = rows.map(r => {
      const n = r.product_name || '';
      return n.length > 24 ? n.slice(0, 22) + '…' : n;
    });
    const counts  = rows.map(r => Number(r.search_count || 0));
    const maxVal  = Math.max(...counts, 1);

    const bgColors = counts.map((_, i) => {
      const opacity = 1 - (i * 0.055);
      return `rgba(32,139,58,${opacity.toFixed(2)})`;
    });

    forecastChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Unique Users',
          data: counts,
          backgroundColor: bgColors,
          borderColor: 'transparent',
          borderRadius: { topRight: 8, bottomRight: 8 },
          borderSkipped: false,
          barThickness: 'flex',
          maxBarThickness: 28,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        animation: { duration: 500, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            titleColor: '#fff',
            bodyColor: '#d1fae5',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              title: ctx => rows[ctx[0].dataIndex]?.product_name || '',
              label: ctx => ' ' + ctx.parsed.x.toLocaleString() + ' unique users',
              afterLabel: ctx => {
                const row = rows[ctx.dataIndex];
                const pct   = row?.share_pct ?? 0;
                const score = Number(row?.demand_score || 0).toFixed(1);
                return [
                  ' ' + pct + '% of total demand',
                  ' Demand score: ' + score,
                ];
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: '#f3f4f6', drawBorder: false },
            ticks: {
              font: { family: 'Roboto', size: 11 },
              color: '#9ca3af',
              maxTicksLimit: 6,
            },
            beginAtZero: true,
            suggestedMax: Math.ceil(maxVal * 1.15),
          },
          y: {
            grid: { display: false, drawBorder: false },
            ticks: {
              font: { family: 'Roboto', size: 12, weight: '500' },
              color: '#374151',
              padding: 8,
            },
          },
        },
        layout: { padding: { right: 12 } },
      },
      plugins: [{
        id: 'barLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const val = counts[i];
            if (!val) return;
            ctx.save();
            ctx.fillStyle = '#6b7280';
            ctx.font = '500 11px Roboto, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(val.toLocaleString(), bar.x + 6, bar.y);
            ctx.restore();
          });
        },
      }],
    });
  }

  // ── Demand Trend (preserved from v4.1) ───────────────────
  // RPC now returns unique-user counts; JS is unchanged.
  async function loadDemandTrend() {
    const el = $('trendList');
    if (!el) return;
    el.innerHTML = '<p class="tbl-loading">Loading trends…</p>';

    const { data, error } = await sb.rpc('get_demand_trend', {
      p_days: activeDays,
    });

    if (error) {
      el.innerHTML =
        '<p class="tbl-empty">Could not load trend data: ' + esc(error.message) + '</p>';
      return;
    }

    const trendRows = (data || []).slice(0, 10);

    if (!trendRows.length) {
      el.innerHTML =
        '<p class="tbl-empty">No search data for the last ' + activeDays + ' days.</p>';
      return;
    }

    el.innerHTML = trendRows.map(function (row) {
      const prev       = Number(row.previous_count  || 0);
      const curr       = Number(row.current_count   || 0);
      const changePct  = row.change_pct  != null ? Number(row.change_pct)  : null;
      const shareChg   = row.share_change != null ? Number(row.share_change) : null;
      const currShare  = row.current_share  != null ? Number(row.current_share)  : 0;
      const prevShare  = row.previous_share != null ? Number(row.previous_share) : 0;

      let badgeCls, badgeText;
      if (prev === 0) {
        badgeCls  = 'trend-badge--up';
        badgeText = 'New · ' + curr.toLocaleString() + ' users';
      } else if (changePct > 0) {
        badgeCls  = 'trend-badge--up';
        badgeText = '+' + changePct + '%';
      } else if (changePct < 0) {
        badgeCls  = 'trend-badge--down';
        badgeText = changePct + '%';
      } else {
        badgeCls  = 'trend-badge--flat';
        badgeText = '→ 0%';
      }

      let shareLine = '';
      if (prev === 0) {
        shareLine =
          '<span class="trend-share">' +
            'Share: <strong>' + currShare + '%</strong> of demand' +
          '</span>';
      } else {
        const shareSign  = shareChg >= 0 ? '+' : '';
        const shareColor = shareChg > 0
          ? 'var(--clr-green)'
          : shareChg < 0 ? '#ef4444' : '#6b7280';
        shareLine =
          '<span class="trend-share">' +
            'Share: ' + prevShare + '% → <strong>' + currShare + '%</strong>' +
            ' <span style="color:' + shareColor + ';font-weight:600;">' +
              '(' + shareSign + shareChg + ' pp)' +
            '</span>' +
          '</span>';
      }

      const countsLine = prev === 0
        ? ''
        : '<span class="trend-counts">' +
            prev.toLocaleString() + ' → ' + curr.toLocaleString() + ' users' +
          '</span>';

      return (
        '<div class="trend-item trend-item--rich">' +
          '<div class="trend-main">' +
            '<span class="trend-name" title="' + esc(row.product_name) + '">' +
              esc(row.product_name) +
            '</span>' +
            '<span class="trend-badge ' + badgeCls + '">' + badgeText + '</span>' +
          '</div>' +
          '<div class="trend-meta">' +
            shareLine +
            countsLine +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // ── OBJ 4: Category-Level Demand Forecasting ──────────────
  async function loadCategoryDemand() {
    const el = $('categoryDemandList');
    if (!el) return;
    el.innerHTML = '<p class="tbl-loading">Loading category demand…</p>';

    const { data, error } = await sb.rpc('get_category_demand', {
      p_days: activeDays,
    });

    if (error) {
      el.innerHTML =
        '<p class="tbl-empty">Could not load category data: ' + esc(error.message) + '</p>';
      return;
    }

    const rows = (data || []);

    if (!rows.length) {
      el.innerHTML =
        '<p class="tbl-empty">No category data for the last ' + activeDays + ' days.</p>';
      return;
    }

    // Top category badge in stat card
    const topCat = rows[0];
    const statCatEl    = $('statTopCategory');
    const statCatShare = $('statTopCategoryShare');
    if (statCatEl)    statCatEl.textContent    = topCat.category || '—';
    if (statCatShare) statCatShare.textContent = (topCat.share_pct ?? 0) + '%';

    // Build category cards
    const maxUsers = Math.max(...rows.map(r => Number(r.unique_users || 0)), 1);

    // Palette: cycle through accent colors
    const COLORS = [
      { bg: 'var(--clr-green-bg)',  fg: 'var(--clr-green)'  },
      { bg: 'var(--clr-blue-bg)',   fg: 'var(--clr-blue)'   },
      { bg: 'var(--clr-amber-bg)',  fg: 'var(--clr-amber)'  },
      { bg: 'var(--clr-purple-bg)', fg: 'var(--clr-purple)' },
      { bg: 'var(--clr-orange-bg)', fg: 'var(--clr-orange)' },
      { bg: 'var(--clr-red-bg)',    fg: 'var(--clr-red)'    },
    ];

    el.innerHTML = rows.map((row, i) => {
      const users      = Number(row.unique_users || 0);
      const rawS       = Number(row.raw_searches || 0);
      const share      = row.share_pct ?? 0;
      const widthPct   = Math.round((users / maxUsers) * 100);
      const col        = COLORS[i % COLORS.length];
      const changePct  = row.change_pct != null ? Number(row.change_pct) : null;
      const prevUsers  = Number(row.prev_users || 0);

      // Trend arrow
      let trendHtml = '';
      if (changePct === null) {
        trendHtml = '<span class="cat-trend cat-trend--new">New</span>';
      } else if (changePct > 0) {
        trendHtml = `<span class="cat-trend cat-trend--up">▲ +${changePct}%</span>`;
      } else if (changePct < 0) {
        trendHtml = `<span class="cat-trend cat-trend--down">▼ ${changePct}%</span>`;
      } else {
        trendHtml = '<span class="cat-trend cat-trend--flat">→ 0%</span>';
      }

      const prevLine = prevUsers > 0
        ? `<span class="cat-prev">Prev: ${prevUsers.toLocaleString()} users</span>`
        : '';

      return `
        <div class="cat-card">
          <div class="cat-card__header">
            <div class="cat-card__rank-wrap">
              <span class="cat-card__rank" style="background:${col.bg};color:${col.fg}">#${i + 1}</span>
              <span class="cat-card__name">${esc(row.category)}</span>
            </div>
            <div class="cat-card__badges">
              ${trendHtml}
              <span class="cat-card__share">${share}%</span>
            </div>
          </div>
          <div class="cat-card__meta">
            <span class="cat-card__users">${users.toLocaleString()} unique users</span>
            <span class="cat-card__raw">${rawS.toLocaleString()} searches</span>
            ${prevLine}
          </div>
          <div class="cat-card__bar-wrap">
            <div class="cat-card__bar">
              <div class="cat-card__bar-fill" style="width:${widthPct}%;background:${col.fg}"></div>
            </div>
            <span class="cat-card__bar-label">${widthPct}%</span>
          </div>
        </div>`;
    }).join('');
  }

  // ── Boot ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
