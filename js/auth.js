/* Finanças da Família — segurança de acesso
   PIN local (hash SHA-256 + salt) com bloqueio automático. Protege o acesso ao app no aparelho.
   A camada de nuvem (Supabase) tem sua própria autenticação por e-mail/senha + RLS por família. */
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

  enabled() { return !!(this.cfg && this.cfg.pinHash); },

  async hash(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async setPin(pin) {
    const salt = DB.uuid();
    this.cfg.salt = salt;
    this.cfg.pinHash = await this.hash(pin, salt);
    this.cfg.lockAfterMin = this.cfg.lockAfterMin ?? 5;
    this.save();
  },

  async verify(pin) {
    if (!this.enabled()) return true;
    return (await this.hash(pin, this.cfg.salt)) === this.cfg.pinHash;
  },

  removePin() {
    delete this.cfg.pinHash; delete this.cfg.salt;
    this.save();
  },

  /* ---------- Telas ---------- */
  el() { return document.getElementById('lock'); },

  showLock() {
    if (!this.enabled()) { this.unlocked = true; return; }
    this.unlocked = false;
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card">
        <img src="icons/icon-192.png" alt="">
        <h2>Finanças da Família</h2>
        <p>Digite o PIN para desbloquear</p>
        <input id="lock-pin" class="pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••">
        <p class="lock-err" id="lock-err"></p>
        <button class="btn" id="lock-go">Desbloquear</button>
      </div>`;
    el.hidden = false;
    const pin = document.getElementById('lock-pin');
    const go = async () => {
      if (await this.verify(pin.value)) {
        this.unlocked = true;
        el.hidden = true;
        el.innerHTML = '';
      } else {
        document.getElementById('lock-err').textContent = 'PIN incorreto';
        pin.value = ''; pin.focus();
      }
    };
    document.getElementById('lock-go').onclick = go;
    pin.onkeydown = e => { if (e.key === 'Enter') go(); };
    setTimeout(() => pin.focus(), 100);
  },

  showFirstRun(onDone) {
    const el = this.el();
    el.innerHTML = `
      <div class="lock-card">
        <img src="icons/icon-192.png" alt="">
        <h2>Bem-vindo 👋</h2>
        <p>Proteja o app com um PIN (4 a 8 dígitos). Ele será pedido ao abrir e ao voltar de segundo plano.</p>
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
      el.hidden = true; el.innerHTML = '';
      if (onDone) onDone();
    };
    document.getElementById('lock-skip').onclick = () => {
      this.cfg.skipped = true; this.save();
      this.unlocked = true;
      el.hidden = true; el.innerHTML = '';
      if (onDone) onDone();
    };
  },

  init() {
    this.load();
    if (this.enabled()) this.showLock();
    else if (!this.cfg.skipped) this.showFirstRun();
    else this.unlocked = true;

    // Bloqueio automático ao voltar de segundo plano
    document.addEventListener('visibilitychange', () => {
      if (!this.enabled()) return;
      if (document.hidden) { this._hiddenAt = Date.now(); return; }
      const mins = (Date.now() - (this._hiddenAt || 0)) / 60000;
      if (this._hiddenAt && mins >= (this.cfg.lockAfterMin ?? 5)) this.showLock();
    });
  },

  lockNow() {
    if (this.enabled()) this.showLock();
    else toast('Ative um PIN em ⚙︎ → Segurança primeiro');
  },
};
