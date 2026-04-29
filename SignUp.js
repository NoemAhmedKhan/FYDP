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
    // Rules:
    //   • Only digits and leading + allowed
    //   • Starts with +92  → exactly 13 chars total (+923XXXXXXXXX)
    //   • Starts with 0    → exactly 11 digits (03XXXXXXXXX)
    //   • No spaces, dashes, or other characters at any point
    // ════════════════════════════════════════
    const phoneInput  = document.getElementById('phone');
    const phoneHelper = document.getElementById('phone-helper');

    if (phoneInput) {
        phoneInput.addEventListener('input', function (e) {
            let val = this.value;

            // Allow only + at start and digits everywhere else
            // Remove any character that is not a digit or a leading +
            val = val.replace(/(?!^\+)[^\d]/g, '');   // keep leading +, remove all non-digits elsewhere
            val = val.replace(/\s/g, '');              // remove any spaces just in case

            this.value = val;
            validatePhone(val);
        });

        phoneInput.addEventListener('keydown', function (e) {
            const allowedKeys = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
            if (allowedKeys.includes(e.key)) return;

            const val = this.value;
            const pos = this.selectionStart;

            // Only allow + as the very first character
            if (e.key === '+') {
                if (pos === 0 && val.indexOf('+') === -1) return; // allow
                e.preventDefault();
                return;
            }

            // Only allow digits
            if (!/^\d$/.test(e.key)) {
                e.preventDefault();
                return;
            }

            // Enforce max length based on prefix
            if (val.startsWith('+92') && val.length >= 13) { e.preventDefault(); return; }
            if (val.startsWith('0')   && val.length >= 11) { e.preventDefault(); return; }
            if (!val.startsWith('+') && !val.startsWith('0') && val.length >= 11) {
                e.preventDefault(); return;
            }
        });

        // Paste handler — strip bad characters
        phoneInput.addEventListener('paste', function (e) {
            e.preventDefault();
            let pasted = (e.clipboardData || window.clipboardData).getData('text');
            pasted = pasted.replace(/\s/g, '');
            pasted = pasted.replace(/(?!^\+)[^\d]/g, '');
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
            const remaining = 13 - val.length;
            if (remaining > 0) {
                phoneHelper.textContent = `${remaining} more digit${remaining > 1 ? 's' : ''} needed.`;
                phoneHelper.style.color = '#dc2626';
            } else {
                phoneHelper.textContent = 'Valid number ✓';
                phoneHelper.style.color = 'var(--color-forest-green)';
            }
        } else if (val.startsWith('0')) {
            const remaining = 11 - val.length;
            if (remaining > 0) {
                phoneHelper.textContent = `${remaining} more digit${remaining > 1 ? 's' : ''} needed.`;
                phoneHelper.style.color = '#dc2626';
            } else {
                phoneHelper.textContent = 'Valid number ✓';
                phoneHelper.style.color = 'var(--color-forest-green)';
            }
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
            btnLocate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Detecting…';
            btnLocate.disabled  = true;
            coordHelper.textContent = 'Detecting your location…';
            coordHelper.style.color = 'var(--color-gray)';

            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const lat = position.coords.latitude.toFixed(6);
                    const lng = position.coords.longitude.toFixed(6);
                    coordInput.value        = `${lat}, ${lng}`;
                    coordHelper.textContent = 'Location detected ✓';
                    coordHelper.style.color = 'var(--color-forest-green)';
                    btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Detect';
                    btnLocate.disabled      = false;
                },
                function () {
                    coordHelper.textContent  = 'Could not detect location. You may enter coordinates manually.';
                    coordHelper.style.color  = '#dc2626';
                    coordInput.removeAttribute('readonly');
                    coordInput.placeholder   = 'e.g. 24.8607, 67.0011';
                    btnLocate.innerHTML      = '<i class="fa-solid fa-location-crosshairs"></i> Retry';
                    btnLocate.disabled       = false;
                }
            );
        });
    }

    // ════════════════════════════════════════
    // FORM SUBMISSION
    // Writes to: users, profiles, customer_location
    // ════════════════════════════════════════
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

        // ── Validation ────────────────────────────────────────────────────

        if (!fullName) {
            showError('full-name', 'Full Name is required.');
            return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showError('email', 'Please enter a valid email address.');
            return;
        }

        if (!city) {
            alert('Please select your City.');
            document.getElementById('city').focus();
            return;
        }

        if (!phone) {
            showError('phone', 'Phone number is required.');
            return;
        }

        if (!isPhoneValid(phone)) {
            if (phone.startsWith('+92')) {
                showError('phone', 'Phone starting with +92 must be exactly 13 digits total (+92XXXXXXXXXX).');
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
            showError('password', 'Password must be at least 8 characters long.');
            return;
        }

        if (password !== confirm) {
            showError('confirm-password', 'Passwords do not match.');
            return;
        }

        if (!terms) {
            alert('Please accept the Terms of Service and Privacy Policy to continue.');
            return;
        }

        // ── Loading state ─────────────────────────────────────────────────
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.disabled    = true;
        submitBtn.textContent = 'Creating Account…';

        try {
            // ── STEP 1: Create auth account (Supabase Auth) ───────────────
            const { data, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: 'https://noemahmedkhan.github.io/FYDP/UserDashboard.html'
                }
            });

            if (signUpError) throw signUpError;

            const userId = data.user.id;

            // ── STEP 2: Insert into public.users ──────────────────────────
            const { error: userError } = await supabaseClient
                .from('users')
                .insert([{
                    id:    userId,
                    email: email,
                    role:  'user'
                }]);

            // Ignore duplicate key error (user already exists from a previous attempt)
            if (userError && !userError.message.includes('duplicate')) {
                throw userError;
            }

            // ── STEP 3: Insert into public.profiles ───────────────────────
            const { error: profileError } = await supabaseClient
                .from('profiles')
                .insert([{
                    user_id:   userId,
                    full_name: fullName,
                    city:      city,
                    phone_no:  phone
                }]);

            if (profileError && !profileError.message.includes('duplicate')) {
                throw profileError;
            }

            // ── STEP 4: Insert into public.customer_location ──────────────
            const { error: locationError } = await supabaseClient
                .from('customer_location')
                .insert([{
                    user_id:     userId,
                    address:     address || null,
                    coordinates: coordinates
                }]);

            if (locationError && !locationError.message.includes('duplicate')) {
                throw locationError;
            }

            // ── STEP 5: Success ───────────────────────────────────────────
            alert(
                'Account created successfully! 🎉\n\n' +
                'Please check your email inbox and click the verification link before logging in.'
            );
            window.location.href = 'Login.html';

        } catch (err) {
            console.error('Signup error:', err);
            alert('Error: ' + (err.message || 'Something went wrong. Please try again.'));
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Create Account';
        }
    });

    // ── Helper: show inline error & focus ────────────────────────────────
    function showError(fieldId, message) {
        const el = document.getElementById(fieldId);
        alert(message);
        if (el) el.focus();
    }

});
