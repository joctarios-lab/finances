-- Finanças Família — schema Supabase (rodar no SQL Editor do projeto)
-- Multi-família com RLS: cada registro pertence a uma família; membros autenticados leem/escrevem.

create extension if not exists "pgcrypto";

create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Minha Família',
  created_at timestamptz not null default now()
);

create table if not exists family_members (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create or replace function is_member(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;

-- Tabelas de dados: todas com o mesmo envelope de sync (id, family_id, updated_at, deleted)

create table if not exists accounts (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  type text not null default 'Conta Corrente',
  institution text default '',
  balance numeric not null default 0,
  active boolean not null default true,
  is_reserve boolean,                     -- conta que compõe a reserva de emergência
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table accounts add column if not exists is_reserve boolean;

create table if not exists cards (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  brand text default '',
  limit_amount numeric not null default 0,
  closing_day int not null default 25,
  due_day int not null default 5,
  account_id uuid,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists categories (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  icon text default '🏷️',
  scope text not null default 'Família',
  monthly_budget numeric not null default 0,
  kind text not null default 'Essencial',   -- 'Essencial' | 'Estilo' (regra 50/30/20)
  -- 'Despesa' | 'Receita': separa envelope de gasto de origem de entrada. Orçamento
  -- e regra 50/30/20 só valem para Despesa.
  type text not null default 'Despesa',
  -- Sem parent_id é envelope (o orçamento vive nele); com parent_id é subcategoria.
  -- set null em vez de cascade: o app apaga as filhas por conta própria (soft delete),
  -- e um delete físico do pai não deve levar histórico embora sem aviso.
  parent_id uuid references categories(id) on delete set null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table categories add column if not exists kind text not null default 'Essencial';
alter table categories add column if not exists parent_id uuid references categories(id) on delete set null;
alter table categories add column if not exists type text not null default 'Despesa';

create table if not exists transactions (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  description text not null,
  amount numeric not null,
  date date not null,
  scope text not null default 'Família',
  member text default '',
  method text not null default 'PIX',
  status text not null default 'Pago',
  recurring boolean not null default false,
  category_id uuid,
  account_id uuid,
  card_id uuid,
  to_account uuid,                        -- destino, quando é transferência entre contas
  invoice_key text default '',
  notes text default '',
  type text not null default 'Despesa',   -- 'Despesa' | 'Receita'
  fitid text default '',                  -- id do lançamento no extrato OFX (evita reimportar)
  group_id uuid,                          -- agrupa parcelas de uma mesma compra
  installment text default '',            -- ex: '3/12'
  adjustment boolean not null default false,  -- conciliação de saldo: fica fora das análises
  tags jsonb not null default '[]'::jsonb,    -- etiquetas livres, para filtrar por assunto
  -- Fatura que este lançamento PAGA (chave "<card_id>:YYYY-MM"). Diferente de
  -- invoice_key, que diz de qual fatura a compra FAZ PARTE. Confundir os dois
  -- somaria o pagamento dentro da própria fatura que ele quita.
  pays_invoice text default '',
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
-- Para bases que já existem antes desta coluna
alter table transactions add column if not exists pays_invoice text default '';
create index if not exists idx_tx_pays_invoice on transactions(pays_invoice);

/* PONTUAL: aconteceu, não se repete — a dentadura, a matrícula da escola, o
   empréstimo cedido a um parente.

   Terceiro estado ao lado de fixo (`recurring`) e variável, e os três se excluem.
   Existe porque os dois que havia não davam conta de um gasto único:

     variável  entra no ritmo e é extrapolado pelos dias que faltam — infla a
               projeção do mês inteiro por causa de uma compra que não volta;
     fixo      não é extrapolado, MAS `recurring` também replica o lançamento nos
               meses seguintes e alimenta o botão "Custos fixos". Medido: marcar
               uma dentadura de R$ 770 como fixa acrescentava R$ 770 às contas de
               setembro E de outubro, e derrubava o saldo previsto do mês que vem.

   Pontual fica fora dos dois: não entra no ritmo e não vira previsão de nada.

   O app FUNCIONA SEM esta coluna: o push detecta a ausência e reenvia sem ela,
   pelo mesmo caminho que o pull usa com `server_at`. Rodar isto só melhora — a
   classificação passa a acompanhar a família em vez de ficar num aparelho só. */
alter table transactions add column if not exists pontual boolean not null default false;

/* Recorrência: o CONTRATO de uma transação que se repete.

   Separada das transações de propósito. O modelo antigo copiava o último
   lançamento com recurring=true, casando por descrição — sem prazo, sem
   periodicidade e perdendo o dia do vencimento. "Aluguel até eu cancelar",
   "financiamento em 48x" e "assinatura" não cabiam ali.

   As transações são GERADAS a partir daqui, e carregam recurrence_id para o app
   saber o que já nasceu e não duplicar. */
create table if not exists recurrences (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  description text not null,
  -- Sem default, igual a transactions.amount: o app sempre informa o valor, e um
  -- default silencioso deixaria passar recorrência de R$ 0 sem ninguém notar
  amount numeric not null,
  valor_tipo text not null default 'fixo',   -- 'fixo' | 'media' (luz, água)
  type text not null default 'Despesa',      -- serve para receita também (salário)
  scope text not null default 'Família',
  member text default '',
  method text default 'Boleto',
  category_id uuid,
  account_id uuid,
  card_id uuid,                              -- recorrência no cartão cai na fatura
  tags jsonb not null default '[]'::jsonb,
  notes text default '',
  periodicidade text not null default 'mensal',  -- mensal | semanal | quinzenal | anual
  dia int not null default 1,                -- dia do mês (1-31) ou da semana (0-6)
  inicio date not null,
  fim_tipo text not null default 'sem_prazo',    -- sem_prazo | vezes | data
  fim_data date,
  fim_vezes int,
  geradas int not null default 0,            -- quantas já nasceram (para o fim por vezes)
  status text not null default 'ativa',      -- ativa | pausada | cancelada
  ultima_geracao date,                       -- até onde já foi gerado, evita duplicar
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table transactions add column if not exists recurrence_id uuid;
create index if not exists idx_tx_recurrence on transactions(recurrence_id);

/* A SEMANADA É UM CONTRATO como qualquer outro, e esta coluna é o que a liga à
   criança dona do cofrinho.

   Sem ela, o dinheiro que sai toda semana para as crianças não existiria no
   orçamento da família: o cofrinho registraria a entrada do lado dela e o lado
   de quem paga ficaria cego. Uma família com dois filhos a R$ 8 por semana tem
   quase R$ 70 por mês invisíveis — e é justamente o tipo de gasto pequeno e
   repetido que some da conta.

   Ligada por coluna, e não pelo nome do contrato: renomear "Semanada da Nina"
   não pode desfazer o vínculo. */
alter table recurrences add column if not exists kid_id uuid;
create index if not exists idx_rec_kid on recurrences(kid_id);

/* O LANÇAMENTO DA SEMANADA DIZ DE QUEM ELE É, e isso muda o que ele faz.

   Dar a semanada não é gastar: o dinheiro fica na conta da família e passa a ter
   outro dono. Debitar o saldo aqui faria a conta divergir do extrato do banco em
   R$ 8 por semana, acumulando — e o defeito só apareceria na conciliação, meses
   depois, sem ninguém ligar à causa.

   Com esta coluna o lançamento se identifica: continua na fila (o adulto precisa
   lembrar de entregar) e é NEUTRO no saldo. O que reduz o dinheiro livre da
   família é o acumulado no cofrinho, calculado dos lançamentos da criança.

   Quando a criança GASTA de verdade, o dinheiro sai da casa — e aí é uma despesa
   comum, lançada como qualquer outra. É esse par que fecha a conta. */
alter table transactions add column if not exists kid_id uuid;
create index if not exists idx_tx_kid on transactions(kid_id);

create table if not exists goals (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  icon text default '🎯',
  target_amount numeric not null default 0,
  target_date date,
  done boolean not null default false,
  kind text default 'Objetivo',   -- 'Reserva' identifica a reserva de emergência
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table goals add column if not exists kind text default 'Objetivo';

create table if not exists goal_entries (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  goal_id uuid not null,
  description text default 'Aporte',
  amount numeric not null,
  date date not null,
  from_account uuid,          -- conta de onde o dinheiro saiu (permite reverter)
  to_account uuid,            -- conta onde o dinheiro ficou guardado
  -- 'Pago' | 'A Pagar', a mesma linguagem das transações. Aporte agendado é
  -- PLANO: não mexe em saldo nem conta como guardado até acontecer. Sem isto,
  -- programar um aporte para o dia 3 debitava a conta hoje e a reserva subia por
  -- dinheiro que ainda não saiu.
  -- Default 'Pago' porque todo registro anterior a esta coluna já aconteceu.
  status text not null default 'Pago',
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table goal_entries add column if not exists from_account uuid;
alter table goal_entries add column if not exists to_account uuid;
alter table goal_entries add column if not exists status text not null default 'Pago';

create table if not exists invoice_status (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  invoice_key text not null,           -- "<card_id>:YYYY-MM"
  paid boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- Orçamento ajustado para UM ciclo.
--
-- `categories.monthly_budget` é o orçamento PADRÃO, atemporal. Ele responde
-- "quanto costumamos gastar aqui por mês", e continua sendo a base. Esta tabela
-- responde outra pergunta: "e neste mês específico?" — a conta do carro que só
-- chega em janeiro, o mês da matrícula da escola, o mês em que se tira de um
-- envelope para reforçar outro.
--
-- A chave do período é `period_start`, o PRIMEIRO DIA DO CICLO — não um rótulo
-- "AAAA-MM". O dia de virada do mês é configurável (`family_settings.
-- month_start_day`), então um rótulo de mês-calendário divergiria do período que
-- o app usa em todo o resto, e o ajuste cairia no mês errado para quem fecha o
-- ciclo no dia 25.
create table if not exists budget_overrides (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  -- Sem NOT NULL de propósito: `category_id` é nulável em transactions (lançamento
  -- sem categoria é legítimo), e o mapa de tipos do sync é por NOME de coluna, um
  -- só para o banco inteiro. Divergir aqui faria o higienizador tratar a coluna de
  -- um jeito numa tabela e de outro na vizinha. Quem garante o preenchimento é o
  -- app — `ajustarOrcamento` é o único caminho de escrita —, e a unicidade fica no
  -- índice abaixo.
  category_id uuid,
  period_start date not null,          -- primeiro dia do ciclo (não "AAAA-MM": o ciclo é configurável)
  -- Sem default, como em transactions.amount: o app sempre informa o valor, e um
  -- default silencioso deixaria passar um ajuste de R$ 0 sem ninguém notar.
  amount numeric not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
-- Um ajuste por categoria por ciclo. Sem isto, dois aparelhos criando o ajuste do
-- mesmo mês gerariam duas linhas e a leitura teria de escolher uma — silenciosamente.
create unique index if not exists idx_bov_unico
  on budget_overrides(family_id, category_id, period_start);

create table if not exists family_settings (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  members jsonb not null default '["Família"]',
  month_start_day int not null default 1,
  monthly_income numeric not null default 0,   -- renda líquida familiar (projeções, 50/30/20)
  family_name text default '',                 -- nome escolhido por quem usa
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table family_settings add column if not exists monthly_income numeric not null default 0;
alter table family_settings add column if not exists family_name text default '';

alter table transactions add column if not exists type text not null default 'Despesa';
alter table transactions add column if not exists fitid text default '';
alter table transactions add column if not exists group_id uuid;
alter table transactions add column if not exists installment text default '';
alter table transactions add column if not exists adjustment boolean not null default false;
alter table transactions add column if not exists to_account uuid;
alter table transactions add column if not exists tags jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- CARIMBO DO SERVIDOR (server_at) — o marcador confiável para sincronizar
--
-- `updated_at` é gravado por QUEM CRIA o registro, com o relógio do aparelho.
-- Isso o torna inútil como marcador de sincronização: um aparelho que ficou
-- offline envia, ao voltar, registros com timestamp de horas atrás, e qualquer
-- outro aparelho que já sincronizou nesse intervalo pede `> lastSync` e nunca
-- mais os busca. Aconteceu: um lançamento existia no servidor e não na tela.
--
-- `server_at` é escrito SEMPRE pelo banco, no instante da escrita. O cliente não
-- tem como influenciá-lo — o trigger sobrescreve o que vier. Assim o pull passa
-- a perguntar "o que chegou aqui depois de X?", que é a pergunta certa, em vez
-- de "o que foi editado depois de X?", que depende de nove relógios diferentes.
--
-- `updated_at` continua existindo e continua sendo do cliente: ele resolve
-- CONFLITO (quem editou por último vence), que é outro problema. Os dois campos
-- respondem perguntas diferentes e por isso convivem.
--
-- clock_timestamp(), não now(): now() devolve o início da TRANSAÇÃO, então duas
-- gravações concorrentes podem receber o mesmo instante e sair na ordem errada.
-- clock_timestamp() é o relógio real no momento da linha.
-- ---------------------------------------------------------------------------

create or replace function marca_server_at()
returns trigger language plpgsql as $$
begin
  -- Sobrescreve sempre, inclusive no update: o cliente pode mandar qualquer
  -- coisa nesta coluna e ela é ignorada. É isso que torna o campo confiável.
  new.server_at := clock_timestamp();
  return new;
end $$;

/* O CARIMBO É APLICADO NO FIM DO ARQUIVO, não aqui.

   Ele estava neste ponto, com a lista de tabelas escrita à mão, e o cofrinho
   entrou depois — as quatro tabelas dele nasceram SEM carimbo, sem índice e sem
   trigger, porque são criadas mais abaixo e este bloco não podia alcançá-las.
   O sintoma seria o pior tipo: sincronização funcionando, e um registro perdido
   de vez em quando.

   Agora o bloco vive depois da última tabela e descobre a lista sozinha, olhando
   quem tem `family_id`. Tabela nova entra no carimbo por existir, e não por
   alguém lembrar de escrever o nome numa lista. Ver o fim deste arquivo. */

-- Conferência do carimbo:
--   select tablename, indexname from pg_indexes
--    where schemaname='public' and indexname like '%_family_server_idx' order by tablename;
--   select event_object_table, trigger_name from information_schema.triggers
--    where trigger_name = 'trg_server_at' order by event_object_table;

-- Inscrições de push (um registro por navegador/aparelho)
create table if not exists push_subscriptions (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Trava diária: impede repetir o mesmo aviso no mesmo dia
create table if not exists notification_log (
  id bigserial primary key,
  family_id uuid not null references families(id) on delete cascade,
  key text not null,
  sent_on date not null default current_date,
  unique (family_id, key, sent_on)
);

create index if not exists idx_tx_family_date on transactions(family_id, date);
create index if not exists idx_tx_family_upd on transactions(family_id, updated_at);
create index if not exists idx_tx_fitid on transactions(family_id, fitid);
create index if not exists idx_cat_parent on categories(family_id, parent_id);
create index if not exists idx_push_family on push_subscriptions(family_id);

-- RLS
alter table families enable row level security;
alter table family_members enable row level security;
alter table accounts enable row level security;
alter table cards enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;
alter table goals enable row level security;
alter table goal_entries enable row level security;
alter table invoice_status enable row level security;
alter table recurrences enable row level security;
alter table family_settings enable row level security;
alter table budget_overrides enable row level security;
alter table push_subscriptions enable row level security;
alter table notification_log enable row level security;   -- sem policies: só a Edge Function (service_role) acessa

drop policy if exists push_rw on push_subscriptions;
create policy push_rw on push_subscriptions for all to authenticated
  using (is_member(family_id)) with check (is_member(family_id) and user_id = auth.uid());

drop policy if exists fam_insert on families;
create policy fam_insert on families for insert to authenticated with check (true);
drop policy if exists fam_select on families;
create policy fam_select on families for select to authenticated using (is_member(id));

-- Entrar na família: quem tem o código (uuid) pode se juntar; o uuid é o convite secreto.
drop policy if exists fm_insert on family_members;
create policy fm_insert on family_members for insert to authenticated with check (user_id = auth.uid());
drop policy if exists fm_select on family_members;
create policy fm_select on family_members for select to authenticated using (user_id = auth.uid() or is_member(family_id));

do $$
declare t text;
begin
  foreach t in array array['accounts','cards','categories','transactions','goals','goal_entries','invoice_status','recurrences','family_settings','budget_overrides']
  loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated using (is_member(family_id)) with check (is_member(family_id))',
      t, t);
  end loop;
end $$;

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

-- A LISTA DE VONTADES. Não é meta: é o que a criança quer HOJE, anotado para ser
-- reavaliado depois de algumas noites. Separada de kid_goals de propósito — a meta
-- tem valor, prazo e barra de progresso; a vontade tem só um nome e uma data, e
-- misturar as duas transformaria toda vontade passageira num compromisso.
create table if not exists kid_wishes (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  kid_id uuid not null,
  name text not null,
  icon text default '⭐',
  -- Quando ela anotou. A pergunta "ainda quer?" nasce desta data, e sem ela a lista
  -- vira só uma lista de compras.
  criada_em date,
  -- Como ela respondeu quando o app perguntou: null = ainda não perguntou,
  -- 'quero' = confirmou, 'passou' = mudou de ideia. O que ela responde é a lição.
  resposta text,
  respondida_em date,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists idx_kid_entries_kid on kid_entries(family_id, kid_id, date);
create index if not exists idx_kid_goals_kid on kid_goals(family_id, kid_id);
create index if not exists idx_kid_tasks_kid on kid_tasks(family_id, kid_id);
create index if not exists idx_kid_wishes_kid on kid_wishes(family_id, kid_id);

alter table kids enable row level security;
alter table kid_goals enable row level security;
alter table kid_tasks enable row level security;
alter table kid_entries enable row level security;
alter table kid_wishes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['kids','kid_goals','kid_tasks','kid_entries','kid_wishes']
  loop
    execute format('drop policy if exists %I_rw on %I', t, t);
    execute format(
      'create policy %I_rw on %I for all to authenticated using (is_member(family_id)) with check (is_member(family_id))',
      t, t);
  end loop;
end $$;

-- Criar família em uma única operação.
-- Sem isto, o app inseriria a família e só depois viraria membro dela — e a política
-- de leitura (is_member) impediria de receber o id de volta, travando o primeiro uso.
-- Como é security definer, roda com permissão elevada e mantém os dois passos atômicos.
create or replace function create_family(fam_name text default 'Minha Família')
returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then
    raise exception 'É preciso estar autenticado para criar uma família';
  end if;
  insert into families (name) values (coalesce(nullif(trim(fam_name), ''), 'Minha Família'))
    returning id into fid;
  insert into family_members (family_id, user_id) values (fid, auth.uid());
  return fid;
end $$;

revoke all on function create_family(text) from public;
grant execute on function create_family(text) to authenticated;

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
-- Conferência: rode isto depois e verifique se aparecem 19 tabelas, todas com
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
