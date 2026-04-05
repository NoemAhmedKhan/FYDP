/* ============================================================
   MediFinder — UserProfile.js

   Key fixes in this version:
   ─ Avatar rendered 100% by JS (no HTML onerror display:none bug)
   ─ Default image = Images/ProfileAvatar.jpg; falls back to initials
     only if that file itself fails to load
   ─ Old Password + New Password with proper re-authentication
     before applying the password change
   ─ Reuses window.supabaseClient (no duplicate client / session bug)
   ─ Correct table: 'users', correct columns: phone_no, address
   ============================================================ */
(function () {
    'use strict';

    /* ── Reuse shared Supabase client from supabase.js ── */
    const db = window.supabaseClient;
    if (!db) {
        console.error('UserProfile.js: window.supabaseClient not found. Load supabase.js first.');
        return;
    }

    const AVATAR_BUCKET = 'avatars';   // your public Supabase Storage bucket

    /* ============================================================
       TOAST
       ============================================================ */
    const toastEl = document.getElementById('toast');
    let _toastTimer;
    function showToast(msg, type = 'success') {
        if (!toastEl) return;
        clearTimeout(_toastTimer);
        toastEl.textContent = msg;
        toastEl.className   = `toast toast--${type} toast--show`;
        _toastTimer = setTimeout(() => toastEl.classList.remove('toast--show'), 4500);
    }

    /* ============================================================
       DOM HELPERS
       ============================================================ */
    const $  = id => document.getElementById(id);
    const val      = id => $(id)?.value.trim() || '';
    const setVal   = (id, v) => { const el = $(id); if (el) el.value       = v ?? ''; };
    const setText  = (id, v) => { const el = $(id); if (el) el.textContent = v ?? ''; };

    function getInitials(first, last) {
        return (((first || '')[0]) + ((last || '')[0])).toUpperCase();
    }

    /* ============================================================
       AVATAR RENDERING
       ─────────────────────────────────────────────────────────────
       Instead of placing an <img> in the HTML and fighting
       onerror/display:none state, we let JS own the container
       completely. renderAvatar() always clears and re-renders.

       Priority:
         1. customUrl  — user's uploaded photo from Supabase Storage
         2. Default    — Images/ProfileAvatar.jpg
         3. Initials   — if default image also fails to load
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText, size = 'large') {
        const container = $(containerId);
        if (!container) return;

        /* Always start clean */
        container.innerHTML = '';

        const imgSrc = imageUrl || 'Images/ProfileAvatar.jpg';
        const img    = document.createElement('img');

        if (size === 'large') {
            img.className = 'avatar-photo';
        } else {
            /* sidebar small avatar — inline style since it inherits from .sidebar-avatar-inner img */
        }

        img.alt = 'Profile Photo';
        img.src = imgSrc;

        /* If the image loads successfully, show it */
        img.onload = () => {
            container.innerHTML = '';
            container.appendChild(img);
        };

        /* If the image fails (e.g. ProfileAvatar.jpg missing on GitHub Pages),
           fall back to initials text */
        img.onerror = () => {
            container.innerHTML = '';
            const span       = document.createElement('span');
            span.className   = 'avatar-initials-text';
            span.textContent = initialsText || '?';
            container.appendChild(span);
        };

        /* Kick off the load — onload/onerror will fire asynchronously */
        /* For blob/data URLs (local preview) they fire synchronously-ish */
    }

    /* Convenience wrappers */
    function setMainAvatar(url, initials) {
        renderAvatar('avatarImgContainer', url, initials, 'large');
    }
    function setSidebarAvatar(url, initials) {
        renderAvatar('sidebarAvatarInner', url, initials, 'small');
    }

    /* ============================================================
       SIDEBAR TOGGLE (mobile)
       ============================================================ */
    const sidebar        = $('sidebar');
    const hamburgerBtn   = $('hamburgerBtn');
    const sidebarOverlay = $('sidebarOverlay');

    const openSidebar  = () => { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; };
    const closeSidebar = () => { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; };

    hamburgerBtn   && hamburgerBtn.addEventListener('click',
        () => sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar());
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* ============================================================
       PASSWORD VISIBILITY TOGGLES
       ============================================================ */
    document.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input  = $(btn.dataset.target);
            if (!input) return;
            const hidden = input.type === 'password';
            input.type   = hidden ? 'text' : 'password';
            btn.querySelector('i').classList.toggle('fa-eye-slash', !hidden);
            btn.querySelector('i').classList.toggle('fa-eye',        hidden);
        });
    });

    /* ============================================================
       AVATAR FILE SELECTION
       ─ Shows an instant local preview (blob URL)
       ─ Stores the file; actual upload happens on Save
       ============================================================ */
    const avatarInput = $('avatarInput');
    let pendingAvatarFile = null;
    let currentInitials   = '';

    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;

        /* Validate size (≤ 2 MB — matches your bucket policy) */
        if (file.size > 2 * 1024 * 1024) {
            showToast('Image must be 2 MB or smaller.', 'error');
            this.value = '';
            return;
        }

        pendingAvatarFile = file;

        /* Local blob URL preview — no upload yet */
        const blobUrl = URL.createObjectURL(file);
        setMainAvatar(blobUrl, currentInitials);
        setSidebarAvatar(blobUrl, currentInitials);
    });

    /* ── Upload file to Supabase Storage, return permanent public URL ── */
    async function uploadAvatar(userId, file) {
        /* Always use the same filename so it replaces the previous upload */
        const ext      = file.name.split('.').pop().toLowerCase() || 'jpg';
        const filePath = `${userId}/avatar.${ext}`;

        const { error } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, {
                upsert:      true,       // overwrite if exists
                contentType: file.type,
                cacheControl: '3600',
            });

        if (error) throw new Error(error.message);

        /* getPublicUrl is synchronous — returns the URL string */
        const { data } = db.storage
            .from(AVATAR_BUCKET)
            .getPublicUrl(filePath);

        /* Cache-bust so the browser re-fetches the new version */
        return `${data.publicUrl}?v=${Date.now()}`;
    }

    /* ============================================================
       POPULATE UI
       ============================================================ */
    function populateUI(user, profile) {
        const email     = user.email      || '';
        const firstName = profile.first_name || '';
        const lastName  = profile.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';
        currentInitials = getInitials(firstName, lastName) || '?';

        /* Form fields */
        setVal('firstName',   firstName);
        setVal('lastName',    lastName);
        setVal('email',       email);
        setVal('phone',       profile.phone_no    || '');
        setVal('street',      profile.address     || '');
        setVal('city',        profile.city        || '');
        setVal('coordinates', profile.coordinates || '');

        /* Name / email display */
        setText('avatarName',       fullName);
        setText('avatarEmail',      email);
        setText('sidebarUserName',  fullName);
        setText('sidebarUserEmail', email);

        /* Avatars — custom URL if saved, otherwise default image */
        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl, currentInitials);
        setSidebarAvatar(customUrl, currentInitials);
    }

    /* ============================================================
       LOAD PROFILE
       ============================================================ */
    let currentUser     = null;
    let originalProfile = null;

    async function loadProfile() {
        const { data: { user }, error: authErr } = await db.auth.getUser();
        if (authErr || !user) {
            window.location.href = 'Login.html';
            return;
        }
        currentUser = user;

        const { data: profile, error: dbErr } = await db
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (dbErr && dbErr.code !== 'PGRST116') {
            showToast('Could not load profile: ' + dbErr.message, 'error');
            return;
        }

        originalProfile = profile || {};
        populateUI(user, originalProfile);
    }

    /* ============================================================
       LOGOUT
       ============================================================ */
    $('logoutBtn') && $('logoutBtn').addEventListener('click', async () => {
        await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ============================================================
       SAVE CHANGES
       Step 1 — Upload avatar (if a new file was selected)
       Step 2 — Update profile fields in users table
       Step 3 — Change password (if Old + New password provided)
                Uses re-authentication with old password for safety
       ============================================================ */
    const saveBtn = $('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError     = false;
        let newAvatarUrl = null;

        /* ─────── Step 1: Avatar upload ─────── */
        if (pendingAvatarFile) {
            try {
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile);
                pendingAvatarFile = null;
            } catch (err) {
                showToast('Avatar upload failed: ' + err.message, 'error');
                hasError = true;
            }
        }

        /* ─────── Step 2: Profile fields ─────── */
        if (!hasError) {
            const patch = {
                first_name:  val('firstName')   || null,
                last_name:   val('lastName')    || null,
                phone_no:    val('phone')       || null,
                address:     val('street')      || null,
                city:        val('city')        || null,
                coordinates: val('coordinates') || null,
            };
            if (newAvatarUrl) patch.profile_img = newAvatarUrl;

            const { error: updateErr } = await db
                .from('users')
                .update(patch)
                .eq('id', currentUser.id);

            if (updateErr) {
                showToast('Profile update failed: ' + updateErr.message, 'error');
                hasError = true;
            } else {
                /* Update local cache & UI */
                originalProfile = { ...originalProfile, ...patch };
                const fullName  = [patch.first_name, patch.last_name].filter(Boolean).join(' ') || 'User';
                currentInitials = getInitials(patch.first_name, patch.last_name) || '?';

                setText('avatarName',      fullName);
                setText('sidebarUserName', fullName);

                if (newAvatarUrl) {
                    setMainAvatar(newAvatarUrl, currentInitials);
                    setSidebarAvatar(newAvatarUrl, currentInitials);
                }
            }
        }

        /* ─────── Step 3: Password change ─────── */
        const oldPw = val('oldPassword');
        const newPw = val('newPassword');

        if (oldPw || newPw) {
            /* Both fields are required when changing password */
            if (!oldPw) {
                showToast('Please enter your current (old) password.', 'error');
                hasError = true;
            } else if (!newPw) {
                showToast('Please enter a new password.', 'error');
                hasError = true;
            } else if (newPw.length < 6) {
                showToast('New password must be at least 6 characters.', 'error');
                hasError = true;
            } else if (oldPw === newPw) {
                showToast('New password must be different from the old one.', 'error');
                hasError = true;
            } else {
                /*
                   Re-authenticate with old password first.
                   Supabase doesn't have a "verify current password" API directly,
                   so we sign in again with the user's email + old password.
                   If it succeeds, the old password is correct → we update.
                */
                const { error: reAuthErr } = await db.auth.signInWithPassword({
                    email:    currentUser.email,
                    password: oldPw,
                });

                if (reAuthErr) {
                    showToast('Old password is incorrect.', 'error');
                    hasError = true;
                } else {
                    const { error: pwErr } = await db.auth.updateUser({ password: newPw });
                    if (pwErr) {
                        showToast('Password update failed: ' + pwErr.message, 'error');
                        hasError = true;
                    } else {
                        setVal('oldPassword', '');
                        setVal('newPassword', '');
                        /* No toast here — combined success toast below */
                    }
                }
            }
        }

        /* ─────── Result ─────── */
        if (!hasError) {
            showToast('✓ Profile saved successfully!', 'success');
        }

        saveBtn.disabled  = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }

    saveBtn && saveBtn.addEventListener('click', saveProfile);

    /* ============================================================
       CANCEL
       ============================================================ */
    $('cancelBtn') && $('cancelBtn').addEventListener('click', () => {
        pendingAvatarFile = null;
        if (currentUser && originalProfile) populateUI(currentUser, originalProfile);
        setVal('oldPassword', '');
        setVal('newPassword', '');
        showToast('Changes discarded.', 'info');
    });

    /* ============================================================
       FORGOT PASSWORD
       Sends a Supabase Auth password-reset email.
       User clicks the link in the email → lands on ResetPassword.html
       where they set a brand-new password without needing the old one.
       ============================================================ */
    $('forgotPasswordLink') && $('forgotPasswordLink').addEventListener('click', async e => {
        e.preventDefault();

        const email = currentUser?.email;
        if (!email) { showToast('No email found for your account.', 'error'); return; }

        const link = $('forgotPasswordLink');
        link.style.pointerEvents = 'none';
        link.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

        /* redirectTo: page user lands on after clicking the email link */
        const redirectTo = window.location.origin
            + window.location.pathname.replace(/UserProfile\.html.*$/, '')
            + 'ResetPassword.html';

        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

        link.style.pointerEvents = '';
        link.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Forgot Password?';

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
