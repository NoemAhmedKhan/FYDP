// ================================================================
// MediFinder — Firebase Cloud Messaging Service Worker
// MUST be placed at the root of the GitHub Pages site.
// ================================================================
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Replace with your actual Firebase config values
firebase.initializeApp({
    apiKey: "AIzaSyDWwdTu5hxKKhNfmWudAHOx8cGCu2YmG8s",
    authDomain: "medifinder-574f0.firebaseapp.com",
    projectId: "medifinder-574f0",
    storageBucket: "medifinder-574f0.firebasestorage.app",
    messagingSenderId: "327673518581",
    appId: "1:327673518581:web:0a1aaae95d87cd4b6fe8bc"
});

const messaging = firebase.messaging();

// Handle background notifications (when app tab is not in focus)
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Background message received:', payload);
  const notif = payload.notification;
  self.registration.showNotification(notif.title, {
    body:  notif.body,
    icon:  '/FYDP/Images/Logo.png',
    badge: '/FYDP/Images/Logo.png',
    data:  { url: payload.fcmOptions?.link ?? '/FYDP/UserReminders.html' }
  });
});

// On notification click, open the app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? '/FYDP/UserReminders.html';
  event.waitUntil(clients.openWindow(targetUrl));
});
