/* ══════════════════════════════════════════════════════
   PharmacyRegister.js — MediFinder
   Multi-step pharmacy registration with Supabase backend

   Supabase table required — run this SQL in your Supabase SQL Editor:

   CREATE TABLE pharmacies (
       id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       auth_user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
       pharmacy_name   TEXT NOT NULL,
       owner_name      TEXT NOT NULL,
       phone           TEXT NOT NULL,
       license_no      TEXT NOT NULL,
       reg_no          TEXT NOT NULL,
       cnic            TEXT NOT NULL,
       pharmacy_type   TEXT NOT NULL,
       operating_hours TEXT NOT NULL,
       delivery        BOOLEAN DEFAULT TRUE,
       province        TEXT NOT NULL,
       city            TEXT NOT NULL,
       address         TEXT NOT NULL,
       landmark        TEXT,
       coordinates     TEXT NOT NULL,
       email           TEXT NOT NULL,
       license_doc_url TEXT,
       cnic_doc_url    TEXT,
       status          TEXT DEFAULT 'pending',
       created_at      TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Allow pharmacy self-insert"
       ON pharmacies FOR INSERT TO authenticated
       WITH CHECK (auth.uid() = auth_user_id);

   CREATE POLICY "Allow pharmacy self-select"
       ON pharmacies FOR SELECT TO authenticated
       USING (auth.uid() = auth_user_id);
   ══════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://yeckojtbgrdwuennjgke.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllY2tvanRiZ3Jkd3Vlbm5qZ2tlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODMxODAsImV4cCI6MjA4Nzk1OTE4MH0.rXyWstRjT0PeE35Rvl_BgXbTFa8zhrUMEoHtgBBpPso';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ──────────────────────────────────────────
   CITIES DATA — keyed by province value
────────────────────────────────────────── */
const citiesByProvince = {
    Punjab: [
        'Lahore','Faisalabad','Rawalpindi','Gujranwala','Multan','Sialkot',
        'Bahawalpur','Sargodha','Sheikhupura','Jhang','Rahim Yar Khan','Gujrat',
        'Kasur','Sahiwal','Okara','Wah Cantt','Dera Ghazi Khan','Chiniot',
        'Kamoke','Hafizabad','Sadiqabad','Burewala','Khanewal','Pakpattan',
        'Muzaffargarh','Lodhran','Vehari','Attock','Chakwal','Jhelum',
        'Mandi Bahauddin','Narowal','Toba Tek Singh','Nankana Sahib',
        'Khushab','Mianwali','Bhakkar','Layyah','Rajanpur','Bahawalnagar'
    ],
    Sindh: [
        'Karachi','Hyderabad','Sukkur','Larkana','Mirpurkhas','Nawabshah',
        'Jacobabad','Shikarpur','Khairpur','Dadu','Thatta','Badin',
        'Tando Adam','Tando Allahyar','Sanghar','Umerkot','Ghotki',
        'Qambar','Kashmore','Matiari'
    ],
    KPK: [
        'Peshawar','Mardan','Mingora (Swat)','Kohat','Abbottabad','Mansehra',
        'Dera Ismail Khan','Nowshera','Charsadda','Swabi','Haripur','Bannu',
        'Karak','Lakki Marwat','Tank','Chitral','Dir','Battagram','Shangla','Buner'
    ],
    Balochistan: [
        'Quetta','Turbat','Khuzdar','Hub','Chaman','Gwadar','Dera Murad Jamali',
        'Zhob','Loralai','Sibi','Kharan','Nushki','Kalat','Mastung',
        'Pishin','Panjgur','Washuk','Awaran','Lasbela','Ziarat'
    ],
    ICT: ['Islamabad'],
    AJK: ['Muzaffarabad','Mirpur','Rawalakot','Kotli','Bhimber','Bagh','Sudhnoti','Hattian Bala','Haveli','Neelum'],
    GB:  ['Gilgit','Skardu','Chilas','Ghanche','Hunza','Nagar','Astore','Ghizer']
};

document.addEventListener('DOMContentLoaded', function () {

    /* ─────────────────────────────────────────
       STEP NAVIGATION
    ───────────────────────────────────────── */
    let currentStep = 1;
    const totalSteps = 3;

    function goToStep(n) {
        document.querySelectorAll('.form-step').forEach(s => s.classList.add('hidden'));
        document.getElementById(`step-${n}`).classList.remove('hidden');

        for (let i = 1; i <= totalSteps; i++) {
            const ind  = document.getElementById(`step-ind-${i}`);
            ind.classList.remove('active', 'done');
            if (i < n) ind.classList.add('done');
            if (i === n) ind.classList.add('active');
        }
        for (let i = 1; i < totalSteps; i++) {
            const line = document.getElementById(`line-${i}`);
            if (line) {
                if (i < n) line.classList.add('done');
                else line.classList.remove('done');
            }
        }

        currentStep = n;
        document.querySelector('.right-panel').scrollTo({ top: 0, behavior: 'smooth' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    document.getElementById('btn-next-1').addEventListener('click', () => { if (validateStep1()) goToStep(2); });
    document.getElementById('btn-next-2').addEventListener('click', () => { if (validateStep2()) goToStep(3); });
    document.getElementById('btn-back-2').addEventListener('click', () => goToStep(1));
    document.getElementById('btn-back-3').addEventListener('click', () => goToStep(2));


    /* ─────────────────────────────────────────
       HELPERS
    ───────────────────────────────────────── */
    function showError(fieldId, msg) {
        const field   = document.getElementById(fieldId);
        const errSpan = document.getElementById(`err-${fieldId}`);
        if (field)   field.classList.add('is-invalid');
        if (errSpan) errSpan.textContent = msg;
    }

    function clearError(fieldId) {
        const field   = document.getElementById(fieldId);
        const errSpan = document.getElementById(`err-${fieldId}`);
        if (field)   { field.classList.remove('is-invalid'); field.classList.remove('is-valid'); }
        if (errSpan) errSpan.textContent = '';
    }

    function markValid(fieldId) {
        const field = document.getElementById(fieldId);
        if (field) { field.classList.remove('is-invalid'); field.classList.add('is-valid'); }
    }

    function clearAllErrors() {
        document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        document.querySelectorAll('.error-msg').forEach(el => el.textContent = '');
    }

    /* ─────────────────────────────────────────
       REAL-TIME VALIDATION — clear on input
    ───────────────────────────────────────── */
    ['pharmacy-name','owner-name','phone','license-no','reg-no','cnic',
     'pharmacy-type','operating-hours','province','city','address',
     'email','password','confirm-password'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => clearError(id));
    });


    /* ─────────────────────────────────────────
       STEP 1 VALIDATION — Basic Info
    ───────────────────────────────────────── */
    function validateStep1() {
        clearAllErrors();
        let valid = true;

        const pharmacyName = document.getElementById('pharmacy-name').value.trim();
        const ownerName    = document.getElementById('owner-name').value.trim();
        const phone        = document.getElementById('phone').value.trim();
        const licenseNo    = document.getElementById('license-no').value.trim();
        const regNo        = document.getElementById('reg-no').value.trim();
        const cnic         = document.getElementById('cnic').value.trim();
        const pharmType    = document.getElementById('pharmacy-type').value;
        const opHours      = document.getElementById('operating-hours').value;

        if (!pharmacyName) { showError('pharmacy-name', 'Pharmacy name is required.'); valid = false; }
        if (!ownerName)    { showError('owner-name',    'Owner / Manager name is required.'); valid = false; }

        // Phone validation: 0 → 11 digits | +92 → 13 digits | no spaces/dashes/underscores
        if (!phone) {
            showError('phone', 'Phone number is required.');
            valid = false;
        } else if (/[\s\-_]/.test(phone)) {
            showError('phone', 'No spaces, dashes, or underscores allowed.');
            valid = false;
        } else if (phone.startsWith('0') && !/^0[0-9]{10}$/.test(phone)) {
            showError('phone', 'Starting with 0 requires exactly 11 digits (e.g. 03001234567).');
            valid = false;
        } else if (phone.startsWith('+92') && !/^\+92[0-9]{10}$/.test(phone)) {
            showError('phone', 'Starting with +92 requires exactly 13 digits (e.g. +923001234567).');
            valid = false;
        } else if (!phone.startsWith('0') && !phone.startsWith('+92')) {
            showError('phone', 'Phone must start with 0 or +92.');
            valid = false;
        }

        if (!licenseNo) { showError('license-no', 'Drug License No is required.'); valid = false; }
        if (!regNo)     { showError('reg-no',      'Registration Number is required.'); valid = false; }

        // CNIC validation: XXXXX-XXXXXXX-X
        if (!cnic) {
            showError('cnic', 'CNIC is required.');
            valid = false;
        } else if (!/^\d{5}-\d{7}-\d{1}$/.test(cnic)) {
            showError('cnic', 'CNIC format must be XXXXX-XXXXXXX-X (e.g. 42101-1234567-1).');
            valid = false;
        }

        if (!pharmType) { showError('pharmacy-type',    'Please select pharmacy type.'); valid = false; }
        if (!opHours)   { showError('operating-hours',  'Please select operating hours.'); valid = false; }

        // Custom hours check
        if (opHours === 'custom') {
            const open  = document.getElementById('custom-open').value;
            const close = document.getElementById('custom-close').value;
            if (!open || !close) {
                alert('Please set both opening and closing times for Custom Hours.');
                valid = false;
            }
        }

        return valid;
    }


    /* ─────────────────────────────────────────
       STEP 2 VALIDATION — Location
    ───────────────────────────────────────── */
    function validateStep2() {
        clearAllErrors();
        let valid = true;

        const province    = document.getElementById('province').value;
        const city        = document.getElementById('city').value;
        const address     = document.getElementById('address').value.trim();
        const coordinates = document.getElementById('coordinates').value.trim();

        if (!province) { showError('province', 'Please select a province.'); valid = false; }
        if (!city)     { showError('city',     'Please select a city.'); valid = false; }
        if (!address)  { showError('address',  'Street address is required.'); valid = false; }
        if (!coordinates) {
            const coordInput = document.getElementById('coordinates');
            coordInput.classList.add('is-invalid');
            document.getElementById('coord-helper').textContent = 'GPS Coordinates are required. Click "Detect My Location" or enter manually.';
            document.getElementById('coord-helper').style.color = 'var(--color-error)';
            valid = false;
        }

        return valid;
    }


    /* ─────────────────────────────────────────
       STEP 3 VALIDATION — Account
    ───────────────────────────────────────── */
    function validateStep3() {
        clearAllErrors();
        let valid = true;

        const email    = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const confirm  = document.getElementById('confirm-password').value;
        const terms    = document.getElementById('terms').checked;
        const allFiles = document.getElementById('all-docs').files;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email) {
            showError('email', 'Email address is required.');
            valid = false;
        } else if (!emailRegex.test(email)) {
            showError('email', 'Enter a valid email address (e.g. name@example.com).');
            valid = false;
        }

        if (!password) {
            showError('password', 'Password is required.');
            valid = false;
        } else if (password.length < 8) {
            showError('password', 'Password must be at least 8 characters.');
            valid = false;
        }

        if (!confirm) {
            showError('confirm-password', 'Please confirm your password.');
            valid = false;
        } else if (password && confirm !== password) {
            showError('confirm-password', 'Passwords do not match.');
            valid = false;
        }

        if (!allFiles || allFiles.length === 0) {
            showError('all-docs', 'Please upload at least your Drug License and CNIC documents.');
            valid = false;
        }

        if (!terms) {
            document.getElementById('err-terms').textContent = 'You must agree to the Terms & Privacy Policy before submitting.';
            valid = false;
        }

        return valid;
    }


    /* ─────────────────────────────────────────
       PHONE — Real-time restriction
    ───────────────────────────────────────── */
    const phoneInput = document.getElementById('phone');
    phoneInput.addEventListener('keydown', function (e) {
        // Allow: backspace, delete, tab, escape, arrows, home, end
        const controlKeys = ['Backspace','Delete','Tab','Escape','ArrowLeft','ArrowRight','Home','End'];
        if (controlKeys.includes(e.key)) return;
        // Allow: digits
        if (/^[0-9]$/.test(e.key)) return;
        // Allow: + only if at position 0 and field is empty/just starting
        if (e.key === '+' && this.selectionStart === 0 && !this.value.includes('+')) return;
        // Block everything else (spaces, dashes, letters, etc.)
        e.preventDefault();
    });

    phoneInput.addEventListener('input', function () {
        let val = this.value;
        // Remove any space, dash, underscore, or non-digit/non-plus
        val = val.replace(/[^0-9+]/g, '');
        // Ensure + only appears at the very start
        if (val.indexOf('+') > 0) val = val.replace(/\+/g, '');
        // Enforce length limit
        if (val.startsWith('+92')) {
            if (val.length > 13) val = val.slice(0, 13);
        } else if (val.startsWith('0')) {
            if (val.length > 11) val = val.slice(0, 11);
        }
        this.value = val;
        clearError('phone');
    });



    const cnicInput = document.getElementById('cnic');
    cnicInput.addEventListener('input', function () {
        let v = this.value.replace(/[^0-9]/g, '');
        if (v.length > 13) v = v.slice(0, 13);
        let formatted = v;
        if (v.length > 5)  formatted = v.slice(0,5) + '-' + v.slice(5);
        if (v.length > 12) formatted = v.slice(0,5) + '-' + v.slice(5,12) + '-' + v.slice(12);
        this.value = formatted;
    });


    /* ─────────────────────────────────────────
       OPERATING HOURS — Custom toggle
    ───────────────────────────────────────── */
    const opHoursSelect  = document.getElementById('operating-hours');
    const customHoursRow = document.getElementById('custom-hours-row');

    opHoursSelect.addEventListener('change', function () {
        if (this.value === 'custom') {
            customHoursRow.classList.remove('hidden');
        } else {
            customHoursRow.classList.add('hidden');
        }
    });


    /* ─────────────────────────────────────────
       PROVINCE → CITY DEPENDENT DROPDOWN
    ───────────────────────────────────────── */
    const provinceSelect = document.getElementById('province');
    const citySelect     = document.getElementById('city');

    provinceSelect.addEventListener('change', function () {
        const cities = citiesByProvince[this.value] || [];
        citySelect.innerHTML = '<option value="" disabled selected>Select your city</option>';
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            citySelect.appendChild(opt);
        });
        citySelect.disabled = cities.length === 0;
        clearError('city');
    });


    /* ─────────────────────────────────────────
       GPS DETECT
    ───────────────────────────────────────── */
    const btnLocate   = document.getElementById('btn-locate');
    const coordInput  = document.getElementById('coordinates');
    const coordHelper = document.getElementById('coord-helper');

    btnLocate.addEventListener('click', function () {
        if (!navigator.geolocation) {
            coordHelper.textContent = 'Geolocation is not supported by your browser.';
            coordHelper.style.color = 'var(--color-error)';
            return;
        }

        this.disabled = true;
        this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Detecting…';
        coordHelper.textContent = 'Detecting your location…';
        coordHelper.style.color = 'var(--color-gray)';

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude.toFixed(6);
                const lng = pos.coords.longitude.toFixed(6);
                coordInput.value        = `${lat}, ${lng}`;
                coordInput.removeAttribute('readonly');
                coordHelper.innerHTML   = '<i class="fa-solid fa-circle-check" style="color:var(--color-forest-green)"></i> Location detected successfully.';
                coordHelper.style.color = 'var(--color-forest-green)';
                coordInput.classList.remove('is-invalid');
                btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
                btnLocate.disabled      = false;
            },
            () => {
                coordHelper.textContent = 'Could not detect location. Please enter coordinates manually.';
                coordHelper.style.color = 'var(--color-error)';
                coordInput.removeAttribute('readonly');
                coordInput.placeholder  = 'e.g. 24.8607, 67.0011';
                btnLocate.innerHTML     = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
                btnLocate.disabled      = false;
            }
        );
    });

    // Allow manual edit of coordinates
    coordInput.addEventListener('input', function () {
        if (this.value.trim()) {
            this.classList.remove('is-invalid');
            coordHelper.innerHTML = '<i class="fa-solid fa-circle-info"></i> Used to show your pharmacy on the map for nearby patients.';
            coordHelper.style.color = '#888';
        }
    });


    /* ─────────────────────────────────────────
       PASSWORD TOGGLE
    ───────────────────────────────────────── */
    function setupPasswordToggle(inputId, toggleId) {
        const inp    = document.getElementById(inputId);
        const toggle = document.getElementById(toggleId);
        if (!inp || !toggle) return;
        toggle.addEventListener('click', () => {
            const isPass = inp.type === 'password';
            inp.type     = isPass ? 'text' : 'password';
            toggle.className = isPass
                ? 'fa-regular fa-eye toggle-password'
                : 'fa-regular fa-eye-slash toggle-password';
        });
    }
    setupPasswordToggle('password',         'toggle-pass');
    setupPasswordToggle('confirm-password', 'toggle-confirm');


    /* ─────────────────────────────────────────
       FILE UPLOAD — Unified single upload area
    ───────────────────────────────────────── */
    const allDocsInput = document.getElementById('all-docs');
    const allDocsArea  = document.getElementById('upload-all-docs');
    const allDocsNames = document.getElementById('all-docs-file-names');

    function handleAllDocs(files) {
        const arr   = Array.from(files);
        const valid = arr.filter(f => f.size <= 5 * 1024 * 1024);
        const over  = arr.filter(f => f.size > 5 * 1024 * 1024);
        const errEl = document.getElementById('err-all-docs');
        if (over.length > 0) {
            errEl.textContent = `${over.length} file(s) exceed 5 MB and were skipped.`;
        } else {
            errEl.textContent = '';
        }
        if (valid.length > 0) {
            allDocsNames.innerHTML = valid.map(f => `<span class="file-tag">✓ ${f.name}</span>`).join('');
            allDocsArea.classList.add('has-file');
        } else {
            allDocsNames.innerHTML = '';
            allDocsArea.classList.remove('has-file');
        }
    }

    if (allDocsInput && allDocsArea) {
        allDocsInput.addEventListener('change', function () {
            if (this.files && this.files.length > 0) handleAllDocs(this.files);
        });
        allDocsArea.addEventListener('dragover',  (e) => { e.preventDefault(); allDocsArea.style.borderColor = 'var(--color-forest-green)'; });
        allDocsArea.addEventListener('dragleave', ()  => { allDocsArea.style.borderColor = ''; });
        allDocsArea.addEventListener('drop',      (e) => {
            e.preventDefault();
            allDocsArea.style.borderColor = '';
            const dt = new DataTransfer();
            Array.from(e.dataTransfer.files).forEach(f => dt.items.add(f));
            allDocsInput.files = dt.files;
            handleAllDocs(dt.files);
        });
    }


    /* ─────────────────────────────────────────
       FORM SUBMISSION → SUPABASE
    ───────────────────────────────────────── */
    document.getElementById('pharmacy-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!validateStep3()) return;

        const pharmacyName   = document.getElementById('pharmacy-name').value.trim();
        const ownerName      = document.getElementById('owner-name').value.trim();
        const phone          = document.getElementById('phone').value.trim();
        const licenseNo      = document.getElementById('license-no').value.trim();
        const regNo          = document.getElementById('reg-no').value.trim();
        const cnic           = document.getElementById('cnic').value.trim();
        const pharmacyType   = document.getElementById('pharmacy-type').value;
        const opHoursVal     = document.getElementById('operating-hours').value;
        const delivery       = document.querySelector('input[name="delivery"]:checked').value === 'yes';
        const province       = document.getElementById('province').value;
        const city           = document.getElementById('city').value;
        const address        = document.getElementById('address').value.trim();
        const landmark       = document.getElementById('landmark').value.trim();
        const coordinates    = document.getElementById('coordinates').value.trim();
        const email          = document.getElementById('email').value.trim();
        const password       = document.getElementById('password').value;

        let operatingHours = opHoursVal;
        if (opHoursVal === 'custom') {
            const open  = document.getElementById('custom-open').value;
            const close = document.getElementById('custom-close').value;
            operatingHours = `Custom: ${open} – ${close}`;
        }

        const submitBtn = document.getElementById('btn-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registering…';

        try {
            /* STEP 1: Create Auth account */
            const { data: authData, error: signUpError } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin + '/PharmacyDashboard.html'
                }
            });
            if (signUpError) throw signUpError;

            /* STEP 2: Upload all documents */
            let licenseDocUrl = null;
            let cnicDocUrl    = null;
            const allFiles = document.getElementById('all-docs').files;
            if (allFiles && allFiles.length > 0 && authData.user) {
                for (let i = 0; i < allFiles.length; i++) {
                    const f   = allFiles[i];
                    const ext = f.name.split('.').pop();
                    const fp  = `docs/${authData.user.id}/doc_${i}.${ext}`;
                    const { error: uploadError } = await supabaseClient.storage
                        .from('pharmacy-docs').upload(fp, f, { upsert: true });
                    if (!uploadError) {
                        const { data: urlData } = supabaseClient.storage.from('pharmacy-docs').getPublicUrl(fp);
                        if (i === 0) licenseDocUrl = urlData?.publicUrl || null;
                        if (i === 1) cnicDocUrl    = urlData?.publicUrl || null;
                    } else {
                        console.warn(`Upload failed for ${f.name}:`, uploadError.message);
                    }
                }
            }

            /* STEP 3: Insert pharmacy record */
            const { error: insertError } = await supabaseClient.from('pharmacies').insert([{
                auth_user_id:    authData.user.id,
                pharmacy_name:   pharmacyName,
                owner_name:      ownerName,
                phone,
                license_no:      licenseNo,
                reg_no:          regNo,
                cnic,
                pharmacy_type:   pharmacyType,
                operating_hours: operatingHours,
                delivery,
                province,
                city,
                address,
                landmark:        landmark || null,
                coordinates,
                email,
                license_doc_url: licenseDocUrl,
                cnic_doc_url:    cnicDocUrl,
                status:          'pending'
            }]);
            if (insertError) throw insertError;

            /* Success */
            document.getElementById('success-modal').classList.remove('hidden');

        } catch (err) {
            alert('Registration failed: ' + err.message);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Register Pharmacy';
        }
    });

});
