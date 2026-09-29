// Service Worker: haelt nur die App-Huelle offline vor. Playlists und Tapes kommen immer frisch
// aus dem Netz (werden hier bewusst nicht zwischengespeichert).
const CACHE = "demotape-shell-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "k.js", "vendor/qrcode.js",
  "fonts/caveat-600.woff2", "sounds/wind_loop.wav", "sounds/key_down.wav", "sounds/key_up.wav",
  "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== "GET" || !url.pathname.startsWith(scope.pathname) || url.origin !== scope.origin) return;
  // Netz zuerst (Updates sofort sichtbar), Cache als Offline-Rueckfall.
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && SHELL.some(p => url.pathname.endsWith(p.replace("./", "")) || url.pathname === scope.pathname)) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
