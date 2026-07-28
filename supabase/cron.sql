-- Finanças da Família — agendamento das notificações push
-- Rodar no SQL Editor DEPOIS de publicar a Edge Function "notify".
-- Substitua <SEU-PROJECT-REF> e <SUA-ANON-KEY> pelos valores do seu projeto (Settings → API).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior, se existir (evita duplicar ao rodar de novo)
select cron.unschedule('financas-notify')
where exists (select 1 from cron.job where jobname = 'financas-notify');

-- Todo dia às 12:00 UTC (09:00 no horário de Brasília)
select cron.schedule(
  'financas-notify',
  '0 12 * * *',
  $$
  select net.http_post(
    url     := 'https://<SEU-PROJECT-REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer <SUA-ANON-KEY>'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir agendamentos ativos:
--   select jobid, jobname, schedule, active from cron.job;
-- Ver execuções recentes:
--   select * from cron.job_run_details order by start_time desc limit 10;
-- Disparar manualmente para testar (sem esperar o horário):
--   select net.http_post(url := 'https://<SEU-PROJECT-REF>.supabase.co/functions/v1/notify',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SUA-ANON-KEY>'));

-- Faxina do log de notificações (mantém 60 dias)
select cron.schedule(
  'financas-notify-limpeza',
  '30 3 * * 0',
  $$ delete from notification_log where sent_on < current_date - 60 $$
);
