/* ================================================================
   MediFinder — FCM Initialization  (fixed v2)
   
   FIXES vs original:
   1. SW registered at '/FYDP/firebase-messaging-sw.js' with explicit
      scope '/FYDP/' — matches GitHub Pages subpath.
      Original registered at '/firebase-messaging-sw.js' (root),
      which has a different scope than /FYDP/ pages, so getToken()
      returned null and nothing was ever stored in fcm_tokens.
   2. Firebase init guard now checks AFTER SDK loads, not before —
      avoids a race where firebase.apps is checked on the undefined
      global object.
   3. SW registration awaited with { scope } option to prevent the
      browser returning a stale out-of-scope registration.
   ================================================================ */
(async function initFCM() {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDWwdTu5hxKKhNfmWudAHOx8cGCu2YmG8s",
    authDomain:        "medifinder-574f0.firebaseapp.com",
    projectId:         "medifinder-574f0",
    storageBucket:     "medifinder-574f0.firebasestorage.app",
    messagingSenderId: "327673518581",
    appId:             "1:327673518581:web:0a1aaae95d87cd4b6fe8bc"
  };

  // ── IMPORTANT: VAPID key must be the full key from Firebase console
  //    Project Settings → Cloud Messaging → Web Push certificates
  const FCM_VAPID_KEY = "aPTek0pFhJ6EymLF0KeBv0iYq-7tY2Ogh2DJE1-Pi68";

  const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
  const db = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Browser support check
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    console.warn('[FCM] Browser does not support SW or Notifications — skipping.');
    return;
  }

  // Must be logged in
  if (!db) { console.warn('[FCM] No Supabase client — skipping.'); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) return;

  // Only run once per browser session
  if (sessionStorage.getItem('fcm_init_done')) return;

  try {
    // ── Step 1: Load Firebase SDK ─────────────────────────────────
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

    // ── Step 2: Init Firebase app (guard against double-init) ─────
    // Must check AFTER scripts load — firebase global is not defined before
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    const messaging = firebase.messaging();

    // ── Step 3: Register SW with CORRECT path AND scope ───────────
    // The SW file is at /FYDP/firebase-messaging-sw.js in the repo.
    // The scope must explicitly be /FYDP/ so it covers all app pages.
    // Without this, the SW controls the root scope, not /FYDP/,
    // and getToken() silently returns null.
    const swReg = await navigator.serviceWorker.register(
      '/FYDP/firebase-messaging-sw.js',
      { scope: '/FYDP/' }
    );
    console.log('[FCM] SW registered, scope:', swReg.scope);

    // ── Step 4: Request notification permission ───────────────────
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[FCM] Notification permission denied.');
      return;
    }

    // ── Step 5: Get FCM token ─────────────────────────────────────
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg   // explicit — prevents wrong SW being used
    });

    if (!token) {
      console.warn('[FCM] getToken() returned null — check VAPID key and SW scope.');
      return;
    }
    console.log('[FCM] Token obtained:', token.substring(0, 20) + '…');

    // ── Step 6: Upsert token into Supabase ────────────────────────
    const deviceInfo = navigator.userAgent.substring(0, 200);
    const { error: upsertErr } = await db.from('fcm_tokens').upsert(
      {
        user_id:     session.user.id,
        token,
        device_info: deviceInfo,
        last_used:   new Date().toISOString()
      },
      { onConflict: 'user_id,token' }
    );
    if (upsertErr) {
      console.error('[FCM] Token upsert failed:', upsertErr.message);
    } else {
      console.log('[FCM] Token saved to fcm_tokens.');
      sessionStorage.setItem('fcm_init_done', '1');
    }

    // ── Step 7: Handle foreground messages ───────────────────────
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
    // FCM failures are non-fatal — email reminders still work
    console.warn('[FCM] Initialization failed (non-fatal):', err.message);
  }
})();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}
