-- ===========================================================================
--  MIGRAÇÃO — o cofrinho das crianças
--
--  Rode este arquivo INTEIRO no Supabase → SQL Editor (cole e execute).
--
--  É seguro, e pode rodar mais de uma vez: tudo aqui é "if not exists" ou
--  "create or replace". Nada é apagado, nada é recriado e nenhum dado existente
--  é tocado — só acrescenta o que falta.
--
--  O que ele faz:
--    1. acrescenta a coluna 'pontual' em transactions
--    2. cria as quatro tabelas do cofrinho, com RLS ligado
--    3. reaplica o carimbo do servidor em TODAS as tabelas sincronizadas,
--       inclusive nas quatro novas — sem ele o pull perde registros de vez em
--       quando, e o sintoma é quase impossível de rastrear
--
--  Ao terminar, volte ao app e toque em sincronizar.
--
--  (Este arquivo é um recorte de supabase/schema.sql, que continua sendo a
--   fonte completa. Rodar o schema inteiro também funciona e dá no mesmo.)
-- ===========================================================================

-- Classificação pontual de um gasto: o terceiro estado, além de fixo e variável
alter table transactions add column if not exists pontual boolean not null default false;

-- A semanada e um contrato, ligado a crianca por esta coluna.
alter table recurrences add column if not exists kid_id uuid;
create index if not exists idx_rec_kid on recurrences(kid_id);

-- E o LANCAMENTO da semanada tambem se identifica: dar a semanada nao e gastar.
-- O dinheiro fica na conta da familia e passa a ter outro dono, entao o lancamento
-- e NEUTRO no saldo. Ja o GASTO dela sai da casa de verdade e vira despesa.
alter table transactions add column if not exists kid_id uuid;
create index if not exists idx_tx_kid on transactions(kid_id);


/* ---------------------------------------------------------------------------
   COFRINHO — o dinheiro das crianças

   Quatro tabelas, mesmo envelope de sync das demais (id, family_id, updated_at,
   deleted). Nenhum nome próprio no schema: cada família cadastra as suas.

   O saldo de cada pote é DERIVADO de kid_entries, nunca materializado — a mesma
   regra que o app usa para saldo e previsão. Um total guardado à parte diverge no
   primeiro erro e ninguém percebe.
   --------------------------------------------------------------------------- */

create table if not exists kids (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  avatar text default '🦖',              -- emoji que representa a criança
  cor text default '#00b894',            -- cor do tema do cofrinho dela
  nascimento_ano int,                    -- só o ano: idade aproxima, e não é dado sensível
  -- Semanada, não mesada: abaixo dos 10 anos é o ciclo que a criança compreende.
  semanada_valor numeric not null default 0,
  semanada_dia int not null default 5,   -- 0=domingo … 6=sábado
  -- Como o guardado rende: 'moeda' (a mágica semanal, valor fixo) ou 'percentual',
  -- que fica para quando houver idade de entender proporção. Zero desliga.
  rendimento_tipo text not null default 'moeda',
  rendimento_valor numeric not null default 0,
  -- Senha do cofrinho: separa irmãos, não guarda dinheiro. Hash com sal basta.
  pin_hash text default '',
  pin_salt text default '',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists kid_goals (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null,
  name text not null,
  icon text default '🎁',
  target_amount numeric not null default 0,
  done boolean not null default false,
  done_at date,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists kid_tasks (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null,
  name text not null,
  icon text default '⭐',
  amount numeric not null,
  -- semanal (faz uma vez) | diaria (todo dia, e o valor sai UMA VEZ ao completar
  -- a semana). Pagar a diária por dia faria 70% da renda da criança vir de uma
  -- tarefa e ensinaria que cuidar de quem depende dela tem preço por unidade.
  frequencia text not null default 'semanal',   -- semanal | diaria | especial
  -- Só na especial: a data em que o combinado deixa de valer. O app conta em
  -- NOITES de sono, que é a unidade que uma criança de seis anos manipula.
  expira_em date,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists kid_entries (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null,
  -- Entra: semanada | tarefa | presente | rendimento | inicial (o que ela já tinha
  -- quando o cofrinho começou) — e divisao, que soma zero: são três linhas que
  -- movem dinheiro entre potes, e existem para o histórico dela MOSTRAR a escolha.
  -- Sai: gasto | doacao
  -- Texto livre de propósito, sem CHECK: um tipo novo no app não pode exigir
  -- migração de banco para funcionar, senão o app novo quebra contra o banco velho.
  tipo text not null default 'semanada',
  amount numeric not null,
  date date not null,
  description text default '',
  -- gastar | guardar | doar — de qual pote entrou ou saiu
  pote text not null default 'gastar',
  task_id uuid,                          -- quando veio de uma tarefa
  -- Nome próprio para não colidir com goal_entries.goal_id, que é NOT NULL.
  kid_goal_id uuid,                      -- quando a saída foi para realizar a meta
  -- A criança marca a tarefa, o adulto confirma. Só vale para tipo='tarefa'.
  confirmada boolean not null default true,
  -- A criança já repartiu este dinheiro nos três potes? Vale para 'semanada' e
  -- para 'inicial' (o saldo de abertura).
  --
  -- A marca fica no LANÇAMENTO em vez de ser uma pergunta ao calendário. Antes o
  -- app perguntava "houve divisão nesta semana?", o que serve para a semanada e
  -- falha para o saldo de abertura: ele é datado no passado, porque o dinheiro não
  -- chegou hoje, e a busca por data nunca o encontrava — a criança repartia e o
  -- app pedia de novo, em looping.
  repartido boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- ============================================================
-- AS COLUNAS QUE CHEGARAM DEPOIS
--
-- ESTE BLOCO EXISTE PORQUE `create table if not exists` NÃO ADICIONA COLUNA.
--
-- Os creates acima descrevem a tabela COMPLETA, com as colunas novas dentro. Isso
-- funciona num banco vazio e não faz absolutamente nada num banco que já tem a tabela:
-- o Postgres vê que ela existe, pula o comando inteiro em silêncio, e as colunas novas
-- nunca aparecem. Nenhum erro é levantado — a migração diz "sucesso" e não migrou nada.
--
-- Foi exatamente o que aconteceu: só `kid_wishes` foi criada, porque era a única tabela
-- que ainda não existia. `frequencia` e `expira_em` continuaram faltando, e a missão
-- especial chegava no celular sem saber que era especial.
--
-- Toda coluna que chega depois precisa de um `alter table ... add column if not exists`.
-- Há teste garantindo que nenhuma coluna dos creates acima fique sem o alter dela.
-- ============================================================

-- kids
alter table kids add column if not exists avatar text;
alter table kids add column if not exists cor text;
alter table kids add column if not exists nascimento_ano int;
alter table kids add column if not exists semanada_valor numeric not null default 0;
alter table kids add column if not exists semanada_dia int not null default 1;
alter table kids add column if not exists rendimento_tipo text not null default 'nenhum';
alter table kids add column if not exists rendimento_valor numeric not null default 0;
alter table kids add column if not exists pin_hash text;
alter table kids add column if not exists pin_salt text;
alter table kids add column if not exists active boolean not null default true;

-- kid_goals
alter table kid_goals add column if not exists icon text default '🎁';
alter table kid_goals add column if not exists target_amount numeric not null default 0;
alter table kid_goals add column if not exists done boolean not null default false;
alter table kid_goals add column if not exists done_at date;

-- kid_tasks: `frequencia` e `expira_em` são as que faltavam, e são as que fazem a
-- missão especial ser especial. Sem elas o app recebe a missão como semanal.
alter table kid_tasks add column if not exists icon text default '⭐';
alter table kid_tasks add column if not exists amount numeric not null default 0;
alter table kid_tasks add column if not exists frequencia text not null default 'semanal';
alter table kid_tasks add column if not exists expira_em date;
alter table kid_tasks add column if not exists active boolean not null default true;

-- kid_entries. As três primeiras eu tinha esquecido, e o teste as pegou: um banco muito
-- antigo, de antes do cofrinho ganhar potes, não teria nenhuma delas.
alter table kid_entries add column if not exists tipo text;
alter table kid_entries add column if not exists amount numeric not null default 0;
alter table kid_entries add column if not exists date date;
alter table kid_entries add column if not exists pote text;
alter table kid_entries add column if not exists description text;
alter table kid_entries add column if not exists task_id uuid;
alter table kid_entries add column if not exists kid_goal_id uuid;
alter table kid_entries add column if not exists confirmada boolean not null default true;
alter table kid_entries add column if not exists repartido boolean not null default false;

-- kid_wishes
alter table kid_wishes add column if not exists icon text default '⭐';
alter table kid_wishes add column if not exists criada_em date;
alter table kid_wishes add column if not exists resposta text;
alter table kid_wishes add column if not exists respondida_em date;

create index if not exists idx_kid_entries_kid on kid_entries(family_id, kid_id, date);
create index if not exists idx_kid_goals_kid on kid_goals(family_id, kid_id);
create index if not exists idx_kid_tasks_kid on kid_tasks(family_id, kid_id);

alter table kids enable row level security;
alter table kid_goals enable row level security;
alter table kid_tasks enable row level security;
alter table kid_entries enable row level security;

do $$
declare t text;
begin
  foreach t in array array['kids','kid_goals','kid_tasks','kid_entries']
  loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated using (is_member(family_id)) with check (is_member(family_id))',
      t, t);
  end loop;
end $$;

create or replace function marca_server_at()
returns trigger language plpgsql as $$
begin
  -- Sobrescreve sempre, inclusive no update: o cliente pode mandar qualquer
  -- coisa nesta coluna e ela é ignorada. É isso que torna o campo confiável.
  new.server_at := clock_timestamp();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- CARIMBO DO SERVIDOR, aplicado a TODAS as tabelas sincronizadas
--
-- Roda por último, depois da última tabela existir, e descobre a lista sozinha:
-- toda tabela do schema public que tem `family_id` é uma tabela que o app
-- sincroniza, e portanto precisa do carimbo. É o que impede o erro que o
-- cofrinho revelou — quatro tabelas novas sem carimbo porque ninguém lembrou de
-- acrescentar o nome numa lista escrita à mão.
--
-- `families` e `family_members` ficam de fora por não terem `family_id`, e é
-- correto: elas não passam pelo pull incremental.
--
-- Idempotente: pode rodar quantas vezes quiser.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c
     join information_schema.tables tb
       on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'family_id'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format(
      'alter table %I add column if not exists server_at timestamptz not null default clock_timestamp()', t);
    -- O pull filtra por família e ordena por server_at: sem o índice, cada
    -- sincronização varreria a tabela inteira.
    execute format(
      'create index if not exists %I on %I (family_id, server_at)', t || '_family_server_idx', t);
    execute format('drop trigger if exists trg_server_at on %I', t);
    execute format(
      'create trigger trg_server_at before insert or update on %I
         for each row execute function marca_server_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Conferência: rode isto depois e verifique se aparecem 18 tabelas, todas com
-- RLS ligado, e a função create_family.
--
--   select tablename, rowsecurity as rls
--     from pg_tables where schemaname = 'public' order by tablename;
--
--   select routine_name from information_schema.routines
--    where routine_schema = 'public' and routine_name in ('is_member','create_family');
--
-- As 18: families e family_members (a própria família), as 14 que o app
-- sincroniza — accounts, cards, categories, transactions, recurrences, goals,
-- goal_entries, invoice_status, family_settings, budget_overrides e as quatro do
-- cofrinho (kids, kid_goals, kid_tasks, kid_entries) — mais push_subscriptions e
-- notification_log, que servem ao push e não passam pelo pull.
--
-- O carimbo do servidor também alcança essas duas últimas, porque elas têm
-- family_id e a descoberta é por essa coluna. É de propósito: filtrar por nome
-- traria de volta a lista escrita à mão que deixou o cofrinho sem carimbo. Uma
-- coluna e um trigger a mais numa tabela de push não custam nada.
--
-- Conferir o carimbo:
--   select event_object_table from information_schema.triggers
--    where trigger_name = 'trg_server_at' order by event_object_table;
-- ---------------------------------------------------------------------------

-- ============================================================
-- A LISTA DE VONTADES (kid_wishes)
--
-- O que a criança quer HOJE, anotado para ser reavaliado depois de algumas noites.
-- Separada de kid_goals de propósito: a meta tem valor e barra de progresso, a
-- vontade tem só um nome e uma data — misturar as duas transformaria toda vontade
-- passageira num compromisso.
--
-- Idempotente: rodar duas vezes não faz mal.
-- ============================================================
create table if not exists kid_wishes (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null,
  name text not null,
  icon text default '⭐',
  criada_em date,
  resposta text,
  respondida_em date,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_kid_wishes_kid on kid_wishes(family_id, kid_id);
alter table kid_wishes enable row level security;

do $$
begin
  execute 'drop policy if exists kid_wishes_rw on kid_wishes';
  execute
    'create policy kid_wishes_rw on kid_wishes for all to authenticated'
    || ' using (is_member(family_id)) with check (is_member(family_id))';
end $$;

-- O CARIMBO DO SERVIDOR (server_at) para a tabela nova.
--
-- A primeira versão deste bloco chamava `stamp_server_at()`, uma função que NUNCA
-- existiu -- o nome real é `marca_server_at`, e o erro só aparecia na hora de rodar,
-- com a migração já pela metade. Pior: a condição olhava se a COLUNA server_at existia
-- em kid_entries, quando o que o gatilho precisa é da FUNÇÃO. Num banco com a coluna e
-- sem a função, a condição dizia sim e o create trigger falhava.
--
-- Agora a condição pergunta exatamente o que vai usar: a função existe?
do $$
begin
  if exists (select 1 from pg_proc where proname = 'marca_server_at') then
    execute 'alter table kid_wishes add column if not exists server_at timestamptz'
      || ' not null default clock_timestamp()';
    -- O pull filtra por família e ordena por server_at: sem o índice, cada
    -- sincronização varreria a tabela inteira.
    execute 'create index if not exists kid_wishes_family_server_idx'
      || ' on kid_wishes (family_id, server_at)';
    execute 'drop trigger if exists trg_server_at on kid_wishes';
    execute 'create trigger trg_server_at before insert or update on kid_wishes'
      || ' for each row execute function marca_server_at()';
  end if;
end $$;

