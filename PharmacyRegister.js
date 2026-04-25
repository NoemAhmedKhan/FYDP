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
        const licFile  = document.getElementById('license-doc').files[0];
        const cnicFile = document.getElementById('cnic-doc').files[0];

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

        if (!licFile) {
            showError('license-doc', 'Drug License document is required.');
            valid = false;
        }
        if (!cnicFile) {
            showError('cnic-doc', 'CNIC document is required.');
            valid = false;
        }

        if (!terms) {
            document.getElementById('err-terms').textContent = 'You must agree to the Terms & Privacy Policy before submitting.';
            valid = false;
        }

        return valid;
    }


    /* ─────────────────────────────────────────
       CNIC AUTO-FORMAT (XXXXX-XXXXXXX-X)
    ───────────────────────────────────────── */
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
       FILE UPLOAD — Shared helper
    ───────────────────────────────────────── */
    function setupUpload(areaId, inputId, nameId, errId) {
        const area     = document.getElementById(areaId);
        const input    = document.getElementById(inputId);
        const nameSpan = document.getElementById(nameId);
        if (!area || !input || !nameSpan) return;

        function handleFile(file) {
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) {
                if (errId) document.getElementById(errId).textContent = 'File exceeds 5 MB limit.';
                input.value = '';
                nameSpan.textContent = '';
                area.classList.remove('has-file');
                return;
            }
            nameSpan.textContent = `✓ ${file.name}`;
            area.classList.add('has-file');
            if (errId) document.getElementById(errId).textContent = '';
        }

        input.addEventListener('change', function () {
            if (this.files && this.files[0]) handleFile(this.files[0]);
        });

        area.addEventListener('dragover',  (e) => { e.preventDefault(); area.style.borderColor = 'var(--color-forest-green)'; });
        area.addEventListener('dragleave', ()  => { area.style.borderColor = ''; });
        area.addEventListener('drop',      (e) => {
            e.preventDefault();
            area.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file) {
                // Reassign files to input via DataTransfer
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                handleFile(file);
            }
        });
    }

    setupUpload('upload-license',  'license-doc', 'license-file-name', 'err-license-doc');
    setupUpload('upload-cnic-doc', 'cnic-doc',    'cnic-file-name',    'err-cnic-doc');

    // Multi-file extra docs
    const extraInput  = document.getElementById('extra-docs');
    const extraArea   = document.getElementById('upload-extra');
    const extraNames  = document.getElementById('extra-file-names');
    if (extraInput && extraArea && extraNames) {
        extraInput.addEventListener('change', function () {
            const files = Array.from(this.files);
            const valid = files.filter(f => f.size <= 5 * 1024 * 1024);
            if (valid.length < files.length) alert('Some files exceed 5 MB and were skipped.');
            if (valid.length > 0) {
                extraNames.textContent = valid.map(f => `✓ ${f.name}`).join('  ');
                extraArea.classList.add('has-file');
            }
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

            /* STEP 2: Upload License doc */
            let licenseDocUrl = null;
            const licenseFile = document.getElementById('license-doc').files[0];
            if (licenseFile && authData.user) {
                const ext      = licenseFile.name.split('.').pop();
                const filePath = `licenses/${authData.user.id}/license.${ext}`;
                const { error: uploadError } = await supabaseClient.storage
                    .from('pharmacy-docs').upload(filePath, licenseFile, { upsert: true });
                if (!uploadError) {
                    const { data: urlData } = supabaseClient.storage.from('pharmacy-docs').getPublicUrl(filePath);
                    licenseDocUrl = urlData?.publicUrl || null;
                } else {
                    console.warn('License upload failed:', uploadError.message);
                }
            }

            /* STEP 3: Upload CNIC doc */
            let cnicDocUrl = null;
            const cnicFile = document.getElementById('cnic-doc').files[0];
            if (cnicFile && authData.user) {
                const ext      = cnicFile.name.split('.').pop();
                const filePath = `cnics/${authData.user.id}/cnic.${ext}`;
                const { error: uploadError } = await supabaseClient.storage
                    .from('pharmacy-docs').upload(filePath, cnicFile, { upsert: true });
                if (!uploadError) {
                    const { data: urlData } = supabaseClient.storage.from('pharmacy-docs').getPublicUrl(filePath);
                    cnicDocUrl = urlData?.publicUrl || null;
                } else {
                    console.warn('CNIC upload failed:', uploadError.message);
                }
            }

            /* STEP 4: Insert pharmacy record */
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
