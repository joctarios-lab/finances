# Como eu chego no fim do mês

O gasto variável projetado no hero do Painel, e por que ele vem em faixa.

## A pergunta que nenhuma tela respondia

*"Tenho um valor na conta de investimento e na de consumo, sei o que já está
lançado, mas não sei realmente como vou chegar no final do mês."*

O Painel tinha duas projeções — e elas **se contradiziam**. Medido em 16/08 com a
base real:

| card | dizia |
|---|---|
| Projeção do mês | vai gastar **R$ 26.346,61** (renda de R$ 20.056) |
| Saldo projetado | fecha com **R$ 6.194,12** no azul |

Os dois não podiam estar certos. A projeção de **saldo** só conta o que está
lançado: ela ignora inteiramente o gasto variável que o outro card projeta —
otimista por construção. E era justamente ela que respondia "como fecho o mês".

## A resposta: duas linhas no hero

O bloco "Previsto" ganhou uma subtração e um resultado, depois do total:

```
PREVISTO  até 31 de ago.
  Em contas hoje                        R$ 6.504,12
  + Entradas previstas                  R$ 1.000,00
  − Contas do mês  faturas incluídas    R$ 1.310,00
  = Em contas ao fim                    R$ 6.194,12
  − Guardado                            R$ 3.534,00
  = Livre ao fim                        R$ 2.660,12
  − Variável estimado  R$ 283 a R$ 817/dia · 15 dias · ajustar
                              R$ 4.250,55 a R$ 12.250,02
  = Fecha em            −R$ 9.589,90 a −R$ 1.590,43
```

**"Fecha em" fica alinhado ao "Livre ao fim" e com menos peso que ele.** O total
firme continua sendo o protagonista da conta; a estimativa se apresenta como o que
é. Dois totais com o mesmo peso fariam o leitor procurar qual dos dois é a
resposta.

## Por que uma faixa, e não um número

Porque o número depende do método, e a diferença é enorme. Medido na mesma base,
no mesmo dia:

| método | ritmo | caixa no fim do mês |
|---|---|---|
| ritmo bruto do mês | R$ 438,62/dia | −R$ 3.919 |
| média dos meses anteriores | R$ 821,89/dia | −R$ 9.668 |
| ritmo sem gastos atípicos | R$ 173,87/dia | +R$ 52 |
| mediana do gasto diário | R$ 250,98/dia | −R$ 1.105 |

De +R$ 52 a −R$ 9.668 pela mesma pergunta. Escolher um e apresentá-lo como *o*
número seria inventar precisão.

As duas pontas de `DB.variavelProjetado` têm significado:

- **contido** — a mediana do gasto diário. Um dia atípico não arrasta o mês.
- **ritmo** — a média diária. Conta tudo, inclusive o atípico.

Mês encerrado e mês que ainda não começou devolvem zero: no primeiro não há o que
projetar, no segundo não há ritmo para extrapolar. As duas linhas somem sozinhas.
No **último dia do ciclo** também — não há dias à frente.

## O número grande não muda

Continua sendo o previsto sobre o que está lançado, que é firme. Quem avisa é o
**selo**: quando a estimativa derruba um mês que estava no azul, ele vira âmbar e
diz *"Aperto no variável"*.

Trocar o protagonista por uma faixa poria uma estimativa no lugar mais visível do
app, e mudar a cor do hero inteiro daria ao palpite o peso de um fato.

## Uma fonte só para movimentação futura: o contrato

Decidido por quem usa, depois de uma pergunta que expôs o problema: *"os itens
marcados como fixos não aparecem na seção de configuração de contas fixas,
deveria aparecer?"*

Deveria — e a resposta certa não era mostrá-los lá. Era **eliminar a segunda
fonte**.

### Havia dois mecanismos para a mesma pergunta

| | contrato (`recurrences`) | marca (`recurring`) |
|---|---|---|
| gera o lançamento | **sozinho, na data certa** | à mão, pelo botão "Custos fixos" |
| periodicidade | mensal, semanal, quinzenal, anual | só mensal, implícita |
| prazo | sem prazo, N vezes, até data | nenhum |
| valor médio | sim (luz, água) | não |
| pausar / cancelar | sim | não |
| vínculo no lançamento | `recurrence_id` | nenhum |
| aparece em "Contas fixas" | sim | **não** |

O próprio código já chamava a marca de legado, e o formulário havia deixado de
oferecê-la. Ela sobrevivia sustentando três comportamentos, e a combinação era a
pior possível: um lançamento marcado pesava no comprometido de **todos** os meses
à frente e não aparecia na única tela onde se gerencia custo fixo.

### O que saiu

- `previstosNaoLancados` deixou de replicar transações marcadas nos meses futuros;
- `custoFixoMensal` voltou a ler só contratos — e agora bate com a tela "Contas
  fixas", que sempre leu só eles;
- o botão **"Custos fixos"** do Extrato foi removido: ele existia apenas para
  materializar a marca;
- o filtro "Recorrentes" passou a filtrar por **vínculo**, não pela marca;
- a edição em massa deixou de oferecer "fixo".

`recurring` continua no banco e no sync. Apagar dado de base antiga seria pior que
ignorá-lo — ele só deixou de ser **lido** como fonte de repetição, e há teste
exigindo que um lançamento marcado continue sendo gasto variável.

### "Conta fixa" deixou de ser estado e virou vínculo

Com a previsão vindo só de contratos, "fixo" e "pontual" colapsariam: os dois
significariam apenas "não extrapole". Então a folha do Painel passou a ter **dois
estados e uma ação**:

```
Aluguel                    R$ 3.300,00
[ variável ] [ pontual ] [ é contrato › ]
```

- **variável** — entra na projeção do mês;
- **pontual** — aconteceu e não volta, fica fora;
- **é contrato** — abre a lista de contratos ativos e grava o `recurrence_id`.
  O lançamento sai do ritmo pelo vínculo, e os próximos meses são do contrato.

Quem já é de contrato ou parcela não recebe botão: a repetição se decide no
contrato, e alternar ali criaria um estado que o próximo cálculo desfaz.

### As sugestões de vínculo

Medido na base real: **8 lançamentos de agosto, R$ 5.400,90**, com o nome exato de
um contrato ativo e sem vínculo — lidos como gasto variável e multiplicados pelos
dias restantes. Eles nasceram assim porque os contratos foram criados depois, com
início em setembro; agosto foi lançado à mão.

A folha os junta num aviso no topo, **um botão por linha**. Aplicar sozinho não:
casar descrição contra nome de contrato já errou 19 lançamentos aqui, porque a
descrição do Pix traz o nome do banco. `contratoSugeridoPara` compara o nome
**inteiro** — não um trecho — e mesmo assim só sugere.

### Criar o contrato dali, e desfazer o vínculo

Vincular só serve quando existe a que vincular — e contratos costumam nascer
depois dos primeiros lançamentos, que foi exatamente o caso de agosto. Então a
folha de escolha oferece **criar uma conta fixa com este lançamento**.

O formulário pede só o que a tabela precisa saber e que o lançamento não tem:

```
Nova conta fixa
Matrícula Escola Thomaz · R$ 300,00

A primeira ocorrência do contrato é a PRÓXIMA — este
lançamento já existe e já está aqui.

Com que frequência?   [ Todo mês ▾ ]
Em que dia?           [ 4 ]
Até quando?           [ Até eu cancelar ▾ ]
O valor muda?         [ Não, é sempre o mesmo ▾ ]

        [ Criar e vincular ]
```

Descrição, valor, categoria, conta e método vêm do lançamento — pedir de novo o
que o app já tem seria trabalho sem retorno. E o lançamento é **vinculado ao
contrato recém-criado**: sem isso ele continuaria contando como gasto variável, e
a pessoa teria feito o trabalho sem ver o resultado, que é o ritmo do mês baixar.

O miolo da criação saiu de `criarRecorrenciaDoLancamento` para
`contratoDoLancamento`, porque a folha não tem os campos `#f-rep-*` do formulário.
Duas cópias divergiriam no primeiro ajuste, e a regra de **saltar uma ocorrência**
— a de hoje é o próprio lançamento — é justamente o tipo que se esquece de
replicar. O "N vezes" também desconta a ocorrência de hoje: quem escolhe 12x quer
doze cobranças no total.

**Desvincular** existe porque dá para errar: o vínculo pode ir para a linha
errada, e sem saída a única correção seria mexer no contrato — que é outra coisa.
A linha de um lançamento vinculado troca o "fora da projeção" por um botão:

```
Matrícula Escola Thomaz  ter., 04 de ago. · de Escola Thomaz
                                  R$ 300,00  [ desvincular ]
```

Duas regras que os testes travam:

- **o contrato não é tocado.** Desvincular é dizer "este lançamento não é aquela
  ocorrência", não "cancele a conta fixa" — para isso existe a tela "Contas
  fixas", que apaga as pendências junto. Apagar o contrato aqui destruiria a
  repetição inteira por causa de um vínculo errado num mês.
- **parcela não oferece desvincular.** Ela é de contrato por outro caminho, o
  `installment`, e o botão prometeria desfazer algo que não desfaz: a próxima
  parcela continuaria nascendo.

E duas travas que a inspeção da tela real revelou: `vincularAContrato` recusa
cruzar **despesa com contrato de receita** — a tela filtrava, mas a função
aceitava, e um gasto ligado ao contrato do salário sairia do ritmo por um caminho
sem sentido. A lista de contratos também passou a vir **ordenada por valor**, como
a folha: é assim que se reconhece o aluguel no meio de dez, não pela ordem de
cadastro.

### Por que isto não vai voltar a acontecer

De setembro em diante o contrato gera a ocorrência sozinho, já com
`recurrence_id`. O caso de agosto foi de transição: contratos novos sobre um mês
já lançado à mão.

## As duas classes que decidem a projeção

Só o gasto **variável** é extrapolado. Duas coisas ficam fora do ritmo, e por
motivos diferentes:

| | o que é | de onde sai a repetição |
|---|---|---|
| **contrato** | tem `recurrence_id` ou é parcela | do contrato, que gera sozinho |
| **pontual** | aconteceu e não volta | de lugar nenhum |

**Pontual** precisou existir. O caso é a dentadura de R$ 770, a matrícula da
escola, o empréstimo cedido a um parente — e antes dele não havia onde caber:

- como **variável**, o gasto único é multiplicado pelos dias que faltam e infla o
  mês inteiro;
- como **fixo** (a marca `recurring`, antes de sair de cena), ele saía do ritmo mas
  passava a ser cobrado todo mês. Medido: marcar a dentadura como fixa somava
  R$ 770 às contas de setembro **e** de outubro, e derrubava o saldo previsto do
  mês seguinte.

Os estados se excluem, e isso é garantido em dois pontos únicos:
`classificarGasto` grava só `variavel` ou `pontual`; `vincularAContrato` grava o
vínculo e limpa `pontual`. Deixar duas marcas ligadas faria cada leitor do app
decidir sozinho qual vale.

### As pernas, uma a uma

Levantei cada ponto do código que lê a classificação, porque a esquecida faz o
número mentir em silêncio:

| ponto | contrato | pontual | variável |
|---|---|---|---|
| ritmo do hero (`variavelProjetado`) | fora | fora | **entra** |
| projeção do mês (`projecaoDeGasto`) | fora | fora | **entra** |
| previsão dos meses seguintes | **do contrato** | não | não |
| seção "Custo fixo mensal" | **entra** | não | não |
| tela "Contas fixas" | **entra** | não | não |
| filtro "Recorrentes" | entra (por vínculo) | não | não |
| edição em massa | — | os dois estados num campo |
| sincronização | coluna `pontual`, com recuo se o banco não a tiver |
| defaults de criação | quatro pontos, todos com `pontual: false` |

### A coluna nova não pode parar o app

`pontual` depende de rodar o SQL. Sem recuo, publicar a versão pararia a
sincronização de **transações** em todo aparelho até alguém executar a migração —
e o app é offline-first justamente para não depender disso.

O push detecta: na primeira recusa, o nome da coluna sai do lote e o envio é
refeito sem ela; enquanto durar a sessão, os próximos nem a montam. É o mesmo
desenho do fallback de `server_at` no pull — detectar em vez de exigir. Rodar o
SQL só melhora: a classificação passa a acompanhar a família em vez de ficar num
aparelho só.

## Custo fixo: uma fonte, um número

A seção lia só contratos; passou a somar também os lançamentos marcados; e voltou
a ler só contratos quando a marca saiu de cena. O caminho todo cabe numa frase: o
problema nunca foi **qual** das duas fontes mostrar, era **haver duas**.

Agora o card "Custo fixo mensal" e a tela "Contas fixas" leem a mesma tabela, e há
teste exigindo que as duas mostrem o mesmo item.

## O que os testes travam

- o gasto de contrato e o pontual ficam fora do ritmo; o variável entra;
- a marca antiga `recurring` **não** move nada — nem ritmo, nem previsão;
- vincular grava o `recurrence_id`, limpa `pontual` e tira o gasto do ritmo;
- descrição de extrato que cita o nome de um contrato **não** vira fixa, e não é
  nem sugerida;
- o nome exato **sugere** o contrato, e quem já tem vínculo não é sugerido de novo;
- a escolha de contrato não lista cancelado;
- lançamento de contrato ou parcela não recebe botão de classe;
- o botão "Custos fixos" não volta, nem com dado legado na base;
- card e tela de contas fixas mostram o mesmo item;
- último dia do ciclo: sem futuro, as duas linhas do hero somem e o total fica.

Dez sabotagens confirmaram que cada uma dessas regras reprova quando revertida.

E vale registrar o que **duas rodadas de sabotagem encontraram**: três testes que
passavam sem exercitar nada — o do selo vivia dentro de um `if` nunca verdadeiro,
o da gravação chamava `DB.upsert` em vez do que o botão chama, e o da duplicação no
custo fixo dependia de um contrato que naquele ponto da suíte ainda não existia.
Os três foram refeitos.
