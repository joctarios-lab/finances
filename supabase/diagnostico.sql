-- ============================================================
--  DIAGNÓSTICO — o que costuma estar errado numa conta
--  Rodar no Supabase → SQL Editor, uma consulta por vez.
-- ============================================================
--  Só LÊ. Não altera nada.
--
--  A RLS já limita tudo à sua família, então não é preciso
--  informar family_id em lugar nenhum.
--
--  Rode primeiro o CHECK 1: ele resume tudo numa tabela só e
--  costuma bastar para achar o problema. Os demais detalham.
-- ============================================================


-- ------------------------------------------------------------
-- CHECK 1 — RESUMO: quantos problemas de cada tipo existem
-- ------------------------------------------------------------
with
tx as (select * from transactions where deleted = false),
acc as (select * from accounts where deleted = false)
select 'saldo da conta não bate com os lançamentos' as problema,
       count(*) as ocorrencias
  from acc a
 where abs(
   a.balance - (
     coalesce((select sum(case when t.type = 'Receita' then t.amount else -t.amount end)
                 from tx t where t.account_id = a.id and t.type <> 'Transferência' and t.status = 'Pago'), 0)
   + coalesce((select sum(-t.amount) from tx t where t.account_id = a.id and t.type = 'Transferência' and t.status = 'Pago'), 0)
   + coalesce((select sum(t.amount)  from tx t where t.to_account = a.id and t.type = 'Transferência' and t.status = 'Pago'), 0)
   )
 ) > 0.01

union all
select 'descrição quebrada pelo bug das parcelas', count(*)
  from tx where description like '%object HTML%'

union all
select 'lançamento apontando para conta que não existe', count(*)
  from tx t
 where t.account_id is not null
   and not exists (select 1 from acc a where a.id = t.account_id)

union all
select 'transferência com destino inexistente', count(*)
  from tx t
 where t.type = 'Transferência' and t.to_account is not null
   and not exists (select 1 from acc a where a.id = t.to_account)

union all
select 'transferência sem uma das pontas', count(*)
  from tx t
 where t.type = 'Transferência' and (t.account_id is null or t.to_account is null)

union all
select 'transferência de uma conta para ela mesma', count(*)
  from tx t
 where t.type = 'Transferência' and t.account_id = t.to_account

union all
-- Importar os dois extratos ANTES da versão 37 duplicava a transferência:
-- ela virava um lançamento normal do outro lado
select 'possível transferência contada duas vezes', count(*)
  from tx t
 where t.type <> 'Transferência'
   and exists (
     select 1 from tx r
      where r.type = 'Transferência'
        and abs(r.amount - t.amount) < 0.01
        and abs(r.date - t.date) <= 3
        and (r.to_account = t.account_id or r.account_id = t.account_id)
   )

union all
select 'mesmo FITID em mais de um lançamento', count(*)
  from (select fitid from tx where coalesce(fitid, '') <> ''
         group by fitid having count(*) > 1) d

union all
select 'mesma descrição, valor e dia (possível duplicata)', count(*)
  from (select description, amount, date from tx
         where type <> 'Transferência'
         group by description, amount, date having count(*) > 1) d

union all
select 'compra parcelada com número de parcelas errado', count(*)
  from (select group_id, count(*) as n,
               max(split_part(installment, '/', 2)::int) as esperado
          from tx where coalesce(group_id::text, '') <> '' and installment like '%/%'
         group by group_id) g
 where g.n <> g.esperado

union all
select 'categoria de entrada usada em despesa (ou o contrário)', count(*)
  from tx t join categories c on c.id = t.category_id
 where c.deleted = false
   and ((t.type = 'Despesa'  and coalesce(c.type, 'Despesa') = 'Receita')
     or (t.type = 'Receita'  and coalesce(c.type, 'Despesa') = 'Despesa'))

union all
select 'subcategoria apontando para pai inexistente', count(*)
  from categories c
 where c.deleted = false and c.parent_id is not null
   and not exists (select 1 from categories p where p.id = c.parent_id and p.deleted = false)

union all
select 'valor negativo ou zero', count(*)
  from tx where amount <= 0

order by ocorrencias desc, problema;


-- ------------------------------------------------------------
-- CHECK 2 — SALDO POR CONTA: o que o app mostra x o que os
-- lançamentos explicam. A coluna "diferenca" é o que procurar.
-- ------------------------------------------------------------
with
tx as (select * from transactions where deleted = false and status = 'Pago'),
acc as (select * from accounts where deleted = false)
select a.name as conta,
       a.balance as saldo_no_app,
       coalesce((select sum(case when t.type = 'Receita' then t.amount else -t.amount end)
                   from tx t where t.account_id = a.id and t.type <> 'Transferência'), 0) as por_lancamentos,
       coalesce((select sum(-t.amount) from tx t where t.account_id = a.id and t.type = 'Transferência'), 0) as transf_saida,
       coalesce((select sum(t.amount)  from tx t where t.to_account = a.id and t.type = 'Transferência'), 0) as transf_entrada,
       a.balance - (
         coalesce((select sum(case when t.type = 'Receita' then t.amount else -t.amount end)
                     from tx t where t.account_id = a.id and t.type <> 'Transferência'), 0)
       + coalesce((select sum(-t.amount) from tx t where t.account_id = a.id and t.type = 'Transferência'), 0)
       + coalesce((select sum(t.amount)  from tx t where t.to_account = a.id and t.type = 'Transferência'), 0)
       ) as diferenca
  from acc a
 order by abs(
   a.balance - (
     coalesce((select sum(case when t.type = 'Receita' then t.amount else -t.amount end)
                 from tx t where t.account_id = a.id and t.type <> 'Transferência'), 0)
   + coalesce((select sum(-t.amount) from tx t where t.account_id = a.id and t.type = 'Transferência'), 0)
   + coalesce((select sum(t.amount)  from tx t where t.to_account = a.id and t.type = 'Transferência'), 0)
   )
 ) desc;

-- A diferença costuma ser o SALDO INICIAL da conta (o dinheiro que já
-- estava lá antes do primeiro lançamento). Nesse caso não é erro — é
-- esperado, e igual em todos os meses. Vira problema quando muda sem
-- explicação, ou quando bate exatamente com o valor de um lançamento.


-- ------------------------------------------------------------
-- CHECK 3 — Transferências possivelmente contadas duas vezes
-- (importar os dois extratos antes da versão 37 causava isto)
-- ------------------------------------------------------------
with tx as (select * from transactions where deleted = false)
select t.date, t.description as lancamento_suspeito, t.amount,
       t.type as tipo_dele,
       r.description as transferencia_equivalente, r.date as data_da_transferencia
  from tx t
  join tx r
    on r.type = 'Transferência'
   and t.type <> 'Transferência'
   and abs(r.amount - t.amount) < 0.01
   and abs(r.date - t.date) <= 3
   and (r.to_account = t.account_id or r.account_id = t.account_id)
 order by t.date desc;

-- Se aparecerem linhas aqui: o valor entrou (ou saiu) DUAS vezes — uma
-- pela transferência, outra por este lançamento. Apague o lançamento
-- solto pelo app; a transferência já move as duas contas sozinha.


-- ------------------------------------------------------------
-- CHECK 4 — Descrições quebradas pelo bug das parcelas
-- (corrigido na versão 34, mas o que foi gravado antes fica)
-- ------------------------------------------------------------
select id, date, amount, installment, description
  from transactions
 where deleted = false and description like '%object HTML%'
 order by date;

-- Para corrigir de uma vez, trocando pelo nome que você quiser:
-- update transactions
--    set description = 'Nome correto (' || installment || ')',
--        updated_at = now()
--  where description like '%object HTML%';


-- ------------------------------------------------------------
-- CHECK 5 — Duplicatas prováveis (mesma descrição, valor e dia)
-- ------------------------------------------------------------
with tx as (select * from transactions where deleted = false)
select description, amount, date, count(*) as vezes,
       string_agg(coalesce(nullif(fitid, ''), 'sem fitid'), ' | ') as origens
  from tx
 where type <> 'Transferência'
 group by description, amount, date
having count(*) > 1
 order by date desc;

-- Parcelas do mesmo dia e recorrentes legítimos também caem aqui —
-- confira a coluna "origens" antes de apagar qualquer coisa.


-- ------------------------------------------------------------
-- CHECK 6 — Panorama: volume por mês, para achar buraco ou excesso
-- ------------------------------------------------------------
select to_char(date, 'YYYY-MM') as mes,
       count(*) filter (where type = 'Despesa') as despesas,
       count(*) filter (where type = 'Receita') as receitas,
       count(*) filter (where type = 'Transferência') as transferencias,
       count(*) filter (where adjustment) as conciliacoes,
       round(sum(amount) filter (where type = 'Despesa'), 2) as total_gasto,
       round(sum(amount) filter (where type = 'Receita'), 2) as total_entrou
  from transactions
 where deleted = false
 group by 1 order by 1 desc;
