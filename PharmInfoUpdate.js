'use strict';
/* ============================================================
   PharmInfoUpdate.js  —  v6
   All fixes applied:
   1.  Profile verification section removed
   2.  Avatar card at top (same UI/behavior as UserProfile)
   3.  Pharmacist name shown beside avatar
   4.  Image: local preview only → upload on "Save Profile Updates"
   5.  Emergency contact field removed
   6.  Logo green border removed (CSS)
   7.  Sidebar shows email instead of "Pharmacist"
   8.  Logout button (red on hover → signup.html)
   9.  operating_hours column bug fixed → uses hours_json column
   10. Clean, consistent UI with UserProfile patterns
   ============================================================ */

/* ─────────────────────────────────────────
   1. SUPABASE CLIENT
   ───────────────────────────────────────── */
const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';

/* Bucket name — same pharmacy bucket already configured in project */
const PHARMACY_BUCKET = 'pharmacy-profile-photos';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─────────────────────────────────────────
   2. STATE
   ───────────────────────────────────────── */
let _currentUser      = null;
let _pendingAvatarFile = null;   // file chosen but NOT yet uploaded
let _currentAvatarUrl  = null;   // currently saved URL in DB
let _currentInitials   = '?';

/* ─────────────────────────────────────────
   3. DOM HELPERS
   ───────────────────────────────────────── */
const $       = id  => document.getElementById(id);
const val     = id  => $(id)?.value.trim() ?? '';
const setVal  = (id, v) => { const el = $(id); if (el) el.value       = v ?? ''; };
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v ?? ''; };

function getInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  const f = parts[0]?.[0] || '';
  const l = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (f + l).toUpperCase() || '?';
}

/* ─────────────────────────────────────────
   4. TOAST
   ───────────────────────────────────────── */
let _toastTimer = null;

function showToast(message, type) {
  const toast = $('toast');
  if (!toast) return;
  if (_toastTimer) clearTimeout(_toastTimer);

  const icons = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error:   '<i class="fa-solid fa-circle-xmark"></i>',
    info:    '<i class="fa-solid fa-circle-info"></i>'
  };

  toast.className = 'toast toast--' + (type || 'info');
  toast.innerHTML = (icons[type] || icons.info) + ' ' + message;
  void toast.offsetWidth;
  toast.classList.add('show');
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

/* ─────────────────────────────────────────
   5. AVATAR RENDERING
   ───────────────────────────────────────── */
function renderAvatar(containerId, imageUrl, initialsText) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';

  if (imageUrl) {
    const img     = document.createElement('img');
    img.alt       = 'Profile Photo';
    img.className = 'avatar-photo';

    img.onerror = () => {
      container.innerHTML = '';
      const span       = document.createElement('span');
      span.className   = 'avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    };

    img.src = imageUrl;
    container.appendChild(img);
  } else {
    const span       = document.createElement('span');
    span.className   = 'avatar-initials-text';
    span.textContent = initialsText || '?';
    container.appendChild(span);
  }
}

/* Render into sidebar circle — uses its own class names */
function renderSidebarAvatar(imageUrl, initialsText) {
  const container = $('sidebarAvatarInner');
  if (!container) return;
  container.innerHTML = '';

  if (imageUrl) {
    const img     = document.createElement('img');
    img.alt       = 'Avatar';

    img.onerror = () => {
      container.innerHTML = '';
      const span       = document.createElement('span');
      span.className   = 's-avatar-initials-text';
      span.textContent = initialsText || '?';
      container.appendChild(span);
    };

    img.src = imageUrl;
    container.appendChild(img);
  } else {
    const span       = document.createElement('span');
    span.className   = 's-avatar-initials-text';
    span.textContent = initialsText || '?';
    container.appendChild(span);
  }
}

/* ─────────────────────────────────────────
   6. AVATAR FILE SELECTION
   ─────────────────────────────────────────
   Local preview only — no upload until Save.
   ───────────────────────────────────────── */
function initAvatarInput() {
  const input      = $('avatarInput');
  const sizeErrEl  = $('avatarSizeError');

  if (!input) return;

  input.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;

    /* 2 MB limit */
    if (file.size > 2 * 1024 * 1024) {
      if (sizeErrEl) {
        sizeErrEl.textContent   = 'Image is too large. Maximum allowed size is 2 MB.';
        sizeErrEl.style.display = 'block';
      }
      showToast('Image must be under 2 MB.', 'error');
      this.value        = '';
      _pendingAvatarFile = null;
      return;
    }

    /* MIME validation */
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'];
    if (!allowed.includes(file.type)) {
      showToast('Only JPG, PNG or SVG images are allowed.', 'error');
      this.value = '';
      _pendingAvatarFile = null;
      return;
    }

    if (sizeErrEl) sizeErrEl.style.display = 'none';
    _pendingAvatarFile = file;

    /* Local blob preview — no DB/storage touch */
    const blobUrl = URL.createObjectURL(file);
    renderAvatar('avatarImgContainer', blobUrl, _currentInitials);
    renderSidebarAvatar(blobUrl, _currentInitials);
  });
}

/* ─────────────────────────────────────────
   7. STORAGE HELPERS
   ───────────────────────────────────────── */

async function uploadAvatar(userId, file) {
  /* Delete all possible old variants first */
  const variants = ['jpg', 'jpeg', 'png', 'svg'].map(e => `${userId}/profile.${e}`);
  await db.storage.from(PHARMACY_BUCKET).remove(variants).catch(() => {});

  const ext      = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const filePath = `${userId}/profile.${ext}`;

  const { error: uploadErr } = await db.storage
    .from(PHARMACY_BUCKET)
    .upload(filePath, file, { upsert: true, contentType: file.type, cacheControl: '3600' });

  if (uploadErr) throw new Error('Photo upload failed: ' + uploadErr.message);

  const { data: urlData } = db.storage.from(PHARMACY_BUCKET).getPublicUrl(filePath);
  return urlData.publicUrl + '?t=' + Date.now();
}

/* ─────────────────────────────────────────
   8. OPERATING HOURS BUILDER
   ─────────────────────────────────────────
   DB column: hours_json  (text, stores JSON)
   NOT operating_hours — that column does not exist.
   ───────────────────────────────────────── */
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const DEFAULT_HOURS = {
  Monday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Tuesday:   { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Wednesday: { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Thursday:  { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Friday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Saturday:  { open: true,  from: '10:00 AM', to: '06:00 PM' },
  Sunday:    { open: false, from: '',          to: ''         }
};

/* "09:00 AM" / "10:00 PM" → "09:00" / "22:00"  (for input value) */
function to24h(timeStr) {
  if (!timeStr) return '';
  // Already in HH:MM format (24h) — return as-is
  if (/^\d{2}:\d{2}$/.test(timeStr)) return timeStr;
  // Convert from 12h AM/PM
  const [time, modifier] = timeStr.trim().split(' ');
  let [hours, minutes]   = time.split(':').map(Number);
  if (modifier === 'AM' && hours === 12) hours = 0;
  if (modifier === 'PM' && hours !== 12) hours += 12;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

/* "09:00" / "22:00" → "09:00 AM" / "10:00 PM"  (for storing in hours_json) */
function to12h(timeStr) {
  if (!timeStr) return '';
  // Already has AM/PM — return as-is
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  let [hours, minutes] = timeStr.split(':').map(Number);
  const modifier = hours >= 12 ? 'PM' : 'AM';
  if (hours === 0)  hours = 12;
  if (hours > 12)   hours -= 12;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ' ' + modifier;
}

function buildHoursUI(savedHours) {
  const container = $('hoursContainer');
  if (!container) return;
  container.innerHTML = '';

  const hours    = savedHours || DEFAULT_HOURS;
  const fragment = document.createDocumentFragment();

  DAY_NAMES.forEach((day, i) => {
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
        '<input id="' + fromId + '" type="time" value="' + to24h(dayData.from) + '"' + (dayData.open ? '' : ' disabled') + '>' +
'<span class="hours-sep" aria-hidden="true">to</span>' +
'<input id="' + toId + '" type="time" value="' + to24h(dayData.to) + '"' + (dayData.open ? '' : ' disabled') + '>' +
      '</div>' +
      '<label class="toggle" aria-label="' + day + ' open">' +
        '<input type="checkbox" id="' + chkId + '"' + (dayData.open ? ' checked' : '') + '>' +
        '<span class="toggle-slider"></span>' +
      '</label>';

    const checkbox   = row.querySelector('input[type="checkbox"]');
    const timeInputs = row.querySelectorAll('.hours-time input');

    checkbox.addEventListener('change', function () {
      timeInputs.forEach(inp => {
        inp.disabled = !checkbox.checked;
        if (!checkbox.checked) inp.value = '';
      });
    });

    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}

function collectHoursFromUI() {
  const result = {};
  document.querySelectorAll('#hoursContainer .hours-row').forEach(row => {
    const day     = row.dataset.day;
    const inputs  = row.querySelectorAll('.hours-time input');
    const checked = row.querySelector('input[type="checkbox"]').checked;
    result[day] = {
  open: checked,
  from: inputs[0] ? to12h(inputs[0].value.trim()) : '',
  to:   inputs[1] ? to12h(inputs[1].value.trim()) : ''
};
  });
  return result;
}

/* ─────────────────────────────────────────
   9. SIDEBAR TOGGLE (mobile)
   ───────────────────────────────────────── */
function initSidebar() {
  const sidebar = $('sidebar');
  const hamBtn  = $('hamBtn');
  const overlay = $('sOverlay');

  if (!sidebar || !hamBtn || !overlay) return;

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    hamBtn.setAttribute('aria-expanded', 'false');
  };

  hamBtn.addEventListener('click', function () {
    const isOpen = sidebar.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
  });

  overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
}

/* ─────────────────────────────────────────
   10. LOAD PROFILE  (READ from Supabase)
   ───────────────────────────────────────── */
async function loadProfile() {
  try {
    const { data: { session } } = await db.auth.getSession();

    if (!session) {
      showToast('Session expired. Please log in again.', 'error');
      hideLoader();
      return;
    }

    _currentUser = session.user;
    const userId = session.user.id;
    const email  = session.user.email;

    /* profiles table */
    const { data: profileData } = await db
      .from('profiles')
      .select('full_name, phone_no, city, profile_img')
      .eq('user_id', userId)
      .single();

    /* pharmacies table — using hours_json (correct column name) */
    const { data: pharmData, error: pharmErr } = await db
      .from('pharmacies')
      .select('pharmacy_name, drug_license_no, reg_no, pharmacy_type, delivery, address, city, province, landmark, coordinates, hours_json')
      .eq('user_id', userId)
      .single();

    if (pharmErr || !pharmData) {
      showToast('Could not load pharmacy data.', 'error');
      return;
    }

    /* ── Sidebar ── */
    setText('sidebarName',  profileData?.full_name || 'Pharmacist');
    setText('sidebarEmail', email || '');

    const initials = getInitials(profileData?.full_name || '');
    _currentInitials  = initials;
    _currentAvatarUrl = profileData?.profile_img || null;
    renderSidebarAvatar(_currentAvatarUrl, initials);

    /* ── Avatar card ── */
    setText('avatarName', profileData?.full_name || 'Pharmacist');
    setText('avatarSub',  email || 'Pharmacist');
    renderAvatar('avatarImgContainer', _currentAvatarUrl, initials);

    /* ── General Information ── */
    setVal('pharmacyName', pharmData.pharmacy_name);
    setVal('licenseNum',   pharmData.drug_license_no);
    setVal('branchId',     pharmData.reg_no);
    setVal('pharmacyType', pharmData.pharmacy_type);

    const deliveryToggle = $('deliveryToggle');
    const deliveryLabel  = $('deliveryLabel');
    if (deliveryToggle) {
      deliveryToggle.checked = !!pharmData.delivery;
      if (deliveryLabel) deliveryLabel.textContent = pharmData.delivery ? 'Yes' : 'No';
      deliveryToggle.addEventListener('change', function () {
        if (deliveryLabel) deliveryLabel.textContent = this.checked ? 'Yes' : 'No';
      });
    }

    /* ── Contact Details ── */
    setVal('officialEmail', email);
    setVal('ownerName',     profileData?.full_name || '');
    setVal('primaryPhone',  profileData?.phone_no  || '');

    /* ── Location Details ── */
    setVal('streetAddress', pharmData.address);
    setVal('city',          pharmData.city);
    setVal('province',      pharmData.province);
    setVal('landmark',      pharmData.landmark || '');
    setVal('gpsCoords',     pharmData.coordinates);

    /* ── Operating Hours — parse from hours_json ── */
    let parsedHours = null;
    if (pharmData.hours_json) {
      try {
        parsedHours = JSON.parse(pharmData.hours_json);
        /* strip _meta if present (legacy) */
        if (parsedHours._meta) {
          const { _meta, ...rest } = parsedHours;
          parsedHours = rest;
        }
      } catch (e) {
        console.warn('[PharmInfoUpdate] hours_json parse warning:', e.message);
      }
    }
    buildHoursUI(parsedHours);

  } catch (err) {
    console.error('[PharmInfoUpdate] loadProfile error:', err);
    showToast('Unexpected error loading profile: ' + err.message, 'error');
  }
}

/* ─────────────────────────────────────────
   11. SAVE PROFILE  (UPDATE to Supabase)
   ─────────────────────────────────────────
   Flow:
   1. If a new avatar file was selected → upload to storage,
      delete old, get public URL.
   2. Update profiles table (name, phone, city, profile_img).
   3. Update pharmacies table — hours saved to hours_json column
      (NOT operating_hours which does not exist in DB schema).
   ───────────────────────────────────────── */
async function saveProfile() {
  const saveBtn = $('saveBtn');

  /* Basic validation */
  const pharmacyName = val('pharmacyName');
  const ownerName    = val('ownerName');
  const primaryPhone = val('primaryPhone');
  const city         = val('city');
  const streetAddr   = val('streetAddress');
  const coordinates = val('gpsCoords');

  if (!pharmacyName) { showToast('Pharmacy name is required.', 'error'); return; }
  if (!ownerName)    { showToast('Owner / Manager name is required.', 'error'); return; }
  if (!primaryPhone) { showToast('Primary phone is required.', 'error'); return; }
  if (!city)         { showToast('City is required.', 'error'); return; }
  if (!streetAddr)   { showToast('Street address is required.', 'error'); return; }
  if (!coordinates)  { showToast('GPS coordinates are required.', 'error'); return; }
  if (!_currentUser) { showToast('Session expired. Please refresh.', 'error'); return; }

  if (saveBtn) {
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
  }

  let hasError = false;

  try {
    const userId = _currentUser.id;

    /* ── Step 1: Upload avatar if a new file was selected ── */
    let newAvatarUrl = null;
    if (_pendingAvatarFile) {
      try {
        newAvatarUrl      = await uploadAvatar(userId, _pendingAvatarFile);
        _pendingAvatarFile = null;
      } catch (err) {
        showToast(err.message, 'error');
        hasError = true;
      }
    }

    /* ── Step 2: Update profiles ── */
    if (!hasError) {
      const profilePayload = {
        full_name:  ownerName,
        phone_no:   primaryPhone,
        city:       city,
      };
      if (newAvatarUrl) profilePayload.profile_img = newAvatarUrl;

const { error: profileErr } = await db
  .from('profiles')
  .update(profilePayload)
  .eq('user_id', userId);

      if (profileErr) {
        showToast('Profile update failed: ' + profileErr.message, 'error');
        hasError = true;
      } else {
        /* Update local state & UI */
        if (newAvatarUrl) {
          _currentAvatarUrl = newAvatarUrl;
          renderAvatar('avatarImgContainer', newAvatarUrl, _currentInitials);
          renderSidebarAvatar(newAvatarUrl, _currentInitials);
        }
        _currentInitials = getInitials(ownerName);
        setText('avatarName',   ownerName);
        setText('sidebarName',  ownerName);
      }
    }

    /* ── Step 3: Update pharmacies — hours_json column ── */
    if (!hasError) {
      const hoursObj  = collectHoursFromUI();
      const hoursJSON = JSON.stringify(hoursObj);

      const deliveryToggle = $('deliveryToggle');

      const { error: pharmErr } = await db
        .from('pharmacies')
        .update({
          pharmacy_name: pharmacyName,
          address:       streetAddr,
          city:          city,
          province:      val('province'),
          landmark:      val('landmark') || null,
          coordinates: coordinates,
          delivery:      deliveryToggle ? deliveryToggle.checked : true,
          hours_json:    hoursJSON,   /* ← correct column, NOT operating_hours */
        })
        .eq('user_id', userId);

      if (pharmErr) {
        showToast('Pharmacy update failed: ' + pharmErr.message, 'error');
        hasError = true;
      }
    }

    if (!hasError) showToast('Profile updated successfully!', 'success');

  } catch (err) {
    console.error('[PharmInfoUpdate] saveProfile error:', err);
    showToast(err.message || 'Failed to save profile.', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled  = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Profile Updates';
    }
  }
}

/* ─────────────────────────────────────────
   12. LOGOUT
   ───────────────────────────────────────── */
function initLogout() {
  const logoutBtn = $('logoutBtn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.href = 'SignUp.html';
  });
}

/* ─────────────────────────────────────────
   13. INIT
   ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initAvatarInput();
  initLogout();

  /* Build default hours skeleton while data loads */
  buildHoursUI(null);

  /* Wire save button */
  const saveBtn = $('saveBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveProfile);

  /* Load real data */
  loadProfile();
});
