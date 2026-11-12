// Lets the site be installed to the home screen. Everything still comes from the network;
// only the app shell is kept so the icon opens even on a flaky connection.
const SHELL = 'xlri-shell-v1';
self.addEventListener('install', (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', 'index.html', 'style.css', 'main.js', 'places.js'])).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first, so updates show up straight away; fall back to the saved shell offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL_FILES.has(url.pathname.split('/').pop())) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
const SHELL_FILES = new Set(['', 'index.html', 'style.css', 'main.js', 'places.js']);
