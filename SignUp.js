document.addEventListener('DOMContentLoaded', function () {

    // ════════════════════════════════════════
    // PASSWORD TOGGLES
    // ════════════════════════════════════════
    document.querySelectorAll('.toggle-password').forEach((icon) => {
        icon.addEventListener('click', function () {
            const input = this.parentElement.querySelector('input');
            const show  = input.getAttribute('type') === 'password';
            input.setAttribute('type', show ? 'text' : 'password');
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    });

    // ════════════════════════════════════════
    // PASSWORD STRENGTH INDICATOR
    // ════════════════════════════════════════
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('input', function () {
            const helper = document.getElementById('pass-helper');
            const len    = this.value.length;
            if (len === 0) {
                helper.textContent = 'Must be at least 8 characters.';
                helper.style.color = 'var(--color-gray)';
            } else if (len < 8) {
                helper.textContent = `${8 - len} more character${8 - len > 1 ? 's' : ''} needed.`;
                helper.style.color = '#dc2626';
            } else {
                helper.textContent = 'Strong password ✓';
                helper.style.color = 'var(--color-forest-green)';
            }
        });
    }

    // ════════════════════════════════════════
    // PHONE NUMBER VALIDATION & FORMATTING
    // ════════════════════════════════════════
    const phoneInput  = document.getElementById('phone');
    const phoneHelper = document.getElementById('phone-helper');

    if (phoneInput) {
        phoneInput.addEventListener('input', function () {
            let val = this.value;
            val = val.replace(/(?!^\+)[^\d]/g, '');
            val = val.replace(/\s/g, '');
            this.value = val;
            validatePhone(val);
        });

        phoneInput.addEventListener('keydown', function (e) {
            const allowedKeys = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
            if (allowedKeys.includes(e.key)) return;
            const val = this.value;
            const pos = this.selectionStart;
            if (e.key === '+') {
                if (pos === 0 && val.indexOf('+') === -1) return;
                e.preventDefault(); return;
            }
            if (!/^\d$/.test(e.key)) { e.preventDefault(); return; }
            if (val.startsWith('+92') && val.length >= 13) { e.preventDefault(); return; }
            if (val.startsWith('0')   && val.length >= 11) { e.preventDefault(); return; }
            if (!val.startsWith('+') && !val.startsWith('0') && val.length >= 11) {
                e.preventDefault(); return;
            }
        });

        phoneInput.addEventListener('paste', function (e) {
            e.preventDefault();
            let pasted = (e.clipboardData || window.clipboardData).getData('text');
            pasted = pasted.replace(/\s/g, '').replace(/(?!^\+)[^\d]/g, '');
            this.value = pasted;
            validatePhone(pasted);
        });
    }

    function validatePhone(val) {
        if (!phoneHelper) return;
        if (!val) {
            phoneHelper.textContent = 'Start with +92 (13 digits) or 0 (11 digits). Digits only.';
            phoneHelper.style.color = 'var(--color-gray)';
            return;
        }
        if (val.startsWith('+92')) {
            const r = 13 - val.length;
            phoneHelper.textContent = r > 0 ? `${r} more digit${r > 1 ? 's' : ''} needed.` : 'Valid number ✓';
            phoneHelper.style.color = r > 0 ? '#dc2626' : 'var(--color-forest-green)';
        } else if (val.startsWith('0')) {
            const r = 11 - val.length;
            phoneHelper.textContent = r > 0 ? `${r} more digit${r > 1 ? 's' : ''} needed.` : 'Valid number ✓';
            phoneHelper.style.color = r > 0 ? '#dc2626' : 'var(--color-forest-green)';
        } else {
            phoneHelper.textContent = 'Must start with +92 or 0.';
            phoneHelper.style.color = '#dc2626';
        }
    }

    function isPhoneValid(val) {
        if (!val) return false;
        if (val.startsWith('+92') && val.length === 13 && /^\+92\d{10}$/.test(val)) return true;
        if (val.startsWith('0')   && val.length === 11 && /^0\d{10}$/.test(val))    return true;
        return false;
    }

    // ════════════════════════════════════════
    // GPS COORDINATES DETECTION
    // ════════════════════════════════════════
    const btnLocate   = document.getElementById('btn-locate');
    const coordInput  = document.getElementById('coordinates');
    const coordHelper = document.getElementById('coord-helper');

    if (btnLocate) {
        btnLocate.addEventListener('click', function () {
            if (!navigator.geolocation) {
                coordHelper.textContent = 'Geolocation is not supported by your browser.';
                coordHelper.style.color = '#dc2626';
                return;
            }
            btnLocate.innerHTML     = '<i class="fa-solid fa-spinner fa-spin"></i> Detecting…';
            btnLocate.disabled      = true;
            coordHelper.textContent = 'Detecting your location…';
            coordHelper.style.color = 'var(--color-gray)';

            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const lat           = position.coords.latitude.toFixed(6);
                    const lng           = position.coords.longitude.toFixed(6);
                    coordInput.value        = `${lat}, ${lng}`;
                    coordHelper.textContent = 'Location detected ✓';
                    coordHelper.style.color = 'var(--color-forest-green)';
                    btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Detect';
                    btnLocate.disabled      = false;
                },
                function () {
                    coordHelper.textContent = 'Could not detect location. You may enter coordinates manually.';
                    coordHelper.style.color = '#dc2626';
                    coordInput.removeAttribute('readonly');
                    coordInput.placeholder  = 'e.g. 24.8607, 67.0011';
                    btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Retry';
                    btnLocate.disabled      = false;
                }
            );
        });
    }

    // ════════════════════════════════════════════════════════════════
    // FORM SUBMISSION
    //
    // COMPLETE FLOW:
    //
    //   [SignUp page]
    //   1. User fills form and submits
    //   2. auth.signUp() is called → Supabase sends verification email
    //      • User has NO active session yet (email not verified)
    //      • DB trigger auto-inserts public.users row on verification
    //   3. Profile data (name, city, phone, address, coordinates) is
    //      saved to localStorage as "pendingProfile"
    //   4. User is redirected to Login.html with a message to verify first
    //
    //   [User clicks verification link in email]
    //   • Supabase verifies the email and redirects to Login.html
    //   • The DB trigger (handle_new_auth_user) now fires and creates
    //     the public.users row automatically (role = 'user')
    //
    //   [Login.js — on successful login]
    //   5. Login.js checks localStorage for "pendingProfile"
    //   6. If found, it inserts into public.profiles + public.customer_location
    //      using the now-active session (auth.uid() is valid)
    //   7. localStorage entry is cleared
    //   8. User is redirected to UserDashboard.html
    //
    // WHY localStorage for profile data?
    //   RLS on profiles/customer_location requires auth.uid() to be set.
    //   auth.uid() is only valid AFTER email verification + login.
    //   Storing data in localStorage bridges the gap safely.
    // ════════════════════════════════════════════════════════════════
    document.getElementById('signup-form').addEventListener('submit', async function (e) {
        e.preventDefault();

        const fullName    = document.getElementById('full-name').value.trim();
        const email       = document.getElementById('email').value.trim();
        const city        = document.getElementById('city').value;
        const phone       = document.getElementById('phone').value.trim();
        const coordinates = document.getElementById('coordinates').value.trim();
        const address     = document.getElementById('address').value.trim();
        const password    = document.getElementById('password').value;
        const confirm     = document.getElementById('confirm-password').value;
        const terms       = document.getElementById('terms').checked;

        // ── Validation ──────────────────────────────────────────────────
        if (!fullName) { showError('full-name', 'Full Name is required.'); return; }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('email', 'Please enter a valid email address.'); return;
        }

        if (!city) {
            alert('Please select your City.');
            document.getElementById('city').focus(); return;
        }

        if (!phone) { showError('phone', 'Phone number is required.'); return; }

        if (!isPhoneValid(phone)) {
            if (phone.startsWith('+92')) {
                showError('phone', 'Phone starting with +92 must be exactly 13 digits (+92XXXXXXXXXX).');
            } else if (phone.startsWith('0')) {
                showError('phone', 'Phone starting with 0 must be exactly 11 digits (0XXXXXXXXXX).');
            } else {
                showError('phone', 'Phone must start with +92 (13 digits) or 0 (11 digits).');
            }
            return;
        }

        if (!coordinates) {
            alert('Coordinates are required. Click "Detect" to auto-fill your location.');
            return;
        }

        if (!password || password.length < 8) {
            showError('password', 'Password must be at least 8 characters long.'); return;
        }

        if (password !== confirm) {
            showError('confirm-password', 'Passwords do not match.'); return;
        }

        if (!terms) {
            alert('Please accept the Terms of Service and Privacy Policy to continue.');
            return;
        }

        // ── Loading state ───────────────────────────────────────────────
        const submitBtn       = document.querySelector('.btn-submit');
        submitBtn.disabled    = true;
        submitBtn.textContent = 'Creating Account…';

        try {
            // ── STEP 1: Register with Supabase Auth ─────────────────────
            // emailRedirectTo = the page user lands on after clicking the
            // verification link. We send them straight to Login.html.
            const { data, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: 'https://noemahmedkhan.github.io/FYDP/Login.html'
                }
            });

            if (signUpError) throw signUpError;

            // ── STEP 2: Save profile data to localStorage ────────────────
            // Login.js will read this after the user verifies and logs in,
            // then write it to public.profiles + public.customer_location.
            localStorage.setItem('pendingProfile', JSON.stringify({
                full_name:   fullName,
                city:        city,
                phone_no:    phone,
                address:     address || null,
                coordinates: coordinates
            }));

            // ── STEP 3: Inform user and redirect ────────────────────────
            alert(
                '✅ Account created!\n\n' +
                'A verification email has been sent to:\n' + email + '\n\n' +
                'Please check your inbox and click the verification link.\n' +
                'After verifying, come back here to Log In.'
            );

            window.location.href = 'Login.html';

        } catch (err) {
            console.error('Signup error:', err);

            let msg = 'Something went wrong. Please try again.';
            if (err.message?.toLowerCase().includes('already registered') ||
                err.message?.toLowerCase().includes('user already exists') ||
                err.message?.toLowerCase().includes('duplicate')) {
                msg = 'An account with this email already exists. Please log in instead.';
            } else if (err.message?.toLowerCase().includes('password')) {
                msg = 'Password is too weak. Please use at least 8 characters.';
            } else if (err.message) {
                msg = err.message;
            }

            alert('Error: ' + msg);
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Create Account';
        }
    });

    function showError(fieldId, message) {
        const el = document.getElementById(fieldId);
        alert(message);
        if (el) el.focus();
    }

});
