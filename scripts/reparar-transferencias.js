#!/usr/bin/env node
/* Repara as transferências que perderam o destino na sincronização.

   Causa: 'to_account' não estava na lista de campos enviados ao Supabase.
   A transferência ficava certa no aparelho e chegava ao servidor sem o destino;
   quando outro aparelho puxava, ela virava só uma saída — o dinheiro sumia de
   uma conta e não aparecia em lugar nenhum.

   Uso:
     node scripts/reparar-transferencias.js            (só mostra o que faria)
     node scripts/reparar-transferencias.js --aplicar  (grava)

   Sempre roda o diagnóstico primeiro e mostra o antes/depois dos saldos. */
'use strict';

const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const APLICAR = process.argv.includes('--aplicar');

function lerEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) { console.error('\n✕ Falta o arquivo .env (copie de .env.exemplo)\n'); process.exit(1); }
  const env = {};
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  env.SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
  return env;
}

const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

(async () => {
  const env = lerEnv();
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }),
  });
  const auth = await r.json();
  if (!auth.access_token) { console.error('\n✕ Login recusado\n'); process.exit(1); }
  const H = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };

  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=2000`, { headers: H })).json();
  const contas = (await get('accounts')).filter(a => !a.deleted);
  const txs = (await get('transactions')).filter(t => !t.deleted);
  const nome = id => (contas.find(a => a.id === id) || {}).name || '(?)';

  const quebradas = txs.filter(t => t.type === 'Transferência' && (!t.account_id || !t.to_account));
  console.log(`\n${quebradas.length} transferência(s) sem uma das pontas.\n`);
  if (!quebradas.length) { console.log('Nada a reparar.\n'); return; }

  /* Sem o destino gravado, ele não pode ser adivinhado com segurança. O que dá
     para saber com certeza é a DIREÇÃO, pela descrição do banco: "recebida"
     entrou na conta, "enviada" saiu dela. Uma transferência cuja direção está
     invertida faz o saldo andar para o lado errado em DOBRO do valor.

     Onde não dá para ter certeza, o lançamento vira Despesa ou Receita comum —
     que é o que ele realmente é enquanto não se souber a outra ponta. Melhor um
     lançamento simples e correto do que uma transferência pela metade. */
  const ehEntrada = t => /recebid|recebimento|credito/i.test(t.description || '');

  const planos = quebradas.map(t => {
    const entrada = ehEntrada(t);
    return {
      t,
      // Sem a outra ponta, deixa de ser transferência: vira o que de fato é nesta conta
      novo: {
        type: entrada ? 'Receita' : 'Despesa',
        to_account: null,
        method: /pix/i.test(t.description || '') ? 'PIX' : 'Transferência',
        updated_at: new Date().toISOString(),
      },
      direcao: entrada ? 'ENTROU' : 'SAIU',
    };
  });

  console.log('O QUE SERÁ FEITO — cada uma vira um lançamento simples na conta em que está:\n');
  const saldos = {};
  for (const { t, novo, direcao } of planos) {
    const conta = t.account_id;
    // Antes: transferência tirava o valor da conta. Depois: entrada soma, saída subtrai.
    const antes = -Number(t.amount || 0);
    const depois = novo.type === 'Receita' ? Number(t.amount || 0) : -Number(t.amount || 0);
    saldos[conta] = (saldos[conta] || 0) + (depois - antes);
    console.log(`  ${t.date}  ${brl(t.amount).padStart(12)}  ${direcao.padEnd(7)} ${nome(conta).padEnd(18)} → ${novo.type}`);
  }

  console.log('\nEFEITO NOS SALDOS:\n');
  for (const [id, delta] of Object.entries(saldos)) {
    const a = contas.find(x => x.id === id) || {};
    console.log(`  ${nome(id).padEnd(20)} ${brl(a.balance).padStart(14)} → ${brl(Number(a.balance || 0) + delta).padStart(14)}   (${delta >= 0 ? '+' : ''}${brl(delta)})`);
  }

  if (!APLICAR) {
    console.log('\n── Simulação. Nada foi alterado. ──');
    console.log('Para aplicar:  node scripts/reparar-transferencias.js --aplicar\n');
    return;
  }

  console.log('\nAplicando…');
  for (const { t, novo } of planos) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${t.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify(novo),
    });
    if (!res.ok) { console.error(`  ✕ ${t.id}: ${res.status} ${(await res.text()).slice(0, 120)}`); continue; }
  }
  for (const [id, delta] of Object.entries(saldos)) {
    const a = contas.find(x => x.id === id);
    if (!a) continue;
    await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ balance: Number(a.balance || 0) + delta, updated_at: new Date().toISOString() }),
    });
  }
  console.log('\n✓ Pronto.\n');
  console.log('NO APARELHO: Configurações → Apagar dados deste aparelho, e entre de novo.');
  console.log('O aparelho ainda tem a versão antiga desses lançamentos e sobrescreveria');
  console.log('o conserto na próxima sincronização.\n');
})().catch(e => { console.error(`\n✕ ${e.message}\n`); process.exit(1); });
