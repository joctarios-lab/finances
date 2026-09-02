#!/usr/bin/env node
/* Desfaz um aporte e a transferência gêmea dele, para você refazer no app.

   APAGA COMO O APP APAGA: marcando `deleted = true` com carimbo novo, nunca
   removendo a linha. Uma remoção de verdade sumiria daqui e voltaria no próximo
   sync, empurrada pelo aparelho que ainda tem o registro.

   E ACERTA O SALDO PARA O ESTADO DE ANTES DO MOVIMENTO. É o passo que quase
   todo mundo esquece: o saldo é um número guardado, então apagar a linha não
   devolve o dinheiro sozinho. Como você vai REFAZER o aporte no app — e refazer
   aplica o efeito de novo —, o saldo precisa ficar como estava ANTES, senão o
   movimento é contado duas vezes outra vez.

     saldo a gravar = saldo REAL do banco − efeito do movimento removido

   Uso:
     node scripts/desfazer-aporte.js --de 2026-09-01 --ate 2026-09-02
     node scripts/desfazer-aporte.js --de 2026-09-01 --ate 2026-09-02 \
          --real "Nubank PJ=14289,37" --real "C6 Invest=10122,78"
     ... repita com --aplicar para gravar.

   ANTES DE APLICAR: feche o app em TODOS os aparelhos e espere a sincronização
   terminar. A regra de conflito é "o mais recente vence" — um aparelho com
   alteração pendente sobrescreve o que este script gravar.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

const APLICAR = process.argv.includes('--aplicar');
const arg = n => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : null; };
const DE = arg('de'), ATE = arg('ate');
const REAIS = {};
process.argv.forEach((a, i) => {
  if (a !== '--real') return;
  const [nome, valor] = String(process.argv[i + 1] || '').split('=');
  if (nome && valor) REAIS[nome.trim().toLowerCase()] = Number(String(valor).replace(/\./g, '').replace(',', '.'));
});

if (!DE || !ATE) { console.error('\n✕ Informe --de AAAA-MM-DD --ate AAAA-MM-DD\n'); process.exit(1); }

const env = {};
for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const brl = v => (v < 0 ? '-' : '') + 'R$ ' + Math.abs(Number(v) || 0)
  .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }),
  });
  if (!r.ok) { console.error('\n✕ Login recusado.\n'); process.exit(1); }
  const { access_token } = await r.json();
  const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}`, { headers: cab })).json();

  const contas = await get('accounts?select=*');
  const nome = id => (contas.find(c => c.id === id) || {}).name || '(sem conta)';
  const txs = (await get('transactions?select=*&limit=5000')).filter(t => !t.deleted);
  const aps = (await get('goal_entries?select=*')).filter(e => !e.deleted);

  const naJanela = d => String(d) >= DE && String(d) <= ATE;
  const alvoAportes = aps.filter(e => naJanela(e.date) && (e.from_account || e.to_account));
  if (!alvoAportes.length) { console.log('\n  Nenhum aporte com movimentação nesse período.\n'); return; }

  /* A GÊMEA. Aportes novos guardam o vínculo; os antigos não, e aí a busca é por
     valor e contas, com janela de 3 dias — e só vale se houver UMA candidata.
     Casar errado apagaria uma transferência que não é esta. */
  const dia = 864e5;
  const quando = d => new Date(String(d) + 'T12:00:00').getTime();
  const gemeaDe = e => {
    const porVinculo = txs.find(t => t.goal_entry_id === e.id);
    if (porVinculo) return { t: porVinculo, como: 'vínculo' };
    const cands = txs.filter(t => t.type === 'Transferência'
      && t.account_id === e.from_account && t.to_account === e.to_account
      && Math.abs(Number(t.amount) - Math.abs(Number(e.amount))) < 0.005
      && Math.abs(quando(t.date) - quando(e.date)) <= 3 * dia);
    return cands.length === 1 ? { t: cands[0], como: 'valor+contas, ±3 dias' } : null;
  };

  console.log(`\n=== O QUE SERÁ APAGADO (${DE} a ${ATE}) ===\n`);
  const paraApagar = { goal_entries: [], transactions: [] };
  const efeito = {};   // conta -> quanto o movimento removido tinha mexido
  for (const e of alvoAportes) {
    console.log(`  APORTE   ${e.date}  ${brl(e.amount)}  ${e.status}  ${nome(e.from_account)} → ${nome(e.to_account)}  "${e.description}"`);
    paraApagar.goal_entries.push(e);
    const g = gemeaDe(e);
    if (!g) { console.log('           ⚠ sem gêmea identificável — só o aporte sai\n'); continue; }
    console.log(`  gêmea    ${g.t.date}  ${brl(g.t.amount)}  ${g.t.status}  (casada por ${g.como})  "${g.t.description}"\n`);
    paraApagar.transactions.push(g.t);
    if (g.t.status === 'Pago') {
      const v = Number(g.t.amount) || 0;
      efeito[g.t.account_id] = (efeito[g.t.account_id] || 0) - v;
      efeito[g.t.to_account] = (efeito[g.t.to_account] || 0) + v;
    }
  }

  console.log('=== SALDOS APÓS APAGAR ===\n');
  const novos = [];
  for (const c of contas) {
    const ef = efeito[c.id];
    if (!ef) continue;
    const real = REAIS[String(c.name).toLowerCase()]
      ?? Object.entries(REAIS).find(([k]) => String(c.name).toLowerCase().includes(k))?.[1];
    if (real === undefined) {
      console.log(`  ${String(c.name).padEnd(20)} guardado ${brl(c.balance).padStart(14)} · efeito removido ${brl(ef).padStart(13)}`);
      console.log(`  ${' '.repeat(20)} ⚠ falta --real "${c.name}=<saldo do banco hoje>" para eu calcular\n`);
      continue;
    }
    const novo = real - ef;
    novos.push({ c, novo });
    console.log(`  ${String(c.name).padEnd(20)} real hoje ${brl(real).padStart(14)} · efeito removido ${brl(ef).padStart(13)} · gravar ${brl(novo).padStart(14)}`);
  }
  console.log(`
  "gravar" é o saldo de ANTES do movimento. Quando você refizer o aporte no app,
  ele aplica o efeito e a conta volta ao valor real do banco.
`);

  if (!APLICAR) {
    console.log('  Simulação. Nada foi tocado. Repita com --aplicar para gravar.\n');
    return;
  }
  if (novos.length !== Object.keys(efeito).length) {
    console.error('  ✕ Falta o saldo real de alguma conta afetada. Não vou gravar pela metade.\n');
    process.exit(1);
  }

  const agora = new Date().toISOString();
  for (const [store, lista] of Object.entries(paraApagar)) {
    for (const reg of lista) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${store}?id=eq.${reg.id}`, {
        method: 'PATCH', headers: cab,
        body: JSON.stringify({ deleted: true, updated_at: agora }),
      });
      if (!res.ok) { console.error('  ✕ falhou ao apagar', store, reg.id, res.status); process.exit(1); }
      console.log(`  ✓ apagado ${store}  ${reg.date}  ${brl(reg.amount)}`);
    }
  }
  for (const { c, novo } of novos) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${c.id}`, {
      method: 'PATCH', headers: cab,
      body: JSON.stringify({ balance: novo, updated_at: agora }),
    });
    if (!res.ok) { console.error('  ✕ falhou ao gravar saldo de', c.name, res.status); process.exit(1); }
    console.log(`  ✓ saldo  ${c.name} → ${brl(novo)}`);
  }
  console.log('\n  Pronto. Reabra o app e refaça o aporte — ele já cria a transferência sozinho.\n');
})();
