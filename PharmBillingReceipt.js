// ============================================================
//  PharmBillingReceipt.js  v2
//  Dynamic receipt — loads bill data via get_bill_receipt RPC
//  PDF generation via jsPDF + autotable
// ============================================================

(function () {
  'use strict';

  const { createClient } = window.supabase;
  const sb = createClient(
    'https://ktzsshlllyjuzphprzso.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic'
  );

  // ── DOM helper ──────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  // ── Escape ──────────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Format helpers ───────────────────────────────────────────
  function fmtDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' });
  }
  function fmtDateTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) + ', ' +
           d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  }
  function fmtNum(n, decimals = 2) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function initials(name) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    const f = parts[0]?.[0] || '';
    const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (f + l).toUpperCase() || '?';
  }
  function capitalize(str) {
    if (!str) return '—';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // ── Payment icon ─────────────────────────────────────────────
  const METHOD_META = {
    cash:      { icon: 'fa-money-bill-wave', label: 'Cash' },
    jazzcash:  { icon: 'fa-mobile-screen',   label: 'JazzCash' },
    easypaisa: { icon: 'fa-mobile-screen',   label: 'EasyPaisa' },
    card:      { icon: 'fa-credit-card',      label: 'Card' },
  };

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

  // ── Sidebar ──────────────────────────────────────────────────
  function initSidebar() {
    const hamBtn   = $('hamBtn');
    const sidebar  = $('sidebar');
    const sOverlay = $('sOverlay');
    if (hamBtn)   hamBtn.addEventListener('click', () => sidebar?.classList.toggle('open'));
    if (sOverlay) sOverlay.addEventListener('click', () => sidebar?.classList.remove('open'));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') sidebar?.classList.remove('open'); });
  }

  // ── Sidebar avatar ───────────────────────────────────────────
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
    initSidebar();

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.href = 'Login.html'; return; }

    const userId = session.user.id;
    const { data: profile } = await sb.from('profiles').select('full_name, profile_img').eq('user_id', userId).single();
    const displayName = profile?.full_name || session.user.email?.split('@')[0] || 'Pharmacist';
    const nameEl = $('sidebarName');
    if (nameEl) nameEl.textContent = displayName;
    renderSidebarAvatar(profile?.profile_img || null, initials(displayName));

    // ── Try inline data first (set by PharmBilling.js after save) ──
    const inlineRaw = sessionStorage.getItem('mf_bill_data');
    if (inlineRaw) {
      try {
        const payload = JSON.parse(inlineRaw);
        // Clear so refreshing falls back to RPC instead of stale data
        sessionStorage.removeItem('mf_bill_data');

        // Normalize into the same shape populateReceipt() expects
        const rpcShape = {
          header:  payload.header,
          items:   payload.items,
          payment: payload.payment,
          pharmacy: payload.pharmacy
        };

        // Use the pharmacistName embedded in the payload (more accurate
        // than the currently-logged-in user's display name in edge cases)
        const pharmacistForReceipt = payload.pharmacistName || displayName;

        showReceipt();
        $('receiptLoading').style.display = 'none';
        populateReceipt(rpcShape, pharmacistForReceipt);
        showReceipt();
        initDownloadPdf();
        return;
      } catch (parseErr) {
        console.warn('Failed to parse mf_bill_data, falling back to RPC:', parseErr);
      }
    }

    // ── Fallback: load from DB via RPC (e.g. when opening from history) ──
    const billId = sessionStorage.getItem('mf_bill_id');
    if (!billId) {
      showError('No bill selected. Please go back and click on a transaction.');
      return;
    }

    await loadReceipt(billId, displayName);
    initDownloadPdf();
  }

  // ── Show / hide states ───────────────────────────────────────
  function showLoading() {
    $('receiptLoading').style.display  = 'flex';
    $('receiptError').hidden           = true;
    $('receiptDoc').hidden             = true;
  }
  function showError(msg) {
    $('receiptLoading').style.display  = 'none';
    $('receiptError').hidden           = false;
    $('receiptDoc').hidden             = true;
    const msgEl = $('receiptErrorMsg');
    if (msgEl) msgEl.textContent = msg;
  }
  function showReceipt() {
    $('receiptLoading').style.display  = 'none';
    $('receiptError').hidden           = true;
    $('receiptDoc').hidden             = false;
  }

  // ══════════════════════════════════════════════════════════════
  //  LOAD RECEIPT DATA
  // ══════════════════════════════════════════════════════════════
  async function loadReceipt(billId, pharmacistName) {
    showLoading();
    try {
      const { data, error } = await sb.rpc('get_bill_receipt', { p_bill_id: billId });
      if (error) throw error;
      if (!data) throw new Error('Receipt data not found.');

      populateReceipt(data, pharmacistName);
      showReceipt();
    } catch (err) {
      console.error('Receipt load error:', err);
      showError('Could not load receipt. ' + (err.message || ''));
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  POPULATE DOM
  // ══════════════════════════════════════════════════════════════
  function populateReceipt(data, pharmacistName) {
    const h       = data.header  || {};
    const items   = data.items   || [];
    const payment = data.payment || {};
    const pharm   = data.pharmacy || {};

    // Page title
    const titleEl = $('receiptPageTitle');
    if (titleEl) titleEl.textContent = `Transaction Receipt — ${h.bill_no || ''}`;

    // Pharmacy info
    setText('rPharmName', pharm.pharmacy_name || 'MediFinder Pharmacy');
    const addressEl = $('rPharmAddress');
    if (addressEl) {
      const phone = pharm.phone_no ? `<a href="tel:${esc(pharm.phone_no)}">${esc(pharm.phone_no)}</a>` : '';
      addressEl.innerHTML = esc(pharm.address || '').replace(/,\s*/g, ',<br>') + (phone ? '<br>' + phone : '');
    }

    // Bill no & status
    setText('rBillNo', 'Bill ID: ' + (h.bill_no || '—'));

    // Customer
    const custName = h.customer_name || '—';
    const ini      = initials(custName);
    const avatarEl = $('rCustAvatar');
    if (avatarEl) avatarEl.textContent = ini;

    setText('rCustName',  custName);
    const phoneEl = $('rCustPhone');
    if (phoneEl) {
      const ph = h.customer_phone || '';
      phoneEl.innerHTML = ph ? `<a href="tel:${esc(ph)}">${esc(ph)}</a>` : '—';
    }
    setText('rServedBy', `Served by: ${esc(pharmacistName)}`);

    // Transaction details
    const billedAtEl = $('rBilledAt');
    if (billedAtEl) {
      billedAtEl.textContent = fmtDateTime(h.billed_at);
      billedAtEl.setAttribute('datetime', h.billed_at || '');
    }

    const method   = METHOD_META[payment.method] || { icon: 'fa-circle-question', label: capitalize(payment.method) };
    const iconEl   = $('rPaymentIcon');
    const methodEl = $('rPaymentMethod');
    if (iconEl)   iconEl.className = `fa-solid ${method.icon}`;
    if (methodEl) {
      let methodLabel = method.label;
      if (payment.reference_no) methodLabel += ` ${payment.reference_no}`;
      methodEl.textContent = methodLabel;
    }

    // Items
    const itemsContainer = $('rItemsList');
    if (itemsContainer) {
      itemsContainer.innerHTML = items.map(item => {
        const unitPrice = item.discounted_price != null ? Number(item.discounted_price) : Number(item.original_price);
        const qty       = Number(item.quantity);
        const subtotal  = unitPrice * qty;

        const discLine = item.discount_pct > 0
          ? `<span style="color:var(--clr-red);font-size:11px;margin-left:4px">−${Number(item.discount_pct).toFixed(0)}% disc</span>`
          : '';

        return `<div class="item-row">
          <div>
            <p class="item-name">${esc(item.product_name)}</p>
            <p class="item-sub">${esc(item.strength)} · ${esc(item.dosage_form)} · Qty: ${qty}${discLine}</p>
          </div>
          <div class="item-price">PKR ${fmtNum(subtotal)}</div>
        </div>`;
      }).join('');
    }

    // Totals
    const totalsContainer = $('rTotals');
    if (totalsContainer) {
      let html = `<div class="total-row">
          <span class="total-row-label">Subtotal</span>
          <span>PKR ${fmtNum(h.subtotal)}</span>
        </div>`;
      if (Number(h.total_discount) > 0) {
        html += `<div class="total-row">
          <span class="total-row-label">Total Discount</span>
          <span class="total-row-discount">−PKR ${fmtNum(h.total_discount)}</span>
        </div>`;
      }
      if (Number(h.gst_amount) > 0) {
        html += `<div class="total-row">
          <span class="total-row-label">GST (17%)</span>
          <span class="total-row-tax">+PKR ${fmtNum(h.gst_amount)}</span>
        </div>`;
      }
      totalsContainer.innerHTML = html;
    }

    // Grand total
    setText('rGrandTotal', `PKR ${fmtNum(h.grand_total)}`);

    // Thank you footer
    setText('rThankPharm', `Thank You for Choosing ${pharm.pharmacy_name || 'MediFinder'}`);

    // Signed note
    const signedEl = $('rSignedNote');
    if (signedEl) {
      signedEl.innerHTML = `<i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        Digitally signed and verified receipt generated by ${esc(pharmacistName)} on ${fmtDate(h.billed_at)}`;
    }

    // Store data on window for PDF generation
    window._receiptData = { h, items, payment, pharm, pharmacistName };
  }

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = String(val ?? '');
  }

  // ══════════════════════════════════════════════════════════════
  //  PDF GENERATION
  // ══════════════════════════════════════════════════════════════
  function initDownloadPdf() {
    const btn = $('downloadPdfBtn');
    if (!btn) return;
    btn.addEventListener('click', generatePdf);
  }

  function generatePdf() {
    if (!window._receiptData) { showToast('Receipt data not ready.', 'error'); return; }

    const { jsPDF } = window.jspdf;
    if (!jsPDF) { showToast('PDF library not loaded.', 'error'); return; }

    const { h, items, payment, pharm, pharmacistName } = window._receiptData;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const GREEN  = [32, 139, 58];
    const DARK   = [26, 26, 26];
    const GRAY   = [107, 114, 128];
    const GRAY_L = [229, 231, 235];

    let y = 20;
    const lm = 20; // left margin
    const rm = 190; // right margin (A4 = 210mm)

    // ── Header band ──────────────────────────────────────────────
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, 210, 36, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(pharm.pharmacy_name || 'MediFinder Pharmacy', lm, 16);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Transaction Receipt', lm, 23);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('PAID', rm - 4, 16, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(h.bill_no || '—', rm - 4, 22, { align: 'right' });

    y = 48;

    // ── Info grid ────────────────────────────────────────────────
    doc.setTextColor(...GRAY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('CUSTOMER', lm, y);
    doc.text('TRANSACTION', 115, y);

    y += 5;
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(h.customer_name || '—', lm, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(h.customer_phone || '', lm, y + 5);
    doc.text(`Served by: ${pharmacistName}`, lm, y + 10);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(fmtDateTime(h.billed_at), 115, y);

    const method = METHOD_META[payment.method] || { label: capitalize(payment.method) };
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(method.label + (payment.reference_no ? ' ' + payment.reference_no : ''), 115, y + 5);

    y += 22;

    // ── Divider ──────────────────────────────────────────────────
    doc.setDrawColor(...GRAY_L);
    doc.line(lm, y, rm, y);
    y += 8;

    // ── Items table ──────────────────────────────────────────────
    const tableBody = items.map(item => {
      const unitPrice = item.discounted_price != null ? Number(item.discounted_price) : Number(item.original_price);
      const subtotal  = unitPrice * Number(item.quantity);
      const discStr   = item.discount_pct > 0 ? `-${Number(item.discount_pct).toFixed(0)}%` : '—';
      return [
        item.product_name + '\n' + item.strength + ' · ' + item.dosage_form,
        String(item.quantity),
        'PKR ' + fmtNum(item.original_price),
        discStr,
        'PKR ' + fmtNum(subtotal)
      ];
    });

    doc.autoTable({
      startY:   y,
      head:     [['Item', 'Qty', 'Unit Price', 'Disc %', 'Subtotal']],
      body:     tableBody,
      margin:   { left: lm, right: 20 },
      styles:   { fontSize: 9, cellPadding: 3, textColor: DARK },
      headStyles: { fillColor: GREEN, textColor: [255,255,255], fontStyle: 'bold', fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 14, halign: 'center' },
        2: { cellWidth: 28, halign: 'right' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 30, halign: 'right' }
      },
      alternateRowStyles: { fillColor: [248, 250, 248] }
    });

    y = doc.lastAutoTable.finalY + 8;

    // ── Totals ───────────────────────────────────────────────────
    const totalsX = 120;
    const valX    = rm;

    const addTotalRow = (label, value, color = DARK, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(bold ? 10 : 9);
      doc.setTextColor(...color);
      doc.text(label, totalsX, y);
      doc.text(value, valX, y, { align: 'right' });
      y += 6;
    };

    doc.setDrawColor(...GRAY_L);
    doc.line(totalsX, y - 2, rm, y - 2);

    addTotalRow('Subtotal',        'PKR ' + fmtNum(h.subtotal));
    if (Number(h.total_discount) > 0) {
      addTotalRow('Total Discount', '−PKR ' + fmtNum(h.total_discount), [239, 68, 68]);
    }
    if (Number(h.gst_amount) > 0) {
      addTotalRow('GST (17%)',      '+PKR ' + fmtNum(h.gst_amount), [245, 158, 11]);
    }

    y += 2;
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.line(totalsX, y, rm, y);
    y += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...GREEN);
    doc.text('TOTAL', totalsX, y);
    doc.text('PKR ' + fmtNum(h.grand_total), valX, y, { align: 'right' });

    y += 12;

    // ── Footer ───────────────────────────────────────────────────
    doc.setDrawColor(...GRAY_L);
    doc.line(lm, y, rm, y);
    y += 7;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text('"Serving health, delivering hope."', 105, y, { align: 'center' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Thank You for Choosing ${pharm.pharmacy_name || 'MediFinder'}`, 105, y, { align: 'center' });
    y += 8;

    doc.setFontSize(7);
    doc.text(
      `Digitally signed by ${pharmacistName} on ${fmtDate(h.billed_at)} · ${h.bill_no}`,
      105, y, { align: 'center' }
    );

    // ── Save ─────────────────────────────────────────────────────
    doc.save(`Receipt_${h.bill_no || 'download'}.pdf`);
    showToast('PDF downloaded successfully.', 'success');
  }

  // ── Boot ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

}());
