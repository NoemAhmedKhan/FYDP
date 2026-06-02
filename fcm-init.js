/* ================================================================
   MediFinder — FCM Initialization
   Requests push notification permission and registers the FCM
   token with Supabase after user login.
   Load this script on all user-facing pages after supabase.js.
   ================================================================ */
(async function initFCM() {
  'use strict';

  // Replace with your actual Firebase config
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDWwdTu5hxKKhNfmWudAHOx8cGCu2YmG8s",
    authDomain: "medifinder-574f0.firebaseapp.com",
    projectId: "medifinder-574f0",
    storageBucket: "medifinder-574f0.firebasestorage.app",
    messagingSenderId: "327673518581",
    appId: "1:327673518581:web:0a1aaae95d87cd4b6fe8bc"
  };

  const FCM_VAPID_KEY = "aPTek0pFhJ6EymLF0KeBv0iYq-7tY2Ogh2DJE1-Pi68";

  const SUPABASE_URL = 'https://ktzsshlllyjuzphprzso.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0enNzaGxsbHlqdXpwaHByenNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTg4ODksImV4cCI6MjA4Nzk5NDg4OX0.WMoLBWXf0kJ9ebPO6jkIpMY7sFvcL3DRR-KEpY769ic';
  const db = window.supabaseClient || window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Only proceed if browser supports service workers
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

  // Only proceed if user is logged in
  if (!db) return;
  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) return;

  // Don't spam the permission request — only ask once per session
  if (sessionStorage.getItem('fcm_init_done')) return;

  try {
    // Dynamically load Firebase SDK (no build step needed)
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
    await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging();

    // Register the service worker
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Get FCM token
    const token = await messaging.getToken({
      vapidKey:          FCM_VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) return;

    // Upsert token into Supabase (handles token refresh automatically)
    const deviceInfo = navigator.userAgent.substring(0, 200);
    await db.from('fcm_tokens').upsert(
      {
        user_id:     session.user.id,
        token,
        device_info: deviceInfo,
        last_used:   new Date().toISOString()
      },
      { onConflict: 'user_id,token' }
    );

    sessionStorage.setItem('fcm_init_done', '1');

    // Handle foreground messages (app tab is active)
    messaging.onMessage(function(payload) {
      const notif = payload.notification;
      if (notif) {
        new Notification(notif.title, {
          body: notif.body,
          icon: '/FYDP/Images/Logo.png'
        });
      }
    });

  } catch (err) {
    // FCM failures are non-fatal — app continues working without push
    console.warn('[FCM] Initialization failed (non-fatal):', err.message);
  }
})();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
