// ============================================================
//  PharmBilling.js  v2
//  Generate New Bill — fully dynamic, Supabase-powered
//
//  Features implemented:
//    • Auto bill-ID via generate_bill_id() RPC
//    • Live date/time display
//    • Phone validation: +92XXXXXXXXXX
//    • Inventory-aware product search (pharmacy_inventory_view)
//    • Per-row quantity guard (≤ total_available_units)
//    • Real-time subtotal / per-item discount / bill-level DISC% / grand-total calc
//    • Payment method panels: Cash / JazzCash / EasyPaisa / Card
//    • Cash change-return calculation
//    • Confirm & Generate Invoice → save_bill RPC (atomic)
//    • jsPDF invoice auto-download after successful save
//    • Redirect to receipt page after save
// ============================================================

(function () {
  'use strict';

  /* ── Supabase client ───────────────────────────────────────── */
  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  /* ── Config ────────────────────────────────────────────────── */
  const SEARCH_DELAY = 280;    // ms debounce
  const MAX_RESULTS  = 12;     // dropdown cap

  /* ── State ─────────────────────────────────────────────────── */
  let pharmacyId      = null;
  let pharmacistName  = '';
  let pharmacyInfo    = {};    // { pharmacy_name, address, phone_no }
  let billId          = '';    // e.g. "BILL-10001"
  let billedAt        = null;  // Date object, set on init
  let cartItems       = [];    // [{ invRow, qty }] — live cart
  let paymentMethod   = 'cash';
  let searchTimer     = null;
  let dateTimer       = null;

  /* ── DOM helper ─────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  /* ── Escape ─────────────────────────────────────────────────── */
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── Format helpers ─────────────────────────────────────────── */
  function fmtNum(n, dec = 2) {
    return Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
  }
  function fmtDateTime(d) {
    if (!d) return '—';
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) +
           ', ' + d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
  function initials(name) {
    const p = (name || '').trim().split(/\s+/).filter(Boolean);
    return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length-1][0] : '')).toUpperCase() || '?';
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  let _toastTimer = null;
  function showToast(msg, type = 'success') {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
  }

  /* ══════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════ */
  async function init() {
    /* Auth check */
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }
    const userId = session.user.id;

    const { data: userRow } = await sb.from('users').select('role').eq('id', userId).single();
    if (!userRow || userRow.role !== 'pharmacist') {
      await sb.auth.signOut();
      window.location.href = 'Login.html';
      return;
    }

    /* Fetch profile + pharmacy in parallel */
    const [{ data: profile }, { data: pharmacy }, { data: phProfile }] = await Promise.all([
      sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single(),
      sb.from('pharmacies').select('id, pharmacy_name, address').eq('user_id', userId).single(),
      sb.from('profiles').select('phone_no').eq('user_id', userId).single()
    ]);

    pharmacyId = pharmacy?.id || null;
    pharmacistName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    pharmacyInfo = {
      pharmacy_name: pharmacy?.pharmacy_name || 'MediFinder Pharmacy',
      address:       pharmacy?.address       || '',
      phone_no:      phProfile?.phone_no     || ''
    };

    /* Logout button (topbar or wherever it exists in the page) */
    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () =>
        sb.auth.signOut().then(() => { window.location.href = 'Login.html'; })
      );
    }

    /* Generate bill ID */
    await fetchBillId();

    /* Live date/time */
    billedAt = new Date();
    updateDateDisplay();
    dateTimer = setInterval(updateDateDisplay, 30000);

    /* Wire up UI */
    initPhoneValidation();
    initProductSearch();
    initPaymentMethods();
    initCashCalculation();
    initBillDiscount();
    initConfirmButton();
  }

  /* ── Bill ID ─────────────────────────────────────────────────── */
  async function fetchBillId() {
    const el = $('billId');
    try {
      const { data, error } = await sb.rpc('generate_bill_id');
      if (error) throw error;
      billId = data;
      if (el) el.value = billId;
    } catch (err) {
      console.error('Bill ID error:', err);
      if (el) el.value = 'Error';
    }
  }

  /* ── Date display ────────────────────────────────────────────── */
  function updateDateDisplay() {
    billedAt = new Date();
    const el = $('billDate');
    if (el) el.value = fmtDateTime(billedAt);
  }

  /* ══════════════════════════════════════════════════════════════
     PHONE VALIDATION
     Rules:
       Starts with "0"  → exactly 11 digits, no spaces/alpha/special
       Starts with "+92" → exactly "+92" + 10 digits = 13 chars total
  ══════════════════════════════════════════════════════════════ */
  function validatePhone(val) {
    if (!val) return 'Phone number is required.';
    if (val.startsWith('+92')) {
      if (!/^\+92\d{10}$/.test(val))
        return 'Format: +92XXXXXXXXXX (13 chars, digits only after +92, no spaces).';
    } else if (val.startsWith('0')) {
      if (!/^0\d{10}$/.test(val))
        return 'Format: 03XXXXXXXXX (exactly 11 digits, no spaces or special chars).';
    } else {
      return 'Must start with "0" or "+92".';
    }
    return null; // valid
  }

  function initPhoneValidation() {
    const input  = $('custPhone');
    const errEl  = $('custPhoneErr');
    if (!input) return;
    input.addEventListener('blur', () => {
      const msg = validatePhone(input.value.trim());
      showFieldError(input, errEl, msg);
    });
    input.addEventListener('input', () => {
      if (!input.classList.contains('invalid')) return;
      const msg = validatePhone(input.value.trim());
      showFieldError(input, errEl, msg);
      updateConfirmButton();
    });
    input.addEventListener('input', updateConfirmButton);
  }

  function showFieldError(inputEl, errEl, msg) {
    if (msg) {
      inputEl.classList.add('invalid');
      if (errEl) { errEl.textContent = msg; errEl.hidden = false; }
    } else {
      inputEl.classList.remove('invalid');
      if (errEl) errEl.hidden = true;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PRODUCT SEARCH
     Queries pharmacy_inventory_view for the pharmacist's inventory.
     Search matches product_name, generic_name, brand.
     Shows only non-expired items with available stock.
  ══════════════════════════════════════════════════════════════ */
  function initProductSearch() {
    const input   = $('prodSearchInput');
    const results = $('prodSearchResults');
    const spinner = $('prodSearchSpinner');
    if (!input) return;

    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if (q.length < 2) { closeResults(); return; }
      if (spinner) spinner.hidden = false;
      searchTimer = setTimeout(() => searchProducts(q), SEARCH_DELAY);
    });

    /* Close dropdown on outside click */
    document.addEventListener('click', e => {
      if (!e.target.closest('.prod-search-wrap')) closeResults();
    });

    /* Keyboard navigation */
    input.addEventListener('keydown', e => {
      if (!results || results.hidden) return;
      const items = results.querySelectorAll('[role="option"]');
      const idx   = [...items].indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (items[idx + 1] || items[0])?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx <= 0 ? input.focus() : items[idx - 1]?.focus();
      } else if (e.key === 'Escape') {
        closeResults(); input.focus();
      }
    });
  }

  function closeResults() {
    const results = $('prodSearchResults');
    const spinner = $('prodSearchSpinner');
    if (results) results.hidden = true;
    if (spinner) spinner.hidden = true;
  }

  async function searchProducts(q) {
    const results = $('prodSearchResults');
    const spinner = $('prodSearchSpinner');
    if (!pharmacyId || !results) return;

    try {
      /* Query pharmacy_inventory_view — joins inventory + products + pharmacies + profiles */
      const { data, error } = await sb
        .from('pharmacy_inventory_view')
        .select(
          'id, product_name, brand, generic_name, strength, dosage_form, ' +
          'original_price, discounted_price, pack_size, box_quantity, loose_units, ' +
          'prescription_required, expiry_date, reorder_level'
        )
        .eq('pharmacy_id', pharmacyId)
        .gt('expiry_date', new Date().toISOString().slice(0, 10))
        .or(
          `product_name.ilike.%${q}%,` +
          `generic_name.ilike.%${q}%,` +
          `brand.ilike.%${q}%`
        )
        .order('product_name')
        .limit(MAX_RESULTS);

      if (error) throw error;

      if (spinner) spinner.hidden = true;
      renderSearchResults(results, data || []);
    } catch (err) {
      console.error('Product search error:', err);
      if (spinner) spinner.hidden = true;
      if (results) {
        results.innerHTML = `<li class="prod-result-msg"><i class="fa-solid fa-circle-exclamation"></i> Search failed. Try again.</li>`;
        results.hidden = false;
      }
    }
  }

  function renderSearchResults(container, rows) {
    container.innerHTML = '';

    if (!rows.length) {
      container.innerHTML = `<li class="prod-result-msg"><i class="fa-regular fa-folder-open"></i> No matching medicines found.</li>`;
      container.hidden = false;
      return;
    }

    rows.forEach(row => {
      const totalAvail = (row.box_quantity * row.pack_size) + row.loose_units;
      const inCart     = cartItems.filter(c => c.invRow.id === row.id).reduce((s, c) => s + c.qty, 0);
      const remaining  = totalAvail - inCart;

      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('tabindex', '0');
      li.className = 'prod-result-item';
      if (remaining <= 0) {
        li.classList.add('out-of-stock');
        li.setAttribute('aria-disabled', 'true');
      }

      const discPct = calcDiscountPct(row.original_price, row.discounted_price);
      const rxBadge = row.prescription_required
        ? ' <span class="rx-badge" title="Prescription required">Rx</span>' : '';

      li.innerHTML = `
        <div class="pri-left">
          <span class="pri-name">${esc(row.product_name)}${rxBadge}</span>
          <span class="pri-sub">${esc(row.generic_name)} · ${esc(row.strength)} · ${esc(row.dosage_form)}</span>
          ${row.brand ? `<span class="pri-sub" style="color:var(--clr-gray)">${esc(row.brand)}</span>` : ''}
        </div>
        <div class="pri-right">
          <span class="pri-price">PKR ${fmtNum(row.original_price, 2)}</span>
          ${discPct > 0 ? `<span style="font-size:11px;color:var(--clr-red)">${discPct.toFixed(0)}% off</span>` : ''}
          ${remaining > 0
            ? `<span class="pri-stock">${remaining} unit${remaining !== 1 ? 's' : ''} left</span>`
            : `<span class="pri-out">Out of stock</span>`}
        </div>`;

      if (remaining > 0) {
        li.addEventListener('click', () => addToCart(row));
        li.addEventListener('keydown', e => { if (e.key === 'Enter') addToCart(row); });
      }

      container.appendChild(li);
    });

    container.hidden = false;
  }

  /* ══════════════════════════════════════════════════════════════
     CART MANAGEMENT
  ══════════════════════════════════════════════════════════════ */
  function calcDiscountPct(origPrice, discPrice) {
    if (!discPrice || Number(discPrice) >= Number(origPrice)) return 0;
    return ((Number(origPrice) - Number(discPrice)) / Number(origPrice)) * 100;
  }

  function calcTotalAvail(row) {
    return (row.box_quantity * row.pack_size) + row.loose_units;
  }

  function addToCart(invRow) {
    closeResults();
    const input = $('prodSearchInput');
    if (input) input.value = '';

    /* If already in cart, increment qty by 1 */
    const existing = cartItems.find(c => c.invRow.id === invRow.id);
    if (existing) {
      const maxAvail = calcTotalAvail(invRow);
      if (existing.qty < maxAvail) {
        existing.qty += 1;
      } else {
        showToast(`Maximum available quantity reached for ${invRow.product_name}.`, 'error');
        return;
      }
    } else {
      cartItems.push({ invRow, qty: 1 });
    }

    renderCart();
    recalcTotals();
    updateConfirmButton();
    showToast(`${invRow.product_name} added.`, 'success');
  }

  function removeFromCart(invId) {
    cartItems = cartItems.filter(c => c.invRow.id !== invId);
    renderCart();
    recalcTotals();
    updateConfirmButton();
  }

  function renderCart() {
    const tbody  = $('prodTbody');
    const empty  = $('prodEmptyRow');
    const rxWarn = $('rxWarning');
    if (!tbody) return;

    if (!cartItems.length) {
      tbody.innerHTML = '';
      if (empty) { empty.hidden = false; tbody.appendChild(empty); }
      if (rxWarn) rxWarn.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;

    /* Check for any prescription-required items */
    const hasRx = cartItems.some(c => c.invRow.prescription_required);
    if (rxWarn) rxWarn.hidden = !hasRx;

    const fragment = document.createDocumentFragment();
    cartItems.forEach(({ invRow, qty }) => {
      const discPct      = calcDiscountPct(invRow.original_price, invRow.discounted_price);
      const unitPrice    = invRow.discounted_price != null ? Number(invRow.discounted_price) : Number(invRow.original_price);
      const subtotal     = unitPrice * qty;
      const totalAvail   = calcTotalAvail(invRow);

      const tr = document.createElement('tr');
      tr.dataset.invId = invRow.id;
      tr.innerHTML = `
        <td>
          <p class="pr-name">${esc(invRow.product_name)}</p>
          <p class="pr-sub">${esc(invRow.generic_name)} · ${esc(invRow.strength)} · ${esc(invRow.dosage_form)}</p>
        </td>
        <td>
          <input type="number"
                 class="qty-input"
                 value="${qty}"
                 min="1"
                 max="${totalAvail}"
                 data-inv-id="${esc(invRow.id)}"
                 aria-label="Quantity for ${esc(invRow.product_name)}" />
        </td>
        <td><span class="pr-orig-price">PKR ${fmtNum(invRow.original_price, 2)}</span></td>
        <td><span class="pr-disc-pct">${discPct > 0 ? discPct.toFixed(0) + '%' : '0%'}</span></td>
        <td><span class="pr-subtotal" id="sub_${esc(invRow.id)}">PKR ${fmtNum(subtotal, 2)}</span></td>
        <td>
          <button class="remove-btn" data-inv-id="${esc(invRow.id)}" aria-label="Remove ${esc(invRow.product_name)}" title="Remove">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </td>`;
      fragment.appendChild(tr);
    });

    tbody.innerHTML = '';
    tbody.appendChild(fragment);

    /* Wire qty inputs */
    tbody.querySelectorAll('.qty-input').forEach(input => {
      input.addEventListener('change', onQtyChange);
      input.addEventListener('input',  onQtyChange);
    });

    /* Wire remove buttons */
    tbody.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(btn.dataset.invId));
    });
  }

  function onQtyChange(e) {
    const input = e.target;
    const invId = input.dataset.invId;
    let val     = parseInt(input.value, 10);

    const cartItem = cartItems.find(c => c.invRow.id === invId);
    if (!cartItem) return;

    const maxAvail = calcTotalAvail(cartItem.invRow);

    if (isNaN(val) || val < 1) { val = 1; input.value = 1; }
    if (val > maxAvail)        { val = maxAvail; input.value = maxAvail; input.classList.add('invalid'); }
    else                       { input.classList.remove('invalid'); }

    cartItem.qty = val;

    /* Update subtotal cell inline without full re-render */
    const unitPrice = cartItem.invRow.discounted_price != null
      ? Number(cartItem.invRow.discounted_price) : Number(cartItem.invRow.original_price);
    const subEl = document.getElementById('sub_' + invId);
    if (subEl) subEl.textContent = 'PKR ' + fmtNum(unitPrice * val, 2);

    recalcTotals();
    updateConfirmButton();
  }

  /* ══════════════════════════════════════════════════════════════
     CALCULATIONS
  ══════════════════════════════════════════════════════════════ */
  function recalcTotals() {
    let subtotal = 0, itemDiscount = 0;

    cartItems.forEach(({ invRow, qty }) => {
      const orig = Number(invRow.original_price);
      const disc = invRow.discounted_price != null ? Number(invRow.discounted_price) : orig;
      subtotal     += orig * qty;
      itemDiscount += (orig - disc) * qty;
    });

    /* Bill-level DISC% (manual input) */
    const billDiscPct    = Math.min(100, Math.max(0, parseFloat($('billDiscPct')?.value) || 0));
    const afterItemDisc  = subtotal - itemDiscount;
    const billDiscAmt    = afterItemDisc * (billDiscPct / 100);
    const totalDiscount  = itemDiscount + billDiscAmt;
    const grandTotal     = afterItemDisc - billDiscAmt;

    /* Update DOM */
    setText('sumSubtotal', 'PKR ' + fmtNum(subtotal, 2));
    setText('sumGrand',    'PKR ' + fmtNum(grandTotal, 2));

    const discRow = $('sumDiscountRow');
    if (itemDiscount > 0) {
      setText('sumDiscount', '−PKR ' + fmtNum(itemDiscount, 2));
      discRow?.classList.add('visible');
    } else {
      setText('sumDiscount', '−PKR 0.00');
      discRow?.classList.remove('visible');
    }

    const billDiscAmtRow = $('sumBillDiscAmtRow');
    if (billDiscAmt > 0) {
      setText('sumBillDiscAmt', '−PKR ' + fmtNum(billDiscAmt, 2));
      billDiscAmtRow?.classList.add('visible');
    } else {
      setText('sumBillDiscAmt', '−PKR 0.00');
      billDiscAmtRow?.classList.remove('visible');
    }

    /* Store on window for confirm handler */
    window._billCalc = { subtotal, totalDiscount, gstAmount: 0, grandTotal };

    /* Update cash-return if cash method */
    if (paymentMethod === 'cash') calcCashReturn();
  }

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = String(val ?? '');
  }

  /* ══════════════════════════════════════════════════════════════
     PAYMENT METHODS
  ══════════════════════════════════════════════════════════════ */
  function initPaymentMethods() {
    document.querySelectorAll('.method-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.method-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        paymentMethod = btn.dataset.method;
        switchPaymentPanel(paymentMethod);
        updateConfirmButton();
      });
    });
  }

  function switchPaymentPanel(method) {
    $('panelCash').hidden   = method !== 'cash';
    $('panelOnline').hidden = !['jazzcash', 'easypaisa'].includes(method);
    $('panelCard').hidden   = method !== 'card';
  }

  /* ── Bill-level DISC% ────────────────────────────────────────── */
  function initBillDiscount() {
    const input = $('billDiscPct');
    if (!input) return;
    input.addEventListener('input', () => {
      /* Clamp: no negatives, max 100 */
      let v = parseFloat(input.value);
      if (isNaN(v) || v < 0) { input.value = ''; }
      else if (v > 100)       { input.value = 100; }
      recalcTotals();
      updateConfirmButton();
    });
  }

  /* ── Cash return ─────────────────────────────────────────────── */
  function initCashCalculation() {
    const input = $('cashReceived');
    if (!input) return;
    input.addEventListener('input', () => {
      calcCashReturn();
      updateConfirmButton();
    });
  }

  function calcCashReturn() {
    const calc      = window._billCalc || {};
    const grand     = calc.grandTotal || 0;
    const received  = parseFloat($('cashReceived')?.value) || 0;
    const change    = Math.max(0, received - grand);
    setText('cashReturn', 'PKR ' + fmtNum(change, 2));
    window._cashChange = change;
  }

  /* ══════════════════════════════════════════════════════════════
     CONFIRM BUTTON — enable/disable guard
  ══════════════════════════════════════════════════════════════ */
  function updateConfirmButton() {
    const btn        = $('confirmBtn');
    if (!btn) return;

    const custName   = $('custName')?.value.trim() || '';
    const custPhone  = $('custPhone')?.value.trim() || '';
    const phoneOk    = validatePhone(custPhone) === null;
    const hasItems   = cartItems.length > 0;
    const calc       = window._billCalc || {};
    const grand      = calc.grandTotal || 0;

    let payOk = false;
    if (paymentMethod === 'cash') {
      const received = parseFloat($('cashReceived')?.value) || 0;
      payOk = received >= grand && grand > 0;
    } else if (['jazzcash', 'easypaisa'].includes(paymentMethod)) {
      const ref    = $('onlineTxnRef')?.value.trim() || '';
      const amount = parseFloat($('onlineAmountPaid')?.value) || 0;
      payOk = ref.length > 0 && amount >= grand && grand > 0;
    } else if (paymentMethod === 'card') {
      const last4  = $('cardLast4')?.value.trim() || '';
      const amount = parseFloat($('cardAmountPaid')?.value) || 0;
      payOk = /^\d{4}$/.test(last4) && amount >= grand && grand > 0;
    }

    btn.disabled = !(custName && phoneOk && hasItems && payOk);
  }

  /* Wire remaining payment fields to trigger button re-eval */
  function wirePaymentFields() {
    ['onlineTxnRef','onlineAmountPaid','cardLast4','cardAmountPaid'].forEach(id => {
      $(id)?.addEventListener('input', updateConfirmButton);
    });
    $('custName')?.addEventListener('input', updateConfirmButton);
  }

  /* ══════════════════════════════════════════════════════════════
     CONFIRM & GENERATE INVOICE
  ══════════════════════════════════════════════════════════════ */
  function initConfirmButton() {
    wirePaymentFields();
    const btn = $('confirmBtn');
    if (!btn) return;
    btn.addEventListener('click', confirmBill);
  }

  async function confirmBill() {
    const btn = $('confirmBtn');
    if (!btn || btn.disabled) return;

    /* Validate one more time synchronously */
    const custName  = $('custName')?.value.trim()  || '';
    const custPhone = $('custPhone')?.value.trim()  || '';
    const phoneErr  = validatePhone(custPhone);

    if (!custName) {
      showFieldError($('custName'), null, 'Customer name is required.');
      $('custName')?.classList.add('invalid');
      return;
    }
    if (phoneErr) {
      showFieldError($('custPhone'), $('custPhoneErr'), phoneErr);
      return;
    }
    if (!cartItems.length) {
      showToast('Add at least one product to the bill.', 'error');
      return;
    }

    /* Gather payment info */
    const calc           = window._billCalc || {};
    let amountReceived   = 0;
    let changeReturned   = 0;
    let referenceNo      = null;

    if (paymentMethod === 'cash') {
      amountReceived = parseFloat($('cashReceived')?.value) || 0;
      changeReturned = window._cashChange || 0;
    } else if (['jazzcash', 'easypaisa'].includes(paymentMethod)) {
      referenceNo    = $('onlineTxnRef')?.value.trim() || null;
      amountReceived = parseFloat($('onlineAmountPaid')?.value) || calc.grandTotal;
    } else if (paymentMethod === 'card') {
      referenceNo    = 'CARD-' + ($('cardLast4')?.value.trim() || '');
      amountReceived = parseFloat($('cardAmountPaid')?.value) || calc.grandTotal;
    }

    /* Build items payload */
    const itemsPayload = cartItems.map(({ invRow, qty }) => {
      const discPct = calcDiscountPct(invRow.original_price, invRow.discounted_price);
      const effectivePrice = invRow.discounted_price != null
        ? Number(invRow.discounted_price) : Number(invRow.original_price);
      return {
        inventory_id:     invRow.id,
        product_name:     invRow.product_name,
        generic_name:     invRow.generic_name,
        strength:         invRow.strength,
        dosage_form:      invRow.dosage_form,
        quantity:         qty,
        original_price:   Number(invRow.original_price),
        discounted_price: invRow.discounted_price != null ? Number(invRow.discounted_price) : '',
        discount_pct:     parseFloat(discPct.toFixed(4)),
        line_subtotal:    parseFloat((effectivePrice * qty).toFixed(2))
      };
    });

    /* Disable button, show loading state */
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Saving…';

    try {
      const { data: newBillId, error } = await sb.rpc('save_bill', {
        p_bill_no:         billId,
        p_customer_name:   custName,
        p_customer_phone:  custPhone,
        p_subtotal:        parseFloat(calc.subtotal.toFixed(2)),
        p_total_discount:  parseFloat(calc.totalDiscount.toFixed(2)),
        p_gst_amount:      parseFloat(calc.gstAmount.toFixed(2)),
        p_grand_total:     parseFloat(calc.grandTotal.toFixed(2)),
        p_notes:           $('billNotes')?.value.trim() || null,
        p_items:           itemsPayload,
        p_payment_method:  paymentMethod,
        p_amount_received: parseFloat(amountReceived.toFixed(2)),
        p_change_returned: parseFloat(changeReturned.toFixed(2)),
        p_reference_no:    referenceNo
      });

      if (error) throw error;

      showToast('Invoice generated and saved successfully!', 'success');

      /* Build the items payload in receipt format so the receipt page
         can render immediately without a second RPC round-trip.        */
      const receiptItems = cartItems.map(({ invRow, qty }) => {
        const discPct = calcDiscountPct(invRow.original_price, invRow.discounted_price);
        return {
          product_name:     invRow.product_name,
          generic_name:     invRow.generic_name   || '',
          strength:         invRow.strength        || '',
          dosage_form:      invRow.dosage_form     || '',
          quantity:         qty,
          original_price:   Number(invRow.original_price),
          discounted_price: invRow.discounted_price != null ? Number(invRow.discounted_price) : null,
          discount_pct:     parseFloat(discPct.toFixed(4))
        };
      });

      /* Store all data the receipt page needs */
      const receiptPayload = {
        /* Numeric DB row-id returned by save_bill — used for RPC fallback */
        dbId: newBillId,
        header: {
          bill_no:        billId,
          customer_name:  custName,
          customer_phone: custPhone,
          billed_at:      billedAt ? billedAt.toISOString() : new Date().toISOString(),
          subtotal:       parseFloat(calc.subtotal.toFixed(2)),
          total_discount: parseFloat(calc.totalDiscount.toFixed(2)),
          gst_amount:     parseFloat(calc.gstAmount.toFixed(2)),
          grand_total:    parseFloat(calc.grandTotal.toFixed(2))
        },
        items: receiptItems,
        payment: {
          method:       paymentMethod,
          reference_no: referenceNo,
          amount_paid:  parseFloat(amountReceived.toFixed(2)),
          change_given: parseFloat(changeReturned.toFixed(2))
        },
        pharmacy: {
          pharmacy_name: pharmacyInfo.pharmacy_name,
          address:       pharmacyInfo.address,
          phone_no:      pharmacyInfo.phone_no
        },
        pharmacistName
      };

      sessionStorage.setItem('mf_bill_id',   String(newBillId));
      sessionStorage.setItem('mf_bill_data', JSON.stringify(receiptPayload));

      /* Navigate to receipt after short delay */
      setTimeout(() => {
        window.location.href = 'PharmBillingReceipt.html';
      }, 1200);

    } catch (err) {
      console.error('Save bill error:', err);
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<i class="fa-solid fa-file-invoice" aria-hidden="true"></i> Confirm &amp; Generate Invoice';
      showToast(err.message || 'Failed to save bill. Please try again.', 'error');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PDF GENERATION  (jsPDF + autotable)
  ══════════════════════════════════════════════════════════════ */
  function generatePDF({ billNo, custName, custPhone, billedAt, pharmacistName,
                         pharmacyInfo, paymentMethod, referenceNo, calc, items,
                         cashReceived, cashChange }) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { showToast('PDF library not loaded.', 'error'); return; }

    const doc  = new jsPDF({ unit:'mm', format:'a4' });
    const GREEN  = [32, 139, 58];
    const DARK   = [26, 26, 26];
    const GRAY   = [107, 114, 128];
    const GRAY_L = [229, 231, 235];
    const lm = 20, rm = 190;

    /* ── Header band ── */
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, 210, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text(pharmacyInfo.pharmacy_name, lm, 15);
    doc.setFontSize(9);  doc.setFont('helvetica', 'normal');
    doc.text('Transaction Receipt', lm, 22);
    if (pharmacyInfo.address) doc.text(pharmacyInfo.address, lm, 28);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text('PAID', rm, 15, { align:'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(billNo, rm, 22, { align:'right' });

    let y = 48;

    /* ── Customer & Transaction grid ── */
    doc.setTextColor(...GRAY); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('CUSTOMER', lm, y);
    doc.text('TRANSACTION', 115, y);
    y += 5;

    doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(custName, lm, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(custPhone, lm, y + 5);
    doc.text(`Served by: ${pharmacistName}`, lm, y + 10);

    const methodLabels = { cash:'Cash', jazzcash:'JazzCash', easypaisa:'EasyPaisa', card:'Card' };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const dtStr = billedAt ? billedAt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) +
      ', ' + billedAt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) : '';
    doc.text(dtStr, 115, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const methodStr = (methodLabels[paymentMethod] || capitalize(paymentMethod)) +
      (referenceNo ? '  ' + referenceNo : '');
    doc.text(methodStr, 115, y + 5);
    if (paymentMethod === 'cash') {
      doc.text(`Received: PKR ${fmtNum(cashReceived, 2)}  |  Change: PKR ${fmtNum(cashChange, 2)}`, 115, y + 10);
    }
    y += 22;

    doc.setDrawColor(...GRAY_L); doc.line(lm, y, rm, y); y += 8;

    /* ── Items table ── */
    const tableBody = items.map(({ invRow, qty }) => {
      const discPct   = calcDiscountPct(invRow.original_price, invRow.discounted_price);
      const unitPrice = invRow.discounted_price != null ? Number(invRow.discounted_price) : Number(invRow.original_price);
      const sub       = unitPrice * qty;
      return [
        invRow.product_name + '\n' + invRow.strength + ' · ' + invRow.dosage_form,
        String(qty),
        'PKR ' + fmtNum(invRow.original_price, 2),
        discPct > 0 ? `-${discPct.toFixed(0)}%` : '—',
        'PKR ' + fmtNum(sub, 2)
      ];
    });

    doc.autoTable({
      startY: y,
      head: [['Item', 'Qty', 'Unit Price', 'Disc %', 'Subtotal']],
      body: tableBody,
      margin: { left: lm, right: 20 },
      styles: { fontSize: 9, cellPadding: 3, textColor: DARK },
      headStyles: { fillColor: GREEN, textColor: [255,255,255], fontStyle:'bold', fontSize:9 },
      columnStyles: {
        0: { cellWidth:'auto' },
        1: { cellWidth:14, halign:'center' },
        2: { cellWidth:28, halign:'right' },
        3: { cellWidth:18, halign:'center' },
        4: { cellWidth:30, halign:'right' }
      },
      alternateRowStyles: { fillColor: [248, 250, 248] }
    });

    y = doc.lastAutoTable.finalY + 8;

    /* ── Totals ── */
    const totX = 120;
    const addRow = (label, value, color = DARK, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(bold ? 10 : 9);
      doc.setTextColor(...color);
      doc.text(label, totX, y);
      doc.text(value, rm, y, { align:'right' });
      y += 6;
    };

    doc.setDrawColor(...GRAY_L); doc.line(totX, y-2, rm, y-2);
    addRow('Subtotal', 'PKR ' + fmtNum(calc.subtotal, 2));
    if (calc.totalDiscount > 0)
      addRow('Total Discount', '−PKR ' + fmtNum(calc.totalDiscount, 2), [239, 68, 68]);

    y += 2;
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.5);
    doc.line(totX, y, rm, y); y += 5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...GREEN);
    doc.text('TOTAL', totX, y);
    doc.text('PKR ' + fmtNum(calc.grandTotal, 2), rm, y, { align:'right' });
    y += 12;

    /* ── Footer ── */
    doc.setDrawColor(...GRAY_L); doc.line(lm, y, rm, y); y += 7;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY);
    doc.text('"Serving health, delivering hope."', 105, y, { align:'center' }); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Thank You for Choosing ${pharmacyInfo.pharmacy_name}`, 105, y, { align:'center' }); y += 8;
    doc.setFontSize(7);
    doc.text(`Digitally signed by ${pharmacistName} — ${billNo}`, 105, y, { align:'center' });

    doc.save(`Receipt_${billNo}.pdf`);
  }

  /* ── Boot ─────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);

}());
