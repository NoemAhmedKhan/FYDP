/* ══════════════════════════════════════════════════════
   PharmacyRegister.js — MediFinder
   ▸ Supabase project : ktzsshlllyjuzphprzso  (single project)
   ▸ Inserts into     : pharmacy_requests
   ▸ Uploads docs to  : Storage bucket "pharmacy-docs"
   ▸ NO auth.signUp() at this stage — account is created
     by the admin Edge Function on approval.
   ══════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

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
            const ind = document.getElementById(`step-ind-${i}`);
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
        if (field)   { field.classList.remove('is-invalid', 'is-valid'); }
        if (errSpan) errSpan.textContent = '';
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
     'email'].forEach(id => {
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

        if (!cnic) {
            showError('cnic', 'CNIC is required.');
            valid = false;
        } else if (!/^\d{5}-\d{7}-\d{1}$/.test(cnic)) {
            showError('cnic', 'CNIC format must be XXXXX-XXXXXXX-X (e.g. 42101-1234567-1).');
            valid = false;
        }

        if (!pharmType) { showError('pharmacy-type',   'Please select pharmacy type.'); valid = false; }
        if (!opHours)   { showError('operating-hours', 'Please select operating hours.'); valid = false; }

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
            const helper = document.getElementById('coord-helper');
            helper.textContent = 'GPS Coordinates are required. Click "Detect My Location" or enter manually.';
            helper.style.color = 'var(--color-error)';
            valid = false;
        }

        return valid;
    }


    /* ─────────────────────────────────────────
       STEP 3 VALIDATION — Account & Docs
    ───────────────────────────────────────── */
    function validateStep3() {
        clearAllErrors();
        let valid = true;

        const email   = document.getElementById('email').value.trim();
        const terms   = document.getElementById('terms').checked;
        const allFiles = document.getElementById('all-docs').files;

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email) {
            showError('email', 'Email address is required.');
            valid = false;
        } else if (!emailRegex.test(email)) {
            showError('email', 'Enter a valid email address (e.g. name@example.com).');
            valid = false;
        }

        // At least 2 files required: license + CNIC
        if (!allFiles || allFiles.length < 2) {
            showError('all-docs', 'Please upload at least your Drug License and CNIC documents (minimum 2 files).');
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
        const controlKeys = ['Backspace','Delete','Tab','Escape','ArrowLeft','ArrowRight','Home','End'];
        if (controlKeys.includes(e.key)) return;
        if (/^[0-9]$/.test(e.key)) return;
        if (e.key === '+' && this.selectionStart === 0 && !this.value.includes('+')) return;
        e.preventDefault();
    });

    phoneInput.addEventListener('input', function () {
        let val = this.value.replace(/[^0-9+]/g, '');
        if (val.indexOf('+') > 0) val = val.replace(/\+/g, '');
        if (val.startsWith('+92')) {
            if (val.length > 13) val = val.slice(0, 13);
        } else if (val.startsWith('0')) {
            if (val.length > 11) val = val.slice(0, 11);
        }
        this.value = val;
        clearError('phone');
    });

    /* CNIC auto-format */
    const cnicInput = document.getElementById('cnic');
    cnicInput.addEventListener('input', function () {
        let v = this.value.replace(/[^0-9]/g, '');
        if (v.length > 13) v = v.slice(0, 13);
        let formatted = v;
        if (v.length > 5)  formatted = v.slice(0, 5)  + '-' + v.slice(5);
        if (v.length > 12) formatted = v.slice(0, 5)  + '-' + v.slice(5, 12) + '-' + v.slice(12);
        this.value = formatted;
    });


    /* ─────────────────────────────────────────
       OPERATING HOURS — Custom toggle
    ───────────────────────────────────────── */
    const opHoursSelect  = document.getElementById('operating-hours');
    const customHoursRow = document.getElementById('custom-hours-row');

    opHoursSelect.addEventListener('change', function () {
        customHoursRow.classList.toggle('hidden', this.value !== 'custom');
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
                coordInput.value      = `${lat}, ${lng}`;
                coordHelper.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--color-forest-green)"></i> Location detected successfully.';
                coordHelper.style.color = 'var(--color-forest-green)';
                coordInput.classList.remove('is-invalid');
                btnLocate.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
                btnLocate.disabled  = false;
            },
            () => {
                coordHelper.textContent = 'Could not detect location. Please enter coordinates manually.';
                coordHelper.style.color = 'var(--color-error)';
                coordInput.placeholder  = 'e.g. 24.8607, 67.0011';
                btnLocate.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Detect My Location';
                btnLocate.disabled  = false;
            }
        );
    });

    coordInput.addEventListener('input', function () {
        if (this.value.trim()) {
            this.classList.remove('is-invalid');
            coordHelper.innerHTML   = '<i class="fa-solid fa-circle-info"></i> Used to show your pharmacy on the map for nearby patients.';
            coordHelper.style.color = '#888';
        }
    });


    /* ─────────────────────────────────────────
       FILE UPLOAD — Unified single upload area
    ───────────────────────────────────────── */
    const allDocsInput = document.getElementById('all-docs');
    const allDocsArea  = document.getElementById('upload-all-docs');
    const allDocsNames = document.getElementById('all-docs-file-names');
    const MAX_FILE_MB  = 5;

    function handleAllDocs(files) {
        const arr   = Array.from(files);
        const valid = arr.filter(f => f.size <= MAX_FILE_MB * 1024 * 1024);
        const over  = arr.filter(f => f.size >  MAX_FILE_MB * 1024 * 1024);
        const errEl = document.getElementById('err-all-docs');

        if (over.length > 0) {
            errEl.textContent = `${over.length} file(s) exceed ${MAX_FILE_MB} MB and were skipped: ${over.map(f => f.name).join(', ')}`;
        } else {
            errEl.textContent = '';
        }

        if (valid.length > 0) {
            allDocsNames.innerHTML = valid.map(f => `<span class="file-tag">✓ ${f.name}</span>`).join('');
            allDocsArea.classList.add('has-file');
            // rebuild file list without oversized files
            if (over.length > 0) {
                const dt = new DataTransfer();
                valid.forEach(f => dt.items.add(f));
                allDocsInput.files = dt.files;
            }
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
       PROGRESS BAR HELPER
    ───────────────────────────────────────── */
    function showProgressBar(show, pct = 0, msg = '') {
        let bar = document.getElementById('upload-progress-wrap');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'upload-progress-wrap';
            bar.style.cssText = 'margin:12px 0;';
            bar.innerHTML = `
                <div id="upload-progress-msg" style="font-size:13px;color:#555;margin-bottom:6px;"></div>
                <div style="background:#e5e5e5;border-radius:6px;height:8px;overflow:hidden;">
                    <div id="upload-progress-fill" style="height:100%;background:var(--color-forest-green,#208B3A);width:0%;transition:width 0.3s;border-radius:6px;"></div>
                </div>`;
            const docsGroup = document.getElementById('upload-all-docs').parentElement;
            docsGroup.appendChild(bar);
        }
        bar.style.display = show ? 'block' : 'none';
        document.getElementById('upload-progress-fill').style.width = `${pct}%`;
        document.getElementById('upload-progress-msg').textContent  = msg;
    }


    /* ─────────────────────────────────────────
       FORM SUBMISSION → SUPABASE
    ───────────────────────────────────────── */
    document.getElementById('pharmacy-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!validateStep3()) return;

        // Collect all field values
        const pharmacyName  = document.getElementById('pharmacy-name').value.trim();
        const ownerName     = document.getElementById('owner-name').value.trim();
        const phone         = document.getElementById('phone').value.trim();
        const licenseNo     = document.getElementById('license-no').value.trim();
        const regNo         = document.getElementById('reg-no').value.trim();
        const cnic          = document.getElementById('cnic').value.trim();
        const pharmacyType  = document.getElementById('pharmacy-type').value;
        const opHoursVal    = document.getElementById('operating-hours').value;
        const delivery      = document.querySelector('input[name="delivery"]:checked').value === 'yes';
        const province      = document.getElementById('province').value;
        const city          = document.getElementById('city').value;
        const address       = document.getElementById('address').value.trim();
        const landmark      = document.getElementById('landmark').value.trim();
        const coordinates   = document.getElementById('coordinates').value.trim();
        const email         = document.getElementById('email').value.trim();

        let operatingHours = opHoursVal;
        if (opHoursVal === 'custom') {
            const open  = document.getElementById('custom-open').value;
            const close = document.getElementById('custom-close').value;
            operatingHours = `Custom: ${open} – ${close}`;
        }

        const submitBtn = document.getElementById('btn-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

        try {
            /* ── STEP 1: Upload documents to Storage ── */
            const allFiles = Array.from(document.getElementById('all-docs').files);

            // One stable folder per submission — used as the single reference saved in DB
            // Layout: pharmacy-docs bucket → docs/{folderUUID}/doc_0_filename.ext
            const folderUUID    = crypto.randomUUID();
            const docFolderPath = `docs/${folderUUID}`;

            showProgressBar(true, 5, 'Uploading documents…');

            for (let i = 0; i < allFiles.length; i++) {
                const f        = allFiles[i];
                const ext      = f.name.split('.').pop().toLowerCase();
                // Keep original filename prefix so admin can identify doc type at a glance
                const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                const fp       = `${docFolderPath}/doc_${i}_${safeName}`;

                const { error: uploadErr } = await supabaseClient.storage
                    .from('pharmacy-docs')
                    .upload(fp, f, { upsert: true, cacheControl: '3600' });

                if (uploadErr) {
                    console.warn(`Upload failed for ${f.name}:`, uploadErr.message);
                    // Don't block submission for one failed file, but warn user
                }

                const pct = Math.round(((i + 1) / allFiles.length) * 80);
                showProgressBar(true, pct, `Uploading ${i + 1} of ${allFiles.length} files…`);
            }

            showProgressBar(true, 90, 'Saving registration…');

            /* ── STEP 2: Insert into pharmacy_requests ── */
            // Column names match the new normalized schema exactly
            const { error: insertErr } = await supabaseClient.from('pharmacy_requests').insert([{
                pharmacy_name:   pharmacyName,
                drug_license_no: licenseNo,       // renamed from license_no
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
                doc_folder_path: docFolderPath,
                // Owner / profile fields (stored here for admin review)
                full_name:       ownerName,        // renamed from owner_name
                phone_no:        phone,            // renamed from phone
                email,
                status:          'pending'
            }]);

            if (insertErr) throw insertErr;

            showProgressBar(true, 100, 'Done!');
            setTimeout(() => showProgressBar(false), 800);

            /* ── Success ── */
            document.getElementById('success-modal').classList.remove('hidden');

        } catch (err) {
            showProgressBar(false);
            console.error('Registration error:', err);
            showFormError(err.message);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Register Pharmacy';
        }
    });

    function showFormError(msg) {
        let errDiv = document.getElementById('form-global-error');
        if (!errDiv) {
            errDiv = document.createElement('div');
            errDiv.id = 'form-global-error';
            errDiv.style.cssText = `
                background:#fef2f2;border:1px solid #fecaca;color:#dc2626;
                padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:12px;
                display:flex;align-items:center;gap:8px;`;
            const btnRow = document.querySelector('#step-3 .btn-row');
            btnRow.parentElement.insertBefore(errDiv, btnRow);
        }
        errDiv.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Registration failed: ${msg}`;
        errDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

});
