# O cofrinho: como o app da criança se liga ao da família

Este documento é para a próxima pessoa (ou a próxima sessão) que abrir
`cofrinho/`. Ele não repete o que o código já diz — só registra as decisões que
não estão evidentes ao ler os arquivos, e por que a alternativa óbvia foi
recusada.

## Por que dois apps, e não uma aba no app da família

A pergunta original era "sessão dentro do app ou app separado". Separado, por três
motivos que se somam:

1. **O PIN.** O app da família cifra tudo em repouso com uma chave derivada do PIN
   de quem administra. Uma criança de seis anos não pode ter esse PIN — ele abre
   salário, cartão e dívida. Uma aba interna exigiria que ela passasse pela
   fechadura do adulto para ver a própria mesada.
2. **O visual.** O app do adulto é escuro, denso e feito para decisão financeira.
   O da criança é claro, grande e animado. Não são dois temas do mesmo produto;
   são dois produtos com públicos que não se parecem.
3. **A instalação.** No tablet dela, o atalho da tela inicial tem que abrir o
   cofrinho — não o app da família numa tela específica, de onde um toque errado
   sai para o extrato da casa.

## As três camadas, e o que cada uma protege

```
app da família (raiz)          app da criança (cofrinho/)
─────────────────────          ──────────────────────────
DB  → financas.v1              Dados → financas.cofrinho.v1
      cifrado com o PIN                em claro (só mesadas)
      do adulto
        │                                    │
        └──── DB.ponteDoCofrinho() ──────────┘   mesmo aparelho
        │                                    │
        └──────────── Supabase ──────────────┘   aparelhos diferentes
             SYNC_TABLES          Nuvem (cofrinho/js/dados.js)
```

**A ponte local existe porque o caso comum é sem nuvem.** Sem ela, o adulto
cadastra a criança e o app dela abre vazio no mesmo aparelho — e nada na tela
explicaria o motivo. Ela roda automática, pendurada em `DB.upsert`/`DB.remove`:
chamada manual é chamada que se esquece, e o sintoma do esquecimento ("o app da
minha filha não atualizou") é difícil de ligar à causa.

**O desempate da ponte é o `dirty`, não só o `updated_at`.** Os dois apps gravam
com o relógio do mesmo aparelho, e localStorage é rápido o bastante para duas
gravações caírem no mesmo milissegundo. Resolvendo só por `updated_at`, o app do
adulto venceria todo empate — e o que a criança acabou de fazer desapareceria da
tela dela. Isto foi encontrado por teste, não por raciocínio: com o relógio
congelado da suíte, *todo* caso é empate.

**O armazém do cofrinho pode ficar em claro** porque a ponte carrega quatro
tabelas e mais nada. Há teste conferindo que nenhum lançamento, conta, cartão ou
categoria da família atravessa.

## Decisões de produto que parecem detalhe e não são

**A semanada nasce inteira no pote "gastar".** O adulto paga; a divisão nos três
potes é feita pela criança, no app dela. Se o app dividisse sozinho, a única
decisão da semana — a que ensina — deixaria de existir.

**Dividir não muda o total.** São três lançamentos de `divisao` que somam zero, e
não um lançamento com o pote reescrito. Dois motivos: o histórico dela precisa
mostrar a escolha ("guardei 3, doei 1"), e o registro da semanada é do adulto — o
app da criança nunca reescreve o que o adulto lançou.

**Tarefa marcada não paga.** Nasce com `confirmada: false` e fica fora do saldo até
o adulto conferir. Se o dinheiro entrasse ao marcar, o app pagaria por *dizer* que
fez — e ela aprenderia a dizer. Depois de confirmada, ela não pode desmarcar: isso
deixaria dinheiro no pote sem origem.

**O cofrinho recusa o que não cabe.** Não é validação de formulário; é a lição
inteira. Um cofrinho que deixa gastar mais do que tem ensina exatamente o que a
família quer evitar que ele aprenda depois, com cartão de crédito.

**A moeda mágica é valor fixo, não percentual.** Rendimento de percentual sobre R$
7 dá sete centavos, e o que não se vê não ensina. Ela cai quando uma semana
inteira passou sem nenhuma saída do pote guardar — é o conceito de "o dinheiro
rende quando fica aplicado" no formato que a idade alcança.

**Os selos não valem dinheiro.** Recompensa em dinheiro por tudo produz o efeito
contrário do pretendido (superjustificação): a criança para de fazer pelo gosto e
passa a fazer pelo preço, e para quando o preço para. Selo é reconhecimento.

**O tempo é contado em semanadas, não em reais.** "Faltam quatro semanadas" é uma
frase que ela consegue planejar; "faltam R$ 43,50" não. A conta usa só o pote
guardar — incluir o de gastar prometeria uma data que não vai acontecer.

## O design: "clay", e por que não um tema claro do app do adulto

A primeira versão parecia um formulário corporativo suavizado — funcionava e não
engajava. A linguagem agora é **plástico macio**: nada é uma borda de 1px.

Cada botão e card carrega **duas** sombras: um degrau sólido embaixo (a borda de
baixo do plástico) e uma difusa (a que o objeto joga no chão). São as duas juntas
que dão volume; só uma devolve o botão chapado. E tudo **afunda** ao toque, com
`translateY` para dentro do próprio degrau — o movimento de um botão de brinquedo.

Isso não é decoração: numa tela sem retorno tátil, a criança toca de novo, e o app
parece quebrado em vez de lento.

**Onde a arte para e a imagem começa.** `arte.js` desenha à mão o que rende bem em
vetor: potes, moedas, troféus, bandeiras, o Dino em poses de meio corpo. Para o
mascote em pose complexa e ilustrações com textura, o SVG à mão ficaria pobre ou
gigante — esses casos estão no fim de `arte.js` como **PROMPT DE IMAGEM**, com o
texto em inglês pronto para gerar. Nenhum é necessário para o app funcionar.

### Interface para 5–7 anos: as regras que o CSS aplica

Cada uma está comentada no arquivo, com o motivo, e **cada uma tem teste** — porque
um "ajuste rápido" no CSS desfaz qualquer uma delas sem que nada pareça quebrado:

- Alvo de toque de 76px mínimo, e espaço grande entre alvos. O dedo acerta mal, e
  errar o botão numa tela de dinheiro frustra de um jeito específico.
- Todo clicável afunda ao toque — botão, tecla, card, pote, chip.
- Nenhuma ação colada na borda de baixo. O rodapé é uma pílula flutuante, com
  folga e `env(safe-area-inset-bottom)`: ali é onde a mão apoia o tablet, e botão
  colado no canto dispara sozinho o tempo todo.
- Cor nunca carrega o significado sozinha: cada pote leva nome escrito e ícone,
  cada prêmio tem desenho próprio. É o que mantém o app legível para quem não
  distingue verde de vermelho — 1 em cada 12 meninos.
- Seis prêmios, seis objetos diferentes. Seis estrelas amarelas iguais não são uma
  coleção, são uma contagem; e o bloqueado aparece em silhueta com cadeado, para
  ficar claro que existe e dá para ganhar.
- Errar a senha não gera mensagem de erro vermelha. Treme, o Dino fica triste, e
  na terceira tentativa oferece chamar um adulto. Aos seis anos, errar a senha é
  comum, e o app não pode transformar isso em fracasso.
- Nenhuma tela sem saída. Quem chega num beco sem botão de voltar não sabe fechar
  app — desiste, e o cofrinho fica abandonado.
- `prefers-reduced-motion` mantém o app inteiro, só quieto.

### Duas armadilhas que já morderam

**IDs de SVG repetidos.** Três potes na mesma tela usam `clipPath`, e id repetido
faz um recorte valer para todos — na prática, potes diferentes parecendo ter o
mesmo saldo. Invisível no código, óbvio na tela. Por isso `Arte.pote()` recebe um
sufixo, e o ritual passa o seu.

**A fonte que o CSS pede não ser a que o HTML busca.** Aconteceu: troquei a pilha
para Fredoka e o `<link>` continuou baixando Baloo 2. Nada quebra, nada avisa — o
app só abre com a letra do sistema e a tipografia arredondada desaparece sem
rastro. Há teste comparando as duas listas.

## Onde o Dino mora

`cofrinho/js/arte.js`, todo em SVG desenhado à mão. Sem requisição de rede, sem
borrar em tela retina, e a cor muda por CSS — é o que permite o Dino combinar com
a cor que a criança escolheu sem existirem doze arquivos de dino.

As poses (`oi`, `feliz`, `uau`, `pensando`, `dormindo`, `triste`) compartilham o
corpo idêntico e trocam só olhos, boca e braços. Isso é o que faz reconhecer "é o
mesmo bichinho" em vez de ver seis desenhos parecidos. As poses são estados
emocionais porque uma criança lê a cara do mascote antes de ler o texto da tela.

## Testes

`tests/cofrinho.js`, suíte separada de `tests/smoke.js` — os dois apps não
compartilham código nem armazém, e juntar as suítes faria uma quebrar por causa da
outra sem que nada de verdade tivesse quebrado.

`tests/tempo.js` roda as duas: a do app da família nas bordas de mês, a do
cofrinho nos **sete dias da semana**. O eixo de risco daqui é outro — a semana do
cofrinho começa no dia da semanada, e um bug de recuo passa liso em datas
escolhidas por borda de mês.

Um teste vazio foi encontrado e corrigido no caminho (o regex da casca do service
worker exigia URL terminando em `.js`, mas todas terminam em `?v=1`, então a lista
ficava vazia). Vale a regra da casa: sabote antes de acreditar.

## Ao publicar

`cofrinho/sw.js` tem `VERSAO` própria e as tags `?v=` do `cofrinho/index.html`
precisam acompanhá-la — igual à raiz, mas numeração independente, de propósito:
publicar correção no app do adulto não pode reinstalar o app da criança no meio de
um sábado. Há teste conferindo a consistência.
