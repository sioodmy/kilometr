// Service Worker PWA Kilometr: precache powłoki aplikacji (JS, CSS, WASM,
// czcionki, ikony) dla natychmiastowego startu offline. Baza GTFS żyje w OPFS
// (expo-sqlite), a kafelki mapy i dane live nie są buforowane w SW.

const CACHE_VERSION = '__KM_SW_VERSION__';
const CACHE_NAME = `kilometr-shell-${CACHE_VERSION}`;
const PRECACHE_URLS = __KM_PRECACHE_URLS__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('kilometr-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Zewnętrzne API (OpenFreeMap, zbiorkom, data.kilometr.app, Nominatim, OSRM) idą prosto do sieci.
  if (url.origin !== self.location.origin) return;

  // Nawigacje SPA: najpierw sieć (świeża wersja), przy braku sieci cache index.html.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error())),
    );
    return;
  }

  // Statyczne zasoby z hashem i ikony: cache-first z dograniem do cache.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
      return undefined;
    }),
  );
});
