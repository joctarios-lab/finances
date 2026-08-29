/* DOMI — a função que fala com o Claude.

   ============================================================================
   POR QUE ESTA FUNÇÃO EXISTE

   Para a chave da Anthropic nunca chegar ao navegador. O app monta a pergunta
   e as ferramentas; esta função acrescenta a chave (que vive nos secrets do
   Supabase) e repassa para a API. Quem abrir o DevTools do celular vê a
   pergunta — nunca o segredo.

   Ela também é o ponto onde o gasto se controla: só quem está autenticado na
   família chama, o modelo é fixo aqui e não escolhido pelo cliente, e há um
   teto de tamanho por requisição.

   PUBLICAR:
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
     supabase functions deploy assistente

   Note que NÃO leva `--no-verify-jwt`: ao contrário da função `notify`, que o
   pg_cron chama sem usuário, esta exige o JWT de quem está perguntando.
   ============================================================================ */

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';

/* O modelo é decidido AQUI, não pelo cliente. Se viesse no corpo, qualquer um
   com o app poderia pedir o modelo mais caro em toda pergunta — e quem paga a
   conta é quem publicou a função. */
const MODELO = 'claude-opus-5';

/* Teto de tokens da resposta. Respostas aqui são curtas por instrução do
   sistema; 2000 dá folga larga para uma tabela de projeção sem deixar uma
   resposta desgovernada custar caro. */
const MAX_TOKENS = 2000;

/* Teto do corpo que o app manda. Um histórico corrompido ou um cliente
   adulterado não pode empurrar megabytes para dentro da API. */
const MAX_CORPO = 200_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const erro = (status: number, msg: string) =>
  new Response(JSON.stringify({ erro: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return erro(405, 'Método não permitido.');

  const chave = Deno.env.get('ANTHROPIC_API_KEY');
  if (!chave) return erro(500, 'A função está sem a chave da Anthropic. Rode: supabase secrets set ANTHROPIC_API_KEY=...');

  /* QUEM ESTÁ CHAMANDO. O Supabase já valida o JWT antes de nos entregar a
     requisição (a função é publicada SEM --no-verify-jwt), mas conferimos a
     presença do cabeçalho para devolver uma mensagem que o app sabe explicar,
     em vez de um 401 cru da plataforma. */
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return erro(401, 'Entre na sua conta antes de usar o assistente.');

  const bruto = await req.text();
  if (bruto.length > MAX_CORPO) return erro(413, 'A conversa ficou grande demais. Comece uma nova.');

  let corpo: { system?: string; messages?: unknown[]; tools?: unknown[] };
  try { corpo = JSON.parse(bruto); }
  catch { return erro(400, 'Requisição malformada.'); }

  if (!Array.isArray(corpo.messages) || !corpo.messages.length) {
    return erro(400, 'Nenhuma pergunta foi enviada.');
  }

  /* O que sobe para a Anthropic é montado AQUI, campo a campo. Repassar o corpo
     inteiro do cliente deixaria ele escolher modelo, teto de tokens e qualquer
     parâmetro futuro — e a conta é de quem publicou a função. */
  const pedido = {
    model: MODELO,
    max_tokens: MAX_TOKENS,
    /* Pensamento adaptativo: as perguntas aqui variam de "qual meu saldo" a
       "o que acontece se eu cortar 300 por mês durante um ano". O modelo decide
       quanto pensar em cada uma. */
    thinking: { type: 'adaptive' },
    system: typeof corpo.system === 'string' ? corpo.system : undefined,
    messages: corpo.messages,
    tools: Array.isArray(corpo.tools) && corpo.tools.length ? corpo.tools : undefined,
  };

  let resposta: Response;
  try {
    resposta = await fetch(ANTHROPIC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(pedido),
    });
  } catch (e) {
    return erro(502, 'Não consegui alcançar o assistente: ' + String(e));
  }

  const texto = await resposta.text();

  if (!resposta.ok) {
    /* O erro da Anthropic vira uma frase que o app sabe mostrar. O corpo cru
       pode conter detalhe de conta e cobrança — não vai para o cliente. */
    let motivo = 'O assistente recusou a requisição.';
    try {
      const j = JSON.parse(texto);
      const tipo = j?.error?.type;
      if (tipo === 'authentication_error') motivo = 'A chave da Anthropic está inválida. Quem publicou a função precisa atualizá-la.';
      else if (tipo === 'permission_error') motivo = 'A chave não tem permissão para este modelo.';
      else if (tipo === 'rate_limit_error') motivo = 'Muitas perguntas em pouco tempo. Espere um instante.';
      else if (tipo === 'invalid_request_error') motivo = 'A pergunta não pôde ser processada. Tente reformular.';
      else if (resposta.status >= 500) motivo = 'O assistente está instável no momento.';
    } catch { /* corpo não-JSON: fica a frase genérica */ }
    console.error('anthropic', resposta.status, texto.slice(0, 500));
    return erro(resposta.status === 401 ? 500 : resposta.status, motivo);
  }

  /* Sucesso: devolve a resposta da API como veio. O app precisa dos blocos
     `content` inteiros — inclusive os `tool_use` — para tocar o laço de
     ferramentas do lado dele, onde os dados moram. */
  return new Response(texto, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
