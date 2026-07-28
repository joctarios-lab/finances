/* Finanças Família — sincronização com Supabase via REST (sem SDK)
   Estratégia: local-first; push de registros dirty, pull incremental por updated_at; last-write-wins. */
'use strict';

const SYNC_TABLES = {
  accounts: ['name', 'type', 'institution', 'balance', 'active', 'is_reserve'],
  cards: ['name', 'brand', 'limit_amount', 'closing_day', 'due_day', 'account_id', 'active'],
  categories: ['name', 'icon', 'scope', 'monthly_budget', 'kind', 'parent_id'],
  transactions: ['description', 'amount', 'date', 'scope', 'member', 'method', 'status', 'recurring', 'category_id', 'account_id', 'card_id', 'invoice_key', 'notes', 'type', 'fitid', 'group_id', 'installment', 'adjustment'],
  goals: ['name', 'icon', 'target_amount', 'target_date', 'done', 'kind'],
  goal_entries: ['goal_id', 'description', 'amount', 'date', 'from_account', 'to_account'],
  invoice_status: ['invoice_key', 'paid'],
  family_settings: ['members', 'month_start_day', 'monthly_income', 'family_name'],
};

const Sync = {
  cfgKey: 'financas.sync.v1',
  cfg: null,
  busy: false,
  onStatus: null,    // callback(msg, ok)
  onChanged: null,   // chamado quando a sincronização trouxe dados novos (a tela precisa redesenhar)
  onState: null,     // chamado quando o estado muda (sincronizando / pendente / em dia)

  // Agendamento
  INTERVALO: 60000,        // consulta o servidor a cada 1 min com o app aberto
  ESPERA_APOS_EDICAO: 1200, // agrupa edições seguidas num envio só
  GIRO_MINIMO: 600,        // tempo mínimo do ícone girando, para não piscar
  _timer: null, _debounce: null, _retry: 0, _ultimoErro: null, _girando: false,

  load() {
    try { this.cfg = JSON.parse(localStorage.getItem(this.cfgKey)) || {}; }
    catch (_) { this.cfg = {}; }
    // Pré-configuração via js/config.js (deploy já apontando para o projeto da família)
    const pre = (typeof window !== 'undefined' && window.FINANCAS_SUPABASE) || {};
    if (!this.cfg.url && pre.url) { this.cfg.url = pre.url.replace(/\/$/, ''); this.cfg.anonKey = pre.anonKey; this.saveCfg(); }
    return this.cfg;
  },
  saveCfg() { localStorage.setItem(this.cfgKey, JSON.stringify(this.cfg)); },

  configured() { return !!(this.cfg && this.cfg.url && this.cfg.anonKey); },
  loggedIn() { return this.configured() && !!this.cfg.refresh_token; },
  hasFamily() { return this.loggedIn() && !!this.cfg.family_id; },

  status(msg, ok = true) { if (this.onStatus) this.onStatus(msg, ok); },

  headers(auth = true) {
    const h = { 'apikey': this.cfg.anonKey, 'Content-Type': 'application/json' };
    if (auth && this.cfg.access_token) h['Authorization'] = 'Bearer ' + this.cfg.access_token;
    return h;
  },

  async authRequest(path, body) {
    const res = await fetch(`${this.cfg.url}/auth/v1/${path}`, {
      method: 'POST', headers: this.headers(false), body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Erro de autenticação');
    return data;
  },

  async signUp(email, password) {
    const d = await this.authRequest('signup', { email, password });
    if (d.access_token) { this.setSession(d); await this.detectarFamilia().catch(() => {}); }
    return d;
  },

  async signIn(email, password) {
    const d = await this.authRequest('token?grant_type=password', { email, password });
    this.setSession(d);
    // Não pode falhar o login por causa disto; é uma comodidade, não um requisito
    await this.detectarFamilia().catch(() => {});
    return d;
  },

  setSession(d) {
    this.cfg.access_token = d.access_token;
    this.cfg.refresh_token = d.refresh_token;
    this.cfg.token_exp = Date.now() + ((d.expires_in || 3600) - 60) * 1000;
    this.cfg.user_email = (d.user && d.user.email) || this.cfg.user_email;
    this.cfg.user_id = (d.user && d.user.id) || this.cfg.user_id;
    this.saveCfg();
  },

  /* O servidor já sabe se esta conta pertence a alguma família (family_members).
     Sem perguntar a ele, quem reinstala o app ou entra em outro aparelho caía na
     tela de "criar família" e criava uma segunda, separada da primeira — com os
     dados do casal partidos em duas famílias sem ninguém perceber. */
  async detectarFamilia() {
    if (!this.loggedIn() || this.cfg.family_id) return this.cfg.family_id || null;
    const filtro = this.cfg.user_id ? `&user_id=eq.${this.cfg.user_id}` : '';
    const rows = await this.rest(
      `family_members?select=family_id&order=created_at.asc&limit=1${filtro}`, { method: 'GET' });
    const fid = rows && rows[0] && rows[0].family_id;
    if (!fid) return null;
    this.cfg.family_id = fid;
    this.saveCfg();
    return fid;
  },

  signOut() {
    delete this.cfg.access_token; delete this.cfg.refresh_token;
    delete this.cfg.token_exp; delete this.cfg.family_id; delete this.cfg.user_email;
    this.saveCfg();
  },

  async ensureToken() {
    if (!this.loggedIn()) throw new Error('Não autenticado');
    if (Date.now() < (this.cfg.token_exp || 0)) return;
    const d = await this.authRequest('token?grant_type=refresh_token', { refresh_token: this.cfg.refresh_token });
    this.setSession(d);
  },

  async rest(path, opts = {}) {
    await this.ensureToken();
    const res = await fetch(`${this.cfg.url}/rest/v1/${path}`, {
      ...opts,
      headers: { ...this.headers(), ...(opts.headers || {}) },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  },

  // Cria a família e já vira membro dela numa operação só (função create_family no banco).
  // Fazer em dois passos pelo REST falha: a política de leitura exige ser membro,
  // então o id da família recém-criada não voltaria.
  async createFamily(name) {
    const id = await this.rest('rpc/create_family', {
      method: 'POST',
      body: JSON.stringify({ fam_name: name }),
    });
    const fid = typeof id === 'string' ? id : (id && id.id) || null;
    if (!fid) throw new Error('Não foi possível criar a família. Rode o schema.sql mais recente no Supabase.');
    this.cfg.family_id = fid;
    this.saveCfg();
    return fid;
  },

  async joinFamily(familyId) {
    const fid = (familyId || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fid)) {
      throw new Error('Código inválido — cole o código completo que aparece no outro aparelho');
    }
    await this.rest('family_members', { method: 'POST', body: JSON.stringify({ family_id: fid }) });
    this.cfg.family_id = fid;
    this.saveCfg();
  },

  async syncAll(silencioso = false) {
    if (!this.hasFamily()) throw new Error('Configure a sincronização primeiro');
    if (this.busy) return null;
    this.busy = true;
    let enviados = 0, recebidos = 0;

    // O giro só aparece quando há trabalho que o usuário reconhece: um pedido dele
    // ou envio pendente. A consulta de rotina (1x/min) é silenciosa — girar a cada
    // minuto passava a impressão de que o app vive sincronizando.
    this._girando = !silencioso || this.pendentes() > 0;
    const inicio = Date.now();
    if (this._girando) this.avisarEstado();

    try {
      if (!silencioso) this.status('Sincronizando…');
      const fid = this.cfg.family_id;

      // PUSH: registros dirty
      for (const [table, cols] of Object.entries(SYNC_TABLES)) {
        const dirty = DB.data[table].filter(r => r.dirty);
        if (!dirty.length) continue;
        enviados += dirty.length;
        const payload = dirty.map(r => {
          const row = { id: r.id, family_id: fid, updated_at: r.updated_at, deleted: !!r.deleted };
          for (const c of cols) if (r[c] !== undefined) row[c] = r[c];
          return row;
        });
        await this.rest(`${table}?on_conflict=id`, {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(payload),
        });
        for (const r of dirty) delete r.dirty;
      }

      // PULL: incremental por updated_at (inclui deletados para propagar remoções)
      const since = DB.data.meta.lastSync || '1970-01-01T00:00:00Z';
      for (const table of Object.keys(SYNC_TABLES)) {
        const rows = await this.rest(
          `${table}?family_id=eq.${fid}&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=2000`,
          { method: 'GET' });
        for (const remote of rows || []) {
          const i = DB.data[table].findIndex(r => r.id === remote.id);
          const local = i >= 0 ? DB.data[table][i] : null;
          if (local && local.dirty && local.updated_at > remote.updated_at) continue; // local mais novo
          const merged = { ...(local || {}), ...remote };
          delete merged.family_id; delete merged.dirty;
          // Só conta como novidade o que realmente mudou nesta máquina
          if (!local || local.updated_at !== remote.updated_at) recebidos++;
          if (i >= 0) DB.data[table][i] = merged; else DB.data[table].push(merged);
        }
      }

      DB.data.meta.lastSync = DB.now();
      DB.save();
      this.cfg.lastOk = Date.now(); this.saveCfg();
      this._retry = 0; this._ultimoErro = null;
      if (silencioso) this.status(''); else this.status('Sincronizado ✓');
      // Se o servidor trouxe novidade (o cônjuge lançou algo), a tela precisa redesenhar
      if (recebidos > 0 && this.onChanged) this.onChanged(recebidos);
      return { enviados, recebidos };
    } catch (e) {
      this._ultimoErro = e.message;
      if (!silencioso) this.status('Falha ao sincronizar: ' + e.message, false);
      this.agendarNovaTentativa();
      throw e;
    } finally {
      // Avisar aqui, e só aqui, é o que encerra o giro: dentro do try o busy ainda
      // era true, então o botão era informado de que ainda estava sincronizando e
      // ficava girando para sempre, até a próxima sincronização.
      this.busy = false;
      const restante = this._girando ? Math.max(0, this.GIRO_MINIMO - (Date.now() - inicio)) : 0;
      this._girando = false;
      // Sincronização instantânea piscava o ícone; segura o giro por um tempo mínimo
      if (restante) setTimeout(() => this.avisarEstado(), restante);
      else this.avisarEstado();
    }
  },

  /* ---------------- Sincronização automática ----------------
     Objetivo: com conexão, o aparelho fica sempre em dia sem ninguém pedir.
     - envia logo após qualquer edição (agrupando edições seguidas);
     - consulta o servidor periodicamente enquanto o app está aberto;
     - sincroniza ao voltar para o app e ao recuperar a conexão;
     - repete com espera crescente quando falha, sem travar o uso. */

  // Quantos registros ainda não foram enviados
  pendentes() {
    if (!DB.data) return 0;
    return Object.keys(SYNC_TABLES)
      .reduce((n, t) => n + (DB.data[t] || []).filter(r => r.dirty).length, 0);
  },

  estado() {
    if (!this.hasFamily()) return 'off';
    if (this.busy && this._girando) return 'sync';
    if (!navigator.onLine) return 'offline';
    if (this.pendentes() > 0) return 'pendente';
    return 'ok';
  },
  avisarEstado() { if (this.onState) this.onState(this.estado(), this.pendentes()); },

  // Chamado depois de salvar algo: agrupa edições seguidas num envio só
  autoSync() {
    this.avisarEstado();
    if (!this.hasFamily()) return;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.tentar(true), this.ESPERA_APOS_EDICAO);
  },

  // Uma tentativa silenciosa; não propaga erro para não interromper o uso
  tentar(silencioso = true) {
    if (!this.hasFamily() || !navigator.onLine || this.busy) return Promise.resolve(null);
    return this.syncAll(silencioso).catch(() => null);
  },

  // Falhou: tenta de novo em 5s, 15s, 45s, 2min… até 5 min
  agendarNovaTentativa() {
    if (!this.hasFamily()) return;
    const esperas = [5000, 15000, 45000, 120000, 300000];
    const espera = esperas[Math.min(this._retry, esperas.length - 1)];
    this._retry++;
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.tentar(true), espera);
  },

  // Liga os gatilhos automáticos. Chamado uma vez, na abertura do app.
  startAuto() {
    const agora = () => this.tentar(true);

    // Relógio: só corre com o app visível, para não gastar bateria nem cota à toa
    const reprogramar = () => {
      clearInterval(this._timer);
      if (typeof document !== 'undefined' && document.hidden) return;
      this._timer = setInterval(agora, this.INTERVALO);
    };
    reprogramar();

    document.addEventListener('visibilitychange', () => {
      reprogramar();
      if (!document.hidden) agora();      // voltou para o app: busca o que mudou
    });
    window.addEventListener('online', () => { this._retry = 0; agora(); });
    window.addEventListener('offline', () => this.avisarEstado());
    window.addEventListener('focus', agora);
    // Última chance de enviar o que ficou pendente ao fechar
    window.addEventListener('beforeunload', () => { if (this.pendentes()) this.tentar(true); });

    agora();
    this.avisarEstado();
  },
};
