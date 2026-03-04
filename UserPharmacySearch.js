/* MediFinder — UserPharmacySearch.js */
(function () {
    'use strict';

    /* Sidebar toggle (mobile) */
    const sidebar        = document.getElementById('sidebar');
    const hamburgerBtn   = document.getElementById('hamburgerBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    function openSidebar()  { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* Sort buttons */
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('sort-btn--active'));
            btn.classList.add('sort-btn--active');
        });
    });

    /* Alternatives toggle */
    document.querySelectorAll('.alternatives-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const icon   = btn.querySelector('i');
            const isOpen = icon.classList.contains('fa-chevron-up');
            icon.classList.toggle('fa-chevron-down', isOpen);
            icon.classList.toggle('fa-chevron-up',  !isOpen);
        });
    });
})();
