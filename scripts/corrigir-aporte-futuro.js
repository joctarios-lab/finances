#!/usr/bin/env node
/* Conserta no banco o aporte lançado com data futura ANTES de o status existir:
   marca como 'A Pagar' e devolve o saldo que foi debitado indevidamente.

   Sem --gravar, só simula. */
'use strict';
const fs = require('fs');
const RAIZ = 'D:/Projetos/meus-projetos/financas';
const GRAVAR = process.argv.includes('--gravar');

function lerEnv() {
  const env = {};
  for (const l of fs.readFileSync(RAIZ + '/.env', 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  env.SUPABASE_URL = env.SUPABASE_URL.replace(/\/$/, '');
  return env;
}

(async () => {
  const env = lerEnv();
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }) });
  const tk = (await r.json()).access_token;
  const h = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' };
  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&deleted=eq.false`, { headers: h })).json();

  const hoje = new Date().toISOString().slice(0, 10);
  const entries = await get('goal_entries');
  const contas = await get('accounts');
  const txs = await get('transactions');
  const goals = await get('goals');

  // A coluna existe? (o SQL pode não ter sido rodado ainda)
  const teste = await fetch(`${env.SUPABASE_URL}/rest/v1/goal_entries?select=id,status&limit=1`, { headers: h });
  if (!teste.ok) {
    console.log('✕ A coluna `status` ainda não existe em goal_entries.');
    console.log('  Rode supabase/schema.sql primeiro — é idempotente.');
    return;
  }

  const futuros = entries.filter(e => String(e.date) > hoje && (e.status || 'Pago') === 'Pago');
  console.log(GRAVAR ? '=== GRAVANDO ===' : '=== SIMULAÇÃO (use --gravar) ===');
  if (!futuros.length) { console.log('\nNenhum aporte com data futura marcado como pago. Nada a fazer.'); return; }

  for (const e of futuros) {
    const g = goals.find(x => x.id === e.goal_id) || {};
    console.log(`\naporte ${e.date} — ${e.description} — R$ ${e.amount} (${g.name || '?'})`);
    console.log('   status: Pago -> A Pagar');
    const de = contas.find(c => c.id === e.from_account);
    const para = contas.find(c => c.id === e.to_account);
    if (de) console.log(`   devolver à conta "${de.name}": ${de.balance} -> ${Number(de.balance) + Number(e.amount)}`);
    if (para) console.log(`   retirar de "${para.name}": ${para.balance} -> ${Number(para.balance) - Number(e.amount)}`);
    const irma = txs.find(t => t.type === 'Transferência' && t.status === 'Pago'
      && String(t.date) === String(e.date) && Math.abs(Number(t.amount) - Number(e.amount)) < 0.005
      && t.account_id === e.from_account && t.to_account === e.to_account);
    if (irma) console.log(`   transferência no extrato "${irma.description}": Pago -> A Pagar`);

    if (!GRAVAR) continue;
    const patch = async (tab, id, body) => {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tab}?id=eq.${id}`, {
        method: 'PATCH', headers: h, body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }) });
      if (!res.ok) throw new Error(`${tab} ${id}: ${await res.text()}`);
    };
    await patch('goal_entries', e.id, { status: 'A Pagar' });
    if (de) await patch('accounts', de.id, { balance: Number(de.balance) + Number(e.amount) });
    if (para) await patch('accounts', para.id, { balance: Number(para.balance) - Number(e.amount) });
    if (irma) await patch('transactions', irma.id, { status: 'A Pagar' });
  }
  console.log(GRAVAR ? '\n✓ gravado' : '\nNada foi gravado.');
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
