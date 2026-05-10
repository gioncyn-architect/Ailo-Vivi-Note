/* ═══════════════════════════════════════
   AILO VIVI NOTE — Service Worker 🌸
   Cache-first + Network fallback
   Versi: 1.0.0
═══════════════════════════════════════ */

const SW_VERSION   = 'v1.0.0';
const CACHE_NAME   = 'ailo-vivi-note-' + SW_VERSION;
const OFFLINE_PAGE = './index.html';

/* File yang di-cache saat install */
const PRECACHE_ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Pacifico&display=swap'
];

/* ── INSTALL: pre-cache semua aset utama ── */
self.addEventListener('install', event => {
  console.log('[SW] Install', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching assets...');
        // Cache satu per satu agar satu gagal tidak blokir semua
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('[SW] Gagal cache:', url, err))
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: hapus cache lama ── */
self.addEventListener('activate', event => {
  console.log('[SW] Activate', SW_VERSION);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: Cache-first, fallback ke network ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Abaikan request non-GET
  if (request.method !== 'GET') return;

  // Abaikan request ke API eksternal (Groq, Mistral, Cohere)
  const isApiCall = [
    'api.groq.com',
    'api.mistral.ai',
    'api.cohere.com'
  ].some(host => url.hostname.includes(host));
  if (isApiCall) return;

  // Abaikan chrome-extension dan request aneh
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          // Kembalikan dari cache, update di background
          fetchAndUpdateCache(request);
          return cached;
        }
        // Tidak ada di cache → fetch dari network
        return fetchAndUpdateCache(request);
      })
      .catch(() => {
        // Offline & tidak ada cache → tampilkan halaman utama
        return caches.match(OFFLINE_PAGE);
      })
  );
});

/* ── Helper: fetch + simpan ke cache ── */
async function fetchAndUpdateCache(request) {
  try {
    const response = await fetch(request);
    if (
      response &&
      response.status === 200 &&
      response.type !== 'opaque' // Jangan cache opaque response (CORS)
    ) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Network gagal, coba cache sekali lagi
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/* ── PUSH NOTIFICATION (opsional, siap dipakai) ── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || '🌸 Ailo Vivi Note', {
    body:    data.body    || 'Ada pengingat untukmu!',
    icon:    './icons/icon-192.png',
    badge:   './icons/icon-72.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || './' }
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || './')
  );
});

/* ── MESSAGE: force update dari app ── */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'GET_VERSION') {
    event.ports[0].postMessage(SW_VERSION);
  }
});
