/* Finanças da Família — ícones SVG inline (traço 2px, estilo Keenthemes/Tabler)
   Sem dependência externa: funciona offline e herda a cor via currentColor. */
'use strict';

const _svg = inner =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const I = {
  home: _svg('<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'),
  list: _svg('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="0.5"/><circle cx="4.5" cy="12" r="0.5"/><circle cx="4.5" cy="18" r="0.5"/>'),
  card: _svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>'),
  target: _svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  settings: _svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
  lock: _svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  shield: _svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  sync: _svg('<polyline points="21 3 21 9 15 9"/><polyline points="3 21 3 15 9 15"/><path d="M4.6 9a8 8 0 0 1 13.2-3L21 9M3 15l3.2 3A8 8 0 0 0 19.4 15"/>'),
  cloud: _svg('<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'),
  plus: _svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  x: _svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check: _svg('<polyline points="20 6 9 17 4 12"/>'),
  chevL: _svg('<polyline points="15 18 9 12 15 6"/>'),
  chevR: _svg('<polyline points="9 18 15 12 9 6"/>'),
  chev: _svg('<polyline points="9 18 15 12 9 6"/>'),
  back: _svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  wallet: _svg('<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5"/><circle cx="16" cy="14" r="1"/>'),
  pie: _svg('<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>'),
  trend: _svg('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'),
  invoice: _svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  calendar: _svg('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  users: _svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  download: _svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  bell: _svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  logout: _svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  trash: _svg('<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>'),
  filter: _svg('<path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/>'),
  tag: _svg('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  search: _svg('<circle cx="11" cy="11" r="7"/><line x1="16.2" y1="16.2" x2="21" y2="21"/>'),
  edit: _svg('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>'),
};

/* Injeta os SVGs em qualquer elemento com data-ico (roda de novo para conteúdo dinâmico). */
function paintIcons(root) {
  (root || document).querySelectorAll('[data-ico]').forEach(el => {
    const svg = I[el.dataset.ico];
    if (svg) el.innerHTML = svg;
  });
}
