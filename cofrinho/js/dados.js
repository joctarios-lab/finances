/* Cofrinho — a camada de dados do app da criança.

   POR QUE UM ARMAZÉM PRÓPRIO, e não o do app da família?

   O app da família guarda tudo num blob cifrado com o PIN de quem administra
   (ver js/db.js, KCrypto). A criança não tem esse PIN — nem deve ter: ele abre
   salários, cartões e dívidas. Então este app tem o armazém DELE, com as quatro
   tabelas do cofrinho e mais nada. Se alguém abrir o localStorage do aparelho,
   o que está aqui são mesadas de dez reais, não a vida financeira da casa.

   A NUVEM É A MESMA. Os dois apps moram na mesma origem, então este lê
   `financas.sync.v1` — a configuração que o adulto já preencheu no app da
   família — e conversa direto com o Supabase. Não há um segundo login: quem
   configurou lá, configurou aqui.

   O TOKEN É COMPARTILHADO, e isso exige cuidado. O Supabase ROTACIONA o refresh
   token a cada renovação: o antigo morre. Se este app renovasse e guardasse o
   novo só para si, o app da família perderia o acesso na próxima sincronização
   — e o adulto veria "faça login de novo" sem entender por quê. Por isso
   `salvarSessao` escreve de volta na MESMA chave que o outro app lê. Um token
   só, dois apps. */
'use strict';

const CHAVE = 'financas.cofrinho.v1';
const CHAVE_SYNC = 'financas.sync.v1';
const TABELAS = ['kids', 'kid_goals', 'kid_tasks', 'kid_entries'];

// As colunas que vão para a nuvem, espelhando js/sync.js. Uma coluna a mais aqui
// do que lá seria um 400 do PostgREST a cada envio — e o cofrinho pararia calado.
const COLUNAS = {
  kids: ['name', 'avatar', 'cor', 'nascimento_ano', 'semanada_valor', 'semanada_dia',
    'rendimento_tipo', 'rendimento_valor', 'pin_hash', 'pin_salt', 'active'],
  kid_goals: ['kid_id', 'name', 'icon', 'target_amount', 'done'],
  kid_tasks: ['kid_id', 'name', 'icon', 'amount', 'active'],
  kid_entries: ['kid_id', 'tipo', 'pote', 'amount', 'date', 'description', 'task_id', 'kid_goal_id', 'confirmada'],
};

const Dados = {
  d: null,

  carregar() {
    try { this.d = JSON.parse(localStorage.getItem(CHAVE)) || null; } catch (_) { this.d = null; }
    if (!this.d) this.d = { meta: { lastSync: null } };
    for (const t of TABELAS) if (!this.d[t]) this.d[t] = [];
    return this.d;
  },

  salvar() { localStorage.setItem(CHAVE, JSON.stringify(this.d)); },

  uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  },

  agora() { return new Date().toISOString(); },

  hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  paraISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  somarDiasISO(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return this.paraISO(d);
  },

  all(t) { return (this.d[t] || []).filter(r => !r.deleted); },
  get(t, id) { return (this.d[t] || []).find(r => r.id === id && !r.deleted) || null; },

  upsert(t, obj) {
    const lista = this.d[t];
    const i = obj.id ? lista.findIndex(r => r.id === obj.id) : -1;
    const reg = { ...(i >= 0 ? lista[i] : {}), ...obj, updated_at: this.agora(), dirty: true };
    if (!reg.id) reg.id = this.uuid();
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    this.salvar();
    return reg.id;
  },

  remove(t, id) {
    const r = (this.d[t] || []).find(x => x.id === id);
    if (!r) return false;
    r.deleted = true; r.updated_at = this.agora(); r.dirty = true;
    this.salvar();
    return true;
  },

  /* ---------- As contas do cofrinho ----------
     São as mesmas de js/db.js, de propósito: o adulto e a criança precisam ver
     o MESMO saldo. Duas contas parecidas viram duas verdades, e quando o número
     da tela dela não bate com o da tela dele, quem perde a confiança no app é
     a criança. */

  criancas() {
    return this.all('kids').filter(k => k.active !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  potes(kidId) {
    const potes = { gastar: 0, guardar: 0, doar: 0 };
    for (const e of this.all('kid_entries')) {
      if (e.kid_id !== kidId || e.confirmada === false) continue;
      const p = potes[e.pote] === undefined ? 'gastar' : e.pote;
      const v = Number(e.amount) || 0;
      potes[p] += (e.tipo === 'gasto' || e.tipo === 'doacao') ? -v : v;
    }
    potes.total = potes.gastar + potes.guardar + potes.doar;
    return potes;
  },

  meta(kidId) { return this.all('kid_goals').find(g => g.kid_id === kidId && !g.done) || null; },

  semanasParaMeta(kidId) {
    const meta = this.meta(kidId);
    const kid = this.get('kids', kidId);
    if (!meta || !kid) return null;
    const falta = (Number(meta.target_amount) || 0) - this.potes(kidId).guardar;
    if (falta <= 0) return 0;
    const porSemana = (Number(kid.semanada_valor) || 0)
      + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);
    if (porSemana <= 0) return null;
    return Math.ceil(falta / porSemana);
  },

  inicioDaSemana(kid, refISO) {
    const hoje = refISO || this.hojeISO();
    const d = new Date(hoje + 'T12:00:00');
    const alvo = Math.min(6, Math.max(0, Number(kid.semanada_dia) || 0));
    const recuo = (d.getDay() - alvo + 7) % 7;
    d.setDate(d.getDate() - recuo);
    return this.paraISO(d);
  },

  entradas(kidId) {
    return this.all('kid_entries')
      .filter(e => e.kid_id === kidId && e.confirmada !== false)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updated_at).localeCompare(String(a.updated_at)));
  },

  tarefas(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return [];
    const inicio = this.inicioDaSemana(kid);
    const marcadas = this.all('kid_entries').filter(e =>
      e.kid_id === kidId && e.tipo === 'tarefa' && String(e.date) >= inicio);
    return this.all('kid_tasks')
      .filter(t => t.kid_id === kidId && t.active !== false)
      .map(t => {
        const feita = marcadas.find(e => e.task_id === t.id);
        return {
          ...t, feita: !!feita,
          confirmada: feita ? feita.confirmada !== false : false,
          entryId: feita ? feita.id : null,
        };
      });
  },

  /* A SEMANADA A DIVIDIR.

     O adulto paga a semanada inteira no pote GASTAR — é o dinheiro chegando, sem
     opinião. A divisão nos três potes é o momento de aprendizado, e é aqui, no
     app dela. Uma semanada só espera divisão se a criança ainda não mexeu nela
     nesta semana: se já dividiu, o ritual está cumprido. */
  semanadaADividir(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const inicio = this.inicioDaSemana(kid);
    const sem = this.all('kid_entries').find(e =>
      e.kid_id === kidId && e.tipo === 'semanada' && String(e.date) >= inicio);
    if (!sem) return null;
    const jaDividiu = this.all('kid_entries').some(e =>
      e.kid_id === kidId && e.tipo === 'divisao' && String(e.date) >= inicio);
    if (jaDividiu) return null;
    return { entry: sem, valor: Number(sem.amount) || 0 };
  },

  /* DIVIDIR: três lançamentos de 'divisao' que somam zero.

     Podia ser um só, mudando o pote da semanada. Não é, por dois motivos: o
     histórico dela precisa MOSTRAR a escolha ("guardei 3, doei 1"), e o registro
     original da semanada não pode ser reescrito — ele é do adulto, e o app da
     criança nunca reescreve o que o adulto lançou. */
  dividir(kidId, guardar, doar) {
    const hoje = this.hojeISO();
    const g = Math.max(0, Number(guardar) || 0);
    const d = Math.max(0, Number(doar) || 0);
    if (g + d <= 0) {
      // Escolheu não repartir: o registro existe assim mesmo, para o ritual não
      // ficar aberto para sempre pedindo uma divisão que já foi decidida.
      this.upsert('kid_entries', {
        kid_id: kidId, tipo: 'divisao', pote: 'gastar', amount: 0,
        date: hoje, description: 'Deixei tudo para gastar', confirmada: true,
      });
      return true;
    }
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'gastar', amount: -(g + d),
      date: hoje, description: 'Reparti a semanada', confirmada: true,
    });
    if (g > 0) this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'guardar', amount: g,
      date: hoje, description: 'Para guardar', confirmada: true,
    });
    if (d > 0) this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'doar', amount: d,
      date: hoje, description: 'Para doar', confirmada: true,
    });
    return true;
  },

  /* MARCAR TAREFA: nasce sem confirmação, e é isso que a torna honesta.

     O dinheiro não entra no pote enquanto o adulto não vir. Se entrasse na hora,
     o app estaria pagando por dizer que fez — e a criança aprenderia a dizer. */
  marcarTarefa(kidId, taskId) {
    const t = this.get('kid_tasks', taskId);
    if (!t) return false;
    const ja = this.tarefas(kidId).find(x => x.id === taskId);
    if (!ja || ja.feita) return false;
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'tarefa', pote: 'gastar', amount: Number(t.amount) || 0,
      date: this.hojeISO(), description: t.name, task_id: taskId, confirmada: false,
    });
    return true;
  },

  desmarcarTarefa(kidId, taskId) {
    const t = this.tarefas(kidId).find(x => x.id === taskId);
    if (!t || !t.feita || t.confirmada) return false;   // confirmada não se desfaz
    this.remove('kid_entries', t.entryId);
    return true;
  },

  /* GASTAR e DOAR: só até onde o pote alcança.

     Recusar o que não cabe é a lição inteira do app. Um cofrinho que aceita
     gastar mais do que tem ensina exatamente o que a família está tentando
     evitar que ele aprenda depois, com cartão de crédito. */
  gastar(kidId, pote, valor, oque) {
    const v = Number(valor) || 0;
    if (v <= 0) return { ok: false, motivo: 'valor' };
    if (this.potes(kidId)[pote] < v) return { ok: false, motivo: 'falta' };
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: pote === 'doar' ? 'doacao' : 'gasto', pote,
      amount: v, date: this.hojeISO(), description: oque || (pote === 'doar' ? 'Doação' : 'Compra'),
      confirmada: true,
    });
    return { ok: true };
  },

  /* SELOS DA SEMANA: o que ela conquistou, sem prometer nada em dinheiro.

     Selo é reconhecimento, não pagamento. Recompensa em dinheiro por tudo faz o
     efeito contrário do pretendido (superjustificação): a criança para de fazer
     pelo gosto e passa a fazer pelo preço, e some quando o preço some. */
  selos(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return [];
    const inicio = this.inicioDaSemana(kid);
    const tarefas = this.tarefas(kidId);
    const semana = this.all('kid_entries').filter(e => e.kid_id === kidId && String(e.date) >= inicio);
    const p = this.potes(kidId);
    const meta = this.meta(kidId);
    return [
      {
        id: 'dividiu', nome: 'Repartidor', dica: 'Dividiu a semanada nos potes',
        ganho: semana.some(e => e.tipo === 'divisao'),
      },
      {
        id: 'tarefas', nome: 'Caprichoso', dica: 'Fez todas as tarefas da semana',
        ganho: tarefas.length > 0 && tarefas.every(t => t.feita),
      },
      {
        id: 'guardou', nome: 'Formiguinha', dica: 'Não tirou nada do pote de guardar',
        ganho: p.guardar > 0 && !semana.some(e => e.pote === 'guardar' && (e.tipo === 'gasto' || e.tipo === 'doacao')),
      },
      {
        id: 'doou', nome: 'Coração grande', dica: 'Colocou dinheiro no pote de doar',
        ganho: semana.some(e => e.pote === 'doar' && e.amount > 0),
      },
      {
        id: 'moeda', nome: 'Moeda mágica', dica: 'Esperou e o dinheiro rendeu',
        ganho: semana.some(e => e.tipo === 'rendimento'),
      },
      {
        id: 'meta', nome: 'Chegou lá!', dica: 'Alcançou o sonho que estava guardando',
        ganho: !!meta && p.guardar >= (Number(meta.target_amount) || 0),
      },
    ];
  },
};

/* ---------- A nuvem ---------- */

const Nuvem = {
  cfg: null,
  onStatus: null,

  carregar() {
    try { this.cfg = JSON.parse(localStorage.getItem(CHAVE_SYNC)) || {}; } catch (_) { this.cfg = {}; }
    const pre = (typeof window !== 'undefined' && window.FINANCAS_SUPABASE) || {};
    if (!this.cfg.url && pre.url) { this.cfg.url = pre.url.replace(/\/$/, ''); this.cfg.anonKey = pre.anonKey; }
    return this.cfg;
  },

  // Escreve na chave do app da família — ver o comentário do topo sobre rotação
  salvarSessao(d) {
    this.carregar();
    if (d.access_token) this.cfg.access_token = d.access_token;
    if (d.refresh_token) this.cfg.refresh_token = d.refresh_token;
    if (d.expires_in) this.cfg.token_exp = Date.now() + (d.expires_in - 60) * 1000;
    localStorage.setItem(CHAVE_SYNC, JSON.stringify(this.cfg));
  },

  pronta() { return !!(this.cfg && this.cfg.url && this.cfg.anonKey && this.cfg.refresh_token && this.cfg.family_id); },

  cabecalho() {
    const h = { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' };
    if (this.cfg.access_token) h.Authorization = 'Bearer ' + this.cfg.access_token;
    return h;
  },

  async renovar() {
    const res = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.cfg.refresh_token }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.access_token) throw new Error('sessão expirada');
    this.salvarSessao(d);
  },

  async garantirToken() {
    if (!this.cfg.access_token || !this.cfg.token_exp || Date.now() > this.cfg.token_exp) await this.renovar();
  },

  async rest(caminho, opcoes = {}) {
    await this.garantirToken();
    let res = await fetch(`${this.cfg.url}/rest/v1/${caminho}`, { ...opcoes, headers: this.cabecalho() });
    if (res.status === 401) {                 // token morreu antes da hora
      await this.renovar();
      res = await fetch(`${this.cfg.url}/rest/v1/${caminho}`, { ...opcoes, headers: this.cabecalho() });
    }
    if (!res.ok) throw new Error(`${res.status} em ${caminho}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : [];
  },

  paraEnvio(tabela, r) {
    const out = { id: r.id, family_id: this.cfg.family_id, updated_at: r.updated_at, deleted: !!r.deleted };
    for (const c of COLUNAS[tabela]) if (r[c] !== undefined) out[c] = r[c];
    return out;
  },

  /* A SINCRONIZAÇÃO, e por que ela é toda tolerante a falha.

     Este app roda no tablet de uma criança de seis anos, provavelmente longe do
     wi-fi e provavelmente com a bateria em 4%. Nada aqui pode travar a tela: o
     cofrinho funciona inteiro offline, e a nuvem é só o encontro com o app do
     adulto quando houver rede. Toda falha vira silêncio, nunca um alerta. */
  async sincronizar() {
    this.carregar();
    if (!this.pronta()) return false;
    let mudou = false;
    try {
      for (const t of TABELAS) {
        const sujos = (Dados.d[t] || []).filter(r => r.dirty);
        if (sujos.length) {
          await this.rest(t, {
            method: 'POST',
            headers: { ...this.cabecalho(), Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(sujos.map(r => this.paraEnvio(t, r))),
          });
          for (const r of sujos) delete r.dirty;
          mudou = true;
        }
      }
      for (const t of TABELAS) {
        const linhas = await this.rest(`${t}?family_id=eq.${this.cfg.family_id}&select=*`);
        const local = Dados.d[t];
        for (const remota of linhas) {
          const i = local.findIndex(r => r.id === remota.id);
          if (i < 0) { local.push({ ...remota, dirty: false }); mudou = true; continue; }
          // Conflito pelo relógio de quem editou: quem escreveu por último vence
          if (!local[i].dirty && String(remota.updated_at || '') >= String(local[i].updated_at || '')) {
            local[i] = { ...remota, dirty: false };
            mudou = true;
          }
        }
      }
      Dados.d.meta.lastSync = Dados.agora();
      Dados.salvar();
      if (this.onStatus) this.onStatus(true);
      return mudou;
    } catch (_) {
      if (this.onStatus) this.onStatus(false);
      return false;
    }
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Dados, Nuvem, CHAVE, CHAVE_SYNC, TABELAS, COLUNAS };
