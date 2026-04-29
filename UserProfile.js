/* ============================================================
   MediFinder — UserProfile.js  v3.0

   FIXES IN v3.0:
   1. "infinite recursion" error fixed — no longer queries
      public.users for profile data. The RLS policy on users
      does a self-referencing subquery (checks role = 'admin'
      inside users itself) which causes infinite recursion.
      All profile data now comes from:
        • public.profiles   → full_name, phone_no, city, profile_img
        • public.customer_location → address, coordinates
   2. first_name / last_name split from full_name on load,
      rejoined as full_name on save (profiles.full_name).
   3. Avatar (profile_img) saved to profiles table, not users.
   4. address / coordinates saved to customer_location via
      upsert (user_id conflict key).
   5. Sidebar name/email/avatar all populated from profiles.
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
    const $       = id  => document.getElementById(id);
    const val     = id  => $(id)?.value.trim() || '';
    const setVal  = (id, v) => { const el = $(id); if (el) el.value       = v ?? ''; };
    const setText = (id, v) => { const el = $(id); if (el) el.textContent = v ?? ''; };

    function getInitials(fullName) {
        const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
        const f = parts[0]?.[0] || '';
        const l = parts[1]?.[0] || '';
        return (f + l).toUpperCase() || '?';
    }

    /* ============================================================
       AVATAR RENDERING
       ============================================================ */
    function renderAvatar(containerId, imageUrl, initialsText) {
        const container = $(containerId);
        if (!container) return;
        container.innerHTML = '';

        const img     = document.createElement('img');
        img.alt       = 'Profile Photo';
        img.className = 'avatar-photo';

        img.onerror = () => {
            if (!img.src.includes('ProfileAvatar')) {
                img.src = 'Images/ProfileAvatar.jpg';
            } else {
                container.innerHTML = '';
                const span       = document.createElement('span');
                span.className   = 'avatar-initials-text';
                span.textContent = initialsText || '?';
                container.appendChild(span);
            }
        };

        img.src = imageUrl || 'Images/ProfileAvatar.jpg';
        container.appendChild(img);
    }

    const setMainAvatar    = (url, ini) => renderAvatar('avatarImgContainer', url, ini);
    const setSidebarAvatar = (url, ini) => renderAvatar('sidebarAvatarInner',  url, ini);

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
    });

    /* ============================================================
       DELETE OLD AVATAR FROM STORAGE
       ============================================================ */
    async function deleteOldAvatar(existingProfileImgUrl) {
        if (!existingProfileImgUrl) return;
        try {
            const cleanUrl  = existingProfileImgUrl.split('?')[0];
            const marker    = `/avatars/`;
            const markerIdx = cleanUrl.indexOf(marker);
            if (markerIdx === -1) return;

            const oldPath = cleanUrl.substring(markerIdx + marker.length);
            const { error } = await db.storage.from(AVATAR_BUCKET).remove([oldPath]);
            if (error) console.warn('[UserProfile] Old avatar delete warning:', error.message);
        } catch (err) {
            console.warn('[UserProfile] deleteOldAvatar exception:', err.message);
        }
    }

    /* ============================================================
       UPLOAD NEW AVATAR TO STORAGE
       ============================================================ */
    async function uploadAvatar(userId, file, existingProfileImgUrl) {
        await deleteOldAvatar(existingProfileImgUrl);

        const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const filePath = `${userId}/avatar.${ext}`;

        const { error: uploadErr } = await db.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, file, {
                upsert:       true,
                contentType:  file.type,
                cacheControl: '3600',
            });

        if (uploadErr) throw new Error('Avatar upload failed: ' + uploadErr.message);

        const { data } = db.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
        return `${data.publicUrl}?v=${Date.now()}`;
    }

    /* ============================================================
       POPULATE UI FROM FETCHED DATA
       ─────────────────────────────────────────────────────────────
       profile  → public.profiles row
       location → public.customer_location row (may be null)
       ============================================================ */
    function populateUI(user, profile, location) {
        const email    = user.email       || '';
        const fullName = profile.full_name || '';

        // Split full_name into first / last for the two-field form
        const nameParts = fullName.trim().split(/\s+/);
        const firstName = nameParts[0]                           || '';
        const lastName  = nameParts.slice(1).join(' ')           || '';

        currentInitials = getInitials(fullName);

        setVal('firstName',   firstName);
        setVal('lastName',    lastName);
        setVal('email',       email);
        setVal('phone',       profile.phone_no    || '');
        setVal('city',        profile.city        || '');
        setVal('street',      location?.address   || '');
        setVal('coordinates', location?.coordinates || '');

        setText('avatarName',       fullName || 'User');
        setText('avatarEmail',      email);
        setText('sidebarUserName',  fullName || 'User');
        setText('sidebarUserEmail', email);

        const customUrl = profile.profile_img || null;
        setMainAvatar(customUrl, currentInitials);
        setSidebarAvatar(customUrl, currentInitials);
    }

    /* ============================================================
       AUTH + LOAD
       ─────────────────────────────────────────────────────────────
       Reads from public.profiles (full_name, phone_no, city,
       profile_img) and public.customer_location (address,
       coordinates). Does NOT touch public.users (avoids
       infinite-recursion RLS bug).
       ============================================================ */
    let currentUser     = null;
    let originalProfile = null;
    let originalLocation = null;

    async function fetchAndRender(user) {
        currentUser = user;

        try {
            // ── Fetch profiles row ──────────────────────────────
            const { data: profile, error: profileErr } = await db
                .from('profiles')
                .select('full_name, phone_no, city, profile_img')
                .eq('user_id', user.id)
                .single();

            if (profileErr && profileErr.code !== 'PGRST116') {
                // PGRST116 = "no rows" — that's fine for a new user
                throw profileErr;
            }

            originalProfile  = profile  || {};

            // ── Fetch customer_location row ─────────────────────
            const { data: location, error: locationErr } = await db
                .from('customer_location')
                .select('address, coordinates')
                .eq('user_id', user.id)
                .single();

            // location may not exist yet — that's OK
            if (locationErr && locationErr.code !== 'PGRST116') {
                console.warn('[UserProfile] Location fetch warning:', locationErr.message);
            }

            originalLocation = location || null;

            populateUI(user, originalProfile, originalLocation);

        } catch (err) {
            console.error('[UserProfile] Fetch error:', err.message);
            showToast('Could not load profile: ' + err.message, 'error');
        }
    }

    function initAuth() {
        const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
            subscription.unsubscribe();
            if (!session?.user) {
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
       Step 1: Upload new avatar to storage (if selected)
       Step 2: Upsert public.profiles
               (full_name, phone_no, city, profile_img)
       Step 3: Upsert public.customer_location
               (address, coordinates)
       Step 4: Change password (if both old + new provided)
       ============================================================ */
    const saveBtn = $('saveBtn');

    async function saveProfile() {
        if (!currentUser) return;

        saveBtn.disabled  = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

        let hasError     = false;
        let newAvatarUrl = null;

        /* ── Step 1: Avatar upload ── */
        if (pendingAvatarFile) {
            try {
                const existingUrl = originalProfile?.profile_img || null;
                newAvatarUrl      = await uploadAvatar(currentUser.id, pendingAvatarFile, existingUrl);
                pendingAvatarFile = null;
            } catch (err) {
                showToast(err.message, 'error');
                hasError = true;
            }
        }

        /* ── Step 2: Upsert profiles ── */
        if (!hasError) {
            const firstName = val('firstName');
            const lastName  = val('lastName');
            const fullName  = [firstName, lastName].filter(Boolean).join(' ') || null;

            const profilePayload = {
                user_id:   currentUser.id,
                full_name: fullName,
                phone_no:  val('phone')       || null,
                city:      val('city')        || null,
            };

            if (newAvatarUrl) {
                profilePayload.profile_img = newAvatarUrl;
            }

            const { error: profileErr } = await db
                .from('profiles')
                .upsert(profilePayload, { onConflict: 'user_id' });

            if (profileErr) {
                showToast('Profile save failed: ' + profileErr.message, 'error');
                hasError = true;
            } else {
                // Keep originalProfile in sync so Cancel restores correctly
                originalProfile = { ...originalProfile, ...profilePayload };
                if (newAvatarUrl) originalProfile.profile_img = newAvatarUrl;

                // Update UI name display
                const displayName = fullName || 'User';
                currentInitials   = getInitials(displayName);
                setText('avatarName',      displayName);
                setText('sidebarUserName', displayName);

                if (newAvatarUrl) {
                    setMainAvatar(newAvatarUrl, currentInitials);
                    setSidebarAvatar(newAvatarUrl, currentInitials);
                }
            }
        }

        /* ── Step 3: Upsert customer_location ── */
        if (!hasError) {
            const address     = val('street')      || null;
            const coordinates = val('coordinates') || null;

            // Only write if at least one field has a value
            if (address || coordinates) {
                const locationPayload = {
                    user_id:     currentUser.id,
                    address:     address,
                    coordinates: coordinates,
                };

                const { error: locationErr } = await db
                    .from('customer_location')
                    .upsert(locationPayload, { onConflict: 'user_id' });

                if (locationErr) {
                    console.warn('[UserProfile] Location save warning:', locationErr.message);
                    // Non-fatal — profile already saved, just warn
                    showToast('Profile saved, but location update failed: ' + locationErr.message, 'info');
                } else {
                    originalLocation = { ...originalLocation, address, coordinates };
                }
            }
        }

        /* ── Step 4: Password change ── */
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
        if (currentUser && originalProfile !== null) {
            populateUI(currentUser, originalProfile, originalLocation);
        }
        setVal('oldPassword', '');
        setVal('newPassword', '');
        showToast('Changes discarded.', 'info');
    });

    /* ── INIT ── */
    initAuth();

})();
