// App-shell cache for offline use. Holiday-data requests (jsDelivr CDN) are
// left untouched here — holidays.js already handles its own localStorage
// cache + TTL + stale fallback.
//
// Network-first, cache-fallback: always try the network so a deployed update
// is visible on the very next load, and only fall back to the cached shell
// when offline. (A stale-while-revalidate strategy was tried first but meant
// every update needed two page loads to show up — network-first avoids that.)
const CACHE_NAME = 'cal-shell-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './calendar.js',
  './workday.js',
  './holidays.js',
  './bridge-plan.js',
  './lunar-adapter.js',
  './almanac-info.js',
  './vendor/lunar.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './sw-register.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
