/* Finanças da Família — UI e fluxo do app */
'use strict';

Sync.load();   // DB.load() acontece dentro de Auth.init(), que decifra os dados quando há PIN

const METHODS = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
const MEMBRO_COMUM = 'Comum / Família';   // usado sempre que o âmbito é Família
const PALETTE = ['#009ef7', '#50cd89', '#7239ea', '#f1416c', '#ffc700', '#43ced7', '#fd7e14', '#8950fc', '#1bc5bd', '#6c7293'];

/* resumoAberto fica FORA do que zera ao trocar de tela. Mês e filtros zeram por
   correção — um mês antigo esquecido faz ler o saldo errado. Recolher o resumo
   não engana ninguém: é preferência de quem já sabe o próprio saldo e quer a
   lista mais alta. */
let state = { tab: 'inicio', monthOffset: 0, repOffset: 0, filtros: null, resumoAberto: true };

/* Filtros do extrato. Os dois primeiros ficam na tela (são os que se usa toda
   hora); o resto vive no painel, para a tela não virar um formulário. Tudo o que
   estiver ativo aparece como etiqueta removível acima da lista, então nenhum
   filtro fica escondido depois de aplicado — é isso que evita o "por que essa
   lista está vazia?" que painéis fechados costumam causar.

   Quase todo filtro aceita VÁRIOS valores, e a regra precisa estar dita na tela
   porque as duas leituras são plausíveis: dentro do mesmo filtro os valores
   somam (Alimentação OU Transporte), entre filtros diferentes eles restringem
   (…E Pago E de Gleice). Lista vazia significa "todos" — não "nenhum". */
const FILTROS_VAZIOS = {
  busca: '',
  scope: [], membro: [], tipo: [], situacao: [],
  categorias: [], tags: [], metodos: [], contas: [],
  valorMin: '', valorMax: '', recorrente: false,
  // Recorte de dias DENTRO do mês em análise. Vazio = o mês inteiro.
  de: '', ate: '',
};

/* Cópia sempre nova das listas. `{ ...FILTROS_VAZIOS }` copiaria a REFERÊNCIA
   dos arrays, e marcar um chip passaria a escrever dentro da própria constante —
   o "limpar" seguinte devolveria os filtros que deveria ter apagado. */
function filtrosVazios() {
  return Object.fromEntries(Object.entries(FILTROS_VAZIOS)
    .map(([k, v]) => [k, Array.isArray(v) ? [] : v]));
}

/* Quanto uma transferência moveu DENTRO do conjunto de contas em análise.

   A regra vale para qualquer tamanho de conjunto: se as duas pontas estão dentro
   dele, o dinheiro não entrou nem saiu — só trocou de lugar entre contas que você
   está olhando juntas, e contar seria inventar movimento. Se só uma ponta está
   dentro, houve saída ou entrada de verdade.

   "No todo" é o mesmo princípio com o conjunto sendo todas as contas: por isso lá
   toda transferência é neutra. Um conjunto vazio (sem filtro) significa exatamente
   isso — está se olhando a família inteira. */
function efeitoDaTransferencia(t, contas) {
  if (!DB.isTransfer(t) || !contas || !contas.length) return 0;
  const v = Number(t.amount) || 0;
  const saiuDaqui = contas.includes(t.account_id);
  const entrouAqui = contas.includes(t.to_account);
  if (saiuDaqui && entrouAqui) return 0;    // interna ao conjunto
  if (saiuDaqui) return -v;
  if (entrouAqui) return v;
  return 0;
}

/* Estado de dentro da tela: mês em análise, filtros, aba de relatório.
   É transitório de propósito. Ver março e voltar depois achando que é o mês
   corrente leva a conclusão errada sobre o dinheiro — o risco é grande e o custo
   de reabrir o mês antigo é um toque. Zera ao trocar de tela e ao abrir o app. */
const ESTADO_DA_TELA = { monthOffset: 0, repOffset: 0 };
function zerarEstadoDaTela() {
  Object.assign(state, ESTADO_DA_TELA);
  state.filtros = filtrosVazios();
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
    localStorage.setItem(UI_KEY, JSON.stringify({ tagsFixas }));
  } catch (_) {}
}

/* Abrir o app SEMPRE começa no Painel, qualquer que tenha sido a última tela.
   Abrir é o momento de perguntar "como estamos?", e a resposta é o Painel —
   cair em Relatórios ou Cartões porque foi lá que a sessão anterior terminou faz
   o app parecer que guardou um estado que já não vale.

   Bloquear e desbloquear dentro da mesma sessão não passa por aqui: state.tab
   segue em memória, e voltar para onde se estava é o certo naquele caso.

   As etiquetas fixadas continuam sendo lembradas: são decisão de quem lança
   ("estou registrando os gastos da viagem"), não jeito de olhar a tela. */
function restoreUI() {
  zerarEstadoDaTela();
  state.tab = 'inicio';
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY));
    if (s && Array.isArray(s.tagsFixas)) tagsFixas = s.tagsFixas.filter(t => typeof t === 'string');
  } catch (_) {}
}

/* ---------- Utilitários ---------- */
const $ = sel => document.querySelector(sel);
const fmt = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtShort = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
/* Valor sem "R$", para a faixa de quatro colunas do extrato. O símbolo repetido
   quatro vezes rouba justamente a largura de que os centavos precisam — e
   centavos ali não são detalhe: são o que faz o número bater com o extrato do
   banco na conferência. A coluna rotulada já diz que é dinheiro. */
const fmtSemMoeda = v => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Meio-dia para o horário de verão não empurrar a data um dia para trás
const somarDias = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
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

/* Aviso com uma ação junto. Fica mais tempo na tela que o toast comum: 2,6s dá
   para ler, não dá para decidir — e a decisão aqui é desfazer uma mudança que
   pegou dezenas de lançamentos de uma vez. */
function toastAcao(msg, rotulo, fn, ms = 12000) {
  const t = $('#toast');
  t.className = 'toast t-ok tem-acao';
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" id="toast-acao">${esc(rotulo)}</button>`;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  const fechar = () => { t.hidden = true; t.innerHTML = ''; t.classList.remove('tem-acao'); };
  const botao = $('#toast-acao');
  if (botao) botao.onclick = () => { fechar(); fn(); };
  clearTimeout(t._t);
  t._t = setTimeout(fechar, ms);
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
        <div><small>Receitas</small><b>${fmt(realized)}</b></div>
        <div><small>Despesas</small><b>${fmt(stats.spent)}</b></div>
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
        <div><small>Em contas</small><b>${fmt(saldo)}</b></div>
        <div><small>Comprometido</small><b>${fmt(committed)}</b></div>
        <div><small>Gasto previsto</small><b>${fmt(stats.projection)}</b></div>
      </div>
    </div>`;

  return `
    ${setupCard}
    ${periodBar}
    ${atual ? heroAtual : heroFechado}
    ${adviceCard}
    <div class="kpi-grid">
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmt(total)}</div><div class="kpi-label">Gasto do mês</div><div class="kpi-sub">${txs.length} lançamentos</div></div>
      <div class="card kpi"><span class="kpi-ico t-danger" data-ico="invoice"></span><div class="kpi-value ${openInvoices ? 'red' : 'green'}">${fmt(openInvoices)}</div><div class="kpi-label">Faturas em aberto</div><div class="kpi-sub">${upcoming.length} fatura(s)</div></div>
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value green">${fmt(saldo)}</div><div class="kpi-label">Saldo em contas</div><div class="kpi-sub">${contas.length} conta(s)</div></div>
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
  const f = state.filtros || filtrosVazios();
  const rotulos = [];
  /* `valor` diz QUAL item sai ao tocar no × — sem ele a etiqueta apagaria o
     filtro inteiro, e tirar "Transporte" levaria "Alimentação" junto. */
  const add = (chave, texto, valor = null) => rotulos.push({ chave, texto, valor });
  const cada = (chave, rotulo) => (f[chave] || []).forEach(v => add(chave, rotulo(v), v));

  if (f.busca) add('busca', `“${f.busca}”`);
  cada('scope', v => v);
  cada('membro', v => (v === MEMBRO_COMUM ? 'Comum' : v));
  cada('tipo', v => v);
  cada('situacao', v => v);
  cada('categorias', v => DB.categoryPath(v) || 'Categoria');
  cada('tags', v => '#' + v);
  cada('metodos', v => v);
  cada('contas', v => (DB.get('accounts', v) || DB.get('cards', v) || {}).name || 'Conta');
  if (f.valorMin) add('valorMin', `a partir de ${fmtShort(f.valorMin)}`);
  if (f.valorMax) add('valorMax', `até ${fmtShort(f.valorMax)}`);
  if (f.recorrente) add('recorrente', 'Só custos fixos');
  return rotulos;
}

/* `ignorarJanela` serve à régua: as marcas de movimento precisam mostrar o mês
   inteiro, senão o trilho ficaria vazio fora do trecho já escolhido — e aí não
   haveria como ver para onde valeria a pena arrastar. */
function txsFiltradas(period, ignorarJanela) {
  const f = state.filtros || filtrosVazios();
  const busca = DB._semAcento(f.busca);
  // Lista vazia é "todos": o filtro só restringe depois que alguém escolhe algo
  const algum = (lista, valor) => !lista || !lista.length || lista.includes(valor);
  return DB.txOfPeriod(period).filter(t => {
    if (!algum(f.scope, t.scope)) return false;
    if (!algum(f.membro, t.member || MEMBRO_COMUM)) return false;
    if (!algum(f.tipo, DB.isTransfer(t) ? 'Transferência' : DB.isExpense(t) ? 'Despesa' : 'Receita')) return false;
    if (!algum(f.situacao, t.status)) return false;
    /* Casa pela categoria OU pela raiz dela: escolher o envelope "Alimentação"
       traz mercado e delivery, escolher "Mercado" traz só mercado. Um teste só
       cobre os dois níveis, e escolher a subcategoria deixou de arrastar o
       envelope inteiro junto — que era impreciso e não dava para desfazer. */
    if (f.categorias && f.categorias.length) {
      const raiz = DB.categoryRootId(t.category_id);
      if (!f.categorias.some(id => id === t.category_id || id === raiz)) return false;
    }
    if (f.tags && f.tags.length && !f.tags.some(tg => DB.tagsOf(t).includes(tg))) return false;
    if (!algum(f.metodos, t.method)) return false;
    if (f.contas && f.contas.length &&
        !f.contas.some(id => t.account_id === id || t.card_id === id || t.to_account === id)) return false;
    if (!ignorarJanela) {
      if (f.de && t.date < f.de) return false;
      if (f.ate && t.date > f.ate) return false;
    }
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

// Todos os dias do período, em ordem. É o eixo da régua.
function diasDoPeriodo(period) {
  const fim = somarDias(DB.fimISO(period), -1);      // period.end é exclusivo
  const dias = [];
  for (let d = DB.inicioISO(period); d <= fim; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/* A régua do mês.

   É o seletor de intervalo e, ao mesmo tempo, o mapa de onde o dinheiro se
   mexeu: cada dia vira uma marca com altura proporcional ao movimento dele. Sem
   as marcas, escolher um intervalo seria adivinhar — com elas, dá para ver o
   aglomerado do dia 5 e arrastar até ali. Por isso as marcas ignoram o próprio
   intervalo escolhido: um trilho que só mostra o que já está selecionado não
   ajuda a mudar a seleção.

   Dois <input type="range"> sobrepostos em vez de arrastar por conta própria:
   assim o teclado funciona (setas movem o polegar), o leitor de tela anuncia o
   valor, e não há código de toque para manter. */
function reguaDoMes(period, movimentoPorDia) {
  const dias = diasDoPeriodo(period);
  const n = dias.length;
  const f = state.filtros || filtrosVazios();
  const achar = (iso, padrao) => { const i = dias.indexOf(iso); return i < 0 ? padrao : i; };
  const iDe = f.de ? achar(f.de, 0) : 0;
  const iAte = f.ate ? achar(f.ate, n - 1) : n - 1;

  const maior = Math.max(1, ...Object.values(movimentoPorDia || {}));
  const marcas = dias.map((d, i) => {
    const v = (movimentoPorDia || {})[d] || 0;
    // Piso de 18%: um dia com um lançamento só precisa aparecer, e uma marca de
    // 2% é indistinguível de dia vazio
    const alt = v ? 18 + Math.round((v / maior) * 82) : 0;
    return `<span class="regua-marca${i >= iDe && i <= iAte ? ' dentro' : ''}" style="height:${alt}%"></span>`;
  }).join('');

  const pct = i => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const dia = iso => new Date(iso + 'T12:00:00').getDate();
  const inteiro = iDe === 0 && iAte === n - 1;

  return `
    <div class="regua" id="regua" data-dias="${n}">
      <div class="regua-trilho">
        <div class="regua-marcas">${marcas}</div>
        <div class="regua-faixa" style="left:${pct(iDe)}%;right:${100 - pct(iAte)}%"></div>
      </div>
      <input type="range" class="regua-thumb" id="regua-de" min="0" max="${n - 1}" value="${iDe}"
        aria-label="Primeiro dia do intervalo">
      <input type="range" class="regua-thumb" id="regua-ate" min="0" max="${n - 1}" value="${iAte}"
        aria-label="Último dia do intervalo">
      <div class="regua-pes">
        <span>${dia(dias[0])}</span>
        <b id="regua-rotulo">${inteiro ? 'Mês todo' : `${dia(dias[iDe])} a ${dia(dias[iAte])}`}</b>
        <span>${dia(dias[n - 1])}</span>
      </div>
    </div>`;
}

/* Os filtros como pílulas na própria tela, cada uma abrindo um painel ancorado
   nela. Não é folha nem modal: cobrir a lista para escolher o que a lista mostra
   é justamente o que atrapalha — some a referência do que se está filtrando.

   A pílula também É o estado. Com ela mostrando o próprio valor, a fileira de
   etiquetas ativas deixou de ter função e saiu: era a mesma informação repetida
   um bloco abaixo. */
function pilulasDeFiltro() {
  const membros = [MEMBRO_COMUM, ...DB.settings().members];
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const cartoes = DB.all('cards').filter(c => c.active !== false);
  return [
    { chave: 'tipo', rot: 'Tipo', ops: ['Despesa', 'Receita', 'Transferência'].map(v => ({ v, l: v })) },
    { chave: 'situacao', rot: 'Situação', ops: ['Pago', 'A Pagar'].map(v => ({ v, l: v })) },
    { chave: 'categorias', rot: 'Categoria', ops: opcoesCategoriaPilula() },
    { chave: 'contas', rot: 'Onde', ops: [...contas, ...cartoes].map(o => ({ v: o.id, l: o.name })) },
    { chave: 'membro', rot: 'Quem', ops: membros.map(m => ({ v: m, l: m === MEMBRO_COMUM ? 'Comum' : m })) },
    { chave: 'scope', rot: 'Âmbito', ops: ['Família', 'Pessoal'].map(v => ({ v, l: v })) },
    { chave: 'tags', rot: 'Etiqueta', ops: DB.allTags().map(t => ({ v: t, l: '#' + t })) },
    { chave: 'metodos', rot: 'Pagamento', ops: ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto', 'Transferência'].map(v => ({ v, l: v })) },
  ].filter(p => p.ops.length);
}

// Envelope e subcategorias na mesma lista, com o envelope primeiro e recuo nas
// filhas: é a hierarquia que o filtro usa para casar, então tem de aparecer
function opcoesCategoriaPilula() {
  const ops = [];
  for (const raiz of DB.rootCategories().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const filhas = DB.subcategoriesOf(raiz.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    ops.push({ v: raiz.id, l: `${raiz.icon} ${raiz.name}`, grupo: true });
    for (const fi of filhas) ops.push({ v: fi.id, l: fi.name, filha: true });
  }
  return ops;
}

function rotuloPilula(p) {
  const sel = (state.filtros[p.chave] || []);
  if (!sel.length) return p.rot;
  // Um valor mostra o próprio nome; vários mostram a contagem, porque três nomes
  // numa pílula viram uma linha que ninguém lê
  if (sel.length === 1) {
    const achado = p.ops.find(o => o.v === sel[0]);
    return achado ? achado.l : p.rot;
  }
  return `${p.rot} · ${sel.length}`;
}

/* O resumo do período. Quatro cartões iguais faziam nada ser importante: o olho
   media os quatro para descobrir qual responder. Aqui só o saldo do fim do
   recorte é grande — é a pergunta que traz alguém ao extrato. Entrou, saiu e o
   saldo anterior viram uma linha de apoio, e a explicação por extenso fica atrás
   do toque, porque ela se lê uma vez e depois só ocupa espaço. */
/* Saldo dia a dia dentro do recorte.

   Um passe só sobre os lançamentos: chamar saldoNaData uma vez por dia varreria
   a base inteira 31 vezes. As regras são exatamente as de saldoNaData — só
   "Pago", conciliação conta, transferência interna ao conjunto se anula —,
   porque a ponta final da série tem de bater com o saldo escrito no cartão. Um
   gráfico que termina num número diferente do número ao lado dele é pior que
   gráfico nenhum. */
function serieDeSaldo(contas, dias, anterior) {
  const alvo = (contas && contas.length) ? contas : DB.all('accounts').map(a => a.id);
  const dentro = id => alvo.includes(id);
  const delta = {};
  for (const t of DB.all('transactions')) {
    if (t.status !== 'Pago') continue;
    const v = Number(t.amount) || 0;
    let e = 0;
    if (DB.isTransfer(t)) {
      if (dentro(t.account_id)) e -= v;
      if (dentro(t.to_account)) e += v;
    } else if (dentro(t.account_id)) {
      e = DB.isExpense(t) ? -v : v;
    }
    if (e) delta[t.date] = (delta[t.date] || 0) + e;
  }
  let acumulado = Number(anterior) || 0;
  return dias.map(d => { acumulado += (delta[d] || 0); return acumulado; });
}

/* Área do saldo. Escala pelo intervalo dos dados, não a partir do zero: com
   saldo de R$ 14 mil, ancorar no zero achataria a linha inteira num traço reto e
   a variação — que é o que o gráfico existe para mostrar — sumiria. As duas
   pontas vêm escritas por extenso logo acima e abaixo, então a forma nunca é a
   única fonte do número. Quando a série cruza o zero, o zero aparece como régua. */
/* Catmull-Rom convertido em cúbicas de Bézier, com cada ponto de controle preso
   à faixa dos dois pontos que ele liga.

   A trava não é capricho: sem ela a curva ultrapassa os dados entre dois dias, e
   num gráfico de saldo isso desenha o dinheiro caindo abaixo do que realmente
   caiu — ou subindo acima do que subiu. Suavizar pode arredondar o caminho;
   não pode inventar valor que não existiu. */
function caminhoSuave(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const baixo = Math.min(p1[1], p2[1]), alto = Math.max(p1[1], p2[1]);
    const trava = y => Math.min(alto, Math.max(baixo, y));
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = trava(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = trava(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function sparkArea(vals) {
  const n = vals.length;
  if (n < 2) return '';
  const W = 300, H = 100, padT = 12, padB = 8;
  const max = Math.max(...vals), min = Math.min(...vals);
  const amplitude = (max - min) || Math.abs(max) || 1;
  const y = v => padT + (1 - (v - min) / amplitude) * (H - padT - padB);
  const x = i => (i / (n - 1)) * W;
  const linha = caminhoSuave(vals.map((v, i) => [x(i), y(v)]));
  const zero = (min < 0 && max > 0)
    ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" class="spark-zero"/>` : '';
  /* Degradê que apaga para baixo, como nos widgets do Metronic. Lavagem chapada
     vira bloco e briga com a linha; o degradê dá volume e devolve o branco do
     cartão embaixo, que é o que faz o gráfico assentar em vez de flutuar. */
  return `<svg class="spark-area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="grad-saldo" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#009ef7" stop-opacity=".2"/>
      <stop offset="100%" stop-color="#009ef7" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${linha} L${W} ${H} L0 ${H} Z" class="spark-fill"/>
    ${zero}
    <path d="${linha}" class="spark-linha"/>
    <line class="spark-cursor" x1="0" y1="0" x2="0" y2="${H}" hidden/>
  </svg>`;
}

function resumoExtrato({ titulo, saldo, anterior, entrou, saiu, rotEntrou, rotSaiu, nota, dias, serie, porDia }) {
  const aberto = state.resumoAberto !== false;
  const variacao = saldo - anterior;
  const dia = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const intervalo = dias.length ? `${dia(dias[0])} a ${dia(dias[dias.length - 1])}` : '';

  /* Anatomia do Mixed Widget 10 do Metronic: título e subtítulo à esquerda,
     valor à direita, gráfico generoso sangrando até a borda de baixo. A
     elegância ali vem da CONTENÇÃO — o número não é herói, é par do título; quem
     carrega o peso visual é o gráfico. Foi o inverso disto que fez a versão
     anterior parecer amadora: número de 22px e gráfico de 40px.

     O selo de variação segue o Statistics Widget 3 (symbol-label bg-light-*):
     fundo tingido, texto na cor forte. */
  return `
    <div class="card res${aberto ? '' : ' fechado'}" id="ext-resumo">
      <button class="res-topo" id="ext-resumo-toggle" aria-expanded="${aberto}">
        <span class="res-linha1">
          <span class="res-rot">
            <b>${esc(titulo)}</b>
            <small>${esc(intervalo)}</small>
          </span>
          <span class="res-dir">
            <b class="${saldo >= 0 ? '' : 'txt-red'}">${fmt(saldo)}</b>
            <span class="res-selo ${variacao >= 0 ? 'ok' : 'ruim'}"><i class="pt pt-${variacao >= 0 ? 'up' : 'dn'}"></i>${fmtSemMoeda(Math.abs(variacao))}</span>
          </span>
          <span class="res-seta" data-ico="chev"></span>
        </span>
        <!-- Entrou e saiu numa linha inteira só deles: espremidos ao lado da data
             eles quebravam e empurravam o valor da direita para baixo em tela
             estreita. Aqui têm a largura toda e nunca disputam espaço. -->
        <span class="res-fluxo">
          <span><i class="pt pt-up"></i>${fmtSemMoeda(entrou)} <small>${esc(rotEntrou)}</small></span>
          <span><i class="pt pt-dn"></i>${fmtSemMoeda(saiu)} <small>${esc(rotSaiu)}</small></span>
        </span>
      </button>
      <p class="muted res-nota">${nota}</p>
      <!-- Sangra até a borda, com o raio de baixo do cartão. É o que separa um
           gráfico desenhado de um gráfico encaixotado, e é o padrão do Metronic
           (card-body p-0 + card-rounded-bottom). -->
      <div class="res-graf" id="res-graf" data-dias="${esc(dias.join(','))}" data-vals="${esc(serie.join(','))}"
        data-ent="${esc(dias.map(d => (porDia[d] || {}).entrou || 0).join(','))}"
        data-sai="${esc(dias.map(d => (porDia[d] || {}).saiu || 0).join(','))}"
        data-antes="${fmtSemMoeda(anterior)}"
        role="img" aria-label="Saldo dia a dia de ${esc(intervalo)}, de ${fmtSemMoeda(anterior)} a ${fmtSemMoeda(saldo)}">
        ${sparkArea(serie)}
        <div class="res-tip" id="res-tip" hidden></div>
      </div>
    </div>`;
}

function renderExtrato(period) {
  if (!state.filtros) state.filtros = filtrosVazios();
  const ativos = filtrosAtivos();
  const txs = txsFiltradas(period);
  const total = txs.filter(t => DB.isExpense(t) && !t.adjustment).reduce((s, t) => s + Number(t.amount || 0), 0);
  const receitas = txs.filter(t => !DB.isExpense(t) && !t.card_id && !t.adjustment).reduce((s, t) => s + Number(t.amount || 0), 0);

  /* Com contas filtradas, o extrato vira o extrato DELAS — e aí transferência
     deixa de ser neutra por padrão: ela tira ou põe dinheiro no conjunto,
     exatamente como no extrato do banco. Sem isso os números não fecham.

     Entre duas contas que estão AMBAS no filtro, porém, o dinheiro continua sem
     entrar nem sair: contar seria inventar movimento. Ver efeitoDaTransferencia. */
  /* As bordas do que está sendo olhado. Recortar a lista sem recortar os saldos
     daria um "Saldo anterior" do dia 1 acima de uma lista que começa no dia 10 —
     o mesmo tipo de divergência que já fez o extrato discordar do saldo da conta.
     saldoNaData(D) é o saldo ANTES de qualquer lançamento de D, então o fim é o
     dia seguinte ao último dia do recorte. */
  const bordaDe = state.filtros.de || DB.inicioISO(period);
  const bordaAte = state.filtros.ate ? somarDias(state.filtros.ate, 1) : DB.fimISO(period);
  const recortado = !!(state.filtros.de || state.filtros.ate);
  // Dias do recorte, que são o eixo dos mini-gráficos do resumo
  const diasDoRecorte = [];
  for (let d = bordaDe; d < bordaAte; d = somarDias(d, 1)) diasDoRecorte.push(d);

  const contasFiltradas = (state.filtros.contas || []).filter(id => DB.get('accounts', id));
  const efeitoNaConta = t => efeitoDaTransferencia(t, contasFiltradas);
  const contaFiltrada = contasFiltradas.length ? contasFiltradas : null;

  /* Total do dia, somado sobre a lista JÁ FILTRADA: com um filtro ativo, um total
     vindo de outra base não bateria com as linhas logo abaixo dele. */
  const porDia = {};
  for (const t of txs) {
    const d = (porDia[t.date] = porDia[t.date] || { saiu: 0, entrou: 0 });
    const v = Number(t.amount) || 0;
    if (DB.isTransfer(t)) {
      const efeito = efeitoNaConta(t);
      if (efeito < 0) d.saiu += -efeito;
      else if (efeito > 0) d.entrou += efeito;
      continue;
    }
    if (t.adjustment) continue;              // conciliação não é gasto nem entrada
    if (DB.isExpense(t)) d.saiu += v;
    else if (!t.card_id) d.entrou += v;      // estorno de cartão abate a fatura, não entra na conta
  }

  // Totais do período nesta conta: a soma dos dias, para o topo e a lista contarem
  // a mesma história
  const saiuNaConta = Object.values(porDia).reduce((s, d) => s + d.saiu, 0);
  const entrouNaConta = Object.values(porDia).reduce((s, d) => s + d.entrou, 0);

  let list = '', lastDay = '';
  for (const t of txs) {
    if (t.date !== lastDay) {
      lastDay = t.date;
      const d = porDia[t.date] || { saiu: 0, entrou: 0 };
      /* Componentes sempre, saldo só quando houve os dois: num dia só de gastos o
         saldo repetiria o mesmo número, e repetir número é o que faz a pessoa
         parar de ler. Com os dois, o saldo é a resposta que nenhum dos dois dá
         sozinho — R$ 3.000 de salário e R$ 3.000 de contas não é dia parado. */
      const liq = d.entrou - d.saiu;
      /* Badge no padrão Metronic (badge-light-*): fundo tingido, texto na cor
         forte, cantos arredondados. Fundo próprio separa cada número do outro
         melhor do que espaço em branco, e a cor fica no bloco inteiro em vez de
         só no dígito — que era o que deixava a linha lavada. */
      const badge = (rot, cls, valor) =>
        `<span class="dia-badge ${cls}"><i>${rot}</i>${valor}</span>`;
      const totais = [
        d.entrou ? badge('Entradas', 'ok', fmt(d.entrou)) : '',
        d.saiu ? badge('Saídas', 'ruim', fmt(d.saiu)) : '',
        (d.entrou && d.saiu)
          ? badge('Saldo', liq >= 0 ? 'saldo pos' : 'saldo neg', `${liq >= 0 ? '+' : '−'} ${fmt(Math.abs(liq))}`) : '',
      ].filter(Boolean).join('');
      list += `<p class="tx-day"><span>${fmtDay(t.date)}</span>${totais ? `<span class="tx-day-tot">${totais}</span>` : ''}</p>`;
    }
    const c = catOf(t.category_id);
    const via = t.method === 'Cartão de Crédito'
      ? `💳 ${esc((DB.get('cards', t.card_id) || {}).name || 'Cartão')}`
      : esc(t.method);
    const isExp = DB.isExpense(t);
    const isTr = DB.isTransfer(t);
    // Conferindo uma conta, o que importa é para onde foi (ou de onde veio) — o
    // nome dela nos dois lados da seta seria ruído
    const efeito = efeitoNaConta(t);
    const rota = !isTr ? ''
      : efeito < 0 ? `para ${esc((DB.get('accounts', t.to_account) || {}).name || '?')}`
      : efeito > 0 ? `de ${esc((DB.get('accounts', t.account_id) || {}).name || '?')}`
      : `${esc((DB.get('accounts', t.account_id) || {}).name || '?')} → ${esc((DB.get('accounts', t.to_account) || {}).name || '?')}`;
    list += `<div class="tx ${DB.isNeutral(t) ? 'tx-adj' : ''}" data-tx="${t.id}">
      <span class="tx-ico ${isTr ? 'i-transfer' : !isExp && !t.adjustment ? 'i-receita' : ''}">${isTr ? '⇄' : t.adjustment ? '⚖️' : isExp ? esc(c ? c.icon : '🧾') : '💵'}</span>
      <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
      <span class="tx-meta">${isTr ? `Transferência · ${rota}`
        : t.adjustment ? 'Conciliação — fora das análises · toque para classificar'
        : `${c ? esc(DB.categoryPath(t.category_id)) : (isExp ? 'Sem categoria' : 'Entrada sem origem')} · ${via}${t.member ? ' · ' + esc(t.member) : ''}${t.installment ? ' · parcela ' + esc(t.installment) : ''}`}</span>
      ${DB.tagsOf(t).length ? `<span class="tx-tags">${DB.tagsOf(t).map(tg =>
        `<button class="tx-tag" data-tag="${esc(tg)}" title="Filtrar por #${esc(tg)}">#${esc(tg)}</button>`).join('')}</span>` : ''}</span>
      <span class="tx-amount ${isTr ? 'transfer' : !isExp ? 'income' : t.status === 'A Pagar' ? 'pending' : ''}">${
        isTr ? (efeitoNaConta(t) < 0 ? '− ' : efeitoNaConta(t) > 0 ? '+ ' : '')
        : isExp ? '− ' : '+ '}${fmt(t.amount)}</span>
      ${t.status === 'A Pagar' ? `<button class="pay-btn" data-pay-tx="${t.id}" title="Marcar como ${isExp ? 'pago' : 'recebido'}"><span data-ico="check"></span></button>` : ''}
    </div>`;
  }
  // Vazio com filtro ativo é ambíguo: pode ser que não haja nada, ou que o filtro
  // esteja escondendo tudo. A mensagem diz qual dos dois é, e oferece a saída.
  if (!txs.length) {
    list = ativos.length
      ? `<div class="empty"><b>Nenhum lançamento com esses filtros</b>Há ${DB.txOfPeriod(period).length} no período. <button class="btn ghost" id="limpar-vazio" style="margin-top:10px">Limpar os filtros</button></div>`
      : `<div class="empty"><b>Sem lançamentos</b>Nada registrado neste período ainda.
          <button class="btn" data-novo="Despesa" style="margin-top:12px">Lançar o primeiro gasto</button></div>`;
  }

  const isCurrent = state.monthOffset === 0;
  const st = DB.statsFor(period);

  /* Movimento por dia para as marcas da régua: conta os lançamentos do mês
     inteiro sob os DEMAIS filtros, ignorando o recorte de dias. */
  const movimentoPorDia = {};
  for (const t of txsFiltradas(period, true)) movimentoPorDia[t.date] = (movimentoPorDia[t.date] || 0) + 1;

  const pilulas = pilulasDeFiltro();
  const temFiltro = pilulas.some(p => (state.filtros[p.chave] || []).length)
    || state.filtros.busca || state.filtros.valorMin || state.filtros.valorMax || state.filtros.recorrente;

  return `
    <!-- Barra presa no topo: mês, régua e filtros continuam ao alcance enquanto a
         lista rola. Usa o fundo da página, não o dos cartões — ela não flutua
         sobre o conteúdo, ela É o topo da página, preso. -->
    <div class="ext-topo">
      <!-- Mesmo cartão de mês do Painel: trocar de tela não deve trocar a forma
           de andar no tempo. A sublinha diz os limites do mês; a régua abaixo
           diz o trecho escolhido dentro dele — coisas diferentes. -->
      <div class="card month-nav">
        <button id="mn-prev" aria-label="Mês anterior" data-ico="chevL"></button>
        <div style="text-align:center">
          <b>${esc(period.label)}</b>
          <div class="muted" style="font-size:11.5px">${fmtDate(period.start)} a ${fmtDate(new Date(period.end.getTime() - 86400000))}${
            isCurrent ? ` · dia ${st.elapsedDays} de ${st.totalDays}` : ' · encerrado'}</div>
        </div>
        <button id="mn-next" aria-label="Próximo mês" data-ico="chevR" ${isCurrent ? 'disabled style="opacity:.35"' : ''}></button>
      </div>
      ${reguaDoMes(period, movimentoPorDia)}
      <div class="ext-pilulas" id="ext-pilulas">
        <!-- O rótulo vai num <span> próprio: text-overflow não funciona em
             contêiner flex, e sem ele o texto longo era cortado no seco, sem
             reticências — a pílula aparecia pela metade. -->
        <button class="pilula pilula-busca${state.filtros.busca ? ' on' : ''}" data-pilula="busca">
          <span data-ico="search"></span><span class="pilula-rot">${state.filtros.busca ? esc(state.filtros.busca) : 'Buscar'}</span>
        </button>
        ${pilulas.map(p => {
          const n = (state.filtros[p.chave] || []).length;
          return `<button class="pilula${n ? ' on' : ''}" data-pilula="${p.chave}"><span class="pilula-rot">${esc(rotuloPilula(p))}</span>${
            n ? '<i class="pilula-x" data-limpa-pilula="' + p.chave + '">×</i>' : '<span class="pilula-seta"></span>'}</button>`;
        }).join('')}
        <button class="pilula${state.filtros.valorMin || state.filtros.valorMax || state.filtros.recorrente ? ' on' : ''}" data-pilula="mais"><span class="pilula-rot">Mais</span><span class="pilula-seta"></span></button>
        ${temFiltro ? '<button class="pilula pilula-limpar" id="limpar-filtros">Limpar</button>' : ''}
      </div>
    </div>
    ${contaFiltrada ? (() => {
      // Conferindo contas: os números viram os DELAS, para bater com o extrato do
      // banco linha a linha.
      const nomes = contasFiltradas.map(id => (DB.get('accounts', id) || {}).name).filter(Boolean);
      const saldo = contasFiltradas.reduce((s, id) => s + (Number((DB.get('accounts', id) || {}).balance) || 0), 0);
      const varias = contasFiltradas.length > 1;
      /* Saldo anterior e saldo final vêm os DOIS do saldo real da conta, cada um
         medido na sua data — não de "anterior + entrou − saiu".

         Motivo: entrou/saiu deixam a conciliação de fora de propósito (ela não é
         gasto nem entrada), mas ela MEXE no saldo. Derivar o fechamento da soma
         daria um número que não existe em lugar nenhum — foi o que fez o extrato
         de julho discordar do saldo da conta.

         Quando sobra diferença, ela é a conciliação, e aparece dita por extenso
         em vez de deixar a conta parecer errada. */
      const anterior = DB.saldoNaData(contasFiltradas, bordaDe);
      const finalMes = DB.saldoNaData(contasFiltradas, bordaAte);
      const conciliado = finalMes - (anterior + entrouNaConta - saiuNaConta);
      return resumoExtrato({
        titulo: `${varias ? 'Saldo somado' : 'Saldo'} em ${fmtDate(new Date(somarDias(bordaAte, -1) + 'T12:00:00'))}`,
        saldo: finalMes, anterior, entrou: entrouNaConta, saiu: saiuNaConta,
        rotEntrou: 'entrou', rotSaiu: 'saiu',
        dias: diasDoRecorte, porDia,
        serie: serieDeSaldo(contasFiltradas, diasDoRecorte, anterior),
        nota: `Extrato de <b>${esc(nomes.join(' + '))}</b> — o saldo anterior é o que ${
          recortado ? `havia em ${fmtDate(new Date(bordaDe + 'T12:00:00'))}` : 'veio do mês passado'}.${
          Math.abs(conciliado) > 0.005 ? ` Há <b>${fmt(Math.abs(conciliado))}</b> de conciliação no período, que mexe no saldo mas não é gasto nem entrada.` : ''}${varias
          ? ' Transferência entre estas contas não conta, porque o dinheiro não saiu daqui.' : ''}`,
      });
    })()
    : (() => {
      /* Sem filtro de conta, o extrato é o de todo o dinheiro da família — e aí
         o que sobrou do mês passado também precisa aparecer, senão cada mês
         parece começar do zero e a soma nunca fecha com o saldo das contas. */
      // Os dois saldos vêm do saldo real das contas, cada um na sua data — ver o
      // comentário no ramo de cima: derivar o fechamento da soma ignora a conciliação
      const anterior = DB.saldoNaData(null, bordaDe);
      const finalMes = DB.saldoNaData(null, bordaAte);
      const resultado = receitas - total;
      const conciliado = finalMes - (anterior + resultado);
      const onde = recortado ? 'neste intervalo' : 'neste mês';
      const vindo = recortado
        ? `que havia em ${fmtDate(new Date(bordaDe + 'T12:00:00'))}`
        : 'que vieram do anterior';
      return resumoExtrato({
        titulo: `Saldo em ${fmtDate(new Date(somarDias(bordaAte, -1) + 'T12:00:00'))}`,
        saldo: finalMes, anterior, entrou: receitas, saiu: total,
        rotEntrou: 'receitas', rotSaiu: 'despesas',
        dias: diasDoRecorte, porDia,
        serie: serieDeSaldo(null, diasDoRecorte, anterior),
        nota: `${resultado >= 0
          ? `Sobrou <b class="txt-green">${fmt(resultado)}</b> ${onde}, somados aos ${fmt(anterior)} ${vindo}.`
          : `Faltou <b class="txt-red">${fmt(Math.abs(resultado))}</b> ${onde}, tirados dos ${fmt(anterior)} ${vindo}.`}${
          Math.abs(conciliado) > 0.005 ? ` Há ainda <b>${fmt(Math.abs(conciliado))}</b> de conciliação, que mexe no saldo sem ser gasto nem entrada.` : ''}`,
      });
    })()}
    ${isCurrent ? '<button class="btn ghost" id="btn-recur" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="sync"></span>Lançar custos fixos deste mês</button>' : ''}
    ${txs.length ? `<button class="btn ghost" id="btn-massa" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="edit"></span>Editar ${txs.length} lançamento${txs.length === 1 ? '' : 's'} em massa</button>` : ''}
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
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmt(total)}</div><div class="kpi-label">Despesas</div><div class="kpi-sub">${txs.length} lançamentos</div></div>
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value green">${fmt(receitasPeriodo)}</div><div class="kpi-label">Receitas</div><div class="kpi-sub">no período</div></div>
      <div class="card kpi"><span class="kpi-ico ${receitasPeriodo - total >= 0 ? 't-success' : 't-danger'}" data-ico="pie"></span><div class="kpi-value ${receitasPeriodo - total >= 0 ? 'green' : 'red'}">${fmt(receitasPeriodo - total)}</div><div class="kpi-label">Resultado</div><div class="kpi-sub">${receitasPeriodo > 0 ? Math.round((receitasPeriodo - total) / receitasPeriodo * 100) + '% da receita' : 'sem receita lançada'}</div></div>
      <div class="card kpi"><span class="kpi-ico t-warning" data-ico="calendar"></span><div class="kpi-value">${fmt(total / Math.max(1, DB.elapsedDays(period)))}</div><div class="kpi-label">Média por dia</div><div class="kpi-sub">${DB.elapsedDays(period)} de ${DB.periodDays(period)} dias</div></div>
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
  /* Trocar de mês volta para o mês todo: o recorte guarda datas absolutas, e
     levá-lo para outro mês daria um intervalo que não toca nada do que a tela
     passou a mostrar. */
  const zerarJanela = () => { if (state.filtros) { state.filtros.de = ''; state.filtros.ate = ''; } };
  if (prev) prev.onclick = () => { state.monthOffset--; zerarJanela(); render(); };
  if (next) next.onclick = () => { if (state.monthOffset < 0) { state.monthOffset++; zerarJanela(); render(); } };
  ligarRegua(DB.monthPeriod(new Date(), state.monthOffset));
  ligarPilulas();
  const resumoToggle = $('#ext-resumo-toggle');
  if (resumoToggle) resumoToggle.onclick = () => {
    state.resumoAberto = state.resumoAberto === false;
    const card = $('#ext-resumo');
    // Alterna sem redesenhar: recolher o resumo não deve remontar a lista inteira
    if (card) card.classList.toggle('fechado', !state.resumoAberto);
    resumoToggle.setAttribute('aria-expanded', String(state.resumoAberto));
  };
  ligarGrafico();
  const btnMassa = $('#btn-massa');
  if (btnMassa) btnMassa.onclick = () => openMassaModal(DB.monthPeriod(new Date(), state.monthOffset));
  const rprev = $('#rep-prev'), rnext = $('#rep-next');
  if (rprev) rprev.onclick = () => { state.repOffset = (state.repOffset || 0) - 1; render(); };
  if (rnext) rnext.onclick = () => { state.repOffset = (state.repOffset || 0) + 1; render(); };
  const goRep = $('#go-reports');
  if (goRep) goRep.onclick = () => setTab('relatorios');
  const goCards = $('#go-cards');
  if (goCards) goCards.onclick = () => openConfigSection('cards');
  v.querySelectorAll('[data-setup]').forEach(b => b.onclick = () => openConfigSection(b.dataset.setup));

  const limpar = () => { state.filtros = filtrosVazios(); render(); };
  const btnLimpar = $('#limpar-filtros');
  if (btnLimpar) btnLimpar.onclick = limpar;
  const btnLimparVazio = $('#limpar-vazio');
  if (btnLimparVazio) btnLimparVazio.onclick = limpar;
  // Tocar numa etiqueta do lançamento soma ela ao filtro, em vez de trocar: com
  // vários valores possíveis, substituir seria descartar o que já estava escolhido
  v.querySelectorAll('[data-tag]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const tag = el.dataset.tag;
    if (!state.filtros.tags.includes(tag)) state.filtros.tags = [...state.filtros.tags, tag];
    render();
  });
  // Do relatório por etiqueta direto para os lançamentos dela
  v.querySelectorAll('[data-ver-tag]').forEach(el => el.onclick = () => {
    const tag = el.dataset.verTag;
    setTab('extrato');                    // zera o resto dos filtros, então o alvo fica só a etiqueta
    state.filtros.tags = [tag];
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
/* A régua: arrastar move a faixa e o rótulo ao vivo, mas o extrato só é
   redesenhado ao SOLTAR. Redesenhar a cada pixel de arrasto refaria a lista
   inteira dezenas de vezes por segundo — o polegar engasgaria justamente no
   gesto que precisa ser fluido. */
function ligarRegua(period) {
  const caixa = $('#regua');
  if (!caixa) return;
  const de = $('#regua-de'), ate = $('#regua-ate');
  if (!de || !ate) return;
  const dias = diasDoPeriodo(period);
  const n = dias.length;
  const faixa = caixa.querySelector('.regua-faixa');
  const rotulo = $('#regua-rotulo');
  const marcas = caixa.querySelectorAll('.regua-marca');

  const limites = () => {
    let a = Number(de.value), b = Number(ate.value);
    return a <= b ? [a, b] : [b, a];      // polegares cruzados: vale o menor primeiro
  };
  const pintar = () => {
    const [a, b] = limites();
    const pct = i => (n <= 1 ? 0 : (i / (n - 1)) * 100);
    if (faixa) { faixa.style.left = pct(a) + '%'; faixa.style.right = (100 - pct(b)) + '%'; }
    marcas.forEach((m, i) => m.classList.toggle('dentro', i >= a && i <= b));
    if (rotulo) {
      const dia = iso => new Date(iso + 'T12:00:00').getDate();
      rotulo.textContent = (a === 0 && b === n - 1) ? 'Mês todo' : `${dia(dias[a])} a ${dia(dias[b])}`;
    }
  };
  const aplicar = () => {
    const [a, b] = limites();
    const inteiro = a === 0 && b === n - 1;   // o mês todo é "sem recorte"
    state.filtros.de = inteiro ? '' : dias[a];
    state.filtros.ate = inteiro ? '' : dias[b];
    render();
  };
  for (const el of [de, ate]) {
    el.oninput = pintar;
    el.onchange = aplicar;                 // dispara ao soltar o polegar
  }
}

/* Arrastar o dedo sobre a área diz o saldo daquele dia.

   Sem isso o gráfico é só silhueta: dá para ver que subiu, não dá para saber
   quanto tinha no dia 12 — que é exatamente a pergunta de quem está conferindo
   contra o extrato do banco. O valor aparece no pé, no lugar das datas, em vez
   de numa bolha flutuante: no celular a bolha nasce debaixo do próprio dedo.

   Nada fica refém do toque: as duas pontas continuam escritas, e a lista abaixo
   traz o total de cada dia. */
function ligarGrafico() {
  const caixa = $('#res-graf');
  const tip = $('#res-tip');
  if (!caixa || !tip) return;
  const lista = k => (caixa.dataset[k] || '').split(',').filter(x => x !== '');
  const dias = lista('dias');
  const vals = lista('vals').map(Number);
  const ent = lista('ent').map(Number);
  const sai = lista('sai').map(Number);
  if (dias.length < 2 || vals.length !== dias.length) return;
  const cursor = caixa.querySelector('.spark-cursor');

  const mostrar = e => {
    const r = caixa.getBoundingClientRect();
    if (!r.width) return;
    const i = Math.max(0, Math.min(dias.length - 1,
      Math.round(((e.clientX - r.left) / r.width) * (dias.length - 1))));
    const d = new Date(dias[i] + 'T12:00:00');
    const linha = (rot, v, cls) => (v
      ? `<span class="res-tip-l"><i>${rot}</i><b${cls ? ` class="${cls}"` : ''}>${fmtSemMoeda(v)}</b></span>` : '');
    tip.innerHTML = `<span class="res-tip-d">${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</span>`
      + linha('saldo', vals[i])
      + linha('entrou', ent[i] || 0, 'txt-green')
      + linha('saiu', sai[i] || 0, 'txt-red');
    tip.hidden = false;

    /* O balão fica preso no ALTO do gráfico e só corre na horizontal: no celular
       o dedo está sobre a linha, e um balão que segue o toque nos dois eixos
       nasce debaixo do próprio dedo. Preso na borda para não vazar do cartão. */
    const larg = tip.offsetWidth || 120;
    const esq = Math.max(6, Math.min(r.width - larg - 6, (e.clientX - r.left) - larg / 2));
    tip.style.left = Math.round(esq) + 'px';

    if (cursor) {
      const x = (i / (dias.length - 1)) * 300;
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
      cursor.hidden = false;
    }
  };
  const soltar = () => { tip.hidden = true; if (cursor) cursor.hidden = true; };

  caixa.onpointerdown = e => { caixa.setPointerCapture && caixa.setPointerCapture(e.pointerId); mostrar(e); };
  caixa.onpointermove = e => { if (e.buttons || e.pointerType !== 'touch') mostrar(e); };
  caixa.onpointerup = soltar;
  caixa.onpointercancel = soltar;
  caixa.onpointerleave = soltar;
}

/* Cada pílula abre o próprio painel, ancorado nela. O × na pílula ativa limpa só
   aquele filtro sem abrir nada — é o gesto mais frequente depois de filtrar. */
function ligarPilulas() {
  const barra = $('#ext-pilulas');
  if (!barra) return;
  const defs = pilulasDeFiltro();
  barra.querySelectorAll('[data-limpa-pilula]').forEach(x => x.onclick = e => {
    e.stopPropagation();
    state.filtros[x.dataset.limpaPilula] = [];
    render();
  });
  barra.querySelectorAll('[data-pilula]').forEach(b => b.onclick = e => {
    if (e.target.dataset && e.target.dataset.limpaPilula) return;   // o × já tratou
    const chave = b.dataset.pilula;
    if (chave === 'busca') return abrirPopBusca(b);
    if (chave === 'mais') return abrirPopMais(b);
    const def = defs.find(d => d.chave === chave);
    if (def) abrirPopLista(b, def);
  });
}

function abrirPopLista(ancora, def) {
  const sel = () => state.filtros[def.chave] || [];
  const comBusca = def.ops.length > 8;
  const linha = o => `<div class="ui-opt${sel().includes(o.v) ? ' is-sel' : ''}${o.filha ? ' e-filha' : ''}${
    o.grupo ? ' e-grupo' : ''}" data-v="${esc(o.v)}">${esc(o.l)}${sel().includes(o.v) ? '<span class="ui-check">✓</span>' : ''}</div>`;

  const painel = UI.popover(ancora, `
    ${comBusca ? '<div class="ui-search"><input type="text" placeholder="Buscar…" autocomplete="off"></div>' : ''}
    <div class="ui-list" role="listbox">${def.ops.map(linha).join('')}</div>
    <div class="ui-pop-pe"><button type="button" data-pop-limpar>Limpar</button><span>${sel().length || 'nenhum'} escolhido(s)</span></div>
  `, aplicarPilulaSePreciso);
  if (!painel) return;
  const lista = painel.querySelector('.ui-list');
  const pe = painel.querySelector('.ui-pop-pe span');

  const redesenhar = filtro => {
    const f = UI.norm(filtro || '');
    const vis = def.ops.filter(o => !f || UI.norm(o.l).includes(f));
    lista.innerHTML = vis.length ? vis.map(linha).join('') : '<div class="ui-empty">Nada encontrado</div>';
    if (pe) pe.textContent = `${sel().length || 'nenhum'} escolhido(s)`;
    ligar();
  };
  const ligar = () => lista.querySelectorAll('[data-v]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const v = el.dataset.v;
    const atual = sel();
    state.filtros[def.chave] = atual.includes(v) ? atual.filter(x => x !== v) : [...atual, v];
    /* Só a lista se redesenha; o extrato espera o painel fechar. Refazer a tela a
       cada toque arrancaria o painel de baixo do dedo no meio da escolha. */
    redesenhar(painel.querySelector('.ui-search input') ? painel.querySelector('.ui-search input').value : '');
    marcarPilulaSuja();
  });
  ligar();
  const busca = painel.querySelector('.ui-search input');
  if (busca) busca.oninput = () => redesenhar(busca.value);
  const limparBtn = painel.querySelector('[data-pop-limpar]');
  if (limparBtn) limparBtn.onclick = ev => {
    ev.stopPropagation();
    state.filtros[def.chave] = [];
    redesenhar(busca ? busca.value : '');
    marcarPilulaSuja();
  };
}

/* Fechar o painel é o que aplica: enquanto ele está aberto a lista atrás segue
   intacta, servindo de referência para o que se está escolhendo. */
let pilulaSuja = false;
function marcarPilulaSuja() { pilulaSuja = true; }
function aplicarPilulaSePreciso() {
  if (!pilulaSuja) return;
  pilulaSuja = false;
  render();
}

function abrirPopBusca(ancora) {
  const painel = UI.popover(ancora, `
    <div class="ui-search"><input type="search" id="pop-busca" placeholder="Descrição, categoria, etiqueta…"
      autocomplete="off" value="${esc(state.filtros.busca)}"></div>
    <div class="ui-pop-pe"><button type="button" data-pop-limpar>Limpar</button><span>Enter para aplicar</span></div>
  `);
  if (!painel) return;
  const inp = painel.querySelector('#pop-busca');
  const aplicar = () => { state.filtros.busca = inp.value.trim(); UI.fechar(); render(); };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); aplicar(); } };
  inp.onblur = aplicar;
  painel.querySelector('[data-pop-limpar]').onclick = e => {
    e.stopPropagation(); inp.value = ''; aplicar();
  };
}

// O que sobra: valor e custos fixos. Ficam atrás de "Mais" porque quase nunca
// são o filtro que se usa, e ocupariam duas pílulas na fileira principal
function abrirPopMais(ancora) {
  const f = state.filtros;
  const painel = UI.popover(ancora, `
    <div class="ui-pop-form">
      <div class="row2">
        <div class="field"><label>Valor de</label><input id="pop-min" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
        <div class="field"><label>até</label><input id="pop-max" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
      </div>
      <label class="pop-check"><input type="checkbox" id="pop-rec" ${f.recorrente ? 'checked' : ''}><span>Só custos fixos</span></label>
    </div>
    <div class="ui-pop-pe"><button type="button" data-pop-limpar>Limpar</button><button type="button" data-pop-ok>Aplicar</button></div>
  `);
  if (!painel) return;
  initMoney('#pop-min', f.valorMin || 0);
  initMoney('#pop-max', f.valorMax || 0);
  painel.querySelector('[data-pop-ok]').onclick = e => {
    e.stopPropagation();
    state.filtros.valorMin = moneyVal('#pop-min') || '';
    state.filtros.valorMax = moneyVal('#pop-max') || '';
    state.filtros.recorrente = !!painel.querySelector('#pop-rec').checked;
    UI.fechar(); render();
  };
  painel.querySelector('[data-pop-limpar]').onclick = e => {
    e.stopPropagation();
    state.filtros.valorMin = ''; state.filtros.valorMax = ''; state.filtros.recorrente = false;
    UI.fechar(); render();
  };
}

/* ---------- Edição em massa ----------
   O lote é o que está filtrado: o filtro já é a linguagem de seleção do extrato,
   e inventar uma segunda só para cá seria fazer a pessoa dizer duas vezes a
   mesma coisa.

   A regra que organiza a tela toda: cada campo tem um interruptor, e campo
   desligado não é tocado. Quando 34 lançamentos têm categorias diferentes, o
   formulário não tem o que preencher — e qualquer valor pré-carregado viraria
   uma sobrescrita que ninguém pediu. */
const Massa = {
  ids: [],              // fotografia do filtro no momento de abrir
  marcados: new Set(),
  desfazer: null,       // { antes, deltas } do último lote aplicado
};

/* Quanto um lançamento pesa em cada conta. Espelha applyTxEffect, mas devolvendo
   os números em vez de gravar: em lote, mexer no saldo por lançamento seriam 2N
   escritas, e parar no meio deixaria saldo corrompido. Aqui os deltas somam
   primeiro e vão para o banco uma vez por conta. */
function efeitoNasContas(t) {
  const fora = {};
  if (!t || t.status !== 'Pago') return fora;
  const v = Number(t.amount) || 0;
  const por = (id, d) => { if (id) fora[id] = (fora[id] || 0) + d; };
  if (DB.isTransfer(t)) { por(t.account_id, -v); por(t.to_account, v); return fora; }
  if (!t.account_id || t.card_id) return fora;   // cartão mexe na fatura, não na conta
  por(t.account_id, DB.isExpense(t) ? -v : v);
  return fora;
}

/* Quem aceita o quê. Transferência não tem categoria e tem duas pontas, então
   trocar "a conta" dela seria ambíguo; conciliação não é gasto nem entrada.
   Elas continuam selecionáveis — mudar observação ou etiqueta faz sentido — e o
   que não se aplica é dito por extenso antes de gravar, nunca em silêncio. */
const MASSA_ACEITA = {
  category_id: t => !DB.isTransfer(t) && !t.adjustment,
  account_id: t => !DB.isTransfer(t),
  status: t => !DB.isTransfer(t) && !t.adjustment,
};
const massaAceita = (campo, t) => (MASSA_ACEITA[campo] ? MASSA_ACEITA[campo](t) : true);

/* Trocar o TIPO não é trocar um campo: é mudar quantas contas o lançamento
   toca. Transferência sai de uma conta e entra em outra; despesa e receita
   mexem só numa. Virar transferência em despesa sem soltar o to_account
   deixaria a conta de destino com um crédito que nada mais explica.

   Método e categoria vêm junto porque não sobrevivem à travessia: "Transferência"
   não é forma de pagamento de uma despesa, e transferência não tem categoria. */
function trocarTipo(t, novoTipo, destino) {
  const novo = { ...t, type: novoTipo };
  if (novoTipo === 'Transferência') {
    novo.to_account = destino || t.to_account || null;
    novo.category_id = null;
    novo.method = 'Transferência';
    novo.card_id = null;                      // transferência é entre contas
  } else {
    novo.to_account = null;
    if (t.method === 'Transferência') novo.method = 'PIX';
  }
  return novo;
}

/* Grava UMA linha, com o saldo acertado e desfazer armazenado. É o caminho da
   edição linha a linha: o lote inteiro continua existindo para quando o valor é
   o mesmo em todos, mas o caso comum é cada lançamento querer o seu. */
function aplicarNaLinha(id, campos) {
  const t = DB.get('transactions', id);
  if (!t) return null;
  /* A troca de tipo vem primeiro porque ela redefine to_account, método e
     categoria; os campos pedidos entram por cima e vencem, para quem trocou o
     tipo E escolheu a categoria na mesma ação não perder a categoria. */
  const base = campos.type && campos.type !== t.type
    ? trocarTipo(t, campos.type, campos.to_account)
    : t;
  const novo = { ...base, ...campos };

  const deltas = {};
  const somar = (obj, sinal) => {
    for (const [conta, v] of Object.entries(obj)) deltas[conta] = (deltas[conta] || 0) + v * sinal;
  };
  DB.emLote(() => {
    somar(efeitoNasContas(t), -1);
    somar(efeitoNasContas(novo), +1);
    DB.upsert('transactions', novo);
    for (const [conta, d] of Object.entries(deltas)) if (Math.abs(d) > 0.004) adjustBalance(conta, d);
  });
  Massa.desfazer = { antes: [{ ...t }], deltas };
  return novo;
}

function massaAlvos() {
  return [...Massa.marcados].map(id => DB.get('transactions', id)).filter(Boolean);
}

/* Etiqueta é conjunto, não valor: "definir" apagaria o que já estava lá. Daí os
   três modos — somar é o caso comum, mas tirar uma etiqueta errada de 40 linhas
   de uma vez é justamente o tipo de conserto que traz alguém até aqui. */
function aplicarTags(atuais, modo, valores) {
  const set = new Set(atuais);
  if (modo === 'substituir') return [...valores];
  if (modo === 'remover') { valores.forEach(v => set.delete(v)); return [...set]; }
  valores.forEach(v => set.add(v));
  return [...set];
}

function openMassaModal(period) {
  Massa.ids = txsFiltradas(period).map(t => t.id);
  Massa.marcados = new Set(Massa.ids);      // abre com tudo marcado: o filtro já escolheu
  renderMassa();
}

/* Uma linha com os próprios controles.

   O caso comum não é "os 34 viram a mesma categoria" — é cada um querer o seu.
   Por isso categoria e tipo ficam na linha, a um toque, e o lote continua
   existindo só para quando o valor realmente é o mesmo em todos.

   Botão + popover em vez de <select> por linha: com 200 linhas seriam 400
   componentes montados de uma vez, e o celular engasga antes de a lista
   aparecer. O popover é um só, reaproveitado. */
function linhaEditavel(t) {
  const isTr = DB.isTransfer(t);
  const marcado = Massa.marcados.has(t.id);
  const tipo = isTr ? 'Transferência' : DB.isExpense(t) ? 'Despesa' : 'Receita';
  const catTxt = isTr
    ? `→ ${esc((DB.get('accounts', t.to_account) || {}).name || 'sem destino')}`
    : esc(DB.categoryPath(t.category_id) || 'Sem categoria');
  const tags = DB.tagsOf(t);
  return `<div class="ed-linha${marcado ? ' is-on' : ''}" data-massa="${t.id}">
    <div class="ed-cabeca">
      <input type="checkbox" ${marcado ? 'checked' : ''} aria-label="Selecionar ${esc(t.description)}">
      <span class="ed-nome">${esc(t.description)}</span>
      <span class="tx-amount ${isTr ? 'transfer' : DB.isExpense(t) ? '' : 'income'}">${fmt(t.amount)}</span>
    </div>
    <div class="ed-ctrls">
      <span class="ed-data">${fmtDay(t.date)}</span>
      <button class="ed-btn ed-tipo t-${tipo === 'Transferência' ? 'tr' : tipo === 'Receita' ? 'rec' : 'desp'}"
        data-ed="tipo" data-id="${t.id}">${tipo}</button>
      <button class="ed-btn${!isTr && !t.category_id ? ' vazio' : ''}" data-ed="cat" data-id="${t.id}">${catTxt}</button>
      <button class="ed-btn${tags.length ? '' : ' vazio'}" data-ed="tags" data-id="${t.id}">${
        tags.length ? tags.map(x => '#' + esc(x)).join(' ') : '# etiqueta'}</button>
      <button class="ed-btn ed-mais" data-ed="mais" data-id="${t.id}" aria-label="Mais campos">⋯</button>
    </div>
  </div>`;
}

function renderMassa() {
  const txs = Massa.ids.map(id => DB.get('transactions', id)).filter(Boolean);
  const n = Massa.marcados.size;
  const soma = txs.filter(t => Massa.marcados.has(t.id) && !DB.isNeutral(t))
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);

  openModal(`
    <div class="modal-title">Editar lançamentos<button class="close-x" id="md-close"><span data-ico="x"></span></button></div>
    <div class="massa-head">
      <div><b>${n} de ${txs.length}</b> <span class="muted">selecionados · ${fmt(soma)}</span></div>
      <div class="btn-row" style="margin:0">
        <button class="btn ghost" id="massa-todos">Marcar todos</button>
        <button class="btn ghost" id="massa-nenhum">Desmarcar</button>
      </div>
    </div>
    <div class="massa-lista">
      ${txs.map(t => linhaEditavel(t)).join('') || '<div class="empty">Nada no filtro atual.</div>'}
    </div>
    <div class="massa-barra">
      <span>${n} selecionado${n === 1 ? '' : 's'}</span>
      <span class="btn-row" style="margin:0">
        <button class="btn ghost t-danger" id="massa-excluir" ${n ? '' : 'disabled'}>Excluir</button>
        <button class="btn" id="massa-editar" ${n ? '' : 'disabled'}>Editar</button>
      </span>
    </div>`);

  const modal = $('#modal');
  const liga = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  liga('#md-close', closeModal);
  liga('#massa-todos', () => { Massa.marcados = new Set(Massa.ids); renderMassa(); });
  liga('#massa-nenhum', () => { Massa.marcados = new Set(); renderMassa(); });
  liga('#massa-editar', () => openMassaEditSheet());
  liga('#massa-excluir', () => excluirMassa());
  modal.querySelectorAll('[data-massa]').forEach(el => {
    const box = el.querySelector('input[type="checkbox"]');
    if (!box) return;
    box.onchange = ev => {
      const id = el.dataset.massa;
      if (ev.target.checked) Massa.marcados.add(id); else Massa.marcados.delete(id);
      /* Atualiza só o que mudou: com centenas de linhas, refazer a lista inteira
         a cada toque trava o celular e joga a rolagem de volta para o topo. */
      el.classList.toggle('is-on', ev.target.checked);
      atualizarBarraMassa();
    };
  });
  modal.querySelectorAll('[data-ed]').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.id;
    if (b.dataset.ed === 'tipo') return abrirEdTipo(b, id);
    if (b.dataset.ed === 'cat') return abrirEdCategoria(b, id);
    if (b.dataset.ed === 'tags') return abrirEdTags(b, id);
    abrirEdMais(b, id);
  });
}

/* Redesenha UMA linha no lugar. Refazer o modal inteiro a cada toque perderia a
   rolagem — e numa tela feita para percorrer dezenas de lançamentos, voltar ao
   topo a cada ajuste inviabiliza a tarefa. */
function repintarLinha(id) {
  const t = DB.get('transactions', id);
  const el = document.querySelector(`.ed-linha[data-massa="${id}"]`);
  if (!el || !t) { renderMassa(); return; }
  const novo = document.createElement('div');
  novo.innerHTML = linhaEditavel(t);
  const troca = novo.firstElementChild;
  el.replaceWith(troca);
  paintIcons(troca);
  const box = troca.querySelector('input[type="checkbox"]');
  if (box) box.onchange = ev => {
    if (ev.target.checked) Massa.marcados.add(id); else Massa.marcados.delete(id);
    troca.classList.toggle('is-on', ev.target.checked);
    atualizarBarraMassa();
  };
  troca.querySelectorAll('[data-ed]').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.ed === 'tipo') return abrirEdTipo(b, id);
    if (b.dataset.ed === 'cat') return abrirEdCategoria(b, id);
    if (b.dataset.ed === 'tags') return abrirEdTags(b, id);
    abrirEdMais(b, id);
  });
}

// Grava um campo de uma linha e avisa, com desfazer — as edições são imediatas,
// então a saída tem de estar sempre à mão
function gravarLinha(id, campos, aviso) {
  aplicarNaLinha(id, campos);
  repintarLinha(id);
  Sync.autoSync();
  toastAcao(aviso, 'Desfazer', desfazerMassa, 8000);
}

/* Trocar o tipo muda quantas contas o lançamento toca, então virar transferência
   exige dizer para onde o dinheiro foi — sem destino ela não teria a outra ponta. */
function abrirEdTipo(ancora, id) {
  const t = DB.get('transactions', id);
  if (!t) return;
  const atual = DB.isTransfer(t) ? 'Transferência' : DB.isExpense(t) ? 'Despesa' : 'Receita';
  const contas = DB.all('accounts').filter(a => a.active !== false && a.id !== t.account_id);
  const painel = UI.popover(ancora, `
    <div class="ui-list" role="listbox">
      ${['Despesa', 'Receita', 'Transferência'].map(v =>
        `<div class="ui-opt${v === atual ? ' is-sel' : ''}" data-v="${v}">${v}${v === atual ? '<span class="ui-check">✓</span>' : ''}</div>`).join('')}
    </div>
    <div class="ed-destino" hidden>
      <p class="muted" style="padding:8px 10px 0;margin:0">Para qual conta o dinheiro foi?</p>
      <div class="ui-list">${contas.map(a => `<div class="ui-opt" data-destino="${a.id}">${esc(a.name)}</div>`).join('')
        || '<div class="ui-empty">Só há uma conta cadastrada</div>'}</div>
    </div>
  `);
  if (!painel) return;
  painel.querySelectorAll('[data-v]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const v = el.dataset.v;
    if (v === atual) return UI.fechar();
    if (v === 'Transferência') {
      // Pede o destino antes de gravar: transferência sem a outra ponta é o
      // defeito que já custou 28 lançamentos quebrados nesta base
      painel.querySelector('.ed-destino').hidden = false;
      return;
    }
    UI.fechar();
    gravarLinha(id, { type: v }, `Agora é ${v.toLowerCase()} ✓`);
  });
  painel.querySelectorAll('[data-destino]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    UI.fechar();
    gravarLinha(id, { type: 'Transferência', to_account: el.dataset.destino }, 'Agora é transferência ✓');
  });
}

function abrirEdCategoria(ancora, id) {
  const t = DB.get('transactions', id);
  if (!t) return;
  if (DB.isTransfer(t)) return toast('Transferência não tem categoria — troque o tipo primeiro');
  const ops = opcoesCategoriaPilula();
  const linha = o => `<div class="ui-opt${o.v === t.category_id ? ' is-sel' : ''}${o.filha ? ' e-filha' : ''}${
    o.grupo ? ' e-grupo' : ''}" data-v="${esc(o.v)}">${esc(o.l)}${o.v === t.category_id ? '<span class="ui-check">✓</span>' : ''}</div>`;
  const painel = UI.popover(ancora, `
    <div class="ui-search"><input type="text" placeholder="Buscar categoria…" autocomplete="off"></div>
    <div class="ui-list" role="listbox">${ops.map(linha).join('')}</div>
    <div class="ui-pop-pe"><button type="button" data-pop-limpar>Sem categoria</button></div>
  `);
  if (!painel) return;
  const lista = painel.querySelector('.ui-list');
  const ligar = () => lista.querySelectorAll('[data-v]').forEach(el => el.onclick = ev => {
    ev.stopPropagation(); UI.fechar();
    gravarLinha(id, { category_id: el.dataset.v }, 'Categoria alterada ✓');
  });
  ligar();
  const busca = painel.querySelector('.ui-search input');
  busca.oninput = () => {
    const f = UI.norm(busca.value);
    const vis = ops.filter(o => !f || UI.norm(o.l).includes(f));
    lista.innerHTML = vis.length ? vis.map(linha).join('') : '<div class="ui-empty">Nada encontrado</div>';
    ligar();
  };
  painel.querySelector('[data-pop-limpar]').onclick = ev => {
    ev.stopPropagation(); UI.fechar();
    gravarLinha(id, { category_id: null }, 'Categoria removida');
  };
}

function abrirEdTags(ancora, id) {
  const t = DB.get('transactions', id);
  if (!t) return;
  const atuais = DB.tagsOf(t);
  const todas = DB.allTags();
  const linha = tg => `<div class="ui-opt${atuais.includes(tg) ? ' is-sel' : ''}" data-v="${esc(tg)}">#${esc(tg)}${
    atuais.includes(tg) ? '<span class="ui-check">✓</span>' : ''}</div>`;
  const painel = UI.popover(ancora, `
    <div class="ui-search"><input type="text" id="ed-tag-nova" placeholder="Nova etiqueta e Enter…" autocomplete="off"></div>
    ${todas.length ? `<div class="ui-list" role="listbox">${todas.map(linha).join('')}</div>` : '<div class="ui-empty">Nenhuma etiqueta ainda</div>'}
  `);
  if (!painel) return;
  // Alterna sem fechar: marcar três etiquetas não deve custar três aberturas
  painel.querySelectorAll('[data-v]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    const tg = el.dataset.v;
    const t2 = DB.get('transactions', id);
    const agora = DB.tagsOf(t2);
    const novas = agora.includes(tg) ? agora.filter(x => x !== tg) : [...agora, tg];
    aplicarNaLinha(id, { tags: novas });
    el.classList.toggle('is-sel');
    el.innerHTML = `#${UI.esc(tg)}${novas.includes(tg) ? '<span class="ui-check">✓</span>' : ''}`;
    repintarLinha(id);
    Sync.autoSync();
  });
  const nova = painel.querySelector('#ed-tag-nova');
  nova.onkeydown = ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const tg = DB.normTag(nova.value);
    if (!tg) return;
    const agora = DB.tagsOf(DB.get('transactions', id));
    if (!agora.includes(tg)) aplicarNaLinha(id, { tags: [...agora, tg] });
    UI.fechar(); repintarLinha(id); Sync.autoSync();
    toastAcao(`#${tg} aplicada ✓`, 'Desfazer', desfazerMassa, 8000);
  };
}

// O resto dos campos de uma linha só: situação, âmbito, quem e conta
function abrirEdMais(ancora, id) {
  const t = DB.get('transactions', id);
  if (!t) return;
  const membros = [MEMBRO_COMUM, ...DB.settings().members];
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const grupo = (rot, campo, opcoes, atual) => `
    <div class="ed-grupo"><small>${rot}</small>
      ${opcoes.map(o => `<button type="button" class="ed-op${o.v === atual ? ' is-sel' : ''}"
        data-campo="${campo}" data-v="${esc(o.v)}">${esc(o.l)}</button>`).join('')}
    </div>`;
  const painel = UI.popover(ancora, `
    <div class="ed-mais-corpo">
      ${DB.isTransfer(t) ? '' : grupo('Situação', 'status', [{ v: 'Pago', l: 'Pago' }, { v: 'A Pagar', l: 'A pagar' }], t.status)}
      ${grupo('Âmbito', 'scope', [{ v: 'Família', l: 'Família' }, { v: 'Pessoal', l: 'Pessoal' }], t.scope)}
      ${grupo('De quem', 'member', membros.map(m => ({ v: m, l: m === MEMBRO_COMUM ? 'Comum' : m })), t.member || MEMBRO_COMUM)}
      ${grupo(DB.isTransfer(t) ? 'Conta de origem' : 'Conta', 'account_id', contas.map(a => ({ v: a.id, l: a.name })), t.account_id)}
    </div>
    <div class="ui-pop-pe"><button type="button" data-abrir-completo>Abrir lançamento</button></div>
  `);
  if (!painel) return;
  painel.querySelectorAll('[data-campo]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    UI.fechar();
    gravarLinha(id, { [el.dataset.campo]: el.dataset.v }, 'Alterado ✓');
  });
  painel.querySelector('[data-abrir-completo]').onclick = ev => {
    ev.stopPropagation(); UI.fechar();
    openTxSheet(DB.get('transactions', id));
  };
}

function atualizarBarraMassa() {
  const barra = document.querySelector('.massa-barra');
  if (!barra) return;
  const n = Massa.marcados.size;
  barra.querySelector('span').textContent = `${n} selecionado${n === 1 ? '' : 's'}`;
  barra.querySelectorAll('button').forEach(b => { b.disabled = !n; });
  const cab = document.querySelector('.massa-head b');
  if (cab) cab.textContent = `${n} de ${Massa.ids.length}`;
}

function openMassaEditSheet() {
  const alvos = massaAlvos();
  if (!alvos.length) return toast('Escolha ao menos um lançamento');
  const membros = [MEMBRO_COMUM, ...DB.settings().members];
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const metodos = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
  const tags = DB.allTags();

  // Um campo = um interruptor + o controle que ele revela
  const campo = (chave, rotulo, controle, aviso) => `
    <div class="massa-campo">
      <label class="massa-liga"><input type="checkbox" data-liga="${chave}"><span>${rotulo}</span></label>
      <div class="massa-ctrl" data-ctrl="${chave}" hidden>${controle}
        ${aviso ? `<p class="muted" style="margin-top:6px">${aviso}</p>` : ''}</div>
    </div>`;
  const foraDe = chave => alvos.filter(t => !massaAceita(chave, t)).length;
  const nota = chave => {
    const fora = foraDe(chave);
    return fora ? `${fora} do lote não recebe esta mudança e fica como está.` : '';
  };

  openSheet(`
    <div class="sheet-title">Editar ${alvos.length} lançamento${alvos.length === 1 ? '' : 's'}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:-4px 0 14px">Ligue só o que quer mudar. O que ficar desligado permanece como está em cada lançamento.</p>

    ${campo('type', 'Tipo', `
      ${chipGroup('ma-tipo', [
        { value: 'Despesa', label: 'Despesa' },
        { value: 'Receita', label: 'Receita' },
        { value: 'Transferência', label: 'Transferência' },
      ], 'Despesa')}
      <div class="field" id="ma-destino-campo" hidden style="margin-top:8px"><label>Conta de destino</label>
        <select id="ma-destino">${DB.all('accounts').filter(a => a.active !== false)
          .map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      </div>`,
      'Virar transferência solta a categoria e passa a mexer em duas contas; virar despesa ou receita solta a conta de destino.')}
    ${campo('category_id', 'Categoria',
      `<select id="ma-cat">${optionsCategorias('')}</select>`, nota('category_id'))}
    ${campo('tags', 'Etiquetas', `
      ${chipGroup('ma-tagmodo', [
        { value: 'adicionar', label: 'Adicionar' },
        { value: 'remover', label: 'Remover' },
        { value: 'substituir', label: 'Substituir' },
      ], 'adicionar')}
      <input id="ma-tags" type="text" placeholder="viagem, presente" autocomplete="off" list="tag-hist-massa" style="margin-top:8px">
      <datalist id="tag-hist-massa">${tags.map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>`,
      'Separe por vírgula. “Adicionar” mantém as que já existem.')}
    ${campo('status', 'Situação',
      `<select id="ma-status"><option value="Pago">Pago</option><option value="A Pagar">A Pagar</option></select>`,
      `Mexe no saldo das contas. ${nota('status')}`)}
    ${campo('scope', 'Âmbito',
      `<select id="ma-scope"><option value="Família">Família</option><option value="Pessoal">Pessoal</option></select>`)}
    ${campo('member', 'De quem',
      `<select id="ma-membro">${membros.map(m => `<option value="${esc(m)}">${m === MEMBRO_COMUM ? 'Comum / Família' : esc(m)}</option>`).join('')}</select>`)}
    ${campo('method', 'Forma de pagamento',
      `<select id="ma-metodo">${metodos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}</select>`)}
    ${campo('account_id', 'Conta',
      `<select id="ma-conta">${contas.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>`,
      `Move dinheiro entre os saldos das duas contas. ${nota('account_id')}`)}
    ${campo('recurring', 'Custo fixo',
      `<select id="ma-rec"><option value="1">Sim</option><option value="">Não</option></select>`)}
    ${campo('notes', 'Observações', `
      ${chipGroup('ma-notamodo', [
        { value: 'substituir', label: 'Substituir' },
        { value: 'acrescentar', label: 'Acrescentar' },
      ], 'substituir')}
      <textarea id="ma-notas" rows="2" style="margin-top:8px"></textarea>`)}

    <button class="btn" id="sh-save">Revisar mudanças</button>
  `);
  $('#sh-close').onclick = closeSheet;
  bindChips('ma-tagmodo'); bindChips('ma-notamodo');
  // O destino só existe para transferência: pedir conta de destino de uma
  // despesa seria uma pergunta sem resposta possível
  bindChips('ma-tipo', v => {
    const campoDestino = $('#ma-destino-campo');
    if (campoDestino) campoDestino.hidden = v !== 'Transferência';
  });
  document.querySelectorAll('[data-liga]').forEach(cb => cb.onchange = () => {
    const ctrl = document.querySelector(`[data-ctrl="${cb.dataset.liga}"]`);
    if (ctrl) ctrl.hidden = !cb.checked;
  });
  $('#sh-save').onclick = () => {
    const ligado = c => { const el = document.querySelector(`[data-liga="${c}"]`); return !!(el && el.checked); };
    const campos = {};
    if (ligado('type')) {
      campos.type = chipValue('ma-tipo') || 'Despesa';
      if (campos.type === 'Transferência') campos.to_account = $('#ma-destino').value || null;
    }
    if (ligado('category_id')) campos.category_id = $('#ma-cat').value || null;
    if (ligado('status')) campos.status = $('#ma-status').value;
    if (ligado('scope')) campos.scope = $('#ma-scope').value;
    if (ligado('member')) campos.member = $('#ma-membro').value;
    if (ligado('method')) campos.method = $('#ma-metodo').value;
    if (ligado('account_id')) campos.account_id = $('#ma-conta').value;
    if (ligado('recurring')) campos.recurring = !!$('#ma-rec').value;
    const extras = {};
    if (ligado('tags')) {
      extras.tags = {
        modo: chipValue('ma-tagmodo') || 'adicionar',
        valores: $('#ma-tags').value.split(',').map(s => DB.normTag(s)).filter(Boolean),
      };
    }
    if (ligado('notes')) {
      extras.notes = { modo: chipValue('ma-notamodo') || 'substituir', texto: $('#ma-notas').value.trim() };
    }
    if (!Object.keys(campos).length && !Object.keys(extras).length) {
      return toast('Ligue ao menos um campo para mudar');
    }
    confirmarMassa(campos, extras);
  };
}

/* Confirmação que DIZ O NÚMERO. "Vai alterar 32 lançamentos" é a diferença entre
   uma ação em massa e uma surpresa em massa — ainda mais porque a sincronização
   propaga na hora para os outros aparelhos da família. */
function confirmarMassa(campos, extras) {
  const alvos = massaAlvos();
  const linhas = [];
  // Conta sobre o registro DEPOIS da troca de tipo, para o número bater com o
  // que a aplicação realmente vai fazer
  const depois = t => (campos.type && campos.type !== t.type ? trocarTipo(t, campos.type, campos.to_account) : t);
  const conta = chave => alvos.filter(t => massaAceita(chave, depois(t))).length;
  if ('type' in campos) {
    const mudam = alvos.filter(t => t.type !== campos.type).length;
    linhas.push([`Tipo vira <b>${esc(campos.type)}</b>${
      campos.type === 'Transferência'
        ? ` para <b>${esc((DB.get('accounts', campos.to_account) || {}).name || '?')}</b>`
        : ' — solta a conta de destino'}`, mudam]);
  }
  if ('category_id' in campos) linhas.push([`Categoria vira <b>${esc(DB.categoryPath(campos.category_id) || 'sem categoria')}</b>`, conta('category_id')]);
  if (extras.tags) {
    const rot = { adicionar: 'Acrescenta', remover: 'Remove', substituir: 'Passa a ter só' }[extras.tags.modo];
    linhas.push([`${rot} <b>${extras.tags.valores.map(v => '#' + esc(v)).join(', ') || '(nenhuma)'}</b>`, alvos.length]);
  }
  if ('status' in campos) linhas.push([`Situação vira <b>${esc(campos.status)}</b> — mexe no saldo`, conta('status')]);
  if ('scope' in campos) linhas.push([`Âmbito vira <b>${esc(campos.scope)}</b>`, alvos.length]);
  if ('member' in campos) linhas.push([`Passa a ser de <b>${esc(campos.member)}</b>`, alvos.length]);
  if ('method' in campos) linhas.push([`Forma de pagamento vira <b>${esc(campos.method)}</b>`, alvos.length]);
  if ('account_id' in campos) linhas.push([`Conta vira <b>${esc((DB.get('accounts', campos.account_id) || {}).name || '?')}</b> — move os saldos`, conta('account_id')]);
  if ('recurring' in campos) linhas.push([`Custo fixo: <b>${campos.recurring ? 'sim' : 'não'}</b>`, alvos.length]);
  if (extras.notes) linhas.push([`Observações ${extras.notes.modo === 'substituir' ? 'viram' : 'ganham'} o texto informado`, alvos.length]);

  openSheet(`
    <div class="sheet-title">Confirmar<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:10px">Sobre ${alvos.length} lançamento${alvos.length === 1 ? '' : 's'} selecionado${alvos.length === 1 ? '' : 's'}:</p>
    ${linhas.map(([txt, n]) => `<div class="proj-row"><span>${txt}</span><b>${n}</b></div>`).join('')}
    <p class="muted" style="margin-top:10px">Dá para desfazer logo depois, enquanto o aviso estiver na tela.</p>
    <button class="btn" id="sh-save">Aplicar</button>
    <div class="btn-row"><button class="btn ghost" id="ma-cancelar">Cancelar</button></div>
  `);
  $('#sh-close').onclick = closeSheet;
  $('#ma-cancelar').onclick = closeSheet;
  $('#sh-save').onclick = () => aplicarMassa(campos, extras);
}

function aplicarMassa(campos, extras) {
  const alvos = massaAlvos();
  const antes = alvos.map(t => ({ ...t }));      // fotografia para o desfazer
  const deltas = {};
  const somar = (obj, sinal) => {
    for (const [id, v] of Object.entries(obj)) deltas[id] = (deltas[id] || 0) + v * sinal;
  };

  let mexidos = 0;
  DB.emLote(() => {
    for (const t of alvos) {
      // Tipo primeiro: ele redefine to_account, método e categoria, e o que vier
      // pedido em seguida vence — mesma regra da edição linha a linha
      const base = campos.type && campos.type !== t.type
        ? trocarTipo(t, campos.type, campos.to_account)
        : t;
      const novo = { ...base };
      let mudou = base !== t;
      for (const [chave, valor] of Object.entries(campos)) {
        if (chave === 'to_account') continue;                 // já tratado por trocarTipo
        /* Testa o registro DEPOIS da troca de tipo, não antes: converter uma
           transferência em despesa e dar categoria na mesma ação é justamente
           o conserto que se quer, e olhar o original recusaria a categoria. */
        if (!massaAceita(chave, base)) continue;
        novo[chave] = valor;
        mudou = true;
      }
      if (extras.tags) { novo.tags = aplicarTags(DB.tagsOf(t), extras.tags.modo, extras.tags.valores); mudou = true; }
      if (extras.notes) {
        novo.notes = extras.notes.modo === 'substituir'
          ? extras.notes.texto
          : [t.notes, extras.notes.texto].filter(Boolean).join(' — ');
        mudou = true;
      }
      if (!mudou) continue;
      somar(efeitoNasContas(t), -1);
      somar(efeitoNasContas(novo), +1);
      DB.upsert('transactions', novo);
      mexidos++;
    }
    // Uma escrita por conta, depois de tudo somado
    for (const [id, d] of Object.entries(deltas)) if (Math.abs(d) > 0.004) adjustBalance(id, d);
  });

  Massa.desfazer = { antes, deltas };
  closeSheet();
  renderMassa();
  Sync.autoSync();                                // uma vez para o lote inteiro
  toastAcao(`${mexidos} lançamento(s) alterado(s) ✓`, 'Desfazer', desfazerMassa);
}

function excluirMassa() {
  const alvos = massaAlvos();
  if (!alvos.length) return;
  if (!confirm(`Excluir ${alvos.length} lançamento(s)?\n\nO saldo das contas é devolvido. Dá para desfazer logo depois.`)) return;
  const antes = alvos.map(t => ({ ...t }));
  const deltas = {};
  DB.emLote(() => {
    for (const t of alvos) {
      for (const [id, v] of Object.entries(efeitoNasContas(t))) deltas[id] = (deltas[id] || 0) - v;
      DB.remove('transactions', t.id);
    }
    for (const [id, d] of Object.entries(deltas)) if (Math.abs(d) > 0.004) adjustBalance(id, d);
  });

  Massa.desfazer = { antes, deltas };
  Massa.ids = Massa.ids.filter(id => !Massa.marcados.has(id));
  Massa.marcados = new Set();
  renderMassa();
  Sync.autoSync();
  toastAcao(`${alvos.length} lançamento(s) excluído(s)`, 'Desfazer', desfazerMassa);
}

/* Desfazer vive em memória e não sobrevive a recarregar a página — limite real,
   e dito no aviso. O que ele cobre é o engano percebido no segundo seguinte, que
   é quando quase todo engano de lote é percebido. */
function desfazerMassa() {
  const d = Massa.desfazer;
  if (!d) return toast('Não há o que desfazer');
  DB.emLote(() => {
    for (const t of d.antes) DB.upsert('transactions', t);
    for (const [id, v] of Object.entries(d.deltas)) if (Math.abs(v) > 0.004) adjustBalance(id, -v);
  });
  Massa.desfazer = null;
  Massa.ids = d.antes.map(t => t.id);
  Massa.marcados = new Set(Massa.ids);
  renderMassa();
  Sync.autoSync();
  toast('Desfeito ✓');
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
            description: `${descricao} (${i + 1}/${parcelas})`,
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
    toast(isEdit ? 'Meta atualizada ✓' : 'Meta criada ✓');
  };
  const del = $('#sh-del');
  if (del) del.onclick = () => {
    const aportes = DB.all('goal_entries').filter(e => e.goal_id === goal.id);
    const guardado = aportes.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    // Dizer o que se perde: o histórico some, mas o dinheiro segue nas contas
    const aviso = aportes.length
      ? `Excluir "${goal.name}" e os ${aportes.length} aporte(s) dela?\n\n` +
        `O histórico de ${fmt(guardado)} guardado some. O dinheiro continua nas contas — só deixa de contar para esta meta.`
      : `Excluir "${goal.name}"?`;
    if (!confirm(aviso)) return;
    aportes.forEach(e => DB.remove('goal_entries', e.id));
    DB.remove('goals', goal.id);
    closeSheet(); render(); Sync.autoSync();
    toast('Meta excluída ✓');
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
          Sync.autoSync(); toast(isEdit ? 'Conta atualizada ✓' : 'Conta criada ✓'); openConfigSection('accounts');
        };
        const del = $('#md-del');
        // Excluir sem dizer o que acontece é o pior tipo de confirmação: a pessoa
        // aceita sem saber que o saldo sai do "Disponível" e os lançamentos ficam soltos.
        if (del) del.onclick = () => {
          const presos = DB.all('transactions').filter(t => t.account_id === acc.id || t.to_account === acc.id).length;
          const cartoes = DB.all('cards').filter(c => c.account_id === acc.id).length;
          const aviso = [`Excluir "${acc.name}"?`];
          if (acc.balance) aviso.push(`O saldo de ${fmt(acc.balance)} sai do total disponível.`);
          if (presos) aviso.push(`${presos} lançamento(s) ficam sem conta — o histórico permanece, mas deixa de somar aqui.`);
          if (cartoes) aviso.push(`${cartoes} cartão(ões) perdem a conta de pagamento.`);
          if (confirm(aviso.join('\n\n'))) {
            DB.remove('accounts', acc.id); Sync.autoSync();
            toast('Conta excluída ✓'); openConfigSection('accounts');
          }
        };
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
          Sync.autoSync(); toast(isEdit ? 'Cartão atualizado ✓' : 'Cartão criado ✓'); openConfigSection('cards');
        };
        const del = $('#md-del');
        if (del) del.onclick = () => {
          const compras = DB.all('transactions').filter(t => t.card_id === card.id);
          const abertas = DB.invoicesOf(card).filter(i => i.status !== 'Paga');
          const aviso = [`Excluir "${card.name}"?`];
          if (abertas.length) {
            const soma = abertas.reduce((s, i) => s + i.total, 0);
            aviso.push(`${abertas.length} fatura(s) em aberto, somando ${fmt(soma)}, somem do painel — mas a dívida com o banco continua.`);
          }
          if (compras.length) aviso.push(`${compras.length} compra(s) ficam sem cartão no extrato.`);
          if (confirm(aviso.join('\n\n'))) {
            DB.remove('cards', card.id); Sync.autoSync();
            toast('Cartão excluído ✓'); openConfigSection('cards');
          }
        };
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
/* Só folhas entram: oferecer o envelope como opção faria o gasto parar no nível
   de cima e a subcategoria nunca acontecer. O filtro é outro caso — lá "tudo de
   Alimentação" é pergunta legítima — e por isso ele monta a própria lista, em
   opcoesCategoriaPilula. */
function optionsCategorias(selecionado, tipo) {
  const marcados = Array.isArray(selecionado) ? selecionado : [selecionado];
  const opcao = (c, rotulo) =>
    `<option value="${c.id}"${marcados.includes(c.id) ? ' selected' : ''}>${esc(rotulo)}</option>`;
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
  /* Antes de enviar qualquer coisa: se a família JÁ tem categorias, as que este
     aparelho criou sozinho ao abrir pela primeira vez são duplicatas esperando
     para nascer. Enviá-las é o que fez uma base chegar a 312 categorias.
     A pergunta vai ao servidor porque só ele sabe o que a família já tem. */
  try {
    if (await Sync.familiaTemCategorias()) {
      const n = DB.descartarCategoriasNaoUsadas();
      if (n) toast(`${n} categorias locais substituídas pelas da família`, 'info');
    }
  } catch (_) { /* sem resposta do servidor: segue o fluxo normal */ }
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
          <button class="env-add" data-nova-sub="${r.id}" title="Nova ${st.lado === 'Receita' ? 'origem' : 'subcategoria'} em ${esc(r.name)}" aria-label="Nova ${st.lado === 'Receita' ? 'origem' : 'subcategoria'} em ${esc(r.name)}"><span data-ico="plus"></span></button>
          <button class="env-editar" data-edit="${r.id}" title="Editar ${esc(r.name)}" aria-label="Editar ${esc(r.name)}"><span data-ico="settings"></span></button>
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
    // Editar e "+" vivem dentro do cabeçalho, mas têm ação própria
    if (e.target.closest('[data-edit], [data-nova-sub]')) return;
    reabrir({ aberto: st.aberto === el.dataset.abrir ? null : el.dataset.abrir });
  });
  document.querySelectorAll('[data-edit]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    openCategoryEditor(DB.get('categories', el.dataset.edit), null, null, st);
  });
  // Criar a partir do cabeçalho volta com o envelope aberto, para a nova aparecer
  document.querySelectorAll('[data-nova-sub]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    openCategoryEditor(null, el.dataset.novaSub, null, { ...st, aberto: el.dataset.novaSub });
  });
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
    // Duas categorias de mesmo nome no mesmo nível dividem o gasto em dois
    // lugares, e nenhum dos dois mostra o total. Barra antes de gravar.
    const igual = DB.acharCategoria(nome, pai, tipo);
    if (igual && igual.id !== cat.id) {
      return toast(`Já existe "${igual.name}"${pai ? ' aqui dentro' : ''} — use outro nome`, 'err');
    }
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
    Sync.autoSync(); toast(isEdit ? 'Categoria atualizada ✓' : 'Categoria criada ✓'); voltar();
  };

  const del = $('#md-del');
  if (del) del.onclick = () => {
    const filhas = DB.subcategoriesOf(cat.id).length;
    const aviso = filhas
      ? `Excluir "${cat.name}" e suas ${filhas} subcategoria(s)? Os lançamentos antigos ficam sem categoria.`
      : 'Excluir categoria? Os lançamentos antigos ficam sem categoria.';
    if (confirm(aviso)) { DB.remove('categories', cat.id); Sync.autoSync(); toast('Categoria excluída ✓'); voltar(); }
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
  on('#s-now', async () => {
    const b = $('#s-now');
    if (b) { b.disabled = true; b.textContent = 'Sincronizando…'; }   // impede o toque repetido
    await sincronizarAgora();
    const depois = $('#s-now');                                       // a tela pode ter sido redesenhada
    if (depois) { depois.disabled = false; depois.textContent = 'Sincronizar agora'; }
  });
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
    <div id="ofx-estado"></div>
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

      /* Só decide o que é novo DEPOIS de ter tudo o que a família já lançou.
         Sem isto, importar logo após "apagar dados deste aparelho" (quando o app
         ainda está se enchendo pela sincronização) faz todo lançamento parecer
         novo — e a base duplica sem ninguém perceber. */
      const estado = $('#ofx-estado');
      if (Sync.hasFamily() && !Sync.pronto) {
        estado.innerHTML = '<div class="callout info"><b>Conferindo com a nuvem…</b><p>Buscando o que a família já lançou, para não importar nada em duplicidade.</p></div>';
      }
      const situacao = await Sync.aguardarPronto();
      estado.innerHTML = situacao === 'sem-resposta'
        ? `<div class="callout warn"><b>Não consegui confirmar com a nuvem</b>
             <p>O que já foi lançado em outro aparelho pode não estar aqui ainda, e lançamentos repetidos podem passar.
             Se puder, feche isto, toque em ⇅ para sincronizar e tente de novo.</p></div>`
        : '';

      renderOfxPreview(parsed, accounts, cards, situacao);
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

/* Contas e cartões oferecidos como destino/origem de transferência, no topo do
   mesmo seletor da categoria. Transferência não É categoria — mas a pergunta que
   a pessoa responde ali é a mesma ("o que foi isso?"), e um segundo controle na
   linha custaria mais do que resolve. O prefixo separa os dois mundos no valor. */
function contasTransferencia(contaAtual, ehSaida) {
  const outras = [
    ...DB.all('accounts').filter(a => a.active !== false && a.id !== contaAtual),
    ...DB.all('cards').filter(c => c.active !== false),   // pagar fatura também é transferência
  ];
  if (!outras.length) return '';
  return `<optgroup label="⇄ Transferência — não é gasto nem receita">${outras.map(o =>
    `<option value="transfer:${o.id}">${ehSaida ? 'Enviado para' : 'Recebido de'} ${esc(o.name)}</option>`).join('')}</optgroup>`;
}

function renderOfxPreview(parsed, accounts, cards, situacao) {
  const cats = DB.all('categories');   // com os pais: a adivinhação depende deles
  let parEncontrado = {};              // linha -> transferência que já cobre este valor
  let novos = parsed.txs, dups = 0;
  /* Só o PRIMEIRO de cada grupo vem marcado. Marcando todos, o navegador fica com
     o ÚLTIMO — enquanto o código assumia o primeiro. As duas pontas discordavam, e
     a lista de destinos de transferência era montada excluindo a conta errada:
     a conta que estava sendo importada aparecia como destino dela mesma, e dava
     para criar transferência de uma conta para ela própria (que não move nada). */
  const destOpts = `
    ${cards.length ? `<optgroup label="Cartões de crédito">${cards.map((c, i) => `<option value="card:${c.id}" ${parsed.isCard && i === 0 ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
    ${accounts.length ? `<optgroup label="Contas">${accounts.map((a, i) => `<option value="acc:${a.id}" ${!parsed.isCard && i === 0 ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}`;

  /* A conta que está sendo importada só é conhecida depois que a pessoa escolhe
     em "Lançar em" — e é ela que define quais linhas já foram lançadas como a
     outra perna de uma transferência. Por isso as linhas são redesenhadas quando
     o destino muda (ver #ofx-dest mais abaixo). */
  const destinoAtual = () => {
    const v = ($('#ofx-dest') || {}).value || (parsed.isCard && cards[0] ? 'card:' + cards[0].id : (accounts[0] ? 'acc:' + accounts[0].id : ''));
    const [kind, id] = String(v).split(':');
    return { kind, id };
  };

  const linhasHtml = () => {
    const { kind, id: contaAtual } = destinoAtual();
    const usados = new Set();
    // Guardado para a importação: linha que casou não pode virar lançamento novo
    parEncontrado = {};

    /* O que já foi importado depende de EM QUAL CONTA se está lançando: o mesmo
       FITID em contas diferentes é lançamento diferente. Por isso o descarte é
       refeito a cada troca de "Lançar em", e não uma vez só ao abrir. */
    novos = parsed.txs.filter(t => !DB.jaImportado(t, kind === 'acc' ? contaAtual : null, kind === 'card' ? contaAtual : null));
    dups = parsed.txs.length - novos.length;

    return novos.map((t, i) => {
      const isExp = t.amount < 0;
      // Só conta corrente tem transferência; fatura de cartão não é conta bancária
      const par = kind === 'acc'
        ? DB.acharPernaDeTransferencia(contaAtual, t.date, t.amount, !isExp, usados)
        : null;
      // Só o mesmo dia autoriza desmarcar sozinho; na dúvida, quem decide é quem importa
      const certeza = !!(par && par._certeza);
      if (par && certeza) { usados.add(par.id); parEncontrado[i] = par; }

      const guess = OFX.guessCategoryId(t.memo, cats, isExp ? 'Despesa' : 'Receita');
      const outraConta = par
        ? DB.get('accounts', !isExp ? par.account_id : par.to_account)
        : null;

      // Ordem no HTML igual à ordem de leitura: marcar, ler a descrição, ver o valor,
      // e só então escolher a categoria — que fica na linha de baixo, com espaço.
      const nomeOutra = outraConta ? ` ${isExp ? 'para' : 'de'} ${esc(outraConta.name)}` : '';
      /* O seletor existe em TODA linha, inclusive nas que o app desmarcou. Quem
         discorda do palpite e marca a linha precisa poder classificá-la — e a
         marcação é a palavra final: o que estiver marcado é importado, e nada
         mais decide por fora. */
      const aviso = certeza
        ? `<span class="ofx-aviso">⇄ Já lançado como transferência${nomeOutra}, no mesmo dia. Marque só se for outra movimentação.</span>`
        : par
          ? `<span class="ofx-aviso duvida">⚠ Parecido com uma transferência${nomeOutra} de ${fmtDay(par.date)}. Se for a mesma, desmarque.</span>`
          : '';
      return `<div class="ofx-row ${certeza ? 'ofx-par' : ''}${par && !certeza ? ' ofx-duvida' : ''}">
      <input type="checkbox" data-i="${i}" ${certeza ? '' : 'checked'}>
      <span class="ofx-main"><b>${esc(t.memo)}</b><small>${fmtDay(t.date)} · ${isExp ? 'saída' : 'entrada'}</small></span>
      <span class="ofx-val ${isExp ? '' : 'txt-green'}">${isExp ? '' : '+'}${fmtShort(Math.abs(t.amount))}</span>
      <span class="ofx-cat">${aviso}
      <select data-cat="${i}" ${certeza ? 'hidden' : ''}>
        <option value="">${isExp ? 'Sem categoria' : 'Sem origem'}</option>
        ${contasTransferencia(contaAtual, isExp)}
        ${optionsCategorias(guess, isExp ? 'Despesa' : 'Receita')}
      </select></span>
      <button type="button" class="ofx-tag-btn" data-tagbtn="${i}" title="Etiquetas deste lançamento"><span data-ico="tag"></span><span class="ofx-tag-txt"></span></button>
    </div>`;
    }).join('');
  };

  const rows = linhasHtml();

  $('#ofx-result').innerHTML = `
    <hr class="sep">
    <div class="mini-stats" style="margin-bottom:12px">
      <div class="card"><small>Novos</small><b>${novos.length}</b></div>
      <div class="card"><small>Repetidos</small><b>${dups}</b></div>
      <div class="card"><small>Do arquivo</small><b>${parsed.txs.length}</b></div>
    </div>
    <!-- O aviso fica junto do número de "novos", que é a conclusão em que não se
         pode confiar quando a leitura da nuvem falhou. -->
    ${situacao === 'sem-resposta' ? `<div class="callout warn">
      <b>Estes números podem estar errados</b>
      <p>Não consegui ler o que a família já lançou, então "${novos.length} novos" pode incluir coisas que já existem em outro aparelho.
      Sincronize (⇅) e reabra esta tela antes de importar.</p></div>` : ''}
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
      <div class="ofx-list" id="ofx-lista">${rows}</div>
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

  const ligarLinhas = () => {
    /* Marcar uma linha que o app tinha desmarcado revela o seletor: sem isso ela
       entraria sem categoria, e o aviso continuaria dizendo que é duplicata. */
    document.querySelectorAll('#ofx-result [data-i]').forEach(cx => cx.onchange = () => {
      const linha = cx.closest ? cx.closest('.ofx-row') : null;
      if (!linha) return;
      const sel = linha.querySelector('[data-cat]');
      const cx2 = linha.querySelector('.ofx-aviso');
      if (sel) {
        const box = sel.closest ? sel.closest('.ui-select') : null;
        if (cx.checked) { sel.hidden = false; if (box) box.hidden = false; }
        else if (parEncontrado[Number(cx.dataset.i)]) { sel.hidden = true; if (box) box.hidden = true; }
      }
      if (cx2) cx2.hidden = cx.checked && !!parEncontrado[Number(cx.dataset.i)] ? false : cx2.hidden;
      linha.classList.toggle('ofx-par', !cx.checked && !!parEncontrado[Number(cx.dataset.i)]);
    });
    document.querySelectorAll('#ofx-result [data-tagbtn]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.tagbtn);
      openTagsLinhaSheet(novos[i], tagsDe(i), tagsLinha[i] === null, escolhidas => {
        tagsLinha[i] = escolhidas;      // null volta a seguir o lote
        pintarBotoes();
      });
    });
    pintarBotoes();
  };
  ligarLinhas();

  /* Trocar a conta de destino refaz o pareamento: uma linha que já estava lançada
     como transferência para a conta A não está lançada para a conta B. Sem
     redesenhar, o aviso ficaria falando da conta anterior. */
  const dest = $('#ofx-dest');
  if (dest) dest.onchange = () => {
    const lista = $('#ofx-lista');
    if (!lista) return;
    lista.innerHTML = linhasHtml();
    paintIcons(lista);
    if (typeof UI !== 'undefined') UI.enhance(lista);
    ligarLinhas();
  };

  const boxes = () => document.querySelectorAll('#ofx-result [data-i]');
  $('#ofx-all').onclick = () => boxes().forEach(b => { b.checked = true; });
  $('#ofx-none').onclick = () => boxes().forEach(b => { b.checked = false; });

  $('#ofx-go').onclick = () => {
    const [kind, id] = $('#ofx-dest').value.split(':');
    const card = kind === 'card' ? DB.get('cards', id) : null;
    const account = kind === 'acc' ? DB.get('accounts', id) : null;
    if (!card && !account) return toast('Escolha onde lançar');

    let n = 0, transferidos = 0, descartadas = 0;
    boxes().forEach(box => {
      /* A marcação é a palavra final. O app desmarca o que julga já lançado, mas
         se quem importa discorda e marca, a linha entra — antes ela era pulada
         mesmo marcada, e a caixa de seleção não queria dizer nada. */
      if (!box.checked) return;
      const idx = Number(box.dataset.i);
      const t = novos[idx];
      const isExp = t.amount < 0;
      const catSel = document.querySelector(`#ofx-result [data-cat="${idx}"]`);
      const escolha = (catSel && catSel.value) || '';
      const tags = tagsDe(idx);

      /* Transferência: um lançamento só, tocando as duas contas. Lançar dois
         (saída aqui, entrada lá) faria a mesma movimentação aparecer duas vezes
         no extrato e contar como gasto E como receita nos relatórios. */
      if (escolha.startsWith('transfer:')) {
        const outroId = escolha.slice('transfer:'.length);
        const daqui = account ? account.id : (card ? card.id : null);
        /* Rede de segurança: transferência de uma conta para ela mesma não move
           dinheiro nenhum (sai e volta), então some do saldo sem deixar rastro.
           A lista já exclui a conta atual, mas errar aqui custa caro demais
           para depender de um único ponto. */
        if (!outroId || outroId === daqui) {
          descartadas++;
          return;
        }
        const transf = {
          description: t.memo,
          amount: Math.abs(t.amount),
          date: t.date,
          type: 'Transferência', status: 'Pago', method: 'Transferência',
          scope: 'Família', member: MEMBRO_COMUM,
          // Quem sai é sempre account_id: numa saída é esta conta, numa entrada é a outra
          account_id: isExp ? daqui : outroId,
          to_account: isExp ? outroId : daqui,
          category_id: null, card_id: null, invoice_key: '',
          recurring: false, adjustment: false,
          fitid: t.fitid, tags,
        };
        DB.upsert('transactions', transf);
        applyTxEffect(transf, +1);            // move os dois saldos de uma vez
        n++; transferidos++;
        return;
      }

      DB.upsert('transactions', {
        description: t.memo,
        amount: Math.abs(t.amount),
        date: t.date,
        type: isExp ? 'Despesa' : 'Receita',
        status: 'Pago',
        scope: 'Família',
        member: MEMBRO_COMUM,                 // extrato conjunto entra como gasto comum
        method: OFX.guessMethod(t.memo, !!card),
        category_id: escolha || null,
        fitid: t.fitid,
        card_id: card ? card.id : null,
        account_id: account ? account.id : null,
        invoice_key: card ? DB.invoiceKeyFor(card, t.date) : '',
        recurring: false,
        tags,
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
    // Conta o que ficou de fora POR ESTAR DESMARCADO, não o que o app palpitou:
    // com a marcação valendo, o palpite pode ter sido revertido por quem importa
    const pulados = [...boxes()].filter(b => !b.checked).length;
    const partes = [`${n} lançamento(s) importado(s)`];
    if (transferidos) partes.push(`${transferidos} como transferência`);
    if (descartadas) partes.push(`${descartadas} sem destino válido, ignorada(s)`);
    if (pulados) partes.push(`${pulados} já estavam lançados`);
    toast(partes.join(' · ') + ' ✓');
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
/* Sincronizar a pedido do usuário: sempre responde algo. Antes o erro era
   engolido (.catch vazio) e o sucesso não dizia nada — em rede lenta a pessoa
   tocava várias vezes sem saber se tinha acontecido. */
async function sincronizarAgora() {
  if (!Sync.hasFamily()) return openConfigSection('sync');
  try {
    const r = await Sync.syncAll();
    render();
    if (!r) return;                       // já havia uma sincronização em andamento
    const partes = [];
    if (r.enviados) partes.push(`${r.enviados} enviado(s)`);
    if (r.recebidos) partes.push(`${r.recebidos} recebido(s)`);
    toast(partes.length ? `Sincronizado — ${partes.join(', ')} ✓` : 'Tudo já estava em dia ✓');
  } catch (e) {
    toast(e.message || 'Falha ao sincronizar', 'err');
  }
}
$('#btn-sync').onclick = sincronizarAgora;
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
