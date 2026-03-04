/* =============================================
   MEDFINDER — UserRemindersTaken.js
   Sidebar toggle + Set Reminder stub
   Tab navigation is handled via <a> href links
   ============================================= */

(function () {
  'use strict';

  /* ── Sidebar toggle ── */
  const sidebar      = document.getElementById('sidebar');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const overlay      = document.getElementById('sidebarOverlay');

  function openSidebar()  { sidebar.classList.add('sidebar--open'); }
  function closeSidebar() { sidebar.classList.remove('sidebar--open'); }

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', function () {
      sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar();
    });
  }

  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  /* ── Set Reminder button (stub) ── */
  const setReminderBtn = document.getElementById('setReminderBtn');
  if (setReminderBtn) {
    setReminderBtn.addEventListener('click', function () {
      window.location.href = 'SetRemindersDaily.html';
    });
  }

  /* ── Search: live filter ── */
  const searchInput = document.querySelector('.search-bar__input');
  const cards       = document.querySelectorAll('.reminder-card');

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      const query = this.value.trim().toLowerCase();
      cards.forEach(function (card) {
        const name = card.querySelector('.reminder-card__name')?.textContent.toLowerCase() || '';
        card.style.display = (!query || name.includes(query)) ? '' : 'none';
      });
    });
  }

})();
