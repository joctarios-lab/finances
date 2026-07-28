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
  state, fmt, fmtShort, esc, txEffect, adjustBalance, topCategoryIds, txHistory, MEMBRO_COMUM,
  openGoalDetail, openAporteSheet, openEntrySheet, openInvoiceDetail, openTxSheet,
  openSaldoSheet, openTransferSheet, persistUI, restoreUI, reconcileBalance, applyTxEffect, svgBars, svgRanking, svgDonut, svgBurnup, niceCeil,
  Voltar, setTab, closeSheet, toast, optionsCategorias, txsFiltradas, filtrosAtivos, openFiltrosSheet, FILTROS_VAZIOS, openCategoriesConfig, openCategoryEditor, openEnvelopeDetail, catLabel });`);

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
  openCategoriesConfig();
  check('cadastro em árvore abre', modal().includes('Categorias'), true);
  check('e mostra as subcategorias recuadas', modal().includes('sub-item'), true);
  check('e oferece criar subcategoria no envelope', modal().includes('data-nova-sub'), true);
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
  check('chips das 3 mais usadas só consideram folhas', /const folhas = DB\.leafCategories\(\)/.test(ap), true);
  check('adivinhação recebe a lista completa (precisa dos pais)', ap.includes('OFX.guessCategoryId(texto, DB.all(\'categories\'))'), true);
  check('extrato mostra o caminho', /esc\(c \? DB\.categoryPath\(t\.category_id\) : 'Sem categoria'\)/.test(ap), true);
  check('CSV exporta o caminho', /DB\.categoryPath\(t\.category_id\), t\.scope/.test(ap), true);
  check('barra de orçamento abre o detalhe', ap.includes('openEnvelopeDetail') && ap.includes('data-envelope='), true);
  check('cadastro de categoria em árvore', ap.includes('openCategoriesConfig') && ap.includes('sub-item'), true);
  check('dá para criar subcategoria dentro do envelope', ap.includes('data-nova-sub'), true);
  check('subcategoria não pede orçamento próprio', /monthly_budget: pai \? 0 :/.test(ap), true);
  check('subcategoria herda âmbito e tipo do envelope', /scope: pai \?[\s\S]{0,120}kind: pai \?/.test(ap), true);
  check('base antiga recebe a oferta de migração', ap.includes('md-sugerir') && ap.includes('DB.sugerirSubcategorias()'), true);

  const nt = fs.readFileSync(BASE + 'supabase/functions/notify/index.ts', 'utf8');
  check('aviso do servidor também soma no envelope', nt.includes('envelopeDe(t.category_id)'), true);
  check('aviso do servidor não repete o limite da filha', /if \(c\.parent_id\) continue;/.test(nt), true);
  check('servidor busca parent_id', nt.includes("select('id,name,icon,monthly_budget,parent_id')"), true);

  const cssS = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('subcategoria recuada na lista', /\.sub-item \{[^}]*margin-left/.test(cssS), true);
}

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
} catch (e) { console.log(` FALHA | componentes: ${e.message}`); fail++; }

console.log('\n=== Semântica de cor por tipo de ação ===');
try {
  const ext = renderExtrato(p);
  check('atalhos coloridos de lançamento no extrato', ext.includes('qa-desp') && ext.includes('qa-rec') && ext.includes('qa-tr'), true);
  check('receita marcada em verde', ext.includes('tx-amount income'), true);
  check('despesa mostra sinal de saída', ext.includes('− '), true);
  const css = fs.readFileSync(BASE + 'css/styles.css', 'utf8');
  check('vermelho reservado para despesa', /\.chip\[data-v="Despesa"\]\.active[^}]*var\(--red\)/.test(css), true);
  check('verde reservado para receita', /\.chip\[data-v="Receita"\]\.active[^}]*var\(--green\)/.test(css), true);
  check('azul reservado para transferência', /\.chip\[data-v="Transferência"\]\.active[^}]*var\(--blue\)/.test(css), true);
  check('folha veste a cor do tipo escolhido', css.includes('.sheet[data-tipo="Receita"] #sh-save'), true);
  check('animações respeitam prefers-reduced-motion', css.includes('prefers-reduced-motion'), true);
  check('cor nunca vem sozinha (ícone + texto no atalho)', ext.includes('>Despesa<') && ext.includes('data-ico="plus"'), true);
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

  /* Reaproveitar etiqueta: lançar gasto de viagem é em série, e redigitar a mesma
     etiqueta dez vezes é o que se quer evitar. */
  console.log('\n=== Reaproveitar etiquetas ===');
  const folhaDe = abrir => { abrir(); return els['#sheet'].innerHTML; };

  check('herda as etiquetas do último lançamento', DB.tagsRecentes().sort().join(','), 'lazer,viagem');

  // No formulário de um lançamento novo elas já vêm ligadas
  const novo = folhaDe(() => openTxSheet(null));
  check('lançamento novo já vem com a etiqueta ligada', /chip-tag active" data-v="viagem"/.test(novo), true);
  check('e diz de onde ela veio', novo.includes('repetidas do lançamento anterior'), true);
  check('campo de etiqueta tem autocomplete', novo.includes('list="tag-hist"') && novo.includes('<datalist id="tag-hist"'), true);
  check('tocar no chip apaga o aviso de herança', /chip-tag'\)\.forEach[\s\S]{0,200}tag-auto/.test(fs.readFileSync(BASE + 'js/app.js', 'utf8')), true);

  // Ao editar, vale o que está salvo — não se inventa etiqueta que o lançamento não tem
  const semTags = DB.all('transactions').find(t => t.description === 'Mercado');
  check('o lançamento de referência não tem etiqueta', DB.tagsOf(semTags).length, 0);
  const editando = folhaDe(() => openTxSheet(semTags));
  check('editar não inventa etiqueta', /chip-tag active/.test(editando), false);

  // Etiqueta de uma viagem de março não pode reaparecer em maio: envelhece a base
  // toda para que o mais recente também esteja fora da janela.
  const idades = DB.all('transactions').map(t => [t, t.updated_at]);
  for (const [t] of idades) t.updated_at = new Date(Date.now() - 40 * 3600000).toISOString();
  check('fora da janela, não herda nada', DB.tagsRecentes(24).length, 0);
  check('com janela maior, volta a herdar', DB.tagsRecentes(48).length > 0, true);
  for (const [t, orig] of idades) t.updated_at = orig;
  check('a base volta ao estado anterior', DB.tagsRecentes().sort().join(','), 'lazer,viagem');

  // Salvar sem etiqueta encerra a sequência sozinho, sem estado guardado
  const semTag = DB.upsert('transactions', { description: 'Padaria da esquina', amount: 12, date: dia(18), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Dinheiro', account_id: contaT, tags: [] });
  check('lançamento sem etiqueta encerra a herança', DB.tagsRecentes().length, 0);
  DB.remove('transactions', semTag);

  // OFX: uma etiqueta para o lote, não um campo por linha
  const ap2 = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  check('importação tem etiqueta para o lote', ap2.includes('id="ofx-tags"'), true);
  check('com autocomplete também', ap2.includes('list="tag-hist-ofx"'), true);
  check('e aplica em todas as linhas importadas', /tags: tagsDoLote\(\)/.test(ap2), true);
  check('não há um campo de etiqueta por linha', /ofx-row[\s\S]{0,400}ofx-tag-linha/.test(ap2), false);

  console.log('\n=== Painel de filtros do extrato ===');
  const p2 = DB.monthPeriod(new Date());
  const zerar = () => { state.filtros = { ...FILTROS_VAZIOS }; };
  const qtd = () => txsFiltradas(p2).length;

  zerar();
  const totalPeriodo = qtd();
  check('sem filtro, traz tudo do período', totalPeriodo > 5, true);

  zerar(); state.filtros.tag = 'viagem';
  check('filtra por etiqueta', qtd(), 2);
  zerar(); state.filtros.tipo = 'Receita';
  check('filtra por tipo', txsFiltradas(p2).every(t => !DB.isExpense(t)), true);
  zerar(); state.filtros.situacao = 'A Pagar';
  check('filtra por situação', txsFiltradas(p2).every(t => t.status === 'A Pagar'), true);
  zerar(); state.filtros.scope = 'Pessoal';
  check('filtra por âmbito', txsFiltradas(p2).every(t => t.scope === 'Pessoal'), true);
  zerar(); state.filtros.membro = 'Joctã';
  check('filtra por membro', txsFiltradas(p2).every(t => t.member === 'Joctã'), true);
  zerar(); state.filtros.metodo = 'PIX';
  check('filtra por forma de pagamento', txsFiltradas(p2).every(t => t.method === 'PIX'), true);
  zerar(); state.filtros.valorMin = 800;
  check('filtra por valor mínimo', txsFiltradas(p2).every(t => t.amount >= 800), true);
  zerar(); state.filtros.valorMax = 100;
  check('filtra por valor máximo', txsFiltradas(p2).every(t => t.amount <= 100), true);
  zerar(); state.filtros.conta = contaT;
  check('filtra por conta', txsFiltradas(p2).every(t => t.account_id === contaT || t.card_id === contaT || t.to_account === contaT), true);

  // Categoria filtra pelo envelope, então subcategoria entra junto
  DB.upsert('transactions', { description: 'Feira', amount: 70, date: dia(17), type: 'Despesa', status: 'Pago', scope: 'Família', member: MEMBRO_COMUM, method: 'Débito', account_id: contaT, category_id: mercado.id });
  zerar(); state.filtros.categoria = alim.id;
  const porEnvelope = txsFiltradas(p2);
  check('filtrar envelope traz as subcategorias', porEnvelope.some(t => t.category_id === mercado.id), true);
  zerar(); state.filtros.categoria = mercado.id;
  check('filtrar subcategoria também sobe ao envelope', txsFiltradas(p2).length, porEnvelope.length);

  // Busca sem acento, em vários campos
  zerar(); state.filtros.busca = 'pousada';
  check('busca pela descrição', qtd(), 1);
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
  zerar(); state.filtros.tag = 'viagem'; state.filtros.valorMin = 700;
  check('filtros se somam', qtd(), 1);

  // Etiquetas do que está ativo
  zerar();
  check('sem filtro, nenhuma etiqueta ativa', filtrosAtivos().length, 0);
  state.filtros.tag = 'viagem'; state.filtros.scope = 'Família'; state.filtros.busca = 'x';
  const rot = filtrosAtivos();
  check('cada filtro ativo gera uma etiqueta', rot.length, 3);
  check('a etiqueta mostra o nome legível', rot.some(r => r.texto === '#viagem'), true);
  check('cada etiqueta sabe qual filtro limpar', rot.every(r => r.chave in FILTROS_VAZIOS), true);

  // A tela: só busca e âmbito ficam fora do painel
  zerar();
  const ext = renderExtrato(p2);
  check('busca fica na tela', ext.includes('id="tx-search"'), true);
  check('âmbito fica na tela', ext.includes('id="scope-chips"'), true);
  check('botão de filtros fica na tela', ext.includes('id="btn-filtros"'), true);
  check('chips de membro saíram da tela', ext.includes('id="member-chips"'), false);
  state.filtros.tag = 'viagem';
  const comFiltro = renderExtrato(p2);
  check('contador aparece no botão', /filtros-num">1</.test(comFiltro), true);
  check('etiqueta removível aparece', comFiltro.includes('data-limpa="tag"'), true);
  check('há como limpar tudo', comFiltro.includes('id="limpar-filtros"'), true);
  check('etiquetas do lançamento aparecem na linha', comFiltro.includes('data-tag="viagem"'), true);

  // Vazio por filtro tem de se distinguir de vazio de verdade
  zerar(); state.filtros.busca = 'zzzz';
  const vazio = renderExtrato(p2);
  check('vazio por filtro explica o motivo', vazio.includes('Nenhum lançamento com esses filtros'), true);
  check('e oferece limpar', vazio.includes('id="limpar-vazio"'), true);

  // O painel abre com os controles todos
  zerar();
  openFiltrosSheet();
  const folha = els['#sheet'].innerHTML;
  for (const campo of ['fl-tipo', 'fl-sit', 'fl-scope', 'fl-membro', 'fl-cat', 'fl-tag', 'fl-metodo', 'fl-conta', 'fl-min', 'fl-max', 'fl-rec']) {
    check(`painel tem ${campo}`, folha.includes(campo), true);
  }
  check('painel oferece limpar tudo', folha.includes('fl-limpar'), true);
  zerar();
} catch (e) { console.log(` FALHA | etiquetas/filtros: ${e.message}`); fail++; }

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
  check('seletor de categoria ocupa a linha inteira', /\.ofx-cat \{[^}]*grid-column: 2 \/ -1/.test(cssT), true);
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
  state.monthOffset = -3; state.filtros.membro = 'Joctã'; state.filtros.situacao = 'A Pagar'; state.filtros.busca = 'mer';
  setTab('cartoes');
  check('trocar de tela zera o mês', state.monthOffset, 0);
  check('trocar de tela zera o filtro de membro', state.filtros.membro, 'Todos');
  check('trocar de tela zera o filtro de situação', state.filtros.situacao, 'Todos');
  check('trocar de tela zera a busca', state.filtros.busca, '');
  setTab('inicio');
  state.monthOffset = -5;
  setTab('extrato'); setTab('inicio');
  check('voltar ao painel mostra o mês corrente', state.monthOffset, 0);

  // Redesenho da MESMA tela não pode perder o que está sendo olhado
  setTab('extrato');
  state.monthOffset = -2; state.filtros.membro = 'Joctã';
  setTab('extrato');                       // é o que a sincronização faz ao trazer dado novo
  check('redesenhar a mesma tela preserva o mês', state.monthOffset, -2);
  check('redesenhar a mesma tela preserva o filtro', state.filtros.membro, 'Joctã');

  // Reabrir o app: lembra a aba, esquece mês e filtros
  state.tab = 'relatorios'; state.monthOffset = -4; state.filtros.membro = 'Joctã'; state.repOffset = -1;
  persistUI();
  restoreUI();
  check('reabrir volta para a mesma aba', state.tab, 'relatorios');
  check('reabrir mostra o mês corrente', state.monthOffset, 0);
  check('reabrir esquece o filtro de membro', state.filtros.membro, 'Todos');
  check('reabrir esquece o mês do relatório', state.repOffset, 0);

  const gravado = JSON.parse(store['financas.ui.v1']);
  check('só a aba é gravada', Object.keys(gravado).join(','), 'tab');
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
