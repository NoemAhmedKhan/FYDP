// ==========================================
//  MEDIFINDER PHARMACIST ALERTS — v2
//  Live Supabase integration
// ==========================================
'use strict';

/* ─────────────────────────────────────────
   1. SUPABASE CLIENT
   ───────────────────────────────────────── */
const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────
   2. STATE
   ───────────────────────────────────────── */
const PAGE_SIZE = 10;

let _pharmacyId       = null;   // resolved once on init
let _currentUser      = null;

let _lowPage          = 1;
let _lowTotal         = 0;

let _expPage          = 1;
let _expTotal         = 0;

/* ─────────────────────────────────────────
   3. DOM HELPERS
   ───────────────────────────────────────── */
const $       = id => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v ?? ''; };

function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const f = parts[0]?.[0] || '';
  const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (f + l).toUpperCase() || '?';
}

/* ─────────────────────────────────────────
   4. SIDEBAR (mirrors PharmInfoUpdate)
   ───────────────────────────────────────── */
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
}

function renderSidebarAvatar(imageUrl, initialsText) {
  const container = $('sidebarAvatarInner');
  if (!container) return;
  container.innerHTML = '';

  if (imageUrl) {
    const img = document.createElement('img');
    img.alt   = 'Avatar';
    img.onerror = () => {
      container.innerHTML = '';
      const span = document.createElement('span');
      span.className   = 's-avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    };
    img.src = imageUrl;
    container.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className   = 's-avatar-initials-text';
    span.textContent = initialsText || '?';
    container.appendChild(span);
  }
}

function initLogout() {
  const btn = $('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.href = 'SignUp.html';
  });
}

/* ─────────────────────────────────────────
   5. SESSION + PHARMACY RESOLUTION
   ───────────────────────────────────────── */
async function resolveSession() {
  const { data: { session }, error } = await db.auth.getSession();
  if (error || !session) throw new Error('Not authenticated');
  _currentUser = session.user;

  /* Load sidebar user info in parallel — non-blocking for main content */
  loadSidebarUser(_currentUser.id, _currentUser.email).catch(() => {});

  /* Resolve pharmacy_id for this pharmacist */
  const { data: pharm, error: pharmErr } = await db
    .from('pharmacies')
    .select('id')
    .eq('user_id', _currentUser.id)
    .limit(1)
    .single();

  if (pharmErr || !pharm) throw new Error('Pharmacy not found for this account.');
  _pharmacyId = pharm.id;
}

async function loadSidebarUser(userId, email) {
  const { data } = await db
    .from('profiles')
    .select('full_name, profile_img')
    .eq('user_id', userId)
    .limit(1)
    .single();

  const name     = data?.full_name || '';
  const initials = getInitials(name);
  setText('sidebarName',  name || email || 'Pharmacist');
  setText('sidebarEmail', email || '');
  renderSidebarAvatar(data?.profile_img || null, initials);
}

/* ─────────────────────────────────────────
   6. COUNT QUERIES  (head-only, no row data)
   ───────────────────────────────────────── */
async function fetchLowStockCount() {
  const today = new Date().toISOString().split('T')[0];
  const { count, error } = await db
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', _pharmacyId)
    .filter('box_quantity', 'lte', db.rpc)   // placeholder — see note below
    .gt('expiry_date', today);
  // NOTE: Supabase JS client cannot do column-to-column comparisons natively.
  // We use a workaround: fetch only the needed columns and filter client-side
  // for the count, OR use a small RPC. Since we must avoid adding RPCs without
  // your confirmation, we do a lean select and count client-side (see below).
  return count;
}

/*
  ── IMPORTANT ARCHITECTURE NOTE ──
  Supabase PostgREST does NOT support column-to-column comparisons
  (e.g. box_quantity <= reorder_level) via the JS client filters.
  
  The two clean options are:
  A) Add a small RPC function (recommended — ask you first per your instruction)
  B) Fetch only (box_quantity, reorder_level) columns, no limit,
     and count/filter client-side.

  Since you said "ASK FIRST before adding RPCs", I've chosen option B for the
  counts and page data — lean column selection, client-side column comparison.
  This is efficient because:
  - Only 2 numeric columns per row are fetched for counts
  - Expiry queries fetch only 4 columns
  - Both are scoped to a single pharmacy_id (small result set in practice)

  If you want a proper RPC for this, confirm and I'll write it.
*/

/* ─────────────────────────────────────────
   7. LOW STOCK — DATA FETCH
   ───────────────────────────────────────── */
async function fetchLowStockPage(page) {
  const today  = new Date().toISOString().split('T')[0];
  const offset = (page - 1) * PAGE_SIZE;

  /*
    Join: inventory → products
    Filter: pharmacy_id = _pharmacyId, expiry_date > today
    Columns from inventory: box_quantity, reorder_level, product_id
    Columns from products:  product_name, strength, dosage_form
    Client-side filter: box_quantity <= reorder_level
    
    We fetch a window large enough to get PAGE_SIZE valid rows.
    To keep this efficient we fetch (offset + PAGE_SIZE * 3) rows max
    and slice after filtering — this works well for small pharmacy inventories.
    For very large inventories an RPC is strongly recommended.
  */
  const fetchLimit = PAGE_SIZE * 4;   // buffer for client-side filter

  const { data, error } = await db
    .from('inventory')
    .select(`
      id,
      box_quantity,
      reorder_level,
      products (
        product_name,
        strength,
        dosage_form
      )
    `)
    .eq('pharmacy_id', _pharmacyId)
    .gt('expiry_date', today)
    .order('box_quantity', { ascending: true })
    .range(0, offset + fetchLimit - 1);   // fetch from 0, filter client-side

  if (error) throw new Error('Low stock fetch failed: ' + error.message);

  /* Client-side column comparison: box_quantity <= reorder_level */
  const filtered = (data || []).filter(r => r.box_quantity <= r.reorder_level);

  /* Update total count (best-effort from filtered results) */
  _lowTotal = filtered.length >= offset + fetchLimit
    ? filtered.length   // there may be more; show what we have
    : filtered.length;  // we have them all

  /* Slice the requested page */
  return filtered.slice(offset, offset + PAGE_SIZE);
}

async function fetchLowStockCount() {
  const today = new Date().toISOString().split('T')[0];

  /* Fetch only 2 columns — minimal payload */
  const { data, error } = await db
    .from('inventory')
    .select('box_quantity, reorder_level')
    .eq('pharmacy_id', _pharmacyId)
    .gt('expiry_date', today);

  if (error) return 0;
  return (data || []).filter(r => r.box_quantity <= r.reorder_level).length;
}

/* ─────────────────────────────────────────
   8. NEAR EXPIRY — DATA FETCH
   ───────────────────────────────────────── */
async function fetchNearExpiryCount() {
  const today   = new Date().toISOString().split('T')[0];
  const in30    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { count, error } = await db
    .from('inventory')
    .select('id', { count: 'exact', head: true })
    .eq('pharmacy_id', _pharmacyId)
    .gt('expiry_date', today)
    .lte('expiry_date', in30);

  if (error) return 0;
  return count || 0;
}

async function fetchNearExpiryPage(page) {
  const today   = new Date().toISOString().split('T')[0];
  const in30    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const offset  = (page - 1) * PAGE_SIZE;

  const { data, error } = await db
    .from('inventory')
    .select(`
      id,
      expiry_date,
      batch_no,
      products (
        product_name,
        strength,
        dosage_form
      )
    `)
    .eq('pharmacy_id', _pharmacyId)
    .gt('expiry_date', today)
    .lte('expiry_date', in30)
    .order('expiry_date', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw new Error('Near expiry fetch failed: ' + error.message);
  return data || [];
}

/* ─────────────────────────────────────────
   9. DATE HELPERS
   ───────────────────────────────────────── */
function daysUntil(dateStr) {
  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const expDate   = new Date(dateStr); expDate.setHours(0, 0, 0, 0);
  return Math.round((expDate - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function expiryStatusInfo(days) {
  if (days <= 10) return { cls: 'exp-status--critical', icon: 'fa-solid fa-circle-exclamation' };
  if (days <= 20) return { cls: 'exp-status--warning',  icon: 'fa-solid fa-triangle-exclamation' };
  return               { cls: 'exp-status--safe',     icon: 'fa-regular fa-clock' };
}

/* ─────────────────────────────────────────
   10. RENDER — LOW STOCK LIST
   ───────────────────────────────────────── */
function renderLowStock(items) {
  const list = $('lowStockList');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<li class="empty-state"><i class="fa-solid fa-circle-check"></i> No low stock items. All products are adequately stocked.</li>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const p = item.products || {};
    const li = document.createElement('li');
    li.className = 'stock-item';

    const level = item.box_quantity === 0 ? 'red' : 'amber';

    li.innerHTML =
      '<div class="stock-info">' +
        '<p class="stock-name">' + escHtml(p.product_name || '—') + '</p>' +
        '<p class="stock-sub">'  + escHtml((p.strength || '') + (p.dosage_form ? ' · ' + p.dosage_form : '')) + '</p>' +
      '</div>' +
      '<div class="stock-item-right">' +
        '<span class="qty-pill qty-pill--' + level + '">' + item.box_quantity + ' Units</span>' +
        '<span class="threshold">' + item.reorder_level + ' Units</span>' +
      '</div>';
    fragment.appendChild(li);
  });
  list.innerHTML = '';
  list.appendChild(fragment);
}

/* ─────────────────────────────────────────
   11. RENDER — NEAR EXPIRY LIST
   ───────────────────────────────────────── */
function renderNearExpiry(items) {
  const list = $('expiryList');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<li class="empty-state"><i class="fa-solid fa-circle-check"></i> No products expiring within the next 30 days.</li>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const p    = item.products || {};
    const days = daysUntil(item.expiry_date);
    const info = expiryStatusInfo(days);

    const li = document.createElement('li');
    li.className = 'expiry-item';
    li.innerHTML =
      '<div class="exp-name-wrap">' +
        '<p class="exp-name">'  + escHtml(p.product_name || '—') + '</p>' +
        '<p class="exp-sub">'   + escHtml((p.strength || '') + (p.dosage_form ? ' · ' + p.dosage_form : '')) + '</p>' +
      '</div>' +
      '<p class="exp-batch">' + escHtml(item.batch_no || '—') + '</p>' +
      '<p class="exp-date">'  + formatDate(item.expiry_date)   + '</p>' +
      '<p class="exp-status ' + info.cls + '">' +
        '<i class="' + info.icon + '" aria-hidden="true"></i> ' + days + ' days left' +
      '</p>';
    fragment.appendChild(li);
  });
  list.innerHTML = '';
  list.appendChild(fragment);
}

/* ─────────────────────────────────────────
   12. PAGINATION CONTROLS
   ───────────────────────────────────────── */
function renderPagination(containerId, currentPage, totalItems, onPageChange) {
  const container = $(containerId);
  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '<div class="pagination">';
  html += '<button class="pg-btn pg-prev" ' + (currentPage <= 1 ? 'disabled' : '') + '>'
        + '<i class="fa-solid fa-chevron-left"></i></button>';

  /* Show max 5 page buttons around current */
  const start = Math.max(1, currentPage - 2);
  const end   = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) {
    html += '<button class="pg-btn pg-num ' + (i === currentPage ? 'active' : '') + '" data-page="' + i + '">' + i + '</button>';
  }

  html += '<button class="pg-btn pg-next" ' + (currentPage >= totalPages ? 'disabled' : '') + '>'
        + '<i class="fa-solid fa-chevron-right"></i></button>';
  html += '</div>';

  container.innerHTML = html;

  container.querySelector('.pg-prev')?.addEventListener('click', () => onPageChange(currentPage - 1));
  container.querySelector('.pg-next')?.addEventListener('click', () => onPageChange(currentPage + 1));
  container.querySelectorAll('.pg-num').forEach(btn => {
    btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page, 10)));
  });
}

/* ─────────────────────────────────────────
   13. SECTION LOADERS
   ───────────────────────────────────────── */
function setListLoading(listId, cols) {
  const list = $(listId);
  if (list) list.innerHTML = '<li class="list-loading"><span class="spinner"></span> Loading…</li>';
}

async function loadLowStock(page) {
  _lowPage = page;
  setListLoading('lowStockList');

  try {
    const items = await fetchLowStockPage(page);
    renderLowStock(items);
    renderPagination('lowStockPagination', page, _lowTotal, loadLowStock);
  } catch (err) {
    console.error('[Alerts] Low stock load error:', err);
    const list = $('lowStockList');
    if (list) list.innerHTML = '<li class="empty-state error">Failed to load low stock data.</li>';
  }
}

async function loadNearExpiry(page) {
  _expPage = page;
  setListLoading('expiryList');

  try {
    const items = await fetchNearExpiryPage(page);
    renderNearExpiry(items);
    renderPagination('expiryPagination', page, _expTotal, loadNearExpiry);
  } catch (err) {
    console.error('[Alerts] Near expiry load error:', err);
    const list = $('expiryList');
    if (list) list.innerHTML = '<li class="empty-state error">Failed to load expiry data.</li>';
  }
}

/* ─────────────────────────────────────────
   14. SUMMARY BANNERS
   ───────────────────────────────────────── */
async function loadSummaryBanners() {
  /* Both counts fire in parallel */
  const [lowCount, expCount] = await Promise.all([
    fetchLowStockCount(),
    fetchNearExpiryCount()
  ]);

  _lowTotal = lowCount;
  _expTotal = expCount;

  setText('summaryLowCount', String(lowCount));
  setText('summaryExpCount', String(expCount));
}

/* ─────────────────────────────────────────
   15. XSS HELPER
   ───────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────
   16. INIT
   ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  initSidebar();
  initLogout();

  try {
    await resolveSession();

    /* Load counts (banners) + first page of both lists in parallel */
    await Promise.all([
      loadSummaryBanners(),
      loadLowStock(1),
      loadNearExpiry(1)
    ]);

    /* After banners loaded, re-render pagination with correct totals */
    renderPagination('lowStockPagination', 1, _lowTotal, loadLowStock);
    renderPagination('expiryPagination',   1, _expTotal, loadNearExpiry);

  } catch (err) {
    console.error('[Alerts] Init error:', err);
    if (err.message === 'Not authenticated') {
      window.location.href = 'SignUp.html';
    }
  }
});
