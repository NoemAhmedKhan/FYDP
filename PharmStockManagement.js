// ============================================================
//  PharmStockManagement.js — MediFinder Stock Management v2
//  Tables: products + inventory (via pharmacy_inventory_view)
//  Auth-guarded: pharmacist role required.
// ============================================================

(function () {
  'use strict';

  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── Config ──────────────────────────────────────────────────
  const PAGE_SIZE            = 20;
  const EDGE_FN_URL          = 'https://ktzsshlllyjuzphprzso.supabase.co/functions/v1/upload-stock';
  const TEMPLATE_BUCKET      = 'csv-templates';
  const TEMPLATE_FILE        = 'stock_template.csv';

  // ── Required CSV headers ────────────────────────────────────
  const CSV_REQUIRED_HEADERS = [
    'product_name','brand','category','generic_name','strength',
    'dosage_form','release_type','manufacturer','batch_no',
    'supplier_name','purchase_price','original_price','discounted_price',
    'pack_size','box_quantity','loose_units','prescription_required',
    'reorder_level','manufacture_date','expiry_date'
  ];

  const CSV_REQUIRED_FIELDS = ['product_name'];

  // ── State ───────────────────────────────────────────────────
  let currentPage    = 1;
  let totalCount     = 0;
  let searchQuery    = '';
  let filterStatus   = '';
  let searchTimer    = null;
  let pharmacyId     = null;
  let sessionToken   = null;
  let parsedCSVRows  = [];   // client-validated clean rows for preview
  let csvHasErrors   = false;
  let csvHasNARows   = false; // rows with N/A in strict optional fields

  // ── Avatar palette ──────────────────────────────────────────
  const COLORS = [
    '#208B3A','#3b82f6','#7c3aed','#f59e0b',
    '#ef4444','#06b6d4','#ec4899','#84cc16'
  ];

  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  // ── Format helpers ──────────────────────────────────────────
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
    if (n >= 1_000)     return 'PKR ' + (n / 1_000).toFixed(1)     + 'K';
    return 'PKR ' + n.toLocaleString();
  }

  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function norm(s) { return (s ?? '').toString().trim(); }
  function normUp(s) { return norm(s).toUpperCase(); }

  function fileSize(bytes) {
    if (bytes < 1024)       return bytes + ' B';
    if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ── Toast ───────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
  }

  // ── DOM helper ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ── Avatar Helpers (matching PharmInfoUpdate pattern) ─────────
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
    const img = document.createElement('img');
    img.alt = 'Avatar';
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
  // ══════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════
  async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }

    sessionToken = session.access_token;
    const userId = session.user.id;

    const { data: userRow } = await sb.from('users').select('role').eq('id', userId).single();
    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    const { data: profile } = await sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single();
    const { data: pharmacy } = await sb.from('pharmacies').select('id').eq('user_id', userId).single();

    pharmacyId = pharmacy?.id || null;

const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
const email       = session.user.email || '';

// Sidebar user footer — matches PharmInfoUpdate pattern
const nameEl  = $('sidebarName');
const emailEl = $('sidebarEmail');
if (nameEl)  nameEl.textContent  = displayName;
if (emailEl) emailEl.textContent = email;

// Sidebar avatar — initials
renderSidebarAvatar(profile?.profile_img || null, getInitials(displayName));

// Logout — wire to #logoutBtn
const logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () =>
    sb.auth.signOut().then(() => { window.location.href = 'Login.html'; })
  );
}

    initSidebar();
    initSearch();
    initModals();
    await loadStats();
    await loadInventory();
  }

  // ── Sidebar ─────────────────────────────────────────────────
  function initSidebar() {
    const hamBtn   = $('hamBtn');
    const sidebar  = $('sidebar');
    const sOverlay = $('sOverlay');
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        sidebar?.classList.remove('open');
        closeAllModals();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  STATS (via RPC)
  // ══════════════════════════════════════════════════════════════
  async function loadStats() {
    if (!pharmacyId) return;
    try {
      const { data, error } = await sb.rpc('get_inventory_stats', { p_pharmacy_id: pharmacyId });
      if (error) throw error;

      const d = data || {};
      if ($('statTotal'))    $('statTotal').textContent    = (d.total_items   ?? 0).toLocaleString();
      if ($('statOOS'))      $('statOOS').textContent      = (d.out_of_stock  ?? 0).toLocaleString();
      if ($('statLowStock')) $('statLowStock').textContent = `${d.low_stock ?? 0} low stock items`;
      if ($('statValue'))    $('statValue').textContent    = fmtPKR(d.stock_value ?? 0);
      if ($('statExpiring')) $('statExpiring').textContent = (d.avg_days_expiry ?? '—').toString();
      if ($('statExpiringLbl')) $('statExpiringLbl').textContent = `${d.expiring_30 ?? 0} expiring in 30 days`;
    } catch (err) {
      console.error('Stats error:', err);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  INVENTORY LIST
  // ══════════════════════════════════════════════════════════════
  async function loadInventory() {
    showLoading();
    try {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to   = from + PAGE_SIZE - 1;

      let q = sb
        .from('pharmacy_inventory_view')
        .select('*', { count: 'exact' })
        .eq('pharmacy_id', pharmacyId)
        .order('product_name', { ascending: true })
        .range(from, to);

      if (searchQuery) {
        q = q.or(`product_name.ilike.%${searchQuery}%,generic_name.ilike.%${searchQuery}%`);
      }

      // Status filters (applied client-side for simplicity after fetch)
      const { data, count, error } = await q;
      if (error) throw error;

      totalCount = count || 0;
      let rows = data || [];

      // Client-side status filter
      if (filterStatus === 'oos')      rows = rows.filter(r => r.box_quantity === 0 && (r.loose_units ?? 0) === 0);
      if (filterStatus === 'low')      rows = rows.filter(r => r.box_quantity > 0 && r.box_quantity <= r.reorder_level);
      if (filterStatus === 'expiring') rows = rows.filter(r => isExpiringSoon(r.expiry_date));

      renderRows(rows);
      renderPagination();
    } catch (err) {
      console.error('Inventory load error:', err);
      showEmpty('Failed to load inventory. Please try again.');
    }
  }

  // ── Render Rows ─────────────────────────────────────────────
  function renderRows(rows) {
    const tbody = $('invTbody');
    if (!tbody) return;
    if (!rows.length) { showEmpty('No medicines found.'); return; }

    tbody.innerHTML = rows.map(m => {
      const initial = (m.product_name || '?')[0].toUpperCase();
      const color   = avatarColor(m.product_name || '');
      const boxQty  = m.box_quantity ?? 0;
      const loose   = m.loose_units  ?? 0;
      const packSz  = m.pack_size    ?? 1;
      const totalUnits = (boxQty * packSz) + loose;
      const isLow   = boxQty > 0 && boxQty <= (m.reorder_level ?? 10);
      const isOOS   = boxQty === 0 && loose === 0;
      const expWarn = isPast(m.expiry_date) || isExpiringSoon(m.expiry_date);

      const discRow = m.discounted_price
        ? `<span class="price-disc">Disc: PKR ${Number(m.discounted_price).toLocaleString()}</span>`
        : '';

      const rxBadge = m.prescription_required
        ? `<span class="badge-rx">Rx</span>`
        : '';

      return `
        <tr data-id="${m.id}">
          <td>
            <div class="drug-cell">
              <div class="drug-avatar" style="background:${color}">${initial}</div>
              <div class="drug-info">
                <span class="drug-name" title="${esc(m.product_name || '')}">
                  ${esc(m.product_name || '—')}
                </span>
                <span class="drug-type">${esc(m.generic_name || '')} · ${esc(m.strength || '')} · ${esc(m.dosage_form || '')}</span>
              </div>
            </div>
          </td>
          <td>${esc(m.batch_no || '—')}</td>
          <td>
            <div class="qty-cell">
              <span class="qty-num ${isOOS ? 'red' : ''}">${boxQty}</span>
              <span class="qty-unit">BOXES</span>
              ${loose > 0 ? `<span class="qty-loose">+${loose} loose</span>` : ''}
              ${isLow && !isOOS ? '<span class="badge-low">Low</span>' : ''}
              ${isOOS ? '<span class="badge-low" style="color:var(--red);background:#fef2f2;border-color:#fecaca">OOS</span>' : ''}
              ${rxBadge}
            </div>
          </td>
          <td>
            <div class="price-cell">
              <span class="price-orig">PKR ${Number(m.original_price).toLocaleString()}</span>
              ${discRow}
            </div>
          </td>
          <td class="${expWarn ? 'expiry-warn' : ''}">${fmtDate(m.expiry_date)}</td>
          <td>${esc(m.supplier_name || '—')}</td>
          <td>
            <div class="action-cell">
              <button class="act-btn" title="Edit item"
                onclick="openEditModal('${m.id}','${esc(m.product_name)}',${boxQty},${loose},${m.reorder_level},
                  '${esc(m.supplier_name||'')}',${m.purchase_price||'null'},${m.original_price},${m.discounted_price||'null'},
                  '${m.expiry_date||''}',${m.prescription_required ? 'true' : 'false'},${packSz})">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="act-btn act-btn-danger" title="Delete this item"
                onclick="openDeleteItemModal('${m.id}','${esc(m.product_name)}','${esc(m.batch_no||'')}')">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function showLoading() {
    const tbody = $('invTbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="table-state">
          <div class="spinner"></div>
          <p>Loading inventory…</p>
        </div>
      </td></tr>`;
  }

  function showEmpty(msg) {
    const tbody = $('invTbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="table-state">
          <i class="fa-regular fa-folder-open"></i>
          <p>${esc(msg)}</p>
        </div>
      </td></tr>`;
  }

  // ── Pagination ──────────────────────────────────────────────
  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const from       = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const to         = Math.min(currentPage * PAGE_SIZE, totalCount);
    const pgInfo     = $('pgInfo');
    const pgControls = $('pgControls');

    if (pgInfo) pgInfo.textContent = `Showing ${from}–${to} of ${totalCount.toLocaleString()} items`;
    if (!pgControls) return;

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
    pgControls.querySelectorAll('[data-page]').forEach(btn =>
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
    loadInventory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Search & Filter ─────────────────────────────────────────
  function initSearch() {
    const searchInput  = $('searchInput');
    const filterSelect = $('filterStatus');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          currentPage = 1;
          loadInventory();
        }, 350);
      });
    }

    if (filterSelect) {
      filterSelect.addEventListener('change', () => {
        filterStatus = filterSelect.value;
        currentPage  = 1;
        loadInventory();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CLIENT-SIDE CSV VALIDATION
  // ══════════════════════════════════════════════════════════════
  function isValidDate(s) {
    if (!s) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s);
    return !isNaN(d.getTime());
  }

  function isPosNum(s) { const n = Number(s); return !isNaN(n) && n > 0; }
  function isNonNegNum(s) { const n = Number(s); return !isNaN(n) && n >= 0; }

  // ── Valid enum sets for CSV validation ──────────────────────
  const VALID_DOSAGE_FORMS_SET = new Set([
    'TABLET','CAPSULE','SYRUP','DROPS','INJECTION','INFUSION',
    'CREAM','OINTMENT','LOTION','GEL','SPRAY','SOLUTION',
    'SUSPENSION','SACHET','SOFTGEL','POWDER','PATCH',
    'SUPPOSITORY','INHALER','FACE WASH','SHAMPOO','SOAP',
    'TOOTHPASTE','OIL', 'GUMMIES', 'FOOD', 'SERUM'
  ]);

  const VALID_RELEASE_TYPES_SET = new Set([
    'IMMEDIATE RELEASE','EXTENDED RELEASE','SUSTAINED RELEASE',
    'MODIFIED RELEASE','DELAYED RELEASE','CONTROLLED RELEASE',''
  ]);

  function validateCSVRow(raw, rowIndex) {
    const errors = [];
    const addErr = (field, code, message, value = '') =>
      errors.push({ row: rowIndex, field, code, message, value: String(value) });

    // ── Required fields ─────────────────────────────────────
    for (const f of CSV_REQUIRED_FIELDS) {
      if (!norm(raw[f])) addErr(f, 'E-REQ', 'Required field is empty');
    }
    if (errors.length) return { errors, clean: null };

    // ── E17/E18 — dosage_form enum (N/A allowed with disclaimer) ──
    const dfVal = normUp(raw.dosage_form);
    if (dfVal !== 'N/A' && !VALID_DOSAGE_FORMS_SET.has(dfVal))
      addErr('dosage_form', 'E17',
        `Invalid dosage form. Allowed: ${[...VALID_DOSAGE_FORMS_SET].join(', ')} or N/A`, raw.dosage_form);

    // ── E19 — release_type required (N/A allowed with disclaimer) ──
    const rtVal = normUp(raw.release_type);
    if (rtVal !== 'N/A' && (!VALID_RELEASE_TYPES_SET.has(rtVal) || rtVal === ''))
      addErr('release_type', 'E19',
        `Required. Allowed: ${[...VALID_RELEASE_TYPES_SET].filter(Boolean).join(' | ')} or N/A`,
        raw.release_type);

   // ── category: normalize separators and special chars ─────
    // Allowed: letters, numbers, spaces, + and ,
    // & → +  |  AND/and → +  |  hyphen → space  |  other specials removed
    let catVal = normUp(raw.category);
    catVal = catVal.replace(/\s*&\s*/g, ' + ');
    catVal = catVal.replace(/\bAND\b/g, '+');
    catVal = catVal.replace(/-/g, ' ');
    catVal = catVal.replace(/[^A-Z0-9\s\+,\.]/g, '');
    catVal = catVal.replace(/\s+/g, ' ').trim();

    // ── E08/E09/E11 — generic_name separator spacing ─────────
    // ── generic_name: normalize separators and special chars ─
    // Allowed: letters, numbers, spaces, + and ,
    // & → +  |  AND/and → +  |  hyphen → space  |  other specials removed
    let gnVal = normUp(raw.generic_name);
    gnVal = gnVal.replace(/\s*&\s*/g, ' + ');
    gnVal = gnVal.replace(/\bAND\b/g, '+');
    gnVal = gnVal.replace(/-/g, ' ');
    gnVal = gnVal.replace(/\s*\/\s*/g, ' + ');
    gnVal = gnVal.replace(/\s*\+\s*/g, ' + ');
    gnVal = gnVal.replace(/\s*,\s*/g, ', ');
    gnVal = gnVal.replace(/[^A-Z0-9\s\+,\.]/g, '');
    gnVal = gnVal.replace(/\s+/g, ' ').replace(/[\s,+]+$/, '').trim();
    
    // ── strength: normalize then validate unit ────────────────
    let stVal = normUp(raw.strength);
    stVal = stVal.replace(/\s*\/\s*/g, '/');
    stVal = stVal.replace(/(\d)\s+(BILLION\s?CFU|MCG\/ACTUATION|G\/100ML|MG\/5ML|CCID50|TCID50|MG\/M²|MG\/M2|MG\/KG|KG\/NG|MG\/ML|KG\/L|MG\/G|MCG|MIU|MEQ|CFU|IU|ML|LF|NG|KG|MG|G|U|L|%)(\b|\/)/gi, '$1$2$3');
    stVal = stVal.trim();

    const STRENGTH_UNIT_RE = /\d(BILLION\s?CFU|MCG\/ACTUATION|G\/100ML|MG\/5ML|CCID50|TCID50|MG\/M²|MG\/M2|MG\/KG|KG\/NG|MG\/ML|KG\/L|MG\/G|MCG|MIU|MEQ|CFU|IU|ML|LF|NG|KG|MG|G|U|L|%)/i;
    if (stVal !== 'N/A' && !STRENGTH_UNIT_RE.test(stVal))
      addErr('strength', 'E13',
        'Strength must include a valid unit (MG, MCG, G, ML, IU, MIU, CFU, BILLION CFU, CCID50, TCID50, LF, MG/KG, MG/M², KG/NG, KG/L, MEQ, KG, NG, U, L, %) or N/A',
        stVal);
    
    // ── Numeric type checks ───────────────────────────────────
    if (!isPosNum(raw.original_price))
      addErr('original_price', 'E30', 'Must be a positive number (e.g. 65.00)', raw.original_price);

    if (norm(raw.purchase_price) && !isNonNegNum(raw.purchase_price))
      addErr('purchase_price', 'E27', 'Must be a non-negative number (e.g. 45.00)', raw.purchase_price);

    if (norm(raw.discounted_price) && !isNonNegNum(raw.discounted_price))
      addErr('discounted_price', 'E32', 'Must be a non-negative number', raw.discounted_price);

    if (!isPosNum(raw.pack_size) || !Number.isInteger(Number(raw.pack_size)))
      addErr('pack_size', 'E35', 'Must be a positive whole number (e.g. 10)', raw.pack_size);

    if (!isNonNegNum(raw.box_quantity) || !Number.isInteger(Number(raw.box_quantity)))
      addErr('box_quantity', 'E38', 'Must be a non-negative whole number (e.g. 50)', raw.box_quantity);

    if (!isNonNegNum(raw.loose_units) || !Number.isInteger(Number(raw.loose_units)))
      addErr('loose_units', 'E39', 'Must be a non-negative whole number (e.g. 0)', raw.loose_units);

    // ── E41 — prescription_required must be YES or NO ────────
    const prVal = normUp(raw.prescription_required);
    if (!['YES','NO'].includes(prVal))
      addErr('prescription_required', 'E41',
        'Must be exactly YES or NO (uppercase)', raw.prescription_required);

    // ── E42/E43 — reorder_level ≥ 1 ─────────────────────────
    const rlNum = Number(raw.reorder_level);
    if (!Number.isInteger(rlNum) || rlNum < 1)
      addErr('reorder_level', 'E42',
        'Must be a positive integer ≥ 1', raw.reorder_level);

    // ── Date format checks ────────────────────────────────────
    if (!isValidDate(norm(raw.expiry_date)))
      addErr('expiry_date', 'E47', 'Invalid date — use YYYY-MM-DD format (e.g. 2027-06-30)', raw.expiry_date);

    if (norm(raw.manufacture_date) && !isValidDate(norm(raw.manufacture_date)))
      addErr('manufacture_date', 'E44', 'Invalid date — use YYYY-MM-DD format (e.g. 2024-01-15)', raw.manufacture_date);

    if (errors.length) return { errors, clean: null };

    // ── Business rules ────────────────────────────────────────
    const origPrice  = Number(norm(raw.original_price));
    const discPrice  = norm(raw.discounted_price)  ? Number(norm(raw.discounted_price))  : null;
    const purchPrice = norm(raw.purchase_price)    ? Number(norm(raw.purchase_price))    : null;
    const expiry     = new Date(norm(raw.expiry_date));
    const mfgDate    = norm(raw.manufacture_date)  ? new Date(norm(raw.manufacture_date)) : null;
    const today      = new Date(); today.setHours(0,0,0,0);
    const boxQty     = Number(norm(raw.box_quantity));
    const looseUnits = Number(norm(raw.loose_units));
    const packSize   = Number(norm(raw.pack_size));

    if (discPrice !== null && discPrice > origPrice)
      addErr('discounted_price', 'E33',
        `Discounted price (${discPrice}) cannot exceed original price (${origPrice})`, raw.discounted_price);

    if (purchPrice !== null && purchPrice > origPrice)
      addErr('purchase_price', 'E28',
        `Purchase price (${purchPrice}) should not exceed original price (${origPrice})`, raw.purchase_price);

    if (mfgDate && mfgDate >= expiry)
      addErr('manufacture_date', 'E46', 'Manufacture date must be before expiry date', raw.manufacture_date);

    if (mfgDate && mfgDate >= today)
      addErr('manufacture_date', 'E45', 'Manufacture date must be in the past', raw.manufacture_date);

    // E40 — loose_units must be < pack_size
    if (!isNaN(looseUnits) && !isNaN(packSize) && packSize > 0 && looseUnits >= packSize)
      addErr('loose_units', 'E40',
        `Loose units (${looseUnits}) must be less than pack size (${packSize}). Consolidate into boxes.`,
        raw.loose_units);

    if (errors.length) return { errors, clean: null };

    return {
      errors: [],
      clean: {
        product_name:          (() => {
            let p = normUp(raw.product_name);
            p = p.replace(/-+/g, ' ');           // hyphen → space
            p = p.replace(/[^A-Z0-9\s]/g, ' ');  // strip remaining specials
            p = p.replace(/\s+/g, ' ').trim();   // collapse spaces
            return p;
          })(),
        brand:                 normUp(raw.brand),
        category:              catVal,
        generic_name:          gnVal,
        strength:              stVal,
        dosage_form:           normUp(raw.dosage_form),
        release_type:          normUp(raw.release_type),
        manufacturer:          normUp(raw.manufacturer),
        batch_no:              normUp(raw.batch_no),
        supplier_name:         normUp(raw.supplier_name),
        purchase_price:        purchPrice,
        original_price:        origPrice,
        discounted_price:      discPrice,
        pack_size:             packSize,
        box_quantity:          boxQty,
        loose_units:           looseUnits,
        prescription_required: prVal,             // keep as 'YES' or 'NO' string for Edge Function
        reorder_level:         rlNum,
        manufacture_date:      norm(raw.manufacture_date) || null,
        expiry_date:           norm(raw.expiry_date),
      }
    };
  }

  function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return { error: 'CSV must have at least one data row.' };

    // FIXED — replace ALL whitespace (including \t) before normalizing
    const headers = lines[0].split(',').map(h => h.replace(/\s+/g, '').toLowerCase());

    // Header check
    const missing = CSV_REQUIRED_HEADERS.filter(h => !headers.includes(h));
    if (missing.length) {
      return { error: `Missing required columns: ${missing.join(', ')}` };
    }

    const extra = headers.filter(h => h && !CSV_REQUIRED_HEADERS.includes(h));
    if (extra.length) {
       return { error: `Unexpected columns: ${extra.join(', ')}. Headers must exactly match the template.` };
    }

    if (lines.length - 1 > 500) {
      return { error: 'Maximum 500 data rows allowed per upload.' };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      // Simple CSV parse (handles basic cases)
      const values = parseCSVLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = values[idx] ?? ''; });
      rows.push({ raw: obj, lineNum: i + 1 });
    }

    return { rows };
  }

  function parseCSVLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ══════════════════════════════════════════════════════════════
  //  MODALS
  // ══════════════════════════════════════════════════════════════
  function closeAllModals() {
    ['modalAddBackdrop','modalBulkBackdrop','modalEditBackdrop'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('open');
    });
  }

  function openModal(backdropId) {
    const el = $(backdropId);
    if (el) el.classList.add('open');
  }

  function initModals() {
    // ── Add Item ──
    $('btnAddItem')?.addEventListener('click', () => {
      resetAddForm();
      openModal('modalAddBackdrop');
    });
    $('modalAddClose')?.addEventListener('click',   () => $('modalAddBackdrop')?.classList.remove('open'));
    $('modalAddCancel')?.addEventListener('click',  () => $('modalAddBackdrop')?.classList.remove('open'));
    $('modalAddBackdrop')?.addEventListener('click', e => {
      if (e.target === $('modalAddBackdrop')) $('modalAddBackdrop').classList.remove('open');
    });
    $('btnSubmitAdd')?.addEventListener('click', handleAddItem);

    // ── Bulk Upload ──
    $('btnBulkUpload')?.addEventListener('click', () => {
      resetBulkModal();
      openModal('modalBulkBackdrop');
    });
    $('modalBulkClose')?.addEventListener('click',   () => $('modalBulkBackdrop')?.classList.remove('open'));
    $('modalBulkCancel')?.addEventListener('click',  () => $('modalBulkBackdrop')?.classList.remove('open'));
    $('modalBulkBackdrop')?.addEventListener('click', e => {
      if (e.target === $('modalBulkBackdrop')) $('modalBulkBackdrop').classList.remove('open');
    });

    initDropZone();
    $('btnDownloadTemplate')?.addEventListener('click', handleDownloadTemplate);
    $('btnValidateCSV')?.addEventListener('click',  handleValidateCSV);
    $('btnUploadCSV')?.addEventListener('click',    handleUploadCSV);

    // ── Delete All Stock ──
    $('btnDeleteAllStock')?.addEventListener('click', openDeleteAllModal);
    $('modalDeleteAllClose')?.addEventListener('click',  () => closeDeleteAllModal());
    $('modalDeleteAllCancel')?.addEventListener('click', () => closeDeleteAllModal());
    $('modalDeleteAllBackdrop')?.addEventListener('click', e => {
      if (e.target === $('modalDeleteAllBackdrop')) closeDeleteAllModal();
    });

    $('deleteConfirmInput')?.addEventListener('input', () => {
      const val     = $('deleteConfirmInput').value.trim();
      const matches = val === 'DELETE ALL';
      $('btnConfirmDeleteAll').disabled = !matches;
      $('deleteConfirmInput').classList.toggle('match', matches);
    });

    $('btnConfirmDeleteAll')?.addEventListener('click', handleDeleteAllStock);
    $('modalDeleteItemClose')?.addEventListener('click',  () => closeDeleteItemModal());
    $('modalDeleteItemCancel')?.addEventListener('click', () => closeDeleteItemModal());
    $('modalDeleteItemBackdrop')?.addEventListener('click', e => {
      if (e.target === $('modalDeleteItemBackdrop')) closeDeleteItemModal();
    });
    $('btnConfirmDeleteItem')?.addEventListener('click', handleDeleteItem);
    $('modalEditClose')?.addEventListener('click',  () => $('modalEditBackdrop')?.classList.remove('open'));
    $('modalEditCancel')?.addEventListener('click', () => $('modalEditBackdrop')?.classList.remove('open'));
    $('modalEditBackdrop')?.addEventListener('click', e => {
      if (e.target === $('modalEditBackdrop')) $('modalEditBackdrop').classList.remove('open');
    });
    $('btnSubmitEdit')?.addEventListener('click', handleEditSave);
  }

  // ── Drop zone ───────────────────────────────────────────────
  function initDropZone() {
    const dropZone     = $('dropZone');
    const fileInput    = $('csvFileInput');
    const fileSelected = $('fileSelected');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file) processFileSelection(file);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) processFileSelection(fileInput.files[0]);
    });

    $('btnRemoveFile')?.addEventListener('click', () => {
      fileInput.value = '';
      if (fileSelected)     fileSelected.style.display = 'none';
      if (dropZone)         dropZone.style.display = 'flex';
      $('stepValidate').style.display    = 'none';
      $('btnValidateCSV').style.display  = 'none';
      $('btnUploadCSV').style.display    = 'none';
      parsedCSVRows = [];
      csvHasErrors  = false;
    });
  }

  function processFileSelection(file) {
    if (!file.name.endsWith('.csv')) {
      showToast('Please select a .csv file', 'error');
      return;
    }

    $('fileSelectedName').textContent = file.name;
    $('fileSelectedSize').textContent = fileSize(file.size);
    $('fileSelected').style.display   = 'flex';
    $('dropZone').style.display       = 'none';
    $('stepValidate').style.display   = 'none';
    $('btnValidateCSV').style.display = 'inline-flex';
    $('btnUploadCSV').style.display   = 'none';

    // Store file reference for later
    $('btnValidateCSV')._file = file;
  }

  // ── Download template ────────────────────────────────────────
  async function handleDownloadTemplate() {
    try {
      const { data } = sb.storage.from(TEMPLATE_BUCKET).getPublicUrl(TEMPLATE_FILE);
      if (data?.publicUrl) {
        const a = document.createElement('a');
        a.href     = data.publicUrl;
        a.download = TEMPLATE_FILE;
        a.click();
      } else {
        // Fallback: generate template locally
        const content = CSV_REQUIRED_HEADERS.join(',') + '\n' +
          'PANADOL 500MG TABLET,GLAXOSMITHKLINE PAKISTAN,PAIN RELIEF,PARACETAMOL,500MG,TABLET,IMMEDIATE RELEASE,GLAXOSMITHKLINE PAKISTAN,BAT-7224,MEDSUPPLIERS PVT LTD,45.00,65.00,60.00,10,50,5,YES,10,2024-01-15,2027-01-15\n';
        const blob = new Blob([content], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = TEMPLATE_FILE;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Template download error:', err);
      showToast('Failed to download template', 'error');
    }
  }

  // ── Client-side validate ─────────────────────────────────────
async function handleValidateCSV() {
  const btn  = $('btnValidateCSV');
  const file = btn._file;
  if (!file) return;

  // Reset UI
  $('stepValidate').style.display   = 'block';
  $('valSummary').style.display     = 'none';
  $('errorTableWrap').style.display = 'none';
  $('previewWrap').style.display    = 'none';
  $('btnUploadCSV').style.display   = 'none';
  $('uploadResult').style.display   = 'none';

  const rawText = await file.text();
  const firstLine = rawText.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  const rawHeaders = firstLine.split(',').map(h => h.replace(/\s+/g, '').toLowerCase());
  const missing = CSV_REQUIRED_HEADERS.filter(h => !rawHeaders.includes(h));
  const extra   = rawHeaders.filter(h => h && !CSV_REQUIRED_HEADERS.includes(h));

if (missing.length || extra.length) {
  const parts = [];
  if (missing.length) parts.push(`Missing: ${missing.join(', ')}`);
  if (extra.length)   parts.push(`Unrecognised: ${extra.join(', ')}`);

  $('errorTableWrap').style.display = 'block';
  $('errorTableTitle').textContent  = 'Header mismatch — fix your column names and re-upload';
  $('errorTableBody').innerHTML = `
    <tr class="err-row">
      <td class="row-num">Header</td>
      <td>Column names</td>
      <td class="err-val">—</td>
      <td class="err-msg">${esc(parts.join('. '))}. Column names must exactly match the template.</td>
    </tr>`;
  $('valSummary').style.display     = 'flex';
  $('valChipInvalid').textContent   = '✕ Header mismatch';
  $('valChipInvalid').style.display = 'flex';
  $('valChipValid').style.display   = 'none';
  csvHasErrors  = true;
  parsedCSVRows = [];
  return;   // ← stop here, never reach the transformer
}

  
  // ── Step 1: Run transformer (normalize small messiness) ──────
  const transformed = CSVStockTransformer.transform(rawText);

  // If transformer itself found unfixable issues, show them and stop
  if (transformed.unfixable.length) {
    $('errorTableWrap').style.display = 'block';
    $('errorTableTitle').textContent  = `${transformed.unfixable.length} unfixable error${transformed.unfixable.length !== 1 ? 's' : ''} — fix these in your file and re-upload`;
    $('errorTableBody').innerHTML = transformed.unfixable.map(e => `
      <tr class="err-row">
        <td class="row-num">Row ${e.row}</td>
        <td>${esc(e.field)}</td>
        <td class="err-val" title="${esc(e.value)}">${esc(e.value) || '<em>empty</em>'}</td>
        <td class="err-msg">${esc(e.reason)}</td>
      </tr>`).join('');
    // Also show skipped columns if any
    if (transformed.skippedColumns.length) {
      $('errorTableBody').innerHTML += `
        <tr class="err-row">
          <td class="row-num">Header</td>
          <td>Unknown columns</td>
          <td class="err-val">${esc(transformed.skippedColumns.join(', '))}</td>
          <td class="err-msg">These column names were not recognised and were ignored. Check your file matches the template.</td>
        </tr>`;
    }
    $('valSummary').style.display   = 'flex';
    $('valChipInvalid').textContent = `✕ ${transformed.unfixable.length} unfixable error${transformed.unfixable.length !== 1 ? 's' : ''}`;
    $('valChipInvalid').style.display = 'flex';
    $('valChipValid').style.display   = 'none';
    csvHasErrors  = true;
    parsedCSVRows = [];
    return;
  }

  // ── Step 2: Pass the normalised CSV through existing row validator ──
  const parsed = parseCSV(transformed.csv);

  if (parsed.error) {
    $('errorTableWrap').style.display = 'block';
    $('errorTableTitle').textContent  = 'File error';
    $('errorTableBody').innerHTML = `
      <tr class="err-row">
        <td class="row-num">—</td>
        <td>File</td>
        <td class="err-val">—</td>
        <td class="err-msg">${esc(parsed.error)}</td>
      </tr>`;
    csvHasErrors = true;
    return;
  }

  const allErrors = [];
  const cleanRows = [];

  for (const { raw, lineNum } of parsed.rows) {
    const { errors, clean } = validateCSVRow(raw, lineNum);
    if (errors.length) allErrors.push(...errors);
    else cleanRows.push(clean);
  }

  // Intra-file duplicate detection
  const seen = new Set();
  for (const row of cleanRows) {
    const key = `${row.generic_name}|${row.strength}|${row.dosage_form}|${row.manufacturer}|${row.batch_no}`;
    if (seen.has(key)) {
      allErrors.push({ row: '?', field: 'batch_no', code: 'E23', message: 'Duplicate batch_no for same product in this file', value: row.batch_no });
    }
    seen.add(key);
  }

  // ── Step 3: Show summary ─────────────────────────────────────
  $('valSummary').style.display = 'flex';

  // Show auto-fix note if transformer changed anything (non-intrusive)
  const autoFixed = transformed.warnings.length;
  if (autoFixed) {
    $('valChipValid').textContent  = `✓ ${cleanRows.length} valid row${cleanRows.length !== 1 ? 's' : ''} (${autoFixed} field${autoFixed !== 1 ? 's' : ''} auto-formatted)`;
  } else {
    $('valChipValid').textContent  = `✓ ${cleanRows.length} valid row${cleanRows.length !== 1 ? 's' : ''}`;
  }
  $('valChipValid').style.display = 'flex';

  if (allErrors.length) {
    $('valChipInvalid').textContent  = `✕ ${allErrors.length} error${allErrors.length !== 1 ? 's' : ''}`;
    $('valChipInvalid').style.display = 'flex';

    $('errorTableWrap').style.display = 'block';
    $('errorTableTitle').textContent  = `${allErrors.length} validation error${allErrors.length !== 1 ? 's' : ''} found — fix these in your file and re-upload`;
    $('errorTableBody').innerHTML     = allErrors.map(e => `
      <tr class="err-row">
        <td class="row-num">Row ${e.row}</td>
        <td>${esc(e.field)}${e.code ? ` <span class="err-code">${esc(e.code)}</span>` : ''}</td>
        <td class="err-val" title="${esc(e.value)}">${esc(e.value) || '<em>empty</em>'}</td>
        <td class="err-msg">${esc(e.message)}</td>
      </tr>`).join('');

    csvHasErrors  = true;
    parsedCSVRows = [];

} else {
    // Collect which fields are empty or N/A across all clean rows
const NA_WATCHED_FIELDS = [
  'generic_name', 'strength', 'dosage_form', 'release_type', 'category',
  'manufacturer', 'batch_no', 'original_price', 'expiry_date'
];

const naFieldsFound = new Set();
cleanRows.forEach(r => {
  NA_WATCHED_FIELDS.forEach(f => {
    const v = normUp(String(r[f] ?? ''));
    if (v === 'N/A' || v === '') naFieldsFound.add(f);
  });
});
csvHasNARows = naFieldsFound.size > 0;

    $('previewWrap').style.display  = 'block';
    $('previewTitle').textContent   = `${cleanRows.length} rows ready to upload`;
    $('previewTableBody').innerHTML = cleanRows.slice(0, 10).map(r => `
      <tr>
        <td>${esc(r.product_name)}</td>
        <td>${esc(r.generic_name)}</td>
        <td>${esc(r.strength)}</td>
        <td>${esc(r.batch_no)}</td>
        <td>${r.box_quantity} boxes / ${r.loose_units} loose</td>
        <td>${fmtDate(r.expiry_date)}</td>
      </tr>`).join('') +
      (cleanRows.length > 10
        ? `<tr><td colspan="6" style="text-align:center;color:var(--gray-md);font-style:italic;padding:10px">
             …and ${cleanRows.length - 10} more rows
           </td></tr>`
        : '');

    csvHasErrors  = false;
    parsedCSVRows = cleanRows;

    // Show N/A disclaimer if any rows have N/A
    const naDisclaimerEl = $('naDisclaimer');
const naCheckEl      = $('naDisclaimerCheck');
if (csvHasNARows && naDisclaimerEl) {
  // Inject highlighted field names dynamically
  const fieldTags = [...naFieldsFound]
    .map(f => `<code class="na-field-tag">${f.replace(/_/g, ' ')}</code>`)
    .join(' ');
  $('naDisclaimerFields').innerHTML = fieldTags;

  naDisclaimerEl.style.display = 'block';
  if (naCheckEl) naCheckEl.checked = false;
  $('btnUploadCSV').style.display = 'inline-flex';
  $('btnUploadCSV').disabled      = true;
  naCheckEl?.addEventListener('change', () => {
    $('btnUploadCSV').disabled = !naCheckEl.checked;
  }, { once: true });
} else {
  if (naDisclaimerEl) naDisclaimerEl.style.display = 'none';
  $('btnUploadCSV').style.display = 'inline-flex';
  $('btnUploadCSV').disabled      = false;
}
}
}

  // ── Upload to Edge Function ──────────────────────────────────
  async function handleUploadCSV() {
    if (!parsedCSVRows.length || csvHasErrors) return;

    const uploadBtn   = $('btnUploadCSV');
    const btnText     = $('btnUploadCSVText');
    const btnLoader   = $('btnUploadCSVLoader');
    const progressWrap = $('uploadProgressWrap');
    const progressBar  = $('progressBarFill');
    const progressLbl  = $('progressLabel');
    const resultEl     = $('uploadResult');

    uploadBtn.disabled       = true;
    btnText.style.display    = 'none';
    btnLoader.style.display  = 'inline-flex';
    progressWrap.style.display = 'block';
    resultEl.style.display   = 'none';

    // Animate progress
    let prog = 10;
    progressBar.style.width = prog + '%';
    progressLbl.textContent = 'Sending to server…';

    const progInterval = setInterval(() => {
      if (prog < 85) { prog += 5; progressBar.style.width = prog + '%'; }
    }, 300);

    try {
      const resp = await fetch(EDGE_FN_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ rows: parsedCSVRows, mode: 'csv' })
      });

      clearInterval(progInterval);
      progressBar.style.width = '100%';
      progressLbl.textContent = 'Processing complete';

      const json = await resp.json();

      resultEl.style.display = 'block';

      if (resp.ok && json.success) {
        const s = json.summary;
        resultEl.className = 'upload-result success';
        resultEl.innerHTML = `
          <i class="fa-solid fa-circle-check"></i>
          Upload complete — ${s.inserted} inserted, ${s.updated} updated, ${s.skipped} skipped.`;
        showToast(`Upload complete: ${s.inserted} inserted, ${s.updated} updated`, 'success');
        setTimeout(() => {
          $('modalBulkBackdrop').classList.remove('open');
          loadStats();
          loadInventory();
        }, 1800);
      } else {
        resultEl.className = 'upload-result error';
        if (json.errors && Array.isArray(json.errors)) {
          // Server-side validation errors — show in error table
          $('errorTableWrap').style.display = 'block';
          $('errorTableTitle').textContent  = `${json.errors.length} server validation error${json.errors.length !== 1 ? 's' : ''}`;
          $('errorTableBody').innerHTML = json.errors.map(e => `
            <tr class="err-row">
              <td class="row-num">Row ${e.row}</td>
              <td>${esc(e.field)}</td>
              <td class="err-val">${esc(e.value)}</td>
              <td class="err-msg">${esc(e.message)}</td>
            </tr>`).join('');
          resultEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Upload failed. See errors above.';
        } else {
          resultEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${esc(json.error || 'Upload failed. Please try again.')}`;
        }
        showToast('Upload failed', 'error');
        uploadBtn.disabled      = false;
        btnText.style.display   = 'inline-flex';
        btnLoader.style.display = 'none';
      }
    } catch (err) {
      clearInterval(progInterval);
      console.error('Upload error:', err);
      resultEl.style.display = 'block';
      resultEl.className = 'upload-result error';
      resultEl.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Network error: ${esc(err.message)}`;
      showToast('Network error during upload', 'error');
      uploadBtn.disabled      = false;
      btnText.style.display   = 'inline-flex';
      btnLoader.style.display = 'none';
    }
  }

  function resetBulkModal() {
    $('csvFileInput').value            = '';
    $('fileSelected').style.display    = 'none';
    $('dropZone').style.display        = 'flex';
    $('stepValidate').style.display    = 'none';
    $('btnValidateCSV').style.display  = 'none';
    $('btnUploadCSV').style.display    = 'none';
    $('uploadProgressWrap').style.display = 'none';
    $('uploadResult').style.display    = 'none';
    $('valSummary').style.display      = 'none';
    $('errorTableWrap').style.display  = 'none';
    $('previewWrap').style.display     = 'none';
    $('progressBarFill').style.width   = '0%';
    parsedCSVRows = [];
    csvHasErrors  = false;
    csvHasNARows  = false;
    const naDisclaimerEl = $('naDisclaimer');
    if (naDisclaimerEl) naDisclaimerEl.style.display = 'none';
  }

  // ══════════════════════════════════════════════════════════════
  //  ADD SINGLE ITEM
  // ══════════════════════════════════════════════════════════════
  function resetAddForm() {
    const fields = [
      'product_name','generic_name','strength','dosage_form','release_type',
      'manufacturer','brand','category','batch_no','supplier_name',
      'pack_size','box_quantity','loose_units','reorder_level','purchase_price',
      'original_price','discounted_price','manufacture_date','expiry_date'
    ];
    fields.forEach(f => {
      const el = $('f_' + f);
      if (el) el.value = (f === 'reorder_level' ? '1' : f === 'loose_units' ? '0' : '');
    });
    const pr = $('f_prescription_required');
    if (pr) pr.checked = false;
    $('addFormError').style.display = 'none';
    clearFieldErrors(['product_name','generic_name','strength','dosage_form',
      'manufacturer','batch_no','pack_size','box_quantity','loose_units',
      'reorder_level','original_price','discounted_price','expiry_date']);
  }

  function clearFieldErrors(fields) {
    fields.forEach(f => {
      const el = $('err_' + f);
      if (el) el.textContent = '';
      const inp = $('f_' + f);
      if (inp) inp.classList.remove('error');
    });
  }

  function setFieldError(field, msg) {
    const errEl = $('err_' + field);
    const inpEl = $('f_' + field);
    if (errEl) errEl.textContent = msg;
    if (inpEl) inpEl.classList.add('error');
  }

  function getAddFormData() {
    return {
      product_name:          normUp($('f_product_name')?.value),
      brand:                 normUp($('f_brand')?.value),
      category:              normUp($('f_category')?.value),
      generic_name:          normUp($('f_generic_name')?.value),
      strength:              normUp($('f_strength')?.value),
      dosage_form:           normUp($('f_dosage_form')?.value),
      release_type:          normUp($('f_release_type')?.value),
      manufacturer:          normUp($('f_manufacturer')?.value),
      batch_no:              normUp($('f_batch_no')?.value),
      supplier_name:         normUp($('f_supplier_name')?.value),
      purchase_price:        $('f_purchase_price')?.value   ? Number($('f_purchase_price').value)   : null,
      original_price:        $('f_original_price')?.value   ? Number($('f_original_price').value)   : null,
      discounted_price:      $('f_discounted_price')?.value ? Number($('f_discounted_price').value)  : null,
      pack_size:             $('f_pack_size')?.value        ? Number($('f_pack_size').value)         : null,
      box_quantity:          $('f_box_quantity')?.value !== '' ? Number($('f_box_quantity').value)   : null,
      loose_units:           $('f_loose_units')?.value  !== '' ? Number($('f_loose_units').value)   : 0,
      prescription_required: $('f_prescription_required')?.checked ? 'YES' : 'NO',
      reorder_level:         $('f_reorder_level')?.value    ? Number($('f_reorder_level').value)     : 1,
      manufacture_date:      norm($('f_manufacture_date')?.value) || null,
      expiry_date:           norm($('f_expiry_date')?.value),
    };
  }

  function validateAddForm(d) {
    const errors = {};
    if (!d.product_name)  errors.product_name  = 'Required';
    if (!d.generic_name)  errors.generic_name  = 'Required';
    if (!d.strength)      errors.strength      = 'Required';
    if (!d.dosage_form)   errors.dosage_form   = 'Required';
    if (!d.manufacturer)  errors.manufacturer  = 'Required';
    if (!d.batch_no)      errors.batch_no      = 'Required';
    if (!/^BAT-\d{4}$/.test(d.batch_no)) errors.batch_no = 'Must match format BAT-XXXX (e.g. BAT-7224)';
    if (!d.pack_size || d.pack_size <= 0)            errors.pack_size      = 'Must be a positive integer';
    if (d.box_quantity === null || d.box_quantity < 0) errors.box_quantity = 'Must be ≥ 0';
    if (d.loose_units < 0)                           errors.loose_units    = 'Must be ≥ 0';
    if (d.pack_size && d.loose_units >= d.pack_size) errors.loose_units    = `Must be less than pack size (${d.pack_size})`;
    if (!d.original_price || d.original_price <= 0) errors.original_price = 'Must be a positive number';
    if (!d.expiry_date)                              errors.expiry_date    = 'Required';
    if (d.discounted_price !== null && d.discounted_price > d.original_price)
      errors.discounted_price = 'Cannot exceed original price';
    if (d.reorder_level < 1)                         errors.reorder_level  = 'Must be ≥ 1';
    return errors;
  }

  async function handleAddItem() {
    const btn     = $('btnSubmitAdd');
    const btnText = $('btnSubmitAddText');
    const loader  = $('btnSubmitAddLoader');
    const errBox  = $('addFormError');

    const d = getAddFormData();
    clearFieldErrors(['product_name','generic_name','strength','dosage_form',
      'manufacturer','batch_no','pack_size','box_quantity','loose_units',
      'reorder_level','original_price','discounted_price','expiry_date']);
    errBox.style.display = 'none';

    const errors = validateAddForm(d);
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([f, m]) => setFieldError(f, m));
      errBox.textContent   = 'Please fix the errors above before submitting.';
      errBox.style.display = 'block';
      return;
    }

    btn.disabled          = true;
    btnText.style.display = 'none';
    loader.style.display  = 'inline-flex';

    try {
      const resp = await fetch(EDGE_FN_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ rows: [d], mode: 'single' })
      });

      const json = await resp.json();

      if (resp.ok && json.success) {
        $('modalAddBackdrop').classList.remove('open');
        showToast('Item added successfully', 'success');
        await loadStats();
        await loadInventory();
      } else {
        // Show server errors inline
        if (json.errors && Array.isArray(json.errors)) {
          json.errors.forEach(e => setFieldError(e.field, e.message));
          errBox.textContent   = 'Please fix the errors above.';
          errBox.style.display = 'block';
        } else {
          errBox.textContent   = json.error || 'Failed to add item. Please try again.';
          errBox.style.display = 'block';
        }
      }
    } catch (err) {
      console.error('Add item error:', err);
      errBox.textContent   = 'Network error. Please try again.';
      errBox.style.display = 'block';
    } finally {
      btn.disabled          = false;
      btnText.style.display = 'inline-flex';
      loader.style.display  = 'none';
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  EDIT INVENTORY ITEM
  // ══════════════════════════════════════════════════════════════
  window.openEditModal = function(id, name, boxQty, looseUnits, reorderLvl, supplier, purchPrice, origPrice, discPrice, expiryDate, prescriptionRequired, packSize) {
    $('edit_id').value               = id;
    $('editModalSubtitle').textContent = `Editing: ${name}`;
    $('edit_box_quantity').value     = boxQty;
    $('edit_loose_units').value      = looseUnits;
    $('edit_reorder_level').value    = reorderLvl;
    $('edit_supplier_name').value    = supplier;
    $('edit_purchase_price').value   = purchPrice === 'null' ? '' : purchPrice;
    $('edit_original_price').value   = origPrice;
    $('edit_discounted_price').value = discPrice === 'null' ? '' : discPrice;
    $('edit_expiry_date').value      = expiryDate || '';
    $('edit_prescription_required').checked = prescriptionRequired === 'true' || prescriptionRequired === true;
    // Store pack_size reference for loose_units validation
    const psRef = $('edit_pack_size_ref');
    if (psRef) psRef.value = packSize || 0;
    $('editFormError').style.display = 'none';
    $('err_edit_box_quantity').textContent    = '';
    $('err_edit_loose_units').textContent     = '';
    $('err_edit_original_price').textContent  = '';
    $('err_edit_discounted_price').textContent = '';
    $('err_edit_expiry_date').textContent      = '';
    openModal('modalEditBackdrop');
  };
  
  async function handleEditSave() {
    const btn     = $('btnSubmitEdit');
    const btnText = $('btnSubmitEditText');
    const loader  = $('btnSubmitEditLoader');
    const errBox  = $('editFormError');

    const id           = $('edit_id').value;
    const boxQty       = Number($('edit_box_quantity').value);
    const looseUnits   = Number($('edit_loose_units').value);
    const reorderLvl   = Number($('edit_reorder_level').value);
    const supplier     = normUp($('edit_supplier_name').value);
    const purchPrice   = $('edit_purchase_price').value ? Number($('edit_purchase_price').value) : null;
    const origPrice    = Number($('edit_original_price').value);
    const discPrice    = $('edit_discounted_price').value ? Number($('edit_discounted_price').value) : null;
    const expiryDate   = norm($('edit_expiry_date').value);
    const prescReq     = $('edit_prescription_required').checked;

    // Reset errors
    $('err_edit_box_quantity').textContent     = '';
    $('err_edit_loose_units').textContent      = '';
    $('err_edit_original_price').textContent   = '';
    $('err_edit_discounted_price').textContent = '';
    $('err_edit_expiry_date').textContent       = '';
    errBox.style.display = 'none';

    // Validate
    let hasError = false;
    if (isNaN(boxQty) || boxQty < 0) {
      $('err_edit_box_quantity').textContent = 'Must be ≥ 0';
      hasError = true;
    }
    if (isNaN(looseUnits) || looseUnits < 0) {
      $('err_edit_loose_units').textContent = 'Must be ≥ 0';
      hasError = true;
    }
    const packSizeForEdit = Number($('edit_pack_size_ref')?.value || 0);
    if (packSizeForEdit > 0 && looseUnits >= packSizeForEdit) {
      $('err_edit_loose_units').textContent = `Must be less than pack size (${packSizeForEdit})`;
      hasError = true;
    }
    if (!origPrice || origPrice <= 0) {
      $('err_edit_original_price').textContent = 'Must be a positive number';
      hasError = true;
    }
    if (discPrice !== null && discPrice > origPrice) {
      $('err_edit_discounted_price').textContent = 'Cannot exceed original price';
      hasError = true;
    }
    if (!expiryDate) {
      $('err_edit_expiry_date').textContent = 'Required';
      hasError = true;
    } 
    
    if (hasError) {
      errBox.textContent   = 'Please fix the errors above.';
      errBox.style.display = 'block';
      return;
    }

    btn.disabled          = true;
    btnText.style.display = 'none';
    loader.style.display  = 'inline-flex';

    try {
      const { error } = await sb
        .from('inventory')
        .update({
          box_quantity:          boxQty,
          loose_units:           looseUnits,
          reorder_level:         reorderLvl,
          supplier_name:         supplier     || null,
          purchase_price:        purchPrice,
          original_price:        origPrice,
          discounted_price:      discPrice,
          expiry_date:           expiryDate,
          prescription_required: prescReq,
        })
        .eq('id', id)
        .eq('pharmacy_id', pharmacyId);

      if (error) throw error;

      $('modalEditBackdrop').classList.remove('open');
      showToast('Item updated successfully', 'success');
      await loadStats();
      await loadInventory();
    } catch (err) {
      console.error('Edit save error:', err);
      errBox.textContent   = err.message || 'Failed to save changes.';
      errBox.style.display = 'block';
    } finally {
      btn.disabled          = false;
      btnText.style.display = 'inline-flex';
      loader.style.display  = 'none';
    }
  }

// ══════════════════════════════════════════════════════════════
  //  DELETE SINGLE INVENTORY ITEM
  // ══════════════════════════════════════════════════════════════
  let deleteItemTargetId = null;

  window.openDeleteItemModal = function(id, name, batchNo) {
    deleteItemTargetId = id;
    $('deleteItemDesc').innerHTML =
      `This will permanently remove <strong>${esc(name)}</strong> — Batch <strong>${esc(batchNo)}</strong> from your inventory.
       The product in the master catalogue will not be affected.`;
    $('deleteItemError').style.display   = 'none';
    $('btnDeleteItemText').style.display = 'inline-flex';
    $('btnDeleteItemLoader').style.display = 'none';
    $('btnConfirmDeleteItem').disabled   = false;
    openModal('modalDeleteItemBackdrop');
  };

  function closeDeleteItemModal() {
    $('modalDeleteItemBackdrop')?.classList.remove('open');
    deleteItemTargetId = null;
    $('deleteItemError').style.display = 'none';
  }

  async function handleDeleteItem() {
    if (!deleteItemTargetId || !pharmacyId) return;

    const btn     = $('btnConfirmDeleteItem');
    const btnText = $('btnDeleteItemText');
    const loader  = $('btnDeleteItemLoader');
    const errBox  = $('deleteItemError');

    btn.disabled          = true;
    btnText.style.display = 'none';
    loader.style.display  = 'inline-flex';
    errBox.style.display  = 'none';

    try {
      const { error } = await sb
        .from('inventory')
        .delete()
        .eq('id', deleteItemTargetId)
        .eq('pharmacy_id', pharmacyId);  // RLS double-check

      if (error) throw error;

      closeDeleteItemModal();
      showToast('Item deleted successfully.', 'success');
      await loadStats();
      await loadInventory();
    } catch (err) {
      console.error('Delete item error:', err);
      errBox.textContent   = err.message || 'Failed to delete item. Please try again.';
      errBox.style.display = 'block';
      btn.disabled          = false;
      btnText.style.display = 'inline-flex';
      loader.style.display  = 'none';
    }
  }
  
  // ══════════════════════════════════════════════════════════════
  //  DELETE ALL STOCK
  // ══════════════════════════════════════════════════════════════
  async function openDeleteAllModal() {
    // Reset state
    $('deleteConfirmInput').value        = '';
    $('deleteConfirmInput').classList.remove('match');
    $('btnConfirmDeleteAll').disabled    = true;
    $('deleteFormError').style.display   = 'none';
    $('btnDeleteAllText').style.display  = 'inline-flex';
    $('btnDeleteAllLoader').style.display = 'none';

    // Populate live stats from already-loaded stat elements so the
    // pharmacist sees exactly what will be wiped before confirming.
    $('deleteStatItems').textContent = $('statTotal')?.textContent || '—';
    $('deleteStatValue').textContent = $('statValue')?.textContent || '—';

    openModal('modalDeleteAllBackdrop');
    $('deleteConfirmInput').focus();
  }

  function closeDeleteAllModal() {
    $('modalDeleteAllBackdrop')?.classList.remove('open');
    $('deleteConfirmInput').value = '';
    $('deleteConfirmInput').classList.remove('match');
    $('btnConfirmDeleteAll').disabled = true;
    $('deleteFormError').style.display = 'none';
  }

  async function handleDeleteAllStock() {
    if (!pharmacyId) return;

    const btn     = $('btnConfirmDeleteAll');
    const btnText = $('btnDeleteAllText');
    const loader  = $('btnDeleteAllLoader');
    const errBox  = $('deleteFormError');

    // Double-check the typed value server-side is not needed —
    // the button is disabled unless it matches, but we re-verify here.
    if ($('deleteConfirmInput').value.trim() !== 'DELETE ALL') return;

    btn.disabled          = true;
    btnText.style.display = 'none';
    loader.style.display  = 'inline-flex';
    errBox.style.display  = 'none';

    try {
      const { error } = await sb
        .from('inventory')
        .delete()
        .eq('pharmacy_id', pharmacyId);

      if (error) throw error;

      closeDeleteAllModal();
      showToast('All stock deleted successfully.', 'error'); // red toast — destructive action
      await loadStats();
      await loadInventory();
    } catch (err) {
      console.error('Delete all error:', err);
      errBox.textContent   = err.message || 'Failed to delete stock. Please try again.';
      errBox.style.display = 'block';
      btn.disabled          = false;
      btnText.style.display = 'inline-flex';
      loader.style.display  = 'none';
    }
  }

  // ── Boot ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
