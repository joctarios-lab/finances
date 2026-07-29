# Plano — IA no app de finanças

Documento de planejamento. Nada aqui está implementado.

## Princípios que valem para tudo

Vieram de erros reais deste projeto, não de teoria.

**A IA propõe, a pessoa decide.** O padrão que mais causou dano até aqui foi o app
decidir sozinho sem deixar discordar: o dedupe que apagava lançamento legítimo, o
palpite que ignorava a marcação do usuário. Uma IA que grava sem confirmação
multiplica isso.

**A IA nunca calcula dinheiro.** Ela interpreta a pergunta e redige a resposta; quem
soma é o app. Um número errado que parece certo é o pior defeito possível num app
de finanças — custou uma tarde inteira achar R$ 100 fora do lugar.

**Nunca vira dependência.** O app é offline-first. Sem rede, sem chave ou com a
chave estourada, tudo continua funcionando como hoje.

**Nada de fuzzy onde precisa ser exato.** Conciliação, duplicata e casamento de
transferência ficam fora do alcance da IA. Já se provou que aproximação ali some
com dinheiro — e o critério de uma IA não é auditável.

---

## Fase 1 — Aprender com o próprio histórico (sem IA)

Resolve a maior parte do problema sem rede, sem custo e sem expor dado nenhum.
Vale fazer mesmo que a IA nunca entre.

**O que é:** hoje o app repete a classificação quando a descrição é idêntica à de
um lançamento anterior. Extrato de banco quase nunca repete a descrição exata —
muda o número da parcela, a data embutida, o terminal. Comparar por *trecho*
estável (o nome do estabelecimento) cobre muito mais.

**Onde mexe**
- `js/db.js`: `sugerirCategoriaAprendida(memo, tipo)` — tokeniza a descrição, casa
  contra o histórico, devolve a categoria mais usada para aquele estabelecimento
- `js/app.js`: usar antes de `OFX.guessCategoryId` na importação e no formulário
- Sem mudança de schema: tudo é derivado de `transactions`

**Decisões**
- Quantos acertos anteriores exigir antes de sugerir (1 basta? 2 é mais seguro?)
- Como marcar na tela que a sugestão veio do histórico e não de palpite

**Risco:** baixo. Errar aqui só troca uma sugestão por outra, e a pessoa vê antes
de salvar.

---

## Fase 2 — IA classificando o que sobrou

**O que é:** os lançamentos que nem o histórico nem as palavras-chave
reconheceram vão em lote para a IA, junto da árvore de categorias da família. Ela
devolve uma sugestão por linha. Tudo cai no preview da importação, que já tem
seletor por linha e já é revisável.

**Onde mexe**
- `js/ia.js` (novo): configuração, chamada, tratamento de erro e limite de custo
- `js/app.js`: no preview do OFX, um passo "classificando…" antes de montar as linhas
- Configurações → nova seção "Inteligência artificial"

**Privacidade — a decisão mais importante**

Enviar o extrato para um terceiro tira os gastos da família do aparelho. Proposta:
mandar **apenas a descrição**, sem valor, sem data, sem saldo, sem nome de conta.
Para classificar "PDS COMERCIO DE ALIMENTOS" em Alimentação, o valor é irrelevante.

Isso cobre o caso principal com exposição mínima, e a tela precisa dizer
exatamente o que sai — não em letra miúda. A decisão é da família inteira, não só
de quem configurou.

**Decisões**
- Provedor: um só ou vários? (OpenAI, Anthropic, Google — todos têm API compatível
  o bastante para uma camada fina)
- A chave fica no aparelho de quem configurou, ou sincroniza para a família?
  Sincronizar é conveniente e espalha um segredo; guardar local obriga cada um a
  configurar. Inclinação: local, com a mesma lógica das credenciais do Supabase.
- Teto de gasto: limite de linhas por importação, ou aviso a cada N chamadas

**Risco:** médio, mas contido — nada é gravado sem passar pelo preview.

---

## Fase 3 — Perguntar em português

**O que é:** "quanto gastei com carro este ano?", "a Gleice recebeu quanto de mim
em julho?". A IA **não responde** — ela traduz a pergunta em um filtro, o app
aplica e calcula, e a IA redige a resposta com os números que o app produziu.

**Por que encaixa bem aqui:** o app já tem uma linguagem de filtro pronta — a
estrutura de `FILTROS_VAZIOS` (tipo, situação, âmbito, membro, categoria,
etiqueta, método, contas, faixa de valor, período). A IA só precisa emitir esse
JSON. E `txsFiltradas()` já sabe aplicá-lo.

Isso torna a resposta auditável: dá para mostrar "filtrei por Transporte, julho,
todas as contas" junto do número, e um toque leva ao extrato com aquele filtro
aplicado. Se a interpretação estiver errada, a pessoa vê na hora.

**Onde mexe**
- `js/ia.js`: função que devolve `{ filtros, periodo, intencao }`
- `js/app.js`: campo de pergunta (provavelmente no Painel ou nos Relatórios)
- Reaproveita `txsFiltradas`, `spentByCategory`, `spentByTag`, `saldoNaData`

**Decisões**
- Onde entra na interface sem virar mais um bloco no Painel, que já tem 23
- Mostrar sempre o filtro interpretado, ou só quando a pessoa pedir

**Risco:** baixo para a correção (o app calcula), médio para a expectativa — a
pessoa pode perguntar coisas que o filtro não expressa, e a resposta precisa
dizer "não sei" em vez de inventar.

---

## Fase 4 — Lançar por texto ou voz

"Gastei 50 no mercado ontem no débito" abre o formulário preenchido. Bom no
celular, principalmente por voz. Depende da Fase 2 estar funcionando (é o mesmo
tipo de interpretação) e é a de menor retorno das quatro — o formulário já é
rápido e adaptativo.

---

## O que fica fora, e por quê

| Ideia | Por que não |
|---|---|
| IA decidindo duplicata | Precisa ser exato e auditável; aproximação já sumiu com dinheiro aqui |
| IA conciliando saldo | Mesmo motivo; e um ajuste errado contamina meses |
| IA lançando sozinha | Sem confirmação, repete o pior padrão que o app já teve |
| IA calculando totais | O app calcula; a IA redige |
| Categorizar automaticamente sem revisão | O preview existe justamente para isso |

---

## Ordem sugerida

1. **Fase 1** — melhora a importação sozinha, offline, e reduz o volume que vai
   para a IA depois (menos custo e menos exposição)
2. **Fase 2** — o ganho mais visível, sobre a base já reduzida pela Fase 1
3. **Fase 3** — depende da confiança construída nas anteriores
4. **Fase 4** — só se as três primeiras estiverem sólidas

## Pendências para decidir antes de começar

- [ ] Chave de IA: local por aparelho ou sincronizada para a família?
- [ ] Enviar só descrição, ou descrição + valor? (proposta: só descrição)
- [ ] Provedor único ou camada para vários?
- [ ] Como a família é avisada de que dados saem do aparelho
- [ ] Teto de custo e o que acontece ao atingir
- [ ] Quem é "administrador" — hoje o app não tem papéis, todo membro é igual
