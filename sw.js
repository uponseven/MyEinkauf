// Service Worker: App offline verfügbar machen.
// App-Dateien kommen bei Netz immer frisch vom Server (Network First), der Cache dient nur
// als Rückfall ohne Netz. VERSION erhöhen, wenn sich die Liste APP_FILES ändert.

const VERSION = 'v0.3.0';
const APP_CACHE = `myeinkauf-app-${VERSION}`;
const IMAGE_CACHE = 'myeinkauf-images';

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/backup.js',
  'js/categories.js',
  'js/db.js',
  'js/ean.js',
  'js/off.js',
  'js/scanner.js',
  'js/sync.js',
  'vendor/zxing/zxing-browser.min.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('myeinkauf-app-') && k !== APP_CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Eigene App-Dateien: zuerst Netz (und Cache auffrischen), ohne Netz aus dem Cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request, { ignoreSearch: true })) ||
          (request.mode === 'navigate' ? caches.match('index.html') : Response.error())),
    );
    return;
  }

  // Produktbilder von Open Food Facts & Co.: einmal geladen, offline verfügbar.
  if (/^images\.open(food|beauty|products)facts\.org$/.test(url.hostname)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        // Auch undurchsichtige Antworten (<img> ohne CORS) cachen.
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
        return response;
      }),
    );
  }
  // Alles andere (z. B. Produkt-API) geht direkt ans Netz.
});
