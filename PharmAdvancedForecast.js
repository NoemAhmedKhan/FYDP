// ============================================================
//  PharmAdvancedForecast.js — Demand forecasting from search data
// ============================================================

(function () {
  'use strict';

  const FORECAST_DAYS = 30;
  const TOP_LIMIT     = 10;

  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  let pharmacyId   = null;
  let forecastChart = null;
  let stockByProduct = new Map();
  let stockByName    = new Map();

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Sidebar ───────────────────────────────────────────────
  function initSidebar() {
    const sidebar  = $('sidebar');
    const hamBtn   = $('hamBtn');
    const sOverlay = $('sOverlay');

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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSidebar();
    });
  }

  // ── Auth ──────────────────────────────────────────────────
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = 'Login.html';
      return;
    }

    const userId = session.user.id;
    const { data: userRow } = await sb.from('users').select('role').eq('id', userId).single();
    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    const { data: profile }   = await sb.from('profiles').select('full_name').eq('user_id', userId).single();
    const { data: pharmacy }  = await sb.from('pharmacies').select('id').eq('user_id', userId).single();
    pharmacyId = pharmacy?.id || null;

    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    const nameEl = document.querySelector('.s-uname');
    const roleEl = document.querySelector('.s-urole');
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = 'Pharmacist';

    const sUserBtn = $('sUserBtn');
    if (sUserBtn) {
      sUserBtn.title = 'Click to log out';
      sUserBtn.addEventListener('click', () =>
        sb.auth.signOut().then(() => { window.location.href = 'Login.html'; })
      );
    }

    initSidebar();
    await loadPharmacyStock();
    await loadDemandForecast();
  }

  // ── Pharmacy inventory (for stock badges) ─────────────────
  async function loadPharmacyStock() {
    stockByProduct.clear();
    stockByName.clear();
    if (!pharmacyId) return;

    const { data, error } = await sb
      .from('pharmacy_inventory_view')
      .select('product_id, product_name, box_quantity, reorder_level')
      .eq('pharmacy_id', pharmacyId);

    if (error) {
      console.warn('Stock lookup failed:', error.message);
      return;
    }

    (data || []).forEach(row => {
      const qty = Number(row.box_quantity) || 0;
      const reorder = Number(row.reorder_level) || 0;
      const entry = { qty, reorder, low: reorder > 0 && qty <= reorder };

      if (row.product_id) stockByProduct.set(row.product_id, entry);
      const key = (row.product_name || '').trim().toLowerCase();
      if (key) stockByName.set(key, entry);
    });
  }

  function getStockStatus(item) {
    if (!pharmacyId) return { label: '—', cls: 'stock-unknown' };

    const byId = item.product_id ? stockByProduct.get(item.product_id) : null;
    const byName = stockByName.get((item.product_name || '').trim().toLowerCase());
    const stock = byId || byName;

    if (!stock) return { label: 'Not stocked', cls: 'stock-missing' };
    if (stock.qty <= 0) return { label: 'Out of stock', cls: 'stock-oos' };
    if (stock.low) return { label: 'Low (' + stock.qty + ')', cls: 'stock-low' };
    return { label: 'In stock (' + stock.qty + ')', cls: 'stock-ok' };
  }

  // ── Fetch top searched medicines ──────────────────────────
  async function fetchTopSearched() {
    const { data, error } = await sb.rpc('get_top_searched_medicines', {
      p_limit: TOP_LIMIT,
      p_days:  FORECAST_DAYS,
    });

    if (!error) return { rows: data || [], error: null };

    // RPC not deployed yet — show setup hint
    if (error.message && /function|not found|schema cache/i.test(error.message)) {
      return { rows: [], error: 'rpc_missing' };
    }

    console.warn('Demand forecast RPC failed:', error.message);
    return { rows: [], error: error.message };
  }

  // ── Render UI ─────────────────────────────────────────────
  async function loadDemandForecast() {
    const { rows, error } = await fetchTopSearched();

    if (error === 'rpc_missing') {
      renderSetupMessage();
      return;
    }

    if (error) {
      renderEmptyState('Could not load forecast: ' + error);
      return;
    }

    if (!rows.length) {
      renderEmptyState('No search data yet. Patient searches will appear here as users look up medicines.');
      return;
    }

    const totalSearches = rows.reduce((sum, r) => sum + Number(r.search_count || 0), 0);
    const top = rows[0];

    if ($('statTotalSearches')) {
      $('statTotalSearches').textContent = totalSearches.toLocaleString();
    }
    if ($('statTopShare')) {
      $('statTopShare').textContent = (top.share_pct != null ? top.share_pct : 0) + '%';
    }
    if ($('statTopName')) {
      $('statTopName').textContent = top.product_name || '—';
    }

    let missing = 0;
    rows.forEach(item => {
      const st = getStockStatus(item);
      if (st.cls === 'stock-missing' || st.cls === 'stock-oos') missing++;
    });
    if ($('statMissingStock')) {
      $('statMissingStock').textContent = String(missing);
    }

    renderTop10Table(rows);
    renderRestockSuggestions(rows);
    renderDemandChart(rows);
  }

  function renderSetupMessage() {
    const msg =
      'Run the SQL migration in Supabase to enable demand forecasting. ' +
      'Open SQL Editor and run: supabase/migrations/20250516000000_demand_forecast_top_searches.sql';

    renderEmptyState(msg);
    const restock = $('restockList');
    if (restock) {
      restock.innerHTML = '<p class="tbl-empty">' + esc(msg) + '</p>';
    }
  }

  function renderEmptyState(message) {
    const tbody = $('top10Body');
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="tbl-empty">' + esc(message) + '</td></tr>';
    }
    if ($('statTotalSearches')) $('statTotalSearches').textContent = '0';
    if ($('statTopShare')) $('statTopShare').textContent = '—';
    if ($('statTopName')) $('statTopName').textContent = 'No data';
    if ($('statMissingStock')) $('statMissingStock').textContent = '0';
  }

  function renderTop10Table(rows) {
    const tbody = $('top10Body');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();
    rows.forEach((item, i) => {
      const rank = item.rank != null ? item.rank : i + 1;
      const stock = getStockStatus(item);
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="rank-badge">#' + esc(rank) + '</span></td>' +
        '<td><p class="med-name">' + esc(item.product_name) + '</p></td>' +
        '<td><span class="med-category">' + esc(item.category || '—') + '</span></td>' +
        '<td><strong>' + Number(item.search_count || 0).toLocaleString() + '</strong></td>' +
        '<td>' + (item.share_pct != null ? item.share_pct : 0) + '%</td>' +
        '<td><span class="stock-pill ' + stock.cls + '">' + esc(stock.label) + '</span></td>';
      fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
  }

  function renderRestockSuggestions(rows) {
    const el = $('restockList');
    if (!el) return;

    const needsAction = rows.filter(item => {
      const st = getStockStatus(item);
      return st.cls === 'stock-missing' || st.cls === 'stock-oos' || st.cls === 'stock-low';
    }).slice(0, 5);

    if (!needsAction.length) {
      el.innerHTML = '<p class="tbl-empty">Your stock covers the top searched medicines. Keep monitoring demand.</p>';
      return;
    }

    el.innerHTML = needsAction.map(item => {
      const st = getStockStatus(item);
      const badgeClass = st.cls === 'stock-missing' ? 'risk-badge--high' :
        st.cls === 'stock-oos' ? 'risk-badge--high' : 'risk-badge--medium';
      const action = st.cls === 'stock-missing' ? 'Add to inventory' :
        st.cls === 'stock-oos' ? 'Restock urgently' : 'Reorder soon';
      return (
        '<div class="risk-card">' +
          '<div class="risk-head">' +
            '<span class="risk-name">' + esc(item.product_name) + '</span>' +
            '<span class="risk-badge ' + badgeClass + '">' + esc(action) + '</span>' +
          '</div>' +
          '<p class="risk-sub">' + Number(item.search_count || 0).toLocaleString() +
            ' searches (' + (item.share_pct != null ? item.share_pct : 0) + '% of demand)</p>' +
          '<div class="risk-progress">' +
            '<div class="progress-bar">' +
              '<div class="progress-fill progress-fill--green" style="width:' +
                Math.min(100, item.share_pct || 0) + '%"></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderDemandChart(rows) {
    const canvas = $('forecastChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = rows.map(r => {
      const name = r.product_name || '';
      return name.length > 22 ? name.slice(0, 20) + '…' : name;
    });
    const counts = rows.map(r => Number(r.search_count || 0));

    if (forecastChart) forecastChart.destroy();

    forecastChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Searches',
          data: counts,
          backgroundColor: 'rgba(32, 139, 58, 0.75)',
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
              label: ctx => ctx.parsed.x.toLocaleString() + ' searches',
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

  document.addEventListener('DOMContentLoaded', init);
})();
