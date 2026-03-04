/* =============================================
   MEDFINDER — UserReminders.js
   Sidebar toggle + card actions + search filter
   Tab navigation handled via <a> href links —
   no JS tab-switching logic needed.
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
  if (overlay) { overlay.addEventListener('click', closeSidebar); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  /* ── Taken button: mark card and redirect to Taken page ── */
  document.querySelectorAll('.btn-taken').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const card = this.closest('.reminder-card');
      card.style.transition = 'opacity .3s ease, transform .3s ease';
      card.style.opacity    = '0';
      card.style.transform  = 'translateY(-8px)';
      setTimeout(function () {
        card.remove();
      }, 320);
    });
  });

  /* ── Remove button ── */
  document.querySelectorAll('.btn-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const card = this.closest('.reminder-card');
      card.style.transition = 'opacity .3s ease, transform .3s ease';
      card.style.opacity    = '0';
      card.style.transform  = 'translateY(-8px)';
      setTimeout(function () { card.remove(); }, 320);
    });
  });

  /* ── Search: live filter by medication name ── */
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

  /* ── Set Reminder button (stub) ── */
  const setReminderBtn = document.getElementById('setReminderBtn');
  if (setReminderBtn) {
    setReminderBtn.addEventListener('click', function () {
      window.location.href = 'SetRemindersDaily.html';
    });
  }

})();
