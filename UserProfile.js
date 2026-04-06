/* ============================================================
   MediFinder — UserProfile.js  v2.0

   CHANGES IN v2.0:
   1. Forgot Password logic completely removed (link, handler,
      and related toast/spinner code all gone).
   2. Avatar upload now DELETES the old file from Supabase
      Storage before uploading the new one, so only 1 file
      ever exists per user in the "avatars" bucket.
      Old file path is read from the profile_img URL saved
      in the users table.
   3. All other logic unchanged.
   ============================================================ */
(function () {
    'use strict';

    const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

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
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText) {
        const container = $(containerId);
        if (!container) return;

        container.innerHTML = '';

        const img     = document.createElement('img');
        img.alt       = 'Profile Photo';
        img.className = 'avatar-photo';

        container.appendChild(img);

        img.onerror = () => {
            // Profile URL failed — fall back to default avatar
            if (img.src !== window.location.origin + '/Images/ProfileAvatar.jpg') {
                img.src = 'Images/ProfileAvatar.jpg';
            } else {
                // Default also failed — show initials
                container.innerHTML = '';
                const span       = document.createElement('span');
                span.className   = 'avatar-initials-text';
                span.textContent = initialsText || '?';
                container.appendChild(span);
            }
        };

        img.src = imageUrl || 'Images/ProfileAvatar.jpg';
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

        // Show local preview immediately (before save)
        const blobUrl = URL.createObjectURL(file);
        setMainAvatar(blobUrl, currentInitials);
        setSidebarAvatar(blobUrl, currentInitials);
        console.log('[UserProfile] Avatar preview set (local blob). Will upload on Save.');
    });

    /* ============================================================
       DELETE OLD AVATAR FROM STORAGE
       ─────────────────────────────────────────────────────────────
       Extracts the file path from the existing profile_img URL
       and removes it from the bucket before uploading the new one.
       This ensures only 1 file per user ever exists in storage.

       The public URL format is:
         https://<project>.supabase.co/storage/v1/object/public/avatars/<path>
       We extract everything after "/avatars/" as the file path.

       If deletion fails we log a warning but do NOT block the upload.
       ============================================================ */
    async function deleteOldAvatar(existingProfileImgUrl) {
        if (!existingProfileImgUrl) return;

        try {
            // Strip query string (e.g. ?v=123456) before parsing
            const cleanUrl  = existingProfileImgUrl.split('?')[0];
            const marker    = `/avatars/`;
            const markerIdx = cleanUrl.indexOf(marker);

            if (markerIdx === -1) {
                console.warn('[UserProfile] Could not parse old avatar path from URL:', cleanUrl);
                return;
            }

            const oldPath = cleanUrl.substring(markerIdx + marker.length);
            console.log('[UserProfile] Deleting old avatar file:', oldPath);

            const { error } = await db.storage
                .from(AVATAR_BUCKET)
                .remove([oldPath]);

            if (error) {
                console.warn('[UserProfile] Old avatar delete warning (non-blocking):', error.message);
            } else {
                console.log('[UserProfile] Old avatar deleted successfully.');
            }
        } catch (err) {
            // Non-blocking — just warn, don't stop the upload
            console.warn('[UserProfile] deleteOldAvatar exception (non-blocking):', err.message);
        }
    }

    /* ============================================================
       UPLOAD NEW AVATAR TO STORAGE
       ─────────────────────────────────────────────────────────────
       Always saves as:  <userId>/avatar.<ext>
       Uses upsert:true so if a same-extension file already exists
       it gets overwritten (extra safety net on top of delete).
       Returns the permanent public URL with a cache-bust param.
       ============================================================ */
    async function uploadAvatar(userId, file, existingProfileImgUrl) {
        // Step 1: Delete the old file first (keeps bucket clean)
        await deleteOldAvatar(existingProfileImgUrl);

        // Step 2: Upload the new file
        const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `${userId}/avatar.${ext}`;

        console.log('[UserProfile] Uploading new avatar to:', filePath);

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
        console.log('[UserProfile] New avatar uploaded. Public URL:', publicUrl);
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

        // Use profile_img from DB if present, else show default avatar
        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl, currentInitials);
        setSidebarAvatar(customUrl, currentInitials);

        console.log('[UserProfile] UI populated. Name:', fullName, '| Avatar URL:', customUrl || 'default');
    }

    /* ============================================================
       AUTH + LOAD
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
       Step 1: Delete old avatar + upload new one (if changed)
       Step 2: Upsert all fields + profile_img into users table
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

        /* ── Step 1: Delete old + upload new avatar if selected ── */
        if (pendingAvatarFile) {
            try {
                // Pass existing URL so old file gets deleted before new upload
                const existingUrl = originalProfile?.profile_img || null;
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile, existingUrl);
                pendingAvatarFile = null;
            } catch (err) {
                console.error('[UserProfile] Avatar upload failed:', err.message);
                showToast(err.message, 'error');
                hasError = true;
            }
        }

        /* ── Step 2: Upsert profile fields ── */
        if (!hasError) {
            const payload = {
                id:          currentUser.id,
                first_name:  val('firstName')   || null,
                last_name:   val('lastName')    || null,
                phone_no:    val('phone')       || null,
                address:     val('street')      || null,
                city:        val('city')        || null,
                coordinates: val('coordinates') || null,
            };

            if (newAvatarUrl) {
                payload.profile_img = newAvatarUrl;
            }

            console.log('[UserProfile] Upserting payload:', payload);

            const { data: upsertData, error: upsertErr } = await db
                .from('users')
                .upsert(payload, { onConflict: 'id' })
                .select();

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

    /* ── INIT ── */
    initAuth();

})();
