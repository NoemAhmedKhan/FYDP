// ==========================================
//  MEDIFINDER SMART BUNDLE CREATOR SCRIPTS
// ==========================================

(function () {
  'use strict';

  // === DOM CACHE ===
  const DOM = {
    selItemsBody: document.getElementById('selItemsBody'),
    discInput:    document.getElementById('discInput'),
    combinedVal:  document.getElementById('combinedVal'),
    pkgPrice:     document.getElementById('pkgPrice'),
  };

  // === FORMAT HELPER ===
  const fmt = (n) => n.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  // === RECALCULATE PRICING ===
  function recalc() {
    let total = 0;
    document.querySelectorAll('.sel-item').forEach(el => {
      total += parseFloat(el.dataset.price || 0);
    });

    const disc = parseFloat(DOM.discInput.value) || 0;
    const pkg  = Math.round(total * (1 - disc / 100));

    DOM.combinedVal.textContent = 'PKR ' + fmt(total);
    DOM.pkgPrice.textContent    = 'PKR ' + fmt(pkg);
  }

  // === REMOVE ITEM (Event Delegation) ===
  document.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.si-remove');
    if (removeBtn) {
      const item = removeBtn.closest('.sel-item');
      if (item) {
        item.style.opacity    = '0';
        item.style.transform  = 'translateX(10px)';
        item.style.transition = 'all .25s';
        setTimeout(() => {
          item.remove();
          recalc();
        }, 260);
      }
    }
  });

  // === DISCOUNT INPUT LISTENER ===
  if (DOM.discInput) {
    DOM.discInput.addEventListener('input', recalc);
  }

  // === INITIAL CALCULATION ===
  recalc();

  // === PUBLISH BUTTON ===
  const publishBtn = document.querySelector('.btn-publish');
  if (publishBtn) {
    publishBtn.addEventListener('click', () => {
      const bundleName  = document.querySelector('.bf input[type="text"]')?.value || 'Unnamed Bundle';
      const validity    = document.querySelector('.bf input[type="date"]')?.value  || 'No date set';
      const itemCount   = document.querySelectorAll('.sel-item').length;
      const pkgPrice    = DOM.pkgPrice.textContent;

      alert(
        'Bundle published successfully!\n\n' +
        'Bundle: '    + bundleName + '\n' +
        'Items: '     + itemCount  + '\n' +
        'Price: '     + pkgPrice   + '\n' +
        'Valid Until: ' + validity
      );
    });
  }

})();
