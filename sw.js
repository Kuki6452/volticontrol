/*
 * VoltiControl — trabajador de fondo ("service worker").
 * Guarda una copia de la app para que abra sin internet.
 * Primero intenta la red (así siempre llega la versión más nueva) y, si no hay
 * conexión, usa la copia guardada. Cambia VERSION cuando agregues archivos.
 */
const VERSION = 'volticontrol-v3';
const ARCHIVOS = [
  './',
  'index.html',
  'css/styles.css',
  'js/calculos.js',
  'js/datos.js',
  'js/app.js',
  'manifest.webmanifest',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
  'iconos/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (claves) { return Promise.all(claves.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const pedido = e.request;
  const url = new URL(pedido.url);
  if (pedido.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(pedido).then(function (respuesta) {
      // se guarda la copia nueva (sin parámetros como ?hogar=, que cambian cada vez)
      if (respuesta.ok && !url.search) {
        const copia = respuesta.clone();
        caches.open(VERSION).then(function (c) { c.put(pedido, copia); });
      }
      return respuesta;
    }).catch(function () {
      return caches.match(pedido, { ignoreSearch: true }).then(function (guardada) {
        if (guardada) return guardada;
        return pedido.mode === 'navigate' ? caches.match('./') : Response.error();
      });
    })
  );
});
