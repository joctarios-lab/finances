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
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table goal_entries add column if not exists from_account uuid;
alter table goal_entries add column if not exists to_account uuid;

create table if not exists invoice_status (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  invoice_key text not null,           -- "<card_id>:YYYY-MM"
  paid boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

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
alter table family_settings enable row level security;
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
  foreach t in array array['accounts','cards','categories','transactions','goals','goal_entries','invoice_status','family_settings']
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
-- Conferência: rode isto depois e verifique se aparecem 12 tabelas, todas com
-- RLS ligado, e a função create_family.
--
--   select tablename, rowsecurity as rls
--     from pg_tables where schemaname = 'public' order by tablename;
--
--   select routine_name from information_schema.routines
--    where routine_schema = 'public' and routine_name in ('is_member','create_family');
-- ---------------------------------------------------------------------------
