// ==========================================
//  MEDIFINDER BILLING & TRANSACTION SCRIPTS
//  Fully Optimized Version
// ==========================================

(function () {
  'use strict';

  // === DOM CACHE ===
  const DOM = {
    billBody: document.getElementById('billBody'),
    addRowBtn: document.getElementById('addRowBtn'),
    cashFields: document.getElementById('cashFields'),
    onlineFields: document.getElementById('onlineFields'),
    phoneField: document.getElementById('phoneField'),
    gstInput: document.getElementById('gstInput'),
    cashReceived: document.getElementById('cashReceived'),
    subtotalValue: document.getElementById('subtotalValue'),
    gstValue: document.getElementById('gstValue'),
    discountValue: document.getElementById('discountValue'),
    grandTotal: document.getElementById('grandTotal'),
    balanceReturn: document.getElementById('balanceReturn'),
    paymentButtons: document.querySelectorAll('.pm-btn'),
    confirmBtn: document.querySelector('.btn-confirm')
  };

  // === FORMAT HELPER ===
  const fmt = (n) => n.toLocaleString('en-PK', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });

  // === PAYMENT METHOD TOGGLE ===
  DOM.paymentButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      DOM.paymentButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const method = btn.dataset.method;
      DOM.cashFields.style.display = method === 'cash' ? 'flex' : 'none';
      DOM.onlineFields.style.display = method === 'cash' ? 'none' : 'flex';
    });
  });

  // === ONLINE PAYMENT METHOD ===
  document.querySelectorAll('input[name="onlineMethod"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      e.stopPropagation();
      if (radio.checked) DOM.phoneField.style.display = 'flex';
    });
  });

  // === ADD ROW ===
  if (DOM.addRowBtn && DOM.billBody) {
    DOM.addRowBtn.onclick = () => {
      const r = document.createElement('div');
      r.className = 'bill-row';
      r.innerHTML =
        '<div class="bi-name">' +
          '<i class="fa-solid fa-magnifying-glass"></i>' +
          '<input class="bi-srch" type="text" placeholder="Search item...">' +
        '</div>' +
        '<span class="tbadge tb-med"><i class="fa-solid fa-kit-medical"></i>&nbsp;Medicine</span>' +
        '<span>&#8212;</span>' +
        '<span>&#8212;</span>' +
        '<input type="number" class="qty-in" value="1" min="1">' +
        '<span class="price-cell">0.00</span>' +
        '<input type="number" class="disc-input" value="0" min="0" max="100" step="1">' +
        '<span class="subtotal-cell fw7">0.00</span>' +
        '<button type="button" class="del-btn" aria-label="Delete row">' +
          '<i class="fa-solid fa-trash-can"></i>' +
        '</button>';
      DOM.billBody.appendChild(r);
    };
  }

  // === DELETE ROW (Event Delegation) ===
  document.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.del-btn');
    if (deleteBtn) {
      const row = deleteBtn.closest('.bill-row');
      if (row) {
        row.style.opacity = '0';
        row.style.transition = 'opacity .25s';
        setTimeout(() => {
          row.remove();
          updateCalculations();
        }, 260);
      }
    }
  });

  // === UPDATE CALCULATIONS (Optimized) ===
  function updateCalculations() {
    const rows = DOM.billBody.querySelectorAll('.bill-row');
    let subtotal = 0;
    let totalDiscount = 0;

    // Calculate row totals
    rows.forEach(row => {
      const qtyInput = row.querySelector('.qty-in');
      const priceCell = row.querySelector('.price-cell');
      const discInput = row.querySelector('.disc-input');
      const subtotalCell = row.querySelector('.subtotal-cell');

      if (!qtyInput || !priceCell || !discInput || !subtotalCell) return;

      const qty = parseInt(qtyInput.value) || 0;
      const price = parseFloat(priceCell.textContent.replace(/,/g, '')) || 0;
      const discRate = parseFloat(discInput.value) || 0;

      const lineTotal = qty * price;
      const lineDiscount = lineTotal * (discRate / 100);
      const lineSubtotal = lineTotal - lineDiscount;

      subtotalCell.textContent = fmt(lineSubtotal);
      
      subtotal += lineTotal;
      totalDiscount += lineDiscount;
    });

    // Calculate GST and grand total
    const gstRate = parseFloat(DOM.gstInput.value) || 0;
    const gst = subtotal * (gstRate / 100);
    const grandTotal = subtotal + gst - totalDiscount;

    // Update display (single DOM update batch)
    DOM.subtotalValue.textContent = 'PKR ' + fmt(subtotal);
    DOM.gstValue.textContent = 'PKR ' + fmt(gst);
    DOM.discountValue.textContent = '- PKR ' + fmt(totalDiscount);
    DOM.grandTotal.textContent = 'PKR ' + fmt(grandTotal);

    // Update balance return
    updateBalanceReturn(grandTotal);
  }

  // === UPDATE BALANCE RETURN ===
  function updateBalanceReturn(grandTotal) {
    if (!DOM.cashReceived || !DOM.balanceReturn) return;
    
    const cashAmount = parseFloat(DOM.cashReceived.value) || 0;
    const balance = Math.max(0, cashAmount - grandTotal);
    DOM.balanceReturn.textContent = 'PKR ' + fmt(balance);
  }

  // === EVENT LISTENERS (Event Delegation - No Redundancy) ===
  if (DOM.billBody) {
    DOM.billBody.addEventListener('input', (e) => {
      if (e.target.classList.contains('qty-in') || 
          e.target.classList.contains('disc-input')) {
        updateCalculations();
      }
    });
  }

  if (DOM.gstInput) {
    DOM.gstInput.addEventListener('input', updateCalculations);
  }

  if (DOM.cashReceived) {
    DOM.cashReceived.addEventListener('input', () => {
      const grandTotalText = DOM.grandTotal.textContent;
      const grandTotal = parseFloat(grandTotalText.replace(/[^0-9.-]+/g, '')) || 0;
      updateBalanceReturn(grandTotal);
    });
  }

  // === INITIAL CALCULATION ===
  updateCalculations();

  // === CONFIRM BUTTON ===
  if (DOM.confirmBtn) {
    DOM.confirmBtn.addEventListener('click', () => {
      const activePaymentBtn = document.querySelector('.pm-btn.active');
      const paymentMethod = activePaymentBtn ? activePaymentBtn.dataset.method : 'cash';

      let paymentDetails = '';
      if (paymentMethod === 'online') {
        const selectedMethod = document.querySelector('input[name="onlineMethod"]:checked');
        const onlinePhone = document.getElementById('onlinePhone');
        
        if (selectedMethod && onlinePhone && onlinePhone.value) {
          const methodName = selectedMethod.value === 'easypaisa' ? 'EasyPaisa' : 'JazzCash';
          paymentDetails = methodName + ' - ' + onlinePhone.value;
        }
      }

      alert(
        'Invoice generated successfully!\n\n' +
        'Payment Method: ' + paymentMethod.toUpperCase() +
        (paymentDetails ? '\nDetails: ' + paymentDetails : '')
      );
    });
  }

})();
