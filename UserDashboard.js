/* =============================================
   MediFinder — UserDashboard.js

   CHANGES:
   • Sidebar avatar now loads profile_img from the
     "users" table in Supabase. If profile_img is
     present, it shows the uploaded photo. If not,
     it falls back to Images/ProfileAvatar.jpg.
   ============================================= */

/* ── Auth Guard + Load User Profile ── */
async function initDashboard() {

    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

    if (sessionError || !session) {
        window.location.href = 'Login.html';
        return;
    }

    try {
        const { data: profile, error: profileError } = await supabaseClient
            .from('users')
            .select('first_name, last_name, city, profile_img')
            .eq('id', session.user.id)
            .single();

        if (profileError) throw profileError;

        const firstName = profile.first_name || 'User';
        const fullName  = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const email     = session.user.email;

        // ── Welcome message ──
        const welcomeEl = document.querySelector('.topbar__welcome h1');
        if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}!`;

        // ── Sidebar text ──
        const userNameEl  = document.querySelector('.user-name');
        const userEmailEl = document.querySelector('.user-email');
        if (userNameEl)  userNameEl.textContent  = fullName || 'User';
        if (userEmailEl) userEmailEl.textContent = email    || '';

        // ── Sidebar avatar ──
        // If user has uploaded a profile photo, show it.
        // Otherwise fall back to the default Images/ProfileAvatar.jpg.
        renderSidebarAvatar(profile.profile_img || null);

    } catch (err) {
        console.error('Profile load error:', err.message);
    }
}

/* ── Sidebar Avatar Renderer ──
   Replaces the static <img> in the sidebar with either:
   a) The Supabase profile photo URL
   b) The default Images/ProfileAvatar.jpg as fallback          */
function renderSidebarAvatar(profileImgUrl) {
    const avatarEl = document.querySelector('.user-avatar');
    if (!avatarEl) return;

    // Clear whatever is in the avatar container
    avatarEl.innerHTML = '';

    const img = document.createElement('img');
    img.alt   = 'User Avatar';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';

    img.onerror = () => {
        // Profile URL broken — try default avatar
        if (!img.src.includes('ProfileAvatar')) {
            img.src = 'Images/ProfileAvatar.jpg';
        } else {
            // Default also missing — show initials fallback
            avatarEl.innerHTML = '<span style="color:white;font-size:14px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">U</span>';
        }
    };

    img.src = profileImgUrl || 'Images/ProfileAvatar.jpg';
    avatarEl.appendChild(img);
}

/* ── Logout ── */
const logoutBtn = document.querySelector('.user-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });
}

/* ── Run on page load ── */
initDashboard();

/* =============================================
   Sidebar Toggle (Mobile)
   ============================================= */
(function () {
    'use strict';

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

})();
