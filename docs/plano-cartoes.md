# A tela de Cartões & Faturas

Registro da reestruturação: o que havia, o que estava errado, e por que a ordem
nova é a que é.

## O que havia

A aba se chama "Cartões & Faturas" e o cartão era a última coisa a aparecer.
Renderizada contra a base real, a ordem era:

1. Contas e saldos
2. Patrimônio
3. Custo fixo mensal
4. Compromissos futuros
5. **Cartões de crédito**

Quatro blocos e cerca de 40 linhas de conteúdo antes do assunto da tela.

## O defeito: a fatura que importa não aparecia

A lista de faturas era `invoices.slice(-6)` — as seis últimas por data. Parece
razoável até existir uma compra parcelada.

Com a TV em 10x, as seis últimas eram **dezembro/2026 a maio/2027**, idênticas:
"Aberta · R$ 250 · 1 itens · pagar". Escondidas ficavam:

| fatura | valor | |
|---|---|---|
| ago/2026 | R$ 613,95 · 12 itens | acabou de fechar |
| **set/2026** | **R$ 359,90** | **a fatura atual** |
| out, nov | R$ 249,90 cada | |

A tela oferecia seis botões "pagar" para 2027 e nenhum para a fatura aberta.
**Quanto mais se parcela, pior fica** — cada parcelamento empurra o presente para
fora da janela de seis.

Outros números errados na mesma tela:

- **"Uso do limite: 327% de R$ 110"**, com a barra desenhada cheia. O cadastro do
  limite está errado, e a tela tratava isso como informação.
- **"R$ 250"** onde são R$ 249,90 — fatura é o valor que se vai pagar.
- **"1 itens"**.
- Um cartão **sem uso e sem limite** ocupava o mesmo bloco de outro com R$ 613 em
  aberto.
- **"Fecha dia 13 · Vence dia 20"** — dois números que obrigam o leitor a calcular
  quantos dias faltam.

## O que o mercado faz

**Nubank**, que é a referência de quem usa este app: a tela do cartão mostra a
**fatura fechada** (quando existe e não foi paga), a **fatura aberta** e o
**limite disponível**. As faturas têm cor por estado — verde paga, azul aberta,
vermelho fechada e não paga, laranja as futuras de parcelamento — e o histórico
fica atrás de "Resumo de faturas".

**Monarch** e **Copilot**, nas telas de patrimônio: o número vem no topo, as
contas são agrupadas em **ativo e passivo**, e o detalhe fica a um toque em vez de
ser despejado de uma vez. Cartão de crédito não é um bloco à parte — é o passivo
do mesmo patrimônio.

Fontes: [Nubank — como ler sua fatura](https://blog.nubank.com.br/fatura-do-cartao-de-credito-como-ler-a-sua/),
[Tecnoblog — a interface do cartão](https://tecnoblog.net/noticias/nubank-atualiza-app-e-muda-interface-para-cartao-de-credito/),
[Monarch — tracking](https://www.monarch.com/features/tracking).

## A ordem nova

```
patrimônio  →  o que eu TENHO (contas)  →  o que eu DEVO (cartões)  →  custo fixo
```

**O patrimônio virou capa.** Ele era um card no meio da pilha repetindo números
que já estavam acima e abaixo dele. Como cabeçalho, deixa de repetir e passa a
apresentar: "tenho X · devo Y" são os títulos das duas seções seguintes, e a tela
inteira vira a decomposição de um número só.

`patrimonioCard()` foi removida — 31 linhas que ninguém mais chamava.

**A dívida aparece somada na capa e partida no cartão**, de propósito: as duas
metades doem em momentos diferentes. A fatura em aberto cobra ação nesta semana; o
que já foi comprado e ainda vai faturar é compromisso de meses. Cada uma tem o seu
lugar e o seu botão.

**"Compromissos futuros" saiu.** Ele somava água, energia e parcela de carro —
numa tela de cartões, o número passava por dívida de fatura. Continua no Painel,
que é onde a pergunta "o que devo este mês" pertence.

**Custo fixo ficou, no fim.** É planejamento de mês, não a pergunta que traz
alguém à aba de cartões.

## O bloco do cartão

Três coisas, nesta ordem:

1. **A fatura fechada e não paga**, quando existe — em vermelho, com o prazo dito
   em dias ("vence em 4 dias") e botão de pagar. Ela vem **antes** da aberta
   porque é a que cobra ação hoje. "Parcial" entra junto: quem pagou metade ainda
   deve a outra metade.
2. **A fatura aberta** — valor, quando fecha, quando vence, ver itens e pagar.
3. **O limite pelo que sobra**, não pela porcentagem usada. Quando o uso passa do
   limite, a tela diz *"limite cadastrado (R$ 110) é menor que os R$ 2.359,10 já
   comprometidos — confira o cadastro"* em vez de desenhar 327%. Sem limite
   cadastrado, diz isso também.

### O que ocupa o limite: a dívida inteira, não a fatura aberta

Isto saiu errado na primeira versão e foi pego por quem usa. Uma compra em 10x
**trava o limite pelo valor total no momento da compra**; ele volta aos poucos,
conforme cada parcela é paga. Descontar apenas a fatura em aberto dava:

| limite cadastrado | a tela dizia | o correto |
|---|---|---|
| R$ 5.000 | R$ 4.640,10 | **R$ 2.640,90** |
| R$ 3.000 | R$ 2.640,10 | **R$ 640,90** |

Sempre R$ 1.999,20 a mais — o valor exato das oito parcelas ainda por faturar. E
o erro era **para o lado perigoso**: a tela prometia um limite que o cartão não
tem. Era também incoerente com o próprio cabeçalho, que já dizia "devo
R$ 2.359,10".

Agora `emUso` é a soma do que falta em **todas** as faturas não pagas, o mesmo
número que o patrimônio usa. E, quando há parcelas, uma nota explica de onde vem
a diferença — sem ela, quem olha só a fatura aberta acha que o disponível está
errado.

**O teste passou com o código errado**, e isso importa mais que o defeito: ele
refazia a conta do mesmo jeito que o código fazia. Um teste que copia a regra que
deveria julgar não julga nada. Agora o valor é literal — o cenário tem R$ 3.000
comprometidos num limite de R$ 4.000, e o teste cobra R$ 1.000 —, e há uma
asserção que reprova explicitamente o resultado da conta antiga.

Abaixo, duas linhas de navegação:

- **"Ainda vai faturar · 8 faturas até mai/2027 — R$ 1.999,20"**. As parcelas já
  compradas somadas numa linha. Elas respondem a única pergunta que importa delas:
  quanto do futuro já está comprometido. Não têm botão de pagar — não se paga uma
  fatura que ainda não fechou.
- **"Histórico de faturas"**, com todas, inclusive as pagas, e as ações completas.

**Cartão sem movimento vira uma linha.** Não pode pesar como um que deve.

## Resultado medido

| | antes | depois |
|---|---|---|
| HTML | 7.491 caracteres | **4.339** |
| linhas de conteúdo | 74 | **40** |
| faturas listadas | 6, todas de 2027 | a atual, com a fechada quando existe |
| blocos antes do cartão | 4 | **0** |

## O que os testes travam

`ligarAcoesDeFatura` existe porque pagar, desfazer e abrir o detalhe valem na tela
**e** dentro das duas folhas. Duas cópias divergiriam na primeira correção que
entrasse só de um lado — os botões funcionariam na tela e ficariam inertes dentro
da folha, que é o tipo de defeito que ninguém reporta.

Sob teste, com cenário de oito parcelas futuras reproduzindo o defeito original:

- a fatura **atual** está na tela e é ela que o botão de pagar oferece;
- a **fechada e não paga** aparece, e **antes** da aberta;
- as futuras somam **uma** linha, com o total certo e **sem** botão de pagar;
- o histórico traz **todas** as faturas;
- limite estourado vira aviso e **não** desenha barra;
- cartão sem lançamento ocupa menos de um terço do outro;
- a ordem da tela: patrimônio → tenho → devo → custo fixo, sem "Compromissos".

Seis sabotagens confirmaram que cada uma dessas asserções reprova quando a regra
é revertida.
