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
  /* O texto das DUAS voltas entra na resposta: o que se viu na tela é o que
     fica guardado. */
  ok('a resposta final está lá', r.texto.endsWith('Você tem R$ 0,00 em conta.'));
  ok('  e o texto pré-ferramenta também', r.texto.startsWith('deixa eu olhar'));
  ok('  separados por parágrafo', r.texto.includes('\n\ndeixa') === false && /\n\n/.test(r.texto));
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
  /* O texto das DUAS voltas entra na resposta: o que se viu na tela é o que
     fica guardado. */
  ok('a resposta final está lá', r.texto.endsWith('Você tem R$ 0,00 em conta.'));
  ok('  e o texto pré-ferramenta também', r.texto.startsWith('deixa eu olhar'));
  ok('  separados por parágrafo', r.texto.includes('\n\ndeixa') === false && /\n\n/.test(r.texto));
  ok('e registra o que consultou', r.consultou.join() === 'situacao_financeira');
  ok('a chave vai como Bearer', enviados[0].headers.Authorization === 'Bearer sk-DE-MENTIRA');
  ok('e o endereço é o da DeepSeek', /api\.deepseek\.com/.test(enviados[0].url));


  // ------------------------------------------------------------- STREAMING
  console.log('\n=== O texto chegando aos pedaços ===');
  /* Um `fetch` que devolve um corpo em fatias, como a rede faz. As fatias são
     CORTADAS DE PROPÓSITO NO MEIO DOS EVENTOS: é o caso que quebra um leitor
     ingênuo, e o que mais acontece de verdade. */
  function fingirFluxo(texto, conferir) {
    const bytes = new TextEncoder().encode(texto);
    let i = 0;
    global.fetch = async (url, opts) => {
      if (conferir) conferir(JSON.parse(opts.body));
      return {
        ok: true, status: 200,
        body: {
          getReader: () => ({
            read: async () => {
              if (i >= bytes.length) return { done: true };
              // 17 bytes: um número primo qualquer, para cair sempre em lugar torto
              const fim = Math.min(i + 17, bytes.length);
              const pedaco = bytes.slice(i, fim);
              i = fim;
              return { done: false, value: pedaco };
            },
          }),
        },
      };
    };
  }

  const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;

  // ---- Anthropic: blocos por índice, pensamento incluído ----
  IA.cfg.provedor = 'anthropic';
  let pedidoStream = null;
  fingirFluxo(
    ev('message_start', { type: 'message_start' })
    + ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pensando um pouco' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'ASSINATURA' } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Você tem ' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'R$ 10,00.' } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 1 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' } })
    + ev('message_stop', { type: 'message_stop' }),
    c => { pedidoStream = c; });

  const vistos = [];
  let rs = await IA.chamar({ model: 'x', messages: [] }, t => vistos.push(t));
  ok('pede streaming à API', pedidoStream.stream === true);
  ok('o texto chega em pedaços', vistos.length === 2, `pedaços: ${vistos.length}`);
  ok('  e remonta inteiro', rs.texto === 'Você tem R$ 10,00.');
  /* O bloco de pensamento tem de voltar INTACTO, com assinatura: com uso de
     ferramenta a API recusa (400) se ele for remontado diferente. */
  const pensa = rs.cru.find(b => b.type === 'thinking');
  ok('o pensamento é preservado', pensa && pensa.thinking === 'pensando um pouco');
  ok('  com a assinatura', pensa && pensa.signature === 'ASSINATURA');

  // ---- Anthropic: ferramenta com argumentos fatiados ----
  fingirFluxo(
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'situacao_financeira', input: {} } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"mes"' } })
    + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':0}' } })
    + ev('content_block_stop', { type: 'content_block_stop', index: 0 })
    + ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' } }));
  rs = await IA.chamar({ model: 'x', messages: [] }, () => {});
  ok('a ferramenta é reconhecida no fluxo', rs.pedidos[0].name === 'situacao_financeira');
  ok('  com o JSON remontado das fatias', rs.pedidos[0].input.mes === 0);

  // ---- Anthropic: corte e erro no meio ----
  fingirFluxo(ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }));
  ok('corte por tamanho é percebido', (await IA.chamar({}, () => {})).cortada === true);

  fingirFluxo(ev('error', { type: 'error', error: { message: 'sobrecarregado' } }));
  let erroFluxo = '';
  try { await IA.chamar({}, () => {}); } catch (e) { erroFluxo = e.message; }
  /* Erro no MEIO do fluxo chega depois de um HTTP 200: não passa pelo
     tratamento de status. Sem tratá-lo, viraria uma resposta vazia. */
  ok('erro no meio do fluxo vira erro de verdade', /sobrecarregado/.test(erroFluxo));

  // ---- DeepSeek: formato da OpenAI ----
  IA.cfg.provedor = 'deepseek';
  const dado = o => `data: ${JSON.stringify(o)}\n\n`;
  const vistosD = [];
  fingirFluxo(
    dado({ choices: [{ delta: { content: 'Sobram ' } }] })
    + dado({ choices: [{ delta: { content: 'R$ 300,00.' } }] })
    + dado({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    + 'data: [DONE]\n\n');
  rs = await IA.chamar({ model: 'x', messages: [] }, t => vistosD.push(t));
  ok('DeepSeek: o texto chega em pedaços', vistosD.length === 2);
  ok('  e remonta inteiro', rs.texto === 'Sobram R$ 300,00.');
  ok('  a mensagem volta no formato de reenvio', rs.cru.role === 'assistant');

  fingirFluxo(
    dado({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'situacao_financeira', arguments: '{"me' } }] } }] })
    + dado({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 's":0}' } }] } }] })
    + dado({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
  rs = await IA.chamar({ model: 'x', messages: [] }, () => {});
  ok('DeepSeek: ferramenta fatiada é remontada', rs.pedidos[0].name === 'situacao_financeira');
  ok('  com os argumentos colados', rs.pedidos[0].input.mes === 0);
  ok('  e os tool_calls voltam na mensagem', (rs.cru.tool_calls || []).length === 1);

  fingirFluxo(dado({ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] }));
  ok('DeepSeek: corte por tamanho é percebido', (await IA.chamar({}, () => {})).cortada === true);

  /* Sem callback, nada de streaming: é o caminho do teste de chave e de qualquer
     chamada que não tenha onde desenhar o texto. */
  fingirAPI([{ responde: { choices: [{ message: { role: 'assistant', content: 'ok' } }] } }]);
  const semFluxo = await IA.chamar({ model: 'x', messages: [] });
  ok('sem callback, não pede streaming', semFluxo.texto === 'ok');

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
