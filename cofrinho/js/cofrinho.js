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
  const metaAqui = Dados.meta(kid.id);
  const alvoAqui = metaAqui ? (Number(metaAqui.target_amount) || 0) : 0;
  const pctAqui = alvoAqui > 0 ? Math.min(100, (p.guardar / alvoAqui) * 100) : 0;
  const faltamAqui = metaAqui ? Dados.semanasParaMeta(kid.id) : null;
  const chegouAqui = pctAqui >= 100;

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
      </button>`
      /* SEM CONVITE, MAS COM DINHEIRO EM GASTAR: o botão continua ali, discreto.

         Faltava por completo. Se a criança deixasse tudo em gastar, ou se o convite
         não abrisse, não havia caminho nenhum para depois decidir guardar — e "hoje
         eu quero guardar isso" é exatamente a decisão que o app existe para
         incentivar. Recusá-la ensinava que guardar só vale no instante em que o
         dinheiro cai. */
      : Dados.podeRepartir(kid.id) ? `
      <button class="bt clara" id="ir-ritual" style="margin-bottom:18px">
        <span class="emo">🫙</span> Quero guardar um pouco
      </button>` : ''}

    <div class="potes">
      ${['gastar', 'guardar', 'doar'].map(t => `
        <div class="pote-bloco on-${t}" data-pote="${t}" id="pote-${t}">
          ${Arte.pote(t, p[t], teto)}
          <div class="pote-val">${fmtKid(p[t])}</div>
          <div class="pote-nome">${t === 'gastar' ? 'Gastar' : t === 'guardar' ? 'Guardar' : 'Doar'}</div>
          ${/* O QUE O TOQUE FAZ, escrito no próprio pote. Sem isto o pote é só um
               número, e descobrir que ele é tocável não é tarefa de uma criança de
               seis anos — foi o mesmo motivo da faixa no pergaminho. */''}
          <div class="pote-acao${p[t] > 0 ? '' : ' vazio'}">${p[t] > 0
            ? (t === 'gastar' ? '🛒 gastei' : t === 'guardar' ? '🏦 usar' : '💝 doei')
            : 'vazio'}</div>
        </div>`).join('')}
    </div>

    ${/* O SONHO NA PRIMEIRA TELA, e não escondido numa aba.

         O pote de guardar mostrava um número e mais nada: R$ 30 não diz se ela
         está perto ou longe da bicicleta, e é a distância que dá sentido a guardar.
         Sem isso o pote vira uma pilha que cresce sem destino — exatamente o
         oposto do que ele existe para ensinar.

         Fica COLADO no pote de guardar, porque é dele que o dinheiro sai, e leva a
         barra e a conta em semanadas — a mesma da aba do sonho, para os dois
         números nunca discordarem. */
      metaAqui ? `
      <button class="sonho-mini" data-ir-sonho="1">
        <span class="sonho-mini-ico">${esc(metaAqui.icon || '🎁')}</span>
        <span class="sonho-mini-txt">
          <b>${esc(metaAqui.name)}</b>
          <span class="sonho-mini-barra">
            <i style="width:${pctAqui.toFixed(1)}%"></i>
            ${marcosDaMeta(metaAqui, kid)}
          </span>
          <small>${chegouAqui
            ? 'Já dá para comprar! 🎉'
            : faltamAqui === null
              ? `${fmtKid(p.guardar)} de ${fmtKid(metaAqui.target_amount)}`
              : faltamAqui <= 1
                ? `Falta 1 semanada — ${fmtKid(p.guardar)} de ${fmtKid(metaAqui.target_amount)}`
                : `Faltam ${faltamAqui} semanadas — ${fmtKid(p.guardar)} de ${fmtKid(metaAqui.target_amount)}`
          }</small>
        </span>
        <span class="sonho-mini-chev">›</span>
      </button>` : ''}

    ${/* OS TRÊS BOTÕES SAÍRAM: eram alvos repetindo o que os potes já são.

         Duplicar a ação em dois lugares custava meia tela de rolagem e ainda ensinava
         que o pote é enfeite — quando ele é o objeto central do app, a coisa que a
         criança aponta quando conta como funciona. Agora o pote É o botão. */''}


    ${aConfirmar ? `<div class="recado" style="margin-top:18px">
      <b>Quase lá!</b> ${aConfirmar === 1 ? 'Uma missão está' : `${aConfirmar} missões estão`}
      esperando um adulto conferir. Aí a moeda cai no seu pote 🪙
    </div>` : ''}

    <h2><span class="emo">📖</span> O que aconteceu</h2>
    ${/* SÓ OS ÚLTIMOS TRÊS na primeira tela. A lista inteira empurrava os potes e
         os botões para fora da dobra: quem abre o cofrinho quer ver quanto tem e
         decidir o que fazer, não ler doze linhas de extrato. O resto continua a um
         toque, em tela própria — nada foi escondido, só realocado. */''}
    ${historico(kid.id, 3)}
    ${Dados.entradas(kid.id).length > 3 ? `
      <button class="bt clara" id="bt-extrato" style="margin-top:6px">
        <span class="emo">📖</span> Ver tudo o que aconteceu
      </button>` : ''}

    <button class="bt clara" id="bt-sair" style="margin-top:20px">
      <span class="emo">👋</span> Sair do meu cofrinho
    </button>`;
}

/* O histórico são FIGURINHAS, não linhas de lista: cada movimento é um cartão
   com o ícone num círculo colorido. Ela lê o desenho e a cor antes do texto, e
   é assim que o extrato dela vira algo de olhar em vez de algo de ler. */
function historico(kidId, limite) {
  const movs = Dados.entradas(kidId).slice(0, limite || 200);
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
        <small>${diaBonito(e.date)}${interno ? ' · trocou de pote' : ''}${
          e.confirmada === false ? ' · esperando um adulto ⏳' : ''}</small>
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
  /* SEM CONVITE PENDENTE, reparte o que está no pote gastar.

     A tela era acessível só pelo convite, e por isso morria com ele. Agora ela
     responde à pergunta "quanto do que tenho eu quero guardar?", que é válida em
     qualquer dia — e o teto é sempre o saldo do pote, nunca o valor de um
     lançamento antigo. Foi assim que o mesmo dinheiro foi repartido duas vezes. */
  const disponivel = Dados.potes(kid.id).gastar;
  if (!(disponivel > 0)) { render(); return; }
  const abertura = !!(r && r.abertura);
  /* Math.min com o saldo, embora aRepartir ja limite: sao duas barreiras para a
     mesma promessa falsa, e a redundancia e de proposito. Um teste que reprovasse
     a remocao desta linha estaria exigindo a implementacao em vez do que a crianca
     ve — e o que ela ve continua certo com qualquer uma das duas. */
  const total = r ? Math.min(r.valor, disponivel) : disponivel;
  /* Passo de R$ 1 sempre que der: contar moedas de um real é a conta que ela faz.
     A regra do passo vive em Dados, para poder ser medida — ver passoDoRitual. */
  const passo = Dados.passoDoRitual(total);
  let guardar = 0, doar = 0;
  const desenhar = () => {
    const gastar = +(total - guardar - doar).toFixed(2);
    const teto = Math.max(gastar, guardar, doar, 1);
    raiz().innerHTML = `
      ${palco('uau', 138)}
      ${balao(abertura
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
        ? (abertura ? 'Pronto! Seu cofrinho está montado 🫙' : 'Muito bem! Você repartiu 🫙')
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

  /* O QUE CONTA COMO "FEITA" DEPENDE DA FREQUÊNCIA.

     Semanal: feita é feita. Diária: feita HOJE — porque amanhã o cachorro tem
     sede de novo. Somar os dois no mesmo contador daria "3 de 3" numa segunda em
     que ela ainda tem seis dias de compromisso pela frente. */
  /* AS ESPECIAIS SAEM DA CONTA DO DIA A DIA. Elas não são rotina: somá-las ao
     "3 de 3 de hoje" faria o contador dizer que ela está devendo algo que só
     precisa acontecer até domingo. */
  const especiais = Dados.missoesEspeciais(kid.id);
  const semanais = ts.filter(x => !x.diaria && !x.especial);
  const diarias = ts.filter(x => x.diaria);
  const semanaisFeitas = semanais.filter(x => x.feita).length;
  const diariasHoje = diarias.filter(x => x.feita).length;
  const faltamHoje = (semanais.length - semanaisFeitas) + (diarias.length - diariasHoje);

  const fala = faltamHoje === 0
    ? 'Uhuul! Você fez tudo o que era de hoje!'
    : faltamHoje === ts.length ? 'Toque na missão quando você fizer!'
      : `Falta${faltamHoje > 1 ? 'm' : ''} <b>${faltamHoje}</b>. Você consegue!`;

  /* OS SETE DIAS EM BOLINHAS: é a leitura que funciona antes de saber contar.

     Cheia = cuidou. Vazia com o dia já passado = falhou, e a bolinha mostra isso
     sem texto de reprovação. O dia de HOJE tem anel, para ela achar onde está. */
  const trilhaDias = t => t.dias.map(d => `<span class="dia-pt${
    d.marcada ? ' ja' : d.passou ? ' perdeu' : ''}${d.hoje ? ' hoje' : ''}"></span>`).join('');

  const cardDiaria = t => `
    <button class="missao diaria ${t.feita ? 'feita-hoje' : ''} ${t.completou ? 'completa' : ''}" data-tarefa="${t.id}">
      <span class="missao-ico">${esc(t.icon || '⭐')}</span>
      <span class="missao-txt">
        <b>${esc(t.name)}</b>
        <span class="dias-trilha">${trilhaDias(t)}</span>
        <small>${t.feitos} de 7 dias${
          Number(t.amount) > 0 ? ` · a semana toda vale ${fmtKid(t.amount)}` : ''}</small>
        ${t.completou && t.bonusId && !t.bonusPago
          ? '<small>semana completa! esperando um adulto conferir ⏳</small>' : ''}
        ${t.bonusPago ? '<small>semana completa e paga! 🎉</small>' : ''}
      </span>
      <span class="missao-mar">
        ${t.completou ? Arte.checkOuro() : t.feita ? Arte.checkDia() : ''}
      </span>
    </button>`;

  /* O PERGAMINHO: a missão especial precisa PARECER especial.

     Um card igual aos outros diria "mais uma tarefa". As bordas rasgadas, o papel
     amarelado e o selo de cera dizem "isto é diferente" antes de qualquer texto —
     que é como uma criança de seis anos lê uma tela.

     E o prazo aparece em LUAS, uma por noite de sono, com a palavra ao lado. Sem
     relógio e sem número correndo: a criança precisa saber quanto tempo tem, não
     sentir que está atrasada. */
  const cardEspecial = t => `
    <button class="missao especial ${t.feita ? (t.confirmada ? 'feita' : 'esperando') : ''}"
            data-tarefa="${t.id}">
      ${Arte.pergaminho()}
      <span class="pg-selo">${Arte.selo()}</span>
      <span class="pg-topo">
        <span class="missao-ico">${esc(t.icon || '⭐')}</span>
        <span class="pg-nome">
          <b>${esc(t.name)}</b>
          ${Number(t.amount) > 0
            ? `<span class="missao-vale">${Arte.moeda(19)} ${fmtKid(t.amount)}</span>`
            : '<small>sem moeda, mas conta ponto!</small>'}
        </span>
      </span>
      ${t.feita
        ? `<span class="pg-estado">${t.confirmada
            ? `${Arte.checkOuro()} <span>Conquistada!</span>`
            : `${Arte.ampulheta()} <span>Esperando um adulto conferir</span>`}</span>`
        : `<span class="pg-prazo">
             <span class="luas">${Arte.luas(t.noites)}</span>
             <span>${esc(t.prazo || '')}</span>
           </span>
           <span class="pg-acao">👆 Toque aqui quando fizer</span>`}
    </button>`;

  const cardSemanal = t => `
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
    </button>`;

  return `
    ${palco(faltamHoje === 0 ? 'feliz' : 'oi', 128)}
    ${balao(fala)}
    ${especiais.length ? `<div class="missao-conta especial-cab">
      <span class="emo">🗺️</span> ${especiais.length > 1 ? 'Missões especiais' : 'Missão especial'}
    </div>` : ''}
    ${especiais.map(cardEspecial).join('')}
    ${diarias.length ? `<div class="missao-conta">
      <span class="n">${diariasHoje}</span> de <span class="n">${diarias.length}</span> de hoje
    </div>` : ''}
    ${diarias.map(cardDiaria).join('')}
    ${semanais.length ? `<div class="missao-conta">
      <span class="n">${semanaisFeitas}</span> de <span class="n">${semanais.length}</span> desta semana
    </div>` : ''}
    ${semanais.map(cardSemanal).join('')}
    <div class="vazio" style="font-size:15px">
      ${diarias.length
        ? 'As de todo dia pagam quando você cuidar a semana toda 🗓️'
        : 'Um adulto confere o que você marcou. Aí a moeda cai no pote 🪙'}
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
  const aguardando = Dados.metaAguardando(kid.id);

  return `
    ${palco(chegou ? 'feliz' : 'oi', 128)}
    ${balao(chegou
      ? (aguardando
        ? 'Você pediu! Falta um adulto confirmar 🎉'
        : 'Você conseguiu! Já dá para comprar!')
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
      ${/* CHEGOU: a hora de comprar. É o fim da história que a barra vinha contando.
           Sem este botão o app enchia a barra, tocava o confete e não deixava
           realizar — ensinando a acumular em vez de planejar. Guardar sem nunca
           realizar é privação com gráfico bonito. */
        aguardando ? `
      <div class="recado" style="margin-top:16px">
        <b>Já pedi!</b> Um adulto vai confirmar a compra do seu
        ${esc(meta.name)} — aí ele é seu de verdade 🎉
      </div>`
        : chegou ? `
      <button class="bt ouro chama" id="bt-comprar-sonho" style="margin-top:16px">
        <span class="emo">🎉</span> Comprar meu ${esc(meta.name)}
      </button>` : ''}
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

/* ---------- O extrato inteiro, em tela própria ---------- */
/* OS MARCOS DA META: um traço por semanada, dividindo a barra.

   A barra lisa diz "mais ou menos na metade", e "mais ou menos" não é uma leitura que
   uma criança de seis anos consiga fazer — ela ainda não converte comprimento em
   quantidade. Com os traços a pergunta vira contar: três blocos cheios, três vazios.
   Contar ela sabe, e cada bloco cheio é uma semanada que já passou.

   A divisão é por SEMANADA, a mesma unidade do texto ao lado, para os dois dizerem a
   mesma coisa de dois jeitos. Acima de dez a divisão vira listra e para de informar,
   então some — e o texto continua dando o número exato. */
function marcosDaMeta(meta, kid) {
  const alvo = Number(meta.target_amount) || 0;
  const porSemana = (Number(kid.semanada_valor) || 0)
    + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);
  const total = Math.ceil(alvo / porSemana);
  /* UM PORTÃO SÓ, a faixa, e ele já cobre os casos degenerados: sem semanada a divisão
     dá Infinity, alvo zero dá zero, e nenhum dos dois cabe entre 2 e 10.

     NaN (zero dividido por zero) escapa da faixa, porque toda comparação com NaN é
     falsa -- quem segura é o laço logo abaixo: `n < NaN` nunca é verdade, então não sai
     traço nenhum. Guardas extras aqui só dariam a impressão de proteção: nenhum teste
     consegue matá-las, porque nenhuma delas muda a saída.

     Acima de dez a divisão vira listra e para de informar, então some -- e o texto ao
     lado continua dando o número exato. */
  if (total < 2 || total > 10) return '';
  let out = '';
  for (let n = 1; n < total; n++) out += `<u style="left:${(n / total * 100).toFixed(2)}%"></u>`;
  return out;
}


/* A LISTA INTEIRA MERECE UMA TELA, e não o rodapé da inicial.

   Na tela do cofrinho ela empurrava os potes e os botões para fora da dobra: quem
   abre o app quer ver quanto tem e decidir o que fazer. Aqui a lista é a única
   coisa, com espaço para rolar e um caminho claro de volta. */
function telaExtrato() {
  const kid = App.kid;
  const movs = Dados.entradas(kid.id);
  raiz().innerHTML = `
    ${palco('oi', 110)}
    ${balao(movs.length
      ? `Tudo o que já aconteceu no seu cofrinho!`
      : 'Ainda não aconteceu nada por aqui.')}
    ${historico(kid.id)}
    <button class="bt clara" id="ex-volta" style="margin-top:14px">
      <span class="emo">↩️</span> Voltar
    </button>`;
  el('#ex-volta').onclick = () => { Som.toque(); App.aba = 'cofrinho'; render(); };
}

/* ---------- As duas estradas: o custo de oportunidade ---------- */

/* Tirar do pote de guardar não é errado — é o dinheiro dela, e o app não faz cara
   feia para quem gasta o que é seu. Mas é uma escolha com consequência, e a
   consequência é INVISÍVEL: o sorvete acontece hoje e o atraso do patinete só se
   sente daqui a três semanas. Aos seis anos esse intervalo é longo demais para a
   ligação se formar sozinha.

   Então as duas estradas aparecem lado a lado, com o preço à vista, e as duas são
   tocáveis. O Dino fica PENSANDO, não triste: isto é uma decisão, não um erro — e
   um mascote de cara fechada transformaria escolher em culpa.

   O que a tela NÃO faz: chamar o desejo dela de bobagem. Para ela o sorvete não é
   fútil, é o que ela quer. O app mostra a troca; julgar o desejo ensinaria que
   querer coisas é errado, e forma o adulto que não consegue se permitir nada. */
function telaEscolha(pote, valor, oque, aoSeguir) {
  const kid = App.kid;
  /* SÓ O QUE SAI DO GUARDADO tem custo de oportunidade. Gastar do pote de gastar não
     adia sonho nenhum — aquele dinheiro nunca foi do patinete —, e a função recebia o
     pote sem olhar para ele: uma compra comum abria a tela de escolha e virava
     obstáculo onde não havia troca. */
  if (pote !== 'guardar') { aoSeguir(); return; }

  /* QUALQUER SAQUE DO GUARDADO PARA AQUI, e não só o que adia o sonho.

     O pote de guardar existe para ser dinheiro que ela decidiu não gastar. Se dá para
     tirar de lá com os mesmos toques do pote de gastar, os dois são o mesmo pote com
     cores diferentes — e a parada é justamente o que faz o guardado significar algo.

     O que muda de caso para caso é a CONSEQUÊNCIA mostrada, porque ela tem de ser
     verdade: dizer "vai atrasar o seu sonho" quando não atrasa ensina que o app
     exagera, e no dia do atraso real ela não acredita. */
  const c = Dados.consequenciaDoSaque(kid.id, valor);
  if (!c) { aoSeguir(); return; }              // valor zerado: não há saque a decidir
  const semanas = n => `${n} ${n === 1 ? 'semanada' : 'semanadas'}`;

  /* ZERO SEMANADAS NÃO É UM NÚMERO, é um estado: o dinheiro já dá para comprar.

     A foto pegou "PATINETE EM 0 SEMANADAS", que aos seis anos não quer dizer nada — ou
     pior, lê como "nunca". Quando falta zero, a frase é a conquista. */
  const quando = n => (n > 0 ? `em<b>${semanas(n)}</b>` : `<b>já dá para comprar</b>`);

  /* O DESFECHO DE CADA ESTRADA, na forma mais verdadeira disponível.

     A ordem é a da informação mais útil para a idade: uma data que muda vale mais que
     um saldo que muda, porque "daqui a quantas semanadas" é a pergunta que ela faz.
     Quando não há data, o saldo é o que sobra de concreto. */
  let fimAgora, fimEspero, pergunta;

  if (c.meta && c.atraso > 0) {
    // ATRASA: o caso mais forte, e o único que existia antes.
    pergunta = `Esse dinheiro é do seu <b>${esc(c.meta.name)}</b>. Quer usar mesmo assim?`;
    fimAgora = `${esc(c.meta.icon || '🎁')} demora<b>+${semanas(c.atraso)}</b>`;
    fimEspero = `${esc(c.meta.name)} ${quando(c.antes)}`;
  } else if (c.meta && c.antes !== null) {
    /* NÃO ATRASA, e o app DIZ isso. O saque cabe na sobra do arredondamento, então a
       data do sonho é a mesma nas duas estradas — e contar a verdade aqui é o que
       torna o "+2 semanadas" do outro caso digno de crédito. */
    pergunta = `Esse dinheiro é do seu <b>${esc(c.meta.name)}</b>. Quer usar um pouco?`;
    /* SE JÁ DAVA PARA COMPRAR e continua dando, é isso que importa — não a data, que
       nas duas estradas é hoje. */
    fimAgora = c.antes === 0
      ? `${esc(c.meta.icon || '🎁')}<b>ainda dá para comprar</b>`
      : `${esc(c.meta.icon || '🎁')} chega no<b>mesmo dia</b>`;
    fimEspero = `${esc(c.meta.name)} ${quando(c.antes)}`;
  } else if (c.meta) {
    /* TEM SONHO, MAS NÃO HÁ RITMO para projetar data — inventar uma seria mentir sobre
       um dia que o app não conhece. Então a comparação é em dinheiro. */
    pergunta = `Esse dinheiro é do seu <b>${esc(c.meta.name)}</b>. Quer usar um pouco?`;
    fimAgora = `fica<b>${fmtKid(c.sobra)} de ${fmtKid(c.alvo)}</b>`;
    fimEspero = `fica<b>${fmtKid(c.guardado)} de ${fmtKid(c.alvo)}</b>`;
  } else {
    /* SEM SONHO CADASTRADO ainda há uma decisão: ela guardou este dinheiro de propósito.
       Não há data nem alvo para comparar, então as estradas mostram o que fica no pote. */
    pergunta = 'Esse é o dinheiro que você <b>guardou</b>. Quer usar um pouco?';
    fimAgora = `fica<b>${fmtKid(c.sobra)} guardado</b>`;
    fimEspero = `fica<b>${fmtKid(c.guardado)} guardado</b>`;
  }

  /* A POSE É NEUTRA, e a troca veio da foto: com "pensando" o Dino fica de
     sobrancelha franzida, e na tela isso lê como DESAPROVAÇÃO — o mascote julgando a
     criança por querer o sorvete. É o oposto do que esta tela existe para fazer. */
  raiz().innerHTML = `
    ${palco('oi', 118)}
    ${balao(pergunta)}

    <div class="estradas">
      <button class="estrada agora" id="es-agora">
        <span class="estrada-ico">${esc(oque ? emojiDe(oque) : '🛒')}</span>
        <b>Uso agora</b>
        <span class="estrada-val">${fmtKid(c.valor)}</span>
        <span class="estrada-fim">
          <span class="estrada-seta">↓</span>
          ${fimAgora}
          ${/* A MOEDA MÁGICA, quando está em jogo, é um custo REAL: quem tira do guardar
               não recebe a moeda no próximo pagamento da semanada. Fica numa linha à
               parte porque é condicional, enquanto o atraso é aritmético — misturar as
               duas daria um número maior e menos confiável. */
            c.perdeMoeda ? `<span class="estrada-moeda">✨ sem a moeda mágica</span>` : ''}
        </span>
      </button>

      <button class="estrada espero" id="es-espero">
        <span class="estrada-ico">${esc(c.meta ? (c.meta.icon || '🎁') : '🏦')}</span>
        <b>Espero</b>
        <span class="estrada-val">guardo tudo</span>
        <span class="estrada-fim">
          <span class="estrada-seta">↓</span>
          ${fimEspero}
          ${c.perdeMoeda ? `<span class="estrada-moeda ok">✨ ganho ${fmtKid(c.moeda)}</span>` : ''}
        </span>
      </button>
    </div>

    <p class="vazio" style="font-size:15px">
      Os dois caminhos valem. O dinheiro é seu 🙂
    </p>`;

  el('#es-agora').onclick = () => { Som.toque(); vibra(12); aoSeguir(); };
  el('#es-espero').onclick = () => {
    Som.moeda(); vibra(20);
    App.aba = 'cofrinho';
    render();
    /* Elogia a espera SEM cobrar quem não esperou: quem escolhe o sorvete não vê
       nada a menos, só segue o fluxo normal. Aplaudir um lado e calar no outro
       ainda é julgamento, só que mais silencioso. */
    aviso(c.meta
      ? 'Você guardou! O seu sonho continua chegando ⭐'
      : 'Você guardou! O seu dinheiro continua crescendo ⭐');
  };
}

/* O desenho do que ela escolheu comprar, para a estrada mostrar a coisa e não um
   carrinho genérico. Cai no carrinho quando o item não está na lista. */
/* O QUE ELE PODE TER COMPRADO, e para quem pode ter doado.

   ESTA LISTA É A FONTE ÚNICA dos dois usos: os botões da tela de gastar e o desenho
   que aparece na tela de decisão. Antes eram duas listas escritas à mão, e acrescentar
   um botão sem lembrar da outra dava um carrinho genérico onde devia haver o sorvete
   — sem nada no app denunciando a divergência.

   A ESCOLHA DOS ITENS é por FREQUÊNCIA REAL na vida de uma criança de seis anos, não
   por completude: uma lista exaustiva rola sem fim e faz ela desistir de marcar,
   e um gasto sem etiqueta some do extrato como "gastei" e não ensina nada.

   Cada um também precisa ser reconhecível SÓ pelo desenho, porque ela ainda lê
   devagar: por isso 🍫 chocolate e 🍿 pipoca entram, e "papelaria" não.
   O nome fica curto pelo mesmo motivo — nome longo vira duas linhas no botão.

   E NENHUM NOME SE REPETE ENTRE AS DUAS LISTAS. "Escola" estava nas duas com sentidos
   diferentes — material escolar de um lado, doar para uma escola do outro —, e além de
   ser ambíguo no extrato dela, é impossível para o emojiDe, que devolve um desenho
   por nome. Viraram "Material" e "Uma escola". */
const COISAS_GASTAR = [
  ['🍭', 'Doce'], ['🍦', 'Sorvete'], ['🍫', 'Chocolate'], ['🍿', 'Pipoca'],
  ['🧸', 'Brinquedo'], ['🎮', 'Jogo'], ['🃏', 'Figurinha'], ['⚽', 'Bola'],
  ['📚', 'Livro'], ['🎨', 'Arte'], ['✏️', 'Material'], ['🎁', 'Presente'],
];

/* PARA QUEM DOAR. Aqui a lista é mais curta de propósito: doar é raro, e uma parede de
   opções transforma um gesto em formulário. */
const COISAS_DOAR = [
  ['🐶', 'Bichinhos'], ['🏥', 'Hospital'], ['🧒', 'Outra criança'],
  ['🍲', 'Quem tem fome'], ['🧓', 'Idosos'], ['⛪', 'Igreja'],
  ['🌳', 'Natureza'], ['🏫', 'Uma escola'],
];

/* O DESENHO DE UM ITEM, tirado das listas acima — nunca de um mapa paralelo. */
function emojiDe(nome) {
  const achou = COISAS_GASTAR.concat(COISAS_DOAR).find(([, n]) => n === nome);
  return achou ? achou[0] : '🛒';
}

/* ---------- Gastar e doar ---------- */

/* GASTAR, DOAR ou USAR O QUE ESTÁ GUARDADO — a mesma tela, três origens.

   O pote de onde o dinheiro sai muda o significado da saída, e a tela precisa dizer
   isso: gastar do "gastar agora" é o uso previsto; tirar do "guardar" é desfazer uma
   espera, e a criança tem de saber o que perde ao fazer isso. */
function telaGastar(pote) {
  const kid = App.kid;
  const p = Dados.potes(kid.id);
  const de = pote === 'doar' ? 'doar' : pote === 'guardar' ? 'guardar' : 'gastar';
  const doando = de === 'doar';
  const doGuardado = de === 'guardar';
  let valor = 0, oque = '';
  const disponivel = p[de];
  const sugestoes = [1, 2, 5, 10, 20].filter(v => v <= Math.max(1, disponivel));
  /* PERDE A MOEDA MÁGICA se tirar do guardado nesta semana. Avisar ANTES é a
     diferença entre uma escolha e uma surpresa: ela pode decidir esperar mais três
     dias, e é essa decisão que o app existe para provocar. */
  const perdeMoeda = doGuardado && kid.rendimento_tipo === 'moeda'
    && (Number(kid.rendimento_valor) || 0) > 0;

  const desenhar = () => {
    const demais = valor > disponivel;
    raiz().innerHTML = `
      ${palco(demais ? 'triste' : 'oi', 122)}
      ${balao(doando
        ? `Que legal doar! Você tem <b>${fmtKid(disponivel)}</b> no pote de doar.`
        : doGuardado
          ? `Você tem <b>${fmtKid(disponivel)}</b> guardado. Quanto quer usar?`
          : `Quanto você gastou? Tem <b>${fmtKid(disponivel)}</b> para gastar.`)}
      ${perdeMoeda ? `<div class="recado" style="margin-bottom:14px">
        <b>Espera um pouquinho...</b> Se você tirar do que guardou, não ganha a
        <b>moeda mágica</b> na próxima semanada ✨
      </div>` : ''}
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
          ${(doando ? COISAS_DOAR : COISAS_GASTAR)
            .map(([e, n]) => `<button class="chip ${oque === n ? 'on' : ''}" data-o="${n}">${e} ${n}</button>`).join('')}
        </div>
      </div>
      <button class="bt ${doando ? 'rosa' : doGuardado ? '' : 'verde'}" id="conf" ${valor <= 0 || demais ? 'disabled' : ''}>
        <span class="emo">${doando ? '💝' : doGuardado ? '🏦' : '🛒'}</span>
        ${demais ? 'Não tem tudo isso' : doando ? 'Doei!' : doGuardado ? 'Usar este dinheiro' : 'Gastei!'}
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
      /* A ESCOLHA VEM ANTES DO LANÇAMENTO, e só quando sai do guardado com uma meta
         viva que o saque adia. Mostrar depois seria informar um preço já pago; em
         qualquer outro caso não há troca a apresentar, e a tela extra viraria
         obstáculo — o pote de gastar existe para ser gasto. */
      /* TODO SAQUE DO GUARDADO PASSA PELA DECISÃO. O portão era `custoDoSaque`, que
         devolve null quando o saque não adia o sonho — então saque pequeno, criança sem
         sonho e criança sem ritmo saíam direto, sem parar. E é justamente a parada que
         faz o pote de guardar ser diferente do pote de gastar. */
      if (doGuardado) {
        telaEscolha(de, valor, oque, gravar);
        return;
      }
      gravar();
    };

    const gravar = () => {
      const r = Dados.gastar(kid.id, de, valor, oque);
      if (!r.ok) {
        Som.nao(); vibra([60, 40, 60]);
        aviso(r.motivo === 'falta' ? 'Não tem tudo isso no pote' : 'Escolha um valor', '😕');
        return;
      }
      Nuvem.sincronizar();
      if (doando) festa(); else { Som.moeda(); vibra(25); }
      App.aba = 'cofrinho';
      render();
      aviso(doando ? 'Você doou! Que coração grande 💝'
        : doGuardado ? 'Usou o que tinha guardado 🏦' : 'Anotado no cofrinho!', '');
    };
    el('#volta').onclick = () => { App.aba = 'cofrinho'; render(); };
  };
  desenhar();
}

/* ---------- Cliques que valem em qualquer tela ---------- */

document.addEventListener('click', ev => {
  const alvo = ev.target.closest('[id], [data-tarefa], [data-pote], [data-ir-sonho]');
  if (!alvo || !App.kid) return;

  if (alvo.id === 'ir-ritual') return telaRitual();
  if (alvo.id === 'bt-comprar-sonho') {
    const pronto = Dados.metaAlcancada(App.kid.id);
    if (!pronto) { render(); return; }
    Dados.realizarSonho(App.kid.id);
    Nuvem.sincronizar();
    festa();
    App.aba = 'cofrinho';
    render();
    /* "Pedi", não "conquistei": a conquista é quando o adulto compra. Celebrar
       o pedido como se fosse a entrega seria prometer o que ainda não aconteceu. */
    aviso(`Você pediu o seu ${pronto.meta.name}! Falta um adulto confirmar 🎉`);
    return;
  }
  /* Tocar no resumo leva à aba do sonho: o card responde a "quero ver isso melhor",
     que é a pergunta natural depois de ver a barra. */
  if (alvo.dataset && alvo.dataset.irSonho) { Som.toque(); App.aba = 'sonho'; render(); return; }
  if (alvo.id === 'bt-extrato') { Som.toque(); return telaExtrato(); }
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

  /* TOCAR NO POTE FAZ A AÇÃO DELE, e não abre um aviso explicando o que ele é.

     Antes o toque só contava a função do pote: bonito na primeira semana, inútil na
     segunda — ela já sabe para que serve o pote de doar, e o toque virava uma porta
     que não leva a lugar nenhum.

     A EXPLICAÇÃO NÃO SE PERDEU: cada tela de ação abre dizendo de qual pote o dinheiro
     sai e quanto há nele, que é a mesma informação no momento em que ela importa.

     POTE VAZIO NÃO ABRE NADA: mandar a criança para uma tela onde tudo é recusado é
     frustração sem lição. O aviso diz o que falta acontecer para o pote encher. */
  if (alvo.dataset && alvo.dataset.pote) {
    const pote = alvo.dataset.pote;
    Som.toque();
    if (!(Dados.potes(App.kid.id)[pote] > 0)) {
      return aviso({
        gastar: 'Este pote está vazio. A semanada logo chega 🪙',
        guardar: 'Você ainda não guardou nada aqui ⭐',
        doar: 'Este pote está vazio. Reparta um pouquinho para doar 💝',
      }[pote]);
    }
    vibra(12);
    return telaGastar(pote);
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
    /* REGISTRAR NÃO BASTA NUM APP INSTALADO. O navegador só procura versão nova em
       uma NAVEGAÇÃO, e um app instalado quase nunca navega: a criança sai pelo botão
       do aparelho e volta pelo ícone, o que é apenas retomar. Sem isto o cofrinho pode
       passar semanas na versão antiga sem nada indicando que existe outra.

       Então: pergunta ao voltar para a frente, e recarrega uma vez quando um worker
       novo assume. O guarda do `tinhaDono` é o que evita recarregar na PRIMEIRA visita,
       quando assumir o controle é o esperado e não uma atualização. */
    navigator.serviceWorker.register('sw.js').then(reg => {
      const olhar = () => { if (!document.hidden) reg.update().catch(() => { }); };
      document.addEventListener('visibilitychange', olhar);
      olhar();

      let tinhaDono = !!navigator.serviceWorker.controller;
      let recarregando = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!tinhaDono || recarregando) { tinhaDono = true; return; }
        recarregando = true;
        location.reload();
      });
    }).catch(() => { });
  }
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', iniciar);
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { App, fmtKid, diaBonito, hashDaSenha, telaQuem, render, telaGastar, telaRitual };
}
  /* Os handlers de bt-gastar, bt-doar e bt-usar-guardado saíram junto com os botões:
     nenhum elemento carrega mais esses ids, e handler sem dono é armadilha para quem
     for procurar de onde vem a tela de gastar. Ela vem do pote. */
