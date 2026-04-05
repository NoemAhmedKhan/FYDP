/* MediFinder — UserProfile.js
   Real Supabase Auth | users table | Password update | Forgot password
*/
(function () {
    'use strict';

    /* ============================================================
       SUPABASE CONFIG — your correct project credentials
       ============================================================ */
    const SUPABASE_URL      = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

    const { createClient } = supabase;
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    /* ============================================================
       TOAST HELPER
       ============================================================ */
    const toastEl = document.getElementById('toast');
    let toastTimer = null;

    function showToast(message, type = 'success') {
        if (!toastEl) return;
        clearTimeout(toastTimer);
        toastEl.textContent = message;
        toastEl.className = `toast toast--${type} toast--show`;
        toastTimer = setTimeout(() => {
            toastEl.classList.remove('toast--show');
        }, 4000);
    }

    /* ============================================================
       HELPERS
       ============================================================ */
    function val(id)     { return document.getElementById(id)?.value.trim() || null; }
    function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
    function setVal(id, v)  { const el = document.getElementById(id); if (el) el.value = v ?? ''; }

    /** Return "JD" style initials from a full name string */
    function initials(first, last) {
        const f = (first || '').trim()[0] || '';
        const l = (last  || '').trim()[0] || '';
        return (f + l).toUpperCase() || '?';
    }

    /** Render initials in the big avatar card */
    function setAvatarInitials(first, last) {
        const el = document.getElementById('avatarInitials');
        if (el) el.textContent = initials(first, last);
    }

    /** Render initials in the sidebar user footer */
    function setSidebarInitials(first, last) {
        const el = document.getElementById('sidebarInitials');
        if (el) el.textContent = initials(first, last);
    }

    /* ============================================================
       SIDEBAR TOGGLE (mobile)
       ============================================================ */
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

    /* ============================================================
       AVATAR UPLOAD PREVIEW (local preview only)
       ============================================================ */
    const avatarInput = document.getElementById('avatarInput');
    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const avatarImg = document.getElementById('avatarImg');
            if (!avatarImg) return;
            // Remove initials, insert real <img>
            let img = avatarImg.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                avatarImg.appendChild(img);
            }
            img.src = e.target.result;
            img.alt = 'Profile Photo';
            img.style.display = 'block';
            const initEl = document.getElementById('avatarInitials');
            if (initEl) initEl.style.display = 'none';
        };
        reader.readAsDataURL(file);
    });

    /* ============================================================
       PASSWORD VISIBILITY TOGGLES
       ============================================================ */
    document.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            const icon = btn.querySelector('i');
            icon.classList.toggle('fa-eye-slash', !isHidden);
            icon.classList.toggle('fa-eye',        isHidden);
        });
    });

    /* ============================================================
       POPULATE UI FROM USER DATA
       ============================================================ */
    function populateUI(user, profile) {
        /* Email comes from auth, not the users table */
        const email     = user.email || '';
        const firstName = profile.first_name || '';
        const lastName  = profile.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';

        /* Form fields */
        setVal('firstName',   firstName);
        setVal('lastName',    lastName);
        setVal('email',       email);
        setVal('phone',       profile.phone_no     || '');
        setVal('street',      profile.address      || '');
        setVal('city',        profile.city         || '');
        setVal('coordinates', profile.coordinates  || '');

        /* Avatar card */
        setText('avatarName',  fullName);
        setText('avatarEmail', email);
        setAvatarInitials(firstName, lastName);

        /* Sidebar footer */
        setText('sidebarUserName',  fullName);
        setText('sidebarUserEmail', email);
        setSidebarInitials(firstName, lastName);
    }

    /* ============================================================
       LOAD SESSION + PROFILE
       ============================================================ */
    let currentUser = null;
    let originalProfile = null;   // kept so Cancel can restore

    async function loadProfile() {
        /* 1. Get logged-in user from Supabase Auth */
        const { data: { user }, error: authError } = await db.auth.getUser();

        if (authError || !user) {
            /* Not logged in — redirect to login */
            window.location.href = 'Login.html';
            return;
        }

        currentUser = user;

        /* 2. Fetch matching row from users table */
        const { data: profile, error: dbError } = await db
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (dbError && dbError.code !== 'PGRST116') {
            showToast('Could not load profile: ' + dbError.message, 'error');
            return;
        }

        originalProfile = profile || {};
        populateUI(user, originalProfile);
    }

    /* ============================================================
       LOGOUT
       ============================================================ */
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn && logoutBtn.addEventListener('click', async () => {
        await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ============================================================
       SAVE CHANGES
       ============================================================ */
    const saveBtn = document.getElementById('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError = false;

        /* ── 1. Update profile fields in users table ── */
        const profileData = {
            first_name:  val('firstName'),
            last_name:   val('lastName'),
            phone_no:    val('phone'),
            address:     val('street'),
            city:        val('city'),
            coordinates: val('coordinates'),
        };

        const { error: updateError } = await db
            .from('users')
            .update(profileData)
            .eq('id', currentUser.id);

        if (updateError) {
            showToast('Profile update failed: ' + updateError.message, 'error');
            hasError = true;
        } else {
            /* Refresh local copy */
            originalProfile = { ...originalProfile, ...profileData };
            /* Update UI name/email display */
            const fullName = [profileData.first_name, profileData.last_name].filter(Boolean).join(' ') || 'User';
            setText('avatarName',       fullName);
            setText('sidebarUserName',  fullName);
            setAvatarInitials(profileData.first_name, profileData.last_name);
            setSidebarInitials(profileData.first_name, profileData.last_name);
        }

        /* ── 2. Password update (only if the user typed something) ── */
        const newPw      = val('newPassword');
        const confirmPw  = val('confirmPassword');

        if (newPw || confirmPw) {
            if (newPw !== confirmPw) {
                showToast('Passwords do not match. Please try again.', 'error');
                hasError = true;
            } else if (newPw.length < 6) {
                showToast('Password must be at least 6 characters.', 'error');
                hasError = true;
            } else {
                const { error: pwError } = await db.auth.updateUser({ password: newPw });
                if (pwError) {
                    showToast('Password update failed: ' + pwError.message, 'error');
                    hasError = true;
                } else {
                    /* Clear the password fields after success */
                    setVal('newPassword',     '');
                    setVal('confirmPassword', '');
                }
            }
        }

        if (!hasError) {
            showToast('✓ Profile saved successfully!', 'success');
        }

        resetSaveBtn();
    }

    function resetSaveBtn() {
        if (!saveBtn) return;
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }

    saveBtn && saveBtn.addEventListener('click', saveProfile);

    /* ============================================================
       CANCEL — restore from last loaded data
       ============================================================ */
    const cancelBtn = document.getElementById('cancelBtn');
    cancelBtn && cancelBtn.addEventListener('click', () => {
        if (currentUser && originalProfile) {
            populateUI(currentUser, originalProfile);
        }
        setVal('newPassword',     '');
        setVal('confirmPassword', '');
        showToast('Changes discarded.', 'info');
    });

    /* ============================================================
       FORGOT PASSWORD — sends reset email via Supabase Auth
       ============================================================ */
    const forgotLink = document.getElementById('forgotPasswordLink');
    forgotLink && forgotLink.addEventListener('click', async (e) => {
        e.preventDefault();

        const email = currentUser?.email;
        if (!email) {
            showToast('No email address found for your account.', 'error');
            return;
        }

        /* The redirect URL should be your password-reset page.
           Update this to wherever you handle the reset link landing. */
        const redirectTo = window.location.origin + '/ResetPassword.html';

        forgotLink.style.pointerEvents = 'none';
        forgotLink.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

        const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo
        });

        forgotLink.style.pointerEvents = '';
        forgotLink.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Forgot Password?';

        if (error) {
            showToast('Could not send reset email: ' + error.message, 'error');
        } else {
            showToast(`✓ Password reset email sent to ${email}`, 'success');
        }
    });

    /* ============================================================
       INIT
       ============================================================ */
    loadProfile();

})();
