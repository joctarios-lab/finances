# Gráficos com ApexCharts

Registro da troca do SVG desenhado à mão pela biblioteca, e das decisões que
sobreviveram à troca.

## Por que trocar

Os gráficos eram SVG escrito à mão, sem dependência. Funcionavam, mas tinham um
defeito de origem que nenhuma quantidade de ajuste resolvia: **o `viewBox`
escalava o texto junto com o desenho.**

Medido: `viewBox` de 720 num cartão de 307px dá escala 0,43. Um rótulo declarado
com 11px chegava à tela com 4,7px. Pior, o mesmo gráfico mudava de tamanho de
fonte conforme a largura do cartão — 15,9px num card cheio de desktop.

A gambiarra que sustentava isso era manter **todo o texto num overlay HTML**
posicionado em porcentagem sobre o SVG, e usar `vector-effect: non-scaling-stroke`
em cada traço. Funcionava, mas cobrava caro:

- Dois sistemas de coordenadas para manter em sincronia a cada mudança
- Marcador de ponto tinha de ser `<div>` com `border-radius`, porque `<circle>`
  em SVG esticado vira elipse
- Nenhuma dica de valor no toque sem escrever o handler de ponteiro à mão
- Curva suave exigia Catmull-Rom → Bézier com ponto de controle travado, e um
  teste que amostrava a própria curva para provar que ela não inventava valor

## O que a biblioteca resolveu

| Antes (SVG à mão) | Agora |
|---|---|
| Texto no overlay HTML, em % sobre o SVG | Texto desenhado em px reais do aparelho |
| `vector-effect` em cada traço | Traço em px reais |
| Ponto como `<div>` para não virar elipse | Marcador nativo, redondo |
| Handler de ponteiro próprio por gráfico | Dica nativa, com toque |
| Catmull-Rom com controle travado | `stroke.curve: 'smooth'` |
| Canto arredondado por comando de path | `borderRadius` + `borderRadiusApplication` |

## O que continua sendo decisão nossa

A biblioteca desenha; ela não decide. Isto ficou codificado em `js/app.js` e é o
que os testes verificam:

- **Qual forma para qual dado.** Cascata para "por que sobrou tão pouco", rosca
  para "qual a maior fatia", área para nível, barra para movimento.
- **Ponta arredondada, pé reto** (`borderRadiusApplication: 'end'`). Arredondar a
  base faria a barra parecer flutuar acima do zero.
- **Marca fina.** Coluna que preenche a faixa lê como bloco, não como valor.
- **Referência é linha, não série.** Renda, média e faixa de normalidade entram
  como anotação: como série entrariam na legenda e no tooltip como se fossem
  valor medido.
- **A fronteira de hoje aparece três vezes** — faixa sombreada, rótulo
  "previsto" e trecho tracejado (`forecastDataPoints`). Confundir previsão com
  fato é o pior engano possível num app de finanças.
- **A dica da composição é própria.** A nativa mostraria um segmento isolado, e
  um segmento sozinho não diz composição. A nossa lista todos os itens do
  envelope com percentuais e destaca só o apontado.
- **Cor hierárquica por PONTO, não por série** (`fillColor` no dado). A
  subcategoria "slot 2" de Casa não tem relação com a "slot 2" de Transporte.
- **Nome nunca é cortado com reticências.** O ApexCharts trunca no `maxWidth`;
  `quebrarRotulo` devolve array, que é como a lib desenha várias linhas.
- **Fonte herdada** (`fontFamily: 'inherit'`). É o detalhe que mais delata
  gráfico de biblioteca colado num layout.

## Os gráficos

Oito passam por `Graficos.novo()`, e cada um se identifica no `data-g` do div:

| `data-g` | Função | Forma |
|---|---|---|
| `fluxo-saldo` | `svgFluxoSaldo` | colunas + área, dois eixos |
| `cascata` | `svgCascata` | barra empilhada com pedestal invisível |
| `faixa-normal` | `svgLinhaFaixa` | área + faixa como anotação |
| `composicao` | `svgComposicao` | barra horizontal empilhada, cor por ponto |
| `ranking` | `svgRanking` | barra horizontal, cor por linha |
| `burnup` | `svgBurnup` | área + trilha ideal tracejada |
| `barras` | `svgBars` | colunas, período atual em destaque |
| `saldo-dia` | `sparkArea` | sparkline no resumo do extrato |

### A rosca é a exceção: continua desenhada à mão

`svgDonut` foi convertida e depois **revertida**, a pedido de quem usa o app. A
reversão se sustenta em medida, não em gosto: a rosca é **quadrada e com proporção
preservada**, então a escala do `viewBox` fica entre 0,79 e 1,04 — o defeito que
motivou a biblioteca (rótulo de 11px chegando a 4,7px na tela) **nunca existiu
aqui**. É o `clamp(190px, 46%, 250px)` do `.donut-svg` que garante isso; sem o
teto de 250px o anel esticaria num card largo e a escala fugiria da faixa.

Em troca, o formato à mão dá duas coisas que a rosca da biblioteca não dava:

- **O total no centro** em duas ou três linhas de tipografia nossa (`.dn-total`,
  `.dn-cap`, `.dn-sub`). O buraco do meio é onde mora o número que responde à
  pergunta do cartão, sem gastar uma linha de texto abaixo do gráfico.
- **A legenda como TABELA ao lado** — nome, percentual e valor em colunas
  alinhadas. A legenda da biblioteca é uma fila de pastilhas, que não alinha
  número nenhum.

Detalhes do formato, todos travados por teste: respiro de 2,5 entre fatias (o vão
falta de verdade do anel, não é só um `dasharray` qualquer), ponta arredondada em
cada fatia, trilho cinza por baixo (sem ele, com uma fatia só não se vê a volta
completa e não dá para julgar a proporção), e hover que **engorda** a fatia em vez
de mudar de cor — cor é identidade e não pode variar com o ponteiro.

Os cartões que a envolvem, no Painel e nos Relatórios, nunca mudaram: só a função
tinha sido trocada.

## O eixo duplo do "De onde vim, para onde vou"

É o único gráfico com duas escalas, e vale registrar por quê, porque eixo duplo é
o erro mais comum em gráfico financeiro.

Fluxo mensal vive na casa dos milhares; saldo acumulado, nas dezenas de milhares.
Numa escala só, o saldo achata as barras a nada. Não há como fugir das duas
escalas — o que dá para fazer é **não esconder que são duas**:

- Cada eixo rotulado, o do saldo **na cor da própria série**
- Nota no cartão dizendo, por escrito, que onde a linha cruza as barras não
  significa nada

A alternativa (dois painéis empilhados) foi tentada e recusada três vezes por
quem usa. O formato combinado foi decisão consciente de quem usa o app, com a
mitigação acima.

## O CSS da biblioteca — o erro que a comparação com o Metronic revelou

Na primeira entrega eu vendorizei só o `apexcharts.min.js`. **Errado: o `.min.js`
não injeta o CSS da biblioteca.** Verificado procurando as assinaturas do
stylesheet dentro do arquivo — nenhuma está lá.

Sem `apexcharts.css` a dica de valor perde a caixa e, pior, perde o
`.apexcharts-canvas { position: relative }` que a ancora: a dica é
`position: absolute` e voaria para o canto da página em vez de ficar sobre o
gráfico. O Metronic traz esse CSS embutido no `plugins.bundle.css`, e foi
comparando com ele que o erro apareceu.

`vendor/apexcharts.css` (13 KB) entra **antes** do nosso `styles.css`, para o
nosso poder sobrepor, e vai para o cache do service worker junto.

## Gráficos de linha: o Charts Widget 29 do demo25

"Ritmo do mês" (`svgBurnup`), a faixa de normalidade (`svgLinhaFaixa`) e o saldo
diário do extrato (`sparkArea`) seguem o `#kt_charts_widget_29`. O acabamento vive
em `Graficos.linha()`, compartilhado pelos três:

- **Mira vertical tracejada** seguindo o cursor (`xaxis.crosshairs`), na frente do
  desenho. É o que transforma a silhueta em leitura: dá para saber o valor do dia
  12, não só que a curva subiu. No sparkline isso substituiu um handler de ponteiro
  escrito à mão.
- **`states` com filtro `none` nos três estados.** Sem isso a lib clareia a série
  inteira no hover, e numa área com degradê o clareamento come o próprio degradê —
  a forma "pisca" e o olho perde a referência.
- **`tickAmount: 4`** nos eixos: quatro marcas dão a régua sem virar gaiola.
- **Cor do traço declarada em `stroke.colors`**, não só em `colors`.
- **Marcador com anel de 3px** na cor da superfície, que destaca sem engordar.

### Por que a trilha ideal não aparecia

Duas causas, e a primeira é um **defeito da própria biblioteca**.

**1. `stroke.curve` como array.** Lendo o fonte do ApexCharts: num ponto ela
resolve `stroke.curve[serie]` corretamente, mas na checagem de ponto nulo compara
`config.stroke.curve` **direto com a string** `'smooth'`. Com
`curve: ['smooth','straight']` essa comparação nunca casa, os nulos do futuro do
mês param de abrir intervalo e a área desce até o zero em vez de terminar em hoje.
A regra passou a ser: **`curve` é sempre escalar**. Suavizar as duas não custa
nada — a trilha é linear, e curva suave sobre série linear é uma reta.

**2. `fill.opacity: [1, 0]`.** A intenção era "não preencher sob a trilha", mas o
path da linha nasce com `fill: "none"` (verificado no fonte), então isso não fazia
nada além de esconder a intenção de quem lê o código. Saiu.

### O defeito que a estrutura causou

A primeira versão de `linha()` devolvia um objeto para ser espalhado **ao lado** de
`base()`. Dois helpers donos do mesmo `xaxis`, e o último espalhado ganha: os eixos
da base eram apagados inteiros, levando com eles o tamanho da fonte que tinha sido
alinhado ao layout no commit anterior.

Agora `linha()` **recebe** a base e sobrepõe (`Graficos.linha(Graficos.base(…),
cor)`). Não há como duplicar. E `base()` passou a **mesclar** `labels` em vez de
deixar o gráfico substituí-lo — espalhar `...extra` trocava `labels` inteiro, e
como quase todo gráfico passa um `formatter` ali, o `style` com o tamanho era
descartado justamente nos que mais precisam dele.

## Rankings: o Charts Widget 27 do demo25

Os rankings — "De onde vem o dinheiro", categoria, membro, forma de pagamento,
etiqueta e o detalhe do envelope — seguem o `#kt_charts_widget_27` da página
`dashboards/website-analytics.html`. Ele é exatamente esta forma: poucas barras
horizontais, uma cor por linha, valor escrito na própria barra.

O que veio dele:

| | valor | por quê |
|---|---|---|
| `borderRadius` | 8 | canto generoso; a barra é espessa e aguenta |
| `barHeight` | 34px (não `%`) | passo de 48px, ~71% — a proporção dele (70/50) |
| `dataLabels.position` | `bottom` | o valor nasce **dentro** da barra, na base |
| grade | vertical sim, horizontal não | em barra horizontal a perpendicular é régua de comprimento; a horizontal seria risco entre barras, medindo nada |

A barra generosa é o que mais rende: as linhas de 34px de passo eram filete, e é
disso que vem a impressão de gráfico desenhado em vez de encaixado.

### A divergência necessária: a cor do rótulo é calculada

No widget 27 o rótulo dentro da barra é **branco fixo** — funciona porque a paleta
do demo é escura. Na nossa não: medido, branco sobre o âmbar `#ffc700` dá
**1,56:1**, texto presente no HTML e invisível na tela. **Seis dos dez tons da
paleta reprovariam.**

Então `corDeTextoSobre()` calcula a luminância relativa (WCAG) e devolve o lado que
contrasta mais. Com isso os dez tons passam em AA (≥ 4,5:1) — o pior fica em 4,55.
No ApexCharts isso é possível porque, em barra **distribuída**, ele indexa
`dataLabels.style.colors` por ponto e não por série (verificado no fonte da lib).

Há um segundo caso que o widget 27 não tem: **barra curta**. Abaixo de 30% da
maior, o rótulo não cabe dentro e transborda para o fundo do cartão — aí a cor da
barra não serve, e o rótulo vai na tinta escura.

### O que NÃO foi copiado

- **Vertical (`svgBars`)** continua com canto 5. Raio tem de ser proporcional à
  espessura: 8 numa coluna de 24px de largura viraria pastilha.
- **`svgComposicao`** também fica em 4 — a barra dela tem ~24px de altura, e 8
  comeria um terço.
- **A paleta** é a nossa. A do demo (`#3E97FF`, `#FFC700`…) trocaria a identidade
  de cor que o app já usa em toda parte.

## Eixo de valor oculto

O eixo de valor é uma coluna de números que ninguém lê dígito por dígito: ele serve
para estimar altura, e a grade sozinha já faz isso. Tirá-lo devolve a largura ao
desenho — num cartão de celular a coluna comia uns 15%. É o que os widgets do
Metronic fazem: `yaxis: { labels: { show: false } }` com as linhas de grade de pé.

Cinco funções passaram por `Graficos.semEixoDeValor()`, cobrindo os oito cartões:

| cartão | função | onde o número ficou |
|---|---|---|
| Evolução dos gastos | `svgBars` | rótulo no topo da coluna |
| Ritmo do mês | `svgBurnup` | rótulo no ponto de hoje |
| O caminho do dinheiro | `svgCascata` | rótulo em cada bloco |
| Isso é normal para vocês? | `svgLinhaFaixa` | rodapé do cartão |
| Saldo projetado | `svgLinhaFaixa` | rodapé do cartão |
| Quem gastou / Como pagou / Por etiqueta | `svgRanking` | dentro da barra |

**A condição para tirar o eixo é o número estar em outro lugar.** Três dos oito
não tinham: nas colunas de evolução, no burn-up e na cascata o eixo era a única
fonte numérica. O valor foi para cima da marca **antes** de o eixo sair — que é a
substituição correta (rótulo direto no lugar da coluna de números), e não por
acaso é o que a versão desenhada à mão fazia antes da conversão para a biblioteca.

**A grade fica.** Ela é a régua que permite comparar alturas entre si; tirar as
linhas junto com os números deixaria o gráfico sem referência nenhuma.

O rótulo é **seletivo onde a forma importa mais que os números** e **completo onde
os números são a conta**:

- `svgBars`: só o período atual e o maior. Seis números lado a lado viram uma
  segunda linha de texto e o olho para de ver a forma.
- `svgBurnup`: só o ponto de hoje, e nada na trilha ideal — marcar uma referência
  calculada como se fosse dinheiro gasto seria a pior leitura possível.
- `svgCascata`: em todos os blocos, porque ali cada número é uma parcela da conta
  sendo feita ("entrou 8.500, saiu 5.200, sobrou 1.200"). Menos no **pedestal**,
  que tem valor e não é dinheiro.

### Os dois que mantiveram o eixo

"Envelope por dentro" (`svgComposicao`) e "De onde vim, para onde vou"
(`svgFluxoSaldo`) não estavam no pedido, e nenhum dos dois escreve valor na marca
nem no rodapé — tirar o eixo deles deixaria o gráfico mudo. Há teste garantindo que
os dois **continuam** com eixo, para que uma mudança geral no futuro não os inclua
por engano.

Também há um teste de rede: em cada tela, nenhum gráfico pode ficar **sem eixo e
sem rótulo** ao mesmo tempo. A única exceção é a faixa de normalidade, e ela é
verificada pelo outro lado — que o rodapé do cartão traz os números.

## Acabamento medido contra o Metronic

| | Metronic | nosso, depois |
|---|---|---|
| grade | tracejada, `strokeDashArray: 4` | igual |
| degradê de área | `.4 → 0`, stops `[0, 80, 100]` | igual |
| anel do marcador | 3px | igual |
| dica | clara (`--bs-body-bg`) | **escura**, como as demais dicas do app |
| eixo Y | escondido na maioria dos widgets | **visível** — aqui se leem valores |

A grade tracejada foi a mudança de maior efeito: linha sólida tem presença de
dado, e a grade é régua. Isso obrigou a inverter a referência — renda, média e
mediana passaram a ser **sólidas coloridas**, porque antes a grade era sólida e a
referência tracejada, e as duas competiam pela mesma leitura. Agora cinza
tracejado é régua e colorido sólido é limite, e cada uma diz o que é sem legenda.

As duas últimas linhas da tabela são divergências deliberadas: a dica escura
segue a linguagem que o app já tinha, e esconder o eixo Y ficaria bonito mas
tiraria justamente o número que se vem conferir num app de finanças.

## Custos aceitos

**Peso: 627 KB → 1.160 KB (+85%).** A lib é 527 KB de JS mais 13 KB de CSS
(136 KB em gzip no JS), licença MIT. É **vendorizada em `vendor/`, não de CDN**: o app é offline-first, e
um `<script src="https://…">` deixaria todos os gráficos em branco justamente
quando o app mais tem valor. Entra no `sw.js`, então é download único por
aparelho e continua funcionando sem rede.

**Verificação de pixel: perdida.** A suíte roda headless, com DOM falso — não há
como o ApexCharts desenhar ali. Em troca, os testes deixaram de conferir
coordenada de `path` (detalhe de como o desenho foi feito) e passaram a conferir
**a configuração**: qual forma, qual série, qual escala, qual cor, qual
formatador. A matemática do dinheiro (`fluxoMensal`, `previsaoDoMes`,
`saldoPrevistoNaData`) segue integralmente coberta.

`Graficos.montar()` é no-op sem a biblioteca carregada. Isso é proposital: é o
que permite a suíte exercitar toda a montagem das telas.

## Ciclo de vida — o risco novo

O SVG à mão não tinha estado. Cada gráfico da biblioteca é um objeto com
listeners de resize, e o `innerHTML` da próxima tela apaga o elemento **sem**
destruir o objeto. Sem limpeza, o app acumularia gráficos órfãos e ficaria mais
lento a cada navegação.

Por isso `render()` faz `Graficos.limpar()` **antes** de `Graficos.montar()`, e
montar o mesmo id destrói a instância anterior primeiro. Coberto por teste,
incluindo a simulação de troca de tela.

## Código morto removido na troca

`caminhoSuave` (Catmull-Rom), `ligarGrafico` (handler de ponteiro do sparkline),
`ligarComposicao` (tooltip manual do envelope), `fatiaEm` (qual segmento está sob
o dedo) e 66 seletores de CSS — `.ch-*`, `.fl-*` do desenho, `.comp-*`, `.rank-*`,
`.dn-*`, `.g-*`, `.spark-*`.
