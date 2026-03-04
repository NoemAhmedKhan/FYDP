/* =============================================
   MEDFINDER — UserHistory.js
   Sidebar toggle for mobile
   ============================================= */

(function () {
    const sidebar      = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const overlay      = document.getElementById('sidebarOverlay');

    function openSidebar()  { sidebar.classList.add('sidebar--open'); }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); }

    hamburgerBtn.addEventListener('click', function () {
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar();
    });

    overlay.addEventListener('click', closeSidebar);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSidebar();
    });
})();
