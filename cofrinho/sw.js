/* Cofrinho — service worker.

   É PROPOSITALMENTE SEPARADO do sw.js do app da família. Escopos diferentes
   (`/cofrinho/` e `/`), versões diferentes, caches diferentes: publicar uma
   correção no app do adulto não pode reinstalar o app da criança no meio de um
   sábado, e o contrário também não.

   Estratégia: cache primeiro para a casca do app, rede primeiro para nada — não
   há nada aqui que precise de rede para desenhar. Os dados vêm do localStorage,
   e a nuvem é conversa que acontece por trás, sem passar pelo cache. */
'use strict';

const VERSAO = '2';
const CACHE = 'cofrinho-' + VERSAO;

const CASCA = [
  './',
  './index.html',
  './css/cofrinho.css?v=2',
  './js/arte.js?v=2',
  './js/dados.js?v=2',
  './js/cofrinho.js?v=2',
  './manifest.webmanifest',
  './icons/cofrinho.svg',
  '../js/config.js?v=137',
];

self.addEventListener('install', ev => {
  // addAll falha inteiro se um item falhar; aqui cada um por si, porque um
  // ícone ausente não é motivo para o app não instalar.
  ev.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(CASCA.map(u => c.add(u).catch(() => { }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('cofrinho-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // A conversa com o Supabase nunca entra no cache: um saldo velho servido do
  // cache seria pior do que não responder.
  if (url.origin !== location.origin) return;

  ev.respondWith(
    caches.match(req, { ignoreSearch: true }).then(achou => {
      const daRede = fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => { });
        }
        return res;
      }).catch(() => achou || caches.match('./index.html'));
      return achou || daRede;
    })
  );
});
