# Visão de futuro nas telas

Como Painel, Extrato e Relatórios mostram um mês que ainda não chegou.

## O problema

Navegar para setembro dava tela quase vazia. A causa não era o limite de
navegação — ele já ia a 6 meses — e sim a **falta de dado**: um mês futuro não tem
lançamento nenhum além do que foi agendado à mão.

Cada objeto lia isso por conta própria e mostrava zero:

| objeto | mostrava |
|---|---|
| KPI "Gasto do mês" | só o agendado (1.800 de 4.450) |
| donut "Para onde foi" | vazio |
| Regra 50·30·20 | ausente (some sem renda) |
| "De onde vem o dinheiro" | ausente |
| "O caminho do dinheiro" | ausente |
| frase dos Relatórios | "nenhuma receita lançada" |
| resumo do Extrato | entrou 0,00 |
| hero do Painel | "Resultado de setembro: R$ 0,00" |

## A correção: transações virtuais, num ponto só

`DB.txOfPeriod` passou a devolver, **em período inteiramente futuro**, transações
**virtuais** geradas do contrato (`recurrences`) e do custo fixo (`recurring`).

Elas têm forma de transação e `virtual: true`. Não têm id, não são gravadas e não
existem em `DB.data`: nascem a cada leitura e somem quando o lançamento de verdade
aparece.

**Por que no ponto central e não em cada objeto:** são oito lugares lendo daqui, e
o que se conserta em oito volta a divergir no nono. Corrigir na origem fez o KPI, o
donut, a cascata, a regra 50·30·20, a tabela por categoria e o resumo do extrato
funcionarem de uma vez — todos com o mesmo número.

**Por que calcular e não materializar:** seis meses de "A Pagar" encheriam o
extrato de registros que ninguém pediu e que dariam trabalho para desfazer.

**Só no futuro.** No mês corrente e no passado, o que não foi lançado não
aconteceu — misturar previsão ali competiria com o fato e faria o extrato do mês
discordar do extrato do banco.

### O que tornou isso possível

`previsaoDoMes` passou a carregar o **molde** de cada item — categoria, conta,
método, âmbito e membro. Sem categoria, o item não apareceria no donut nem na
tabela por categoria, e o mês futuro teria um total que não se decompõe em lugar
nenhum.

## As identidades verificadas

Os testes checam que os objetos **contam a mesma história**, não que cada um "tem
dados":

- despesas do Extrato = saídas previstas − fatura
- KPI do Painel = despesas do Extrato = `Rel.gasto` dos Relatórios
- soma das categorias = soma dos tipos (essencial + estilo) = total
- **saldo do fim = saldo do início + entradas − saídas − fatura**

A última é a mais importante: um extrato cujo topo não bate com a soma das linhas
é o pior defeito possível. Foi por ela que `saldoPrevistoNaData` passou a contar
contrato e custo fixo — antes ele listava o salário na tela e o ignorava no saldo.

## Dois números com nomes diferentes

O hero do Painel mostra **"Disponível previsto"**, não "saldo": ele desconta o
comprometido e o que já tem dono (reserva e metas), exatamente como o hero do mês
corrente. O Extrato mostra **saldo em conta** (caixa).

São conceitos distintos e ambos legítimos, mas com o mesmo nome eles se
contradiriam. O hero traz uma linha de ponte — "Em conta haverá X" — com a
diferença explicada, para que ninguém precise descobrir sozinho por que os dois
números discordam.

## Onde as virtuais não podem entrar

Sem id, um `upsert` criaria registro fantasma — ou apagaria outro, se dois `null`
colidissem. Verificado por teste:

- **Edição em massa**: filtra `!t.virtual && t.id`. Previsão não se edita — para
  mudar o aluguel dos próximos meses muda-se o contrato, não uma cópia dele.
- **Linha do Extrato**: sem `data-tx` (não abre edição) e sem botão de pagar.
- **CSV**: as linhas vão junto (é o mesmo conteúdo da tela), mas a coluna Status
  diz `Previsto (…)`. Fora do app não há cor nem rodapé que avise.
- **Botão "Custos fixos"** e `avgMonthlySpend`/`fluxoMensal`: a salvo por
  construção — o primeiro sempre lê o mês corrente, os outros só meses passados.
- **Renderizar o futuro não grava nada**: conferido comparando a contagem de
  transações e o saldo das contas antes e depois.
