/* ============================================================
   MediFinder — UserProfile.js

   THE ROOT CAUSE OF ALL "Loading..." ISSUES WAS:
   supabase.js used `const supabaseClient = createClient(...)`
   instead of `window.supabaseClient = createClient(...)`.
   A plain const is not visible to other script files.
   This made window.supabaseClient undefined here, causing
   the IIFE to return immediately at the guard check.
   Fix: supabase.js now assigns to window.supabaseClient.

   This file is correct and complete — do not modify supabase.js
   back to using a plain const or this will break again.
   ============================================================ */
(function () {
    'use strict';

    /* ── Guard: ensure supabase.js loaded correctly ── */
    const db = window.supabaseClient;
    if (!db) {
        console.error(
            '[UserProfile] window.supabaseClient is undefined.\n' +
            'Make sure supabase.js uses: window.supabaseClient = createClient(...)\n' +
            'NOT: const supabaseClient = createClient(...)'
        );
        return;
    }

    const AVATAR_BUCKET = 'avatars';

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
    const $      = id  => document.getElementById(id);
    const val    = id  => $(id)?.value.trim() || '';
    const setVal = (id, v) => { const el = $(id); if (el) el.value       = v ?? ''; };
    const setText= (id, v) => { const el = $(id); if (el) el.textContent = v ?? ''; };

    function getInitials(first, last) {
        const f = (first || '').trim()[0] || '';
        const l = (last  || '').trim()[0] || '';
        return (f + l).toUpperCase();
    }

    /* ============================================================
       AVATAR RENDERING — 100% JS driven, no static <img> in HTML

       Order: append to DOM → attach handlers → set src LAST.
       This ensures onload/onerror fire even for cached images.

       Priority:
         1. customUrl  — profile_img from Supabase Storage
         2. Default    — Images/ProfileAvatar.jpg
         3. Initials   — if image file missing/broken
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText) {
        const container = $(containerId);
        if (!container) return;

        container.innerHTML = '';

        const src = imageUrl || 'Images/ProfileAvatar.jpg';
        const img = document.createElement('img');
        img.alt       = 'Profile Photo';
        img.className = 'avatar-photo';

        /* Append FIRST so onload fires for cached images too */
        container.appendChild(img);

        img.onload = () => { /* already in DOM and visible — nothing needed */ };

        img.onerror = () => {
            container.innerHTML = '';
            const span = document.createElement('span');
            span.className   = 'avatar-initials-text';
            span.textContent = initialsText || '?';
            container.appendChild(span);
        };

        /* Set src LAST — after element is in DOM and handlers attached */
        img.src = src;
    }

    function setMainAvatar(url, initials)    { renderAvatar('avatarImgContainer', url, initials); }
    function setSidebarAvatar(url, initials) { renderAvatar('sidebarAvatarInner', url, initials); }

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
            const input = $(btn.dataset.target);
            if (!input) return;
            const hidden = input.type === 'password';
            input.type   = hidden ? 'text' : 'password';
            const icon   = btn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-eye-slash', !hidden);
                icon.classList.toggle('fa-eye',        hidden);
            }
        });
    });

    /* ============================================================
       AVATAR FILE SELECTION & VALIDATION
       ============================================================ */
    const avatarInput   = $('avatarInput');
    const avatarSizeErr = $('avatarSizeError');
    let pendingAvatarFile = null;
    let currentInitials   = '?';

    function showAvatarError(msg) {
        if (avatarSizeErr) {
            avatarSizeErr.textContent   = msg;
            avatarSizeErr.style.display = msg ? 'block' : 'none';
        }
        if (msg) showToast(msg, 'error');
    }

    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;

        /* 2 MB limit — matches bucket policy */
        if (file.size > 2 * 1024 * 1024) {
            showAvatarError('Image is too large. Maximum allowed size is 2 MB.');
            this.value        = '';
            pendingAvatarFile = null;
            return;
        }

        showAvatarError('');
        pendingAvatarFile = file;

        /* Instant local preview — no upload yet */
        const blobUrl = URL.createObjectURL(file);
        setMainAvatar(blobUrl, currentInitials);
        setSidebarAvatar(blobUrl, currentInitials);
    });

    /* Upload file to Supabase Storage → return permanent public URL */
    async function uploadAvatar(userId, file) {
        const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `${userId}/avatar.${ext}`;

        const { error: uploadErr } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, {
                upsert:       true,
                contentType:  file.type,
                cacheControl: '3600',
            });

        if (uploadErr) throw new Error('Storage upload failed: ' + uploadErr.message);

        const { data } = db.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
        return `${data.publicUrl}?v=${Date.now()}`;
    }

    /* ============================================================
       POPULATE UI
       ============================================================ */
    function populateUI(user, profile) {
        const email     = user.email         || '';
        const firstName = profile.first_name || '';
        const lastName  = profile.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';

        currentInitials = getInitials(firstName, lastName) || '?';

        setVal('firstName',   firstName);
        setVal('lastName',    lastName);
        setVal('email',       email);
        setVal('phone',       profile.phone_no    || '');
        setVal('street',      profile.address     || '');
        setVal('city',        profile.city        || '');
        setVal('coordinates', profile.coordinates || '');

        setText('avatarName',       fullName);
        setText('avatarEmail',      email);
        setText('sidebarUserName',  fullName);
        setText('sidebarUserEmail', email);

        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl, currentInitials);
        setSidebarAvatar(customUrl, currentInitials);
    }

    /* ============================================================
       AUTH — fetch session then load profile
       ============================================================ */
    let currentUser     = null;
    let originalProfile = null;

    async function fetchAndRender(user) {
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

    function initAuth() {
        const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
            subscription.unsubscribe();   // only need first event

            if (!session || !session.user) {
                window.location.href = 'Login.html';
                return;
            }

            fetchAndRender(session.user);
        });
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
       1. Upload avatar (if new file selected)
       2. Update users table
       3. Change password (if both old + new provided)
       ============================================================ */
    const saveBtn = $('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError     = false;
        let newAvatarUrl = null;

        /* Step 1 — Avatar */
        if (pendingAvatarFile) {
            try {
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile);
                pendingAvatarFile = null;
            } catch (err) {
                showToast(err.message, 'error');
                hasError = true;
            }
        }

        /* Step 2 — Profile fields */
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
                originalProfile = { ...originalProfile, ...patch };

                const fullName = [patch.first_name, patch.last_name]
                    .filter(Boolean).join(' ') || 'User';
                currentInitials = getInitials(patch.first_name, patch.last_name) || '?';

                setText('avatarName',      fullName);
                setText('sidebarUserName', fullName);

                if (newAvatarUrl) {
                    setMainAvatar(newAvatarUrl, currentInitials);
                    setSidebarAvatar(newAvatarUrl, currentInitials);
                }
            }
        }

        /* Step 3 — Password */
        const oldPw = val('oldPassword');
        const newPw = val('newPassword');

        if (oldPw || newPw) {
            if (!oldPw) {
                showToast('Enter your current (old) password to change it.', 'error');
                hasError = true;
            } else if (!newPw) {
                showToast('Enter a new password.', 'error');
                hasError = true;
            } else if (newPw.length < 6) {
                showToast('New password must be at least 6 characters.', 'error');
                hasError = true;
            } else if (oldPw === newPw) {
                showToast('New password must be different from the old one.', 'error');
                hasError = true;
            } else {
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
                    }
                }
            }
        }

        if (!hasError) showToast('✓ Profile saved successfully!', 'success');

        saveBtn.disabled  = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }

    saveBtn && saveBtn.addEventListener('click', saveProfile);

    /* ============================================================
       CANCEL
       ============================================================ */
    $('cancelBtn') && $('cancelBtn').addEventListener('click', () => {
        pendingAvatarFile = null;
        showAvatarError('');
        if (currentUser && originalProfile) populateUI(currentUser, originalProfile);
        setVal('oldPassword', '');
        setVal('newPassword', '');
        showToast('Changes discarded.', 'info');
    });

    /* ============================================================
       FORGOT PASSWORD
       ============================================================ */
    $('forgotPasswordLink') && $('forgotPasswordLink').addEventListener('click', async e => {
        e.preventDefault();

        const email = currentUser?.email;
        if (!email) { showToast('No email address found.', 'error'); return; }

        const link = $('forgotPasswordLink');
        link.style.pointerEvents = 'none';
        link.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

        const redirectTo = window.location.origin
            + window.location.pathname.replace(/UserProfile\.html.*$/, '')
            + 'ResetPassword.html';

        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

        link.style.pointerEvents = '';
        link.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Forgot Password?';

        if (error) {
            showToast('Could not send reset email: ' + error.message, 'error');
        } else {
            showToast(`✓ Reset email sent to ${email}. Check your inbox.`, 'success');
        }
    });

    /* ── INIT ── */
    initAuth();

})();
