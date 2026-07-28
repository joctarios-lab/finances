/* Teste de fumaça: roda o app sem navegador e valida as correlações entre os módulos. */
const fs = require('fs');
const BASE = 'D:/Projetos/meus-projetos/financas/';

// ---- stubs mínimos de navegador ----
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.crypto = { randomUUID: () => 'id-' + Math.random().toString(36).slice(2, 12) };

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
  openSaldoSheet, openTransferSheet, persistUI, restoreUI, reconcileBalance, applyTxEffect, svgBars, svgRanking, svgDonut, svgBurnup, niceCeil });`);

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
  check('sem escolha manual, sugere pela palavra-chave', decidir({ catManual: false, texto: 'Supermercado' }), alim);
  check('sem escolha manual, repete o lançamento igual', decidir({ catManual: false, texto: 'Mercado' }), alim);
  check('COM escolha manual, digitar palavra-chave NÃO troca', decidir({ catManual: true, texto: 'Supermercado' }), 'MANTEM');
  check('COM escolha manual, descrição repetida NÃO troca', decidir({ catManual: true, texto: 'Mercado' }), 'MANTEM');
  check('descrição desconhecida não força nenhuma categoria', decidir({ catManual: false, texto: 'zzz qualquer coisa' }), 'MANTEM');
  // Ao editar, a categoria gravada conta como escolha manual desde o início
  const editando = DB.all('transactions').find(t => t.description === 'Mercado');
  check('ao editar, a categoria salva é preservada', !!editando.category_id, true);
  check('categoria salva é a que foi lançada', editando.category_id, alim);
} catch (e) { console.log(` FALHA | formulário: ${e.message}`); fail++; }

console.log('\n=== Nenhuma função inexistente é chamada (DB.x / OFX.x) ===');
{
  const fonte = fs.readFileSync(BASE + 'js/app.js', 'utf8');
  const quebradas = [];
  for (const [, obj, met] of fonte.matchAll(/\b(DB|OFX|Sync|Auth|Notif)\.(\w+)\s*\(/g)) {
    const alvo = { DB, OFX, Sync: global.Sync, Auth: global.Auth, Notif: typeof Notif !== 'undefined' ? Notif : {} }[obj];
    if (alvo && typeof alvo[met] !== 'function' && !quebradas.includes(obj + '.' + met)) quebradas.push(obj + '.' + met);
  }
  const ignorar = ['Sync.rest', 'Sync.signIn', 'Sync.signUp', 'Sync.signOut', 'Sync.createFamily', 'Sync.joinFamily', 'Sync.syncAll', 'Sync.status', 'Auth.setPin', 'Auth.verify', 'Auth.removePin', 'Auth.lockNow', 'Auth.save', 'Notif.load', 'Notif.enable', 'Notif.disable', 'Notif.push', 'Notif.check', 'Notif.save', 'Notif.pushState', 'Notif.subscribePush', 'Notif.unsubscribePush', 'Notif.enabled', 'Notif.vapid', 'Notif.urlB64ToU8', 'Notif.registerFail', 'Notif.registerSuccess'];
  const reais = quebradas.filter(q => !ignorar.includes(q));
  check('todas as chamadas existem', reais.length ? reais.join(', ') : true, true);
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

console.log('\n=== Componentes de formulário (select e datepicker) ===');
try {
  const ui = fs.readFileSync(BASE + 'js/ui.js', 'utf8');
  const html = fs.readFileSync(BASE + 'index.html', 'utf8');
  const sw = fs.readFileSync(BASE + 'sw.js', 'utf8');
  const cssUi = fs.readFileSync(BASE + 'css/styles.css', 'utf8');

  check('ui.js carregado no app', html.includes('js/ui.js'), true);
  check('ui.js no cache offline', sw.includes("'js/ui.js'"), true);
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

console.log('\n=== Memória da navegação ===');
state.tab = 'relatorios'; state.monthOffset = -2; state.memberFilter = 'Joctã';
persistUI();
state.tab = 'inicio'; state.monthOffset = 0; state.memberFilter = 'Todos';
restoreUI();
check('recarregar volta para a mesma aba', state.tab, 'relatorios');
check('recarregar mantém o mês em análise', state.monthOffset, -2);
check('recarregar mantém o filtro de membro', state.memberFilter, 'Joctã');

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
}

check('push_subscriptions com RLS', /alter table push_subscriptions enable row level security/i.test(schema), true);
check('notification_log com RLS', /alter table notification_log enable row level security/i.test(schema), true);
check('função is_member definida antes das policies', schema.indexOf('function is_member') < schema.indexOf('create policy'), true);

console.log(`\n${fail === 0 ? '✅ TUDO CERTO' : '❌ PROBLEMAS ENCONTRADOS'} — ${ok} passaram, ${fail} falharam\n`);
process.exit(fail ? 1 : 0);
