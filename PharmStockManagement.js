// ============================================================
//  PharmStockManagement.js — MediFinder Stock Management
//  Loads inventory from Supabase with pagination (20/page).
//  Auth-guarded: pharmacist role required.
// ============================================================

(function () {
  'use strict';

  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── Config ─────────────────────────────────────────────────
  const PAGE_SIZE = 20;
  const LOW_STOCK_THRESHOLD = 50;

  // ── State ──────────────────────────────────────────────────
  let currentPage  = 1;
  let totalCount   = 0;
  let searchQuery  = '';
  let searchTimer  = null;
  let pharmacyId   = null;

  // ── DOM Refs ───────────────────────────────────────────────
  const tbody        = document.getElementById('invTbody');
  const pgInfo       = document.getElementById('pgInfo');
  const pgControls   = document.getElementById('pgControls');
  const searchInput  = document.getElementById('searchInput');

  // Stat elements
  const statTotal    = document.getElementById('statTotal');
  const statOOS      = document.getElementById('statOOS');
  const statValue    = document.getElementById('statValue');
  const statExpiring = document.getElementById('statExpiring');
  const statExpiringLbl = document.getElementById('statExpiringLbl');

  // ── Avatar colour palette ──────────────────────────────────
  const COLORS = [
    '#208B3A','#3b82f6','#7c3aed','#f59e0b',
    '#ef4444','#06b6d4','#ec4899','#84cc16'
  ];

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  // ── Format helpers ─────────────────────────────────────────
  function fmtDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function isExpiringSoon(str) {
    if (!str) return false;
    const diff = new Date(str) - new Date();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  }

  function isPast(str) {
    if (!str) return false;
    return new Date(str) < new Date();
  }

  function fmtPKR(n) {
    if (n >= 1_000_000) return 'PKR ' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return 'PKR ' + (n / 1_000).toFixed(1) + 'K';
    return 'PKR ' + n.toLocaleString();
  }

  // ── Auth Guard ─────────────────────────────────────────────
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

    // Get profile & pharmacy
    const { data: profile } = await sb
      .from('profiles')
      .select('full_name')
      .eq('user_id', userId)
      .single();

    const { data: pharmacy } = await sb
      .from('pharmacies')
      .select('id')
      .eq('user_id', userId)
      .single();

    pharmacyId = pharmacy?.id || null;

    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    const nameEl = document.querySelector('.s-uname');
    const roleEl = document.querySelector('.s-urole');
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = 'Pharmacist';

    // Logout handler
    const sUser = document.querySelector('.s-user');
    if (sUser) {
      sUser.style.cursor = 'pointer';
      sUser.title = 'Click to log out';
      sUser.addEventListener('click', () => sb.auth.signOut().then(() => window.location.href = 'Login.html'));
    }

    initSidebar();
    await loadStats();
    await loadInventory();
    initSearch();
  }

  // ── Sidebar ────────────────────────────────────────────────
  function initSidebar() {
    const hamBtn   = document.getElementById('hamBtn');
    const sidebar  = document.getElementById('sidebar');
    const sOverlay = document.getElementById('sOverlay');
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') sidebar?.classList.remove('open'); });
  }

  // ── Stats ──────────────────────────────────────────────────
  async function loadStats() {
    try {
      let q = sb.from('medicines').select('id, quantity, price, expiry_date', { count: 'exact' });
      if (pharmacyId) q = q.eq('pharmacy_id', pharmacyId);
      const { data, count } = await q;

      if (!data) return;

      const total    = count || 0;
      const outStock = data.filter(m => (m.quantity || 0) === 0).length;
      const stockVal = data.reduce((s, m) => s + ((m.quantity || 0) * (m.price || 0)), 0);

      const now      = new Date();
      const in30     = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const expiring = data.filter(m => m.expiry_date && new Date(m.expiry_date) <= in30 && new Date(m.expiry_date) > now).length;

      if (statTotal)    statTotal.textContent    = total.toLocaleString();
      if (statOOS)      statOOS.textContent      = outStock;
      if (statValue)    statValue.textContent    = fmtPKR(stockVal);
      if (statExpiring) statExpiring.textContent = expiring;
    } catch (err) {
      console.error('Stats error:', err);
    }
  }

  // ── Inventory List ─────────────────────────────────────────
  async function loadInventory() {
    showLoading();
    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let q = sb
        .from('medicines')
        .select('id, name, generic_name, batch_id, quantity, expiry_date, price, supplier', { count: 'exact' })
        .order('name', { ascending: true })
        .range(from, to);

      if (pharmacyId)  q = q.eq('pharmacy_id', pharmacyId);
      if (searchQuery) q = q.ilike('name', `%${searchQuery}%`);

      const { data, count, error } = await q;
      if (error) throw error;

      totalCount = count || 0;
      renderRows(data || []);
      renderPagination();
    } catch (err) {
      console.error('Inventory error:', err);
      showEmpty('Failed to load inventory. Please try again.');
    }
  }

  // ── Render Rows ────────────────────────────────────────────
  function renderRows(rows) {
    if (!tbody) return;
    if (!rows.length) { showEmpty('No medicines found.'); return; }

    tbody.innerHTML = rows.map(m => {
      const initial = (m.name || '?')[0].toUpperCase();
      const color   = avatarColor(m.name || '');
      const qty     = m.quantity ?? 0;
      const isLow   = qty > 0 && qty <= LOW_STOCK_THRESHOLD;
      const isOOS   = qty === 0;
      const expWarn = isPast(m.expiry_date) || isExpiringSoon(m.expiry_date);
      const dateStr = fmtDate(m.expiry_date);

      return `
        <tr>
          <td>
            <div class="drug-cell">
              <div class="drug-avatar" style="background:${color}">${initial}</div>
              <div class="drug-info">
                <span class="drug-name">${esc(m.name || '—')}</span>
                <span class="drug-type">${esc(m.generic_name || '')}</span>
              </div>
            </div>
          </td>
          <td>${esc(m.batch_id || '—')}</td>
          <td>
            <div class="qty-cell">
              <span class="qty-num ${isOOS ? 'red' : ''}">${qty.toLocaleString()}</span>
              <span class="qty-unit">UNITS</span>
              ${isLow && !isOOS ? '<span class="badge-low">Low</span>' : ''}
              ${isOOS ? '<span class="badge-low" style="color:var(--red);background:#fef2f2;border-color:#fecaca">OOS</span>' : ''}
            </div>
          </td>
          <td class="${expWarn ? 'expiry-warn' : ''}">${dateStr}</td>
          <td>${esc(m.supplier || '—')}</td>
        </tr>`;
    }).join('');
  }

  function esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function showLoading() {
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="table-state">
          <div class="spinner"></div>
          <p>Loading inventory…</p>
        </div>
      </td></tr>`;
  }

  function showEmpty(msg) {
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="5">
        <div class="table-state">
          <i class="fa-regular fa-folder-open"></i>
          <p>${esc(msg)}</p>
        </div>
      </td></tr>`;
  }

  // ── Pagination ─────────────────────────────────────────────
  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const from       = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const to         = Math.min(currentPage * PAGE_SIZE, totalCount);

    if (pgInfo) pgInfo.textContent = `Showing ${from}–${to} of ${totalCount.toLocaleString()} items`;

    if (!pgControls) return;

    // Build page buttons: prev, up to 5 pages, next
    const pages = buildPageRange(currentPage, totalPages);
    pgControls.innerHTML = `
      <button class="pg-btn" id="pgPrev" ${currentPage <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      ${pages.map(p => p === '…'
        ? `<span class="pg-btn" style="cursor:default">…</span>`
        : `<button class="pg-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`
      ).join('')}
      <button class="pg-btn" id="pgNext" ${currentPage >= totalPages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`;

    pgControls.querySelector('#pgPrev')?.addEventListener('click', () => goTo(currentPage - 1));
    pgControls.querySelector('#pgNext')?.addEventListener('click', () => goTo(currentPage + 1));
    pgControls.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => goTo(Number(btn.dataset.page)));
    });
  }

  function buildPageRange(cur, total) {
    if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
    const pages = [];
    pages.push(1);
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
    loadInventory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Search ─────────────────────────────────────────────────
  function initSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        currentPage = 1;
        loadInventory();
      }, 350);
    });
  }

  // ── Boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
