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
  openSaldoSheet, openTransferSheet, persistUI, restoreUI, reconcileBalance, applyTxEffect, svgBars, svgRanking, svgDonut, svgBurnup, niceCeil,
  Voltar, setTab, closeSheet, toast });`);

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
  const ignorar = ['Auth.fluxoPin', 'Auth.pinPad', 'Auth.hide', 'Sync.startAuto', 'Auth.bioAtiva', 'Auth.ativarBio', 'Auth.desativarBio', 'Auth.desbloquearComBio', 'Auth.bioSuportadaNoAparelho', 'Sync.rest', 'Sync.signIn', 'Sync.signUp', 'Sync.signOut', 'Sync.createFamily', 'Sync.joinFamily', 'Sync.syncAll', 'Sync.status', 'Auth.setPin', 'Auth.verify', 'Auth.removePin', 'Auth.lockNow', 'Auth.save', 'Notif.load', 'Notif.enable', 'Notif.disable', 'Notif.push', 'Notif.check', 'Notif.save', 'Notif.pushState', 'Notif.subscribePush', 'Notif.unsubscribePush', 'Notif.enabled', 'Notif.vapid', 'Notif.urlB64ToU8', 'Notif.registerFail', 'Notif.registerSuccess'];
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
