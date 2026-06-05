/* ================================================================
   MediFinder — FCM Initialization  (v3 — scope + session fix)

   Key fixes vs v2:
   - sessionStorage guard removed from the token-save success path.
     It now guards only against running TWICE in the same page load
     (via a module-level flag), not across page loads. This ensures
     that after a SW scope change is deployed, every fresh page load
     re-registers and re-saves the token correctly.
   - Unregisters any stale root-scope SW (/firebase-messaging-sw.js)
     left over from before the /FYDP/ path fix. Without this, the
     old SW stays cached and getToken() uses the wrong one.
   - All errors logged to console so you can see exactly what fails.
================================================================ */
let _fcmInitStarted = false;   // module-level guard — prevents double-run on same load

(async function initFCM() {
  'use strict';

  if (_fcmInitStarted) return;
  _fcmInitStarted = true;

  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDWwdTu5hxKKhNfmWudAHOx8cGCu2YmG8s",
    authDomain:        "medifinder-574f0.firebaseapp.com",
    projectId:         "medifinder-574f0",
    storageBucket:     "medifinder-574f0.firebasestorage.app",
    messagingSenderId: "327673518581",
    appId:             "1:327673518581:web:0a1aaae95d87cd4b6fe8bc"
  };

  const FCM_VAPID_KEY = "BPEK7Vmpfp1DzzikKb4q5UVm80Q0KSg_k74MboQQE87I86RUR4gAeSzPddvs2nws7PMHcMvaNw8ia24AxrDTc9c";

  const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
  const db = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[FCM] Browser missing SW or Notification API — skipping.');
    return;
  }
  if (!db) { console.error('[FCM] No Supabase client found — skipping.'); return; }

  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) { console.warn('[FCM] No session — skipping.'); return; }

  try {
    // ── Step 1: Unregister stale root-scope SW if present ─────────
    // This cleans up the old /firebase-messaging-sw.js at root scope
    // that was deployed before the /FYDP/ path fix. Without removing
    // it, the browser keeps using the wrong SW for getToken().
    const existingRegs = await navigator.serviceWorker.getRegistrations();
    for (const reg of existingRegs) {
      if (reg.scope === 'https://noemahmedkhan.github.io/' ||
          reg.scope === location.origin + '/') {
        console.log('[FCM] Unregistering stale root-scope SW:', reg.scope);
        await reg.unregister();
      }
    }

    // ── Step 2: Load Firebase SDK ─────────────────────────────────
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

    // ── Step 3: Init Firebase (guard against double-init) ─────────
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    const messaging = firebase.messaging();

    // ── Step 4: Register SW at correct /FYDP/ path + scope ────────
    const swReg = await navigator.serviceWorker.register(
      '/FYDP/firebase-messaging-sw.js',
      { scope: '/FYDP/' }
    );
    // Wait for SW to be active before calling getToken
    await swReg.update();
if (swReg.installing) {
    await new Promise(resolve => {
        swReg.installing.addEventListener('statechange', function() {
            if (this.state === 'activated') resolve();
        });
    });
}
    console.log('[FCM] SW registered, scope:', swReg.scope);

    // ── Step 5: Request notification permission ───────────────────
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[FCM] Permission denied by user.');
      return;
    }

    // ── Step 6: Get FCM token ─────────────────────────────────────
    let token;
    try {
      token = await messaging.getToken({
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: swReg
      });
    } catch (tokenErr) {
      console.error('[FCM] getToken() threw:', tokenErr.message);
      return;
    }

    if (!token) {
      console.warn('[FCM] getToken() returned null. Check VAPID key in Firebase console.');
      return;
    }
    console.log('[FCM] Token obtained:', token.substring(0, 20) + '…');

    // ── Step 7: Upsert token into Supabase ────────────────────────
    const { error: upsertErr } = await db.from('fcm_tokens').upsert(
      {
        user_id:     session.user.id,
        token,
        device_info: navigator.userAgent.substring(0, 200),
        last_used:   new Date().toISOString()
      },
      { onConflict: 'user_id,token' }
    );
    if (upsertErr) {
      console.error('[FCM] Token upsert error:', upsertErr.message, upsertErr);
    } else {
      console.log('[FCM] Token saved to fcm_tokens successfully.');
    }

    // ── Step 8: Handle foreground messages ───────────────────────
    messaging.onMessage(function (payload) {
      const notif = payload.notification;
      if (notif) {
        new Notification(notif.title, {
          body: notif.body,
          icon: '/FYDP/Images/Logo.png'
        });
      }
    });

  } catch (err) {
    console.error('[FCM] Initialization error:', err.message, err);
  }
})();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Failed to load script: ' + src));
    document.head.appendChild(s);
  });
}
