// Service worker minimal: cukup untuk membuat aplikasi "installable" sebagai PWA.
// Sengaja TIDAK melakukan caching agar konten selalu terbaru tiap kali redeploy.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* biarkan browser menangani jaringan seperti biasa */ });
