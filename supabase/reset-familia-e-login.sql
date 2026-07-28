-- ============================================================
--  APAGAR A FAMÍLIA E AS CONTAS DE ACESSO
--  Rodar no Supabase → SQL Editor
-- ============================================================
--  As tabelas de DADOS (lançamentos, contas, categorias…) não
--  precisam disto — elas se apagam pelo app ou pelo script.
--
--  Estas duas não: 'families' e 'family_members' têm política
--  só de inserir e ler, sem excluir. É proposital — impede que
--  um membro derrube a família inteira pelo aplicativo. Aqui no
--  SQL Editor você roda como dono do banco, sem essa trava.
--
--  IRREVERSÍVEL. Confira no topo do painel que o projeto é o
--  certo antes de executar.
-- ============================================================

-- 1. Vínculo de membros e a própria família
delete from family_members;
delete from families;

-- 2. Contas de acesso (leva identidades, sessões e tokens junto)
delete from auth.users;
-- Se der erro de permissão, faça pelo painel:
--   Authentication → Users → selecionar tudo → Delete user

-- 3. Conferência: tudo deve voltar zero
select 'families' as tabela, count(*) from families
union all select 'family_members', count(*) from family_members
union all select 'auth.users',     count(*) from auth.users
union all select 'transactions',   count(*) from transactions
union all select 'accounts',       count(*) from accounts
union all select 'categories',     count(*) from categories
order by tabela;

-- ============================================================
--  DEPOIS, NO APARELHO — e isto não é opcional:
--    Configurações → Apagar dados deste aparelho → APAGAR
--
--  O celular guarda os lançamentos, o login e o id da família.
--  Sem limpar, ele reenvia tudo na próxima sincronização e
--  desfaz o que você acabou de apagar aqui.
-- ============================================================
