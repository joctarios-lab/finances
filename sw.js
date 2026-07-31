/* Finanças da Família — service worker: app shell offline-first */
'use strict';

const VERSAO = '101';
const CACHE = 'financas-' + VERSAO;
const SHELL = [
  './',
  'index.html',
  'css/styles.css?v=' + VERSAO,
  'vendor/apexcharts.css?v=' + VERSAO,
  'vendor/apexcharts.min.js?v=' + VERSAO,
  'js/config.js?v=' + VERSAO,
  'js/icons.js?v=' + VERSAO,
  'js/ui.js?v=' + VERSAO,
  'js/graficos.js?v=' + VERSAO,
  'js/ofx.js?v=' + VERSAO,
  'js/db.js?v=' + VERSAO,
  'js/sync.js?v=' + VERSAO,
  'js/auth.js?v=' + VERSAO,
  'js/app.js?v=' + VERSAO,
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
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

/* Push vindo do servidor (Edge Function do Supabase) — funciona com o app fechado. */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; }
  catch (_) { data = { title: 'Finanças da Família', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Finanças da Família', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag,
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    })
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

  // App shell: REDE PRIMEIRO, cache como reserva.
  // Cache-first fazia o navegador rodar a versão anterior do app por um carregamento
  // inteiro depois de cada atualização — o que dava a impressão de botão "sem função".
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
    );
  }
});
