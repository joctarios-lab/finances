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

  async setPin(pin) {
    this.cfg.kdfSalt = KCrypto.b64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await KCrypto.deriveKey(pin, this.cfg.kdfSalt);
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
        const key = await KCrypto.deriveKey(pin, this.cfg.kdfSalt);
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
      throw new Error('Seu navegador ainda não permite usar a digital para proteger dados (falta suporte a PRF). Continue com o PIN.');
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
  hide() { const el = this.el(); el.hidden = true; el.innerHTML = ''; },

  showLock(onDone) {
    this.unlocked = false;
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card">
        <img src="icons/icon-192.png" alt="">
        <h2>Finanças da Família</h2>
        <p>Seus dados estão criptografados neste aparelho.<br>Digite o PIN para desbloquear.</p>
        <input id="lock-pin" class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••">
        <p class="lock-err" id="lock-err"></p>
        <button class="btn" id="lock-go">Desbloquear</button>
        ${this.bioAtiva() ? '<div class="btn-row"><button class="btn ghost" id="lock-bio">👆 Entrar com a digital</button></div>' : ''}
        <div class="btn-row"><button class="btn ghost" id="lock-forgot">Esqueci o PIN</button></div>
      </div>`;
    el.hidden = false;
    const pin = document.getElementById('lock-pin');
    const err = m => document.getElementById('lock-err').textContent = m;

    const entrar = async chave => {
      try {
        if (DB.locked) await DB.unlock(chave);
        else DB.setKey(chave);
      } catch (_) {
        err('Falha ao decifrar os dados. Restaure um backup ou use "Esqueci o PIN".');
        return false;
      }
      this.registerSuccess();
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

    const go = async () => {
      const wait = this.blockedSecs();
      if (wait) return err(`Muitas tentativas. Aguarde ${wait}s.`);
      const key = await this.tryPin(pin.value);
      if (!key) {
        this.registerFail();
        const w = this.blockedSecs();
        err(w ? `PIN incorreto. Bloqueado por ${w}s.` : 'PIN incorreto');
        pin.value = ''; pin.focus();
        return;
      }
      await entrar(key);
    };
    document.getElementById('lock-go').onclick = go;
    pin.onkeydown = e => { if (e.key === 'Enter') go(); };
    document.getElementById('lock-forgot').onclick = () => this.showForgot(onDone);
    setTimeout(() => pin.focus(), 100);
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
      location.reload();
    };
  },

  showFirstRun(onDone) {
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card">
        <img src="icons/icon-192.png" alt="">
        <h2>Bem-vindo 👋</h2>
        <p>Crie um PIN (4 a 8 dígitos). Além de bloquear o app, ele <b>criptografa os dados</b> guardados neste aparelho (AES-256).</p>
        <input id="lock-pin" class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="criar PIN">
        <input id="lock-pin2" class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="repetir PIN">
        <p class="lock-err" id="lock-err"></p>
        <button class="btn" id="lock-go">Ativar proteção</button>
        <div class="btn-row"><button class="btn ghost" id="lock-skip">Agora não</button></div>
      </div>`;
    el.hidden = false;
    const err = m => document.getElementById('lock-err').textContent = m;
    document.getElementById('lock-go').onclick = async () => {
      const p1 = document.getElementById('lock-pin').value;
      const p2 = document.getElementById('lock-pin2').value;
      if (!/^\d{4,8}$/.test(p1)) return err('Use de 4 a 8 dígitos');
      if (p1 !== p2) return err('Os PINs não conferem');
      await this.setPin(p1);
      this.unlocked = true;
      this.hide();
      if (onDone) onDone();
    };
    document.getElementById('lock-skip').onclick = () => {
      this.cfg.skipped = true; this.save();
      this.unlocked = true;
      this.hide();
      if (onDone) onDone();
    };
  },

  /* Ponto de entrada: garante DB carregado/decifrado e chama onReady exatamente uma vez. */
  init(onReady) {
    this.load();
    DB.load();
    if (DB.locked || this.enabled()) this.showLock(onReady);
    else if (!this.cfg.skipped) this.showFirstRun(onReady);
    else { this.unlocked = true; onReady(); }

    // Re-bloqueio automático ao voltar de segundo plano
    document.addEventListener('visibilitychange', () => {
      if (!this.enabled() || !this.unlocked) return;
      if (document.hidden) { this._hiddenAt = Date.now(); return; }
      const mins = (Date.now() - (this._hiddenAt || 0)) / 60000;
      if (this._hiddenAt && mins >= (this.cfg.lockAfterMin ?? 5)) this.showLock(() => {});
    });
  },

  lockNow() {
    if (this.enabled()) this.showLock(() => {});
    else toast('Ative um PIN em ⚙︎ → Segurança primeiro');
  },
};
