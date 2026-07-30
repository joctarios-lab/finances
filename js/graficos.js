/* Finanças da Família — gráficos com ApexCharts

   ApexCharts precisa de um elemento JÁ NO DOM para medir e desenhar, mas o app
   monta cada tela com innerHTML de uma vez. Então o fluxo é em dois tempos: as
   funções de gráfico devolvem um <div> vazio e registram a configuração aqui;
   depois que a tela está no DOM, montar() instancia tudo.

   Sem ApexCharts carregado, montar() não faz nada e o <div> fica vazio. Isso é
   proposital: os testes rodam headless, sem DOM real nem APIs de medição SVG, e é
   assim que eles continuam exercitando o caminho de render e as funções de dados
   — que é onde mora a matemática do dinheiro. */
'use strict';

const Graficos = {
  fila: [],          // { id, opts } aguardando o DOM
  /* id -> { opts, chart }. Guarda a instância para destruir antes de redesenhar,
     e a configuração junto: é por ela que se sabe o que está desenhado na tela
     sem ler pixel. Quando a biblioteca não está carregada, chart fica null e
     só a configuração fica registrada. */
  vivos: new Map(),
  seq: 0,

  // Cores do tema, num lugar só: trocar a paleta não deve exigir caçar hex
  cor: {
    azul: '#009ef7', verde: '#50cd89', vermelho: '#f1416c',
    roxo: '#7239ea', ambar: '#f6a609', cinza: '#a1a5b7',
    tinta: '#181c32', tintaFraca: '#6b6f85', linha: '#eff2f5',
  },

  /* Tamanhos de texto dos gráficos, num lugar só e ancorados no layout.

     Medido no styles.css: o texto que fica AO LADO dos gráficos é 13,5px na
     legenda da rosca e 13px nas tabelas de relatório. Os eixos estavam em 11px —
     o menor texto da vizinhança, dois pontos e meio abaixo da legenda que fica
     encostada neles, e era isso que fazia o gráfico parecer de outro layout.

     `eixo` casa com a tabela de relatório, que é o análogo mais próximo (uma
     grade de rótulos de dado). `ref` fica um passo abaixo de propósito: renda,
     média e "previsto" são anotação, não dado, e têm de recuar. */
  fonte: {
    eixo: '13px',    // nome de mês, categoria, valor de escala
    valor: '12px',   // número escrito sobre a própria marca
    ref: '11px',     // rótulo de linha de referência e de faixa
    dica: '12px',    // conteúdo do balão
  },

  /* Registra um gráfico e devolve o div onde ele vai nascer.

     `nome` diz o que o gráfico É (cascata, fluxo-saldo), não como foi desenhado.
     Vira classe e data-atributo: é por onde o CSS ajusta um gráfico específico e
     por onde se identifica no HTML qual gráfico está em qual lugar da tela.
     A altura vem no style para o cartão não pular quando o gráfico monta. */
  novo(opts, altura, nome) {
    const id = `apx-${++this.seq}`;
    this.fila.push({ id, opts, nome });
    return `<div class="apx${nome ? ' apx-' + nome : ''}" id="${id}"`
      + `${nome ? ` data-g="${nome}"` : ''} style="min-height:${altura}px"></div>`;
  },

  /* Instancia o que está na fila. Chamado depois de a tela ir para o DOM.

     Destrói a instância anterior do mesmo id antes de criar: sem isso cada
     redesenho deixaria um gráfico órfão escutando resize, e o app ficaria mais
     lento a cada navegação. */
  montar() {
    const temLib = typeof ApexCharts !== 'undefined';
    let n = 0;
    for (const { id, opts, nome } of this.fila) {
      const el = document.getElementById(id);
      if (!el) continue;
      const antigo = this.vivos.get(id);
      if (antigo && antigo.chart) { try { antigo.chart.destroy(); } catch (_) {} }
      this.vivos.set(id, { opts, nome, chart: null });
      if (!temLib) continue;
      try {
        const c = new ApexCharts(el, opts);
        c.render();
        this.vivos.set(id, { opts, nome, chart: c });
        n++;
      } catch (_) { el.innerHTML = '<div class="empty">Não foi possível desenhar o gráfico.</div>'; }
    }
    this.fila = [];
    return n;
  },

  /* Destrói tudo que não está mais na tela. Chamado antes de trocar de aba: o
     elemento morre com o innerHTML, mas a instância continuaria viva na memória. */
  limpar() {
    for (const [id, reg] of this.vivos) {
      if (!document.getElementById(id)) {
        if (reg.chart) { try { reg.chart.destroy(); } catch (_) {} }
        this.vivos.delete(id);
      }
    }
  },

  // O que está montado agora, na ordem em que entrou — para inspeção
  montadas() { return [...this.vivos.values()]; },

  /* Base comum a todos: fonte herdada, sem barra de ferramentas, animação curta.

     `fontFamily: 'inherit'` é o que faz o gráfico usar a fonte do app em vez da
     Helvetica padrão do ApexCharts — é o detalhe que mais delata gráfico de
     biblioteca colado num layout. */
  base(altura, extra = {}) {
    return {
      chart: {
        fontFamily: 'inherit', height: altura, toolbar: { show: false },
        animations: { enabled: true, easing: 'easeout', speed: 320 },
        zoom: { enabled: false },
        ...(extra.chart || {}),
      },
      dataLabels: { enabled: false },
      /* Grade TRACEJADA e cinza-claro. Linha sólida tem presença de dado; a grade
         é régua, e régua tem de recuar. Medido contra o Metronic: era a diferença
         que mais fazia os gráficos deles respirarem em comparação aos nossos.

         Isso libera o SÓLIDO COLORIDO para as linhas de referência (renda, média,
         trilha ideal): antes a grade era sólida e a referência tracejada, e as
         duas competiam pela mesma leitura. Agora cinza tracejado é régua, colorido
         sólido é limite — e cada uma diz o que é sem legenda. */
      grid: {
        borderColor: this.cor.linha, strokeDashArray: 4,
        xaxis: { lines: { show: false } },
        yaxis: { lines: { show: true } },
        padding: { left: 6, right: 6, top: 0, bottom: 0 },
      },
      /* Rótulos no cinza de texto secundário: eles são referência, não dado.

         MESCLA `labels` em vez de deixar o gráfico substituí-lo. Espalhar o
         `...extra` sobre o objeto trocava `labels` inteiro, e como quase todo
         gráfico passa um `formatter` ali, o `style` com o tamanho da fonte era
         descartado justamente nos que mais precisam dele. */
      xaxis: {
        axisBorder: { show: false }, axisTicks: { show: false },
        crosshairs: { show: false },
        ...(extra.xaxis || {}),
        labels: {
          ...((extra.xaxis || {}).labels || {}),
          style: {
            colors: this.cor.tintaFraca, fontSize: this.fonte.eixo, fontWeight: 600,
            ...(((extra.xaxis || {}).labels || {}).style || {}),
          },
        },
      },
      yaxis: {
        ...(extra.yaxis || {}),
        labels: {
          ...((extra.yaxis || {}).labels || {}),
          style: {
            colors: this.cor.tintaFraca, fontSize: this.fonte.eixo,
            ...(((extra.yaxis || {}).labels || {}).style || {}),
          },
        },
      },
      tooltip: {
        style: { fontSize: this.fonte.dica, fontFamily: 'inherit' },
        ...(extra.tooltip || {}),
      },
      legend: { show: false },
      states: { hover: { filter: { type: 'darken', value: 0.9 } } },
    };
  },

  /* Acabamento comum aos gráficos de linha e área, do Charts Widget 29 do demo25.

     O que vem dele e vale para todos:

     - MIRA VERTICAL tracejada seguindo o cursor (`xaxis.crosshairs`), na frente do
       desenho. É o que transforma a silhueta em leitura: dá para saber o valor do
       dia 12, não só que a curva subiu. Antes isso exigia handler de ponteiro
       próprio; aqui é configuração.
     - `states` com filtro `none` nos três estados. Sem isso a lib clareia a série
       inteira ao passar o mouse, e numa área com degradê o clareamento come o
       degradê — a forma "pisca" e o olho perde a referência.
     - `tickAmount: 4` nos dois eixos: quatro marcas dão a régua sem virar gaiola.
     - Marcador com anel de 3px na cor da superfície, que destaca sem engordar.

     `cor` é a cor da série, usada na mira e no anel do marcador — assim a mira
     pertence visualmente à linha que ela está medindo.

     RECEBE a configuração base e sobrepõe, em vez de devolver um objeto para ser
     espalhado ao lado dela. A primeira versão fazia isso e apagava os eixos
     inteiros da base — com eles o tamanho da fonte, justamente o que tinha sido
     alinhado ao layout. Dois helpers donos do mesmo `xaxis` e o último espalhado
     ganha; recebendo a base, não há como duplicar. */
  linha(base, cor) {
    const bx = base.xaxis || {}, by = base.yaxis || {};
    return {
      ...base,
      xaxis: {
        tickAmount: 4,
        ...bx,
        labels: { rotate: 0, rotateAlways: false, ...(bx.labels || {}) },
        // Na frente do desenho, senão a linha e a área a cobrem
        crosshairs: { position: 'front', stroke: { color: cor, width: 1, dashArray: 3 } },
      },
      // Array de eixos (o fluxo tem dois) passa intacto: tickAmount ali é por eixo
      yaxis: Array.isArray(by) ? by : { ...by, tickAmount: by.tickAmount || 4 },
      // Hover não deve repintar a série: só a mira e a dica reagem ao cursor
      states: {
        normal: { filter: { type: 'none', value: 0 } },
        hover: { filter: { type: 'none', value: 0 } },
        active: { allowMultipleDataPointsSelection: false, filter: { type: 'none', value: 0 } },
      },
      markers: { ...(base.markers || {}), strokeColor: cor, strokeWidth: 3 },
    };
  },

  /* Eixo de valor OCULTO, mas com as linhas de grade de pé.

     O eixo de valor é uma coluna de números que ninguém lê dígito por dígito: ele
     serve para estimar altura, e a grade sozinha já faz isso. Tirá-lo devolve a
     largura inteira ao desenho — num cartão de celular a coluna comia uns 15%.

     A condição para tirar é o valor estar em outro lugar: escrito na própria marca
     ou no rodapé do cartão. Sem isso o gráfico fica mudo, e aí a economia de tinta
     custa a informação. Cada gráfico que usa isto tem essa garantia.

     É o que os widgets do Metronic fazem — medido no widgets.bundle.js deles:
     `yaxis: { labels: { show: false } }` com `yaxis: { lines: { show: true } }` na
     grade. O padding negativo recupera o vão que o eixo deixou.

     RECEBE a config e devolve uma cópia, como `linha()`. Devolver um fragmento
     para ser espalhado ao lado substituiria o eixo e a grade inteiros — foi
     exatamente esse o defeito que a primeira versão de `linha()` teve. */
  semEixoDeValor(cfg, orientacao = 'y') {
    const nomeEixo = orientacao === 'y' ? 'yaxis' : 'xaxis';
    const atual = cfg[nomeEixo] || {};
    // Array de eixos (o fluxo tem dois) esconde cada um deles
    const escondido = Array.isArray(atual)
      ? atual.map(e => ({ ...e, labels: { ...(e.labels || {}), show: false } }))
      : { ...atual, labels: { ...(atual.labels || {}), show: false } };
    const g = cfg.grid || {};
    return {
      ...cfg,
      [nomeEixo]: escondido,
      grid: {
        ...g,
        padding: {
          ...(g.padding || {}),
          // Recupera o vão que a coluna de números ocupava
          ...(orientacao === 'y' ? { left: -8 } : { bottom: -14 }),
        },
      },
    };
  },

  // Formatador de moeda para eixos e dicas — sempre em pt-BR, sempre compacto
  brl(v, compacto) {
    const n = Number(v) || 0;
    return compacto
      ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
      : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  },
};
