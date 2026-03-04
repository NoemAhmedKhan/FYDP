/* MediFinder — Profile.js */
(function () {
    'use strict';

    /* ── Sidebar toggle (mobile) ── */
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

    /* ── Avatar upload preview ── */
    const avatarInput  = document.getElementById('avatarInput');
    const avatarPhoto  = document.getElementById('avatarPhoto');
    const avatarInitials = document.getElementById('avatarInitials');

    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            if (avatarPhoto) {
                avatarPhoto.src = e.target.result;
                avatarPhoto.style.display = 'block';
            }
            if (avatarInitials) avatarInitials.style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    /* ── Password visibility toggles ── */
    document.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input    = document.getElementById(targetId);
            if (!input) return;
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            const icon = btn.querySelector('i');
            icon.classList.toggle('fa-eye-slash', !isHidden);
            icon.classList.toggle('fa-eye',       isHidden);
        });
    });

    /* ── Cancel: reset form to original values ── */
    const cancelBtn = document.getElementById('cancelBtn');
    const profileForm = document.getElementById('profileForm');

    cancelBtn && cancelBtn.addEventListener('click', () => {
        if (profileForm) profileForm.reset();
        document.getElementById('currentPassword') && (document.getElementById('currentPassword').value = '');
        document.getElementById('newPassword')     && (document.getElementById('newPassword').value = '');
    });

    /* ── Save: show brief confirmation ── */
    const saveBtn = document.getElementById('saveBtn');

    saveBtn && saveBtn.addEventListener('click', () => {
        const orig = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
        saveBtn.style.background = 'var(--green-light)';
        setTimeout(() => {
            saveBtn.innerHTML = orig;
            saveBtn.style.background = '';
        }, 2000);
    });

})();
