/* =============================================
   MediFinder — UserDashboard.js
   ============================================= */

/* ── Auth Guard + Load User Profile ── */
async function initDashboard() {

    // Check if user has an active session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
        // No session → redirect to login
        window.location.href = 'Login.html';
        return;
    }

    try {
        // ── Fetch profile from users table ──
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('first_name, last_name, city')
            .eq('id', session.user.id)
            .single();

        if (profileError) throw profileError;

        const firstName = profile.first_name  || 'User';
        const fullName  = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const email     = session.user.email;

        // ── Update Welcome Message ──
        const welcomeEl = document.querySelector('.topbar__welcome h1');
        if (welcomeEl) welcomeEl.textContent = `Welcome back, ${firstName}!`;

        // ── Update Sidebar User Info ──
        const userNameEl  = document.querySelector('.user-name');
        const userEmailEl = document.querySelector('.user-email');
        if (userNameEl)  userNameEl.textContent  = fullName  || 'User';
        if (userEmailEl) userEmailEl.textContent = email     || '';

    } catch (err) {
        console.error('Profile load error:', err.message);
    }
}

/* ── Logout ── */
const logoutBtn = document.querySelector('.user-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async function (e) {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = 'index.html'; // ← logout goes to home page
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

    function openSidebar()  {
        sidebar.classList.add('sidebar--open');
        document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
        sidebar.classList.remove('sidebar--open');
        document.body.style.overflow = '';
    }

    hamburgerBtn   && hamburgerBtn.addEventListener('click', () =>
        sidebar.classList.contains('sidebar--open') ? closeSidebar() : openSidebar()
    );
    sidebarOverlay && sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => e.key === 'Escape' && closeSidebar());

})();
