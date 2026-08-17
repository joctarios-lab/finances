/* Cofrinho — toda a arte, desenhada em SVG aqui dentro.

   POR QUE SVG NA MÃO, e não imagens.

   Este app tem que abrir offline no tablet, no meio do sábado, sem esperar
   download. SVG inline não tem requisição, não borra em tela retina, e muda de
   cor por CSS — é o que deixa o Dino combinar com a cor que a criança escolheu
   sem existirem doze arquivos de dino. Cada peça é uma função que devolve
   string, porque o app inteiro monta tela com template literal.

   O DINO é o mascote, e ele tem POSES. Uma criança de seis anos lê a cara do
   bichinho antes de ler qualquer texto da tela: o Dino comemorando diz "deu
   certo" mais rápido do que a palavra "pronto". Por isso as poses são estados
   emocionais, não enfeites. */
'use strict';

const Arte = {

  /* ---------- O DINO ----------
     Um só corpo, trocando olhos, boca e braços. Manter o corpo idêntico entre as
     poses é o que faz o cérebro reconhecer "é o mesmo bichinho" em vez de ver
     seis desenhos parecidos. */
  dino(pose = 'oi', tam = 140) {
    const caras = {
      oi: `<circle cx="86" cy="70" r="6" fill="#2d3436"/><circle cx="112" cy="70" r="6" fill="#2d3436"/>
           <circle cx="88" cy="68" r="2" fill="#fff"/><circle cx="114" cy="68" r="2" fill="#fff"/>
           <path d="M84 88 q15 12 30 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      feliz: `<path d="M80 70 q6 -8 12 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>
              <path d="M106 70 q6 -8 12 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>
              <path d="M82 84 q17 20 34 0 z" fill="#2d3436"/><path d="M92 96 q8 8 16 0 z" fill="#ff7675"/>`,
      uau: `<circle cx="86" cy="68" r="9" fill="#fff" stroke="#2d3436" stroke-width="3"/>
            <circle cx="112" cy="68" r="9" fill="#fff" stroke="#2d3436" stroke-width="3"/>
            <circle cx="87" cy="69" r="4" fill="#2d3436"/><circle cx="113" cy="69" r="4" fill="#2d3436"/>
            <ellipse cx="99" cy="92" rx="11" ry="13" fill="#2d3436"/>`,
      pensando: `<circle cx="86" cy="70" r="6" fill="#2d3436"/><circle cx="112" cy="70" r="6" fill="#2d3436"/>
                 <path d="M78 58 q10 -6 18 -2" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                 <path d="M102 56 q10 -4 18 2" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                 <path d="M86 92 q13 -6 26 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      dormindo: `<path d="M78 70 q8 6 16 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>
                 <path d="M104 70 q8 6 16 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>
                 <ellipse cx="99" cy="90" rx="6" ry="8" fill="#2d3436"/>
                 <text x="140" y="46" font-size="20" fill="#636e72" class="zzz">z</text>
                 <text x="156" y="30" font-size="14" fill="#b2bec3" class="zzz zzz2">z</text>`,
      triste: `<circle cx="86" cy="72" r="6" fill="#2d3436"/><circle cx="112" cy="72" r="6" fill="#2d3436"/>
               <path d="M78 62 q10 4 17 8" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>
               <path d="M120 62 q-10 4 -17 8" stroke="#2d3436" stroke-width="3.5" fill="none" stroke-linecap="round"/>
               <path d="M86 96 q13 -12 26 0" stroke="#2d3436" stroke-width="4" fill="none" stroke-linecap="round"/>
               <ellipse cx="80" cy="86" rx="4" ry="6" fill="#74b9ff" class="lagrima"/>`,
    };
    return `
<svg class="dino dino-${pose}" viewBox="0 0 200 190" width="${tam}" height="${tam * 0.95}" aria-hidden="true">
  <ellipse cx="100" cy="176" rx="52" ry="9" fill="rgba(0,0,0,.10)"/>
  <g class="dino-corpo">
    <!-- cauda -->
    <path class="dino-cauda" d="M52 138 q-34 4 -40 -22 q22 12 34 -2 z" fill="var(--dino-2)"/>
    <!-- pernas -->
    <rect x="76" y="140" width="20" height="30" rx="10" fill="var(--dino-2)"/>
    <rect x="106" y="140" width="20" height="30" rx="10" fill="var(--dino-2)"/>
    <ellipse cx="86" cy="170" rx="15" ry="7" fill="var(--dino-3)"/>
    <ellipse cx="116" cy="170" rx="15" ry="7" fill="var(--dino-3)"/>
    <!-- espinhos -->
    <path d="M62 96 l-12 -14 l16 2 z" fill="var(--dino-3)"/>
    <path d="M70 76 l-10 -18 l16 6 z" fill="var(--dino-3)"/>
    <path d="M86 58 l-4 -20 l14 12 z" fill="var(--dino-3)"/>
    <!-- corpo -->
    <ellipse cx="100" cy="122" rx="48" ry="42" fill="var(--dino-1)"/>
    <ellipse cx="104" cy="132" rx="30" ry="26" fill="var(--dino-barriga)"/>
    <!-- bracinhos -->
    <g class="dino-braco-e"><path d="M62 116 q-16 6 -14 20 q10 -6 18 -8 z" fill="var(--dino-2)"/></g>
    <g class="dino-braco-d"><path d="M138 116 q16 6 14 20 q-10 -6 -18 -8 z" fill="var(--dino-2)"/></g>
    <!-- cabeça -->
    <g class="dino-cabeca">
      <ellipse cx="99" cy="74" rx="46" ry="40" fill="var(--dino-1)"/>
      <ellipse cx="99" cy="92" rx="26" ry="20" fill="var(--dino-barriga)"/>
      <circle cx="66" cy="90" r="8" fill="#ff9ff3" opacity=".55"/>
      <circle cx="132" cy="90" r="8" fill="#ff9ff3" opacity=".55"/>
      ${caras[pose] || caras.oi}
    </g>
  </g>
</svg>`;
  },

  /* ---------- OS POTES ----------
     Três potes de vidro que ENCHEM. A altura do líquido é o saldo em relação ao
     maior dos três — comparação relativa, porque a pergunta que a criança faz
     olhando é "qual está mais cheio", não "quantos reais tem".

     Cheio nunca passa de 88% nem fica abaixo de 6% quando há dinheiro: um pote
     transbordando não tem para onde crescer, e um pote com R$ 0,50 desenhado
     vazio mente. */
  pote(tipo, valor, teto) {
    const cores = {
      gastar: { liq: '#4dd4ac', top: '#26c6a6', tampa: '#00b894', nome: 'Gastar agora', ico: '🛒' },
      guardar: { liq: '#74b9ff', top: '#4a9eff', tampa: '#0984e3', nome: 'Guardar', ico: '🏦' },
      doar: { liq: '#ffb8d1', top: '#ff8fb8', tampa: '#e84393', nome: 'Doar', ico: '💝' },
    };
    const c = cores[tipo] || cores.gastar;
    const alvo = teto > 0 ? Math.min(1, Math.max(0, valor / teto)) : 0;
    const h = valor <= 0 ? 0 : Math.max(0.06, alvo * 0.88);
    const topo = 132 - h * 96;
    return `
<svg class="pote pote-${tipo}" viewBox="0 0 100 150" aria-hidden="true">
  <defs>
    <clipPath id="cp-${tipo}"><path d="M18 42 h64 v78 a14 14 0 0 1 -14 14 h-36 a14 14 0 0 1 -14 -14 z"/></clipPath>
  </defs>
  <!-- vidro -->
  <path d="M18 42 h64 v78 a14 14 0 0 1 -14 14 h-36 a14 14 0 0 1 -14 -14 z" fill="rgba(255,255,255,.55)" stroke="#dfe6e9" stroke-width="3"/>
  <g clip-path="url(#cp-${tipo})">
    <rect class="pote-liq" x="16" y="${topo}" width="68" height="110" fill="${c.liq}"/>
    <ellipse class="pote-onda" cx="50" cy="${topo}" rx="34" ry="5" fill="${c.top}"/>
    ${valor > 0 ? `<circle cx="38" cy="${Math.min(124, topo + 22)}" r="7" fill="#ffeaa7" stroke="#fdcb6e" stroke-width="2"/>
      <circle cx="60" cy="${Math.min(126, topo + 34)}" r="7" fill="#ffeaa7" stroke="#fdcb6e" stroke-width="2"/>` : ''}
  </g>
  <!-- brilho do vidro -->
  <rect x="26" y="52" width="7" height="60" rx="3.5" fill="#fff" opacity=".6"/>
  <!-- tampa e fenda -->
  <rect x="12" y="30" width="76" height="16" rx="8" fill="${c.tampa}"/>
  <rect x="38" y="35" width="24" height="6" rx="3" fill="rgba(0,0,0,.28)"/>
  <text x="50" y="24" font-size="17" text-anchor="middle">${c.ico}</text>
</svg>`;
  },

  moeda(tam = 34) {
    return `
<svg class="moeda" viewBox="0 0 40 40" width="${tam}" height="${tam}" aria-hidden="true">
  <circle cx="20" cy="20" r="18" fill="#fdcb6e" stroke="#e1a83e" stroke-width="2.5"/>
  <circle cx="20" cy="20" r="13" fill="#ffeaa7"/>
  <text x="20" y="26" font-size="15" text-anchor="middle" fill="#b8860b" font-weight="700">R$</text>
</svg>`;
  },

  /* Estrela do selo: cheia quando ganha, contorno quando ainda falta. */
  estrela(ganha) {
    return `
<svg viewBox="0 0 44 44" class="selo-svg" aria-hidden="true">
  <path d="M22 4 l5.6 11.6 12.4 1.7 -9 8.8 2.2 12.6 -11.2 -6 -11.2 6 2.2 -12.6 -9 -8.8 12.4 -1.7 z"
        fill="${ganha ? '#fdcb6e' : 'none'}" stroke="${ganha ? '#e1a83e' : '#c8cfd4'}" stroke-width="3" stroke-linejoin="round"/>
</svg>`;
  },

  trofeu() {
    return `
<svg viewBox="0 0 60 60" width="52" height="52" aria-hidden="true">
  <path d="M18 10 h24 v14 a12 12 0 0 1 -24 0 z" fill="#fdcb6e" stroke="#e1a83e" stroke-width="2.5"/>
  <path d="M18 14 h-7 a8 8 0 0 0 8 10" fill="none" stroke="#e1a83e" stroke-width="3"/>
  <path d="M42 14 h7 a8 8 0 0 1 -8 10" fill="none" stroke="#e1a83e" stroke-width="3"/>
  <rect x="26" y="35" width="8" height="10" fill="#e1a83e"/>
  <rect x="18" y="45" width="24" height="7" rx="3" fill="#e1a83e"/>
</svg>`;
  },

  // O cadeado da tela de senha: fechado ao pedir, aberto ao acertar
  cadeado(aberto) {
    return `
<svg class="cadeado ${aberto ? 'aberto' : ''}" viewBox="0 0 60 70" width="52" height="60" aria-hidden="true">
  <path class="cad-arco" d="M18 30 v-8 a12 12 0 0 1 24 0 v8" fill="none" stroke="#fdcb6e" stroke-width="6" stroke-linecap="round"/>
  <rect x="10" y="30" width="40" height="32" rx="8" fill="#fdcb6e"/>
  <circle cx="30" cy="44" r="5" fill="#b8860b"/>
  <rect x="27.5" y="46" width="5" height="9" rx="2.5" fill="#b8860b"/>
</svg>`;
  },

  /* CONFETE em SVG animado por CSS: 24 pedacinhos com atraso próprio.
     Não é enfeite gratuito — é o "deu certo" que a criança entende antes de ler
     qualquer aviso, e some sozinho para não virar poluição. */
  confete() {
    const cores = ['#00b894', '#0984e3', '#e84393', '#fdcb6e', '#e17055', '#6c5ce7'];
    let peças = '';
    for (let i = 0; i < 24; i++) {
      const x = 4 + Math.random() * 92;
      const cor = cores[i % cores.length];
      const atraso = (Math.random() * 0.7).toFixed(2);
      const giro = Math.round(Math.random() * 360);
      peças += `<rect x="${x.toFixed(1)}" y="-6" width="2.4" height="3.6" rx=".6" fill="${cor}"
        style="animation-delay:${atraso}s; transform-origin:center; transform:rotate(${giro}deg)"/>`;
    }
    return `<svg class="confete" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${peças}</svg>`;
  },

  // Fundo da tela: nuvens e morrinhos, o mundo onde o Dino mora
  cenario() {
    return `
<svg class="cenario" viewBox="0 0 400 180" preserveAspectRatio="none" aria-hidden="true">
  <g class="nuvens">
    <g class="nuvem n1"><ellipse cx="60" cy="40" rx="30" ry="17" fill="#fff" opacity=".85"/><ellipse cx="86" cy="44" rx="22" ry="13" fill="#fff" opacity=".85"/></g>
    <g class="nuvem n2"><ellipse cx="290" cy="30" rx="26" ry="14" fill="#fff" opacity=".7"/><ellipse cx="312" cy="34" rx="18" ry="11" fill="#fff" opacity=".7"/></g>
  </g>
  <circle cx="352" cy="34" r="22" fill="#ffeaa7" opacity=".9"/>
  <path d="M0 150 q60 -46 130 -6 q54 30 110 -14 q60 -46 160 12 v40 H0 z" fill="rgba(255,255,255,.35)"/>
</svg>`;
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Arte };
