/* Finanças Família — camada de dados local (localStorage, local-first)
   Todas as entidades carregam o envelope de sync: { id, updated_at, deleted, dirty } */
'use strict';

const DB_KEY = 'financas.v1';
const STORES = ['accounts', 'cards', 'categories', 'transactions', 'goals', 'goal_entries', 'invoice_status', 'family_settings'];

const DB = {
  data: null,

  load() {
    try {
      this.data = JSON.parse(localStorage.getItem(DB_KEY)) || null;
    } catch (_) { this.data = null; }
    if (!this.data) {
      this.data = { meta: { seeded: false, lastSync: null } };
      for (const s of STORES) this.data[s] = [];
      this.seed();
    }
    for (const s of STORES) if (!this.data[s]) this.data[s] = [];
    return this.data;
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this.data));
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
      s = { id: this.uuid(), members: ['Joctã', 'Cônjuge'], month_start_day: 1, updated_at: this.now(), deleted: false, dirty: true };
      this.data.family_settings.push(s);
      this.save();
    }
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
  invoicesOf(card) {
    const map = {};
    for (const t of this.all('transactions')) {
      if (t.card_id !== card.id || !t.invoice_key) continue;
      if (!map[t.invoice_key]) map[t.invoice_key] = { key: t.invoice_key, total: 0, count: 0 };
      map[t.invoice_key].total += Number(t.amount) || 0;
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
  txOfPeriod(period) {
    return this.all('transactions').filter(t => this.inPeriod(t.date, period));
  },

  spentByCategory(period) {
    const out = {};
    for (const t of this.txOfPeriod(period)) {
      const k = t.category_id || '_sem';
      out[k] = (out[k] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  goalTotal(goalId) {
    return this.all('goal_entries').filter(e => e.goal_id === goalId)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
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
  seed() {
    if (this.data.meta.seeded) return;
    const cat = (name, icon, budget, scope = 'Família') =>
      ({ id: this.uuid(), name, icon, monthly_budget: budget, scope, updated_at: this.now(), deleted: false, dirty: true });
    this.data.categories = [
      cat('Moradia', '🏠', 1800), cat('Alimentação / Mercado', '🍽️', 1500),
      cat('Transporte', '🚗', 500), cat('Saúde', '💊', 400),
      cat('Lazer', '🎮', 350), cat('Assinaturas', '🔁', 150),
      cat('Educação', '📚', 300), cat('Gastos Pessoais', '👤', 600, 'Pessoal'),
    ];
    this.data.meta.seeded = true;
    this.save();
  },
};
