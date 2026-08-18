/* Cofrinho — o app da criança.

   O QUE ESTE APP É: um cofrinho de vidro que ela abre para ver quanto tem,
   repartir a semanada, marcar o que fez e escolher no que gastar. Nada mais.

   O QUE ELE NÃO É, e por decisão: não tem saldo da família, não tem conta
   bancária, não tem lista do que os pais gastam. O adulto administra no app da
   família; aqui é o dinheiro DELA, e só.

   COMO A TELA CONVERSA. Toda tela tem o Dino dizendo uma frase curta em primeira
   pessoa e no imperativo suave — "escolha", "toque", "vamos repartir". Uma
   criança de seis anos entende instrução direta muito melhor do que rótulo
   nominal, e o balão do mascote é lido antes de qualquer título.

   TEMPO EM SEMANAS, dinheiro em reais inteiros sempre que der. "Faltam quatro
   semanadas" é uma frase que ela consegue planejar; "faltam R$ 43,50" não.
   --------------------------------------------------------------------------- */
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
   O silêncio existe porque nem todo lugar de usar o app aceita som. */
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
  toque() { this.nota(700, 0.07, 'triangle', 0.1); },
  moeda() { this.nota(880, 0.09, 'triangle'); setTimeout(() => this.nota(1320, 0.14, 'triangle'), 70); },
  festa() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => this.nota(f, 0.16, 'triangle'), i * 90)); },
  nao() { this.nota(190, 0.22, 'sawtooth', 0.1); },
};

function vibra(ms) { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (_) { } }

function aviso(txt, emo = '') {
  const antigo = el('.aviso'); if (antigo) antigo.remove();
  const d = document.createElement('div');
  d.className = 'aviso';
  d.textContent = (emo ? emo + ' ' : '') + txt;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2700);
}

function festa() {
  const antigo = el('.confete'); if (antigo) antigo.remove();
  document.body.insertAdjacentHTML('beforeend', Arte.confete());
  Som.festa(); vibra([25, 40, 25, 40, 60]);
  setTimeout(() => { const c = el('.confete'); if (c) c.remove(); }, 3200);
}

/* A MOEDA QUE VOA até o pote. É o que transforma "o número mudou" em "o dinheiro
   foi para ali" — a criança acompanha o objeto com os olhos e entende o destino
   sem ninguém explicar. */
function moedaVoando(deEl, paraEl) {
  if (!deEl || !paraEl) return;
  const a = deEl.getBoundingClientRect(), b = paraEl.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'moeda-voo';
  d.style.left = (a.left + a.width / 2 - 19) + 'px';
  d.style.top = (a.top + a.height / 2 - 19) + 'px';
  d.style.setProperty('--dx', (b.left + b.width / 2 - a.left - a.width / 2) + 'px');
  d.style.setProperty('--dy', (b.top + b.height / 2 - a.top - a.height / 2) + 'px');
  d.innerHTML = Arte.moeda(38);
  document.body.appendChild(d);
  Som.moeda();
  setTimeout(() => d.remove(), 950);
}

function balao(txt) { return `<div class="balao">${txt}</div>`; }
function palco(pose, tam = 150) { return `<div class="dino-palco">${Arte.dino(pose, tam)}</div>`; }

// A cor do Dino segue a cor da criança: o app vira dela na primeira olhada
function pintarDino(cor) {
  if (!cor) return;
  const r = document.documentElement.style;
  r.setProperty('--dino-1', cor);
  r.setProperty('--dino-2', sombrear(cor, -14));
  r.setProperty('--dino-3', sombrear(cor, -27));
  r.setProperty('--dino-luz', clarear(cor, 26));
  r.setProperty('--dino-barriga', clarear(cor, 84));
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
    Som.toque(); vibra(12);
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
      : 'Cadastre a criança no app da família, em <b>Configurações → Crianças</b>, e toque em procurar de novo.'}
    </div>
    <button class="bt clara" id="recarregar" style="margin-top:18px">
      <span class="emo">🔄</span> Procurar de novo
    </button>`;
  el('#recarregar').onclick = async () => {
    aviso('Procurando...', '🔎');
    Dados.carregar();
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
      ${palco('pensando', 122)}
      ${balao(`Oi, <b>${esc(kid.name)}</b>! Qual é a sua senha secreta?`)}
      <div class="bolinhas">${[0, 1, 2, 3].map(i => `<span class="bolinha" data-b="${i}"></span>`).join('')}</div>
      <div class="tecla-grade">
        ${teclas.map(t => t === 'vazia'
          ? '<button class="tecla vazia" tabindex="-1"></button>'
          : t === 'apagar'
            ? '<button class="tecla apagar" data-t="apagar" aria-label="Apagar">⌫</button>'
            : `<button class="tecla" data-t="${t}">${t}</button>`).join('')}
      </div>
      <button class="bt clara" id="voltar-quem" style="max-width:350px;margin-top:24px">
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
      const cad = el('.cadeado');
      if (cad) cad.classList.add('aberto');
      Som.moeda(); vibra(30);
      setTimeout(() => entrar(kid), 520);
      return;
    }
    /* ERROU: treme, apaga e o Dino fica triste — nunca uma mensagem de erro
       vermelha. Aos seis anos, errar a senha é comum, e o app não pode fazer
       disso um fracasso. Depois de três, oferece chamar um adulto sem culpa. */
    App._erros++;
    Som.nao(); vibra([70, 50, 70]);
    const tela = el('#senha-tela');
    if (tela) { tela.classList.add('errou'); setTimeout(() => tela.classList.remove('errou'), 500); }
    digitado = ''; pintarBolinhas();
    const p = el('.dino-palco');
    if (p) p.innerHTML = Arte.dino('triste', 122);
    const bl = el('.balao');
    if (bl) bl.innerHTML = App._erros >= 3
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

/* A barra é uma PÍLULA FLUTUANTE, longe da borda de baixo: ali é onde a mão
   apoia o tablet, e botão colado no canto dispara sozinho o tempo todo. */
function barraDeAbas() {
  const abertas = Dados.tarefas(App.kid.id).filter(x => !x.feita).length;
  const abas = [
    ['cofrinho', '🐷', 'Cofrinho', 0],
    ['tarefas', '✅', 'Missões', abertas],
    ['sonho', '⭐', 'Meu sonho', 0],
    ['selos', '🏆', 'Prêmios', 0],
  ];
  return `
    <div class="barra"><div class="barra-in">
      ${abas.map(([id, emo, nome, n]) => `
        <button class="aba ${App.aba === id ? 'on' : ''}" data-aba="${id}">
          <span class="emo">${emo}</span>
          <span>${nome}</span>
          ${n ? `<span class="aba-selo">${n}</span>` : ''}
        </button>`).join('')}
    </div></div>`;
}

function ligarAbas() {
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => {
    Som.toque(); vibra(10);
    App.aba = b.dataset.aba;
    render();
  });
}

/* ---------- Aba 1: o cofrinho ---------- */

function telaCofrinho() {
  const kid = App.kid;
  const p = Dados.potes(kid.id);
  const teto = Math.max(p.gastar, p.guardar, p.doar, 1);
  const ritual = Dados.aRepartir(kid.id);
  const aConfirmar = Dados.tarefas(kid.id).filter(t => t.feita && !t.confirmada).length;

  const fala = ritual
    ? (ritual.abertura
      ? 'Este dinheiro é seu! Onde você quer guardar?'
      : 'Chegou a sua semanada! Vamos repartir?')
    : p.total <= 0
      ? 'Seu cofrinho está vazinho. Logo enche!'
      : `Você tem <b>${fmtKid(p.total)}</b>. Que legal!`;

  return `
    ${palco(ritual ? 'uau' : p.total > 0 ? 'feliz' : 'dormindo')}
    ${balao(fala)}

    <div class="total">
      <span class="moeda-enfeite m-esq">${Arte.moeda(30)}</span>
      <span class="moeda-enfeite m-dir">${Arte.moeda(24)}</span>
      <span class="grana">${fmtKid(p.total)}</span>
      <small>é tudo o que você tem</small>
    </div>

    ${ritual ? `
      <button class="bt ouro chama" id="ir-ritual" style="margin-bottom:18px">
        <span class="emo">🎉</span> ${ritual.abertura ? 'Guardar meus' : 'Repartir'} ${fmtKid(ritual.valor)}
      </button>` : ''}

    <div class="potes">
      ${['gastar', 'guardar', 'doar'].map(t => `
        <div class="pote-bloco on-${t}" data-pote="${t}" id="pote-${t}">
          ${Arte.pote(t, p[t], teto)}
          <div class="pote-val">${fmtKid(p[t])}</div>
          <div class="pote-nome">${t === 'gastar' ? 'Gastar' : t === 'guardar' ? 'Guardar' : 'Doar'}</div>
        </div>`).join('')}
    </div>

    <div class="linha-bt" style="margin-top:18px">
      <button class="bt verde" id="bt-gastar"><span class="emo">🛒</span> Gastei</button>
      <button class="bt rosa" id="bt-doar"><span class="emo">💝</span> Doei</button>
    </div>

    ${aConfirmar ? `<div class="recado" style="margin-top:18px">
      <b>Quase lá!</b> ${aConfirmar === 1 ? 'Uma missão está' : `${aConfirmar} missões estão`}
      esperando um adulto conferir. Aí a moeda cai no seu pote 🪙
    </div>` : ''}

    <h2><span class="emo">📖</span> O que aconteceu</h2>
    ${historico(kid.id)}

    <button class="bt clara" id="bt-sair" style="margin-top:20px">
      <span class="emo">👋</span> Sair do meu cofrinho
    </button>`;
}

/* O histórico são FIGURINHAS, não linhas de lista: cada movimento é um cartão
   com o ícone num círculo colorido. Ela lê o desenho e a cor antes do texto, e
   é assim que o extrato dela vira algo de olhar em vez de algo de ler. */
function historico(kidId) {
  const movs = Dados.entradas(kidId).slice(0, 12);
  if (!movs.length) {
    return `<div class="carta"><div class="vazio">
      Nada ainda. Sua primeira semanada vai aparecer aqui 🪙
    </div></div>`;
  }
  const tipos = {
    semanada: ['🪙', 'fg-ouro'], tarefa: ['✅', 'fg-entrada'], rendimento: ['✨', 'fg-ouro'],
    presente: ['🎁', 'fg-ouro'], gasto: ['🛒', 'fg-saida'], doacao: ['💝', 'fg-doar'],
    /* O que ela já tinha quando o cofrinho começou. Bandeirinha de largada, porque
       para a criança é o marco de "aqui eu comecei" — e sem entrada própria este
       lançamento cairia no ícone genérico, sem dizer o que é. */
    inicial: ['🏁', 'fg-guardar'],
  };
  return movs.map(e => {
    const saida = e.tipo === 'gasto' || e.tipo === 'doacao';
    const v = Number(e.amount) || 0;
    /* A divisão que sai do pote gastar é repasse interno: mostra sem sinal,
       porque para ela o dinheiro não sumiu, só mudou de pote. */
    const interno = e.tipo === 'divisao';
    let ico = '🪙', cor = 'fg-ouro';
    if (interno) {
      ico = '🫙';
      cor = e.pote === 'guardar' ? 'fg-guardar' : e.pote === 'doar' ? 'fg-doar' : 'fg-entrada';
    } else if (tipos[e.tipo]) {
      [ico, cor] = tipos[e.tipo];
    }
    return `<div class="figurinha">
      <div class="figurinha-ico ${cor}">${ico}</div>
      <div class="figurinha-txt">
        <b>${esc(e.description || e.tipo)}</b>
        <small>${diaBonito(e.date)}${interno ? ' · trocou de pote' : ''}</small>
      </div>
      <div class="figurinha-val ${interno ? 'troca' : saida ? 'menos' : 'mais'}">
        ${interno ? '' : saida ? '−' : '+'}${fmtKid(Math.abs(v))}
      </div>
    </div>`;
  }).join('');
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
  const r = Dados.aRepartir(kid.id);
  if (!r) { render(); return; }
  const total = r.valor;
  // A regra do passo vive em Dados, para poder ser medida — ver passoDoRitual
  const passo = Dados.passoDoRitual(total);
  let guardar = 0, doar = 0;

  const desenhar = () => {
    const gastar = +(total - guardar - doar).toFixed(2);
    const teto = Math.max(gastar, guardar, doar, 1);
    raiz().innerHTML = `
      ${palco('uau', 138)}
      ${balao(r.abertura
        ? 'Este dinheiro é todo seu! Quanto você quer <b>guardar</b> e quanto quer <b>doar</b>?'
        : 'Chegou a sua semanada! Quanto você quer <b>guardar</b> e quanto quer <b>doar</b>?')}
      <div class="ritual-valor">${fmtKid(total)}</div>
      <div class="reparte">
        ${[['gastar', gastar, 'Gastar', false], ['guardar', guardar, 'Guardar', true], ['doar', doar, 'Doar', true]]
        .map(([t, v, nome, mexe]) => `
          <div class="rep-col on-${t}" id="rep-${t}">
            ${Arte.pote(t, v, teto, 'rep-' + t)}
            <div class="rep-n">${fmtKid(v)}</div>
            <div class="pote-nome">${nome}</div>
            ${mexe ? `<div class="rep-bts" style="margin-top:8px">
              <!-- O botão DIZ QUANTO SOMA. Com passo variável — R$ 1 numa semanada
                   pequena, R$ 5 num saldo de abertura grande — um "+" sozinho esconde
                   a regra: a criança toca e o número salta cinco sem ela entender por
                   quê. Mostrar o passo também é o que torna a regra verificável. -->
              <button class="rep-bt menos" data-menos="${t}" data-passo="${passo}" ${v <= 0 ? 'disabled' : ''}>−${fmtKid(passo).replace('R$ ', '')}</button>
              <button class="rep-bt" data-mais="${t}" data-passo="${passo}" ${gastar < passo ? 'disabled' : ''}>+${fmtKid(passo).replace('R$ ', '')}</button>
            </div>` : '<div style="height:10px"></div>'}
          </div>`).join('')}
      </div>
      <button class="bt ouro" id="rit-ok" style="margin-top:22px">
        <span class="emo">🫙</span> Pronto, guardei!
      </button>
      <button class="bt clara" id="rit-volta" style="margin-top:12px">
        <span class="emo">↩️</span> Faço depois
      </button>`;

    document.querySelectorAll('[data-mais]').forEach(b => b.onclick = () => {
      const alvo = b.dataset.mais;
      if (total - guardar - doar < passo) return;
      moedaVoando(el('#rep-gastar'), el('#rep-' + alvo));
      vibra(15);
      if (alvo === 'guardar') guardar = +(guardar + passo).toFixed(2); else doar = +(doar + passo).toFixed(2);
      setTimeout(desenhar, 360);
    });
    document.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => {
      const alvo = b.dataset.menos;
      Som.toque(); vibra(10);
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
      aviso(guardar + doar > 0
        ? (r.abertura ? 'Pronto! Seu cofrinho está montado 🫙' : 'Muito bem! Você repartiu 🫙')
        : 'Tudo no pote de gastar!', '🎉');
    };
    el('#rit-volta').onclick = () => { App.aba = 'cofrinho'; render(); };
  };
  desenhar();
}

/* ---------- Aba 2: missões ---------- */

function telaTarefas() {
  const kid = App.kid;
  const ts = Dados.tarefas(kid.id);
  const feitas = ts.filter(t => t.feita).length;

  if (!ts.length) {
    return `${palco('pensando')}
      ${balao('Você ainda não tem missões. Peça para um adulto criar!')}
      <div class="carta"><div class="vazio">
        As missões aparecem aqui quando um adulto cadastrar 📋
      </div></div>`;
  }

  const tudo = feitas === ts.length;
  const fala = tudo
    ? 'Uhuul! Você fez tudo esta semana!'
    : feitas === 0 ? 'Toque na missão quando você fizer!'
      : `Já fez <b>${feitas} de ${ts.length}</b>. Continua!`;

  return `
    ${palco(tudo ? 'feliz' : 'oi', 128)}
    ${balao(fala)}
    <div class="missao-conta">
      <span class="n">${feitas}</span> de <span class="n">${ts.length}</span> missões desta semana
    </div>
    ${ts.map(t => `
      <button class="missao ${t.feita ? (t.confirmada ? 'feita' : 'esperando') : ''}" data-tarefa="${t.id}">
        <span class="missao-ico">${esc(t.icon || '⭐')}</span>
        <span class="missao-txt">
          <b>${esc(t.name)}</b>
          ${Number(t.amount) > 0
            ? `<span class="missao-vale">${Arte.moeda(19)} ${fmtKid(t.amount)}</span>`
            : '<small>sem moeda, mas conta ponto!</small>'}
          ${t.feita && !t.confirmada ? '<small>esperando um adulto conferir</small>' : ''}
        </span>
        <span class="missao-mar">
          ${t.feita ? (t.confirmada ? Arte.checkOuro() : Arte.ampulheta()) : ''}
        </span>
      </button>`).join('')}
    <div class="vazio" style="font-size:15px">
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
      <div class="carta"><div class="vazio">
        Um sonho é uma coisa que você quer muito e que dá para comprar
        guardando um pouquinho toda semana 🌟
      </div></div>`;
  }

  const alvo = Number(meta.target_amount) || 0;
  const pct = alvo > 0 ? Math.min(100, (p.guardar / alvo) * 100) : 0;
  const faltam = Dados.semanasParaMeta(kid.id);
  const chegou = pct >= 100;

  return `
    ${palco(chegou ? 'feliz' : 'oi', 128)}
    ${balao(chegou
      ? 'Você conseguiu! Já dá para comprar!'
      : faltam === null ? 'Continue guardando, falta pouquinho!'
        : faltam <= 1 ? 'Falta só <b>uma semanada</b>!'
          : `Faltam <b>${faltam} semanadas</b>. Você consegue!`)}

    <div class="sonho-card">
      <div class="sonho-topo">
        <span class="sonho-ico">${esc(meta.icon || '🎁')}</span>
        <span style="flex:1">
          <div class="sonho-nome">${esc(meta.name)}</div>
          <div class="sonho-quanto">${fmtKid(p.guardar)} <small>de ${fmtKid(alvo)}</small></div>
        </span>
      </div>
      <div class="trilha">${Arte.trilha(pct, meta.icon || '🎁')}</div>
      ${faltam !== null && faltam > 0 ? `
        <div class="pote-nome" style="text-align:center;margin-top:10px">quantas semanadas faltam</div>
        <div class="semanas">
          ${Array.from({ length: Math.min(20, faltam) }, () => '<span class="semana-pt"></span>').join('')}
        </div>` : ''}
    </div>

    <div class="carta">
      <div style="font-size:17px;line-height:1.55">
        <b>Como chegar mais rápido</b><br>
        Toda semanada, coloque um pouquinho no pote
        <b style="color:var(--guardar-fundo)">Guardar</b>.
        E se você não tirar nada dele durante a semana, ganha a <b>moeda mágica</b> ✨
      </div>
    </div>`;
}

/* ---------- Aba 4: os prêmios ---------- */

function telaSelos() {
  const selos = Dados.selos(App.kid.id);
  const n = selos.filter(s => s.ganho).length;
  return `
    ${palco(n >= 4 ? 'feliz' : 'oi', 128)}
    ${balao(n === 0 ? 'Ainda não tem prêmio esta semana. Bora conquistar!'
      : n === selos.length ? 'Você ganhou <b>TODOS</b> os prêmios! Incrível!'
        : `Você já tem <b>${n} ${n === 1 ? 'prêmio' : 'prêmios'}</b> esta semana!`)}
    <div class="premios">
      ${selos.map(s => `
        <div class="premio ${s.ganho ? 'ganho' : ''}">
          <span class="premio-trava">
            ${Arte.premio(s.id, s.ganho)}
            ${s.ganho ? '' : Arte.cadeadoMini()}
          </span>
          <b>${s.nome}</b>
          <small>${s.dica}</small>
        </div>`).join('')}
    </div>
    <div class="vazio" style="font-size:15px">
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
    const demais = valor > disponivel;
    raiz().innerHTML = `
      ${palco(demais ? 'triste' : 'oi', 122)}
      ${balao(doando
        ? `Que legal doar! Você tem <b>${fmtKid(disponivel)}</b> no pote de doar.`
        : `Quanto você gastou? Tem <b>${fmtKid(disponivel)}</b> para gastar.`)}
      <div class="valor-mostra ${demais ? 'demais' : ''}">${fmtKid(valor)}</div>
      <div class="chips">
        ${sugestoes.map(v => `<button class="chip ${valor === v ? 'on' : ''}" data-v="${v}">
          ${Arte.moeda(22)} ${fmtKid(v)}</button>`).join('')}
        <button class="chip" data-v="tudo">tudo (${fmtKid(disponivel)})</button>
        <button class="chip" data-v="zero">limpar</button>
      </div>
      <div class="carta">
        <div class="pote-nome" style="text-align:left;margin-bottom:10px">
          ${doando ? 'para quem você doou?' : 'o que você comprou?'}
        </div>
        <div class="chips" style="justify-content:flex-start;margin-bottom:0">
          ${(doando
            ? [['🐶', 'Bichinhos'], ['🏥', 'Hospital'], ['🧒', 'Outra criança'], ['⛪', 'Igreja'], ['🌳', 'Natureza']]
            : [['🍭', 'Doce'], ['🧸', 'Brinquedo'], ['📚', 'Livro'], ['🎮', 'Jogo'], ['🍦', 'Sorvete'], ['✏️', 'Escola']]
          ).map(([e, n]) => `<button class="chip ${oque === n ? 'on' : ''}" data-o="${n}">${e} ${n}</button>`).join('')}
        </div>
      </div>
      <button class="bt ${doando ? 'rosa' : 'verde'}" id="conf" ${valor <= 0 || demais ? 'disabled' : ''}>
        <span class="emo">${doando ? '💝' : '🛒'}</span>
        ${demais ? 'Não tem tudo isso' : doando ? 'Doei!' : 'Gastei!'}
      </button>
      <button class="bt clara" id="volta" style="margin-top:12px"><span class="emo">↩️</span> Voltar</button>`;

    document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      Som.toque(); vibra(10);
      const v = b.dataset.v;
      valor = v === 'tudo' ? disponivel : v === 'zero' ? 0 : +(valor + Number(v)).toFixed(2);
      desenhar();
    });
    document.querySelectorAll('[data-o]').forEach(b => b.onclick = () => {
      Som.toque(); vibra(10); oque = b.dataset.o; desenhar();
    });
    el('#conf').onclick = () => {
      const r = Dados.gastar(kid.id, doando ? 'doar' : 'gastar', valor, oque);
      if (!r.ok) {
        Som.nao(); vibra([60, 40, 60]);
        aviso(r.motivo === 'falta' ? 'Não tem tudo isso no pote' : 'Escolha um valor', '😕');
        return;
      }
      Nuvem.sincronizar();
      if (doando) festa(); else { Som.moeda(); vibra(25); }
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
