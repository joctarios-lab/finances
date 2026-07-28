/* Finanças Família — sincronização com Supabase via REST (sem SDK)
   Estratégia: local-first; push de registros dirty, pull incremental por updated_at; last-write-wins. */
'use strict';

const SYNC_TABLES = {
  accounts: ['name', 'type', 'institution', 'balance', 'active'],
  cards: ['name', 'brand', 'limit_amount', 'closing_day', 'due_day', 'account_id', 'active'],
  categories: ['name', 'icon', 'scope', 'monthly_budget', 'kind'],
  transactions: ['description', 'amount', 'date', 'scope', 'member', 'method', 'status', 'recurring', 'category_id', 'account_id', 'card_id', 'invoice_key', 'notes'],
  goals: ['name', 'icon', 'target_amount', 'target_date', 'done'],
  goal_entries: ['goal_id', 'description', 'amount', 'date'],
  invoice_status: ['invoice_key', 'paid'],
  family_settings: ['members', 'month_start_day', 'monthly_income'],
};

const Sync = {
  cfgKey: 'financas.sync.v1',
  cfg: null,
  busy: false,
  onStatus: null, // callback(msg, ok)

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
    if (d.access_token) this.setSession(d);
    return d;
  },

  async signIn(email, password) {
    const d = await this.authRequest('token?grant_type=password', { email, password });
    this.setSession(d);
    return d;
  },

  setSession(d) {
    this.cfg.access_token = d.access_token;
    this.cfg.refresh_token = d.refresh_token;
    this.cfg.token_exp = Date.now() + ((d.expires_in || 3600) - 60) * 1000;
    this.cfg.user_email = (d.user && d.user.email) || this.cfg.user_email;
    this.saveCfg();
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

  async createFamily(name) {
    const rows = await this.rest('families', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({ name }),
    });
    const fam = rows[0];
    await this.rest('family_members', { method: 'POST', body: JSON.stringify({ family_id: fam.id }) });
    this.cfg.family_id = fam.id;
    this.saveCfg();
    return fam.id;
  },

  async joinFamily(familyId) {
    await this.rest('family_members', { method: 'POST', body: JSON.stringify({ family_id: familyId.trim() }) });
    this.cfg.family_id = familyId.trim();
    this.saveCfg();
  },

  async syncAll() {
    if (!this.hasFamily()) throw new Error('Configure a sincronização primeiro');
    if (this.busy) return;
    this.busy = true;
    try {
      this.status('Sincronizando…');
      const fid = this.cfg.family_id;

      // PUSH: registros dirty
      for (const [table, cols] of Object.entries(SYNC_TABLES)) {
        const dirty = DB.data[table].filter(r => r.dirty);
        if (!dirty.length) continue;
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
          if (i >= 0) DB.data[table][i] = merged; else DB.data[table].push(merged);
        }
      }

      DB.data.meta.lastSync = DB.now();
      DB.save();
      this.status('Sincronizado ✓');
    } catch (e) {
      this.status('Falha ao sincronizar: ' + e.message, false);
      throw e;
    } finally {
      this.busy = false;
    }
  },

  // Sincroniza em silêncio quando possível (abrir app / voltar online / após salvar)
  autoSync() {
    if (!this.hasFamily() || !navigator.onLine) return;
    this.syncAll().catch(() => {});
  },
};
