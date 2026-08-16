# A suíte e o relógio

Por que os testes deixaram de depender do dia em que rodam, e o que isso
encontrou.

## O defeito: uma rede que apodrece sozinha

A suíte foi entregue verde — 2321 passando. Duas semanas depois, **4 reprovavam
sem que uma linha do app tivesse mudado**. Nenhuma delas era defeito: eram datas
absolutas escritas dentro dos próprios testes, envelhecendo.

Medido, variando só o relógio:

| dia | reprovações |
|---|---|
| 02/08 (dia em que foram escritos) | 0 |
| 10/08 | 4 |
| 16/08 | 4 |
| 20/08 | 6 |
| **31/08** | **13** |
| 05/09 | 3 |
| 15/01/2027 | 4 |

Isso é pior do que parece. Uma rede que reprova sem regressão para de ser lida —
e, no dia em que reprovar por um defeito de verdade, a reprovação vai se parecer
com as outras. O valor de um teste vermelho é ele significar alguma coisa.

## A causa

"Hoje" era uma **entrada não controlada**. O cenário ancora os lançamentos em
dias fixos do mês (`dia(3)`, `dia(5)`, `dia(10)`), e a relação entre eles e o dia
da execução muda sozinha. O IPTU do dia 10 é *futuro* no começo do mês e
*vencido* depois dele — regras diferentes do app, e o teste só conhecia uma.

Três formas do mesmo erro apareceram:

1. **Data por extenso no fixture.** `lastFull: '2026-07-29'` responde "faz mais
   de uma semana?" de um jeito diferente a cada dia.
2. **O cenário assumindo uma posição no mês.** "Daqui a três dias" cai fora do
   ciclo se hoje é dia 30; a receita não entrava na previsão e o teste do hero
   passava sem exercitar nada.
3. **Índice às cegas.** `serie[iHoje + 1]` não existe no último dia do mês, e a
   comparação virava `NaN`.

## A correção

**O relógio virou parâmetro.** `tests/smoke.js` congela `Date` numa âncora
(`HOJE` no ambiente, padrão `2026-08-12`). A suíte passou a ser determinística:
o mesmo comando dá o mesmo resultado hoje, amanhã e no ano que vem.

Congelar sozinho trocaria um defeito por outro — a suíte deixaria de apodrecer e
passaria a **nunca mais olhar para o calendário**. Por isso existe
`tests/tempo.js`, que roda a mesma suíte em oito datas escolhidas pelas bordas
que já quebraram alguma coisa neste app:

```
node tests/smoke.js     # a suíte, na âncora
node tests/tempo.js     # a suíte inteira em 8 datas de calendário
```

- primeiro dia do mês — não há passado
- meio do mês — a âncora
- penúltimo e **último** dia — não há futuro
- fevereiro, e o 29 de fevereiro
- virada de ano, e o primeiro dia do ano

E os testes passaram a **declarar** a relação temporal de que precisam, em vez de
herdá-la do acaso: carimbos contados a partir de agora, datas presas ao ciclo
(`min(hoje + 3, último dia)`), e os dois lados de cada regra escritos, não um só.

## O que isso encontrou

Um defeito real, escondido justamente pela fragilidade: **no último dia do ciclo,
a linha do gráfico do Extrato não batia com o saldo previsto escrito ao lado
dela** — R$ 17.000 desenhados contra R$ 16.550 anunciados. Detalhes em
[plano-visao-futuro.md](plano-visao-futuro.md).

Ele existia havia meses. Não foi encontrado antes porque a suíte nunca rodou num
dia 31.

## Duas asserções que passavam sem testar nada

Vale registrar, porque é o modo de falhar mais silencioso que existe:

- **A cor do burn-up.** O teste fixava "é azul". A cor depende de o ritmo ter
  estourado o limite, então ele capturava um dos dois lados conforme o dia.
  Agora os dois casos são explícitos, com limites que decidem o resultado em
  qualquer data — um bilhão nunca é alcançado, um centavo é sempre estourado.
- **O número grande do hero.** Sem receita à frente, "previsto" e "disponível
  hoje" coincidem e a comparação passa com o hero sabotado. A receita agora é
  garantida dentro do ciclo, inclusive no último dia.

## A regra que fica

**Data absoluta em teste é dívida com juros.** Se um teste precisa de uma
relação de tempo, ele escreve a relação — "faz 60 dias", "o último dia deste
ciclo" —, nunca o dia em que foi escrito.

E antes de dar por bom: `node tests/tempo.js`. Verde num dia só não é verde.
