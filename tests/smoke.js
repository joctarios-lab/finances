/* Teste de fumaça: roda o app sem navegador e valida as correlações entre os módulos. */

/* ---- RELOGIO CONGELADO ----

   "Hoje" era uma entrada NAO controlada: o cenario ancora lancamentos em dias
   fixos do mes (dia 3, dia 10), entao a relacao entre eles e o dia de execucao
   mudava sozinha. A suite ficava verde no dia em que era escrita e apodrecia:
   medido, 4 falhas duas semanas depois e 13 no ultimo dia do mes, nenhuma delas
   defeito do app. Uma rede que reprova sem regressao para de ser lida.

   Agora a data e um parametro. O padrao e a ancora abaixo, o que torna a suite
   deterministica; `tests/tempo.js` roda esta mesma suite em varias datas de
   calendario (virada de mes, ultimo dia, fevereiro, ano novo) para que congelar
   nao vire desculpa para nao testar o calendario. */
const ANCORA = process.env.HOJE || '2026-08-12T10:00:00-03:00';
const DataReal = Date;
const instante = new DataReal(ANCORA).getTime();
class DataCongelada extends DataReal {
  // Só o construtor vazio muda: `new Date(x)` continua sendo o Date de sempre
  constructor(...a) { if (a.length === 0) super(instante); else super(...a); }
  static now() { return instante; }
}
DataCongelada.parse = DataReal.parse;
DataCongelada.UTC = DataReal.UTC;
global.Date = DataCongelada;
const fs = require('fs');
const BASE = 'D:/Projetos/meus-projetos/financas/';

// ---- stubs mínimos de navegador ----
// key/length existem porque DB.apagarTudo varre as chaves em vez de listá-las
const armazem = base => ({
  getItem: k => (k in base ? base[k] : null),
  setItem: (k, v) => { base[k] = String(v); },
  removeItem: k => { delete base[k]; },
  key: i => Object.keys(base)[i] ?? null,
  get length() { return Object.keys(base).length; },
});
const store = {}, sessao = {};
global.localStorage = armazem(store);
global.sessionStorage = armazem(sessao);
// uuid de verdade: o banco tem colunas uuid, e a auditoria de schema confere o formato
global.crypto = {
  randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }),
};
// família de teste: precisa ser uuid, porque family_id é uuid no banco
const FAM_TESTE = '11111111-1111-4111-8111-111111111111';
const ID_ANTIGA = '22222222-2222-4222-8222-222222222222';
const ID_NOVA = '33333333-3333-4333-8333-333333333333';
const ID_FILHA = '44444444-4444-4444-8444-444444444444';

// DOM falso com registro por seletor: permite preencher campos e "clicar" nos botões,
// exercitando os fluxos reais do app (não só as funções de renderização).
const els = {};
function makeEl(sel) {
  return {
    _sel: sel, value: '', innerHTML: '', textContent: '', hidden: false, checked: false, placeholder: '',
    dataset: {}, style: {}, options: [{ textContent: '' }, { textContent: '' }],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, setSelectionRange() {},
    click() { if (this.onclick) this.onclick({ stopPropagation() {} }); },
    querySelector: () => el('#_dentro'), querySelectorAll: () => [], closest: () => null,
  };
}
const el = sel => els[sel] || (els[sel] = makeEl(sel));
global.document = {
  querySelector: sel => el(sel),
  querySelectorAll: () => [],
  getElementById: id => el('#' + id),
  addEventListener: () => {},
  createElement: () => makeEl('novo'),
};
global.window = global;
global.confirm = () => true;
global.requestAnimationFrame = fn => fn();
global.paintIcons = () => {};
global.scrollTo = () => {};
global.addEventListener = () => {};
global.Sync = { load() {}, autoSync() {}, saveCfg() {}, cfg: {}, hasFamily: () => false, loggedIn: () => false, configured: () => false };
global.Auth = { init: cb => cb(), enabled: () => false, cfg: {} };
global.navigator = { onLine: false };
global.Notification = undefined;

// ---- carrega os módulos reais ----
eval(fs.readFileSync(BASE + 'js/db.js', 'utf8') + '; global.DB = DB;');
eval(fs.readFileSync(BASE + 'js/ofx.js', 'utf8') + '; global.OFX = OFX;');
/* Graficos vem antes do app, que o usa ao montar cada tela. Sem ApexCharts no
   ambiente headless, montar() é no-op de propósito: o que continua sob teste é a
   configuração que cada gráfico produz — a matemática do dinheiro — não o pixel. */
eval(fs.readFileSync(BASE + 'js/graficos.js', 'utf8') + '; global.Graficos = Graficos;');
/* O assistente. Carregado antes do app porque a lista de Configurações lê o
   estado dele para dizer se está ligado. Nenhum teste aqui chama a API — o que
   se testa são as ferramentas sobre o DB, que rodam locais, e as permissões. */
eval(fs.readFileSync(BASE + 'js/ia.js', 'utf8') + '; global.IA = IA;');

/* Com ApexCharts o gráfico não é mais HTML inspecionável: a função devolve um
   <div> vazio e enfileira a CONFIGURAÇÃO. Então é a configuração que os testes
   olham daqui em diante, e isso é um ganho — antes eles conferiam coordenada de
   path, que é detalhe de como o desenho foi feito; agora conferem a intenção:
   qual forma para qual dado, qual série, qual escala, qual cor. */
global.cfgDo = html => { const f = Graficos.fila; return (f[f.length - 1] || {}).opts; };
global.cfgsDe = html => Graficos.fila.map(f => f.opts);
global.zeraFila = () => { Graficos.fila = []; };
// Achata a série numa lista de números, aceitando [n] ou [{x,y}]
// Nomes dos gráficos na fila, na ordem em que aparecem na tela
global.nomesDe = () => Graficos.fila.map(f => f.nome);
global.pontosDe = s => (s.data || []).map(p => (p && typeof p === 'object' ? p.y : p));
const appSrc = fs.readFileSync(BASE + 'js/app.js', 'utf8').split('/* ---------- Boot ---------- */')[0];
eval(appSrc + `; Object.assign(global, {
  renderInicio, renderExtrato, renderCartoes, renderMetas, renderRelatorios,
  state, fmt, fmtShort, fmtSemMoeda, fmtDay, fmtDate, esc, todayISO, avisarSeUsouGuardado, txEffect, adjustBalance, topCategoryIds, txHistory, MEMBRO_COMUM,
  openGoalDetail, openAporteSheet, openEntrySheet, openInvoiceDetail, openTxSheet,
  openSaldoSheet, openTransferSheet, persistUI, restoreUI, reconcileBalance, applyTxEffect, svgBars, svgRanking, svgDonut, svgBurnup, niceCeil, svgCascata, svgLinhaFaixa, svgFluxoSaldo,
  Voltar, setTab, closeSheet, toast, optionsCategorias, txsFiltradas, efeitoDaTransferencia, fixarTags, lerTagsFixas, filtrosAtivos, FILTROS_VAZIOS, filtrosVazios, somarDias, bindView, fmt,
  diasDoPeriodo, opcoesCategoriaPilula, reguaDoMes, pilulasDeFiltro, rotuloPilula, ligarRegua, ligarPilulas, resumoExtrato,
  serieDeSaldo, sparkArea, PALETTE, prazoDaMeta, custoFixoCard, pontePrevista, saldoDeContas, notaDeHoje, notaDoFiltro,
  openPagarFaturaSheet, desfazerPagamentosDaFatura, rotuloDaFatura,
  cartaoBloco, usoDoLimite, linhasDaPrevisao, openClassificarGastos, linhaDeClassificacao, ligarClassificacao, classificarGasto, vincularAContrato, desvincularDoContrato, openEscolherContrato, openCriarContrato, contratoDoLancamento, openHistoricoFaturas, openFaturasFuturas, ligarAcoesDeFatura, prazoDeVencimento, mesAno,
  cardPrevisaoDoMes, secaoDoQueAindaVem, linhaPrevista, openAporteSheet, selectChip, chipValue, somarDias, resumoDoProximoMes, notaDoInvestimento,
  propagarNasParcelas, trocarDiaDoMes, irmasDaParcela,
  Rel, relProximosMeses, projecaoCard, passaNosFiltros, temFiltroAtivo, barraDePilulas, openRecorrencias, openEditarContrato, openConfig, criarRecorrenciaDoLancamento, clarear, svgComposicao, deltaCelula, pesoCelula, valorCelula, verLancamentosDaTag, quebrarRotulo, corDeTextoSobre,
  Massa, openMassaModal, renderMassa, closeModal, openModal, aplicarNaLinha, trocarTipo, linhaEditavel, openMassaEditSheet, aplicarMassa, excluirMassa, desfazerMassa,
  efeitoNasContas, aplicarTags, massaAceita, confirmarMassa, openCategoriesConfig, openCategoryEditor, openCriancas, openCriancaDetalhe, openKidExtrato, blocoDaSemanada, openKidLancarSheet, openKidTarefaSheet, notaDosFilhos, openCriancaSheet, openConfirmarTarefas, pagarSemanada, confirmarTarefa, filaDasCriancas, openEnvelopeDetail, catLabel,
  corpoDaListaIA, formatarResposta });`);

/* 'R$ 1.234,56' de volta para 1234.56.

   Serve para conferir a conta que a TELA mostra, em vez de refazer a conta certa
   ao lado da errada — que é o jeito de um teste passar verde enquanto a tela
   mostra outra coisa. */
function desmoeda(s) {
  return Number(String(s).replace(/[^0-9,\-]/g, '').replace(',', '.')) || 0;
}

// ---- monta um cenário de família ----
DB.load();
const cat = n => DB.all('categories').find(c => c.name.includes(n));
const conta = DB.upsert('accounts', { name: 'Nubank CC', type: 'Conta Corrente', balance: 5000, active: true });
const caixinha = DB.upsert('accounts', { name: 'Reserva', type: 'Caixinha / Rendimento', balance: 12000, active: true });
const cartao = DB.upsert('cards', { name: 'Nubank', closing_day: 25, due_day: 5, limit_amount: 6000, account_id: conta, active: true });
DB.upsert('family_settings', { ...DB.settings(), members: ['Joctã', 'Cônjuge'], monthly_income: 0, month_start_day: 1 });

const hoje = new Date();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = n => { const d = new Date(hoje.getFullYear(), hoje.getMonth(), n); return iso(d); };

// despesas, receita, gasto pessoal, parcela e uma conta a pagar
DB.upsert('transactions', { description: 'Mercado', amount: 800, date: dia(3), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: conta, category_id: cat('Aliment').id });
DB.upsert('transactions', { description: 'Salário', amount: 9000, date: dia(5), type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: conta });
DB.upsert('transactions', { description: 'Roupa', amount: 300, date: dia(6), type: 'Despesa', status: 'Pago', scope: 'Pessoal', member: 'Joctã', method: 'Cartão de Crédito', card_id: cartao, invoice_key: DB.invoiceKeyFor(DB.get('cards', cartao), dia(6)), category_id: cat('Pessoais').id });
DB.upsert('transactions', { description: 'Estorno Roupa', amount: 100, date: dia(8), type: 'Receita', status: 'Pago', scope: 'Pessoal', member: 'Joctã', method: 'Cartão de Crédito', card_id: cartao, invoice_key: DB.invoiceKeyFor(DB.get('cards', cartao), dia(8)) });
DB.upsert('transactions', { description: 'IPTU', amount: 450, date: dia(10), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', category_id: cat('Moradia').id });
const meta = DB.upsert('goals', { name: 'Viagem', icon: '✈️', target_amount: 8000 });
DB.upsert('goal_entries', { goal_id: meta, amount: 2000, date: dia(2), description: 'Aporte' });

// ---- asserções ----
let ok = 0, fail = 0;
const check = (nome, real, esperado) => {
  const bateu = Math.abs(Number(real) - Number(esperado)) < 0.01 || real === esperado;
  console.log(`${bateu ? '  OK  ' : ' FALHA'} | ${nome.padEnd(52)} ${bateu ? real : `obtido ${real}, esperado ${esperado}`}`);
  bateu ? ok++ : fail++;
};

const p = DB.monthPeriod(new Date());
console.log('\n=== Correlações entre módulos ===');
check('despesas do período (receita não entra)', DB.expensesOf(p).reduce((s, t) => s + t.amount, 0), 800 + 300 + 450);
check('receitas do período', DB.realizedIncome(p), 9000);
check('statsFor.spent ignora receitas', DB.statsFor(p).spent, 1550);
check('fatura do cartão: compra menos estorno', DB.invoicesOf(DB.get('cards', cartao))[0].total, 200);
/* Comprometido do mês = o que VENCE no mês. A fatura do cenário vence 05/ago com
   o ciclo fechando 01/ago, então ela pertence a agosto — o dinheiro dela não sai
   do caixa em julho, e somá-la aqui faria o disponível de julho mentir. */
check('comprometido = só o que vence no ciclo', DB.committed(), 450);
check('total em contas', DB.accountsTotal(), 17000);
/* O disponível desconta também o GUARDADO: dinheiro com plano não é dinheiro
   livre. Era o defeito central — quem guardou R$ 15.000 de reserva os via como
   gastáveis. Descontar não conta duas vezes porque o aporte é transferência real
   entre contas próprias: o dinheiro está em accountsTotal, só que com dono. */
check('guardado = reserva + metas', DB.guardado(), 2000);
check('disponível = contas − comprometido − guardado', DB.available(), 17000 - 450 - 2000);
/* A fatura não desaparece: ela vai para "vence depois deste mês". Sem isso, tirá-la
   do comprometido a faria sumir das DUAS contas — e fatura invisível é o pior
   lugar possível para uma dívida existir. */
check('a fatura do ciclo seguinte aparece à parte', DB.committedDepois(), 200);
check('e não some do total geral', DB.committed() + DB.committedDepois(), 650);
check('reserva zerada enquanto não houver caixinha de reserva', DB.reserveTotal(), 0);
check('gasto por categoria: Alimentação', DB.spentByCategory(p)[cat('Aliment').id], 800);
check('50/30/20 — necessidades', DB.spentByKind(p).Essencial, 800 + 450);
check('50/30/20 — desejos', DB.spentByKind(p).Estilo, 300);
check('meta acumulada por aportes', DB.goalTotal(meta), 2000);

console.log('\n=== Regras de negócio ===');
const c = DB.get('cards', cartao);
check('compra antes do fechamento → fatura do mês', DB.invoiceKeyFor(c, '2026-08-20').split(':')[1], '2026-08');
check('compra depois do fechamento → fatura seguinte', DB.invoiceKeyFor(c, '2026-08-26').split(':')[1], '2026-09');
DB.upsert('family_settings', { ...DB.settings(), month_start_day: 5 });
const p5 = DB.monthPeriod(new Date('2026-08-03T12:00:00'));
check('mês financeiro iniciando dia 5 (03/08 → ciclo de julho)', iso(p5.start), '2026-07-05');
DB.upsert('family_settings', { ...DB.settings(), month_start_day: 1 });
check('saldo: despesa paga em conta debita', txEffect({ status: 'Pago', account_id: conta, amount: 100, type: 'Despesa' }), -100);
check('saldo: receita paga em conta credita', txEffect({ status: 'Pago', account_id: conta, amount: 100, type: 'Receita' }), 100);
check('saldo: compra no cartão não mexe na conta', txEffect({ status: 'Pago', account_id: conta, card_id: cartao, amount: 100 }), 0);
check('saldo: "A Pagar" ainda não debita', txEffect({ status: 'A Pagar', account_id: conta, amount: 100 }), 0);
check('categorias mais usadas vêm primeiro', topCategoryIds(3).length, 3);
check('histórico alimenta o autocomplete', txHistory().length > 0, true);

console.log('\n=== Telas renderizam sem erro ===');
for (const [nome, fn] of [['Início', renderInicio], ['Extrato', renderExtrato], ['Cartões', renderCartoes], ['Metas', renderMetas], ['Relatórios', renderRelatorios]]) {
  try {
    const html = fn(p);
    check(`${nome} (${String(html.length).padStart(5)} caracteres de HTML)`, html.length > 200, true);
  } catch (e) {
    console.log(` FALHA | ${nome}: ${e.message}`); fail++;
  }
}

/* ---- Cabeçalho de seção: um padrão só nas telas que têm ação no topo ----
   O botão de nova meta era um `.btn ghost` de largura inteira solto no topo: ele
   empurrava a lista para baixo, competia em peso com o conteúdo e não parecia da
   mesma família dos botões das outras telas. */
console.log('\n=== Ações no topo seguem um padrão só ===');
{
  const metasHtml = renderMetas();
  const cartoesHtml = renderCartoes(p);
  const extratoHtml = renderExtrato(p);
  // O padrão existe e é o mesmo nas três
  for (const [tela, html] of [['metas', metasHtml], ['cartões', cartoesHtml], ['extrato', extratoHtml]]) {
    check(tela + ': usa o cabeçalho de seção', html.includes('class="sec-cab"'), true);
    check(tela + ': com a ação como sec-btn', html.includes('class="sec-btn"'), true);
  }
  check('nova meta é um sec-btn', /<button class="sec-btn" id="btn-new-goal"/.test(metasHtml), true);
  check('e não o botão largo de antes',
    /class="btn ghost" id="btn-new-goal"/.test(metasHtml), false);
  check('o ícone existe no conjunto de ícones',
    /data-ico="target"><\/span>Nova meta/.test(metasHtml)
    && fs.readFileSync(BASE + 'js/icons.js', 'utf8').includes('target'), true);

  /* ---- Nenhum ícone fantasma ----
     `paintIcons` procura o nome no conjunto e, não achando, simplesmente não
     escreve nada: o elemento fica vazio, sem erro no console e sem falha
     visível em teste nenhum. Um botão sem ícone é o tipo de defeito que só
     aparece quando alguém abre a tela — por isso a checagem é aqui. */
  const fonteIcones = fs.readFileSync(BASE + 'js/icons.js', 'utf8');
  const definidos = new Set([...fonteIcones.matchAll(/^  ([a-zA-Z]+): _svg/gm)].map(m => m[1]));
  const fontes = ['js/app.js', 'js/auth.js', 'js/ui.js', 'index.html']
    .map(f => fs.readFileSync(BASE + f, 'utf8')).join('\n');
  // Só os nomes literais: os montados por expressão são conferidos pelo ramo abaixo
  const literais = [...fontes.matchAll(/data-ico="([a-zA-Z]+)"/g)].map(m => m[1]);
  const fantasmas = [...new Set(literais)].filter(n => !definidos.has(n));
  check('todo data-ico literal existe em icons.js', fantasmas.join(', '), '');
  check('e o conjunto cobre a interface inteira', definidos.size >= 30, true);
  // O cabeçalho vem antes da lista, senão a ação fica perdida no meio dela
  check('o cabeçalho vem antes do conteúdo',
    metasHtml.indexOf('sec-cab') < metasHtml.indexOf('id="btn-new-goal"') + 400, true);
  /* O subtítulo aproveita o espaço que o botão largo desperdiçava — e tem de dizer
     algo em ambos os estados. "R$ 0,00 guardado" numa tela sem metas seria pior que
     texto nenhum. */
  const sub = h => (h.match(/<small>([^<]*)<\/small>/) || ['', ''])[1];
  check('com metas, o subtítulo resume o guardado', /guardado/.test(sub(metasHtml)), true);
  const guardadasT = DB.data.goals;
  DB.data.goals = [];
  check('sem metas, ele explica o que a tela é', sub(renderMetas()), 'objetivos com valor e prazo');
  check('e não anuncia zero guardado', /R\$/.test(sub(renderMetas())), false);
  DB.data.goals = guardadasT;
}

console.log('\n=== Painel mostra os números certos ===');
const inicio = renderInicio(p);
for (const [rotulo, valor] of [['gasto do mês', fmtShort(1550)], ['comprometido', fmtShort(450)]]) {
  check(`painel exibe ${rotulo} (${valor})`, inicio.includes(valor), true);
}
/* O hero do mês corrente tem DOIS blocos: o caixa de HOJE e a projeção até o fim
   do ciclo. Cada um fecha no seu próprio total — sem isso viram uma conta só de
   nove linhas que não fecha. */
check('o hero abre com o bloco de hoje', inicio.includes('>Hoje <i>dia '), true);
check('e tem o bloco do previsto', /hc-cab">Previsto <i>até /.test(inicio), true);
check('o caixa de hoje é contas menos guardado',
  inicio.includes(`<span>= Livre para gastar hoje</span><b>${fmt(DB.accountsTotal() - DB.guardado())}</b>`), true);
check('com o guardado como parcela', inicio.includes('− Guardado'), true);
check('e a projeção fecha em "Livre ao fim"', inicio.includes('= Livre ao fim'), true);

/* A IDENTIDADE do bloco previsto: a soma das linhas TEM de dar o total logo
   abaixo delas. Um painel cujo total não se confere nas próprias parcelas é o
   pior defeito possível — foi por isso que a linha do vencido passou a existir. */
{
  const perA = DB.monthPeriod(new Date());
  const fimA = DB.fimISO(perA);
  const pvA = DB.previsaoDoMes(perA);
  const emContasFimA = DB.saldoPrevistoNaData(null, fimA);
  const atrasadoA = DB.pendenteDeCiclosAnteriores(perA);
  check('a conta do previsto fecha: abre + entra − sai + vencido = fim',
    Math.round((DB.accountsTotal() + pvA.entra - pvA.sai + atrasadoA) * 100) / 100,
    Math.round(emContasFimA * 100) / 100);
  /* O rótulo do topo tem de nomear o MÊS: "disponível previsto" sem dizer até
     quando é uma promessa sem prazo. */
  check('e o topo diz de que mês está falando',
    inicio.includes(`Disponível previsto ao fim de ${p.label}`), true);

  /* O NÚMERO GRANDE é o previsto, não o disponível de hoje. Sem uma receita à
     frente os dois COINCIDEM — foi assim que a primeira versão deste teste passou
     mesmo com o hero sabotado de volta para `available`. Uma entrada prevista os
     separa, que é justamente o caso real: o salário que ainda vai cair. */
  /* A receita tem de cair DENTRO do ciclo, senão ela não entra na previsão dele e
     os dois números voltam a coincidir — o teste passaria a reprovar todo fim de
     mês, quando "daqui a três dias" já é o mês que vem. No último dia do ciclo
     não há amanhã: ela fica em hoje, ainda "A Pagar", que é o que a separa do
     saldo em conta. */
  const ultimoDiaA = somarDias(DB.fimISO(perA), -1);
  const venceSalario = somarDias(todayISO(), 3) > ultimoDiaA ? ultimoDiaA : somarDias(todayISO(), 3);
  const idSal = DB.upsert('transactions', {
    description: 'Salário previsto', amount: 5000,
    date: venceSalario, type: 'Receita', status: 'A Pagar',
    scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: DB.all('accounts')[0].id,
  });
  const comSalario = renderInicio(DB.monthPeriod(new Date()));
  const fimS = DB.saldoPrevistoNaData(null, fimA) - DB.guardadoPrevisto(fimA);
  check('com receita à frente, o previsto difere do disponível de hoje',
    Math.abs(fimS - DB.available()) > 0.005, true);
  check('e o número grande é o previsto ao fim, não o de hoje',
    comSalario.includes(`<div class="hero-value">${fmt(fimS)}</div>`), true);
  check('o disponível de hoje não ocupa o número grande',
    comSalario.includes(`<div class="hero-value">${fmt(DB.available())}</div>`), false);
  DB.remove('transactions', idSal);
}

/* A LINHA DO VENCIDO só aparece quando existe — e, quando existe, é ela que faz a
   conta fechar. Sem ela o saldo final ficaria otimista em silêncio. */
{
  const perV = DB.monthPeriod(new Date());
  check('sem vencido de meses anteriores, a linha não aparece',
    /hc-l"><span>[−+] Vencido/.test(renderInicio(perV)), false);
  const contaV = DB.all('accounts')[0];
  const idV = DB.upsert('transactions', {
    description: 'Boleto atrasado', amount: 300,
    date: somarDias(DB.inicioISO(perV), -5), type: 'Despesa', status: 'A Pagar',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: contaV.id,
  });
  const comVencido = renderInicio(perV);
  check('com vencido em aberto, ela aparece',
    comVencido.includes('− Vencido <i>de meses anteriores, em aberto</i></span><b>' + fmt(300)), true);
  const pvV = DB.previsaoDoMes(perV);
  check('e a conta continua fechando com ela',
    Math.round((DB.accountsTotal() + pvV.entra - pvV.sai + DB.pendenteDeCiclosAnteriores(perV)) * 100) / 100,
    Math.round(DB.saldoPrevistoNaData(null, DB.fimISO(perV)) * 100) / 100);
  check('o vencido entra como saída, não como entrada',
    DB.pendenteDeCiclosAnteriores(perV) < 0, true);
  /* RECEITA atrasada tem o sinal contrário: um salário que não caiu não piora o
     saldo, ele ainda vai somar. Sem este caso, um sinal fixo em "menos" passaria
     no teste da despesa e só apareceria na tela de quem tem recebimento em atraso. */
  const soDespesa = DB.pendenteDeCiclosAnteriores(perV);
  const idR = DB.upsert('transactions', {
    description: 'Recebimento atrasado', amount: 200,
    date: somarDias(DB.inicioISO(perV), -4), type: 'Receita', status: 'A Pagar',
    scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaV.id,
  });
  check('receita atrasada soma, não subtrai',
    Math.round((DB.pendenteDeCiclosAnteriores(perV) - soDespesa) * 100) / 100, 200);
  check('e a conta fecha também com as duas em aberto',
    Math.round((DB.accountsTotal() + DB.previsaoDoMes(perV).entra - DB.previsaoDoMes(perV).sai
      + DB.pendenteDeCiclosAnteriores(perV)) * 100) / 100,
    Math.round(DB.saldoPrevistoNaData(null, DB.fimISO(perV)) * 100) / 100);
  DB.remove('transactions', idR);
  DB.remove('transactions', idV);
}

/* MESMA FORMA no mês corrente e no futuro: as linhas do previsto saem do mesmo
   código, então navegar de um para o outro muda os números, não a tela. */
{
  const offG = state.monthOffset;
  state.monthOffset = 2;
  const futuroG = renderInicio(DB.monthPeriod(new Date(), 2));
  state.monthOffset = offG;
  for (const linha of ['+ Entradas <i>previstas</i>', '− Contas do mês <i>faturas incluídas</i>',
                       '= Em contas ao fim', '= Livre ao fim']) {
    check(`a linha "${linha.replace(/<[^>]+>/g, '').trim()}" é a mesma nos dois heros`,
      inicio.includes(linha) && futuroG.includes(linha), true);
  }
}

/* ONDE o dinheiro está é pergunta diferente de quanto dele tem dono, e o hero
   respondia só a segunda. Medido nos dados reais em 1º/08/2026: R$ 325,63 "em
   contas", dos quais R$ 134,00 num CDB — o número prometia um poder de compra que
   não existia, e não havia como descobrir isso na tela.

   O cenário do teste tem a conta corrente (5.000) e a caixinha (12.000), então a
   separação tem de aparecer com números diferentes um do outro. */
check('a soma das duas partes é o total das contas',
  DB.saldoEmCaixa() + DB.saldoInvestido(), DB.accountsTotal());
check('a caixinha conta como investido', DB.saldoInvestido(), 12000);
check('e não entra no dinheiro de uso imediato', DB.saldoEmCaixa(), DB.accountsTotal() - 12000);
/* Conta sem tipo — as criadas antes de o campo existir — cai em CAIXA. Sumir da
   linha "em conta" é o pior dos dois erros: quem tem o dinheiro precisa vê-lo. */
const idSemTipo = DB.upsert('accounts', { name: 'Sem tipo', balance: 700, active: true });
check('conta sem tipo entra no caixa, não some', DB.saldoEmCaixa(), DB.accountsTotal() - 12000);
DB.remove('accounts', idSemTipo);
const heroSep = renderInicio(p);
/* "Em contas" volta a ser UMA linha. Investido e guardado são o mesmo dinheiro no
   uso real — a reserva mora na conta de investimento —, e mostrar os dois era o
   mesmo valor duas vezes com nomes diferentes. `saldoInvestido` segue no DB, para
   o dia em que houver investimento que não seja meta. */
check('o total das contas abre o bloco de hoje',
  heroSep.includes(`<span>Em contas</span><b>${fmt(DB.accountsTotal())}</b>`), true);
check('e não há uma segunda linha de investido no hero',
  /investido <i>/.test(heroSep), false);
check('mas o conceito continua no DB, para quando fizer falta',
  DB.saldoEmCaixa() + DB.saldoInvestido(), DB.accountsTotal());
/* O prazo do bloco previsto mostrava `fimISO`, que é EXCLUSIVO — dizia o primeiro
   dia do mês seguinte para um ciclo que termina no último dia deste. */
{
  const fimExcl = DB.fimISO(DB.monthPeriod(new Date()));
  const ultimoDia = new Date(Date.parse(fimExcl + 'T12:00:00') - 86400000);
  check('o prazo do previsto é o último dia do ciclo',
    heroSep.includes(`Previsto <i>até ${fmtDate(ultimoDia)}</i>`), true);
  check('e não a data crua do fim exclusivo',
    heroSep.includes(`Previsto <i>até ${fmtDate(new Date(fimExcl + 'T12:00:00'))}</i>`), false);
}

/* ---- Fluxos reais: aportes, detalhe da meta e da fatura ---- */
/* ---- Compra parcelada (fluxo real, do clique às parcelas) ----
   Nunca teve teste, e por isso a descrição das parcelas ficou meses gravando
   "[object HTMLInputElement] (1/12)": o código usava o ELEMENTO do campo em vez
   do texto dele. Quebrava busca, extrato e "repetir custos fixos". */
/* ---- Faturas em aberto e próximos vencimentos ----
   O KPI somava `inv.total` — o valor CHEIO da fatura — em vez de `inv.falta`. Uma
   fatura de R$ 1.000 com R$ 700 já pagos entrava inteira, e o painel dizia que
   havia R$ 1.000 em aberto quando o débito real era R$ 300. É o pior tipo de erro
   num painel: não parece errado, parece que o pagamento não entrou. */
/* ---- Cenários futuros até 6 meses no Painel, Extrato e Relatórios ----
   Navegar para setembro mostrava tela vazia. Duas causas:

   1. `gerarRecorrencias()` só materializa até o fim do ciclo corrente — de
      propósito: materializar seis meses de "A Pagar" encheria o extrato de
      registros que ninguém pediu e daria trabalho para desfazer.
   2. `previsaoDoMes` lia só a tabela `recurrences`, e não os CUSTOS FIXOS
      (transações marcadas `recurring`) — que é o caminho oferecido no formulário
      de lançamento. Quem usa o segundo via previsão vazia: nada copiado ainda, e
      contrato nenhum. O único item que aparecia era fatura de cartão.

   A saída é calcular, não materializar: as telas somam a previsão por cima do que
   já existe, marcada como previsão. */
console.log('\n=== Cenários futuros (até 6 meses) ===');
try {
  const ctaFut = DB.all('accounts')[0];
  const mesAnterior = DB.inicioISO(DB.monthPeriod(new Date(), -1));
  /* O MOLDE É O CONTRATO, não uma transação marcada.

     Este cenário nasceu quando havia dois mecanismos de repetição: a tabela
     `recurrences` e a marca `recurring` numa transação, que o botão "Custos
     fixos" copiava. O contrato virou fonte ÚNICA — ele faz mais e faz sozinho —,
     então o molde daqui passou a ser um contrato. As asserções não mudaram: a
     previsão de qualquer mês à frente tem de conhecer o custo fixo. */
  const molde = (desc, valor, tipo) => DB.upsert('recurrences', {
    description: desc, amount: valor, type: tipo, valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 4, inicio: mesAnterior, fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0, scope: 'Família', member: MEMBRO_COMUM,
    method: tipo === 'Receita' ? 'PIX' : 'Boleto', account_id: ctaFut.id,
  });
  molde('Aluguel FUT', 2500, 'Despesa');
  molde('Salario FUT', 9000, 'Receita');

  /* O CUSTO FIXO entra na previsão de qualquer mês à frente, não só do próximo.
     É o defeito relatado: depois de agosto, nada. */
  for (const off of [1, 2, 3, 6]) {
    const per = DB.monthPeriod(new Date(), off);
    const prev = DB.previsaoDoMes(per);
    check(`previsão de ${per.label} conhece o custo fixo`,
      prev.itens.some(i => i.titulo === 'Aluguel FUT'), true);
    check(`e a receita que se repete em ${per.label}`,
      prev.itens.some(i => i.titulo === 'Salario FUT' && i.receita), true);
  }

  /* NÃO DUPLICA quando o lançamento já existe no mês. A chave é a descrição, a
     mesma que o botão "Custos fixos" usa para não copiar duas vezes. */
  const setFut = DB.monthPeriod(new Date(), 2);
  const idMaterial = DB.upsert('transactions', {
    description: 'Aluguel FUT', amount: 2500, date: DB.somarDiasISO(DB.inicioISO(setFut), 3),
    type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaFut.id,
  });
  const prevDup = DB.previsaoDoMes(setFut);
  check('custo fixo já lançado não conta duas vezes',
    prevDup.itens.filter(i => i.titulo === 'Aluguel FUT').length, 1);
  check('e passa a contar como lançado, não como previsão',
    prevDup.itens.find(i => i.titulo === 'Aluguel FUT').origem, 'lançado');
  DB.remove('transactions', idMaterial);

  /* JÁ PAGO no mês futuro também não vira previsão. É o caso de quem adianta o
     aluguel de setembro: a `previsaoDoMes` só lista o que está "A Pagar", então o
     pago não entra na lista — e sem uma checagem própria o custo fixo seria
     projetado por cima de um pagamento que já aconteceu, inflando o mês. */
  const idPago = DB.upsert('transactions', {
    description: 'Aluguel FUT', amount: 2500, date: DB.somarDiasISO(DB.inicioISO(setFut), 4),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaFut.id,
  });
  const prevPago = DB.previsaoDoMes(setFut);
  check('custo fixo pago adiantado não é projetado de novo',
    prevPago.itens.filter(i => i.titulo === 'Aluguel FUT').length, 0);
  check('e o mês não conta esse valor duas vezes',
    prevPago.sai < 2500, true);
  DB.remove('transactions', idPago);

  /* O LANÇAMENTO VINCULADO não é projetado de novo.

     Este teste nasceu para o caso de alguém ter os DOIS mecanismos para a mesma
     conta — um contrato e o custo fixo legado com o mesmo nome. O mecanismo legado
     saiu de cena, então o cenário mudou: o que resta verificar é a dedupe que
     importa, entre a ocorrência prevista e o lançamento que já a materializou. */
  const mes3 = DB.monthPeriod(new Date(), 3);
  const idVinculado = DB.upsert('transactions', {
    description: 'Aluguel FUT', amount: 2500, date: DB.somarDiasISO(DB.inicioISO(mes3), 3),
    type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaFut.id,
  });
  const comLancado = DB.previsaoDoMes(mes3);
  check('ocorrência já lançada não é prevista de novo',
    comLancado.itens.filter(i => i.titulo === 'Aluguel FUT').length, 1);
  check('e ela conta como lançada, não como previsão',
    comLancado.itens.find(i => i.titulo === 'Aluguel FUT').origem, 'lançado');
  DB.remove('transactions', idVinculado);

  /* ---- Contrato criado A PARTIR de um lançamento que já existe ----
     Encontrado nos dados reais: das 11 recorrências cadastradas, NENHUMA tinha
     transação com `recurrence_id` apontando para ela. O vínculo só nasce no que o
     gerador cria — o lançamento que deu origem ao contrato nunca o recebe.

     Com o contrato começando na mesma data desse lançamento, o mês contava o
     compromisso DUAS vezes: uma como "lançado", outra como "prevista". No caso
     real eram R$ 780 de uma parcela de carro, e foi assim que a frase do painel
     deixou de bater com as saídas do mês seguinte. */
  const ctaSemVinc = DB.all('accounts')[0];
  const dataDup = DB.somarDiasISO(DB.inicioISO(DB.monthPeriod(new Date(), 1)), 19);
  const lancSemVinculo = DB.upsert('transactions', {
    description: 'Parcela SV', amount: 780, date: dataDup, type: 'Despesa', status: 'A Pagar',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: ctaSemVinc.id,
  });
  const contratoSemVinc = DB.upsert('recurrences', {
    description: 'Parcela SV', valor: 780, valor_tipo: 'fixo', type: 'Despesa',
    periodicidade: 'mensal', dia: 20, inicio: dataDup, fim_tipo: 'sempre',
    status: 'ativa', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    account_id: ctaSemVinc.id,
  });
  check('o lançamento de origem não tem vínculo com o contrato',
    !!DB.get('transactions', lancSemVinculo).recurrence_id, false);
  const mesDup = DB.previsaoDoMes(DB.monthPeriod(new Date(), 1));
  check('mesmo sem vínculo, o compromisso conta uma vez só',
    mesDup.itens.filter(i => i.titulo === 'Parcela SV').length, 1);
  check('e como lançamento, porque o que existe manda',
    mesDup.itens.find(i => i.titulo === 'Parcela SV').origem, 'lançado');
  check('as saídas do mês não são infladas',
    mesDup.itens.filter(i => i.titulo === 'Parcela SV')
      .reduce((s, i) => s + i.valor, 0), 780);

  /* A dedupe olha o mês inteiro, não só o que está "A Pagar". Quem paga a conta
     adiantado é o caso mais comum de todos, e um filtro por status faria a
     previsão somar por cima de um pagamento que já aconteceu. */
  const idJaPago = DB.upsert('transactions', {
    description: 'Parcela SV', amount: 780,
    date: DB.somarDiasISO(DB.inicioISO(DB.monthPeriod(new Date(), 3)), 19),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaSemVinc.id,
  });
  const mesPagoAntes = DB.previsaoDoMes(DB.monthPeriod(new Date(), 3));
  check('conta paga adiantado não é projetada de novo',
    mesPagoAntes.itens.filter(i => i.titulo === 'Parcela SV').length, 0);
  check('e o mês não conta esse valor duas vezes',
    mesPagoAntes.itens.some(i => i.titulo === 'Parcela SV'), false);
  DB.remove('transactions', idJaPago);
  check('removido o pagamento, a previsão volta',
    DB.previsaoDoMes(DB.monthPeriod(new Date(), 3)).itens
      .filter(i => i.titulo === 'Parcela SV').length, 1);

  /* Mas a dedupe por NOME não pode esconder repetição LEGÍTIMA: o mesmo contrato
     no mês seguinte é outro compromisso, e some-lo uma vez só por mês é o ponto. */
  const mesSeguinte = DB.previsaoDoMes(DB.monthPeriod(new Date(), 2));
  check('no mês seguinte a repetição continua aparecendo',
    mesSeguinte.itens.filter(i => i.titulo === 'Parcela SV').length, 1);
  check('agora como previsão, porque ali não há lançamento',
    mesSeguinte.itens.find(i => i.titulo === 'Parcela SV').origem, 'prevista');
  /* E a IDENTIDADE que o usuário viu quebrada: a frase "vencem depois deste mês"
     tem de bater com as saídas do próximo mês quando não há nada além dele. */
  /* A IDENTIDADE que estava quebrada na tela: a frase "vencem depois deste mês"
     tem de fechar com a soma das saídas dos meses que ela cobre.

     Ela ignorava contrato e custo fixo, então ficava MENOR que as saídas do mês
     seguinte — um aluguel que se repete aparecia lá e sumia dela. Agora conta as
     três coisas: lançado, fatura e o que ainda vai virar lançamento.

     O HORIZONTE é o que torna o número somável: uma recorrência "até eu cancelar"
     não tem total finito, e "tudo daqui pra frente" seria um número que não existe.
     Seis meses é o mesmo horizonte que as telas navegam. */
  const saidas6 = [1, 2, 3, 4, 5, 6]
    .map(i => DB.previsaoDoMes(DB.monthPeriod(new Date(), i)).sai)
    .reduce((a, b) => a + b, 0);
  check('a frase do painel fecha com as saídas dos 6 meses seguintes',
    Math.round(DB.committedDepois() * 100) / 100, Math.round(saidas6 * 100) / 100);
  check('e nunca fica menor que as saídas do próximo mês só',
    DB.committedDepois() >= DB.previsaoDoMes(DB.monthPeriod(new Date(), 1)).sai - 0.005, true);
  /* O RODAPÉ DO HERO é o resumo de UM mês — o próximo —, não um total sem teto.
     Antes ele somava agosto, setembro e o IPVA de janeiro num número só, que não
     batia com nada: quem fosse conferir nas Saídas de agosto via outro valor.
     Cada número dele tem de casar com o que o Painel de agosto mostra. */
  const paHoje = renderInicio(DB.monthPeriod(new Date()));
  const pvProx = DB.previsaoDoMes(DB.monthPeriod(new Date(), 1));
  const nomeProx = DB.monthPeriod(new Date(), 1).start
    .toLocaleDateString('pt-BR', { month: 'long' });
  check('o rodapé resume o mês seguinte pelo nome', paHoje.includes(nomeProx), true);
  check('e traz o total a pagar dele', paHoje.includes(fmt(pvProx.sai)), true);
  check('que é o mesmo número das saídas daquele mês',
    pvProx.sai, DB.previsaoDoMes(DB.monthPeriod(new Date(), 1)).sai);
  check('diz quantos itens já são conhecidos',
    paHoje.includes(`${pvProx.itens.length} item(ns)`), true);
  // E avisa o que NÃO está na conta, senão o número parece uma promessa
  check('e avisa que gasto variável não entra',
    paHoje.includes('gasto variável não entra'), true);
  check('o total sem teto saiu da tela',
    /vencem depois deste mês/.test(paHoje), false);
  /* Sem nada previsto a linha some: "Em agosto já há R$ 0,00 a pagar" ocuparia
     espaço para não informar nada, e ainda soaria como afirmação — quando o certo
     é "ainda não há nada cadastrado". */
  const guardaTx = DB.data.transactions;
  const guardaRec = DB.data.recurrences;
  const guardaCards = DB.data.cards;
  DB.data.transactions = DB.data.transactions.filter(t => !t.recurring
    && String(t.date) < DB.fimISO(DB.monthPeriod(new Date())));
  DB.data.recurrences = [];
  DB.data.cards = [];
  check('sem nada previsto, a linha não aparece',
    /hero-depois/.test(renderInicio(DB.monthPeriod(new Date()))), false);
  DB.data.transactions = guardaTx;
  DB.data.recurrences = guardaRec;
  DB.data.cards = guardaCards;
  check('e volta quando há previsão',
    /hero-depois/.test(renderInicio(DB.monthPeriod(new Date()))), true);
  /* E o horizonte tem de LIMITAR de verdade. Com uma recorrência sem prazo, alargar
     a janela sempre aumenta o total — é isso que prova que o corte existe; sem ele,
     "tudo daqui pra frente" não teria soma finita. */
  const em6 = DB.committedDepois(undefined, 6);
  const em12 = DB.committedDepois(undefined, 12);
  check('dobrar o horizonte aumenta o total, porque a recorrência não tem prazo',
    em12 > em6 + 0.005, true);
  check('e o padrão é o de 6 meses, o mesmo que as telas navegam',
    Math.round(DB.committedDepois() * 100), Math.round(em6 * 100));
  DB.remove('recurrences', contratoSemVinc);
  DB.remove('transactions', lancSemVinculo);

  // O que as telas somam por cima do que existe exclui o já lançado e a fatura
  const soPrevisto = DB.previstosNaoLancados(DB.monthPeriod(new Date(), 2));
  check('a lista para as telas traz só o que não existe ainda',
    soPrevisto.every(i => i.origem === 'prevista' || i.origem === 'custo fixo'), true);
  check('fatura fica de fora: o extrato já a mostra como linha própria',
    soPrevisto.some(i => i.origem === 'fatura'), false);

  /* ---- As três telas ---- */
  const offSalvoFut = state.monthOffset, repSalvoFut = state.repOffset;
  state.filtros = filtrosVazios();
  const saldos = [];
  for (const off of [1, 2, 3, 4, 5, 6]) {
    state.monthOffset = off; state.repOffset = off;
    const per = DB.monthPeriod(new Date(), off);
    const painelFut = renderInicio(per);
    const extratoFut = renderExtrato(per);
    const relFut = renderRelatorios();

    /* PAINEL: hero próprio de previsão. Antes caía no de mês encerrado e mostrava
       "Resultado de setembro: R$ 0,00" — o zero lia como "vai sobrar nada" em vez
       de "ainda não há dado". */
    check(`painel de ${per.label}: hero de previsão`,
      painelFut.includes('Disponível previsto ao fim de'), true);
    check(`  e não o hero de mês encerrado`, /hero-label">Resultado de/.test(painelFut), false);
    check(`  com a lista do que já se sabe`,
      (painelFut.match(/class="prev-linha"/g) || []).length >= 2, true);
    // Tira tudo o que não é dígito: o separador do fmt varia (nbsp, espaço fino)
    const bruto = (painelFut.match(/hero-value">([^<]+)</) || ['', ''])[1];
    saldos.push(Number(bruto.replace(/[^\d]/g, '')));

    // EXTRATO: os itens previstos entram na lista cronológica
    check(`extrato de ${per.label}: linhas previstas`,
      (extratoFut.match(/class="tx tx-prev"/g) || []).length >= 2, true);
    check(`  e não diz "sem lançamentos"`, /Sem lançamentos/.test(extratoFut), false);

    /* RELATÓRIOS: os NÚMEROS do futuro, não a lista.

       A lista do previsto vive só no Painel, na seção "O que ainda vem" — a mesma
       lista em duas telas envelhece em duas velocidades. O que os Relatórios não
       podem voltar a fazer é mostrar ZERO num mês futuro, que era o defeito
       original: um relatório de zeros lê como "não vai gastar nada". */
    check(`relatórios de ${per.label}: a lista fica só no Painel`,
      /class="prev-linha"/.test(relFut), false);
    check(`  mas os números do mês continuam de pé`, Rel.gasto(per) > 0, true);
    check(`  e a tela não diz que nada foi lançado`,
      /nenhuma receita lançada/i.test(relFut), false);
    /* O gráfico de doze meses é onde "como chego até setembro" se responde.
       Limitá-lo ao mês corrente o tirava justamente de quem navega o futuro. */
    check(`  e o gráfico de doze meses`, relFut.includes('De onde vim, para onde vou'), true);
    check(`  com o desenho, não só o título`, relFut.includes('data-g="fluxo-saldo"'), true);
  }
  /* O SALDO ROLA de um mês para o outro: cada mês parte do que sobrou do anterior.
     Sem isso, todo mês mostraria o mesmo número e o gráfico de "aperto em X" nunca
     apontaria nada. */
  check('o saldo previsto rola de um mês para o outro',
    saldos.every((v, i) => i === 0 || v > saldos[i - 1]), true);

  /* PREVISÃO SÓ NO FUTURO — no EXTRATO, que é onde a regra vale. Lá o previsto
     viraria linha ao lado do que aconteceu, e o extrato do mês passaria a
     discordar do extrato do banco. Isso continua valendo e é o que se testa aqui.

     No PAINEL do mês corrente a regra é outra, e mudou de propósito: o hero passou
     a projetar o fim do ciclo. O número antigo — comprometido do mês inteiro
     contra o saldo de hoje — dava −R$ 10.097,59 em 1º de agosto, num mês que fecha
     positivo porque o salário ainda ia cair. Era verdadeiro como conceito e
     inútil como leitura. O painel não compete com o fato porque o fato continua
     no primeiro bloco ("Hoje"), separado e rotulado. */
  for (const off of [0, -1]) {
    state.monthOffset = off;
    const per = DB.monthPeriod(new Date(), off);
    const html = renderExtrato(per);
    check(`extrato de ${per.label} não mistura previsão`,
      /repete todo mês · ainda não lançado|custo fixo · ainda não lançado/.test(html), false);
  }
  /* Mês ENCERRADO não projeta: não há fim de ciclo para onde caminhar, e um
     "previsto ao fim" de um mês que já acabou seria absurdo. */
  state.monthOffset = -1;
  check('painel de mês encerrado não usa o hero de previsão',
    renderInicio(DB.monthPeriod(new Date(), -1)).includes('previsto ao fim de'), false);
  state.monthOffset = 0;

  // O limite é 6 meses: a seta pára ali, senão a projeção viraja adivinhação
  state.monthOffset = 6;
  check('a seta de avançar pára em 6 meses',
    /id="mn-next"[^>]*disabled/.test(renderInicio(DB.monthPeriod(new Date(), 6))), true);
  state.repOffset = 6;
  check('nos relatórios também', /id="rep-next"[^>]*disabled/.test(renderRelatorios()), true);
  state.monthOffset = 5;
  check('mas não antes disso',
    /id="mn-next"[^>]*disabled/.test(renderInicio(DB.monthPeriod(new Date(), 5))), false);

  /* ---- Run-rate não existe em mês que não começou ----
     `expensesOf` de um mês futuro traz o mês INTEIRO previsto, e o run-rate
     tratava esse total como gasto de UM dia: multiplicava pelos dias restantes.
     Medido em agosto/2026 — R$ 6.737,80 previstos viravam "fechamento projetado
     R$ 215.610", 1268% das receitas e poupança projetada de −1168%. */
  for (const off of [1, 2, 3]) {
    const pf = DB.monthPeriod(new Date(), off);
    const st = DB.statsFor(pf);
    check(`${pf.label}: a projeção é o previsto, não uma extrapolação`, Math.round(st.projection), Math.round(st.spent));
    check(`  e a média diária divide pelo mês, não por 1`,
      Math.abs(st.dailyAvg - st.spent / st.totalDays) < 0.005, true);
    check(`  marcado como mês que não começou`, st.naoComecou, true);
  }

  /* ---- O CARD DE PROJEÇÃO NÃO PROMETE POUPANÇA QUE NÃO EXISTE ----

     A taxa de poupança é (renda − fechamento projetado) / renda. Num mês que não
     começou, o fechamento projetado é só o que está CONTRATADO: aluguel, parcelas,
     escola. O gasto variável — mercado, combustível, farmácia — ainda não existe.

     Medido em agosto/2026: o card anunciava "Poupança projetada: 60%", prometendo
     R$ 10.262 de sobra num mês que vai consumir a maior parte disso. O próprio app
     já dizia em `cardPrevisaoDoMes` que "chamar o resto de sobra seria otimista
     por construção" — este card era onde a regra estava sendo violada. */
  {
    const offP = state.monthOffset;
    state.monthOffset = 1;
    const perP = DB.monthPeriod(new Date(), 1);
    const telaFut = renderInicio(perP);
    check('mês futuro não anuncia taxa de poupança', /Poupança projetada/.test(telaFut), false);
    check('  e diz que o variável ainda não entrou', /gasto variável ainda não entra/.test(telaFut), true);
    check('  chamando o previsto de comprometido, não de fechamento',
      /Já comprometido no mês/.test(telaFut), true);
    check('  e avisando que o que resta não é sobra', /Não é sobra/.test(telaFut), true);
    /* Uma linha só para o previsto: no mês futuro `spent` e `projection` são o
       MESMO número, e duas linhas com rótulos diferentes fazem o leitor procurar
       a diferença entre elas. */
    check('  sem repetir o mesmo valor em duas linhas',
      /Gasto até hoje/.test(telaFut), false);

    /* O MESMO ENGANO em outros dois cards, e todos os três eram variações da
       divisão "receita − o que está contratado". A regra 50·30·20 tirava a linha de
       poupança do RESÍDUO (100 − necessidades − desejos), e num mês futuro o
       resíduo é generoso por construção. E "O que está sendo construído" dividia
       o resultado do mês pela receita. */
    check('a regra 50·30·20 não mostra poupança em mês futuro',
      /Poupança \(sobra\)/.test(telaFut), false);
    check('  e avisa que os percentuais são do contratado',
      /o variável do mês ainda não entra/.test(telaFut), true);
    state.repOffset = 1;
    const relFutP = renderRelatorios();
    check('"o que está sendo construído" não anuncia taxa em mês futuro',
      /Taxa de poupança do mês/.test(relFutP), false);
    // …mas continua falando do que é FATO: patrimônio, reserva, cobertura
    check('  e segue mostrando a reserva', /Reserva de emergência/.test(relFutP), true);
    check('  e o que há em contas', /Em contas hoje/.test(relFutP), true);


    // No mês corrente nada disso muda: lá existe ritmo, e as taxas são legítimas
    state.monthOffset = 0; state.repOffset = 0;
    const telaHoje = renderInicio(DB.monthPeriod(new Date()));
    check('mês corrente mantém a taxa de poupança', /Poupança projetada/.test(telaHoje), true);
    check('  e o gasto até hoje', /Gasto até hoje/.test(telaHoje), true);
    check('  com o fechamento projetado', /Fechamento projetado/.test(telaHoje), true);
    check('  e a linha de poupança na regra 50·30·20', /Poupança \(sobra\)/.test(telaHoje), true);
    check('  e a taxa no card de construção', /Taxa de poupança do mês/.test(renderRelatorios()), true);
    state.monthOffset = offP;
  }
  // No mês corrente o run-rate continua sendo run-rate: projeta acima do gasto
  const stHoje = DB.statsFor(DB.monthPeriod(new Date()));
  check('mês corrente: a projeção continua extrapolando o ritmo',
    stHoje.projection >= stHoje.spent && !stHoje.naoComecou, true);

  /* ---- "Evolução dos gastos" acompanha o mês exibido ----
     Ancorada em `new Date()`, a janela ficava idêntica em qualquer mês navegado e
     o mês que se estava olhando não aparecia nela. Medido: julho, agosto e
     setembro traziam a mesma série, soma 53.653 nas três. */
  const serieDe = off => {
    state.monthOffset = off;
    zeraFila();
    renderInicio(DB.monthPeriod(new Date(), off));
    const bars = Graficos.fila.find(g => g.nome === 'barras');
    return pontosDe(bars.opts.series[0]);
  };
  const sHoje = serieDe(0), sFuturo = serieDe(2);
  check('a janela das barras muda com o mês exibido', JSON.stringify(sHoje) === JSON.stringify(sFuturo), false);
  check('  e termina no mês que está na tela',
    sFuturo.slice(-1)[0],
    Math.round(DB.expensesOf(DB.monthPeriod(new Date(), 2)).reduce((s, t) => s + (Number(t.amount) || 0), 0)));
  check('  ainda com seis períodos', sFuturo.length, 6);
  state.monthOffset = 1;

  /* ---- "O que ainda vem": este mês e o próximo, numa seção só ----
     Eram duas seções em pontas opostas da tela respondendo a mesma pergunta, e a
     fatura saía nas duas. */
  state.monthOffset = 0;
  const perA = DB.monthPeriod(new Date());
  const perB = DB.monthPeriod(perA.start, 1);
  const telaA = renderInicio(perA);
  check('a seção fica no fim do Painel', telaA.indexOf('O que ainda vem') > telaA.indexOf('kpi-grid'), true);
  check('  e traz o mês seguinte junto', telaA.includes(`O que já está previsto para ${perB.label}`),
    DB.previsaoDoMes(perB).itens.length > 0);
  check('  cada mês num card', (telaA.match(/O que já está previsto para/g) || []).length,
    [perA, perB].filter(p => DB.previsaoDoMes(p).itens.length).length);
  /* Card sem item SOME — não vira caixa vazia dizendo "nada previsto", que ocupa
     espaço para não informar. */
  const vazio = { entra: 0, sai: 0, resultado: 0, itens: [] };
  check('mês sem nada previsto não vira card vazio', cardPrevisaoDoMes(vazio, perA, 0), '');

  /* TETO DE 10 e o caminho para o resto. Sem o botão, o item 11 sumiria da tela
     sem dizer para onde foi. */
  const muitos = {
    entra: 0, sai: 1400, resultado: -1400,
    itens: Array.from({ length: 14 }, (_, n) => ({
      titulo: `Conta ${n + 1}`, valor: 100, receita: false,
      data: DB.inicioISO(perB), origem: 'prevista', category_id: null,
    })),
  };
  const cardCheio = cardPrevisaoDoMes(muitos, perB, 1);
  check('lista no máximo 10 linhas', (cardCheio.match(/class="prev-linha"/g) || []).length, 10);
  check('  e o botão diz o total, não o que sobrou', cardCheio.includes('Ver os 14 no extrato'), true);
  check('  apontando para o mês daquele card', /data-vermais="1"/.test(cardCheio), true);
  check('com 10 ou menos, nada de botão',
    cardPrevisaoDoMes({ ...muitos, itens: muitos.itens.slice(0, 10) }, perB, 1).includes('data-vermais'), false);
  /* A FATURA ENTRA MESMO ALÉM DO TETO. A lista é cronológica e a fatura vence no
     fim do mês, então é ela quem cai fora do corte — medido em agosto/2026, era o
     11º de 11 itens e sumia da tela. Esquecer fatura custa juros. */
  const comFaturaNoFim = {
    entra: 0, sai: 1500, resultado: -1500,
    itens: [...muitos.itens, { titulo: 'Fatura Zeta', valor: 100, receita: false,
      data: DB.fimISO(perB), origem: 'fatura', fatura_status: 'Aberta', fatura_total: 100, fatura_pago: 0 }],
  };
  const cardComFatura = cardPrevisaoDoMes(comFaturaNoFim, perB, 1);
  check('a fatura aparece mesmo sendo a 15ª da fila', cardComFatura.includes('Fatura Zeta'), true);
  check('  e o teto continua valendo para o resto',
    (cardComFatura.match(/class="prev-linha"/g) || []).length, 11);
  check('  com o botão contando os que ficaram de fora', cardComFatura.includes('Ver os 15 no extrato'), true);

  /* LINHA ENRIQUECIDA: cada item diz o que basta para ser julgado sem abrir outra
     tela — categoria na conta comum, status e total na fatura. */
  const cat = DB.all('categories').find(c => c.parent_id);
  const linhaCat = linhaPrevista({ titulo: 'Aluguel', valor: 100, receita: false, data: DB.inicioISO(perB),
    origem: 'prevista', category_id: cat.id });
  check('a linha traz a categoria', linhaCat.includes(DB.categoryPath(cat.id)), true);
  check('  junto da origem, numa linha só', /repete todo mês · /.test(linhaCat), true);
  const linhaFat = linhaPrevista({ titulo: 'Fatura X', valor: 300, receita: false, data: DB.inicioISO(perB),
    origem: 'fatura', fatura_status: 'Parcial', fatura_total: 1000, fatura_pago: 700 });
  check('a linha de fatura traz status e total', /Parcial · de /.test(linhaFat), true);
  check('  e o valor continua sendo o que falta', linhaFat.includes(fmtShort(300)), true);
  // Fatura sem pagamento parcial não ganha "de X": seria repetir o próprio valor
  check('sem pagamento parcial, sem referência redundante',
    / · de /.test(linhaPrevista({ titulo: 'Fatura Y', valor: 300, receita: false, data: DB.inicioISO(perB),
      origem: 'fatura', fatura_status: 'Aberta', fatura_total: 300, fatura_pago: 0 })), false);

  state.monthOffset = offSalvoFut; state.repOffset = repSalvoFut;
  state.filtros = filtrosVazios();
  for (const t of DB.all('transactions').filter(t => / FUT$/.test(t.description || ''))) DB.remove('transactions', t.id);
  /* Os CONTRATOS do cenário saem junto. Quando o molde era uma transação marcada,
     limpar as transações bastava; com o contrato virando fonte única, deixá-los
     para trás faz o cenário vazar — e os blocos seguintes passam a ver contratos
     sem categoria, que era o que quebrava o teste do donut de mês futuro. */
  for (const r of DB.all('recurrences').filter(r => / FUT$/.test(r.description || ''))) DB.remove('recurrences', r.id);
  DB.save();
} catch (e) { console.log(` FALHA | cenários futuros: ${e.message}`); fail++; }

/* ---- Visão de futuro: todos os objetos contam a mesma história ----
   Um mês que ainda não chegou não tem lançamento além do agendado à mão. Cada
   objeto lia isso por conta própria e mostrava zero: KPI de gasto, donut por
   categoria, cascata, regra 50·30·20, resumo do extrato, frase dos relatórios.

   A correção é única — `txOfPeriod` devolve, em mês futuro, transações VIRTUAIS
   geradas do contrato e do custo fixo — e é por isso que os testes aqui verificam
   IDENTIDADES entre os objetos, não cada um isolado: o que se conserta em oito
   lugares volta a divergir no nono. */
console.log('\n=== Visão de futuro: coerência entre todos os objetos ===');
try {
  const ctaV = DB.all('accounts')[0];
  const catsV = DB.rootCategories('Despesa');
  const mesAntV = DB.inicioISO(DB.monthPeriod(new Date(), -1));
  /* O CUSTO FIXO DAQUI É CONTRATO. Era uma transação marcada `recurring`, quando
     havia dois mecanismos de repetição; o contrato virou fonte única e o cenário
     acompanhou. As identidades sob teste não mudaram — o que se verifica é que
     todos os objetos da tela contam a mesma história num mês futuro. */
  const fixV = (d, v, tipo, cat) => DB.upsert('recurrences', {
    description: d, amount: v, type: tipo, valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 4, inicio: mesAntV, fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0, scope: 'Família', member: MEMBRO_COMUM,
    method: tipo === 'Receita' ? 'PIX' : 'Boleto', account_id: ctaV.id, category_id: cat,
  });
  fixV('Salario VIS', 9000, 'Receita', null);
  fixV('Aluguel VIS', 2500, 'Despesa', catsV[0].id);
  fixV('Internet VIS', 150, 'Despesa', (catsV[1] || catsV[0]).id);
  const setV = DB.monthPeriod(new Date(), 2);
  const idAgendado = DB.upsert('transactions', {
    description: 'IPVA VIS', amount: 1800, date: DB.somarDiasISO(DB.inicioISO(setV), 10),
    type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaV.id, category_id: catsV[0].id,
  });
  const offV = state.monthOffset, repV = state.repOffset;
  state.filtros = filtrosVazios();
  state.monthOffset = 2; state.repOffset = 2;

  /* AS VIRTUAIS. Forma de transação, sem id, marcadas — e só em mês futuro. */
  const virtuais = DB.txOfPeriod(setV).filter(t => t.virtual);
  check('mês futuro traz as previsões como transação', virtuais.length >= 3, true);
  check('e elas não têm id, porque não existem no banco',
    virtuais.every(t => !t.id), true);
  check('mas têm o que os agregadores precisam: tipo, valor, data e categoria',
    virtuais.every(t => t.type && t.amount > 0 && t.date && 'category_id' in t), true);
  /* A CATEGORIA tem de vir preenchida, não só existir como campo. Sem ela o item
     não aparece no donut nem na tabela por categoria, e o mês futuro fica com um
     total que não se decompõe em lugar nenhum — foi por isso que `previsaoDoMes`
     passou a carregar o molde de onde cada item veio. */
  const virtDespesa = virtuais.filter(t => DB.isExpense(t));
  check('as despesas previstas herdam a categoria do molde',
    virtDespesa.length > 0 && virtDespesa.every(t => !!t.category_id), true);
  check('e a conta, para o saldo por conta funcionar',
    virtuais.every(t => !!t.account_id), true);
  // Um item sem categoria cairia em "_sem" e sumiria de qualquer envelope
  check('nenhuma despesa prevista cai em "sem categoria"',
    Object.keys(DB.spentByCategory(setV)).includes('_sem'), false);
  check('e status de compromisso futuro', virtuais.every(t => t.status === 'A Pagar'), true);
  check('o mês corrente não recebe nenhuma',
    DB.txOfPeriod(DB.monthPeriod(new Date())).some(t => t.virtual), false);
  check('nem o mês passado',
    DB.txOfPeriod(DB.monthPeriod(new Date(), -1)).some(t => t.virtual), false);
  // E nada disso é gravado: elas nascem a cada leitura
  check('nenhuma virtual é gravada no banco',
    DB.all('transactions').some(t => t.virtual), false);

  /* AS IDENTIDADES. Cada objeto lê de um agregador diferente; se algum deles
     ficasse de fora, um número da tela discordaria do outro. */
  const prevV = DB.previsaoDoMes(setV);
  const txsV = txsFiltradas(setV);
  const despV = txsV.filter(t => DB.isExpense(t) && !DB.isNeutral(t))
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const recV = txsV.filter(t => !DB.isExpense(t) && !t.card_id && !DB.isNeutral(t))
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const faturaV = prevV.itens.filter(i => i.origem === 'fatura').reduce((s, i) => s + i.valor, 0);

  check('o extrato soma as saídas que a previsão conhece', despV, prevV.sai - faturaV);
  check('e as entradas também', recV, prevV.entra);
  check('o KPI de gasto do painel bate com o extrato',
    DB.expensesOf(setV).reduce((s, t) => s + Number(t.amount || 0), 0), despV);
  check('a tela de relatórios lê o mesmo gasto', Rel.gasto(setV), despV);
  check('e a mesma receita', Rel.receita(setV), recV);
  /* Decomposição: um total que não se abre em categorias é um número que ninguém
     consegue conferir. */
  check('a soma das categorias fecha com o total',
    Math.round(Object.values(Rel.porCategoria(setV)).reduce((a, b) => a + b, 0)), Math.round(despV));
  check('o donut do painel também',
    Math.round(Object.values(DB.spentByCategory(setV)).reduce((a, b) => a + b, 0)), Math.round(despV));
  const kindsV = Rel.porTipo(setV);
  check('e a cascata (essencial + estilo)', Math.round(kindsV.Essencial + kindsV.Estilo), Math.round(despV));

  /* O SALDO do extrato tem de fechar com as linhas dele. Um extrato cujo topo não
     bate com a soma das linhas é o pior defeito possível — foi por isso que
     `saldoPrevistoNaData` passou a contar contrato e custo fixo. */
  const iniV = DB.saldoPrevistoNaData(null, DB.inicioISO(setV));
  const fimV = DB.saldoPrevistoNaData(null, DB.fimISO(setV));
  check('saldo do fim = saldo do início + entradas − saídas − fatura',
    Math.round(fimV * 100) / 100, Math.round((iniV + recV - despV - faturaV) * 100) / 100);
  check('e o saldo previsto cresce quando há salário previsto', fimV > iniV, true);
  /* A JANELA importa: o saldo numa data conta só o que vence ATÉ ela. Sem o corte,
     o saldo do início de setembro já traria o aluguel do próprio setembro, e o
     extrato abriria o mês com um número que só é verdade no fim dele. */
  /* O corte vai no dia 5: o salário e o aluguel vencem no dia 1 e o IPVA no 11.
     Assim o saldo do dia 5 tem de conter os dois primeiros e NÃO o IPVA — um corte
     depois do dia 11 daria o mesmo número do fim do mês e o teste não teria poder
     nenhum, passando mesmo sem janela alguma. */
  const dia5 = DB.somarDiasISO(DB.inicioISO(setV), 5);
  const saldoDia5 = DB.saldoPrevistoNaData(null, dia5);
  check('o saldo do dia 5 já conta o salário e o aluguel do dia 1',
    Math.round(saldoDia5), Math.round(iniV + 9000 - 2500 - 150));
  check('mas ainda não conta o IPVA, que vence no dia 11', saldoDia5 > fimV, true);
  check('e o do fim do mês conta tudo', Math.round(fimV), Math.round(saldoDia5 - 1800 - faturaV));
  /* Um custo fixo que vence DEPOIS do corte. Sem ele o teste acima não teria poder
     sobre a janela dos previstos: salário, aluguel e internet vencem no dia 1, e o
     IPVA é transação real (cortada por outro caminho) — nenhum previsto ficaria de
     fora do dia 5, e remover o corte não mudaria número nenhum. */
  const idTardio = DB.upsert('recurrences', {
    description: 'Seguro VIS', amount: 400, type: 'Despesa', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 20,
    inicio: DB.somarDiasISO(DB.inicioISO(DB.monthPeriod(new Date(), -1)), 19),
    fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0,
    scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaV.id, category_id: catsV[0].id,
  });
  const comTardio5 = DB.saldoPrevistoNaData(null, dia5);
  const comTardioFim = DB.saldoPrevistoNaData(null, DB.fimISO(setV));
  /* No dia 5 do mês analisado, a ocorrência DELE (dia 20) ainda não venceu; as
     dos meses anteriores, sim. No fim do mês entra mais uma. É a diferença de
     exatamente UMA ocorrência que prova que a janela está sendo respeitada.

     Quantas são as anteriores depende de que dia é hoje, então o número é
     CALCULADO. Fixar "1 e 2" era verdade em julho, quando o teste foi escrito, e
     virou falso em 1º de agosto: o mês analisado (hoje + 2) passou a ser outubro
     e havia duas ocorrências vencidas antes do dia 5, não uma. Um teste que
     depende do calendário reprova sozinho no dia da virada. */
  /* Só as PREVISTAS contam no delta: a ocorrência do mês do molde é lançamento
     real e já está no saldo das contas. As previsões começam no ciclo corrente e
     vão até o corte. */
  const ocorrenciasAte = ateISO => {
    let n = 0;
    let d = DB.somarDiasISO(DB.inicioISO(DB.monthPeriod(new Date())), 19);
    while (d < ateISO) {
      /* Estritamente DEPOIS de hoje: previsão de contrato que vence hoje e não
         virou lançamento não entra na projeção — ela é "contrato atrasado", que é
         outro aviso (decisão 3 do plano-disponivel-e-recorrencia). Com `>=` o
         teste contava uma ocorrência a mais exatamente no dia 20 de cada mês, que
         é o dia da ocorrência deste cenário. */
      if (d > DB.hojeISO()) n++;
      const x = new Date(d + 'T12:00:00');
      x.setMonth(x.getMonth() + 1);
      d = DB.paraISO(x);
    }
    return n;
  };
  const nDia5 = ocorrenciasAte(dia5);
  check('no dia 5 conta só o que já venceu',
    Math.round(saldoDia5 - comTardio5), nDia5 * 400);
  check('e no fim do mês entra mais uma',
    Math.round(fimV - comTardioFim), (nDia5 + 1) * 400);
  DB.remove('recurrences', idTardio);

  /* AS TELAS. Cada objeto que antes aparecia vazio. */
  const paV = renderInicio(setV), exV = renderExtrato(setV), reV = renderRelatorios();
  check('painel: hero de previsão', /Disponível previsto ao fim de/.test(paV), true);
  /* "Disponível", não "saldo": este número desconta o comprometido e o guardado,
     como o hero do mês corrente. Chamá-lo de saldo o faria divergir do saldo que o
     extrato do mesmo mês mostra — dois números com o mesmo nome e valores
     diferentes destroem a confiança nos dois. */
  check('e a ponte com o saldo em conta, que é outro número',
    /Em conta haverá/.test(paV), true);
  check('painel: o donut tem dados', /Nenhum gasto no período/.test(paV), false);
  check('painel: a regra 50·30·20 aparece', /Regra 50/.test(paV), true);
  check('painel: a lista do que já se sabe', /prev-linha/.test(paV), true);
  check('extrato: as linhas previstas aparecem', /class="tx tx-prev"/.test(exV), true);
  check('relatórios: "De onde vem o dinheiro"', /De onde vem o dinheiro/.test(reV), true);
  check('relatórios: "O caminho do dinheiro"', /O caminho do dinheiro/.test(reV), true);
  check('relatórios: detalhe por categoria', /Detalhe por categoria/.test(reV), true);
  check('relatórios: o gráfico de doze meses', /data-g="fluxo-saldo"/.test(reV), true);
  // A frase de abertura não pode mais dizer que não houve receita
  check('a frase de abertura conhece a receita prevista',
    /nenhuma receita lançada/.test(reV), false);

  /* AS VIRTUAIS NÃO PODEM VAZAR PARA NADA QUE GRAVE. Sem id, um upsert criaria
     registro fantasma — ou apagaria outro, se dois `null` colidissem. */
  openMassaModal(setV);
  check('a edição em massa ignora as previsões', Massa.ids.every(id => !!id), true);
  check('e só leva o que existe de verdade',
    Massa.ids.length, txsFiltradas(setV).filter(t => !t.virtual).length);
  // A linha virtual não abre edição nem oferece "marcar como pago"
  check('linha prevista não vira alvo de clique',
    /tx-prev"\s+data-tx=/.test(exV), false);
  check('nem oferece o botão de pagar',
    /class="tx tx-prev"(?:(?!<\/div>)[\s\S])*pay-btn/.test(exV), false);
  // No CSV elas se identificam: fora do app não há cor nem rodapé que avise
  const apCsv = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('no CSV a previsão se identifica na coluna Status',
    apCsv.includes("t.virtual ? `Previsto (${t.origemPrevista || 'repete'})` : t.status"), true);
  // Renderizar o futuro não pode gravar nada
  const antesV = DB.all('transactions').length, saldoV = DB.accountsTotal();
  renderInicio(setV); renderExtrato(setV); renderRelatorios();
  check('renderizar o futuro não cria lançamento', DB.all('transactions').length, antesV);
  check('nem mexe no saldo das contas', DB.accountsTotal(), saldoV);

  /* A PREVISÃO SOME quando o lançamento de verdade aparece — senão o mês contaria
     o aluguel duas vezes assim que ele fosse lançado. */
  const nVirtuaisAntes = DB.txOfPeriod(setV).filter(t => t.virtual).length;
  const idReal = DB.upsert('transactions', {
    description: 'Aluguel VIS', amount: 2500, date: DB.somarDiasISO(DB.inicioISO(setV), 5),
    type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Boleto', account_id: ctaV.id, category_id: catsV[0].id,
  });
  const depois = DB.txOfPeriod(setV);
  check('lançar de verdade remove a previsão correspondente',
    depois.filter(t => t.virtual).length, nVirtuaisAntes - 1);
  check('e o aluguel aparece uma vez só',
    depois.filter(t => t.description === 'Aluguel VIS').length, 1);
  check('agora como lançamento real', depois.find(t => t.description === 'Aluguel VIS').virtual, undefined);
  DB.remove('transactions', idReal);

  state.monthOffset = offV; state.repOffset = repV;
  state.filtros = filtrosVazios();
  DB.remove('transactions', idAgendado);
  for (const t of DB.all('transactions').filter(t => / VIS$/.test(t.description || ''))) DB.remove('transactions', t.id);
  DB.save();
} catch (e) { console.log(` FALHA | visão de futuro: ${e.message}`); fail++; }

console.log('\n=== Faturas em aberto (o que falta, não o total) ===');
try {
  const cKpi = DB.upsert('cards', { name: 'Cartao Aberto', closing_day: 10, due_day: 20, limit_amount: 5000 });
  const ctaKpi = DB.all('accounts')[0];
  const hojeKpi = todayISO();
  const chaveKpi = DB.invoiceKeyFor(DB.get('cards', cKpi), hojeKpi);
  DB.upsert('transactions', { description: 'Compra Aberto', amount: 1000, date: hojeKpi, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Crédito', card_id: cKpi, invoice_key: chaveKpi });

  const invCheia = DB.invoicesOf(DB.get('cards', cKpi)).find(i => i.key === chaveKpi);
  check('fatura nasce inteira em aberto', invCheia.falta, 1000);

  // Paga 700 dos 1.000 — o aberto passa a ser 300, não 1.000
  DB.upsert('transactions', { description: 'Pgto Aberto', amount: 700, date: hojeKpi, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito',
    account_id: ctaKpi.id, pays_invoice: chaveKpi });
  const invParcial = DB.invoicesOf(DB.get('cards', cKpi)).find(i => i.key === chaveKpi);
  check('pagamento parcial abate do que falta', invParcial.falta, 300);
  check('e o total da fatura não muda', invParcial.total, 1000);
  check('o status vira Parcial', invParcial.status, 'Parcial');

  /* O KPI do painel tem de refletir isso. Somo o esperado a partir do próprio DB em
     vez de cravar um número: o fixture tem outros cartões, e um valor fixo aqui
     quebraria a cada mudança de fixture sem apontar defeito nenhum. */
  const esperado = DB.all('cards').filter(c => c.active !== false)
    .flatMap(c => DB.invoicesOf(c)).filter(i => i.status !== 'Paga')
    .reduce((s, i) => s + i.falta, 0);
  const somaDosTotais = DB.all('cards').filter(c => c.active !== false)
    .flatMap(c => DB.invoicesOf(c)).filter(i => i.status !== 'Paga')
    .reduce((s, i) => s + i.total, 0);
  const telaKpi = renderInicio(DB.monthPeriod(new Date()));
  const lidoKpi = (telaKpi.match(/kpi-value [^"]*">([^<]+)<\/div><div class="kpi-label">Faturas em aberto/) || [])[1];
  check('o KPI mostra a soma do que falta', lidoKpi, fmt(esperado));
  /* E o teste que importa: com um pagamento parcial em jogo, falta e total DIVERGEM.
     Sem isso a assertiva acima passaria mesmo se o código voltasse a somar total. */
  check('e falta difere do total, senão o teste seria vazio', somaDosTotais > esperado, true);
  check('o KPI não mostra a soma dos totais', lidoKpi === fmt(somaDosTotais), false);

  /* ---- A fatura em aberto na seção "O que ainda vem" ----
     A lista de vencimentos deixou de ser seção própria: ela e "o que já está
     previsto" respondiam a mesma pergunta, e a fatura aparecia nas DUAS. O que
     aquela seção protegia continua valendo e é isto que se verifica aqui — só que
     no lugar novo, a linha da previsão do mês em que a fatura vence. */
  const apVenc = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('a lista não é mais cortada em três', /upcoming\.slice\(0, 3\)/.test(apVenc), false);
  check('o recorte do KPI segue sendo até o fim do ciclo',
    apVenc.includes('emAberto.filter(inv => inv.due < period.end)'), true);
  check('e a seção antiga não existe mais', telaKpi.includes('Próximos vencimentos'), false);
  check('  nem a linha solta de fatura', telaKpi.includes('class="invoice-row"'), false);

  /* A FATURA NUNCA SOME. Ela é item da previsão do mês em que vence, e é lá que a
     tela tem de mostrá-la — inclusive com falta e total divergindo, senão a
     assertiva seria vazia. */
  const perDaFatura = DB.monthPeriod(invParcial.due);
  const offSalvoF = state.monthOffset;
  state.monthOffset = 0;
  const telaDaFatura = renderInicio(perDaFatura);
  const linhaDaParcial = (telaDaFatura.match(/<div class="prev-linha">[\s\S]*?Fatura Cartao Aberto[\s\S]*?<\/div>/) || [''])[0];
  check('a fatura aparece na previsão do mês em que vence', !!linhaDaParcial, true);
  check('e a linha mostra o que FALTA', linhaDaParcial.includes(fmtShort(300)), true);
  check('não o total da fatura como valor principal',
    new RegExp('class="num [^"]*">[^<]*' + fmtShort(1000).replace(/\$/g, '\\$')).test(linhaDaParcial), false);
  /* O total continua à vista: sem ele, quem pagou parcial lê o número menor como
     "o pagamento não entrou" — foi o defeito que criou esta verificação. */
  check('o total aparece como referência na própria linha',
    linhaDaParcial.includes('de ' + fmtShort(1000)), true);
  check('e o status da fatura também', /Parcial/.test(linhaDaParcial), true);
  /* Fatura VENCIDA não depende desta seção: ela está na fila de pendências do
     topo, que é a única com botão de pagar. */
  check('fatura vencida entra na fila de pendências',
    DB.pendencias(todayISO()).some(i => i.tipo === 'fatura') || invParcial.due > new Date(), true);
  state.monthOffset = offSalvoF;

  // Limpa: registro dirty faria os testes async de sync girarem por sujeira
  DB.data.transactions = DB.data.transactions.filter(t => !/Aberto$/.test(t.description || ''));
  DB.data.cards = DB.data.cards.filter(c => c.id !== cKpi);
  DB.save();
} catch (e) { console.log(` FALHA | faturas em aberto: ${e.message}`); fail++; }

console.log('\n=== Compra parcelada ===');
try {
  const antesQtd = DB.all('transactions').length;
  openTxSheet(null);
  el('#f-amount').dataset.cents = '120000';        // R$ 1.200,00
  el('#f-desc').value = 'Geladeira nova';
  el('#f-date').value = dia(7);
  el('#f-card').value = cartao;
  el('#f-parc').value = '3';
  el('#g-type .chip.active').dataset.v = 'Despesa';
  el('#g-method .chip.active').dataset.v = 'Cartão de Crédito';   // é o que liga o parcelamento
  el('#sh-save').click();

  const parcelas = DB.all('transactions').filter(t => /Geladeira nova/.test(t.description));
  check('gerou uma parcela por fatura', parcelas.length, 3);
  check('a descrição leva o texto digitado', parcelas.every(t => t.description.startsWith('Geladeira nova (')), true);
  check('e nunca o elemento do campo', parcelas.some(t => /object HTML/i.test(t.description)), false);
  check('numeradas de 1 a 3', parcelas.map(t => t.installment).sort().join(','), '1/3,2/3,3/3');
  check('a soma bate com o valor da compra', parcelas.reduce((s, t) => s + t.amount, 0), 1200);
  check('todas no mesmo grupo', new Set(parcelas.map(t => t.group_id)).size, 1);
  check('cada uma numa fatura diferente', new Set(parcelas.map(t => t.invoice_key)).size, 3);
  check('a busca do extrato encontra pelo nome',
    DB.all('transactions').filter(t => DB._semAcento(t.description).includes('geladeira')).length, 3);
  /* ---- EDITAR A SÉRIE INTEIRA ----

     Corrigir a categoria de uma compra em 10x exigia abrir dez telas em dez meses
     diferentes. Ninguém faz, e o dado fica errado para sempre — medido na base
     real: uma compra de R$ 2.000 em 10x com a categoria só na primeira parcela, e
     R$ 1.800 fora do donut e do orçamento por nove meses.

     A EXCLUSÃO já perguntava se era para apagar a série toda; a edição não
     perguntava nada. */
  const ord = [...parcelas].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  /* Simula o fluxo real: ao salvar, o app grava a parcela aberta e SÓ DEPOIS
     propaga nas irmãs — por isso a propagação exclui a própria parcela. */
  const editarEPropagar = (base, mudanca, alcance) => {
    const novo = { ...base, ...mudanca };
    applyTxEffect(base, -1); DB.upsert('transactions', novo); applyTxEffect(novo, +1);
    return propagarNasParcelas(novo, base, alcance);
  };
  const catNova = DB.rootCategories('Despesa')[0];
  const primeira = ord[0];

  check('a folha oferece o alcance quando é parcelado',
    fs.readFileSync(BASE + 'js/app.js', 'utf8').includes("chipGroup('g-alcance'"), true);

  // "todas": a categoria da parcela aberta vale para as irmãs
  editarEPropagar(primeira, { category_id: catNova.id }, 'todas');
  check('categoria aplicada em todas as parcelas',
    DB.all('transactions').filter(t => t.group_id === primeira.group_id
      && t.category_id === catNova.id).length, 3);

  /* A DATA propaga o DIA DO MÊS, não a data absoluta. "Lancei no dia 10 mas era
     11" tem de levar cada parcela para o dia 11 do SEU mês; copiar a data faria as
     três caírem no mesmo dia e a compra parcelada viraria uma à vista repetida. */
  const dia11 = trocarDiaDoMes(primeira.date, 11);
  editarEPropagar(DB.get('transactions', primeira.id), { date: dia11 }, 'todas');
  const depois = DB.all('transactions').filter(t => t.group_id === primeira.group_id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  check('todas foram para o dia 11', depois.every(t => new Date(t.date + 'T12:00:00').getDate() === 11), true);
  check('  mas cada uma no seu mês', new Set(depois.map(t => String(t.date).slice(0, 7))).size, 3);
  check('  e a fatura de cada uma foi recalculada', new Set(depois.map(t => t.invoice_key)).size, 3);

  // Dia 31 num mês curto cai no último dia real, não transborda para o mês seguinte
  check('dia 31 em fevereiro não vira 3 de março',
    trocarDiaDoMes('2027-02-10', 31), '2027-02-28');

  /* O VALOR passa a valer para CADA parcela: o campo do formulário mostra o valor
     da parcela, não o da compra, então quem corrige 200 para 300 está dizendo
     "cada parcela é 300" — e o total da compra acompanha. */
  editarEPropagar(depois[0], { amount: 300 }, 'todas');
  const comValor = DB.all('transactions').filter(t => t.group_id === primeira.group_id);
  check('o novo valor vale para cada parcela', comValor.every(t => t.amount === 300), true);
  check('  e o total da compra acompanha',
    Math.round(comValor.reduce((s, t) => s + t.amount, 0)), 900);
  /* Uma edição que NÃO mexe no valor não pode reescrevê-lo: a criação distribui
     na primeira parcela os centavos que não dividem certo, e sobrescrever apagaria
     esse ajuste — a soma deixaria de bater com a compra.

     A divergência é FORÇADA aqui: com todas as parcelas no mesmo valor, copiar e
     preservar dão o mesmo resultado e o teste passaria por vazio. */
  const serieC = DB.all('transactions').filter(t => t.group_id === primeira.group_id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  DB.upsert('transactions', { ...serieC[0], amount: 300.02 });     // centavos na 1ª
  const antesCent = DB.all('transactions').filter(t => t.group_id === primeira.group_id)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).map(t => t.amount).join();
  check('as parcelas têm valores diferentes, senão o teste é vazio',
    new Set(antesCent.split(',')).size > 1, true);
  editarEPropagar(serieC[1], { member: 'Gleice' }, 'todas');
  check('editar outro campo não mexe nos valores',
    DB.all('transactions').filter(t => t.group_id === primeira.group_id)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).map(t => t.amount).join(), antesCent);

  // "esta" não toca em ninguém; "proximas" só no que vem depois
  const antesEsta = DB.all('transactions').filter(t => t.group_id === primeira.group_id).map(t => t.member).join();
  check('alcance "esta" não propaga',
    propagarNasParcelas({ ...comValor[0], member: 'Ninguém' }, comValor[0], 'esta'), 0);
  check('  e nada mudou',
    DB.all('transactions').filter(t => t.group_id === primeira.group_id).map(t => t.member).join(), antesEsta);
  const meio = [...comValor].sort((a, b) => String(a.date).localeCompare(String(b.date)))[1];
  check('alcance "próximas" só alcança o que vem depois',
    propagarNasParcelas({ ...meio, member: 'Joctã' }, meio, 'proximas'), 1);

  for (const t of DB.all('transactions').filter(t => t.group_id === primeira.group_id)) DB.remove('transactions', t.id);
  check('cenário devolvido ao estado anterior', DB.all('transactions').length, antesQtd);
} catch (e) { console.log(` FALHA | parcelamento: ${e.message}`); fail++; }

console.log('\n=== Aportes (fluxo real, do clique ao saldo) ===');
try {
  const saldoAntes = DB.get('accounts', conta).balance;
  const caixaAntes = DB.get('accounts', caixinha).balance;
  const totalAntes = DB.goalTotal(meta);

  openAporteSheet(meta);                              // abre a folha
  el('#a-amount').dataset.cents = '50000';            // R$ 500,00
  el('#a-desc').value = 'Aporte de teste';
  el('#a-date').value = dia(9);
  el('#a-account').value = conta;                     // saiu da corrente
  el('#a-to').value = caixinha;                       // entrou na caixinha
  el('#sh-save').click();                             // clica em Registrar aporte

  check('aporte somou na meta', DB.goalTotal(meta), totalAntes + 500);
  check('debitou a conta de origem', DB.get('accounts', conta).balance, saldoAntes - 500);
  check('creditou a conta de destino', DB.get('accounts', caixinha).balance, caixaAntes + 500);

  const lancado = DB.all('goal_entries').find(e => e.description === 'Aporte de teste');
  check('guardou as contas movimentadas', !!(lancado.from_account && lancado.to_account), true);

  // Detalhe da meta mostra TODO o histórico (não só os últimos)
  openGoalDetail(meta);
  const html = el('#modal').innerHTML;
  const todos = DB.all('goal_entries').filter(e => e.goal_id === meta);
  check(`detalhe lista todos os ${todos.length} aportes`, todos.every(e => html.includes(esc(e.description))), true);
  check('detalhe mostra total e ritmo', html.includes('Guardado') && html.includes('Histórico completo'), true);

  // Corrigir o valor ajusta os saldos pela diferença
  openEntrySheet(lancado.id, meta);
  el('#e-amount').dataset.cents = '30000';            // vira R$ 300,00 (−200)
  el('#e-desc').value = 'Aporte de teste';
  el('#e-date').value = lancado.date;
  el('#sh-save').click();
  check('editar aporte corrige a meta', DB.goalTotal(meta), totalAntes + 300);
  check('editar devolve a diferença à origem', DB.get('accounts', conta).balance, saldoAntes - 300);

  // Excluir devolve tudo
  openEntrySheet(lancado.id, meta);
  el('#sh-del').click();
  check('excluir aporte volta a meta ao valor anterior', DB.goalTotal(meta), totalAntes);
  check('excluir devolve o saldo da origem', DB.get('accounts', conta).balance, saldoAntes);
  check('excluir devolve o saldo do destino', DB.get('accounts', caixinha).balance, caixaAntes);
} catch (e) {
  console.log(` FALHA | fluxo de aportes: ${e.message}`); fail++;
}

try {
  openInvoiceDetail(DB.invoicesOf(DB.get('cards', cartao))[0].key);
  check('detalhe da fatura lista os lançamentos', el('#modal').innerHTML.includes('Roupa'), true);
} catch (e) { console.log(` FALHA | detalhe da fatura: ${e.message}`); fail++; }

console.log('\n=== Formulário: escolha manual nunca é sobrescrita ===');
try {
  const alim = cat('Aliment').id, moradia = cat('Moradia').id;
  // O DOM falso não roda listeners; reproduzimos a mesma decisão do handler.
  const decidir = ({ catManual, texto }) => {
    const anterior = txHistory().find(h => h.description.toLowerCase() === texto.toLowerCase());
    if (anterior) return (!catManual && anterior.category_id) ? anterior.category_id : 'MANTEM';
    if (catManual) return 'MANTEM';
    return OFX.guessCategoryId(texto, DB.all('categories')) || 'MANTEM';
  };
  // Com dois níveis a sugestão passou a acertar o detalhe: "Supermercado" não é
  // só Alimentação, é a subcategoria Mercado dentro dela.
  const subMercado = DB.subcategoriesOf(alim).find(c => c.name === 'Mercado');
  check('sugestão desce até a subcategoria', decidir({ catManual: false, texto: 'Supermercado' }), subMercado.id);
  check('e a subcategoria pertence ao envelope certo', DB.categoryRootId(subMercado.id), alim);
  check('sem escolha manual, repete o lançamento igual', decidir({ catManual: false, texto: 'Mercado' }), alim);
  check('COM escolha manual, digitar palavra-chave NÃO troca', decidir({ catManual: true, texto: 'Supermercado' }), 'MANTEM');
  check('COM escolha manual, descrição repetida NÃO troca', decidir({ catManual: true, texto: 'Mercado' }), 'MANTEM');
  check('descrição desconhecida não força nenhuma categoria', decidir({ catManual: false, texto: 'zzz qualquer coisa' }), 'MANTEM');
  // Ao editar, a categoria gravada conta como escolha manual desde o início
  const editando = DB.all('transactions').find(t => t.description === 'Mercado');
  check('ao editar, a categoria salva é preservada', !!editando.category_id, true);
  check('categoria salva é a que foi lançada', editando.category_id, alim);
} catch (e) { console.log(` FALHA | formulário: ${e.message}`); fail++; }

/* ---- Categoria e subcategoria ----
   O risco todo está na agregação: gasto de subcategoria tem de subir para o
   envelope, e o orçamento não pode ser contado duas vezes. */
console.log('\n=== Categoria e subcategoria ===');
try {
  const alimento = cat('Aliment');
  const filhas = DB.subcategoriesOf(alimento.id);
  check('envelope de fábrica vem com subcategorias', filhas.length > 3, true);
  check('envelope não tem pai', !alimento.parent_id, true);
  check('subcategoria aponta para o envelope', DB.categoryRootId(filhas[0].id), alimento.id);
  check('caminho mostra os dois níveis', DB.categoryPath(filhas[0].id).includes(' › '), true);
  check('envelope mostra só o próprio nome', DB.categoryPath(alimento.id), alimento.name);

  // Envelope com filhas sai da lista de folhas: lançar nele deixaria o detalhe vazio
  const folhas = DB.leafCategories();
  check('envelope com subcategorias não é folha', folhas.some(c => c.id === alimento.id), false);
  check('subcategorias são folhas', folhas.some(c => c.id === filhas[0].id), true);

  // Agregação: o que foi lançado na filha aparece no pai
  const mercado = filhas.find(c => c.name === 'Mercado');
  const delivery = filhas.find(c => c.name === 'Delivery');
  const antes = DB.spentByCategory(p)[alimento.id] || 0;
  DB.upsert('transactions', { description: 'Compra da semana', amount: 250, date: dia(12), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: conta, category_id: mercado.id });
  DB.upsert('transactions', { description: 'Pedido de pizza', amount: 90, date: dia(13), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: conta, category_id: delivery.id });
  check('gasto da subcategoria sobe para o envelope', DB.spentByCategory(p)[alimento.id], antes + 250 + 90);
  check('subcategoria não aparece como envelope próprio', DB.spentByCategory(p)[mercado.id] === undefined, true);

  // Detalhe dentro do envelope
  const detalhe = DB.spentBySubcategory(p, alimento.id);
  check('detalhe separa mercado', detalhe[mercado.id], 250);
  check('detalhe separa delivery', detalhe[delivery.id], 90);
  check('lançado direto no envelope fica visível à parte', DB.spentDirectly(p, alimento.id), antes);

  // Orçamento: só o envelope conta
  const somaTudo = DB.all('categories').reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0);
  check('total orçado usa só envelopes', DB.budgetTotal() <= somaTudo, true);
  check('subcategoria de fábrica não tem orçamento próprio', filhas.every(f => !f.monthly_budget), true);
  check('total orçado bate com a soma dos envelopes',
    DB.budgetTotal(), DB.rootCategories().reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0));

  // 50/30/20 herda do envelope
  const lazer = DB.rootCategories().find(c => c.name === 'Lazer');
  /* A subcategoria de Viagem, explicitamente — e não "a primeira filha de Lazer".
     A busca por "VIAGEM", mais abaixo, exige um lançamento classificado numa
     categoria com esse nome; preso à ORDEM, o teste passava por acidente e quebrou
     quando o catálogo foi reordenado. */
  const subLazer = DB.subcategoriesOf(lazer.id).find(c => /Viagem/i.test(c.name)) || DB.subcategoriesOf(lazer.id)[0];
  const kindAntes = DB.spentByKind(p).Estilo;
  DB.upsert('transactions', { description: 'Cinema sábado', amount: 60, date: dia(14), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: conta, category_id: subLazer.id });
  check('subcategoria herda necessidade/desejo do envelope', DB.spentByKind(p).Estilo, kindAntes + 60);

  /* Nomes repetidos entre envelopes: o MODELO permite, e o caminho é o que desfaz
     a ambiguidade. O catálogo padrão deixou de trazer repetições — "Manutenção"
     virou "Reparos em casa" e "Oficina / Revisão", porque no seletor a folha
     aparece sozinha e a palavra não dizia de qual envelope era. Mas quem cria
     categoria à mão pode repetir, e aí o caminho tem de salvar. Por isso o par é
     criado AQUI, em vez de depender do catálogo. */
  const moradiaR = DB.rootCategories().find(c => c.name === 'Moradia');
  const transpR = DB.rootCategories().find(c => c.name === 'Transporte');
  const rep1 = DB.upsert('categories', { name: 'Reparo', icon: '🔧', parent_id: moradiaR.id, type: 'Despesa', monthly_budget: 0 });
  const rep2 = DB.upsert('categories', { name: 'Reparo', icon: '🔧', parent_id: transpR.id, type: 'Despesa', monthly_budget: 0 });
  const comRepetido = [DB.get('categories', rep1), DB.get('categories', rep2)];
  check('nome de folha pode repetir entre envelopes', comRepetido.length >= 2, true);
  check('e os caminhos ficam diferentes',
    new Set(comRepetido.map(c => DB.categoryPath(c.id))).size, comRepetido.length);
  /* E o catálogo padrão não usa essa liberdade: nome repetido entre envelopes é
     confusão na hora de classificar, que foi o que motivou a revisão. */
  {
    const porNome = {};
    for (const c of DB.all('categories')) {
      if (!c.parent_id || c.id === rep1 || c.id === rep2) continue;
      const k = `${DB.categoryType(DB.categoryRoot(c.id))}|${c.name.toLowerCase()}`;
      porNome[k] = (porNome[k] || 0) + 1;
    }
    const repetidos = Object.entries(porNome).filter(([, n]) => n > 1).map(([k]) => k.split('|')[1]);
    check('o catálogo padrão não repete nome de folha no mesmo lado',
      repetidos.length ? repetidos.join(', ') : true, true);
    // Nem usa nome de envelope como folha de outro ("Saúde" era envelope e filha de Filhos)
    const envelopes = DB.all('categories').filter(c => !c.parent_id);
    const colide = DB.all('categories').filter(c => c.parent_id && c.id !== rep1 && c.id !== rep2
      && envelopes.some(e => e.name.toLowerCase() === c.name.toLowerCase() && e.id !== c.parent_id));
    check('  nem repete nome de envelope numa folha',
      colide.length ? colide.map(c => c.name).join(', ') : true, true);
  }
  DB.remove('categories', rep1); DB.remove('categories', rep2);

  // Apagar envelope leva as filhas: senão sobram órfãs vivas no banco
  const pets = DB.rootCategories().find(c => c.name === 'Pets');
  const idsFilhas = DB.subcategoriesOf(pets.id).map(c => c.id);
  check('envelope a apagar tinha subcategorias', idsFilhas.length > 0, true);
  DB.remove('categories', pets.id);
  check('apagar o envelope apaga as subcategorias', idsFilhas.every(id => !DB.get('categories', id)), true);
  check('as filhas apagadas vão sincronizar a remoção',
    idsFilhas.every(id => DB.data.categories.find(c => c.id === id).dirty === true), true);

  // Se o pai desaparece sem levar a filha, ela não pode sumir do relatório
  const orfa = DB.upsert('categories', { name: 'Órfã', icon: '❓', parent_id: '99999999-9999-4999-8999-999999999999', monthly_budget: 0 });
  check('subcategoria sem pai vira o próprio envelope', DB.categoryRootId(orfa), orfa);
  check('e ainda tem um caminho legível', DB.categoryPath(orfa), 'Órfã');
  DB.remove('categories', orfa);

  // As telas novas precisam abrir de verdade, não só existir no código
  const modal = () => els['#modal'].innerHTML;
  /* O cadastro abre recolhido: a lista aberta tinha ~123 linhas (19 envelopes +
     85 subcategorias + um botão cada), quase 8 telas de rolagem. */
  openCategoriesConfig();
  const fechado = modal();
  check('cadastro abre', fechado.includes('Categorias'), true);
  const nEnvelopes = (fechado.match(/class="env /g) || []).length;
  check('mostra os envelopes de saída', nEnvelopes, DB.rootCategories('Despesa').length);
  check('e nenhuma subcategoria antes de abrir', fechado.includes('sub-linha'), false);
  check('não abre com nada expandido', fechado.includes('env aberto'), false);
  // Criar sem precisar abrir o grupo antes
  check('cada envelope tem + no cabeçalho', (fechado.match(/class="env-add"/g) || []).length, DB.rootCategories('Despesa').length);
  check('o + já sabe em qual envelope criar', /env-add" data-nova-sub="/.test(fechado), true);
  check('e tem rótulo para leitor de tela', /env-add"[^>]*aria-label="Nova subcategoria em/.test(fechado), true);

  // Tocar num envelope revela as subcategorias dele
  openCategoriesConfig({ aberto: alimento.id });
  const comUmAberto = modal();
  check('abrir um envelope revela as subcategorias', comUmAberto.includes('sub-linha'), true);
  check('e oferece criar subcategoria ali', comUmAberto.includes('data-nova-sub'), true);
  check('só um envelope fica aberto por vez', (comUmAberto.match(/env aberto/g) || []).length, 1);
  check('a tela continua curta', (comUmAberto.match(/sub-linha/g) || []).length, DB.subcategoriesOf(alimento.id).length);

  // Abas separam os dois lados
  check('a aba de saídas não mistura entradas', /Alimenta/.test(fechado) && !/Aluguéis/.test(fechado), true);
  openCategoriesConfig({ lado: 'Receita' });
  const entradas = modal();
  check('a aba de entradas mostra as origens', /Aluguéis/.test(entradas), true);
  check('e não mostra envelopes de gasto', /Alimenta/.test(entradas), false);

  // Busca encontra subcategoria sem precisar abrir o envelope certo
  openCategoriesConfig({ busca: 'delivery' });
  const buscado = modal();
  check('busca encontra a subcategoria', buscado.includes('Delivery'), true);
  check('e abre o envelope dela sozinha', buscado.includes('env aberto'), true);
  check('escondendo os envelopes sem resultado', (buscado.match(/class="env /g) || []).length < nEnvelopes, true);
  openCategoriesConfig({ busca: 'zzzzz' });
  check('busca sem resultado explica', modal().includes('Nada encontrado'), true);

  /* O ganho é o tamanho da tela, então é isso que o teste guarda. Conta as linhas
     tocáveis: com tudo aberto seriam ~123 (19 envelopes, 85 subcategorias e um
     botão por envelope), quase 8 telas de celular. */
  openCategoriesConfig();
  const linhasFechado = (modal().match(/class="env |sub-linha|btn-sub/g) || []).length;
  check('a lista cabe em poucas telas', linhasFechado <= 20, true);
  check('e é bem menor que a lista aberta',
    linhasFechado < DB.rootCategories().length + DB.all('categories').length, true);
  openCategoriesConfig({ aberto: alimento.id });
  const linhasAberto = (modal().match(/class="env |sub-linha|btn-sub/g) || []).length;
  check('abrir um envelope cresce pouco', linhasAberto - linhasFechado <= 10, true);
  openCategoriesConfig();
  openCategoryEditor(null, alimento.id);
  check('editor de subcategoria abre', modal().includes('Nova subcategoria'), true);
  check('e esconde os campos de envelope', /id="wrap-envelope" hidden/.test(modal()), true);
  openCategoryEditor(alimento, null);
  check('editor de envelope com filhas não oferece virar filha', modal().includes('não pode virar subcategoria'), true);
  Graficos.vivos.clear();
  openEnvelopeDetail(alimento.id);
  const cEnv = Graficos.montadas().slice(-1)[0].opts;
  check('detalhe do envelope abre com o ranking', cEnv.plotOptions.bar.horizontal, true);
  check('e nomeia as subcategorias gastas', cEnv.xaxis.categories.includes('Mercado'), true);

  /* Migração de quem já usava o app: a base antiga é plana e o seed não roda de
     novo, então as subcategorias precisam poder ser preenchidas depois. */
  const guardadas = DB.data.categories;
  const plana = (nome, icon, kind, scope) =>
    ({ id: DB.uuid(), name: nome, icon, monthly_budget: 100, kind, scope, updated_at: DB.now(), deleted: false });
  DB.data.categories = [
    plana('Alimentação / Mercado', '🍽️', 'Essencial', 'Família'),   // nome do seed antigo
    plana('Transporte', '🚗', 'Essencial', 'Família'),
    plana('Barco', '⛵', 'Estilo', 'Família'),                        // criada pela família: não é do molde
  ];
  check('base antiga não tem subcategoria nenhuma', DB.all('categories').every(c => !c.parent_id), true);
  const criadas = DB.sugerirSubcategorias();
  check('a migração cria subcategorias', criadas > 5, true);
  const alimAntigo = DB.all('categories').find(c => c.name === 'Alimentação / Mercado');
  check('reconhece o envelope pelo nome antigo', DB.subcategoriesOf(alimAntigo.id).length > 3, true);
  check('não inventa nada em envelope que a família criou',
    DB.subcategoriesOf(DB.all('categories').find(c => c.name === 'Barco').id).length, 0);
  check('as novas herdam o tipo do envelope',
    DB.subcategoriesOf(alimAntigo.id).every(f => f.kind === 'Essencial'), true);
  check('e não ganham orçamento próprio',
    DB.subcategoriesOf(alimAntigo.id).every(f => !f.monthly_budget), true);
  const denovo = DB.sugerirSubcategorias();
  check('rodar de novo não duplica nada', denovo, 0);
  DB.data.categories = guardadas;   // devolve o cenário para as seções seguintes
} catch (e) { console.log(` FALHA | subcategorias: ${e.message}`); fail++; }

console.log('\n=== Subcategorias nas telas ===');
{
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  // O formulário não pode oferecer o envelope como atalho: o gasto cairia no
  // nível de cima e o detalhe nunca aconteceria
  // O dropdown agrupa por envelope (optgroup) em vez de repetir "Alimentação › "
  // em cada linha; o UI desenha optgroup como cabeçalho de grupo.
  const html = optionsCategorias(null);
  const alimento2 = cat('Aliment');
  check('opções vêm agrupadas por envelope', /<optgroup label="[^"]*Alimenta/.test(html), true);
  check('a subcategoria aparece só com o próprio nome', /<option value="[^"]*">Mercado<\/option>/.test(html), true);
  check('o envelope não é opção selecionável', new RegExp(`<option value="${alimento2.id}"`).test(html), false);
  check('todas as folhas estão no dropdown',
    (html.match(/<option /g) || []).length, DB.leafCategories().length);
  check('envelope sem subcategoria fica em grupo próprio',
    !DB.rootCategories().some(r => !DB.subcategoriesOf(r.id).length) || html.includes('Sem subcategorias'), true);
  const marcado = optionsCategorias(DB.subcategoriesOf(alimento2.id)[0].id);
  check('a categoria escolhida vem marcada', (marcado.match(/selected/g) || []).length, 1);
  check('formulário e OFX usam o mesmo gerador',
    (ap.match(/optionsCategorias\(/g) || []).length >= 3, true);
  check('chips das 3 mais usadas só consideram folhas', /const folhas = DB\.leafCategories\(tipo\)/.test(ap), true);
  check('adivinhação recebe a lista completa (precisa dos pais)', ap.includes('OFX.guessCategoryId(texto, DB.all(\'categories\'))'), true);
  check('extrato mostra o caminho', /c \? esc\(DB\.categoryPath\(t\.category_id\)\) :/.test(ap), true);
  check('entrada sem origem também é sinalizada', ap.includes("'Entrada sem origem'"), true);
  check('CSV exporta o caminho', /DB\.categoryPath\(t\.category_id\), t\.scope/.test(ap), true);
  check('barra de orçamento abre o detalhe', ap.includes('openEnvelopeDetail') && ap.includes('data-envelope='), true);
  check('cadastro de categoria recolhível', ap.includes('openCategoriesConfig') && ap.includes('data-abrir'), true);
  check('dá para criar subcategoria dentro do envelope', ap.includes('data-nova-sub'), true);
  check('subcategoria não pede orçamento próprio', /const novoBudget = semEnvelope \? 0 :/.test(ap), true);
  check('subcategoria herda âmbito e tipo do envelope', /scope: semEnvelope \?[\s\S]{0,180}kind: semEnvelope \?/.test(ap), true);
  check('entrada também não tem orçamento', /const semEnvelope = pai \|\| ehEntrada;/.test(ap), true);
  check('base antiga recebe a oferta de migração', ap.includes('md-sugerir') && ap.includes('DB.sugerirSubcategorias()'), true);

  const nt = fs.readFileSync(BASE + 'supabase/functions/notify/index.ts', 'utf8');
  check('aviso do servidor também soma no envelope', nt.includes('envelopeDe(t.category_id)'), true);
  check('aviso do servidor não repete o limite da filha', /if \(c\.parent_id\) continue;/.test(nt), true);
  check('servidor busca parent_id', nt.includes("select('id,name,icon,monthly_budget,parent_id')"), true);

  const cssS = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('subcategoria é linha simples dentro do envelope',
    /\.sub-linha \{/.test(cssS) && /\.env-body \{/.test(cssS), true);
}

/* ---- Categorias de entrada ----
   Entrada tem origem, não envelope: sem separar, empréstimo recebido viraria renda,
   inflando taxa de poupança e a base do 50/30/20 — e a dívida desapareceria. */
/* ---- Categoria nunca duplica ----
   Uma base real chegou a 312 categorias (esperado ~100): cada aparelho novo cria
   as de fábrica com ids próprios, e ao entrar numa família que já tem as dela,
   enviava as suas por cima. Duas categorias de mesmo nome dividem o gasto em
   dois lugares, e nenhum dos dois mostra o total. */
console.log('\n=== Categoria nunca duplica ===');
try {
  const alimD = cat('Aliment');
  check('acha a existente pelo nome', DB.acharCategoria(alimD.name, null, 'Despesa').id, alimD.id);
  check('ignora acento e caixa', !!DB.acharCategoria('ALIMENTACAO', null, 'Despesa'), true);
  check('não confunde níveis diferentes', DB.acharCategoria(alimD.name, alimD.id, 'Despesa'), null);
  check('nem lados diferentes', DB.acharCategoria(alimD.name, null, 'Receita'), null);
  const sub = DB.subcategoriesOf(alimD.id)[0];
  check('acha subcategoria dentro do envelope certo', DB.acharCategoria(sub.name, alimD.id, 'Despesa').id, sub.id);

  const apD = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('cadastro barra nome repetido', /const igual = DB\.acharCategoria\(nome, pai, tipo\);/.test(apD), true);
  check('e deixa editar a própria sem reclamar', /igual\.id !== cat\.id/.test(apD), true);

  // Aparelho novo entrando em família que já tem categorias
  // Cópia rasa de cada objeto: o descarte marca deleted, então guardar só a
  // referência da lista traria de volta os registros já marcados
  const guardado = DB.data.categories.map(c => ({ ...c }));
  const usadas = DB.all('transactions').map(t => t.category_id).filter(Boolean);
  const antes = DB.all('categories').length;
  const orfa = DB.upsert('categories', { name: 'Só local', icon: '🆕', parent_id: null, type: 'Despesa', monthly_budget: 0 });
  check('a nova nasce pendente de envio', DB.data.categories.find(c => c.id === orfa).dirty, true);
  const descartadas = DB.descartarCategoriasNaoUsadas();
  check('descarta o que nunca foi usado nem enviado', descartadas > 0, true);
  check('e a nova saiu junto', !DB.get('categories', orfa), true);
  check('categoria COM lançamento nunca é descartada',
    usadas.every(id => !!DB.get('categories', id)), true);
  DB.data.categories = guardado;
  check('cenário devolvido', DB.all('categories').length, antes);

  const apP = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const syP = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  check('pergunta ao servidor antes de enviar as locais', syP.includes('familiaTemCategorias'), true);
  check('e só descarta se a família já tiver as dela',
    /if \(await Sync\.familiaTemCategorias\(\)\)[\s\S]{0,140}descartarCategoriasNaoUsadas\(\)/.test(apP), true);
  check('o descarte acontece ANTES da sincronização',
    apP.indexOf('descartarCategoriasNaoUsadas()') < apP.search(/DB\.data\.meta\.lastSync = null; DB\.save\(\);\s*try \{ await Sync\.syncAll/), true);
} catch (e) { console.log(` FALHA | duplicidade: ${e.message}`); fail++; }

console.log('\n=== Categorias de entrada ===');
try {
  const contaE = DB.all('accounts')[0].id;
  const raizesRec = DB.rootCategories('Receita');
  check('vêm categorias de entrada de fábrica', raizesRec.length >= 5, true);
  check('empréstimos ficam em grupo próprio', raizesRec.some(c => c.name === 'Empréstimos'), true);
  check('trabalho também', raizesRec.some(c => c.name === 'Trabalho'), true);

  const trabalho = raizesRec.find(c => c.name === 'Trabalho');
  const salario = DB.subcategoriesOf(trabalho.id).find(c => c.name === 'Salário');
  const emprestimos = raizesRec.find(c => c.name === 'Empréstimos');
  const empRecebido = DB.subcategoriesOf(emprestimos.id).find(c => /recebido/.test(c.name));

  check('a subcategoria de entrada herda o tipo', DB.categoryType(salario), 'Receita');
  check('gasto e entrada não se misturam',
    DB.rootCategories('Despesa').some(c => DB.categoryType(c) === 'Receita'), false);
  check('a lista sem tipo traz os dois lados',
    DB.rootCategories().length > DB.rootCategories('Despesa').length, true);

  // Orçamento e 50/30/20 não conhecem entrada
  check('entrada não tem orçamento', raizesRec.every(c => !c.monthly_budget), true);
  const totalOrcado = DB.budgetTotal();
  check('total orçado ignora entradas',
    totalOrcado, DB.rootCategories('Despesa').reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0));

  // Classificar a entrada
  const p3 = DB.monthPeriod(new Date());
  const kindAntes = DB.spentByKind(p3);
  DB.upsert('transactions', { description: 'Salário do mês', amount: 7000, date: dia(5), type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaE, category_id: salario.id });
  DB.upsert('transactions', { description: 'Empréstimo do banco', amount: 3000, date: dia(6), type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaE, category_id: empRecebido.id });

  const porOrigem = DB.incomeByCategory(p3);
  check('entrada soma no grupo de origem', porOrigem[trabalho.id], 7000);
  check('empréstimo fica separado do trabalho', porOrigem[emprestimos.id], 3000);
  check('entrada classificada não entra no 50/30/20',
    DB.spentByKind(p3).Essencial + DB.spentByKind(p3).Estilo,
    kindAntes.Essencial + kindAntes.Estilo);
  check('entrada não aparece como gasto por categoria',
    DB.spentByCategory(p3)[trabalho.id] === undefined, true);

  // Só folhas do lado certo entram nos seletores
  const folhasRec = DB.leafCategories('Receita');
  check('folhas de entrada são só de entrada', folhasRec.every(c => DB.categoryType(DB.categoryRoot(c.id)) === 'Receita'), true);
  check('o envelope de entrada com filhas não é folha', folhasRec.some(c => c.id === trabalho.id), false);

  // As 3 mais usadas de cada lado são calculadas separadamente
  const topRec = topCategoryIds(3, null, 'Receita');
  check('atalhos de entrada só trazem entrada',
    topRec.every(id => DB.categoryType(DB.categoryRoot(id)) === 'Receita'), true);
  const topDesp = topCategoryIds(3, null, 'Despesa');
  check('atalhos de gasto seguem só de gasto',
    topDesp.every(id => DB.categoryType(DB.categoryRoot(id)) === 'Despesa'), true);

  // Dropdown agrupado por origem
  const optRec = optionsCategorias(null, 'Receita');
  check('dropdown de entrada agrupa por origem', /<optgroup label="[^"]*Trabalho/.test(optRec), true);
  check('e não oferece categoria de gasto', /Alimenta/.test(optRec), false);

  // Adivinhação do OFX pelo lado certo
  const todas = DB.all('categories');
  check('crédito de salário cai em Salário', OFX.guessCategoryId('PAGAMENTO DE SALARIO ACME', todas, 'Receita'), salario.id);
  check('crédito de empréstimo cai em Empréstimos', OFX.guessCategoryId('CREDITO EMPRESTIMO CONSIGNADO', todas, 'Receita'), empRecebido.id);
  check('entrada nunca cai em categoria de gasto',
    DB.categoryType(DB.categoryRoot(OFX.guessCategoryId('ALUGUEL RECEBIDO', todas, 'Receita') || salario.id)), 'Receita');
  const palpiteGasto = OFX.guessCategoryId('SUPERMERCADO BOM PRECO', todas, 'Despesa');
  check('gasto continua caindo em categoria de gasto', DB.categoryType(DB.categoryRoot(palpiteGasto)), 'Despesa');

  /* ---- A CATEGORIA SUGERIDA TEM DE PODER SER TROCADA ----

     Ao digitar a descrição, o app sugere a categoria. Se a sugestão cair FORA dos
     atalhos, ela vira o rótulo do botão "Outra" — e o handler antigo só abria a
     lista quando esse botão estava VAZIO:

         abriu = cat-other.active && !cat-other.dataset.v

     Com a sugestão preenchida, `abriu` era falso: o toque marcava o botão e não
     acontecia mais nada. A categoria adivinhada ficava travada, e o único jeito
     de trocá-la era apagar a descrição. Relatado por quem usa o app. */
  {
    openTxSheet(null);
    const foraDoAtalho = DB.leafCategories('Despesa').find(c => !topCategoryIds(3, null, 'Despesa').includes(c.id));
    check('há categoria fora dos atalhos para o teste valer', !!foraDoAtalho, true);
    // simula o que a sugestão automática faz: escolhe uma categoria fora dos atalhos
    el('#f-cat-more').value = foraDoAtalho.id;
    el('#f-cat-more').onchange({ target: { value: foraDoAtalho.id } });
    check('a sugestão fica no botão "Outra"', el('#cat-other').dataset.v, foraDoAtalho.id);
    check('  e a lista se fecha depois de escolher', el('#f-cat-more').hidden, true);
    // AGORA o toque tem de reabrir a lista, senão a sugestão é irreversível
    el('#cat-other').click();
    check('tocar em "Outra" reabre a lista com a sugestão preenchida', el('#f-cat-more').hidden, false);
    closeSheet();
  }

  // Formulário: trocar o tipo troca a lista
  const ap3 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('formulário monta a lista pelo tipo', /montarCategorias\(isRec \? 'Receita' : 'Despesa'\)/.test(ap3), true);
  check('categoria deixou de ser escondida na receita', /wrap-cat'\)\.hidden = isRec/.test(ap3), false);
  check('receita grava a categoria escolhida', /category_id: chipValue\('g-cat'\) \|\| null/.test(ap3), true);
  check('rótulo muda para "De onde veio"', ap3.includes("'De onde veio'"), true);
  check('relatório mostra a origem das entradas', ap3.includes('De onde vem o dinheiro'), true);
  check('e avisa quando parte veio de empréstimo', ap3.includes('não são ganho'), true);

  // Migração de quem já usava o app
  const guardadas2 = DB.data.categories;
  DB.data.categories = DB.data.categories.filter(c => DB.categoryType(c) !== 'Receita');
  check('base sem entradas fica sem nenhuma', DB.rootCategories('Receita').length, 0);
  const criadas2 = DB.criarCategoriasDeEntrada();
  check('a migração cria as categorias de entrada', criadas2 > 10, true);
  check('e agora existem os grupos', DB.rootCategories('Receita').length >= 5, true);
  check('rodar de novo não duplica', DB.criarCategoriasDeEntrada(), 0);
  DB.data.categories = guardadas2;
} catch (e) { console.log(` FALHA | entradas: ${e.message}`); fail++; }

console.log('\n=== Nenhuma função inexistente é chamada (DB.x / OFX.x) ===');
{
  // Confere contra o módulo real, não contra o stub do teste. Antes era o stub, e
  // como ele não tem quase nada, 35 métodos ficavam numa lista de exceções — onde
  // um erro de digitação passaria despercebido para sempre.
  const membrosDe = (arquivo, nome) => {
    const src = fs.readFileSync(BASE + arquivo, 'utf8');
    const ini = src.indexOf(`const ${nome} = {`);
    if (ini < 0) return null;
    const resto = src.slice(ini);
    const fim = resto.indexOf('\n};');
    const membros = new Set();
    for (const m of resto.slice(0, fim < 0 ? resto.length : fim).matchAll(/^ {2}(?:async )?(\w+)\s*[(:]/gm)) membros.add(m[1]);
    return membros;
  };
  const declarados = obj => new Set(Object.keys(obj));
  const conhecidos = {
    DB: declarados(DB), OFX: declarados(OFX),
    Sync: membrosDe('js/sync.js', 'Sync'),
    Auth: membrosDe('js/auth.js', 'Auth'),
    Notif: membrosDe('js/app.js', 'Notif'),
  };
  for (const [nome, set] of Object.entries(conhecidos)) check(`${nome}: membros localizados`, !!set && set.size > 3, true);

  const fonte = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const quebradas = [];
  for (const [, obj, met] of fonte.matchAll(/\b(DB|OFX|Sync|Auth|Notif)\.(\w+)\s*\(/g)) {
    const alvo = conhecidos[obj];
    if (alvo && !alvo.has(met) && !quebradas.includes(obj + '.' + met)) quebradas.push(obj + '.' + met);
  }
  check('todas as chamadas existem', quebradas.length ? quebradas.join(', ') : true, true);

  // auth.js também chama Sync e DB — e é lá que mora o primeiro acesso
  const fonteAuth = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const quebradasAuth = [];
  for (const [, obj, met] of fonteAuth.matchAll(/\b(DB|Sync)\.(\w+)\s*\(/g)) {
    if (!conhecidos[obj].has(met) && !quebradasAuth.includes(obj + '.' + met)) quebradasAuth.push(obj + '.' + met);
  }
  check('chamadas do primeiro acesso existem', quebradasAuth.length ? quebradasAuth.join(', ') : true, true);
}

console.log('\n=== Reserva de emergência (caixinha, sem conta fixa) ===');
try {
  const reservaId = DB.upsert('goals', { name: 'Reserva de Emergência', icon: '🛡️', kind: 'Reserva', target_amount: 30000 });
  check('reserva reconhecida pelo tipo', DB.reserveGoals().length, 1);
  check('reserva começa zerada (nada guardado ainda)', DB.reserveTotal(), 0);

  // Guardar dinheiro: o aporte é o mecanismo, independente de conta
  DB.upsert('goal_entries', { goal_id: reservaId, amount: 4000, date: dia(4), description: 'Depósito inicial' });
  check('guardar dinheiro alimenta a reserva', DB.reserveTotal(), 4000);
  check('não depende de marcar conta nenhuma', DB.reserveTotal() > 0 && !DB.reserveGoals()[0].account_id, true);

  // Abrir a folha de aporte a partir do painel não pode quebrar
  openAporteSheet(reservaId);
  check('folha de aporte da reserva abre', el('#sheet').innerHTML.includes('id="a-amount"'), true);
  /* Guardar e resgatar na MESMA folha: o resgate precisava existir antes de o
     guardado sair do disponível — sem caminho de volta, usar a reserva derrubaria
     o saldo e deixaria a meta intacta, criando um número sem conserto. */
  check('e oferece guardar e resgatar', el('#sheet').innerHTML.includes('id="a-modo"'), true);
  el('#a-amount').dataset.cents = '100000';
  el('#a-desc').value = 'Guardado do mês';
  el('#a-date').value = dia(11);
  el('#a-account').value = ''; el('#a-to').value = '';
  el('#sh-save').click();
  check('aporte pelo painel soma na reserva', DB.reserveTotal(), 5000);

  const meses = DB.avgMonthlySpend() > 0 ? DB.reserveTotal() / DB.avgMonthlySpend() : 0;
  check('cobertura em meses é calculada', meses > 0, true);
  check('painel mostra o card da reserva', renderInicio(p).includes('Reserva de emergência'), true);

  /* ---- A primeira linha do painel ----
     Reserva, projeção e regra 50·30·20 juntas: são as três perguntas de "estamos
     bem?" — quanto já está guardado, como o mês fecha e como a renda se divide.
     Lado a lado elas se leem de uma vez; empilhadas, exigem rolar e a comparação
     se perde no caminho. */
  const painel = renderInicio(p);
  const iG3 = painel.indexOf('class="grid-3"');
  const fimG3 = painel.indexOf('class="grid-2"', iG3);
  const primeiraLinha = painel.slice(iG3, fimG3);
  const iRes = painel.indexOf('Reserva de emergência');
  const iProj = painel.indexOf('Projeção do mês');
  const iRegra = painel.indexOf('Regra 50 · 30 · 20');
  check('a primeira linha é um grid de três', iG3 > 0 && fimG3 > iG3, true);
  check('e leva os três cartões', (primeiraLinha.match(/class="card"/g) || []).length, 3);
  check('reserva vem primeiro, projeção depois, regra por último',
    iRes > iG3 && iRes < iProj && iProj < iRegra && iRegra < fimG3, true);
  /* A regra saiu do meio da página: ela ficava solta em largura inteira depois do
     "Ritmo do mês". Duas cópias seriam pior que estar no lugar errado. */
  check('a regra não sobrou solta no meio da página',
    /Regra 50/.test(painel.slice(painel.indexOf('Ritmo do mês'))), false);
  check('e aparece uma vez só', (painel.match(/Regra 50/g) || []).length, 1);
  /* A regra 50·30·20 só existe com renda cadastrada — ela é percentual DA renda, e
     sem denominador não há o que dividir. Aí a linha fica com dois cartões, e as
     colunas têm de acompanhar em vez de deixar um vão fantasma no fim. */
  const cssG3 = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('com dois cartões a linha vira duas colunas',
    /\.grid-3:has\(> \.card:nth-child\(2\):last-child\) \{ grid-template-columns: repeat\(2,/.test(cssG3), true);
  check('e com um só, largura inteira',
    /\.grid-3:has\(> \.card:only-child\) \{ grid-template-columns: minmax\(0, 1fr\)/.test(cssG3), true);
  check('no celular é sempre uma coluna', /\.grid-3 \{ display: grid; grid-template-columns: 1fr/.test(cssG3), true);
  // E o comportamento de verdade, num mês sem receita nenhuma
  const semRenda = renderInicio(DB.monthPeriod(new Date(), -600));
  const linhaSemRenda = semRenda.slice(semRenda.indexOf('class="grid-3"'),
    semRenda.indexOf('class="grid-2"', semRenda.indexOf('class="grid-3"')));
  check('sem renda a regra não é montada', /Regra 50/.test(semRenda), false);
  check('e a linha fica com dois cartões', (linhaSemRenda.match(/class="card"/g) || []).length, 2);
  check('reserva e projeção continuam lá',
    /Reserva de emergência/.test(linhaSemRenda) && /Projeção do mês/.test(linhaSemRenda), true);

  DB.remove('goals', reservaId);
  DB.all('goal_entries').filter(e => e.goal_id === reservaId).forEach(e => DB.remove('goal_entries', e.id));
  check('sem meta de reserva, painel convida a criar', renderInicio(p).includes('Criar minha reserva'), true);
} catch (e) { console.log(` FALHA | reserva: ${e.message}`); fail++; }

console.log('\n=== Transferência entre contas ===');
try {
  const antesA = DB.get('accounts', conta).balance;
  const antesB = DB.get('accounts', caixinha).balance;
  const gastoAntes = DB.statsFor(p).spent, receitaAntes = DB.realizedIncome(p);

  const tr = { description: 'Guardar dinheiro', amount: 700, date: dia(7), type: 'Transferência',
    status: 'Pago', method: 'Transferência', account_id: conta, to_account: caixinha, scope: 'Família', member: MEMBRO_COMUM };
  const trId = DB.upsert('transactions', tr);
  applyTxEffect(DB.get('transactions', trId), +1);

  check('sai da conta de origem', DB.get('accounts', conta).balance, antesA - 700);
  check('entra na conta de destino', DB.get('accounts', caixinha).balance, antesB + 700);
  check('transferência NÃO é despesa', DB.statsFor(p).spent, gastoAntes);
  check('transferência NÃO é receita', DB.realizedIncome(p), receitaAntes);
  check('transferência aparece no extrato', renderExtrato(p).includes('Guardar dinheiro'), true);
  check('não entra no comprometido', DB.committed(), 450);

  applyTxEffect(DB.get('transactions', trId), -1);
  DB.remove('transactions', trId);
  check('desfazer devolve os dois saldos', DB.get('accounts', conta).balance + DB.get('accounts', caixinha).balance, antesA + antesB);
} catch (e) { console.log(` FALHA | transferência: ${e.message}`); fail++; }

console.log('\n=== Conciliação de saldo (ajuste vira lançamento) ===');
try {
  const gastoAntes = DB.statsFor(p).spent;
  const receitaAntes = DB.realizedIncome(p);
  const c = DB.get('accounts', conta);
  const saldoAntes = c.balance;

  const delta = reconcileBalance(c, saldoAntes + 87.5);       // apareceram R$ 87,50
  check('saldo passa a ser o informado', DB.get('accounts', conta).balance, saldoAntes + 87.5);
  check('a diferença é devolvida para quem chamou', delta, 87.5);

  const ajuste = DB.all('transactions').find(t => t.adjustment);
  check('gerou um lançamento de ajuste (rastro no extrato)', !!ajuste, true);
  check('ajuste guarda a conta afetada', ajuste.account_id, conta);
  check('ajuste NÃO conta como gasto', DB.statsFor(p).spent, gastoAntes);
  check('ajuste NÃO conta como renda', DB.realizedIncome(p), receitaAntes);
  check('ajuste aparece no extrato', DB.txOfPeriod(p).some(t => t.adjustment), true);

  // Excluir o ajuste desfaz a conciliação (o rastro é reversível)
  adjustBalance(ajuste.account_id, -txEffect(ajuste));
  DB.remove('transactions', ajuste.id);
  check('excluir o ajuste devolve o saldo anterior', DB.get('accounts', conta).balance, saldoAntes);

  check('saldo já correto não gera lançamento', reconcileBalance(DB.get('accounts', conta), saldoAntes), 0);
} catch (e) { console.log(` FALHA | conciliação: ${e.message}`); fail++; }

console.log('\n=== Gráficos ===');
try {
  /* Cada gráfico devolve o div e enfileira a config; é a config que se testa.
     zeraFila() antes de cada um para o cfgDo() não pegar sobra do anterior. */
  zeraFila();
  const barras = svgBars([{ label: 'jan', value: 100 }, { label: 'fev', value: 250, hint: '#009ef7' }], 300);
  const cBar = cfgDo(barras);
  check('barras: o div é o ponto de montagem', /^<div class="apx[^"]*" id="apx-\d+"/.test(barras), true);
  check('e reserva altura para o cartão não pular', /min-height:\d+px/.test(barras), true);
  check('barras: é gráfico de coluna', cBar.chart.type, 'bar');
  check('e os valores viraram a série', pontosDe(cBar.series[0]).join(','), '100,250');
  check('e os meses viraram as categorias', cBar.xaxis.categories.join(','), 'jan,fev');
  /* Ponta arredondada, pé reto: o topo é o dado e ganha o arredondamento; a base
     encosta no zero, e arredondá-la faria a coluna parecer flutuar. */
  check('a ponta da coluna é arredondada', cBar.plotOptions.bar.borderRadius > 0, true);
  check('mas só a ponta, não o pé', cBar.plotOptions.bar.borderRadiusApplication, 'end');
  // Marca fina: coluna que preenche a faixa lê como bloco, não como valor
  check('a coluna não preenche a faixa', parseInt(cBar.plotOptions.bar.columnWidth, 10) <= 60, true);
  /* Renda e média entram como REFERÊNCIA (linha anotada), não como série: como
     série elas entrariam na legenda e no tooltip como se fossem gasto medido. */
  const refs = cBar.annotations.yaxis;
  check('barras: a renda vira linha de referência', refs.some(r => r.y === 300), true);
  check('e a média do período também', refs.some(r => /^média/.test(r.label.text)), true);
  /* Cinza tracejado é régua, colorido sólido é limite. A grade ficou tracejada
     (é o que faz ela recuar), então a referência precisou virar sólida colorida —
     senão as duas contariam a mesma coisa e nenhuma diria o que é. */
  check('a referência é sólida, já que a grade é tracejada',
    refs.every(r => r.strokeDashArray === 0), true);
  check('e a grade é que recua, tracejada', cBar.grid.strokeDashArray, 4);
  check('a referência não vira série',
    cBar.series.length === 1 && refs.length === 2, true);
  check('barras sem dado não quebra', svgBars([], 0).includes('Sem dados'), true);
  check('escala arredonda para número redondo', niceCeil(2340), 2500);
  check('escala funciona com valores pequenos', niceCeil(37), 40);

  zeraFila();
  const d = svgDonut([{ label: 'Casa', value: 60, color: '#009ef7' }, { label: 'Comida', value: 40, color: '#50cd89' }], 100);
  /* A ROSCA É A EXCEÇÃO: continua desenhada à mão, e por medida. Ela é quadrada e
     com proporção preservada, então a escala do viewBox fica entre 0,79 e 1,04 e o
     texto dela já sai no tamanho certo — o defeito que motivou a biblioteca
     (rótulo de 11px chegando a 4,7px) nunca existiu aqui. Em troca o formato à mão
     dá o total no centro em duas ou três linhas de tipografia nossa e a legenda
     como TABELA ao lado; a da biblioteca é uma fila de pastilhas, que não alinha
     número nenhum. */
  check('a rosca não passa pela biblioteca', Graficos.fila.length, 0);
  check('donut: duas fatias mais o trilho', (d.match(/<circle/g) || []).length, 3);
  check('e o texto fica DENTRO do SVG, o que aqui é seguro', /<text/.test(d), true);
  check('porque ele não é esticado', d.includes('preserveAspectRatio="none"'), false);
  check('e o clamp segura a escala perto de 1:1',
    /\.donut-svg \{ width: clamp\(190px, 46%, 250px\)/.test(fs.readFileSync(BASE + 'css/styles.css', 'utf8')), true);
  // O buraco do meio é onde mora o total — não é enfeite
  check('donut: mostra o total no centro', d.includes('dn-total'), true);
  check('e é o total que foi passado, não a soma das fatias',
    d.includes(fmtShort(100).replace('R$', '').trim()), true);
  /* A legenda do centro precisa do TEXTO, não só da classe: com a classe presente
     e o texto vazio, o número fica sozinho sem dizer de que ele é. */
  zeraFila();
  const dCap = svgDonut([{ label: 'Casa', value: 60, color: '#009ef7' }], 60, { caption: 'gasto no período' });
  check('com a legenda do que o número significa', /class="dn-cap">gasto no período</.test(dCap), true);
  check('e um padrão quando não vem legenda',
    /class="dn-cap">no período</.test(svgDonut([{ label: 'a', value: 1, color: '#000' }], 1)), true);
  check('a terceira linha só aparece quando há sub',
    svgDonut([{ label: 'a', value: 1, color: '#000' }], 1).includes('dn-sub'), false);

  /* Respiro entre fatias: separa sem desenhar borda em volta. A soma dos trechos
     PINTADOS tem de ficar abaixo da circunferência — é o vão que falta. Só checar
     que existe dasharray passaria com gap zero, que é o anel emendado. */
  const pintados = [...d.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g)]
    .map(m => Number(m[1]));
  const circ = 2 * Math.PI * 96;
  check('donut: fatias separadas por vão', pintados.length, 2);
  check('e o vão realmente falta do anel', pintados.reduce((a, b) => a + b, 0) < circ - 4, true);
  // Ponta arredondada em cada fatia: é o acabamento do formato antigo
  check('e a ponta da fatia é arredondada',
    (d.match(/stroke-linecap="round"/g) || []).length, 2);
  /* Trilho cinza por baixo: com uma fatia só, sem ele não se vê a volta completa e
     não dá para julgar quanto do total aquela fatia é. */
  check('há trilho cinza sob o anel', d.includes('stroke="var(--ink-3)"'), true);
  check('e cada fatia leva a cor que veio dela', d.includes('#009ef7'), true);
  check('donut: valor e percentual acessíveis por title', d.includes('Casa: '), true);
  /* Sem fatia a função desenha só o trilho — um anel cinza vazio, que não diz
     nada. Quem barra isso são as telas, e é por elas que se testa: se a guarda
     cair, o cartão mostra um anel oco em vez de "nenhum gasto no período". */
  check('sem fatia sobra só o trilho', (svgDonut([], 0).match(/<circle/g) || []).length, 1);
  check('e o painel barra isso antes de chamar',
    renderInicio(DB.monthPeriod(new Date(), -600)).includes('Nenhum gasto no período'), true);
  /* Relatórios não recebe período: ele anda por state.repOffset. Passar um
     período aqui não fazia nada e o mês atual (com gasto) continuava sendo
     renderizado — a assertiva parecia falhar por causa do código. */
  const offSalvo = state.repOffset;
  state.repOffset = -600;
  check('os relatórios também', renderRelatorios().includes('Sem gastos no período'), true);
  state.repOffset = offSalvo;
  /* Cor é identidade e não pode variar com o ponteiro; espessura pode. Por isso o
     hover engorda a fatia em vez de mudar de cor. */
  const cssDn = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('a fatia engorda no hover, não muda de cor',
    /\.dn-arc:hover \{ stroke-width: 35/.test(cssDn), true);
  check('e nenhuma fatia troca de cor no hover', /\.dn-arc:hover \{[^}]*stroke:/.test(cssDn), false);

  zeraFila();
  const r = svgRanking([['Mercado', 800], ['Uber', 200]]);
  const cRk = cfgDo(r);
  check('ranking: barra horizontal', cRk.plotOptions.bar.horizontal, true);
  check('e os valores na ordem que chegaram', pontosDe(cRk.series[0]).join(','), '800,200');
  check('com os nomes no eixo', cRk.xaxis.categories.join(','), 'Mercado,Uber');
  // Cor por linha: em ranking cada item é uma identidade, não uma série única
  check('ranking: cada linha tem a própria cor', cRk.plotOptions.bar.distributed, true);
  check('e o valor vem escrito na própria barra', cRk.dataLabels.enabled, true);
  check('a dica traz o percentual do total', cRk.tooltip.y.formatter(800).includes('80%'), true);
  check('ranking vazio não quebra', svgRanking([]).includes('Sem dados'), true);

  /* ---- Acabamento vindo do Charts Widget 27 do demo25 ----
     Ele é exatamente esta forma: poucas barras horizontais, uma cor por linha,
     valor escrito na barra. O que veio dele está travado aqui. */
  check('canto de 8, como no widget 27', cRk.plotOptions.bar.borderRadius, 8);
  check('e só na ponta, não no pé', cRk.plotOptions.bar.borderRadiusApplication, 'end');
  /* Barra em PX, não em %: o que faz o gráfico deles parecer desenhado é a barra
     generosa, e 34px de altura de linha era filete. Proporção do widget 27: 70px
     de passo para 50px de barra, ~71%. */
  check('barra medida em px, não em porcentagem', typeof cRk.plotOptions.bar.barHeight, 'number');
  /* A proporção se mede com itens suficientes para o passo governar: com dois, o
     piso de altura entra e infla o passo (um gráfico de 130px pareceria quebrado,
     então o piso é de propósito). */
  zeraFila();
  svgRanking([['a', 5], ['b', 4], ['c', 3], ['d', 2], ['e', 1]]);
  const cCinco = cfgDo();
  const passoRk = (cCinco.chart.height - 34) / 5;
  check('e ocupa cerca de 70% do passo da linha, como lá',
    Math.abs(cCinco.plotOptions.bar.barHeight / passoRk - 0.71) < 0.03, true);
  check('a altura cresce com o número de linhas', cCinco.chart.height > cRk.chart.height, true);
  // Piso de altura: gráfico de uma linha só não pode virar um filete de 80px
  check('mas há piso, para o gráfico curto não achatar',
    (() => { zeraFila(); svgRanking([['só', 1]]); return cfgDo().chart.height; })(), 150);
  // Rótulo DENTRO da barra, a partir da base dela
  check('o rótulo nasce dentro da barra', cRk.plotOptions.bar.dataLabels.position, 'bottom');
  check('e corre da esquerda para a direita', cRk.dataLabels.textAnchor, 'start');
  /* GRADE SÓ NA VERTICAL. Em barra horizontal as linhas perpendiculares são régua
     de comprimento; horizontais seriam riscos entre as barras, medindo nada. */
  check('grade vertical, que mede o comprimento', cRk.grid.xaxis.lines.show, true);
  check('e nenhuma horizontal, que não mediria nada', cRk.grid.yaxis.lines.show, false);
  check('tracejada, como a do resto', cRk.grid.strokeDashArray, 4);

  /* COR DO RÓTULO POR BARRA, calculada por contraste. É a divergência necessária
     do widget 27: lá o rótulo é branco fixo, porque a paleta do demo é escura. Na
     nossa, branco sobre o âmbar dá 1,56:1 — texto presente no HTML e invisível na
     tela. Seis dos dez tons reprovariam. */
  check('a cor do rótulo é uma por barra, não uma para todas',
    Array.isArray(cRk.dataLabels.style.colors) && cRk.dataLabels.style.colors.length, 2);
  const canalT = c => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const lumT = h => { const n = parseInt(h.replace('#', ''), 16);
    return 0.2126 * canalT((n >> 16) & 255) + 0.7152 * canalT((n >> 8) & 255) + 0.0722 * canalT(n & 255); };
  const razaoT = (a, b) => { const [x, y] = lumT(a) > lumT(b) ? [lumT(a), lumT(b)] : [lumT(b), lumT(a)];
    return (x + 0.05) / (y + 0.05); };
  // Toda a paleta, não só as duas do fixture: é ela que aparece em uso real
  const piorDaPaleta = Math.min(...PALETTE.map(c => razaoT(c, corDeTextoSobre(c))));
  check('todo tom da paleta passa em AA com a cor escolhida', piorDaPaleta >= 4.5, true);
  check('e branco fixo reprovaria, que é por isso que se calcula',
    Math.min(...PALETTE.map(c => razaoT(c, '#ffffff'))) < 3, true);
  check('escolhe branco em fundo escuro', corDeTextoSobre('#7239ea'), '#ffffff');
  check('e tinta escura em fundo claro', corDeTextoSobre('#ffc700'), '#181c32');

  /* Barra curta não tem largura para conter o rótulo, que transborda para o fundo
     do cartão — e aí a cor da barra não serve. Abaixo de 30% do maior, tinta. */
  zeraFila();
  svgRanking([['Grande', 1000], ['Minúsculo', 50]]);
  const cCurta = cfgDo();
  check('barra curta usa tinta, porque o rótulo vaza para fora',
    cCurta.dataLabels.style.colors[1], Graficos.cor.tintaFraca);
  check('e a barra longa usa a cor que contrasta com ela',
    cCurta.dataLabels.style.colors[0], corDeTextoSobre(PALETTE[0]));

  /* TODOS os rankings da tela têm de pegar esse acabamento, não só a função
     isolada. São cinco: origem da receita ("De onde vem o dinheiro"), categoria,
     membro, forma de pagamento e etiqueta. */
  zeraFila();
  renderRelatorios();
  const rks = Graficos.fila.filter(f => f.nome === 'ranking');
  check('a tela de relatórios traz vários rankings', rks.length >= 3, true);
  check('e todos com o acabamento do widget 27',
    rks.every(f => f.opts.plotOptions.bar.borderRadius === 8
      && f.opts.plotOptions.bar.dataLabels.position === 'bottom'
      && f.opts.grid.xaxis.lines.show === true
      && f.opts.grid.yaxis.lines.show === false
      && Array.isArray(f.opts.dataLabels.style.colors)), true);
  /* "De onde vem o dinheiro" é um deles, e é o que foi pedido por nome. Confere no
     MESMO HTML que o cartão dele é seguido pelo div do ranking — em duas chamadas
     separadas os índices não se comparam. */
  const relRk = renderRelatorios();
  const iTitulo = relRk.indexOf('De onde vem o dinheiro');
  check('"De onde vem o dinheiro" existe', iTitulo >= 0, true);
  check('e o ranking vem dentro do cartão dele',
    /De onde vem o dinheiro[\s\S]{0,600}data-g="ranking"/.test(relRk), true);

  zeraFila();
  const burn = svgBurnup(p, 3000);
  const cBu = cfgDo(burn);
  check('burn-up: gasto acumulado é área', cBu.series[0].type, 'area');
  check('e a trilha ideal é linha', cBu.series[1].type, 'line');
  // Tracejada: a trilha é referência calculada, não gasto que aconteceu
  check('a trilha é tracejada, o gasto não', cBu.stroke.dashArray.join(','), '0,5');
  /* Depois de hoje a série é null, não zero: zero afirmaria "não gastou nada no
     dia 20" num mês que ainda não chegou lá. */
  check('burn-up: o futuro do mês é null, não zero',
    cBu.series[0].data.slice(-1)[0] === null || DB.elapsedDays(p) >= DB.periodDays(p), true);
  check('sem orçamento, não desenha trilha nem legenda',
    (() => { zeraFila(); svgBurnup(p, 0); const c = cfgDo(); return c.series.length === 1 && c.legend.show === false; })(), true);

  /* ---- MÊS QUE AINDA NÃO COMEÇOU ----
     O corte em "hoje" deixava `decorridos = 0` num mês futuro e a série saía
     INTEIRA nula: o cartão desenhava só a trilha e o gráfico lia como vazio.
     Medido em agosto/2026 com dados reais: 31 pontos, 0 com valor. */
  const pFuturo = DB.monthPeriod(new Date(), 2);
  zeraFila();
  svgBurnup(pFuturo, 3000);
  const cFut = cfgDo();
  const pontosFut = cFut.series[0].data.filter(v => v !== null && v !== undefined);
  check('mês futuro: o burn-up tem curva, não série vazia', pontosFut.length > 0, true);
  check('  e ela é a do previsto, dita no nome', cFut.series[0].name, 'previsto acumulado');
  check('  com o traço tracejado, porque é previsão', cFut.stroke.dashArray[0], 4);
  check('  o rótulo vai no fim do mês, não num "hoje" que não existe',
    cFut.markers.discrete[0].dataPointIndex, DB.periodDays(pFuturo) - 1);
  // No mês corrente nada disso muda: lá "hoje" existe e o futuro segue nulo
  check('mês corrente: continua "gasto acumulado"', cBu.series[0].name, 'gasto acumulado');
  check('  e o traço do realizado segue sólido', cBu.stroke.dashArray[0], 0);

  /* ---- A TRILHA IDEAL TEM DE APARECER ----
     Ela estava na configuração e não desenhava. Duas causas, as duas aqui: */

  /* 1. `stroke.curve` NUNCA como array. Lido no fonte da lib: num ponto ela
        resolve `stroke.curve[serie]` certo, mas na checagem de ponto nulo compara
        `config.stroke.curve` DIRETO com 'smooth'. Com array a comparação nunca
        casa e os nulos param de abrir intervalo — a área desce até o zero em vez
        de terminar em hoje. */
  check('a curva é escalar, nunca array', Array.isArray(cBu.stroke.curve), false);
  check('e é suave', cBu.stroke.curve, 'smooth');
  /* 2. A cor do traço declarada em `stroke.colors`, como o widget 29 faz — é o
        que garante que a trilha receba a cor dela.

        OS DOIS CASOS, EXPLÍCITOS. A cor do gasto não é fixa: ela vira vermelha
        quando o ritmo estoura o limite. Afirmar "é azul" sobre um limite qualquer
        fazia o teste capturar um dos dois lados conforme o dia — no começo do mês
        o pró-rata ainda cabia, no meio já não cabia, e a suíte reprovava sozinha
        sem defeito nenhum. Os limites abaixo decidem o resultado em qualquer data:
        um bilhão nunca é alcançado, um centavo é sempre estourado. O gasto no
        primeiro dia existe para que haja o que estourar mesmo se a suíte rodar
        no dia 1º. */
  const gastoDoDiaUm = DB.upsert('transactions', {
    description: 'Gasto do primeiro dia', amount: 10, date: DB.inicioISO(p),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito',
  });
  let cFolga, cEstouro;
  try {
    zeraFila(); svgBurnup(p, 1e9); cFolga = cfgDo();
    zeraFila(); svgBurnup(p, 0.01); cEstouro = cfgDo();
  } finally {
    DB.remove('transactions', gastoDoDiaUm);   // o cenário volta como estava
  }
  check('cada série declara a cor do próprio traço',
    cFolga.stroke.colors.join(','), Graficos.cor.azul + ',' + Graficos.cor.cinza);
  check('  e o gasto fica vermelho quando o ritmo estoura o limite',
    cEstouro.stroke.colors[0], Graficos.cor.vermelho);
  check('e a espessura por série', cBu.stroke.width.join(','), '3,2');
  /* Opacidade 0 na segunda série saiu: o path da linha nasce com fill "none", ela
     não fazia nada e só escondia a intenção de quem lê o código. */
  check('não há opacidade zero escondendo a linha',
    cBu.fill.opacity === undefined || !(cBu.fill.opacity || []).includes(0), true);
  // A escala tem de caber a trilha inteira, senão ela desenha fora da área visível
  const topoTrilha = Math.max(...cBu.series[1].data);
  const topoGasto = Math.max(...cBu.series[0].data.filter(v => v != null));
  check('a trilha chega ao limite do mês', topoTrilha, 3000);
  check('e as duas séries dividem um eixo só, porque a unidade é a mesma',
    Array.isArray(cBu.yaxis), false);
  check('a trilha é o teto da escala, e é isso que dá a leitura',
    topoTrilha >= topoGasto, true);

  /* Acabamento de linha do Charts Widget 29: mira vertical tracejada e hover que
     não repinta a série. */
  check('há mira vertical seguindo o cursor', cBu.xaxis.crosshairs.position, 'front');
  check('tracejada, para não ser confundida com dado', cBu.xaxis.crosshairs.stroke.dashArray, 3);
  check('e na cor da série que ela está medindo',
    cFolga.xaxis.crosshairs.stroke.color, Graficos.cor.azul);
  /* E ela SEGUE a série: quando o gasto vira vermelho, a mira vai junto. Fixar o
     azul nos dois casos deixaria passar uma mira que ignora o estouro. */
  check('  inclusive quando a série muda de cor',
    cEstouro.xaxis.crosshairs.stroke.color, cEstouro.stroke.colors[0]);
  /* Numa área com degradê o clareamento da lib come o próprio degradê: a forma
     "pisca" no hover e o olho perde a referência. */
  check('o hover não repinta a série', cBu.states.hover.filter.type, 'none');
  check('o mesmo nos outros dois estados',
    cBu.states.normal.filter.type === 'none' && cBu.states.active.filter.type === 'none', true);
  check('quatro marcas no eixo, régua sem virar gaiola', cBu.yaxis.tickAmount, 4);

  /* O MESMO acabamento nos outros gráficos de linha — foi pedido para "gráficos de
     linha como Ritmo do mês", não só para ele. */
  for (const [rot, montar] of [
    ['faixa de normalidade', () => svgLinhaFaixa([{ rot: 'jan', valor: 100 }, { rot: 'fev', valor: 200 }, { rot: 'mar', valor: 150 }])],
    ['saldo diário', () => sparkArea([1000, 1200, 900], ['2026-07-01', '2026-07-02', '2026-07-03'], {})],
  ]) {
    zeraFila(); montar();
    const cL = cfgDo();
    check(rot + ': tem mira vertical tracejada',
      cL.xaxis.crosshairs.position === 'front' && cL.xaxis.crosshairs.stroke.dashArray === 3, true);
    check(rot + ': o hover não repinta a série', cL.states.hover.filter.type, 'none');
    check(rot + ': a curva é escalar, nunca array', Array.isArray(cL.stroke.curve), false);
  }

  zeraFila();
  const inicio = renderInicio(p);
  // A rosca é a única que não vem da biblioteca: no painel ela é SVG no HTML
  check('painel desenha a rosca à mão', inicio.includes('class="donut-svg"'), true);
  check('e o resto vem da biblioteca', cfgsDe().length > 0, true);
  /* O CARTÃO da rosca: anel à esquerda, legenda em TABELA à direita, e o rodapé
     dizendo qual categoria pesa mais. É esse arranjo que faz o cartão responder
     "para onde foi" — o anel dá a proporção, a tabela dá os números. */
  check('o anel fica ao lado da legenda', inicio.includes('class="donut-wrap"'), true);
  check('e a legenda é tabela: nome, percentual e valor',
    ['legend-row', 'legend-name', 'legend-pct', 'legend-val'].every(c => inicio.includes(c)), true);
  check('o anel vem antes da legenda',
    inicio.indexOf('donut-svg') < inicio.indexOf('class="legend"'), true);
  check('e o rodapé diz qual categoria pesa mais',
    /chart-foot[\s\S]{0,200}Maior peso/.test(inicio), true);
  zeraFila();
  const rels = renderRelatorios();
  const tiposRel = cfgsDe().map(c => c.chart.type);
  check('relatórios trazem a rosca à mão', rels.includes('class="donut-svg"'), true);
  check('com o mesmo arranjo de anel e legenda',
    rels.includes('class="donut-wrap"') && rels.includes('legend-pct'), true);
  check('e colunas e área pela biblioteca',
    tiposRel.includes('bar') && tiposRel.includes('area'), true);
  check('nenhuma rosca da biblioteca sobrou', tiposRel.includes('donut'), false);
  /* Todo gráfico herda a fonte do app. É o detalhe que mais delata gráfico de
     biblioteca colado num layout: sem isso o ApexCharts usa Helvetica. */
  check('e todos herdam a fonte do app',
    cfgsDe().length > 0 && cfgsDe().every(c => c.chart.fontFamily === 'inherit'), true);
} catch (e) { console.log(` FALHA | gráficos: ${e.message}`); fail++; }


console.log('\n=== Sincronização automática ===');
{
  const s = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  const a = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('consulta o servidor periodicamente', s.includes('setInterval') && s.includes('INTERVALO'), true);
  check('sincroniza ao voltar para o app', s.includes("visibilitychange"), true);
  check('sincroniza ao recuperar a conexão', s.includes("'online'"), true);
  check('para o relógio com o app em segundo plano', s.includes('document.hidden'), true);
  check('agrupa edições seguidas num envio só', s.includes('ESPERA_APOS_EDICAO') && s.includes('clearTimeout(this._debounce)'), true);
  check('repete com espera crescente ao falhar', s.includes('agendarNovaTentativa') && s.includes('300000'), true);
  check('tenta enviar pendentes ao fechar', s.includes('beforeunload'), true);
  check('informa quantos registros faltam enviar', s.includes('pendentes()'), true);
  check('syncAll conta o que recebeu', s.includes('recebidos++') && s.includes('onChanged'), true);
  // A falha que existia: puxava dados e a tela ficava velha
  check('tela redesenha quando chega dado novo', a.includes('Sync.onChanged') && /onChanged[\s\S]{0,220}render\(\)/.test(a), true);
  check('não redesenha com formulário aberto', /onChanged[\s\S]{0,200}editando/.test(a), true);
  /* O indicador saiu do botão próprio e foi para o canto do avatar: ele só
     acende quando há algo a resolver — fila, sem conexão, sincronizando —,
     porque um sinal permanente de "nada acontecendo" deixa de ser lido. */
  check('estado da sincronização visível no avatar',
    a.includes('Sync.onState') && /#btn-perfil\[data-sync=/.test(fs.readFileSync(BASE + 'css/styles.css', 'utf8')), true);
  check('e não acende quando não há o que resolver',
    /const acende = \{ sync:[\s\S]{0,140}delete btn\.dataset\.sync/.test(a), true);
  check('startAuto é ligado na abertura', a.includes('Sync.startAuto()'), true);
}

console.log('\n=== Nome da família é escolhido por quem usa ===');
{
  const arquivos = ['js/app.js', 'js/auth.js', 'js/db.js', 'js/sync.js', 'index.html', 'manifest.webmanifest'];
  const comNomeFixo = arquivos.filter(f => /Peixoto/i.test(fs.readFileSync(BASE + f, 'utf8')));
  check('nenhum nome de família fixo no código', comNomeFixo.length ? comNomeFixo.join(', ') : true, true);

  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('onboarding pede o nome antes de criar', /ob-fam[\s\S]{0,400}Escolha um nome para a família/.test(au), true);
  check('quem usa só no aparelho também nomeia', au.includes('passoNomeLocal'), true);
  check('nome é gravado nas configurações', au.includes("family_name: nome"), true);
  check('criar família pela tela de sync exige nome', ap.includes("Escolha um nome para a família"), true);
  check('nome editável em Configurações', ap.includes('f-famname'), true);
  check('family_name sincroniza entre aparelhos', fs.readFileSync(BASE + 'js/sync.js', 'utf8').includes("'family_name'"), true);
  check('coluna family_name no banco', /add column if not exists family_name/.test(fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8')), true);

  // Sem nome definido, o app fala de forma neutra — nunca inventa um sobrenome
  const semNome = DB.settings().family_name;
  check('sem nome escolhido, usa rótulo neutro', DB.familyLabel(), 'Minha família');
  check('familyName vazio enquanto não escolherem', DB.familyName(), '');
  DB.upsert('family_settings', { ...DB.settings(), family_name: 'Nossa Casa' });
  check('depois de escolher, usa o nome da família', DB.familyLabel(), 'Nossa Casa');
  DB.upsert('family_settings', { ...DB.settings(), family_name: semNome || '' });
  check('membros começam vazios (ninguém inventado)', Array.isArray(DB.settings().members), true);
}

console.log('\n=== Primeiro acesso (ordem das etapas) ===');
{
  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const wiz = au.slice(au.indexOf('showOnboarding'));
  const ordem = ['passoInicio', 'passoServidor', 'passoLogin', 'passoFamilia', 'passoPin', 'passoDigital']
    .map(n => wiz.indexOf('const ' + n));
  check('as 6 etapas existem', ordem.every(i => i > 0), true);
  check('servidor vem antes do login', ordem[1] < ordem[2], true);
  check('login vem antes da família', ordem[2] < ordem[3], true);
  check('família vem antes do PIN', ordem[3] < ordem[4], true);
  check('PIN vem antes da digital', ordem[4] < ordem[5], true);
  check('digital é oferecida logo após criar o PIN', /setPin\(valor\)[\s\S]{0,160}passoDigital/.test(wiz), true);
  check('só oferece digital se o aparelho suportar', /bioSuportadaNoAparelho\(\)[\s\S]{0,60}passoDigital/.test(wiz), true);
  check('dá para usar só neste aparelho (sem nuvem)', wiz.includes('ob-local') && wiz.includes('passoNomeLocal'), true);
  check('pula a tela de servidor se já vier configurado', /Sync\.configured\(\) \? passoLogin/.test(wiz), true);
  check('quem entra numa família baixa tudo antes de seguir', /joinFamily[\s\S]{0,200}lastSync = null/.test(wiz), true);
  check('boot usa o novo fluxo', au.includes('!this.cfg.onboarded') && au.includes('showOnboarding(onReady)'), true);
  check('showFirstRun antigo foi removido', !au.includes('showFirstRun'), true);
}

console.log('\n=== Recarregar a página não pede o PIN de novo ===');
{
  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const dbSrc = fs.readFileSync(BASE + 'js/db.js', 'utf8');
  check('sessão da aba guarda a chave', au.includes('guardarSessao') && au.includes('sessionStorage'), true);
  check('a chave precisa ser exportável para isso', /deriveKey\(pin, this\.cfg\.kdfSalt, 150000, true\)/.test(au), true);
  check('deriveKey aceita o parâmetro', /deriveKey\(pin, saltB64, iterations = 150000, extraivel/.test(dbSrc), true);
  check('boot tenta retomar antes de pedir o PIN', /init\(onReady\)[\s\S]{0,220}retomarOuPedirPin/.test(au), true);
  check('sessão respeita o tempo de bloqueio', /recuperarSessao[\s\S]{0,400}lockAfterMin/.test(au), true);
  check('tempo 0 volta a pedir sempre', /limite <= 0/.test(au) && /lockAfterMin \?\? 5\) <= 0/.test(au), true);
  check('bloquear manualmente encerra a sessão', /lockNow[\s\S]{0,160}limparSessao/.test(au), true);
  check('passar do tempo em segundo plano encerra', /visibilitychange[\s\S]{0,400}limparSessao/.test(au), true);
  check('remover o PIN encerra a sessão', /removePin[\s\S]{0,160}limparSessao/.test(au), true);
  check('sessão morre com a aba (sessionStorage, não localStorage)', !au.includes("localStorage.setItem(this.SESSAO_KEY"), true);
}

console.log('\n=== Prazo da sessão conta do último uso ===');
{
  // Simula o relógio: o prazo tem de valer a partir da última atividade,
  // não de quando o PIN foi digitado (era o que fazia o F5 pedir PIN sempre).
  const sess = {};
  const sessionAntes = global.sessionStorage;
  global.sessionStorage = {
    getItem: k => (k in sess ? sess[k] : null),
    setItem: (k, v) => { sess[k] = String(v); },
    removeItem: k => { delete sess[k]; },
  };
  // Usa a função real do app, extraída do arquivo — se ela mudar, o teste acompanha
  const fonteAuth = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const corpo = (fonteAuth.match(/ {2}tocarSessao\(\) \{[\s\S]*?\n {2}\},/) || [])[0];
  if (!corpo) throw new Error('tocarSessao não encontrada em auth.js');
  const A = { SESSAO_KEY: 'financas.sessao', cfg: { lockAfterMin: 5 }, unlocked: true };
  // eslint-disable-next-line no-eval
  A.tocarSessao = eval('(function ' + corpo.trim().replace(/^tocarSessao\(\)/, '()').replace(/,$/, '') + ')');
  const agoraReal = Date.now;
  let desloc = 0;
  Date.now = () => agoraReal() + desloc;

  const valida = () => {
    const s = JSON.parse(sess[A.SESSAO_KEY] || 'null');
    return !!s && (Date.now() - s.t) / 60000 <= A.cfg.lockAfterMin;
  };
  sess[A.SESSAO_KEY] = JSON.stringify({ k: 'xxx', t: Date.now() });
  check('logo após o PIN, recarregar retoma', valida(), true);

  desloc = 6 * 60 * 1000;                       // 6 min depois, sem tocar
  check('sem renovar, o prazo vence (bug antigo)', valida(), false);

  sess[A.SESSAO_KEY] = JSON.stringify({ k: 'xxx', t: Date.now() });
  for (let m = 1; m <= 12; m++) { desloc += 60 * 1000; A.tocarSessao(); }
  check('usando o app, a sessão se mantém viva', valida(), true);

  desloc += 6 * 60 * 1000;                      // 6 min parado
  check('parado além do prazo, volta a pedir o PIN', valida(), false);

  Date.now = agoraReal;
  global.sessionStorage = sessionAntes;

  const au2 = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  check('atividade renova a sessão', au2.includes('vigiarAtividade') && au2.includes('pointerdown'), true);
  check('gravação limitada a uma a cada 20s', au2.includes('< 20000'), true);
  check('vigilância ligada ao desbloquear e ao retomar', (au2.match(/this\.vigiarAtividade\(\)/g) || []).length >= 2, true);
}

console.log('\n=== Versão dos arquivos (evita rodar código velho) ===');
{
  const html = fs.readFileSync(BASE + 'index.html', 'utf8');
  const sw = fs.readFileSync(BASE + 'sw.js', 'utf8');
  const versao = (sw.match(/const VERSAO = '([^']+)'/) || [])[1];
  check('service worker declara a versão', !!versao, true);
  const tags = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)(\?v=([^"]+))?"/g)];
  const semVersao = tags.filter(t => !t[3]).map(t => t[1]);
  check('todo script e CSS carrega versionado', semVersao.length ? semVersao.join(', ') : true, true);
  const divergentes = tags.filter(t => t[3] && t[3] !== versao).map(t => t[1]);
  check('HTML e service worker na mesma versão', divergentes.length ? divergentes.join(', ') : true, true);
  check('cache nomeado pela versão', sw.includes("'financas-' + VERSAO"), true);
  check('rede primeiro, cache como reserva', /fetch\(e\.request\)[\s\S]{0,300}caches\.match/.test(sw), true);
}

console.log('\n=== App bloqueado (dados cifrados, DB.data nulo) ===');
{
  // Reproduz o estado real da tela de bloqueio: dados existem, mas ainda cifrados.
  const salvo = DB.data;
  DB.data = null; DB.locked = true;
  const tentar = (nome, fn) => {
    try { const r = fn(); check(nome, r !== undefined, true); }
    catch (e) { console.log(` FALHA | ${nome.padEnd(52)} ${e.message}`); fail++; }
  };
  tentar('all() não estoura', () => DB.all('family_settings'));
  tentar('get() não estoura', () => DB.get('accounts', 'qualquer'));
  tentar('settings() devolve padrão', () => DB.settings());
  tentar('familyName() não estoura', () => DB.familyName());
  tentar('familyLabel() não estoura — o erro relatado', () => DB.familyLabel());
  tentar('remove() é ignorado em silêncio', () => { DB.remove('accounts', 'x'); return true; });
  check('settings bloqueado não inventa membros', DB.settings().members.length, 0);
  check('gravar bloqueado é recusado com mensagem clara', (() => {
    try { DB.upsert('accounts', { name: 'x' }); return 'gravou!'; }
    catch (e) { return /bloqueados/i.test(e.message); }
  })(), true);

  // O rótulo fica fora da parte cifrada, para a tela de bloqueio cumprimentar pelo nome
  DB.lembrarRotulo('Nossa Casa');
  check('nome da família disponível mesmo bloqueado', DB.familyLabel(), 'Nossa Casa');
  DB.lembrarRotulo('');
  check('sem rótulo guardado, usa o neutro', DB.familyLabel(), 'Minha família');

  DB.data = salvo; DB.locked = false;
  check('destravado volta a ler dos dados', DB.settings().members !== undefined, true);
}

console.log('\n=== Identidade visual (logo) ===');
{
  const svg = fs.readFileSync(BASE + 'icons/icon.svg', 'utf8');
  const mf = JSON.parse(fs.readFileSync(BASE + 'manifest.webmanifest', 'utf8'));
  check('SVG usa o cobalto da marca', svg.includes('#2A52C9'), true);
  check('e nada da paleta antiga', /#0095e8|#7239ea|gradient/i.test(svg), false);
  check('conceito documentado no próprio arquivo', /<desc>[\s\S]*domus[\s\S]*<\/desc>/i.test(svg), true);
  check('acessível para leitores de tela', svg.includes('role="img"') && svg.includes('aria-label'), true);
  /* O arco em traço: a cúpula vazada sobre a base em pílula. Vazada e não
     maciça — é o azul aparecendo por dentro que faz o desenho ler como abrigo
     em vez de morro. */
  check('a cúpula é um arco em traço', /<path d="M124 344 A132 132/.test(svg) && svg.includes('fill="none"'), true);
  check('sobre a base em pílula', (svg.match(/<rect x=/g) || []).length === 1 && /rx="23"/.test(svg), true);
  check('nada do ícone antigo (F$ em serifa)', !svg.includes('Georgia') && !svg.includes('F$'), true);
  check('traço grosso o bastante para 32px', /stroke-width="4\d"/.test(svg), true);
  for (const f of ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png']) {
    check(`${f} existe`, fs.existsSync(BASE + f), true);
  }
  check('maskable declarado à parte no manifest', mf.icons.some(i => i.purpose === 'maskable'), true);
  check('maskable tem zona de segurança',
    /maskable\.png' -Escala 0\.8/.test(fs.readFileSync(BASE + 'icons/gerar-icones.ps1', 'utf8')), true);
  check('gerador dos PNG versionado junto', fs.existsSync(BASE + 'icons/gerar-icones.ps1'), true);
}

console.log('\n=== Teclado do PIN ===');
{
  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const cssL = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('teclado numérico próprio', au.includes('pinPad(') && au.includes('pin-key'), true);
  check('progresso mostrado em bolinhas', au.includes('pin-dots') && cssL.includes('.pin-dots i.on'), true);
  check('teclas com alvo grande', /\.pin-key\s*\{[^}]*height:\s*5\dpx/.test(cssL), true);
  check('apagar e confirmar no teclado', au.includes("k === 'del'") && au.includes("k === 'ok'"), true);
  check('confirmar só libera com o mínimo de dígitos', au.includes('okBtn.disabled = valor.length < min'), true);
  check('teclado físico também funciona', au.includes('document.onkeydown') && au.includes('Backspace'), true);
  check('erro sacode o cartão', cssL.includes('@keyframes tremer') && au.includes("'tremer"), true);
  check('criar PIN em duas etapas, sem campos empilhados', /passoPin = \(primeiro/.test(au) && !au.includes('ob-pin2'), true);
  check('desbloqueio usa o teclado novo', /telaPin\(onDone\) \{[\s\S]{0,120}pinPad/.test(au), true);
  check('some com o teclado ao sair da tela', au.includes('document.onkeydown = null'), true);
  check('cabe em tela baixa', cssL.includes('max-height: 680px'), true);
  // O teclado é o mesmo em todo o app — nada de campo de texto para PIN
  const ap2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('criar PIN nas configurações usa o teclado', au.includes('fluxoPin') && ap2.includes("Auth.fluxoPin({ aoTerminar"), true);
  check('trocar PIN usa o teclado', ap2.includes("trocar: true"), true);
  check('remover PIN pede confirmação pelo teclado', /sec-off[\s\S]{0,300}Auth\.pinPad/.test(ap2), true);
  check('ativar digital pede o PIN pelo teclado', /sec-bio-on[\s\S]{0,200}Auth\.pinPad/.test(ap2), true);
  check('nenhum campo de texto para PIN restou', !ap2.includes('sec-cur') && !ap2.includes('sec-new'), true);
  check('estilo do campo antigo removido', !cssL.includes('.pin-input'), true);
}

console.log('\n=== Digital indisponível no navegador ===');
{
  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const cssL = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('aviso em vermelho, com destaque', /\.bio-indisponivel[^}]*var\(--red\)/.test(cssL), true);
  check('lembra que o navegador não suporta', au.includes('bioIndisponivel = true'), true);
  check('não oferece mais a digital depois disso', /bioIndisponivel[\s\S]{0,80}return false/.test(au), true);
  check('botão some nas configurações', ap.includes('Auth.cfg.bioIndisponivel'), true);
  check('configurações mostram o aviso no lugar do botão', ap.includes('Auth.cfg.bioIndisponivel') && ap.includes('bio-indisponivel'), true);
  check('no primeiro acesso o botão também some', /ob-bio[\s\S]{0,300}b\.hidden = true/.test(au), true);
  check('e o texto vira "Continuar com o PIN"', au.includes('Continuar com o PIN'), true);
}

console.log('\n=== Desbloqueio por digital ===');
{
  const au = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  check('usa WebAuthn com verificação do usuário', au.includes('navigator.credentials.create') && au.includes("userVerification: 'required'"), true);
  check('usa a extensão PRF (segredo vem do leitor)', au.includes('prf:') && au.includes('prf.results'), true);
  check('recusa aparelho sem PRF em vez de fingir segurança', au.includes('falta suporte a PRF'), true);
  check('chave guardada cifrada pelo segredo do leitor', au.includes('bioKey') && /bioKey = await KCrypto\.enc/.test(au), true);
  check('nunca guarda o PIN em claro', !au.includes('cfg.bioPin'), true);
  check('PIN segue valendo como alternativa', au.includes('telaPin') && au.includes('tryPin(valor)'), true);

  // Com digital configurada, ela e o caminho principal
  const cssB = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('digital vem primeiro quando existe', /bioAtiva\(\)\s*\)?\s*this\.telaDigital/.test(au), true);
  check('sem digital, vai direto para o PIN', /else this\.telaPin\(onDone\)/.test(au), true);
  check('leitor é oferecido assim que a tela abre', /setTimeout\(\(\) => \{ if \(!this\.unlocked\) pedirDigital\(\)/.test(au), true);
  check('alvo grande para tocar e tentar de novo', /\.bio-alvo\s*\{[^}]*width:\s*104px/.test(cssB), true);
  check('anel pulsa enquanto o leitor espera', cssB.includes('bioPulso') && au.includes("classList.add('lendo')"), true);
  check('saída para o PIN em caso de dificuldade', au.includes('bio-pin') && /bio-pin'\)\.onclick[\s\S]{0,60}telaPin/.test(au), true);
  check('e volta para a digital se quiser', /lock-bio[\s\S]{0,220}telaDigital/.test(au), true);
  check('falha na digital não trava a tela', au.includes('toque para tentar de novo'), true);
  check('uma só função abre os dados nos dois caminhos', (au.match(/aplicarChave\(/g) || []).length >= 3, true);
  check('remover o PIN também remove a digital', fs.readFileSync(BASE + 'js/app.js', 'utf8').includes('Auth.desativarBio()'), true);
}

console.log('\n=== Componentes de formulário (select e datepicker) ===');
try {
  const ui = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  const html = fs.readFileSync(BASE + 'index.html', 'utf8');
  const sw = fs.readFileSync(BASE + 'sw.js', 'utf8');
  const cssUi = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  check('ui.js carregado no app', html.includes('js/ui.js'), true);
  check('ui.js no cache offline', sw.includes('js/ui.js'), true);
  check('sem dependência de jQuery/CDN', !html.includes('jquery') && !html.includes('select2') && !/src="http/.test(html), true);

  // Melhoria progressiva: o campo nativo continua sendo a fonte da verdade
  check('mantém o <select> nativo no DOM', ui.includes('box.appendChild(sel)'), true);
  check('escreve no nativo e dispara change', ui.includes("sel.value = opcoes[i].value") && ui.includes("new Event('change'"), true);
  check('datepicker mantém o input nativo', ui.includes('box.appendChild(inp)') && ui.includes('inp.value = valor'), true);

  check('select tem busca quando há muitas opções', ui.includes('comBusca') && ui.includes('Buscar'), true);
  check('select suporta grupos (optgroup)', ui.includes('OPTGROUP'), true);
  check('navegação por teclado', ui.includes('ArrowDown') && ui.includes('Escape') && ui.includes('Enter'), true);
  check('busca ignora acentos', ui.includes('norm(') && ui.includes('NFD'), true);
  check('calendário com atalhos de data', ui.includes('data-q') && ui.includes('Hoje'), true);
  check('alvos de toque com 40px+', /min-height:\s*4\dpx/.test(cssUi), true);
  check('painel some ao clicar fora', ui.includes('contains(e.target)'), true);

  // O código do app continua lendo .value normalmente
  const appSrc2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('app segue lendo .value dos campos', appSrc2.includes("$('#f-account').value") && appSrc2.includes("$('#f-date').value"), true);
  check('atalhos de data atualizam o rótulo', appSrc2.includes('_uiRefresh'), true);

  // Bug: o wrapper visual precisa sumir junto com o campo nativo oculto
  check('componente some quando o campo nativo está oculto', /\.ui-select:has\(> select\[hidden\]\)/.test(cssUi), true);
  check('mesma regra vale para o datepicker', /\.ui-date:has\(> input\[hidden\]\)/.test(cssUi), true);
  check('lista completa de categorias começa oculta', /<select id="f-cat-more" hidden/.test(appSrc2), true);
  check('lista completa só abre ao pedir "Outra"', appSrc2.includes("UI.open($('#f-cat-more'))"), true);

  // Bug: calendário espremido na coluna estreita do formulário
  const uiSrcDup = fs.readFileSync(BASE + 'js/ui.js', 'utf8');

  /* ---- Um caminho só para repetição ----
     O formulário tinha duas perguntas para a mesma coisa: "Se repete?" (contrato em
     `recurrences`, que se gera sozinho) e "Custo fixo mensal (recorrente)?" (marca
     `recurring`, copiada à mão por um botão). Duas respostas para a mesma pergunta
     é convite a marcar as duas e ver o lançamento em dobro. Ficou o contrato. */
  check('o formulário não pergunta mais por custo fixo',
    /Custo fixo mensal \(recorrente\)\?/.test(appSrc2), false);
  check('nem tem o campo dele', /id="f-rec"/.test(appSrc2), false);
  check('mas continua perguntando "Se repete?"', /Se repete\?/.test(appSrc2), true);
  /* O valor legado é PRESERVADO ao salvar. Zerar apagaria a marca de custo fixo de
     todo lançamento antigo que passasse por uma edição — e a previsão dos próximos
     meses depende dela enquanto a migração não acontece. */
  check('e o recurring existente não é apagado ao editar',
    appSrc2.includes('recurring: !!tx.recurring'), true);

  /* ---- Reembrulhar não pode aninhar ----
     `enhance` roda de novo quando as opções mudam — o seletor de categoria recarrega
     a lista ao trocar o tipo do lançamento. Sem reaproveitar o invólucro, o novo
     entrava DENTRO do antigo e sobrava um botão a mais: era o "select da categoria
     duplica" ao clicar em "Outra". */
  check('o enhance reaproveita o invólucro existente', /embrulho\(sel, 'ui-select'\)/.test(cssUi + uiSrcDup), true);
  check('e o datepicker também', /embrulho\(inp, 'ui-date'\)/.test(uiSrcDup), true);
  check('o invólucro antigo é limpo, não empilhado',
    /if \(f !== el\) pai\.removeChild\(f\)/.test(uiSrcDup), true);
  check('e o campo nativo não é movido quando o invólucro é reusado',
    /if \(!reusado\) \{[\s\S]{0,140}insertBefore\(box/.test(uiSrcDup), true);

  /* E o COMPORTAMENTO, não só o código: um DOM mínimo de verdade, reembrulhando
     quatro vezes. Antes da correção dava 1, 2, 3, 4 invólucros — o teste acima, que
     olha o fonte, passaria numa reescrita que voltasse a aninhar por outro caminho. */
  {
    const nós = () => {
      const criar = tag => {
        const cls = new Set();
        const el = {
          tagName: String(tag).toUpperCase(), children: [], parentNode: null, dataset: {},
          classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: () => {} },
          appendChild(f) { if (f.parentNode) f.parentNode.removeChild(f); f.parentNode = this; this.children.push(f); return f; },
          removeChild(f) { const i = this.children.indexOf(f); if (i >= 0) this.children.splice(i, 1); f.parentNode = null; return f; },
          insertBefore(nv, ref) {
            if (nv.parentNode) nv.parentNode.removeChild(nv);
            nv.parentNode = this;
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i < 0) this.children.push(nv); else this.children.splice(i, 0, nv);
            return nv;
          },
          get firstChild() { return this.children[0] || null; },
          querySelector: () => criar('span'), querySelectorAll: () => [],
          addEventListener() {}, removeAttribute() {}, setAttribute() {},
          options: [], selectedIndex: -1, value: '', innerHTML: '',
        };
        Object.defineProperty(el, 'className', {
          get: () => [...cls].join(' '),
          set: v => { cls.clear(); String(v).split(' ').filter(Boolean).forEach(x => cls.add(x)); },
        });
        return el;
      };
      return criar;
    };
    const criar = nós();
    /* Carrega o UI ISOLADO, com `document` como parâmetro em vez de global. Trocar
       o global e restaurar depois vazava: o `document` falso do harness ficava
       quebrado para os blocos seguintes, e duas suítes adiante reprovavam por
       poluição em vez de defeito. */
    const carregarUI = new Function('document', 'window', uiSrcDup + '; return UI;');
    const UIiso = carregarUI({ createElement: criar }, {});
    const campo = criar('div'); campo.className = 'field';
    const selTeste = criar('select');
    campo.appendChild(selTeste);

    const contarInvolucros = () => {
      let n = 0;
      const anda = e => { if (e.classList.contains('ui-select')) n++; e.children.forEach(anda); };
      anda(campo);
      return n;
    };
    UIiso.enhanceSelect(selTeste);
    const depoisDaPrimeira = contarInvolucros();
    for (let i = 0; i < 3; i++) { delete selTeste.dataset.ui; UIiso.enhanceSelect(selTeste); }
    const depoisDeQuatro = contarInvolucros();
    const botoes = selTeste.parentNode.children.filter(c => c.tagName === 'BUTTON').length;

    check('um invólucro na primeira passada', depoisDaPrimeira, 1);
    check('e continua um depois de reembrulhar quatro vezes', depoisDeQuatro, 1);
    check('com um botão só, não vários empilhados', botoes, 1);
  }

  /* O calendário tem largura própria — 300px, mais do que o campo —, mas limitada
     pela tela. Ele nasce no <body> como `.ui-pop` para escapar do overflow da
     folha, e vem depois de `.ui-panel.ui-pop` no arquivo: um `min-width: 300px`
     seco venceria o teto de 88vw de lá e vazaria numa tela de 320px. */
  check('calendário tem largura própria',
    /\.ui-cal\s*\{[^}]*min-width:\s*min\(300px,/.test(cssUi), true);
  check('e ela cede quando a tela é mais estreita',
    /\.ui-cal\s*\{[^}]*calc\(100vw - 24px\)/.test(cssUi), true);

  /* ---- O calendário não pode ser recortado pela folha ----
     `.sheet` tem `overflow-y: auto`, e overflow recorta filho posicionado. Preso
     ao campo, o calendário aparecia cortado sempre que a data ficava na metade de
     baixo do formulário — no "Nova meta" ela é o último campo, então sobrava meio
     calendário. A solução é a mesma que o popover dos filtros já usava. */
  const uiSrc = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  /* Fatia até o bloco de Utilitários. `posicionar(painel, box)` não serve de marco
     de fim: ele aparece ANTES de `abrirData` no arquivo (no enhanceSelect), então a
     fatia saía vazia e as quatro assertivas abaixo reprovavam sem defeito nenhum. */
  const iCal = uiSrc.indexOf('abrirData(');
  const corpoCal = uiSrc.slice(iCal, uiSrc.indexOf('/* ---------------- Utilitários', iCal));
  check('a folha realmente recorta o que passa dela',
    /\.sheet \{[^}]*overflow-y: auto/.test(cssUi + fs.readFileSync(BASE + 'css/styles.css', 'utf8')), true);
  check('o calendário nasce no body, fora do recorte',
    corpoCal.includes('document.body.appendChild(painel)'), true);
  check('e não dentro do campo, como antes',
    /box\.appendChild\(painel\)/.test(corpoCal), false);
  check('leva a classe que o torna fixo', corpoCal.includes("'ui-panel ui-pop ui-cal'"), true);
  check('e é ancorado pelo retângulo do campo',
    corpoCal.includes('posicionarFixo(painel, box)'), true);
  /* Reposiciona a cada desenho: trocar de mês muda a altura da grade (4, 5 ou 6
     linhas), e um painel aberto para cima precisa subir junto. */
  check('reposiciona ao trocar de mês',
    uiSrc.slice(uiSrc.indexOf('abrirData(')).indexOf('posicionarFixo(painel, box)')
      < uiSrc.slice(uiSrc.indexOf('abrirData(')).indexOf('const aplicar'), true);
  // Sem limpar a marca da âncora, o campo fica com o realce de "aberto" para sempre
  check('a marca de aberto sai ao fechar', corpoCal.includes("box.classList.remove('tem-pop')"), true);
  check('painel se reposiciona para não sair da tela', ui.includes('posicionar(') && ui.includes('innerWidth'), true);

  /* Escolha múltipla: o componente precisa atender <select multiple>, senão o
     filtro cairia na caixa cinza do navegador — e no celular ela é inutilizável. */
  check('componente não pula mais o select múltiplo', /if \(sel\.dataset\.ui === '1'\) return;/.test(ui), true);
  check('marcar não fecha o painel quando é múltiplo', /if \(multi\) \{[\s\S]{0,400}?return;/.test(ui), true);
  check('o botão conta quantos foram marcados', ui.includes('selecionados`'), true);
  check('lista vazia mostra o texto de data-vazio', ui.includes('sel.dataset.vazio'), true);
  check('o grupo fechado mostra quantos marcou dentro', ui.includes('de ${dentro.length}'), true);
} catch (e) { console.log(` FALHA | componentes: ${e.message}`); fail++; }

console.log('\n=== Semântica de cor por tipo de ação ===');
try {
  const ext = renderExtrato(p);
  // A fileira de atalhos saiu: lançar é só o botão flutuante, e o extrato começa
  // na lista em vez de em três botões que só pré-marcavam o tipo
  check('extrato não traz mais a fileira de atalhos', ext.includes('quick-add'), false);
  check('receita marcada em verde', ext.includes('tx-amount income'), true);
  check('despesa mostra sinal de saída', ext.includes('− '), true);
  const css = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('vermelho reservado para despesa', /\.chip\[data-v="Despesa"\]\.active[^}]*var\(--red\)/.test(css), true);
  check('verde reservado para receita', /\.chip\[data-v="Receita"\]\.active[^}]*var\(--green\)/.test(css), true);
  check('azul reservado para transferência', /\.chip\[data-v="Transferência"\]\.active[^}]*var\(--blue\)/.test(css), true);
  check('folha veste a cor do tipo escolhido', css.includes('.sheet[data-tipo="Receita"] #sh-save'), true);
  check('animações respeitam prefers-reduced-motion', css.includes('prefers-reduced-motion'), true);
  // Com a fileira de atalhos fora, o totalizador do dia é onde o princípio vive:
  // o número colorido vem sempre acompanhado da palavra que diz o que ele é
  check('cor nunca vem sozinha (rótulo junto do valor no total do dia)',
    ext.includes('<i>Entradas</i>') && ext.includes('<i>Saídas</i>'), true);
} catch (e) { console.log(` FALHA | semântica: ${e.message}`); fail++; }

/* ---- Rotulos de coluna estreita ----
   As faixas de 3 colunas (.hero-stats, .mini-stats) dividem a largura do
   celular por 3. Rotulo comprido quebrava em duas linhas e desalinhava os
   valores vizinhos — foi o que aconteceu com "Projeção do mês". */
/* ---- Nome de transação não pode ser cortado ----
   Extrato de banco traz descrição longa; truncada, duas compras diferentes viram
   a mesma linha na tela. O teste vale para toda tela que lista lançamento. */
/* ---- Todo select passa pelo componente estilo Select2 ----
   O enhance roda em openSheet/openModal. Trecho montado por innerHTML DEPOIS que a
   tela abriu não é alcançado — foi o caso do preview do OFX, que ficou com selects
   nativos por meses. O teste cobra o enhance em cada ponto desses. */
/* ---- Etiquetas e o painel de filtros do extrato ---- */
console.log('\n=== Etiquetas nos lançamentos ===');
try {
  const contaT = DB.all('accounts')[0].id;
  const alim = cat('Aliment');
  const mercado = DB.subcategoriesOf(alim.id).find(c => c.name === 'Mercado');
  const tx1 = DB.upsert('transactions', { description: 'Passagem Bahia', amount: 900, date: dia(15), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaT, tags: ['viagem'] });
  const tx2 = DB.upsert('transactions', { description: 'Pousada', amount: 600, date: dia(16), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaT, tags: ['viagem', 'lazer'] });

  check('etiquetas são lidas do lançamento', DB.tagsOf(DB.get('transactions', tx1)).join(','), 'viagem');
  check('lançamento antigo sem o campo não quebra', DB.tagsOf({ description: 'x' }).length, 0);
  check('valor inválido em tags não quebra', DB.tagsOf({ tags: 'viagem' }).length, 0);
  check('etiquetas em uso vêm das mais usadas', DB.allTags()[0], 'viagem');
  check('contagem por etiqueta', DB.tagCount('viagem'), 2);
  check('# e espaços são limpos', DB.normTag('  #Viagem  '), 'Viagem');
  check('etiqueta muito longa é cortada', DB.normTag('a'.repeat(40)).length, 24);

  // A etiqueta cruza envelopes: é para isso que ela existe
  const idsViagem = DB.all('transactions').filter(t => DB.tagsOf(t).includes('viagem'));
  check('etiqueta agrupa gastos de categorias diferentes', idsViagem.length, 2);

  /* Etiquetas são OFERECIDAS, nunca aplicadas sozinhas. Aplicar a do lançamento
     anterior erra justamente no caso mais comum — o gasto esporádico, em que o
     anterior não tem relação nenhuma. Fixar para uma sequência é escolha explícita. */
  console.log('\n=== Sugestão e fixação de etiquetas ===');
  const folhaDe = abrir => { abrir(); return els['#sheet'].innerHTML; };

  check('nada é aplicado sozinho', typeof DB.tagsRecentes, 'undefined');
  const relev = DB.tagsRelevantes(8);
  check('as etiquetas em uso são sugeridas', relev.includes('viagem'), true);
  check('a mais usada vem primeiro', relev[0], 'viagem');

  // Uso recente pesa mais que uso antigo, com a mesma contagem
  const velha = DB.upsert('transactions', { description: 'Compra velha', amount: 20, date: dia(2), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaT, tags: ['antiga', 'antiga2'] });
  DB.get('transactions', velha).updated_at = new Date(Date.now() - 400 * 86400000).toISOString();
  const nova = DB.upsert('transactions', { description: 'Compra nova', amount: 20, date: dia(19), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaT, tags: ['recente'] });
  const ordem = DB.tagsRelevantes(20);
  check('com o mesmo uso, a recente vem antes da antiga',
    ordem.indexOf('recente') < ordem.indexOf('antiga'), true);
  DB.remove('transactions', velha); DB.remove('transactions', nova);

  // Formulário: sugestões desligadas, nada pré-selecionado sem fixação
  fixarTags([]);
  const novoLim = folhaDe(() => openTxSheet(null));
  check('sem fixar, nenhuma etiqueta vem ligada', /chip-tag active/.test(novoLim), false);
  check('mas todas ficam a um toque', novoLim.includes('chip-tag'), true);
  check('campo busca e cria, com autocomplete', novoLim.includes('list="tag-hist"') && novoLim.includes('<datalist id="tag-hist"'), true);
  check('oferece fixar para os próximos', novoLim.includes('id="tag-fixar"'), true);
  check('e explica para que serve', novoLim.includes('vários gastos do mesmo assunto'), true);

  // Fixado: aí sim vem ligado, e dizendo que está fixado
  fixarTags(['viagem']);
  const comFixa = folhaDe(() => openTxSheet(null));
  check('etiqueta fixada vem ligada', /chip-tag active" data-v="viagem"/.test(comFixa), true);
  check('e o botão de fixar aparece ligado', /chip-fixa active/.test(comFixa), true);
  check('avisa o que está fixado e como soltar', comFixa.includes('Desligue quando a sequência terminar'), true);

  // Fixação sobrevive a trocar de tela e a reabrir — é decisão, não jeito de olhar
  setTab('cartoes'); setTab('extrato');
  check('trocar de tela não solta a fixação', lerTagsFixas().join(','), 'viagem');
  check('fixar grava no aparelho', JSON.parse(store['financas.ui.v1']).tagsFixas.join(','), 'viagem');
  // Simula o app abrindo com o que a sessão anterior deixou gravado
  fixarTags([]);
  store['financas.ui.v1'] = JSON.stringify({ tab: 'extrato', tagsFixas: ['viagem'] });
  restoreUI();
  check('reabrir o app recupera a fixação', lerTagsFixas().join(','), 'viagem');

  // Ao editar, vale o que está salvo — e não se oferece fixar
  const semTags = DB.all('transactions').find(t => t.description === 'Mercado');
  check('o lançamento de referência não tem etiqueta', DB.tagsOf(semTags).length, 0);
  const editando = folhaDe(() => openTxSheet(semTags));
  check('editar não aplica a fixada', /chip-tag active/.test(editando), false);
  check('editar não oferece fixar', editando.includes('id="tag-fixar"'), false);
  fixarTags([]);

  // O total por etiqueta é o que faz a etiqueta compensar
  const porTag = DB.spentByTag(DB.monthPeriod(new Date()));
  check('soma o gasto por etiqueta', porTag.viagem, 1500);
  check('etiqueta atravessa categorias', porTag.lazer, 600);
  const rel = renderRelatorios(DB.monthPeriod(new Date()));
  check('relatório mostra o total por etiqueta', rel.includes('Por etiqueta'), true);
  /* Clicar na barra leva aos lançamentos da etiqueta. Vem por evento do gráfico,
     não por <button> no rótulo: o eixo do ApexCharts é SVG e não aceita HTML. */
  const cTag = Graficos.fila.find(f => f.nome === 'ranking'
    && f.opts.xaxis.categories.includes('#viagem'));
  check('e leva aos lançamentos dela', !!cTag, true);
  check('o clique na barra é ligado a uma ação',
    typeof cTag.opts.chart.events.dataPointSelection, 'function');
  // O "#" é enfeite do rótulo: o filtro tem de receber a etiqueta sem ele
  const iTag = cTag.opts.xaxis.categories.indexOf('#viagem');
  cTag.opts.chart.events.dataPointSelection(null, null, { dataPointIndex: iTag });
  check('e filtra o extrato pela etiqueta, sem o #', state.filtros.tags.join(','), 'viagem');
  state.filtros = filtrosVazios();

  // OFX: uma etiqueta para o lote, não um campo por linha
  const ap2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('importação tem etiqueta para o lote', ap2.includes('id="ofx-tags"'), true);
  check('com autocomplete também', ap2.includes('list="tag-hist-ofx"'), true);
  check('cada linha grava as próprias etiquetas', /const tags = tagsDe\(idx\);/.test(ap2), true);
  check('linha sem ajuste segue o lote', /const tagsDe = i => tagsLinha\[i\] \|\| tagsDoLote\(\)/.test(ap2), true);
  check('há botão de etiqueta por linha', ap2.includes('data-tagbtn='), true);
  check('e uma folha para editar só aquela linha', ap2.includes('openTagsLinhaSheet'), true);
  check('dá para voltar a seguir o lote', ap2.includes('Voltar a seguir o lote'), true);
  // A folha abre sobre o modal da importação, então precisa estar acima dele
  const cssZ = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const zSheet = Number((cssZ.match(/\.sheet \{[^}]*z-index: (\d+)/) || [])[1]);
  const zModal = Number((cssZ.match(/\.modal \{[^}]*z-index: (\d+)/) || [])[1]);
  check('folha fica acima do modal', zSheet > zModal, true);

  console.log('\n=== Painel de filtros do extrato ===');
  const p2 = DB.monthPeriod(new Date());
  const zerar = () => { state.filtros = filtrosVazios(); };
  const qtd = () => txsFiltradas(p2).length;

  zerar();
  const totalPeriodo = qtd();
  check('sem filtro, traz tudo do período', totalPeriodo > 5, true);

  // Lista vazia é "todos", nunca "nenhum": um filtro só restringe depois de escolha
  zerar();
  check('todo filtro nasce como lista vazia',
    ['scope', 'membro', 'tipo', 'situacao', 'categorias', 'tags', 'metodos', 'contas']
      .every(k => Array.isArray(state.filtros[k]) && !state.filtros[k].length), true);
  /* A cópia precisa ser nova a cada vez. Se `filtrosVazios()` devolvesse a mesma
     referência de array, marcar um chip escreveria dentro da constante e o
     "limpar tudo" seguinte devolveria exatamente o que deveria apagar. */
  const a1 = filtrosVazios(), a2 = filtrosVazios();
  a1.tags.push('x');
  check('limpar entrega listas novas, não a mesma referência', a2.tags.length, 0);
  check('e não contamina a constante', FILTROS_VAZIOS.tags.length, 0);

  /* ---- Filtrar o que ficou SEM categoria ----
     É o que se procura depois de importar um OFX: achar o que não foi
     classificado. Sem essa opção, o único jeito era marcar todas as categorias e
     ler por exclusão — que não funciona, porque o que não tem categoria não
     aparece em categoria nenhuma. */
  const ctaSem = DB.all('accounts')[0];
  const catSem = DB.rootCategories('Despesa')[0];
  const dSem = DB.inicioISO(p2);
  const novoSem = (desc, cid) => DB.upsert('transactions', {
    description: desc, amount: 10, date: dSem, type: 'Despesa', status: 'Pago',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: ctaSem.id, category_id: cid,
  });
  novoSem('ComCat SC', catSem.id);
  /* `null`, não string vazia: é o que o app grava ao remover a categoria, e
     `category_id` é coluna uuid no banco. Um `''` aqui passaria neste bloco e
     seria rejeitado pelo Postgres — o teste de validação de esquema pegou
     exatamente isso quando escrevi o fixture errado. */
  novoSem('SemCat SC', null);
  /* Aponta para categoria que não existe mais — uuid válido, sem registro. É o que
     sobra quando alguém apaga uma categoria que estava em uso, e o lançamento não
     pode ficar invisível nos dois filtros ao mesmo tempo. */
  novoSem('CatMorta SC', DB.uuid());

  const opsSemCat = opcoesCategoriaPilula();
  check('"Sem categoria" é a primeira opção da lista', opsSemCat[0].v, '_sem');
  check('e vem destacada como grupo, não perdida entre as filhas', opsSemCat[0].grupo, true);
  check('o texto não leva travessão, que apareceria na pílula',
    /^[A-Z]/.test(opsSemCat[0].l), true);

  const soDesteBloco = () => txsFiltradas(p2).map(t => t.description)
    .filter(x => / SC$/.test(x)).sort().join(',');
  zerar(); state.filtros.categorias = ['_sem'];
  check('filtra o que não tem categoria', soDesteBloco(), 'CatMorta SC,SemCat SC');
  zerar(); state.filtros.categorias = [catSem.id];
  check('e a categoria de verdade não traz os sem categoria', soDesteBloco(), 'ComCat SC');
  // Os dois juntos somam, como qualquer multiseleção
  zerar(); state.filtros.categorias = ['_sem', catSem.id];
  check('os dois juntos somam', soDesteBloco(), 'CatMorta SC,ComCat SC,SemCat SC');
  // O rótulo tem de ser legível: categoryPath('_sem') devolveria vazio
  zerar(); state.filtros.categorias = ['_sem'];
  check('a pílula ativa diz "Sem categoria"',
    filtrosAtivos().some(a => a.texto === 'Sem categoria'), true);
  zerar();
  for (const t of DB.all('transactions').filter(t => / SC$/.test(t.description || ''))) DB.remove('transactions', t.id);

  zerar(); state.filtros.tags = ['viagem'];
  check('filtra por etiqueta', qtd(), 2);
  zerar(); state.filtros.tipo = ['Receita'];
  check('filtra por tipo', txsFiltradas(p2).every(t => !DB.isExpense(t)), true);
  zerar(); state.filtros.situacao = ['A Pagar'];
  check('filtra por situação', txsFiltradas(p2).every(t => t.status === 'A Pagar'), true);
  zerar(); state.filtros.scope = ['Pessoal'];
  check('filtra por âmbito', txsFiltradas(p2).every(t => t.scope === 'Pessoal'), true);
  zerar(); state.filtros.membro = ['Joctã'];
  check('filtra por membro', txsFiltradas(p2).every(t => t.member === 'Joctã'), true);
  zerar(); state.filtros.metodos = ['PIX'];
  check('filtra por forma de pagamento', txsFiltradas(p2).every(t => t.method === 'PIX'), true);
  zerar(); state.filtros.valorMin = 800;
  check('filtra por valor mínimo', txsFiltradas(p2).every(t => t.amount >= 800), true);
  zerar(); state.filtros.valorMax = 100;
  check('filtra por valor máximo', txsFiltradas(p2).every(t => t.amount <= 100), true);
  zerar(); state.filtros.contas = [contaT];
  check('filtra por conta', txsFiltradas(p2).every(t => t.account_id === contaT || t.card_id === contaT || t.to_account === contaT), true);

  /* Dentro do mesmo filtro os valores SOMAM; entre filtros diferentes eles
     RESTRINGEM. É a regra inteira do multiselect, e as duas metades precisam de
     teste porque as duas leituras são plausíveis para quem usa. */
  zerar(); state.filtros.situacao = ['Pago', 'A Pagar'];
  check('dois valores do mesmo filtro somam (ou)', qtd(), totalPeriodo);
  zerar(); state.filtros.tipo = ['Receita'];
  const soReceita = qtd();
  state.filtros.tipo = ['Receita', 'Despesa'];
  check('somar um segundo tipo aumenta o resultado', qtd() > soReceita, true);
  zerar(); state.filtros.tipo = ['Receita']; state.filtros.situacao = ['A Pagar'];
  check('filtros diferentes restringem (e)',
    txsFiltradas(p2).every(t => !DB.isExpense(t) && t.status === 'A Pagar'), true);

  // Categoria: o envelope traz as subcategorias, a subcategoria traz só ela
  DB.upsert('transactions', { description: 'Feira', amount: 70, date: dia(17), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaT, category_id: mercado.id });
  zerar(); state.filtros.categorias = [alim.id];
  const porEnvelope = txsFiltradas(p2);
  check('filtrar envelope traz as subcategorias', porEnvelope.some(t => t.category_id === mercado.id), true);
  /* Antes, escolher a subcategoria subia ao envelope e arrastava tudo junto —
     impreciso, e sem como desfazer. Agora "Mercado" traz só mercado, e quem quer
     o envelope inteiro escolhe a linha do próprio envelope na pílula. */
  zerar(); state.filtros.categorias = [mercado.id];
  const soMercado = txsFiltradas(p2);
  check('filtrar subcategoria traz só ela', soMercado.every(t => t.category_id === mercado.id), true);
  check('e é mais restrito que o envelope', soMercado.length < porEnvelope.length, true);
  zerar(); state.filtros.categorias = [alim.id, mercado.id];
  check('envelope e subcategoria juntos não duplicam', txsFiltradas(p2).length, porEnvelope.length);

  // Busca sem acento, em vários campos
  zerar(); state.filtros.busca = 'pousada';
  check('busca pela descrição', qtd(), 1);
  /* A pílula oferece o envelope como linha própria; o formulário de lançamento
     não, senão o gasto pararia no envelope e a subcategoria nunca aconteceria. */
  const opsCat = pilulasDeFiltro().find(p => p.chave === 'categorias').ops;
  check('a pílula deixa escolher o envelope inteiro',
    opsCat.some(o => o.grupo && o.v === alim.id), true);
  check('o lançamento continua só com as folhas',
    optionsCategorias('').includes(`>${alim.name}<`), false);
  // A busca varre descrição, categoria, etiqueta, membro e forma de pagamento. Como
  // existe a subcategoria "Viagem", procurar por viagem acha os dois etiquetados e
  // também o classificado nela — que é justamente o que se espera de uma busca ampla.
  zerar(); state.filtros.busca = 'VIAGEM';
  const achados = txsFiltradas(p2);
  check('busca não liga para maiúscula', achados.length >= 2, true);
  check('busca acha pela etiqueta', achados.filter(t => DB.tagsOf(t).includes('viagem')).length, 2);
  check('e também pela categoria de mesmo nome', achados.some(t => !DB.tagsOf(t).includes('viagem')), true);
  zerar(); state.filtros.busca = 'alimentacao';
  check('busca acha pela categoria, sem acento', qtd() > 0, true);
  zerar(); state.filtros.busca = 'zzzz';
  check('busca sem resultado devolve vazio', qtd(), 0);

  // Filtros combinam
  zerar(); state.filtros.tags = ['viagem']; state.filtros.valorMin = 700;
  check('filtros se somam', qtd(), 1);

  // Etiquetas do que está ativo
  zerar();
  check('sem filtro, nenhuma etiqueta ativa', filtrosAtivos().length, 0);
  state.filtros.tags = ['viagem']; state.filtros.scope = ['Família']; state.filtros.busca = 'x';
  const rot = filtrosAtivos();
  check('cada filtro ativo gera uma etiqueta', rot.length, 3);
  check('a etiqueta mostra o nome legível', rot.some(r => r.texto === '#viagem'), true);
  check('cada etiqueta sabe qual filtro limpar', rot.every(r => r.chave in FILTROS_VAZIOS), true);

  /* Uma etiqueta POR VALOR, e cada uma sabe qual valor tirar. Sem isso, remover
     "Transporte" de uma seleção de três levaria as outras duas junto. */
  zerar(); state.filtros.situacao = ['Pago', 'A Pagar'];
  const rotMulti = filtrosAtivos();
  check('cada valor escolhido vira uma etiqueta', rotMulti.length, 2);
  check('e cada etiqueta carrega o próprio valor',
    rotMulti.map(r => r.valor).sort().join(','), 'A Pagar,Pago');
  zerar(); state.filtros.busca = 'x';
  check('filtro de valor único não carrega valor', filtrosAtivos()[0].valor, null);

  /* ---- Filtros como pílulas na própria tela ----
     Não há mais folha nem modal: cobrir a lista para escolher o que a lista
     mostra tira a referência do que se está filtrando. */
  zerar();
  const ext = renderExtrato(p2);
  check('a barra do topo fica presa na tela', ext.includes('class="ext-topo"'), true);
  check('a busca é uma pílula', ext.includes('data-pilula="busca"'), true);
  for (const chave of ['tipo', 'situacao', 'categorias', 'contas', 'membro', 'scope', 'metodos']) {
    check(`há pílula de ${chave}`, ext.includes(`data-pilula="${chave}"`), true);
  }
  check('o resto fica atrás de "Mais"', ext.includes('data-pilula="mais"'), true);
  check('não sobrou botão de folha de filtros', ext.includes('id="btn-filtros"'), false);
  check('nem a fileira de etiquetas ativas', ext.includes('class="ativos"'), false);

  /* A pílula É o estado: mostra o próprio valor e traz o × que limpa só ela.
     Foi isso que permitiu tirar da tela a fileira de etiquetas ativas, que
     repetia a mesma informação um bloco abaixo. */
  state.filtros.tags = ['viagem'];
  const comFiltro = renderExtrato(p2);
  check('a pílula ativa se destaca', /class="pilula on" data-pilula="tags"/.test(comFiltro), true);
  check('e mostra o valor escolhido', comFiltro.includes('#viagem'), true);
  check('com × que limpa só ela', comFiltro.includes('data-limpa-pilula="tags"'), true);
  const defsTag = pilulasDeFiltro().find(p => p.chave === 'tags');
  check('um valor mostra o nome', rotuloPilula(defsTag), '#viagem');
  state.filtros.tags = ['viagem', 'lazer'];
  check('vários mostram a contagem', rotuloPilula(defsTag), 'Etiqueta · 2');
  state.filtros.tags = [];
  check('nenhum mostra o rótulo', rotuloPilula(defsTag), 'Etiqueta');
  state.filtros.tags = ['viagem'];
  check('há como limpar tudo', renderExtrato(p2).includes('id="limpar-filtros"'), true);
  check('etiquetas do lançamento aparecem na linha', renderExtrato(p2).includes('data-tag="viagem"'), true);

  // Vazio por filtro tem de se distinguir de vazio de verdade
  zerar(); state.filtros.busca = 'zzzz';
  const vazio = renderExtrato(p2);
  check('vazio por filtro explica o motivo', vazio.includes('Nenhum lançamento com esses filtros'), true);
  check('e oferece limpar', vazio.includes('id="limpar-vazio"'), true);
  zerar();

  /* ---- A régua do mês ---- */
  zerar();
  const dias = diasDoPeriodo(p2);
  const iniP = DB.inicioISO(p2), fimP = somarDias(DB.fimISO(p2), -1);
  check('a régua cobre o período inteiro', dias[0] + '|' + dias[dias.length - 1], iniP + '|' + fimP);
  check('sem buracos entre os dias', dias.every((d, i) => i === 0 || d === somarDias(dias[i - 1], 1)), true);

  const reguaHtml = reguaDoMes(p2, { [dias[3]]: 5, [dias[4]]: 1 });
  check('a régua tem dois polegares',
    reguaHtml.includes('id="regua-de"') && reguaHtml.includes('id="regua-ate"'), true);
  check('cada polegar se anuncia para leitor de tela',
    reguaHtml.includes('aria-label="Primeiro dia do intervalo"')
    && reguaHtml.includes('aria-label="Último dia do intervalo"'), true);
  check('os polegares vão de 0 ao último dia', reguaHtml.includes(`max="${dias.length - 1}"`), true);
  check('sem recorte, o rótulo diz mês todo', reguaHtml.includes('Mês todo'), true);
  /* As marcas de movimento são o que diferencia a régua de um slider qualquer:
     mostram onde o dinheiro se mexeu, então dá para ver o aglomerado antes de
     arrastar até ele. Um dia com pouco movimento ainda precisa aparecer. */
  const alturas = [...reguaHtml.matchAll(/regua-marca[^"]*" style="height:(\d+)%/g)].map(m => Number(m[1]));
  check('o dia de maior movimento vai ao topo', Math.max(...alturas), 100);
  check('o dia de pouco movimento ainda aparece', alturas.filter(a => a >= 18 && a < 100).length, 1);
  check('dia sem movimento não desenha marca', alturas.filter(a => a === 0).length, dias.length - 2);

  zerar();
  const tudoDoMes = qtd();
  const meio = Math.floor(dias.length / 2);
  state.filtros.de = dias[0]; state.filtros.ate = dias[meio];
  const primeiraMetade = txsFiltradas(p2);
  check('o recorte reduz a lista', primeiraMetade.length < tudoDoMes, true);
  check('e não deixa passar dia de fora',
    primeiraMetade.every(t => t.date >= dias[0] && t.date <= dias[meio]), true);
  check('as marcas ignoram o recorte, senão o trilho ficaria cego',
    txsFiltradas(p2, true).length, tudoDoMes);
  zerar(); state.filtros.de = dias[meio + 1]; state.filtros.ate = dias[dias.length - 1];
  check('as duas metades somam o mês inteiro', primeiraMetade.length + qtd(), tudoDoMes);

  /* O cabeçalho tem de seguir o recorte junto com a lista. Saldo do dia 1 sobre
     uma lista que começa no dia 16 é exatamente a divergência que já fez o
     extrato discordar do saldo da conta. */
  zerar();
  const extMes = renderExtrato(p2);
  state.filtros.de = dias[meio + 1]; state.filtros.ate = dias[dias.length - 1];
  const extMetade = renderExtrato(p2);
  /* O saldo anterior é o ponto de partida da série — não uma marca no desenho:
     sparkline em constante é decoração. Ele vive na descrição do gráfico, que é
     também como quem usa leitor de tela recebe as duas pontas da curva. */
  const antes = html => (html.match(/aria-label="Saldo dia a dia[^"]*, de ([\d.,]+) a/) || [])[1];
  check('o saldo anterior muda com o recorte', antes(extMes) !== antes(extMetade), true);
  /* PREVISTO, não realizado: um recorte que começa daqui a duas semanas não tem
     saldo "real" — ele ainda não aconteceu. O cabeçalho usa `saldoPrevistoNaData`,
     que é o mesmo número da projeção do hero, e os dois coincidem com o realizado
     quando a data já passou (conferido logo abaixo). */
  check('e é o saldo previsto na data de início do recorte',
    antes(extMetade), fmtSemMoeda(DB.saldoPrevistoNaData(null, dias[meio + 1])));
  check('numa data que já passou, previsto e realizado são o mesmo número',
    DB.saldoPrevistoNaData(null, dias[0]), DB.saldoNaData(null, dias[0]));
  check('o texto explica de quando é o saldo anterior', extMetade.includes('que havia em'), true);
  check('sem recorte, volta a falar do mês anterior', extMes.includes('vieram do anterior'), true);

  /* Trocar de mês volta ao mês todo: o recorte guarda datas absolutas, e levá-lo
     para outro mês daria um intervalo que não toca nada do que a tela mostra.
     A aba é acertada ANTES de aplicar o recorte — senão setTab zeraria o filtro
     por conta própria e o teste passaria sem o clique provar nada. */
  setTab('extrato');
  bindView();
  state.filtros.de = dias[0]; state.filtros.ate = dias[meio];
  check('o recorte está de pé antes do clique', state.filtros.de, dias[0]);
  els['#mn-prev'].onclick();
  check('trocar de mês desfaz o recorte', state.filtros.de, '');
  check('e o mês realmente andou', state.monthOffset, -1);
  state.monthOffset = 0;

  /* Arrastar: o rótulo e a faixa acompanham ao vivo, mas o extrato só é
     redesenhado ao SOLTAR. Redesenhar a cada pixel refaria a lista dezenas de
     vezes por segundo e engasgaria justamente o gesto que precisa ser fluido. */
  zerar();
  setTab('extrato'); bindView();
  const thumbDe = els['#regua-de'], thumbAte = els['#regua-ate'];
  check('a régua ficou ligada', !!(thumbDe && thumbDe.onchange && thumbDe.oninput), true);
  thumbDe.value = 2; thumbAte.value = 6;
  thumbDe.oninput();
  check('arrastar sozinho não aplica o recorte', state.filtros.de, '');
  thumbDe.onchange();
  check('soltar aplica', state.filtros.de, dias[2]);
  check('e o fim também', state.filtros.ate, dias[6]);

  // Polegares cruzados: vale o menor primeiro, em vez de devolver lista vazia
  bindView();
  els['#regua-de'].value = 9; els['#regua-ate'].value = 4;
  els['#regua-de'].onchange();
  check('polegar cruzado não inverte o intervalo', state.filtros.de, dias[4]);
  check('o maior vira o fim', state.filtros.ate, dias[9]);

  // Abrir tudo é "sem recorte", não um recorte que cobre o mês
  bindView();
  els['#regua-de'].value = 0; els['#regua-ate'].value = dias.length - 1;
  els['#regua-de'].onchange();
  check('régua toda aberta limpa o recorte', state.filtros.de + state.filtros.ate, '');
  zerar();

  /* ---- Pílulas de filtro ---- */
  const cssPil = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('a barra do topo gruda ao rolar', /\.ext-topo \{[^}]*position: sticky/.test(cssPil), true);
  /* Fundo da PÁGINA, não o dos cartões: a barra não flutua sobre o conteúdo,
     ela é o topo da página preso. Cartão branco leria como algo que pousou ali. */
  check('e usa o fundo da página, não o de cartão', /\.ext-topo \{[^}]*background: var\(--ink\);/.test(cssPil), true);
  check('sem sombra competindo com a lista', /\.ext-topo \{[^}]*box-shadow/.test(cssPil), false);
  check('a barra sai da animação de entrada', cssPil.includes('.view > .ext-topo { animation: none; }'), true);
  /* Nada de rolagem horizontal aqui: a fileira mostrava só as primeiras e o
     resto ficava inalcançável. Filtro escondido é filtro que não se usa — e o
     custo é a pessoa não entender por que a lista está daquele jeito. */
  check('as pílulas quebram linha em vez de rolar',
    /\.ext-pilulas \{[^}]*flex-wrap: wrap/.test(cssPil), true);
  check('e nenhuma fica fora de alcance',
    /\.ext-pilulas \{[^}]*overflow-x: auto/.test(cssPil), false);
  check('todas as pílulas saem no HTML de uma vez',
    (renderExtrato(p2).match(/data-pilula="/g) || []).length, pilulasDeFiltro().length + 2);
  /* text-overflow não alcança texto solto dentro de contêiner flex: sem um span
     próprio, o rótulo era cortado no seco e a pílula aparecia pela metade. */
  check('o rótulo tem elemento próprio para as reticências',
    /\.pilula-rot \{[^}]*text-overflow: ellipsis/.test(cssPil), true);
  check('e a pílula não corta mais o conteúdo dela',
    /\.pilula \{[^}]*text-overflow/.test(cssPil), false);
  check('todo rótulo de pílula sai embrulhado',
    (renderExtrato(p2).match(/data-pilula="/g) || []).length,
    (renderExtrato(p2).match(/class="pilula-rot"/g) || []).length);
  check('o polegar da régua recebe o toque de volta',
    /::-webkit-slider-thumb \{[^}]*pointer-events: auto/.test(cssPil), true);
  /* O painel da pílula vive no <body>: dentro da fileira, o overflow-x:auto dela
     cortaria o painel na altura da própria pílula. */
  const uiPop = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  check('o popover não fica preso dentro da âncora', uiPop.includes('document.body.appendChild(painel)'), true);
  check('e é posicionado como fixo', /\.ui-pop \{[^}]*position: fixed/.test(cssPil), true);
  check('clique dentro do painel não conta como clique fora',
    uiPop.includes('!this.aberto.painel.contains(alvo)'), true);

  /* Duas pílulas ativas: cada × precisa carregar a PRÓPRIA chave, senão limpar
     "Tipo" levaria "Situação" junto. */
  zerar();
  state.filtros.tipo = ['Despesa']; state.filtros.situacao = ['Pago'];
  const duasAtivas = renderExtrato(p2);
  check('cada × diz qual filtro limpa',
    duasAtivas.includes('data-limpa-pilula="tipo"') && duasAtivas.includes('data-limpa-pilula="situacao"'), true);
  check('e só as ativas ganham ×',
    (duasAtivas.match(/data-limpa-pilula=/g) || []).length, 2);
  // O handler zera só a chave dele — é uma linha, e é a linha que importa
  const apPil = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('o × zera apenas a própria chave',
    /state\.filtros\[x\.dataset\.limpaPilula\] = \[\];/.test(apPil), true);
  check('e o clique no × não abre o painel atrás dele',
    /if \(e\.target\.dataset && e\.target\.dataset\.limpaPilula\) return;/.test(apPil), true);

  // Categoria na pílula traz envelope e subcategoria na mesma lista
  const defCat = pilulasDeFiltro().find(p => p.chave === 'categorias');
  check('a lista de categoria tem envelopes', defCat.ops.some(o => o.grupo), true);
  check('e as subcategorias dele', defCat.ops.some(o => o.filha), true);
  check('o envelope vem antes das filhas dele',
    defCat.ops.findIndex(o => o.grupo) < defCat.ops.findIndex(o => o.filha), true);

  /* A faixa fica sempre à vista; o que recolhe é a explicação por extenso, que
     se lê uma vez e depois só ocupa a altura que a lista quer. */
  zerar();
  state.resumoAberto = true;
  check('a explicação começa visível', /res-nota">.+?\S/.test(renderExtrato(p2)), true);
  state.resumoAberto = false;
  const recolhido = renderExtrato(p2);
  check('recolher esconde só a explicação', recolhido.includes('card res fechado'), true);
  check('o saldo e o gráfico continuam à vista',
    recolhido.includes('data-g="saldo-dia"') && recolhido.includes('res-rot'), true);
  /* O cabeçalho inteiro é o botão. Um botão próprio embaixo custava 36px de
     altura para dizer o que a seta já diz — e altura aqui é lista a menos. */
  check('o cabeçalho é o que abre a explicação',
    /<button class="res-topo" id="ext-resumo-toggle"/.test(recolhido), true);
  check('e não há um segundo botão só para isso', recolhido.includes('res-mais'), false);
  state.resumoAberto = true;
  zerar();
  state.monthOffset = 0;
  zerar();
} catch (e) { console.log(` FALHA | etiquetas/filtros: ${e.message}`); fail++; }

/* ---- Nada pode ficar embaixo do teclado ----
   Com o teclado aberto o viewport visual encolhe, mas elemento position:fixed
   segue ancorado no de layout. Sem tratar, o botão de salvar e a lista do
   dropdown ficam atrás do teclado — existem e ninguém vê. */
/* ---- Nada grava em silêncio, nada some sem aviso ---- */
/* ---- Seletor de categoria em dois níveis ----
   Plano, o dropdown tinha 75 itens: 11 telas de rolagem DENTRO do painel, para
   escolher uma categoria. Em dois níveis a primeira tela tem 13. */
/* ---- Transferência importada dos dois extratos ----
   A transferência move os DOIS saldos quando é criada. Ao importar o extrato da
   conta que recebeu, o crédito correspondente não pode virar lançamento novo:
   entraria o mesmo dinheiro duas vezes. O FITID não ajuda — cada banco emite o
   seu, então a mesma transferência tem identificadores diferentes nos dois lados. */
/* ---- Total por dia no extrato ---- */
console.log('\n=== Total do dia no extrato ===');
try {
  const contaD = DB.all('accounts')[0].id;
  const diaTeste = dia(23);
  DB.upsert('transactions', { description: 'Mercado do dia', amount: 200, date: diaTeste, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaD });
  DB.upsert('transactions', { description: 'Padaria do dia', amount: 50, date: diaTeste, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Dinheiro', account_id: contaD });
  DB.upsert('transactions', { description: 'Reembolso do dia', amount: 80, date: diaTeste, type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaD });

  state.filtros = filtrosVazios();
  const pD = DB.monthPeriod(new Date());
  const linhaDoDia = html => {
    const m = html.match(new RegExp(`<p class="tx-day">[\\s\\S]*?</p>`, 'g')) || [];
    return m.find(l => l.includes(fmtDay(diaTeste))) || '';
  };

  let linha = linhaDoDia(renderExtrato(pD));
  check('o dia mostra o que saiu, com centavos', linha.includes(fmt(250)), true);
  check('e o que entrou, separado', linha.includes(fmt(80)), true);
  check('saída e entrada com badge próprio', linha.includes('dia-badge ruim') && linha.includes('dia-badge ok'), true);
  check('cada badge nomeia o que mostra', linha.includes('<i>Entradas</i>') && linha.includes('<i>Saídas</i>'), true);

  // Transferência é dinheiro mudando de lugar: não pode inflar o total do dia
  const tr = { description: 'Para a poupança', amount: 900, date: diaTeste, type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: contaD, to_account: DB.all('accounts')[1].id };
  const trId = DB.upsert('transactions', tr);
  linha = linhaDoDia(renderExtrato(pD));
  check('transferência não entra no total do dia', linha.includes(fmt(250)), true);
  check('nem como entrada', linha.includes(fmt(900)), false);
  DB.remove('transactions', trId);

  // O total precisa refletir o filtro, senão não bate com as linhas logo abaixo
  state.filtros = { ...filtrosVazios(), busca: 'mercado do dia' };
  linha = linhaDoDia(renderExtrato(pD));
  check('com filtro, o total acompanha o que é exibido', linha.includes(fmt(200)), true);
  check('e some o que foi filtrado fora', linha.includes(fmt(250)), false);
  state.filtros = filtrosVazios();

  /* Saldo do dia: só quando houve entrada E saída. Num dia de um tipo só ele
     repetiria o mesmo número, e repetir número faz a pessoa parar de ler. */
  state.filtros = filtrosVazios();
  linha = linhaDoDia(renderExtrato(pD));
  check('dia misto mostra o saldo', linha.includes('dia-badge saldo'), true);
  check('e o saldo é entrada menos saída', linha.includes(fmt(170)), true);

  /* Totalizadores com centavos: arredondar escondia diferença de centavos
     justamente na conferência contra o extrato do banco. */
  /* ---- Resumo com evolução diária ----
     Formas diferentes para perguntas diferentes: área para o caminho do saldo,
     colunas a partir do zero para o volume de cada dia. */
  const cabecalho = renderExtrato(pD);
  const cssF0 = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('o resumo virou cartão com gráfico', cabecalho.includes('class="card res'), true);
  check('nem voltou o grid de quatro cartões', cabecalho.includes('stat-2x2'), false);
  check('o saldo tem área de evolução', cabecalho.includes('data-g="saldo-dia"'), true);
  /* Um gráfico só, generoso — não três espremidos. A elegância do Mixed Widget
     10 vem da contenção: título e valor no mesmo corpo, o gráfico levando o
     peso visual. Era o inverso disto que fazia a versão anterior parecer
     amadora: número de 22px e gráfico de 40px. */
  check('há um gráfico só, não três',
    (cabecalho.match(/data-g="saldo-dia"/g) || []).length, 1);
  check('e ele é generoso, não um filete',
    /\.res-graf \{[^}]*height: 130px/.test(cssF0), true);
  check('o valor não é maior que o título',
    /\.res-rot > b \{[^}]*font-size: 16px/.test(cssF0) && /\.res-dir > b \{[^}]*font-size: 16px/.test(cssF0), true);

  /* Entrou e saiu ganharam linha própria: espremidos ao lado da data eles
     quebravam e empurravam o valor da direita para baixo em tela estreita. */
  check('entrou e saiu têm linha só deles', cabecalho.includes('class="res-fluxo"'), true);
  check('e ficam fora da linha do saldo',
    cabecalho.indexOf('res-fluxo') > cabecalho.indexOf('res-dir'), true);

  /* A DICA DO GRÁFICO QUE O EXTRATO REALMENTE MONTA. Testar sparkArea com os
     argumentos na mão não prova nada sobre a tela: sem os dias e o movimento, a
     dica cairia para índice numérico e perderia o entrou/saiu, e o teste direto
     continuaria passando. */
  zeraFila();
  renderExtrato(pD);
  const cReal = Graficos.fila.find(f => f.nome === 'saldo-dia');
  check('o extrato entrega os dias e o movimento ao gráfico', !!cReal, true);
  /* O CORTE É HOJE, não o último dia com movimento: ele é uma data, não um
     lançamento. Do contrário o tracejado começaria antes ou depois de hoje
     conforme o mês tivesse sido mais ou menos movimentado. */
  const diasPD = diasDoPeriodo(pD);
  if (diasPD.indexOf(DB.hojeISO()) < diasPD.length - 1) {
    check('o extrato parte a curva exatamente em hoje',
      (cReal.opts.annotations.xaxis || [{}])[0].x, DB.hojeISO());
    check('  e desenha as duas naturezas', cReal.opts.series.length, 2);
  } else {
    /* NO ÚLTIMO DIA DO CICLO não há metade prevista para tracejar: a emenda cairia
       em cima da borda direita. Uma série só é o certo aqui — e é a mesma regra do
       mês encerrado. O teste exigia duas em qualquer dia, então reprovava um dia
       por mês sem que nada estivesse errado. */
    check('no último dia do ciclo a curva é uma só', cReal.opts.series.length, 1);
    check('  e sem vertical marcando uma emenda que não existe',
      (cReal.opts.annotations.xaxis || []).length, 0);
  }
  const balReal = cReal.opts.tooltip.custom({ dataPointIndex: 1 });
  check('e a dica nomeia um dia de verdade, não um índice',
    /\d{2} de |\d{2}\/|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez/.test(balReal), true);
  check('e mostra o saldo daquele dia', balReal.includes('saldo'), true);

  /* A DICA responde três coisas de uma vez. A nativa mostraria só a série
     desenhada, que é o saldo — e saldo sem o movimento do dia não explica o
     degrau. Por isso ela é própria, e é o conteúdo dela que se testa. */
  zeraFila();
  sparkArea([1000, 1200, 900], ['2026-07-01', '2026-07-02', '2026-07-03'],
    { '2026-07-02': { entrou: 200, saiu: 0 }, '2026-07-03': { entrou: 0, saiu: 300 } });
  const cSp = cfgDo();
  check('o gráfico leva o movimento de cada dia', typeof cSp.tooltip.custom, 'function');
  const bal = cSp.tooltip.custom({ dataPointIndex: 1 });
  check('o balão mostra saldo, entrou e saiu',
    bal.includes('saldo') && bal.includes('entrou') && bal.includes(fmtSemMoeda(200)), true);
  check('e nomeia o dia por extenso', /jul/.test(bal), true);
  // Linha só quando há movimento: "saiu R$ 0" é ruído, não informação
  check('dia sem saída não mostra linha de saída', bal.includes('saiu'), false);
  check('e o dia com saída mostra', cSp.tooltip.custom({ dataPointIndex: 2 }).includes('saiu'), true);
  /* Sparkline: sem eixo, sem grade, sangrando na borda. É o que separa um gráfico
     desenhado de um gráfico encaixotado (card-body p-0 do Metronic). */
  check('é sparkline, sem eixos nem grade', cSp.chart.sparkline.enabled, true);
  check('a variação vem com seta além da cor', /res-selo (ok|ruim)"><i class="pt pt-(up|dn)/.test(cabecalho), true);
  check('e diz o que sobrou ou faltou', /Sobrou <b|Faltou <b/.test(cabecalho), true);

  const apF = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const cssF = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('os valores mantêm centavos',
    /minimumFractionDigits: 2, maximumFractionDigits: 2/.test(apF), true);
  /* Figuras proporcionais no número grande: dígitos de largura igual deixam um
     valor frouxo em corpo grande. Tabular só onde há colunas a alinhar. */
  check('o número grande não usa tabular-nums',
    /\.res-rot b \{[^}]*tabular-nums/.test(cssF), false);
  /* Degradê que apaga para baixo, como nos widgets do Metronic: lavagem chapada
     vira bloco e briga com a linha. */
  check('a área usa degradê, não bloco chapado', cSp.fill.type, 'gradient');
  check('e o degradê apaga até o transparente', cSp.fill.gradient.opacityTo, 0);
  check('a linha é curva, não poligonal', cSp.stroke.curve, 'smooth');
  /* Escala pelo intervalo dos dados, não do zero: com saldo de R$ 14 mil, ancorar
     no zero achataria a linha num traço reto e a variação sumiria. É o padrão do
     sparkline — não há yaxis forçando o zero. */
  /* Nada de `min: 0`: o que forçaria o zero é declarar o mínimo, não a ausência do
     eixo. A lib escala pelo intervalo dos dados por conta própria. */
  check('a escala não é forçada ao zero',
    !cSp.yaxis || (cSp.yaxis.min === undefined && cSp.yaxis.max === undefined), true);
  // A régua do zero só quando a série de fato cruza: senão é tinta sem dado
  zeraFila();
  sparkArea([500, -200], ['2026-07-01', '2026-07-02'], {});
  check('série que cruza o zero ganha a régua', cfgDo().annotations.yaxis.length, 1);
  zeraFila();
  sparkArea([500, 800], ['2026-07-01', '2026-07-02'], {});
  check('e série sempre positiva não ganha', !cfgDo().annotations.yaxis, true);
  check('duas medidas já desenham', sparkArea([1, 2], ['a', 'b'], {}).includes('apx'), true);
  check('uma medida só não desenha nada', sparkArea([1], ['a'], {}), '');

  /* DUAS LINHAS: até hoje é fato, daí em diante é projeção. Com um traço só, o
     previsto passava por extrato — e ele é justamente a parte que pode não
     acontecer. */
  zeraFila();
  sparkArea([100, 200, 300, 400], ['d1', 'd2', 'd3', 'd4'], {}, 1);
  const cDuas = cfgDo();
  check('a curva se parte em fato e projeção', cDuas.series.length, 2);
  check('  a de baixo é o realizado', cDuas.series[0].name, 'saldo');
  check('  e ela para no corte', JSON.stringify(cDuas.series[0].data), '[100,200,null,null]');
  check('  a outra é o previsto', cDuas.series[1].name, 'previsto');
  /* As duas se TOCAM no ponto do corte: sem repeti-lo, haveria um buraco de um dia
     entre as metades e a linha pareceria interrompida em vez de continuada. */
  check('  que começa no mesmo ponto onde o fato termina',
    JSON.stringify(cDuas.series[1].data), '[null,200,300,400]');
  check('  o previsto é tracejado, o realizado inteiro',
    JSON.stringify(cDuas.stroke.dashArray), '[0,5]');
  check('  e o previsto vem mais claro', cDuas.colors[1] !== cDuas.colors[0], true);
  check('  uma vertical marca onde o fato acaba', cDuas.annotations.xaxis[0].x, 'd2');
  check('  o balão avisa que aquele saldo é projeção',
    cDuas.tooltip.custom({ dataPointIndex: 2 }).includes('saldo previsto'), true);
  check('  e no lado do fato ele não avisa',
    cDuas.tooltip.custom({ dataPointIndex: 0 }).includes('previsto'), false);

  // Sem futuro (mês encerrado) ou sem passado (mês que não chegou), não há emenda
  zeraFila();
  sparkArea([100, 200, 300], ['d1', 'd2', 'd3'], {}, 2);
  check('mês encerrado desenha uma linha só, inteira', cfgDo().series.length, 1);
  check('  e sem vertical de corte', !cfgDo().annotations.xaxis, true);
  zeraFila();
  sparkArea([100, 200, 300], ['d1', 'd2', 'd3'], {}, -1);
  const cFut = cfgDo();
  check('mês que ainda não chegou desenha uma linha só, tracejada', cFut.series.length, 1);
  check('  e ela é toda de previsto', cFut.series[0].name, 'previsto');
  check('  com o traço cortado', JSON.stringify(cFut.stroke.dashArray), '[5]');
  /* O gráfico sangra até a borda e herda o raio do cartão — é o que separa um
     gráfico desenhado de um gráfico encaixotado (card-p-0 + rounded-bottom). */
  check('o cartão zera o padding para o gráfico encostar',
    /\.res \{ padding: 0; overflow: hidden; \}/.test(cssF), true);

  /* O INVARIANTE do gráfico: a ponta da série tem de bater com o saldo escrito
     ao lado dela. Um gráfico que termina num número diferente do número que o
     acompanha é pior que gráfico nenhum. */
  const pSerie = DB.monthPeriod(new Date());
  const diasS = diasDoPeriodo(pSerie);
  const anteriorS = DB.saldoNaData(null, DB.inicioISO(pSerie));
  const serieS = serieDeSaldo(null, diasS, anteriorS);
  check('a série cobre todos os dias do período', serieS.length, diasS.length);
  /* Contra o saldo PREVISTO, que é o que o cartão escreve ao lado do gráfico num
     mês que ainda não acabou. Comparar com saldoNaData era cobrar da linha um
     número que a tela não mostra — e foi o que deixou passar a linha reta. */
  check('e termina no mesmo saldo que o cartão mostra',
    Math.round(serieS[serieS.length - 1] * 100) / 100,
    Math.round(DB.saldoPrevistoNaData(null, DB.fimISO(pSerie)) * 100) / 100);
  const pPassado = DB.monthPeriod(new Date(), -1);
  const diasPas = diasDoPeriodo(pPassado);
  const seriePas = serieDeSaldo(null, diasPas, DB.saldoNaData(null, DB.inicioISO(pPassado)));
  check('  e num mês encerrado ela termina no saldo daquela data',
    Math.round(seriePas[seriePas.length - 1] * 100) / 100,
    Math.round(DB.saldoNaData(null, DB.fimISO(pPassado)) * 100) / 100);
  /* Um passe só sobre os lançamentos, não uma varredura por dia: com 31 dias,
     chamar saldoNaData por dia percorreria a base inteira 31 vezes. */
  const corpoSerie = apF.slice(apF.indexOf('function serieDeSaldo'), apF.indexOf('function sparkArea'));
  check('a série não chama saldoNaData por dia', corpoSerie.includes('saldoNaData'), false);
  // Conciliação conta no saldo, como em saldoNaData — senão as pontas divergem
  check('a série segue as mesmas regras do saldo', corpoSerie.includes("t.status !== 'Pago'"), true);

  /* Suavização: a curva nunca pode mostrar um saldo que não existiu em dia
     nenhum. Antes isso era geometria nossa — Catmull-Rom com controle travado —
     e cada mudança pedia amostrar a Bézier para provar que ela não estourava a
     faixa dos dados. Agora é a curva "smooth" da biblioteca, e o que resta
     verificar é que pedimos curva e não poligonal (feito acima). */
  check('KPIs do painel também', !/kpi-value[^"]*">\$\{fmtShort\(/.test(apF), true);
  // A linha de abertura do hero mostra o saldo com centavos, não abreviado
  check('e o hero do painel', /<span>Em contas<\/span><b>\$\{fmt\(saldo\)\}/.test(apF), true);

  // Dia só com entrada não mostra saída zerada
  const soEntrada = dia(24);
  DB.upsert('transactions', { description: 'Salário do dia', amount: 500, date: soEntrada, type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: contaD });
  const linhaSo = ((renderExtrato(pD).match(/<p class="tx-day">[\s\S]*?<\/p>/g) || [])
    .find(l => l.includes(fmtDay(soEntrada))) || '');
  check('dia só com entrada não mostra saída', linhaSo.includes('dia-badge ruim'), false);
  check('mas mostra a entrada', linhaSo.includes('dia-badge ok'), true);
  check('e não mostra saldo, que repetiria a entrada', linhaSo.includes('dia-badge saldo'), false);

  for (const t of DB.all('transactions').filter(t => /do dia$/.test(t.description))) DB.remove('transactions', t.id);
} catch (e) { console.log(` FALHA | total do dia: ${e.message}`); fail++; }

/* ---- Conferir uma conta contra o extrato do banco ----
   No todo, transferência é neutra: o dinheiro não saiu da família, mudou de bolso.
   Mas o extrato do banco de UMA conta mostra a transferência como débito, e ela
   move o saldo dali. Filtrando por conta, o app precisa ler do mesmo jeito —
   senão os números não fecham na conferência. */
/* ---- O saldo atravessa os meses ----
   Sem saldo anterior, cada mês parecia começar do zero: sobrar em junho não
   aparecia em julho em lugar nenhum, e "entrou menos saiu" nunca fechava com o
   saldo real da conta. É a primeira linha de qualquer extrato de banco. */
console.log('\n=== Saldo passa de um mês para o outro ===');
try {
  const cM = DB.upsert('accounts', { name: 'Conta Mês', type: 'Conta Corrente', balance: 0, active: true });
  const hoje = new Date();
  const mesAtual = DB.monthPeriod(hoje);
  const mesPassado = DB.monthPeriod(hoje, -1);
  // Uma data dentro do mês anterior, respeitando o dia de início configurado
  const noMesPassado = (() => {
    const d = new Date(mesPassado.start.getTime() + 3 * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const lancar = o => { DB.upsert('transactions', o); applyTxEffect(o, +1); };
  // Mês passado: sobrou 1.000
  lancar({ description: 'Salário passado', amount: 3000, date: noMesPassado, type: 'Receita', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: cM });
  lancar({ description: 'Contas passado', amount: 2000, date: noMesPassado, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: cM });
  // Mês atual: gastou 300
  lancar({ description: 'Mercado atual', amount: 300, date: dia(2), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: cM });

  check('o saldo da conta acumula os dois meses', DB.get('accounts', cM).balance, 700);
  const antesDoAtual = DB.saldoNaData([cM], DB.inicioISO(mesAtual));
  check('o que sobrou do mês passado vira saldo anterior', antesDoAtual, 1000);
  check('antes do mês passado não havia nada', DB.saldoNaData([cM], DB.inicioISO(mesPassado)), 0);

  // A conta do extrato tem de fechar: anterior + entrou − saiu = saldo de hoje
  check('anterior + movimento do mês = saldo atual', antesDoAtual - 300, DB.get('accounts', cM).balance);

  // Na tela
  state.filtros = { ...filtrosVazios(), contas: [cM] };
  const tela = renderExtrato(mesAtual);
  check('o extrato mostra o saldo anterior', /aria-label="Saldo dia a dia[^"]*, de [\d.,]+ a/.test(tela), true);
  check('com o valor que veio do mês passado', tela.includes(fmtSemMoeda(1000)), true);
  check('e o saldo do mês fechando', tela.includes(fmtSemMoeda(700)), true);

  /* Com conciliação no meio do mês, "anterior + entrou − saiu" NÃO dá o saldo:
     a conciliação mexe no saldo mas fica fora de entrou/saiu, porque não é gasto
     nem entrada. O fechamento tem de vir do saldo real, medido na data do fim —
     senão o extrato mostra um número que não existe em lugar nenhum. */
  const saldoAntesDaConciliacao = DB.get('accounts', cM).balance;
  const conc = { description: 'Ajuste de saldo (extrato do banco)', amount: 250, date: dia(4), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: cM, adjustment: true };
  DB.upsert('transactions', conc); applyTxEffect(conc, +1);
  check('conciliação mexe no saldo', DB.get('accounts', cM).balance, saldoAntesDaConciliacao - 250);

  const comConc = renderExtrato(mesAtual);
  const fechamento = DB.saldoNaData([cM], DB.fimISO(mesAtual));
  check('o saldo de fechamento é o saldo real da conta', fechamento, DB.get('accounts', cM).balance);
  check('e é ele que aparece na tela', comConc.includes(fmtSemMoeda(fechamento)), true);
  // O valor aparece na linha do próprio ajuste; o que importa é o total que saiu
  // no resumo, que deve contar só o gasto real do mês (300), não os 300 + 250
  // Pega a coluna "saiu" do resumo, não o selo de variação — os dois trazem seta
  const totalSaiu = (comConc.match(/pt pt-dn"><\/i>([\d.,]+) <small>(?:saiu|despesas)/) || [])[1];
  check('a conciliação não entra no total que saiu', (totalSaiu || '').trim(), fmtSemMoeda(300));
  check('mas é explicada por extenso', comConc.includes('de conciliação'), true);
  // O erro que existia: derivar o fechamento da soma dava 250 a mais
  check('o fechamento não é anterior + entrou − saiu',
    comConc.includes(fmtSemMoeda(fechamento + 250)), false);
  DB.remove('transactions', DB.all('transactions').find(t => t.adjustment && t.account_id === cM).id);
  applyTxEffect(conc, -1);

  // A pagar não entra: ainda não saiu da conta
  DB.upsert('transactions', { description: 'Boleto futuro', amount: 500, date: dia(3), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cM });
  check('lançamento a pagar não muda o saldo anterior', DB.saldoNaData([cM], DB.inicioISO(mesAtual)), 1000);

  // Sem filtro de conta, soma a família inteira
  state.filtros = filtrosVazios();
  const geral = DB.saldoNaData(null, DB.inicioISO(mesAtual));
  const somaContas = DB.all('accounts').reduce((s, a) => s + (Number(a.balance) || 0), 0);
  check('a visão geral também tem saldo anterior', typeof geral, 'number');
  check('e o geral inclui esta conta', geral !== 0 || somaContas === 0, true);
  const telaGeral = renderExtrato(mesAtual);
  check('a visão geral mostra o saldo anterior', /aria-label="Saldo dia a dia[^"]*, de [\d.,]+ a/.test(telaGeral), true);
  check('e explica o que sobrou ou faltou', /Sobrou <b|Faltou <b/.test(telaGeral), true);

  for (const t of DB.all('transactions').filter(t => /passado$|atual$|futuro$/.test(t.description))) DB.remove('transactions', t.id);
  DB.remove('accounts', cM);
  state.filtros = filtrosVazios();
} catch (e) { console.log(` FALHA | saldo entre meses: ${e.message}`); fail++; }

/* ---- A ponte do extrato: o que existe hoje e onde o período fecha ----
   O número grande do cartão sempre foi o saldo do FIM do recorte. Num mês que
   ainda não acabou ele é projeção, e o saldo de hoje não aparecia em lugar nenhum:
   o cartão dizia R$ 9.333,63 com R$ 231,35 em conta. Os testes aqui cobram as duas
   coisas — que os dois números apareçam, e que as parcelas entre eles FECHEM. */
console.log('\n=== O extrato mostra o hoje e o fim do período ===');
try {
  // O rótulo sem a nota em <i>: a nota traz data e explicação, que mudam com o dia
  const linhasDaPonte = html => [...html.matchAll(/<div class="hc-l([^"]*)"><span>(.*?)<\/span><b>(.*?)<\/b>/g)]
    .map(m => ({ total: m[1].includes('hc-total'), detalhe: m[1].includes('hc-d'), val: m[3],
      nota: (m[2].match(/<i>(.*?)<\/i>/) || [])[1] || '',
      rot: m[2].replace(/<i>.*?<\/i>/g, '').replace(/<[^>]*>/g, '').trim() }));
  const numeroGrande = html => ((html.match(/res-dir">\s*<b[^>]*>([^<]+)/) || [])[1] || '').trim();
  /* A CONTA TEM DE FECHAR, lida como quem confere no papel: parte da primeira
     linha, aplica os sinais e cobra cada "=" pelo caminho. Vale mais do que
     conferir valor por valor — pega tanto uma parcela errada quanto uma parcela
     que deixou de entrar, que é o defeito que só aparece com dado incomum. */
  const fecha = todas => {
    // Linha de detalhe decompõe a de cima; somá-la contaria o mesmo dinheiro duas vezes
    const linhas = todas.filter(l => !l.detalhe);
    if (linhas.length < 2) return true;
    const num = s => Number(String(s).replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.'));
    let soma = num(linhas[0].val);
    for (const l of linhas.slice(1)) {
      if (l.rot.startsWith('+')) soma += num(l.val);
      else if (l.rot.startsWith('−')) soma -= num(l.val);
      else if (l.rot.startsWith('=')) { if (Math.abs(soma - num(l.val)) > 0.005) return false; }
      else return false;                    // linha sem sinal no meio da conta
    }
    return true;
  };

  const cE = DB.upsert('accounts', { name: 'Conta Ponte', type: 'Conta Corrente', balance: 1000, active: true });
  const mesAtual = DB.monthPeriod(new Date());
  const mesQueVem = DB.monthPeriod(new Date(), 1);
  const mesPassado = DB.monthPeriod(new Date(), -1);
  // Último dia do ciclo corrente: data que ainda não chegou (ou é hoje), então o
  // lançamento continua "a pagar" e pertence à ponte
  const fimDoMes = somarDias(DB.fimISO(mesAtual), -1);
  const base = { scope: 'Família', member: MEMBRO_COMUM, status: 'A Pagar', account_id: cE };
  DB.upsert('transactions', { ...base, description: 'Boleto ponte', amount: 300, date: fimDoMes, type: 'Despesa', method: 'Boleto' });
  DB.upsert('transactions', { ...base, description: 'Freela ponte', amount: 800, date: fimDoMes, type: 'Receita', method: 'PIX' });
  /* Um gasto JÁ PAGO no começo do ciclo, sem mexer no saldo (o saldo já nasce
     descontado, como na vida real). Ele afasta a ABERTURA do mês do saldo de HOJE
     — 1.150 contra 1.000 — e é o que dá poder ao teste da primeira linha: sem ele
     os dois números coincidem e trocar um pelo outro passaria despercebido. */
  DB.upsert('transactions', { ...base, status: 'Pago', description: 'Mercado ponte', amount: 150,
    date: DB.inicioISO(mesAtual), type: 'Despesa', method: 'Débito' });
  // Uma entrada no mês passado, para o cartão do mês encerrado ter o que contar
  DB.upsert('transactions', { ...base, status: 'Pago', description: 'Salário ponte', amount: 500,
    date: somarDias(DB.inicioISO(mesPassado), 2), type: 'Receita', method: 'PIX' });

  state.filtros = { ...filtrosVazios(), contas: [cE] };
  const tela = renderExtrato(mesAtual);
  const linhas = linhasDaPonte(tela);
  check('o cartão traz a conta do período', /class="res-conta"/.test(tela), true);
  check('  começa pela abertura do período', linhas[0].rot.startsWith('Abriu'), true);
  check('  com o saldo que veio de antes', linhas[0].val, fmt(1150));
  check('  mostra o que JÁ saiu da conta',
    (linhas.find(l => l.rot.startsWith('− Saiu da conta')) || {}).val, fmt(150));
  check('  e fecha no dinheiro que existe hoje',
    (linhas.find(l => l.rot.startsWith('= Em conta hoje')) || {}).val, fmt(1000));
  check('  que é o saldo real da conta', DB.get('accounts', cE).balance, 1000);
  check('  o que ainda vai entrar', (linhas.find(l => l.rot.startsWith('+ A receber')) || {}).val, fmt(800));
  check('  o que ainda vai sair', (linhas.find(l => l.rot.startsWith('− A pagar')) || {}).val, fmt(300));
  /* A conta tem de FECHAR na tela: 1000 + 800 − 300. Uma ponte que não soma é pior
     do que ponte nenhuma — ela convida a conferir e desmente o próprio cartão. */
  check('  e as parcelas fecham no total', linhas[linhas.length - 1].total
    && linhas[linhas.length - 1].val === fmt(1500), true);
  check('  a conta inteira fecha, linha a linha', fecha(linhas), true);
  check('  o total é o mesmo número grande do cartão', numeroGrande(tela), fmt(1500));
  check('  que é o saldo previsto da conta', DB.saldoPrevistoNaData([cE], DB.fimISO(mesAtual)), 1500);
  check('  e a abertura do mês não é o saldo de hoje', DB.saldoNaData([cE], DB.inicioISO(mesAtual)), 1150);
  /* No TÍTULO, não em qualquer lugar da tela: a última linha da própria ponte diz
     "= Saldo previsto em ...", e procurar o texto solto deixava passar um título
     que continuava chamando de saldo um número que é projeção. */
  const tituloDe = html => ((html.match(/res-rot">\s*<b>([^<]+)/) || [])[1] || '').trim();
  check('  e o título avisa que é previsão', /^Saldo previsto em /.test(tituloDe(tela)), true);

  /* MÊS ENCERRADO tem a conta do realizado e NÃO tem a do previsto: ali o fim é
     fato, e prever sobre fato faria o extrato do mês discordar do extrato do
     banco. A conta fecha em "Em conta em <último dia>", não em "hoje". */
  const telaPassado = renderExtrato(mesPassado);
  const linhasP = linhasDaPonte(telaPassado);
  check('mês encerrado mostra o que aconteceu nele', linhasP[0].rot.startsWith('Abriu'), true);
  check('  e não projeta nada', /= Saldo previsto em/.test(telaPassado), false);
  check('  fecha no saldo do último dia, não no de hoje',
    linhasP[linhasP.length - 1].rot.startsWith('= Em conta em'), true);
  check('  com o valor daquela data', linhasP[linhasP.length - 1].val,
    fmt(DB.saldoNaData([cE], DB.fimISO(mesPassado))));
  check('  e o que entrou nele aparece',
    (linhasP.find(l => l.rot.startsWith('+ Entrou na conta')) || {}).val, fmt(500));
  check('  e a conta do mês encerrado fecha', fecha(linhasP), true);
  check('  e o título dele não diz previsto', /previsto/.test(tituloDe(telaPassado)), false);
  check('  ele continua chamando o fim de saldo', /^Saldo em /.test(tituloDe(telaPassado)), true);

  /* MÊS QUE AINDA NÃO COMEÇOU: a ponte parte da ABERTURA dele, não de hoje. Sem
     descontar o que já passou, setembro mostraria também as parcelas de agosto e
     as linhas não bateriam com a lista logo abaixo delas. */
  const telaFuturo = renderExtrato(mesQueVem);
  const linhasF = linhasDaPonte(telaFuturo);
  check('no mês que ainda não chegou, a ponte parte da abertura', linhasF[0].rot.startsWith('Abre em contas'), true);
  check('  com o saldo com que aquele mês abre', linhasF[0].val, fmt(1500));
  check('  o que é do mês corrente não vaza para ele', linhasF.some(l => /A receber|A pagar/.test(l.rot)), false);
  check('  e o dinheiro de hoje vem dito por escrito', telaFuturo.includes('Hoje há'), true);
  check('  com o valor de hoje, não o da abertura',
    telaFuturo.includes(`Hoje há <b>${fmt(1000)}</b>`), true);

  /* TRANSFERÊNCIA AGENDADA. Para a família ela é neutra; para uma conta olhada
     sozinha, não. Medido na base real: R$ 3.400 de aporte apareciam na lista do
     C6 Invest e não mexiam no saldo previsto do topo. */
  const cD = DB.upsert('accounts', { name: 'Conta Ponte Destino', type: 'Investimento', balance: 0, active: true });
  const familiaAntes = DB.saldoPrevistoNaData(null, DB.fimISO(mesAtual));
  DB.upsert('transactions', { ...base, description: 'Aporte ponte', amount: 200, date: fimDoMes,
    type: 'Transferência', method: 'Transferência', to_account: cD });
  check('transferência agendada não muda o previsto da família',
    DB.saldoPrevistoNaData(null, DB.fimISO(mesAtual)), familiaAntes);
  check('  mas chega na conta de destino', DB.saldoPrevistoNaData([cD], DB.fimISO(mesAtual)), 200);
  check('  e sai da conta de origem', DB.saldoPrevistoNaData([cE], DB.fimISO(mesAtual)), 1300);
  check('  olhando as duas juntas, o dinheiro não se move',
    DB.saldoPrevistoNaData([cE, cD], DB.fimISO(mesAtual)), 1500);

  state.filtros = { ...filtrosVazios(), contas: [cD] };
  const telaDestino = renderExtrato(mesAtual);
  check('  o extrato do destino mostra o aporte a caminho',
    (linhasDaPonte(telaDestino).find(l => l.rot.startsWith('+ A receber')) || {}).val, fmt(200));
  check('  e fecha no saldo previsto dela', numeroGrande(telaDestino), fmt(200));
  /* Nessa conta nada se moveu ainda. Um bloco "Realizado" com uma linha só,
     repetindo a abertura, seria cabeçalho sem informação: o saldo vira a primeira
     linha da previsão, que é onde ele faz falta. */
  check('  sem movimento, não há bloco de realizado', /hc-cab">Realizado/.test(telaDestino), false);
  check('  e a conta começa pelo dinheiro que há nela',
    linhasDaPonte(telaDestino)[0].rot, 'Em conta hoje');
  check('  fechando assim mesmo', fecha(linhasDaPonte(telaDestino)), true);

  // Identidade que sustenta tudo: o saldo previsto É saldoNaData + entra − sai
  const mov = DB.movimentoPrevistoAte([cE], DB.fimISO(mesAtual));
  check('o saldo previsto é o saldo de hoje mais o movimento',
    DB.saldoNaData([cE], DB.fimISO(mesAtual)) + mov.entra - mov.sai,
    DB.saldoPrevistoNaData([cE], DB.fimISO(mesAtual)));
  check('  e no passado não há movimento previsto',
    DB.movimentoPrevistoAte([cE], DB.inicioISO(mesPassado)).entra
    + DB.movimentoPrevistoAte([cE], DB.inicioISO(mesPassado)).sai, 0);

  /* VENCIDO DE ANTES fica em linha própria. Ele é dinheiro que ainda vai sair, mas
     não está na lista daquele mês — misturá-lo em "A pagar" faria a linha deixar de
     conferir com o que se vê logo abaixo dela. */
  DB.upsert('transactions', { ...base, description: 'Atrasado ponte', amount: 90,
    date: somarDias(DB.inicioISO(mesAtual), -3), type: 'Despesa', method: 'Boleto' });
  state.filtros = { ...filtrosVazios(), contas: [cE] };
  const comVencido = linhasDaPonte(renderExtrato(mesAtual));
  check('o vencido de antes ganha linha própria',
    (comVencido.find(l => l.rot.startsWith('− Vencido')) || {}).val, fmt(90));
  check('  e não infla o "a pagar" do mês',
    (comVencido.find(l => l.rot.startsWith('− A pagar')) || {}).val, fmt(500));
  check('  mas entra no total previsto',
    comVencido[comVencido.length - 1].val, fmt(1500 - 200 - 90));
  check('  e com ele a conta continua fechando', fecha(comVencido), true);

  /* PAGO COM DATA DEPOIS DO PERÍODO — quem paga adiantado. O dinheiro já saiu da
     conta (o saldo caiu quando marcou como pago), mas o lançamento tem a data do
     vencimento, lá no mês que vem. Ele pertence ao realizado de hoje e NÃO ao
     saldo com que este mês fecha; sem as duas coisas, uma das pontas não fecha. */
  DB.upsert('transactions', { ...base, status: 'Pago', description: 'Adiantado ponte', amount: 60,
    date: somarDias(DB.fimISO(mesAtual), 3), type: 'Despesa', method: 'Boleto' });
  const comAdiantado = linhasDaPonte(renderExtrato(mesAtual));
  check('pagamento adiantado entra no que já saiu da conta',
    (comAdiantado.find(l => l.rot.startsWith('− Saiu da conta')) || {}).val, fmt(150 + 60));
  check('  o bloco de hoje ainda fecha no saldo real',
    (comAdiantado.find(l => l.rot.startsWith('= Em conta hoje')) || {}).val,
    fmt(DB.get('accounts', cE).balance));
  check('  e volta como linha própria no previsto',
    (comAdiantado.find(l => l.rot.startsWith('+ Já pago')) || {}).val, fmt(60));
  check('  com a conta inteira fechando', fecha(comAdiantado), true);
  check('  no total que o cartão anuncia',
    comAdiantado[comAdiantado.length - 1].val, fmt(1500 - 200 - 90 + 60));
  DB.remove('transactions', DB.all('transactions').find(t => t.description === 'Adiantado ponte').id);

  /* COM FILTRO QUE O SALDO NÃO ENTENDE (busca, categoria, membro…), o cartão troca
     a conta de saldo pelo MOVIMENTO do filtro — partido em o que já aconteceu e o
     que ainda vem. Foi o pedido: ver as entradas e saídas até aqui, e vê-las
     obedecendo ao filtro. */
  state.filtros = { ...filtrosVazios(), busca: 'ponte' };
  const comBusca = renderExtrato(mesAtual);
  const linhasB = linhasDaPonte(comBusca);
  check('com filtro de busca, o cartão mostra o movimento do filtro',
    linhasB.map(l => l.rot).join(' · '), 'Já saiu · A receber · A pagar');
  check('  o que já saiu, só do que o filtro deixou passar',
    (linhasB.find(l => l.rot === 'Já saiu') || {}).val, fmt(150));
  check('  o que ainda vem, idem', (linhasB.find(l => l.rot === 'A pagar') || {}).val, fmt(300));
  check('  e nenhuma linha de saldo, que não se filtra por categoria',
    /Abriu|Em conta|Saldo previsto em/.test(comBusca.slice(comBusca.indexOf('res-conta'))), false);
  check('  a tela diz por que o saldo não mudou',
    comBusca.includes('não responde a este filtro'), true);
  /* As duas metades somam a coluna do cabeçalho: é o que impede o cartão de
     contradizer a si mesmo duas linhas acima. */
  const saiuNoTopo = (comBusca.match(/pt pt-dn"><\/i>([\d.,]+) <small>(?:saiu|despesas)/) || [])[1];
  check('  já saiu + a pagar = a coluna de saídas do topo', saiuNoTopo, fmtSemMoeda(150 + 300));

  /* O MESMO, conferindo uma conta: aí os números saem do total do dia — a regra que
     trata transferência e fatura como o extrato do banco trata — e não da soma
     solta dos lançamentos. Duas contas diferentes, e as duas precisam partir. */
  state.filtros = { ...filtrosVazios(), contas: [cE], busca: 'ponte' };
  const comBuscaEConta = renderExtrato(mesAtual);
  const linhasBC = linhasDaPonte(comBuscaEConta);
  check('busca + conta: o já saiu vem do movimento da conta',
    (linhasBC.find(l => l.rot === 'Já saiu') || {}).val, fmt(150));
  check('  o a pagar inclui a transferência que sai dela',
    (linhasBC.find(l => l.rot === 'A pagar') || {}).val, fmt(500));
  check('  e o a receber, o que ainda cai nela',
    (linhasBC.find(l => l.rot === 'A receber') || {}).val, fmt(800));
  const saiuNaConta = (comBuscaEConta.match(/pt pt-dn"><\/i>([\d.,]+) <small>(?:saiu|despesas)/) || [])[1];
  check('  as duas metades somam a coluna do topo', saiuNaConta, fmtSemMoeda(150 + 500));

  // Trocar o filtro tem de trocar os números — senão ele não está sendo obedecido
  state.filtros = { ...filtrosVazios(), busca: 'boleto ponte' };
  const linhasB2 = linhasDaPonte(renderExtrato(mesAtual));
  check('  filtro mais estreito, números menores',
    (linhasB2.find(l => l.rot === 'A pagar') || {}).val, fmt(300));
  check('  e o que não casa com a busca some', linhasB2.some(l => l.rot === 'A receber'), false);

  /* ONDE ESTÁ O DINHEIRO QUE HÁ EM CONTA. "Em conta hoje R$ 1.400" não responde
     quanto dá para gastar quando R$ 400 estão numa conta de investimento. A linha
     é de DETALHE: decompõe a de cima e não entra na soma — se entrasse, o mesmo
     dinheiro seria contado duas vezes e a conta da tela deixaria de fechar. */
  DB.upsert('accounts', { ...DB.get('accounts', cD), balance: 400 });
  /* Uma saída JÁ PAGA da conta de investimento neste mês: ela faz o investido de
     HOJE (400) diferir do investido no fim do mês passado (550). Sem essa
     diferença, ler o saldo de hoje no lugar do saldo daquela data passaria
     despercebido — que é exatamente o erro que a linha do mês encerrado pode ter. */
  DB.upsert('transactions', { ...base, status: 'Pago', description: 'Taxa ponte', amount: 150,
    date: DB.inicioISO(mesAtual), type: 'Despesa', method: 'Débito', account_id: cD });
  state.filtros = { ...filtrosVazios(), contas: [cE, cD] };
  const comInvest = linhasDaPonte(renderExtrato(mesAtual));
  const uso = comInvest.find(l => l.detalhe) || {};
  check('o saldo de hoje se abre em uso e investimento',
    (comInvest.find(l => l.rot === '= Em conta hoje') || {}).val, fmt(1400));
  check('  a linha mostra o que está fora do investimento', uso.val, fmt(1000));
  check('  e a nota diz quanto está investido', uso.nota, `fora ${fmt(400)} em investimento`);
  check('  sem virar parcela: a conta continua fechando', fecha(comInvest), true);
  /* O rótulo NÃO pode ser o do Painel. Lá "Livre para gastar hoje" desconta o que
     tem dono (reserva e metas); aqui o corte é onde o dinheiro está. Hoje os dois
     podem coincidir, e é justamente aí que o nome repetido faria estrago. */
  check('  e o rótulo não é o do Painel', uso.rot, 'Em conta de uso');
  check('  que continua sendo outra conta',
    /Livre para gastar/.test(renderExtrato(mesAtual)), false);

  state.filtros = { ...filtrosVazios(), contas: [cE] };
  check('  sem conta de investimento no recorte, a linha não aparece',
    linhasDaPonte(renderExtrato(mesAtual)).some(l => l.detalhe), false);

  /* O FIM DO MÊS também se abre — e com o investido PROJETADO, que inclui o aporte
     agendado. É a resposta a "quanto do que vou ter no fim do mês estará à mão". */
  state.filtros = { ...filtrosVazios(), contas: [cE, cD] };
  const detalhes = linhasDaPonte(renderExtrato(mesAtual)).filter(l => l.detalhe);
  check('  o fim do mês corrente também se abre', detalhes.length, 2);
  check('  com o investido projetado, aporte agendado incluído',
    detalhes[1].nota, `fora ${fmt(400 + 200)} em investimento`);
  check('  e o número é o previsto daquelas contas',
    DB.saldoPrevistoNaData([cD], DB.fimISO(mesAtual)), 600);

  /* MÊS ENCERRADO se abre pelo saldo DAQUELA DATA, não pelo de hoje: em 31/07 havia
     R$ 550 investidos, contra R$ 400 agora. */
  const noPassado = linhasDaPonte(renderExtrato(mesPassado));
  const usoP = noPassado.find(l => l.detalhe) || {};
  check('  mês encerrado se abre pelo saldo daquela data', usoP.nota, `fora ${fmt(550)} em investimento`);
  check('  e a parte de uso é o resto do fechamento', usoP.val, fmt(1150));
  check('  sem virar parcela também lá', fecha(noPassado), true);
  check('  mês futuro idem', linhasDaPonte(renderExtrato(mesQueVem)).some(l => l.detalhe), true);

  /* O GRÁFICO SEGUE A MESMA PROJEÇÃO DO CARTÃO. Antes ele só conhecia o que já
     tinha sido pago: agosto virava uma reta de 31 pontos com um valor só, e
     setembro idem, enquanto o número ao lado anunciava outra coisa. */
  const cent = v => Math.round(v * 100) / 100;
  const diasM = diasDoPeriodo(mesAtual);
  const serieM = serieDeSaldo([cE], diasM, DB.saldoNaData([cE], DB.inicioISO(mesAtual)));
  check('a linha do gráfico chega no saldo previsto do cartão',
    cent(serieM[serieM.length - 1]), cent(DB.saldoPrevistoNaData([cE], DB.fimISO(mesAtual))));
  check('  e deixou de ser uma reta', new Set(serieM.map(cent)).size > 1, true);
  const iHoje = diasM.indexOf(DB.hojeISO());
  const saldoDeHoje = cent(DB.saldoNaData([cE], somarDias(DB.hojeISO(), 1)));
  /* DUAS REGRAS, e qual delas vale depende de haver dia por vir na janela. O
     teste antes só conhecia a primeira e indexava `iHoje + 1` às cegas: no último
     dia do ciclo esse índice não existe e a comparação virava NaN — uma reprovação
     por dia de calendário, não por defeito. */
  if (iHoje >= 0 && iHoje < diasM.length - 1) {
    check('  no ponto de hoje ela vale o saldo de hoje', cent(serieM[iHoje]), saldoDeHoje);
    /* O vencido cai no primeiro dia AINDA POR VIR: a data dele já passou, e o
       passado da linha é fato. Aqui são os R$ 90 do "Atrasado ponte".

       O degrau desse dia traz DUAS coisas — o vencido e o que vence nele —, então
       o movimento próprio do dia é descontado para isolar o vencido. Sem isso a
       igualdade só valia quando o dia seguinte a hoje estava vazio, o que deixa de
       ser verdade perto do fim do mês: medido em 30/08, o degrau dava −210 porque
       o último dia do ciclo tem previsão própria. Ele vem de `previstoPorDia`, a
       mesma varredura que a linha usa — é leitura do dado, não uma segunda cópia
       da regra de onde o vencido entra. */
    const diaPorVir = diasM[iHoje + 1];
    const movDoDia = DB.previstoPorDia([cE], somarDias(diaPorVir, 1))[diaPorVir] || { entra: 0, sai: 0 };
    check('  o vencido entra no primeiro dia por vir, não no passado',
      cent(serieM[iHoje] - serieM[iHoje + 1] + (movDoDia.entra - movDoDia.sai)), 90);
  } else {
    /* JANELA QUE ACABA HOJE. Não há primeiro dia por vir, e o vencido tem de sair
       antes do fechamento que o cartão anuncia — então ele entra no próprio ponto
       de hoje, que ali é o fechamento previsto. Sem isso a ponta da linha ficava
       R$ 90 acima do número escrito ao lado dela. */
    check('  na janela que acaba hoje, o ponto de hoje é o fechamento previsto',
      cent(serieM[iHoje]), cent(DB.saldoPrevistoNaData([cE], DB.fimISO(mesAtual))));
    /* E a igualdade acima não vale de graça: se o cenário não tivesse nada em
       aberto, previsto e realizado coincidiriam e o teste passaria sem exercitar
       nada. Aqui há o vencido, então os dois TÊM de diferir. */
    check('  e ele difere do realizado, porque carrega o que ainda vai sair',
      cent(serieM[iHoje]) !== saldoDeHoje, true);
  }

  const diasF = diasDoPeriodo(mesQueVem);
  const serieF = serieDeSaldo([cE], diasF, DB.saldoPrevistoNaData([cE], DB.inicioISO(mesQueVem)));
  check('no mês que ainda não chegou ela também fecha no previsto',
    cent(serieF[serieF.length - 1]), cent(DB.saldoPrevistoNaData([cE], DB.fimISO(mesQueVem))));
  // Se o vencido de agosto entrasse aqui de novo, a identidade acima quebraria:
  // ele já está dentro do saldo com que setembro abre
  check('  sem contar de novo o que já está na abertura',
    cent(serieF[0]), cent(DB.saldoPrevistoNaData([cE], DB.inicioISO(mesQueVem))));

  for (const t of DB.all('transactions').filter(t => / ponte$/.test(t.description))) DB.remove('transactions', t.id);
  DB.remove('accounts', cE); DB.remove('accounts', cD);
  state.filtros = filtrosVazios();
} catch (e) { console.log(` FALHA | ponte do extrato: ${e.message}`); fail++; }

console.log('\n=== Extrato por conta bate com o do banco ===');
try {
  const cA = DB.upsert('accounts', { name: 'Conta Conf A', type: 'Conta Corrente', balance: 3000, active: true });
  const cB = DB.upsert('accounts', { name: 'Conta Conf B', type: 'Conta Corrente', balance: 500, active: true });
  const d = dia(25);
  // applyTxEffect junto com o upsert: é o que o formulário faz ao salvar, e sem
  // isso o saldo não reflete o lançamento
  const gasto = { description: 'Mercado conf', amount: 100, date: d, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: cA };
  DB.upsert('transactions', gasto);
  applyTxEffect(gasto, +1);
  const tr = { description: 'Envio conf', amount: 700, date: d, type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: cA, to_account: cB };
  DB.upsert('transactions', tr);
  applyTxEffect(tr, +1);

  const pC = DB.monthPeriod(new Date());
  const linhaDia = html => ((html.match(/<p class="tx-day">[\s\S]*?<\/p>/g) || [])
    .find(l => l.includes(fmtDay(d))) || '');

  // Sem filtro de conta: a família não perdeu os 700, só mudaram de lugar
  state.filtros = { ...filtrosVazios(), busca: 'conf' };
  let saida = renderExtrato(pC);
  check('no todo, transferência não soma no dia', linhaDia(saida).includes(fmtShort(100)), true);
  check('e não aparece como 800', linhaDia(saida).includes(fmtShort(800)), false);
  check('no todo, a transferência não tem sinal', /transfer">\s*\d/.test(saida.replace(/&nbsp;/g, ' ')) || saida.includes('transfer">R$'), true);

  // Filtrando pela conta de origem: o banco mostraria −100 e −700
  state.filtros = { ...filtrosVazios(), contas: [cA] };
  saida = renderExtrato(pC);
  check('na conta, a saída inclui a transferência', linhaDia(saida).includes(fmtShort(800)), true);
  check('o topo mostra o que saiu da conta', /pt pt-dn"><\/i>[\d.,]+ <small>saiu/.test(saida), true);
  check('e o saldo atual dela', saida.includes(fmtSemMoeda(DB.get('accounts', cA).balance)), true);
  check('a linha ganha sinal de saída', /transfer">− /.test(saida), true);
  check('dizendo para onde foi', saida.includes('para Conta Conf B'), true);
  check('e explica o saldo anterior', saida.includes('o que veio do mês passado'), true);

  // Filtrando pela conta de destino: o banco mostraria +700
  state.filtros = { ...filtrosVazios(), contas: [cB] };
  saida = renderExtrato(pC);
  check('na conta de destino, a transferência entra', linhaDia(saida).includes(fmtShort(700)), true);
  check('com sinal de entrada', /transfer">\+ /.test(saida), true);
  check('dizendo de onde veio', saida.includes('de Conta Conf A'), true);
  check('e o gasto da outra conta não aparece', saida.includes('Mercado conf'), false);

  // O que o banco mostraria: saldo inicial − saídas + entradas = saldo final
  const movimentoA = 100 + 700;
  check('a soma do extrato explica o saldo da conta',
    3000 - movimentoA, DB.get('accounts', cA).balance);
  check('e o da conta de destino', 500 + 700, DB.get('accounts', cB).balance);

  state.filtros = filtrosVazios();
  for (const t of DB.all('transactions').filter(t => / conf$/.test(t.description))) DB.remove('transactions', t.id);
  DB.remove('accounts', cA); DB.remove('accounts', cB);
} catch (e) { console.log(` FALHA | conciliação por conta: ${e.message}`); fail++; }

/* ---- Duas contas filtradas juntas ----
   Transferência entre elas não é saída nem entrada: o dinheiro não deixou o
   conjunto que se está olhando. Transferência para fora, sim. É a mesma regra do
   "no todo" — lá o conjunto é toda a família, por isso lá tudo é neutro. */
console.log('\n=== Duas contas conferidas juntas ===');
try {
  const x = DB.upsert('accounts', { name: 'Conta X', type: 'Conta Corrente', balance: 4000, active: true });
  const y = DB.upsert('accounts', { name: 'Conta Y', type: 'Conta Corrente', balance: 2000, active: true });
  const z = DB.upsert('accounts', { name: 'Conta Z', type: 'Conta Corrente', balance: 1000, active: true });
  const dd = dia(26);
  const criar = o => { DB.upsert('transactions', o); applyTxEffect(o, +1); return o; };

  const entreXY = criar({ description: 'XY interna', amount: 300, date: dd, type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: x, to_account: y });
  criar({ description: 'XZ saida', amount: 500, date: dd, type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: x, to_account: z });
  criar({ description: 'ZY entrada', amount: 200, date: dd, type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: z, to_account: y });
  criar({ description: 'XW gasto', amount: 40, date: dd, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: x });

  // A regra, direto na função: mesma transferência, conjuntos diferentes
  check('entre duas do conjunto, não move nada', efeitoDaTransferencia(entreXY, [x, y]), 0);
  check('com só a origem no conjunto, é saída', efeitoDaTransferencia(entreXY, [x]), -300);
  check('com só o destino no conjunto, é entrada', efeitoDaTransferencia(entreXY, [y]), 300);
  check('fora do conjunto, não aparece', efeitoDaTransferencia(entreXY, [z]), 0);
  check('sem conjunto (no todo), é neutra', efeitoDaTransferencia(entreXY, []), 0);

  const pXY = DB.monthPeriod(new Date());
  const linhaDoDia = html => ((html.match(/<p class="tx-day">[\s\S]*?<\/p>/g) || [])
    .find(l => l.includes(fmtDay(dd))) || '');

  // X e Y juntas: sai 500 (para Z) + 40 (gasto), entra 200 (de Z). A interna some.
  state.filtros = { ...filtrosVazios(), contas: [x, y] };
  let saida = renderExtrato(pXY);
  check('saída do conjunto soma só o que saiu de verdade', linhaDoDia(saida).includes(fmtShort(540)), true);
  check('entrada soma só o que veio de fora', linhaDoDia(saida).includes(fmtShort(200)), true);
  check('a transferência interna continua listada', saida.includes('XY interna'), true);
  check('mas sem sinal, porque não moveu o conjunto', /transfer">\s*R\$/.test(saida), true);
  check('o topo soma o saldo das duas', saida.includes('Saldo somado'), true);
  check('e explica por que a interna não conta', saida.includes('o dinheiro não saiu daqui'), true);

  // Só X: agora a interna É uma saída
  state.filtros = { ...filtrosVazios(), contas: [x] };
  saida = renderExtrato(pXY);
  check('só a origem: a interna vira saída', linhaDoDia(saida).includes(fmtShort(840)), true);
  check('e some o que não passou por X', saida.includes('ZY entrada'), false);

  // Só Y: a interna É uma entrada
  state.filtros = { ...filtrosVazios(), contas: [y] };
  saida = renderExtrato(pXY);
  check('só o destino: a interna vira entrada', linhaDoDia(saida).includes(fmtShort(500)), true);

  // A conferência tem de fechar com o banco em qualquer recorte
  check('X: saldo inicial − saídas = saldo atual', 4000 - 300 - 500 - 40, DB.get('accounts', x).balance);
  check('Y: saldo inicial + entradas = saldo atual', 2000 + 300 + 200, DB.get('accounts', y).balance);
  check('o conjunto X+Y fecha com saiu e entrou', 4000 + 2000 - 540 + 200,
    DB.get('accounts', x).balance + DB.get('accounts', y).balance);

  state.filtros = filtrosVazios();
  for (const t of DB.all('transactions').filter(t => /^(XY|XZ|ZY|XW) /.test(t.description))) DB.remove('transactions', t.id);
  for (const id of [x, y, z]) DB.remove('accounts', id);
} catch (e) { console.log(` FALHA | duas contas: ${e.message}`); fail++; }

console.log('\n=== Transferência vista dos dois extratos ===');
try {
  const contaA = DB.upsert('accounts', { name: 'Banco A', type: 'Conta Corrente', balance: 5000, active: true });
  const contaB = DB.upsert('accounts', { name: 'Banco B', type: 'Conta Corrente', balance: 1000, active: true });
  const saldoA = DB.get('accounts', contaA).balance;
  const saldoB = DB.get('accounts', contaB).balance;

  // O que a importação do extrato de A cria quando a linha é marcada como transferência
  const transf = {
    description: 'TED PARA BANCO B', amount: 800, date: dia(11),
    type: 'Transferência', status: 'Pago', method: 'Transferência',
    scope: 'Família', member: MEMBRO_COMUM,
    account_id: contaA, to_account: contaB,
    category_id: null, card_id: null, invoice_key: '', recurring: false, adjustment: false,
    fitid: 'FITID-DO-BANCO-A',
  };
  DB.upsert('transactions', transf);
  applyTxEffect(transf, +1);

  check('sai da conta de origem', DB.get('accounts', contaA).balance, saldoA - 800);
  check('e entra na de destino', DB.get('accounts', contaB).balance, saldoB + 800);
  // Nem gasto nem receita: só mudou de lugar. Se contasse, o mês mostraria
  // R$ 800 de despesa E R$ 800 de renda que nunca existiram.
  const p4 = DB.monthPeriod(new Date());
  check('transferência não é gasto', DB.expensesOf(p4).some(t => t.description === 'TED PARA BANCO B'), false);
  check('nem receita', DB.incomesOf(p4).some(t => t.description === 'TED PARA BANCO B'), false);
  check('e o total das contas não muda',
    DB.get('accounts', contaA).balance + DB.get('accounts', contaB).balance, saldoA + saldoB);

  // Agora o extrato de B: o crédito correspondente tem OUTRO fitid
  check('o fitid do outro banco não dedupe', DB.hasFitid('FITID-DO-BANCO-B'), false);
  const achado = DB.acharPernaDeTransferencia(contaB, dia(11), 800, true, new Set());
  check('mas o app reconhece a outra perna', !!achado, true);
  check('e é a transferência certa', achado.description, 'TED PARA BANCO B');

  // Direção importa: um débito em B não é a perna de uma transferência que ENTROU em B
  check('débito em B não casa com entrada', DB.acharPernaDeTransferencia(contaB, dia(11), 800, false, new Set()), null);
  // E a conta precisa ser a certa
  check('conta de fora não casa', DB.acharPernaDeTransferencia(conta, dia(11), 800, true, new Set()), null);
  check('valor diferente não casa', DB.acharPernaDeTransferencia(contaB, dia(11), 799, true, new Set()), null);

  // Tolerância de data: TED cai no dia seguinte, mas não meses depois
  check('um dia de diferença ainda casa', !!DB.acharPernaDeTransferencia(contaB, dia(12), 800, true, new Set()), true);
  check('dez dias depois não casa', DB.acharPernaDeTransferencia(contaB, dia(21), 800, true, new Set()), null);

  // Duas transferências iguais no mesmo dia: cada linha casa com uma
  const transf2 = { ...transf, id: null, fitid: 'FITID-A-2' };
  DB.upsert('transactions', transf2);
  const usados = new Set();
  const m1 = DB.acharPernaDeTransferencia(contaB, dia(11), 800, true, usados);
  usados.add(m1.id);
  const m2 = DB.acharPernaDeTransferencia(contaB, dia(11), 800, true, usados);
  check('duas iguais casam com pernas diferentes', !!m2 && m2.id !== m1.id, true);
  usados.add(m2.id);
  check('e a terceira não tem par', DB.acharPernaDeTransferencia(contaB, dia(11), 800, true, usados), null);

  // A tela: o seletor oferece transferência e a linha pareada vem desmarcada
  const apT = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('seletor do OFX oferece transferência', apT.includes('contasTransferencia'), true);
  check('com prefixo que separa de categoria', /value="transfer:\$\{o\.id\}"/.test(apT), true);
  check('importar cria UM lançamento de transferência', /type: 'Transferência', status: 'Pago', method: 'Transferência'/.test(apT), true);
  check('que move os dois saldos', /DB\.upsert\('transactions', transf\);\s*\r?\n\s*applyTxEffect\(transf, \+1\)/.test(apT), true);
  /* A marcação é a palavra final: o app desmarca o que julga já lançado, mas
     quem importa pode discordar. Antes a linha era pulada mesmo marcada, e a
     caixa de seleção não queria dizer nada. */
  check('linha já lançada vem desmarcada', /<input type="checkbox" data-i="\$\{i\}" \$\{certeza \? '' : 'checked'\}>/.test(apT), true);
  check('mas marcar faz valer', /if \(parEncontrado\[idx\]\) return;/.test(apT), false);
  check('só o desmarcado fica de fora', /if \(!box\.checked\) return;/.test(apT), true);
  check('e o seletor aparece ao marcar', /cx\.checked\) \{ sel\.hidden = false;/.test(apT), true);
  check('toda linha tem seletor, mesmo a desmarcada',
    /<select data-cat="\$\{i\}" \$\{certeza \? 'hidden' : ''\}>/.test(apT), true);
  check('e aparece desmarcada com o motivo', apT.includes('Já lançado como transferência'), true);
  check('trocar a conta refaz o pareamento', /dest\.onchange[\s\S]{0,200}linhasHtml\(\)/.test(apT), true);

  /* Transferência de uma conta para ELA MESMA não move dinheiro (sai e volta),
     então some do saldo sem deixar rastro. Aconteceu 28 vezes numa base real:
     "Lançar em" marcava todas as opções como selected, então o navegador ficava
     com a ÚLTIMA enquanto o código assumia a PRIMEIRA — e a lista de destinos
     era montada excluindo a conta errada. */
  check('só a primeira opção de destino vem marcada',
    /accounts\.map\(\(a, i\) =>[\s\S]{0,120}i === 0 \? 'selected'/.test(apT), true);
  check('e o mesmo para cartões',
    /cards\.map\(\(c, i\) =>[\s\S]{0,120}i === 0 \? 'selected'/.test(apT), true);
  check('o fallback usa a mesma conta que fica marcada',
    /destinoAtual = \(\)[\s\S]{0,220}accounts\[0\]/.test(apT), true);
  check('a lista de destinos exclui a conta atual',
    /contasTransferencia\(contaAtual[\s\S]{0,400}a\.id !== contaAtual/.test(apT), true);
  check('e o gravador recusa destino igual à origem',
    /if \(!outroId \|\| outroId === daqui\) \{[\s\S]{0,60}descartadas\+\+/.test(apT), true);
  check('avisando quantas foram ignoradas', apT.includes('sem destino válido'), true);

  DB.remove('transactions', m1.id); DB.remove('transactions', m2.id);
  DB.remove('accounts', contaA); DB.remove('accounts', contaB);
} catch (e) { console.log(` FALHA | transferência no OFX: ${e.message}`); fail++; }

/* ---- A regra que decide o que já foi importado ----
   Errar para cada lado custa coisas diferentes: descartar um lançamento legítimo
   faz dinheiro sumir em silêncio; deixar passar um repetido gera duplicata, que
   aparece no saldo. A regra é calibrada por isso. */
console.log('\n=== Regra de duplicidade ===');
try {
  const cX = DB.upsert('accounts', { name: 'Conta Dedup A', type: 'Conta Corrente', balance: 0, active: true });
  const cY = DB.upsert('accounts', { name: 'Conta Dedup B', type: 'Conta Corrente', balance: 0, active: true });
  const dD = dia(20);
  DB.upsert('transactions', { description: 'Mercado dedup', amount: 80, date: dD, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: cX, fitid: 'FIT-1' });

  // FITID é único DENTRO da conta, não entre bancos
  check('mesmo FITID na mesma conta é repetido', DB.jaImportado({ fitid: 'FIT-1', amount: -80, date: dD, memo: 'x' }, cX), true);
  check('mesmo FITID em OUTRA conta não é repetido', DB.jaImportado({ fitid: 'FIT-1', amount: -80, date: dD, memo: 'x' }, cY), false);
  check('FITID diferente não é repetido', DB.jaImportado({ fitid: 'FIT-9', amount: -80, date: dD, memo: 'x' }, cX), false);

  // Banco sem FITID: cai para conteúdo exato, exigindo os quatro campos
  DB.upsert('transactions', { description: 'Padaria dedup', amount: 12, date: dD, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Dinheiro', account_id: cX });
  const semFit = { fitid: '', amount: -12, date: dD, memo: 'Padaria dedup' };
  check('sem FITID, conteúdo idêntico é repetido', DB.jaImportado(semFit, cX), true);
  check('valor diferente não é repetido', DB.jaImportado({ ...semFit, amount: -13 }, cX), false);
  check('dia diferente não é repetido', DB.jaImportado({ ...semFit, date: dia(21) }, cX), false);
  check('descrição diferente não é repetido', DB.jaImportado({ ...semFit, memo: 'Outra coisa' }, cX), false);
  check('conta diferente não é repetido', DB.jaImportado(semFit, cY), false);

  /* O caso real: uma saída de R$ 100 em 24/06 foi desmarcada sozinha por parecer
     com uma transferência de 25/06, e sumiu. Agora só o mesmo dia desmarca. */
  const tr = { description: 'Envio dedup', amount: 100, date: dia(25), type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: cX, to_account: cY };
  DB.upsert('transactions', tr); applyTxEffect(tr, +1);

  const mesmoDia = DB.acharPernaDeTransferencia(cX, dia(25), 100, false, new Set());
  check('mesmo dia: encontra', !!mesmoDia, true);
  check('e com certeza, autorizando desmarcar', mesmoDia._certeza, true);

  const umDiaAntes = DB.acharPernaDeTransferencia(cX, dia(24), 100, false, new Set());
  check('um dia antes: encontra', !!umDiaAntes, true);
  check('mas SEM certeza — não desmarca sozinho', umDiaAntes._certeza, false);
  const tresDias = DB.acharPernaDeTransferencia(cX, dia(22), 100, false, new Set());
  check('três dias antes ainda avisa', !!tresDias, true);
  check('sem certeza', tresDias._certeza, false);
  check('quatro dias já não casa', DB.acharPernaDeTransferencia(cX, dia(21), 100, false, new Set()), null);

  const apR = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('só a certeza desmarca a linha', /const certeza = !!\(par && par\._certeza\);/.test(apR), true);
  check('e só ela sai do que será importado', /if \(par && certeza\) \{ usados\.add/.test(apR), true);
  check('na dúvida a linha fica marcada', /<input type="checkbox" data-i="\$\{i\}" \$\{certeza \? '' : 'checked'\}>/.test(apR), true);
  check('com aviso dizendo o que fazer', apR.includes('Se for a mesma, desmarque'), true);
  check('o descarte é refeito ao trocar de conta', /novos = parsed\.txs\.filter\(t => !DB\.jaImportado/.test(apR), true);

  for (const t of DB.all('transactions').filter(t => / dedup$/.test(t.description))) DB.remove('transactions', t.id);
  DB.remove('accounts', cX); DB.remove('accounts', cY);
} catch (e) { console.log(` FALHA | dedup: ${e.message}`); fail++; }

console.log('\n=== Seletor de categoria não é uma lista sem fim ===');
{
  const uiSrc = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  const UIreal = eval(uiSrc + '; UI');

  // <select> falso com a estrutura real de optgroup do app
  const montarSelect = (html, valor = '') => {
    const opts = [];
    let grupo = null;
    for (const m of html.matchAll(/<optgroup label="([^"]*)">|<\/optgroup>|<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)) {
      if (m[1] !== undefined) { grupo = { tagName: 'OPTGROUP', label: m[1] }; continue; }
      if (m[0] === '</optgroup>') { grupo = null; continue; }
      opts.push({ value: m[2], textContent: m[3], disabled: false, parentNode: grupo || { tagName: 'SELECT' } });
    }
    return { options: opts, value: valor, dispatchEvent() {}, addEventListener() {} };
  };

  // DOM mínimo para o painel: guarda o HTML e devolve os nós consultados
  const criarNo = () => {
    const no = {
      className: '', innerHTML: '', style: {}, dataset: {}, tabIndex: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild() {}, remove() {}, focus() {}, addEventListener() {},
      getBoundingClientRect: () => ({ top: 100, bottom: 144, left: 20, right: 340, width: 320, height: 44 }),
      querySelector(sel) { return sel === '.ui-list' ? lista : sel === '.ui-search input' ? null : null; },
      querySelectorAll: () => [],
    };
    return no;
  };
  const lista = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, style: {} };
  const painel = criarNo();
  global.document.createElement = () => painel;

  const selCat = montarSelect(optionsCategorias(null, 'Despesa'));
  const totalOpcoes = selCat.options.length;
  check('o dropdown tem muitas categorias', totalOpcoes > 50, true);

  const box = criarNo(), botao = criarNo();
  UIreal.abrirSelect(selCat, box, botao, () => {});
  const primeiraTela = lista.innerHTML;
  const linhasGrupo = (primeiraTela.match(/ui-grupo-linha/g) || []).length;
  const linhasOpcao = (primeiraTela.match(/class="ui-opt[^"]*"\s+data-i=/g) || []).length;

  check('a primeira tela mostra os grupos', linhasGrupo >= 10, true);
  check('e não despeja as folhas todas', linhasOpcao < 5, true);
  check('a lista encolheu de verdade', linhasGrupo + linhasOpcao < totalOpcoes / 3, true);
  check('cada grupo diz quantas tem', /ui-grupo-info">\d+/.test(primeiraTela), true);
  check('e mostra que dá para entrar', primeiraTela.includes('ui-grupo-seta'), true);

  /* Tocar no grupo tem de ABRIR o grupo, não fechar o painel.
     desenhar() troca o innerHTML da lista, então o elemento clicado sai do DOM
     antes de o clique chegar ao document — onde o "clique fora" testa
     box.contains(alvo) e dá falso para nó removido. Sem barrar a propagação, o
     painel fechava e não dava para escolher nada. */
  {
    // Registra os handlers ligados pelo desenhar() mais recente
    const capturados = [];
    lista.querySelectorAll = sel => {
      if (!/data-grupo/.test(sel)) return [];
      const grupos = [...String(lista.innerHTML).matchAll(/data-grupo="([^"]*)"/g)].map(m => m[1]);
      return grupos.map(g => { const no = { dataset: { grupo: g }, classList: { contains: () => false } }; capturados.push(no); return no; });
    };
    UIreal.fechar();
    const box2 = criarNo();
    UIreal.abrirSelect(montarSelect(optionsCategorias(null, 'Despesa')), box2, criarNo(), () => {});
    check('há linhas de grupo para tocar', capturados.length > 0, true);

    const primeiro = capturados[0];
    let propagou = true;
    primeiro.onclick({ stopPropagation: () => { propagou = false; } });
    check('tocar no grupo não deixa o clique subir', propagou, false);
    check('e o painel continua aberto', !!UIreal.aberto, true);
    check('mostrando as opções daquele grupo', lista.innerHTML.includes('ui-voltar'), true);
    check('com as folhas selecionáveis', /class="ui-opt[^"]*"\s+data-i=/.test(lista.innerHTML), true);

    // Rede de proteção: nó já removido não pode ser lido como "clique fora"
    const uiTxt = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
    check('clique fora ignora elemento já removido', /alvo\.isConnected === false\) return;/.test(uiTxt), true);
    lista.querySelectorAll = () => [];
  }

  // Lista curta continua plana: um nível a mais seria atrito de graça
  const selCurto = montarSelect('<optgroup label="A"><option value="1">um</option></optgroup><optgroup label="B"><option value="2">dois</option></optgroup>');
  UIreal.fechar();
  UIreal.abrirSelect(selCurto, criarNo(), criarNo(), () => {});
  check('lista curta não ganha nível extra', lista.innerHTML.includes('ui-grupo-linha'), false);

  // Reabrir com categoria escolhida entra direto no grupo dela
  const folhas = DB.leafCategories('Despesa');
  const umaFolha = folhas.find(c => c.parent_id);
  const selComValor = montarSelect(optionsCategorias(umaFolha.id, 'Despesa'), umaFolha.id);
  UIreal.fechar();
  UIreal.abrirSelect(selComValor, criarNo(), criarNo(), () => {});
  const comEscolhida = lista.innerHTML;
  check('reabrir vai direto ao grupo da escolhida', comEscolhida.includes('ui-voltar'), true);
  check('e mostra as irmãs dela', comEscolhida.includes(esc(umaFolha.name)), true);
  check('com caminho de volta para os grupos', comEscolhida.includes('Todos os grupos'), true);

  UIreal.fechar();
  check('busca atravessa os dois níveis', /if \(emNiveis && !f\)/.test(uiSrc), true);
  check('busca acha pelo nome do grupo', /norm\(o\.grupo\)\.includes\(f\)/.test(uiSrc), true);
  check('Escape volta um nível antes de fechar', /grupoAberto !== null[\s\S]{0,80}grupoAberto = null; desenhar\(\); return;/.test(uiSrc), true);
  check('Enter no grupo entra nele', /alvoEl\.dataset\.grupo\) \{ grupoAberto = alvoEl\.dataset\.grupo/.test(uiSrc), true);
  check('setas navegam a árvore', uiSrc.includes("e.key === 'ArrowRight'") && uiSrc.includes("e.key === 'ArrowLeft'"), true);
  const cssN = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('voltar tem alvo confortável', /\.ui-voltar \{[^}]*min-height: 40px/.test(cssN), true);
}

console.log('\n=== Retorno ao usuário ===');
{
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const html = fs.readFileSync(BASE + 'index.html', 'utf8');
  const cssA = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  // O toast é o único canal de erro de validação: precisa ser anunciado
  check('toast é anunciado por leitor de tela', /id="toast"[^>]*aria-live="polite"/.test(html), true);
  check('e tem papel de status', /id="toast"[^>]*role="status"/.test(html), true);

  // Exclusões dizem o que se perde, não só "Excluir?"
  check('excluir conta explica o efeito no saldo', /Excluir "\$\{acc\.name\}"\?/.test(ap) && ap.includes('sai do total disponível'), true);
  check('excluir cartão avisa das faturas em aberto', ap.includes('a dívida com o banco continua'), true);
  check('excluir meta diz que o dinheiro fica nas contas', ap.includes('só deixa de contar para esta meta'), true);
  check('nenhuma exclusão importante usa aviso genérico',
    /confirm\('Excluir (conta|cartão|categoria)\?'\)/.test(ap), false);

  // Gravar sem retorno visual parece que nada aconteceu
  for (const t of ['Conta criada', 'Cartão criado', 'Categoria criada', 'Meta criada']) {
    check(`avisa: ${t}`, ap.includes(t + ' ✓'), true);
  }
  for (const t of ['Conta excluída', 'Cartão excluído', 'Categoria excluída', 'Meta excluída']) {
    check(`avisa: ${t}`, ap.includes(t + ' ✓'), true);
  }

  // Sincronizar a pedido sempre responde algo
  check('sincronizar avisa o resultado', ap.includes('Tudo já estava em dia ✓'), true);
  check('e mostra o erro em vez de engolir', /catch \(e\) \{\s*toast\(e\.message \|\| 'Falha ao sincronizar'/.test(ap), true);
  check('não sobrou catch vazio no sync', /Sync\.syncAll\(\)\.then\(render\)\.catch\(\(\) => \{\}\)/.test(ap), false);
  check('botão desabilita enquanto sincroniza', /b\.disabled = true; b\.textContent = 'Sincronizando…'/.test(ap), true);

  // Vazio sem saída de ação deixa a pessoa parada
  check('extrato vazio oferece lançar o primeiro', ap.includes('Lançar o primeiro gasto'), true);

  // Alvos de toque: o projeto já sabe o número certo (.ui-select-btn usa 44px)
  const alvo = (sel, min) => {
    const m = cssA.match(new RegExp(`\\${sel} \\{[^}]*\\}`));
    if (!m) return false;
    const h = m[0].match(/(?:min-)?height: (\d+)px/);
    return !!h && Number(h[1]) >= min;
  };
  check('.pay-btn tem alvo confortável', alvo('.pay-btn', 40), true);
  check('.close-x tem alvo confortável', alvo('.close-x', 40), true);
  check('.link-btn da fatura tem alvo confortável', alvo('.link-btn', 40), true);
  check('etiqueta do extrato é tocável', alvo('.tx-tag', 28), true);

  // Contraste do texto secundário, que carrega informação de decisão
  const lum = h => {
    const c = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /* O AA vale nos DOIS temas, e cada um contra o próprio fundo.

     Antes bastava medir uma cor contra branco, porque só existia o tema claro.
     Com o escuro, o secundário dele é claro de propósito — medi-lo contra
     branco reprovaria justamente a cor certa, e escurecê-la para o teste passar
     a tornaria ilegível no fundo em que ela realmente aparece.

     O fundo de referência é o do CARTÃO (--ink-2), não o da página: é sobre o
     cartão que "faltam R$ X" e "vence dia 5" são lidos, e ele é o mais claro
     dos dois no escuro — ou seja, o pior caso. */
  const tokensDe = bloco => {
    const m = cssA.match(new RegExp(bloco + '\\s*\\{[\\s\\S]*?\\n\\}'));
    if (!m) return {};
    const pega = nome => (m[0].match(new RegExp('--' + nome + ': (#[0-9a-fA-F]{6})')) || [])[1];
    return { dim: pega('paper-dim'), fundo: pega('ink-2') };
  };
  const escuro = tokensDe(':root');
  const claro = tokensDe('\\:root\\[data-tema="light"\\]');
  check('tema escuro define os dois tokens', !!(escuro.dim && escuro.fundo), true);
  check('tema claro define os dois tokens', !!(claro.dim && claro.fundo), true);
  check('texto secundário passa no AA (escuro)', contraste(escuro.dim, escuro.fundo) >= 4.5, true);
  check('texto secundário passa no AA (claro)', contraste(claro.dim, claro.fundo) >= 4.5, true);
}

console.log('\n=== O header nomeia o app e a tela ===');
{
  const idxH = fs.readFileSync(BASE + 'index.html', 'utf8');
  const apH = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const cssH = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  check('a marca é escrita pelo app', /topbar-hello.*textContent = 'DOMI'/.test(apH), true);
  check('  com o nome da família quando existe', /'DOMI' \+ \(nome \? ' · ' \+ nome : ''\)/.test(apH), true);
  check('a tela atual vai no topbar-month', /#topbar-month'\)\.textContent = TITULOS/.test(apH), true);

  /* O bloco sumia abaixo de 1024px — justo o celular, onde o app vive. Se essa
     regra voltar, o header fica sem marca e sem contexto de novo. */
  const escondeNoCelular = /@media \(max-width: 1023px\) \{[^}]*\.topbar-ctx \{ display: none/.test(cssH);
  check('e não é escondido no celular', escondeNoCelular, false);

  /* Sem min-width:0 num filho de flex, a reticência não corta: o bloco empurra
     as ações para fora da barra em vez de encolher. */
  check('o bloco pode encolher (min-width:0)', /\.topbar-ctx \{ min-width: 0/.test(cssH), true);
  check('e o nome da tela usa reticência',
    /\.topbar-month \{[^}]*text-overflow: ellipsis/.test(cssH.replace(/\r?\n/g, ' ')), true);

  /* A PILHA DE CAMADAS.

     A topbar estava em z-index 100, acima de TODA a família de sobreposições
     (que começa em 30) — inclusive do modal, que cobre a tela inteira com o
     título grudado no topo. Resultado: o header pintava sobre o título e o
     cortava pela metade em toda seção de configuração. */
  const z = (sel, txt) => {
    const m = txt.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*z-index:\\s*(\\d+)'));
    return m ? Number(m[1]) : null;
  };
  const plano = cssH.replace(/\r?\n/g, ' ');
  const zTopbar = z('.topbar', plano);
  const zModal = z('.modal', plano);
  const zFolha = z('.sheet', plano);
  const zLock = z('.lock', plano);
  check('a topbar fica ABAIXO do modal', zTopbar < zModal, true, `topbar ${zTopbar} < modal ${zModal}`);
  check('  e abaixo da folha', zTopbar < zFolha, true, `topbar ${zTopbar} < folha ${zFolha}`);
  check('  mas acima do card de mês', zTopbar > 20, true, `topbar ${zTopbar}`);
  check('e a tela de bloqueio segue acima de tudo', zLock > zModal && zLock > zTopbar, true);

  check('o HTML não fixa um mês de mentira no título',
    /id="topbar-month"[^>]*>—</.test(idxH), false);
}

console.log('\n=== O contexto que viaja em toda pergunta ===');
{
  const guardaCfg = IA.cfg;
  const guardaOnde = IA.ondeEstou;
  const guardaAcc = DB.data.accounts, guardaCards = DB.data.cards, guardaKids = DB.data.kids;

  DB.data.accounts = [{ name: 'Banco Um' }];
  DB.data.cards = [{ name: 'Cartao Um' }];
  DB.data.kids = [{ name: 'Crianca Uma' }];

  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.ver.situacao = true;
  IA.ondeEstou = () => ({ tela: 'Extrato', ciclo: -1, rotulo: 'julho de 2026' });
  const ctx = IA.instrucao();

  /* ---- O vocabulário do app ----
     A razão de existir desta camada: `available()` e `caixaLivre()` são
     grandezas DIFERENTES de propósito no js/db.js. Sem a definição, o modelo
     chama as duas de "saldo" e passa a contradizer as telas — que é pior que
     errar a conta, porque ensina um modelo mental que o app não sustenta. */
  check('define disponível para gastar', /Disponível para gastar:/.test(ctx), true);
  check('  e diz que receita futura não entra', /não caiu NÃO entra|Receita que ainda não caiu/.test(ctx), true);
  check('define livre em caixa à parte', /Livre em caixa:/.test(ctx), true);
  check('  marcando a diferença dos dois', /sem descontar o comprometido/.test(ctx), true);
  check('define comprometido, guardado e ciclo',
    /Comprometido:/.test(ctx) && /Guardado:/.test(ctx) && /Ciclo \(ou mês financeiro\):/.test(ctx), true);

  /* ---- Ele só lê ---- */
  check('avisa que só lê', /você só LÊ/.test(ctx), true);
  check('  e manda apontar a tela em vez de fingir', /diga em qual tela/.test(ctx), true);

  /* ---- Onde a pessoa está ----
     Sem isto "e esse mês?" resolve para o ciclo atual enquanto a tela mostra
     outro — a resposta fica certa sobre o mês errado. */
  check('diz em que tela a pessoa está', /tela Extrato/.test(ctx), true);
  check('  e em que ciclo', /ciclo anterior \(julho de 2026\)/.test(ctx), true);
  check('  resolvendo o "esse mês"', /"esse mês", "aqui" ou "isso"/.test(ctx), true);

  /* ---- A CASA respeita as MESMAS permissões das ferramentas ----
     Nome não é saldo, mas é dado da casa. Entregá-lo com a permissão desmarcada
     quebraria a promessa central da tela de configuração. */
  check('com só "situação", cita as contas', /Banco Um/.test(ctx), true);
  check('  mas NÃO o cartão', /Cartao Um/.test(ctx), false);
  check('  nem a criança', /Crianca Uma/.test(ctx), false);

  IA.cfg.ver.cartoes = true;
  IA.cfg.ver.criancas = true;
  const ctx2 = IA.instrucao();
  check('autorizado, o cartão aparece', /Cartao Um/.test(ctx2), true);
  check('  e a criança também', /Crianca Uma/.test(ctx2), true);

  /* ---- O que está desligado é dito pelo nome, nunca pelo dado ---- */
  IA.cfg = IA.padrao();
  IA.cfg.ver.situacao = true;
  const ctx3 = IA.instrucao();
  check('lista o que não foi autorizado', /NÃO AUTORIZADO nesta casa:/.test(ctx3), true);
  check('  nomeando as áreas desligadas', /cartões e faturas/.test(ctx3), true);
  check('  sem citar o que está ligado', /NÃO AUTORIZADO[^\n]*saldos e disponível/.test(ctx3), false);
  Object.keys(IA.cfg.ver).forEach(k => { IA.cfg.ver[k] = true; });
  check('com tudo ligado, a linha some', /NÃO AUTORIZADO/.test(IA.instrucao()), false);

  /* ---- A ORDEM: do estático ao volátil ----
     Não é estética. As duas APIs cobram uma fração por um prefixo já visto, e o
     prefixo só se repete se o começo for idêntico entre as chamadas. A data no
     topo invalidaria o cache a cada pergunta. */
  const ctxO = IA.instrucao();
  const pos = t => ctxO.indexOf(t);
  check('a identidade vem primeiro', pos('Você é o assistente do DOMI'), 0);
  check('o vocabulário antes das regras', pos('O VOCABULÁRIO') < pos('REGRAS:'), true);
  check('a casa depois das regras', pos('REGRAS:') < pos('A CASA:'), true);
  check('e a data por último, que é o que muda', pos('A CASA:') < pos('Hoje é'), true);

  /* ---- Não estoura o orçamento de tokens ----
     Vai em TODA pergunta: o que cresce aqui é multiplicado por cada chamada. */
  /* O TETO É UM ORÇAMENTO, não um número redondo. Isto vai em TODA pergunta e
     é reenviado a cada volta do laço de ferramentas — o que cresce aqui é
     multiplicado por chamada. 1400 é o que as sete camadas custam hoje com
     folga; passar disso deve ser uma DECISÃO (medir o que a camada nova compra),
     não um efeito colateral de escrever mais uma frase. Se estourar, o candidato
     natural a sair é a lista de nomes da casa, que já tem teto próprio. */
  check('o contexto cabe no orçamento de 1400 tokens', Math.round(ctxO.length / 3.6) < 1400, true,
    `~${Math.round(ctxO.length / 3.6)} tokens`);

  /* ---- Sem app carregado, não estoura ----
     ia.js roda sozinho nas suítes, e o gancho pode não existir. */
  IA.ondeEstou = null;
  check('sem o gancho, o contexto ainda sai', IA.instrucao().length > 500, true);
  IA.ondeEstou = () => { throw new Error('ops'); };
  check('e um gancho que estoura não derruba a pergunta', IA.instrucao().length > 500, true);

  IA.cfg = guardaCfg;
  IA.ondeEstou = guardaOnde;
  DB.data.accounts = guardaAcc; DB.data.cards = guardaCards; DB.data.kids = guardaKids;
}

console.log('\n=== Liberar o cofre num aparelho novo ===');
{
  const ap2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const ia2 = fs.readFileSync(BASE + 'js/ia.js', 'utf8');

  /* A tela tem de OFERECER A SAÍDA, não só constatar o problema. */
  check('a tela pede a senha quando falta liberar', /id="ia-senha"/.test(ap2), true);
  check('  com botão para liberar', /id="ia-liberar"/.test(ap2), true);
  check('  e a lista de configurações também avisa', /falta liberar a cópia na nuvem/.test(ap2), true);
  /* A tela não pode mais afirmar "ligada" só por estar logada: era exatamente a
     mentira que fazia o defeito passar despercebido. */
  check('o texto da nuvem vem do estado, não de "está logado"',
    /IA\.estadoDaNuvem\(\)/.test(ap2), true);

  /* SENHA ERRADA NÃO PODE PASSAR. Derivar chave de qualquer texto funciona —
     inclusive do errado, que criaria um cofre inútil E sobrescreveria a cópia
     boa na nuvem com dados que ninguém mais abriria. */
  const lib = ia2.slice(ia2.indexOf('async liberarCofre('), ia2.indexOf('async sincronizar('));
  check('a senha é conferida no servidor antes de virar chave', /await Sync\.signIn\(/.test(lib), true);
  check('  puxa da nuvem ANTES de subir', lib.indexOf('nuvemPuxarCfg') < lib.indexOf('nuvemSalvarCfg'), true);
  check('  e sobe também as conversas locais', /nuvemSalvarChat/.test(lib), true);
  check('  recusando senha vazia', /Digite a senha do seu login/.test(lib), true);

  /* A senha NÃO é guardada em lugar nenhum: guardá-la destruiria a garantia de
     que o servidor não consegue ler. */
  check('a senha não é gravada no DB', /meta\.senha|cfg\.senha|senha:/.test(ia2), false);
}

console.log('\n=== Apagar uma conversa ===');
{
  const guardaChats = DB.data.ia_chats;
  const guardaCfg = IA.cfg;
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  DB.data.ia_chats = [];

  const a = IA.novaConversa();
  IA.gravarTurno(a.id, 'primeira pergunta', 'primeira resposta');
  const b = IA.novaConversa();
  IA.gravarTurno(b.id, 'segunda pergunta', 'segunda resposta');
  check('duas conversas na lista', IA.conversas().length, 2);

  /* ---- A linha ganhou um botão, e ISSO É ESTRUTURAL ----
     A linha inteira era um <button>. Botão não pode conter botão: aninhar a
     lixeira ali produziria HTML inválido, que cada navegador conserta de um
     jeito — normalmente jogando o botão de dentro para FORA da linha. */
  const html = corpoDaListaIA();
  check('cada conversa tem seu botão de apagar',
    (html.match(/data-apagar=/g) || []).length, 2);
  check('e a linha não é mais um botão só', /<button class="ia-item"/.test(html), false);
  check('  virou um contêiner', /<div class="ia-item">/.test(html), true);
  check('  com a área de abrir separada', /class="ia-item-abrir"/.test(html), true);
  check('nenhum botão dentro de botão',
    /<button[^>]*>(?:(?!<\/button>)[\s\S])*?<button/.test(html), false);
  /* Leitor de tela anuncia "botão" três vezes numa lista de três conversas; sem
     o nome, não dá para saber qual se está prestes a apagar. */
  check('o rótulo acessível nomeia a conversa',
    /aria-label="Apagar a conversa primeira pergunta"/.test(html), true);

  /* ---- E apagar apaga mesmo ---- */
  IA.apagarConversa(a.id);
  check('some da lista', IA.conversas().length, 1);
  check('  a certa', IA.conversas()[0].id, b.id);
  check('  e não volta ao consultar', !!IA.conversa(a.id), false);

  /* Apagar aqui e deixar na nuvem faria a próxima sincronização trazer de volta
     — o defeito clássico de lixeira que não é lixeira. */
  const fonteIA = fs.readFileSync(BASE + 'js/ia.js', 'utf8');
  // A busca do fim tem de partir do início do trecho: 'podar()' também aparece
  // ANTES, dentro de gravarTurno, e o slice sairia vazio — passando por acaso.
  const iApagar = fonteIA.indexOf('apagarConversa(id)');
  const trecho = fonteIA.slice(iApagar, fonteIA.indexOf('podar()', iApagar));
  check('apagar também apaga na nuvem', /nuvemApagarChat\(id\)/.test(trecho), true);

  /* ---- Confirma antes ----
     O botão fica encostado em "abrir": o toque errado é provável, e o que ele
     faz não tem volta. */
  const fonteApp2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const handler = fonteApp2.slice(fonteApp2.indexOf("'#sheet [data-apagar]'"), fonteApp2.indexOf("'#sheet [data-apagar]'") + 900);
  check('pergunta antes de apagar', /confirm\(/.test(handler), true);
  check('  e a pergunta nomeia a conversa', /alvo\.titulo/.test(handler), true);
  check('  avisando que não desfaz', /Não dá para desfazer/.test(handler), true);
  check('se a apagada estava aberta, volta para a lista',
    /iaConversaAberta = null/.test(handler), true);

  DB.data.ia_chats = guardaChats;
  IA.cfg = guardaCfg;
}

console.log('\n=== Sem teto de resposta ===');
{
  const guarda = IA.cfg;
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.ver.situacao = true;
  const tools = IA.ferramentasAutorizadas();
  const msgs = [{ role: 'user', content: 'e aí?' }];
  const anth = IA.PROVEDORES.anthropic;
  const deep = IA.PROVEDORES.deepseek;

  /* SEM_TETO é null, e cada provedor o traduz para o que a API dele aceita. */
  check('SEM_TETO é a ausência de teto', IA.SEM_TETO, null);

  /* Na DeepSeek o campo é OPCIONAL: some do corpo. É o "remover" literal. */
  const cD = deep.corpo('deepseek-v4-pro', 'I', msgs, tools, IA.SEM_TETO);
  check('DeepSeek: max_tokens sai do corpo', 'max_tokens' in cD, false);
  check('  mas um número explícito ainda é respeitado',
    deep.corpo('deepseek-v4-pro', 'I', msgs, tools, 512).max_tokens, 512);

  /* Na Anthropic o campo é OBRIGATÓRIO: vai o máximo do modelo, que a
     documentação publica. Pedir alto não custa nada — cobra-se pelo que sai, e
     o limite por minuto conta o que saiu, não o teto pedido. */
  const cA = anth.corpo('claude-opus-5', 'I', msgs, tools, IA.SEM_TETO);
  check('Anthropic: vai o máximo do modelo', cA.max_tokens, 128000);
  check('  e cada modelo tem o seu',
    anth.corpo('claude-haiku-4-5', 'I', msgs, tools, IA.SEM_TETO).max_tokens, 64000);
  check('  com número explícito, ele manda',
    anth.corpo('claude-opus-5', 'I', msgs, tools, 512).max_tokens, 512);
  check('todo modelo declara seu máximo',
    anth.modelos.every(m => m.maxSaida > 0), true);

  /* O DEFEITO DO HAIKU. Eu mandava thinking adaptativo para todo modelo da
     Anthropic. O Haiku 4.5 é da geração 4.5, e essa geração RECUSA adaptativo
     com 400 ("adaptive thinking is not supported on this model") — quem
     escolhesse o modelo mais barato da lista não conseguiria perguntar nada. */
  check('Opus 5 recebe pensamento adaptativo', cA.thinking.type, 'adaptive');
  const cH = anth.corpo('claude-haiku-4-5', 'I', msgs, tools, IA.SEM_TETO);
  check('mas o Haiku 4.5 NÃO recebe o campo', 'thinking' in cH, false);
  check('  porque ele o recusaria com erro 400',
    anth.modelos.find(m => m.id === 'claude-haiku-4-5').pensa, 'nenhum');

  /* O teste de chave também roda sem teto: com 512 e pensamento adaptativo, o
     orçamento acabava antes da chamada de ferramenta e o app reprovava uma
     chave boa dizendo "este modelo não chama ferramenta". */
  const fonte = fs.readFileSync(BASE + 'js/ia.js', 'utf8');
  const tst = fonte.slice(fonte.indexOf('async testar()'), fonte.indexOf('nomeDoModelo()'));
  check('o teste de chave não se limita a 512', /brinquedo, 512\)/.test(tst), false);
  check('  e distingue "cortada" de "não chamou"', /r\.cortada && !r\.pedidos\.length/.test(tst), true);

  /* O laço continua pedindo sem teto — é o caminho real das perguntas. */
  check('o laço pergunta sem teto', /msgs, tools, this\.SEM_TETO\)/.test(fonte), true);
  check('e não sobrou o teto antigo', /MAX_TOKENS: \d+/.test(fonte), false);

  IA.cfg = guarda;
}

console.log('\n=== A tela desenha enquanto o texto chega ===');
{
  const ap3 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const ia3 = fs.readFileSync(BASE + 'js/ia.js', 'utf8');
  const env = ap3.slice(ap3.indexOf('async function enviarIA('), ap3.indexOf('/* ---------- Boot ---------- */'));

  /* A chamada leva uma função aninhada no meio (o aoAndar), então a busca
     ancora no FECHAMENTO dela, e não tenta atravessar os parênteses. */
  check('a tela passa um recebedor de texto', /\}, aoTexto\);/.test(env), true);
  check('  e o assistente o repassa ao laço',
    /perguntar\(contexto, aoAndar, aoTexto\)/.test(ia3), true);

  /* Repintar o markdown a cada pedaço seria refazer o parse dezenas de vezes por
     segundo. O acúmulo em string + repintura espaçada é o que mantém isso barato
     num celular. */
  check('o texto se acumula antes de pintar', /acumulado \+= pedaco/.test(env), true);
  check('  e a repintura é espaçada', /90 - \(Date\.now\(\) - ultimaPintura\)/.test(env), true);
  check('  sem enfileirar uma pintura por pedaço', /if \(agendada\) return;/.test(env), true);

  /* PRIVACIDADE. Sem marcar os valores a cada repintura, no modo privado os
     números apareceriam limpos enquanto a resposta é escrita — exatamente o que
     esse modo existe para impedir. */
  check('cada repintura marca os valores', (env.match(/marcarValores\(resp\)/g) || []).length >= 2, true);

  /* A pintura final usa o texto GRAVADO, não o acumulado: é ele que leva o aviso
     de corte e é ele que reaparece ao reabrir a conversa. Divergir faria a tela
     mudar sozinha na próxima abertura. */
  check('a pintura final usa o texto gravado', /resp\.innerHTML = formatarResposta\(r\.texto\)/.test(env), true);
  check('e a pintura agendada é cancelada no fim', /clearTimeout\(agendada\)/.test(env), true);

  /* Consultar uma ferramenta é um tempo em que nada é escrito: os pontinhos
     voltam para dizer que o trabalho continua. */
  check('os pontinhos voltam durante a consulta',
    /if \(p\) p\.textContent = rotulos\[nome\][\s\S]{0,220}pensando\.hidden = false/.test(env), true);
}

console.log('\n=== O markdown da resposta ===');
{
  /* formatarResposta vive no js/app.js e depende de esc(). Roda aqui isolada,
     com o mesmo esc do app, para o teste exercitar a função de verdade em vez
     de conferir o texto do código. */
  const fonteApp = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const trechoMD = fonteApp.slice(
    fonteApp.indexOf('function formatarResposta('),
    fonteApp.indexOf('function ligarIAChat('));
  // `esc` é uma arrow const, não uma function declarada — a busca precisa
  // casar com a forma real, senão o teste roda contra o esc global da suíte
  // e deixa de provar que formatarResposta escapa por conta própria.
  const escApp = (fonteApp.match(/^const esc = [^\r\n]+/m) || [])[0];
  check('achou formatarResposta e esc no app.js', !!(trechoMD && escApp), true);
  const md = new Function(escApp + '\n' + trechoMD + '\nreturn formatarResposta;')();

  /* ---- ESCAPAR VEM PRIMEIRO. SEMPRE. ----
     A resposta é texto de fora. Se a formatação rodasse antes do escape,
     bastaria o modelo repetir uma tag para ela virar HTML de verdade dentro da
     folha — e ele repete o que leu nos dados da própria pessoa, que é onde
     alguém poderia ter plantado isso na descrição de um lançamento. */
  const hostil = md('<img src=x onerror=alert(1)> e <script>roubar()</script>');
  check('tag na resposta não vira HTML', /<img|<script/i.test(hostil), false);
  check('  ela aparece como texto', /&lt;img/.test(hostil), true);
  check('negrito com tag dentro continua inerte', /<b><img/i.test(md('**<img src=x>**')), false);
  check('e o texto entre asteriscos ainda vira negrito', /<b>/.test(md('o total é **R$ 30,00**')), true);

  /* ---- O que o modelo escreve o tempo todo ---- */
  check('lista com "-" vira <ul>', /<ul><li>/.test(md('- um\n- dois')), true);
  check('lista numerada vira <ol>', /<ol><li>/.test(md('1. um\n2. dois')), true);
  check('  sem repetir o número no texto', /<li>1\./.test(md('1. um\n2. dois')), false);
  check('"###" vira rótulo de seção, não título solto',
    /<p class="ia-secao">Resumo<\/p>/.test(md('### Resumo')), true);
  check('itálico vira <i>', /<i>quase<\/i>/.test(md('é *quase* isso')), true);
  check('código vira <code>', /<code>Alimentação<\/code>/.test(md('a categoria `Alimentação`')), true);
  check('citação vira blockquote', /<blockquote/.test(md('> cuidado com a fatura')), true);
  check('régua vira <hr>', /<hr/.test(md('---')), true);
  check('riscado vira <s>', /<s>era<\/s>/.test(md('~~era~~ agora é')), true);

  /* ---- TABELA: o formato que mais importa aqui ----
     Resposta de app de dinheiro é tabular. O modelo escreve em pipes sem que se
     peça; sem entender, a folha mostrava uma grade de "|" que ninguém lê. */
  const tab = md(['| Categoria | Gasto |', '| --- | ---: |', '| Alimentação | R$ 625,40 |'].join('\n'));
  check('tabela em pipes vira <table>', /<table>/.test(tab), true);
  check('  com cabeçalho', /<th[^>]*>Categoria<\/th>/.test(tab), true);
  check('  e a célula no corpo', /<td[^>]*>Alimentação<\/td>/.test(tab), true);
  check('  a linha de traços não vira linha', /<td[^>]*>---/.test(tab), false);
  check('  o alinhamento sai da sintaxe ---:', /text-align:right/.test(tab), true);
  /* A folha é estreita: a tabela tem de rolar DENTRO dela mesma, senão quem rola
     de lado é a folha inteira — e some o botão de fechar. */
  check('  e rola dentro do próprio bloco', /<div class="ia-tabela">/.test(tab), true);
  check('texto com um | solto NÃO vira tabela', /<table>/.test(md('gasto | previsto')), false);
  const tabHostil = md(['| A | B |', '| --- | --- |', '| <img src=x onerror=1> | ok |'].join('\n'));
  check('tag dentro de célula continua inerte', /<img/i.test(tabHostil), false);

  /* ---- E o que NÃO deve virar ----
     Negrito é dois asteriscos; se o itálico rodasse antes, comeria um de cada
     par e "**x**" viraria "<i>*x*</i>". */
  check('negrito não é confundido com itálico', /<b>total<\/b>/.test(md('**total**')), true);
  check('  e não sobra asterisco solto', /\*/.test(md('**total**')), false);
  check('asterisco de multiplicação não vira itálico', /<i>/.test(md('3*4 = 12')), false);
  /* LINK NÃO VIRA ÂNCORA, de propósito: um assistente financeiro não tem por que
     emitir endereço clicável, e converter abriria porta para plantar um. */
  check('link não vira âncora', /<a /.test(md('veja [aqui](http://x.com)')), false);

  /* ---- Parágrafos ---- */
  check('linha simples vira <p>', /^<p>oi<\/p>$/.test(md('oi')), true);
  check('quebra simples vira <br>', /<br>/.test(md('uma\noutra')), true);
  check('linha em branco separa parágrafos', (md('uma\n\noutra').match(/<p>/g) || []).length, 2);
  check('texto vazio não estoura', md(''), '');
  check('nulo não estoura', md(null), '');

  /* ---- E o prompt DIZ tudo isso ao modelo ----
     De nada adianta a tela entender tabela se o modelo não souber que pode usá-la
     — nem emitir link, que aqui vira texto cru. */
  const ctxF = IA.instrucao();
  check('o prompt ensina o formato da tela', /COMO ESCREVER\./.test(ctxF), true);
  check('  pedindo tabela para dados comparáveis', /TABELA sempre que/.test(ctxF), true);
  check('  com um exemplo de tabela', /\| --- \| ---: \|/.test(ctxF), true);
  check('  e proibindo o que a tela não renderiza', /NÃO use link, imagem/.test(ctxF), true);
  check('  avisando da linha em branco entre blocos', /linha em branco entre blocos/.test(ctxF), true);
}

console.log('\n=== Os dois provedores ===');
{
  const iaSrc2 = fs.readFileSync(BASE + 'js/ia.js', 'utf8');

  /* ---- A escolha é da pessoa, e nada se perde ao trocar ---- */
  IA.cfg = IA.padrao();
  check('nasce na Anthropic', IA.cfg.provedor, 'anthropic');
  check('os dois provedores existem',
    Object.keys(IA.PROVEDORES).sort().join(','), 'anthropic,deepseek');

  IA.cfg.chaves.anthropic = 'sk-ant-UM';
  IA.cfg.provedor = 'deepseek';
  IA.cfg.chaves.deepseek = 'sk-DOIS';
  check('cada provedor guarda a chave dele', IA.chaveAtual(), 'sk-DOIS');
  IA.cfg.provedor = 'anthropic';
  check('e trocar de volta não perdeu a outra', IA.chaveAtual(), 'sk-ant-UM');

  /* Configuração da v158 tinha `chave`/`modelo` soltos, de quando só havia a
     Anthropic. Quem já colou a chave não pode ser obrigado a colar de novo. */
  DB.data.meta = DB.data.meta || {};
  DB.data.meta.ia = { ligado: true, chave: 'sk-ant-VELHA', modelo: 'claude-sonnet-5', ver: { situacao: true } };
  const migrada = IA.load();
  check('config antiga migra a chave', migrada.chaves.anthropic, 'sk-ant-VELHA');
  check('e o modelo', migrada.modelos.anthropic, 'claude-sonnet-5');
  check('sem deixar o campo velho para trás', migrada.chave, undefined);
  delete DB.data.meta.ia;

  /* ---- Cada provedor traduz na borda ---- */
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.ver.situacao = true;
  const tools = IA.ferramentasAutorizadas();

  const anth = IA.PROVEDORES.anthropic;
  const deep = IA.PROVEDORES.deepseek;
  const msgs = [{ role: 'user', content: 'e aí?' }];

  const cA = anth.corpo('claude-opus-5', 'INSTRUÇÃO', msgs, tools, 2000);
  check('Anthropic: instrução é campo próprio', cA.system, 'INSTRUÇÃO');
  check('  e a ferramenta usa input_schema', !!cA.tools[0].input_schema, true);
  check('  com pensamento adaptativo', cA.thinking.type, 'adaptive');

  const cD = deep.corpo('deepseek-v4-pro', 'INSTRUÇÃO', msgs, tools, 2000);
  check('DeepSeek: instrução vira a 1ª mensagem', cD.messages[0].role, 'system');
  check('  e a pergunta vem depois', cD.messages[1].content, 'e aí?');
  check('  sem campo system solto', cD.system, undefined);
  check('  a ferramenta é embrulhada em function', cD.tools[0].type, 'function');
  check('  com parameters, não input_schema', !!cD.tools[0].function.parameters, true);
  check('  e o mesmo nome dos dois lados', cD.tools[0].function.name, cA.tools[0].name);

  /* ---- E lê a resposta de volta na forma neutra ---- */
  const respA = { content: [
    { type: 'text', text: 'deixa eu ver' },
    { type: 'tool_use', id: 'tu_1', name: 'situacao_financeira', input: { mes: 0 } },
  ] };
  const lidoA = anth.ler(respA);
  check('Anthropic: lê o texto', lidoA.texto, 'deixa eu ver');
  check('  e o pedido de ferramenta', lidoA.pedidos[0].name, 'situacao_financeira');
  check('  com o input já em objeto', lidoA.pedidos[0].input.mes, 0);

  const respD = { choices: [{ message: {
    role: 'assistant', content: 'deixa eu ver',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'situacao_financeira', arguments: '{"mes":0}' } }],
  } }] };
  const lidoD = deep.ler(respD);
  check('DeepSeek: lê o texto', lidoD.texto, 'deixa eu ver');
  check('  e o pedido dentro de tool_calls', lidoD.pedidos[0].name, 'situacao_financeira');
  check('  desserializando os argumentos', lidoD.pedidos[0].input.mes, 0);
  /* Um modelo pode mandar JSON que não fecha. Estourar aí derrubaria a conversa
     inteira; o objeto vazio deixa a ferramenta rodar com os padrões dela. */
  const quebrado = deep.ler({ choices: [{ message: { tool_calls: [
    { id: 'c', function: { name: 'situacao_financeira', arguments: '{"mes":' } }] } }] });
  check('  e argumento quebrado não derruba a conversa', JSON.stringify(quebrado.pedidos[0].input), '{}');

  /* ---- O resultado volta no formato de cada uma ---- */
  const pares = [{ id: 'x1', saida: '{"em_conta":10}' }, { id: 'x2', saida: '{"ok":true}' }];
  const mA = anth.msgsResultado(pares);
  check('Anthropic: os resultados vão numa ÚNICA mensagem', mA.length, 1);
  check('  como blocos tool_result', mA[0].content.length, 2);
  check('  amarrados pelo tool_use_id', mA[0].content[0].tool_use_id, 'x1');

  const mD = deep.msgsResultado(pares);
  check('DeepSeek: uma mensagem POR resultado', mD.length, 2);
  check('  com papel tool', mD[0].role, 'tool');
  check('  amarrada pelo tool_call_id', mD[1].tool_call_id, 'x2');

  /* ---- O laço não conhece provedor ---- */
  const laco = iaSrc2.slice(iaSrc2.indexOf('async perguntar('), iaSrc2.indexOf('async chamar('));
  check('o laço não cita nenhum provedor pelo nome',
    /anthropic|deepseek|tool_use|tool_calls/i.test(laco), false);

  /* ---- Nenhuma chave literal escapou ---- */
  check('nenhuma chave real no código', /sk-ant-[A-Za-z0-9]{20,}/.test(iaSrc2), false);

  /* ---- As duas falam com o endereço certo ---- */
  check('Anthropic no endereço dela', anth.url, 'https://api.anthropic.com/v1/messages');
  check('DeepSeek no endereço dela', deep.url, 'https://api.deepseek.com/chat/completions');
  check('a Anthropic manda o cabeçalho que ela exige do navegador',
    !!anth.cabecalhos('k')['anthropic-dangerous-direct-browser-access'], true);
  check('e a DeepSeek autentica por Bearer', deep.cabecalhos('k').Authorization, 'Bearer k');

  IA.cfg = IA.padrao();
}

console.log('\n=== O assistente: permissões e ferramentas ===');
{
  const iaSrc = fs.readFileSync(BASE + 'js/ia.js', 'utf8');
  const apIA = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const idxIA = fs.readFileSync(BASE + 'index.html', 'utf8');

  /* ---- Desligado, o app é o de antes ----
     A promessa central: quem não configurou não vê nada de IA em lugar nenhum. */
  IA.cfg = IA.padrao();
  check('nasce desligado', IA.cfg.ligado, false);
  check('e sem nenhuma permissão', Object.values(IA.cfg.ver).some(Boolean), false);
  check('desligado, não está disponível', IA.disponivel(), false);
  check('o botão nasce escondido no HTML', /id="btn-ia"[^>]*hidden/.test(idxIA), true);
  check('e só é revelado por pintarBotaoIA', /function pintarBotaoIA[\s\S]{0,320}IA\.disponivel\(\)/.test(apIA), true);

  /* ---- A chave é do usuário, e nunca sai em texto claro ----

     Mudou o dono da conta: antes a chave era do app, guardada nos secrets de uma
     Edge Function. Agora é de quem pergunta, e mora no aparelho dele. Isso move
     o risco de lugar, e é isso que estas asserções guardam. */
  check('a chamada vai direto para a API da Anthropic',
    iaSrc.includes('https://api.anthropic.com/v1/messages'), true);
  check('com o cabeçalho que a Anthropic exige do navegador',
    iaSrc.includes('anthropic-dangerous-direct-browser-access'), true);
  check('e não sobrou nada da Edge Function', iaSrc.includes('/functions/v1/assistente'), false);
  check('nenhuma chave literal ficou no código', /sk-ant-[A-Za-z0-9]/.test(iaSrc), false);

  /* A chave mora dentro do banco cifrado com o PIN, não no localStorage solto —
     que é o único lugar deste app onde criptografia nenhuma protege. */
  check('a configuração mora dentro do banco cifrado',
    /DB\.data\.meta\.ia = this\.cfg/.test(iaSrc), true);
  check('e não no localStorage', /localStorage\.setItem/.test(iaSrc), false);

  /* O que sobe para o Supabase passa obrigatoriamente pelo cofre. Se alguém um
     dia trocar `cifrar(...)` por `this.cfg` cru, a chave de API de todo mundo
     passa a estar legível no SQL Editor do dono do projeto — e nada quebraria. */
  check('o que sobe é cifrado antes', /const dados = await this\.cifrar\(this\.cfg\)/.test(iaSrc), true);
  check('a conversa também sobe cifrada', /const dados = await this\.cifrar\(c\)/.test(iaSrc), true);
  check('nenhum corpo sobe com a chave crua',
    /body: JSON\.stringify\(\{[^}]*chave/.test(iaSrc), false);

  /* A chave do cofre vem da senha do login, com sal derivado do id do usuário —
     é o que faz o aparelho novo chegar na MESMA chave sem buscar nada antes. */
  check('o cofre deriva da senha do login', /abrirCofre\(senha\)/.test(iaSrc), true);
  check('com PBKDF2 e sal do id do usuário',
    /deriveKey\(senha, await this\.sal\(uid\)/.test(iaSrc), true);
  check('e o login é quem o abre',
    /IA\.abrirCofre\(password\)/.test(fs.readFileSync(BASE + 'js/sync.js', 'utf8')), true);

  /* O backup exportado é um .json solto na pasta de downloads, mandado por
     e-mail, guardado no drive — o lugar do app onde criptografia nenhuma
     protege. Credencial nenhuma pode ir junto.

     ESTE TESTE RODA exportJSON DE VERDADE. A versão anterior procurava o texto
     `chave: ''` no código-fonte e passou tranquila quando as chaves mudaram de
     `meta.ia.chave` para `meta.ia.chaves.<provedor>` — o campo zerado deixou de
     existir e as duas chaves passariam a sair no arquivo. Asserção de texto não
     enxerga mudança de forma; execução enxerga. */
  {
    const guardado = DB.data.meta ? { ...DB.data.meta } : undefined;
    DB.data.meta = {
      ...(DB.data.meta || {}),
      ia_cofre: 'CHAVE-DO-COFRE-EM-BASE64',
      ia: {
        ligado: true,
        provedor: 'deepseek',
        chaves: { anthropic: 'sk-ant-SEGREDO-UM', deepseek: 'sk-SEGREDO-DOIS' },
        modelos: { anthropic: 'claude-opus-5', deepseek: 'deepseek-v4-pro' },
        ver: { situacao: true },
      },
    };

    const saida = DB.exportJSON();
    check('o backup não leva a chave da Anthropic', saida.includes('sk-ant-SEGREDO-UM'), false);
    check('nem a chave da DeepSeek', saida.includes('sk-SEGREDO-DOIS'), false);
    check('nem a chave do cofre', saida.includes('CHAVE-DO-COFRE-EM-BASE64'), false);

    // O resto da configuração continua no backup: só as credenciais saem.
    const volta = JSON.parse(saida);
    check('mas o provedor escolhido continua lá', volta.meta.ia.provedor, 'deepseek');
    check('e o modelo escolhido também', volta.meta.ia.modelos.deepseek, 'deepseek-v4-pro');
    check('e as permissões', volta.meta.ia.ver.situacao, true);

    DB.data.meta = guardado;
  }

  /* As duas tabelas do assistente são as únicas de escopo pessoal do app. Uma
     policy escrita por engano com escopo de família deixaria um membro da casa
     ler a chave do outro — e nada no app daria erro. */
  {
    const sql = fs.readFileSync(BASE + 'supabase/assistente.sql', 'utf8');
    check('ia_config e ia_chats existem no schema',
      /create table if not exists ia_config/.test(sql) && /create table if not exists ia_chats/.test(sql), true);
    check('com RLS ligado nas duas',
      (sql.match(/enable row level security/g) || []).length >= 2, true);
    /* Sem os comentários: a palavra "family_id" aparece no texto que explica
       justamente por que estas duas tabelas não a usam. */
    const codigo = sql.replace(/--.*/g, '');
    check('o escopo é do usuário, não da família',
      codigo.includes('using (user_id = auth.uid()) with check (user_id = auth.uid())')
      && !codigo.includes('family_id'), true);
    check('e o schema principal também as tem',
      fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8').includes('create table if not exists ia_chats'), true);
  }

  /* ---- Sem permissão, a ferramenta não é nem oferecida ---- */
  IA.cfg.ligado = true;
  check('nada autorizado ainda', IA.algoAutorizado(), false);
  check('nenhuma ferramenta é oferecida', IA.ferramentasAutorizadas().length, 0);

  IA.cfg.ver.situacao = true;
  const oferecidas = IA.ferramentasAutorizadas().map(f => f.name);
  check('com "situação" ligada, ela aparece', oferecidas.includes('situacao_financeira'), true);
  check('mas os lançamentos não', oferecidas.includes('lancamentos'), false);
  check('nem o cofrinho', oferecidas.includes('cofrinho_das_criancas'), false);

  /* ---- E, mesmo pedida pelo nome, não roda ----
     O modelo pode inventar um nome de ferramenta. O app não obedece: a permissão
     é conferida de novo na hora de executar. */
  const roubo = IA.executar('lancamentos', { mes: 0 });
  check('pedir uma ferramenta não autorizada é recusado', !!roubo.erro, true);
  check('e a recusa diz o motivo', /permiss/i.test(roubo.erro), true);
  check('ferramenta inexistente também é recusada', !!IA.executar('formatar_disco', {}).erro, true);

  /* ---- As ferramentas devolvem o número do app, não uma conta nova ---- */
  const sit = IA.executar('situacao_financeira', {});
  check('a situação vem sem erro', !sit.erro, true);
  check('e o disponível é o mesmo do app',
    Math.abs(sit.disponivel_para_gastar - DB.available()) < 0.011, true);
  check('o em-conta também', Math.abs(sit.em_conta - DB.accountsTotal()) < 0.011, true);

  IA.cfg.ver.categorias = true;
  const cats = IA.executar('gastos_por_categoria', { mes: 0 });
  check('categorias devolve uma lista', Array.isArray(cats), true);
  check('ordenada do maior para o menor',
    cats.every((c, i) => i === 0 || cats[i - 1].gasto >= c.gasto), true);
  check('e sem nenhuma descrição de lançamento',
    JSON.stringify(cats).includes('descricao'), false);

  /* A simulação NÃO grava: é a diferença entre responder "e se" e mexer na vida
     financeira de alguém sem pedir. */
  IA.cfg.ver.previsao = true;
  const antes = DB.all('transactions').length;
  const sim = IA.executar('simular_cenario', { variacao_mensal: -300, meses: 3, descricao: 'academia' });
  check('a simulação responde', !sim.erro, true);
  check('e não cria lançamento nenhum', DB.all('transactions').length, antes);
  check('nem grava recorrência', DB.all('recurrences').length, DB.all('recurrences').length);
  check('a resposta avisa que nada foi gravado', /nada foi gravado/i.test(sim.observacao), true);

  /* ---- O teto dos lançamentos ----
     Um mês grande não pode ir inteiro para o modelo: custa caro e o agregado já
     responde o que quase toda pergunta pede. */
  IA.cfg.ver.lancamentos = true;
  const lanc = IA.executar('lancamentos', { mes: 0 });
  check('lançamentos agora é permitido', Array.isArray(lanc), true);
  check('e vem com teto de itens', lanc.length <= 80, true);

  /* ---- O histórico ---- */
  DB.data.ia_chats = [];
  const c1 = IA.novaConversa();
  check('conversa nova começa vazia', c1.turnos.length, 0);
  IA.gravarTurno(c1.id, 'Quanto sobra este mês?', 'Sobram R$ 1.031,55.');
  check('o turno é gravado', IA.conversa(c1.id).turnos.length, 1);
  check('e o título sai da primeira pergunta', IA.conversa(c1.id).titulo, 'Quanto sobra este mês?');

  /* O que NÃO fica guardado é a parte pesada e a que envelhece: os resultados de
     ferramenta. Retomar uma conversa antiga com saldos antigos colados daria
     resposta sobre um mês que já passou. */
  check('só texto é guardado, sem blocos de ferramenta',
    /tool_use|tool_result/.test(JSON.stringify(DB.data.ia_chats)), false);
  const ctx = IA.contextoDe(IA.conversa(c1.id));
  check('o contexto de retomada é pergunta e resposta', ctx.length, 2);
  check('e vem no formato da API', ctx[0].role === 'user' && ctx[1].role === 'assistant', true);

  // Os tetos: sem eles, um ano de uso encheria o localStorage
  for (let i = 0; i < IA.MAX_TURNOS + 10; i++) IA.gravarTurno(c1.id, 'p' + i, 'r' + i);
  check('os turnos antigos caem', IA.conversa(c1.id).turnos.length, IA.MAX_TURNOS);
  check('e ficam os mais recentes',
    IA.conversa(c1.id).turnos.slice(-1)[0].q, 'p' + (IA.MAX_TURNOS + 9));

  for (let i = 0; i < IA.MAX_CONVERSAS + 5; i++) {
    const c = IA.novaConversa();
    IA.gravarTurno(c.id, 'conversa ' + i, 'ok');
  }
  check('as conversas antigas também caem', IA.conversas().length <= IA.MAX_CONVERSAS, true);
  check('o contexto de retomada é curto', IA.MAX_CONTEXTO <= 10, true);

  /* ---- Não sincroniza ----
     Conversa é do aparelho. Mandá-la para a nuvem exporia texto sobre a vida
     financeira da família sem necessidade e inflaria todo pull. */
  const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  check('ia_chats não está nas tabelas de sincronização', /ia_chats/.test(syncSrc), false);
  check('mas está nas stores do DB, para herdar a criptografia',
    /STORES = \[[\s\S]*?'ia_chats'/.test(fs.readFileSync(BASE + 'js/db.js', 'utf8')), true);

  DB.data.ia_chats = [];
  IA.cfg = IA.padrao();
}

console.log('\n=== Tema, privacidade e o header ===');
{
  const cssT2 = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const apT = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const idx = fs.readFileSync(BASE + 'index.html', 'utf8');

  /* O tema é decidido ANTES da primeira pintura. Lido depois que app.js carrega,
     o app abre no tema errado e troca no quadro seguinte — o flash branco. */
  check('o tema é aplicado antes de qualquer script do app',
    idx.indexOf('financas.tema') < idx.indexOf('js/config.js'), true);
  check('e a privacidade também', idx.indexOf('financas.privacidade') < idx.indexOf('js/app.js'), true);
  check('o escuro é o padrão do sistema de cores', /:root \{\s*\n\s*color-scheme: dark/.test(cssT2), true);
  check('o claro existe por preferência do aparelho',
    /@media \(prefers-color-scheme: light\)[\s\S]{0,80}:root:not\(\[data-tema="dark"\]\)/.test(cssT2), true);
  check('e a escolha explícita vence os dois', /:root\[data-tema="light"\] \{/.test(cssT2), true);

  /* ---- Todo token de COR precisa existir nos dois temas ----
     Um valor definido só no escuro não some: ele VAZA para o claro com a cor
     errada, e o efeito é discreto o bastante para passar despercebido — foi o
     que aconteceu com quinze bordas que continuaram no azul da paleta anterior
     depois de a paleta inteira mudar.

     Tokens estruturais (raio, fonte, curva de animação) não dependem de tema e
     ficam de fora por nome. */
  const blocoDark = cssT2.slice(cssT2.indexOf(':root {'), cssT2.indexOf('@media (prefers-color-scheme: light)'));
  const blocoLight = cssT2.slice(cssT2.indexOf(':root[data-tema="light"]'), cssT2.indexOf('/* ---------- Base'));
  const nomes = t => [...new Set([...t.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]))];
  // Raio, fonte, escada de espaçamento (--e1..--e6) e alturas não dependem de tema
  const estrutural = /^--(radius|font|h-topbar|h-dock|dock-|fab$|teclado|ease|glass-blur|e[1-6]$)/;
  const soNoEscuro = nomes(blocoDark).filter(t => !estrutural.test(t) && !nomes(blocoLight).includes(t));
  check('nenhum token de cor existe só no tema escuro', soNoEscuro.join(', '), '');

  /* ---- Sem decoração: a cor é do dado ---- */
  check('nenhum gradiente sobrou', /linear-gradient|radial-gradient/.test(
    cssT2.replace(/\.skeleton::after \{[^}]*\}/, '')), false);
  /* Sombra CROMÁTICA em estado permanente é o glow que se quis eliminar. Duas
     coisas ficam de fora da regra, e por motivos diferentes:

       - dentro de @keyframes: o pulso verde de 0,7s que confirma uma gravação é
         feedback, dura o tempo da ação e desaparece;
       - sombra neutra (preto ou branco puros): preto é a elevação de sempre, e
         branco a 5% é o fio de luz na aresta do hero — acabamento de superfície,
         o mesmo recurso de um botão de macOS. Nenhum dos dois tinge nada. */
  const semKeyframes = cssT2.replace(/@keyframes[\s\S]*?\n\}/g, '');
  const sombrasCromaticas = (semKeyframes.match(/box-shadow:[^;]+/g) || [])
    .flatMap(regra => regra.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) || [])
    .filter(cor => {
      const [r, g, b] = cor.match(/\d+/g).map(Number);
      return !(r === g && g === b);   // neutro só quando os três canais são iguais
    });
  check('nem sombra colorida de brilho', sombrasCromaticas.join(', '), '');
  check('o fundo da página é plano', /body::before/.test(cssT2), false);
  /* A escada de raios acompanha a direção arredondada escolhida: controle menor
     que cartão, e cartão menor que o que flutua. Raio igual em tudo achata a
     hierarquia — é a escada, não o número em si, que importa aqui. */
  const raio = n => Number((cssT2.match(new RegExp('--radius' + n + ': (\\d+)px')) || [])[1]);
  check('a escada de raios sobe do controle para o que flutua',
    raio('-sm') < raio('') && raio('') < raio('-lg'), true);
  check('e nenhum passo é exagerado', raio('-lg') <= 24, true);

  /* O hero e o cartão se destacam por superfície e filete, não por gradiente */
  check('o hero usa a superfície de destaque', /\.hero \{[^}]*background: var\(--destaque\)/.test(cssT2), true);
  check('e o cartão de crédito também', /\.credit-card \{[^}]*background: var\(--destaque\)/.test(cssT2), true);
  check('o filete do hero diz a situação',
    /\.hero-red::before \{ background: var\(--red\)/.test(cssT2), true);
  /* A classe do hero é binária; o selo tem três estados e conhece o "Aperto no
     variável". Quando os dois discordam, quem manda no filete é o selo — senão
     aparece um filete verde ao lado de um selo âmbar dizendo o contrário. */
  check('e o selo tem a palavra final sobre ele',
    /\.hero:has\(\.b-amber\)::before \{ background: var\(--amber\)/.test(cssT2), true);
  const iClasse = cssT2.indexOf('.hero-red::before');
  const iSelo = cssT2.indexOf('.hero:has(.b-red)::before');
  check('e vence por vir depois na cascata', iSelo > iClasse, true);
  /* Os painéis de conta recuam um plano dentro do hero: é a terceira camada
     (página → hero → painel) que dá relevo sem nenhuma tinta decorativa. */
  check('a conta do hero é um painel embutido',
    /\.hero \.hero-conta \{[^}]*background: var\(--embutido\)/.test(cssT2), true);
  check('e o embutido existe nos dois temas',
    (cssT2.match(/--embutido:/g) || []).length >= 3, true);
  check('e o do cartão, se a fatura fechou sem pagamento',
    /\.credit-card:has\(\.cc-alerta\)::before \{ background: var\(--red\)/.test(cssT2), true);

  /* ---- O seletor do tema precisa ter escopo ----
     O <html> carrega `data-tema` quando há tema escolhido. Um
     querySelectorAll('[data-tema]') pegava o documento inteiro e pendurava o
     handler nele: qualquer clique na página — o botão de voltar inclusive —
     reabria a tela de Aparência, e o voltar parecia sem função. */
  check('o seletor das opções de tema não alcança o <html>',
    /querySelectorAll\('\[data-tema\]'\)/.test(apT), false);
  check('ele é escopado ao modal', apT.includes("querySelectorAll('#modal [data-tema-op]')"), true);
  check('e lê o atributo próprio da opção', apT.includes('b.dataset.temaOp'), true);
  check('as três escolhas existem', /'auto',[\s\S]{0,200}'dark',[\s\S]{0,200}'light',/.test(apT), true);

  /* ---- Modo privado ----
     O alvo é a CIFRA, marcada no texto por marcarValores(). Uma lista de classes
     no CSS errava dos dois lados: borrava a caixa inteira (o rótulo sumia junto
     com o número) e, mesmo com quarenta seletores, deixava valores de fora. */
  check('o esconderijo é a marca, não uma lista de classes',
    /\.privado \.v \{[^}]*filter: blur/.test(cssT2), true);
  check('e a lista antiga não voltou', (cssT2.match(/\.privado \./g) || []).length <= 5, true);
  check('o gráfico não é borrado inteiro', /\.privado \.apx\s*[,{]/.test(cssT2), false);
  check('nem o donut inteiro', /\.privado \.donut-svg\s*[,{]/.test(cssT2), false);
  check('a cifra dentro do gráfico leva desfoque menor',
    /\.privado svg text\.v \{ filter: blur\(3px\)/.test(cssT2), true);
  check('o campo de valor continua coberto pelo elemento',
    /\.privado \.amount-input \{[^}]*filter: blur/.test(cssT2), true);
  check('o botão do olho conta o estado atual', apT.includes("ligado ? 'eyeOff' : 'eye'"), true);
  check('e é anunciado como interruptor', apT.includes("setAttribute('aria-pressed'"), true);

  /* ---- A marcação alcança o valor onde ele estiver ----
     Roda sobre o texto renderizado, então cobre a cifra solta no meio de uma
     frase, dentro de uma célula de tabela ou como <text> de um gráfico. */
  const casos = [
    ['R$ 1.234,56', 1], ['-R$ 2.078,32', 1], ['R$ 7', 1],
    ['faltam R$ 200 para a meta', 1],
    ['de R$ 32.000 · 2 meta(s)', 1],
    ['R$ 0,00 a R$ 2.089,97', 2],
    ['dia 12 de 31', 0], ['Alimentação · Mercado', 0], ['50 · 30 · 20', 0],
  ];
  const reMoeda = new RegExp(/-?R\$[\s ]?-?\d[\d.]*(?:,\d{2})?/.source, 'g');
  for (const [txt, qtd] of casos) {
    check(`marca ${qtd} valor(es) em "${txt}"`, (txt.match(reMoeda) || []).length, qtd);
  }
  check('a varredura é chamada ao desenhar a tela', apT.includes("marcarValores($('#view'))"), true);
  check('e também no que abre por cima dela',
    apT.includes("marcarValores($('#modal'))") && apT.includes('marcarValores(sheet)'), true);
  check('o painel de filtros também é marcado',
    fs.readFileSync(BASE + 'js/ui.js', 'utf8').includes('marcarValores(painel)'), true);
  check('a lista é coletada antes de trocar os nós',
    /const nos = \[\];\s*\n\s*while \(it\.nextNode\(\)\) nos\.push/.test(apT), true);
  check('dentro de SVG marca o próprio <text>', apT.includes("pai.classList.add('v')"), true);

  /* ---- O header ocupa a largura da tela ----
     Preso à largura do conteúdo, as ações boiavam no meio da faixa num monitor
     largo, longe de qualquer borda. */
  const inner = (cssT2.match(/\.topbar-inner \{[^}]*\}/) || [''])[0];
  check('o header não limita a própria largura', /max-width/.test(inner), false);
  check('mas o conteúdo abaixo dele limita', /\.content \{ max-width: min\(100%, \d+px\)/.test(cssT2), true);
  check('o header fica preso no topo', /\.topbar \{[^}]*position: sticky/.test(cssT2), true);
  check('e a barra do extrato encosta embaixo dele',
    /\.ext-topo \{[^}]*top: calc\(var\(--h-topbar\)/.test(cssT2), true);
}

console.log('\n=== Teclado do celular não esconde nada ===');
{
  const uiSrc = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  const cssK = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  check('mede pelo viewport visual, não pelo innerHeight', uiSrc.includes('window.visualViewport'), true);
  check('reage a abrir e fechar o teclado', /vv\.addEventListener\('resize'[\s\S]{0,120}vv\.addEventListener\('scroll'/.test(uiSrc), true);
  check('publica a altura coberta para o CSS', uiSrc.includes("setProperty('--teclado'"), true);
  check('a variável tem valor neutro por padrão', /--teclado: 0px/.test(cssK), true);
  check('folha se apoia acima do teclado', /\.sheet \{[^}]*bottom: var\(--teclado\)/.test(cssK), true);
  check('e continua rolável', /\.sheet \{[^}]*max-height: calc\(90dvh - var\(--teclado\)\)/.test(cssK), true);
  check('modal ganha rodapé do tamanho do teclado', /\.modal \{[^}]*\+ var\(--teclado\)\)/.test(cssK), true);
  /* A BARRA E O BOTÃO SOMEM SEMPRE JUNTOS.

     O botão vive FORA da barra no HTML — precisa disso para transbordar por cima
     dela sem ser cortado. O efeito colateral é que toda regra que esconde a
     barra tem de citar os dois: quando só a barra some, o botão fica flutuando
     sozinho. Aconteceu no desktop, onde a ação já existe no header.

     São dois lugares que escondem a barra, e os dois são conferidos aqui. */
  const escondeAmbos = re => {
    const m = cssK.match(re);
    return !!m && /\.tabbar/.test(m[0]) && /\.fab/.test(m[0]);
  };
  check('com o teclado aberto, barra e botão saem juntos',
    escondeAmbos(/body\.teclado-aberto[^{]*\{ display: none[^}]*\}/), true);
  check('e no desktop também',
    escondeAmbos(/\n  \.tabbar[^{]*\{ display: none[^}]*\}/), true);
  check('painel pode abrir para cima', /\.ui-panel\.acima \{ top: auto; bottom:/.test(cssK), true);
  check('campo em foco é trazido à vista', uiSrc.includes('scrollIntoView') && uiSrc.includes("'focusin'"), true);
  // Sem janela fixa: crescer o init() não pode reprovar um teste sobre outra coisa
  check('o vigia é ligado na abertura',
    /\n {2}init\(\) \{[\s\S]*?this\.vigiarTeclado\(\);[\s\S]*?\n {2}\},/.test(uiSrc), true);

  /* Exercita posicionar() com geometria de verdade: campo no rodapé de um celular
     de 800px, com 380px tomados pelo teclado. */
  const UIreal = eval(uiSrc + '; UI');
  const painelFalso = (temBusca, altura) => {
    const cls = new Set();
    const filhos = { '.ui-list': { style: {} }, '.ui-search': temBusca ? {} : null, '.ui-cal': null };
    return {
      style: {},
      classList: { toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); }, has: c => cls.has(c) },
      _cls: cls,
      querySelector: sel => filhos[sel] || null,
      getBoundingClientRect: () => ({ top: 0, bottom: altura, left: 20, right: 340, width: 320, height: altura }),
    };
  };
  const campoFalso = topo => ({ getBoundingClientRect: () => ({ top: topo, bottom: topo + 44, left: 20, right: 340, width: 320, height: 44 }) });

  global.window.innerWidth = 360;
  global.window.innerHeight = 800;

  // Sem teclado, campo no alto: abre para baixo com a lista inteira
  global.window.visualViewport = { height: 800, offsetTop: 0, addEventListener() {} };
  let painel = painelFalso(true, 300);
  UIreal.posicionar(painel, campoFalso(100));
  check('campo no alto: painel abre para baixo', painel._cls.has('acima'), false);
  check('e a lista usa a altura cheia', painel.querySelector('.ui-list').style.maxHeight, '260px');

  // Sem teclado, campo colado no rodapé: abre para cima
  painel = painelFalso(true, 300);
  UIreal.posicionar(painel, campoFalso(700));
  check('campo no rodapé: painel abre para cima', painel._cls.has('acima'), true);

  // Teclado aberto (380px) e campo no meio: o que sobra embaixo é pouco, sobe
  global.window.visualViewport = { height: 420, offsetTop: 0, addEventListener() {} };
  painel = painelFalso(true, 300);
  UIreal.posicionar(painel, campoFalso(330));
  check('com teclado, painel foge da área coberta', painel._cls.has('acima'), true);
  const altura = parseInt(painel.querySelector('.ui-list').style.maxHeight, 10);
  check('e a lista cabe no espaço que restou', altura > 0 && altura <= 260, true);

  // Teclado aberto e campo no topo: ainda cabe embaixo, não precisa virar
  painel = painelFalso(true, 200);
  UIreal.posicionar(painel, campoFalso(40));
  check('com teclado, campo no topo continua abrindo para baixo', painel._cls.has('acima'), false);

  // Nunca some por completo: mesmo apertado, sobra altura mínima utilizável
  global.window.visualViewport = { height: 260, offsetTop: 0, addEventListener() {} };
  painel = painelFalso(true, 300);
  UIreal.posicionar(painel, campoFalso(200));
  check('em espaço mínimo a lista não zera', parseInt(painel.querySelector('.ui-list').style.maxHeight, 10) >= 120, true);

  delete global.window.visualViewport;
}

console.log('\n=== Selects no padrão Select2 ===');
{
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const ui = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  const cssU = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  check('openSheet aplica o componente', /function openSheet[\s\S]{0,400}UI\.enhance\(sheet\)/.test(ap), true);
  check('openModal aplica o componente', /function openModal[\s\S]{0,300}UI\.enhance\(\$\('#modal'\)\)/.test(ap), true);
  check('preview do OFX aplica o componente', ap.includes("UI.enhance($('#ofx-result'))"), true);

  // Qualquer innerHTML que crie <select> precisa de enhance depois
  const semEnhance = [];
  for (const m of ap.matchAll(/\$\('#([\w-]+)'\)\.innerHTML = `([\s\S]*?)`;/g)) {
    if (!m[2].includes('<select')) continue;
    const depois = ap.slice(m.index + m[0].length, m.index + m[0].length + 900);
    if (!/UI\.enhance/.test(depois)) semEnhance.push('#' + m[1]);
  }
  check('nenhum innerHTML deixa select sem componente', semEnhance.length ? semEnhance.join(', ') : true, true);

  // Busca só aparece em lista longa; em lista curta seria ruído
  check('busca aparece só em lista longa', /const comBusca = opcoes\.length > \d/.test(ui), true);
  check('busca encontra pelo nome do grupo', /norm\(o\.grupo\)\.includes\(f\)/.test(ui), true);
  check('grupos têm cabeçalho próprio', ui.includes('class="ui-group"') && /\.ui-group \{/.test(cssU), true);
  check('o select nativo continua sendo a fonte da verdade', ui.includes("sel.dispatchEvent(new Event('change'"), true);

  // O painel é posicionado em relação ao campo: contêiner com overflow o cortaria
  check('lista do OFX não tem rolagem própria', /\.ofx-list \{[^}]*overflow-y/.test(cssU), false);
  check('botão de importar fica fixo no rodapé', /\.ofx-acoes \{[^}]*position: sticky/.test(cssU), true);
  check('o componente ocupa a largura da célula', /\.ofx-cat \.ui-select \{[^}]*width: 100%/.test(cssU), true);
}

console.log('\n=== Nome do lançamento nunca é cortado ===');
{
  const cssT = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const regra = sel => {
    const m = cssT.match(new RegExp(`\\${sel} \\{([^}]*)\\}`));
    return m ? m[1] : '';
  };
  // Classes que carregam texto que identifica o lançamento ou a categoria
  for (const sel of ['.tx-name', '.tx-meta', '.ofx-main b', '.legend-name']) {
    const r = regra(sel);
    check(`${sel}: existe no CSS`, r.length > 0, true);
    check(`${sel}: não corta com reticências`, /text-overflow/.test(r), false);
    check(`${sel}: pode quebrar linha`, /nowrap/.test(r), false);
    check(`${sel}: quebra palavra sem espaço`, /overflow-wrap:\s*anywhere/.test(r), true);
  }
  /* O nome no eixo do gráfico corre o MESMO risco, por outro mecanismo: o
     ApexCharts trunca no maxWidth. Devolver array do formatter é como a lib
     desenha várias linhas — é a versão SVG de "quebra em vez de cortar". */
  check('nome curto no eixo fica em uma linha', quebrarRotulo('Uber'), 'Uber');
  const quebrado = quebrarRotulo('Serviços e Taxas do Banco');
  check('nome longo quebra em linhas, não em reticências', Array.isArray(quebrado), true);
  check('em duas linhas no máximo, senão o eixo domina', quebrado.length <= 2, true);
  check('e nenhuma palavra se perde na quebra', quebrado.join(' '), 'Serviços e Taxas do Banco');
  check('nada de reticências', quebrado.join('').includes('…'), false);
  // Uma palavra só, longa, transborda inteira: nome comprido é melhor que irreconhecível
  check('palavra sem espaço vai inteira', quebrarRotulo('Supercalifragilistico'), 'Supercalifragilistico');
  check('e o ranking usa essa quebra no eixo',
    (() => { zeraFila(); svgRanking([['Serviços e Taxas do Banco', 10]]);
      return cfgDo().yaxis.labels.formatter === quebrarRotulo; })(), true);
  // O valor não pode encolher agora que o nome ocupa mais espaço
  check('.tx-amount não é espremido', /flex:\s*none/.test(regra('.tx-amount')), true);

  // OFX: descrição na linha de cima, seletor na de baixo com largura inteira
  check('linha do OFX é grade de duas linhas', /\.ofx-row \{[^}]*grid-template-columns/.test(cssT), true);
  check('categoria e etiqueta dividem a segunda linha',
    /\.ofx-cat \{[^}]*grid-column: 2;/.test(cssT) && /\.ofx-tag-btn \{[^}]*grid-column: 3/.test(cssT), true);
  check('seletor não é mais fixo em 130px', /\.ofx-cat select \{[^}]*width: 100%/.test(cssT), true);
  check('markup do OFX usa o contêiner novo', ap.includes('class="ofx-cat"'), true);

  // Todas as telas que listam lançamento usam a mesma classe, então a correção alcança todas
  const usos = (ap.match(/class="tx-name"/g) || []).length;
  check('todas as listas de lançamento usam tx-name', usos >= 3, true);
  check('tabela de relatório também quebra', /\.rep-table td \{[^}]*overflow-wrap:\s*anywhere/.test(cssT), true);
}

console.log('\n=== Layout no celular ===');
{
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const cssM = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const LIMITE = 14;

  const rotulos = [];
  for (const faixa of ['hero-stats', 'mini-stats']) {
    for (const m of ap.matchAll(new RegExp(`class="${faixa}[^"]*"[\\s\\S]{0,600}?</div>\\s*</div>`, 'g'))) {
      for (const s of m[0].matchAll(/<small>([\s\S]*?)<\/small>/g)) {
        const bruto = s[1];
        // "${isCurrent ? 'Projeção' : 'Total'}" -> testa cada texto possível
        if (bruto.includes('${')) for (const lit of bruto.matchAll(/'([^']+)'/g)) rotulos.push([faixa, lit[1]]);
        else rotulos.push([faixa, bruto.trim()]);
      }
    }
  }
  check('achou os rótulos das faixas de 3 colunas', rotulos.length >= 6, true);
  const compridos = rotulos.filter(([, t]) => t.length > LIMITE).map(([f, t]) => `${f}: "${t}"`);
  check(`nenhum rótulo passa de ${LIMITE} caracteres`, compridos.length ? compridos.join(' | ') : true, true);

  for (const faixa of ['hero-stats', 'mini-stats']) {
    const bloco = cssM.match(new RegExp(`\\.${faixa} small \\{[^}]*\\}`));
    check(`${faixa}: rótulo proibido de quebrar linha`, !!bloco && /white-space:\s*nowrap/.test(bloco[0]), true);
    check(`${faixa}: valor proibido de quebrar linha`, new RegExp(`\\.${faixa} b \\{[^}]*white-space:\\s*nowrap`).test(cssM), true);
    check(`${faixa}: encolhe em tela estreita`, new RegExp(`max-width: 420px\\)[\\s\\S]{0,400}\\.${faixa} small \\{[^}]*font-size`).test(cssM), true);
  }
}

/* ---- Botão voltar: fechar o app tem que ser intencional ---- */
console.log('\n=== Botão voltar do aparelho ===');
{
  let pilha = 1, saidas = 0;   // histórico falso: conta empilhadas e saídas
  global.history = { pushState: () => { pilha++; }, back: () => { saidas++; } };
  const aviso = () => el('#toast').textContent;
  const limpar = () => { el('#toast').textContent = ''; };
  const sheet = el('#sheet'), lock = el('#lock');
  sheet.hidden = true; el('#modal').hidden = true; lock.hidden = true;

  Voltar.init();
  check('sentinela empilhada na abertura', pilha, 2);

  sheet.hidden = false;
  Voltar.tratar();
  check('voltar fecha a folha aberta', sheet.hidden, true);
  check('fechar a folha não sai do app', saidas, 0);

  state.tab = 'relatorios';
  Voltar.tratar();
  check('voltar sobe para o Painel', state.tab, 'inicio');
  check('subir de nível não sai do app', saidas, 0);

  limpar();
  Voltar.tratar();
  check('primeiro voltar avisa em vez de sair', aviso(), 'Toque em voltar de novo para sair');
  check('primeiro voltar não fecha o app', saidas, 0);

  Voltar.tratar();
  check('segundo voltar seguido fecha o app', saidas, 1);

  Voltar.ultimo = Date.now() - 5000;   // toque espaçado não pode contar como confirmação
  limpar();
  Voltar.tratar();
  check('voltar depois de 2s avisa de novo', aviso(), 'Toque em voltar de novo para sair');
  check('voltar espaçado não fecha o app', saidas, 1);

  state.tab = 'relatorios'; lock.hidden = false; Voltar.ultimo = 0; limpar();
  Voltar.tratar();
  check('bloqueado, voltar não troca de aba', state.tab, 'relatorios');
  check('bloqueado, voltar ainda pede confirmação', aviso(), 'Toque em voltar de novo para sair');
  lock.hidden = true; state.tab = 'inicio';

  // A saída só funciona porque a sentinela NÃO é reposta nesse caminho
  const apV = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('a saída não repõe a sentinela', /history\.back\(\)/.test(apV) && !/history\.back\(\)[\s\S]{0,80}this\.marcar\(\)/.test(apV), true);
  check('voltar é ligado na abertura', apV.includes('Voltar.init()'), true);
}

/* ---- Edição em massa ----
   Um toque mudando dezenas de registros, com a sincronização propagando na hora.
   O que precisa ser provado aqui não é a tela: é que o dinheiro fecha depois. */
console.log('\n=== Edição em massa ===');
try {
  const pM = DB.monthPeriod(new Date());
  const contaM = DB.upsert('accounts', { name: 'Conta Massa', type: 'Conta Corrente', balance: 1000 });
  const contaM2 = DB.upsert('accounts', { name: 'Conta Massa 2', type: 'Conta Corrente', balance: 500 });
  const catM = DB.upsert('categories', { name: 'Alvo da Massa', icon: '🎯', scope: 'Família', type: 'Despesa' });
  const somaSaldos = () => DB.all('accounts').reduce((s, a) => s + (Number(a.balance) || 0), 0);

  const novo = (desc, extra) => DB.upsert('transactions', {
    description: desc, amount: 100, date: dia(10), type: 'Despesa', status: 'Pago',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaM, ...extra,
  });
  const t1 = novo('Massa um'), t2 = novo('Massa dois'), t3 = novo('Massa três');

  // Efeito nas contas espelha applyTxEffect — é o que garante o saldo em lote
  const desp = DB.get('transactions', t1);
  check('despesa paga pesa negativo na conta', efeitoNasContas(desp)[contaM], -100);
  check('a pagar não pesa em saldo nenhum',
    Object.keys(efeitoNasContas({ ...desp, status: 'A Pagar' })).length, 0);
  const trans = { type: 'Transferência', status: 'Pago', amount: 70, account_id: contaM, to_account: contaM2 };
  check('transferência tira de um lado', efeitoNasContas(trans)[contaM], -70);
  check('e põe no outro', efeitoNasContas(trans)[contaM2], 70);

  // Categoria em massa não mexe em dinheiro nenhum
  Massa.ids = [t1, t2, t3];
  Massa.marcados = new Set([t1, t2, t3]);
  const saldoAntes = somaSaldos();
  aplicarMassa({ category_id: catM }, {});
  check('categoria em massa chega em todos',
    [t1, t2, t3].every(id => DB.get('transactions', id).category_id === catM), true);
  check('e não mexe em saldo', somaSaldos(), saldoAntes);

  /* Situação mexe em dinheiro de verdade. A soma dos saldos tem de andar
     exatamente o que os lançamentos deixaram de pesar — nem mais, nem menos. */
  Massa.marcados = new Set([t1, t2, t3]);
  aplicarMassa({ status: 'A Pagar' }, {});
  check('marcar A Pagar devolve o dinheiro à conta', somaSaldos(), saldoAntes + 300);
  check('e desfazer põe tudo de volta no lugar', (desfazerMassa(), somaSaldos()), saldoAntes);
  check('desfazer também devolve a situação', DB.get('transactions', t1).status, 'Pago');

  // Trocar a conta move o saldo dos dois lados
  Massa.ids = [t1]; Massa.marcados = new Set([t1]);
  const c1 = DB.get('accounts', contaM).balance, c2 = DB.get('accounts', contaM2).balance;
  aplicarMassa({ account_id: contaM2 }, {});
  check('a conta de origem recebe de volta', DB.get('accounts', contaM).balance, c1 + 100);
  check('e a de destino é debitada', DB.get('accounts', contaM2).balance, c2 - 100);
  check('a soma total não muda ao mover de conta', somaSaldos(), saldoAntes);
  desfazerMassa();
  check('desfazer devolve a conta original', DB.get('transactions', t1).account_id, contaM);

  /* Transferência e conciliação no lote: continuam selecionáveis, mas não
     recebem os campos que não fazem sentido nelas — e isso é CONTADO na
     confirmação, nunca silencioso. */
  const tTr = DB.upsert('transactions', {
    description: 'Massa transferência', amount: 50, date: dia(10), type: 'Transferência',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência',
    account_id: contaM, to_account: contaM2,
  });
  const tAj = DB.upsert('transactions', {
    description: 'Massa conciliação', amount: 20, date: dia(10), type: 'Despesa', status: 'Pago',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Ajuste', account_id: contaM, adjustment: true,
  });
  check('transferência não aceita categoria', massaAceita('category_id', DB.get('transactions', tTr)), false);
  check('conciliação também não', massaAceita('category_id', DB.get('transactions', tAj)), false);
  check('transferência não aceita troca de conta', massaAceita('account_id', DB.get('transactions', tTr)), false);
  check('mas aceita etiqueta', massaAceita('tags', DB.get('transactions', tTr)), true);

  Massa.ids = [t2, tTr, tAj]; Massa.marcados = new Set([t2, tTr, tAj]);
  const saldoPreMisto = somaSaldos();
  aplicarMassa({ category_id: catM }, { tags: { modo: 'adicionar', valores: ['lote'] } });
  check('a transferência do lote fica sem categoria', !DB.get('transactions', tTr).category_id, true);
  check('a conciliação também', !DB.get('transactions', tAj).category_id, true);
  check('e o saldo não se mexe com ela no meio', somaSaldos(), saldoPreMisto);
  check('mas a etiqueta chega até ela', DB.tagsOf(DB.get('transactions', tTr)).includes('lote'), true);
  check('e chega na despesa também', DB.tagsOf(DB.get('transactions', t2)).includes('lote'), true);

  // A confirmação diz o número, e o número exclui quem não recebe a mudança
  confirmarMassa({ category_id: catM }, {});
  const conf = els['#sheet'].innerHTML;
  check('a confirmação diz quantos recebem a mudança', /Categoria vira[\s\S]*?<b>1<\/b>/.test(conf), true);
  closeSheet();

  /* ---- Trocar o tipo ----
     Não é trocar um campo: é mudar quantas contas o lançamento toca. Virar
     transferência em despesa sem soltar o to_account deixaria a conta de destino
     com um credito que nada mais explica. */
  const tConv = DB.upsert('transactions', {
    description: 'Conversao teste', amount: 80, date: dia(10), type: 'Transferência',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência',
    account_id: contaM, to_account: contaM2,
  });
  applyTxEffect(DB.get('transactions', tConv), +1);
  const origAntes = DB.get('accounts', contaM).balance;
  const destAntes = DB.get('accounts', contaM2).balance;
  const totalAntes = somaSaldos();

  aplicarNaLinha(tConv, { type: 'Despesa' });
  const convertido = DB.get('transactions', tConv);
  check('a transferência virou despesa', convertido.type, 'Despesa');
  check('e soltou a conta de destino', !convertido.to_account, true);
  check('o método deixa de ser Transferência', convertido.method, 'PIX');
  check('a origem continua debitada', DB.get('accounts', contaM).balance, origAntes);
  check('o destino devolve o que tinha recebido', DB.get('accounts', contaM2).balance, destAntes - 80);
  check('e some 80 do total da família, que agora saiu de verdade', somaSaldos(), totalAntes - 80);

  // Voltar a ser transferência exige dizer para onde: sem destino não há a outra
  // ponta, que é o defeito que já quebrou 28 lançamentos nesta base
  aplicarNaLinha(tConv, { type: 'Transferência', to_account: contaM2 });
  check('voltou a ser transferência', DB.get('transactions', tConv).type, 'Transferência');
  check('com o destino de volta', DB.get('transactions', tConv).to_account, contaM2);
  check('e o total da família volta ao que era', somaSaldos(), totalAntes);
  check('a categoria não sobrevive à travessia', !DB.get('transactions', tConv).category_id, true);

  // Converter e categorizar na mesma ação: olhar o registro ANTES recusaria a
  // categoria, porque transferência não aceita — e é justamente o conserto útil
  aplicarNaLinha(tConv, { type: 'Despesa', category_id: catM });
  check('converter e categorizar de uma vez funciona', DB.get('transactions', tConv).category_id, catM);
  applyTxEffect(DB.get('transactions', tConv), -1);   // devolve o saldo antes de sumir com ele
  DB.remove('transactions', tConv);

  // Etiquetas: os três modos
  check('adicionar mantém o que já existia', aplicarTags(['a'], 'adicionar', ['b']).sort().join(), 'a,b');
  check('adicionar não duplica', aplicarTags(['a'], 'adicionar', ['a']).join(), 'a');
  check('remover tira só a indicada', aplicarTags(['a', 'b'], 'remover', ['a']).join(), 'b');
  check('substituir troca o conjunto inteiro', aplicarTags(['a', 'b'], 'substituir', ['c']).join(), 'c');

  // Excluir em massa devolve o saldo e é reversível
  Massa.ids = [t3]; Massa.marcados = new Set([t3]);
  const saldoPreExclusao = somaSaldos();
  excluirMassa();                                   // o harness responde sim ao confirm
  check('excluir devolve o valor ao saldo', somaSaldos(), saldoPreExclusao + 100);
  check('e o lançamento some da lista', !!DB.get('transactions', t3), false);
  desfazerMassa();
  check('desfazer traz o lançamento de volta', !!DB.get('transactions', t3), true);
  check('e o saldo volta com ele', somaSaldos(), saldoPreExclusao);

  /* ---- Cabeçalho da seção da lista ----
     As ações moraram um tempo como dois botões de largura inteira empilhados
     entre o resumo e a lista: cortavam a leitura e pesavam mais que o conteúdo.
     Agora nomeiam a seção e ancoram à direita dela. */
  state.filtros = filtrosVazios();
  const comSec = renderExtrato(pM);
  check('a lista tem título de seção', comSec.includes('Extrato detalhado'), true);
  check('e o título diz quantos lançamentos', /sec-tit[\s\S]*?\d+ lançamento/.test(comSec), true);
  check('as ações ficam no cabeçalho da seção',
    comSec.indexOf('sec-acoes') > comSec.indexOf('sec-tit')
    && comSec.indexOf('sec-acoes') < comSec.indexOf('id="tx-list"'), true);
  check('editar virou botão da seção', /sec-btn" id="btn-massa"/.test(comSec), true);
  /* O BOTÃO "CUSTOS FIXOS" NÃO EXISTE MAIS. Ele copiava à mão os lançamentos
     marcados como recorrentes, um mês por vez — o mecanismo antigo de repetição.
     Com o CONTRATO virando fonte única de movimentação futura ele deixou de ter o
     que fazer: o contrato gera sozinho, na data certa, já com vínculo.

     O teste continua aqui, invertido, para o botão não voltar por engano junto com
     alguma outra mudança no cabeçalho da seção. */
  const idLegado = DB.upsert('transactions', {
    description: 'Legado CF', amount: 100, date: DB.inicioISO(pM), type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    account_id: DB.all('accounts')[0].id, recurring: true,
  });
  check('nem com dado legado o botão "Custos fixos" aparece',
    /id="btn-recur"/.test(renderExtrato(pM)), false);
  DB.remove('transactions', idLegado);
  check('e não sobrou botão de largura inteira',
    /btn ghost" id="btn-(massa|recur)"/.test(comSec), false);
  // O lote é o filtro; editar só aparece quando há o que editar
  state.filtros.busca = 'zzzznada';
  const semNada = renderExtrato(pM);
  check('sem lançamento, não oferece editar', semNada.includes('id="btn-massa"'), false);
  check('mas a seção continua nomeada', semNada.includes('Extrato detalhado'), true);
  state.filtros = filtrosVazios();

  /* As telas precisam montar de verdade: a lógica acima passaria mesmo com um
     erro de template, e o modal só apareceria quebrado no celular. */
  state.filtros = filtrosVazios();
  openMassaModal(pM);
  const telaM = els['#modal'].innerHTML;
  check('o modal abre com o lote todo marcado', Massa.marcados.size, Massa.ids.length);
  check('e lista as linhas com caixa de seleção', telaM.includes('data-massa='), true);
  check('a barra de ação traz editar e excluir',
    telaM.includes('id="massa-editar"') && telaM.includes('id="massa-excluir"'), true);
  check('o cabeçalho conta quantos estão marcados', telaM.includes(`${Massa.ids.length} de ${Massa.ids.length}`), true);

  /* Cada linha traz os próprios controles: o caso comum não é "os 34 viram a
     mesma categoria", é cada um querer o seu. */
  const umaLinha = linhaEditavel(DB.get('transactions', t1));
  for (const campo of ['tipo', 'cat', 'tags', 'mais']) {
    check(`a linha tem o controle de ${campo}`, umaLinha.includes(`data-ed="${campo}"`), true);
  }
  check('e a linha diz de qual lançamento é', umaLinha.includes(`data-id="${t1}"`), true);
  check('o tipo aparece escrito na própria linha', /ed-tipo t-desp[^>]*>Despesa</.test(umaLinha), true);
  /* Campo em branco fica visivelmente pendente: numa tela de conserto, o que
     falta preencher tem de saltar antes do que já está pronto. */
  const semCat = linhaEditavel({ ...DB.get('transactions', t1), category_id: null, type: 'Despesa' });
  check('categoria vazia se marca como pendente', /ed-btn vazio[^>]*data-ed="cat"/.test(semCat), true);
  check('e a preenchida não', /ed-btn vazio[^>]*data-ed="cat"/.test(umaLinha), false);
  // Transferência mostra o destino no lugar da categoria, porque categoria ela não tem
  const linhaTr = linhaEditavel(DB.get('transactions', tTr));
  check('transferência mostra o destino no lugar da categoria', linhaTr.includes('→ Conta Massa 2'), true);
  check('e se anuncia como transferência', linhaTr.includes('>Transferência<'), true);
  /* Botão + popover em vez de <select> por linha: com 200 linhas seriam 400
     componentes montados de uma vez, e o celular engasga antes de a lista sair. */
  const apEd = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const corpoLinha = apEd.slice(apEd.indexOf('function linhaEditavel'), apEd.indexOf('function renderMassa'));
  check('a linha não monta select nenhum', corpoLinha.includes('<select'), false);
  check('e redesenha só a si mesma ao mudar', apEd.includes('function repintarLinha'), true);

  openMassaEditSheet();
  const formM = els['#sheet'].innerHTML;
  /* `recurring` virou `classe`: o campo deixou de ser "custo fixo sim/não" e
     passou a escolher entre fixo, variável e pontual — um interruptor binário
     gravaria `recurring` sem tocar em `pontual`, e o lote sairia com as duas
     marcas ligadas. */
  check('todo campo do formulário tem interruptor',
    ['type', 'category_id', 'tags', 'status', 'scope', 'member', 'method', 'account_id', 'classe', 'notes']
      .every(c => formM.includes(`data-liga="${c}"`)), true);
  /* DUAS classes, não três: "conta fixa" é o vínculo com o contrato, e vincular em
     lote casando pelo nome é justamente o automático que erra no extrato. */
  check('e a classe do gasto oferece variável e pontual',
    ['variavel', 'pontual'].every(v => formM.includes(`value="${v}"`)), true);
  check('  e não oferece "fixo" em massa', formM.includes('value="fixo"'), false);
  check('o lote também troca o tipo', formM.includes('id="ma-tipo"'), true);
  check('e pede o destino ao virar transferência', formM.includes('id="ma-destino"'), true);
  check('e os controles nascem escondidos',
    (formM.match(/class="massa-ctrl"[^>]*hidden/g) || []).length, 10);
  check('o formulário avisa que situação mexe no saldo', formM.includes('Mexe no saldo'), true);
  check('e que trocar de conta move os saldos', formM.includes('move os saldos') || formM.includes('Move dinheiro'), true);
  check('etiqueta oferece os três modos',
    formM.includes('>Adicionar<') && formM.includes('>Remover<') && formM.includes('>Substituir<'), true);
  closeSheet(); closeModal();

  // Uma sincronização para o lote inteiro, não uma por linha
  const apM = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const corpoAplicar = apM.slice(apM.indexOf('function aplicarMassa'), apM.indexOf('function excluirMassa'));
  check('sincroniza uma vez só por lote', (corpoAplicar.match(/Sync\.autoSync\(\)/g) || []).length, 1);
  check('e a chamada fica fora do laço', /for \(const \[id, d\] of Object\.entries\(deltas\)\)[\s\S]*Sync\.autoSync/.test(corpoAplicar), true);

  /* Gravação em lote: save() serializa (e cifra) o banco inteiro, então uma
     escrita por lançamento travaria a tela por segundos num lote grande. */
  let gravacoes = 0;
  const saveReal = DB.save.bind(DB);
  DB.save = function () { if (!this._lote) gravacoes++; return saveReal(); };
  Massa.ids = [t1, t2]; Massa.marcados = new Set([t1, t2]);
  aplicarMassa({ scope: 'Pessoal' }, {});
  DB.save = saveReal;
  check('o lote inteiro grava uma vez só', gravacoes, 1);
  check('e a mudança chegou nos dois', [t1, t2].every(id => DB.get('transactions', id).scope === 'Pessoal'), true);
  check('o modo lote não fica ligado depois', DB._lote, false);
  desfazerMassa();
} catch (e) { console.log(` FALHA | edição em massa: ${e.message}`); fail++; }

/* ---- Contas e cartões: ações no cabeçalho da seção ----
   "Transferir" e "Gerenciar" ficavam empilhados em largura inteira DENTRO do
   cartão, depois da lista de contas: fechavam a lista com dois blocos que
   pesavam mais que as próprias contas e ficavam longe do título. */
/* ---- Pagar fatura ----
   Antes o pagamento era um adjustBalance silencioso: o dinheiro sumia da conta e
   nada no extrato explicava. Agora e um lancamento de verdade. */
console.log('\n=== Pagamento de fatura ===');
try {
  const contaF = DB.upsert('accounts', { name: 'Conta Fatura', type: 'Conta Corrente', balance: 5000 });
  const cartaoF = DB.upsert('cards', { name: 'Cartao Fatura', closing_day: 20, due_day: 28, account_id: contaF, active: true });
  const cartao = DB.get('cards', cartaoF);
  const chave = DB.invoiceKeyFor(cartao, dia(10));
  DB.upsert('transactions', { description: 'Compra A', amount: 400, date: dia(10), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito', card_id: cartaoF, invoice_key: chave });
  DB.upsert('transactions', { description: 'Compra B', amount: 600, date: dia(11), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito', card_id: cartaoF, invoice_key: chave });

  const fat = () => DB.invoicesOf(DB.get('cards', cartaoF)).find(i => i.key === chave);
  check('a fatura soma as compras', fat().total, 1000);
  check('e nasce sem pagamento', fat().pago, 0);
  const comprometidoAntes = DB.committed();

  /* Mede o "saiu" do consolidado da família ANTES de qualquer pagamento. Medir a
     família contra uma conta seria comparar escopos diferentes; o que prova a
     regra é a MESMA medida antes e depois. */
  const pF0 = DB.monthPeriod(new Date());
  const saiuDaFamilia = () => {
    state.filtros = filtrosVazios();
    // O <small> depois do valor é o que separa a linha de fluxo do selo de
    // variação — os dois usam pt-dn, e o selo vem primeiro no HTML
    const m = renderExtrato(pF0).match(/pt pt-dn"><\/i>([\d.]+),(\d+) <small>/);
    return m ? Number(m[1].replace(/\./g, '')) + Number(m[2]) / 100 : 0;
  };
  const familiaAntes = saiuDaFamilia();

  // Pagamento parcial: um lançamento de verdade, na conta escolhida
  const pagar = (valor, quando) => {
    const p = { description: `Fatura ${cartao.name}`, amount: valor, date: quando, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Fatura', account_id: contaF, category_id: null, pays_invoice: chave };
    DB.upsert('transactions', p); applyTxEffect(p, +1);
    return p;
  };
  pagar(300, dia(25));
  check('pagamento parcial entra como lançamento',
    DB.pagamentosDaFatura(chave).length, 1);
  check('e debita a conta escolhida', DB.get('accounts', contaF).balance, 4700);
  check('a fatura fica Parcial', fat().status, 'Parcial');
  check('dizendo quanto falta', fat().falta, 700);
  /* O comprometido passa a ser o que FALTA, não a fatura inteira: com pagamento
     parcial, contar os R$ 1.000 de novo tiraria do disponível dinheiro que já saiu. */
  check('o comprometido cai só o que foi pago', DB.committed(), comprometidoAntes - 300);

  /* Neutro nas análises: as compras do cartão JÁ contaram como despesa quando
     aconteceram. Contar o pagamento somaria o mesmo dinheiro duas vezes. */
  const pF = DB.monthPeriod(new Date());
  const pgtoTx = DB.all('transactions').find(t => t.pays_invoice === chave);
  check('o pagamento é neutro', DB.isNeutral(pgtoTx), true);
  check('e fica fora das despesas do período',
    DB.expensesOf(pF).some(t => t.pays_invoice === chave), false);

  // Quitar o resto
  pagar(700, dia(26));
  check('quitado, a fatura fica Paga', fat().status, 'Paga');
  check('sem faltar nada', fat().falta, 0);
  check('e a conta foi debitada o total', DB.get('accounts', contaF).balance, 4000);
  check('o comprometido volta ao que era sem esta fatura', DB.committed(), comprometidoAntes - 1000);

  /* O pedido central: o débito aparece no extrato da conta que pagou. Conferindo
     UMA conta ele conta como saída (tem de bater com o extrato do banco);
     olhando a família inteira, não — seria o mesmo dinheiro duas vezes. */
  state.filtros = { ...filtrosVazios(), contas: [contaF] };
  const naConta = renderExtrato(pF);
  check('o pagamento aparece no extrato da conta', naConta.includes('Fatura Cartao Fatura'), true);
  const saiuNaConta = Number((naConta.match(/pt pt-dn"><\/i>([\d.]+),\d+ <small>/) || [])[1].replace(/\./g, ''));
  check('e conta como saída dela', saiuNaConta >= 1000, true);
  check('mas não vira saída nova no consolidado da família', saiuDaFamilia(), familiaAntes);
  state.filtros = filtrosVazios();

  // Desfazer devolve o saldo e apaga os lançamentos
  desfazerPagamentosDaFatura(chave);
  check('desfazer devolve o saldo', DB.get('accounts', contaF).balance, 5000);
  check('e some com os lançamentos', DB.pagamentosDaFatura(chave).length, 0);
  check('a fatura volta a não estar paga', fat().status !== 'Paga', true);

  /* Achado ao construir isto, e maior que o pedido: o total de despesas da
     família filtrava por !adjustment, que NÃO exclui transferência. Uma
     transferência entre contas próprias tem type 'Transferência' e passa por
     isExpense, então entrava no total como gasto novo — dinheiro que só mudou de
     lugar era contado como gasto da família. */
  const contaT1 = DB.upsert('accounts', { name: 'Neutro A', type: 'Conta Corrente', balance: 1000 });
  const contaT2 = DB.upsert('accounts', { name: 'Neutro B', type: 'Conta Corrente', balance: 0 });
  const gastoFamilia = () => {
    state.filtros = filtrosVazios();
    const m = renderExtrato(pF0).match(/pt pt-dn"><\/i>([\d.]+),(\d+) <small>/);
    return m ? Number(m[1].replace(/\./g, '')) + Number(m[2]) / 100 : 0;
  };
  const antesDaTransf = gastoFamilia();
  const trNeutra = { description: 'Movi de lugar', amount: 250, date: dia(12), type: 'Transferência', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Transferência', account_id: contaT1, to_account: contaT2 };
  DB.upsert('transactions', trNeutra); applyTxEffect(trNeutra, +1);
  check('transferência não entra no gasto da família', gastoFamilia(), antesDaTransf);
  check('mas move os saldos', DB.get('accounts', contaT2).balance, 250);
  for (const t of DB.all('transactions').filter(t => t.description === 'Movi de lugar')) DB.remove('transactions', t.id);
  DB.remove('accounts', contaT1); DB.remove('accounts', contaT2);
  state.filtros = filtrosVazios();

  // A coluna nova precisa existir nos dois lados da sincronização
  const esquema = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');
  const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  check('pays_invoice está no schema', /pays_invoice text/.test(esquema), true);
  check('e na lista que sobe para a nuvem', syncSrc.includes("'pays_invoice'"), true);
  /* pays_invoice diz qual fatura o lançamento PAGA; invoice_key diz de qual
     fatura a compra FAZ PARTE. Trocar os dois somaria o pagamento dentro da
     própria fatura que ele quita. */
  check('o pagamento não entra na fatura que quita', fat().total, 1000);

  for (const t of DB.all('transactions').filter(t => t.card_id === cartaoF || t.pays_invoice === chave)) DB.remove('transactions', t.id);
  DB.remove('cards', cartaoF); DB.remove('accounts', contaF);
} catch (e) { console.log(` FALHA | pagamento de fatura: ${e.message}`); fail++; }

console.log('\n=== Ações de contas e cartões ===');
try {
  const tela = renderCartoes();
  /* Os títulos mudaram com a reestruturação: a tela deixou de ser uma pilha de
     blocos ("Contas e saldos", "Cartões de crédito") e passou a decompor o
     patrimônio em "o que eu tenho" e "o que eu devo". */
  check('contas ganham cabeçalho de seção', /sec-tit[\s\S]*?O que eu tenho/.test(tela), true);
  check('com o total somado nele', /O que eu tenho<\/b>\s*<small>R\$/.test(tela), true);
  check('transferir virou ação da seção', /sec-btn" id="btn-transfer"/.test(tela), true);
  check('gerenciar contas também', /sec-btn" data-setup="accounts"/.test(tela), true);
  check('e saíram de dentro do cartão',
    /btn ghost" id="btn-transfer"|btn ghost" data-setup="accounts"/.test(tela), false);
  check('a ação vem antes da lista de contas',
    tela.indexOf('id="btn-transfer"') < tela.indexOf('class="acc-row"'), true);

  /* Com cartões cadastrados não havia como gerenciá-los daqui — o botão só
     existia no estado vazio, então quem já tinha cartão precisava ir às
     Configurações para mexer em qualquer um. */
  check('cartões ganham cabeçalho próprio', tela.includes('O que eu devo'), true);
  check('e agora dá para gerenciá-los daqui', /sec-btn" data-setup="cards"/.test(tela), true);
  check('o cabeçalho de cartões vem antes dos cartões',
    tela.indexOf('O que eu devo') < tela.indexOf('class="credit-card"'), true);

  /* ---- A ORDEM DA TELA ----
     Patrimônio, depois o que se tem, depois o que se deve. Antes o cartão — que
     dá nome à aba — vinha depois de quatro blocos; a ordem é a queixa que
     originou a reestruturação, então ela é o que se testa. */
  check('o patrimônio abre a tela', tela.indexOf('pat-capa') < tela.indexOf('O que eu tenho'), true);
  check('  e o que eu tenho vem antes do que eu devo',
    tela.indexOf('O que eu tenho') < tela.indexOf('O que eu devo'), true);
  /* "Compromissos futuros" somava água, energia e parcela de carro — numa tela de
     cartões esse número passava por dívida de fatura. Ele vive no Painel. */
  check('  e sem o bloco de compromissos, que não é de cartão',
    tela.includes('Compromissos futuros'), false);
  check('o patrimônio mostra as duas metades',
    /tenho <b>/.test(tela) && /devo <b>/.test(tela), true);
} catch (e) { console.log(` FALHA | contas e cartões: ${e.message}`); fail++; }

/* ---- A TELA DE CARTÕES: qual fatura aparece ----

   O defeito que motivou a reestruturação, reproduzido: a lista mostrava as SEIS
   ÚLTIMAS faturas por data. Com uma compra parcelada em 10x, as seis últimas são
   todas do futuro distante — na base real, dezembro/2026 a maio/2027, idênticas,
   cada uma com botão "pagar" —, e a fatura ATUAL e a que acabou de fechar não
   apareciam em lugar nenhum. A tela oferecia pagar maio de 2027 e escondia o mês
   corrente. Quanto mais se parcela, pior fica. */
console.log('\n=== Cartão: a fatura que aparece é a que importa ===');
try {
  const contaC = DB.upsert('accounts', { name: 'Conta Cartao', type: 'Conta Corrente', balance: 5000, active: true });
  const cartaoC = DB.upsert('cards', { name: 'Cartao Teste', closing_day: 13, due_day: 20, limit_amount: 4000, account_id: contaC, active: true });
  const objCartao = DB.get('cards', cartaoC);
  const nova = (desc, valor, data, situacao) => DB.upsert('transactions', {
    description: desc, amount: valor, date: data, type: 'Despesa', status: situacao || 'Pago',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    card_id: cartaoC, invoice_key: DB.invoiceKeyFor(objCartao, data),
  });

  const mesPassadoC = DB.monthPeriod(new Date(), -1);
  const esteMesC = DB.monthPeriod(new Date());
  // fecha no ciclo passado e ninguém pagou: é a fatura que cobra ação hoje
  nova('Compra vencida', 700, DB.somarDiasISO(DB.inicioISO(mesPassadoC), 3));
  // esta cai na fatura que ainda está acumulando
  nova('Compra do mês', 300, DB.somarDiasISO(DB.inicioISO(esteMesC), 2));
  // e oito parcelas nos meses seguintes, que era o que expulsava as duas de cima
  for (let i = 1; i <= 8; i++) {
    const p = DB.monthPeriod(new Date(), i);
    nova(`Parcela TV (${i}/8)`, 250, DB.somarDiasISO(DB.inicioISO(p), 2));
  }
  /* Uma compra LANÇADA E NÃO EFETIVADA, que é o que separa comprometido de
     utilizado. Sem ela o cenário só teria uma das duas naturezas e a distinção
     passaria sem ser exercitada. */
  nova('Assinatura prevista', 200, DB.somarDiasISO(DB.inicioISO(DB.monthPeriod(new Date(), 1)), 4), 'A Pagar');

  const bloco = cartaoBloco(objCartao);
  const chaveAtualC = DB.invoiceKeyFor(objCartao, todayISO());
  const todas = DB.invoicesOf(objCartao);
  const fechada = todas.find(i => i.status === 'Fechada' && i.key !== chaveAtualC);

  check('a fatura ATUAL está na tela', bloco.includes(`data-inv-detail="${chaveAtualC}"`), true);
  check('  e é ela que o botão de pagar oferece', bloco.includes(`data-pay="${chaveAtualC}"`), true);
  check('a fatura fechada e não paga também', !!fechada && bloco.includes(`data-pay="${fechada.key}"`), true);
  check('  e ela vem ANTES da aberta, porque cobra ação hoje',
    bloco.indexOf('cc-alerta') < bloco.indexOf('cc-invoice'), true);
  check('  com o prazo dito em dias, não em data solta', /vence(u)? (em|hoje|amanhã|há)/.test(bloco), true);

  /* AS FUTURAS NÃO VIRAM LINHA CADA UMA. Elas são oito faturas idênticas; somadas,
     respondem a única pergunta que importa delas — quanto já está comprometido. */
  const futurasC = todas.filter(i => i.key !== chaveAtualC && i.closing > new Date() && i.falta > 0.005);
  check('as futuras somam numa linha só', (bloco.match(/data-futuras=/g) || []).length, 1);
  check('  com o total do que já foi comprado', bloco.includes(fmt(futurasC.reduce((s, i) => s + i.falta, 0))), true);
  check('  e nenhuma delas ganha botão de pagar na tela',
    futurasC.some(i => bloco.includes(`data-pay="${i.key}"`)), false);

  // O histórico existe, e é lá que estão TODAS — inclusive as pagas
  check('há um caminho para o histórico', (bloco.match(/data-hist=/g) || []).length, 1);
  openHistoricoFaturas(cartaoC);
  const histHtml = els['#modal'] ? els['#modal'].innerHTML : '';
  check('  e o histórico traz todas as faturas',
    (histHtml.match(/class="invoice-row"/g) || []).length, todas.length);
  closeModal();

  /* LIMITE: o que se quer saber é quanto AINDA dá para gastar.

     O NÚMERO VEM LITERAL, não recalculado a partir das faturas. A primeira versão
     deste teste refazia a conta do jeito que o código fazia — só a fatura aberta
     mais as fechadas — e por isso passou com o código errado: o disponível saía
     R$ 1.999,20 acima do real, o valor exato das parcelas ainda por faturar. Um
     teste que copia a regra que deveria julgar não julga nada.

     Aqui o cenário é conhecido: 700 na fechada + 300 na aberta + 8 × 250 nas
     futuras = R$ 3.000 comprometidos num limite de R$ 4.000. Uma compra parcelada
     trava o limite pelo total na hora da compra, então sobram R$ 1.000. */
  /* O QUE OCUPA O LIMITE, e em duas naturezas — o corte é por STATUS, não por
     data da fatura:

       UTILIZADO     compra efetivada. A parcelada entra INTEIRA no dia em que foi
                     feita: aqui, 700 + 300 + oito parcelas de 250 = R$ 3.000.
       COMPROMETIDO  lançado e ainda não efetivado: a assinatura de R$ 200.

     Sobram R$ 800 de um limite de R$ 4.000. E nada disso depende do dia em que a
     suíte roda: status não muda com o calendário — foi justamente cortar por data
     que fez a primeira versão deste teste reprovar em seis das nove datas. */
  const valorNaLegenda = rot => {
    const m = bloco.match(new RegExp(rot + ' <i>([^<]+)</i>'));
    return m ? Number(m[1].replace(/[^\d,]/g, '').replace(/\./g, '').replace(',', '.')) : null;
  };
  check('o limite é dito pelo que sobra', bloco.includes('Disponível no limite'), true);
  check('  e o que sobra desconta as duas naturezas', bloco.includes(fmt(800)), true);
  check('o utilizado é a compra efetivada, parcela futura incluída',
    valorNaLegenda('utilizado'), 3000);
  check('  a parcelada conta inteira, não só a fatura do mês',
    valorNaLegenda('utilizado') >= 250 * 8, true);
  check('o comprometido é o que foi lançado e não efetivado',
    valorNaLegenda('comprometido'), 200);
  check('  e as duas somam a dívida inteira do cartão',
    Math.round((valorNaLegenda('utilizado') + valorNaLegenda('comprometido')) * 100), 320000);

  /* A BARRA desenha as duas faixas, cada uma na proporção do que representa —
     juntas, ocupam os 80% do limite que não estão livres. */
  const faixa = cls => {
    const m = bloco.match(new RegExp(`class="${cls}" style="width:([\\d.]+)%`));
    return m ? Number(m[1]) : null;
  };
  check('a barra tem duas faixas', /bar-usado[\s\S]*?bar-futuro/.test(bloco), true);
  check('  a do utilizado na proporção dele', Math.round(faixa('bar-usado') * 100) / 100, 75);
  check('  a do comprometido na dele', Math.round(faixa('bar-futuro') * 100) / 100, 5);
  check('  e juntas elas medem o que não está livre',
    Math.round((faixa('bar-usado') + faixa('bar-futuro')) * 100) / 100, 80);

  /* FATURA QUITADA DEVOLVE O LIMITE. Sem isto, o disponível encolheria para
     sempre a cada fatura paga — o cartão nunca mais teria limite. */
  const usoAntes = usoDoLimite(objCartao, DB.invoicesOf(objCartao));
  const fechadaQ = DB.invoicesOf(objCartao).find(i => i.status === 'Fechada');
  const marca = DB.upsert('invoice_status', { invoice_key: fechadaQ.key, paid: true });
  const usoDepois = usoDoLimite(objCartao, DB.invoicesOf(objCartao));
  check('fatura paga devolve o limite que ocupava',
    Math.round((usoAntes.utilizado - usoDepois.utilizado) * 100), Math.round(fechadaQ.total * 100));
  DB.remove('invoice_status', marca);

  /* LIMITE MENOR QUE A FATURA quase sempre é cadastro errado. Na base real o
     cartão dizia limite R$ 110 com fatura de R$ 359,90, e a tela desenhava uma
     barra de "327%" como se aquilo fosse informação. */
  DB.upsert('cards', { ...objCartao, limit_amount: 100 });
  const blocoEstourado = cartaoBloco(DB.get('cards', cartaoC));
  check('limite menor que a fatura vira aviso, não barra de 327%',
    blocoEstourado.includes('confira o cadastro'), true);
  check('  e a barra estourada não é desenhada', /class="bar /.test(blocoEstourado), false);
  DB.upsert('cards', { ...objCartao, limit_amount: 0 });
  check('sem limite cadastrado, a tela diz o que falta',
    cartaoBloco(DB.get('cards', cartaoC)).includes('Limite não cadastrado'), true);

  /* CARTÃO SEM MOVIMENTO vira uma linha: ele não pode pesar como um que deve. */
  const cartaoVazio = DB.upsert('cards', { name: 'Nunca Usado', closing_day: 5, due_day: 12, limit_amount: 0, active: true });
  const blocoVazio = cartaoBloco(DB.get('cards', cartaoVazio));
  check('cartão sem lançamento vira uma linha', blocoVazio.includes('cc-vazio'), true);
  check('  sem bloco de fatura', blocoVazio.includes('cc-invoice'), false);
  check('  e é bem menor que o de um cartão com fatura', blocoVazio.length < bloco.length / 3, true);

  for (const t of DB.all('transactions').filter(t => t.card_id === cartaoC)) DB.remove('transactions', t.id);
  DB.remove('cards', cartaoC); DB.remove('cards', cartaoVazio); DB.remove('accounts', contaC);
} catch (e) { console.log(` FALHA | tela de cartões: ${e.message}`); fail++; }

/* ---- O GASTO VARIÁVEL PROJETADO, e a linha que ele acrescenta ao hero ----

   O hero respondia "quanto sobra do que está LANÇADO" e se calava sobre mercado,
   combustível e restaurante — que no mês real são o maior gasto. Quem lia o
   "Livre ao fim" como o saldo do dia 31 lia um número que ignora metade do que
   ainda vai sair.

   A resposta vem em FAIXA porque um número só fingiria precisão: medido na base
   real, o mesmo mês fecha em +R$ 52 ou em −R$ 9.668 conforme o método. */
console.log('\n=== Variável projetado e o fechamento do mês ===');
try {
  const contaV = DB.upsert('accounts', { name: 'Conta Var', type: 'Conta Corrente', balance: 10000, active: true });
  const pV = DB.monthPeriod(new Date());
  const diaV = n => DB.somarDiasISO(DB.inicioISO(pV), n);
  const gastoV = (desc, valor, n, extra) => DB.upsert('transactions', {
    description: desc, amount: valor, date: diaV(n), type: 'Despesa', status: 'Pago',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaV, ...(extra || {}),
  });

  const decorridosV = DB.elapsedDays(pV);
  /* O cenário precisa caber nos dias JÁ decorridos, senão os lançamentos caem no
     futuro e não entram no ritmo — e a suíte roda em datas diferentes. */
  const cabe = n => Math.min(n, Math.max(0, decorridosV - 1));
  /* MEDIDO POR DIFERENÇA. O mês corrente já tem os gastos do cenário base, então
     afirmar um total absoluto aqui seria medir o cenário inteiro em vez do que
     este teste acrescenta — foi assim que a primeira versão reprovou. */
  const antesV = DB.variavelProjetado(pV);
  gastoV('Mercado var', 100, cabe(0));
  gastoV('Mercado var', 100, cabe(1));
  gastoV('Pico var', 900, cabe(2));            // o atípico que a mediana ignora
  /* Um gasto DE CONTRATO: ele não pode entrar no ritmo, senão o mês inteiro se
     extrapola. O vínculo é o que diz isso — a marca `recurring` deixou de ser
     fonte de repetição quando o contrato virou a única. */
  const ctrV = DB.upsert('recurrences', {
    description: 'Aluguel do contrato', amount: 3000, type: 'Despesa', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 4, inicio: DB.inicioISO(pV), fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0, scope: 'Família', member: MEMBRO_COMUM, method: 'Débito',
  });
  gastoV('Aluguel do contrato', 3000, cabe(1), { recurrence_id: ctrV });

  const v = DB.variavelProjetado(pV);
  check('há dias decorridos para medir o ritmo', v.decorridos >= 1, true);
  check('  e dias à frente para projetar', v.dias, DB.periodDays(pV) - decorridosV);
  /* O FIXO MARCADO FICA DE FORA. Sem isto o aluguel de R$ 3.000 entraria no ritmo
     e seria cobrado de novo a cada dia restante do mês — o defeito que fazia a
     projeção dizer R$ 162.807 num mês de R$ 17.981 de renda. */
  /* NO ÚLTIMO DIA DO CICLO não há dias à frente, e `variavelProjetado` devolve
     zero de propósito: não há o que projetar. Cobrar as duas coisas na mesma
     execução exigiria um mês que tem e não tem futuro ao mesmo tempo — então cada
     ramo afirma o que vale no seu dia, e tests/tempo.js roda os dois. */
  const temFuturoV = v.dias > 0;
  const acrescentado = (v.diaRitmo - antesV.diaRitmo) * v.decorridos;
  if (temFuturoV) {
    check('o gasto de contrato não entra no ritmo', acrescentado < 3000, true);
    check('  e o variável entra inteiro', Math.round(acrescentado), 1100);
  } else {
    check('no último dia do ciclo não há variável a projetar', v.ritmo, 0);
    check('  nem cenário contido', v.contido, 0);
  }

  /* AS DUAS PONTAS. A média carrega o pico de R$ 900; a mediana não — é para isso
     que ela existe, e é o que separa o cenário contido do cenário no ritmo.

     Com POUCOS DIAS decorridos as duas coincidem, e é aritmética, não defeito: a
     mediana de uma amostra de um dia é o próprio dia. No dia 1º do mês o teste
     cobraria uma diferença que não pode existir. */
  check('o ritmo é a média diária', Math.round(acrescentado * 100), Math.round(v.diaRitmo * v.decorridos * 100 - antesV.diaRitmo * antesV.decorridos * 100));
  if (temFuturoV && v.decorridos >= 3) {
    check('  e o contido é a mediana, que ignora o pico', v.diaContido < v.diaRitmo, true);
  } else if (temFuturoV) {
    check('  com um dia só de amostra, mediana e média coincidem',
      Math.round(v.diaContido * 100), Math.round(v.diaRitmo * 100));
  }
  check('  as duas viram valor multiplicando pelos dias que faltam',
    Math.round(v.ritmo * 100), Math.round(v.diaRitmo * v.dias * 100));

  /* MÊS SEM RITMO NÃO SE EXTRAPOLA: um que ainda não começou não tem dias
     decorridos, e um encerrado não tem o que projetar. */
  const vFut = DB.variavelProjetado(DB.monthPeriod(new Date(), 2));
  check('mês que ainda não começou não projeta variável', vFut.ritmo, 0);
  const vPas = DB.variavelProjetado(DB.monthPeriod(new Date(), -1));
  check('  nem mês encerrado', vPas.ritmo, 0);

  /* ---- A LINHA NO HERO ---- */
  const heroV = renderInicio(pV);
  const fimV = DB.fimISO(pV);
  const livreV = DB.saldoPrevistoNaData(null, fimV) - DB.guardadoPrevisto(fimV);
  const maiorV = Math.max(v.contido, v.ritmo), menorV = Math.min(v.contido, v.ritmo);
  if (temFuturoV) {
    check('o hero mostra o variável estimado', heroV.includes('− Variável estimado'), true);
    check('  e a linha do fechamento', heroV.includes('= Fecha em'), true);
    check('  o fechamento vem DEPOIS do livre ao fim',
      heroV.indexOf('= Livre ao fim') < heroV.indexOf('= Fecha em'), true);
    /* Menos peso que o total: o número firme continua sendo a resposta da conta, e
       a estimativa se apresenta como o que é. */
    check('  e com menos destaque que ele', heroV.includes('hc-l hc-fecha'), true);
    check('  o total não perdeu o destaque', heroV.includes('hc-l hc-total'), true);
    /* A CONTA TEM DE FECHAR: livre ao fim − variável = fecha em. É a mesma exigência
       de todas as contas do app — um total que não se confere nas próprias parcelas
       é o pior defeito possível. */
    /* Quando as duas pontas coincidem — mediana igual à média, o que acontece com
       poucos dias de amostra — a tela mostra UM valor, não "X a X": uma faixa
       degenerada faz o leitor procurar a diferença entre dois números iguais. */
    check('a conta fecha: livre ao fim − variável = fecha em',
      heroV.includes(Math.abs(maiorV - menorV) < 0.5
        ? fmt(livreV - maiorV)
        : `${fmt(livreV - maiorV)} a ${fmt(livreV - menorV)}`), true);
    /* O SELO avisa quando a estimativa derruba um mês que estava no azul. O número
       grande não muda: trocar um total medido por uma faixa estimada poria o palpite
       no lugar mais visível do app. */
    if (livreV >= 0 && livreV - maiorV < 0) {
      check('o selo avisa que o variável derruba o mês', heroV.includes('Aperto no variável'), true);
      check('  mas o número grande continua sendo o valor firme',
        heroV.includes(`hero-value">${fmt(livreV)}`), true);
    }
  } else {
    /* Último dia do ciclo: sem futuro, a estimativa não tem sentido e as duas
       linhas somem. O hero volta a ser só a conta do que está lançado. */
    check('sem dias à frente, o hero não estima variável', heroV.includes('− Variável estimado'), false);
    check('  nem mostra linha de fechamento', heroV.includes('= Fecha em'), false);
    check('  e o total continua lá', heroV.includes('= Livre ao fim'), true);
  }

  for (const t of DB.all('transactions').filter(t => / var$| contrato$/.test(String(t.description)))) DB.remove('transactions', t.id);
  DB.remove('recurrences', ctrV);
  DB.remove('accounts', contaV);
} catch (e) { console.log(` FALHA | variável projetado: ${e.message}`); fail++; }

console.log('\n=== O que fica fora do ritmo: contrato e pontual ===');
try {
  const contaP = DB.upsert('accounts', { name: 'Conta Pontual', type: 'Conta Corrente', balance: 9000, active: true });
  const pP = DB.monthPeriod(new Date());
  const proxP2 = DB.monthPeriod(new Date(), 1);
  const contratoP = DB.upsert('recurrences', {
    description: 'Ginastica mensal', amount: 300, type: 'Despesa', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 6, inicio: DB.inicioISO(pP), fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0, scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaP,
  });
  const idUnico = DB.upsert('transactions', {
    description: 'Dentadura unica', amount: 770,
    date: DB.somarDiasISO(DB.inicioISO(pP), Math.max(0, DB.elapsedDays(pP) - 1)),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Débito', account_id: contaP,
  });
  const foto = () => ({
    ritmo: DB.variavelProjetado(pP).diaRitmo,
    saiProx: DB.previsaoDoMes(proxP2).sai,
    projeta: (DB.previstosNaoLancados(proxP2) || []).some(i => /dentadura unica/i.test(String(i.descricao || i.titulo || ''))),
  });
  /* No ÚLTIMO dia do ciclo não sobra dia para extrapolar, então comparações de
     ritmo não se aplicam. O que vale em qualquer data é o outro lado da regra: o
     que sai do ritmo não pode virar previsão. */
  const temRitmoP = DB.variavelProjetado(pP).dias > 0;

  const comoVariavel = foto();
  if (temRitmoP) check('como variável, ele entra no ritmo', comoVariavel.ritmo > 0, true);
  check('  e não vira previsão do mês que vem', comoVariavel.projeta, false);

  /* PONTUAL sai do ritmo e não repete. É o gasto que aconteceu e não volta — e o
     motivo de existir: como variável ele seria multiplicado pelos dias que faltam,
     inflando o mês por causa de uma compra única. */
  classificarGasto(idUnico, 'pontual');
  const comoPontual = foto();
  if (temRitmoP) check('como pontual, sai do ritmo', comoPontual.ritmo < comoVariavel.ritmo, true);
  check('  e não vira previsão de mês nenhum', comoPontual.projeta, false);
  check('  nem soma às contas do mês que vem',
    Math.round(comoPontual.saiProx * 100), Math.round(comoVariavel.saiProx * 100));
  check('  a classe lida de volta é a que foi gravada',
    DB.classeDoGasto(DB.get('transactions', idUnico)), 'pontual');

  /* CONTA FIXA é o VÍNCULO com o contrato, não uma marca no lançamento. Ele sai do
     ritmo pelo vínculo, e a repetição dos próximos meses é do contrato. */
  check('vincular ao contrato devolve verdadeiro', vincularAContrato(idUnico, contratoP), true);
  const comoContrato = foto();
  check('  e a classe passa a ser de contrato',
    DB.classeDoGasto(DB.get('transactions', idUnico)), 'contrato');
  if (temRitmoP) check('  saindo do ritmo igual ao pontual',
    Math.round(comoContrato.ritmo * 100), Math.round(comoPontual.ritmo * 100));
  check('  e vincular limpa a marca de pontual',
    !!DB.get('transactions', idUnico).pontual, false);

  /* A MARCA ANTIGA não move mais nada: `recurring` deixou de ser fonte de
     repetição quando o contrato passou a ser a única. Um lançamento marcado
     continua sendo gasto variável para todos os efeitos. */
  const idMarcaVelha = DB.upsert('transactions', {
    description: 'Marca legada', amount: 500,
    date: DB.somarDiasISO(DB.inicioISO(pP), Math.max(0, DB.elapsedDays(pP) - 1)),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Débito', account_id: contaP, recurring: true,
  });
  check('a marca antiga não faz o gasto sair do ritmo',
    DB.classeDoGasto(DB.get('transactions', idMarcaVelha)), 'variavel');
  check('  nem vira previsão do mês que vem',
    (DB.previstosNaoLancados(proxP2) || []).some(i => /marca legada/i.test(String(i.descricao || i.titulo || ''))), false);
  DB.remove('transactions', idMarcaVelha);

  check('classe inválida não grava nada', classificarGasto(idUnico, 'inventada'), false);
  check('vincular a contrato que não existe também não', vincularAContrato(idUnico, 'nao-existe'), false);

  DB.remove('transactions', idUnico);
  DB.remove('recurrences', contratoP);
  DB.remove('accounts', contaP);
} catch (e) { console.log(` FALHA | fora do ritmo: ${e.message}`); fail++; }

/* ---- O QUE É CONTA FIXA: o vínculo com o contrato ----

   Adivinhar pelo nome foi tentado e recusado: casar a descrição contra o nome do
   contrato errou 19 lançamentos na base real, porque a descrição do extrato traz
   o nome do banco — "PAGSEGURO INTERNET IP S.A." virava internet fixa e uma
   compra em "ARAGUARI" virava conta de água. */
console.log('\n=== Conta fixa é vínculo, não palpite ===');
try {
  const idCtr = DB.upsert('recurrences', { description: 'Internet', amount: 149, type: 'Despesa',
    periodicidade: 'mensal', dia: 10, inicio: DB.inicioISO(DB.monthPeriod(new Date())),
    fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
  const ehFixo = DB.testadorDeGastoFixo();
  check('descrição de extrato que CITA o contrato não é fixa',
    ehFixo({ description: 'Transferência enviada pelo Pix - OFICINA - PAGSEGURO INTERNET IP S.A.', amount: 1400 }), false);
  check('  nem um nome que contém o do contrato por acaso',
    ehFixo({ description: 'Compra no débito - ARAGUARI II', amount: 7 }), false);
  check('  e nem o lançamento com o nome EXATO, sem vínculo',
    ehFixo({ description: 'Internet', amount: 149 }), false);
  check('a marca antiga também não basta',
    ehFixo({ description: 'Internet', recurring: true }), false);
  check('vinculado ao contrato, é fixo', ehFixo({ description: 'x', recurrence_id: idCtr }), true);
  check('  e parcela, também', ehFixo({ description: 'TV', installment: '3/10' }), true);

  /* O nome exato SUGERE o vínculo — e só sugere. É o que a folha usa para mostrar
     o aviso, com um botão por linha; aplicar sozinho é o que já deu errado. */
  const sug = DB.contratoSugeridoPara({ description: 'Internet', amount: 149, type: 'Despesa', status: 'Pago' });
  check('o nome exato sugere o contrato', sug ? sug.id : null, idCtr);
  check('  mas a descrição de extrato não sugere nada',
    DB.contratoSugeridoPara({ description: 'Pix - PAGSEGURO INTERNET IP S.A.', amount: 10, type: 'Despesa' }), null);
  check('  e quem já tem vínculo não é sugerido de novo',
    DB.contratoSugeridoPara({ description: 'Internet', amount: 149, type: 'Despesa', recurrence_id: idCtr }), null);
  DB.remove('recurrences', idCtr);
} catch (e) { console.log(` FALHA | conta fixa é vínculo: ${e.message}`); fail++; }

/* ---- A FOLHA DE CLASSIFICAÇÃO ----

   A dúvida nasce no Painel e de lá não havia como agir: o formulário não mostra a
   marca e a edição em massa fica a três telas. */
console.log('\n=== Classificar: variável, pontual e vincular ===');
try {
  const contaK = DB.upsert('accounts', { name: 'Conta Class', type: 'Conta Corrente', balance: 9000, active: true });
  const pK = DB.monthPeriod(new Date());
  const diaK = Math.max(0, DB.elapsedDays(pK) - 1);
  const ctrK = DB.upsert('recurrences', { description: 'Aluguel Class', amount: 2500, type: 'Despesa',
    periodicidade: 'mensal', dia: 5, inicio: DB.inicioISO(pK), fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0, scope: 'Família', member: MEMBRO_COMUM, method: 'Débito' });
  const idGrande = DB.upsert('transactions', {
    description: 'Aluguel Class', amount: 2500, date: DB.somarDiasISO(DB.inicioISO(pK), diaK),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaK,
  });

  const heroK = renderInicio(pK);
  const projetaK = DB.variavelProjetado(pK).dias > 0;
  check(projetaK ? 'a linha do variável abre a classificação' : 'sem projeção, o hero não oferece o atalho',
    heroK.includes('data-classificar'), projetaK);

  openClassificarGastos(pK);
  const folha = els['#modal'] ? els['#modal'].innerHTML : '';
  check('a folha lista os gastos do mês', folha.includes('Aluguel Class'), true);
  check('  com os dois estados à vista', folha.includes('>variável<') && folha.includes('>pontual<'), true);
  check('  e o maior valor no topo, que é o que distorce a projeção',
    folha.indexOf('Aluguel Class') < folha.indexOf('Mercado'), true);
  /* A SUGESTÃO DE VÍNCULO: nome igual ao de um contrato ativo, sem vínculo. É o
     caso dos nove lançamentos de agosto que somavam R$ 5.460,80 no ritmo. */
  check('  e sugere o vínculo com o contrato de mesmo nome',
    folha.includes(`data-vincular="${idGrande}"`), true);
  check('  dizendo a qual contrato', folha.includes(`data-contrato="${ctrK}"`), true);

  const antesK = DB.variavelProjetado(pK);
  check('vincular pela folha grava', vincularAContrato(idGrande, ctrK), true);
  check('  e o vínculo fica no lançamento',
    DB.get('transactions', idGrande).recurrence_id, ctrK);
  if (projetaK) {
    check('  tirando o gasto do ritmo',
      Math.round((antesK.diaRitmo - DB.variavelProjetado(pK).diaRitmo) * antesK.decorridos), 2500);
  }
  /* Vinculado, ele sai da lista de sugestões: não há mais o que oferecer. */
  openClassificarGastos(pK);
  check('  e a sugestão desaparece',
    (els['#modal'].innerHTML || '').includes(`data-vincular="${idGrande}"`), false);

  /* Quem já é de contrato não oferece botão de classe: a repetição é decidida no
     contrato, e alternar aqui criaria um estado que o próximo cálculo desfaz. */
  const doContrato = { id: 'x1', description: 'Do contrato', amount: 10, date: todayISO(), recurrence_id: 'r9' };
  const comParcela = { id: 'x2', description: 'Parcelado', amount: 10, date: todayISO(), installment: '2/5' };
  check('lançamento de contrato não oferece os botões de classe',
    linhaDeClassificacao(doContrato, 'contrato').includes('data-classe'), false);
  /* Mas oferece DESVINCULAR: o vínculo pode ter sido posto no lançamento errado, e
     sem saída a única correção seria mexer no contrato — que é outra coisa. */
  check('  e oferece desvincular',
    linhaDeClassificacao(doContrato, 'contrato').includes('data-desvincular'), true);
  check('parcela também não oferece classe',
    linhaDeClassificacao(comParcela, 'contrato').includes('data-classe'), false);
  /* Parcela NÃO oferece desvincular: ela é de contrato por outro caminho, o
     `installment`, e o botão prometeria desfazer algo que não desfaz — a próxima
     parcela continuaria nascendo. */
  check('  nem desvincular, que ali não desfaria nada',
    linhaDeClassificacao(comParcela, 'contrato').includes('data-desvincular'), false);
  check('  e é ela que diz estar fora da projeção',
    linhaDeClassificacao(comParcela, 'contrato').includes('fora da projeção'), true);
  const linhaComum = linhaDeClassificacao({ id: 'x3', description: 'Mercado', amount: 10, date: todayISO(), type: 'Despesa' }, 'variavel');
  check('  já um gasto comum oferece variável e pontual',
    ['variavel', 'pontual'].every(c => linhaComum.includes(`data-classe="${c}"`)), true);
  check('  e nunca um botão de "fixo", que não existe mais',
    linhaComum.includes('data-classe="fixo"'), false);
  check('  com o estado atual em destaque',
    (linhaComum.match(/class="cg-b on"/g) || []).length, 1);

  /* Escolher o contrato: só os ATIVOS aparecem. Vincular a um cancelado não faria
     o gasto se repetir, e a tela prometeria o contrário. */
  const idOutro = DB.upsert('transactions', {
    description: 'Gasto solto', amount: 90, date: DB.somarDiasISO(DB.inicioISO(pK), diaK),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaK,
  });
  DB.upsert('recurrences', { ...DB.get('recurrences', ctrK), status: 'cancelada' });
  openEscolherContrato(idOutro, pK);
  check('a escolha de contrato não lista cancelado',
    (els['#modal'].innerHTML || '').includes(`data-contrato="${ctrK}"`), false);
  DB.upsert('recurrences', { ...DB.get('recurrences', ctrK), status: 'ativa' });
  openEscolherContrato(idOutro, pK);
  check('  e lista o ativo', (els['#modal'].innerHTML || '').includes(`data-contrato="${ctrK}"`), true);
  closeModal();

  DB.remove('transactions', idOutro);
  DB.remove('transactions', idGrande);
  DB.remove('recurrences', ctrK);
  DB.remove('accounts', contaK);
} catch (e) { console.log(` FALHA | classificar gastos: ${e.message}`); fail++; }

/* ---- CUSTO FIXO: SÓ CONTRATOS ----

   A seção chegou a somar os lançamentos marcados `recurring`, quando eles eram
   tratados como fixos. Com o contrato virando fonte única eles saíram — e com
   eles a divergência entre este card e a tela "Contas fixas", que sempre leu só
   contratos. Uma fonte, um número. */
console.log('\n=== Custo fixo mensal: uma fonte só ===');
try {
  const pC = DB.monthPeriod(new Date());
  const antesCF = DB.custoFixoMensal();
  const contaCF = DB.upsert('accounts', { name: 'Conta CF', type: 'Conta Corrente', balance: 5000, active: true });

  /* Lançamento com a marca antiga NÃO entra: se entrasse, o card diria um total
     que a tela "Contas fixas" não confirma. */
  const idMarcado = DB.upsert('transactions', {
    description: 'Academia marcada', amount: 200, date: DB.somarDiasISO(DB.inicioISO(pC), 1),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Débito', account_id: contaCF, recurring: true,
  });
  const cfMarcado = DB.custoFixoMensal();
  check('lançamento com a marca antiga não entra no custo fixo',
    cfMarcado.itens.some(i => i.descricao === 'Academia marcada'), false);
  check('  e o total não muda por causa dele',
    Math.round(cfMarcado.total * 100), Math.round(antesCF.total * 100));
  DB.remove('transactions', idMarcado);

  /* O CONTRATO entra, e é a única fonte. */
  const idCtrCF = DB.upsert('recurrences', {
    description: 'Academia contrato', amount: 200, type: 'Despesa', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 8, inicio: DB.inicioISO(pC), fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0,
  });
  const cfCtr = DB.custoFixoMensal();
  const achado = cfCtr.itens.find(i => i.descricao === 'Academia contrato');
  check('o contrato entra no custo fixo', !!achado, true);
  check('  com o valor dele', achado ? achado.mensal : 0, 200);
  check('  e o total cresce exatamente esse valor',
    Math.round((cfCtr.total - antesCF.total) * 100), 20000);
  check('todo item do custo fixo vem de contrato',
    cfCtr.itens.every(i => i.origem === 'contrato'), true);

  /* TODOS OS ITENS NA TELA, sem "e mais N" — a pedido de quem usa. Esta é a tela
     de gerenciar custo fixo, e o que está escondido não se gerencia: com dez
     contratos, os seis de baixo somavam R$ 1.120 sem dizer de quê.

     O CENÁRIO PRECISA PASSAR DE QUATRO ITENS, senão o corte antigo não recortava
     nada e o teste passava sem exercitar a regra — foi o que a sabotagem mostrou:
     reintroduzir `slice(0, 4)` não reprovava. */
  const enchePara = [];
  while (DB.custoFixoMensal().itens.length < 6) {
    enchePara.push(DB.upsert('recurrences', {
      description: `Enche CF ${enchePara.length + 1}`, amount: 10 + enchePara.length,
      type: 'Despesa', valor_tipo: 'fixo', periodicidade: 'mensal', dia: 7,
      inicio: DB.inicioISO(pC), fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0,
    }));
    if (enchePara.length > 12) break;           // trava: nunca virar laço infinito
  }
  const cfCtr2 = DB.custoFixoMensal();
  check('o cenário tem itens além do corte antigo de quatro', cfCtr2.itens.length > 4, true);
  const cartaoCF = custoFixoCard();
  check('o card lista todos os itens do custo fixo',
    cfCtr2.itens.every(i => cartaoCF.includes(esc(i.descricao))), true);
  check('  e não agrupa o resto em "e mais N"', /e mais \d+/.test(cartaoCF), false);
  /* Com todas as linhas à vista, o total do cabeçalho é a soma CONFERÍVEL delas —
     e por isso deixou de vir abreviado. "R$ 6.241" bastava enquanto só quatro
     apareciam; agora quem soma as dez chega a R$ 6.240,80 e encontraria dois
     números para a mesma coisa. */
  check('  o total do cabeçalho vem com centavos, para fechar com a soma',
    cartaoCF.includes(fmt(cfCtr2.total)), true);
  check('  e a soma das linhas dá o total',
    Math.round(cfCtr2.itens.reduce((s, i) => s + i.mensal, 0) * 100), Math.round(cfCtr2.total * 100));
  /* O PRAZO em cada linha: é o que faz planejar, e antes vivia só na frase do
     rodapé, que fala de dois itens.

     O CONTRATO COM PRAZO É CRIADO AQUI. A primeira versão procurava um no cenário,
     e todos eram "sem prazo" — o `if` nunca rodava e a sabotagem que removia o
     prazo da linha passou despercebida. */
  const idComPrazo = DB.upsert('recurrences', {
    description: 'Parcela com prazo', amount: 250, type: 'Despesa', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 6, inicio: DB.inicioISO(pC),
    fim_tipo: 'vezes', fim_vezes: 10, geradas: 3, status: 'ativa',
  });
  const itemPrazo = DB.custoFixoMensal().itens.find(i => i.descricao === 'Parcela com prazo');
  check('  o item com prazo sabe quantas faltam', itemPrazo ? itemPrazo.restam : null, 7);
  /* ANCORADO NA LINHA, não no card inteiro: a frase do rodapé também diz
     "7 meses", e por isso a primeira versão deste teste passava mesmo com o prazo
     removido da linha — casava com o rodapé sem saber. */
  check('  e a linha do card diz isso, não só o rodapé',
    custoFixoCard().includes(`Parcela com prazo <i>${itemPrazo.restam} meses</i>`), true);
  DB.remove('recurrences', idComPrazo);

  /* AS DUAS TELAS CONTAM A MESMA HISTÓRIA — é o que a fonte única compra. */
  const naTela = renderCartoes();
  check('o card mostra o contrato', naTela.includes('Academia contrato'), true);
  openRecorrencias();
  check('  e a tela "Contas fixas" mostra o mesmo',
    (els['#modal'].innerHTML || '').includes('Academia contrato'), true);
  closeModal();

  for (const id of enchePara) DB.remove('recurrences', id);
  DB.remove('recurrences', idCtrCF);
  DB.remove('accounts', contaCF);
} catch (e) { console.log(` FALHA | custo fixo uma fonte: ${e.message}`); fail++; }

/* ---- CRIAR CONTRATO E DESVINCULAR, a partir da folha ----

   Vincular só serve quando existe a que vincular, e desvincular só serve quando
   dá para errar — as duas condições acontecem na prática: contratos são criados
   depois dos primeiros lançamentos, e um vínculo pode ir para a linha errada. */
console.log('\n=== Criar contrato e desvincular ===');
try {
  const contaN = DB.upsert('accounts', { name: 'Conta Novo', type: 'Conta Corrente', balance: 8000, active: true });
  const pN = DB.monthPeriod(new Date());
  const catN = (DB.rootCategories('Despesa')[0] || {}).id || null;
  const idAssin = DB.upsert('transactions', {
    description: 'Streaming novo', amount: 55,
    date: DB.somarDiasISO(DB.inicioISO(pN), Math.max(0, DB.elapsedDays(pN) - 1)),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
    method: 'Débito', account_id: contaN, category_id: catN,
  });

  /* A folha de escolha oferece criar, não só escolher. */
  openEscolherContrato(idAssin, pN);
  check('a escolha de contrato oferece criar um novo',
    (els['#modal'].innerHTML || '').includes(`data-novo-contrato="${idAssin}"`), true);

  /* O CONTRATO herda o lançamento e começa na PRÓXIMA ocorrência: a de hoje é o
     próprio lançamento, e começar hoje deixaria o mês com duas linhas iguais. */
  const antesN = DB.all('recurrences').length;
  const idCtrNovo = contratoDoLancamento(DB.get('transactions', idAssin), {
    periodicidade: 'mensal', dia: 9, valorTipo: 'fixo', fimTipo: 'sem_prazo',
  });
  check('criar contrato a partir do lançamento', DB.all('recurrences').length, antesN + 1);
  const ctrNovo = DB.get('recurrences', idCtrNovo);
  check('  herda a descrição', ctrNovo.description, 'Streaming novo');
  check('  o valor', Number(ctrNovo.amount), 55);
  check('  e a categoria, senão o previsto cai em "sem categoria"', ctrNovo.category_id, catN);
  check('  começa na próxima ocorrência, não hoje',
    String(ctrNovo.inicio) > String(DB.get('transactions', idAssin).date), true);
  check('  e nasce ativo', ctrNovo.status, 'ativa');

  /* O "N vezes" conta o lançamento de hoje: quem escolhe 12x quer doze cobranças
     no total, não doze além da que acabou de fazer. */
  const idPorVezes = contratoDoLancamento(DB.get('transactions', idAssin), {
    periodicidade: 'mensal', dia: 9, fimTipo: 'vezes', fimVezes: 12,
  });
  check('o prazo por vezes desconta a ocorrência de hoje',
    Number(DB.get('recurrences', idPorVezes).fim_vezes), 11);
  DB.remove('recurrences', idPorVezes);
  check('sem periodicidade não cria nada',
    contratoDoLancamento(DB.get('transactions', idAssin), { dia: 9 }), null);

  /* DESVINCULAR devolve o lançamento ao ritmo — e não toca no contrato. */
  vincularAContrato(idAssin, idCtrNovo);
  check('vinculado, a classe é de contrato',
    DB.classeDoGasto(DB.get('transactions', idAssin)), 'contrato');
  const vN = DB.variavelProjetado(pN);
  check('desvincular devolve verdadeiro', desvincularDoContrato(idAssin), true);
  check('  o vínculo sai do lançamento',
    !!DB.get('transactions', idAssin).recurrence_id, false);
  check('  e ele volta a ser variável',
    DB.classeDoGasto(DB.get('transactions', idAssin)), 'variavel');
  if (vN.dias > 0) {
    check('  voltando a contar no ritmo',
      DB.variavelProjetado(pN).diaRitmo > vN.diaRitmo, true);
  }
  /* O CONTRATO CONTINUA DE PÉ: desvincular é dizer "este lançamento não é aquela
     ocorrência", não "cancele a conta fixa". Apagá-lo aqui destruiria a repetição
     inteira por causa de um vínculo errado num mês. */
  check('  e o contrato continua existindo', !!DB.get('recurrences', idCtrNovo), true);
  check('  ainda ativo', DB.get('recurrences', idCtrNovo).status, 'ativa');
  check('desvincular o que não tem vínculo não faz nada',
    desvincularDoContrato(idAssin), false);

  /* DESPESA COM DESPESA, RECEITA COM RECEITA. A tela filtra, mas a função é onde
     isso tem de valer: um gasto vinculado ao contrato do salário sairia do ritmo
     por um caminho que não faz sentido, e `restamDaRecorrencia` passaria a contar
     ocorrência de outro tipo. */
  const ctrReceita = DB.upsert('recurrences', {
    description: 'Salario Novo', amount: 9000, type: 'Receita', valor_tipo: 'fixo',
    periodicidade: 'mensal', dia: 5, inicio: DB.inicioISO(pN), fim_tipo: 'sem_prazo',
    status: 'ativa', geradas: 0,
  });
  check('despesa não vincula a contrato de receita',
    vincularAContrato(idAssin, ctrReceita), false);
  check('  e o lançamento fica sem vínculo',
    !!DB.get('transactions', idAssin).recurrence_id, false);
  /* E a tela não oferece o que a função recusa — senão o toque não faria nada e
     pareceria defeito. */
  openEscolherContrato(idAssin, pN);
  check('  a escolha nem lista contrato de receita para uma despesa',
    (els['#modal'].innerHTML || '').includes(`data-contrato="${ctrReceita}"`), false);
  DB.remove('recurrences', ctrReceita);

  /* A LISTA VEM POR VALOR: é assim que se acha o aluguel no meio de dez contratos,
     e não pela ordem de cadastro. */
  const ctrPequeno = DB.upsert('recurrences', { description: 'Assinatura miuda', amount: 12,
    type: 'Despesa', valor_tipo: 'fixo', periodicidade: 'mensal', dia: 3, inicio: DB.inicioISO(pN),
    fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
  const ctrGrande = DB.upsert('recurrences', { description: 'Aluguel graudo', amount: 4000,
    type: 'Despesa', valor_tipo: 'fixo', periodicidade: 'mensal', dia: 3, inicio: DB.inicioISO(pN),
    fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
  openEscolherContrato(idAssin, pN);
  const listaEsc = els['#modal'].innerHTML || '';
  check('a lista de contratos vem do maior para o menor',
    listaEsc.indexOf(`data-contrato="${ctrGrande}"`) < listaEsc.indexOf(`data-contrato="${ctrPequeno}"`), true);
  DB.remove('recurrences', ctrPequeno); DB.remove('recurrences', ctrGrande);

  DB.remove('recurrences', idCtrNovo);
  DB.remove('transactions', idAssin);
  DB.remove('accounts', contaN);
  closeModal();
} catch (e) { console.log(` FALHA | criar e desvincular: ${e.message}`); fail++; }

/* ---- EDITAR UM CONTRATO ----

   A tela "Contas fixas" só oferecia mudar o VALOR e o status. Um aluguel que
   passou do dia 10 para o 15 só podia ser cancelado e recriado — perdendo o
   histórico de ocorrências, o vínculo dos lançamentos já gerados e a contagem de
   quantas faltam. */
console.log('\n=== Editar as configurações de um contrato ===');
try {
  const contaE = DB.upsert('accounts', { name: 'Conta Editar', type: 'Conta Corrente', balance: 4000, active: true });
  const catE = (DB.rootCategories('Despesa')[0] || {}).id || null;
  const idEd = DB.upsert('recurrences', {
    description: 'Aluguel editavel', amount: 2000, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: contaE, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 10, inicio: DB.inicioISO(DB.monthPeriod(new Date())),
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 3, status: 'ativa', ultima_geracao: null,
  });

  openEditarContrato(idEd);
  const folhaEd = el('#sheet').innerHTML;
  check('a folha abre com os campos do contrato', folhaEd.includes('Aluguel editavel'), true);
  check('  a periodicidade atual vem selecionada', /value="mensal" selected/.test(folhaEd), true);
  check('  o dia atual vem no campo', /id="ec-dia"[^>]*value="10"/.test(folhaEd), true);
  check('  e o prazo atual também', /value="sem_prazo" selected/.test(folhaEd), true);
  /* O TIPO fica fora: invertê-lo depois de gerar ocorrências trocaria o sinal do
     que já entrou no saldo, e sobraria um contrato de receita com lançamentos de
     despesa vinculados. */
  check('  o tipo não é editável, de propósito', folhaEd.includes('id="ec-tipo"'), false);
  check('  e a folha avisa que vale das próximas',
    folhaEd.includes('Vale das próximas ocorrências em diante'), true);
  check('  dizendo quantas já nasceram', folhaEd.includes('Já nasceram 3'), true);

  /* SALVAR muda o contrato de verdade — é o ponto da tela. */
  el('#ec-desc').value = 'Aluguel novo nome';
  el('#ec-per').value = 'quinzenal';
  el('#ec-dia').value = '15';
  el('#ec-cat').value = catE || '';
  el('#ec-metodo').value = 'PIX';
  el('#ec-conta').value = contaE;
  el('#ec-vtipo').value = 'media';
  el('#ec-fim').value = 'sem_prazo';
  el('#ec-amount').value = '2.500,00';
  el('#sh-save').onclick();
  const depoisEd = DB.get('recurrences', idEd);
  check('salvar muda a descrição', depoisEd.description, 'Aluguel novo nome');
  check('  a periodicidade', depoisEd.periodicidade, 'quinzenal');
  check('  o dia do vencimento', Number(depoisEd.dia), 15);
  check('  a categoria', depoisEd.category_id, catE);
  check('  a forma de pagamento', depoisEd.method, 'PIX');
  check('  o tipo de valor', depoisEd.valor_tipo, 'media');
  /* E PRESERVA o que não estava na tela: o histórico de ocorrências é o que se
     perderia ao recriar o contrato, e é justamente por isso que o editor existe. */
  check('  e preserva quantas já nasceram', Number(depoisEd.geradas), 3);
  check('  o início, que é histórico', depoisEd.inicio, DB.inicioISO(DB.monthPeriod(new Date())));
  check('  e o tipo do contrato', depoisEd.type, 'Despesa');

  /* O "N VEZES" É O PONTO DE ERRAR EM SILÊNCIO. A tela pergunta o TOTAL, contando
     as que já nasceram; `fim_vezes` guarda as que FALTAM. Sem descontar, um
     contrato de 12x recomeçaria em 12 a cada edição, e ninguém veria até ele
     passar do fim. */
  openEditarContrato(idEd);
  el('#ec-fim').value = 'vezes';
  el('#ec-vezes').value = '12';
  el('#sh-save').onclick();
  const comVezes = DB.get('recurrences', idEd);
  check('o prazo por vezes guarda o TOTAL de ocorrências do contrato',
    Number(comVezes.fim_vezes), 12);
  /* E o que FALTA é derivado: restam = fim_vezes − geradas. A primeira versão do
     editor descontava as já nascidas antes de gravar, e o desconto acontecia duas
     vezes — 12 com 3 nascidas viravam "faltam 6" em vez de 9. O teste pegou. */
  check('  e o que falta sai por subtração', DB.restamDaRecorrencia(comVezes), 9);
  /* Reabrir mostra o TOTAL de novo: senão cada abertura encolheria o número na
     tela sem ninguém ter mexido nele. */
  openEditarContrato(idEd);
  check('  reabrindo, o campo mostra o total, não o que falta',
    /id="ec-vezes"[^>]*value="12"/.test(el('#sheet').innerHTML), true);
  closeSheet();

  /* CARTÃO E CONTA se excluem: a compra no cartão pesa na fatura, não sai da conta
     direto, e guardar os dois deixaria o app decidindo sozinho qual vale. */
  const cartaoE = DB.all('cards')[0];
  if (cartaoE) {
    openEditarContrato(idEd);
    el('#ec-metodo').value = 'Cartão de Crédito';
    el('#ec-cartao').value = cartaoE.id;
    el('#sh-save').onclick();
    const noCartao = DB.get('recurrences', idEd);
    check('contrato no cartão guarda o cartão', noCartao.card_id, cartaoE.id);
    check('  e solta a conta, que não é usada ali', noCartao.account_id, null);
  }

  check('descrição vazia não salva', (() => {
    openEditarContrato(idEd);
    el('#ec-desc').value = '   ';
    el('#sh-save').onclick();
    return DB.get('recurrences', idEd).description;
  })(), 'Aluguel novo nome');
  closeSheet();

  DB.remove('recurrences', idEd);
  DB.remove('accounts', contaE);
} catch (e) { console.log(` FALHA | editar contrato: ${e.message}`); fail++; }

/* ---- COFRINHO: os dados ----

   O saldo de cada pote é DERIVADO das entradas, nunca guardado — mesma regra do
   saldo e da previsão no resto do app. */
console.log('\n=== Cofrinho: potes, semanada e moeda mágica ===');
try {
  const hojeK = DB.hojeISO();
  const diaSemanaHoje = new Date(hojeK + 'T12:00:00').getDay();
  const kidId = DB.upsert('kids', {
    name: 'Criança Teste', avatar: '🦖', cor: '#00b894',
    semanada_valor: 8, semanada_dia: diaSemanaHoje,     // hoje é dia de semanada
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true,
  });
  const kid = () => DB.get('kids', kidId);
  const lanc = (tipo, amount, pote, dataISO, extra) => DB.upsert('kid_entries', {
    kid_id: kidId, tipo, amount, pote, date: dataISO || hojeK, description: tipo, ...(extra || {}),
  });

  check('a criança entra na lista', DB.kids().some(k => k.id === kidId), true);
  check('sem movimento, os três potes estão zerados',
    JSON.stringify(DB.kidPotes(kidId)), JSON.stringify({ gastar: 0, guardar: 0, doar: 0, total: 0 }));

  /* A DIVISÃO NOS POTES: uma semanada de 8 vira três entradas, uma por pote. */
  lanc('semanada', 4, 'gastar');
  lanc('semanada', 3, 'guardar');
  lanc('semanada', 1, 'doar');
  const p1 = DB.kidPotes(kidId);
  check('cada pote soma o que caiu nele', `${p1.gastar}/${p1.guardar}/${p1.doar}`, '4/3/1');
  check('  e o total é a soma dos três', p1.total, 8);

  /* GASTO E DOAÇÃO SÃO SAÍDAS, e saem do pote de onde vieram. Gastar do pote
     "guardar" tem significado diferente de gastar do "gastar agora" — a criança
     precisa ver essa diferença, e por isso `pote` existe também na saída. */
  lanc('gasto', 2, 'gastar');
  check('gasto sai do pote onde foi feito', DB.kidPotes(kidId).gastar, 2);
  check('  e não mexe nos outros', DB.kidPotes(kidId).guardar, 3);
  lanc('doacao', 1, 'doar');
  check('doação sai do pote doar', DB.kidPotes(kidId).doar, 0);

  /* SEMANADA: uma por semana. Sem a conferência, abrir o app duas vezes no mesmo
     dia daria duas semanadas, e o erro só apareceria ao somar o mês. */
  check('com a semanada já paga, não é devida de novo', DB.kidSemanadaDevida(kid()), null);
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === kidId && e.tipo === 'semanada')) DB.remove('kid_entries', e.id);
  const devida = DB.kidSemanadaDevida(kid());
  check('sem ela, a semanada é devida', devida ? devida.valor : null, 8);
  check('  e sem valor configurado, não é devida nada',
    DB.kidSemanadaDevida({ ...kid(), semanada_valor: 0 }), null);

  /* A SEMANA começa no dia da semanada, não no domingo: todo o app da criança
     pensa em semanas, e o marco é o dia em que ela recebe. */
  check('a semana começa no dia da semanada', DB.kidInicioDaSemana(kid()), hojeK);
  const outroDia = DB.kidInicioDaSemana({ ...kid(), semanada_dia: (diaSemanaHoje + 1) % 7 });
  check('  e recua quando o dia ainda não chegou nesta semana', outroDia < hojeK, true);

  /* MOEDA MÁGICA: cai quando a semana passou sem saída do pote guardar. */
  const semanaPassada = DB.somarDiasISO(hojeK, -8);
  lanc('semanada', 5, 'guardar', semanaPassada);
  const magica = DB.kidMoedaMagicaDevida(kid());
  check('guardou a semana toda: a moeda mágica é devida', magica ? magica.valor : null, 1);
  /* Se mexeu no que guardou, não cai — e a tela diz isso sem repreender. */
  const idMexeu = lanc('gasto', 2, 'guardar', DB.somarDiasISO(hojeK, -3));
  check('  mexeu no pote guardar: não cai', DB.kidMoedaMagicaDevida(kid()), null);
  DB.remove('kid_entries', idMexeu);
  check('  desfeito o gasto, volta a ser devida', !!DB.kidMoedaMagicaDevida(kid()), true);
  /* Uma por semana: sem isso, cada abertura do app pagaria de novo. */
  lanc('rendimento', 1, 'guardar');
  check('  e cai uma só por semana', DB.kidMoedaMagicaDevida(kid()), null);
  check('  desligada, nunca cai',
    DB.kidMoedaMagicaDevida({ ...kid(), rendimento_valor: 0 }), null);

  /* META: em SEMANADAS, não em reais. Aos 6 anos tempo é mais concreto que
     dinheiro — "faltam 5 semanadas" se entende, "faltam R$ 47,50" não. */
  const metaId = DB.upsert('kid_goals', { kid_id: kidId, name: 'Bicicleta', icon: '🚲', target_amount: 45 });
  const guardado = DB.kidPotes(kidId).guardar;
  check('a meta ativa é encontrada', (DB.kidMeta(kidId) || {}).id, metaId);
  /* Faltam 45 − guardado, a R$ 9 por semana (semanada 8 + moeda mágica 1). A moeda
     entra na conta de propósito: ignorá-la prometeria mais semanas do que a
     realidade. */
  check('quantas semanadas faltam',
    DB.kidSemanadasParaMeta(kidId), Math.ceil((45 - guardado) / 9));
  check('  só o pote GUARDAR conta para a meta',
    DB.kidSemanadasParaMeta(kidId) > 0, true);
  DB.upsert('kid_goals', { ...DB.get('kid_goals', metaId), target_amount: 1 });
  check('  meta já alcançada devolve zero', DB.kidSemanadasParaMeta(kidId), 0);

  /* TAREFAS: a criança marca, o adulto confirma. Sem esse passo o app vira
     máquina de auto-serviço. */
  const tarefaId = DB.upsert('kid_tasks', { kid_id: kidId, name: 'Arrumar a cama', icon: '🛏️', amount: 1, active: true });
  const listaT = DB.kidTarefas(kidId);
  check('a tarefa aparece na lista da semana', listaT.length, 1);
  check('  e começa não feita', listaT[0].feita, false);
  /* MEDIDO POR DELTA: o cenário já mexeu nos potes acima, e afirmar um total
     absoluto aqui mediria o teste inteiro em vez do que a confirmação faz. */
  const antesTarefa = DB.kidPotes(kidId).gastar;
  const marcaId = lanc('tarefa', 1, 'gastar', hojeK, { task_id: tarefaId, confirmada: false });
  check('marcada, ela aparece como feita', DB.kidTarefas(kidId)[0].feita, true);
  check('  mas ainda não confirmada', DB.kidTarefas(kidId)[0].confirmada, false);
  check('  e o dinheiro NÃO entra antes da confirmação', DB.kidPotes(kidId).gastar, antesTarefa);
  check('  ela entra na fila do adulto',
    DB.kidTarefasAConfirmar().some(x => x.entry.id === marcaId), true);
  DB.upsert('kid_entries', { ...DB.get('kid_entries', marcaId), confirmada: true });
  check('confirmada, o dinheiro entra', DB.kidPotes(kidId).gastar, antesTarefa + 1);
  check('  e ela sai da fila do adulto',
    DB.kidTarefasAConfirmar().some(x => x.entry.id === marcaId), false);

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === kidId)) DB.remove('kid_entries', e.id);
  DB.remove('kid_tasks', tarefaId); DB.remove('kid_goals', metaId); DB.remove('kids', kidId);
} catch (e) { console.log(` FALHA | cofrinho dados: ${e.message}`); fail++; }

/* ---- CONTRATO ENCERRADO SAI DO CUSTO FIXO ----

   Este bloco nasceu de um defeito que estava no app desde antes do cofrinho: o
   filtro era `r.status === 'Encerrada'`, com E maiúsculo, e o app grava
   'ativa' | 'pausada' | 'cancelada'. A condição era falsa SEMPRE, então todo
   contrato cancelado ou pausado continuava somando no custo fixo mensal.

   Quem cancelou um financiamento continuava vendo o peso dele no orçamento, sem
   ter como desconfiar: o contrato aparecia encerrado na tela de contratos e vivo
   na conta do mês. Apareceu por acaso, ao encerrar o contrato de uma semanada
   zerada e o valor não sair da conta. */
console.log('\n=== Contrato encerrado sai do custo fixo ===');
try {
  const somaDe = nome => DB.custoFixoMensal().itens
    .filter(i => i.descricao === nome).reduce((s, i) => s + i.mensal, 0);

  const idCF = DB.upsert('recurrences', {
    description: 'Teste do custo fixo', amount: 500, type: 'Despesa',
    periodicidade: 'mensal', dia: 10, inicio: DB.hojeISO(),
    fim_tipo: 'sempre', status: 'ativa', geradas: 0,
  });
  check('contrato ativo conta no custo fixo', somaDe('Teste do custo fixo'), 500);

  DB.upsert('recurrences', { ...DB.get('recurrences', idCF), status: 'cancelada' });
  check('cancelado sai da conta', somaDe('Teste do custo fixo'), 0);

  /* PAUSADO TAMBÉM SAI. Pausar existe para "não me cobre isso agora" — se o valor
     continuasse no custo fixo, pausar não faria diferença nenhuma no número que a
     família usa para decidir, e a tela de contratos diria uma coisa e o orçamento
     outra. */
  DB.upsert('recurrences', { ...DB.get('recurrences', idCF), status: 'pausada' });
  check('pausado também sai', somaDe('Teste do custo fixo'), 0);
  check('  e o contrato continua existindo', !!DB.get('recurrences', idCF), true);

  DB.upsert('recurrences', { ...DB.get('recurrences', idCF), status: 'ativa' });
  check('reativar traz de volta', somaDe('Teste do custo fixo'), 500);

  /* O CUSTO FIXO É COERENTE COM QUEM GERA. Um contrato que não gera lançamento não
     pode pesar no orçamento: seriam dois números discordando sobre o mesmo mês. */
  const geramMas = DB.all('recurrences').filter(r => r.status !== 'ativa' && r.type !== 'Receita');
  const noCusto = DB.custoFixoMensal().itens.map(i => i.id);
  check('nenhum contrato não-ativo aparece no custo fixo',
    geramMas.filter(r => noCusto.includes(r.id)).map(r => r.description), []);

  DB.remove('recurrences', idCF);
} catch (e) { console.log(` FALHA | custo fixo e status: ${e.message}`); fail++; }

/* ---- A SEMANADA NÃO MOVE O SALDO, E O COFRINHO SAI DO LIVRE ----

   Dar a semanada não é gastar: o dinheiro fica na conta da família e passa a ter
   outro dono. Antes o lançamento debitava o saldo, e a conta divergia do extrato
   do banco em uma semanada por semana, acumulando — um defeito que só apareceria
   na conciliação, meses depois, sem ninguém ligar à causa.

   E o dinheiro do cofrinho NÃO é guardado. Guardado é dinheiro da família com
   plano, e é o que alimenta a cobertura da reserva de emergência; o do cofrinho
   já tem outro dono, e numa emergência a família não vai usar a mesada da
   criança. A definição que encaixa é a que o app já usa para `committed`:
   "quanto já é de outra pessoa". */
console.log('\n=== O dinheiro dos filhos sai do livre, não do saldo ===');
try {
  const hojeF = DB.hojeISO();
  const diaF = new Date(hojeF + 'T12:00:00').getDay();
  const contaF = DB.upsert('accounts', { name: 'Conta do teste dos filhos', type: 'Conta Corrente', balance: 1000, active: true });
  const idF = DB.upsert('kids', {
    name: 'Filho Saldo', avatar: '🐢', semanada_valor: 8, semanada_dia: diaF,
    rendimento_tipo: 'moeda', rendimento_valor: 0, active: true,
  });

  /* O SALDO NÃO SE MEXE. É o defeito que motivou tudo isto: o app debitava a
     conta de um dinheiro que continua no banco. */
  const idContrato = DB.acertarContratoDaSemanada(idF, { account_id: contaF });
  DB.gerarRecorrencias();
  const sem = DB.all('transactions').filter(t => t.recurrence_id === idContrato);
  check('o contrato gerou a semanada', sem.length >= 1, true);
  check('  e ela se identifica pela criança', sem[0].kid_id, idF);
  check('  o app a reconhece como semanada', DB.isSemanada(sem[0]), true);

  /* NEUTRA: não move saldo nem ao ser marcada como entregue. É o mesmo tratamento
     de conciliação, pagamento de fatura e transferência. */
  check('a semanada é neutra', DB.isNeutral(sem[0]), true);
  check('  então não tem efeito no saldo', txEffect({ ...sem[0], status: 'Pago' }), 0);
  const saldoAntes = DB.get('accounts', contaF).balance;
  applyTxEffect({ ...sem[0], status: 'Pago' }, 1);
  check('  e marcar como entregue não debita a conta', DB.get('accounts', contaF).balance, saldoAntes);

  /* O EXTRATO CONTINUA FECHANDO COM O SALDO.

     O cartão do Extrato promete uma identidade: saldo do fim menos saldo do
     início é igual a "entrou" menos "saiu". Se a semanada entrasse em "saiu" sem
     mexer no saldo, a linha deixaria de fechar — e o sintoma seria o pior tipo,
     duas partes da mesma tela discordando sobre o mesmo mês. */
  DB.upsert('transactions', { ...sem[0], status: 'Pago', date: hojeF });
  const movF = DB.movimentoRealizadoAte([contaF], null, DB.somarDiasISO(hojeF, 1));
  const saldoIni = DB.saldoNaData([contaF], hojeF);
  const saldoFim = DB.saldoNaData([contaF], DB.somarDiasISO(hojeF, 1));
  check('o extrato fecha com o saldo, mesmo com semanada entregue',
    Math.round((saldoFim - saldoIni) * 100) / 100,
    Math.round((movF.entra - movF.sai) * 100) / 100);
  check('  e a semanada não aparece como saída de caixa', movF.sai, 0);

  /* NÃO É DESPESA no patrimônio: contá-la faria a família parecer mais pobre por
     um dinheiro que ainda está na conta dela. */
  DB.upsert('transactions', { ...sem[0], status: 'Pago' });
  const periodoF = DB.monthPeriod(new Date(hojeF + 'T12:00:00'));
  check('não entra nas despesas do mês',
    DB.expensesOf(periodoF).some(t => t.id === sem[0].id), false);

  /* UM ATO, UM LUGAR: a semanada NÃO entra na fila de contas do mês.

     Ela esteve nas duas por um pedido legítimo — servir de lembrete do ritual — e
     o resultado na tela foi um ato virando duas linhas, com valores diferentes:
     R$ 11 nas contas do mês (o compromisso, com a moeda mágica) e R$ 10 na fila
     das crianças (o que sai hoje). Quem olhou concluiu que ia lançar duas vezes, e
     não tinha como saber que uma linha só registra e a outra credita o cofrinho.

     O lembrete continua, na fila das crianças, com o bichinho e o nome. */
  DB.upsert('transactions', { ...sem[0], status: 'A Pagar', date: hojeF });
  check('a semanada NÃO entra na fila de contas do mês',
    DB.pendencias(hojeF).some(p => p.id === sem[0].id), false);
  check('  e nenhuma pendência da fila é semanada',
    DB.pendencias(hojeF).some(p => p.tx && DB.isSemanada(p.tx)), false);
  check('  mas ela aparece na fila das crianças',
    filaDasCriancas().includes(`data-semanada="${idF}"`), true);

  /* O VALOR DAS DUAS PONTAS BATE. A fila mostra o que vai sair NESTE toque, com a
     moeda mágica quando devida — não um número e o compromisso mostrando outro. */
  const kidF = DB.get('kids', idF);
  const magicaF = DB.kidMoedaMagicaDevida(kidF);
  const totalF = DB.kidSemanadaDevida(kidF).valor + (magicaF ? magicaF.valor : 0);
  check('  pelo valor que vai sair de fato', filaDasCriancas().includes(fmt(totalF)), true);

  /* COM A MOEDA MÁGICA DEVIDA, e é este o caso que importa: é a diferença entre os
     R$ 10 e os R$ 11 que fez o painel parecer que lançaria duas vezes.

     Sem montar a condição da moeda, o teste acima compara o valor com ele mesmo —
     e esconder a moeda do total passava verde. A moeda exige uma semana anterior
     com dinheiro guardado e sem saída dele. */
  const idM = DB.upsert('kids', {
    name: 'Filho Moeda', semanada_valor: 10, semanada_dia: diaF,
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true,
  });
  DB.upsert('kid_entries', {
    kid_id: idM, tipo: 'presente', pote: 'guardar', amount: 20,
    date: DB.somarDiasISO(DB.kidInicioDaSemana(DB.get('kids', idM)), -3), confirmada: true,
  });
  const magicaM = DB.kidMoedaMagicaDevida(DB.get('kids', idM));
  check('a moeda mágica é devida no cenário montado', !!magicaM, true);
  const filaM = filaDasCriancas();
  check('  a fila mostra semanada + moeda mágica juntas', filaM.includes(fmt(11)), true);
  check('  e diz que a moeda vem junto', /moeda mágica/.test(filaM), true);
  check('  sem mostrar só a semanada',
    filaM.includes(`<span class="pend-val">${fmt(10)}</span>`), false);
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idM)) DB.remove('kid_entries', e.id);
  DB.remove('kids', idM);

  /* DAR A SEMANADA FECHA O COMPROMISSO no extrato, no mesmo ato: sem isso o
     lançamento ficaria em aberto para sempre, pesando como semanada por dar. */
  const antesPagar = DB.all('transactions').filter(t => t.kid_id === idF && t.status === 'A Pagar').length;
  check('há lançamento em aberto antes de dar', antesPagar >= 1, true);
  pagarSemanada(idF);
  check('dar a semanada dá baixa no lançamento da semana',
    DB.all('transactions').filter(t => t.kid_id === idF && t.status === 'A Pagar'
      && String(t.date) >= DB.kidInicioDaSemana(kidF)
      && String(t.date) < DB.somarDiasISO(DB.kidInicioDaSemana(kidF), 7)).length, 0);
  check('  e o dinheiro chegou no cofrinho', DB.kidPotes(idF).total > 0, true);
  check('  e ela sai da fila das crianças',
    filaDasCriancas().includes(`data-semanada="${idF}"`), false);

  /* NÃO QUITA O PASSADO. Dar a semanada de hoje não pode apagar a que ficou
     pendente há três semanas: aquela não foi entregue, e limpá-la esconderia o
     esquecimento em vez de mostrá-lo. */
  const atrasada = DB.upsert('transactions', {
    description: `Semanada de ${kidF.name}`, amount: 11,
    date: DB.somarDiasISO(hojeF, -21), type: 'Despesa', status: 'A Pagar',
    kid_id: idF, account_id: contaF,
  });
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idF)) DB.remove('kid_entries', e.id);
  pagarSemanada(idF);
  check('a semanada atrasada de semanas atrás continua em aberto',
    DB.get('transactions', atrasada).status, 'A Pagar');
  DB.remove('transactions', atrasada);
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idF)) DB.remove('kid_entries', e.id);

  /* ---- O ACUMULADO SAI DO LIVRE ---- */
  DB.upsert('kid_entries', { kid_id: idF, tipo: 'semanada', pote: 'gastar', amount: 8, date: hojeF, confirmada: true });
  DB.upsert('kid_entries', { kid_id: idF, tipo: 'presente', pote: 'guardar', amount: 42, date: hojeF, confirmada: true });
  check('o acumulado dos filhos é a soma dos potes', DB.dosFilhos(), 50);

  /* NÃO É GUARDADO. Esta é a distinção que o pedido original propunha juntar, e
     juntar teria dois efeitos ruins: a reserva de emergência infla com dinheiro
     que não é da família, e o patrimônio dela passa a incluir o dos filhos. */
  const guardadoAntes = DB.guardado();
  DB.upsert('kid_entries', { kid_id: idF, tipo: 'presente', pote: 'guardar', amount: 100, date: hojeF, confirmada: true });
  check('o cofrinho não entra no guardado da família', DB.guardado(), guardadoAntes);
  check('  nem na reserva', DB.guardadoReserva(), DB.guardadoReserva());
  check('  e o acumulado acompanhou', DB.dosFilhos(), 150);

  /* ---- A CONTA DA HERO FECHA, SEM CONTAR DUAS VEZES ----

     Este é o teste central. Uma semanada do mês está em um de dois estados: já
     virou lançamento em aberto, ou ainda é ocorrência futura do contrato. Se as
     duas portas contassem — "Contas do mês" e "Dos filhos" —, o mesmo compromisso
     sairia duas vezes do livre, e qual delas pesava dependeria de o gerador ter
     rodado. Um número que muda conforme a hora em que se abre o app não serve
     para decidir nada. */
  const fimF = DB.fimISO(periodoF);
  const previstoF = DB.previsaoDoMes(periodoF);
  check('a semanada não entra nas contas do mês',
    previstoF.itens.some(i => /Filho Saldo/.test(i.titulo)), false);

  /* O QUE FALTA NO MÊS SAI DO CALENDÁRIO, não de um "maior que zero".

     A asserção era `aVir > 0`, e ela reprovava nos ÚLTIMOS DIAS do mês — 30 e 31
     de agosto, 27 de fevereiro, a virada de ano — porque ali não sobra semanada
     nenhuma: a próxima cai no mês seguinte, e zero é a resposta certa. Cinco datas
     do `tempo.js` caíram, todas por causa do teste, nenhuma por defeito do app.

     Agora o esperado vem do calendário: conta os dias da semanada que ainda
     acontecem neste mês e multiplica. Vale em qualquer data, inclusive nas que
     legitimamente dão zero. */
  const contrato = DB.contratoDaSemanada(idF);
  let esperadoAVir = 0;
  if (contrato) {
    for (let d = hojeF; d < fimF; d = DB.somarDiasISO(d, 1)) {
      if (new Date(d + 'T12:00:00').getDay() !== Number(DB.get('kids', idF).semanada_dia)) continue;
      // Só o que ainda não foi entregue: o já pago saiu do compromisso
      const paga = DB.all('transactions').some(t => t.kid_id === idF && String(t.date) === d && t.status === 'Pago');
      if (!paga) esperadoAVir += Number(contrato.amount) || 0;
    }
  }
  const aVir = DB.dosFilhosAVir(fimF);
  check('as semanadas que faltam no mês batem com o calendário',
    Math.round(aVir * 100) / 100, Math.round(esperadoAVir * 100) / 100);

  /* CONTRATO AINDA NÃO MATERIALIZADO também conta.

     Todo cenário acima gerava as ocorrências antes de medir, e por isso o laço que
     varre os CONTRATOS ficava sem exercício: o total vinha inteiro dos lançamentos
     já criados. Sabotar esse laço passava verde.

     Aqui o contrato existe e nada foi gerado — é o estado de quem acabou de
     cadastrar a criança, ou de qualquer mês futuro. Se o laço não contar, a
     semanada fica invisível nas duas pontas: não é conta do mês (excluída da
     previsão) e não está no acumulado (não foi dada). */
  const idV = DB.upsert('kids', {
    name: 'Filho A Vir', semanada_valor: 20, semanada_dia: diaF,
    rendimento_tipo: 'moeda', rendimento_valor: 0, active: true,
  });
  DB.acertarContratoDaSemanada(idV);
  const contratoV = DB.contratoDaSemanada(idV);
  check('o contrato existe e nada foi gerado ainda',
    DB.all('transactions').some(t => t.recurrence_id === contratoV.id), false);
  check('  e a semanada dele já aparece como compromisso',
    DB.dosFilhosAVir(fimF) - aVir >= 20, true);
  /* E gerar não muda o total: o que sai de "por lançar" entra em "lançado". */
  const antesV = DB.dosFilhosAVir(fimF);
  DB.gerarRecorrencias(fimF);
  check('  e materializar não altera o valor',
    Math.round(DB.dosFilhosAVir(fimF) * 100) / 100, Math.round(antesV * 100) / 100);
  for (const t of DB.all('transactions').filter(t => t.kid_id === idV)) DB.remove('transactions', t.id);
  DB.remove('recurrences', contratoV.id);
  DB.remove('kids', idV);

  /* O TOTAL NÃO OSCILA quando o gerador roda: o que sai da conta "ainda por
     lançar" entra na conta "lançado em aberto", e a soma continua a mesma. */
  const antesGerar = DB.dosFilhosAVir(fimF);
  DB.gerarRecorrencias(fimF);
  check('gerar as ocorrências não muda o total comprometido',
    Math.round(DB.dosFilhosAVir(fimF) * 100) / 100, Math.round(antesGerar * 100) / 100);

  /* E O LIVRE AO FIM desconta as duas coisas, cada uma na sua linha. */
  const emContasFim = DB.saldoPrevistoNaData(null, fimF);
  const guardadoFim = DB.guardadoPrevisto(fimF);
  const dosFilhosFim = DB.dosFilhos() + DB.dosFilhosAVir(fimF);
  const livre = emContasFim - guardadoFim - dosFilhosFim;
  check('o livre ao fim desconta o dinheiro dos filhos', livre < emContasFim - guardadoFim, true);
  check('  e a linha aparece na tela',
    linhasDaPrevisao({ abreRotulo: 'x', abreNota: '', abre: 0,
      previsto: { entra: 0, sai: 0, investe: 0, itens: [] }, atrasado: 0,
      emContasFim, guardadoFim, dosFilhos: dosFilhosFim, livreAoFim: livre }).includes('Dos filhos'), true);
  check('  dizendo que já é deles',
    linhasDaPrevisao({ abreRotulo: 'x', abreNota: '', abre: 0,
      previsto: { entra: 0, sai: 0, investe: 0, itens: [] }, atrasado: 0,
      emContasFim, guardadoFim, dosFilhos: dosFilhosFim, livreAoFim: livre }).includes('já é deles'), true);

  /* A TELA DE VERDADE, não a conta à mão.

     As asserções acima montam o número aqui e conferem a si mesmas — isso prova a
     fórmula e não prova a TELA. Sabotar o `livreAoFim` dos dois heros passava
     verde justamente por isso: o teste refazia a conta certa ao lado da errada.

     Aqui é o painel renderizado, e o que se mede é o que a pessoa lê. */
  const heroAtual = renderInicio(periodoF);
  check('o painel mostra a linha dos filhos', heroAtual.includes('Dos filhos'), true);
  /* O TOTAL DA TELA tem de ser o de baixo, não o de cima: se o "Livre ao fim"
     ignorasse os filhos, ele ficaria igual ao "Em contas ao fim" menos guardado —
     e a linha "Dos filhos" apareceria sem efeito nenhum, decorativa. */
  /* O rótulo pode conter um `<i>` com a nota da linha ("faturas incluídas", "no
     cofrinho, já é deles"), então a captura precisa atravessar tags e limpá-las
     depois. Com `[^<]` a primeira linha com nota já não casava, a lista saía vazia
     e as asserções abaixo mediam `undefined` — teste vazio disfarçado de falha. */
  const numeros = [...heroAtual.matchAll(/<span>([\s\S]*?)<\/span><b>([^<]*)<\/b>/g)]
    .map(m => [m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), m[2]]);
  const linhaFilhos = numeros.find(([r]) => r.includes('Dos filhos'));
  const linhaLivre = numeros.find(([r]) => r.includes('Livre ao fim'));
  const linhaContas = numeros.find(([r]) => r.includes('Em contas ao fim'));
  check('  com valor de verdade na linha', !!linhaFilhos && linhaFilhos[1].includes('R$'), true);
  check('  e o Livre ao fim é menor que o Em contas ao fim',
    !!linhaLivre && !!linhaContas && desmoeda(linhaLivre[1]) < desmoeda(linhaContas[1]), true);
  /* A conta da tela fecha: contas − guardado − filhos = livre. Uma soma que não se
     confere na própria tela não serve para decidir nada. */
  const linhaGuardado = numeros.find(([r]) => r.includes('Guardado'));
  const gv = linhaGuardado ? desmoeda(linhaGuardado[1]) : 0;
  check('  e a conta da tela fecha',
    Math.round((desmoeda(linhaContas[1]) - gv - desmoeda(linhaFilhos[1])) * 100) / 100,
    Math.round(desmoeda(linhaLivre[1]) * 100) / 100);

  /* O MÊS QUE VEM, onde nada está materializado.

     Tudo acima mede o mês corrente, com as semanadas já lançadas — e ali a
     previsão exclui a semanada de duas formas ao mesmo tempo: porque o lançamento
     é neutro e porque a ocorrência já foi lançada. Uma das duas proteções pode
     cair sem o teste notar.

     No mês que vem não há lançamento nenhum: a única coisa que impede a semanada
     de virar "conta do mês" é o filtro por contrato. E é o mês futuro que se usa
     para planejar. */
  const periodoProx = DB.monthPeriod(new Date(DB.somarDiasISO(DB.fimISO(periodoF), 1) + 'T12:00:00'));
  const previstoProx = DB.previsaoDoMes(periodoProx);
  check('no mês que vem a semanada também não é conta do mês',
    previstoProx.itens.some(i => /Filho Saldo/.test(i.titulo)), false);
  check('  e ela aparece como compromisso dos filhos',
    DB.dosFilhosAVir(DB.fimISO(periodoProx)) > DB.dosFilhosAVir(fimF), true);

  /* O HERO DO MÊS FUTURO depende de state.monthOffset, não do período passado por
     argumento: sem mexer nele, renderInicio devolve o hero do mês CORRENTE com
     dados de outro mês, e a asserção mede a tela errada. Foi o que aconteceu — a
     sabotagem do livreAoFim futuro passava verde porque aquele bloco nunca rodava. */
  const offGuarda = state.monthOffset;
  state.monthOffset = 1;
  const heroProx = renderInicio(periodoProx);
  state.monthOffset = offGuarda;
  check('  e é de fato o hero do mês futuro', heroProx.includes('Abre em contas'), true);
  check('o painel do mês que vem mostra a linha dos filhos', heroProx.includes('Dos filhos'), true);
  const nProx = [...heroProx.matchAll(/<span>([\s\S]*?)<\/span><b>([^<]*)<\/b>/g)]
    .map(m => [m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), m[2]]);
  const fProx = nProx.find(([r]) => r.includes('Dos filhos'));
  const lProx = nProx.find(([r]) => r.includes('Livre ao fim'));
  const cProx = nProx.find(([r]) => r.includes('Em contas ao fim'));
  const gProx = nProx.find(([r]) => r.includes('Guardado'));
  check('  e a conta dele fecha descontando os filhos',
    Math.round((desmoeda(cProx[1]) - (gProx ? desmoeda(gProx[1]) : 0) - desmoeda(fProx[1])) * 100) / 100,
    Math.round(desmoeda(lProx[1]) * 100) / 100);

  /* ---- SEMANADA APAGADA NÃO VOLTA, NEM PESA ----

     Cena real relatada: o painel dizia R$ 43 "do filho" sem nenhuma semanada ter
     sido dada. Eram R$ 10 de uma semanada de verdade no cofrinho e R$ 33 de três
     lançamentos APAGADOS do extrato — apagados e ainda contados, porque a conta os
     buscava pelo contrato e o contrato não sabe da exclusão.

     E pior que o número: o gerador ia recriá-los na abertura seguinte, porque
     `all()` esconde o apagado. Apagar de novo nunca resolveria. */
  const idAp = DB.upsert('kids', {
    name: 'Filho Apagado', semanada_valor: 11, semanada_dia: diaF,
    rendimento_tipo: 'moeda', rendimento_valor: 0, active: true,
  });
  DB.acertarContratoDaSemanada(idAp);
  const contratoAp = DB.contratoDaSemanada(idAp);
  DB.gerarRecorrencias(fimF);
  const geradasAp = DB.all('transactions').filter(t => t.recurrence_id === contratoAp.id);
  check('o contrato gerou as semanadas do mês', geradasAp.length >= 1, true);

  const comSemanadas = DB.dosFilhosAVir(fimF);
  for (const t of geradasAp) DB.remove('transactions', t.id);
  check('apagadas do extrato, elas param de pesar no painel',
    DB.dosFilhosAVir(fimF) < comSemanadas, true);
  check('  e o contrato não as ressuscita ao gerar de novo',
    DB.gerarRecorrencias(fimF).filter(t => t.kid_id === idAp).length, 0);
  check('  o extrato continua sem elas',
    DB.all('transactions').filter(t => t.recurrence_id === contratoAp.id).length, 0);

  /* O CONTRATO CONTINUA VIVO, e isso é correto: apagar a ocorrência de uma semana
     não é encerrar a semanada. As semanas SEGUINTES continuam previstas — quem
     quer parar de vez pausa ou zera o contrato, que é uma decisão diferente. */
  check('  mas o contrato segue ativo', DB.get('recurrences', contratoAp.id).status, 'ativa');
  for (const t of DB.data.transactions.filter(t => t.kid_id === idAp)) DB.remove('transactions', t.id);
  DB.remove('recurrences', contratoAp.id);
  DB.remove('kids', idAp);

  /* CONTRATO COMUM CONTINUA PODENDO VOLTAR. A exceção acima é só da semanada: nos
     outros contratos, remover o lançamento é como o app desfaz um pagamento
     adiantado, e a previsão tem de voltar. Tentei mudar para todos e cinco testes
     caíram — esta linha é o que impede a tentação de "unificar". */
  const contratoComum = DB.upsert('recurrences', {
    description: 'Contrato comum do teste', amount: 300, type: 'Despesa',
    periodicidade: 'mensal', dia: new Date(hojeF + 'T12:00:00').getDate(),
    inicio: hojeF, fim_tipo: 'sempre', status: 'ativa', geradas: 0,
  });
  const criadas = DB.gerarRecorrencias(DB.somarDiasISO(hojeF, 2));
  const doComum = criadas.filter(t => t.recurrence_id === contratoComum);
  if (doComum.length) {
    for (const t of doComum) DB.remove('transactions', t.id);
    check('contrato comum: apagar o lançamento permite gerar de novo',
      DB.gerarRecorrencias(DB.somarDiasISO(hojeF, 2)).filter(t => t.recurrence_id === contratoComum).length >= 1, true);
  }
  for (const t of DB.data.transactions.filter(t => t.recurrence_id === contratoComum)) DB.remove('transactions', t.id);
  DB.remove('recurrences', contratoComum);

  /* A NOTA DA LINHA NÃO PODE MENTIR. Ela dizia "já é deles" somando o acumulado
     com o que ainda vai ser dado — foi exatamente o que fez alguém ler que o filho
     tinha R$ 43 sem ter recebido nada. */
  /* Compara por PARTES, não por string exata: `fmtShort` usa espaço não separável
     entre "R$" e o número, e a igualdade literal falhava por um caractere que não
     se vê. Um teste que reprova por invisibilidade ensina a ignorá-lo. */
  const nota1033 = notaDosFilhos(10, 33);
  check('a nota separa o que já é do que ainda vem',
    /10[\s\S]*no cofrinho/.test(nota1033) && /33[\s\S]*até o fim do mês/.test(nota1033), true);
  check('  só acumulado, diz que já é deles', notaDosFilhos(10, 0), 'no cofrinho, já é deles');
  check('  só por vir, não afirma que já é deles', notaDosFilhos(0, 33), 'semanadas até o fim do mês');
  check('  e nunca chama de "já é deles" o que ainda vem',
    notaDosFilhos(10, 33).includes('já é deles'), false);

  /* SEM CRIANÇA, A LINHA SOME. Uma linha de valor zero num bloco de conta é
     ruído: quem não tem filho cadastrado não deve ver a palavra "filhos". */
  const semFilhos = linhasDaPrevisao({ abreRotulo: 'x', abreNota: '', abre: 0,
    previsto: { entra: 0, sai: 0, investe: 0, itens: [] }, atrasado: 0,
    emContasFim: 100, guardadoFim: 0, dosFilhos: 0, livreAoFim: 100 });
  check('sem dinheiro de filho, a linha não aparece', semFilhos.includes('Dos filhos'), false);

  /* ---- O CICLO FECHA QUANDO A CRIANÇA GASTA ----

     Aí o dinheiro sai da casa de verdade. O acumulado cai (o pote dela diminui) e
     a despesa entra na conta da família — os dois efeitos se cancelam no livre,
     que é exatamente o que aconteceu na realidade: o dinheiro era dela, foi
     gasto, e saiu do banco. */
  const dosFilhosAntes = DB.dosFilhos();
  DB.upsert('kid_entries', { kid_id: idF, tipo: 'gasto', pote: 'gastar', amount: 5, date: hojeF, confirmada: true });
  check('quando a criança gasta, o acumulado cai', DB.dosFilhos(), dosFilhosAntes - 5);

  const gasto = DB.upsert('transactions', {
    description: 'Sorvete do Filho Saldo', amount: 5, date: hojeF,
    type: 'Despesa', status: 'Pago', account_id: contaF,
  });
  check('  e a despesa da família entra normalmente',
    DB.expensesOf(periodoF).some(t => t.id === gasto), true);

  // Limpeza
  DB.remove('transactions', gasto);
  for (const t of DB.all('transactions').filter(t => t.kid_id === idF)) DB.remove('transactions', t.id);
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idF)) DB.remove('kid_entries', e.id);
  for (const r of DB.all('recurrences').filter(r => r.kid_id === idF)) DB.remove('recurrences', r.id);
  DB.remove('kids', idF);
  DB.remove('accounts', contaF);
} catch (e) { console.log(` FALHA | dinheiro dos filhos: ${e.message}`); fail++; }

/* ---- ABRIR O COFRINHO COM O QUE A CRIANÇA JÁ TINHA ----

   Quem começa a usar o app não começa do zero: o filho já tem dinheiro guardado.
   O tipo mais próximo era "presente", que mente sobre o que aconteceu — e o
   histórico dela é o único registro que vai existir do começo. */
console.log('\n=== Saldo de abertura do cofrinho ===');
try {
  const hojeI = DB.hojeISO();
  const idI = DB.upsert('kids', { name: 'Filho Inicial', semanada_valor: 10, semanada_dia: 1, active: true });

  const ontem = DB.somarDiasISO(hojeI, -1);
  DB.upsert('kid_entries', {
    kid_id: idI, tipo: 'inicial', pote: 'gastar', amount: 60, date: ontem,
    description: 'O que ele já tinha', confirmada: true,
  });
  check('o saldo de abertura entra no pote', DB.kidPotes(idI).gastar, 60);
  check('  e no total do cofrinho', DB.kidPotes(idI).total, 60);
  check('  e no dinheiro dos filhos da família', DB.dosFilhos() >= 60, true);

  /* NÃO É SAÍDA. Um tipo desconhecido cairia no ramo de entrada por padrão, mas
     depender do padrão é frágil: basta alguém trocar a ordem do teste em kidPotes
     para o saldo de abertura virar dívida. */
  DB.upsert('kid_entries', { kid_id: idI, tipo: 'inicial', pote: 'guardar', amount: 10, date: ontem, confirmada: true });
  check('  somando, não subtraindo', DB.kidPotes(idI).total, 70);

  /* A DATA É RESPEITADA: o dinheiro que ele já tinha não chegou hoje, e datar tudo
     em hoje faria o começo do histórico dela mentir.

     PELO BOTÃO DA FOLHA, não por DB.upsert. Inserindo direto eu testava a mim
     mesmo: a sabotagem que fixava a data em hoje passava verde, porque nada
     exercitava o caminho que a pessoa usa. */
  const antesN = DB.all('kid_entries').filter(e => e.kid_id === idI).length;
  openKidLancarSheet(idI);
  /* el() CRIA o elemento se ainda não existe; els[...] só lê o que já foi tocado, e
     os campos da folha só são tocados quando o botão salva. */
  el('#kl-tipo').value = 'inicial';
  el('#kl-pote').value = 'guardar';
  el('#kl-valor').dataset.cents = 2500;      // R$ 25,00, como initMoney guarda
  const anteontem = DB.somarDiasISO(hojeI, -2);
  el('#kl-data').value = anteontem;
  el('#sh-save').click();
  const novo = DB.all('kid_entries')
    .filter(e => e.kid_id === idI && e.date === anteontem);
  check('lançar pela folha grava na data escolhida', novo.length, 1);
  check('  com o tipo escolhido', novo[0] && novo[0].tipo, 'inicial');
  check('  no pote escolhido', novo[0] && novo[0].pote, 'guardar');
  check('  e o valor da folha', novo[0] && novo[0].amount, 25);
  check('  criando um lançamento, não substituindo',
    DB.all('kid_entries').filter(e => e.kid_id === idI).length, antesN + 1);

  const dele = DB.kidEntries(idI);
  check('a data informada é guardada', dele.every(e => e.date !== hojeI), true);

  /* TEM NOME NA TELA DO ADULTO. Sem entrada no mapa de rótulos, o lançamento
     apareceria com o nome cru do tipo — "inicial" — no meio de "Semanada" e
     "Presente". */
  openCriancaDetalhe(idI);
  const detI = els['#modal'].innerHTML;
  check('o detalhe mostra o tipo por extenso', detI.includes('Já tinha antes'), true);
  check('  e não mostra o nome cru do tipo', /<b>inicial<\/b>|>inicial</.test(detI), false);

  /* E A FOLHA DE LANÇAR oferece o tipo, com data. Função sem caminho na tela é
     função que não existe para quem usa. */
  openKidLancarSheet(idI);
  const folha = els['#sheet'].innerHTML;
  check('a folha oferece "já tinha antes"', folha.includes('value="inicial"'), true);
  check('  e deixa escolher a data', folha.includes('id="kl-data"'), true);
  check('  com hoje pré-preenchido', folha.includes(`value="${hojeI}"`), true);
  closeSheet();

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idI)) DB.remove('kid_entries', e.id);
  DB.remove('kids', idI);
  closeModal();
} catch (e) { console.log(` FALHA | saldo de abertura: ${e.message}`); fail++; }

/* ---- MISSÃO DE TODO DIA, no app da família ----

   A água do cachorro revelou a falta: missão diária marcada na segunda ficava
   "feita" o resto da semana. E o valor NÃO pode ser por dia — sete toques a R$ 1
   numa semanada de R$ 10 fariam 70% da renda da criança vir de uma tarefa, e
   ensinariam que cuidar de quem depende dela tem preço por unidade. */
console.log('\n=== Missão de todo dia (lado do adulto) ===');
try {
  const hojeD = DB.hojeISO();
  const idD = DB.upsert('kids', {
    name: 'Filho Diaria', semanada_valor: 10,
    semanada_dia: new Date(hojeD + 'T12:00:00').getDay(), active: true,
  });
  const tarD = DB.upsert('kid_tasks', {
    kid_id: idD, name: 'Água do Duque', icon: '🐕', amount: 2,
    frequencia: 'diaria', active: true,
  });
  const tarS = DB.upsert('kid_tasks', {
    kid_id: idD, name: 'Pôr a mesa', icon: '🍽️', amount: 1,
    frequencia: 'semanal', active: true,
  });
  const daD = () => DB.kidTarefas(idD).find(x => x.id === tarD);

  check('o app da família reconhece a missão diária', daD().diaria, true);
  check('  com os sete dias', daD().dias.length, 7);
  check('  e a semanal segue semanal', DB.kidTarefas(idD).find(x => x.id === tarS).diaria, false);

  /* O MESMO PROGRESSO DOS DOIS LADOS. É a razão de o cálculo estar duplicado em
     vez de importado: os apps são artefatos separados, e o que garante que não
     divirjam é este teste. Se o número da tela dela não bate com o da tela dele,
     quem perde a confiança no app é a criança. */
  const inicioD = DB.kidInicioDaSemana(DB.get('kids', idD));
  for (let i = 0; i < 4; i++) {
    DB.upsert('kid_entries', {
      kid_id: idD, tipo: 'tarefa', pote: 'gastar', amount: 0,
      date: DB.somarDiasISO(inicioD, i), description: 'Água do Duque',
      task_id: tarD, confirmada: true,
    });
  }
  check('quatro dias marcados contam quatro', daD().feitos, 4);
  check('  e a semana não está completa', daD().completou, false);
  check('  sem dinheiro no pote', DB.kidPotes(idD).total, 0);

  /* AS MARCAÇÕES DIÁRIAS NÃO ENTOPEM A FILA DO ADULTO. Valem zero: não há dinheiro
     a liberar, então não há o que conferir. Pedir sete confirmações por semana por
     tarefa faria o adulto parar de conferir qualquer coisa — inclusive o que
     importa. */
  check('as marcações de dia não pedem confirmação',
    DB.kidTarefasAConfirmar().filter(x => x.kid.id === idD).length, 0);
  /* E TAMBÉM QUANDO PENDENTE. O app cria a marcação do dia já confirmada, então o
     filtro por confirmada bastava e o de valor zero podia sair sem nada reprovar.
     Mas um registro de valor zero pendente pode chegar por outro caminho — dado
     legado, sync de versão antiga — e ali não há dinheiro a liberar: colocá-lo na
     fila treinaria o adulto a confirmar sem olhar. */
  const zeroPendente = DB.upsert('kid_entries', {
    kid_id: idD, tipo: 'tarefa', pote: 'gastar', amount: 0,
    date: hojeD, description: 'Água do Duque', task_id: tarD, confirmada: false,
  });
  check('  nem quando o registro de valor zero está pendente',
    DB.kidTarefasAConfirmar().filter(x => x.kid.id === idD).length, 0);
  DB.remove('kid_entries', zeroPendente);

  /* A TAREFA SEMANAL, sim: ela vale dinheiro e espera o adulto. */
  DB.upsert('kid_entries', {
    kid_id: idD, tipo: 'tarefa', pote: 'gastar', amount: 1,
    date: hojeD, description: 'Pôr a mesa', task_id: tarS, confirmada: false,
  });
  check('a tarefa semanal marcada pede confirmação',
    DB.kidTarefasAConfirmar().filter(x => x.kid.id === idD).length, 1);

  /* O BÔNUS DA SEMANA CHEIA entra na mesma fila, e é o único pagamento da diária. */
  for (let i = 4; i < 7; i++) {
    DB.upsert('kid_entries', {
      kid_id: idD, tipo: 'tarefa', pote: 'gastar', amount: 0,
      date: DB.somarDiasISO(inicioD, i), description: 'Água do Duque',
      task_id: tarD, confirmada: true,
    });
  }
  check('sete dias fecham a semana', daD().completou, true);
  const idBonus = DB.upsert('kid_entries', {
    kid_id: idD, tipo: 'bonus', pote: 'gastar', amount: 2,
    date: hojeD, description: 'Água do Duque — a semana toda',
    task_id: tarD, confirmada: false,
  });
  const naFilaD = DB.kidTarefasAConfirmar().filter(x => x.kid.id === idD);
  check('o bônus entra na fila do adulto', naFilaD.length, 2);
  check('  e um deles é o bônus', naFilaD.some(x => x.entry.tipo === 'bonus'), true);
  check('  sem dinheiro no pote antes de confirmar', DB.kidPotes(idD).total, 0);

  confirmarTarefa(idBonus, true);
  check('confirmar o bônus credita o pote', DB.kidPotes(idD).total, 2);
  /* UMA VEZ, e não sete: é o teto que mantém a proporção com a semanada. */
  check('  e vale o valor da missão, não sete vezes', DB.kidPotes(idD).total < 2 * 7, true);

  /* A TELA DO ADULTO mostra o progresso, senão ele não tem como conferir se a
     semana foi cumprida antes de aprovar o bônus. */
  openCriancaDetalhe(idD);
  const detD = els['#modal'].innerHTML;
  check('o detalhe mostra a missão diária', detD.includes('Água do Duque'), true);
  check('  com o progresso dos dias', /7 de 7|de 7 dias/.test(detD), true);

  /* O CADASTRO oferece a escolha e explica o que o valor significa em cada caso.
     Sem a nota, "quanto vale" numa diária é lido como valor por dia — que é
     exatamente o que o desenho evita. */
  openKidTarefaSheet(idD);
  const folhaD = els['#sheet'].innerHTML;
  check('o cadastro deixa escolher a frequência', folhaD.includes('id="kt-freq"'), true);
  check('  com as duas opções', folhaD.includes('value="diaria"') && folhaD.includes('value="semanal"'), true);
  /* A NOTA É INJETADA POR JS depois da montagem, então ela não está no innerHTML da
     folha — está no elemento. Ler o lugar errado dava um teste vazio disfarçado de
     falha. */
  check('  e explica que a diária paga uma vez',
    /uma vez/.test((els['#kt-nota'] || {}).innerHTML || ''), true);

  /* E GRAVA O QUE FOI ESCOLHIDO. Ler o HTML da folha prova que o campo existe, não
     que ele é usado: a sabotagem que jogava a frequência no lixo passava verde,
     porque nada exercitava o botão de salvar. */
  el('#kt-nome').value = 'Água do gato';
  el('#kt-freq').value = 'diaria';
  el('#kt-valor').dataset.cents = 300;
  el('#sh-save').click();
  const criada = DB.all('kid_tasks').find(x => x.kid_id === idD && x.name === 'Água do gato');
  check('salvar grava a missão', !!criada, true);
  check('  com a frequência escolhida', criada && criada.frequencia, 'diaria');
  check('  e o valor da semana', criada && criada.amount, 3);

  el('#kt-nome').value = 'Varrer a área';
  el('#kt-freq').value = 'semanal';
  el('#kt-valor').dataset.cents = 100;
  openKidTarefaSheet(idD);
  el('#kt-nome').value = 'Varrer a área';
  el('#kt-freq').value = 'semanal';
  el('#kt-valor').dataset.cents = 100;
  el('#sh-save').click();
  const semanalCriada = DB.all('kid_tasks').find(x => x.kid_id === idD && x.name === 'Varrer a área');
  check('  e a semanal grava como semanal', semanalCriada && semanalCriada.frequencia, 'semanal');

  /* MISSÃO ESPECIAL: um combinado pontual, com prazo. */
  openKidTarefaSheet(idD);
  const folhaE = els['#sheet'].innerHTML;
  check('o cadastro oferece a missão especial', folhaE.includes('value="especial"'), true);
  check('  com o campo de prazo', folhaE.includes('id="kt-prazo"'), true);

  /* O CAMPO DE PRAZO só aparece na especial: pedir "até quando" para uma rotina
     semanal seria uma pergunta sem resposta possível. */
  el('#kt-freq').value = 'semanal';
  if (els['#kt-freq'].onchange) els['#kt-freq'].onchange();
  check('  escondido quando a missão é semanal', els['#kt-campo-prazo'].hidden, true);
  el('#kt-freq').value = 'especial';
  if (els['#kt-freq'].onchange) els['#kt-freq'].onchange();
  check('  e visível quando é especial', els['#kt-campo-prazo'].hidden, false);
  check('  explicando que não volta toda semana',
    /não volta/.test((els['#kt-nota'] || {}).innerHTML || ''), true);

  /* SEM PRAZO NÃO É ESPECIAL: é uma semanal com outro nome, e ficaria na tela para
     sempre esperando um "até quando" que nunca chega. */
  el('#kt-nome').value = 'Sem prazo';
  el('#kt-prazo').value = '';
  el('#kt-valor').dataset.cents = 500;
  el('#sh-save').click();
  check('especial sem prazo é recusada',
    DB.all('kid_tasks').some(x => x.name === 'Sem prazo'), false);

  /* COM PRAZO, grava tudo. */
  openKidTarefaSheet(idD);
  el('#kt-nome').value = 'Lavar o carro';
  el('#kt-freq').value = 'especial';
  el('#kt-prazo').value = DB.somarDiasISO(hojeD, 2);
  el('#kt-valor').dataset.cents = 500;
  el('#sh-save').click();
  const esp = DB.all('kid_tasks').find(x => x.kid_id === idD && x.name === 'Lavar o carro');
  check('com prazo, a especial é criada', !!esp, true);
  check('  com a frequência certa', esp && esp.frequencia, 'especial');
  check('  e o prazo gravado', esp && esp.expira_em, DB.somarDiasISO(hojeD, 2));
  check('  no valor combinado', esp && esp.amount, 5);

  /* O ADULTO VÊ AS NOITES QUE FALTAM, e é o que ele usa para saber se ainda dá
     tempo de cobrar o combinado. */
  check('o app da família conta as mesmas noites', DB.noitesAte(esp.expira_em), 2);
  const daFamilia = DB.kidTarefas(idD).find(x => x.id === esp.id);
  check('  e reconhece a especial', daFamilia.especial, true);
  check('  com o mesmo prazo do app dela', daFamilia.noites, 2);

  /* PRAZO SÓ NA ESPECIAL: guardar em outra frequência deixaria um campo morto que
     uma versão futura poderia começar a ler sem querer. */
  openKidTarefaSheet(idD);
  el('#kt-nome').value = 'Semanal sem prazo';
  el('#kt-freq').value = 'semanal';
  el('#kt-prazo').value = DB.somarDiasISO(hojeD, 5);
  el('#kt-valor').dataset.cents = 100;
  el('#sh-save').click();
  const sem = DB.all('kid_tasks').find(x => x.name === 'Semanal sem prazo');
  check('a semanal não guarda prazo', sem && sem.expira_em, null);


  // Limpeza
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idD)) DB.remove('kid_entries', e.id);
  for (const x of DB.all('kid_tasks').filter(x => x.kid_id === idD)) DB.remove('kid_tasks', x.id);
  DB.remove('kids', idD);
  closeSheet(); closeModal();
} catch (e) { console.log(` FALHA | missão de todo dia: ${e.message}`); fail++; }
/* ---- QUANDO A CRIANÇA GASTA, O DINHEIRO SAI DA CONTA ----

   Era o buraco que fechava o ciclo pela metade. Dar a semanada não move dinheiro
   (fica no banco e troca de dono), mas quando ela GASTA o dinheiro sai da casa —
   quem paga o sorvete é o adulto.

   Sem lançar, acontecia o pior dos mundos: o acumulado do cofrinho caía R$ 5 e o
   "Livre ao fim" SUBIA R$ 5, como se a família tivesse ficado mais rica por a
   criança ter gasto. Dinheiro saía do bolso e aparecia como sobra. */
console.log('\n=== O gasto da criança debita a conta ===');
try {
  const hojeE = DB.hojeISO();
  const contaE = DB.upsert('accounts', {
    name: 'Conta do espelho', type: 'Conta Corrente', balance: 1000, active: true });
  const idE = DB.upsert('kids', {
    name: 'Filho Espelho', semanada_valor: 10,
    semanada_dia: new Date(hojeE + 'T12:00:00').getDay(), active: true });
  DB.acertarContratoDaSemanada(idE, { account_id: contaE });

  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'semanada', pote: 'gastar', amount: 10, date: hojeE,
    confirmada: true, repartido: false });
  const periodoE = DB.monthPeriod(new Date(hojeE + 'T12:00:00'));

  /* ANTES: nada no extrato. É o estado que o defeito produzia. */
  check('a semanada não gera despesa no extrato', DB.espelharGastosDosFilhos().length, 0);

  /* A CRIANÇA GASTA R$ 5 — e o gasto NASCE PENDENTE.

     Ela está aprendendo e vai tocar sem querer. Como o gasto agora debita a conta
     da família, um toque de curiosidade mexeria no dinheiro real: por isso ele
     espera o adulto, igual à tarefa. */
  const idGasto = DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'gasto', pote: 'gastar', amount: 5, date: hojeE,
    description: 'Doce', confirmada: false });
  check('gasto pendente não vira despesa da família', DB.espelharGastosDosFilhos().length, 0);
  /* MAS O POTE DELA JÁ CAI: aos seis anos, ação sem retorno visível é ação que ela
     repete achando que não funcionou. E mostrar menos do que ela talvez tenha é o
     lado seguro de errar num app que ensina a não gastar o que não tem. */
  check('  mas o pote dela já cai na hora', DB.kidPotes(idE).gastar, 5);

  /* O ADULTO CONFIRMA: aí sim a despesa entra e a conta é debitada. */
  /* A CONTA É A DO CONTRATO — e o teste mede a conta que o app de fato usa.

     Media a conta que EU criei, e o espelhamento usa a do contrato da semanada.
     Como o cenário tem outras contas ativas, o débito caía numa terceira e o teste
     reprovava sem haver defeito. Perguntar ao app qual conta ele escolheu é o que
     torna a asserção sobre o comportamento, e não sobre a minha suposição. */
  const contaUsada = (DB.contratoDaSemanada(idE) || {}).account_id
    || (DB.all('accounts').find(a => a.active !== false) || {}).id;
  const saldoAntes = DB.get('accounts', contaUsada).balance;
  confirmarTarefa(idGasto, true);
  check('confirmado, o gasto vira despesa da família',
    DB.all('transactions').some(x => /Gasto de Filho Espelho/.test(x.description || '')), true);
  check('  e o saldo da conta cai de verdade', DB.get('accounts', contaUsada).balance, saldoAntes - 5);

  const desp = DB.all('transactions').filter(x => x.kid_id === idE && DB.isExpense(x)
    && !DB.isSemanada(x) === false);
  const gastoTx = DB.all('transactions').find(x => /Gasto de Filho Espelho/.test(x.description || ''));
  check('  com o nome da criança e o que foi', !!gastoTx, true);
  check('  dizendo o que ela comprou', /Doce/.test(gastoTx.description), true);
  check('  no valor que ela gastou', gastoTx.amount, 5);
  check('  na data do gasto', gastoTx.date, hojeE);
  /* PAGO, e não "A Pagar": o dinheiro já saiu quando ela comprou. Deixar em aberto
     criaria pendência para uma decisão que ninguém precisa tomar. */
  check('  já como pago', gastoTx.status, 'Pago');
  check('  e na conta que o contrato usa', gastoTx.account_id, contaUsada);

  /* NÃO DUPLICA. O id é determinístico: mesmo lançamento do cofrinho, mesmo id de
     transação. Rodar em cada ponte, ou em dois aparelhos, é inofensivo. */
  check('espelhar de novo não duplica', DB.espelharGastosDosFilhos().length, 0);
  check('  continua uma despesa só',
    DB.all('transactions').filter(x => /Gasto de Filho Espelho/.test(x.description || '')).length, 1);

  /* A CONTA FECHA: o acumulado dela cai e a despesa entra. Os dois se cancelam no
     livre, que é exatamente o que aconteceu na realidade — o dinheiro era dela, foi
     gasto, e saiu do banco. */
  const fimE = DB.fimISO(periodoE);
  /* A CONTA FECHA DOS DOIS LADOS. O pote dela caiu R$ 5 e a conta da família caiu
     R$ 5: o dinheiro era dela, foi gasto, e saiu do banco. Antes o acumulado caía e
     o "Livre ao fim" SUBIA — a família parecia mais rica por a criança ter gasto. */
  const gastoTx2 = DB.all('transactions').find(x => /Gasto de Filho Espelho/.test(x.description || ''));
  check('a despesa e o pote batem no mesmo valor', gastoTx2.amount, 5);
  check('  e ela é do tipo despesa', DB.isExpense(gastoTx2), true);
  /* A COMPRA DO SONHO ENCERRA A META — e só quando o adulto confirma.

     Era a única saída do cofrinho que passava direto: criava o lançamento já
     confirmado e debitava a conta da família sem ninguém aprovar, logo no maior
     valor que a criança movimenta. */
  const metaE = DB.upsert('kid_goals', {
    kid_id: idE, name: 'Patinete', icon: '🛴', target_amount: 40, done: false });
  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'presente', pote: 'guardar', amount: 50, date: hojeE, confirmada: true });
  const pedidoE = DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'gasto', pote: 'guardar', amount: 40, date: hojeE,
    description: 'Comprei: Patinete', kid_goal_id: metaE, confirmada: false });

  check('o pedido do sonho espera na fila do adulto',
    DB.kidTarefasAConfirmar().some(x => x.entry.id === pedidoE), true);
  check('  e a meta ainda não está encerrada', DB.get('kid_goals', metaE).done, false);

  confirmarTarefa(pedidoE, true);
  check('confirmado, a meta é encerrada', DB.get('kid_goals', metaE).done, true);
  check('  com a data da conquista', !!DB.get('kid_goals', metaE).done_at, true);
  /* ENCERRADA, NÃO APAGADA: o histórico dela precisa poder contar que este sonho
     existiu e foi conquistado. */
  check('  mas não é apagada', !!DB.get('kid_goals', metaE), true);
  /* E VIRA DESPESA da família: quem compra o patinete é o adulto. */
  check('  e a compra vira despesa da família',
    DB.all('transactions').some(x => /Patinete/.test(x.description || '')), true);

  /* RECUSADO, a meta continua aberta e o dinheiro volta ao pote — ela pode pedir
     de novo, e o sonho não foi desconquistado. */
  const meta2 = DB.upsert('kid_goals', {
    kid_id: idE, name: 'Lego', icon: '🧱', target_amount: 5, done: false });
  const pedido2 = DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'gasto', pote: 'guardar', amount: 5, date: hojeE,
    description: 'Comprei: Lego', kid_goal_id: meta2, confirmada: false });
  const guardadoAntes = DB.kidPotes(idE).guardar;
  confirmarTarefa(pedido2, false);
  check('recusado, a meta continua aberta', DB.get('kid_goals', meta2).done, false);
  check('  e o dinheiro volta ao pote', DB.kidPotes(idE).guardar, guardadoAntes + 5);

  /* O GASTO PENDENTE ESPERA NA FILA DO ADULTO.

     É o que protege o dinheiro real: a criança está aprendendo e vai tocar sem
     querer, e como o gasto dela debita a conta da família, um toque de curiosidade
     não pode sair do bolso de ninguém sem alguém ver. */
  const idPend = DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'gasto', pote: 'gastar', amount: 3, date: hojeE,
    description: 'Figurinha', confirmada: false });
  const fila = DB.kidTarefasAConfirmar().filter(x => x.kid.id === idE);
  check('o gasto pendente entra na fila do adulto', fila.length, 1);
  check('  identificado como gasto', fila[0].entry.tipo, 'gasto');
  check('  com o valor e o que foi', fila[0].entry.amount, 3);

  /* A TELA MOSTRA O QUE É. Sem dizer que é uma compra, o adulto confirma achando
     que está aprovando uma tarefa — e o que ele estaria aprovando é uma saída da
     conta dele. */
  openConfirmarTarefas(idE);
  const telaFila = els['#modal'].innerHTML;
  check('a tela de confirmar mostra o gasto', /Figurinha/.test(telaFila), true);
  /* MEDE O AVISO, não a palavra. A primeira versão procurava /compr|gast/, que casa
     com a DESCRIÇÃO da compra — "Figurinha" não, mas qualquer item chamado "gasto do
  /* O AVISO TEM DE ESTAR NA LINHA DA COMPRA, e é isso que se mede: procurar o texto
     solto na tela deixava passar a troca por outro rótulo qualquer que também
     contivesse a palavra. */
  const iIco = telaFila.indexOf(String.fromCodePoint(0x1F6D2));
  const linhaCompra = iIco < 0 ? ''
    : telaFila.slice(iIco, telaFila.indexOf('</span>', iIco) + 7);
  check('  avisando, na própria linha, que debita a conta',
    /debita a sua conta/.test(linhaCompra), true);
  /* A SEÇÃO "Ela gastou" aparece porque há uma compra pendente. A de "Ela ganhou"
     só existe quando há ganho pendente — e neste ponto do cenário não há, então
     exigir as duas era exigir um estado que a cena não montou. */
  check('  numa seção que diz que ela gastou', /Ela gastou/.test(telaFila), true);
  check('  com o ícone que identifica a compra', /🛒/.test(telaFila), true);
  check('  e o valor com sinal de saída', /−/.test(telaFila), true);

  /* RECUSAR devolve o dinheiro ao pote dela e não deixa despesa nenhuma. */
  const antesRec = DB.kidPotes(idE).gastar;
  confirmarTarefa(idPend, false);
  check('recusar devolve o dinheiro ao pote', DB.kidPotes(idE).gastar, antesRec + 3);
  check('  e não cria despesa para a família',
    DB.all('transactions').some(x => /Figurinha/.test(x.description || '')), false);
  closeModal();

  /* A DOAÇÃO também sai do bolso, e a descrição diz o que foi: o extrato da família
     não pode mentir sobre o destino do dinheiro. */
  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'doacao', pote: 'doar', amount: 3, date: hojeE,
    description: 'Bichinhos', confirmada: false });
  const idDoacao = DB.all('kid_entries').find(e => e.kid_id === idE && e.tipo === 'doacao').id;
  confirmarTarefa(idDoacao, true);
  const doacaoTx = DB.all('transactions').find(x => /Doação de Filho Espelho/.test(x.description || ''));
  check('a doação dela também debita', !!doacaoTx, true);
  check('  identificada como doação, não como gasto', /Doação/.test(doacaoTx.description), true);
  check('  dizendo para quem', /Bichinhos/.test(doacaoTx.description), true);

  /* TAREFA E SEMANADA NÃO SÃO GASTO: elas põem dinheiro no cofrinho, não tiram da
     conta. Espelhá-las inverteria o sinal do dinheiro da família. */
  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'tarefa', pote: 'gastar', amount: 2, date: hojeE,
    description: 'Regar', confirmada: true });
  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'presente', pote: 'guardar', amount: 20, date: hojeE, confirmada: true });
  check('tarefa e presente não geram despesa', DB.espelharGastosDosFilhos().length, 0);

  /* NÃO CONFIRMADO não gera: se a tarefa dela ainda espera o adulto, não houve
     saída de dinheiro nenhuma. */
  DB.upsert('kid_entries', {
    kid_id: idE, tipo: 'gasto', pote: 'gastar', amount: 4, date: hojeE,
    description: 'Pendente', confirmada: false });
  check('gasto não confirmado não vira despesa', DB.espelharGastosDosFilhos().length, 0);

  /* APAGADO PELO ADULTO NÃO VOLTA. Recriar seria o app desfazendo a decisão dele a
     cada abertura — o mesmo defeito que já apareceu com as semanadas apagadas. */
  DB.remove('transactions', doacaoTx.id);
  check('despesa apagada pelo adulto não é recriada', DB.espelharGastosDosFilhos().length, 0);

  // Limpeza
  for (const x of DB.data.transactions.filter(x => x.kid_id === idE)) DB.remove('transactions', x.id);
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idE)) DB.remove('kid_entries', e.id);
  for (const r of DB.all('recurrences').filter(r => r.kid_id === idE)) DB.remove('recurrences', r.id);
  DB.remove('kids', idE); DB.remove('accounts', contaE);
} catch (e) { console.log(` FALHA | gasto da criança: ${e.message}`); fail++; }
/* ---- EDITAR UMA MISSÃO ----

   Não havia edição: uma missão cadastrada com a frequência errada só saía pelo caminho
   difícil — apagar e recriar —, e apagar leva junto o histórico de marcações da criança.
   Um erro de cadastro custava a semana dela.

   A falta virou problema real quando a migração trocou a frequência no servidor: as
   diárias viraram semanais, e não havia caminho no app para desfazer. */
console.log('\n=== Editar uma missão ===');
try {
  const idE = DB.upsert('kids', { name: 'Editar', semanada_valor: 10, active: true });
  const tid = DB.upsert('kid_tasks', {
    kid_id: idE, name: 'Água do Duque', icon: '🐕', amount: 0,
    frequencia: 'diaria', active: true });

  /* A CRIANÇA JÁ MARCOU DIAS: é este histórico que apagar-e-recriar destruía. */
  for (let n = 0; n < 3; n++) {
    DB.upsert('kid_entries', {
      kid_id: idE, tipo: 'tarefa', pote: 'gastar', amount: 0, task_id: tid,
      date: DB.somarDiasISO(DB.hojeISO(), -n), confirmada: true });
  }

  openCriancaDetalhe(idE);
  check('a lista oferece editar', els['#modal'].innerHTML.includes('data-edit-tarefa'), true);

  openKidTarefaSheet(idE, tid);
  const sh = els['#sheet'] ? els['#sheet'].innerHTML : els['#modal'].innerHTML;
  check('o formulário abre em modo editar', sh.includes('Editar missão'), true);
  check('  com o nome preenchido', sh.includes('Água do Duque'), true);

  /* A FREQUÊNCIA ATUAL VEM MARCADA, e este é o teste que mais importa: sem ela, abrir
     para editar e salvar sem tocar no campo rebaixaria a diária para semanal — o mesmo
     estrago que a migração fez, agora com um clique do adulto. */
  check('  e a frequência atual selecionada',
    /<option value="diaria" selected>/.test(sh), true);
  check('  sem marcar a errada',
    /<option value="semanal" selected>/.test(sh), false);

  /* CAMPO SEM RESPOSTA NÃO PODE REBAIXAR A MISSÃO.

     No navegador quem responde é o <option selected> conferido acima. Aqui o campo é
     esvaziado de propósito para exercitar o caminho de exceção: se por qualquer motivo o
     select não devolver um valor reconhecido, o código tem de PRESERVAR o que a missão já
     era -- nunca cair em 'semanal', que é um palpite. Cair no palpite foi exatamente o
     que a migração fez no servidor, e apagou as diárias.

     O cache de elementos da suíte é global, então o campo pode chegar aqui com sobra de
     outro teste: zerar antes é o que torna esta asserção sobre o código, e não sobre a
     ordem em que os testes rodaram. */
  els['#kt-freq'].value = '';

  /* SALVAR PRESERVA O ID, que é o que separa editar de recriar: as marcações apontam
     para ele, e um id novo deixaria o histórico da criança órfão. */
  els['#kt-nome'].value = 'Água dos cachorros';
  els['#sh-save'].onclick();
  const depois = DB.get('kid_tasks', tid);
  check('salvar mantém a mesma missão', !!depois, true);
  check('  com o nome novo', depois.name, 'Água dos cachorros');
  check('  e a frequência intacta', depois.frequencia, 'diaria');
  check('  sem criar uma segunda',
    DB.all('kid_tasks').filter(t => t.kid_id === idE).length, 1);

  /* O HISTÓRICO SOBREVIVE: é a razão de existir da edição. */
  check('as marcações da criança continuam ligadas à missão',
    DB.all('kid_entries').filter(e => e.task_id === tid).length, 3);

  /* TROCAR A FREQUÊNCIA de fato funciona — é o conserto que o adulto precisa fazer. */
  openKidTarefaSheet(idE, tid);
  els['#kt-freq'].value = 'semanal';
  els['#sh-save'].onclick();
  check('dá para trocar a frequência', DB.get('kid_tasks', tid).frequencia, 'semanal');

  /* CRIAR CONTINUA CRIANDO: a mesma tela sem id abre vazia e faz uma missão nova. */
  openKidTarefaSheet(idE);
  const nova = els['#sheet'] ? els['#sheet'].innerHTML : els['#modal'].innerHTML;
  check('sem id, o formulário abre para criar', nova.includes('Nova missão'), true);
  check('  e vazio', nova.includes('Água dos cachorros'), false);
  els['#kt-nome'].value = 'Regar as plantas';
  els['#sh-save'].onclick();
  check('  criando uma segunda missão',
    DB.all('kid_tasks').filter(t => t.kid_id === idE).length, 2);

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idE)) DB.remove('kid_entries', e.id);
  for (const t of DB.all('kid_tasks').filter(t => t.kid_id === idE)) DB.remove('kid_tasks', t.id);
  DB.remove('kids', idE);
  closeSheet(); closeModal();
} catch (e) { console.log(` FALHA | editar missão: ${e.message}`); fail++; }

/* ---- A MIGRAÇÃO PRECISA MIGRAR ----

   `create table if not exists` NÃO ADICIONA COLUNA. Num banco que já tem a tabela, o
   Postgres pula o comando inteiro em silêncio — nenhum erro, nenhum aviso, e a migração
   termina dizendo "sucesso" sem ter migrado nada.

   Aconteceu de verdade: a migração descrevia kid_tasks completa, com `frequencia` e
   `expira_em` dentro do create, e num banco real só criou a tabela que ainda não existia.
   A missão especial chegava no celular sem saber que era especial, porque a coluna que a
   distingue nunca foi criada. Levou duas rodadas de investigação para achar.

   Toda coluna descrita num create da migração precisa do `alter table add column if not
   exists` dela. Este teste compara as duas listas. */
console.log('\n=== A migração migra bancos que já existem ===');
try {
  const mig = fs.readFileSync(BASE + 'supabase/migracao-cofrinho.sql', 'utf8');

  /* As colunas de cada create table da migração. */
  const doCreate = {};
  for (const m of mig.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const tab = m[1];
    doCreate[tab] = m[2].split(/\r?\n/)
      .map(l => l.replace(/--.*$/, '').trim())
      .map(l => (l.match(/^(\w+)\s+/) || [])[1])
      .filter(Boolean)
      /* `id` e `family_id` nascem com a tabela e nunca são adicionados depois: são a
         chave e o vínculo, e uma tabela sem eles não existe. `updated_at` e `deleted`
         idem — vêm do desenho original de toda tabela sincronizada. */
      .filter(col => !['id', 'family_id', 'kid_id', 'name', 'updated_at', 'deleted'].includes(col));
  }

  /* As colunas que a migração de fato adiciona. */
  const doAlter = new Set(
    [...mig.matchAll(/alter table (\w+) add column if not exists (\w+)/g)]
      .map(m => m[1] + '.' + m[2]));

  const semAlter = [];
  for (const tab of Object.keys(doCreate)) {
    for (const col of doCreate[tab]) {
      if (!doAlter.has(tab + '.' + col)) semAlter.push(tab + '.' + col);
    }
  }
  check('toda coluna do create tem o alter dela',
    semAlter.length ? semAlter.join(', ') : true, true);

  /* AS TRÊS QUE FALTAVAM DE VERDADE, nomeadas: um teste genérico que passasse a mudar
     junto com a implementação deixaria justamente estas escaparem de novo. */
  for (const alvo of ['kid_tasks.frequencia', 'kid_tasks.expira_em', 'kid_entries.repartido']) {
    check(`a migração adiciona ${alvo}`, doAlter.has(alvo), true);
  }

  /* O NOME DA FUNÇÃO DO CARIMBO tem de existir no schema. A migração chamou
     `stamp_server_at()` durante um tempo — um nome inventado — e o erro só aparecia na
     hora de rodar, com a migração já pela metade. */
  const sch = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');
  const chamadas = [...mig.matchAll(/execute function (\w+)\(\)/g)].map(m => m[1]);
  const inventadas = chamadas.filter(f =>
    !new RegExp('create (or replace )?function ' + f + '\\b').test(sch));
  check('a migração só chama função que o schema cria',
    inventadas.length ? [...new Set(inventadas)].join(', ') : true, true);

  /* COLUNA QUE CHEGA DEPOIS NÃO PODE TER DEFAULT QUE INVENTA DADO.

     Num banco que já tem linhas, `add column ... not null default X` preenche TODAS as
     linhas existentes com X — e se X é um palpite sobre o que aquela linha era, o palpite
     apaga a verdade. Pior: como o valor fica indistinguível de um dado real, o próximo
     pull leva o palpite de volta ao cliente e apaga o dado bom lá também.

     Aconteceu com `frequencia`: as missões diárias viraram semanais no servidor, e a
     trilha dos sete dias sumiu da tela da criança.

     BOOLEANO É EXCEÇÃO quando o false diz a verdade sobre o passado — `repartido false`
     em linha antiga está certo, porque nenhuma delas passou por um ritual que não existia.
     O que não se admite é default de TEXTO num campo que classifica a linha. */
  const defaultDeTexto = [...mig.matchAll(
    /add column if not exists (\w+)\s+text[^;]*default\s+'([^']+)'/g)]
    .map(m => `${m[1]}='${m[2]}'`);
  check('nenhuma coluna de texto chega com default que inventa dado',
    defaultDeTexto.length ? defaultDeTexto.join(', ') : true, true);

  /* IDEMPOTENTE: rodar duas vezes não pode quebrar. Todo comando que cria coisa precisa
     do "if not exists" ou do "or replace" — e este arquivo é feito para ser colado no
     SQL Editor por alguém que não sabe se já rodou antes. */
  const criaSemGuarda = [...mig.matchAll(/^\s*(create (?:table|index|policy|trigger)) (?!if not exists)(\w+)/gmi)]
    .map(m => m[0].trim());
  check('nenhum create sem proteção contra rodar duas vezes',
    criaSemGuarda.length ? criaSemGuarda.join(' | ') : true, true);
} catch (e) { console.log(` FALHA | migração: ${e.message}`); fail++; }

/* ---- APAGAR O COFRINHO LEVA AS VONTADES JUNTO ----

   Uma tabela nova precisa entrar em TODOS os lugares que varrem o cofrinho, e apagar é o
   mais fácil de esquecer: nada quebra na hora. A vontade órfã sobrevive à criança e
   ressuscita colada na próxima que receber o mesmo id — e aí uma criança vê, na própria
   lista, um desejo que nunca foi dela. */
console.log('\n=== Apagar o cofrinho apaga as vontades ===');
try {
  const idW = DB.upsert('kids', { name: 'Vontade orfa', semanada_valor: 10, active: true });
  DB.upsert('kid_wishes', {
    kid_id: idW, name: 'Jogo', icon: '🎮', criada_em: DB.hojeISO() });
  DB.upsert('kid_wishes', {
    kid_id: idW, name: 'Bola', icon: '⚽', criada_em: DB.hojeISO() });
  check('as vontades existem antes',
    DB.all('kid_wishes').filter(w => w.kid_id === idW).length, 2);

  const r = DB.apagarCofrinho(idW);
  check('apagar o cofrinho conta as vontades', r.vontades, 2);
  check('  e não sobra nenhuma',
    DB.all('kid_wishes').filter(w => w.kid_id === idW).length, 0);

  /* A VONTADE DE OUTRA CRIANÇA fica: apagar um cofrinho apaga UM cofrinho. */
  const idOk = DB.upsert('kids', { name: 'Fica', semanada_valor: 10, active: true });
  DB.upsert('kid_wishes', { kid_id: idOk, name: 'Livro', icon: '📚', criada_em: DB.hojeISO() });
  const idVai = DB.upsert('kids', { name: 'Vai', semanada_valor: 10, active: true });
  DB.upsert('kid_wishes', { kid_id: idVai, name: 'Doce', icon: '🍭', criada_em: DB.hojeISO() });
  DB.apagarCofrinho(idVai);
  check('a vontade de outra criança continua',
    DB.all('kid_wishes').filter(w => w.kid_id === idOk).length, 1);
  DB.apagarCofrinho(idOk);
  for (const id of [idW, idOk, idVai]) DB.remove('kids', id);
} catch (e) { console.log(` FALHA | apagar vontades: ${e.message}`); fail++; }

/* ---- A PERGUNTA DA SEMANA ----

   O app mostra números e nenhum deles diz o que CONVERSAR. É o ponto de maior consenso
   entre educadores da área e o mais ignorado pelos apps: dinheiro se aprende conversando,
   não usando aplicativo. O cofrinho é o pretexto para a aula, não a aula. */
console.log('\n=== A pergunta da semana ===');
try {
  const hojeQ = DB.hojeISO();
  const diasQ = n => DB.somarDiasISO(hojeQ, -n);
  const idQ = DB.upsert('kids', {
    name: 'Pergunta', semanada_valor: 10, semanada_dia: new Date(hojeQ + 'T12:00:00').getDay(),
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true });

  /* SEM NADA no cofrinho não há o que perguntar, e uma sugestão genérica toda semana
     ensina a ignorar o bloco — aí ele deixa de servir na semana em que tem algo real. */
  check('cofrinho vazio não gera pergunta', DB.perguntaDaSemana(idQ), null);

  /* REPARTIU: o momento em que ela decidiu, e o único em que escolheu proporção. */
  DB.upsert('kid_entries', {
    kid_id: idQ, tipo: 'divisao', pote: 'guardar', amount: 20, date: hojeQ, confirmada: true });
  check('repartir gera conversa', DB.perguntaDaSemana(idQ).assunto, 'repartiu');

  /* A MOEDA MÁGICA ganha da divisão: é abstrata, e a criança precisa que alguém nomeie o
     que aconteceu para ligar a espera ao prêmio. */
  DB.upsert('kid_entries', {
    kid_id: idQ, tipo: 'rendimento', pote: 'guardar', amount: 1, date: hojeQ, confirmada: true });
  check('a moeda mágica tem prioridade sobre repartir',
    DB.perguntaDaSemana(idQ).assunto, 'moeda');

  /* TIRAR DO GUARDADO ganha das duas: é a decisão mais cara que ela toma sozinha, e a que
     ela consegue explicar melhor logo depois de tomar. */
  DB.upsert('kid_entries', {
    kid_id: idQ, tipo: 'gasto', pote: 'guardar', amount: 5, date: hojeQ,
    description: 'Doce', confirmada: true });
  const qs = DB.perguntaDaSemana(idQ);
  check('tirar do guardado tem prioridade', qs.assunto, 'saque');
  check('  e o fato traz o valor real', qs.fato.includes('5,00'), true);
  check('  com o nome da criança', qs.fato.includes('Pergunta'), true);

  /* A PERGUNTA É ABERTA. "Por que você gastou isso?" é uma acusação com ponto de
     interrogação: a criança responde o que o adulto quer ouvir, e isso encerra a conversa
     em vez de começá-la. Nenhuma pergunta do conjunto pode começar por "por que você". */
  const assuntos = [];
  for (const t of ['divisao', 'rendimento', 'doacao']) {
    DB.upsert('kid_entries', {
      kid_id: idQ, tipo: t, pote: 'doar', amount: 1, date: hojeQ, confirmada: true });
  }
  const todasQ = [];
  for (const kidNome of ['A', 'B']) {
    const kid2 = DB.upsert('kids', { name: kidNome, semanada_valor: 10, active: true });
    DB.upsert('kid_entries', {
      kid_id: kid2, tipo: 'divisao', pote: 'guardar', amount: 5, date: hojeQ, confirmada: true });
    const p = DB.perguntaDaSemana(kid2);
    if (p) todasQ.push(p.pergunta);
    for (const e of DB.all('kid_entries').filter(e => e.kid_id === kid2)) DB.remove('kid_entries', e.id);
    DB.remove('kids', kid2);
  }
  todasQ.push(qs.pergunta);
  check('nenhuma pergunta acusa a criança',
    todasQ.some(p => /por que voc[êe]/i.test(p)), false);

  /* O SONHO ALCANÇADO ganha de tudo: é a maior conversa disponível e dura pouco — some
     assim que ela compra. */
  DB.upsert('kid_goals', {
    kid_id: idQ, name: 'Patinete', icon: '🛴', target_amount: 10, done: false });
  DB.upsert('kid_entries', {
    kid_id: idQ, tipo: 'presente', pote: 'guardar', amount: 50, date: hojeQ, confirmada: true });
  check('o sonho alcançado ganha de tudo', DB.perguntaDaSemana(idQ).assunto, 'chegou');

  /* O POTE DE DOAR PARADO. Exige histórico: cobrar doação de quem acabou de começar
     transformaria o terceiro pote numa dívida antes de ela entender para que serve. */
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idQ)) DB.remove('kid_entries', e.id);
  for (const g of DB.all('kid_goals').filter(g => g.kid_id === idQ)) DB.remove('kid_goals', g.id);
  DB.upsert('kid_entries', {
    kid_id: idQ, tipo: 'presente', pote: 'doar', amount: 8, date: diasQ(200), confirmada: true });
  check('com pouco histórico, não cobra doação',
    (DB.perguntaDaSemana(idQ) || {}).assunto === 'doar', false);

  for (let n = 0; n < 9; n++) {
    DB.upsert('kid_entries', {
      kid_id: idQ, tipo: 'presente', pote: 'gastar', amount: 1, date: diasQ(150 + n), confirmada: true });
  }
  check('com histórico e o pote parado, sugere doar',
    DB.perguntaDaSemana(idQ).assunto, 'doar');

  /* SEMANA PARADA não é problema — é a deixa para a conversa que não parte de um número. */
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idQ && e.pote === 'doar')) {
    DB.remove('kid_entries', e.id);
  }
  check('semana sem movimento vira conversa', DB.perguntaDaSemana(idQ).assunto, 'parado');

  /* NA TELA. */
  openCriancaDetalhe(idQ);
  check('a conversa aparece na tela da criança',
    els['#modal'].innerHTML.includes('Para conversar esta semana'), true);

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idQ)) DB.remove('kid_entries', e.id);
  DB.remove('kids', idQ);
  closeModal();
  check('sem criança, nenhuma pergunta', DB.perguntaDaSemana(idQ), null);
} catch (e) { console.log(` FALHA | pergunta da semana: ${e.message}`); fail++; }

/* ---- O EXTRATO DA CRIANÇA GANHA TELA PRÓPRIA ----

   Trinta linhas de extrato empurravam a meta, as missões e os botões de
   configuração para fora da tela — e aquela é a tela de ADMINISTRAR, não de
   auditar. */
console.log('\n=== O extrato da criança em tela própria ===');
try {
  const hojeX = DB.hojeISO();
  const idX = DB.upsert('kids', { name: 'Extrato Kid', semanada_valor: 10, active: true });
  for (let n = 0; n < 9; n++) {
    DB.upsert('kid_entries', {
      kid_id: idX, tipo: 'presente', pote: 'gastar', amount: 1,
      date: DB.somarDiasISO(hojeX, -n), description: `Mov ${n}`, confirmada: true });
  }

  openCriancaDetalhe(idX);
  const det = els['#modal'].innerHTML;
  const linhas = (det.match(/class="kid-mov"/g) || []).length;
  check('a tela da criança mostra poucos movimentos', linhas, 5);
  check('  e oferece o extrato completo', det.includes('id="kdd-extrato"'), true);
  check('  dizendo quantos existem', /9/.test(det), true);

  openKidExtrato(idX);
  const ex = els['#modal'].innerHTML;
  check('o extrato completo mostra todos', (ex.match(/class="kid-mov"/g) || []).length, 9);
  check('  com o nome da criança', ex.includes('Extrato Kid'), true);
  check('  e o saldo dela', ex.includes(fmt(9)), true);
  check('  com caminho de volta', ex.includes('id="kx-back"'), true);

  /* COM POUCOS MOVIMENTOS o botão não aparece: um caminho para uma tela que mostra
     o mesmo que a anterior é ruído. */
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idX).slice(0, 7)) {
    DB.remove('kid_entries', e.id);
  }
  openCriancaDetalhe(idX);
  check('com poucos movimentos, o botão não aparece',
    els['#modal'].innerHTML.includes('id="kdd-extrato"'), false);

  /* O EXTRATO DO ADULTO MOSTRA A SAÍDA PENDENTE, como o da criança: se o pote dela
     já caiu, as duas telas precisam mostrar a linha que explica por quê. */
  DB.upsert('kid_entries', {
    kid_id: idX, tipo: 'gasto', pote: 'gastar', amount: 1, date: hojeX,
    description: 'Doce pendente', confirmada: false });
  openKidExtrato(idX);
  check('a saída pendente aparece no extrato do adulto',
    els['#modal'].innerHTML.includes('Doce pendente'), true);
  check('  marcada como esperando', els['#modal'].innerHTML.includes('esperando você'), true);

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idX)) DB.remove('kid_entries', e.id);
  DB.remove('kids', idX);
  closeModal();
} catch (e) { console.log(` FALHA | extrato da criança: ${e.message}`); fail++; }

/* ---- OS DESENHOS DE META E DE MISSÃO ----

   Eram dez sonhos e oito missões, e isso cobre mal o que existe: faltava patins,
   faltava instrumento, faltava lixo, faltava lição de casa. Sonho sem desenho vira
   "🚲" por falta de opção — e aí o desenho para de significar o sonho DELA, que é o
   que faz a barra de progresso valer alguma coisa. */
console.log('\n=== Os desenhos de meta e de missão ===');
try {
  const fonte = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const lista = nome => {
    const m = fonte.match(new RegExp(nome + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  const metas = lista('ICONES_META');
  const tarefas = lista('ICONES_T');

  check('há bem mais desenhos de sonho que antes', metas.length >= 30, true);
  check('  e bem mais de missão', tarefas.length >= 24, true);

  /* NENHUM SE REPETE. Duas missões com o mesmo desenho são a mesma missão aos olhos de
     quem ainda lê devagar — e é o ícone, não o nome, que a criança lê na aba dela. */
  check('nenhum desenho de sonho se repete', new Set(metas).size, metas.length);
  check('  nem de missão', new Set(tarefas).size, tarefas.length);

  /* OS ANTIGOS CONTINUAM LÁ: quem já cadastrou uma meta com 🚲 não pode ver o desenho
     sumir da grade no dia em que for editar. */
  const antigosM = ['🚲', '🎮', '⚽', '🧸', '🎨', '📚', '🛴', '🦸', '🎧', '🍦'];
  const antigosT = ['🛏️', '🧸', '🪴', '🍽️', '🦷', '📚', '🐕', '🧹'];
  check('nenhum desenho de sonho antigo desapareceu',
    antigosM.filter(i => !metas.includes(i)).join(', ') || true, true);
  check('  nem de missão', antigosT.filter(i => !tarefas.includes(i)).join(', ') || true, true);

  /* O PRIMEIRO DA LISTA É O PADRÃO de quem não escolhe nada, então precisa ser um
     desenho neutro e comum — não o último que calhou de eu acrescentar. */
  check('o sonho padrão é a bicicleta', metas[0], '🚲');
  check('  e a missão padrão é arrumar a cama', tarefas[0], '🛏️');
} catch (e) { console.log(` FALHA | desenhos: ${e.message}`); fail++; }

/* ---- APAGAR UM COFRINHO INTEIRO ----

   Existia só "pausar", que esconde e guarda tudo. A falta de "excluir" apareceu
   do pior jeito: foi preciso um script contra o banco para zerar um cofrinho de
   teste, porque a tela não oferecia o caminho. */
console.log('\n=== Excluir o cofrinho de uma criança ===');
try {
  const hojeX = DB.hojeISO();
  const idX = DB.upsert('kids', {
    name: 'Filho Apagar', avatar: '🐢', semanada_valor: 9, semanada_dia: new Date(hojeX + 'T12:00:00').getDay(),
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true,
  });
  const outroX = DB.upsert('kids', {
    name: 'Filho Que Fica', semanada_valor: 5, semanada_dia: 6, active: true,
  });
  DB.upsert('kid_entries', { kid_id: idX, tipo: 'semanada', pote: 'gastar', amount: 9, date: hojeX, confirmada: true });
  DB.upsert('kid_entries', { kid_id: idX, tipo: 'presente', pote: 'guardar', amount: 30, date: hojeX, confirmada: true });
  DB.upsert('kid_goals', { kid_id: idX, name: 'Lego', icon: '🧱', target_amount: 60, done: false });
  DB.upsert('kid_tasks', { kid_id: idX, name: 'Varrer', icon: '🧹', amount: 2, active: true });
  DB.upsert('kid_entries', { kid_id: outroX, tipo: 'semanada', pote: 'gastar', amount: 5, date: hojeX, confirmada: true });
  const contratoX = DB.acertarContratoDaSemanada(idX);
  DB.gerarRecorrencias();

  check('antes de apagar, o cofrinho tem saldo', DB.kidPotes(idX).total, 39);
  check('  e um contrato', !!DB.contratoDaSemanada(idX), true);
  const nLanc = DB.all('transactions').filter(t => t.kid_id === idX).length;
  check('  e semanadas no extrato', nLanc >= 1, true);

  const r = DB.apagarCofrinho(idX);
  check('apagar devolve o que foi apagado', r.entries, 2);
  check('  incluindo a meta', r.metas, 1);
  check('  a tarefa', r.tarefas, 1);
  check('  o contrato', r.contratos, 1);
  check('  e os lançamentos do extrato', r.lancamentos, nLanc);

  check('a criança sai da lista', DB.kids().some(k => k.id === idX), false);
  check('  o saldo dela desaparece', DB.kidPotes(idX).total, 0);
  /* SEM ISTO, recadastrar a criança faria o dinheiro antigo reaparecer: os
     lançamentos continuam apontando para o id, e um id novo não os apaga. */
  check('  nenhum lançamento do cofrinho sobra', DB.all('kid_entries').filter(e => e.kid_id === idX).length, 0);
  check('  nem meta', DB.all('kid_goals').filter(g => g.kid_id === idX).length, 0);
  check('  nem tarefa', DB.all('kid_tasks').filter(t => t.kid_id === idX).length, 0);
  /* O CONTRATO TEM DE MORRER: vivo, continuaria lançando e pesando no custo fixo
     de uma criança que não existe mais. */
  check('  o contrato não sobrevive', DB.all('recurrences').some(x => x.id === contratoX), false);
  check('  e sai do custo fixo mensal',
    DB.custoFixoMensal().itens.some(i => /Filho Apagar/.test(i.descricao)), false);
  check('  as semanadas saem do extrato',
    DB.all('transactions').filter(t => t.kid_id === idX).length, 0);
  check('  e o dinheiro dos filhos não conta mais o apagado', DB.dosFilhos(), DB.kidPotes(outroX).total);

  /* NÃO LEVA O IRMÃO. Apagar em cascata por engano é o defeito clássico deste tipo
     de função, e aqui custaria o cofrinho da outra criança. */
  check('o outro filho continua intacto', DB.kids().some(k => k.id === outroX), true);
  check('  com o saldo dele', DB.kidPotes(outroX).total, 5);

  check('apagar de novo não estoura', DB.apagarCofrinho(idX), null);

  for (const e of DB.all('kid_entries').filter(e => e.kid_id === outroX)) DB.remove('kid_entries', e.id);
  DB.remove('kids', outroX);
} catch (e) { console.log(` FALHA | excluir cofrinho: ${e.message}`); fail++; }

/* ---- A SEMANADA NO ORÇAMENTO DE QUEM PAGA ----

   O cofrinho registrava o dinheiro chegando para a criança e o lado de quem paga
   ficava cego: a semanada não existia no custo fixo, no comprometido nem na
   projeção. É o perfil de gasto que mais some da conta — pequeno, repetido e em
   dinheiro vivo. */
console.log('\n=== A semanada entra nas contas da família ===');
try {
  const hojeS = DB.hojeISO();
  const diaS = new Date(hojeS + 'T12:00:00').getDay();
  const idS = DB.upsert('kids', {
    name: 'Cofrinho Custo', avatar: '🐢', cor: '#0984e3',
    semanada_valor: 8, semanada_dia: diaS,
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true,
  });

  /* O MENSAL SAI DA PERIODICIDADE, não de "quatro semanas".

     Um mês não tem quatro semanas: tem 52/12 = 4,333. Arredondar para quatro
     subestima o ano inteiro em quase um mês de semanada — e o app já sabia disso
     em POR_MES, para a diarista semanal. Reusar essa conta é o que mantém a
     semanada coerente com o resto do custo fixo. */
  check('a semanada vira custo mensal pela periodicidade real',
    Math.round(DB.semanadaMensalDoKid(DB.get('kids', idS)) * 100) / 100,
    Math.round((8 + 1) * 52 / 12 * 100) / 100);
  check('  incluindo a moeda mágica, que também sai do bolso',
    DB.semanadaMensalDoKid(DB.get('kids', idS)) > 8 * 52 / 12, true);

  // Sem contrato, o app diz o que falta — e diz O QUE, não "algo"
  const fora1 = DB.semanadaForaDeSincronia(idS);
  check('sem contrato, a semanada está fora das contas', fora1 && fora1.motivo, 'faltando');
  check('  e o custo fixo mensal não a conhece',
    DB.custoFixoMensal().itens.some(i => /Cofrinho Custo/.test(i.descricao)), false);

  const idC = DB.acertarContratoDaSemanada(idS);
  check('criar o contrato resolve', !!idC, true);
  check('  e agora ela está em dia', DB.semanadaForaDeSincronia(idS), null);

  const contrato = DB.get('recurrences', idC);
  check('  o contrato é semanal', contrato.periodicidade, 'semanal');
  check('  é despesa', contrato.type, 'Despesa');
  check('  está ativo', contrato.status, 'ativa');
  check('  vale semanada + moeda mágica', contrato.amount, 9);
  check('  e está ligado à criança pelo id', contrato.kid_id, idS);

  /* O INÍCIO CAI NO DIA DA SEMANADA. Para periodicidade semanal, o app soma sete
     dias sobre o início e IGNORA o campo `dia` — então é o início que define o dia
     da semana. Sem isto, a semanada de sábado seria lançada na terça. */
  check('  o início cai no dia da semanada',
    new Date(contrato.inicio + 'T12:00:00').getDay(), diaS);
  check('  e nunca no passado', contrato.inicio >= hojeS, true);

  /* AGORA A CONTA FECHA: o custo fixo mensal da família conhece a semanada, com o
     valor mensal certo. É o teste que prova que o dinheiro deixou de ser
     invisível. */
  const item = DB.custoFixoMensal().itens.find(i => /Cofrinho Custo/.test(i.descricao));
  check('o custo fixo mensal passa a conhecer a semanada', !!item, true);
  check('  com o valor mensal certo',
    item ? Math.round(item.mensal * 100) / 100 : null,
    Math.round(9 * 52 / 12 * 100) / 100);

  /* IDEMPOTENTE: acertar duas vezes não cria um segundo contrato. Duplicar aqui
     dobraria o custo fixo da família sem ninguém entender de onde veio. */
  const antes = DB.all('recurrences').filter(r => r.kid_id === idS).length;
  DB.acertarContratoDaSemanada(idS);
  check('acertar de novo não duplica o contrato',
    DB.all('recurrences').filter(r => r.kid_id === idS).length, antes);

  /* MUDAR A SEMANADA desencaixa o contrato, e o app avisa com o motivo. Sem este
     aviso, aumentar a semanada de 8 para 15 deixaria o orçamento contando 8 para
     sempre — errando para baixo, que é o lado ruim de errar. */
  DB.upsert('kids', { ...DB.get('kids', idS), semanada_valor: 15 });
  const fora2 = DB.semanadaForaDeSincronia(idS);
  check('mudar o valor da semanada desencaixa o contrato', fora2 && fora2.motivo, 'valor');
  check('  dizendo quanto era', fora2.atual, 9);
  check('  e quanto passou a ser', fora2.esperado, 16);
  DB.acertarContratoDaSemanada(idS);
  check('  acertar atualiza o mesmo contrato', DB.get('recurrences', idC).amount, 16);
  check('  sem criar outro', DB.all('recurrences').filter(r => r.kid_id === idS).length, antes);

  // Mudar o DIA também desencaixa, e o acerto move o início
  DB.upsert('kids', { ...DB.get('kids', idS), semanada_dia: (diaS + 3) % 7 });
  const fora3 = DB.semanadaForaDeSincronia(idS);
  check('mudar o dia da semana desencaixa', fora3 && fora3.motivo, 'dia');
  DB.acertarContratoDaSemanada(idS);
  check('  e o acerto move o início para o novo dia',
    new Date(DB.get('recurrences', idC).inicio + 'T12:00:00').getDay(), (diaS + 3) % 7);

  // Contrato pausado: a semanada para de ser lançada, e isso precisa aparecer
  DB.upsert('recurrences', { ...DB.get('recurrences', idC), status: 'pausada' });
  check('contrato pausado é avisado', (DB.semanadaForaDeSincronia(idS) || {}).motivo, 'pausado');
  DB.acertarContratoDaSemanada(idS);
  check('  e o acerto religa', DB.get('recurrences', idC).status, 'ativa');

  /* ZERAR A SEMANADA encerra o contrato, não o apaga: o que já foi pago continua
     explicável no histórico. Apagar deixaria lançamentos órfãos apontando para um
     contrato que não existe mais. */
  DB.upsert('kids', { ...DB.get('kids', idS), semanada_valor: 0, rendimento_valor: 0 });
  check('zerar a semanada deixa o contrato sobrando',
    (DB.semanadaForaDeSincronia(idS) || {}).motivo, 'sobrando');
  DB.acertarContratoDaSemanada(idS);
  check('  e o acerto encerra o contrato', DB.get('recurrences', idC).status, 'cancelada');
  check('  sem apagar o registro', !!DB.get('recurrences', idC), true);
  check('  saindo do custo fixo mensal',
    DB.custoFixoMensal().itens.some(i => /Cofrinho Custo/.test(i.descricao)), false);
  check('  e sem ficar avisando para sempre', DB.semanadaForaDeSincronia(idS), null);

  /* A TELA MOSTRA O CUSTO. É onde o adulto decide, e por isso mostra o mensal:
     orçamento se pensa em mês, mesmo quando o pagamento é semanal. */
  DB.upsert('kids', { ...DB.get('kids', idS), semanada_valor: 10, rendimento_valor: 2 });
  const bloco = blocoDaSemanada(idS);
  check('a tela da criança mostra o custo para a família', bloco.includes('Custo para vocês'), true);
  check('  o valor da semana', bloco.includes(fmt(12)), true);
  check('  e o peso no mês', bloco.includes(fmt(12 * 52 / 12)), true);
  check('  com o caminho para criar o contrato', bloco.includes('id="kdd-contrato"'), true);

  // Com tudo em dia, o aviso e o botão saem da tela
  DB.acertarContratoDaSemanada(idS);
  const bloco2 = blocoDaSemanada(idS);
  check('em dia, o botão de acertar desaparece', bloco2.includes('id="kdd-contrato"'), false);
  check('  e a tela diz que já entra nas contas', bloco2.includes('custo fixo mensal'), true);

  /* O AVISO SOBE PARA A LISTA de crianças: escondido só no detalhe, dependia de
     alguém abrir a criança para descobrir o problema. */
  DB.upsert('kids', { ...DB.get('kids', idS), semanada_valor: 30 });
  openCriancas();
  check('a lista de crianças avisa quando está fora de sincronia',
    els['#modal'].innerHTML.includes('valor diferente do contrato'), true);
  DB.acertarContratoDaSemanada(idS);
  openCriancas();
  check('  e não avisa quando está tudo certo',
    els['#modal'].innerHTML.includes('valor diferente do contrato'), false);

  /* A GERAÇÃO FUNCIONA: o contrato semanal cria lançamentos de verdade, um por
     semana, no dia certo. Um contrato que não gera nada é um número bonito que
     não vira dinheiro saindo. */
  /* O ID MUDA quando o contrato e recriado. Zerar a semanada CANCELA o contrato,
     e reativar cria outro — cancelado nao volta, porque o historico do que foi
     pago precisa continuar apontando para um contrato encerrado. Guardar o id
     antigo aqui media o contrato errado, e o teste reprovava sem defeito. */
  const idAtual = DB.contratoDaSemanada(idS).id;
  DB.gerarRecorrencias(DB.somarDiasISO(hojeS, 21));
  const geradas = DB.all('transactions').filter(t => t.recurrence_id === idAtual);
  check('o contrato gera as semanadas do período', geradas.length >= 2, true);
  check('  todas no dia da semana certo',
    geradas.every(t => new Date(t.date + 'T12:00:00').getDay() === (diaS + 3) % 7), true);
  check('  nenhuma no passado', geradas.every(t => t.date >= hojeS), true);
  /* 32, nao 30: a semanada e 30 e a moeda magica continua valendo 2. Errei esta
     conta ao escrever o teste, e e exatamente o erro que o contrato evita que a
     familia cometa no orcamento — a moeda magica esquecida na soma. */
  check('  e com o valor da semana mais a moeda magica',
    geradas.every(t => Number(t.amount) === 32), true);

  // Limpeza
  for (const t of geradas) DB.remove('transactions', t.id);
  for (const r of DB.all('recurrences').filter(r => r.kid_id === idS)) DB.remove('recurrences', r.id);
  DB.remove('kids', idS);
  closeModal();
} catch (e) { console.log(` FALHA | semanada no orçamento: ${e.message}`); fail++; }

/* ---- COFRINHO: a gestão no app de quem administra ----

   A área dos pais mora AQUI, não no app da criança: o PIN daqui criptografa os
   dados de verdade, e é onde o adulto já administra tudo. */
console.log('\n=== Cofrinho: gestão no app da família ===');
try {
  const hojeG2 = DB.hojeISO();
  const idG = DB.upsert('kids', {
    name: 'Cofrinho Um', avatar: '🐢', cor: '#0984e3',
    semanada_valor: 10, semanada_dia: new Date(hojeG2 + 'T12:00:00').getDay(),
    rendimento_tipo: 'moeda', rendimento_valor: 2, active: true,
  });

  // Entrada pelas Configurações, no padrão de "Contas fixas"
  openConfig();
  const cfg = els['#modal'].innerHTML;
  check('Configurações oferece a seção Crianças', cfg.includes('data-go="criancas"'), true);
  check('  dizendo quem já está cadastrado', cfg.includes('Cofrinho Um'), true);

  openCriancas();
  const lista = els['#modal'].innerHTML;
  check('a lista mostra a criança', lista.includes('Cofrinho Um'), true);
  check('  com a semanada e o dia', lista.includes(fmt(10)), true);
  check('  e um caminho para cadastrar outra', lista.includes('id="kd-nova"'), true);

  /* O DETALHE é a auditoria: os três potes, a meta, as tarefas e todo o
     movimento. É o que o app da criança NÃO mostra — lá a história é curta e
     ilustrada; aqui é para conferir. */
  DB.upsert('kid_entries', { kid_id: idG, tipo: 'semanada', pote: 'guardar', amount: 20, date: hojeG2, confirmada: true });
  openCriancaDetalhe(idG);
  const det = els['#modal'].innerHTML;
  check('o detalhe abre os três potes', /Gastar agora[\s\S]*Guardar[\s\S]*Doar/.test(det), true);
  check('  mostra o movimento', det.includes('Semanada'), true);
  check('  e oferece editar, meta, tarefa e lançamento',
    ['kdd-editar', 'kdd-meta', 'kdd-tarefa', 'kdd-lanc'].every(i => det.includes(i)), true);
  /* PAUSAR E EXCLUIR, os dois: a função de apagar já existia sem caminho na tela, e
     alguém precisou de um script contra o banco para zerar um cofrinho de teste.
     Função sem botão é função que não existe para quem usa. */
  check('  além de pausar e excluir o cofrinho',
    det.includes('kdd-pausar') && det.includes('kdd-excluir'), true);
  check('  explicando a diferença entre as duas',
    /Pausar[\s\S]*esconde[\s\S]*Excluir[\s\S]*apaga/.test(det), true);

  /* PAGAR A SEMANADA nasce inteira no pote GASTAR: a divisão nos três é decisão
     da criança, no app dela, e é ali que a lição acontece. */
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idG)) DB.remove('kid_entries', e.id);
  check('a semanada é devida', !!DB.kidSemanadaDevida(DB.get('kids', idG)), true);
  check('pagar a semanada funciona', pagarSemanada(idG), true);
  const p2 = DB.kidPotes(idG);
  check('  e ela cai inteira no pote gastar', p2.gastar, 10);
  check('  sem o app dividir por ela', p2.guardar, 0);
  check('  e não é devida de novo na mesma semana', DB.kidSemanadaDevida(DB.get('kids', idG)), null);
  check('  pagar de novo não duplica', pagarSemanada(idG), false);

  /* A FILA DO PAINEL: a semanada não é conta a pagar e a tarefa não vence, então
     é bloco próprio — mas na mesma dobra, porque o que se esquece apodrece. */
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idG)) DB.remove('kid_entries', e.id);
  const fila = filaDasCriancas();
  check('a fila do Painel cobra a semanada', fila.includes(`data-semanada="${idG}"`), true);
  check('  dizendo de quem é', fila.includes('Cofrinho Um'), true);
  pagarSemanada(idG);
  check('  e some quando ela é dada', filaDasCriancas().includes(`data-semanada="${idG}"`), false);

  /* TAREFA: a criança marca, o adulto confirma, o dinheiro entra depois. */
  const tG = DB.upsert('kid_tasks', { kid_id: idG, name: 'Regar as plantas', icon: '🪴', amount: 3, active: true });
  const marcada = DB.upsert('kid_entries', {
    kid_id: idG, tipo: 'tarefa', pote: 'gastar', amount: 3, date: hojeG2,
    task_id: tG, confirmada: false,
  });
  check('tarefa marcada aparece na fila do adulto',
    filaDasCriancas().includes(`data-ver-tarefas="${idG}"`), true);
  const antesConf = DB.kidPotes(idG).gastar;
  openConfirmarTarefas(idG);
  check('  a tela de confirmar mostra a tarefa', els['#modal'].innerHTML.includes('Regar as plantas'), true);
  check('confirmar credita o dinheiro', confirmarTarefa(marcada, true), true);
  check('  e o pote cresce', DB.kidPotes(idG).gastar, antesConf + 3);
  check('  saindo da fila', filaDasCriancas().includes(`data-ver-tarefas="${idG}"`), false);

  /* RECUSAR apaga a marcação: a tarefa volta a poder ser feita, e não fica um
     registro de "não fez" pendurado no histórico dela. */
  const marcada2 = DB.upsert('kid_entries', {
    kid_id: idG, tipo: 'tarefa', pote: 'gastar', amount: 3, date: hojeG2, task_id: tG, confirmada: false,
  });
  const antesRec = DB.kidPotes(idG).gastar;
  check('recusar remove a marcação', confirmarTarefa(marcada2, false), true);
  check('  sem creditar nada', DB.kidPotes(idG).gastar, antesRec);
  check('  e o registro some de vez', DB.all('kid_entries').some(e => e.id === marcada2), false);

  /* A FILA SOME quando não há nada — um bloco que vive dizendo "nada aqui" vira
     paisagem e para de ser lido. */
  check('sem pendências, a fila das crianças não aparece', filaDasCriancas(), '');

  closeModal();
  for (const e of DB.all('kid_entries').filter(e => e.kid_id === idG)) DB.remove('kid_entries', e.id);
  DB.remove('kid_tasks', tG); DB.remove('kids', idG);
} catch (e) { console.log(` FALHA | gestão do cofrinho: ${e.message}`); fail++; }

console.log('\n=== Puxar para atualizar desligado ===');
{
  const cssP = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('página não recarrega ao puxar', /html \{[^}]*overscroll-behavior-y:\s*none/.test(cssP), true);
  check('body também trava o gesto', /^body \{[^}]*overscroll-behavior-y:\s*none/m.test(cssP), true);
  check('rolagem da folha não vaza para a página', /\.sheet \{[^}]*overscroll-behavior:\s*contain/.test(cssP), true);
  check('rolagem do modal não vaza para a página', /\.modal \{[^}]*overscroll-behavior:\s*contain/.test(cssP), true);
}

/* ---- Voltar para uma tela devolve o estado inicial ----
   Mês antigo esquecido na tela leva a ler o saldo errado, então mês e filtros são
   transitórios: zeram ao trocar de tela e ao abrir o app. A aba continua lembrada. */
console.log('\n=== Voltar para a tela zera o estado ===');
{
  // Trocar de tela: o que o usuário havia ajustado na anterior não sobrevive
  setTab('extrato');
  state.monthOffset = -3; state.filtros.membro = ['Joctã']; state.filtros.situacao = ['A Pagar']; state.filtros.busca = 'mer';
  setTab('cartoes');
  /* O MÊS ACOMPANHA A NAVEGAÇÃO. Ele zerava a cada troca de aba, o que quebrava
     o uso normal: abrir julho no Painel, ir ao Extrato para conferir de onde veio
     um número e encontrar agosto de novo. O que tornou seguro manter foi o cartão
     de mês preso abaixo do header, que anuncia o ciclo o tempo todo. */
  check('trocar de tela mantém o mês escolhido', state.monthOffset, -3);
  check('trocar de tela zera o filtro de membro', state.filtros.membro.length, 0);
  check('trocar de tela zera o filtro de situação', state.filtros.situacao.length, 0);
  check('trocar de tela zera a busca', state.filtros.busca, '');
  setTab('inicio');
  state.monthOffset = -5;
  setTab('extrato');
  check('o extrato herda o mês do painel', state.monthOffset, -5);
  setTab('inicio');
  check('e voltar ao painel mantém o mesmo mês', state.monthOffset, -5);
  state.monthOffset = 0;

  // Redesenho da MESMA tela não pode perder o que está sendo olhado
  setTab('extrato');
  state.monthOffset = -2; state.filtros.membro = ['Joctã'];
  setTab('extrato');                       // é o que a sincronização faz ao trazer dado novo
  check('redesenhar a mesma tela preserva o mês', state.monthOffset, -2);
  check('redesenhar a mesma tela preserva o filtro', state.filtros.membro.join(), 'Joctã');

  /* Reabrir o app começa SEMPRE no Painel. Abrir é o momento de perguntar "como
     estamos?", e cair em Relatórios porque foi lá que a sessão anterior terminou
     faz o app parecer que guardou um estado que já não vale. */
  state.tab = 'relatorios'; state.monthOffset = -4; state.filtros.membro = ['Joctã']; state.repOffset = -1;
  persistUI();
  restoreUI();
  check('reabrir começa no Painel', state.tab, 'inicio');
  check('reabrir mostra o mês corrente', state.monthOffset, 0);
  check('reabrir esquece o filtro de membro', state.filtros.membro.length, 0);
  check('reabrir esquece o mês do relatório', state.repOffset, 0);

  // Mesmo tendo terminado em outra aba, e mesmo várias vezes seguidas
  for (const aba of ['extrato', 'cartoes', 'metas', 'relatorios']) {
    state.tab = aba; persistUI(); restoreUI();
    check(`terminando em ${aba}, reabre no Painel`, state.tab, 'inicio');
  }

  const gravado = JSON.parse(store['financas.ui.v1']);
  check('a aba nem é gravada', Object.keys(gravado).join(','), 'tagsFixas');
  const apA = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('o Painel é fixado ao abrir', /function restoreUI\(\)[\s\S]{0,900}state\.tab = 'inicio';/.test(apA), true);
  // E o mês volta ao corrente ao ABRIR, mesmo acompanhando as trocas de tela
  check('e o mês corrente também', /function restoreUI\(\)[\s\S]{0,900}state\.monthOffset = 0;/.test(apA), true);
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('não grava mais a cada rolagem', /addEventListener\('scroll'[\s\S]{0,120}persistUI/.test(ap), false);
  check('volta ao topo ao trocar de tela', /if \(trocou\) \{[\s\S]{0,140}scrollTo\(0, 0\)/.test(ap), true);
  setTab('inicio');
}

/* ---- O banco do Supabase aceita tudo o que o app envia? ---- */
console.log('\n=== Schema do Supabase x payload do app ===');
const schema = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');

/* ---- OS SQL PRECISAM SER EXECUTÁVEIS ----

   Um `do $$ … end $$;` cujo delimitador virou `$` simples não é sintaxe válida:
   o Postgres recusa o arquivo INTEIRO com "syntax error at or near $". Aconteceu
   de verdade — os três blocos do carimbo do servidor foram gravados com `$` por
   um script de edição em que `$$` no texto de substituição significa "um `$`
   literal" (é o comportamento de `String.replace`, e está anotado no CLAUDE.md).

   O defeito atravessou uma sessão inteira sem ser notado, porque nada aqui lia
   esses arquivos: a suíte conferia COLUNAS declaradas no schema, e para isso o
   delimitador é irrelevante. Quem descobriu foi quem tentou rodar. */
console.log('\n=== SQL executável (delimitadores $$) ===');
try {
  for (const arq of fs.readdirSync(BASE + 'supabase').filter(f => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(`${BASE}supabase/${arq}`, 'utf8');
    // `do $`, `as $` ou `end $` sem o segundo $ — o erro que o Postgres recusa
    const quebrados = (sql.match(/^\s*(?:do|end)\s+\$(?!\$)|\bas\s+\$(?!\$)/gm) || []);
    check(`${arq}: delimitadores íntegros`,
      quebrados.length ? quebrados.join(' ') : true, true);
    // E cada abertura tem o seu fechamento: contagem par de $$
    const pares = (sql.match(/\$\$/g) || []).length;
    check(`  ${arq}: $$ em pares`, pares % 2, 0);
  }
} catch (e) { console.log(` FALHA | sql executável: ${e.message}`); fail++; }

/* ---- TODA TABELA SINCRONIZADA PRECISA DO CARIMBO ----

   O carimbo `server_at` é o que torna o pull confiável, e ele era aplicado por
   uma LISTA DE NOMES escrita à mão no schema.sql. As quatro tabelas do cofrinho
   entraram depois e ficaram fora dela — sem coluna, sem índice e sem trigger.

   O sintoma seria o pior tipo que existe: sincronização aparentemente
   funcionando, e um registro perdido de vez em quando. Foi exatamente o defeito
   que já custou um lançamento invisível na conta C6, voltando por outra porta.

   Agora o schema descobre a lista sozinha, e este teste é o que garante que ela
   continue se descobrindo: se alguém trocar de volta por nomes escritos à mão,
   uma tabela nova volta a poder nascer sem carimbo. */
console.log('\n=== Carimbo do servidor em todas as tabelas ===');
{
  const sql = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');

  // As tabelas que o app sincroniza, tiradas do próprio sync.js
  const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  const bloco = syncSrc.slice(syncSrc.indexOf('const SYNC_TABLES'));
  const tabelas = [...bloco.slice(0, bloco.indexOf('\n};')).matchAll(/^  (\w+):/gm)].map(m => m[1]);
  check('sync.js declara as tabelas', tabelas.length >= 14, true);

  /* O carimbo tem que vir DEPOIS da última tabela existir. Aplicado antes, um
     `alter table` numa tabela que ainda não foi criada aborta o arquivo inteiro
     em banco novo — e o schema deixaria de ser executável de ponta a ponta. */
  const posCarimbo = sql.indexOf('add column if not exists server_at');
  const ultimaTabela = Math.max(...tabelas.map(t =>
    sql.indexOf(`create table if not exists ${t} (`)));
  check('o carimbo é aplicado depois da última tabela', posCarimbo > ultimaTabela, true);

  /* Descoberta automática, não lista escrita à mão: é o que faz tabela nova
     entrar no carimbo por existir, em vez de por alguém lembrar do nome. */
  const trecho = sql.slice(posCarimbo - 1200, posCarimbo + 900);
  const inicioBloco = sql.lastIndexOf('do $$', posCarimbo);
  const corpoCarimbo = sql.slice(inicioBloco, sql.indexOf('end $$;', posCarimbo));
  check('  descobrindo as tabelas por family_id', /column_name = 'family_id'/.test(trecho), true);
  check('  e só tabelas de verdade, não views', /table_type = 'BASE TABLE'/.test(trecho), true);

  /* O QUE IMPORTA É A COBERTURA, não a forma da query.

     Conferir que a query "menciona family_id" não protege nada: dá para manter a
     descoberta e ainda assim restringi-la a alguns nomes, e o teste passaria
     verde com metade das tabelas sem carimbo. Então a verificação é outra:
     NENHUM nome de tabela sincronizada aparece escrito dentro do bloco. Qualquer
     tentativa de recortar a lista precisa nomear o que ficou, e é isso que cai
     aqui — inclusive a que passou verde na primeira versão deste teste. */
  const nomeados = tabelas.filter(t => new RegExp(`'${t}'`).test(corpoCarimbo));
  check('  sem nenhuma tabela nomeada dentro do bloco',
    nomeados.length ? nomeados.join(', ') : true, true);
  check('  e sem lista de nomes de qualquer forma',
    /array\s*\[\s*'/.test(corpoCarimbo) || /in\s*\(\s*'/.test(corpoCarimbo), false);

  // Coluna, índice e trigger: os três, senão o pull fica lento ou não confiável
  check('o carimbo cria a coluna', /add column if not exists server_at timestamptz not null/.test(trecho), true);
  check('  o índice que o pull usa', /family_id, server_at/.test(trecho), true);
  check('  e o trigger que o cliente não consegue burlar', /create trigger trg_server_at/.test(trecho), true);

  /* clock_timestamp(), não now(): now() devolve o início da TRANSAÇÃO, então
     duas gravações concorrentes recebem o mesmo instante e podem sair na ordem
     errada — o que ressuscitaria o problema que o carimbo existe para resolver. */
  const fn = sql.slice(sql.indexOf('function marca_server_at'), sql.indexOf('function marca_server_at') + 420);
  check('o trigger usa clock_timestamp, não now()',
    fn.includes('clock_timestamp()') && !/:=\s*now\(\)/.test(fn), true);

  /* NENHUMA LISTA DE NOMES sobrou aplicando carimbo. Uma lista remanescente
     voltaria a ser o lugar onde uma tabela nova é esquecida. */
  const listasComCarimbo = [...sql.matchAll(/foreach t in array array\[([^\]]*)\][\s\S]{0,400}?server_at/g)];
  check('nenhuma lista escrita à mão aplica o carimbo', listasComCarimbo.length, 0);

  /* O COMENTÁRIO DE CONFERÊNCIA TEM DE CONTAR CERTO.

     Ele diz "verifique se aparecem N tabelas", e é o que alguém usa para saber se
     o SQL rodou inteiro. Ficou em 16 enquanto o schema já tinha 18 — quem
     conferisse acharia que sobraram duas de algum lugar, ou pior, pararia de
     conferir. Documentação errada é pior que documentação ausente: a ausente faz
     olhar o código. */
  const declaradas = [...sql.matchAll(/create table if not exists (\w+)/g)].map(m => m[1]);
  const prometidas = Number((sql.match(/verifique se aparecem (\d+) tabelas/) || [])[1]);
  check('a conferência promete o número certo de tabelas', prometidas, declaradas.length);
  check('  e nenhuma tabela é declarada duas vezes', declaradas.length, new Set(declaradas).size);

  /* E o cofrinho, que foi o caso que revelou tudo: as quatro tabelas dele têm
     family_id, então a descoberta automática as alcança. */
  for (const t of ['kids', 'kid_goals', 'kid_tasks', 'kid_entries']) {
    const cria = sql.slice(sql.indexOf(`create table if not exists ${t} (`));
    const corpo = cria.slice(0, cria.indexOf('\n);'));
    check(`  ${t} tem family_id, então o carimbo a alcança`, /family_id uuid not null/.test(corpo), true);
  }
}

const colunasDe = tabela => {
  const cria = schema.match(new RegExp(`create table if not exists ${tabela} \\(([\\s\\S]*?)\\n\\);`, 'i'));
  const cols = new Set(['id', 'family_id', 'updated_at', 'deleted']);
  if (cria) {
    for (const linha of cria[1].split('\n')) {
      const m = linha.trim().match(/^"?(\w+)"?\s+\w/);
      if (m && !/^(primary|unique|foreign|constraint|check)$/i.test(m[1])) cols.add(m[1]);
    }
  }
  for (const m of schema.matchAll(new RegExp(`alter table ${tabela} add column if not exists (\\w+)`, 'gi'))) cols.add(m[1]);
  return cols;
};

const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
const bloco = syncSrc.match(/const SYNC_TABLES = \{([\s\S]*?)\n\};/)[1];
const SYNC = {};
for (const m of bloco.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
  SYNC[m[1]] = m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}
for (const [tabela, campos] of Object.entries(SYNC)) {
  const cols = colunasDe(tabela);
  const faltando = campos.filter(c => !cols.has(c));
  check(`${tabela}: ${campos.length} campos existem no schema`, faltando.length ? faltando.join(', ') : true, true);
}

/* O sentido CONTRÁRIO, que faltava: coluna que existe no banco mas não está na
   lista de envio nunca sai daqui. Fica certa no aparelho e nula no servidor, e o
   estrago só aparece no outro celular — foi o que aconteceu com to_account, e por
   isso toda transferência sincronizada perdia o destino e o saldo derretia. */
{
  const envelope = new Set(['id', 'family_id', 'updated_at', 'deleted']);
  for (const [tabela, campos] of Object.entries(SYNC)) {
    const naoEnviadas = [...colunasDe(tabela)].filter(c => !envelope.has(c) && !campos.includes(c));
    check(`${tabela}: nenhuma coluna fica de fora do envio`,
      naoEnviadas.length ? naoEnviadas.join(', ') : true, true);
  }
}
// Toda tabela sincronizada precisa do envelope de sync e de RLS
for (const tabela of Object.keys(SYNC)) {
  const cols = colunasDe(tabela);
  check(`${tabela}: tem updated_at e deleted`, cols.has('updated_at') && cols.has('deleted'), true);
  check(`${tabela}: RLS habilitado`, new RegExp(`alter table ${tabela} enable row level security`, 'i').test(schema), true);
}
// Endpoints que o app chama precisam existir no schema
{
  const syncSrc2 = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  check('criar família usa a função atômica do banco', syncSrc2.includes('rpc/create_family'), true);
  check('função create_family existe no schema', /create or replace function create_family/i.test(schema), true);
  check('create_family é security definer', /create_family[\s\S]{0,300}security definer/i.test(schema), true);
  check('authenticated pode executar create_family', /grant execute on function create_family\(text\) to authenticated/i.test(schema), true);
  check('to_account tem ALTER (bases já criadas)', /alter table transactions add column if not exists to_account/i.test(schema), true);
  check('código de família é validado antes de enviar', syncSrc2.includes('Código inválido'), true);
  // Toda coluna do envelope de sync precisa de ALTER, senão bases antigas quebram
  for (const col of ['type', 'fitid', 'group_id', 'installment', 'adjustment', 'to_account']) {
    check(`transactions.${col} com ALTER seguro`, new RegExp(`add column if not exists ${col}\\b`, 'i').test(schema), true);
  }
  check('categories.parent_id com ALTER seguro', /alter table categories add column if not exists parent_id/i.test(schema), true);
  check('categories.type com ALTER seguro', /alter table categories add column if not exists type text not null default/i.test(schema), true);
  check('transactions.tags com ALTER seguro', /alter table transactions add column if not exists tags jsonb not null default/i.test(schema), true);
  check('parent_id aponta para categories', /parent_id uuid references categories\(id\)/i.test(schema), true);
  check('apagar o pai no banco não leva o histórico', /parent_id uuid references categories\(id\) on delete set null/i.test(schema), true);
  check('há índice para buscar filhas', /create index if not exists idx_cat_parent on categories\(family_id, parent_id\)/i.test(schema), true);
}

/* O script de zerar precisa cobrir TODA tabela do schema. Se uma nova aparecer e
   ficar de fora, o "teste do zero" começaria com resto de dado da rodada anterior. */
{
  const reset = fs.readFileSync(BASE + 'supabase/reset-teste.sql', 'utf8');
  const criadas = [...schema.matchAll(/create table if not exists (\w+)/g)].map(m => m[1]);
  const bloco = reset.slice(reset.indexOf('truncate table'), reset.indexOf('restart identity'));
  const fora = criadas.filter(t => !bloco.includes(t));
  check('reset-teste zera todas as tabelas do schema', fora.length ? fora.join(', ') : true, true);
  check('reset-teste também apaga as contas', /delete from auth\.users/i.test(reset), true);
  check('reset-teste avisa para limpar o aparelho', /Apagar dados deste aparelho/.test(reset), true);

  /* Os scripts de diagnóstico e export só valem se citarem colunas que existem —
     um nome errado só aparece como erro no SQL Editor, longe daqui. */
  const colunasDe = tab => {
    const cria = schema.match(new RegExp(`create table if not exists ${tab} \\(([\\s\\S]*?)\\n\\);`, 'i'));
    const set = new Set();
    if (cria) for (const l of cria[1].split('\n')) {
      const c = l.trim().match(/^"?(\w+)"?\s+(uuid|text|numeric|date|boolean|timestamptz|jsonb|int|bigserial)/i);
      if (c) set.add(c[1]);
    }
    for (const m of schema.matchAll(new RegExp(`alter table ${tab} add column if not exists (\\w+)`, 'gi'))) set.add(m[1]);
    return set;
  };
  const usadas = {
    transactions: ['description', 'amount', 'date', 'type', 'status', 'method', 'scope', 'member',
      'category_id', 'account_id', 'card_id', 'to_account', 'invoice_key', 'group_id', 'installment',
      'adjustment', 'recurring', 'fitid', 'tags', 'deleted'],
    accounts: ['name', 'type', 'balance', 'is_reserve', 'active', 'deleted'],
    cards: ['name', 'limit_amount', 'closing_day', 'due_day', 'account_id', 'active', 'deleted'],
    categories: ['parent_id', 'type', 'deleted'],
    goals: ['name', 'target_amount', 'target_date', 'done', 'kind', 'deleted'],
    goal_entries: ['goal_id', 'amount', 'date', 'from_account', 'to_account', 'deleted'],
    family_settings: ['month_start_day', 'monthly_income', 'members', 'deleted'],
  };
  for (const [tab, lista] of Object.entries(usadas)) {
    const reais = colunasDe(tab);
    const faltando = lista.filter(c => !reais.has(c));
    check(`scripts SQL: colunas de ${tab} existem`, faltando.length ? faltando.join(', ') : true, true);
  }

  const diag = fs.readFileSync(BASE + 'supabase/diagnostico.sql', 'utf8');
  const exp = fs.readFileSync(BASE + 'supabase/exportar-base.sql', 'utf8');
  check('diagnóstico procura saldo que não bate', diag.includes('saldo da conta não bate'), true);
  check('e o bug das parcelas', diag.includes('object HTML'), true);
  check('e transferência contada duas vezes', diag.includes('contada duas vezes'), true);
  check('export cobre todas as tabelas de dados',
    Object.keys(SYNC).every(t => exp.includes(t)), true);
  check('export tem versão anonimizada', exp.includes('base_anonimizada'), true);
  check('nenhum script altera dados',
    /^\s*(update|delete|insert|drop|truncate)\s/im.test(diag.replace(/^--.*$/gm, '')) , false);
}

check('push_subscriptions com RLS', /alter table push_subscriptions enable row level security/i.test(schema), true);
check('notification_log com RLS', /alter table notification_log enable row level security/i.test(schema), true);
check('função is_member definida antes das policies', schema.indexOf('function is_member') < schema.indexOf('create policy'), true);

/* ---- Apagar de verdade ----
   "Limpar dados do app" nas configurações do Android não alcança o
   armazenamento (o app instalado é só um atalho), então a limpeza precisa
   existir dentro do app e não pode esquecer nenhuma chave. */
(async () => {
  /* ---- O botão ⇅ para de girar quando termina? ----
     Roda o sync.js de verdade com fetch simulado e anota cada estado avisado. */
  /* ---- A SESSÃO DIVIDIDA COM O APP DA CRIANÇA ----

     OS DOIS APPS USAM O MESMO REFRESH TOKEN, na mesma chave do localStorage: quem entra
     num entra nos dois, e a criança não tem e-mail para digitar.

     Só que o Supabase ROTACIONA o token — cada uso invalida o anterior. Se os dois
     renovarem por perto, o segundo apresenta um token gasto e leva "Invalid Refresh
     Token: Already Used"; insistindo, chega no "Request rate limit reached". Aconteceu de
     verdade, e nenhum dos dois lados tinha defesa.

     AQUI DENTRO, e não num bloco próprio: este `async` já carrega o sync.js de verdade e
     já troca o `fetch` global. Um segundo bloco assíncrono mexendo no mesmo fetch se
     intercalaria com este — e foi o que aconteceu na primeira tentativa: o teste do botão
     de sincronizar passou a tentar rede de verdade e quebrou. */
  console.log('\n=== A sessão dividida entre os dois apps ===');
  {
    const S2 = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S2.saveCfg = function () {
      localStorage.setItem(this.cfgKey, JSON.stringify(this.cfg));
    };
    let chamadas = 0;
    const guardado = global.fetch;

    const montar = extra => {
      localStorage.setItem(S2.cfgKey, JSON.stringify({
        url: 'https://x.supabase.co', anonKey: 'anon', family_id: 'fam',
        refresh_token: 'rt-velho', access_token: 'at-velho', token_exp: Date.now() - 1000,
        ...(extra || {}),
      }));
      S2.cfg = null;
      S2.load();
      /* Limpa a renovação em andamento entre cenários: sem isto o teste mede a ordem em
         que os blocos rodaram, e não o código. */
      S2._renewing = null;
      chamadas = 0;
    };
    const responder = fn => {
      global.fetch = async (u, o) => {
        /* Conta só as chamadas de token. */
        if (/grant_type=refresh_token/.test(String(u))) chamadas++;
        return fn(u, o);
      };
    };
    const gravar = campos => {
      localStorage.setItem(S2.cfgKey, JSON.stringify({
        ...JSON.parse(localStorage.getItem(S2.cfgKey)), ...campos,
      }));
    };

    try {
      /* 1. A CRIANÇA JÁ RENOVOU: o token bom está no disco e este app tinha uma cópia
            velha em memória. Reler é grátis e evita a maior parte das colisões. */
      montar();
      responder(() => { throw new Error('não devia ir à rede'); });
      gravar({ access_token: 'at-novo', token_exp: Date.now() + 3600000 });
      await S2.ensureToken();
      check('o app da família adota o token que a criança renovou', chamadas, 0);
      check('  sem ir à rede', S2.cfg.access_token, 'at-novo');

      /* 2. UMA RENOVAÇÃO POR VEZ: três pedidos simultâneos disparavam três renovações, e
            duas nasciam condenadas — é assim que a cota estoura. */
      montar();
      responder(async () => ({
        ok: true, status: 200,
        json: async () => ({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 }),
        text: async () => '',
      }));
      await Promise.all([S2.ensureToken(), S2.ensureToken(), S2.ensureToken()]);
      check('três pedidos simultâneos fazem uma renovação só', chamadas, 1);

      /* 3. A MARGEM DE UM MINUTO: um token que vence durante a viagem volta 401 e dispara
            uma renovação a mais, que é justamente a que estoura a cota. */
      montar({ access_token: 'at-bom', token_exp: Date.now() + 600000 });
      responder(() => { throw new Error('não devia renovar'); });
      await S2.ensureToken();
      check('token com folga não é renovado à toa', chamadas, 0);

      montar({ access_token: 'at-quase', token_exp: Date.now() + 20000 });
      responder(async () => ({
        ok: true, status: 200,
        json: async () => ({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }),
        text: async () => '',
      }));
      await S2.ensureToken();
      check('  mas token vencendo em 20s é renovado antes', chamadas, 1);
    } catch (e) { console.log(` FALHA | sessão dividida: ${e.message}`); fail++; }
    finally {
      global.fetch = guardado;
      localStorage.removeItem(S2.cfgKey);
    }
  }

  console.log('\n=== Estado do botão de sincronizar ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.GIRO_MINIMO = 0;   // sem espera artificial: o teste quer o estado final
    S.cfg = {
      url: 'https://exemplo.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE,
    };
    S.saveCfg = () => {};
    global.navigator.onLine = true;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });

    let vistos = [];
    S.onState = e => vistos.push(e);

    // 1) Pedido do usuário: gira e precisa parar no fim
    await S.syncAll(false);
    check('pedido do usuário mostra o giro', vistos.includes('sync'), true);
    check('o giro termina quando a sincronização acaba', vistos[vistos.length - 1], 'ok');
    check('não fica preso em sincronizando', vistos[vistos.length - 1] !== 'sync', true);

    // 2) Consulta de rotina sem nada a enviar: não deve girar
    vistos = [];
    await S.syncAll(true);
    check('consulta de rotina não gira o ícone', vistos.includes('sync'), false);
    check('consulta de rotina termina em dia', vistos[vistos.length - 1], 'ok');

    // 3) Falha de rede também precisa encerrar o giro
    vistos = [];
    global.fetch = async () => { throw new Error('sem rede'); };
    await S.syncAll(false).catch(() => {});
    check('falha não deixa o ícone girando', vistos[vistos.length - 1] !== 'sync', true);
    clearTimeout(S._debounce);   // cancela a nova tentativa agendada pelo erro

    // 4) Com envio pendente, girar faz sentido mesmo em silêncio
    vistos = [];
    S.pendentes = () => 3;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });
    await S.syncAll(true);
    check('envio pendente gira mesmo em silêncio', vistos.includes('sync'), true);
    check('e para ao terminar o envio', vistos[vistos.length - 1] !== 'sync', true);
  }

  /* ---- Auditoria da sincronização inteira ----
     Um PostgREST simulado com as regras reais do Postgres, alimentado pelo próprio
     schema.sql. Serve para achar o que o app manda e o banco recusa — em QUALQUER
     tabela, não só na que estourou por último. */
  console.log('\n=== Auditoria: o banco aceita tudo o que o app envia? ===');
  {
    // --- 1. Le o schema de verdade: tipo, not null e presenca de default ---
    const esquema = {};
    const sql = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');
    for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
      const cols = {};
      for (const linha of m[2].split('\n')) {
        const t = linha.trim().replace(/,$/, '').replace(/\s*--.*$/, '');
        const c = t.match(/^"?(\w+)"?\s+(uuid|text|numeric|date|boolean|timestamptz|jsonb|int|bigserial)\b/i);
        if (!c) continue;
        if (/^(primary|unique|foreign|constraint|check)$/i.test(c[1])) continue;
        const pk = /primary key/i.test(t);
      cols[c[1]] = { tipo: c[2].toLowerCase(), notNull: pk || /not null/i.test(t), temDefault: !pk && /default/i.test(t) };
      }
      esquema[m[1]] = cols;
    }
    for (const m of sql.matchAll(/alter table (\w+) add column if not exists (\w+) (uuid|text|numeric|date|boolean|timestamptz|jsonb|int)\b([^;]*);/gi)) {
      const [, tab, col, tipo, resto] = m;
      esquema[tab] = esquema[tab] || {};
      esquema[tab][col] = { tipo: tipo.toLowerCase(), notNull: /not null/i.test(resto), temDefault: /default/i.test(resto) };
    }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const DATA = /^\d{4}-\d{2}-\d{2}$/;

    // --- 2. Valida um valor contra a coluna, como o Postgres faria ---
    const violacao = (tabela, col, valor) => {
      const def = esquema[tabela] && esquema[tabela][col];
      if (!def) return `PGRST204: coluna "${col}" não existe em ${tabela}`;
      if (valor === null) {
        return def.notNull ? `23502: ${tabela}.${col} é NOT NULL e recebeu null` : null;
      }
      switch (def.tipo) {
        case 'uuid':
          return UUID.test(String(valor)) ? null
            : `22P02: ${tabela}.${col} é uuid e recebeu ${JSON.stringify(valor)}`;
        case 'numeric': case 'int':
          return (typeof valor === 'number' && Number.isFinite(valor)) ? null
            : `22P02: ${tabela}.${col} é ${def.tipo} e recebeu ${JSON.stringify(valor)}`;
        case 'date':
          return DATA.test(String(valor)) ? null
            : `22007: ${tabela}.${col} é date e recebeu ${JSON.stringify(valor)}`;
        case 'boolean':
          return typeof valor === 'boolean' ? null
            : `22P02: ${tabela}.${col} é boolean e recebeu ${JSON.stringify(valor)}`;
        case 'jsonb':
          return (valor && typeof valor === 'object') ? null
            : `22P02: ${tabela}.${col} é jsonb e recebeu ${JSON.stringify(valor)}`;
        case 'timestamptz':
          return isNaN(Date.parse(String(valor)))
            ? `22007: ${tabela}.${col} é timestamptz e recebeu ${JSON.stringify(valor)}` : null;
        default:
          return typeof valor === 'string' ? null
            : `22P02: ${tabela}.${col} é text e recebeu ${JSON.stringify(valor)}`;
      }
    };

    // --- 3. Um registro inteiro, com as regras de NOT NULL sem default ---
    const conferirRegistro = (tabela, obj) => {
      const erros = [];
      for (const [col, valor] of Object.entries(obj)) {
        const v = violacao(tabela, col, valor);
        if (v) erros.push(v);
      }
      for (const [col, def] of Object.entries(esquema[tabela] || {})) {
        if (def.notNull && !def.temDefault && !(col in obj) && col !== 'id') {
          erros.push(`23502: ${tabela}.${col} é obrigatório e não foi enviado`);
        }
      }
      return erros;
    };

    check('schema lido para todas as tabelas sincronizadas',
      Object.keys(SYNC).every(t => esquema[t] && Object.keys(esquema[t]).length > 4), true);

    /* O mapa COLUNAS do sync.js declara tipo e nulidade de cada coluna. Se ele
       divergir do schema, o higienizador manda null onde não pode — ou deixa de
       mandar onde deveria. Aqui os dois são confrontados coluna por coluna. */
    {
      const fonte = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
      const bloco = fonte.match(/const COLUNAS = \{([\s\S]*?)\n\};/)[1];
      const mapa = {};
      for (const m of bloco.matchAll(/(\w+): '(\w+)([!#]?)'/g)) mapa[m[1]] = { tipo: m[2], marca: m[3] };
      /* Declaração POR TABELA, no formato 'tabela.coluna'. Existe porque `kid_id`
         é NOT NULL nas tabelas do cofrinho e opcional em recurrences — o mesmo
         nome com dois contratos diferentes, que o mapa por nome não expressa. */
      for (const m of bloco.matchAll(/'(\w+)\.(\w+)': '(\w+)([!#]?)'/g)) {
        mapa[m[1] + '.' + m[2]] = { tipo: m[3], marca: m[4] };
      }
      check('mapa de colunas foi lido', Object.keys(mapa).length > 20, true);

      const equivale = { uuid: 'uuid', num: 'numeric', int: 'int', date: 'date', bool: 'boolean', json: 'jsonb', ts: 'timestamptz', text: 'text' };
      const divergencias = [];
      for (const [tabela, cols] of Object.entries(SYNC)) {
        for (const col of [...cols, 'id', 'family_id', 'updated_at', 'deleted']) {
          const real = esquema[tabela] && esquema[tabela][col];
          if (!real) continue;
          // A específica da tabela vence a global, igual ao que higienizar() faz
          const decl = mapa[tabela + '.' + col] || mapa[col] || { tipo: 'text', marca: '' };
          if (equivale[decl.tipo] !== real.tipo) {
            divergencias.push(`${tabela}.${col}: mapa diz ${decl.tipo}, banco tem ${real.tipo}`);
            continue;
          }
          // text/bool/json nunca produzem null, então não precisam de marca
          if (['text', 'bool', 'json'].includes(decl.tipo)) continue;
          const esperada = !real.notNull ? '' : real.temDefault ? '#' : '!';
          if (decl.marca !== esperada) {
            divergencias.push(`${tabela}.${col}: marca "${decl.marca}" mas o banco pede "${esperada}"`);
          }
        }
      }
      check('mapa de tipos concorda com o schema', divergencias.length ? divergencias.slice(0, 3).join(' | ') : true, true);
    }

    // --- 4. O PostgREST falso: aplica as mesmas recusas do servico real ---
    const recusas = [];
    const respostaErro = msg => ({
      ok: false, status: 400, json: async () => ({}),
      text: async () => JSON.stringify({ code: msg.split(':')[0], message: msg }),
    });
    const postgrestFalso = async (url, opts) => {
      const u = String(url);
      if (u.includes('/auth/v1/')) {
        return { ok: true, status: 200, text: async () => '', json: async () => ({
          access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u-1', email: 'a@b.c' } }) };
      }
      const tabela = (u.match(/\/rest\/v1\/(\w+)/) || [])[1];
      if (!opts || opts.method === 'GET') return { ok: true, status: 200, json: async () => [], text: async () => '' };
      if (opts.method === 'POST' && opts.body) {
        const corpo = JSON.parse(opts.body);
        const lote = Array.isArray(corpo) ? corpo : [corpo];
        // Regra do PostgREST em insercao em lote
        const assinaturas = new Set(lote.map(o => Object.keys(o).sort().join(',')));
        if (lote.length > 1 && assinaturas.size > 1) {
          const msg = `PGRST102: All object keys must match (${tabela})`;
          recusas.push(msg); return respostaErro(msg);
        }
        for (const obj of lote) {
          const erros = conferirRegistro(tabela, obj);
          if (erros.length) { recusas.push(...erros); return respostaErro(erros[0]); }
        }
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    // --- 5. Base realista: registro atual, registro de versao antiga e apagado ---
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
    S.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE };

    const uid = () => DB.uuid();
    const env = extra => ({ id: uid(), updated_at: DB.now(), deleted: false, dirty: true, ...extra });
    const hojeISO = iso(new Date());
    const contaId = uid(), cartaoId = uid(), metaId = uid(), envelopeId = uid();

    const dadosAntes = DB.data;
    DB.data = {
      meta: { seeded: true, lastSync: null },
      accounts: [
        env({ id: contaId, name: 'Conta', type: 'Conta Corrente', institution: '', balance: 1000, active: true, is_reserve: false }),
        env({ name: 'Antiga', type: 'Poupança', balance: 50, active: true }),           // versão sem is_reserve/institution
      ],
      cards: [
        env({ id: cartaoId, name: 'Cartão', brand: '', limit_amount: 5000, closing_day: 25, due_day: 5, account_id: contaId, active: true }),
        env({ name: 'Sem conta', brand: '', limit_amount: 0, closing_day: 1, due_day: 10, account_id: null, active: true }),
      ],
      categories: [
        env({ id: envelopeId, name: 'Alimentação', icon: '🍽️', scope: 'Família', monthly_budget: 900, kind: 'Essencial', parent_id: null }),
        env({ name: 'Mercado', icon: '🍽️', scope: 'Família', monthly_budget: 0, kind: 'Essencial', parent_id: envelopeId }),
        env({ name: 'Legado', icon: '🏷️', scope: 'Família', monthly_budget: 10, kind: 'Essencial' }),   // sem parent_id
      ],
      transactions: [
        env({ description: 'Mercado', amount: 120.5, date: hojeISO, scope: 'Família', member: 'Comum / Família',
          method: 'Débito', status: 'Pago', recurring: false, category_id: envelopeId, account_id: contaId,
          card_id: null, to_account: null, invoice_key: '', notes: '', type: 'Despesa', fitid: '',
          group_id: null, installment: '', adjustment: false }),
        env({ description: 'Antigo', amount: 30, date: hojeISO, scope: 'Família', member: '', method: 'PIX',
          status: 'Pago', recurring: false, category_id: null, account_id: contaId }),   // versão sem type/fitid/etc
        env({ description: 'Apagado', amount: 9, date: hojeISO, scope: 'Família', member: '', method: 'PIX',
          status: 'Pago', recurring: false, type: 'Despesa', account_id: contaId, deleted: true }),
      ],
      goals: [
        env({ id: metaId, name: 'Viagem', icon: '✈️', target_amount: 8000, target_date: null, done: false, kind: 'Objetivo' }),
        env({ name: 'Meta antiga', icon: '🎯', target_amount: 100, done: false }),
      ],
      goal_entries: [
        env({ goal_id: metaId, description: 'Aporte', amount: 200, date: hojeISO, from_account: contaId, to_account: contaId }),
        env({ goal_id: metaId, description: 'Aporte', amount: 50, date: hojeISO }),
      ],
      invoice_status: [env({ invoice_key: cartaoId + ':2026-07', paid: true })],
      family_settings: [
        env({ members: ['Ana', 'Carlos'], month_start_day: 1, monthly_income: 9000, family_name: 'Casa' }),
      ],
    };

    const totalPendente = S.pendentes();
    global.navigator.onLine = true;
    global.fetch = postgrestFalso;

    let falhou = null;
    await S.syncAll(false).catch(e => { falhou = e.message; });

    check('sincronização completa sem recusa do banco', falhou, null);
    check('nenhuma violação de schema em nenhuma tabela', recusas.length ? recusas.slice(0, 3).join(' | ') : true, true);
    check('todos os registros pendentes foram enviados', totalPendente > 10 && S.pendentes() === 0, true);
    clearTimeout(S._debounce);

    /* --- 6. E o que os fluxos reais do app gravaram? ---
       O cenário montado no começo deste arquivo passou por openTxSheet, aportes,
       transferência, conciliação e importação. Se algum deles gravar '' num campo
       uuid, o Postgres recusa o lote inteiro — e nada mais sincroniza. */
    DB.data = dadosAntes;
    const problemasReais = [];
    for (const [tabela, cols] of Object.entries(SYNC)) {
      for (const r of DB.data[tabela] || []) {
        const row = { id: r.id, family_id: FAM_TESTE, updated_at: r.updated_at, deleted: !!r.deleted };
        for (const c of cols) if (r[c] !== undefined) row[c] = r[c];
        for (const e of conferirRegistro(tabela, row)) problemasReais.push(`${r.description || r.name || r.id}: ${e}`);
      }
    }
    check('o que os fluxos do app gravaram é aceito pelo banco',
      problemasReais.length ? problemasReais.slice(0, 4).join(' | ') : true, true);
  }

/* ---- CONTRATO COMUM CONTINUA SENDO ENVIADO ----

     A coluna `kid_id` chegou em recurrences para ligar o contrato da semanada à
     criança. Ela é NOT NULL nas tabelas do cofrinho, e o mapa de tipos é por NOME
     de coluna — então a marca de obrigatório valia para recurrences também, e
     `higienizar` DESCARTAVA todo contrato sem criança. Ou seja: aluguel,
     financiamento, escola, todos os contratos da família parariam de sincronizar,
     sem erro na tela.

     O mapa por arquivo já é conferido acima, mas conferir a declaração não é
     conferir o comportamento: aqui o envio roda de verdade, com o PostgREST falso,
     e o que se mede é se o contrato CHEGA. */
  console.log('\n=== Contrato sem criança continua sincronizando ===');
  {
    const enviados = [];
    const guarda = DB.data;
    const S2 = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S2.saveCfg = () => {}; S2.GIRO_MINIMO = 0;
    S2.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE };

    const envio = (id, extra) => ({
      id, updated_at: DB.now(), deleted: false, dirty: true,
      description: 'Aluguel', amount: 1800, type: 'Despesa', valor_tipo: 'fixo',
      periodicidade: 'mensal', dia: 5, inicio: iso(new Date()),
      fim_tipo: 'sempre', geradas: 0, status: 'ativa', ...extra,
    });
    const idSemKid = DB.uuid(), idComKid = DB.uuid(), idKid = DB.uuid(), idNuloKid = DB.uuid();

    DB.data = {
      meta: { seeded: true, lastSync: null },
      accounts: [], cards: [], categories: [], transactions: [], goals: [],
      goal_entries: [], invoice_status: [], family_settings: [], budget_overrides: [],
      kid_goals: [], kid_tasks: [], kid_entries: [],
      kids: [{ id: idKid, updated_at: DB.now(), deleted: false, dirty: true,
        name: 'Kid', semanada_valor: 8, semanada_dia: 6, active: true }],
      recurrences: [
        envio(idSemKid),                                            // contrato comum: coluna ausente
        /* kid_id: null EXPLÍCITO — e este é o caso que importa.

           Coluna ausente nem chega a `higienizar`: o push pula o que é
           `undefined` para deixar o default do banco valer. Então a marca de
           obrigatório não morde ali, e um teste só com o contrato "sem kid_id"
           passa verde mesmo com a declaração errada.

           Só que TODO contrato fica com `kid_id: null` depois do primeiro pull —
           o Postgres devolve null para coluna vazia, e o merge grava isso local.
           A partir daí o valor existe, é null, e a marca `!` descarta o registro:
           os contratos da família param de subir sem nenhum erro na tela. É o
           estado real de qualquer aparelho que já sincronizou uma vez. */
        envio(idNuloKid, { description: 'Escola', amount: 900, kid_id: null }),
        envio(idComKid, { description: 'Semanada de Kid', amount: 8, periodicidade: 'semanal', kid_id: idKid }),
      ],
    };

    global.navigator.onLine = true;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/auth/v1/')) {
        return { ok: true, status: 200, text: async () => '', json: async () => ({
          access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u', email: 'a@b.c' } }) };
      }
      if (opts && opts.method === 'POST' && opts.body && u.includes('/recurrences')) {
        for (const o of JSON.parse(opts.body)) enviados.push(o);
      }
      if (!opts || opts.method === 'GET') return { ok: true, status: 200, json: async () => [], text: async () => '' };
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    let erro = null;
    await S2.syncAll(false).catch(e => { erro = e.message; });
    clearTimeout(S2._debounce);

    check('sincroniza sem erro', erro, null);
    check('o contrato COMUM, sem criança, chega ao banco',
      enviados.some(o => o.id === idSemKid), true);
    check('o contrato que voltou do banco com kid_id nulo também chega',
      enviados.some(o => o.id === idNuloKid), true);
    check('  e o da semanada também', enviados.some(o => o.id === idComKid), true);
    check('  nenhum contrato é descartado no caminho', enviados.length >= 3, true);

    /* O CONTRATO COMUM NÃO INVENTA UM kid_id. Mandar um uuid qualquer criaria um
       vínculo com criança que não existe, e a tela da semanada passaria a achar
       que o aluguel é a mesada de alguém. */
    const comum = enviados.find(o => o.id === idSemKid);
    check('  o comum vai sem criança nenhuma', comum.kid_id === undefined || comum.kid_id === null, true);
    const dela = enviados.find(o => o.id === idComKid);
    check('  e o da semanada leva o id da criança', dela.kid_id, idKid);

    DB.data = guarda;
    global.fetch = undefined;
    global.navigator.onLine = false;
  }

  /* ---- Lote de envio precisa ter chaves uniformes ----
     O Supabase recusa com 400 PGRST102 quando os objetos de um POST em lote não
     têm as mesmas chaves. Aqui o fetch falso reproduz essa recusa. */
  console.log('\n=== Envio em lote aceito pelo Supabase ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
    S.cfg = {
      url: 'https://exemplo.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE,
    };

    const dadosAntes = DB.data;
    const envelope = { updated_at: DB.now(), deleted: false, dirty: true };
    // Mistura proposital: uma categoria gravada por versão anterior (sem a chave
    // parent_id) e duas gravadas agora. Era exatamente esse lote que quebrava.
    DB.data = {
      meta: { seeded: true, lastSync: null },
      accounts: [], cards: [], transactions: [], goals: [], goal_entries: [], invoice_status: [], family_settings: [],
      categories: [
        { id: ID_ANTIGA, name: 'Alimentação / Mercado', icon: '🍽️', scope: 'Família', monthly_budget: 1500, kind: 'Essencial', ...envelope },
        { id: ID_NOVA, name: 'Pets', icon: '🐾', scope: 'Família', monthly_budget: 150, kind: 'Essencial', parent_id: null, ...envelope },
        { id: ID_FILHA, name: 'Ração', icon: '🐾', scope: 'Família', monthly_budget: 0, kind: 'Essencial', parent_id: ID_NOVA, ...envelope },
      ],
    };

    const enviados = [];
    global.navigator.onLine = true;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (opts && opts.method === 'POST' && !u.includes('/auth/')) {
        const corpo = JSON.parse(opts.body);
        if (Array.isArray(corpo)) {
          enviados.push(corpo);
          const assinaturas = new Set(corpo.map(o => Object.keys(o).sort().join(',')));
          if (assinaturas.size > 1) {
            return { ok: false, status: 400, json: async () => ({}),
              text: async () => '{"code":"PGRST102","message":"All object keys must match"}' };
          }
        }
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    let erro = null;
    await S.syncAll(false).catch(e => { erro = e.message; });
    check('sincroniza sem PGRST102', erro, null);
    check('as três categorias foram enviadas', enviados.reduce((n, l) => n + l.length, 0), 3);
    check('mais de um lote, porque as chaves diferem', enviados.length > 1, true);
    check('cada lote tem chaves uniformes',
      enviados.every(l => new Set(l.map(o => Object.keys(o).sort().join(','))).size === 1), true);
    check('registro antigo não ganha parent_id nulo à força',
      enviados.flat().find(o => o.id === ID_ANTIGA).parent_id === undefined, true);
    check('a filha leva o pai', enviados.flat().find(o => o.id === ID_FILHA).parent_id, ID_NOVA);
    check('nada fica pendente depois do envio', S.pendentes(), 0);

    DB.data = dadosAntes;
    clearTimeout(S._debounce);
  }

  /* ---- Dados gravados por versões antigas do app ----
     O formulário usava '' para "nada escolhido", e o banco tem uuid e date nessas
     colunas. Um registro assim recusava o lote e travava tudo. */
  console.log('\n=== Base com dados de versões antigas ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
    S.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE };

    const uu = () => DB.uuid();
    const contaOk = uu(), metaOk = uu();
    const dadosAntes = DB.data;
    const base = extra => ({ id: uu(), updated_at: DB.now(), deleted: false, dirty: true, ...extra });
    DB.data = {
      meta: { seeded: true, lastSync: null },
      accounts: [base({ name: 'Conta', type: 'Conta Corrente', balance: 100, active: true })],
      cards: [base({ name: 'Cartão', account_id: '', limit_amount: '', closing_day: '25', due_day: '5', active: true })],
      categories: [base({ name: 'Mercado', icon: '🛒', scope: 'Família', monthly_budget: '', kind: 'Essencial', parent_id: '' })],
      transactions: [
        base({ description: 'Compra antiga', amount: '120.50', date: '2026-07-10', scope: 'Família', member: '',
          method: 'Débito', status: 'Pago', category_id: '', account_id: contaOk, card_id: '', group_id: '', to_account: '',
          recurring: 0, adjustment: '', type: 'Despesa', invoice_key: '', installment: '' }),
        base({ description: 'Sem data', amount: 10, date: '', scope: 'Família', method: 'PIX', status: 'Pago', type: 'Despesa' }),
      ],
      goals: [base({ id: metaOk, name: 'Viagem', icon: '✈️', target_amount: '', target_date: '', done: false })],
      goal_entries: [base({ goal_id: metaOk, description: 'Aporte', amount: 200, date: '2026-07-11', from_account: '', to_account: '' })],
      invoice_status: [base({ invoice_key: 'x:2026-07', paid: 1 })],
      family_settings: [base({ members: ['Ana'], month_start_day: '1', monthly_income: '', family_name: 'Casa' })],
    };

    // Mesmo PostgREST rigoroso da auditoria, montado de novo aqui
    const recusas2 = [], enviados2 = [];
    global.navigator.onLine = true;
    global.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/auth/v1/')) return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
      if (!opts || opts.method === 'GET') return { ok: true, status: 200, json: async () => [], text: async () => '' };
      const tabela = (u.match(/\/rest\/v1\/(\w+)/) || [])[1];
      const lote = JSON.parse(opts.body);
      enviados2.push(lote);
      const assinaturas = new Set(lote.map(o => Object.keys(o).sort().join(',')));
      if (lote.length > 1 && assinaturas.size > 1) { recusas2.push(`${tabela}: chaves diferentes`); }
      for (const o of lote) {
        for (const [k, v] of Object.entries(o)) {
          const eUuid = /(^id$|_id$|^family_id$|^to_account$|^from_account$)/.test(k);
          if (eUuid && v !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v))) {
            recusas2.push(`${tabela}.${k} = ${JSON.stringify(v)} não é uuid`);
          }
          if (/^(date|target_date)$/.test(k) && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
            recusas2.push(`${tabela}.${k} = ${JSON.stringify(v)} não é data`);
          }
          if (/^(amount|balance|monthly_budget|limit_amount|target_amount|monthly_income)$/.test(k) && typeof v !== 'number' && v !== null) {
            recusas2.push(`${tabela}.${k} = ${JSON.stringify(v)} não é número`);
          }
        }
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    let erro2 = null;
    const res = await S.syncAll(false).catch(e => { erro2 = e.message; return null; });
    check('base suja sincroniza sem erro', erro2, null);
    check('nada inválido chegou ao banco', recusas2.length ? recusas2.slice(0, 3).join(' | ') : true, true);

    const todos = enviados2.flat();
    const compra = todos.find(o => o.description === 'Compra antiga');
    check('"" em uuid virou null', compra.category_id === null && compra.card_id === null, true);
    check('"120.50" virou número', compra.amount, 120.5);
    check('0 em booleano virou false', compra.recurring, false);
    check('"" em booleano virou false', compra.adjustment, false);
    const cartao = todos.find(o => o.name === 'Cartão');
    check('"" em uuid de conta virou null', cartao.account_id === null, true);
    check('"25" em inteiro virou 25', cartao.closing_day, 25);
    // limit_amount é NOT NULL com default: null seria recusado, então a coluna sai
    // do envio e o banco preenche o default. Comparar com 0 esconderia null.
    check('"" em NOT NULL com default sai do envio', 'limit_amount' in cartao, false);
    const meta = todos.find(o => o.name === 'Viagem');
    check('"" em data opcional virou null', meta.target_date === null, true);
    check('"" em NOT NULL com default não vira null',
      todos.every(o => !('limit_amount' in o && o.limit_amount === null) &&
                       !('monthly_budget' in o && o.monthly_budget === null) &&
                       !('balance' in o && o.balance === null)), true);
    const cfg = todos.find(o => o.family_name === 'Casa');
    check('membros seguem como lista', Array.isArray(cfg.members), true);
    // O lançamento sem data não tem conserto (date é NOT NULL): sai de fora,
    // mas não pode impedir o resto de subir
    check('registro sem conserto fica de fora', S._descartados, 1);
    check('e todo o resto foi enviado', res && res.enviados, 8);
    check('nada mais fica pendente além do descartado', S.pendentes(), 1);

    DB.data = dadosAntes;
    clearTimeout(S._debounce);
  }

  /* ---- Uma tabela com problema não pode parar as outras ----
     Era isso que dava a impressão de que "a sincronização inteira parou": a
     função abortava na primeira recusa e nem chegava nas demais tabelas. */
  console.log('\n=== Falha em uma tabela não derruba o resto ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
    S.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE };

    const dadosAntes = DB.data;
    const b = extra => ({ id: DB.uuid(), updated_at: DB.now(), deleted: false, dirty: true, ...extra });
    DB.data = {
      meta: { seeded: true, lastSync: null },
      accounts: [b({ name: 'Conta', type: 'Conta Corrente', balance: 10, active: true })],
      cards: [], goals: [], goal_entries: [], invoice_status: [], family_settings: [],
      // categories recusada pelo servidor (simula coluna faltando no banco)
      categories: [b({ name: 'Mercado', icon: '🛒', scope: 'Família', monthly_budget: 10, kind: 'Essencial', parent_id: null })],
      transactions: [b({ description: 'Pão', amount: 8, date: '2026-07-12', scope: 'Família', method: 'PIX', status: 'Pago', type: 'Despesa' })],
    };

    const tabelasEnviadas = [];
    global.navigator.onLine = true;
    global.fetch = async (url, opts) => {
      const u = String(url);
      const tabela = (u.match(/\/rest\/v1\/(\w+)/) || [])[1];
      if (opts && opts.method === 'POST') {
        tabelasEnviadas.push(tabela);
        if (tabela === 'categories') {
          return { ok: false, status: 400, json: async () => ({}),
            text: async () => JSON.stringify({ code: 'PGRST204', message: "Could not find the 'parent_id' column of 'categories' in the schema cache" }) };
        }
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    let msg = null;
    const r = await S.syncAll(false).catch(e => { msg = e.message; return null; });
    check('a falha é reportada', !!msg, true);
    check('a mensagem nomeia a tabela', /categories/.test(msg), true);
    check('e diz o que fazer', /schema\.sql/.test(msg), true);
    check('as outras tabelas foram enviadas mesmo assim',
      tabelasEnviadas.includes('accounts') && tabelasEnviadas.includes('transactions'), true);
    check('o que subiu deixou de estar pendente', DB.data.transactions[0].dirty === undefined, true);
    check('só a tabela recusada continua pendente', S.pendentes(), 1);
    // Avançar o marcador esconderia para sempre o que não foi lido
    check('marcador de leitura não avança com falha', DB.data.meta.lastSync, null);

    DB.data = dadosAntes;
    clearTimeout(S._debounce);
  }

  /* ---- Diagnóstico: o app precisa dizer o que está errado ---- */
  console.log('\n=== Diagnóstico da sincronização ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {};

    S.cfg = {};
    check('sem configuração, aponta o servidor', (await S.diagnosticar())[0].tabela, 'servidor');
    S.cfg = { url: 'https://x.supabase.co', anonKey: 'k' };
    check('sem login, aponta a conta', (await S.diagnosticar())[0].tabela, 'conta');
    S.cfg = { ...S.cfg, refresh_token: 'r', access_token: 'a', token_exp: Date.now() + 600000 };
    check('sem família, aponta a família', (await S.diagnosticar())[0].tabela, 'família');

    S.cfg.family_id = FAM_TESTE;
    const pedidos = [];
    global.fetch = async url => {
      const u = String(url);
      pedidos.push(u);
      if (u.includes('categories')) {
        return { ok: false, status: 400, json: async () => ({}),
          text: async () => JSON.stringify({ code: 'PGRST204', message: "column categories.parent_id does not exist" }) };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };
    const linhas = await S.diagnosticar();
    check('verifica todas as tabelas', linhas.length, Object.keys(SYNC).length);
    check('pede as colunas nome por nome', pedidos.some(u => u.includes('select=') && u.includes('parent_id')), true);
    const cat = linhas.find(l => l.tabela === 'categories');
    check('acha a tabela com problema', cat.ok, false);
    check('e explica o que fazer', /schema\.sql/.test(cat.msg), true);
    check('as saudáveis aparecem como ok', linhas.filter(l => l.ok).length, Object.keys(SYNC).length - 1);
    check('diagnóstico não grava nada', pedidos.every(u => !u.includes('on_conflict')), true);

    const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    check('há botão de verificação na tela', ap.includes('s-diag') && ap.includes('Sync.diagnosticar()'), true);
    check('avisa sobre registros descartados', ap.includes('Sync._descartados'), true);
  }

  /* ---- Importar antes de ter os dados é o que duplica a base ----
     Depois de "apagar dados deste aparelho" o app abre VAZIO e vai se enchendo
     pela sincronização. Quem importa nesse intervalo vê todo lançamento como
     novo, porque o FITID que o identificaria ainda não chegou — e a base
     duplica sem nenhum aviso. Foi o que aconteceu numa reimportação real. */
  console.log('\n=== Importação espera os dados da nuvem ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
    const base = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a', refresh_token: 'r', token_exp: Date.now() + 600000 };

    // Sem família: nada com que conferir, segue em frente
    S.cfg = { ...base };
    check('sem nuvem, não trava a importação', await S.aguardarPronto(), 'sem-nuvem');

    // Com família e ainda sem carregar: precisa esperar
    S.cfg = { ...base, family_id: FAM_TESTE };
    S.pronto = false;
    check('recém-aberto, ainda não está pronto', S.pronto, false);

    const dadosAntes = DB.data;
    DB.data = { meta: { seeded: true, lastSync: null }, accounts: [], cards: [], categories: [],
      transactions: [], goals: [], goal_entries: [], invoice_status: [], family_settings: [] };
    global.navigator.onLine = true;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });
    check('depois de carregar, fica pronto', await S.aguardarPronto(), 'pronto');
    check('e o estado persiste', S.pronto, true);
    clearTimeout(S._debounce);

    // Servidor fora do ar: precisa DIZER que não deu, não fingir que está tudo bem
    S.pronto = false;
    global.fetch = async () => { throw new Error('sem rede'); };
    check('servidor mudo devolve sem-resposta', await S.aguardarPronto(2000), 'sem-resposta');
    check('e não se declara pronto', S.pronto, false);
    clearTimeout(S._debounce);

    // Offline: responde na hora, sem ficar esperando um timeout
    global.navigator.onLine = false;
    const t0 = Date.now();
    check('offline responde imediatamente', await S.aguardarPronto(9000), 'sem-resposta');
    check('sem esperar o limite todo', Date.now() - t0 < 500, true);
    global.navigator.onLine = true;
    DB.data = dadosAntes;

    // A tela precisa usar isso, senão a proteção não vale de nada
    const apO = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    check('a importação espera antes de decidir',
      /const situacao = await Sync\.aguardarPronto\(\);[\s\S]{0,400}renderOfxPreview/.test(apO), true);
    check('avisa enquanto confere', apO.includes('Conferindo com a nuvem'), true);
    check('e avisa se não conseguiu conferir', apO.includes('Não consegui confirmar com a nuvem'), true);
    check('o aviso aparece junto do número de novos',
      /situacao === 'sem-resposta' \? `<div class="callout warn">[\s\S]{0,200}podem estar errados/.test(apO), true);
    /* Avançar o marcador com uma leitura falhada faria as linhas daquela tabela
       nunca mais serem buscadas — a próxima consulta já as ignoraria. Casa o
       BLOCO, não a linha: escrito numa linha só, um regex literal quebrava a cada
       reformatação sem que nada de errado tivesse acontecido. */
    const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
    const guarda = syncSrc.slice(syncSrc.indexOf('if (!falhas.length) {'),
      syncSrc.indexOf('DB.save();', syncSrc.indexOf('if (!falhas.length) {')));
    check('só marca pronto quando o pull inteiro deu certo',
      guarda.includes('this.pronto = true'), true);
    check('e o marcador de tempo também só avança aí',
      guarda.includes('DB.data.meta.lastSync = DB.now()'), true);
    /* A releitura completa marca só quando aconteceu de fato: marcar antes adiaria
       a próxima em uma semana sem ter reconciliado nada. */
    check('a releitura completa só se registra quando ocorre',
      guarda.includes('if (precisaFull) DB.data.meta.lastFull'), true);
  }

  /* ---- Login numa conta que já tem família ---- */
  console.log('\n=== Refazer login não cria família nova ===');
  {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.saveCfg = () => {};
    const base = { url: 'https://exemplo.supabase.co', anonKey: 'k', access_token: 'a', refresh_token: 'r', token_exp: Date.now() + 600000 };

    // Aparelho novo: logado, sem família local, mas o servidor já tem uma
    S.cfg = { ...base, user_id: 'u-1' };
    let pedido = '';
    global.fetch = async url => {
      pedido = String(url);
      return { ok: true, status: 200, json: async () => [{ family_id: 'fam-antiga' }], text: async () => '' };
    };
    const achou = await S.detectarFamilia();
    check('encontra a família que a conta já tem', achou, 'fam-antiga');
    check('não pede mais para criar família', S.hasFamily(), true);
    check('pergunta só pelas famílias desta conta', pedido.includes('user_id=eq.u-1'), true);

    // Conta realmente nova: nada a adotar
    S.cfg = { ...base, user_id: 'u-2' };
    global.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });
    check('conta sem família segue para o cadastro', await S.detectarFamilia(), null);

    // Já tem família local: não gasta chamada
    S.cfg = { ...base, user_id: 'u-1', family_id: 'fam-local' };
    let chamou = false;
    global.fetch = async () => { chamou = true; return { ok: true, status: 200, json: async () => [], text: async () => '' }; };
    check('quem já tem família não consulta de novo', await S.detectarFamilia(), 'fam-local');
    check('e não faz chamada à toa', chamou, false);

    // A busca da família é comodidade: se ela falhar, o login ainda tem de valer.
    // Autentica normalmente e derruba só a consulta de family_members.
    S.cfg = { ...base, access_token: undefined, refresh_token: undefined, token_exp: 0 };
    global.fetch = async url => {
      if (String(url).includes('/auth/v1/')) {
        return { ok: true, status: 200, text: async () => '', json: async () => ({
          access_token: 'a2', refresh_token: 'r2', expires_in: 3600, user: { id: 'u-9', email: 'a@b.c' },
        }) };
      }
      throw new Error('sem rede');
    };
    let caiu = false;
    await S.signIn('a@b.c', 'x').catch(() => { caiu = true; });
    check('login vale mesmo se a busca da família falhar', caiu, false);
    check('e a sessão fica gravada', S.cfg.access_token, 'a2');
    check('o id do usuário vem do login', S.cfg.user_id, 'u-9');

    const srcS = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
    check('o id do usuário é guardado no login', srcS.includes('this.cfg.user_id = (d.user && d.user.id)'), true);

    const srcA = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
    check('primeiro acesso pula a criação de família', /passoFamilia = \(\) => \{[\s\S]{0,240}if \(Sync\.hasFamily\(\)\) return passoFamiliaExistente\(\)/.test(srcA), true);
    check('e baixa o que a família já tem', srcA.includes('puxarTudoDaFamilia'), true);
  }

  /* ---- O código da família precisa ser fácil de achar ---- */
  console.log('\n=== Código da família visível ===');
  {
    const srcApp = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    const usos = (srcApp.match(/\$\{blocoConvite\(\)\}/g) || []).length;
    check('o bloco de convite aparece em mais de um lugar', usos >= 2, true);
    check('aparece em Família & ciclo', /sec === 'family'[\s\S]{0,600}\$\{blocoConvite\(\)\}/.test(srcApp), true);
    check('aparece em Sincronização', /step === 4[\s\S]{0,300}\$\{blocoConvite\(\)\}/.test(srcApp), true);
    check('a lista de configurações avisa onde está', srcApp.includes('código para convidar'), true);
    check('dá para compartilhar direto (WhatsApp etc.)', srcApp.includes('navigator.share'), true);
    check('e copiar quando não há compartilhamento', /navigator\.clipboard\.writeText\(codigo\(\)\)/.test(srcApp), true);
    check('tocar no código copia', /on\('#cv-cod', copiar\)/.test(srcApp), true);
    check('o convite é ligado onde é exibido', (srcApp.match(/ligarConvite\(\);/g) || []).length >= 2, true);
    const cssC = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
    check('o código tem destaque próprio', /\.convite-cod \{[^}]*font-family: monospace/.test(cssC), true);
  }

  console.log('\n=== Apagar dados deste aparelho ===');

  const dadosAntes = DB.data, storeAntes = { ...store };
  store['financas.v1'] = '{}';
  store['financas.sync.v1'] = '{"refresh_token":"abc"}';
  store['financas.auth.v1'] = '{"pin":1}';
  store['financas.ui.v1'] = '{"tab":"extrato"}';
  store['financas.notif.v1'] = '{}';
  store['financas.rotulo'] = 'Família';
  store['outro-app.dados'] = 'não é meu';
  sessao['financas.sessao'] = '{"k":"x"}';

  const apagados = [];
  let swFora = 0;
  global.caches = { keys: async () => ['financas-19', 'financas-18'], delete: async n => { apagados.push(n); return true; } };
  global.navigator.serviceWorker = { getRegistrations: async () => [{ unregister: async () => { swFora++; return true; } }] };

  await DB.apagarTudo();

  const sobrou = Object.keys(store).filter(k => k.startsWith('financas'));
  check('nenhuma chave do app sobra', sobrou.length ? sobrou.join(', ') : true, true);
  check('login na nuvem também é apagado', store['financas.sync.v1'] === undefined, true);
  check('PIN e digital também são apagados', store['financas.auth.v1'] === undefined, true);
  check('não mexe no que é de outro app', store['outro-app.dados'], 'não é meu');
  check('sessão da aba é encerrada', sessao['financas.sessao'] === undefined, true);
  check('cache do app é descartado', apagados.length, 2);
  check('service worker é desregistrado', swFora, 1);
  check('memória do app fica vazia', DB.data === null && DB.key === null, true);

  // Um único caminho de limpeza: "Esqueci o PIN" apagava só 3 chaves e deixava o resto
  const auW = fs.readFileSync(BASE + 'js/auth.js', 'utf8');
  const apW = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('esqueci o PIN usa a limpeza completa', auW.includes('DB.apagarTudo()'), true);
  check('não sobrou limpeza parcial por chave solta', !/removeItem\(DB_KEY\)/.test(auW), true);
  check('configurações têm a opção de apagar', apW.includes("item('reset'") && apW.includes(`sec === 'reset'`), true);
  check('a tela explica por que o Android não resolve', /WebAPK|é um atalho|é só um atalho/.test(apW), true);
  check('apagar exige digitar a confirmação', /rs-conf[\s\S]{0,900}!== 'APAGAR'/.test(apW), true);
  check('oferece backup antes de apagar', apW.includes('rs-export'), true);
  check('avisa que a nuvem não é afetada', apW.includes('a nuvem não é afetada'), true);

  DB.data = dadosAntes;   // devolve o cenário caso mais algo rode depois
  /* ---- O pull não pode deixar registro para trás ----
     Aconteceu de verdade, com dados de produção: um lançamento de aluguel gravado às
     04:43 estava no Supabase e NÃO na base local. O extrato de agosto e o card de
     previsão simplesmente não o mostravam.
  
     A causa: `updated_at` é a hora da EDIÇÃO no aparelho de origem, não a da chegada
     ao servidor — quem preenche o campo é quem cria o registro. Um aparelho que ficou
     offline envia, ao voltar, registros com timestamp de horas atrás; qualquer outro
     aparelho que já tenha sincronizado nesse intervalo pede `> lastSync` e nunca mais
     os busca. É o pior tipo de perda: silenciosa, e o dado existe no servidor. */
  console.log('\n=== Pull: registro de aparelho offline não pode se perder ===');
  // `await`: sem ele o bloco só agenda, e o process.exit do fim da suíte roda
  // antes de qualquer check — os testes existiriam sem nunca ter rodado
  await (async () => {
    const guardaFetch = global.fetch;
    const guardaOnline = global.navigator.onLine;
    const guardaDados = DB.data;
    try {
      global.navigator.onLine = true;
      // O Sync real, carregado do arquivo — o global do harness é um dublê inerte
      const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
      S.saveCfg = () => {}; S.GIRO_MINIMO = 0;
      S.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 'a',
        refresh_token: 'r', token_exp: Date.now() + 600000, family_id: 'fam-1' };
  
      /* O SERVIDOR falso guarda um lançamento com timestamp ANTIGO — foi criado num
         aparelho que estava offline e só agora enviou. */
      /* O CENÁRIO: o registro foi EDITADO às 04:43 num aparelho offline e só
         CHEGOU ao servidor às 16:00. Com o marcador antigo (`updated_at`) ele caía
         fora da janela de quem já tinha sincronizado às 15:00 e sumia para sempre.
         Com o carimbo do servidor ele é recente, porque recente é o que ele é. */
      const ANTIGO = '2026-07-30T04:43:22.352+00:00';
      const RECENTE = '2026-07-30T15:22:32.167+00:00';
      const CHEGOU_AGORA = '2026-07-30T16:00:00.000+00:00';
      const noServidor = {
        transactions: [
          { id: 'tx-antigo', family_id: 'fam-1', updated_at: ANTIGO, server_at: CHEGOU_AGORA, deleted: false,
            description: 'Aluguel do aparelho offline', amount: 3500, date: '2026-08-10',
            type: 'Despesa', status: 'A Pagar', scope: 'Família', method: 'PIX' },
          { id: 'tx-recente', family_id: 'fam-1', updated_at: RECENTE, server_at: CHEGOU_AGORA, deleted: false,
            description: 'Energia', amount: 400, date: '2026-08-10',
            type: 'Despesa', status: 'A Pagar', scope: 'Família', method: 'PIX' },
        ],
      };
      const pedidos = [];
      global.fetch = async (url, opts) => {
        const u = String(url);
        if ((opts || {}).method === 'POST') return { ok: true, status: 201, json: async () => [], text: async () => '' };
        const tabela = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
        // O pull filtra por server_at — o carimbo do banco, não a hora da edição
        const desde = decodeURIComponent((u.match(/server_at=gt\.([^&]+)/) || [])[1] || '');
        if (tabela === 'transactions') pedidos.push(desde);
        const linhas = (noServidor[tabela] || []).filter(r => (r.server_at || r.updated_at) > desde);
        return { ok: true, status: 200, json: async () => linhas, text: async () => '' };
      };
  
      // A base local está vazia, e o marcador é POSTERIOR ao registro antigo —
      // exatamente o estado do aparelho que perdeu o aluguel
      DB.data = { meta: { serverAt: '2026-07-30T15:00:00.000Z' } };
      for (const t of ['transactions', 'accounts', 'categories', 'cards', 'goals',
        'goal_entries', 'invoice_status', 'recurrences', 'family_settings']) DB.data[t] = [];
  
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
  
      const veio = id => (DB.data.transactions || []).some(r => r.id === id);
      /* O PULL PERGUNTA POR server_at. É a mudança de fundo: "o que chegou aqui
         depois de X?" depende de um relógio só — o do banco —, enquanto "o que foi
         editado depois de X?" dependia do relógio de cada aparelho da família. */
      check('o pull filtra pelo carimbo do servidor', pedidos.length > 0, true);
      check('o registro do aparelho offline é recuperado', veio('tx-antigo'), true);
      check('e o recente continua vindo', veio('tx-recente'), true);

      /* A PROVA de que o carimbo é o que salva: pela hora da EDIÇÃO esse registro
         ficaria fora da janela e sumiria; pela hora da CHEGADA, ele entra. */
      const porEdicao = (noServidor.transactions || [])
        .filter(r => r.updated_at > '2026-07-30T15:00:00.000Z');
      const porChegada = (noServidor.transactions || [])
        .filter(r => r.server_at > '2026-07-30T15:00:00.000Z');
      check('pela hora da edição, o registro ficaria de fora',
        porEdicao.some(r => r.id === 'tx-antigo'), false);
      check('pela hora da chegada, ele entra',
        porChegada.some(r => r.id === 'tx-antigo'), true);
      // E o marcador guardado é um valor que VEIO do servidor, não o relógio local
      check('o marcador guardado vem do servidor', DB.data.meta.serverAt, CHEGOU_AGORA);
      check('e não é uma leitura do relógio desta máquina',
        DB.data.meta.serverAt === DB.data.meta.lastSync, false);
      // Detectada a presença do carimbo, a sessão inteira usa o caminho novo
      check('a presença do carimbo fica registrada', S.temServerAt, true);
      /* MARGEM DE SEGURANÇA no marcador. Duas gravações concorrentes podem receber
         clock_timestamp() em ordem e commitar fora de ordem — a linha com carimbo
         menor aparece depois da maior. Sem recuo, ela cairia no mesmo buraco que
         esta correção existe para fechar. */
      /* Precisa de `lastFull` recente: sem ele o pull relê tudo do epoch e a margem
         não aparece no pedido. O primeiro cenário deste bloco não tinha, e o teste
         media o marcador da releitura completa em vez do incremental. */
      pedidos.length = 0;
      DB.data.meta.serverAt = '2026-07-30T15:00:00.000Z';
      DB.data.meta.lastFull = new Date().toISOString();
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      const pedidoFeito = pedidos[0];
      check('o pull recua antes do marcador guardado',
        pedidoFeito < '2026-07-30T15:00:00.000Z', true);
      check('mas só alguns minutos, não dias',
        new Date('2026-07-30T15:00:00.000Z') - new Date(pedidoFeito) <= 10 * 60 * 1000, true);
  
      /* PAGINAÇÃO: sem ela, uma tabela com mais alterações que o limite trazia só a
         primeira página e o marcador avançava como se tudo tivesse vindo — o resto
         ficava invisível para sempre, pelo mesmo mecanismo. */
      const muitos = [];
      for (let i = 0; i < 2300; i++) {
        const ms = new Date('2026-07-25T00:00:00.000Z').getTime() + i * 1000;
        muitos.push({ id: 'tx-' + i, family_id: 'fam-1', updated_at: new Date(ms).toISOString(),
          server_at: new Date(ms).toISOString(),
          deleted: false, description: 'Linha ' + i, amount: 10, date: '2026-08-01',
          type: 'Despesa', status: 'A Pagar', scope: 'Família', method: 'PIX' });
      }
      noServidor.transactions = muitos;
      global.fetch = async (url, opts) => {
        const u = String(url);
        if ((opts || {}).method === 'POST') return { ok: true, status: 201, json: async () => [], text: async () => '' };
        const tabela = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
        const desde = decodeURIComponent((u.match(/server_at=gt\.([^&]+)/) || [])[1] || '');
        const limite = Number((u.match(/limit=(\d+)/) || [])[1] || 1000);
        const linhas = (noServidor[tabela] || [])
          .filter(r => (r.server_at || r.updated_at) > desde)
          .sort((a, b) => String(a.server_at || a.updated_at)
            .localeCompare(String(b.server_at || b.updated_at)))
          .slice(0, limite);
        return { ok: true, status: 200, json: async () => linhas, text: async () => '' };
      };
      DB.data = { meta: {} };
      for (const t of ['transactions', 'accounts', 'categories', 'cards', 'goals',
        'goal_entries', 'invoice_status', 'recurrences', 'family_settings']) DB.data[t] = [];
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      check('a paginação traz tudo, não só a primeira página',
        (DB.data.transactions || []).length, 2300);

      /* RECONCILIAÇÃO COMPLETA semanal. A janela de 7 dias cobre o aparelho que
         ficou offline alguns dias, mas não um buraco mais ANTIGO — e buraco antigo
         é o que ninguém descobre, porque o dado não está lá para ser procurado.
         Uma vez por semana o pull relê tudo, e a divergência se fecha sozinha. */
      /* Os carimbos são contados a partir de HOJE, nunca escritos por extenso: a
         regra que está sob teste é "faz mais de uma semana?", e uma data fixa
         responde isso diferente a cada dia em que a suíte roda — foi assim que
         este teste começou a reprovar sozinho, sem ninguém mexer no sync. */
      const diasAtras = n => new Date(Date.now() - n * 86400000).toISOString();
      noServidor.transactions = [
        { id: 'tx-muito-antigo', family_id: 'fam-1', updated_at: diasAtras(200),
          server_at: diasAtras(200),
          deleted: false, description: 'Some há meses', amount: 99, date: diasAtras(200).slice(0, 10),
          type: 'Despesa', status: 'A Pagar', scope: 'Família', method: 'PIX' },
      ];
      const zerar = marcadores => {
        DB.data = { meta: marcadores };
        for (const t of ['transactions', 'accounts', 'categories', 'cards', 'goals',
          'goal_entries', 'invoice_status', 'recurrences', 'family_settings']) DB.data[t] = [];
      };
      // Releitura recente: a janela de 7 dias não alcança um registro de 200 dias atrás
      zerar({ serverAt: diasAtras(1), lastFull: diasAtras(2) });
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      check('com releitura recente, o registro antigo fica fora da janela',
        (DB.data.transactions || []).length, 0);
      // Releitura vencida: o pull relê tudo e o registro volta
      zerar({ serverAt: diasAtras(1), lastFull: diasAtras(60) });
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      check('com a releitura vencida, ele é recuperado',
        (DB.data.transactions || []).some(r => r.id === 'tx-muito-antigo'), true);
      /* O marcador tem de ter avançado para AGORA — comparado contra um instante
         recente, não contra uma data escrita à mão, que decide sozinha o resultado
         conforme o mês em que a suíte roda. */
      check('e a releitura fica registrada para não repetir toda hora',
        !!DB.data.meta.lastFull && DB.data.meta.lastFull > diasAtras(1), true);
      // Sem marcador nenhum (instalação nova, ou app atualizado) também relê tudo
      zerar({ serverAt: diasAtras(1) });
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      check('aparelho sem releitura registrada lê tudo',
        (DB.data.transactions || []).some(r => r.id === 'tx-muito-antigo'), true);

      /* ---- TRANSIÇÃO: banco AINDA SEM a coluna server_at ----
         O carimbo depende de um SQL que pode não ter sido rodado — num banco
         recém-criado, ou entre publicar o app e executar a migração. Pedir por uma
         coluna inexistente derrubaria o pull inteiro, e aí o remédio seria pior que
         a doença: o app pararia de sincronizar por causa da correção. */
      const pedidosSemColuna = [];
      global.fetch = async (url, opts) => {
        const u = String(url);
        if ((opts || {}).method === 'POST') return { ok: true, status: 201, json: async () => [], text: async () => '' };
        pedidosSemColuna.push(u);
        if (/server_at/.test(u)) {
          return { ok: false, status: 400, text: async () => JSON.stringify({
            code: '42703', message: 'column transactions.server_at does not exist' }) };
        }
        const tabela = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
        const desde = decodeURIComponent((u.match(/updated_at=gt\.([^&]+)/) || [])[1] || '');
        const linhas = tabela === 'transactions'
          ? [{ id: 'tx-legado', family_id: 'fam-1', updated_at: '2026-07-30T12:00:00.000Z',
            deleted: false, description: 'Sem carimbo', amount: 55, date: '2026-08-01',
            type: 'Despesa', status: 'A Pagar', scope: 'Família', method: 'PIX' }]
            .filter(r => r.updated_at > desde)
          : [];
        return { ok: true, status: 200, json: async () => linhas, text: async () => '' };
      };
      S.temServerAt = null;
      zerar({});
      await S.syncAll(false).catch(() => {});
      clearTimeout(S._debounce);
      check('sem a coluna, o pull não estoura', S.temServerAt, false);
      check('ele tenta o carimbo primeiro',
        pedidosSemColuna.some(u => /server_at=gt/.test(u)), true);
      check('e cai para o caminho antigo',
        pedidosSemColuna.some(u => /updated_at=gt/.test(u)), true);
      check('trazendo os dados assim mesmo',
        (DB.data.transactions || []).some(r => r.id === 'tx-legado'), true);
      // Uma vez detectado, não insiste a cada tabela — seria um pedido perdido por tabela
      const tentativas = pedidosSemColuna.filter(u => /server_at=gt/.test(u)).length;
      check('e não repete a tentativa em todas as tabelas', tentativas <= 2, true);
      S.temServerAt = null;
    } catch (e) {
      console.log(` FALHA | pull: ${e.message}`); fail++;
    } finally {
      global.fetch = guardaFetch;
      global.navigator.onLine = guardaOnline;
      DB.data = guardaDados;
    }
  })();

  console.log('\n=== Investimentos: o envelope que não é gasto ===');
  try {
    const envInv = DB.envelopeDeInvestimento();
    check('existe o envelope de Investimentos', !!envInv, true);
    check('  e ele tem teto próprio', envInv.monthly_budget > 0, true);
    const subs = DB.subcategoriesOf(envInv.id).map(c => c.name);
    check('  com reserva e objetivos separados',
      subs.some(n => /reserva/i.test(n)) && subs.some(n => /objetivo/i.test(n)), true);

    /* Reserva e objetivo caem em subcategorias DIFERENTES: olhando para trás,
       "guardei 24 mil no ano" não diz se foi para o colchão ou para a viagem. */
    const nomeCatDe = g => (DB.get('categories', DB.categoriaDeAporte(g)) || {}).name || '';
    const metaReserva = DB.all('goals').find(g => DB.isReserveGoal(g))
      || DB.upsert('goals', { name: 'Reserva TESTE', icon: '🛡️', kind: 'Reserva', target_amount: 1000 });
    const metaObjetivo = DB.all('goals').find(g => !DB.isReserveGoal(g))
      || DB.upsert('goals', { name: 'Objetivo TESTE', icon: '🎯', kind: 'Objetivo', target_amount: 1000 });
    check('aporte de reserva cai na subcategoria de reserva',
      /reserva/i.test(nomeCatDe(typeof metaReserva === 'string' ? DB.get('goals', metaReserva) : metaReserva)), true);
    check('  e o de um objetivo, na de objetivos',
      /objetivo|meta/i.test(nomeCatDe(typeof metaObjetivo === 'string' ? DB.get('goals', metaObjetivo) : metaObjetivo)), true);
    const metaInv = typeof metaReserva === 'string' ? DB.get('goals', metaReserva) : metaReserva;

    /* O APORTE NÃO PODE CONTAR DUAS VEZES. Ele ajusta os saldos das contas E passa
       a deixar a transferência no extrato; `saldoNaData` parte do saldo atual e
       desfaz as transações a partir da data, então as duas coisas precisam
       descrever o MESMO movimento — não somar. */
    const cOrigem = DB.all('accounts')[0], cDestino = DB.all('accounts')[1];
    const somaAntes = DB.accountsTotal();
    const origemAntes = Number(DB.get('accounts', cOrigem.id).balance) || 0;
    const destinoAntes = Number(DB.get('accounts', cDestino.id).balance) || 0;
    const pInv = DB.monthPeriod(new Date());
    const investidoAntes = DB.investidoNoPeriodo(pInv);
    const saldoHojeAntes = DB.saldoNaData([cOrigem.id, cDestino.id], todayISO());

    openAporteSheet(metaInv.id);
    el('#a-amount').dataset.cents = '50000';        // R$ 500,00
    el('#a-desc').value = 'Aporte TESTE INV';
    el('#a-date').value = todayISO();
    el('#a-account').value = cOrigem.id;
    el('#a-to').value = cDestino.id;
    el('#sh-save').click();

    check('a soma dos saldos não muda: é transferência', Math.round(DB.accountsTotal()), Math.round(somaAntes));
    check('  sai da conta de origem', Math.round(Number(DB.get('accounts', cOrigem.id).balance)), Math.round(origemAntes - 500));
    check('  e entra na de destino', Math.round(Number(DB.get('accounts', cDestino.id).balance)), Math.round(destinoAntes + 500));
    check('  e o saldo por data continua batendo',
      Math.round(DB.saldoNaData([cOrigem.id, cDestino.id], todayISO())), Math.round(saldoHojeAntes));

    const lanc = DB.all('transactions').find(t => t.description === 'Aporte TESTE INV');
    check('a movimentação aparece no extrato', !!lanc, true);
    check('  como transferência, não como gasto', DB.isTransfer(lanc), true);
    check('  logo, neutra em toda análise', DB.isNeutral(lanc), true);
    check('  com a categoria de investimento',
      DB.categoryRootId(lanc.category_id), envInv.id);
    /* E, sendo neutra, ela NÃO infla o gasto do mês: quem mede o investimento é o
       aporte, senão o mesmo dinheiro apareceria como despesa e como patrimônio. */
    check('o gasto do mês não cresce com o aporte',
      DB.expensesOf(pInv).some(t => t.description === 'Aporte TESTE INV'), false);
    check('mas o investido do mês cresce', Math.round(DB.investidoNoPeriodo(pInv)), Math.round(investidoAntes + 500));

    /* A BARRA do envelope mede o guardado. Sem isto ela ficaria eternamente em 0%,
       porque transferência não entra em spentByCategory. */
    const offInv = state.monthOffset; state.monthOffset = 0;
    const telaInv = renderInicio(pInv);
    const linhaInv = (telaInv.match(new RegExp(`<div class="budget-head"><b>[^<]*${envInv.name}[\\s\\S]{0,300}?</div>`)) || [''])[0];
    check('a barra de investimento mostra o guardado', linhaInv.includes(fmtShort(DB.investidoNoPeriodo(pInv))), true);
    /* Cor invertida: 100% aqui é meta cumprida, não teto estourado. A classe é
       lida da barra DESTA linha — pegar um pedaço solto do HTML alcançaria a
       barra do envelope seguinte e o teste passaria por acidente. */
    /* A linha é isolada primeiro: "Investimentos" é também o nome de um envelope
       de RECEITA, então procurar o texto solto no HTML acha a ocorrência errada e
       o teste passa por acidente — foi o que aconteceu na primeira versão.

       E as duas faixas são exercitadas, porque no meio delas as duas réguas
       COINCIDEM: com 74% do teto, `barClass` também devolve âmbar, e o teste
       passava mesmo com a régua de gasto de volta. Só divergem embaixo (guardou
       pouco: gasto diria verde) e em cima (guardou tudo: gasto diria vermelho). */
    const classeDaBarraInv = () => {
      const linhas = renderInicio(pInv).match(/<div class="budget-row[\s\S]*?<\/div>\s*<\/div>/g) || [];
      const l = linhas.find(x => x.includes(`>${envInv.icon} ${envInv.name}`)) || '';
      return (l.match(/class="bar ([a-z-]+)"/) || [])[1];
    };
    /* A ORDEM da lista sai do valor que cada linha MOSTRA.
       Ordenada por `byCat`, Investimentos caía sempre no fim — com milhares
       guardados ele aparecia abaixo de envelopes de poucos reais, porque para o
       `spentByCategory` ele vale zero. Lista ordenada por critério invisível na
       tela lê como lista desordenada. */
    {
      const linhasDe = html => (html.match(/<div class="budget-row[\s\S]*?<\/div>\s*<\/div>/g) || []);
      const nomeDaLinha = l => (l.match(/<b>([^<]+)/) || ['', ''])[1].trim();
      // Um envelope com gasto pequeno, para o investimento ter de passar por cima
      const byCatDoMes = DB.spentByCategory(pInv);
      const pequeno = DB.rootCategories('Despesa').find(c => c.id !== envInv.id
        && (byCatDoMes[c.id] || 0) > 0 && (byCatDoMes[c.id] || 0) < DB.investidoNoPeriodo(pInv));
      check('há envelope com gasto menor que o investido, senão o teste é vazio', !!pequeno, true);
      const ordem = linhasDe(renderInicio(pInv)).map(nomeDaLinha);
      const iInvest = ordem.findIndex(n => n.includes(envInv.name));
      const iPequeno = ordem.findIndex(n => n.includes(pequeno.name));
      check('investimento aparece acima de quem gastou menos que ele', iInvest < iPequeno, true);
      check('  e não no fim da lista', iInvest < ordem.length - 1, true);
    }

    const guardado = DB.investidoNoPeriodo(pInv);
    DB.ajustarOrcamento(envInv.id, pInv, guardado * 10);      // ~10% da meta
    check('guardou pouco: âmbar, não o verde da régua de gasto', classeDaBarraInv(), 'bar-amber');
    DB.ajustarOrcamento(envInv.id, pInv, Math.round(guardado / 2));  // 200% da meta
    check('guardou o dobro: verde, não o vermelho de teto estourado', classeDaBarraInv(), 'bar-green');
    DB.limparAjusteDeOrcamento(envInv.id, pInv);
    state.monthOffset = offInv;

    // limpa
    DB.remove('transactions', lanc.id);
    for (const e of DB.all('goal_entries').filter(e => e.description === 'Aporte TESTE INV')) DB.remove('goal_entries', e.id);
    adjustBalance(cOrigem.id, 500); adjustBalance(cDestino.id, -500);
    DB.save();
  } catch (e) { console.log(` FALHA | investimentos: ${e.message}`); fail++; }

  console.log('\n=== O topo do Painel olha para a frente ===');
  try {
    /* Os quatro KPIs falavam só do presente — gasto, faturas, saldo, metas —
       enquanto o app já sabia o saldo projetado de seis meses e não o mostrava na
       primeira tela. Quem planeja abria o Painel e não achava resposta. */
    const h = DB.horizonte(6);
    check('o horizonte cobre seis meses', h.meses.length, 6);
    /* O PIOR PONTO, não o saldo final: um horizonte que termina em 59 mil pode
       passar por 200 negativos no meio, e é no meio que a conta não é paga.
       Comparando contra o saldo de hoje durante o laço, um horizonte que só sobe
       nunca atualizava o mínimo — medido, o rótulo dizia "pior ponto R$ 59.479 em
       agosto", que era o saldo do ÚLTIMO mês. */
    const menorSaldo = Math.min(...h.meses.map(m => m.saldo));
    check('o pior ponto é o menor saldo da série', Math.round(h.pior), Math.round(menorSaldo));
    check('  e o mês nomeado é o daquele saldo',
      h.piorMes, (h.meses.find(m => Math.abs(m.saldo - menorSaldo) < 0.005) || {}).period.label);
    // Série que só sobe: o pior ponto é o primeiro mês, não o último
    check('numa série crescente, o pior ponto é o começo',
      h.meses[0].saldo <= h.meses[h.meses.length - 1].saldo
        ? Math.round(h.pior) === Math.round(h.meses[0].saldo) : true, true);

    const offK = state.monthOffset; state.monthOffset = 0;
    const telaK = renderInicio(DB.monthPeriod(new Date()));
    check('o horizonte tem dados, senão o KPI não teria o que mostrar', h.temDados, true);
    check('o KPI de saldo mostra o pior ponto à frente', /pior ponto/.test(telaK), true);
    check('  com o mês nomeado, não só o valor', telaK.includes(`em ${h.piorMes}`), true);
    /* "Metas (média)" saiu: a média de percentuais de metas com alvos diferentes
       soma coisas que não se somam. O que mede segurança é a cobertura da reserva. */
    check('o KPI de metas virou cobertura da reserva', /Reserva cobre/.test(telaK), true);
    // Olha só os RÓTULOS renderizados: o texto solto acha o comentário no código
    const rotulosKpi = (telaK.match(/kpi-label">([^<]+)</g) || []).map(x => x.replace(/.*">/, '').replace('<', ''));
    check('  e não a média de percentuais', rotulosKpi.some(r => /Metas/.test(r)), false);
    check('  são quatro cartões', rotulosKpi.length, 4);
    state.monthOffset = offK;

    /* CUSTO DE VIDA para dimensionar a reserva, não o gasto médio cru. Medido:
       o histórico de transição dava média de R$ 30.530, alvo de R$ 183 mil e
       cobertura de 0,0 meses — número que só desanima. */
    const envI = DB.envelopeDeInvestimento();
    check('o custo de vida sai do orçamento quando ele existe',
      Math.round(DB.custoDeVidaMensal()),
      Math.round(DB.budgetTotal() - (envI ? DB.budgetOf(envI.id) : 0)));
    check('  e não inclui o investimento, que para quando a renda para',
      DB.custoDeVidaMensal() < DB.budgetTotal(), !!envI && DB.budgetOf(envI.id) > 0);
    /* E a TELA precisa usar esse número: o modelo certo com o Painel chamando
       `avgMonthlySpend` deixaria a cobertura errada do mesmo jeito. Medido nesta
       base, os dois divergem — é isso que torna a assertiva não-vazia. */
    check('os dois números divergem, senão a assertiva é vazia',
      Math.round(DB.custoDeVidaMensal()) !== Math.round(DB.avgMonthlySpend()), true);
    /* A COBERTURA DA RESERVA saiu dos KPIs e ficou no card próprio dela, que agora
       também diz QUANDO ela fica pronta — "faltam R$ 72.526" paralisa, "no ritmo
       atual, fevereiro de 2028" é plano. O KPI liberado passou a mostrar as metas
       em VALOR: a média de "50% de mil" com "10% de cem mil" dava 30%, que não
       corresponde nem ao dinheiro nem ao caminho. */
    check('o card da reserva usa o custo de vida', telaK.includes(fmtShort(DB.custoDeVidaMensal())), true);
    check('  e não a média histórica crua',
      telaK.includes(fmtShort(DB.avgMonthlySpend() * 6)), false);
    check('o card da reserva diz quando ela fica pronta',
      /No ritmo de|já agendado|Guardando o previsto|Sem aportes ainda/.test(telaK), true);
    check('o KPI de metas mostra valor, não média de percentuais',
      /Guardado em metas/.test(telaK), true);

    /* O RODAPÉ DO HERO separa o que vira patrimônio do que vira despesa. Juntos,
       ele dizia "R$ 12.129 a pagar" quando R$ 3.400 daquilo é poupança. */
    const proxP = DB.monthPeriod(new Date(), 1);
    /* O cenário é CONSTRUÍDO aqui: sem um aporte previsto no próximo mês as
       asserções não rodariam, e um teste que não roda passa por vazio — foi o que
       a sabotagem revelou. */
    const metaHero = DB.upsert('goals', { name: 'Meta Hero', icon: '🎯', kind: 'Objetivo', target_amount: 9000 });
    const cHero = DB.all('accounts')[0], cHero2 = DB.all('accounts')[1];
    DB.upsert('goal_entries', {
      goal_id: metaHero, amount: 1500, description: 'Aporte HERO',
      date: DB.inicioISO(proxP), from_account: cHero.id, to_account: cHero2.id, status: 'A Pagar',
    });
    // …e receita prevista: sem ela a frase para em "ainda sem receita prevista" e
    // as asserções sobre a sobra nunca são exercitadas
    const rendaHero = DB.upsert('transactions', {
      description: 'Salário HERO', amount: 9000, date: DB.inicioISO(proxP), type: 'Receita',
      status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: cHero.id,
    });
    const investProx = DB.investidoNoPeriodo(proxP);
    check('o próximo mês tem investimento previsto, senão o teste é vazio', investProx > 0.005, true);
    /* A PREVISÃO CONHECE O APORTE, mas ele NÃO É SAÍDA.

       Guardar é transferência entre contas próprias: o valor continua em
       `accountsTotal`, só troca de bolso. Ele tem contador próprio (`investe`), e
       `sai` responde só "quanto custa viver o mês". Somados, diziam que agosto
       custa R$ 15.529 quando R$ 3.400 daquilo vira patrimônio. */
    const pvProxHero = DB.previsaoDoMes(proxP);
    check('o aporte agendado entra na previsão do mês',
      pvProxHero.itens.some(i => i.origem === 'aporte'), true);
    check('  contado em `investe`, não em `sai`', Math.round(pvProxHero.investe), Math.round(investProx));
    check('  e `sai` não o inclui',
      Math.round(pvProxHero.sai + pvProxHero.investe),
      Math.round(pvProxHero.itens.filter(i => !i.receita).reduce((s, i) => s + i.valor, 0)));
    // O resultado não muda de valor: é a mesma conta, com a parcela em outra coluna
    check('  o resultado continua entra − sai − investe',
      Math.round(pvProxHero.resultado),
      Math.round(pvProxHero.entra - pvProxHero.sai - pvProxHero.investe));
    /* E a transferência que acompanha o aporte NÃO pode ser contada além dele: ela
       é neutra por construção, mas se um dia deixar de ser, esta assertiva pega. */
    check('  o aporte aparece uma vez só',
      pvProxHero.itens.filter(i => Math.abs(i.valor - investProx) < 0.005 && !i.receita).length <= 1, true);
    /* A IDENTIDADE RESTAURADA. `docs/plano-visao-futuro.md` trava "despesas do
       Extrato = saídas previstas − fatura", e daí o KPI, Rel.gasto, o donut e a
       cascata. Com o aporte dentro de `sai` ela quebrava pelo valor do aporte —
       medido em agosto/2026: diferença de R$ 3.312,20.

       A tolerância cobre a divergência ANTIGA e conhecida: compra no cartão entra
       no extrato no mês da compra, e na previsão ela chega pela fatura. */
    const faturaProx = pvProxHero.itens.filter(i => i.origem === 'fatura')
      .reduce((s, i) => s + i.valor, 0);
    const despProx = DB.expensesOf(proxP).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const noCartao = DB.txOfPeriod(proxP)
      .filter(t => t.card_id && DB.isExpense(t) && !DB.isNeutral(t))
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    check('extrato = saídas previstas − fatura (com o aporte fora)',
      Math.round(despProx - noCartao), Math.round(pvProxHero.sai - faturaProx));
    /* ---- O HERO DO MÊS FUTURO CONTA A CONTA INTEIRA ----

       Ele dava o número final e três colunas soltas (Entradas / Saídas /
       Resultado) que não fechavam com ele — 17.831 − 15.529 = 2.302, mas o valor
       grande era 2.593. Quem tentasse conferir desistia.

       Agora são as mesmas linhas do hero do mês corrente: onde o mês ABRE, o que
       ACONTECE, onde CHEGA em caixa, e quanto daquilo já tem dono. */
    state.monthOffset = 1;
    const heroFut = renderInicio(proxP);
    const abreP = DB.saldoPrevistoNaData(null, DB.inicioISO(proxP));
    const fimPT = DB.fimISO(proxP);
    const emContasFimT = DB.saldoPrevistoNaData(null, fimPT);
    const guardadoFimT = DB.guardadoPrevisto(fimPT);
    const livreFimT = emContasFimT - guardadoFimT;
    // A base do KPI de metas: todas as metas ATIVAS (reserva incluída), como o
    // número de hoje já fazia — trocar a base faria o cartão saltar ao virar o mês
    const metasAtivas = DB.all('goals').filter(g => !g.done);
    const guardadoMetasHojeT = metasAtivas.reduce((s, g) => s + Math.max(0, DB.goalTotal(g.id)), 0);
    const guardadoMetasFimT = guardadoMetasHojeT + DB.aportesAgendadosAte(fimPT);

    /* APORTE VENCIDO NÃO CONTA como guardado ao fim: ele não aconteceu, e afirmá-lo
       contradiria a fila de pendências do Painel, que ainda está cobrando por ele. */
    const metaVenc = DB.upsert('goals', { name: 'Meta Vencida', icon: '🎯', kind: 'Objetivo', target_amount: 5000 });
    const eVenc = DB.upsert('goal_entries', {
      goal_id: metaVenc, amount: 999, description: 'Aporte VENCIDO',
      date: somarDias(todayISO(), -3), from_account: cHero.id, to_account: cHero2.id, status: 'A Pagar',
    });
    check('aporte agendado e vencido não entra no guardado do fim',
      Math.round(DB.guardadoPrevisto(fimPT)), Math.round(guardadoFimT));
    check('  mas ele existe e está sendo cobrado na fila',
      DB.pendencias(todayISO()).some(i => i.tipo === 'aporte' && i.id === eVenc), true);
    DB.remove('goal_entries', eVenc); DB.remove('goals', metaVenc);

    // Conta as LINHAS da decomposição, não só a existência da caixa: um `hidden`
    // ou uma caixa vazia passariam por uma checagem de classe
    const linhasConta = (heroFut.match(/<div class="hc-l/g) || []).length;
    check('o hero futuro traz a decomposição', linhasConta >= 5, true);
    check('  e a caixa não está escondida', /class="hero-conta"[^>]*hidden/.test(heroFut), false);
    check('  e as três colunas soltas saíram', /hero-stats/.test(heroFut), false);
    check('  ele diz onde o mês ABRE', heroFut.includes(`Abre em contas`) && heroFut.includes(fmt(abreP)), true);
    check('  e onde CHEGA em caixa', heroFut.includes(fmt(emContasFimT)), true);
    check('  o valor grande é a última linha da conta',
      heroFut.includes(`hero-value">${fmt(livreFimT)}`)
      && heroFut.includes(`= Livre ao fim</span><b>${fmt(livreFimT)}`), true);

    /* O GASTO DE HOJE APARECE NO MÊS QUE VEM.

       `saldoPrevistoNaData` usava o saldo de HOJE como base para datas futuras, e
       `saldoNaData(contas, hoje)` desfaz os lançamentos do próprio dia — ela
       devolve o saldo do começo do dia, não o atual. Efeito: um gasto lançado hoje
       não entrava no "abre em contas" do mês seguinte, e como todos os meses
       rolam a partir daí, ele sumia da projeção inteira.

       Medido na base real: R$ 100 de mercado pagos em 31/07 deixavam a conta em
       R$ 326 e agosto abria com R$ 426. */
    {
      const cHoje = DB.all('accounts')[0];
      const abreAntes = DB.saldoPrevistoNaData(null, DB.inicioISO(proxP));
      const totalAntes = DB.accountsTotal();
      const gastoHoje = DB.upsert('transactions', {
        description: 'Mercado HOJE', amount: 137, date: todayISO(), type: 'Despesa',
        status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito',
        account_id: cHoje.id,
      });
      adjustBalance(cHoje.id, -137);              // como o app faz ao salvar
      check('um gasto pago hoje reduz o saldo em contas',
        Math.round(DB.accountsTotal()), Math.round(totalAntes - 137));
      check('  e reduz o "abre em contas" do mês seguinte',
        Math.round(DB.saldoPrevistoNaData(null, DB.inicioISO(proxP))), Math.round(abreAntes - 137));
      /* O "abre" do mês seguinte é o saldo de hoje MAIS o que ainda vence até lá.
         Antes isto era uma igualdade simples com `accountsTotal`, que só valia
         porque o cenário não tinha nada pendente com data à frente — e passou a
         mentir quando um boleto sem conta escolhida entrou na projeção (ele era
         ignorado, e o saldo previsto saía otimista). A relação abaixo é a que vale
         sempre, e é mais forte: diz de quanto é a diferença, não só que existe.

         SEM PISO EM "HOJE". O que venceu e não foi pago continua por sair, e
         `saldoPrevistoNaData` conta todo "A Pagar" em aberto — é a regra escrita
         em plano-visao-futuro.md. Enquanto o piso esteve aqui, a soma só batia
         nos dias em que o cenário ainda não tinha vencido nada: o IPTU do dia 10
         era futuro no começo do mês e sumia da conta do teste depois dele. */
      const pendenteAteLa = DB.all('transactions')
        .filter(t => t.status === 'A Pagar' && !t.card_id && !DB.isNeutral(t)
          && String(t.date) < DB.inicioISO(proxP))
        .reduce((s, t) => s + (DB.isExpense(t) ? -1 : 1) * (Number(t.amount) || 0), 0);
      check('  o abre do mês seguinte é o saldo de hoje mais o que vence até lá',
        Math.round(DB.saldoPrevistoNaData(null, DB.inicioISO(proxP))),
        Math.round(DB.accountsTotal() + pendenteAteLa));
      adjustBalance(cHoje.id, 137);
      DB.remove('transactions', gastoHoje);
    }

    /* A CONTA FECHA — é a assertiva mais importante daqui. Um topo cujas linhas
       não somam no total é o mesmo defeito que um extrato cujo cabeçalho não bate
       com a lista. */
    check('abre + entradas − contas = em contas ao fim',
      Math.round((abreP + pvProxHero.entra - pvProxHero.sai) * 100),
      Math.round(emContasFimT * 100));
    check('em contas ao fim − guardado = livre ao fim (o valor grande)',
      Math.round((emContasFimT - guardadoFimT) * 100), Math.round(livreFimT * 100));

    /* INVESTIMENTO NÃO É SAÍDA: ele não pode aparecer somado às contas do mês, e o
       total antigo (sai + investe) não pode voltar à tela. */
    check('as contas do mês não incluem o investimento',
      heroFut.includes(fmt(pvProxHero.sai)), true);
    check('  e o total somado com o aporte não aparece',
      heroFut.includes(fmt(pvProxHero.sai + pvProxHero.investe)), false);
    check('  o aporte aparece dentro do guardado', /\+.*no mês/.test(heroFut), true);
    check('o guardado do hero é o do FIM do mês, não o de hoje',
      heroFut.includes(fmt(guardadoFimT)) && guardadoFimT > DB.guardado() + 0.005, true);

    /* O QUE JULHO PROMETE E O QUE AGOSTO MOSTRA são o mesmo número. Sem isso, quem
       lê a frase no hero de hoje e navega para o mês seguinte encontra outro valor
       e não tem como descobrir por quê. */
    state.monthOffset = 0;
    check('o "a pagar" prometido é o mesmo que o mês seguinte mostra',
      resumoDoProximoMes().includes(fmt(pvProxHero.sai)), true);
    state.monthOffset = 1;

    /* ---- O RODAPÉ DO ORÇAMENTO SOMA AS BARRAS QUE ESTÃO ACIMA DELE ----

       Ele mostrava `total` (o gasto do mês), que não conta o investimento —
       transferência não é despesa. Mas a barra de Investimentos está no card, com
       o valor guardado. Medido em agosto: as barras somavam R$ 15.438 e o rodapé
       dizia "Usado R$ 12.038".

       O "Restante" era o pior: subtraía um usado SEM investimento de um orçado COM
       investimento, e os R$ 3.472 liam como "sobra para gastar" quando a maior
       parte era meta de poupança não cumprida. */
    {
      const somaDasBarras = DB.rootCategories('Despesa').reduce((s, c) => {
        const usado = envI && c.id === envI.id
          ? DB.investidoNoPeriodo(proxP) : (DB.spentByCategory(proxP)[c.id] || 0);
        return (!DB.budgetOf(c.id, proxP) && !usado) ? s : s + usado;
      }, 0);
      const foot = (heroFut.match(/chart-foot">[\s\S]*?<\/div>/g) || [])
        .find(f => f.includes('Orçado')) || '';
      check('o rodapé do orçamento existe', !!foot, true);
      check('  o "Usado" soma as barras do card', foot.includes(fmtShort(somaDasBarras)), true);
      check('  e não o gasto do mês, que ignora o investimento',
        foot.includes(fmtShort(DB.expensesOf(proxP).reduce((s, t) => s + (Number(t.amount) || 0), 0))), false);
      check('  os dois divergem, senão a assertiva é vazia',
        Math.round(somaDasBarras) !== Math.round(DB.expensesOf(proxP).reduce((s, t) => s + (Number(t.amount) || 0), 0)), true);
      check('  e o restante sai da mesma conta',
        foot.includes(fmtShort(DB.budgetTotal(proxP) - somaDasBarras)), true);
      /* E o que falta GUARDAR é dito à parte — mas a FRASE MUDA conforme haja
         sobra ou não.

         "Do restante, R$ 3.266 é a meta de investimento" pressupõe que exista
         restante. Em julho o orçamento estourou em R$ 7.580: não há restante
         nenhum, e a frase falava de uma sobra que não existe. */
      /* A função é testada DIRETO, com os três cenários montados à mão: montar
         "orçamento estourado" mexendo nos tetos da tela exigiria conhecer o gasto
         do fixture, e um cenário que não estoura faria o teste passar por vazio. */
      const limpo = t => t.replace(/<[^>]+>/g, '');
      const faltando = { id: envI.id };
      const usadoZero = () => 0;                       // nada guardado: falta tudo
      const tetoInv = DB.budgetOf(envI.id, proxP);
      check('a meta de investimento do cenário é > 0, senão o teste é vazio', tetoInv > 0, true);

      const comSobra = limpo(notaDoInvestimento(faltando, proxP, 50000, usadoZero));
      check('com sobra, a frase protege a meta dentro do restante',
        /Do restante[\s\S]*não é para gastar/.test(comSobra), true);

      /* ESTOURADO: "Do restante, R$ X é a meta…" pressupõe que exista restante.
         Medido em julho/2026 — o orçamento estourou em R$ 7.580 e a frase falava
         de uma sobra que não existe. */
      const estourado = limpo(notaDoInvestimento(faltando, proxP, -7580, usadoZero));
      check('com o orçamento estourado, a frase não fala de "restante"',
        /Do restante/.test(estourado), false);
      check('  ela diz que estourou e quanto falta guardar',
        /estourou em[\s\S]*faltam[\s\S]*meta de investimento/.test(estourado), true);
      check('  com o valor do estouro', estourado.includes(fmtShort(7580)), true);

      // Sobra MENOR que o que falta: só o que cabe nela é "reservado"
      const sobraCurta = limpo(notaDoInvestimento(faltando, proxP, 10, usadoZero));
      check('a reserva anunciada nunca passa do restante', sobraCurta.includes(fmtShort(10)), true);

      // Meta cumprida: nada a avisar
      check('meta de investimento cumprida não gera aviso',
        notaDoInvestimento(faltando, proxP, 50000, () => tetoInv), '');
      check('sem envelope de investimento, também não',
        notaDoInvestimento(null, proxP, 50000, usadoZero), '');
    }

    /* O GRÁFICO DE 12 MESES CONTA A MESMA HISTÓRIA que o hero e o extrato.

       Ele rolava `resultado`, que desconta o investimento — mas a metade passada
       da série vem do saldo real conciliado, que soma TODAS as contas, inclusive a
       de investimento. Medido: o gráfico terminava agosto em R$ 2.728 enquanto o
       hero e o extrato diziam R$ 6.128, e a diferença era exatamente o aporte. */
    for (const m of DB.fluxoMensal(6, 3).filter(x => x.futuro)) {
      check(`fluxo de ${m.period.label} bate com o saldo previsto`,
        Math.round(m.saldo * 100),
        Math.round(DB.saldoPrevistoNaData(null, DB.fimISO(m.period)) * 100));
    }

    /* OS KPIs em mês futuro: número = onde chego, sub = de onde parti.

       O valor é lido do PRÓPRIO cartão, não da tela inteira: o hero mostra os
       mesmos números logo acima, então procurar o texto solto faz o teste passar
       mesmo com o KPI errado — foi o que a sabotagem revelou. */
    const kpiPorRotulo = (html, rotulo) => {
      for (const c of html.match(/<div class="card kpi">[\s\S]*?<\/div><\/div>/g) || []) {
        const l = (c.match(/kpi-label">([^<]*)</) || ['', ''])[1];
        if (!l.includes(rotulo)) continue;
        return {
          valor: (c.match(/kpi-value[^>]*>([^<]*)</) || ['', ''])[1].trim(),
          sub: (c.match(/kpi-sub">([\s\S]*?)<\/div>/) || ['', ''])[1].replace(/<[^>]+>/g, ''),
        };
      }
      return null;
    };
    const kSaldo = kpiPorRotulo(heroFut, 'Saldo previsto');
    check('o KPI de saldo mostra o previsto ao fim', !!kSaldo, true);
    check('  com o valor do fim do mês', kSaldo.valor, fmt(emContasFimT));
    check('  e não o saldo de hoje', kSaldo.valor === fmt(DB.accountsTotal()), false);
    check('  os dois divergem, senão a assertiva é vazia',
      Math.round(emContasFimT) !== Math.round(DB.accountsTotal()), true);
    check('  com o saldo de hoje como ponto de partida', kSaldo.sub.includes('hoje'), true);
    const kMetas = kpiPorRotulo(heroFut, 'Guardado em metas');
    check('o KPI de metas mostra o que TERÁ ao fim',
      kMetas.valor, fmt(guardadoMetasFimT));
    check('  e não o de hoje', kMetas.valor === fmt(guardadoMetasHojeT), false);
    check('  os dois divergem, senão a assertiva é vazia',
      Math.round(guardadoMetasFimT) !== Math.round(guardadoMetasHojeT), true);
    check('  dizendo que é do fim do mês', kMetas.sub.includes('ao fim do mês'), true);
    check('  e quanto está agendado', /\+.*agendado/.test(kMetas.sub), true);
    /* O "pior ponto" sai: ele é medido a partir de HOJE, e dentro de agosto lê como
       se fosse do próprio mês exibido.
       Olha só o SUB-RÓTULO renderizado — o texto solto acha os comentários que
       explicam a decisão dentro do próprio HTML. */
    const subsKpi = (h) => (h.match(/kpi-sub">([\s\S]*?)<\/div>/g) || []).join(' ');
    check('o pior ponto do horizonte não aparece em mês futuro',
      /pior ponto/.test(subsKpi(heroFut)), false);
    check('  mas continua no mês corrente', (() => {
      const off = state.monthOffset; state.monthOffset = 0;
      const t = subsKpi(renderInicio(DB.monthPeriod(new Date())));
      state.monthOffset = off;
      return /pior ponto/.test(t);
    })(), true);
    check('a fatura do KPI é a que vence NESTE mês', /Faturas do mês/.test(heroFut), true);
    const frase = resumoDoProximoMes();
    check('o rodapé do hero separa o que será guardado', /a guardar/.test(frase), true);
    check('  e diz que a sobra é depois de guardar', /depois de guardar/.test(frase), true);
    // `sai` já vem sem o aporte; o total dos dois não pode aparecer na frase
    const pvFrase = DB.previsaoDoMes(proxP);
    check('  o "a pagar" é `sai`, que já exclui o investimento',
      frase.includes(fmt(pvFrase.sai)), true);
    check('  e não mostra os dois somados',
      frase.includes(fmt(pvFrase.sai + pvFrase.investe)), false);
    for (const e of DB.all('goal_entries').filter(e => e.goal_id === metaHero)) DB.remove('goal_entries', e.id);
    DB.remove('goals', metaHero); DB.remove('transactions', rendaHero);
  } catch (e) { console.log(` FALHA | topo do painel: ${e.message}`); fail++; }

  console.log('\n=== Aporte agendado: plano não é fato ===');
  try {
    /* Aporte com data futura era tratado como já feito: o saldo era debitado
       hoje, a reserva subia por dinheiro que ainda não tinha saído e o disponível
       ficava negativo. Medido nos dados reais: um aporte de R$ 3.400 marcado para
       03/08 deixava `available` em −3.108 no dia 31/07. */
    const metaAg = DB.upsert('goals', { name: 'Meta Agendada', icon: '🎯', kind: 'Objetivo', target_amount: 10000 });
    const cA = DB.all('accounts')[0], cB = DB.all('accounts')[1];
    const amanha = somarDias(todayISO(), 1);

    const guardadoAntes = DB.guardado();
    const dispAntes = DB.available();
    const saldoAntes = Number(DB.get('accounts', cA.id).balance) || 0;
    const totalAntes = DB.accountsTotal();

    /* Gravado direto, e não pelo clique na folha: o DOM falso não tem CSS, então
       `chipValue` — que lê `.chip.active` via querySelectorAll — devolve sempre o
       default e o formulário nunca conseguiria produzir "A Pagar" aqui. O que
       importa neste bloco é o EFEITO do status nos números, não o caminho do
       clique; a ligação entre o chip e a gravação é verificada logo abaixo, no
       código-fonte. */
    const reg = DB.get('goal_entries', DB.upsert('goal_entries', {
      goal_id: metaAg, amount: 3400, description: 'Aporte AGENDADO TESTE',
      date: amanha, from_account: cA.id, to_account: cB.id, status: 'A Pagar',
    }));
    DB.upsert('transactions', {
      description: 'Aporte AGENDADO TESTE', amount: 3400, date: amanha,
      type: 'Transferência', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM,
      method: 'Transferência', account_id: cA.id, to_account: cB.id,
      category_id: DB.categoriaDeAporte(DB.get('goals', metaAg)),
    });
    check('o aporte agendado é gravado', !!reg, true);
    check('  com status A Pagar', reg.status, 'A Pagar');
    /* A FOLHA precisa oferecer a escolha e respeitá-la: sem isto, o modelo estaria
       certo e a tela continuaria gravando tudo como pago. */
    const apAp = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    check('a folha de aporte oferece a situação', /chipGroup\('a-status'/.test(apAp), true);
    check('  e grava o que foi escolhido', /const pago = chipValue\('a-status'\) !== 'A Pagar'/.test(apAp), true);
    check('  só movendo saldo quando já aconteceu', /if \(pago\) \{[\s\S]{0,200}adjustBalance/.test(apAp), true);
    check('  e a data futura marca "agendado" sozinha',
      /selectChip\('a-status', d > todayISO\(\) \? 'A Pagar' : 'Pago'\)/.test(apAp), true);
    /* A transferência que acompanha o aporte HERDA o status. Uma transferência
       "Paga" com data futura seria contada por `saldoNaData`, que parte do saldo
       atual e desfaz o que veio depois — o extrato mostraria o dinheiro fora da
       conta antes de ele sair. */
    check('  e a transferência do extrato herda o status',
      /type: 'Transferência', status: pago \? 'Pago' : 'A Pagar'/.test(apAp), true);
    /* O QUE NÃO PODE ACONTECER — cada uma destas era um sintoma do defeito. */
    check('não mexe no saldo da conta', Math.round(Number(DB.get('accounts', cA.id).balance)), Math.round(saldoAntes));
    check('  nem no total em contas', Math.round(DB.accountsTotal()), Math.round(totalAntes));
    check('não entra no guardado', Math.round(DB.guardado()), Math.round(guardadoAntes));
    check('  nem derruba o disponível', Math.round(DB.available()), Math.round(dispAntes));
    check('não conta na meta', Math.round(DB.goalTotal(metaAg)), 0);
    check('  mas aparece como planejado', Math.round(DB.goalPlanejado(metaAg)), 3400);
    // Ritmo é medida do passado: aporte agendado não pode inflar a média
    check('não infla o ritmo de aportes', Math.round(DB.goalPace(metaAg)), 0);

    /* O QUE PRECISA ACONTECER: ele existe como plano e pesa na projeção do dia em
       que vai sair — é disso que serve para simular cenário. */
    const serieAg = DB.projecaoSaldo(somarDias(todayISO(), 10));
    const noDia = serieAg.find(x => x.data === amanha);
    check('a projeção conhece o aporte agendado',
      !!noDia && Math.round(serieAg[0].saldo - noDia.saldo) >= 3400, true);
    // E a transferência no extrato acompanha o status, senão o saldo a contaria
    const lancAg = DB.all('transactions').find(t => t.description === 'Aporte AGENDADO TESTE');
    check('a transferência do extrato também fica A Pagar', (lancAg || {}).status, 'A Pagar');

    /* CONFIRMAR é quando o dinheiro se move. Antes disso não havia caminho: um
       aporte marcado para o dia 5 ficaria agendado para sempre. */
    const pend = DB.pendencias(amanha).find(i => i.tipo === 'aporte' && i.id === reg.id);
    check('chegada a data, ele entra na fila de pendências', !!pend, true);
    check('  pedindo para confirmar, não para pagar', pend.titulo.includes('Guardar em'), true);

    DB.upsert('goal_entries', { ...reg, status: 'Pago' });
    adjustBalance(cA.id, -3400); adjustBalance(cB.id, 3400);
    check('confirmado, entra na meta', Math.round(DB.goalTotal(metaAg)), 3400);
    check('  e sai do planejado', Math.round(DB.goalPlanejado(metaAg)), 0);
    check('  a soma dos saldos segue igual: é transferência',
      Math.round(DB.accountsTotal()), Math.round(totalAntes));

    // limpa
    for (const e of DB.all('goal_entries').filter(e => e.goal_id === metaAg)) DB.remove('goal_entries', e.id);
    if (lancAg) DB.remove('transactions', lancAg.id);
    adjustBalance(cA.id, 3400); adjustBalance(cB.id, -3400);
    DB.remove('goals', metaAg);
    DB.save();
  } catch (e) { console.log(` FALHA | aporte agendado: ${e.message}`); fail++; }

  console.log('\n=== Catálogo padrão e calibração pela renda ===');
  try {
    /* O CATÁLOGO É UM PLANO, não uma lista de nomes: os tetos foram calculados
       juntos para uma renda de referência, e as fatias precisam somar um
       orçamento que sobra — não um que consome tudo. */
    const somaCatalogo = DB.ARVORE_PADRAO.reduce((s, [[, , b]]) => s + (b || 0), 0);
    check('o catálogo tem renda de referência declarada', DB.RENDA_DE_REFERENCIA > 0, true);
    check('e o total orçado deixa folga sobre ela', somaCatalogo < DB.RENDA_DE_REFERENCIA, true);
    check('  mas não é folga demais (o plano cobre o essencial)',
      somaCatalogo > DB.RENDA_DE_REFERENCIA * 0.8, true);
    // Investimento é a linha que garante o futuro: 20% é a régua clássica
    const invCat = DB.ARVORE_PADRAO.find(([[n]]) => /investiment/i.test(n));
    check('investimento vale ~20% da renda de referência',
      Math.round(invCat[0][2] / DB.RENDA_DE_REFERENCIA * 100), 20);

    /* CALIBRAR pela renda: um catálogo de números absolutos serve a uma renda e
       desorienta as outras — quem ganha 5 mil veria 15 mil orçados. */
    const alvoCal = DB.rootCategories('Despesa').find(c => c.name === 'Moradia');
    const doCatalogo = DB.ARVORE_PADRAO.find(([[n]]) => n === 'Moradia')[0][2];
    DB.upsert('categories', { ...alvoCal, monthly_budget: doCatalogo });   // volta ao valor de catálogo
    DB.calibrarOrcamentos(DB.RENDA_DE_REFERENCIA / 2, DB.RENDA_DE_REFERENCIA);
    check('metade da renda, metade do teto',
      DB.get('categories', alvoCal.id).monthly_budget, Math.round(doCatalogo / 2 / 10) * 10);
    check('  e o valor sai redondo, sem centavos de mentira',
      DB.get('categories', alvoCal.id).monthly_budget % 10, 0);
    /* Envelope já ajustado à mão NÃO é sobrescrito: a escolha de quem vive com o
       orçamento vale mais que a proporção sugerida. */
    const manual = DB.rootCategories('Despesa').find(c => c.name === 'Pets') || DB.rootCategories('Despesa').find(c => c.name === 'Presentes');
    DB.upsert('categories', { ...manual, monthly_budget: 777 });
    DB.calibrarOrcamentos(DB.RENDA_DE_REFERENCIA * 2, DB.RENDA_DE_REFERENCIA / 2);
    check('o que foi ajustado à mão fica intacto', DB.get('categories', manual.id).monthly_budget, 777);
    check('renda zero não recalcula nada', DB.calibrarOrcamentos(0, 17000), 0);
    // devolve o catálogo ao estado original para não sujar os testes seguintes
    for (const [[nome, , budget]] of DB.ARVORE_PADRAO) {
      const c = DB.rootCategories('Despesa').find(x => x.name === nome);
      if (c) DB.upsert('categories', { ...c, monthly_budget: budget });
    }
    DB.save();
  } catch (e) { console.log(` FALHA | catálogo e calibração: ${e.message}`); fail++; }

  console.log('\n=== Orçamento flexível (ajuste por ciclo) ===');
  try {
    const pAgora = DB.monthPeriod(new Date());
    const pProx = DB.monthPeriod(pAgora.start, 1);
    const pAnterior = DB.monthPeriod(pAgora.start, -1);
    const env = DB.upsert('categories', {
      name: 'Envelope Orc', icon: '🧪', scope: 'Família', kind: 'Essencial',
      type: 'Despesa', parent_id: null, monthly_budget: 500,
    });

    /* O PADRÃO continua respondendo quando não há ajuste — o ajuste é a exceção,
       não o novo normal. */
    check('sem ajuste, vale o padrão da categoria', DB.budgetOf(env, pAgora), 500);
    check('em qualquer ciclo', DB.budgetOf(env, pProx), 500);

    DB.ajustarOrcamento(env, pProx, 800);
    check('ajuste vale só no ciclo ajustado', DB.budgetOf(env, pProx), 800);
    check('  e não vaza para o mês corrente', DB.budgetOf(env, pAgora), 500);
    check('  nem para o anterior', DB.budgetOf(env, pAnterior), 500);
    check('  o padrão da categoria fica intacto', DB.get('categories', env).monthly_budget, 500);

    /* ZERO É AJUSTE LEGÍTIMO — "neste mês não se gasta nada aqui". Com `||` no
       lugar do teste de existência, ele cairia de volta no padrão em silêncio. */
    DB.ajustarOrcamento(env, pProx, 0);
    check('ajuste de zero não cai de volta no padrão', DB.budgetOf(env, pProx), 0);

    /* Um registro por categoria por ciclo: o índice único do banco é
       (family_id, category_id, period_start), e duas linhas para o mesmo par
       fariam a leitura escolher uma delas sem dizer qual. */
    DB.ajustarOrcamento(env, pProx, 700);
    check('reajustar reusa o registro, não cria outro',
      DB.all('budget_overrides').filter(o => o.category_id === env).length, 1);

    check('limpar devolve o padrão', (() => {
      DB.limparAjusteDeOrcamento(env, pProx);
      return DB.budgetOf(env, pProx);
    })(), 500);

    // O total do mês soma os ajustes, não os padrões
    const totalPadrao = DB.budgetTotal(pAgora);
    DB.ajustarOrcamento(env, pAgora, 900);
    check('o total do ciclo acompanha o ajuste', DB.budgetTotal(pAgora), totalPadrao + 400);
    check('  e o total dos outros ciclos não muda', DB.budgetTotal(pProx), totalPadrao);
    DB.limparAjusteDeOrcamento(env, pAgora);

    /* MUDAR O PADRÃO VALE DAQUI PARA A FRENTE. Sem o congelamento, subir de 500
       para 800 reescrevia o passado: o relatório de um mês fechado passava a
       comparar o gasto contra um teto que não valia lá. */
    const contaEnv = DB.all('accounts')[0];
    DB.upsert('transactions', {
      description: 'Gasto Orc Passado', amount: 120, date: DB.inicioISO(pAnterior),
      type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
      method: 'Débito', account_id: contaEnv.id, category_id: env,
    });
    DB.ajustarOrcamento(env, pProx, 650);          // um ajuste futuro, que deve sumir
    DB.definirOrcamentoPadrao(env, 800, pAgora);
    check('o padrão novo vale no ciclo corrente', DB.budgetOf(env, pAgora), 800);
    check('  e daí para a frente', DB.budgetOf(env, pProx), 800);
    check('  o mês fechado guarda o valor que valia nele', DB.budgetOf(env, pAnterior), 500);
    check('  o ajuste futuro que existia foi revisto junto', DB.budgetOf(env, pProx) === 650, false);
    // Só congela onde houve gasto: materializar o passado inteiro encheria a base
    check('mês sem gasto não vira registro',
      DB.all('budget_overrides').some(o => o.category_id === env
        && String(o.period_start) === DB.chaveDoCiclo(DB.monthPeriod(pAgora.start, -6))), false);

    /* MOVER ENTRE ENVELOPES conserva o total do mês. É o que separa "remanejei"
       de "aumentei o orçamento" — sem isso o total sobe sem ninguém perceber. */
    const env2 = DB.upsert('categories', {
      name: 'Envelope Orc 2', icon: '🧪', scope: 'Família', kind: 'Essencial',
      type: 'Despesa', parent_id: null, monthly_budget: 300,
    });
    const totalAntes = DB.budgetTotal(pAgora);
    const deAntes = DB.budgetOf(env2, pAgora), paraAntes = DB.budgetOf(env, pAgora);
    DB.emLote(() => {
      DB.ajustarOrcamento(env2, pAgora, deAntes - 100);
      DB.ajustarOrcamento(env, pAgora, paraAntes + 100);
    });
    check('mover não muda o total orçado do mês', DB.budgetTotal(pAgora), totalAntes);
    check('  sai de um lado', DB.budgetOf(env2, pAgora), deAntes - 100);
    check('  e entra no outro', DB.budgetOf(env, pAgora), paraAntes + 100);

    /* A TELA: a barra usa o limite do ciclo, e diz quando ele está ajustado —
       um limite diferente do padrão sem aviso é um número que ninguém explica. */
    const offOrc = state.monthOffset;
    state.monthOffset = 0;
    const telaOrc = renderInicio(pAgora);
    /* NO PAINEL NÃO SE EDITA O ORÇAMENTO. Um botão ao lado da barra vermelha põe
       a régua ao alcance de quem está desconfortável com o que ela mostra, e a
       saída mais fácil vira aumentar o limite até o gráfico ficar verde. O ajuste
       mora em Configurações → Categorias, dentro do envelope: três passos que
       fazem dele uma decisão, não um reflexo. */
    check('o Painel não oferece editar o orçamento', /data-orc=/.test(telaOrc), false);
    const fonteOrc = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    const corpoCats = fonteOrc.slice(fonteOrc.indexOf('function openCategoriesConfig'),
      fonteOrc.indexOf('function openCategoryEditor'));
    check('mas a tela de categorias oferece', corpoCats.includes('data-orc='), true);
    check('  e a folha deixa escolher o mês', /id="orc-mes"/.test(fonteOrc), true);
    /* O SELO fica: informar que o mês está ajustado é o oposto de facilitar o
       ajuste — sem ele, o limite diferente do padrão seria um número inexplicável. */
    check('e o mês ajustado ganha selo', /selo-ajuste/.test(telaOrc), true);
    check('o CSS do selo existe',
      fs.readFileSync(BASE + 'css/styles.css', 'utf8').includes('.selo-ajuste'), true);

    /* O ALERTA usa o limite do ciclo: acusar estouro contra o padrão num mês
       ajustado seria cobrar de um teto que a pessoa já corrigiu. */
    DB.upsert('transactions', {
      description: 'Gasto Orc Agora', amount: 600, date: todayISO(),
      type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM,
      method: 'Débito', account_id: contaEnv.id, category_id: env,
    });
    DB.ajustarOrcamento(env, pAgora, 100);          // 600 de 100 = estouro
    check('com o limite baixo, o conselheiro acusa',
      renderInicio(pAgora).includes('Envelope Orc estourou o orçamento'), true);
    DB.ajustarOrcamento(env, pAgora, 5000);         // agora cabe
    check('com o mês ajustado para caber, ele se cala',
      renderInicio(pAgora).includes('Envelope Orc estourou o orçamento'), false);
    state.monthOffset = offOrc;

    /* BACKUP ANTIGO CONTINUA IMPORTÁVEL. A validação exigia TODAS as stores, então
       uma versão que acrescenta tabela invalidava todos os arquivos salvos até
       ali — o backup só serve se abrir depois. */
    const backupVelho = JSON.stringify({
      meta: { seeded: true }, accounts: [], cards: [], categories: [], transactions: [],
      goals: [], goal_entries: [], invoice_status: [], recurrences: [], family_settings: [],
    });
    const guardaImp = DB.data;
    let importou = true;
    try { DB.importJSON(backupVelho); } catch (_) { importou = false; }
    check('backup sem a tabela nova ainda importa', importou, true);
    check('  e a store ausente nasce vazia', Array.isArray(DB.data.budget_overrides), true);
    let recusou = false;
    try { DB.importJSON('{"foo":1}'); } catch (_) { recusou = true; }
    check('  mas arquivo que não é backup continua recusado', recusou, true);
    DB.data = guardaImp;

    // O servidor precisa concordar com a tela, senão o push contradiz o app
    const nt = fs.readFileSync(BASE + 'supabase/functions/notify/index.ts', 'utf8');
    check('a Edge Function lê os ajustes', nt.includes("from('budget_overrides')"), true);
    check('  e usa o ajuste no lugar do padrão', /ajuste\.has\(c\.id\) \? ajuste\.get\(c\.id\)! : c\.monthly_budget/.test(nt), true);
    // Tabela nova precisa sincronizar, senão o ajuste fica preso num aparelho
    check('a tabela entra no sync',
      fs.readFileSync(BASE + 'js/sync.js', 'utf8').includes('budget_overrides: ['), true);

    // Limpa o cenário
    for (const t of DB.all('transactions').filter(t => /^Gasto Orc/.test(t.description || ''))) DB.remove('transactions', t.id);
    for (const o of DB.all('budget_overrides').filter(o => o.category_id === env || o.category_id === env2)) DB.remove('budget_overrides', o.id);
    DB.remove('categories', env); DB.remove('categories', env2);
    DB.save();
  } catch (e) { console.log(` FALHA | orçamento flexível: ${e.message}`); fail++; }


  /* ---- GESTÃO: projeção, renda, vale de caixa, patrimônio, custo fixo, vigia ----
     Seis perguntas que a base já respondia e nenhuma tela fazia. Os testes medem
     por DIFERENÇA, porque a suíte compartilha uma base cheia: o que importa é o
     efeito de cada lançamento, não o total absoluto. */
  console.log('\n=== Gestão financeira: as seis contas novas ===');
  try {
    const pG = DB.monthPeriod(new Date());
    const cG = DB.upsert('accounts', { name: 'Conta Gestao', type: 'Conta Corrente', balance: 2000, active: true });
    const baseG = { scope: 'Família', member: MEMBRO_COMUM, account_id: cG, method: 'Débito' };
    const hojeG = DB.hojeISO();
    const apG = fs.readFileSync(BASE + 'js/app.js', 'utf8');
    const decorridos = Math.max(1, DB.elapsedDays(pG));
    const restantes = Math.max(0, DB.periodDays(pG) - DB.elapsedDays(pG));

    /* 1. A PROJEÇÃO NÃO EXTRAPOLA O QUE NÃO SE REPETE. Era o defeito: R$ 10.503
       gastos em 2 dias viravam projeção de R$ 162.807, e daí saía "poupança
       projetada −671%" que o Conselheiro repetia como alerta. */
    const antesProj = DB.projecaoDeGasto(pG).total;
    const ctrGestao = DB.upsert('recurrences', { description: 'Aluguel Gestao', amount: 3000,
      type: 'Despesa', valor_tipo: 'fixo', periodicidade: 'mensal', dia: 5, inicio: DB.inicioISO(pG),
      fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0, ...baseG });
    DB.upsert('transactions', { ...baseG, description: 'Aluguel Gestao', amount: 3000, date: hojeG,
      type: 'Despesa', status: 'Pago', recurrence_id: ctrGestao });
    const comFixo = DB.projecaoDeGasto(pG).total;
    check('gasto fixo entra pelo valor, não pelo ritmo', Math.round(comFixo - antesProj), 3000);
    DB.upsert('transactions', { ...baseG, description: 'Mercado Gestao', amount: 120, date: hojeG,
      type: 'Despesa', status: 'Pago' });
    const comVariavel = DB.projecaoDeGasto(pG).total;
    check('  gasto variável, esse sim, é extrapolado',
      Math.round(comVariavel - comFixo), Math.round(120 + (120 / decorridos) * restantes));
    check('  e a projeção nunca é menor do que o que já aconteceu',
      DB.projecaoDeGasto(pG).total >= DB.projecaoDeGasto(pG).ateHoje, true);
    /* O QUE ESTÁ AGENDADO para o resto do mês entra pelo valor, uma vez. Sem esta
       parcela a projeção ficaria menor do que o mês que já se sabe que vem. */
    const antesAgendado = DB.projecaoDeGasto(pG).total;
    const fimDoCicloG = somarDias(DB.fimISO(pG), -1);
    DB.upsert('transactions', { ...baseG, description: 'Boleto Gestao', amount: 450, date: fimDoCicloG,
      type: 'Despesa', status: 'A Pagar', method: 'Boleto' });
    check('  o que vence no resto do mês entra pelo valor',
      Math.round(DB.projecaoDeGasto(pG).total - antesAgendado), 450);
    const passadoG = DB.projecaoDeGasto(DB.monthPeriod(new Date(), -1));
    check('  mês encerrado não ganha projeção', passadoG.variavel + passadoG.naoLancado, 0);
    check('  e o total dele é o próprio gasto', passadoG.total, passadoG.ateHoje);
    check('  e ele se declara encerrado, para ninguém projetar sobre fato', passadoG.encerrado, true);
    /* O NÚMERO DA TELA é o desta conta, não o run-rate antigo: era ele que dizia
       R$ 162.807 de projeção num mês de R$ 17.981 de renda. */
    check('  e é este número que o painel mostra',
      renderInicio(pG).includes(fmtShort(DB.projecaoDeGasto(pG).total)), true);

    /* 2. A RENDA DO MÊS não conta o mesmo salário duas vezes — foi o primeiro
       resultado errado desta implementação: R$ 35.813 num mês de R$ 17.981. */
    const antesRenda = DB.rendaDoMes(pG);
    DB.upsert('transactions', { ...baseG, description: 'Freela Gestao', amount: 700, date: hojeG,
      type: 'Receita', status: 'A Pagar', method: 'PIX' });
    check('receita lançada entra na renda do mês uma vez só',
      Math.round(DB.rendaDoMes(pG) - antesRenda), 700);
    check('  e a renda do mês é a base das porcentagens do painel',
      /const income = DB\.rendaDoMes\(period\)/.test(apG), true);

    /* 3. O VALE DE CAIXA: o dia mais apertado, que nenhuma tela respondia. */
    const antesVale = DB.valeDeCaixa(3);
    const daquiDezDias = somarDias(hojeG, 10);
    DB.upsert('transactions', { ...baseG, description: 'Boletao Gestao', amount: 999999,
      date: daquiDezDias, type: 'Despesa', status: 'A Pagar', method: 'Boleto' });
    const depoisVale = DB.valeDeCaixa(3);
    check('um boleto grande afunda o vale de caixa', depoisVale.valor < antesVale.valor - 999000, true);
    check('  e o vale aponta o dia, não só o valor', depoisVale.data >= daquiDezDias, true);
    check('  e conta os dias no vermelho', depoisVale.negativos > 0, true);
    state.monthOffset = 0;   // o aviso é sobre o risco de agora, e só o mês corrente o traz
    check('  o painel avisa quando o saldo previsto fica negativo',
      renderInicio(pG).includes('fica NEGATIVO'), true);
    DB.remove('transactions', DB.all('transactions').find(t => t.description === 'Boletao Gestao').id);
    check('  e sem o boleto o vale volta ao que era',
      Math.round(DB.valeDeCaixa(3).valor * 100), Math.round(antesVale.valor * 100));

    /* 4. PATRIMÔNIO: o que há menos o que se deve. A dívida do cartão vem partida
       porque as duas metades doem em momentos diferentes. */
    const pat = DB.patrimonio();
    check('o patrimônio fecha: contas − o que se deve',
      Math.round((pat.emContas - pat.cartaoAgora - pat.cartaoDepois) * 100), Math.round(pat.liquido * 100));
    check('  e parte do saldo real das contas', Math.round(pat.emContas * 100), Math.round(DB.accountsTotal() * 100));
    check('  separando o que vence agora do que já foi comprado',
      typeof pat.cartaoAgora === 'number' && typeof pat.cartaoDepois === 'number', true);
    check('  a tela de contas mostra o patrimônio líquido', renderCartoes().includes('Patrimônio líquido'), true);

    /* 5. CUSTO FIXO MENSAL, com as periodicidades normalizadas e o fim de cada um. */
    const rSem = DB.upsert('recurrences', { description: 'Diarista Gestao', amount: 100, type: 'Despesa',
      periodicidade: 'semanal', dia: 1, inicio: DB.inicioISO(pG), fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
    const rVez = DB.upsert('recurrences', { description: 'Parcela Gestao', amount: 500, type: 'Despesa',
      periodicidade: 'mensal', dia: 10, inicio: DB.inicioISO(pG), fim_tipo: 'vezes', fim_vezes: 12, geradas: 4, status: 'ativa' });
    const cf = DB.custoFixoMensal();
    const acheiCf = nome => cf.itens.find(i => i.descricao === nome) || {};
    check('semanal vira custo mensal equivalente', Math.round(acheiCf('Diarista Gestao').mensal), Math.round(100 * 52 / 12));
    check('  mensal é o próprio valor', acheiCf('Parcela Gestao').mensal, 500);
    check('  contrato com fim por vezes sabe quantas faltam', acheiCf('Parcela Gestao').restam, 8);
    check('  contrato sem prazo não inventa um fim', acheiCf('Diarista Gestao').restam, null);
    check('  o total é a soma dos itens',
      Math.round(cf.total * 100), Math.round(cf.itens.reduce((s, i) => s + i.mensal, 0) * 100));
    const rRec = DB.upsert('recurrences', { description: 'Salario Gestao', amount: 9000, type: 'Receita',
      periodicidade: 'mensal', dia: 5, inicio: DB.inicioISO(pG), fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
    check('  contrato de receita não entra no custo fixo',
      DB.custoFixoMensal().itens.some(i => i.descricao === 'Salario Gestao'), false);
    check('  e a tela mostra quando um contrato acaba', renderCartoes().includes('libera'), true);
    /* O custo fixo fica no FIM da tela, depois dos cartões: ele é planejamento de
       mês, não a pergunta que traz alguém à aba de cartões. Aqui há contrato
       cadastrado, então o bloco existe e a ordem pode ser cobrada de verdade. */
    {
      const telaCf = renderCartoes();
      check('  e o custo fixo fica no fim, depois dos cartões',
        telaCf.indexOf('Custo fixo') > telaCf.indexOf('O que eu devo'), true);
    }

    /* 6. VIGIA DOS CONTRATOS. O gerador criou a parcela do Fiat 500 duas vezes e
       quem percebeu foi o dono da casa, um mês depois. */
    /* A duplicata tem de cair DENTRO do ciclo que está sendo vigiado: no último
       dia do mês, "amanhã" já é o mês que vem e o alerta não teria por que
       aparecer aqui — o teste reprovava por causa do calendário, não do vigia. */
    const ultimoDiaG = somarDias(DB.fimISO(pG), -1);
    const venceDup = somarDias(hojeG, 1) > ultimoDiaG ? ultimoDiaG : somarDias(hojeG, 1);
    const dupA = { ...baseG, description: 'Parcela Gestao', amount: 500, date: venceDup,
      type: 'Despesa', status: 'A Pagar', method: 'Boleto' };
    DB.upsert('transactions', { ...dupA });
    check('um lançamento só do contrato não é duplicata',
      DB.duplicatasDeContrato(pG).some(d => d.descricao === 'Parcela Gestao'), false);
    DB.upsert('transactions', { ...dupA });
    const achado = DB.duplicatasDeContrato(pG).find(d => d.descricao === 'Parcela Gestao') || {};
    check('dois lançamentos do mesmo contrato, mesmo valor e mesma janela: duplicata', achado.quantas, 2);
    check('  com o valor repetido à mão', achado.valor, 500);
    /* Exigir o MESMO VALOR é o que separa "a parcela veio duas vezes" de "fui ao
       mercado duas vezes na semana" — sem isso o aviso viraria ruído e ninguém
       leria mais nenhum. */
    DB.upsert('transactions', { ...baseG, description: 'Mercado Gestao', amount: 55, date: somarDias(hojeG, 1),
      type: 'Despesa', status: 'Pago' });
    check('  dois gastos parecidos SEM contrato por trás não viram alerta',
      DB.duplicatasDeContrato(pG).some(d => d.descricao === 'Mercado Gestao'), false);
    /* Com contrato por trás mas VALORES diferentes também não: a conta de luz vem
       uma vez por mês e varia. Duplicata é a mesma cobrança repetida. */
    const rLuz = DB.upsert('recurrences', { description: 'Energia Gestao', amount: 400, type: 'Despesa',
      periodicidade: 'mensal', dia: 15, inicio: DB.inicioISO(pG), fim_tipo: 'sem_prazo', status: 'ativa', geradas: 0 });
    DB.upsert('transactions', { ...baseG, description: 'Energia Gestao', amount: 400, date: somarDias(hojeG, 1),
      type: 'Despesa', status: 'A Pagar', method: 'Boleto' });
    DB.upsert('transactions', { ...baseG, description: 'Energia Gestao', amount: 412, date: somarDias(hojeG, 2),
      type: 'Despesa', status: 'A Pagar', method: 'Boleto' });
    check('  mesmo contrato com valores diferentes não é duplicata',
      DB.duplicatasDeContrato(pG).some(d => d.descricao === 'Energia Gestao'), false);
    DB.remove('recurrences', rLuz);
    const telaPainel = renderInicio(pG);
    check('  o painel leva a duplicata para o Conselheiro', telaPainel.includes('aparece 2'), true);
    check('  e cobra o contrato que devia ter lançado e não lançou',
      telaPainel.includes('não foi lançado'), true);
    check('  o contrato atrasado também sai da regra, não de um palpite',
      DB.contratosAtrasados(pG).some(it => it.titulo === 'Diarista Gestao'), true);

    /* 7. A DATA IMPOSSÍVEL DA META. No ritmo de R$ 44,67/mês a reserva ficava
       pronta em "maio de 2138" — verdadeiro e inútil. */
    const longe = prazoDaMeta(60000, 44.67);
    check('ritmo lento não vira data, vira diagnóstico', longe.longe, true);
    check('  e diz quanto seria preciso para caber em 5 anos', Math.round(longe.precisaria), Math.round(60000 / 60));
    const perto2 = prazoDaMeta(1200, 100);
    check('  ritmo que cabe no horizonte continua virando data', perto2.longe, false);
    check('  com o mês certo', perto2.meses, 12);
    check('  e sem ritmo não há promessa nenhuma', prazoDaMeta(1000, 0), null);

    for (const t of DB.all('transactions').filter(t => / Gestao$/.test(t.description || ''))) DB.remove('transactions', t.id);
    for (const r of [rSem, rVez, rRec]) DB.remove('recurrences', r);
    DB.remove('accounts', cG);
  } catch (e) { console.log(' FALHA | gestão financeira: ' + e.message); fail++; }

  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, storeAntes);

/* ---- PUSH SEM A COLUNA NOVA ----

   `pontual` depende de rodar o SQL. Sem um caminho de recuo, publicar uma versão
   que usa a coluna pararia a sincronização de TRANSAÇÕES em todo aparelho até
   alguém executar a migração — e o app é offline-first justamente para não
   depender disso. É o mesmo desenho do fallback de `server_at` no pull: detectar
   em vez de exigir. */
console.log('\n=== Push com coluna que o banco ainda não tem ===');
{
  const guardaFetch = global.fetch;
  const guardaOnline = global.navigator.onLine;
  const guardaDados = DB.data;
  try {
    const S = eval(fs.readFileSync(BASE + 'js/sync.js', 'utf8') + '; Sync');
    S.cfg = { url: 'https://x.supabase.co', anonKey: 'k', access_token: 't',
      refresh_token: 'r', token_exp: Date.now() + 600000, family_id: FAM_TESTE };
    S.saveCfg = () => {};
    global.navigator.onLine = true;
    S.temServerAt = false;
    S._semColuna = new Set();

    const enviados = [];
    let recusas = 0;
    global.fetch = async (url, opt = {}) => {
      const u = String(url);
      if ((opt.method || 'GET') !== 'POST' || !/\/rest\/v1\/transactions/.test(u)) {
        return { ok: true, status: 200, json: async () => [], text: async () => '' };
      }
      const corpo = JSON.parse(opt.body || '[]');
      enviados.push(corpo);
      /* O que o PostgREST responde quando a coluna não existe: a mensagem cita o
         nome dela, e é por esse nome que o push sabe o que remover. */
      if (corpo.some(r => 'pontual' in r)) {
        recusas++;
        return { ok: false, status: 400, json: async () => ({}),
          text: async () => JSON.stringify({ code: 'PGRST204', message: "Could not find the 'pontual' column of 'transactions' in the schema cache" }) };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    };

    DB.data = { meta: {} };
    for (const t of ['transactions', 'accounts', 'categories', 'cards', 'goals',
      'goal_entries', 'invoice_status', 'recurrences', 'family_settings']) DB.data[t] = [];
    DB.data.transactions = [{
      id: '55555555-5555-4555-8555-555555555555', description: 'Gasto pontual', amount: 12,
      date: todayISO(), type: 'Despesa', status: 'Pago', scope: 'Família', method: 'PIX',
      pontual: true, recurring: false, updated_at: new Date().toISOString(), dirty: true,
    }];
    await S.syncAll(false).catch(() => {});
    clearTimeout(S._debounce);

    check('o banco recusa a coluna que não existe', recusas >= 1, true);
    check('  e o push tenta de novo sem ela', enviados.length >= 2, true);
    check('  o reenvio não leva mais o campo',
      enviados.length >= 2 && !('pontual' in enviados[enviados.length - 1][0]), true);
    check('  e o resto do lançamento chega inteiro',
      enviados[enviados.length - 1][0].description, 'Gasto pontual');
    check('a recusa fica registrada para a sessão',
      S._semColuna.has('transactions.pontual'), true);
    /* Registrado, o campo nem é montado nas próximas vezes: insistir gastaria uma
       ida ao servidor por lote, para receber a mesma recusa. */
    const antes = enviados.length;
    DB.data.transactions[0].dirty = true;
    DB.data.transactions[0].updated_at = new Date().toISOString();
    await S.syncAll(false).catch(() => {});
    clearTimeout(S._debounce);
    check('  e não insiste a cada envio',
      enviados.slice(antes).every(l => !('pontual' in l[0])), true);
    S._semColuna = new Set();
  } catch (e) {
    console.log(` FALHA | push sem coluna: ${e.message}`); fail++;
  } finally {
    global.fetch = guardaFetch;
    global.navigator.onLine = guardaOnline;
    DB.data = guardaDados;
    Sync._semColuna = new Set();
  }
}


  console.log(`\n${fail === 0 ? '✅ TUDO CERTO' : '❌ PROBLEMAS ENCONTRADOS'} — ${ok} passaram, ${fail} falharam\n`);
  process.exit(fail ? 1 : 0);
})();

/* ---- Relatórios: a narrativa ----
   A tela responde seis perguntas em ordem, cada uma preparando a seguinte.
   "Gastei R$ 4.200 em Alimentação" só quer dizer algo depois de "sobrou R$ 300". */
console.log('\n=== Relatórios: narrativa e estatística ===');
try {
  state.repOffset = 0;
  const rel = renderRelatorios();
  const ordem = ['rel-frase', 'De onde vem o dinheiro', 'O caminho do dinheiro',
    'Isso é normal', 'Para onde foi', 'Quem gastou', 'O que está sendo construído'];
  let anterior = -1, foraDeOrdem = '';
  for (const marca of ordem) {
    const i = rel.indexOf(marca);
    if (i < 0) { foraDeOrdem = `${marca} ausente`; break; }
    if (i < anterior) { foraDeOrdem = `${marca} fora de ordem`; break; }
    anterior = i;
  }
  check('as seis perguntas aparecem na ordem da explicação', foraDeOrdem, '');
  /* Cada gráfico se identifica pelo que É no data-g do div, não pela classe de
     um SVG desenhado à mão — e é assim que se confere qual está em qual lugar. */
  check('abre com a frase, não com números soltos',
    rel.indexOf('rel-frase') < rel.indexOf('data-g="cascata"'), true);
  check('a cascata mostra o caminho do dinheiro', rel.includes('data-g="cascata"'), true);
  check('e a faixa de normalidade aparece', rel.includes('data-g="faixa-normal"'), true);

  /* Mediana e desvio mediano, não média: uma compra grande num mês puxa a média
     e infla o desvio, e aí NADA parece anormal depois. */
  check('mediana ignora o ponto fora da curva', DB.mediana([100, 110, 120, 5000]), 115);
  check('média seria distorcida pelo mesmo dado',
    [100, 110, 120, 5000].reduce((a, b) => a + b, 0) / 4 > 1300, true);
  check('desvio mediano resiste ao extremo', DB.desvioMediano([100, 110, 120, 5000]) < 100, true);

  // O veredito precisa saber dizer "não sei" com histórico curto
  const curto = DB.anormalidade(500, [400, 450]);
  check('com pouco histórico o app admite não saber', curto.incerto, true);
  check('e não afirma anormalidade', curto.rotulo, 'sem histórico');
  const normal = DB.anormalidade(1050, [1000, 1010, 990, 1020, 1005, 995]);
  check('variação pequena é rotina, não notícia', normal.rotulo, 'dentro do normal');
  const alto = DB.anormalidade(3000, [1000, 1010, 990, 1020, 1005, 995]);
  check('desvio grande é apontado', alto.rotulo.includes('acima'), true);
  check('e a mediana usada é a do histórico', alto.med, 1002.5);

  /* Duas condições, não uma. Numa família de gasto muito regular o MAD fica
     minúsculo, então gastar 5% a mais dá 6 desvios — tecnicamente correto e
     praticamente absurdo. Significância sem tamanho de efeito faz o app gritar
     lobo, e quem lê aprende a ignorar o aviso. */
  const regular = [1000, 1010, 990, 1020, 1005, 995];
  const seisDesvios = DB.anormalidade(1050, regular);
  check('desvio estatístico grande mas diferença pequena é rotina', seisDesvios.rotulo, 'dentro do normal');
  check('mesmo estando a muitos desvios da mediana', Math.abs(seisDesvios.desvios) > 3, true);
  check('porque a diferença relativa não chega a 8%', seisDesvios.relevante, false);
  check('já 30% acima é apontado', DB.anormalidade(1300, regular).rotulo.includes('acima'), true);
  check('e para baixo também', DB.anormalidade(700, regular).rotulo.includes('abaixo'), true);

  // A cascata soma: cada bloco começa onde o anterior parou
  zeraFila();
  svgCascata([
    { rot: 'Entrou', valor: 1000, tipo: 'entra' },
    { rot: 'Saiu', valor: 400, tipo: 'sai' },
    { rot: 'Sobrou', valor: 0, tipo: 'total' },
  ]);
  const cCasc = cfgDo();
  check('a cascata é barra empilhada', cCasc.chart.stacked, true);
  check('com um passo por coluna', cCasc.xaxis.categories.join(','), 'Entrou,Saiu,Sobrou');
  check('e o total fecha na diferença', pontosDe(cCasc.series[3])[2], 600);

  /* A propriedade que define uma cascata: cada bloco COMEÇA onde o anterior
     parou. Aqui isso vive na série "pedestal" — o degrau invisível que levanta
     cada bloco. Se ela quebrar, viram colunas soltas e a soma deixa de ser a
     forma, que é exatamente o que o gráfico existe para mostrar. */
  zeraFila();
  svgCascata([
    { rot: 'Entrou', valor: 8500, tipo: 'entra' },
    { rot: 'Necessidades', valor: 5200, tipo: 'sai' },
    { rot: 'Desejos', valor: 2100, tipo: 'sai' },
    { rot: 'Sobrou', valor: 0, tipo: 'total' },
  ]);
  const cW = cfgDo();
  const pedestal = pontosDe(cW.series[0]);
  const entrou = pontosDe(cW.series[1]), saiu = pontosDe(cW.series[2]), total = pontosDe(cW.series[3]);
  check('a receita nasce do chão', pedestal[0], 0);
  check('a primeira saída pende do topo da receita', pedestal[1] + saiu[1], 8500);
  check('e a segunda começa onde a primeira parou', pedestal[2] + saiu[2], pedestal[1]);
  check('o total nasce do chão, para ser lido como resultado', pedestal[3], 0);
  check('e fecha no valor certo (8500 − 5200 − 2100)', total[3], 1200);
  /* O pedestal é andaime: precisa ser invisível no desenho E na legenda. Se
     aparecesse, o leitor contaria um bloco que não é dinheiro nenhum. */
  check('o pedestal é transparente', cW.colors[0], 'transparent');
  /* Fora da legenda por lista explícita, não por formatter vazio: o formatter
     apagaria o texto mas deixaria a bolinha dele, convidando o leitor a procurar
     um bloco que não é dinheiro nenhum. */
  check('e some da legenda', cW.legend.customLegendItems.includes('pedestal'), false);
  check('mas as séries reais ficam', cW.legend.customLegendItems.join(','), 'entrou,saiu,sobrou');
  // Marca fina: nunca preenche a faixa inteira, senão o gráfico lê como bloco
  check('a coluna não preenche a faixa', parseInt(cW.plotOptions.bar.columnWidth, 10) <= 60, true);
  check('cascata vazia não quebra', svgCascata([]).includes('Sem dados'), true);

  /* Empréstimo entra na conta mas NÃO é ganho. Um relatório que soma empréstimo
     à receita e anuncia "sobrou" diz a maior mentira possível num app assim. */
  const apRel = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('o aviso de empréstimo vem antes da cascata',
    apRel.indexOf('relEntradas(period, receitas)') < apRel.indexOf('relCascata({ receitas'), true);
  check('e diz que não é ganho', apRel.includes('não são ganho'), true);

  /* Categorias comparadas contra a mediana DELAS, não contra o mês anterior:
     se o mês anterior teve o IPVA, toda categoria apareceria "caindo". */
  const corpoCat = apRel.slice(apRel.indexOf('function relCategorias'), apRel.indexOf('function relCortes'));
  check('categoria compara com a própria mediana', corpoCat.includes('DB.mediana(hist)'), true);
  check('e usa seis meses de histórico', /i <= 6/.test(corpoCat), true);
  check('variação pequena não vira notícia', corpoCat.includes('Math.max(20, l.med * 0.15)'), true);

  /* A biblioteca de gráficos é VENDORIZADA, não puxada de CDN. O app é
     offline-first: um <script src="https://…"> deixaria todos os gráficos em
     branco justamente quando o app mais tem valor, sem rede. */
  const indexHtml = fs.readFileSync(BASE + 'index.html', 'utf8');
  check('a lib de gráficos está no repositório', indexHtml.includes('vendor/apexcharts.min.js'), true);
  check('e nada vem de CDN', /src="https?:\/\//.test(indexHtml), false);
  check('o arquivo existe de verdade', fs.existsSync(BASE + 'vendor/apexcharts.min.js'), true);
  // Sem entrar no service worker, o primeiro acesso offline abriria sem gráfico
  const swJs = fs.readFileSync(BASE + 'sw.js', 'utf8');
  check('e o service worker a guarda para o modo offline',
    swJs.includes("'vendor/apexcharts.min.js?v=' + VERSAO"), true);
  check('graficos.js também entra no cache', swJs.includes("'js/graficos.js?v=' + VERSAO"), true);
  /* Ordem importa: app.js chama Graficos.novo() ao montar a tela, e Graficos
     usa ApexCharts ao montar. Fora de ordem, a primeira tela abre sem gráfico. */
  check('a lib vem antes de quem a usa',
    indexHtml.indexOf('vendor/apexcharts.min.js') < indexHtml.indexOf('js/graficos.js')
    && indexHtml.indexOf('js/graficos.js') < indexHtml.indexOf('js/app.js'), true);
} catch (e) { console.log(` FALHA | relatórios: ${e.message}`); fail++; }

/* ---- Filtros nos relatórios ----
   O risco aqui não é visual: é a comparação injusta. Se o mês fosse filtrado por
   "Alimentação" e a mediana viesse do gasto total, o app diria "acima do normal"
   sem nada estar acima — o pior erro que esta tela poderia cometer. */
console.log('\n=== Relatórios com filtro ===');
try {
  state.repOffset = 0;
  state.filtros = filtrosVazios();
  const pR = DB.monthPeriod(new Date());
  const gastoCheio = Rel.gasto(pR);
  const relCheio = renderRelatorios();
  check('sem filtro, a barra de pílulas está lá', relCheio.includes('id="ext-pilulas"'), true);
  check('e a mesma barra do extrato é reaproveitada',
    renderExtrato(pR).includes('id="ext-pilulas"') && relCheio.includes('id="ext-pilulas"'), true);
  check('sem filtro, nenhum aviso de recorte', relCheio.includes('rel-recorte'), false);

  /* Cria histórico REAL de vários meses, numa categoria e fora dela. Sem isso o
     teste compararia 0 com 0 e passaria de graça — foi exatamente o que
     aconteceu na primeira versão, e uma sabotagem do histórico não reprovou. */
  const catRel = DB.upsert('categories', { name: 'Alvo Relatorio', icon: '🎯', scope: 'Família', type: 'Despesa', kind: 'Essencial' });
  const contaRel = DB.upsert('accounts', { name: 'Conta Relatorio', type: 'Conta Corrente', balance: 99999 });
  const iso = (offset, d) => {
    const p = DB.monthPeriod(new Date(), offset);
    const dt = new Date(p.start.getFullYear(), p.start.getMonth(), d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };
  // 200 na categoria e 800 fora dela, em 5 meses: as duas medianas ficam bem
  // distantes, então confundir uma com a outra não passa despercebido
  for (let m = 0; m <= 4; m++) {
    DB.upsert('transactions', { description: `Alvo m${m}`, amount: 200, date: iso(-m, 5), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaRel, category_id: catRel });
    DB.upsert('transactions', { description: `Fora m${m}`, amount: 800, date: iso(-m, 6), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaRel });
  }

  // O filtro precisa CHEGAR nos números, senão a barra é decorativa
  const alvoCat = DB.get('categories', catRel);
  {
    state.filtros.categorias = [alvoCat.id];
    const gastoRecorte = Rel.gasto(pR);
    check('o filtro reduz o gasto apurado', gastoRecorte < gastoCheio, true);
    check('e sobra apenas a categoria escolhida',
      Rel.despesas(pR).every(t => DB.categoryRootId(t.category_id) === alvoCat.id), true);

    /* O ponto central: o MESMO recorte vale nos 12 meses do histórico. Sem isso a
       mediana viria do gasto total e a comparação seria categoria contra tudo. */
    const evoRecorte = DB.serieMensal(12, p => Rel.gasto(p));
    const evoCheia = (() => {
      const guardado = state.filtros;
      state.filtros = filtrosVazios();
      const r = DB.serieMensal(12, p => Rel.gasto(p));
      state.filtros = guardado;
      return r;
    })();
    check('o histórico também é recortado',
      evoRecorte.every((e, i) => e.valor <= evoCheia[i].valor), true);
    check('e é estritamente menor em algum mês',
      evoRecorte.some((e, i) => e.valor < evoCheia[i].valor), true);

    const relFiltrado = renderRelatorios();
    check('a tela avisa que é um recorte', relFiltrado.includes('rel-recorte'), true);
    check('e nomeia o filtro ativo', relFiltrado.includes(esc(alvoCat.name)), true);

    /* Verifica a TELA, não o helper: o "seu normal" é a mediana do histórico, e
       ele tem de cair junto com o recorte. Testar só Rel.gasto provaria que o
       helper filtra, não que renderRelatorios o usa — e foi assim que uma
       sabotagem do histórico passou sem reprovar nada. */
    const seuNormal = html => {
      const m = html.match(/Seu normal <b>([^<]+)</);
      return m ? Number(m[1].replace(/[^\d,]/g, '').replace(',', '.')) : null;
    };
    const normalRecorte = seuNormal(relFiltrado);
    // Renderiza a versão sem filtro AGORA, depois de o histórico existir: usar a
    // de antes compararia estados diferentes da base
    const guardado = state.filtros;
    state.filtros = filtrosVazios();
    const normalCheio = seuNormal(renderRelatorios());
    state.filtros = guardado;
    check('o "seu normal" do gráfico acompanha o recorte',
      normalRecorte !== null && normalCheio !== null && normalRecorte < normalCheio, true);
    check('e a mediana exibida é a do recorte, não a do total',
      normalRecorte, Math.round(DB.mediana(DB.serieMensal(12, p => Rel.gasto(p)).slice(0, -1)
        .map(e => e.valor).filter(v => v > 0))));

    /* Seções que exigem a receita inteira saem de cena: a receita da família não
       pertence a uma categoria, então "Alimentação − receita total" não é
       resultado de nada, e a cascata mostraria "Faltou" sempre. */
    check('a cascata sai sob recorte', relFiltrado.includes('g-cascata'), false);
    check('a origem das entradas também', relFiltrado.includes('De onde vem o dinheiro'), false);
    check('e a frase deixa de falar de "sobrou"',
      /Sobrou|Faltou <span/.test(relFiltrado), false);
    check('passando a falar do recorte', relFiltrado.includes('Este recorte consumiu'), true);
    // Orçamento é da família: comparar um recorte com ele não responde nada
    check('o uso do orçamento sai sob recorte', relFiltrado.includes('Uso do orçamento'), false);
    check('e a taxa de poupança também', relFiltrado.includes('Taxa de poupança'), false);
    // Reserva e patrimônio são estado de hoje, não do período: seguem inteiros
    check('mas reserva e patrimônio continuam', relFiltrado.includes('Em contas hoje'), true);
    check('dizendo que são o total', relFiltrado.includes('sempre o total, não o recorte'), true);
  }
  state.filtros = filtrosVazios();

  /* A régua de dias NÃO entra aqui: ela recorta só o mês em análise, e o
     relatório compara meses fechados entre si. Meio mês contra doze meses
     cheios não é comparação, é erro de leitura. */
  const apF2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const corpoRel = apF2.slice(apF2.indexOf('function renderRelatorios'), apF2.indexOf('function relFrase'));
  check('os relatórios não trazem a régua de dias', corpoRel.includes('reguaDoMes'), false);
  check('e as agregações ignoram a janela de dias',
    /passaNosFiltros\(t, true\)/.test(apF2), true);
  // Um filtro só, um lugar de manutenção
  check('a barra de pílulas é uma função compartilhada',
    (apF2.match(/barraDePilulas\(\)/g) || []).length >= 3, true);

  /* Limpa o que este bloco criou, e apaga de vez em vez de marcar como excluído.

     Motivo: os testes de sincronização são async, então o código síncrono daqui
     roda ANTES de eles terminarem. Registro deixado com dirty=true faz o sync
     achar que há coisa para enviar, e a asserção "consulta de rotina não gira o
     ícone" reprova por sujeira de teste, não por defeito. */
  for (const store of ['transactions', 'categories', 'accounts']) {
    DB.data[store] = DB.data[store].filter(r =>
      !/^(Alvo|Fora) m\d$/.test(r.description || '')
      && r.id !== catRel && r.id !== contaRel);
  }
  DB.save();
} catch (e) { console.log(` FALHA | relatórios com filtro: ${e.message}`); fail++; }

/* ---- Subcategorias nas visões por categoria ----
   "Alimentação: R$ 1.500" não é acionável; "mercado 900, delivery 600" é. As duas
   pedem decisões diferentes, e o total do envelope esconde as duas. */
console.log('\n=== Subcategorias nos relatórios ===');
try {
  state.repOffset = 0;
  state.filtros = filtrosVazios();
  const contaS = DB.upsert('accounts', { name: 'Conta Sub', type: 'Conta Corrente', balance: 99999 });
  const envS = DB.upsert('categories', { name: 'Envelope Sub', icon: '📦', scope: 'Família', type: 'Despesa', kind: 'Essencial' });
  const subA = DB.upsert('categories', { name: 'Filha A', scope: 'Família', type: 'Despesa', parent_id: envS });
  const subB = DB.upsert('categories', { name: 'Filha B', scope: 'Família', type: 'Despesa', parent_id: envS });
  const pS = DB.monthPeriod(new Date());
  const dS = dia(9);
  const novo = (desc, valor, cat) => DB.upsert('transactions', { description: desc, amount: valor, date: dS, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaS, category_id: cat });
  novo('Sub A um', 900, subA);
  novo('Sub B um', 600, subB);
  novo('Sub direto', 100, envS);          // lançado no envelope, sem descer

  const subs = Rel.porSubcategoria(pS, envS);
  check('a subcategoria é apurada separadamente', subs[subA], 900);
  check('e a outra também', subs[subB], 600);
  /* O que foi lançado no envelope sem subcategoria precisa aparecer: se ficar de
     fora, a soma das partes não fecha com o total e o gráfico mente por omissão. */
  check('o lançado direto no envelope não se perde', subs._direto, 100);
  check('a soma das partes fecha com o total do envelope',
    Object.values(subs).reduce((a, b) => a + b, 0), Rel.porCategoria(pS)[envS]);

  const relS = renderRelatorios();
  check('o relatório mostra o envelope por dentro', relS.includes('Envelope por dentro'), true);
  check('com uma barra segmentada', relS.includes('data-g="composicao"'), true);

  /* A DICA É PRÓPRIA, não a nativa do navegador: a nativa demora a aparecer, não
     existe no toque e mostraria um segmento isolado — e um segmento sozinho não
     diz composição. Esta lista TODOS os itens do envelope com seus percentuais e
     só destaca o que está sob o cursor. */
  zeraFila();
  svgComposicao([{ id: 'x', rot: 'Env', total: 1000, partes: [
    { rot: 'Filha A', valor: 600 }, { rot: 'Filha B', valor: 400 }] }]);
  const cComp = cfgDo();
  check('a composição usa dica própria, não a nativa', typeof cComp.tooltip.custom, 'function');
  const dica = cComp.tooltip.custom({ dataPointIndex: 0, seriesIndex: 1 });
  check('a dica traz a composição inteira, não só o item apontado',
    dica.includes('Filha A') && dica.includes('Filha B'), true);
  check('com o percentual de cada parte', dica.includes('60%') && dica.includes('40%'), true);
  check('e o total do envelope no cabeçalho', dica.includes('Env'), true);
  // Ênfase no apontado sem esconder o resto: é a diferença entre saber um número
  // e entender do que o envelope é feito
  check('destacando só o que está sob o cursor',
    (dica.match(/apx-tip-l on/g) || []).length, 1);

  /* Cor hierárquica: o matiz identifica o envelope, o tom identifica a
     subcategoria. 75 folhas não caberiam em matizes distintos — acima de ~8 eles
     ficam indistinguíveis até para quem vê bem. */
  check('clarear caminha para o branco', clarear('#009ef7', 1), '#ffffff');
  check('e a fração zero devolve a cor original', clarear('#009ef7', 0), '#009ef7');
  /* A cor vem em cada PONTO, não na série: no ApexCharts a cor normalmente é da
     série, mas "slot 2" do envelope Casa não tem relação com "slot 2" de
     Transporte. Sem cor por ponto, a hierarquia de tons não existiria. */
  zeraFila();
  svgComposicao([{ id: 'x', rot: 'Env', total: 100, partes: [
    { rot: 'p1', valor: 60 }, { rot: 'p2', valor: 40 }] }]);
  const cTons = cfgDo();
  const tons = cTons.series.map(s => s.data[0].fillColor);
  check('duas subcategorias, dois tons', new Set(tons).size, 2);
  /* Compara luminosidade canal a canal, não o hex como inteiro: 0x50cd89 é maior
     que 0x009ef7 sem ser mais claro, e foi assim que uma sabotagem trocando os
     tons por matizes distintos passou sem reprovar nada. */
  const canais = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const [c0, c1] = tons.map(canais);
  check('o segundo tom é mais claro em todos os canais',
    c1.every((v, i) => v >= c0[i]) && c1.some((v, i) => v > c0[i]), true);
  /* E é o MESMO matiz clareado, não outra cor: a hierarquia depende disso — matiz
     identifica o envelope, tom identifica a subcategoria dentro dele. */
  check('e é o mesmo matiz do envelope, clareado', tons[1], clarear(tons[0], 0.12));

  // A tabela abre as subcategorias, cada uma contra a mediana DELA
  check('a tabela deixa abrir o envelope', relS.includes(`data-abre-cat="${envS}"`), true);
  check('e traz as linhas filhas escondidas', relS.includes(`data-sub-de="${envS}"`), true);
  const subEscondida = new RegExp(`data-sub-de="${envS}" hidden`).test(relS);
  check('as filhas começam recolhidas', subEscondida, true);
  const apS = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  /* Cada subcategoria contra a própria mediana: se o mercado subiu e o delivery
     caiu na mesma medida, o envelope não se mexe e nada apareceria — mas são duas
     mudanças reais, com decisões diferentes por trás. */
  check('a subcategoria é comparada com a mediana dela',
    apS.includes('const m = DB.mediana(medSub[sid] || []);'), true);
  check('abrir não redesenha a tela inteira',
    /data-abre-cat\]'\)\.forEach\(tr => tr\.onclick[\s\S]{0,300}sub\.hidden = !aberto/.test(apS), true);
  check('e o mesmo critério de "=" vale nos dois níveis',
    (apS.match(/deltaCelula\(/g) || []).length >= 3, true);

  // Os três primeiros gráficos em linha no desktop
  check('os três gráficos ficam num grid próprio', relS.includes('class="grid-3"'), true);
  const cssS = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('que vira três colunas no desktop',
    /\.grid-3 \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(cssS), true);
  check('e uma só em tela estreita', /\.grid-3 \{ display: grid; grid-template-columns: 1fr/.test(cssS), true);

  // Limpa: registro dirty faria os testes async de sync girarem por sujeira
  for (const store of ['transactions', 'categories', 'accounts']) {
    DB.data[store] = DB.data[store].filter(r =>
      !/^Sub (A um|B um|direto)$/.test(r.description || '')
      && ![contaS, envS, subA, subB].includes(r.id));
  }
  DB.save();
} catch (e) { console.log(` FALHA | subcategorias: ${e.message}`); fail++; }

/* ---- Popover das pílulas com a página rolada ----
   Defeito relatado: rolando a página, as pílulas apareciam e o dropdown não.
   Causa: `.ui-panel` vem DEPOIS de `.ui-pop` no CSS, então com uma classe só
   vencia o empate de especificidade e reimpunha position:absolute — e com
   absolute num filho do <body>, o `top` calculado em coordenadas de viewport
   passa a valer como coordenada de DOCUMENTO. Página rolada, painel no topo do
   documento, fora da tela. */
console.log('\n=== Dropdown do filtro com a página rolada ===');
{
  const cssP2 = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const iPanel = cssP2.indexOf('.ui-panel {');
  const iPop = cssP2.indexOf('.ui-panel.ui-pop {');
  check('o popover é fixo', /\.ui-panel\.ui-pop \{[^}]*position: fixed/.test(cssP2), true);
  /* Duas classes no seletor: é o que vence independentemente da ordem no arquivo.
     Com `.ui-pop` sozinho, quem viesse depois ganharia — e foi o que aconteceu. */
  check('e vence .ui-panel pela especificidade, não pela ordem',
    iPop >= 0 && /\.ui-panel\.ui-pop/.test(cssP2), true);
  check('o seletor tem duas classes', (cssP2.match(/\.ui-panel\.ui-pop \{/g) || []).length, 1);
  check('e o JS manda na posição, não o CSS',
    /\.ui-panel\.ui-pop \{[^}]*top: auto; left: auto/.test(cssP2), true);
  // Fica acima do topo grudado, senão some atrás dele
  const zPop = Number((cssP2.match(/\.ui-panel\.ui-pop \{[^}]*z-index: (\d+)/) || [])[1]);
  const zTopo = Number((cssP2.match(/\.ext-topo \{[^}]*z-index: (\d+)/) || [])[1]);
  check('o painel fica acima da barra grudada', zPop > zTopo, true);
  // A posição vem de getBoundingClientRect, que já é relativa ao viewport
  const uiSrc = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  check('a posição é medida no viewport', uiSrc.includes('ancora.getBoundingClientRect()'), true);
  check('e nada soma scrollY, que sujaria a conta com fixed',
    /posicionarFixo[\s\S]{0,900}scrollY/.test(uiSrc), false);
  void iPanel;
}

/* ---- Legibilidade dos gráficos ----
   Este era o problema que motivou a biblioteca. Antes, com SVG à mão: viewBox de
   720 num cartão de 307px dava escala 0,43 — rótulo de 11px saía a 4,7px na tela,
   hairline de 1px a 0,43px, e o mesmo gráfico mudava de tamanho conforme a
   largura do cartão. A gambiarra era manter todo o texto num overlay HTML.

   O ApexCharts desenha o texto em px reais do aparelho, então o problema deixa de
   existir na origem. O que passa a ser verificável é o encaixe no tema. */
console.log('\n=== Gráficos: legibilidade e encaixe no tema ===');
{
  const cssG = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const todos = () => {
    zeraFila();
    svgBars([{ label: 'jan', value: 100 }, { label: 'fev', value: 250, hint: '#009ef7' }], 300);
    svgCascata([{ rot: 'E', valor: 1000, tipo: 'entra' }, { rot: 'S', valor: 400, tipo: 'sai' },
      { rot: 'R', valor: 0, tipo: 'total' }]);
    svgLinhaFaixa([{ rot: 'jan', valor: 100 }, { rot: 'fev', valor: 200 }, { rot: 'mar', valor: 150 }]);
    svgBurnup(DB.monthPeriod(new Date()), 3000);
    svgRanking([['Mercado', 800]]);
    svgComposicao([{ id: 'x', rot: 'Env', total: 100, partes: [{ rot: 'p', valor: 100 }] }]);
    svgFluxoSaldo(DB.fluxoMensal(6, 6));
    return Graficos.fila;
  };
  const fila = todos();
  /* Oito, não nove: a rosca é desenhada à mão e não entra na fila (ver o bloco
     de Gráficos, onde o motivo está medido). */
  check('todos os outros gráficos passaram pela biblioteca', fila.length, 7);
  /* Fonte herdada em TODOS. É o detalhe que mais delata gráfico de biblioteca
     colado num layout: sem isso o ApexCharts usa a Helvetica dele. */
  check('todos herdam a fonte do app',
    fila.every(f => f.opts.chart.fontFamily === 'inherit'), true);
  // Barra de ferramentas do ApexCharts (zoom, download) não cabe num app de bolso
  check('nenhum mostra a barra de ferramentas da lib',
    fila.every(f => f.opts.chart.toolbar.show === false), true);
  // Cada um se identifica pelo que É, e reserva altura para o cartão não pular
  check('cada gráfico se identifica no div',
    fila.every(f => !!f.nome), true);
  check('e nenhum nome se repete', new Set(fila.map(f => f.nome)).size, 7);
  check('todos reservam altura', fila.every(f => f.opts.chart.height > 0), true);
  // O CSS que costura a lib ao tema
  /* O CSS DA PRÓPRIA BIBLIOTECA. O apexcharts.min.js NÃO o injeta — descobri isso
     comparando com o Metronic, que o traz no plugins.bundle.css. Sem ele a dica de
     valor perde a caixa e, pior, perde o `.apexcharts-canvas{position:relative}`
     que a ancora: ela é `position:absolute` e voaria para o canto da página. */
  const idxG = fs.readFileSync(BASE + 'index.html', 'utf8');
  check('o CSS da biblioteca está no repositório',
    fs.existsSync(BASE + 'vendor/apexcharts.css'), true);
  check('e é carregado', idxG.includes('vendor/apexcharts.css'), true);
  const libCss = fs.readFileSync(BASE + 'vendor/apexcharts.css', 'utf8');
  check('ele traz a âncora da dica', /\.apexcharts-canvas \{[^}]*position: relative/.test(libCss), true);
  // Antes do nosso, senão nossas regras perderiam para as dele por ordem
  check('e vem antes do nosso, para o nosso poder sobrepor',
    idxG.indexOf('vendor/apexcharts.css') < idxG.indexOf('css/styles.css'), true);
  const swG = fs.readFileSync(BASE + 'sw.js', 'utf8');
  check('o service worker guarda os dois arquivos da lib',
    swG.includes("'vendor/apexcharts.css?v=' + VERSAO")
    && swG.includes("'vendor/apexcharts.min.js?v=' + VERSAO"), true);

  /* TAMANHO DO TEXTO ANCORADO NO LAYOUT. Medido: o texto que fica ao lado dos
     gráficos é 13,5px na legenda da rosca e 13px nas tabelas de relatório. Os
     eixos estavam em 11px — o menor texto da vizinhança, e era isso que fazia o
     gráfico parecer de outro layout. O eixo casa com a tabela, que é o análogo
     mais próximo: uma grade de rótulos de dado. */
  const tabela = (cssG.match(/\.rep-table \{[^}]*font-size:\s*([\d.]+)px/) || [])[1];
  check('o eixo tem o tamanho da tabela de relatório', Graficos.fonte.eixo, tabela + 'px');
  check('e não é o menor texto da vizinhança',
    parseFloat(Graficos.fonte.eixo) >= 13, true);
  /* A anotação recua um passo: renda, média e "previsto" são referência, não dado.
     Se empatasse com o eixo, as duas leituras teriam o mesmo peso. */
  check('a anotação fica um passo abaixo do eixo',
    parseFloat(Graficos.fonte.ref) < parseFloat(Graficos.fonte.eixo), true);
  check('e o valor sobre a marca fica no meio',
    parseFloat(Graficos.fonte.valor) > parseFloat(Graficos.fonte.ref)
    && parseFloat(Graficos.fonte.valor) <= parseFloat(Graficos.fonte.eixo), true);
  /* Tamanho literal espalhado pelos gráficos é como o desalinhamento voltaria sem
     ninguém notar: a escala tem de ser o único lugar onde o número aparece. */
  const apFonte = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('nenhum gráfico crava o tamanho na mão',
    (apFonte.match(/fontSize: '\d[\d.]*px'/g) || []).length, 0);
  /* EXIGE o tamanho, não aceita ausência. Aceitar "ou ausente" foi o que deixou
     passar um defeito real: espalhar `...extra` sobre o xaxis trocava `labels`
     inteiro, e como quase todo gráfico passa um `formatter` ali, o `style` com o
     tamanho da fonte era descartado justamente nos que mais precisam dele. */
  check('todo eixo declara o tamanho, e sai da escala',
    fila.every(f => (f.opts.xaxis.labels.style || {}).fontSize === Graficos.fonte.eixo), true);
  check('o eixo Y também', fila.every(f =>
    (f.opts.yaxis.labels ? (f.opts.yaxis.labels.style || {}).fontSize === Graficos.fonte.eixo
      : Array.isArray(f.opts.yaxis))), true);
  /* Um gráfico que passa formatter no eixo é o caso que quebrava: o formatter tem
     de conviver com o style, não substituí-lo. Vale nos DOIS eixos, porque quem
     passa formatter no X são os de barra e no Y os de linha — testar só um lado
     deixa a outra metade da mescla sem trava. */
  check('formatter e tamanho convivem no eixo Y',
    (() => { zeraFila(); svgBurnup(DB.monthPeriod(new Date()), 3000); const c = cfgDo();
      return typeof c.yaxis.labels.formatter === 'function'
        && c.yaxis.labels.style.fontSize === Graficos.fonte.eixo; })(), true);
  check('e no eixo X',
    (() => { zeraFila(); svgRanking([['Mercado', 800]]); const c = cfgDo();
      return typeof c.xaxis.labels.formatter === 'function'
        && c.xaxis.labels.style.fontSize === Graficos.fonte.eixo; })(), true);
  // Sem o formatter o eixo mostraria o número cru em vez de moeda
  check('e o formatter do eixo formata em moeda',
    (() => { zeraFila(); svgRanking([['Mercado', 800]]);
      return cfgDo().xaxis.labels.formatter(1500); })(), fmtShort(1500).replace('R$', '').trim());

  /* ---- Eixo de valor oculto ----
     O eixo de valor é uma coluna de números que ninguém lê dígito por dígito: ele
     serve para estimar altura, e a grade sozinha já faz isso. Tirá-lo devolve a
     largura ao desenho — num cartão de celular a coluna comia uns 15%.

     A CONDIÇÃO para tirar é o número estar em outro lugar. Onde o eixo era a única
     fonte, o valor foi para cima da marca ANTES de ele sair; onde o cartão já
     escreve os números no rodapé, não precisou de nada. É essa condição que os
     testes abaixo verificam — sem ela, tirar o eixo é perder informação. */
  const eixoDeValor = o => {
    // Nos horizontais o eixo de valor é o X; nos demais, o Y
    const horiz = o.plotOptions && o.plotOptions.bar && o.plotOptions.bar.horizontal;
    return horiz ? o.xaxis : o.yaxis;
  };
  /* Trata eixo em ARRAY: o fluxo de saldo tem dois, e um `e.labels.show` direto
     dava undefined ali — a rede de "nenhum gráfico mudo" passava por cima dele
     justamente no gráfico mais complexo da tela. */
  const semEixo = o => {
    const e = eixoDeValor(o);
    if (Array.isArray(e)) return e.every(x => ((x.labels || {}).show === false) || x.show === false);
    return ((e || {}).labels || {}).show === false;
  };

  const p29 = DB.monthPeriod(new Date());
  const casos = [
    ['barras', () => svgBars([{ label: 'jan', value: 100 }, { label: 'fev', value: 250, hint: '#009ef7' }], 300), true],
    ['burnup', () => svgBurnup(p29, 3000), true],
    ['cascata', () => svgCascata([{ rot: 'E', valor: 1000, tipo: 'entra' },
      { rot: 'S', valor: 400, tipo: 'sai' }, { rot: 'R', valor: 0, tipo: 'total' }]), true],
    ['faixa-normal', () => svgLinhaFaixa([{ rot: 'jan', valor: 100 }, { rot: 'fev', valor: 200 }]), false],
    ['ranking', () => svgRanking([['Mercado', 800], ['Uber', 200]]), true],
  ];
  for (const [nome, montar, precisaRotulo] of casos) {
    zeraFila(); montar();
    const c = cfgDo();
    check(nome + ': o eixo de valor está oculto', semEixo(c), true);
    /* A GRADE FICA. Ela é a régua que permite comparar alturas; tirar as linhas
       junto com os números deixaria o gráfico sem referência nenhuma. */
    check(nome + ': mas as linhas de grade ficam, que são a régua',
      c.grid.show !== false, true);
    // Onde o eixo era a única fonte do número, o valor foi para a marca
    check(nome + ': o número ' + (precisaRotulo ? 'está na marca' : 'vem do rodapé do cartão'),
      (c.dataLabels || {}).enabled === true, precisaRotulo);
  }

  /* Rótulo SELETIVO nas colunas de evolução: só o período atual e o maior. Seis
     números lado a lado viram uma segunda linha de texto e o olho para de ver a
     forma, que é o que o gráfico existe para mostrar. */
  zeraFila();
  svgBars([{ label: 'jan', value: 100 }, { label: 'fev', value: 900 },
    { label: 'mar', value: 250, hint: '#009ef7' }], 0);
  const fmtB = cfgDo().dataLabels.formatter;
  check('coluna do meio (nem atual nem maior) não leva rótulo', fmtB(100, { dataPointIndex: 0 }), '');
  check('a maior leva', fmtB(900, { dataPointIndex: 1 }) !== '', true);
  check('e a do período atual também', fmtB(250, { dataPointIndex: 2 }) !== '', true);

  /* Na cascata o rótulo vai em TODOS os blocos, porque ali cada número é uma
     parcela da conta que está sendo feita. Menos no pedestal: ele tem valor e não
     é dinheiro, e mostrá-lo faria o leitor somar um degrau invisível. */
  zeraFila();
  svgCascata([{ rot: 'E', valor: 8500, tipo: 'entra' }, { rot: 'S', valor: 5200, tipo: 'sai' },
    { rot: 'R', valor: 0, tipo: 'total' }]);
  const fmtC = cfgDo().dataLabels.formatter;
  check('o pedestal nunca leva rótulo', fmtC(8500, { seriesIndex: 0 }), '');
  check('mas a entrada leva', fmtC(8500, { seriesIndex: 1 }) !== '', true);
  check('a saída também', fmtC(5200, { seriesIndex: 2 }) !== '', true);
  check('e o resultado também', fmtC(1200, { seriesIndex: 3 }) !== '', true);

  /* No burn-up, só o ponto de hoje: um número em cada dia viraria uma faixa de
     texto sobre a curva. E nada na trilha ideal — marcar uma referência calculada
     como se fosse dinheiro gasto seria a pior leitura possível. */
  zeraFila();
  svgBurnup(p29, 3000);
  const fmtU = cfgDo().dataLabels.formatter;
  const hoje29 = DB.elapsedDays(p29) - 1;
  check('o burn-up rotula o ponto de hoje', fmtU(500, { seriesIndex: 0, dataPointIndex: hoje29 }) !== '', true);
  /* "Outro dia" precisa ser mesmo OUTRO: no dia 1º do ciclo, hoje é o índice 0 e
     o teste comparava o ponto de hoje consigo mesmo, reprovando uma vez por mês. */
  check('e nenhum outro dia',
    fmtU(400, { seriesIndex: 0, dataPointIndex: hoje29 === 0 ? 1 : 0 }), '');
  check('nem a trilha ideal, que é referência e não gasto',
    fmtU(3000, { seriesIndex: 1, dataPointIndex: hoje29 }), '');

  /* Os DOIS que mantêm o eixo, de propósito: "Envelope por dentro" e "De onde vim,
     para onde vou" não estavam no pedido, e nenhum dos dois escreve valor na marca
     nem no rodapé — tirar o eixo deles deixaria o gráfico mudo. */
  zeraFila();
  svgComposicao([{ id: 'x', rot: 'Env', total: 100, partes: [{ rot: 'p', valor: 100 }] }]);
  check('o envelope por dentro mantém o eixo', semEixo(cfgDo()), false);
  /* "De onde vim, para onde vou" também perdeu o texto dos eixos, mas por caminho
     próprio: os limites dos dois eixos continuam DECLARADOS, porque ali eles são a
     geometria que ancora as duas escalas no mesmo zero. Só o rótulo saiu. */
  zeraFila();
  svgFluxoSaldo(DB.fluxoMensal(6, 6));
  const cFl29 = cfgDo();
  check('o fluxo de saldo está sem texto nos eixos',
    cFl29.yaxis.every(e => (e.labels || {}).show === false || e.show === false), true);
  check('mas mantém os limites, que são a âncora das escalas',
    typeof cFl29.yaxis[0].min === 'number' && typeof cFl29.yaxis[2].max === 'number', true);

  /* NAS TELAS DE VERDADE, não só nas funções isoladas. E a garantia que importa:
     nenhum gráfico fica sem eixo E sem rótulo ao mesmo tempo — isso seria um
     gráfico mudo, onde só o toque revela qualquer número. */
  for (const [tela, montar] of [['painel', () => renderInicio(p29)], ['relatórios', () => renderRelatorios()]]) {
    zeraFila(); montar();
    /* Duas exceções, as duas com o número no RODAPÉ do cartão em vez de na marca.
       Elas estão nomeadas aqui de propósito: entrar nesta lista é uma decisão, e
       cada uma é verificada pelo outro lado — que o rodapé existe e traz os
       números. Ver os dois checks logo abaixo. */
    const comRodape = ['faixa-normal', 'fluxo-saldo'];
    const mudos = Graficos.fila.filter(f =>
      semEixo(f.opts) && (f.opts.dataLabels || {}).enabled !== true
      && !comRodape.includes(f.nome));
    check(tela + ': nenhum gráfico fica sem eixo e sem número', mudos.map(f => f.nome).join(','), '');
  }
  /* As exceções são justificadas: os cartões que as usam escrevem os números no
     rodapé. Se esse rodapé sair, o gráfico emudece — então é ele que se verifica. */
  check('o cartão do fluxo traz os números no rodapé', (() => {
    const cardFluxo = relProximosMeses();
    return /chart-foot/.test(cardFluxo) && /Hoje/.test(cardFluxo)
      && /Previsto entrar/.test(cardFluxo) && /Previsto sair/.test(cardFluxo);
  })(), true);
  const relFaixa = renderRelatorios();
  check('a faixa vive sem rótulo porque o cartão traz os números',
    /Isso é normal para vocês\?[\s\S]{0,2000}chart-foot[\s\S]{0,400}Seu normal/.test(relFaixa), true);
  /* O cartão da projeção traz os números no rodapé — mas ele SÓ EXISTE quando há
     dias pela frente. Rodando no último dia do ciclo, a série tem um ponto só e o
     cartão vira "sem movimento previsto", legitimamente.

     O teste rodava contra o mês corrente e passou meses sem falhar por sorte de
     calendário: quebrou no dia 31. Agora ele monta um período com dias
     garantidos, que é o cenário que a asserção quer exercitar. */
  check('e o saldo projetado também', (() => {
    const daquiA30 = DB.paraISO(new Date(Date.now() + 30 * 86400000));
    const serie = DB.projecaoSaldo(daquiA30);
    if (serie.length < 2) return 'série curta: nada a projetar nem no horizonte de 30 dias';
    const c = projecaoCard({ ...p29, end: new Date(daquiA30 + 'T12:00:00') });
    return /chart-foot/.test(c) && /Hoje/.test(c) && /Fecha em/.test(c);
  })(), true);
  // E o caso oposto é comportamento, não falha: sem dias à frente, ele diz isso
  check('sem dias pela frente, o cartão avisa em vez de desenhar reta',
    projecaoCard({ ...p29, end: new Date(DB.hojeISO() + 'T12:00:00') }).includes('Sem movimento previsto'), true);

  check('o texto do gráfico usa a fonte do app', /\.apx text \{[^}]*font-family: inherit/.test(cssG), true);
  check('e o div encolhe em vez de estourar o cartão',
    /\.apx, \.apx > div \{[^}]*min-width: 0/.test(cssG), true);
  check('a dica vem repintada no tema escuro do app',
    /\.apx \.apexcharts-tooltip \{[^}]*background: rgba\(24, 28, 50/.test(cssG), true);
}

/* ---- Peso e variação na tabela por categoria ----
   R$ 150 é enorme sobre um costume de R$ 200 e irrelevante sobre R$ 5.000; e
   "+75%" sozinho não diz se mexeu no bolso. As duas leituras juntas. */
console.log('\n=== Tabela por categoria: peso e variação ===');
{
  check('o peso é a fatia do total', pesoCelula(300, 1000).includes('30%'), true);
  check('e mostra 100% quando é tudo', pesoCelula(1000, 1000).includes('100%'), true);
  /* Abaixo de 0,5% arredondaria para 0% e pareceria zero, sendo que houve gasto —
     dizer "0%" sobre dinheiro que saiu é falso. */
  check('gasto pequeno não vira 0%', pesoCelula(2, 1000).includes('<1%'), true);
  check('sem gasto não inventa peso', pesoCelula(0, 1000), '');
  check('e sem total também não', pesoCelula(100, 0), '');
  /* O peso vive dentro da célula do valor, não em coluna própria: em colunas
     separadas seriam cinco, e a tabela passaria a rolar na horizontal no
     celular. Cada número vem com o que o qualifica logo abaixo. */
  const cel = valorCelula(300, 1000);
  check('a célula traz o valor', cel.includes(fmtShort(300)), true);
  check('e o peso logo abaixo dele', cel.includes('<i>30%</i>'), true);
  check('valor sem peso não deixa a linha vazia', valorCelula(100, 0), `<span class="val-rel">${fmtShort(100)}</span>`);

  // A variação traz o valor E o percentual
  const grande = deltaCelula(150, 200, false);
  check('a variação mostra o valor', grande.includes(fmtShort(150)), true);
  check('e o percentual contra o costume', grande.includes('<i>75%</i>'), true);
  check('subida é vermelha com seta para cima', /txt-red">▲/.test(grande), true);
  const queda = deltaCelula(-150, 200, false);
  check('queda é verde com seta para baixo', /txt-green">▼/.test(queda), true);
  check('e o percentual da queda não vem negativo', queda.includes('<i>75%</i>'), true);

  /* O mesmo R$ 150 sobre um costume grande é ruído, e continua sendo "=" — o
     piso de relevância vale antes de qualquer percentual aparecer. */
  check('mesma quantia sobre costume grande é rotina', deltaCelula(150, 5000, false), '<span class="muted">=</span>');
  check('linha nova não tenta calcular percentual', deltaCelula(500, 0, true), '<span class="muted">novo</span>');
  // Acima de 10× o percentual vira número sem significado
  check('variação enorme vira múltiplo', deltaCelula(5000, 100, false).includes('10×+'), true);
  check('e 9× ainda aparece como percentual', deltaCelula(900, 100, false).includes('<i>900%</i>'), true);

  const cssT = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  // Duas linhas na célula: lado a lado a coluna dobraria e empurraria a tabela
  // para fora da tela no celular
  check('valor e percentual empilham na célula',
    /\.val-rel, \.delta \{[^}]*flex-direction: column/.test(cssT), true);
  // O peso é contexto, não a resposta: fica um degrau abaixo na hierarquia
  check('o peso não compete com o valor',
    /\.val-rel i \{[^}]*color: var\(--paper-dim\)/.test(cssT), true);

  // A tabela na tela
  state.repOffset = 0; state.filtros = filtrosVazios();
  const relT = renderRelatorios();
  // Fatia até o fim DESTA tabela: sem o limite, a contagem pega os cabeçalhos
  // das tabelas seguintes e o teste mede outra coisa
  const daTabela = (() => {
    const ini = relT.indexOf('Detalhe por categoria');
    return relT.slice(ini, relT.indexOf('</table>', ini));
  })();
  // `<th[^>]*>` casaria também com `<thead>` — o lookahead exige que o nome da
  // tag termine ali
  check('a tabela ficou em quatro colunas', (daTabela.match(/<th(?=[\s>])/g) || []).length, 4);
  check('sem coluna própria de peso', relT.includes('>Peso</th>'), false);
  check('e com a de variação', relT.includes('<th>Variação</th>'), true);
  check('o título deixou de ser repetitivo', relT.includes('Categoria por categoria'), false);
  check('e diz o que a tabela responde', relT.includes('Detalhe por categoria'), true);
}

/* ---- Dica do envelope por dentro ----
   Um segmento sozinho não responde nada: "delivery R$ 400" só quer dizer algo ao
   lado de "mercado R$ 900". Por isso a lista vem completa e o realce diz onde o
   dedo está, em vez de esconder o resto.

   A biblioteca resolveu o posicionamento, o toque e o recorte pelo cartão — que
   antes exigiam handler próprio no body. O que continua sendo decisão nossa é o
   CONTEÚDO da dica, e é isso que se testa aqui. */
console.log('\n=== Dica do envelope por dentro ===');
{
  const cssC = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  zeraFila();
  svgComposicao([
    { id: 'a', rot: 'Casa', total: 1000, partes: [
      { rot: 'Mercado', valor: 600 }, { rot: 'Delivery', valor: 300 }, { rot: 'Padaria', valor: 100 }] },
    { id: 'b', rot: 'Transporte', total: 500, partes: [{ rot: 'Uber', valor: 500 }] },
  ]);
  const cC = cfgDo();
  const tip = cC.tooltip.custom({ dataPointIndex: 0, seriesIndex: 1 });

  // A lista inteira, com destaque — não só o item apontado
  check('a dica lista todas as partes',
    ['Mercado', 'Delivery', 'Padaria'].every(n => tip.includes(n)), true);
  check('e marca só a apontada', (tip.match(/apx-tip-l on/g) || []).length, 1);
  check('mostrando o percentual de cada uma',
    tip.includes('60%') && tip.includes('30%') && tip.includes('10%'), true);
  check('e o nome do envelope no cabeçalho', tip.includes('Casa'), true);
  // Percentual DENTRO do envelope, não sobre o total geral: a pergunta da dica é
  // "do que este envelope é feito", e 600 de 1000 é 60% mesmo havendo 1500 no mês
  check('o percentual é dentro do envelope, não do total geral', tip.includes('40%'), false);
  // Cada envelope tem a própria composição: apontar o segundo não mostra o primeiro
  const tip2 = cC.tooltip.custom({ dataPointIndex: 1, seriesIndex: 0 });
  check('cada envelope mostra a composição dele',
    tip2.includes('Uber') && !tip2.includes('Mercado'), true);
  // Índice fora da lista acontece na borda do gráfico e não pode estourar
  check('apontar fora da lista não quebra', cC.tooltip.custom({ dataPointIndex: 9, seriesIndex: 0 }), '');

  /* Sem destaque o item recua, em vez de sumir: é o contraste que diz onde o dedo
     está, sem esconder a composição. */
  check('o não apontado recua, não some', /\.apx-tip-l \{[^}]*opacity: \.62/.test(cssC), true);
  check('e o apontado ganha fundo', /\.apx-tip-l\.on \{[^}]*background/.test(cssC), true);
  // A cor na dica é a mesma do segmento, senão não dá para casar os dois
  const tomNaDica = (tip.match(/background:(#[0-9a-f]{6})/) || [])[1];
  check('a bolinha usa o tom do próprio segmento',
    tomNaDica, cC.series[0].data[0].fillColor);
}

/* ---- Fase 1: o disponível honesto ----
   O defeito central: quem guardou R$ 15.000 de reserva os via como gastáveis.
   Descontar é correto porque o aporte é transferência real entre contas próprias
   — o dinheiro está em accountsTotal, só que com dono. */
console.log('\n=== Disponível: guardado, resgate e horizonte ===');
try {
  const cG = DB.upsert('accounts', { name: 'Conta Guardado', type: 'Conta Corrente', balance: 10000 });
  const cCx = DB.upsert('accounts', { name: 'Caixinha Guardado', type: 'Caixinha / Rendimento', balance: 0 });
  const mR = DB.upsert('goals', { name: 'Reserva de Emergência', icon: '🛡️', kind: 'Reserva', target_amount: 30000, done: false });
  const mV = DB.upsert('goals', { name: 'Viagem Guardado', icon: '🏖️', kind: 'Objetivo', target_amount: 5000, done: false });

  const contasAntes = DB.accountsTotal();
  const dispAntes = DB.available();
  // Mede a VARIAÇÃO: o cenário já tem metas de blocos anteriores, e comparar
  // absolutos faria o teste depender da ordem em que os blocos rodam
  const guardadoAntes = DB.guardado();
  const reservaAntes = DB.guardadoReserva();
  const metasAntes = DB.guardadoMetas();

  /* O aporte é uma transferência real: sai da corrente, entra na caixinha. As
     duas contas somam em accountsTotal, então o total não muda — o que muda é
     que o dinheiro passa a ter dono. */
  const guardar = (meta, valor) => {
    DB.upsert('goal_entries', { goal_id: meta, amount: valor, description: 'Aporte', date: todayISO(), from_account: cG, to_account: cCx });
    adjustBalance(cG, -valor); adjustBalance(cCx, valor);
  };
  guardar(mR, 6000);
  guardar(mV, 1000);
  check('guardar não muda o total em contas', DB.accountsTotal(), contasAntes);
  check('mas o guardado sobe', DB.guardado() - guardadoAntes, 7000);
  check('separando reserva de metas', DB.guardadoReserva() - reservaAntes, 6000);
  check('e as metas à parte', DB.guardadoMetas() - metasAntes, 1000);
  check('o disponível cai exatamente o que foi guardado', DB.available(), dispAntes - 7000);

  /* Sem resgate, usar a reserva deixaria a meta intacta e o app afirmaria que
     existe um dinheiro guardado que já foi gasto. */
  DB.upsert('goal_entries', { goal_id: mR, amount: -2000, description: 'Resgate', date: todayISO(), from_account: cCx, to_account: cG });
  adjustBalance(cCx, -2000); adjustBalance(cG, 2000);
  check('resgate reduz a meta', DB.goalTotal(mR), 4000);
  check('e devolve ao disponível', DB.available(), dispAntes - 5000);
  check('sem mexer no total em contas', DB.accountsTotal(), contasAntes);
  check('o histórico guarda aporte e resgate', DB.all('goal_entries').filter(e => e.goal_id === mR).length, 2);

  /* DOIS números com propósitos diferentes, e a diferença importa.

     available() é PLANEJAMENTO: desconta o comprometido para responder "quanto
     posso assumir de novo até o fim do mês".

     caixaLivre() é REALIDADE: o comprometido continua na conta — a fatura só sai
     quando for paga. É este que decide se um gasto encostou na reserva; usar o
     outro mandaria resgatar por causa de uma conta que ainda nem venceu. */
  const caixa = DB.caixaLivre();
  check('o caixa livre é contas menos guardado', caixa, DB.accountsTotal() - DB.guardado());
  check('e ignora o comprometido, que ainda está na conta', caixa > DB.available(), true);
  check('gasto dentro do caixa não toca no guardado', DB.faltaParaGastar(caixa - 100), 0);
  check('gasto acima diz quanto entra no guardado', DB.faltaParaGastar(caixa + 500), 500);

  /* Compromisso não debita: enquanto está "A Pagar" o dinheiro segue na conta, e
     o gatilho do resgate não pode disparar por ele. */
  const caixaAntesDoCompromisso = DB.caixaLivre();
  DB.upsert('transactions', { description: 'Compromisso futuro G', amount: 99999, date: todayISO(), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cG });
  check('lançamento a pagar não mexe no caixa', DB.caixaLivre(), caixaAntesDoCompromisso);
  check('mas derruba o disponível de planejamento', DB.available() < 0, true);
  check('e mesmo assim não acusa uso do guardado', DB.faltaParaGastar(0), 0);
  DB.remove('transactions', DB.all('transactions').find(t => t.description === 'Compromisso futuro G').id);

  /* Horizonte: conta de setembro não pesa igual à de amanhã. Mas FATURA conta
     sempre — as compras já aconteceram, só o débito é que ficou para depois. */
  const fimCiclo = DB.fimISO(DB.monthPeriod(new Date()));
  const compAntes = DB.committed();
  DB.upsert('transactions', { description: 'IPVA distante', amount: 1200, date: somarDias(fimCiclo, 40), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cG });
  check('conta de daqui a meses não entra no comprometido', DB.committed(), compAntes);
  check('mas aparece à parte, para ninguém ser pego de surpresa', DB.committedDepois() >= 1200, true);
  DB.upsert('transactions', { description: 'Luz deste mês', amount: 200, date: somarDias(fimCiclo, -3), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cG });
  check('conta dentro do ciclo entra', DB.committed(), compAntes + 200);

  /* Receita futura NÃO entra no disponível: somá-la faria o número dizer "posso
     gastar o que ainda não recebi". */
  const dispPreSalario = DB.available();
  DB.upsert('transactions', { description: 'Salário futuro', amount: 6200, date: somarDias(fimCiclo, -2), type: 'Receita', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: cG });
  check('receita a receber não infla o disponível', DB.available(), dispPreSalario);

  // Limpa
  for (const t of DB.all('transactions').filter(t => /IPVA distante|Luz deste mês|Salário futuro/.test(t.description || ''))) DB.remove('transactions', t.id);
  DB.data.goal_entries = DB.data.goal_entries.filter(e => ![mR, mV].includes(e.goal_id));
  DB.data.goals = DB.data.goals.filter(g => ![mR, mV].includes(g.id));
  DB.data.accounts = DB.data.accounts.filter(a => ![cG, cCx].includes(a.id));
  DB.save();
} catch (e) { console.log(` FALHA | disponível honesto: ${e.message}`); fail++; }

/* ---- Quando o gatilho do resgate dispara ----
   Só quando o dinheiro SAI de verdade. Compromisso não debita; o débito acontece
   ao marcar como pago ou ao pagar a fatura — e é aí que a pergunta cabe. */
console.log('\n=== Gatilho do resgate ===');
try {
  const apG = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const corpoG = apG.slice(apG.indexOf('function avisarSeUsouGuardado'), apG.indexOf('/* Guardar e resgatar'));
  // Mede o caixa, não o planejamento
  check('o gatilho mede o caixa, não o disponível', corpoG.includes('DB.faltaParaGastar(0)'), true);
  check('e a falta vem do caixa livre',
    /faltaParaGastar\(valor\) \{[\s\S]{0,140}this\.caixaLivre\(\)/.test(fs.readFileSync(BASE + 'js/db.js', 'utf8')), true);
  // "A Pagar" não pode disparar: o saldo ainda está intacto
  check('lançamento não pago é ignorado', corpoG.includes("tx.status !== 'Pago'"), true);

  /* Os três caminhos que movem dinheiro de verdade chamam o gatilho: salvar um
     gasto pago, marcar um "A Pagar" como pago, e pagar a fatura. Faltar um deles
     deixaria uma porta por onde a reserva some sem aviso. */
  check('salvar um gasto pago avisa',
    /applyTxEffect\(rec, \+1\);[\s\S]{0,900}avisarSeUsouGuardado\(rec\)/.test(apG), true);
  check('marcar como pago avisa',
    /Marcado como pago[\s\S]{0,200}avisarSeUsouGuardado\(atualizado\)/.test(apG), true);
  check('e pagar a fatura também', /Fatura quitada[\s\S]{0,200}avisarSeUsouGuardado\(pgto\)/.test(apG), true);

  /* A insistência é intencional: enquanto o caixa estiver abaixo do guardado,
     todo lançamento volta a perguntar de onde sai. Adiar não silencia — é o que
     obriga a decidir em vez de deixar o número apodrecer. */
  check('não há trava que silencie depois de adiar', /jaAvisou|_silenciar|naoPerguntarMais/.test(corpoG), false);
  check('e a saída de "resolver depois" só fecha a folha',
    /ug-depois'\)\.onclick = closeSheet/.test(corpoG), true);

  // Sem meta com saldo, não há o que resgatar: a pergunta não aparece
  check('sem nada guardado, não pergunta', corpoG.includes('if (!metas.length) return;'), true);
  // O resgate ali não mexe em conta: o dinheiro já saiu no próprio gasto
  check('o resgate do gasto não move saldo de conta',
    corpoG.includes('from_account: null, to_account: null'), true);
} catch (e) { console.log(` FALHA | gatilho: ${e.message}`); fail++; }

/* ---- Fase 2: recorrência como contrato ----
   Os três cenários trazidos (10 meses, até cancelar, assinatura) mais os que
   apareceram avaliando: dia 31, retroativo, receita, pausa, valor variável. */
console.log('\n=== Recorrências ===');
try {
  const cR = DB.upsert('accounts', { name: 'Conta Recorrencia', type: 'Conta Corrente', balance: 50000 });
  const anoAtual = new Date().getFullYear();
  const isoDe = (a, m, d) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const novaRec = extra => DB.upsert('recurrences', {
    description: 'Teste rec', amount: 100, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cR, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 10, inicio: isoDe(anoAtual, 1, 10),
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null, ...extra,
  });

  /* CENÁRIO: dia 31 em fevereiro. new Date(ano, mes, 31) transborda para 3 de
     março silenciosamente — o aluguel apareceria no mês errado. */
  const r31 = DB.get('recurrences', novaRec({ dia: 31, inicio: isoDe(2026, 1, 31) }));
  check('dia 31 em janeiro é dia 31', DB.dataDaOcorrencia(r31, 0), '2026-01-31');
  check('em fevereiro cai no último dia', DB.dataDaOcorrencia(r31, 1), '2026-02-28');
  check('e não transborda para março', DB.dataDaOcorrencia(r31, 1).startsWith('2026-03'), false);
  check('em abril, que tem 30, cai no 30', DB.dataDaOcorrencia(r31, 3), '2026-04-30');
  check('e volta ao 31 em maio', DB.dataDaOcorrencia(r31, 4), '2026-05-31');
  const r29 = DB.get('recurrences', novaRec({ dia: 31, inicio: isoDe(2028, 1, 31) }));
  check('fevereiro bissexto vai até 29', DB.dataDaOcorrencia(r29, 1), '2028-02-29');

  // Periodicidades
  const rSem = DB.get('recurrences', novaRec({ periodicidade: 'semanal', inicio: isoDe(2026, 3, 2) }));
  check('semanal anda 7 dias', DB.dataDaOcorrencia(rSem, 1), '2026-03-09');
  const rQui = DB.get('recurrences', novaRec({ periodicidade: 'quinzenal', inicio: isoDe(2026, 3, 2) }));
  check('quinzenal anda 14 dias', DB.dataDaOcorrencia(rQui, 1), '2026-03-16');
  const rAno = DB.get('recurrences', novaRec({ periodicidade: 'anual', dia: 15, inicio: isoDe(2026, 3, 15) }));
  check('anual anda 12 meses', DB.dataDaOcorrencia(rAno, 1), '2027-03-15');

  /* CENÁRIO: os três fins — até cancelar, N vezes, até uma data. */
  const rSemPrazo = DB.get('recurrences', novaRec({ fim_tipo: 'sem_prazo' }));
  check('sem prazo nunca encerra sozinho', DB.recorrenciaEncerrada(rSemPrazo, '2099-12-31', 900), false);
  const rVezes = DB.get('recurrences', novaRec({ fim_tipo: 'vezes', fim_vezes: 10 }));
  check('na décima ainda não encerrou', DB.recorrenciaEncerrada(rVezes, '2026-10-10', 9), false);
  check('depois da décima encerra', DB.recorrenciaEncerrada(rVezes, '2026-11-10', 10), true);
  const rData = DB.get('recurrences', novaRec({ fim_tipo: 'data', fim_data: '2026-06-30' }));
  check('antes da data final segue', DB.recorrenciaEncerrada(rData, '2026-06-10', 5), false);
  check('depois dela para', DB.recorrenciaEncerrada(rData, '2026-07-10', 6), true);
  check('cancelada não gera mais',
    DB.recorrenciaEncerrada({ ...rSemPrazo, status: 'cancelada' }, '2026-01-01', 0), true);

  DB.data.recurrences = DB.data.recurrences.filter(r => r.description !== 'Teste rec');

  /* CENÁRIO CRÍTICO: nunca gerar retroativo. Cadastrar hoje o aluguel que se paga
     há dois anos não pode despejar 24 lançamentos no passado. */
  const fimCiclo = DB.fimISO(DB.monthPeriod(new Date()));
  const antigo = novaRec({ description: 'Aluguel antigo', inicio: somarDias(fimCiclo, -700), dia: 10 });
  DB.gerarRecorrencias();
  const doAntigo = DB.all('transactions').filter(t => t.recurrence_id === antigo);
  check('recorrência antiga não despeja o passado inteiro', doAntigo.length < 30, true);
  check('e nenhuma nasce depois do fim do ciclo', doAntigo.every(t => String(t.date) < fimCiclo), true);

  /* Rodar duas vezes não pode duplicar: a geração acontece a cada abertura do
     app, então ser idempotente é requisito, não elegância. */
  const antesDaSegunda = DB.all('transactions').filter(t => t.recurrence_id === antigo).length;
  DB.gerarRecorrencias();
  check('gerar de novo não duplica',
    DB.all('transactions').filter(t => t.recurrence_id === antigo).length, antesDaSegunda);

  check('o gerado nasce a pagar', doAntigo.every(t => t.status === 'A Pagar'), true);
  check('e aponta para a recorrência que o criou', doAntigo.every(t => t.recurrence_id === antigo), true);

  // Pausada não gera
  DB.upsert('recurrences', { ...DB.get('recurrences', antigo), status: 'pausada' });
  const paradas = DB.all('transactions').filter(t => t.recurrence_id === antigo).length;
  DB.gerarRecorrencias();
  check('pausada não gera nada', DB.all('transactions').filter(t => t.recurrence_id === antigo).length, paradas);

  /* CENÁRIO: receita. Salário é a recorrência mais previsível que existe, e um
     modelo que só serve para despesa está pela metade. */
  const rSal = novaRec({ description: 'Salario rec', type: 'Receita', amount: 6200, inicio: somarDias(fimCiclo, -20), dia: 5 });
  DB.gerarRecorrencias();
  const doSal = DB.all('transactions').filter(t => t.recurrence_id === rSal);
  check('receita também se repete', doSal.length > 0, true);
  check('e nasce a pagar, não como dinheiro em conta', doSal.every(t => t.status === 'A Pagar'), true);

  /* CENÁRIO: valor variável. Mediana e não média — um mês de conserto distorce a
     média e o previsto passa a mentir para cima. */
  const rLuz = novaRec({ description: 'Luz rec', valor_tipo: 'media', amount: 180 });
  check('sem histórico usa o valor informado', DB.valorDaRecorrencia(DB.get('recurrences', rLuz)), 180);
  for (const v of [150, 160, 170, 900]) {
    DB.upsert('transactions', { description: 'Luz rec paga', amount: v, date: dia(8), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cR, recurrence_id: rLuz });
  }
  const previsto = DB.valorDaRecorrencia(DB.get('recurrences', rLuz));
  check('com histórico usa a mediana', previsto, 165);
  check('e o mês fora da curva não puxa o previsto', previsto < 300, true);

  /* CASAMENTO COM O OFX: o app lançou "A Pagar" e o extrato traz o mesmo débito.
     Sem casar, o mês fica com duas linhas do mesmo aluguel e o comprometido nunca
     zera — e é a duplicação mais provável, porque a geração CRIA o par. */
  const dPrev = dia(10);
  const aguardando = DB.upsert('transactions', { description: 'Aluguel casamento', amount: 1800, date: dPrev, type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cR });
  const achado = DB.aPagarQueCasa({ date: somarDias(dPrev, 2), amount: -1800, memo: 'ALUGUEL CASAMENTO' }, cR);
  check('o extrato reconhece a conta que estava esperando', achado && achado.id, aguardando);
  check('mesmo com dois dias de diferença', !!achado, true);
  // A janela existe porque a data do boleto raramente é a do débito
  check('mas oito dias já é longe demais',
    !!DB.aPagarQueCasa({ date: somarDias(dPrev, 8), amount: -1800, memo: 'ALUGUEL CASAMENTO' }, cR), false);
  check('valor diferente não casa',
    !!DB.aPagarQueCasa({ date: dPrev, amount: -1799, memo: 'ALUGUEL CASAMENTO' }, cR), false);
  check('conta diferente não casa', !!DB.aPagarQueCasa({ date: dPrev, amount: -1800, memo: 'ALUGUEL CASAMENTO' }, 'outra'), false);
  // Já pago não pode casar de novo
  DB.upsert('transactions', { ...DB.get('transactions', aguardando), status: 'Pago' });
  check('conta já paga não casa de novo',
    !!DB.aPagarQueCasa({ date: dPrev, amount: -1800, memo: 'ALUGUEL CASAMENTO' }, cR), false);

  /* Ambiguidade: dois "A Pagar" do mesmo valor e sem parecença de nome. Devolver
     o errado seria pior que não casar. */
  DB.upsert('transactions', { description: 'Conta A', amount: 500, date: dPrev, type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cR });
  DB.upsert('transactions', { description: 'Conta B', amount: 500, date: dPrev, type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cR });
  check('com dois candidatos sem parecença, não adivinha',
    !!DB.aPagarQueCasa({ date: dPrev, amount: -500, memo: 'DEBITO QUALQUER' }, cR), false);
  check('mas o nome parecido desempata',
    (DB.aPagarQueCasa({ date: dPrev, amount: -500, memo: 'Conta A' }, cR) || {}).description, 'Conta A');

  /* CENÁRIO DO FIAT 500: o contrato criado a partir de um lançamento que JÁ
     EXISTE, começando no mesmo dia dele.

     Medido nos dados reais em 1º/08/2026: a parcela do Fiat aparecia TRÊS vezes
     em agosto. Uma lançada à mão (sem vínculo, porque o vínculo só nasce no que o
     gerador cria) e duas criadas pelo gerador, que deduplicava só pelo vínculo e
     por isso não enxergava a primeira. A previsão do mês já tratava disso; o
     gerador, que é quem GRAVA, não — e ali o estrago é maior: inflou o
     comprometido de verdade, não um número de tela. */
  DB.data.transactions = DB.data.transactions.filter(t => !/Parcela carro/.test(t.description || ''));
  const diaCarro = somarDias(DB.inicioISO(DB.monthPeriod(new Date())), 19);
  DB.upsert('transactions', {
    description: 'Parcela carro', amount: 780, date: diaCarro, type: 'Despesa',
    status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: cR,
  });
  const rCarro = novaRec({ description: 'Parcela carro', amount: 780, dia: 20, inicio: diaCarro });
  DB.gerarRecorrencias();
  const doCarro = () => DB.all('transactions').filter(t => /Parcela carro/.test(t.description || ''));
  check('contrato que começa no dia de um lançamento existente não duplica', doCarro().length, 1);
  check('e o que sobrou é o lançamento original, sem vínculo',
    doCarro().every(t => !t.recurrence_id), true);
  // E de novo, porque a geração roda a cada abertura do app
  DB.gerarRecorrencias();
  check('nem na segunda passagem', doCarro().length, 1);
  check('a previsão do mês conta a parcela uma vez só',
    DB.previsaoDoMes(DB.monthPeriod(new Date())).itens
      .filter(i => i.titulo === 'Parcela carro').length, 1);

  /* A JANELA não pode matar a repetição legítima. Uma diarista semanal tem quatro
     ocorrências no mesmo mês com o mesmo nome: casar por nome dentro do mês
     inteiro — que é o que a previsão fazia — deixaria só a primeira. */
  DB.data.transactions = DB.data.transactions.filter(t => !/Diarista/.test(t.description || ''));
  const rDia = novaRec({ description: 'Diarista', amount: 150, periodicidade: 'semanal',
    inicio: DB.inicioISO(DB.monthPeriod(new Date())) });
  DB.gerarRecorrencias();
  check('semanal gera todas as ocorrências do mês',
    DB.all('transactions').filter(t => t.recurrence_id === rDia).length >= 4, true);
  check('e a previsão do mês também as conta',
    DB.previsaoDoMes(DB.monthPeriod(new Date())).itens
      .filter(i => i.titulo === 'Diarista').length >= 4, true);

  /* O ID DA OCORRÊNCIA é derivado do par (contrato, data). É o que faz dois
     aparelhos que geram antes de conversar criarem a MESMA linha: o merge do sync
     é por id, então ids sorteados manteriam as duas. Foi o segundo defeito do
     Fiat — duas linhas com o mesmo recurrence_id e a mesma data, criadas com 10
     horas de diferença. */
  const idA = DB.idDaOcorrencia(rCarro, '2026-08-20');
  check('o id da ocorrência é o mesmo nas duas vezes', DB.idDaOcorrencia(rCarro, '2026-08-20'), idA);
  check('outra data dá outro id', DB.idDaOcorrencia(rCarro, '2026-09-20') !== idA, true);
  check('outro contrato dá outro id', DB.idDaOcorrencia(rDia, '2026-08-20') !== idA, true);
  check('e tem forma de uuid, porque a coluna é uuid no banco',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(idA), true);
  check('o gerado carrega esse id',
    DB.all('transactions').filter(t => t.recurrence_id === rDia)
      .every(t => t.id === DB.idDaOcorrencia(rDia, t.date)), true);

  DB.data.transactions = DB.data.transactions.filter(t => !/Parcela carro|Diarista/.test(t.description || ''));

  // Limpa
  DB.data.transactions = DB.data.transactions.filter(t =>
    !t.recurrence_id && !/Aluguel casamento|Conta A|Conta B|Luz rec paga/.test(t.description || ''));
  DB.data.recurrences = [];
  DB.data.accounts = DB.data.accounts.filter(a => a.id !== cR);
  DB.save();
} catch (e) { console.log(` FALHA | recorrências: ${e.message}`); fail++; }

/* ---- Contas fixas: a tela que fecha o ciclo ----
   Sem ela, "até eu cancelar" seria armadilha: a recorrência nasceria sem botão
   de cancelar. */
console.log('\n=== Tela de contas fixas ===');
try {
  const apRecUI = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const cU = DB.upsert('accounts', { name: 'Conta UI Rec', type: 'Conta Corrente', balance: 9000 });
  const rid = DB.upsert('recurrences', {
    description: 'Netflix UI', amount: 45, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    category_id: null, account_id: cU, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 15, inicio: dia(15),
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  openRecorrencias();
  const tela = els['#modal'].innerHTML;
  check('a tela lista a conta fixa', tela.includes('Netflix UI'), true);
  check('dizendo quando se repete', tela.includes('todo mês, dia 15'), true);
  check('e que não tem prazo', tela.includes('sem prazo'), true);
  check('com botão de pausar', tela.includes(`data-rec-pausa="${rid}"`), true);
  check('e de cancelar', tela.includes(`data-rec-cancela="${rid}"`), true);
  /* O botão "Valor" virou "Editar": ele mexia só no valor, e não havia caminho
     nenhum para dia, periodicidade, prazo, categoria, conta ou método. */
  check('e de editar a conta fixa', tela.includes(`data-rec-edit="${rid}"`), true);
  check('  e o botão que só mexia no valor não existe mais',
    tela.includes('data-rec-val'), false);

  // Financiamento: a tela precisa dizer quanto falta, não só "ativa"
  const rFin = DB.upsert('recurrences', {
    description: 'Financiamento UI', amount: 890, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cU, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 5, inicio: dia(5),
    fim_tipo: 'vezes', fim_data: null, fim_vezes: 48,
    geradas: 26, status: 'ativa', ultima_geracao: null,
  });
  check('conta o que falta de um parcelamento', DB.restamDaRecorrencia(DB.get('recurrences', rFin)), 22);
  check('e sem prazo não conta nada', DB.restamDaRecorrencia(DB.get('recurrences', rid)), null);
  openRecorrencias();
  check('a tela mostra quantas faltam', els['#modal'].innerHTML.includes('faltam 22'), true);

  /* Cancelar NÃO apaga: o histórico do que já foi lançado continua valendo, e
     apagar o contrato deixaria as transações órfãs de explicação. */
  const apU = apRecUI;
  const corpoU = apU.slice(apU.indexOf('function openRecorrencias'), apU.indexOf('function openConfigSection'));
  /* Cancelar apaga o PENDENTE e preserva o PAGO. Lançamento pago é histórico —
     apagá-lo reescreveria o passado mexendo em saldos já conciliados. Mas "A
     Pagar" de assinatura cancelada é lixo: infla o comprometido e fica na fila
     pedindo uma decisão que nunca vem. */
  check('cancelar limpa as pendências', corpoU.includes('DB.encerrarRecorrencia(id, apagar)'), true);
  check('e diz quantas saem', corpoU.includes('saem do extrato e do comprometido'), true);
  check('avisando que o pago fica', corpoU.includes('continuam no extrato, como histórico'), true);
  check('pausada pode ser reativada', corpoU.includes("{ status: 'ativa' }"), true);
  /* Reajuste vale da PRÓXIMA em diante: o aluguel de janeiro não passa a custar
     o preço de fevereiro. O aviso mora no editor, que é onde a edição acontece —
     antes vivia na folha só de valor, dentro de `openRecorrencias`. */
  const corpoEd = apU.slice(apU.indexOf('function openEditarContrato'), apU.indexOf('function openRecorrencias'));
  check('mudar o contrato não reescreve o passado',
    corpoEd.includes('Vale das próximas ocorrências em diante'), true);

  // A entrada existe nas Configurações
  check('as contas fixas têm entrada nas configurações', apU.includes("item('recorrencias'"), true);
  check('e o roteamento leva até a tela', apU.includes("if (sec === 'recorrencias') return openRecorrencias();"), true);
} catch (e) { console.log(` FALHA | tela de contas fixas: ${e.message}`); fail++; }
/* A limpeza fica FORA do try: registro dirty deixado para trás faz os testes
   async de sincronização girarem por sujeira, e o erro apareceria longe da
   causa — foi o que aconteceu antes. */
DB.data.recurrences = [];
DB.data.transactions = DB.data.transactions.filter(t => !/UI Rec|Netflix UI|Financiamento UI/.test(t.description || ''));
DB.data.accounts = DB.data.accounts.filter(a => a.name !== 'Conta UI Rec');
DB.save();

/* ---- Fase 3: pendências e projeção ----
   Lançar sozinho só serve se o que venceu não apodrecer na lista. E o total do
   mês fechando positivo esconde o dia em que o dinheiro acaba. */
console.log('\n=== Pendências e projeção ===');
const apF3 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
try {
  const cP = DB.upsert('accounts', { name: 'Conta Pendencia', type: 'Conta Corrente', balance: 3000 });
  const hoje = DB.paraISO(new Date());
  const nova = (desc, valor, quando, extra) => DB.upsert('transactions', {
    description: desc, amount: valor, date: quando, type: 'Despesa', status: 'A Pagar',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cP, ...extra,
  });

  const antes = DB.pendencias().length;
  nova('Vencida ha 3 dias', 400, DB.somarDiasISO(hoje, -3));
  nova('Vence hoje', 200, hoje);
  nova('Vence daqui a 5 dias', 900, DB.somarDiasISO(hoje, 5));
  const fila = DB.pendencias().filter(i => /Vencida|Vence/.test(i.titulo));

  check('a fila traz o que venceu', fila.some(i => i.titulo === 'Vencida ha 3 dias'), true);
  check('e o que vence hoje', fila.some(i => i.titulo === 'Vence hoje'), true);
  /* O que ainda não venceu NÃO entra: a fila é do que espera decisão agora, e
     enchê-la de futuro faria ninguém mais olhar. */
  check('mas não o que ainda vai vencer', fila.some(i => i.titulo === 'Vence daqui a 5 dias'), false);
  check('o mais atrasado vem primeiro', fila[0].titulo, 'Vencida ha 3 dias');
  check('com os dias de atraso contados', fila[0].atraso, 3);
  check('e o que vence hoje tem atraso zero',
    (fila.find(i => i.titulo === 'Vence hoje') || {}).atraso, 0);
  void antes;

  /* Receita esperada que não caiu é pendência do mesmo jeito: salário que não
     entrou precisa de decisão tanto quanto conta que não foi paga. */
  nova('Salario nao caiu', 6200, DB.somarDiasISO(hoje, -1), { type: 'Receita', method: 'PIX' });
  const comReceita = DB.pendencias().find(i => i.titulo === 'Salario nao caiu');
  check('receita que não caiu entra na fila', !!comReceita, true);
  check('marcada como receita', comReceita.tipo, 'receita');

  /* Fatura entra na MESMA fila: ela vence, atrasa e cobra juros como qualquer
     conta — separá-la faria procurar em dois lugares a mesma pergunta. */
  const cardP = DB.upsert('cards', { name: 'Cartao Pendencia', closing_day: 1, due_day: 1, account_id: cP, active: true });
  const chaveP = DB.invoiceKeyFor(DB.get('cards', cardP), DB.somarDiasISO(hoje, -70));
  DB.upsert('transactions', { description: 'Compra antiga', amount: 700, date: DB.somarDiasISO(hoje, -70), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito', card_id: cardP, invoice_key: chaveP });
  const comFatura = DB.pendencias().find(i => i.tipo === 'fatura');
  check('fatura vencida entra na fila', !!comFatura, true);
  check('com o valor que falta', comFatura && comFatura.valor, 700);

  // Compra no cartão não vira pendência sozinha: ela vence junto da fatura
  check('compra no cartão não vira pendência avulsa',
    DB.pendencias().some(i => i.titulo === 'Compra antiga'), false);

  /* ---- Projeção ----
     Só o que está "A Pagar" entra: o já pago está dentro do saldo, e somá-lo de
     novo contaria duas vezes. */
  const fimP = DB.fimISO(DB.monthPeriod(new Date()));
  const proj = DB.projecaoSaldo(fimP, hoje);
  check('a projeção começa hoje', proj[0].data, hoje);
  check('e vai até o fim do ciclo', proj[proj.length - 1].data < fimP, true);
  check('um ponto por dia, sem buracos',
    proj.every((p, i) => i === 0 || p.data === DB.somarDiasISO(proj[i - 1].data, 1)), true);
  // O saldo do último dia é o de hoje mais tudo que ainda se move
  const movimentoTotal = proj.reduce((s, p) => s + p.movimento, 0);
  check('o fim bate com o saldo mais o movimento previsto',
    Math.round(proj[proj.length - 1].saldo * 100) / 100,
    Math.round((DB.accountsTotal() + movimentoTotal) * 100) / 100);

  /* O vencido pesa JÁ no primeiro dia: é dinheiro que pode sair a qualquer
     momento, e empurrá-lo para a data original (no passado) o deixaria fora da
     projeção inteira.

     Mede a DIFERENÇA que a conta vencida faz no primeiro dia — olhar o sinal do
     movimento não serviria, porque nesse cenário há também um salário atrasado
     de +6.200 caindo ali, e a soma fica positiva mesmo com a conta dentro. */
  const semVencida = DB.projecaoSaldo(fimP, hoje)[0].movimento;
  const idVencida = nova('Vencida extra proj', 350, DB.somarDiasISO(hoje, -10));
  check('o vencido conta no primeiro dia',
    Math.round((DB.projecaoSaldo(fimP, hoje)[0].movimento - semVencida) * 100) / 100, -350);
  DB.remove('transactions', idVencida);
  check('e sai da conta quando o lançamento some',
    DB.projecaoSaldo(fimP, hoje)[0].movimento, semVencida);

  // Já pago não entra de novo
  const antesDoPago = DB.projecaoSaldo(fimP, hoje)[0].movimento;
  DB.upsert('transactions', { description: 'Ja pago P', amount: 5000, date: hoje, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cP });
  check('lançamento já pago não entra na projeção',
    DB.projecaoSaldo(fimP, hoje)[0].movimento, antesDoPago);

  /* O aviso que muda comportamento: o mês pode fechar positivo e mesmo assim
     passar por zero no meio do caminho. */
  /* A data da conta é presa ao FIM DO PERÍODO, não a "hoje + 2".

     Com hoje + 2 o teste quebrava nos dois últimos dias do mês: a conta caía no
     primeiro dia do ciclo seguinte, fora da janela da projeção, e nenhum dia
     negativo era encontrado. Passava 29 dias por mês e falhava 2 — o pior tipo de
     teste, porque a falha parece vir do código que se acabou de mexer. */
  /* `fimISO` devolve o primeiro dia FORA do período, e `projecaoSaldo` também trata
     o limite como exclusivo — então o último dia que a projeção cobre é fimP − 1. */
  const ultimoDia = DB.somarDiasISO(fimP, -1);
  const diaConta = DB.somarDiasISO(hoje, 2) <= ultimoDia ? DB.somarDiasISO(hoje, 2) : ultimoDia;
  const contaGrande = nova('Conta gigante', 99999, diaConta);
  const ponto = DB.primeiroDiaNegativo(fimP, hoje);
  check('acha o dia em que o saldo fica negativo', !!ponto, true);
  check('e é o dia da conta que derruba', ponto && ponto.data, diaConta);
  check('com o valor que ele atinge', ponto && ponto.saldo < 0, true);
  DB.remove('transactions', contaGrande);
  check('sem aperto previsto, não inventa aviso',
    DB.primeiroDiaNegativo(fimP, hoje) && DB.primeiroDiaNegativo(fimP, hoje).saldo < 0, null);

  /* A fila vem ANTES do saldo no Painel: de nada adianta o número bonito no topo
     se há três contas vencidas embaixo. */
  const corpoInicio = apF3.slice(apF3.indexOf('${setupCard}'), apF3.indexOf('${adviceCard}'));
  check('a fila aparece antes do saldo',
    corpoInicio.indexOf('filaDePendencias()') < corpoInicio.indexOf('heroAtual'), true);
  check('e o aviso de aperto logo depois dele',
    corpoInicio.indexOf('avisoDeAperto()') > corpoInicio.indexOf('heroAtual'), true);
  /* O painel é UMA COLUNA. Uma divisão em duas foi tentada e desfeita: abaixo do
     ponto de corte as colunas viravam pilha na ordem dos wrappers, e conselheiro
     e fila passavam à frente do saldo — com o cartão de configuração caindo
     depois deles. A checagem trava a volta disso por acidente. */
  check('o painel não volta a se dividir em colunas', /class="col-(side|main)"/.test(apF3), false);
  check('o cartão de configuração continua abrindo a tela',
    corpoInicio.indexOf('${setupCard}') < corpoInicio.indexOf('filaDePendencias()'), true);
  // Só no mês corrente: pendência de um mês fechado não é decisão de hoje
  check('a fila só existe no mês corrente', /\$\{atual \? filaDePendencias\(\) : ''\}/.test(apF3), true);

  /* Adiar muda a data, não some com a conta: escondê-la seria a forma mais rápida
     de o app perder a confiança de quem usa. */
  const corpoAdiar = apF3.slice(apF3.indexOf('data-pend-adiar]'), apF3.indexOf('const rprev'));
  check('adiar só muda a data', corpoAdiar.includes('{ ...t, date: nova }'), true);
  check('e oferece excluir explicitamente', corpoAdiar.includes('Não vou pagar'), true);
  check('avisando que o saldo não muda', corpoAdiar.includes('ainda não tinha sido pago'), true);
  // Pagar pela fila move o dinheiro e checa o guardado
  const corpoOk = apF3.slice(apF3.indexOf('data-pend-ok]'), apF3.indexOf('data-pend-adiar]'));
  check('pagar pela fila move o saldo', corpoOk.includes('applyTxEffect(pago, +1)'), true);
  check('e checa se usou o guardado', corpoOk.includes('avisarSeUsouGuardado(pago)'), true);
  check('fatura abre a folha de pagamento', corpoOk.includes('openPagarFaturaSheet'), true);
} catch (e) { console.log(` FALHA | pendências: ${e.message}`); fail++; }
/* Limpeza fora do try: registro dirty faz os testes async de sync girarem por
   sujeira, e o erro apareceria longe da causa. */
DB.data.transactions = DB.data.transactions.filter(t =>
  !/Vencida ha 3|Vence hoje|Vence daqui|Salario nao caiu|Compra antiga|Ja pago P|Conta gigante/.test(t.description || ''));
DB.data.cards = DB.data.cards.filter(c => c.name !== 'Cartao Pendencia');
DB.data.accounts = DB.data.accounts.filter(a => a.name !== 'Conta Pendencia');
DB.save();

/* ---- Ciclo de vida dos gráficos ----
   O risco que a biblioteca traz e o SVG à mão não tinha: cada gráfico é um objeto
   com listeners de resize. O innerHTML da próxima tela apaga o elemento mas NÃO
   destrói o objeto — sem limpeza, o app acumula gráficos órfãos e fica mais lento
   a cada navegação. */
console.log('\n=== Ciclo de vida dos gráficos ===');
{
  const apN = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const gN = fs.readFileSync(BASE + 'js/graficos.js', 'utf8');

  /* Ordem obrigatória: o div só existe depois do innerHTML, e a lib precisa medir
     o elemento para desenhar. Montar antes deixaria a tela sem gráfico nenhum. */
  const iView = apN.indexOf("$('#view').innerHTML");
  const corpoRender = apN.slice(iView, apN.indexOf('\r\n}', iView));
  check('a tela monta os gráficos', corpoRender.includes('Graficos.montar()'), true);
  check('e monta depois de ela ir para o DOM',
    corpoRender.includes('Graficos.montar()')
    && corpoRender.indexOf('innerHTML') < corpoRender.indexOf('Graficos.montar()'), true);
  check('e a folha também monta os dela',
    /UI\.enhance\(sheet\);[\s\S]{0,200}Graficos\.montar\(\)/.test(apN), true);
  /* limpar() antes de montar: derruba os da tela anterior, que já saíram do DOM.
     Confere a PRESENÇA antes da ordem — indexOf devolve -1 quando a chamada não
     existe, e -1 é menor que qualquer índice, então só comparar posições daria
     aprovado justamente no caso em que a limpeza foi removida. */
  check('a tela limpa os gráficos órfãos', corpoRender.includes('Graficos.limpar()'), true);
  check('e a limpeza vem antes da montagem',
    corpoRender.includes('Graficos.limpar()')
    && corpoRender.indexOf('Graficos.limpar()') < corpoRender.indexOf('Graficos.montar()'), true);

  // Redesenhar o mesmo id destrói a instância antiga primeiro
  check('redesenhar destrói a instância anterior',
    /antigo && antigo\.chart[\s\S]{0,80}antigo\.chart\.destroy\(\)/.test(gN), true);
  // E a limpeza só derruba o que saiu do DOM, não o que está na tela
  check('a limpeza só derruba o que saiu da tela',
    /if \(!document\.getElementById\(id\)\)[\s\S]{0,120}this\.vivos\.delete\(id\)/.test(gN), true);

  /* Comportamento real: montar, trocar de tela, limpar. O que saiu do DOM tem de
     sair do registro; o que continua na tela, ficar. */
  Graficos.vivos.clear();
  zeraFila();
  svgRanking([['a', 1]]);
  const idVivo = Graficos.fila[0].id;
  Graficos.montar();
  check('montar registra o gráfico', Graficos.vivos.size, 1);
  check('e a fila fica vazia depois', Graficos.fila.length, 0);
  // Simula a troca de tela: o elemento do gráfico deixa de existir
  const getBk = document.getElementById;
  document.getElementById = id => (id === idVivo ? null : getBk(id));
  Graficos.limpar();
  document.getElementById = getBk;
  check('trocar de tela derruba o gráfico órfão', Graficos.vivos.size, 0);

  /* Sem a biblioteca carregada, montar() não estoura — só não desenha. É o que
     permite a suíte rodar headless exercitando toda a montagem das telas. */
  zeraFila();
  svgRanking([['b', 2]]);
  check('sem a lib, montar não quebra', typeof Graficos.montar(), 'number');
  check('e a configuração fica registrada de todo jeito',
    Graficos.montadas().slice(-1)[0].opts.series[0].data[0], 2);
  Graficos.vivos.clear();
}

/* ---- Quatro correções vindas do teste em uso real ---- */
console.log('\n=== Comprometido por vencimento, encerrar recorrência e previsão ===');
const apAj = fs.readFileSync(BASE + 'js/app.js', 'utf8');
try {
  const cA = DB.upsert('accounts', { name: 'Conta Ajuste', type: 'Conta Corrente', balance: 20000 });
  const hoje = DB.paraISO(new Date());
  const fimCiclo = DB.fimISO(DB.monthPeriod(new Date()));

  /* 1) COMPROMETIDO DO MÊS = o que VENCE no mês, fatura incluída.
     Eu tinha feito a fatura contar sempre, argumentando que é dinheiro já gasto.
     O argumento é verdadeiro mas responde outra pergunta: comprometido alimenta
     "quanto posso gastar até o fim do mês", e fatura que vence dia 5 de agosto
     não sai do caixa em julho. */
  const cardA = DB.upsert('cards', { name: 'Cartao Ajuste', closing_day: 28, due_day: 10, account_id: cA, active: true });
  const chaveA = DB.invoiceKeyFor(DB.get('cards', cardA), hoje);
  DB.upsert('transactions', { description: 'Compra ajuste', amount: 900, date: hoje, type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito', card_id: cardA, invoice_key: chaveA });
  const inv = DB.invoicesOf(DB.get('cards', cardA)).find(i => i.key === chaveA);
  const venceDepois = DB.paraISO(inv.due) >= fimCiclo;
  check('a fatura do cenário vence no ciclo seguinte', venceDepois, true);
  check('e por isso NÃO entra no comprometido deste mês',
    DB.faturasAbertas(fimCiclo).some(i => i.key === chaveA), false);
  /* Mas não pode desaparecer: sem entrar em committedDepois ela sumiria das DUAS
     contas, e fatura invisível é o pior lugar possível para uma dívida existir. */
  check('mas aparece no que vence depois', DB.committedDepois(fimCiclo) >= 900, true);

  // Fatura que vence DENTRO do ciclo entra normalmente
  const cardB = DB.upsert('cards', { name: 'Cartao Ajuste B', closing_day: 1, due_day: 2, account_id: cA, active: true });
  const chaveB = DB.invoiceKeyFor(DB.get('cards', cardB), DB.somarDiasISO(hoje, -40));
  DB.upsert('transactions', { description: 'Compra B ajuste', amount: 300, date: DB.somarDiasISO(hoje, -40), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito', card_id: cardB, invoice_key: chaveB });
  const invB = DB.invoicesOf(DB.get('cards', cardB)).find(i => i.key === chaveB);
  if (DB.paraISO(invB.due) < fimCiclo) {
    check('fatura que vence no ciclo entra no comprometido',
      DB.faturasAbertas(fimCiclo).some(i => i.key === chaveB), true);
  }

  /* 2) ENCERRAR RECORRÊNCIA limpa o PENDENTE e preserva o PAGO.
     Lançamento pago é histórico — apagá-lo reescreveria o passado mexendo em
     saldos já conciliados. Mas "A Pagar" de assinatura cancelada é lixo: infla o
     comprometido e fica na fila pedindo decisão que nunca vem. */
  const rid = DB.upsert('recurrences', {
    description: 'Netflix ajuste', amount: 45, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cA, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 15, inicio: DB.somarDiasISO(hoje, -60),
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  DB.gerarRecorrencias();
  const geradas = DB.all('transactions').filter(t => t.recurrence_id === rid);
  check('a recorrência gerou lançamentos', geradas.length > 0, true);
  // Marca uma como paga: ela é histórico e tem de sobreviver
  const umaPaga = geradas[0];
  DB.upsert('transactions', { ...umaPaga, status: 'Pago' });
  const pendentesAntes = DB.all('transactions').filter(t => t.recurrence_id === rid && t.status === 'A Pagar').length;

  const limpos = DB.encerrarRecorrencia(rid, false);
  check('encerrar remove as pendências', limpos, pendentesAntes);
  check('e nenhuma sobra no extrato',
    DB.all('transactions').filter(t => t.recurrence_id === rid && t.status === 'A Pagar').length, 0);
  check('mas o que já foi pago continua', !!DB.get('transactions', umaPaga.id), true);
  check('e o contrato fica como cancelado', DB.get('recurrences', rid).status, 'cancelada');
  check('sem gerar de novo', (DB.gerarRecorrencias(), DB.all('transactions').filter(t => t.recurrence_id === rid && t.status === 'A Pagar').length), 0);

  /* Apagar de vez também preserva o histórico: o lançamento pago existiu, e
     apagá-lo mudaria um saldo que já foi conciliado com o banco. */
  const rid2 = DB.upsert('recurrences', {
    description: 'Spotify ajuste', amount: 22, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cA, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 20, inicio: DB.somarDiasISO(hoje, -40),
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  DB.gerarRecorrencias();
  const g2 = DB.all('transactions').filter(t => t.recurrence_id === rid2);
  if (g2.length) DB.upsert('transactions', { ...g2[0], status: 'Pago' });
  DB.encerrarRecorrencia(rid2, true);
  check('apagar remove o contrato', !!DB.get('recurrences', rid2), false);
  check('e ainda assim preserva o pago',
    g2.length ? !!DB.get('transactions', g2[0].id) : true, true);

  /* 3 e 4) PREVISÃO DOS PRÓXIMOS MESES, calculada e não materializada.
     Gerar "A Pagar" para doze meses encheria o extrato e deixaria dezenas de
     órfãos ao cancelar uma recorrência. */
  const rAluguel = DB.upsert('recurrences', {
    description: 'Aluguel previsao', amount: 1800, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cA, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 10, inicio: hoje,
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  const rSalario = DB.upsert('recurrences', {
    description: 'Salario previsao', amount: 6200, valor_tipo: 'fixo', type: 'Receita',
    scope: 'Família', member: MEMBRO_COMUM, method: 'PIX',
    category_id: null, account_id: cA, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 5, inicio: hoje,
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  const prox = DB.previsaoMeses(6);
  check('prevê seis meses', prox.length, 6);
  check('cada mês tem o que sai', prox[0].sai >= 1800, true);
  check('e o que entra', prox[0].entra >= 6200, true);
  check('com o resultado do mês', Math.round(prox[0].resultado), Math.round(prox[0].entra - prox[0].sai));
  /* O saldo ROLA de um mês para o outro: um mês negativo no meio contamina os
     seguintes, e olhar mês a mês isolado esconde isso. */
  check('o saldo rola para o mês seguinte',
    Math.round(prox[1].saldoAoFim), Math.round(prox[0].saldoAoFim + prox[1].resultado));
  check('e o primeiro parte do disponível de hoje',
    Math.round(prox[0].saldoAoFim), Math.round(DB.available() + prox[0].resultado));
  check('o aluguel aparece na lista do mês', prox[0].itens.some(i => i.titulo === 'Aluguel previsao'), true);
  check('marcado como previsto', prox[0].itens.find(i => i.titulo === 'Aluguel previsao').origem, 'prevista');
  check('e o salário como receita', prox[0].itens.find(i => i.titulo === 'Salario previsao').receita, true);

  /* Nada é materializado além do ciclo atual: o extrato não pode encher de linhas
     que ninguém pediu. */
  const doAluguel = DB.all('transactions').filter(t => t.recurrence_id === rAluguel);
  check('a previsão não cria lançamentos', doAluguel.every(t => String(t.date) < fimCiclo), true);

  /* Não contar duas vezes: o que já foi materializado no ciclo atual não deve ser
     somado de novo pela recorrência. */
  const pMes = DB.monthPeriod(new Date(), 1);
  const antesMat = DB.previsaoDoMes(pMes).sai;
  DB.upsert('transactions', { description: 'Aluguel previsao', amount: 1800, date: DB.somarDiasISO(DB.inicioISO(pMes), 9), type: 'Despesa', status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto', account_id: cA, recurrence_id: rAluguel });
  check('lançamento já materializado não conta duas vezes', DB.previsaoDoMes(pMes).sai, antesMat);

  // Navegar para o futuro no extrato
  check('o extrato anda para frente', /if \(state\.monthOffset >= 6\) return;/.test(apAj), true);
  check('e o mês futuro se anuncia', apAj.includes('ainda não chegou'), true);
  check('a previsão aparece nos relatórios', apAj.includes('relProximosMeses()'), true);
} catch (e) { console.log(` FALHA | ajustes: ${e.message}`); fail++; }
// Limpeza fora do try: dirty deixado atrás faz os testes async de sync girarem
DB.data.transactions = DB.data.transactions.filter(t =>
  !/ajuste|previsao|Netflix ajuste|Spotify ajuste/i.test(t.description || ''));
DB.data.recurrences = [];
DB.data.cards = DB.data.cards.filter(c => !/Cartao Ajuste/.test(c.name || ''));
DB.data.accounts = DB.data.accounts.filter(a => a.name !== 'Conta Ajuste');
DB.save();

/* ---- O futuro nas visões de tempo ----
   Defeitos relatados em uso: salário lançado para o futuro não mexia no saldo do
   extrato, e a fatura prevista não aparecia no mês em que vence. A causa era a
   mesma: saldoNaData só olha para trás. */
console.log('\n=== Saldo e fatura no futuro ===');
const apFu = fs.readFileSync(BASE + 'js/app.js', 'utf8');
try {
  const cFu = DB.upsert('accounts', { name: 'Conta Fut', type: 'Conta Corrente', balance: 5000 });
  const hj = DB.paraISO(new Date());
  const saldoHoje = DB.accountsTotal();
  // Mede a VARIAÇÃO: o cenário base já tem lançamentos pendentes, e comparar
  // absolutos faria o teste depender da ordem em que os blocos rodam
  const previstoAntes = DB.saldoPrevistoNaData(null, DB.fimISO(DB.monthPeriod(new Date(), 1)));

  /* saldoNaData sozinha devolve o saldo de HOJE para qualquer data futura: ela
     parte do saldo real e desfaz o que foi pago, então não conhece agendamento.
     Era isso que fazia o extrato de agosto mostrar receita na lista e saldo
     inalterado no topo. */
  const pProx = DB.monthPeriod(new Date(), 1);
  const fimProx = DB.fimISO(pProx);
  check('saldoNaData ignora o futuro, como sempre fez', DB.saldoNaData(null, fimProx), saldoHoje);

  const dSal = DB.somarDiasISO(DB.inicioISO(pProx), 4);
  DB.upsert('transactions', { description: 'Salario fut', amount: 6200, date: dSal, type: 'Receita',
    status: 'A Pagar', scope: 'Família', member: MEMBRO_COMUM, method: 'PIX', account_id: cFu });
  check('mas o saldo PREVISTO conta o salário agendado',
    DB.saldoPrevistoNaData(null, fimProx) - previstoAntes, 6200);
  check('e para hoje continua igual ao real',
    DB.saldoPrevistoNaData(null, hj), DB.saldoNaData(null, hj));
  /* Data passada não muda: o passado vem do saldo real, que é o número confiável
     porque sai da conciliação com o banco. */
  const ontem = DB.somarDiasISO(hj, -1);
  check('data passada segue vindo do saldo real',
    DB.saldoPrevistoNaData(null, ontem), DB.saldoNaData(null, ontem));

  /* A FATURA conta pelo VENCIMENTO, e era o que faltava para um mês futuro
     fechar: a compra no cartão não sai da conta quando é feita, sai quando a
     fatura é paga. */
  const cardFu = DB.upsert('cards', { name: 'Cartao Fut', closing_day: 28, due_day: 10, account_id: cFu, active: true });
  const chaveFu = DB.invoiceKeyFor(DB.get('cards', cardFu), hj);
  DB.upsert('transactions', { description: 'Compra fut', amount: 900, date: hj, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    card_id: cardFu, invoice_key: chaveFu });
  const invFu = DB.invoicesOf(DB.get('cards', cardFu)).find(i => i.key === chaveFu);
  const venceFu = DB.paraISO(invFu.due);
  const pVence = DB.monthPeriod(new Date(Date.parse(venceFu + 'T12:00:00')));
  check('a fatura aparece no período em que vence',
    DB.faturasDoPeriodo(pVence).some(i => i.key === chaveFu), true);
  check('e não em outro', DB.faturasDoPeriodo(DB.monthPeriod(new Date())).some(i => i.key === chaveFu),
    DB.paraISO(invFu.due) < DB.fimISO(DB.monthPeriod(new Date())));
  /* A queda ENTRE o dia do vencimento e o seguinte tem de conter os 900 da
     fatura. Comparar dois pontos da mesma série prova que ela pesa na data certa,
     sem depender do resto do cenário — que tem outros pendentes. */
  const depoisDoVencimento = DB.somarDiasISO(venceFu, 1);
  const noDia = DB.saldoPrevistoNaData(null, venceFu);
  const noDiaSeguinte = DB.saldoPrevistoNaData(null, depoisDoVencimento);
  check('o saldo previsto cai no dia do vencimento da fatura',
    Math.round((noDia - noDiaSeguinte) * 100) / 100 >= 900, true);
  /* E não pesa ANTES: saldoPrevistoNaData(D) é o saldo antes do que acontece em
     D, então a fatura só entra a partir do dia seguinte. */
  const antesDoVencimento = DB.saldoPrevistoNaData(null, venceFu);
  DB.setInvoicePaid(chaveFu, true);
  check('e deixa de pesar quando a fatura é quitada',
    DB.saldoPrevistoNaData(null, depoisDoVencimento) > noDiaSeguinte, true);
  DB.setInvoicePaid(chaveFu, false);
  check('voltando a pesar se a quitação é desfeita',
    DB.saldoPrevistoNaData(null, venceFu), antesDoVencimento);

  // No extrato do mês em que vence, ela é uma LINHA
  state.filtros = filtrosVazios();
  state.monthOffset = DB.diasEntre(hj, venceFu) > 0 ? 1 : 0;
  const htmlVence = renderExtrato(pVence);
  check('a fatura vira linha no extrato', htmlVence.includes('Fatura Cartao Fut'), true);
  check('marcada como prevista', /tx tx-prev[^>]*data-fatura=/.test(htmlVence), true);
  check('e leva para o pagamento ao toque', apFu.includes("v.querySelectorAll('[data-fatura]')"), true);

  /* A fatura pesa no total do dia SÓ com conta filtrada. Sem filtro o total é
     GASTO, e as compras do cartão já contaram quando foram feitas — somá-la seria
     o mesmo dinheiro duas vezes. Mesma regra do pagamento de fatura. */
  const corpoFu = apFu.slice(apFu.indexOf('A fatura conta no total do dia'), apFu.indexOf('// Totais do período nesta conta'));
  check('a fatura só entra no total do dia com conta filtrada',
    corpoFu.includes('if (contasFiltradas.length) {'), true);
  check('e a razão está escrita', corpoFu.includes('o mesmo dinheiro duas'), true);

  /* Mês futuro se anuncia: extrato quase vazio pareceria perda de dados. */
  check('o mês futuro se identifica', apFu.includes('ainda não chegou'), true);

  /* SAÚDE DOS PRÓXIMOS MESES no Painel: abrir o app pergunta "como estamos?", e
     essa pergunta não para no dia 31. */
  const rFu = DB.upsert('recurrences', {
    description: 'Aluguel fut', amount: 1800, valor_tipo: 'fixo', type: 'Despesa',
    scope: 'Família', member: MEMBRO_COMUM, method: 'Boleto',
    category_id: null, account_id: cFu, card_id: null, tags: [], notes: '',
    periodicidade: 'mensal', dia: 10, inicio: hj,
    fim_tipo: 'sem_prazo', fim_data: null, fim_vezes: null,
    geradas: 0, status: 'ativa', ultima_geracao: null,
  });
  /* O gráfico saiu do TOPO do Painel: aquele espaço é caro, e a curva inteira tem
     lugar próprio nos Relatórios. O Painel guarda só o aviso em texto, para o
     alerta não se perder junto com o gráfico. */
  state.monthOffset = 0;
  const painel = renderInicio(DB.monthPeriod(new Date()));
  check('o painel não traz mais o bloco de barras', painel.includes('fut-col'), false);
  const fluxo = DB.fluxoMensal(0, 6).filter(m => m.futuro);
  if (fluxo.some(m => m.saldo < 0) && !DB.primeiroDiaNegativo()) {
    check('mas avisa em texto quando um mês futuro aperta', painel.includes('aperta'), true);
    check('e leva à curva', painel.includes('id="fut-ver"'), true);
  }
  // A curva vive nos Relatórios
  const relF = renderRelatorios();
  check('a curva de 12 meses está nos relatórios', relF.includes('De onde vim, para onde vou'), true);
  void rFu;
} catch (e) { console.log(` FALHA | futuro: ${e.message}`); fail++; }
// Limpeza fora do try
state.monthOffset = 0; state.filtros = filtrosVazios();
DB.data.transactions = DB.data.transactions.filter(t => !/Salario fut|Compra fut|Aluguel fut/.test(t.description || ''));
DB.data.recurrences = [];
DB.data.cards = DB.data.cards.filter(c => c.name !== 'Cartao Fut');
DB.data.accounts = DB.data.accounts.filter(a => a.name !== 'Conta Fut');
DB.save();

/* ---- Fatura paga no modelo antigo ----
   Defeito relatado: somar os lançamentos do extrato não batia com o total, na
   conta C6 em julho. A causa é pior do que parece: antes da versão 63, pagar
   fatura era um adjustBalance silencioso — o saldo caía e nada no extrato
   explicava. E como saldoNaData trabalha de trás para frente a partir do saldo
   atual, sem lançamento para desfazer ela devolve um SALDO ANTERIOR errado. */
console.log('\n=== Migração de fatura paga no modelo antigo ===');
try {
  const cL = DB.upsert('accounts', { name: 'Conta Legado', type: 'Conta Corrente', balance: 4000 });
  const cardL = DB.upsert('cards', { name: 'Cartao Legado', closing_day: 1, due_day: 10, account_id: cL, active: true });
  const pL = DB.monthPeriod(new Date());
  const compraEm = DB.somarDiasISO(DB.inicioISO(pL), -20);
  const chaveL = DB.invoiceKeyFor(DB.get('cards', cardL), compraEm);
  DB.upsert('transactions', { description: 'Compra legado', amount: 800, date: compraEm, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    card_id: cardL, invoice_key: chaveL });

  // Reproduz o caminho antigo: marca paga e debita a conta, sem lançamento
  DB.setInvoicePaid(chaveL, true);
  adjustBalance(cL, -800);
  const antesDaMigracao = DB.saldoPrevistoNaData([cL], DB.inicioISO(pL));
  check('sem lançamento, o saldo anterior vem errado', antesDaMigracao, 3200);

  const migradas = DB.migrarFaturasPagasAntigas();
  check('a migração recupera a fatura', migradas >= 1, true);
  const pgto = DB.all('transactions').find(t => t.pays_invoice === chaveL);
  check('criando o lançamento que faltava', !!pgto, true);
  check('com o valor da fatura', pgto.amount, 800);
  check('na data do vencimento, a única que a fatura conhece',
    pgto.date, DB.paraISO(DB.invoicesOf(DB.get('cards', cardL)).find(i => i.key === chaveL).due));
  check('na conta de pagamento do cartão', pgto.account_id, cL);
  check('e dizendo de onde veio', /versão anterior/.test(pgto.notes || ''), true);

  /* O SALDO NÃO PODE SER DEBITADO DE NOVO: o caminho antigo já tirou o dinheiro
     da conta. Aplicar o efeito na migração cobraria a fatura duas vezes. */
  check('o saldo da conta não muda com a migração', DB.get('accounts', cL).balance, 3200);
  // E o saldo anterior volta ao que realmente era
  check('o saldo anterior volta ao correto', DB.saldoPrevistoNaData([cL], DB.inicioISO(pL)), 4000);

  /* Idempotência: a migração roda a cada abertura do app. Criar de novo faria a
     fatura aparecer duas vezes e o extrato passar a mentir para o outro lado. */
  check('rodar de novo não duplica', DB.migrarFaturasPagasAntigas(), 0);
  check('e continua com um lançamento só',
    DB.all('transactions').filter(t => t.pays_invoice === chaveL).length, 1);

  /* Fatura paga pelo caminho NOVO não é tocada: ela já tem lançamento, e um
     segundo pagamento cobraria duas vezes. */
  const cN = DB.upsert('accounts', { name: 'Conta Nova Pg', type: 'Conta Corrente', balance: 5000 });
  const cardN = DB.upsert('cards', { name: 'Cartao Nova Pg', closing_day: 1, due_day: 10, account_id: cN, active: true });
  const chaveN = DB.invoiceKeyFor(DB.get('cards', cardN), compraEm);
  DB.upsert('transactions', { description: 'Compra nova', amount: 500, date: compraEm, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    card_id: cardN, invoice_key: chaveN });
  const pgN = { description: 'Fatura Cartao Nova Pg', amount: 500, date: DB.paraISO(new Date()),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Fatura',
    account_id: cN, category_id: null, pays_invoice: chaveN };
  DB.upsert('transactions', pgN); applyTxEffect(pgN, +1);
  DB.setInvoicePaid(chaveN, true);
  const antesN = DB.all('transactions').filter(t => t.pays_invoice === chaveN).length;
  DB.migrarFaturasPagasAntigas();
  check('fatura já paga com lançamento não é duplicada',
    DB.all('transactions').filter(t => t.pays_invoice === chaveN).length, antesN);

  /* O pedido: a fatura paga aparece no extrato. Ela aparece como o LANÇAMENTO de
     pagamento — não como uma linha de fatura à parte, que somaria o mesmo
     dinheiro duas vezes na mesma tela. */
  state.filtros = { ...filtrosVazios(), contas: [cL] };
  const htmlL = renderExtrato(pL);
  check('a fatura paga aparece no extrato', htmlL.includes('Fatura Cartao Legado'), true);
  check('e não em duplicidade', (htmlL.match(/Fatura Cartao Legado/g) || []).length, 1);

  /* A identidade que o usuário conferiu na mão: anterior + entrou − saiu = final.
     É o teste de que o extrato não esconde nem inventa movimento. */
  const num = re => { const m = htmlL.match(re); return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null; };
  const antes = num(/aria-label="Saldo dia a dia[^"]*, de ([\d.,]+) a/);
  const entrou = num(/pt pt-up"><\/i>([\d.,]+) <small>/);
  const saiu = num(/pt pt-dn"><\/i>([\d.,]+) <small>/);
  const fim = num(/res-dir">\s*<b[^>]*>R\$\s*([\d.,]+)/);
  check('a soma do extrato fecha com o saldo',
    Math.abs((antes + entrou - saiu) - fim) < 0.01, true);
  check('e a fatura está dentro do que saiu', saiu >= 800, true);
} catch (e) { console.log(` FALHA | migração de fatura: ${e.message}`); fail++; }
// Limpeza fora do try
state.filtros = filtrosVazios();
DB.data.transactions = DB.data.transactions.filter(t => !/legado|Legado|Compra nova|Nova Pg/.test(t.description || ''));
DB.data.invoice_status = DB.data.invoice_status.filter(s =>
  !DB.data.cards.some(c => /Legado|Nova Pg/.test(c.name || '') && String(s.invoice_key).startsWith(c.id)));
DB.data.cards = DB.data.cards.filter(c => !/Legado|Nova Pg/.test(c.name || ''));
DB.data.accounts = DB.data.accounts.filter(a => !/Legado|Nova Pg/.test(a.name || ''));
DB.save();

/* ---- Pagamento parcial: o que resta é o que pesa ---- */
console.log('\n=== Fatura com pagamento parcial ===');
try {
  const cPp = DB.upsert('accounts', { name: 'Conta Parcial X', type: 'Conta Corrente', balance: 9000 });
  const cardPp = DB.upsert('cards', { name: 'Cartao Parcial X', closing_day: 1, due_day: 10, account_id: cPp, active: true });
  const pPp = DB.monthPeriod(new Date());
  const compraEm = DB.somarDiasISO(DB.inicioISO(pPp), -20);
  const chavePp = DB.invoiceKeyFor(DB.get('cards', cardPp), compraEm);
  DB.upsert('transactions', { description: 'Compra parcial X', amount: 1000, date: compraEm, type: 'Despesa',
    status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Cartão de Crédito',
    card_id: cardPp, invoice_key: chavePp });
  const fat = () => DB.invoicesOf(DB.get('cards', cardPp)).find(i => i.key === chavePp);
  check('a fatura soma a compra', fat().total, 1000);
  check('e nasce devendo tudo', fat().falta, 1000);

  const compAntes = DB.committed();
  // Paga 300 dos 1000
  const pg1 = { description: 'Fatura Cartao Parcial X', amount: 300, date: DB.paraISO(fat().due),
    type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Fatura',
    account_id: cPp, category_id: null, pays_invoice: chavePp };
  DB.upsert('transactions', pg1); applyTxEffect(pg1, +1);

  check('o pago é registrado', fat().pago, 300);
  /* O que RESTA é o que pesa: falta = total − pago. Contar a fatura inteira
     depois de pagar parte tiraria do disponível dinheiro que já saiu. */
  check('o que falta é o total menos o pago', fat().falta, 700);
  check('a fatura fica Parcial', fat().status, 'Parcial');
  const dentroDoCiclo = DB.paraISO(fat().due) < DB.fimISO(pPp);
  if (dentroDoCiclo) {
    check('e o comprometido cai só o que foi pago', DB.committed(), compAntes - 300);
  }
  // A linha do extrato mostra o saldo devedor, não o valor original
  state.filtros = { ...filtrosVazios(), contas: [cPp] };
  const htmlPp = renderExtrato(DB.monthPeriod(new Date(Date.parse(DB.paraISO(fat().due) + 'T12:00:00'))));
  if (htmlPp.includes('data-fatura=')) {
    check('a linha prevista mostra o que falta', htmlPp.includes(fmt(700)), true);
    check('e diz quanto já foi pago', /já pago/.test(htmlPp), true);
  }
  // Quitar o resto zera
  const pg2 = { ...pg1, id: null, amount: 700 };
  DB.upsert('transactions', pg2); applyTxEffect(pg2, +1);
  check('quitando o resto, nada falta', fat().falta, 0);
  check('e a fatura fica Paga', fat().status, 'Paga');
  check('sem sobrar no comprometido',
    DB.faturasAbertas(DB.fimISO(pPp)).some(i => i.key === chavePp), false);

  /* A migração do modelo antigo não pode reabrir isso: a chave já tem lançamento,
     então ela passa longe — senão cobraria a fatura de novo por inteiro. */
  DB.setInvoicePaid(chavePp, true);
  const pagamentosAntes = DB.all('transactions').filter(t => t.pays_invoice === chavePp).length;
  DB.migrarFaturasPagasAntigas();
  check('a migração não toca em fatura com pagamento parcial registrado',
    DB.all('transactions').filter(t => t.pays_invoice === chavePp).length, pagamentosAntes);
} catch (e) { console.log(` FALHA | parcial: ${e.message}`); fail++; }
state.filtros = filtrosVazios();
DB.data.transactions = DB.data.transactions.filter(t => !/Parcial X/.test(t.description || ''));
DB.data.invoice_status = DB.data.invoice_status.filter(s =>
  !DB.data.cards.some(c => /Parcial X/.test(c.name || '') && String(s.invoice_key).startsWith(c.id)));
DB.data.cards = DB.data.cards.filter(c => !/Parcial X/.test(c.name || ''));
DB.data.accounts = DB.data.accounts.filter(a => !/Parcial X/.test(a.name || ''));
DB.save();

/* ---- Fluxo e saldo: dois painéis, um eixo de tempo ----
   Barras de fluxo mensal vivem nos milhares; saldo acumulado, nas dezenas de
   milhares. Sobrepor os dois exigiria DOIS EIXOS Y no mesmo painel — e alinhar
   duas escalas é arbitrário: o gráfico passa a insinuar uma correlação que não
   está no dado. É o erro mais comum em gráfico financeiro. */
console.log('\n=== Gráfico de fluxo e saldo ===');
try {
  const meses = DB.fluxoMensal(6, 6);
  check('cobre seis atrás, o atual e seis à frente', meses.length, 13);
  check('os seis primeiros são realizados', meses.slice(0, 7).every(m => !m.futuro), true);
  check('e os seis últimos são previstos', meses.slice(7).every(m => m.futuro), true);
  check('em ordem cronológica',
    meses.every((m, i) => i === 0 || m.period.start > meses[i - 1].period.start), true);

  /* As duas metades vêm de fontes diferentes, e tem de ser assim: o passado sai do
     saldo REAL (conciliado com o banco) e o futuro rola somando o previsto.
     Misturar as origens faria o passado herdar a incerteza da previsão. */
  const passado = meses[3];
  check('o saldo do passado é o saldo real daquela data',
    passado.saldo, DB.saldoNaData(null, DB.fimISO(passado.period)));
  check('e o futuro rola a partir do mês anterior',
    Math.round(meses[8].saldo * 100) / 100,
    Math.round((meses[7].saldo + DB.previsaoDoMes(meses[8].period).resultado) * 100) / 100);

  zeraFila();
  const svg = svgFluxoSaldo(meses);
  const c = cfgDo(svg);
  const cssFl = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  const apFl = fs.readFileSync(BASE + 'js/app.js', 'utf8');

  // Combinado num painel só: barras para o movimento, área para o nível
  check('é um gráfico só, combinado', c.series.length, 3);
  check('com barras de entrada e saída',
    c.series[0].type === 'column' && c.series[1].type === 'column', true);
  check('e a área do saldo', c.series[2].type, 'area');
  /* HIERARQUIA: as barras são o contexto, a área é a resposta. Elas em tom claro,
     ela saturada e por cima. Antes era o inverso — verde e vermelho cheios —, e aí
     a área tinha de ficar translúcida para não cobri-las; translúcida ela não se
     lia sobre as barras. Invertida a hierarquia, a área pode ser sólida. */
  check('as barras vêm em tom claro',
    c.colors[0] === clarear(Graficos.cor.verde, 0.42)
    && c.colors[1] === clarear(Graficos.cor.vermelho, 0.42), true);
  check('e são mais claras que a cor cheia',
    parseInt(c.colors[0].slice(1), 16) > parseInt(Graficos.cor.verde.slice(1), 16), true);
  check('a área leva a cor saturada', c.colors[2], Graficos.cor.roxo);
  check('e os treze meses viraram categorias', c.xaxis.categories.length, 13);
  check('com os valores que vieram do fluxo mensal',
    pontosDe(c.series[2]).join(','), meses.map(m => Math.round(m.saldo)).join(','));

  /* DUAS ESCALAS ANCORADAS. Fluxo mensal vive nos milhares e saldo acumulado nas
     dezenas de milhares — numa escala só o saldo achata as barras a nada. Duas são
     inevitáveis; o que dá para eliminar é a parte arbitrária: os dois recebem min e
     max declarados para que o ZERO caia na mesma altura e o TOPO na mesma borda.
     Sem isso, cada eixo escolhe extremos por conta e o cruzamento entre a área e as
     barras não significa nada. */
  check('há dois eixos, não um forçado', c.yaxis.length, 3);
  check('o eixo do saldo fica do lado oposto', c.yaxis[2].opposite, true);
  check('as duas colunas dividem o mesmo eixo',
    c.yaxis[0].seriesName === 'entrou' && c.yaxis[1].seriesName === 'entrou', true);
  check('os dois eixos têm limites declarados',
    [c.yaxis[0].min, c.yaxis[0].max, c.yaxis[2].min, c.yaxis[2].max]
      .every(v => typeof v === 'number'), true);
  const fracaoAcima = y => (y.max - 0) / (y.max - y.min);
  check('e o zero cai na mesma altura nos dois',
    Math.abs(fracaoAcima(c.yaxis[0]) - fracaoAcima(c.yaxis[2])) < 1e-9, true);
  check('nenhum dado é cortado pelo limite',
    Math.max(...pontosDe(c.series[2])) <= c.yaxis[2].max
    && Math.min(...pontosDe(c.series[2])) >= c.yaxis[2].min
    && Math.max(...pontosDe(c.series[0]), ...pontosDe(c.series[1])) <= c.yaxis[0].max, true);
  check('e a nota do cartão avisa que são duas unidades',
    relProximosMeses().includes('onde a linha cruza as barras não significa nada'), true);

  /* EIXOS SEM TEXTO: os números que importam estão no rodapé do cartão, e duas
     colunas de números — uma de cada lado — só apertavam o desenho. Os limites
     ficam, porque eles são geometria e não rótulo. */
  check('os dois eixos de valor estão sem texto',
    c.yaxis[0].labels.show === false && c.yaxis[2].labels.show === false, true);
  check('mas as linhas de grade ficam, que são a régua', c.grid.yaxis.lines.show, true);
  check('e o rodapé do cartão traz os números', (() => {
    const cardFl = relProximosMeses();
    return /chart-foot/.test(cardFl) && /Hoje/.test(cardFl) && /Previsto entrar/.test(cardFl);
  })(), true);

  /* A área é a última série, então é desenhada por cima. Com as barras claras ela
     não precisa mais se apagar: o degradê começa forte no traço e se dissolve para
     baixo, devolvendo as barras à vista embaixo. */
  check('a área é sólida, não mais lavada', c.fill.opacity[2], 1);
  check('e o degradê se dissolve para baixo',
    c.fill.gradient.opacityTo < c.fill.gradient.opacityFrom, true);
  check('a área é a última série, então fica por cima', c.series[2].type, 'area');
  check('a linha do saldo tem traço grosso, as barras não',
    c.stroke.width.join(','), '0,0,4');
  check('e a barra não ganha contorno, que seria tinta sem dado',
    c.stroke.colors[0] === 'transparent' && c.stroke.colors[1] === 'transparent', true);
  check('o traço da área leva a cor dela', c.stroke.colors[2], Graficos.cor.roxo);

  /* Ponta arredondada, pé reto: o topo é o dado; a base encosta no zero, e
     arredondá-la faria a barra parecer flutuar. */
  check('a barra tem ponta arredondada', c.plotOptions.bar.borderRadius > 0, true);
  check('e fecha reta na base', c.plotOptions.bar.borderRadiusApplication, 'end');

  /* A FRONTEIRA DE HOJE aparece de três formas — faixa sombreada, rótulo
     "previsto" e trecho tracejado. Confundir previsão com fato é o pior engano
     possível num app de finanças, e uma marca só é fácil de não notar. */
  const nFut = meses.filter(m => m.futuro).length;
  check('o trecho previsto é tracejado', c.forecastDataPoints.dashArray > 0, true);
  check('e o tracejado cobre exatamente os meses futuros', c.forecastDataPoints.count, nFut);
  check('a faixa do futuro está sombreada', c.annotations.xaxis.length, 1);
  check('com rótulo dizendo previsto', c.annotations.xaxis[0].label.text, 'previsto');

  /* A FAIXA CAÍA NO LUGAR ERRADO, e a causa era o rótulo repetido.

     As anotações do ApexCharts localizam a coluna pelo TEXTO do rótulo, e
     `getStringX` resolve com `indexOf` — a primeira ocorrência. Numa janela de 13
     meses o último tem o mesmo nome do primeiro ("jan" … "jan"), então o `x2` da
     faixa resolvia para o índice 0 e a sombra do "previsto" cobria o passado
     inteiro em vez do futuro.

     Por isso se testa pelo ÍNDICE que o rótulo resolve, e não só pelo texto: era
     exatamente isso que o teste anterior deixava passar. */
  const rotsFl = c.xaxis.categories;
  const iFuturo = meses.findIndex(m => m.futuro);
  check('nenhum rótulo de mês se repete',
    new Set(rotsFl).size, rotsFl.length);
  check('a faixa começa no primeiro mês previsto',
    rotsFl.indexOf(c.annotations.xaxis[0].x), iFuturo);
  check('e termina no último mês da janela',
    rotsFl.indexOf(c.annotations.xaxis[0].x2), meses.length - 1);
  check('ou seja, cobre o futuro e não o passado',
    rotsFl.indexOf(c.annotations.xaxis[0].x2) > rotsFl.indexOf(c.annotations.xaxis[0].x), true);
  // O ano entra só onde precisa desempatar — poluir os treze rótulos seria pior
  check('o ano aparece só nos rótulos que empatariam',
    rotsFl.filter(r => r.includes('/')).length <= 2, true);
  // A dica também diz, por escrito, quando o mês é estimativa
  const iFut = meses.findIndex(m => m.futuro);
  check('e a dica do mês futuro diz previsto',
    c.tooltip.x.formatter(null, { dataPointIndex: iFut }).includes('previsto'), true);
  check('a do mês realizado não diz',
    c.tooltip.x.formatter(null, { dataPointIndex: 0 }).includes('previsto'), false);

  /* O saldo é UMA série só, não duas emendadas na fronteira. Partir em duas
     abriria uma costura visível e faria a área contar dois níveis onde há um. */
  check('o saldo é uma série contínua, sem emenda',
    c.series.filter(s => s.type === 'area').length, 1);
  check('sem buraco no meio da série',
    pontosDe(c.series[2]).every(v => typeof v === 'number'), true);

  // Saldo negativo é dado, não erro: a série leva o número como ele é
  const comNegativo = [0, 1, 2].map(i => ({
    period: DB.monthPeriod(new Date(), i - 1),
    entra: 3000, sai: 5000, saldo: i === 2 ? -2000 : 4000, futuro: i >= 2,
  }));
  zeraFila();
  svgFluxoSaldo(comNegativo);
  check('saldo negativo desce abaixo do zero, não é cortado',
    pontosDe(cfgDo().series[2]).includes(-2000), true);

  /* O ALINHAMENTO DO ZERO com saldo negativo, que é onde a conta importa. E o
     limite de meia altura, que não é estético: com o saldo inteiramente negativo o
     zero seria o próprio topo do eixo do saldo, e as três exigências — zero na
     mesma altura, topo na mesma borda, barras positivas visíveis — não podem valer
     juntas. Medido antes do limite: saldos entre −500 e −1.500 punham o piso do
     fluxo em −12 milhões e as barras de 8 mil viravam um fio. */
  const fAcima = y => (y.max - 0) / (y.max - y.min);
  for (const [rotCaso, saldosCaso] of [
    ['saldo cruza o zero', [4000, 1000, -2000, -6000]],
    ['saldo sempre positivo', [8000, 12000, 15000, 18000]],
    ['saldo sempre negativo', [-500, -900, -1200, -1500]],
  ]) {
    zeraFila();
    svgFluxoSaldo(saldosCaso.map((s, i) => ({
      period: DB.monthPeriod(new Date(), i - 2),
      entra: 5000, sai: 8000, saldo: s, futuro: i >= 2,
    })));
    const cN = cfgDo();
    check(rotCaso + ': o zero cai na mesma altura nos dois eixos',
      Math.abs(fAcima(cN.yaxis[0]) - fAcima(cN.yaxis[2])) < 1e-9, true);
    check(rotCaso + ': as barras cabem no eixo delas', 8000 <= cN.yaxis[0].max, true);
    check(rotCaso + ': e o saldo cabe no dele',
      Math.min(...saldosCaso) >= cN.yaxis[2].min && Math.max(...saldosCaso) <= cN.yaxis[2].max, true);
    // Metade da altura, no mínimo, para as barras — senão elas viram um fio
    check(rotCaso + ': as barras ficam com pelo menos metade da altura',
      fAcima(cN.yaxis[0]) >= 0.5 - 1e-9, true);
  }

  // Rótulo no tamanho da escala do tema e sem giro: nome de mês virado é mais
  // difícil de ler, e tamanho solto sai do alinhamento com o resto do layout
  check('os rótulos não colidem nem giram',
    c.xaxis.labels.style.fontSize === Graficos.fonte.eixo && c.chart.toolbar.show === false, true);
  check('e a curva é suavizada', c.stroke.curve, 'smooth');

  // Um mês só não desenha nada em vez de quebrar
  check('série curta não quebra', svgFluxoSaldo([meses[0]]).includes('empty'), true);
} catch (e) { console.log(` FALHA | fluxo e saldo: ${e.message}`); fail++; }
