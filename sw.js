// app/sw.js
//
// El service worker existe por una sola razon: que la app abra entera en un
// sotano sin cobertura. No cachea datos (de eso se encarga IndexedDB), solo el
// armazon.
//
// Estrategia: red primero para el armazon, cache como red de seguridad. Asi un
// cambio publicado se ve en el siguiente arranque en vez de quedarse pegado,
// que es lo que el usuario pidio con «cambios en tiempo real».

const CACHE = 'entreno-2026-09-23.14';
const ARMAZON = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/app.css',
  './js/app.js',
  './js/datos.js',
  './js/pantallas.js',
  './js/calorias.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // La API de GitHub nunca se cachea: un dato viejo disfrazado de fresco es peor
  // que no tener dato.
  if (url.host !== self.location.host) return;
  // version.json manda la auto-actualizacion: si se cachea, no hay actualizacion.
  if (url.pathname.endsWith('/version.json')) return;

  e.respondWith((async () => {
    try {
      // 'no-cache' = revalidar SIEMPRE con el servidor (ETag). Pages sirve con
      // max-age=600: sin esto, un modulo roto o viejo se queda 10 minutos aunque
      // ya este arreglado arriba. Con ETag la respuesta es un 304 de 0 bytes.
      const r = await fetch(new Request(e.request, { cache: 'no-cache' }));
      if (r.ok) (await caches.open(CACHE)).put(e.request, r.clone());
      return r;
    } catch {
      const c = await caches.match(e.request);
      if (c) return c;
      if (e.request.mode === 'navigate') return caches.match('./index.html');
      throw new Error('sin red y sin copia');
    }
  })());
});
