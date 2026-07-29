/* Teste de fumaça: roda o app sem navegador e valida as correlações entre os módulos. */
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
const appSrc = fs.readFileSync(BASE + 'js/app.js', 'utf8').split('/* ---------- Boot ---------- */')[0];
eval(appSrc + `; Object.assign(global, {
  renderInicio, renderExtrato, renderCartoes, renderMetas, renderRelatorios,
  state, fmt, fmtShort, fmtSemMoeda, fmtDay, esc, txEffect, adjustBalance, topCategoryIds, txHistory, MEMBRO_COMUM,
  openGoalDetail, openAporteSheet, openEntrySheet, openInvoiceDetail, openTxSheet,
  openSaldoSheet, openTransferSheet, persistUI, restoreUI, reconcileBalance, applyTxEffect, svgBars, svgRanking, svgDonut, svgBurnup, niceCeil,
  Voltar, setTab, closeSheet, toast, optionsCategorias, txsFiltradas, efeitoDaTransferencia, fixarTags, lerTagsFixas, filtrosAtivos, FILTROS_VAZIOS, filtrosVazios, somarDias, bindView, fmt,
  diasDoPeriodo, reguaDoMes, pilulasDeFiltro, rotuloPilula, ligarRegua, ligarPilulas, resumoExtrato,
  serieDeSaldo, sparkArea, sparkCols, ligarGrafico,
  Massa, openMassaModal, renderMassa, closeModal, openModal, aplicarNaLinha, trocarTipo, linhaEditavel, openMassaEditSheet, aplicarMassa, excluirMassa, desfazerMassa,
  efeitoNasContas, aplicarTags, massaAceita, confirmarMassa, openCategoriesConfig, openCategoryEditor, openEnvelopeDetail, catLabel });`);

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
check('comprometido = fatura aberta + A Pagar', DB.committed(), 200 + 450);
check('total em contas', DB.accountsTotal(), 17000);
check('disponível = contas - comprometido', DB.available(), 17000 - 650);
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

console.log('\n=== Painel mostra os números certos ===');
const inicio = renderInicio(p);
for (const [rotulo, valor] of [['disponível', fmt(16350)], ['gasto do mês', fmtShort(1550)], ['comprometido', fmtShort(650)]]) {
  check(`painel exibe ${rotulo} (${valor})`, inicio.includes(valor), true);
}

/* ---- Fluxos reais: aportes, detalhe da meta e da fatura ---- */
/* ---- Compra parcelada (fluxo real, do clique às parcelas) ----
   Nunca teve teste, e por isso a descrição das parcelas ficou meses gravando
   "[object HTMLInputElement] (1/12)": o código usava o ELEMENTO do campo em vez
   do texto dele. Quebrava busca, extrato e "repetir custos fixos". */
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
  for (const t of parcelas) DB.remove('transactions', t.id);
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
  const subLazer = DB.subcategoriesOf(lazer.id)[0];
  const kindAntes = DB.spentByKind(p).Estilo;
  DB.upsert('transactions', { description: 'Cinema sábado', amount: 60, date: dia(14), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: conta, category_id: subLazer.id });
  check('subcategoria herda necessidade/desejo do envelope', DB.spentByKind(p).Estilo, kindAntes + 60);

  // Nomes repetidos entre envelopes: o caminho é o que desfaz a ambiguidade
  const comManutencao = DB.all('categories').filter(c => c.parent_id && c.name === 'Manutenção');
  check('nome de folha pode repetir entre envelopes', comManutencao.length >= 2, true);
  check('e os caminhos ficam diferentes',
    new Set(comManutencao.map(c => DB.categoryPath(c.id))).size, comManutencao.length);

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
  check('a aba de saídas não mistura entradas', /Alimenta/.test(fechado) && !/Empréstimos/.test(fechado), true);
  openCategoriesConfig({ lado: 'Receita' });
  const entradas = modal();
  check('a aba de entradas mostra as origens', /Empréstimos/.test(entradas), true);
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
  openEnvelopeDetail(alimento.id);
  check('detalhe do envelope abre com o ranking', els['#sheet'].innerHTML.includes('rank-row'), true);
  check('e nomeia as subcategorias gastas', els['#sheet'].innerHTML.includes('Mercado'), true);

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
  check('subcategoria não pede orçamento próprio', /monthly_budget: semEnvelope \? 0 :/.test(ap), true);
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
  check('folha de aporte da reserva abre', el('#sheet').innerHTML.includes('Registrar aporte'), true);
  el('#a-amount').dataset.cents = '100000';
  el('#a-desc').value = 'Guardado do mês';
  el('#a-date').value = dia(11);
  el('#a-account').value = ''; el('#a-to').value = '';
  el('#sh-save').click();
  check('aporte pelo painel soma na reserva', DB.reserveTotal(), 5000);

  const meses = DB.avgMonthlySpend() > 0 ? DB.reserveTotal() / DB.avgMonthlySpend() : 0;
  check('cobertura em meses é calculada', meses > 0, true);
  check('painel mostra o card da reserva', renderInicio(p).includes('Reserva de emergência'), true);

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
  check('não entra no comprometido', DB.committed(), 650);

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
  const barras = svgBars([{ label: 'jan', value: 100 }, { label: 'fev', value: 250, hint: '#009ef7' }], 300);
  check('barras: SVG válido com grade e rótulos', barras.startsWith('<svg') && barras.includes('ch-grid') && barras.includes('fev'), true);
  check('barras: linha de renda desenhada', barras.includes('ch-ref-line'), true);
  check('escala arredonda para número redondo', niceCeil(2340), 2500);
  check('escala funciona com valores pequenos', niceCeil(37), 40);

  const d = svgDonut([{ label: 'Casa', value: 60, color: '#009ef7' }, { label: 'Comida', value: 40, color: '#50cd89' }], 100);
  check('donut: dois arcos desenhados', (d.match(/<circle/g) || []).length, 3);   // 2 fatias + trilho
  check('donut: mostra o total no centro', d.includes('dn-total'), true);
  check('donut: legenda acessível por title', d.includes('Casa: '), true);

  const r = svgRanking([['Mercado', 800], ['Uber', 200]]);
  check('ranking: barras proporcionais', r.includes('width:100.0%') && r.includes('rank-row'), true);
  check('ranking: mostra percentual do total', r.includes('80%'), true);
  check('ranking vazio não quebra', svgRanking([]).includes('Sem dados'), true);

  const burn = svgBurnup(p, 3000);
  check('burn-up: área e linha desenhadas', burn.includes('gArea') && burn.includes('<path'), true);
  check('painel usa o donut novo', renderInicio(p).includes('donut-svg'), true);
  check('relatórios trazem os gráficos novos', renderRelatorios().includes('rank-row') && renderRelatorios().includes('donut-svg'), true);
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
  check('estado da sincronização visível no botão', a.includes('Sync.onState') && /#btn-sync\[data-estado/.test(fs.readFileSync(BASE + 'css/styles.css', 'utf8')), true);
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
  check('SVG usa a paleta do app', svg.includes('#0095e8') && svg.includes('#7239ea'), true);
  check('conceito documentado no próprio arquivo', /<desc>[\s\S]*lar[\s\S]*<\/desc>/i.test(svg), true);
  check('acessível para leitores de tela', svg.includes('role="img"') && svg.includes('aria-label'), true);
  check('telhado e três colunas', (svg.match(/<rect x=/g) || []).length === 3 && svg.includes('L256 100'), true);
  check('nada do ícone antigo (F$ em serifa)', !svg.includes('Georgia') && !svg.includes('F$'), true);
  check('traço grosso o bastante para 32px', /stroke-width="4\d"/.test(svg), true);
  for (const f of ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png']) {
    check(`${f} existe`, fs.existsSync(BASE + f), true);
  }
  check('maskable declarado à parte no manifest', mf.icons.some(i => i.purpose === 'maskable'), true);
  check('maskable tem zona de segurança', /New-Icone 512 .*maskable.* 0\.7/.test(fs.readFileSync(BASE + 'icons/gerar-icones.ps1', 'utf8')), true);
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
  check('calendário tem largura própria', /\.ui-cal\s*\{[^}]*min-width:\s*300px/.test(cssUi), true);
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
  check('e leva aos lançamentos dela', rel.includes('data-ver-tag="viagem"'), true);

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
  // O saldo anterior agora é o ponto de partida da linha, escrito no pé dela
  const antes = html => (html.match(/res-pe[\s\S]*?de <b>([^<]+)</) || [])[1];
  check('o saldo anterior muda com o recorte', antes(extMes) !== antes(extMetade), true);
  check('e é o saldo real na data de início do recorte',
    antes(extMetade), fmtSemMoeda(DB.saldoNaData(null, dias[meio + 1])));
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
    recolhido.includes('spark-area') && recolhido.includes('res-rot'), true);
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
  check('o resumo virou cartão com gráfico', cabecalho.includes('class="card res'), true);
  check('nem voltou o grid de quatro cartões', cabecalho.includes('stat-2x2'), false);
  check('o saldo tem área de evolução', cabecalho.includes('class="spark-area"'), true);
  check('entrou e saiu têm colunas', (cabecalho.match(/class="spark-cols /g) || []).length, 2);
  /* Saldo anterior NÃO virou gráfico: é uma constante, e sparkline em constante
     é decoração. Ele é o ponto de partida da linha, e aparece escrito no pé. */
  check('o saldo anterior aparece como ponto de partida', /res-pe[\s\S]*?de <b>/.test(cabecalho), true);
  check('e não ganhou gráfico próprio', (cabecalho.match(/spark-area/g) || []).length, 1);
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
  // Traço de 2px que não engorda quando o SVG é esticado na largura
  check('a linha não engorda ao esticar',
    /\.spark-linha \{[^}]*vector-effect: non-scaling-stroke/.test(cssF), true);
  // Lavagem, nunca bloco saturado
  check('a área é lavagem, não bloco', /\.spark-fill \{ fill: rgba\(0, 158, 247, \.1\)/.test(cssF), true);
  check('as colunas partem do zero', /const h = Math\.max\(1\.5, \(v \/ max\) \* H\)/.test(apF), true);

  /* O INVARIANTE do gráfico: a ponta da série tem de bater com o saldo escrito
     ao lado dela. Um gráfico que termina num número diferente do número que o
     acompanha é pior que gráfico nenhum. */
  const pSerie = DB.monthPeriod(new Date());
  const diasS = diasDoPeriodo(pSerie);
  const anteriorS = DB.saldoNaData(null, DB.inicioISO(pSerie));
  const serieS = serieDeSaldo(null, diasS, anteriorS);
  check('a série cobre todos os dias do período', serieS.length, diasS.length);
  check('e termina no mesmo saldo que o cartão mostra',
    Math.round(serieS[serieS.length - 1] * 100) / 100,
    Math.round(DB.saldoNaData(null, DB.fimISO(pSerie)) * 100) / 100);
  /* Um passe só sobre os lançamentos, não uma varredura por dia: com 31 dias,
     chamar saldoNaData por dia percorreria a base inteira 31 vezes. */
  const corpoSerie = apF.slice(apF.indexOf('function serieDeSaldo'), apF.indexOf('function sparkArea'));
  check('a série não chama saldoNaData por dia', corpoSerie.includes('saldoNaData'), false);
  // Conciliação conta no saldo, como em saldoNaData — senão as pontas divergem
  check('a série segue as mesmas regras do saldo', corpoSerie.includes("t.status !== 'Pago'"), true);

  // Um único dia de recorte não pode gerar SVG quebrado
  check('série de um dia não desenha área', sparkArea([500]), '');
  check('duas medidas já desenham', sparkArea([500, 600]).includes('spark-linha'), true);
  // Régua do zero só quando a série realmente cruza o zero
  check('série toda positiva não desenha o zero', sparkArea([100, 200]).includes('spark-zero'), false);
  check('série que cruza o zero ganha a régua', sparkArea([-100, 200]).includes('spark-zero'), true);
  check('colunas sem movimento nenhum não quebram', sparkCols([0, 0, 0], 'c-ok').includes('<svg'), true);
  check('KPIs do painel também', !/kpi-value[^"]*">\$\{fmtShort\(/.test(apF), true);
  check('e o hero do painel', /<small>Em contas<\/small><b>\$\{fmt\(/.test(apF), true);

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
  check('o extrato mostra o saldo anterior', /res-pe[\s\S]*?de <b>/.test(tela), true);
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
  const totalSaiu = (comConc.match(/<small>(?:saiu|despesas)<\/small>\s*<b class="txt-red">([^<]*)</) || [])[1];
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
  check('a visão geral mostra o saldo anterior', /res-pe[\s\S]*?de <b>/.test(telaGeral), true);
  check('e explica o que sobrou ou faltou', /Sobrou <b|Faltou <b/.test(telaGeral), true);

  for (const t of DB.all('transactions').filter(t => /passado$|atual$|futuro$/.test(t.description))) DB.remove('transactions', t.id);
  DB.remove('accounts', cM);
  state.filtros = filtrosVazios();
} catch (e) { console.log(` FALHA | saldo entre meses: ${e.message}`); fail++; }

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
  check('o topo mostra o que saiu da conta', saida.includes('<small>saiu</small>'), true);
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
  const dim = (cssA.match(/--paper-dim: (#[0-9a-f]{6})/i) || [])[1];
  check('texto secundário passa no AA', contraste(dim, '#ffffff') >= 4.5, true);
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
  check('barra de abas sai de cena', /body\.teclado-aberto \.tabbar \{ display: none/.test(cssK), true);
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
  for (const sel of ['.tx-name', '.tx-meta', '.ofx-main b', '.legend-name', '.rank-name']) {
    const r = regra(sel);
    check(`${sel}: existe no CSS`, r.length > 0, true);
    check(`${sel}: não corta com reticências`, /text-overflow/.test(r), false);
    check(`${sel}: pode quebrar linha`, /nowrap/.test(r), false);
    check(`${sel}: quebra palavra sem espaço`, /overflow-wrap:\s*anywhere/.test(r), true);
  }
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

  // O lote é o filtro; o botão só aparece quando há o que editar
  state.filtros = filtrosVazios();
  check('o extrato oferece editar em massa', renderExtrato(pM).includes('id="btn-massa"'), true);
  state.filtros.busca = 'zzzznada';
  check('sem lançamento, não oferece', renderExtrato(pM).includes('id="btn-massa"'), false);
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
  check('todo campo do formulário tem interruptor',
    ['type', 'category_id', 'tags', 'status', 'scope', 'member', 'method', 'account_id', 'recurring', 'notes']
      .every(c => formM.includes(`data-liga="${c}"`)), true);
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
  check('trocar de tela zera o mês', state.monthOffset, 0);
  check('trocar de tela zera o filtro de membro', state.filtros.membro.length, 0);
  check('trocar de tela zera o filtro de situação', state.filtros.situacao.length, 0);
  check('trocar de tela zera a busca', state.filtros.busca, '');
  setTab('inicio');
  state.monthOffset = -5;
  setTab('extrato'); setTab('inicio');
  check('voltar ao painel mostra o mês corrente', state.monthOffset, 0);

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
  check('o Painel é fixado ao abrir', /function restoreUI\(\)[\s\S]{0,400}state\.tab = 'inicio';/.test(apA), true);
  const ap = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('não grava mais a cada rolagem', /addEventListener\('scroll'[\s\S]{0,120}persistUI/.test(ap), false);
  check('volta ao topo ao trocar de tela', /if \(trocou\) \{[\s\S]{0,140}scrollTo\(0, 0\)/.test(ap), true);
  setTab('inicio');
}

/* ---- O banco do Supabase aceita tudo o que o app envia? ---- */
console.log('\n=== Schema do Supabase x payload do app ===');
const schema = fs.readFileSync(BASE + 'supabase/schema.sql', 'utf8');
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
      check('mapa de colunas foi lido', Object.keys(mapa).length > 20, true);

      const equivale = { uuid: 'uuid', num: 'numeric', int: 'int', date: 'date', bool: 'boolean', json: 'jsonb', ts: 'timestamptz', text: 'text' };
      const divergencias = [];
      for (const [tabela, cols] of Object.entries(SYNC)) {
        for (const col of [...cols, 'id', 'family_id', 'updated_at', 'deleted']) {
          const real = esquema[tabela] && esquema[tabela][col];
          if (!real) continue;
          const decl = mapa[col] || { tipo: 'text', marca: '' };
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
    check('só marca pronto quando o pull inteiro deu certo',
      /if \(!falhas\.length\) \{ DB\.data\.meta\.lastSync = DB\.now\(\); this\.pronto = true; \}/.test(fs.readFileSync(BASE + 'js/sync.js', 'utf8')), true);
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
  check('configurações têm a opção de apagar', apW.includes(`data-go="reset"`) && apW.includes(`sec === 'reset'`), true);
  check('a tela explica por que o Android não resolve', /WebAPK|é um atalho|é só um atalho/.test(apW), true);
  check('apagar exige digitar a confirmação', /rs-conf[\s\S]{0,900}!== 'APAGAR'/.test(apW), true);
  check('oferece backup antes de apagar', apW.includes('rs-export'), true);
  check('avisa que a nuvem não é afetada', apW.includes('a nuvem não é afetada'), true);

  DB.data = dadosAntes;   // devolve o cenário caso mais algo rode depois
  for (const k of Object.keys(store)) delete store[k];
  Object.assign(store, storeAntes);

  console.log(`\n${fail === 0 ? '✅ TUDO CERTO' : '❌ PROBLEMAS ENCONTRADOS'} — ${ok} passaram, ${fail} falharam\n`);
  process.exit(fail ? 1 : 0);
})();
