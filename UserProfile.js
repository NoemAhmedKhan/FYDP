/* MediFinder — UserProfile.js
   ─ Reuses window.supabaseClient from supabase.js (no duplicate client)
   ─ Fetches/updates from 'users' table with correct column names
   ─ Profile image: uploaded to Supabase Storage, URL saved in users.profile_img
   ─ Default avatar: Images/ProfileAvatar.jpg (until user uploads their own)
   ─ Password update via supabase.auth.updateUser()
   ─ Forgot password via supabase.auth.resetPasswordForEmail()
*/
(function () {
    'use strict';

    /* ============================================================
       REUSE the shared Supabase client from supabase.js
       This avoids the "two clients / session not shared" bug.
       supabase.js must be loaded before this file in the HTML.
       ============================================================ */
    const db = window.supabaseClient;

    if (!db) {
        console.error('UserProfile.js: supabaseClient not found. Make sure supabase.js is loaded first.');
        return;
    }

    /* ============================================================
       SUPABASE STORAGE — bucket name for profile images
       Create this bucket in your Supabase dashboard:
         Storage → New bucket → name: "avatars" → Public: ON
       ============================================================ */
    const AVATAR_BUCKET = 'avatars';

    /* ============================================================
       TOAST
       ============================================================ */
    const toastEl = document.getElementById('toast');
    let toastTimer = null;

    function showToast(message, type = 'success') {
        if (!toastEl) return;
        clearTimeout(toastTimer);
        toastEl.textContent = message;
        toastEl.className = `toast toast--${type} toast--show`;
        toastTimer = setTimeout(() => toastEl.classList.remove('toast--show'), 4000);
    }

    /* ============================================================
       DOM HELPERS
       ============================================================ */
    function $id(id)        { return document.getElementById(id); }
    function val(id)        { return $id(id)?.value.trim() || null; }
    function setVal(id, v)  { const el = $id(id); if (el) el.value = v ?? ''; }
    function setText(id, v) { const el = $id(id); if (el) el.textContent = v ?? ''; }

    function getInitials(first, last) {
        return ((first || '')[0] || '') + ((last  || '')[0] || '');
    }

    /* ── Update the large avatar card image / initials ── */
    function setMainAvatar(url) {
        const photo    = $id('avatarPhoto');
        const initials = $id('avatarInitials');
        if (!photo) return;

        if (url) {
            photo.src = url;
            photo.style.display = 'block';
            if (initials) initials.style.display = 'none';
        } else {
            /* No custom URL — let the default src (ProfileAvatar.jpg) show.
               The onerror in HTML handles the fallback to initials automatically. */
            photo.src = 'Images/ProfileAvatar.jpg';
            photo.style.display = 'block';
            if (initials) initials.style.display = 'none';
        }
    }

    /* ── Update sidebar small avatar ── */
    function setSidebarAvatar(url) {
        const img      = $id('sidebarAvatarImg');
        const initials = $id('sidebarInitials');
        if (!img) return;

        if (url) {
            img.src = url;
            img.style.display = 'block';
            if (initials) initials.style.display = 'none';
        } else {
            img.src = 'Images/ProfileAvatar.jpg';
            img.style.display = 'block';
            if (initials) initials.style.display = 'none';
        }
    }

    /* ============================================================
       SIDEBAR TOGGLE (mobile)
       ============================================================ */
    const sidebar        = $id('sidebar');
    const hamburgerBtn   = $id('hamburgerBtn');
    const sidebarOverlay = $id('sidebarOverlay');

    function openSidebar()  { sidebar.classList.add('sidebar--open');    document.body.style.overflow = 'hidden'; }
    function closeSidebar() { sidebar.classList.remove('sidebar--open'); document.body.style.overflow = ''; }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

    /* ============================================================
       AVATAR FILE UPLOAD
       When user picks a file:
         1. Show a local preview immediately
         2. On "Save Changes", upload to Supabase Storage and save URL
       ============================================================ */
    const avatarInput = $id('avatarInput');
    let pendingAvatarFile = null;   // held until Save is clicked

    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        pendingAvatarFile = file;

        /* Instant local preview */
        const reader = new FileReader();
        reader.onload = e => {
            const photo    = $id('avatarPhoto');
            const initials = $id('avatarInitials');
            if (photo) { photo.src = e.target.result; photo.style.display = 'block'; }
            if (initials) initials.style.display = 'none';

            /* Mirror to sidebar */
            const sideImg = $id('sidebarAvatarImg');
            if (sideImg) sideImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });

    /* ── Upload avatar to Supabase Storage, return public URL ── */
    async function uploadAvatar(userId, file) {
        const ext      = file.name.split('.').pop();
        const filePath = `${userId}/avatar.${ext}`;   // e.g. "uuid123/avatar.jpg"

        const { error: uploadError } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, { upsert: true, contentType: file.type });

        if (uploadError) throw new Error(uploadError.message);

        /* Get the permanent public URL */
        const { data } = db.storage
            .from(AVATAR_BUCKET)
            .getPublicUrl(filePath);

        /* Append a cache-buster so the browser re-fetches the new image */
        return data.publicUrl + '?t=' + Date.now();
    }

    /* ============================================================
       PASSWORD VISIBILITY TOGGLES
       ============================================================ */
    document.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input  = $id(btn.dataset.target);
            if (!input) return;
            const hidden = input.type === 'password';
            input.type   = hidden ? 'text' : 'password';
            const icon   = btn.querySelector('i');
            icon.classList.toggle('fa-eye-slash', !hidden);
            icon.classList.toggle('fa-eye',        hidden);
        });
    });

    /* ============================================================
       POPULATE UI FROM FETCHED DATA
       ============================================================ */
    function populateUI(user, profile) {
        const email     = user.email || '';
        const firstName = profile.first_name || '';
        const lastName  = profile.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';

        /* Form inputs */
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

        /* Initials (used as fallback text) */
        const ini = getInitials(firstName, lastName).toUpperCase();
        setText('avatarInitials',  ini);
        setText('sidebarInitials', ini);

        /* Avatar image — custom upload takes priority over default */
        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl);
        setSidebarAvatar(customUrl);

        /* Sidebar name / email */
        setText('sidebarUserName',  fullName);
        setText('sidebarUserEmail', email);
    }

    /* ============================================================
       LOAD PROFILE ON PAGE OPEN
       ============================================================ */
    let currentUser    = null;
    let originalProfile = null;

    async function loadProfile() {
        /* Get the active auth session */
        const { data: { user }, error: authError } = await db.auth.getUser();

        if (authError || !user) {
            /* Not logged in — go to login */
            window.location.href = 'Login.html';
            return;
        }

        currentUser = user;

        /* Fetch this user's row from the users table */
        const { data: profile, error: dbError } = await db
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (dbError && dbError.code !== 'PGRST116') {
            /* PGRST116 = no row found yet, which is fine for brand-new users */
            showToast('Could not load profile: ' + dbError.message, 'error');
            return;
        }

        originalProfile = profile || {};
        populateUI(user, originalProfile);
    }

    /* ============================================================
       LOGOUT
       ============================================================ */
    const logoutBtn = $id('logoutBtn');
    logoutBtn && logoutBtn.addEventListener('click', async () => {
        await db.auth.signOut();
        window.location.href = 'Login.html';
    });

    /* ============================================================
       SAVE CHANGES
       ─ 1. Upload avatar if a new file was selected
       ─ 2. Update users table (profile fields + profile_img if changed)
       ─ 3. Update password if new password was typed
       ============================================================ */
    const saveBtn = $id('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError    = false;
        let newAvatarUrl = null;

        /* ── Step 1: Upload avatar if user picked a new one ── */
        if (pendingAvatarFile) {
            try {
                newAvatarUrl = await uploadAvatar(currentUser.id, pendingAvatarFile);
                pendingAvatarFile = null;   // clear after successful upload
            } catch (err) {
                showToast('Avatar upload failed: ' + err.message, 'error');
                hasError = true;
            }
        }

        /* ── Step 2: Update users table ── */
        if (!hasError) {
            const updateData = {
                first_name:  val('firstName'),
                last_name:   val('lastName'),
                phone_no:    val('phone'),
                address:     val('street'),
                city:        val('city'),
                coordinates: val('coordinates'),
            };

            /* Only include profile_img in the update if a new image was uploaded */
            if (newAvatarUrl) {
                updateData.profile_img = newAvatarUrl;
            }

            const { error: updateError } = await db
                .from('users')
                .update(updateData)
                .eq('id', currentUser.id);

            if (updateError) {
                showToast('Profile update failed: ' + updateError.message, 'error');
                hasError = true;
            } else {
                /* Sync local copy */
                originalProfile = { ...originalProfile, ...updateData };
                if (newAvatarUrl) originalProfile.profile_img = newAvatarUrl;

                /* Refresh display name */
                const fullName = [updateData.first_name, updateData.last_name]
                    .filter(Boolean).join(' ') || 'User';
                setText('avatarName',      fullName);
                setText('sidebarUserName', fullName);
                const ini = getInitials(updateData.first_name, updateData.last_name).toUpperCase();
                setText('avatarInitials',  ini);
                setText('sidebarInitials', ini);

                if (newAvatarUrl) {
                    setMainAvatar(newAvatarUrl);
                    setSidebarAvatar(newAvatarUrl);
                }
            }
        }

        /* ── Step 3: Password update (only if something was typed) ── */
        const newPw     = val('newPassword');
        const confirmPw = val('confirmPassword');

        if (newPw || confirmPw) {
            if (newPw !== confirmPw) {
                showToast('Passwords do not match.', 'error');
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
                    setVal('newPassword',     '');
                    setVal('confirmPassword', '');
                }
            }
        }

        if (!hasError) {
            showToast('✓ Profile saved successfully!', 'success');
        }

        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }

    saveBtn && saveBtn.addEventListener('click', saveProfile);

    /* ============================================================
       CANCEL — discard unsaved changes, restore last fetched data
       ============================================================ */
    const cancelBtn = $id('cancelBtn');
    cancelBtn && cancelBtn.addEventListener('click', () => {
        pendingAvatarFile = null;
        if (currentUser && originalProfile) {
            populateUI(currentUser, originalProfile);
        }
        setVal('newPassword',     '');
        setVal('confirmPassword', '');
        showToast('Changes discarded.', 'info');
    });

    /* ============================================================
       FORGOT PASSWORD
       Sends a password-reset email through Supabase Auth.
       The email contains a link → user clicks it → lands on your
       ResetPassword.html page where they set a new password.
       ============================================================ */
    const forgotLink = $id('forgotPasswordLink');
    forgotLink && forgotLink.addEventListener('click', async e => {
        e.preventDefault();

        const email = currentUser?.email;
        if (!email) {
            showToast('No email address found.', 'error');
            return;
        }

        /* Update this URL to your actual reset-password page */
        const redirectTo = window.location.origin +
            window.location.pathname.replace('UserProfile.html', '') +
            'ResetPassword.html';

        forgotLink.style.pointerEvents = 'none';
        forgotLink.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

        forgotLink.style.pointerEvents = '';
        forgotLink.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Forgot Password?';

        if (error) {
            showToast('Could not send reset email: ' + error.message, 'error');
        } else {
            showToast(`✓ Reset email sent to ${email}. Check your inbox.`, 'success');
        }
    });

    /* ============================================================
       INIT
       ============================================================ */
    loadProfile();

})();
