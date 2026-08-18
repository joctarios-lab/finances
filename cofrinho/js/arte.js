/* Cofrinho — toda a arte, desenhada em SVG aqui dentro.

   POR QUE SVG INLINE, e não imagens.

   Este app tem que abrir offline no tablet, no meio do sábado, sem esperar
   download. SVG inline não tem requisição, não borra em tela retina, e muda de
   cor por CSS — é o que deixa o Dino combinar com a cor que a criança escolheu
   sem existirem doze arquivos de dino. Cada peça é uma função que devolve
   string, porque o app inteiro monta tela com template literal.

   O DINO tem POSES, e elas são estados emocionais, não enfeites: uma criança de
   seis anos lê a cara do bichinho antes de ler qualquer texto da tela. O Dino
   comemorando diz "deu certo" mais rápido do que a palavra "pronto".

   Todas as poses compartilham o corpo IDÊNTICO, trocando só olhos, boca e
   sobrancelha. É isso que faz o cérebro reconhecer "é o mesmo bichinho" em vez
   de ver seis desenhos parecidos.

   ONDE ESTE ARQUIVO PARA. Desenho vetorial à mão rende bem em formas geométricas
   — potes, moedas, troféus, bandeiras. Para o mascote em poses de corpo inteiro
   complexas (dando cambalhota, andando de patinete) e para ilustrações de
   recompensa com textura, o SVG à mão ficaria ou pobre ou gigante. Esses casos
   estão marcados com PROMPT DE IMAGEM: o layout fica pronto esperando o arquivo,
   e o prompt em inglês está no comentário, para gerar e soltar em icons/.
   --------------------------------------------------------------------------- */
'use strict';

const Arte = {

  /* ---------- O DINO ----------
     Corpo fixo, cara variável. A cor sai das variáveis --dino-*, que o app
     redefine com a cor escolhida pela criança. */
  dino(pose = 'oi', tam = 150) {
    const caras = {
      oi: `
        <ellipse cx="86" cy="70" rx="7.5" ry="8" fill="#2b3a44"/>
        <ellipse cx="112" cy="70" rx="7.5" ry="8" fill="#2b3a44"/>
        <circle cx="88.5" cy="67" r="2.6" fill="#fff"/><circle cx="114.5" cy="67" r="2.6" fill="#fff"/>
        <path d="M83 88 q16 13 32 0" stroke="#2b3a44" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
      feliz: `
        <path d="M79 71 q7 -10 14 0" stroke="#2b3a44" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M105 71 q7 -10 14 0" stroke="#2b3a44" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M81 84 q18 23 36 0 z" fill="#2b3a44"/>
        <path d="M91 97 q8 9 17 0 z" fill="#ff7a90"/>`,
      uau: `
        <circle cx="86" cy="68" r="10.5" fill="#fff" stroke="#2b3a44" stroke-width="3.5"/>
        <circle cx="112" cy="68" r="10.5" fill="#fff" stroke="#2b3a44" stroke-width="3.5"/>
        <circle cx="87" cy="69" r="4.8" fill="#2b3a44"/><circle cx="113" cy="69" r="4.8" fill="#2b3a44"/>
        <circle cx="89" cy="66" r="1.8" fill="#fff"/><circle cx="115" cy="66" r="1.8" fill="#fff"/>
        <ellipse cx="99" cy="93" rx="12" ry="14" fill="#2b3a44"/>
        <ellipse cx="99" cy="98" rx="6" ry="7" fill="#ff7a90"/>`,
      pensando: `
        <ellipse cx="86" cy="71" rx="7" ry="7.5" fill="#2b3a44"/>
        <ellipse cx="112" cy="71" rx="7" ry="7.5" fill="#2b3a44"/>
        <circle cx="88" cy="68" r="2.4" fill="#fff"/><circle cx="114" cy="68" r="2.4" fill="#fff"/>
        <path d="M77 57 q11 -7 20 -2" stroke="#2b3a44" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M101 55 q11 -5 20 3" stroke="#2b3a44" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M86 92 q13 -7 27 0" stroke="#2b3a44" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
      dormindo: `
        <path d="M77 70 q9 8 18 0" stroke="#2b3a44" stroke-width="4.5" fill="none" stroke-linecap="round"/>
        <path d="M103 70 q9 8 18 0" stroke="#2b3a44" stroke-width="4.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="99" cy="91" rx="7" ry="9" fill="#2b3a44"/>
        <text x="143" y="48" font-size="24" font-weight="700" fill="#6b8290" class="zzz">z</text>
        <text x="162" y="30" font-size="17" font-weight="700" fill="#9fb3bf" class="zzz zzz2">z</text>`,
      triste: `
        <ellipse cx="86" cy="73" rx="7" ry="7.5" fill="#2b3a44"/>
        <ellipse cx="112" cy="73" rx="7" ry="7.5" fill="#2b3a44"/>
        <path d="M77 62 q11 4 19 9" stroke="#2b3a44" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M121 62 q-11 4 -19 9" stroke="#2b3a44" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M85 97 q14 -13 28 0" stroke="#2b3a44" stroke-width="4.5" fill="none" stroke-linecap="round"/>
        <ellipse cx="79" cy="88" rx="4.5" ry="7" fill="#5fb8ff" class="lagrima"/>`,
    };
    return `
<svg class="dino dino-${pose}" viewBox="0 0 200 192" width="${tam}" height="${Math.round(tam * 0.96)}" aria-hidden="true">
  <defs>
    <radialGradient id="dg-corpo" cx="36%" cy="26%">
      <stop offset="0%" stop-color="var(--dino-luz)"/>
      <stop offset="100%" stop-color="var(--dino-1)"/>
    </radialGradient>
  </defs>
  <ellipse cx="100" cy="178" rx="56" ry="10" fill="rgba(43,58,68,.13)"/>
  <g class="dino-corpo">
    <!-- cauda, saindo por tras do corpo -->
    <path class="dino-cauda" d="M56 140 q-40 10 -46 -24 q24 16 40 -4 z" fill="var(--dino-2)"/>
    <!-- pernas com pezinho -->
    <rect x="74" y="140" width="22" height="32" rx="11" fill="var(--dino-2)"/>
    <rect x="105" y="140" width="22" height="32" rx="11" fill="var(--dino-2)"/>
    <ellipse cx="85" cy="171" rx="17" ry="8" fill="var(--dino-3)"/>
    <ellipse cx="116" cy="171" rx="17" ry="8" fill="var(--dino-3)"/>
    <!-- garrinhas: tres tracinhos em cada pe -->
    <g stroke="var(--dino-luz)" stroke-width="2" stroke-linecap="round" opacity=".7">
      <path d="M76 172 v3M85 173 v3M94 172 v3M107 172 v3M116 173 v3M125 172 v3"/>
    </g>
    <!-- crista nas costas: tres placas -->
    <g class="dino-crista">
      <path d="M60 100 l-15 -17 l19 3 z" fill="var(--dino-3)"/>
      <path d="M69 78 l-12 -21 l19 7 z" fill="var(--dino-3)"/>
      <path d="M85 58 l-5 -23 l17 14 z" fill="var(--dino-3)"/>
    </g>
    <!-- corpo -->
    <ellipse cx="100" cy="123" rx="50" ry="44" fill="url(#dg-corpo)"/>
    <ellipse cx="104" cy="134" rx="32" ry="27" fill="var(--dino-barriga)"/>
    <!-- as linhas da barriga, que todo dino de desenho tem -->
    <g stroke="var(--dino-1)" stroke-width="2" opacity=".35" stroke-linecap="round">
      <path d="M84 126 h40M82 138 h44M86 150 h36"/>
    </g>
    <!-- bracinhos curtos -->
    <g class="dino-braco-e"><ellipse cx="58" cy="122" rx="16" ry="10" fill="var(--dino-2)" transform="rotate(28 58 122)"/></g>
    <g class="dino-braco-d"><ellipse cx="142" cy="122" rx="16" ry="10" fill="var(--dino-2)" transform="rotate(-28 142 122)"/></g>
    <!-- cabeca -->
    <g class="dino-cabeca">
      <ellipse cx="99" cy="74" rx="48" ry="42" fill="url(#dg-corpo)"/>
      <ellipse cx="99" cy="93" rx="27" ry="21" fill="var(--dino-barriga)"/>
      <!-- narizinhos -->
      <circle cx="93" cy="82" r="2.2" fill="var(--dino-3)" opacity=".55"/>
      <circle cx="105" cy="82" r="2.2" fill="var(--dino-3)" opacity=".55"/>
      <!-- bochechas -->
      <ellipse cx="64" cy="88" rx="10" ry="8" fill="#ff8fd4" opacity=".6"/>
      <ellipse cx="134" cy="88" rx="10" ry="8" fill="#ff8fd4" opacity=".6"/>
      ${caras[pose] || caras.oi}
    </g>
  </g>
</svg>`;
  },

  /* ---------- OS POTES DE VIDRO ----------
     Jarra transparente com contorno marcado, que ENCHE. A altura do líquido é o
     saldo em relação ao MAIOR dos três — comparação relativa, porque a pergunta
     que a criança faz olhando é "qual está mais cheio", não "quantos reais tem".

     Cheio nunca passa de 86% nem fica abaixo de 8% havendo dinheiro: um pote
     transbordando não tem para onde crescer, e um pote com R$ 0,50 desenhado
     vazio mente para ela.

     AS MOEDAS SÃO CONTADAS, não decorativas: quanto mais cheio, mais moedas
     empilhadas, em fileiras que sobem. É a leitura que funciona antes de saber
     ler número. */
  pote(tipo, valor, teto, id) {
    const cores = {
      gastar: { liq: '#00d68f', topo: '#00b87b', tampa: '#00a86f', claro: '#7ef5cd', ico: '🛒' },
      guardar: { liq: '#2b7fff', topo: '#1a6ae8', tampa: '#1a5fd0', claro: '#9dc8ff', ico: '🏦' },
      doar: { liq: '#ff3d94', topo: '#ec2380', tampa: '#d81b74', claro: '#ffb3d5', ico: '💝' },
    };
    const c = cores[tipo] || cores.gastar;
    const u = id || tipo;   // sufixo único: dois potes iguais na tela não podem
                            // compartilhar id de clipPath, ou um apaga o outro
    const cheio = teto > 0 ? Math.min(1, Math.max(0, valor / teto)) : 0;
    const h = valor <= 0 ? 0 : Math.max(0.08, cheio * 0.86);
    const chao = 138, teto_px = 46;
    const topo = chao - h * (chao - teto_px);

    /* Moedas em fileiras de três, subindo até a linha do líquido. Limitado a
       cinco fileiras: acima disso vira mancha e para de dizer quantidade. */
    let moedas = '';
    if (valor > 0) {
      const fileiras = Math.min(5, Math.max(1, Math.round(h * 6)));
      for (let f = 0; f < fileiras; f++) {
        const y = chao - 12 - f * 15;
        if (y < topo + 4) break;
        const quantas = f % 2 === 0 ? 3 : 2;
        for (let i = 0; i < quantas; i++) {
          const x = quantas === 3 ? 32 + i * 18 : 41 + i * 18;
          moedas += `<g class="pote-moeda">
            <circle cx="${x}" cy="${y}" r="8" fill="#ffc93c" stroke="#e0a010" stroke-width="2"/>
            <circle cx="${x}" cy="${y}" r="4.6" fill="#fff0b8"/>
          </g>`;
        }
      }
    }

    return `
<svg class="pote pote-${tipo}" viewBox="0 0 100 158" aria-hidden="true">
  <defs>
    <clipPath id="cp-${u}">
      <path d="M17 44 h66 v82 a16 16 0 0 1 -16 16 h-34 a16 16 0 0 1 -16 -16 z"/>
    </clipPath>
    <linearGradient id="vidro-${u}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#fff" stop-opacity=".78"/>
      <stop offset="42%" stop-color="#fff" stop-opacity=".32"/>
      <stop offset="100%" stop-color="#dbeaf2" stop-opacity=".58"/>
    </linearGradient>
  </defs>

  <!-- o vidro, com contorno marcado -->
  <path d="M17 44 h66 v82 a16 16 0 0 1 -16 16 h-34 a16 16 0 0 1 -16 -16 z"
        fill="url(#vidro-${u})" stroke="#b8d4e2" stroke-width="3.5"/>

  <g clip-path="url(#cp-${u})">
    <!-- o liquido -->
    <rect class="pote-liq" x="15" y="${topo}" width="70" height="120" fill="${c.liq}"/>
    <rect x="15" y="${topo}" width="70" height="120" fill="url(#vidro-${u})" opacity=".22"/>
    <ellipse class="pote-onda" cx="50" cy="${topo}" rx="36" ry="6" fill="${c.topo}"/>
    <ellipse cx="50" cy="${topo - 1.5}" rx="30" ry="3.5" fill="${c.claro}" opacity=".8"/>
    ${moedas}
  </g>

  <!-- brilho do vidro, dois riscos -->
  <rect class="pote-brilho" x="25" y="56" width="8" height="62" rx="4" fill="#fff" opacity=".62"/>
  <rect x="71" y="62" width="4" height="42" rx="2" fill="#fff" opacity=".38"/>

  <!-- tampa de rosca com a fenda de cofrinho -->
  <rect x="11" y="28" width="78" height="19" rx="9.5" fill="${c.tampa}"/>
  <rect x="11" y="28" width="78" height="7" rx="3.5" fill="#fff" opacity=".26"/>
  <rect x="36" y="34" width="28" height="7" rx="3.5" fill="rgba(0,0,0,.32)"/>
  <text x="50" y="22" font-size="19" text-anchor="middle">${c.ico}</text>
</svg>`;
  },

  moeda(tam = 38) {
    return `
<svg class="moeda" viewBox="0 0 44 44" width="${tam}" height="${tam}" aria-hidden="true">
  <circle cx="22" cy="23" r="19" fill="#e0a010"/>
  <circle cx="22" cy="21" r="19" fill="#ffc93c" stroke="#e0a010" stroke-width="2.5"/>
  <circle cx="22" cy="21" r="13.5" fill="#fff0b8"/>
  <text x="22" y="27" font-size="15" text-anchor="middle" fill="#8a5a00"
        font-family="system-ui, sans-serif" font-weight="700">R$</text>
  <ellipse cx="15" cy="13" rx="4.5" ry="3" fill="#fff" opacity=".75" transform="rotate(-28 15 13)"/>
</svg>`;
  },

  /* ---------- O CHECK DE OURO: a missão cumprida ----------
     Selo redondo com raios atrás e faíscas. É o momento de recompensa da tela de
     tarefas, e por isso é o desenho mais brilhante do app. */
  checkOuro() {
    return `
<svg viewBox="0 0 60 60" class="selo-ouro" aria-hidden="true">
  <g class="premio-raios">
    ${Array.from({ length: 8 }, (_, i) =>
      `<rect x="28.5" y="1" width="3" height="9" rx="1.5" fill="#ffc93c" opacity=".75"
             transform="rotate(${i * 45} 30 30)"/>`).join('')}
  </g>
  <circle cx="30" cy="31" r="21" fill="#e0a010"/>
  <circle cx="30" cy="29" r="21" fill="#ffc93c" stroke="#e0a010" stroke-width="2.5"/>
  <circle cx="30" cy="29" r="15.5" fill="#fff0b8"/>
  <path d="M22 29.5 l6 6 l11 -13" stroke="#00a86f" stroke-width="5.5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <ellipse cx="21" cy="19" rx="5" ry="3" fill="#fff" opacity=".8" transform="rotate(-30 21 19)"/>
</svg>`;
  },

  /* O CHECK DO DIA, menor e mais quieto que o de ouro.

     Marcar um dia de uma missão diária não é conquista — é o combinado. O selo de
     ouro fica para a semana completa; se os dois brilhassem igual, a criança
     leria "já ganhei" na segunda e o valor da constância desapareceria. */
  checkDia() {
    return `
<svg viewBox="0 0 60 60" aria-hidden="true">
  <circle cx="30" cy="30" r="19" fill="#eafff7" stroke="#00b87b" stroke-width="3"/>
  <path d="M21 30.5 l6.5 6.5 l12 -14" stroke="#00a86f" stroke-width="5" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  },
  /* AS NOITES QUE FALTAM, em luas.

     Uma lua por noite de sono. É a contagem que uma criança de seis anos consegue
     fazer sozinha, olhando — e é por isso que não há relógio nem número grande
     correndo: pressa que ela não tem como administrar vira ansiedade, não
     compromisso.

     Acima de cinco noites vira "5+", porque a partir dali a contagem exata deixa de
     significar algo para ela e a fileira só polui o card. */
  luas(n) {
    if (n === null || n === undefined) return '';
    if (n < 0) return '';
    const quantas = Math.min(5, Math.max(1, n === 0 ? 1 : n));
    let out = '';
    for (let k = 0; k < quantas; k++) {
      const hoje = n === 0 && k === 0;
      out += `<svg class="lua ${hoje ? 'hoje' : ''}" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="${hoje ? '#ff8a3d' : '#ffc93c'}"
                stroke="${hoje ? '#e06517' : '#e0a010'}" stroke-width="2"/>
        ${hoje ? '' : '<circle cx="15.5" cy="9.5" r="7" fill="#fff8e0"/>'}
      </svg>`;
    }
    if (n > 5) out += '<span class="lua-mais">+</span>';
    return out;
  },

  /* O PERGAMINHO da missão especial.

     Um card comum diria "mais uma tarefa". O pergaminho diz "isto é diferente" antes
     de qualquer texto — que é como uma criança de seis anos lê uma tela. As bordas
     rasgadas e o selo de cera vêm de mapa do tesouro de propósito: a missão especial
     é um combinado pontual, e ela precisa parecer um. */
  pergaminho() {
    return `
<!-- O viewBox CASA COM O PATH, e isso não é detalhe: o path termina em x=288 e o
     viewBox dizia 340, então 15% da direita era papel vazio esticado. O selo de cera,
     ancorado na borda do botão, caía fora do pergaminho — flutuando no céu. -->
<svg class="pergaminho-fundo" viewBox="0 0 294 120" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="pg-papel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff8e4"/>
      <stop offset="100%" stop-color="#ffedc4"/>
    </linearGradient>
  </defs>
  <path d="M6 10 q10 -6 20 0 q12 6 24 0 q12 -6 24 0 q12 6 24 0 q12 -6 24 0 q12 6 24 0
           q12 -6 24 0 q12 6 24 0 q12 -6 24 0 q12 6 24 0 q12 -6 24 0 q12 6 22 0
           v100 q-10 6 -22 0 q-12 -6 -24 0 q-12 6 -24 0 q-12 -6 -24 0 q-12 6 -24 0
           q-12 -6 -24 0 q-12 6 -24 0 q-12 -6 -24 0 q-12 6 -24 0 q-12 -6 -24 0
           q-12 6 -20 0 z"
        fill="url(#pg-papel)" stroke="#e0b978" stroke-width="2.5"/>
</svg>`;
  },

  // O selo de cera: fecha o pergaminho e diz "isto foi combinado"
  selo() {
    return `
<svg viewBox="0 0 48 48" class="selo-cera" aria-hidden="true">
  <circle cx="24" cy="24" r="18" fill="#d81b74"/>
  <circle cx="24" cy="22" r="18" fill="#ff3d94" stroke="#d81b74" stroke-width="2"/>
  <circle cx="24" cy="22" r="12" fill="none" stroke="#ffd0e6" stroke-width="2.5"/>
  <text x="24" y="28" font-size="14" text-anchor="middle">⭐</text>
</svg>`;
  },

  // Esperando o adulto conferir: ampulheta, que gira no CSS
  ampulheta() {
    return `
<svg viewBox="0 0 60 60" aria-hidden="true">
  <circle cx="30" cy="30" r="21" fill="#ffc93c" stroke="#e0a010" stroke-width="2.5"/>
  <path d="M21 17 h18 l-9 12 z" fill="#fff8e0"/>
  <path d="M21 43 h18 l-9 -12 z" fill="#fff8e0"/>
  <path d="M23 41 h14 l-7 -8 z" fill="#e06517"/>
  <rect x="19" y="14" width="22" height="4" rx="2" fill="#8a5a00"/>
  <rect x="19" y="42" width="22" height="4" rx="2" fill="#8a5a00"/>
</svg>`;
  },

  /* ---------- OS PRÊMIOS: troféu, medalhas e taça ----------
     Cada selo tem o SEU objeto, não uma estrela genérica repetida seis vezes.
     Uma criança colecionando precisa distinguir os prêmios de longe — se todos
     são a mesma estrela amarela, não há coleção, há uma contagem. */
  premio(id, ganho) {
    const raios = `<g class="premio-raios">
      ${Array.from({ length: 12 }, (_, i) =>
        `<rect x="46" y="3" width="4" height="12" rx="2" fill="#ffc93c" opacity=".5"
               transform="rotate(${i * 30} 48 48)"/>`).join('')}
    </g>`;
    const faiscas = `
      <g fill="#fff">
        <circle class="premio-faisca" cx="17" cy="24" r="3"/>
        <circle class="premio-faisca" cx="80" cy="30" r="2.4"/>
        <circle class="premio-faisca" cx="74" cy="70" r="2.8"/>
      </g>`;

    // Fita de medalha, reaproveitada pelas medalhas
    const fita = (c1, c2) => `
      <path d="M33 12 l10 30 h10 l-8 -30 z" fill="${c1}"/>
      <path d="M63 12 l-10 30 h-10 l8 -30 z" fill="${c2}"/>`;

    const arte = {
      // Repartidor: taça de duas alças, o prêmio "principal"
      dividiu: `
        ${fita('#2b7fff', '#1a5fd0')}
        <path d="M30 34 h36 v18 a18 18 0 0 1 -36 0 z" fill="#ffc93c" stroke="#e0a010" stroke-width="3"/>
        <path d="M30 38 h-9 a11 11 0 0 0 11 13" fill="none" stroke="#e0a010" stroke-width="4"/>
        <path d="M66 38 h9 a11 11 0 0 1 -11 13" fill="none" stroke="#e0a010" stroke-width="4"/>
        <rect x="43" y="68" width="10" height="12" fill="#e0a010"/>
        <rect x="32" y="79" width="32" height="9" rx="4.5" fill="#e0a010"/>
        <rect x="36" y="41" width="6" height="12" rx="3" fill="#fff" opacity=".6"/>`,
      // Caprichoso: medalha de ouro com estrela
      tarefas: `
        ${fita('#ff8a3d', '#e06517')}
        <circle cx="48" cy="60" r="24" fill="#e0a010"/>
        <circle cx="48" cy="58" r="24" fill="#ffc93c" stroke="#e0a010" stroke-width="3"/>
        <circle cx="48" cy="58" r="17" fill="#fff0b8"/>
        <path d="M48 45 l4.4 9 9.6 1.3 -7 6.8 1.7 9.7 -8.7 -4.7 -8.7 4.7 1.7 -9.7 -7 -6.8 9.6 -1.3 z" fill="#e0a010"/>
        <ellipse cx="38" cy="45" rx="5" ry="3" fill="#fff" opacity=".75" transform="rotate(-30 38 45)"/>`,
      // Formiguinha: o cofrinho porquinho, para quem não tirou nada
      guardou: `
        <ellipse cx="48" cy="58" rx="27" ry="22" fill="#ff8fd4"/>
        <ellipse cx="48" cy="54" rx="27" ry="22" fill="#ffb3e0" stroke="#e879c0" stroke-width="3"/>
        <ellipse cx="70" cy="52" rx="9" ry="7.5" fill="#ff9fd8" stroke="#e879c0" stroke-width="2.5"/>
        <circle cx="68" cy="50" r="1.8" fill="#c2569f"/><circle cx="73" cy="50" r="1.8" fill="#c2569f"/>
        <path d="M30 40 l-3 -13 l13 6 z" fill="#ff9fd8" stroke="#e879c0" stroke-width="2.5"/>
        <circle cx="40" cy="49" r="3" fill="#2b3a44"/>
        <rect x="40" y="30" width="17" height="5" rx="2.5" fill="#e879c0"/>
        <rect x="30" y="72" width="8" height="9" rx="4" fill="#e879c0"/>
        <rect x="56" y="72" width="8" height="9" rx="4" fill="#e879c0"/>
        <circle cx="24" cy="60" r="7" fill="#ffc93c" stroke="#e0a010" stroke-width="2.5"/>`,
      // Coração grande: medalha com coração
      doou: `
        ${fita('#ff3d94', '#d81b74')}
        <circle cx="48" cy="60" r="24" fill="#d81b74"/>
        <circle cx="48" cy="58" r="24" fill="#ff5ca8" stroke="#d81b74" stroke-width="3"/>
        <circle cx="48" cy="58" r="17" fill="#ffd0e6"/>
        <path d="M48 68 c-9 -6 -13 -11 -13 -16 a6.5 6.5 0 0 1 13 -2.5 a6.5 6.5 0 0 1 13 2.5 c0 5 -4 10 -13 16 z" fill="#ff3d94"/>
        <ellipse cx="38" cy="45" rx="5" ry="3" fill="#fff" opacity=".7" transform="rotate(-30 38 45)"/>`,
      // Moeda mágica: a moeda com varinha e brilho
      moeda: `
        <circle cx="48" cy="56" r="26" fill="#e0a010"/>
        <circle cx="48" cy="53" r="26" fill="#ffc93c" stroke="#e0a010" stroke-width="3"/>
        <circle cx="48" cy="53" r="18.5" fill="#fff0b8"/>
        <text x="48" y="61" font-size="21" text-anchor="middle" fill="#8a5a00"
              font-family="system-ui, sans-serif" font-weight="700">R$</text>
        <path d="M72 26 l3.6 7.4 8 1.1 -5.8 5.7 1.4 8 -7.2 -3.9 -7.2 3.9 1.4 -8 -5.8 -5.7 8 -1.1 z"
              fill="#fff" opacity=".95"/>
        <ellipse cx="36" cy="38" rx="6" ry="3.5" fill="#fff" opacity=".8" transform="rotate(-30 36 38)"/>`,
      // Chegou lá: a taça grande, o prêmio final
      meta: `
        ${raios}
        <path d="M27 30 h42 v20 a21 21 0 0 1 -42 0 z" fill="#ffc93c" stroke="#e0a010" stroke-width="3.5"/>
        <path d="M27 35 h-11 a13 13 0 0 0 13 15" fill="none" stroke="#e0a010" stroke-width="4.5"/>
        <path d="M69 35 h11 a13 13 0 0 1 -13 15" fill="none" stroke="#e0a010" stroke-width="4.5"/>
        <circle cx="48" cy="42" r="10" fill="#fff0b8"/>
        <path d="M48 34 l2.8 5.7 6.2 .9 -4.5 4.4 1.1 6.2 -5.6 -3 -5.6 3 1.1 -6.2 -4.5 -4.4 6.2 -.9 z" fill="#e0a010"/>
        <rect x="42" y="70" width="12" height="13" fill="#e0a010"/>
        <rect x="29" y="82" width="38" height="10" rx="5" fill="#e0a010"/>
        <rect x="33" y="38" width="7" height="13" rx="3.5" fill="#fff" opacity=".55"/>`,
    };

    const desenho = arte[id] || arte.tarefas;
    return `
<svg viewBox="0 0 96 96" aria-hidden="true">
  ${ganho && id !== 'meta' ? raios : ''}
  <g class="premio-arte">${desenho}</g>
  ${ganho ? faiscas : ''}
</svg>`;
  },

  // O cadeado do prêmio bloqueado, pequeno, no canto da silhueta
  cadeadoMini() {
    return `
<svg class="cad-mini" viewBox="0 0 40 44" aria-hidden="true">
  <path d="M12 20 v-6 a8 8 0 0 1 16 0 v6" fill="none" stroke="#9fb3bf" stroke-width="5" stroke-linecap="round"/>
  <rect x="5" y="19" width="30" height="22" rx="6" fill="#b8cdd8" stroke="#9fb3bf" stroke-width="2.5"/>
  <circle cx="20" cy="29" r="3.4" fill="#6b8290"/>
  <rect x="18.2" y="30" width="3.6" height="6.5" rx="1.8" fill="#6b8290"/>
</svg>`;
  },

  // O cadeado da tela de senha: fechado ao pedir, aberto ao acertar
  cadeado(aberto) {
    return `
<svg class="cadeado ${aberto ? 'aberto' : ''}" viewBox="0 0 60 74" width="62" height="76" aria-hidden="true">
  <path class="cad-arco" d="M17 32 v-9 a13 13 0 0 1 26 0 v9" fill="none" stroke="#ffc93c" stroke-width="7" stroke-linecap="round"/>
  <rect x="8" y="30" width="44" height="36" rx="10" fill="#e0a010"/>
  <rect x="8" y="28" width="44" height="36" rx="10" fill="#ffc93c" stroke="#e0a010" stroke-width="2.5"/>
  <circle cx="30" cy="43" r="6" fill="#8a5a00"/>
  <rect x="27" y="45" width="6" height="11" rx="3" fill="#8a5a00"/>
  <ellipse cx="19" cy="35" rx="5" ry="3" fill="#fff" opacity=".6" transform="rotate(-28 19 35)"/>
</svg>`;
  },

  /* ---------- A TRILHA DO SONHO ----------
     Um tubo de vidro que enche, com bandeirinhas nas etapas. Substituiu a barra
     de progresso cinza: a barra dizia "43%", que aos seis anos é ruído; a trilha
     mostra o caminho, onde ela está e quanto falta até o brinquedo. */
  trilha(pct, icone) {
    const p = Math.max(0, Math.min(100, pct));
    const L = 300, x0 = 12, y = 30, alt = 26;
    const cheio = (L - x0 * 2) * (p / 100);

    // Quatro bandeirinhas nas etapas de 25 em 25
    let bandeiras = '';
    for (let i = 1; i <= 4; i++) {
      const etapa = i * 25;
      const bx = x0 + (L - x0 * 2) * (etapa / 100);
      const passou = p >= etapa;
      bandeiras += `
        <g ${passou ? 'class="bandeira-ja"' : ''}>
          <rect x="${bx - 1.4}" y="${y - 16}" width="2.8" height="${alt + 16}" rx="1.4"
                fill="${passou ? '#e0a010' : '#c9dfec'}"/>
          <path d="M${bx + 1} ${y - 16} l14 5 l-14 5 z" fill="${passou ? '#ffc93c' : '#dbe9f1'}"
                stroke="${passou ? '#e0a010' : '#c9dfec'}" stroke-width="1.5"/>
        </g>`;
    }

    let bolhas = '';
    if (cheio > 20) {
      for (let i = 0; i < 5; i++) {
        const bx = x0 + 10 + (cheio - 16) * (i / 5);
        bolhas += `<circle class="trilha-bolha" cx="${bx}" cy="${y + alt / 2}" r="${2 + (i % 3)}" fill="#fff" opacity=".6"/>`;
      }
    }

    return `
<svg viewBox="0 0 340 62" aria-hidden="true">
  <defs>
    <clipPath id="cp-trilha"><rect x="${x0}" y="${y}" width="${L - x0 * 2}" height="${alt}" rx="13"/></clipPath>
    <linearGradient id="grad-trilha" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#2b7fff"/>
      <stop offset="100%" stop-color="#5fb8ff"/>
    </linearGradient>
  </defs>

  <!-- o tubo de vidro -->
  <rect x="${x0}" y="${y}" width="${L - x0 * 2}" height="${alt}" rx="13"
        fill="#eaf4fa" stroke="#b8d4e2" stroke-width="3"/>
  <g clip-path="url(#cp-trilha)">
    <rect class="trilha-liq" x="${x0}" y="${y}" width="${cheio}" height="${alt}" fill="url(#grad-trilha)"/>
    ${cheio > 8 ? `<rect x="${x0}" y="${y + 2}" width="${cheio}" height="7" rx="3.5" fill="#fff" opacity=".32"/>` : ''}
    ${bolhas}
  </g>
  <!-- brilho no vidro -->
  <rect x="${x0 + 6}" y="${y + 3}" width="${L - x0 * 2 - 12}" height="5" rx="2.5" fill="#fff" opacity=".45"/>
  ${bandeiras}
  <!-- o brinquedo esperando no fim da trilha -->
  <circle cx="${L + 16}" cy="${y + alt / 2}" r="21" fill="#fff" stroke="${p >= 100 ? '#ffc93c' : '#b8d4e2'}" stroke-width="3.5"/>
  <text x="${L + 16}" y="${y + alt / 2 + 8}" font-size="22" text-anchor="middle">${icone || '🎁'}</text>
  ${p >= 100 ? `<g class="premio-faisca" fill="#ffc93c">
    <circle cx="${L - 6}" cy="${y - 6}" r="3"/><circle cx="${L + 38}" cy="${y + 34}" r="2.5"/>
  </g>` : ''}
</svg>`;
  },

  /* CONFETE em SVG animado por CSS: 30 pedacinhos com atraso e giro próprios.
     Não é enfeite gratuito — é o "deu certo" que a criança entende antes de ler
     qualquer aviso, e some sozinho para não virar poluição. */
  confete() {
    const cores = ['#00d68f', '#2b7fff', '#ff3d94', '#ffc93c', '#ff8a3d', '#9b6bff'];
    let pecas = '';
    for (let i = 0; i < 30; i++) {
      const x = 3 + Math.random() * 94;
      const cor = cores[i % cores.length];
      const atraso = (Math.random() * 0.8).toFixed(2);
      const giro = Math.round(Math.random() * 360);
      pecas += i % 4 === 0
        ? `<circle cx="${x.toFixed(1)}" cy="-4" r="1.6" fill="${cor}" style="animation-delay:${atraso}s"/>`
        : `<rect x="${x.toFixed(1)}" y="-6" width="2.6" height="4" rx=".8" fill="${cor}"
             style="animation-delay:${atraso}s; transform-origin:center; transform:rotate(${giro}deg)"/>`;
    }
    return `<svg class="confete" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pecas}</svg>`;
  },

  /* ---------- O CÉU ----------
     O mundo onde o Dino mora: gradiente de céu, sol, nuvens que atravessam a tela
     e um balão de ar. Fica atrás de tudo, fixo, e não recebe toque. */
  cenario() {
    return `
<div class="cenario" aria-hidden="true">
<svg class="ceu" viewBox="0 0 400 800" preserveAspectRatio="xMidYMin slice">
  <defs>
    <linearGradient id="g-ceu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a8e0ff"/>
      <stop offset="46%" stop-color="#d6f0ff"/>
      <stop offset="100%" stop-color="#fff6d9"/>
    </linearGradient>
    <radialGradient id="g-sol" cx="50%" cy="50%">
      <stop offset="0%" stop-color="#fff6c9"/>
      <stop offset="100%" stop-color="#ffd75e"/>
    </radialGradient>
    <!-- bolinhas: o padrao sutil de fundo, que da textura sem competir -->
    <pattern id="pontos" width="34" height="34" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="8" r="2.6" fill="#fff" opacity=".3"/>
      <circle cx="25" cy="24" r="1.8" fill="#fff" opacity=".22"/>
    </pattern>
  </defs>

  <rect width="400" height="800" fill="url(#g-ceu)"/>
  <rect width="400" height="800" fill="url(#pontos)"/>

  <!-- o sol, com raios que giram devagar -->
  <g class="sol">
    ${Array.from({ length: 12 }, (_, i) =>
      `<rect x="350" y="20" width="4" height="14" rx="2" fill="#ffd75e" opacity=".55"
             transform="rotate(${i * 30} 352 62)"/>`).join('')}
  </g>
  <circle cx="352" cy="62" r="30" fill="url(#g-sol)"/>

  <!-- nuvens, cada uma no seu tempo -->
  <g class="nuvem n1" opacity=".92">
    <ellipse cx="60" cy="58" rx="34" ry="19" fill="#fff"/>
    <ellipse cx="90" cy="63" rx="25" ry="14" fill="#fff"/>
    <ellipse cx="38" cy="66" rx="20" ry="12" fill="#fff"/>
  </g>
  <g class="nuvem n2" opacity=".7">
    <ellipse cx="250" cy="128" rx="28" ry="15" fill="#fff"/>
    <ellipse cx="274" cy="132" rx="20" ry="11" fill="#fff"/>
  </g>
  <g class="nuvem n3" opacity=".5">
    <ellipse cx="140" cy="196" rx="24" ry="12" fill="#fff"/>
    <ellipse cx="160" cy="199" rx="17" ry="9" fill="#fff"/>
  </g>

  <!-- um balao de ar quente, longe, so para ter o que descobrir na tela -->
  <g class="balao-ar" opacity=".9">
    <path d="M318 168 q-15 -22 0 -38 q15 16 0 38 z" fill="#ff8a3d"/>
    <path d="M318 168 q-8 -22 0 -38 q8 16 0 38 z" fill="#ffc93c"/>
    <rect x="314" y="169" width="8" height="6" rx="2" fill="#8a5a00"/>
  </g>

  <!-- morrinhos verdes no rodape do ceu -->
  <path d="M0 700 q70 -54 150 -8 q60 34 120 -14 q70 -52 130 14 v108 H0 z" fill="#8fe3b8" opacity=".55"/>
  <path d="M0 740 q90 -40 180 4 q90 44 220 -18 v74 H0 z" fill="#6fd7a4" opacity=".45"/>
</svg>
</div>`;
  },
};

/* ===========================================================================
   PROMPTS DE IMAGEM — para o que não vale desenhar à mão em SVG

   As peças abaixo ficariam pobres ou enormes em SVG inline. O layout do app já
   está pronto para elas: cada uma tem um SVG simples no lugar agora, e trocar
   por PNG é só soltar o arquivo em cofrinho/icons/ e apontar. Nenhuma é
   necessária para o app funcionar — são melhorias de acabamento.

   Gere em fundo TRANSPARENTE (PNG), 1024×1024, e reduza para ~512.

   ---------------------------------------------------------------------------
   1. MASCOTE — pose de comemoração de corpo inteiro (tela de prêmio/meta batida)
      arquivo: cofrinho/icons/dino-festa.png

   "Cute chubby cartoon baby dinosaur mascot, mint green body with pale cream
   belly, three small rounded back plates, big round friendly eyes, rosy cheeks,
   wide open happy smile, both tiny arms raised in celebration, jumping in the
   air, confetti around, 3D claymorphism style, soft matte clay texture, soft
   studio lighting, thick rounded shapes, no outlines, kawaii, children's app
   mascot, transparent background, centered, full body"

   ---------------------------------------------------------------------------
   2. MASCOTE — pose sentado contando moedas (tela do cofrinho vazio)
      arquivo: cofrinho/icons/dino-moedas.png

   "Cute chubby cartoon baby dinosaur mascot, mint green body with pale cream
   belly, sitting on the floor happily counting a small pile of golden coins,
   one coin held up in tiny hand, glass jar beside it, big round friendly eyes,
   rosy cheeks, gentle smile, 3D claymorphism style, soft matte clay texture,
   soft studio lighting, thick rounded shapes, kawaii, children's app
   illustration, transparent background, centered"

   ---------------------------------------------------------------------------
   3. RECOMPENSA — baú do tesouro aberto (sonho alcançado)
      arquivo: cofrinho/icons/bau.png

   "Cute cartoon treasure chest, open lid, overflowing with shiny golden coins
   and one big star, warm wooden body with rounded soft edges, golden metal
   bands, magical sparkles rising, 3D claymorphism style, soft matte clay
   texture, glossy highlights, children's game reward icon, vibrant saturated
   colors, transparent background, centered, no text"

   ---------------------------------------------------------------------------
   4. FUNDO — cenário de parquinho (opcional, no lugar do céu em SVG)
      arquivo: cofrinho/icons/fundo-parque.png  (2048×1024, sem transparência)

   "Seamless soft children's illustration background, sunny sky with fluffy
   rounded clouds, rolling green hills, a few simple trees, hot air balloon far
   away, pastel and vibrant palette, flat vector style with soft gradients, very
   low visual noise so UI cards stay readable, no characters, no text, wide
   panoramic"
   =========================================================================== */

if (typeof module !== 'undefined' && module.exports) module.exports = { Arte };
