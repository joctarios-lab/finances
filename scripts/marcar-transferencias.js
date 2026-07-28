#!/usr/bin/env node
/* Converte lançamentos em transferência entre contas suas — com a regra que
   VOCÊ define, não adivinhada.

   Existe porque adivinhar erra: no seu extrato, "Gleice Peixoto - PICPAY" é uma
   conta sua, mas "DECIO PARADA BONITA - BCO BRADESCO" é uma loja, e qualquer
   regra automática por nome ou por valor+data confunde as duas. Quem sabe a
   diferença é você.

   Uso:
     # 1. ver quais lançamentos parecem transferência (nenhuma alteração)
     node scripts/marcar-transferencias.js --listar

     # 2. simular uma regra
     node scripts/marcar-transferencias.js --texto "PICPAY" --conta "PicPay Gleice"

     # 3. aplicar
     node scripts/marcar-transferencias.js --texto "PICPAY" --conta "PicPay Gleice" --aplicar

   --texto  trecho que precisa aparecer na descrição (sem acento, sem caixa)
   --conta  nome (ou parte) da conta do OUTRO lado
   --de     opcional: só lançamentos desta conta

   Uma transferência move as duas contas. O script ajusta os saldos junto. */
'use strict';

const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const TEXTO = arg('--texto');
const CONTA = arg('--conta');
const DE = arg('--de');
const APLICAR = process.argv.includes('--aplicar');
const LISTAR = process.argv.includes('--listar');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  const txs = (await get('transactions')).filter(t => !t.deleted && !t.adjustment);
  const nome = id => (contas.find(a => a.id === id) || {}).name || '?';

  /* --listar: mostra o que TEM CARA de transferência, agrupado pelo destinatário.
     Agrupar é o que revela a regra: dez linhas para o mesmo nome viram uma regra só. */
  if (LISTAR || !TEXTO || !CONTA) {
    const cand = txs.filter(t => t.type !== 'Transferência' && /transfer|pix|ted /i.test(t.description || ''));
    const porDestino = {};
    for (const t of cand) {
      // O nome do outro lado costuma vir depois do primeiro "-"
      const alvo = (t.description.split(' - ')[1] || t.description).slice(0, 42).trim();
      (porDestino[alvo] = porDestino[alvo] || []).push(t);
    }
    console.log(`\n${cand.length} lançamento(s) com cara de transferência, por destinatário:\n`);
    for (const [alvo, lista] of Object.entries(porDestino).sort((a, b) => b[1].length - a[1].length)) {
      const soma = lista.reduce((s, t) => s + Number(t.amount || 0), 0);
      console.log(`  ${String(lista.length).padStart(3)}x  ${brl(soma).padStart(13)}  ${alvo}`);
      console.log(`        em ${[...new Set(lista.map(t => nome(t.account_id)))].join(', ')}`);
    }
    console.log('\nSuas contas:');
    for (const a of contas) console.log(`  ${a.name}`);
    console.log('\nEscolha um destinatário que seja conta SUA e rode:');
    console.log('  node scripts/marcar-transferencias.js --texto "TRECHO" --conta "Nome da conta"\n');
    return;
  }

  const destino = contas.find(a => norm(a.name).includes(norm(CONTA)));
  if (!destino) { console.error(`\n✕ Não achei conta com "${CONTA}"\n`); process.exit(1); }
  const origem = DE ? contas.find(a => norm(a.name).includes(norm(DE))) : null;
  if (DE && !origem) { console.error(`\n✕ Não achei conta com "${DE}"\n`); process.exit(1); }

  /* A descrição precisa dizer "transferência": compra em maquininha ou débito
     automático podem trazer o mesmo nome e não são movimentação entre contas. */
  const alvos = txs.filter(t =>
    t.type !== 'Transferência' &&
    /transfer/i.test(t.description || '') &&
    norm(t.description).includes(norm(TEXTO)) &&
    t.account_id !== destino.id &&
    (!origem || t.account_id === origem.id));

  if (!alvos.length) { console.log('\nNenhum lançamento bate com essa regra.\n'); return; }

  console.log(`\n${alvos.length} lançamento(s) virarão transferência com ${destino.name}:\n`);
  const delta = {};
  for (const t of alvos) {
    const saida = t.type === 'Despesa';
    const v = Number(t.amount || 0);
    /* A conta onde o lançamento está NÃO muda de saldo: despesa já tirava v e a
       transferência continua tirando v; receita já somava v e continua somando.
       Quem muda é a outra ponta, que antes não existia: recebe (numa saída) ou
       paga (numa entrada). */
    delta[t.account_id] = delta[t.account_id] || 0;
    delta[destino.id] = (delta[destino.id] || 0) + (saida ? v : -v);
    console.log(`  ${t.date}  ${brl(t.amount).padStart(12)}  ${saida ? 'SAI de ' : 'ENTRA em '}${nome(t.account_id)}`);
    console.log(`            ${t.description.slice(0, 78)}`);
  }

  console.log('\nEFEITO NOS SALDOS:\n');
  for (const [id, d] of Object.entries(delta)) {
    const a = contas.find(x => x.id === id);
    if (!a || Math.abs(d) < 0.005) continue;
    console.log(`  ${a.name.padEnd(20)} ${brl(a.balance).padStart(14)} → ${brl(Number(a.balance || 0) + d).padStart(14)}   (${d >= 0 ? '+' : ''}${brl(d)})`);
  }

  if (!APLICAR) {
    console.log('\n── Simulação. Nada foi alterado. ──');
    console.log('Confira a lista acima e, se estiver certa, repita com --aplicar\n');
    return;
  }

  console.log('\nAplicando…');
  for (const t of alvos) {
    const saida = t.type === 'Despesa';
    const corpo = {
      type: 'Transferência', method: 'Transferência', category_id: null,
      // Quem sai é sempre account_id: numa saída é a conta atual, numa entrada é a outra
      account_id: saida ? t.account_id : destino.id,
      to_account: saida ? destino.id : t.account_id,
      updated_at: new Date().toISOString(),
    };
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${t.id}`, {
      method: 'PATCH', headers: H, body: JSON.stringify(corpo),
    });
    if (!res.ok) console.error(`  ✕ ${t.id}: ${res.status}`);
  }
  for (const [id, d] of Object.entries(delta)) {
    const a = contas.find(x => x.id === id);
    if (!a || Math.abs(d) < 0.005) continue;
    await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ balance: Number(a.balance || 0) + d, updated_at: new Date().toISOString() }),
    });
  }
  console.log('\n✓ Pronto.');
  console.log('\nNO APARELHO: Configurações → Apagar dados deste aparelho, e entre de novo,');
  console.log('senão a versão antiga que está no celular sobrescreve isto ao sincronizar.\n');
})().catch(e => { console.error(`\n✕ ${e.message}\n`); process.exit(1); });
