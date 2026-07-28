/* Finanças da Família — UI e fluxo do app */
'use strict';

Sync.load();   // DB.load() acontece dentro de Auth.init(), que decifra os dados quando há PIN

const METHODS = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
const MEMBRO_COMUM = 'Comum / Família';   // usado sempre que o âmbito é Família
const PALETTE = ['#009ef7', '#50cd89', '#7239ea', '#f1416c', '#ffc700', '#43ced7', '#fd7e14', '#8950fc', '#1bc5bd', '#6c7293'];

let state = { tab: 'inicio', monthOffset: 0, filter: 'Todos', memberFilter: 'Todos', repOffset: 0 };

/* ---------- Memória da navegação: recarregar volta para onde você estava ---------- */
const UI_KEY = 'financas.ui.v1';
const TABS = ['inicio', 'extrato', 'cartoes', 'metas', 'relatorios'];
const TITULOS = {
  inicio: 'Painel', extrato: 'Extrato', cartoes: 'Cartões & Contas',
  metas: 'Metas', relatorios: 'Relatórios',
};

function persistUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({
      tab: state.tab, monthOffset: state.monthOffset, filter: state.filter,
      memberFilter: state.memberFilter, repOffset: state.repOffset,
      scrollY: Math.round(window.scrollY || 0),
    }));
  } catch (_) {}
}

function restoreUI() {
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY));
    if (!s) return;
    if (TABS.includes(s.tab)) state.tab = s.tab;
    state.monthOffset = Number(s.monthOffset) || 0;
    state.filter = s.filter || 'Todos';
    state.memberFilter = s.memberFilter || 'Todos';
    state.repOffset = Number(s.repOffset) || 0;
    state._scrollY = Number(s.scrollY) || 0;
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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.hidden = true; }, 2200);
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
  if (!t || t.status !== 'Pago' || !t.account_id || t.card_id) return 0;
  const v = Number(t.amount) || 0;
  return DB.isExpense(t) ? -v : v;   // despesa debita, receita credita
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
function catLabel(id) { const c = catOf(id); return c ? `${c.icon} ${c.name}` : 'Sem categoria'; }

/* ---------- Navegação ---------- */
function setTab(tab) {
  state.tab = tab;
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
  $('#view').innerHTML = views[state.tab](period);
  paintIcons($('#view'));
  bindView();
  persistUI();
  if (state._scrollY) {   // primeira renderização após recarregar: volta ao ponto de leitura
    const y = state._scrollY;
    delete state._scrollY;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

/* ---------- Gráficos SVG (sem bibliotecas, funcionam offline) ---------- */
// Barras verticais com rótulos: series = [{label, value, hint?}], refLine opcional (ex: renda).
function svgBars(series, refLine) {
  const W = 560, H = 190, padB = 26, padT = 18;
  const max = Math.max(refLine || 0, ...series.map(s => s.value), 1) * 1.08;
  const bw = W / series.length;
  let bars = '', labels = '';
  series.forEach((s, i) => {
    const h = Math.max(2, (s.value / max) * (H - padB - padT));
    const x = i * bw + bw * 0.18, y = H - padB - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="${s.hint || '#009ef7'}" opacity="0.9"/>`;
    if (s.value > 0) bars += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="ch-val">${fmtShort(s.value).replace(/ /g, ' ')}</text>`;
    labels += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ch-lbl">${esc(s.label)}</text>`;
  });
  let ref = '';
  if (refLine > 0) {
    const ry = H - padB - (refLine / max) * (H - padB - padT);
    ref = `<line x1="0" x2="${W}" y1="${ry.toFixed(1)}" y2="${ry.toFixed(1)}" stroke="#f1416c" stroke-dasharray="5 4" stroke-width="1.5"/>
           <text x="${W - 4}" y="${(ry - 5).toFixed(1)}" text-anchor="end" class="ch-ref">renda</text>`;
  }
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${ref}${bars}${labels}</svg>`;
}

// Burn-up do mês: gasto acumulado dia a dia vs. linha ideal do orçamento/renda.
function svgBurnup(period, refLimit) {
  const W = 560, H = 170, padB = 20, padT = 12;
  const total = DB.periodDays(period), elapsed = DB.elapsedDays(period);
  const daily = new Array(total).fill(0);
  for (const t of DB.expensesOf(period)) {
    const idx = Math.min(total - 1, Math.max(0, Math.floor((new Date(t.date + 'T12:00:00') - period.start) / 86400000)));
    daily[idx] += Number(t.amount) || 0;
  }
  let acc = 0;
  const cum = daily.map(v => (acc += v));
  const spentNow = elapsed > 0 ? cum[Math.max(0, elapsed - 1)] : 0;
  const max = Math.max(refLimit || 0, cum[total - 1], spentNow, 1) * 1.1;
  const X = i => (i / (total - 1)) * W;
  const Y = v => H - padB - (v / max) * (H - padB - padT);
  let path = '';
  for (let i = 0; i < Math.max(1, elapsed); i++) path += `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(cum[i]).toFixed(1)}`;
  let ideal = '';
  if (refLimit > 0) ideal = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(total - 1)}" y2="${Y(refLimit).toFixed(1)}" stroke="#7e8299" stroke-dasharray="5 4" stroke-width="1.5"/>`;
  const dotX = X(Math.max(0, elapsed - 1)), dotY = Y(spentNow);
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    ${ideal}
    <path d="${path}" fill="none" stroke="#009ef7" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${dotX.toFixed(1)}" cy="${dotY.toFixed(1)}" r="4" fill="#009ef7"/>
    <text x="${Math.min(W - 4, dotX + 8).toFixed(1)}" y="${Math.max(12, dotY - 8).toFixed(1)}" class="ch-val" text-anchor="${dotX > W - 90 ? 'end' : 'start'}">${fmtShort(spentNow).replace(/ /g, ' ')}</text>
    <text x="4" y="${H - 6}" class="ch-lbl">dia 1</text>
    <text x="${W - 4}" y="${H - 6}" text-anchor="end" class="ch-lbl">dia ${total}</text>
  </svg>`;
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
  const budgetTotal = DB.all('categories').reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0);
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
    let acc = 0; const stops = [];
    entries.forEach(([cid, v], i) => {
      const from = acc / total * 360; acc += v;
      const to = acc / total * 360;
      const color = PALETTE[i % PALETTE.length];
      stops.push(`${color} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`);
      if (i < 6) legend += `<div class="legend-row"><i class="legend-dot" style="background:${color}"></i>
        <span class="legend-name">${esc(catLabel(cid === '_sem' ? null : cid))}</span>
        <span class="legend-val">${fmtShort(v)}</span></div>`;
    });
    donut = `<div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(${stops.join(',')})">
        <div class="donut-center"><b>${fmtShort(total)}</b><span>no mês</span></div>
      </div>
      <div class="legend">${legend}</div>
    </div>`;
  } else {
    donut = `<div class="empty"><b>Nenhum gasto no período</b>Toque no ＋ para lançar o primeiro.</div>`;
  }

  // Barras de orçamento (gasto do período vs orçamento mensal)
  let budgets = '';
  for (const c of DB.all('categories').sort((a, b) => (byCat[b.id] || 0) - (byCat[a.id] || 0))) {
    const spent = byCat[c.id] || 0;
    if (!c.monthly_budget && !spent) continue;
    const pct = c.monthly_budget > 0 ? Math.round(spent / c.monthly_budget * 100) : 0;
    budgets += `<div class="budget-row">
      <div class="budget-head"><b>${esc(c.icon)} ${esc(c.name)}</b>
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
  const reserveAccs = DB.reserveAccounts();
  const alvoReserva = avgSpend * 6;
  const faltaReserva = Math.max(0, alvoReserva - reserve);
  const reserveCard = `
    <div class="card">
      <div class="card-head"><div><b>Reserva de emergência</b><small>o dinheiro guardado nas contas marcadas como reserva</small></div><span class="kpi-ico t-success" data-ico="shield" style="width:34px;height:34px;margin:0"></span></div>
      ${!reserveAccs.length ? `
        <div class="empty" style="padding:14px 4px"><b>Nenhuma conta marcada como reserva</b>
        Marque a poupança/caixinha onde vocês guardam dinheiro para emergências.</div>
        <button class="btn ghost" data-setup="accounts">Marcar uma conta como reserva</button>
      ` : `
        <div class="proj-row"><span>Guardado</span><b>${fmtShort(reserve)}</b></div>
        <div class="proj-row"><span>Cobre</span><b class="${coverage >= 6 ? 'txt-green' : coverage >= 3 ? 'txt-amber' : 'txt-red'}">${coverage.toFixed(1)} meses</b></div>
        <div class="bar ${coverage >= 6 ? 'bar-green' : coverage >= 3 ? 'bar-amber' : 'bar-red'}" style="margin:8px 0 4px"><i style="width:${covPct}%"></i></div>
        <p class="muted">Recomendação clássica: 3 a 6 meses do gasto médio (${fmtShort(avgSpend)}/mês)${faltaReserva > 0 ? ` — faltam <b>${fmtShort(faltaReserva)}</b> para 6 meses` : ' — objetivo alcançado 🎉'}.</p>
        <p class="muted" style="margin-top:6px">Composta por: ${reserveAccs.map(a => `${esc(a.name)} (${fmtShort(a.balance)})`).join(' · ')}</p>
        <button class="btn ghost" id="btn-guardar" style="margin-top:10px">＋ Guardar na reserva</button>
      `}
    </div>`;

  // --- Conselheiro: insights automáticos por regras de especialista ---
  const tips = [];
  if (available < 0) tips.push({ cls: 'red', txt: `Compromissos superam o saldo em ${fmtShort(-available)} — priorize quitar ou remanejar.` });
  for (const c of DB.all('categories')) {
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
        <div><small>Projeção do mês</small><b>${fmtShort(stats.projection)}</b></div>
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
        <div class="card-head"><div><b>Orçamento por categoria</b><small>gasto do período vs. limite mensal</small></div></div>
        ${budgets || '<div class="empty">Defina orçamentos em Configurações → Categorias.</div>'}
      </div>
    </div>
    ${venc ? `<p class="section-title">Próximos vencimentos</p>${venc}` : ''}
    <button class="btn ghost" id="go-reports" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="pie"></span>Ver relatórios completos</button>
  `;
}

/* ---------- Extrato ---------- */
function renderExtrato(period) {
  const quem = state.memberFilter || 'Todos';
  const txs = DB.txOfPeriod(period)
    .filter(t => state.filter === 'Todos' || t.scope === state.filter)
    .filter(t => quem === 'Todos' || (t.member || MEMBRO_COMUM) === quem)
    .sort((a, b) => b.date.localeCompare(a.date));
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
    list += `<div class="tx ${t.adjustment ? 'tx-adj' : ''}" data-tx="${t.id}">
      <span class="tx-ico">${t.adjustment ? '⚖️' : isExp ? esc(c ? c.icon : '🧾') : '💵'}</span>
      <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
      <span class="tx-meta">${t.adjustment ? 'Conciliação — fora das análises · toque para classificar' : `${isExp ? esc(c ? c.name : 'Sem categoria') : 'Receita'} · ${via}${t.member ? ' · ' + esc(t.member) : ''}${t.installment ? ' · parcela ' + esc(t.installment) : ''}`}</span></span>
      <span class="tx-amount ${!isExp ? 'income' : t.status === 'A Pagar' ? 'pending' : ''}">${isExp ? '' : '+ '}${fmt(t.amount)}</span>
      ${t.status === 'A Pagar' ? `<button class="pay-btn" data-pay-tx="${t.id}" title="Marcar como ${isExp ? 'pago' : 'recebido'}"><span data-ico="check"></span></button>` : ''}
    </div>`;
  }
  if (!txs.length) list = `<div class="empty"><b>Sem lançamentos</b>Nada registrado neste período com esse filtro.</div>`;

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
    <input id="tx-search" type="search" placeholder="🔎 Buscar no período…" autocomplete="off" style="margin-bottom:2px">
    <div class="filter-row">
      <span class="filter-lbl">Âmbito</span>
      <div class="chips" id="scope-chips">
        ${['Todos', 'Família', 'Pessoal'].map(f => `<button class="chip ${state.filter === f ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-lbl">Quem</span>
      <div class="chips" id="member-chips">
        ${['Todos', MEMBRO_COMUM, ...DB.settings().members].map(m => {
          const gasto = DB.expensesOf(period)
            .filter(t => m === 'Todos' || (t.member || MEMBRO_COMUM) === m)
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
          const label = m === MEMBRO_COMUM ? '👨‍👩‍👧 Comum' : m === 'Todos' ? 'Todos' : esc(m);
          return `<button class="chip ${quem === m ? 'active' : ''}" data-m="${esc(m)}">${label} <span class="chip-num">${fmtShort(gasto)}</span></button>`;
        }).join('')}
      </div>
    </div>
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
          <span class="acc-info"><b>${esc(a.name)}${DB.isReserveAccount(a) ? ' <span class="badge paga">reserva</span>' : ''}</b><small>${esc(a.type)}${a.institution ? ' · ' + esc(a.institution) : ''}</small></span>
          <span class="num">${fmt(a.balance)}</span>
        </div>`).join('') : '<div class="empty">Nenhuma conta cadastrada. Adicione em Configurações → Contas.</div>'}
      ${contas.length > 1 ? '<button class="btn ghost" id="btn-transfer" style="margin-top:10px">⇄ Transferir entre contas</button>' : ''}
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
  const hb = entries => entries.map(([name, v]) => {
    const pct = total > 0 ? Math.round(v / total * 100) : 0;
    return `<div class="budget-row"><div class="budget-head"><b>${esc(name)}</b><span class="num">${fmtShort(v)} <span class="muted">· ${pct}%</span></span></div>
      <div class="bar bar-green"><i style="width:${pct}%;background:#009ef7"></i></div></div>`;
  }).join('') || '<div class="empty">Sem dados no período.</div>';

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
    <button class="btn ghost" id="btn-csv" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-ico="download"></span>Exportar CSV do período (Excel)</button>

    <div class="card">
      <div class="card-head"><div><b>Evolução — 12 meses</b><small>gasto total por período${income > 0 ? ' · tracejada = renda' : ''}</small></div></div>
      ${svgBars(evo12, income)}
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
        <div class="card-head"><div><b>Quem gastou</b><small>por membro no período</small></div></div>
        ${hb(groupSum('member'))}
      </div>
      <div class="card">
        <div class="card-head"><div><b>Como pagou</b><small>por método no período</small></div></div>
        ${hb(groupSum('method'))}
      </div>
    </div>

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
  const search = $('#tx-search');
  if (search) search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    v.querySelectorAll('#tx-list .tx').forEach(row => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };

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
        (catOf(t.category_id) || {}).name || '', t.scope, t.member || '', t.method, t.status, t.installment || '',
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
  v.querySelectorAll('#scope-chips .chip').forEach(ch => ch.onclick = () => { state.filter = ch.dataset.f; render(); });
  v.querySelectorAll('#member-chips .chip').forEach(ch => ch.onclick = () => { state.memberFilter = ch.dataset.m; render(); });

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
  const transf = $('#btn-transfer');
  if (transf) transf.onclick = () => openTransferSheet();
  const guardar = $('#btn-guardar');
  if (guardar) guardar.onclick = () => {
    const destino = DB.reserveAccounts()[0];
    openTransferSheet(destino && destino.id, 'Guardar na reserva de emergência');
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
function openSheet(html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-handle"></div>${html}`;
  sheet.hidden = false; $('#sheet-backdrop').hidden = false;
  paintIcons(sheet);
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

/* Categorias mais usadas primeiro (as 3 viram botões; o resto fica no dropdown) */
function topCategoryIds(limit = 3, incluir) {
  const uso = {};
  for (const t of DB.all('transactions')) {
    if (!t.category_id || !DB.isExpense(t)) continue;
    uso[t.category_id] = (uso[t.category_id] || 0) + 1;
  }
  const ids = Object.keys(uso)
    .filter(id => DB.get('categories', id))
    .sort((a, b) => uso[b] - uso[a]);
  for (const c of DB.all('categories')) if (!ids.includes(c.id)) ids.push(c.id);   // completa se houver poucas
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
  const cats = DB.all('categories');
  const cards = DB.all('cards').filter(c => c.active !== false);
  const accounts = DB.all('accounts').filter(a => a.active !== false);
  const pessoas = DB.settings().members;
  const historico = txHistory();
  const topCats = topCategoryIds(3, tx.category_id);

  openSheet(`
    <div class="sheet-title"><span id="sh-title">${isEdit ? 'Editar lançamento' : 'Novo lançamento'}</span><button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field">${chipGroup('g-type', [{ value: 'Despesa', label: '↓ Despesa' }, { value: 'Receita', label: '↑ Receita' }], tx.type || 'Despesa')}</div>
    <div class="field"><input class="amount-input" id="f-amount" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
    <div class="field"><label>Descrição</label>
      <input id="f-desc" list="tx-hist" autocomplete="off" placeholder="Ex: Mercado, Uber, Farmácia…" value="${esc(tx.description)}">
      <datalist id="tx-hist">${historico.map(h => `<option value="${esc(h.description)}">`).join('')}</datalist>
    </div>
    <div class="field" id="wrap-cat">
      <label>Categoria <span class="muted" id="cat-auto"></span></label>
      <div class="chips" id="g-cat">
        ${topCats.map(id => { const c = DB.get('categories', id); return c ? `<button type="button" class="chip ${tx.category_id === id ? 'active' : ''}" data-v="${id}">${esc(c.icon)} ${esc(c.name)}</button>` : ''; }).join('')}
        <button type="button" class="chip chip-more" id="cat-other" data-v="">Outra ▾</button>
      </div>
      <select id="f-cat-more" hidden style="margin-top:8px">
        <option value="">— escolha a categoria —</option>
        ${cats.map(c => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
      </select>
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
    <div class="field"><label id="lbl-method">Pagamento</label>${chipGroup('g-method', METHODS.map(m => ({ value: m, label: m })), METHODS.includes(tx.method) ? tx.method : 'PIX')}</div>
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
      <select id="f-account"><option value="">— não movimenta conta —</option>${accounts.map(a => `<option value="${a.id}" ${tx.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>Âmbito</label>
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
    <div class="field"><label id="lbl-rec">Custo fixo mensal (recorrente)?</label><select id="f-rec"><option value="">Não</option><option value="1" ${tx.recurring ? 'selected' : ''}>Sim — entra nos custos fixos e no lançamento em 1 clique</option></select></div>
    <button class="btn" id="sh-save">${isEdit ? 'Salvar alterações' : 'Lançar'}</button>
    ${isEdit ? '<div class="btn-row"><button class="btn ghost" id="sh-dup">Repetir</button><button class="btn danger" id="sh-del">Excluir</button></div>' : ''}
  `);

  /* --- Formulário adaptativo: cada escolha reconfigura o resto --- */
  const applyType = v => {
    const isRec = v === 'Receita';
    $('#sh-title').textContent = isEdit ? 'Editar lançamento' : (isRec ? 'Nova receita' : 'Novo lançamento');
    $('#wrap-cat').hidden = isRec;                       // categorias são envelopes de gasto
    $('#lbl-status').textContent = isRec ? 'Situação' : 'Situação';
    $('#f-status').options[0].textContent = isRec ? 'Recebido' : 'Pago';
    $('#f-status').options[1].textContent = isRec ? 'A Receber' : 'A Pagar';
    $('#lbl-method').textContent = isRec ? 'Entrou por' : 'Pagamento';
    $('#lbl-rec').textContent = isRec ? 'Receita mensal fixa (ex: salário)?' : 'Custo fixo mensal (recorrente)?';
    $('#f-desc').placeholder = isRec ? 'Ex: Salário, Freelance, Reembolso…' : 'Ex: Mercado, Uber, Farmácia…';
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
      outra.textContent = c ? `${c.icon} ${c.name}` : 'Outra ▾';
      outra.classList.add('active');
      $('#f-cat-more').value = id;
    } else {
      outra.dataset.v = '';
      outra.textContent = 'Outra ▾';
      outra.classList.remove('active');
    }
    $('#f-cat-more').hidden = true;
  };
  bindChips('g-cat', () => {
    $('#cat-auto').textContent = '';
    const abriu = $('#cat-other').classList.contains('active') && !$('#cat-other').dataset.v;
    $('#f-cat-more').hidden = !abriu;
    if (abriu) setTimeout(() => $('#f-cat-more').focus(), 20);
  });
  $('#f-cat-more').onchange = e => { if (e.target.value) setCategory(e.target.value); };
  setCategory(tx.category_id);

  bindChips('g-type', v => { applyType(v); applyMethod(chipValue('g-method')); });
  bindChips('g-scope', applyScope);
  bindChips('g-method', applyMethod);
  applyType(tx.type || 'Despesa');
  applyScope(tx.scope || 'Família');

  // Atalhos de data
  document.querySelectorAll('#g-day .chip').forEach(ch => ch.onclick = () => {
    const d = new Date();
    d.setDate(d.getDate() - Number(ch.dataset.d));
    $('#f-date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    if (anterior) {                                   // já lançou isso antes: repete a classificação
      setCategory(anterior.category_id);
      selectChip('g-method', anterior.method);
      applyMethod(anterior.method);
      if (anterior.category_id) $('#cat-auto').textContent = '· repetido do último lançamento igual';
      if (!moneyVal('#f-amount') && anterior.amount) initMoney('#f-amount', anterior.amount);
      return;
    }
    if (chipValue('g-cat')) return;                   // não sobrescreve escolha manual
    const guess = OFX.guessCategoryId(texto, cats);
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
      category_id: isReceita ? null : (chipValue('g-cat') || null),
      recurring: !!$('#f-rec').value,
      type: isReceita ? 'Receita' : 'Despesa',
      adjustment: false,        // classificar um ajuste o transforma em lançamento normal
      card_id: null, account_id: null, invoice_key: '',
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
        closeSheet(); render(); Sync.autoSync();
        toast(`Parcelado em ${parcelas}x de ${fmtShort(amount / parcelas)} ✓`);
        return;
      }
    } else {
      rec.account_id = $('#f-account').value || null;
    }
    if (orig) adjustBalance(orig.account_id, -txEffect(orig));   // reverte efeito antigo
    DB.upsert('transactions', rec);
    adjustBalance(rec.account_id, txEffect(rec));                 // aplica efeito novo
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
        irmas.forEach(g => { adjustBalance(g.account_id, -txEffect(g)); DB.remove('transactions', g.id); });
        closeSheet(); render(); Sync.autoSync();
        return toast(`${irmas.length} parcelas excluídas`);
      }
    } else if (!confirm('Excluir este lançamento?')) return;
    if (orig) adjustBalance(orig.account_id, -txEffect(orig));   // devolve ao saldo
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
          `<option value="${a.id}" ${ehReserva && DB.isReserveAccount(a) ? 'selected' : ''}>${esc(a.name)}${DB.isReserveAccount(a) ? ' (reserva)' : ''} — ${fmtShort(a.balance)}</option>`).join('')}
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
}
function closeModal() { $('#modal').hidden = true; $('#modal-backdrop').hidden = true; render(); }

function openConfig() {
  const s = Sync.cfg || {};
  openModal(`
    <div class="modal-title">Configurações<button class="close-x" id="md-close"><span data-ico="x"></span></button></div>
    <div class="settings-item" data-go="accounts"><span class="cfg-left"><span class="cfg-ico" data-ico="wallet"></span><span>Contas<br><small>${DB.all('accounts').length} cadastrada(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="cards"><span class="cfg-left"><span class="cfg-ico" data-ico="card"></span><span>Cartões de crédito<br><small>${DB.all('cards').length} cadastrado(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="categories"><span class="cfg-left"><span class="cfg-ico" data-ico="pie"></span><span>Categorias &amp; orçamentos<br><small>${DB.all('categories').length} categoria(s)</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="family"><span class="cfg-left"><span class="cfg-ico" data-ico="users"></span><span>Membros &amp; ciclo do mês<br><small>Início no dia ${DB.settings().month_start_day}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="sync"><span class="cfg-left"><span class="cfg-ico" data-ico="cloud"></span><span>Sincronização<br><small>${Sync.hasFamily() ? 'Conectado como ' + esc(s.user_email || '') : 'Não configurada'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="ofx"><span class="cfg-left"><span class="cfg-ico" data-ico="download"></span><span>Importar extrato OFX<br><small>traga os lançamentos do banco ou cartão de uma vez</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="notif"><span class="cfg-left"><span class="cfg-ico" data-ico="bell"></span><span>Notificações<br><small>${Notif.enabled() ? 'Ativas — faturas, orçamentos e metas' : 'Desativadas'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="security"><span class="cfg-left"><span class="cfg-ico" data-ico="shield"></span><span>Segurança<br><small>${Auth.enabled() ? 'PIN ativo · bloqueia após ' + (Auth.cfg.lockAfterMin ?? 5) + ' min' : 'Sem proteção local'}</small></span></span><span class="chev" data-ico="chev"></span></div>
    <div class="settings-item" data-go="backup"><span class="cfg-left"><span class="cfg-ico" data-ico="download"></span><span>Backup (exportar / importar)<br><small>Arquivo JSON local</small></span></span><span class="chev" data-ico="chev"></span></div>
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
          <div class="field"><label style="display:flex;align-items:center;gap:9px;cursor:pointer">
            <input type="checkbox" id="c-reserve" ${DB.isReserveAccount({ ...acc, active: true }) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--gold)">
            Faz parte da reserva de emergência
          </label>
          <p class="muted" style="margin-top:6px">O dinheiro desta conta conta para a cobertura de meses no painel. Marque poupanças e caixinhas; deixe desmarcada a conta do dia a dia.</p></div>
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
          DB.upsert('accounts', { ...acc, name: $('#c-name').value.trim(), type: $('#c-type').value, institution: $('#c-inst').value, balance: saldoFinal, is_reserve: !!$('#c-reserve').checked });
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
    crudList('categories', 'Categorias & orçamentos',
      c => `${esc(c.icon)} ${esc(c.name)}<br><small>${esc(c.scope)} · orçamento ${fmtShort(c.monthly_budget)}/mês</small>`,
      cat => {
        const isEdit = !!cat;
        cat = cat || { name: '', icon: '🏷️', scope: 'Família', monthly_budget: 0 };
        openModal(`
          <div class="modal-title">${isEdit ? 'Editar categoria' : 'Nova categoria'}<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
          <div class="row2">
            <div class="field"><label>Ícone</label><input id="c-icon" maxlength="4" value="${esc(cat.icon)}"></div>
            <div class="field"><label>Nome</label><input id="c-name" value="${esc(cat.name)}"></div>
          </div>
          <div class="row2">
            <div class="field"><label>Âmbito</label><select id="c-scope"><option ${cat.scope === 'Família' ? 'selected' : ''}>Família</option><option ${cat.scope === 'Pessoal' ? 'selected' : ''}>Pessoal</option></select></div>
            <div class="field"><label>Orçamento mensal</label><input id="c-budget" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
          </div>
          <div class="field"><label>Tipo (regra 50/30/20)</label><select id="c-kind">
            <option value="Essencial" ${cat.kind !== 'Estilo' ? 'selected' : ''}>Necessidade (moradia, mercado, saúde…)</option>
            <option value="Estilo" ${cat.kind === 'Estilo' ? 'selected' : ''}>Desejo (lazer, assinaturas, extras…)</option>
          </select></div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        initMoney('#c-budget', cat.monthly_budget);
        $('#md-back').onclick = () => openConfigSection('categories');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          DB.upsert('categories', { ...cat, name: $('#c-name').value.trim(), icon: $('#c-icon').value || '🏷️', scope: $('#c-scope').value, monthly_budget: moneyVal('#c-budget'), kind: $('#c-kind').value });
          Sync.autoSync(); openConfigSection('categories');
        };
        const del = $('#md-del');
        if (del) del.onclick = () => { if (confirm('Excluir categoria?')) { DB.remove('categories', cat.id); Sync.autoSync(); openConfigSection('categories'); } };
      });
  }

  if (sec === 'family') {
    const s = DB.settings();
    openModal(`
      <div class="modal-title">Membros & ciclo<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>
      <div class="field"><label>Membros (um por linha)</label><textarea id="f-members" rows="4">${esc(s.members.join('\n'))}</textarea></div>
      <div class="field"><label>Dia de início do mês financeiro</label><input id="f-start" type="number" min="1" max="28" value="${s.month_start_day}">
        <p class="muted" style="margin-top:6px">1 = mês calendário. Ex: 5 = período do dia 5 ao dia 4 do mês seguinte (útil para quem se organiza pelo salário).</p></div>
      <div class="field"><label>Renda mensal da família (líquida)</label><input id="f-income" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00">
        <p class="muted" style="margin-top:6px">Base para a projeção vs. renda, taxa de poupança e regra 50/30/20 no painel.</p></div>
      <button class="btn" id="md-save">Salvar</button>
    `);
    initMoney('#f-income', s.monthly_income);
    $('#md-back').onclick = openConfig;
    $('#md-save').onclick = () => {
      const members = $('#f-members').value.split('\n').map(x => x.trim()).filter(Boolean);
      DB.upsert('family_settings', { ...s, members: members.length ? members : ['Família'], month_start_day: Math.min(28, Math.max(1, parseInt($('#f-start').value) || 1)), monthly_income: moneyVal('#f-income') });
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
        <div class="field"><label>PIN atual</label><input id="sec-cur" type="password" inputmode="numeric" maxlength="8"></div>
        <div class="field"><label>Novo PIN (deixe vazio para só alterar o tempo)</label><input id="sec-new" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 dígitos"></div>
        <div class="field"><label>Bloquear após (minutos em segundo plano)</label><input id="sec-min" type="number" min="0" max="120" value="${Auth.cfg.lockAfterMin ?? 5}"></div>
        <button class="btn" id="sec-save">Salvar</button>
        <div class="btn-row"><button class="btn danger" id="sec-off">Remover PIN</button></div>
      ` : `
        <div class="field"><label>Criar PIN (4 a 8 dígitos)</label><input id="sec-new" type="password" inputmode="numeric" maxlength="8"></div>
        <div class="field"><label>Repetir PIN</label><input id="sec-new2" type="password" inputmode="numeric" maxlength="8"></div>
        <button class="btn" id="sec-on">Ativar proteção</button>
      `}
    `);
    $('#md-back').onclick = openConfig;
    const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    on('#sec-on', async () => {
      const p1 = $('#sec-new').value, p2 = $('#sec-new2').value;
      if (!/^\d{4,8}$/.test(p1)) return toast('Use de 4 a 8 dígitos');
      if (p1 !== p2) return toast('Os PINs não conferem');
      await Auth.setPin(p1);
      toast('PIN ativado ✓'); openConfig();
    });
    on('#sec-save', async () => {
      if (!(await Auth.verify($('#sec-cur').value))) return toast('PIN atual incorreto');
      const novo = $('#sec-new').value;
      if (novo) {
        if (!/^\d{4,8}$/.test(novo)) return toast('Novo PIN: 4 a 8 dígitos');
        await Auth.setPin(novo);
      }
      Auth.cfg.lockAfterMin = Math.min(120, Math.max(0, parseInt($('#sec-min').value) || 5));
      Auth.save();
      toast('Segurança atualizada ✓'); openConfig();
    });
    on('#sec-off', async () => {
      if (!confirm('Remover a proteção? Os dados deste aparelho voltarão a ficar SEM criptografia.')) return;
      if (!(await Auth.removePin($('#sec-cur').value))) return toast('PIN atual incorreto');
      toast('PIN removido — dados locais sem criptografia'); openConfig();
    });
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
    <button class="btn" id="s-create-fam">Criar família "Peixoto Rios"</button>
    <hr class="sep">
    <div class="field"><label>Ou cole o código da família</label><input id="s-fam-code" placeholder="código recebido do outro membro"></div>
    <button class="btn ghost" id="s-join-fam">Entrar na família</button>`;
  if (step === 4) body = `
    <p class="muted">Conectado como <b>${esc(c.user_email || '')}</b></p>
    <p class="muted" style="margin:10px 0 4px">Código da família (compartilhe com quem vai usar junto):</p>
    <p class="mono">${esc(c.family_id)}</p>
    <button class="btn ghost" id="s-copy" style="margin:12px 0 10px">Copiar código</button>
    <button class="btn" id="s-now">Sincronizar agora</button>
    <hr class="sep"><button class="btn danger" id="s-logout">Sair da conta</button>`;

  openModal(`<div class="modal-title">☁️ Sincronização<button class="close-x" id="md-back"><span data-ico="back"></span></button></div>${body}`);
  $('#md-back').onclick = openConfig;

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
    try { await Sync.createFamily('Família Peixoto Rios'); await Sync.syncAll(); toast('Família criada ✓'); openSyncConfig(); }
    catch (e) { toast(e.message); }
  });
  on('#s-join-fam', async () => {
    try {
      await Sync.joinFamily($('#s-fam-code').value);
      DB.data.meta.lastSync = null; DB.save();     // puxa tudo da família
      await Sync.syncAll(); toast('Você entrou na família ✓'); openSyncConfig();
    } catch (e) { toast(e.message); }
  });
  on('#s-copy', () => { navigator.clipboard.writeText(Sync.cfg.family_id); toast('Código copiado'); });
  on('#s-now', async () => { try { await Sync.syncAll(); render(); } catch (_) {} });
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

function renderOfxPreview(parsed, accounts, cards) {
  const cats = DB.all('categories');
  const novos = parsed.txs.filter(t => !DB.hasFitid(t.fitid));
  const dups = parsed.txs.length - novos.length;
  const destOpts = `
    ${cards.length ? `<optgroup label="Cartões de crédito">${cards.map(c => `<option value="card:${c.id}" ${parsed.isCard ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>` : ''}
    ${accounts.length ? `<optgroup label="Contas">${accounts.map(a => `<option value="acc:${a.id}" ${!parsed.isCard ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</optgroup>` : ''}`;

  const rows = novos.map((t, i) => {
    const isExp = t.amount < 0;
    const guess = isExp ? OFX.guessCategoryId(t.memo, cats) : '';
    return `<div class="ofx-row">
      <input type="checkbox" data-i="${i}" checked>
      <span class="ofx-main"><b>${esc(t.memo)}</b><small>${fmtDay(t.date)} · ${isExp ? 'saída' : 'entrada'}</small></span>
      ${isExp ? `<select data-cat="${i}"><option value="">Sem categoria</option>${cats.map(c => `<option value="${c.id}" ${guess === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select>` : '<span class="muted" style="width:130px;font-size:12px">receita</span>'}
      <span class="ofx-val ${isExp ? '' : 'txt-green'}">${isExp ? '' : '+'}${fmtShort(Math.abs(t.amount))}</span>
    </div>`;
  }).join('');

  $('#ofx-result').innerHTML = `
    <hr class="sep">
    <div class="mini-stats" style="margin-bottom:12px">
      <div class="card"><small>Novos</small><b>${novos.length}</b></div>
      <div class="card"><small>Já importados</small><b>${dups}</b></div>
      <div class="card"><small>Do arquivo</small><b>${parsed.txs.length}</b></div>
    </div>
    ${!novos.length ? '<div class="empty"><b>Tudo já importado</b>Nenhum lançamento novo neste arquivo.</div>' : `
      <div class="field"><label>Lançar em</label><select id="ofx-dest">${destOpts}</select></div>
      ${parsed.balance !== null ? `<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ofx-bal" checked style="width:18px;height:18px;accent-color:var(--gold)">Atualizar saldo da conta para ${fmt(parsed.balance)} (informado pelo banco)</label></div>` : ''}
      <div class="btn-row" style="margin-bottom:4px">
        <button class="btn ghost" id="ofx-all">Marcar todos</button>
        <button class="btn ghost" id="ofx-none">Desmarcar todos</button>
      </div>
      <div class="ofx-list">${rows}</div>
      <button class="btn" id="ofx-go">Importar selecionados</button>
    `}`;

  if (!novos.length) return;
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
    for (const c of DB.all('categories')) {
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
window.addEventListener('online', () => Sync.autoSync());

const hour = new Date().getHours();
$('#topbar-hello').textContent = (hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite') + ' · Família Peixoto Rios';

function refreshUserChip() {
  const mail = (Sync.cfg && Sync.cfg.user_email) || '';
  $('#user-name').textContent = mail ? mail.split('@')[0] : 'Família';
  $('#user-mail').textContent = mail ? (Sync.hasFamily() ? 'sincronizado ☁️' : 'conectado') : 'modo local';
  $('#user-avatar').textContent = (mail || 'F').charAt(0).toUpperCase();
}
refreshUserChip();
paintIcons();   // ícones do shell estático (sidebar, topbar, tabbar)

let scrollTimer;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(persistUI, 250);
}, { passive: true });
window.addEventListener('beforeunload', persistUI);

Notif.load();
restoreUI();
Auth.init(() => {
  setTab(state.tab);          // restaura a aba e marca o menu corretamente
  Sync.autoSync();
  setTimeout(() => Notif.check(), 800);
});
