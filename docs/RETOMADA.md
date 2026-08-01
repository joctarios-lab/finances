# Prompt de retomada

Cole o bloco abaixo ao abrir uma sessão nova. Ele foi escrito para que o assistente
não precise redescobrir nada — e, principalmente, para que não repita erros que já
custaram tempo aqui.

---

```
Vamos continuar o PWA de finanças da família em D:\Projetos\meus-projetos\financas
(repo público: github.com/joctarios-lab/finances, branch main).

Leia primeiro, nesta ordem:
  docs/plano-sync.md                    ← por que o marcador do pull é server_at
  docs/plano-visao-futuro.md            ← como as telas mostram meses futuros
  docs/plano-graficos.md                ← ApexCharts e o que continua SVG à mão
  docs/plano-disponivel-e-recorrencia.md
  docs/plano-extrato.md
  docs/plano-ia.md

## Estado atual
- Versão 112 (sw.js VERSAO + as 12 tags ?v= do index.html andam JUNTAS a cada entrega)
- 2167 testes em tests/smoke.js, todos passando: `node tests/smoke.js`
- Nada pendente no git

## PENDÊNCIA MINHA (do usuário), confira antes de mexer em sync
Rodar o bloco "CARIMBO DO SERVIDOR" de supabase/schema.sql. É idempotente.
Conferência:
  select event_object_table, trigger_name from information_schema.triggers
   where trigger_name = 'trg_server_at' order by event_object_table;
Devem aparecer 9 linhas. Enquanto não rodar, o app usa fallback automático e
funciona — mas sem a garantia contra perda de registro.

## Como trabalhamos aqui (siga)
- Diagnostique medindo, não supondo. Reproduza o defeito antes de corrigir.
- Depois de corrigir, SABOTE o código e confirme que o teste reprova. Teste que
  não pega regressão não vale. Todo script de sabotagem restaura num `finally` —
  um deles foi interrompido nesta sessão e deixou a alteração aplicada no código.
- Valide contra dados reais quando fizer sentido: o .env (gitignored) tem as
  credenciais do Supabase. Leia por script local; NUNCA traga credencial para o
  chat nem para o commit.
- js/config.js é vazio de propósito — o repo é público. Nunca preencher.
- Comentários e mensagens de commit em português, explicando o PORQUÊ.
- Confirme o push consultando o servidor (git ls-remote), não só o git status.

## Permissões — já estão configuradas, não peça de novo
As regras de execução estão em .claude/settings.local.json (fora do git, é
config pessoal desta máquina). Estão por PADRÃO: node, git, grep, sed, cat,
curl, npx serve e os scripts temporários em .claude/jobs/ rodam sem perguntar.
Só é negado o que não tem volta: rm -rf, push --force, reset --hard, git clean.

Se ainda assim aparecer um pedido, é porque o comando não casa com nenhum
padrão — me diga qual foi e eu acrescento a regra, em vez de você aprovar na
mão toda vez.

## Armadilhas de ferramenta que já me pegaram
- js/app.js e tests/smoke.js usam CRLF; js/sync.js e js/graficos.js usam LF.
  Casar padrão com o fim de linha errado falha silenciosamente.
- `$` numa string de substituição do replace() é padrão especial: 'R$' corrompe
  o arquivo. Use split/join.
- Heredoc no bash quebra com aspas/acentos: prefira escrever o script num arquivo.
- A suíte termina com process.exit dentro de uma IIFE async. Bloco async novo
  precisa de `await`, senão agenda e nunca roda.

## Decisões que não devem ser revertidas sem conversa
- O marcador do pull é server_at (carimbo do banco). updated_at é do cliente e
  serve só para resolver conflito. Trocar reintroduz perda silenciosa de dados.
- A rosca (svgDonut) é o único gráfico em SVG à mão — foi medido, não é descuido.
- Em mês futuro, DB.txOfPeriod devolve transações VIRTUAIS (sem id, virtual:true).
  Elas não podem entrar em nada que grave: edição em massa, linha clicável do
  extrato, botão de pagar.
- "Disponível" (desconta comprometido e guardado) ≠ "Saldo em conta". Os dois
  aparecem no app e não podem ter o mesmo nome.

## O que eu quero fazer agora
[escreva aqui]
```

---

## Sobre as permissões

`.claude/settings.local.json` é **gitignored** — é config desta máquina, não do
projeto. Numa máquina nova ele não existe, e os pedidos voltam.

O arquivo tinha 96 regras, **82 delas literais**: comandos exatos como
`sed -i "s/const VERSAO = '29'/..."`, que só valem para aquele comando e nunca
mais casam. Por isso o pedido reaparecia mesmo com "tudo autorizado". Foram
substituídas por padrões (`Bash(node:*)`, `Bash(git push:*)`, …), que cobrem as
variações.

O que ficou negado, de propósito: `rm -rf`, `git push --force`, `git reset --hard`,
`git clean`. Com `node:*` liberado dá para rodar qualquer script, então o limite
precisa estar onde o estrago não tem volta.

Backup do arquivo antigo, caso queira conferir algo:
`C:\Users\joctamr\.claude\jobs\f1445160\tmp\settings.local.backup.json`

**Nota honesta:** texto no prompt não desliga pedido de permissão — quem decide é
o Claude Code, lendo esse arquivo. As alternativas, se quiser zero atrito, são
`/permissions` dentro da sessão ou iniciar com `--permission-mode acceptEdits`.

## Contexto que não cabe no prompt, mas está nos commits

Últimos 12 commits desta sessão, do mais recente:

| commit | o quê |
|---|---|
| `efa022d` | carimbo do servidor (`server_at`) como marcador do pull |
| `340a17d` | pull deixava registros para trás (perda silenciosa) |
| `7790d99` | duplicação na previsão e rodapé resumindo o próximo mês |
| `b9c0cf1` | visão de futuro coerente em todos os objetos das telas |
| `b2d0510` | cenários futuros até 6 meses nas três telas |
| `8bed051` | filtrar sem categoria, calendário fora do recorte, botão de meta |
| `50e6249` | previsto no lugar errado, escalas ancoradas, fatura em aberto |
| `8baa98e` | primeira linha do painel: reserva, projeção, regra 50·30·20 |
| `29c1bb9` | remove o eixo de valor de oito gráficos |
| `ee4e23f` | trilha ideal não desenhava + acabamento do widget 29 |
| `e920879` | rankings seguem o Charts Widget 27 do demo25 |
| `353ec8b` | tamanho do texto dos gráficos ancorado no layout |

**Referência de design:** Metronic 8 demo25, em
`D:\Storage Old\Disco E\Projetos\Scripts\metronic_html_v8.2.6_demo25\demo25`.
As configs de gráfico estão em `assets/js/widgets.bundle.js`.

**Três defeitos de dados encontrados nesta sessão, todos com a mesma assinatura** —
o número da tela não batia com outro número da própria tela:

1. A previsão contava o mesmo compromisso duas vezes quando o contrato nascia de
   um lançamento que já existia (nenhuma das 11 recorrências tinha `recurrence_id`).
2. `committedDepois` ignorava contrato e custo fixo.
3. O pull perdia registros de aparelho que ficou offline.

Quando um número não fecha com outro, é defeito até prova em contrário.
