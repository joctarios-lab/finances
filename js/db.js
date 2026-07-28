/* Finanças Família — camada de dados local (localStorage, local-first)
   Todas as entidades carregam o envelope de sync: { id, updated_at, deleted, dirty } */
'use strict';

const DB_KEY = 'financas.v1';
const STORES = ['accounts', 'cards', 'categories', 'transactions', 'goals', 'goal_entries', 'invoice_status', 'family_settings'];

/* Criptografia local: AES-256-GCM com chave derivada do PIN (PBKDF2, 150 mil iterações). */
const KCrypto = {
  b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); },
  async deriveKey(pin, saltB64, iterations = 150000) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.unb64(saltB64), iterations, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async enc(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { enc: true, iv: this.b64(iv), ct: this.b64(ct) };
  },
  async dec(key, blob) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(blob.iv) }, key, this.unb64(blob.ct));
    return new TextDecoder().decode(pt);
  },
};

const DB = {
  data: null,
  locked: false,       // true quando os dados estão criptografados aguardando o PIN
  key: null,           // CryptoKey ativa (criptografia em repouso ligada)
  _encBlob: null,
  _q: Promise.resolve(),

  load() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (_) { parsed = null; }
    if (parsed && parsed.enc === true) {   // dados em repouso criptografados
      this._encBlob = parsed;
      this.locked = true;
      this.data = null;
      return null;
    }
    this.data = parsed;
    if (!this.data) {
      this.data = { meta: { seeded: false, lastSync: null } };
      for (const s of STORES) this.data[s] = [];
      this.seed();
    }
    for (const s of STORES) if (!this.data[s]) this.data[s] = [];
    return this.data;
  },

  async unlock(cryptoKey) {
    const text = await KCrypto.dec(cryptoKey, this._encBlob);   // lança se a chave for errada
    this.data = JSON.parse(text);
    for (const s of STORES) if (!this.data[s]) this.data[s] = [];
    this.key = cryptoKey;
    this.locked = false;
    this._encBlob = null;
  },

  setKey(cryptoKey) { this.key = cryptoKey; this.save(); },
  clearKey() { this.key = null; this.save(); },

  save() {
    if (this.key) {
      // Serializa gravações criptografadas em fila para nunca escrever fora de ordem.
      const json = JSON.stringify(this.data);
      this._q = this._q
        .then(() => KCrypto.enc(this.key, json))
        .then(blob => localStorage.setItem(DB_KEY, JSON.stringify(blob)))
        .catch(() => {});
    } else {
      localStorage.setItem(DB_KEY, JSON.stringify(this.data));
    }
  },

  uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  },

  now() { return new Date().toISOString(); },

  all(store) { return this.data[store].filter(r => !r.deleted); },

  get(store, id) { return this.data[store].find(r => r.id === id && !r.deleted) || null; },

  upsert(store, record) {
    record.id = record.id || this.uuid();
    record.updated_at = this.now();
    record.deleted = !!record.deleted;
    record.dirty = true;
    const i = this.data[store].findIndex(r => r.id === record.id);
    if (i >= 0) this.data[store][i] = { ...this.data[store][i], ...record };
    else this.data[store].push(record);
    this.save();
    return record.id;
  },

  remove(store, id) {
    const r = this.data[store].find(x => x.id === id);
    if (r) { r.deleted = true; r.updated_at = this.now(); r.dirty = true; this.save(); }
  },

  /* ---------- Configurações da família ---------- */
  settings() {
    let s = this.all('family_settings')[0];
    if (!s) {
      s = { id: this.uuid(), members: ['Joctã', 'Cônjuge'], month_start_day: 1, monthly_income: 0, updated_at: this.now(), deleted: false, dirty: true };
      this.data.family_settings.push(s);
      this.save();
    }
    if (s.monthly_income === undefined) s.monthly_income = 0;
    return s;
  },

  /* ---------- Ciclo do mês (dia de início configurável) ---------- */
  // Retorna { start, end, label } do período que contém a data ref (Date).
  monthPeriod(ref, offsetMonths = 0) {
    const startDay = Math.min(Math.max(this.settings().month_start_day || 1, 1), 28);
    let y = ref.getFullYear(), m = ref.getMonth();
    if (ref.getDate() < startDay) m -= 1;
    m += offsetMonths;
    const start = new Date(y, m, startDay);
    const end = new Date(y, m + 1, startDay); // exclusivo
    const labelDate = startDay === 1 ? start : new Date(y, m + 1, 1);
    const label = labelDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return { start, end, label: label.charAt(0).toUpperCase() + label.slice(1) };
  },

  inPeriod(dateStr, period) {
    const d = new Date(dateStr + 'T12:00:00');
    return d >= period.start && d < period.end;
  },

  /* ---------- Faturas de cartão (derivadas, automáticas) ---------- */
  // Chave da fatura para uma compra: dia > fechamento => fatura do mês seguinte.
  invoiceKeyFor(card, dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    let y = d.getFullYear(), m = d.getMonth();
    if (d.getDate() > card.closing_day) m += 1;
    const norm = new Date(y, m, 1);
    return `${card.id}:${norm.getFullYear()}-${String(norm.getMonth() + 1).padStart(2, '0')}`;
  },

  invoiceDates(card, key) {
    const [, ym] = key.split(':');
    const [y, m] = ym.split('-').map(Number);
    const closing = new Date(y, m - 1, card.closing_day);
    let dueM = m - 1;
    if (card.due_day <= card.closing_day) dueM += 1; // vencimento no mês seguinte ao fechamento
    const due = new Date(y, dueM, card.due_day);
    return { closing, due };
  },

  // Todas as faturas existentes (derivadas das transações) de um cartão.
  // Receitas no cartão (estornos) entram com sinal negativo, reduzindo a fatura.
  invoicesOf(card) {
    const map = {};
    for (const t of this.all('transactions')) {
      if (t.card_id !== card.id || !t.invoice_key) continue;
      if (!map[t.invoice_key]) map[t.invoice_key] = { key: t.invoice_key, total: 0, count: 0 };
      map[t.invoice_key].total += (this.isExpense(t) ? 1 : -1) * (Number(t.amount) || 0);
      map[t.invoice_key].count += 1;
    }
    const today = new Date();
    return Object.values(map).map(inv => {
      const { closing, due } = this.invoiceDates(card, inv.key);
      const paidRec = this.all('invoice_status').find(s => s.invoice_key === inv.key);
      let status = 'Aberta';
      if (paidRec && paidRec.paid) status = 'Paga';
      else if (today > closing) status = 'Fechada';
      return { ...inv, card, closing, due, status };
    }).sort((a, b) => a.due - b.due);
  },

  setInvoicePaid(key, paid) {
    const rec = this.all('invoice_status').find(s => s.invoice_key === key);
    if (rec) this.upsert('invoice_status', { ...rec, paid });
    else this.upsert('invoice_status', { invoice_key: key, paid });
  },

  /* ---------- Agregações ---------- */
  // Um lançamento é despesa por padrão; 'Receita' representa entrada de dinheiro.
  isExpense(t) { return (t && t.type) !== 'Receita'; },

  txOfPeriod(period) {
    return this.all('transactions').filter(t => this.inPeriod(t.date, period));
  },
  // Ajustes de saldo aparecem no extrato (para auditoria), mas não são gasto nem
  // renda de verdade — ficam fora de toda análise para não distorcer os números.
  expensesOf(period) { return this.txOfPeriod(period).filter(t => this.isExpense(t) && !t.adjustment); },
  incomesOf(period) { return this.txOfPeriod(period).filter(t => !this.isExpense(t) && !t.adjustment); },
  // Renda que realmente entrou na família. Estorno de cartão é receita no modelo
  // (abate a fatura), mas não é renda — por isso fica de fora daqui.
  realizedIncome(period) {
    return this.incomesOf(period)
      .filter(t => !t.card_id)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  },

  // Evita reimportar o mesmo lançamento de um extrato OFX (FITID é único no banco).
  hasFitid(fitid) {
    return !!fitid && this.data.transactions.some(t => t.fitid === fitid && !t.deleted);
  },

  spentByCategory(period) {
    const out = {};
    for (const t of this.expensesOf(period)) {
      const k = t.category_id || '_sem';
      out[k] = (out[k] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  goalTotal(goalId) {
    return this.all('goal_entries').filter(e => e.goal_id === goalId)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  },

  /* ---------- Inteligência financeira (conceitos de planejamento) ---------- */
  // Dias do período e dias já decorridos (mín. 1, máx. total).
  periodDays(period) { return Math.round((period.end - period.start) / 86400000); },
  elapsedDays(period) {
    const today = new Date();
    if (today < period.start) return 0;
    return Math.min(this.periodDays(period), Math.floor((today - period.start) / 86400000) + 1);
  },

  // Run-rate: gasto até agora + média diária × dias restantes.
  statsFor(period) {
    const txs = this.expensesOf(period);
    const spent = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const total = this.periodDays(period);
    const elapsed = this.elapsedDays(period);
    const dailyAvg = spent / Math.max(elapsed, 1);
    const projection = elapsed >= total ? spent : spent + dailyAvg * (total - elapsed);
    return { spent, count: txs.length, dailyAvg, projection, totalDays: total, elapsedDays: elapsed, remainingDays: Math.max(0, total - elapsed) };
  },

  // Comprometido = faturas não pagas + lançamentos "A Pagar" fora de cartão (sem contar duas vezes).
  committed() {
    let total = 0;
    for (const card of this.all('cards').filter(c => c.active !== false))
      for (const inv of this.invoicesOf(card))
        if (inv.status !== 'Paga') total += inv.total;
    for (const t of this.all('transactions'))
      if (t.status === 'A Pagar' && !t.card_id && this.isExpense(t)) total += Number(t.amount) || 0;
    return total;
  },

  accountsTotal() {
    return this.all('accounts').filter(a => a.active !== false)
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  },

  // Disponível de verdade: o que está nas contas menos o que já está comprometido.
  available() { return this.accountsTotal() - this.committed(); },

  // A reserva é o dinheiro guardado nas contas marcadas como reserva.
  // Contas antigas (sem a marcação) seguem a regra anterior: caixinha e investimento.
  isReserveAccount(a) {
    if (!a || a.active === false) return false;
    return a.is_reserve !== undefined && a.is_reserve !== null
      ? !!a.is_reserve
      : (a.type === 'Caixinha / Rendimento' || a.type === 'Investimento');
  },
  reserveAccounts() { return this.all('accounts').filter(a => this.isReserveAccount(a)); },
  reserveTotal() { return this.reserveAccounts().reduce((s, a) => s + (Number(a.balance) || 0), 0); },

  // Gasto médio dos últimos n períodos completos (base p/ cobertura da reserva).
  avgMonthlySpend(n = 3) {
    const vals = [];
    for (let i = 1; i <= n; i++) {
      const p = this.monthPeriod(new Date(), -i);
      const v = this.expensesOf(p).reduce((s, t) => s + (Number(t.amount) || 0), 0);
      if (v > 0) vals.push(v);
    }
    if (!vals.length) return this.statsFor(this.monthPeriod(new Date())).projection || 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },

  // Ritmo de aportes de uma meta (média mensal dos últimos 90 dias).
  goalPace(goalId) {
    const cut = new Date(Date.now() - 90 * 86400000);
    const recent = this.all('goal_entries')
      .filter(e => e.goal_id === goalId && new Date(e.date + 'T12:00:00') >= cut)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return recent / 3;
  },

  /* ---------- Backup ---------- */
  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  },

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo inválido');
    for (const s of STORES) if (!Array.isArray(parsed[s])) throw new Error('Arquivo não parece um backup do app');
    this.data = parsed;
    this.save();
  },

  /* ---------- Dados de fábrica ---------- */
  // Gasto do período dividido em Necessidades x Desejos (base da regra 50/30/20).
  spentByKind(period) {
    const out = { Essencial: 0, Estilo: 0 };
    for (const t of this.expensesOf(period)) {
      const c = this.get('categories', t.category_id);
      const kind = (c && c.kind) === 'Estilo' ? 'Estilo' : 'Essencial';
      out[kind] += Number(t.amount) || 0;
    }
    return out;
  },

  seed() {
    if (this.data.meta.seeded) return;
    const cat = (name, icon, budget, kind, scope = 'Família') =>
      ({ id: this.uuid(), name, icon, monthly_budget: budget, kind, scope, updated_at: this.now(), deleted: false, dirty: true });
    this.data.categories = [
      cat('Moradia', '🏠', 1800, 'Essencial'), cat('Alimentação / Mercado', '🍽️', 1500, 'Essencial'),
      cat('Transporte', '🚗', 500, 'Essencial'), cat('Saúde', '💊', 400, 'Essencial'),
      cat('Lazer', '🎮', 350, 'Estilo'), cat('Assinaturas', '🔁', 150, 'Estilo'),
      cat('Educação', '📚', 300, 'Essencial'), cat('Gastos Pessoais', '👤', 600, 'Estilo', 'Pessoal'),
    ];
    this.data.meta.seeded = true;
    this.save();
  },
};
