'use strict';

/* ============================================================
   PharmInfoUpdate.js
   Pharmacy Profile Update — Supabase Integration
   ============================================================

   SECTIONS
   1.  Supabase Client Setup
   2.  Sidebar Toggle
   3.  Toast Notification Helper
   4.  Operating Hours Builder
   5.  Profile Completion Calculator
   6.  Load Profile Data  (READ from Supabase)
   7.  Save Profile Data  (UPDATE to Supabase)
   8.  Init
   ============================================================ */

/* ─────────────────────────────────────────
   1. SUPABASE CLIENT SETUP
   ───────────────────────────────────────── */
const SUPABASE_URL  = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────
   2. SIDEBAR TOGGLE
   ───────────────────────────────────────── */
(function () {
  const sidebar = document.getElementById('sidebar');
  const hamBtn  = document.getElementById('hamBtn');
  const overlay = document.getElementById('sOverlay');

  function closeSidebar() {
    sidebar.classList.remove('open');
    hamBtn.setAttribute('aria-expanded', 'false');
  }

  hamBtn.addEventListener('click', function () {
    const isOpen = sidebar.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
  });

  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });
}());

/* ─────────────────────────────────────────
   3. TOAST NOTIFICATION HELPER
   ───────────────────────────────────────── */
let _toastTimer = null;

function showToast(message, type) {
  // type: 'success' | 'error' | 'info'
  const toast = document.getElementById('toast');
  if (!toast) return;

  // Clear any running timer
  if (_toastTimer) clearTimeout(_toastTimer);

  const icons = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error:   '<i class="fa-solid fa-circle-xmark"></i>',
    info:    '<i class="fa-solid fa-circle-info"></i>',
  };

  toast.className = 'toast toast--' + (type || 'info');
  toast.innerHTML = (icons[type] || icons.info) + ' ' + message;

  // Force reflow so transition fires even if already visible
  void toast.offsetWidth;
  toast.classList.add('show');

  _toastTimer = setTimeout(function () {
    toast.classList.remove('show');
  }, 4000);
}

/* ─────────────────────────────────────────
   4. OPERATING HOURS BUILDER
   ─────────────────────────────────────────
   Builds the 7-row hours UI.
   Accepts an optional savedHours object:
     { Monday: { open: true, from: '09:00 AM', to: '10:00 PM' }, … }
   ───────────────────────────────────────── */
const DAY_NAMES = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
];

const DEFAULT_HOURS = {
  Monday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Tuesday:   { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Wednesday: { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Thursday:  { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Friday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Saturday:  { open: true,  from: '10:00 AM', to: '06:00 PM' },
  Sunday:    { open: false, from: '',          to: ''          },
};

function buildHoursUI(savedHours) {
  const container = document.getElementById('hoursContainer');
  if (!container) return;
  container.innerHTML = '';

  const hours   = savedHours || DEFAULT_HOURS;
  const fragment = document.createDocumentFragment();

  DAY_NAMES.forEach(function (day, i) {
    const dayData = hours[day] || { open: false, from: '', to: '' };
    const fromId  = 'from-' + i;
    const toId    = 'to-'   + i;
    const chkId   = 'chk-'  + i;

    const row = document.createElement('div');
    row.className = 'hours-row';
    row.setAttribute('role', 'listitem');
    row.dataset.day = day;

    row.innerHTML =
      '<span class="hours-day">' + day + '</span>' +

      '<div class="hours-time">' +
        '<label class="sr-only" for="' + fromId + '">Open time for ' + day + '</label>' +
        '<input id="' + fromId + '" type="text" value="' + (dayData.from || '') + '" placeholder="Closed"' + (dayData.open ? '' : ' disabled') + '>' +
        '<i class="fa-regular fa-clock hours-icon" aria-hidden="true"></i>' +
        '<span class="hours-sep" aria-hidden="true">to</span>' +
        '<label class="sr-only" for="' + toId + '">Close time for ' + day + '</label>' +
        '<input id="' + toId + '" type="text" value="' + (dayData.to || '') + '" placeholder="Closed"' + (dayData.open ? '' : ' disabled') + '>' +
        '<i class="fa-regular fa-clock hours-icon" aria-hidden="true"></i>' +
      '</div>' +

      '<label class="toggle" aria-label="' + day + ' open">' +
        '<input type="checkbox" id="' + chkId + '"' + (dayData.open ? ' checked' : '') + '>' +
        '<span class="toggle-slider"></span>' +
      '</label>';

    const checkbox   = row.querySelector('input[type="checkbox"]');
    const timeInputs = row.querySelectorAll('.hours-time input');

    checkbox.addEventListener('change', function () {
      timeInputs.forEach(function (inp) {
        inp.disabled = !checkbox.checked;
        if (!checkbox.checked) inp.value = '';
      });
    });

    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}

/* Reads current hours UI state → returns plain object */
function collectHoursFromUI() {
  const result = {};
  const rows   = document.querySelectorAll('#hoursContainer .hours-row');

  rows.forEach(function (row) {
    const day     = row.dataset.day;
    const inputs  = row.querySelectorAll('.hours-time input');
    const checked = row.querySelector('input[type="checkbox"]').checked;
    result[day] = {
      open: checked,
      from: inputs[0] ? inputs[0].value.trim() : '',
      to:   inputs[1] ? inputs[1].value.trim() : '',
    };
  });

  return result;
}

/* ─────────────────────────────────────────
   5. PROFILE COMPLETION CALCULATOR
   ───────────────────────────────────────── */
function calcCompletion(pharmacy, profile) {
  const fields = [
    pharmacy.pharmacy_name,
    pharmacy.drug_license_no,
    pharmacy.reg_no,
    pharmacy.address,
    pharmacy.city,
    pharmacy.province,
    pharmacy.coordinates,
    pharmacy.operating_hours,
    profile.full_name,
    profile.phone_no,
  ];

  const filled = fields.filter(function (v) { return v && String(v).trim() !== ''; }).length;
  return Math.round((filled / fields.length) * 100);
}

function updateCompletionUI(pct) {
  const fill   = document.getElementById('progressFill');
  const pctEl  = document.getElementById('verifyPct');
  const subEl  = document.getElementById('verifySubText');
  const bar    = document.getElementById('progressBar');

  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (bar)   bar.setAttribute('aria-valuenow', pct);

  if (subEl) {
    if (pct < 100) {
      subEl.textContent =
        'Your profile is ' + pct + '% complete. Fill in the missing fields to reach 100% and maintain your "Verified Pharmacy" badge on the patient portal.';
    } else {
      subEl.textContent = 'Your profile is 100% complete. You have the "Verified Pharmacy" badge on the patient portal.';
    }
  }
}

/* ─────────────────────────────────────────
   6. LOAD PROFILE DATA  (READ from Supabase)
   ─────────────────────────────────────────
   Flow:
     a) Get current session user
     b) Fetch users row  → email
     c) Fetch profiles row → full_name, phone_no, city
     d) Fetch pharmacies row → all pharmacy fields
     e) Populate the form
   ───────────────────────────────────────── */
async function loadProfile() {
  try {
    /* ── a) Current session ── */
    const { data: { session }, error: sessionErr } = await db.auth.getSession();

    if (sessionErr || !session) {
      showToast('Session expired. Please log in again.', 'error');
      // Optional: redirect to login
      // window.location.href = 'login.html';
      hideLoader();
      return;
    }

    const userId = session.user.id;
    const email  = session.user.email;

    /* ── b) Fetch profile row ── */
    const { data: profileData, error: profileErr } = await db
      .from('profiles')
      .select('full_name, phone_no, city')
      .eq('user_id', userId)
      .single();

    if (profileErr) {
      console.error('Profile fetch error:', profileErr);
    }

    /* ── c) Fetch pharmacy row ── */
    const { data: pharmData, error: pharmErr } = await db
      .from('pharmacies')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (pharmErr) {
      console.error('Pharmacy fetch error:', pharmErr);
      showToast('Could not load pharmacy data: ' + pharmErr.message, 'error');
      hideLoader();
      return;
    }

    /* ── d) Populate General Information ── */
    setValue('pharmacyName', pharmData.pharmacy_name);
    setValue('licenseNum',   pharmData.drug_license_no);
    setValue('branchId',     pharmData.reg_no);
    setValue('pharmacyType', pharmData.pharmacy_type);

    const deliveryToggle = document.getElementById('deliveryToggle');
    const deliveryLabel  = document.getElementById('deliveryLabel');
    if (deliveryToggle) {
      deliveryToggle.checked = !!pharmData.delivery;
      if (deliveryLabel) deliveryLabel.textContent = pharmData.delivery ? 'Yes' : 'No';
      deliveryToggle.addEventListener('change', function () {
        if (deliveryLabel) deliveryLabel.textContent = this.checked ? 'Yes' : 'No';
      });
    }

    /* ── e) Populate Contact Details ── */
    setValue('officialEmail', email);

    if (profileData) {
      setValue('ownerName',    profileData.full_name);
      setValue('primaryPhone', profileData.phone_no);
    }

    /* Emergency phone stored in landmark field with prefix OR
       we use a JSON trick in operating_hours extras.
       Since there's no dedicated column, we store it gracefully
       in a parsed section of operating_hours JSON under "_meta". */
    let parsedHours = null;
    let emergencyPhone = '';

    if (pharmData.operating_hours) {
      try {
        const parsed = JSON.parse(pharmData.operating_hours);
        // Check if it has the _meta section we write on save
        if (parsed._meta) {
          emergencyPhone = parsed._meta.emergency_phone || '';
          // Remaining keys are the actual hours
          const { _meta, ...hoursOnly } = parsed;
          parsedHours = hoursOnly;
        } else {
          parsedHours = parsed;
        }
      } catch (e) {
        // operating_hours may be a plain string from old data
        console.warn('operating_hours is not JSON:', pharmData.operating_hours);
      }
    }

    setValue('emergencyPhone', emergencyPhone);

    /* ── f) Populate Location Details ── */
    setValue('streetAddress', pharmData.address);
    setValue('city',          pharmData.city);
    setValue('province',      pharmData.province);
    setValue('landmark',      pharmData.landmark || '');
    setValue('gpsCoords',     pharmData.coordinates);

    /* ── g) Build Operating Hours UI ── */
    buildHoursUI(parsedHours);

    /* ── h) Update sidebar user name ── */
    const sidebarName = document.getElementById('sidebarName');
    if (sidebarName && profileData && profileData.full_name) {
      sidebarName.textContent = profileData.full_name;
    }

    /* ── i) Profile completion ── */
    const pct = calcCompletion(pharmData, profileData || {});
    updateCompletionUI(pct);

    /* ── j) Reveal content ── */
    hideLoader();
    fadeIn('infoGrid');
    fadeIn('verifyCard');

  } catch (err) {
    console.error('Unexpected error in loadProfile:', err);
    showToast('Unexpected error loading profile.', 'error');
    hideLoader();
  }
}

/* ─────────────────────────────────────────
   7. SAVE PROFILE DATA  (UPDATE to Supabase)
   ─────────────────────────────────────────
   Updates:
     • profiles  → full_name, phone_no, city
     • pharmacies → pharmacy_name, address, city, province,
                    landmark, coordinates, delivery,
                    operating_hours (JSON with _meta)
   email & readonly fields are never written back.
   ───────────────────────────────────────── */
async function saveProfile() {
  const saveBtn = document.getElementById('saveBtn');

  /* ── Validation ── */
  const pharmacyName = getValue('pharmacyName');
  const ownerName    = getValue('ownerName');
  const primaryPhone = getValue('primaryPhone');
  const city         = getValue('city');
  const streetAddr   = getValue('streetAddress');

  if (!pharmacyName) { showToast('Pharmacy name is required.', 'error'); return; }
  if (!ownerName)    { showToast('Owner / Manager name is required.', 'error'); return; }
  if (!primaryPhone) { showToast('Primary phone is required.', 'error'); return; }
  if (!city)         { showToast('City is required.', 'error'); return; }
  if (!streetAddr)   { showToast('Street address is required.', 'error'); return; }

  /* ── Disable button, show spinner ── */
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="loader-spinner" style="width:16px;height:16px;border-width:2px;margin:0 4px;"></span> Saving…';
  }

  try {
    /* ── Get current session ── */
    const { data: { session }, error: sessionErr } = await db.auth.getSession();
    if (sessionErr || !session) {
      showToast('Session expired. Please log in again.', 'error');
      resetSaveBtn(saveBtn);
      return;
    }
    const userId = session.user.id;

    /* ── Collect operating hours + embed emergency phone in _meta ── */
    const hoursObj = collectHoursFromUI();
    hoursObj._meta = {
      emergency_phone: getValue('emergencyPhone'),
    };
    const hoursJSON = JSON.stringify(hoursObj);

    /* ── Update profiles table ── */
    const profilePayload = {
      full_name: ownerName,
      phone_no:  primaryPhone,
      city:      city,
    };

    const { error: profileUpdateErr } = await db
      .from('profiles')
      .update(profilePayload)
      .eq('user_id', userId);

    if (profileUpdateErr) {
      throw new Error('Profile update failed: ' + profileUpdateErr.message);
    }

    /* ── Update pharmacies table ── */
    const pharmacyPayload = {
      pharmacy_name:   pharmacyName,
      address:         streetAddr,
      city:            city,
      province:        getValue('province'),
      landmark:        getValue('landmark') || null,
      coordinates:     getValue('gpsCoords'),
      delivery:        document.getElementById('deliveryToggle')
                         ? document.getElementById('deliveryToggle').checked
                         : true,
      operating_hours: hoursJSON,
    };

    const { error: pharmUpdateErr } = await db
      .from('pharmacies')
      .update(pharmacyPayload)
      .eq('user_id', userId);

    if (pharmUpdateErr) {
      throw new Error('Pharmacy update failed: ' + pharmUpdateErr.message);
    }

    /* ── Recalculate completion ── */
    const { data: freshPharm } = await db
      .from('pharmacies')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: freshProfile } = await db
      .from('profiles')
      .select('full_name, phone_no, city')
      .eq('user_id', userId)
      .single();

    if (freshPharm && freshProfile) {
      updateCompletionUI(calcCompletion(freshPharm, freshProfile));
    }

    /* ── Update sidebar name live ── */
    const sidebarName = document.getElementById('sidebarName');
    if (sidebarName) sidebarName.textContent = ownerName;

    showToast('Profile updated successfully!', 'success');

  } catch (err) {
    console.error('Save error:', err);
    showToast(err.message || 'Failed to save profile. Please try again.', 'error');
  } finally {
    resetSaveBtn(saveBtn);
  }
}

/* ─────────────────────────────────────────
   8. HELPERS
   ───────────────────────────────────────── */
function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value != null ? value : '';
}

function hideLoader() {
  const loader = document.getElementById('pageLoader');
  if (loader) loader.classList.add('hidden');
}

function fadeIn(id) {
  const el = document.getElementById(id);
  if (el) el.style.opacity = '1';
}

function resetSaveBtn(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-floppy-disk btn-icon"></i> Save Profile Updates';
}

/* ─────────────────────────────────────────
   9. INIT
   ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  // Build default hours skeleton immediately so the UI isn't empty
  buildHoursUI(null);
  // Then load real data from Supabase (overwrites skeleton)
  loadProfile();
});

// Expose saveProfile globally for the onclick in HTML
window.saveProfile = saveProfile;
