# Prompt de retomada

Cole o bloco abaixo ao abrir uma sessão nova. Ele foi escrito para que o assistente
não precise redescobrir nada — e, principalmente, para que não repita erros que já
custaram tempo aqui.

---

```
Vamos continuar o PWA de finanças da família em D:\Projetos\meus-projetos\financas
(repo público: github.com/joctarios-lab/finances, branch main).

Leia primeiro, nesta ordem:
  docs/plano-sync.md                    ← por que o marcador do pull é server_at
  docs/plano-visao-futuro.md            ← como as telas mostram meses futuros
  docs/plano-graficos.md                ← ApexCharts e o que continua SVG à mão
  docs/plano-disponivel-e-recorrencia.md
  docs/plano-gestao-eficiente.md      ← auditoria das telas e as 6 contas novas
  docs/plano-testes.md                  ← por que o relógio da suíte é congelado
  docs/plano-cartoes.md                 ← a tela de Cartões e qual fatura aparece
  docs/plano-projecao-variavel.md       ← como o hero projeta o fim do mês
  docs/plano-contas-fixas.md            ← editar um contrato e o que fica de fora
  docs/plano-extrato.md
  docs/plano-ia.md

## Estado atual
- Versão 157 (sw.js VERSAO + as 12 tags ?v= do index.html andam JUNTAS a cada entrega)
- 3128 testes em tests/smoke.js, todos passando: `node tests/smoke.js`
- 819 em tests/cofrinho.js: `node tests/cofrinho.js`
- a prova de cifra do assistente: `node tests/cofre.js` (roda o WebCrypto de verdade)
- a conversa completa nos dois provedores: `node tests/provedores.js`
- E a suíte inteira em 9 datas de calendário: `node tests/tempo.js`
- Nada pendente no git

## IDENTIDADE DOMI (v156) — o que mudou e o que NÃO mudar
- `css/styles.css` foi reescrito do zero: **tema duplo**, escuro por padrão.
  A paleta vive em três camadas, nesta ordem: `:root` (escura, sempre definida)
  → `@media (prefers-color-scheme: light)` com `:not([data-tema="dark"])`
  → `:root[data-tema="light"]`. **Nenhuma cor pode ter sua única definição dentro
  de um media query**, senão ela some no outro tema.
- As tintas vêm em conjunto (ver o item sobre os quatro tokens, abaixo). Use os
  tokens; não escreva hex nem rgba solto numa regra.
- O tema é escolhido em Configurações → Aparência (`auto`/`dark`/`light`) e
  aplicado por um bloco inline no topo do index.html, ANTES de qualquer script:
  lido depois, o app abre no tema errado e troca no quadro seguinte.
- **Modo privado** (o olho no header): quem esconde é `marcarValores()` em
  js/app.js — ele varre o texto renderizado e embrulha cada cifra num
  `<span class="v">`; o CSS só tem `.privado .v`. Não volte a listar classes:
  a lista borrava o rótulo junto e deixava valores de fora.
- O painel é UMA COLUNA. Uma divisão em duas foi tentada e desfeita — abaixo do
  ponto de corte as colunas viravam pilha na ordem dos wrappers e o conselheiro
  passava à frente do saldo. Há teste travando a volta disso.
- O header ocupa a largura inteira da tela (`.topbar-inner` sem max-width); só o
  conteúdo abaixo dele é limitado e centralizado.
- **A cor é do dado, e só dele.** Não há gradiente, halo, névoa de fundo nem
  sombra colorida em estado permanente — há teste reprovando a volta de cada um.
  Fundo grafite plano (#0C0D0E), cards #141619, superfície de destaque #1C1F23.
  Verde/vermelho/azul aparecem em valor, selo e filete; nunca em enfeite.
- Hero e cartão de crédito se destacam por CAMADA, não por cor. São três planos:
  página (`--ink`) → hero (`--destaque`) → painel de conta (`--embutido`). O hero
  avança, os blocos de conta recuam dentro dele. Some isso e ele volta a parecer
  pobre — foi exatamente o que aconteceu quando o gradiente saiu e nada entrou no
  lugar. O acabamento completa: fio de luz de 1px na aresta de cima
  (`inset 0 1px 0` branco a 5%), filete de situação de 2px e o valor em 40px.
- O filete do hero segue o SELO (`:has(.b-amber)`), não a classe `.hero-*`: a
  classe é binária e o selo tem três estados, e os dois discordavam num caso real
  ("Aperto no variável" âmbar com filete verde ao lado).
- Toda tinta tem QUATRO tokens: `--x`, `--x-soft` (fundo), `--x-ink` (texto
  sobre o fundo) e `--x-borda` (contorno). Nunca escreva rgba() na regra: há
  teste exigindo que todo token de cor do escuro exista também no claro, porque
  um rgba solto não acompanha a troca de tema e vaza a cor do tema anterior.

## O ASSISTENTE (v164) — como está montado

- **NÃO HÁ TETO DE RESPOSTA.** `IA.SEM_TETO` é `null`, e cada provedor traduz:
  na DeepSeek o `max_tokens` SAI do corpo (lá é opcional); na Anthropic, onde é
  obrigatório, vai o `maxSaida` do modelo — 128K no Opus/Sonnet 5, 64K no Haiku
  4.5, números publicados na documentação. Pedir alto não custa: a documentação
  da Anthropic diz que `max_tokens` NÃO entra no cálculo do limite por minuto,
  que conta o que saiu.
- **Cada modelo declara se aceita pensamento adaptativo** (`pensa`). O Haiku 4.5
  é da geração 4.5 e RECUSA `thinking:{type:adaptive}` com 400 — mandar o campo
  para ele deixava o modelo mais barato da lista impossível de usar. Quem não
  aceita simplesmente não recebe o campo.
- **`testar()` também roda sem teto.** Com 512 e pensamento adaptativo, o
  orçamento acabava antes da chamada de ferramenta e o app REPROVAVA UMA CHAVE
  BOA dizendo "este modelo não chama ferramenta". Agora distingue "cortada" de
  "não chamou".

## O ASSISTENTE (v163) — como está montado

- **O COFRE PRECISA SER LIBERADO POR APARELHO, e isso é visível.** A chave do
  cofre nasce da senha do login, e a senha só passa pelo app em `Sync.signIn` —
  que pode não rodar por meses, já que a sessão se renova pelo refresh token. Num
  aparelho que já estava logado quando o assistente foi configurado, o cofre
  nunca existia: `cifrar()` devolvia null, `nuvemSalvarCfg()` retornava calado
  (NUNCA SUBIU NADA) e `sincronizar()` saía antes de puxar. Sem erro nenhum, e
  com a tela afirmando "Cópia na nuvem ligada".
- **`IA.estadoDaNuvem()` tem TRÊS valores** — `sem-nuvem`, `falta-liberar`,
  `ligada` — e a tela fala a partir dele. Estar logado não é mais sinônimo de
  estar sincronizando; foi essa suposição que escondeu o defeito.
- **`IA.liberarCofre(email, senha)` valida a senha NO SERVIDOR antes de derivar
  qualquer chave** (via `Sync.signIn`). Derivar de texto errado funcionaria e
  criaria um cofre inútil que ainda por cima sobrescreveria a cópia boa na nuvem
  com dados que ninguém mais abriria. Depois puxa da nuvem e só então sobe o que
  é local — nessa ordem, porque o que está lá sobreviveu a "apagar os dados".
- **A senha nunca é guardada.** Guardá-la destruiria a garantia inteira. Ela é
  pedida uma vez por aparelho, e some.

## O ASSISTENTE (v161) — como está montado

- **O TAMANHO DA RESPOSTA é instrução, não limite do modelo.** A regra antiga
  ("duas ou três frases") era dada a toda pergunta e cortava justamente as de
  cenário. Agora o critério é a pergunta: consulta direta em três frases,
  explicação com o espaço de que precisar.
- **`MAX_TOKENS` é 8000, não 2000.** Na Anthropic o pensamento adaptativo conta
  DENTRO do teto: com 2000, um raciocínio longo comia o orçamento e a resposta
  chegava truncada — parecendo apenas "curta". Teto alto não custa: a saída é
  cobrada pelo que sai, não pelo teto.
- **O corte é detectado e dito** (`stop_reason: 'max_tokens'` /
  `finish_reason: 'length'` → `r.cortada`). Resposta truncada chegava com cara
  de resposta pronta, e aqui se decide dinheiro em cima do que ela diz.
- **`formatarResposta` entende markdown de verdade**: seção (###), listas com
  marcador e numeradas, TABELA em pipes (com alinhamento pela linha de traços),
  citação, régua, negrito, itálico, riscado e código. Tabela importa mais que o
  resto: resposta de app de dinheiro é tabular, e o modelo escreve em pipes sem
  que se peça.
- **A tabela rola DENTRO do próprio bloco** (`.ia-tabela` com overflow-x). Sem
  isso, a folha inteira rolaria de lado e o botão de fechar sairia da tela.
- **LINK E IMAGEM ficam de fora de propósito.** Um assistente financeiro não tem
  por que emitir âncora clicável, e converter `[x](url)` abriria porta para
  plantar um endereço — o texto que ele repete pode vir da descrição de um
  lançamento, que é dado de fora.
- **ESCAPA PRIMEIRO, FORMATA DEPOIS**, sempre. É o que impede que uma tag escrita
  por qualquer um volte como tag dentro da folha. Há teste com entrada hostil,
  inclusive dentro de célula de tabela.
- **`ctxFormato()` ensina o dialeto ao modelo.** De nada adianta a tela entender
  tabela se o modelo não souber que pode usá-la — nem que link vira texto cru.

- **O CONTEXTO VAI EM TODA REQUISIÇÃO, e é montado em camadas** (`IA.contexto()`,
  que `instrucao()` apenas devolve). Não é repetido por mensagem — a instrução do
  sistema já viaja com cada chamada; repetir só multiplicaria custo.
- **A ORDEM É DO ESTÁTICO AO VOLÁTIL, e isso não é estética.** Identidade →
  vocabulário → limites → regras → a casa → o que não foi autorizado → data e
  tela atual. As duas APIs cobram uma fração por prefixo já visto, e prefixo só
  se repete se o começo do texto for idêntico entre chamadas: a data no topo
  invalidaria o cache a cada pergunta. Há teste sobre a ordem.
- **A camada de VOCABULÁRIO é a que mais importa.** `DB.available()` e
  `DB.caixaLivre()` são grandezas diferentes DE PROPÓSITO (uma é planejamento, a
  outra é caixa — ver os comentários no js/db.js). Sem a definição, o modelo
  chama as duas de "saldo" e passa a contradizer as telas. Num app de dinheiro
  isso é pior que errar a conta: ensina um modelo mental que o app não sustenta.
- **A camada "A CASA" obedece às MESMAS permissões das ferramentas.** Ela cita
  nomes de contas, cartões e crianças — e nome não é saldo, mas é dado da casa.
  Entregá-lo com a permissão desmarcada quebraria a promessa da tela ("o
  desmarcado nem chega ao modelo"). Foi um defeito real na primeira versão desta
  camada; há teste travando.
- **`IA.ondeEstou` é um gancho preenchido pelo app.js**, não uma leitura de
  `state` dentro do js/ia.js — que precisa continuar carregável sozinho, é assim
  que as suítes o rodam sem navegador. Ele resolve "e esse mês?" para o ciclo que
  a pessoa está de fato olhando, em vez de sempre o atual.
- **Custo:** o fixo por pergunta foi de 1372 para ~1890 tokens (+37%), ~US$ 0,005
  a mais por pergunta no Opus 5. Com o prefixo cacheado ficaria em ~US$ 0,018 —
  mais barato que os ~US$ 0,030 de hoje sem cache. O cache ainda NÃO está ligado;
  a ordenação acima é o que o torna possível.

- **A chave é DO USUÁRIO, não do app**, e o provedor é escolha dele: Claude
  (Anthropic) ou DeepSeek. `IA.chamar()` vai **direto do navegador** para a API
  escolhida. Não há Edge Function, secret nem `functions deploy` — removido na
  v158. Motivo: o custo passou a ser de quem usa, e um app local-first não podia
  ter o assistente como a única parte que exige backend publicado.
- **`IA.PROVEDORES` é a única coisa que sabe de formato.** O laço (`perguntar`)
  fala a forma neutra `{texto, pedidos:[{id,name,input}]}`, e cada provedor
  traduz na borda: instrução em campo próprio (Anthropic) ou como 1ª mensagem
  `role:'system'` (DeepSeek); `input_schema` × `function.parameters`; blocos
  `tool_use` × `message.tool_calls` (com argumentos em JSON serializado);
  resultados numa ÚNICA mensagem de usuário × UMA mensagem `role:'tool'` por
  pedido. Há teste proibindo o laço de citar provedor pelo nome.
- **Chave e modelo são POR PROVEDOR** (`cfg.chaves`, `cfg.modelos`). Trocar de
  provedor não apaga a chave do outro. `load()` migra o formato v158
  (`chave`/`modelo` soltos) para o novo — quem já colou não recola.
- **`IA.testar()` prova que o modelo CHAMA FERRAMENTA**, não só que a chave é
  aceita: oferece uma ferramenta de brinquedo e recusa o modelo que a ignora. Um
  modelo que responde sem consultar inventaria números, e nada no app acusaria.
- **CORS verificado nas duas** (preflight real, não suposição): a Anthropic
  devolve `allow-origin: *` e admite o cabeçalho `dangerous-direct-browser-access`;
  a DeepSeek ecoa a origem e libera `authorization`.
- **`tests/provedores.js`** roda uma conversa inteira em cada uma com um `fetch`
  de mentira que confere o que recebeu — é o que prova que o laço fecha, não só
  que os campos foram traduzidos.
- **A chave mora em `DB.data.meta.ia`**, dentro do banco cifrado com o PIN — não
  no localStorage solto, que é onde criptografia nenhuma protege. `meta` está
  fora de `STORES`, e `sync.js` só olha `STORES`: a chave não vai junto com os
  dados da família.
- **`DB.exportJSON()` limpa TODAS as chaves** (o mapa `cfg.chaves` inteiro, mais
  a do cofre) antes de gerar o backup — zerar campo a campo deixou as duas
  passarem quando o formato mudou na v159; o teste agora RODA `exportJSON` em vez
  de procurar texto no fonte. O arquivo
  exportado é um `.json` solto na pasta de downloads — perder o assistente ao
  restaurar é aceitável; vazar credencial que gasta dinheiro, não.
- **O cofre (`IA.abrirCofre`)** é o que permite guardar na nuvem sem que o
  servidor leia. Deriva AES-256 da **senha do login** (PBKDF2, 200 mil voltas,
  sal = SHA-256 do `user_id`) no único instante em que a senha existe no app:
  `Sync.signIn`. Tudo que sobe para `ia_config`/`ia_chats` passa por
  `IA.cifrar()` antes. O sal vem do id (não é sorteado) para que um aparelho novo
  chegue à mesma chave sem buscar nada antes.
- **Consequência aceita:** trocar a senha do Supabase torna a cópia na nuvem
  indecifrável. `IA.decifrar()` devolve `null` nesse caso, e `nuvemPuxarCfg()`
  **não** sobrescreve o que está no aparelho quando isso acontece.
- **`ia_config` e `ia_chats` são as únicas tabelas de escopo pessoal** do
  schema: RLS por `auth.uid()`, não por `family_id`. Uma policy escrita por
  engano com escopo de família deixaria um membro da casa ler a chave do outro, e
  nada no app daria erro — por isso há teste sobre o texto do SQL.
- **`tests/cofre.js`** roda a cifra de verdade no WebCrypto e verifica que a
  chave e o texto das conversas não aparecem no que sobe, que a mesma senha
  recupera e que outra senha falha devolvendo `null`. Asserção de texto não prova
  ilegibilidade; esta prova, sim. Rode junto com as outras.
- **O modelo é escolhido pela pessoa** (`IA.MODELOS`: Opus 5, Sonnet 5, Haiku
  4.5), com o preço por milhão de tokens no rótulo — quem paga escolhe, e para
  escolher precisa do número, não de adjetivos.
- **`IA.testar()`** confere a chave com `max_tokens: 1` antes de salvar. Chave
  errada é recusada na tela de configuração, não na primeira pergunta.
- **O modelo não recebe o banco.** Ele recebe FERRAMENTAS (`IA.ferramentas()`),
  que são perguntas ao app; quem calcula é o `js/db.js`, as mesmas funções que
  desenham as telas. Isso vale por três razões, nesta ordem: privacidade (sai o
  agregado, não o extrato), exatidão (modelo somando parcela de fatura erra de
  um jeito plausível) e custo.
- **Permissão é conferida DUAS vezes**: a ferramenta sem permissão não entra na
  lista enviada (o modelo não sabe que existe) e ainda assim é recusada em
  `IA.executar` se for pedida pelo nome. Há teste sabotado confirmando que a
  segunda barreira pega.
- **`simular_cenario` não grava nada.** É o que separa responder "e se eu cortar
  a academia" de mexer na vida financeira de alguém sem pedir. Teste confere que
  a contagem de lançamentos não muda.
- **Desligado, o app é o de antes.** `IA.disponivel()` exige duas coisas: a
  pessoa ligou E existe nuvem configurada (a função vive no projeto Supabase).
  Sem isso, `pintarBotaoIA()` mantém o botão do header escondido.

### O histórico das conversas
- Fica na store `ia_chats`, **dentro do DB** — herda a criptografia em repouso e
  a tela de bloqueio. **Fora do `SYNC_TABLES`**: conversa é do aparelho, não da
  família; sincronizá-la mandaria texto sobre a vida financeira para a nuvem e
  inflaria todo pull.
- **Só o texto é guardado** — pergunta e resposta. Os blocos de ferramenta ficam
  de fora por dois motivos: são a parte pesada (cada um é um JSON de dados) e a
  que ENVELHECE. Retomar em setembro uma conversa de agosto com os saldos de
  agosto colados faria o assistente responder sobre um mês que já passou.
  Descartados, a retomada consulta o app de novo — mais leve e mais correto pelo
  mesmo motivo.
- Três tetos seguram o tamanho: `MAX_CONVERSAS` (20), `MAX_TURNOS` (30 por
  conversa) e `MAX_CONTEXTO` (8 turnos voltam ao modelo). Sem eles, um ano de uso
  encheria o localStorage e cada `DB.save` ficaria mais lento — ele serializa e
  cifra tudo de uma vez.

### O que ainda não existe
- **Voz.** `SpeechRecognition` e `SpeechSynthesis` são nativas e sem
  dependência, mas o iOS exige gesto do usuário para iniciar e o Firefox não tem
  reconhecimento. Ficou para uma segunda rodada, sobre a base de texto.
- **Um terceiro provedor** custa só mais uma entrada em `IA.PROVEDORES`: url,
  `cabecalhos`, `corpo`, `ler`, `msgAssistente`, `msgsResultado` e a lista de
  modelos com preço. Nada no laço, nada na tela — ela varre `IA.PROVEDORES`
  sozinha. Antes de somar, confira o CORS com um preflight de verdade.

## PENDÊNCIA MINHA (do usuário), confira antes de mexer em sync
Rodar supabase/schema.sql (é idempotente). São DUAS coisas agora:
1. o bloco "CARIMBO DO SERVIDOR" — garantia contra perda de registro;
2. a coluna "pontual" em transactions — sem ela a classificação de gasto pontual
   fica só neste aparelho (o push recua sozinho, nada quebra).
Conferência:
  select event_object_table, trigger_name from information_schema.triggers
   where trigger_name = 'trg_server_at' order by event_object_table;
Devem aparecer 9 linhas. Enquanto não rodar, o app usa fallback automático e
funciona — mas sem a garantia contra perda de registro.

## Como trabalhamos aqui (siga)
- Diagnostique medindo, não supondo. Reproduza o defeito antes de corrigir.
- NUNCA escreva data absoluta em teste. Escreva a relação ("faz 60 dias", "o
  último dia deste ciclo"). A suíte já apodreceu uma vez por isso: ficou verde no
  dia em que foi escrita e reprovava 13 vezes no dia 31, sem defeito nenhum.
  Antes de dar por bom, rode `node tests/tempo.js` — verde num dia só não é verde.
- Depois de corrigir, SABOTE o código e confirme que o teste reprova. Teste que
  não pega regressão não vale. Todo script de sabotagem restaura num `finally` —
  um deles foi interrompido nesta sessão e deixou a alteração aplicada no código.
- Valide contra dados reais quando fizer sentido: o .env (gitignored) tem as
  credenciais do Supabase. Leia por script local; NUNCA traga credencial para o
  chat nem para o commit.
- js/config.js é vazio de propósito — o repo é público. Nunca preencher.
- Comentários e mensagens de commit em português, explicando o PORQUÊ.
- Confirme o push consultando o servidor (git ls-remote), não só o git status.

## Permissões — já estão configuradas, não peça de novo
As regras de execução estão em .claude/settings.local.json (fora do git, é
config pessoal desta máquina). Estão por PADRÃO: node, git, grep, sed, cat,
curl, npx serve e os scripts temporários em .claude/jobs/ rodam sem perguntar.
Só é negado o que não tem volta: rm -rf, push --force, reset --hard, git clean.

Se ainda assim aparecer um pedido, é porque o comando não casa com nenhum
padrão — me diga qual foi e eu acrescento a regra, em vez de você aprovar na
mão toda vez.

## Armadilhas de ferramenta que já me pegaram
- js/app.js e tests/smoke.js usam CRLF; js/sync.js e js/graficos.js usam LF.
  Casar padrão com o fim de linha errado falha silenciosamente.
- `$` numa string de substituição do replace() é padrão especial: 'R$' corrompe
  o arquivo. Use split/join.
- Heredoc no bash quebra com aspas/acentos: prefira escrever o script num arquivo.
- A suíte termina com process.exit dentro de uma IIFE async. Bloco async novo
  precisa de `await`, senão agenda e nunca roda.
- Comentário HTML dentro de template literal: crase ali QUEBRA o arquivo, e o
  texto do comentário É RENDERIZADO — um teste que procura "hero-depois" ou uma
  data no HTML casa com o comentário. Escreva sem crase e sem citar literais que
  algum teste procura.

## Decisões que não devem ser revertidas sem conversa
- O marcador do pull é server_at (carimbo do banco). updated_at é do cliente e
  serve só para resolver conflito. Trocar reintroduz perda silenciosa de dados.
- A rosca (svgDonut) é o único gráfico em SVG à mão — foi medido, não é descuido.
- Em mês futuro, DB.txOfPeriod devolve transações VIRTUAIS (sem id, virtual:true).
  Elas não podem entrar em nada que grave: edição em massa, linha clicável do
  extrato, botão de pagar.
- "Disponível" (desconta comprometido e guardado) ≠ "Saldo em conta". Os dois
  aparecem no app e não podem ter o mesmo nome.
- saldoPrevistoNaData = saldoNaData + entra − sai, com as duas parcelas vindo de
  DB.movimentoPrevistoAte. A ponte do Extrato e o hero do Painel LEEM daí; nenhum
  dos dois recalcula por fora. Copiar a regra na view é como nasceram três dos
  defeitos já corrigidos aqui.
- Transferência agendada é neutra para a família e NÃO é neutra para uma conta
  filtrada — ali ela entra ou sai de verdade, como no extrato do banco.
- No cartão do Extrato, o corte entre "já aconteceu" e "ainda vem" é o STATUS, não
  a data: quem paga adiantado deixa a data do vencimento e o dinheiro já saiu.
- No Extrato, "Em conta de uso" (fora do investimento) ≠ "Livre para gastar hoje" do
  Painel (desconta reserva e metas). Podem coincidir; os nomes não podem. Ela
  aparece sob TODO fechamento — hoje, mês encerrado e fim do mês —, cada uma
  medindo o investido pela mesma função que produziu o total decomposto.
- A linha do gráfico do Extrato segue DB.previstoPorDia depois de hoje: a ponta
  dela tem de cair no saldo previsto escrito ao lado. Comparar com saldoNaData
  deixou passar meses inteiros desenhados como reta. Realizado e previsto sao
  DUAS series (cheia e tracejada), que se tocam no ponto de hoje.
- No ÚLTIMO dia do ciclo não há "primeiro dia por vir": o vencido entra no próprio
  ponto de hoje, que ali é o fechamento que o cartão anuncia. E o gráfico tem uma
  linha só, sem a vertical — não há emenda a desenhar.
- O relógio da suíte é congelado (`HOJE` no ambiente, âncora em tests/smoke.js).
  Trocar por `new Date()` de verdade traz de volta a suíte que apodrece.
- Na tela de Cartões a ordem é patrimônio → o que eu TENHO → o que eu DEVO →
  custo fixo. Nunca listar N faturas: com parcelamento, as N últimas são todas
  futuras e escondem a atual (foi o defeito). Mostra-se a fechada não paga, a
  aberta, e as futuras SOMADAS numa linha. Limite se diz pelo que sobra, e o que
  OCUPA o limite é a dívida INTEIRA — parcela em 10x trava o total na hora da
  compra —, não só a fatura aberta: descontar só ela dava R$ 1.999,20 a mais de
  limite do que existia. Limite menor que o comprometido é aviso de cadastro.
  A barra tem DUAS faixas, e o corte é o STATUS, nunca a data da fatura:
  UTILIZADO é compra efetivada (a parcelada conta INTEIRA no dia da compra) e
  COMPROMETIDO é o que foi lançado e ainda não se efetivou. Cortar por data dava
  R$ 359,90/1.999,20 onde o certo é R$ 2.249,10/110,00. Fatura quitada devolve o
  limite — inclusive a só MARCADA como paga, em que `falta` continua cheio.
- O contrato se edita inteiro na tela "Contas fixas" (openEditarContrato):
  descrição, valor, periodicidade, dia, prazo, categoria, conta, método. O TIPO
  (despesa/receita) fica fora — invertê-lo trocaria o sinal do que já entrou no
  saldo. Vale das PRÓXIMAS ocorrências; o lançado fica como está.
- fim_vezes é o TOTAL de ocorrências do contrato, não o que falta. O que falta é
  restamDaRecorrencia = fim_vezes − geradas. Descontar antes de gravar faz o
  desconto acontecer duas vezes (12 com 3 nascidas viravam "faltam 6").
- UMA FONTE de movimentação futura: o CONTRATO (recurrences). A marca recurring
  saiu de cena — ela replicava o lançamento nos meses seguintes E não aparecia na
  tela "Contas fixas", que lê só contratos. Medido: marcar uma dentadura de R$ 770
  como fixa somava R$ 770 a setembro E outubro. O botão "Custos fixos" do Extrato
  foi removido junto. recurring segue no banco, só não é mais LIDO.
- Duas classes decidem a projeção, exclusivas: VARIÁVEL entra no ritmo; PONTUAL
  (aconteceu e não volta) fica fora. "Conta fixa" não é classe, é o VÍNCULO com o
  contrato — a folha do Painel oferece vincular, nunca aplica sozinha.
- A folha oferece CRIAR contrato dali (contratoDoLancamento, que salta uma
  ocorrência) e DESVINCULAR. Desvincular NAO apaga o contrato — é outra coisa, e
  existe a tela "Contas fixas" para isso. Parcela não oferece desvincular: ela é
  de contrato pelo installment, e o botão não desfaria nada. Vincular exige o
  mesmo TIPO (despesa com despesa).
- Casar descrição com nome de contrato só para SUGERIR. Automático errou 19
  lançamentos (R$ 5.322): "PAGSEGURO INTERNET IP S.A." virava internet fixa e
  "ARAGUARI" virava conta de água. contratoSugeridoPara compara o nome INTEIRO.
- A coluna "pontual" pode não existir no banco: o push detecta a recusa, reenvia
  sem ela e registra pela sessão. Nunca exigir migração para o app funcionar.
- Projeção do mês = DB.projecaoDeGasto: só o gasto VARIÁVEL se extrapola. O
  run-rate antigo dava R$ 162.807 num mês de R$ 17.981 de renda.
- Base das porcentagens = DB.rendaDoMes (o mês), não a renda declarada. Cuidado:
  realizedIncome já inclui o que está lançado a pagar, e em mês futuro inclui as
  virtuais — somar previsaoDoMes().entra por cima conta o salário duas vezes.
- Meta com prazo acima de 10 anos não vira data: vira quanto/mês para caber em 5.
- Saldo só entende filtro de CONTA e de janela de dias. Com categoria, membro,
  etiqueta ou busca, o cartão mostra o movimento do filtro e avisa que o saldo não
  responde a ele.

## O que eu quero fazer agora
[escreva aqui]
```

---

## Sobre as permissões

`.claude/settings.local.json` é **gitignored** — é config desta máquina, não do
projeto. Numa máquina nova ele não existe, e os pedidos voltam.

O arquivo tinha 96 regras, **82 delas literais**: comandos exatos como
`sed -i "s/const VERSAO = '29'/..."`, que só valem para aquele comando e nunca
mais casam. Por isso o pedido reaparecia mesmo com "tudo autorizado". Foram
substituídas por padrões (`Bash(node:*)`, `Bash(git push:*)`, …), que cobrem as
variações.

O que ficou negado, de propósito: `rm -rf`, `git push --force`, `git reset --hard`,
`git clean`. Com `node:*` liberado dá para rodar qualquer script, então o limite
precisa estar onde o estrago não tem volta.

Backup do arquivo antigo, caso queira conferir algo:
`C:\Users\joctamr\.claude\jobs\f1445160\tmp\settings.local.backup.json`

**Nota honesta:** texto no prompt não desliga pedido de permissão — quem decide é
o Claude Code, lendo esse arquivo. As alternativas, se quiser zero atrito, são
`/permissions` dentro da sessão ou iniciar com `--permission-mode acceptEdits`.

## Contexto que não cabe no prompt, mas está nos commits

Últimos 12 commits desta sessão, do mais recente:

| commit | o quê |
|---|---|
| `efa022d` | carimbo do servidor (`server_at`) como marcador do pull |
| `340a17d` | pull deixava registros para trás (perda silenciosa) |
| `7790d99` | duplicação na previsão e rodapé resumindo o próximo mês |
| `b9c0cf1` | visão de futuro coerente em todos os objetos das telas |
| `b2d0510` | cenários futuros até 6 meses nas três telas |
| `8bed051` | filtrar sem categoria, calendário fora do recorte, botão de meta |
| `50e6249` | previsto no lugar errado, escalas ancoradas, fatura em aberto |
| `8baa98e` | primeira linha do painel: reserva, projeção, regra 50·30·20 |
| `29c1bb9` | remove o eixo de valor de oito gráficos |
| `ee4e23f` | trilha ideal não desenhava + acabamento do widget 29 |
| `e920879` | rankings seguem o Charts Widget 27 do demo25 |
| `353ec8b` | tamanho do texto dos gráficos ancorado no layout |

**Referência de design:** Metronic 8 demo25, em
`D:\Storage Old\Disco E\Projetos\Scripts\metronic_html_v8.2.6_demo25\demo25`.
As configs de gráfico estão em `assets/js/widgets.bundle.js`.

**Três defeitos de dados encontrados nesta sessão, todos com a mesma assinatura** —
o número da tela não batia com outro número da própria tela:

1. A previsão contava o mesmo compromisso duas vezes quando o contrato nascia de
   um lançamento que já existia (nenhuma das 11 recorrências tinha `recurrence_id`).
2. `committedDepois` ignorava contrato e custo fixo.
3. O pull perdia registros de aparelho que ficou offline.

Quando um número não fecha com outro, é defeito até prova em contrário.
