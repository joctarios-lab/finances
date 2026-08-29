/* Finanças Família — camada de dados local (localStorage, local-first)
   Todas as entidades carregam o envelope de sync: { id, updated_at, deleted, dirty } */
'use strict';

const DB_KEY = 'financas.v1';
const STORES = ['accounts', 'cards', 'categories', 'transactions', 'goals', 'goal_entries', 'invoice_status', 'recurrences', 'family_settings', 'budget_overrides',
  // Cofrinho das crianças — o app delas lê daqui pelo mesmo DB.
  'kids', 'kid_goals', 'kid_tasks', 'kid_entries', 'kid_wishes',
  /* Conversas com o assistente. Mora aqui para herdar as duas coisas que
     importam — a criptografia em repouso e a tela de bloqueio —, mas NÃO está
     em SYNC_TABLES: conversa é do aparelho, não da família. Sincronizá-la
     mandaria texto sobre a vida financeira para a nuvem sem necessidade, e
     inflaria todo pull. js/ia.js escreve direto neste array, sem o envelope de
     sync, e mantém o tamanho sob controle (ver IA.podar). */
  'ia_chats'];

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

  _lote: false,

  /* Uma gravação só para o lote inteiro.

     save() serializa o banco COMPLETO e, com PIN, ainda cifra. Numa edição em
     massa de 200 lançamentos isso seriam 200 serializações e 200 cifragens do
     banco todo — segundos de tela travada no celular, para um resultado que uma
     escrita só entrega igual.

     O finally grava mesmo se algo estourar no meio: com metade do lote já
     alterada em memória, não gravar seria perder o trabalho feito. */
  emLote(fn) {
    const jaEstava = this._lote;
    this._lote = true;
    try { return fn(); } finally {
      this._lote = jaEstava;
      if (!this._lote) this.save();
    }
  },

  save() {
    if (this._lote) return;
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
    this.agendarPonte(store);
    return record.id;
  },

  remove(store, id) {
    if (!this.data) return;
    const r = this.data[store].find(x => x.id === id);
    if (r) { r.deleted = true; r.updated_at = this.now(); r.dirty = true; this.save(); this.agendarPonte(store); }
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
  /* Categoria de entrada é outra coisa que categoria de gasto: "Salário" e
     "Empréstimo recebido" não têm orçamento nem entram no 50/30/20 — dizem de onde
     o dinheiro veio. Por isso um tipo na categoria, e não uma lista só: misturadas,
     as entradas apareceriam nas barras de orçamento pedindo um teto que não existe.

     Sem argumento devolve tudo (a tela de cadastro mostra os dois lados). Passar
     'Despesa' ou 'Receita' é o que separa. */
  rootCategories(tipo) {
    return this.all('categories')
      .filter(c => !c.parent_id && (!tipo || this.categoryType(c) === tipo));
  },
  categoryType(c) { return (c && c.type) === 'Receita' ? 'Receita' : 'Despesa'; },
  isIncomeCategory(id) { return this.categoryType(this.get('categories', id)) === 'Receita'; },

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
  leafCategories(tipo) {
    return this.all('categories').filter(c =>
      (c.parent_id || !this.subcategoriesOf(c.id).length) &&
      (!tipo || this.categoryType(this.categoryRoot(c.id) || c) === tipo));
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
      const pago = this.pagoDaFatura(inv.key);
      const falta = inv.total - pago;
      /* O status vem do que foi PAGO, não de um sim/não guardado à parte: com
         pagamento parcial permitido, um booleano não consegue dizer "faltam
         R$ 300". A marcação manual antiga continua valendo como atalho para
         quem quitou sem registrar o lançamento. */
      const marcada = this.all('invoice_status').find(s => s.invoice_key === inv.key);
      let status = 'Aberta';
      if ((marcada && marcada.paid) || (inv.total > 0 && falta <= 0.005)) status = 'Paga';
      else if (pago > 0.005) status = 'Parcial';
      else if (today > closing) status = 'Fechada';
      return { ...inv, card, closing, due, status, pago, falta: Math.max(0, falta) };
    }).sort((a, b) => a.due - b.due);
  },

  // Lançamentos que PAGAM esta fatura. Não confundir com invoice_key, que diz de
  // qual fatura a compra faz parte — somar os dois inflaria a própria fatura.
  pagamentosDaFatura(key) {
    return this.all('transactions').filter(t => t.pays_invoice === key && t.status === 'Pago');
  },
  pagoDaFatura(key) {
    return this.pagamentosDaFatura(key).reduce((s, t) => s + (Number(t.amount) || 0), 0);
  },

  setInvoicePaid(key, paid) {
    const rec = this.all('invoice_status').find(s => s.invoice_key === key);
    if (rec) this.upsert('invoice_status', { ...rec, paid });
    else this.upsert('invoice_status', { invoice_key: key, paid });
  },

  /* ---------- Agregações ---------- */
  // Um lançamento é despesa por padrão; 'Receita' representa entrada de dinheiro.
  isExpense(t) { return (t && t.type) !== 'Receita'; },

  /* Os lançamentos do período — e, num mês FUTURO, também os previstos.

     Um mês que ainda não chegou não tem lançamento nenhum além do que foi
     agendado à mão. Sem isto, cada objeto das telas mostrava zero por conta
     própria: o KPI de gasto, o donut por categoria, a cascata, a regra 50·30·20, o
     resumo do extrato. Cada um lia daqui e cada um teria de ser corrigido à parte —
     e o que se corrige em oito lugares volta a divergir no nono.

     As virtuais têm forma de transação e `virtual: true`. Não têm id, não são
     gravadas e não existem em `DB.data`: nascem a cada leitura, a partir do
     contrato e do custo fixo, e somem quando o lançamento de verdade aparece.

     SÓ EM PERÍODO INTEIRAMENTE FUTURO. No mês corrente e no passado, o que não foi
     lançado não aconteceu — misturar previsão ali competiria com o fato e faria o
     extrato do mês discordar do extrato do banco.

     Os dois pontos que ESCREVEM a partir daqui estão a salvo por construção: o
     botão de custos fixos sempre lê o mês corrente, e `avgMonthlySpend` e
     `fluxoMensal` só olham meses passados. */
  txOfPeriod(period) {
    const reais = this.all('transactions').filter(t => this.inPeriod(t.date, period));
    if (this.inicioISO(period) <= this.hojeISO()) return reais;
    return reais.concat(this.virtuaisDoPeriodo(period));
  },

  hojeISO() { return this.paraISO(new Date()); },

  /* Os previstos ainda não lançados, com forma de transação.

     `status: 'A Pagar'` não é enfeite: é o que faz o saldo previsto, os totais do
     dia e as regras de "o que ainda vai sair" tratarem o item como compromisso
     futuro, que é o que ele é. */
  virtuaisDoPeriodo(period) {
    return this.previstosNaoLancados(period).map(i => ({
      id: null,
      virtual: true,
      description: i.titulo,
      amount: i.valor,
      date: i.data,
      type: i.receita ? 'Receita' : 'Despesa',
      status: 'A Pagar',
      category_id: i.category_id,
      account_id: i.account_id,
      card_id: null,          // compra no cartão pesa na fatura, não solta
      to_account: null,
      method: i.method,
      scope: i.scope,
      member: i.member,
      tags: '',
      recurring: false, pontual: false,
      adjustment: false,
      invoice_key: '',
      origemPrevista: i.origem,
    }));
  },
  isTransfer(t) { return !!t && t.type === 'Transferência'; },
  // Transferências entre contas próprias e ajustes de saldo aparecem no extrato
  // (para auditoria), mas não são gasto nem renda — ficam fora de toda análise.
  /* Pagamento de fatura é neutro nas análises pelo mesmo motivo que transferência
     é: as compras do cartão JÁ entraram como despesa quando aconteceram. Contar
     também o pagamento somaria o mesmo dinheiro duas vezes — o gasto e a quitação
     da dívida dele. Ele mexe no saldo da conta e aparece no extrato; só não é
     gasto novo. */
  /* A SEMANADA NÃO É GASTO, é troca de dono dentro de casa.

     O dinheiro fica na conta da família e passa a ser da criança. Debitar o saldo
     aqui faria a conta divergir do extrato do banco em uma semanada por semana,
     acumulando — e o defeito só apareceria na conciliação, meses depois, sem
     ninguém ligar à causa.

     Então ela entra na mesma família de `adjustment`, `pays_invoice` e
     transferência: aparece, é registrada, e não move dinheiro. O que reduz o
     dinheiro livre da família é o ACUMULADO no cofrinho (ver `dosFilhos`), que é
     derivado dos lançamentos da criança e por isso nunca desalinha.

     O CICLO FECHA quando a criança gasta: aí o dinheiro sai da casa de verdade, e
     é uma despesa comum, lançada como qualquer outra. Os dois efeitos se cancelam
     no dinheiro livre — o acumulado cai e a despesa entra —, que é exatamente o
     que aconteceu na realidade. */
  /* SEMANADA é o lançamento que ENTREGA o dinheiro à criança — e só ele.

     O teste era `!!t.kid_id`, e isso pegava demais: o GASTO dela também carrega o
     kid_id, e passou a ser tratado como neutro. O efeito foi silencioso e errado —
     a despesa entrava no extrato e o saldo da conta não caía, então a família via a
     compra listada e o dinheiro parado no banco.

     A distinção é de direção. A semanada não move dinheiro: ele fica na conta e
     troca de dono. O gasto move: sai da casa quando a criança compra o sorvete.

     Por isso o teste é o VÍNCULO COM O CONTRATO, e não a presença da criança: só o
     que nasce do contrato da semanada é entrega. */
  isSemanada(t) { return !!t && !!t.kid_id && !!t.recurrence_id; },
  isNeutral(t) { return !!t && (!!t.adjustment || !!t.pays_invoice || this.isSemanada(t) || this.isTransfer(t)); },
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

  /* Este lançamento do extrato já está lançado NESTA conta?

     O FITID é único dentro de uma conta, não entre bancos — dois bancos podem
     emitir o mesmo. Comparar sem olhar a conta faz um lançamento legítimo sumir
     porque "já existe" em outro lugar. Por isso a busca é sempre escopada.

     Sem FITID (banco que não emite), cai para conteúdo exato: mesma conta,
     mesmo dia, mesmo valor, mesma descrição. Exigir os quatro juntos é
     conservador de propósito — duas compras iguais no mesmo dia existem, e
     descartar uma delas seria pior do que a repetida entrar. */
  jaImportado(linha, contaId, cartaoId) {
    const ondeBate = t => (contaId ? t.account_id === contaId : t.card_id === cartaoId);
    if (linha.fitid) {
      return this.all('transactions').some(t => t.fitid === linha.fitid && ondeBate(t));
    }
    const valor = Math.abs(Number(linha.amount) || 0);
    const desc = this._semAcento(linha.memo);
    return this.all('transactions').some(t =>
      ondeBate(t) &&
      t.date === linha.date &&
      Math.abs(Math.abs(Number(t.amount) || 0) - valor) < 0.005 &&
      this._semAcento(t.description) === desc);
  },

  /* ---------- A conta que já estava esperando ----------
     O app lança "A Pagar" sozinho quando a recorrência manda. Dias depois o
     extrato chega trazendo o mesmo aluguel, agora debitado de verdade.

     Sem casar os dois, o mês fica com duas linhas do mesmo aluguel — uma a pagar
     e outra paga — e o comprometido nunca zera. É a duplicação mais provável do
     app inteiro, porque a geração automática CRIA o par de propósito.

     A janela de 5 dias existe porque a data do boleto raramente é a do débito:
     vence sábado, o banco processa segunda. O valor é a âncora — casar só por
     data pegaria a conta errada num dia com vários débitos. */
  aPagarQueCasa(linha, contaId) {
    if (!contaId) return null;
    const valor = Math.abs(Number(linha.amount) || 0);
    if (!(valor > 0)) return null;
    const desc = this._semAcento(linha.memo);
    const candidatos = this.all('transactions').filter(t =>
      t.status === 'A Pagar' && t.account_id === contaId && !t.card_id &&
      this.isExpense(t) && !this.isNeutral(t) &&
      Math.abs(Math.abs(Number(t.amount) || 0) - valor) < 0.005 &&
      Math.abs(Date.parse(String(t.date) + 'T12:00:00') - Date.parse(linha.date + 'T12:00:00')) <= 5 * 86400000);
    if (!candidatos.length) return null;
    /* Com mais de um candidato, prefere o que veio de recorrência e cuja
       descrição se parece — é o caso do aluguel. Sem parecença, o mais próximo
       na data. Devolver o errado seria pior que não casar. */
    const parecido = candidatos.filter(t => {
      const a = this._semAcento(t.description);
      return a === desc || a.includes(desc) || desc.includes(a);
    });
    const pool = parecido.length ? parecido : candidatos;
    if (pool.length > 1 && !parecido.length) return null;   // ambíguo: melhor não adivinhar
    return pool.sort((a, b) =>
      Math.abs(Date.parse(a.date) - Date.parse(linha.date))
      - Math.abs(Date.parse(b.date) - Date.parse(linha.date)))[0];
  },

  /* ---------- A outra perna de uma transferência ----------
     Uma transferência já mexe nos DOIS saldos quando é criada. Então, ao importar
     o extrato da conta que recebeu, o crédito correspondente NÃO pode virar
     lançamento: entraria o mesmo dinheiro duas vezes, e o saldo ficaria alto.

     O FITID não serve aqui: cada banco emite o seu, então a mesma transferência
     tem identificadores diferentes nos dois extratos. O casamento é por conteúdo.

     Duas faixas de confiança, porque errar para cada lado custa coisas
     diferentes. Desmarcar sozinho uma linha legítima faz dinheiro sumir em
     silêncio — foi assim que uma saída de R$ 100 do dia 24 desapareceu, casada
     por engano com uma transferência do dia 25. Deixar passar uma repetida gera
     duplicata, que aparece no saldo e o diagnóstico acha.

     Então: só o MESMO DIA autoriza desmarcar sozinho. De 1 a 3 dias o app avisa
     e deixa a decisão com quem está importando — TED que cai no dia seguinte é
     comum demais para ignorar, e parecida demais para decidir por conta. */
  TOLERANCIA_DIAS: 3,
  TOLERANCIA_CERTEZA: 0,

  /* Procura a transferência cuja perna oposta bate com este lançamento do extrato.
     contaId  — a conta cujo extrato está sendo importado
     ehEntrada — true quando é crédito (a conta RECEBEU)
     usados   — ids já casados nesta importação, para duas transferências iguais
                no mesmo dia não serem casadas pela mesma linha */
  acharPernaDeTransferencia(contaId, dataISO, valor, ehEntrada, usados) {
    if (!contaId || !dataISO) return null;
    const alvo = Math.abs(Number(valor) || 0);
    if (!alvo) return null;
    const dia = Date.parse(dataISO + 'T12:00:00');
    if (isNaN(dia)) return null;
    const jaUsados = usados || new Set();

    const candidatos = this.all('transactions').filter(t => {
      if (!this.isTransfer(t) || jaUsados.has(t.id)) return false;
      // A perna que interessa é a do OUTRO lado: crédito casa com o destino
      const pernaDaConta = ehEntrada ? t.to_account : t.account_id;
      if (pernaDaConta !== contaId) return false;
      if (Math.abs(Math.abs(Number(t.amount) || 0) - alvo) > 0.005) return false;
      const d = Date.parse(String(t.date) + 'T12:00:00');
      return !isNaN(d) && Math.abs(d - dia) <= this.TOLERANCIA_DIAS * 86400000;
    });
    if (!candidatos.length) return null;
    // A mais próxima da data do extrato é a mais provável
    candidatos.sort((a, b) =>
      Math.abs(Date.parse(a.date + 'T12:00:00') - dia) - Math.abs(Date.parse(b.date + 'T12:00:00') - dia));
    const achado = candidatos[0];
    const distancia = Math.abs(Date.parse(achado.date + 'T12:00:00') - dia) / 86400000;
    // O chamador precisa saber o quanto confiar: só o mesmo dia é certeza
    achado._certeza = distancia <= this.TOLERANCIA_CERTEZA;
    return achado;
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

  /* Etiquetas ordenadas por relevância, para OFERECER — nunca para aplicar sozinho.
     Herdar a etiqueta do último lançamento parecia esperto e não é: gasto
     esporádico é o caso mais comum de etiqueta ("essa compra eu quero separar do
     resto"), e nele o lançamento anterior não tem relação nenhuma. Aplicar sozinho
     erra justamente onde a etiqueta mais serve, e erra em silêncio.

     A ordenação combina quanto se usa e há quanto tempo: etiqueta de uso constante
     fica no topo, e uma que voltou a ser usada ontem sobe na frente de uma
     abandonada meses atrás. É o que os apps do ramo fazem — o que fixa etiqueta
     para uma sequência é uma escolha explícita, não adivinhação. */
  tagsRelevantes(limite = 8) {
    const agora = Date.now();
    const escore = {};
    for (const t of this.all('transactions')) {
      const tags = this.tagsOf(t);
      if (!tags.length) continue;
      const dias = t.updated_at ? Math.max(0, (agora - Date.parse(t.updated_at)) / 86400000) : 999;
      // Meia-vida de 30 dias: uso recente pesa mais, uso antigo continua contando
      const peso = 1 + 2 / (1 + dias / 30);
      for (const tag of tags) escore[tag] = (escore[tag] || 0) + peso;
    }
    return Object.keys(escore)
      .sort((a, b) => escore[b] - escore[a] || a.localeCompare(b, 'pt-BR'))
      .slice(0, limite);
  },

  // Gasto por etiqueta no período: é o que faz a etiqueta valer a pena — ver
  // quanto uma viagem ou uma reforma custou, atravessando os envelopes.
  spentByTag(period) {
    const out = {};
    for (const t of this.expensesOf(period)) {
      for (const tag of this.tagsOf(t)) out[tag] = (out[tag] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  /* Gasto por envelope: o que foi lançado numa subcategoria sobe para o pai.
     Somar aqui, e não em cada tela, é o que faz donut, ranking, comparativo,
     barras de orçamento, conselheiro e notificação concordarem entre si. */
  /* Saldo das contas ANTES de uma data — o que veio do mês anterior.

     Sem isto o mês parecia começar do zero: um junho que sobrou não aparecia em
     julho em lugar nenhum, e a conta do extrato ("entrou menos saiu") nunca
     fechava com o saldo real. É o "saldo anterior" que todo extrato de banco traz
     na primeira linha.

     Calculado de trás para frente: o saldo atual menos tudo que se moveu de lá
     para cá. O saldo atual é o número confiável — vem da conciliação com o banco. */
  saldoNaData(contaIds, dataISO) {
    const contas = (contaIds && contaIds.length)
      ? contaIds
      : this.all('accounts').map(a => a.id);
    const atual = contas.reduce((s, id) => s + (Number((this.get('accounts', id) || {}).balance) || 0), 0);
    // Tudo que se moveu de lá para cá, desfeito. O saldo atual é o número
    // confiável — vem da conciliação com o banco.
    const desde = this.movimentoRealizadoAte(contaIds, dataISO, null);
    return atual - (desde.entra - desde.sai);
  },

  /* O QUE JÁ MEXEU NO SALDO entre duas datas, separado em entra e sai.

     É o irmão realizado de `movimentoPrevistoAte`, e existe pelo mesmo motivo: o
     cartão do Extrato mostra "abriu com X, entrou Y, saiu Z, hoje tem W" e as
     quatro coisas precisam vir da MESMA regra, senão a linha não fecha com o
     saldo logo abaixo dela. Por construção,
     `saldoNaData(fim) − saldoNaData(início) = entra − sai`.

     Fala de CAIXA, não de gasto: compra no cartão não sai da conta (fica na
     fatura) e por isso não entra aqui, enquanto o pagamento da fatura entra. A
     conciliação também entra, de propósito — ela mexe no saldo de verdade, e foi
     justamente ela que já fez o extrato discordar do saldo da conta.

     `deISO`/`ateISO` são opcionais: sem eles, a janela é aberta daquele lado. */
  movimentoRealizadoAte(contaIds, deISO, ateISO) {
    const contas = (contaIds && contaIds.length) ? contaIds : this.all('accounts').map(a => a.id);
    const dentro = id => contas.includes(id);
    const mov = { entra: 0, sai: 0 };
    for (const t of this.all('transactions')) {
      if (t.status !== 'Pago') continue;              // a pagar ainda não mexeu no saldo
      const d = String(t.date);
      if (deISO && d < deISO) continue;
      if (ateISO && d >= ateISO) continue;
      const v = Number(t.amount) || 0;
      if (this.isTransfer(t)) {
        /* Transferência interna ao conjunto se anula: sai de um lado, entra no
           outro. Fora dele, é entrada ou saída de verdade — é assim que o extrato
           do banco de UMA conta mostra. */
        const daqui = dentro(t.account_id), praca = dentro(t.to_account);
        if (daqui && !praca) mov.sai += v;
        else if (praca && !daqui) mov.entra += v;
        continue;
      }
      /* A SEMANADA NÃO É CAIXA. Este laço fala de dinheiro que atravessou a conta,
         e o dela não atravessou: ficou no banco e trocou de dono.

         Contá-la aqui romperia a identidade que a própria função promete acima —
         `saldoNaData(fim) − saldoNaData(início) = entra − sai`. O saldo não se
         mexe com a semanada (ver txEffect), então somá-la em "saiu" faria o cartão
         do Extrato mostrar uma saída que o saldo abaixo não confirma. */
      if (this.isSemanada(t)) continue;
      if (!dentro(t.account_id)) continue;
      if (this.isExpense(t)) mov.sai += v; else mov.entra += v;
    }
    return mov;
  },

  /* Saldo numa data, contando o que está AGENDADO quando a data é futura.

     saldoNaData sozinha olha só para trás: parte do saldo real e desfaz o que já
     foi pago. Para uma data futura ela devolve o saldo de hoje, ignorando salário
     e contas agendadas — foi o defeito relatado, com o extrato de agosto mostrando
     receita de R$ 6.200 na lista e saldo inalterado no topo.

     Aqui o passado continua vindo do saldo real (é o número confiável, vem da
     conciliação) e o futuro soma o que está previsto para acontecer até lá. */
  /* O QUE AINDA VAI MEXER NO SALDO daqui até uma data futura, separado em entra e
     sai. É o miolo de `saldoPrevistoNaData`, extraído para poder ser mostrado.

     O cartão do Extrato dava só o número do fim do período. Num mês que ainda não
     acabou esse número é projeção — em 2 de agosto ele dizia R$ 9.333,63 enquanto
     na conta havia R$ 231,35 — e não havia como conferir de onde ele vinha. Com as
     duas parcelas à vista a conta fecha na tela.

     Extrair em vez de recalcular na view é o ponto: as duas coisas saem daqui, então
     a soma exibida não tem como discordar da projeção. Uma cópia divergiria no
     primeiro ajuste, que é como já nasceram três defeitos neste código.

     Sem `desdeISO`, a janela inclui o VENCIDO de ciclos anteriores — é dinheiro
     que ainda vai sair, e ignorá-lo faria o saldo previsto ser otimista. Com
     `desdeISO`, ela se fecha naquele começo: é como o cartão do Extrato separa o
     que vence DENTRO do período (e portanto está na lista logo abaixo) do que
     ficou para trás. Um número que não se confere na própria tela não decide nada. */
  movimentoPrevistoAte(contaIds, dataISO, desdeISO) {
    const mov = { entra: 0, sai: 0 };
    for (const dia of Object.values(this.previstoPorDia(contaIds, dataISO, desdeISO))) {
      mov.entra += dia.entra; mov.sai += dia.sai;
    }
    return mov;
  },

  /* O MESMO, dia a dia. O gráfico do Extrato precisa saber QUANDO cada coisa
     acontece, não só o total: sem isso ele desenhava uma reta em todo mês que
     ainda não terminou — 31 pontos com um valor só em agosto, 30 em setembro —,
     porque só somava o que já foi pago, e mês corrente e futuro são feitos do que
     ainda vai acontecer.

     Um mapa data → { entra, sai }, e o total acima passou a ser a soma dele: a
     linha do gráfico e o número do cartão não têm como discordar, porque saem da
     mesma varredura. */
  previstoPorDia(contaIds, dataISO, desdeISO) {
    const hoje = this.paraISO(new Date());
    const porDia = {};
    if (dataISO <= hoje) return porDia;          // no passado não há previsão, há fato
    const noDia = d => (porDia[d] = porDia[d] || { entra: 0, sai: 0 });

    const contas = (contaIds && contaIds.length) ? contaIds : this.all('accounts').map(a => a.id);
    const dentro = id => contas.includes(id);

    for (const t of this.all('transactions')) {
      if (t.status !== 'A Pagar' || t.card_id) continue;
      // Vencido e não pago entra também: é dinheiro que ainda vai sair
      if (String(t.date) >= dataISO) continue;
      if (desdeISO && String(t.date) < desdeISO) continue;
      /* TRANSFERÊNCIA AGENDADA é neutra para a família — o dinheiro só muda de
         bolso —, mas não para uma conta olhada sozinha: ali ela entra ou sai de
         verdade, exatamente como no extrato do banco.

         Medido: o extrato do C6 Invest listava R$ 3.400 de aporte a caminho e
         mostrava saldo previsto inalterado no topo. A diferença aparecia disfarçada
         de "conciliação", que é o nome de outra coisa. `saldoNaData` já tratava
         assim o que foi PAGO; aqui faltava o mesmo para o que está agendado.

         Entre duas contas do próprio recorte não há movimento — mesma regra do
         efeitoDaTransferencia, que é quem monta a lista logo abaixo do total. */
      if (this.isTransfer(t)) {
        if (!(contaIds && contaIds.length)) continue;
        const v = Number(t.amount) || 0;
        const daqui = dentro(t.account_id), praca = dentro(t.to_account);
        if (daqui && !praca) noDia(t.date).sai += v;
        else if (praca && !daqui) noDia(t.date).entra += v;
        continue;
      }
      if (this.isNeutral(t)) continue;
      /* Lançamento SEM CONTA pertence ao conjunto todo, e por isso entra quando não
         há recorte — a mesma regra que o laço dos previstos, logo abaixo, já usava.
         Aqui ela faltava: um boleto agendado sem conta escolhida (o formulário
         permite) sumia da projeção, e o saldo do extrato deixava de bater com a
         soma das próprias linhas. Medido: R$ 450 de IPTU a pagar não mexiam num
         saldo previsto de R$ 17.000. */
      if (t.account_id ? !dentro(t.account_id) : (contaIds && contaIds.length)) continue;
      const v = Number(t.amount) || 0;
      if (this.isExpense(t)) noDia(t.date).sai += v; else noDia(t.date).entra += v;
    }

    /* CONTRATO E CUSTO FIXO que ainda não viraram lançamento.

       Sem isto o saldo do extrato de um mês futuro contava só o que estava
       agendado à mão: o extrato de setembro listava o salário e o aluguel na
       lista, mas o saldo no topo os ignorava — a soma das linhas não fechava com
       o número acima delas, que é o defeito mais grave que um extrato pode ter.

       Varre mês a mês em vez de pedir um período só: `previstosNaoLancados`
       trabalha por ciclo, e a data alvo pode estar a seis meses daqui. O limite de
       24 é fôlego de sobra para o horizonte de 6 meses das telas e impede laço
       infinito se a data vier absurda. */
    for (let i = 0; i < 24; i++) {
      const p = this.monthPeriod(new Date(), i);
      if (this.inicioISO(p) >= dataISO) break;
      if (this.fimISO(p) <= hoje) continue;      // ciclo já encerrado não tem previsão
      for (const it of this.previstosNaoLancados(p)) {
        if (String(it.data) >= dataISO || String(it.data) <= hoje) continue;
        if (desdeISO && String(it.data) < desdeISO) continue;
        // Sem conta definida, o item pertence ao conjunto todo: só entra quando
        // não há recorte de contas, senão apareceria em qualquer conta filtrada
        if (it.account_id ? !dentro(it.account_id) : (contaIds && contaIds.length)) continue;
        const v = Number(it.valor) || 0;
        if (it.receita) noDia(it.data).entra += v; else noDia(it.data).sai += v;
      }
    }

    /* Fatura conta pelo VENCIMENTO, e é o que faltava para o extrato de um mês
       futuro fechar: a compra no cartão não sai da conta quando é feita, sai
       quando a fatura é paga. */
    for (const card of this.all('cards').filter(c => c.active !== false)) {
      const contaPgto = card.account_id;
      if (contaPgto && !dentro(contaPgto)) continue;
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        if (this.paraISO(inv.due) >= dataISO) continue;
        if (desdeISO && this.paraISO(inv.due) < desdeISO) continue;
        noDia(this.paraISO(inv.due)).sai += Math.max(0, inv.falta);
      }
    }
    return porDia;
  },

  saldoPrevistoNaData(contaIds, dataISO) {
    const hoje = this.paraISO(new Date());
    /* A base é o saldo no INÍCIO da data pedida, sempre — não o de hoje.

       `saldoNaData(contas, D)` parte do saldo atual e desfaz tudo com data >= D.
       Passando `hoje` para uma data futura, ela desfazia os lançamentos de HOJE,
       que já aconteceram e já estão no saldo da conta: um gasto lançado hoje não
       aparecia no "abre em contas" do mês que vem.

       Medido: R$ 100 de mercado pagos em 31/07 deixavam a conta em R$ 326, e
       agosto abria com R$ 426 — o gasto do dia sumia da projeção inteira, porque
       todos os meses seguintes rolam a partir daí. */
    const base = this.saldoNaData(contaIds, dataISO);
    if (dataISO <= hoje) return base;
    const mov = this.movimentoPrevistoAte(contaIds, dataISO);
    return base + mov.entra - mov.sai;
  },

  /* Migra fatura marcada como paga no caminho ANTIGO para lançamento de verdade.

     Antes da versão 63, pagar fatura era um adjustBalance silencioso: o saldo da
     conta caía e nada no extrato explicava. O efeito colateral é pior do que
     parece — saldoNaData trabalha de trás para frente a partir do saldo atual, e
     sem lançamento para desfazer ela devolve um SALDO ANTERIOR errado. No teste,
     um julho que começou com R$ 4.000 aparecia como R$ 3.200.

     Consertar isso caso a caso em cinco telas seria remendo. Aqui a fatura vira o
     lançamento que ela sempre deveria ter sido, e todos os caminhos passam a
     funcionar de graça: extrato, total do dia, saldo anterior e projeção.

     SEM applyTxEffect de propósito: o saldo já foi debitado quando a pessoa
     marcou como paga. Aplicar de novo cobraria a fatura duas vezes. */
  migrarFaturasPagasAntigas() {
    const marcadas = this.all('invoice_status').filter(s => s.paid);
    if (!marcadas.length) return 0;
    const jaTemLancamento = new Set(this.all('transactions')
      .filter(t => t.pays_invoice).map(t => t.pays_invoice));
    let n = 0;
    this.emLote(() => {
      for (const s of marcadas) {
        const chave = s.invoice_key;
        if (!chave || jaTemLancamento.has(chave)) continue;
        const card = this.get('cards', String(chave).split(':')[0]);
        if (!card) continue;
        const inv = this.invoicesOf(card).find(i => i.key === chave);
        /* `falta`, não `total`: se houver pagamento parcial a chave já está em
           jaTemLancamento e nem chegamos aqui — mas usar o saldo devedor deixa a
           intenção explícita e protege se essa guarda mudar. */
        if (!inv || !(inv.falta > 0.005)) continue;
        /* A data é o VENCIMENTO: o caminho antigo não guardava quando o pagamento
           foi feito, e o vencimento é a única data que a fatura conhece. */
        this.upsert('transactions', {
          description: `Fatura ${card.name} — ${this.rotuloMesDaChave(chave)}`,
          amount: inv.falta,
          date: this.paraISO(inv.due),
          type: 'Despesa', status: 'Pago',
          scope: 'Família', member: '', method: 'Fatura',
          account_id: card.account_id || null, card_id: null, category_id: null,
          pays_invoice: chave,
          notes: 'Pagamento recuperado de versão anterior do app — a data é a do vencimento.',
        });
        n++;
      }
    });
    return n;
  },

  rotuloMesDaChave(chave) {
    const mes = String(chave).split(':')[1] || '';
    const [a, m] = mes.split('-');
    if (!a || !m) return mes;
    return new Date(Number(a), Number(m) - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  },

  /* Faturas que vencem dentro de um período, para aparecerem no extrato dele.

     Elas não são transações — são derivadas das compras. Mas o dinheiro sai da
     conta no vencimento, e um extrato de agosto sem a fatura de agosto esconde a
     maior saída do mês. */
  faturasDoPeriodo(period, contaIds) {
    const de = this.inicioISO(period), ate = this.fimISO(period);
    const fora = [];
    for (const card of this.all('cards').filter(c => c.active !== false)) {
      if (contaIds && contaIds.length && card.account_id && !contaIds.includes(card.account_id)) continue;
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        const vence = this.paraISO(inv.due);
        if (vence < de || vence >= ate) continue;
        fora.push({ ...inv, venceISO: vence });
      }
    }
    return fora.sort((a, b) => a.venceISO.localeCompare(b.venceISO));
  },

  // Data de início do período no formato do banco, para comparar com t.date
  inicioISO(period) {
    const d = period.start;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // period.end é exclusivo, então esta é a data do primeiro dia FORA do período:
  // o saldo nela é justamente o saldo de fechamento deste mês
  fimISO(period) {
    const d = period.end;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

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

  /* ---------- Orçamento: o padrão e o ajuste do mês ----------

     `categories.monthly_budget` é o orçamento PADRÃO — quanto costuma caber
     naquele envelope num mês qualquer. `budget_overrides` responde outra
     pergunta: e NESTE mês? O IPVA cai em janeiro, a matrícula em agosto, e num
     mês aperta-se um envelope para reforçar outro.

     A chave do ajuste é o PRIMEIRO DIA DO CICLO, não um rótulo "AAAA-MM": o dia
     de virada é configurável (`month_start_day`), e um rótulo de mês-calendário
     cairia no mês errado para quem fecha o ciclo no dia 25.

     Toda leitura de orçamento no app passa por aqui. Enquanto o valor morava
     direto na categoria, cada tela lia `c.monthly_budget` por conta própria — o
     que já produzia uma inconsistência: a folha do envelope mostrava o GASTO do
     mês navegado contra o LIMITE atemporal. */
  chaveDoCiclo(period) { return this.inicioISO(period || this.monthPeriod(new Date())); },

  overrideDeOrcamento(categoryId, period) {
    const chave = this.chaveDoCiclo(period);
    return this.all('budget_overrides')
      .find(o => o.category_id === categoryId && String(o.period_start) === chave) || null;
  },

  /* O orçamento que vale para uma categoria num ciclo: o ajuste, se existir;
     senão o padrão. `0` é um ajuste legítimo — "neste mês não se gasta nada
     aqui" —, então o teste é pela EXISTÊNCIA do registro, nunca pela verdade do
     valor. Com `||` um ajuste de zero cairia de volta no padrão em silêncio. */
  budgetOf(categoryId, period) {
    const o = this.overrideDeOrcamento(categoryId, period);
    if (o) return Number(o.amount) || 0;
    const c = this.get('categories', categoryId);
    return c ? Number(c.monthly_budget) || 0 : 0;
  },

  // Soma dos limites: só os envelopes de GASTO. Contar pai e filha dobraria o
  // total; incluir entrada somaria um teto que não existe.
  budgetTotal(period) {
    return this.rootCategories('Despesa').reduce((s, c) => s + this.budgetOf(c.id, period), 0);
  },

  /* ---------- Investimentos: o envelope que não é gasto ----------

     O aporte é TRANSFERÊNCIA, não despesa: o dinheiro sai da conta corrente e
     aparece na de investimento. Tratá-lo como gasto faria o donut dizer "gastei
     3.400 com investimento" e a taxa de poupança despencar justamente no mês em
     que se poupou mais.

     Mas o plano do mês precisa de um teto — "quanto pretendo guardar" é uma linha
     de orçamento como qualquer outra. A saída é medir o USADO deste envelope
     pelos APORTES, não pelo gasto: quem sabe quanto foi guardado é `goal_entries`.

     Resgate não abate: guardar 2.000 e precisar tirar 500 no fim do mês são dois
     fatos distintos, e compensá-los diria que se guardou 1.500 — apagando o
     esforço e o imprevisto de uma vez. */
  envelopeDeInvestimento() {
    return this.rootCategories('Despesa').find(c => /investiment/i.test(c.name)) || null;
  },

  /* A subcategoria em que a movimentação de uma meta deve cair.

     Reserva de emergência e objetivo são coisas diferentes na hora de olhar para
     trás — "guardei 24 mil no ano" não diz se foi para o colchão ou para a
     viagem. A separação existe no envelope, e é aqui que ela é escolhida sem que
     ninguém precise lembrar de fazê-lo à mão. */
  categoriaDeAporte(goal) {
    const env = this.envelopeDeInvestimento();
    if (!env) return null;
    const filhas = this.subcategoriesOf(env.id);
    const alvo = this.isReserveGoal(goal) ? /reserva/i : /objetivo|meta/i;
    const achou = filhas.find(c => alvo.test(c.name));
    return (achou || filhas[0] || env).id;
  },

  /* Em período INTEIRAMENTE FUTURO, o aporte agendado conta: ali não existe
     "realizado", e o previsto é a única informação que há — a mesma regra das
     transações virtuais (ver docs/plano-visao-futuro.md). No mês corrente e no
     passado, só o que aconteceu: misturar plano com fato faria a barra do
     envelope dizer que se guardou dinheiro que ainda está na conta. */
  investidoNoPeriodo(period) {
    const de = this.inicioISO(period), ate = this.fimISO(period);
    const contaPlanejado = de > this.hojeISO();
    let total = 0;
    for (const e of this.all('goal_entries')) {
      const d = String(e.date);
      if (d < de || d >= ate) continue;
      if (!contaPlanejado && !this.aportePago(e)) continue;
      const v = Number(e.amount) || 0;
      if (v > 0) total += v;
    }
    /* Lançamento posto à mão no envelope também conta — é o caso de quem investe
       fora de uma meta cadastrada. Neutros (a transferência do próprio aporte)
       ficam de fora por construção, e é isso que impede a contagem dobrada de
       quem registra o aporte no app E importa o extrato depois. */
    const env = this.envelopeDeInvestimento();
    if (env) {
      for (const t of this.expensesOf(period)) {
        if (this.categoryRootId(t.category_id) === env.id) total += Number(t.amount) || 0;
      }
    }
    return total;
  },

  /* Grava o ajuste de um ciclo. REUSA o registro existente em vez de criar outro:
     o índice único no banco é (family_id, category_id, period_start), e duas
     linhas para o mesmo par fariam a leitura escolher uma delas em silêncio. */
  ajustarOrcamento(categoryId, period, valor) {
    const existente = this.overrideDeOrcamento(categoryId, period);
    return this.upsert('budget_overrides', {
      ...(existente || {}),
      category_id: categoryId,
      period_start: this.chaveDoCiclo(period),
      amount: Number(valor) || 0,
      deleted: false,
    });
  },

  // Volta ao padrão da categoria naquele ciclo
  limparAjusteDeOrcamento(categoryId, period) {
    const o = this.overrideDeOrcamento(categoryId, period);
    if (o) this.remove('budget_overrides', o.id);
    return !!o;
  },

  /* Muda o padrão VALENDO DAQUI PARA A FRENTE.

     Sem isto, mudar o orçamento de 500 para 800 reescrevia o passado: o relatório
     de um mês fechado passava a comparar o gasto contra um teto que não valia
     lá. Como o app nunca guardou o histórico, a correção é copy-on-write —
     congelar o valor ANTIGO nos ciclos já fechados que têm gasto naquele
     envelope, no momento em que o padrão muda. Só a categoria alterada, e só
     onde houve movimento: nada de materializar o passado inteiro.

     Os ajustes FUTUROS já gravados são apagados: quem diz "de agora em diante é
     800" está justamente revendo o que tinha planejado para a frente. */
  definirOrcamentoPadrao(categoryId, valor, deQualCiclo) {
    const c = this.get('categories', categoryId);
    if (!c) return;
    const base = deQualCiclo || this.monthPeriod(new Date());
    const chaveBase = this.chaveDoCiclo(base);
    const antigo = Number(c.monthly_budget) || 0;

    for (let i = -1; i >= -24; i--) {
      const p = this.monthPeriod(base.start, i);
      if (this.overrideDeOrcamento(categoryId, p)) continue;      // já tem ajuste próprio
      const gastou = this.spentByCategory(p)[categoryId] || 0;
      if (gastou <= 0.005) continue;                              // sem movimento, nada a congelar
      this.ajustarOrcamento(categoryId, p, antigo);
    }
    for (const o of this.all('budget_overrides')) {
      if (o.category_id === categoryId && String(o.period_start) > chaveBase) this.remove('budget_overrides', o.id);
    }
    this.upsert('categories', { ...c, monthly_budget: Number(valor) || 0 });
    this.limparAjusteDeOrcamento(categoryId, base);               // o padrão novo já vale neste ciclo
  },

  /* Entradas por categoria, com o mesmo roll-up do gasto: subcategoria sobe para o
     envelope. Serve para responder de onde vem o dinheiro — e principalmente para
     separar o que é renda do que é empréstimo ou devolução, que entra na conta mas
     não é ganho. */
  incomeByCategory(period) {
    const out = {};
    for (const t of this.incomesOf(period)) {
      if (t.card_id) continue;                    // estorno de cartão não é entrada de dinheiro
      const k = this.categoryRootId(t.category_id) || '_sem';
      out[k] = (out[k] || 0) + (Number(t.amount) || 0);
    }
    return out;
  },

  /* Saldo da meta = aportes menos resgates.

     Resgate é um lançamento de valor NEGATIVO na mesma tabela, não um campo à
     parte: assim o histórico fica em ordem cronológica e o total é sempre uma
     soma — não há como o saldo divergir do que está listado. */
  /* ---------- Aporte: o que já aconteceu e o que está planejado ----------

     Aporte tem status como qualquer lançamento — 'Pago' ou 'A Pagar'. Um aporte
     agendado é PLANO: não mexe em saldo, não conta como guardado e não abate o
     disponível. Sem isso, programar um aporte para o dia 3 debitava a conta hoje,
     a reserva subia por dinheiro que ainda não tinha saído, e o disponível ficava
     negativo — medido: um aporte de R$ 3.400 para 03/08 deixava `available` em
     −3.108 no dia 31/07.

     `aportePago` trata a AUSÊNCIA do campo como pago: todo registro anterior a
     esta coluna já aconteceu, e o contrário faria a reserva inteira desaparecer
     na primeira abertura do app depois da atualização. */
  aportePago(e) { return !e || e.status !== 'A Pagar'; },

  goalTotal(goalId) {
    return this.all('goal_entries')
      .filter(e => e.goal_id === goalId && this.aportePago(e))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  },

  /* O que está PLANEJADO para uma meta e ainda não aconteceu. Serve para a tela
     mostrar o plano sem misturá-lo com o saldo — são duas perguntas diferentes:
     "quanto já tenho" e "quanto pretendo ter". */
  goalPlanejado(goalId) {
    return this.all('goal_entries')
      .filter(e => e.goal_id === goalId && !this.aportePago(e))
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
    /* MÊS QUE AINDA NÃO COMEÇOU: não existe ritmo para extrapolar.

       Aqui `spent` é o mês INTEIRO previsto — em período futuro `expensesOf` traz
       as transações virtuais —, e o run-rate tratava esse total como se fosse o
       gasto de UM dia, multiplicando pelos dias restantes. Medido em agosto/2026:
       R$ 6.737,80 previstos viravam "fechamento projetado R$ 215.610", 1268% das
       receitas, poupança projetada −1168%. Números absurdos o bastante para
       ninguém acreditar, mas errados no mesmo lugar onde os certos aparecem.

       Num mês que não começou a projeção É o previsto, e a média diária é ele
       distribuído pelos dias do mês — não `spent / 1`. */
    if (elapsed === 0) {
      return { spent, count: txs.length, dailyAvg: spent / Math.max(total, 1), projection: spent,
        totalDays: total, elapsedDays: 0, remainingDays: total, naoComecou: true };
    }
    const dailyAvg = spent / Math.max(elapsed, 1);
    const projection = elapsed >= total ? spent : spent + dailyAvg * (total - elapsed);
    return { spent, count: txs.length, dailyAvg, projection, totalDays: total, elapsedDays: elapsed, remainingDays: Math.max(0, total - elapsed) };
  },

  /* A RENDA DO MÊS: o que já entrou mais o que ainda vai entrar nele.

     As porcentagens da tela — regra 50·30·20, taxa de poupança, "% da renda" —
     precisam de uma base, e uma renda declarada uma vez em Configurações envelhece.
     Medido nesta base: declarada R$ 17.000, realidade R$ 31.239 em junho,
     R$ 22.453 em julho, R$ 17.981 em agosto. Aqui a base é o próprio mês, pela
     mesma conta que o Extrato mostra no topo.

     Sem receita nenhuma no mês (base nova, mês em branco), cai para a média dos
     ciclos recentes e, em último caso, para a renda declarada — que continua útil
     como ponto de partida de quem acabou de instalar. */
  rendaDoMes(period) {
    /* `realizedIncome` conta o que está LANÇADO, pago ou a pagar — o nome engana.
       Somar `previsaoDoMes().entra` por cima contava o salário duas vezes: medido,
       R$ 35.813 num mês de R$ 17.981. Falta só o que nem lançamento é ainda.

       Em mês INTEIRAMENTE FUTURO essas ocorrências já vêm como transações
       virtuais dentro de `realizedIncome`, e somá-las aqui dobraria de novo. */
    const lancada = this.realizedIncome(period);
    let naoLancada = 0;
    if (this.inicioISO(period) <= this.hojeISO()) {
      for (const it of this.previstosNaoLancados(period)) if (it.receita) naoLancada += Number(it.valor) || 0;
    }
    const total = lancada + naoLancada;
    if (total > 0.005) return total;
    const media = this.rendaMediaRecente();
    return media > 0 ? media : (Number(this.settings().monthly_income) || 0);
  },

  // Média das receitas dos ciclos ENCERRADOS que tiveram receita. Mês sem nada não
  // entra na média: ele não é um mês pobre, é um mês que não foi usado.
  rendaMediaRecente(quantos = 6) {
    const vals = [];
    for (let i = 1; i <= quantos; i++) {
      const v = this.realizedIncome(this.monthPeriod(new Date(), -i));
      if (v > 0.005) vals.push(v);
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  },

  /* PROJEÇÃO DE GASTO DO MÊS, sem extrapolar o que não se repete.

     O card "Projeção do mês" multiplicava o gasto do mês pelo número de dias
     decorridos. Como aluguel, escola e parcelas caem no começo do ciclo, o "ritmo"
     dos primeiros dias é o custo fixo inteiro — medido em 2 de agosto de 2026:
     R$ 10.503,73 viraram projeção de R$ 162.807,82 e "poupança projetada −671%",
     que o Conselheiro ainda repetia como alerta.

     Pior do que o número: o app já tinha a resposta certa na tela ao lado, em
     `previsaoDoMes`. Eram duas projeções contraditórias no mesmo painel.

     Aqui cada coisa entra uma vez e do jeito que ela é:
       - o que já aconteceu entra pelo valor;
       - o que está lançado para o resto do mês entra pelo valor;
       - contrato e custo fixo que ainda não viraram lançamento entram pelo valor;
       - só o gasto VARIÁVEL é extrapolado, que é o único que se comporta como
         ritmo. Fatura não entra: a compra no cartão já contou como gasto no dia
         em que foi feita, e somar a fatura contaria o mesmo dinheiro duas vezes. */
  /* O QUE É GASTO FIXO, numa regra só: o que foi MARCADO como tal.

     Três sinais explícitos — o vínculo com o contrato, a marca de custo fixo no
     lançamento, e a parcela. Nada de inferir pelo texto.

     ADIVINHAR PELO NOME DO CONTRATO FOI TENTADO E RECUSADO. A ideia era resolver
     o fato de que quase nenhum lançamento tem vínculo (1 em 60 na base real), mas
     casar a descrição contra o nome do contrato erra feio no que vem de extrato
     bancário, onde a descrição carrega o nome do banco e da contraparte. Medido:
     19 lançamentos reclassificados errado, R$ 5.322 no total — R$ 1.400 pagos a
     uma oficina viraram "internet fixa" porque a descrição do Pix diz "PAGSEGURO
     INTERNET IP S.A.", e uma compra em "ARAGUARI" virou conta de água.

     Um número de tela errado é o pior defeito possível aqui, e um palpite que
     acerta às vezes é pior que a ausência dele: quem confere não tem como saber
     quais linhas o app adivinhou.

     A consequência aceita é que o ritmo do variável fica ALTO enquanto os
     lançamentos fixos não estiverem marcados — a projeção erra para o lado
     pessimista, que é o lado seguro. O conserto é marcar o lançamento como custo
     fixo (o formulário e a edição em massa já fazem isso), e aí a projeção
     melhora sozinha. */
  testadorDeGastoFixo() {
    return t => !!t.recurrence_id || !!t.installment;
  },

  /* O CONTRATO ATIVO com o mesmo nome deste lançamento, ou null.

     Serve para OFERECER o vínculo, nunca para aplicá-lo sozinho. A diferença é
     tudo: casar automaticamente por texto já foi tentado e errou 19 lançamentos
     na base real, porque a descrição do extrato traz o nome do banco — "PAGSEGURO
     INTERNET IP S.A." virava internet fixa. Aqui a comparação é do nome INTEIRO,
     não de um trecho, e mesmo assim quem decide é quem usa.

     Ignora o que já tem vínculo ou é parcela: esses já são de contrato. */
  contratoSugeridoPara(t) {
    if (!t || t.recurrence_id || t.installment || t.card_id) return null;
    if (!this.isExpense(t) || this.isNeutral(t)) return null;
    const norm = s => String(s || '').trim().toLowerCase();
    const nome = norm(t.description);
    if (!nome) return null;
    return this.all('recurrences').find(r => r.status === 'ativa' && norm(r.description) === nome) || null;
  },

  /* A CLASSE DE UM GASTO, e o que cada uma decide:

       contrato  veio de `recurrences` (tem `recurrence_id`) ou é parcela. Sai do
                 ritmo e a repetição dele é do CONTRATO, não deste lançamento.
       pontual   aconteceu e não volta — a dentadura, a matrícula, o empréstimo
                 cedido. Sai do ritmo e não repete nada.
       variável  o resto: mercado, combustível, restaurante. É o único extrapolado
                 pelos dias que faltam no mês.

     "Conta fixa" NÃO é um estado do lançamento: é o vínculo com o contrato. Havia
     uma marca paralela (`recurring`) fazendo esse papel, e ela criava duas fontes
     para a mesma pergunta — com o efeito medido de somar uma dentadura de R$ 770
     às contas de setembro E de outubro. Quem é conta fixa se vincula ao contrato,
     que é quem sabe periodicidade, prazo e valor. */
  classeDoGasto(t) {
    if (this.testadorDeGastoFixo()(t)) return 'contrato';
    return t.pontual === true ? 'pontual' : 'variavel';
  },

  /* Quem NÃO entra no ritmo: fixo e pontual. É o testador que a projeção usa, e
     existe separado de `testadorDeGastoFixo` porque as duas perguntas são
     diferentes — "isto se repete?" e "isto se extrapola?". Confundir as duas foi
     o que fez o gasto único não ter onde caber. */
  testadorForaDoRitmo() {
    const ehFixo = this.testadorDeGastoFixo();
    return t => ehFixo(t) || t.pontual === true;
  },

  /* O gasto VARIÁVEL que ainda vai acontecer, em DOIS cenários.

     Um número só fingiria uma precisão que não existe: medido na base real, o
     mesmo mês fecha em +R$ 52 ou em −R$ 9.668 conforme o método escolhido. Então
     a resposta é uma faixa, e cada ponta tem um significado:

       CONTIDO  a mediana do gasto diário. Um dia atípico — a dentadura de R$ 770,
                a compra grande de mercado — não arrasta a projeção do mês inteiro.
       RITMO    a média diária. Conta tudo que aconteceu, inclusive o atípico, e
                por isso é o cenário mais pesado.

     Mês encerrado não tem o que projetar, e mês que ainda não começou não tem
     ritmo para extrapolar — nos dois casos a faixa é zero, e quem chama decide se
     mostra a linha. Extrapolar um mês sem dias decorridos foi o defeito que dava
     "poupança projetada de −671%". */
  variavelProjetado(period) {
    const hoje = this.hojeISO();
    const vazio = { contido: 0, ritmo: 0, diaContido: 0, diaRitmo: 0, dias: 0, decorridos: 0 };
    if (this.fimISO(period) <= hoje) return vazio;
    const decorridos = this.elapsedDays(period);
    const dias = this.periodDays(period) - decorridos;
    if (decorridos === 0 || dias <= 0) return { ...vazio, decorridos };

    const foraDoRitmo = this.testadorForaDoRitmo();
    const porDia = {};
    for (const t of this.expensesOf(period)) {
      if (String(t.date) > hoje || foraDoRitmo(t)) continue;
      porDia[t.date] = (porDia[t.date] || 0) + (Number(t.amount) || 0);
    }
    /* A série cobre TODOS os dias decorridos, inclusive os sem gasto: a mediana
       de "quanto sai por dia" só é honesta se os dias parados entrarem nela. */
    const serie = [];
    for (let i = 0; i < decorridos; i++) serie.push(porDia[this.somarDiasISO(this.inicioISO(period), i)] || 0);
    const diaRitmo = serie.reduce((s, v) => s + v, 0) / decorridos;
    const ord = serie.slice().sort((a, b) => a - b);
    const diaContido = ord[Math.floor(ord.length / 2)] || 0;
    return { contido: diaContido * dias, ritmo: diaRitmo * dias, diaContido, diaRitmo, dias, decorridos };
  },

  projecaoDeGasto(period) {
    const hoje = this.hojeISO();
    const gastos = this.expensesOf(period);
    const soma = f => gastos.filter(f).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    if (this.fimISO(period) <= hoje) {
      const t = soma(() => true);
      return { ateHoje: t, lancadoAVir: 0, naoLancado: 0, variavel: 0, ritmoDiario: 0, total: t, encerrado: true };
    }
    const ateHoje = soma(t => String(t.date) <= hoje);
    const lancadoAVir = soma(t => String(t.date) > hoje);
    /* O que nem lançamento é ainda. Data já vencida fica de fora: se não foi
       lançado e a data passou, não aconteceu — e isso aparece como pendência de
       contrato em `contratosAtrasados`, que é o lugar certo para cobrar. */
    let naoLancado = 0;
    // Em mês inteiramente futuro elas já estão em `gastos`, como transações
    // virtuais: somá-las de novo dobraria o mês inteiro.
    if (this.inicioISO(period) <= hoje) {
      for (const it of this.previstosNaoLancados(period)) {
        if (it.receita || it.origem === 'fatura' || String(it.data) <= hoje) continue;
        naoLancado += Number(it.valor) || 0;
      }
    }
    /* FIXO NÃO SE EXTRAPOLA: ele já está contado acima, inteiro. Vem de contrato,
       de custo fixo marcado ou de parcela — as três coisas que acontecem uma vez
       por ciclo com dia marcado. A regra mora em `testadorDeGastoFixo`, junto com
       o porquê, e é a mesma que `variavelProjetado` usa: duas cópias divergiriam
       na primeira correção que entrasse só de um lado, e aí a projeção de gasto e
       a do hero passariam a discordar sobre o que é fixo. */
    const ehFixo = this.testadorForaDoRitmo();
    const decorridos = Math.max(1, this.elapsedDays(period));
    const restantes = Math.max(0, this.periodDays(period) - this.elapsedDays(period));
    const ritmoDiario = soma(t => String(t.date) <= hoje && !ehFixo(t)) / decorridos;
    const variavel = this.elapsedDays(period) === 0 ? 0 : ritmoDiario * restantes;
    return { ateHoje, lancadoAVir, naoLancado, variavel, ritmoDiario,
      total: ateHoje + lancadoAVir + naoLancado + variavel,
      encerrado: false, naoComecou: this.elapsedDays(period) === 0 };
  },

  /* O VALE DE CAIXA: o dia mais apertado daqui até o fim do horizonte.

     Fechar o mês no azul não impede o boleto do dia 12 de não passar. Esta é a
     única pergunta de risco que nenhuma tela respondia, e o dado para ela já
     existe — é a mesma varredura que desenha a linha do Extrato. */
  valeDeCaixa(meses = 3) {
    const hoje = this.hojeISO();
    const fim = this.fimISO(this.monthPeriod(new Date(), Math.max(0, meses - 1)));
    const mapa = this.previstoPorDia(null, fim);
    let saldo = this.accountsTotal();
    // O vencido pode sair a qualquer momento: entra logo, como na linha do gráfico
    for (const [d, m] of Object.entries(mapa)) if (d <= hoje) saldo += m.entra - m.sai;
    let pior = { valor: saldo, data: hoje }, negativos = saldo < 0 ? 1 : 0;
    for (let d = this.somarDiasISO(hoje, 1); d < fim; d = this.somarDiasISO(d, 1)) {
      const m = mapa[d];
      if (m) saldo += m.entra - m.sai;
      if (saldo < pior.valor) pior = { valor: saldo, data: d };
      if (saldo < 0) negativos++;
    }
    return { valor: pior.valor, data: pior.data, negativos, ate: fim };
  },

  /* PATRIMÔNIO: o que há menos o que se deve.

     A dívida do cartão vem partida em duas porque as duas doem em momentos
     diferentes: a que vence neste ciclo é caixa do mês; a que já foi comprada e
     ainda vai faturar é dívida que nenhuma tela mostrava. Medido: R$ 379,22 agora
     e R$ 1.800,00 espalhados até maio de 2027. */
  patrimonio() {
    const emContas = this.accountsTotal();
    const fimCiclo = this.fimISO(this.monthPeriod(new Date()));
    let cartaoAgora = 0, cartaoDepois = 0;
    for (const card of this.all('cards').filter(c => c.active !== false)) {
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        if (this.paraISO(inv.due) < fimCiclo) cartaoAgora += inv.falta;
        else cartaoDepois += inv.falta;
      }
    }
    return { emContas, investido: this.saldoInvestido(), cartaoAgora, cartaoDepois,
      liquido: emContas - cartaoAgora - cartaoDepois };
  },

  // Quanto cada periodicidade pesa num mês. Sem isto, uma diarista semanal e uma
  // mensalidade de mesmo valor pareceriam custar o mesmo.
  POR_MES: { semanal: 52 / 12, quinzenal: 26 / 12, mensal: 1, anual: 1 / 12 },

  /* O CUSTO FIXO MENSAL e quando cada pedaço dele acaba.

     "Sua parcela acaba em 8 meses e libera R$ 500 por mês" é a informação que faz
     planejar, e ela estava só dentro do cadastro do contrato, um a um. */
  custoFixoMensal() {
    const hoje = this.hojeISO();
    const itens = [];
    for (const r of this.all('recurrences')) {
      /* O FILTRO ERA POR UM STATUS QUE NÃO EXISTE.

         Estava `r.status === 'Encerrada'`, com E maiúsculo. O app grava
         'ativa' | 'pausada' | 'cancelada' — nunca 'Encerrada' —, então a condição
         era falsa sempre e TODO contrato cancelado ou pausado continuava somando
         no custo fixo mensal. Quem cancelou um financiamento continuava vendo o
         peso dele no orçamento, e não havia como desconfiar: o contrato aparecia
         encerrado na tela de contratos e vivo na conta do mês.

         Apareceu ao encerrar o contrato de uma semanada zerada e o valor não
         sair da conta. Listar o que EXCLUI, em vez de exigir `=== 'ativa'`, é o
         lado seguro: registro antigo sem status continua contando, e é o que se
         espera dele. */
      if (r.status === 'pausada' || r.status === 'cancelada' || r.status === 'Encerrada') continue;
      if (r.type === 'Receita') continue;
      const mensal = (Number(r.amount) || 0) * (this.POR_MES[r.periodicidade] || 1);
      let restam = null;                         // null = sem prazo
      if (r.fim_tipo === 'vezes') restam = Math.max(0, (Number(r.fim_vezes) || 0) - (Number(r.geradas) || 0));
      else if (r.fim_tipo === 'data' && r.fim_data) {
        const meses = (Number(String(r.fim_data).slice(0, 4)) - Number(hoje.slice(0, 4))) * 12
          + (Number(String(r.fim_data).slice(5, 7)) - Number(hoje.slice(5, 7)));
        restam = Math.max(0, meses);
      }
      itens.push({ id: r.id, descricao: r.description, mensal, restam, periodicidade: r.periodicidade, origem: 'contrato' });
    }

    /* SÓ CONTRATOS. Os lançamentos marcados `recurring` chegaram a entrar aqui,
       quando eram tratados como fixos; com o contrato virando fonte única eles
       saíram, e com eles a divergência entre esta seção e a tela "Contas fixas". */
    itens.sort((a, b) => b.mensal - a.mensal);
    return { total: itens.reduce((s, i) => s + i.mensal, 0), itens };
  },

  /* VIGIA DOS CONTRATOS — o que roda sozinho precisa de quem olhe.

     O gerador criou uma parcela do Fiat duas vezes e quem percebeu foi o dono da
     casa, no olho, um mês depois. Com 11 contratos rodando, isso é manutenção.

     Duplicata: dois lançamentos do MESMO nome, MESMO valor, dentro da janela de
     uma ocorrência do contrato. Exigir o mesmo valor e a existência do contrato é
     o que separa "a parcela veio duas vezes" de "fui ao mercado duas vezes". */
  duplicatasDeContrato(period) {
    const contratos = this.all('recurrences');
    const chaveDe = t => String(t.description || '').trim().toLowerCase();
    const porNome = {};
    for (const t of this.txOfPeriod(period)) {
      if (t.virtual || t.card_id || this.isNeutral(t)) continue;
      (porNome[chaveDe(t)] = porNome[chaveDe(t)] || []).push(t);
    }
    const achados = [];
    for (const [nome, lista] of Object.entries(porNome)) {
      if (lista.length < 2) continue;
      const contrato = contratos.find(r => String(r.description || '').trim().toLowerCase() === nome)
        || contratos.find(r => lista.some(t => t.recurrence_id === r.id));
      if (!contrato) continue;                   // sem contrato por trás, repetir é normal
      const janela = this.janelaDaOcorrencia(contrato);
      const ordenada = [...lista].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (let i = 1; i < ordenada.length; i++) {
        const dif = Math.abs(Date.parse(ordenada[i].date + 'T12:00:00')
          - Date.parse(ordenada[i - 1].date + 'T12:00:00')) / 86400000;
        const mesmoValor = Math.abs((Number(ordenada[i].amount) || 0) - (Number(ordenada[i - 1].amount) || 0)) < 0.005;
        if (dif <= janela && mesmoValor) {
          achados.push({ descricao: ordenada[i].description, data: ordenada[i].date,
            valor: Number(ordenada[i].amount) || 0, quantas: ordenada.length });
          break;                                 // um aviso por contrato basta
        }
      }
    }
    return achados;
  },

  /* O contrário da duplicata: o contrato que DEVIA ter lançado e não lançou. Sai
     de graça de `previstosNaoLancados` — é o que já venceu e não tem lançamento. */
  contratosAtrasados(period) {
    const hoje = this.hojeISO();
    return this.previstosNaoLancados(period)
      .filter(it => String(it.data) <= hoje && it.origem !== 'fatura');
  },

  /* Comprometido = o que já está lançado e vence ATÉ O FIM DO CICLO ATUAL.

     O horizonte não é detalhe: sem ele, uma conta que vence em setembro pesa
     igual à que vence amanhã, e o disponível fica menor do que a realidade do
     mês. Com ele, o disponível responde "quanto posso gastar até o fim do mês",
     que é a pergunta de quem abre o app.

     Só o que foi LANÇADO entra. Custo fixo que ainda não virou lançamento não é
     estimado aqui de propósito — a resposta para isso é a geração automática das
     recorrências, não um palpite. */
  committed(ateISO) {
    /* Comprometido do mês = o que VENCE no mês, fatura incluída.

       Eu tinha feito a fatura contar sempre, argumentando que é dinheiro já
       gasto. O argumento é verdadeiro, mas responde outra pergunta: comprometido
       alimenta "quanto posso gastar até o fim do mês", e uma fatura que vence dia
       5 de agosto não sai do caixa em julho.

       O risco de a fatura desaparecer da vista — que era a razão da regra antiga
       — agora tem lugar próprio: committedDepois a mostra, e a projeção diz em
       que dia ela derruba o saldo. Cada número responde uma coisa só. */
    let total = 0;
    for (const inv of this.faturasAbertas(ateISO)) total += Math.max(0, inv.falta);
    for (const t of this.txsAPagar(ateISO)) total += Number(t.amount) || 0;
    return total;
  },

  // Faturas não pagas que vencem ANTES do limite. Com pagamento parcial, o que
  // pesa é o que falta — não a fatura inteira.
  faturasAbertas(ateISO, deISO) {
    const limite = ateISO || this.fimISO(this.monthPeriod(new Date()));
    const fora = [];
    for (const card of this.all('cards').filter(c => c.active !== false))
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        const vence = this.paraISO(inv.due);
        if (vence >= limite) continue;
        if (deISO && vence < deISO) continue;
        fora.push(inv);
      }
    return fora;
  },

  /* Lançamentos a pagar (fora de cartão) que vencem dentro do horizonte.

     Sem o corte, uma conta de setembro pesa igual à de amanhã e o disponível
     fica menor que a realidade do mês. */
  txsAPagar(ateISO) {
    const limite = ateISO || this.fimISO(this.monthPeriod(new Date()));
    return this.all('transactions').filter(t =>
      t.status === 'A Pagar' && !t.card_id && this.isExpense(t) && !this.isNeutral(t)
      && String(t.date) < limite);
  },

  // O que vence DEPOIS do horizonte — sai do comprometido, mas não do mundo:
  // aparece à parte para ninguém ser pego de surpresa
  /* O que vence DEPOIS do ciclo atual, dentro do horizonte de projeção.

     O HORIZONTE não é detalhe: uma recorrência "até eu cancelar" não tem soma
     finita, então "tudo daqui pra frente" é um número que não existe. Seis meses é
     o mesmo horizonte que as telas navegam — o que o app afirma conhecer.

     Conta três coisas: lançamentos "A Pagar", faturas em aberto e o que ainda vai
     virar lançamento (contrato e custo fixo). A terceira faltava, e por isso o
     número da frase do painel ficava MENOR que as saídas do mês seguinte: um
     aluguel que se repete aparecia lá e sumia daqui. */
  committedDepois(ateISO, mesesHorizonte = 6) {
    const limite = ateISO || this.fimISO(this.monthPeriod(new Date()));
    let total = this.all('transactions')
      .filter(t => t.status === 'A Pagar' && !t.card_id && this.isExpense(t) && !this.isNeutral(t)
        && String(t.date) >= limite)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);

    /* Contrato e custo fixo que ainda não viraram lançamento, ciclo a ciclo.

       Quem limita o horizonte é o próprio laço: `previstosNaoLancados(p)` só
       devolve itens de dentro do ciclo `p`, então um teto por data seria uma
       segunda trava que nunca dispara — código que parece proteger e não protege é
       pior que código nenhum, porque quem lê confia nele. */
    for (let i = 0; i <= mesesHorizonte; i++) {
      for (const it of this.previstosNaoLancados(this.monthPeriod(new Date(), i))) {
        if (it.receita) continue;              // aqui só o que SAI
        if (String(it.data) < limite) continue;
        total += Number(it.valor) || 0;
      }
    }
    /* Faturas também. Sem isto, tirar a fatura do comprometido do mês a faria
       desaparecer das DUAS contas — e uma fatura invisível é o pior lugar
       possível para uma dívida existir. */
    for (const card of this.all('cards').filter(c => c.active !== false))
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        if (this.paraISO(inv.due) < limite) continue;
        total += Math.max(0, inv.falta);
      }
    return total;
  },

  paraISO(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  },

  /* Todo o dinheiro que já tem plano: reserva + metas.

     Sai do disponível porque dinheiro com dono não é dinheiro livre — era o
     defeito central: quem guardou R$ 15.000 de reserva os via como gastáveis.

     Descontar é correto e não conta duas vezes: o aporte é uma transferência
     real entre contas próprias, então o dinheiro guardado está dentro de
     accountsTotal, só que comprometido com um objetivo. */
  guardado() { return this.guardadoReserva() + this.guardadoMetas(); },

  /* Quanto TERÁ dono numa data futura: o guardado de hoje mais os aportes já
     agendados até lá.

     `guardado()` responde "quanto já tem plano AGORA", e é o que o hero do mês
     corrente desconta. Olhando para agosto ele responde a pergunta errada: quem
     planejou guardar R$ 3.400 no dia 3 quer saber que terá R$ 3.534 guardados no
     fim do mês, não os R$ 134 de hoje.

     Só o que está À FRENTE. Aporte agendado e VENCIDO não entra: ele não
     aconteceu, e contá-lo aqui afirmaria um fato que a própria fila de pendências
     do Painel ainda está cobrando. */
  aportesAgendadosAte(dataISO) {
    const hoje = this.hojeISO();
    return this.all('goal_entries')
      .filter(e => !this.aportePago(e) && Number(e.amount) > 0
        && String(e.date) >= hoje && String(e.date) < dataISO)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  },
  guardadoPrevisto(dataISO) { return this.guardado() + this.aportesAgendadosAte(dataISO); },

  guardadoReserva() { return this.reserveTotal(); },
  guardadoMetas() {
    return this.all('goals')
      .filter(g => !g.done && !this.isReserveGoal(g))
      .reduce((s, g) => s + Math.max(0, this.goalTotal(g.id)), 0);
  },

  accountsTotal() {
    return this.all('accounts').filter(a => a.active !== false)
      .reduce((s, a) => s + (Number(a.balance) || 0), 0);
  },

  /* ---------- Caixa x investido ----------

     `accountsTotal` soma tudo o que a família tem, e é o número certo para
     patrimônio. Mas ele não responde "quanto eu tenho na conta AGORA": um saldo
     de R$ 325 do qual R$ 134 estão num CDB não é R$ 325 de poder de compra, e o
     hero mostrava só o total — foi o que motivou esta separação.

     A divisão é pelo TIPO da conta, não pelo que está guardado em metas. São dois
     recortes diferentes e ambos precisam existir: `guardado()` diz o que tem DONO
     (pode estar na conta corrente), e isto aqui diz onde o dinheiro ESTÁ.

     O teste é pela lista de investimento, não pela de caixa: conta com tipo vazio
     — as antigas, criadas antes de o campo existir — cai em caixa. Sumir da linha
     "em conta" é o erro pior dos dois: quem tem o dinheiro precisa vê-lo. */
  TIPOS_INVESTIDOS: ['Investimento', 'Caixinha / Rendimento'],

  /* AS CONTAS DE INVESTIMENTO do recorte. Devolver os ids, e não o saldo, é o que
     deixa a pergunta "quanto disso está investido" ser feita em QUALQUER data: o
     Extrato passa esta lista para saldoNaData num mês encerrado e para
     saldoPrevistoNaData num mês futuro, e a resposta sai da mesma função que
     produziu o total que ela decompõe. Uma versão que só soubesse o saldo de hoje
     obrigaria cada tela a inventar a sua própria projeção. */
  contasInvestidas(contaIds) {
    const lista = (contaIds && contaIds.length)
      ? contaIds.map(id => this.get('accounts', id)).filter(Boolean)
      : this.all('accounts').filter(a => a.active !== false);
    return lista.filter(a => this.TIPOS_INVESTIDOS.includes(a.type)).map(a => a.id);
  },

  /* `contaIds` opcional: sem ele, todas as contas ativas; com ele, só as do
     recorte — é o que deixa o Extrato de UMA conta responder a mesma pergunta que
     o Extrato da família. */
  saldoInvestido(contaIds) {
    return this.contasInvestidas(contaIds)
      .reduce((s, id) => s + (Number((this.get('accounts', id) || {}).balance) || 0), 0);
  },

  // O dinheiro de uso imediato: conta corrente, carteira digital e o que não
  // declarou tipo. Por construção, saldoEmCaixa + saldoInvestido = accountsTotal.
  saldoEmCaixa() { return this.accountsTotal() - this.saldoInvestido(); },

  /* O que ficou PARA TRÁS: "A Pagar" de ciclos anteriores, ainda em aberto.

     Ele existe para a conta do hero FECHAR. `previsaoDoMes` só enxerga o mês
     pedido, mas `saldoPrevistoNaData` conta todo "A Pagar" vencido — é dinheiro
     que ainda vai sair, e ignorá-lo daria um saldo final otimista. Sem esta
     parcela, a soma das linhas na tela não bateria com o total logo abaixo delas,
     que é o defeito mais grave que um painel pode ter.

     Devolve o EFEITO NO SALDO (negativo quando falta pagar), não um valor
     absoluto: receita atrasada também fica para trás, e somar as duas com o mesmo
     sinal diria que um salário que não caiu piora o saldo.

     O recorte é o mesmo de `saldoPrevistoNaData` sem filtro de contas: tudo entra,
     inclusive o lançamento que não escolheu conta. Se as duas regras divergirem, a
     linha explicará uma diferença que o total não tem. */
  pendenteDeCiclosAnteriores(period) {
    const de = this.inicioISO(period);
    return this.all('transactions')
      .filter(t => t.status === 'A Pagar' && !t.card_id && !this.isNeutral(t)
        && String(t.date) < de)
      .reduce((s, t) => s + (this.isExpense(t) ? -1 : 1) * (Number(t.amount) || 0), 0);
  },

  /* Disponível de verdade: o que está nas contas, menos o que já tem destino.

     Três subtrações, e cada uma responde a uma pergunta diferente:
       contas      — quanto existe
       comprometido — quanto já é de outra pessoa (vence até o fim do ciclo)
       guardado    — quanto já tem plano (reserva e metas)

     Receita futura NÃO entra aqui, por decisão: somá-la faria o número dizer
     "posso gastar o que ainda não recebi". Ela vale na projeção, não no
     disponível — disponível é dinheiro que existe. */
  available() { return this.accountsTotal() - this.committed() - this.guardado(); },

  /* O CAIXA livre: o que existe no banco agora, menos o que tem dono.

     Diferente de available() de propósito, e a diferença importa. available()
     desconta o comprometido porque é número de PLANEJAMENTO — "quanto posso
     assumir de novo até o fim do mês". Aqui é REALIDADE de caixa: o comprometido
     ainda está na conta, a fatura só sai quando for paga.

     É este número que decide se um gasto encostou na reserva. Usar available()
     mandaria resgatar por causa de uma conta que ainda nem venceu — antecipando
     um débito que não aconteceu. */
  caixaLivre() { return this.accountsTotal() - this.guardado(); },

  // Quanto de um gasto entra no que está guardado. Zero significa que o dinheiro
  // saiu do que era livre de verdade.
  faltaParaGastar(valor) {
    return Math.max(0, (Number(valor) || 0) - this.caixaLivre());
  },

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

  /* Custo de vida mensal para dimensionar a RESERVA.

     A reserva responde "quantos meses eu aguento sem renda", e a régua disso é o
     que se gasta para VIVER — não a média histórica crua. Os dois divergem quando
     o histórico tem meses atípicos: medido nesta base, o gasto médio de junho e
     julho era R$ 30.530 (um período de transição, com repasses classificados como
     consumo), o que dava uma reserva-alvo de R$ 183 mil e uma cobertura de 0,0
     meses — um número que só desanima e não orienta.

     Quando há orçamento definido, ele é a melhor resposta: é o custo de vida que a
     própria família planejou, e não inclui o investimento, que deixa de existir
     justamente quando a renda para. Sem orçamento, cai na média histórica. */
  custoDeVidaMensal() {
    const orcado = this.budgetTotal();
    const env = this.envelopeDeInvestimento();
    const investimento = env ? this.budgetOf(env.id) : 0;
    const semInvestir = orcado - investimento;
    return semInvestir > 0 ? semInvestir : this.avgMonthlySpend();
  },

  /* Ritmo de aportes de uma meta (média mensal dos últimos 90 dias).
     Só o que aconteceu: ritmo é uma medida do passado, e um aporte agendado para
     a semana que vem infla a média sem nada ter sido guardado — a projeção de
     "quando a meta fecha" ficaria otimista. */
  goalPace(goalId) {
    const cut = new Date(Date.now() - 90 * 86400000);
    const recent = this.all('goal_entries')
      .filter(e => e.goal_id === goalId && this.aportePago(e)
        && new Date(e.date + 'T12:00:00') >= cut)
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return recent / 3;
  },

  /* O horizonte: para onde o dinheiro vai nos próximos meses.

     O app já sabia disso — `previsaoDoMes` responde mês a mês e o gráfico "De
     onde vim, para onde vou" desenha —, mas o Painel não trazia nada disso nos
     números do topo: os KPIs falavam só do presente, e a pergunta de quem planeja
     ("dá para respirar?") ficava sem resposta na primeira tela.

     O PIOR PONTO é o número que importa, não o saldo final. Um horizonte que
     termina em R$ 59 mil parece confortável e pode passar por R$ 200 negativos em
     setembro — e é em setembro que a conta não é paga. Mesma razão de existir do
     `avisoDeAperto`, aqui na escala de meses.

     Parte do saldo REAL de hoje e rola o resultado previsto de cada mês, que é a
     mesma conta de `fluxoMensal` — dois números diferentes para a mesma pergunta
     seriam pior que nenhum. */
  horizonte(n = 6) {
    let saldo = this.accountsTotal();
    let entra = 0, sai = 0;
    const meses = [];
    for (let i = 1; i <= n; i++) {
      const p = this.monthPeriod(new Date(), i);
      const pv = this.previsaoDoMes(p);
      saldo += pv.resultado;
      entra += pv.entra; sai += pv.sai;
      meses.push({ period: p, entra: pv.entra, sai: pv.sai, resultado: pv.resultado, saldo });
    }
    /* O pior ponto sai da LISTA pronta, não de um acumulador durante o laço.
       Comparando contra o saldo de hoje enquanto rola, um horizonte que só sobe
       nunca atualizava o mínimo e o rótulo mostrava o mês errado — medido: dizia
       "pior ponto R$ 59.479 em agosto", que é o saldo do último mês. */
    const menor = meses.reduce((m, x) => (x.saldo < m.saldo ? x : m), meses[0] || { saldo, period: null });
    const temDados = meses.some(m => m.entra > 0.005 || m.sai > 0.005);
    return {
      meses, entra, sai, resultado: entra - sai, fim: saldo, temDados,
      pior: menor.saldo,
      piorMes: menor.period ? menor.period.label : '',
      mediaSaida: meses.length ? sai / meses.length : 0,
    };
  },

  /* ---------- Backup ---------- */
  /* O backup sai SEM as duas chaves que vivem em `meta`: a da API da Anthropic
     e a do cofre que cifra o assistente na nuvem. O arquivo exportado é um .json
     solto na pasta de downloads, mandado por e-mail, guardado no drive — ou
     seja, o lugar do app onde criptografia nenhuma protege. Perder o assistente
     ao restaurar um backup é aceitável; vazar uma chave que gasta dinheiro, não. */
  exportJSON() {
    const copia = { ...this.data };
    if (copia.meta) {
      copia.meta = { ...copia.meta, ia_cofre: undefined };
      if (copia.meta.ia) {
        /* Uma chave POR PROVEDOR desde a v159: zerar um campo `chave` que não
           existe mais deixaria as duas passarem. Zera o mapa inteiro, e assim um
           provedor novo nasce protegido em vez de esquecido. */
        const chaves = {};
        for (const k of Object.keys(copia.meta.ia.chaves || {})) chaves[k] = '';
        copia.meta.ia = { ...copia.meta.ia, chave: '', chaves };
      }
    }
    return JSON.stringify(copia, null, 2);
  },

  /* Importar backup.

     A validação exige as stores que SEMPRE existiram — sem elas o arquivo não é
     um backup deste app. As demais são normalizadas: um backup gerado antes de
     uma tabela nova existir é legítimo, e recusá-lo transformaria toda versão
     que acrescenta store numa versão que invalida os backups anteriores. Foi o
     que aconteceria com `budget_overrides`: todo arquivo salvo até aqui passaria
     a dar "não parece um backup do app". */
  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo inválido');
    const ESSENCIAIS = ['accounts', 'categories', 'transactions'];
    for (const s of ESSENCIAIS) if (!Array.isArray(parsed[s])) throw new Error('Arquivo não parece um backup do app');
    for (const s of STORES) if (!Array.isArray(parsed[s])) parsed[s] = [];
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

  /* ---------- Recorrências ----------
     O contrato de uma transação que se repete. As transações são GERADAS a
     partir dele e carregam recurrence_id, que é como o app sabe o que já nasceu
     e não duplica. */

  /* Data da n-ésima ocorrência, contando de 0.

     O caso que quebra ingênuo: "todo dia 31" em fevereiro. `new Date(ano, mes,
     31)` transborda para 3 de março silenciosamente — o aluguel apareceria no
     mês errado. Aqui o dia é limitado ao último dia real do mês, que é o que
     bancos e boletos fazem. */
  dataDaOcorrencia(r, n) {
    const base = new Date(String(r.inicio) + 'T12:00:00');
    if (r.periodicidade === 'semanal') { base.setDate(base.getDate() + n * 7); return this.paraISO(base); }
    if (r.periodicidade === 'quinzenal') { base.setDate(base.getDate() + n * 14); return this.paraISO(base); }
    const passo = r.periodicidade === 'anual' ? 12 : 1;
    const ano = base.getFullYear();
    const mes = base.getMonth() + n * passo;
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    const dia = Math.min(Math.max(1, Number(r.dia) || base.getDate()), ultimoDia);
    return this.paraISO(new Date(ano, mes, dia));
  },

  // A recorrência já acabou? (por data, por contagem ou por cancelamento)
  recorrenciaEncerrada(r, dataISO, nOcorrencia) {
    if (r.status === 'cancelada') return true;
    if (r.fim_tipo === 'data' && r.fim_data && dataISO > String(r.fim_data)) return true;
    if (r.fim_tipo === 'vezes' && Number(r.fim_vezes) > 0 && nOcorrencia >= Number(r.fim_vezes)) return true;
    return false;
  },

  /* Valor a lançar. Para conta de consumo (luz, água) usa a mediana do que já foi
     pago — mediana e não média porque um mês de conserto ou de viagem distorce a
     média e o valor previsto passa a mentir para cima. */
  valorDaRecorrencia(r) {
    if (r.valor_tipo !== 'media') return Number(r.amount) || 0;
    const pagas = this.all('transactions')
      .filter(t => t.recurrence_id === r.id && t.status === 'Pago')
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 6)
      .map(t => Number(t.amount) || 0);
    if (!pagas.length) return Number(r.amount) || 0;   // sem histórico, o valor informado
    return Math.round(this.mediana(pagas) * 100) / 100;
  },

  /* A JANELA em que dois lançamentos com o mesmo nome são a MESMA ocorrência.

     Ela existe porque a chave do vínculo não basta e a chave do nome, sozinha,
     erra para o outro lado. Casar por nome dentro do mês inteiro é certo para o
     aluguel (uma vez por mês) e destrói a diarista semanal: as ocorrências 2, 3 e
     4 seriam tomadas por repetição da primeira e nunca apareceriam.

     Então a janela acompanha o intervalo do contrato — metade dele, que é o ponto
     em que "atrasou uns dias" deixa de ser plausível e vira outra cobrança. */
  janelaDaOcorrencia(r) {
    if (r.periodicidade === 'semanal') return 3;
    if (r.periodicidade === 'quinzenal') return 7;
    return 15;                                  // mensal e anual
  },

  /* Esta ocorrência JÁ EXISTE como lançamento? Devolve o lançamento, ou null.

     Duas chaves, e é preciso ter as duas:

     1. Pelo VÍNCULO (`recurrence_id` + data) — pega o que o próprio gerador criou.
     2. Pelo NOME, dentro da janela — pega o lançamento que DEU ORIGEM ao contrato.
        Ele nunca recebe vínculo (o vínculo só nasce no que o gerador cria), e por
        isso a chave 1 não o enxerga.

     A segunda foi medida nos dados reais: a parcela do Fiat 500 tinha TRÊS linhas
     em agosto — a lançada à mão e duas geradas — porque o contrato começava no
     mesmo dia do lançamento que o originou. A previsão do mês já tratava disso; o
     gerador, que é quem GRAVA, não tratava. O resultado era pior ali: a previsão
     inflava um número na tela, o gerador inflava o comprometido de verdade.

     Conta o que está PAGO também: pagar adiantado é o caso mais comum, e um
     lançamento pago é a prova mais forte de que a ocorrência aconteceu. */
  ocorrenciaJaLancada(r, dataISO) {
    const nome = String(r.description || '').trim().toLowerCase();
    const janela = this.janelaDaOcorrencia(r);
    const alvo = Date.parse(String(dataISO) + 'T12:00:00');
    /* A SEMANADA APAGADA CONTA COMO "JÁ LANÇADA". Os outros contratos, não.

       `all()` esconde o que foi apagado, então o gerador não vê a exclusão e recria
       a ocorrência na abertura seguinte. Para contratos comuns isso é PROPOSITAL e
       está protegido por teste: remover o lançamento é como o app desfaz um
       pagamento adiantado, e a previsão tem de voltar. Mudar isso para todos
       quebraria o desfazer — cinco testes caíram quando tentei.

       A semanada é diferente porque é neutra: não há pagamento a desfazer, e
       apagá-la só pode querer dizer "não vou dar esta semanada". Recriá-la é o app
       desfazendo a decisão da pessoa em silêncio, toda vez que o app abre.

       Apareceu numa base real: três semanadas apagadas do extrato continuavam
       pesando R$ 33 no "Dos filhos" do painel, e voltariam ao extrato na abertura
       seguinte — apagar de novo nunca resolveria. */
    const lista = r.kid_id ? this.data.transactions : this.all('transactions');
    for (const t of lista) {
      /* A SEMANADA É NEUTRA E PRECISA SER RECONHECIDA AQUI.

         `isNeutral` está nesta linha para não confundir uma conciliação ou um
         pagamento de fatura com a ocorrência de um contrato — nenhum dos dois
         nasce de contrato, e tratá-los como ocorrência impediria a geração.

         A semanada nasce de contrato, e virou neutra quando deixou de mexer no
         saldo. Sem esta exceção o gerador nunca a reconhece e a CRIA DE NOVO a
         cada execução: uma semanada por abertura do app, empilhando no extrato. E
         `dosFilhosAVir` contava o mesmo compromisso duas vezes — como lançamento
         e como ocorrência por vir. Foi assim que apareceu, num total que pulou de
         R$ 108 para R$ 168 só por gerar. */
      if (this.isNeutral(t) && !this.isSemanada(t)) continue;
      if (t.recurrence_id === r.id && String(t.date) === String(dataISO)) return t;
      if (t.recurrence_id && t.recurrence_id !== r.id) continue;   // é de outro contrato
      if (String(t.description || '').trim().toLowerCase() !== nome) continue;
      const d = Date.parse(String(t.date) + 'T12:00:00');
      if (!Number.isNaN(d) && Math.abs(d - alvo) / 86400000 <= janela) return t;
    }
    return null;
  },

  /* Gera o que falta até `ateISO`.

     Três proteções que valem mais que o resto do código:

     1. NUNCA GERA RETROATIVO antes do início. Cadastrar hoje o aluguel que se
        paga há dois anos não pode despejar 24 lançamentos no passado — foi por
        isso que o início existe como campo, e não é a data de criação.
     2. NÃO DUPLICA: antes de criar, confere se aquela ocorrência já foi lançada —
        pelo vínculo E pelo nome (ver `ocorrenciaJaLancada`). Rodar a geração duas
        vezes, ou em dois aparelhos, é inofensivo.
     3. PARA NO FIM: por data, por contagem ou por cancelamento.

     O limite de 400 ocorrências é rede contra recorrência mal formada (início em
     1990, semanal) travar o app num laço. */
  gerarRecorrencias(ateISO) {
    const limite = ateISO || this.fimISO(this.monthPeriod(new Date()));
    const criadas = [];
    for (const r of this.all('recurrences')) {
      if (r.status !== 'ativa') continue;          // pausada e cancelada não geram
      let n = 0;
      while (n < 400) {
        const data = this.dataDaOcorrencia(r, n);
        if (data >= limite) break;
        if (this.recorrenciaEncerrada(r, data, n)) break;
        if (!this.ocorrenciaJaLancada(r, data)) criadas.push(this.criarDaRecorrencia(r, data));
        n++;
      }
    }
    if (criadas.length) this.save();
    return criadas;
  },

  /* Id DETERMINÍSTICO da ocorrência: mesmo contrato + mesma data = mesmo id.

     É o que torna verdadeira a promessa do comentário de `gerarRecorrencias` —
     "rodar duas vezes é inofensivo" — quando as duas vezes acontecem em APARELHOS
     diferentes. A conferência por lançamento existente só enxerga o que já
     chegou pela sincronização; dois aparelhos que geram antes de conversar criam
     duas linhas, cada uma com id sorteado, e o merge (que é por id) mantém as
     duas. Foi exatamente o que os dados mostraram: duas parcelas do Fiat com o
     mesmo `recurrence_id` e a mesma data, criadas com 10 horas de diferença.

     Com o id derivado do par, as duas gravações COLIDEM e viram uma linha só, sem
     depender de quem sincronizou primeiro.

     O hash é FNV-1a de 32 bits em quatro sementes — não é criptográfico e não
     precisa ser: o espaço de entrada é (contrato, data), e um contrato tem
     dezenas de datas, não bilhões. O formato respeita o de um UUID porque a
     coluna no Postgres é `uuid` e a auditoria de schema confere o formato. */
  idDaOcorrencia(recurrenceId, dataISO) {
    const semente = `${recurrenceId}|${dataISO}`;
    const fnv = inicio => {
      let h = inicio;
      for (let i = 0; i < semente.length; i++) {
        h ^= semente.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    };
    const h = fnv(0x811c9dc5) + fnv(0x01000193) + fnv(0xdeadbeef) + fnv(0x9e3779b9);
    // Versão 4 e variante 8 no lugar canônico: é um id sintético, mas com forma válida
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  },

  criarDaRecorrencia(r, dataISO) {
    const tx = {
      id: this.idDaOcorrencia(r.id, dataISO),
      description: r.description,
      amount: this.valorDaRecorrencia(r),
      date: dataISO,
      type: r.type || 'Despesa',
      /* Nasce "A Pagar" mesmo sendo receita: nada é dado como acontecido antes de
         acontecer. Salário que não caiu tem de aparecer como pendência, não como
         dinheiro em conta. */
      status: 'A Pagar',
      scope: r.scope || 'Família',
      member: r.member || '',
      method: r.method || 'Boleto',
      category_id: r.category_id || null,
      account_id: r.account_id || null,
      card_id: r.card_id || null,
      tags: Array.isArray(r.tags) ? r.tags : [],
      notes: r.notes || '',
      recurrence_id: r.id,
      /* Contrato de semanada carimba o lançamento com a criança, e é isso que o
         torna NEUTRO no saldo — ver isSemanada. Sem o carimbo, o lançamento seria
         indistinguível de uma despesa e debitaria a conta de um dinheiro que não
         saiu do banco. */
      ...(r.kid_id ? { kid_id: r.kid_id } : {}),
    };
    // Recorrência no cartão cai na FATURA do período, não na conta
    if (tx.card_id) {
      const card = this.get('cards', tx.card_id);
      if (card) tx.invoice_key = this.invoiceKeyFor(card, dataISO);
    }
    this.upsert('transactions', tx);
    this.upsert('recurrences', { ...r, geradas: (Number(r.geradas) || 0) + 1, ultima_geracao: dataISO });
    return tx;
  },

  /* Encerra uma recorrência e limpa o que ela deixou pendente.

     A distinção é o ponto: lançamento JÁ PAGO é histórico e fica — apagá-lo
     reescreveria o passado e mudaria saldos que já foram conciliados. Mas "A
     Pagar" de uma assinatura cancelada é lixo: infla o comprometido, aparece na
     fila de pendências pedindo decisão, e você nunca vai pagar.

     Devolve quantos foram limpos, para a tela poder dizer. */
  encerrarRecorrencia(id, apagarContrato) {
    const pendentes = this.all('transactions')
      .filter(t => t.recurrence_id === id && t.status === 'A Pagar');
    this.emLote(() => {
      for (const t of pendentes) this.remove('transactions', t.id);
      if (apagarContrato) this.remove('recurrences', id);
      else {
        const r = this.get('recurrences', id);
        if (r) this.upsert('recurrences', { ...r, status: 'cancelada' });
      }
    });
    return pendentes.length;
  },

  // Quantas ocorrências ainda faltam, quando há prazo — para a tela dizer
  // "faltam 22 de 48" em vez de só "ativa"
/* ---------- COFRINHO: o dinheiro das crianças ----------

     Regra que governa tudo aqui: o saldo de cada pote é DERIVADO das entradas,
     nunca guardado. É a mesma regra do saldo e da previsão no resto do app — um
     total à parte diverge no primeiro erro e ninguém percebe. */

  kids() {
    return this.all('kids').filter(k => k.active !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  /* O EXTRATO DELA, visto pelo adulto: a SAÍDA pendente aparece; a ENTRADA, não.

     A mesma regra do app da criança, e tem de ser a mesma: se o pote dela já caiu,
     as duas telas precisam mostrar a linha que explica por quê. Um extrato que
     desmente o saldo é pior que um extrato curto. */
  kidEntries(kidId) {
    return this.all('kid_entries')
      .filter(e => {
        if (e.kid_id !== kidId) return false;
        if (e.confirmada !== false) return true;
        return e.tipo === 'gasto' || e.tipo === 'doacao';
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  /* O SALDO DOS TRÊS POTES.

     Entrada soma no pote em que caiu; saída subtrai do pote de onde saiu. Gasto e
     doação são saídas — e é por isso que `pote` existe nos dois: gastar do pote
     "guardar" tem significado diferente de gastar do pote "gastar agora", e a
     criança precisa ver essa diferença. */
  /* ENTRADA pendente não conta; SAÍDA pendente conta — a mesma regra do app da
     criança, e tem de ser a mesma. Creditar antes de conferir seria pagar por ela
     dizer que fez; debitar antes é conservador, e mostrar menos do que ela talvez
     tenha é o lado seguro de errar. */
  kidPotes(kidId) {
    const potes = { gastar: 0, guardar: 0, doar: 0 };
    for (const e of this.all('kid_entries')) {
      if (e.kid_id !== kidId) continue;
      const saida = e.tipo === 'gasto' || e.tipo === 'doacao';
      if (e.confirmada === false && !saida) continue;
      const p = potes[e.pote] === undefined ? 'gastar' : e.pote;
      const v = Number(e.amount) || 0;
      potes[p] += (e.tipo === 'gasto' || e.tipo === 'doacao') ? -v : v;
    }
    potes.total = potes.gastar + potes.guardar + potes.doar;
    return potes;
  },

  kidMeta(kidId) {
    return this.all('kid_goals').find(g => g.kid_id === kidId && !g.done) || null;
  },

  /* QUANTAS SEMANADAS FALTAM para a meta.

     Aos 6 anos, tempo é mais concreto que dinheiro: "faltam 5 semanadas" se
     entende, "faltam R$ 47,50" não. Conta só o que está no pote GUARDAR — o
     dinheiro de gastar não é para a meta, e prometer o contrário seria mentira. */
  kidSemanadasParaMeta(kidId) {
    const meta = this.kidMeta(kidId);
    const kid = this.get('kids', kidId);
    if (!meta || !kid) return null;
    const falta = (Number(meta.target_amount) || 0) - this.kidPotes(kidId).guardar;
    if (falta <= 0) return 0;
    /* O ritmo inclui a moeda mágica: ela entra no pote guardar toda semana, e
       ignorá-la faria a conta prometer mais semanas do que a realidade. */
    const porSemana = (Number(kid.semanada_valor) || 0) + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);
    if (porSemana <= 0) return null;
    return Math.ceil(falta / porSemana);
  },

  /* A SEMANA do cofrinho: começa no dia da semanada.

     Todo o app da criança pensa em semanas, não em meses — é o maior ciclo que
     ela administra. Devolve o ISO do último dia de semanada que já passou. */
  /* QUANTAS NOITES DE SONO faltam até uma data — a unidade que a criança
     manipula. Espelha `noitesAte` do app dela. */
  noitesAte(dataISO, refISO) {
    if (!dataISO) return null;
    const a = new Date((refISO || this.hojeISO()) + 'T12:00:00');
    const b = new Date(String(dataISO) + 'T12:00:00');
    if (isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  },

  kidInicioDaSemana(kid, refISO) {
    const hoje = refISO || this.hojeISO();
    const d = new Date(hoje + 'T12:00:00');
    const alvo = Math.min(6, Math.max(0, Number(kid.semanada_dia) || 0));
    const recuo = (d.getDay() - alvo + 7) % 7;
    d.setDate(d.getDate() - recuo);
    return this.paraISO(d);
  },

  /* A SEMANADA JÁ SAIU nesta semana?

     Sem esta conferência, abrir o app duas vezes no mesmo dia daria duas
     semanadas — e o erro só apareceria quando alguém somasse o mês. */
  kidSemanadaPaga(kid, refISO) {
    const inicio = this.kidInicioDaSemana(kid, refISO);
    return this.all('kid_entries').some(e =>
      e.kid_id === kid.id && e.tipo === 'semanada' && String(e.date) >= inicio);
  },

  kidSemanadaDevida(kid, refISO) {
    if (!kid || !(Number(kid.semanada_valor) > 0)) return null;
    if (this.kidSemanadaPaga(kid, refISO)) return null;
    return { kid, valor: Number(kid.semanada_valor), desde: this.kidInicioDaSemana(kid, refISO) };
  },

  /* A MOEDA MÁGICA: rende quem esperou.

     Cai quando uma semana inteira passou sem NENHUMA saída do pote guardar. É o
     conceito de rendimento em formato que a idade alcança — porcentagem sobre
     R$ 7 dá sete centavos, e o que não se vê não ensina.

     Devida uma vez por semana, e só se houver semana fechada para julgar: sem
     isso, criar a criança hoje já pagaria a moeda de uma semana que não existiu. */
  kidMoedaMagicaDevida(kid, refISO) {
    if (!kid || kid.rendimento_tipo !== 'moeda' || !(Number(kid.rendimento_valor) > 0)) return null;
    const inicio = this.kidInicioDaSemana(kid, refISO);
    const jaCaiu = this.all('kid_entries').some(e =>
      e.kid_id === kid.id && e.tipo === 'rendimento' && String(e.date) >= inicio);
    if (jaCaiu) return null;

    const entradas = this.all('kid_entries').filter(e => e.kid_id === kid.id);
    if (!entradas.length) return null;                 // ninguém guardou nada ainda
    const anterior = this.somarDiasISO(inicio, -7);
    // Precisa existir a semana ANTERIOR para julgar: sem histórico, não há espera
    if (!entradas.some(e => String(e.date) < inicio)) return null;
    const mexeu = entradas.some(e => e.pote === 'guardar'
      && (e.tipo === 'gasto' || e.tipo === 'doacao')
      && String(e.date) >= anterior && String(e.date) < inicio);
    if (mexeu) return null;
    if (this.kidPotes(kid.id).guardar <= 0) return null;   // nada guardado, nada a render
    return { kid, valor: Number(kid.rendimento_valor) };
  },

  /* AS MISSÕES DA SEMANA, com o progresso de cada uma.

     Espelha `tarefas` do app da criança, e tem de espelhar: o adulto e ela
     precisam ver o MESMO progresso. Duas contas parecidas viram duas verdades, e
     quando o número da tela dela não bate com o da tela dele, quem perde a
     confiança no app é a criança. Há teste rodando a mesma cena nas duas.

     Duas frequências, e a diferença é de natureza:
       semanal — faz uma vez e está feito
       diária  — precisa acontecer todos os dias, e o valor sai UMA VEZ ao
                 completar a semana (ver o comentário em cofrinho/js/dados.js) */
  kidTarefas(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return [];
    const inicio = this.kidInicioDaSemana(kid);
    const hoje = this.hojeISO();
    const marcadas = this.all('kid_entries').filter(e =>
      e.kid_id === kidId && e.tipo === 'tarefa' && String(e.date) >= inicio);

    return this.all('kid_tasks')
      .filter(t => t.kid_id === kidId && t.active !== false)
      .map(t => {
        const daTarefa = marcadas.filter(e => e.task_id === t.id);
        /* MISSÃO ESPECIAL: uma vez só, com prazo. Espelha o app da criança, e tem
           de espelhar — o adulto e ela precisam ver o MESMO estado. */
        if (t.frequencia === 'especial') {
          const feita = this.all('kid_entries').find(e =>
            e.kid_id === kidId && e.tipo === 'tarefa' && e.task_id === t.id);
          const noites = this.noitesAte(t.expira_em);
          return {
            ...t, especial: true, diaria: false,
            feita: !!feita,
            confirmada: feita ? feita.confirmada !== false : false,
            entryId: feita ? feita.id : null,
            noites,
            expirada: noites !== null && noites < 0 && !feita,
          };
        }
        if (t.frequencia !== 'diaria') {
          const feita = daTarefa[0];
          return {
            ...t, diaria: false, feita: !!feita,
            confirmada: feita ? feita.confirmada !== false : false,
            entryId: feita ? feita.id : null,
          };
        }
        const dias = [];
        for (let i = 0; i < 7; i++) {
          const d = this.somarDiasISO(inicio, i);
          dias.push({ data: d, passou: d <= hoje, hoje: d === hoje,
            marcada: daTarefa.some(e => String(e.date) === d) });
        }
        const feitos = dias.filter(d => d.marcada).length;
        const deHoje = daTarefa.find(e => String(e.date) === hoje);
        const bonus = this.all('kid_entries').find(e =>
          e.kid_id === kidId && e.tipo === 'bonus' && e.task_id === t.id && String(e.date) >= inicio);
        return {
          ...t, diaria: true, dias, feitos,
          feita: !!deHoje,
          confirmada: deHoje ? deHoje.confirmada !== false : false,
          entryId: deHoje ? deHoje.id : null,
          completou: feitos >= 7,
          bonusId: bonus ? bonus.id : null,
          bonusPago: bonus ? bonus.confirmada !== false : false,
        };
      });
  },
  // O que espera o adulto: tarefa marcada pela criança e ainda não confirmada
  /* O QUE ESPERA O ADULTO: o que a criança marcou e ainda não foi conferido.

     Duas coisas entram, e as duas envolvem dinheiro:

       tarefa semanal — ela marcou, vale um valor, e o dinheiro só cai depois que
                        ele vê. É o que impede o app de virar auto-serviço.
       bônus da diária — ela cuidou os sete dias e o valor da semana ficou devido.

     A MARCAÇÃO DIÁRIA NÃO ENTRA AQUI, de propósito. Ela vale zero e nasce
     confirmada: não há dinheiro a liberar, então não há o que conferir. Pedir sete
     confirmações por semana por tarefa faria o adulto parar de conferir qualquer
     coisa — inclusive o que importa. */
  kidTarefasAConfirmar() {
    const out = [];
    for (const kid of this.kids()) {
      const inicio = this.kidInicioDaSemana(kid);
      for (const e of this.all('kid_entries')) {
        if (e.kid_id !== kid.id || e.confirmada !== false) continue;
        /* GASTO E DOAÇÃO ENTRAM NA FILA, e é o que protege o dinheiro de verdade.

           A criança está aprendendo e vai tocar sem querer — é o que ela faz com
           qualquer app. Como o gasto dela agora DEBITA A CONTA DA FAMÍLIA, um toque
           de curiosidade mexeria no dinheiro real. Então ele espera o adulto, igual
           à tarefa: confirmar credita a saída de verdade; recusar apaga e o pote
           dela volta ao que era. */
        if (!['tarefa', 'bonus', 'gasto', 'doacao'].includes(e.tipo)) continue;
        if (String(e.date) < inicio) continue;
        // Marcação de dia vale zero: não há dinheiro a liberar, nada a conferir
        if (!(Number(e.amount) > 0)) continue;
        out.push({ kid, entry: e });
      }
    }
    return out;
  },
  /* ---------- APAGAR UM COFRINHO INTEIRO ----------

     Existia só "pausar", que esconde do app da criança e guarda tudo. Faltava
     apagar de verdade — e a falta apareceu do pior jeito: alguém precisou de um
     script contra o banco para zerar um cofrinho de teste, porque a tela não
     oferecia o caminho.

     APAGA EM CASCATA, e cada peça tem um motivo para estar na lista:

       kid_entries  — é o que forma o saldo dos potes. Sem isto, recadastrar a
                      criança faria o dinheiro antigo reaparecer, porque os
                      lançamentos continuam apontando para o id dela.
       kid_goals    — a meta não sobrevive a quem a queria.
       kid_tasks    — idem.
       recurrences  — o contrato da semanada, senão ele continua lançando e
                      pesando no custo fixo de uma criança que não existe mais.
       transactions — as semanadas já lançadas no extrato. Deixá-las faria o
                      extrato mostrar movimento de um cofrinho apagado, sem nada
                      que explicasse de onde veio.

     Lógica, nunca física: o app é local-first, e é a marca `deleted` que faz a
     exclusão viajar para os outros aparelhos. Remover a linha aqui a
     ressuscitaria no próximo pull do celular do outro adulto. */
  apagarCofrinho(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const conta = { entries: 0, metas: 0, tarefas: 0, vontades: 0, contratos: 0, lancamentos: 0 };

    return this.emLote(() => {
      for (const e of this.all('kid_entries')) {
        if (e.kid_id === kidId) { this.remove('kid_entries', e.id); conta.entries++; }
      }
      for (const g of this.all('kid_goals')) {
        if (g.kid_id === kidId) { this.remove('kid_goals', g.id); conta.metas++; }
      }
      for (const t of this.all('kid_tasks')) {
        if (t.kid_id === kidId) { this.remove('kid_tasks', t.id); conta.tarefas++; }
      }
      /* AS VONTADES TAMBÉM. Esquecer a tabela nova aqui deixaria a lista de desejos de
         uma criança apagada ressuscitar junto com a próxima criança de mesmo id — e
         apagar o cofrinho tem de apagar o cofrinho inteiro. */
      for (const w of this.all('kid_wishes')) {
        if (w.kid_id === kidId) { this.remove('kid_wishes', w.id); conta.vontades++; }
      }
      /* O CONTRATO E AS SEMANADAS: pelo vínculo E pelo nome.

         Pelo nome também porque as semanadas lançadas antes de a coluna `kid_id`
         existir não têm vínculo — ficariam para trás e voltariam a aparecer se
         alguém recadastrasse a criança com o mesmo nome. */
      const nome = String(kid.name || '').trim().toLowerCase();
      const doNome = d => nome && String(d || '').trim().toLowerCase() === `semanada de ${nome}`;
      for (const r of this.all('recurrences')) {
        if (r.kid_id === kidId || doNome(r.description)) { this.remove('recurrences', r.id); conta.contratos++; }
      }
      for (const t of this.all('transactions')) {
        if (t.kid_id === kidId || doNome(t.description)) { this.remove('transactions', t.id); conta.lancamentos++; }
      }
      this.remove('kids', kidId);
      return conta;
    });
  },

  /* ---------- O DINHEIRO QUE JÁ É DOS FILHOS ----------

     Está na conta da família e não é da família. Sai do "livre" por isso, e a
     distinção com o GUARDADO não é preciosismo:

       guardado    — dinheiro SEU que você decidiu não gastar. Você pode mudar de
                     ideia, e o app usa esse número para calcular quantos meses a
                     reserva de emergência cobre.
       dos filhos  — dinheiro que já tem OUTRO DONO. Não é decisão sua, e numa
                     emergência a família não vai usar a mesada da criança.

     Somá-lo ao guardado inflaria a reserva de emergência com dinheiro que não é
     da família, e diria que o patrimônio dela inclui o dos filhos. A definição
     que encaixa é a que o app já usa para `committed`: "quanto já é de outra
     pessoa".

     DERIVADO, nunca materializado — a mesma regra de todo saldo aqui. É a soma dos
     três potes de cada criança, calculada dos lançamentos dela. Um total guardado
     à parte divergiria no primeiro erro e ninguém perceberia. */
  dosFilhos() {
    return this.kids().reduce((s, k) => s + this.kidPotes(k.id).total, 0);
  },

  /* O que ainda VAI virar dinheiro dos filhos até uma data.

     Sem isto, o "Livre ao fim" ignoraria as semanadas que ainda serão dadas neste
     mês: elas não entram em "Contas do mês" (a previsão as exclui, ver
     `previsaoDoMes`) e ainda não estão no acumulado, porque não foram dadas.
     Ficariam invisíveis nas duas pontas.

     CONTA AS DUAS FORMAS, e é isso que impede o número de oscilar. Uma semanada
     do mês está em um de dois estados: já virou lançamento em aberto, ou ainda é
     só uma ocorrência futura do contrato. Contar só a primeira faria o total
     crescer sozinho conforme o gerador rodasse; contar só a segunda o faria
     encolher. Os dois juntos dão sempre o mesmo compromisso, e a regra de não
     duplicar é a mesma do resto do app: `ocorrenciaJaLancada`. */
  dosFilhosAVir(ateISO) {
    const hoje = this.hojeISO();
    const limite = ateISO || this.fimISO(this.monthPeriod(new Date()));
    let total = this.all('transactions')
      .filter(t => this.isSemanada(t) && t.status === 'A Pagar'
        && String(t.date) >= hoje && String(t.date) < limite)
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);

    for (const r of this.all('recurrences')) {
      if (!r.kid_id || r.status !== 'ativa') continue;
      for (let n = 0; n < 400; n++) {
        const data = this.dataDaOcorrencia(r, n);
        if (data >= limite) break;
        if (this.recorrenciaEncerrada(r, data, n)) break;
        if (data < hoje) continue;
        if (this.ocorrenciaJaLancada(r, data)) continue;   // já contada acima
        total += this.valorDaRecorrencia(r);
      }
    }
    return total;
  },

  /* ---------- A SEMANADA NO ORÇAMENTO DE QUEM PAGA ----------

     O cofrinho registra o dinheiro CHEGANDO no lado da criança. Faltava o outro
     lado: para a família, aquilo é dinheiro saindo toda semana, e sem registro
     ele não existia em nenhum número do app.

     Não é pouco. Dois filhos a R$ 8 por semana, mais a moeda mágica, passam de
     R$ 75 por mês — e é exatamente o perfil de gasto que desaparece da conta:
     pequeno, repetido e pago em dinheiro vivo.

     A FONTE É O CONTRATO, sem exceção para este caso. A regra da casa é que toda
     movimentação futura vem de contrato, e abrir uma segunda fonte só porque
     "semanada é diferente" recriaria a divergência que a unificação resolveu. O
     contrato é semanal de verdade — `POR_MES` já sabe que semanal pesa 52/12 num
     mês, então o custo fixo mensal sai certo sem ninguém calcular nada.

     O VALOR INCLUI A MOEDA MÁGICA. Ela é condicional (só cai se a criança não
     mexer no que guardou), mas quem guarda a recebe quase toda semana. Entre
     superestimar levemente um compromisso e subestimá-lo, orçamento doméstico
     erra melhor para cima: sobrar é resultado, faltar é problema. */
  semanadaMensalDoKid(kid) {
    if (!kid) return 0;
    const semana = (Number(kid.semanada_valor) || 0)
      + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);
    return semana * this.POR_MES.semanal;
  },

  contratoDaSemanada(kidId) {
    return this.all('recurrences').find(r => r.kid_id === kidId && r.status !== 'cancelada') || null;
  },

  /* A próxima vez que este dia da semana acontece, contando hoje.

     Hoje conta de propósito: se a semanada é no sábado e alguém cadastra no
     sábado, a primeira ocorrência é hoje — e não daqui a sete dias, o que faria a
     criança esperar uma semana inteira sem entender por quê. */
  proximoDiaDaSemana(alvo, refISO) {
    const hoje = refISO || this.hojeISO();
    const d = new Date(hoje + 'T12:00:00');
    const avanco = (Math.min(6, Math.max(0, alvo)) - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + avanco);
    return this.paraISO(d);
  },

  /* O que o contrato DEVERIA dizer, comparado ao que ele diz.

     Devolve null quando está em dia. Devolve o motivo quando não está, porque a
     tela precisa dizer O QUE mudou — "o valor da semanada mudou" é acionável,
     "algo está diferente" não é. */
  semanadaForaDeSincronia(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const contrato = this.contratoDaSemanada(kidId);
    const semana = (Number(kid.semanada_valor) || 0)
      + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);

    if (semana <= 0) {
      // Sem semanada não há compromisso: um contrato vivo aqui é resto do passado
      return contrato ? { motivo: 'sobrando', contrato, esperado: 0 } : null;
    }
    if (!contrato) return { motivo: 'faltando', contrato: null, esperado: semana };
    if (Math.abs((Number(contrato.amount) || 0) - semana) > 0.005) {
      return { motivo: 'valor', contrato, esperado: semana, atual: Number(contrato.amount) || 0 };
    }
    /* O DIA DA SEMANA VEM DO `inicio`, não do campo `dia`.

       Para periodicidade semanal, `dataDaOcorrencia` soma sete dias sobre o
       início e ignora `dia` por completo (ver a função). Conferir `dia` aqui
       daria um contrato "em dia" gerando lançamento na terça enquanto a semanada
       é paga no sábado — e ninguém ligaria uma coisa à outra. */
    const diaDoInicio = new Date(String(contrato.inicio) + 'T12:00:00').getDay();
    if (diaDoInicio !== Number(kid.semanada_dia)) {
      return { motivo: 'dia', contrato, esperado: semana };
    }
    if (contrato.status !== 'ativa') return { motivo: 'pausado', contrato, esperado: semana };
    return null;
  },

  /* Cria ou acerta o contrato da semanada. Idempotente: rodar duas vezes não
     duplica, e o `kid_id` é o que garante isso mesmo se alguém renomear o
     contrato depois. */
  acertarContratoDaSemanada(kidId, extras = {}) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const fora = this.semanadaForaDeSincronia(kidId);
    if (!fora) return this.contratoDaSemanada(kidId);

    // Semanada zerada: encerra o contrato em vez de apagar, para o histórico do
    // que já foi pago continuar explicável
    if (fora.motivo === 'sobrando') {
      this.upsert('recurrences', { ...fora.contrato, status: 'cancelada' });
      return null;
    }

    const base = fora.contrato || {
      type: 'Despesa', valor_tipo: 'fixo', scope: 'Familiar',
      method: 'Dinheiro', fim_tipo: 'sempre', geradas: 0,
      ...extras,
    };
    /* O INÍCIO É A PRÓXIMA SEMANADA que ainda vai acontecer, nunca uma passada:
       cadastrar hoje não pode despejar semanadas retroativas no extrato. E é o
       início que fixa o dia da semana, porque a periodicidade semanal soma sete
       dias sobre ele. */
    const inicio = fora.contrato && fora.motivo !== 'dia'
      ? fora.contrato.inicio
      : this.proximoDiaDaSemana(Number(kid.semanada_dia) || 0);
    return this.upsert('recurrences', {
      ...base,
      kid_id: kidId,
      description: `Semanada de ${kid.name}`,
      amount: fora.esperado,
      inicio,
      dia: Number(kid.semanada_dia) || 0,   // guardado para a tela; a data usa o início
      periodicidade: 'semanal',
      status: 'ativa',
      type: 'Despesa',
    });
  },

  /* ---------- QUANDO A CRIANÇA GASTA, O DINHEIRO SAI DA CONTA ----------

     Este era o buraco que fechava o ciclo pela metade.

     Dar a semanada não move dinheiro: ele fica no banco e troca de dono (ver
     isSemanada). Mas quando a criança GASTA, o dinheiro sai da casa de verdade —
     quem paga o sorvete é o adulto, com o cartão ou a cédula dele. Sem lançar,
     acontecia o pior dos mundos: o acumulado do cofrinho caía R$ 5 e o "Livre ao
     fim" SUBIA R$ 5, como se a família tivesse ficado mais rica por a criança ter
     gasto. Dinheiro saía do bolso e aparecia como sobra.

     Agora o par fecha: o pote dela cai e a despesa entra. Os dois se cancelam no
     livre, que é exatamente o que aconteceu na realidade.

     ID DETERMINÍSTICO, a mesma técnica das recorrências: mesmo lançamento do
     cofrinho, mesmo id de transação. Rodar duas vezes, ou em dois aparelhos, não
     duplica — e é o que permite chamar isto em cada ponte sem medo.

     NÃO ESPELHA A DOAÇÃO como categoria de gasto qualquer: ela sai do bolso igual,
     mas a descrição diz o que foi, para o extrato da família não mentir sobre o
     destino do dinheiro.

     A CONTA é a do contrato da semanada, quando existe — é a que o adulto já
     escolheu para esse dinheiro. Sem contrato, a primeira conta ativa; e como é uma
     transação comum, ele pode corrigir depois. */
  espelharGastosDosFilhos() {
    if (!this.data) return [];
    const kids = this.all('kids');
    if (!kids.length) return [];
    const criadas = [];

    return this.emLote(() => {
      for (const kid of kids) {
        const contrato = this.contratoDaSemanada(kid.id);
        const contaPadrao = (contrato && contrato.account_id)
          || (this.all('accounts').find(a => a.active !== false) || {}).id || null;

        for (const e of this.all('kid_entries')) {
          if (e.kid_id !== kid.id) continue;
          if (e.tipo !== 'gasto' && e.tipo !== 'doacao') continue;
          if (e.confirmada === false) continue;
          if (!(Number(e.amount) > 0)) continue;

          const id = this.idDaOcorrencia(e.id, String(e.date));
          /* Procura inclusive o APAGADO: se o adulto excluiu a despesa de propósito,
             recriá-la seria o app desfazendo a decisão dele a cada abertura — o
             mesmo defeito que já apareceu com as semanadas apagadas. */
          if (this.data.transactions.some(x => x.id === id)) continue;

          const oque = String(e.description || '').trim();
          const rotulo = e.tipo === 'doacao'
            ? `Doação de ${kid.name}${oque ? ' — ' + oque : ''}`
            : `Gasto de ${kid.name}${oque ? ' — ' + oque : ''}`;

          this.upsert('transactions', {
            id,
            description: rotulo,
            amount: Number(e.amount) || 0,
            date: String(e.date),
            type: 'Despesa',
            /* PAGO, e não "A Pagar": o dinheiro já saiu quando ela comprou o sorvete.
               Deixar em aberto criaria uma pendência para uma decisão que ninguém
               precisa tomar — e a fila de pendências existe para o que espera ação. */
            status: 'Pago',
            scope: 'Familiar',
            account_id: contaPadrao,
            kid_id: kid.id,
            notes: 'Lançado pelo cofrinho da criança',
          });
          /* DEVOLVE O QUE CRIOU, e não só quantos. Quem chama precisa aplicar o
             efeito no saldo da conta — e sem a lista teria de adivinhar quais das
             transações são novas, o que na prática significa reaplicar o saldo de
             todas a cada chamada. */
          criadas.push(this.get('transactions', id));
        }
      }
      return criadas;
    });
  },

  /* ---------- A PONTE COM O APP DA CRIANÇA ----------

     O app dela (em cofrinho/) tem armazém próprio, `financas.cofrinho.v1`, e não
     o blob deste app: aquele é cifrado com o PIN de quem administra, e a criança
     não tem esse PIN — nem deve, porque ele abre salário, cartão e dívida.

     Só que armazém separado, sem ponte, significaria um cofrinho VAZIO em todo
     aparelho sem nuvem configurada — a criança cadastrada aqui simplesmente não
     apareceria lá. Como os dois apps rodam na MESMA origem, eles enxergam o mesmo
     localStorage, e esta função é o encontro: empurra o que este app sabe e traz
     o que ela mexeu, resolvendo por `updated_at` como o sync da nuvem faz.

     Roda no boot e depois de cada mudança de criança. É barata: quatro tabelas
     pequenas, e quem não tem criança cadastrada sai na primeira linha.

     O que trafega aqui são mesadas de dez reais — nada da vida financeira da
     casa passa por este armazém, e é por isso que ele pode ficar em claro. */
  PONTE_COFRINHO: 'financas.cofrinho.v1',
  /* ---------- A PERGUNTA DA SEMANA ----------

     O app mostra números: quanto ela tem, o que gastou, quanto falta. Nenhum deles diz
     o que CONVERSAR — e é o ponto de maior consenso entre educadores da área, além do
     mais ignorado pelos apps: dinheiro se aprende conversando, não usando aplicativo.
     O cofrinho não é a aula; é o pretexto para a aula.

     UMA POR VEZ, e a mais recente ganha. Uma lista de cinco sugestões vira uma tarefa a
     cumprir, e tarefa não se conversa. A ordem abaixo é de prioridade: o que acabou de
     acontecer rende mais conversa do que um padrão de três semanas atrás.

     TODAS AS PERGUNTAS SÃO ABERTAS, e nenhuma delas tem resposta certa embutida. "Valeu
     a pena?" convida a pensar; "por que você gastou isso?" é uma acusação com ponto de
     interrogação, e a criança responde o que o adulto quer ouvir — o que encerra a
     conversa em vez de começá-la. */
  perguntaDaSemana(kidId, refISO) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const hoje = refISO || this.hojeISO();
    const inicio = this.kidInicioDaSemana(kid, hoje);
    const todas = this.all('kid_entries').filter(e => e.kid_id === kidId);
    const semana = todas.filter(e => String(e.date) >= inicio);
    const potes = this.kidPotes(kidId);

    /* O SONHO ALCANÇADO é a maior conversa disponível, e dura pouco: some assim que ela
       compra. Vem primeiro por isso. */
    const meta = this.all('kid_goals').find(g => g.kid_id === kidId && !g.done);
    if (meta && potes.guardar >= (Number(meta.target_amount) || 0) && Number(meta.target_amount) > 0) {
      return {
        assunto: 'chegou',
        fato: `${kid.name} juntou o suficiente para ${meta.name}.`,
        pergunta: 'Pergunte como foi esperar — e o que ela quer guardar depois.',
      };
    }

    /* TIROU DO GUARDADO: a decisão mais cara que ela toma sozinha, e a que ela consegue
       explicar melhor logo depois de tomar. */
    const saque = semana.filter(e => e.pote === 'guardar'
      && (e.tipo === 'gasto' || e.tipo === 'doacao') && !e.kid_goal_id)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (saque) {
      return {
        assunto: 'saque',
        fato: `${kid.name} tirou ${this.fmtBR(saque.amount)} do pote de guardar.`,
        pergunta: 'Pergunte se valeu a pena — e ouça sem corrigir.',
      };
    }

    /* A MOEDA MÁGICA CAIU: é abstrata, e a criança precisa que alguém nomeie o que
       aconteceu para entender que foi a espera que produziu aquilo. */
    if (semana.some(e => e.tipo === 'rendimento')) {
      return {
        assunto: 'moeda',
        fato: `${kid.name} ganhou a moeda mágica esta semana.`,
        pergunta: 'Pergunte por que ela acha que ganhou. A resposta dela diz se a regra ficou clara.',
      };
    }

    /* REPARTIU: o momento em que ela decidiu, e o único em que ela escolheu proporção. */
    if (semana.some(e => e.tipo === 'divisao')) {
      return {
        assunto: 'repartiu',
        fato: `${kid.name} repartiu a semanada nos potes.`,
        pergunta: 'Pergunte por que ela escolheu esses valores. Não sugira outros.',
      };
    }

    /* NUNCA DOOU, ou faz muito tempo. É o pote de retorno invisível, e o único que
       precisa de um adulto para significar alguma coisa.

       Exige histórico: cobrar doação de quem acabou de começar seria transformar o
       terceiro pote numa dívida antes de ela entender para que ele serve. */
    const doacoes = todas.filter(e => e.tipo === 'doacao');
    const temHistorico = todas.length >= 8;
    if (temHistorico && potes.doar > 0) {
      const ultima = doacoes.map(e => String(e.date)).sort().pop();
      if (!ultima || this.noitesAte(hoje, ultima) >= 30) {
        return {
          assunto: 'doar',
          fato: `O pote de doar tem ${this.fmtBR(potes.doar)} parado${
            ultima ? ' há um tempo' : ' e nunca foi usado'}.`,
          pergunta: 'Pergunte quem ela gostaria de ajudar. Deixe a escolha ser dela.',
        };
      }
    }

    /* SEMANA PARADA. Não é problema — mas é a deixa para a conversa mais útil de todas,
       que é a que não parte de um número. */
    if (!semana.length && todas.length) {
      return {
        assunto: 'parado',
        fato: `Semana sem movimento no cofrinho de ${kid.name}.`,
        pergunta: 'Pergunte o que ela está querendo comprar. É a conversa que não precisa de motivo.',
      };
    }

    return null;
  },

  /* Formata em real sem depender da tela: a regra vive aqui para poder ser medida. */
  fmtBR(v) {
    return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
  },

  TABELAS_COFRINHO: ['kids', 'kid_goals', 'kid_tasks', 'kid_entries', 'kid_wishes'],

  /* A ponte é AUTOMÁTICA, e não uma chamada em cada função que mexe com criança.

     Chamada manual é chamada que se esquece: bastaria um fluxo novo — editar a
     meta, pagar a semanada por outro caminho — para o cofrinho dela ficar com
     dado velho, e o sintoma seria "o app da minha filha não atualizou", difícil
     de ligar à causa. Pendurado no upsert/remove, não há como esquecer.

     Com atraso de 50ms para uma edição em massa (ou um emLote) atravessar a
     ponte uma vez, não uma vez por registro. Fora do navegador — nos testes —
     não há setTimeout com agenda, então roda na hora. */
  _ponteAgendada: null,
  agendarPonte(store) {
    if (!this.TABELAS_COFRINHO.includes(store)) return;
    if (this._lote) return;                    // o fim do lote grava e a ponte vem depois
    if (typeof setTimeout !== 'function') { try { this.ponteDoCofrinho(); } catch (_) { } return; }
    clearTimeout(this._ponteAgendada);
    this._ponteAgendada = setTimeout(() => { try { this.ponteDoCofrinho(); } catch (_) { } }, 50);
  },

  ponteDoCofrinho() {
    if (!this.data) return 0;
    let lado = null;
    try { lado = JSON.parse(localStorage.getItem(this.PONTE_COFRINHO)) || null; } catch (_) { lado = null; }
    if (!lado) lado = { meta: { lastSync: null } };
    for (const t of this.TABELAS_COFRINHO) if (!lado[t]) lado[t] = [];

    // Sem criança de nenhum lado, não há ponte a manter
    const vazio = this.TABELAS_COFRINHO.every(t => !(this.data[t] || []).length && !lado[t].length);
    if (vazio) return 0;

    let mudou = 0, mudouAqui = false;
    for (const t of this.TABELAS_COFRINHO) {
      const aqui = this.data[t], la = lado[t];

      /* O DESEMPATE É O `dirty`, não só o `updated_at`.

         Os dois apps gravam com o relógio do MESMO aparelho, e localStorage é
         rápido: duas gravações no mesmo milissegundo empatam de verdade. Num
         empate resolvido só por `updated_at`, este app venceria sempre — e o que
         a criança acabou de fazer sumiria da tela dela sem explicação.

         `dirty` no lado do cofrinho quer dizer exatamente "mexi nisto depois da
         última ponte". É por isso que ele decide o empate, e é por isso que a
         volta abaixo o LIMPA: absorvido aqui, o registro deixa de ser novidade
         de lá, e a responsabilidade de subir para a nuvem passa a ser deste app
         — que fica dirty no lugar dele. */
      const venceLa = (r, meu) => {
        const dLa = String(r.updated_at || ''), dAqui = String(meu.updated_at || '');
        if (dLa > dAqui) return true;
        return dLa === dAqui && !!r.dirty;
      };

      // Vem de lá: o que a criança criou ou mexeu depois da nossa versão
      for (const r of la) {
        const i = aqui.findIndex(x => x.id === r.id);
        if (i < 0) { aqui.push({ ...r, dirty: true }); mudou++; mudouAqui = true; continue; }
        if (venceLa(r, aqui[i])) {
          // dirty fica: o que veio de lá ainda precisa subir para a nuvem daqui
          aqui[i] = { ...r, dirty: true };
          mudou++; mudouAqui = true;
        }
      }

      // Vai para lá: tudo o que este app tem, já na versão vencedora
      lado[t] = aqui.map(r => {
        const copia = { ...r };
        delete copia.dirty;
        return copia;
      });
    }

    /* ESPELHA OS GASTOS aqui, e não no boot: é neste ponto que os lançamentos dela
       acabaram de chegar. Esperar a próxima abertura deixaria o extrato da família
       sem a compra que a criança fez agora. */
    if (mudouAqui) { try { this.espelharGastosDosFilhos(); } catch (_) { } }
    lado.meta.lastSync = this.now();
    try { localStorage.setItem(this.PONTE_COFRINHO, JSON.stringify(lado)); } catch (_) { }
    if (mudouAqui) this.save();
    return mudou;
  },

  restamDaRecorrencia(r) {
    if (r.fim_tipo !== 'vezes' || !(Number(r.fim_vezes) > 0)) return null;
    return Math.max(0, Number(r.fim_vezes) - (Number(r.geradas) || 0));
  },

  /* ---------- Pendências: o que espera decisão ----------
     Lançar sozinho só serve se o que venceu não apodrecer na lista. Estas são as
     linhas que precisam de uma ação humana hoje — e por isso a fila mistura
     despesa, receita e fatura: o critério não é o tipo, é "isto está parado
     esperando você". */
  pendencias(hojeISO) {
    const hoje = hojeISO || this.paraISO(new Date());
    const itens = [];

    for (const t of this.all('transactions')) {
      if (t.status !== 'A Pagar' || t.card_id) continue;   // compra no cartão vence junto da fatura
      /* A SEMANADA NÃO ENTRA AQUI — ela tem fila própria, e ter as duas era pior
         que não ter nenhuma.

         Ela esteve nesta fila por um pedido legítimo: servir de lembrete do
         ritual. O resultado na tela foi UM ato virando DUAS linhas, com valores
         diferentes: "Semanada de Thomaz · R$ 11,00 · [Paguei]" nas contas do mês e
         "Semanada de Thomaz · R$ 10,00 · [Dar agora]" na fila das crianças. Os
         R$ 11 são o compromisso (semanada + moeda mágica); os R$ 10, o que sai
         hoje. Quem olha conclui que vai lançar duas vezes — e não tem como saber
         que uma linha só registra e a outra é a que credita o cofrinho.

         O lembrete continua existindo, na fila DAS CRIANÇAS: mesmo dia, mesmo
         aviso, com o bichinho e o nome, e um botão que faz o ato inteiro (ver
         `pagarSemanada`, que credita o cofrinho E dá baixa neste lançamento).

         Um ato, um botão, um lugar. */
      if (this.isNeutral(t)) continue;
      if (String(t.date) > hoje) continue;                  // ainda não chegou a hora
      itens.push({
        tipo: this.isExpense(t) ? 'despesa' : 'receita',
        id: t.id, tx: t, data: String(t.date),
        valor: Number(t.amount) || 0,
        titulo: t.description,
        atraso: this.diasEntre(String(t.date), hoje),
      });
    }

    /* Fatura entra na mesma fila: ela vence, atrasa e cobra juros como qualquer
       conta — separá-la faria a pessoa procurar em dois lugares o que é a mesma
       pergunta. */
    for (const card of this.all('cards').filter(c => c.active !== false)) {
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga') continue;
        const venceISO = this.paraISO(inv.due);
        if (venceISO > hoje) continue;
        if (!(inv.falta > 0.005)) continue;
        itens.push({
          tipo: 'fatura',
          id: inv.key, data: venceISO, valor: inv.falta,
          titulo: `Fatura ${card.name}`,
          atraso: this.diasEntre(venceISO, hoje),
        });
      }
    }

    /* Aporte agendado que chegou a hora entra na mesma fila.

       Sem isto, um aporte marcado para o dia 5 ficaria agendado para sempre: não
       há outra tela que pergunte "aquilo que você planejou guardar, guardou?". E
       ele é justamente o compromisso mais fácil de deixar passar — ninguém cobra
       quem não poupou. */
    for (const e of this.all('goal_entries')) {
      if (this.aportePago(e)) continue;
      if (Number(e.amount) <= 0) continue;                  // resgate agendado não é cobrança
      if (String(e.date) > hoje) continue;
      const g = this.get('goals', e.goal_id);
      if (!g || g.done) continue;
      itens.push({
        tipo: 'aporte',
        id: e.id, data: String(e.date),
        valor: Number(e.amount) || 0,
        titulo: `Guardar em ${g.name}`,
        atraso: this.diasEntre(String(e.date), hoje),
      });
    }

    // Mais atrasado primeiro: é a ordem em que o problema cresce
    return itens.sort((a, b) => b.atraso - a.atraso || b.valor - a.valor);
  },

  diasEntre(deISO, ateISO) {
    return Math.round((Date.parse(ateISO + 'T12:00:00') - Date.parse(deISO + 'T12:00:00')) / 86400000);
  },

  /* ---------- Projeção de saldo, dia a dia ----------
     Cruza o que ainda entra e o que ainda sai nas datas certas, partindo do saldo
     de hoje. Responde a pergunta que nenhuma outra tela responde: EM QUE DIA o
     dinheiro acaba.

     Só o que está "A Pagar" entra: o que já foi pago está dentro do saldo, e
     somá-lo de novo contaria duas vezes. Vencido conta no primeiro dia, porque é
     dinheiro que pode sair a qualquer momento. */
  projecaoSaldo(ateISO, deISO) {
    const inicio = deISO || this.paraISO(new Date());
    const fim = ateISO || this.fimISO(this.monthPeriod(new Date()));
    const movimento = {};
    const soma = (data, v) => { movimento[data] = (movimento[data] || 0) + v; };

    for (const t of this.all('transactions')) {
      if (t.status !== 'A Pagar' || t.card_id || this.isNeutral(t)) continue;
      const v = Number(t.amount) || 0;
      // O que venceu e não foi pago pesa já no primeiro dia
      const quando = String(t.date) < inicio ? inicio : String(t.date);
      if (quando >= fim) continue;
      soma(quando, this.isExpense(t) ? -v : v);
    }
    for (const card of this.all('cards').filter(c => c.active !== false)) {
      for (const inv of this.invoicesOf(card)) {
        if (inv.status === 'Paga' || !(inv.falta > 0.005)) continue;
        const venceISO = this.paraISO(inv.due);
        const quando = venceISO < inicio ? inicio : venceISO;
        if (quando >= fim) continue;
        soma(quando, -inv.falta);
      }
    }
    /* APORTE AGENDADO pesa na projeção do dia em que sai.

       A transferência que acompanha o aporte é neutra — não é gasto —, e por isso
       o laço acima a ignora. Mas para quem está planejando, "guardar 3.400 no dia
       3" é exatamente o tipo de movimento que decide se o mês fecha no azul: o
       dinheiro sai da conta corrente naquele dia, ainda que continue sendo da
       família. Só o que sai de uma conta conta aqui; aporte sem conta de origem é
       registro contábil e não move caixa. */
    for (const e of this.all('goal_entries')) {
      if (this.aportePago(e) || !e.from_account) continue;
      const v = Number(e.amount) || 0;
      if (v <= 0) continue;                       // resgate agendado entra por outro caminho
      const quando = String(e.date) < inicio ? inicio : String(e.date);
      if (quando >= fim) continue;
      soma(quando, -v);
    }

    let saldo = this.accountsTotal();
    const serie = [];
    for (let d = inicio; d < fim; d = this.somarDiasISO(d, 1)) {
      saldo += (movimento[d] || 0);
      serie.push({ data: d, saldo, movimento: movimento[d] || 0 });
    }
    return serie;
  },

  somarDiasISO(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return this.paraISO(d);
  },

  /* O primeiro dia em que o saldo fica negativo, se houver.

     É o aviso que muda comportamento: saber que "dia 8 o saldo fica negativo,
     porque o aluguel vence antes do salário" dá três dias para agir. O total do
     mês fechando positivo esconde exatamente isso. */
  primeiroDiaNegativo(ateISO, deISO) {
    return this.projecaoSaldo(ateISO, deISO).find(p => p.saldo < 0) || null;
  },

  /* ---------- Previsão dos próximos meses ----------
     O futuro é CALCULADO, não materializado. Gerar "A Pagar" para doze meses
     encheria o extrato de linhas que ninguém pediu e, ao cancelar uma
     recorrência, deixaria dezenas de órfãos para limpar.

     Aqui cada mês é somado na hora, a partir de três fontes: as recorrências
     ativas, o que já está lançado com data futura (parcelas de cartão, contas
     agendadas) e as faturas que vencem lá. */
  previsaoDoMes(period) {
    const de = this.inicioISO(period), ate = this.fimISO(period);
    let entra = 0, sai = 0, investe = 0;
    const itens = [];
    /* `molde` é o registro de onde o item veio — transação, contrato ou custo
       fixo. Carregar categoria, conta e método daqui é o que permite às telas
       tratarem a previsão como lançamento: sem categoria, o item não apareceria no
       donut nem na tabela por categoria, e o mês futuro teria um total que não se
       decompõe em lugar nenhum. */
    const add = (titulo, valor, receita, quando, origem, molde, extra) => {
      const m = molde || {};
      itens.push({
        titulo, valor, receita, data: quando, origem,
        category_id: m.category_id || null,
        account_id: m.account_id || null,
        card_id: m.card_id || null,
        method: m.method || '',
        scope: m.scope || '',
        member: m.member || '',
        ...(extra || {}),
      });
      if (receita) entra += valor; else sai += valor;
    };

    /* Lançado com data futura: parcelas de cartão e contas agendadas. Vem antes
       das recorrências porque é o que já existe — e o que existe manda. */
    for (const t of this.all('transactions')) {
      if (t.status !== 'A Pagar' || this.isNeutral(t)) continue;
      const d = String(t.date);
      if (d < de || d >= ate) continue;
      if (t.card_id) continue;                 // compra no cartão pesa na fatura, não solta
      add(t.description, Number(t.amount) || 0, !this.isExpense(t), d, 'lançado', t);
    }

    // Recorrências ativas: as ocorrências que caem neste mês
    for (const r of this.all('recurrences')) {
      if (r.status !== 'ativa') continue;
      /* SEMANADA NÃO É CONTA DO MÊS, em nenhuma das duas formas.

         O lançamento já materializado é neutro e foi filtrado acima; o contrato
         precisa sair aqui pelo mesmo motivo. Sem esta linha, as semanadas do mês
         saíam DUAS vezes do "Livre ao fim": as já lançadas pela linha "Dos
         filhos" e as ainda por lançar por "Contas do mês" — e qual das duas
         pesava dependia de o gerador ter rodado, o que muda ao longo do mês.

         Um número que se altera conforme a hora em que se abre o app não serve
         para decidir nada. Todas as semanadas passam pela mesma porta: a linha
         "Dos filhos". Ver `dosFilhosAVir`. */
      if (r.kid_id) continue;
      for (let n = 0; n < 400; n++) {
        const data = this.dataDaOcorrencia(r, n);
        if (data >= ate) break;
        if (this.recorrenciaEncerrada(r, data, n)) break;
        if (data < de) continue;
        /* Já materializada: contar de novo somaria o mesmo compromisso duas vezes.
           A regra vive em `ocorrenciaJaLancada` e é a MESMA que o gerador usa —
           tem de ser, senão a previsão promete um item que o gerador não cria (ou
           o contrário) e as duas telas param de contar a mesma história. */
        if (this.ocorrenciaJaLancada(r, data)) continue;
        add(r.description, this.valorDaRecorrencia(r), r.type === 'Receita', data, 'prevista', r);
      }
    }

    /* MOVIMENTAÇÃO FUTURA VEM SÓ DE CONTRATO.

       Havia um segundo mecanismo aqui: a transação marcada `recurring`, que o
       botão "Custos fixos" copiava para o mês. Duas fontes para a mesma pergunta
       — "o que se repete?" — e foi delas que nasceu a pior combinação medida
       nesta base: marcar uma dentadura de R$ 770 como fixa acrescentava R$ 770 às
       contas de setembro E de outubro, e o item não aparecia na tela "Contas
       fixas", que lia só os contratos.

       O contrato ganha porque faz mais e faz sozinho: tem periodicidade, prazo,
       valor médio, pausar e cancelar, e gera o lançamento na data certa já com
       `recurrence_id`. A marca não tinha nada disso — o próprio formulário já
       tinha deixado de oferecê-la.

       `recurring` continua no banco e no sync: apagar dado de base antiga seria
       pior que ignorá-lo. Ele só deixou de ser LIDO como fonte de repetição. */
    /* APORTE AGENDADO: compromisso do mês, mas NÃO é saída.

       Guardar dinheiro é transferência entre contas próprias — o valor continua
       dentro de `accountsTotal`, só troca de bolso. Somá-lo a `sai` dizia que
       agosto custa R$ 15.529 quando R$ 3.400 daquilo vira patrimônio, e quebrava
       a identidade que o app trava por teste: "despesas do Extrato = saídas
       previstas − fatura" (docs/plano-visao-futuro.md). Medido: a diferença era
       exatamente o aporte.

       Por isso ele tem contador próprio. `resultado` continua sendo o mesmo
       número de antes — entra − sai − investe —, então nada que dependa dele muda.

       Só o APORTE entra aqui. Um investimento lançado à mão como despesa no
       envelope sai da conta de verdade e continua em `sai`, que é onde pertence
       do ponto de vista de caixa. Por isso este laço lê `goal_entries` e não
       `investidoNoPeriodo`, que soma os dois.

       NÃO se deduplica contra a transferência que acompanha o aporte: ela é
       NEUTRA (`isNeutral`) e por isso nunca entrou no laço de "lançado" acima —
       pular o aporte por causa dela apagava o compromisso em vez de evitar
       repetição. */
    for (const e of this.all('goal_entries')) {
      if (this.aportePago(e)) continue;
      const v = Number(e.amount) || 0;
      if (v <= 0) continue;                        // resgate não é compromisso
      const d = String(e.date);
      if (d < de || d >= ate) continue;
      const meta = this.get('goals', e.goal_id);
      const env = this.envelopeDeInvestimento();
      add(`Guardar em ${meta ? meta.name : 'meta'}`, v, false, d, 'aporte',
        { account_id: e.from_account, category_id: meta ? this.categoriaDeAporte(meta) : (env ? env.id : null) });
      investe += v;
      sai -= v;          // `add` somou em `sai`; aqui ele muda de coluna
    }

    /* Faturas que vencem neste mês.

       O valor é o que FALTA, não o total: uma fatura de R$ 1.000 com R$ 700 já
       pagos pesa R$ 300 no mês. Mas quem pagou parcial precisa da referência do
       total, senão o número menor lê como "o pagamento não entrou" — por isso
       `status`, `total` e `pago` viajam junto com o item. Antes eles ficavam só na
       lista de vencimentos do Painel, e a linha da previsão dizia menos do que a
       tela ao lado sobre a mesma fatura. */
    for (const inv of this.faturasAbertas(ate, de)) {
      add(`Fatura ${inv.card.name}`, Math.max(0, inv.falta), false, this.paraISO(inv.due), 'fatura',
        { card_id: inv.card.id },
        { invoice_key: inv.key, fatura_status: inv.status, fatura_total: inv.total, fatura_pago: inv.pago });
    }

    itens.sort((a, b) => String(a.data).localeCompare(String(b.data)));
    return { period, entra, sai, investe, resultado: entra - sai - investe, itens };
  },

  /* Os itens da previsão que AINDA NÃO EXISTEM como lançamento.

     `previsaoDoMes` devolve tudo o que pesa no mês, inclusive o que já está
     lançado e as faturas. Para as telas, o que interessa somar por cima do que já
     existe é só o que não está lá: recorrência ainda não gerada e custo fixo ainda
     não copiado. Fatura fica fora porque o extrato já a mostra como linha própria.

     Não vira transação de verdade em lugar nenhum — é uma projeção calculada na
     hora. Materializar seis meses de "A Pagar" encheria o extrato de registros que
     ninguém pediu e que dariam trabalho para desfazer. */
  previstosNaoLancados(period) {
    return this.previsaoDoMes(period).itens
      .filter(i => i.origem === 'prevista' || i.origem === 'custo fixo');
  },

  /* Os próximos n meses, com o saldo rolando de um para o outro.

     O saldo acumulado é o ponto: cada mês parte do que sobrou do anterior, então
     um mês negativo no meio contamina os seguintes — e é exatamente isso que
     olhar mês a mês, isolado, não mostra. */
  previsaoMeses(n = 6, deOffset = 1) {
    let saldo = this.accountsTotal() - this.committed() - this.guardado();
    const fora = [];
    for (let i = 0; i < n; i++) {
      const p = this.monthPeriod(new Date(), deOffset + i);
      const m = this.previsaoDoMes(p);
      saldo += m.resultado;
      fora.push({ ...m, saldoAoFim: saldo });
    }
    return fora;
  },

  /* ---------- Fluxo mensal: o passado real e o futuro previsto ----------
     Doze meses no mesmo eixo, com a fronteira de hoje no meio. É a única visão
     que responde "de onde vim e para onde vou" sem trocar de tela — e a linha do
     saldo cruzando de sólida para tracejada mostra exatamente onde o dado acaba e
     a previsão começa.

     As duas metades vêm de fontes diferentes, e tem de ser assim: o passado sai
     do saldo REAL (conciliado com o banco, é o número confiável) e o futuro rola
     a partir de hoje somando o que está previsto. Misturar as duas origens numa
     só faria o passado herdar a incerteza da previsão. */
  fluxoMensal(passados = 6, futuros = 6) {
    const fora = [];

    // Passado e mês corrente: realizado, com o saldo real no fim de cada um
    for (let i = passados; i >= 0; i--) {
      const p = this.monthPeriod(new Date(), -i);
      const entra = this.incomesOf(p).filter(t => !t.card_id && t.status === 'Pago')
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const sai = this.expensesOf(p).filter(t => t.status === 'Pago')
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      fora.push({
        period: p, entra, sai, futuro: false,
        // No mês corrente o fim ainda não chegou: vale o previsto até lá
        saldo: i === 0 ? this.saldoPrevistoNaData(null, this.fimISO(p))
          : this.saldoNaData(null, this.fimISO(p)),
      });
    }

    /* Futuro: rola a partir do saldo do fim do mês corrente. previsaoDoMes conta
       as recorrências, que NÃO estão materializadas além do ciclo atual — sem
       elas a linha ficaria plana e a projeção não diria nada. */
    /* O saldo aqui é o EM CONTAS, e o aporte não o reduz: ele é transferência
       entre contas próprias, e a metade passada desta série vem do saldo real
       conciliado, que soma todas as contas — inclusive a de investimento.

       Por isso rola `entra − sai` e não `resultado` (que desconta o investimento).
       Medido: com `resultado`, o gráfico terminava agosto em R$ 2.728 enquanto o
       hero e o extrato do mesmo mês diziam R$ 6.128 — a diferença era exatamente
       o aporte, e a linha do gráfico contradizia as duas outras telas. */
    let saldo = fora[fora.length - 1].saldo;
    for (let i = 1; i <= futuros; i++) {
      const p = this.monthPeriod(new Date(), i);
      const m = this.previsaoDoMes(p);
      saldo += m.entra - m.sai;
      fora.push({ period: p, entra: m.entra, sai: m.sai, futuro: true, saldo, itens: m.itens });
    }
    return fora;
  },

  /* ---------- Estatística dos relatórios ----------
     Mediana e desvio mediano (MAD), não média e desvio padrão.

     Motivo concreto: uma compra grande num mês — o IPVA, uma viagem — puxa a
     média e infla o desvio, e aí NADA parece anormal depois. A mediana ignora o
     ponto fora da curva, então "este mês está fora do normal" continua querendo
     dizer alguma coisa. É a diferença entre um relatório que avisa e um que só
     mostra números. */
  mediana(vals) {
    const v = vals.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return 0;
    const meio = Math.floor(v.length / 2);
    return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  },

  // Desvio mediano absoluto: a mediana das distâncias até a mediana
  desvioMediano(vals) {
    const med = this.mediana(vals);
    return this.mediana(vals.map(v => Math.abs(v - med)));
  },

  /* Série dos últimos n períodos fechados + o atual. `medir` recebe o período.
     Ordem cronológica, o atual por último. */
  serieMensal(n, medir) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const p = this.monthPeriod(new Date(), -i);
      out.push({ period: p, valor: medir(p) || 0 });
    }
    return out;
  },

  /* Quão fora do normal está um valor, em desvios medianos.

     Devolve também o rótulo, porque o número cru não serve para quem lê: 1,2
     desvios é "dentro do normal" e 3,5 é "muito acima". O limite de 1,5 vem da
     prática de detecção robusta de anômalos — abaixo disso a variação é ruído do
     dia a dia, e apontá-la como notícia treinaria a pessoa a ignorar os avisos. */
  anormalidade(valor, historico) {
    const base = historico.filter(v => v > 0);
    if (base.length < 3) return { desvios: 0, rotulo: 'sem histórico', med: this.mediana(base), incerto: true };
    const med = this.mediana(base);
    const mad = this.desvioMediano(base) || med * 0.1 || 1;
    const desvios = (valor - med) / mad;
    const abs = Math.abs(desvios);
    /* DUAS condições, não uma: o desvio tem de ser estatisticamente fora da faixa
       E materialmente relevante.

       Sem a segunda, uma família de gasto muito regular tem MAD minúsculo, e
       gastar 5% a mais vira "muito acima do normal" — R$ 1.050 contra mediana de
       R$ 1.002 dá 6,3 desvios. Tecnicamente correto e praticamente absurdo: o
       app grita lobo, e quem lê aprende a ignorar o aviso.

       Significância sem tamanho de efeito engana. O piso de 8% é o mesmo espírito
       da regra de "=" nas categorias: abaixo disso é oscilação de mercado, mês
       com cinco fins de semana, prazo de fatura. */
    const relativo = med > 0 ? Math.abs(valor - med) / med : 0;
    const relevante = relativo >= 0.08;
    const rotulo = (abs < 1.5 || !relevante) ? 'dentro do normal'
      : (abs < 3 || relativo < 0.25) ? (desvios > 0 ? 'acima do normal' : 'abaixo do normal')
      : (desvios > 0 ? 'muito acima do normal' : 'muito abaixo do normal');
    return { desvios, rotulo, med, mad, relativo, relevante, incerto: base.length < 6 };
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
     o teto é do envelope, e é isso que evita orçamento contado duas vezes.

     DOIS PRINCÍPIOS guiam os nomes daqui, e os dois vieram de confusão real ao
     classificar:

     1. NOME ÚNICO ENTRE ENVELOPES. No seletor a subcategoria aparece sozinha, e
        "Manutenção" em Moradia e em Transporte era a mesma palavra para o telhado
        e para a embreagem. Idem "Roupas" (Filhos e Vestuário) e "Saúde" (envelope
        e subcategoria de Filhos). Cada um ganhou nome próprio.

     2. SEPARAR POR INTENÇÃO, não por estabelecimento. Almoço de terça e jantar de
        aniversário saem do mesmo restaurante e respondem perguntas diferentes: um
        é comida, o outro é programa. Misturados, o envelope de Alimentação
        engorda com lazer e ninguém sabe onde cortar. Por isso "Restaurante do dia
        a dia" (Alimentação) e "Bar e restaurante (programa)" (Lazer) — e a mesma
        régua em Viagem, Farmácia e Aplicativos.

     Os orçamentos são para uma renda de referência de R$ 17.000 e seguem 50·30·20
     com a dívida contando como necessidade: 56% necessidades, 15% estilo, 20%
     investimento, e ~9% de folga deliberada — orçamento que consome 100% da renda
     estoura no primeiro imprevisto e ensina a ignorar o plano. */
  ARVORE_PADRAO: [
    [['Moradia', '🏠', 4180, 'Essencial'], ['Aluguel / Financiamento', 'Condomínio', 'Luz', 'Água', 'Gás', 'Internet / TV', 'Reparos em casa']],
    [['Alimentação', '🍽️', 1700, 'Essencial'], ['Mercado', 'Feira / Açougue', 'Restaurante do dia a dia', 'Delivery', 'Padaria', 'Café / Lanche']],
    [['Transporte', '🚗', 2180, 'Essencial'], ['Combustível', 'Parcela / Financiamento', 'Oficina / Revisão', 'Aplicativo / Táxi', 'Transporte público', 'Estacionamento', 'IPVA / Licenciamento', 'Seguro', 'Pedágio']],
    [['Saúde', '💊', 500, 'Essencial'], ['Plano de saúde', 'Remédios', 'Consulta', 'Exames', 'Dentista', 'Academia']],
    [['Filhos', '🧒', 700, 'Essencial'], ['Escola das crianças', 'Roupas das crianças', 'Pediatra / Saúde infantil', 'Brinquedos', 'Atividades']],
    [['Empréstimos', '🏷️', 350, 'Essencial'], ['Pagamento Empréstimos']],
    [['Educação', '📚', 200, 'Essencial'], ['Curso', 'Faculdade', 'Material', 'Livros']],
    [['Serviços & Taxas', '🧾', 200, 'Essencial'], ['Tarifas bancárias', 'Impostos', 'Seguros', 'Cartório / Documentos', 'Doações']],
    [['Lazer', '🎮', 700, 'Estilo'], ['Bar e restaurante (programa)', 'Viagem — passagem e hospedagem', 'Viagem — gastos no destino', 'Cinema / Show', 'Passeio', 'Jogos', 'Hobby']],
    [['Gastos Pessoais', '👤', 500, 'Estilo', 'Pessoal'], ['Beleza / Cabelo', 'Higiene e cuidados', 'Diversos pessoais']],
    [['Vestuário', '👕', 300, 'Estilo'], ['Roupas', 'Calçados', 'Acessórios']],
    [['Pets', '🐾', 250, 'Essencial'], ['Ração', 'Veterinário', 'Banho e tosa']],
    [['Presentes', '🎁', 200, 'Estilo'], ['Aniversários', 'Datas comemorativas']],
    [['Assinaturas', '🔁', 150, 'Estilo'], ['Streaming', 'Música', 'Aplicativos e software', 'Nuvem', 'Revista / Jornal']],
    /* INVESTIMENTOS é envelope de SAÍDA, e isso não é contradição: o dinheiro sai
       do caixa do mês exatamente como o aluguel sai. A diferença é que ele não
       desaparece — vira patrimônio.

       Por isso o aporte continua sendo TRANSFERÊNCIA (o saldo tem de aparecer na
       conta de investimento, não sumir), e o que esta categoria faz é dar nome à
       movimentação no extrato e teto ao plano do mês. Quanto foi cumprido se lê
       nos aportes, não em "gasto" — ver `investidoNoPeriodo`. */
    [['Investimentos', '📈', 3400, 'Essencial'], ['Reserva de emergência', 'Objetivos e metas', 'Aposentadoria / Longo prazo', 'Investimento avulso']],
  ],

  /* Entradas: sem orçamento e sem 50/30/20 — o que importa aqui é a ORIGEM.
     "Empréstimos" está separado de propósito: dinheiro emprestado entra na conta e
     não é ganho; somado à renda, infla a taxa de poupança e a base do 50/30/20, e
     some a dívida que ficou. Separado, dá para ver quanto entrou de verdade. */
  ARVORE_ENTRADAS: [
    [['Trabalho', '💼'], ['Salário', '13º salário', 'Férias', 'Bônus / PLR', 'Comissão', 'Freelance / Extra']],
    [['Investimentos', '📈'], ['Rendimento', 'Dividendos', 'Resgate', 'Venda de ativo']],
    [['Empréstimos', '🤝'], ['Empréstimo recebido', 'Devolução de empréstimo', 'Parcela recebida']],
    [['Aluguéis', '🏘️'], ['Aluguel recebido']],
    [['Benefícios', '🧾'], ['Auxílio', 'Pensão', 'Restituição de imposto', 'Seguro / Indenização']],
    [['Outras entradas', '💵'], ['Reembolso', 'Venda de usados', 'Presente recebido', 'Estorno', 'Diversos']],
  ],

  /* Renda para a qual os orçamentos do catálogo foram calculados.

     Ela existe para que os valores possam ser ESCALADOS: um catálogo com números
     absolutos serve a uma renda e desorienta todas as outras — quem ganha 5 mil
     abriria o app com 15.510 orçados e concluiria, com razão, que o plano não é
     sobre a vida dele. */
  RENDA_DE_REFERENCIA: 17000,

  /* Recalcula os tetos proporcionalmente a uma renda.

     Proporção, e não regra nova por envelope: as fatias do catálogo já foram
     pensadas juntas (56% necessidades, 15% estilo, 20% investimento, ~9% de
     folga), e mexer numa sem mexer nas outras desmonta o conjunto.

     ARREDONDA para dezena — um teto de "R$ 1.323,53" sugere uma precisão que
     orçamento não tem, e ninguém decide nada com os centavos.

     `rendaAnterior` é o que permite distinguir "valor sugerido" de "decisão da
     pessoa": um envelope está sugerido se ainda vale o que o catálogo daria para a
     renda antiga (ou o valor cru do catálogo, ou zero). Qualquer outro número foi
     escolhido à mão e fica intacto — reescrever a decisão de quem vive com o
     orçamento é justamente a "ajuda" que faz alguém desistir de planejar. */
  calibrarOrcamentos(renda, rendaAnterior) {
    const alvo = Number(renda) || 0;
    if (alvo <= 0) return 0;
    const escala = (v, base) => Math.round(v * (base / this.RENDA_DE_REFERENCIA) / 10) * 10;
    const antes = Number(rendaAnterior) || 0;
    const padrao = {};
    for (const [[nome, , budget]] of this.ARVORE_PADRAO) padrao[nome] = budget;
    let mudados = 0;
    this.emLote(() => {
      for (const c of this.rootCategories('Despesa')) {
        const doCatalogo = padrao[c.name];
        if (doCatalogo === undefined) continue;                     // envelope criado à mão
        const atual = Number(c.monthly_budget) || 0;
        const sugerido = atual === 0 || atual === doCatalogo
          || (antes > 0 && atual === escala(doCatalogo, antes));
        if (!sugerido) continue;
        const novo = escala(doCatalogo, alvo);
        if (atual === novo) continue;
        this.upsert('categories', { ...c, monthly_budget: novo });
        mudados++;
      }
    });
    return mudados;
  },

  seed() {
    if (this.data.meta.seeded) return;
    this.data.categories = [...this.montarArvore(this.ARVORE_PADRAO, 'Despesa'), ...this.montarArvore(this.ARVORE_ENTRADAS, 'Receita')];
    this.data.meta.seeded = true;
    this.save();
  },

  montarArvore(arvore, tipo) {
    const cat = (name, icon, budget = 0, kind = 'Essencial', scope = 'Família') =>
      ({ id: this.uuid(), name, icon, monthly_budget: budget, kind, scope, type: tipo, parent_id: null, updated_at: this.now(), deleted: false, dirty: true });
    const lista = [];
    for (const [pai, filhas] of arvore) {
      const raiz = cat(...pai);
      lista.push(raiz);
      for (const nome of filhas) {
        const f = cat(nome, raiz.icon, 0, raiz.kind, raiz.scope);
        f.parent_id = raiz.id;
        lista.push(f);
      }
    }
    return lista;
  },

  /* Base criada antes das categorias de entrada não tem nenhuma, e o seed não roda
     de novo. Cria as que faltam sem tocar no que já existe. */
  criarCategoriasDeEntrada() {
    if (!this.data) return 0;
    const existentes = this.rootCategories('Receita').map(c => this._semAcento(c.name));
    let criadas = 0;
    for (const [pai, filhas] of this.ARVORE_ENTRADAS) {
      if (existentes.includes(this._semAcento(pai[0]))) continue;
      if (this.acharCategoria(pai[0], null, 'Receita')) continue;
      const raiz = this.upsert('categories', {
        name: pai[0], icon: pai[1], type: 'Receita', scope: 'Família',
        kind: 'Essencial', monthly_budget: 0, parent_id: null,
      });
      criadas++;
      for (const nome of filhas) {
        this.upsert('categories', {
          name: nome, icon: pai[1], type: 'Receita', scope: 'Família',
          kind: 'Essencial', monthly_budget: 0, parent_id: raiz,
        });
        criadas++;
      }
    }
    return criadas;
  },

  _semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); },

  /* Já existe uma categoria com este nome, no mesmo nível e do mesmo lado?
     Ignora acento e caixa: "Alimentação" e "alimentacao" são a mesma coisa para
     quem usa, e deixar as duas conviverem divide o gasto em dois lugares. */
  acharCategoria(nome, parentId, tipo) {
    const alvo = this._semAcento(nome);
    if (!alvo) return null;
    return this.all('categories').find(c =>
      this._semAcento(c.name) === alvo &&
      (c.parent_id || null) === (parentId || null) &&
      this.categoryType(c) === (tipo || 'Despesa')) || null;
  },

  /* Categoria criada pelo seed que nunca foi usada nem enviada.
     Cada aparelho novo cria as ~100 categorias de fábrica com ids próprios; ao
     entrar numa família que já tem as dela, essas locais viram duplicatas — foi
     assim que uma base chegou a 312 categorias. Descartar antes do primeiro
     envio é o que impede a multiplicação.

     Só descarta o que é seguro: nunca sincronizado (ainda dirty), sem nenhum
     lançamento apontando para ele e sem subcategoria em uso. */
  descartarCategoriasNaoUsadas() {
    if (!this.data) return 0;
    const usadas = new Set(this.all('transactions').map(t => t.category_id).filter(Boolean));
    const temFilhaUsada = id => this.subcategoriesOf(id).some(f => usadas.has(f.id));
    const alvo = this.data.categories.filter(c =>
      !c.deleted && c.dirty && !usadas.has(c.id) && !temFilhaUsada(c.id));
    for (const c of alvo) c.deleted = true;
    // Remove de vez: nunca chegaram ao servidor, então não há remoção a propagar
    this.data.categories = this.data.categories.filter(c => !alvo.includes(c));
    if (alvo.length) this.save();
    return alvo.length;
  },

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
        if (this.acharCategoria(nome, raiz.id, this.categoryType(raiz))) continue;
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
