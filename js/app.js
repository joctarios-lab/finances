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
/* O QUE ZERA AO TROCAR DE TELA — e o que ACOMPANHA.

   O mês ACOMPANHA. Antes ele voltava para o corrente a cada troca de aba, e o
   motivo era real: um mês antigo esquecido faz ler o saldo errado. Só que isso
   quebrava o uso normal — abrir julho no Painel, ir ao Extrato para conferir de
   onde veio um número e encontrar agosto de novo, tendo que navegar de volta.

   O que tornou seguro manter foi o cartão de mês preso abaixo do header: ele
   anuncia o ciclo o tempo todo, em toda tela que tem mês. O risco que a regra
   antiga cobria passou a ser coberto pela própria interface.

   Os FILTROS continuam zerando, e por um motivo que o cartão não resolve: um
   filtro esquecido deixa a lista curta sem dizer por quê, e nada na tela de
   destino anuncia que ele existe. */
const ESTADO_DA_TELA = { repOffset: 0 };
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
  /* ABRIR O APP É OUTRA COISA QUE TROCAR DE TELA.

     O mês atravessa as telas dentro de uma sessão — quem foi para julho está
     olhando julho, e o cartão preso diz isso o tempo todo. Mas ao ABRIR o app
     ele volta ao corrente, sempre: um mês herdado da sessão de ontem seria lido
     como "hoje" por alguém que acabou de destravar a tela, e é justamente aí
     que o número errado passa despercebido. */
  state.monthOffset = 0;
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

/* ---------- MARCAR O DINHEIRO ----------

   O modo privado precisa esconder VALOR, e valor não tem elemento próprio: ele
   aparece solto no meio de frases ("faltam R$ 200 para a meta"), dentro de
   rótulos, em células de tabela e como texto de gráfico. A primeira versão disto
   era uma lista de classes no CSS, e ela errava dos dois lados — borrava a caixa
   inteira junto com o rótulo, e mesmo com quarenta seletores continuava deixando
   cifras de fora, porque toda tela nova traz um lugar novo.

   Aqui a marcação passa a ser feita no texto já renderizado: uma varredura pelos
   nós de texto embrulha cada cifra num `<span class="v">`. O que o CSS esconde
   passa a ser exatamente o número — nunca o rótulo ao lado dele — e a cobertura
   deixa de depender de alguém lembrar de atualizar uma lista.

   Roda SEMPRE, não só no modo privado: assim ligar e desligar o olho é só uma
   classe no <html>, sem redesenhar a tela. Uma passada custa uma varredura de
   alguns milhares de nós — abaixo do que o próprio innerHTML acabou de gastar. */
const RE_DINHEIRO = /-?R\$[\s ]?-?\d[\d.]*(?:,\d{2})?/;
const RE_DINHEIRO_G = new RegExp(RE_DINHEIRO.source, 'g');
const SVG_NS = 'http://www.w3.org/2000/svg';

function marcarValores(root) {
  const alvo = root || $('#view');
  if (!alvo || typeof document.createTreeWalker !== 'function') return;
  const it = document.createTreeWalker(alvo, NodeFilter.SHOW_TEXT, {
    acceptNode(no) {
      const pai = no.parentNode;
      if (!pai) return NodeFilter.FILTER_REJECT;
      // Já marcado, ou texto que não é para ser tocado
      if (pai.nodeName === 'SCRIPT' || pai.nodeName === 'STYLE' || pai.nodeName === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
      if (pai.classList && pai.classList.contains('v')) return NodeFilter.FILTER_REJECT;
      return RE_DINHEIRO.test(no.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  /* Coleta antes de mexer: trocar um nó durante a caminhada invalida o iterador
     e a varredura para no primeiro valor encontrado. */
  const nos = [];
  while (it.nextNode()) nos.push(it.currentNode);

  for (const no of nos) {
    const pai = no.parentNode;
    if (!pai) continue;
    /* Dentro de um SVG não cabe <span> — ele não tem caixa e não renderiza. O
       elemento <text> inteiro é a cifra ali, então basta marcá-lo. */
    if (pai.namespaceURI === SVG_NS) { pai.classList.add('v'); continue; }

    const txt = no.nodeValue;
    const frag = document.createDocumentFragment();
    let fim = 0, m;
    RE_DINHEIRO_G.lastIndex = 0;
    while ((m = RE_DINHEIRO_G.exec(txt))) {
      if (m.index > fim) frag.appendChild(document.createTextNode(txt.slice(fim, m.index)));
      const span = document.createElement('span');
      span.className = 'v';
      span.textContent = m[0];
      frag.appendChild(span);
      fim = m.index + m[0].length;
    }
    if (fim < txt.length) frag.appendChild(document.createTextNode(txt.slice(fim)));
    pai.replaceChild(frag, no);
  }
}
window.marcarValores = marcarValores;

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
/* "NEUTRO" TEM DOIS SENTIDOS NESTE APP, e eles não coincidem.

   `DB.isNeutral` responde "isto conta como despesa ou receita da família?" —
   conciliação, pagamento de fatura e transferência não contam, porque somá-las
   inflaria o gasto do mês com dinheiro que só mudou de lugar.

   Aqui a pergunta é outra: "isto move o saldo da conta?". E a resposta divide o
   grupo: conciliação e pagamento de fatura MOVEM (é o que eles existem para
   fazer), transferência move duas contas de uma vez, e a semanada não move nada —
   o dinheiro fica no banco e só troca de dono.

   Usar `isNeutral` aqui zeraria a conciliação e o pagamento de fatura, que é o
   oposto do que eles fazem. Por isso a semanada é nomeada, uma a uma. */
function txEffect(t) {
  if (!t || t.status !== 'Pago' || !t.account_id || t.card_id) return 0;
  if (DB.isTransfer(t) || DB.isSemanada(t)) return 0;
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
  // Trocar de tela limpa os filtros e volta ao começo da página — mas MANTÉM o
  // mês, que atravessa as telas com quem está navegando (ver ESTADO_DA_TELA).
  // Só zera em troca real, para não perder o lugar quando a própria tela se
  // redesenha (sincronização, salvar um lançamento).
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
  marcarValores($('#view'));
  if (typeof UI !== 'undefined') UI.enhance($('#view'));
  /* Os gráficos entram DEPOIS do innerHTML: ApexCharts mede o elemento para
     desenhar, e um div fora do DOM não tem largura. limpar() antes derruba as
     instâncias da tela anterior, que morreram com o innerHTML mas continuariam
     vivas na memória escutando resize. */
  if (typeof Graficos !== 'undefined') { Graficos.limpar(); Graficos.montar(); }
  bindView();
  persistUI();
}

/* ---------- Gráficos (ApexCharts) ----------

   As funções abaixo não desenham: montam a configuração e devolvem o <div> onde
   o gráfico vai nascer, via Graficos.novo(). Quem instancia é Graficos.montar(),
   chamado depois de a tela ir para o DOM — ApexCharts precisa medir o elemento.

   O que a biblioteca resolveu e o SVG à mão não resolvia: rótulo de eixo no
   tamanho real do aparelho (o viewBox escalado encolhia texto de 11px para
   ~5px), dica de valor no toque, e curva/arredondamento sem geometria manual.
   O que continua sendo decisão nossa e está codificado aqui: qual forma usa
   qual dado, a paleta, e onde entra referência em vez de mais tinta. */

/* Colunas de evolução no tempo. Série única: sem legenda (o título já diz o que
   é), ênfase no período atual por TOM e referências como linha, não como barra.

   `distributed: true` é o que permite pintar uma coluna diferente das outras.
   Com série única não há agrupamento para quebrar, então é seguro aqui — em
   gráfico de várias séries ele bagunçaria a identidade das cores. */
function svgBars(series, refLine, opts = {}) {
  if (!series.length) return '<div class="empty">Sem dados no período.</div>';
  const valores = series.map(s => Number(s.value) || 0);
  const iAtual = series.findIndex(s => s.hint === '#009ef7');
  const comGasto = valores.filter(v => v > 0);
  const media = comGasto.length ? comGasto.reduce((a, b) => a + b, 0) / comGasto.length : 0;

  // O período atual em azul cheio; os outros no cinza-azulado que recua
  const cores = series.map((s, i) => (i === iAtual ? Graficos.cor.azul : '#e4e6ef'));

  const refs = [];
  if (media > 0) {
    refs.push({
      y: media, borderColor: Graficos.cor.cinza, strokeDashArray: 0, strokeWidth: 1,
      label: {
        text: 'média ' + fmtShort(media).replace('R$', '').trim(),
        position: 'right', textAnchor: 'end', borderWidth: 0,
        style: { color: Graficos.cor.tintaFraca, background: 'transparent', fontSize: Graficos.fonte.ref, fontWeight: 600 },
      },
    });
  }
  if (refLine > 0) {
    refs.push({
      y: refLine, borderColor: Graficos.cor.verde, strokeDashArray: 0, strokeWidth: 2,
      label: {
        text: 'renda ' + fmtShort(refLine).replace('R$', '').trim(),
        position: 'right', textAnchor: 'end', borderWidth: 0,
        style: { color: Graficos.cor.verde, background: 'transparent', fontSize: Graficos.fonte.ref, fontWeight: 600 },
      },
    });
  }

  const iMax = valores.indexOf(Math.max(...valores));

  const alt = opts.height || 250;
  /* Sem eixo de valor. Aqui ele era a ÚNICA fonte do número, então o valor foi
     para cima da coluna antes de o eixo sair — é a substituição correta: rótulo
     direto no lugar da coluna de números, e não a perda da informação. */
  return Graficos.novo(Graficos.semEixoDeValor({
    ...Graficos.base(alt, {
      chart: { type: 'bar' },
      xaxis: { categories: series.map(s => s.label) },
      yaxis: { labels: { formatter: v => fmtShort(v).replace('R$', '').trim() } },
      tooltip: { y: { formatter: v => fmt(v) } },
    }),
    series: [{ name: 'gasto', data: valores }],
    colors: cores,
    plotOptions: {
      bar: {
        distributed: true, columnWidth: '46%',
        // Ponta arredondada, pé reto: o topo é o dado; arredondar a base faria a
        // coluna parecer flutuar acima do zero
        borderRadius: 5, borderRadiusApplication: 'end',
      },
    },
    /* Rótulo SÓ no período atual e no maior valor — nunca em toda coluna. Seis
       números lado a lado viram uma segunda linha de texto e o olho para de ver a
       forma, que é o que o gráfico existe para mostrar. Estes dois são as duas
       perguntas reais: "quanto foi agora" e "qual foi o pior". */
    dataLabels: {
      enabled: true, offsetY: -20,
      formatter: (v, { dataPointIndex }) => (
        (dataPointIndex === iAtual || dataPointIndex === iMax) && v > 0
          ? fmtShort(v).replace('R$', '').trim() : ''),
      style: { fontSize: Graficos.fonte.valor, fontWeight: 700, colors: [Graficos.cor.tinta] },
    },
    annotations: { yaxis: refs },
  }), alt, 'barras');
}

// Arredonda o topo da escala para um número redondo — deixa a grade legível
function niceCeil(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / (exp / 2)) * (exp / 2);
}

/* ---------- Cascata: o caminho do dinheiro ----------
   Cada barra começa onde a anterior parou, então a soma É a forma: dá para VER
   a receita sendo consumida bloco a bloco até o que sobrou. Uma pizza responde
   "qual a maior fatia"; a cascata responde "por que sobrou tão pouco", que é a
   pergunta de quem abre um relatório financeiro.

   ApexCharts não tem cascata nativa. A receita padrão é barra EMPILHADA com uma
   série invisível embaixo servindo de pedestal — é ela que levanta cada bloco
   até onde o anterior parou. As séries visíveis vêm separadas por tipo porque
   cor no ApexCharts é por série, não por ponto: cada uma só tem valor na sua
   própria coluna e null nas outras.

   passos = [{ rot, valor, tipo }] — tipo 'entra' | 'sai' | 'total'. */
function svgCascata(passos, opts = {}) {
  if (!passos.length) return '<div class="empty">Sem dados no período.</div>';

  let acum = 0;
  const barras = passos.map(p => {
    const v = Number(p.valor) || 0;
    if (p.tipo === 'total') return { ...p, pe: 0, valor: acum };
    const pe = acum;
    acum += p.tipo === 'entra' ? v : -v;
    // O bloco de saída pende do topo anterior para baixo: o pé é onde ele acaba
    return { ...p, pe: p.tipo === 'entra' ? pe : acum, valor: v };
  });

  const nulos = barras.map(() => null);
  const serieDe = tipo => barras.map(b => (b.tipo === tipo ? b.valor : null));

  const alt = opts.height || 260;
  /* Sem eixo de valor. Numa cascata o número de CADA bloco é a conta que está
     sendo feita — "entrou 8.500, saiu 5.200, sobrou 1.200" —, então o rótulo vai
     em todos, e não só em alguns como nas colunas de evolução. Com o valor sobre
     cada bloco a coluna de números do eixo só repetiria a mesma informação numa
     escala que ninguém lê dígito por dígito. */
  return Graficos.novo(Graficos.semEixoDeValor({
    ...Graficos.base(alt, {
      chart: { type: 'bar', stacked: true },
      xaxis: { categories: barras.map(b => b.rot) },
      yaxis: { labels: { formatter: v => fmtShort(v).replace('R$', '').trim() } },
      tooltip: {
        shared: false, intersect: true,
        // A série do pedestal não é dado: mostrá-la confundiria o leitor
        y: { formatter: v => (v == null ? '' : fmt(v)) },
      },
    }),
    series: [
      { name: 'pedestal', data: barras.map(b => b.pe) },
      { name: 'entrou', data: serieDe('entra') },
      { name: 'saiu', data: serieDe('sai') },
      { name: 'sobrou', data: serieDe('total') },
    ],
    colors: ['transparent', Graficos.cor.verde, Graficos.cor.vermelho, Graficos.cor.azul],
    fill: { opacity: [0, 1, 1, 1] },
    plotOptions: { bar: { columnWidth: '52%', borderRadius: 4, borderRadiusApplication: 'end' } },
    legend: {
      show: true, position: 'top', horizontalAlign: 'left', fontSize: Graficos.fonte.valor,
      markers: { radius: 6 }, itemMargin: { horizontal: 8 },
      /* Lista explícita, sem o pedestal: ele é andaime, não série. Um formatter
         devolvendo vazio apagaria o texto mas deixaria a bolinha dele lá,
         convidando o leitor a procurar um bloco que não é dinheiro nenhum. */
      customLegendItems: ['entrou', 'saiu', 'sobrou'],
    },
    /* Valor sobre cada bloco. O `null` das séries que não têm valor naquela coluna
       já não desenha rótulo; o cuidado é o PEDESTAL, que tem valor e não é dinheiro
       — mostrá-lo faria o leitor somar um degrau invisível. */
    dataLabels: {
      enabled: true, offsetY: -20,
      formatter: (v, { seriesIndex }) => (
        seriesIndex === 0 || v == null || v <= 0 ? '' : fmtShort(v).replace('R$', '').trim()),
      style: { fontSize: Graficos.fonte.valor, fontWeight: 700, colors: [Graficos.cor.tinta] },
    },
  }), alt, 'cascata');
}

/* Clareia uma cor na direção do branco.

   É como as subcategorias herdam o matiz do próprio envelope — 75 folhas não
   caberiam em matizes distintos, e acima de ~8 matizes eles ficam
   indistinguíveis mesmo para quem vê bem. */
function clarear(hex, fracao) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = Math.max(0, Math.min(1, fracao));
  const mix = c => Math.round(c + (255 - c) * f);
  return '#' + [mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}

/* ---------- Envelope por dentro: composição em dois níveis ----------
   A hierarquia vem no encadeamento das cores: o matiz identifica o envelope, o
   tom identifica a subcategoria dentro dele. Assim a leitura funciona nos dois
   níveis sem inventar 75 cores.

   Barra horizontal empilhada. O detalhe que faz funcionar é `fillColor` em cada
   PONTO: no ApexCharts a cor normalmente é da série, mas as subcategorias são
   diferentes em cada envelope — a subcategoria "slot 2" do envelope Casa não tem
   nada a ver com a "slot 2" de Transporte. Cor por ponto resolve isso.

   grupos = [{ rot, total, partes: [{ rot, valor }] }] */
function svgComposicao(grupos, opts = {}) {
  if (!grupos.length) return '<div class="empty">Sem gastos no período.</div>';

  // Quantos segmentos o envelope mais fragmentado tem: define o nº de séries
  const maxPartes = Math.max(...grupos.map(g => g.partes.length), 1);
  const series = [];
  for (let j = 0; j < maxPartes; j++) {
    series.push({
      name: 'parte ' + (j + 1),
      data: grupos.map((g, i) => {
        const p = g.partes[j];
        const base = PALETTE[i % PALETTE.length];
        /* Clareia no máximo 45%, medido: até 62% o último segmento chegava a
           1,12 de contraste contra o fundo do cartão — presente no HTML e
           invisível na tela. As partes vêm da maior para a menor, então o tom
           mais claro cai no segmento mais estreito, que é o que menos pesa. */
        return { x: g.rot, y: p ? Number(p.valor) || 0 : 0, fillColor: clarear(base, Math.min(0.45, j * 0.12)) };
      }),
    });
  }

  const alt = Math.max(180, grupos.length * 42 + 40);
  return Graficos.novo({
    ...Graficos.base(alt, {
      chart: { type: 'bar', stacked: true },
      xaxis: {
        categories: grupos.map(g => g.rot),
        labels: { formatter: v => fmtShort(v).replace('R$', '').trim() },
      },
      yaxis: { labels: { style: { colors: Graficos.cor.tinta, fontSize: Graficos.fonte.eixo, fontWeight: 600 } } },
      tooltip: {
        /* Dica própria, não a nativa: um segmento sozinho não diz composição.
           Ela lista TODOS os itens do envelope com seus percentuais e só destaca
           o que está sob o cursor — é a diferença entre saber quanto custou uma
           subcategoria e entender do que o envelope é feito. */
        custom({ dataPointIndex, seriesIndex }) {
          const g = grupos[dataPointIndex];
          if (!g) return '';
          const linhas = g.partes.map((p, j) => {
            const pct = g.total > 0 ? (p.valor / g.total) * 100 : 0;
            const tom = clarear(PALETTE[dataPointIndex % PALETTE.length], Math.min(0.45, j * 0.12));
            return `<div class="apx-tip-l${j === seriesIndex ? ' on' : ''}">
              <i style="background:${tom}"></i>
              <span class="apx-tip-r">${esc(p.rot)}</span>
              <b>${fmtShort(p.valor)}</b>
              <small>${pct.toFixed(0)}%</small></div>`;
          }).join('');
          return `<div class="apx-tip"><div class="apx-tip-cab">${esc(g.rot)}
            <b>${fmtShort(g.total)}</b></div>${linhas}</div>`;
        },
      },
    }),
    series,
    plotOptions: {
      bar: { horizontal: true, barHeight: '58%', borderRadius: 4, borderRadiusApplication: 'end' },
    },
    // Vão de 2px na cor da superfície entre segmentos: separa dois tons vizinhos
    // sem desenhar borda, que somaria tinta que não é dado
    stroke: { show: true, width: 2, colors: ['#ffffff'] },
    grid: { show: false, padding: { left: 0, right: 8, top: 0, bottom: 0 } },
  }, alt, 'composicao');
}

/* ---------- Fluxo e saldo: seis meses atrás, seis à frente ----------
   Barras para o que entrou e saiu em cada mês; área para a posição do saldo.

   HIERARQUIA: as barras são o contexto, a área é a resposta. Elas vêm em tom
   claro e ela vem por cima, saturada e com traço grosso — sem isso as três
   competem e nenhuma é lida. Foi por isso que as barras clarearam: com verde e
   vermelho cheios, a área tinha de ficar translúcida para não sumir, e translúcida
   ela não se lia sobre as barras. Invertida a hierarquia, a área pode ser sólida.

   A fronteira de hoje é a informação mais importante da tela — à esquerda é fato
   conciliado, à direita é estimativa — e por isso aparece três vezes: faixa
   sombreada, marca "previsto" e trecho tracejado (`forecastDataPoints`). */
function svgFluxoSaldo(meses, opts = {}) {
  if (meses.length < 2) return '<div class="empty">Sem histórico suficiente.</div>';

  const iPrimeiroFuturo = meses.findIndex(m => m.futuro);
  const nFuturos = iPrimeiroFuturo < 0 ? 0 : meses.length - iPrimeiroFuturo;

  /* RÓTULOS ÚNICOS, com o ano onde o nome do mês repetiria.

     Não é enfeite: as anotações do ApexCharts localizam a coluna pelo TEXTO do
     rótulo, e `getStringX` usa `indexOf` — a primeira ocorrência. Numa janela de
     13 meses o último mês tem o mesmo nome do primeiro ("jan" … "jan"), então a
     faixa do previsto terminava no índice 0 e sombreava o passado inteiro em vez
     do futuro. Com rótulo único cada anotação cai na coluna certa. */
  const nomeMes = m => m.period.start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  const contagem = {};
  for (const m of meses) contagem[nomeMes(m)] = (contagem[nomeMes(m)] || 0) + 1;
  const rotulos = meses.map(m => (contagem[nomeMes(m)] > 1
    ? nomeMes(m) + '/' + String(m.period.start.getFullYear()).slice(-2)
    : nomeMes(m)));

  const entradas = meses.map(m => Math.round(Number(m.entra) || 0));
  const saidas = meses.map(m => Math.round(Number(m.sai) || 0));
  const saldos = meses.map(m => Math.round(Number(m.saldo) || 0));

  /* DUAS ESCALAS ANCORADAS: mesmo zero, mesmo topo.

     Fluxo mensal vive nos milhares e saldo acumulado nas dezenas de milhares —
     numa escala só o saldo achata as barras a nada. Duas escalas são inevitáveis;
     o que dá para eliminar é a parte ARBITRÁRIA delas.

     Sem limites declarados, cada eixo escolhe seus próprios extremos e a linha do
     zero de um cai numa altura diferente da do outro. Aí o ponto em que a área
     cruza as barras não significa nada — é artefato de duas escolhas
     independentes. Aqui os dois recebem min e max calculados para que o zero caia
     na MESMA altura e o topo na MESMA borda. A única liberdade que sobra é a de
     unidade, e essa não há como eliminar. */
  const topoFluxo = niceCeil(Math.max(...entradas, ...saidas, 1));
  const pisoSaldo = Math.min(0, ...saldos);

  /* Fração da altura abaixo do zero. O eixo do fluxo copia essa fração para as
     duas linhas do zero coincidirem; sem saldo negativo ela é 0 e os dois eixos
     começam no zero, no pé do gráfico.

     LIMITADA A METADE, e esse limite não é estético. Com o saldo inteiramente
     negativo o zero seria o próprio topo do eixo do saldo, e as três exigências —
     zero na mesma altura, topo na mesma borda, barras positivas visíveis — não
     podem valer juntas: o eixo do fluxo teria de terminar em zero e as barras não
     seriam desenhadas. Medido num caso real de saldos entre −500 e −1.500, o piso
     do fluxo caía em −12 milhões e as barras de 8 mil viravam um fio.

     Quando a fração passa de metade, o eixo do saldo ganha folga positiva até
     ficar simétrico em torno do zero. Só ACRESCENTA espaço acima — nenhum dado é
     cortado — e garante ao fluxo metade da altura. */
  const topoNatural = niceCeil(Math.max(...saldos, 1));
  const desejada = pisoSaldo < 0 ? -pisoSaldo / (topoNatural - pisoSaldo) : 0;
  const fracaoNegativa = Math.min(0.5, desejada);
  const topoSaldo = desejada > 0.5 ? -pisoSaldo : topoNatural;
  const pisoFluxo = fracaoNegativa > 0
    ? -topoFluxo * fracaoNegativa / (1 - fracaoNegativa) : 0;

  const alt = opts.height || 300;
  // Verde e vermelho CLAREADOS: as barras são o contexto sobre o qual a área se lê
  const corEntrou = clarear(Graficos.cor.verde, 0.42);
  const corSaiu = clarear(Graficos.cor.vermelho, 0.42);
  const corSaldo = Graficos.cor.roxo;

  const cfg = {
    ...Graficos.base(alt, {
      chart: { type: 'line', stacked: false },
      /* RÓTULO DE UMA LINHA SÓ — o nome do mês.

         O desvio do mês (entradas − saídas) já morou aqui, numa segunda linha
         acima do nome. A informação era boa e a execução não: com treze meses na
         janela, dois textos por coluna encavalam no celular, e um eixo ilegível
         custa mais do que o número acrescentava. Revertido depois de ver na tela.

         Se o desvio voltar algum dia, precisa de outro lugar — rodapé do cartão
         ou tooltip —, não de mais texto no eixo. */
      xaxis: { categories: rotulos, tooltip: { enabled: false } },
      tooltip: {
        shared: true, intersect: false,
        y: { formatter: v => (v == null ? '—' : fmt(v)) },
        x: {
          formatter: (_v, { dataPointIndex }) => {
            const m = meses[dataPointIndex];
            if (!m) return '';
            const quando = m.period.start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            return quando + (m.futuro ? ' · previsto' : '');
          },
        },
      },
    }),
    series: [
      { name: 'entrou', type: 'column', data: entradas },
      { name: 'saiu', type: 'column', data: saidas },
      { name: 'saldo', type: 'area', data: saldos },
    ],
    colors: [corEntrou, corSaiu, corSaldo],
    plotOptions: {
      // Ponta arredondada, pé reto: o topo é o dado; arredondar a base faria a
      // barra parecer flutuar acima do zero
      bar: { columnWidth: '42%', borderRadius: 5, borderRadiusApplication: 'end' },
    },
    /* Traço só na área, e grosso: é ele que garante a leitura do nível por cima
       das barras. As duas primeiras cores são 'transparent' porque no ApexCharts a
       coluna também aceita contorno — e borda em volta da barra é tinta que não é
       dado. */
    stroke: {
      show: true, width: [0, 0, 4], curve: 'smooth',
      colors: ['transparent', 'transparent', corSaldo],
    },
    /* A área é a última série, então é desenhada por cima. Com as barras claras
       ela não precisa mais se apagar para não cobri-las: o degradê começa forte no
       traço e se dissolve para baixo, devolvendo as barras à vista embaixo. */
    fill: {
      type: ['solid', 'solid', 'gradient'],
      opacity: [1, 1, 1],
      gradient: {
        type: 'vertical', shadeIntensity: 1,
        opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 90, 100],
      },
    },
    /* Marcador nos dois pontos que o rodapé do cartão nomeia: o saldo de hoje e o
       do fim da janela. Um ponto em cada mês viraria ruído. */
    markers: {
      size: 0, hover: { size: 7 }, strokeColor: '#ffffff', strokeWidth: 3,
      discrete: [...new Set([Math.max(0, iPrimeiroFuturo - 1), meses.length - 1])].map(i => ({
        seriesIndex: 2, dataPointIndex: i, size: 6,
        fillColor: corSaldo, strokeColor: '#ffffff', strokeWidth: 3,
      })),
    },
    /* Eixos SEM TEXTO. Os números que importam estão escritos no rodapé do cartão
       — saldo de hoje, do fim da janela, previsto entrar e previsto sair — e duas
       colunas de números, uma de cada lado, só apertavam o desenho. Os limites
       continuam declarados: eles são a geometria que ancora as duas escalas, não
       rótulo. */
    yaxis: [
      { seriesName: 'entrou', min: pisoFluxo, max: topoFluxo, labels: { show: false } },
      { seriesName: 'entrou', show: false, min: pisoFluxo, max: topoFluxo },
      { seriesName: 'saldo', opposite: true, min: pisoSaldo, max: topoSaldo, labels: { show: false } },
    ],
    grid: {
      borderColor: Graficos.cor.linha, strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { left: -8, right: -8, top: 0, bottom: 0 },
    },
    legend: {
      show: true, position: 'top', horizontalAlign: 'left', fontSize: Graficos.fonte.valor,
      markers: { radius: 6 }, itemMargin: { horizontal: 8, vertical: 4 },
    },
  };

  /* Tracejado no trecho previsto: `forecastDataPoints` faz isso na própria
     série, sem partir o saldo em duas — o que abriria uma emenda visível na
     fronteira e faria a área contar dois níveis onde há um. */
  if (nFuturos > 0) {
    cfg.forecastDataPoints = { count: nFuturos, dashArray: 5, fillOpacity: 0.5 };
    cfg.annotations = {
      xaxis: [{
        x: rotulos[iPrimeiroFuturo],
        x2: rotulos[meses.length - 1],
        fillColor: '#eef0f6', opacity: 0.5,
        label: {
          text: 'previsto', position: 'top', orientation: 'horizontal', borderWidth: 0,
          style: { background: 'transparent', color: Graficos.cor.tintaFraca, fontSize: Graficos.fonte.ref, fontWeight: 700 },
        },
      }],
    };
  }

  return Graficos.novo(cfg, alt, 'fluxo-saldo');
}

/* ---------- Linha com faixa de normalidade ----------
   A faixa é mediana ± desvio mediano: o que "normal" significa PARA ESTA
   FAMÍLIA, medido no próprio histórico dela. Ponto dentro da faixa é rotina;
   fora, é notícia — e é isso que separa um gráfico que informa de um que só
   desenha. Sem a faixa, toda subida parece alarme e o leitor aprende a ignorar.

   A faixa vira anotação de eixo Y, não uma segunda série: como área ela
   entraria na legenda e no tooltip como se fosse dado medido mês a mês, e ela
   não é — é uma referência constante calculada sobre a série inteira. */
function svgLinhaFaixa(serie, opts = {}) {
  if (!serie.length) return '<div class="empty">Sem histórico no período.</div>';
  const vals = serie.map(s => Number(s.valor) || 0);
  const positivos = vals.filter(v => v > 0);
  const med = DB.mediana(positivos);
  const mad = DB.desvioMediano(positivos) || med * 0.1;

  const anot = [];
  if (positivos.length >= 3) {
    anot.push({
      y: Math.max(0, med - mad), y2: med + mad,
      fillColor: '#eef6fd', opacity: 0.9, borderWidth: 0,
      label: {
        text: 'faixa normal', position: 'left', textAnchor: 'start', borderWidth: 0,
        style: { background: 'transparent', color: Graficos.cor.tintaFraca, fontSize: Graficos.fonte.ref, fontWeight: 600 },
      },
    });
    anot.push({ y: med, borderColor: Graficos.cor.cinza, strokeDashArray: 0, strokeWidth: 1 });
  }

  // Marcador só nas pontas e no extremo: um ponto em cada mês vira ruído
  const iMax = vals.indexOf(Math.max(...vals));
  const destaque = [...new Set([0, serie.length - 1, iMax])];

  const alt = opts.height || 230;
  /* Sem eixo de valor: os dois cartões que usam esta forma — "Isso é normal para
     vocês?" e "Saldo projetado" — escrevem os números que importam no rodapé
     (mediana, mês atual, menor ponto, fechamento). O eixo repetia a mesma escala
     numa coluna que ninguém lê dígito por dígito, e a grade sozinha já dá a
     altura. A faixa de normalidade também continua rotulada. */
  return Graficos.novo(Graficos.semEixoDeValor({
    // Acabamento de linha do widget 29, compartilhado com os outros de linha
    ...Graficos.linha(Graficos.base(alt, {
      chart: { type: 'area' },
      xaxis: {
        categories: serie.map(s => s.rot),
        // Um rótulo a cada N: doze nomes lado a lado colidem no celular
        labels: { hideOverlappingLabels: true },
        tooltip: { enabled: false },
      },
      yaxis: { labels: { formatter: v => fmtShort(v).replace('R$', '').trim() } },
      tooltip: { y: { formatter: v => fmt(v) } },
    }), Graficos.cor.azul),
    series: [{ name: opts.nome || 'valor', data: vals.map(v => Math.round(v)) }],
    colors: [Graficos.cor.azul],
    // Cor do traço declarada aqui, como no widget 29
    stroke: { show: true, curve: 'smooth', width: 3, colors: [Graficos.cor.azul] },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0, stops: [0, 80, 100] },
    },
    markers: {
      size: 0, hover: { size: 6 }, strokeColor: '#ffffff', strokeWidth: 3,
      discrete: destaque.map(i => ({
        seriesIndex: 0, dataPointIndex: i, size: 5,
        fillColor: '#ffffff', strokeColor: Graficos.cor.azul, strokeWidth: 3,
      })),
    },
    annotations: { yaxis: anot },
  }), alt, 'faixa-normal');
}

/* Rosca em SVG à mão. É o ÚNICO gráfico que não passou para a biblioteca, e o
   motivo é medido: ele é quadrado e com proporção preservada, então a escala do
   viewBox fica entre 0,79 e 1,04 — o texto dele já renderiza no tamanho certo. O
   defeito que motivou a troca (viewBox de 720 num cartão de 307px encolhendo
   rótulo de 11px para 4,7px) nunca existiu aqui.

   Em troca, o formato à mão dá o que a rosca da biblioteca não dava: o total no
   centro em duas ou três linhas de tipografia nossa, e a legenda como TABELA ao
   lado — nome, percentual e valor em colunas alinhadas. A legenda da biblioteca é
   uma fila de pastilhas, que não alinha número nenhum.

   O anel é espesso, com respiro entre fatias e um trilho cinza por baixo para a
   volta completa ficar legível mesmo com uma fatia só. */
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

/* Quebra um rótulo de eixo em até duas linhas, sem reticências.

   Devolver array é como o ApexCharts desenha várias linhas num rótulo. Duas no
   máximo: com três, o eixo domina o gráfico. Quando nem quebrando cabe (uma
   palavra só, muito longa), a palavra vai inteira e transborda — melhor um nome
   comprido que um nome irreconhecível. */
function quebrarRotulo(txt, limite = 18) {
  const s = String(txt == null ? '' : txt);
  if (s.length <= limite) return s;
  const palavras = s.split(' ');
  const linhas = [''];
  for (const p of palavras) {
    const atual = linhas[linhas.length - 1];
    if (!atual) { linhas[linhas.length - 1] = p; continue; }
    if ((atual + ' ' + p).length <= limite) linhas[linhas.length - 1] = atual + ' ' + p;
    else if (linhas.length < 2) linhas.push(p);
    else linhas[1] = atual + ' ' + p;      // o resto se junta na segunda linha
  }
  // Uma linha só volta como texto: array de um item é ruído para quem lê a config
  return linhas.length > 1 ? linhas : linhas[0];
}

/* Do relatório por etiqueta para os lançamentos dela. Vive fora do bindView
   porque quem chama também é o clique na barra do gráfico, que não passa por
   listener de DOM — o ApexCharts avisa por evento próprio. */
function verLancamentosDaTag(tag) {
  setTab('extrato');            // zera o resto dos filtros, então o alvo fica só a etiqueta
  state.filtros.tags = [tag];
  render();
}

/* Cor de texto legível sobre um fundo, escolhida por CONTRASTE MEDIDO.

   Necessária porque o valor passou a ser escrito DENTRO da barra: branco sobre o
   verde-limão ou o âmbar da paleta dá ~1,9:1, que é texto invisível. Calcula a
   luminância relativa (WCAG) e devolve o lado que contrasta mais. */
function corDeTextoSobre(hex) {
  const canal = c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const n = parseInt(String(hex).replace('#', ''), 16);
  const L = 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  const contra = outro => {
    const m = parseInt(outro.replace('#', ''), 16);
    const L2 = 0.2126 * canal((m >> 16) & 255) + 0.7152 * canal((m >> 8) & 255) + 0.0722 * canal(m & 255);
    const [a, b] = L > L2 ? [L, L2] : [L2, L];
    return (a + 0.05) / (b + 0.05);
  };
  return contra('#ffffff') >= contra('#181c32') ? '#ffffff' : '#181c32';
}

/* Barras horizontais com nome e valor — para rankings (categoria, membro, método,
   origem da receita). Ordenadas do maior para o menor: em ranking a posição já é
   metade da resposta.

   Segue o Charts Widget 27 do demo25 (website-analytics), que é exatamente esta
   forma — poucas barras horizontais, uma cor por linha, valor escrito na própria
   barra. O que veio dele: canto de 8, barra generosa em px (não em %), rótulo
   DENTRO da barra a partir da base, e grade só na vertical.

   A grade vertical é o detalhe que mais rende: numa barra horizontal as linhas
   perpendiculares funcionam como régua de comprimento. Horizontais seriam apenas
   riscos entre as barras, medindo nada.

   `opts.aoClicar(nome)` liga a barra a uma ação (ver os lançamentos daquela
   etiqueta, por exemplo). Vem por evento do gráfico, não por <button> no rótulo:
   o eixo do ApexCharts é SVG e não aceita HTML dentro. */
function svgRanking(entries, cores, opts = {}) {
  if (!entries.length) return '<div class="empty">Sem dados no período.</div>';
  const total = entries.reduce((s, e) => s + (Number(e[1]) || 0), 0);
  const maior = Math.max(...entries.map(e => Number(e[1]) || 0), 1);
  const paleta = entries.map((e, i) => (cores && cores[i % cores.length]) || PALETTE[i % PALETTE.length]);

  /* Passo de 48px por linha com barra de 34px — a mesma proporção do widget 27
     (70px de passo para 50px de barra, ~71%), em escala de celular. O que faz o
     gráfico deles parecer desenhado é a barra generosa; 34px de altura era filete. */
  const PASSO = 48;
  const alt = Math.max(150, entries.length * PASSO + 34);

  /* Cor do rótulo por BARRA, e não uma só para todas. Duas razões:

     1. O rótulo fica dentro da barra, então precisa contrastar com a cor DELA —
        branco sobre âmbar é invisível.
     2. Barra curta não tem largura para conter o rótulo, que transborda para o
        fundo do cartão. Aí a cor tem de ser a tinta escura, não a da barra.
        O corte de 30% é onde o texto (~8 dígitos) deixa de caber. */
  const coresRotulo = entries.map((e, i) => {
    const fatia = (Number(e[1]) || 0) / maior;
    return fatia < 0.3 ? Graficos.cor.tintaFraca : corDeTextoSobre(paleta[i]);
  });

  const eventos = opts.aoClicar
    ? { events: { dataPointSelection: (_e, _c, { dataPointIndex }) => {
        const linha = entries[dataPointIndex];
        if (linha) opts.aoClicar(linha[0]);
      } } }
    : {};

  /* Sem eixo de valor: numa barra horizontal ele é a régua embaixo, e o valor já
     está escrito na própria barra. Duas cópias do mesmo número é tinta que não é
     dado — e a que fica é a que está ao lado da coisa medida. */
  return Graficos.novo(Graficos.semEixoDeValor({
    ...Graficos.base(alt, {
      chart: { type: 'bar', ...eventos },
      xaxis: {
        categories: entries.map(e => e[0]),
        labels: { formatter: v => fmtShort(v).replace('R$', '').trim() },
      },
      /* Nome de categoria NUNCA é cortado com reticências. O ApexCharts trunca no
         maxWidth por padrão, e "Serviços & Taxas" viraria "Serviços &…". Devolver
         um array do formatter faz a lib desenhar uma linha por item, que é a
         forma dela de quebrar texto. */
      yaxis: {
        labels: {
          style: { colors: Graficos.cor.tinta, fontSize: Graficos.fonte.eixo, fontWeight: 600 },
          maxWidth: 150, offsetY: 2, formatter: quebrarRotulo,
        },
      },
      tooltip: {
        y: {
          formatter: v => fmt(v) + (total > 0 ? ' · ' + Math.round((v / total) * 100) + '%' : ''),
        },
      },
    }),
    series: [{ name: 'total', data: entries.map(e => Math.round(Number(e[1]) || 0)) }],
    colors: paleta,
    plotOptions: {
      bar: {
        horizontal: true, distributed: true, barHeight: 34,
        borderRadius: 8, borderRadiusApplication: 'end',
        dataLabels: { position: 'bottom' },       // dentro da barra, na base dela
      },
    },
    // Valor escrito na própria barra: em ranking curto ele dispensa ler o eixo
    dataLabels: {
      enabled: true, textAnchor: 'start', offsetX: 12,
      formatter: v => fmtShort(v).replace('R$', '').trim(),
      style: { fontSize: Graficos.fonte.valor, fontWeight: 600, colors: coresRotulo },
    },
    /* Grade só na vertical: em barra horizontal ela cruza as barras e serve de
       régua de comprimento. Linha horizontal aqui seria risco entre barras,
       medindo nada. */
    grid: {
      borderColor: Graficos.cor.linha, strokeDashArray: 4,
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } },
      padding: { left: 0, right: 12, top: 0, bottom: 0 },
    },
  }, 'x'), alt, 'ranking');
}

/* Burn-up do mês: gasto acumulado dia a dia contra a trilha ideal do orçamento.
   A trilha é uma reta do zero ao limite ao longo do mês — o valor dela é dizer
   se o gasto está adiantado, não se estourou. Estourar só se sabe no dia 31; a
   trilha avisa no dia 9.

   Acabamento de linha do Charts Widget 29 (mira vertical tracejada, hover que não
   repinta a série, quatro marcas por eixo) via Graficos.linha().

   A escala cobre a trilha inteira, então o gasto aparece pequeno contra ela — e
   isso É a informação: estar bem abaixo da reta ideal no dia 12 é a resposta que
   o cartão existe para dar. */
function svgBurnup(period, refLimit) {
  const totalDias = DB.periodDays(period), decorridos = DB.elapsedDays(period);
  const diario = new Array(totalDias).fill(0);
  for (const t of DB.expensesOf(period)) {
    const i = Math.min(totalDias - 1, Math.max(0, Math.floor((new Date(t.date + 'T12:00:00') - period.start) / 86400000)));
    diario[i] += Number(t.amount) || 0;
  }
  let acc = 0;
  const cum = diario.map(v => (acc += v));
  /* MÊS QUE AINDA NÃO COMEÇOU: a curva é a do PREVISTO, o mês inteiro.

     Com o corte em "hoje", um mês futuro tinha `decorridos = 0` e a série saía
     inteira nula — o cartão desenhava só a trilha ideal e o gráfico lia como
     vazio. Mas o mês futuro tem uma curva legítima para mostrar: o acumulado dos
     compromissos já conhecidos, que é justamente o que responde "o que já está
     marcado estoura o limite?".

     A distinção previsto/realizado não se perde: o nome da série muda e o traço
     vai tracejado, do mesmo jeito que o resto do app marca previsão. */
  const naoComecou = decorridos === 0 && DB.paraISO(period.start) > DB.hojeISO();
  const gastoHoje = decorridos > 0 ? cum[decorridos - 1] : (naoComecou ? cum[totalDias - 1] : 0);
  // Depois de hoje a série é null, não zero: zero afirmaria "não gastou nada
  // no dia 20" num mês que ainda não chegou lá
  const realizado = cum.map((v, i) => (naoComecou || i < decorridos ? Math.round(v) : null));
  // O ponto que leva marcador e rótulo: hoje, ou o fim do mês quando ele é todo previsto
  const destaque = naoComecou ? totalDias - 1 : decorridos - 1;
  const estourou = refLimit > 0 && gastoHoje > refLimit * (naoComecou ? 1 : decorridos / Math.max(1, totalDias));
  const corLinha = estourou ? Graficos.cor.vermelho : Graficos.cor.azul;
  const temTrilha = refLimit > 0;
  const dias = Array.from({ length: totalDias }, (_, i) => String(i + 1));

  const series = [{ name: naoComecou ? 'previsto acumulado' : 'gasto acumulado', type: 'area', data: realizado }];
  if (temTrilha) {
    series.push({
      name: 'trilha ideal', type: 'line',
      data: Array.from({ length: totalDias }, (_, i) => Math.round(refLimit * (i / Math.max(1, totalDias - 1)))),
    });
  }

  const alt = 240;
  /* Sem eixo de valor: o número que responde a pergunta do cartão — quanto já se
     gastou até hoje — vai escrito no ponto de hoje, junto do marcador. Era o que a
     versão desenhada à mão fazia. O eixo repetia a escala inteira para dar um
     número só, e a trilha ideal já mostra onde o limite fica. */
  return Graficos.novo(Graficos.semEixoDeValor({
    // O acabamento de linha do widget 29 envolve a base: mira, hover e marcador
    ...Graficos.linha(Graficos.base(alt, {
      chart: { type: 'area' },
      xaxis: {
        categories: dias,
        tickAmount: Math.min(8, totalDias),
        labels: { hideOverlappingLabels: true },
        tooltip: { enabled: false },
      },
      yaxis: { labels: { formatter: v => fmtShort(v).replace('R$', '').trim() } },
      tooltip: {
        shared: true, intersect: false,
        y: { formatter: v => (v == null ? '—' : fmt(v)) },
        x: { formatter: d => 'dia ' + d },
      },
    }), corLinha),
    series,
    /* Cor do traço declarada em stroke, não só em colors — é o que o widget 29
       faz, e o que garante que a trilha receba a cor dela. */
    stroke: {
      show: true,
      /* `curve` ESCALAR de propósito, nunca array. Lido no fonte da lib: num
         ponto ela resolve `stroke.curve[serie]` corretamente, mas na checagem de
         ponto nulo compara `config.stroke.curve` DIRETO com a string 'smooth'.
         Com array essa comparação nunca casa, e os nulos do futuro do mês param
         de abrir intervalo — a área desce até o zero em vez de terminar em hoje.
         Suavizar as duas não custa nada: a trilha é linear, e curva suave sobre
         série linear é uma reta. */
      curve: 'smooth',
      width: temTrilha ? [3, 2] : [3],
      // Mês todo previsto: a própria curva vai tracejada. Confundir previsão com
      // fato é o pior engano possível num app de finanças.
      dashArray: temTrilha ? [naoComecou ? 4 : 0, 5] : [naoComecou ? 4 : 0],
      colors: temTrilha ? [corLinha, Graficos.cor.cinza] : [corLinha],
    },
    colors: temTrilha ? [corLinha, Graficos.cor.cinza] : [corLinha],
    /* Degradê só sob a área; a trilha é linha e não tem o que preencher. Saiu a
       opacidade 0 na segunda série: o path da linha nasce com fill "none", então
       ela não fazia nada e só escondia a intenção de quem lê o código. */
    fill: {
      type: temTrilha ? ['gradient', 'solid'] : ['gradient'],
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0, stops: [0, 80, 100] },
    },
    markers: {
      size: 0, hover: { size: 6 }, strokeColor: '#ffffff', strokeWidth: 3,
      // Só o ponto de hoje: ele é a resposta do gráfico. Em mês todo previsto, o
      // ponto é o fim do mês — o total que já está comprometido.
      discrete: destaque >= 0 ? [{
        seriesIndex: 0, dataPointIndex: destaque, size: 5,
        fillColor: '#ffffff', strokeColor: corLinha, strokeWidth: 3,
      }] : [],
    },
    /* Rótulo SÓ no ponto de hoje, e só na série do gasto. Um número em cada dia
       viraria uma faixa de texto sobre a curva; e rótulo na trilha ideal seria
       marcar uma referência calculada como se fosse dinheiro gasto. */
    dataLabels: {
      enabled: true, offsetY: -12,
      formatter: (v, { seriesIndex, dataPointIndex }) => (
        seriesIndex === 0 && dataPointIndex === destaque && v != null
          ? fmtShort(v).replace('R$', '').trim() : ''),
      style: { fontSize: Graficos.fonte.valor, fontWeight: 700, colors: [Graficos.cor.tinta] },
      background: { enabled: false },
    },
    legend: temTrilha
      ? { show: true, position: 'top', horizontalAlign: 'left', fontSize: Graficos.fonte.valor, markers: { radius: 6 } }
      : { show: false },
  }), alt, 'burnup');
}

/* O rodapé do "Disponível para usar": o que já está planejado para o MÊS SEGUINTE.

   Antes esta linha dizia "além disso, R$ X vencem depois deste mês" — um total sem
   teto, que somava o próximo mês, o seguinte e o IPVA de janeiro num número só.
   Ele não batia com nada: quem ia conferir nas Saídas de agosto via outro valor, e
   não tinha como descobrir por quê.

   Agora é o resumo de UM mês — o próximo —, com entra, sai e resultado. Cada
   número aqui casa exatamente com o que o Painel e o Extrato de agosto mostram, o
   que é o ponto: um número que não se confere em outra tela não serve para decidir
   nada. O horizonte deixou de precisar ser explicado porque virou "o mês seguinte".

   Some quando não há nada previsto: uma linha dizendo "R$ 0,00 previstos" ocuparia
   espaço para não informar nada. */
function resumoDoProximoMes() {
  const prox = DB.monthPeriod(new Date(), 1);
  const pv = DB.previsaoDoMes(prox);
  if (!pv.itens.length) return '';
  const mes = prox.start.toLocaleDateString('pt-BR', { month: 'long' });
  const sobra = pv.resultado;
  /* O INVESTIMENTO NÃO ENTRA NAS CONTAS A PAGAR.

     São movimentos de natureza oposta: um consome, o outro acumula. Juntá-los faz
     a frase dizer que o mês tem R$ 12.129 de despesa quando R$ 3.400 daquilo vira
     patrimônio.

     `pv.sai` já vem sem o aporte — `previsaoDoMes` o contabiliza em `investe`.
     Antes era preciso subtrair aqui, e a subtração era feita sobre um total que
     nem sempre continha o valor, o que produzia números menores que a realidade. */
  const investir = pv.investe;
  const aPagar = pv.sai;
  const partes = [`já há <b>${fmt(aPagar)}</b> a pagar`];
  if (investir > 0.005) partes.push(`<b>${fmt(investir)}</b> a guardar`);
  if (pv.entra > 0.005) partes.push(`<b>${fmt(pv.entra)}</b> a receber`);
  const lista = partes.length > 1
    ? partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1]
    : partes[0];
  return `<p class="hero-depois">Em <b>${esc(mes)}</b>, ${lista} — ${
    pv.entra > 0.005
      ? `${sobra >= 0 ? 'sobrariam' : 'faltariam'} <b>${fmt(Math.abs(sobra))}</b>${
        investir > 0.005 ? ' depois de guardar' : ''}`
      : 'ainda sem receita prevista'}. <span class="muted">${pv.itens.length} item(ns) já conhecido(s); gasto variável não entra.</span></p>`;
}

/* O que já se sabe sobre um mês que ainda não chegou.

   Um número sozinho não dá para decidir nada: quem vê "vai sobrar R$ 800" precisa
   saber DE QUÊ, para poder discordar de uma linha. A lista nomeia cada item e diz
   de onde ele veio — já lançado, contrato que se repete, custo fixo ou fatura —
   porque a confiança na projeção depende de poder auditá-la.

   Deixa claro o que NÃO está aqui: gasto variável. Uma projeção que só conhece
   contas fixas e chama o resto de "sobra" seria otimista por construção. */
const ROTULO_ORIGEM = {
  'lançado': 'já lançado',
  prevista: 'repete todo mês',
  'custo fixo': 'custo fixo',
  fatura: 'fatura de cartão',
};

/* A linha de um item previsto.

   UMA linha de metadados, no formato que o extrato já usa (`origem · detalhe`).
   O detalhe é o que aquele tipo de item precisa para ser julgado sem abrir mais
   nada — e nada além disso, porque a segunda linha de meta em dez linhas seguidas
   vira parede de texto e o olho para de ler qualquer uma:

   - conta comum: a CATEGORIA, que é o que diz se o gasto era esperado
   - fatura: o STATUS e o TOTAL. O valor à direita é o que FALTA; sem a referência
     do total, quem pagou parcial lê o número menor como "meu pagamento não
     entrou". Era a informação que a lista de vencimentos dava e a previsão não. */
function linhaPrevista(i) {
  const meta = [ROTULO_ORIGEM[i.origem] || i.origem];
  if (i.origem === 'fatura') {
    if (i.fatura_status) meta.push(i.fatura_status);
    if (i.fatura_pago > 0.005) meta.push(`de ${fmtShort(i.fatura_total)}`);
  } else if (i.category_id) {
    meta.push(catLabel(i.category_id));
  }
  return `<div class="prev-linha">
    <span class="prev-dia">${fmtDay(i.data)}</span>
    <span class="prev-nome">${esc(i.titulo)}<small>${esc(meta.join(' · '))}</small></span>
    <span class="num ${i.receita ? 'txt-green' : ''}">${i.receita ? '+' : '−'} ${fmtShort(i.valor)}</span>
  </div>`;
}

/* Teto de linhas: dez.

   A lista existe para responder "de que é feito esse número", e isso se responde
   com os primeiros itens — que são os mais próximos, porque a lista é cronológica.
   Sem teto, um mês com trinta compromissos empurrava o resto da tela para fora do
   alcance e a seção deixava de ser um resumo. O que passa de dez continua
   acessível no extrato daquele mês, que é a tela feita para listar. */
const TETO_PREVISTO = 10;

function cardPrevisaoDoMes(previsto, period, offsetDoMes) {
  if (!previsto.itens.length) return '';
  /* A FATURA ENTRA MESMO ALÉM DO TETO. A lista é cronológica e a fatura costuma
     vencer no fim do mês, então ela é justamente quem cai fora do corte — medido
     em agosto/2026: era o 11º de 11 itens e sumia da tela. Esquecer uma fatura
     custa juros; esquecer a décima primeira conta do mês, não. Ela entra na
     posição cronológica dela, e não no fim, para a lista continuar sendo uma
     linha do tempo. */
  const primeiros = new Set(previsto.itens.slice(0, TETO_PREVISTO));
  const mostra = previsto.itens.filter(i => primeiros.has(i) || i.origem === 'fatura');
  const resto = previsto.itens.length - mostra.length;
  return `
    <div class="card">
      <div class="card-head"><div><b>O que já está previsto para ${esc(period.label)}</b>
        <small>${previsto.itens.length} item(ns) conhecido(s) — gasto variável não entra</small></div>
        <span class="num ${previsto.resultado >= 0 ? 'txt-green' : 'txt-red'}" style="font-size:16px">${fmtShort(previsto.resultado)}</span></div>
      <div class="prev-lista">${mostra.map(linhaPrevista).join('')}</div>
      ${resto > 0 && offsetDoMes !== undefined
        ? `<button class="btn ghost btn-sub" data-vermais="${offsetDoMes}">Ver os ${previsto.itens.length} no extrato de ${esc(period.label)}</button>`
        : ''}
    </div>`;
}

/* O fim do Painel: este mês e o próximo, lado a lado.

   Antes eram duas seções em pontas opostas da tela respondendo a mesma pergunta —
   "o que ainda vai sair": a lista de faturas no rodapé e o previsto lá em cima,
   colado no hero. E a fatura saía nas DUAS (medido em agosto/2026: C6 Carbon,
   R$ 179,22, uma abaixo da outra). Agora é uma seção só, e cada compromisso
   aparece uma vez.

   DOIS MESES porque a pergunta de quem olha o painel raramente para no dia 31: o
   aluguel do mês que vem já está contratado, e é ele que decide se dá para gastar
   hoje. O mês seguinte era mencionado só numa frase dentro do hero, sem os itens.

   CADA CARD SOME sozinho quando não tem item — e some mesmo, não vira caixa vazia
   dizendo "nada previsto". Medido: julho/2026 está com zero itens, então hoje a
   seção mostra só agosto, ocupando a largura toda. Isso sai de graça do
   `.grid-3`, que já se reorganiza para o número de cards que sobrou. */
function secaoDoQueAindaVem(period, previstoDoMes) {
  const proximo = DB.monthPeriod(period.start, 1);
  const off = state.monthOffset || 0;
  const cards = [
    cardPrevisaoDoMes(previstoDoMes, period, off),
    cardPrevisaoDoMes(DB.previsaoDoMes(proximo), proximo, off + 1),
  ].filter(Boolean);
  if (!cards.length) return '';
  return `<p class="section-title">O que ainda vem <span class="muted">— compromissos já conhecidos${
    cards.length > 1 ? ' deste mês e do próximo' : ''}; gasto variável não entra</span></p>
    <div class="grid-3">${cards.join('')}</div>`;
}

/* O que ainda falta GUARDAR, dito conforme o orçamento tenha sobra ou não.

   "Do restante, R$ 3.266 é a meta de investimento" pressupõe que exista restante.
   Em julho o orçamento estourou em R$ 7.580 — não há restante nenhum, e a frase
   ficava sem sentido: falava de uma sobra que não existe.

   São dois cenários diferentes e a leitura muda inteira. Com sobra, o aviso
   protege a meta: parte daquele dinheiro tem destino. Sem sobra, o aviso é outra
   coisa — a meta de poupança não vai sair deste mês, e dizer isso é mais honesto
   do que sugerir um "restante" que já foi gasto. */
function notaDoInvestimento(env, period, restante, usadoNoEnvelope) {
  if (!env) return '';
  const falta = DB.budgetOf(env.id, period) - usadoNoEnvelope(env);
  if (falta <= 0.005) return '';                 // meta cumprida: nada a avisar
  if (restante > 0.005) {
    // Só a parte que cabe na sobra é "reservada"; o excedente já não tem de onde sair
    const reservado = Math.min(falta, restante);
    return `<p class="muted" style="margin-top:var(--e2)">Do restante, <b>${fmtShort(reservado)}</b> é a meta de investimento ainda não cumprida — não é para gastar.</p>`;
  }
  return `<p class="muted" style="margin-top:var(--e2)">O orçamento já estourou em <b>${fmtShort(-restante)}</b>, e ainda faltam <b>${fmtShort(falta)}</b> para a meta de investimento do mês.</p>`;
}

/* QUANDO a reserva fica pronta.

   "Faltam R$ 72.526" é um número que paralisa; "no ritmo atual, fevereiro de 2028"
   é um plano — e a diferença entre os dois é o que faz alguém continuar guardando.

   O ritmo vem dos aportes JÁ FEITOS (`goalPace`). O agendado entra como reforço,
   dito à parte: contar um plano como se fosse ritmo daria uma data que ninguém
   sustentou ainda. Sem histórico nenhum, a estimativa cai para o que o orçamento
   prevê guardar — que é uma intenção declarada, e a frase diz isso. */
/* HORIZONTE HUMANO. No ritmo de R$ 44,67/mês, uma reserva de R$ 60.000 fica pronta
   em 1.340 meses — e a tela dizia "maio de 2138". É aritmeticamente verdadeiro e
   não serve para decidir nada: ninguém planeja 112 anos.

   Acima de 10 anos a resposta deixa de ser a data e passa a ser o que falta para
   ela existir: quanto por mês fecharia a meta num prazo que cabe numa vida. */
const HORIZONTE_MESES = 120;
function prazoDaMeta(falta, ritmo) {
  if (!(ritmo > 0.005)) return null;
  const meses = Math.ceil(falta / ritmo);
  if (meses > HORIZONTE_MESES) return { meses, longe: true, precisaria: falta / 60 };
  const quando = new Date();
  quando.setMonth(quando.getMonth() + meses);
  return { meses, longe: false, rotulo: quando.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) };
}

function previsaoDaReserva(meta, falta) {
  if (!meta || falta <= 0) return '';
  const ritmo = DB.goalPace(meta.id);
  const planejado = DB.goalPlanejado(meta.id);
  const prazo = prazoDaMeta(falta, ritmo);
  if (prazo && prazo.longe) {
    return `<p class="muted">🐢 No ritmo de <b>${fmtShort(ritmo)}/mês</b> seriam <b>${Math.round(prazo.meses / 12)} anos</b>. Para fechar em 5, seriam <b>${fmtShort(prazo.precisaria)}/mês</b>.</p>`;
  }
  if (prazo) {
    const meses = prazo.meses;
    const reforco = planejado > 0.005
      ? ` Há ${fmtShort(planejado)} já agendado, que antecipa isso.` : '';
    return `<p class="muted">📈 No ritmo de <b>${fmtShort(ritmo)}/mês</b>, fica pronta em <b>${esc(prazo.rotulo)}</b> — ${meses} ${meses === 1 ? 'mês' : 'meses'}.${esc(reforco)}</p>`;
  }
  if (planejado > 0.005) {
    return `<p class="muted">📅 <b>${fmtShort(planejado)}</b> já agendado. Ainda sem histórico de aportes para estimar a data.</p>`;
  }
  const env = DB.envelopeDeInvestimento();
  const alvoMes = env ? DB.budgetOf(env.id) : 0;
  return alvoMes > 0
    ? `<p class="muted">📈 Guardando o previsto no orçamento (<b>${fmtShort(alvoMes)}/mês</b>), seriam <b>${Math.ceil(falta / alvoMes)} meses</b> até o objetivo.</p>`
    : '<p class="muted">📈 Sem aportes ainda — o primeiro é o que transforma a meta em plano.</p>';
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

/* As linhas da conta PREVISTA, num ponto só.

   O mês corrente e o mês futuro respondem a mesma pergunta — onde o saldo chega
   no fim do ciclo — e por isso mostram a mesma conta. Duas cópias divergiriam na
   primeira correção que entrasse só de um lado, que é como quase toda divergência
   deste app começou. Navegar de agosto para setembro também não muda mais a forma
   da tela: só mudam os números e a data de abertura.

   A LINHA DO ATRASADO existe para a conta fechar. `previsaoDoMes` enxerga só o
   mês pedido; `saldoPrevistoNaData` conta todo "A Pagar" vencido, inclusive de
   ciclos anteriores. Sem expor essa parcela, a soma das linhas não bateria com o
   total logo abaixo — e um total que não se confere não serve para decidir nada.
   Ela só aparece quando existe: no mês em dia, some. */
/* A NOTA DA LINHA "DOS FILHOS" TEM DE SER HONESTA.

   Ela dizia "no cofrinho, já é deles" e somava duas coisas diferentes: o que a
   criança JÁ TEM e as semanadas que ainda vão ser dadas até o fim do mês. Numa
   base real isso deu R$ 43 — R$ 10 no cofrinho e R$ 33 por vir — e a pessoa leu
   que o filho tinha R$ 43 sem nunca ter recebido semanada. Um rótulo que afirma
   algo falso é pior que nenhum: ele faz duvidar do resto da conta.

   Agora a nota decompõe. As duas parcelas continuam na mesma linha porque as duas
   saem do dinheiro livre — a diferença é só o tempo. */
function notaDosFilhos(agora, aVir) {
  const temAgora = agora > 0.005, temAVir = aVir > 0.005;
  if (temAgora && temAVir) return `${fmtShort(agora)} no cofrinho + ${fmtShort(aVir)} até o fim do mês`;
  if (temAVir) return 'semanadas até o fim do mês';
  return 'no cofrinho, já é deles';
}

function linhasDaPrevisao({ abreRotulo, abreNota, abre, previsto, atrasado, emContasFim, guardadoFim, dosFilhos, dosFilhosAgora, livreAoFim, variavel }) {
  /* O GASTO VARIÁVEL QUE AINDA VEM, quando há ritmo para estimá-lo.

     Sem estas duas linhas o hero respondia "quanto sobra do que está LANÇADO" e
     se calava sobre mercado, combustível e restaurante — que em agosto são o
     maior gasto do mês. Quem lia o "Livre ao fim" como o saldo do dia 31 estava
     lendo um número que ignora metade do que ainda vai sair.

     Vem em FAIXA, não em número único: medido na base real, o mesmo mês fecha em
     +R$ 52 ou em −R$ 9.668 conforme o método de projeção. Fingir um valor exato
     seria inventar precisão. As duas pontas saem de `DB.variavelProjetado` — a
     mediana do gasto diário e a média —, e a ordem entre elas é resolvida aqui
     porque nada garante qual das duas é a maior.

     "Fecha em" fica alinhado ao "Livre ao fim" e com MENOS peso que ele: o total
     firme continua sendo o protagonista da conta, e a estimativa se apresenta
     como o que é. Dois totais com o mesmo peso fariam o leitor procurar qual dos
     dois é a resposta. */
  const menor = variavel ? Math.min(variavel.contido, variavel.ritmo) : 0;
  const maior = variavel ? Math.max(variavel.contido, variavel.ritmo) : 0;
  const temVariavel = maior > 0.005;
  const faixa = (a, b) => (Math.abs(a - b) < 0.5 ? fmt(a) : `${fmt(a)} a ${fmt(b)}`);
  return `
        <div class="hc-l"><span>${abreRotulo}${abreNota ? ` <i>${abreNota}</i>` : ''}</span><b>${fmt(abre)}</b></div>
        <div class="hc-l"><span>+ Entradas <i>previstas</i></span><b>${fmt(previsto.entra)}</b></div>
        <div class="hc-l"><span>− Contas do mês <i>faturas incluídas</i></span><b>${fmt(previsto.sai)}</b></div>
        ${Math.abs(atrasado) > 0.005 ? `<div class="hc-l"><span>${
          atrasado < 0 ? '−' : '+'} Vencido <i>de meses anteriores, em aberto</i></span><b>${fmt(Math.abs(atrasado))}</b></div>` : ''}
        <div class="hc-l hc-sub"><span>= Em contas ao fim</span><b>${fmt(emContasFim)}</b></div>
        ${guardadoFim > 0.005 ? `<div class="hc-l"><span>− Guardado${
          previsto.investe > 0.005 ? ` <i>+${fmtShort(previsto.investe)} no mês</i>` : ''}</span><b>${fmt(guardadoFim)}</b></div>` : ''}
        ${dosFilhos > 0.005 ? `<div class="hc-l"><span>− Dos filhos <i>${notaDosFilhos(dosFilhosAgora, dosFilhos - dosFilhosAgora)}</i></span><b>${fmt(dosFilhos)}</b></div>` : ''}
        <div class="hc-l hc-total"><span>= Livre ao fim</span><b>${fmt(livreAoFim)}</b></div>
        ${temVariavel ? `
        <button class="hc-l hc-acao" data-classificar="1"><span>− Variável estimado <i>${fmtShort(variavel.diaContido)} a ${fmtShort(variavel.diaRitmo)}/dia · ${variavel.dias} dias · ajustar</i></span><b>${faixa(menor, maior)}</b></button>
        <div class="hc-l hc-fecha ${livreAoFim - maior < 0 ? 'hc-fecha-ruim' : ''}"><span>= Fecha em</span><b>${faixa(livreAoFim - maior, livreAoFim - menor)}</b></div>` : ''}`;
}

/* ---------- Início ---------- */
function renderInicio(period) {
  const txs = DB.expensesOf(period);
  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const saldo = contas.reduce((s, a) => s + Number(a.balance || 0), 0);

  const stats = DB.statsFor(period);
  const committed = DB.committed();
  const guardado = DB.guardado();
  const guardadoReserva = DB.guardadoReserva();
  // Mesma conta do DB.available(), com as parcelas à mão para a decomposição
  const available = saldo - committed - guardado;
  const realized = DB.realizedIncome(period);              // receitas realmente lançadas
  /* A base das porcentagens vem de DB.rendaDoMes: o que ja entrou mais o que
     ainda entra neste ciclo, com a renda declarada so como ultimo recurso. A
     declarada envelhece — medido, R$ 17.000 cadastrados contra R$ 31.239 em
     junho, R$ 22.453 em julho e R$ 17.981 em agosto. */
  const income = DB.rendaDoMes(period);
  const budgetTotal = DB.budgetTotal(period);
  const refLimit = income > 0 ? income : budgetTotal;
  const health = healthOf(stats, refLimit, available);

  /* Faturas em aberto: soma o que FALTA, não o total da fatura.

     `inv.falta` é o total menos o que já foi pago. Somar `inv.total` contava
     inteira uma fatura de R$ 1.000 com R$ 700 já quitados — o KPI dizia que havia
     R$ 1.000 em aberto quando o débito real era R$ 300. Quem pagou parcial via o
     número não se mexer, que é o pior tipo de erro num painel: ele não parece
     errado, parece que o pagamento não entrou. */
  let openInvoices = 0;
  const emAberto = [];
  for (const card of DB.all('cards').filter(c => c.active !== false)) {
    for (const inv of DB.invoicesOf(card)) {
      if (inv.status === 'Paga') continue;
      openInvoices += inv.falta;
      emAberto.push(inv);
    }
  }
  emAberto.sort((a, b) => a.due - b.due);

  /* Quantas dessas faturas vencem dentro do ciclo — só para o subtítulo do KPI.
     `period.end` é EXCLUSIVO (é o primeiro dia do próximo ciclo), daí o `<`.

     A LISTA de vencimentos deixou de existir como seção própria: ela e "o que já
     está previsto" respondiam a mesma pergunta, e a fatura aparecia nas duas —
     medido em agosto/2026, a do C6 Carbon saía duas vezes na mesma tela. Agora a
     fatura é item da previsão do mês em que vence, com status e total na linha, e
     a que já VENCEU continua na fila de pendências do topo, que é onde ela tem
     botão de pagar. */
  const doCiclo = emAberto.filter(inv => inv.due < period.end);

  /* METAS EM VALOR, não em média de percentuais.

     A média de "50% de R$ 1.000" com "10% de R$ 100.000" dava 30% — um número que
     não corresponde a nada: nem ao dinheiro guardado, nem ao caminho percorrido.
     Somar reais responde as duas coisas de uma vez. */
  const goals = DB.all('goals').filter(g => !g.done);
  const guardadoMetas = goals.reduce((s, g) => s + Math.max(0, DB.goalTotal(g.id)), 0);
  const alvoMetas = goals.reduce((s, g) => s + (Number(g.target_amount) || 0), 0);
  // O quanto foi guardado NESTE mês, somando todas as metas: é o sinal de que o
  // plano está vivo, e o único que muda de um mês para o outro
  const aportadoMes = DB.all('goal_entries')
    .filter(e => DB.aportePago(e) && DB.inPeriod(String(e.date), period) && Number(e.amount) > 0)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

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
  /* O RODAPÉ SOMA AS BARRAS, não o gasto do mês.

     Ele mostrava `total` (o mesmo do KPI "Gasto do mês"), que não conta o
     investimento — transferência não é despesa. Só que a barra de Investimentos
     está logo acima, com o valor guardado. Medido em agosto: as barras somavam
     R$ 15.438 e o rodapé dizia "Usado R$ 12.038", uma diferença de R$ 3.400 que
     era exatamente a barra que o rodapé ignorava.

     Pior era o "Restante": subtraía um usado SEM investimento de um orçado COM
     investimento, e o resultado — R$ 3.472 — lia como "sobra para gastar" quando
     a maior parte daquilo era meta de poupança ainda não cumprida.

     Somando o que está na tela, o rodapé passa a ser conferível linha a linha.
     Gasto sem categoria fica de fora porque não tem envelope nem orçamento: ele
     aparece no KPI do mês, que é onde a pergunta é "quanto custou". */
  let usadoNasBarras = 0;
  const envInvest = DB.envelopeDeInvestimento();
  /* INVESTIMENTO se mede pelo que foi GUARDADO, não pelo que foi gasto: o aporte é
     transferência, e transferência não entra em `spentByCategory`. Sem este
     desvio, a barra do envelope ficaria eternamente em 0% e o plano de poupar
     seria a única linha do orçamento impossível de acompanhar. */
  const usadoNoEnvelope = c => (envInvest && c.id === envInvest.id
    ? DB.investidoNoPeriodo(period) : (byCat[c.id] || 0));
  /* A ORDEM sai do mesmo número que a linha mostra.
     Ordenar por `byCat` deixava Investimentos sempre no fim da lista — com 3.400
     guardados ele aparecia abaixo de envelopes de 60 reais, porque para o
     `spentByCategory` ele vale zero. Uma lista ordenada por um critério
     invisível na tela lê como lista desordenada. */
  for (const c of DB.rootCategories('Despesa').sort((a, b) => usadoNoEnvelope(b) - usadoNoEnvelope(a))) {
    const ehInvest = !!envInvest && c.id === envInvest.id;
    const spent = usadoNoEnvelope(c);
    const limite = DB.budgetOf(c.id, period);
    const ajustado = !!DB.overrideDeOrcamento(c.id, period);
    if (!limite && !spent) continue;
    usadoNasBarras += spent;          // o rodapé soma exatamente o que se vê aqui
    const pct = limite > 0 ? Math.round(spent / limite * 100) : 0;
    /* A COR SE INVERTE no investimento: 100% de um envelope de gasto é o teto
       estourando, 100% do investimento é a meta cumprida. Manter a régua padrão
       pintaria de vermelho justamente o mês em que se guardou tudo o que foi
       planejado — o oposto do que o app existe para incentivar. */
    const classeBarra = ehInvest
      ? (pct >= 100 ? 'bar-green' : 'bar-amber')
      : barClass(pct);
    // Sem detalhe por subcategoria: o valor vem dos aportes, e abrir mostraria vazio
    const detalhavel = !ehInvest && spent > 0 && DB.subcategoriesOf(c.id).length > 0;
    /* AQUI NÃO SE EDITA O ORÇAMENTO — de propósito.

       O painel existe para dizer como está o mês, e o orçamento é a régua dessa
       medida. Um botão de editar ao lado da barra vermelha põe a régua ao alcance
       de quem está justamente desconfortável com o que ela mostra, e a saída mais
       fácil passa a ser aumentar o limite até a barra ficar verde. O ajuste é
       legítimo, mas tem de ser uma decisão tomada em outro momento — por isso ele
       mora em Configurações → Categorias, dentro do envelope.

       O SELO fica: informar que o mês está ajustado é o oposto de facilitar o
       ajuste. Sem ele, um limite diferente do padrão seria um número que a pessoa
       não consegue explicar. */
    budgets += `<div class="budget-row${detalhavel ? ' clicavel' : ''}"${detalhavel ? ` data-envelope="${c.id}"` : ''}>
      <div class="budget-head"><b>${esc(c.icon)} ${esc(c.name)}${detalhavel ? ' <span class="chev-min" data-ico="chev"></span>' : ''}${
        ajustado ? ' <span class="selo-ajuste" title="orçamento ajustado neste mês">ajustado</span>' : ''}</b>
        <span class="num">${fmtShort(spent)}${limite ? ` <span class="muted">/ ${fmtShort(limite)} · ${pct}%</span>` : ''}</span></div>
      <div class="bar ${classeBarra}"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
  }

  /* Cada linha mostra o que FALTA pagar, não o total da fatura — é o número que
     vai sair da conta. Numa fatura parcial os dois aparecem, senão a linha
     contradiria o histórico: quem pagou R$ 700 de R$ 1.000 precisa ver que faltam
     R$ 300 sem perder de vista de quanto era a fatura. */
  // --- Projeção de fim de mês (run-rate) ---
  const proj = DB.projecaoDeGasto(period);
  const projPct = refLimit > 0 ? Math.round(proj.total / refLimit * 100) : 0;
  /* TAXA DE POUPANÇA SÓ QUANDO HÁ RITMO PARA PROJETAR.

     A conta é (renda − fechamento projetado) / renda. Num mês que ainda não
     começou, o "fechamento projetado" é só o que está CONTRATADO — aluguel,
     parcelas, escola. O gasto variável do mês (mercado, combustível, farmácia)
     não existe ainda, e chamar a diferença de "poupança projetada" prometia 60%
     de sobra num mês que vai consumir a maior parte disso.

     O próprio app já dizia isso em `cardPrevisaoDoMes`: "uma projeção que só
     conhece contas fixas e chama o resto de sobra seria otimista por construção".
     Este card era o lugar onde a regra estava sendo violada.

     Em mês futuro a linha desaparece e no lugar entra o que se pode afirmar: o
     quanto das receitas já está comprometido. */
  const savingsRate = income > 0 && !proj.naoComecou
    ? Math.round((income - proj.total) / income * 100) : null;
  const projCard = `
    <div class="card">
      <div class="card-head"><div><b>Projeção do mês</b><small>${proj.naoComecou
        ? 'só o que já está contratado — gasto variável ainda não entra'
        : `o que já foi, o que está agendado e ${fmtShort(proj.ritmoDiario)}/dia de gasto variável`}</small></div><span class="kpi-ico t-warning" data-ico="calendar" style="width:34px;height:34px;margin:0"></span></div>
      ${income > 0 ? `<div class="proj-row"><span>${proj.naoComecou ? 'Receitas previstas para o mês' : 'Receitas do período'}</span><b class="txt-green">${fmtShort(income)}</b></div>` : ''}
      <!-- Num mês que não começou, "gasto até hoje" e "fechamento projetado" são o
           MESMO número: não há ritmo para extrapolar, e a projeção é o próprio
           previsto. Mostrar as duas linhas repetia o valor com dois rótulos
           diferentes, o que faz o leitor procurar a diferença entre elas. Some uma
           e a que fica diz o que é. -->
      ${proj.naoComecou ? '' : `<div class="proj-row"><span>Gasto até hoje (dia ${stats.elapsedDays} de ${stats.totalDays})</span><b>${fmtShort(proj.ateHoje)}</b></div>`}
      <!-- As duas parcelas que faltam para chegar no fechamento, ditas por extenso:
           sem elas a diferenca entre "gasto ate hoje" e "fechamento" e um salto que
           so se aceita por fe. -->
      ${proj.naoComecou || !(proj.lancadoAVir + proj.naoLancado > 0.005) ? '' : `<div class="proj-row muted"><span>+ agendado para o resto do mês</span><b>${fmtShort(proj.lancadoAVir + proj.naoLancado)}</b></div>`}
      ${proj.naoComecou || !(proj.variavel > 0.005) ? '' : `<div class="proj-row muted"><span>+ gasto variável no ritmo atual</span><b>${fmtShort(proj.variavel)}</b></div>`}
      <div class="proj-row"><span>${proj.naoComecou ? 'Já comprometido no mês' : 'Fechamento projetado'}</span><b class="${refLimit > 0 && proj.total > refLimit ? 'txt-red' : 'txt-green'}">${fmtShort(proj.total)}</b></div>
      ${refLimit > 0 ? `
        <div class="bar ${barClass(projPct)}" style="margin:var(--e2) 0 var(--e1)"><i style="width:${Math.min(100, projPct)}%"></i></div>
        <div class="proj-row muted"><span>${projPct}% ${income > 0 ? 'das receitas do período' : 'do orçamento total'} (${fmtShort(refLimit)})</span>
        ${savingsRate !== null ? `<span>Poupança projetada: <b class="${savingsRate >= 20 ? 'txt-green' : savingsRate >= 0 ? 'txt-amber' : 'txt-red'}">${savingsRate}%</b></span>` : ''}</div>
        ${proj.naoComecou ? `<p class="muted" style="margin-top:var(--e2)">Sobrariam <b>${fmtShort(Math.max(0, income - proj.total))}</b> para o gasto variável do mês — mercado, transporte e o que mais aparecer. Não é sobra.</p>` : ''}
      ` : `<p class="muted" style="margin-top:var(--e2)">Cadastre a renda familiar em Configurações → Membros &amp; ciclo para ver % da renda e taxa de poupança (especialistas recomendam poupar ≥ 20%).</p>`}
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
    /* A LINHA DE POUPANÇA É RESÍDUO: 100 − necessidades − desejos. Num mês que
       ainda não começou, necessidades e desejos contêm só o que está contratado, e
       o resíduo vira uma poupança generosa que ninguém prometeu — o mesmo engano
       da "Poupança projetada". Em mês futuro ela sai, e o cabeçalho diz que os
       percentuais são do previsto, não do realizado. */
    const futuro5030 = DB.inicioISO(period) > DB.hojeISO();
    rule5030 = `
      <div class="card">
        <div class="card-head"><div><b>Regra 50 · 30 · 20</b><small>${futuro5030
          ? 'do que já está contratado — o variável do mês ainda não entra'
          : 'necessidades, desejos e poupança como % da renda'}</small></div></div>
        ${row('Necessidades', nPct, 50, nPct > 50 ? 'bar-red' : 'bar-green')}
        ${row('Desejos', wPct, 30, wPct > 30 ? 'bar-red' : 'bar-green')}
        ${futuro5030 ? '' : row('Poupança (sobra)', sPct, 20, sPct < 20 ? 'bar-amber' : 'bar-green')}
      </div>`;
  }

  /* O horizonte de seis meses, para os KPIs. Calculado uma vez e reusado: são
     seis chamadas a `previsaoDoMes`, e cada cartão pedindo a sua repetiria a
     conta com risco de os números divergirem entre si na mesma tela. */
  const futuro6 = DB.horizonte(6);

  const futuroMes = (state.monthOffset || 0) > 0;

  // --- Reserva de emergência (cobertura em meses) ---
  const reserve = DB.reserveTotal();
  /* Custo de VIDA, não gasto médio cru: a reserva mede quantos meses se aguenta
     sem renda, e o investimento — que entra na média — é a primeira coisa que
     para nessa situação. Ver DB.custoDeVidaMensal. */
  const avgSpend = DB.custoDeVidaMensal();
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
        <div class="bar ${coverage >= 6 ? 'bar-green' : coverage >= 3 ? 'bar-amber' : 'bar-red'}" style="margin:var(--e2) 0 var(--e1)"><i style="width:${covPct}%"></i></div>
        <p class="muted">Recomendação clássica: 3 a 6 meses do custo de vida (${fmtShort(avgSpend)}/mês)${faltaReserva > 0 ? ` — faltam <b>${fmtShort(faltaReserva)}</b>` : ' — objetivo alcançado 🎉'}.</p>
        ${previsaoDaReserva(reserveGoal, faltaReserva)}
        <div class="btn-row">
          <button class="btn ghost" data-aporte="${reserveGoal.id}">＋ Guardar dinheiro</button>
          <button class="btn ghost" data-goal-detail="${reserveGoal.id}">Ver depósitos</button>
        </div>
      `}
    </div>`;

  // --- Conselheiro: insights automáticos por regras de especialista ---
  const tips = [];
  /* O ALERTA É SOBRE O FIM DO MÊS, não sobre o saldo de hoje contra o mês inteiro.
     "Compromissos superam o saldo em R$ 10.254" aparecia em 2 de agosto num mês que
     fecha com R$ 5.799 sobrando: comparava o comprometido do mês inteiro com um
     saldo de antes do salário. É o mesmo engano que o hero já tinha deixado para
     trás, e o Conselheiro tinha ficado com ele. */
  const fimDoCiclo = DB.fimISO(period);
  const sobraAoFim = DB.saldoPrevistoNaData(null, fimDoCiclo) - DB.guardadoPrevisto(fimDoCiclo);
  if (sobraAoFim < 0) tips.push({ cls: 'red', txt: `Do jeito que está, o mês fecha ${fmtShort(-sobraAoFim)} no vermelho depois do que já tem dono — priorize quitar ou remanejar.` });

  /* O VALE DE CAIXA vem primeiro depois do saldo, porque é o único alerta sobre
     UMA DATA. Fechar o mês no azul não impede o boleto do dia 12 de não passar, e
     nenhuma tela respondia isso. Só no mês corrente: navegar para março não muda
     o risco de amanhã, e repetir o aviso em todo mês o transformaria em paisagem. */
  if (state.monthOffset === 0) {
    const vale = DB.valeDeCaixa(3);
    const quandoVale = fmtDay(vale.data);
    if (vale.valor < 0) {
      tips.push({ cls: 'red', txt: `O saldo previsto fica NEGATIVO em ${quandoVale}: ${fmtShort(vale.valor)}${
        vale.negativos > 1 ? ` (${vale.negativos} dias no vermelho nos próximos 3 meses)` : ''}. Antecipe uma entrada ou adie uma conta.` });
    } else if (vale.valor < (avgSpend / 30) * 7 && avgSpend > 0) {
      tips.push({ cls: 'amber', txt: `O dia mais apertado dos próximos 3 meses é ${quandoVale}, com ${fmtShort(vale.valor)} em conta — menos de uma semana de folga.` });
    }
  }

  /* VIGIA DOS CONTRATOS. O gerador criou uma parcela do Fiat 500 duas vezes e quem
     percebeu foi o dono da casa, no olho, um mês depois — R$ 1.560 a mais de
     comprometido. Com 11 contratos rodando sozinhos, isso é manutenção. */
  for (const d of DB.duplicatasDeContrato(period)) {
    tips.push({ cls: 'red', txt: `"${d.descricao}" aparece ${d.quantas}× neste mês, mesmo valor de ${fmtShort(d.valor)} — confira se o contrato lançou repetido.` });
  }
  for (const it of DB.contratosAtrasados(period)) {
    tips.push({ cls: 'amber', txt: `"${it.titulo}" era esperado em ${fmtDay(it.data)} e não foi lançado — o contrato pode ter falhado.` });
  }
  for (const c of DB.rootCategories('Despesa')) {
    // O limite DESTE ciclo: alertar contra o padrão num mês ajustado seria acusar
    // estouro de um teto que a própria pessoa já corrigiu
    const limiteC = DB.budgetOf(c.id, period);
    if (!limiteC) continue;
    const pct = Math.round((byCat[c.id] || 0) / limiteC * 100);
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
        <div class="muted" style="font-size:11.5px">${period.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} a ${fimExibido.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}${atual ? ` · dia ${stats.elapsedDays} de ${stats.totalDays}` : state.monthOffset > 0 ? ' · ainda não chegou' : ' · encerrado'}</div>
      </div>
      <button id="mn-next" aria-label="Próximo mês" data-ico="chevR" ${state.monthOffset >= 6 ? 'disabled style="opacity:.35"' : ''}></button>
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

  /* MÊS FUTURO tem hero próprio. Antes caía no de mês encerrado e mostrava
     "Resultado de setembro: R$ 0,00" — o mês não aconteceu, então não há resultado
     nenhum, e o zero lia como "vai sobrar nada" em vez de "ainda não há dado".

     O número aqui é o saldo PROJETADO ao fim daquele mês, rolando de mês em mês a
     partir de hoje: um mês negativo no meio contamina os seguintes, e é isso que
     olhar mês a mês, isolado, não mostra. */
  const previsto = DB.previsaoDoMes(period);
  /* A CONTA DO MÊS QUE AINDA NÃO CHEGOU, por extenso.

     O hero antigo dava o número final e três colunas soltas — Entradas 17.831,
     Saídas 15.529, Resultado 2.302 — que não fechavam com ele: o valor grande era
     2.593. Quem tentasse conferir desistia, e "um número que não se confere não
     serve para decidir nada" vale dentro da própria tela.

     Agora são as mesmas linhas do hero do mês corrente, contando o mês inteiro:
     onde ele ABRE, o que ACONTECE, onde CHEGA em caixa, e quanto daquilo já tem
     dono. O número grande passou a ser o RESULTADO da conta — antes vinha de
     `previsaoMeses`, por outro caminho, e as duas contas só coincidiam por acaso
     num mês em que o corrente não tinha nada previsto.

     INVESTIMENTO NÃO É SAÍDA. O aporte não muda "em contas ao fim" (o dinheiro
     continua na família, só trocou de bolso) e muda "livre ao fim" (ganhou dono).
     Por isso ele não aparece em "Contas do mês" e sim dentro do "Guardado". */
  const inicioP = DB.inicioISO(period), fimP = DB.fimISO(period);
  const abreEmContas = DB.saldoPrevistoNaData(null, inicioP);
  const emContasFim = DB.saldoPrevistoNaData(null, fimP);
  const guardadoFim = DB.guardadoPrevisto(fimP);
  /* "DISPONÍVEL", não "saldo": desconta o que já tem dono, exatamente como o hero
     do mês corrente. Chamá-lo de saldo o faria divergir do saldo que o extrato do
     mesmo mês mostra no topo — e dois números com o mesmo nome e valores
     diferentes destroem a confiança nos dois. O extrato mostra CAIXA; aqui é
     PLANEJAMENTO. É a linha "Em contas ao fim" que faz a ponte entre eles. */
  /* O DINHEIRO DOS FILHOS sai do livre porque ja tem outro dono. Ver DB.dosFilhos:
     nao entra no guardado de proposito — guardado e dinheiro da familia com plano, e
     alimenta a cobertura da reserva de emergencia. */
  const dosFilhosFim = DB.dosFilhos() + DB.dosFilhosAVir(fimP);
  const livreAoFim = emContasFim - guardadoFim - dosFilhosFim;
  const noAzul = livreAoFim >= 0;
  /* Em MÊS FUTURO os KPIs mudam de pergunta: o número grande passa a ser onde se
     CHEGA e o sub-rótulo diz de onde se parte. Sem isso a tela mostrava o saldo de
     hoje e o guardado de hoje enquanto o hero, logo acima, falava do fim do mês.

     A fatura sai dos itens da própria previsão, então ela é uma parcela VISÍVEL da
     linha "Contas do mês" do hero — os dois números se explicam um ao outro. */
  const faturasDoMes = previsto.itens.filter(i => i.origem === 'fatura')
    .reduce((s, i) => s + i.valor, 0);
  const nFaturasDoMes = previsto.itens.filter(i => i.origem === 'fatura').length;
  /* MESMA BASE do número de hoje: o KPI soma as metas ATIVAS, reserva incluída
     (é a variável `guardadoMetas` daqui, não a `DB.guardadoMetas()`, que exclui a
     reserva). Somar os aportes agendados sobre outra base faria o cartão saltar de
     valor ao virar o mês — medido: mostrava R$ 0,00 em agosto contra R$ 134 em
     julho, porque o aporte planejado é para a reserva. */
  const metasAoFim = guardadoMetas + DB.aportesAgendadosAte(fimP);
  const heroFuturo = `
    <div class="hero hero-${noAzul ? 'green' : 'red'}">
      <div class="hero-top">
        <span class="hero-label">Disponível previsto ao fim de ${esc(period.label)}</span>
        <span class="hero-badge b-${noAzul ? 'green' : 'red'}">${noAzul ? 'No azul' : 'Aperto'}</span>
      </div>
      <div class="hero-value">${fmt(livreAoFim)}</div>
      <p class="hero-msg">${previsto.itens.length
        ? `Projeção com ${previsto.itens.length} item(ns) já conhecido(s) — contas fixas, repetições e faturas. Gasto variável não entra nesta conta.`
        : 'Nada previsto para este mês ainda. Contas que se repetem e faturas apareceriam aqui.'}</p>
      <div class="hero-conta">
        ${linhasDaPrevisao({
          abreRotulo: 'Abre em contas', abreNota: `em ${fmtDate(new Date(inicioP + 'T12:00:00'))}`,
          abre: abreEmContas, previsto, atrasado: DB.pendenteDeCiclosAnteriores(period),
          emContasFim, guardadoFim, dosFilhos: dosFilhosFim, dosFilhosAgora: DB.dosFilhos(), livreAoFim,
        })}
      </div>
      <!-- A ponte com o Extrato continua dita por escrito, mas agora ela aponta
           para um número que está na própria conta acima (linha 4), em vez de
           pedir que se acredite numa diferença que não aparecia em lugar nenhum. -->
      <p class="hero-depois">Em conta haverá <b>${fmt(emContasFim)}</b> — é o saldo que o extrato de ${esc(period.label)} mostra.${
        Math.abs(emContasFim - livreAoFim) > 0.005
          ? ` A diferença de ${fmt(Math.abs(emContasFim - livreAoFim))} é o que já tem destino.` : ''}</p>
    </div>`;

  /* O MÊS CORRENTE EM DOIS BLOCOS.

     O hero antigo respondia uma pergunta só — "quanto posso assumir agora" — e o
     número dela, em 1º de agosto, era −R$ 10.097,59: o comprometido do mês inteiro
     contra o saldo de um dia em que o salário ainda não caiu. Verdadeiro como
     conceito e inútil como leitura, porque a pessoa fecha o mês com dinheiro.

     Agora o topo responde ONDE SE CHEGA e a tela se abre em dois:

       HOJE      — o caixa de verdade: o que existe, o que já tem dono, o que
                   sobra para gastar sem encostar na reserva.
       PREVISTO  — o mês rolando até o fim, com as mesmas linhas do mês futuro.

     "Investido" saiu. No uso real ele e o "Guardado" são o mesmo dinheiro — a
     reserva mora na conta de investimento —, então mostrar os dois era exibir o
     mesmo valor duas vezes com nomes diferentes. `DB.saldoInvestido` continua
     existindo para o dia em que houver investimento que não seja meta; hoje quem
     responde "quanto tenho livre na conta" é a linha "Livre para gastar hoje".

     O COMPROMETIDO não sumiu: virou "Contas do mês" no bloco previsto, que é a
     mesma dívida vista pelo lado certo — junto do dinheiro que entra para pagá-la,
     em vez de descontada de um saldo que ainda não recebeu a receita do mês. */
  const fimCicloAtual = DB.fimISO(period);
  const ultimoDiaCiclo = new Date(Date.parse(fimCicloAtual + 'T12:00:00') - 86400000);
  const atrasadoAtual = DB.pendenteDeCiclosAnteriores(period);
  const emContasFimAtual = DB.saldoPrevistoNaData(null, fimCicloAtual);
  const guardadoFimAtual = DB.guardadoPrevisto(fimCicloAtual);
  const dosFilhosFimAtual = DB.dosFilhos() + DB.dosFilhosAVir(fimCicloAtual);
  const livreAoFimAtual = emContasFimAtual - guardadoFimAtual - dosFilhosFimAtual;
  const fechaNoAzul = livreAoFimAtual >= 0;
  /* O NÚMERO GRANDE CONTINUA SENDO O LANÇADO — firme, sem estimativa. O gasto
     variável entra na última linha da conta, e o SELO é quem avisa quando ele
     derruba o mês: trocar o protagonista por uma faixa poria uma estimativa no
     lugar mais visível do app, e trocar a cor do hero inteiro daria ao palpite o
     peso de um fato. O selo âmbar diz "olhe a última linha" sem mentir sobre
     qual dos dois números é medido. */
  const varAtual = DB.variavelProjetado(period);
  const varMaior = Math.max(varAtual.contido, varAtual.ritmo);
  const derrubaNoVariavel = fechaNoAzul && varMaior > 0.005 && livreAoFimAtual - varMaior < 0;
  const heroAtual = `
    <div class="hero hero-${fechaNoAzul ? 'green' : 'red'}">
      <div class="hero-top">
        <span class="hero-label">Disponível previsto ao fim de ${esc(period.label)}</span>
        <span class="hero-badge b-${derrubaNoVariavel ? 'amber' : fechaNoAzul ? 'green' : 'red'}">${
          derrubaNoVariavel ? 'Aperto no variável' : fechaNoAzul ? 'No azul' : 'Aperto'}</span>
      </div>
      <div class="hero-value">${fmt(livreAoFimAtual)}</div>
      <p class="hero-msg">${previsto.itens.length
        ? `Projeção com ${previsto.itens.length} item(ns) já conhecido(s) — contas fixas, repetições e faturas.${
          varMaior > 0.005 ? ' O gasto variável estimado está na última linha da conta.' : ' Gasto variável não entra nesta conta.'}`
        : 'Nada previsto para o resto do mês. Contas que se repetem e faturas apareceriam aqui.'}</p>

      <!-- BLOCO 1 — o caixa de hoje. Três linhas, nenhuma projeção: é o dinheiro
           que existe neste minuto. "Livre para gastar hoje" é o DB.caixaLivre(),
           o mesmo número que dispara a pergunta de resgate ao salvar um gasto. -->
      <div class="hero-conta">
        <div class="hc-cab">Hoje <i>dia ${stats.elapsedDays} de ${stats.totalDays}</i></div>
        <div class="hc-l"><span>Em contas</span><b>${fmt(saldo)}</b></div>
        ${guardado > 0.005 ? `<div class="hc-l"><span>− Guardado${
          guardadoReserva > 0.005 ? ` <i>reserva ${fmtShort(guardadoReserva)}</i>` : ''}</span><b>${fmt(guardado)}</b></div>` : ''}
        <div class="hc-l hc-sub"><span>= Livre para gastar hoje</span><b>${fmt(saldo - guardado)}</b></div>
      </div>

      <!-- BLOCO 2 — para onde isso vai até o fim do ciclo. Mesmas linhas do hero
           de mês futuro, pelo mesmo código: navegar para setembro passa a mudar
           só os números, não a forma da tela. -->
      <div class="hero-conta">
        <div class="hc-cab">Previsto <i>até ${fmtDate(ultimoDiaCiclo)}</i></div>
        ${linhasDaPrevisao({
          abreRotulo: 'Em contas hoje', abreNota: '',
          abre: saldo, previsto, atrasado: atrasadoAtual,
          emContasFim: emContasFimAtual, guardadoFim: guardadoFimAtual, dosFilhos: dosFilhosFimAtual, dosFilhosAgora: DB.dosFilhos(), livreAoFim: livreAoFimAtual,
          /* Só no mês corrente: um mês que ainda não começou não tem ritmo para
             extrapolar, e um encerrado não tem o que projetar. `variavelProjetado`
             devolve zero nos dois casos, e as linhas somem sozinhas. */
          variavel: varAtual,
        })}
      </div>
      <!-- Sem a frase-ponte "em conta haverá X" que o hero de mês futuro traz: aqui
           os dois números — "Em contas ao fim" e "Livre ao fim" — estão em linhas
           vizinhas, à vista. Repeti-los em prosa acrescentaria um terceiro
           parágrafo a um hero que já tem dois blocos, e disputaria o lugar do
           resumo do mês seguinte, que vem logo abaixo. -->
      ${resumoDoProximoMes()}
    </div>`;

  /* ---------- A ORDEM DO PAINEL, EM UMA COLUNA ----------

     Chegou a existir aqui uma divisão em duas colunas (ação à esquerda, números
     à direita). Foi desfeita: com o conteúdo que este painel tem, a coluna
     estreita ficava com o conselheiro sozinho ao lado de uma coluna três vezes
     mais alta, e — pior — abaixo do ponto de corte as duas viravam uma pilha na
     ordem dos wrappers, jogando o conselheiro e a fila na frente do saldo. O
     cartão de configuração aparecia depois deles, longe do topo.

     A ordem abaixo é a leitura pretendida, e ela é linear: o que falta
     configurar, o que precisa de ação, o saldo, o que ele implica, e só então a
     análise. Quem quiser duas colunas de novo precisa de widgets próprios para a
     segunda — não de uma fatia desta. */
  return `
    ${setupCard}
    ${atual ? filaDePendencias() : ''}
    ${atual ? filaDasCriancas() : ''}
    ${periodBar}
    ${atual ? heroAtual : state.monthOffset > 0 ? heroFuturo : heroFechado}
    ${atual ? avisoDeAperto() : ''}
    ${adviceCard}
    <!-- KPIs: cada um responde "como estou" E "para onde isso vai".

         Os quatro falavam só do presente — gasto do mês, faturas, saldo, metas —
         enquanto o app já sabia o saldo projetado de seis meses e não o mostrava
         em lugar nenhum do Painel. Agora cada cartão traz a leitura de hoje no
         número grande e o horizonte na linha de baixo, que é onde a decisão mora:
         saldo de R$ 426 é uma informação; "no pior ponto dos próximos 6 meses,
         R$ 6.128 em agosto" é outra.

         Trocado "Metas (média)" por RESERVA EM MESES: a média de percentuais de
         metas com alvos diferentes soma coisas que não se somam, e o número que
         de fato mede segurança financeira é quantos meses a reserva cobre. As
         metas continuam nos Relatórios, uma a uma. -->
    <div class="kpi-grid">
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmt(total)}</div><div class="kpi-label">${
        futuroMes ? 'Gasto previsto' : 'Gasto do mês'}</div><div class="kpi-sub">${
        futuroMes
          ? `${previsto.itens.length} item(ns) conhecido(s) · variável não entra`
          : futuro6.mediaSaida > 0
            ? `${txs.length} lançamentos · ~${fmtShort(futuro6.mediaSaida)}/mês à frente`
            : `${txs.length} lançamentos`}</div></div>
      <!-- Em mês futuro, a fatura que importa é a que VENCE nele. O total em
           aberto de hoje somaria também a que venceu em julho — um número que não
           pertence ao mês que está na tela. -->
      <div class="card kpi"><span class="kpi-ico t-danger" data-ico="invoice"></span><div class="kpi-value ${
        (futuroMes ? faturasDoMes : openInvoices) ? 'red' : 'green'}">${fmt(futuroMes ? faturasDoMes : openInvoices)}</div><div class="kpi-label">${
        futuroMes ? 'Faturas do mês' : 'Faturas em aberto'}</div><div class="kpi-sub">${
        futuroMes
          ? `${nFaturasDoMes} fatura(s) vencem em ${esc(period.label)}`
          : `${emAberto.length} fatura(s)${doCiclo.length && doCiclo.length !== emAberto.length
            ? ` · ${doCiclo.length} até o fim do mês` : ''}`}</div></div>
      <!-- SALDO: em mês futuro o número é onde se CHEGA, e o sub diz de onde se
           parte. O "pior ponto" do horizonte sai — ele é medido a partir de hoje,
           e dentro de agosto "pior ponto em Agosto" lê como se fosse do próprio
           mês exibido, o que é ruído. -->
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value ${
        (futuroMes ? emContasFim : saldo) < 0 ? 'red' : 'green'}">${fmt(futuroMes ? emContasFim : saldo)}</div><div class="kpi-label">${
        futuroMes ? 'Saldo previsto' : 'Saldo em contas'}</div><div class="kpi-sub">${
        futuroMes
          ? `ao fim de ${esc(period.label)} · hoje ${fmtShort(saldo)}`
          : futuro6.temDados
            ? `pior ponto <b class="${futuro6.pior < 0 ? 'txt-red' : 'txt-green'}">${fmtShort(futuro6.pior)}</b> em ${esc(futuro6.piorMes)}`
            : `${contas.length} conta(s)`}</div></div>
      <!-- METAS em números absolutos, não em média de percentuais: metas com
           alvos diferentes não se somam por porcentagem. "R$ 134 de R$ 100.000"
           diz onde se está; "0%" não diz nada além de "no começo".

           Em mês futuro mostra o que TERÁ, não o que tem: quem planejou guardar
           quer saber onde chega com o plano cumprido. A cobertura da reserva saiu
           daqui porque ela tem card próprio, com previsão de quando fica pronta. -->
      <div class="card kpi"><span class="kpi-ico t-info" data-ico="target"></span><div class="kpi-value">${
        fmt(futuroMes ? metasAoFim : guardadoMetas)}</div><div class="kpi-label">Guardado em metas</div><div class="kpi-sub">${
        futuroMes
          ? `ao fim do mês · hoje ${fmtShort(guardadoMetas)}${
            metasAoFim - guardadoMetas > 0.005 ? ` · +${fmtShort(metasAoFim - guardadoMetas)} agendado` : ''}`
          : alvoMetas > 0
            ? `de ${fmtShort(alvoMetas)} · ${goals.length} meta(s)${aportadoMes > 0.005 ? ` · ${fmtShort(aportadoMes)} este mês` : ''}`
            : `${goals.length} meta(s) em andamento`}</div></div>
    </div>
    <!-- Primeira linha: o que já está guardado, o que o mês vai fechar e como a
         renda se divide. As três perguntas de "estamos bem?", lado a lado — juntas
         elas se leem de uma vez; empilhadas, exigem rolar e a comparação se perde.
         A regra 50·30·20 sai quando não há renda cadastrada, e aí a linha se
         reorganiza em duas colunas em vez de deixar uma coluna fantasma. -->
    <div class="grid-3">
      ${reserveCard}
      ${projCard}
      ${rule5030}
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Evolução dos gastos</b><small>6 períodos até ${esc(period.label)}${income > 0 ? ' · linha tracejada = renda' : ''}</small></div></div>
        <!-- A janela termina no mês EXIBIDO, não em hoje. Ancorada em hoje, o
             gráfico ficava idêntico em qualquer mês que se navegasse — e o mês que
             se está olhando não aparecia nele. Medido: em agosto e em setembro a
             série vinha igual à de julho, soma 53.653 nas três. -->
        ${svgBars(
          Array.from({ length: 6 }, (_, i) => {
            const p = DB.monthPeriod(period.start, i - 5);
            const v = DB.expensesOf(p).reduce((s, t) => s + (Number(t.amount) || 0), 0);
            return { label: p.start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), value: v, hint: i === 5 ? '#009ef7' : '#a6d9f7' };
          }), income)}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Ritmo do mês</b><small>gasto acumulado vs. trilha ideal do ${income > 0 ? 'da renda' : 'orçamento'}</small></div></div>
        ${svgBurnup(period, refLimit)}
        <p class="muted" style="margin-top:var(--e1)">Se a linha azul cruzar a tracejada antes do fim do mês, o limite estoura.</p>
      </div>
    </div>
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
          <span>Usado <b>${fmtShort(usadoNasBarras)}</b></span>
          <span>Restante <b class="${budgetTotal - usadoNasBarras >= 0 ? 'txt-green' : 'txt-red'}">${fmtShort(budgetTotal - usadoNasBarras)}</b></span>
        </div>
        ${notaDoInvestimento(envInvest, period, budgetTotal - usadoNasBarras, usadoNoEnvelope)}` : ''}
      </div>
    </div>
    ${secaoDoQueAindaVem(period, previsto)}
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
  cada('categorias', v => (v === '_sem' ? 'Sem categoria' : DB.categoryPath(v) || 'Categoria'));
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
/* O teste de um lançamento contra os filtros, sem período.

   Extraído para os Relatórios poderem aplicar o MESMO recorte em qualquer janela
   de tempo — inclusive nos 12 meses de histórico. Se o mês atual fosse filtrado
   por "Alimentação" e a mediana viesse do gasto total, o app compararia
   Alimentação contra tudo e diria "acima do normal" sem que nada estivesse
   acima: o erro estatístico mais grave que esta tela poderia cometer. */
function passaNosFiltros(t, ignorarJanela) {
  const f = state.filtros || filtrosVazios();
  const busca = DB._semAcento(f.busca);
  // Lista vazia é "todos": o filtro só restringe depois que alguém escolhe algo
  const algum = (lista, valor) => !lista || !lista.length || lista.includes(valor);
  return (t => {
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
      /* `_sem` casa o que não tem categoria — inclusive o que aponta para uma
         categoria que foi apagada depois, e aí `categoryRootId` não resolve. Sem
         essa segunda parte o lançamento ficaria invisível nos dois filtros: não
         aparece em categoria nenhuma e também não aparece em "sem categoria". */
      const semCategoria = !t.category_id || !DB.get('categories', t.category_id);
      if (!f.categorias.some(id => (id === '_sem'
        ? semCategoria
        : id === t.category_id || id === raiz))) return false;
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
    /* "Recorrente" passou a ser o VÍNCULO com o contrato, não a marca antiga:
       com o contrato como fonte única de repetição, filtrar por `recurring`
       devolveria lista vazia numa base onde ninguém mais usa a marca. */
    if (f.recorrente && !t.recurrence_id) return false;
    if (busca) {
      const alvo = DB._semAcento([
        t.description, t.notes, t.member, t.method, t.installment,
        DB.categoryPath(t.category_id), DB.tagsOf(t).join(' '),
      ].join(' '));
      if (!alvo.includes(busca)) return false;
    }
    return true;
  })(t);
}

function txsFiltradas(period, ignorarJanela) {
  return DB.txOfPeriod(period)
    .filter(t => passaNosFiltros(t, ignorarJanela))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Há algum filtro ativo? (a janela de dias não conta: ela é do extrato)
function temFiltroAtivo() {
  const f = state.filtros || filtrosVazios();
  return !!(f.busca || f.valorMin || f.valorMax || f.recorrente
    || ['scope', 'membro', 'tipo', 'situacao', 'categorias', 'tags', 'metodos', 'contas']
      .some(k => (f[k] || []).length));
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
  /* "Sem categoria" primeiro, e não em ordem alfabética: é a opção que se procura
     depois de importar um OFX, quando o trabalho é justamente achar o que ficou
     sem classificar. Enterrada no meio das categorias ela não seria encontrada.

     `_sem` é a mesma sentinela que os relatórios já usam para agrupar o que não
     tem categoria — não é um id novo, e não colide com id de categoria, que é uuid. */
  // `grupo: true` já dá o destaque visual (classe e-grupo) — sem travessão no
  // texto, que apareceria também no rótulo da pílula quando selecionada
  const ops = [{ v: '_sem', l: 'Sem categoria', grupo: true }];
  for (const raiz of DB.rootCategories().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
    const filhas = DB.subcategoriesOf(raiz.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    ops.push({ v: raiz.id, l: `${raiz.icon} ${raiz.name}`, grupo: true });
    for (const fi of filhas) ops.push({ v: fi.id, l: fi.name, filha: true });
  }
  return ops;
}

/* A barra de pílulas, compartilhada pelo Extrato e pelos Relatórios. Um filtro
   só, um lugar só de manutenção — e o mesmo vocabulário nas duas telas: quem
   aprendeu a filtrar num lugar não reaprende no outro. */
function barraDePilulas() {
  const f = state.filtros || filtrosVazios();
  return `<div class="ext-pilulas" id="ext-pilulas">
    <!-- O rótulo vai num <span> próprio: text-overflow não funciona em contêiner
         flex, e sem ele o texto longo era cortado no seco, sem reticências. -->
    <button class="pilula pilula-busca${f.busca ? ' on' : ''}" data-pilula="busca">
      <span data-ico="search"></span><span class="pilula-rot">${f.busca ? esc(f.busca) : 'Buscar'}</span>
    </button>
    ${pilulasDeFiltro().map(p => {
      const n = (f[p.chave] || []).length;
      return `<button class="pilula${n ? ' on' : ''}" data-pilula="${p.chave}"><span class="pilula-rot">${esc(rotuloPilula(p))}</span>${
        n ? '<i class="pilula-x" data-limpa-pilula="' + p.chave + '">×</i>' : '<span class="pilula-seta"></span>'}</button>`;
    }).join('')}
    <button class="pilula${f.valorMin || f.valorMax || f.recorrente ? ' on' : ''}" data-pilula="mais"><span class="pilula-rot">Mais</span><span class="pilula-seta"></span></button>
    ${temFiltroAtivo() ? '<button class="pilula pilula-limpar" id="limpar-filtros">Limpar</button>' : ''}
  </div>`;
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
  if (!dias.length) return [];

  /* DEPOIS DE HOJE, A LINHA SEGUE O QUE ESTÁ AGENDADO.

     Sem isto ela só conhecia o que já foi pago — e mês corrente e mês futuro são
     feitos justamente do que ainda vai acontecer. Medido: agosto virava uma reta
     de 31 pontos com UM valor (R$ 231,35) enquanto o cartão logo acima anunciava
     R$ 9.333,63 no fim; setembro, uma reta de 30 pontos. O rótulo de acessibilidade
     dizia "de X a Y" com um Y que a linha nunca alcançava.

     Vem de DB.previstoPorDia, a mesma varredura que compõe o saldo previsto do
     cartão — por isso a ponta da linha cai exatamente no número ao lado dela. */
  const hoje = DB.hojeISO();
  const fimJanela = somarDias(dias[dias.length - 1], 1);
  const previsto = DB.previstoPorDia(contas, fimJanela);
  /* O VENCIDO não tem lugar natural na linha: a data dele já passou, e o passado
     da série é fato — mexer ali seria reescrever o que aconteceu. Ele entra de uma
     vez no primeiro dia ainda por vir, que é quando pode sair.

     Só quando a janela COMEÇOU no passado. Se ela ainda vai começar, o vencido já
     está dentro do saldo de abertura e somá-lo aqui contaria o mesmo dinheiro duas
     vezes — os dias anteriores à janela nem chegam a ser lidos, então o recorte
     dessa varredura não precisa ser outro. */
  let atrasado = 0;
  if (dias[0] <= hoje) {
    for (const [d, m] of Object.entries(previsto)) if (d <= hoje) atrasado += m.entra - m.sai;
  }

  let acumulado = Number(anterior) || 0;
  let primeiroFuturo = true;
  const ultimo = dias.length - 1;
  return dias.map((d, i) => {
    acumulado += (delta[d] || 0);
    if (d > hoje) {
      if (primeiroFuturo) { acumulado += atrasado; primeiroFuturo = false; }
      const m = previsto[d];
      if (m) acumulado += m.entra - m.sai;
    } else if (i === ultimo && d === hoje) {
      /* A JANELA QUE ACABA HOJE — o último dia do ciclo.

         Não existe "primeiro dia por vir" dentro dela, e sem este ramo o vencido
         e o que vence hoje sem estar pago sumiam da linha: no dia 31 a curva
         parava no saldo realizado enquanto o cartão logo acima anunciava o saldo
         PREVISTO do fechamento, que conta os dois. Medido no cenário da suíte:
         linha em R$ 17.000 contra R$ 16.550 escritos ao lado.

         É o mesmo defeito que fazia a linha virar reta, só que numa borda que só
         aparece um dia por mês — e a suíte não o via porque nunca rodava nesse
         dia. O ponto de hoje é, aqui, também o fechamento que o cartão nomeia:
         enquanto o ciclo não fecha, o número dele é previsto. */
      acumulado += atrasado;
    }
    return acumulado;
  });
}

/* Saldo dia a dia no resumo do extrato.

   Escala pelo intervalo dos dados, não a partir do zero: com saldo de R$ 14 mil,
   ancorar no zero achataria a linha num traço reto e a variação — que é o que o
   gráfico existe para mostrar — sumiria. É o padrão do sparkline, e é seguro aqui
   porque as duas pontas vêm escritas por extenso logo acima.

   Sparkline: sem eixos, sem grade, sangrando até a borda do cartão. É o padrão do
   Metronic (card-body p-0) e o que separa um gráfico desenhado de um gráfico
   encaixotado — aqui o número não é o herói, quem carrega o peso visual é a curva.

   A dica é própria porque tem de responder três coisas de uma vez: onde o saldo
   estava naquele dia, quanto entrou e quanto saiu. A nativa mostraria só a série
   desenhada, que é o saldo — e saldo sem o movimento do dia não explica o degrau. */
function sparkArea(vals, dias, porDia, corte) {
  const n = vals.length;
  if (n < 2) return '';
  const rotulos = (dias || vals.map((_, i) => String(i + 1)));
  const min = Math.min(...vals), max = Math.max(...vals);

  /* DUAS LINHAS, porque a curva muda de natureza no meio: até hoje ela é FATO,
     daí em diante é projeção. Desenhar tudo com o mesmo traço fazia o previsto
     passar por extrato — e o previsto é a parte que pode não acontecer.

     `corte` é o índice do último dia já realizado. Elas se tocam nesse ponto (ele
     entra nas duas séries): sem isso haveria um buraco de um dia entre as duas
     metades, e a linha pareceria interrompida em vez de continuada.

     Mês encerrado tem só a série cheia, e mês que ainda não chegou só a
     tracejada — nesses casos não há emenda para desenhar. */
  const inteiros = a => a.map(v => (v === null ? null : Math.round(Number(v) || 0)));
  const temRealizado = corte >= 0, temPrevisto = corte === undefined ? false : corte < n - 1;
  const series = [];
  if (!temRealizado && !temPrevisto) series.push({ name: 'saldo', data: inteiros(vals) });
  else {
    if (temRealizado) series.push({ name: 'saldo', data: inteiros(vals.map((v, i) => (i <= corte ? v : null))) });
    if (temPrevisto) series.push({ name: 'previsto', data: inteiros(vals.map((v, i) => (i >= corte ? v : null))) });
  }
  const cores = series.map(s => (s.name === 'previsto' ? clarear(Graficos.cor.azul, .42) : Graficos.cor.azul));
  // Tracejado no previsto: é a convenção que dispensa legenda num gráfico de 130px
  const tracos = series.map(s => (s.name === 'previsto' ? 5 : 0));

  const alt = 100;
  return Graficos.novo({
    chart: {
      type: 'area', height: alt, fontFamily: 'inherit', toolbar: { show: false },
      // sparkline apaga eixos, grade e as margens internas de uma vez
      sparkline: { enabled: true },
      animations: { enabled: true, easing: 'easeout', speed: 320 },
    },
    series,
    colors: cores,
    stroke: { curve: 'smooth', width: 2.5, dashArray: tracos },
    /* Degradê que apaga para baixo. Lavagem chapada vira bloco e briga com a
       linha; o degradê dá volume e devolve o branco do cartão embaixo, que é o
       que faz o gráfico assentar em vez de flutuar. */
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0, stops: [0, 80, 100] },
    },
    dataLabels: { enabled: false },
    /* Mira vertical tracejada seguindo o dedo, e hover que não repinta a série:
       acabamento de linha do widget 29, o mesmo dos outros gráficos de linha. É a
       mira que transforma a silhueta em leitura — dá para saber o saldo do dia 12,
       não só que a curva subiu. Antes isso exigia handler de ponteiro à mão.

       Sparkline não tem eixo visível, então não passa por Graficos.base: aqui o
       helper sobrepõe uma config mínima, só com as categorias que a mira usa. */
    ...Graficos.linha({
      xaxis: { categories: rotulos },
      markers: { size: 0, hover: { size: 5 } },
    }, Graficos.cor.azul),
    /* A linha do zero só aparece quando a série de fato cruza: senão é tinta sem
       dado. A vertical marca ONDE O FATO ACABA — sem ela, o ponto em que o traço
       muda seria a única pista, e num gráfico deste tamanho isso se perde. */
    annotations: {
      ...(min < 0 && max > 0
        ? { yaxis: [{ y: 0, borderColor: '#c4cad4', strokeDashArray: 0 }] } : {}),
      ...(temRealizado && temPrevisto
        ? { xaxis: [{ x: rotulos[corte], borderColor: '#c4cad4', strokeDashArray: 3, opacity: .6 }] } : {}),
    },
    tooltip: {
      style: { fontSize: Graficos.fonte.dica, fontFamily: 'inherit' },
      custom({ dataPointIndex }) {
        const iso = rotulos[dataPointIndex];
        const d = new Date(iso + 'T12:00:00');
        const dia = isNaN(d) ? String(iso)
          : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
        const mov = (porDia && porDia[iso]) || {};
        // Linha só quando há movimento: "entrou R$ 0" é ruído, não informação
        const linha = (rot, v, cls) => (v
          ? `<span class="res-tip-l"><i>${rot}</i><b${cls ? ` class="${cls}"` : ''}>${fmtSemMoeda(v)}</b></span>` : '');
        /* O balão diz de que lado da linha o ponto está. Sem isso, "saldo" num dia
           que ainda não chegou se lê como extrato — e ali é projeção. */
        const previsto = corte === undefined ? false : dataPointIndex > corte;
        return `<div class="res-tip-in"><span class="res-tip-d">${esc(dia)}</span>`
          + linha(previsto ? 'saldo previsto' : 'saldo', vals[dataPointIndex])
          + linha(previsto ? 'a receber' : 'entrou', mov.entrou || 0, 'txt-green')
          + linha(previsto ? 'a pagar' : 'saiu', mov.saiu || 0, 'txt-red')
          + '</div>';
      },
    },
  }, alt, 'saldo-dia');
}

/* A PONTE entre o dinheiro que existe AGORA e o saldo com que o período FECHA.

   O número grande deste cartão sempre foi o saldo do fim do recorte. Num período
   que ainda não terminou ele é projeção: em 2 de agosto o cartão dizia
   R$ 9.333,63 e na conta havia R$ 231,35. Os dois são verdade, mas só um estava
   na tela — e sem as parcelas do meio o de cima se lê como dinheiro que já existe.

   As parcelas vêm de DB.movimentoPrevistoAte, a mesma função que compõe o saldo
   previsto. Por construção base + a receber − a pagar = o número grande; não há
   caminho para a conta da tela discordar da projeção que está acima dela.

   Período ENCERRADO não tem ponte: ali o fim é fato, e uma linha de previsão
   sobre fato é o que faz o extrato do mês discordar do extrato do banco. */
function pontePrevista({ contas, bordaDe, bordaAte, fim, soDeConta, movimento }) {
  const hojeISO = DB.hojeISO();
  const dia = iso => fmtDate(new Date(iso + 'T12:00:00'));
  const ultimo = dia(somarDias(bordaAte, -1));
  const l = (rot, nota, valor, cls) =>
    `<div class="hc-l${cls ? ' ' + cls : ''}"><span>${rot}${nota ? ` <i>${nota}</i>` : ''}</span><b>${fmt(valor)}</b></div>`;
  const naoZero = v => Math.abs(v) > 0.005;

  /* COM FILTRO DE CATEGORIA, MEMBRO, BUSCA…, a conta de saldo perde o sentido:
     dinheiro em conta não tem categoria. O que sobra — e é o que se quer ver — é
     o MOVIMENTO daquele filtro, partido em o que já aconteceu e o que ainda vai
     acontecer. Esses quatro números vêm da mesma lista que está logo abaixo e
     somam exatamente as duas colunas do cabeçalho. */
  if (!soDeConta) {
    const m = movimento;
    const linhas = [
      naoZero(m.jaEntrou) ? l('Já entrou', `até ${dia(hojeISO)}`, m.jaEntrou) : '',
      naoZero(m.jaSaiu) ? l('Já saiu', `até ${dia(hojeISO)}`, m.jaSaiu) : '',
      naoZero(m.aReceber) ? l('A receber', 'ainda não caiu', m.aReceber) : '',
      naoZero(m.aPagar) ? l('A pagar', 'ainda não saiu', m.aPagar) : '',
    ].filter(Boolean).join('');
    if (!linhas) return '';
    return `
      <div class="res-conta">
        <div class="hc-cab">No filtro <i>${dia(bordaDe)} a ${ultimo}</i></div>
        ${linhas}
      </div>`;
  }

  const comecouAntes = bordaDe <= hojeISO;
  const emAberto = bordaAte > hojeISO;

  /* BLOCO 1 — O QUE JÁ ACONTECEU. Abriu com tanto, entrou, saiu, e é isto que há
     na conta agora. As duas pontas vêm de `saldoNaData` e o meio de
     `movimentoRealizadoAte`, que é a mesma regra: a conta fecha por construção,
     em vez de fechar por sorte.

     Fala de CAIXA — compra no cartão não sai da conta, o pagamento da fatura sai.
     Por isso os rótulos dizem "na conta", e não "receitas"/"despesas" como o
     cabeçalho acima, que conta GASTO. Dois números com nomes diferentes. */
  /* O CORTE É O STATUS, NÃO A DATA. Quem paga um boleto adiantado deixa o
     lançamento com a data do vencimento e o dinheiro sai da conta hoje — o app faz
     isso ao marcar como pago. Cortar por data mostraria "em conta hoje" um número
     que não existe em lugar nenhum: no cenário do teste, R$ 700 enquanto a tela de
     contas dizia R$ 450. Com o corte no status, o bloco fecha no saldo REAL, que é
     o número que o resto do app mostra — e nenhuma linha de sobra é necessária. */
  const abriu = DB.saldoNaData(contas, bordaDe);
  const real = DB.movimentoRealizadoAte(contas, bordaDe, emAberto ? null : bordaAte);
  const emConta = emAberto ? saldoDeContas(contas) : DB.saldoNaData(contas, bordaAte);
  const rotuloAgora = emAberto ? 'Em conta hoje' : `Em conta em ${ultimo}`;
  /* NADA SE MOVEU AINDA: um bloco "Realizado" com uma linha só, repetindo o saldo
     de abertura, é cabeçalho a mais para informação nenhuma. Nesse caso o saldo
     vira a primeira linha do bloco de previsão, que é onde ele faz falta. */
  /* ONDE ESTÁ O DINHEIRO QUE HÁ NA CONTA. "Em conta hoje: R$ 231,35" não responde
     quanto dá para gastar quando R$ 134 estão numa conta de investimento — e a
     diferença entre os dois números não aparecia em tela nenhuma do Extrato.

     Uma linha só, sem operador, presa embaixo do saldo que ela decompõe: com duas
     linhas viraria uma segunda conta competindo com a de cima, e a soma da tela
     deixaria de ter um caminho único. Por isso os dois valores moram nela — o que
     está fora do investimento no número, o investido na nota.

     "Em conta de uso", NÃO "livre para gastar": o Painel já tem uma linha com esse
     nome e ela desconta o que tem dono (reserva e metas), que é outro corte. Hoje
     os dois dão R$ 97,35 por coincidência — uma meta guardada na conta corrente
     separaria os dois, e dois números com o mesmo nome destroem a confiança nos
     dois. */
  /* A MESMA PERGUNTA EM CADA FECHAMENTO — hoje, no fim de um mês encerrado e no
     fim de um mês que ainda vem. Cada linha usa a mesma função que produziu o
     total que ela decompõe: o saldo real hoje, `saldoNaData` no passado,
     `saldoPrevistoNaData` no futuro. Recalcular por outro caminho daria uma
     decomposição que não pertence ao número decomposto.

     A parte de uso vem por SUBTRAÇÃO, nunca de uma segunda soma: assim as duas
     partes fecham no total por construção, mesmo com transferência entre uma conta
     de investimento e uma conta de uso dentro do próprio recorte. */
  const idsInvest = DB.contasInvestidas(contas);
  const investidoEm = medir => (idsInvest.length ? medir(idsInvest) : 0);
  const detalheDeUso = (total, investido) => !naoZero(investido) ? '' : l('Em conta de uso',
    `fora ${fmt(investido)} em investimento`, total - investido, 'hc-d');
  const linhaDeUso = detalheDeUso(emConta, investidoEm(ids => emAberto
    ? saldoDeContas(ids)                       // hoje: o saldo real das contas
    : DB.saldoNaData(ids, bordaAte)));         // mês encerrado: o saldo naquela data
  const mudouAlgo = naoZero(real.entra) || naoZero(real.sai);
  const temBloco1 = comecouAntes && (mudouAlgo || !emAberto);
  const bloco1 = !temBloco1 ? '' : `
      <div class="res-conta">
        <div class="hc-cab">${emAberto ? 'Realizado <i>o que já entrou e saiu</i>' : `No período <i>${dia(bordaDe)} a ${ultimo}</i>`}</div>
        ${mudouAlgo ? `
        ${l('Abriu', `em ${dia(bordaDe)}`, abriu)}
        ${naoZero(real.entra) ? l('+ Entrou na conta', '', real.entra) : ''}
        ${naoZero(real.sai) ? l('− Saiu da conta', '', real.sai) : ''}
        ${l(`= ${rotuloAgora}`, '', emConta, emAberto ? 'hc-sub' : 'hc-total')}${linhaDeUso}`
        : l(rotuloAgora, `nada se moveu desde ${dia(bordaDe)}`, emConta) + linhaDeUso}
      </div>`;

  /* BLOCO 2 — O QUE AINDA VEM. Continua a conta de onde o bloco 1 parou: por isso
     ele não repete o saldo de hoje numa linha própria — dois números iguais e
     seguidos foram exatamente o que fez a primeira versão do hero ser recusada. */
  if (!emAberto) return bloco1;
  const total = DB.movimentoPrevistoAte(contas, bordaAte);
  const janela = DB.movimentoPrevistoAte(contas, bordaAte, bordaDe);
  /* VENCIDO de antes deste período: é dinheiro que ainda vai sair, mas não está na
     lista abaixo. Fora da linha "A pagar" para que ela continue conferível contra
     a lista — foi por não separar os dois que o hero antigo virou um número que
     ninguém conseguia auditar. Em período futuro ele já está dentro da abertura. */
  const vencido = comecouAntes ? (total.entra - total.sai) - (janela.entra - janela.sai) : 0;
  const base = comecouAntes ? emConta : DB.saldoPrevistoNaData(contas, bordaDe);
  /* Sobra quando existe lançamento JÁ PAGO com data depois do período: ele está no
     saldo de hoje e não pode estar no do fim. Raro — zero na base real —, mas sem
     a linha a conta deixaria de fechar justamente para quem paga adiantado, e uma
     conta que não fecha é pior do que uma linha a mais. */
  const resto = fim - (base + janela.entra - janela.sai + vencido);
  return `${bloco1}
      <div class="res-conta">
        <div class="hc-cab">Previsto <i>${temBloco1 ? 'daqui até' : 'até'} ${ultimo}</i></div>
        ${temBloco1 ? '' : l(comecouAntes ? rotuloAgora : 'Abre em contas',
          comecouAntes ? '' : `em ${dia(bordaDe)}`, base) + (comecouAntes ? linhaDeUso : '')}
        ${naoZero(janela.entra) ? l('+ A receber', 'ainda não caiu', janela.entra) : ''}
        ${naoZero(janela.sai) ? l('− A pagar', 'contas e faturas em aberto', janela.sai) : ''}
        ${naoZero(vencido) ? l(`${vencido < 0 ? '−' : '+'} Vencido`, 'de períodos anteriores, em aberto', Math.abs(vencido)) : ''}
        ${naoZero(resto) ? l(`${resto < 0 ? '−' : '+'} Já pago`, 'com data fora do período', Math.abs(resto)) : ''}
        <div class="hc-l hc-total"><span>= Saldo previsto em ${ultimo}</span><b>${fmt(fim)}</b></div>
        <!-- O mesmo detalhe do saldo de hoje, projetado: o aporte agendado para a
             conta de investimento chega lá dentro de saldoPrevistoNaData, então a
             linha mostra quanto do saldo do fim ainda vai estar a mao. -->
        ${detalheDeUso(fim, investidoEm(ids => DB.saldoPrevistoNaData(ids, bordaAte)))}
      </div>`;
}

/* Num período que ainda VAI COMEÇAR, a ponte parte do saldo de abertura — e aí o
   dinheiro de hoje não apareceria em lugar nenhum. Ele vem em prosa, e não como
   mais uma linha da conta, porque a distância entre o saldo de hoje e a abertura
   do mês que vem é o resto do mês corrente: duas linhas sem operação entre elas
   fariam a conta parecer errada. */
function notaDeHoje(contas, bordaDe) {
  if (bordaDe <= DB.hojeISO()) return '';
  return ` Hoje há <b>${fmt(saldoDeContas(contas))}</b> em conta — este período começa depois.`;
}

/* Com filtro de categoria, membro ou busca, o número grande continua sendo o saldo
   de TUDO: ele não tem como responder ao filtro. Dizer isso é obrigatório — um
   número que parece filtrado e não está é pior do que número nenhum. */
function notaDoFiltro(soDeConta) {
  return soDeConta ? ''
    : ' O saldo não responde a este filtro — dinheiro em conta não tem categoria. As linhas acima são o movimento filtrado.';
}

/* Saldo de um conjunto de contas, ou de todas quando não há recorte. Existe para
   que o topo do extrato e a ponte partam do MESMO número: derivar um deles de
   outro caminho é como o extrato de julho passou a discordar do saldo da conta. */
function saldoDeContas(contas) {
  return (contas && contas.length)
    ? contas.reduce((s, id) => s + (Number((DB.get('accounts', id) || {}).balance) || 0), 0)
    : DB.accountsTotal();
}

function resumoExtrato({ titulo, saldo, anterior, entrou, saiu, rotEntrou, rotSaiu, nota, ponte, dias, serie, porDia }) {
  const aberto = state.resumoAberto !== false;
  const variacao = saldo - anterior;
  const dia = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const intervalo = dias.length ? `${dia(dias[0])} a ${dia(dias[dias.length - 1])}` : '';
  /* ONDE O FATO ACABA: o índice do último dia já vivido dentro do recorte. Todo
     dia da janela conta, não só os que têm lançamento — o corte é uma data, não um
     movimento, e usar o último dia COM movimento faria a parte tracejada começar
     antes ou depois de hoje conforme o mês tivesse sido movimentado. */
  const corteDeHoje = dias.reduce((ultimo, d, i) => (d <= DB.hojeISO() ? i : ultimo), -1);

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
      ${ponte || ''}
      <p class="muted res-nota">${nota}</p>
      <!-- Sangra até a borda, com o raio de baixo do cartão. É o que separa um
           gráfico desenhado de um gráfico encaixotado, e é o padrão do Metronic
           (card-body p-0 + card-rounded-bottom). -->
      <div class="res-graf" id="res-graf"
        role="img" aria-label="Saldo dia a dia de ${esc(intervalo)}, de ${fmtSemMoeda(anterior)} a ${fmtSemMoeda(saldo)}${
          corteDeHoje > -1 && corteDeHoje < dias.length - 1 ? ', com o trecho depois de hoje previsto' : ''}">
        ${sparkArea(serie, dias, porDia, corteDeHoje)}
      </div>
    </div>`;
}

function renderExtrato(period) {
  if (!state.filtros) state.filtros = filtrosVazios();
  const ativos = filtrosAtivos();
  const txs = txsFiltradas(period);
  /* isNeutral, não apenas !adjustment: transferência entre contas próprias e
     pagamento de fatura têm type 'Despesa'/'Transferência' e passariam por
     isExpense, entrando no total da família como gasto novo. Transferência não é
     gasto — o dinheiro só mudou de lugar; e a compra do cartão já contou como
     despesa quando aconteceu, então a quitação contaria o mesmo dinheiro de novo. */
  const total = txs.filter(t => DB.isExpense(t) && !DB.isNeutral(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const receitas = txs.filter(t => !DB.isExpense(t) && !t.card_id && !DB.isNeutral(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

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

  /* CONTA E JANELA DE DIAS são filtros que o SALDO entende: um conjunto de contas
     tem saldo, um intervalo tem começo e fim. Categoria, membro, etiqueta e busca
     não — dinheiro em conta não tem categoria, e um "saldo do envelope Mercado"
     seria um número inventado. Com um desses ligado, o cartão troca a conta de
     saldo pelo MOVIMENTO do filtro. */
  const soDeConta = !(state.filtros.busca || state.filtros.valorMin || state.filtros.valorMax
    || state.filtros.recorrente
    || ['scope', 'membro', 'tipo', 'situacao', 'categorias', 'tags', 'metodos']
      .some(k => (state.filtros[k] || []).length));

  /* Total do dia, somado sobre a lista JÁ FILTRADA: com um filtro ativo, um total
     vindo de outra base não bateria com as linhas logo abaixo dele. */
  /* Faturas do período entram na lista como linhas PREVISTAS.

     Elas não são transações — são derivadas das compras — mas o dinheiro sai da
     conta no vencimento. Um extrato de agosto sem a fatura de agosto esconde a
     maior saída do mês, que foi exatamente o defeito relatado. */
  const faturasNoPeriodo = (state.filtros.tipo.length && !state.filtros.tipo.includes('Despesa'))
    ? [] : DB.faturasDoPeriodo(period, contasFiltradas);

  const porDia = {};
  for (const t of txs) {
    const d = (porDia[t.date] = porDia[t.date] || { saiu: 0, entrou: 0, saiuPrev: 0, entrouPrev: 0 });
    const v = Number(t.amount) || 0;
    /* Soma no total do dia e, quando o item ainda não aconteceu, também na parcela
       PREVISTA dele. Marcar aqui, dentro da regra que já decide o que conta, é o
       que permite partir o cabeçalho em "já foi" e "ainda vem" sem escrever a
       regra uma segunda vez — e regra escrita duas vezes diverge na primeira
       manutenção. */
    const soma = (campo, valor) => {
      d[campo] += valor;
      if (t.status === 'A Pagar') d[campo + 'Prev'] += valor;
    };
    if (DB.isTransfer(t)) {
      const efeito = efeitoNaConta(t);
      if (efeito < 0) soma('saiu', -efeito);
      else if (efeito > 0) soma('entrou', efeito);
      continue;
    }
    if (t.adjustment) continue;              // conciliação não é gasto nem entrada
    /* Pagamento de fatura segue a regra da transferência: conferindo UMA conta,
       o dinheiro saiu dela de verdade e tem de bater com o extrato do banco;
       olhando a família inteira, ele não é saída nova — as compras do cartão já
       contaram como despesa quando aconteceram. */
    if (t.pays_invoice) {
      if (contasFiltradas.length) soma('saiu', v);
      continue;
    }
    if (DB.isExpense(t)) soma('saiu', v);
    else if (!t.card_id) soma('entrou', v);  // estorno de cartão abate a fatura, não entra na conta
  }

  /* A fatura conta no total do dia SÓ quando se está conferindo contas.

     Mesma regra do pagamento de fatura, pelo mesmo motivo: com conta filtrada, o
     total do dia é CAIXA e a fatura sai dali de verdade — tem de bater com o
     extrato do banco. Sem filtro, o total é GASTO, e as compras do cartão já
     contaram quando foram feitas: somar a fatura seria o mesmo dinheiro duas
     vezes. Por isso a linha aparece nos dois casos, mas o total só num. */
  if (contasFiltradas.length) {
    for (const inv of faturasNoPeriodo) {
      const d = (porDia[inv.venceISO] = porDia[inv.venceISO] || { saiu: 0, entrou: 0, saiuPrev: 0, entrouPrev: 0 });
      d.saiu += Math.max(0, inv.falta);
      d.saiuPrev += Math.max(0, inv.falta);   // fatura em aberto é previsão, não fato
    }
  }

  // Totais do período nesta conta: a soma dos dias, para o topo e a lista contarem
  // a mesma história
  const saiuNaConta = Object.values(porDia).reduce((s, d) => s + d.saiu, 0);
  const entrouNaConta = Object.values(porDia).reduce((s, d) => s + d.entrou, 0);

  /* O MESMO movimento, partido em o que já aconteceu e o que ainda vem. As duas
     metades somam o total acima por construção, então o cartão pode mostrar as
     duas sem risco de contradizer o próprio cabeçalho. */
  const previstoDoTotal = (campo, filtro) => contasFiltradas.length
    ? Object.values(porDia).reduce((s, d) => s + d[campo], 0)
    : txs.filter(t => t.status === 'A Pagar' && filtro(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const aPagar = previstoDoTotal('saiuPrev', t => DB.isExpense(t) && !DB.isNeutral(t));
  const aReceber = previstoDoTotal('entrouPrev', t => !DB.isExpense(t) && !t.card_id && !DB.isNeutral(t));
  const movimentoDoFiltro = {
    jaEntrou: (contasFiltradas.length ? entrouNaConta : receitas) - aReceber,
    jaSaiu: (contasFiltradas.length ? saiuNaConta : total) - aPagar,
    aReceber, aPagar,
  };

  /* Marcadas como previstas e sem ação de pagar na própria linha: quem paga usa a
     folha, que trata parcial e escolhe a conta. */
  const linhaFatura = inv => `<div class="tx tx-prev" data-fatura="${esc(inv.key)}">
    <span class="tx-ico">💳</span>
    <span class="tx-info"><span class="tx-name">Fatura ${esc(inv.card.name)}</span>
    <span class="tx-meta">Previsto · vence ${fmtDate(inv.due)} · ${inv.count} compra(s)${
      inv.pago > 0.005 ? ` · já pago ${fmtShort(inv.pago)}` : ''} · toque para pagar</span></span>
    <span class="tx-amount pending">− ${fmt(inv.falta)}</span>
  </div>`;

  /* Mistura transações e faturas numa lista só, ordenada por data. Renderizar
     cada grupo à parte os tiraria da leitura cronológica, que é o que faz um
     extrato ser extrato.

     Os itens PREVISTOS já vêm dentro de `txs`: em mês futuro o `DB.txOfPeriod`
     devolve as transações virtuais junto das reais. Montá-los aqui também, como
     esta função fazia antes, duplicava cada linha na tela. */
  const linhas = [
    ...txs.map(t => ({ data: t.date, tx: t })),
    ...faturasNoPeriodo.map(inv => ({ data: inv.venceISO, inv })),
  ].sort((a, b) => b.data.localeCompare(a.data));

  let list = '', lastDay = '';
  for (const item of linhas) {
    if (item.inv) {
      if (item.data !== lastDay) {
        lastDay = item.data;
        const d = porDia[item.data] || { saiu: 0, entrou: 0 };
        const liqF = d.entrou - d.saiu;
        const badgeF = (rot, cls, valor) => `<span class="dia-badge ${cls}"><i>${rot}</i>${valor}</span>`;
        const totF = [
          d.entrou ? badgeF('Entradas', 'ok', fmt(d.entrou)) : '',
          d.saiu ? badgeF('Saídas', 'ruim', fmt(d.saiu)) : '',
          (d.entrou && d.saiu) ? badgeF('Saldo', liqF >= 0 ? 'saldo pos' : 'saldo neg',
            `${liqF >= 0 ? '+' : '−'} ${fmt(Math.abs(liqF))}`) : '',
        ].filter(Boolean).join('');
        list += `<p class="tx-day"><span>${fmtDay(item.data)}</span>${totF ? `<span class="tx-day-tot">${totF}</span>` : ''}</p>`;
      }
      list += linhaFatura(item.inv);
      continue;
    }
    const t = item.tx;
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
    /* Linha VIRTUAL (previsão de um mês futuro) não tem id: não recebe `data-tx`
       nem botão de pagar, porque não há registro para abrir nem para quitar. O
       rodapé diz de onde ela veio, para a projeção ser auditável linha a linha —
       ninguém confia num número que não consegue rastrear. */
    const ehVirtual = !!t.virtual;
    list += `<div class="tx ${ehVirtual ? 'tx-prev' : DB.isNeutral(t) ? 'tx-adj' : ''}"${
      ehVirtual ? '' : ` data-tx="${t.id}"`}>
      <span class="tx-ico ${isTr ? 'i-transfer' : !isExp && !t.adjustment ? 'i-receita' : ''}">${isTr ? '⇄' : t.adjustment ? '⚖️' : isExp ? esc(c ? c.icon : '🧾') : '💵'}</span>
      <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
      <span class="tx-meta">${ehVirtual
        ? `Previsto · ${t.origemPrevista === 'custo fixo' ? 'custo fixo' : 'repete todo mês'} · ainda não lançado${
          c ? ' · ' + esc(DB.categoryPath(t.category_id)) : ''}`
        : isTr ? `Transferência · ${rota}`
        : t.adjustment ? 'Conciliação — fora das análises · toque para classificar'
        : `${c ? esc(DB.categoryPath(t.category_id)) : (isExp ? 'Sem categoria' : 'Entrada sem origem')} · ${via}${t.member ? ' · ' + esc(t.member) : ''}${t.installment ? ' · parcela ' + esc(t.installment) : ''}`}</span>
      ${DB.tagsOf(t).length ? `<span class="tx-tags">${DB.tagsOf(t).map(tg =>
        `<button class="tx-tag" data-tag="${esc(tg)}" title="Filtrar por #${esc(tg)}">#${esc(tg)}</button>`).join('')}</span>` : ''}</span>
      <span class="tx-amount ${isTr ? 'transfer' : !isExp ? 'income' : t.status === 'A Pagar' ? 'pending' : ''}">${
        isTr ? (efeitoNaConta(t) < 0 ? '− ' : efeitoNaConta(t) > 0 ? '+ ' : '')
        : isExp ? '− ' : '+ '}${fmt(t.amount)}</span>
      ${t.status === 'A Pagar' && !ehVirtual ? `<button class="pay-btn" data-pay-tx="${t.id}" title="Marcar como ${isExp ? 'pago' : 'recebido'}"><span data-ico="check"></span></button>` : ''}
    </div>`;
  }
  // Vazio com filtro ativo é ambíguo: pode ser que não haja nada, ou que o filtro
  // esteja escondendo tudo. A mensagem diz qual dos dois é, e oferece a saída.
  /* Vazio é `linhas`, não `txs`: um mês futuro pode não ter transação nenhuma e
     ainda assim ter a fatura vencendo nele. Checar txs sobrescrevia a lista com a
     mensagem de vazio e jogava a linha da fatura fora — a maior saída do mês
     desaparecia justamente no mês em que ela importa. */
  if (!linhas.length) {
    list = ativos.length
      ? `<div class="empty"><b>Nenhum lançamento com esses filtros</b>Há ${DB.txOfPeriod(period).length} no período. <button class="btn ghost" id="limpar-vazio" style="margin-top:var(--e3)">Limpar os filtros</button></div>`
      : `<div class="empty"><b>Sem lançamentos</b>Nada registrado neste período ainda.
          <button class="btn" data-novo="Despesa" style="margin-top:var(--e3)">Lançar o primeiro gasto</button></div>`;
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
          <!-- Mês futuro precisa se anunciar: sem isso, o extrato quase vazio de
               setembro pareceria perda de dados em vez de mês que não chegou. -->
          <div class="muted" style="font-size:11.5px">${fmtDate(period.start)} a ${fmtDate(new Date(period.end.getTime() - 86400000))}${
            isCurrent ? ` · dia ${st.elapsedDays} de ${st.totalDays}`
            : state.monthOffset > 0 ? ' · ainda não chegou' : ' · encerrado'}</div>
        </div>
        <button id="mn-next" aria-label="Próximo mês" data-ico="chevR" ${state.monthOffset >= 6 ? 'disabled style="opacity:.35"' : ''}></button>
      </div>
      ${reguaDoMes(period, movimentoPorDia)}
      ${barraDePilulas()}
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
      const anterior = DB.saldoPrevistoNaData(contasFiltradas, bordaDe);
      const finalMes = DB.saldoPrevistoNaData(contasFiltradas, bordaAte);
      const conciliado = finalMes - (anterior + entrouNaConta - saiuNaConta);
      return resumoExtrato({
        // "previsto" no título quando o período ainda não acabou: o número é
        // projeção, e chamá-lo de saldo o faz passar por dinheiro que já existe
        titulo: `${varias ? 'Saldo somado' : 'Saldo'}${bordaAte > DB.hojeISO() ? ' previsto' : ''} em ${
          fmtDate(new Date(somarDias(bordaAte, -1) + 'T12:00:00'))}`,
        saldo: finalMes, anterior, entrou: entrouNaConta, saiu: saiuNaConta,
        rotEntrou: 'entrou', rotSaiu: 'saiu',
        ponte: pontePrevista({ contas: contasFiltradas, bordaDe, bordaAte, fim: finalMes,
          soDeConta, movimento: movimentoDoFiltro }),
        dias: diasDoRecorte, porDia,
        serie: serieDeSaldo(contasFiltradas, diasDoRecorte, anterior),
        nota: `Extrato de <b>${esc(nomes.join(' + '))}</b> — o saldo anterior é o que ${
          recortado ? `havia em ${fmtDate(new Date(bordaDe + 'T12:00:00'))}` : 'veio do mês passado'}.${
          /* Só sem filtro de conteúdo: com um deles ligado, entrou/saiu são do
             recorte e o saldo é de tudo, então a diferença entre os dois não é
             conciliação nenhuma — é o próprio filtro, e anunciá-la como conciliação
             seria inventar um problema que não existe. */
          soDeConta && Math.abs(conciliado) > 0.005 ? ` Há <b>${fmt(Math.abs(conciliado))}</b> de conciliação no período, que mexe no saldo mas não é gasto nem entrada.` : ''}${varias
          ? ' Transferência entre estas contas não conta, porque o dinheiro não saiu daqui.' : ''}${
          notaDeHoje(contasFiltradas, bordaDe)}${notaDoFiltro(soDeConta)}`,
      });
    })()
    : (() => {
      /* Sem filtro de conta, o extrato é o de todo o dinheiro da família — e aí
         o que sobrou do mês passado também precisa aparecer, senão cada mês
         parece começar do zero e a soma nunca fecha com o saldo das contas. */
      // Os dois saldos vêm do saldo real das contas, cada um na sua data — ver o
      // comentário no ramo de cima: derivar o fechamento da soma ignora a conciliação
      const anterior = DB.saldoPrevistoNaData(null, bordaDe);
      const finalMes = DB.saldoPrevistoNaData(null, bordaAte);
      const resultado = receitas - total;
      const conciliado = finalMes - (anterior + resultado);
      const onde = recortado ? 'neste intervalo' : 'neste mês';
      const vindo = recortado
        ? `que havia em ${fmtDate(new Date(bordaDe + 'T12:00:00'))}`
        : 'que vieram do anterior';
      return resumoExtrato({
        titulo: `Saldo${bordaAte > DB.hojeISO() ? ' previsto' : ''} em ${
          fmtDate(new Date(somarDias(bordaAte, -1) + 'T12:00:00'))}`,
        saldo: finalMes, anterior, entrou: receitas, saiu: total,
        rotEntrou: 'receitas', rotSaiu: 'despesas',
        ponte: pontePrevista({ contas: null, bordaDe, bordaAte, fim: finalMes,
          soDeConta, movimento: movimentoDoFiltro }),
        dias: diasDoRecorte, porDia,
        serie: serieDeSaldo(null, diasDoRecorte, anterior),
        /* COM FILTRO DE CONTEÚDO a frase do "sobrou/faltou" mentiria: ela soma um
           movimento filtrado a um saldo que é de tudo. Ali a nota vira só o aviso
           de que o saldo não segue o filtro. */
        nota: !soDeConta ? notaDoFiltro(soDeConta).trim() : `${resultado >= 0
          ? `Sobrou <b class="txt-green">${fmt(resultado)}</b> ${onde}, somados aos ${fmt(anterior)} ${vindo}.`
          : `Faltou <b class="txt-red">${fmt(Math.abs(resultado))}</b> ${onde}, tirados dos ${fmt(anterior)} ${vindo}.`}${
          /* A diferença entre a conta de GASTO (as duas colunas acima) e a de CAIXA
             (o bloco de linhas abaixo). Chamá-la de "conciliação" era impreciso: a
             maior parte dela costuma ser compra no cartão, que é gasto e não sai da
             conta, e pagamento de fatura, que sai da conta e não é gasto novo. */
          Math.abs(conciliado) > 0.005 ? ` Há ainda <b>${fmt(Math.abs(conciliado))}</b> de diferença entre gasto e caixa — compra no cartão, pagamento de fatura e conciliação mexem num e não no outro.` : ''}${
          notaDeHoje(null, bordaDe)}`,
      });
    })()}
    <!-- Cabeçalho da seção com as ações à direita, no lugar de dois botões de
         largura inteira empilhados entre o resumo e a lista. Ali eles cortavam a
         leitura do resumo para a lista e pesavam mais que o conteúdo; aqui
         nomeiam a seção e ficam ao alcance sem disputar atenção. -->
    <div class="sec-cab">
      <div class="sec-tit">
        <b>Extrato detalhado</b>
        <small>${txs.length ? `${txs.length} lançamento${txs.length === 1 ? '' : 's'}${
          ativos.length ? ` de ${DB.txOfPeriod(period).length} no período` : ''}` : 'nada no período'}</small>
      </div>
      <div class="sec-acoes">
        <!-- O botão "Custos fixos" morava aqui. Ele copiava à mão os lançamentos
             marcados como recorrentes, um mês por vez — o mecanismo antigo de repetição.
             Com o CONTRATO virando a fonte única de movimentação futura ele deixou
             de ter o que fazer: o contrato gera sozinho, na data certa, já com
             vínculo. Um botão que não faz nada é pior que botão nenhum. -->
        ${txs.length ? '<button class="sec-btn" id="btn-massa"><span data-ico="edit"></span>Editar</button>' : ''}
      </div>
    </div>
    <div id="tx-list">${list}</div>
  `;
}

/* ---------- Cartões ---------- */
/* O CUSTO FIXO e a data em que cada pedaço dele acaba.

   "A parcela do FordKa acaba em 9 meses e libera R$ 500 por mês" é a informação
   que faz planejar, e ela estava só dentro do cadastro de cada contrato, um a um.
   O total sozinho não bastaria: 38% da renda é um diagnóstico, e o que acaba é o
   tratamento. */
function custoFixoCard() {
  const cf = DB.custoFixoMensal();
  if (!cf.itens.length) return '';
  const renda = DB.rendaMediaRecente() || DB.rendaDoMes(DB.monthPeriod(new Date()));
  const pct = renda > 0 ? Math.round(cf.total / renda * 100) : null;
  const acabam = cf.itens.filter(i => i.restam !== null).sort((a, b) => a.restam - b.restam);
  return `
    <div class="card">
      <div class="card-head" style="margin-bottom:var(--e2)"><div><b>Custo fixo mensal</b><small>${
        cf.itens.length} ${cf.itens.length === 1 ? 'item' : 'itens'}${pct !== null ? ` — ${pct}% da renda média` : ''}</small></div>
        ${/* Com todas as linhas à vista, o total do cabeçalho passou a ser a soma
              CONFERÍVEL delas — e aí ele não pode mais vir abreviado. Enquanto só
              quatro apareciam, "R$ 6.241" bastava; agora quem soma as dez chega a
              R$ 6.240,80 e encontra dois números para a mesma coisa. Um total que
              não fecha com as próprias parcelas é o pior defeito de uma tela. */''}
        <span class="num txt-red" style="font-size:18px">${fmt(cf.total)}</span></div>
      <div class="res-conta" style="border-top:0;padding:0">
        ${/* TODOS OS ITENS, sem "e mais 7" — a pedido de quem usa. O agrupamento
              economizava quatro linhas e cobrava o preço errado: esta é a tela de
              gerenciar custo fixo, e o que está escondido não se gerencia. Com dez
              contratos, os seis de baixo somavam R$ 1.120 sem dizer de quê.

              A NOTA de cada linha diz o que ajuda a decidir: quando o valor não é
              mensal (para o número ao lado se explicar) e quantos meses faltam. A
              marca de origem saiu — com o contrato virando fonte única, todas as
              linhas diriam "contrato", e um rótulo igual em dez linhas é ruído. */
          cf.itens.map(i => {
            const nota = [
              i.periodicidade !== 'mensal' ? `${esc(i.periodicidade)}, por mês` : '',
              i.restam !== null ? `${i.restam} ${i.restam === 1 ? 'mês' : 'meses'}` : '',
            ].filter(Boolean).join(' · ');
            return `<div class="hc-l"><span>${esc(i.descricao)}${nota ? ` <i>${nota}</i>` : ''}</span><b>${fmt(i.mensal)}</b></div>`;
          }).join('')}
      </div>
      ${acabam.length ? `<p class="muted" style="margin-top:var(--e2)">${acabam.slice(0, 2).map(i =>
        `<b>${esc(i.descricao)}</b> acaba em ${i.restam} ${i.restam === 1 ? 'mês' : 'meses'} e libera ${fmtShort(i.mensal)}/mês`).join('. ')}.</p>` : ''}
    </div>`;
}

/* A tela de Cartões & Faturas.

   REESTRUTURADA a pedido de quem usa. O que havia antes: Contas, Patrimônio,
   Custo fixo e "Compromissos futuros" vinham PRIMEIRO, e o cartão — o assunto da
   aba — só aparecia depois de quatro blocos. Medido na base real: 40 linhas de
   conteúdo antes do primeiro cartão.

   A ordem agora conta uma história só, que é como os apps de patrimônio fazem
   (Monarch, Copilot) e como o Nubank organiza a tela do cartão:

     patrimônio  →  o que eu TENHO (contas)  →  o que eu DEVO (cartões)

   O patrimônio deixa de ser um bloco no meio repetindo números e vira o
   cabeçalho: as duas seções abaixo dele são as suas parcelas. Cartão de crédito
   não é assunto paralelo, é o passivo do mesmo patrimônio.

   "Compromissos futuros" saiu: ele somava água, energia e parcela de carro, que
   não são cartão — numa tela de cartões o número parecia dívida de fatura. Ele
   continua no Painel, que é onde a pergunta "o que devo este mês" pertence. */
function renderCartoes() {
  const cards = DB.all('cards').filter(c => c.active !== false);
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const pat = DB.patrimonio();
  const deve = pat.cartaoAgora + pat.cartaoDepois;

  /* O patrimônio como capa, e as duas metades que o compõem logo abaixo do
     número. Elas são os títulos das seções seguintes, para que se saiba de
     antemão que a tela inteira é a decomposição deste valor.

     Ele nasceu porque a tela listava saldos e faturas em blocos separados e a
     subtração não era feita em lugar nenhum: R$ 169,70 em conta contra
     R$ 2.179,22 de cartão davam um patrimônio de −R$ 2.009,52 que nenhuma tela
     dizia. Era um card no meio da pilha, repetindo números que já estavam acima
     e abaixo dele; como capa, ele deixa de repetir e passa a apresentar.

     A dívida aparece SOMADA aqui e PARTIDA lá embaixo, e é de propósito: as duas
     metades doem em momentos diferentes — a fatura em aberto cobra ação nesta
     semana, o que já foi comprado e ainda vai faturar é compromisso de meses. No
     bloco do cartão cada uma tem o seu lugar e o seu botão. */
  const capa = (pat.emContas > 0.005 || deve > 0.005) ? `
    <div class="pat-capa">
      <span class="pat-rot">Patrimônio líquido</span>
      <b class="pat-val ${pat.liquido >= 0 ? '' : 'txt-red'}">${fmt(pat.liquido)}</b>
      <div class="pat-partes"><span>tenho <b>${fmt(pat.emContas)}</b></span><span class="pat-sep">·</span><span>devo <b>${fmt(deve)}</b></span></div>
    </div>` : '';

  const totalContas = contas.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const contasHtml = capa + `
    <div class="sec-cab">
      <div class="sec-tit">
        <b>O que eu tenho</b>
        <small>${fmt(totalContas)}${pat.investido > 0.005 ? ` · ${fmtShort(pat.investido)} em investimento` : ''} · toque para conciliar</small>
      </div>
      <div class="sec-acoes">
        ${contas.length > 1 ? '<button class="sec-btn" id="btn-transfer"><span data-ico="sync"></span>Transferir</button>' : ''}
        <button class="sec-btn" data-setup="accounts"><span data-ico="settings"></span>Gerenciar</button>
      </div>
    </div>
    <div class="card">
      ${contas.length ? contas.map(a => `
        <div class="acc-row" data-acc="${a.id}">
          <span class="acc-ico">${a.type === 'Caixinha / Rendimento' ? '🐷' : a.type === 'Investimento' ? '📈' : a.type === 'Carteira Digital' ? '📱' : '🏦'}</span>
          <span class="acc-info"><b>${esc(a.name)}</b><small>${esc(a.type)}${a.institution ? ' · ' + esc(a.institution) : ''}</small></span>
          <span class="num">${fmt(a.balance)}</span>
        </div>`).join('') : '<div class="empty">Nenhuma conta cadastrada. Adicione em Configurações → Contas.</div>'}
    </div>`;

  if (!cards.length) {
    return contasHtml + `<div class="card"><div class="empty"><b>Nenhum cartão cadastrado</b>Cadastre seus cartões para o app controlar faturas e parcelas automaticamente.</div>
      <button class="btn ghost" id="go-cards">Cadastrar cartão</button></div>` + custoFixoCard();
  }

  let html = contasHtml + `
    <div class="sec-cab">
      <div class="sec-tit">
        <b>O que eu devo</b>
        <small>${fmt(deve)} em faturas e parcelas já compradas</small>
      </div>
      <div class="sec-acoes">
        <button class="sec-btn" data-setup="cards"><span data-ico="settings"></span>Gerenciar</button>
      </div>
    </div>`;

  for (const card of cards) html += cartaoBloco(card);
  return html + custoFixoCard();
}

/* Um cartão: a fatura que cobra ação, a que está acumulando, e o resto
   condensado. Separado de renderCartoes porque a regra de QUAL fatura mostrar é
   justamente a parte que tinha defeito, e ela merece ser lida e testada sozinha. */
function cartaoBloco(card) {
  const invoices = DB.invoicesOf(card);

  /* CARTÃO SEM MOVIMENTO vira UMA LINHA. Antes ele ocupava o mesmo bloco de um
     cartão com fatura em aberto: na base real, um cartão zerado e sem limite
     cadastrado pesava tanto quanto outro com R$ 613 a pagar. */
  if (!invoices.length) {
    return `<button class="cc-vazio" data-setup="cards">
      <span class="cc-vazio-nome">${esc(card.name)}</span>
      <span class="muted">sem lançamentos${card.limit_amount > 0 ? '' : ' · limite não cadastrado'}</span>
      <span data-ico="chev"></span>
    </button>`;
  }

  const chaveAtual = DB.invoiceKeyFor(card, todayISO());
  const atual = invoices.find(i => i.key === chaveAtual);

  /* A FATURA FECHADA E NÃO PAGA é o item mais urgente da tela, e por isso não
     pode ficar atrás de um link de histórico — é o que o Nubank faz ao mostrar a
     fechada e a aberta lado a lado. "Parcial" entra junto: quem pagou metade
     ainda deve a outra metade. */
  const pendentes = invoices.filter(i => i.key !== chaveAtual
    && (i.status === 'Fechada' || i.status === 'Parcial') && i.falta > 0.005)
    .sort((a, b) => a.due - b.due);

  /* AS FUTURAS viram UMA linha. São as parcelas já compradas, e na base real eram
     oito faturas idênticas de R$ 249,90 que empurravam a fatura atual para fora
     da lista: a tela oferecia "pagar" para maio de 2027 e escondia o mês
     corrente. Somadas, elas respondem a única pergunta que importa delas —
     quanto do futuro já está comprometido. */
  const agora = new Date();
  const futuras = invoices.filter(i => i.key !== chaveAtual && i.closing > agora
    && !pendentes.includes(i) && i.falta > 0.005);
  const totalFuturas = futuras.reduce((s, i) => s + i.falta, 0);
  const ultima = futuras.length ? futuras[futuras.length - 1] : null;

  /* O QUE OCUPA O LIMITE é a dívida INTEIRA do cartão, não só a fatura aberta.

     Uma compra em 10x trava o limite pelo valor total no momento da compra; ele
     volta aos poucos, conforme cada parcela é paga. Descontar só a fatura em
     aberto dava um disponível maior do que o real — na base própria, R$ 4.640,10
     contra R$ 2.640,90 num limite de R$ 5.000, os R$ 1.999,20 das oito parcelas
     ainda por faturar. Errar aqui é errar para o lado perigoso: a tela prometeria
     um limite que o cartão não tem.

     É também o mesmo número que o cabeçalho da tela já mostra em "devo", e dois
     valores discordando sobre a mesma dívida destroem a confiança nos dois.

     E ELE SE PARTE EM DUAS NATUREZAS, que é o corte por STATUS — o mesmo do
     Extrato, onde o que separa "já aconteceu" de "ainda vem" nunca foi a data:

       UTILIZADO     a compra foi efetivada e o limite já foi tomado. Uma compra
                     em 10x entra INTEIRA aqui no dia em que foi feita, mesmo com
                     parcelas caindo daqui a nove meses — o cartão travou o valor
                     todo naquele momento.
       COMPROMETIDO  foi lançado e ainda NÃO se efetivou. Vai tomar limite quando
                     acontecer, e até lá é uma reserva, não uma dívida.

     A primeira versão cortava por DATA da fatura — a atual contra as futuras —, e
     isso classificava as parcelas de uma compra já feita como se ainda não
     tivessem tomado limite. Na base real dava "consumido R$ 359,90, comprometido
     R$ 1.999,20" quando o certo é R$ 2.249,10 utilizados (nove parcelas de uma TV
     já comprada) contra R$ 110,00 comprometidos (uma assinatura lançada e ainda
     não efetivada).

     Fatura quitada devolve o limite, então só as não pagas entram. */
  const { utilizado, comprometido } = usoDoLimite(card, invoices);
  const emUso = utilizado + comprometido;
  const limite = Number(card.limit_amount) || 0;
  const sobra = limite - emUso;

  let html = `<div class="credit-card">
    <div class="cc-head"><span class="cc-name">${esc(card.name)}</span><span class="cc-brand">${esc(card.brand || '')}</span></div>`;

  // A pendente vem ANTES da aberta: é ela que tem data marcada e cobra ação hoje
  for (const p of pendentes) {
    html += `<div class="cc-alerta">
      <div class="cc-alerta-top"><span>⚠ Fatura fechada · ${esc(rotuloDaFatura(p.key))}</span><span>${prazoDeVencimento(p.due)}</span></div>
      <div class="cc-alerta-val">${fmt(p.falta)}</div>
      <div class="cc-acoes"><button class="link-btn" data-inv-detail="${p.key}">ver ${p.count} ${p.count === 1 ? 'item' : 'itens'}</button><button class="link-btn forte" data-pay="${p.key}">pagar</button></div>
    </div>`;
  }

  html += `<div class="cc-invoice">
    <div class="cc-invoice-label">Fatura aberta${atual ? ' · ' + esc(rotuloDaFatura(atual.key)) : ''}</div>
    <div class="cc-invoice-val">${fmt(atual ? atual.falta : 0)}</div>
    <div class="cc-dates"><span>fecha ${atual ? fmtDate(atual.closing) : 'dia ' + card.closing_day}</span><span>vence ${atual ? fmtDate(atual.due) : 'dia ' + card.due_day}</span></div>
    ${atual && atual.count ? `<div class="cc-acoes"><button class="link-btn" data-inv-detail="${atual.key}">ver ${atual.count} ${atual.count === 1 ? 'item' : 'itens'}</button><button class="link-btn" data-pay="${atual.key}">pagar</button></div>` : ''}
  </div>`;

  /* LIMITE: quanto AINDA DÁ para gastar, não a porcentagem já usada. Na base real
     o cadastro dizia R$ 110 com fatura de R$ 359,90 e a tela desenhava uma barra
     de "327%" como se fosse informação. Uso acima do limite quase sempre é
     cadastro errado, e a resposta útil é dizer isso em vez de pintar a barra. */
  if (limite > 0 && sobra >= 0) {
    /* A BARRA EM DUAS FAIXAS. Uma barra só, com o total, dizia "o limite está
       cheio até aqui" sem dizer de quê — e as duas metades pedem decisões
       diferentes: contra o consumido não há o que fazer além de pagar a fatura;
       contra o comprometido, dá para não parcelar a próxima compra.

       Mesma família de cor, intensidades diferentes: é a convenção que o app já
       usa no gráfico do Extrato, onde o realizado é cheio e o previsto é claro.
       Duas cores sem parentesco fariam parecer duas medidas distintas, quando as
       duas faixas medem a mesma coisa — quanto do limite não está livre. */
    const pctC = Math.min(100, utilizado / limite * 100);
    const pctF = Math.min(100 - pctC, comprometido / limite * 100);
    html += `<div class="cc-limit">
      <div class="budget-head"><span class="muted">Disponível no limite</span><span class="num">${fmt(sobra)} <span class="muted">de ${fmtShort(limite)}</span></span></div>
      <div class="bar bar-2">
        <i class="bar-usado" style="width:${pctC}%"></i>
        <i class="bar-futuro" style="width:${pctF}%"></i>
      </div>
      <div class="cc-legenda">
        <span><b class="pt-usado"></b>utilizado <i>${fmt(utilizado)}</i></span>
        ${comprometido > 0.005 ? `<span><b class="pt-futuro"></b>comprometido <i>${fmt(comprometido)}</i></span>` : ''}
      </div></div>`;
  } else if (limite > 0) {
    html += `<div class="cc-limit cc-limit-erro">Limite cadastrado (${fmtShort(limite)}) é menor que os ${fmt(emUso)} já comprometidos — confira o cadastro do cartão.</div>`;
  } else {
    html += `<div class="cc-limit cc-limit-erro">Limite não cadastrado — sem ele não dá para avisar quando o cartão estourar.</div>`;
  }
  html += '</div>';

  if (totalFuturas > 0.005) {
    html += `<button class="cc-linha" data-futuras="${card.id}">
      <span>Ainda vai faturar <i>${futuras.length} ${futuras.length === 1 ? 'fatura' : 'faturas'}${ultima ? ' até ' + mesAno(ultima.due) : ''}</i></span>
      <b>${fmt(totalFuturas)}</b><span data-ico="chev"></span></button>`;
  }
  html += `<button class="cc-linha" data-hist="${card.id}"><span>Histórico de faturas</span><span data-ico="chev"></span></button>`;
  return html;
}

/* Quanto do limite está tomado, e em que natureza.

   UTILIZADO é compra efetivada (status Pago): o cartão já travou o valor. Uma
   compra em 10x conta inteira desde o dia em que foi feita — as nove parcelas que
   ainda vão cair já ocuparam limite, e ele só volta quando cada fatura é paga.

   COMPROMETIDO é o que foi lançado e ainda não se efetivou (A Pagar): vai tomar
   limite quando acontecer. É reserva, não dívida.

   Fatura QUITADA devolveu o limite e fica de fora. Em pagamento parcial, o abate
   entra primeiro no utilizado — é a parte que já é dívida de verdade —, e só o
   que sobrar desconta do comprometido.

   Estorno no cartão entra com sinal negativo, como em `invoicesOf`: uma devolução
   libera limite do mesmo jeito que a compra tomou. */
function usoDoLimite(card, invoices) {
  const porFatura = {};
  for (const t of DB.all('transactions')) {
    if (t.card_id !== card.id || !t.invoice_key) continue;
    const v = (DB.isExpense(t) ? 1 : -1) * (Number(t.amount) || 0);
    const b = (porFatura[t.invoice_key] = porFatura[t.invoice_key] || { efetivado: 0, previsto: 0 });
    if (t.status === 'Pago') b.efetivado += v; else b.previsto += v;
  }
  let utilizado = 0, comprometido = 0;
  for (const inv of invoices) {
    /* O STATUS entra junto com o `falta` porque o app aceita MARCAR a fatura como
       paga sem registrar o lançamento — atalho de quem quitou por fora. Nesse
       caminho `falta` continua cheio, e olhar só para ele deixava a fatura
       ocupando limite para sempre. */
    if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
    const b = porFatura[inv.key] || { efetivado: 0, previsto: 0 };
    let abate = Math.max(0, (Number(inv.total) || 0) - inv.falta);   // o que já foi pago desta fatura
    utilizado += Math.max(0, b.efetivado - abate);
    abate = Math.max(0, abate - b.efetivado);
    comprometido += Math.max(0, b.previsto - abate);
  }
  return { utilizado, comprometido };
}

/* "vence em 4 dias" responde a pergunta; "vence 20/08" faz o leitor calcular. */
function prazoDeVencimento(due) {
  const dias = Math.round((new Date(DB.paraISO(due) + 'T12:00:00') - new Date(todayISO() + 'T12:00:00')) / 86400000);
  if (dias < 0) return `venceu há ${-dias} ${-dias === 1 ? 'dia' : 'dias'}`;
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return `vence em ${dias} dias`;
}

/* "mai/2027" — o formato curto que cabe numa linha de resumo. O toLocaleDateString
   devolve "mai. de 2027", que gasta espaço para dizer o mesmo. */
function mesAno(d) {
  const x = new Date(d);
  const mes = x.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mes}/${x.getFullYear()}`;
}

/* O histórico completo, atrás de um toque. Ele existe para conferir o que já foi
   pago — pergunta legítima, mas que não disputa espaço com a fatura de agora.
   Ordem inversa: o mais recente primeiro, porque é o que se vem conferir. */
function openHistoricoFaturas(cardId) {
  const card = DB.get('cards', cardId);
  if (!card) return toast('Cartão não encontrado');
  const invoices = DB.invoicesOf(card).slice().reverse();
  openModal(`
    <div class="modal-title">${esc(card.name)} — histórico<button class="close-x" id="hf-back"><span data-ico="back"></span></button></div>
    ${invoices.map(inv => `<div class="invoice-row">
      <span class="badge ${inv.status.toLowerCase()}">${inv.status}</span>
      <span class="muted">${esc(rotuloDaFatura(inv.key))} · vence ${fmtDate(inv.due)}${inv.status === 'Parcial' ? ` · faltam ${fmt(inv.falta)}` : ''}</span>
      <span style="flex:1"></span>
      <button class="link-btn" data-inv-detail="${inv.key}">${inv.count} ${inv.count === 1 ? 'item' : 'itens'}</button>
      <span class="num">${fmt(inv.total)}</span>
      ${inv.status !== 'Paga' ? `<button class="link-btn" data-pay="${inv.key}">pagar</button>` : `<button class="link-btn" data-unpay="${inv.key}">↺</button>`}
    </div>`).join('') || '<div class="empty">Nenhuma fatura ainda.</div>'}
  `);
  $('#hf-back').onclick = closeModal;
  ligarAcoesDeFatura(document.querySelector('#modal') || document);
}

/* As futuras, abertas para conferência. Elas são parcelas de compras que já
   aconteceram: não se paga uma fatura que ainda não fechou, então aqui não há
   botão de pagar — só o detalhe de cada uma. */
function openFaturasFuturas(cardId) {
  const card = DB.get('cards', cardId);
  if (!card) return toast('Cartão não encontrado');
  const chaveAtual = DB.invoiceKeyFor(card, todayISO());
  const agora = new Date();
  const futuras = DB.invoicesOf(card).filter(i => i.key !== chaveAtual && i.closing > agora && i.falta > 0.005);
  const total = futuras.reduce((s, i) => s + i.falta, 0);
  openModal(`
    <div class="modal-title">${esc(card.name)} — ainda vai faturar<button class="close-x" id="ff-back"><span data-ico="back"></span></button></div>
    <div class="card" style="margin-bottom:var(--e4)">
      <div class="proj-row"><span>Total já comprado</span><b>${fmt(total)}</b></div>
      <div class="proj-row"><span>Faturas</span><b>${futuras.length}</b></div>
    </div>
    ${futuras.map(inv => `<div class="invoice-row">
      <span class="muted">${esc(rotuloDaFatura(inv.key))} · vence ${fmtDate(inv.due)}</span>
      <span style="flex:1"></span>
      <button class="link-btn" data-inv-detail="${inv.key}">${inv.count} ${inv.count === 1 ? 'item' : 'itens'}</button>
      <span class="num">${fmt(inv.falta)}</span>
    </div>`).join('') || '<div class="empty">Nada comprado para os próximos meses.</div>'}
  `);
  $('#ff-back').onclick = closeModal;
  ligarAcoesDeFatura(document.querySelector('#modal') || document);
}

/* Pagar, desfazer e abrir o detalhe valem na tela e dentro das duas folhas. Uma
   função só para os três, senão o botão funciona num lugar e é inerte no outro —
   que foi o que aconteceu quando o histórico virou folha. */
function ligarAcoesDeFatura(escopo) {
  if (!escopo || !escopo.querySelectorAll) return;
  escopo.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => openPagarFaturaSheet(b.dataset.pay));
  escopo.querySelectorAll('[data-inv-detail]').forEach(b => b.onclick = () => openInvoiceDetail(b.dataset.invDetail));
  escopo.querySelectorAll('[data-unpay]').forEach(b => b.onclick = () => {
    if (!confirm('Desfazer o pagamento desta fatura?\n\nOs lançamentos somem e o saldo da conta é devolvido.')) return;
    desfazerPagamentosDaFatura(b.dataset.unpay);
    Sync.autoSync(); render();
    toast('Pagamento desfeito');
  });
}

/* Classificar os gastos do mês: o que entra na projeção e o que não entra.

   A projeção do fim do mês extrapola o gasto VARIÁVEL, então ela depende de o app
   saber o que NÃO é variável. São duas coisas diferentes:

     conta fixa  o vínculo com o CONTRATO diz isso. Não é marca no lançamento —
                 é o contrato que sabe periodicidade, prazo e valor, e é ele que
                 gera a ocorrência dos meses seguintes.
     pontual     aconteceu e não volta. Sai do ritmo e não repete nada.

   Havia uma marca paralela (`recurring`) fazendo o papel de "conta fixa", e ela
   criava duas fontes para a mesma pergunta. Medido nesta base: marcar uma
   dentadura de R$ 770 como fixa somava R$ 770 às contas de setembro E de outubro,
   e o item não aparecia na tela "Contas fixas", que lê só contratos. Por isso a
   folha não marca "fixo": ela OFERECE o vínculo com o contrato.

   A folha existe porque a dúvida nasce no Painel, e de lá não havia como agir: o
   formulário não mostra mais a marca e a edição em massa fica a três telas.

   Ordena pelo VALOR: o que distorce a projeção são os poucos lançamentos grandes
   lidos como variável, e eles precisam estar no topo. */
function openClassificarGastos(period) {
  const p = period || DB.monthPeriod(new Date());
  const itens = DB.expensesOf(p)
    .filter(t => t.id && !t.virtual)          // previsão não se edita: não tem o que marcar
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));

  const v = DB.variavelProjetado(p);
  const conta = classe => itens.filter(t => DB.classeDoGasto(t) === classe).length;

  /* SUGESTÕES DE VÍNCULO: lançamento com o nome INTEIRO de um contrato ativo e sem
     vínculo. Aparecem em bloco no topo porque são o que mais distorce o ritmo — na
     base real, nove lançamentos de agosto somando R$ 5.460,80 que o app lia como
     gasto variável e multiplicava pelos dias restantes.

     Cada um pede confirmação. Casar sozinho por texto já errou 19 lançamentos aqui
     (a descrição do Pix traz o nome do banco), e o fato de a comparação agora ser
     do nome inteiro reduz o risco sem eliminá-lo. */
  const sugestoes = itens
    .map(t => ({ tx: t, contrato: DB.contratoSugeridoPara(t) }))
    .filter(s => s.contrato);

  openModal(`
    <div class="modal-title">O que entra na projeção — ${esc(p.label)}<button class="close-x" id="cg-back"><span data-ico="back"></span></button></div>
    <div class="cg-ajuda">
      <p><b>Variável</b> — o dia a dia. É o único que entra na projeção do fim do mês.</p>
      <p><b>Pontual</b> — aconteceu e não volta. Fica fora da projeção e não repete.</p>
      <p><b>É contrato</b> — conta fixa. Vincula ao contrato, que cuida dos próximos meses.</p>
      <p class="cg-conta">${conta('variavel')} variáveis · ${conta('pontual')} pontuais · ${conta('contrato')} de contrato</p>
    </div>
    ${sugestoes.length ? `<div class="cg-sug">
      <p class="cg-sug-tit">${sugestoes.length} ${sugestoes.length === 1 ? 'lançamento parece ser' : 'lançamentos parecem ser'} de conta fixa</p>
      <p class="muted">Têm o nome de um contrato ativo e estão contando como gasto variável. Vincular tira do ritmo e deixa o contrato cuidar dos próximos meses.</p>
      ${sugestoes.map(s => `<div class="cg-sug-l">
        <span><b>${esc(s.tx.description)}</b> <i>${fmtDay(s.tx.date)} · ${fmt(s.tx.amount)}</i></span>
        <button class="sec-btn" data-vincular="${s.tx.id}" data-contrato="${s.contrato.id}">vincular</button>
      </div>`).join('')}
    </div>` : ''}
    <div class="card" style="margin-bottom:var(--e3)">
      <div class="proj-row"><span>Variável até hoje</span><b>${fmt(v.diaRitmo * v.decorridos)}</b></div>
      <div class="proj-row"><span>Ritmo</span><b>${fmt(v.diaRitmo)}/dia</b></div>
      <div class="proj-row"><span>Estimado até o fim do mês</span><b>${fmt(Math.min(v.contido, v.ritmo))} a ${fmt(Math.max(v.contido, v.ritmo))}</b></div>
    </div>
    <div id="cg-lista">${itens.map(t => linhaDeClassificacao(t, DB.classeDoGasto(t))).join('')
      || '<div class="empty">Nenhum gasto lançado neste mês.</div>'}</div>
  `);
  $('#cg-back').onclick = closeModal;
  ligarClassificacao(p);
}

/* Uma linha: o lançamento e o que fazer com ele.

   Quem já é de CONTRATO não oferece botão: a repetição dele é decidida no
   contrato, e alternar aqui criaria um estado que o próximo cálculo desfaz. A
   linha diz de onde vem, e a tela "Contas fixas" é onde se mexe.

   "É contrato" é AÇÃO, não estado: abre a escolha do contrato. Sem contrato
   cadastrado ela não aparece — não há a que vincular, e um botão que não leva a
   nada é pior que botão nenhum. */
function linhaDeClassificacao(t, classe) {
  if (classe === 'contrato') {
    /* DESVINCULAR só existe para quem tem `recurrence_id`. A parcela é de contrato
       por outro caminho — o `installment` —, e um botão ali prometeria desfazer
       algo que ele não desfaz: a próxima parcela continuaria nascendo. */
    const contrato = t.recurrence_id ? DB.get('recurrences', t.recurrence_id) : null;
    return `<div class="cg-linha">
      <span class="cg-info"><b>${esc(t.description)}</b><small>${fmtDay(t.date)} · ${
        t.recurrence_id ? 'de ' + esc(contrato ? contrato.description : 'contrato') : 'parcela ' + esc(t.installment)}</small></span>
      <span class="cg-val">${fmt(t.amount)}</span>
      ${t.recurrence_id
        ? `<span class="cg-botoes"><button class="cg-b" data-desvincular="${t.id}">desvincular</button></span>`
        : '<span class="cg-travado">fora da projeção</span>'}
    </div>`;
  }
  const b = (valor, rot) => `<button class="cg-b ${classe === valor ? 'on' : ''}" data-classe="${valor}" data-tx="${t.id}">${rot}</button>`;
  const temContrato = DB.all('recurrences').some(r => r.status === 'ativa' && DB.isExpense(t));
  return `<div class="cg-linha">
    <span class="cg-info"><b>${esc(t.description)}</b><small>${fmtDay(t.date)}</small></span>
    <span class="cg-val">${fmt(t.amount)}</span>
    <span class="cg-botoes">${b('variavel', 'variável')}${b('pontual', 'pontual')}${
      temContrato ? `<button class="cg-b" data-escolher="${t.id}">é contrato</button>` : ''}</span>
  </div>`;
}

/* Escolher a qual contrato o lançamento pertence. Lista só os ATIVOS: vincular a
   um cancelado não faria o gasto se repetir, e a tela prometeria o contrário. */
function openEscolherContrato(txId, period) {
  const t = DB.get('transactions', txId);
  if (!t) return toast('Lançamento não encontrado');
  /* Só contratos ATIVOS e do mesmo tipo do lançamento. Vincular a um cancelado não
     faria o gasto se repetir — a tela prometeria o contrário —, e cruzar despesa
     com contrato de receita é o mesmo erro pelo outro lado.

     Ordenados pelo VALOR, como a folha: é assim que se reconhece o aluguel no meio
     de dez contratos, e não pela ordem em que foram cadastrados. */
  const ativos = DB.all('recurrences')
    .filter(r => r.status === 'ativa' && (r.type !== 'Receita') === DB.isExpense(t))
    .sort((a, b) => DB.valorDaRecorrencia(b) - DB.valorDaRecorrencia(a));
  openModal(`
    <div class="modal-title">De qual conta fixa?<button class="close-x" id="ec-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)"><b>${esc(t.description)}</b> · ${fmt(t.amount)} · ${fmtDay(t.date)}<br>
      Vincular tira este lançamento do ritmo do variável. Os próximos meses passam a
      vir do contrato, que já se lança sozinho na data certa.</p>
    ${ativos.map(r => `<button class="cg-esc" data-vincular="${t.id}" data-contrato="${r.id}">
      <span><b>${esc(r.description)}</b><i>dia ${esc(String(r.dia))} · ${fmt(DB.valorDaRecorrencia(r))}</i></span>
      <span data-ico="chev"></span>
    </button>`).join('') || '<div class="empty">Nenhuma conta fixa cadastrada ainda.</div>'}
    <p class="section-title" style="margin-top:var(--e4)">Ou crie uma nova</p>
    <button class="cg-esc" data-novo-contrato="${t.id}">
      <span><b>Criar conta fixa com este lançamento</b><i>usa a descrição, o valor e a categoria dele</i></span>
      <span data-ico="chev"></span>
    </button>
  `);
  $('#ec-back').onclick = () => openClassificarGastos(period);
  ligarClassificacao(period);
}

/* Criar o contrato a partir do lançamento, com o que a tabela precisa saber e
   nada além: periodicidade, dia e prazo. Descrição, valor, categoria, conta e
   método vêm do próprio lançamento — repetir isso num formulário seria pedir de
   novo o que o app já tem.

   O lançamento é VINCULADO ao contrato recém-criado. Sem isso ele continuaria
   contando como gasto variável, e a pessoa teria feito o trabalho sem ver o
   resultado — que é justamente o ritmo do mês baixar. */
function openCriarContrato(txId, period) {
  const t = DB.get('transactions', txId);
  if (!t) return toast('Lançamento não encontrado');
  const diaBase = Number(String(t.date || todayISO()).slice(8, 10)) || 1;
  openModal(`
    <div class="modal-title">Nova conta fixa<button class="close-x" id="nc-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)"><b>${esc(t.description)}</b> · ${fmt(t.amount)}<br>
      A primeira ocorrência do contrato é a PRÓXIMA — este lançamento já existe e
      já está aqui. Depois de criado, o app lança sozinho na data certa.</p>
    <div class="massa-campo">
      <label class="massa-liga"><span>Com que frequência?</span></label>
      <select id="nc-per">
        <option value="mensal">Todo mês</option>
        <option value="semanal">Toda semana</option>
        <option value="quinzenal">A cada 15 dias</option>
        <option value="anual">Todo ano</option>
      </select>
    </div>
    <div class="massa-campo">
      <label class="massa-liga"><span>Em que dia?</span></label>
      <input type="number" id="nc-dia" min="1" max="31" value="${diaBase}">
    </div>
    <div class="massa-campo">
      <label class="massa-liga"><span>Até quando?</span></label>
      <select id="nc-fim">
        <option value="sem_prazo">Até eu cancelar</option>
        <option value="vezes">Por um número de vezes</option>
        <option value="data">Até uma data</option>
      </select>
      <input type="number" id="nc-vezes" min="1" value="12" hidden>
      <input type="date" id="nc-data" hidden>
    </div>
    <div class="massa-campo">
      <label class="massa-liga"><span>O valor muda todo mês?</span></label>
      <select id="nc-valor">
        <option value="fixo">Não, é sempre o mesmo</option>
        <option value="media">Sim — usar a média (luz, água)</option>
      </select>
    </div>
    <button class="btn" id="nc-ok" style="margin-top:var(--e3)">Criar e vincular</button>
  `);
  $('#nc-back').onclick = () => openEscolherContrato(txId, period);
  // Os campos de prazo só aparecem quando fazem sentido
  const fim = $('#nc-fim');
  fim.onchange = () => {
    $('#nc-vezes').hidden = fim.value !== 'vezes';
    $('#nc-data').hidden = fim.value !== 'data';
  };
  $('#nc-ok').onclick = () => {
    const id = contratoDoLancamento(t, {
      periodicidade: $('#nc-per').value,
      dia: Number($('#nc-dia').value) || diaBase,
      valorTipo: $('#nc-valor').value,
      fimTipo: fim.value,
      fimData: $('#nc-data').value || null,
      fimVezes: Number($('#nc-vezes').value) || 12,
    });
    if (!id) return toast('Não foi possível criar a conta fixa');
    vincularAContrato(txId, id);
    openClassificarGastos(period);
  };
}

function ligarClassificacao(period) {
  document.querySelectorAll('#modal [data-classe]').forEach(b => b.onclick = () => {
    classificarGasto(b.dataset.tx, b.dataset.classe);
    openClassificarGastos(period);
  });
  document.querySelectorAll('#modal [data-escolher]').forEach(b => b.onclick = () =>
    openEscolherContrato(b.dataset.escolher, period));
  document.querySelectorAll('#modal [data-novo-contrato]').forEach(b => b.onclick = () =>
    openCriarContrato(b.dataset.novoContrato, period));
  document.querySelectorAll('#modal [data-vincular]').forEach(b => b.onclick = () => {
    vincularAContrato(b.dataset.vincular, b.dataset.contrato);
    openClassificarGastos(period);
  });
  document.querySelectorAll('#modal [data-desvincular]').forEach(b => b.onclick = () => {
    desvincularDoContrato(b.dataset.desvincular);
    openClassificarGastos(period);
  });
}

/* A gravação, fora do handler: o DOM falso da suíte não entrega elementos para
   `querySelectorAll`, então um teste que dependesse do clique não exercitaria
   nada — foi o que aconteceu antes, e a sabotagem passou despercebida.

   Só duas classes se gravam. "Conta fixa" não é classe: é vínculo, e mora em
   `vincularAContrato`. */
function classificarGasto(id, classe) {
  const t = DB.get('transactions', id);
  if (!t || !['variavel', 'pontual'].includes(classe)) return false;
  DB.upsert('transactions', { ...t, pontual: classe === 'pontual' });
  Sync.autoSync();
  return true;
}

/* Vincula um lançamento ao contrato. É o que faz dele "conta fixa": o vínculo sai
   do ritmo do variável por `testadorDeGastoFixo`, e a repetição passa a ser
   responsabilidade do contrato.

   Limpa `pontual` de propósito: um lançamento de contrato não é gasto único, e
   deixar as duas marcas faria cada leitor decidir sozinho qual vale. */
function vincularAContrato(txId, recId) {
  const t = DB.get('transactions', txId);
  const r = DB.get('recurrences', recId);
  if (!t || !r) return false;
  /* DESPESA com contrato de despesa, receita com receita. A tela já filtra, mas a
     função é o lugar onde isso tem de valer: um gasto vinculado ao contrato do
     salário sairia do ritmo por um caminho que não faz sentido nenhum, e o
     `restamDaRecorrencia` passaria a contar ocorrência de outro tipo. */
  if (DB.isExpense(t) !== (r.type !== 'Receita')) return false;
  DB.upsert('transactions', { ...t, recurrence_id: r.id, pontual: false });
  Sync.autoSync();
  toast(`"${t.description}" agora vem de ${r.description} ✓`);
  return true;
}

/* Desfazer o vínculo. O lançamento volta a ser gasto variável e entra no ritmo.

   O CONTRATO NÃO É TOCADO: desvincular é dizer "este lançamento não é aquela
   ocorrência", não "cancele a conta fixa" — para isso existe a tela "Contas
   fixas", que apaga as pendências junto. Apagar o contrato aqui destruiria a
   repetição inteira por causa de um vínculo errado num mês.

   E não recria a ocorrência: `ocorrenciaJaLancada` casa também por NOME dentro
   da janela, então o gerador continua enxergando o lançamento e não duplica. */
function desvincularDoContrato(txId) {
  const t = DB.get('transactions', txId);
  if (!t || !t.recurrence_id) return false;
  const r = DB.get('recurrences', t.recurrence_id);
  DB.upsert('transactions', { ...t, recurrence_id: null });
  Sync.autoSync();
  toast(`"${t.description}" desvinculado${r ? ' de ' + r.description : ''} — voltou a contar como variável`);
  return true;
}

/* ---------- Metas ---------- */
function renderMetas() {
  const goals = DB.all('goals');
  const ativas = goals.filter(g => !g.done).length;
  const guardado = goals.reduce((s, g) => s + DB.goalTotal(g.id), 0);

  /* Cabeçalho de seção, o mesmo padrão de Contas & Cartões e do Extrato: título e
     subtítulo à esquerda, ação à direita. Antes era um `.btn ghost` de largura
     inteira solto no topo — ele empurrava a lista para baixo e competia em peso
     com o conteúdo, além de não parecer da mesma família dos botões das outras
     telas. O subtítulo aproveita o espaço que o botão largo desperdiçava. */
  let html = `
    <div class="sec-cab">
      <div class="sec-tit">
        <b>Metas</b>
        <small>${goals.length
          ? `${fmtShort(guardado)} guardado${ativas ? ` · ${ativas} em andamento` : ''}`
          : 'objetivos com valor e prazo'}</small>
      </div>
      <div class="sec-acoes">
        <button class="sec-btn" id="btn-new-goal"><span data-ico="target"></span>Nova meta</button>
      </div>
    </div>`;
  if (!goals.length) html += `<div class="empty"><b>Nenhuma meta ainda</b>Crie a primeira: reserva de emergência, viagem, troca de carro…</div>`;
  for (const g of goals.sort((a, b) => Number(a.done) - Number(b.done))) {
    const total = DB.goalTotal(g.id);
    const pct = g.target_amount > 0 ? Math.round(total / g.target_amount * 100) : 0;
    const entries = DB.all('goal_entries').filter(e => e.goal_id === g.id).sort((a, b) => b.date.localeCompare(a.date));
    const planejado = DB.goalPlanejado(g.id);
    const proximo = entries.filter(e => !DB.aportePago(e) && Number(e.amount) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

    // Preditivo: ritmo de aportes → previsão de conclusão; e quanto/mês para cumprir a data alvo.
    let forecast = '';
    const remaining = Math.max(0, (Number(g.target_amount) || 0) - total);
    if (!g.done && remaining > 0) {
      const pace = DB.goalPace(g.id);
      const prazo = prazoDaMeta(remaining, pace);
      // Mesma régua do painel: acima de 10 anos a data vira ficção e o que ajuda
      // é o quanto por mês faltaria para o prazo caber numa vida
      if (prazo && prazo.longe) {
        forecast += `<div class="muted" style="margin-top:var(--e2)">🐢 Ritmo: <b>${fmtShort(pace)}/mês</b> → <b>${Math.round(prazo.meses / 12)} anos</b>. Para 5 anos: <b>${fmtShort(prazo.precisaria)}/mês</b></div>`;
      } else if (prazo) {
        forecast += `<div class="muted" style="margin-top:var(--e2)">📈 Ritmo: <b>${fmtShort(pace)}/mês</b> → conclusão prevista em <b>${esc(prazo.rotulo)}</b></div>`;
      } else {
        forecast += `<div class="muted" style="margin-top:var(--e2)">📈 Sem aportes nos últimos 90 dias — a meta está parada.</div>`;
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
      <!-- O PLANEJADO vem em linha própria, nunca somado ao guardado: são duas
           perguntas diferentes — "quanto já tenho" e "quanto pretendo ter". Somar
           daria uma barra cheia de dinheiro que ainda está na conta corrente. -->
      ${planejado > 0.005 ? `<div class="muted" style="margin-top:var(--e2)">📅 Mais <b>${fmtShort(planejado)}</b> já agendado${
        proximo ? ` — o próximo em ${fmtDay(proximo.date)}` : ''}. Ainda não entrou no guardado.</div>` : ''}
      ${forecast}
      <div class="btn-row">
        <button class="btn ghost" data-aporte="${g.id}">＋ Aporte</button>
        <button class="btn ghost" data-goal-detail="${g.id}">Ver histórico (${entries.length})</button>
      </div>
      ${entries.length ? `<p class="muted" style="margin-top:var(--e3);font-weight:600">Últimos aportes</p>` : ''}
      ${entries.slice(0, 2).map(e => `<div class="muted" style="margin-top:var(--e1)">· ${fmtDay(e.date)} — ${esc(e.description)} <b style="color:var(--paper)">${fmtShort(e.amount)}</b>${
        DB.aportePago(e) ? '' : ' <span class="selo-ajuste">agendado</span>'}</div>`).join('')}
      ${entries.length > 2 ? `<div class="muted" style="margin-top:var(--e2)">e mais ${entries.length - 2} — toque em <b>Ver histórico</b> para ver todos</div>` : ''}
    </div>`;
  }
  return html;
}

/* A marca no header: o nome do app e, quando a família escolheu um, o nome
   dela. É a linha que responde "que app é este, e de quem". A tela atual vem
   logo abaixo, em #topbar-month. */
function refreshIdentity() {
  const nome = DB.familyName();
  $('#topbar-hello').textContent = 'DOMI' + (nome ? ' · ' + nome : '');
  const side = $('#side-family');
  if (side) side.textContent = DB.familyLabel();
  document.title = nome ? `DOMI — ${nome}` : 'DOMI — Finanças da Família';
}


/* ---------- Relatórios ---------- */
/* ---------- Relatórios ----------
   A tela responde SEIS perguntas, em ordem, cada uma preparando a seguinte:

     1. O que aconteceu?        — a frase, com veredito estatístico
     2. Para onde foi o dinheiro? — a cascata: receita consumida bloco a bloco
     3. Isso é normal?          — 12 meses contra a faixa de normalidade da família
     4. O que mudou, e importa? — categorias contra a própria mediana delas
     5. Onde isso vai parar?    — projeção e orçamento
     6. O que está sendo construído? — reserva, metas, patrimônio

   A ordem não é decorativa: "gastei R$ 4.200 em Alimentação" só quer dizer algo
   depois de "sobrou R$ 300 este mês". Número sem o antes dele é trivia. */
/* Agregações do relatório, todas sobre o MESMO recorte de filtros.

   Ficam aqui em vez de no DB porque o DB não conhece o estado da tela, e porque
   o ponto crítico é justamente a consistência: a mesma peneira precisa passar em
   todas as janelas de tempo que a análise compara. */
const Rel = {
  despesas(period) {
    return DB.expensesOf(period).filter(t => passaNosFiltros(t, true));
  },
  gasto(period) {
    return this.despesas(period).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  },
  receita(period) {
    return DB.incomesOf(period)
      .filter(t => !t.card_id && passaNosFiltros(t, true))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  },
  porCategoria(period) {
    const out = {};
    for (const t of this.despesas(period)) {
      const raiz = DB.categoryRootId(t.category_id) || '_sem';
      out[raiz] = (out[raiz] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },
  /* Subcategorias de um envelope, sob o mesmo recorte. A chave '_direto' guarda o
     que foi lançado no envelope sem descer para uma subcategoria — some se ficar
     de fora, e a soma das partes não fecharia com o total do envelope. */
  porSubcategoria(period, raizId) {
    const out = {};
    for (const t of this.despesas(period)) {
      if ((DB.categoryRootId(t.category_id) || '_sem') !== raizId) continue;
      const chave = t.category_id && t.category_id !== raizId ? t.category_id : '_direto';
      out[chave] = (out[chave] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },
  porTipo(period) {
    const out = { Essencial: 0, Estilo: 0 };
    for (const t of this.despesas(period)) {
      const c = DB.categoryRoot(t.category_id);
      out[(c && c.kind) === 'Estilo' ? 'Estilo' : 'Essencial'] += Number(t.amount) || 0;
    }
    return out;
  },
};

function renderRelatorios() {
  const period = DB.monthPeriod(new Date(), state.repOffset || 0);
  const atual = (state.repOffset || 0) === 0;
  const filtrado = temFiltroAtivo();
  const txs = Rel.despesas(period);
  const total = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const receitas = Rel.receita(period);
  const resultado = receitas - total;
  const byCat = Rel.porCategoria(period);
  const kinds = Rel.porTipo(period);
  const stCheio = DB.statsFor(period);
  // Projeção precisa acompanhar o recorte, senão projeta o gasto total
  const st = { ...stCheio, spent: total,
    dailyAvg: total / Math.max(stCheio.elapsedDays, 1),
    projection: stCheio.elapsedDays >= stCheio.totalDays ? total
      : total + (total / Math.max(stCheio.elapsedDays, 1)) * (stCheio.totalDays - stCheio.elapsedDays) };

  /* Histórico de 12 meses, base de tudo que a tela afirma. Os meses ANTERIORES
     ao atual formam a régua — incluir o mês em curso, que está incompleto,
     puxaria a mediana para baixo e faria todo mês parecer alto no dia 5.

     O filtro vale para os 12: comparar "Alimentação deste mês" com "gasto total
     dos meses anteriores" diria "acima do normal" sem nada estar acima. */
  const evo = DB.serieMensal(12, p => Rel.gasto(p))
    .map(e => ({ ...e, rot: e.period.start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }));
  const fechados = evo.slice(0, -1).map(e => e.valor);
  const juizo = DB.anormalidade(total, fechados);

  const fmtPct = v => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
  const vsMediana = juizo.med > 0 ? (total - juizo.med) / juizo.med * 100 : 0;

  return `
    <!-- Mesma barra do extrato: mês, e os filtros logo abaixo. Sem a régua de
         dias — ela recortaria só o mês em análise, e o relatório inteiro compara
         MESES FECHADOS entre si. Meio mês contra doze meses cheios não é
         comparação, é erro de leitura. -->
    <div class="ext-topo">
      <div class="card month-nav">
        <button id="rep-prev" aria-label="Mês anterior" data-ico="chevL"></button>
        <div style="text-align:center">
          <b>${period.label}</b>
          <div class="muted" style="font-size:11.5px">${atual ? `dia ${st.elapsedDays} de ${st.totalDays}` : (state.repOffset || 0) > 0 ? 'ainda não chegou' : 'mês encerrado'}</div>
        </div>
        <button id="rep-next" aria-label="Próximo mês" data-ico="chevR" ${(state.repOffset || 0) >= 6 ? 'disabled style="opacity:.35"' : ''}></button>
      </div>
      ${barraDePilulas()}
    </div>
    ${filtrado ? `<p class="rel-recorte">Analisando um recorte: <b>${esc(filtrosAtivos().map(a => a.texto).join(' · '))}</b>.
      O recorte vale para os 12 meses do histórico, então as comparações continuam justas.</p>` : ''}

    ${relFrase({ period, atual, total, receitas, resultado, juizo, vsMediana, st, kinds, filtrado })}
    <!-- A LISTA do previsto vive no Painel, na seção "O que ainda vem", que reúne
         este mês e o próximo. Ela existia aqui também, e a mesma lista em duas
         telas envelhece em duas velocidades: cada mudança precisa lembrar das
         duas. Os Relatórios continuam falando do futuro pelos números e pelos
         gráficos — a frase do topo, o "Onde isso vai parar" e o "De onde vim,
         para onde vou" —, que é o que esta tela sabe fazer melhor que o Painel. -->
    <!-- Os três primeiros gráficos são a resposta em três tempos — de onde veio,
         para onde foi, se é normal. Em tela larga eles ficam lado a lado, porque
         a comparação entre os três É a leitura; empilhados, exigem rolar e o
         raciocínio se perde no caminho. -->
    <div class="grid-3">
      ${filtrado ? '' : relEntradas(period, receitas)}
      ${filtrado ? '' : relCascata({ receitas, kinds, resultado, total })}
      ${relNormal({ evo, fechados, juizo, total, atual, fmtPct, vsMediana, filtrado })}
    </div>
    ${relCategorias({ period, byCat, total })}
    ${relCortes(period, txs, total)}
    ${relProjecao({ period, st, atual, total, receitas, juizo, filtrado })}
    <!-- "De onde vim, para onde vou" também em mês futuro: é lá que a pergunta
         "como chego até setembro" se responde, e limitá-lo ao mês corrente tirava o
         gráfico justamente de quem está navegando o futuro. -->
    ${(atual || (state.repOffset || 0) > 0) && !filtrado ? relProximosMeses() : ''}
    ${relConstrucao({ period, receitas, resultado, filtrado })}

    <button class="btn ghost" id="btn-csv" style="display:flex;align-items:center;justify-content:center;gap:8px">
      <span data-ico="download"></span>Exportar ${period.label} em CSV</button>
  `;
}

/* 1. A frase. Um relatório que abre com doze números obriga o leitor a montar a
   conclusão sozinho — e quem não é do ramo não monta. Aqui o app diz o que
   entendeu, e o resto da tela serve de prova. */
function relFrase({ atual, total, receitas, resultado, juizo, vsMediana, st, kinds, filtrado }) {
  /* Com recorte ativo a frase muda de assunto. Dizer "sobrou" sobre um pedaço
     do mês seria falso: a receita da família não pertence a uma categoria, e
     "Alimentação − receita total" não é resultado de nada. */
  if (filtrado) {
    const contexto = juizo.incerto
      ? 'Ainda são poucos meses para dizer se é o normal deste recorte.'
      : Math.abs(juizo.desvios) < 1.5 || !juizo.relevante
        ? `Está <b>dentro do normal</b> para este recorte — de costume ${fmt(juizo.med)} por mês.`
        : `Está <b class="${juizo.desvios > 0 ? 'txt-red' : 'txt-green'}">${juizo.rotulo}</b>: de costume ${fmt(juizo.med)} por mês.`;
    return `
      <div class="card rel-frase">
        <span class="rel-frase-ico ${juizo.desvios > 1.5 && juizo.relevante ? 'ruim' : 'ok'}" data-ico="filter"></span>
        <div>
          <b>Este recorte consumiu <span class="txt-red">${fmt(total)}</span>${
            atual && st.projection > total ? `, e caminha para ${fmt(st.projection)}` : ''}.</b>
          <p class="muted">${contexto}</p>
        </div>
      </div>`;
  }
  const sobrou = resultado >= 0;
  const pctRenda = receitas > 0 ? Math.abs(resultado) / receitas * 100 : 0;
  const desejo = (kinds.Essencial + kinds.Estilo) > 0
    ? kinds.Estilo / (kinds.Essencial + kinds.Estilo) * 100 : 0;

  // Só afirma "acima do normal" com histórico bastante; senão diz que não sabe
  const contexto = juizo.incerto
    ? 'Ainda são poucos meses registrados para dizer se isso é o seu normal.'
    : Math.abs(juizo.desvios) < 1.5
      ? `O gasto está <b>dentro do seu normal</b> — a variação de ${Math.abs(Math.round(vsMediana))}% contra os meses anteriores é a oscilação de sempre.`
      : `O gasto está <b class="${juizo.desvios > 0 ? 'txt-red' : 'txt-green'}">${juizo.rotulo}</b>: ${
          Math.abs(Math.round(vsMediana))}% ${juizo.desvios > 0 ? 'acima' : 'abaixo'} da sua mediana de ${fmt(juizo.med)}.`;

  const projecao = atual && st.projection > 0
    ? ` No ritmo atual o mês fecha em <b>${fmt(st.projection)}</b>.` : '';

  return `
    <div class="card rel-frase">
      <span class="rel-frase-ico ${sobrou ? 'ok' : 'ruim'}" data-ico="${sobrou ? 'trend' : 'pie'}"></span>
      <div>
        <b>${receitas > 0
          ? `${sobrou ? 'Sobrou' : 'Faltou'} <span class="${sobrou ? 'txt-green' : 'txt-red'}">${fmt(Math.abs(resultado))}</span>${
              pctRenda ? `, ${Math.round(pctRenda)}% do que entrou` : ''}.`
          : `Saíram <span class="txt-red">${fmt(total)}</span> — nenhuma receita lançada no período.`}</b>
        <p class="muted">${contexto}${projecao}${
          desejo > 0 ? ` Dos gastos, <b>${Math.round(desejo)}%</b> foram desejos e ${100 - Math.round(desejo)}% necessidades.` : ''}</p>
      </div>
    </div>`;
}

/* De onde veio o dinheiro — e o aviso que vem ANTES da cascata de propósito.

   Empréstimo entra na conta como entrada, mas não é ganho: é dívida adiantada.
   Um relatório que soma empréstimo à receita e anuncia "sobrou R$ 2.000" está
   dizendo a maior mentira que um app de finanças consegue dizer. Por isso o
   aviso precede o cálculo do resultado. */
function relEntradas(period, receitas) {
  const porOrigem = DB.incomeByCategory(period);
  const linhas = Object.entries(porOrigem).sort((a, b) => b[1] - a[1]);
  if (!linhas.length) return '';

  // Empréstimo é reconhecido pelo envelope, não pelo nome do lançamento
  const ehEmprestimo = cid => /empr[eé]stimo|financiamento|antecipa/i.test(
    DB.categoryPath(cid === '_sem' ? null : cid) || '');
  const divida = linhas.filter(([cid]) => ehEmprestimo(cid)).reduce((s, l) => s + l[1], 0);

  return `
    <div class="card">
      <div class="card-head"><div><b>De onde vem o dinheiro</b>
        <small>origem das entradas do período</small></div>
        <span class="num" style="font-size:16px">${fmtShort(receitas)}</span></div>
      ${svgRanking(linhas.map(([cid, v]) => [catLabel(cid === '_sem' ? null : cid), v]))}
      ${divida > 0 ? `<p class="muted" style="margin-top:var(--e3)">⚠️ <b>${fmt(divida)}</b> vieram de empréstimo ou antecipação — <b>não são ganho</b>, são dívida adiantada. Descontando isso, a renda real do período foi <b>${fmt(receitas - divida)}</b>.</p>` : ''}
    </div>`;
}

/* 2. A cascata. Responde "por que sobrou tão pouco?", que uma pizza de
   categorias não responde: pizza mostra proporção entre gastos, não o consumo
   da receita até o resto. */
function relCascata({ receitas, kinds, resultado, total }) {
  if (!receitas && !total) return '';
  const passos = [];
  if (receitas > 0) passos.push({ rot: 'Entrou', valor: receitas, tipo: 'entra' });
  if (kinds.Essencial > 0) passos.push({ rot: 'Necessidades', valor: kinds.Essencial, tipo: 'sai' });
  if (kinds.Estilo > 0) passos.push({ rot: 'Desejos', valor: kinds.Estilo, tipo: 'sai' });
  const semKind = total - kinds.Essencial - kinds.Estilo;
  if (semKind > 0.005) passos.push({ rot: 'Sem categoria', valor: semKind, tipo: 'sai' });
  passos.push({ rot: resultado >= 0 ? 'Sobrou' : 'Faltou', valor: 0, tipo: 'total' });
  if (passos.length < 3) return '';

  return `
    <div class="card">
      <div class="card-head"><div><b>O caminho do dinheiro</b>
        <small>cada bloco começa onde o anterior parou — a soma é a própria forma</small></div></div>
      ${svgCascata(passos, { alt: 'Receita consumida por necessidades e desejos até o resultado' })}
      <div class="chart-foot">
        ${receitas > 0 ? `<span>Comprometido <b>${Math.round(total / receitas * 100)}%</b> da receita</span>` : ''}
        <span>Necessidades <b>${fmtShort(kinds.Essencial)}</b></span>
        <span>Desejos <b>${fmtShort(kinds.Estilo)}</b></span>
      </div>
    </div>`;
}

/* 3. A faixa de normalidade. "Normal" medido no histórico da própria família, e
   não contra um ideal de fora — comparar o gasto de alguém com uma média
   nacional não ajuda a decidir nada. */
function relNormal({ evo, fechados, juizo, total, atual, fmtPct, vsMediana, filtrado }) {
  const positivos = fechados.filter(v => v > 0);
  const mad = DB.desvioMediano(positivos);
  const dentro = Math.abs(juizo.desvios) < 1.5 || !juizo.relevante;
  return `
    <div class="card">
      <div class="card-head"><div><b>Isso é normal para vocês?</b>
        <small>12 meses · a faixa clara é o padrão${filtrado ? ' deste recorte' : ''} (mediana ± variação típica)</small></div>
        ${!juizo.incerto ? `<span class="rel-selo ${dentro ? 'ok' : juizo.desvios > 0 ? 'ruim' : 'bom'}">${
          dentro ? 'no padrão' : juizo.rotulo}</span>` : ''}
      </div>
      ${svgLinhaFaixa(evo, { alt: 'Gasto mensal dos últimos 12 meses contra a faixa de normalidade' })}
      <div class="chart-foot">
        <span>Seu normal <b>${fmtShort(juizo.med)}</b>${mad ? ` <span class="muted">± ${fmtShort(mad)}</span>` : ''}</span>
        <span>${atual ? 'Até agora' : 'Neste mês'} <b>${fmtShort(total)}</b></span>
        ${juizo.med > 0 ? `<span>Diferença <b class="${vsMediana > 0 ? 'txt-red' : 'txt-green'}">${fmtPct(vsMediana)}</b></span>` : ''}
        ${positivos.length ? `<span>Menor mês <b>${fmtShort(Math.min(...positivos))}</b></span>` : ''}
      </div>
      ${juizo.incerto ? '<p class="muted" style="margin-top:var(--e2)">Com menos de seis meses registrados, a faixa ainda é um chute. Ela fica confiável conforme o histórico cresce.</p>' : ''}
    </div>`;
}

/* 4. O que mudou — contra a mediana de cada categoria, não contra o mês
   anterior. Mês anterior é um ponto só: se ele teve o IPVA, TODA categoria
   aparece "caindo" e o relatório mente sem errar uma conta. */
function relCategorias({ period, byCat, total }) {
  // O mesmo recorte nos 6 meses de histórico: comparar categoria filtrada com
  // histórico cheio daria desvio onde não há desvio
  const historico = {};
  for (let i = 1; i <= 6; i++) {
    const porCat = Rel.porCategoria(DB.monthPeriod(new Date(), (state.repOffset || 0) - i));
    for (const [cid, v] of Object.entries(porCat)) (historico[cid] = historico[cid] || []).push(v);
  }
  const ids = [...new Set([...Object.keys(byCat), ...Object.keys(historico)])];
  const linhas = ids.map(cid => {
    const agora = byCat[cid] || 0;
    const hist = historico[cid] || [];
    const med = DB.mediana(hist);
    const delta = agora - med;
    return { cid, agora, med, delta, novo: !hist.length && agora > 0 };
  }).filter(l => l.agora > 0 || Math.abs(l.delta) > 0.005);

  const porGasto = [...linhas].sort((a, b) => b.agora - a.agora);
  // Quem mais mexeu no resultado, para cima ou para baixo — é a explicação
  const movers = [...linhas].filter(l => Math.abs(l.delta) > Math.max(20, l.med * 0.15))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);

  const fatias = porGasto.slice(0, 6)
    .map((l, i) => ({ label: catLabel(l.cid === '_sem' ? null : l.cid), value: l.agora, color: PALETTE[i % PALETTE.length] }))
    .filter(f => f.value > 0);
  const resto = porGasto.slice(6).reduce((s, l) => s + l.agora, 0);
  if (resto > 0) fatias.push({ label: 'Outras', value: resto, color: '#c4cad4' });

  return `
    ${movers.length ? `<div class="card">
      <div class="card-head"><div><b>O que explica a diferença</b>
        <small>maiores desvios contra a mediana de cada categoria nos últimos 6 meses</small></div></div>
      <div class="rel-movers">
        ${movers.map(l => `<div class="mover ${l.delta > 0 ? 'sobe' : 'desce'}">
          <span class="mover-cat">${esc(catLabel(l.cid === '_sem' ? null : l.cid))}</span>
          <span class="mover-delta"><i class="pt pt-${l.delta > 0 ? 'dn' : 'up'}"></i>${fmtShort(Math.abs(l.delta))}</span>
          <small>${l.novo ? 'não aparecia antes' : `${fmtShort(l.agora)} contra ${fmtShort(l.med)} de costume`}</small>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Para onde foi</b><small>divisão do gasto no período</small></div></div>
        ${fatias.length ? `<div class="donut-wrap">${svgDonut(fatias, total, { caption: 'no período' })}
          <div class="legend">${fatias.map(f => `<div class="legend-row"><i class="legend-dot" style="background:${f.color}"></i>
            <span class="legend-name">${esc(f.label)}</span><span class="legend-pct">${Math.round(f.value / total * 100)}%</span>
            <span class="legend-val">${fmtShort(f.value)}</span></div>`).join('')}</div></div>`
          : '<div class="empty">Sem gastos no período.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Envelope por dentro</b>
          <small>cada barra dividida nas subcategorias — o tom é a subcategoria, o matiz é o envelope</small></div></div>
        ${svgComposicao(porGasto.slice(0, 8).filter(l => l.agora > 0).map(l => {
          const subs = Rel.porSubcategoria(period, l.cid);
          const partes = Object.entries(subs)
            .map(([sid, v]) => ({ rot: sid === '_direto' ? 'sem subcategoria' : ((catOf(sid) || {}).name || '—'), valor: v }))
            .sort((a, b) => b.valor - a.valor);
          return { id: l.cid, rot: catLabel(l.cid === '_sem' ? null : l.cid), total: l.agora, partes };
        }))}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><b>Detalhe por categoria</b>
        <small>quanto pesou e como se compara com o costume — toque num envelope para abrir as subcategorias</small></div></div>
      <div class="table-wrap"><table class="rep-table">
        <thead><tr><th>Categoria</th><th class="num">Neste mês</th><th class="num">De costume</th><th>Variação</th></tr></thead>
        <tbody>${porGasto.length ? porGasto.map(l => {
          const subs = l.agora > 0 ? Rel.porSubcategoria(period, l.cid) : {};
          const linhasSub = Object.entries(subs).sort((a, b) => b[1] - a[1]);
          /* A subcategoria também é comparada com a mediana DELA, não com uma
             fatia da mediana do envelope: se o mercado subiu e o delivery caiu na
             mesma medida, o envelope não se mexe e nada apareceria — mas são duas
             mudanças reais, com decisões diferentes por trás. */
          const medSub = {};
          for (let i = 1; i <= 6; i++) {
            const hist = Rel.porSubcategoria(DB.monthPeriod(new Date(), (state.repOffset || 0) - i), l.cid);
            for (const [sid, v] of Object.entries(hist)) (medSub[sid] = medSub[sid] || []).push(v);
          }
          const temSub = linhasSub.length > 1 || (linhasSub.length === 1 && linhasSub[0][0] !== '_direto');
          return `<tr class="rep-raiz${temSub ? ' abre' : ''}" ${temSub ? `data-abre-cat="${l.cid}"` : ''}>
            <td>${temSub ? '<span class="rep-seta" data-ico="chev"></span>' : ''}${esc(catLabel(l.cid === '_sem' ? null : l.cid))}</td>
            <td class="num">${valorCelula(l.agora, total)}</td>
            <td class="num muted">${l.med > 0 ? fmtShort(l.med) : '—'}</td>
            <td>${deltaCelula(l.delta, l.med, l.novo)}</td>
          </tr>` + (temSub ? linhasSub.map(([sid, v]) => {
            const m = DB.mediana(medSub[sid] || []);
            const d = v - m;
            return `<tr class="rep-sub" data-sub-de="${l.cid}" hidden>
              <td>${sid === '_direto' ? '<i>sem subcategoria</i>' : esc((catOf(sid) || {}).name || '—')}</td>
              <td class="num">${valorCelula(v, total)}</td>
              <td class="num muted">${m > 0 ? fmtShort(m) : '—'}</td>
              <td>${deltaCelula(d, m, !(medSub[sid] || []).length && v > 0)}</td>
            </tr>`;
          }).join('') : '');
        }).join('') : '<tr><td colspan="4" class="empty">Sem dados.</td></tr>'}</tbody>
      </table></div>
      <p class="muted" style="margin-top:var(--e2)">“=” quer dizer variação pequena demais para ser notícia — abaixo de 15% ou R$ 20.</p>
    </div>`;
}

/* Quanto a linha pesa no gasto do período.

   Medido sempre contra o TOTAL da família, inclusive nas subcategorias — assim a
   coluna tem um sentido só, e os pesos das filhas somam exatamente o peso do
   envelope. Fosse "% do envelope" nas filhas, a mesma coluna diria duas coisas
   diferentes e a conferência de cabeça deixaria de fechar. */
function pesoCelula(valor, total) {
  if (!(total > 0) || !(valor > 0)) return '';
  const pct = valor / total * 100;
  // Abaixo de 0,5% arredondaria para 0% e pareceria zero, sendo que houve gasto
  return `${pct < 0.5 ? '<1' : Math.round(pct)}%`;
}

/* O valor com o peso embaixo, no mesmo formato da variação.

   Numa coluna própria o peso pedia uma quinta coluna, e a tabela passava a rolar
   na horizontal no celular. Embaixo do valor ele também fica mais perto do que
   qualifica: cada número passa a vir com a própria leitura relativa — quanto foi
   e quanto pesou, quanto mudou e quanto isso representa. */
function valorCelula(valor, total) {
  const peso = pesoCelula(valor, total);
  return `<span class="val-rel">${fmtShort(valor)}${peso ? `<i>${peso}</i>` : ''}</span>`;
}

/* A célula de variação, nos dois níveis da tabela. O piso de relevância é o mesmo
   do resto da tela: abaixo de 15% ou R$ 20 é oscilação, não notícia.

   Mostra os dois lados da mesma variação porque um sem o outro engana: R$ 150 é
   enorme sobre um costume de R$ 200 e irrelevante sobre R$ 5.000, e "+75%" não
   diz se mexeu no bolso. O percentual é a interpretação, o valor é o tamanho. */
function deltaCelula(delta, mediana, novo) {
  if (novo) return '<span class="muted">novo</span>';
  if (Math.abs(delta) < Math.max(20, mediana * 0.15)) return '<span class="muted">=</span>';
  const pct = mediana > 0 ? Math.round(Math.abs(delta) / mediana * 100) : null;
  // Acima de 10× o percentual vira número sem significado ("1400%"); o múltiplo
  // é mais fácil de dimensionar
  const rel = pct === null ? '' : pct >= 1000 ? '10×+' : `${pct}%`;
  return `<span class="delta ${delta > 0 ? 'txt-red' : 'txt-green'}">${delta > 0 ? '▲' : '▼'} ${fmtShort(Math.abs(delta))}${
    rel ? `<i>${rel}</i>` : ''}</span>`;
}

/* Cortes transversais: os mesmos gastos vistos por outros eixos. Categoria
   responde "em quê"; estes respondem "por quem", "de que forma" e "a serviço de
   quê" — a etiqueta atravessa envelopes e é a única que mede um assunto inteiro
   (uma viagem, uma reforma) espalhado por várias categorias. */
function relCortes(period, txs, total) {
  const soma = chave => {
    const out = {};
    for (const t of txs) { const k = t[chave] || '—'; out[k] = (out[k] || 0) + (Number(t.amount) || 0); }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  };
  const porTag = Object.entries(DB.spentByTag(period)).sort((a, b) => b[1] - a[1]);
  const maiores = [...txs].sort((a, b) => (b.amount || 0) - (a.amount || 0)).slice(0, 8);

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>Quem gastou</b><small>por membro da família</small></div></div>
        ${svgRanking(soma('member'))}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Como pagou</b><small>por forma de pagamento</small></div></div>
        ${svgRanking(soma('method'))}
      </div>
    </div>
    ${porTag.length ? `<div class="card">
      <div class="card-head"><div><b>Por etiqueta</b>
        <small>assuntos que atravessam categorias — toque para ver os lançamentos</small></div></div>
      ${svgRanking(porTag.map(([tag, v]) => ['#' + tag, v]), null,
        // Clique na barra abre os lançamentos da etiqueta — o "#" volta a sair aqui
        { aoClicar: nome => verLancamentosDaTag(String(nome).replace(/^#/, '')) })}
    </div>` : ''}
    ${maiores.length ? `<div class="card">
      <div class="card-head"><div><b>Maiores gastos</b>
        <small>os ${maiores.length} lançamentos que mais pesaram${total > 0 ? ` — juntos, ${Math.round(maiores.reduce((s, t) => s + Number(t.amount || 0), 0) / total * 100)}% do total` : ''}</small></div></div>
      <div class="table-wrap"><table class="rep-table">
        <tbody>${maiores.map(t => `<tr>
          <td>${esc(t.description)}<br><small class="muted">${fmtDay(t.date)} · ${esc(catLabel(t.category_id))}</small></td>
          <td class="num">${fmt(t.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}`;
}

/* 5. Onde vai parar. Projeção só faz sentido no mês corrente; em mês fechado a
   pergunta é outra — quanto do orçamento foi usado. */
function relProjecao({ period, st, atual, total, receitas, juizo, filtrado }) {
  // Orçamento é da família inteira: comparar um recorte contra ele diria que
  // "Alimentação usou 12% do orçamento", o que não responde pergunta nenhuma
  const orcamento = filtrado ? 0 : DB.budgetTotal(period);
  const pctOrc = orcamento > 0 ? Math.round(total / orcamento * 100) : 0;
  const proj = st.projection;
  const estoura = orcamento > 0 && proj > orcamento;

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>${atual ? 'Onde isso vai parar' : 'Como o mês fechou'}</b>
          <small>${atual ? `média de ${fmt(st.dailyAvg)} por dia nos ${st.elapsedDays} dias corridos` : 'gasto contra orçamento'}</small></div></div>
        ${orcamento > 0 ? `
          <div class="budget-head"><span class="muted">Uso do orçamento</span>
            <span class="num">${pctOrc}% <span class="muted">de ${fmtShort(orcamento)}</span></span></div>
          <div class="bar ${barClass(pctOrc)}"><i style="width:${Math.min(100, pctOrc)}%"></i></div>` : ''}
        ${atual ? `<div class="proj-row" style="margin-top:var(--e3)"><span>Projeção do fechamento</span><b class="${estoura ? 'txt-red' : ''}">${fmt(proj)}</b></div>
          ${orcamento > 0 ? `<div class="proj-row"><span>${estoura ? 'Deve passar do orçamento em' : 'Deve sobrar do orçamento'}</span><b class="${estoura ? 'txt-red' : 'txt-green'}">${fmt(Math.abs(orcamento - proj))}</b></div>` : ''}
          <div class="proj-row"><span>Para fechar no seu normal, gastar por dia</span><b>${
            st.remainingDays > 0 && juizo.med > total ? fmt((juizo.med - total) / st.remainingDays) : fmt(0)}</b></div>`
          : `<div class="proj-row" style="margin-top:var(--e3)"><span>Gasto do mês</span><b>${fmt(total)}</b></div>
             <div class="proj-row"><span>Receita do mês</span><b class="txt-green">${fmt(receitas)}</b></div>`}
      </div>
      <div class="card">
        <div class="card-head"><div><b>${atual ? 'Saldo projetado' : 'Ritmo do mês'}</b>
          <small>${atual ? 'cruzando o que ainda entra e sai, nas datas' : 'gasto acumulado dia a dia'}</small></div></div>
        ${atual ? projecaoCard(period) : svgBurnup(period, DB.budgetTotal(period) || undefined)}
      </div>
    </div>`;
}

/* A curva do saldo até o fim do ciclo.

   Responde o que nenhuma outra tela responde: EM QUE DIA o dinheiro acaba. Um
   mês que fecha positivo pode passar por zero no meio do caminho, e é no meio do
   caminho que a conta atrasa. */
function projecaoCard(period) {
  const serie = DB.projecaoSaldo(DB.fimISO(period));
  if (serie.length < 2) return '<div class="empty">Sem movimento previsto até o fim do ciclo.</div>';
  const negativo = serie.find(p => p.saldo < 0);
  const fim = serie[serie.length - 1];
  const menor = serie.reduce((m, p) => (p.saldo < m.saldo ? p : m), serie[0]);
  const dia = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

  return `
    ${svgLinhaFaixa(serie.map(p => ({ valor: p.saldo, rot: String(new Date(p.data + 'T12:00:00').getDate()) })),
      { alt: 'Saldo projetado dia a dia até o fim do ciclo', height: 190 })}
    <div class="chart-foot">
      <span>Hoje <b>${fmtShort(serie[0].saldo)}</b></span>
      <span>Menor ponto <b class="${menor.saldo < 0 ? 'txt-red' : ''}">${fmtShort(menor.saldo)}</b> <span class="muted">${dia(menor.data)}</span></span>
      <span>Fecha em <b class="${fim.saldo < 0 ? 'txt-red' : 'txt-green'}">${fmtShort(fim.saldo)}</b></span>
    </div>
    ${negativo
      ? `<p class="muted" style="margin-top:var(--e2)">⚠️ Fica negativo em <b>${dia(negativo.data)}</b>, chegando a <b class="txt-red">${fmt(negativo.saldo)}</b>. Antecipar uma entrada ou adiar uma conta resolve.</p>`
      : '<p class="muted" style="margin-top:var(--e2)">O saldo se mantém positivo até o fim do ciclo com o que está previsto.</p>'}`;
}

/* Os próximos meses: o que já está prometido antes de acontecer.

   Nenhuma outra tela responde isto. O extrato mostra o passado e o mês corrente;
   a projeção diária para no fim do ciclo. Mas o financiamento tem 22 parcelas, o
   IPVA vence em setembro e o aluguel não vai parar — tudo isso já é decidido, e
   ver antes é o que permite não se surpreender.

   O saldo ROLA de um mês para o outro: um mês negativo no meio contamina os
   seguintes, e olhar mês a mês isolado esconde exatamente isso. */
function relProximosMeses() {
  const meses = DB.fluxoMensal(6, 6);
  if (meses.length < 3) return '';
  const futuros = meses.filter(m => m.futuro);
  const negativo = futuros.find(m => m.saldo < 0);
  const nomeMes = p => p.start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
  const hoje = meses.find(m => !m.futuro && m === meses[meses.filter(x => !x.futuro).length - 1]);
  const fim = meses[meses.length - 1];

  return `
    <div class="card">
      <div class="card-head"><div><b>De onde vim, para onde vou</b>
        <small>seis meses atrás e seis à frente · à direita da linha é previsão</small></div>
        ${negativo ? `<span class="rel-selo ruim">aperto em ${esc(nomeMes(negativo.period))}</span>`
          : '<span class="rel-selo bom">no azul</span>'}
      </div>
      ${svgFluxoSaldo(meses)}
      <p class="fl-nota">Barras: o que entrou e saiu em cada mês (escala à esquerda).
        Área: o saldo acumulado (escala à direita, em azul). São duas unidades
        diferentes — onde a linha cruza as barras não significa nada.</p>
      <div class="chart-foot">
        <span>Hoje <b>${fmtShort(hoje ? hoje.saldo : 0)}</b></span>
        <span>Em ${esc(nomeMes(fim.period))} <b class="${fim.saldo < 0 ? 'txt-red' : 'txt-green'}">${fmtShort(fim.saldo)}</b></span>
        <span>Previsto entrar <b class="txt-green">${fmtShort(futuros.reduce((s, m) => s + m.entra, 0))}</b></span>
        <span>Previsto sair <b class="txt-red">${fmtShort(futuros.reduce((s, m) => s + m.sai, 0))}</b></span>
      </div>
      <p class="muted" style="margin-top:var(--e2)">${negativo
        ? `⚠️ Com o que já está prometido, o saldo fecha <b class="txt-red">${fmt(negativo.saldo)}</b> em <b>${esc(nomeMes(negativo.period))}</b>. Ainda dá tempo de mudar.`
        : 'O saldo se mantém positivo nos próximos seis meses. A previsão só conhece o que está cadastrado como conta fixa — receita fora disso não entra nesta conta.'}</p>
    </div>`;
}

/* 6. O que está sendo construído. Um relatório que só mede gasto conta metade da
   história: sobrar dinheiro sem destino e sobrar dinheiro virando reserva são
   coisas diferentes, e é a segunda que muda uma vida financeira. */
function relConstrucao({ period, receitas, resultado, filtrado }) {
  const reserva = DB.reserveTotal();
  const gastoMedio = DB.avgMonthlySpend();
  const meses = gastoMedio > 0 ? reserva / gastoMedio : 0;
  const contas = DB.accountsTotal();
  const metas = DB.all('goals').filter(g => !g.done && !DB.isReserveGoal(g));
  /* Taxa de poupança só existe com a receita inteira: sob recorte, o resultado
     não é resultado de nada.

     E só em mês que JÁ ACONTECEU. Num mês futuro, `resultado` é a receita menos as
     contas contratadas — o gasto variável ainda não existe —, e a divisão daria
     uma taxa de 60% que não descreve poupança nenhuma. É o mesmo engano que a
     "Poupança projetada" do Painel cometia: chamar de sobra o que ainda vai ser
     gasto. Aqui a linha desaparece e o card segue falando do que é fato —
     patrimônio, reserva e cobertura. */
  const mesFuturo = DB.inicioISO(period) > DB.hojeISO();
  const taxa = !filtrado && !mesFuturo && receitas > 0 ? resultado / receitas * 100 : null;

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><b>O que está sendo construído</b>
          <small>reserva e patrimônio — sempre o total, não o recorte</small></div></div>
        <div class="proj-row"><span>Em contas hoje</span><b>${fmt(contas)}</b></div>
        <div class="proj-row"><span>Reserva de emergência</span><b class="${meses >= 6 ? 'txt-green' : meses >= 3 ? '' : 'txt-red'}">${fmt(reserva)}</b></div>
        <div class="proj-row"><span>Cobre quanto tempo</span><b class="${meses >= 6 ? 'txt-green' : meses >= 3 ? '' : 'txt-red'}">${
          meses > 0 ? `${meses.toFixed(1)} meses` : '—'}</b></div>
        ${taxa !== null ? `<div class="proj-row"><span>Taxa de poupança do mês</span><b class="${taxa >= 20 ? 'txt-green' : taxa >= 0 ? '' : 'txt-red'}">${Math.round(taxa)}%</b></div>` : ''}
        <p class="muted" style="margin-top:var(--e2)">${
          meses >= 6 ? 'A reserva cobre seis meses de gasto — o patamar em que uma emergência deixa de virar dívida.'
          : meses >= 3 ? `Faltam ${fmt(gastoMedio * 6 - reserva)} para chegar aos seis meses de cobertura.`
          : `Uma reserva de seis meses seria ${fmt(gastoMedio * 6)}, medida pelo seu próprio gasto médio.`}</p>
      </div>
      <div class="card">
        <div class="card-head"><div><b>Metas em andamento</b><small>${metas.length || 'nenhuma'} ativa${metas.length === 1 ? '' : 's'}</small></div></div>
        ${metas.length ? metas.slice(0, 4).map(g => {
          const tot = DB.goalTotal(g.id);
          const pct = g.target_amount > 0 ? Math.round(tot / g.target_amount * 100) : 0;
          return `<div class="budget-item">
            <div class="budget-head"><span>${esc(g.icon || '🎯')} ${esc(g.name)}</span>
              <span class="num">${fmtShort(tot)} <span class="muted">de ${fmtShort(g.target_amount)}</span></span></div>
            <div class="bar bar-green"><i style="width:${Math.min(100, pct)}%"></i></div>
          </div>`;
        }).join('') : '<div class="empty">Nenhuma meta ativa. O dinheiro que sobra rende mais quando tem nome.</div>'}
      </div>
    </div>`;
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
  /* Andar para FRENTE também, até seis meses: as parcelas de cartão e as contas
     agendadas já vivem lá, e não havia como olhá-las. O limite existe porque só
     o ciclo atual é materializado — mais adiante o extrato ficaria quase vazio e
     pareceria defeito, e para isso serve a previsão dos Relatórios. */
  if (next) next.onclick = () => {
    if (state.monthOffset >= 6) return;
    state.monthOffset++; zerarJanela(); render();
  };
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
  const btnMassa = $('#btn-massa');
  if (btnMassa) btnMassa.onclick = () => openMassaModal(DB.monthPeriod(new Date(), state.monthOffset));
  // Fatura na lista do extrato leva direto para o pagamento
  v.querySelectorAll('[data-fatura]').forEach(el => el.onclick = () => openPagarFaturaSheet(el.dataset.fatura));
  /* Abre as subcategorias de um envelope sem redesenhar a tela: refazer o
     relatório inteiro recalcularia 12 meses de histórico e perderia a rolagem,
     num toque que só precisa mostrar quatro linhas. */
  // Abre os itens de um mês futuro, sem redesenhar a tela
  v.querySelectorAll('[data-prox]').forEach(tr => tr.onclick = () => {
    const k = tr.dataset.prox;
    const aberto = tr.classList.toggle('aberto');
    v.querySelectorAll(`[data-prox-de="${k}"]`).forEach(el => { el.hidden = !aberto; });
  });
  v.querySelectorAll('[data-abre-cat]').forEach(tr => tr.onclick = () => {
    const cid = tr.dataset.abreCat;
    const aberto = tr.classList.toggle('aberto');
    v.querySelectorAll(`[data-sub-de="${cid}"]`).forEach(sub => { sub.hidden = !aberto; });
  });
  /* Ações da fila de pendências, resolvidas ali mesmo. Mandar a pessoa abrir o
     lançamento para marcar como pago transformaria três toques no que deve ser
     um — e a fila existe justamente para o que venceu não apodrecer. */
  v.querySelectorAll('[data-pend-ok]').forEach(b => b.onclick = () => {
    const tipo = b.dataset.pendTipo;
    if (tipo === 'fatura') return openPagarFaturaSheet(b.dataset.pendOk);
    /* APORTE: confirmar é quando o dinheiro se move de verdade — até aqui ele era
       plano. A transferência que acompanha o aporte é encontrada pela data e pelo
       valor, porque `goal_entries` não guarda o id dela; sem casar as duas, o
       extrato ficaria com a linha "A Pagar" para sempre. */
    if (tipo === 'aporte') {
      const e = DB.get('goal_entries', b.dataset.pendOk);
      if (!e) return;
      DB.upsert('goal_entries', { ...e, status: 'Pago' });
      if (e.from_account) adjustBalance(e.from_account, -Number(e.amount) || 0);
      if (e.to_account) adjustBalance(e.to_account, Number(e.amount) || 0);
      const irmã = DB.all('transactions').find(t => t.status === 'A Pagar' && DB.isTransfer(t)
        && String(t.date) === String(e.date)
        && Math.abs(Number(t.amount) - Number(e.amount)) < 0.005
        && t.account_id === e.from_account && t.to_account === e.to_account);
      if (irmã) DB.upsert('transactions', { ...irmã, status: 'Pago' });
      Sync.autoSync(); render();
      return toast('Guardado ✓');
    }
    const t = DB.get('transactions', b.dataset.pendOk);
    if (!t) return;
    const pago = { ...t, status: 'Pago' };
    DB.upsert('transactions', pago);
    applyTxEffect(pago, +1);          // é agora que o dinheiro se move
    Sync.autoSync(); render();
    toast(DB.isExpense(t) ? 'Pago ✓' : 'Recebido ✓');
    avisarSeUsouGuardado(pago);
  });
  /* Adiar muda a data, não some com a conta: o boleto que não foi pago hoje
     continua existindo, e escondê-lo seria a forma mais rápida de o app perder a
     confiança de quem usa. */
  v.querySelectorAll('[data-pend-adiar]').forEach(b => b.onclick = () => {
    // Aporte adiado é o caso mais comum de simulação: "esse mês não dá, empurro
    // para o próximo". Só a data muda — o plano continua existindo.
    if (b.dataset.pendTipo === 'aporte') {
      const e = DB.get('goal_entries', b.dataset.pendAdiar);
      if (!e) return;
      const g = DB.get('goals', e.goal_id) || {};
      openSheet(`
        <div class="sheet-title">Adiar — guardar em ${esc(g.name || 'meta')}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
        <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">O plano continua de pé, só muda a data. Ele volta à fila no novo dia.</p>
        <div class="field"><label>Nova data</label><input id="ad-data" type="date" value="${somarDias(DB.paraISO(new Date()), 1)}"></div>
        <button class="btn" id="sh-save">Adiar</button>
        <div class="btn-row"><button class="btn ghost t-danger" id="ad-cancelar">Não vou guardar — excluir</button></div>
      `);
      $('#sh-close').onclick = closeSheet;
      $('#sh-save').onclick = () => {
        const nova = $('#ad-data').value;
        if (!nova) return toast('Escolha a nova data');
        DB.upsert('goal_entries', { ...e, date: nova });
        closeSheet(); Sync.autoSync(); render();
        toast(`Adiado para ${fmtDate(new Date(nova + 'T12:00:00'))} ✓`);
      };
      $('#ad-cancelar').onclick = () => {
        DB.remove('goal_entries', e.id);
        closeSheet(); Sync.autoSync(); render();
        toast('Plano removido');
      };
      return;
    }
    const t = DB.get('transactions', b.dataset.pendAdiar);
    if (!t) return;
    openSheet(`
      <div class="sheet-title">Adiar — ${esc(t.description)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
      <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">A conta continua a pagar, só muda a data. Ela volta à fila no novo dia.</p>
      <div class="field"><label>Nova data</label><input id="ad-data" type="date" value="${somarDias(DB.paraISO(new Date()), 1)}"></div>
      <button class="btn" id="sh-save">Adiar</button>
      <div class="btn-row"><button class="btn ghost t-danger" id="ad-cancelar">Não vou pagar — excluir</button></div>
    `);
    $('#sh-close').onclick = closeSheet;
    $('#sh-save').onclick = () => {
      const nova = $('#ad-data').value;
      if (!nova) return toast('Escolha a nova data');
      DB.upsert('transactions', { ...t, date: nova });
      closeSheet(); Sync.autoSync(); render();
      toast(`Adiado para ${fmtDate(new Date(nova + 'T12:00:00'))} ✓`);
    };
    $('#ad-cancelar').onclick = () => {
      if (!confirm('Excluir este lançamento?\n\nEle sai da fila e do extrato. O saldo não muda, porque ainda não tinha sido pago.')) return;
      DB.remove('transactions', t.id);
      closeSheet(); Sync.autoSync(); render();
      toast('Excluído');
    };
  });

  const rprev = $('#rep-prev'), rnext = $('#rep-next');
  if (rprev) rprev.onclick = () => { state.repOffset = (state.repOffset || 0) - 1; render(); };
  if (rnext) rnext.onclick = () => { if ((state.repOffset || 0) >= 6) return; state.repOffset = (state.repOffset || 0) + 1; render(); };
  /* "Ver os N no extrato": leva ao mês do card, filtrado por "A Pagar".

     Sem o filtro o destino seria o extrato inteiro — 120 linhas em julho, contra
     as 10 do card — e quem tocou em "ver mais" não encontraria o que estava
     olhando. `setTab` zera mês e filtros, então os dois são ajustados DEPOIS dele. */
  v.querySelectorAll('[data-vermais]').forEach(b => b.onclick = () => {
    const alvo = Number(b.dataset.vermais) || 0;
    setTab('extrato');
    state.monthOffset = alvo;
    state.filtros.situacao = ['A Pagar'];
    render();
  });
  const goRep = $('#go-reports');
  if (goRep) goRep.onclick = () => setTab('relatorios');
  const futVer = $('#fut-ver');
  if (futVer) futVer.onclick = () => setTab('relatorios');
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
  v.querySelectorAll('[data-ver-tag]').forEach(el =>
    el.onclick = () => verLancamentosDaTag(el.dataset.verTag));

  // Exportar CSV do período (Relatórios)
  const csvBtn = $('#btn-csv');
  if (csvBtn) csvBtn.onclick = () => {
    const period = DB.monthPeriod(new Date(), state.repOffset || 0);
    const rows = [['Tipo', 'Descricao', 'Valor', 'Data', 'Categoria', 'Ambito', 'Membro', 'Metodo', 'Status', 'Parcela', 'Cartao', 'Conta']];
    for (const t of DB.txOfPeriod(period).sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([
        DB.isExpense(t) ? 'Despesa' : 'Receita',
        t.description, String(t.amount).replace('.', ','), t.date,
        DB.categoryPath(t.category_id), t.scope, t.member || '', t.method,
        /* Previsto se identifica na coluna Status. Num mês futuro o CSV leva
           também as linhas da previsão — o que é desejável, é o mesmo conteúdo da
           tela —, mas sair como "A Pagar" as faria parecer compromisso registrado
           numa planilha aberta fora do app, onde não há cor nem rodapé que avise. */
        t.virtual ? `Previsto (${t.origemPrevista || 'repete'})` : t.status,
        t.installment || '',
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
    // É AQUI que o dinheiro sai: enquanto era "A Pagar" o saldo estava intacto
    avisarSeUsouGuardado(atualizado);
  });

  // Contas: tocar para atualizar o saldo (conciliação rápida)
  v.querySelectorAll('[data-acc]').forEach(el => el.onclick = () => openSaldoSheet(el.dataset.acc));
  v.querySelectorAll('[data-envelope]').forEach(el => el.onclick = () => openEnvelopeDetail(el.dataset.envelope));
  /* stopPropagation: o lápis vive DENTRO da linha do envelope, que também é
     clicável. Sem isto, ajustar o orçamento abriria o detalhe por baixo. */
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
  /* Pagar, desfazer e abrir o detalhe da fatura: a mesma função que as folhas de
     histórico e de futuras usam. Duas cópias divergiriam na primeira correção que
     entrasse só de um lado — os botões funcionariam na tela e ficariam inertes
     dentro da folha, que é o tipo de defeito que ninguém reporta. */
  ligarAcoesDeFatura(v);
  /* A linha do variável no hero abre a classificação: é ali que a dúvida nasce, e
     sem esse caminho a marca de custo fixo só existia dentro da edição em massa,
     a três telas de distância. */
  v.querySelectorAll('[data-semanada]').forEach(b => b.onclick = () => {
    if (pagarSemanada(b.dataset.semanada)) { render(); toast('Semanada dada — o cofrinho encheu 🪙'); }
  });
  v.querySelectorAll('[data-ver-tarefas]').forEach(b => b.onclick = () => openConfirmarTarefas(b.dataset.verTarefas));
  v.querySelectorAll('[data-classificar]').forEach(b => b.onclick = () =>
    openClassificarGastos(DB.monthPeriod(new Date(), state.monthOffset || 0)));
  v.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => openHistoricoFaturas(b.dataset.hist));
  v.querySelectorAll('[data-futuras]').forEach(b => b.onclick = () => openFaturasFuturas(b.dataset.futuras));
  const ng = $('#btn-new-goal');
  if (ng) ng.onclick = () => openGoalSheet(null);
  v.querySelectorAll('[data-editgoal]').forEach(b => b.onclick = () => openGoalSheet(DB.get('goals', b.dataset.editgoal)));
  v.querySelectorAll('[data-aporte]').forEach(b => b.onclick = () => openAporteSheet(b.dataset.aporte));
  v.querySelectorAll('[data-goal-detail]').forEach(b => b.onclick = () => openGoalDetail(b.dataset.goalDetail));
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

/* ---------- Pagar fatura ----------
   Antes isto era um `adjustBalance` silencioso: o dinheiro sumia da conta e nada
   no extrato explicava por quê. Agora o pagamento é um lançamento de verdade —
   tem data, valor, conta, aparece na lista e move o saldo como qualquer outro.

   Ele nasce neutro nas análises (ver DB.isNeutral): as compras do cartão já
   contaram como despesa quando aconteceram, e contar de novo na quitação somaria
   o mesmo dinheiro duas vezes. */
function openPagarFaturaSheet(key) {
  const [cardId] = String(key).split(':');
  const card = DB.get('cards', cardId);
  if (!card) return toast('Cartão não encontrado');
  const inv = DB.invoicesOf(card).find(i => i.key === key);
  if (!inv) return toast('Fatura não encontrada');
  const contas = DB.all('accounts').filter(a => a.active !== false);
  if (!contas.length) return toast('Cadastre uma conta antes de pagar a fatura');
  const falta = Math.max(0, inv.falta);
  const jaPago = inv.pago > 0.005;
  const contaPadrao = card.account_id && DB.get('accounts', card.account_id) ? card.account_id : contas[0].id;

  openSheet(`
    <div class="sheet-title">Pagar fatura — ${esc(card.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">Fatura de <b>${fmt(inv.total)}</b>${
      jaPago ? ` · já pago <b>${fmt(inv.pago)}</b> · falta <b>${fmt(falta)}</b>` : ''} · vence ${fmtDate(inv.due)}</p>

    <div class="field"><label>Quanto está pagando</label>
      ${chipGroup('pf-tipo', [
        { value: 'total', label: jaPago ? 'O que falta' : 'Total' },
        { value: 'parcial', label: 'Parcial' },
      ], 'total')}
    </div>
    <div class="field" id="pf-valor-campo" hidden><label>Valor pago</label>
      <input class="amount-input" id="pf-valor" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00">
    </div>
    <div class="field"><label>Data do pagamento</label><input id="pf-data" type="date" value="${todayISO()}"></div>
    <div class="field"><label>Conta que pagou</label>
      <select id="pf-conta">${contas.map(a =>
        `<option value="${a.id}"${a.id === contaPadrao ? ' selected' : ''}>${esc(a.name)} — ${fmt(a.balance)}</option>`).join('')}</select>
    </div>
    <p class="muted" style="margin-bottom:var(--e3)">O débito entra no extrato da conta escolhida. Não conta como gasto novo: as compras do cartão já entraram quando aconteceram.</p>
    <button class="btn" id="sh-save">Registrar pagamento</button>
    ${jaPago ? '<div class="btn-row"><button class="btn ghost t-danger" id="pf-desfazer">Desfazer pagamentos desta fatura</button></div>' : ''}
  `);
  initMoney('#pf-valor', falta);
  $('#sh-close').onclick = closeSheet;
  // O campo de valor só existe no parcial: no total ele seria uma pergunta cuja
  // resposta o app já sabe
  bindChips('pf-tipo', v => { $('#pf-valor-campo').hidden = v !== 'parcial'; });

  $('#sh-save').onclick = () => {
    const parcial = chipValue('pf-tipo') === 'parcial';
    const valor = parcial ? moneyVal('#pf-valor') : falta;
    if (!(valor > 0)) return toast('Informe o valor pago');
    if (valor - falta > 0.005) return toast(`O valor passa do que falta (${fmt(falta)})`);
    const pgto = {
      description: `Fatura ${card.name} — ${rotuloDaFatura(key)}`,
      amount: valor, date: $('#pf-data').value || todayISO(),
      type: 'Despesa', status: 'Pago',
      scope: 'Família', member: MEMBRO_COMUM, method: 'Fatura',
      account_id: $('#pf-conta').value, card_id: null, category_id: null,
      pays_invoice: key,
    };
    DB.upsert('transactions', pgto);
    applyTxEffect(pgto, +1);
    closeSheet(); Sync.autoSync(); render();
    const restante = falta - valor;
    toast(restante > 0.005 ? `Pago ${fmt(valor)} — faltam ${fmt(restante)}` : 'Fatura quitada ✓');
    // O pagamento da fatura é o débito de verdade da compra feita no cartão
    avisarSeUsouGuardado(pgto);
  };
  const desfazer = $('#pf-desfazer');
  if (desfazer) desfazer.onclick = () => {
    if (!confirm('Desfazer os pagamentos desta fatura?\n\nOs lançamentos somem e o saldo da conta é devolvido.')) return;
    desfazerPagamentosDaFatura(key);
    closeSheet(); Sync.autoSync(); render();
    toast('Pagamentos desfeitos');
  };
}

// "<id>:2026-07" vira "julho de 2026" — a fatura é conhecida pelo mês, não pela chave
function rotuloDaFatura(key) {
  const mes = String(key).split(':')[1] || '';
  const [ano, m] = mes.split('-');
  if (!ano || !m) return mes;
  return new Date(Number(ano), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function desfazerPagamentosDaFatura(key) {
  DB.emLote(() => {
    for (const t of DB.pagamentosDaFatura(key)) {
      applyTxEffect(t, -1);                 // devolve o saldo à conta
      DB.remove('transactions', t.id);
    }
    DB.setInvoicePaid(key, false);          // limpa também a marcação manual antiga
  });
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
  /* Só o que existe de verdade. Num mês futuro `txsFiltradas` devolve também as
     transações VIRTUAIS da previsão, e elas não têm id: entrariam aqui como
     `null`, apareceriam como linha editável e a primeira gravação criaria um
     registro fantasma — ou apagaria outro, se dois `null` colidissem.

     Previsão não se edita: para mudar o aluguel dos próximos meses, muda-se o
     contrato em "Contas fixas", não uma cópia dele numa tela de lote. */
  Massa.ids = txsFiltradas(period).filter(t => !t.virtual && t.id).map(t => t.id);
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
        ${aviso ? `<p class="muted" style="margin-top:var(--e2)">${aviso}</p>` : ''}</div>
    </div>`;
  const foraDe = chave => alvos.filter(t => !massaAceita(chave, t)).length;
  const nota = chave => {
    const fora = foraDe(chave);
    return fora ? `${fora} do lote não recebe esta mudança e fica como está.` : '';
  };

  openSheet(`
    <div class="sheet-title">Editar ${alvos.length} lançamento${alvos.length === 1 ? '' : 's'}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e4)">Ligue só o que quer mudar. O que ficar desligado permanece como está em cada lançamento.</p>

    ${campo('type', 'Tipo', `
      ${chipGroup('ma-tipo', [
        { value: 'Despesa', label: 'Despesa' },
        { value: 'Receita', label: 'Receita' },
        { value: 'Transferência', label: 'Transferência' },
      ], 'Despesa')}
      <div class="field" id="ma-destino-campo" hidden style="margin-top:var(--e2)"><label>Conta de destino</label>
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
      <input id="ma-tags" type="text" placeholder="viagem, presente" autocomplete="off" list="tag-hist-massa" style="margin-top:var(--e2)">
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
    ${/* DUAS classes, não três: "conta fixa" não é marca no lançamento, é o vínculo
          com o contrato — e vincular em lote, casando pelo nome, é justamente o
          automático que erra no que vem de extrato bancário. Aqui fica só o que
          decide a projeção; o vínculo se faz um a um, na folha do Painel. */
      campo('classe', 'Entra na projeção?',
      `<select id="ma-classe">
        <option value="variavel">Variável — entra na projeção do mês</option>
        <option value="pontual">Pontual — aconteceu e não volta</option>
      </select>`)}
    ${campo('notes', 'Observações', `
      ${chipGroup('ma-notamodo', [
        { value: 'substituir', label: 'Substituir' },
        { value: 'acrescentar', label: 'Acrescentar' },
      ], 'substituir')}
      <textarea id="ma-notas" rows="2" style="margin-top:var(--e2)"></textarea>`)}

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
    if (ligado('classe')) campos.pontual = $('#ma-classe').value === 'pontual';
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
  if ('pontual' in campos) linhas.push([`Passam a ser <b>${
    campos.pontual ? 'pontuais — fora da projeção do mês' : 'variáveis — entram na projeção'}</b>`, alvos.length]);
  if (extras.notes) linhas.push([`Observações ${extras.notes.modo === 'substituir' ? 'viram' : 'ganham'} o texto informado`, alvos.length]);

  openSheet(`
    <div class="sheet-title">Confirmar<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">Sobre ${alvos.length} lançamento${alvos.length === 1 ? '' : 's'} selecionado${alvos.length === 1 ? '' : 's'}:</p>
    ${linhas.map(([txt, n]) => `<div class="proj-row"><span>${txt}</span><b>${n}</b></div>`).join('')}
    <p class="muted" style="margin-top:var(--e3)">Dá para desfazer logo depois, enquanto o aviso estiver na tela.</p>
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

  // O limite do MÊS NAVEGADO. Antes lia o padrão atemporal, então a folha
  // mostrava o gasto de um mês contra o teto de outro.
  const limite = DB.budgetOf(c.id, period);
  const pct = limite > 0 ? Math.round(total / limite * 100) : 0;

  openSheet(`
    <div class="sheet-title">${esc(c.icon)} ${esc(c.name)}</div>
    <p class="muted" style="margin-bottom:var(--e3)">${esc(period.label)} · ${fmtShort(total)} gasto${limite ? ` de ${fmtShort(limite)} (${pct}%)` : ''}</p>
    ${limite ? `<div class="bar ${barClass(pct)}" style="margin-bottom:var(--e4)"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
    ${linhas.length
      ? svgRanking(linhas)
      : '<div class="empty">Nada gasto neste envelope no período.</div>'}
    <div class="btn-row" style="margin-top:var(--e4)"><button class="btn ghost" id="sh-close">Fechar</button></div>
  `);
  $('#sh-close').onclick = closeSheet;
}

/* ---------- Ajustar o orçamento de um ciclo ----------

   O padrão da categoria responde "quanto costuma caber aqui"; esta folha responde
   "e neste mês?". As duas perguntas convivem, e a diferença entre elas é o
   ALCANCE — que por isso é uma escolha explícita na tela, não um efeito colateral
   de onde a pessoa clicou:

   - "só neste mês" grava um ajuste do ciclo e não toca no padrão
   - "deste mês em diante" muda o padrão, congelando o valor antigo nos meses
     fechados que tiveram gasto (senão o relatório de um mês encerrado passaria a
     comparar o gasto contra um teto que não valia lá)

   E há o caminho que motivou tudo: MOVER de outro envelope. Ele grava os dois
   lados de uma vez, porque "reforcei alimentação tirando do lazer" é uma decisão
   só — feita em dois passos, o total do mês fica errado no meio do caminho e
   ninguém confere. */
function openOrcamentoSheet(categoryId, offset = 0) {
  const c = catOf(categoryId);
  if (!c) return;
  /* O MÊS é escolhido aqui dentro, não herdado da tela.

     A folha é aberta de Configurações, onde não existe navegação de mês — e
     mesmo que existisse, ajustar "o mês em que eu estava" é o tipo de suposição
     que faz alguém mudar agosto achando que mudou julho. Com o seletor, o mês
     ajustado está escrito na frente de quem confirma. */
  const period = DB.monthPeriod(new Date(), offset);
  const atual = DB.budgetOf(categoryId, period);
  const padrao = Number(c.monthly_budget) || 0;
  const temAjuste = !!DB.overrideDeOrcamento(categoryId, period);
  const gasto = DB.spentByCategory(period)[categoryId] || 0;
  const outros = DB.rootCategories('Despesa')
    .filter(o => o.id !== categoryId && DB.budgetOf(o.id, period) > 0);

  openSheet(`
    <div class="sheet-title">${esc(c.icon)} ${esc(c.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">${
      temAjuste ? `Ajustado neste mês · padrão ${fmtShort(padrao)}` : `Usando o padrão de ${fmtShort(padrao)}`} · já gasto ${fmtShort(gasto)}</p>
    <div class="field"><label>Qual mês</label>
      <select id="orc-mes">${Array.from({ length: 10 }, (_, n) => n - 3).map(o => {
        const p = DB.monthPeriod(new Date(), o);
        const ajuste = DB.overrideDeOrcamento(categoryId, p);
        return `<option value="${o}"${o === offset ? ' selected' : ''}>${esc(p.label)}${
          ajuste ? ` — ajustado para ${fmtShort(Number(ajuste.amount) || 0)}` : ''}</option>`;
      }).join('')}</select></div>
    <div class="field"><label>Quanto cabe neste mês</label><input id="orc-valor" type="text" inputmode="numeric" placeholder="R$ 0,00"></div>
    <div class="field"><label>Vale para</label>
      ${chipGroup('orc-alcance', [
        { value: 'mes', label: 'Só neste mês' },
        { value: 'diante', label: 'Deste mês em diante' },
      ], 'mes')}
      <p class="muted" id="orc-explica" style="margin-top:var(--e2)"></p>
    </div>
    <button class="btn" id="sh-save">Salvar</button>
    <div class="btn-row">
      ${outros.length ? '<button class="btn ghost" id="orc-mover">Mover de outro envelope</button>' : ''}
      ${temAjuste ? '<button class="btn ghost t-danger" id="orc-limpar">Voltar ao padrão</button>' : ''}
    </div>
  `);
  initMoney('#orc-valor', atual);
  const explicar = () => {
    const el = $('#orc-explica');
    if (!el) return;
    el.textContent = chipValue('orc-alcance') === 'diante'
      ? `Muda o padrão de ${c.name}. Os meses já fechados ficam com ${fmtShort(padrao)}, o valor que valia neles.`
      : `Só ${period.label}. O padrão de ${fmtShort(padrao)} continua valendo nos outros meses.`;
  };
  explicar();
  bindChips('orc-alcance', explicar);
  // Trocar de mês redesenha a folha: valor, selo e o botão de voltar ao padrão
  // são todos daquele ciclo, e mantê-los de um mês anterior mostraria o número
  // de julho sob o título de agosto.
  $('#orc-mes').addEventListener('change', ev => openOrcamentoSheet(categoryId, Number(ev.target.value) || 0));
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const valor = moneyVal('#orc-valor');
    if (chipValue('orc-alcance') === 'diante') DB.definirOrcamentoPadrao(categoryId, valor, period);
    else DB.ajustarOrcamento(categoryId, period, valor);
    closeSheet(); Sync.autoSync(); render();
    toast(`Orçamento de ${c.name}: ${fmtShort(valor)} ✓`);
  };
  const limpar = $('#orc-limpar');
  if (limpar) limpar.onclick = () => {
    DB.limparAjusteDeOrcamento(categoryId, period);
    closeSheet(); Sync.autoSync(); render();
    toast(`${c.name} voltou ao padrão de ${fmtShort(padrao)}`);
  };
  const mover = $('#orc-mover');
  if (mover) mover.onclick = () => openMoverOrcamentoSheet(categoryId, period);
}

/* Mover orçamento entre envelopes, dentro do mesmo ciclo.

   O total do mês fica INALTERADO por construção: o que entra de um lado sai do
   outro, gravado de uma vez só. É a diferença entre "remanejei" e "aumentei o
   orçamento", e as duas coisas precisam ser distinguíveis — senão o total do mês
   sobe sem ninguém perceber e o plano deixa de significar alguma coisa. */
function openMoverOrcamentoSheet(destinoId, period) {
  const destino = catOf(destinoId);
  const candidatos = DB.rootCategories('Despesa')
    .filter(o => o.id !== destinoId && DB.budgetOf(o.id, period) > 0)
    .sort((a, b) => DB.budgetOf(b.id, period) - DB.budgetOf(a.id, period));
  if (!candidatos.length) return toast('Nenhum outro envelope tem orçamento neste mês');

  openSheet(`
    <div class="sheet-title">Mover para ${esc(destino.icon)} ${esc(destino.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">Em <b>${esc(period.label)}</b>. O total orçado do mês não muda — sai de um envelope e entra no outro.</p>
    <div class="field"><label>Tirar de</label>
      <select id="mv-origem">${candidatos.map(o => `<option value="${o.id}">${esc(o.icon)} ${esc(o.name)} — tem ${fmtShort(DB.budgetOf(o.id, period))}</option>`).join('')}</select></div>
    <div class="field"><label>Quanto</label><input id="mv-valor" type="text" inputmode="numeric" placeholder="R$ 0,00"></div>
    <p class="muted" id="mv-previa"></p>
    <button class="btn" id="sh-save">Mover</button>
  `);
  initMoney('#mv-valor', 0);
  /* A prévia existe porque a operação mexe em dois números ao mesmo tempo: sem
     ver os dois lados antes de confirmar, "mover 200" é um palpite. */
  const previa = () => {
    const el = $('#mv-previa');
    const origem = catOf($('#mv-origem').value);
    const v = moneyVal('#mv-valor');
    if (!el || !origem) return;
    const de = DB.budgetOf(origem.id, period), para = DB.budgetOf(destinoId, period);
    el.innerHTML = v > 0
      ? `${esc(origem.name)}: ${fmtShort(de)} → <b>${fmtShort(de - v)}</b> · ${esc(destino.name)}: ${fmtShort(para)} → <b>${fmtShort(para + v)}</b>`
      : '';
  };
  $('#mv-valor').addEventListener('input', previa);
  $('#mv-origem').addEventListener('change', previa);
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const origem = catOf($('#mv-origem').value);
    const v = moneyVal('#mv-valor');
    if (!origem || v <= 0) return toast('Informe quanto mover');
    const de = DB.budgetOf(origem.id, period);
    if (v > de) return toast(`${origem.name} só tem ${fmtShort(de)} neste mês`);
    DB.emLote(() => {
      DB.ajustarOrcamento(origem.id, period, de - v);
      DB.ajustarOrcamento(destinoId, period, DB.budgetOf(destinoId, period) + v);
    });
    closeSheet(); Sync.autoSync(); render();
    toast(`${fmtShort(v)} de ${origem.name} para ${destino.name} ✓`);
  };
}

function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.hidden = false; $('#sheet-backdrop').hidden = false;
  paintIcons(sheet);
  marcarValores(sheet);
  if (typeof UI !== 'undefined') UI.enhance(sheet);
  // A folha também injeta HTML de uma vez: o gráfico dela só existe depois disso
  if (typeof Graficos !== 'undefined') Graficos.montar();
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
      <select id="f-cat-more" hidden style="margin-top:var(--e2)"></select>
    </div>
    <div class="row2">
      <div class="field"><label>Data</label><input id="f-date" type="date" value="${tx.date}">
        <div class="chips" id="g-day" style="margin-top:var(--e2)"><button type="button" class="chip" data-d="0">Hoje</button><button type="button" class="chip" data-d="1">Ontem</button><button type="button" class="chip" data-d="2">Anteontem</button></div>
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
      <p class="muted" id="fatura-hint" style="margin-top:var(--e2)"></p>
    </div>
    ${isEdit ? '' : `<div class="field" id="wrap-parc" ${tx.method === 'Cartão de Crédito' ? '' : 'hidden'}>
      <label>Parcelas</label>
      <select id="f-parc">${Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i === 0 ? 'À vista' : `${i + 1}x`}</option>`).join('')}</select>
      <p class="muted" id="parc-hint" style="margin-top:var(--e2)">Informe o <b>valor total</b> da compra — o app divide nas faturas seguintes.</p>
    </div>`}
    <div class="field" id="wrap-account" ${tx.method === 'Cartão de Crédito' ? 'hidden' : ''}>
      <label id="lbl-account">Conta <span class="muted">— o saldo é ajustado sozinho</span></label>
      <select id="f-account"><option value="">— não movimenta conta —</option>${accounts.map(a => `<option value="${a.id}" ${tx.account_id === a.id ? 'selected' : ''}>${esc(a.name)}${DB.isReserveGoal({ name: a.name }) ? '' : ''} — ${fmtShort(a.balance)}</option>`).join('')}</select>
    </div>
    <div class="field" id="wrap-to-account" hidden>
      <label>Para qual conta</label>
      <select id="f-to-account"><option value="">— selecione —</option>${accounts.map(a => `<option value="${a.id}" ${tx.to_account === a.id ? 'selected' : ''}>${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}</select>
      <p class="muted" style="margin-top:var(--e2)">Mover dinheiro entre contas suas <b>não é gasto nem renda</b> — só ajusta os saldos, sem poluir os relatórios.</p>
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
      <p class="muted" id="member-hint" style="margin-top:var(--e2)"></p>
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
      <input id="f-tag-nova" list="tag-hist" placeholder="Buscar ou criar etiqueta e Enter" autocomplete="off" maxlength="24" style="margin-top:var(--e2)">
      <datalist id="tag-hist">${DB.allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      ${isEdit ? '' : `<button type="button" class="chip chip-fixa ${veioDeFixa ? 'active' : ''}" id="tag-fixar" style="margin-top:var(--e2)">
        📌 Manter nos próximos lançamentos</button>
      <p class="muted" id="tag-fixa-hint" style="margin-top:var(--e2);font-size:11.5px">${veioDeFixa
        ? `Fixado: ${atuais.map(t => '#' + t).join(' ')}. Desligue quando a sequência terminar.`
        : 'Use ao lançar vários gastos do mesmo assunto — uma viagem, uma reforma.'}</p>`}
    </div>`;
    })()}
    <!-- A repetição fica no PRÓPRIO lançamento, como no Google Calendar: nada de
         tela nova para aprender, e a pergunta chega quando ela é natural. Editar
         um lançamento já existente não mexe na recorrência — para isso existe a
         tela de contas fixas, senão mudar um mês mudaria todos sem avisar. -->
    ${isEdit ? '' : `
    <div class="field"><label>Se repete?</label>
      ${chipGroup('f-rep', [
        { value: '', label: 'Não' },
        { value: 'mensal', label: 'Todo mês' },
        { value: 'semanal', label: 'Toda semana' },
        { value: 'quinzenal', label: 'A cada 15 dias' },
        { value: 'anual', label: 'Todo ano' },
      ], '')}
    </div>
    <div id="rep-detalhe" hidden>
      <div class="row2">
        <div class="field"><label id="lbl-rep-dia">Todo dia</label>
          <input id="f-rep-dia" type="number" min="1" max="31" value="${new Date(tx.date || todayISO()).getDate() || 1}"></div>
        <div class="field"><label>Até quando</label>
          <select id="f-rep-fim">
            <option value="sem_prazo">Sem prazo — até eu cancelar</option>
            <option value="vezes">Por um número de vezes</option>
            <option value="data">Até uma data</option>
          </select></div>
      </div>
      <div class="field" id="rep-vezes" hidden><label>Quantas vezes</label>
        <input id="f-rep-vezes" type="number" min="2" max="480" value="12"></div>
      <div class="field" id="rep-data" hidden><label>Última cobrança</label>
        <input id="f-rep-data" type="date"></div>
      <div class="field"><label>O valor muda todo mês? <span class="muted">— luz, água, gás</span></label>
        <select id="f-rep-valor">
          <option value="fixo">Não, é sempre o mesmo</option>
          <option value="media">Sim — usar a mediana do que já foi pago</option>
        </select></div>
      <p class="muted" id="rep-resumo" style="margin-bottom:var(--e3)"></p>
    </div>`}
    <!-- ALCANCE, só quando a compra é parcelada. Corrigir a categoria de uma
         compra em 10x exigia abrir dez telas em dez meses; ninguém faz, e o dado
         fica errado para sempre. A EXCLUSÃO já perguntava isso — a edição não
         perguntava nada, e a assimetria não tinha razão. -->
    ${(() => {
      const n = isEdit ? irmasDaParcela(tx).length : 0;
      if (n < 2) return '';
      const futuras = irmasDaParcela(tx).filter(t => String(t.date) > String(tx.date)).length;
      return `<div class="field" id="wrap-alcance"><label>Salvar alterações em</label>
        ${chipGroup('g-alcance', [
          { value: 'esta', label: 'Só esta' },
          ...(futuras ? [{ value: 'proximas', label: `Esta e as próximas (${futuras + 1})` }] : []),
          { value: 'todas', label: `Todas as ${n}` },
        ], 'esta')}
        <p class="muted" id="alcance-nota" style="margin-top:var(--e2)"></p></div>`;
    })()}
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
    $('#f-desc').placeholder = isTransf ? 'Ex: Guardar na reserva, Poupança do mês…'
      : isRec ? 'Ex: Salário, Freelance, Reembolso…' : 'Ex: Mercado, Uber, Farmácia…';
    $('#f-status').options[0].textContent = isRec ? 'Recebido' : 'Pago';
    $('#f-status').options[1].textContent = isRec ? 'A Receber' : 'A Pagar';

    // Numa transferência, o que importa é de onde sai e para onde vai
    for (const id of ['#lbl-status', '#wrap-scope', '#wrap-member']) {
      const el = $(id); if (el) el.hidden = isTransf;
    }
    $('#f-status').hidden = isTransf;
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
    /* TRÊS atalhos, e a lista completa navegada por envelope.

       Tentei seis atalhos numa faixa rolável, repetidos também no primeiro nível
       da lista. A medida dizia que ajudaria — três cobrem 58% dos lançamentos
       desta base e seis cobrem 74% —, mas na tela ficou pior: as mesmas
       categorias soltas logo acima dos envelopes ("Alimentação › Mercado" em cima
       de "Alimentação") leem como lista duplicada, não como atalho. Revertido a
       pedido de quem usa o app.

       Se voltar ao assunto, o caminho é uma seção NOMEADA ("Usadas
       recentemente"), separada dos envelopes — e não opções soltas misturadas
       com eles. */
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
    });
    /* Tocar em "Outra" SEMPRE abre a lista — inclusive quando ele já mostra uma
       categoria escolhida.

       Antes a condição era `active && !dataset.v`: só abria com o botão VAZIO. E
       a sugestão automática pela descrição preenche justamente esse `dataset.v`
       quando acerta uma categoria fora dos três atalhos. O efeito era que a
       sugestão não podia ser trocada — o toque marcava o botão e não acontecia
       mais nada, e o único jeito de escolher outra era apagar a descrição.

       O `onclick` é redefinido DEPOIS de `bindChips` porque o "Outra" também é um
       chip do grupo: sem isto, valeria o handler genérico, que só alterna a
       marcação. */
    const outra = $('#cat-other');
    outra.onclick = () => {
      catManual = true;
      const auto = $('#cat-auto'); if (auto) auto.textContent = '';
      document.querySelectorAll('#g-cat .chip').forEach(ch => {
        if (ch.id !== 'cat-other') ch.classList.remove('active');
      });
      outra.classList.add('active');
      $('#f-cat-more').hidden = false;
      if (typeof UI !== 'undefined') setTimeout(() => UI.open($('#f-cat-more')), 30);
    };
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

  /* Controles da repetição. Só aparecem depois de escolher que repete — quem
     lança um gasto avulso, que é a maioria, não vê nada disso. */
  if ($('#f-rep')) {
    const rotuloDia = { semanal: 'Todo dia da semana (1 = seg)', quinzenal: 'A cada 15 dias a partir de', anual: 'Todo dia' };
    const resumoRep = () => {
      const per = chipValue('f-rep');
      if (!per) return '';
      const dia = Number($('#f-rep-dia').value) || 1;
      const fim = $('#f-rep-fim').value;
      const quando = per === 'semanal' ? 'toda semana' : per === 'quinzenal' ? 'a cada 15 dias'
        : per === 'anual' ? `todo ano no dia ${dia}` : `todo mês no dia ${dia}`;
      const ate = fim === 'vezes' ? `, ${Number($('#f-rep-vezes').value) || 0} vezes`
        : fim === 'data' && $('#f-rep-data').value ? `, até ${fmtDate(new Date($('#f-rep-data').value + 'T12:00:00'))}`
        : ', até você cancelar';
      const media = $('#f-rep-valor').value === 'media' ? ' O valor de cada mês vem da mediana do que já foi pago.' : '';
      // Dia 29, 30 e 31 não existem em todo mês: dizer antes evita a surpresa
      const aviso = per === 'mensal' && dia > 28
        ? ' Nos meses mais curtos cai no último dia.' : '';
      return `Vai lançar <b>${quando}${ate}</b>.${aviso}${media}`;
    };
    const pintarRep = () => {
      const per = chipValue('f-rep');
      $('#rep-detalhe').hidden = !per;
      if (!per) return;
      $('#lbl-rep-dia').textContent = rotuloDia[per] || 'Todo dia';
      const fim = $('#f-rep-fim').value;
      $('#rep-vezes').hidden = fim !== 'vezes';
      $('#rep-data').hidden = fim !== 'data';
      $('#rep-resumo').innerHTML = resumoRep();
    };
    bindChips('f-rep', pintarRep);
    ['#f-rep-fim', '#f-rep-dia', '#f-rep-vezes', '#f-rep-data', '#f-rep-valor']
      .forEach(sel => { const el = $(sel); if (el) el.onchange = pintarRep; });
    pintarRep();
  }
  pintarTipo(tx.type || 'Despesa');
  bindChips('g-scope', applyScope);
  bindChips('g-method', v => { methodManual = true; applyMethod(v); });

  /* A nota do alcance diz o que NÃO acompanha a série, e por quê.

     Sem ela, quem escolhe "todas" não tem como saber que a data vira o mesmo DIA
     em cada mês (e não a mesma data), nem que o valor é redividido em vez de
     copiado — as duas coisas mais fáceis de errar por suposição. */
  const notaAlcance = () => {
    const n = $('#alcance-nota');
    if (!n) return;
    const v = chipValue('g-alcance');
    n.textContent = v === 'esta'
      ? 'As outras parcelas ficam como estão.'
      : 'A data vira o mesmo dia em cada mês; o valor passa a valer para cada parcela; a fatura de cada uma é recalculada.';
  };
  bindChips('g-alcance', notaAlcance);
  notaAlcance();
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
        category_id: null, card_id: null, invoice_key: '', recurring: false, pontual: false, adjustment: false,
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
      // `recurring` é legado: some do formulário, mas o valor existente é
      // preservado — a previsão dos próximos meses ainda o lê, e zerar aqui
      // apagaria a marca ao editar qualquer lançamento antigo.
      recurring: !!tx.recurring,
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
    const propagadas = propagarNasParcelas(rec, orig, chipValue('g-alcance'));
    aplicarFixacao();
    closeSheet(); render(); Sync.autoSync();
    /* Cria o contrato da repetição a partir do que acabou de ser lançado.

       O lançamento de hoje NÃO vira gerado: ele já existe e já está pago. A
       recorrência começa na próxima ocorrência, senão o mês atual ficaria com
       duas linhas iguais — uma paga e outra "A Pagar". */
    const criada = criarRecorrenciaDoLancamento(rec);
    toast(propagadas > 0 ? `Aplicado em ${propagadas + 1} parcelas ✓`
      : isEdit ? 'Lançamento atualizado ✓'
      : criada ? `${isReceita ? 'Receita lançada' : 'Gasto lançado'} e repetição criada ✓`
      : (isReceita ? 'Receita lançada ✓' : 'Gasto lançado ✓'));
    // Depois de gravar: se o gasto entrou no que estava guardado, resolve agora
    avisarSeUsouGuardado(rec);
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

/* As irmãs de uma parcela, em ordem cronológica. */
function irmasDaParcela(tx) {
  if (!tx || !tx.group_id) return [];
  return DB.all('transactions')
    .filter(t => t.group_id === tx.group_id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* Campos que se COPIAM iguais para a série inteira.

   `description` entra, mas sem o sufixo "(3/10)": ele é da parcela, não da compra,
   e copiá-lo faria todas se chamarem "(3/10)".

   `invoice_key` NÃO está aqui: ela deriva da data de cada parcela, e uma cópia
   jogaria as dez na mesma fatura. É recalculada uma a uma.

   DATA e VALOR também não se copiam — eles se TRANSFORMAM, cada um com sua
   regra. Ver `propagarNasParcelas`. */
const CAMPOS_DA_SERIE = ['category_id', 'member', 'scope', 'method', 'tags', 'notes', 'card_id', 'account_id', 'status'];

/* Move uma data para outro DIA DO MÊS, sem sair do mês dela.

   É o que "errei o dia, era 11 e não 10" precisa: as parcelas seguintes vão para
   o dia 11 dos SEUS meses, não todas para 11 do mês da primeira.

   Dia 31 em fevereiro cai no último dia real — `new Date(ano, mes, 31)` transborda
   para 3 de março em silêncio, e o mesmo cuidado já existe na geração das
   recorrências. */
function trocarDiaDoMes(dataISO, dia) {
  const d = new Date(dataISO + 'T12:00:00');
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const alvo = new Date(d.getFullYear(), d.getMonth(), Math.min(dia, ultimo));
  return DB.paraISO(alvo);
}

/* Aplica a edição de uma parcela nas irmãs escolhidas.

   POR QUE ISSO EXISTE: sem isto, corrigir a categoria de uma compra em 10x exige
   abrir dez telas em dez meses diferentes. Ninguém faz, e o dado fica errado para
   sempre — medido na base real: uma compra de R$ 2.000 em 10x com a categoria só
   na primeira parcela, e R$ 1.800 fora do donut e do orçamento por nove meses.

   A EXCLUSÃO já perguntava se era para apagar a série toda. A edição não
   perguntava nada, e essa assimetria não tinha razão.

   O VALOR é redividido, não copiado: mudar o total de uma compra parcelada muda
   todas as parcelas, com os centavos na primeira, exatamente como na criação.
   Copiar o valor da parcela aberta multiplicaria a compra pelo número de parcelas. */
function propagarNasParcelas(rec, orig, alcance) {
  if (!alcance || alcance === 'esta') return 0;
  const irmas = irmasDaParcela(rec).filter(t => t.id !== rec.id);
  if (!irmas.length) return 0;
  const alvos = alcance === 'proximas'
    ? irmas.filter(t => String(t.date) > String(rec.date))
    : irmas;
  if (!alvos.length) return 0;

  const semSufixo = s => String(s || '').replace(/\s*\(\d+\/\d+\)$/, '');
  const baseDesc = semSufixo(rec.description);
  /* O VALOR se copia, e só quando de fato mudou.

     O campo do formulário mostra o valor DA PARCELA, não o da compra: quem
     corrige 200 para 300 está dizendo "cada parcela é 300", e o total da compra
     acompanha. Copiar é o que corresponde ao que foi digitado.

     Só quando mudou, porque a criação distribui os centavos que não dividem
     certo na primeira parcela — reescrever o valor numa edição de categoria
     apagaria esse ajuste e a soma deixaria de bater com a compra. */
  const mudouValor = orig && Math.abs(Number(orig.amount) - Number(rec.amount)) > 0.005;
  /* A DATA não se copia: propaga o DIA DO MÊS.
     "Lancei no dia 10 mas era 11" tem de levar cada parcela para o dia 11 do SEU
     mês. Copiar a data faria as dez caírem no mesmo dia do mesmo mês e a compra
     parcelada viraria uma compra à vista repetida. */
  const diaNovo = orig && String(orig.date) !== String(rec.date)
    ? new Date(rec.date + 'T12:00:00').getDate() : null;

  DB.emLote(() => {
    for (const t of alvos) {
      const novo = { ...t };
      for (const c of CAMPOS_DA_SERIE) novo[c] = rec[c];
      if (t.installment) novo.description = `${baseDesc} (${t.installment})`;
      else novo.description = baseDesc;
      if (diaNovo) novo.date = trocarDiaDoMes(t.date, diaNovo);
      /* A fatura é recalculada a partir da DATA DE CADA UMA — e depois de a data
         ter mudado. Trocar de cartão, ou mover o dia para depois do fechamento,
         muda a fatura em que a parcela cai; copiar a chave da parcela editada
         jogaria todas na mesma fatura. */
      if (novo.card_id) {
        const card = DB.get('cards', novo.card_id);
        novo.invoice_key = card ? DB.invoiceKeyFor(card, novo.date) : '';
      } else {
        novo.invoice_key = '';
      }
      if (mudouValor) novo.amount = rec.amount;
      // O efeito no saldo é revertido e reaplicado, como na edição única: uma
      // parcela já paga em conta move dinheiro de verdade
      applyTxEffect(t, -1);
      DB.upsert('transactions', novo);
      applyTxEffect(novo, +1);
    }
  });
  return alvos.length;
}

/* ---------- Saldo rápido e transferência entre contas ---------- */
function openSaldoSheet(accountId) {
  const a = DB.get('accounts', accountId);
  if (!a) return;
  openSheet(`
    <div class="sheet-title">Saldo — ${esc(a.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">Confira no app do banco e informe o saldo real. É a conciliação que mantém o <b>disponível para usar</b> confiável.</p>
    <div class="field"><input class="amount-input" id="s-bal" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <p class="muted" id="s-delta" style="margin-bottom:var(--e3)"></p>
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
    <p class="muted" style="margin-bottom:var(--e3)">Mover dinheiro entre suas contas <b>não é despesa nem receita</b> — só ajusta os saldos, sem poluir seus relatórios.</p>
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
    <div class="card" style="margin-bottom:var(--e4)">
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
    <div class="card" style="margin-bottom:var(--e4)">
      <div class="proj-row"><span>Guardado</span><b class="txt-green">${fmt(total)}</b></div>
      <div class="proj-row"><span>Meta</span><b>${fmt(alvo)}</b></div>
      <div class="proj-row"><span>Falta</span><b class="${falta ? '' : 'txt-green'}">${falta ? fmt(falta) : 'nada — meta atingida! 🎉'}</b></div>
      <div class="bar ${pct >= 100 ? 'bar-green' : pct >= 50 ? 'bar-green' : 'bar-amber'}" style="margin:var(--e3) 0 var(--e2)"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="proj-row muted"><span>${pct}% concluído · ${entries.length} aporte(s)</span>
        <span>${pace > 0 ? `ritmo ${fmtShort(pace)}/mês` : 'sem aportes recentes'}</span></div>
      ${previsao ? `<p class="muted" style="margin-top:var(--e2)">📈 Nesse ritmo, conclusão prevista para <b>${previsao}</b>.</p>` : ''}
      ${g.target_date && falta > 0 ? `<p class="muted">🎯 Para cumprir até ${fmtDay(g.target_date)}: <b>${fmtShort(falta / Math.max(0.5, (new Date(g.target_date) - Date.now()) / (30.44 * 86400000)))}/mês</b></p>` : ''}
    </div>
    <div class="btn-row" style="margin-bottom:var(--e3)">
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
    ${movimento ? `<p class="muted" style="margin-bottom:var(--e3)">💸 Este aporte movimentou contas (${esc(movimento)}). Alterar o valor ou excluir ajusta os saldos de volta automaticamente.</p>` : ''}
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

/* A fila do que espera decisão, no topo de tudo.

   Lançar sozinho só serve se o que venceu não apodrecer na lista — foi o pedido
   que fechou o ciclo da geração automática. Por isso ela vem ANTES do saldo: de
   nada adianta o número bonito no topo se há três contas vencidas embaixo.

   Despesa, receita e fatura na mesma fila: o critério não é o tipo, é "isto está
   parado esperando você". Separar faria procurar em dois lugares a mesma coisa. */
function filaDePendencias() {
  const itens = DB.pendencias();
  if (!itens.length) return '';
  const hoje = DB.paraISO(new Date());
  const vencidos = itens.filter(i => i.data < hoje);
  const soma = itens.filter(i => i.tipo !== 'receita').reduce((s, i) => s + i.valor, 0);

  const linha = i => {
    const atrasado = i.data < hoje;
    const quando = atrasado
      ? `${i.atraso} ${i.atraso === 1 ? 'dia' : 'dias'} de atraso`
      : 'vence hoje';
    // "Guardei" e não "Paguei": guardar não é uma conta a pagar, e o app não deve
    // tratar poupar com a mesma palavra de quitar dívida
    const acao = i.tipo === 'fatura' ? 'Pagar'
      : i.tipo === 'receita' ? 'Recebi'
      : i.tipo === 'aporte' ? 'Guardei' : 'Paguei';
    return `<div class="pend-item ${atrasado ? 'atraso' : ''}">
      <span class="pend-ico">${i.tipo === 'fatura' ? '💳' : i.tipo === 'receita' ? '💰' : i.tipo === 'aporte' ? '🏦' : '📄'}</span>
      <span class="pend-info">
        <b>${esc(i.titulo)}</b>
        <small>${quando} · ${fmtDate(new Date(i.data + 'T12:00:00'))}</small>
      </span>
      <span class="pend-val ${i.tipo === 'receita' ? 'txt-green' : ''}">${fmt(i.valor)}</span>
      <span class="pend-acoes">
        <button class="sec-btn" data-pend-ok="${esc(i.id)}" data-pend-tipo="${i.tipo}">${acao}</button>
        ${i.tipo !== 'fatura' ? `<button class="sec-btn" data-pend-adiar="${esc(i.id)}" data-pend-tipo="${i.tipo}">Adiar</button>` : ''}
      </span>
    </div>`;
  };

  return `
    <div class="card pend">
      <div class="pend-cab">
        <div>
          <b>${itens.length} ${itens.length === 1 ? 'pendência' : 'pendências'}</b>
          <small>${vencidos.length ? `${vencidos.length} em atraso · ` : ''}${fmt(soma)} a pagar</small>
        </div>
        <span class="pend-selo ${vencidos.length ? 'ruim' : ''}">${vencidos.length ? 'atrasado' : 'hoje'}</span>
      </div>
      ${itens.slice(0, 6).map(linha).join('')}
      ${itens.length > 6 ? `<p class="muted" style="margin-top:var(--e2)">e mais ${itens.length - 6} — veja no extrato, filtrando por “A Pagar”.</p>` : ''}
    </div>`;
}

/* O QUE AS CRIANÇAS ESPERAM DE VOCÊ.

   Bloco próprio, não misturado às contas: a semanada não é conta a pagar e a
   tarefa não vence. Mas mora na mesma dobra da tela pelo mesmo motivo — o que se
   esquece de fazer apodrece, e dar a semanada é semanal.

   Aparece sozinho quando há o que fazer, e some quando não há: um bloco que vive
   dizendo "nada aqui" vira paisagem e para de ser lido. */
function filaDasCriancas() {
  const semanadas = DB.kids().map(k => DB.kidSemanadaDevida(k)).filter(Boolean);
  const tarefas = DB.kidTarefasAConfirmar();
  if (!semanadas.length && !tarefas.length) return '';

  const porKid = {};
  for (const t of tarefas) (porKid[t.kid.id] = porKid[t.kid.id] || { kid: t.kid, itens: [] }).itens.push(t.entry);

  return `
    <div class="card pend kid-fila">
      <div class="pend-cab">
        <div><b>As crianças esperam você</b><small>semanada e tarefas para confirmar</small></div>
        <span class="pend-selo">🦖</span>
      </div>
      ${semanadas.map(s => {
        /* O VALOR MOSTRADO É O QUE VAI SAIR NESTE TOQUE, moeda mágica incluída
           quando ela é devida.

           Antes a linha dizia R$ 10 e o compromisso no extrato dizia R$ 11 — a
           diferença é a moeda mágica, que é condicional. Dois números com o mesmo
           nome e valores diferentes fazem duvidar dos dois, e foi assim que o
           painel passou a parecer que lançaria a semanada duas vezes. */
        const magica = DB.kidMoedaMagicaDevida(s.kid);
        const total = s.valor + (magica ? magica.valor : 0);
        return `<div class="pend-item">
        <span class="pend-ico">${esc(s.kid.avatar || '🦖')}</span>
        <span class="pend-info"><b>Semanada de ${esc(s.kid.name)}</b>
          <small>${DIAS_SEMANA[Number(s.kid.semanada_dia) || 0]} · ainda não saiu${
            magica ? ` · com a moeda mágica de ${fmtShort(magica.valor)}` : ''}</small></span>
        <span class="pend-val">${fmt(total)}</span>
        <span class="pend-acoes"><button class="sec-btn" data-semanada="${s.kid.id}">Dar agora</button></span>
      </div>`;
      }).join('')}
      ${Object.values(porKid).map(g => `<div class="pend-item">
        <span class="pend-ico">${esc(g.kid.avatar || '🦖')}</span>
        <span class="pend-info"><b>${g.itens.length} tarefa(s) de ${esc(g.kid.name)}</b>
          <small>ela marcou como feitas — confira</small></span>
        <span class="pend-val txt-green">+${fmt(g.itens.reduce((s, e) => s + (Number(e.amount) || 0), 0))}</span>
        <span class="pend-acoes"><button class="sec-btn" data-ver-tarefas="${g.kid.id}">Ver</button></span>
      </div>`).join('')}
    </div>`;
}

/* Conferir as tarefas marcadas, uma a uma. Aceitar ou recusar em bloco tiraria o
   sentido do passo: confirmar é olhar o que foi feito, não carimbar. */
/* CONFIRMAR O QUE A CRIANÇA MARCOU — e a tela precisa dizer o que é cada linha.

   Duas coisas OPOSTAS passam por aqui, e confundi-las custa dinheiro:

     tarefa e bônus — ela GANHA. Confirmar põe dinheiro no cofrinho dela.
     gasto e doação — ela GASTOU. Confirmar tira dinheiro da CONTA DA FAMÍLIA.

   Sem separar, o adulto confirma uma compra achando que aprova uma tarefa: o rótulo
   dizia "Tarefas de Fulano" e a linha mostrava só nome e valor. Aprovar no
   automático é o comportamento normal de quem vê uma fila uniforme — e aqui o
   automático debitaria a conta dele. */
function openConfirmarTarefas(kidId) {
  const k = DB.get('kids', kidId);
  if (!k) return toast('Criança não encontrada');
  const pendentes = DB.kidTarefasAConfirmar().filter(x => x.kid.id === kidId);
  const saiu = e => e.tipo === 'gasto' || e.tipo === 'doacao';
  const nomeDaTarefa = e => {
    const t = DB.get('kid_tasks', e.task_id);
    if (t) return `${t.icon || '⭐'} ${t.name}`;
    if (e.tipo === 'doacao') return `❤️ ${e.description || 'Doação'}`;
    if (e.tipo === 'gasto') return `🛒 ${e.description || 'Compra'}`;
    if (e.tipo === 'bonus') return `🏅 ${e.description || 'Semana completa'}`;
    return e.description || 'Tarefa';
  };
  const ganhos = pendentes.filter(x => !saiu(x.entry));
  const saidas = pendentes.filter(x => saiu(x.entry));
  const linha = x => `<div class="kid-tarefa">
      <span class="kid-tarefa-nome">${esc(nomeDaTarefa(x.entry))}
        ${saiu(x.entry)
          ? '<small>compra dela — confirmar debita a sua conta</small>'
          : '<small>ela marcou como feita</small>'}</span>
      <b class="${saiu(x.entry) ? 't-danger' : 't-ok'}">${saiu(x.entry) ? '−' : '+'}${fmt(x.entry.amount)}</b>
      <button class="link-btn" data-ok-tarefa="${x.entry.id}">confirmar</button>
      <button class="link-btn t-danger" data-no-tarefa="${x.entry.id}">${
        saiu(x.entry) ? 'não foi' : 'ainda não'}</button>
    </div>`;

  openModal(`
    <div class="modal-title">O que ${esc(k.name)} marcou<button class="close-x" id="ct-back"><span data-ico="back"></span></button></div>
    ${ganhos.length ? `<div class="sec-cab"><div class="sec-tit"><b>Ela ganhou</b>
      <small>o dinheiro entra no cofrinho quando você confirmar</small></div></div>
      ${ganhos.map(linha).join('')}` : ''}
    ${saidas.length ? `<div class="sec-cab" style="margin-top:var(--e4)"><div class="sec-tit"><b>Ela gastou</b>
      <small>confirmar lança a despesa e debita a sua conta</small></div></div>
      ${saidas.map(linha).join('')}` : ''}
    ${!pendentes.length ? '<div class="empty">Nada para confirmar agora.</div>' : ''}
  `);
  $('#ct-back').onclick = closeModal;
  document.querySelectorAll('#modal [data-ok-tarefa]').forEach(b => b.onclick = () => {
    confirmarTarefa(b.dataset.okTarefa, true); render(); openConfirmarTarefas(kidId);
  });
  document.querySelectorAll('#modal [data-no-tarefa]').forEach(b => b.onclick = () => {
    confirmarTarefa(b.dataset.noTarefa, false); render(); openConfirmarTarefas(kidId);
  });
}

/* O aviso de aperto: em que dia o dinheiro acaba.

   O total do mês fechando positivo esconde exatamente isto — dá para terminar o
   mês no azul e ficar negativo no dia 8, porque o aluguel vence antes do
   salário. Saber com antecedência é o que permite agir. */
function avisoDeAperto() {
  const ponto = DB.primeiroDiaNegativo();
  if (ponto) {
    const quando = new Date(ponto.data + 'T12:00:00');
    const dias = DB.diasEntre(DB.paraISO(new Date()), ponto.data);
    return `
      <div class="card aperto">
        <span class="aperto-ico">⚠️</span>
        <div>
          <b>O saldo fica negativo em ${fmtDate(quando)}${dias > 0 ? ` — daqui a ${dias} ${dias === 1 ? 'dia' : 'dias'}` : ', hoje'}</b>
          <p class="muted">Chega a <b class="txt-red">${fmt(ponto.saldo)}</b> considerando o que ainda entra e sai até lá. Antecipar uma entrada ou adiar uma conta resolve.</p>
        </div>
      </div>`;
  }

  /* Nada aperta neste ciclo, mas o mês que vem não deixa de existir. Uma linha de
     texto no lugar do gráfico que estava aqui: o topo do Painel é caro, e a curva
     inteira tem lugar próprio nos Relatórios. */
  const futuros = DB.fluxoMensal(0, 6).filter(m => m.futuro);
  const apertoFuturo = futuros.find(m => m.saldo < 0);
  if (!apertoFuturo) return '';
  const nome = apertoFuturo.period.start.toLocaleDateString('pt-BR', { month: 'long' });
  return `
    <div class="card aperto">
      <span class="aperto-ico">📅</span>
      <div>
        <b>Este mês fecha bem, mas ${esc(nome)} aperta</b>
        <p class="muted">Com o que já está prometido, o saldo chega a <b class="txt-red">${fmt(apertoFuturo.saldo)}</b> em ${esc(nome)}.
          <button class="link-btn" id="fut-ver">ver a curva</button></p>
      </div>
    </div>`;
}

/* Cria o contrato da repetição a partir do lançamento recém-salvo.

   O início é a PRÓXIMA ocorrência, não a de hoje: o lançamento que a pessoa
   acabou de fazer já existe e já está pago. Começar hoje deixaria o mês com duas
   linhas iguais — uma paga e outra "A Pagar" — e essa duplicidade é justamente a
   que mais irrita, porque parece erro do app. */
function criarRecorrenciaDoLancamento(tx) {
  const per = chipValue('f-rep');
  if (!per || !tx) return null;
  return contratoDoLancamento(tx, {
    periodicidade: per,
    dia: Number($('#f-rep-dia').value) || 1,
    valorTipo: $('#f-rep-valor').value,
    fimTipo: $('#f-rep-fim').value || 'sem_prazo',
    fimData: $('#f-rep-data').value || null,
    fimVezes: Number($('#f-rep-vezes').value) || 12,
  });
}

/* O CONTRATO a partir de um lançamento, sem depender do formulário.

   O miolo saiu de `criarRecorrenciaDoLancamento` para poder ser chamado também da
   folha de classificação, onde não existe `#f-rep-dia` nem `#f-rep-fim`. Duas
   cópias divergiriam no primeiro ajuste — e a regra de "salta uma ocorrência" é
   exatamente do tipo que se esquece de replicar. */
function contratoDoLancamento(tx, o) {
  if (!tx || !o || !o.periodicidade) return null;
  const per = o.periodicidade;
  const dia = Math.min(31, Math.max(1, Number(o.dia) || 1));
  const fimTipo = o.fimTipo || 'sem_prazo';
  const base = new Date((tx.date || todayISO()) + 'T12:00:00');
  // Salta uma ocorrência: a de hoje é o próprio lançamento
  const proximo = new Date(base);
  if (per === 'semanal') proximo.setDate(base.getDate() + 7);
  else if (per === 'quinzenal') proximo.setDate(base.getDate() + 14);
  else if (per === 'anual') proximo.setFullYear(base.getFullYear() + 1);
  else proximo.setMonth(base.getMonth() + 1);

  const id = DB.upsert('recurrences', {
    description: tx.description, amount: tx.amount,
    valor_tipo: o.valorTipo === 'media' ? 'media' : 'fixo',
    type: tx.type || 'Despesa', scope: tx.scope, member: tx.member || '',
    method: tx.method, category_id: tx.category_id || null,
    account_id: tx.account_id || null, card_id: tx.card_id || null,
    tags: DB.tagsOf(tx), notes: tx.notes || '',
    periodicidade: per, dia,
    inicio: DB.paraISO(proximo),
    fim_tipo: fimTipo,
    fim_data: fimTipo === 'data' ? (o.fimData || null) : null,
    /* O "N vezes" conta o lançamento de hoje: quem escolhe 12x quer doze
       cobranças no total, não doze além da que acabou de fazer. */
    fim_vezes: fimTipo === 'vezes' ? Math.max(1, (Number(o.fimVezes) || 12) - 1) : null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  DB.gerarRecorrencias();          // já traz o que couber no ciclo atual
  return id;
}

/* O gasto entrou no que estava guardado — resolve na hora.

   Sem isto, usar a reserva derruba o saldo e deixa a meta intacta: o app passa a
   afirmar que existe um dinheiro guardado que já foi gasto, e a divergência
   cresce em silêncio até ninguém confiar no número.

   Perguntar no momento do gasto é o único instante em que a pessoa sabe a
   resposta. Uma semana depois, ninguém lembra de qual meta saiu. */
function avisarSeUsouGuardado(tx) {
  /* Só dispara quando o dinheiro SAIU de verdade.

     Lançamento "A Pagar" não move saldo nenhum — é compromisso, não débito. Ele
     entra aqui depois, no instante em que for marcado como pago, porque é aí que
     a conta é debitada. Vale igual para o pagamento de fatura, que hoje é um
     lançamento de verdade e passa por este mesmo caminho. */
  if (!tx || !DB.isExpense(tx) || DB.isNeutral(tx) || tx.status !== 'Pago') return;
  /* Mede o CAIXA, não o planejamento: o comprometido continua na conta até ser
     pago, e descontá-lo aqui mandaria resgatar da reserva por causa de uma conta
     que ainda nem venceu. */
  const falta = DB.faltaParaGastar(0);        // o caixa já reflete o gasto gravado
  if (falta <= 0.005) return;                  // o dinheiro saiu do que era livre

  const metas = DB.all('goals')
    .filter(g => !g.done && DB.goalTotal(g.id) > 0.005)
    .sort((a, b) => Number(DB.isReserveGoal(a)) - Number(DB.isReserveGoal(b)));   // reserva por último
  if (!metas.length) return;                   // nada guardado: o disponível só ficou negativo

  const sugerido = Math.min(falta, DB.guardado());
  openSheet(`
    <div class="sheet-title">Este gasto usou dinheiro guardado<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">
      <b>${esc(tx.description)}</b> — ${fmt(tx.amount)}<br>
      Passou <b>${fmt(falta)}</b> do que estava livre, então entrou no que você já tinha guardado.</p>
    <div class="field"><label>De qual meta saiu?</label>
      <div class="chips" id="ug-meta">
        ${metas.map((g, i) => `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-v="${g.id}">${
          esc(g.icon || '🎯')} ${esc(g.name)} · ${fmtShort(DB.goalTotal(g.id))}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label>Quanto tirar</label>
      <input class="amount-input" id="ug-valor" type="text" inputmode="numeric" autocomplete="off">
    </div>
    <button class="btn" id="sh-save">Registrar o resgate</button>
    <div class="btn-row"><button class="btn ghost" id="ug-depois">Resolver depois</button></div>
    <p class="muted" style="margin-top:var(--e2)">Adiando, o disponível fica negativo até você resgatar ou repor — o número continua honesto, só desconfortável.</p>
  `);
  initMoney('#ug-valor', sugerido);
  bindChips('ug-meta');
  $('#sh-close').onclick = closeSheet;
  $('#ug-depois').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const valor = moneyVal('#ug-valor');
    const metaId = chipValue('ug-meta');
    if (!valor || !metaId) return toast('Escolha a meta e o valor');
    const saldo = DB.goalTotal(metaId);
    if (valor - saldo > 0.005) return toast(`Esta meta só tem ${fmt(saldo)} guardado`);
    /* Resgate SEM mexer em conta: o dinheiro já saiu no gasto que acabou de ser
       lançado. Mover saldo aqui debitaria a mesma quantia duas vezes. */
    DB.upsert('goal_entries', {
      goal_id: metaId, amount: -valor,
      description: `Usado em ${tx.description}`.slice(0, 60),
      date: tx.date || todayISO(),
      from_account: null, to_account: null,
    });
    closeSheet(); render(); Sync.autoSync();
    toast(`Resgatado ${fmt(valor)} da meta ✓`);
  };
}

/* Guardar e resgatar na mesma folha.

   O resgate é um lançamento de valor NEGATIVO na mesma tabela, não um campo à
   parte: o histórico fica em ordem e o saldo é sempre uma soma, sem como
   divergir do que está listado.

   Ele precisava existir antes de o guardado sair do disponível — sem caminho de
   volta, usar a reserva derrubaria o saldo e deixaria a meta intacta, criando um
   número que só erra para menos e não tem conserto. */
function openAporteSheet(goalId, opcoes = {}) {
  const g = DB.get('goals', goalId);
  if (!g) return toast('Meta não encontrada — atualize a tela');
  const ehReserva = DB.isReserveGoal(g);
  const saldoMeta = DB.goalTotal(goalId);
  const modo = opcoes.modo === 'resgate' ? 'resgate' : 'aporte';
  openSheet(`
    <div class="sheet-title">${esc(g.icon)} ${esc(g.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">Guardado hoje: <b>${fmt(saldoMeta)}</b>${
      g.target_amount > 0 ? ` de ${fmt(g.target_amount)}` : ''}</p>
    <div class="field">${chipGroup('a-modo', [
      { value: 'aporte', label: '＋ Guardar' },
      { value: 'resgate', label: '− Resgatar' },
    ], modo)}</div>
    <div class="field"><input class="amount-input" id="a-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="row2">
      <div class="field"><label>Descrição</label><input id="a-desc" value="Aporte"></div>
      <div class="field"><label>Data</label><input id="a-date" type="date" value="${todayISO()}"></div>
    </div>
    <div class="field"><label id="a-lbl-de">Saiu de qual conta? <span class="muted">— opcional, ajusta o saldo</span></label>
      <select id="a-account"><option value="">— não movimentar contas —</option>
        ${DB.all('accounts').filter(a => a.active !== false).map(a => `<option value="${a.id}">${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}
      </select></div>
    <div class="field"><label id="a-lbl-para">Entrou em qual conta? <span class="muted">— onde o dinheiro ficou guardado</span></label>
      <select id="a-to"><option value="">— não movimentar contas —</option>
        ${DB.all('accounts').filter(a => a.active !== false).map(a =>
          `<option value="${a.id}">${esc(a.name)} — ${fmtShort(a.balance)}</option>`).join('')}
      </select></div>
    <!-- SITUAÇÃO, igual à de um lançamento. Um aporte agendado é PLANO: não mexe
         em saldo, não conta como guardado e não abate o disponível — ele entra na
         projeção do dia em que vai sair. É o que permite simular cenários
         ("e se eu guardar 3.400 todo dia 5?") sem que o app trate a intenção como
         fato consumado. -->
    <div class="field"><label>Situação</label>
      ${chipGroup('a-status', [
        { value: 'Pago', label: 'Já aconteceu' },
        { value: 'A Pagar', label: 'Agendado' },
      ], 'Pago')}
      <p class="muted" id="a-status-nota" style="margin-top:var(--e2)"></p>
    </div>
    <p class="muted" id="a-aviso" style="margin-bottom:var(--e3)">${ehReserva
      ? '🛡️ Esta é a reserva de emergência: ela existe para não ser gasta. Resgatar aqui é legítimo numa emergência — só lembre de repor depois.'
      : 'Guardar tira o valor do seu disponível; resgatar devolve.'}</p>
    <button class="btn" id="sh-save">Guardar</button>
  `);
  initMoney('#a-amount');
  $('#sh-close').onclick = closeSheet;
  setTimeout(() => $('#a-amount').focus(), 80);

  /* A situação SEGUE A DATA por padrão, e o texto diz o que vai acontecer.

     Escolher uma data futura e deixar "já aconteceu" marcado é o erro que motivou
     tudo isto: o saldo era debitado hoje por um movimento marcado para o dia 3.
     Marcar sozinho evita o engano; o chip continua editável porque lançar um
     aporte esquecido, com data de ontem, é legítimo. */
  const notaStatus = () => {
    const n = $('#a-status-nota');
    if (!n) return;
    n.textContent = chipValue('a-status') === 'A Pagar'
      ? 'Fica no plano: não mexe no saldo nem na reserva até acontecer. Aparece na projeção do dia.'
      : 'Move o saldo agora e entra na reserva.';
  };
  const seguirData = () => {
    const d = $('#a-date').value;
    if (!d) return;
    selectChip('a-status', d > todayISO() ? 'A Pagar' : 'Pago');
    notaStatus();
  };
  bindChips('a-status', notaStatus);
  $('#a-date').addEventListener('change', seguirData);
  notaStatus();

  /* Ao resgatar, os rótulos das contas TROCAM de sentido: o dinheiro sai da
     caixinha e volta para a conta do dia a dia. Sem inverter, quem resgata
     preencheria os campos ao contrário e o saldo iria para o lado errado. */
  const pintarModo = v => {
    const resg = v === 'resgate';
    $('#a-lbl-de').innerHTML = resg
      ? 'Saiu de qual conta? <span class="muted">— de onde o dinheiro guardado sai</span>'
      : 'Saiu de qual conta? <span class="muted">— opcional, ajusta o saldo</span>';
    $('#a-lbl-para').innerHTML = resg
      ? 'Voltou para qual conta? <span class="muted">— onde o dinheiro fica disponível</span>'
      : 'Entrou em qual conta? <span class="muted">— onde o dinheiro ficou guardado</span>';
    $('#a-desc').value = resg ? 'Resgate' : 'Aporte';
    $('#sh-save').textContent = resg ? 'Resgatar' : 'Guardar';
    const aviso = $('#a-aviso');
    if (aviso && resg && saldoMeta > 0) {
      aviso.innerHTML = `Resgatar devolve o valor ao seu disponível. Há <b>${fmt(saldoMeta)}</b> guardado aqui.`;
    }
  };
  bindChips('a-modo', pintarModo);
  pintarModo(modo);

  $('#sh-save').onclick = () => {
    const amount = moneyVal('#a-amount');
    if (!amount) return toast('Informe o valor');
    const resg = chipValue('a-modo') === 'resgate';
    // Não dá para resgatar mais do que foi guardado: o saldo da meta ficaria
    // negativo e o disponível passaria a contar dinheiro que não existe
    if (resg && amount - saldoMeta > 0.005) return toast(`Só há ${fmt(saldoMeta)} guardado nesta meta`);
    const de = $('#a-account').value, para = $('#a-to').value;
    if (de && de === para) return toast('Origem e destino não podem ser a mesma conta');
    const pago = chipValue('a-status') !== 'A Pagar';
    DB.upsert('goal_entries', {
      goal_id: goalId,
      amount: resg ? -amount : amount,     // resgate é o mesmo lançamento, com sinal
      description: $('#a-desc').value || (resg ? 'Resgate' : 'Aporte'),
      date: $('#a-date').value || todayISO(),
      from_account: de || null, to_account: para || null,   // guardado para poder reverter depois
      status: pago ? 'Pago' : 'A Pagar',
    });
    /* SÓ MOVE SALDO SE JÁ ACONTECEU. Um aporte agendado é plano: o dinheiro ainda
       está na conta, e debitá-lo hoje deixaria o disponível negativo por um
       movimento que não ocorreu — foi exatamente o defeito relatado. */
    if (pago) {
      if (de) adjustBalance(de, -amount);      // sai de onde estava
      if (para) adjustBalance(para, amount);   // entra onde vai ficar
    }
    /* A MOVIMENTAÇÃO APARECE NO EXTRATO, categorizada em Investimentos.

       Antes, guardar dinheiro mexia nos saldos e não deixava rastro na lista: o
       extrato do mês fechava com uma diferença que nada explicava, e quem
       conferisse contra o banco veria a transferência lá e não aqui.

       É TRANSFERÊNCIA, não despesa — sai de uma conta e entra na outra, e por
       isso continua neutra em toda análise de gasto. A categoria serve para dar
       nome à linha; o quanto foi guardado se lê nos aportes
       (`DB.investidoNoPeriodo`), que é o que alimenta a barra do envelope. */
    if (de && para && !resg) {
      DB.upsert('transactions', {
        description: ($('#a-desc').value || `Guardado em ${g.name}`).slice(0, 60),
        amount, date: $('#a-date').value || todayISO(),
        // O status acompanha o do aporte: uma transferência "Paga" com data futura
        // seria contada pelo saldo como se já tivesse saído da conta.
        type: 'Transferência', status: pago ? 'Pago' : 'A Pagar',
        scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência',
        account_id: de, to_account: para,
        category_id: DB.categoriaDeAporte(g),
      });
    }
    closeSheet(); render(); Sync.autoSync();
    if (opcoes.aoConcluir) opcoes.aoConcluir(amount);
    toast(resg
      ? `Resgatado ${fmt(amount)} — voltou para o disponível ✓`
      : (de || para ? 'Aporte registrado e saldos ajustados ✓' : 'Aporte registrado ✓'));
  };
}

/* ---------- Configurações ---------- */
function openModal(html) {
  $('#modal').innerHTML = `<div class="modal-inner">${html}</div>`;
  $('#modal').hidden = false; $('#modal-backdrop').hidden = false;
  paintIcons($('#modal'));
  marcarValores($('#modal'));
  if (typeof UI !== 'undefined') UI.enhance($('#modal'));
}
function closeModal() { $('#modal').hidden = true; $('#modal-backdrop').hidden = true; render(); }

/* ---------- COFRINHO: a gestão, no app de quem administra ----------

   A área dos pais mora AQUI, não no app da criança. O PIN daqui criptografa os
   dados de verdade; no app dela a senha só separa irmãos. E é aqui que o adulto
   já administra tudo — pedir que ele vá a outro app para dar a semanada seria
   inventar uma segunda casa para a mesma tarefa. */

const AVATARES = ['🦖', '🦕', '🐢', '🦊', '🐨', '🦁', '🐼', '🐧', '🦉', '🐝', '🦄', '🐙'];
const CORES_KID = ['#00b894', '#0984e3', '#e17055', '#6c5ce7', '#e84393', '#fdcb6e'];
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function openCriancas() {
  const kids = DB.all('kids').filter(k => !k.deleted);
  const linha = k => {
    const potes = DB.kidPotes(k.id);
    const meta = DB.kidMeta(k.id);
    const pct = meta && meta.target_amount > 0
      ? Math.min(100, Math.round(potes.guardar / meta.target_amount * 100)) : null;
    return `<div class="kid-item${k.active === false ? ' off' : ''}" data-kid="${k.id}">
      <span class="kid-av" style="background:${esc(k.cor || '#00b894')}22;color:${esc(k.cor || '#00b894')}">${esc(k.avatar || '🦖')}</span>
      <span class="kid-info">
        <b>${esc(k.name)}</b>
        <small>${Number(k.semanada_valor) > 0
          ? `${fmt(k.semanada_valor)} · ${DIAS_SEMANA[Number(k.semanada_dia) || 0]}`
          : 'sem semanada'}${k.active === false ? ' · pausado' : ''}</small>
        <small>${DB.kidTarefas(k.id).length} tarefa(s)${meta ? ` · ${esc(meta.icon || '🎁')} ${esc(meta.name)}${pct !== null ? ` (${pct}%)` : ''}` : ' · sem meta'}</small>
        ${(() => {
          /* O AVISO SOBE PARA A LISTA. Escondido só no detalhe, ele dependia de
             alguém abrir a criança para descobrir que a semanada não estava nas
             contas — e o que não se vê não se corrige. */
          const fora = DB.semanadaForaDeSincronia(k.id);
          if (!fora) return '';
          const curto = { faltando: 'fora das suas contas', valor: 'valor diferente do contrato',
            dia: 'dia diferente do contrato', pausado: 'contrato pausado', sobrando: 'contrato sem semanada' }[fora.motivo];
          return `<small class="t-warn">⚠ ${curto}</small>`;
        })()}
      </span>
      <span class="kid-saldo">${fmt(potes.total)}</span>
      <span data-ico="chev"></span>
    </div>`;
  };
  openModal(`
    <div class="modal-title">Crianças<button class="close-x" id="kd-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">O cofrinho de cada criança. Elas acompanham pelo app próprio;
      aqui você define a semanada, as tarefas e a meta — e vê tudo em detalhe.</p>
    ${kids.map(linha).join('') || '<div class="empty"><b>Nenhuma criança ainda</b>Cadastre a primeira para começar o cofrinho dela.</div>'}
    <button class="btn ghost" id="kd-nova" style="margin-top:var(--e3)">Adicionar criança</button>
    ${kids.length ? `
      <div class="hint" style="margin-top:var(--e5)">
        <b>O app dela</b>
        Abre em <code>/cofrinho/</code> — instale no aparelho da criança como
        atalho na tela inicial. Ele pede a senha de quatro números que você
        cadastrou e mostra só o cofrinho dela, nunca as contas da casa.
      </div>
      <button class="btn ghost" id="kd-abrir" style="margin-top:var(--e3)">Abrir o app do cofrinho</button>` : ''}
  `);
  $('#kd-back').onclick = () => openConfig();
  $('#kd-nova').onclick = () => openCriancaSheet(null);
  /* A ponte roda ANTES de abrir: o app dela lê o armazém que esta função acaba
     de atualizar, e sem isto um cadastro feito agora abriria lá como inexistente. */
  if ($('#kd-abrir')) $('#kd-abrir').onclick = () => {
    try { DB.ponteDoCofrinho(); } catch (_) { }
    window.open('cofrinho/index.html', '_blank');
  };
  document.querySelectorAll('#modal [data-kid]').forEach(el =>
    el.onclick = () => openCriancaDetalhe(el.dataset.kid));
}

/* Cadastro. A senha é de QUATRO dígitos e o campo aceita só número: no app dela o
   teclado é de criança, e uma senha com letra ali seria impossível de digitar. */
function openCriancaSheet(kidId) {
  const k = kidId ? DB.get('kids', kidId) : null;
  const sel = (a, b) => (String(a) === String(b) ? ' selected' : '');
  openSheet(`
    <div class="sheet-title">${k ? 'Editar' : 'Nova'} criança<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><label>Nome</label>
      <input type="text" id="kd-nome" value="${esc(k ? k.name : '')}" autocomplete="off" placeholder="como ela é chamada"></div>
    <div class="field"><label>Bichinho</label>
      <div class="kd-escolha" id="kd-avatares">${AVATARES.map(a =>
        `<button class="kd-op${(k ? k.avatar : AVATARES[0]) === a ? ' on' : ''}" data-av="${a}">${a}</button>`).join('')}</div></div>
    <div class="field"><label>Cor</label>
      <div class="kd-escolha" id="kd-cores">${CORES_KID.map(c =>
        `<button class="kd-op kd-cor${(k ? k.cor : CORES_KID[0]) === c ? ' on' : ''}" data-cor="${c}" style="background:${c}"></button>`).join('')}</div></div>
    <div class="field"><label>Semanada</label>
      <input class="amount-input" id="kd-valor" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><label>Em que dia da semana?</label>
      <select id="kd-dia">${DIAS_SEMANA.map((d, i) =>
        `<option value="${i}"${sel(k ? k.semanada_dia : 5, i)}>${d}</option>`).join('')}</select></div>
    <div class="field"><label>Moeda mágica</label>
      <input class="amount-input" id="kd-rend" type="text" inputmode="numeric" autocomplete="off">
      <p class="muted" style="margin-top:var(--e1)">Cai toda semana em que ela não mexer no que guardou.
        É o rendimento em formato que a idade entende — zero desliga.</p></div>
    <div class="field"><label>Senha do cofrinho (4 números)</label>
      <input type="tel" id="kd-pin" maxlength="4" inputmode="numeric" autocomplete="off" placeholder="${k && k.pin_hash ? 'já tem senha — digite para trocar' : 'ex: dia e mês do aniversário'}">
      <p class="muted" style="margin-top:var(--e1)">Só separa os cofrinhos entre irmãos. Não guarda dinheiro de verdade.</p></div>
    <button class="btn" id="sh-save">Salvar</button>
  `);
  initMoney('#kd-valor', k ? k.semanada_valor : 0);
  initMoney('#kd-rend', k ? k.rendimento_valor : 0);
  let av = k ? (k.avatar || AVATARES[0]) : AVATARES[0];
  let cor = k ? (k.cor || CORES_KID[0]) : CORES_KID[0];
  const marcar = (sel2, attr, valor) => {
    document.querySelectorAll(`#modal ${sel2} .kd-op, ${sel2} .kd-op`).forEach(b => {
      if (b.dataset && b.dataset[attr] !== undefined) b.classList.toggle('on', b.dataset[attr] === valor);
    });
  };
  document.querySelectorAll('[data-av]').forEach(b => b.onclick = () => { av = b.dataset.av; marcar('#kd-avatares', 'av', av); });
  document.querySelectorAll('[data-cor]').forEach(b => b.onclick = () => { cor = b.dataset.cor; marcar('#kd-cores', 'cor', cor); });
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = async () => {
    const nome = ($('#kd-nome').value || '').trim();
    if (!nome) return toast('Informe o nome');
    const pin = ($('#kd-pin').value || '').trim();
    const base = {
      ...(k || {}), name: nome, avatar: av, cor,
      semanada_valor: moneyVal('#kd-valor') || 0,
      semanada_dia: Number($('#kd-dia').value) || 0,
      rendimento_tipo: 'moeda', rendimento_valor: moneyVal('#kd-rend') || 0,
      active: k ? k.active !== false : true,
    };
    if (pin) {
      if (!/^\d{4}$/.test(pin)) return toast('A senha precisa ter 4 números');
      const salt = String(Math.random()).slice(2, 12);
      base.pin_salt = salt;
      base.pin_hash = await hashDaSenha(pin, salt);
    }
    DB.upsert('kids', base);
    closeSheet(); Sync.autoSync(); openCriancas();
    toast(k ? 'Criança atualizada ✓' : 'Criança cadastrada ✓');
  };
}

/* A senha do cofrinho é uma tranca entre irmãos, não um cofre: SHA-256 com sal
   basta. Usar as 150 mil voltas de PBKDF2 do PIN da família seria proteger com
   peso de banco algo que guarda quatro moedas — e travaria a abertura no tablet. */
async function hashDaSenha(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* O detalhe: tudo da criança num lugar só, com o extrato completo. É o que o app
   dela NÃO mostra — lá a história é ilustrada e curta; aqui é auditoria. */
/* O CUSTO DA SEMANADA, no orçamento de quem paga.

   O cofrinho mostra o dinheiro chegando para a criança. Este bloco é o outro
   lado: para a família é despesa semanal, e sem contrato ela não existia em
   nenhum número do app — nem no custo fixo, nem no comprometido, nem na
   projeção. Dois filhos a R$ 8 por semana passam de R$ 75 por mês invisíveis.

   Mostra o mensal e não o semanal porque é em mês que o orçamento é decidido; o
   valor da semana fica junto, na mesma linha, para a conta ser conferível. */
function blocoDaSemanada(kidId) {
  const k = DB.get('kids', kidId);
  if (!k) return '';
  const semana = (Number(k.semanada_valor) || 0)
    + (k.rendimento_tipo === 'moeda' ? (Number(k.rendimento_valor) || 0) : 0);
  const mensal = DB.semanadaMensalDoKid(k);
  const contrato = DB.contratoDaSemanada(kidId);
  const fora = DB.semanadaForaDeSincronia(kidId);

  if (semana <= 0 && !contrato) {
    return `<div class="sec-cab"><div class="sec-tit"><b>Custo para vocês</b>
      <small>sem semanada definida</small></div></div>`;
  }

  /* O AVISO DIZ O QUE MUDOU, não que "algo está diferente": o motivo é o que
     torna a linha acionável em um toque em vez de virar um alerta que se ignora. */
  const recado = !fora ? null : {
    faltando: 'Esta semanada ainda não entra nas suas contas. Crie o contrato para ela aparecer no custo fixo e na projeção.',
    valor: `O contrato está em ${fmt(fora.atual)} por semana e a semanada agora é ${fmt(fora.esperado)}.`,
    dia: 'O contrato lança em outro dia da semana.',
    pausado: 'O contrato está pausado, então a semanada não está sendo lançada.',
    sobrando: 'A semanada foi zerada, mas o contrato continua lançando.',
  }[fora.motivo];

  return `
    <div class="sec-cab"><div class="sec-tit"><b>Custo para vocês</b>
      <small>${fmt(semana)} por semana${k.rendimento_valor > 0 && k.rendimento_tipo === 'moeda'
        ? ` (semanada + moeda mágica)` : ''}</small></div>
      ${fora ? `<div class="sec-acoes"><button class="sec-btn" id="kdd-contrato">${
        fora.motivo === 'faltando' ? 'Criar contrato' : fora.motivo === 'sobrando' ? 'Encerrar' : 'Acertar'
      }</button></div>` : ''}</div>
    <div class="card" style="margin-bottom:var(--e3)">
      <div class="proj-row"><span>No mês</span><b>${fmt(mensal)}</b></div>
      <div class="proj-row"><span>${contrato ? 'Contrato' : 'Sem contrato'}</span>
        <b>${contrato ? esc(contrato.description) : '—'}</b></div>
      ${recado ? `<p class="muted" style="margin-top:var(--e2)">${recado}</p>` : ''}
      ${!fora ? `<p class="muted" style="margin-top:var(--e2)">Entra no custo fixo mensal e na projeção,
        como qualquer outro contrato.</p>` : ''}
    </div>`;
}

/* A LINHA DO MOVIMENTO, uma só, usada na tela da criança e no extrato completo.

   Duplicá-la faria as duas telas divergirem no primeiro ajuste — e a divergência
   apareceria como "o extrato mostra diferente do resumo", que é o tipo de coisa
   que destrói a confiança nos dois. */
function linhaDoMovimento(e) {
  const rotulo = { semanada: 'Semanada', tarefa: 'Tarefa', bonus: 'Semana completa',
    presente: 'Presente', gasto: 'Gasto', doacao: 'Doação', rendimento: 'Moeda mágica',
    inicial: 'Já tinha antes', divisao: 'Repartiu nos potes' };
  const icone = { semanada: '🪙', tarefa: '⭐', bonus: '🏅', presente: '🎁', gasto: '🛒',
    doacao: '❤️', rendimento: '✨', inicial: '🏁', divisao: '🫙' };
  const potinho = { gastar: '🍭', guardar: '🎯', doar: '❤️' };
  const saiu = e.tipo === 'gasto' || e.tipo === 'doacao';
  return `<div class="kid-mov">
    <span class="kid-mov-ico">${icone[e.tipo] || '🪙'}</span>
    <span class="kid-mov-info"><b>${esc(rotulo[e.tipo] || e.tipo)}${
      e.description && e.description !== e.tipo ? ' · ' + esc(e.description) : ''}</b>
      <small>${fmtDay(e.date)} · ${potinho[e.pote] || ''} ${esc(e.pote)}${
        e.confirmada === false ? ' · esperando você' : ''}</small></span>
    <span class="kid-mov-val ${saiu ? 't-danger' : 't-ok'}">${saiu ? '−' : '+'}${fmt(e.amount)}</span>
  </div>`;
}

/* O EXTRATO COMPLETO, em tela própria. */
function openKidExtrato(kidId) {
  const k = DB.get('kids', kidId);
  if (!k) return toast('Criança não encontrada');
  const movs = DB.kidEntries(kidId);
  const potes = DB.kidPotes(kidId);
  openModal(`
    <div class="modal-title">Extrato de ${esc(k.name)}<button class="close-x" id="kx-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">${movs.length} movimento(s) · saldo de ${fmt(potes.total)}</p>
    ${movs.map(linhaDoMovimento).join('') || '<div class="empty">Nada movimentado ainda.</div>'}
  `);
  $('#kx-back').onclick = () => openCriancaDetalhe(kidId);
}

/* A PERGUNTA DA SEMANA.

   Esta tela mostra números — quanto ela tem, o que gastou, quanto falta — e nenhum deles
   diz o que CONVERSAR. É o ponto de maior consenso entre educadores da área e o mais
   ignorado pelos apps: dinheiro se aprende conversando, não usando aplicativo. O
   cofrinho é o pretexto para a aula, não a aula.

   FICA LOGO ABAIXO DA SEMANADA, que é o outro bloco que pede ação sua. E some quando não
   há o que perguntar: uma sugestão genérica toda semana ensina a ignorar o bloco, e aí
   ele deixa de servir também na semana em que tem algo real a dizer. */
function blocoDaConversa(kidId) {
  const q = DB.perguntaDaSemana(kidId);
  if (!q) return '';
  return `
    <div class="card conversa">
      <div class="conversa-cab">Para conversar esta semana</div>
      <div class="conversa-fato">${esc(q.fato)}</div>
      <div class="conversa-q">${esc(q.pergunta)}</div>
    </div>`;
}
function openCriancaDetalhe(kidId) {
  const k = DB.get('kids', kidId);
  if (!k) return toast('Criança não encontrada');
  const potes = DB.kidPotes(kidId);
  const meta = DB.kidMeta(kidId);
  const tarefas = DB.kidTarefas(kidId);
  const entradas = DB.kidEntries(kidId).slice(0, 30);
  const rotulo = { semanada: 'Semanada', tarefa: 'Tarefa', presente: 'Presente', gasto: 'Gasto', doacao: 'Doação', rendimento: 'Moeda mágica', inicial: 'Já tinha antes', divisao: 'Repartiu nos potes' };
  const icone = { semanada: '🪙', tarefa: '⭐', presente: '🎁', gasto: '🛒', doacao: '❤️', rendimento: '✨', inicial: '🏁', divisao: '🫙' };
  const potinho = { gastar: '🍭', guardar: '🎯', doar: '❤️' };

  openModal(`
    <div class="modal-title">${esc(k.avatar || '🦖')} ${esc(k.name)}<button class="close-x" id="kdd-back"><span data-ico="back"></span></button></div>

    <div class="card" style="margin-bottom:var(--e3)">
      <div class="proj-row"><span>🍭 Gastar agora</span><b>${fmt(potes.gastar)}</b></div>
      <div class="proj-row"><span>🎯 Guardar</span><b>${fmt(potes.guardar)}</b></div>
      <div class="proj-row"><span>❤️ Doar</span><b>${fmt(potes.doar)}</b></div>
      <div class="proj-row" style="border-top:1px solid var(--line);font-weight:700"><span>Total</span><b>${fmt(potes.total)}</b></div>
    </div>

    ${blocoDaSemanada(kidId)}

    ${blocoDaConversa(kidId)}

    <div class="sec-cab"><div class="sec-tit"><b>Meta</b><small>${meta
      ? `${esc(meta.name)} · ${fmt(meta.target_amount)}` : 'nenhuma agora'}</small></div>
      <div class="sec-acoes"><button class="sec-btn" id="kdd-meta">${meta ? 'Trocar' : 'Criar'}</button></div></div>
    ${meta ? `<div class="card" style="margin-bottom:var(--e3)">
      <div class="budget-head"><span class="muted">${esc(meta.icon || '🎁')} ${esc(meta.name)}</span><span class="num">${fmt(potes.guardar)} de ${fmt(meta.target_amount)}</span></div>
      <div class="bar bar-green"><i style="width:${Math.min(100, meta.target_amount > 0 ? potes.guardar / meta.target_amount * 100 : 0)}%"></i></div>
      ${DB.kidSemanadasParaMeta(kidId) !== null ? `<p class="muted" style="margin-top:var(--e2)">Faltam ${DB.kidSemanadasParaMeta(kidId)} semanada(s).</p>` : ''}
    </div>` : ''}

    <div class="sec-cab"><div class="sec-tit"><b>Missões</b><small>valem dinheiro extra</small></div>
      <div class="sec-acoes"><button class="sec-btn" id="kdd-tarefa">Nova</button></div></div>
    ${tarefas.map(t => `<div class="kid-tarefa">
      <span class="kid-tarefa-nome">${esc(t.icon || '⭐')} ${esc(t.name)}
        ${/* O PROGRESSO DA DIÁRIA precisa aparecer aqui: sem ele o adulto aprova o
             bônus da semana sem ter como conferir se a semana foi cumprida — e a
             confirmação, que é o que impede o app de virar auto-serviço, viraria
             carimbo. */ ''}
        ${t.diaria
          ? `<small>todo dia · ${t.feitos} de 7 dias${
              t.completou ? (t.bonusPago ? ' · semana paga ✓' : ' · semana completa, confira') : ''}</small>`
          : ''}</span>
      <b>${fmt(t.amount)}${t.diaria ? '<small>/semana</small>' : ''}</b>
      <button class="link-btn" data-edit-tarefa="${t.id}">editar</button>
      <button class="link-btn t-danger" data-del-tarefa="${t.id}">tirar</button>
    </div>`).join('') || '<div class="empty">Nenhuma missão cadastrada.</div>'}

    <div class="sec-cab" style="margin-top:var(--e4)"><div class="sec-tit"><b>Movimento</b><small>tudo que entrou e saiu</small></div>
      <div class="sec-acoes"><button class="sec-btn" id="kdd-lanc">Lançar</button></div></div>
    ${/* SÓ OS ÚLTIMOS CINCO AQUI. Trinta linhas de extrato empurravam a meta, as
         missões e os botões de configuração para fora da tela — e esta é a tela de
         ADMINISTRAR, não de auditar. O extrato inteiro está a um toque, com espaço
         para ser lido. */''}
    ${entradas.slice(0, 5).map(linhaDoMovimento).join('') || '<div class="empty">Nada movimentado ainda.</div>'}
    ${entradas.length > 5 ? `<button class="btn ghost" id="kdd-extrato" style="margin-top:var(--e2)">
      Ver o extrato completo (${entradas.length})</button>` : ''}

    <div class="sec-cab" style="margin-top:var(--e4)"><div class="sec-tit"><b>Configurações</b><small>semanada, senha e bichinho</small></div>
      <div class="sec-acoes"><button class="sec-btn" id="kdd-editar">Editar</button></div></div>
    <button class="btn ghost" id="kdd-pausar" style="margin-top:var(--e2)">${k.active === false ? 'Reativar cofrinho' : 'Pausar cofrinho'}</button>
    <button class="btn ghost t-danger" id="kdd-excluir" style="margin-top:var(--e2)">Excluir cofrinho</button>
    <p class="muted" style="margin-top:var(--e2)">Pausar guarda tudo e só esconde do app dela.
      Excluir apaga o cofrinho inteiro — movimento, meta, tarefas e o contrato da semanada.</p>
  `);
  $('#kdd-back').onclick = () => openCriancas();
  $('#kdd-editar').onclick = () => openCriancaSheet(kidId);
  if ($('#kdd-extrato')) $('#kdd-extrato').onclick = () => openKidExtrato(kidId);
  /* Acertar o contrato é uma ação de UM toque, e não um formulário: o app já sabe
     o valor, o dia e a periodicidade certos — pedir para a pessoa redigitar o que
     ele conhece só cria chance de errar. */
  if ($('#kdd-contrato')) $('#kdd-contrato').onclick = () => {
    const fora = DB.semanadaForaDeSincronia(kidId);
    DB.acertarContratoDaSemanada(kidId);
    /* Gera o que já venceu na hora: sem isto o contrato nasce certo e o custo
       fixo só mudaria na próxima abertura do app, dando a impressão de que o
       botão não fez nada. */
    try { DB.gerarRecorrencias(); } catch (_) { }
    Sync.autoSync();
    openCriancaDetalhe(kidId);
    toast(fora && fora.motivo === 'sobrando' ? 'Contrato encerrado ✓'
      : fora && fora.motivo === 'faltando' ? 'Contrato criado — já entra no custo fixo ✓'
      : 'Contrato acertado ✓');
  };
  $('#kdd-meta').onclick = () => openKidMetaSheet(kidId);
  $('#kdd-tarefa').onclick = () => openKidTarefaSheet(kidId);
  document.querySelectorAll('[data-edit-tarefa]').forEach(b =>
    b.onclick = () => openKidTarefaSheet(kidId, b.dataset.editTarefa));
  $('#kdd-lanc').onclick = () => openKidLancarSheet(kidId);
  $('#kdd-pausar').onclick = () => {
    DB.upsert('kids', { ...k, active: k.active === false });
    Sync.autoSync(); openCriancaDetalhe(kidId);
  };
  /* A CONFIRMAÇÃO DIZ O QUE VAI SUMIR, com números.

     "Tem certeza?" não informa nada — quem lê já sabe que tem certeza, e por isso
     confirma no automático. Dizer "8 movimentos, 2 tarefas e o contrato da
     semanada" dá a chance real de perceber que se está apagando o cofrinho
     errado. */
  $('#kdd-excluir').onclick = () => {
    const potes = DB.kidPotes(kidId);
    const nEnt = DB.all('kid_entries').filter(e => e.kid_id === kidId).length;
    const nTar = DB.all('kid_tasks').filter(t => t.kid_id === kidId).length;
    const temContrato = !!DB.contratoDaSemanada(kidId);
    const partes = [];
    if (nEnt) partes.push(`${nEnt} movimento(s)`);
    if (DB.kidMeta(kidId)) partes.push('a meta');
    if (nTar) partes.push(`${nTar} tarefa(s)`);
    if (temContrato) partes.push('o contrato da semanada');
    if (potes.total > 0.005) partes.push(`o saldo de ${fmt(potes.total)}`);
    const lista = partes.length ? partes.join(', ') : 'o cadastro';
    if (!confirm(`Excluir o cofrinho de ${k.name}?\n\nIsto apaga ${lista}.\n\nNão dá para desfazer.`)) return;
    const r = DB.apagarCofrinho(kidId);
    Sync.autoSync();
    openCriancas();
    toast(r ? `Cofrinho de ${k.name} excluído ✓` : 'Nada a excluir');
  };
  document.querySelectorAll('#modal [data-del-tarefa]').forEach(b => b.onclick = () => {
    DB.remove('kid_tasks', b.dataset.delTarefa);
    Sync.autoSync(); openCriancaDetalhe(kidId);
  });
}

/* A meta. Curta de propósito: 2 a 6 semanadas. Uma meta de seis meses aos 6 anos
   não é meta, é frustração agendada — e o aviso aparece na hora de salvar. */
function openKidMetaSheet(kidId) {
  const k = DB.get('kids', kidId);
  const atual = DB.kidMeta(kidId);
  /* OS DESENHOS DE SONHO, em ordem agrupada por tipo de desejo: rodar, brincar, criar,
     ler/ouvir, vestir e viver. A grade não desenha separador entre os grupos — a ordem
     só mantém os parecidos vizinhos, que já evita a sopa de trinta ícones soltos, mas
     não é uma navegação por seções e não vale prometer que seja.

     Eram dez, e dez cobrem mal o que uma criança quer: faltava patins, faltava
     instrumento, faltava viagem, faltava bichinho. Sonho que não tem desenho vira
     "🚲" por falta de opção — e aí o desenho para de significar o sonho DELA, que é
     justamente o que faz a barra de progresso valer alguma coisa. */
  const ICONES_META = [
    // rodar
    '🚲', '🛴', '🛹', '🛼', '🏊', '🪁',
    // brincar
    '🧸', '🎮', '🧱', '🧩', '⚽', '🏀', '🚗', '🦖', '🎲',
    // criar
    '🎨', '🎸', '🎹', '🎤', '📷',
    // ler e ouvir
    '📚', '🎧', '⌚', '📱',
    // vestir
    '👟', '🎒', '🧢', '🦸',
    // viver
    '🍦', '🍕', '🎂', '🎪', '🎬', '🏕️', '🐶', '🐠',
  ];
  openSheet(`
    <div class="sheet-title">Meta de ${esc(k.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><label>O que ela quer?</label>
      <input type="text" id="km-nome" value="${esc(atual ? atual.name : '')}" autocomplete="off" placeholder="uma bicicleta, um jogo…"></div>
    <div class="field"><label>Desenho</label>
      <div class="kd-escolha" id="km-icones">${ICONES_META.map(i =>
        `<button class="kd-op${(atual ? atual.icon : ICONES_META[0]) === i ? ' on' : ''}" data-ic="${i}">${i}</button>`).join('')}</div></div>
    <div class="field"><label>Quanto custa?</label>
      <input class="amount-input" id="km-valor" type="text" inputmode="numeric" autocomplete="off"></div>
    <p class="muted" id="km-aviso"></p>
    <button class="btn" id="sh-save">Salvar</button>
  `);
  initMoney('#km-valor', atual ? atual.target_amount : 0);
  let ic = atual ? (atual.icon || ICONES_META[0]) : ICONES_META[0];
  document.querySelectorAll('[data-ic]').forEach(b => b.onclick = () => {
    ic = b.dataset.ic;
    document.querySelectorAll('[data-ic]').forEach(o => o.classList.toggle('on', o.dataset.ic === ic));
  });
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const nome = ($('#km-nome').value || '').trim();
    const valor = moneyVal('#km-valor');
    if (!nome) return toast('Diga o que ela quer');
    if (!valor) return toast('Informe quanto custa');
    /* AVISO, não bloqueio: a decisão é da família, mas o app diz o que sabe.
       Por semana entra a semanada mais a moeda mágica. */
    const porSemana = (Number(k.semanada_valor) || 0) + (Number(k.rendimento_valor) || 0);
    const semanas = porSemana > 0 ? Math.ceil(valor / porSemana) : 0;
    if (semanas > 8) {
      if (!confirm(`Nesse ritmo são ${semanas} semanadas — quase ${Math.round(semanas / 4)} meses.\n\nPara uma criança pequena, metas de 2 a 6 semanadas funcionam melhor: o que demora demais deixa de ser meta e vira desânimo.\n\nQuer salvar assim mesmo?`)) return;
    }
    if (atual) DB.upsert('kid_goals', { ...atual, done: true, done_at: todayISO() });
    DB.upsert('kid_goals', { kid_id: kidId, name: nome, icon: ic, target_amount: valor, done: false });
    closeSheet(); Sync.autoSync(); openCriancaDetalhe(kidId);
    toast('Meta definida ✓');
  };
}

/* A MISSÃO ESCOLHE A FREQUÊNCIA, e a escolha muda o significado do valor.

   Semanal: faz uma vez, ganha o valor. "Ajudar a pôr a mesa" não acontece todo
   dia, e cobrar todo dia transformaria a lista em falha permanente.

   Diária: precisa acontecer todos os dias — a água do cachorro é o caso que
   revelou a falta. Aí o valor NÃO é por dia: sai uma vez, ao completar a semana.
   Sete toques a R$ 1 numa semanada de R$ 10 fariam 70% da renda dela vir do
   cachorro, e ensinariam que cuidar de quem depende de você tem preço por
   unidade. O bônus premia a constância; faltar um dia não custa R$ 1, quebra a
   sequência. */
/* CRIAR E EDITAR pela mesma tela.

   Não havia edição: uma missão cadastrada com a frequência errada só saía do jeito
   difícil — apagar e recriar —, e apagar leva junto o histórico de marcações da
   criança. Na prática isso significava que um erro de cadastro custava a semana dela.

   A falta virou problema real quando a migração trocou a frequência das missões no
   servidor: as diárias viraram semanais, e não havia caminho no app para desfazer. */
function openKidTarefaSheet(kidId, tarefaId) {
  const atual = tarefaId ? DB.get('kid_tasks', tarefaId) : null;
  /* OS DESENHOS DE MISSÃO, agrupados por onde a missão acontece: quarto, casa, corpo,
     escola e cuidar de alguém. Eram oito, e oito não cobrem a rotina de uma casa —
     faltava lixo, faltava roupa, faltava lição, faltava banho.

     O DESENHO IMPORTA MAIS AQUI DO QUE NA META, porque é ele que a criança lê na aba
     de missões: aos seis anos ela reconhece o ícone antes de decifrar o nome, e duas
     missões com o mesmo desenho viram a mesma missão aos olhos dela. */
  const ICONES_T = [
    // quarto
    '🛏️', '🧸', '👕', '🧦', '👟',
    // casa
    '🍽️', '🧹', '🧽', '🗑️', '🧺', '🍳', '🛒', '🚗', '💡',
    // corpo
    '🦷', '🚿', '🧼', '😴', '⏰',
    // escola
    '📚', '✏️', '🎒', '🎹',
    // cuidar
    '🪴', '🐕', '🐈', '🐠', '🤝',
  ];
  openSheet(`
    <div class="sheet-title">${atual ? 'Editar missão' : 'Nova missão'}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><label>Qual missão?</label>
      <input type="text" id="kt-nome" autocomplete="off" placeholder="regar as plantas…"
        value="${atual ? esc(atual.name) : ''}"></div>
    <div class="field"><label>Desenho</label>
      <div class="kd-escolha" id="kt-icones">${ICONES_T.map((i, n) =>
        `<button class="kd-op${(atual ? atual.icon === i : n === 0) ? ' on' : ''}" data-ic="${i}">${i}</button>`).join('')}</div></div>
    <div class="field"><label>Com que frequência?</label>
      ${/* A FREQUÊNCIA ATUAL VEM MARCADA. Sem isto, abrir para editar e salvar sem
           tocar no campo silenciosamente rebaixaria toda diária para semanal — o mesmo
           estrago que a migração fez, agora com um clique. */''}
      <select id="kt-freq">
        <option value="semanal"${!atual || !['diaria', 'especial'].includes(atual.frequencia) ? ' selected' : ''}>Uma vez na semana</option>
        <option value="diaria"${atual && atual.frequencia === 'diaria' ? ' selected' : ''}>Todo dia</option>
        <option value="especial"${atual && atual.frequencia === 'especial' ? ' selected' : ''}>Missão especial, com prazo</option>
      </select>
      <p class="muted" id="kt-nota" style="margin-top:var(--e1)"></p></div>
    <div class="field" id="kt-campo-prazo" hidden><label>Até quando?</label>
      <input type="date" id="kt-prazo" value="${atual && atual.expira_em ? esc(atual.expira_em) : ''}"></div>
    <div class="field"><label>Quanto vale?</label>
      <input class="amount-input" id="kt-valor" type="text" inputmode="numeric" autocomplete="off">
      <p class="muted" id="kt-nota-valor" style="margin-top:var(--e1)"></p></div>
    <button class="btn" id="sh-save">${atual ? 'Salvar' : 'Criar'}</button>
  `);
  initMoney('#kt-valor', atual ? Number(atual.amount) || 0 : 1);

  /* VALOR ZERO É UMA ESCOLHA, e a nota existe para deixar isso explícito.

     Pagar por tudo é o erro mais comum e o mais caro: quando se paga por algo que a
     criança já fazia de graça, ela para de fazer pelo próprio motivo e passa a fazer pelo
     preço — e some no dia em que o preço some. É o efeito de superjustificação, e vale
     avisar aqui, na hora de escolher, e não num texto de ajuda que ninguém abre.

     A nota NÃO impede nada. Quem decide o que se paga nesta casa é você. */
  const notaDoValor = () => {
    const el = $('#kt-nota-valor');
    if (!el) return;
    const v = Number(String($('#kt-valor').value || '').replace(/\D/g, '')) / 100;
    el.innerHTML = v > 0
      ? 'Trabalho extra: ela recebe quando você confirmar.'
      : '<b>Sem moeda.</b> Vai para "porque somos uma família" no app dela — '
        + 'ganha prêmio, não dinheiro. É o lugar de arrumar a cama e pôr a mesa: '
        + 'pagar o que ela já faz por morar aqui costuma fazer ela parar de fazer '
        + 'quando o pagamento para.';
  };
  $('#kt-valor').addEventListener('input', notaDoValor);
  notaDoValor();
  let ic = atual ? (atual.icon || ICONES_T[0]) : ICONES_T[0];
  document.querySelectorAll('[data-ic]').forEach(b => b.onclick = () => {
    ic = b.dataset.ic;
    document.querySelectorAll('[data-ic]').forEach(o => o.classList.toggle('on', o.dataset.ic === ic));
  });
  /* A NOTA MUDA COM A ESCOLHA. Sem ela, "quanto vale" numa missão diária seria
     lido como valor por dia — que é exatamente o que o desenho evita. */
  const nota = () => {
    const f = $('#kt-freq').value;
    const campo = $('#kt-campo-prazo');
    if (campo) campo.hidden = f !== 'especial';
    $('#kt-nota').innerHTML = f === 'diaria'
      ? 'Ela marca todo dia. O valor sai <b>uma vez</b>, ao completar os sete dias — premia ter cuidado a semana toda, não cada dia.'
      : f === 'especial'
        ? 'Um combinado pontual, que <b>não volta</b> toda semana. O app mostra quantas noites faltam; se o prazo passar, a missão sai da lista sem alarde.'
        : 'Ela marca uma vez e o valor sai quando você confirmar.';
  };
  nota();
  $('#kt-freq').onchange = nota;
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const nome = ($('#kt-nome').value || '').trim();
    if (!nome) return toast('Diga qual é a missão');
    if ($('#kt-freq').value === 'especial' && !($('#kt-prazo') || {}).value) {
      /* SEM PRAZO NÃO É ESPECIAL, é uma semanal com outro nome — e ela ficaria na
         tela para sempre esperando um "até quando" que nunca chega. */
      return toast('Diga até quando vale a missão especial');
    }
    /* O ID PRESERVADO é o que separa editar de recriar: as marcações da criança
       apontam para ele, e um id novo deixaria o histórico dela órfão. */
    const freqEscolhida = $('#kt-freq').value;
    DB.upsert('kid_tasks', {
      ...(atual || {}),
      kid_id: kidId, name: nome, icon: ic,
      amount: moneyVal('#kt-valor') || 0,
      /* NA DÚVIDA, PRESERVA o que a missão já era -- nunca rebaixa para semanal.

         A versão anterior caía em 'semanal' sempre que o campo não devolvesse um valor
         reconhecido, e 'semanal' é um palpite: numa edição, ele apagaria silenciosamente
         a diária que o adulto nem tocou. É o mesmo estrago que o default da migração fez
         no servidor, e o teste pegou aqui antes de chegar na tela.

         Semanal só quando é a escolha explícita, ou quando não há nada anterior a
         preservar -- que é o caso de uma missão nova. */
      frequencia: ['diaria', 'especial', 'semanal'].includes(freqEscolhida)
        ? freqEscolhida
        : (atual && atual.frequencia) || 'semanal',
      /* O PRAZO só existe na especial. Guardar em qualquer outra deixaria um campo
         morto que uma versão futura poderia começar a ler sem querer. */
      expira_em: $('#kt-freq').value === 'especial' ? (($('#kt-prazo') || {}).value || null) : null,
      active: true,
    });
    closeSheet(); Sync.autoSync(); openCriancaDetalhe(kidId);
    toast(atual ? 'Missão salva ✓' : 'Missão criada ✓');
  };
}

/* Lançar à mão: presente da avó, um gasto que ela fez, uma doação. O POTE é
   obrigatório porque é ele que dá significado — gastar do "guardar" é outra
   história, e a criança precisa ver a diferença. */
function openKidLancarSheet(kidId) {
  openSheet(`
    <div class="sheet-title">Lançar movimento<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><label>O que aconteceu?</label>
      <select id="kl-tipo">
        <option value="inicial">Já tinha antes de começar</option>
        <option value="presente">Ganhou um presente em dinheiro</option>
        <option value="gasto">Gastou com alguma coisa</option>
        <option value="doacao">Doou para alguém</option>
        <option value="semanada">Semanada</option>
      </select></div>
    <div class="field"><label>De qual pote?</label>
      <select id="kl-pote">
        <option value="gastar">🍭 Gastar agora</option>
        <option value="guardar">🎯 Guardar</option>
        <option value="doar">❤️ Doar</option>
      </select></div>
    <div class="field"><label>Quanto?</label>
      <input class="amount-input" id="kl-valor" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><label>Quando?</label>
      <input type="date" id="kl-data" value="${todayISO()}"></div>
    <div class="field"><label>Descrição</label>
      <input type="text" id="kl-desc" autocomplete="off" placeholder="opcional"></div>
    <p class="muted">Para abrir o cofrinho com o que ele já tinha, use
      <b>Já tinha antes de começar</b> — o histórico dele fica honesto, sem inventar
      um presente que não houve.</p>
    <button class="btn" id="sh-save">Lançar</button>
  `);
  initMoney('#kl-valor', 0);
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const valor = moneyVal('#kl-valor');
    if (!valor) return toast('Informe o valor');
    /* A DATA É EDITÁVEL porque o saldo de abertura é histórico: o dinheiro que a
       criança já tinha não chegou hoje. Fixar em hoje faria o primeiro lançamento
       do cofrinho mentir sobre quando aquilo aconteceu — e é o único registro que
       ela vai ter do começo. */
    const data = ($('#kl-data') && $('#kl-data').value) || todayISO();
    DB.upsert('kid_entries', {
      kid_id: kidId, tipo: $('#kl-tipo').value, pote: $('#kl-pote').value,
      amount: valor, date: data, description: ($('#kl-desc').value || '').trim(), confirmada: true,
      // Nasce esperando a criança repartir; ver Dados.aRepartir
      repartido: false,
    });
    closeSheet(); Sync.autoSync(); openCriancaDetalhe(kidId);
    toast('Lançado ✓');
  };
}

/* PAGAR A SEMANADA. Nasce inteira no pote "gastar"; a divisão nos três potes é
   decisão da criança, no app dela — e é ali que a lição acontece. Se ela não
   dividir, fica em gastar mesmo: o app não decide por ela.

   A moeda mágica sai junto quando é devida: as duas são do mesmo ritual semanal,
   e separar em dois toques faria o adulto esquecer uma delas. */
function pagarSemanada(kidId) {
  const k = DB.get('kids', kidId);
  if (!k) return false;
  const devida = DB.kidSemanadaDevida(k);
  if (!devida) return false;
  DB.upsert('kid_entries', {
    kid_id: kidId, tipo: 'semanada', pote: 'gastar', amount: devida.valor,
    date: todayISO(), description: 'Semanada', confirmada: true,
  });
  const magica = DB.kidMoedaMagicaDevida(k);
  if (magica) {
    DB.upsert('kid_entries', {
      kid_id: kidId, tipo: 'rendimento', pote: 'guardar', amount: magica.valor,
      date: todayISO(), description: 'Moeda mágica', confirmada: true,
    });
  }
  /* DÁ BAIXA NO LANÇAMENTO DO EXTRATO, no mesmo ato.

     O contrato materializa a semanada como lançamento em aberto, e antes ele
     esperava um segundo toque — em outra fila, com outro rótulo e outro valor. Um
     ato virando duas tarefas é o que fez alguém ler o painel e concluir que ia
     lançar duas vezes.

     Marcar como Pago aqui não move saldo (a semanada é neutra, ver txEffect): só
     registra que a entrega aconteceu. O que credita o cofrinho é o lançamento
     acima; este fecha o compromisso do lado de quem paga.

     Só a ocorrência da SEMANA CORRENTE, e não tudo que estiver em aberto: dar a
     semanada de hoje não pode quitar a que ficou pendente há três semanas —
     aquela não foi entregue, e apagá-la da fila esconderia o esquecimento. */
  const inicio = DB.kidInicioDaSemana(k);
  const fim = DB.somarDiasISO(inicio, 7);
  for (const t of DB.all('transactions')) {
    if (t.kid_id !== kidId || t.status !== 'A Pagar') continue;
    if (String(t.date) < inicio || String(t.date) >= fim) continue;
    DB.upsert('transactions', { ...t, status: 'Pago' });
  }
  Sync.autoSync();
  return true;
}

/* CONFIRMAR o que a criança marcou: a tarefa da semana ou o bônus da diária.

   Aceitar credita o dinheiro no pote; recusar apaga a marcação, e apagar é o
   certo — não fica um registro de "não fez" pendurado no histórico dela.

   RECUSAR UM BÔNUS não desfaz os dias marcados. Os dias valem zero e são o
   registro do que ela fez; o bônus é o pagamento da semana cheia. Se o adulto
   discorda de que a semana foi cumprida, é o pagamento que ele nega, não a
   memória dos dias. */
/* CONFIRMAR o que a criança marcou. Três coisas passam por aqui:

     tarefa e bônus — ela ganhou dinheiro, e ele só cai no pote depois que o adulto
                      vê. É o que impede o app de virar auto-serviço.
     gasto e doação — ela gastou, e o dinheiro sai da CONTA DA FAMÍLIA. Aqui a
                      confirmação protege o dinheiro real: um toque de curiosidade
                      não pode debitar a conta de ninguém.

   Recusar apaga a marcação, e apagar é o certo: não fica um registro de "não fez"
   nem uma compra que não houve pendurada no histórico dela. */
function confirmarTarefa(entryId, aceitar) {
  const e = DB.get('kid_entries', entryId);
  if (!e) return false;
  if (aceitar) {
    DB.upsert('kid_entries', { ...e, confirmada: true });
    /* A COMPRA DO SONHO encerra a meta — e só aqui.

       Fechá-la no momento em que a criança pede, e reabrir numa recusa, faria ela
       ver o sonho conquistado e depois desconquistado. Quem encerra é quem de fato
       compra o patinete. Encerrada, não apagada: o histórico dela precisa poder
       contar que este sonho existiu. */
    if (e.kid_goal_id) {
      const meta = DB.get('kid_goals', e.kid_goal_id);
      if (meta && !meta.done) DB.upsert('kid_goals', { ...meta, done: true, done_at: DB.hojeISO() });
    }
    /* O GASTO CONFIRMADO VIRA DESPESA e debita a conta na hora.

       Sem isto o extrato ganhava a linha só na próxima ponte, e o saldo da conta
       nunca caía — a família via a despesa listada e o dinheiro parado no banco. */
    if (e.tipo === 'gasto' || e.tipo === 'doacao') {
      /* O GASTO CONFIRMADO VIRA DESPESA E DEBITA A CONTA na hora.

         Sem isto o extrato ganhava a linha só na próxima ponte, e o saldo da conta
         nunca caía — a família via a despesa listada e o dinheiro parado no banco.

         `espelharGastosDosFilhos` devolve o que CRIOU, e é sobre essa lista que o
         saldo é aplicado: aplicar sobre todas as despesas da criança debitaria de
         novo, a cada confirmação, tudo o que ela já gastou antes. */
      try {
        for (const tx of DB.espelharGastosDosFilhos()) applyTxEffect(tx, 1);
      } catch (_) { }
    }
  } else {
    DB.remove('kid_entries', entryId);
  }
  Sync.autoSync();
  return true;
}


/* ---------- Aparência ----------
   Três estados, e o terceiro é o padrão: SEGUIR O SISTEMA. Um app que ignora a
   preferência do aparelho fica claro às onze da noite porque alguém escolheu
   "claro" uma vez, seis meses atrás.

   A escolha vive no <html> (não no <body>) porque o bloco no topo do index.html
   a aplica antes da primeira pintura — sem isso, a tela pisca no tema errado a
   cada abertura. Aqui só se grava e se marca; toda a cor está no CSS. */
const Tema = {
  KEY: 'financas.tema',
  atual() {
    try { return localStorage.getItem(this.KEY) || 'auto'; } catch (_) { return 'auto'; }
  },
  rotulo() {
    return { dark: 'Sempre escuro', light: 'Sempre claro' }[this.atual()] || 'Acompanha o aparelho';
  },
  aplicar(valor) {
    try {
      if (valor === 'auto') localStorage.removeItem(this.KEY);
      else localStorage.setItem(this.KEY, valor);
    } catch (_) {}
    if (valor === 'auto') delete document.documentElement.dataset.tema;
    else document.documentElement.dataset.tema = valor;
    /* A cor da barra do sistema é uma tag <meta>, e o navegador só a relê quando
       ela muda. Sem isto, o topo do app instalado continuava preto num app que
       acabou de ficar claro. */
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', bg));
  },
};

function openConfig() {
  const s = Sync.cfg || {};
  /* ---------- AS CONFIGURAÇÕES, AGRUPADAS ----------

     Eram doze linhas numa lista plana: "Contas" tinha exatamente o mesmo peso
     visual de "Apagar dados deste aparelho", e achar qualquer coisa exigia ler
     as doze. Agora elas vêm em quatro grupos nomeados, na ordem em que se
     procura — o dinheiro primeiro, o app depois — e a ação destrutiva fica
     sozinha no fim, separada por um respiro maior.

     Os `data-go` continuam idênticos: a navegação não mudou, só a arrumação. */
  const item = (go, ico, titulo, sub, extra = '') => `
    <button class="settings-item ${extra}" data-go="${go}">
      <span class="cfg-left">
        <span class="cfg-ico${extra === 'danger-item' ? ' t-danger' : ''}"${ico.length > 2 ? ` data-ico="${ico}"` : ''}>${ico.length > 2 ? '' : ico}</span>
        <span class="cfg-txt"><b>${titulo}</b><small>${sub}</small></span>
      </span>
      <span class="chev" data-ico="chev"></span>
    </button>`;

  const contasFixas = (() => {
    const rs = DB.all('recurrences');
    const ativas = rs.filter(r => r.status === 'ativa').length;
    return ativas ? `${ativas} ativa(s)${rs.length > ativas ? ` · ${rs.length - ativas} parada(s)` : ''}` : 'nada se repete ainda';
  })();
  const criancas = (() => {
    const ks = DB.kids();
    return ks.length ? ks.map(k => esc(k.name)).join(', ') : 'o cofrinho delas, com semanada e metas';
  })();

  openModal(`
    <div class="modal-title">Configurações<button class="close-x" id="md-close" aria-label="Fechar"><span data-ico="x"></span></button></div>

    <p class="cfg-grupo">Seu dinheiro</p>
    ${item('accounts', 'wallet', 'Contas', `${DB.all('accounts').length} cadastrada(s)`)}
    ${item('cards', 'card', 'Cartões de crédito', `${DB.all('cards').length} cadastrado(s)`)}
    ${item('categories', 'pie', 'Categorias e orçamentos', `${DB.all('categories').length} categoria(s)`)}
    ${item('recorrencias', 'calendar', 'Contas fixas', contasFixas)}

    <p class="cfg-grupo">Família</p>
    ${item('family', 'users', 'Família e ciclo do mês', `${esc(DB.familyLabel())}${Sync.hasFamily() ? ' · código para convidar' : ' · início no dia ' + DB.settings().month_start_day}`)}
    ${item('criancas', 'piggy', 'Crianças', criancas)}
    ${item('sync', 'cloud', 'Sincronização', Sync.hasFamily() ? 'Conectado como ' + esc(s.user_email || '') : 'Não configurada')}

    <p class="cfg-grupo">Dados</p>
    ${item('ofx', 'download', 'Importar extrato OFX', 'traga os lançamentos do banco ou do cartão de uma vez')}
    ${item('backup', 'upload', 'Backup', 'exportar ou importar um arquivo JSON')}

    <p class="cfg-grupo">O app</p>
    ${item('ia', 'sparkles', 'Assistente', (function(){ const cf = IA.load(); if (!IA.chaveAtual()) return 'sem chave — não configurado'; const q = IA.prov().nome; if (!cf.ligado) return q + ', mas desligado'; return IA.algoAutorizado() ? q : q + ', mas sem nada autorizado'; })())}
    ${item('tema', Tema.atual() === 'light' ? 'sun' : 'moon', 'Aparência', Tema.rotulo())}
    ${item('notif', 'bell', 'Notificações', Notif.enabled() ? 'ativas — faturas, orçamentos e metas' : 'desativadas')}
    ${item('security', 'shield', 'Segurança', Auth.enabled() ? 'PIN ativo · bloqueia após ' + (Auth.cfg.lockAfterMin ?? 5) + ' min' : 'sem proteção local')}

    <div class="cfg-perigo">
      ${item('reset', 'trash', 'Apagar dados deste aparelho', 'limpar pelas configurações do celular não funciona', 'danger-item')}
    </div>
  `);
  $('#md-close').onclick = closeModal;
  document.querySelectorAll('#modal [data-go]').forEach(el => el.onclick = () => openConfigSection(el.dataset.go));
}

window.openConfigSection = openConfigSection;

function crudList(store, title, renderRow, openEditor) {
  const rows = DB.all(store).map(r => `
    <div class="settings-item" data-edit="${r.id}"><span>${renderRow(r)}</span><span class="chev" data-ico="chev"></span></div>`).join('');
  openModal(`
    <div class="modal-title">${title}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <button class="btn ghost" id="md-new" style="margin-bottom:var(--e3)">＋ Adicionar</button>
    ${rows || '<div class="empty">Nada cadastrado ainda.</div>'}
  `);
  $('#md-back').onclick = openConfig;
  $('#md-new').onclick = () => openEditor(null);
  document.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => openEditor(DB.get(store, el.dataset.edit)));
}

/* As contas fixas: onde se pausa, cancela e reajusta.

   Sem esta tela, "até eu cancelar" seria uma armadilha — a recorrência nasceria
   sem botão de cancelar. Editar o valor aqui vale da PRÓXIMA em diante: o que já
   foi lançado é histórico, e reajuste de aluguel não reescreve o passado. */
/* Editar um contrato inteiro.

   A tela "Contas fixas" só oferecia mudar o VALOR e o status. Faltava o resto —
   descrição, periodicidade, dia, prazo, categoria, conta, método —, e sem isso a
   única saída para um aluguel que passou do dia 10 para o 15 era cancelar e criar
   de novo: perde o histórico de ocorrências, o vínculo dos lançamentos já gerados
   e a contagem de quantas faltam.

   MUDA DAQUI PARA A FRENTE. O que já foi lançado fica como está, e é de propósito:
   lançamento pago é histórico, e reescrever o passado mexeria em saldos já
   conciliados. O aviso na folha diz isso, porque a expectativa natural de quem
   corrige o dia é que "agora está certo" — e está, para as próximas.

   O TIPO (despesa ou receita) fica FORA. Invertê-lo depois de gerar ocorrências
   trocaria o sinal do que já entrou no saldo, e o app teria um contrato de receita
   com lançamentos de despesa vinculados. Quem errou o tipo cria outro contrato: é
   raro, e o estrago do contrário é grande. */
function openEditarContrato(recId) {
  const r = DB.get('recurrences', recId);
  if (!r) return toast('Conta fixa não encontrada');
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const metodos = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
  const cartoes = DB.all('cards').filter(c => c.active !== false);
  const sel = (v, alvo) => (String(v) === String(alvo) ? ' selected' : '');
  const restam = DB.restamDaRecorrencia(r);

  openSheet(`
    <div class="sheet-title">Editar — ${esc(r.description)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <p class="muted" style="margin:calc(var(--e1) * -1) 0 var(--e3)">Vale das próximas ocorrências em diante. O que já foi lançado
      continua como está.${r.geradas ? ` Já nasceram ${r.geradas}${restam !== null ? ` e faltam ${restam}` : ''}.` : ''}</p>

    <div class="field"><label>Descrição</label>
      <input type="text" id="ec-desc" value="${esc(r.description)}" autocomplete="off"></div>

    <div class="field"><label>Valor</label>
      <input class="amount-input" id="ec-amount" type="text" inputmode="numeric" autocomplete="off"></div>
    <div class="field"><label>O valor muda todo mês?</label>
      <select id="ec-vtipo">
        <option value="fixo"${sel(r.valor_tipo !== 'media', true)}>Não, é sempre o mesmo</option>
        <option value="media"${sel(r.valor_tipo, 'media')}>Sim — usar a mediana do que já foi pago</option>
      </select></div>

    <div class="field"><label>Com que frequência?</label>
      <select id="ec-per">
        <option value="mensal"${sel(r.periodicidade, 'mensal')}>Todo mês</option>
        <option value="semanal"${sel(r.periodicidade, 'semanal')}>Toda semana</option>
        <option value="quinzenal"${sel(r.periodicidade, 'quinzenal')}>A cada 15 dias</option>
        <option value="anual"${sel(r.periodicidade, 'anual')}>Todo ano</option>
      </select></div>
    <div class="field"><label>Em que dia?</label>
      <input type="number" id="ec-dia" min="1" max="31" value="${esc(String(r.dia || 1))}"></div>

    <div class="field"><label>Até quando?</label>
      <select id="ec-fim">
        <option value="sem_prazo"${sel(r.fim_tipo, 'sem_prazo')}>Até eu cancelar</option>
        <option value="vezes"${sel(r.fim_tipo, 'vezes')}>Por um número de vezes</option>
        <option value="data"${sel(r.fim_tipo, 'data')}>Até uma data</option>
      </select></div>
    <div class="field" id="ec-campo-vezes"${r.fim_tipo === 'vezes' ? '' : ' hidden'}>
      <label>Quantas ocorrências no total?</label>
      <input type="number" id="ec-vezes" min="1" value="${esc(String(Number(r.fim_vezes) || 12))}">
      <p class="muted" style="margin-top:var(--e1)">${r.geradas
        ? `Contando as ${r.geradas} que já nasceram — faltariam ${Math.max(0, (Number(r.fim_vezes) || 0) - r.geradas)}.`
        : 'Nenhuma nasceu ainda.'}</p></div>
    <div class="field" id="ec-campo-data"${r.fim_tipo === 'data' ? '' : ' hidden'}>
      <label>Até que data?</label>
      <input type="date" id="ec-data" value="${esc(r.fim_data || '')}"></div>

    <div class="field"><label>Categoria</label>
      <select id="ec-cat"><option value="">— sem categoria —</option>${optionsCategorias(r.category_id || '', r.type || 'Despesa')}</select></div>
    <div class="field"><label>Forma de pagamento</label>
      <select id="ec-metodo">${metodos.map(m => `<option value="${esc(m)}"${sel(r.method, m)}>${esc(m)}</option>`).join('')}</select></div>
    <div class="field" id="ec-campo-conta"><label>Conta</label>
      <select id="ec-conta"><option value="">— não definida —</option>${
        contas.map(a => `<option value="${a.id}"${sel(r.account_id, a.id)}>${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field" id="ec-campo-cartao"${r.method === 'Cartão de Crédito' ? '' : ' hidden'}><label>Cartão</label>
      <select id="ec-cartao"><option value="">— não definido —</option>${
        cartoes.map(c => `<option value="${c.id}"${sel(r.card_id, c.id)}>${esc(c.name)}</option>`).join('')}</select></div>

    <button class="btn" id="sh-save">Salvar</button>
  `);
  initMoney('#ec-amount', r.amount);
  $('#sh-close').onclick = closeSheet;

  // Prazo e cartão só aparecem quando fazem sentido
  const fim = $('#ec-fim');
  fim.onchange = () => {
    $('#ec-campo-vezes').hidden = fim.value !== 'vezes';
    $('#ec-campo-data').hidden = fim.value !== 'data';
  };
  const met = $('#ec-metodo');
  met.onchange = () => {
    const noCartao = met.value === 'Cartão de Crédito';
    $('#ec-campo-cartao').hidden = !noCartao;
    $('#ec-campo-conta').hidden = noCartao;
  };

  $('#sh-save').onclick = () => {
    const desc = ($('#ec-desc').value || '').trim();
    if (!desc) return toast('Informe a descrição');
    const valor = moneyVal('#ec-amount');
    if (!valor) return toast('Informe o valor');
    const noCartao = met.value === 'Cartão de Crédito';
    /* `fim_vezes` é o TOTAL de ocorrências do contrato, não o que falta:
       `restamDaRecorrencia` calcula `fim_vezes − geradas`. A primeira versão daqui
       descontava `geradas` antes de gravar, e o desconto acontecia duas vezes — um
       contrato de 12x com 3 nascidas passava a dizer que faltavam 6, e ninguém
       veria até ele terminar antes da hora. O teste pegou. */
    const total = Math.max(1, Number($('#ec-vezes').value) || 12);
    DB.upsert('recurrences', {
      ...r,
      description: desc,
      amount: valor,
      valor_tipo: $('#ec-vtipo').value,
      periodicidade: $('#ec-per').value,
      dia: Math.min(31, Math.max(1, Number($('#ec-dia').value) || 1)),
      fim_tipo: fim.value,
      fim_vezes: fim.value === 'vezes' ? total : null,
      fim_data: fim.value === 'data' ? ($('#ec-data').value || null) : null,
      category_id: $('#ec-cat').value || null,
      method: met.value,
      account_id: noCartao ? null : ($('#ec-conta').value || null),
      card_id: noCartao ? ($('#ec-cartao').value || null) : null,
    });
    closeSheet(); Sync.autoSync(); openRecorrencias();
    toast('Conta fixa atualizada — vale das próximas ✓');
  };
}

function openRecorrencias() {
  const rs = DB.all('recurrences').sort((a, b) =>
    (a.status === b.status ? 0 : a.status === 'ativa' ? -1 : 1) || Number(a.dia) - Number(b.dia));
  const rotuloPeriodo = { mensal: 'todo mês', semanal: 'toda semana', quinzenal: 'a cada 15 dias', anual: 'todo ano' };
  const linha = r => {
    const restam = DB.restamDaRecorrencia(r);
    const quando = `${rotuloPeriodo[r.periodicidade] || 'todo mês'}${r.periodicidade === 'semanal' ? '' : `, dia ${r.dia}`}`;
    const prazo = r.fim_tipo === 'vezes' ? (restam > 0 ? `faltam ${restam}` : 'terminou')
      : r.fim_tipo === 'data' && r.fim_data ? `até ${fmtDate(new Date(r.fim_data + 'T12:00:00'))}`
      : 'sem prazo';
    return `<div class="rec-item ${r.status !== 'ativa' ? 'off' : ''}">
      <div class="rec-topo">
        <b>${esc(r.description)}</b>
        <span class="num">${r.valor_tipo === 'media' ? '~ ' : ''}${fmt(DB.valorDaRecorrencia(r))}</span>
      </div>
      <small class="muted">${r.type === 'Receita' ? '💰 entrada · ' : ''}${quando} · ${prazo}${
        r.status === 'pausada' ? ' · <b>pausada</b>' : r.status === 'cancelada' ? ' · <b>cancelada</b>' : ''}</small>
      <div class="rec-acoes">
        ${/* "Editar" no lugar de "Valor": o botão antigo mexia só no valor e no tipo
              dele, e não havia caminho nenhum para dia, periodicidade, prazo,
              categoria, conta ou método. Um aluguel que passou do dia 10 para o 15
              só podia ser cancelado e recriado — perdendo histórico, vínculo e a
              contagem de quantas faltam. O valor continua ali dentro. */''}
        <button class="sec-btn" data-rec-edit="${r.id}">Editar</button>
        ${r.status === 'ativa'
          ? `<button class="sec-btn" data-rec-pausa="${r.id}">Pausar</button>
             <button class="sec-btn t-danger" data-rec-cancela="${r.id}">Cancelar</button>`
          : `<button class="sec-btn" data-rec-ativa="${r.id}">Reativar</button>
             <button class="sec-btn t-danger" data-rec-apaga="${r.id}">Apagar</button>`}
      </div>
    </div>`;
  };

  openModal(`
    <div class="modal-title">Contas fixas<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">O que se repete todo mês. Elas são lançadas sozinhas como “A Pagar” na data certa — você só confirma quando pagar.</p>
    ${rs.length ? rs.map(linha).join('') : '<div class="empty"><b>Nada se repete ainda</b>Ao lançar um gasto, marque “se repete” para ele virar conta fixa.</div>'}
  `);
  $('#md-back').onclick = () => openConfig();

  const mexer = (id, mudanca) => {
    const r = DB.get('recurrences', id);
    if (!r) return;
    DB.upsert('recurrences', { ...r, ...mudanca });
    Sync.autoSync(); openRecorrencias();
  };
  document.querySelectorAll('[data-rec-pausa]').forEach(b => b.onclick = () => mexer(b.dataset.recPausa, { status: 'pausada' }));
  document.querySelectorAll('[data-rec-ativa]').forEach(b => b.onclick = () => {
    mexer(b.dataset.recAtiva, { status: 'ativa' });
    DB.gerarRecorrencias();          // retoma de onde parou
  });
  /* Cancelar apaga o que ficou PENDENTE e preserva o que foi pago.

     A distinção importa: lançamento já pago é histórico, e apagá-lo reescreveria
     o passado mexendo em saldos já conciliados. Mas "A Pagar" de assinatura
     cancelada é lixo — infla o comprometido e fica na fila pedindo uma decisão
     que nunca vai vir. Era o defeito relatado. */
  const encerrar = (id, apagar) => {
    const pend = DB.all('transactions').filter(t => t.recurrence_id === id && t.status === 'A Pagar').length;
    const pagos = DB.all('transactions').filter(t => t.recurrence_id === id && t.status === 'Pago').length;
    const texto = [
      apagar ? 'Apagar esta conta fixa?' : 'Cancelar esta conta fixa?',
      '',
      'As próximas deixam de ser lançadas.',
      pend ? `${pend} lançamento(s) ainda não pago(s) saem do extrato e do comprometido.` : '',
      pagos ? `${pagos} já pago(s) continuam no extrato, como histórico.` : '',
    ].filter(Boolean).join('\n');
    if (!confirm(texto)) return;
    const limpos = DB.encerrarRecorrencia(id, apagar);
    Sync.autoSync(); openRecorrencias();
    toast(limpos ? `Encerrada — ${limpos} pendência(s) removida(s) ✓` : 'Encerrada ✓');
  };
  document.querySelectorAll('[data-rec-cancela]').forEach(b => b.onclick = () => encerrar(b.dataset.recCancela, false));
  document.querySelectorAll('[data-rec-apaga]').forEach(b => b.onclick = () => encerrar(b.dataset.recApaga, true));
  /* Reajuste: vale da PRÓXIMA em diante. O que já foi lançado é histórico — o
     aluguel de janeiro não passa a custar o preço de fevereiro. */
  document.querySelectorAll('[data-rec-edit]').forEach(b => b.onclick = () => openEditarContrato(b.dataset.recEdit));
}

function openConfigSection(sec) {
  if (sec === 'recorrencias') return openRecorrencias();
  if (sec === 'criancas') return openCriancas();
  if (sec === 'tema') {
    const opcoes = [
      ['auto', 'Acompanhar o aparelho', 'muda sozinho quando o celular muda — é o padrão'],
      ['dark', 'Sempre escuro', 'para consultar à noite sem levar um facho na cara'],
      ['light', 'Sempre claro', 'para usar de dia, no computador'],
    ];
    const desenhar = () => {
      const agora = Tema.atual();
      openModal(`
        <div class="modal-title">Aparência<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
        <div class="ob-opts">
          ${opcoes.map(([v, t, d]) => `
            <button class="ob-opt" data-tema-op="${v}" style="${v === agora ? 'border-color:var(--gold)' : ''}">
              <b>${t} ${v === agora ? '✓' : ''}</b><small>${d}</small>
            </button>`).join('')}
        </div>
      `);
      $('#md-back').onclick = openConfig;
      /* `data-tema-op`, e não `data-tema`: o próprio <html> carrega `data-tema`
         quando há um tema escolhido, então um seletor por `[data-tema]` pegava o
         documento inteiro e pendurava o handler nele. Qualquer clique na página
         — o botão de voltar inclusive — subia até o <html> e redesenhava esta
         tela, o que fazia o voltar parecer sem função. */
      document.querySelectorAll('#modal [data-tema-op]').forEach(b => b.onclick = () => {
        Tema.aplicar(b.dataset.temaOp);
        desenhar();                       // redesenha para o ✓ acompanhar a escolha
        toast('Aparência atualizada ✓');
      });
    };
    return desenhar();
  }
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
        <p class="muted" style="margin-top:var(--e2)">Aparece no topo do app e no menu lateral.</p></div>
      <div class="field"><label>Membros (um por linha)</label><textarea id="f-members" rows="4" placeholder="Ex:&#10;Ana&#10;Carlos">${esc((s.members || []).join('\n'))}</textarea>
        <p class="muted" style="margin-top:var(--e2)">Quem pode aparecer como responsável por um gasto pessoal.</p></div>
      <div class="field"><label>Dia de início do mês financeiro</label><input id="f-start" type="number" min="1" max="28" value="${s.month_start_day}">
        <p class="muted" style="margin-top:var(--e2)">1 = mês calendário. Ex: 5 = período do dia 5 ao dia 4 do mês seguinte (útil para quem se organiza pelo salário).</p></div>
      <div class="field"><label>Renda mensal da família (líquida)</label><input id="f-income" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00">
        <p class="muted" style="margin-top:var(--e2)">Base para a projeção vs. renda, taxa de poupança e regra 50/30/20 no painel.</p></div>
      <button class="btn" id="md-save">Salvar</button>
    `);
    initMoney('#f-income', s.monthly_income);
    ligarConvite();
    $('#md-back').onclick = openConfig;
    $('#md-save').onclick = () => {
      const members = $('#f-members').value.split('\n').map(x => x.trim()).filter(Boolean);
      const rendaNova = moneyVal('#f-income');
      const rendaAntes = Number(s.monthly_income) || 0;
      DB.upsert('family_settings', {
        ...s,
        family_name: ($('#f-famname').value || '').trim(),
        members,
        month_start_day: Math.min(28, Math.max(1, parseInt($('#f-start').value) || 1)),
        monthly_income: rendaNova,
      });
      /* Informar a renda OFERECE calibrar os orçamentos na proporção dela.

         Os tetos do catálogo foram calculados para uma renda de referência
         (R$ 17.000). Sem escalar, quem ganha 5 mil abre o app com 15.510 orçados
         e conclui, com razão, que o plano não é sobre a vida dele — e quem ganha
         30 mil recebe um teto que não cabe no padrão de vida.

         PERGUNTA em vez de aplicar: orçamento é decisão de quem vive com ele, e
         reescrever quatorze tetos sem avisar é o tipo de ajuda que quebra a
         confiança. Envelope já ajustado à mão fica intacto — `calibrarOrcamentos`
         só toca no que ainda está com o valor de catálogo. */
      if (rendaNova > 0 && rendaNova !== rendaAntes
        && confirm(`Ajustar os orçamentos das categorias para uma renda de ${fmt(rendaNova)}?\n\n`
          + 'Os valores sugeridos são recalculados na proporção. Envelopes que você já mudou à mão ficam como estão.')) {
        const n = DB.calibrarOrcamentos(rendaNova, rendaAntes);
        Sync.autoSync(); toast(n ? `Salvo — ${n} orçamento(s) recalculado(s) ✓` : 'Salvo'); openConfig();
        return;
      }
      Sync.autoSync(); toast('Salvo'); openConfig();
    };
  }

  if (sec === 'sync') openSyncConfig();

  if (sec === 'ofx') openOfxImport();

  if (sec === 'ia') {
    /* ---------- CONFIGURAÇÕES DO ASSISTENTE ----------

       A tela é uma escada de consentimento, e a ordem importa: primeiro ligar,
       depois escolher o que ele vê. Ligado sem nenhuma permissão, o assistente
       existe mas não consegue responder nada — e a tela diz isso, em vez de
       deixar a pessoa descobrir na primeira pergunta.

       TUDO COMEÇA DESLIGADO. Sem ligar, o app é exatamente o de antes: o botão
       de conversa não aparece em lugar nenhum. */
    const desenhar = () => {
      const c = IA.load();
      const kb = Math.round(IA.tamanhoDoHistorico() / 1024);
      const nConversas = IA.conversas().length;
      const p = IA.prov();
      const chave = IA.chaveAtual();
      const temChave = !!chave;
      const naNuvem = typeof Sync !== 'undefined' && Sync.loggedIn();

      const permissao = (k, titulo, sub) => `
        <label class="ia-perm">
          <input type="checkbox" data-perm="${k}" ${c.ver[k] ? 'checked' : ''}>
          <span><b>${titulo}</b><small>${sub}</small></span>
        </label>`;

      /* Um cartão por provedor. O que está configurado se anuncia, para quem tem
         os dois saber qual está valendo sem precisar abrir cada um. */
      const provedor = (id, prov) => {
        const marcado = c.provedor === id;
        const temAChave = !!(c.chaves || {})[id];
        return `
          <label class="ia-perm">
            <input type="radio" name="ia-prov" data-prov="${id}" ${marcado ? 'checked' : ''}>
            <span><b>${prov.nome}</b><small>${prov.empresa} · ${temAChave ? 'chave já configurada' : 'sem chave ainda'}</small></span>
          </label>`;
      };

      /* O preço fica no rótulo porque quem paga é quem escolhe — e para escolher
         precisa do número, não de adjetivos. */
      const modelo = m => `
        <label class="ia-perm">
          <input type="radio" name="ia-modelo" data-modelo="${m.id}" ${IA.modeloAtual() === m.id ? 'checked' : ''}>
          <span><b>${m.nome}</b><small>${m.sub} · US$ ${m.entrada}/${m.saida} por milhão de tokens</small></span>
        </label>`;

      openModal(`
        <div class="modal-title">Assistente<button class="close-x" id="md-back" aria-label="Voltar"><span data-ico="back"></span></button></div>

        <p class="muted" style="margin-bottom:var(--e4)">Um assistente que responde sobre as suas contas — quanto sobra, para onde foi o dinheiro, como o mês fecha, e o que muda se você cortar um gasto. Ele consulta os números pelo próprio app: <b>nada é calculado por fora</b>.</p>

        <p class="section-title" style="margin:0 0 var(--e2)">Qual assistente usar</p>
        <p class="muted" style="margin-bottom:var(--e3)">Os dois funcionam igual dentro do app. A diferença é de quem é a conta que paga e quanto custa.</p>
        ${Object.entries(IA.PROVEDORES).map(([id, pr]) => provedor(id, pr)).join('')}

        <p class="section-title" style="margin:var(--e5) 0 var(--e2)">Sua chave da ${p.empresa}</p>
        <p class="muted" style="margin-bottom:var(--e3)">O assistente usa <b>a sua conta</b>, e o consumo é cobrado nela — ninguém paga por você, e você não paga por ninguém. Crie uma chave em <b>${p.console}</b> → ${p.caminhoDaChave} e cole abaixo.</p>

        <div class="field">
          <label>Chave</label>
          <input id="ia-chave" type="password" autocomplete="off" spellcheck="false"
                 placeholder="${p.exemplo}" value="${esc(chave)}">
        </div>
        <div style="display:flex;gap:var(--e2)">
          <button class="btn ghost" id="ia-ver" style="flex:0 0 auto;width:auto">Mostrar</button>
          <button class="btn" id="ia-testar" style="flex:1;width:auto" ${temChave ? '' : 'disabled'}>Testar e salvar</button>
        </div>
        <p class="muted" id="ia-estado" style="margin-top:var(--e2)">${temChave
          ? 'Chave guardada neste aparelho, cifrada com o seu PIN.'
          : 'Sem chave, o assistente não aparece em lugar nenhum do app.'}</p>

        <div class="callout info" style="margin-top:var(--e4)">
          <b>${naNuvem ? 'Cópia na nuvem ligada' : 'Guardado só neste aparelho'}</b>
          <p>${naNuvem
            ? 'A chave e as conversas sobem para o seu Supabase <b>cifradas com a senha do seu login</b> — nem o dono do projeto consegue lê-las. Se você apagar os dados deste aparelho, elas voltam quando você entrar de novo. Trocar a senha do login torna essa cópia ilegível: aí é colar a chave outra vez.'
            : 'A chave e as conversas ficam aqui, cifradas com o seu PIN — e some tudo se você apagar os dados deste aparelho. Para que voltem sozinhas depois, ligue a sincronização em <b>Configurações → Sincronização</b>'}</p>
        </div>

        <div id="ia-detalhe" ${temChave ? '' : 'hidden'}>
          <p class="section-title" style="margin:var(--e5) 0 var(--e2)">Modelo da ${p.empresa}</p>
          ${p.modelos.map(modelo).join('')}

          <label class="ia-liga" style="margin-top:var(--e4)">
            <input type="checkbox" id="ia-ligado" ${c.ligado ? 'checked' : ''}>
            <span><b>Usar o assistente</b><small>${c.ligado ? 'o botão de conversa aparece no topo' : 'desligado, o app fica exatamente como está'}</small></span>
          </label>

          <div id="ia-permissoes" ${c.ligado ? '' : 'hidden'}>
            <p class="section-title" style="margin:var(--e5) 0 var(--e2)">O que ele pode consultar</p>
            <p class="muted" style="margin-bottom:var(--e3)">Ele só enxerga o que estiver marcado aqui, e recebe o número já somado — não o seu banco. Desmarcado, ele nem sabe que o dado existe.</p>

            ${permissao('situacao', 'Saldos e disponível', 'quanto existe, quanto está comprometido, quanto sobra')}
            ${permissao('categorias', 'Gastos por categoria', 'quanto foi para cada envelope, sem citar lançamento')}
            ${permissao('previsao', 'Projeções e contas fixas', 'como o mês fecha, os próximos meses, simulações')}
            ${permissao('cartoes', 'Cartões e faturas', 'fatura aberta, limite usado, vencimento')}
            ${permissao('metas', 'Metas e reserva', 'quanto guardado, ritmo, meses de cobertura')}
            ${permissao('lancamentos', 'Lançamentos', 'a lista com descrição — o dado mais detalhado que existe')}
            ${permissao('criancas', 'Cofrinho das crianças', 'saldo dos potes e semanada de cada uma')}

            <p class="section-title" style="margin:var(--e5) 0 var(--e2)">Conversas guardadas</p>
            <p class="muted" style="margin-bottom:var(--e3)">${nConversas
              ? `${nConversas} conversa(s), ocupando ${kb} KB. Ficam as ${IA.MAX_CONVERSAS} mais recentes; as antigas saem sozinhas.`
              : 'Nenhuma conversa ainda.'}</p>
            ${nConversas ? '<button class="btn danger" id="ia-limpar">Apagar todas as conversas</button>' : ''}
          </div>
        </div>
      `);
      $('#md-back').onclick = openConfig;

      const campo = $('#ia-chave');
      const estado = $('#ia-estado');
      const btTestar = $('#ia-testar');

      /* Trocar de provedor redesenha a tela inteira: muda a chave mostrada, a
         lista de modelos, o console onde criá-la. Nada é perdido — a chave do
         outro continua guardada no lugar dela. */
      document.querySelectorAll('#modal [data-prov]').forEach(el => {
        el.onchange = () => { IA.cfg.provedor = el.dataset.prov; IA.save(); pintarBotaoIA(); desenhar(); };
      });

      $('#ia-ver').onclick = () => {
        const escondida = campo.type === 'password';
        campo.type = escondida ? 'text' : 'password';
        $('#ia-ver').textContent = escondida ? 'Ocultar' : 'Mostrar';
      };
      campo.oninput = () => { btTestar.disabled = !campo.value.trim(); };

      /* Salvar só depois de testar é de propósito. Uma chave errada guardada faz
         o botão de conversa aparecer e falhar na primeira pergunta — o pior
         momento possível para descobrir que faltou um caractere no meio. E o
         teste vai além da chave: confere que o modelo escolhido sabe chamar
         ferramenta, sem o que o assistente responderia sem olhar os seus dados. */
      btTestar.onclick = async () => {
        const nova = campo.value.trim();
        if (!nova) return;
        btTestar.disabled = true;
        estado.textContent = 'Conferindo a chave e o modelo…';
        const prov = IA.cfg.provedor;
        const anterior = IA.cfg.chaves[prov];
        IA.cfg.chaves[prov] = nova;
        try {
          await IA.testar();
          IA.save();
          estado.textContent = 'Chave conferida e guardada ✓';
          toast('Chave conferida ✓');
          pintarBotaoIA();
          desenhar();
        } catch (e) {
          IA.cfg.chaves[prov] = anterior;
          estado.textContent = e.message;
          btTestar.disabled = false;
        }
      };

      document.querySelectorAll('#modal [data-modelo]').forEach(el => {
        el.onchange = () => { IA.cfg.modelos[IA.cfg.provedor] = el.dataset.modelo; IA.save(); };
      });

      const liga = $('#ia-ligado');
      if (liga) liga.onchange = () => {
        IA.cfg.ligado = liga.checked;
        IA.save();
        pintarBotaoIA();
        desenhar();
      };

      document.querySelectorAll('#modal [data-perm]').forEach(el => {
        el.onchange = () => {
          IA.cfg.ver[el.dataset.perm] = el.checked;
          IA.save();
        };
      });

      const limpar = $('#ia-limpar');
      if (limpar) limpar.onclick = async () => {
        if (!confirm('Apagar todas as conversas com o assistente? Isso não afeta seus lançamentos.')) return;
        const ids = IA.conversas().map(x => x.id);
        DB.data.ia_chats = [];
        DB.save();
        // Apagar aqui e deixar lá faria a próxima sincronização trazer tudo de volta.
        for (const id of ids) await IA.nuvemApagarChat(id).catch(() => {});
        toast('Conversas apagadas ✓');
        desenhar();
      };
    };
    return desenhar();
  }

  if (sec === 'notif') {
    openModal(`
      <div class="modal-title">🔔 Notificações<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <p class="muted" style="margin-bottom:var(--e3)">Avisos de ações importantes: fatura fechando/vencendo/vencida, orçamento estourado e meta atingida. Cada aviso sai no máximo 1x por dia.</p>

      <p class="section-title" style="margin-bottom:var(--e2)">1. Avisos ao abrir o app</p>
      ${Notif.enabled()
        ? '<button class="btn danger" id="nt-off">Desativar</button>'
        : '<button class="btn" id="nt-on">Ativar</button>'}
      <div class="btn-row"><button class="btn ghost" id="nt-test">Testar agora</button></div>

      <hr class="sep">
      <p class="section-title" style="margin-bottom:var(--e2)">2. Push automático (app fechado)</p>
      <p class="muted" style="margin-bottom:var(--e3)">O servidor verifica suas faturas e orçamentos todo dia e avisa mesmo com o app fechado. Exige sincronização configurada e o passo a passo do README (Edge Function + cron no Supabase).</p>
      <p class="muted" style="margin-bottom:var(--e3)">Estado deste aparelho: <b id="nt-push-state">verificando…</b></p>
      <button class="btn" id="nt-push-on">Ativar push neste aparelho</button>
      <div class="btn-row"><button class="btn ghost" id="nt-push-off">Desativar push aqui</button></div>
      <p class="muted" style="margin-top:var(--e3)">📱 No iPhone, o push só funciona depois de adicionar o app à tela de início (iOS 16.4+).</p>
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
      <p class="muted" style="margin-bottom:var(--e3)">O PIN não é só uma tela de bloqueio: ele deriva uma chave <b>AES-256</b> (PBKDF2) que <b>criptografa os dados guardados neste aparelho</b> — sem o PIN, o conteúdo é ilegível. Após 5 erros, o app bloqueia por tempo progressivo. A nuvem tem camada própria: login e-mail/senha + regras por família (RLS) no Supabase.</p>
      ${Auth.enabled() ? `
        <div class="settings-item" id="sec-trocar"><span class="cfg-left"><span class="cfg-ico" data-ico="lock"></span><span>Trocar o PIN<br><small>abre o teclado para escolher um novo</small></span></span><span class="chev" data-ico="chev"></span></div>
        <div class="field" style="margin-top:var(--e3)"><label>Bloquear após (minutos em segundo plano)</label><input id="sec-min" type="number" min="0" max="120" value="${Auth.cfg.lockAfterMin ?? 5}"></div>
        <button class="btn" id="sec-save">Salvar tempo de bloqueio</button>
        <hr class="sep">
        <p class="section-title" style="margin-bottom:var(--e2)">👆 Desbloqueio por digital</p>
        ${Auth.bioAtiva()
          ? '<p class="muted" style="margin-bottom:var(--e3)">Ativo neste aparelho — o app pede a digital ao abrir e o PIN continua valendo como alternativa.</p><button class="btn ghost" id="sec-bio-off">Desativar digital</button>'
          : Auth.cfg.bioIndisponivel
            ? '<p class="bio-indisponivel">Este navegador ainda não permite usar a digital para proteger dados (falta suporte a PRF). Continue com o PIN.</p>'
            : '<p class="muted" style="margin-bottom:var(--e3)">Use a digital (ou o rosto) em vez de digitar o PIN toda vez. A criptografia continua a mesma: o leitor do aparelho guarda o segredo que abre a chave.</p><button class="btn ghost" id="sec-bio-on">Ativar digital neste aparelho</button>'}
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
      <p class="muted" style="margin-bottom:var(--e3)">Com a sincronização ativa, a nuvem já é seu backup. Ainda assim, você pode guardar um arquivo local.</p>
      <button class="btn ghost" id="bk-export" style="margin-bottom:var(--e3)">⬇ Exportar dados (.json)</button>
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
      <p class="muted" style="margin:var(--e3) 0">Serão apagados deste aparelho: lançamentos, contas, cartões, categorias, metas, PIN, digital, login e o cache do app.</p>
      ${naNuvem ? `<div class="callout info"><b>Atenção: a nuvem não é afetada</b>
        <p>Os dados da família continuam no servidor. Se você entrar de novo com a mesma conta, eles voltam para cá — que é o esperado ao trocar de aparelho.
        Para começar do zero de verdade, apague também pelo painel do Supabase.</p></div>` : ''}
      <div class="field" style="margin-top:var(--e4)"><label>Digite <b>APAGAR</b> para confirmar</label><input id="rs-conf" placeholder="APAGAR" autocomplete="off"></div>
      <button class="btn ghost" id="rs-export" style="margin-bottom:var(--e3)">⬇ Antes disso, exportar um backup</button>
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
          <!-- O ajuste por mês mora aqui, e não na barra do Painel: ao lado da
               barra vermelha, o botão convida a subir o limite até o gráfico
               ficar verde. Aqui é preciso vir, abrir o envelope e escolher o mês
               — três passos que fazem do ajuste uma decisão, não um reflexo. -->
          ${st.lado === 'Receita' ? '' : `<button class="btn ghost btn-sub" data-orc="${r.id}">Ajustar o orçamento de um mês</button>`}
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
    <p class="muted" style="margin:var(--e3) 0 var(--e3)">${st.lado === 'Despesa'
      ? 'O orçamento fica no envelope. As subcategorias detalham e somam nele.'
      : 'Origem do dinheiro que entra. Não tem orçamento.'}</p>

    <div class="busca-row" style="margin-bottom:var(--e3)">
      <input id="cat-busca" type="search" placeholder="Buscar categoria…" autocomplete="off" value="${esc(st.busca)}">
      <button class="btn-filtros" id="cat-novo">＋ ${st.lado === 'Despesa' ? 'Envelope' : 'Origem'}</button>
    </div>

    ${semSub ? `<div class="callout info">
      <b>Detalhar os gastos com subcategorias</b>
      <p>Seus envelopes ainda não têm subcategorias. Dá para preencher as sugeridas de uma vez e ajustar depois. Nada do que você já lançou muda de lugar.</p>
      <button class="btn" id="md-sugerir" style="margin-top:var(--e3)">Adicionar sugeridas</button>
    </div>` : ''}
    ${semEntradas ? `<div class="callout info">
      <b>Classifique também o que entra</b>
      <p>Sem isto não dá para separar salário de empréstimo recebido — que entra na conta mas não é ganho.</p>
      <button class="btn" id="md-entradas" style="margin-top:var(--e3)">Criar categorias sugeridas</button>
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
  // Ajuste do orçamento de um mês: vive só aqui, dentro do envelope aberto
  document.querySelectorAll('[data-orc]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    openOrcamentoSheet(el.dataset.orc);
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
    ${ehEntrada ? '<p class="muted" style="margin-bottom:var(--e3)">Categoria de <b>entrada</b>: diz de onde o dinheiro veio. Não tem orçamento nem entra na regra 50/30/20.</p>' : ''}
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
      <p class="muted" style="margin-top:var(--e2)">Escolher um envelope transforma isto numa subcategoria: o gasto soma no limite dele.</p>
    </div>` : `<p class="muted" style="margin-bottom:var(--e3)">Este envelope tem subcategorias, então ele não pode virar subcategoria de outro.</p>`}
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
    <p class="muted" id="aviso-sub" ${cat.parent_id ? '' : 'hidden'} style="margin-bottom:var(--e3)">Âmbito, orçamento e tipo vêm do envelope — não se repetem aqui.</p>
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
    const novoBudget = semEnvelope ? 0 : moneyVal('#c-budget');
    const mudouBudget = isEdit && Number(cat.monthly_budget || 0) !== novoBudget;
    DB.upsert('categories', {
      ...cat, name: nome, icon: $('#c-icon').value || '🏷️', parent_id: pai, type: tipo,
      // Subcategoria segue o envelope: guardar cópia divergente aqui só criaria
      // dois lugares dizendo coisas diferentes sobre o mesmo gasto.
      scope: semEnvelope ? (envelope ? envelope.scope : 'Família') : $('#c-scope').value,
      kind: semEnvelope ? (envelope ? envelope.kind : 'Essencial') : $('#c-kind').value,
      monthly_budget: novoBudget,
    });
    /* Mudar o padrão aqui vale DAQUI PARA A FRENTE. Sem isto, subir o orçamento
       de 500 para 800 reescrevia o passado — o relatório de um mês fechado
       passava a comparar o gasto contra um teto que não valia lá. O valor antigo
       fica congelado nos ciclos encerrados que tiveram gasto nesta categoria. */
    if (mudouBudget) DB.definirOrcamentoPadrao(cat.id, novoBudget);
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
    <p class="muted" style="margin-bottom:var(--e3)">Passo 1 de 3 — conecte seu projeto Supabase (gratuito). Veja o guia no README do projeto.</p>
    <div class="field"><label>URL do projeto</label><input id="s-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || '')}"></div>
    <div class="field"><label>Chave anon (public)</label><input id="s-key" placeholder="eyJhbGciOi…" value="${esc(c.anonKey || '')}"></div>
    <button class="btn" id="s-save-cfg">Continuar</button>`;
  if (step === 2) body = `
    <p class="muted" style="margin-bottom:var(--e3)">Passo 2 de 3 — entre ou crie sua conta.</p>
    <div class="field"><label>E-mail</label><input id="s-email" type="email" value="${esc(c.user_email || '')}"></div>
    <div class="field"><label>Senha</label><input id="s-pass" type="password"></div>
    <div class="btn-row"><button class="btn" id="s-login">Entrar</button><button class="btn ghost" id="s-signup">Criar conta</button></div>
    <hr class="sep"><button class="btn ghost" id="s-reset">Alterar URL/chave</button>`;
  if (step === 3) body = `
    <p class="muted" style="margin-bottom:var(--e3)">Passo 3 de 3 — crie a família ou entre na que seu cônjuge criou.</p>
    <div class="field"><label>Nome da família</label><input id="s-fam-name" placeholder="Ex: Nossa casa, Família Silva…" value="${esc(DB.familyName())}"></div>
    <button class="btn" id="s-create-fam">Criar família</button>
    <hr class="sep">
    <div class="field"><label>Ou cole o código da família</label><input id="s-fam-code" placeholder="código recebido do outro membro"></div>
    <button class="btn ghost" id="s-join-fam">Entrar na família</button>`;
  if (step === 4) body = `
    <p class="muted">Conectado como <b>${esc(c.user_email || '')}</b></p>
    ${blocoConvite()}
    <button class="btn ghost" id="s-now" style="margin-top:var(--e3)">Sincronizar agora</button>
    <button class="btn ghost" id="s-diag" style="margin-top:var(--e2)">Verificar conexão e banco</button>
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
    caixa.innerHTML = '<p class="muted" style="margin-top:var(--e3)">Verificando…</p>';
    const linhas = await Sync.diagnosticar();
    const ruins = linhas.filter(l => !l.ok);
    caixa.innerHTML = `
      <div class="diag">
        ${linhas.map(l => `<div class="diag-row ${l.ok ? 'ok' : 'ruim'}">
          <b>${l.ok ? '✓' : '✕'} ${esc(l.tabela)}</b><small>${esc(l.msg)}</small></div>`).join('')}
      </div>
      ${ruins.length ? `<div class="callout warn" style="margin-top:var(--e3)">
        <b>O banco está atrás do app</b>
        <p>Abra o Supabase → SQL Editor e rode o <b>supabase/schema.sql</b> deste projeto inteiro. Ele é seguro de rodar de novo: só cria o que falta.</p></div>`
      : `<p class="muted" style="margin-top:var(--e3)">Tudo certo — o banco aceita todos os campos que o app usa.</p>`}
      ${Sync._descartados ? `<p class="muted" style="margin-top:var(--e2)">⚠️ ${Sync._descartados} registro(s) antigo(s) com dado inválido ficaram de fora do envio. Abra o lançamento e salve de novo para corrigir.</p>` : ''}`;
  });
  on('#s-logout', () => { if (confirm('Sair da conta? Os dados locais permanecem no aparelho.')) { Sync.signOut(); openSyncConfig(); } });
}

/* ---------- Importação de extrato OFX ---------- */
function openOfxImport() {
  const accounts = DB.all('accounts').filter(a => a.active !== false);
  const cards = DB.all('cards').filter(c => c.active !== false);
  openModal(`
    <div class="modal-title">Importar extrato OFX<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
    <p class="muted" style="margin-bottom:var(--e3)">No app do seu banco ou cartão, procure por <b>exportar extrato / OFX</b> e baixe o arquivo. Lançamentos já importados antes são reconhecidos e ignorados automaticamente.</p>
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
    <p class="muted" style="margin-bottom:var(--e1)">${esc(tx.memo)}</p>
    <p class="muted" style="margin-bottom:var(--e4);font-size:11.5px">${segueLote
      ? 'Hoje esta linha usa as etiquetas do lote. Mexer aqui vale só para ela.'
      : 'Esta linha tem etiquetas próprias.'}</p>
    <div class="field">
      <div class="chips" id="tl-tags">
        ${chips.map(({ t, on }) => `<button type="button" class="chip chip-tag ${on ? 'active' : ''}" data-v="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
      <input id="tl-nova" list="tag-hist-linha" placeholder="Nova etiqueta e Enter" autocomplete="off" maxlength="24" style="margin-top:var(--e2)">
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
  let aPagarCasado = {};               // linha -> "A Pagar" que o extrato veio confirmar
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
    aPagarCasado = {};

    /* O que já foi importado depende de EM QUAL CONTA se está lançando: o mesmo
       FITID em contas diferentes é lançamento diferente. Por isso o descarte é
       refeito a cada troca de "Lançar em", e não uma vez só ao abrir. */
    novos = parsed.txs.filter(t => !DB.jaImportado(t, kind === 'acc' ? contaAtual : null, kind === 'card' ? contaAtual : null));
    dups = parsed.txs.length - novos.length;

    return novos.map((t, i) => {
      const isExp = t.amount < 0;
      /* A conta que já estava esperando: o app lançou "A Pagar" pela recorrência
         e o extrato agora traz o débito. Sem casar, o mês fica com duas linhas do
         mesmo aluguel e o comprometido nunca zera. */
      const aguardando = (kind === 'acc' && isExp) ? DB.aPagarQueCasa(t, contaAtual) : null;
      if (aguardando) aPagarCasado[i] = aguardando;
      // Só conta corrente tem transferência; fatura de cartão não é conta bancária
      const par = (kind === 'acc' && !aguardando)
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
      const aviso = aguardando
        ? `<span class="ofx-aviso ok">✓ É a conta que já estava lançada (${fmtDay(aguardando.date)}). Vai ser marcada como paga, sem duplicar — escolha uma categoria abaixo se não for ela.</span>`
        : certeza
        ? `<span class="ofx-aviso">⇄ Já lançado como transferência${nomeOutra}, no mesmo dia. Marque só se for outra movimentação.</span>`
        : par
          ? `<span class="ofx-aviso duvida">⚠ Parecido com uma transferência${nomeOutra} de ${fmtDay(par.date)}. Se for a mesma, desmarque.</span>`
          : '';
      return `<div class="ofx-row ${certeza ? 'ofx-par' : ''}${par && !certeza ? ' ofx-duvida' : ''}${aguardando ? ' ofx-casado' : ''}">
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
    <div class="mini-stats" style="margin-bottom:var(--e3)">
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
        <input id="ofx-tag-nova" list="tag-hist-ofx" placeholder="Nova etiqueta e Enter (ex: viagem bahia)" autocomplete="off" maxlength="24" style="margin-top:var(--e2)">
        <datalist id="tag-hist-ofx">${DB.allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      </div>
      ${parsed.balance !== null ? `<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ofx-bal" checked style="width:18px;height:18px;accent-color:var(--gold)">Atualizar saldo da conta para ${fmt(parsed.balance)} (informado pelo banco)</label></div>` : ''}
      <div class="btn-row" style="margin-bottom:var(--e1)">
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

    let n = 0, transferidos = 0, descartadas = 0, confirmados = 0;
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

      /* A conta que já estava esperando: confirma o lançamento existente em vez
         de criar outro. Criar duplicaria a linha e deixaria o comprometido com um
         valor que nunca zera — e como a geração automática CRIA esse par de
         propósito, seria a duplicação mais frequente do app.

         A data passa a ser a do EXTRATO, que é quando o dinheiro saiu de verdade;
         a do boleto era só a previsão. */
      /* Escolher uma categoria DESFAZ o casamento: é como quem importa diz "não
         é essa conta, lance como novo". Sem essa saída, um casamento errado não
         teria conserto — desmarcar a linha só a descartaria, perdendo o
         lançamento de verdade que o extrato trouxe. */
      const casado = escolha ? null : aPagarCasado[idx];
      if (casado) {
        const atual = DB.get('transactions', casado.id);
        if (atual && atual.status === 'A Pagar') {
          const pago = { ...atual, status: 'Pago', date: t.date, fitid: t.fitid || atual.fitid || '' };
          DB.upsert('transactions', pago);
          applyTxEffect(pago, +1);        // agora sim o saldo se move
          confirmados++;
        }
        return;
      }

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
          recurring: false, pontual: false, adjustment: false,
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
        recurring: false, pontual: false,
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
    if (confirmados) partes.push(`${confirmados} conta(s) que já estavam lançadas, agora marcadas como pagas`);
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
  enabled() { return !!this.cfg && this.cfg.enabled && 'Notification' in window && Notification.permission === 'granted'; },
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
      // Limite do ciclo corrente: avisar contra o padrão num mês ajustado seria
      // dizer "estourou" de um teto que a pessoa já corrigiu
      const limite = DB.budgetOf(c.id, period);
      if (!limite) continue;
      const pct = Math.round((byCat[c.id] || 0) / limite * 100);
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

/* ---------- A CONVERSA COM O ASSISTENTE ----------

   Mora numa folha, como todo diálogo do app. A lista de conversas e a conversa
   aberta são a MESMA folha em dois estados: abrir uma conversa não empilha
   telas, troca o conteúdo — é o que evita o modal-dentro-de-modal que já
   deixou as Configurações confusas.

   O BOTÃO só existe quando o assistente está ligado. Ele fica no header, ao
   lado do olho: é o lugar de ferramenta global, presente em toda tela, e é o
   único canto do app que não disputa espaço com a barra de baixo — que já
   carrega quatro abas e o botão de lançar. */
let iaConversaAberta = null;

function pintarBotaoIA() {
  const btn = $('#btn-ia');
  if (!btn) return;
  const mostra = typeof IA !== 'undefined' && IA.disponivel();
  btn.hidden = !mostra;
}

function openIAChat(conversaId) {
  if (!IA.disponivel()) return openConfigSection('ia');

  /* Sem nada autorizado, o assistente não consegue responder nada. Melhor dizer
     isso aqui, com o caminho para resolver, do que deixar a pessoa perguntar e
     receber uma recusa. */
  if (!IA.algoAutorizado()) {
    openSheet(`
      <div class="sheet-title">Assistente<button class="close-x" id="ia-x" aria-label="Fechar"><span data-ico="x"></span></button></div>
      <div class="callout info">
        <b>Falta autorizar o que ele pode ver</b>
        <p>O assistente está ligado, mas não tem permissão para consultar nenhum dado — então não conseguiria responder nada.</p>
      </div>
      <button class="btn" id="ia-cfg">Escolher o que ele pode ver</button>
    `);
    $('#ia-x').onclick = closeSheet;
    $('#ia-cfg').onclick = () => { closeSheet(); openConfigSection('ia'); };
    return;
  }

  iaConversaAberta = conversaId || null;
  desenharIAChat();
}

function desenharIAChat() {
  const c = iaConversaAberta ? IA.conversa(iaConversaAberta) : null;
  openSheet(c ? corpoDaConversa(c) : corpoDaListaIA());
  ligarIAChat();
}

/* A lista: as conversas guardadas, da mais recente para a mais antiga. É a tela
   de entrada quando não há conversa aberta. */
function corpoDaListaIA() {
  const lista = IA.conversas().filter(c => c.turnos.length);
  return `
    <div class="sheet-title">Assistente<button class="close-x" id="ia-x" aria-label="Fechar"><span data-ico="x"></span></button></div>
    <button class="btn" id="ia-nova"><span data-ico="plus"></span> Nova conversa</button>
    ${lista.length ? `
      <p class="section-title" style="margin:var(--e5) 0 var(--e2)">Conversas anteriores</p>
      ${lista.map(c => `
        <button class="ia-item" data-abrir="${c.id}">
          <span class="ia-item-txt">
            <b>${esc(c.titulo || 'Conversa')}</b>
            <small>${c.turnos.length} pergunta(s) · ${fmtDay(String(c.tocada).slice(0, 10))}</small>
          </span>
          <span class="chev" data-ico="chev"></span>
        </button>`).join('')}
    ` : `
      <p class="muted" style="margin-top:var(--e4)">Pergunte sobre os seus números: como o mês fecha, para onde foi o dinheiro, o que muda se você cortar um gasto.</p>
    `}
  `;
}

function corpoDaConversa(c) {
  const turnos = c.turnos.map(t => `
    <div class="ia-turno">
      <div class="ia-q">${esc(t.q)}</div>
      <div class="ia-r">${formatarResposta(t.r)}</div>
    </div>`).join('');

  return `
    <div class="sheet-title">
      <button class="ia-voltar" id="ia-lista" aria-label="Todas as conversas"><span data-ico="back"></span></button>
      <span class="ia-titulo">${esc(c.titulo || 'Nova conversa')}</span>
      <button class="close-x" id="ia-x" aria-label="Fechar"><span data-ico="x"></span></button>
    </div>
    <div class="ia-fluxo" id="ia-fluxo">
      ${turnos || `<div class="ia-vazio">
        <p>Pergunte o que quiser sobre as suas contas.</p>
        <div class="ia-sugestoes">
          <button class="ia-sug">Como fecha este mês?</button>
          <button class="ia-sug">Para onde foi meu dinheiro?</button>
          <button class="ia-sug">Quanto posso gastar hoje sem apertar?</button>
          <button class="ia-sug">E se eu cortar R$ 300 por mês?</button>
        </div>
      </div>`}
      <div class="ia-pensando" id="ia-pensando" hidden>
        <i></i><i></i><i></i><span id="ia-passo">consultando…</span>
      </div>
    </div>
    <div class="ia-barra">
      <input id="ia-campo" placeholder="Pergunte sobre suas contas…" autocomplete="off" enterkeyhint="send">
      <button class="ia-enviar" id="ia-enviar" aria-label="Enviar"><span data-ico="chevR"></span></button>
    </div>
  `;
}

/* A resposta vem em texto. Aqui ela vira HTML seguro: o escape é feito ANTES de
   qualquer marcação, então nada que o modelo escreva pode injetar tag. Depois
   disso, só duas convenções sobrevivem — negrito e lista —, que são as que ele
   usa para destacar um número e enumerar itens. */
function formatarResposta(txt) {
  const seguro = esc(String(txt || ''));
  return seguro
    .split(/\n{2,}/)
    .map(bloco => {
      const linhas = bloco.split('\n');
      if (linhas.every(l => /^\s*[-*]\s+/.test(l))) {
        return '<ul>' + linhas.map(l => `<li>${negrito(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('') + '</ul>';
      }
      return `<p>${negrito(linhas.join('<br>'))}</p>`;
    })
    .join('');
}
function negrito(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }

function ligarIAChat() {
  const x = $('#ia-x');
  if (x) x.onclick = closeSheet;

  const nova = $('#ia-nova');
  if (nova) nova.onclick = () => { iaConversaAberta = IA.novaConversa().id; desenharIAChat(); };

  const voltar = $('#ia-lista');
  if (voltar) voltar.onclick = () => { iaConversaAberta = null; desenharIAChat(); };

  document.querySelectorAll('#sheet [data-abrir]').forEach(el => {
    el.onclick = () => { iaConversaAberta = el.dataset.abrir; desenharIAChat(); };
  });

  document.querySelectorAll('#sheet .ia-sug').forEach(b => {
    b.onclick = () => { const campo = $('#ia-campo'); campo.value = b.textContent; enviarIA(); };
  });

  const enviar = $('#ia-enviar');
  if (enviar) enviar.onclick = enviarIA;

  const campo = $('#ia-campo');
  if (campo) {
    campo.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); enviarIA(); } };
    setTimeout(() => campo.focus(), 60);
  }
  rolarIAFim();
}

function rolarIAFim() {
  const f = $('#ia-fluxo');
  if (f) f.scrollTop = f.scrollHeight;
}

async function enviarIA() {
  const campo = $('#ia-campo');
  const pergunta = (campo && campo.value || '').trim();
  if (!pergunta) return;

  if (!iaConversaAberta) iaConversaAberta = IA.novaConversa().id;

  campo.value = '';
  campo.disabled = true;
  const enviar = $('#ia-enviar');
  if (enviar) enviar.disabled = true;

  /* A pergunta entra na tela ANTES da resposta chegar. Sem isso, o texto some
     do campo e nada aparece por vários segundos — parece que o toque falhou. */
  const fluxo = $('#ia-fluxo');
  const vazio = fluxo && fluxo.querySelector('.ia-vazio');
  if (vazio) vazio.remove();
  const bloco = document.createElement('div');
  bloco.className = 'ia-turno';
  bloco.innerHTML = `<div class="ia-q">${esc(pergunta)}</div>`;
  const pensando = $('#ia-pensando');
  if (fluxo && pensando) fluxo.insertBefore(bloco, pensando);
  if (pensando) pensando.hidden = false;
  rolarIAFim();

  /* Dizer QUAL dado está sendo consultado, enquanto consulta. É a transparência
     que a tela de permissões promete: a pessoa vê o assistente pedindo "gastos
     por categoria" e sabe que foi só isso que saiu. */
  const rotulos = {
    situacao_financeira: 'vendo seus saldos…',
    resumo_do_mes: 'somando o mês…',
    gastos_por_categoria: 'olhando as categorias…',
    projecao_do_mes: 'projetando o fim do mês…',
    proximos_meses: 'olhando os próximos meses…',
    contas_fixas: 'listando as contas fixas…',
    cartoes_e_faturas: 'conferindo as faturas…',
    metas_e_reserva: 'vendo metas e reserva…',
    lancamentos: 'procurando nos lançamentos…',
    cofrinho_das_criancas: 'vendo o cofrinho…',
    simular_cenario: 'simulando…',
  };

  try {
    const r = await IA.perguntarNaConversa(iaConversaAberta, pergunta, nome => {
      const p = $('#ia-passo');
      if (p) p.textContent = rotulos[nome] || 'consultando…';
    });
    if (pensando) pensando.hidden = true;
    const resp = document.createElement('div');
    resp.className = 'ia-r';
    resp.innerHTML = formatarResposta(r.texto);
    bloco.appendChild(resp);
    // O título só existe depois da primeira pergunta: atualiza o cabeçalho
    const tit = $('#sheet .ia-titulo');
    const conv = IA.conversa(iaConversaAberta);
    if (tit && conv && conv.titulo) tit.textContent = conv.titulo;
  } catch (e) {
    if (pensando) pensando.hidden = true;
    const err = document.createElement('div');
    err.className = 'ia-erro';
    err.textContent = e.message || 'Não consegui responder agora.';
    bloco.appendChild(err);
  } finally {
    campo.disabled = false;
    if (enviar) enviar.disabled = false;
    campo.focus();
    rolarIAFim();
  }
}

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
$('#side-config').onclick = openConfig;
$('#side-lock').onclick = () => Auth.lockNow();
/* Atalhos do header e da sidebar para telas que já existem em Configurações.
   Nada de lógica nova: são as mesmas funções que a lista de ajustes chama. */
$('#btn-perfil').onclick = openConfig;
$('#btn-ofx').onclick = () => openOfxImport();
$('#btn-ia').onclick = () => openIAChat();
$('#side-recorrencias').onclick = () => openRecorrencias();
$('#side-criancas').onclick = () => openCriancas();

/* ---------- Ocultar valores ----------
   O borrão é CSS puro (`.privado`, em styles.css); aqui só se guarda a escolha e
   se mantém o botão contando o estado atual. Fica no <html> e não no <body>
   porque o mesmo bloco no topo do index.html o aplica antes da primeira pintura —
   sem isso, os valores apareceriam por um quadro antes de borrar. */
const PRIVACIDADE_KEY = 'financas.privacidade';
function pintarPrivacidade() {
  const ligado = document.documentElement.classList.contains('privado');
  const btn = $('#btn-privacidade');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(ligado));
  btn.title = ligado ? 'Mostrar valores' : 'Ocultar valores';
  btn.setAttribute('aria-label', btn.title);
  btn.querySelector('[data-ico]').dataset.ico = ligado ? 'eyeOff' : 'eye';
  paintIcons(btn);
}
$('#btn-privacidade').onclick = () => {
  const ligado = document.documentElement.classList.toggle('privado');
  try { localStorage.setItem(PRIVACIDADE_KEY, ligado ? '1' : '0'); } catch (_) {}
  pintarPrivacidade();
};
pintarPrivacidade();

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
/* Não há mais botão de sincronizar no header: ele sincroniza sozinho
   (`Sync.startAuto`) e o "Sincronizar agora" continua em Configurações →
   Sincronização, para quando alguém quiser forçar. `sincronizarAgora` segue
   exportada porque é ela que aquele botão chama. */
window.sincronizarAgora = sincronizarAgora;
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
/* ---------- O estado da sincronização, no canto do avatar ----------

   Ele tinha pastilha própria com rótulo, ao lado do chip de período: dois blocos
   permanentes ocupando a barra inteira para dizer, quase sempre, que está tudo
   em dia. Virou um ponto na quina do avatar, e SÓ APARECE QUANDO HÁ ALGO A
   DIZER — fila, sem conexão ou sincronizando. Indicador permanente de "nada
   acontecendo" é ruído, e ruído constante deixa de ser lido.

   O `title` continua dizendo em palavras o que a cor diz, para quem passa o
   mouse e para leitor de tela. */
Sync.onState = (estado, pendentes) => {
  const btn = $('#btn-perfil');
  if (!btn) return;
  // 'ok' e 'off' não acendem nada: nos dois casos não há o que resolver agora
  const acende = { sync: 'sync', pendente: 'pendente', offline: 'offline' }[estado];
  if (acende) btn.dataset.sync = acende;
  else delete btn.dataset.sync;

  const dito = {
    ok: 'Tudo sincronizado', sync: 'Sincronizando…',
    pendente: `${pendentes} alteração(ões) aguardando conexão`,
    offline: 'Sem conexão — será enviado assim que voltar',
    off: 'Sincronização não configurada',
  }[estado] || '';
  btn.title = dito ? `Perfil e configurações · ${dito}` : 'Perfil e configurações';
  btn.setAttribute('aria-label', btn.title);
};

function refreshUserChip() {
  const mail = (Sync.cfg && Sync.cfg.user_email) || '';
  $('#user-name').textContent = mail ? mail.split('@')[0] : 'Família';
  $('#user-mail').textContent = mail ? (Sync.hasFamily() ? 'sincronizado ☁️' : 'conectado') : 'modo local';
  const inicial = (mail || 'F').charAt(0).toUpperCase();
  $('#user-avatar').textContent = inicial;
  // O mesmo avatar aparece no header (é o atalho de perfil em qualquer largura)
  const topo = $('#topbar-avatar');
  if (topo) topo.textContent = inicial;
}
refreshUserChip();
pintarBotaoIA();
paintIcons();   // ícones do shell estático (sidebar, topbar, tabbar)

window.addEventListener('beforeunload', persistUI);

Notif.load();
IA.load();
UI.init();
Voltar.init();
restoreUI();
Auth.init(() => {
  /* Gera o que se repete ANTES de desenhar: senão o painel abriria mostrando um
     comprometido que ainda não conhece o aluguel deste mês, e o número mudaria
     sozinho um segundo depois. Como decidimos não estimar custo fixo, é esta
     geração que mantém o comprometido fiel. */
  /* Recupera faturas pagas antes de o pagamento virar lançamento. Sem isto, o
     saldo anterior de qualquer mês com fatura paga no modelo antigo vem errado e
     a soma do extrato não fecha — foi o defeito relatado na conta C6. */
  try { DB.migrarFaturasPagasAntigas(); } catch (_) {}
  try { DB.gerarRecorrencias(); } catch (_) {}
  /* Traz o que a criança fez no app dela e devolve o que mudou aqui. Antes do
     desenho, porque a fila do painel precisa contar as tarefas que ela marcou
     enquanto este app estava fechado. */
  try { DB.ponteDoCofrinho(); } catch (_) {}
  /* Só agora dá: a configuração do assistente mora dentro do banco cifrado, e
     antes do PIN DB.data era null — o IA.load() lá de cima leu o padrão. */
  IA.load();
/* O ASSISTENTE PRECISA SABER ONDE A PESSOA ESTÁ.

   Sem isto, "e esse mês?" é ambíguo: o modelo assume o ciclo atual enquanto a
   tela mostra março. Com isto, "esse mês", "aqui" e "isso" resolvem para o que
   ela está de fato olhando.

   É um GANCHO, e não uma leitura de `state` dentro do js/ia.js, para aquele
   arquivo continuar carregável sozinho — é assim que as suítes o rodam sem
   navegador. */
IA.ondeEstou = () => {
  try {
    const p = DB.monthPeriod(new Date(), state.monthOffset || 0);
    return { tela: TITULOS[state.tab] || 'Painel', ciclo: state.monthOffset || 0, rotulo: p && p.label };
  } catch (_) { return null; }
};
  pintarBotaoIA();
  /* Traz do Supabase a chave e as conversas que este aparelho não tem. É o que
     devolve o assistente inteiro depois de "apagar os dados deste aparelho". */
  IA.sincronizar().then(() => { pintarBotaoIA(); }).catch(() => {});
  setTab(state.tab);          // restaura a aba e marca o menu corretamente
  Sync.startAuto();           // mantém o aparelho em dia sempre que houver conexão
  setTimeout(() => Notif.check(), 800);
});
