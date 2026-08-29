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

   A CHAVE NÃO MORA AQUI. O app fala com uma Edge Function do Supabase
   (supabase/functions/assistente), que guarda a chave nos secrets e chama a
   Anthropic. Nada de segredo chega ao navegador.
   ============================================================================ */
'use strict';

const IA = {
  CHAVE: 'financas.ia.v1',
  cfg: null,

  /* ---------- Configuração ----------
     Tudo desligado por padrão. Sem `ligado`, o app é exatamente o de antes: o
     botão de conversa não aparece e nada daqui roda. */
  padrao() {
    return {
      ligado: false,
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
    try { this.cfg = { ...this.padrao(), ...(JSON.parse(localStorage.getItem(this.CHAVE)) || {}) }; }
    catch (_) { this.cfg = this.padrao(); }
    this.cfg.ver = { ...this.padrao().ver, ...(this.cfg.ver || {}) };
    return this.cfg;
  },
  save() { try { localStorage.setItem(this.CHAVE, JSON.stringify(this.cfg)); } catch (_) {} },

  /* O assistente só existe com DUAS coisas: a pessoa ligou, e há nuvem
     configurada — a Edge Function vive no projeto Supabase da família. Sem uma
     delas o botão não aparece, em vez de aparecer e falhar ao ser tocado. */
  disponivel() {
    return !!(this.cfg && this.cfg.ligado)
      && typeof Sync !== 'undefined' && Sync.hasFamily();
  },
  algoAutorizado() {
    return !!(this.cfg && Object.values(this.cfg.ver).some(Boolean));
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
  instrucao() {
    const s = DB.settings() || {};
    return [
      'Você é o assistente financeiro do DOMI, um aplicativo de contas de uma família brasileira.',
      '',
      'REGRAS:',
      '- Todo número vem das ferramentas. Nunca estime, arredonde de cabeça nem invente um valor: se não tem a ferramenta para responder, diga o que falta autorizar em Configurações → Assistente.',
      '- Responda em português do Brasil, com valores em reais no formato R$ 1.234,56.',
      '- Seja curto. Uma resposta boa aqui tem duas ou três frases e o número que importa. Só use lista quando forem realmente vários itens.',
      '- Fale como alguém da casa, não como um relatório de banco: "sobra R$ 300 até o fim do mês" em vez de "o saldo projetado indica superávit".',
      '- Você não dá recomendação de investimento nem indica produto financeiro. Pode explicar os números da pessoa e as consequências das escolhas dela.',
      '- Quando a resposta depender de uma projeção, diga que é estimativa.',
      '',
      `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}.`,
      `O mês financeiro da família começa no dia ${s.month_start_day || 1}.`,
      'Mês 0 é o ciclo atual, -1 o anterior, +1 o próximo.',
    ].join('\n');
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
    return c;
  },

  apagarConversa(id) {
    if (!DB.data) return;
    DB.data.ia_chats = (DB.data.ia_chats || []).filter(c => c.id !== id);
    DB.save();
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

  async perguntar(historico, aoAndar) {
    if (!this.disponivel()) throw new Error('O assistente não está configurado.');
    if (!this.algoAutorizado()) {
      throw new Error('Nada foi autorizado ainda. Em Configurações → Assistente, escolha o que ele pode consultar.');
    }

    const tools = this.ferramentasAutorizadas();
    const msgs = historico.slice();
    const consultou = [];

    for (let volta = 0; volta < this.MAX_VOLTAS; volta++) {
      const resposta = await this.chamar({ system: this.instrucao(), messages: msgs, tools });

      const pedidos = (resposta.content || []).filter(b => b.type === 'tool_use');
      if (!pedidos.length) {
        const texto = (resposta.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        return { texto, consultou, historico: msgs.concat([{ role: 'assistant', content: resposta.content }]) };
      }

      msgs.push({ role: 'assistant', content: resposta.content });
      /* TODOS os resultados voltam numa ÚNICA mensagem de usuário. Separá-los em
         mensagens diferentes ensina o modelo a parar de pedir ferramentas em
         paralelo, e aí cada pergunta vira várias idas e vindas. */
      const resultados = pedidos.map(p => {
        consultou.push(p.name);
        if (aoAndar) aoAndar(p.name);
        return {
          type: 'tool_result',
          tool_use_id: p.id,
          content: JSON.stringify(this.executar(p.name, p.input)),
        };
      });
      msgs.push({ role: 'user', content: resultados });
    }
    throw new Error('A conversa ficou longa demais. Tente uma pergunta mais direta.');
  },

  /* A chamada em si vai para a Edge Function, nunca direto para a Anthropic: é
     lá que a chave mora. O JWT do Supabase vai junto, então só quem está na
     família consegue usar. */
  async chamar(corpo) {
    await Sync.ensureToken();
    const res = await fetch(`${Sync.cfg.url}/functions/v1/assistente`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: Sync.cfg.anonKey,
        Authorization: `Bearer ${Sync.cfg.access_token}`,
      },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(this.explicar(res.status, t));
    }
    return res.json();
  },

  /* Erro de API é críptico por natureza. Aqui ele vira uma frase que diz o que
     aconteceu e o que fazer — inclusive quando a resposta é "não é com você,
     é com quem publicou a função". */
  explicar(status, corpo) {
    if (status === 404) return 'A função do assistente não está publicada no Supabase. Veja o README.';
    if (status === 401 || status === 403) return 'Sua sessão expirou. Entre de novo em Configurações → Sincronização.';
    if (status === 429) return 'Muitas perguntas em pouco tempo. Espere um instante e tente de novo.';
    if (status === 402) return 'A conta da Anthropic está sem crédito.';
    if (status >= 500) return 'O assistente está fora do ar no momento. Tente daqui a pouco.';
    try {
      const j = JSON.parse(corpo);
      if (j && j.erro) return j.erro;
    } catch (_) {}
    return `Não consegui falar com o assistente (${status}).`;
  },

  /* ---------- O que a tela chama ----------
     Junta as duas metades: monta o contexto a partir do histórico guardado,
     pergunta, e grava o turno. A tela não precisa saber de nada disso. */
  async perguntarNaConversa(id, pergunta, aoAndar) {
    const c = this.conversa(id);
    if (!c) throw new Error('Conversa não encontrada.');
    const contexto = this.contextoDe(c).concat([{ role: 'user', content: pergunta }]);
    const r = await this.perguntar(contexto, aoAndar);
    this.gravarTurno(id, pergunta, r.texto);
    return r;
  },
};

