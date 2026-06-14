const CACHE_VERSION = 'p4-shell-v3.4.0-eggs-7';
const APP_SHELL = [
  '/',
  '/index.html',
  '/theme.css?v=eggs-7',
  '/theme.js?v=eggs-7',
  '/manifest.webmanifest',
  '/assets/site-logo-small.png',
  '/assets/wukong-cursor.cur',
  '/assets/wukong-cursor.png',
  '/assets/pwa-icon-192.png',
  '/assets/pwa-icon-512.png',
  '/assets/pwa-icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function shouldBypass(request, url) {
  return request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/socket.io/')
    || url.pathname.startsWith('/downloads/');
}

function isLiveShellAsset(url) {
  return url.pathname === '/theme.js'
    || url.pathname === '/theme.css'
    || url.pathname === '/service-worker.js';
}

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (isLiveShellAsset(url)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
