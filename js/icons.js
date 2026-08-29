/* Finanças da Família — sistema de ícones SVG inline.

   GRID DE 24 E TRAÇO DE 1,75. O conjunto anterior era 24/2px, e 2px num ícone de
   18px na tela (que é o tamanho em que quase todos aparecem aqui) engorda o
   desenho até ele virar mancha: a 0,75 de escala, o traço fica com 1,5px sobre
   contornos de 1px do resto da interface. 1,75 desce para ~1,3px na tela e
   encosta no peso da tipografia, que é onde o ícone deveria estar.

   currentColor SEMPRE, e nunca `fill`. É o que permite o mesmo ícone servir de
   glifo cinza numa lista, de marca colorida dentro de um badge e de símbolo
   branco sobre o gradiente do cartão de crédito, sem existirem três arquivos.

   SEM DEPENDÊNCIA EXTERNA: o app é offline-first, e um sprite vindo de CDN
   quebraria justamente no uso sem rede. */
'use strict';

/* O tamanho vem do CSS (`[data-ico] svg`), não do atributo: um width fixo aqui
   venceria a folha de estilo e tiraria do tema a decisão de quanto o ícone mede
   em cada contexto. O viewBox é o que garante a proporção. */
const _svg = inner =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const I = {
  /* ---------- Navegação ---------- */
  home: _svg('<path d="M3.5 10.2 12 3.6l8.5 6.6V19a1.6 1.6 0 0 1-1.6 1.6h-4.1v-5.5h-5.6v5.5H5.1A1.6 1.6 0 0 1 3.5 19z"/>'),
  list: _svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.6" cy="6" r="1.1"/><circle cx="4.6" cy="12" r="1.1"/><circle cx="4.6" cy="18" r="1.1"/>'),
  card: _svg('<rect x="2.5" y="5" width="19" height="14" rx="2.6"/><line x1="2.5" y1="9.8" x2="21.5" y2="9.8"/><line x1="6.2" y1="15.2" x2="10" y2="15.2"/>'),
  target: _svg('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.15"/>'),
  pie: _svg('<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>'),
  trend: _svg('<polyline points="22 7 14.5 14.5 9.5 9.5 2 17"/><polyline points="16.5 7 22 7 22 12.5"/>'),
  wallet: _svg('<path d="M19.4 7.6V6a2.4 2.4 0 0 0-2.4-2.4H5.4A2.4 2.4 0 0 0 3 6v12a2.4 2.4 0 0 0 2.4 2.4h13.2A2.4 2.4 0 0 0 21 18v-7.2a2.4 2.4 0 0 0-2.4-2.4H5.4"/><circle cx="16.6" cy="14.4" r="1.15"/>'),
  piggy: _svg('<path d="M20.5 12.4c0-3.3-3.3-6-7.4-6-.9 0-1.7.1-2.5.3L8 4.9v2.6a6.6 6.6 0 0 0-2.3 3.1H3.9a1 1 0 0 0-1 1v1.9a1 1 0 0 0 1 1h1.4c.4.9 1.1 1.7 1.9 2.3v2.3h2.6l.7-1.3c.5.1 1 .1 1.6.1s1.1 0 1.6-.1l.7 1.3h2.6v-2.4c1.8-1.2 3-3 3-5.1z"/><circle cx="16.4" cy="11.6" r=".9"/>'),

  /* ---------- Sistema ---------- */
  settings: _svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1.6" y1="14" x2="6.4" y2="14"/><line x1="9.6" y1="8" x2="14.4" y2="8"/><line x1="17.6" y1="16" x2="22.4" y2="16"/>'),
  lock: _svg('<rect x="4.2" y="10.6" width="15.6" height="10" rx="2.4"/><path d="M8 10.6V7.2a4 4 0 0 1 8 0v3.4"/>'),
  shield: _svg('<path d="M12 21.4s7.6-3.9 7.6-9.6V5.4L12 2.6 4.4 5.4v6.4c0 5.7 7.6 9.6 7.6 9.6z"/>'),
  sync: _svg('<polyline points="20.6 3.4 20.6 9 15 9"/><polyline points="3.4 20.6 3.4 15 9 15"/><path d="M5 9.2a7.6 7.6 0 0 1 12.6-2.9l3 2.7M3.4 15l3 2.7A7.6 7.6 0 0 0 19 14.8"/>'),
  cloud: _svg('<path d="M17.6 10.4h-1.2A7.6 7.6 0 1 0 9 19.6h8.6a4.6 4.6 0 0 0 0-9.2z"/>'),
  bell: _svg('<path d="M18 8.4A6 6 0 0 0 6 8.4c0 6.6-2.6 8.4-2.6 8.4h17.2S18 15 18 8.4"/><path d="M13.7 20.4a2 2 0 0 1-3.4 0"/>'),
  users: _svg('<path d="M16.6 20.6v-1.9a3.8 3.8 0 0 0-3.8-3.8H6.2a3.8 3.8 0 0 0-3.8 3.8v1.9"/><circle cx="9.5" cy="7.4" r="3.8"/><path d="M21.6 20.6v-1.9a3.8 3.8 0 0 0-2.9-3.7"/><path d="M15.8 3.8a3.8 3.8 0 0 1 0 7.3"/>'),
  logout: _svg('<path d="M9.4 20.6H5.6A2.2 2.2 0 0 1 3.4 18.4V5.6a2.2 2.2 0 0 1 2.2-2.2h3.8"/><polyline points="15.8 16.6 20.4 12 15.8 7.4"/><line x1="20.4" y1="12" x2="9.4" y2="12"/>'),
  user: _svg('<path d="M19.4 20.6v-2a4 4 0 0 0-4-4H8.6a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7.4" r="4"/>'),

  /* ---------- Ações ---------- */
  plus: _svg('<line x1="12" y1="5.2" x2="12" y2="18.8"/><line x1="5.2" y1="12" x2="18.8" y2="12"/>'),
  x: _svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check: _svg('<polyline points="20 6.4 9.4 17 4 11.6"/>'),
  chevL: _svg('<polyline points="14.6 18.4 8.2 12 14.6 5.6"/>'),
  chevR: _svg('<polyline points="9.4 18.4 15.8 12 9.4 5.6"/>'),
  chev: _svg('<polyline points="9.4 18.4 15.8 12 9.4 5.6"/>'),
  back: _svg('<line x1="19.4" y1="12" x2="4.6" y2="12"/><polyline points="11.4 18.8 4.6 12 11.4 5.2"/>'),
  trash: _svg('<path d="M4 7h16"/><path d="M10 11.2v5.8"/><path d="M14 11.2v5.8"/><path d="M6 7l.9 12a2.2 2.2 0 0 0 2.2 2h5.8a2.2 2.2 0 0 0 2.2-2L18 7"/><path d="M9.2 7V4.6a1.2 1.2 0 0 1 1.2-1.2h3.2a1.2 1.2 0 0 1 1.2 1.2V7"/>'),
  edit: _svg('<path d="M4 20h4l10.4-10.4a2.3 2.3 0 0 0-3.2-3.2L4.8 16.8V20z"/><line x1="13.6" y1="6.6" x2="17.4" y2="10.4"/>'),
  filter: _svg('<path d="M3.4 5.4h17.2"/><path d="M6.4 12h11.2"/><path d="M10 18.6h4"/>'),
  tag: _svg('<path d="M20.4 13.4 13.4 20.4a2.2 2.2 0 0 1-3.1 0l-7-7A2.2 2.2 0 0 1 2.6 12V5.6A2.6 2.6 0 0 1 5.2 3h6.4a2.2 2.2 0 0 1 1.6.6l7.2 7.2a2.2 2.2 0 0 1 0 2.6"/><circle cx="7.8" cy="7.8" r="1.4"/>'),
  search: _svg('<circle cx="11" cy="11" r="7"/><line x1="16.4" y1="16.4" x2="20.6" y2="20.6"/>'),
  calendar: _svg('<rect x="3.4" y="4.6" width="17.2" height="16" rx="2.4"/><line x1="16" y1="2.6" x2="16" y2="6.4"/><line x1="8" y1="2.6" x2="8" y2="6.4"/><line x1="3.4" y1="9.8" x2="20.6" y2="9.8"/>'),
  invoice: _svg('<path d="M14 3.4H6.8a2.2 2.2 0 0 0-2.2 2.2v12.8a2.2 2.2 0 0 0 2.2 2.2h10.4a2.2 2.2 0 0 0 2.2-2.2V8.8z"/><polyline points="14 3.4 14 8.8 19.4 8.8"/><line x1="15.6" y1="13.4" x2="8.4" y2="13.4"/><line x1="15.6" y1="17" x2="8.4" y2="17"/>'),

  /* Entra e sai. `download` traz o extrato do banco para dentro do app — a seta
     aponta PARA a bandeja, que é a direção da importação; `upload` é o inverso e
     serve à exportação. Trocá-los inverte o sentido que o usuário lê. */
  download: _svg('<path d="M20.6 15.4v3.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2v-3.2"/><polyline points="7.4 10.4 12 15 16.6 10.4"/><line x1="12" y1="15" x2="12" y2="3.4"/>'),
  upload: _svg('<path d="M20.6 15.4v3.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2v-3.2"/><polyline points="16.6 8 12 3.4 7.4 8"/><line x1="12" y1="3.4" x2="12" y2="15"/>'),

  /* ---------- Privacidade e tema ----------
     O olho ABERTO significa "os valores estão à mostra" e é o que se vê no estado
     normal; o cortado aparece quando eles já estão borrados. O ícone mostra o
     estado ATUAL, não a ação — foi o que evitou a dúvida de "clicar aqui esconde
     ou revela?" que a leitura inversa produz. */
  eye: _svg('<path d="M2.4 12S6 5.4 12 5.4 21.6 12 21.6 12 18 18.6 12 18.6 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="3.2"/>'),
  eyeOff: _svg('<path d="M9.9 5.7A9.3 9.3 0 0 1 12 5.4c6 0 9.6 6.6 9.6 6.6a17 17 0 0 1-2.7 3.6M6.4 6.8A16.6 16.6 0 0 0 2.4 12s3.6 6.6 9.6 6.6a9 9 0 0 0 3.7-.8"/><path d="M9.8 9.9a3.2 3.2 0 0 0 4.4 4.4"/><line x1="3.4" y1="3.4" x2="20.6" y2="20.6"/>'),
  sun: _svg('<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.4" x2="12" y2="4.4"/><line x1="12" y1="19.6" x2="12" y2="21.6"/><line x1="4.2" y1="4.2" x2="5.6" y2="5.6"/><line x1="18.4" y1="18.4" x2="19.8" y2="19.8"/><line x1="2.4" y1="12" x2="4.4" y2="12"/><line x1="19.6" y1="12" x2="21.6" y2="12"/><line x1="4.2" y1="19.8" x2="5.6" y2="18.4"/><line x1="18.4" y1="5.6" x2="19.8" y2="4.2"/>'),
  moon: _svg('<path d="M20.4 13.4A8.6 8.6 0 0 1 10.6 3.6a8.6 8.6 0 1 0 9.8 9.8z"/>'),

  /* ---------- Estados ---------- */
  alert: _svg('<path d="M10.3 3.9 2.5 17.4a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9.4" x2="12" y2="13.4"/><circle cx="12" cy="16.8" r=".9"/>'),
  info: _svg('<circle cx="12" cy="12" r="8.8"/><line x1="12" y1="11.4" x2="12" y2="16.4"/><circle cx="12" cy="8" r=".9"/>'),
  wifiOff: _svg('<line x1="2.4" y1="2.4" x2="21.6" y2="21.6"/><path d="M8.6 15.2a5 5 0 0 1 6.2-.4"/><path d="M5.2 11.6a10 10 0 0 1 3.4-2.1M15.2 9.6a10 10 0 0 1 3.6 2M2.2 8.2A14.6 14.6 0 0 1 7 5.4m5.6-.7a14.6 14.6 0 0 1 9.2 3.5"/><circle cx="12" cy="19" r=".9"/>'),
};

/* Injeta os SVGs em qualquer elemento com data-ico (roda de novo para conteúdo dinâmico). */
function paintIcons(root) {
  (root || document).querySelectorAll('[data-ico]').forEach(el => {
    const svg = I[el.dataset.ico];
    if (svg) el.innerHTML = svg;
  });
}

/* ---------- Badge: o ícone dentro da caixa tintada ----------

   O padrão se repetia solto por toda a interface — `.kpi-ico`, `.cfg-ico`,
   `.tx-ico`, `.rel-frase-ico` — cada um remontando à mão o mesmo par de caixa
   arredondada com fundo em 10–15% da cor e glifo na cor cheia. Aqui ele vira uma
   função só, e o tom fica no CSS (`.ico-badge` + as classes `.t-*`), que é onde o
   tema já decide todas as outras cores.

   `tom` aceita os mesmos nomes das tintas do app (primary, success, danger,
   warning, info) para o badge herdar a semântica de cor que o resto da tela usa —
   vermelho é saída, verde é entrada, e isso não pode variar por componente. */
function icoBadge(nome, tom = 'primary', extra = '') {
  const cls = ['ico-badge', 't-' + tom, extra].filter(Boolean).join(' ');
  return `<span class="${cls}" data-ico="${nome}"></span>`;
}
