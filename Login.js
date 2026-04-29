document.addEventListener('DOMContentLoaded', function () {

    /* ── Password Toggle ── */
    const togglePassword = document.querySelector('.toggle-password');
    const passwordInput  = document.querySelector('#password');
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', function () {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    }

    /* ── Login Form Submit ── */
    const loginForm = document.querySelector('.login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email    = document.querySelector('#email').value.trim();
            const password = document.querySelector('#password').value;

            // ── Basic Validation ──
            if (!email || !password) {
                alert('Please fill in all fields.');
                return;
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert('Please enter a valid email address.');
                return;
            }

            // ── Disable button ──
            const submitBtn       = document.querySelector('.btn-submit');
            submitBtn.disabled    = true;
            submitBtn.textContent = 'Logging in…';

            try {
                // ── STEP 1: Sign In ──────────────────────────────────────
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                // ── STEP 2: Check email verified ─────────────────────────
                if (!data.user.email_confirmed_at) {
                    alert(
                        'Your email is not verified yet.\n\n' +
                        'Please check your inbox and click the verification link first.\n\n' +
                        'Did not receive it? Check your spam folder.'
                    );
                    await supabaseClient.auth.signOut();
                    submitBtn.disabled    = false;
                    submitBtn.textContent = 'Log In';
                    return;
                }

                const userId = data.user.id;

                // ── STEP 3: Flush pendingProfile if present ──────────────
                // This data was saved by SignUp.js before email verification.
                // Now that the user has a valid session we can write to DB.
                const pending = localStorage.getItem('pendingProfile');
                if (pending) {
                    try {
                        const profile = JSON.parse(pending);

                        // Insert into public.profiles
                        // ON CONFLICT DO NOTHING — safe if already exists
                        const { error: profileErr } = await supabaseClient
                            .from('profiles')
                            .insert([{
                                user_id:   userId,
                                full_name: profile.full_name,
                                city:      profile.city,
                                phone_no:  profile.phone_no
                            }]);

                        // "duplicate" or "already exists" is fine — user may have logged in twice
                        if (profileErr && !profileErr.message?.toLowerCase().includes('duplicate')) {
                            console.warn('Profile insert warning:', profileErr.message);
                        }

                        // Insert into public.customer_location
                        const { error: locationErr } = await supabaseClient
                            .from('customer_location')
                            .insert([{
                                user_id:     userId,
                                address:     profile.address     || null,
                                coordinates: profile.coordinates
                            }]);

                        if (locationErr && !locationErr.message?.toLowerCase().includes('duplicate')) {
                            console.warn('Location insert warning:', locationErr.message);
                        }

                        // Clear the pending data — whether inserts succeeded or not
                        // (don't leave stale data for the next login)
                        localStorage.removeItem('pendingProfile');

                    } catch (parseErr) {
                        // Corrupted localStorage entry — just clear it
                        console.warn('Could not parse pendingProfile:', parseErr);
                        localStorage.removeItem('pendingProfile');
                    }
                }

                // ── STEP 4: Redirect to dashboard ────────────────────────
                window.location.href = 'UserDashboard.html';

            } catch (err) {
                console.error('Login error:', err);

                let msg = 'Login failed. Please check your email and password.';
                if (err.message?.toLowerCase().includes('email not confirmed')) {
                    msg = 'Your email is not verified yet. Please check your inbox.';
                } else if (err.message?.toLowerCase().includes('invalid login credentials')) {
                    msg = 'Incorrect email or password. Please try again.';
                } else if (err.message) {
                    msg = err.message;
                }

                alert(msg);
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Log In';
            }
        });
    }
});
