/* Finanças da Família — segurança de acesso
   - PIN deriva uma chave AES-256 (PBKDF2, 150 mil iterações) que CRIPTOGRAFA os dados locais em repouso.
   - Sem o PIN correto, o conteúdo do armazenamento é ilegível (não é só uma tela de bloqueio).
   - Força bruta: bloqueio progressivo após 5 erros. Recuperação: nuvem (Supabase) ou backup.
   - A nuvem tem camada própria: login e-mail/senha + RLS por família. */
'use strict';

const Auth = {
  key: 'financas.auth.v1',
  cfg: null,
  unlocked: false,
  _hiddenAt: null,

  load() {
    try { this.cfg = JSON.parse(localStorage.getItem(this.key)) || {}; }
    catch (_) { this.cfg = {}; }
    return this.cfg;
  },
  save() { localStorage.setItem(this.key, JSON.stringify(this.cfg)); },

  enabled() { return !!(this.cfg && (this.cfg.verifier || this.cfg.pinHash)); },

  /* hash antigo (v1) — mantido só para migrar instalações existentes para o modelo criptografado */
  async legacyHash(pin, salt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /* ---------- Sessão da aba ----------
     Recarregar a página não é sair do app. Sem isto, cada F5 pedia o PIN de novo,
     porque a chave só existia em memória. Guardamos a chave no sessionStorage —
     que morre quando a aba fecha — respeitando o mesmo tempo de bloqueio
     configurado. Com o tempo em 0, volta a pedir o PIN a cada atualização. */
  SESSAO_KEY: 'financas.sessao',

  async guardarSessao(chave) {
    if ((this.cfg.lockAfterMin ?? 5) <= 0) return this.limparSessao();
    try {
      const bruta = await crypto.subtle.exportKey('raw', chave);
      sessionStorage.setItem(this.SESSAO_KEY, JSON.stringify({ k: KCrypto.b64(bruta), t: Date.now() }));
    } catch (_) { /* chave não exportável: segue pedindo o PIN, sem quebrar */ }
  },

  async recuperarSessao() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.SESSAO_KEY) || 'null');
      if (!s || !s.k) return null;
      const limite = this.cfg.lockAfterMin ?? 5;
      if (limite <= 0 || (Date.now() - s.t) / 60000 > limite) { this.limparSessao(); return null; }
      return await crypto.subtle.importKey('raw', KCrypto.unb64(s.k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    } catch (_) { return null; }
  },

  /* O prazo conta a partir do ÚLTIMO USO, não de quando o PIN foi digitado.
     Sem isto, depois de alguns minutos de uso qualquer F5 voltava a pedir o PIN —
     era exatamente o que dava a sensação de "pede sempre". */
  tocarSessao() {
    try {
      const bruto = sessionStorage.getItem(this.SESSAO_KEY);
      if (!bruto) return;
      const s = JSON.parse(bruto);
      if (!s || !s.k) return;
      if (Date.now() - s.t < 20000) return;      // no máximo uma gravação a cada 20s
      s.t = Date.now();
      sessionStorage.setItem(this.SESSAO_KEY, JSON.stringify(s));
    } catch (_) {}
  },

  // Enquanto a pessoa estiver usando o app, a sessão se mantém viva
  vigiarAtividade() {
    if (this._vigiando) return;
    this._vigiando = true;
    const tocar = () => this.tocarSessao();
    for (const ev of ['pointerdown', 'keydown', 'visibilitychange']) {
      document.addEventListener(ev, tocar, { passive: true });
    }
    setInterval(() => { if (!document.hidden && this.unlocked) tocar(); }, 30000);
  },

  limparSessao() { try { sessionStorage.removeItem(this.SESSAO_KEY); } catch (_) {} },

  async setPin(pin) {
    this.cfg.kdfSalt = KCrypto.b64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await KCrypto.deriveKey(pin, this.cfg.kdfSalt, 150000, true);
    this.cfg.verifier = await KCrypto.enc(key, 'financas-ok');
    delete this.cfg.pinHash; delete this.cfg.salt;
    this.cfg.lockAfterMin = this.cfg.lockAfterMin ?? 5;
    this.cfg.fails = 0; delete this.cfg.blockedUntil;
    this.save();
    DB.setKey(key);          // liga a criptografia em repouso imediatamente
    return key;
  },

  // Retorna a CryptoKey se o PIN estiver certo; null caso contrário. Migra do modelo antigo.
  async tryPin(pin) {
    if (this.cfg.verifier) {
      try {
        const key = await KCrypto.deriveKey(pin, this.cfg.kdfSalt, 150000, true);
        if ((await KCrypto.dec(key, this.cfg.verifier)) === 'financas-ok') return key;
      } catch (_) {}
      return null;
    }
    if (this.cfg.pinHash) { // instalação antiga: valida e faz upgrade para criptografia
      if ((await this.legacyHash(pin, this.cfg.salt)) === this.cfg.pinHash) return this.setPin(pin);
      return null;
    }
    return null;
  },

  async verify(pin) { return !!(await this.tryPin(pin)); },

  async removePin(pin) {
    const key = await this.tryPin(pin);
    if (!key) return false;
    this.limparSessao();
    DB.clearKey();           // regrava os dados em claro
    delete this.cfg.verifier; delete this.cfg.kdfSalt;
    delete this.cfg.pinHash; delete this.cfg.salt;
    this.cfg.fails = 0; delete this.cfg.blockedUntil;
    this.save();
    return true;
  },

  /* ---------- Anti força bruta ---------- */
  blockedSecs() {
    if (!this.cfg.blockedUntil) return 0;
    return Math.max(0, Math.ceil((this.cfg.blockedUntil - Date.now()) / 1000));
  },
  registerFail() {
    this.cfg.fails = (this.cfg.fails || 0) + 1;
    if (this.cfg.fails >= 5) {
      const factor = this.cfg.fails - 4;                       // 30s, 60s, 90s… até 10 min
      this.cfg.blockedUntil = Date.now() + Math.min(600, 30 * factor) * 1000;
    }
    this.save();
  },
  registerSuccess() { this.cfg.fails = 0; delete this.cfg.blockedUntil; this.save(); },

  /* ---------- Biometria (digital / rosto) ----------
     Regra que não abrimos mão: a chave que decifra os dados NUNCA fica gravada no
     aparelho de forma utilizável sem verificação. Por isso usamos a extensão PRF do
     WebAuthn: o próprio leitor biométrico devolve um segredo estável, e só depois de
     confirmar a digital. Guardamos apenas a chave AES cifrada com esse segredo — quem
     copiar o armazenamento não consegue abrir nada sem a digital (ou o PIN).
     Aparelho sem suporte a PRF simplesmente não oferece a opção, em vez de fingir
     segurança guardando a chave em claro. */
  bioDisponivel() {
    return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  },
  bioAtiva() { return !!(this.cfg.bioId && this.cfg.bioKey && this.cfg.bioPrfSalt); },

  async bioSuportadaNoAparelho() {
    if (!this.bioDisponivel()) return false;
    if (this.cfg.bioIndisponivel) return false;   // já tentamos aqui e o navegador não suporta
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch (_) { return false; }
  },

  // Transforma o segredo devolvido pelo leitor numa chave de embrulho AES
  async chaveDoPrf(bytes) {
    const km = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('financas-bio-v1') },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  // Ativa: confirma o PIN, registra a digital e guarda a chave cifrada pelo segredo do leitor
  async ativarBio(pin) {
    if (!(await this.tryPin(pin))) throw new Error('PIN incorreto');
    if (!(await this.bioSuportadaNoAparelho())) throw new Error('Este aparelho não oferece leitor de digital ao navegador');

    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Finanças da Família' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'familia', displayName: 'Finanças da Família' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        extensions: { prf: {} },
        timeout: 60000,
      },
    });
    if (!cred) throw new Error('Não foi possível registrar a digital');

    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    if (!ext.prf || ext.prf.enabled === false) {
      this.cfg.bioIndisponivel = true; this.save();   // não oferecer de novo neste navegador
      throw new Error('Este navegador ainda não permite usar a digital para proteger dados (falta suporte a PRF). Continue com o PIN.');
    }

    const idB64 = KCrypto.b64(cred.rawId);
    const segredo = await this.lerPrf(cred.rawId, prfSalt);       // pede a digital uma vez
    if (!segredo) throw new Error('O leitor não devolveu o segredo necessário. Continue com o PIN.');

    // Guarda a chave de dados cifrada pelo segredo do leitor. Sem a digital, é ilegível.
    const bruta = await crypto.subtle.exportKey('raw', await this.chaveExportavel(pin));
    this.cfg.bioId = idB64;
    this.cfg.bioPrfSalt = KCrypto.b64(prfSalt);
    this.cfg.bioKey = await KCrypto.enc(await this.chaveDoPrf(segredo), KCrypto.b64(bruta));
    this.save();
    return true;
  },

  // Pede a digital e devolve o segredo estável do autenticador (extensão PRF)
  async lerPrf(rawId, salt) {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: salt } } },
        timeout: 60000,
      },
    });
    const r = assertion && assertion.getClientExtensionResults && assertion.getClientExtensionResults();
    return r && r.prf && r.prf.results && r.prf.results.first ? new Uint8Array(r.prf.results.first) : null;
  },

  // Mesma derivação do PIN, mas exportável — só para poder embrulhar a chave
  async chaveExportavel(pin) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: KCrypto.unb64(this.cfg.kdfSalt), iterations: 150000, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  },

  desativarBio() {
    delete this.cfg.bioId; delete this.cfg.bioKey; delete this.cfg.bioPrfSalt;
    this.save();
  },

  // Desbloqueio por digital: devolve a mesma CryptoKey que o PIN produziria
  async desbloquearComBio() {
    if (!this.bioAtiva()) throw new Error('Digital não configurada');
    const segredo = await this.lerPrf(KCrypto.unb64(this.cfg.bioId), KCrypto.unb64(this.cfg.bioPrfSalt));
    if (!segredo) throw new Error('Digital não reconhecida');
    const bruta = KCrypto.unb64(await KCrypto.dec(await this.chaveDoPrf(segredo), this.cfg.bioKey));
    return crypto.subtle.importKey('raw', bruta, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  },

  /* ---------- Telas ---------- */
  el() { return document.getElementById('lock'); },
  hide() { const el = this.el(); el.hidden = true; el.innerHTML = ''; document.onkeydown = null; },

  /* Teclado numérico próprio: mostra o progresso em bolinhas, tem alvos grandes
     para o polegar e não depende do teclado do sistema (que no celular cobre metade
     da tela). Aceita também o teclado físico, para quem usa no computador. */
  pinPad({ titulo, texto, rodape, aoConfirmar, min = 4, max = 8 }) {
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card lock-pin-card">
        <img src="icons/icon-192.png" alt="">
        <h2>${titulo}</h2>
        <p>${texto}</p>
        <div class="pin-dots" id="pin-dots" role="status" aria-label="dígitos informados"></div>
        <p class="lock-err" id="lock-err"></p>
        <div class="pin-pad" id="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="pin-key" data-k="${n}">${n}</button>`).join('')}
          <button type="button" class="pin-key pin-aux" data-k="del" aria-label="Apagar">⌫</button>
          <button type="button" class="pin-key" data-k="0">0</button>
          <button type="button" class="pin-key pin-ok" data-k="ok" aria-label="Confirmar">✓</button>
        </div>
        ${rodape || ''}
      </div>`;
    el.hidden = false;

    let valor = '';
    const dots = document.getElementById('pin-dots');
    const okBtn = el.querySelector('.pin-ok');
    const err = m => { const e = document.getElementById('lock-err'); if (e) e.textContent = m || ''; };

    const desenhar = () => {
      const total = Math.max(min, valor.length);
      dots.innerHTML = Array.from({ length: total }, (_, i) =>
        `<i class="${i < valor.length ? 'on' : ''}"></i>`).join('');
      okBtn.disabled = valor.length < min;
    };
    desenhar();

    const digitar = d => {
      if (valor.length >= max) return;
      valor += d; err('');
      desenhar();
      const ultimo = dots.lastElementChild;
      if (ultimo) { ultimo.style.animation = 'none'; void ultimo.offsetWidth; ultimo.style.animation = ''; }
    };
    const apagar = () => { valor = valor.slice(0, -1); err(''); desenhar(); };
    const confirmar = async () => {
      if (valor.length < min) return err(`Use ao menos ${min} dígitos`);
      const atual = valor;
      const problema = await aoConfirmar(atual);   // devolve texto de erro, ou nada se deu certo
      if (problema) {
        err(problema);
        valor = ''; desenhar();
        const card = el.querySelector('.lock-card');
        card.style.animation = 'none'; void card.offsetWidth; card.style.animation = 'tremer .4s';
      }
    };

    el.querySelectorAll('.pin-key').forEach(b => b.onclick = () => {
      const k = b.dataset.k;
      if (k === 'del') return apagar();
      if (k === 'ok') return confirmar();
      digitar(k);
    });

    document.onkeydown = e => {
      if (/^\d$/.test(e.key)) { e.preventDefault(); digitar(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); apagar(); }
      else if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
    };

    return { limpar: () => { valor = ''; desenhar(); }, erro: err };
  },

  showLock(onDone) {
    this.unlocked = false;
    const pad = this.pinPad({
      titulo: DB.familyLabel(),
      texto: 'Seus dados estão criptografados neste aparelho.<br>Digite o PIN para desbloquear.',
      rodape: `${this.bioAtiva() ? '<div class="btn-row"><button class="btn ghost" id="lock-bio">👆 Entrar com a digital</button></div>' : ''}
               <div class="btn-row"><button class="btn ghost" id="lock-forgot">Esqueci o PIN</button></div>`,
      aoConfirmar: async valor => {
        const espera = this.blockedSecs();
        if (espera) return `Muitas tentativas. Aguarde ${espera}s.`;
        const chave = await this.tryPin(valor);
        if (!chave) {
          this.registerFail();
          const w = this.blockedSecs();
          return w ? `PIN incorreto. Bloqueado por ${w}s.` : 'PIN incorreto';
        }
        return (await entrar(chave)) ? null : 'Falha ao decifrar os dados. Restaure um backup ou use "Esqueci o PIN".';
      },
    });
    const el = this.el();
    const err = pad.erro;

    const entrar = async chave => {
      try {
        if (DB.locked) await DB.unlock(chave);
        else DB.setKey(chave);
      } catch (_) {
        err('Falha ao decifrar os dados. Restaure um backup ou use "Esqueci o PIN".');
        return false;
      }
      this.registerSuccess();
      this.guardarSessao(chave);   // um F5 daqui em diante não pede o PIN de novo
      this.vigiarAtividade();
      this.unlocked = true;
      this.hide();
      if (onDone) onDone();
      return true;
    };

    const bioBtn = document.getElementById('lock-bio');
    if (bioBtn) {
      const usarBio = async () => {
        err('');
        try { await entrar(await this.desbloquearComBio()); }
        catch (e) { err(e.name === 'NotAllowedError' ? 'Digital não confirmada' : e.message); }
      };
      bioBtn.onclick = usarBio;
      setTimeout(usarBio, 350);   // já oferece o leitor ao abrir, sem esperar o toque
    }

    document.getElementById('lock-forgot').onclick = () => this.showForgot(onDone);
  },

  /* Criar ou trocar o PIN fora do primeiro acesso (Configurações → Segurança).
     Usa o mesmo teclado, para a experiência ser a mesma em qualquer lugar do app. */
  fluxoPin({ trocar = false, aoTerminar }) {
    const fechar = ok => { this.hide(); if (aoTerminar) aoTerminar(ok); };

    const escolher = (atual, primeiro = '') => {
      const criando = !primeiro;
      this.pinPad({
        titulo: criando ? (trocar ? 'Novo PIN' : 'Criar PIN') : 'Confirme o PIN',
        texto: criando
          ? 'Escolha de 4 a 8 dígitos. Ele <b>criptografa os dados guardados neste aparelho</b>.'
          : 'Digite o mesmo PIN outra vez.',
        rodape: `<div class="btn-row"><button class="btn ghost" id="pin-cancel">${criando ? 'Cancelar' : 'Recomeçar'}</button></div>`,
        aoConfirmar: async valor => {
          if (criando) { escolher(atual, valor); return null; }
          if (valor !== primeiro) return 'Os PINs não conferem — comece de novo';
          await this.setPin(valor);
          fechar(true);
          return null;
        },
      });
      document.getElementById('pin-cancel').onclick = () => (criando ? fechar(false) : escolher(atual));
    };

    if (!trocar) return escolher(null);

    // Trocar exige confirmar o PIN atual antes
    this.pinPad({
      titulo: 'PIN atual',
      texto: 'Confirme o PIN de hoje para poder trocá-lo.',
      rodape: '<div class="btn-row"><button class="btn ghost" id="pin-cancel">Cancelar</button></div>',
      aoConfirmar: async valor => {
        if (!(await this.tryPin(valor))) return 'PIN incorreto';
        escolher(valor);
        return null;
      },
    });
    document.getElementById('pin-cancel').onclick = () => fechar(false);
  },

  showForgot(onDone) {
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card">
        <img src="icons/icon-192.png" alt="">
        <h2>Esqueci o PIN</h2>
        <p>Sem o PIN não é possível decifrar os dados <b>deste aparelho</b> — isso é o que garante a segurança.
        A saída é apagar os dados locais e recuperá-los pela <b>sincronização</b> (se configurada) ou por um <b>backup</b> exportado.</p>
        <button class="btn danger" id="lock-wipe">Apagar dados locais e recomeçar</button>
        <div class="btn-row"><button class="btn ghost" id="lock-back">Voltar</button></div>
      </div>`;
    document.getElementById('lock-back').onclick = () => this.showLock(onDone);
    document.getElementById('lock-wipe').onclick = () => {
      if (!confirm('Apagar TODOS os dados locais deste aparelho? (a nuvem, se configurada, não é afetada)')) return;
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(this.key);
      localStorage.removeItem(DB.ROTULO_KEY);
      location.reload();
    };
  },

  /* ---------- Primeiro acesso ----------
     Ordem pensada para o que realmente importa em cada etapa: primeiro a conta na
     nuvem (é ela que guarda e compartilha os dados da família), depois a proteção
     deste aparelho (PIN) e, por último, o atalho da digital. */
  showOnboarding(onDone) {
    const el = this.el();
    const concluir = () => {
      this.cfg.onboarded = true; this.save();
      this.unlocked = true;
      this.hide();
      if (onDone) onDone();
    };

    const tela = (passo, total, titulo, texto, corpo, acoes) => {
      el.innerHTML = `
        <div class="lock-card">
          <img src="icons/icon-192.png" alt="">
          ${total ? `<div class="ob-steps">${Array.from({ length: total }, (_, i) =>
            `<i class="${i + 1 === passo ? 'on' : i + 1 < passo ? 'done' : ''}"></i>`).join('')}</div>` : ''}
          <h2>${titulo}</h2>
          <p>${texto}</p>
          ${corpo || ''}
          <p class="lock-err" id="ob-err"></p>
          ${acoes}
        </div>`;
      el.hidden = false;
    };
    const err = m => { const e = document.getElementById('ob-err'); if (e) e.textContent = m || ''; };
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    const val = id => (document.getElementById(id) || {}).value || '';

    /* Passo 1 — como os dados vão viver */
    const passoInicio = () => {
      tela(1, 4, 'Bem-vindo 👋',
        'Como vocês querem usar o app?',
        `<div class="ob-opts">
           <button type="button" class="ob-opt" id="ob-nuvem">
             <b>☁️ Com a família</b><small>Os lançamentos aparecem no celular de todos e ficam salvos na nuvem. Recomendado.</small>
           </button>
           <button type="button" class="ob-opt" id="ob-local">
             <b>📱 Só neste aparelho</b><small>Nada sai daqui. Dá para conectar a família depois, em Configurações.</small>
           </button>
         </div>`, '');
      on('ob-nuvem', () => (Sync.configured() ? passoLogin() : passoServidor()));
      on('ob-local', () => passoNomeLocal());
    };

    /* Passo 2 — endereço do servidor (pulado se o app já vier configurado) */
    const passoServidor = () => {
      const c = Sync.cfg || {};
      tela(2, 4, 'Conectar ao servidor',
        'Cole os dados do projeto Supabase da família. Estão em <b>Settings → API</b>, no painel do Supabase.',
        `<div class="ob-field"><label>URL do projeto</label><input id="ob-url" placeholder="https://xxxx.supabase.co" value="${this.esc(c.url || '')}"></div>
         <div class="ob-field"><label>Chave anon (public)</label><input id="ob-key" placeholder="eyJhbGciOi…" value="${this.esc(c.anonKey || '')}"></div>`,
        `<button class="btn" id="ob-next">Continuar</button>
         <div class="btn-row"><button class="btn ghost" id="ob-back">Voltar</button></div>`);
      on('ob-back', passoInicio);
      on('ob-next', () => {
        const url = val('ob-url').trim().replace(/\/$/, ''), key = val('ob-key').trim();
        if (!/^https:\/\/.+/.test(url)) return err('A URL precisa começar com https://');
        if (!key) return err('Cole a chave anon');
        Sync.cfg.url = url; Sync.cfg.anonKey = key; Sync.saveCfg();
        passoLogin();
      });
    };

    /* Passo 3 — conta */
    const passoLogin = () => {
      tela(3, 4, 'Sua conta',
        'Entre com sua conta ou crie uma agora. É ela que liga este aparelho aos dados da família.',
        `<div class="ob-field"><label>E-mail</label><input id="ob-email" type="email" autocomplete="username" value="${this.esc((Sync.cfg || {}).user_email || '')}"></div>
         <div class="ob-field"><label>Senha</label><input id="ob-pass" type="password" autocomplete="current-password"></div>`,
        `<button class="btn" id="ob-entrar">Entrar</button>
         <div class="btn-row"><button class="btn ghost" id="ob-criar">Criar conta</button></div>
         <div class="btn-row"><button class="btn ghost" id="ob-back">Voltar</button></div>`);
      on('ob-back', () => (Sync.configured() ? passoServidor() : passoInicio()));

      const email = () => val('ob-email').trim();
      on('ob-entrar', async () => {
        if (!email() || !val('ob-pass')) return err('Preencha e-mail e senha');
        err('Entrando…');
        try { await Sync.signIn(email(), val('ob-pass')); passoFamilia(); }
        catch (e) { err(e.message); }
      });
      on('ob-criar', async () => {
        if (!email() || val('ob-pass').length < 6) return err('Use um e-mail válido e senha de 6+ caracteres');
        err('Criando…');
        try {
          const d = await Sync.signUp(email(), val('ob-pass'));
          if (!d.access_token) return err('Conta criada. Confirme o e-mail que você recebeu e depois entre.');
          passoFamilia();
        } catch (e) { err(e.message); }
      });
    };

    /* Passo 3b — família */
    const passoFamilia = () => {
      tela(3, 4, 'Sua família',
        'Escolha como querem chamar a família — é o nome que aparece no app. Ou entre na família que já existe, com o código do outro aparelho.',
        `<div class="ob-field"><label>Nome da família</label><input id="ob-fam" placeholder="Ex: Nossa casa, Família Silva…" autocomplete="off"></div>`,
        `<button class="btn" id="ob-criar-fam">Criar família</button>
         <hr class="sep">
         <div class="ob-field"><label>Ou cole o código recebido</label><input id="ob-cod" placeholder="código da família"></div>
         <button class="btn ghost" id="ob-entrar-fam">Entrar na família</button>`);
      on('ob-criar-fam', async () => {
        const nome = val('ob-fam').trim();
        if (!nome) { const c = document.getElementById('ob-fam'); if (c) c.focus(); return err('Escolha um nome para a família'); }
        err('Criando…');
        try {
          await Sync.createFamily(nome);
          DB.upsert('family_settings', { ...DB.settings(), family_name: nome });
          await Sync.syncAll();
          passoPin();
        } catch (e) { err(e.message); }
      });
      on('ob-entrar-fam', async () => {
        if (!val('ob-cod').trim()) return err('Cole o código da família');
        err('Entrando…');
        try {
          await Sync.joinFamily(val('ob-cod'));
          DB.data.meta.lastSync = null; DB.save();     // puxa tudo o que a família já tem
          await Sync.syncAll();
          passoPin();
        } catch (e) { err(e.message); }
      });
    };

    /* Quem usa só neste aparelho também escolhe o nome */
    const passoNomeLocal = () => {
      tela(2, 3, 'Como chamar a família?',
        'É o nome que aparece no topo do app. Dá para mudar depois em Configurações.',
        `<div class="ob-field"><label>Nome</label><input id="ob-fam-local" placeholder="Ex: Nossa casa, Família Silva…" autocomplete="off"></div>`,
        `<button class="btn" id="ob-nome-go">Continuar</button>
         <div class="btn-row"><button class="btn ghost" id="ob-back">Voltar</button></div>`);
      on('ob-back', passoInicio);
      on('ob-nome-go', () => {
        const nome = val('ob-fam-local').trim();
        if (!nome) { const c = document.getElementById('ob-fam-local'); if (c) c.focus(); return err('Escolha um nome'); }
        DB.upsert('family_settings', { ...DB.settings(), family_name: nome });
        passoPin();
      });
    };

    /* Passo 4 — proteção deste aparelho. Em duas etapas no mesmo teclado:
       primeiro escolhe, depois repete. Sem dois campos empilhados. */
    const passoPin = (primeiro = '') => {
      const criando = !primeiro;
      this.pinPad({
        titulo: criando ? 'Proteger este aparelho' : 'Confirme o PIN',
        texto: criando
          ? 'Escolha um PIN de 4 a 8 dígitos. Além de bloquear o app, ele <b>criptografa os dados guardados aqui</b> (AES-256).'
          : 'Digite o mesmo PIN outra vez para confirmar.',
        rodape: `<div class="btn-row"><button class="btn ghost" id="ob-pin-skip">${criando ? 'Agora não' : 'Recomeçar'}</button></div>`,
        aoConfirmar: async valor => {
          if (criando) { passoPin(valor); return null; }
          if (valor !== primeiro) return 'Os PINs não conferem — comece de novo';
          await this.setPin(valor);
          if (await this.bioSuportadaNoAparelho()) passoDigital(valor);
          else concluir();
          return null;
        },
      });
      on('ob-pin-skip', () => {
        if (criando) { this.cfg.skipped = true; this.save(); concluir(); }
        else passoPin();
      });
    };

    /* Passo extra — digital, oferecida na hora certa (o PIN acabou de existir) */
    const passoDigital = pin => {
      tela(0, 0, 'Usar a digital? 👆',
        'Em vez de digitar o PIN toda vez, desbloqueie com a digital. O PIN continua valendo como alternativa.',
        '', `<button class="btn" id="ob-bio">Ativar digital</button>
             <div class="btn-row"><button class="btn ghost" id="ob-bio-skip">Agora não</button></div>`);
      on('ob-bio', async () => {
        err('Confirme no leitor do aparelho…');
        try { await this.ativarBio(pin); concluir(); }
        catch (e) {
          err(e.name === 'NotAllowedError' ? 'Digital não confirmada' : e.message);
          // Navegador sem suporte: tira o botão e deixa só seguir com o PIN
          if (/PRF|não oferece leitor/i.test(e.message)) {
            const b = document.getElementById('ob-bio');
            if (b) b.hidden = true;
            const pular = document.getElementById('ob-bio-skip');
            if (pular) pular.textContent = 'Continuar com o PIN';
          }
        }
      });
      on('ob-bio-skip', concluir);
    };

    passoInicio();
  },

  esc(s) { return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); },

  /* Ponto de entrada: garante DB carregado/decifrado e chama onReady exatamente uma vez. */
  // Retoma a sessão desta aba, se ainda válida — assim um F5 não pede o PIN de novo
  async retomarOuPedirPin(onReady) {
    const chave = await this.recuperarSessao();
    if (chave) {
      try {
        if (DB.locked) await DB.unlock(chave); else DB.setKey(chave);
        this.unlocked = true;
        this.hide();
        this.guardarSessao(chave);      // renova o prazo a partir de agora
        this.vigiarAtividade();
        onReady();
        return;
      } catch (_) { this.limparSessao(); }
    }
    this.showLock(onReady);
  },

  init(onReady) {
    this.load();
    DB.load();
    if (DB.locked || this.enabled()) this.retomarOuPedirPin(onReady);
    else if (!this.cfg.onboarded && !this.cfg.skipped) this.showOnboarding(onReady);
    else { this.unlocked = true; onReady(); }

    // Re-bloqueio automático ao voltar de segundo plano
    document.addEventListener('visibilitychange', () => {
      if (!this.enabled() || !this.unlocked) return;
      if (document.hidden) { this._hiddenAt = Date.now(); return; }
      const mins = (Date.now() - (this._hiddenAt || 0)) / 60000;
      if (this._hiddenAt && mins >= (this.cfg.lockAfterMin ?? 5)) {
        this.limparSessao();          // passou do prazo: exige o PIN de verdade
        this.showLock(() => {});
      }
    });
  },

  lockNow() {
    if (!this.enabled()) return toast('Ative um PIN em ⚙︎ → Segurança primeiro');
    this.limparSessao();              // bloqueio pedido: nem o F5 escapa
    this.showLock(() => {});
  },
};
