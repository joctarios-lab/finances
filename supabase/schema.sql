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
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

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
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table categories add column if not exists kind text not null default 'Essencial';

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
  invoice_key text default '',
  notes text default '',
  type text not null default 'Despesa',   -- 'Despesa' | 'Receita'
  fitid text default '',                  -- id do lançamento no extrato OFX (evita reimportar)
  group_id uuid,                          -- agrupa parcelas de uma mesma compra
  installment text default '',            -- ex: '3/12'
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists goals (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  icon text default '🎯',
  target_amount numeric not null default 0,
  target_date date,
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists goal_entries (
  id uuid primary key,
  family_id uuid not null references families(id) on delete cascade,
  goal_id uuid not null,
  description text default 'Aporte',
  amount numeric not null,
  date date not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

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
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
alter table family_settings add column if not exists monthly_income numeric not null default 0;

alter table transactions add column if not exists type text not null default 'Despesa';
alter table transactions add column if not exists fitid text default '';
alter table transactions add column if not exists group_id uuid;
alter table transactions add column if not exists installment text default '';

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
