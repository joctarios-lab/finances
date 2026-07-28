/* Finanças da Família — UI e fluxo do app */
'use strict';

Sync.load();   // DB.load() acontece dentro de Auth.init(), que decifra os dados quando há PIN

const METHODS = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
const MEMBRO_COMUM = 'Comum / Família';   // usado sempre que o âmbito é Família
const PALETTE = ['#009ef7', '#50cd89', '#7239ea', '#f1416c', '#ffc700', '#43ced7', '#fd7e14', '#8950fc', '#1bc5bd', '#6c7293'];

let state = { tab: 'inicio', monthOffset: 0, repOffset: 0, filtros: null };

/* Filtros do extrato. Os dois primeiros ficam na tela (são os que se usa toda
   hora); o resto vive no painel, para a tela não virar um formulário. Tudo o que
   estiver ativo aparece como etiqueta removível acima da lista, então nenhum
   filtro fica escondido depois de aplicado — é isso que evita o "por que essa
   lista está vazia?" que painéis fechados costumam causar. */
const FILTROS_VAZIOS = {
  busca: '', scope: 'Todos', membro: 'Todos', tipo: 'Todos', situacao: 'Todos',
  categoria: '', tag: '', metodo: '', conta: '', valorMin: '', valorMax: '', recorrente: false,
};

/* Estado de dentro da tela: mês em análise, filtros, aba de relatório.
   É transitório de propósito. Ver março e voltar depois achando que é o mês
   corrente leva a conclusão errada sobre o dinheiro — o risco é grande e o custo
   de reabrir o mês antigo é um toque. Zera ao trocar de tela e ao abrir o app. */
const ESTADO_DA_TELA = { monthOffset: 0, repOffset: 0 };
function zerarEstadoDaTela() {
  Object.assign(state, ESTADO_DA_TELA);
  state.filtros = { ...FILTROS_VAZIOS };
}

/* ---------- Memória da navegação: recarregar volta para a mesma aba ---------- */
const UI_KEY = 'financas.ui.v1';
const TABS = ['inicio', 'extrato', 'cartoes', 'metas', 'relatorios'];
const TITULOS = {
  inicio: 'Painel', extrato: 'Extrato', cartoes: 'Cartões & Contas',
  metas: 'Metas', relatorios: 'Relatórios',
};

/* Etiquetas fixadas: escolha deliberada de quem está lançando uma sequência
   ("estou registrando os gastos da viagem"). Sobrevive a troca de tela e a
   recarregar, ao contrário de mês e filtros, porque não é jeito de olhar a tela —
   é uma decisão que a pessoa tomou e que ela desfaz quando quiser. */
let tagsFixas = [];
const fixarTags = lista => { tagsFixas = (lista || []).slice(0, 5); persistUI(); };
const lerTagsFixas = () => tagsFixas;   // let de módulo: o teste precisa do valor atual

// Só a aba e as etiquetas fixadas são lembradas. Mês e filtros ficam de fora por
// escolha: reabrir o app num mês antigo é o que faz alguém ler o saldo errado.
function persistUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ tab: state.tab, tagsFixas }));
  } catch (_) {}
}

function restoreUI() {
  zerarEstadoDaTela();
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY));
    if (s && TABS.includes(s.tab)) state.tab = s.tab;
    if (s && Array.isArray(s.tagsFixas)) tagsFixas = s.tagsFixas.filter(t => typeof t === 'string');
  } catch (_) {}
}

/* ---------- Utilitários ---------- */
const $ = sel => document.querySelector(sel);
const fmt = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDay = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
const fmtDate = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// tipo: 'ok' (confirmação), 'err' (algo faltou), 'info' (neutro)
function toast(msg, tipo) {
  const t = $('#toast');
  const auto = /✓|criad|salv|registrad|paga|transferid|import|atualizad/i.test(msg) ? 'ok'
    : /informe|escolha|falha|incorret|não |nao /i.test(msg) ? 'err' : 'info';
  t.className = 'toast t-' + (tipo || auto);
  t.textContent = msg;
  t.hidden = false;
  // reinicia a animação de entrada mesmo se o aviso anterior ainda estiver na tela
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function barClass(pct) { return pct >= 90 ? 'bar-red' : pct >= 70 ? 'bar-amber' : 'bar-green'; }

/* ---------- Máscara monetária em tempo real (padrão bancário BR: dígitos entram como centavos) ---------- */
function initMoney(sel, initialValue) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  const set = cents => {
    el.dataset.cents = cents;
    el.value = cents === '' ? '' : (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const initial = Number(initialValue);
  set(initial > 0 ? String(Math.round(initial * 100)) : '');
  el.addEventListener('input', () => {
    const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
    set(digits);
    el.setSelectionRange(el.value.length, el.value.length);   // cursor sempre no fim
  });
  el.addEventListener('focus', () => setTimeout(() => el.setSelectionRange(el.value.length, el.value.length), 0));
}
function moneyVal(sel) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  return el ? (Number(el.dataset.cents) || 0) / 100 : 0;
}

/* ---------- Saldo automático ----------
   Gasto Pago em conta (fora de cartão) debita o saldo; fatura marcada paga debita a conta
   de pagamento do cartão. Edições e exclusões revertem o efeito. */
function adjustBalance(accountId, delta) {
  if (!accountId || !delta) return;
  const a = DB.get('accounts', accountId);
  if (a) DB.upsert('accounts', { ...a, balance: (Number(a.balance) || 0) + delta });
}
function txEffect(t) {
  if (!t || t.status !== 'Pago' || !t.account_id || t.card_id || DB.isTransfer(t)) return 0;
  const v = Number(t.amount) || 0;
  return DB.isExpense(t) ? -v : v;   // despesa debita, receita credita
}

/* Aplica (sinal +1) ou desfaz (sinal −1) o efeito de um lançamento nos saldos.
   Transferência mexe em duas contas: sai de uma e entra na outra. */
function applyTxEffect(t, sinal = 1) {
  if (!t || t.status !== 'Pago') return;
  const v = Number(t.amount) || 0;
  if (DB.isTransfer(t)) {
    if (t.account_id) adjustBalance(t.account_id, -v * sinal);
    if (t.to_account) adjustBalance(t.to_account, v * sinal);
    return;
  }
  adjustBalance(t.account_id, txEffect(t) * sinal);
}

/* Conciliação: corrigir o saldo NÃO reescreve o número em silêncio.
   Lança um "Ajuste de saldo" com a diferença, para que o extrato sempre explique
   o saldo e a correção possa ser auditada, revertida ou classificada depois.
   Ajustes ficam de fora das análises (não são gasto nem renda de verdade). */
function reconcileBalance(account, novoSaldo, descricao) {
  const delta = Number(novoSaldo) - (Number(account.balance) || 0);
  if (Math.abs(delta) < 0.005) return 0;
  const ajuste = {
    description: descricao || 'Ajuste de saldo',
    amount: Math.abs(delta),
    date: todayISO(),
    type: delta > 0 ? 'Receita' : 'Despesa',
    status: 'Pago',
    scope: 'Família',
    member: MEMBRO_COMUM,
    method: 'Ajuste',
    account_id: account.id,
    category_id: null,
    adjustment: true,
  };
  DB.upsert('transactions', ajuste);
  adjustBalance(account.id, txEffect(ajuste));   // o próprio lançamento leva o saldo ao novo valor
  return delta;
}

function catOf(id) { return DB.get('categories', id); }
// Caminho inteiro: "Mercado" sozinho nao diz de qual envelope saiu
function catLabel(id) { const c = catOf(id); return c ? `${DB.categoryIcon(id)} ${DB.categoryPath(id)}` : 'Sem categoria'; }

/* ---------- Navegação ---------- */
function setTab(tab) {
  // Sair da tela e voltar devolve o estado inicial: mês corrente, sem filtro,
  // e do começo da página. Só zera em troca real, para não perder o lugar quando
  // a própria tela se redesenha (sincronização, salvar um lançamento).
  const trocou = state.tab !== tab;
  state.tab = tab;
  if (trocou) {
    zerarEstadoDaTela();
    if (typeof scrollTo === 'function') scrollTo(0, 0);
  }
  document.querySelectorAll('.tab, .side-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

function render() {
  // O período é derivado da data de hoje + dia de início do mês financeiro.
  // Não existe "fechar o mês": ele vira sozinho. O offset serve para revisar meses passados.
  const usaOffset = state.tab === 'extrato' || state.tab === 'inicio';
  const period = DB.monthPeriod(new Date(), usaOffset ? state.monthOffset : 0);

  // O topo nomeia a seção. O mês só aparece nas telas que realmente têm período,
  // e sempre dentro da própria tela, junto das setas que o controlam — evita
  // mostrar um mês em Cartões/Metas (que não são mensais) ou um mês diferente
  // do que a tela de Relatórios está exibindo.
  $('#topbar-month').textContent = TITULOS[state.tab] || 'Painel';
  const views = { inicio: renderInicio, extrato: renderExtrato, cartoes: renderCartoes, metas: renderMetas, relatorios: renderRelatorios };
  refreshIdentity();
  $('#view').innerHTML = views[state.tab](period);
  paintIcons($('#view'));
  if (typeof UI !== 'undefined') UI.enhance($('#view'));
  bindView();
  persistUI();
}

/* ---------- Gráficos SVG (sem bibliotecas, funcionam offline) ---------- */
// Barras verticais com rótulos: series = [{label, value, hint?}], refLine opcional (ex: renda).
/* Colunas de evolução no tempo. Série única: sem legenda (o título já diz o que é),
   ênfase no período atual por TOM (não por opacidade) e rótulos só onde contam. */
function svgBars(series, refLine, opts = {}) {
  const W = 760, H = opts.height || 250;
  const padT = 34, padB = 34, padL = 46, padR = 12;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const valores = series.map(s => s.value);
  const max = niceCeil(Math.max(refLine || 0, ...valores, 1));
  const banda = plotW / series.length;
  const larg = Math.min(24, banda - 10);          // marca fina: nunca preenche a faixa
  const y = v => padT + plotH - (v / max) * plotH;

  const comGasto = valores.filter(v => v > 0);
  const media = comGasto.length ? comGasto.reduce((a, b) => a + b, 0) / comGasto.length : 0;
  const iMax = valores.indexOf(Math.max(...valores));
  const iAtual = series.findIndex(s => s.hint === '#009ef7');

  // Grade: hairline sólida, recessiva, com os valores à esquerda
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, gy = y(v);
    grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="ch-grid"/>' +
      '<text x="' + (padL - 10) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="ch-axis">' +
      (v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : Math.round(v)) + '</text>';
  }

  // Referências: renda (teto) e média do período — linhas finas e sólidas
  let refs = '';
  if (media > 0) {
    const my = y(media);
    refs += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + my.toFixed(1) + '" y2="' + my.toFixed(1) + '" class="ch-avg"/>' +
      '<text x="' + (W - padR) + '" y="' + (my - 7).toFixed(1) + '" text-anchor="end" class="ch-avg-lbl">média ' + fmtShort(media).replace('R$', '').trim() + '</text>';
  }
  if (refLine > 0 && refLine <= max) {
    const ry = y(refLine);
    refs += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ry.toFixed(1) + '" y2="' + ry.toFixed(1) + '" class="ch-ref-line"/>' +
      '<text x="' + (W - padR) + '" y="' + (ry - 7).toFixed(1) + '" text-anchor="end" class="ch-ref">renda ' + fmtShort(refLine).replace('R$', '').trim() + '</text>';
  }

  let marcas = '', rotulos = '', hits = '';
  series.forEach((s, i) => {
    const cx = padL + i * banda + banda / 2;
    const topo = s.value > 0 ? y(s.value) : y(0);
    const base = y(0);
    const alt = Math.max(0, base - topo);
    const atual = i === iAtual;
    const x = cx - larg / 2, r = Math.min(4, alt);   // ponta arredondada, base reta

    if (alt > 0) {
      marcas += '<path d="M' + x.toFixed(1) + ' ' + base.toFixed(1) +
        ' V' + (topo + r).toFixed(1) + ' Q' + x.toFixed(1) + ' ' + topo.toFixed(1) + ' ' + (x + r).toFixed(1) + ' ' + topo.toFixed(1) +
        ' H' + (x + larg - r).toFixed(1) + ' Q' + (x + larg).toFixed(1) + ' ' + topo.toFixed(1) + ' ' + (x + larg).toFixed(1) + ' ' + (topo + r).toFixed(1) +
        ' V' + base.toFixed(1) + ' Z" class="ch-bar' + (atual ? ' ch-bar-on' : '') + '"/>';
    }

    // Rótulo só no período atual e no maior valor — nunca em toda barra
    if (s.value > 0 && (atual || i === iMax)) {
      rotulos += '<text x="' + cx.toFixed(1) + '" y="' + (topo - 10).toFixed(1) + '" text-anchor="middle" class="ch-val">' +
        fmtShort(s.value).replace('R$', '').trim() + '</text>';
    }

    rotulos += '<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle" class="ch-lbl' + (atual ? ' ch-lbl-on' : '') + '">' + esc(s.label) + '</text>';

    // Alvo de hover maior que a marca, cobrindo a faixa inteira
    hits += '<rect x="' + (padL + i * banda).toFixed(1) + '" y="' + padT + '" width="' + banda.toFixed(1) + '" height="' + plotH +
      '" fill="transparent" class="ch-hit"><title>' + esc(s.label) + ': ' + fmt(s.value) + '</title></rect>';
  });

  const baseline = '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" class="ch-base"/>';
  return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Evolução dos gastos por período">' +
    grid + refs + baseline + marcas + rotulos + hits + '</svg>';
}

// Arredonda o topo da escala para um número redondo — deixa a grade legível
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / (exp / 2)) * (exp / 2);
}

/* Donut em SVG: anel espesso com separação entre fatias, rótulo central e legenda. */
function svgDonut(fatias, total, opts = {}) {
  const S = 240, R = 96, W = 30, cx = S / 2, cy = S / 2;   // raio e espessura do anel
  const circ = 2 * Math.PI * R;
  const gap = fatias.length > 1 ? 2.5 : 0;                  // respiro entre fatias
  let offset = 0, aneis = '';
  for (const f of fatias) {
    const frac = total > 0 ? f.value / total : 0;
    const comp = Math.max(0, frac * circ - gap);
    aneis += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${f.color}" stroke-width="${W}"
      stroke-dasharray="${comp.toFixed(2)} ${(circ - comp).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" stroke-linecap="round" class="dn-arc">
      <title>${esc(f.label)}: ${fmt(f.value)} (${Math.round(frac * 100)}%)</title></circle>`;
    offset += frac * circ;
  }
  return `<svg class="donut-svg" viewBox="0 0 ${S} ${S}" role="img">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--ink-3)" stroke-width="${W}"/>
    <g transform="rotate(-90 ${cx} ${cy})">${aneis}</g>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="dn-total">${fmtShort(total).replace('R$', '').trim()}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="dn-cap">${esc(opts.caption || 'no período')}</text>
    ${opts.sub ? `<text x="${cx}" y="${cy + 32}" text-anchor="middle" class="dn-sub">${esc(opts.sub)}</text>` : ''}
  </svg>`;
}

// Barras horizontais com rótulo e valor — para rankings (categoria, membro, método)
function svgRanking(entries, cores) {
  if (!entries.length) return '<div class="empty">Sem dados no período.</div>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  const total = entries.reduce((s, e) => s + e[1], 0);
  return '<div class="rank">' + entries.map(([nome, v], i) => {
    const cor = (cores && cores[i % cores.length]) || PALETTE[i % PALETTE.length];
    return '<div class="rank-row">' +
      '<span class="rank-name" title="' + esc(nome) + '">' + esc(nome) + '</span>' +
      '<span class="rank-bar"><i style="width:' + Math.max(2, v / max * 100).toFixed(1) + '%;background:' + cor + '"></i></span>' +
      '<span class="rank-val">' + fmtShort(v) + '<small>' + (total ? Math.round(v / total * 100) : 0) + '%</small></span>' +
      '</div>';
  }).join('') + '</div>';
}

// Burn-up do mês: gasto acumulado dia a dia vs. trilha ideal do orçamento/renda.
function svgBurnup(period, refLimit) {
  const W = 720, H = 230, padB = 26, padT = 22, padL = 6, padR = 6;
  const plotH = H - padB - padT;
  const totalDias = DB.periodDays(period), decorridos = DB.elapsedDays(period);
  const diario = new Array(totalDias).fill(0);
  for (const t of DB.expensesOf(period)) {
    const i = Math.min(totalDias - 1, Math.max(0, Math.floor((new Date(t.date + 'T12:00:00') - period.start) / 86400000)));
    diario[i] += Number(t.amount) || 0;
  }
  let acc = 0;
  const cum = diario.map(v => (acc += v));
  const gastoHoje = decorridos > 0 ? cum[decorridos - 1] : 0;
  const max = niceCeil(Math.max(refLimit || 0, cum[totalDias - 1], 1));
  const X = i => padL + (i / Math.max(1, totalDias - 1)) * (W - padL - padR);
  const Y = v => padT + plotH - (v / max) * plotH;

  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const gy = Y(max * i / 4);
    grid += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="ch-grid"/>';
    if (i) grid += '<text x="' + padL + '" y="' + (gy - 5).toFixed(1) + '" class="ch-axis">' + fmtShort(max * i / 4).replace('R$', '').trim() + '</text>';
  }

  const pts = [];
  for (let i = 0; i < Math.max(1, decorridos); i++) pts.push(X(i).toFixed(1) + ',' + Y(cum[i]).toFixed(1));
  const linha = 'M' + pts.join('L');
  const area = pts.length > 1
    ? linha + 'L' + X(decorridos - 1).toFixed(1) + ',' + Y(0).toFixed(1) + 'L' + X(0).toFixed(1) + ',' + Y(0).toFixed(1) + 'Z'
    : '';

  const ideal = refLimit > 0
    ? '<line x1="' + X(0) + '" y1="' + Y(0).toFixed(1) + '" x2="' + X(totalDias - 1).toFixed(1) + '" y2="' + Y(refLimit).toFixed(1) + '" class="ch-ref-line"/>' +
      '<text x="' + (W - padR) + '" y="' + (Y(refLimit) - 7).toFixed(1) + '" text-anchor="end" class="ch-ref">trilha ideal</text>'
    : '';

  const dx = X(Math.max(0, decorridos - 1)), dy = Y(gastoHoje);
  const estourou = refLimit > 0 && gastoHoje > refLimit * (decorridos / totalDias);
  return '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img">' +
    '<defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#009ef7" stop-opacity=".28"/>' +
    '<stop offset="100%" stop-color="#009ef7" stop-opacity="0"/></linearGradient></defs>' +
    grid + ideal +
    (area ? '<path d="' + area + '" fill="url(#gArea)"/>' : '') +
    '<path d="' + linha + '" fill="none" stroke="' + (estourou ? '#f1416c' : '#009ef7') + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + dx.toFixed(1) + '" cy="' + dy.toFixed(1) + '" r="6" fill="#fff" stroke="' + (estourou ? '#f1416c' : '#009ef7') + '" stroke-width="3"/>' +
    '<text x="' + Math.min(W - padR, dx + 12).toFixed(1) + '" y="' + Math.max(16, dy - 12).toFixed(1) + '" class="ch-val" text-anchor="' + (dx > W - 120 ? 'end' : 'start') + '">' + fmtShort(gastoHoje).replace('R$', '').trim() + '</text>' +
    '<text x="' + padL + '" y="' + (H - 8) + '" class="ch-lbl">dia 1</text>' +
    '<text x="' + (W - padR) + '" y="' + (H - 8) + '" text-anchor="end" class="ch-lbl">dia ' + totalDias + '</text>' +
    '</svg>';
}

/* ---------- Situação financeira (conceitos: disponível real, run-rate, 50/30/20, reserva) ---------- */
function healthOf(stats, refLimit, available) {
  if (available < 0) return { label: 'Crítico', cls: 'red', msg: 'Comprometido maior que o saldo — reveja as próximas contas.' };
  if (refLimit > 0) {
    if (stats.projection > refLimit * 1.1) return { label: 'Crítico', cls: 'red', msg: 'Ritmo de gasto bem acima do limite do mês.' };
    if (stats.projection > refLimit) return { label: 'Atenção', cls: 'amber', msg: 'Nesse ritmo o mês fecha acima do planejado.' };
  }
  return { label: 'Saudável', cls: 'green', msg: 'Gastos sob controle no ritmo atual.' };
}

/* ---------- Início ---------- */
function renderInicio(period) {
  const txs = DB.expensesOf(period);
  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const saldo = contas.reduce((s, a) => s + Number(a.balance || 0), 0);

  const stats = DB.statsFor(period);
  const committed = DB.committed();
  const available = saldo - committed;
  const realized = DB.realizedIncome(period);              // receitas realmente lançadas
  const income = realized > 0 ? realized : (Number(DB.settings().monthly_income) || 0);
  const budgetTotal = DB.budgetTotal();
  const refLimit = income > 0 ? income : budgetTotal;
  const health = healthOf(stats, refLimit, available);

  let openInvoices = 0, upcoming = [];
  for (const card of DB.all('cards').filter(c => c.active !== false)) {
    for (const inv of DB.invoicesOf(card)) {
      if (inv.status !== 'Paga') { openInvoices += inv.total; upcoming.push(inv); }
    }
  }
  upcoming.sort((a, b) => a.due - b.due);

  const goals = DB.all('goals').filter(g => !g.done);
  const avgPct = goals.length
    ? Math.round(goals.reduce((s, g) => s + Math.min(100, DB.goalTotal(g.id) / (g.target_amount || 1) * 100), 0) / goals.length)
    : 0;

  // Donut por categoria
  const byCat = DB.spentByCategory(period);
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  let donut = '', legend = '';
  if (total > 0) {
    // Até 6 fatias; o excedente vira "Outras" para o anel não virar confete
    const TOP = 6;
    const fatias = entries.slice(0, TOP).map(([cid, v], i) => ({
      label: catLabel(cid === '_sem' ? null : cid), value: v, color: PALETTE[i % PALETTE.length],
    }));
    const resto = entries.slice(TOP).reduce((s, [, v]) => s + v, 0);
    if (resto > 0) fatias.push({ label: `Outras ${entries.length - TOP} categorias`, value: resto, color: '#c4cad4' });

    const maior = fatias[0];
    legend = fatias.map(f => `<div class="legend-row">
      <i class="legend-dot" style="background:${f.color}"></i>
      <span class="legend-name">${esc(f.label)}</span>
      <span class="legend-pct">${Math.round(f.value / total * 100)}%</span>
      <span class="legend-val">${fmtShort(f.value)}</span>
    </div>`).join('');

    donut = `<div class="donut-wrap">
      ${svgDonut(fatias, total, { caption: 'gasto no período', sub: `${txs.length} lançamentos` })}
      <div class="legend">${legend}</div>
    </div>
    <div class="chart-foot">
      <span>Maior peso: <b>${esc(maior.label)}</b> com ${Math.round(maior.value / total * 100)}% do total</span>
      <span>${entries.length} categoria(s) com gasto</span>
    </div>`;
  } else {
    donut = `<div class="empty"><b>Nenhum gasto no período</b>Toque no ＋ para lançar o primeiro.</div>`;
  }

  // Barras de orçamento (gasto do período vs orçamento mensal).
  // Tocar numa barra abre o detalhe: saber que "Alimentação" estourou só ajuda
  // quando dá para ver se foi mercado ou delivery.
  let budgets = '';
  for (const c of DB.rootCategories('Despesa').sort((a, b) => (byCat[b.id] || 0) - (byCat[a.id] || 0))) {
    const spent = byCat[c.id] || 0;
    if (!c.monthly_budget && !spent) continue;
    const pct = c.monthly_budget > 0 ? Math.round(spent / c.monthly_budget * 100) : 0;
    const detalhavel = spent > 0 && DB.subcategoriesOf(c.id).length > 0;
    budgets += `<div class="budget-row${detalhavel ? ' clicavel' : ''}"${detalhavel ? ` data-envelope="${c.id}"` : ''}>
      <div class="budget-head"><b>${esc(c.icon)} ${esc(c.name)}${detalhavel ? ' <span class="chev-min" data-ico="chev"></span>' : ''}</b>
        <span class="num">${fmtShort(spent)}${c.monthly_budget ? ` <span class="muted">/ ${fmtShort(c.monthly_budget)} · ${pct}%</span>` : ''}</span></div>
      <div class="bar ${barClass(pct)}"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
  }

  let venc = '';
  for (const inv of upcoming.slice(0, 3)) {
    venc += `<div class="invoice-row">
      <span>💳 ${esc(inv.card.name)}</span>
      <span class="badge ${inv.status.toLowerCase()}">${inv.status}</span>
      <span style="flex:1"></span>
      <span class="muted">vence ${fmtDate(inv.due)}</span>
      <span class="num">${fmtShort(inv.total)}</span>
    </div>`;
  }

  // --- Projeção de fim de mês (run-rate) ---
  const projPct = refLimit > 0 ? Math.round(stats.projection / refLimit * 100) : 0;
  const savingsRate = income > 0 ? Math.round((income - stats.projection) / income * 100) : null;
  const projCard = `
    <div class="card">
      <div class="card-head"><div><b>Projeção do mês</b><small>no ritmo atual de gastos (${fmtShort(stats.dailyAvg)}/dia)</small></div><span class="kpi-ico t-warning" data-ico="calendar" style="width:34px;height:34px;margin:0"></span></div>
      ${realized > 0 ? `<div class="proj-row"><span>Receitas lançadas no período</span><b class="txt-green">${fmtShort(realized)}</b></div>` : ''}
      <div class="proj-row"><span>Gasto até hoje (dia ${stats.elapsedDays} de ${stats.totalDays})</span><b>${fmtShort(stats.spent)}</b></div>
      <div class="proj-row"><span>Fechamento projetado</span><b class="${refLimit > 0 && stats.projection > refLimit ? 'txt-red' : 'txt-green'}">${fmtShort(stats.projection)}</b></div>
      ${refLimit > 0 ? `
        <div class="bar ${barClass(projPct)}" style="margin:8px 0 4px"><i style="width:${Math.min(100, projPct)}%"></i></div>
        <div class="proj-row muted"><span>${projPct}% ${income > 0 ? (realized > 0 ? 'das receitas do período' : 'da renda familiar') : 'do orçamento total'} (${fmtShort(refLimit)})</span>
        ${savingsRate !== null ? `<span>Poupança projetada: <b class="${savingsRate >= 20 ? 'txt-green' : savingsRate >= 0 ? 'txt-amber' : 'txt-red'}">${savingsRate}%</b></span>` : ''}</div>
      ` : `<p class="muted" style="margin-top:6px">Cadastre a renda familiar em Configurações → Membros &amp; ciclo para ver % da renda e taxa de poupança (especialistas recomendam poupar ≥ 20%).</p>`}
    </div>`;

  // --- 50/30/20 (Necessidades / Desejos / Poupança) ---
  let rule5030 = '';
  if (income > 0) {
    const byKind = DB.spentByKind(period);
    const nPct = Math.round(byKind.Essencial / income * 100);
    const wPct = Math.round(byKind.Estilo / income * 100);
    const sPct = Math.max(0, 100 - nPct - wPct);
    const row = (nome, pct, alvo, cls) => `
      <div class="budget-row">
        <div class="budget-head"><b>${nome}</b><span class="num">${pct}% <span class="muted">/ alvo ${alvo}%</span></span></div>
        <div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>
      </div>`;
    rule5030 = `
      <div class="card">
        <div class="card-head"><div><b>Regra 50 · 30 · 20</b><small>necessidades, desejos e poupança como % da renda</small></div></div>
        ${row('Necessidades', nPct, 50, nPct > 50 ? 'bar-red' : 'bar-green')}
        ${row('Desejos', wPct, 30, wPct > 30 ? 'bar-red' : 'bar-green')}
        ${row('Poupança (sobra)', sPct, 20, sPct < 20 ? 'bar-amber' : 'bar-green')}
      </div>`;
  }

  // --- Reserva de emergência (cobertura em meses) ---
  const reserve = DB.reserveTotal();
  const avgSpend = DB.avgMonthlySpend();
  const coverage = avgSpend > 0 ? reserve / avgSpend : 0;
  const covPct = Math.min(100, Math.round(coverage / 6 * 100));
  const reserveGoal = DB.reserveGoals()[0];
  const alvoReserva = reserveGoal && reserveGoal.target_amount ? Number(reserveGoal.target_amount) : avgSpend * 6;
  const faltaReserva = Math.max(0, alvoReserva - reserve);
  const reserveCard = `
    <div class="card">
      <div class="card-head"><div><b>Reserva de emergência</b><small>uma caixinha: o quanto vocês já separaram, esteja onde estiver</small></div><span class="kpi-ico t-success" data-ico="shield" style="width:34px;height:34px;margin:0"></span></div>
      ${!reserveGoal ? `
        <div class="empty" style="padding:14px 4px"><b>Reserva ainda não criada</b>
        A reserva é uma caixinha alimentada por depósitos — não fica presa a uma conta.
        ${avgSpend > 0 ? `Pelo gasto médio de ${fmtShort(avgSpend)}/mês, o ideal são <b>${fmtShort(avgSpend * 6)}</b> (6 meses).` : ''}</div>
        <button class="btn" id="btn-criar-reserva">Criar minha reserva de emergência</button>
      ` : `
        <div class="proj-row"><span>Guardado</span><b>${fmtShort(reserve)}</b></div>
        <div class="proj-row"><span>Cobre</span><b class="${coverage >= 6 ? 'txt-green' : coverage >= 3 ? 'txt-amber' : 'txt-red'}">${coverage.toFixed(1)} ${coverage === 1 ? 'mês' : 'meses'}</b></div>
        <div class="bar ${coverage >= 6 ? 'bar-green' : coverage >= 3 ? 'bar-amber' : 'bar-red'}" style="margin:8px 0 4px"><i style="width:${covPct}%"></i></div>
        <p class="muted">Recomendação clássica: 3 a 6 meses do gasto médio (${fmtShort(avgSpend)}/mês)${faltaReserva > 0 ? ` — faltam <b>${fmtShort(faltaReserva)}</b>` : ' — objetivo alcançado 🎉'}.</p>
        <div class="btn-row">
          <button class="btn ghost" data-aporte="${reserveGoal.id}">＋ Guardar dinheiro</button>
          <button class="btn ghost" data-goal-detail="${reserveGoal.id}">Ver depósitos</button>
        </div>
      `}
    </div>`;

  // --- Conselheiro: insights automáticos por regras de especialista ---
  const tips = [];
  if (available < 0) tips.push({ cls: 'red', txt: `Compromissos superam o saldo em ${fmtShort(-available)} — priorize quitar ou remanejar.` });
  for (const c of DB.rootCategories('Despesa')) {
    if (!c.monthly_budget) continue;
    const pct = Math.round((byCat[c.id] || 0) / c.monthly_budget * 100);
    const pace = Math.round(stats.elapsedDays / Math.max(stats.totalDays, 1) * 100);
    if (pct >= 100) tips.push({ cls: 'red', txt: `${c.icon} ${c.name} estourou o orçamento (${pct}%).` });
    else if (pct >= 80 && pct > pace + 15) tips.push({ cls: 'amber', txt: `${c.icon} ${c.name} já usou ${pct}% do orçamento no dia ${stats.elapsedDays} — freie o ritmo.` });
  }
  for (const card of DB.all('cards').filter(c => c.active !== false && c.limit_amount > 0)) {
    const cur = DB.invoicesOf(card).find(i => i.key === DB.invoiceKeyFor(card, todayISO()));
    if (cur && cur.total / card.limit_amount >= 0.8) tips.push({ cls: 'amber', txt: `Fatura do ${card.name} em ${Math.round(cur.total / card.limit_amount * 100)}% do limite.` });
  }
  if (savingsRate !== null && savingsRate < 20) tips.push({ cls: savingsRate < 0 ? 'red' : 'amber', txt: `Poupança projetada em ${savingsRate}% da renda — o recomendado é guardar pelo menos 20%.` });
  if (coverage < 3 && avgSpend > 0) tips.push({ cls: 'amber', txt: `Reserva cobre ${coverage.toFixed(1)} meses — abaixo do mínimo recomendado de 3.` });
  for (const g of goals) {
    if (DB.goalPace(g.id) === 0 && DB.goalTotal(g.id) < (g.target_amount || 0)) tips.push({ cls: 'amber', txt: `Meta "${g.name}" sem aportes há 90 dias.` });
  }
  if (!tips.length) tips.push({ cls: 'green', txt: 'Nenhum alerta: orçamento, faturas, reserva e metas dentro do esperado. Continue assim! 👏' });
  const adviceCard = `
    <div class="card">
      <div class="card-head"><div><b>Conselheiro</b><small>análise automática da sua situação</small></div><span class="kpi-ico t-info" data-ico="bell" style="width:34px;height:34px;margin:0"></span></div>
      ${tips.slice(0, 5).map(t => `<div class="tip tip-${t.cls}">${esc(t.txt)}</div>`).join('')}
    </div>`;

  // Primeiro uso: guia de configuração em vez de um painel vazio
  const faltando = [];
  if (!contas.length) faltando.push({ go: 'accounts', txt: 'Cadastrar suas contas e saldos' });
  if (!DB.all('cards').length) faltando.push({ go: 'cards', txt: 'Cadastrar cartões de crédito (fechamento e vencimento)' });
  if (!DB.settings().monthly_income) faltando.push({ go: 'family', txt: 'Informar a renda mensal da família' });
  if (!DB.all('transactions').length) faltando.push({ go: 'ofx', txt: 'Importar o extrato do banco (ou lançar no + )' });
  const setupCard = faltando.length ? `
    <div class="card">
      <div class="card-head"><div><b>Deixe o app com a sua cara</b><small>faltam ${faltando.length} passo(s) para as análises ficarem completas</small></div></div>
      ${faltando.map(f => `<div class="settings-item" data-setup="${f.go}"><span class="cfg-left"><span class="cfg-ico" data-ico="check"></span><span>${f.txt}</span></span><span class="chev" data-ico="chev"></span></div>`).join('')}
    </div>` : '';

  // Barra de período: deixa explícito o intervalo e permite revisar meses fechados
  const fimExibido = new Date(period.end.getTime() - 86400000);
  const atual = state.monthOffset === 0;
  const periodBar = `
    <div class="card month-nav">
      <button id="mn-prev" aria-label="Mês anterior" data-ico="chevL"></button>
      <div style="text-align:center">
        <b>${period.label}</b>
        <div class="muted" style="font-size:11.5px">${period.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a ${fimExibido.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${atual ? ` · dia ${stats.elapsedDays} de ${stats.totalDays}` : ' · encerrado'}</div>
      </div>
      <button id="mn-next" aria-label="Próximo mês" data-ico="chevR" ${atual ? 'disabled style="opacity:.35"' : ''}></button>
    </div>`;

  // Mês encerrado: o "disponível hoje" não faz sentido — mostra o resultado daquele mês
  const resultado = realized - stats.spent;
  const heroFechado = `
    <div class="hero hero-${resultado >= 0 ? 'green' : 'red'}">
      <div class="hero-top">
        <span class="hero-label">Resultado de ${esc(period.label)}</span>
        <span class="hero-badge b-${resultado >= 0 ? 'green' : 'red'}">${resultado >= 0 ? 'Sobrou' : 'Faltou'}</span>
      </div>
      <div class="hero-value">${fmt(Math.abs(resultado))}</div>
      <p class="hero-msg">${realized > 0 ? 'Receitas menos despesas do período.' : 'Sem receitas lançadas neste período — o valor mostra o total gasto.'}</p>
      <div class="hero-stats">
        <div><small>Receitas</small><b>${fmtShort(realized)}</b></div>
        <div><small>Despesas</small><b>${fmtShort(stats.spent)}</b></div>
        <div><small>Lançamentos</small><b>${txs.length}</b></div>
      </div>
    </div>`;

  const heroAtual = `
    <div class="hero hero-${health.cls}">
      <div class="hero-top">
        <span class="hero-label">Disponível para usar</span>
        <span class="hero-badge b-${health.cls}">${health.label}</span>
      </div>
      <div class="hero-value">${fmt(available)}</div>
      <p class="hero-msg">${health.msg}</p>
      <div class="hero-stats">
        <div><small>Em contas</small><b>${fmtShort(saldo)}</b></div>
        <div><small>Comprometido</small><b>${fmtShort(committed)}</b></div>
        <div><small>Gasto previsto</small><b>${fmtShort(stats.projection)}</b></div>
      </div>
    </div>`;

  return `
    ${setupCard}
    ${periodBar}
    ${atual ? heroAtual : heroFechado}
    ${adviceCard}
    <div class="kpi-grid">
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmtShort(total)}</div><div class="kpi-label">Gasto do mês</div><div class="kpi-sub">${txs.length} lançamentos</div></div>
      <div class="card kpi"><span class="kpi-ico t-danger" data-ico="invoice"></span><div class="kpi-value ${openInvoices ? 'red' : 'green'}">${fmtShort(openInvoices)}</div><div class="kpi-label">Faturas em aberto</div><div class="kpi-sub">${upcoming.length} fatura(s)</div></div>
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value green">${fmtShort(saldo)}</div><div class="kpi-label">Saldo em contas</div><div class="kpi-sub">${contas.length} conta(s)</div></div>
      <div class="card kpi"><span class="kpi-ico t-info" data-ico="target"></span><div class="kpi-value">${avgPct}%</div><div class="kpi-label">Metas (média)</div><div class="kpi-sub">${goals.length} em andamento</div></div>
    </div>
    <div class="grid-2">
      ${projCard}
      ${reserveCard}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Evolução dos gastos</b><small>últimos 6 períodos${income > 0 ? ' · linha tracejada = renda' : ''}</small></div></div>
        ${svgBars(
          Array.from({ length: 6 }, (_, i) => {
            const p = DB.monthPeriod(new Date(), i - 5);
            const v = DB.expensesOf(p).reduce((s, t) => s + (Number(t.amount) || 0), 0);
            return { label: p.start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), value: v, hint: i === 5 ? '#009ef7' : '#a6d9f7' };
          }), income)}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Ritmo do mês</b><small>gasto acumulado vs. trilha ideal do ${income > 0 ? 'da renda' : 'orçamento'}</small></div></div>
        ${svgBurnup(period, refLimit)}
        <p class="muted" style="margin-top:4px">Se a linha azul cruzar a tracejada antes do fim do mês, o limite estoura.</p>
      </div>
    </div>
    ${rule5030}
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Para onde foi o dinheiro</b><small>distribuição do período por categoria</small></div><span class="kpi-ico t-primary" data-ico="pie" style="width:34px;height:34px;margin:0"></span></div>
        ${donut}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Orçamento por categoria</b><small>quanto do limite mensal já foi usado</small></div></div>
        <div class="budget-scroll">${budgets || '<div class="empty">Defina orçamentos em Configurações → Categorias.</div>'}</div>
        ${budgets ? `<div class="chart-foot">
          <span>Orçado <b>${fmtShort(budgetTotal)}</b></span>
          <span>Usado <b>${fmtShort(total)}</b></span>
          <span>Restante <b class="${budgetTotal - total >= 0 ? 'txt-green' : 'txt-red'}">${fmtShort(budgetTotal - total)}</b></span>
        </div>` : ''}
      </div>
    </div>
    ${venc ? `<p class="section-title">Próximos vencimentos</p>${venc}` : ''}
    <button class="btn ghost" id="go-reports" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="pie"></span>Ver relatórios completos</button>
  `;
}

/* ---------- Extrato ---------- */
/* Um pipeline só de filtros: a lista e os totais do cabeçalho saem daqui, então
   o valor no topo sempre corresponde ao que está listado embaixo. Antes a busca
   apenas escondia linhas pelo CSS, e o total continuava contando o que sumiu. */
function filtrosAtivos() {
  const f = state.filtros || FILTROS_VAZIOS;
  const rotulos = [];
  const add = (chave, texto) => rotulos.push({ chave, texto });
  if (f.busca) add('busca', `“${f.busca}”`);
  if (f.scope !== 'Todos') add('scope', f.scope);
  if (f.membro !== 'Todos') add('membro', f.membro === MEMBRO_COMUM ? 'Comum' : f.membro);
  if (f.tipo !== 'Todos') add('tipo', f.tipo);
  if (f.situacao !== 'Todos') add('situacao', f.situacao);
  if (f.categoria) add('categoria', DB.categoryPath(f.categoria) || 'Categoria');
  if (f.tag) add('tag', '#' + f.tag);
  if (f.metodo) add('metodo', f.metodo);
  if (f.conta) {
    const a = DB.get('accounts', f.conta) || DB.get('cards', f.conta);
    add('conta', (a && a.name) || 'Conta');
  }
  if (f.valorMin) add('valorMin', `a partir de ${fmtShort(f.valorMin)}`);
  if (f.valorMax) add('valorMax', `até ${fmtShort(f.valorMax)}`);
  if (f.recorrente) add('recorrente', 'Só custos fixos');
  return rotulos;
}

function txsFiltradas(period) {
  const f = state.filtros || FILTROS_VAZIOS;
  const busca = DB._semAcento(f.busca);
  return DB.txOfPeriod(period).filter(t => {
    if (f.scope !== 'Todos' && t.scope !== f.scope) return false;
    if (f.membro !== 'Todos' && (t.member || MEMBRO_COMUM) !== f.membro) return false;
    if (f.tipo !== 'Todos') {
      const tipo = DB.isTransfer(t) ? 'Transferência' : DB.isExpense(t) ? 'Despesa' : 'Receita';
      if (tipo !== f.tipo) return false;
    }
    if (f.situacao !== 'Todos' && t.status !== f.situacao) return false;
    // Categoria filtra pelo envelope: escolher "Alimentação" traz mercado e delivery
    if (f.categoria && DB.categoryRootId(t.category_id) !== DB.categoryRootId(f.categoria)) return false;
    if (f.tag && !DB.tagsOf(t).includes(f.tag)) return false;
    if (f.metodo && t.method !== f.metodo) return false;
    if (f.conta && t.account_id !== f.conta && t.card_id !== f.conta && t.to_account !== f.conta) return false;
    if (f.valorMin && Number(t.amount) < Number(f.valorMin)) return false;
    if (f.valorMax && Number(t.amount) > Number(f.valorMax)) return false;
    if (f.recorrente && !t.recurring) return false;
    if (busca) {
      const alvo = DB._semAcento([
        t.description, t.notes, t.member, t.method, t.installment,
        DB.categoryPath(t.category_id), DB.tagsOf(t).join(' '),
      ].join(' '));
      if (!alvo.includes(busca)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function renderExtrato(period) {
  if (!state.filtros) state.filtros = { ...FILTROS_VAZIOS };
  const ativos = filtrosAtivos();
  const txs = txsFiltradas(period);
  const total = txs.filter(t => DB.isExpense(t) && !t.adjustment).reduce((s, t) => s + Number(t.amount || 0), 0);
  const receitas = txs.filter(t => !DB.isExpense(t) && !t.card_id && !t.adjustment).reduce((s, t) => s + Number(t.amount || 0), 0);

  let list = '', lastDay = '';
  for (const t of txs) {
    if (t.date !== lastDay) { lastDay = t.date; list += `<p class="tx-day">${fmtDay(t.date)}</p>`; }
    const c = catOf(t.category_id);
    const via = t.method === 'Cartão de Crédito'
      ? `💳 ${esc((DB.get('cards', t.card_id) || {}).name || 'Cartão')}`
      : esc(t.method);
    const isExp = DB.isExpense(t);
    const isTr = DB.isTransfer(t);
    const rota = isTr
      ? `${esc((DB.get('accounts', t.account_id) || {}).name || '?')} → ${esc((DB.get('accounts', t.to_account) || {}).name || '?')}`
      : '';
    list += `<div class="tx ${DB.isNeutral(t) ? 'tx-adj' : ''}" data-tx="${t.id}">
      <span class="tx-ico ${isTr ? 'i-transfer' : !isExp && !t.adjustment ? 'i-receita' : ''}">${isTr ? '⇄' : t.adjustment ? '⚖️' : isExp ? esc(c ? c.icon : '🧾') : '💵'}</span>
      <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
      <span class="tx-meta">${isTr ? `Transferência · ${rota}`
        : t.adjustment ? 'Conciliação — fora das análises · toque para classificar'
        : `${c ? esc(DB.categoryPath(t.category_id)) : (isExp ? 'Sem categoria' : 'Entrada sem origem')} · ${via}${t.member ? ' · ' + esc(t.member) : ''}${t.installment ? ' · parcela ' + esc(t.installment) : ''}`}</span>
      ${DB.tagsOf(t).length ? `<span class="tx-tags">${DB.tagsOf(t).map(tg =>
        `<button class="tx-tag" data-tag="${esc(tg)}" title="Filtrar por #${esc(tg)}">#${esc(tg)}</button>`).join('')}</span>` : ''}</span>
      <span class="tx-amount ${isTr ? 'transfer' : !isExp ? 'income' : t.status === 'A Pagar' ? 'pending' : ''}">${isTr ? '' : isExp ? '− ' : '+ '}${fmt(t.amount)}</span>
      ${t.status === 'A Pagar' ? `<button class="pay-btn" data-pay-tx="${t.id}" title="Marcar como ${isExp ? 'pago' : 'recebido'}"><span data-ico="check"></span></button>` : ''}
    </div>`;
  }
  // Vazio com filtro ativo é ambíguo: pode ser que não haja nada, ou que o filtro
  // esteja escondendo tudo. A mensagem diz qual dos dois é, e oferece a saída.
  if (!txs.length) {
    list = ativos.length
      ? `<div class="empty"><b>Nenhum lançamento com esses filtros</b>Há ${DB.txOfPeriod(period).length} no período. <button class="btn ghost" id="limpar-vazio" style="margin-top:10px">Limpar os filtros</button></div>`
      : `<div class="empty"><b>Sem lançamentos</b>Nada registrado neste período ainda.</div>`;
  }

  const st = DB.statsFor(period);
  const isCurrent = state.monthOffset === 0;
  return `
    <div class="card month-nav">
      <button id="mn-prev" aria-label="Mês anterior" data-ico="chevL"></button>
      <b>${period.label} · ${fmtShort(total)}</b>
      <button id="mn-next" aria-label="Próximo mês" data-ico="chevR"></button>
    </div>
    <div class="mini-stats">
      <div class="card"><small>Receitas</small><b class="txt-green">${fmtShort(receitas)}</b></div>
      <div class="card"><small>Média/dia</small><b>${fmtShort(st.dailyAvg)}</b></div>
      <div class="card"><small>${isCurrent ? 'Projeção' : 'Total'}</small><b>${fmtShort(isCurrent ? st.projection : st.spent)}</b></div>
    </div>
    <div class="quick-add">
      <button class="qa qa-desp" data-novo="Despesa"><span data-ico="plus"></span>Despesa</button>
      <button class="qa qa-rec" data-novo="Receita"><span data-ico="plus"></span>Receita</button>
      <button class="qa qa-tr" data-novo="Transferência"><span data-ico="sync"></span>Transferir</button>
    </div>

    <!-- Na tela ficam só a busca e o atalho de âmbito, que é o filtro do dia a dia.
         O resto abre no painel, para o extrato continuar sendo uma lista. -->
    <div class="busca-row">
      <input id="tx-search" type="search" placeholder="Buscar descrição, categoria, etiqueta…" autocomplete="off" value="${esc(state.filtros.busca)}">
      <button class="btn-filtros ${ativos.length ? 'tem' : ''}" id="btn-filtros">
        <span data-ico="filter"></span>Filtros${ativos.length ? `<span class="filtros-num">${ativos.length}</span>` : ''}
      </button>
    </div>
    <div class="filter-row">
      <div class="chips" id="scope-chips">
        ${['Todos', 'Família', 'Pessoal'].map(f => `<button class="chip ${state.filtros.scope === f ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>
    </div>
    ${ativos.length ? `<div class="ativos">
      ${ativos.map(a => `<button class="tag-ativa" data-limpa="${a.chave}">${esc(a.texto)}<span>×</span></button>`).join('')}
      <button class="tag-limpar" id="limpar-filtros">Limpar tudo</button>
    </div>` : ''}
    ${isCurrent ? '<button class="btn ghost" id="btn-recur" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="sync"></span>Lançar custos fixos deste mês</button>' : ''}
    <div id="tx-list">${list}</div>
  `;
}

/* ---------- Cartões ---------- */
function renderCartoes() {
  const cards = DB.all('cards').filter(c => c.active !== false);
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const totalContas = contas.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const contasHtml = `
    <div class="card">
      <div class="card-head">
        <div><b>Contas e saldos</b><small>toque em uma conta para atualizar o saldo</small></div>
        <span class="num" style="font-size:17px">${fmtShort(totalContas)}</span>
      </div>
      ${contas.length ? contas.map(a => `
        <div class="acc-row" data-acc="${a.id}">
          <span class="acc-ico">${a.type === 'Caixinha / Rendimento' ? '🐷' : a.type === 'Investimento' ? '📈' : a.type === 'Carteira Digital' ? '📱' : '🏦'}</span>
          <span class="acc-info"><b>${esc(a.name)}</b><small>${esc(a.type)}${a.institution ? ' · ' + esc(a.institution) : ''}</small></span>
          <span class="num">${fmt(a.balance)}</span>
        </div>`).join('') : '<div class="empty">Nenhuma conta cadastrada. Adicione em Configurações → Contas.</div>'}
      ${contas.length > 1 ? '<button class="btn ghost" id="btn-transfer" style="margin-top:10px">⇄ Transferir entre contas</button>' : ''}
      <button class="btn ghost" data-setup="accounts" style="margin-top:8px">Gerenciar contas</button>
    </div>`;

  if (!cards.length) {
    return contasHtml + `<div class="card"><div class="empty"><b>Nenhum cartão cadastrado</b>Cadastre seus cartões para o app controlar faturas e parcelas automaticamente.</div>
      <button class="btn ghost" id="go-cards">Cadastrar cartão</button></div>`;
  }

  const committed = DB.committed();
  let html = contasHtml + (committed > 0 ? `
    <div class="card">
      <div class="card-head" style="margin-bottom:4px"><div><b>Compromissos futuros</b><small>faturas não pagas + contas a pagar — já descontados do seu disponível</small></div>
      <span class="num txt-red" style="font-size:18px">${fmtShort(committed)}</span></div>
    </div>` : '');
  for (const card of cards) {
    const invoices = DB.invoicesOf(card);
    const currentKey = DB.invoiceKeyFor(card, todayISO());
    const open = invoices.find(i => i.key === currentKey) || { total: 0, status: 'Aberta', ...(() => { const d = DB.invoiceDates(card, currentKey); return d; })() };
    const usePct = card.limit_amount > 0 ? Math.round(open.total / card.limit_amount * 100) : 0;

    let invList = '';
    for (const inv of invoices.slice(-6).reverse()) {
      invList += `<div class="invoice-row">
        <span class="badge ${inv.status.toLowerCase()}">${inv.status}</span>
        <span class="muted">fecha ${fmtDate(inv.closing)} · vence ${fmtDate(inv.due)}</span>
        <span style="flex:1"></span>
        <button class="link-btn" data-inv-detail="${inv.key}">${inv.count} itens</button>
        <span class="num">${fmtShort(inv.total)}</span>
        ${inv.status !== 'Paga'
          ? `<button class="link-btn" data-pay="${inv.key}">marcar paga</button>`
          : `<button class="link-btn" data-unpay="${inv.key}">↺</button>`}
      </div>`;
    }

    html += `
      <div class="credit-card">
        <div class="cc-head"><span class="cc-name">${esc(card.name)}</span><span class="cc-brand">${esc(card.brand || '')}</span></div>
        <div class="cc-invoice"><div class="cc-invoice-label">Fatura atual (${open.status})</div>
        <div class="cc-invoice-val">${fmt(open.total)}</div></div>
        <div class="cc-dates"><span>Fecha dia ${card.closing_day}</span><span>Vence dia ${card.due_day}</span></div>
        ${card.limit_amount ? `<div class="cc-limit">
          <div class="budget-head"><span class="muted">Uso do limite</span><span class="num">${usePct}% <span class="muted">de ${fmtShort(card.limit_amount)}</span></span></div>
          <div class="bar ${barClass(usePct)}"><i style="width:${Math.min(100, usePct)}%"></i></div></div>` : ''}
      </div>
      ${invList ? `<p class="section-title">Faturas — ${esc(card.name)}</p>${invList}` : ''}
    `;
  }
  return html;
}

/* ---------- Metas ---------- */
function renderMetas() {
  const goals = DB.all('goals');
  let html = `<button class="btn ghost" id="btn-new-goal">＋ Nova meta</button>`;
  if (!goals.length) html += `<div class="empty"><b>Nenhuma meta ainda</b>Crie a primeira: reserva de emergência, viagem, troca de carro…</div>`;
  for (const g of goals.sort((a, b) => Number(a.done) - Number(b.done))) {
    const total = DB.goalTotal(g.id);
    const pct = g.target_amount > 0 ? Math.round(total / g.target_amount * 100) : 0;
    const entries = DB.all('goal_entries').filter(e => e.goal_id === g.id).sort((a, b) => b.date.localeCompare(a.date));

    // Preditivo: ritmo de aportes → previsão de conclusão; e quanto/mês para cumprir a data alvo.
    let forecast = '';
    const remaining = Math.max(0, (Number(g.target_amount) || 0) - total);
    if (!g.done && remaining > 0) {
      const pace = DB.goalPace(g.id);
      if (pace > 0) {
        const eta = new Date(Date.now() + (remaining / pace) * 30.44 * 86400000);
        const etaLabel = eta.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        forecast += `<div class="muted" style="margin-top:8px">📈 Ritmo: <b>${fmtShort(pace)}/mês</b> → conclusão prevista em <b>${etaLabel}</b></div>`;
      } else {
        forecast += `<div class="muted" style="margin-top:8px">📈 Sem aportes nos últimos 90 dias — a meta está parada.</div>`;
      }
      if (g.target_date) {
        const monthsLeft = Math.max(0.5, (new Date(g.target_date) - Date.now()) / (30.44 * 86400000));
        const needed = remaining / monthsLeft;
        const pace90 = DB.goalPace(g.id);
        forecast += `<div class="muted">🎯 Para cumprir até ${fmtDay(g.target_date)}: <b class="${pace90 >= needed ? 'txt-green' : 'txt-amber'}">${fmtShort(needed)}/mês</b></div>`;
      }
    }
    html += `
    <div class="card goal-card">
      <div class="goal-head"><span class="goal-ico">${esc(g.icon)}</span>
        <span class="goal-name">${esc(g.name)}${g.done ? ' ✓' : ''}</span>
        <span class="goal-pct">${pct}%</span></div>
      <div class="goal-nums"><span>Guardado: <b>${fmtShort(total)}</b></span><span>Meta: <b>${fmtShort(g.target_amount)}</b></span></div>
      <div class="bar ${pct >= 100 ? 'bar-green' : barClass(100 - pct) === 'bar-red' ? 'bar-amber' : 'bar-green'}"><i style="width:${Math.min(100, pct)}%"></i></div>
      ${forecast}
      <div class="btn-row">
        <button class="btn ghost" data-aporte="${g.id}">＋ Aporte</button>
        <button class="btn ghost" data-goal-detail="${g.id}">Ver histórico (${entries.length})</button>
      </div>
      ${entries.length ? `<p class="muted" style="margin-top:10px;font-weight:600">Últimos aportes</p>` : ''}
      ${entries.slice(0, 2).map(e => `<div class="muted" style="margin-top:4px">· ${fmtDay(e.date)} — ${esc(e.description)} <b style="color:var(--paper)">${fmtShort(e.amount)}</b></div>`).join('')}
      ${entries.length > 2 ? `<div class="muted" style="margin-top:6px">e mais ${entries.length - 2} — toque em <b>Ver histórico</b> para ver todos</div>` : ''}
    </div>`;
  }
  return html;
}

// Saudação e identidade usam o nome que a própria família escolheu
function refreshIdentity() {
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = DB.familyName();
  $('#topbar-hello').textContent = saudacao + (nome ? ' · ' + nome : '');
  const side = $('#side-family');
  if (side) side.textContent = DB.familyLabel();
  document.title = nome ? `Finanças — ${nome}` : 'Finanças da Família';
}

/* ---------- Relatórios ---------- */
function renderRelatorios() {
  const period = DB.monthPeriod(new Date(), state.repOffset || 0);
  const prev = DB.monthPeriod(new Date(), (state.repOffset || 0) - 1);
  const txs = DB.expensesOf(period);            // relatórios de gasto: só despesas
  const total = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const receitasPeriodo = DB.realizedIncome(period);
  const prevByCat = DB.spentByCategory(prev);
  const byCat = DB.spentByCategory(period);
  const income = Number(DB.settings().monthly_income) || 0;

  // 1) Comparativo por categoria (mês vs anterior, com variação)
  let catRows = '';
  const catIds = [...new Set([...Object.keys(byCat), ...Object.keys(prevByCat)])]
    .sort((a, b) => (byCat[b] || 0) - (byCat[a] || 0));
  for (const cid of catIds) {
    const cur = byCat[cid] || 0, ant = prevByCat[cid] || 0;
    const delta = ant > 0 ? Math.round((cur - ant) / ant * 100) : (cur > 0 ? null : 0);
    const deltaTxt = delta === null ? '<span class="muted">novo</span>'
      : delta === 0 ? '<span class="muted">=</span>'
      : `<span class="${delta > 0 ? 'txt-red' : 'txt-green'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%</span>`;
    catRows += `<tr><td>${esc(catLabel(cid === '_sem' ? null : cid))}</td>
      <td class="num">${fmtShort(cur)}</td><td class="num muted">${fmtShort(ant)}</td><td>${deltaTxt}</td></tr>`;
  }

  // 2) Por membro e por método (barras horizontais reutilizando .bar)
  const groupSum = key => {
    const out = {};
    for (const t of txs) { const k = t[key] || '—'; out[k] = (out[k] || 0) + (Number(t.amount) || 0); }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  };
  const hb = entries => svgRanking(entries);

  // 3) Maiores gastos
  const top = [...txs].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 10)
    .map(t => `<tr><td>${esc(t.description)}<br><small class="muted">${fmtDay(t.date)} · ${esc(catLabel(t.category_id))}</small></td>
      <td class="num">${fmt(t.amount)}</td></tr>`).join('');

  // 4) Custos fixos (recorrentes)
  const rec = DB.all('transactions').filter(t => t.recurring);
  const recSeen = {}; // um por descrição (último valor)
  for (const t of [...rec].sort((a, b) => a.date.localeCompare(b.date))) recSeen[t.description.toLowerCase()] = t;
  const recList = Object.values(recSeen);
  const recTotal = recList.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const recRows = recList.sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .map(t => `<tr><td>${esc(t.description)}</td><td class="num">${fmt(t.amount)}</td></tr>`).join('');

  // 5) Evolução 12 meses
  const evo12 = Array.from({ length: 12 }, (_, i) => {
    const p = DB.monthPeriod(new Date(), i - 11);
    return { label: p.start.toLocaleDateString('pt-BR', { month: 'narrow' }), value: DB.expensesOf(p).reduce((s, t) => s + (Number(t.amount) || 0), 0), hint: i === 11 ? '#009ef7' : '#a6d9f7' };
  });

  return `
    <div class="card month-nav">
      <button id="rep-prev" aria-label="Mês anterior" data-ico="chevL"></button>
      <b>Relatórios · ${period.label}</b>
      <button id="rep-next" aria-label="Próximo mês" data-ico="chevR"></button>
    </div>
    <div class="kpi-grid">
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmtShort(total)}</div><div class="kpi-label">Despesas</div><div class="kpi-sub">${txs.length} lançamentos</div></div>
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value green">${fmtShort(receitasPeriodo)}</div><div class="kpi-label">Receitas</div><div class="kpi-sub">no período</div></div>
      <div class="card kpi"><span class="kpi-ico ${receitasPeriodo - total >= 0 ? 't-success' : 't-danger'}" data-ico="pie"></span><div class="kpi-value ${receitasPeriodo - total >= 0 ? 'green' : 'red'}">${fmtShort(receitasPeriodo - total)}</div><div class="kpi-label">Resultado</div><div class="kpi-sub">${receitasPeriodo > 0 ? Math.round((receitasPeriodo - total) / receitasPeriodo * 100) + '% da receita' : 'sem receita lançada'}</div></div>
      <div class="card kpi"><span class="kpi-ico t-warning" data-ico="calendar"></span><div class="kpi-value">${fmtShort(total / Math.max(1, DB.elapsedDays(period)))}</div><div class="kpi-label">Média por dia</div><div class="kpi-sub">${DB.elapsedDays(period)} de ${DB.periodDays(period)} dias</div></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><b>Evolução dos gastos</b><small>últimos 12 períodos${income > 0 ? ' · linha vermelha = renda mensal' : ''}</small></div>
        <button class="btn ghost" id="btn-csv" style="width:auto;padding:8px 14px;display:flex;align-items:center;gap:7px"><span data-ico="download"></span>CSV</button>
      </div>
      ${svgBars(evo12, income, { height: 260 })}
      ${(() => {
        const vals = evo12.map(e => e.value).filter(v => v > 0);
        if (vals.length < 2) return '';
        const media = vals.reduce((a, b) => a + b, 0) / vals.length;
        const ultimo = evo12[11].value, penultimo = evo12[10].value;
        const var2 = penultimo > 0 ? Math.round((ultimo - penultimo) / penultimo * 100) : 0;
        return `<div class="chart-foot">
          <span>Média do período <b>${fmtShort(media)}</b></span>
          <span>Maior <b>${fmtShort(Math.max(...vals))}</b></span>
          <span>Menor <b>${fmtShort(Math.min(...vals))}</b></span>
          <span>Vs. mês anterior <b class="${var2 > 0 ? 'txt-red' : 'txt-green'}">${var2 > 0 ? '▲' : var2 < 0 ? '▼' : ''} ${Math.abs(var2)}%</b></span>
        </div>`;
      })()}
    </div>

    <div class="card">
      <div class="card-head"><div><b>Categorias — comparativo</b><small>${period.label} vs. período anterior</small></div></div>
      <div class="table-wrap"><table class="rep-table">
        <thead><tr><th>Categoria</th><th>Atual</th><th>Anterior</th><th>Δ</th></tr></thead>
        <tbody>${catRows || '<tr><td colspan="4" class="empty">Sem dados.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Para onde foi</b><small>divisão por categoria no período</small></div></div>
        ${(() => {
          const cats6 = catIds.slice(0, 6).map((cid, i) => ({ label: catLabel(cid === '_sem' ? null : cid), value: byCat[cid] || 0, color: PALETTE[i % PALETTE.length] })).filter(f => f.value > 0);
          const outras = catIds.slice(6).reduce((s, cid) => s + (byCat[cid] || 0), 0);
          if (outras > 0) cats6.push({ label: 'Outras', value: outras, color: '#c4cad4' });
          if (!cats6.length) return '<div class="empty">Sem gastos no período.</div>';
          return `<div class="donut-wrap">${svgDonut(cats6, total, { caption: 'no período' })}
            <div class="legend">${cats6.map(f => `<div class="legend-row"><i class="legend-dot" style="background:${f.color}"></i>
              <span class="legend-name">${esc(f.label)}</span><span class="legend-pct">${Math.round(f.value / total * 100)}%</span>
              <span class="legend-val">${fmtShort(f.value)}</span></div>`).join('')}</div></div>`;
        })()}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Necessidades × Desejos</b><small>equilíbrio dos gastos (regra 50/30/20)</small></div></div>
        ${(() => {
          const k = DB.spentByKind(period);
          const soma = k.Essencial + k.Estilo;
          if (!soma) return '<div class="empty">Sem gastos no período.</div>';
          const fat = [
            { label: 'Necessidades', value: k.Essencial, color: '#009ef7' },
            { label: 'Desejos', value: k.Estilo, color: '#7239ea' },
          ].filter(f => f.value > 0);
          const pctD = Math.round(k.Estilo / soma * 100);
          return `<div class="donut-wrap">${svgDonut(fat, soma, { caption: 'total de gastos' })}
            <div class="legend">${fat.map(f => `<div class="legend-row"><i class="legend-dot" style="background:${f.color}"></i>
              <span class="legend-name">${f.label}</span><span class="legend-pct">${Math.round(f.value / soma * 100)}%</span>
              <span class="legend-val">${fmtShort(f.value)}</span></div>`).join('')}</div></div>
            <div class="chart-foot"><span>${pctD <= 30 ? '✅ Desejos dentro do recomendado (até 30% da renda)' : `⚠️ Desejos em ${pctD}% dos gastos — vale revisar`}</span></div>`;
        })()}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Quem gastou</b><small>por membro da família</small></div></div>
        ${hb(groupSum('member'))}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Como pagou</b><small>por forma de pagamento</small></div></div>
        ${hb(groupSum('method'))}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><b>Ranking de categorias</b><small>do maior para o menor gasto no período</small></div></div>
      ${svgRanking(catIds.map(cid => [catLabel(cid === '_sem' ? null : cid), byCat[cid] || 0]).filter(e => e[1] > 0))}
    </div>

    <!-- De onde vem o dinheiro. Separar salário de empréstimo recebido é o ponto:
         os dois entram na conta, e só um é ganho. -->
    ${(() => {
      const porOrigem = DB.incomeByCategory(period);
      const linhas = Object.entries(porOrigem).sort((a, b) => b[1] - a[1]);
      if (!linhas.length) return '';
      const total = linhas.reduce((s, l) => s + l[1], 0);
      const emprestado = linhas
        .filter(([id]) => /emprest/i.test((catOf(id) || {}).name || ''))
        .reduce((s, l) => s + l[1], 0);
      return `
    <div class="card">
      <div class="card-head"><div><b>De onde vem o dinheiro</b><small>entradas do período por origem</small></div>
        <span class="kpi-ico t-success" data-ico="trend" style="width:34px;height:34px;margin:0"></span></div>
      ${svgRanking(linhas.map(([id, v]) => [id === '_sem' ? 'Sem origem' : catLabel(id), v]))}
      <div class="chart-foot"><span>${emprestado > 0
        ? `⚠️ ${fmtShort(emprestado)} vieram de empréstimo — entram na conta, mas não são ganho: viram dívida a pagar.`
        : `${fmtShort(total)} de entradas classificadas no período.`}</span></div>
    </div>`;
    })()}

    <!-- Etiqueta só compensa se der para ver o total dela. É aqui que "separar do
         todo" acontece: quanto custou a viagem, somando categorias diferentes. -->
    ${(() => {
      const porTag = DB.spentByTag(period);
      const linhas = Object.entries(porTag).sort((a, b) => b[1] - a[1]);
      if (!linhas.length) return '';
      const somaTags = linhas.reduce((s, l) => s + l[1], 0);
      return `
    <div class="card">
      <div class="card-head"><div><b>Por etiqueta</b><small>assunto que atravessa categorias — toque para ver os lançamentos</small></div>
        <span class="kpi-ico t-primary" data-ico="tag" style="width:34px;height:34px;margin:0"></span></div>
      <div class="rank">
        ${linhas.map(([tag, v], i) => `
          <div class="rank-row rank-clicavel" data-ver-tag="${esc(tag)}">
            <span class="rank-name">#${esc(tag)}</span>
            <span class="rank-bar"><i style="width:${Math.max(2, v / linhas[0][1] * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}"></i></span>
            <span class="rank-val">${fmtShort(v)}</span>
          </div>`).join('')}
      </div>
      <div class="chart-foot"><span>${fmtShort(somaTags)} etiquetado no período — um lançamento com duas etiquetas conta nas duas.</span></div>
    </div>`;
    })()}

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Maiores gastos</b><small>top 10 do período</small></div></div>
        <div class="table-wrap"><table class="rep-table"><tbody>${top || '<tr><td class="empty">Sem dados.</td></tr>'}</tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><b>Custos fixos (recorrentes)</b><small>compromisso mensal estimado: <b class="txt-red">${fmtShort(recTotal)}</b>${income > 0 ? ` · ${Math.round(recTotal / income * 100)}% da renda` : ''}</small></div></div>
        <div class="table-wrap"><table class="rep-table"><tbody>${recRows || '<tr><td class="empty">Marque lançamentos como Recorrente para vê-los aqui.</td></tr>'}</tbody></table></div>
      </div>
    </div>
  `;
}

/* ---------- Ligações por view ---------- */
function bindView() {
  const v = $('#view');
  v.querySelectorAll('[data-tx]').forEach(el => el.onclick = () => openTxSheet(DB.get('transactions', el.dataset.tx)));
  const prev = $('#mn-prev'), next = $('#mn-next');
  if (prev) prev.onclick = () => { state.monthOffset--; render(); };
  if (next) next.onclick = () => { if (state.monthOffset < 0) { state.monthOffset++; render(); } };
  const rprev = $('#rep-prev'), rnext = $('#rep-next');
  if (rprev) rprev.onclick = () => { state.repOffset = (state.repOffset || 0) - 1; render(); };
  if (rnext) rnext.onclick = () => { state.repOffset = (state.repOffset || 0) + 1; render(); };
  const goRep = $('#go-reports');
  if (goRep) goRep.onclick = () => setTab('relatorios');
  const goCards = $('#go-cards');
  if (goCards) goCards.onclick = () => openConfigSection('cards');
  v.querySelectorAll('[data-setup]').forEach(b => b.onclick = () => openConfigSection(b.dataset.setup));

  // Busca instantânea no extrato (filtra sem re-renderizar, mantendo o foco)
  // Busca entra no mesmo pipeline dos outros filtros, então o total do topo
  // acompanha. Espera curta para não redesenhar a cada tecla.
  const search = $('#tx-search');
  if (search) {
    search.oninput = () => {
      clearTimeout(search._t);
      search._t = setTimeout(() => {
        const foco = document.activeElement === search;
        state.filtros.busca = search.value.trim();
        render();
        if (foco) { const novo = $('#tx-search'); if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); } }
      }, 260);
    };
  }
  const btnFiltros = $('#btn-filtros');
  if (btnFiltros) btnFiltros.onclick = openFiltrosSheet;
  const limpar = () => { state.filtros = { ...FILTROS_VAZIOS }; render(); };
  const btnLimpar = $('#limpar-filtros');
  if (btnLimpar) btnLimpar.onclick = limpar;
  const btnLimparVazio = $('#limpar-vazio');
  if (btnLimparVazio) btnLimparVazio.onclick = limpar;
  // Cada etiqueta ativa remove só o próprio filtro
  v.querySelectorAll('[data-limpa]').forEach(el => el.onclick = () => {
    const chave = el.dataset.limpa;
    state.filtros[chave] = FILTROS_VAZIOS[chave];
    render();
  });
  // Tocar numa etiqueta do lançamento filtra por ela
  v.querySelectorAll('[data-tag]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    state.filtros.tag = el.dataset.tag;
    render();
  });
  // Do relatório por etiqueta direto para os lançamentos dela
  v.querySelectorAll('[data-ver-tag]').forEach(el => el.onclick = () => {
    const tag = el.dataset.verTag;
    setTab('extrato');                    // zera o resto dos filtros, então o alvo fica só a etiqueta
    state.filtros.tag = tag;
    render();
  });

  // Custos fixos do mês em 1 clique: copia recorrentes que ainda não existem no período
  const recurBtn = $('#btn-recur');
  if (recurBtn) recurBtn.onclick = () => {
    const period = DB.monthPeriod(new Date());
    const inPeriodDesc = new Set(DB.txOfPeriod(period).map(t => t.description.toLowerCase()));
    const templates = {};
    for (const t of DB.all('transactions').filter(t => t.recurring).sort((a, b) => a.date.localeCompare(b.date)))
      templates[t.description.toLowerCase()] = t;
    let n = 0;
    for (const t of Object.values(templates)) {
      if (inPeriodDesc.has(t.description.toLowerCase())) continue;
      if (t.group_id) continue;                       // parcelas já nascem em todas as faturas
      const novo = { ...t, id: null, date: todayISO(), status: 'A Pagar' };
      if (novo.card_id) {
        const card = DB.get('cards', novo.card_id);
        novo.invoice_key = card ? DB.invoiceKeyFor(card, novo.date) : '';
      }
      // A cópia não herda o vínculo com o extrato nem com o parcelamento do original
      delete novo.updated_at; delete novo.dirty; delete novo.fitid;
      delete novo.group_id; delete novo.installment;
      DB.upsert('transactions', novo);
      n++;
    }
    Sync.autoSync(); render();
    toast(n ? `${n} custo(s) fixo(s) lançado(s) como "A Pagar" ✓` : 'Todos os custos fixos já estão lançados neste mês');
  };

  // Exportar CSV do período (Relatórios)
  const csvBtn = $('#btn-csv');
  if (csvBtn) csvBtn.onclick = () => {
    const period = DB.monthPeriod(new Date(), state.repOffset || 0);
    const rows = [['Tipo', 'Descricao', 'Valor', 'Data', 'Categoria', 'Ambito', 'Membro', 'Metodo', 'Status', 'Parcela', 'Cartao', 'Conta']];
    for (const t of DB.txOfPeriod(period).sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([
        DB.isExpense(t) ? 'Despesa' : 'Receita',
        t.description, String(t.amount).replace('.', ','), t.date,
        DB.categoryPath(t.category_id), t.scope, t.member || '', t.method, t.status, t.installment || '',
        (DB.get('cards', t.card_id) || {}).name || '', (DB.get('accounts', t.account_id) || {}).name || '',
      ]);
    }
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `financas-${period.label.toLowerCase().replace(/ /g, '-')}.csv`;
    a.click();
    toast('CSV exportado ✓');
  };
  v.querySelectorAll('#scope-chips .chip').forEach(ch => ch.onclick = () => { state.filtros.scope = ch.dataset.f; render(); });
  v.querySelectorAll('[data-novo]').forEach(b => b.onclick = () => openTxSheet({
    type: b.dataset.novo, date: todayISO(), description: '', amount: '',
    status: 'Pago', method: b.dataset.novo === 'Transferência' ? 'Transferência' : 'PIX',
    scope: 'Família', member: MEMBRO_COMUM,
  }, true));

  // Ação rápida: marcar um "A Pagar" como pago (ajusta o saldo da conta)
  v.querySelectorAll('[data-pay-tx]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const t = DB.get('transactions', b.dataset.payTx);
    if (!t) return;
    const atualizado = { ...t, status: 'Pago' };
    adjustBalance(t.account_id, -txEffect(t));
    DB.upsert('transactions', atualizado);
    adjustBalance(atualizado.account_id, txEffect(atualizado));
    Sync.autoSync(); render();
    toast(DB.isExpense(t) ? 'Marcado como pago ✓' : 'Marcado como recebido ✓');
  });

  // Contas: tocar para atualizar o saldo (conciliação rápida)
  v.querySelectorAll('[data-acc]').forEach(el => el.onclick = () => openSaldoSheet(el.dataset.acc));
  v.querySelectorAll('[data-envelope]').forEach(el => el.onclick = () => openEnvelopeDetail(el.dataset.envelope));
  const transf = $('#btn-transfer');
  if (transf) transf.onclick = () => openTxSheet({ type: 'Transferência', date: todayISO(), description: '', amount: '', status: 'Pago', method: 'Transferência', scope: 'Família', member: MEMBRO_COMUM }, true);
  const criarReserva = $('#btn-criar-reserva');
  if (criarReserva) criarReserva.onclick = () => {
    const alvo = Math.round(DB.avgMonthlySpend() * 6) || 0;
    const id = DB.upsert('goals', {
      name: 'Reserva de Emergência', icon: '🛡️', kind: 'Reserva',
      target_amount: alvo, target_date: null, done: false,
    });
    Sync.autoSync(); render();
    toast('Reserva criada — agora é só ir guardando 🛡️');
    openAporteSheet(id);
  };
  const invAdjust = (key, sign) => {
    const card = DB.get('cards', key.split(':')[0]);
    if (!card || !card.account_id) return false;
    const inv = DB.invoicesOf(card).find(i => i.key === key);
    if (inv) adjustBalance(card.account_id, sign * inv.total);
    return true;
  };
  v.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const debited = invAdjust(b.dataset.pay, -1);
    DB.setInvoicePaid(b.dataset.pay, true);
    Sync.autoSync(); render();
    toast(debited ? 'Fatura paga — saldo da conta debitado ✓' : 'Fatura paga (vincule uma conta ao cartão para debitar o saldo)');
  });
  v.querySelectorAll('[data-unpay]').forEach(b => b.onclick = () => {
    invAdjust(b.dataset.unpay, +1);
    DB.setInvoicePaid(b.dataset.unpay, false);
    Sync.autoSync(); render();
  });
  const ng = $('#btn-new-goal');
  if (ng) ng.onclick = () => openGoalSheet(null);
  v.querySelectorAll('[data-editgoal]').forEach(b => b.onclick = () => openGoalSheet(DB.get('goals', b.dataset.editgoal)));
  v.querySelectorAll('[data-aporte]').forEach(b => b.onclick = () => openAporteSheet(b.dataset.aporte));
  v.querySelectorAll('[data-goal-detail]').forEach(b => b.onclick = () => openGoalDetail(b.dataset.goalDetail));
  v.querySelectorAll('[data-inv-detail]').forEach(b => b.onclick = () => openInvoiceDetail(b.dataset.invDetail));
}

/* ---------- Sheet: lançamento rápido ---------- */
/* Painel de filtros do extrato. Fica numa folha em vez de na tela porque são dez
   controles: na tela, empurrariam a lista para fora da primeira dobra — e o
   extrato existe para mostrar a lista. Aplicar fecha e a tela mostra o que
   está ativo em etiquetas, então nada fica escondido depois de escolhido. */
function openFiltrosSheet() {
  const f = { ...(state.filtros || FILTROS_VAZIOS) };
  const membros = ['Todos', MEMBRO_COMUM, ...DB.settings().members];
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const cartoes = DB.all('cards').filter(c => c.active !== false);
  const tags = DB.allTags();
  const metodos = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto', 'Transferência'];

  openSheet(`
    <div class="sheet-title">Filtrar extrato<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>

    <div class="field"><label>Tipo</label>${chipGroup('fl-tipo', ['Todos', 'Despesa', 'Receita', 'Transferência'].map(v => ({ value: v, label: v })), f.tipo)}</div>
    <div class="field"><label>Situação</label>${chipGroup('fl-sit', ['Todos', 'Pago', 'A Pagar'].map(v => ({ value: v, label: v })), f.situacao)}</div>
    <div class="field"><label>Âmbito</label>${chipGroup('fl-scope', ['Todos', 'Família', 'Pessoal'].map(v => ({ value: v, label: v })), f.scope)}</div>

    <div class="field"><label>De quem</label>
      <select id="fl-membro">${membros.map(m => `<option value="${esc(m)}"${f.membro === m ? ' selected' : ''}>${m === MEMBRO_COMUM ? 'Comum / Família' : esc(m)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Categoria</label>
      <select id="fl-cat"><option value="">Todas</option>${optionsCategorias(f.categoria)}</select>
      <p class="muted" style="margin-top:6px">Escolher um envelope traz também as subcategorias dele.</p>
    </div>
    ${tags.length ? `<div class="field"><label>Etiqueta</label>
      <select id="fl-tag"><option value="">Todas</option>${tags.map(t => `<option value="${esc(t)}"${f.tag === t ? ' selected' : ''}>#${esc(t)} (${DB.tagCount(t)})</option>`).join('')}</select>
    </div>` : ''}
    <div class="field"><label>Forma de pagamento</label>
      <select id="fl-metodo"><option value="">Todas</option>${metodos.map(m => `<option value="${esc(m)}"${f.metodo === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Conta ou cartão</label>
      <select id="fl-conta"><option value="">Todos</option>
        ${contas.length ? `<optgroup label="Contas">${contas.map(a => `<option value="${a.id}"${f.conta === a.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}
        ${cartoes.length ? `<optgroup label="Cartões">${cartoes.map(c => `<option value="${c.id}"${f.conta === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
      </select>
    </div>
    <div class="row2">
      <div class="field"><label>Valor a partir de</label><input id="fl-min" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
      <div class="field"><label>Valor até</label><input id="fl-max" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    </div>
    <div class="field"><label>Só custos fixos (recorrentes)</label>
      <select id="fl-rec"><option value=""${f.recorrente ? '' : ' selected'}>Não</option><option value="1"${f.recorrente ? ' selected' : ''}>Sim</option></select>
    </div>

    <button class="btn" id="sh-save">Aplicar filtros</button>
    <div class="btn-row"><button class="btn ghost" id="fl-limpar">Limpar tudo</button></div>
  `);
  initMoney('#fl-min', f.valorMin || 0);
  initMoney('#fl-max', f.valorMax || 0);
  $('#sh-close').onclick = closeSheet;
  bindChips('fl-tipo'); bindChips('fl-sit'); bindChips('fl-scope');

  $('#fl-limpar').onclick = () => {
    state.filtros = { ...FILTROS_VAZIOS };
    closeSheet(); render();
  };
  $('#sh-save').onclick = () => {
    const val = id => moneyVal(id) || '';
    state.filtros = {
      ...state.filtros,
      tipo: chipValue('fl-tipo') || 'Todos',
      situacao: chipValue('fl-sit') || 'Todos',
      scope: chipValue('fl-scope') || 'Todos',
      membro: $('#fl-membro').value || 'Todos',
      categoria: $('#fl-cat').value || '',
      tag: ($('#fl-tag') || {}).value || '',
      metodo: $('#fl-metodo').value || '',
      conta: $('#fl-conta').value || '',
      valorMin: val('#fl-min'),
      valorMax: val('#fl-max'),
      recorrente: !!$('#fl-rec').value,
    };
    closeSheet(); render();
  };
}

/* Detalhe de um envelope: para onde foi o dinheiro dele dentro do período.
   É a resposta que faltava quando uma barra de orçamento estourava. */
function openEnvelopeDetail(rootId) {
  const c = catOf(rootId);
  if (!c) return;
  const period = DB.monthPeriod(new Date(), state.monthOffset);
  const porSub = DB.spentBySubcategory(period, rootId);
  const direto = DB.spentDirectly(period, rootId);
  const total = Object.values(porSub).reduce((s, v) => s + v, 0) + direto;

  const linhas = Object.entries(porSub)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => [(catOf(id) || {}).name || '—', v]);
  if (direto > 0) linhas.push(['Sem subcategoria', direto]);

  const limite = Number(c.monthly_budget) || 0;
  const pct = limite > 0 ? Math.round(total / limite * 100) : 0;

  openSheet(`
    <div class="sheet-title">${esc(c.icon)} ${esc(c.name)}</div>
    <p class="muted" style="margin-bottom:12px">${esc(period.label)} · ${fmtShort(total)} gasto${limite ? ` de ${fmtShort(limite)} (${pct}%)` : ''}</p>
    ${limite ? `<div class="bar ${barClass(pct)}" style="margin-bottom:16px"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
    ${linhas.length
      ? svgRanking(linhas)
      : '<div class="empty">Nada gasto neste envelope no período.</div>'}
    <div class="btn-row" style="margin-top:14px"><button class="btn ghost" id="sh-close">Fechar</button></div>
  `);
  $('#sh-close').onclick = closeSheet;
}

function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.hidden = false; $('#sheet-backdrop').hidden = false;
  paintIcons(sheet);
  if (typeof UI !== 'undefined') UI.enhance(sheet);
  // Teclado padrão de TODAS as folhas. Reatribuído a cada abertura e acionando o botão
  // do formulário atual (via click), para nunca sobrar handler de uma folha anterior.
  sheet.onkeydown = e => {
    if (e.key === 'Escape') { e.preventDefault(); return closeSheet(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      const save = sheet.querySelector('#sh-save');
      if (save) { e.preventDefault(); save.click(); }
    }
  };
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; }

function chipGroup(id, options, selected) {
  return `<div class="chips" id="${id}">
    ${options.map(o => `<button type="button" class="chip ${o.value === selected ? 'active' : ''}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
  </div>`;
}
function chipValue(id) {
  const a = document.querySelector(`#${id} .chip.active`);
  return a ? a.dataset.v : '';
}
function bindChips(id, onChange) {
  document.querySelectorAll(`#${id} .chip`).forEach(ch => ch.onclick = () => {
    document.querySelectorAll(`#${id} .chip`).forEach(x => x.classList.remove('active'));
    ch.classList.add('active');
    if (onChange) onChange(ch.dataset.v);
  });
}
function selectChip(id, value) {
  if (!value) return;
  document.querySelectorAll(`#${id} .chip`).forEach(ch => ch.classList.toggle('active', ch.dataset.v === value));
}

/* Categorias mais usadas primeiro (as 3 viram botões; o resto fica no dropdown).
   Só folhas entram: com subcategorias, oferecer o envelope como atalho faria o
   gasto cair no nível de cima e o detalhe nunca acontecer. */
function topCategoryIds(limit = 3, incluir, tipo = 'Despesa') {
  const folhas = DB.leafCategories(tipo);
  const ehFolha = id => folhas.some(c => c.id === id);
  const uso = {};
  const querReceita = tipo === 'Receita';
  for (const t of DB.all('transactions')) {
    if (!t.category_id) continue;
    // As mais usadas em gastos não dizem nada sobre as mais usadas em entradas
    if (DB.isExpense(t) === querReceita) continue;
    if (!ehFolha(t.category_id)) continue;
    uso[t.category_id] = (uso[t.category_id] || 0) + 1;
  }
  const ids = Object.keys(uso).sort((a, b) => uso[b] - uso[a]);
  for (const c of folhas) if (!ids.includes(c.id)) ids.push(c.id);   // completa se houver poucas
  const top = ids.slice(0, limit);
  // a categoria já escolhida sempre aparece como botão, mesmo que não seja das mais usadas
  if (incluir && !top.includes(incluir) && DB.get('categories', incluir)) top[limit - 1] = incluir;
  return top;
}

/* Últimos lançamentos distintos por descrição — alimenta o autocomplete e o "repetir classificação" */
function txHistory() {
  const map = {};
  for (const t of DB.all('transactions').sort((a, b) => a.date.localeCompare(b.date))) {
    map[t.description.toLowerCase()] = t;
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
}

// asNew: abre com os dados preenchidos, mas cria um lançamento novo (usado pelo "Repetir")
function openTxSheet(tx, asNew) {
  const isEdit = !!tx && !asNew;
  const orig = isEdit ? { ...tx } : null;   // p/ reverter efeito no saldo ao editar/excluir
  tx = tx || { description: '', amount: '', date: todayISO(), scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', status: 'Pago', category_id: '', account_id: '', card_id: '' };
  const cards = DB.all('cards').filter(c => c.active !== false);
  const accounts = DB.all('accounts').filter(a => a.active !== false);
  const pessoas = DB.settings().members;
  const historico = txHistory();

  openSheet(`
    <div class="sheet-title"><span id="sh-title">${isEdit ? 'Editar lançamento' : 'Novo lançamento'}</span><button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field">${chipGroup('g-type', [
      { value: 'Despesa', label: '↓ Despesa' },
      { value: 'Receita', label: '↑ Receita' },
      { value: 'Transferência', label: '⇄ Transferência' },
    ], tx.type || 'Despesa')}</div>
    <div class="field"><input class="amount-input" id="f-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="field"><label>Descrição</label>
      <input id="f-desc" list="tx-hist" autocomplete="off" placeholder="Ex: Mercado, Uber, Farmácia…" value="${esc(tx.description)}">
      <datalist id="tx-hist">${historico.map(h => `<option value="${esc(h.description)}">`).join('')}</datalist>
    </div>
    <!-- A categoria vale para os dois lados: gasto responde "no que foi" e entrada
         responde "de onde veio". A lista troca junto com o tipo, porque as duas
         perguntas têm respostas diferentes. -->
    <div class="field" id="wrap-cat">
      <label id="lbl-cat">Categoria <span class="muted" id="cat-auto"></span></label>
      <div class="chips" id="g-cat"></div>
      <select id="f-cat-more" hidden style="margin-top:8px"></select>
    </div>
    <div class="row2">
      <div class="field"><label>Data</label><input id="f-date" type="date" value="${tx.date}">
        <div class="chips" id="g-day" style="margin-top:6px"><button type="button" class="chip" data-d="0">Hoje</button><button type="button" class="chip" data-d="1">Ontem</button><button type="button" class="chip" data-d="2">Anteontem</button></div>
      </div>
      <div class="field"><label id="lbl-status">Situação</label><select id="f-status">
        <option value="Pago" ${tx.status === 'Pago' ? 'selected' : ''}>Pago</option>
        <option value="A Pagar" ${tx.status === 'A Pagar' ? 'selected' : ''}>A Pagar</option>
      </select></div>
    </div>
    <div class="field" id="wrap-method"><label id="lbl-method">Pagamento</label>${chipGroup('g-method', METHODS.map(m => ({ value: m, label: m })), METHODS.includes(tx.method) ? tx.method : 'PIX')}</div>
    <div class="field" id="wrap-card" ${tx.method === 'Cartão de Crédito' ? '' : 'hidden'}>
      <label>Cartão <span class="muted">— a fatura é escolhida sozinha pelo fechamento</span></label>
      <select id="f-card">${cards.map(c => `<option value="${c.id}" ${tx.card_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option value="">— cadastre um cartão em Configurações —</option>'}</select>
      <p class="muted" id="fatura-hint" style="margin-top:6px"></p>
    </div>
    ${isEdit ? '' : `<div class="field" id="wrap-parc" ${tx.method === 'Cartão de Crédito' ? '' : 'hidden'}>
      <label>Parcelas</label>
      <select id="f-parc">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i === 0 ? 'À vista' : `${i + 1}x`}</option>`).join('')}</select>
      <p class="muted" id="parc-hint" style="margin-top:6px">Informe o <b>valor total</b> da compra — o app divide nas faturas seguintes.</p>
    </div>`}
    <div class="field" id="wrap-account" ${tx.method === 'Cartão de Crédito' ? 'hidden' : ''}>
      <label id="lbl-account">Conta <span class="muted">— o saldo é ajustado sozinho</span></label>
      <select id="f-account"><option value="">— não movimenta conta —</option>${accounts.map(a => `<option value="${a.id}" ${tx.account_id === a.id ? 'selected' : ''}>${esc(a.name)}${DB.isReserveGoal({ name: a.name }) ? '' : ''} — ${fmtShort(a.balance)}</option>`).join('')}</select>
    </div>
    <div class="field" id="wrap-to-account" hidden>
      <label>Para qual conta</label>
      <select id="f-to-account"><option value="">— selecione —</option>${accounts.map(a => `<option value="${a.id}" ${tx.to_account === a.id ? 'selected' : ''}>${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}</select>
      <p class="muted" style="margin-top:6px">Mover dinheiro entre contas suas <b>não é gasto nem renda</b> — só ajusta os saldos, sem poluir os relatórios.</p>
    </div>
    <div class="field" id="wrap-scope"><label>Âmbito</label>
      ${chipGroup('g-scope', [{ value: 'Família', label: '👨‍👩‍👧 Da família' }, { value: 'Pessoal', label: '👤 Pessoal' }], tx.scope)}
    </div>
    <div class="field" id="wrap-member" hidden>
      <label>De quem é este gasto? <span class="txt-red">*</span></label>
      <select id="f-member">
        <option value="">— selecione —</option>
        ${pessoas.map(m => `<option ${tx.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
      </select>
      <p class="muted" id="member-hint" style="margin-top:6px"></p>
    </div>
    <!-- Etiquetas: assunto que atravessa envelopes. "Viagem Bahia" junta passagem,
         comida e hospedagem, que estão em três categorias diferentes.

         As sugeridas são OFERECIDAS, nunca aplicadas sozinhas: gasto esporádico é
         o caso mais comum de etiqueta, e nele o lançamento anterior não tem relação
         nenhuma. Quem está lançando uma sequência fixa a etiqueta de propósito. -->
    ${(() => {
      const atuais = isEdit ? DB.tagsOf(tx) : (DB.tagsOf(tx).length ? DB.tagsOf(tx) : tagsFixas);
      const veioDeFixa = !isEdit && !DB.tagsOf(tx).length && atuais.length > 0;
      const sugeridas = DB.tagsRelevantes(8).filter(t => !atuais.includes(t));
      const chips = [...atuais.map(t => ({ t, on: true })), ...sugeridas.map(t => ({ t, on: false }))];
      return `
    <div class="field"><label>Etiquetas <span class="muted">— opcional, agrupa por assunto</span></label>
      <div class="chips" id="g-tags">
        ${chips.map(({ t, on }) => `<button type="button" class="chip chip-tag ${on ? 'active' : ''}" data-v="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
      <input id="f-tag-nova" list="tag-hist" placeholder="Buscar ou criar etiqueta e Enter" autocomplete="off" maxlength="24" style="margin-top:8px">
      <datalist id="tag-hist">${DB.allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      ${isEdit ? '' : `<button type="button" class="chip chip-fixa ${veioDeFixa ? 'active' : ''}" id="tag-fixar" style="margin-top:8px">
        📌 Manter nos próximos lançamentos</button>
      <p class="muted" id="tag-fixa-hint" style="margin-top:6px;font-size:11.5px">${veioDeFixa
        ? `Fixado: ${atuais.map(t => '#' + t).join(' ')}. Desligue quando a sequência terminar.`
        : 'Use ao lançar vários gastos do mesmo assunto — uma viagem, uma reforma.'}</p>`}
    </div>`;
    })()}
    <div class="field"><label id="lbl-rec">Custo fixo mensal (recorrente)?</label><select id="f-rec"><option value="">Não</option><option value="1" ${tx.recurring ? 'selected' : ''}>Sim — entra nos custos fixos e no lançamento em 1 clique</option></select></div>
    <button class="btn" id="sh-save">${isEdit ? 'Salvar alterações' : 'Lançar'}</button>
    ${isEdit ? '<div class="btn-row"><button class="btn ghost" id="sh-dup">Repetir</button><button class="btn danger" id="sh-del">Excluir</button></div>' : ''}
  `);

  /* --- Formulário adaptativo: cada escolha reconfigura o resto --- */
  const applyType = v => {
    const isRec = v === 'Receita';
    const isTransf = v === 'Transferência';
    $('#sh-title').textContent = isEdit ? 'Editar lançamento'
      : isTransf ? 'Transferir entre contas' : isRec ? 'Nova receita' : 'Novo lançamento';
    // Transferência não tem categoria: o dinheiro só muda de lugar
    $('#wrap-cat').hidden = isTransf;
    $('#lbl-cat').innerHTML = (isRec ? 'De onde veio' : 'Categoria') + ' <span class="muted" id="cat-auto"></span>';
    if (!isTransf) montarCategorias(isRec ? 'Receita' : 'Despesa');
    $('#wrap-to-account').hidden = !isTransf;
    $('#lbl-method').textContent = isRec ? 'Entrou por' : 'Pagamento';
    $('#lbl-rec').textContent = isRec ? 'Receita mensal fixa (ex: salário)?' : 'Custo fixo mensal (recorrente)?';
    $('#f-desc').placeholder = isTransf ? 'Ex: Guardar na reserva, Poupança do mês…'
      : isRec ? 'Ex: Salário, Freelance, Reembolso…' : 'Ex: Mercado, Uber, Farmácia…';
    $('#f-status').options[0].textContent = isRec ? 'Recebido' : 'Pago';
    $('#f-status').options[1].textContent = isRec ? 'A Receber' : 'A Pagar';

    // Numa transferência, o que importa é de onde sai e para onde vai
    for (const id of ['#lbl-status', '#wrap-scope', '#wrap-member', '#lbl-rec']) {
      const el = $(id); if (el) el.hidden = isTransf;
    }
    $('#f-status').hidden = isTransf;
    $('#f-rec').hidden = isTransf;
    $('#wrap-method').hidden = isTransf;
    $('#lbl-account').innerHTML = isTransf ? 'De qual conta' : 'Conta <span class="muted">— o saldo é ajustado sozinho</span>';
    if (isTransf) {
      $('#wrap-account').hidden = false;
      $('#wrap-card').hidden = true;
      if ($('#wrap-parc')) $('#wrap-parc').hidden = true;
    }
    if (isRec && $('#wrap-parc')) $('#wrap-parc').hidden = true;
  };

  const applyScope = v => {
    const pessoal = v === 'Pessoal';
    $('#wrap-member').hidden = !pessoal;
    if (!pessoal) {
      $('#member-hint').textContent = '';
      return;
    }
    $('#member-hint').textContent = pessoas.length
      ? 'Gastos pessoais aparecem separados nos relatórios por membro.'
      : 'Nenhum membro cadastrado — adicione em Configurações → Membros.';
  };

  const applyMethod = v => {
    const isCard = v === 'Cartão de Crédito';
    $('#wrap-card').hidden = !isCard;
    $('#wrap-account').hidden = isCard;
    if ($('#wrap-parc')) $('#wrap-parc').hidden = !isCard || chipValue('g-type') === 'Receita';
    showFatura();
  };

  // Mostra em qual fatura a compra vai cair — tira a dúvida do ciclo de fechamento
  const showFatura = () => {
    const hint = $('#fatura-hint');
    if (!hint || $('#wrap-card').hidden) return;
    const card = DB.get('cards', $('#f-card').value);
    const date = $('#f-date').value;
    if (!card || !date) { hint.textContent = ''; return; }
    const { due } = DB.invoiceDates(card, DB.invoiceKeyFor(card, date));
    hint.innerHTML = `Cai na fatura que vence em <b>${due.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}</b>.`;
  };

  /* Categoria: 3 botões mais usados + "Outra" abrindo a lista completa */
  /* Monta chips e dropdown para o tipo pedido. Reconstruir em vez de guardar as
     duas listas prontas: são poucas dezenas de opções, e assim "as 3 mais usadas"
     é calculado sobre o lado certo — as mais usadas em gastos não têm relação com
     as mais usadas em entradas. */
  let tipoCatAtual = null;
  const montarCategorias = tipo => {
    if (tipoCatAtual === tipo) return;             // já está montado: não mexe na escolha
    tipoCatAtual = tipo;
    const escolhida = DB.get('categories', tx.category_id) && DB.categoryType(DB.categoryRoot(tx.category_id)) === tipo
      ? tx.category_id : '';
    const top = topCategoryIds(3, escolhida, tipo);
    $('#g-cat').innerHTML = top.map(id => {
      const c = DB.get('categories', id);
      return c ? `<button type="button" class="chip" data-v="${id}" title="${esc(DB.categoryPath(id))}">${esc(DB.categoryIcon(id))} ${esc(c.name)}</button>` : '';
    }).join('') + '<button type="button" class="chip chip-more" id="cat-other" data-v="">Outra ▾</button>';
    $('#f-cat-more').innerHTML = `<option value="">— escolha a categoria —</option>${optionsCategorias(escolhida, tipo)}`;
    if (typeof UI !== 'undefined') {
      $('#f-cat-more').removeAttribute('data-ui');   // o select mudou: precisa ser reembrulhado
      UI.enhance($('#wrap-cat'));
    }
    ligarChipsCategoria();
    setCategory(escolhida);
  };

  const setCategory = id => {
    let achou = false;
    document.querySelectorAll('#g-cat .chip').forEach(ch => {
      if (ch.id === 'cat-other') return;
      const match = !!id && ch.dataset.v === id;
      ch.classList.toggle('active', match);
      if (match) achou = true;
    });
    const outra = $('#cat-other');
    if (id && !achou) {                       // fora do top 3: vira o rótulo do botão "Outra"
      const c = DB.get('categories', id);
      outra.dataset.v = id;
      // No chip vai só o nome (o caminho não caberia); o envelope fica no title
      outra.textContent = c ? `${DB.categoryIcon(id)} ${c.name}` : 'Outra ▾';
      outra.title = c ? DB.categoryPath(id) : '';
      outra.classList.add('active');
      $('#f-cat-more').value = id;
    } else {
      outra.dataset.v = '';
      outra.textContent = 'Outra ▾';
      outra.classList.remove('active');
    }
    $('#f-cat-more').hidden = true;
  };
  // A partir do momento em que a pessoa escolhe categoria ou forma de pagamento,
  // o preenchimento automático não mexe mais nesses campos.
  let catManual = !!tx.category_id;
  let methodManual = isEdit;

  // Reatribuído a cada remontagem da lista, porque os chips são recriados
  function ligarChipsCategoria() {
    bindChips('g-cat', v => {
      const auto = $('#cat-auto'); if (auto) auto.textContent = '';
      if (v) catManual = true;                       // escolheu um dos botões
      // O seletor completo só existe quando a pessoa pede por ele em "Outra"
      const abriu = $('#cat-other').classList.contains('active') && !$('#cat-other').dataset.v;
      $('#f-cat-more').hidden = !abriu;
      if (abriu && typeof UI !== 'undefined') setTimeout(() => UI.open($('#f-cat-more')), 30);
    });
    $('#f-cat-more').onchange = e => {
      if (!e.target.value) return;
      catManual = true;                              // escolheu pelo dropdown
      const auto = $('#cat-auto'); if (auto) auto.textContent = '';
      setCategory(e.target.value);
    };
  }

  /* Etiquetas: os chips ligam e desligam, e o campo cria novas. Chip em vez de
     texto separado por vírgula porque assim as que já existem na família são
     reaproveitadas, em vez de virarem "viagem", "Viagem" e "viagens". */
  const chipsTags = () => $('#g-tags');
  const addTag = nome => {
    const tag = DB.normTag(nome);
    if (!tag) return;
    const existe = [...chipsTags().querySelectorAll('.chip-tag')]
      .find(c => DB._semAcento(c.dataset.v) === DB._semAcento(tag));
    if (existe) { existe.classList.add('active'); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip chip-tag active';
    b.dataset.v = tag;
    b.textContent = '#' + tag;
    b.onclick = () => b.classList.toggle('active');
    chipsTags().appendChild(b);
  };
  chipsTags().querySelectorAll('.chip-tag').forEach(c => { c.onclick = () => c.classList.toggle('active'); });
  const btnFixar = $('#tag-fixar');
  if (btnFixar) btnFixar.onclick = () => btnFixar.classList.toggle('active');
  const campoTag = $('#f-tag-nova');
  campoTag.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault(); e.stopPropagation();      // Enter aqui não pode salvar a folha
    addTag(campoTag.value); campoTag.value = '';
  };
  campoTag.onblur = () => { if (campoTag.value.trim()) { addTag(campoTag.value); campoTag.value = ''; } };
  const tagsEscolhidas = () =>
    [...chipsTags().querySelectorAll('.chip-tag.active')].map(c => c.dataset.v);
  // Salvar é o momento de gravar (ou soltar) o que fica fixado para os próximos
  const aplicarFixacao = () => {
    if (!btnFixar) return;                                  // editando: não mexe na fixação
    fixarTags(btnFixar.classList.contains('active') ? tagsEscolhidas() : []);
  };

  // A folha inteira veste a cor do tipo escolhido (faixa, valor e botão salvar)
  const pintarTipo = v => { $('#sheet').dataset.tipo = v || 'Despesa'; };
  bindChips('g-type', v => { pintarTipo(v); applyType(v); applyMethod(chipValue('g-method')); });
  pintarTipo(tx.type || 'Despesa');
  bindChips('g-scope', applyScope);
  bindChips('g-method', v => { methodManual = true; applyMethod(v); });
  applyType(tx.type || 'Despesa');
  applyScope(tx.scope || 'Família');

  // Atalhos de data
  document.querySelectorAll('#g-day .chip').forEach(ch => ch.onclick = () => {
    const d = new Date();
    d.setDate(d.getDate() - Number(ch.dataset.d));
    const campo = $('#f-date');
    campo.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (campo._uiRefresh) campo._uiRefresh();   // atualiza o rótulo do datepicker
    showFatura();
  });
  $('#f-date').addEventListener('change', showFatura);
  $('#f-card').addEventListener('change', showFatura);

  // Descrição: sugere categoria e repete os dados do último lançamento igual
  const desc = $('#f-desc');
  desc.addEventListener('input', () => {
    const texto = desc.value.trim();
    if (!texto || chipValue('g-type') === 'Receita') return;

    const anterior = historico.find(h => h.description.toLowerCase() === texto.toLowerCase());
    if (anterior) {                       // já lançou isso antes: repete o que ainda não foi escolhido
      if (!catManual && anterior.category_id) {
        setCategory(anterior.category_id);
        $('#cat-auto').textContent = '· repetido do último lançamento igual';
      }
      if (!methodManual && anterior.method && METHODS.includes(anterior.method)) {
        selectChip('g-method', anterior.method);
        applyMethod(anterior.method);
      }
      if (!moneyVal('#f-amount') && anterior.amount) initMoney('#f-amount', anterior.amount);
      return;
    }

    if (catManual) return;                // escolha da pessoa tem prioridade sobre qualquer sugestão
    // Lista completa (não só as folhas): a adivinhação precisa dos pais para
    // distinguir subcategorias de mesmo nome em envelopes diferentes
    const guess = OFX.guessCategoryId(texto, DB.all('categories'));
    if (guess) { setCategory(guess); $('#cat-auto').textContent = '· sugerida automaticamente'; }
  });

  initMoney('#f-amount', tx.amount);
  showFatura();
  const parcSel = $('#f-parc');
  if (parcSel) {
    const showParc = () => {
      const n = parseInt(parcSel.value) || 1;
      const v = moneyVal('#f-amount');
      $('#parc-hint').innerHTML = n > 1 && v > 0
        ? `${n}x de <b>${fmt(v / n)}</b> — uma parcela por fatura, a partir desta compra.`
        : 'Informe o <b>valor total</b> da compra — o app divide nas faturas seguintes.';
    };
    parcSel.onchange = showParc;
    $('#f-amount').addEventListener('input', showParc);
  }
  $('#sh-close').onclick = closeSheet;
  setTimeout(() => $('#f-amount').focus(), 80);

  const salvar = () => {
    const amount = moneyVal('#f-amount');
    const descricao = $('#f-desc').value.trim();
    if (!amount || amount <= 0) { $('#f-amount').focus(); return toast('Informe o valor'); }
    if (!descricao) { $('#f-desc').focus(); return toast('Informe a descrição'); }

    // Transferência: só precisa de valor, origem e destino
    if (chipValue('g-type') === 'Transferência') {
      const de = $('#f-account').value, para = $('#f-to-account').value;
      if (!de) { $('#f-account').focus(); return toast('Escolha de qual conta o dinheiro sai'); }
      if (!para) { $('#f-to-account').focus(); return toast('Escolha para qual conta o dinheiro vai'); }
      if (de === para) return toast('Escolha contas diferentes');
      const transf = {
        ...tx, description: descricao, amount, date: $('#f-date').value || todayISO(),
        type: 'Transferência', status: 'Pago', method: 'Transferência',
        account_id: de, to_account: para,
        scope: 'Família', member: MEMBRO_COMUM,
        category_id: null, card_id: null, invoice_key: '', recurring: false, adjustment: false,
        tags: tagsEscolhidas(),
      };
      if (orig) applyTxEffect(orig, -1);
      DB.upsert('transactions', transf);
      applyTxEffect(transf, +1);
      aplicarFixacao();
      closeSheet(); render(); Sync.autoSync();
      return toast(`${fmt(amount)} transferido ✓`);
    }

    // Âmbito e membro andam juntos: Família ⇒ comum; Pessoal ⇒ exige a pessoa
    const scope = chipValue('g-scope') || 'Família';
    let member = MEMBRO_COMUM;
    if (scope === 'Pessoal') {
      member = $('#f-member').value;
      if (!member) {
        if (!pessoas.length) return toast('Cadastre os membros em Configurações → Membros');
        $('#wrap-member').hidden = false;
        $('#f-member').focus();
        return toast('Escolha de quem é este gasto pessoal');
      }
    }

    const isReceita = chipValue('g-type') === 'Receita';
    const method = chipValue('g-method');
    const rec = {
      ...tx,
      description: descricao, amount, date: $('#f-date').value || todayISO(),
      status: $('#f-status').value, method,
      scope, member,
      category_id: chipValue('g-cat') || null,
      recurring: !!$('#f-rec').value,
      type: isReceita ? 'Receita' : 'Despesa',
      tags: tagsEscolhidas(),
      adjustment: false,        // classificar um ajuste o transforma em lançamento normal
      card_id: null, account_id: null, to_account: null, invoice_key: '',
    };
    if (method === 'Cartão de Crédito') {
      const card = DB.get('cards', $('#f-card').value);
      if (!card) return toast('Cadastre um cartão em ⚙︎ primeiro');
      rec.card_id = card.id;
      rec.invoice_key = DB.invoiceKeyFor(card, rec.date);

      // Compra parcelada: gera uma parcela por fatura, com os centavos ajustados na 1ª
      const parcelas = Math.max(1, Math.min(24, parseInt((parcSel || {}).value) || 1));
      if (!isEdit && !isReceita && parcelas > 1) {
        const group = DB.uuid();
        const cents = Math.round(amount * 100);
        const base = Math.floor(cents / parcelas);
        const resto = cents - base * parcelas;
        const d0 = new Date(rec.date + 'T12:00:00');
        for (let i = 0; i < parcelas; i++) {
          const di = new Date(d0.getFullYear(), d0.getMonth() + i, d0.getDate());
          const iso = `${di.getFullYear()}-${String(di.getMonth() + 1).padStart(2, '0')}-${String(di.getDate()).padStart(2, '0')}`;
          DB.upsert('transactions', {
            ...rec, id: null,
            description: `${desc} (${i + 1}/${parcelas})`,
            amount: (base + (i === 0 ? resto : 0)) / 100,
            date: iso,
            invoice_key: DB.invoiceKeyFor(card, iso),
            group_id: group, installment: `${i + 1}/${parcelas}`,
          });
        }
        aplicarFixacao();
        closeSheet(); render(); Sync.autoSync();
        toast(`Parcelado em ${parcelas}x de ${fmtShort(amount / parcelas)} ✓`);
        return;
      }
    } else {
      rec.account_id = $('#f-account').value || null;
    }
    if (orig) applyTxEffect(orig, -1);   // reverte efeito antigo (inclui transferências)
    DB.upsert('transactions', rec);
    applyTxEffect(rec, +1);              // aplica efeito novo
    aplicarFixacao();
    closeSheet(); render(); Sync.autoSync();
    toast(isEdit ? 'Lançamento atualizado ✓' : (isReceita ? 'Receita lançada ✓' : 'Gasto lançado ✓'));
  };
  $('#sh-save').onclick = salvar;

  // Repetir: abre um novo lançamento já preenchido com os mesmos dados, na data de hoje
  const dup = $('#sh-dup');
  if (dup) dup.onclick = () => {
    const copia = { ...tx, date: todayISO(), status: 'Pago' };
    delete copia.id; delete copia.updated_at; delete copia.dirty;
    delete copia.fitid; delete copia.group_id; delete copia.installment;
    copia.description = copia.description.replace(/\s*\(\d+\/\d+\)$/, '');
    closeSheet();
    setTimeout(() => openTxSheet(copia, true), 60);   // abre como NOVO já preenchido
  };
  const del = $('#sh-del');
  if (del) del.onclick = () => {
    const irmas = tx.group_id ? DB.all('transactions').filter(t => t.group_id === tx.group_id) : [];
    if (irmas.length > 1) {
      if (confirm(`Faz parte de uma compra parcelada (${irmas.length}x). Excluir TODAS as parcelas?\n\nCancelar exclui só esta parcela.`)) {
        irmas.forEach(g => { applyTxEffect(g, -1); DB.remove('transactions', g.id); });
        closeSheet(); render(); Sync.autoSync();
        return toast(`${irmas.length} parcelas excluídas`);
      }
    } else if (!confirm('Excluir este lançamento?')) return;
    if (orig) applyTxEffect(orig, -1);   // devolve ao saldo
    DB.remove('transactions', tx.id);
    closeSheet(); render(); Sync.autoSync();
    toast('Excluído');
  };
}

/* ---------- Saldo rápido e transferência entre contas ---------- */
function openSaldoSheet(accountId) {
  const a = DB.get('accounts', accountId);
  if (!a) return;
  openSheet(`
    <div class="sheet-title">Saldo — ${esc(a.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:10px">Confira no app do banco e informe o saldo real. É a conciliação que mantém o <b>disponível para usar</b> confiável.</p>
    <div class="field"><input class="amount-input" id="s-bal" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <p class="muted" id="s-delta" style="margin-bottom:10px"></p>
    <button class="btn" id="sh-save">Conciliar saldo</button>
    <div class="btn-row"><button class="btn ghost" id="sh-edit">Editar conta</button></div>
  `);
  initMoney('#s-bal', a.balance);
  const mostrarDelta = () => {
    const d = moneyVal('#s-bal') - (Number(a.balance) || 0);
    $('#s-delta').innerHTML = Math.abs(d) < 0.005
      ? 'Saldo registrado no app: <b>' + fmt(a.balance) + '</b>'
      : `Diferença de <b class="${d > 0 ? 'txt-green' : 'txt-red'}">${d > 0 ? '+' : '−'} ${fmt(Math.abs(d))}</b> — será lançada como <b>Ajuste de saldo</b> no extrato, para não sumir sem explicação.`;
  };
  mostrarDelta();
  $('#s-bal').addEventListener('input', mostrarDelta);
  $('#sh-close').onclick = closeSheet;
  $('#sh-edit').onclick = () => { closeSheet(); openConfigSection('accounts'); };
  $('#sh-save').onclick = () => {
    const delta = reconcileBalance(a, moneyVal('#s-bal'));
    closeSheet(); render(); Sync.autoSync();
    toast(delta ? `Ajuste de ${fmt(Math.abs(delta))} lançado no extrato ✓` : 'Saldo já estava correto');
  };
}

function openTransferSheet(destinoId, titulo) {
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const opts = sel => contas.map(a =>
    `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('');
  // Origem sugerida: a primeira conta que não é o destino
  const origem = (contas.find(a => a.id !== destinoId) || {}).id;
  openSheet(`
    <div class="sheet-title">${esc(titulo || 'Transferir entre contas')}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:10px">Mover dinheiro entre suas contas <b>não é despesa nem receita</b> — só ajusta os saldos, sem poluir seus relatórios.</p>
    <div class="field"><input class="amount-input" id="t-val" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="field"><label>De</label><select id="t-from">${opts(origem)}</select></div>
    <div class="field"><label>Para</label><select id="t-to">${opts(destinoId)}</select></div>
    <button class="btn" id="sh-save">Transferir</button>
  `);
  initMoney('#t-val');
  if (!destinoId && $('#t-to').options.length > 1) $('#t-to').selectedIndex = 1;
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const valor = moneyVal('#t-val');
    const de = $('#t-from').value, para = $('#t-to').value;
    if (!valor) return toast('Informe o valor');
    if (de === para) return toast('Escolha contas diferentes');
    adjustBalance(de, -valor);
    adjustBalance(para, valor);
    closeSheet(); render(); Sync.autoSync();
    toast('Transferência registrada ✓');
  };
}

/* ---------- Sheets de metas ---------- */
function openGoalSheet(goal) {
  const isEdit = !!goal;
  goal = goal || { name: '', icon: '🎯', target_amount: '', target_date: '', done: false };
  openSheet(`
    <div class="sheet-title">${isEdit ? 'Editar meta' : 'Nova meta'}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="row2">
      <div class="field"><label>Ícone</label><input id="g-icon" value="${esc(goal.icon)}" maxlength="4"></div>
      <div class="field"><label>Nome</label><input id="g-name" placeholder="Ex: Viagem Nordeste" value="${esc(goal.name)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Valor alvo</label><input id="g-target" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
      <div class="field"><label>Data alvo</label><input id="g-date" type="date" value="${goal.target_date || ''}"></div>
    </div>
    ${isEdit ? `<div class="field"><label>Concluída</label><select id="g-done"><option value="">Não</option><option value="1" ${goal.done ? 'selected' : ''}>Sim</option></select></div>` : ''}
    <button class="btn" id="sh-save">Salvar</button>
    ${isEdit ? '<div class="btn-row"><button class="btn danger" id="sh-del">Excluir meta</button></div>' : ''}
  `);
  initMoney('#g-target', goal.target_amount);
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const name = $('#g-name').value.trim();
    if (!name) return toast('Dê um nome à meta');
    DB.upsert('goals', {
      ...goal, name, icon: $('#g-icon').value || '🎯',
      target_amount: moneyVal('#g-target'),
      target_date: $('#g-date').value || null,
      done: isEdit ? !!$('#g-done').value : false,
    });
    closeSheet(); render(); Sync.autoSync();
  };
  const del = $('#sh-del');
  if (del) del.onclick = () => {
    if (!confirm('Excluir esta meta e seus aportes?')) return;
    DB.all('goal_entries').filter(e => e.goal_id === goal.id).forEach(e => DB.remove('goal_entries', e.id));
    DB.remove('goals', goal.id);
    closeSheet(); render(); Sync.autoSync();
  };
}

/* ---------- Detalhe da fatura: todos os lançamentos que a compõem ---------- */
function openInvoiceDetail(key) {
  const card = DB.get('cards', key.split(':')[0]);
  if (!card) return toast('Cartão não encontrado');
  const inv = DB.invoicesOf(card).find(i => i.key === key);
  if (!inv) return toast('Fatura não encontrada');
  const itens = DB.all('transactions').filter(t => t.invoice_key === key)
    .sort((a, b) => b.date.localeCompare(a.date));

  openModal(`
    <div class="modal-title">${esc(card.name)} — fatura<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <div class="card" style="margin-bottom:14px">
      <div class="proj-row"><span>Total</span><b>${fmt(inv.total)}</b></div>
      <div class="proj-row"><span>Fecha</span><b>${inv.closing.toLocaleDateString('pt-BR')}</b></div>
      <div class="proj-row"><span>Vence</span><b>${inv.due.toLocaleDateString('pt-BR')}</b></div>
      <div class="proj-row"><span>Situação</span><span class="badge ${inv.status.toLowerCase()}">${inv.status}</span></div>
    </div>
    <p class="section-title">${itens.length} lançamento(s) <span class="muted">— toque para editar</span></p>
    ${itens.map(t => {
      const c = catOf(t.category_id);
      const isExp = DB.isExpense(t);
      return `<div class="tx" data-inv-tx="${t.id}">
        <span class="tx-ico">${isExp ? esc(c ? c.icon : '🧾') : '↩️'}</span>
        <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
        <span class="tx-meta">${fmtDay(t.date)}${t.member && t.member !== MEMBRO_COMUM ? ' · ' + esc(t.member) : ''}${t.installment ? ' · parcela ' + esc(t.installment) : ''}</span></span>
        <span class="tx-amount ${isExp ? '' : 'income'}">${isExp ? '' : '− '}${fmt(t.amount)}</span>
      </div>`;
    }).join('') || '<div class="empty">Nenhum lançamento nesta fatura.</div>'}
  `);
  $('#md-back').onclick = closeModal;
  document.querySelectorAll('#modal [data-inv-tx]').forEach(el =>
    el.onclick = () => { closeModal(); openTxSheet(DB.get('transactions', el.dataset.invTx)); });
}

/* ---------- Detalhe da meta: histórico completo de aportes ---------- */
function openGoalDetail(goalId) {
  const g = DB.get('goals', goalId);
  if (!g) return toast('Meta não encontrada');
  const entries = DB.all('goal_entries').filter(e => e.goal_id === goalId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = DB.goalTotal(goalId);
  const alvo = Number(g.target_amount) || 0;
  const falta = Math.max(0, alvo - total);
  const pct = alvo > 0 ? Math.round(total / alvo * 100) : 0;
  const pace = DB.goalPace(goalId);

  // Agrupa por mês, com subtotal — mostra a constância dos aportes
  let lista = '', mesAtual = '';
  for (const e of entries) {
    const mes = e.date.slice(0, 7);
    if (mes !== mesAtual) {
      mesAtual = mes;
      const soma = entries.filter(x => x.date.slice(0, 7) === mes).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const nome = new Date(mes + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      lista += `<p class="tx-day">${esc(nome.charAt(0).toUpperCase() + nome.slice(1))} · ${fmtShort(soma)}</p>`;
    }
    lista += `<div class="tx" data-entry="${e.id}">
      <span class="tx-ico">💰</span>
      <span class="tx-info"><span class="tx-name">${esc(e.description || 'Aporte')}</span>
      <span class="tx-meta">${fmtDay(e.date)}</span></span>
      <span class="tx-amount income">+ ${fmt(e.amount)}</span>
    </div>`;
  }

  const previsao = falta > 0 && pace > 0
    ? new Date(Date.now() + (falta / pace) * 30.44 * 86400000).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : null;

  openModal(`
    <div class="modal-title">${esc(g.icon)} ${esc(g.name)}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <div class="card" style="margin-bottom:14px">
      <div class="proj-row"><span>Guardado</span><b class="txt-green">${fmt(total)}</b></div>
      <div class="proj-row"><span>Meta</span><b>${fmt(alvo)}</b></div>
      <div class="proj-row"><span>Falta</span><b class="${falta ? '' : 'txt-green'}">${falta ? fmt(falta) : 'nada — meta atingida! 🎉'}</b></div>
      <div class="bar ${pct >= 100 ? 'bar-green' : pct >= 50 ? 'bar-green' : 'bar-amber'}" style="margin:10px 0 6px"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="proj-row muted"><span>${pct}% concluído · ${entries.length} aporte(s)</span>
        <span>${pace > 0 ? `ritmo ${fmtShort(pace)}/mês` : 'sem aportes recentes'}</span></div>
      ${previsao ? `<p class="muted" style="margin-top:6px">📈 Nesse ritmo, conclusão prevista para <b>${previsao}</b>.</p>` : ''}
      ${g.target_date && falta > 0 ? `<p class="muted">🎯 Para cumprir até ${fmtDay(g.target_date)}: <b>${fmtShort(falta / Math.max(0.5, (new Date(g.target_date) - Date.now()) / (30.44 * 86400000)))}/mês</b></p>` : ''}
    </div>
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn" id="gd-novo">＋ Novo aporte</button>
      <button class="btn ghost" id="gd-edit">Editar meta</button>
    </div>
    <p class="section-title">Histórico completo <span class="muted">— toque para corrigir</span></p>
    ${lista || '<div class="empty"><b>Nenhum aporte ainda</b>Registre o primeiro para começar a acompanhar o progresso.</div>'}
  `);
  $('#md-back').onclick = closeModal;
  $('#gd-novo').onclick = () => { closeModal(); openAporteSheet(goalId); };
  $('#gd-edit').onclick = () => { closeModal(); openGoalSheet(DB.get('goals', goalId)); };
  document.querySelectorAll('#modal [data-entry]').forEach(el =>
    el.onclick = () => openEntrySheet(el.dataset.entry, goalId));
}

/* Editar/excluir um aporte, revertendo o que ele movimentou nas contas */
function openEntrySheet(entryId, goalId) {
  const e = DB.get('goal_entries', entryId);
  if (!e) return toast('Aporte não encontrado');
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const nomeConta = id => (DB.get('accounts', id) || {}).name;
  const movimento = [e.from_account && `saiu de ${nomeConta(e.from_account)}`, e.to_account && `entrou em ${nomeConta(e.to_account)}`]
    .filter(Boolean).join(' · ');

  openSheet(`
    <div class="sheet-title">Corrigir aporte<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><input class="amount-input" id="e-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="row2">
      <div class="field"><label>Descrição</label><input id="e-desc" value="${esc(e.description || 'Aporte')}"></div>
      <div class="field"><label>Data</label><input id="e-date" type="date" value="${e.date}"></div>
    </div>
    ${movimento ? `<p class="muted" style="margin-bottom:10px">💸 Este aporte movimentou contas (${esc(movimento)}). Alterar o valor ou excluir ajusta os saldos de volta automaticamente.</p>` : ''}
    <button class="btn" id="sh-save">Salvar</button>
    <div class="btn-row"><button class="btn danger" id="sh-del">Excluir aporte</button></div>
  `);
  initMoney('#e-amount', e.amount);
  $('#sh-close').onclick = closeSheet;

  const voltarParaDetalhe = () => { closeSheet(); render(); Sync.autoSync(); openGoalDetail(goalId); };

  $('#sh-save').onclick = () => {
    const novo = moneyVal('#e-amount');
    if (!novo) return toast('Informe o valor');
    const delta = novo - (Number(e.amount) || 0);
    if (delta && e.from_account) adjustBalance(e.from_account, -delta);
    if (delta && e.to_account) adjustBalance(e.to_account, delta);
    DB.upsert('goal_entries', { ...e, amount: novo, description: $('#e-desc').value || 'Aporte', date: $('#e-date').value || e.date });
    voltarParaDetalhe();
    toast('Aporte atualizado ✓');
  };
  $('#sh-del').onclick = () => {
    if (!confirm('Excluir este aporte?')) return;
    if (e.from_account) adjustBalance(e.from_account, Number(e.amount) || 0);   // devolve
    if (e.to_account) adjustBalance(e.to_account, -(Number(e.amount) || 0));
    DB.remove('goal_entries', e.id);
    voltarParaDetalhe();
    toast('Aporte excluído');
  };
}

function openAporteSheet(goalId) {
  const g = DB.get('goals', goalId);
  if (!g) return toast('Meta não encontrada — atualize a tela');
  const ehReserva = g.tipo === 'Reserva de Emergência' || g.type === 'Reserva de Emergência' || /reserva/i.test(g.name);
  openSheet(`
    <div class="sheet-title">Aporte — ${esc(g.icon)} ${esc(g.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><input class="amount-input" id="a-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="row2">
      <div class="field"><label>Descrição</label><input id="a-desc" value="Aporte"></div>
      <div class="field"><label>Data</label><input id="a-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><label>Saiu de qual conta? <span class="muted">— opcional, ajusta o saldo</span></label>
      <select id="a-account"><option value="">— não movimentar contas —</option>
        ${DB.all('accounts').filter(a => a.active !== false).map(a => `<option value="${a.id}">${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}
      </select></div>
    <div class="field"><label>Entrou em qual conta? <span class="muted">— onde o dinheiro ficou guardado</span></label>
      <select id="a-to"><option value="">— não movimentar contas —</option>
        ${DB.all('accounts').filter(a => a.active !== false).map(a =>
          `<option value="${a.id}">${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}
      </select></div>
    ${ehReserva ? '<p class="muted" style="margin-bottom:10px">🛡️ Esta é a sua meta de reserva: guarde o dinheiro numa conta marcada como reserva para a cobertura de meses subir no painel.</p>' : ''}
    <button class="btn" id="sh-save">Registrar aporte</button>
  `);
  initMoney('#a-amount');
  $('#sh-close').onclick = closeSheet;
  setTimeout(() => $('#a-amount').focus(), 80);
  $('#sh-save').onclick = () => {
    const amount = moneyVal('#a-amount');
    if (!amount) return toast('Informe o valor');
    const de = $('#a-account').value, para = $('#a-to').value;
    if (de && de === para) return toast('Origem e destino não podem ser a mesma conta');
    DB.upsert('goal_entries', {
      goal_id: goalId, amount, description: $('#a-desc').value || 'Aporte',
      date: $('#a-date').value || todayISO(),
      from_account: de || null, to_account: para || null,   // guardado para poder reverter depois
    });
    if (de) adjustBalance(de, -amount);      // saiu da conta corrente
    if (para) adjustBalance(para, amount);   // entrou na caixinha/reserva
    closeSheet(); render(); Sync.autoSync();
    toast(de || para ? 'Aporte registrado e saldos ajustados ✓' : 'Aporte registrado ✓');
  };
}

/* ---------- Configurações ---------- */
function openModal(html) {
  $('#modal').innerHTML = `<div class="modal-inner">${html}</div>`;
  $('#modal').hidden = false; $('#modal-backdrop').hidden = false;
  paintIcons($('#modal'));
  if (typeof UI !== 'undefined') UI.enhance($('#modal'));
}
function closeModal() { $('#modal').hidden = true; $('#modal-backdrop').hidden = true; render(); }

function openConfig() {
  const s = Sync.cfg || {};
  openModal(`
    <div class="modal-title">Configurações<button class="close-x" id="md-close"><span data-ico="x"></span></button></div>
    <div class="settings-item" data-go="accounts"><span class="cfg-left"><span class="cfg-ico" data-ico="wallet"></span><span>Contas<br><small>${DB.all('accounts').length} cadastrada(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="cards"><span class="cfg-left"><span class="cfg-ico" data-ico="card"></span><span>Cartões de crédito<br><small>${DB.all('cards').length} cadastrado(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="categories"><span class="cfg-left"><span class="cfg-ico" data-ico="pie"></span><span>Categorias &amp; orçamentos<br><small>${DB.all('categories').length} categoria(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="family"><span class="cfg-left"><span class="cfg-ico" data-ico="users"></span><span>Família &amp; ciclo do mês<br><small>${esc(DB.familyLabel())}${Sync.hasFamily() ? ' · código para convidar' : ' · início no dia ' + DB.settings().month_start_day}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="sync"><span class="cfg-left"><span class="cfg-ico" data-ico="cloud"></span><span>Sincronização<br><small>${Sync.hasFamily() ? 'Conectado como ' + esc(s.user_email || '') : 'Não configurada'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="ofx"><span class="cfg-left"><span class="cfg-ico" data-ico="download"></span><span>Importar extrato OFX<br><small>traga os lançamentos do banco ou cartão de uma vez</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="notif"><span class="cfg-left"><span class="cfg-ico" data-ico="bell"></span><span>Notificações<br><small>${Notif.enabled() ? 'Ativas — faturas, orçamentos e metas' : 'Desativadas'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="security"><span class="cfg-left"><span class="cfg-ico" data-ico="shield"></span><span>Segurança<br><small>${Auth.enabled() ? 'PIN ativo · bloqueia após ' + (Auth.cfg.lockAfterMin ?? 5) + ' min' : 'Sem proteção local'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="backup"><span class="cfg-left"><span class="cfg-ico" data-ico="download"></span><span>Backup (exportar / importar)<br><small>Arquivo JSON local</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item danger-item" data-go="reset"><span class="cfg-left"><span class="cfg-ico t-danger" data-ico="trash"></span><span>Apagar dados deste aparelho<br><small>limpar pelas configurações do celular não funciona</small></span></span><span class="chev" data-ico="chev"></span></div>
  `);
  $('#md-close').onclick = closeModal;
  document.querySelectorAll('[data-go]').forEach(el => el.onclick = () => openConfigSection(el.dataset.go));
}
window.openConfigSection = openConfigSection;

function crudList(store, title, renderRow, openEditor) {
  const rows = DB.all(store).map(r => `
    <div class="settings-item" data-edit="${r.id}"><span>${renderRow(r)}</span><span class="chev" data-ico="chev"></span></div>`).join('');
  openModal(`
    <div class="modal-title">${title}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <button class="btn ghost" id="md-new" style="margin-bottom:12px">＋ Adicionar</button>
    ${rows || '<div class="empty">Nada cadastrado ainda.</div>'}
  `);
  $('#md-back').onclick = openConfig;
  $('#md-new').onclick = () => openEditor(null);
  document.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => openEditor(DB.get(store, el.dataset.edit)));
}

function openConfigSection(sec) {
  if (sec === 'accounts') {
    crudList('accounts', 'Contas',
      a => `${esc(a.name)}<br><small>${esc(a.type)} · ${fmt(a.balance)}</small>`,
      acc => {
        const isEdit = !!acc;
        acc = acc || { name: '', type: 'Conta Corrente', institution: '', balance: 0, active: true };
        openModal(`
          <div class="modal-title">${isEdit ? 'Editar conta' : 'Nova conta'}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
          <div class="field"><label>Nome</label><input id="c-name" value="${esc(acc.name)}"></div>
          <div class="field"><label>Tipo</label><select id="c-type">${['Conta Corrente', 'Carteira Digital', 'Caixinha / Rendimento', 'Investimento'].map(t => `<option ${acc.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Instituição</label><input id="c-inst" value="${esc(acc.institution)}"></div>
          <div class="field"><label>Saldo atual</label><input id="c-bal" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        initMoney('#c-bal', acc.balance);
        $('#md-back').onclick = () => openConfigSection('accounts');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          const saldoInformado = moneyVal('#c-bal');
          // Conta nova: o valor é o saldo de abertura. Conta existente: a diferença
          // vira um lançamento de ajuste, para o extrato continuar explicando o saldo.
          const saldoFinal = isEdit ? (Number(acc.balance) || 0) : saldoInformado;
          DB.upsert('accounts', { ...acc, name: $('#c-name').value.trim(), type: $('#c-type').value, institution: $('#c-inst').value, balance: saldoFinal });
          if (isEdit) reconcileBalance(DB.get('accounts', acc.id), saldoInformado);
          Sync.autoSync(); openConfigSection('accounts');
        };
        const del = $('#md-del');
        if (del) del.onclick = () => { if (confirm('Excluir conta?')) { DB.remove('accounts', acc.id); Sync.autoSync(); openConfigSection('accounts'); } };
      });
  }

  if (sec === 'cards') {
    crudList('cards', 'Cartões de crédito',
      c => `${esc(c.name)}<br><small>fecha dia ${c.closing_day} · vence dia ${c.due_day} · limite ${fmtShort(c.limit_amount)}</small>`,
      card => {
        const isEdit = !!card;
        card = card || { name: '', brand: '', limit_amount: 0, closing_day: 25, due_day: 5, active: true };
        openModal(`
          <div class="modal-title">${isEdit ? 'Editar cartão' : 'Novo cartão'}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
          <div class="field"><label>Nome</label><input id="c-name" placeholder="Ex: Nubank" value="${esc(card.name)}"></div>
          <div class="field"><label>Bandeira</label><input id="c-brand" placeholder="Mastercard, Visa…" value="${esc(card.brand)}"></div>
          <div class="row2">
            <div class="field"><label>Dia de fechamento</label><input id="c-close" type="number" min="1" max="28" value="${card.closing_day}"></div>
            <div class="field"><label>Dia de vencimento</label><input id="c-due" type="number" min="1" max="28" value="${card.due_day}"></div>
          </div>
          <div class="field"><label>Limite</label><input id="c-limit" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
          <div class="field"><label>Conta de pagamento (debita o saldo ao pagar a fatura)</label>
            <select id="c-account"><option value="">— nenhuma —</option>${DB.all('accounts').map(a => `<option value="${a.id}" ${card.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        initMoney('#c-limit', card.limit_amount);
        $('#md-back').onclick = () => openConfigSection('cards');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          DB.upsert('cards', {
            ...card, name: $('#c-name').value.trim(), brand: $('#c-brand').value,
            closing_day: Math.min(28, Math.max(1, parseInt($('#c-close').value) || 25)),
            due_day: Math.min(28, Math.max(1, parseInt($('#c-due').value) || 5)),
            limit_amount: moneyVal('#c-limit'),
            account_id: $('#c-account').value || null,
          });
          Sync.autoSync(); openConfigSection('cards');
        };
        const del = $('#md-del');
        if (del) del.onclick = () => { if (confirm('Excluir cartão?')) { DB.remove('cards', card.id); Sync.autoSync(); openConfigSection('cards'); } };
      });
  }

  if (sec === 'categories') {
    openCategoriesConfig();
  }

  if (sec === 'family') {
    const s = DB.settings();
    openModal(`
      <div class="modal-title">Família & ciclo<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      ${blocoConvite()}
      <div class="field"><label>Nome da família</label><input id="f-famname" placeholder="Ex: Nossa casa, Família Silva…" value="${esc(s.family_name || '')}">
        <p class="muted" style="margin-top:6px">Aparece no topo do app e no menu lateral.</p></div>
      <div class="field"><label>Membros (um por linha)</label><textarea id="f-members" rows="4" placeholder="Ex:&#10;Ana&#10;Carlos">${esc((s.members || []).join('\n'))}</textarea>
        <p class="muted" style="margin-top:6px">Quem pode aparecer como responsável por um gasto pessoal.</p></div>
      <div class="field"><label>Dia de início do mês financeiro</label><input id="f-start" type="number" min="1" max="28" value="${s.month_start_day}">
        <p class="muted" style="margin-top:6px">1 = mês calendário. Ex: 5 = período do dia 5 ao dia 4 do mês seguinte (útil para quem se organiza pelo salário).</p></div>
      <div class="field"><label>Renda mensal da família (líquida)</label><input id="f-income" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00">
        <p class="muted" style="margin-top:6px">Base para a projeção vs. renda, taxa de poupança e regra 50/30/20 no painel.</p></div>
      <button class="btn" id="md-save">Salvar</button>
    `);
    initMoney('#f-income', s.monthly_income);
    ligarConvite();
    $('#md-back').onclick = openConfig;
    $('#md-save').onclick = () => {
      const members = $('#f-members').value.split('\n').map(x => x.trim()).filter(Boolean);
      DB.upsert('family_settings', {
        ...s,
        family_name: ($('#f-famname').value || '').trim(),
        members,
        month_start_day: Math.min(28, Math.max(1, parseInt($('#f-start').value) || 1)),
        monthly_income: moneyVal('#f-income'),
      });
      Sync.autoSync(); toast('Salvo'); openConfig();
    };
  }

  if (sec === 'sync') openSyncConfig();

  if (sec === 'ofx') openOfxImport();

  if (sec === 'notif') {
    openModal(`
      <div class="modal-title">🔔 Notificações<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <p class="muted" style="margin-bottom:12px">Avisos de ações importantes: fatura fechando/vencendo/vencida, orçamento estourado e meta atingida. Cada aviso sai no máximo 1x por dia.</p>

      <p class="section-title" style="margin-bottom:8px">1. Avisos ao abrir o app</p>
      ${Notif.enabled()
        ? '<button class="btn danger" id="nt-off">Desativar</button>'
        : '<button class="btn" id="nt-on">Ativar</button>'}
      <div class="btn-row"><button class="btn ghost" id="nt-test">Testar agora</button></div>

      <hr class="sep">
      <p class="section-title" style="margin-bottom:8px">2. Push automático (app fechado)</p>
      <p class="muted" style="margin-bottom:10px">O servidor verifica suas faturas e orçamentos todo dia e avisa mesmo com o app fechado. Exige sincronização configurada e o passo a passo do README (Edge Function + cron no Supabase).</p>
      <p class="muted" style="margin-bottom:10px">Estado deste aparelho: <b id="nt-push-state">verificando…</b></p>
      <button class="btn" id="nt-push-on">Ativar push neste aparelho</button>
      <div class="btn-row"><button class="btn ghost" id="nt-push-off">Desativar push aqui</button></div>
      <p class="muted" style="margin-top:10px">📱 No iPhone, o push só funciona depois de adicionar o app à tela de início (iOS 16.4+).</p>
    `);
    $('#md-back').onclick = openConfig;
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    Notif.pushState().then(st => {
      const el = $('#nt-push-state');
      if (el) el.textContent = st === 'on' ? 'ativo ✓' : st === 'unsupported' ? 'não suportado neste navegador' : 'inativo';
    });
    on('#nt-push-on', async () => {
      try { await Notif.subscribePush(); toast('Push ativado neste aparelho ✓'); }
      catch (e) { toast(e.message); }
      openConfigSection('notif');
    });
    on('#nt-push-off', async () => {
      try { await Notif.unsubscribePush(); toast('Push desativado neste aparelho'); }
      catch (e) { toast(e.message); }
      openConfigSection('notif');
    });
    on('#nt-on', async () => {
      const ok = await Notif.enable();
      toast(ok ? 'Notificações ativas ✓' : 'Permissão negada pelo navegador');
      openConfigSection('notif');
    });
    on('#nt-off', () => { Notif.disable(); toast('Notificações desativadas'); openConfigSection('notif'); });
    on('#nt-test', () => {
      delete (Notif.cfg.sent || {})['teste']; Notif.save();
      Notif.push('teste', '💰 Finanças da Família', 'Notificações funcionando! Você será avisado de faturas, orçamentos e metas.');
    });
  }

  if (sec === 'security') {
    openModal(`
      <div class="modal-title">🔒 Segurança<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <p class="muted" style="margin-bottom:12px">O PIN não é só uma tela de bloqueio: ele deriva uma chave <b>AES-256</b> (PBKDF2) que <b>criptografa os dados guardados neste aparelho</b> — sem o PIN, o conteúdo é ilegível. Após 5 erros, o app bloqueia por tempo progressivo. A nuvem tem camada própria: login e-mail/senha + regras por família (RLS) no Supabase.</p>
      ${Auth.enabled() ? `
        <div class="settings-item" id="sec-trocar"><span class="cfg-left"><span class="cfg-ico" data-ico="lock"></span><span>Trocar o PIN<br><small>abre o teclado para escolher um novo</small></span></span><span class="chev" data-ico="chev"></span></div>
        <div class="field" style="margin-top:12px"><label>Bloquear após (minutos em segundo plano)</label><input id="sec-min" type="number" min="0" max="120" value="${Auth.cfg.lockAfterMin ?? 5}"></div>
        <button class="btn" id="sec-save">Salvar tempo de bloqueio</button>
        <hr class="sep">
        <p class="section-title" style="margin-bottom:8px">👆 Desbloqueio por digital</p>
        ${Auth.bioAtiva()
          ? '<p class="muted" style="margin-bottom:10px">Ativo neste aparelho — o app pede a digital ao abrir e o PIN continua valendo como alternativa.</p><button class="btn ghost" id="sec-bio-off">Desativar digital</button>'
          : Auth.cfg.bioIndisponivel
            ? '<p class="bio-indisponivel">Este navegador ainda não permite usar a digital para proteger dados (falta suporte a PRF). Continue com o PIN.</p>'
            : '<p class="muted" style="margin-bottom:10px">Use a digital (ou o rosto) em vez de digitar o PIN toda vez. A criptografia continua a mesma: o leitor do aparelho guarda o segredo que abre a chave.</p><button class="btn ghost" id="sec-bio-on">Ativar digital neste aparelho</button>'}
        <div class="btn-row"><button class="btn danger" id="sec-off">Remover PIN</button></div>
      ` : `
        <button class="btn" id="sec-on">Criar PIN e proteger este aparelho</button>
      `}
    `);
    $('#md-back').onclick = openConfig;
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    // Criar e trocar usam o mesmo teclado do primeiro acesso
    on('#sec-on', () => {
      closeModal();
      Auth.fluxoPin({ aoTerminar: ok => { if (ok) toast('PIN ativado ✓'); openConfigSection('security'); } });
    });
    on('#sec-trocar', () => {
      closeModal();
      Auth.fluxoPin({ trocar: true, aoTerminar: ok => { if (ok) toast('PIN alterado ✓'); openConfigSection('security'); } });
    });
    on('#sec-save', () => {
      Auth.cfg.lockAfterMin = Math.min(120, Math.max(0, parseInt($('#sec-min').value) || 5));
      Auth.save();
      toast('Tempo de bloqueio salvo ✓'); openConfig();
    });
    // Ações sensíveis pedem o PIN pelo teclado, em vez de um campo solto na tela
    on('#sec-off', () => {
      if (!confirm('Remover a proteção? Os dados deste aparelho voltarão a ficar SEM criptografia.')) return;
      closeModal();
      Auth.pinPad({
        titulo: 'Confirme o PIN',
        texto: 'Digite o PIN atual para remover a proteção deste aparelho.',
        rodape: '<div class="btn-row"><button class="btn ghost" id="pin-cancel">Cancelar</button></div>',
        aoConfirmar: async valor => {
          if (!(await Auth.removePin(valor))) return 'PIN incorreto';
          Auth.desativarBio();
          Auth.hide();
          toast('PIN removido — dados locais sem criptografia');
          openConfigSection('security');
          return null;
        },
      });
      $('#pin-cancel').onclick = () => { Auth.hide(); openConfigSection('security'); };
    });
    on('#sec-bio-on', () => {
      closeModal();
      Auth.pinPad({
        titulo: 'Confirme o PIN',
        texto: 'Digite o PIN atual para vincular a digital a este aparelho.',
        rodape: '<div class="btn-row"><button class="btn ghost" id="pin-cancel">Cancelar</button></div>',
        aoConfirmar: async valor => {
          if (!(await Auth.verify(valor))) return 'PIN incorreto';
          try {
            await Auth.ativarBio(valor);
            Auth.hide(); toast('Digital ativada ✓'); openConfigSection('security');
            return null;
          } catch (e) {
            if (/PRF|não oferece leitor/i.test(e.message)) { Auth.hide(); openConfigSection('security'); return null; }
            return e.name === 'NotAllowedError' ? 'Digital não confirmada' : e.message;
          }
        },
      });
      $('#pin-cancel').onclick = () => { Auth.hide(); openConfigSection('security'); };
    });
    on('#sec-bio-off', () => { Auth.desativarBio(); toast('Digital desativada'); openConfigSection('security'); });
  }

  if (sec === 'backup') {
    openModal(`
      <div class="modal-title">Backup<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <p class="muted" style="margin-bottom:12px">Com a sincronização ativa, a nuvem já é seu backup. Ainda assim, você pode guardar um arquivo local.</p>
      <button class="btn ghost" id="bk-export" style="margin-bottom:10px">⬇ Exportar dados (.json)</button>
      <button class="btn ghost" id="bk-import">⬆ Importar backup</button>
      <input type="file" id="bk-file" accept="application/json" hidden>
    `);
    $('#md-back').onclick = openConfig;
    $('#bk-export').onclick = () => {
      const blob = new Blob([DB.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `financas-backup-${todayISO()}.json`;
      a.click();
    };
    $('#bk-import').onclick = () => $('#bk-file').click();
    $('#bk-file').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm('Importar substitui TODOS os dados locais atuais. Continuar?')) return;
      try { DB.importJSON(await f.text()); toast('Backup importado ✓'); closeModal(); }
      catch (err) { toast('Falha: ' + err.message); }
    };
  }

  if (sec === 'reset') {
    const naNuvem = Sync.hasFamily();
    openModal(`
      <div class="modal-title">Apagar dados deste aparelho<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <div class="callout warn">
        <b>Por que “limpar dados” do celular não resolve</b>
        <p>O app instalado é um atalho: quem guarda as informações é o navegador, na origem do site.
        A limpeza feita pelas configurações do Android apaga o atalho, não o armazenamento — por isso os dados voltam a aparecer.
        O botão abaixo apaga de verdade.</p>
      </div>
      <p class="muted" style="margin:12px 0">Serão apagados deste aparelho: lançamentos, contas, cartões, categorias, metas, PIN, digital, login e o cache do app.</p>
      ${naNuvem ? `<div class="callout info"><b>Atenção: a nuvem não é afetada</b>
        <p>Os dados da família continuam no servidor. Se você entrar de novo com a mesma conta, eles voltam para cá — que é o esperado ao trocar de aparelho.
        Para começar do zero de verdade, apague também pelo painel do Supabase.</p></div>` : ''}
      <div class="field" style="margin-top:14px"><label>Digite <b>APAGAR</b> para confirmar</label><input id="rs-conf" placeholder="APAGAR" autocomplete="off"></div>
      <button class="btn ghost" id="rs-export" style="margin-bottom:10px">⬇ Antes disso, exportar um backup</button>
      <button class="btn danger" id="rs-go" disabled>Apagar tudo deste aparelho</button>
    `);
    $('#md-back').onclick = openConfig;
    const conf = $('#rs-conf'), botao = $('#rs-go');
    conf.oninput = () => { botao.disabled = conf.value.trim().toUpperCase() !== 'APAGAR'; };
    $('#rs-export').onclick = () => {
      const blob = new Blob([DB.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `financas-backup-${todayISO()}.json`;
      a.click();
    };
    botao.onclick = async () => {
      if (conf.value.trim().toUpperCase() !== 'APAGAR') return;
      botao.disabled = true; botao.textContent = 'Apagando…';
      await DB.apagarTudo();
      location.reload();
    };
  }
}

/* Opções de categoria agrupadas por envelope, no formato que o UI desenha como
   cabeçalho de grupo. Melhor que repetir "Alimentação › " em cada linha: o nome
   do envelope aparece uma vez, e a busca do painel também procura por ele.
   Folha sem envelope (categoria simples) fica solta no fim, sem cabeçalho. */
function optionsCategorias(selecionado, tipo) {
  const opcao = (c, rotulo) =>
    `<option value="${c.id}"${selecionado === c.id ? ' selected' : ''}>${esc(rotulo)}</option>`;
  const soltas = [], grupos = [];
  for (const raiz of DB.rootCategories(tipo).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const filhas = DB.subcategoriesOf(raiz.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!filhas.length) { soltas.push(raiz); continue; }   // envelope sem detalhe é ele mesmo a folha
    grupos.push(`<optgroup label="${esc(raiz.icon)} ${esc(raiz.name)}">${
      filhas.map(f => opcao(f, f.name)).join('')}</optgroup>`);
  }
  const semGrupo = soltas.length
    ? `<optgroup label="Sem subcategorias">${
        soltas.map(c => opcao(c, `${c.icon} ${c.name}`)).join('')}</optgroup>`
    : '';
  return grupos.join('') + semGrupo;
}

/* ---------- Convite para a família ----------
   O código é o que permite o cônjuge ver os mesmos lançamentos. Ficava só na tela
   de Sincronização, em cinza pequeno, e quem não o copiasse na hora do cadastro
   não o encontrava mais. Agora é um bloco só, usado em todo lugar que faz sentido. */
function blocoConvite() {
  if (!Sync.hasFamily()) return '';
  return `
    <div class="convite">
      <div class="convite-topo"><span class="cfg-ico t-primary" data-ico="users"></span>
        <div><b>Código da família</b><small>quem usar este código passa a ver os mesmos lançamentos</small></div></div>
      <div class="convite-cod" id="cv-cod" title="Toque para copiar">${esc(Sync.cfg.family_id)}</div>
      <div class="btn-row">
        <button class="btn" id="cv-share">Convidar alguém</button>
        <button class="btn ghost" id="cv-copy">Copiar</button>
      </div>
    </div>`;
}

function ligarConvite() {
  if (!Sync.hasFamily()) return;
  const codigo = () => Sync.cfg.family_id;
  const copiar = async () => {
    try { await navigator.clipboard.writeText(codigo()); toast('Código copiado ✓'); }
    catch (_) { toast('Não consegui copiar — selecione o código na tela'); }
  };
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('#cv-copy', copiar);
  on('#cv-cod', copiar);   // tocar no próprio código copia
  on('#cv-share', async () => {
    const texto = `Entre na nossa família no app de finanças com este código:\n\n${codigo()}\n\n` +
      `No app, vá em Configurações → Sincronização e cole em "código da família".`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Código da família', text: texto }); }
      catch (_) { /* cancelou o compartilhamento */ }
      return;
    }
    copiar();
  });
}

// Aparelho novo entrando numa família que já existe: precisa baixar tudo,
// não só o que mudou desde a última sincronização (que aqui nunca houve).
async function puxarTudoDaFamilia() {
  if (!Sync.hasFamily() || !DB.data) return;
  DB.data.meta.lastSync = null; DB.save();
  try { await Sync.syncAll(); } catch (_) {}
}
window.puxarTudoDaFamilia = puxarTudoDaFamilia;

/* ---------- Categorias & orçamentos ----------
   Lista em árvore em vez de plana: com subcategorias, uma lista corrida de 70
   itens não deixa ver quais envelopes existem nem a quem cada item pertence. */
function openCategoriesConfig(estado) {
  /* A lista aberta tinha ~123 linhas: 19 envelopes, 85 subcategorias e um botão
     por envelope — quase 8 telas de rolagem para achar qualquer coisa.

     Agora só os envelopes aparecem, recolhidos; as subcategorias abrem no que
     for tocado. Um por vez: dois abertos já devolvem a rolagem, e não há motivo
     para comparar duas listas de subcategoria lado a lado.

     Saídas e Entradas viram abas, porque quem vem mexer em orçamento não está
     mexendo em origem de renda na mesma hora. */
  const st = { lado: 'Despesa', aberto: null, busca: '', ...(estado || {}) };
  const busca = DB._semAcento(st.busca);

  const cartaoEnvelope = r => {
    const filhas = DB.subcategoriesOf(r.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const aberto = st.aberto === r.id;
    // Buscando, o que casa abre sozinho — senão a subcategoria encontrada ficaria escondida
    const filhasVisiveis = busca ? filhas.filter(f => DB._semAcento(f.name).includes(busca)) : filhas;
    const casaPai = !busca || DB._semAcento(r.name).includes(busca);
    if (busca && !casaPai && !filhasVisiveis.length) return '';
    const mostraFilhas = aberto || (busca && filhasVisiveis.length);

    const detalhe = st.lado === 'Receita'
      ? `${filhas.length} origem(ns)`
      : `${r.monthly_budget ? fmtShort(r.monthly_budget) + '/mês' : 'sem orçamento'} · ${filhas.length} subcategoria(s)`;

    return `
      <div class="env ${mostraFilhas ? 'aberto' : ''}">
        <div class="env-head" data-abrir="${r.id}">
          <span class="cfg-ico">${esc(r.icon)}</span>
          <span class="env-nome">${esc(r.name)}<small>${detalhe}</small></span>
          <button class="env-editar" data-edit="${r.id}" title="Editar ${esc(r.name)}"><span data-ico="settings"></span></button>
          <span class="env-chev" data-ico="chev"></span>
        </div>
        ${mostraFilhas ? `<div class="env-body">
          ${(busca ? filhasVisiveis : filhas).map(f => `
            <button class="sub-linha" data-edit="${f.id}"><span class="sub-traco"></span>${esc(f.name)}</button>`).join('')
            || '<p class="muted" style="padding:4px 2px 8px">Nenhuma subcategoria ainda.</p>'}
          <button class="btn ghost btn-sub" data-nova-sub="${r.id}">＋ Subcategoria</button>
        </div>` : ''}
      </div>`;
  };

  const raizes = DB.rootCategories(st.lado).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const cartoes = raizes.map(cartaoEnvelope).join('');
  const nada = busca
    ? '<div class="empty">Nada encontrado com esse texto.</div>'
    : '<div class="empty">Nada cadastrado ainda.</div>';

  // Ofertas de preenchimento só quando fazem falta, e no lado a que pertencem
  const semSub = st.lado === 'Despesa' && raizes.length > 0 && raizes.every(r => !DB.subcategoriesOf(r.id).length);
  const semEntradas = st.lado === 'Receita' && !raizes.length;

  openModal(`
    <div class="modal-title">Categorias<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>

    <div class="chips seg" id="cat-lado">
      <button class="chip ${st.lado === 'Despesa' ? 'active' : ''}" data-lado="Despesa">Saídas</button>
      <button class="chip ${st.lado === 'Receita' ? 'active' : ''}" data-lado="Receita">Entradas</button>
    </div>
    <p class="muted" style="margin:10px 0 12px">${st.lado === 'Despesa'
      ? 'O orçamento fica no envelope. As subcategorias detalham e somam nele.'
      : 'Origem do dinheiro que entra. Não tem orçamento.'}</p>

    <div class="busca-row" style="margin-bottom:12px">
      <input id="cat-busca" type="search" placeholder="Buscar categoria…" autocomplete="off" value="${esc(st.busca)}">
      <button class="btn-filtros" id="cat-novo">＋ ${st.lado === 'Despesa' ? 'Envelope' : 'Origem'}</button>
    </div>

    ${semSub ? `<div class="callout info">
      <b>Detalhar os gastos com subcategorias</b>
      <p>Seus envelopes ainda não têm subcategorias. Dá para preencher as sugeridas de uma vez e ajustar depois. Nada do que você já lançou muda de lugar.</p>
      <button class="btn" id="md-sugerir" style="margin-top:10px">Adicionar sugeridas</button>
    </div>` : ''}
    ${semEntradas ? `<div class="callout info">
      <b>Classifique também o que entra</b>
      <p>Sem isto não dá para separar salário de empréstimo recebido — que entra na conta mas não é ganho.</p>
      <button class="btn" id="md-entradas" style="margin-top:10px">Criar categorias sugeridas</button>
    </div>` : ''}

    ${cartoes || nada}
  `);

  const reabrir = novo => openCategoriesConfig({ ...st, ...novo });
  $('#md-back').onclick = openConfig;
  document.querySelectorAll('#cat-lado .chip').forEach(b =>
    b.onclick = () => reabrir({ lado: b.dataset.lado, aberto: null, busca: '' }));

  const campo = $('#cat-busca');
  campo.oninput = () => {
    clearTimeout(campo._t);
    campo._t = setTimeout(() => {
      reabrir({ busca: campo.value.trim() });
      const novo = $('#cat-busca');
      if (novo) { novo.focus(); novo.setSelectionRange(novo.value.length, novo.value.length); }
    }, 220);
  };

  // Abrir um fecha o anterior: é o que mantém a tela do tamanho de uma tela
  document.querySelectorAll('[data-abrir]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-edit]')) return;      // o botão de editar tem ação própria
    reabrir({ aberto: st.aberto === el.dataset.abrir ? null : el.dataset.abrir });
  });
  document.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    openCategoryEditor(DB.get('categories', el.dataset.edit), null, null, st);
  });
  document.querySelectorAll('[data-nova-sub]').forEach(el =>
    el.onclick = () => openCategoryEditor(null, el.dataset.novaSub, null, st));
  $('#cat-novo').onclick = () => openCategoryEditor(null, null, st.lado, st);

  const sugerir = $('#md-sugerir');
  if (sugerir) sugerir.onclick = () => {
    const n = DB.sugerirSubcategorias();
    Sync.autoSync();
    toast(n ? `${n} subcategoria(s) criada(s) ✓` : 'Nenhum envelope conhecido para detalhar');
    reabrir({});
  };
  const criarEntradas = $('#md-entradas');
  if (criarEntradas) criarEntradas.onclick = () => {
    const n = DB.criarCategoriasDeEntrada();
    Sync.autoSync();
    toast(n ? `${n} categoria(s) de entrada criada(s) ✓` : 'Já existem categorias de entrada');
    reabrir({});
  };
}

/* paiFixo: id do envelope quando se cria uma subcategoria a partir dele.
   tipoNovo: 'Despesa' ou 'Receita' ao criar do zero — o tipo de uma categoria que
   já existe vem do envelope dela, nunca é reescolhido aqui. */
function openCategoryEditor(cat, paiFixo, tipoNovo, voltarPara) {
  const isEdit = !!cat;
  const tipo = isEdit ? DB.categoryType(DB.categoryRoot(cat.id) || cat)
    : paiFixo ? DB.categoryType(DB.get('categories', paiFixo))
    : (tipoNovo || 'Despesa');
  const ehEntrada = tipo === 'Receita';
  cat = cat || { name: '', icon: ehEntrada ? '💵' : '🏷️', scope: 'Família', monthly_budget: 0, parent_id: paiFixo || null, type: tipo };
  const temFilhas = isEdit && DB.subcategoriesOf(cat.id).length > 0;
  // Um envelope que já tem subcategorias não pode virar subcategoria de outro:
  // isso criaria três níveis, que o resto do app não modela.
  const podeTerPai = !temFilhas;
  // Só envelopes do mesmo lado: origem de entrada dentro de envelope de gasto
  // faria o valor entrar no orçamento como se fosse despesa.
  const paisPossiveis = DB.rootCategories(tipo).filter(r => r.id !== cat.id);

  openModal(`
    <div class="modal-title">${isEdit ? 'Editar' : (cat.parent_id ? 'Nova subcategoria' : ehEntrada ? 'Nova origem de entrada' : 'Novo envelope')}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    ${ehEntrada ? '<p class="muted" style="margin-bottom:12px">Categoria de <b>entrada</b>: diz de onde o dinheiro veio. Não tem orçamento nem entra na regra 50/30/20.</p>' : ''}
    <div class="row2">
      <div class="field"><label>Ícone</label><input id="c-icon" maxlength="4" value="${esc(cat.icon)}"></div>
      <div class="field"><label>Nome</label><input id="c-name" value="${esc(cat.name)}"></div>
    </div>
    ${podeTerPai ? `
    <div class="field"><label>Pertence a</label>
      <select id="c-parent">
        <option value="">— é um envelope (tem orçamento próprio) —</option>
        ${paisPossiveis.map(r => `<option value="${r.id}" ${cat.parent_id === r.id ? 'selected' : ''}>${esc(r.icon)} ${esc(r.name)}</option>`).join('')}
      </select>
      <p class="muted" style="margin-top:6px">Escolher um envelope transforma isto numa subcategoria: o gasto soma no limite dele.</p>
    </div>` : `<p class="muted" style="margin-bottom:12px">Este envelope tem subcategorias, então ele não pode virar subcategoria de outro.</p>`}
    <div id="wrap-envelope" ${cat.parent_id || ehEntrada ? 'hidden' : ''}>
      <div class="row2">
        <div class="field"><label>Âmbito</label><select id="c-scope"><option ${cat.scope === 'Família' ? 'selected' : ''}>Família</option><option ${cat.scope === 'Pessoal' ? 'selected' : ''}>Pessoal</option></select></div>
        <div class="field"><label>Orçamento mensal</label><input id="c-budget" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
      </div>
      <div class="field"><label>Tipo (regra 50/30/20)</label><select id="c-kind">
        <option value="Essencial" ${cat.kind !== 'Estilo' ? 'selected' : ''}>Necessidade (moradia, mercado, saúde…)</option>
        <option value="Estilo" ${cat.kind === 'Estilo' ? 'selected' : ''}>Desejo (lazer, assinaturas, extras…)</option>
      </select></div>
    </div>
    <p class="muted" id="aviso-sub" ${cat.parent_id ? '' : 'hidden'} style="margin-bottom:12px">Âmbito, orçamento e tipo vêm do envelope — não se repetem aqui.</p>
    <button class="btn" id="md-save">Salvar</button>
    ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
  `);
  initMoney('#c-budget', cat.monthly_budget);
  const voltar = () => openCategoriesConfig(voltarPara || {});
  $('#md-back').onclick = voltar;

  // Os campos de envelope só existem enquanto não há pai escolhido
  const sel = $('#c-parent');
  if (sel) sel.onchange = () => {
    const virouSub = !!sel.value;
    $('#wrap-envelope').hidden = virouSub;
    $('#aviso-sub').hidden = !virouSub;
  };

  $('#md-save').onclick = () => {
    const nome = $('#c-name').value.trim();
    if (!nome) return toast('Informe o nome');
    const pai = sel ? (sel.value || null) : (cat.parent_id || null);
    const envelope = pai ? DB.get('categories', pai) : null;
    const semEnvelope = pai || ehEntrada;   // entrada não tem orçamento nem 50/30/20
    DB.upsert('categories', {
      ...cat, name: nome, icon: $('#c-icon').value || '🏷️', parent_id: pai, type: tipo,
      // Subcategoria segue o envelope: guardar cópia divergente aqui só criaria
      // dois lugares dizendo coisas diferentes sobre o mesmo gasto.
      scope: semEnvelope ? (envelope ? envelope.scope : 'Família') : $('#c-scope').value,
      kind: semEnvelope ? (envelope ? envelope.kind : 'Essencial') : $('#c-kind').value,
      monthly_budget: semEnvelope ? 0 : moneyVal('#c-budget'),
    });
    Sync.autoSync(); voltar();
  };

  const del = $('#md-del');
  if (del) del.onclick = () => {
    const filhas = DB.subcategoriesOf(cat.id).length;
    const aviso = filhas
      ? `Excluir "${cat.name}" e suas ${filhas} subcategoria(s)? Os lançamentos antigos ficam sem categoria.`
      : 'Excluir categoria? Os lançamentos antigos ficam sem categoria.';
    if (confirm(aviso)) { DB.remove('categories', cat.id); Sync.autoSync(); voltar(); }
  };
}

function openSyncConfig() {
  const c = Sync.cfg || {};
  const step = !Sync.configured() ? 1 : !Sync.loggedIn() ? 2 : !Sync.hasFamily() ? 3 : 4;
  let body = '';
  if (step === 1) body = `
    <p class="muted" style="margin-bottom:12px">Passo 1 de 3 — conecte seu projeto Supabase (gratuito). Veja o guia no README do projeto.</p>
    <div class="field"><label>URL do projeto</label><input id="s-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || '')}"></div>
    <div class="field"><label>Chave anon (public)</label><input id="s-key" placeholder="eyJhbGciOi…" value="${esc(c.anonKey || '')}"></div>
    <button class="btn" id="s-save-cfg">Continuar</button>`;
  if (step === 2) body = `
    <p class="muted" style="margin-bottom:12px">Passo 2 de 3 — entre ou crie sua conta.</p>
    <div class="field"><label>E-mail</label><input id="s-email" type="email" value="${esc(c.user_email || '')}"></div>
    <div class="field"><label>Senha</label><input id="s-pass" type="password"></div>
    <div class="btn-row"><button class="btn" id="s-login">Entrar</button><button class="btn ghost" id="s-signup">Criar conta</button></div>
    <hr class="sep"><button class="btn ghost" id="s-reset">Alterar URL/chave</button>`;
  if (step === 3) body = `
    <p class="muted" style="margin-bottom:12px">Passo 3 de 3 — crie a família ou entre na que seu cônjuge criou.</p>
    <div class="field"><label>Nome da família</label><input id="s-fam-name" placeholder="Ex: Nossa casa, Família Silva…" value="${esc(DB.familyName())}"></div>
    <button class="btn" id="s-create-fam">Criar família</button>
    <hr class="sep">
    <div class="field"><label>Ou cole o código da família</label><input id="s-fam-code" placeholder="código recebido do outro membro"></div>
    <button class="btn ghost" id="s-join-fam">Entrar na família</button>`;
  if (step === 4) body = `
    <p class="muted">Conectado como <b>${esc(c.user_email || '')}</b></p>
    ${blocoConvite()}
    <button class="btn ghost" id="s-now" style="margin-top:10px">Sincronizar agora</button>
    <button class="btn ghost" id="s-diag" style="margin-top:8px">Verificar conexão e banco</button>
    <div id="s-diag-out"></div>
    <hr class="sep"><button class="btn danger" id="s-logout">Sair da conta</button>`;

  openModal(`<div class="modal-title">☁️ Sincronização<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>${body}`);
  $('#md-back').onclick = openConfig;
  ligarConvite();

  // Reinstalação ou aparelho novo: se o servidor já tem família para esta conta,
  // não faz sentido pedir para criar outra — adota a que existe e baixa os dados.
  if (step === 3) {
    Sync.detectarFamilia().then(async fid => {
      if (!fid) return;
      toast('Você já faz parte de uma família — trazendo os dados ✓');
      await puxarTudoDaFamilia();
      render(); openSyncConfig();
    }).catch(() => {});
  }

  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#s-save-cfg', () => {
    const url = $('#s-url').value.trim().replace(/\/$/, '');
    const key = $('#s-key').value.trim();
    if (!url.startsWith('https://') || !key) return toast('Preencha URL e chave');
    Sync.cfg.url = url; Sync.cfg.anonKey = key; Sync.saveCfg();
    openSyncConfig();
  });
  on('#s-reset', () => { Sync.signOut(); delete Sync.cfg.url; delete Sync.cfg.anonKey; Sync.saveCfg(); openSyncConfig(); });
  on('#s-login', async () => {
    try { await Sync.signIn($('#s-email').value.trim(), $('#s-pass').value); toast('Conectado ✓'); openSyncConfig(); }
    catch (e) { toast(e.message); }
  });
  on('#s-signup', async () => {
    try {
      const d = await Sync.signUp($('#s-email').value.trim(), $('#s-pass').value);
      if (!d.access_token) { toast('Confirme o e-mail recebido e depois faça login'); return; }
      toast('Conta criada ✓'); openSyncConfig();
    } catch (e) { toast(e.message); }
  });
  on('#s-create-fam', async () => {
    const nome = ($('#s-fam-name').value || '').trim();
    if (!nome) { $('#s-fam-name').focus(); return toast('Escolha um nome para a família'); }
    try {
      await Sync.createFamily(nome);
      DB.upsert('family_settings', { ...DB.settings(), family_name: nome });
      await Sync.syncAll();
      toast('Família criada ✓'); render(); openSyncConfig();
    } catch (e) { toast(e.message); }
  });
  on('#s-join-fam', async () => {
    try {
      await Sync.joinFamily($('#s-fam-code').value);
      await puxarTudoDaFamilia();
      toast('Você entrou na família ✓'); render(); openSyncConfig();
    } catch (e) { toast(e.message); }
  });
  on('#s-now', async () => { try { await Sync.syncAll(); render(); } catch (_) {} });
  on('#s-diag', async () => {
    const caixa = $('#s-diag-out');
    caixa.innerHTML = '<p class="muted" style="margin-top:10px">Verificando…</p>';
    const linhas = await Sync.diagnosticar();
    const ruins = linhas.filter(l => !l.ok);
    caixa.innerHTML = `
      <div class="diag">
        ${linhas.map(l => `<div class="diag-row ${l.ok ? 'ok' : 'ruim'}">
          <b>${l.ok ? '✓' : '✕'} ${esc(l.tabela)}</b><small>${esc(l.msg)}</small></div>`).join('')}
      </div>
      ${ruins.length ? `<div class="callout warn" style="margin-top:10px">
        <b>O banco está atrás do app</b>
        <p>Abra o Supabase → SQL Editor e rode o <b>supabase/schema.sql</b> deste projeto inteiro. Ele é seguro de rodar de novo: só cria o que falta.</p></div>`
      : `<p class="muted" style="margin-top:10px">Tudo certo — o banco aceita todos os campos que o app usa.</p>`}
      ${Sync._descartados ? `<p class="muted" style="margin-top:8px">⚠️ ${Sync._descartados} registro(s) antigo(s) com dado inválido ficaram de fora do envio. Abra o lançamento e salve de novo para corrigir.</p>` : ''}`;
  });
  on('#s-logout', () => { if (confirm('Sair da conta? Os dados locais permanecem no aparelho.')) { Sync.signOut(); openSyncConfig(); } });
}

/* ---------- Importação de extrato OFX ---------- */
function openOfxImport() {
  const accounts = DB.all('accounts').filter(a => a.active !== false);
  const cards = DB.all('cards').filter(c => c.active !== false);
  openModal(`
    <div class="modal-title">Importar extrato OFX<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:12px">No app do seu banco ou cartão, procure por <b>exportar extrato / OFX</b> e baixe o arquivo. Lançamentos já importados antes são reconhecidos e ignorados automaticamente.</p>
    <button class="btn" id="ofx-pick">Escolher arquivo .ofx</button>
    <input type="file" id="ofx-file" accept=".ofx,.OFX,.qfx,text/plain" hidden>
    <div id="ofx-result"></div>
  `);
  $('#md-back').onclick = openConfig;
  $('#ofx-pick').onclick = () => $('#ofx-file').click();
  $('#ofx-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = OFX.parse(await OFX.readText(file));
      if (!parsed.txs.length) return toast('Nenhum lançamento encontrado no arquivo');
      renderOfxPreview(parsed, accounts, cards);
    } catch (err) {
      toast('Não consegui ler o arquivo: ' + err.message);
    }
  };
}

/* Etiquetas de UMA linha da importação. Folha em vez de campo na linha: o campo
   por linha resolveria o mesmo com quarenta campos abertos na tela.
   segueLote diz se a linha ainda usa o padrão do lote; devolver null a religa. */
function openTagsLinhaSheet(tx, atuais, segueLote, aoAplicar) {
  const sugeridas = DB.tagsRelevantes(8).filter(t => !atuais.includes(t));
  const chips = [...atuais.map(t => ({ t, on: true })), ...sugeridas.map(t => ({ t, on: false }))];
  openSheet(`
    <div class="sheet-title">Etiquetas do lançamento<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:4px">${esc(tx.memo)}</p>
    <p class="muted" style="margin-bottom:14px;font-size:11.5px">${segueLote
      ? 'Hoje esta linha usa as etiquetas do lote. Mexer aqui vale só para ela.'
      : 'Esta linha tem etiquetas próprias.'}</p>
    <div class="field">
      <div class="chips" id="tl-tags">
        ${chips.map(({ t, on }) => `<button type="button" class="chip chip-tag ${on ? 'active' : ''}" data-v="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
      <input id="tl-nova" list="tag-hist-linha" placeholder="Nova etiqueta e Enter" autocomplete="off" maxlength="24" style="margin-top:8px">
      <datalist id="tag-hist-linha">${DB.allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
    </div>
    <button class="btn" id="sh-save">Aplicar nesta linha</button>
    ${segueLote ? '' : '<div class="btn-row"><button class="btn ghost" id="tl-lote">Voltar a seguir o lote</button></div>'}
  `);
  const box = $('#tl-tags');
  const add = nome => {
    const tag = DB.normTag(nome);
    if (!tag) return;
    const existe = [...box.querySelectorAll('.chip-tag')]
      .find(c => DB._semAcento(c.dataset.v) === DB._semAcento(tag));
    if (existe) { existe.classList.add('active'); return; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-tag active'; b.dataset.v = tag;
    b.textContent = '#' + tag;
    b.onclick = () => b.classList.toggle('active');
    box.appendChild(b);
  };
  box.querySelectorAll('.chip-tag').forEach(c => { c.onclick = () => c.classList.toggle('active'); });
  const campo = $('#tl-nova');
  campo.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault(); e.stopPropagation();
    add(campo.value); campo.value = '';
  };
  campo.onblur = () => { if (campo.value.trim()) { add(campo.value); campo.value = ''; } };

  $('#sh-close').onclick = closeSheet;
  const voltarLote = $('#tl-lote');
  if (voltarLote) voltarLote.onclick = () => { aoAplicar(null); closeSheet(); };
  $('#sh-save').onclick = () => {
    if (campo.value.trim()) add(campo.value);
    aoAplicar([...box.querySelectorAll('.chip-tag.active')].map(c => c.dataset.v));
    closeSheet();
  };
}

function renderOfxPreview(parsed, accounts, cards) {
  const cats = DB.all('categories');   // com os pais: a adivinhação depende deles
  const novos = parsed.txs.filter(t => !DB.hasFitid(t.fitid));
  const dups = parsed.txs.length - novos.length;
  const destOpts = `
    ${cards.length ? `<optgroup label="Cartões de crédito">${cards.map(c => `<option value="card:${c.id}" ${parsed.isCard ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
    ${accounts.length ? `<optgroup label="Contas">${accounts.map(a => `<option value="acc:${a.id}" ${!parsed.isCard ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}`;

  const rows = novos.map((t, i) => {
    const isExp = t.amount < 0;
    const guess = OFX.guessCategoryId(t.memo, cats, isExp ? 'Despesa' : 'Receita');
    // Ordem no HTML igual à ordem de leitura: marcar, ler a descrição, ver o valor,
    // e só então escolher a categoria — que fica na linha de baixo, com espaço.
    return `<div class="ofx-row">
      <input type="checkbox" data-i="${i}" checked>
      <span class="ofx-main"><b>${esc(t.memo)}</b><small>${fmtDay(t.date)} · ${isExp ? 'saída' : 'entrada'}</small></span>
      <span class="ofx-val ${isExp ? '' : 'txt-green'}">${isExp ? '' : '+'}${fmtShort(Math.abs(t.amount))}</span>
      <!-- Entrada também é classificada: sem isso não dá para separar salário de
           empréstimo recebido, que entra na conta e não é ganho. -->
      <span class="ofx-cat"><select data-cat="${i}">
        <option value="">${isExp ? 'Sem categoria' : 'Sem origem'}</option>
        ${optionsCategorias(guess, isExp ? 'Despesa' : 'Receita')}
      </select></span>
      <button type="button" class="ofx-tag-btn" data-tagbtn="${i}" title="Etiquetas deste lançamento"><span data-ico="tag"></span><span class="ofx-tag-txt"></span></button>
    </div>`;
  }).join('');

  $('#ofx-result').innerHTML = `
    <hr class="sep">
    <div class="mini-stats" style="margin-bottom:12px">
      <div class="card"><small>Novos</small><b>${novos.length}</b></div>
      <div class="card"><small>Repetidos</small><b>${dups}</b></div>
      <div class="card"><small>Do arquivo</small><b>${parsed.txs.length}</b></div>
    </div>
    ${!novos.length ? '<div class="empty"><b>Tudo já importado</b>Nenhum lançamento novo neste arquivo.</div>' : `
      <div class="field"><label>Lançar em</label><select id="ofx-dest">${destOpts}</select></div>
      <!-- Uma etiqueta para o lote inteiro, em vez de um campo por linha: importar
           o extrato de uma viagem é o caso típico, e 40 campos poluiriam a tela. -->
      <div class="field"><label>Etiquetar todos <span class="muted">— opcional</span></label>
        <div class="chips" id="ofx-tags">
          ${DB.tagsRelevantes(6).map(t => `<button type="button" class="chip chip-tag" data-v="${esc(t)}">#${esc(t)}</button>`).join('')}
        </div>
        <input id="ofx-tag-nova" list="tag-hist-ofx" placeholder="Nova etiqueta e Enter (ex: viagem bahia)" autocomplete="off" maxlength="24" style="margin-top:8px">
        <datalist id="tag-hist-ofx">${DB.allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      </div>
      ${parsed.balance !== null ? `<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ofx-bal" checked style="width:18px;height:18px;accent-color:var(--gold)">Atualizar saldo da conta para ${fmt(parsed.balance)} (informado pelo banco)</label></div>` : ''}
      <div class="btn-row" style="margin-bottom:4px">
        <button class="btn ghost" id="ofx-all">Marcar todos</button>
        <button class="btn ghost" id="ofx-none">Desmarcar todos</button>
      </div>
      <div class="ofx-list">${rows}</div>
      <div class="ofx-acoes"><button class="btn" id="ofx-go">Importar selecionados</button></div>
    `}`;

  if (!novos.length) return;
  // Este trecho é montado depois que o modal já abriu, então o UI.enhance do
  // openModal não o alcançou: os selects daqui ficavam nativos, sem busca.
  if (typeof UI !== 'undefined') UI.enhance($('#ofx-result'));

  // Etiquetas do lote: mesma mecânica do formulário (chip liga/desliga, campo cria)
  const chipsOfx = $('#ofx-tags');
  const addTagOfx = nome => {
    const tag = DB.normTag(nome);
    if (!tag) return;
    const existe = [...chipsOfx.querySelectorAll('.chip-tag')]
      .find(c => DB._semAcento(c.dataset.v) === DB._semAcento(tag));
    if (existe) { existe.classList.add('active'); return; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-tag active'; b.dataset.v = tag;
    b.textContent = '#' + tag;
    b.onclick = () => b.classList.toggle('active');
    chipsOfx.appendChild(b);
  };
  const campoTagOfx = $('#ofx-tag-nova');
  const tagsDoLote = () => [...chipsOfx.querySelectorAll('.chip-tag.active')].map(c => c.dataset.v);

  /* Etiqueta por linha, com o lote como padrão: null significa "segue o lote".
     Assim etiquetar 40 linhas de uma viagem continua sendo um toque, e a linha
     que fugir da regra é ajustada sem desfazer o resto. */
  const tagsLinha = novos.map(() => null);
  const tagsDe = i => tagsLinha[i] || tagsDoLote();

  const pintarBotoes = () => {
    document.querySelectorAll('#ofx-result [data-tagbtn]').forEach(b => {
      const i = Number(b.dataset.tagbtn);
      const tags = tagsDe(i);
      const txt = b.querySelector('.ofx-tag-txt');
      txt.textContent = !tags.length ? 'etiqueta'
        : tags.length === 1 ? '#' + tags[0]
        : `${tags.length} etiquetas`;
      b.classList.toggle('tem', tags.length > 0);
      b.title = tags.length ? tags.map(t => '#' + t).join(' ') : 'Etiquetas deste lançamento';
      // Linha que segue o lote fica sem marca própria; ajustada, ganha um ponto
      b.classList.toggle('propria', tagsLinha[i] !== null);
    });
  };
  // Mexer no lote repinta as linhas que ainda o seguem
  chipsOfx.querySelectorAll('.chip-tag').forEach(c => {
    c.onclick = () => { c.classList.toggle('active'); pintarBotoes(); };
  });
  const addTagOfxEPintar = nome => { addTagOfx(nome); pintarBotoes(); };
  campoTagOfx.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    addTagOfxEPintar(campoTagOfx.value); campoTagOfx.value = '';
  };
  campoTagOfx.onblur = () => { if (campoTagOfx.value.trim()) { addTagOfxEPintar(campoTagOfx.value); campoTagOfx.value = ''; } };

  document.querySelectorAll('#ofx-result [data-tagbtn]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.tagbtn);
    openTagsLinhaSheet(novos[i], tagsDe(i), tagsLinha[i] === null, escolhidas => {
      tagsLinha[i] = escolhidas;      // null volta a seguir o lote
      pintarBotoes();
    });
  });
  pintarBotoes();

  const boxes = () => document.querySelectorAll('#ofx-result [data-i]');
  $('#ofx-all').onclick = () => boxes().forEach(b => { b.checked = true; });
  $('#ofx-none').onclick = () => boxes().forEach(b => { b.checked = false; });

  $('#ofx-go').onclick = () => {
    const [kind, id] = $('#ofx-dest').value.split(':');
    const card = kind === 'card' ? DB.get('cards', id) : null;
    const account = kind === 'acc' ? DB.get('accounts', id) : null;
    if (!card && !account) return toast('Escolha onde lançar');

    let n = 0;
    boxes().forEach(box => {
      if (!box.checked) return;
      const t = novos[Number(box.dataset.i)];
      const isExp = t.amount < 0;
      const catSel = document.querySelector(`#ofx-result [data-cat="${box.dataset.i}"]`);
      DB.upsert('transactions', {
        description: t.memo,
        amount: Math.abs(t.amount),
        date: t.date,
        type: isExp ? 'Despesa' : 'Receita',
        status: 'Pago',
        scope: 'Família',
        member: MEMBRO_COMUM,                 // extrato conjunto entra como gasto comum
        method: OFX.guessMethod(t.memo, !!card),
        category_id: (catSel && catSel.value) || null,
        fitid: t.fitid,
        card_id: card ? card.id : null,
        account_id: account ? account.id : null,
        invoice_key: card ? DB.invoiceKeyFor(card, t.date) : '',
        recurring: false,
        tags: tagsDe(Number(box.dataset.i)),
      });
      n++;
    });

    // Saldo pelo valor informado pelo banco — mais confiável que somar lançamentos importados
    const balBox = $('#ofx-bal');
    if (account && balBox && balBox.checked && parsed.balance !== null) {
      // A diferença aqui costuma ser o saldo que já existia antes do período importado
      reconcileBalance(DB.get('accounts', account.id), parsed.balance, 'Ajuste de saldo (extrato do banco)');
    }
    Sync.autoSync(); closeModal();
    toast(`${n} lançamento(s) importado(s) ✓`);
  };
}

/* ---------- Notificações de ações importantes ----------
   Locais (app aberto) + push real via Supabase Edge Function (app fechado).
   Cada aviso sai no máximo 1x por dia. */
const Notif = {
  key: 'financas.notif.v1',
  cfg: null,
  load() { try { this.cfg = JSON.parse(localStorage.getItem(this.key)) || {}; } catch (_) { this.cfg = {}; } },
  save() { localStorage.setItem(this.key, JSON.stringify(this.cfg)); },
  enabled() { return this.cfg.enabled && 'Notification' in window && Notification.permission === 'granted'; },
  async enable() {
    if (!('Notification' in window)) { toast('Este navegador não suporta notificações'); return false; }
    const perm = await Notification.requestPermission();
    this.cfg.enabled = perm === 'granted';
    this.save();
    return this.cfg.enabled;
  },
  disable() { this.cfg.enabled = false; this.save(); },

  vapid() { return (window.FINANCAS_SUPABASE || {}).vapidPublicKey || ''; },

  urlB64ToU8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  },

  async pushState() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'off';
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
  },

  // Registra este aparelho no Supabase para receber avisos com o app fechado.
  async subscribePush() {
    if (!this.vapid()) throw new Error('Chave VAPID não configurada em js/config.js');
    if (!Sync.hasFamily()) throw new Error('Configure a sincronização com a família primeiro');
    if (Notification.permission !== 'granted') {
      const ok = await this.enable();
      if (!ok) throw new Error('Permissão de notificação negada no navegador');
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.urlB64ToU8(this.vapid()) });
    const j = sub.toJSON();
    await Sync.rest('push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: DB.uuid(), family_id: Sync.cfg.family_id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }),
    });
  },

  async unsubscribePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    if (Sync.hasFamily()) {
      try { await Sync.rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }); } catch (_) {}
    }
  },
  push(id, title, body) {
    const today = todayISO();
    this.cfg.sent = this.cfg.sent || {};
    if (this.cfg.sent[id] === today) return;   // 1x por dia por aviso
    this.cfg.sent[id] = today; this.save();
    if (this.enabled()) new Notification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    else toast(`${title} — ${body}`);
  },
  check() {
    const today = new Date();
    for (const card of DB.all('cards').filter(c => c.active !== false)) {
      for (const inv of DB.invoicesOf(card)) {
        if (inv.status === 'Paga') continue;
        const days = Math.ceil((inv.due - today) / 86400000);
        if (days < 0) this.push(`venc-${inv.key}`, '🔴 Fatura vencida', `${card.name}: ${fmtShort(inv.total)} venceu há ${-days} dia(s).`);
        else if (days <= 3) this.push(`venc-${inv.key}`, '💳 Fatura vencendo', `${card.name}: ${fmtShort(inv.total)} vence em ${days} dia(s).`);
        if (inv.status === 'Aberta') {
          const closeDays = Math.ceil((inv.closing - today) / 86400000);
          if (closeDays >= 0 && closeDays <= 2) this.push(`fech-${inv.key}`, '📅 Fatura fechando', `${card.name} fecha em ${closeDays} dia(s) — confira os lançamentos.`);
        }
      }
    }
    const period = DB.monthPeriod(new Date());
    const byCat = DB.spentByCategory(period);
    for (const c of DB.rootCategories('Despesa')) {
      if (!c.monthly_budget) continue;
      const pct = Math.round((byCat[c.id] || 0) / c.monthly_budget * 100);
      if (pct >= 100) this.push(`orc-${c.id}-${period.label}`, '⚠️ Orçamento estourado', `${c.icon} ${c.name} chegou a ${pct}% do limite do mês.`);
    }
    for (const g of DB.all('goals').filter(g => !g.done)) {
      if ((g.target_amount || 0) > 0 && DB.goalTotal(g.id) >= g.target_amount)
        this.push(`meta-${g.id}`, '🎉 Meta atingida!', `"${g.name}" chegou a 100% — parabéns à família!`);
    }
  },
};

/* ---------- Botão voltar do aparelho ----------
   Sem isto, "voltar" fecha o app na hora — no meio de um lançamento, inclusive.
   Aqui ele passa a se comportar como em app nativo: primeiro fecha o que está
   aberto, depois volta para o Painel, e só sai com dois toques seguidos.

   A sentinela no histórico é o que torna isso possível: com uma única entrada,
   o Android encerra o app antes de o popstate acontecer, e não há o que
   interceptar. Mantemos sempre uma entrada extra — menos no instante de sair. */
const Voltar = {
  JANELA: 2000,        // tempo para o segundo toque confirmar a saída
  ultimo: 0,
  ativo: false,
  AVISO: 'Toque em voltar de novo para sair',

  marcar() { try { history.pushState({ financas: 1 }, ''); } catch (_) {} },

  init() {
    if (this.ativo || typeof history === 'undefined' || !history.pushState) return;
    this.ativo = true;
    this.marcar();
    window.addEventListener('popstate', () => this.tratar());
  },

  // Fecha uma camada por vez, da mais sobreposta para a mais ao fundo
  fecharCamada() {
    if (typeof UI !== 'undefined' && UI.aberto) { UI.fechar(); return true; }
    const sheet = $('#sheet');
    if (sheet && !sheet.hidden) { closeSheet(); return true; }
    const modal = $('#modal');
    if (modal && !modal.hidden) { closeModal(); return true; }
    return false;
  },

  tratar() {
    if (this.fecharCamada()) { this.ultimo = 0; this.marcar(); return; }
    const lock = $('#lock');
    const bloqueado = lock && !lock.hidden;
    // Na tela de bloqueio não há para onde subir: voltar significa sair
    if (!bloqueado && state.tab !== 'inicio') { this.ultimo = 0; setTab('inicio'); this.marcar(); return; }
    this.sair();
  },

  sair() {
    const agora = Date.now();
    if (agora - this.ultimo < this.JANELA) {
      this.ultimo = 0;
      persistUI();       // guarda aba e ponto de leitura antes de fechar
      history.back();    // sentinela não reposta: agora sai de verdade
      return;
    }
    this.ultimo = agora;
    this.marcar();       // segura o app nesta primeira vez
    toast(this.AVISO, 'info');
  },
};

/* ---------- Boot ---------- */
Sync.onStatus = (msg, ok = true) => {
  const el = $('#sync-status');
  el.textContent = msg; el.hidden = false;
  el.classList.toggle('err', !ok);
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ok ? 2500 : 6000);
};

document.querySelectorAll('.tab, .side-item[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#fab').onclick = () => openTxSheet(null);
$('#btn-new-desktop').onclick = () => openTxSheet(null);
$('#btn-config').onclick = openConfig;
$('#side-config').onclick = openConfig;
$('#side-lock').onclick = () => Auth.lockNow();
$('#btn-sync').onclick = () => {
  if (!Sync.hasFamily()) return openConfigSection('sync');
  Sync.syncAll().then(render).catch(() => {});
};
$('#sheet-backdrop').onclick = closeSheet;
$('#modal-backdrop').onclick = closeModal;
// Quando a sincronização traz lançamentos do outro aparelho, a tela se atualiza sozinha.
// Não redesenha com uma folha aberta, para não apagar o que está sendo digitado.
Sync.onChanged = qtd => {
  const editando = !$('#sheet').hidden || !$('#modal').hidden;
  if (editando) return;
  render();
  toast(`${qtd} atualização(ões) da família ✓`, 'info');
};

// Indicador permanente no botão de sincronizar
Sync.onState = (estado, pendentes) => {
  const btn = $('#btn-sync');
  if (!btn) return;
  btn.dataset.estado = estado;
  btn.title = {
    ok: 'Tudo sincronizado', sync: 'Sincronizando…',
    pendente: `${pendentes} alteração(ões) aguardando conexão`,
    offline: 'Sem conexão — será enviado assim que voltar',
    off: 'Sincronização não configurada',
  }[estado] || '';
};

function refreshUserChip() {
  const mail = (Sync.cfg && Sync.cfg.user_email) || '';
  $('#user-name').textContent = mail ? mail.split('@')[0] : 'Família';
  $('#user-mail').textContent = mail ? (Sync.hasFamily() ? 'sincronizado ☁️' : 'conectado') : 'modo local';
  $('#user-avatar').textContent = (mail || 'F').charAt(0).toUpperCase();
}
refreshUserChip();
paintIcons();   // ícones do shell estático (sidebar, topbar, tabbar)

window.addEventListener('beforeunload', persistUI);

Notif.load();
UI.init();
Voltar.init();
restoreUI();
Auth.init(() => {
  setTab(state.tab);          // restaura a aba e marca o menu corretamente
  Sync.startAuto();           // mantém o aparelho em dia sempre que houver conexão
  setTimeout(() => Notif.check(), 800);
});
