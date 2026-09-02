#!/usr/bin/env node
/* Apaga os lançamentos "Saldo inicial" que a v169 criou antes de ser revertida.

   Eles são artefato de um modelo que não existe mais: naquela versão o saldo era
   a soma do extrato e a abertura ancorava a conta. No modelo atual o saldo é o
   número guardado, e essas linhas só poluem o extrato e distorcem o saldo
   histórico — que é calculado desfazendo os movimentos a partir de hoje.

   Apaga como o app apaga (deleted = true, carimbo novo), nunca removendo a
   linha: uma remoção de verdade voltaria no próximo sync, empurrada pelo
   aparelho que ainda tem o registro.

   NÃO toca em accounts.balance: o saldo guardado é a autoridade no modelo atual
   e essas linhas nunca mexeram nele.

   Uso: node scripts/limpar-aberturas.js [--aplicar] */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const APLICAR = process.argv.includes('--aplicar');

const env = {};
for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const brl = v => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }),
  });
  if (!r.ok) { console.error('\n✕ Login recusado.\n'); process.exit(1); }
  const { access_token } = await r.json();
  const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}`, { headers: cab })).json();

  const contas = await get('accounts?select=id,name');
  const nome = id => (contas.find(c => c.id === id) || {}).name || '—';
  const alvos = (await get('transactions?select=*&limit=5000'))
    .filter(t => !t.deleted && (t.method === 'Saldo inicial' || /^saldo inicial$/i.test(String(t.description || ''))));

  console.log(`\n=== LANÇAMENTOS "SALDO INICIAL" VIVOS: ${alvos.length} ===\n`);
  for (const t of alvos) {
    console.log(`  ${t.date}  ${String(t.type).padEnd(8)} ${brl(t.amount).padStart(14)}  ${nome(t.account_id)}`);
  }
  if (!alvos.length) { console.log('  Nada a fazer.\n'); return; }

  if (!APLICAR) { console.log('\n  Simulação. Repita com --aplicar para apagar.\n'); return; }

  const agora = new Date().toISOString();
  for (const t of alvos) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${t.id}`, {
      method: 'PATCH', headers: cab,
      body: JSON.stringify({ deleted: true, updated_at: agora }),
    });
    if (!res.ok) { console.error('  ✕ falhou em', t.id, res.status); process.exit(1); }
    console.log(`  ✓ apagado  ${t.date}  ${brl(t.amount)}  ${nome(t.account_id)}`);
  }
  console.log('\n  Pronto.\n');
})();
