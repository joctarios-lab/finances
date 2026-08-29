/* CONVERSA COMPLETA, NOS DOIS PROVEDORES.

   As asserções de forma (em smoke.js) provam que a tradução de cada campo está
   certa. Não provam que o LAÇO fecha: que o pedido de ferramenta é executado,
   que o resultado volta no formato que aquela API aceita, e que a segunda volta
   produz a resposta final.

   Aqui um `fetch` de mentira faz o papel de cada API. Ele CONFERE o que recebeu
   — inclusive que o resultado da ferramenta chegou amarrado ao id certo — e só
   então devolve a resposta seguinte. Sem chave, sem rede, sem custo.

   Roda: node tests/provedores.js */
const fs = require('fs');
const BASE = 'D:/Projetos/meus-projetos/financas/';

const armazem = base => ({
  getItem: k => (k in base ? base[k] : null),
  setItem: (k, v) => { base[k] = String(v); },
  removeItem: k => { delete base[k]; },
  key: i => Object.keys(base)[i] ?? null,
  get length() { return Object.keys(base).length; },
});
global.localStorage = armazem({});
global.sessionStorage = armazem({});
global.crypto = require('crypto').webcrypto;

const juntos = ['js/db.js', 'js/ia.js'].map(f => fs.readFileSync(BASE + f, 'utf8')).join('\n;\n');
eval(juntos + '; Object.assign(global, { DB, IA, KCrypto });');
DB.load();
DB.data = DB.data || {};
DB.data.meta = DB.data.meta || {};

let falhas = 0;
const ok = (rot, cond, extra = '') => {
  console.log((cond ? '  OK   | ' : ' FALHA | ') + rot.padEnd(54) + extra);
  if (!cond) falhas++;
};

/* Cada roteiro é uma lista de respostas: a primeira pede a ferramenta, a
   segunda responde de verdade. `conferir` roda no corpo que o app enviou. */
function fingirAPI(roteiro) {
  const enviados = [];
  let volta = 0;
  global.fetch = async (url, opts) => {
    const corpo = JSON.parse(opts.body);
    enviados.push({ url, headers: opts.headers, corpo });
    const passo = roteiro[volta++];
    if (passo.conferir) passo.conferir(corpo, enviados);
    return { ok: true, status: 200, json: async () => passo.responde, text: async () => '' };
  };
  return enviados;
}

(async () => {
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.ver.situacao = true;

  // ---------------------------------------------------------------- Anthropic
  console.log('\n=== Uma conversa inteira pela Anthropic ===');
  IA.cfg.provedor = 'anthropic';
  IA.cfg.chaves.anthropic = 'sk-ant-DE-MENTIRA';

  let viuResultado = null;
  let enviados = fingirAPI([
    {
      conferir: c => {
        ok('manda a instrução no campo system', typeof c.system === 'string' && c.system.length > 20);
        ok('e a ferramenta autorizada', (c.tools || []).some(t => t.name === 'situacao_financeira'));
      },
      responde: { content: [
        { type: 'text', text: 'deixa eu olhar' },
        { type: 'tool_use', id: 'tu_9', name: 'situacao_financeira', input: {} },
      ] },
    },
    {
      conferir: c => {
        const ultima = c.messages[c.messages.length - 1];
        viuResultado = ultima;
        ok('o resultado volta como mensagem de usuário', ultima.role === 'user');
        ok('  em bloco tool_result', ultima.content[0].type === 'tool_result');
        ok('  amarrado ao id do pedido', ultima.content[0].tool_use_id === 'tu_9');
        ok('  com o número vindo do app', /em_conta/.test(ultima.content[0].content));
      },
      responde: { content: [{ type: 'text', text: 'Você tem R$ 0,00 em conta.' }] },
    },
  ]);

  let r = await IA.perguntar([{ role: 'user', content: 'como estou?' }]);
  ok('a conversa fecha em duas voltas', enviados.length === 2, `voltas: ${enviados.length}`);
  ok('devolve a resposta final', r.texto === 'Você tem R$ 0,00 em conta.');
  ok('e registra o que consultou', r.consultou.join() === 'situacao_financeira');
  ok('a chave vai no cabeçalho x-api-key', enviados[0].headers['x-api-key'] === 'sk-ant-DE-MENTIRA');
  ok('com o cabeçalho de uso no navegador',
    enviados[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  ok('e o endereço é o da Anthropic', /api\.anthropic\.com/.test(enviados[0].url));

  // ----------------------------------------------------------------- DeepSeek
  console.log('\n=== A mesma conversa pela DeepSeek ===');
  IA.cfg.provedor = 'deepseek';
  IA.cfg.chaves.deepseek = 'sk-DE-MENTIRA';

  enviados = fingirAPI([
    {
      conferir: c => {
        ok('a instrução vira a 1ª mensagem', c.messages[0].role === 'system');
        ok('sem campo system solto', c.system === undefined);
        ok('e a ferramenta vem embrulhada', (c.tools || [])[0].function.name === 'situacao_financeira');
      },
      responde: { choices: [{ message: {
        role: 'assistant', content: 'deixa eu olhar',
        tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'situacao_financeira', arguments: '{}' } }],
      } }] },
    },
    {
      conferir: c => {
        const ultima = c.messages[c.messages.length - 1];
        ok('o resultado volta com papel tool', ultima.role === 'tool');
        ok('  amarrado ao tool_call_id', ultima.tool_call_id === 'call_9');
        ok('  com o número vindo do app', /em_conta/.test(ultima.content));
        /* A mensagem do assistente PRECISA estar antes do resultado, com os
           tool_calls intactos — a API recusa um `role:'tool'` órfão. */
        const anterior = c.messages[c.messages.length - 2];
        ok('  precedido pela fala do assistente', anterior.role === 'assistant');
        ok('  com os tool_calls preservados', (anterior.tool_calls || []).length === 1);
      },
      responde: { choices: [{ message: { role: 'assistant', content: 'Você tem R$ 0,00 em conta.' } }] },
    },
  ]);

  r = await IA.perguntar([{ role: 'user', content: 'como estou?' }]);
  ok('a conversa fecha em duas voltas', enviados.length === 2, `voltas: ${enviados.length}`);
  ok('devolve a resposta final', r.texto === 'Você tem R$ 0,00 em conta.');
  ok('e registra o que consultou', r.consultou.join() === 'situacao_financeira');
  ok('a chave vai como Bearer', enviados[0].headers.Authorization === 'Bearer sk-DE-MENTIRA');
  ok('e o endereço é o da DeepSeek', /api\.deepseek\.com/.test(enviados[0].url));

  // ------------------------------------------------- o teste da configuração
  console.log('\n=== "Testar e salvar" prova o que promete ===');
  /* Um modelo que responde bonito mas ignora ferramentas deixaria o assistente
     inventando números. É o pior defeito possível aqui, e o mais difícil de
     perceber — por isso o teste da tela recusa. */
  fingirAPI([{ responde: { choices: [{ message: { role: 'assistant', content: 'Seu saldo é ótimo!' } }] } }]);
  let recusou = '';
  try { await IA.testar(); } catch (e) { recusou = e.message; }
  ok('modelo que não chama ferramenta é recusado', /não chamou a ferramenta/.test(recusou));
  ok('  e a recusa diz o que fazer', /Escolha outro modelo/.test(recusou), '');

  fingirAPI([{ responde: { choices: [{ message: {
    role: 'assistant',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'saldo_de_teste', arguments: '{}' } }],
  } }] } }]);
  ok('modelo que chama é aceito', (await IA.testar()) === true);

  // ------------------------------------------------------ erros que importam
  console.log('\n=== Os erros viram frase de gente ===');
  IA.cfg.provedor = 'deepseek';
  ok('chave recusada aponta o console certo',
    /platform\.deepseek\.com/.test(IA.explicar(401, '{"error":{"type":"authentication_error"}}')));
  IA.cfg.provedor = 'anthropic';
  ok('e na Anthropic aponta o dela',
    /console\.anthropic\.com/.test(IA.explicar(401, '{"error":{"type":"authentication_error"}}')));
  ok('sem crédito é dito sem jargão',
    /sem crédito/.test(IA.explicar(402, '{"error":{"message":"Insufficient Balance"}}')));
  ok('excesso de perguntas explica a espera',
    /Espere um instante/.test(IA.explicar(429, '{}')));

  console.log(falhas ? `\n❌ ${falhas} falharam` : '\n✅ os dois provedores conversam de ponta a ponta');
  process.exit(falhas ? 1 : 0);
})();
