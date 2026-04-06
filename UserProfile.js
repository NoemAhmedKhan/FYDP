/* ============================================================
   MediFinder — UserProfile.js

   FIXES IN THIS VERSION:
   1. Self-sufficient: creates own Supabase client if
      window.supabaseClient is undefined (supabase.js const bug).
   2. Uses upsert instead of update — update silently does nothing
      if RLS blocks the row, upsert surfaces the error clearly.
   3. Detailed console.log at every step so you can see exactly
      what is happening in browser DevTools > Console.
   4. profile_img URL always saved alongside other fields in one
      single upsert call — no separate update for avatar URL.
   ============================================================ */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

    /* Use shared client if available, otherwise create our own.
       Both share the same session via localStorage. */
    const db = window.supabaseClient
        || (window.supabase && window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

    if (!db) {
        console.error('[UserProfile] Supabase SDK not found. Check script load order.');
        return;
    }

    console.log('[UserProfile] Supabase client ready.');

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
        return (f + l).toUpperCase() || '?';
    }

    /* ============================================================
       AVATAR RENDERING — 100% JS-driven, no static img in HTML
       Priority: customUrl → Images/ProfileAvatar.jpg → initials
       Append to DOM first, then set src (cached-image onload fix)
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText) {
        const container = $(containerId);
        if (!container) return;

        container.innerHTML = '';

        const img     = document.createElement('img');
        img.alt       = 'Profile Photo';
        img.className = 'avatar-photo';

        container.appendChild(img);       // append FIRST

        img.onload  = () => {};           // already visible in DOM
        img.onerror = () => {
            container.innerHTML = '';
            const span       = document.createElement('span');
            span.className   = 'avatar-initials-text';
            span.textContent = initialsText || '?';
            container.appendChild(span);
        };

        img.src = imageUrl || 'Images/ProfileAvatar.jpg';   // set src LAST
    }

    const setMainAvatar    = (url, ini) => renderAvatar('avatarImgContainer', url, ini);
    const setSidebarAvatar = (url, ini) => renderAvatar('sidebarAvatarInner', url, ini);

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
            input.type = hidden ? 'text' : 'password';
            const icon = btn.querySelector('i');
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

        if (file.size > 2 * 1024 * 1024) {
            showAvatarError('Image is too large. Maximum allowed size is 2 MB.');
            this.value        = '';
            pendingAvatarFile = null;
            return;
        }

        showAvatarError('');
        pendingAvatarFile = file;

        const blobUrl = URL.createObjectURL(file);
        setMainAvatar(blobUrl, currentInitials);
        setSidebarAvatar(blobUrl, currentInitials);
        console.log('[UserProfile] Avatar preview set (local blob). Will upload on Save.');
    });

    /* Upload to Supabase Storage → return permanent public URL */
    async function uploadAvatar(userId, file) {
        const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `${userId}/avatar.${ext}`;

        console.log('[UserProfile] Uploading avatar to:', filePath);

        const { error: uploadErr } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, {
                upsert:       true,
                contentType:  file.type,
                cacheControl: '3600',
            });

        if (uploadErr) {
            console.error('[UserProfile] Avatar upload error:', uploadErr);
            throw new Error('Avatar upload failed: ' + uploadErr.message);
        }

        const { data } = db.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
        const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
        console.log('[UserProfile] Avatar uploaded. Public URL:', publicUrl);
        return publicUrl;
    }

    /* ============================================================
       POPULATE UI FROM FETCHED DATA
       ============================================================ */
    function populateUI(user, profile) {
        const email     = user.email         || '';
        const firstName = profile.first_name || '';
        const lastName  = profile.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ') || 'User';

        currentInitials = getInitials(firstName, lastName);

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

        console.log('[UserProfile] UI populated. Name:', fullName, '| Avatar URL:', customUrl || 'default');
    }

    /* ============================================================
       AUTH + LOAD
       onAuthStateChange fires after session restored from localStorage
       — avoids the getUser()-returns-null timing bug.
       ============================================================ */
    let currentUser     = null;
    let originalProfile = null;

    async function fetchAndRender(user) {
        currentUser = user;
        console.log('[UserProfile] Auth user ID:', user.id, '| Email:', user.email);

        const { data: profile, error: dbErr } = await db
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (dbErr) {
            if (dbErr.code === 'PGRST116') {
                /* No row found — new user, populate with auth data only */
                console.warn('[UserProfile] No row in users table for this user yet.');
                originalProfile = {};
                populateUI(user, {});
            } else {
                console.error('[UserProfile] DB fetch error:', dbErr);
                showToast('Could not load profile: ' + dbErr.message, 'error');
            }
            return;
        }

        console.log('[UserProfile] Profile fetched:', profile);
        originalProfile = profile;
        populateUI(user, profile);
    }

    function initAuth() {
        console.log('[UserProfile] Initialising auth listener...');
        const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
            console.log('[UserProfile] Auth event:', event, '| Has session:', !!session);
            subscription.unsubscribe();

            if (!session || !session.user) {
                console.warn('[UserProfile] No session — redirecting to Login.html');
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
       ─────────────────────────────────────────────────────────────
       Step 1: Upload avatar to Storage (if new file selected)
       Step 2: Upsert ALL fields + profile_img into users table
               Uses upsert (not update) so it works even if RLS
               would silently swallow a plain update call.
       Step 3: Change password (if old + new both provided)
       ============================================================ */
    const saveBtn = $('saveBtn');

    async function saveProfile() {
        if (!currentUser) {
            console.warn('[UserProfile] saveProfile called but currentUser is null');
            return;
        }

        console.log('[UserProfile] Save started for user:', currentUser.id);
        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError     = false;
        let newAvatarUrl = null;

        /* ── Step 1: Upload avatar if selected ── */
        if (pendingAvatarFile) {
            try {
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile);
                pendingAvatarFile = null;
            } catch (err) {
                console.error('[UserProfile] Avatar upload failed:', err.message);
                showToast(err.message, 'error');
                hasError = true;
            }
        }

        /* ── Step 2: Upsert profile fields into users table ── */
        if (!hasError) {
            /*
               We include the id in the upsert payload so Supabase knows
               which row to target. onConflict:'id' means:
                 - if row with this id exists → UPDATE it
                 - if it doesn't exist yet   → INSERT it
               This is more reliable than a plain .update() which can
               silently do nothing if RLS denies or the row is missing.
            */
            const payload = {
                id:          currentUser.id,
                first_name:  val('firstName')   || null,
                last_name:   val('lastName')    || null,
                phone_no:    val('phone')       || null,
                address:     val('street')      || null,
                city:        val('city')        || null,
                coordinates: val('coordinates') || null,
            };

            /* Only include profile_img if we have a new URL */
            if (newAvatarUrl) {
                payload.profile_img = newAvatarUrl;
            }

            console.log('[UserProfile] Upserting payload:', payload);

            const { data: upsertData, error: upsertErr } = await db
                .from('users')
                .upsert(payload, { onConflict: 'id' })
                .select();   /* .select() forces Supabase to return the updated row */

            if (upsertErr) {
                console.error('[UserProfile] Upsert error:', upsertErr);
                showToast('Save failed: ' + upsertErr.message, 'error');
                hasError = true;
            } else {
                console.log('[UserProfile] Upsert success. Returned:', upsertData);

                originalProfile = { ...originalProfile, ...payload };

                const fullName = [payload.first_name, payload.last_name]
                    .filter(Boolean).join(' ') || 'User';
                currentInitials = getInitials(payload.first_name, payload.last_name);

                setText('avatarName',      fullName);
                setText('sidebarUserName', fullName);

                if (newAvatarUrl) {
                    originalProfile.profile_img = newAvatarUrl;
                    setMainAvatar(newAvatarUrl, currentInitials);
                    setSidebarAvatar(newAvatarUrl, currentInitials);
                }
            }
        }

        /* ── Step 3: Password change ── */
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
                console.log('[UserProfile] Re-authenticating to verify old password...');
                const { error: reAuthErr } = await db.auth.signInWithPassword({
                    email:    currentUser.email,
                    password: oldPw,
                });
                if (reAuthErr) {
                    console.error('[UserProfile] Re-auth failed:', reAuthErr.message);
                    showToast('Old password is incorrect.', 'error');
                    hasError = true;
                } else {
                    const { error: pwErr } = await db.auth.updateUser({ password: newPw });
                    if (pwErr) {
                        console.error('[UserProfile] Password update failed:', pwErr.message);
                        showToast('Password update failed: ' + pwErr.message, 'error');
                        hasError = true;
                    } else {
                        console.log('[UserProfile] Password updated successfully.');
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
        console.log('[UserProfile] Save complete. hasError:', hasError);
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
