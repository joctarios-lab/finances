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

   A CHAVE É DE QUEM PERGUNTA. Cada pessoa cola a própria chave da Anthropic
   nas configurações, e a chamada vai direto do navegador para a API — sem
   servidor no meio. Assim quem usa paga o próprio uso, e o assistente não
   obriga um app local-first a depender de backend publicado.

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
      chave: '',
      modelo: 'claude-opus-5',
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

  /* Os modelos que a pessoa pode escolher. O custo agora é dela, então a escolha
     também é — e para escolher ela precisa do número, não de adjetivos. Preço
     por milhão de tokens, em dólar, como a Anthropic cobra. */
  MODELOS: [
    { id: 'claude-opus-5', nome: 'Opus 5', sub: 'o mais capaz — raciocina melhor sobre cenários', entrada: 5, saida: 25 },
    { id: 'claude-sonnet-5', nome: 'Sonnet 5', sub: 'equilibrado — bem mais barato que o Opus', entrada: 2, saida: 10 },
    { id: 'claude-haiku-4-5', nome: 'Haiku 4.5', sub: 'o mais barato e rápido — para perguntas diretas', entrada: 1, saida: 5 },
  ],

  load() {
    const salvo = (DB.data && DB.data.meta && DB.data.meta.ia) || null;
    this.cfg = { ...this.padrao(), ...(salvo || {}) };
    this.cfg.ver = { ...this.padrao().ver, ...(this.cfg.ver || {}) };
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

  /* O assistente existe quando a pessoa ligou E colou uma chave. Sem chave o
     botão não aparece, em vez de aparecer e falhar no primeiro toque.

     Note que NÃO exige nuvem: a chamada vai direto do navegador para a API, e o
     app segue funcionando sem Supabase nenhum — como todo o resto dele. */
  disponivel() {
    return !!(this.cfg && this.cfg.ligado && this.cfg.chave);
  },
  algoAutorizado() {
    return !!(this.cfg && Object.values(this.cfg.ver).some(Boolean));
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

  async perguntar(historico, aoAndar) {
    if (!this.disponivel()) throw new Error('O assistente não está configurado. Vá em Configurações → Assistente.');
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

  /* A CHAMADA VAI DIRETO DO NAVEGADOR PARA A ANTHROPIC.

     Sem servidor no meio, e por escolha: o app é local-first e funciona sem
     nuvem nenhuma — o assistente não podia ser a única parte que exige um
     backend publicado. A chave é de quem está perguntando, mora no aparelho
     dele, cifrada com o PIN dele e — se houver nuvem — cifrada de novo
     antes de subir, com uma chave que o servidor não tem.

     O cabeçalho `anthropic-dangerous-direct-browser-access` é o que a API exige
     para aceitar chamada de página web. O nome avisa do risco real: uma chave no
     navegador pode ser lida por quem tiver acesso àquele navegador. Aqui isso é
     aceitável porque a chave é a DA PRÓPRIA PESSOA, no aparelho DELA — é o
     cenário de ferramenta pessoal que a documentação da Anthropic descreve como
     razoável. O que seria inaceitável é embutir UMA chave no app e distribuí-la
     a todo mundo; não é o caso. */
  API: 'https://api.anthropic.com/v1/messages',
  MAX_TOKENS: 2000,

  async chamar(corpo) {
    const res = await fetch(this.API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.chave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.cfg.modelo || 'claude-opus-5',
        max_tokens: this.MAX_TOKENS,
        /* Pensamento adaptativo: as perguntas aqui vão de "qual meu saldo" a
           "o que acontece se eu cortar 300 por mês durante um ano". O modelo
           decide quanto pensar em cada uma. */
        thinking: { type: 'adaptive' },
        system: corpo.system,
        messages: corpo.messages,
        tools: corpo.tools && corpo.tools.length ? corpo.tools : undefined,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(this.explicar(res.status, t));
    }
    return res.json();
  },

  /* Confere a chave com a menor chamada possível, para a tela de configuração
     poder dizer "funciona" antes da primeira pergunta de verdade. Um token de
     saída: o que se testa é a autenticação, não a resposta. */
  async testar() {
    const res = await fetch(this.API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.chave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.cfg.modelo || 'claude-opus-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'oi' }],
      }),
    });
    if (res.ok) return true;
    const t = await res.text().catch(() => '');
    throw new Error(this.explicar(res.status, t));
  },

  /* Erro de API é críptico por natureza. Aqui ele vira uma frase que diz o que
     aconteceu e o que fazer — sobretudo nos dois casos que a pessoa REALMENTE
     vai encontrar: chave errada e crédito acabado. */
  explicar(status, corpo) {
    let tipo = '';
    try { tipo = (JSON.parse(corpo).error || {}).type || ''; } catch (_) {}

    if (status === 401 || tipo === 'authentication_error') {
      return 'A chave não foi aceita. Confira se copiou inteira, incluindo o "sk-ant-".';
    }
    if (status === 403 || tipo === 'permission_error') {
      return 'Essa chave não tem permissão para este modelo. Tente escolher outro modelo nas configurações.';
    }
    if (status === 400 && /credit|balance/i.test(corpo)) {
      return 'A conta está sem crédito. Adicione crédito em console.anthropic.com.';
    }
    if (status === 429 || tipo === 'rate_limit_error') {
      return 'Muitas perguntas em pouco tempo. Espere um instante e tente de novo.';
    }
    if (status === 400) {
      return 'A pergunta não pôde ser processada. Tente reformular ou comece uma conversa nova.';
    }
    if (status >= 500) return 'O assistente está instável no momento. Tente daqui a pouco.';
    if (!status) return 'Sem conexão. O assistente precisa de internet — o resto do app não.';
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

