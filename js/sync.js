/* Finanças Família — sincronização com Supabase via REST (sem SDK)
   Estratégia: local-first; push de registros dirty, pull incremental por server_at (carimbo do banco);
   conflito resolvido por updated_at (last-write-wins). */
'use strict';

/* O MARCADOR DO PULL é `server_at`, não `updated_at`.

   `updated_at` é gravado por quem CRIA o registro, com o relógio do aparelho —
   e isso o torna inútil como marcador de sincronização. Um aparelho offline envia,
   ao voltar, registros com timestamp de horas atrás; qualquer outro que já tenha
   sincronizado nesse intervalo pede `> lastSync` e nunca mais os busca. Aconteceu:
   um lançamento existia no servidor e não na tela.

   `server_at` é escrito pelo BANCO a cada gravação (trigger com
   clock_timestamp()), e o cliente não tem como influenciá-lo. A pergunta do pull
   passa a ser "o que chegou aqui depois de X?" — que depende de um relógio só.

   `updated_at` continua existindo e continua sendo do cliente: ele resolve
   CONFLITO (quem editou por último vence). Os dois respondem perguntas diferentes.

   MARGEM PEQUENA, mesmo assim. Duas gravações concorrentes podem receber
   `clock_timestamp()` em ordem e commitar fora de ordem — uma linha com carimbo
   menor fica visível depois de outra maior. Cinco minutos cobrem qualquer
   transação real com folga enorme, e reprocessar é inofensivo: o merge é por id. */
const MARGEM_MS = 5 * 60 * 1000;

/* De quanto em quanto tempo o pull relê TUDO, ignorando o marcador.

   É a rede de segurança: se o carimbo falhar por qualquer motivo — uma tabela sem
   o trigger, um registro migrado à mão —, a divergência se fecha sozinha em no
   máximo uma semana, sem depender de alguém notar que um lançamento sumiu. */
const RELEITURA_MS = 7 * 24 * 60 * 60 * 1000;

/* A janela do caminho ANTIGO, usada só enquanto o carimbo do servidor não existe.
   Sete dias porque ali o marcador é a hora da edição, e um aparelho pode voltar
   de dias sem sinal — ver o comentário de MARGEM_MS. */
const JANELA_LARGA_MS = 7 * 24 * 60 * 60 * 1000;

// Tamanho da página do pull. Menor que o limite do PostgREST, para a paginação
// ser exercitada de verdade em bases grandes em vez de só existir no papel.
const PAGINA = 1000;

const SYNC_TABLES = {
  accounts: ['name', 'type', 'institution', 'balance', 'active', 'is_reserve'],
  cards: ['name', 'brand', 'limit_amount', 'closing_day', 'due_day', 'account_id', 'active'],
  categories: ['name', 'icon', 'scope', 'monthly_budget', 'kind', 'parent_id', 'type'],
  transactions: ['description', 'amount', 'date', 'scope', 'member', 'method', 'status', 'recurring', 'category_id', 'account_id', 'card_id', 'invoice_key', 'notes', 'type', 'fitid', 'group_id', 'installment', 'adjustment', 'tags', 'to_account', 'pays_invoice', 'recurrence_id'],
  goals: ['name', 'icon', 'target_amount', 'target_date', 'done', 'kind'],
  goal_entries: ['goal_id', 'description', 'amount', 'date', 'from_account', 'to_account', 'status'],
  invoice_status: ['invoice_key', 'paid'],
  recurrences: ['description', 'amount', 'valor_tipo', 'type', 'scope', 'member', 'method',
    'category_id', 'account_id', 'card_id', 'tags', 'notes',
    'periodicidade', 'dia', 'inicio', 'fim_tipo', 'fim_data', 'fim_vezes', 'geradas', 'status', 'ultima_geracao'],
  family_settings: ['members', 'month_start_day', 'monthly_income', 'family_name'],
  // Orçamento ajustado para um ciclo. Tabela nova: num banco onde o SQL ainda não
  // foi rodado, o pull e o push já isolam falha POR TABELA, então só o ajuste
  // deixa de sincronizar — o resto da base continua andando.
  budget_overrides: ['category_id', 'period_start', 'amount'],
};

/* Tipo de cada coluna do banco, por nome (nenhum nome se repete com tipo
   diferente — o teste confere isso contra o schema.sql).

   Existe porque versões antigas do app gravaram '' onde o banco espera uuid ou
   data: o formulário usava '' para "nada escolhido". O Postgres recusa ('' não é
   uuid) e a recusa derruba o lote inteiro — um registro velho travava a
   sincronização de tudo, em todas as tabelas.

   O sufixo diz o que fazer quando o valor não tem conserto, e vem da nulidade
   real da coluna no schema:
     (nada) coluna aceita null      -> manda null
     #      NOT NULL com default    -> omite a coluna e deixa o banco preencher
     !      NOT NULL sem default    -> não há saída; o registro sai do lote

   text, bool e json não levam sufixo porque nunca produzem null: viram '',
   false e [] respectivamente, o que já satisfaz qualquer NOT NULL. */
const COLUNAS = {
  id: 'uuid!', family_id: 'uuid!', updated_at: 'ts#',
  goal_id: 'uuid!',
  category_id: 'uuid', account_id: 'uuid', card_id: 'uuid', to_account: 'uuid',
  from_account: 'uuid', group_id: 'uuid', parent_id: 'uuid', recurrence_id: 'uuid',
  amount: 'num!',
  balance: 'num#', monthly_budget: 'num#', limit_amount: 'num#',
  target_amount: 'num#', monthly_income: 'num#',
  closing_day: 'int#', due_day: 'int#', month_start_day: 'int#',
  dia: 'int#', fim_vezes: 'int', geradas: 'int#',
  inicio: 'date!', fim_data: 'date', ultima_geracao: 'date', period_start: 'date!',
  date: 'date!', target_date: 'date',
  deleted: 'bool', active: 'bool', is_reserve: 'bool', recurring: 'bool',
  adjustment: 'bool', paid: 'bool', done: 'bool',
  members: 'json', tags: 'json',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Devolve { ok:true, valor }, { omitir:true } ou { ok:false }.
   ok:false só acontece em NOT NULL sem default: aí o registro sai do lote, em
   vez de fazer o banco recusar todos os outros junto. */
function higienizar(col, bruto) {
  const decl = COLUNAS[col] || 'text';
  const marca = /[!#]$/.test(decl) ? decl.slice(-1) : '';
  const tipo = marca ? decl.slice(0, -1) : decl;
  const semSaida = marca === '!' ? { ok: false } : marca === '#' ? { omitir: true } : { ok: true, valor: null };

  switch (tipo) {
    case 'uuid':
      return (bruto && UUID_RE.test(String(bruto))) ? { ok: true, valor: String(bruto) } : semSaida;
    case 'num': case 'int': {
      if (bruto === null || bruto === undefined || bruto === '') return semSaida;
      const n = tipo === 'int' ? parseInt(bruto, 10) : Number(bruto);
      return Number.isFinite(n) ? { ok: true, valor: n } : semSaida;
    }
    case 'date':
      return DATA_RE.test(String(bruto)) ? { ok: true, valor: String(bruto) } : semSaida;
    case 'ts':
      return isNaN(Date.parse(String(bruto))) ? semSaida : { ok: true, valor: String(bruto) };
    case 'bool':
      return { ok: true, valor: !!bruto };
    case 'json':
      return { ok: true, valor: (bruto && typeof bruto === 'object') ? bruto : [] };
    default:
      return { ok: true, valor: bruto == null ? '' : String(bruto) };
  }
}

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

  /* O banco tem a coluna server_at? null = ainda não se sabe.
     Detectado na primeira sincronização; enquanto for false, o pull usa o caminho
     antigo. Não é persistido de propósito: se o SQL for rodado, basta reabrir o
     app para ele voltar a tentar. */
  temServerAt: null,

  /* Já baixamos tudo o que a família tem, nesta sessão?

     Existe porque decidir sem os dados completos produz erro silencioso. Depois
     de "apagar dados deste aparelho", o app abre VAZIO e vai se enchendo pela
     sincronização — e quem importa um OFX nesse intervalo vê todos os
     lançamentos como novos, porque o que os identificaria ainda não chegou.
     O resultado é a base duplicada, sem nenhum aviso.

     Só vira true depois de um syncAll que completou o pull. */
  pronto: false,
  _esperando: null,

  /* Espera a primeira carga terminar. Devolve:
       'pronto'        — dados completos, pode decidir
       'sem-nuvem'     — não há com o que conferir (uso local); segue em frente
       'sem-resposta'  — configurado, mas o servidor não respondeu; decida com
                         cautela e avise quem está usando */
  async aguardarPronto(limiteMs = 12000) {
    if (!this.hasFamily()) return 'sem-nuvem';
    if (this.pronto) return 'pronto';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'sem-resposta';
    // Uma tentativa por vez: várias telas podem pedir ao mesmo tempo
    if (!this._esperando) {
      this._esperando = this.syncAll(true)
        .then(() => (this.pronto ? 'pronto' : 'sem-resposta'))
        .catch(() => 'sem-resposta')
        .finally(() => { this._esperando = null; });
    }
    const limite = new Promise(r => setTimeout(() => r('sem-resposta'), limiteMs));
    return Promise.race([this._esperando, limite]);
  },

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
      throw new Error(this.explicar(res.status, t, path));
    }
    if (res.status === 204) return null;
    return res.json().catch(() => null);
  },

  /* "Supabase 400: {code:PGRST102…}" não diz nem a tabela nem o que fazer.
     Aqui a mensagem nomeia a tabela e, nos erros conhecidos, aponta a saída. */
  explicar(status, corpo, path) {
    const tabela = String(path).split('?')[0];
    let dado = {};
    try { dado = JSON.parse(corpo) || {}; } catch (_) {}
    const codigo = dado.code || '';
    const msg = dado.message || String(corpo).slice(0, 160);
    if (codigo === 'PGRST204' || /column .* does not exist|schema cache/i.test(msg)) {
      return `${tabela}: o banco não tem uma coluna que o app usa (${msg}). Abra o Supabase → SQL Editor e rode o supabase/schema.sql mais recente.`;
    }
    if (codigo === 'PGRST102') return `${tabela}: o servidor recusou o formato do envio — ${msg}`;
    if (codigo === '23502') return `${tabela}: campo obrigatório vazio — ${msg}`;
    if (codigo === '22P02' || codigo === '22007') return `${tabela}: valor de tipo inválido — ${msg}`;
    if (codigo === '23503') return `${tabela}: referência para registro que não existe — ${msg}`;
    if (status === 401 || status === 403) return `${tabela}: sem permissão (${status}). Entre na conta novamente em Configurações → Sincronização.`;
    return `${tabela}: Supabase ${status} — ${msg}`;
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

  /* Testa cada tabela contra o servidor e diz, uma por uma, o que está errado.
     Pede as colunas nome por nome no select: se alguma não existir no banco, o
     PostgREST aponta exatamente qual — é o jeito de descobrir schema desatualizado
     sem gravar nada. Existe porque "Falha ao sincronizar" sozinho não deixa agir. */
  async diagnosticar() {
    if (!this.configured()) return [{ tabela: 'servidor', ok: false, msg: 'URL e chave não configuradas' }];
    if (!this.loggedIn()) return [{ tabela: 'conta', ok: false, msg: 'Não está conectado' }];
    if (!this.hasFamily()) return [{ tabela: 'família', ok: false, msg: 'Nenhuma família selecionada' }];
    const saida = [];
    for (const [table, cols] of Object.entries(SYNC_TABLES)) {
      try {
        await this.rest(`${table}?select=${['id', 'family_id', 'updated_at', 'deleted', ...cols].join(',')}&limit=1`, { method: 'GET' });
        const pend = (DB.data && (DB.data[table] || []).filter(r => r.dirty).length) || 0;
        saida.push({ tabela: table, ok: true, msg: pend ? `${pend} a enviar` : 'em dia' });
      } catch (e) {
        saida.push({ tabela: table, ok: false, msg: e.message });
      }
    }
    return saida;
  },

  /* A família já tem categorias no servidor? Pergunta barata (uma linha basta),
     usada antes do primeiro envio de um aparelho novo para não duplicar as de
     fábrica que ele criou sozinho. */
  async familiaTemCategorias() {
    if (!this.hasFamily()) return false;
    const rows = await this.rest(
      `categories?family_id=eq.${this.cfg.family_id}&deleted=is.false&select=id&limit=1`, { method: 'GET' });
    return Array.isArray(rows) && rows.length > 0;
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

      /* Cada tabela é tratada por conta própria. Antes, uma tabela recusada
         abortava a função e nada mais era enviado nem recebido — foi por isso que
         um problema só nas categorias deu a impressão de que a sincronização
         inteira havia parado. Agora as falhas são reunidas no fim. */
      const falhas = [];
      let descartados = 0;

      // PUSH: registros dirty
      for (const [table, cols] of Object.entries(SYNC_TABLES)) {
        /* Cria a lista se o aparelho ainda não conhece a tabela.

           Acontece de verdade: uma versão nova traz uma tabela que a base local
           não tem, e o aparelho que abrir antes de recarregar o app quebraria a
           sincronização INTEIRA por causa de uma chave ausente. Perder o sync de
           tudo por causa de uma tabela vazia é a pior troca possível. */
        if (!DB.data[table]) DB.data[table] = [];
        const dirty = DB.data[table].filter(r => r.dirty);
        if (!dirty.length) continue;

        /* Dois cuidados no mesmo lugar:

           1. O PostgREST exige que todos os objetos de um lote tenham as MESMAS
              chaves (400 PGRST102 "All object keys must match"). Os registros não
              têm: cada um leva só os campos que possui, de propósito, para que
              campo ausente assuma o default do banco em vez de virar null.
              Registro gravado por versão antiga do app não conhece coluna nova.
              Agrupar por assinatura de chaves deixa cada requisição uniforme.

           2. O valor precisa ser do tipo da coluna. '' não é uuid nem data, e o
              Postgres recusa o lote todo por causa de um registro velho. */
        const lotes = new Map();
        const enviaveis = [];
        for (const r of dirty) {
          const row = {};
          let vivo = true;
          for (const [c, bruto] of [['id', r.id], ['family_id', fid], ['updated_at', r.updated_at], ['deleted', !!r.deleted]]) {
            const h = higienizar(c, bruto);
            if (h.omitir) continue;
            if (!h.ok) { vivo = false; break; }
            row[c] = h.valor;
          }
          if (vivo) {
            for (const c of cols) {
              if (r[c] === undefined) continue;      // ausente segue ausente: default do banco
              const h = higienizar(c, r[c]);
              if (h.omitir) continue;                // NOT NULL com default: o banco preenche
              if (!h.ok) { vivo = false; break; }
              row[c] = h.valor;
            }
          }
          // Registro que nem higienizado serve fica de fora: um dado corrompido
          // não pode impedir a família de sincronizar o resto.
          if (!vivo) { descartados++; continue; }
          enviaveis.push(r);
          const assinatura = Object.keys(row).sort().join(',');
          if (!lotes.has(assinatura)) lotes.set(assinatura, []);
          lotes.get(assinatura).push(row);
        }

        try {
          for (const lote of lotes.values()) {
            await this.rest(`${table}?on_conflict=id`, {
              method: 'POST',
              headers: { 'Prefer': 'resolution=merge-duplicates' },
              body: JSON.stringify(lote),
            });
          }
          enviados += enviaveis.length;
          for (const r of enviaveis) delete r.dirty;
        } catch (e) {
          falhas.push(e.message);   // segue para a próxima tabela
        }
      }

      /* PULL: incremental por server_at (inclui deletados para propagar remoções).

         O marcador é o carimbo do SERVIDOR, não a hora da edição — ver o comentário
         de MARGEM_MS no topo. A pergunta passa a ser "o que chegou aqui depois de
         X?", que depende de um relógio só, em vez de "o que foi editado depois de
         X?", que dependia do relógio de cada aparelho da família.

         RELEITURA COMPLETA periódica como rede de segurança: se o carimbo falhar
         por qualquer motivo — uma tabela sem o trigger, um registro migrado à mão —,
         a divergência se fecha sozinha em no máximo uma semana, sem depender de
         alguém notar que um lançamento sumiu. */
      const ultimoFull = DB.data.meta.lastFull;
      const precisaFull = !ultimoFull
        || (Date.now() - new Date(ultimoFull).getTime()) > RELEITURA_MS;
      /* O marcador guardado é um valor que VEIO DO SERVIDOR (`meta.serverAt`), não
         uma leitura de relógio local. É isso que elimina a dependência de relógio:
         mesmo que este aparelho esteja com a hora errada, ele pede a partir de um
         instante que o próprio banco carimbou.

         `lastSync` continua sendo gravado, mas só para a tela dizer "sincronizado
         há X" — não manda mais em nada. */
      /* TRANSIÇÃO SEGURA. `server_at` depende de um SQL que pode não ter sido
         rodado ainda — num aparelho da família, num banco recém-criado, ou entre o
         deploy do app e a execução da migração. Pedir por uma coluna inexistente
         derruba o pull inteiro, e aí o remédio seria pior que a doença.

         Então o campo é DETECTADO: na primeira falha por coluna ausente, o pull
         cai para `updated_at` com a janela larga — o comportamento anterior, que
         funciona, só que sem a garantia. Uma vez detectado, vale para a sessão. */
      let campo = this.temServerAt === false ? 'updated_at' : 'server_at';
      const marcadorDe = qual => {
        const recuo = qual === 'server_at' ? MARGEM_MS : JANELA_LARGA_MS;
        const base = qual === 'server_at' ? DB.data.meta.serverAt : DB.data.meta.lastSync;
        return (!precisaFull && base)
          ? new Date(new Date(base).getTime() - recuo).toISOString()
          : '1970-01-01T00:00:00Z';
      };
      let maiorServerAt = DB.data.meta.serverAt || '';
      for (const table of Object.keys(SYNC_TABLES)) {
        /* PAGINADO. Sem isto, uma tabela com mais alterações que o limite trazia só
           a primeira página e o marcador avançava como se tudo tivesse vindo — o
           resto ficava invisível para sempre, pelo mesmo mecanismo. */
        let rows = [];
        try {
          let cursor = marcadorDe(campo);
          for (let pagina = 0; pagina < 50; pagina++) {
            let lote;
            try {
              lote = await this.rest(
                `${table}?family_id=eq.${fid}&${campo}=gt.${encodeURIComponent(cursor)}`
                + `&order=${campo}.asc&limit=${PAGINA}`,
                { method: 'GET' });
            } catch (erro) {
              /* Coluna ausente: passa para o caminho antigo e REFAZ esta tabela do
                 zero, sem recursão — chamar syncAll de novo aqui não funcionaria,
                 porque o guard de `busy` devolveria null e a sincronização terminaria
                 sem ter lido nada. As tabelas seguintes já saem pelo caminho antigo,
                 porque `campo` é reatribuído. */
              if (campo === 'server_at'
                  && /server_at|does not exist|schema cache/i.test(erro.message)) {
                this.temServerAt = false;
                campo = 'updated_at';
                cursor = marcadorDe(campo);
                rows = [];
                continue;
              }
              throw erro;
            }
            if (!lote || !lote.length) break;
            rows = rows.concat(lote);
            if (lote.length < PAGINA) break;          // última página
            const ultimo = lote[lote.length - 1][campo];
            // Sem avanço não há próxima página a pedir: todas as linhas do lote
            // têm o mesmo instante, e insistir repetiria o mesmo pedido para sempre
            if (!ultimo || ultimo === cursor) break;
            cursor = ultimo;
          }
          if (campo === 'server_at' && rows.length) this.temServerAt = true;
        } catch (e) { falhas.push(e.message); continue; }
        if (!DB.data[table]) DB.data[table] = [];      // mesma proteção do push
        for (const remote of rows || []) {
          if (remote.server_at && remote.server_at > maiorServerAt) maiorServerAt = remote.server_at;
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

      // Avançar o marcador com alguma leitura falhada faria as linhas dessa
      // tabela nunca mais serem buscadas: a próxima consulta já as ignoraria.
      // Leitura completa das oito tabelas: agora dá para confiar no que está aqui
      if (!falhas.length) {
        /* O MARCADOR é o maior carimbo recebido — um valor que veio do servidor.
           Guardar o relógio local aqui seria refazer o defeito por outro caminho:
           a hora desta máquina não tem relação nenhuma com a ordem em que as
           gravações chegaram ao banco. */
        if (maiorServerAt) DB.data.meta.serverAt = maiorServerAt;
        // `lastSync` continua, mas só para a tela dizer "sincronizado há X"
        DB.data.meta.lastSync = DB.now();
        // Só marca a releitura completa quando ela DE FATO aconteceu sem falha —
        // marcar antes adiaria a próxima em uma semana sem ter reconciliado nada
        if (precisaFull) DB.data.meta.lastFull = DB.now();
        this.pronto = true;
      }
      DB.save();
      if (descartados) this._descartados = descartados;
      if (falhas.length) {
        const unicas = [...new Set(falhas)];
        throw new Error(unicas.slice(0, 2).join(' · ') + (unicas.length > 2 ? ` (+${unicas.length - 2})` : ''));
      }
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
