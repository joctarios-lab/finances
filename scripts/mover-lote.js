#!/usr/bin/env node
/* Move um lote de importação para outra conta — quando o OFX foi lançado na
   conta errada em "Lançar em".

   Cada importação grava tudo no mesmo instante, então o carimbo de horário
   identifica o lote com precisão: não é preciso escolher lançamento por
   lançamento nem arriscar levar junto o que veio de outro arquivo.

   Uso:
     # 1. ver os lotes existentes
     node scripts/mover-lote.js --listar

     # 2. simular
     node scripts/mover-lote.js --lote "2026-07-28T20:13" --de "PicPay" --para "Nome da conta"

     # 3. aplicar
     node scripts/mover-lote.js --lote "..." --de "..." --para "..." --aplicar

     # criar a conta de destino, se ela ainda não existir
     node scripts/mover-lote.js --criar-conta "Nome da nova conta"

   Os saldos das duas contas são ajustados junto: o que sai de uma entra na outra. */
'use strict';

const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const LOTE = arg('--lote');
const DE = arg('--de');
const PARA = arg('--para');
const CRIAR = arg('--criar-conta');
const APLICAR = process.argv.includes('--aplicar');
const LISTAR = process.argv.includes('--listar');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
});

function lerEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) { console.error('\n✕ Falta o .env (copie de .env.exemplo)\n'); process.exit(1); }
  const env = {};
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  env.SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
  return env;
}

/* Quanto este lançamento pesa no saldo da conta indicada.
   Transferência toca duas contas com sinais opostos; o resto toca uma só. */
const efeito = (t, contaId) => {
  const v = Number(t.amount) || 0;
  if (t.status !== 'Pago') return 0;
  if (t.type === 'Transferência') {
    if (t.account_id === contaId) return -v;
    if (t.to_account === contaId) return v;
    return 0;
  }
  if (t.account_id !== contaId) return 0;
  return t.type === 'Receita' ? v : -v;
};

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
  const txs = (await get('transactions')).filter(t => !t.deleted);
  const nome = id => (contas.find(a => a.id === id) || {}).name || '—';
  const achar = txt => contas.find(a => norm(a.name).includes(norm(txt)));

  if (CRIAR) {
    const fam = (await get('family_settings'))[0];
    const novo = {
      id: uuid(), family_id: fam ? fam.family_id : (await get('accounts'))[0].family_id,
      name: CRIAR, type: 'Conta Corrente', institution: '', balance: 0,
      active: true, updated_at: new Date().toISOString(), deleted: false,
    };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/accounts`, { method: 'POST', headers: H, body: JSON.stringify(novo) });
    console.log(res.ok ? `\n✓ Conta "${CRIAR}" criada.\n` : `\n✕ ${res.status} ${(await res.text()).slice(0, 140)}\n`);
    return;
  }

  if (LISTAR || !LOTE || !DE || !PARA) {
    const lotes = {};
    for (const t of txs) {
      const k = `${String(t.updated_at).slice(0, 16)} | ${nome(t.account_id)}`;
      (lotes[k] = lotes[k] || []).push(t);
    }
    console.log('\nLOTES DE IMPORTAÇÃO (cada importação grava tudo no mesmo instante):\n');
    for (const k of Object.keys(lotes).sort()) {
      const L = lotes[k];
      const datas = L.map(t => t.date).sort();
      const quem = [...new Set(L.map(t => (t.description.split(' - ')[1] || t.description).slice(0, 24)))];
      console.log(`  ${k}`);
      console.log(`     ${String(L.length).padStart(4)} lançamentos · ${datas[0]} a ${datas[datas.length - 1]}`);
      console.log(`     ${quem.slice(0, 4).join(' / ')}`);
    }
    console.log('\nContas:');
    for (const a of contas) console.log(`  ${a.name.padEnd(22)} ${brl(a.balance)}`);
    console.log('\n  node scripts/mover-lote.js --lote "AAAA-MM-DDTHH:MM" --de "Conta atual" --para "Conta certa"\n');
    return;
  }

  const origem = achar(DE), destino = achar(PARA);
  if (!origem) { console.error(`\n✕ Não achei conta com "${DE}"\n`); process.exit(1); }
  if (!destino) {
    console.error(`\n✕ Não achei conta com "${PARA}". Para criar:`);
    console.error(`    node scripts/mover-lote.js --criar-conta "${PARA}"\n`);
    process.exit(1);
  }
  if (origem.id === destino.id) { console.error('\n✕ Origem e destino são a mesma conta\n'); process.exit(1); }

  const alvos = txs.filter(t => t.account_id === origem.id && String(t.updated_at).slice(0, 16) === LOTE);
  if (!alvos.length) { console.log(`\nNenhum lançamento em "${origem.name}" no lote ${LOTE}.\n`); return; }

  let saiDaOrigem = 0;
  for (const t of alvos) saiDaOrigem += efeito(t, origem.id);

  const rec = alvos.filter(t => t.type === 'Receita').length;
  const des = alvos.filter(t => t.type === 'Despesa').length;
  const tr = alvos.filter(t => t.type === 'Transferência').length;
  console.log(`\n${alvos.length} lançamento(s) de "${origem.name}" → "${destino.name}"`);
  console.log(`  ${rec} receitas · ${des} despesas · ${tr} transferências\n`);
  console.log('EFEITO NOS SALDOS:\n');
  console.log(`  ${origem.name.padEnd(22)} ${brl(origem.balance).padStart(14)} → ${brl(Number(origem.balance) - saiDaOrigem).padStart(14)}`);
  console.log(`  ${destino.name.padEnd(22)} ${brl(destino.balance).padStart(14)} → ${brl(Number(destino.balance) + saiDaOrigem).padStart(14)}`);

  if (!APLICAR) {
    console.log('\n── Simulação. Nada foi alterado. ──');
    console.log('Se estiver certo, repita com --aplicar\n');
    return;
  }

  console.log('\nAplicando…');
  for (const t of alvos) {
    // Numa transferência, só a perna que estava na conta errada muda
    const corpo = t.type === 'Transferência' && t.to_account === origem.id
      ? { to_account: destino.id, updated_at: new Date().toISOString() }
      : { account_id: destino.id, updated_at: new Date().toISOString() };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${t.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify(corpo),
    });
    if (!res.ok) console.error(`  ✕ ${t.id}: ${res.status}`);
  }
  for (const [a, delta] of [[origem, -saiDaOrigem], [destino, saiDaOrigem]]) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${a.id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ balance: Number(a.balance || 0) + delta, updated_at: new Date().toISOString() }),
    });
  }
  console.log('\n✓ Pronto.');
  console.log('\nNO APARELHO: Configurações → Apagar dados deste aparelho, e entre de novo,');
  console.log('senão a versão antiga que está no celular sobrescreve isto ao sincronizar.\n');
})().catch(e => { console.error(`\n✕ ${e.message}\n`); process.exit(1); });
