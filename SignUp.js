document.addEventListener('DOMContentLoaded', function () {

    /* ── Password toggles ── */
    document.querySelectorAll('.toggle-password').forEach((icon) => {
        icon.addEventListener('click', function () {
            const input = this.parentElement.querySelector('input');
            const isPassword = input.getAttribute('type') === 'password';
            input.setAttribute('type', isPassword ? 'text' : 'password');
            this.classList.toggle('fa-eye-slash');
            this.classList.toggle('fa-eye');
        });
    });

    /* ── Real-time password strength ── */
    const passwordInput = document.getElementById('password');
    if (passwordInput) {
        passwordInput.addEventListener('input', function () {
            const helper = document.getElementById('pass-helper');
            const len = this.value.length;
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

    /* ── Auto-detect coordinates ── */
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
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;

                    function toDMS(deg, posLabel, negLabel) {
                        const dir = deg >= 0 ? posLabel : negLabel;
                        const abs = Math.abs(deg);
                        const d   = Math.floor(abs);
                        const mf  = (abs - d) * 60;
                        const m   = Math.floor(mf);
                        const s   = ((mf - m) * 60).toFixed(1);
                        return `${d}°${String(m).padStart(2,'0')}'${String(s).padStart(4,'0')}"${dir}`;
                    }

                    coordInput.value        = `${toDMS(lat,'N','S')} ${toDMS(lng,'E','W')}`;
                    coordHelper.textContent = 'Location detected ✓';
                    coordHelper.style.color = 'var(--color-forest-green)';
                    btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Detect';
                    btnLocate.disabled      = false;
                },
                function () {
                    coordHelper.textContent  = 'Could not detect location. Please enter manually.';
                    coordHelper.style.color  = '#dc2626';
                    coordInput.removeAttribute('readonly');
                    coordInput.placeholder   = 'e.g. 33°41\'00"N 73°03\'00"E';
                    btnLocate.innerHTML      = '<i class="fa-solid fa-location-crosshairs"></i> Detect';
                    btnLocate.disabled       = false;
                }
            );
        });
    }

    /* ── Form Submission ── */
    document.getElementById('signup-form').addEventListener('submit', async function (e) {
        e.preventDefault();

        const firstName   = document.getElementById('first-name').value.trim();
        const lastName    = document.getElementById('last-name').value.trim();
        const email       = document.getElementById('email').value.trim();
        const coordinates = document.getElementById('coordinates').value.trim();
        const password    = document.getElementById('password').value;
        const confirm     = document.getElementById('confirm-password').value;
        const terms       = document.getElementById('terms').checked;
        const city        = document.getElementById('city').value;
        const phone       = document.getElementById('phone').value.trim();
        const address     = document.getElementById('address').value.trim();

        // ── Validation ──
        if (!firstName) {
            alert('First Name is required.');
            document.getElementById('first-name').focus();
            return;
        }
        if (!email) {
            alert('Email is required.');
            document.getElementById('email').focus();
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Please enter a valid email address.');
            document.getElementById('email').focus();
            return;
        }
        if (!coordinates) {
            alert('Coordinates are required. Click "Detect" to auto-fill your location.');
            return;
        }
        if (!password) {
            alert('Password is required.');
            document.getElementById('password').focus();
            return;
        }
        if (password.length < 8) {
            alert('Password must be at least 8 characters long.');
            document.getElementById('password').focus();
            return;
        }
        if (password !== confirm) {
            alert('Passwords do not match.');
            document.getElementById('confirm-password').focus();
            return;
        }
        if (!terms) {
            alert('Please accept the Terms of Service and Privacy Policy.');
            return;
        }

        // ── Disable button ──
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.disabled     = true;
        submitBtn.textContent  = 'Creating Account…';

        try {
            // ── STEP 1: Create auth account → triggers verification email ──
            const { data, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: 'https://noemahmedkhan.github.io/FYDP/UserDashboard.html'
                }
            });

            if (signUpError) throw signUpError;

            // ── STEP 2: Insert profile into users table ──
            // Note: phone_no is numeric in your table so we parse it
            const phoneNumeric = phone ? parseInt(phone.replace(/\D/g, ''), 10) : null;

            const { error: insertError } = await supabaseClient
                .from('users')
                .insert([{
                    id:          data.user.id,
                    first_name:  firstName,
                    last_name:   lastName || null,
                    city:        city     || null,
                    phone_no:    phoneNumeric,
                    address:     address  || null,
                    coordinates: coordinates
                }]);

            if (insertError) throw insertError;

            // ── STEP 3: Success ──
            alert('Account created successfully!\n\nPlease check your email inbox and click the verification link before logging in.');
            window.location.href = 'Login.html';

        } catch (err) {
            alert('Error: ' + err.message);
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Create Account';
        }
    });
});
