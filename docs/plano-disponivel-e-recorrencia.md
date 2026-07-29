# Plano — o disponível honesto e as transações que se repetem

Decidido em conversa. Registro do que foi escolhido, com os porquês, para as
fases seguintes não reabrirem o que já foi resolvido.

## O problema

`Disponível para usar = saldo em contas − comprometido`. A reserva e as metas
**não são descontadas**: quem guardou R$ 15.000 vê esse dinheiro como gastável.

E o comprometido tem três lacunas: custo fixo ainda não lançado não existe, não
há horizonte (conta de daqui a 3 meses pesa igual à de amanhã), e é um número só.

## O que o mercado faz

**Nubank** — guardar na Caixinha tira do saldo disponível. *"Essa quantia não
aparece no saldo da sua conta, mas está disponível para ser usada."* Separação
explícita, decidida pela pessoa.

**YNAB** — cada real tem um trabalho; não existe "disponível" global, existe "não
atribuído", que idealmente é zero.

**Monarch** — metas são alocações virtuais sobre contas reais, e você escolhe se
o gasto **reduz o progresso da meta**: liga para a reserva (precisa repor),
desliga para a viagem (guardou para gastar).

A distinção do Monarch é a que mais importa aqui: **reserva existe para não ser
gasta; meta de viagem existe para ser gasta na hora certa.**

## O que já existe, e o que está quebrado

- O **aporte é transferência real**: sai da conta corrente, entra na caixinha, e
  as duas contas somam em `accountsTotal`. Então o dinheiro guardado *está* no
  saldo, só que com dono — descontar é correto, não conta duas vezes.
- **Não existe resgate.** Só aporte. Usar a reserva derruba o saldo e deixa
  `reserveTotal` intacto, sem caminho de correção.
- **`is_reserve` existe no schema e não é usado em lugar nenhum** — intenção que
  ficou pela metade.
- A **recorrência é cópia, não contrato**: o botão pega a última transação com
  `recurring: true`, casa **por descrição** e usa `date: todayISO()` — ou seja,
  **perde o dia do vencimento**. Sem fim, sem periodicidade, sem "até cancelar".

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| 1 | Reserva e metas **saem** do disponível, com rótulos distintos | Dinheiro com plano não é dinheiro livre |
| 2 | Ao gastar além do disponível, **o app pergunta de qual meta sai** e registra o resgate | Nunca gera divergência silenciosa entre o guardado e o que existe |
| 3 | Custo fixo não lançado **não** entra no comprometido | Preferimos consertar o lançamento a estimar |
| 4 | Comprometido cobre **até o fim do ciclo atual** | O disponível responde "quanto posso gastar até o fim do mês" |
| 5 | Recorrência é **campo no próprio lançamento** | Nada de tela nova para aprender; o modelo do Google Calendar |
| 6 | Geração **automática**, como "A Pagar" | Decorre da decisão 3: se não estimamos, o lançamento tem de acontecer sozinho |
| 7 | Valor variável lança com a **média**, marcado como estimativa | O comprometido nunca fica zerado por falta de número |
| 8 | **Pendências vencidas no topo do Painel**, inclusive faturas | Lançar automático só serve se o que venceu não apodrecer |
| 9 | Receita futura entra em projeção e pendências, **nunca no disponível** | Senão vira "posso gastar o que ainda não recebi" |
| 10 | **Projeção de saldo dia a dia**, com alerta de negativo | Pega o aperto antes: "dia 8 fica negativo, o salário só cai dia 10" |

## Fases

A ordem tem dependência real, não é preferência.

### Fase 1 — Resgate e o disponível honesto
**Precisa vir primeiro:** descontar o guardado antes de existir resgate criaria
um número que só erra para menos, sem conserto.

- Resgate como aporte negativo (`goal_entries` já suporta valor e contas)
- `DB.guardado()` — reserva + metas
- `available() = contas − comprometido − guardado`
- Comprometido limitado ao ciclo atual (decisão 4)
- Detecção ao salvar: gasto que passa do disponível pergunta de qual meta sai
- Painel mostra a decomposição, não só o número

### Fase 2 — Recorrência como contrato
- Tabela `recurrences`: descrição, valor, tipo de valor (fixo/média), categoria,
  conta ou cartão, periodicidade, dia, início, fim (sem prazo / N vezes / data),
  status (ativa / pausada / cancelada)
- Campo "se repete?" no formulário de lançamento
- Geração automática ao abrir o app, como "A Pagar", na data certa
- Vale para **receita também** (salário é a recorrência mais previsível que existe)
- Migração dos `recurring: true` atuais

### Fase 3 — Pendências e projeção
- Fila no topo do Painel: vencido, vence hoje, e receita esperada que não caiu
- Ações diretas: pago / recebi / adiar / cancelar
- Faturas de cartão entram na mesma fila
- Projeção de saldo dia a dia, cruzando entradas e saídas nas datas
- Alerta do primeiro dia em que o saldo fica negativo

## Cenários que a Fase 2 precisa cobrir

| Cenário | Como cai no modelo |
|---|---|
| Aluguel até eu cancelar | mensal, dia fixo, **sem prazo** |
| Financiamento em 48x | mensal, dia fixo, **por N vezes** |
| Assinatura até cancelar | mensal, dia fixo, sem prazo, valor fixo |
| Luz / água | mensal, dia fixo, **valor pela média** |
| IPVA / IPTU | **anual**, ou parcelado por N vezes |
| Salário | mensal, dia fixo, **receita** |
| Diarista | **semanal** ou quinzenal |
| Parcelamento no cartão | já existe (`group_id` + `installment`) — mantido |

## O que fica de fora, e por quê

- **Estimar custo fixo não lançado** — decisão 3. Se o lançamento automático
  funciona, a estimativa é remendo de um problema que deixou de existir.
- **Receita futura no disponível** — decisão 9.
- **Zero-based à YNAB** — muda o app inteiro e exige disciplina diária que não é
  o público daqui.
