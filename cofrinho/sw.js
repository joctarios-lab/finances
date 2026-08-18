/* Cofrinho — service worker.

   É PROPOSITALMENTE SEPARADO do sw.js do app da família. Escopos diferentes
   (`/cofrinho/` e `/`), versões diferentes, caches diferentes: publicar uma
   correção no app do adulto não pode reinstalar o app da criança no meio de um
   sábado, e o contrário também não.

   Estratégia: cache primeiro para a casca do app, rede primeiro para nada — não
   há nada aqui que precise de rede para desenhar. Os dados vêm do localStorage,
   e a nuvem é conversa que acontece por trás, sem passar pelo cache. */
'use strict';

const VERSAO = '20';
const CACHE = 'cofrinho-' + VERSAO;

const CASCA = [
  './',
  './index.html',
  './css/cofrinho.css?v=20',
  './js/arte.js?v=20',
  './js/dados.js?v=20',
  './js/cofrinho.js?v=20',
  './manifest.webmanifest',
  './icons/cofrinho.svg',
  '../js/config.js?v=200',
];

self.addEventListener('install', ev => {
  // addAll falha inteiro se um item falhar; aqui cada um por si, porque um
  // ícone ausente não é motivo para o app não instalar.
  ev.waitUntil(
    caches.open(CACHE)
      // `cache: reload` porque add() respeita o cache HTTP do navegador: sem isto a
      // casca NOVA podia ser gravada com os bytes VELHOS que o Pages ainda servia.
      .then(c => Promise.all(CASCA.map(u =>
        c.add(new Request(u, { cache: 'reload' })).catch(() => { })
      )))
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

  /* REDE PRIMEIRO. O cache existe para quando a rede falha, e não para poupar uma
     viagem: o app tem seis arquivos e nenhum deles é pesado.

     NADA DE ignoreSearch aqui, e este era o defeito que se alimentava sozinho. Todo o
     versionamento do app é a etiqueta `?v=`; com ignoreSearch, um pedido de
     `cofrinho.js?v=12` casava com o `?v=11` guardado. Bastava uma página velha carregar
     enquanto o worker novo já valia para o `?v=11` entrar no cache NOVO — e a partir
     dali o HTML novo era servido com o código velho, para sempre, sem nada no app
     indicando que havia duas versões brigando. */
  ev.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia)).catch(() => { });
        }
        return res;
      })
      /* RESERVA OFFLINE em cadeia, e não com `||`: `caches.match` devolve uma Promise,
         que é sempre verdadeira -- encadear com `||` pegaria sempre a primeira, mesmo
         quando ela resolve para undefined, e a tela ficaria em branco offline. */
      .catch(() => caches.match(req)
        .then(achou => achou || caches.match('./index.html'))
        .then(achou => achou || caches.match('./')))
  );
});
