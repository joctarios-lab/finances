/* Finanças da Família — UI e fluxo do app */
'use strict';

Sync.load();   // DB.load() acontece dentro de Auth.init(), que decifra os dados quando há PIN

const METHODS = ['PIX', 'Débito', 'Cartão de Crédito', 'Dinheiro', 'Boleto'];
const PALETTE = ['#009ef7', '#50cd89', '#7239ea', '#f1416c', '#ffc700', '#43ced7', '#fd7e14', '#8950fc', '#1bc5bd', '#6c7293'];

let state = { tab: 'inicio', monthOffset: 0, filter: 'Todos' };

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

function catOf(id) { return DB.get('categories', id); }
function catLabel(id) { const c = catOf(id); return c ? `${c.icon} ${c.name}` : 'Sem categoria'; }

/* ---------- Navegação ---------- */
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab, .side-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

function render() {
  const period = DB.monthPeriod(new Date(), state.tab === 'extrato' ? state.monthOffset : 0);
  $('#topbar-month').textContent = DB.monthPeriod(new Date()).label;
  const views = { inicio: renderInicio, extrato: renderExtrato, cartoes: renderCartoes, metas: renderMetas };
  $('#view').innerHTML = views[state.tab](period);
  paintIcons($('#view'));
  bindView();
}

/* ---------- Início ---------- */
function renderInicio(period) {
  const txs = DB.txOfPeriod(period);
  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);
  const contas = DB.all('accounts').filter(a => a.active !== false);
  const saldo = contas.reduce((s, a) => s + Number(a.balance || 0), 0);

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

  return `
    <div class="kpi-grid">
      <div class="card kpi"><span class="kpi-ico t-primary" data-ico="trend"></span><div class="kpi-value gold">${fmtShort(total)}</div><div class="kpi-label">Gasto do mês</div><div class="kpi-sub">${txs.length} lançamentos</div></div>
      <div class="card kpi"><span class="kpi-ico t-danger" data-ico="invoice"></span><div class="kpi-value ${openInvoices ? 'red' : 'green'}">${fmtShort(openInvoices)}</div><div class="kpi-label">Faturas em aberto</div><div class="kpi-sub">${upcoming.length} fatura(s)</div></div>
      <div class="card kpi"><span class="kpi-ico t-success" data-ico="wallet"></span><div class="kpi-value green">${fmtShort(saldo)}</div><div class="kpi-label">Saldo em contas</div><div class="kpi-sub">${contas.length} conta(s)</div></div>
      <div class="card kpi"><span class="kpi-ico t-info" data-ico="target"></span><div class="kpi-value">${avgPct}%</div><div class="kpi-label">Metas (média)</div><div class="kpi-sub">${goals.length} em andamento</div></div>
    </div>
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
  `;
}

/* ---------- Extrato ---------- */
function renderExtrato(period) {
  const txs = DB.txOfPeriod(period)
    .filter(t => state.filter === 'Todos' || t.scope === state.filter)
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = txs.reduce((s, t) => s + Number(t.amount || 0), 0);

  let list = '', lastDay = '';
  for (const t of txs) {
    if (t.date !== lastDay) { lastDay = t.date; list += `<p class="tx-day">${fmtDay(t.date)}</p>`; }
    const c = catOf(t.category_id);
    const via = t.method === 'Cartão de Crédito'
      ? `💳 ${esc((DB.get('cards', t.card_id) || {}).name || 'Cartão')}`
      : esc(t.method);
    list += `<div class="tx" data-tx="${t.id}">
      <span class="tx-ico">${esc(c ? c.icon : '🧾')}</span>
      <span class="tx-info"><span class="tx-name">${esc(t.description)}</span>
      <span class="tx-meta">${esc(c ? c.name : 'Sem categoria')} · ${via}${t.member ? ' · ' + esc(t.member) : ''}</span></span>
      <span class="tx-amount ${t.status === 'A Pagar' ? 'pending' : ''}">${fmt(t.amount)}</span>
    </div>`;
  }
  if (!txs.length) list = `<div class="empty"><b>Sem lançamentos</b>Nada registrado neste período com esse filtro.</div>`;

  return `
    <div class="card month-nav">
      <button id="mn-prev" aria-label="Mês anterior" data-ico="chevL"></button>
      <b>${period.label} · ${fmtShort(total)}</b>
      <button id="mn-next" aria-label="Próximo mês" data-ico="chevR"></button>
    </div>
    <div class="chips" id="scope-chips">
      ${['Todos', 'Família', 'Pessoal'].map(f => `<button class="chip ${state.filter === f ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')}
    </div>
    <div>${list}</div>
  `;
}

/* ---------- Cartões ---------- */
function renderCartoes() {
  const cards = DB.all('cards').filter(c => c.active !== false);
  if (!cards.length) {
    return `<div class="empty"><b>Nenhum cartão cadastrado</b>Adicione em ⚙︎ → Cartões de crédito.</div>
      <button class="btn ghost" onclick="openConfigSection('cards')">Cadastrar cartão</button>`;
  }
  let html = '';
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
    html += `
    <div class="card goal-card">
      <div class="goal-head"><span class="goal-ico">${esc(g.icon)}</span>
        <span class="goal-name">${esc(g.name)}${g.done ? ' ✓' : ''}</span>
        <span class="goal-pct">${pct}%</span></div>
      <div class="goal-nums"><span>Guardado: <b>${fmtShort(total)}</b></span><span>Meta: <b>${fmtShort(g.target_amount)}</b></span></div>
      <div class="bar ${pct >= 100 ? 'bar-green' : barClass(100 - pct) === 'bar-red' ? 'bar-amber' : 'bar-green'}"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="btn-row">
        <button class="btn ghost" data-aporte="${g.id}">＋ Aporte</button>
        <button class="btn ghost" data-editgoal="${g.id}">Editar</button>
      </div>
      ${entries.slice(0, 3).map(e => `<div class="muted" style="margin-top:6px">· ${fmtDay(e.date)} — ${esc(e.description)} <b style="color:var(--paper)">${fmtShort(e.amount)}</b></div>`).join('')}
    </div>`;
  }
  return html;
}

/* ---------- Ligações por view ---------- */
function bindView() {
  const v = $('#view');
  v.querySelectorAll('[data-tx]').forEach(el => el.onclick = () => openTxSheet(DB.get('transactions', el.dataset.tx)));
  const prev = $('#mn-prev'), next = $('#mn-next');
  if (prev) prev.onclick = () => { state.monthOffset--; render(); };
  if (next) next.onclick = () => { state.monthOffset++; render(); };
  v.querySelectorAll('#scope-chips .chip').forEach(ch => ch.onclick = () => { state.filter = ch.dataset.f; render(); });
  v.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { DB.setInvoicePaid(b.dataset.pay, true); Sync.autoSync(); render(); toast('Fatura marcada como paga'); });
  v.querySelectorAll('[data-unpay]').forEach(b => b.onclick = () => { DB.setInvoicePaid(b.dataset.unpay, false); Sync.autoSync(); render(); });
  const ng = $('#btn-new-goal');
  if (ng) ng.onclick = () => openGoalSheet(null);
  v.querySelectorAll('[data-editgoal]').forEach(b => b.onclick = () => openGoalSheet(DB.get('goals', b.dataset.editgoal)));
  v.querySelectorAll('[data-aporte]').forEach(b => b.onclick = () => openAporteSheet(b.dataset.aporte));
}

/* ---------- Sheet: lançamento rápido ---------- */
function openSheet(html) {
  $('#sheet').innerHTML = `<div class="sheet-handle"></div>${html}`;
  $('#sheet').hidden = false; $('#sheet-backdrop').hidden = false;
  paintIcons($('#sheet'));
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

function openTxSheet(tx) {
  const isEdit = !!tx;
  tx = tx || { description: '', amount: '', date: todayISO(), scope: 'Família', member: '', method: 'PIX', status: 'Pago', category_id: '', account_id: '', card_id: '' };
  const cats = DB.all('categories');
  const cards = DB.all('cards').filter(c => c.active !== false);
  const accounts = DB.all('accounts').filter(a => a.active !== false);
  const members = ['Comum / Família', ...DB.settings().members];

  openSheet(`
    <div class="sheet-title">${isEdit ? 'Editar lançamento' : 'Lançar gasto'}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><input class="amount-input" id="f-amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="R$ 0,00" value="${tx.amount || ''}"></div>
    <div class="field"><label>Descrição</label><input id="f-desc" placeholder="Ex: Mercado, Uber, Farmácia…" value="${esc(tx.description)}"></div>
    <div class="field"><label>Categoria</label>${chipGroup('g-cat', cats.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })), tx.category_id)}</div>
    <div class="row2">
      <div class="field"><label>Data</label><input id="f-date" type="date" value="${tx.date}"></div>
      <div class="field"><label>Situação</label><select id="f-status"><option ${tx.status === 'Pago' ? 'selected' : ''}>Pago</option><option ${tx.status === 'A Pagar' ? 'selected' : ''}>A Pagar</option></select></div>
    </div>
    <div class="field"><label>Pagamento</label>${chipGroup('g-method', METHODS.map(m => ({ value: m, label: m })), tx.method)}</div>
    <div class="field" id="wrap-card" ${tx.method === 'Cartão de Crédito' ? '' : 'hidden'}>
      <label>Cartão (fatura atribuída automaticamente pelo fechamento)</label>
      <select id="f-card">${cards.map(c => `<option value="${c.id}" ${tx.card_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option value="">— cadastre um cartão em ⚙︎ —</option>'}</select>
    </div>
    <div class="field" id="wrap-account" ${tx.method === 'Cartão de Crédito' ? 'hidden' : ''}>
      <label>Conta</label>
      <select id="f-account"><option value="">—</option>${accounts.map(a => `<option value="${a.id}" ${tx.account_id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    </div>
    <div class="row2">
      <div class="field"><label>Âmbito</label>${chipGroup('g-scope', [{ value: 'Família', label: '👨‍👩‍👧 Família' }, { value: 'Pessoal', label: '👤 Pessoal' }], tx.scope)}</div>
      <div class="field"><label>Quem</label><select id="f-member">${members.map(m => `<option ${tx.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
    </div>
    <button class="btn" id="sh-save">${isEdit ? 'Salvar alterações' : 'Lançar'}</button>
    ${isEdit ? '<div class="btn-row"><button class="btn danger" id="sh-del">Excluir</button></div>' : ''}
  `);

  bindChips('g-cat'); bindChips('g-scope');
  bindChips('g-method', v => {
    $('#wrap-card').hidden = v !== 'Cartão de Crédito';
    $('#wrap-account').hidden = v === 'Cartão de Crédito';
  });
  $('#sh-close').onclick = closeSheet;
  setTimeout(() => $('#f-amount').focus(), 80);

  $('#sh-save').onclick = () => {
    const amount = parseFloat($('#f-amount').value);
    const desc = $('#f-desc').value.trim();
    if (!amount || amount <= 0) return toast('Informe o valor');
    if (!desc) return toast('Informe a descrição');
    const method = chipValue('g-method');
    const rec = {
      ...tx,
      description: desc, amount, date: $('#f-date').value || todayISO(),
      status: $('#f-status').value, method,
      scope: chipValue('g-scope') || 'Família',
      member: $('#f-member').value,
      category_id: chipValue('g-cat') || null,
      card_id: null, account_id: null, invoice_key: '',
    };
    if (method === 'Cartão de Crédito') {
      const card = DB.get('cards', $('#f-card').value);
      if (!card) return toast('Cadastre um cartão em ⚙︎ primeiro');
      rec.card_id = card.id;
      rec.invoice_key = DB.invoiceKeyFor(card, rec.date);
    } else {
      rec.account_id = $('#f-account').value || null;
    }
    DB.upsert('transactions', rec);
    closeSheet(); render(); Sync.autoSync();
    toast(isEdit ? 'Lançamento atualizado' : 'Gasto lançado ✓');
  };
  const del = $('#sh-del');
  if (del) del.onclick = () => {
    if (!confirm('Excluir este lançamento?')) return;
    DB.remove('transactions', tx.id);
    closeSheet(); render(); Sync.autoSync();
    toast('Excluído');
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
      <div class="field"><label>Valor alvo</label><input id="g-target" type="number" inputmode="decimal" step="0.01" value="${goal.target_amount || ''}"></div>
      <div class="field"><label>Data alvo</label><input id="g-date" type="date" value="${goal.target_date || ''}"></div>
    </div>
    ${isEdit ? `<div class="field"><label>Concluída</label><select id="g-done"><option value="">Não</option><option value="1" ${goal.done ? 'selected' : ''}>Sim</option></select></div>` : ''}
    <button class="btn" id="sh-save">Salvar</button>
    ${isEdit ? '<div class="btn-row"><button class="btn danger" id="sh-del">Excluir meta</button></div>' : ''}
  `);
  $('#sh-close').onclick = closeSheet;
  $('#sh-save').onclick = () => {
    const name = $('#g-name').value.trim();
    if (!name) return toast('Dê um nome à meta');
    DB.upsert('goals', {
      ...goal, name, icon: $('#g-icon').value || '🎯',
      target_amount: parseFloat($('#g-target').value) || 0,
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

function openAporteSheet(goalId) {
  const g = DB.get('goals', goalId);
  openSheet(`
    <div class="sheet-title">Aporte — ${esc(g.icon)} ${esc(g.name)}<button class="close-x" id="sh-close"><span data-ico="x"></span></button></div>
    <div class="field"><input class="amount-input" id="a-amount" type="number" inputmode="decimal" step="0.01" placeholder="R$ 0,00"></div>
    <div class="row2">
      <div class="field"><label>Descrição</label><input id="a-desc" value="Aporte"></div>
      <div class="field"><label>Data</label><input id="a-date" type="date" value="${todayISO()}"></div>
    </div>
    <button class="btn" id="sh-save">Registrar aporte</button>
  `);
  $('#sh-close').onclick = closeSheet;
  setTimeout(() => $('#a-amount').focus(), 80);
  $('#sh-save').onclick = () => {
    const amount = parseFloat($('#a-amount').value);
    if (!amount) return toast('Informe o valor');
    DB.upsert('goal_entries', { goal_id: goalId, amount, description: $('#a-desc').value || 'Aporte', date: $('#a-date').value || todayISO() });
    closeSheet(); render(); Sync.autoSync();
    toast('Aporte registrado ✓');
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
          <div class="field"><label>Saldo atual</label><input id="c-bal" type="number" step="0.01" value="${acc.balance}"></div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        $('#md-back').onclick = () => openConfigSection('accounts');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          DB.upsert('accounts', { ...acc, name: $('#c-name').value.trim(), type: $('#c-type').value, institution: $('#c-inst').value, balance: parseFloat($('#c-bal').value) || 0 });
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
          <div class="field"><label>Limite</label><input id="c-limit" type="number" step="0.01" value="${card.limit_amount}"></div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        $('#md-back').onclick = () => openConfigSection('cards');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          DB.upsert('cards', {
            ...card, name: $('#c-name').value.trim(), brand: $('#c-brand').value,
            closing_day: Math.min(28, Math.max(1, parseInt($('#c-close').value) || 25)),
            due_day: Math.min(28, Math.max(1, parseInt($('#c-due').value) || 5)),
            limit_amount: parseFloat($('#c-limit').value) || 0,
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
            <div class="field"><label>Orçamento mensal</label><input id="c-budget" type="number" step="0.01" value="${cat.monthly_budget}"></div>
          </div>
          <button class="btn" id="md-save">Salvar</button>
          ${isEdit ? '<div class="btn-row"><button class="btn danger" id="md-del">Excluir</button></div>' : ''}
        `);
        $('#md-back').onclick = () => openConfigSection('categories');
        $('#md-save').onclick = () => {
          if (!$('#c-name').value.trim()) return toast('Informe o nome');
          DB.upsert('categories', { ...cat, name: $('#c-name').value.trim(), icon: $('#c-icon').value || '🏷️', scope: $('#c-scope').value, monthly_budget: parseFloat($('#c-budget').value) || 0 });
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
      <button class="btn" id="md-save">Salvar</button>
    `);
    $('#md-back').onclick = openConfig;
    $('#md-save').onclick = () => {
      const members = $('#f-members').value.split('\n').map(x => x.trim()).filter(Boolean);
      DB.upsert('family_settings', { ...s, members: members.length ? members : ['Família'], month_start_day: Math.min(28, Math.max(1, parseInt($('#f-start').value) || 1)) });
      Sync.autoSync(); toast('Salvo'); openConfig();
    };
  }

  if (sec === 'sync') openSyncConfig();

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

Auth.init(() => {
  render();
  Sync.autoSync();
});
