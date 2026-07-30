-- ============================================================
--  EXPORTAR A BASE COMPLETA (para análise)
--  Rodar no Supabase → SQL Editor
-- ============================================================
--  Só LÊ. Devolve UMA linha com um JSON contendo tudo.
--  Copie o resultado e salve como base.json.
--
--  A RLS limita ao que é da sua família — não sai dado de mais
--  ninguém, e nada de login/senha entra aqui.
--
--  ANTES DE ENVIAR: a descrição dos lançamentos pode conter
--  nome de pessoa ou estabelecimento. Se preferir, use a
--  VERSÃO ANONIMIZADA no fim deste arquivo — ela troca as
--  descrições por um código e mantém tudo que importa para
--  achar erro de saldo, duplicata e transferência solta.
-- ============================================================


-- ------------------------------------------------------------
-- OPÇÃO A — export completo
-- ------------------------------------------------------------
select json_build_object(
  'exportado_em', now(),
  'accounts',       (select coalesce(json_agg(t), '[]'::json) from (select * from accounts        where deleted = false) t),
  'cards',          (select coalesce(json_agg(t), '[]'::json) from (select * from cards           where deleted = false) t),
  'categories',     (select coalesce(json_agg(t), '[]'::json) from (select * from categories      where deleted = false) t),
  'transactions',   (select coalesce(json_agg(t), '[]'::json) from (select * from transactions    where deleted = false) t),
  'goals',          (select coalesce(json_agg(t), '[]'::json) from (select * from goals           where deleted = false) t),
  'goal_entries',   (select coalesce(json_agg(t), '[]'::json) from (select * from goal_entries    where deleted = false) t),
  'invoice_status', (select coalesce(json_agg(t), '[]'::json) from (select * from invoice_status  where deleted = false) t),
  'budget_overrides', (select coalesce(json_agg(t), '[]'::json) from (select * from budget_overrides where deleted = false) t),
  'recurrences',    (select coalesce(json_agg(t), '[]'::json) from (select * from recurrences     where deleted = false) t),
  'family_settings',(select coalesce(json_agg(t), '[]'::json) from (select * from family_settings where deleted = false) t),
  -- Apagados entram à parte: às vezes o erro está justamente no que sumiu
  'apagados', json_build_object(
    'accounts',     (select count(*) from accounts     where deleted),
    'cards',        (select count(*) from cards        where deleted),
    'categories',   (select count(*) from categories   where deleted),
    'transactions', (select count(*) from transactions where deleted)
  )
) as base;


-- ------------------------------------------------------------
-- OPÇÃO B — export ANONIMIZADO (recomendado para enviar)
-- ------------------------------------------------------------
-- Troca descrição, nome de conta/cartão e membro por códigos.
-- Mantém valores, datas, tipos, contas e vínculos — que é o que
-- permite recalcular saldo, achar duplicata e transferência solta.
-- Os códigos são estáveis: "Mercado" vira sempre o mesmo D-xxxx,
-- então dá para ver que dois lançamentos são a mesma coisa.
-- ------------------------------------------------------------
select json_build_object(
  'exportado_em', now(),
  'anonimizado', true,
  'accounts', (select coalesce(json_agg(json_build_object(
      'id', a.id, 'nome', 'CONTA-' || left(md5(a.name), 4), 'type', a.type,
      'balance', a.balance, 'is_reserve', a.is_reserve, 'active', a.active)), '[]'::json)
    from accounts a where a.deleted = false),
  'cards', (select coalesce(json_agg(json_build_object(
      'id', c.id, 'nome', 'CARTAO-' || left(md5(c.name), 4),
      'limit_amount', c.limit_amount, 'closing_day', c.closing_day,
      'due_day', c.due_day, 'account_id', c.account_id, 'active', c.active)), '[]'::json)
    from cards c where c.deleted = false),
  -- Categorias vão com o nome real: são de fábrica e não dizem nada sobre você
  'categories', (select coalesce(json_agg(t), '[]'::json) from (select * from categories where deleted = false) t),
  'transactions', (select coalesce(json_agg(json_build_object(
      'id', t.id, 'desc_cod', 'D-' || left(md5(lower(t.description)), 5),
      'amount', t.amount, 'date', t.date, 'type', t.type, 'status', t.status,
      'method', t.method, 'scope', t.scope,
      'member_cod', case when coalesce(t.member,'') = '' then null else 'M-' || left(md5(t.member), 3) end,
      'category_id', t.category_id, 'account_id', t.account_id, 'card_id', t.card_id,
      'to_account', t.to_account, 'invoice_key', t.invoice_key,
      'group_id', t.group_id, 'installment', t.installment,
      'adjustment', t.adjustment, 'recurring', t.recurring,
      'tem_fitid', coalesce(t.fitid,'') <> '', 'fitid_cod', left(md5(coalesce(t.fitid,'')), 6),
      'tags', t.tags, 'updated_at', t.updated_at)), '[]'::json)
    from transactions t where t.deleted = false),
  'goals', (select coalesce(json_agg(json_build_object(
      'id', g.id, 'nome', 'META-' || left(md5(g.name), 4), 'target_amount', g.target_amount,
      'target_date', g.target_date, 'done', g.done, 'kind', g.kind)), '[]'::json)
    from goals g where g.deleted = false),
  'goal_entries', (select coalesce(json_agg(json_build_object(
      'id', e.id, 'goal_id', e.goal_id, 'amount', e.amount, 'date', e.date,
      'from_account', e.from_account, 'to_account', e.to_account)), '[]'::json)
    from goal_entries e where e.deleted = false),
  'invoice_status', (select coalesce(json_agg(t), '[]'::json) from (select * from invoice_status where deleted = false) t),
  'budget_overrides', (select coalesce(json_agg(t), '[]'::json) from (select * from budget_overrides where deleted = false) t),
  'recurrences',    (select coalesce(json_agg(t), '[]'::json) from (select * from recurrences    where deleted = false) t),
  'family_settings', (select coalesce(json_agg(json_build_object(
      'month_start_day', s.month_start_day, 'monthly_income', s.monthly_income,
      'qtd_membros', json_array_length(s.members))), '[]'::json)
    from family_settings s where s.deleted = false),
  'apagados', json_build_object(
    'accounts',     (select count(*) from accounts     where deleted),
    'cards',        (select count(*) from cards        where deleted),
    'categories',   (select count(*) from categories   where deleted),
    'transactions', (select count(*) from transactions where deleted)
  )
) as base_anonimizada;


-- ============================================================
--  Se o resultado for grande demais para copiar de uma vez,
--  exporte por tabela:
--
--    select coalesce(json_agg(t), '[]'::json)
--      from (select * from transactions where deleted = false) t;
--
--  Ou use o botão de download em CSV do próprio SQL Editor,
--  no canto do painel de resultados.
-- ============================================================
