# O plano de orçamento e a revisão das categorias

Por que os tetos são estes, por que os nomes mudaram, e como o investimento entrou
num app que só sabia falar de gasto.

## O orçamento (renda de referência: R$ 17.000)

50·30·20 com a dívida contando como necessidade — enquanto as parcelas de veículo
e o empréstimo existirem, eles são compromisso, não escolha.

| | | % |
|---|---|---|
| 🏠 Moradia | 4.180 | 24,6 |
| 📈 **Investimentos** | **3.400** | **20,0** |
| 🚗 Transporte | 2.180 | 12,8 |
| 🍽️ Alimentação | 1.700 | 10,0 |
| 🧒 Filhos | 700 | 4,1 |
| 🎮 Lazer | 700 | 4,1 |
| 💊 Saúde | 500 | 2,9 |
| 👤 Gastos Pessoais | 500 | 2,9 |
| 🏷️ Empréstimos | 350 | 2,1 |
| 👕 Vestuário | 300 | 1,8 |
| 🐾 Pets | 250 | 1,5 |
| 🧾 Serviços & Taxas | 200 | 1,2 |
| 📚 Educação | 200 | 1,2 |
| 🎁 Presentes | 200 | 1,2 |
| 🔁 Assinaturas | 150 | 0,9 |
| **total** | **15.510** | **91,2** |

**A folga de ~9% é deliberada.** Orçamento que consome 100% da renda estoura no
primeiro imprevisto, e um plano que fura todo mês ensina a ignorar o plano.

**Os tetos escalam com a renda.** `DB.calibrarOrcamentos(renda, rendaAnterior)`
recalcula na proporção e arredonda para dezena. Um catálogo de números absolutos
serve a uma renda e desorienta as outras: quem ganha 5 mil abriria o app com 15.510
orçados e concluiria, com razão, que o plano não é sobre a vida dele.

Ele **pergunta antes** e **não toca no que foi ajustado à mão** — um envelope só é
recalculado se ainda vale o que o catálogo daria para a renda antiga. Reescrever a
decisão de quem vive com o orçamento é a "ajuda" que faz alguém desistir de
planejar.

## Investimentos: o envelope que não é gasto

O aporte é **transferência**, não despesa: o dinheiro sai da conta corrente e
aparece na de investimento. Tratá-lo como gasto faria o donut dizer "gastei 3.400
com investimento" e a taxa de poupança despencar justamente no mês em que se poupou
mais.

Mas o plano do mês precisa de teto — "quanto pretendo guardar" é linha de orçamento
como qualquer outra. Daí a solução em três partes:

1. **A movimentação aparece no extrato**, categorizada em `Investimentos › Reserva
   de emergência` ou `› Objetivos e metas`, conforme a meta. Antes, guardar dinheiro
   mexia nos saldos e não deixava rastro: o extrato fechava com uma diferença que
   nada explicava.
2. **O usado do envelope se mede pelos APORTES** (`DB.investidoNoPeriodo`), não pelo
   gasto — transferência não entra em `spentByCategory`, então a barra ficaria
   eternamente em 0%.
3. **A cor da barra se inverte**: 100% de um envelope de gasto é teto estourando;
   100% do investimento é meta cumprida. Manter a régua padrão pintaria de vermelho
   o mês em que se guardou tudo o que foi planejado.

**Resgate não abate.** Guardar 2.000 e precisar tirar 500 são dois fatos distintos;
compensá-los diria que se guardou 1.500, apagando o esforço e o imprevisto de uma vez.

**Não conta duas vezes:** há teste conferindo que a soma dos saldos não muda, que
`saldoNaData` continua batendo, que a linha é neutra em toda análise, e que o gasto
do mês não cresce com o aporte.

## Os nomes: dois princípios

### 1. Nome único entre envelopes

No seletor a subcategoria aparece **sozinha**, sem o envelope. "Manutenção" era a
mesma palavra para o telhado e para a embreagem.

| antes | agora |
|---|---|
| Moradia › Manutenção | **Reparos em casa** |
| Transporte › Manutenção | **Oficina / Revisão** |
| Filhos › Roupas | **Roupas das crianças** |
| Filhos › Saúde (nome de envelope!) | **Pediatra / Saúde infantil** |
| Filhos › Escola | **Escola das crianças** |
| Gastos Pessoais › Diversos | **Diversos pessoais** |
| Educação › Escola / Faculdade | **Faculdade** |

### 2. Separar por intenção, não por estabelecimento

Almoço de terça e jantar de aniversário saem do mesmo restaurante e respondem
perguntas diferentes: um é comida, o outro é programa. Misturados, o envelope de
Alimentação engorda com lazer e ninguém sabe onde cortar.

| antes | agora |
|---|---|
| Alimentação › Restaurante | **Restaurante do dia a dia** |
| Lazer › Bar | **Bar e restaurante (programa)** |
| Lazer › Viagem | **Viagem — passagem e hospedagem** + **Viagem — gastos no destino** |
| Saúde › Farmácia | **Remédios** (higiene foi para Gastos Pessoais) |
| Assinaturas › Aplicativos | **Aplicativos e software** |

**Renomear preserva o id**, então nenhum lançamento histórico perdeu o vínculo — não
houve remanejamento a fazer.

## Aplicado nos dois lugares

- **No banco de produção**: 25 alterações e 6 criações, com simulação (dry-run)
  conferida antes de gravar. Renda de referência ajustada de 16.000 para 17.000.
- **No seed do app** (`DB.ARVORE_PADRAO`): uma família nova nasce com esta
  estrutura e com os tetos escalados pela renda que informar.

## O que a revisão encontrou nos dados

Fica registrado porque afeta qualquer análise do histórico anterior a julho/2026:

- **30% de todo o gasto de jun+jul eram PIX para a mesma pessoa**, classificados
  como consumo — R$ 11.505 em "Alimentação › Mercado" e R$ 3.830 em "Transporte ›
  Combustível". São repasses, não compras.
- Vários pagamentos a pessoas físicas e escritórios caíram em categorias sem
  relação (um boleto de advogado em "Transporte público").

Por decisão de quem usa o app, o histórico não foi reclassificado — era um período
de transição. Os números anteriores a agosto/2026 não descrevem o padrão de consumo
da família.
