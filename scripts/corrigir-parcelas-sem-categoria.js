#!/usr/bin/env node
/* Copia a categoria da primeira parcela para as irmãs que estão sem.

   POR QUE ISSO EXISTE: até a versão 110 não havia como editar uma série de
   parcelas — corrigir a categoria exigia abrir uma tela por mês. Quem corrigia só
   a primeira deixava as outras sem categoria, e elas somem do donut, do orçamento
   por categoria e dos relatórios. Medido numa base real: R$ 1.800 invisíveis por
   nove meses.

   Sem --gravar, apenas simula. */
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
  const buscar = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*&deleted=eq.false`,
    { headers: { ...h, Range: '0-4999', 'Range-Unit': 'items' } })).json();

  const txs = await buscar('transactions');
  const cats = await buscar('categories');
  const nomeDe = id => (cats.find(c => c.id === id) || {}).name || '—';

  const grupos = {};
  for (const t of txs) if (t.group_id) (grupos[t.group_id] = grupos[t.group_id] || []).push(t);

  console.log(GRAVAR ? '=== GRAVANDO ===' : '=== SIMULAÇÃO (use --gravar para aplicar) ===');
  const patches = [];
  for (const [g, lista] of Object.entries(grupos)) {
    lista.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    /* A categoria de referência é a de QUALQUER parcela que tenha uma — não
       necessariamente a primeira. Quem corrigiu a série pelo meio deixou a de
       referência lá, e exigir que seja a primeira faria o script não achar nada. */
    const comCat = lista.find(t => t.category_id);
    const semCat = lista.filter(t => !t.category_id);
    if (!comCat || !semCat.length) continue;
    /* Só age quando NÃO há divergência: duas categorias diferentes na mesma série
       são uma decisão de quem lançou, e sobrescrever apagaria essa escolha. */
    const distintas = new Set(lista.filter(t => t.category_id).map(t => t.category_id));
    if (distintas.size > 1) {
      console.log(`\n(pulado) grupo ${g.slice(0, 8)} — parcelas com categorias diferentes, decida à mão`);
      continue;
    }
    const valor = semCat.reduce((s, t) => s + Number(t.amount || 0), 0);
    console.log(`\ngrupo ${g.slice(0, 8)} — "${String(comCat.description).replace(/\s*\(\d+\/\d+\)$/, '')}"`);
    console.log(`   referência: ${comCat.installment || '?'} -> ${nomeDe(comCat.category_id)}`);
    for (const t of semCat) {
      console.log(`   ${String(t.installment || '?').padStart(6)}  ${t.date}  ${String(Math.round(t.amount)).padStart(6)}  sem categoria -> ${nomeDe(comCat.category_id)}`);
      patches.push({ id: t.id, category_id: comCat.category_id });
    }
    console.log(`   ${semCat.length} parcela(s), R$ ${Math.round(valor)} que voltam para o donut e o orçamento`);
  }

  if (!patches.length) { console.log('\nNenhuma parcela sem categoria. Nada a fazer.'); return; }
  console.log(`\ntotal: ${patches.length} parcela(s)`);
  if (!GRAVAR) { console.log('\nNada foi gravado. Rode com --gravar para aplicar.'); return; }

  for (const p of patches) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/transactions?id=eq.${p.id}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify({ category_id: p.category_id, updated_at: new Date().toISOString() }) });
    if (!res.ok) throw new Error(`${p.id}: ${await res.text()}`);
  }
  console.log('\n✓ gravado');
})().catch(e => { console.error('ERRO', e.message); process.exit(1); });
