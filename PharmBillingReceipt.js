// ==========================================
//  MEDIFINDER PHARMACIST BILLING RECEIPT SCRIPTS
// ==========================================

(function () {
  'use strict';

  // === DOM ELEMENTS ===
  const sidebar  = document.getElementById('sidebar');
  const hamBtn   = document.getElementById('hamBtn');
  const sOverlay = document.getElementById('sOverlay');

  // === SIDEBAR FUNCTIONALITY ===
  function toggleSidebar() {
    if (sidebar) {
      const isOpen = sidebar.classList.toggle('open');
      if (hamBtn) hamBtn.setAttribute('aria-expanded', String(isOpen));
    }
  }

  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('open');
      if (hamBtn) hamBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (hamBtn)   hamBtn.addEventListener('click', toggleSidebar);
  if (sOverlay) sOverlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  // === DOWNLOAD PDF (placeholder) ===
  const downloadBtn = document.querySelector('.btn-secondary');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', function () {
      alert('PDF download feature coming soon!');
    });
  }

}());
