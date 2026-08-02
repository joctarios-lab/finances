# Visão de futuro nas telas

> **Sincronização — leia antes de mexer:** o marcador do pull é `server_at`, um
> carimbo escrito pelo BANCO. `updated_at` é do cliente e serve só para resolver
> conflito. Trocar um pelo outro reintroduz perda silenciosa de dados — ver
> `docs/plano-sync.md`.

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

> **A regra vale para o EXTRATO, e continua valendo lá.** No **hero do Painel** ela
> foi revista: o mês corrente passou a projetar o fim do ciclo, porque o número
> anterior (comprometido do mês inteiro contra o saldo de hoje) dava um valor
> negativo num mês que fecha positivo. Ele não compete com o fato porque o fato
> está no primeiro bloco, "Hoje", separado e rotulado. Ver
> `plano-disponivel-e-recorrencia.md`.

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

## A ponte do Extrato: o que existe hoje e onde o período fecha

O número grande do cartão do Extrato sempre foi o saldo do **fim** do recorte. Num
mês que ainda não acabou, isso é projeção — e o saldo de hoje não aparecia em
lugar nenhum. Medido em 2 de agosto: o cartão dizia **R$ 9.333,63** com
**R$ 231,35** na conta, sem nada na tela ligando os dois.

O título também mentia por omissão: "Saldo em 31 de ago." é o nome de um fato.
Passou a ser "Saldo **previsto** em 31 de ago." enquanto o período não fechar.

Abaixo do cabeçalho, a conta por extenso, em dois blocos — o que já aconteceu e o
que ainda vem:

```
REALIZADO · o que já entrou e saiu
Abriu  em 01 de ago.                         R$ 325,63
+ Entrou na conta                            R$ 150,00
− Saiu da conta                              R$ 244,28
= Em conta hoje                              R$ 231,35

PREVISTO · daqui até 31 de ago.
+ A receber  ainda não caiu               R$ 17.831,50
− A pagar  contas e faturas em aberto      R$ 8.729,22
= Saldo previsto em 31 de ago.             R$ 9.333,63
```

O bloco de cima também vale para **mês encerrado**, onde não há previsão nenhuma:
julho fecha em `1.168,77 + 22.453,72 − 23.296,86 = 325,63`. Antes, o card dava só o
número final e as duas colunas do cabeçalho — que contam GASTO, não caixa, e por
isso nunca fechavam com ele.

**Onde está o dinheiro que há em conta.** "Em conta hoje: R$ 231,35" não responde
quanto dá para gastar quando R$ 134 estão numa conta de investimento, e essa
diferença não aparecia em tela nenhuma do Extrato. Uma linha de **detalhe**, presa
embaixo do saldo que ela decompõe, resolve sem virar uma segunda conta:

```
= Em conta hoje                              R$ 231,35
   Em conta de uso  fora R$ 134,00 em investimento   R$ 97,35
```

Ela não é parcela: se entrasse na soma, o mesmo dinheiro seria contado duas vezes.
E o rótulo **não é** o do Painel — lá "Livre para gastar hoje" desconta o que já
tem dono (reserva e metas), aqui o corte é o **tipo da conta**. Hoje os dois dão
R$ 97,35 por coincidência; uma meta guardada na conta corrente separaria os dois, e
dois números com o mesmo nome destroem a confiança nos dois.

**O corte entre os dois blocos é o STATUS, não a data.** Quem paga um boleto
adiantado deixa a data do vencimento e o dinheiro sai hoje — é o que o app faz ao
marcar como pago. Cortar por data mostrava, num cenário de teste, "em conta hoje
R$ 700" enquanto a tela de contas dizia R$ 450. Com o corte no status, o bloco
fecha no saldo **real**, o mesmo que o resto do app mostra.

Três decisões que sustentam isso:

**As parcelas saem da mesma função que compõe o saldo.** `saldoPrevistoNaData`
perdeu o miolo para `DB.movimentoPrevistoAte`, que devolve `{ entra, sai }`. O
saldo previsto passou a ser, literalmente, `saldoNaData + entra − sai`. O mesmo do
lado realizado: `saldoNaData` agora se apoia em `DB.movimentoRealizadoAte`, e vale
`saldoNaData(fim) − saldoNaData(início) = entra − sai`. Uma cópia da regra na view
divergiria no primeiro ajuste — foi assim que nasceram três dos defeitos já
corrigidos aqui.

**Vencido de antes fica em linha própria.** Ele ainda vai sair, mas não está na
lista daquele mês; somá-lo dentro de "A pagar" faria a linha deixar de conferir
contra o que se vê logo abaixo dela.

**Mês que ainda não começou parte da abertura dele, não de hoje.** A janela vem por
diferença (`movimentoPrevistoAte(fim) − movimentoPrevistoAte(início)`). Sem isso, o
extrato de setembro mostraria também as parcelas de agosto e as linhas não bateriam
com a lista logo abaixo delas. O saldo de hoje continua na tela, mas em prosa — duas
linhas sem operação entre elas fariam a conta parecer errada.

**Mês encerrado não ganha ponte.** Ali o fim é fato, e é a mesma regra do resto do
Extrato: previsão sobre fato faz o extrato do mês discordar do extrato do banco.

### O defeito que a ponte revelou: transferência agendada

Exigir que as linhas somassem expôs mais um. Filtrando o **C6 Invest**, o extrato
listava **R$ 3.400** de aporte a caminho e mostrava o saldo previsto **inalterado**
no topo — a diferença aparecia disfarçada de "conciliação", que é o nome de outra
coisa.

Causa: `movimentoPrevistoAte` descartava tudo que é `isNeutral`, e transferência é
neutra. Ela é neutra **para a família** — o dinheiro só muda de bolso — mas não para
uma conta olhada sozinha, onde ela entra ou sai de verdade. `saldoNaData` já tratava
assim o que foi **pago**; faltava o mesmo para o que está **agendado**.

Com a correção, o extrato do C6 Invest fecha em **R$ 3.534,00** — exatamente o
"Guardado" ao fim do mês que o Painel mostra. Dois números que se conferem em telas
diferentes.

### E quando há filtro

Conta e janela de dias são filtros que o **saldo entende**: um conjunto de contas
tem saldo, um intervalo tem começo e fim. Categoria, membro, etiqueta e busca não —
dinheiro em conta não tem categoria, e um "saldo do envelope Mercado" seria um
número inventado.

Com um desses ligado, o cartão troca a conta de saldo pelo **movimento do filtro**,
partido do mesmo jeito:

```
NO FILTRO · 01 de ago. a 31 de ago.
Já saiu  até 02 de ago.                      R$ 194,28
```

As duas metades somam exatamente as colunas do cabeçalho (`já saiu + a pagar =
despesas`), e vêm da mesma lista que está logo abaixo. O saldo continua sendo o de
tudo, e a nota **diz isso** — um número que parece filtrado e não está é pior do
que número nenhum.

Pelo mesmo motivo, sob filtro a nota perdeu a frase do "sobrou/faltou": ela somava
um movimento filtrado a um saldo que é de tudo, e anunciava a diferença como
"conciliação". Medido: R$ 9.202,28 de conciliação inexistente ao buscar "mercado".

## Duas duplicações encontradas nos dados reais

Validado contra o Supabase de produção (270 transações, 14 recorrências), a partir
de um número que não batia: a frase do Painel dizia R$ 3.329,22 e as Saídas de
agosto R$ 4.109,22.

### 1. Contrato criado a partir de um lançamento que já existe

**Das 11 recorrências cadastradas, nenhuma tinha transação com `recurrence_id`
apontando para ela.** O vínculo só nasce no que o gerador cria — o lançamento que
deu origem ao contrato nunca o recebe.

A deduplicação casava **só pelo vínculo**. Com o contrato começando na mesma data
do lançamento (uma parcela de carro, dia 20/08), o mês contava os R$ 780 **duas
vezes**: uma como "lançado", outra como "prevista".

Agora há duas chaves: pelo vínculo e **pelo nome** — inclusive no que já foi pago,
porque pagar adiantado é o caso mais comum.

> **Corrigido pela metade, e isso apareceu depois.** A correção entrou só na
> previsão. O **gerador**, que é quem grava, continuou deduplicando pelo vínculo e
> criou uma segunda parcela do Fiat em agosto/2026 — ali o estrago é maior, porque
> infla o comprometido de verdade, não um número de tela. A regra vive agora em
> `DB.ocorrenciaJaLancada`, usada pelos dois. Ver `plano-disponivel-e-recorrencia.md`.
>
> A janela do nome também mudou: era "o mês inteiro", o que deixava uma diarista
> **semanal** com uma ocorrência só no mês. Passou a ser metade do intervalo do
> contrato.

Isso não esconde repetição legítima: o mesmo contrato no mês seguinte é outro
compromisso. Verificado mês a mês nos dados reais — o aluguel aparece uma vez em
cada um dos 6 meses, e nenhum item duplica dentro do mesmo mês.

### 2. `committedDepois` ignorava contrato e custo fixo

Mesma raiz das outras: ele lia só transações gravadas e faturas. Um aluguel que se
repete aparecia nas Saídas do mês seguinte e sumia dele.

## O rodapé do "Disponível para usar"

Era *"Além disso, R$ X vencem depois deste mês"* — um total **sem teto**, somando
o próximo mês, o seguinte e o IPVA de janeiro num número só. Ele não batia com
nada: quem fosse conferir nas Saídas de agosto via outro valor e não tinha como
descobrir por quê.

Virou o **resumo de um mês — o próximo**:

> Em agosto, já há **R$ 6.829,22** a pagar e **R$ 17.000,00** a receber —
> sobrariam **R$ 10.170,78**. 11 itens já conhecidos; gasto variável não entra.

Os três números casam exatamente com o que o Painel e o Extrato de agosto mostram.
Um número que não se confere em outra tela não serve para decidir nada.

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
