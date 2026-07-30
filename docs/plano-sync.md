# Sincronização: por que o marcador é `server_at`

## O defeito que motivou tudo

Um lançamento de aluguel (R$ 3.500, 10/08) estava no Supabase e **não** na base
local. O extrato de agosto e o card de previsão simplesmente não o mostravam.
Confirmado com dados de produção: o registro existia, íntegro, com os mesmos campos
de outro que aparecia.

**A causa:** `updated_at` é gravado por **quem cria** o registro, com o relógio do
aparelho. Isso o torna inútil como marcador de sincronização.

O pull perguntava *"o que foi editado depois de X?"*. Um aparelho que ficou offline
envia, ao voltar, registros com timestamp de horas atrás — e qualquer outro
aparelho que já sincronizou nesse intervalo pede `> lastSync` e **nunca mais os
busca**. O dado fica no servidor para sempre, invisível.

Medido contra o servidor real, simulando o aparelho com `lastSync` de 15:00:

| | resultado |
|---|---|
| por `updated_at` | 7 registros — aluguel **não** veio |
| por `server_at` | aluguel veio ✓ |

## A solução

**`server_at`** — coluna preenchida pelo BANCO a cada gravação, via trigger. O
cliente não tem como influenciá-la: o trigger sobrescreve o que vier.

A pergunta passa a ser *"o que chegou aqui depois de X?"*, que depende de **um
relógio só**.

**`updated_at` continua existindo** e continua sendo do cliente: ele resolve
**conflito** (quem editou por último vence). Os dois campos respondem perguntas
diferentes e por isso convivem.

### Detalhes que importam

- **`clock_timestamp()`, não `now()`.** `now()` devolve o início da *transação*, então
  duas gravações concorrentes recebem o mesmo instante e podem sair na ordem errada.
- **Margem de 5 minutos** no marcador. Duas gravações podem receber o carimbo em
  ordem e commitar fora de ordem. Reprocessar é inofensivo: o merge é por id.
- **O marcador guardado (`meta.serverAt`) é o maior carimbo RECEBIDO** — um valor
  que veio do servidor. Guardar o relógio local ali seria refazer o defeito por
  outro caminho.
- **Índice `(family_id, server_at)`** em cada tabela: sem ele, cada sincronização
  varreria a tabela inteira.

## As três redes de segurança

1. **Releitura completa semanal.** Se o carimbo falhar por qualquer motivo — uma
   tabela sem o trigger, um registro migrado à mão —, a divergência se fecha
   sozinha em no máximo uma semana, sem depender de alguém notar.
2. **Paginação.** Sem ela, uma tabela com mais alterações que o limite trazia só a
   primeira página e o marcador avançava como se tudo tivesse vindo — o resto
   ficava invisível para sempre, pelo mesmo mecanismo.
3. **Fallback automático.** `server_at` depende de um SQL que pode não ter sido
   rodado — num banco novo, ou entre publicar o app e executar a migração. Pedir
   por coluna inexistente derrubaria o pull inteiro, e o remédio seria pior que a
   doença. Então o campo é **detectado**: na primeira falha por coluna ausente, o
   pull cai para `updated_at` com janela de 7 dias e segue funcionando.

O fallback foi validado contra o servidor real **antes** de a migração ser
executada: sincronizou 270 transações, 5 contas, 110 categorias e 14 recorrências
sem erro, e trouxe o aluguel.

## O SQL

Está em `supabase/schema.sql`, no bloco "CARIMBO DO SERVIDOR". É idempotente
(`add column if not exists`, `create index if not exists`, `drop trigger if
exists`), então rodar de novo não faz mal.

Conferência depois de rodar:

```sql
select event_object_table, trigger_name from information_schema.triggers
 where trigger_name = 'trg_server_at' order by event_object_table;
```

Devem aparecer 9 linhas — uma por tabela sincronizada.
