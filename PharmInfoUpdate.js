'use strict';
/* ============================================================
   PharmInfoUpdate.js  —  v5 clean rewrite
   Pharmacy Profile Update + Photo Upload
   Supabase: profiles, pharmacies, storage (avatars bucket)
   ============================================================

   SECTIONS
   1.  Supabase Client
   2.  Sidebar Toggle
   3.  Toast Helper
   4.  Operating Hours Builder
   5.  Profile Completion Calculator
   6.  Sidebar Avatar Helper
   7.  Photo Preview Helpers
   8.  Load Profile  (READ)
   9.  Save Profile  (UPDATE)
   10. Photo Upload
   11. Photo Remove
   12. Init (single DOMContentLoaded)
   ============================================================ */

/* ─────────────────────────────────────────
   1. SUPABASE CLIENT
   ───────────────────────────────────────── */
const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
const PHARMACY_PROFILE_BUCKET = 'pharmacy-profile-photos';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let _selectedFile = null;

/* ─────────────────────────────────────────
   2. SIDEBAR TOGGLE
   ───────────────────────────────────────── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const hamBtn  = document.getElementById('hamBtn');
  const overlay = document.getElementById('sOverlay');

  if (!sidebar || !hamBtn || !overlay) return;

  function closeSidebar() {
    sidebar.classList.remove('open');
    hamBtn.setAttribute('aria-expanded', 'false');
  }

  hamBtn.addEventListener('click', function () {
    var isOpen = sidebar.classList.toggle('open');
    this.setAttribute('aria-expanded', String(isOpen));
  });

  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });
}

/* ─────────────────────────────────────────
   3. TOAST HELPER
   ───────────────────────────────────────── */
var _toastTimer = null;

function showToast(message, type) {
  var toast = document.getElementById('toast');
  if (!toast) return;

  if (_toastTimer) clearTimeout(_toastTimer);

  var icons = {
    success: '<i class="fa-solid fa-circle-check"></i>',
    error:   '<i class="fa-solid fa-circle-xmark"></i>',
    info:    '<i class="fa-solid fa-circle-info"></i>'
  };

  toast.className = 'toast toast--' + (type || 'info');
  toast.innerHTML = (icons[type] || icons.info) + ' ' + message;
  void toast.offsetWidth;
  toast.classList.add('show');

  _toastTimer = setTimeout(function () {
    toast.classList.remove('show');
  }, 4000);
}

/* ─────────────────────────────────────────
   4. OPERATING HOURS BUILDER
   ───────────────────────────────────────── */
var DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

var DEFAULT_HOURS = {
  Monday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Tuesday:   { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Wednesday: { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Thursday:  { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Friday:    { open: true,  from: '09:00 AM', to: '10:00 PM' },
  Saturday:  { open: true,  from: '10:00 AM', to: '06:00 PM' },
  Sunday:    { open: false, from: '',          to: ''         }
};

function buildHoursUI(savedHours) {
  var container = document.getElementById('hoursContainer');
  if (!container) return;
  container.innerHTML = '';

  var hours    = savedHours || DEFAULT_HOURS;
  var fragment = document.createDocumentFragment();

  DAY_NAMES.forEach(function (day, i) {
    var dayData = hours[day] || { open: false, from: '', to: '' };
    var fromId  = 'from-' + i;
    var toId    = 'to-'   + i;
    var chkId   = 'chk-'  + i;

    var row = document.createElement('div');
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

    var checkbox   = row.querySelector('input[type="checkbox"]');
    var timeInputs = row.querySelectorAll('.hours-time input');

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

function collectHoursFromUI() {
  var result = {};
  var rows   = document.querySelectorAll('#hoursContainer .hours-row');

  rows.forEach(function (row) {
    var day     = row.dataset.day;
    var inputs  = row.querySelectorAll('.hours-time input');
    var checked = row.querySelector('input[type="checkbox"]').checked;
    result[day] = {
      open: checked,
      from: inputs[0] ? inputs[0].value.trim() : '',
      to:   inputs[1] ? inputs[1].value.trim() : ''
    };
  });

  return result;
}

/* ─────────────────────────────────────────
   5. PROFILE COMPLETION CALCULATOR
   ───────────────────────────────────────── */
function calcCompletion(pharmacy, profile) {
  var fields = [
    pharmacy.pharmacy_name,
    pharmacy.drug_license_no,
    pharmacy.reg_no,
    pharmacy.address,
    pharmacy.city,
    pharmacy.province,
    pharmacy.coordinates,
    pharmacy.operating_hours,
    profile.full_name,
    profile.phone_no
  ];

  var filled = fields.filter(function (v) {
    return v && String(v).trim() !== '';
  }).length;

  return Math.round((filled / fields.length) * 100);
}

function updateCompletionUI(pct) {
  var fill  = document.getElementById('progressFill');
  var pctEl = document.getElementById('verifyPct');
  var subEl = document.getElementById('verifySubText');
  var bar   = document.getElementById('progressBar');

  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (bar)   bar.setAttribute('aria-valuenow', pct);

  if (subEl) {
    subEl.textContent = pct < 100
      ? 'Your profile is ' + pct + '% complete. Fill in the missing fields to reach 100% and maintain your "Verified Pharmacy" badge on the patient portal.'
      : 'Your profile is 100% complete. You have the "Verified Pharmacy" badge on the patient portal.';
  }
}

/* ─────────────────────────────────────────
   6. SIDEBAR AVATAR HELPER
   ───────────────────────────────────────── */
function setSidebarAvatar(photoUrl, fullName) {
  var avatarImg      = document.getElementById('sidebarAvatar');
  var avatarInitials = document.getElementById('sidebarInitials');

  if (photoUrl && avatarImg) {
    avatarImg.src           = photoUrl;
    avatarImg.style.display = 'block';
    if (avatarInitials) avatarInitials.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (avatarInitials && fullName) {
      var parts    = fullName.trim().split(' ');
      var initials = parts.length >= 2
        ? parts[0][0] + parts[parts.length - 1][0]
        : parts[0].slice(0, 2);
      avatarInitials.textContent   = initials.toUpperCase();
      avatarInitials.style.display = 'flex';
    }
  }
}

/* ─────────────────────────────────────────
   7. PHOTO PREVIEW HELPERS
   ───────────────────────────────────────── */
function setPhotoPreview(src) {
  var img         = document.getElementById('photoPreviewImg');
  var placeholder = document.getElementById('photoPlaceholder');
  if (img) {
    img.src           = src;
    img.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';
}

function clearPhotoPreview() {
  var img         = document.getElementById('photoPreviewImg');
  var placeholder = document.getElementById('photoPlaceholder');
  if (img) { img.src = ''; img.style.display = 'none'; }
  if (placeholder) placeholder.style.display = 'flex';
}

/* ─────────────────────────────────────────
   8. LOAD PROFILE  (READ from Supabase)
   ───────────────────────────────────────── */
async function loadProfile() {
  try {
    var sessionResult = await db.auth.getSession();
    var session = sessionResult.data.session;

    if (!session) {
      showToast('Session expired. Please log in again.', 'error');
      hideLoader();
      return;
    }

    var userId = session.user.id;
    var email  = session.user.email;

    var profileResult = await db
      .from('profiles')
      .select('full_name, phone_no, city, profile_img')
      .eq('user_id', userId)
      .single();

    var profileData = profileResult.data;

    var pharmResult = await db
      .from('pharmacies')
      .select('*')
      .eq('user_id', userId)
      .single();

    var pharmData = pharmResult.data;

    if (pharmResult.error || !pharmData) {
      showToast('Could not load pharmacy data.', 'error');
      hideLoader();
      return;
    }

    /* General Information */
    setValue('pharmacyName', pharmData.pharmacy_name);
    setValue('licenseNum',   pharmData.drug_license_no);
    setValue('branchId',     pharmData.reg_no);
    setValue('pharmacyType', pharmData.pharmacy_type);

    var deliveryToggle = document.getElementById('deliveryToggle');
    var deliveryLabel  = document.getElementById('deliveryLabel');
    if (deliveryToggle) {
      deliveryToggle.checked = !!pharmData.delivery;
      if (deliveryLabel) deliveryLabel.textContent = pharmData.delivery ? 'Yes' : 'No';
      deliveryToggle.addEventListener('change', function () {
        if (deliveryLabel) deliveryLabel.textContent = this.checked ? 'Yes' : 'No';
      });
    }

    /* Contact Details */
    setValue('officialEmail', email);
    if (profileData) {
      setValue('ownerName',    profileData.full_name);
      setValue('primaryPhone', profileData.phone_no);
    }

    /* Parse operating hours + extract emergency phone from _meta */
    var parsedHours    = null;
    var emergencyPhone = '';

    if (pharmData.operating_hours) {
      try {
        var parsed = JSON.parse(pharmData.operating_hours);
        if (parsed._meta) {
          emergencyPhone = parsed._meta.emergency_phone || '';
          var hoursOnly  = {};
          Object.keys(parsed).forEach(function (k) {
            if (k !== '_meta') hoursOnly[k] = parsed[k];
          });
          parsedHours = hoursOnly;
        } else {
          parsedHours = parsed;
        }
      } catch (e) {
        console.warn('operating_hours is not JSON:', pharmData.operating_hours);
      }
    }

    setValue('emergencyPhone', emergencyPhone);

    /* Location Details */
    setValue('streetAddress', pharmData.address);
    setValue('city',          pharmData.city);
    setValue('province',      pharmData.province);
    setValue('landmark',      pharmData.landmark || '');
    setValue('gpsCoords',     pharmData.coordinates);

    /* Operating Hours UI */
    buildHoursUI(parsedHours);

    /* Sidebar name + avatar */
    var sidebarName = document.getElementById('sidebarName');
    if (sidebarName && profileData && profileData.full_name) {
      sidebarName.textContent = profileData.full_name;
    }

    if (profileData && profileData.profile_img) {
      setSidebarAvatar(profileData.profile_img, profileData.full_name);
      setPhotoPreview(profileData.profile_img);
      var removeBtn = document.getElementById('removePhotoBtn');
      if (removeBtn) removeBtn.style.display = 'inline-flex';
    } else if (profileData && profileData.full_name) {
      setSidebarAvatar(null, profileData.full_name);
    }

    /* Profile completion */
    var pct = calcCompletion(pharmData, profileData || {});
    updateCompletionUI(pct);

    /* Reveal content */
    hideLoader();
    fadeIn('infoGrid');
    fadeIn('verifyCard');
    fadeIn('photoCard');

  } catch (err) {
    console.error('Unexpected error in loadProfile:', err);
    showToast('Unexpected error loading profile: ' + err.message, 'error');
    hideLoader();
  }
}

/* ─────────────────────────────────────────
   9. SAVE PROFILE  (UPDATE to Supabase)
   ───────────────────────────────────────── */
async function saveProfile() {
  var saveBtn = document.getElementById('saveBtn');

  var pharmacyName = getValue('pharmacyName');
  var ownerName    = getValue('ownerName');
  var primaryPhone = getValue('primaryPhone');
  var city         = getValue('city');
  var streetAddr   = getValue('streetAddress');

  if (!pharmacyName) { showToast('Pharmacy name is required.', 'error'); return; }
  if (!ownerName)    { showToast('Owner / Manager name is required.', 'error'); return; }
  if (!primaryPhone) { showToast('Primary phone is required.', 'error'); return; }
  if (!city)         { showToast('City is required.', 'error'); return; }
  if (!streetAddr)   { showToast('Street address is required.', 'error'); return; }

  if (saveBtn) {
    saveBtn.disabled  = true;
    saveBtn.innerHTML = '<span class="loader-spinner" style="width:16px;height:16px;border-width:2px;margin:0 4px;display:inline-block;"></span> Saving…';
  }

  try {
    var sessionResult = await db.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) {
      showToast('Session expired. Please log in again.', 'error');
      resetSaveBtn(saveBtn);
      return;
    }
    var userId = session.user.id;

    /* Collect hours + embed emergency phone */
    var hoursObj = collectHoursFromUI();
    hoursObj._meta = { emergency_phone: getValue('emergencyPhone') };
    var hoursJSON = JSON.stringify(hoursObj);

    /* Update profiles */
    var profileUpdate = await db
      .from('profiles')
      .update({ full_name: ownerName, phone_no: primaryPhone, city: city })
      .eq('user_id', userId);

    if (profileUpdate.error) throw new Error('Profile update failed: ' + profileUpdate.error.message);

    /* Update pharmacies */
    var deliveryToggle = document.getElementById('deliveryToggle');
    var pharmUpdate = await db
      .from('pharmacies')
      .update({
        pharmacy_name:   pharmacyName,
        address:         streetAddr,
        city:            city,
        province:        getValue('province'),
        landmark:        getValue('landmark') || null,
        coordinates:     getValue('gpsCoords'),
        delivery:        deliveryToggle ? deliveryToggle.checked : true,
        operating_hours: hoursJSON
      })
      .eq('user_id', userId);

    if (pharmUpdate.error) throw new Error('Pharmacy update failed: ' + pharmUpdate.error.message);

    /* Refresh completion */
    var freshPharmResult   = await db.from('pharmacies').select('*').eq('user_id', userId).single();
    var freshProfileResult = await db.from('profiles').select('full_name, phone_no, city').eq('user_id', userId).single();

    if (freshPharmResult.data && freshProfileResult.data) {
      updateCompletionUI(calcCompletion(freshPharmResult.data, freshProfileResult.data));
    }

    var sidebarName = document.getElementById('sidebarName');
    if (sidebarName) sidebarName.textContent = ownerName;

    showToast('Profile updated successfully!', 'success');

  } catch (err) {
    console.error('Save error:', err);
    showToast(err.message || 'Failed to save profile.', 'error');
  } finally {
    resetSaveBtn(saveBtn);
  }
}

/* ─────────────────────────────────────────
   10. PHOTO UPLOAD
   ───────────────────────────────────────── */
async function uploadPhoto() {
  if (!_selectedFile) {
    showToast('Please choose a photo first.', 'info');
    return;
  }

  var uploadBtn = document.getElementById('uploadPhotoBtn');
  if (uploadBtn) {
    uploadBtn.disabled  = true;
    uploadBtn.innerHTML = '<span class="loader-spinner" style="width:14px;height:14px;border-width:2px;margin:0 4px;display:inline-block;"></span> Uploading…';
  }

  try {
    var sessionResult = await db.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) { showToast('Session expired. Please log in again.', 'error'); return; }
    var userId = session.user.id;

    /* Delete old variants first to keep storage clean */
    await db.storage.from(PHARMACY_PROFILE_BUCKET).remove([
      userId + '/profile.jpg',
      userId + '/profile.png',
      userId + '/profile.webp'
    ]);

    /* Upload new file */
    var ext      = _selectedFile.name.split('.').pop().toLowerCase();
    var filePath = userId + '/profile.' + ext;

    var uploadResult = await db.storage
      .from(PHARMACY_PROFILE_BUCKET)
      .upload(filePath, _selectedFile, { upsert: true, contentType: _selectedFile.type });

    if (uploadResult.error) throw new Error('Upload failed: ' + uploadResult.error.message);

    /* Get public URL */
    var urlData    = db.storage.from(PHARMACY_PROFILE_BUCKET).getPublicUrl(filePath);
    var publicUrl  = urlData.data.publicUrl;

    /* Save to profiles.profile_img */
    var dbResult = await db
      .from('profiles')
      .update({ profile_img: publicUrl })
      .eq('user_id', userId);

    if (dbResult.error) throw new Error('Could not save photo URL: ' + dbResult.error.message);

    /* Update sidebar + show remove button */
    var sidebarName = document.getElementById('sidebarName');
    setSidebarAvatar(publicUrl, sidebarName ? sidebarName.textContent : '');

    var removeBtn = document.getElementById('removePhotoBtn');
    if (removeBtn) removeBtn.style.display = 'inline-flex';

    var selectedNameEl = document.getElementById('photoSelectedName');
    if (selectedNameEl) selectedNameEl.textContent = '';

    _selectedFile = null;
    showToast('Profile photo uploaded successfully!', 'success');

  } catch (err) {
    console.error('Photo upload error:', err);
    showToast(err.message || 'Photo upload failed.', 'error');
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled  = false;
      uploadBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Upload Photo';
      uploadBtn.disabled  = true;
    }
  }
}

/* ─────────────────────────────────────────
   11. PHOTO REMOVE
   ───────────────────────────────────────── */
async function removePhoto() {
  var removeBtn = document.getElementById('removePhotoBtn');
  if (removeBtn) {
    removeBtn.disabled  = true;
    removeBtn.innerHTML = '<span class="loader-spinner" style="width:14px;height:14px;border-width:2px;border-top-color:var(--clr-red);background:transparent;margin:0 4px;display:inline-block;"></span> Removing…';
  }

  try {
    var sessionResult = await db.auth.getSession();
    var session = sessionResult.data.session;
    if (!session) { showToast('Session expired.', 'error'); return; }
    var userId = session.user.id;

    await db.storage.from(PHARMACY_PROFILE_BUCKET).remove([
      userId + '/profile.jpg',
      userId + '/profile.png',
      userId + '/profile.webp'
    ]);

    var dbResult = await db
      .from('profiles')
      .update({ profile_img: null })
      .eq('user_id', userId);

    if (dbResult.error) throw new Error('Could not clear photo: ' + dbResult.error.message);

    clearPhotoPreview();
    if (removeBtn) removeBtn.style.display = 'none';

    var sidebarName = document.getElementById('sidebarName');
    setSidebarAvatar(null, sidebarName ? sidebarName.textContent : '');

    _selectedFile = null;
    var fileInput = document.getElementById('photoFileInput');
    if (fileInput) fileInput.value = '';
    var nameDisplay = document.getElementById('photoSelectedName');
    if (nameDisplay) nameDisplay.textContent = '';

    showToast('Profile photo removed.', 'info');

  } catch (err) {
    console.error('Remove photo error:', err);
    showToast(err.message || 'Could not remove photo.', 'error');
  } finally {
    if (removeBtn) {
      removeBtn.disabled  = false;
      removeBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Remove Photo';
    }
  }
}

/* ─────────────────────────────────────────
   UTILITY HELPERS
   ───────────────────────────────────────── */
function getValue(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function setValue(id, value) {
  var el = document.getElementById(id);
  if (el) el.value = value != null ? value : '';
}

function hideLoader() {
  var loader = document.getElementById('pageLoader');
  if (loader) loader.classList.add('hidden');
}

function fadeIn(id) {
  var el = document.getElementById(id);
  if (el) el.style.opacity = '1';
}

function resetSaveBtn(btn) {
  if (!btn) return;
  btn.disabled  = false;
  btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Profile Updates';
}

/* ─────────────────────────────────────────
   12. INIT — single DOMContentLoaded
   ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {

  /* Sidebar */
  initSidebar();

  /* Build default hours skeleton */
  buildHoursUI(null);

  /* Load real data from Supabase */
  loadProfile();

  /* Wire photo file input */
  var fileInput = document.getElementById('photoFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        showToast('Image must be under 2 MB.', 'error');
        this.value = '';
        return;
      }

      _selectedFile = file;

      var reader = new FileReader();
      reader.onload = function (e) { setPhotoPreview(e.target.result); };
      reader.readAsDataURL(file);

      var nameEl = document.getElementById('photoSelectedName');
      if (nameEl) nameEl.textContent = file.name;

      var uploadBtn = document.getElementById('uploadPhotoBtn');
      if (uploadBtn) uploadBtn.disabled = false;
    });
  }

});

/* Expose to global scope for onclick in HTML */
window.saveProfile  = saveProfile;
window.uploadPhoto  = uploadPhoto;
window.removePhoto  = removePhoto;
