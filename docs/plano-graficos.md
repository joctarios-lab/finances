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

## Os nove gráficos

Todos passam por `Graficos.novo()`, e cada um se identifica no `data-g` do div:

| `data-g` | Função | Forma |
|---|---|---|
| `fluxo-saldo` | `svgFluxoSaldo` | colunas + área, dois eixos |
| `cascata` | `svgCascata` | barra empilhada com pedestal invisível |
| `faixa-normal` | `svgLinhaFaixa` | área + faixa como anotação |
| `composicao` | `svgComposicao` | barra horizontal empilhada, cor por ponto |
| `rosca` | `svgDonut` | donut com total no centro |
| `ranking` | `svgRanking` | barra horizontal, cor por linha |
| `burnup` | `svgBurnup` | área + trilha ideal tracejada |
| `barras` | `svgBars` | colunas, período atual em destaque |
| `saldo-dia` | `sparkArea` | sparkline no resumo do extrato |

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

## Custos aceitos

**Peso: 627 KB → 1.147 KB (+82%).** A lib é 527 KB minificada (136 KB em gzip),
licença MIT. É **vendorizada em `vendor/`, não de CDN**: o app é offline-first, e
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
