/* ============================================================
   MediFinder — UserProfile.js   (final fixed version)

   Root causes fixed vs previous version:
   1. SESSION TIMING BUG — getUser() returns null on first page load
      because Supabase restores the session asynchronously from
      localStorage. Fix: use onAuthStateChange to wait for the
      session to be ready before loading the profile.

   2. CACHED IMAGE ONLOAD BUG — setting img.src before appending
      to DOM means onload never fires for cached images in some
      browsers (Chrome especially). Fix: append first, set src last.

   3. STORAGE RLS — uploads fail silently with RLS errors if the
      Storage policy isn't set. The JS now surfaces the exact error
      message so you know what policy to add.

   4. FILE SIZE — shows inline red text below avatar, not just toast.

   5. All other features: Old+New password with re-auth, forgot
      password email, cancel restore, sidebar toggle.
   ============================================================ */
(function () {
    'use strict';

    /* ── Shared Supabase client from supabase.js ── */
    const db = window.supabaseClient;
    if (!db) {
        console.error('UserProfile.js: window.supabaseClient not found. Ensure supabase.js loads first.');
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
       AVATAR RENDERING  (fully JS-driven, no HTML img tags)
       ─────────────────────────────────────────────────────────────
       FIX FOR CACHED-IMAGE ONLOAD BUG:
       Append the <img> to DOM *first*, then set src.
       This guarantees onload fires even when the browser has the
       image cached (Chrome skips onload if src is set before append).

       Priority:
         1. customUrl  — saved profile_img from Supabase Storage
         2. Fallback   — Images/ProfileAvatar.jpg  (your default)
         3. Initials   — if the image file itself fails to load
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText) {
        const container = $(containerId);
        if (!container) return;

        /* Clear previous content */
        container.innerHTML = '';

        const src = imageUrl || 'Images/ProfileAvatar.jpg';
        const img = document.createElement('img');
        img.alt   = 'Profile Photo';
        /* Class used by CSS for sizing */
        img.className = 'avatar-photo';

        /* ── Append FIRST, set src LAST ──
           This is the critical fix. If src is set before the element
           is in the DOM, cached images fire load synchronously before
           the onload handler is attached, so the handler never runs. */
        container.appendChild(img);

        img.onload = () => {
            /* Image loaded fine — already in DOM, nothing else needed */
        };

        img.onerror = () => {
            /* Image missing or broken — show initials instead */
            container.innerHTML = '';
            const span = document.createElement('span');
            span.className   = 'avatar-initials-text';
            span.textContent = initialsText || '?';
            container.appendChild(span);
        };

        /* Set src after appending and after onload/onerror are attached */
        img.src = src;
    }

    function setMainAvatar(url, initials) {
        renderAvatar('avatarImgContainer', url, initials);
    }
    function setSidebarAvatar(url, initials) {
        renderAvatar('sidebarAvatarInner', url, initials);
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
            const icon   = btn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-eye-slash', !hidden);
                icon.classList.toggle('fa-eye',        hidden);
            }
        });
    });

    /* ============================================================
       AVATAR FILE SELECTION & VALIDATION
       ─ Validates size (≤ 2 MB)
       ─ Shows inline red error text below avatar (not just toast)
       ─ Shows instant local blob preview
       ─ Stores file — actual upload happens only on Save
       ============================================================ */
    const avatarInput    = $('avatarInput');
    const avatarSizeErr  = $('avatarSizeError');   /* inline error element */
    let pendingAvatarFile = null;
    let currentInitials   = '?';

    function showAvatarError(msg) {
        if (avatarSizeErr) {
            avatarSizeErr.textContent = msg;
            avatarSizeErr.style.display = msg ? 'block' : 'none';
        }
        /* Also show as toast for visibility */
        if (msg) showToast(msg, 'error');
    }

    avatarInput && avatarInput.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;

        /* ── Size check: 2 MB max (matches your bucket policy) ── */
        if (file.size > 2 * 1024 * 1024) {
            showAvatarError('Image is too large. Maximum allowed size is 2 MB.');
            this.value = '';          /* reset input so same file can be re-selected after resize */
            pendingAvatarFile = null;
            return;
        }

        /* Clear any previous error */
        showAvatarError('');

        pendingAvatarFile = file;

        /* Instant local preview using blob URL — no Supabase call yet */
        const blobUrl = URL.createObjectURL(file);
        setMainAvatar(blobUrl, currentInitials);
        setSidebarAvatar(blobUrl, currentInitials);
    });

    /* ── Upload to Supabase Storage, return permanent public URL ── */
    async function uploadAvatar(userId, file) {
        const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
        /* Fixed filename per user — always overwrites the previous avatar */
        const filePath = `${userId}/avatar.${ext}`;

        const { error: uploadErr } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, {
                upsert:       true,
                contentType:  file.type,
                cacheControl: '3600',
            });

        if (uploadErr) {
            /* Surface the exact Supabase error so you can diagnose
               RLS policy issues vs network issues vs other problems */
            throw new Error(`Storage upload failed: ${uploadErr.message}`);
        }

        const { data } = db.storage
            .from(AVATAR_BUCKET)
            .getPublicUrl(filePath);

        /* Cache-bust query param so browser re-fetches new version */
        return `${data.publicUrl}?v=${Date.now()}`;
    }

    /* ============================================================
       POPULATE UI FROM FETCHED DATA
       ============================================================ */
    function populateUI(user, profile) {
        const email     = user.email         || '';
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

        /* Header displays */
        setText('avatarName',       fullName);
        setText('avatarEmail',      email);
        setText('sidebarUserName',  fullName);
        setText('sidebarUserEmail', email);

        /* Avatars: use saved custom URL if it exists, else default */
        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl, currentInitials);
        setSidebarAvatar(customUrl, currentInitials);
    }

    /* ============================================================
       LOAD PROFILE
       ─────────────────────────────────────────────────────────────
       FIX FOR SESSION TIMING BUG:
       Supabase restores the auth session from localStorage async-
       ronously on page load. Calling getUser() immediately can
       return null even when the user IS logged in, because the
       session hasn't been restored yet.

       The correct approach is to use onAuthStateChange which fires
       once the session is definitely ready (either restored or null).
       We use { data: { subscription } } and unsubscribe after the
       first event so we don't create a persistent listener.
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
            /* PGRST116 = row not found (brand new user) — that's fine */
            showToast('Could not load profile: ' + dbErr.message, 'error');
            return;
        }

        originalProfile = profile || {};
        populateUI(user, originalProfile);
    }

    function initAuth() {
        /* onAuthStateChange fires immediately with the current session state,
           so we don't need a separate getUser() call. */
        const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
            /* Unsubscribe after first event — we only need the initial state */
            subscription.unsubscribe();

            if (!session || !session.user) {
                /* No active session → redirect to login */
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
       Step 1 — Upload avatar  (if new file selected)
       Step 2 — Update users table  (profile fields + profile_img)
       Step 3 — Change password  (if Old + New both provided)
       ============================================================ */
    const saveBtn = $('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError     = false;
        let newAvatarUrl = null;

        /* ─── Step 1: Avatar upload ─── */
        if (pendingAvatarFile) {
            try {
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile);
                pendingAvatarFile = null;
            } catch (err) {
                showToast(err.message, 'error');
                hasError = true;
            }
        }

        /* ─── Step 2: Profile fields ─── */
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

                /* Update avatar only if a new image was uploaded */
                if (newAvatarUrl) {
                    setMainAvatar(newAvatarUrl, currentInitials);
                    setSidebarAvatar(newAvatarUrl, currentInitials);
                }
            }
        }

        /* ─── Step 3: Password change ─── */
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
                /* Re-authenticate with old password to verify it's correct */
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

        if (!hasError) {
            showToast('✓ Profile saved successfully!', 'success');
        }

        saveBtn.disabled  = false;
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes';
    }

    saveBtn && saveBtn.addEventListener('click', saveProfile);

    /* ============================================================
       CANCEL — restore last saved data
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
       Sends a Supabase Auth password-reset email.
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

    /* ============================================================
       INIT — wait for auth session to be ready before loading
       ============================================================ */
    initAuth();

})();
