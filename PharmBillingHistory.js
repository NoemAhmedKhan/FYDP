// ============================================================
//  PharmBillingHistory.js  v2
//  Fully dynamic — Supabase-powered billing history
//  RPCs: get_billing_stats, get_billing_history, get_billing_export
// ============================================================

(function () {
  'use strict';

  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── Config ──────────────────────────────────────────────────
  const PAGE_SIZE = 15;

  // ── State ───────────────────────────────────────────────────
  let pharmacyId    = null;
  let currentPage   = 1;
  let totalCount    = 0;
  let filterDays    = 1;     // default: Today
  let searchQuery   = '';
  let searchTimer   = null;

  // ── DOM helper ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ── Escape helper ───────────────────────────────────────────
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Payment method icon/label map ───────────────────────────
  const METHOD_META = {
    cash:       { icon: 'fa-money-bill-wave', label: 'Cash' },
    jazzcash:   { icon: 'fa-mobile-screen',   label: 'JazzCash' },
    easypaisa:  { icon: 'fa-mobile-screen',   label: 'EasyPaisa' },
    card:       { icon: 'fa-credit-card',      label: 'Card' },
  };

  // ── Avatar color from name ───────────────────────────────────
  const AVATAR_PALETTE = [
    '#dcfce7','#fce7f3','#ede9fe','#fff7ed',
    '#eff6ff','#fef3c7','#f0fdf4','#fdf4ff'
  ];
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
  }
  function initials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    const f = parts[0]?.[0] || '';
    const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (f + l).toUpperCase() || '?';
  }

  // ── Toast ────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  // ── Format helpers ───────────────────────────────────────────
  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }
  function fmtTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  }
  function fmtPKR(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000) return 'PKR ' + (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000)     return 'PKR ' + (num / 1_000).toFixed(1) + 'K';
    return 'PKR ' + num.toLocaleString('en-US', { minimumFractionDigits: 0 });
  }
  function fmtNum(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function capitalize(str) {
    if (!str) return '—';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ══════════════════════════════════════════════════════════════
  //  SIDEBAR AVATAR
  // ══════════════════════════════════════════════════════════════
  function renderSidebarAvatar(imageUrl, initialsText) {
    const container = $('sidebarAvatarInner');
    if (!container) return;
    container.innerHTML = '';
    if (imageUrl) {
      const img = document.createElement('img');
      img.alt = 'Avatar';
      img.onerror = () => {
        container.innerHTML = '';
        const span = document.createElement('span');
        span.className = 's-avatar-initials-text';
        span.textContent = initialsText || '?';
        container.appendChild(span);
      };
      img.src = imageUrl;
      container.appendChild(img);
    } else {
      const span = document.createElement('span');
      span.className = 's-avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }

    const userId = session.user.id;

    const { data: userRow } = await sb.from('users').select('role').eq('id', userId).single();
    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    const { data: profile }  = await sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single();
    const { data: pharmacy } = await sb.from('pharmacies').select('id').eq('user_id', userId).single();

    pharmacyId = pharmacy?.id || null;

    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    const email       = session.user.email || '';

    const nameEl  = $('sidebarName');
    const emailEl = $('sidebarEmail');
    if (nameEl)  nameEl.textContent  = displayName;
    if (emailEl) emailEl.textContent = email;
    renderSidebarAvatar(profile?.profile_img || null, initials(displayName));

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () =>
        sb.auth.signOut().then(() => { window.location.href = 'Login.html'; })
      );
    }

    initSidebar();
    initSearch();
    initFilterTabs();
    initExport();

    // Load stats and table in parallel
    await Promise.all([loadStats(), loadHistory()]);
  }

  // ── Sidebar ──────────────────────────────────────────────────
  function initSidebar() {
    const hamBtn   = $('hamBtn');
    const sidebar  = $('sidebar');
    const sOverlay = $('sOverlay');
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        sidebar?.classList.remove('open');
        const exportModal = $('exportModal');
        if (exportModal && !exportModal.hidden) exportModal.hidden = true;
      }
    });
  }

  // ── Search ───────────────────────────────────────────────────
  function initSearch() {
    const input = $('txnSearch');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = input.value.trim();
        currentPage = 1;
        loadHistory();
      }, 350);
    });
  }

  // ── Filter Tabs ──────────────────────────────────────────────
  function initFilterTabs() {
    document.querySelectorAll('.ftab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ftab').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        filterDays  = btn.dataset.days === '' ? null : Number(btn.dataset.days);
        currentPage = 1;
        loadHistory();  // Only table reloads — stats are NOT affected
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  LOAD STATS (all-time, called once)
  // ══════════════════════════════════════════════════════════════
  async function loadStats() {
    if (!pharmacyId) return;
    try {
      const { data, error } = await sb.rpc('get_billing_stats', { p_pharmacy_id: pharmacyId });
      if (error) throw error;

      const d = data || {};
      const revenueEl     = $('statRevenue');
      const avgEl         = $('statAvg');
      const methodEl      = $('statTopMethod');
      const methodPctEl   = $('statTopMethodPct');
      const txnCountEl    = $('statTxnCount');

      if (revenueEl)   revenueEl.textContent   = 'PKR ' + fmtNum(d.total_revenue);
      if (avgEl)       avgEl.textContent        = 'PKR ' + fmtNum(d.avg_transaction_value);
      if (methodEl)    methodEl.textContent     = capitalize(d.top_payment_method) || '—';
      if (methodPctEl) methodPctEl.textContent  = d.top_payment_method_pct ? d.top_payment_method_pct + '% Share' : '—';
      if (txnCountEl)  txnCountEl.innerHTML     = `<i class="fa-solid fa-receipt"></i> ${fmtNum(d.total_transactions)} transactions`;

    } catch (err) {
      console.error('Stats error:', err);
      // Show dashes on error — don't crash the page
      ['statRevenue','statAvg','statTopMethod','statTopMethodPct','statTxnCount'].forEach(id => {
        const el = $(id);
        if (el) el.textContent = '—';
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  LOAD HISTORY TABLE
  // ══════════════════════════════════════════════════════════════
  async function loadHistory() {
    if (!pharmacyId) return;
    showTableLoading();
    try {
      const { data, error } = await sb.rpc('get_billing_history', {
        p_pharmacy_id: pharmacyId,
        p_days:        filterDays || null,
        p_search:      searchQuery || null,
        p_limit:       PAGE_SIZE,
        p_offset:      (currentPage - 1) * PAGE_SIZE
      });
      if (error) throw error;

      totalCount = data?.total ?? 0;
      const rows = data?.rows ?? [];
      renderRows(rows);
      renderPagination();
    } catch (err) {
      console.error('History load error:', err);
      showTableEmpty('Failed to load billing history. Please try again.');
    }
  }

  // ── Render table rows ────────────────────────────────────────
  function renderRows(rows) {
    const tbody = $('txnBody');
    if (!tbody) return;

    if (!rows || !rows.length) {
      showTableEmpty('No transactions found.');
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(t => {
      const ini     = initials(t.customer_name);
      const color   = avatarColor(t.customer_name);
      const method  = METHOD_META[t.payment_method] || { icon: 'fa-circle-question', label: capitalize(t.payment_method) };
      const refPart = t.reference_no ? ` <span style="color:var(--clr-gray-md);font-size:12px">${esc(t.reference_no)}</span>` : '';

      const tr = document.createElement('tr');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('role', 'link');
      tr.setAttribute('aria-label', `View receipt for bill ${esc(t.bill_no)}`);
      tr.dataset.billId = t.id;

      tr.addEventListener('click', () => {
        sessionStorage.setItem('mf_bill_id', t.id);
        window.location.href = 'PharmBillingReceipt.html';
      });
      tr.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          sessionStorage.setItem('mf_bill_id', t.id);
          window.location.href = 'PharmBillingReceipt.html';
        }
      });

      tr.innerHTML =
        `<td><span class="bill-id-cell">${esc(t.bill_no)}</span></td>` +
        `<td>
          <div class="customer-cell">
            <span class="avatar-chip" style="background:${color}" aria-hidden="true">${esc(ini)}</span>
            <div class="cust-detail">
              <span class="cust-name-cell">${esc(t.customer_name)}</span>
              <span class="cust-phone-cell">${esc(t.customer_phone)}</span>
            </div>
          </div>
        </td>` +
        `<td>
          <p class="date-primary">${esc(fmtDate(t.billed_at))}</p>
          <p class="date-secondary">${esc(fmtTime(t.billed_at))}</p>
        </td>` +
        `<td><span class="item-count-cell">${esc(t.item_count)} item${Number(t.item_count) !== 1 ? 's' : ''}</span></td>` +
        `<td><strong class="amount-cell">PKR ${esc(fmtNum(t.grand_total))}</strong></td>` +
        `<td>
          <div class="payment-method">
            <i class="fa-solid ${esc(method.icon)}" aria-hidden="true"></i>
            ${esc(method.label)}${refPart}
          </div>
        </td>`;

      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    // Update count label
    const from   = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const to     = Math.min(currentPage * PAGE_SIZE, totalCount);
    const countEl = $('tblCount');
    if (countEl) countEl.textContent = `Showing ${from}–${to} of ${totalCount.toLocaleString()} transactions`;
  }

  function showTableLoading() {
    const tbody = $('txnBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="table-state"><div class="spinner"></div><p>Loading…</p></div></td></tr>`;
    const countEl = $('tblCount');
    if (countEl) countEl.textContent = '—';
    const pg = $('pgControls');
    if (pg) pg.innerHTML = '';
  }

  function showTableEmpty(msg) {
    const tbody = $('txnBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6"><div class="table-state"><i class="fa-regular fa-folder-open"></i><p>${esc(msg)}</p></div></td></tr>`;
    const countEl = $('tblCount');
    if (countEl) countEl.textContent = '0 transactions';
    const pg = $('pgControls');
    if (pg) pg.innerHTML = '';
  }

  // ── Pagination ───────────────────────────────────────────────
  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const pg = $('pgControls');
    if (!pg) return;

    const pages = buildPageRange(currentPage, totalPages);
    pg.innerHTML =
      `<button class="page-btn" id="pgPrev" ${currentPage <= 1 ? 'disabled' : ''} aria-label="Previous page">
        <i class="fa-solid fa-chevron-left"></i>
      </button>` +
      pages.map(p => p === '…'
        ? `<span class="page-btn" style="cursor:default;border:none">…</span>`
        : `<button class="page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ''}>${p}</button>`
      ).join('') +
      `<button class="page-btn" id="pgNext" ${currentPage >= totalPages ? 'disabled' : ''} aria-label="Next page">
        <i class="fa-solid fa-chevron-right"></i>
      </button>`;

    pg.querySelector('#pgPrev')?.addEventListener('click', () => goTo(currentPage - 1));
    pg.querySelector('#pgNext')?.addEventListener('click', () => goTo(currentPage + 1));
    pg.querySelectorAll('[data-page]').forEach(btn =>
      btn.addEventListener('click', () => goTo(Number(btn.dataset.page)))
    );
  }

  function buildPageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [1];
    if (cur > 3) pages.push('…');
    for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) pages.push(p);
    if (cur < total - 2) pages.push('…');
    pages.push(total);
    return pages;
  }

  function goTo(page) {
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    loadHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ══════════════════════════════════════════════════════════════
  //  EXPORT
  // ══════════════════════════════════════════════════════════════
  function initExport() {
    const exportBtn   = $('exportBtn');
    const modal       = $('exportModal');
    const closeBtn    = $('exportModalClose');
    const last30Btn   = $('exportLast30');
    const allBtn      = $('exportAll');

    if (exportBtn)  exportBtn.addEventListener('click',  () => { modal.hidden = false; });
    if (closeBtn)   closeBtn.addEventListener('click',   () => { modal.hidden = true;  });
    if (modal) {
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.hidden = true;
      });
    }

    if (last30Btn) last30Btn.addEventListener('click', () => { modal.hidden = true; runExport(30); });
    if (allBtn)    allBtn.addEventListener('click',    () => { modal.hidden = true; runExport(null); });
  }

  async function runExport(days) {
    if (!pharmacyId) return;
    showToast('Preparing export…', 'success');

    try {
      const { data, error } = await sb.rpc('get_billing_export', {
        p_pharmacy_id: pharmacyId,
        p_days:        days
      });
      if (error) throw error;
      if (!data || data.length === 0) { showToast('No transactions to export.', 'error'); return; }

      const headers = [
        'Bill ID','Date & Time','Customer Name','Customer Phone',
        'Items','Subtotal (PKR)','Total Discount (PKR)','GST (PKR)',
        'Grand Total (PKR)','Payment Method','Reference No'
      ];

      const csvRows = [
        headers.join(','),
        ...data.map(r => [
          csvCell(r.bill_no),
          csvCell(r.billed_at),
          csvCell(r.customer_name),
          csvCell(r.customer_phone),
          r.item_count,
          Number(r.subtotal).toFixed(2),
          Number(r.total_discount).toFixed(2),
          Number(r.gst_amount).toFixed(2),
          Number(r.grand_total).toFixed(2),
          csvCell(r.payment_method),
          csvCell(r.reference_no || '')
        ].join(','))
      ];

      const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const label = days ? `last_${days}_days` : 'all_history';
      a.href     = url;
      a.download = `billing_${label}_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`Exported ${data.length} records.`, 'success');

    } catch (err) {
      console.error('Export error:', err);
      showToast('Export failed. Please try again.', 'error');
    }
  }

  function csvCell(val) {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // ── Boot ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

}());
