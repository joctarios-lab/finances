/* Finanças da Família — service worker: app shell offline-first */
'use strict';

const CACHE = 'financas-v1';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/db.js',
  'js/sync.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nunca interceptar chamadas de API (Supabase) nem métodos não-GET.
  if (e.request.method !== 'GET' || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  // Fontes do Google: cache-first com preenchimento em runtime (funciona offline após 1º uso).
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // App shell: cache-first, atualização em segundo plano.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        }).catch(() => hit);
        return hit || fresh;
      })
    );
  }
});
