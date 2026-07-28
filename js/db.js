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
  // extraivel: necessário para guardar a chave na sessão da aba (ver Auth.guardarSessao)
  async deriveKey(pin, saltB64, iterations = 150000, extraivel = false) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.unb64(saltB64), iterations, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, extraivel, ['encrypt', 'decrypt']);
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
    this.lembrarRotulo(this.familyName());   // deixa o rótulo pronto para o próximo bloqueio
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

  // Enquanto os dados estão cifrados (antes do PIN), não há o que ler: devolve vazio
  // em vez de estourar. A tela de bloqueio roda exatamente nesse estado.
  all(store) { return this.data ? this.data[store].filter(r => !r.deleted) : []; },

  get(store, id) {
    if (!this.data) return null;
    return this.data[store].find(r => r.id === id && !r.deleted) || null;
  },

  upsert(store, record) {
    if (!this.data) throw new Error('Dados bloqueados — desbloqueie antes de gravar');
    record.id = record.id || this.uuid();
    record.updated_at = this.now();
    record.deleted = !!record.deleted;
    record.dirty = true;
    const i = this.data[store].findIndex(r => r.id === record.id);
    if (i >= 0) this.data[store][i] = { ...this.data[store][i], ...record };
    else this.data[store].push(record);
    // Mantém a cópia do rótulo em dia, inclusive quando ele chega pela sincronização
    if (store === 'family_settings' && record.family_name !== undefined) this.lembrarRotulo(record.family_name);
    this.save();
    return record.id;
  },

  remove(store, id) {
    if (!this.data) return;
    const r = this.data[store].find(x => x.id === id);
    if (r) { r.deleted = true; r.updated_at = this.now(); r.dirty = true; this.save(); }
    // Apagar um envelope sem levar as subcategorias deixaria filhas apontando para
    // um pai que não existe mais — órfãs invisíveis na tela e vivas no banco.
    if (store === 'categories') {
      for (const filha of this.subcategoriesOf(id)) {
        filha.deleted = true; filha.updated_at = this.now(); filha.dirty = true;
      }
      this.save();
    }
  },

  /* ---------- Categorias em dois níveis ----------
     Sem parent_id, a categoria é um envelope: é nela que vive o orçamento.
     Com parent_id, é uma subcategoria — detalha o gasto sem multiplicar
     envelopes, então "Mercado" e "Restaurante" somam no limite de
     "Alimentação". Dois níveis bastam: a terceira camada só traria trabalho
     de manutenção sem melhorar nenhuma decisão de dinheiro. */
  rootCategories() { return this.all('categories').filter(c => !c.parent_id); },
  subcategoriesOf(parentId) {
    if (!parentId) return [];
    return this.all('categories').filter(c => c.parent_id === parentId);
  },

  // De qualquer categoria para o envelope que a governa (ela mesma, se for raiz)
  categoryRoot(id) {
    const c = this.get('categories', id);
    if (!c) return null;
    if (!c.parent_id) return c;
    return this.get('categories', c.parent_id) || c;   // pai apagado: ela vira o próprio envelope
  },
  categoryRootId(id) { const r = this.categoryRoot(id); return r ? r.id : null; },

  // Categorias que podem receber lançamento: as folhas. Um envelope que já tem
  // subcategorias sai da lista — classificar nele deixaria o detalhe pela metade.
  leafCategories() {
    return this.all('categories').filter(c => c.parent_id || !this.subcategoriesOf(c.id).length);
  },

  // "Alimentação › Mercado" — o caminho todo, porque "Mercado" sozinho não diz de qual envelope saiu
  categoryPath(id) {
    const c = this.get('categories', id);
    if (!c) return '';
    const pai = c.parent_id ? this.get('categories', c.parent_id) : null;
    return pai ? `${pai.name} › ${c.name}` : c.name;
  },
  // O ícone é do envelope: subcategoria herda, para a leitura do extrato ficar estável
  categoryIcon(id) {
    const r = this.categoryRoot(id);
    const c = this.get('categories', id);
    return (c && c.icon) || (r && r.icon) || '';
  },

  /* ---------- Configurações da família ---------- */
  PADRAO: { family_name: '', members: [], month_start_day: 1, monthly_income: 0 },

  settings() {
    if (!this.data) return { ...this.PADRAO };   // bloqueado: valores neutros, sem gravar nada
    let s = this.all('family_settings')[0];
    if (!s) {
      s = { id: this.uuid(), ...this.PADRAO, updated_at: this.now(), deleted: false, dirty: true };
      this.data.family_settings.push(s);
      this.save();
    }
    if (s.monthly_income === undefined) s.monthly_income = 0;
    if (!Array.isArray(s.members)) s.members = [];
    return s;
  },

  /* Nome escolhido por quem usa. Fica também numa cópia fora da parte cifrada,
     para a tela de bloqueio poder cumprimentar pelo nome antes de haver acesso
     aos dados. É só o rótulo do app — nenhum valor ou lançamento sai daqui. */
  ROTULO_KEY: 'financas.rotulo',
  familyName() {
    if (this.data) return (this.settings().family_name || '').trim();
    try { return (localStorage.getItem(this.ROTULO_KEY) || '').trim(); } catch (_) { return ''; }
  },
  familyLabel() { return this.familyName() || 'Minha família'; },
  lembrarRotulo(nome) {
    try {
      if (nome) localStorage.setItem(this.ROTULO_KEY, nome);
      else localStorage.removeItem(this.ROTULO_KEY);
    } catch (_) {}
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
  isTransfer(t) { return !!t && t.type === 'Transferência'; },
  // Transferências entre contas próprias e ajustes de saldo aparecem no extrato
  // (para auditoria), mas não são gasto nem renda — ficam fora de toda análise.
  isNeutral(t) { return !!t && (!!t.adjustment || this.isTransfer(t)); },
  expensesOf(period) { return this.txOfPeriod(period).filter(t => this.isExpense(t) && !this.isNeutral(t)); },
  incomesOf(period) { return this.txOfPeriod(period).filter(t => !this.isExpense(t) && !this.isNeutral(t)); },
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

  /* ---------- Etiquetas ----------
     Texto livre, ao lado da categoria em vez de no lugar dela: categoria responde
     "que tipo de gasto é" e tem orçamento; etiqueta responde "de que assunto isto
     faz parte" e cruza envelopes — uma viagem tem transporte, comida e hospedagem.
     Registro antigo não tem o campo, então tudo aqui tolera ausente. */
  tagsOf(tx) {
    const t = tx && tx.tags;
    return Array.isArray(t) ? t.filter(x => typeof x === 'string' && x.trim()) : [];
  },
  normTag(s) { return String(s || '').trim().replace(/^#+/, '').slice(0, 24); },

  // Todas as etiquetas em uso, das mais usadas para as menos
  allTags() {
    const uso = {};
    for (const t of this.all('transactions')) {
      for (const tag of this.tagsOf(t)) uso[tag] = (uso[tag] || 0) + 1;
    }
    return Object.keys(uso).sort((a, b) => uso[b] - uso[a] || a.localeCompare(b, 'pt-BR'));
  },
  tagCount(tag) {
    return this.all('transactions').filter(t => this.tagsOf(t).includes(tag)).length;
  },

  /* Gasto por envelope: o que foi lançado numa subcategoria sobe para o pai.
     Somar aqui, e não em cada tela, é o que faz donut, ranking, comparativo,
     barras de orçamento, conselheiro e notificação concordarem entre si. */
  spentByCategory(period) {
    const out = {};
    for (const t of this.expensesOf(period)) {
      const k = this.categoryRootId(t.category_id) || '_sem';
      out[k] = (out[k] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  // Detalhe dentro de um envelope. Sem rootId, devolve todas as subcategorias
  // com gasto no período — o que o lançamento apontou, sem subir para o pai.
  spentBySubcategory(period, rootId) {
    const out = {};
    for (const t of this.expensesOf(period)) {
      const c = this.get('categories', t.category_id);
      if (!c || !c.parent_id) continue;
      if (rootId && c.parent_id !== rootId) continue;
      out[c.id] = (out[c.id] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  // Quanto do envelope foi lançado direto nele, sem escolher subcategoria
  spentDirectly(period, rootId) {
    return this.expensesOf(period)
      .filter(t => t.category_id === rootId)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  },

  // Soma dos limites: só os envelopes. Contar pai e filha dobraria o orçamento total.
  budgetTotal() {
    return this.rootCategories().reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0);
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
      if (t.status === 'A Pagar' && !t.card_id && this.isExpense(t) && !this.isNeutral(t)) total += Number(t.amount) || 0;
    return total;
  },

  accountsTotal() {
    return this.all('accounts').filter(a => a.active !== false)
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  },

  // Disponível de verdade: o que está nas contas menos o que já está comprometido.
  available() { return this.accountsTotal() - this.committed(); },

  // A reserva é uma CAIXINHA: dinheiro que a família separou, não uma conta.
  // Ela pode estar espalhada em qualquer conta — o que vale é o quanto foi guardado.
  isReserveGoal(g) { return !!g && (g.kind === 'Reserva' || /reserva/i.test(g.name || '')); },
  reserveGoals() { return this.all('goals').filter(g => this.isReserveGoal(g)); },
  reserveTotal() { return this.reserveGoals().reduce((s, g) => s + this.goalTotal(g.id), 0); },

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

  /* Apaga tudo o que o app guarda neste aparelho.
     Existe porque "limpar dados do app" nas configurações do Android não resolve:
     o app instalado é só um atalho (WebAPK) e o armazenamento pertence ao
     navegador, na origem do site — a limpeza do sistema não o alcança.

     Varre as chaves em vez de listá-las uma a uma: módulo novo que grave
     "financas.*" já entra aqui sozinho, sem ninguém lembrar de atualizar a lista. */
  async apagarTudo() {
    const varrer = dep => {
      try {
        const chaves = [];
        for (let i = 0; i < dep.length; i++) chaves.push(dep.key(i));
        for (const k of chaves) if (k && k.startsWith('financas')) dep.removeItem(k);
      } catch (_) {}
    };
    varrer(localStorage);
    if (typeof sessionStorage !== 'undefined') varrer(sessionStorage);

    // Sem limpar o cache e o service worker, o aparelho reabre na versão antiga
    try {
      if (typeof caches !== 'undefined') {
        const nomes = await caches.keys();
        await Promise.all(nomes.map(n => caches.delete(n)));
      }
    } catch (_) {}
    try {
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (_) {}

    this.data = null; this.key = null; this._encBlob = null; this.locked = false;
    return true;
  },

  /* ---------- Dados de fábrica ---------- */
  // Gasto do período dividido em Necessidades x Desejos (base da regra 50/30/20).
  spentByKind(period) {
    const out = { Essencial: 0, Estilo: 0 };
    for (const t of this.expensesOf(period)) {
      // Necessidade x desejo é decisão do envelope: a subcategoria herda dele,
      // senão uma filha sem kind cairia em "Essencial" e torceria a regra 50/30/20
      const c = this.categoryRoot(t.category_id);
      const kind = (c && c.kind) === 'Estilo' ? 'Estilo' : 'Essencial';
      out[kind] += Number(t.amount) || 0;
    }
    return out;
  },

  /* Envelope (com limite) e suas subcategorias. As filhas não têm limite próprio:
     o teto é do envelope, e é isso que evita orçamento contado duas vezes. */
  ARVORE_PADRAO: [
    [['Moradia', '🏠', 1800, 'Essencial'], ['Aluguel / Financiamento', 'Condomínio', 'Luz', 'Água', 'Gás', 'Internet / TV', 'Manutenção']],
    [['Alimentação', '🍽️', 1500, 'Essencial'], ['Mercado', 'Feira / Açougue', 'Restaurante', 'Delivery', 'Padaria', 'Café / Lanche']],
    [['Transporte', '🚗', 500, 'Essencial'], ['Combustível', 'Aplicativo / Táxi', 'Transporte público', 'Estacionamento', 'Manutenção', 'IPVA / Licenciamento', 'Seguro']],
    [['Saúde', '💊', 400, 'Essencial'], ['Plano de saúde', 'Farmácia', 'Consulta', 'Exames', 'Dentista', 'Academia']],
    [['Lazer', '🎮', 350, 'Estilo'], ['Viagem', 'Cinema / Show', 'Bar', 'Passeio', 'Jogos', 'Hobby']],
    [['Assinaturas', '🔁', 150, 'Estilo'], ['Streaming', 'Música', 'Aplicativos', 'Nuvem', 'Revista / Jornal']],
    [['Educação', '📚', 300, 'Essencial'], ['Escola / Faculdade', 'Curso', 'Material', 'Livros']],
    [['Filhos', '🧒', 400, 'Essencial'], ['Escola', 'Roupas', 'Brinquedos', 'Atividades', 'Saúde']],
    [['Vestuário', '👕', 250, 'Estilo'], ['Roupas', 'Calçados', 'Acessórios']],
    [['Serviços & Taxas', '🧾', 200, 'Essencial'], ['Tarifas bancárias', 'Impostos', 'Seguros', 'Cartório / Documentos', 'Doações']],
    [['Presentes', '🎁', 150, 'Estilo'], ['Aniversários', 'Datas comemorativas']],
    [['Pets', '🐾', 150, 'Essencial'], ['Ração', 'Veterinário', 'Banho e tosa']],
    [['Gastos Pessoais', '👤', 600, 'Estilo', 'Pessoal'], ['Beleza / Cabelo', 'Cuidados pessoais', 'Diversos']],
  ],

  seed() {
    if (this.data.meta.seeded) return;
    const cat = (name, icon, budget, kind, scope = 'Família') =>
      ({ id: this.uuid(), name, icon, monthly_budget: budget, kind, scope, parent_id: null, updated_at: this.now(), deleted: false, dirty: true });

    const lista = [];
    for (const [pai, filhas] of this.ARVORE_PADRAO) {
      const raiz = cat(...pai);
      lista.push(raiz);
      for (const nome of filhas) {
        const f = cat(nome, raiz.icon, 0, raiz.kind, raiz.scope);
        f.parent_id = raiz.id;
        lista.push(f);
      }
    }
    this.data.categories = lista;
    this.data.meta.seeded = true;
    this.save();
  },

  _semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },

  /* Quem já usava o app antes das subcategorias tem só a lista plana, e o seed
     não roda de novo. Isto preenche as subcategorias sugeridas nos envelopes que
     dão para reconhecer pelo nome, sem tocar nos que a família criou por conta.

     Não é automático de propósito: injetar dezenas de categorias na base
     compartilhada sem pedir mudaria os relatórios de todo mundo sem aviso. */
  sugerirSubcategorias() {
    if (!this.data) return 0;
    let criadas = 0;
    for (const raiz of this.rootCategories()) {
      const alvo = this._semAcento(raiz.name);
      const molde = this.ARVORE_PADRAO.find(([pai]) => {
        const nome = this._semAcento(pai[0]);
        return alvo === nome || alvo.includes(nome) || nome.includes(alvo);
      });
      if (!molde) continue;
      const existentes = this.subcategoriesOf(raiz.id).map(c => this._semAcento(c.name));
      for (const nome of molde[1]) {
        if (existentes.includes(this._semAcento(nome))) continue;
        this.upsert('categories', {
          name: nome, icon: raiz.icon, scope: raiz.scope, kind: raiz.kind,
          monthly_budget: 0, parent_id: raiz.id,
        });
        criadas++;
      }
    }
    return criadas;
  },
};
