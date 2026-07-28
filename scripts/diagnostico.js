#!/usr/bin/env node
/* Diagnóstico da base do Supabase — roda na SUA máquina.

   Uso:
     1. copie .env.exemplo para .env e preencha
     2. node scripts/diagnostico.js
     3. mande o relatório impresso (ou diagnostico-AAAA-MM-DD.txt)

   As credenciais ficam no .env, que está no .gitignore. O relatório traz
   NÚMEROS e CÓDIGOS, não descrições — dá para analisar sem expor no que a
   família gasta. Use --detalhado para ver as descrições reais na sua tela.

   Só faz leitura (GET). Nada é alterado no banco. */
'use strict';

const fs = require('fs');
const path = require('path');

const DETALHADO = process.argv.includes('--detalhado');
const RAIZ = path.resolve(__dirname, '..');

// ---------- .env ----------
function lerEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) {
    console.error('\n✕ Não achei o arquivo .env.\n');
    console.error('  Copie o modelo e preencha:');
    console.error('    cp .env.exemplo .env\n');
    process.exit(1);
  }
  const env = {};
  for (const linha of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  const faltando = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_EMAIL', 'SUPABASE_PASSWORD']
    .filter(k => !env[k]);
  if (faltando.length) {
    console.error(`\n✕ Faltou preencher no .env: ${faltando.join(', ')}\n`);
    process.exit(1);
  }
  env.SUPABASE_URL = env.SUPABASE_URL.replace(/\/$/, '');
  return env;
}

// ---------- Supabase ----------
async function entrar(env) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Login recusado: ${d.error_description || d.msg || res.status}`);
  return d.access_token;
}

async function buscar(env, token, tabela) {
  const linhas = [];
  let de = 0;
  for (;;) {                                    // PostgREST devolve no máximo 1000 por vez
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=1000&offset=${de}`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${tabela}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    const parte = await res.json();
    linhas.push(...parte);
    if (parte.length < 1000) break;
    de += 1000;
  }
  return linhas;
}

// ---------- utilidades ----------
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cod = s => require('crypto').createHash('md5').update(String(s || '').toLowerCase()).digest('hex').slice(0, 5);
const rotulo = (texto, prefixo) => (DETALHADO ? texto : `${prefixo}-${cod(texto)}`);
const dias = (a, b) => Math.abs(Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 86400000;

const saida = [];
const p = (...args) => { const l = args.join(' '); saida.push(l); console.log(l); };
const titulo = t => { p(''); p('━'.repeat(64)); p(t); p('━'.repeat(64)); };

(async () => {
  const env = lerEnv();
  console.log(`\nConectando em ${env.SUPABASE_URL} …`);
  const token = await entrar(env);

  const T = {};
  for (const t of ['accounts', 'cards', 'categories', 'transactions', 'goals', 'goal_entries', 'invoice_status', 'family_settings']) {
    T[t] = (await buscar(env, token, t)).filter(r => !r.deleted);
  }

  const contas = T.accounts, cartoes = T.cards, txs = T.transactions;
  const nomeConta = id => {
    const a = contas.find(x => x.id === id) || cartoes.find(x => x.id === id);
    return a ? rotulo(a.name, a.limit_amount !== undefined ? 'CARTAO' : 'CONTA') : '(não existe)';
  };
  const achados = [];
  const registrar = (grav, titulo, itens) => { if (itens.length) achados.push({ grav, titulo, n: itens.length }); return itens; };

  titulo('PANORAMA');
  p(`Contas: ${contas.length} · Cartões: ${cartoes.length} · Categorias: ${T.categories.length}`);
  p(`Lançamentos: ${txs.length} · Metas: ${T.goals.length} · Aportes: ${T.goal_entries.length}`);
  const datas = txs.map(t => t.date).filter(Boolean).sort();
  if (datas.length) p(`Período: ${datas[0]} a ${datas[datas.length - 1]}`);

  /* ---------- 1. Saldo x lançamentos ----------
     O saldo é mantido de forma incremental (cada lançamento soma ou subtrai).
     Recalcular do zero mostra se algum lançamento entrou sem ajustar o saldo,
     ou se um saldo foi mexido sem lançamento correspondente. */
  titulo('1. SALDO DE CADA CONTA x SOMA DOS LANÇAMENTOS');
  p('A diferença costuma ser o saldo que já existia antes do 1º lançamento.');
  p('Vira suspeita quando bate com o valor exato de algum lançamento.\n');
  const pagos = txs.filter(t => t.status === 'Pago');
  const difs = [];
  for (const a of contas) {
    const normais = pagos.filter(t => t.account_id === a.id && t.type !== 'Transferência')
      .reduce((s, t) => s + (t.type === 'Receita' ? 1 : -1) * Number(t.amount || 0), 0);
    const saiu = pagos.filter(t => t.type === 'Transferência' && t.account_id === a.id)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const entrou = pagos.filter(t => t.type === 'Transferência' && t.to_account === a.id)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    const calc = normais - saiu + entrou;
    const dif = Number(a.balance || 0) - calc;
    difs.push({ a, dif });
    p(`  ${rotulo(a.name, 'CONTA').padEnd(14)} app ${brl(a.balance).padStart(14)} · lançamentos ${brl(calc).padStart(14)} · diferença ${brl(dif).padStart(14)}`);
  }
  // Diferença que coincide com um lançamento existente é forte indício de lançamento contado duas vezes (ou nenhuma)
  for (const { a, dif } of difs) {
    if (Math.abs(dif) < 0.01) continue;
    const igual = txs.filter(t => Math.abs(Math.abs(Number(t.amount)) - Math.abs(dif)) < 0.01);
    if (igual.length) {
      p(`\n  ⚠ A diferença de ${rotulo(a.name, 'CONTA')} (${brl(dif)}) é igual a ${igual.length} lançamento(s):`);
      for (const t of igual.slice(0, 5)) p(`      ${t.date} · ${rotulo(t.description, 'D')} · ${brl(t.amount)} · ${t.type}`);
      registrar('ALTA', `Diferença de saldo igual a lançamento existente (${rotulo(a.name, 'CONTA')})`, igual);
    }
  }

  /* ---------- 2. Transferência contada duas vezes ----------
     Antes da versão 37, importar o extrato da segunda conta criava um
     lançamento normal do mesmo valor — o dinheiro entrava duas vezes. */
  titulo('2. TRANSFERÊNCIA POSSIVELMENTE CONTADA DUAS VEZES');
  const transferencias = txs.filter(t => t.type === 'Transferência');
  const suspeitos = txs.filter(t => t.type !== 'Transferência' && !t.adjustment && transferencias.some(r =>
    Math.abs(Number(r.amount) - Number(t.amount)) < 0.01 &&
    dias(r.date, t.date) <= 3 &&
    (r.to_account === t.account_id || r.account_id === t.account_id)));
  if (!suspeitos.length) p('  ✓ Nada encontrado.');
  else {
    p(`  ⚠ ${suspeitos.length} lançamento(s) que parecem ser a outra perna de uma transferência:\n`);
    for (const t of suspeitos) {
      const par = transferencias.find(r => Math.abs(Number(r.amount) - Number(t.amount)) < 0.01 && dias(r.date, t.date) <= 3);
      p(`      ${t.date} · ${rotulo(t.description, 'D')} · ${brl(t.amount)} · ${t.type} em ${nomeConta(t.account_id)}`);
      if (par) p(`         ↳ transferência ${par.date} · ${nomeConta(par.account_id)} → ${nomeConta(par.to_account)}`);
    }
    p('\n  Se confirmado: apague o lançamento solto. A transferência sozinha já move as duas contas.');
    registrar('ALTA', 'Transferência possivelmente contada duas vezes', suspeitos);
  }

  // ---------- 3. Duplicatas ----------
  titulo('3. DUPLICATAS PROVÁVEIS');
  const porChave = {};
  for (const t of txs) {
    if (t.type === 'Transferência') continue;
    const k = `${(t.description || '').toLowerCase()}|${t.amount}|${t.date}`;
    (porChave[k] = porChave[k] || []).push(t);
  }
  const dupes = Object.values(porChave).filter(g => g.length > 1);
  if (!dupes.length) p('  ✓ Nada encontrado.');
  else {
    for (const g of dupes) {
      const parcelas = g.every(t => t.installment);       // parcelas legítimas do mesmo dia
      p(`  ${parcelas ? '·' : '⚠'} ${g.length}x  ${g[0].date} · ${rotulo(g[0].description, 'D')} · ${brl(g[0].amount)}${parcelas ? '  (parcelas — provavelmente ok)' : ''}`);
    }
    registrar('MÉDIA', 'Duplicatas prováveis', dupes.filter(g => !g.every(t => t.installment)));
  }

  const fitids = {};
  for (const t of txs) if (t.fitid) (fitids[t.fitid] = fitids[t.fitid] || []).push(t);
  const fitDup = Object.values(fitids).filter(g => g.length > 1);
  if (fitDup.length) {
    p(`\n  ⚠ ${fitDup.length} FITID repetido — o mesmo lançamento do banco entrou mais de uma vez:`);
    for (const g of fitDup.slice(0, 10)) p(`      ${g.length}x  ${g[0].date} · ${rotulo(g[0].description, 'D')} · ${brl(g[0].amount)}`);
    registrar('ALTA', 'FITID repetido (mesmo lançamento do banco importado 2x)', fitDup);
  }

  // ---------- 4. Integridade dos vínculos ----------
  titulo('4. VÍNCULOS QUEBRADOS');
  const idsConta = new Set(contas.map(a => a.id));
  const idsCartao = new Set(cartoes.map(c => c.id));
  const idsCat = new Set(T.categories.map(c => c.id));
  const problemas = [
    ['Lançamento com conta que não existe', txs.filter(t => t.account_id && !idsConta.has(t.account_id))],
    ['Lançamento com cartão que não existe', txs.filter(t => t.card_id && !idsCartao.has(t.card_id))],
    ['Transferência com destino inexistente', txs.filter(t => t.type === 'Transferência' && t.to_account && !idsConta.has(t.to_account))],
    ['Transferência sem uma das pontas', txs.filter(t => t.type === 'Transferência' && (!t.account_id || !t.to_account))],
    ['Transferência de uma conta para ela mesma', txs.filter(t => t.type === 'Transferência' && t.account_id && t.account_id === t.to_account)],
    ['Lançamento com categoria que não existe', txs.filter(t => t.category_id && !idsCat.has(t.category_id))],
    ['Subcategoria com pai inexistente', T.categories.filter(c => c.parent_id && !idsCat.has(c.parent_id))],
    ['Descrição quebrada pelo bug das parcelas', txs.filter(t => /object HTML/i.test(t.description || ''))],
    ['Valor negativo ou zero', txs.filter(t => !(Number(t.amount) > 0))],
    ['Despesa em categoria de entrada', txs.filter(t => {
      const c = T.categories.find(x => x.id === t.category_id);
      return c && t.type === 'Despesa' && c.type === 'Receita';
    })],
    ['Receita em categoria de gasto', txs.filter(t => {
      const c = T.categories.find(x => x.id === t.category_id);
      return c && t.type === 'Receita' && (c.type || 'Despesa') === 'Despesa';
    })],
  ];
  let limpo = true;
  for (const [nome, itens] of problemas) {
    if (!itens.length) continue;
    limpo = false;
    p(`  ⚠ ${nome}: ${itens.length}`);
    for (const t of itens.slice(0, 4)) {
      p(`      ${t.date || ''} ${rotulo(t.description || t.name, 'D')} ${t.amount !== undefined ? brl(t.amount) : ''}`.trimEnd());
    }
    registrar(nome.includes('bug') || nome.includes('não existe') ? 'ALTA' : 'MÉDIA', nome, itens);
  }
  if (limpo) p('  ✓ Nenhum vínculo quebrado.');

  // ---------- 5. Parcelamentos ----------
  titulo('5. COMPRAS PARCELADAS');
  const grupos = {};
  for (const t of txs) if (t.group_id) (grupos[t.group_id] = grupos[t.group_id] || []).push(t);
  const quebrados = Object.values(grupos).filter(g => {
    const esperado = Math.max(...g.map(t => Number(String(t.installment || '').split('/')[1]) || 0));
    return esperado && g.length !== esperado;
  });
  if (!quebrados.length) p(`  ✓ ${Object.keys(grupos).length} parcelamento(s), todos completos.`);
  else {
    for (const g of quebrados) {
      const esperado = Math.max(...g.map(t => Number(String(t.installment || '').split('/')[1]) || 0));
      p(`  ⚠ ${rotulo(g[0].description, 'D')}: ${g.length} parcela(s) de ${esperado} esperadas · ${brl(g[0].amount)} cada`);
    }
    registrar('MÉDIA', 'Parcelamento incompleto', quebrados);
  }

  // ---------- 6. Volume por mês ----------
  titulo('6. VOLUME POR MÊS (buraco ou pico chamam atenção)');
  const meses = {};
  for (const t of txs) {
    const m = String(t.date || '').slice(0, 7);
    if (!m) continue;
    const x = (meses[m] = meses[m] || { d: 0, r: 0, tr: 0, aj: 0, gasto: 0, entrou: 0 });
    if (t.adjustment) x.aj++;
    else if (t.type === 'Transferência') x.tr++;
    else if (t.type === 'Receita') { x.r++; x.entrou += Number(t.amount || 0); }
    else { x.d++; x.gasto += Number(t.amount || 0); }
  }
  p('  mês      desp  rec  transf  ajust        gasto         entrou');
  for (const m of Object.keys(meses).sort().reverse()) {
    const x = meses[m];
    p(`  ${m}  ${String(x.d).padStart(4)} ${String(x.r).padStart(4)} ${String(x.tr).padStart(7)} ${String(x.aj).padStart(6)} ${brl(x.gasto).padStart(14)} ${brl(x.entrou).padStart(14)}`);
  }

  // ---------- Resumo ----------
  titulo('RESUMO');
  if (!achados.length) p('  ✓ Nenhum problema conhecido encontrado.');
  else {
    for (const a of achados.sort((x, y) => (x.grav === 'ALTA' ? -1 : 1) - (y.grav === 'ALTA' ? -1 : 1))) {
      p(`  [${a.grav}] ${a.titulo}: ${a.n}`);
    }
  }
  p('');
  p(DETALHADO
    ? '  Rodou com --detalhado: as descrições REAIS estão acima. Reveja antes de enviar.'
    : '  Descrições substituídas por códigos (D-xxxxx). O mesmo texto gera sempre o mesmo código.');
  p('  Para ver as descrições reais na sua tela: node scripts/diagnostico.js --detalhado');

  const arq = path.join(RAIZ, `diagnostico-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.writeFileSync(arq, saida.join('\n') + '\n');
  console.log(`\nRelatório salvo em ${arq}\n`);
})().catch(e => {
  console.error(`\n✕ ${e.message}\n`);
  process.exit(1);
});
