# Plano — extrato: filtros e edição em massa

Documento de planejamento. Nada aqui está implementado.

Quatro mudanças pedidas: tirar os botões de lançamento, filtrar por intervalo de
datas dentro do mês, filtros multiselect, e uma tela de edição em massa.

---

## O que o mercado faz

Três produtos resolvem isso de formas parecidas, e a convergência entre eles é o
que vale copiar.

**YNAB** — caixa de seleção por linha; ao marcar a primeira, aparece uma barra de
ações no rodapé com o que é comum (categorizar, aprovar) e um "…" para o resto.
Sem tela separada: a própria lista vira o modo de seleção.

**Monarch** — no celular, um ícone de seleção no topo entra no modo. Marca-se as
linhas e o botão vira "Editar N transações". Os campos em massa incluem categoria,
etiquetas, observação e responsável. Etiqueta **soma** à que já existe, não
substitui.

**Lunch Money** — o mais cuidadoso, e o que eu seguiria. O formulário de edição em
massa tem uma seção "Update fields" onde **cada campo tem um interruptor**. Campo
desligado não é tocado. Isso resolve o problema central de editar em massa: quando
34 lançamentos têm categorias diferentes, o formulário não tem o que preencher — e
qualquer valor pré-preenchido vira uma sobrescrita acidental.

Os três também oferecem **regras** ("sempre que a descrição contiver X, categorize
como Y"), que é o passo seguinte natural — fora deste plano, mas conectado com a
Fase 1 de [plano-ia.md](plano-ia.md).

Fontes: [YNAB — categorizing](https://support.ynab.com/en_us/categorizing-transactions-a-guide-HyRl60sks),
[Monarch — editing multiple](https://help.monarch.com/hc/en-us/articles/4402645984916-Editing-Multiple-Transactions),
[Monarch — tags](https://help.monarch.com/hc/en-us/articles/4409690120596-Organizing-Transactions-with-Tags),
[Lunch Money — transaction actions](https://support.lunchmoney.app/finances/transactions/transaction-actions).

---

## 1. Remover os botões de lançamento

**Hoje:** `js/app.js:925-929` — a fileira `.quick-add` com Despesa / Receita /
Transferir, entre os cartões de saldo e a busca. Ela empurra a lista para baixo da
primeira dobra, que é justamente o que o extrato existe para mostrar.

**Funcionalmente não se perde nada:** os três botões só pré-selecionavam o chip de
tipo dentro de `openTxSheet`, que continua permitindo escolher o tipo lá dentro.

**Fica:** o FAB (`js/app.js:3746`), que já é `openTxSheet(null)` — segue como a
entrada única de lançamento. E o botão da lista vazia ("Lançar o primeiro gasto",
`app.js:862`), que é ajuda contextual, não barra permanente. O handler
`[data-novo]` (`app.js:1389`) continua servindo os dois.

**Risco:** nenhum. É remover HTML e liberar espaço.

---

## 2. Intervalo de datas dentro do mês

**Onde encaixa:** `DB.saldoNaData(contas, dataISO)` já aceita **qualquer** data —
não só a virada do mês. O pipeline já está pronto para isso; falta só passar as
datas do intervalo em vez das do período.

**Controle proposto:** uma fileira de chips abaixo da navegação de mês:

```
‹   Julho de 2026 · R$ 4.230,10   ›
[ Mês todo ] [ 1ª quinzena ] [ 2ª quinzena ] [ Últimos 7 dias ] [ Personalizado ]
```

Os presets cobrem quase tudo com um toque; "Personalizado" abre uma folha com dois
`<input type="date">` limitados por `min`/`max` ao mês em análise — o pedido é
*dentro* do mês selecionado, então o intervalo não pode escapar dele.

**Onde mexe**
- `FILTROS_VAZIOS`: `de: ''`, `ate: ''` (vazio = mês todo)
- `txsFiltradas`: recorta por `t.date` depois de `DB.txOfPeriod`
- `renderExtrato`: **os dois saldos passam a usar as datas do intervalo** —
  `DB.saldoNaData(contas, f.de || DB.inicioISO(period))` e o fim análogo

**O ponto perigoso, e é o mesmo de sempre.** Se a lista recortar e o cabeçalho não,
o "Saldo anterior" continua sendo o do dia 1 enquanto a lista começa no dia 10 — o
mesmo tipo de divergência que fez o extrato de julho discordar do saldo da conta.
Os totais do topo e o recorte da lista têm que sair da mesma decisão.

**O que NÃO muda:** orçamento de envelope, `statsFor`, projeção e as barras do
Painel continuam mensais. Meio mês de gasto contra um orçamento mensal seria uma
leitura errada. O intervalo é do extrato, não do mês.

**Ao trocar de mês, o intervalo volta para "mês todo".** Guardar datas absolutas e
navegar para outro mês daria um intervalo fora do período. Zerar é o
comportamento previsível.

---

## 3. Filtros multiselect

**Hoje** só `contas` é lista. `tipo`, `situacao`, `scope`, `membro`, `categoria`,
`tag`, `metodo` são valores únicos.

**Semântica — precisa ficar explícita na tela:**
> dentro do mesmo filtro, os valores somam (**ou**); entre filtros diferentes,
> restringem (**e**).

"Alimentação ou Transporte" **e** "Pago" **e** "Gleice ou Joctã".

**Onde mexe**
- `FILTROS_VAZIOS` (`app.js:17`) — cada campo vira `[]`; vazio = todos
- `txsFiltradas` (`app.js:735`) — cada teste vira `!f.x.length || f.x.includes(…)`
- `filtrosAtivos` (`app.js:713`) — uma etiqueta por valor, e `data-limpa` remove
  **um valor**, não o filtro inteiro (hoje `app.js:1324` zera a chave)
- `openFiltrosSheet` (`app.js:1455`) — os `chipGroup` viram multi-toggle (o padrão
  de `#fl-contas`, `app.js:1508`, já faz isso); os `<select>` viram multi
- `js/ui.js` — o select de dois níveis precisa de modo múltiplo: não fecha ao
  escolher, marca o item, e o gatilho mostra "3 categorias"
- Consumidores diretos, todos pequenos: `app.js:941` e `1388` (chips de âmbito na
  tela), `1330` (tocar na etiqueta do lançamento — passa a **somar** à seleção),
  `1337` (vir do relatório por etiqueta), `779` (contas, já é lista)

**Categoria tem uma sutileza.** Hoje o filtro compara `categoryRootId`, então
escolher um envelope traz as subcategorias. Com múltipla escolha dá para marcar um
envelope *e* uma subcategoria de outro. Regra: casa se **a categoria do lançamento
ou a raiz dela** estiver no conjunto. Cobre os dois níveis sem caso especial.

**Âmbito na tela** (`Todos / Família / Pessoal`) vira multi-toggle, com nenhum
marcado significando "Todos".

**Risco:** médio pela quantidade de pontos, baixo por cada um. `tests/smoke.js` tem
~28 chamadas que atribuem valor único aos filtros (linhas 1163-1234, 2081-2107) e
precisam acompanhar — o que é bom: são exatamente a rede de proteção da migração.

---

## 4. Tela de edição em massa

**Entrada:** um botão ao lado de "Filtros" na fileira de busca. Abre uma tela
cheia com **exatamente os lançamentos filtrados** — incluindo o intervalo de datas.
O filtro é o que define o lote; é o que torna a tela útil sem inventar uma segunda
linguagem de seleção.

**A tela**

```
←  Editar em massa                    34 lançamentos · R$ 4.230,10
   Julho · 10 a 20 · Alimentação, Transporte
   [ Marcar todos ]  [ Desmarcar ]

   ☑ 12/07  iFood                    Alimentação › Delivery      − 48,90
   ☑ 12/07  Posto Shell              Transporte › Combustível    − 180,00
   ☐ 13/07  PDS COMERCIO             sem categoria               − 92,30
   …
   ┌──────────────────────────────────────────────────┐
   │  2 selecionados        [ Excluir ]  [ Editar ]   │
   └──────────────────────────────────────────────────┘
```

**O formulário de edição — cada campo com interruptor** (padrão Lunch Money).
Desligado = não toca. É o que evita apagar as 34 categorias diferentes com uma só.

| Campo | Como funciona |
|---|---|
| Categoria | seletor de dois níveis |
| Etiquetas | **adicionar** / **remover** / **substituir** — etiqueta é conjunto, "definir valor" seria destrutivo |
| Situação | Pago / A Pagar — ⚠️ mexe em saldo |
| Âmbito | Família / Pessoal |
| De quem | membro |
| Forma de pagamento | — |
| Conta ou cartão | ⚠️ mexe em saldo dos dois lados |
| Custo fixo | sim / não |
| Observações | adicionar ao fim / substituir |

Antes de gravar, uma confirmação que **diz o número**: "Categoria vira Alimentação
› Mercado em 32 lançamentos. 2 são transferências e ficam de fora."

### Os quatro pontos perigosos

**Saldo.** Mudar situação ou conta move dinheiro de verdade. O caminho de edição
única já faz isso certo com `applyTxEffect(t, -1)` → grava → `applyTxEffect(novo, +1)`
(`app.js:162`). Em lote isso roda N vezes, e uma falha no meio deixa saldo
corrompido. Proposta: calcular todos os deltas primeiro, gravar os lançamentos, e
só então aplicar o delta líquido por conta — uma escrita por conta em vez de 2N.
Teste obrigatório: a soma dos saldos antes e depois muda exatamente o esperado.

**Transferências e conciliações no lote.** Transferência não tem categoria;
conciliação não é gasto nem entrada. Elas continuam selecionáveis (a pessoa pode
querer mudar a observação), mas os campos incompatíveis ficam desabilitados e a
confirmação diz quantas ficam de fora. Nunca silenciosamente.

**Desfazer.** É o maior risco da funcionalidade inteira: um toque mudando 200
registros, e a sincronização propaga na hora. Proposta: guardar em memória os
campos afetados antes de gravar e mostrar "Desfazer" no toast por ~10 segundos.
Não sobrevive a recarregar a página — limite aceitável, desde que dito.

**Sincronização.** Uma chamada a `Sync.autoSync()` **no fim**, nunca por linha. O
push já agrupa por assinatura de chaves, então o lote inteiro sai em poucas
requisições.

---

## Ordem

1. **Remover os botões** — isolado, libera espaço
2. **Multiselect** — mexe no pipeline de filtro
3. **Intervalo de datas** — mexe no mesmo pipeline; sai junto do 2 como uma
   revisão só de `txsFiltradas`, em commits separados
4. **Edição em massa** — consome os dois anteriores

## Testes que precisam existir

- `ou` dentro do filtro, `e` entre filtros
- categoria multiselect casando envelope e subcategoria juntos
- limpar **um** valor sem limpar o filtro
- intervalo de datas recortando a lista **e** os dois saldos do cabeçalho
- intervalo zerando ao trocar de mês
- edição em massa: soma dos saldos conservada
- transferência no lote não recebe categoria, e a contagem informada bate
- desfazer restaura todos os campos afetados
- lote de 200 gera uma chamada de sync, não 200

## Decidido e implementado

As quatro fases estão no app (versão 54). As pendências foram resolvidas assim:

- **FAB como entrada única** — sim. Os três atalhos saíram.
- **Excluir em massa** — entrou, com confirmação que diz o número e desfazer.
- **Etiquetas** — os três modos (adicionar / remover / substituir). "Adicionar" é
  o caso comum, mas tirar uma etiqueta errada de 40 linhas de uma vez é
  justamente o conserto que traz alguém a esta tela.
- **Mudar conta em massa** — entrou. É o campo mais perigoso, então tem aviso
  próprio no formulário, contagem na confirmação e um teste que exige a soma dos
  saldos inalterada ao mover dinheiro entre contas.
- **Teto de linhas** — sem teto. A lista rola dentro da tela e a barra de ação
  fica fixa no rodapé, então o lote continua acionável em qualquer tamanho.

Uma coisa não prevista apareceu no caminho: `DB.save()` serializa — e, com PIN,
cifra — o banco inteiro a cada gravação. Um lote de 200 lançamentos seriam 200
serializações completas, segundos de tela travada no celular. Daí `DB.emLote()`,
que suspende a gravação até o fim do lote e grava uma vez só.
