/* Cofrinho — o app da criança.

   O QUE ESTE APP É: um cofrinho de vidro que ela abre para ver quanto tem,
   repartir a semanada, marcar o que fez e escolher no que gastar. Nada mais.

   O QUE ELE NÃO É, e por decisão: não tem saldo da família, não tem conta
   bancária, não tem lista de tudo o que os pais gastam. O adulto administra no
   app da família; aqui é o dinheiro DELA, e só.

   COMO A TELA CONVERSA. Toda tela tem o Dino dizendo uma frase curta em primeira
   pessoa e no imperativo suave — "escolha", "toque", "vamos repartir". Uma
   criança de seis anos entende instrução direta muito melhor do que rótulo
   nominal, e o balão do mascote é lido antes de qualquer título.

   TEMPO EM SEMANAS, dinheiro em reais inteiros sempre que der. "Faltam quatro
   semanadas" é uma frase que ela consegue planejar; "faltam R$ 43,50" não. */
'use strict';

const App = {
  kid: null,          // a criança logada
  aba: 'cofrinho',
  som: true,
  _erros: 0,          // tentativas de senha erradas seguidas
};

const el = s => document.querySelector(s);
const raiz = () => el('#app');

const fmt = v => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');
// Para a criança: valor redondo vira "R$ 7", quebrado vira "R$ 7,50"
const fmtKid = v => {
  const n = Number(v) || 0;
  return 'R$ ' + (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Som ----------
   Gerado na hora com WebAudio: nenhum arquivo para baixar, nenhum atraso na
   primeira vez. Notas curtas e agudas, que é o som que criança lê como "certo".
   O botão de silêncio existe porque nem todo lugar de usar o app aceita som. */
const Som = {
  ctx: null,
  ligar() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { } } },
  nota(freq, dur = 0.12, tipo = 'sine', vol = 0.16) {
    if (!App.som) return;
    this.ligar();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = tipo; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  },
  toque() { this.nota(660, 0.07, 'triangle', 0.1); },
  moeda() { this.nota(880, 0.09, 'triangle'); setTimeout(() => this.nota(1320, 0.14, 'triangle'), 70); },
  festa() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.nota(f, 0.16, 'triangle'), i * 95)); },
  nao() { this.nota(200, 0.2, 'sawtooth', 0.1); },
};

function vibra(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (_) { } }

function aviso(txt, emo = '') {
  const antigo = el('.aviso'); if (antigo) antigo.remove();
  const d = document.createElement('div');
  d.className = 'aviso';
  d.textContent = (emo ? emo + ' ' : '') + txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

function festa() {
  const antigo = el('.confete'); if (antigo) antigo.remove();
  document.body.insertAdjacentHTML('beforeend', Arte.confete());
  Som.festa(); vibra([25, 40, 25]);
  setTimeout(() => { const c = el('.confete'); if (c) c.remove(); }, 3000);
}

/* A MOEDA QUE VOA até o pote. É o que transforma "o número mudou" em "o dinheiro
   foi para ali" — a criança acompanha o objeto com os olhos e entende o destino
   sem ninguém explicar. */
function moedaVoando(deEl, paraEl) {
  if (!deEl || !paraEl) return;
  const a = deEl.getBoundingClientRect(), b = paraEl.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'moeda-voo';
  d.style.left = (a.left + a.width / 2 - 17) + 'px';
  d.style.top = (a.top + a.height / 2 - 17) + 'px';
  d.style.setProperty('--dx', (b.left + b.width / 2 - a.left - a.width / 2) + 'px');
  d.style.setProperty('--dy', (b.top + b.height / 2 - a.top - a.height / 2) + 'px');
  d.innerHTML = Arte.moeda();
  document.body.appendChild(d);
  Som.moeda();
  setTimeout(() => d.remove(), 900);
}

function balao(txt) { return `<div class="balao">${txt}</div>`; }
function palco(pose, tam = 130) { return `<div class="dino-palco">${Arte.dino(pose, tam)}</div>`; }

// A cor do Dino segue a cor da criança: o app vira dela na primeira olhada
function pintarDino(cor) {
  if (!cor) return;
  const r = document.documentElement.style;
  r.setProperty('--dino-1', cor);
  r.setProperty('--dino-2', sombrear(cor, -12));
  r.setProperty('--dino-3', sombrear(cor, -24));
  r.setProperty('--dino-barriga', clarear(cor, 82));
}
function hexRGB(h) {
  const s = String(h).replace('#', '');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) || 0);
}
function sombrear(h, pct) {
  const [r, g, b] = hexRGB(h);
  const f = v => Math.max(0, Math.min(255, Math.round(v + (v * pct / 100))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function clarear(h, pct) {
  const [r, g, b] = hexRGB(h);
  const f = v => Math.round(v + (255 - v) * pct / 100);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ================= TELA 1 — de quem é o cofrinho ================= */

function telaQuem() {
  const kids = Dados.criancas();
  if (!kids.length) return telaSemCrianca();
  if (kids.length === 1) return telaSenha(kids[0]);

  raiz().innerHTML = `
    ${palco('oi')}
    ${balao('Oi! De quem é o cofrinho?')}
    <div class="quem">
      ${kids.map(k => `
        <button class="quem-bt" data-kid="${k.id}">
          <div class="quem-av">${esc(k.avatar || '🦖')}</div>
          <div class="quem-nome">${esc(k.name)}</div>
        </button>`).join('')}
    </div>`;
  document.querySelectorAll('[data-kid]').forEach(b => b.onclick = () => {
    Som.toque();
    telaSenha(Dados.get('kids', b.dataset.kid));
  });
}

/* SEM CRIANÇA CADASTRADA: o recado é para o ADULTO, não para ela.
   Uma criança que abre o app e encontra um erro técnico acha que quebrou algo. */
function telaSemCrianca() {
  const semNuvem = !Nuvem.pronta();
  raiz().innerHTML = `
    ${palco('dormindo')}
    ${balao('Ainda não tem nenhum cofrinho aqui...')}
    <div class="recado">
      <b>Recado para o adulto</b>
      ${semNuvem
      ? 'Abra o app da família neste aparelho, entre na sua conta e cadastre a criança em <b>Configurações → Crianças</b>. Depois volte aqui.'
      : 'Cadastre a criança no app da família, em <b>Configurações → Crianças</b>, e toque em atualizar abaixo.'}
    </div>
    <button class="bt clara" id="recarregar" style="margin-top:16px"><span class="emo">🔄</span> Procurar de novo</button>`;
  el('#recarregar').onclick = async () => {
    aviso('Procurando...', '🔎');
    await Nuvem.sincronizar();
    telaQuem();
  };
}

/* ================= TELA 2 — a senha, num teclado de criança ================= */

function telaSenha(kid) {
  if (!kid) return telaQuem();
  pintarDino(kid.cor);
  // Sem senha cadastrada o cofrinho abre direto: exigir o que não existe
  // trancaria a criança para fora sem nenhuma forma de entrar.
  if (!kid.pin_hash) { entrar(kid); return; }

  let digitado = '';
  const teclas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'vazia', 0, 'apagar'];
  raiz().innerHTML = `
    <div class="senha-tela" id="senha-tela">
      <div style="text-align:center">${Arte.cadeado(false)}</div>
      ${palco('pensando', 110)}
      ${balao(`Oi, ${esc(kid.name)}! Qual é a sua senha secreta?`)}
      <div class="bolinhas">${[0, 1, 2, 3].map(i => `<span class="bolinha" data-b="${i}"></span>`).join('')}</div>
      <div class="tecla-grade">
        ${teclas.map(t => t === 'vazia'
          ? '<button class="tecla vazia" tabindex="-1"></button>'
          : t === 'apagar'
            ? '<button class="tecla apagar" data-t="apagar" aria-label="Apagar">⌫</button>'
            : `<button class="tecla" data-t="${t}">${t}</button>`).join('')}
      </div>
      <button class="bt clara" id="voltar-quem" style="max-width:340px;margin-top:22px">
        <span class="emo">↩️</span> Não sou eu
      </button>
    </div>`;

  const pintarBolinhas = () => document.querySelectorAll('.bolinha')
    .forEach((b, i) => b.classList.toggle('cheia', i < digitado.length));

  document.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
    Som.toque(); vibra(12);
    if (b.dataset.t === 'apagar') { digitado = digitado.slice(0, -1); pintarBolinhas(); return; }
    if (digitado.length >= 4) return;
    digitado += b.dataset.t;
    pintarBolinhas();
    if (digitado.length < 4) return;

    const hash = await hashDaSenha(digitado, kid.pin_salt || '');
    if (hash === kid.pin_hash) {
      el('.cadeado').classList.add('aberto');
      Som.moeda();
      setTimeout(() => entrar(kid), 480);
      return;
    }
    /* ERROU: treme, apaga e o Dino fica triste — nunca uma mensagem de erro
       vermelha. Aos seis anos, errar a senha é comum, e o app não pode fazer
       disso um fracasso. Depois de três, oferece voltar sem culpa. */
    App._erros++;
    Som.nao(); vibra([70, 50, 70]);
    const tela = el('#senha-tela');
    tela.classList.add('errou');
    setTimeout(() => tela.classList.remove('errou'), 460);
    digitado = ''; pintarBolinhas();
    const p = el('.dino-palco');
    if (p) p.innerHTML = Arte.dino('triste', 110);
    const bl = el('.balao');
    if (bl) bl.textContent = App._erros >= 3
      ? 'Peça ajuda para um adulto — ele sabe a sua senha 🙂'
      : 'Ops, não é essa. Tenta de novo!';
  });

  el('#voltar-quem').onclick = () => { App._erros = 0; telaQuem(); };
}

async function hashDaSenha(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function entrar(kid) {
  App.kid = kid;
  App._erros = 0;
  App.aba = 'cofrinho';
  sessionStorage.setItem('cofrinho.kid', kid.id);
  pintarDino(kid.cor);
  render();
  // Puxa a nuvem depois de entrar: o cofrinho abre na hora com o que já tem,
  // e o que chegou de novo aparece sozinho um instante depois.
  Nuvem.sincronizar().then(mudou => { if (mudou && App.kid) render(); });
}

function sair() {
  App.kid = null;
  sessionStorage.removeItem('cofrinho.kid');
  document.documentElement.removeAttribute('style');
  telaQuem();
}

/* ================= O CORPO DO APP ================= */

function render() {
  const kid = App.kid;
  if (!kid) return telaQuem();
  const atual = Dados.get('kids', kid.id);
  if (!atual) return sair();
  App.kid = atual;

  const telas = { cofrinho: telaCofrinho, tarefas: telaTarefas, sonho: telaSonho, selos: telaSelos };
  raiz().innerHTML = (telas[App.aba] || telaCofrinho)() + barraDeAbas();
  ligarAbas();
}

function barraDeAbas() {
  const t = Dados.tarefas(App.kid.id).filter(x => !x.feita).length;
  const abas = [
    ['cofrinho', '🐷', 'Cofrinho', 0],
    ['tarefas', '✅', 'Tarefas', t],
    ['sonho', '⭐', 'Meu sonho', 0],
    ['selos', '🏅', 'Prêmios', 0],
  ];
  return `
    <div class="barra"><div class="barra-in">
      ${abas.map(([id, emo, nome, n]) => `
        <button class="aba ${App.aba === id ? 'on' : ''}" data-aba="${id}">
          <span class="emo">${emo}</span>
          <span>${nome}${n ? ` (${n})` : ''}</span>
        </button>`).join('')}
    </div></div>`;
}

function ligarAbas() {
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => {
    Som.toque();
    App.aba = b.dataset.aba;
    render();
  });
}

/* ---------- Aba 1: o cofrinho ---------- */

function telaCofrinho() {
  const kid = App.kid;
  const p = Dados.potes(kid.id);
  const teto = Math.max(p.gastar, p.guardar, p.doar, 1);
  const ritual = Dados.semanadaADividir(kid.id);
  const aConfirmar = Dados.tarefas(kid.id).filter(t => t.feita && !t.confirmada).length;

  const fala = ritual
    ? 'Chegou a sua semanada! Vamos repartir?'
    : p.total <= 0
      ? 'Seu cofrinho está vazinho. Logo enche!'
      : `Você tem ${fmtKid(p.total)}. Que legal!`;

  return `
    ${palco(ritual ? 'uau' : p.total > 0 ? 'feliz' : 'dormindo')}
    ${balao(fala)}

    <div class="total">
      <span class="grana">${fmtKid(p.total)}</span>
      <small>é tudo o que você tem</small>
    </div>

    ${ritual ? `
      <button class="bt ouro" id="ir-ritual" style="margin-bottom:16px">
        <span class="emo">🎉</span> Repartir ${fmtKid(ritual.valor)}
      </button>` : ''}

    <div class="potes">
      ${['gastar', 'guardar', 'doar'].map(t => `
        <div class="pote-bloco on-${t}" data-pote="${t}" id="pote-${t}">
          ${Arte.pote(t, p[t], teto)}
          <div class="pote-val">${fmtKid(p[t])}</div>
          <div class="pote-nome">${t === 'gastar' ? 'Gastar' : t === 'guardar' ? 'Guardar' : 'Doar'}</div>
        </div>`).join('')}
    </div>

    <div class="linha-bt" style="margin-top:16px">
      <button class="bt verde" id="bt-gastar"><span class="emo">🛒</span> Gastei</button>
      <button class="bt rosa" id="bt-doar"><span class="emo">💝</span> Doei</button>
    </div>

    ${aConfirmar ? `<div class="recado" style="margin-top:16px">
      <b>Quase lá!</b> ${aConfirmar === 1 ? 'Uma tarefa está' : `${aConfirmar} tarefas estão`}
      esperando um adulto conferir. Aí o dinheiro cai no seu pote 🪙
    </div>` : ''}

    <h2>O que aconteceu</h2>
    ${historico(kid.id)}

    <button class="bt clara" id="bt-sair" style="margin-top:18px">
      <span class="emo">👋</span> Sair do meu cofrinho
    </button>`;
}

function historico(kidId) {
  const movs = Dados.entradas(kidId).slice(0, 12);
  if (!movs.length) return '<div class="vazio">Nada ainda. Sua primeira semanada vai aparecer aqui 🪙</div>';
  const icones = {
    semanada: '🪙', tarefa: '✅', rendimento: '✨', divisao: '🫙',
    gasto: '🛒', doacao: '💝', presente: '🎁',
  };
  return `<div class="carta">${movs.map(e => {
    const saida = e.tipo === 'gasto' || e.tipo === 'doacao';
    const v = Number(e.amount) || 0;
    // A divisão que sai do pote gastar é o repasse interno: mostra sem sinal,
    // porque para ela o dinheiro não sumiu, só mudou de pote.
    const interno = e.tipo === 'divisao';
    return `<div class="mov">
      <div class="mov-ico">${icones[e.tipo] || '🪙'}</div>
      <div class="mov-txt">
        <b>${esc(e.description || e.tipo)}</b>
        <small>${diaBonito(e.date)}${interno ? ' · trocou de pote' : ''}</small>
      </div>
      <div class="mov-val ${interno ? '' : saida ? 'menos' : 'mais'}">
        ${interno ? '' : saida ? '−' : '+'}${fmtKid(Math.abs(v))}
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* Data em palavra, não em número: "hoje" e "ontem" são as únicas datas que uma
   criança de seis anos situa sozinha. */
function diaBonito(iso) {
  const hoje = Dados.hojeISO();
  if (iso === hoje) return 'hoje';
  if (iso === Dados.somarDiasISO(hoje, -1)) return 'ontem';
  const d = new Date(iso + 'T12:00:00');
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diff = Math.round((new Date(hoje + 'T12:00:00') - d) / 86400000);
  if (diff > 1 && diff < 7) return dias[d.getDay()];
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ---------- O ritual da semanada ---------- */

function telaRitual() {
  const kid = App.kid;
  const r = Dados.semanadaADividir(kid.id);
  if (!r) { render(); return; }
  const total = r.valor;
  // Passo de R$ 1 sempre que der: contar moedas de um real é a conta que ela faz
  const passo = total >= 3 ? 1 : 0.5;
  let guardar = 0, doar = 0;

  const desenhar = () => {
    const gastar = +(total - guardar - doar).toFixed(2);
    const teto = Math.max(gastar, guardar, doar, 1);
    raiz().innerHTML = `
      ${palco('uau', 120)}
      ${balao('Chegou a sua semanada! Quanto você quer guardar e quanto quer doar?')}
      <div class="ritual-valor">${fmtKid(total)}</div>
      <div class="reparte">
        ${[['gastar', gastar, 'Gastar', false], ['guardar', guardar, 'Guardar', true], ['doar', doar, 'Doar', true]]
        .map(([t, v, nome, mexe]) => `
          <div class="rep-col" id="rep-${t}">
            ${Arte.pote(t, v, teto)}
            <div class="rep-n">${fmtKid(v)}</div>
            <div class="pote-nome">${nome}</div>
            ${mexe ? `<div class="rep-bts" style="margin-top:8px">
              <button class="rep-bt" data-menos="${t}" ${v <= 0 ? 'disabled' : ''}>−</button>
              <button class="rep-bt" data-mais="${t}" ${gastar < passo ? 'disabled' : ''}>+</button>
            </div>` : '<div style="height:8px"></div>'}
          </div>`).join('')}
      </div>
      <button class="bt ouro" id="rit-ok" style="margin-top:20px">
        <span class="emo">🫙</span> Pronto, guardei!
      </button>
      <button class="bt clara" id="rit-volta" style="margin-top:12px">
        <span class="emo">↩️</span> Faço depois
      </button>`;

    document.querySelectorAll('[data-mais]').forEach(b => b.onclick = () => {
      const alvo = b.dataset.mais;
      if (total - guardar - doar < passo) return;
      const de = el('#rep-gastar'), para = el('#rep-' + alvo);
      moedaVoando(de, para);
      if (alvo === 'guardar') guardar = +(guardar + passo).toFixed(2); else doar = +(doar + passo).toFixed(2);
      setTimeout(desenhar, 340);
    });
    document.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => {
      const alvo = b.dataset.menos;
      Som.toque();
      if (alvo === 'guardar') guardar = Math.max(0, +(guardar - passo).toFixed(2));
      else doar = Math.max(0, +(doar - passo).toFixed(2));
      desenhar();
    });
    el('#rit-ok').onclick = () => {
      Dados.dividir(kid.id, guardar, doar);
      Nuvem.sincronizar();
      festa();
      App.aba = 'cofrinho';
      render();
      aviso(guardar + doar > 0 ? 'Muito bem! Você repartiu 🫙' : 'Tudo no pote de gastar!', '🎉');
    };
    el('#rit-volta').onclick = () => { App.aba = 'cofrinho'; render(); };
  };
  desenhar();
}

/* ---------- Aba 2: tarefas ---------- */

function telaTarefas() {
  const kid = App.kid;
  const ts = Dados.tarefas(kid.id);
  const feitas = ts.filter(t => t.feita).length;

  if (!ts.length) {
    return `${palco('pensando')}${balao('Você ainda não tem tarefas. Peça para um adulto criar!')}
      <div class="vazio">As tarefas aparecem aqui quando um adulto cadastrar 📋</div>`;
  }

  const fala = feitas === ts.length
    ? 'Uhuul! Você fez tudo esta semana!'
    : feitas === 0 ? 'Toque na tarefa quando você fizer!'
      : `Já fez ${feitas} de ${ts.length}. Continua!`;

  return `
    ${palco(feitas === ts.length ? 'feliz' : 'oi', 110)}
    ${balao(fala)}
    ${ts.map(t => `
      <button class="tarefa ${t.feita ? (t.confirmada ? 'feita' : 'esperando') : ''}" data-tarefa="${t.id}">
        <span class="tarefa-ico">${esc(t.icon || '⭐')}</span>
        <span class="tarefa-txt">
          <b>${esc(t.name)}</b>
          <small>${Number(t.amount) > 0 ? `vale ${fmtKid(t.amount)}` : 'sem moeda, mas conta ponto!'}${t.feita && !t.confirmada ? ' · esperando conferir' : ''}</small>
        </span>
        <span class="tarefa-mar">${t.feita ? (t.confirmada ? '✓' : '⏳') : ''}</span>
      </button>`).join('')}
    <div class="vazio" style="font-size:14px">
      Um adulto confere o que você marcou. Aí a moeda cai no pote 🪙
    </div>`;
}

/* ---------- Aba 3: o sonho (a meta) ---------- */

function telaSonho() {
  const kid = App.kid;
  const meta = Dados.meta(kid.id);
  const p = Dados.potes(kid.id);

  if (!meta) {
    return `${palco('pensando')}
      ${balao('Você ainda não escolheu um sonho para guardar. Fale com um adulto!')}
      <div class="carta">
        <div class="vazio">Um sonho é uma coisa que você quer muito e que dá para comprar
        guardando um pouquinho toda semana 🌟</div>
      </div>`;
  }

  const alvo = Number(meta.target_amount) || 0;
  const pct = alvo > 0 ? Math.min(100, (p.guardar / alvo) * 100) : 0;
  const faltam = Dados.semanasParaMeta(kid.id);
  const chegou = pct >= 100;

  return `
    ${palco(chegou ? 'feliz' : 'oi', 110)}
    ${balao(chegou
      ? 'Você conseguiu! Já dá para comprar!'
      : faltam === null ? 'Continue guardando, falta pouquinho!'
        : faltam <= 1 ? 'Falta só uma semanada!'
          : `Faltam ${faltam} semanadas. Você consegue!`)}
    <div class="carta">
      <div class="meta-topo">
        <span class="meta-ico">${esc(meta.icon || '🎁')}</span>
        <span style="flex:1">
          <b style="font-size:20px">${esc(meta.name)}</b>
          <div class="meta-quanto">${fmtKid(p.guardar)} de ${fmtKid(alvo)}</div>
        </span>
        ${chegou ? Arte.trofeu() : ''}
      </div>
      <div class="meta-barra"><div class="meta-fill" style="width:${pct.toFixed(1)}%"></div></div>
      ${faltam !== null && faltam > 0 ? `
        <div class="pote-nome" style="text-align:left">quantas semanadas faltam</div>
        <div class="semanas">
          ${Array.from({ length: Math.min(20, faltam) }, () => '<span class="semana-pt"></span>').join('')}
        </div>` : ''}
    </div>
    <div class="carta">
      <div class="pote-nome" style="text-align:left;margin-bottom:6px">como chegar mais rápido</div>
      <div style="font-size:16px;line-height:1.5">
        Toda semanada, coloque um pouquinho no pote <b style="color:var(--guardar)">Guardar</b>.
        E se você não tirar nada dele durante a semana, ganha a <b>moeda mágica</b> ✨
      </div>
    </div>`;
}

/* ---------- Aba 4: os selos ---------- */

function telaSelos() {
  const selos = Dados.selos(App.kid.id);
  const n = selos.filter(s => s.ganho).length;
  return `
    ${palco(n >= 4 ? 'feliz' : 'oi', 110)}
    ${balao(n === 0 ? 'Ainda não tem prêmio esta semana. Bora conquistar!'
      : n === selos.length ? 'Você ganhou TODOS os prêmios! Incrível!'
        : `Você já tem ${n} ${n === 1 ? 'prêmio' : 'prêmios'} esta semana!`)}
    <div class="selos">
      ${selos.map(s => `
        <div class="selo ${s.ganho ? 'ganho' : ''}">
          ${Arte.estrela(s.ganho)}
          <b>${s.nome}</b>
          <small>${s.dica}</small>
        </div>`).join('')}
    </div>
    <div class="vazio" style="font-size:14px">
      Os prêmios recomeçam toda semana, no dia da sua semanada 🗓️
    </div>`;
}

/* ---------- Gastar e doar ---------- */

function telaGastar(pote) {
  const kid = App.kid;
  const p = Dados.potes(kid.id);
  const doando = pote === 'doar';
  let valor = 0, oque = '';
  const disponivel = p[doando ? 'doar' : 'gastar'];
  const sugestoes = [1, 2, 5, 10, 20].filter(v => v <= Math.max(1, disponivel));

  const desenhar = () => {
    raiz().innerHTML = `
      ${palco(valor > disponivel ? 'triste' : 'oi', 110)}
      ${balao(doando
        ? `Que legal doar! Você tem ${fmtKid(disponivel)} no pote de doar.`
        : `Quanto você gastou? Tem ${fmtKid(disponivel)} para gastar.`)}
      <div class="valor-mostra">${fmtKid(valor)}</div>
      <div class="chips">
        ${sugestoes.map(v => `<button class="chip ${valor === v ? 'on' : ''}" data-v="${v}">${fmtKid(v)}</button>`).join('')}
        <button class="chip" data-v="tudo">tudo (${fmtKid(disponivel)})</button>
        <button class="chip" data-v="zero">limpar</button>
      </div>
      <div class="carta">
        <div class="pote-nome" style="text-align:left;margin-bottom:8px">
          ${doando ? 'para quem você doou?' : 'o que você comprou?'}
        </div>
        <div class="chips" style="justify-content:flex-start">
          ${(doando
            ? [['🐶', 'Bichinhos'], ['🏥', 'Hospital'], ['🧒', 'Outra criança'], ['⛪', 'Igreja'], ['🌳', 'Natureza']]
            : [['🍭', 'Doce'], ['🧸', 'Brinquedo'], ['📚', 'Livro'], ['🎮', 'Jogo'], ['🍦', 'Sorvete'], ['✏️', 'Escola']]
          ).map(([e, n]) => `<button class="chip ${oque === n ? 'on' : ''}" data-o="${n}">${e} ${n}</button>`).join('')}
        </div>
      </div>
      <button class="bt ${doando ? 'rosa' : 'verde'}" id="conf" ${valor <= 0 || valor > disponivel ? 'disabled' : ''}>
        <span class="emo">${doando ? '💝' : '🛒'}</span>
        ${valor > disponivel ? 'Não tem tudo isso' : doando ? 'Doei!' : 'Gastei!'}
      </button>
      <button class="bt clara" id="volta" style="margin-top:12px"><span class="emo">↩️</span> Voltar</button>`;

    document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      Som.toque();
      const v = b.dataset.v;
      valor = v === 'tudo' ? disponivel : v === 'zero' ? 0 : +(valor + Number(v)).toFixed(2);
      desenhar();
    });
    document.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
      Som.toque(); oque = b.dataset.o; desenhar();
    });
    el('#conf').onclick = () => {
      const r = Dados.gastar(kid.id, doando ? 'doar' : 'gastar', valor, oque);
      if (!r.ok) {
        Som.nao();
        aviso(r.motivo === 'falta' ? 'Não tem tudo isso no pote' : 'Escolha um valor', '😕');
        return;
      }
      Nuvem.sincronizar();
      if (doando) festa(); else { Som.moeda(); vibra(20); }
      App.aba = 'cofrinho';
      render();
      aviso(doando ? 'Você doou! Que coração grande 💝' : 'Anotado no cofrinho!', '');
    };
    el('#volta').onclick = () => { App.aba = 'cofrinho'; render(); };
  };
  desenhar();
}

/* ---------- Cliques que valem em qualquer tela ---------- */

document.addEventListener('click', ev => {
  const alvo = ev.target.closest('[id], [data-tarefa], [data-pote]');
  if (!alvo || !App.kid) return;

  if (alvo.id === 'ir-ritual') return telaRitual();
  if (alvo.id === 'bt-gastar') { Som.toque(); return telaGastar('gastar'); }
  if (alvo.id === 'bt-doar') { Som.toque(); return telaGastar('doar'); }
  if (alvo.id === 'bt-sair') return sair();

  if (alvo.dataset && alvo.dataset.tarefa) {
    const t = Dados.tarefas(App.kid.id).find(x => x.id === alvo.dataset.tarefa);
    if (!t) return;
    if (t.feita && t.confirmada) { aviso('Essa já foi conferida! 🎉'); return; }
    if (t.feita) {
      Dados.desmarcarTarefa(App.kid.id, t.id);
      Som.toque();
      Nuvem.sincronizar();
      render();
      return;
    }
    Dados.marcarTarefa(App.kid.id, t.id);
    Som.moeda(); vibra(25);
    Nuvem.sincronizar();
    render();
    const restam = Dados.tarefas(App.kid.id).filter(x => !x.feita).length;
    if (restam === 0) { festa(); aviso('Você fez tudo! 🏅'); }
    else aviso('Boa! Agora um adulto vai conferir ✅');
    return;
  }

  // Tocar num pote conta o que ele significa: o app explica sozinho
  if (alvo.dataset && alvo.dataset.pote) {
    const falas = {
      gastar: 'Este é o dinheiro que você pode usar agora 🛒',
      guardar: 'Este cresce devagar e vira o seu sonho ⭐',
      doar: 'Este é para ajudar quem precisa 💝',
    };
    Som.toque();
    aviso(falas[alvo.dataset.pote]);
  }
});

/* ---------- Partida ---------- */

async function iniciar() {
  document.body.insertAdjacentHTML('afterbegin', Arte.cenario());
  Dados.carregar();
  Nuvem.carregar();

  // Abre com o que já está no aparelho — offline é o caso normal, não a exceção
  const salvo = sessionStorage.getItem('cofrinho.kid');
  const kid = salvo ? Dados.get('kids', salvo) : null;
  if (kid) { App.kid = kid; pintarDino(kid.cor); render(); } else telaQuem();

  const mudou = await Nuvem.sincronizar();
  if (mudou) { if (App.kid) render(); else telaQuem(); }

  /* De volta à tela, confere o que apareceu enquanto o app estava atrás — por
     dois caminhos, porque são dois de verdade:

     1. `Dados.carregar()` relê o armazém local. É por aqui que chega o que o
        adulto fez no app da família NO MESMO APARELHO, sem depender de rede:
        os dois apps moram na mesma origem e este armazém é o encontro deles
        (ver DB.ponteDoCofrinho, em js/db.js).
     2. A nuvem traz o que ele fez em OUTRO aparelho.

     Sem o primeiro, dar a semanada no celular do pai não apareceria no tablet
     dela até haver internet — e o caso comum é justamente os dois apps no mesmo
     aparelho, sem nuvem nenhuma configurada. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const antes = JSON.stringify(Dados.d);
    Dados.carregar();
    if (JSON.stringify(Dados.d) !== antes) { if (App.kid) render(); else telaQuem(); }
    Nuvem.sincronizar().then(m => { if (m) { if (App.kid) render(); else telaQuem(); } });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', iniciar);
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { App, fmtKid, diaBonito, hashDaSenha, telaQuem, render, telaGastar, telaRitual };
}
