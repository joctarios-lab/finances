/* DOMI — o assistente financeiro.

   ============================================================================
   O QUE ESTE ARQUIVO É, E O QUE ELE DELIBERADAMENTE NÃO FAZ
   ============================================================================

   Ele NÃO manda o banco para lugar nenhum. O modelo recebe uma lista de
   FERRAMENTAS — perguntas que ele pode fazer ao app — e o app responde com o
   número já calculado pelas mesmas funções que desenham as telas. Três razões,
   nesta ordem:

     1. PRIVACIDADE. Sai da máquina o agregado que a pergunta exigiu, não o
        extrato. "Gastou 486 em Alimentação" em vez de "Mercado São João, 12/08".
     2. EXATIDÃO. A conta é do js/db.js, que já é a fonte da verdade do app. Um
        modelo somando parcelas de fatura à mão erra, e erra de um jeito
        plausível — o pior tipo de erro num app de dinheiro.
     3. CUSTO. Um extrato inteiro em toda pergunta é caro e desnecessário.

   O QUE SAI DAQUI depende do que a pessoa autorizou em Configurações. Cada
   ferramenta declara a permissão que a habilita, e uma ferramenta sem permissão
   NÃO É NEM OFERECIDA ao modelo: ele não sabe que ela existe, então não pede.

   A CHAVE É DE QUEM PERGUNTA. Cada pessoa escolhe o provedor — Claude, da
   Anthropic, ou DeepSeek — cola a própria chave nas configurações, e a chamada
   vai direto do navegador para a API, sem servidor no meio. Assim quem usa paga
   o próprio uso, e o assistente não obriga um app local-first a depender de
   backend publicado.

   O laço de conversa é neutro: cada provedor traduz na borda (ver PROVEDORES).

   A chave e as conversas ficam cifradas com o PIN aqui no aparelho, e sobem
   para o Supabase cifradas de novo — com uma chave derivada da senha do login,
   que o servidor nunca vê. Ver "O COFRE", mais abaixo.
   ============================================================================ */
'use strict';

const IA = {
  cfg: null,

  /* ---------- Configuração ----------

     ONDE ELA MORA. Dentro de `DB.data.meta`, e não no localStorage solto. Três
     consequências, todas necessárias por causa da chave de API:

       1. fica CIFRADA com o PIN, junto do resto — chave em texto claro no
          localStorage seria o furo mais óbvio deste app;
       2. está fora de STORES, e sync.js só olha STORES: a chave NÃO vai junto
          com os dados da família. Ela é de quem a comprou;
       3. some junto com tudo no "apagar dados deste aparelho" — e é justamente
          por isso que existe o cofre na nuvem, mais abaixo.

     Tudo começa desligado. Sem ligar, o app é exatamente o de antes: o botão de
     conversa não aparece em lugar nenhum. */
  padrao() {
    return {
      ligado: false,
      provedor: 'anthropic',
      /* Chave e modelo POR PROVEDOR. Um campo só faria trocar de provedor
         apagar a chave do outro — e quem experimenta os dois teria de ir buscar
         a chave no console de novo a cada troca. */
      chaves: { anthropic: '', deepseek: '' },
      modelos: { anthropic: 'claude-opus-5', deepseek: 'deepseek-v4-pro' },
      // O que o assistente pode consultar. Cada chave liga um grupo de ferramentas.
      ver: {
        situacao: false,     // saldo, disponível, comprometido, guardado
        categorias: false,   // quanto foi para cada envelope
        previsao: false,     // projeção do mês e dos próximos
        cartoes: false,      // faturas, limite, vencimento
        metas: false,        // metas, reserva e ritmo de aporte
        lancamentos: false,  // a lista, com descrição — o dado mais sensível
        criancas: false,     // saldo e movimento do cofrinho
      },
    };
  },

  load() {
    const salvo = (DB.data && DB.data.meta && DB.data.meta.ia) || null;
    const p = this.padrao();
    this.cfg = { ...p, ...(salvo || {}) };
    this.cfg.ver = { ...p.ver, ...(this.cfg.ver || {}) };
    this.cfg.chaves = { ...p.chaves, ...(this.cfg.chaves || {}) };
    this.cfg.modelos = { ...p.modelos, ...(this.cfg.modelos || {}) };

    /* Configuração da v158, de quando só existia a Anthropic: `chave` e `modelo`
       soltos. Sobem para o formato novo em vez de serem descartados — quem já
       tinha colado a chave não pode ser obrigado a colá-la de novo. */
    if (this.cfg.chave) { this.cfg.chaves.anthropic = this.cfg.chave; delete this.cfg.chave; }
    if (this.cfg.modelo) { this.cfg.modelos.anthropic = this.cfg.modelo; delete this.cfg.modelo; }

    if (!this.PROVEDORES[this.cfg.provedor]) this.cfg.provedor = 'anthropic';
    return this.cfg;
  },
  save() {
    if (!DB.data) return;
    DB.data.meta = DB.data.meta || {};
    DB.data.meta.ia = this.cfg;
    DB.save();
    // Sobe cifrado, se houver nuvem. Não é o caminho crítico: falhar aqui não
    // pode derrubar o "salvar" que a pessoa acabou de pedir.
    this.nuvemSalvarCfg().catch(() => {});
  },

  /* O assistente existe quando a pessoa ligou E há chave para o provedor
     escolhido. Sem chave o botão não aparece, em vez de aparecer e falhar no
     primeiro toque.

     Note que NÃO exige nuvem: a chamada vai direto do navegador para a API, e o
     app segue funcionando sem Supabase nenhum — como todo o resto dele. */
  disponivel() {
    return !!(this.cfg && this.cfg.ligado && this.chaveAtual());
  },
  algoAutorizado() {
    return !!(this.cfg && Object.values(this.cfg.ver).some(Boolean));
  },

  /* ==========================================================================
     OS DOIS PROVEDORES

     O app fala com a Anthropic ou com a DeepSeek, à escolha de quem usa. As
     duas cobram por token na conta de quem configurou, e as duas aceitam
     chamada direta do navegador — verificado no preflight: a Anthropic devolve
     `access-control-allow-origin: *` e admite o cabeçalho
     `anthropic-dangerous-direct-browser-access`; a DeepSeek ecoa a origem do
     app e libera `authorization`.

     ONDE ELAS DIFEREM, e por isso este bloco existe:

       • a instrução do sistema é campo próprio na Anthropic, e uma mensagem
         `role:'system'` na DeepSeek (que segue o formato da OpenAI);
       • a ferramenta é `{name, description, input_schema}` lá, e
         `{type:'function', function:{name, description, parameters}}` cá;
       • o pedido de ferramenta volta em blocos `content[]` lá, e em
         `message.tool_calls[]` cá — com os argumentos em JSON já serializado;
       • o resultado volta numa ÚNICA mensagem de usuário lá, e em UMA MENSAGEM
         `role:'tool'` POR PEDIDO cá.

     O laço de conversa (`perguntar`) não sabe nada disso. Ele fala a forma
     neutra `{ texto, pedidos:[{id,name,input}] }`, e cada adaptador traduz na
     borda. Foi assim que o segundo provedor coube sem reescrever o laço — e é
     assim que um terceiro caberá. */
  PROVEDORES: {
    anthropic: {
      nome: 'Claude',
      empresa: 'Anthropic',
      console: 'console.anthropic.com',
      caminhoDaChave: 'API Keys',
      exemplo: 'sk-ant-...',
      url: 'https://api.anthropic.com/v1/messages',

      /* Preço por milhão de tokens, em dólar. Fica no rótulo porque quem paga é
         quem escolhe — e para escolher precisa do número, não de adjetivos. */
      modelos: [
        /* `maxSaida` é o máximo de tokens de saída que CADA modelo aceita, e vai
           como `max_tokens` — que aqui é obrigatório, não dá para omitir. Não há
           desvantagem em pedir o máximo: a Anthropic cobra pelo que sai e o
           limite por minuto conta o que saiu, não o teto pedido.

           `pensa` existe porque o Haiku 4.5 é da geração 4.5, e essa geração
           RECUSA `thinking: {type:'adaptive'}` com erro 400. Mandar adaptativo
           para ele deixaria o modelo mais barato da lista impossível de usar. */
        { id: 'claude-opus-5', nome: 'Opus 5', sub: 'o mais capaz — raciocina melhor sobre cenários', entrada: 5, saida: 25, maxSaida: 128000, pensa: 'adaptativo' },
        { id: 'claude-sonnet-5', nome: 'Sonnet 5', sub: 'equilibrado — bem mais barato que o Opus', entrada: 2, saida: 10, maxSaida: 128000, pensa: 'adaptativo' },
        { id: 'claude-haiku-4-5', nome: 'Haiku 4.5', sub: 'o mais barato e rápido — para perguntas diretas', entrada: 1, saida: 5, maxSaida: 64000, pensa: 'nenhum' },
      ],

      cabecalhos(chave) {
        return {
          'Content-Type': 'application/json',
          'x-api-key': chave,
          'anthropic-version': '2023-06-01',
          /* O nome do cabeçalho avisa do risco real: chave no navegador é
             legível por quem tem acesso àquele navegador. Aceitável aqui porque
             a chave é a DA PRÓPRIA PESSOA, no aparelho DELA. Inaceitável seria
             embutir uma chave no app e distribuí-la — não é o caso. */
          'anthropic-dangerous-direct-browser-access': 'true',
        };
      },

      /* maxTokens null significa SEM TETO: aqui vira o máximo do modelo, porque
         a Anthropic exige o campo. Um número explícito só vem do teste de chave,
         que quer a menor resposta possível. */
      corpo(modelo, instrucao, mensagens, ferramentas, maxTokens) {
        const m = this.modelos.find(x => x.id === modelo) || this.modelos[0];
        return {
          model: modelo,
          max_tokens: maxTokens || m.maxSaida,
          /* As perguntas aqui vão de "qual meu saldo" a "o que muda se eu cortar
             300 por mês durante um ano". Onde há adaptativo, o modelo decide
             quanto pensar em cada uma; onde não há, o campo nem vai — mandá-lo
             a um modelo que não o aceita devolve 400. */
          ...(m.pensa === 'adaptativo' ? { thinking: { type: 'adaptive' } } : {}),
          system: instrucao,
          messages: mensagens,
          tools: ferramentas.length
            ? ferramentas.map(f => ({ name: f.name, description: f.description, input_schema: f.input_schema }))
            : undefined,
        };
      },

      ler(json) {
        const blocos = json.content || [];
        return {
          texto: blocos.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
          pedidos: blocos.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
          cru: blocos,
          cortada: json.stop_reason === 'max_tokens',
        };
      },

      /* Os eventos vêm por BLOCO e por ÍNDICE: um `content_block_start` abre o
         bloco, vários `content_block_delta` o preenchem. Recompor a partir do
         start (e não montar um bloco do zero) é o que devolve a mensagem
         idêntica à original — inclusive os blocos de pensamento, que a API exige
         de volta intactos, com assinatura, quando há uso de ferramenta. */
      async lerFluxo(ia, res, aoTexto) {
        const blocos = [];
        const parciais = {};        // JSON de argumento de ferramenta, ainda em pedaços
        let cortada = false;

        await ia.lerSSE(res, ev => {
          if (ev.type === 'content_block_start') {
            blocos[ev.index] = JSON.parse(JSON.stringify(ev.content_block));
            if (ev.content_block.type === 'tool_use') parciais[ev.index] = '';
            return;
          }
          if (ev.type === 'content_block_delta') {
            const b = blocos[ev.index];
            if (!b) return;
            const d = ev.delta || {};
            if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; if (aoTexto) aoTexto(d.text); }
            else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
            else if (d.type === 'signature_delta') b.signature = d.signature;
            else if (d.type === 'input_json_delta') parciais[ev.index] += d.partial_json || '';
            return;
          }
          if (ev.type === 'content_block_stop') {
            const b = blocos[ev.index];
            if (b && b.type === 'tool_use') {
              try { b.input = JSON.parse(parciais[ev.index] || '{}'); } catch (_) { b.input = {}; }
            }
            return;
          }
          if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason === 'max_tokens') cortada = true;
          /* Erro NO MEIO do fluxo: o HTTP já respondeu 200, então não passa pelo
             tratamento de status. Sem isto, a falha viraria uma resposta vazia. */
          if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'O assistente interrompeu a resposta.');
        });

        const cru = blocos.filter(Boolean);
        return {
          texto: cru.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
          pedidos: cru.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
          cru,
          cortada,
        };
      },

      msgAssistente(cru) { return { role: 'assistant', content: cru }; },

      /* Todos os resultados numa ÚNICA mensagem. Separá-los ensina o modelo a
         parar de pedir ferramentas em paralelo, e aí cada pergunta vira várias
         idas e vindas. */
      msgsResultado(pares) {
        return [{
          role: 'user',
          content: pares.map(p => ({ type: 'tool_result', tool_use_id: p.id, content: p.saida })),
        }];
      },
    },

    deepseek: {
      nome: 'DeepSeek',
      empresa: 'DeepSeek',
      console: 'platform.deepseek.com',
      caminhoDaChave: 'API Keys',
      exemplo: 'sk-...',
      url: 'https://api.deepseek.com/chat/completions',

      /* Preço de PICO por milhão de tokens (entrada sem cache). Fora do pico cai
         pela metade, mas o rótulo mostra o caro: ninguém deve ser surpreendido
         para cima. Só os modelos de texto entram — o `vision-exp` é
         experimental e o assistente não manda imagem nenhuma. */
      modelos: [
        /* Sem `maxSaida`: aqui o max_tokens é opcional e simplesmente não é
           enviado — o modelo responde até acabar de responder. */
        { id: 'deepseek-v4-pro', nome: 'V4 Pro', sub: 'o mais capaz da DeepSeek — o indicado para cenários', entrada: 1.32, saida: 3.96 },
        { id: 'deepseek-v4-flash', nome: 'V4 Flash', sub: 'bem mais barato e rápido — para perguntas diretas', entrada: 0.44, saida: 1.32 },
      ],

      cabecalhos(chave) {
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` };
      },

      /* maxTokens null significa SEM TETO — e aqui isso é literal: o campo sai
         do corpo, porque na API da DeepSeek ele é opcional. */
      corpo(modelo, instrucao, mensagens, ferramentas, maxTokens) {
        return {
          model: modelo,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          // Aqui a instrução é a primeira mensagem, não um campo à parte.
          messages: [{ role: 'system', content: instrucao }].concat(mensagens),
          tools: ferramentas.length
            ? ferramentas.map(f => ({
              type: 'function',
              function: { name: f.name, description: f.description, parameters: f.input_schema },
            }))
            : undefined,
        };
      },

      ler(json) {
        const msg = ((json.choices || [])[0] || {}).message || {};
        const chamadas = msg.tool_calls || [];
        return {
          cortada: ((json.choices || [])[0] || {}).finish_reason === 'length',
          texto: (msg.content || '').trim(),
          pedidos: chamadas.map(c => ({
            id: c.id,
            name: c.function.name,
            /* Os argumentos vêm como STRING de JSON. Um modelo pode mandar algo
               que não fecha; nesse caso o objeto vazio é melhor que estourar —
               a ferramenta roda com os padrões dela. */
            input: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch (_) { return {}; } })(),
          })),
          cru: msg,
        };
      },

      /* Formato da OpenAI: um `delta` por evento, e as chamadas de ferramenta
         chegam fatiadas POR ÍNDICE — o nome vem no primeiro pedaço, os
         argumentos em vários, como texto de JSON que só fecha no fim. */
      async lerFluxo(ia, res, aoTexto) {
        let texto = '';
        const chamadas = [];
        let cortada = false;

        await ia.lerSSE(res, ev => {
          if (ev.error) throw new Error(ev.error.message || 'O assistente interrompeu a resposta.');
          const esc = (ev.choices || [])[0];
          if (!esc) return;
          const d = esc.delta || {};
          if (d.content) { texto += d.content; if (aoTexto) aoTexto(d.content); }
          for (const tc of d.tool_calls || []) {
            const i = tc.index || 0;
            const alvo = chamadas[i] || (chamadas[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
            if (tc.id) alvo.id = tc.id;
            if (tc.function && tc.function.name) alvo.function.name = tc.function.name;
            if (tc.function && tc.function.arguments) alvo.function.arguments += tc.function.arguments;
          }
          if (esc.finish_reason === 'length') cortada = true;
        });

        const usadas = chamadas.filter(Boolean);
        /* A mensagem do assistente volta para a conversa no formato que a API
           espera receber de novo — com os tool_calls inteiros, senão o
           `role:'tool'` seguinte fica órfão e a chamada é recusada. */
        const cru = { role: 'assistant', content: texto };
        if (usadas.length) cru.tool_calls = usadas;

        return {
          texto: texto.trim(),
          pedidos: usadas.map(c => ({
            id: c.id,
            name: c.function.name,
            input: (() => { try { return JSON.parse(c.function.arguments || '{}'); } catch (_) { return {}; } })(),
          })),
          cru,
          cortada,
        };
      },

      msgAssistente(cru) { return cru; },

      // Uma mensagem por resultado, cada uma amarrada ao seu tool_call_id.
      msgsResultado(pares) {
        return pares.map(p => ({ role: 'tool', tool_call_id: p.id, content: p.saida }));
      },
    },
  },

  /* O provedor escolhido, já resolvido. Nunca devolve indefinido: uma
     configuração antiga ou estragada cai na Anthropic, que era a única antes. */
  prov() {
    return this.PROVEDORES[(this.cfg && this.cfg.provedor) || 'anthropic'] || this.PROVEDORES.anthropic;
  },
  chaveAtual() {
    return ((this.cfg && this.cfg.chaves) || {})[(this.cfg && this.cfg.provedor) || 'anthropic'] || '';
  },
  modeloAtual() {
    const p = (this.cfg && this.cfg.provedor) || 'anthropic';
    return ((this.cfg && this.cfg.modelos) || {})[p] || this.PROVEDORES[p].modelos[0].id;
  },

  /* ==========================================================================
     STREAMING

     POR QUE. Sem teto de resposta, uma pergunta de cenário pode levar bastante
     tempo — e sem streaming a tela fica muda o tempo todo, com três pontinhos e
     nenhuma prova de que algo está acontecendo. Pior: a conexão fica aberta e
     ociosa, que é justamente o que redes móveis derrubam. Streaming resolve os
     dois: o texto aparece enquanto é escrito, e a conexão nunca fica ociosa.

     COMO. As duas APIs falam SSE (server-sent events) — a mesma mecânica de
     transporte, formatos de evento diferentes. `lerSSE` cuida do transporte:
     lê o corpo em pedaços, remonta as linhas e entrega um evento por vez. Cada
     provedor traduz seus eventos na mesma forma neutra que `ler()` produz, e o
     laço de conversa não percebe diferença nenhuma.

     O DETALHE QUE NÃO PODE ERRAR: reconstruir a mensagem do assistente EXATAMENTE
     como veio. Com uso de ferramenta, a Anthropic exige que os blocos de
     pensamento voltem intactos, com assinatura e tudo — remontá-los errado
     devolve 400. Por isso cada bloco é recomposto pelo índice, a partir do
     `content_block_start`, e não inventado a partir do texto. */
  async lerSSE(res, aoEvento) {
    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      /* Um evento SSE termina em linha em branco. O resto fica no buffer: um
         pedaço da rede quase nunca cai exatamente no fim de um evento. */
      let corte;
      while ((corte = buf.indexOf('\n\n')) >= 0) {
        const bruto = buf.slice(0, corte);
        buf = buf.slice(corte + 2);
        for (const linha of bruto.split('\n')) {
          if (!linha.startsWith('data:')) continue;   // "event:" e ":" (keep-alive) são ignorados
          const dado = linha.slice(5).trim();
          if (!dado || dado === '[DONE]') continue;
          let ev;
          // Só o PARSE é protegido: um erro vindo do tratador tem de subir.
          try { ev = JSON.parse(dado); } catch (_) { continue; }
          aoEvento(ev);
        }
      }
    }
  },

  /* ==========================================================================
     O COFRE — por que a nuvem guarda sem conseguir ler

     A chave da Anthropic e as conversas precisam sobreviver a "apagar os dados
     deste aparelho". Logo, precisam estar na nuvem. Só que:

       • uma chave de API é DINHEIRO. Não tem segundo fator, não tem "confirme
         no aparelho": quem lê o texto gasta o crédito de quem comprou;
       • RLS não protege do dono do projeto. A `service_role` do Supabase ignora
         RLS por definição — em texto claro, o dono leria a chave de todo mundo
         da casa pelo SQL Editor, e o backup automático viraria um depósito de
         credenciais;
       • a conversa é PIOR que a chave. Chave vazada se revoga em dez segundos;
         conversa sobre o dinheiro da família, não.

     Então nada sobe em texto claro. O app deriva uma chave AES-256 da SENHA DO
     LOGIN (que ele nunca guarda — ver Sync.signIn), cifra ali no navegador, e
     sobe só o resultado. O Supabase guarda bytes embaralhados; o dono do projeto
     lê bytes embaralhados; uma service_role vazada leva bytes embaralhados.

     O sal vem do id do usuário, não é sorteado: assim o aparelho novo deriva a
     MESMA chave sem precisar buscar nada antes. Sal não é segredo — precisa ser
     único, e um uuid é.

     O PREÇO, dito na cara: trocar a senha do Supabase invalida o que está
     cifrado com a antiga. Aí é recolar a chave e perder as conversas velhas.
     Foi a troca aceita para que o servidor nunca consiga ler. */
  cofre: null,
  ITER_COFRE: 200000,

  async sal(userId) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('domi-ia:' + userId));
    return KCrypto.b64(h);
  },

  /* Chamado no login, com a senha ainda na mão. A chave derivada fica guardada
     em `meta` — que já está cifrado com o PIN — para o app não precisar da senha
     de novo a cada abertura. */
  async abrirCofre(senha) {
    const uid = typeof Sync !== 'undefined' && Sync.cfg && Sync.cfg.user_id;
    if (!uid || !senha || !DB.data) return null;
    const k = await KCrypto.deriveKey(senha, await this.sal(uid), this.ITER_COFRE, true);
    const bruta = await crypto.subtle.exportKey('raw', k);
    DB.data.meta = DB.data.meta || {};
    DB.data.meta.ia_cofre = KCrypto.b64(bruta);
    DB.save();
    this.cofre = k;
    return k;
  },

  async chaveDoCofre() {
    if (this.cofre) return this.cofre;
    const b = DB.data && DB.data.meta && DB.data.meta.ia_cofre;
    if (!b) return null;
    this.cofre = await crypto.subtle.importKey(
      'raw', KCrypto.unb64(b), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return this.cofre;
  },

  async cifrar(obj) {
    const k = await this.chaveDoCofre();
    if (!k) return null;
    return JSON.stringify(await KCrypto.enc(k, JSON.stringify(obj)));
  },
  /* Decifrar falha por um motivo esperado: a senha do login mudou. Não é erro de
     programa, é o preço documentado acima — devolve null e o app segue. */
  async decifrar(txt) {
    const k = await this.chaveDoCofre();
    if (!k || !txt) return null;
    try { return JSON.parse(await KCrypto.dec(k, JSON.parse(txt))); } catch (_) { return null; }
  },

  /* ---------- A cópia na nuvem ----------
     Escopo de USUÁRIO, não de família: as tabelas filtram por auth.uid(), então
     nem pelo app um membro da casa alcança a linha do outro. Toda função aqui é
     silenciosa quando não há nuvem — o assistente funciona sem ela. */
  temNuvem() {
    /* refresh_token, não access_token: este expira em uma hora, e Sync.rest()
       o renova sozinho antes de cada chamada. Exigir o access_token aqui faria a
       cópia na nuvem parar de subir silenciosamente em toda sessão mais velha
       que uma hora — o pior tipo de falha, a que ninguém percebe. */
    return !!(typeof Sync !== 'undefined' && Sync.loggedIn() && Sync.cfg.user_id);
  },

  async nuvemSalvarCfg() {
    if (!this.temNuvem()) return;
    const dados = await this.cifrar(this.cfg);
    if (!dados) return;
    await Sync.rest('ia_config?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: Sync.cfg.user_id, dados, updated_at: new Date().toISOString() }),
    });
  },

  /* Só sobrescreve o que está no aparelho se a nuvem realmente abriu. Um cofre
     que não decifra (senha trocada) não pode apagar a configuração local. */
  async nuvemPuxarCfg() {
    if (!this.temNuvem()) return false;
    const linhas = await Sync.rest('ia_config?select=dados&limit=1');
    const txt = linhas && linhas[0] && linhas[0].dados;
    const cfg = await this.decifrar(txt);
    if (!cfg) return false;
    this.cfg = { ...this.padrao(), ...cfg, ver: { ...this.padrao().ver, ...(cfg.ver || {}) } };
    DB.data.meta = DB.data.meta || {};
    DB.data.meta.ia = this.cfg;
    DB.save();
    return true;
  },

  async nuvemSalvarChat(id) {
    if (!this.temNuvem()) return;
    const c = this.conversa(id);
    if (!c) return;
    const dados = await this.cifrar(c);
    if (!dados) return;
    await Sync.rest('ia_chats?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: c.id, user_id: Sync.cfg.user_id, dados, tocada: c.tocada || Date.now() }),
    });
  },

  async nuvemApagarChat(id) {
    if (!this.temNuvem()) return;
    await Sync.rest(`ia_chats?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  /* Traz o que está na nuvem e junta com o que está aqui, ganhando a versão mais
     recente de cada conversa. É isto que devolve o histórico depois de apagar o
     aparelho — e o que alinha dois aparelhos da mesma pessoa. */
  async nuvemPuxarChats() {
    if (!this.temNuvem() || !DB.data) return 0;
    const linhas = await Sync.rest('ia_chats?select=id,dados,tocada&order=tocada.desc&limit=' + this.MAX_CONVERSAS);
    if (!linhas || !linhas.length) return 0;
    const locais = DB.data.ia_chats || (DB.data.ia_chats = []);
    let novas = 0;
    for (const l of linhas) {
      const c = await this.decifrar(l.dados);
      if (!c || !c.id) continue;
      const i = locais.findIndex(x => x.id === c.id);
      if (i < 0) { locais.push(c); novas++; }
      else if ((c.tocada || 0) > (locais[i].tocada || 0)) { locais[i] = c; novas++; }
    }
    if (novas) { this.podar(); DB.save(); }
    return novas;
  },

  /* ---------- Liberar o cofre neste aparelho ----------

     O DEFEITO QUE ISTO CONSERTA. A chave do cofre nasce da senha do login, e a
     senha só passa pelo app em `Sync.signIn`. Só que ninguém faz login toda
     hora: a sessão se renova pelo refresh token, e `signIn` pode não rodar
     durante meses. Resultado, num aparelho que já estava logado quando o
     assistente foi configurado:

       • `cifrar()` devolvia null, e `nuvemSalvarCfg()` retornava calado —
         NUNCA SUBIU NADA;
       • `sincronizar()` retornava antes de puxar — nunca desceu nada;
       • e a tela dizia "Cópia na nuvem ligada", que era falso.

     A saída não é guardar a senha (seria destruir a própria garantia: o servidor
     não pode conseguir ler). É PEDIR a senha quando ela faz falta, uma vez por
     aparelho.

     E PEDIR CONFERINDO. Derivar chave de qualquer texto funciona — inclusive da
     senha errada, que produziria um cofre silenciosamente inútil e, pior,
     sobrescreveria a cópia boa na nuvem com dados cifrados por uma chave que
     ninguém mais tem. Por isso a senha vai primeiro ao Supabase, via signIn: se
     o servidor recusar, nada aqui é tocado. */
  cofreAberto() {
    return !!(DB.data && DB.data.meta && DB.data.meta.ia_cofre);
  },

  /* Estado da cópia na nuvem, para a tela poder dizer a verdade em vez de
     supor. Cada valor é uma frase diferente na configuração. */
  estadoDaNuvem() {
    if (typeof Sync === 'undefined' || !Sync.loggedIn()) return 'sem-nuvem';
    if (!this.cofreAberto()) return 'falta-liberar';
    return 'ligada';
  },

  /* Libera e ACERTA OS DOIS LADOS na mesma ida: primeiro traz o que existe lá
     (pode ser que outro aparelho já tenha subido a chave), depois sobe o que só
     existe aqui. Nessa ordem, porque o que está na nuvem é o que sobreviveu a
     "apagar os dados deste aparelho" — tem precedência sobre um cofre recém-
     aberto que ainda não sabe de nada. */
  async liberarCofre(email, senha) {
    if (!senha) throw new Error('Digite a senha do seu login.');
    if (typeof Sync === 'undefined' || !Sync.cfg || !Sync.cfg.url) {
      throw new Error('A sincronização não está configurada neste aparelho.');
    }
    // Confere a senha CONTRA O SERVIDOR antes de derivar qualquer coisa.
    await Sync.signIn(email || Sync.cfg.user_email, senha);
    if (!this.cofreAberto()) throw new Error('Não consegui preparar o cofre neste aparelho.');

    const achou = await this.nuvemPuxarCfg().catch(() => false);
    const chats = await this.nuvemPuxarChats().catch(() => 0);

    /* Sobe o que temos. Se a nuvem estava vazia — o caso de quem configurou num
       aparelho que nunca chegou a subir —, é isto que finalmente a preenche. */
    await this.nuvemSalvarCfg().catch(() => {});
    for (const c of this.conversas()) await this.nuvemSalvarChat(c.id).catch(() => {});

    return { veioDaNuvem: !!achou, conversas: chats };
  },

  /* Uma vez por abertura, depois que o PIN já liberou o DB e o login já existe. */
  async sincronizar() {
    if (!this.temNuvem()) return;
    if (!(await this.chaveDoCofre())) return;
    await this.nuvemPuxarCfg().catch(() => {});
    await this.nuvemPuxarChats().catch(() => {});
  },

  /* ==========================================================================
     AS FERRAMENTAS

     Cada uma é uma pergunta que o modelo pode fazer, e `roda` responde com o
     número pronto. `permissao` é a chave de `cfg.ver` que a habilita — sem ela,
     a ferramenta não entra na lista enviada.

     `mes` é sempre um deslocamento em relação ao ciclo atual: 0 é este mês, -1 o
     passado, +1 o que vem. É a mesma noção de `state.monthOffset`, e evita o
     modelo tentar adivinhar formato de data.
     ========================================================================== */
  ferramentas() {
    const periodo = m => DB.monthPeriod(new Date(), Number(m) || 0);
    const dinheiro = v => Number((Number(v) || 0).toFixed(2));

    return [
      {
        permissao: 'situacao',
        name: 'situacao_financeira',
        description: 'A fotografia de agora: quanto existe em conta, quanto já está comprometido com contas a pagar, quanto está guardado em metas e reserva, e quanto sobra livre. Use como ponto de partida de quase toda pergunta sobre "como estou".',
        input_schema: { type: 'object', properties: {}, required: [] },
        roda: () => ({
          em_conta: dinheiro(DB.accountsTotal()),
          comprometido: dinheiro(DB.committed()),
          guardado: dinheiro(DB.guardado()),
          disponivel_para_gastar: dinheiro(DB.available()),
          livre_em_caixa: dinheiro(DB.caixaLivre()),
          custo_de_vida_mensal: dinheiro(DB.custoDeVidaMensal()),
          patrimonio: dinheiro(DB.patrimonio().total ?? DB.patrimonio()),
        }),
      },
      {
        permissao: 'situacao',
        name: 'resumo_do_mes',
        description: 'Os números de um mês: quanto entrou, quanto saiu, quanto foi orçado, quantos dias já passaram do ciclo. Serve para comparar meses e para responder "como foi julho".',
        input_schema: {
          type: 'object',
          properties: { mes: { type: 'integer', description: '0 = mês atual, -1 = mês passado, 1 = próximo' } },
          required: [],
        },
        roda: ({ mes = 0 }) => {
          const p = periodo(mes);
          const s = DB.statsFor(p);
          return {
            mes: p.label,
            entrou: dinheiro(DB.realizedIncome(p)),
            renda_do_mes: dinheiro(DB.rendaDoMes(p)),
            saiu: dinheiro(s.spent),
            orcado: dinheiro(DB.budgetTotal(p)),
            dias_passados: s.elapsedDays,
            dias_do_ciclo: s.totalDays,
          };
        },
      },
      {
        permissao: 'categorias',
        name: 'gastos_por_categoria',
        description: 'Quanto foi para cada envelope num mês, do maior para o menor, com o orçamento de cada um. Responde "onde foi meu dinheiro" sem expor lançamento nenhum.',
        input_schema: {
          type: 'object',
          properties: { mes: { type: 'integer', description: '0 = mês atual, -1 = mês passado' } },
          required: [],
        },
        roda: ({ mes = 0 }) => {
          const p = periodo(mes);
          const gasto = DB.spentByCategory(p);
          return Object.entries(gasto)
            .map(([id, v]) => ({
              categoria: id === '_sem' ? 'Sem categoria' : DB.categoryPath(id),
              gasto: dinheiro(v),
              orcado: dinheiro(DB.budgetOf(id, p)),
            }))
            .filter(l => l.gasto > 0)
            .sort((a, b) => b.gasto - a.gasto);
        },
      },
      {
        permissao: 'previsao',
        name: 'projecao_do_mes',
        description: 'Onde o mês fecha se o ritmo continuar: o que já está lançado, o que ainda vem de contas fixas e faturas, o gasto variável estimado e o saldo previsto para o fim do ciclo.',
        input_schema: {
          type: 'object',
          properties: { mes: { type: 'integer', description: '0 = mês atual' } },
          required: [],
        },
        roda: ({ mes = 0 }) => {
          const p = periodo(mes);
          const prev = DB.previsaoDoMes(p);
          const proj = DB.projecaoDeGasto(p);
          return {
            mes: p.label,
            projecao_de_gasto: dinheiro(proj.total ?? proj),
            variavel_estimado: dinheiro(DB.variavelProjetado(p)),
            saldo_previsto_no_fim: dinheiro(prev.saldoFim ?? prev.livreAoFim ?? 0),
            itens_ja_conhecidos: (prev.itens || []).length,
          };
        },
      },
      {
        permissao: 'previsao',
        name: 'proximos_meses',
        description: 'O saldo projetado mês a mês daqui para a frente, com entradas e saídas previstas. Use para perguntas de horizonte: "dá para viajar em dezembro", "quando sobra dinheiro".',
        input_schema: {
          type: 'object',
          properties: { quantos: { type: 'integer', description: 'Quantos meses à frente, de 1 a 12. Padrão 6.' } },
          required: [],
        },
        roda: ({ quantos = 6 }) => {
          const n = Math.min(Math.max(Number(quantos) || 6, 1), 12);
          return (DB.previsaoMeses(n) || []).map(m => ({
            mes: m.label || m.mes,
            entra: dinheiro(m.entra),
            sai: dinheiro(m.sai),
            saldo_no_fim: dinheiro(m.saldo ?? m.saldoFim),
          }));
        },
      },
      {
        permissao: 'previsao',
        name: 'contas_fixas',
        description: 'O que se repete todo mês — aluguel, assinaturas, escola — com valor e periodicidade, e o custo fixo somado. É a base de qualquer simulação de corte.',
        input_schema: { type: 'object', properties: {}, required: [] },
        roda: () => ({
          custo_fixo_mensal: dinheiro(DB.custoFixoMensal()),
          contratos: DB.all('recurrences')
            .filter(r => r.status === 'ativa')
            .map(r => ({
              nome: r.description,
              valor: dinheiro(DB.valorDaRecorrencia(r)),
              periodicidade: r.periodicidade,
              dia: r.dia,
            }))
            .sort((a, b) => b.valor - a.valor),
        }),
      },
      {
        permissao: 'cartoes',
        name: 'cartoes_e_faturas',
        description: 'Cada cartão com a fatura aberta, o quanto do limite já foi usado e as datas de fechamento e vencimento.',
        input_schema: { type: 'object', properties: {}, required: [] },
        roda: () => DB.all('cards').map(c => {
          const invs = DB.invoicesOf(c) || [];
          const aberta = invs.find(i => i.status === 'aberta') || invs[0];
          return {
            cartao: c.name,
            fatura_atual: dinheiro(aberta ? aberta.total : 0),
            situacao: aberta ? aberta.status : 'sem lançamentos',
            fecha_dia: c.closing_day,
            vence_dia: c.due_day,
            limite: dinheiro(c.limit_amount),
          };
        }),
      },
      {
        permissao: 'metas',
        name: 'metas_e_reserva',
        description: 'As metas em andamento com quanto já foi guardado, o alvo, o ritmo de aporte e a previsão de conclusão. Inclui a reserva de emergência em meses de cobertura.',
        input_schema: { type: 'object', properties: {}, required: [] },
        roda: () => ({
          reserva_em_meses: Number((DB.valeDeCaixa() || 0).toFixed(1)),
          metas: DB.all('goals').map(g => {
            const guardado = DB.goalTotal(g.id);
            return {
              meta: g.name,
              guardado: dinheiro(guardado),
              alvo: dinheiro(g.target_amount),
              ritmo_mensal: dinheiro((DB.goalPace(g.id) || {}).mensal ?? DB.goalPace(g.id)),
              e_reserva: DB.isReserveGoal(g),
            };
          }),
        }),
      },
      {
        permissao: 'lancamentos',
        name: 'lancamentos',
        description: 'A lista de lançamentos de um mês, com descrição, data, valor e categoria. É o dado mais detalhado que existe — use só quando a pergunta realmente exigir identificar um gasto específico; para "onde foi o dinheiro", prefira gastos_por_categoria.',
        input_schema: {
          type: 'object',
          properties: {
            mes: { type: 'integer', description: '0 = mês atual, -1 = mês passado' },
            busca: { type: 'string', description: 'Filtra pela descrição, opcional' },
            valor_minimo: { type: 'number', description: 'Só lançamentos acima deste valor, opcional' },
          },
          required: [],
        },
        roda: ({ mes = 0, busca = '', valor_minimo = 0 }) => {
          const p = periodo(mes);
          const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
          const f = norm(busca);
          return DB.txOfPeriod(p)
            .filter(t => !DB.isNeutral(t))
            .filter(t => Math.abs(Number(t.amount) || 0) >= (Number(valor_minimo) || 0))
            .filter(t => !f || norm(t.description).includes(f))
            .map(t => ({
              descricao: t.description,
              data: t.date,
              valor: dinheiro(t.amount),
              tipo: t.type,
              categoria: t.category_id ? DB.categoryPath(t.category_id) : 'Sem categoria',
              situacao: t.status,
            }))
            .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
            // Teto de segurança: um mês com 300 lançamentos estouraria o contexto
            // e custaria caro para responder o que o agregado já responde.
            .slice(0, 80);
        },
      },
      {
        permissao: 'criancas',
        name: 'cofrinho_das_criancas',
        description: 'Quanto cada criança tem no cofrinho, dividido nos potes de gastar, guardar e doar, com a semanada e a meta de cada uma.',
        input_schema: { type: 'object', properties: {}, required: [] },
        roda: () => DB.kids().map(k => {
          const potes = DB.kidPotes(k.id) || {};
          const meta = DB.kidMeta(k.id);
          return {
            crianca: k.name,
            total: dinheiro((potes.gastar || 0) + (potes.guardar || 0) + (potes.doar || 0)),
            gastar: dinheiro(potes.gastar),
            guardar: dinheiro(potes.guardar),
            doar: dinheiro(potes.doar),
            semanada: dinheiro(k.semanada_valor),
            meta: meta ? { nome: meta.name, alvo: dinheiro(meta.target_amount) } : null,
          };
        }),
      },
      {
        permissao: 'previsao',
        name: 'simular_cenario',
        description: 'Simula o efeito de uma mudança no orçamento SEM gravar nada: um gasto novo que passa a se repetir, um corte, uma receita extra. Devolve como fica o disponível e o saldo projetado. Use para "e se eu...".',
        input_schema: {
          type: 'object',
          properties: {
            variacao_mensal: { type: 'number', description: 'Quanto muda por mês. Negativo é gasto novo ou aumento de despesa; positivo é corte de gasto ou receita nova.' },
            meses: { type: 'integer', description: 'Por quantos meses avaliar. Padrão 6.' },
            descricao: { type: 'string', description: 'O que está sendo simulado, para constar na resposta.' },
          },
          required: ['variacao_mensal'],
        },
        /* A simulação é aritmética sobre os números do app, e NÃO grava nada:
           nenhuma escrita no DB, nenhum lançamento. É o que permite responder
           "e se eu cortar a academia" sem efeito colateral. */
        roda: ({ variacao_mensal, meses = 6, descricao = '' }) => {
          const delta = Number(variacao_mensal) || 0;
          const n = Math.min(Math.max(Number(meses) || 6, 1), 24);
          const base = DB.available();
          const custo = DB.custoDeVidaMensal();
          return {
            simulando: descricao || (delta < 0 ? 'gasto novo' : 'sobra nova'),
            variacao_por_mes: dinheiro(delta),
            disponivel_hoje: dinheiro(base),
            efeito_em_meses: Array.from({ length: n }, (_, i) => ({
              daqui_a_meses: i + 1,
              efeito_acumulado: dinheiro(delta * (i + 1)),
            })),
            custo_de_vida_mensal: dinheiro(custo),
            observacao: 'Projeção aritmética sobre os números atuais. Nada foi gravado.',
          };
        },
      },
    ];
  },

  /* As ferramentas que a pessoa autorizou, no formato que a API espera —
     `roda` e `permissao` ficam de fora, são coisa nossa. */
  ferramentasAutorizadas() {
    const ok = (this.cfg && this.cfg.ver) || {};
    return this.ferramentas()
      .filter(f => ok[f.permissao])
      .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  },

  executar(nome, entrada) {
    const f = this.ferramentas().find(x => x.name === nome);
    if (!f) return { erro: `ferramenta desconhecida: ${nome}` };
    const ok = (this.cfg && this.cfg.ver) || {};
    // Cinto e suspensório: mesmo não sendo oferecida, uma ferramenta sem
    // permissão não roda. O modelo pode inventar um nome; o app não obedece.
    if (!ok[f.permissao]) return { erro: 'sem permissão para este dado' };
    try { return f.roda(entrada || {}); }
    catch (e) { return { erro: String(e && e.message || e) }; }
  },

  /* ---------- A instrução do sistema ----------
     Curta de propósito. O que o assistente precisa saber é o que ele NÃO deve
     fazer: inventar número, dar conselho de investimento, e falar como um
     relatório. O resto vem das ferramentas. */
  /* ==========================================================================
     O CONTEXTO — o que o assistente sabe antes de qualquer pergunta

     ISTO VAI EM TODA REQUISIÇÃO. Não porque seja repetido a cada mensagem — não
     é —, mas porque a instrução do sistema viaja junto de cada chamada. É o
     lugar certo para contextualizar: uma cópia por pergunta, e não uma por
     turno de conversa.

     POR QUE EXISTE. Sem isto o modelo recebe números com nomes bonitos e nenhum
     significado. `disponivel_para_gastar` e `livre_em_caixa` são grandezas
     DIFERENTES no DOMI, de propósito (ver DB.available e DB.caixaLivre) — um é
     planejamento, o outro é caixa. Um modelo que não sabe disso chama os dois de
     "saldo", e aí o assistente contradiz a tela que a pessoa está olhando. Esse
     é o pior defeito possível num app de dinheiro: não é errar a conta, é
     ensinar um modelo mental diferente do que o app inteiro sustenta.

     A ORDEM IMPORTA, e não é estética. As camadas vão da mais ESTÁTICA para a
     mais VOLÁTIL. As duas APIs cobram bem mais barato por um prefixo que já
     viram antes, e prefixo só se repete se o começo do texto for idêntico entre
     as chamadas. Colocar a data ou a tela atual no topo invalidaria o cache a
     cada pergunta. */
  contexto() {
    return [
      this.ctxQuemVoceE(),
      this.ctxVocabulario(),
      this.ctxLimites(),
      this.ctxRegras(),
      this.ctxFormato(),
      this.ctxACasa(),
      this.ctxAutorizacao(),
      this.ctxAgora(),
    ].filter(Boolean).join('\n\n');
  },

  // Mantido pelo nome antigo: é o que perguntar() e os testes já chamam.
  instrucao() { return this.contexto(); },

  /* ---------- 1. estático: quem ele é ---------- */
  ctxQuemVoceE() {
    return 'Você é o assistente do DOMI, um aplicativo de finanças de uma família brasileira. Você responde sobre o dinheiro DESTA casa, com os números do próprio app.';
  },

  /* ---------- 2. estático: o vocabulário do app ----------

     A camada mais importante das sete. Cada termo aqui tem uma definição exata
     no js/db.js, e as telas todas a usam. O assistente precisa falar a MESMA
     língua — senão ele explica com palavras que o app não usa, ou pior, usa as
     palavras do app com outro sentido. */
  ctxVocabulario() {
    return [
      'O VOCABULÁRIO DO DOMI. Estes termos têm significado exato aqui. Use-os com o mesmo sentido que as telas usam e nunca troque um pelo outro:',
      '- Disponível para gastar: o que existe em conta, MENOS o comprometido, MENOS o guardado. É número de planejamento — "quanto posso assumir de novo até o fim do ciclo". Receita que ainda não caiu NÃO entra: disponível é dinheiro que existe.',
      '- Livre em caixa: o que existe em conta MENOS o guardado, sem descontar o comprometido. É realidade de caixa — a fatura só sai da conta quando é paga. É este número que diz se um gasto encostou na reserva.',
      '- Comprometido: contas e faturas que vencem até o fim do ciclo atual. O dinheiro está lá, mas já tem dono.',
      '- Guardado: a reserva de emergência mais o que está separado em metas.',
      '- Ciclo (ou mês financeiro): começa no dia que a família escolheu, que pode não ser o dia 1. "Mês" numa pergunta quase sempre quer dizer ciclo.',
      '- Categoria, ou envelope: para onde o gasto foi. Pode ter subcategoria.',
      '- Fatura: o que um cartão acumulou entre o fechamento e o vencimento.',
      '- Reserva: o colchão de emergência, medido em meses de custo de vida.',
      '- Cofrinho: o dinheiro das crianças — potes, tarefas e semanada. Vive no mesmo banco de dados, num app à parte.',
      '- Conselheiro: as análises que o painel já mostra sozinho.',
    ].join('\n');
  },

  /* ---------- 3. estático: o que ele NÃO faz, e para onde mandar ----------

     Toda ferramenta aqui é de leitura; `simular_cenario` calcula e não grava.
     Sem dizer isso, o modelo aceita "lança aí um gasto de 50" e responde como se
     tivesse lançado — e a pessoa só descobre que não foi quando procura. */
  ctxLimites() {
    return [
      'O QUE VOCÊ NÃO FAZ: você só LÊ. Não cria, edita nem apaga lançamento, conta, cartão, meta ou categoria — nenhuma das suas ferramentas escreve. Se pedirem para lançar ou mudar algo, diga em qual tela a pessoa faz isso, em uma linha, e siga.',
      'ONDE AS COISAS FICAM, para você apontar o caminho: lançar é o botão + em qualquer tela; contas e cartões em Cartões & Contas; metas e reserva em Metas; orçamento por categoria, dia de início do ciclo e backup em Configurações; suas permissões em Configurações → Assistente.',
    ].join('\n');
  },

  /* ---------- 4. estático: como responder ---------- */
  ctxRegras() {
    return [
      'REGRAS:',
      '- Todo número vem das ferramentas. Nunca estime, arredonde de cabeça nem invente: se falta ferramenta para responder, diga o que precisa ser autorizado em Configurações → Assistente.',
      '- Responda em português do Brasil, com valores em reais no formato R$ 1.234,56.',
      '- AJUSTE O TAMANHO À PERGUNTA. Consulta direta ("quanto sobra?") se responde em duas ou três frases, com o número na frente. Pergunta que pede explicação, comparação, causa ou cenário merece o espaço de que precisar: mostre as parcelas da conta, o raciocínio e o que fazer a respeito. O que não vale é encher linguiça — toda frase tem de acrescentar.',
      '- Formate a resposta segundo o COMO ESCREVER abaixo.',
      '- Fale como alguém da casa, não como relatório de banco: "sobra R$ 300 até o fim do mês" em vez de "o saldo projetado indica superávit".',
      '- Não dê recomendação de investimento nem indique produto financeiro. Pode explicar os números da pessoa e as consequências das escolhas dela.',
      '- Quando a resposta depender de projeção, diga que é estimativa.',
    ].join('\n');
  },

  /* ---------- 4b. estático: como a resposta é DESENHADA ----------

     A tela não é um terminal: ela renderiza um markdown específico, e só ele.
     Dizer qual é a diferença entre uma resposta bem apresentada e uma resposta
     com "|" e "###" à mostra. O que o app NÃO renderiza também precisa ser dito
     — senão o modelo emite link e imagem, que aqui viram texto cru. */
  ctxFormato() {
    return [
      'COMO ESCREVER. A resposta aparece numa folha estreita, num celular. Ela é renderizada com este markdown, e só com ele:',
      '- **negrito** para o número que responde a pergunta. Use com parcimônia: se tudo é negrito, nada é.',
      '- Listas com "- " quando forem itens soltos, ou "1. " quando a ordem significar algo (maior para menor, primeiro para último).',
      '- TABELA sempre que houver mais de duas linhas comparáveis — categoria e valor, mês e saldo, cartão e fatura. É o formato que melhor se lê aqui. Use o cabeçalho e alinhe a coluna de dinheiro à direita, assim:',
      '  | Categoria | Gasto |',
      '  | --- | ---: |',
      '  | Alimentação | R$ 625,40 |',
      '- "### Título" para separar seções, e só em resposta longa. Resposta de duas frases não precisa de seção.',
      '- `código` para citar o nome exato de uma conta, cartão ou categoria.',
      '- "> " para destacar um alerta curto, no máximo um por resposta.',
      'NÃO use link, imagem, título de nível 1 ("# "), nem bloco de código com três crases: a tela mostra esses como texto cru.',
      'Deixe uma linha em branco entre blocos — parágrafo, lista e tabela só são reconhecidos assim.',
      'Comece pela resposta, não pelo caminho: primeiro o número que a pessoa pediu, depois a explicação se ela for útil.',
    ].join('\n');
  },

  /* ---------- 5. muda raramente: a forma desta casa ----------

     Os NOMES, não os valores. É o que faz "e no Nubank?" ser resolvível sem uma
     ida e volta perdida. Com teto: uma família com trinta categorias não pode
     empurrar a lista inteira em toda pergunta. */
  MAX_NOMES: 12,
  ctxACasa() {
    if (!DB.data) return '';
    const nomes = (lista) => {
      const v = (lista || []).map(x => x && (x.name || x.nome)).filter(Boolean);
      if (!v.length) return null;
      return v.length > this.MAX_NOMES
        ? v.slice(0, this.MAX_NOMES).join(', ') + ` e mais ${v.length - this.MAX_NOMES}`
        : v.join(', ');
    };
    /* CADA LINHA OBEDECE À MESMA PERMISSÃO DA FERRAMENTA CORRESPONDENTE.
       Nome não é saldo, mas é dado da casa: entregar "o cartão se chama C6" com
       "Cartões e faturas" desmarcado quebraria a promessa da tela — a de que o
       desmarcado nem chega ao modelo. */
    const ok = (this.cfg && this.cfg.ver) || {};
    const linhas = [];
    const familia = DB.familyName && DB.familyName();
    if (familia) linhas.push(`A família se chama ${familia}.`);

    // Conta aparece em saldos e na lista de lançamentos; basta uma das duas.
    const contas = (ok.situacao || ok.lancamentos) ? nomes(DB.data.accounts) : null;
    const cartoes = ok.cartoes ? nomes(DB.data.cards) : null;
    const criancas = ok.criancas ? nomes(DB.data.kids) : null;
    if (contas) linhas.push(`Contas: ${contas}.`);
    if (cartoes) linhas.push(`Cartões: ${cartoes}.`);
    if (criancas) linhas.push(`Crianças no cofrinho: ${criancas}.`);

    if (!linhas.length) return '';
    linhas.push('Quando a pessoa citar um desses nomes, é a estes que ela se refere.');
    return 'A CASA:\n' + linhas.join('\n');
  },

  /* ---------- 6. muda raramente: o que ficou de fora ----------

     O modelo não enxerga a ferramenta que não foi autorizada — é o desenho, e
     está certo. Mas então ele também não sabe que ela EXISTE, e o conselho
     "peça autorização" sai vago. Dizer o nome do que está desligado (nunca o
     dado) transforma isso em instrução aproveitável. */
  ctxAutorizacao() {
    const rotulos = {
      situacao: 'saldos e disponível',
      categorias: 'gastos por categoria',
      previsao: 'projeções e contas fixas',
      cartoes: 'cartões e faturas',
      metas: 'metas e reserva',
      lancamentos: 'a lista de lançamentos',
      criancas: 'o cofrinho das crianças',
    };
    const ok = (this.cfg && this.cfg.ver) || {};
    const fora = Object.keys(rotulos).filter(k => !ok[k]).map(k => rotulos[k]);
    if (!fora.length) return '';
    return `NÃO AUTORIZADO nesta casa: ${fora.join('; ')}. Você não tem ferramenta para isso. Se a pergunta depender de algum destes, diga qual falta e que se liga em Configurações → Assistente.`;
  },

  /* ---------- 7. volátil: o instante ----------

     Fica por último de propósito: é a única parte que muda de uma pergunta para
     a seguinte, e o que vem antes dela pode ser reaproveitado do cache.

     `ondeEstou` é preenchido pelo app.js (a tela e o ciclo abertos). Fica como
     gancho, e não como leitura de `state`, para o js/ia.js continuar carregável
     sozinho — é assim que os testes o rodam sem navegador. */
  ondeEstou: null,
  ctxAgora() {
    const s = (DB.settings && DB.settings()) || {};
    const linhas = [
      `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}.`,
      `O ciclo desta família começa no dia ${s.month_start_day || 1}.`,
      'Nas ferramentas, mês 0 é o ciclo atual, -1 o anterior, +1 o próximo.',
    ];
    let onde = null;
    try { onde = this.ondeEstou && this.ondeEstou(); } catch (_) { onde = null; }
    if (onde && onde.tela) {
      const ciclo = onde.ciclo === 0 ? 'o ciclo atual'
        : onde.ciclo === -1 ? 'o ciclo anterior'
          : onde.ciclo === 1 ? 'o próximo ciclo'
            : `o ciclo ${onde.ciclo > 0 ? '+' : ''}${onde.ciclo}`;
      linhas.push(`AGORA a pessoa está na tela ${onde.tela}, vendo ${ciclo}${onde.rotulo ? ` (${onde.rotulo})` : ''}. Se ela disser "esse mês", "aqui" ou "isso", é a isto que se refere.`);
    }
    return linhas.join('\n');
  },

  /* ==========================================================================
     O HISTÓRICO

     O QUE FICA GUARDADO: só o texto — a pergunta e a resposta de cada turno.

     O que NÃO fica são os blocos de ferramenta, e a razão é dupla. Eles são a
     parte pesada (cada um é um JSON de dados financeiros, muitas vezes maior
     que a resposta inteira), e são a parte que ENVELHECE: retomar em setembro
     uma conversa de agosto com os saldos de agosto colados no contexto faria o
     assistente responder sobre um mês que já passou, com números que já
     mudaram. Descartando-os, a retomada volta a consultar o app e responde com
     o dado de hoje — mais leve e mais correto pelo mesmo motivo.

     ONDE FICA: dentro do DB (store `ia_chats`), para herdar a criptografia em
     repouso e a tela de bloqueio. Fora do SYNC_TABLES, porque conversa é do
     aparelho — não faz sentido inflar a sincronização da família com ela.

     QUANTO OCUPA: limitado por três tetos abaixo. Sem eles, um ano de uso
     encheria o localStorage e cada gravação do banco ficaria mais lenta, já que
     `DB.save` serializa (e cifra) tudo de uma vez.
     ========================================================================== */
  MAX_CONVERSAS: 20,      // as mais antigas caem
  MAX_TURNOS: 30,         // por conversa; o começo cai
  MAX_CONTEXTO: 8,        // quantos turnos voltam para o modelo ao retomar

  conversas() {
    if (!DB.data) return [];
    return (DB.data.ia_chats || []).slice().sort((a, b) => String(b.tocada).localeCompare(String(a.tocada)));
  },
  conversa(id) { return (DB.data && (DB.data.ia_chats || []).find(c => c.id === id)) || null; },

  novaConversa() {
    const c = { id: DB.uuid(), titulo: '', criada: DB.now(), tocada: DB.now(), turnos: [] };
    DB.data.ia_chats = DB.data.ia_chats || [];
    DB.data.ia_chats.push(c);
    this.podar();
    DB.save();
    return c;
  },

  gravarTurno(id, pergunta, resposta) {
    const c = this.conversa(id);
    if (!c) return null;
    c.turnos.push({ q: pergunta, r: resposta, em: DB.now() });
    // O título é a primeira pergunta, cortada: é o que faz a lista ser varrível
    if (!c.titulo) c.titulo = pergunta.length > 52 ? pergunta.slice(0, 52).trim() + '…' : pergunta;
    c.tocada = DB.now();
    this.podar();
    DB.save();
    /* Sobe cifrada. Conversa recém-aberta e ainda vazia não sobe: só ganha linha
       na nuvem quando vira pergunta de verdade. */
    this.nuvemSalvarChat(id).catch(() => {});
    return c;
  },

  apagarConversa(id) {
    if (!DB.data) return;
    DB.data.ia_chats = (DB.data.ia_chats || []).filter(c => c.id !== id);
    DB.save();
    // Apagou aqui, apagou lá: senão a próxima sincronização a traria de volta.
    this.nuvemApagarChat(id).catch(() => {});
  },

  /* Corta pelas pontas: turnos antigos dentro de cada conversa, conversas
     antigas dentro da lista.

     Conversa VAZIA é a que foi aberta e abandonada sem nenhuma pergunta. Elas
     saem — menos a mais recente, que pode ser justamente a que está aberta na
     tela agora. Sem essa exceção, abrir uma conversa nova a apagaria no mesmo
     instante. */
  podar() {
    if (!DB.data) return;
    let lista = (DB.data.ia_chats || []).slice();
    for (const c of lista) {
      if (c.turnos.length > this.MAX_TURNOS) c.turnos = c.turnos.slice(-this.MAX_TURNOS);
    }
    lista.sort((a, b) => String(a.tocada).localeCompare(String(b.tocada)));   // antiga → recente
    const maisRecente = lista[lista.length - 1];
    lista = lista.filter(c => c.turnos.length > 0 || c === maisRecente);
    if (lista.length > this.MAX_CONVERSAS) lista = lista.slice(-this.MAX_CONVERSAS);
    DB.data.ia_chats = lista;
  },

  /* O contexto que volta para o modelo ao retomar: os últimos turnos, em texto.
     Menos que isso perde o fio da conversa; muito mais encarece cada pergunta
     sem melhorar a resposta, porque o dado vem das ferramentas de novo. */
  contextoDe(c) {
    if (!c || !c.turnos.length) return [];
    return c.turnos.slice(-this.MAX_CONTEXTO).flatMap(t => ([
      { role: 'user', content: t.q },
      { role: 'assistant', content: t.r },
    ]));
  },

  /* Quanto o histórico está ocupando, para a tela de configuração poder dizer.
     Medido no que de fato vai para o disco, não estimado. */
  tamanhoDoHistorico() {
    try { return new Blob([JSON.stringify((DB.data && DB.data.ia_chats) || [])]).size; }
    catch (_) { return JSON.stringify((DB.data && DB.data.ia_chats) || []).length; }
  },

  /* ==========================================================================
     A CONVERSA

     O laço de tool use: manda, e enquanto o modelo pedir ferramenta, executa
     aqui e devolve. O teto de voltas existe porque um laço sem fim custaria
     dinheiro de verdade — e um modelo confuso pode pedir a mesma coisa em
     círculo.
     ========================================================================== */
  MAX_VOLTAS: 6,
  /* SEM TETO DE RESPOSTA. `null` diz a cada provedor para não limitar: na
     DeepSeek o campo max_tokens sai do corpo, porque lá é opcional; na
     Anthropic, onde é obrigatório, vai o máximo do modelo.

     Cortar a resposta de um app de dinheiro pela metade é pior que demorar
     mais — e não há desvantagem em pedir alto: cobra-se pelo que sai, e o
     limite por minuto conta o que saiu, não o teto pedido. */
  SEM_TETO: null,

  /* O laço não sabe com quem está falando. Ele pede ao adaptador do provedor
     para montar o corpo, e recebe de volta a forma neutra
     `{texto, pedidos, cru, cortada}` — venha de uma resposta inteira ou de um
     fluxo. Foi o que permitiu somar a DeepSeek, e depois o streaming, sem tocar
     em nada daqui. */
  async perguntar(historico, aoAndar, aoTexto) {
    if (!this.disponivel()) throw new Error('O assistente não está configurado. Vá em Configurações → Assistente.');
    if (!this.algoAutorizado()) {
      throw new Error('Nada foi autorizado ainda. Em Configurações → Assistente, escolha o que ele pode consultar.');
    }

    const p = this.prov();
    const tools = this.ferramentasAutorizadas();
    const msgs = historico.slice();
    const consultou = [];
    /* O texto de TODAS as voltas entra na resposta, não só o da última. Com
       streaming a pessoa vê o que o modelo escreve antes de consultar uma
       ferramenta ("vou olhar seus gastos por categoria"); descartar isso depois
       faria o texto aparecer na tela e sumir do histórico. O que se viu é o que
       fica guardado. */
    const partes = [];

    for (let volta = 0; volta < this.MAX_VOLTAS; volta++) {
      const r = await this.chamar(
        p.corpo(this.modeloAtual(), this.instrucao(), msgs, tools, this.SEM_TETO), aoTexto);
      if (r.texto) partes.push(r.texto);

      if (!r.pedidos.length) {
        /* Resposta cortada no meio chega com cara de resposta pronta. Dizer que
           faltou é obrigatório: aqui se decide dinheiro em cima do que ele diz. */
        const texto = partes.join('\n\n') + (r.cortada
          ? '\n\n_(a resposta foi cortada por tamanho — pergunte por partes)_' : '');
        return { texto, consultou, cortada: !!r.cortada, historico: msgs.concat([p.msgAssistente(r.cru)]) };
      }

      msgs.push(p.msgAssistente(r.cru));
      const pares = r.pedidos.map(pedido => {
        consultou.push(pedido.name);
        if (aoAndar) aoAndar(pedido.name);
        return { id: pedido.id, saida: JSON.stringify(this.executar(pedido.name, pedido.input)) };
      });
      msgs.push(...p.msgsResultado(pares));
      // Uma volta nova começa outro parágrafo: sem isso, o texto pré-ferramenta
      // e a resposta final saem grudados numa frase só.
      if (aoTexto && r.texto) aoTexto('\n\n');
    }
    throw new Error('A conversa ficou longa demais. Tente uma pergunta mais direta.');
  },

  /* A CHAMADA VAI DIRETO DO NAVEGADOR PARA O PROVEDOR.

     Sem servidor no meio, e por escolha: o app é local-first e funciona sem
     nuvem nenhuma — o assistente não podia ser a única parte que exige um
     backend publicado. A chave é de quem está perguntando, mora no aparelho
     dele, cifrada com o PIN dele e — se houver nuvem — cifrada de novo antes de
     subir, com uma chave que o servidor não tem.

     Devolve sempre a FORMA NEUTRA `{texto, pedidos, cru, cortada}`, venha ela de
     uma resposta inteira ou de um fluxo. Quem chama não precisa saber qual foi. */
  async chamar(corpo, aoTexto) {
    const p = this.prov();
    const querFluxo = typeof aoTexto === 'function';
    let res;
    try {
      res = await fetch(p.url, {
        method: 'POST',
        headers: p.cabecalhos(this.chaveAtual()),
        body: JSON.stringify(querFluxo ? { ...corpo, stream: true } : corpo),
      });
    } catch (_) {
      // fetch só rejeita por rede/CORS; a API respondendo "não" vira res.ok false.
      throw new Error('Sem conexão com o assistente. O resto do app não precisa de internet.');
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(this.explicar(res.status, t));
    }
    /* Fluxo exige `res.body`. Onde ele não existir (ambiente sem streams, ou um
       intermediário que entregou tudo de uma vez), cai para a leitura inteira em
       vez de quebrar — o resultado é o mesmo, só sem aparecer aos poucos. */
    if (querFluxo && res.body && p.lerFluxo) return p.lerFluxo(this, res, aoTexto);
    return p.ler(await res.json());
  },

  /* Confere a chave ANTES de guardá-la, e confere junto o que realmente importa:
     que o modelo escolhido sabe CHAMAR FERRAMENTA. Um modelo que responde bem
     mas ignora ferramentas deixa o assistente inútil de um jeito difícil de
     diagnosticar — ele responde, só que inventando, porque nunca consultou o
     app. Melhor descobrir aqui, na tela de configuração.

     A ferramenta de brinquedo é uma pergunta cuja resposta o modelo não tem: só
     chamando é que ele responde. */
  async testar() {
    const p = this.prov();
    const brinquedo = [{
      name: 'saldo_de_teste',
      description: 'Devolve o saldo atual da conta. Use sempre que perguntarem o saldo.',
      input_schema: { type: 'object', properties: {}, required: [] },
    }];
    const corpo = p.corpo(this.modeloAtual(), 'Você responde sobre finanças. Consulte as ferramentas quando precisar de um número.',
      [{ role: 'user', content: 'Qual é o meu saldo?' }], brinquedo, this.SEM_TETO);

    const r = await this.chamar(corpo);
    /* Cortada é outra coisa: a chave funciona e o modelo pode até chamar
       ferramenta — só não coube. Dizer "não chamou" aqui seria acusar o modelo
       de um defeito que não é dele. */
    if (r.cortada && !r.pedidos.length) {
      throw new Error('A chave funciona, mas a resposta do teste veio cortada. Tente de novo, ou escolha outro modelo.');
    }
    if (!r.pedidos.length) {
      throw new Error(`A chave funciona, mas o modelo ${this.nomeDoModelo()} não chamou a ferramenta que ofereci. Sem isso o assistente responderia sem consultar os seus números. Escolha outro modelo.`);
    }
    return true;
  },

  nomeDoModelo() {
    const id = this.modeloAtual();
    const m = this.prov().modelos.find(x => x.id === id);
    return m ? m.nome : id;
  },

  /* Erro de API é críptico por natureza. Aqui vira uma frase que diz o que
     aconteceu e o que fazer — sobretudo nos dois casos que a pessoa REALMENTE
     vai encontrar: chave errada e crédito acabado. As duas APIs usam os mesmos
     códigos HTTP para isso, então uma tradução serve às duas. */
  explicar(status, corpo) {
    let tipo = '';
    let msg = '';
    try {
      const j = JSON.parse(corpo);
      const e = j.error || j;
      tipo = e.type || e.code || '';
      msg = e.message || '';
    } catch (_) {}
    const texto = (msg + ' ' + corpo).toLowerCase();
    const onde = this.prov().console;

    if (status === 401 || /authentication/.test(tipo)) {
      return `A chave não foi aceita. Confira se copiou inteira, direto de ${onde}.`;
    }
    if (status === 403 || /permission/.test(tipo)) {
      return 'Essa chave não tem permissão para este modelo. Escolha outro modelo aqui nas configurações.';
    }
    if (status === 402 || /insufficient|credit|balance|quota/.test(texto)) {
      return `A conta está sem crédito. Adicione crédito em ${onde}.`;
    }
    if (status === 429 || /rate_limit/.test(tipo)) {
      return 'Muitas perguntas em pouco tempo. Espere um instante e tente de novo.';
    }
    if (status === 404 || /model/.test(texto) && /not.*(found|exist)/.test(texto)) {
      return `O modelo ${this.nomeDoModelo()} não está disponível para esta chave. Escolha outro aqui nas configurações.`;
    }
    if (status === 400) {
      return 'A pergunta não pôde ser processada. Tente reformular ou comece uma conversa nova.';
    }
    if (status >= 500) return 'O provedor está instável no momento. Tente daqui a pouco.';
    return `Não consegui falar com o assistente (${status}).`;
  },

  /* ---------- O que a tela chama ----------
     Junta as duas metades: monta o contexto a partir do histórico guardado,
     pergunta, e grava o turno. A tela não precisa saber de nada disso. */
  async perguntarNaConversa(id, pergunta, aoAndar, aoTexto) {
    const c = this.conversa(id);
    if (!c) throw new Error('Conversa não encontrada.');
    const contexto = this.contextoDe(c).concat([{ role: 'user', content: pergunta }]);
    const r = await this.perguntar(contexto, aoAndar, aoTexto);
    this.gravarTurno(id, pergunta, r.texto);
    return r;
  },
};

