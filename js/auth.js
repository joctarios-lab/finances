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
        <div class="btn-row"><button class="btn ghost" id="lock-forgot">Esqueci o PIN</button></div>
      </div>`;
    el.hidden = false;
    const pin = document.getElementById('lock-pin');
    const err = m => document.getElementById('lock-err').textContent = m;

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
      try {
        if (DB.locked) await DB.unlock(key);
        else DB.setKey(key);      // dados ainda em claro: passa a criptografar agora
      } catch (_) {
        return err('Falha ao decifrar os dados. Restaure um backup ou use "Esqueci o PIN".');
      }
      this.registerSuccess();
      this.unlocked = true;
      this.hide();
      if (onDone) onDone();
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
