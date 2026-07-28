/* Finanças da Família — Edge Function de notificações push
   Roda no servidor (Supabase), varre as famílias e envia avisos mesmo com o app fechado.
   Agendada por pg_cron (ver supabase/cron.sql).

   Variáveis de ambiente necessárias (supabase secrets set ...):
     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex: mailto:voce@email.com)
   SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já são injetadas pela plataforma. */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

type Card = { id: string; name: string; closing_day: number; due_day: number; limit_amount: number };
type Tx = { amount: number; card_id: string | null; invoice_key: string | null; category_id: string | null; date: string; type?: string; deleted?: boolean };
type Alert = { key: string; title: string; body: string };

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:financas@exemplo.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const daysBetween = (a: Date, b: Date) =>
  Math.ceil((a.getTime() - b.getTime()) / 86_400_000);

/** Datas de fechamento/vencimento a partir da chave "<card_id>:YYYY-MM" (espelha a regra do app). */
function invoiceDates(card: Card, key: string) {
  const [, ym] = key.split(':');
  const [y, m] = ym.split('-').map(Number);
  const closing = new Date(Date.UTC(y, m - 1, card.closing_day, 12));
  const dueMonth = card.due_day <= card.closing_day ? m : m - 1;
  const due = new Date(Date.UTC(y, dueMonth, card.due_day, 12));
  return { closing, due };
}

function alertsFor(
  cards: Card[],
  txs: Tx[],
  paidKeys: Set<string>,
  categories: { id: string; name: string; icon: string; monthly_budget: number }[],
  monthStartDay: number,
): Alert[] {
  const out: Alert[] = [];
  const today = new Date();

  // --- Faturas: fechando, vencendo, vencida, limite alto ---
  for (const card of cards) {
    const totals = new Map<string, number>();
    for (const t of txs) {
      if (t.card_id !== card.id || !t.invoice_key) continue;
      const sign = t.type === 'Receita' ? -1 : 1;   // estorno reduz a fatura
      totals.set(t.invoice_key, (totals.get(t.invoice_key) ?? 0) + sign * Number(t.amount || 0));
    }
    for (const [key, total] of totals) {
      if (total <= 0) continue;
      const { closing, due } = invoiceDates(card, key);
      const paid = paidKeys.has(key);
      const dDue = daysBetween(due, today);
      const dClose = daysBetween(closing, today);

      if (!paid && dDue < 0 && dDue >= -10) {
        out.push({ key: `venc-${key}`, title: '🔴 Fatura vencida', body: `${card.name}: ${brl(total)} venceu há ${-dDue} dia(s).` });
      } else if (!paid && dDue >= 0 && dDue <= 3) {
        out.push({ key: `venc-${key}`, title: '💳 Fatura vencendo', body: `${card.name}: ${brl(total)} vence em ${dDue} dia(s).` });
      }
      if (!paid && dClose >= 0 && dClose <= 2) {
        out.push({ key: `fech-${key}`, title: '📅 Fatura fechando', body: `${card.name} fecha em ${dClose} dia(s) — confira os lançamentos.` });
      }
      if (!paid && card.limit_amount > 0 && total / card.limit_amount >= 0.8 && dClose >= 0) {
        out.push({ key: `lim-${key}`, title: '⚠️ Limite do cartão', body: `${card.name} em ${Math.round(total / card.limit_amount * 100)}% do limite.` });
      }
    }
  }

  // --- Orçamentos do período corrente ---
  const startDay = Math.min(Math.max(monthStartDay || 1, 1), 28);
  const ref = new Date();
  let y = ref.getFullYear(), m = ref.getMonth();
  if (ref.getDate() < startDay) m -= 1;
  const start = new Date(Date.UTC(y, m, startDay, 0));
  const end = new Date(Date.UTC(y, m + 1, startDay, 0));
  const label = `${start.getUTCFullYear()}-${start.getUTCMonth() + 1}`;

  const spent = new Map<string, number>();
  for (const t of txs) {
    if (t.type === 'Receita' || !t.category_id) continue;
    const d = new Date(t.date + 'T12:00:00Z');
    if (d < start || d >= end) continue;
    spent.set(t.category_id, (spent.get(t.category_id) ?? 0) + Number(t.amount || 0));
  }
  for (const c of categories) {
    if (!c.monthly_budget) continue;
    const used = spent.get(c.id) ?? 0;
    const pct = Math.round(used / c.monthly_budget * 100);
    if (pct >= 100) {
      out.push({ key: `orc-${c.id}-${label}`, title: '⚠️ Orçamento estourado', body: `${c.icon} ${c.name} chegou a ${pct}% do limite do mês.` });
    }
  }
  return out;
}

Deno.serve(async () => {
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, family_id, endpoint, p256dh, auth');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const byFamily = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    if (!byFamily.has(s.family_id)) byFamily.set(s.family_id, []);
    byFamily.get(s.family_id)!.push(s);
  }

  let sent = 0, removed = 0;

  for (const [familyId, familySubs] of byFamily) {
    const [cards, txs, invStatus, cats, settings] = await Promise.all([
      db.from('cards').select('id,name,closing_day,due_day,limit_amount').eq('family_id', familyId).eq('deleted', false).eq('active', true),
      db.from('transactions').select('amount,card_id,invoice_key,category_id,date,type').eq('family_id', familyId).eq('deleted', false),
      db.from('invoice_status').select('invoice_key,paid').eq('family_id', familyId).eq('deleted', false),
      db.from('categories').select('id,name,icon,monthly_budget').eq('family_id', familyId).eq('deleted', false),
      db.from('family_settings').select('month_start_day').eq('family_id', familyId).eq('deleted', false).limit(1),
    ]);

    const paidKeys = new Set((invStatus.data ?? []).filter(i => i.paid).map(i => i.invoice_key));
    const alerts = alertsFor(
      (cards.data ?? []) as Card[],
      (txs.data ?? []) as Tx[],
      paidKeys,
      (cats.data ?? []) as never,
      settings.data?.[0]?.month_start_day ?? 1,
    );

    for (const alert of alerts) {
      // Trava diária: só envia se conseguir registrar o log de hoje (unique family+key+dia)
      const { error: logErr } = await db.from('notification_log').insert({ family_id: familyId, key: alert.key });
      if (logErr) continue;   // já enviado hoje

      const payload = JSON.stringify({ title: alert.title, body: alert.body, tag: alert.key, url: './' });
      for (const s of familySubs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {   // inscrição morta: limpa
            await db.from('push_subscriptions').delete().eq('id', s.id);
            removed++;
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, families: byFamily.size, sent, removed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
