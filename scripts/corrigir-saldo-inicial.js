#!/usr/bin/env node
/* Troca ajustes de conciliação por um saldo inicial correto.

   O PROBLEMA QUE ISTO RESOLVE
   Quando o app importa um extrato e o saldo não bate, ele lança um "Ajuste de
   saldo" com a diferença, datado de HOJE. Isso acerta o saldo final, mas
   distorce o mês em que o ajuste caiu: o saldo de abertura daquele mês passa a
   incluir a diferença inteira, e o extrato mostra um saldo anterior que nunca
   existiu.

   O certo é o dinheiro que já estava na conta ficar como SALDO INICIAL, antes do
   primeiro lançamento — não como um ajuste no meio do caminho.

   Este script apaga os ajustes e regrava o saldo final. O saldo inicial passa a
   ser implícito e correto: saldo final menos a soma dos lançamentos reais.

   Uso:
     node scripts/corrigir-saldo-inicial.js --conta "Nubank PF"
     node scripts/corrigir-saldo-inicial.js --conta "Nubank PF" --saldo 1,72
     node scripts/corrigir-saldo-inicial.js --conta "Nubank PF" --saldo 1,72 --aplicar

   Sem --saldo, mantém o saldo atual (que você já conferiu com o banco). */
'use strict';

const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const CONTA = arg('--conta');
const SALDO = arg('--saldo');
const APLICAR = process.argv.includes('--aplicar');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

function lerEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) { console.error('\n✕ Falta o .env\n'); process.exit(1); }
  const env = {};
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  env.SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
  return env;
}

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
  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&limit=3000`, { headers: H })).json();

  const contas = (await get('accounts')).filter(a => !a.deleted);
  const txs = (await get('transactions')).filter(t => !t.deleted && t.status === 'Pago');

  if (!CONTA) {
    console.log('\nContas:\n');
    for (const a of contas) {
      const aj = txs.filter(t => t.adjustment && t.account_id === a.id);
      console.log(`  ${a.name.padEnd(22)} ${brl(a.balance).padStart(14)}  ${aj.length} ajuste(s) de conciliação`);
    }
    console.log('\n  node scripts/corrigir-saldo-inicial.js --conta "Nome"\n');
    return;
  }

  const conta = contas.find(a => norm(a.name).includes(norm(CONTA)));
  if (!conta) { console.error(`\n✕ Não achei conta com "${CONTA}"\n`); process.exit(1); }

  // Efeito de um lançamento no saldo desta conta (transferência toca as duas pontas)
  const efeito = t => {
    const v = Number(t.amount) || 0;
    if (t.type === 'Transferência') {
      let e = 0;
      if (t.account_id === conta.id) e -= v;
      if (t.to_account === conta.id) e += v;
      return e;
    }
    if (t.account_id !== conta.id) return 0;
    return t.type === 'Receita' ? v : -v;
  };

  const meus = txs.filter(t => efeito(t) !== 0);
  const ajustes = meus.filter(t => t.adjustment);
  const reais = meus.filter(t => !t.adjustment);
  const movimento = reais.reduce((s, t) => s + efeito(t), 0);
  const saldoFinal = SALDO !== null && SALDO !== undefined ? num(SALDO) : Number(conta.balance || 0);
  const inicialAtual = Number(conta.balance || 0) - meus.reduce((s, t) => s + efeito(t), 0);
  const inicialNovo = saldoFinal - movimento;

  console.log(`\n${conta.name}\n`);
  console.log(`  lançamentos reais         ${String(reais.length).padStart(4)}  movimento ${brl(movimento)}`);
  console.log(`  ajustes de conciliação    ${String(ajustes.length).padStart(4)}  ${ajustes.map(t => `${t.date} ${brl(efeito(t))}`).join(' · ')}`);
  console.log('');
  console.log(`  AGORA   saldo final ${brl(conta.balance).padStart(14)}   ·  inicial implícito ${brl(inicialAtual)}`);
  console.log(`  DEPOIS  saldo final ${brl(saldoFinal).padStart(14)}   ·  inicial implícito ${brl(inicialNovo)}`);
  console.log('');
  const mudaSaldo = Math.abs(saldoFinal - Number(conta.balance || 0)) > 0.005;
  if (!ajustes.length && !mudaSaldo) { console.log('  Nada a fazer: não há ajustes e o saldo já é esse.\n'); return; }
  if (ajustes.length) {
    console.log(`  Os ${ajustes.length} ajuste(s) somem, e o dinheiro que já estava na conta vira saldo inicial.`);
    console.log('  Cada mês passa a abrir com o que realmente sobrou do anterior.\n');
  } else {
    // Saldo contaminado sem ajuste: o campo foi escrito por um extrato que não
    // era desta conta, e nenhum lançamento explica a diferença
    console.log('  Não há ajustes — só o saldo da conta será regravado.\n');
  }

  if (!APLICAR) {
    console.log('── Simulação. Nada foi alterado. ──');
    console.log(`Para aplicar:  node scripts/corrigir-saldo-inicial.js --conta "${CONTA}"${SALDO ? ` --saldo ${SALDO}` : ''} --aplicar\n`);
    return;
  }

  for (const t of ajustes) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${t.id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ deleted: true, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error(`  ✕ ${t.id}: ${res.status}`);
  }
  await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${conta.id}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ balance: saldoFinal, updated_at: new Date().toISOString() }),
  });
  console.log('✓ Pronto.\n');
  console.log('NO APARELHO: Configurações → Apagar dados deste aparelho, e entre de novo,');
  console.log('senão a versão antiga do celular sobrescreve isto ao sincronizar.\n');
})().catch(e => { console.error(`\n✕ ${e.message}\n`); process.exit(1); });
