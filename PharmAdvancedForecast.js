// ============================================================
//  PharmAdvancedForecast.js  v3.0
//
//  CHANGES FROM v2.0:
//  [FIX]     Stock matching — 3-tier normalized lookup
//            (product_id UUID → norm product_name → norm generic+strength)
//  [NEW]     Time-filter bar (7 / 14 / 21 / 30 d) wired to every section
//  [NEW]     Demand Trend section — get_demand_trend RPC
//  [NEW]     Low Demand Products section — get_low_demand_products RPC
//            (paginated, pharmacy_id resolved server-side from auth.uid())
//  [CHANGED] Restock — top 5, only missing/oos, sorted by search_count desc
//  [CHANGED] Chart re-renders on every filter change
//  [FIX]     Sidebar — PharmInfoUpdate avatar / email / logout pattern
// ============================================================

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────
  const TOP_LIMIT     = 10;
  const LOW_PAGE_SIZE = 10;

  // ── State ─────────────────────────────────────────────────
  let activeDays    = 7;      // default filter; matches first filter-btn
  let pharmacyId    = null;
  let forecastChart = null;
  let lowDemandPage = 0;
  let lowDemandFilter = '';     // search bar filter text
  let lowDemandAllRows = [];    // full unfiltered result set for current page group

  // Stock lookup maps (populated by loadPharmacyStock)
  let stockByProductId   = new Map();  // product_id UUID → entry
  let stockByNormName    = new Map();  // norm(product_name) → entry
  let stockByNormGeneric = new Map();  // norm(generic_name + ' ' + strength) → entry
  let stockByNormBrand   = new Map();

  // ── Supabase client ───────────────────────────────────────
  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── DOM helpers ───────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // [FIX] Normalize for stock matching:
  //   uppercase · collapse whitespace · strip hyphens · trim
  function norm(s) {
    return String(s ?? '')
      .toUpperCase()
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Sidebar (mirrors PharmInfoUpdate pattern exactly) ─────
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

  // [FIX] Sidebar avatar — photo or initials fallback
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

    // Fetch profile + pharmacy in parallel
    const [{ data: profile }, { data: pharmacy }] = await Promise.all([
      sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single(),
      sb.from('pharmacies').select('id').eq('user_id', userId).single(),
    ]);

    pharmacyId = pharmacy?.id || null;

    const displayName = profile?.full_name
      || session.user.email?.split('@')[0]
      || 'Pharmacist';

    // Populate sidebar user block
    const nameEl  = document.querySelector('.s-uname');
    const emailEl = document.querySelector('.s-uemail');
    if (nameEl)  nameEl.textContent  = displayName;
    if (emailEl) emailEl.textContent = session.user.email || '';

    renderSidebarAvatar(profile?.profile_img || null, getInitials(displayName));

    // [FIX] Logout wired to correct element (id="logoutBtn")
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await sb.auth.signOut();
        window.location.href = 'Login.html';
      });
    }

    initSidebar();
    initFilterBar();
    initLowDemandSearch(); 

    // Load stock first — all render functions depend on it
    await loadPharmacyStock();
    await refreshAll();
  }

  // ── [NEW] Filter bar ──────────────────────────────────────
  function initFilterBar() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', async function () {
        document.querySelectorAll('.filter-btn')
          .forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        activeDays    = Number(this.dataset.days);
        lowDemandPage = 0;   // reset pagination on filter change
        await refreshAll();
      });
    });
  }

  // [NEW] Single entry point — refresh all sections together
  async function refreshAll() {
    updatePeriodLabels();
    // Run all three loaders; each manages its own loading state
    await Promise.all([
      loadDemandForecast(),
      loadDemandTrend(),
      loadLowDemandProducts(),
    ]);
  }

  function updatePeriodLabels() {
    const totalLabel = $('statTotalLabel');
    if (totalLabel) totalLabel.textContent = `Total Searches (${activeDays}d)`;

    const periodBadge = $('forecastPeriodBadge');
    if (periodBadge) periodBadge.innerHTML =
      '<i class="fa-solid fa-circle" aria-hidden="true"></i> Last ' + activeDays + ' days';

    const trendSub = $('trendSubtitle');
    if (trendSub) trendSub.textContent =
      `Comparing last ${activeDays} days vs previous ${activeDays} days`;
  }

  function initLowDemandSearch() {
  const input = $('lowDemandSearch');
  if (!input) return;
  input.addEventListener('input', function () {
    lowDemandFilter = this.value.trim().toLowerCase();
    lowDemandPage   = 0;   // reset to page 1 on new search
    renderFilteredLowDemand();
  });
}

function renderFilteredLowDemand() {
  const tbody = $('lowDemandBody');
  if (!tbody) return;

  const filtered = lowDemandFilter
    ? lowDemandAllRows.filter(r =>
        (r.product_name  || '').toLowerCase().includes(lowDemandFilter) ||
        (r.generic_name  || '').toLowerCase().includes(lowDemandFilter)
      )
    : lowDemandAllRows;

  const start   = lowDemandPage * LOW_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + LOW_PAGE_SIZE);
  const hasPrev  = lowDemandPage > 0;
  const hasNext  = filtered.length > start + LOW_PAGE_SIZE;

  if (!pageRows.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="tbl-empty">No products match your search.</td></tr>';
    renderLowDemandPagination(hasPrev, hasNext);
    return;
  }

  const demandBadgeMap = {
    'Very Low': 'demand-badge--very-low',
    'Low':      'demand-badge--low',
    'Moderate': 'demand-badge--moderate',
    'High':     'demand-badge--high',
  };

  const frag = document.createDocumentFragment();
  pageRows.forEach(row => {
    const badgeCls = demandBadgeMap[row.demand_level] || 'demand-badge--low';
    const tr = document.createElement('tr');
    tr.innerHTML =
  '<td>' +
  '<p class="med-name">' + esc(row.product_name) + '</p>' +
  '<span class="med-category">' + esc(row.generic_name || '') + ' ' + esc(row.strength || '') + '</span>' +
  '</td>' +
  '<td><strong>' + Number(row.search_count).toLocaleString() + '</strong></td>' +
  '<td>' + (row.demand_pct ?? 0) + '%</td>' +
  '<td><span class="demand-badge ' + badgeCls + '">' + esc(row.demand_level) + '</span></td>';
    frag.appendChild(tr);
  });
  tbody.innerHTML = '';
  tbody.appendChild(frag);

  renderLowDemandPagination(hasPrev, hasNext);
}
  
  // ── Pharmacy stock (3-tier normalized lookup) ─────────────
  // [FIX] Build three maps so getStockStatus can match reliably
  //       regardless of how the searched product name was stored
  async function loadPharmacyStock() {
    stockByProductId.clear();
    stockByNormName.clear();
    stockByNormGeneric.clear();
    if (!pharmacyId) return;

    const { data, error } = await sb
      .from('pharmacy_inventory_view')
      .select(
        'product_id, product_name, generic_name, strength, dosage_form, ' +
        'box_quantity, reorder_level'
      )
      .eq('pharmacy_id', pharmacyId);

    if (error) {
      console.warn('Stock lookup failed:', error.message);
      return;
    }

    (data || []).forEach(row => {
      const qty     = Number(row.box_quantity)  || 0;
      const reorder = Number(row.reorder_level) || 0;
      const entry   = { qty, reorder, low: reorder > 0 && qty <= reorder };

      // Map 1 — UUID (most reliable, used when RPC returns product_id)
      if (row.product_id) stockByProductId.set(row.product_id, entry);

      // Map 2 — normalized product_name
      const normName = norm(row.product_name);
      if (normName) stockByNormName.set(normName, entry);

      // Map 3 — normalized generic_name + strength
      //   handles brand-name searches matching generic-name inventory
      const normGen = norm((row.generic_name || '') + ' ' + (row.strength || ''));
      if (normGen) stockByNormGeneric.set(normGen, entry);

      const normBrand = norm(row.brand || '');
if (normBrand) stockByNormBrand.set(normBrand, entry);
    });
  }

  // [FIX] Three-tier resolution — eliminates false "Not In Stock" badges
 function getStockStatus(item) {
  if (!pharmacyId) return { label: '—', cls: 'stock-unknown' };

  // Tier 1: UUID
  const byId = item.product_id
    ? stockByProductId.get(item.product_id)
    : null;

  // Tier 2a: normalized product_name
  const byName = stockByNormName.get(norm(item.product_name));

  // Tier 2b: brand name match
  const byBrand = item.product_name
    ? stockByNormBrand.get(norm(item.product_name))
    : null;

  // Tier 2c: partial name match (handles "Calpol 500" vs "Calpol")
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

  // Tier 3: generic_name + strength
  const byGeneric = (item.generic_name || item.strength)
    ? stockByNormGeneric.get(norm(
        (item.generic_name || '') + ' ' + (item.strength || '')
      ))
    : null;

  const stockEntry = byId || byName || byBrand || byPartial || byGeneric;

  if (!stockEntry)            return { label: 'Not In Stock', cls: 'stock-missing' };
  if (stockEntry.qty <= 0)    return { label: 'Out of Stock',  cls: 'stock-oos'    };
  if (stockEntry.low)         return { label: 'Low (' + stockEntry.qty + ')', cls: 'stock-low' };
  return { label: `In Stock (${stockEntry.qty})`, cls: 'stock-ok' };
}

  // ── Main demand forecast ──────────────────────────────────
  async function loadDemandForecast() {
    const tbody = $('top10Body');
    if (tbody) tbody.innerHTML =
      '<tr><td colspan="6" class="tbl-loading">Loading…</td></tr>';

    const { data, error } = await sb.rpc('get_top_searched_medicines', {
      p_limit: TOP_LIMIT,
      p_days:  activeDays,   // [CHANGED] uses active filter
    });

    if (error) {
      const hint = /function|not found|schema cache/i.test(error.message)
        ? 'Deploy the demand forecast SQL migration in Supabase.'
        : 'Could not load forecast: ' + error.message;
      renderEmptyState(hint);
      $('restockList')
        && ($('restockList').innerHTML = '<p class="tbl-empty">' + esc(hint) + '</p>';
      return;
    }

    const rows = data || [];
    if (!rows.length) {
      renderEmptyState(`No search data in the last ${activeDays} days.`);
      $('restockList')
        && ($('restockList').innerHTML =
          '<p class="tbl-empty">No search data for this period.</p>');
      return;
    }

    // Stat cards
    const totalSearches = rows[0]?.platform_total
  ? Number(rows[0].platform_total)
  : rows.reduce((s, r) => s + Number(r.search_count || 0), 0);
    const top = rows[0];
    if ($('statTotalSearches'))
      $('statTotalSearches').textContent = totalSearches.toLocaleString();
    if ($('statTopShare'))
      $('statTopShare').textContent = (top.share_pct ?? 0) + '%';
    if ($('statTopName'))
      $('statTopName').textContent = top.product_name || '—';

    // [FIX] count with corrected 3-tier matching
    let missing = 0;
    rows.forEach(item => {
      const st = getStockStatus(item);
      if (st.cls === 'stock-missing' || st.cls === 'stock-oos') missing++;
    });
    if ($('statMissingStock'))
      $('statMissingStock').textContent = String(missing);

    renderTop10Table(rows);
    renderRestockSuggestions(rows);
    renderDemandChart(rows);
  }

  function renderEmptyState(message) {
    const tbody = $('top10Body');
    if (tbody) tbody.innerHTML =
      '<tr><td colspan="6" class="tbl-empty">' + esc(message) + '</td></tr>';
    if ($('statTotalSearches')) $('statTotalSearches').textContent = '0';
    if ($('statTopShare'))      $('statTopShare').textContent      = '—';
    if ($('statTopName'))       $('statTopName').textContent       = 'No data';
    if ($('statMissingStock'))  $('statMissingStock').textContent  = '0';
  }

  // Top 10 table — tbl-wrap already has overflow-x: auto in CSS
  function renderTop10Table(rows) {
    const tbody = $('top10Body');
    if (!tbody) return;

    const frag = document.createDocumentFragment();
    rows.forEach((item, i) => {
      const rank  = item.rank ?? i + 1;
      const stock = getStockStatus(item);
      const tr    = document.createElement('tr');
      tr.innerHTML =
        `<td><span class="rank-badge">#${esc(rank)}</span></td>` +
        `<td><p class="med-name">${esc(item.product_name)}</p></td>` +
        `<td><span class="med-category">${esc(item.category || '—')}</span></td>` +
        `<td><strong>${Number(item.search_count || 0).toLocaleString()}</strong></td>` +
        `<td>${item.share_pct ?? 0}%</td>` +
        `<td><span class="stock-pill ${stock.cls}">${esc(stock.label)}</span></td>`;
      frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  // [CHANGED] Restock: only missing/oos, sorted by demand desc, cap at 5
  function renderRestockSuggestions(rows) {
    const el = $('restockList');
    if (!el) return;

    const needsAction = rows
      .filter(item => {
        const st = getStockStatus(item);
        return st.cls === 'stock-missing' || st.cls === 'stock-oos';
      })
      .sort((a, b) => Number(b.search_count || 0) - Number(a.search_count || 0))
      .slice(0, 5);

    if (!needsAction.length) {
      el.innerHTML =
        '<p class="tbl-empty">Your stock covers all top searched medicines.</p>';
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
            ${Number(item.search_count || 0).toLocaleString()} searches
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

  // [CHANGED] Chart destroyed + rebuilt on every filter change
  function renderDemandChart(rows) {
    const canvas = $('forecastChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (forecastChart) { forecastChart.destroy(); forecastChart = null; }

    const labels = rows.map(r => {
      const n = r.product_name || '';
      return n.length > 22 ? n.slice(0, 20) + '…' : n;
    });
    const counts = rows.map(r => Number(r.search_count || 0));

    forecastChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Searches',
          data: counts,
          backgroundColor: 'rgba(32,139,58,0.75)',
          borderColor: '#208B3A',
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => rows[ctx[0].dataIndex]?.product_name || '',
              label: ctx =>
                `${ctx.parsed.x.toLocaleString()} searches`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'Roboto', size: 11 }, color: '#9ca3af' },
            beginAtZero: true,
          },
          y: {
            grid: { display: false },
            ticks: { font: { family: 'Roboto', size: 11 }, color: '#6b7280' },
          },
        },
      },
    });
  }

  // ── [NEW] Demand Trend ────────────────────────────────────
  // Calls get_demand_trend(p_days) — returns current vs previous period counts
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
      '<p class="tbl-empty">No trend data available for the last ' + activeDays + ' days.</p>';
    return;
  }

  el.innerHTML = trendRows.map(function(row) {
    let badgeCls, badgeText;
    const prev = Number(row.previous_count || 0);
    const curr = Number(row.current_count  || 0);

    if (prev === 0 && curr > 0) {
      badgeCls  = 'trend-badge--new';
      badgeText = '🆕 New';
    } else if (prev === 0 && curr === 0) {
      badgeCls  = 'trend-badge--flat';
      badgeText = '→ No data';
    } else {
      const pct = Math.round(((curr - prev) / prev) * 100);
      if (pct > 0) {
        badgeCls  = 'trend-badge--up';
        badgeText = '🔥 +' + pct + '%';
      } else if (pct < 0) {
        badgeCls  = 'trend-badge--down';
        badgeText = '📉 ' + pct + '%';
      } else {
        badgeCls  = 'trend-badge--flat';
        badgeText = '→ Stable';
      }
    }

    return '<div class="trend-item">' +
      '<span class="trend-name" title="' + esc(row.product_name) + '">' + esc(row.product_name) + '</span>' +
      '<span class="trend-counts">' + curr.toLocaleString() + ' now &nbsp;/&nbsp; ' + prev.toLocaleString() + ' before</span>' +
      '<span class="trend-badge ' + badgeCls + '">' + badgeText + '</span>' +
      '</div>';
  }).join('');
}

  // ── [NEW] Low Demand Products ─────────────────────────────
async function loadLowDemandProducts() {
  const tbody = $('lowDemandBody');
  if (!tbody) return;

  if (!pharmacyId) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="tbl-empty">No pharmacy record found.</td></tr>';
    return;
  }

  tbody.innerHTML =
    '<tr><td colspan="4" class="tbl-loading">Loading…</td></tr>';

  // Fetch a large batch (e.g. 500) for client-side search+paginate
  // This avoids server round-trips on every search keystroke
  const { data, error } = await sb.rpc('get_low_demand_products', {
    p_days:   activeDays,
    p_limit:  500,
    p_offset: 0,
  });

  if (error) {
    tbody.innerHTML =
      tbody.innerHTML =
  '<tr><td colspan="4" class="tbl-empty">' + esc(error.message) + '</td></tr>';
    renderLowDemandPagination(false, false);
    return;
  }

  lowDemandAllRows = data || [];
  lowDemandFilter  = '';
  lowDemandPage    = 0;

  // Reset search input
  const searchInput = $('lowDemandSearch');
  if (searchInput) searchInput.value = '';

  renderFilteredLowDemand();
}

  function renderLowDemandPagination(hasPrev, hasNext) {
  const bar = $('lowDemandPagination');
  if (!bar) return;

  if (!hasPrev && !hasNext) { bar.innerHTML = ''; return; }

  bar.innerHTML = `
    <button class="page-btn" id="ldPrev" ${hasPrev ? '' : 'disabled'}>← Prev</button>
    <span class="page-info">Page ${lowDemandPage + 1}</span>
    <button class="page-btn" id="ldNext" ${hasNext ? '' : 'disabled'}>Next →</button>`;

  $('ldPrev')?.addEventListener('click', () => {
    lowDemandPage = Math.max(0, lowDemandPage - 1);
    renderFilteredLowDemand();
  });
  $('ldNext')?.addEventListener('click', () => {
    lowDemandPage++;
    renderFilteredLowDemand();
  });
}

  // ── Boot ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
