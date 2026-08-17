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

## Os três estados: fixo, variável e pontual

Dois não davam conta. O caso é o gasto que **aconteceu e não volta** — a
dentadura de R$ 770, a matrícula da escola, o empréstimo cedido a um parente:

- como **variável**, ele entra no ritmo e é multiplicado pelos dias que faltam,
  inflando o mês inteiro por causa de uma compra que não se repete;
- como **fixo**, sai do ritmo — mas `recurring` faz muito mais que isso.

Medido na base real, marcando a dentadura como fixa:

| | antes | depois |
|---|---|---|
| ritmo do variável | R$ 816,67/dia | R$ 768,54/dia ✔ |
| "Contas do mês" de **setembro** | R$ 10.754,70 | **R$ 11.524,70** |
| "Contas do mês" de **outubro** | R$ 6.490,70 | **R$ 7.260,70** |
| saldo previsto no fim de setembro | R$ 12.439,42 | **R$ 11.669,42** |

Tirar do ritmo custava criar um compromisso eterno. **Pontual** fica fora dos
dois: não entra no ritmo e não vira previsão de nada.

Os três se excluem, e isso é garantido num ponto só — `classificarGasto`. Gravar
`pontual` sem limpar `recurring` deixaria o lançamento fixo *e* pontual ao mesmo
tempo, e cada leitor do app decidiria sozinho qual dos dois vale.

### As nove pernas

Levantei cada ponto do código que lê a classificação, porque uma sozinha esquecida
faz o número mentir em silêncio:

| ponto | fixo | variável | pontual |
|---|---|---|---|
| ritmo do hero (`variavelProjetado`) | fora | **entra** | fora |
| projeção do mês (`projecaoDeGasto`) | fora | **entra** | fora |
| previsão dos meses seguintes | **replica** | não | **não** |
| botão "Custos fixos" | copia | não | não |
| seção "Custo fixo mensal" | **entra** | não | não |
| filtro "Recorrentes" | entra | não | não |
| edição em massa | os três estados num campo só |
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

## Custo fixo: contratos e marcados na mesma lista

A seção lia **só a tabela de contratos**. O lançamento marcado como fixo já era
tratado como fixo em toda parte — saía do ritmo e virava previsão dos meses
seguintes — e não aparecia na única tela onde se gerencia custo fixo. A pior
combinação: pesa no comprometido de todos os meses à frente e não tem onde ser
encontrado.

Agora entram os dois, com a **origem em cada linha**: `contrato` se gera sozinho
na data certa; `marcado` depende do botão "Custos fixos". São compromissos iguais
com manutenção diferente, e sem a marca não há como saber qual precisa de ação.

Um lançamento com o **nome de um contrato** não cria linha nova — é a
materialização dele, e somar os dois cobraria o aluguel duas vezes.

## O que conta como gasto fixo: só o que foi marcado

A projeção depende de saber o que é fixo — só o variável se extrapola. São três
sinais explícitos: vínculo com contrato, marca de custo fixo, e parcela.

**Adivinhar pelo nome do contrato foi tentado e recusado.** A ideia resolveria o
fato de que quase nenhum lançamento tem vínculo (1 em 60 na base real), mas casar
a descrição contra o nome do contrato erra feio no que vem de extrato bancário.
Medido: **19 lançamentos reclassificados errado, R$ 5.322** —

- R$ 1.400 pagos a uma oficina viraram "internet fixa", porque a descrição do Pix
  traz `PAGSEGURO INTERNET IP S.A.`;
- uma compra em `ARAGUARI` virou conta de água.

Um palpite que acerta às vezes é pior que a ausência dele: quem confere não tem
como saber quais linhas o app adivinhou.

A consequência aceita é que o ritmo fica **alto** enquanto os lançamentos não
estiverem marcados — a projeção erra para o lado pessimista, que é o lado seguro.

## Marcar fixo ou variável, do próprio Painel

A marca existia e estava inalcançável: saiu do formulário de lançamento e só
sobrevivia dentro da edição em massa, a três telas do Painel. Quem estranha a
projeção não tinha como agir dali — e é ali que a dúvida nasce.

A linha "− Variável estimado" virou um botão. Ele abre a lista dos gastos do mês,
**ordenada por valor** (o que distorce a projeção são os poucos lançamentos
grandes lidos como variável), com dois botões por linha e o ritmo recalculado a
cada toque.

Lançamento de contrato e parcela **não** oferecem os botões: são fixos por origem,
e alternar ali criaria um estado que o app desfaz sozinho no cálculo seguinte. A
linha diz que está travada.

## O que os testes travam

- o fixo marcado não entra no ritmo, e marcar pela folha muda a projeção;
- o contido é mediana e o ritmo é média — com a ressalva de que, com poucos dias
  de amostra, os dois coincidem por aritmética;
- a conta fecha: `livre ao fim − variável = fecha em`;
- o selo aparece **num cenário construído para isso**, e some quando o estouro sai;
- descrição de extrato que cita o nome de um contrato **não** vira fixo;
- último dia do ciclo: sem futuro, as duas linhas somem e o total continua.

Duas sabotagens passaram despercebidas na primeira rodada e o registro fica: o
teste do selo vivia dentro de um `if` que nunca era verdadeiro, e o da gravação
chamava `DB.upsert` em vez do que o botão chama. Os dois foram refeitos — a
gravação saiu para `marcarComoFixo`, que é o que a folha usa e o que o teste
exercita.
