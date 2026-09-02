#!/usr/bin/env node
/* Corrige o SALDO GUARDADO de uma conta, sem lançar nada.

   POR QUE ISTO EXISTE, E POR QUE NÃO É UM LANÇAMENTO DE AJUSTE.
   O saldo da conta é um número guardado, mexido por deltas a cada lançamento.
   Quando um delta se perde ou é aplicado duas vezes, o número fica errado e o
   extrato continua certo — e não há de onde recalcular, porque o saldo que já
   existia antes do primeiro lançamento não está em lugar nenhum.

   Um "Ajuste de saldo" resolveria o número e sujaria o extrato com um gasto que
   não existiu. Este script conserta o campo e mais nada.

   ANTES DE RODAR, POR CAUSA DA SINCRONIZAÇÃO. A regra de conflito é "o mais
   recente vence", e a linha da conta inteira é substituída. Então:
     1. abra o app e espere a sincronização terminar;
     2. FECHE o app em todos os aparelhos;
     3. rode isto;
     4. reabra — o app puxa a linha mais nova.
   Um aparelho com alteração pendente nessa conta sobrescreveria a correção.

   Uso:
     node scripts/corrigir-saldo.js --conta "Nubank PJ"              (só mostra)
     node scripts/corrigir-saldo.js --conta "Nubank PJ" --saldo 14289,37
     node scripts/corrigir-saldo.js --conta "Nubank PJ" --saldo 14289,37 --aplicar
*/
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

const arg = n => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : null;
};
const APLICAR = process.argv.includes('--aplicar');
const ALVO = arg('conta');
const SALDO = arg('saldo');

if (!ALVO) {
  console.error('\n✕ Falta --conta "nome ou parte do nome"\n');
  process.exit(1);
}

function lerEnv() {
  const arq = path.join(RAIZ, '.env');
  if (!fs.existsSync(arq)) { console.error('\n✕ Não achei o .env\n'); process.exit(1); }
  const env = {};
  for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}
const brl = v => (v < 0 ? '-' : '') + 'R$ ' + Math.abs(Number(v) || 0)
  .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "14289,37" e "14.289,37" viram 14289.37 — é assim que se digita dinheiro aqui.
const paraNumero = s => Number(String(s).replace(/\./g, '').replace(',', '.'));

(async () => {
  const env = lerEnv();
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD }),
  });
  if (!r.ok) { console.error('\n✕ Login recusado. Confira e-mail e senha no .env\n'); process.exit(1); }
  const { access_token } = await r.json();
  const cab = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  const get = async t => (await fetch(`${env.SUPABASE_URL}/rest/v1/${t}`, { headers: cab })).json();

  const contas = await get('accounts?select=*');
  const achadas = contas.filter(c => String(c.name).toLowerCase().includes(String(ALVO).toLowerCase()));
  if (!achadas.length) {
    console.error(`\n✕ Nenhuma conta com "${ALVO}". As que existem:\n`);
    for (const c of contas) console.error('   · ' + c.name);
    process.exit(1);
  }
  if (achadas.length > 1) {
    console.error(`\n✕ "${ALVO}" casa com mais de uma conta — seja mais específico:\n`);
    for (const c of achadas) console.error('   · ' + c.name);
    process.exit(1);
  }
  const conta = achadas[0];

  // O extrato, pelas MESMAS regras do app (js/app.js: txEffect e applyTxEffect).
  const txs = (await get('transactions?select=*&limit=5000')).filter(t => !t.deleted);
  const semanada = t => !!t.kid_id && /semanada|mesada/i.test(String(t.description || ''));
  const efeito = t => {
    if (t.status !== 'Pago') return 0;
    const v = Number(t.amount) || 0;
    if (t.type === 'Transferência') return t.account_id === conta.id ? -v : (t.to_account === conta.id ? v : 0);
    if (t.account_id !== conta.id || t.card_id || semanada(t)) return 0;
    return t.type === 'Receita' ? v : -v;
  };
  const soma = txs.reduce((s, t) => s + efeito(t), 0);
  const atual = Number(conta.balance) || 0;

  console.log(`\n  Conta ............... ${conta.name}`);
  console.log(`  Saldo guardado ...... ${brl(atual)}`);
  console.log(`  Soma do extrato ..... ${brl(soma)}`);
  console.log(`  Diferença ........... ${brl(atual - soma)}`);
  console.log(`  (a diferença é o dinheiro que já existia antes do 1º lançamento —\n   vira suspeita quando é redonda, ou quando não bate com o banco)\n`);

  if (SALDO === null) {
    console.log('  Sem --saldo: nada a fazer. Informe o saldo real do banco para corrigir.\n');
    return;
  }
  const novo = paraNumero(SALDO);
  if (!Number.isFinite(novo)) { console.error(`\n✕ Não entendi o saldo "${SALDO}". Use 14289,37\n`); process.exit(1); }

  console.log(`  NOVO SALDO .......... ${brl(novo)}`);
  console.log(`  Move o número em .... ${brl(novo - atual)}`);
  console.log(`  Inicial implícito ... ${brl(novo - soma)}   ← precisa ser um valor de abertura plausível\n`);

  if (!APLICAR) {
    console.log('  Simulação. Para gravar de verdade, repita com --aplicar\n');
    return;
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/accounts?id=eq.${conta.id}`, {
    method: 'PATCH',
    headers: { ...cab, Prefer: 'return=representation' },
    body: JSON.stringify({ balance: novo, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    console.error('\n✕ Não consegui gravar:', res.status, await res.text().catch(() => ''), '\n');
    process.exit(1);
  }
  const [salvo] = await res.json();
  console.log(`  ✓ Gravado: ${conta.name} agora está em ${brl(salvo.balance)}`);
  console.log('    Reabra o app para ele puxar a linha nova.\n');
})();
