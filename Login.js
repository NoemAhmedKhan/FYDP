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

            // ── Validation ──
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
            const submitBtn = document.querySelector('.btn-submit');
            submitBtn.disabled    = true;
            submitBtn.textContent = 'Logging in…';

            try {
                // ── Supabase Sign In ──
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                // ── Check email verified ──
                if (!data.user.email_confirmed_at) {
                    alert('Your email is not verified yet.\n\nPlease check your inbox and click the verification link first.');
                    await supabase.auth.signOut();
                    submitBtn.disabled    = false;
                    submitBtn.textContent = 'Log In';
                    return;
                }

                // ── Success → Dashboard ──
                window.location.href = 'UserDashboard.html';

            } catch (err) {
                alert('Login failed. Please check your email and password.');
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Log In';
            }
        });
    }
});
