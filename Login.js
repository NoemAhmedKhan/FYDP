document.addEventListener('DOMContentLoaded', function () {

    // Role → Dashboard mapping
    const DASHBOARD = {
        user:        'UserDashboard.html',
        pharmacist:  'PharmDashboard.html',
        admin:       'AdminDashboard.html'
    };

    /* ── Password Toggle ── */
    const togglePassword = document.querySelector('.toggle-password');
    const passwordInput  = document.querySelector('#password');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const isPassword = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    }

    /* ── Login Form Submit ── */
    const loginForm  = document.querySelector('.login-form');
    const submitBtn  = document.querySelector('.btn-submit');

    if (!loginForm) return;

    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const email    = document.querySelector('#email').value.trim();
        const password = document.querySelector('#password').value;

        // ── Validation ──────────────────────────────────────────────────
        if (!email || !password) {
            alert('Please fill in all fields.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('Please enter a valid email address.');
            return;
        }

        setLoading(true);

        try {
            // ── STEP 1: Sign In ──────────────────────────────────────────
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) throw error;

            const user = data.user;

            // ── STEP 2: Email verification check ────────────────────────
            // Skip for pharmacists & admins — their accounts are pre-confirmed
            // by the approve-pharmacy Edge Function or manually by admin.
            if (!user.email_confirmed_at) {
                alert(
                    'Your email is not verified yet.\n\n' +
                    'Please check your inbox and click the verification link.\n\n' +
                    'Did not receive it? Check your spam folder.'
                );
                await supabaseClient.auth.signOut();
                setLoading(false);
                return;
            }

            // ── STEP 3: Get role from public.users ───────────────────────
            const { data: userRow, error: roleErr } = await supabaseClient
                .from('users')
                .select('role')
                .eq('id', user.id)
                .single();

            if (roleErr || !userRow) {
                // Row missing — shouldn't happen but handle gracefully
                await supabaseClient.auth.signOut();
                throw new Error('Account not found in system. Please contact support.');
            }

            const role = userRow.role; // 'user' | 'pharmacist' | 'admin'

            // ── STEP 4: Flush pendingProfile (new user signups only) ─────
            // SignUp.js parks profile data here before email verification.
            // Only relevant for role='user' — pharmacists are handled server-side.
            if (role === 'user') {
                await flushPendingProfile(user.id);
            }

            // ── STEP 5: Redirect based on role ──────────────────────────
            const destination = DASHBOARD[role];
            if (!destination) throw new Error(`Unknown role: ${role}`);

            window.location.href = {destination};

        } catch (err) {
            console.error('Login error:', err);
            alert(friendlyError(err.message));
            setLoading(false);
        }
    });

    // ── Flush pending profile data saved by SignUp.js ──────────────────
    async function flushPendingProfile(userId) {
        const raw = localStorage.getItem('pendingProfile');
        if (!raw) return;

        try {
            const profile = JSON.parse(raw);

            // Insert into public.profiles (ignore duplicate — safe on re-login)
            const { error: profileErr } = await supabaseClient
                .from('profiles')
                .insert([{
                    user_id:   userId,
                    full_name: profile.full_name,
                    city:      profile.city,
                    phone_no:  profile.phone_no
                }]);

            if (profileErr && !profileErr.message?.toLowerCase().includes('duplicate')) {
                console.warn('Profile insert warning:', profileErr.message);
            }

            // Insert into public.customer_location
            const { error: locationErr } = await supabaseClient
                .from('customer_location')
                .insert([{
                    user_id:     userId,
                    address:     profile.address || null,
                    coordinates: profile.coordinates
                }]);

            if (locationErr && !locationErr.message?.toLowerCase().includes('duplicate')) {
                console.warn('Location insert warning:', locationErr.message);
            }

        } catch (parseErr) {
            console.warn('Could not parse pendingProfile:', parseErr);
        } finally {
            // Always clear — don't leave stale data on the next login
            localStorage.removeItem('pendingProfile');
        }
    }

    // ── Button loading state ───────────────────────────────────────────
    function setLoading(loading) {
        submitBtn.disabled    = loading;
        submitBtn.textContent = loading ? 'Logging in…' : 'Log In';
    }

    // ── User-friendly error messages ───────────────────────────────────
    function friendlyError(message = '') {
        const msg = message.toLowerCase();
        if (msg.includes('email not confirmed'))       return 'Your email is not verified yet. Please check your inbox.';
        if (msg.includes('invalid login credentials')) return 'Incorrect email or password. Please try again.';
        if (msg.includes('too many requests'))         return 'Too many attempts. Please wait a moment and try again.';
        return message || 'Login failed. Please try again.';
    }
});
