-- ============================================================
--  ZERAR TUDO PARA UM TESTE DO ZERO
--  Rodar no Supabase → SQL Editor
-- ============================================================
--  ATENÇÃO: isto APAGA TODOS OS DADOS e TODAS AS CONTAS do
--  projeto, sem backup e sem desfazer. Confira no topo do painel
--  que o projeto aberto é o certo antes de executar.
--
--  Só apaga DADOS — as tabelas, políticas e funções continuam de
--  pé. Não é preciso rodar o schema.sql de novo depois (mas se o
--  schema estiver atrasado, rode-o ANTES: veja o passo 0).
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 0 (opcional, mas recomendado): garanta o schema atual
-- ------------------------------------------------------------
-- Se você ainda não rodou o supabase/schema.sql depois das
-- subcategorias, rode-o primeiro — ele adiciona categories.parent_id.
-- É seguro rodar de novo: só cria o que falta.


-- ------------------------------------------------------------
-- PASSO 1: apagar os dados da aplicação
-- ------------------------------------------------------------
-- truncate em vez de delete: é mais rápido e reinicia as sequências.
-- cascade cobre qualquer dependência que apareça no futuro.
truncate table
  transactions,
  goal_entries,
  goals,
  invoice_status,
  budget_overrides,
  recurrences,
  categories,
  cards,
  accounts,
  family_settings,
  push_subscriptions,
  notification_log,
  family_members,
  families
restart identity cascade;


-- ------------------------------------------------------------
-- PASSO 2: apagar as contas de acesso
-- ------------------------------------------------------------
-- Remover de auth.users leva junto identidades, sessões e refresh
-- tokens (o próprio Supabase declara essas FKs em cascata).
delete from auth.users;

-- Se este delete for recusado por permissão, faça pelo painel:
--   Authentication → Users → selecionar tudo → Delete user


-- ------------------------------------------------------------
-- PASSO 3: conferir que sobrou zero
-- ------------------------------------------------------------
select 'families'           as tabela, count(*) from families
union all select 'family_members',      count(*) from family_members
union all select 'accounts',            count(*) from accounts
union all select 'cards',               count(*) from cards
union all select 'categories',          count(*) from categories
union all select 'transactions',        count(*) from transactions
union all select 'goals',               count(*) from goals
union all select 'goal_entries',        count(*) from goal_entries
union all select 'invoice_status',      count(*) from invoice_status
union all select 'budget_overrides',    count(*) from budget_overrides
union all select 'recurrences',      count(*) from recurrences
union all select 'family_settings',     count(*) from family_settings
union all select 'push_subscriptions',  count(*) from push_subscriptions
union all select 'notification_log',    count(*) from notification_log
union all select 'auth.users',          count(*) from auth.users
order by tabela;


-- ============================================================
--  PASSO 4 — NO APARELHO, e isto não é opcional
-- ============================================================
--  Zerar só o servidor deixa o app em estado inconsistente: ele
--  guarda no aparelho o family_id da família que acabou de ser
--  apagada, além dos lançamentos e do login. Ao sincronizar, ele
--  tentaria escrever numa família que não existe mais.
--
--  Em CADA aparelho que já usou o app:
--    Configurações → Apagar dados deste aparelho → digitar APAGAR
--
--  Isso limpa lançamentos, login, PIN, digital e o cache, e o app
--  volta para a tela de primeiro acesso — que é o ponto de partida
--  que você quer para o teste.
-- ============================================================
