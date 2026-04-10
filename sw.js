// FitTrack Pro — Service Worker v1
// Enables full offline mode for PWA
const CACHE_NAME = 'fittrack-v1';
const APP_SHELL = [
  './',
  './index.html',
];
const FONT_URLS = [
  'https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap',
];
const API_CACHE = 'fittrack-api-v1';
const API_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// ── Install: cache app shell + fonts ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache app shell
      const appPromise = cache.addAll(APP_SHELL).catch(() => {});
      // Cache font CSS (and the font files they reference)
      const fontPromise = Promise.all(
        FONT_URLS.map(url =>
          fetch(url)
            .then(res => {
              if (res.ok) {
                cache.put(url, res.clone());
                // Parse CSS to find actual font file URLs and cache those too
                return res.text().then(css => {
                  const fontFileUrls = [];
                  const regex = /url\(["']?(https?:\/\/[^"')]+)["']?\)/g;
                  let match;
                  while ((match = regex.exec(css)) !== null) {
                    fontFileUrls.push(match[1]);
                  }
                  return Promise.all(
                    fontFileUrls.map(furl =>
                      fetch(furl)
                        .then(fres => fres.ok ? cache.put(furl, fres) : null)
                        .catch(() => {})
                    )
                  );
                });
              }
            })
            .catch(() => {})
        )
      );
      return Promise.all([appPromise, fontPromise]);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// ── Fetch: cache-first for app shell + fonts, network-first for API ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // USDA API calls: network-first with cache fallback
  if (url.hostname === 'api.nal.usda.gov') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Open Food Facts API (barcode lookups): same strategy
  if (url.hostname === 'world.openfoodfacts.org') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Font files and CSS: cache-first (they rarely change)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'api.fontshare.com' ||
    url.hostname === 'cdn.fontshare.com'
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell (HTML, same-origin): cache-first, update in background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        // Serve from cache immediately
        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => null);

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Periodic API cache cleanup ──
self.addEventListener('message', event => {
  if (event.data === 'cleanApiCache') {
    caches.open(API_CACHE).then(cache => {
      cache.keys().then(requests => {
        requests.forEach(req => {
          cache.match(req).then(res => {
            if (res) {
              const dateHeader = res.headers.get('date');
              if (dateHeader) {
                const age = Date.now() - new Date(dateHeader).getTime();
                if (age > API_MAX_AGE) {
                  cache.delete(req);
                }
              }
            }
          });
        });
      });
    });
  }
});
