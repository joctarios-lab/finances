# Cofrinho — o app de dinheiro para as crianças

Proposta. Nada aqui está implementado.

Um PWA próprio, com ícone próprio, para uma criança acompanhar e administrar o
dinheiro dela. Compartilha o banco e a sincronização com o app da família, e não
altera nenhuma tela dele.

**Genérico por construção:** nenhum nome de criança aparece em arquivo, tabela ou
código. O app suporta **várias crianças**, cada uma com avatar, cor e semanada
própria.

---

## As três lentes

### 1. Desenvolvimento infantil aos 6 anos

O que a idade permite, e o que ela não permite:

| consegue | ainda não consegue |
|---|---|
| contar até 100, somar e subtrair valores pequenos | porcentagem, juros, proporção |
| entender "semana" como ciclo | planejar em meses ou semestres |
| ler ícones e palavras curtas | ler blocos de texto |
| esperar dias por algo que **vê** se aproximando | esperar por algo abstrato |
| 10 a 15 minutos de atenção | sessões longas |

Daí saem quatro regras duras do projeto:

- **Ciclo semanal, nunca mensal.** É o maior horizonte que ele administra.
- **Metas curtas: 2 a 6 semanadas.** Uma meta de seis meses aos 6 anos não é meta,
  é frustração agendada.
- **Ícone acima de texto.** Palavra só quando indispensável, e curta.
- **Feedback em toda ação.** Crianças de 5 a 7 esperam resposta a cada toque —
  sem ela, acham que não funcionou e tocam de novo.

### 2. Educação financeira infantil

O modelo consagrado é o dos **três potes**, e ele entra inteiro:

| pote | para quê | por que existe |
|---|---|---|
| 🍭 **Gastar agora** | o sorvete, o card, a bobagem da semana | dá permissão. Sem ele, guardar vira privação |
| 🎯 **Guardar** | a meta que ele escolheu | é onde mora a lição de esperar |
| ❤️ **Doar** | ajudar alguém | o dinheiro tem uso social, não só pessoal |

**Semanada, não mesada** — abaixo dos 10 anos é o ciclo que a criança compreende.
E **quem divide entre os potes é ele**, não o app: é aí que a decisão acontece, e
decisão é o que se está ensinando.

> **Gastar não pode gerar culpa.** O pote "gastar agora" existe para ser gasto. Se
> o app fizer cara feia quando ele usa, ensina que gastar é errado — e forma o
> adulto que não consegue se permitir nada. Gastar do pote certo é celebrado igual
> a guardar.

### 3. Jogos para crianças — e a armadilha

Aqui está o achado que muda o desenho. O **efeito de superjustificação** é real e
está documentado: recompensa externa **esperada e contingente** sobre uma atividade
reduz a motivação para fazê-la. O caso clássico é com pré-escolares — crianças que
ganhavam um certificado por desenhar passaram a desenhar menos quando o certificado
sumiu.

Aplicado aqui: **se ele guardar dinheiro para ganhar estrelinhas, ele para de
guardar quando as estrelinhas perderem a graça.**

A pesquisa também mostra o limite do efeito: ele depende do **tipo** de recompensa
e do que ela é contingente. Daí a regra que governa toda a gamificação deste app:

> **A gamificação dramatiza o progresso real. Ela nunca cria uma moeda paralela.**
>
> O prêmio é a bicicleta. A animação, o som e a barra existem para tornar visível
> que a bicicleta está mais perto — não para substituí-la.

O que isso aprova e o que reprova:

| ✅ entra | ❌ fica fora |
|---|---|
| moedas que caem no pote com som | pontos ou XP separados do dinheiro |
| barra da meta enchendo | loja de prêmios virtuais |
| "faltam 3 semanadas" | ranking entre crianças |
| confete ao bater a meta | mascote triste quando ele gasta |
| selo da semana em que guardou | "junte 10 selos e ganhe algo" |
| linha do tempo ilustrada | sequência que quebra e pune |

O selo passa porque é **memória do que ele fez**, sem troca. No instante em que
selo vira preço de alguma coisa, virou moeda paralela.

---

## O app

### Tela 1 — O cofrinho (abertura)

```
┌──────────────────────────────────┐
│  🦊  OI, CAMPEÃO!                │
│                                  │
│      🪙🪙🪙🪙🪙🪙🪙              │
│         R$ 14,00                 │
│                                  │
│  ┌────────┐┌────────┐┌────────┐ │
│  │   🍭   ││   🎯   ││   ❤️   │ │
│  │ GASTAR ││GUARDAR ││  DOAR  │ │
│  │ R$ 6   ││ R$ 7   ││ R$ 1   │ │
│  └────────┘└────────┘└────────┘ │
│                                  │
│  🚲 MINHA BICICLETA              │
│  ███████░░░░░░░  R$ 70 de 120    │
│  Faltam 5 semanadas!             │
│                                  │
│  ⭐⭐⭐⭐⭐ ─ ─                   │
└──────────────────────────────────┘
```

As **moedas desenhadas** são o cofrinho transparente: ele conta com o dedo. O
número existe ao lado, para quem já lê.

### Tela 2 — Chegou a semanada! (o ritual)

O momento mais importante do app. Uma vez por semana, no dia combinado.

```
        🎉 CHEGOU A SEMANADA! 🎉

              🪙 R$ 8,00

        Onde você quer guardar?

   🍭 GASTAR    [ − ]  R$ 4  [ + ]
   🎯 GUARDAR   [ − ]  R$ 3  [ + ]
   ❤️ DOAR      [ − ]  R$ 1  [ + ]

        ┌──────────────────┐
        │   GUARDAR TUDO!  │
        └──────────────────┘
```

Botões de mais e menos, grandes, com moeda animada indo para o pote a cada toque.
Sem arrastar: **gesto simples** é o que funciona nessa faixa. Se ele puser tudo em
"gastar", o app **aceita sem julgar** — e na semana seguinte a barra da meta não
andou, que é a lição chegando sozinha.

### Tela 3 — Minhas tarefas

```
  ESTA SEMANA

  ✅ Arrumar a cama          🪙 +1
  ✅ Guardar os brinquedos   🪙 +1
  ⬜ Regar as plantas        🪙 +1
  ⬜ Ajudar na mesa          🪙 +1

  Você já ganhou R$ 2 extras!
```

Ele marca; um adulto confirma na área dos pais. A confirmação é o que impede o app
de virar máquina de auto-serviço — e é rápida.

### Tela 4 — Minha meta

Escolher entre alguns objetivos com foto/emoji, ou um que os pais cadastram. A
meta mostra **quantas semanadas faltam**, não só o valor: aos 6, tempo é mais
concreto que dinheiro.

### Tela 5 — Minha história

Linha do tempo ilustrada: cada semanada, cada tarefa, cada compra, cada doação —
com ícone, valor e o pote de onde saiu. É a memória que dá orgulho.

### Tela 6 — A senha (abertura)

Teclado numérico feito para criança: quatro dígitos, botões enormes, cada número
com sua cor. Ao tocar, a moeda **pula para o cofrinho** no topo da tela, com som.

```
        🐷  MEU COFRINHO

           🪙 🪙 ○ ○

      ┌────┐ ┌────┐ ┌────┐
      │ 1  │ │ 2  │ │ 3  │
      └────┘ └────┘ └────┘
      ┌────┐ ┌────┐ ┌────┐
      │ 4  │ │ 5  │ │ 6  │
      └────┘ └────┘ └────┘
      ┌────┐ ┌────┐ ┌────┐
      │ 7  │ │ 8  │ │ 9  │
      └────┘ └────┘ └────┘
             ┌────┐
             │ 0  │  ← apagar
             └────┘
```

**Errar não pune.** O cofrinho treme, as moedas voltam e ele tenta de novo — sem
mensagem vermelha, sem contador de tentativas, sem bloqueio. A senha aqui separa
irmãos e dá o orgulho de "meu app, minha senha"; ela não guarda dinheiro de
verdade, e tratá-la como cofre de banco só criaria frustração.

Sugestão de senha: **o dia e o mês do aniversário dele** — fácil de lembrar e ele
treina os próprios números.

Cada criança tem a sua: é a senha que decide qual cofrinho abre. Guardada como
hash com sal, pelo mesmo utilitário que o app da família já usa.

---

## A área dos pais fica no app da família

Ela **saiu do cofrinho**, e o desenho melhorou com isso: o app da família já tem
PIN de verdade — que *criptografa* os dados em repouso, não só esconde a tela —,
e é onde o adulto já administra tudo. A "continha de proteção" deixou de existir.

Entra em dois lugares, cada um pelo que é:

**Configurações → Crianças** — o cadastro, que se faz de vez em quando:

```
CRIANÇAS

  🦊 Criança 1        R$ 8,00 · sexta       ›
      3 tarefas · meta: bicicleta (58%)

  🐢 Criança 2        R$ 5,00 · sexta       ›
      2 tarefas · sem meta

  + Adicionar criança
```

Dentro de cada uma: semanada e dia, valor da moeda mágica, tarefas, metas, senha,
avatar e cor — e o **extrato completo** dela, com todo movimento.

**Fila de pendências do Painel** — o que é frequente, no lugar que você já olha:

```
PRECISA DE VOCÊ

  ⚠ Energia · 3 dias de atraso          R$ 400,00
  🧒 3 tarefas marcadas para confirmar    🪙 +R$ 3,00
  🧒 Semanada de sexta ainda não saiu     R$ 8,00
```

Sem isso, dar a semanada vira uma coisa a lembrar — e o que se esquece de fazer
apodrece, que é justamente o problema que a fila resolve para as contas.

---

## A moeda mágica: como o dinheiro guardado rende

A cada semana em que o pote **guardar** não diminuiu, cai uma moeda extra de valor
fixo. O valor é configurado por criança, e zero desliga.

```
        🎯 VOCÊ GUARDOU A SEMANA TODA!

              🪙 +R$ 1,00
             MOEDA MÁGICA

        "Quem espera, ganha mais!"

        Pote guardar:  R$ 7  →  R$ 8
```

**Por que não porcentagem.** Aos 6 anos proporção não existe, e com os valores
dele um percentual honesto é invisível: 1% sobre R$ 7 são sete centavos. O que não
se vê não ensina. A moeda mágica entrega o mesmo conceito — **esperar rende** — no
ciclo semanal que ele compreende, com uma moeda que ele vê cair.

**Por que ela não cai na armadilha da moeda paralela.** Ela aumenta o dinheiro
real dele, não cria pontos trocáveis. O prêmio continua sendo a bicicleta.

**A regra, por extenso:** na virada da semana, se não houve nenhuma saída do pote
guardar desde a última verificação, nasce uma entrada de tipo `rendimento`. Se
houve saída, não nasce — e a tela diz isso sem repreender: *"Esta semana você usou
um pouco do que guardou. Semana que vem tem outra moeda mágica esperando!"*

**Migrar depois.** Por volta dos 9 ou 10 anos, quando porcentagem já faz sentido,
a moeda mágica vira percentual de verdade. O campo de configuração já prevê os
dois formatos.

**No orçamento de vocês** ela aparece como o que é: um custo pequeno e recorrente,
somado à semanada. R$ 1 por semana são R$ 4,33 por mês por criança.

---

## Modelo de dados

Quatro tabelas novas, no mesmo Supabase, com o mesmo envelope de sync
(`id`, `family_id`, `updated_at`, `deleted`). **Nenhum nome próprio no schema.**

```sql
kids          id, family_id, name, avatar, cor, nascimento_ano, active,
              semanada_valor, semanada_dia (0-6),
              rendimento_tipo ('moeda' | 'percentual'), rendimento_valor,
              pin_hash, pin_salt

kid_goals     id, family_id, kid_id, name, icon,
              target_amount, done, done_at

kid_tasks     id, family_id, kid_id, name, icon, amount, active

kid_entries   id, family_id, kid_id, tipo, amount, date, description,
              pote, task_id, goal_id, confirmada
              -- tipo:  semanada | tarefa | presente | gasto | doacao | rendimento
              -- pote:  gastar | guardar | doar
```

**O saldo de cada pote é derivado das entradas**, nunca materializado — a mesma
regra que o app da família usa para saldo e previsão. Um total guardado à parte
diverge no primeiro erro, e ninguém percebe.

`rendimento_tipo` já nasce com os dois formatos previstos: hoje `moeda` (a moeda
mágica semanal), e `percentual` para quando ele tiver 9 ou 10 anos e proporção
fizer sentido. Zero em `rendimento_valor` desliga.

`confirmada` existe só para a tarefa: a criança marca, o adulto confirma. Sem esse
passo o app vira máquina de auto-serviço.

---

## O que muda no app da família

Mais do que a versão anterior deste plano previa, porque a **área dos pais migrou
para cá** — e isso foi uma melhora, não um custo: o PIN daqui criptografa os dados
de verdade, e é onde vocês já administram tudo.

| onde | mudança |
|---|---|
| `js/sync.js` | 4 linhas: as tabelas novas em `SYNC_TABLES` |
| `supabase/schema.sql` | as 4 tabelas, com `create table if not exists` |
| **Configurações → Crianças** | seção nova, no padrão de "Contas fixas" |
| **fila de pendências do Painel** | duas linhas novas: tarefas a confirmar e semanada a dar |
| todo o resto | intocado |

Nenhuma tela existente muda de comportamento. A fila de pendências **ganha itens**,
pelo mesmo caminho que já usa para contas vencidas — e é por isso que ela é o lugar
certo: o que se esquece de fazer apodrece, e dar a semanada é semanal.

O push e o pull já **isolam falha por tabela** — se o SQL ainda não foi rodado, só
o cofrinho deixa de sincronizar e o resto da base continua andando. Isso já está
testado.

A semanada aparece no orçamento de vocês como **contrato semanal**, pelo mecanismo
que já existe: `R$ 8,00 · toda semana · sem prazo` entra no custo fixo mensal como
R$ 34,67 e na projeção. Somada à moeda mágica (R$ 4,33/mês), o custo por criança
fica visível e planejado, em vez de virar vazamento.

---

## Arquitetura de arquivos

Pasta própria, escopo próprio, service worker próprio:

```
cofrinho/
  index.html               a tela do app
  cofrinho.js              a lógica
  cofrinho.css             o visual (claro, colorido — nada do tema escuro)
  manifest.webmanifest     nome "Cofrinho", ícone próprio
  sw.js                    cache próprio, escopo /cofrinho/
  icons/                   ícone do app

  → reaproveita ../js/db.js e ../js/sync.js
```

**Na prática:** você abre `.../cofrinho/` no aparelho dele uma vez e adiciona à
tela de início. Nasce um ícone separado, com nome e cor próprios, que abre em tela
cheia. Ele nunca vê o app de vocês; vocês nunca veem a tela dele.

---

## Interface: as regras que a idade impõe

- **Alvo de toque mínimo de 75 × 75 px**, com 64 px de espaço entre botões — mãos
  pequenas erram, e erro repetido frustra.
- **Nada de botão colado no rodapé**: crianças tocam ali por acidente o tempo todo.
- **Som e animação em toda ação** — é assim que ele sabe que funcionou.
- **Cores fortes e claras**, o oposto do tema escuro do app da família.
- **Uma decisão por tela.** Navegação complexa é o que mais frustra de 5 a 7 anos.
- **Texto curto ou nenhum.** Onde precisar explicar, ícone + três palavras.

---

## Etapas

Você pediu o pacote completo; ele sai em quatro entregas testáveis, para dar para
ver a reação dele antes de refinar.

1. **A base e a gestão** — as quatro tabelas, o sync, e a seção
   *Configurações → Crianças* no app da família: cadastrar criança, semanada, dia,
   senha, avatar e cor, com o extrato completo dela.
2. **O cofrinho** — o PWA próprio: teclado da senha, tela do cofrinho com os três
   potes e o saldo derivado, e a meta com a barra.
3. **O ritual e as tarefas** — a tela da semanada com a divisão nos potes, as
   tarefas marcadas pela criança, a confirmação do adulto pela fila de pendências
   do Painel, e o contrato semanal no orçamento de vocês.
4. **O brilho** — moeda mágica com animação, moedas caindo nos potes, sons, confete
   ao bater a meta, selos da semana, mascote e a linha do tempo ilustrada.

A ordem não é preferência: cada etapa depende da anterior, e a quarta é a que só
faz sentido quando há o que celebrar.

---

## O que fica fora, e por quê

| ideia | por que não |
|---|---|
| Cartão de débito infantil | aos 6 não há uso; faz sentido de 10 a 12 |
| Juros sobre o que ele guarda | proporção e porcentagem não existem nessa idade |
| Competição entre irmãos | comparação social aos 6 é cruel, não motiva |
| Pontos trocáveis por prêmios | é a moeda paralela que a pesquisa desaconselha |
| Empréstimo / dívida | conceito abstrato demais; e ensina cedo demais a antecipar |
| Notificação push para a criança | o ritual é semanal e presencial, com um adulto junto |

---

## Fontes

- [Overjustification effect](https://en.wikipedia.org/wiki/Overjustification_effect) ·
  [The Overjustification Effect: When Rewards Undermine](https://www.structural-learning.com/post/overjustification-effect)
- [Gamification e motivação intrínseca — meta-análise](https://link.springer.com/article/10.1007/s11423-023-10337-7)
- [A Practical Guide To Designing For Children — Smashing Magazine](https://www.smashingmagazine.com/2024/02/practical-guide-design-children/)
- [UI/UX Design for Children: Age-Appropriate App Guidelines](https://www.aufaitux.com/blog/ui-ux-designing-for-children/)
- [Serasa — Educação financeira infantil na prática](https://www.serasa.com.br/blog/educacao-financeira-infantil-como-ensinar-para-os-seus-filhos/)
- [Itaú — Dinheiro também é coisa de criança](https://feito.itau.com.br/educacao-financeira-para-criancas-como-ensinar/)
