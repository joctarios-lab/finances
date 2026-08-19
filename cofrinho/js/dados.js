/* Cofrinho — a camada de dados do app da criança.

   POR QUE UM ARMAZÉM PRÓPRIO, e não o do app da família?

   O app da família guarda tudo num blob cifrado com o PIN de quem administra
   (ver js/db.js, KCrypto). A criança não tem esse PIN — nem deve ter: ele abre
   salários, cartões e dívidas. Então este app tem o armazém DELE, com as quatro
   tabelas do cofrinho e mais nada. Se alguém abrir o localStorage do aparelho,
   o que está aqui são mesadas de dez reais, não a vida financeira da casa.

   A NUVEM É A MESMA. Os dois apps moram na mesma origem, então este lê
   `financas.sync.v1` — a configuração que o adulto já preencheu no app da
   família — e conversa direto com o Supabase. Não há um segundo login: quem
   configurou lá, configurou aqui.

   O TOKEN É COMPARTILHADO, e isso exige cuidado. O Supabase ROTACIONA o refresh
   token a cada renovação: o antigo morre. Se este app renovasse e guardasse o
   novo só para si, o app da família perderia o acesso na próxima sincronização
   — e o adulto veria "faça login de novo" sem entender por quê. Por isso
   `salvarSessao` escreve de volta na MESMA chave que o outro app lê. Um token
   só, dois apps. */
'use strict';

const CHAVE = 'financas.cofrinho.v1';
const CHAVE_SYNC = 'financas.sync.v1';
const TABELAS = ['kids', 'kid_goals', 'kid_tasks', 'kid_entries', 'kid_wishes'];

// As colunas que vão para a nuvem, espelhando js/sync.js. Uma coluna a mais aqui
// do que lá seria um 400 do PostgREST a cada envio — e o cofrinho pararia calado.
const COLUNAS = {
  kids: ['name', 'avatar', 'cor', 'nascimento_ano', 'semanada_valor', 'semanada_dia',
    'rendimento_tipo', 'rendimento_valor', 'pin_hash', 'pin_salt', 'active'],
  kid_goals: ['kid_id', 'name', 'icon', 'target_amount', 'done'],
  kid_tasks: ['kid_id', 'name', 'icon', 'amount', 'active', 'frequencia', 'expira_em'],
  kid_entries: ['kid_id', 'tipo', 'pote', 'amount', 'date', 'description', 'task_id', 'kid_goal_id', 'confirmada', 'repartido'],
  kid_wishes: ['kid_id', 'name', 'icon', 'criada_em', 'resposta', 'respondida_em'],
};

/* Formata em real dentro da camada de dados: as lições carregam texto pronto com o
   número dela, e depender do formatador da tela deixaria o dado incompleto — e
   testável só através da tela. */
function fmtMoeda(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }

const Dados = {
  d: null,

  carregar() {
    try { this.d = JSON.parse(localStorage.getItem(CHAVE)) || null; } catch (_) { this.d = null; }
    if (!this.d) this.d = { meta: { lastSync: null } };
    for (const t of TABELAS) if (!this.d[t]) this.d[t] = [];
    return this.d;
  },

  salvar() { localStorage.setItem(CHAVE, JSON.stringify(this.d)); },

  uuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
  },

  agora() { return new Date().toISOString(); },

  hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  paraISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  somarDiasISO(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return this.paraISO(d);
  },

  all(t) { return (this.d[t] || []).filter(r => !r.deleted); },
  get(t, id) { return (this.d[t] || []).find(r => r.id === id && !r.deleted) || null; },

  upsert(t, obj) {
    const lista = this.d[t];
    const i = obj.id ? lista.findIndex(r => r.id === obj.id) : -1;
    const reg = { ...(i >= 0 ? lista[i] : {}), ...obj, updated_at: this.agora(), dirty: true };
    if (!reg.id) reg.id = this.uuid();
    if (i >= 0) lista[i] = reg; else lista.push(reg);
    this.salvar();
    return reg.id;
  },

  remove(t, id) {
    const r = (this.d[t] || []).find(x => x.id === id);
    if (!r) return false;
    r.deleted = true; r.updated_at = this.agora(); r.dirty = true;
    this.salvar();
    return true;
  },

  /* ---------- As contas do cofrinho ----------
     São as mesmas de js/db.js, de propósito: o adulto e a criança precisam ver
     o MESMO saldo. Duas contas parecidas viram duas verdades, e quando o número
     da tela dela não bate com o da tela dele, quem perde a confiança no app é
     a criança. */

  criancas() {
    return this.all('kids').filter(k => k.active !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  },

  /* O SALDO DOS TRÊS POTES.

     ENTRADA pendente NÃO conta; SAÍDA pendente conta. A assimetria é de propósito:

       creditar antes de o adulto ver seria pagar por ela DIZER que fez a tarefa,
       e a criança aprenderia a dizer;
       debitar antes de ele ver é conservador — mostra menos dinheiro do que ela
       talvez tenha, e num app que ensina a não gastar o que não tem, errar para
       menos é o lado seguro.

     E dá o retorno imediato que a idade exige: ela toca "gastei" e o pote cai na
     hora. Sem isso ela tocaria de novo, achando que não funcionou. */
  potes(kidId) {
    const potes = { gastar: 0, guardar: 0, doar: 0 };
    for (const e of this.all('kid_entries')) {
      if (e.kid_id !== kidId) continue;
      const saida = e.tipo === 'gasto' || e.tipo === 'doacao';
      if (e.confirmada === false && !saida) continue;
      const p = potes[e.pote] === undefined ? 'gastar' : e.pote;
      const v = Number(e.amount) || 0;
      potes[p] += (e.tipo === 'gasto' || e.tipo === 'doacao') ? -v : v;
    }
    potes.total = potes.gastar + potes.guardar + potes.doar;
    return potes;
  },

  meta(kidId) { return this.all('kid_goals').find(g => g.kid_id === kidId && !g.done) || null; },

  /* QUANTAS SEMANADAS FALTAM para a meta, dado um valor guardado.

     Recebe o guardado por parâmetro para poder responder à pergunta hipotética
     "e SE eu tirasse R$ 5 daqui?" — que é o coração do simulador de escolha. Sem
     isso a conta só sabe falar do presente, e o custo de uma decisão só apareceria
     depois de ela ser tomada. */
  semanasParaMetaCom(kidId, guardado) {
    const meta = this.meta(kidId);
    const kid = this.get('kids', kidId);
    if (!meta || !kid) return null;
    const falta = (Number(meta.target_amount) || 0) - (Number(guardado) || 0);
    if (falta <= 0) return 0;
    const porSemana = (Number(kid.semanada_valor) || 0)
      + (kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0);
    if (porSemana <= 0) return null;
    return Math.ceil(falta / porSemana);
  },

  semanasParaMeta(kidId) {
    return this.semanasParaMetaCom(kidId, this.potes(kidId).guardar);
  },

  /* O CUSTO DE OPORTUNIDADE, na única moeda que a idade manipula: semanadas.

     Tirar do pote de guardar não é errado — é o dinheiro dela. Mas é uma escolha
     com consequência, e a consequência é invisível: o sorvete acontece hoje e o
     atraso do patinete só se sente daqui a três semanas. Aos seis anos, esse
     intervalo é longo demais para a ligação se formar sozinha.

     Então o app faz a conta ANTES e mostra as duas estradas. Não para dizer que
     ela está errada: para que a escolha seja dela de verdade, com o preço à vista.

     A MOEDA MÁGICA FICA FORA desta conta, de propósito. Tirar do guardado também
     custa a moeda da semana, e somar as duas coisas daria um número mais assustador
     e menos confiável — a moeda é condicional e o atraso é aritmético. A tela avisa
     das duas, cada uma no seu lugar.

     Devolve null quando não há o que comparar: sem meta, sem semanada para projetar
     ritmo, ou quando o saque não adia nada (ela tem de sobra). */
  /* A CONSEQUÊNCIA DE TIRAR DO GUARDADO, que existe SEMPRE — e é por isso que esta
     função não devolve null como a `custoDoSaque` faz.

     Antes, a tela de decisão só aparecia quando o saque adiava o sonho em uma semanada
     inteira. Três situações escapavam, e nas três o dinheiro saía do pote sem ela
     parar para pensar: saque pequeno que cabia na sobra do arredondamento, criança sem
     sonho cadastrado, e criança sem ritmo de semanada para projetar.

     O PROBLEMA NÃO É O NÚMERO, É O COMPROMISSO. O pote de guardar existe para ser
     dinheiro que ela decidiu não gastar; se dá para tirar de lá no mesmo número de
     toques que do pote de gastar, os dois potes são o mesmo pote com cores
     diferentes. A parada é o que faz o guardado significar algo.

     MAS A CONSEQUÊNCIA MOSTRADA TEM DE SER VERDADE. Um app que diz "vai atrasar o seu
     sonho" quando não vai atrasa nada ensina que ele exagera, e no dia em que o atraso
     for real ela não vai acreditar. Então cada caso mostra o que de fato acontece:
     atraso em semanadas quando há atraso, a data igual quando a data não muda, e o
     saldo que fica quando não há sonho para comparar. */
  consequenciaDoSaque(kidId, valor) {
    const v = Number(valor) || 0;
    if (v <= 0) return null;
    const kid = this.get('kids', kidId);
    if (!kid) return null;

    const guardado = this.potes(kidId).guardar;
    const meta = this.meta(kidId);
    const custo = this.custoDoSaque(kidId, v);

    /* A MOEDA MÁGICA É UM CUSTO REAL, e não só um aviso: quem tira do guardar não
       recebe a moeda no pagamento seguinte da semanada (a regra vive em
       `DB.kidMoedaMagicaDevida`, no app do adulto). Fica de fora da conta de semanadas
       de propósito — somar uma coisa condicional a uma aritmética daria um número
       maior e menos confiável —, e aparece como linha própria. */
    const perdeMoeda = kid.rendimento_tipo === 'moeda' && (Number(kid.rendimento_valor) || 0) > 0;

    return {
      valor: v, meta, guardado,
      sobra: Math.max(0, guardado - v),
      alvo: meta ? (Number(meta.target_amount) || 0) : 0,
      atraso: custo ? custo.atraso : 0,
      antes: custo ? custo.antes : this.semanasParaMeta(kidId),
      depois: custo ? custo.depois : null,
      perdeMoeda,
      moeda: perdeMoeda ? Number(kid.rendimento_valor) : 0,
    };
  },

  custoDoSaque(kidId, valor) {
    const meta = this.meta(kidId);
    if (!meta) return null;
    const v = Number(valor) || 0;
    if (v <= 0) return null;
    const guardado = this.potes(kidId).guardar;
    const antes = this.semanasParaMetaCom(kidId, guardado);
    const depois = this.semanasParaMetaCom(kidId, guardado - v);
    /* AS DUAS GUARDAS ABAIXO SÃO REDUNDANTES, e ficam por clareza — não por medo.

       Sem meta, `semanasParaMetaCom` devolve null dos dois lados e `null - null` é
       zero, que o `atraso <= 0` já barra. Sem ritmo, idem. Nenhuma sabotagem passa
       por aqui, e é correto que não passe: exigir estas linhas num teste seria
       testar a implementação em vez do que a criança vê.

       Elas continuam porque dizem a intenção em voz alta — "isto aqui não tem
       resposta" — em vez de deixar o leitor deduzir que uma subtração de nulos
       calha de cair no zero. */
    if (antes === null || depois === null) return null;   // sem ritmo, sem previsão
    const atraso = depois - antes;
    if (atraso <= 0) return null;                          // não adia nada
    return { meta, valor: v, antes, depois, atraso };
  },

  /* QUANTAS NOITES DE SONO FALTAM até uma data.

     A unidade é NOITE, não hora nem minuto, e a escolha é o centro do desenho.
     Uma criança de seis anos não manipula "faltam 34 horas" — mas sabe
     exatamente quantas vezes ainda vai dormir. É a mesma razão de a meta ser
     contada em semanadas e não em reais.

     E um relógio correndo faria outra coisa: criaria urgência: pressa que ela não
     tem como administrar. O prazo aqui existe para dar contorno à missão, não
     para apressar ninguém.

     Negativo quer dizer que já passou. */
  noitesAte(dataISO, refISO) {
    if (!dataISO) return null;
    const a = new Date((refISO || this.hojeISO()) + 'T12:00:00');
    const b = new Date(String(dataISO) + 'T12:00:00');
    if (isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  },

  /* O PRAZO EM PALAVRA, do jeito que ela lê.

     "Só até hoje" no último dia, porque "faltam 0 noites" não quer dizer nada. */
  prazoEmNoites(dataISO, refISO) {
    const n = this.noitesAte(dataISO, refISO);
    if (n === null) return null;
    if (n < 0) return 'acabou';
    if (n === 0) return 'só até hoje';
    if (n === 1) return 'falta 1 noite';
    return `faltam ${n} noites`;
  },

  inicioDaSemana(kid, refISO) {
    const hoje = refISO || this.hojeISO();
    const d = new Date(hoje + 'T12:00:00');
    const alvo = Math.min(6, Math.max(0, Number(kid.semanada_dia) || 0));
    const recuo = (d.getDay() - alvo + 7) % 7;
    d.setDate(d.getDate() - recuo);
    return this.paraISO(d);
  },

  /* O EXTRATO DELA: a SAÍDA pendente aparece; a ENTRADA pendente, não.

     É a mesma assimetria de `potes`, e tem de ser — senão o extrato desmente o
     saldo na própria tela. A criança gasta R$ 5, o pote cai na hora, e o histórico
     não mostrava nada: sumiu dinheiro sem uma linha explicando por quê. Para quem
     está aprendendo o que é um extrato, isso é o pior ensinamento possível.

     A entrada pendente continua fora: mostrá-la seria dizer que a tarefa já foi
     paga antes de o adulto conferir, e a criança aprenderia a contar com dinheiro
     que ainda não é dela.

     Se o adulto recusar, a linha some junto com o lançamento — que é exatamente o
     comportamento pedido. */
  entradas(kidId) {
    return this.all('kid_entries')
      .filter(e => {
        if (e.kid_id !== kidId) return false;
        if (e.confirmada !== false) return true;
        return e.tipo === 'gasto' || e.tipo === 'doacao';
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.updated_at).localeCompare(String(a.updated_at)));
  },

  /* AS ESPECIAIS QUE AINDA VALEM, da que vence primeiro para a que vence depois.

     A EXPIRADA SOME, sem tela de derrota e sem marca de falha. Não fez, acabou o
     prazo, o app segue — porque a alternativa é um card vermelho dizendo "você
     perdeu" para uma criança de seis anos, e vergonha não ensina compromisso.
     O plano do projeto já recusa "sequência que quebra e pune"; isto é a mesma
     regra aplicada ao prazo. */
  missoesEspeciais(kidId) {
    return this.tarefas(kidId)
      .filter(t => t.especial && !t.expirada)
      .sort((a, b) => String(a.expira_em || '').localeCompare(String(b.expira_em || '')));
  },

  /* AS MISSÕES DA SEMANA, com o progresso de cada uma.

     Duas frequências, e a diferença é de natureza, não de grau:

       semanal — faz uma vez e está feito. "Ajudar a pôr a mesa" não acontece
                 todo dia, e cobrar todo dia transformaria a lista em falha.
       diária  — precisa acontecer TODOS os dias, como a água do cachorro. Um ser
                 vivo depende disso, e é por isso que ela existe.

     A DIÁRIA NÃO PAGA POR DIA, e este é o centro do desenho. Sete toques a R$ 1
     numa semanada de R$ 10 fariam 70% da renda dela vir do cachorro — e, pior,
     ensinariam que cuidar de quem depende de você tem preço por unidade. No dia
     em que ela não quisesse o dinheiro, o cachorro ficaria sem água.

     O valor é pago UMA VEZ, ao completar a semana inteira. Premia a constância,
     não o balde de água. Faltar um dia não "custa R$ 1": quebra a sequência, que
     é exatamente a lição de compromisso. */
  tarefas(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return [];
    const inicio = this.inicioDaSemana(kid);
    const hoje = this.hojeISO();
    const marcadas = this.all('kid_entries').filter(e =>
      e.kid_id === kidId && e.tipo === 'tarefa' && String(e.date) >= inicio);

    return this.all('kid_tasks')
      .filter(t => t.kid_id === kidId && t.active !== false)
      .map(t => {
        const daTarefa = marcadas.filter(e => e.task_id === t.id);
        /* MISSÃO ESPECIAL: uma vez só, com prazo, e não volta na semana seguinte.

           A semanal reinicia a cada semana — é rotina. A especial é um combinado
           pontual ("lavar o carro neste fim de semana"), e reiniciá-la faria o app
           cobrar para sempre uma coisa que já aconteceu.

           Por isso a busca é em TODOS os lançamentos dela, sem janela: uma vez
           feita, feita está. */
        if (t.frequencia === 'especial') {
          const feita = this.all('kid_entries').find(e =>
            e.kid_id === kidId && e.tipo === 'tarefa' && e.task_id === t.id);
          const noites = this.noitesAte(t.expira_em);
          return {
            ...t, especial: true, diaria: false,
            feita: !!feita,
            confirmada: feita ? feita.confirmada !== false : false,
            entryId: feita ? feita.id : null,
            noites,
            prazo: this.prazoEmNoites(t.expira_em),
            /* EXPIRADA só se o prazo passou E ela não fez. Feita e ainda não
               confirmada continua viva: o adulto precisa poder pagar depois do
               prazo — ela cumpriu, e perder o combinado por demora dele seria
               injusto de um jeito que a criança sente. */
            expirada: noites !== null && noites < 0 && !feita,
          };
        }
        if (t.frequencia !== 'diaria') {
          const feita = daTarefa[0];
          return {
            ...t, diaria: false, feita: !!feita,
            confirmada: feita ? feita.confirmada !== false : false,
            entryId: feita ? feita.id : null,
          };
        }

        /* OS SETE DIAS DA SEMANA DO COFRINHO, na ordem. A semana começa no dia da
           semanada, e não no domingo: é o ciclo que a criança vive, e misturar os
           dois faria a sequência virar na quarta sem motivo visível. */
        const dias = [];
        for (let i = 0; i < 7; i++) {
          const d = this.somarDiasISO(inicio, i);
          dias.push({
            data: d,
            passou: d <= hoje,
            hoje: d === hoje,
            marcada: daTarefa.some(e => String(e.date) === d),
          });
        }
        const feitos = dias.filter(d => d.marcada).length;
        const deHoje = daTarefa.find(e => String(e.date) === hoje);
        const bonus = this.all('kid_entries').find(e =>
          e.kid_id === kidId && e.tipo === 'bonus' && e.task_id === t.id && String(e.date) >= inicio);

        return {
          ...t, diaria: true, dias, feitos,
          /* "feita" numa diária quer dizer FEITA HOJE. É o que a tela precisa para
             decidir se o botão de hoje já foi usado — e o que impede a diária de
             parecer concluída na segunda e ficar assim a semana toda, que era o
             comportamento antigo aplicado a ela. */
          feita: !!deHoje,
          confirmada: deHoje ? deHoje.confirmada !== false : false,
          entryId: deHoje ? deHoje.id : null,
          completou: feitos >= 7,
          bonusId: bonus ? bonus.id : null,
          bonusPago: bonus ? bonus.confirmada !== false : false,
        };
      });
  },

  /* A SEMANADA A DIVIDIR.

     O adulto paga a semanada inteira no pote GASTAR — é o dinheiro chegando, sem
     opinião. A divisão nos três potes é o momento de aprendizado, e é aqui, no
     app dela. Uma semanada só espera divisão se a criança ainda não mexeu nela
     nesta semana: se já dividiu, o ritual está cumprido. */
  /* O QUE ESPERA A DECISÃO DELA.

     Duas coisas passam por aqui: a semanada e o SALDO DE ABERTURA — o dinheiro
     que a criança já tinha quando o cofrinho começou.

     O VALOR É LIMITADO PELO SALDO DO POTE, e esta linha nasceu de um estrago real.

     A marca `repartido` era a única barreira, e ela some: a coluna chegou depois e
     está em COLUNAS_OPCIONAIS, então num banco sem ela o push descarta a marca e o
     pull traz o registro limpo. O ritual reabria, a criança repartia de novo, e o
     mesmo dinheiro entrava duas vezes no pote guardar. Medido numa base real: o
     pote gastar ficou em −R$ 54 e o guardar em R$ 121 em vez de R$ 61.

     A lição é de desenho: coluna opcional serve para dado acessório, nunca para a
     regra que decide se dinheiro se move. Agora quem manda é o SALDO — que é
     derivado dos lançamentos e não depende de coluna nenhuma. A marca continua
     existindo, mas só para destacar o convite; se ela se perder, o pior caso é o
     convite reaparecer, e repartir dinheiro que ela realmente tem é legítimo. */
  aRepartir(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const disponivel = this.potes(kidId).gastar;
    if (!(disponivel > 0)) return null;          // nada em gastar, nada a repartir

    const pendente = e => e.kid_id === kidId && e.pote === 'gastar'
      && e.repartido !== true && (Number(e.amount) || 0) > 0;
    const limitar = v => Math.min(Number(v) || 0, disponivel);

    const abertura = this.all('kid_entries').find(e => pendente(e) && e.tipo === 'inicial');
    if (abertura) return { entry: abertura, valor: limitar(abertura.amount), abertura: true };

    const inicio = this.inicioDaSemana(kid);
    const sem = this.all('kid_entries').find(e =>
      pendente(e) && e.tipo === 'semanada' && String(e.date) >= inicio);
    if (!sem) return null;

    /* Compatibilidade com semanadas gravadas ANTES da marca existir: para elas a
       pergunta antiga (houve divisão nesta semana?) é a única resposta possível.
       Sem isto, toda semanada já repartida em versão anterior voltaria a pedir o
       ritual. Ver o teste do legado em tests/cofrinho.js. */
    if (sem.repartido === undefined) {
      const jaDividiu = this.all('kid_entries').some(e =>
        e.kid_id === kidId && e.tipo === 'divisao' && String(e.date) >= inicio);
      if (jaDividiu) return null;
    }
    return { entry: sem, valor: limitar(sem.amount), abertura: false };
  },

  /* PODE REPARTIR A QUALQUER MOMENTO, e não só quando o dinheiro chega.

     Faltava: se a criança deixasse tudo em gastar — ou se o convite não abrisse —,
     não havia caminho nenhum para depois decidir guardar. E "hoje eu quero guardar
     isso" é exatamente a decisão que o app existe para incentivar; recusá-la
     ensinava que guardar só vale no instante em que o dinheiro cai. */
  podeRepartir(kidId) { return this.potes(kidId).gastar > 0; },
  // Nome antigo, mantido enquanto houver chamada por aí
  semanadaADividir(kidId) { return this.aRepartir(kidId); },

  /* DE QUANTO EM QUANTO O BOTÃO SOMA no ritual.

     R$ 1 é o passo natural: contar moedas de um real é a conta que a criança faz.
     Mas o saldo de abertura pode ser muito maior que uma semanada — repartir R$ 70
     de um em um são 70 toques, e ela desiste no meio ou aprende que repartir é
     castigo.

     A regra vive aqui, e não na tela, para poder ser medida: dentro da função que
     desenha, o teste só conseguia refazer a mesma conta ao lado e comparar consigo
     mesmo — e a sabotagem que fixava o passo em R$ 1 passava verde. */
  passoDoRitual(total) {
    const v = Number(total) || 0;
    if (v >= 40) return 5;
    if (v >= 20) return 2;
    if (v >= 3) return 1;
    return 0.5;
  },

  // Quantos toques a criança precisa para repartir tudo, no pior caso
  toquesDoRitual(total) {
    const passo = this.passoDoRitual(total);
    return passo > 0 ? Math.ceil((Number(total) || 0) / passo) : 0;
  },

  /* DIVIDIR: três lançamentos de 'divisao' que somam zero.

     Podia ser um só, mudando o pote da semanada. Não é, por dois motivos: o
     histórico dela precisa MOSTRAR a escolha ("guardei 3, doei 1"), e o registro
     original da semanada não pode ser reescrito — ele é do adulto, e o app da
     criança nunca reescreve o que o adulto lançou. */
  /* REPARTIR: três lançamentos de "divisao" que somam zero.

     Podia ser um só, mudando o pote da entrada. Não é, por dois motivos: o
     histórico dela precisa MOSTRAR a escolha ("guardei 3, doei 1"), e o registro
     original é do adulto — o app da criança nunca reescreve o que ele lançou.

     NÃO MOVE MAIS DO QUE EXISTE NO POTE. É a proteção que faltava: sem ela, o
     ritual reaberto por marca perdida repartiu o mesmo dinheiro duas vezes e o
     pote gastar foi para −R$ 54. Um cofrinho que deixa o pote negativo perdeu o
     direito de ensinar que dinheiro acaba. */
  dividir(kidId, guardar, doar) {
    const hoje = this.hojeISO();
    const g = Math.max(0, Number(guardar) || 0);
    const d = Math.max(0, Number(doar) || 0);
    const disponivel = this.potes(kidId).gastar;
    if (g + d > disponivel + 0.005) return false;

    const origem = this.aRepartir(kidId);
    const fechar = () => {
      if (origem) this.upsert('kid_entries', { ...origem.entry, repartido: true });
    };
    const rotulo = origem && origem.abertura ? 'Reparti o meu dinheiro' : 'Guardei um pouco';

    if (g + d <= 0) {
      /* Escolheu não repartir. O registro existe assim mesmo, para o convite não
         ficar pedindo para sempre uma decisão que já foi tomada. */
      this.upsert('kid_entries', {
        kid_id: kidId, tipo: 'divisao', pote: 'gastar', amount: 0,
        date: hoje, description: 'Deixei tudo para gastar', confirmada: true,
      });
      fechar();
      return true;
    }
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'gastar', amount: -(g + d),
      date: hoje, description: rotulo, confirmada: true,
    });
    if (g > 0) this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'guardar', amount: g,
      date: hoje, description: 'Para guardar', confirmada: true,
    });
    if (d > 0) this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'divisao', pote: 'doar', amount: d,
      date: hoje, description: 'Para doar', confirmada: true,
    });
    fechar();
    return true;
  },
  /* MARCAR TAREFA: nasce sem confirmação, e é isso que a torna honesta.

     O dinheiro não entra no pote enquanto o adulto não vir. Se entrasse na hora,
     o app estaria pagando por dizer que fez — e a criança aprenderia a dizer.

     NA DIÁRIA, a marcação do dia vale ZERO e já nasce confirmada: não há dinheiro
     em jogo, então não há o que conferir, e pedir sete confirmações por semana por
     tarefa faria o adulto parar de conferir qualquer coisa. O que ele confirma é o
     BÔNUS, uma vez, quando a semana fecha. */
  marcarTarefa(kidId, taskId) {
    const t = this.get('kid_tasks', taskId);
    if (!t) return false;
    const ja = this.tarefas(kidId).find(x => x.id === taskId);
    if (!ja) return false;

    /* A ESPECIAL EXPIRADA NÃO ACEITA MARCAÇÃO. O prazo é o contorno do combinado:
       aceitar depois esvaziaria o prazo, e o app estaria dizendo que o "até
       domingo" era decoração. */
    if (ja.especial && ja.expirada) return false;

    if (ja.diaria) {
      if (ja.feita) return false;                 // hoje já foi marcado
      this.upsert('kid_entries', {
        kid_id: kidId, tipo: 'tarefa', pote: 'gastar', amount: 0,
        date: this.hojeISO(), description: t.name, task_id: taskId, confirmada: true,
      });
      this.acertarBonus(kidId, taskId);
      return true;
    }

    if (ja.feita) return false;
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'tarefa', pote: 'gastar', amount: Number(t.amount) || 0,
      date: this.hojeISO(), description: t.name, task_id: taskId, confirmada: false,
    });
    return true;
  },

  desmarcarTarefa(kidId, taskId) {
    const t = this.tarefas(kidId).find(x => x.id === taskId);
    if (!t || !t.feita) return false;
    if (!t.diaria && t.confirmada) return false;  // semanal e especial confirmadas não se desfazem
    /* NA DIÁRIA, desmarcar hoje é permitido mesmo estando "confirmada": a marcação
       do dia vale zero e nasce confirmada por construção, então tratá-la como
       intocável trancaria a criança num toque errado. O que não se desfaz é o
       BÔNUS já pago — e é o acertarBonus abaixo que cuida disso. */
    if (t.diaria && t.bonusPago) return false;
    this.remove('kid_entries', t.entryId);
    if (t.diaria) this.acertarBonus(kidId, taskId);
    return true;
  },

  /* O BÔNUS DA SEMANA CHEIA, criado e desfeito conforme a sequência.

     Nasce pendente (confirmada: false) e entra na mesma fila que o adulto já usa
     para conferir tarefas — o dinheiro só cai no pote depois que ele vê.

     E SAI se a sequência quebrar: se a criança desmarcar um dia antes de o adulto
     confirmar, o bônus deixa de ser devido. Sem isto, bastava marcar os sete dias,
     desmarcar um e ficar com o bônus pendente para sempre. Bônus já confirmado não
     é mexido: o dinheiro está no pote, e retirar dali seria o app tomando de volta
     o que já deu. */
  acertarBonus(kidId, taskId) {
    const t = this.tarefas(kidId).find(x => x.id === taskId);
    if (!t || !t.diaria) return false;
    const valor = Number(t.amount) || 0;

    if (t.completou && !t.bonusId && valor > 0) {
      this.upsert('kid_entries', {
        kid_id: kidId, tipo: 'bonus', pote: 'gastar', amount: valor,
        date: this.hojeISO(), description: t.name + ' — a semana toda',
        task_id: taskId, confirmada: false,
      });
      return true;
    }
    if (!t.completou && t.bonusId && !t.bonusPago) {
      this.remove('kid_entries', t.bonusId);
      return true;
    }
    return false;
  },

  /* GASTAR e DOAR: só até onde o pote alcança.

     Recusar o que não cabe é a lição inteira do app. Um cofrinho que aceita
     gastar mais do que tem ensina exatamente o que a família está tentando
     evitar que ele aprenda depois, com cartão de crédito. */
  gastar(kidId, pote, valor, oque) {
    const v = Number(valor) || 0;
    if (v <= 0) return { ok: false, motivo: 'valor' };
    if (this.potes(kidId)[pote] < v) return { ok: false, motivo: 'falta' };
    /* NASCE PENDENTE, esperando um adulto conferir.

       A criança está aprendendo, e vai tocar sem querer — é o que ela faz com
       qualquer app. Antes o gasto era definitivo na hora, e agora ele DEBITA A
       CONTA DA FAMÍLIA: um toque de curiosidade mexeria no dinheiro real.

       Então o adulto confirma, como já faz com as tarefas. Recusar apaga o
       lançamento e o dinheiro volta inteiro para o pote. */
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: pote === 'doar' ? 'doacao' : 'gasto', pote,
      amount: v, date: this.hojeISO(), description: oque || (pote === 'doar' ? 'Doação' : 'Compra'),
      confirmada: false,
    });
    return { ok: true };
  },

  /* O SONHO ALCANÇADO: a hora de comprar.

     Faltava, e a falta esvaziava a lição. O pote guardar existe para virar a
     bicicleta; se o app enche a barra, toca o confete e depois não deixa comprar, o
     que ele ensinou foi a acumular — não a planejar. Guardar sem nunca realizar é
     privação com gráfico bonito.

     Sai do pote GUARDAR, no valor da meta, e encerra a meta. O que sobrou continua
     guardado: se ela juntou R$ 70 para um brinquedo de R$ 60, os R$ 10 são dela e
     ficam onde estão — tirar tudo seria cobrar pelo troco. */
  metaAlcancada(kidId) {
    const meta = this.meta(kidId);
    if (!meta) return null;
    const alvo = Number(meta.target_amount) || 0;
    if (!(alvo > 0)) return null;
    if (this.potes(kidId).guardar < alvo) return null;
    return { meta, valor: alvo };
  },

  /* COMPRAR O SONHO TAMBÉM ESPERA O ADULTO.

     Era a única saída do cofrinho que passava direto: criava o lançamento já
     confirmado e, na ponte seguinte, DEBITAVA A CONTA DA FAMÍLIA sem ninguém
     aprovar — e logo no maior valor que a criança movimenta. Um toque num botão
     dourado tirava R$ 60 da conta de quem paga.

     Agora nasce pendente, como todo gasto dela. O pote cai na hora (é saída, e
     saída pendente conta), então o retorno é imediato; o dinheiro só sai da conta
     quando o adulto confirma — que é, afinal, quando ele de fato compra o
     patinete.

     E A META NÃO É ENCERRADA AQUI. Fechá-la agora e ter de reabrir numa recusa
     deixaria a criança ver o sonho conquistado e depois desconquistado. Quem
     encerra é a confirmação — ver `metaAguardando`, que deriva o estado do
     lançamento pendente e não precisa de campo novo. */
  realizarSonho(kidId) {
    const pronto = this.metaAlcancada(kidId);
    if (!pronto) return false;
    if (this.metaAguardando(kidId)) return false;   // já pediu, não pede duas vezes
    this.upsert('kid_entries', {
      kid_id: kidId, tipo: 'gasto', pote: 'guardar', amount: pronto.valor,
      date: this.hojeISO(),
      description: `Comprei: ${pronto.meta.name}`,
      kid_goal_id: pronto.meta.id, confirmada: false,
    });
    return true;
  },

  /* O SONHO PEDIDO E AINDA NÃO CONFIRMADO.

     Derivado do lançamento pendente, sem campo novo: se existe um gasto pendente
     apontando para esta meta, ela está esperando. Um campo "aguardando" no banco
     seria um segundo lugar para a mesma verdade, e os dois divergiriam no primeiro
     erro — a regra da casa é derivar, nunca materializar. */
  metaAguardando(kidId) {
    const meta = this.meta(kidId);
    if (!meta) return null;
    const pedido = this.all('kid_entries').find(e =>
      e.kid_id === kidId && e.kid_goal_id === meta.id && e.confirmada === false);
    return pedido ? { meta, entry: pedido } : null;
  },

  /* ---------- A LISTA DE VONTADES ----------

     Existia UM sonho, cadastrado pelo adulto. Quando ela queria alguma coisa numa
     terça-feira, não havia onde botar: ou virava meta nova (e a anterior morria), ou
     sumia. Agora ela mesma anota, e o app pergunta depois.

     DORMIR SOBRE A VONTADE antes de comprar é a ferramenta mais citada contra a compra
     por impulso, e funciona em qualquer idade. Mas o ganho maior aqui é outro: ela vê os
     PRÓPRIOS desejos mudarem de ideia. Descobrir sozinha que "eu queria muito e agora
     não quero mais" ensina sobre impulso mais do que qualquer explicação de adulto — e é
     uma lição que não dá para dar de outro jeito.

     AS DUAS RESPOSTAS SÃO BOAS, e o app não pode preferir uma. "Ainda quero" não é
     teimosia: é uma vontade que sobreviveu ao tempo, que é exatamente o sinal de que
     vale virar meta. E "mudei de ideia" não é derrota — é a descoberta. */
  NOITES_DE_SONO: 3,

  vontades(kidId) {
    return this.all('kid_wishes')
      .filter(w => w.kid_id === kidId)
      .map(w => ({
        ...w,
        noites: w.criada_em ? Math.max(0, this.noitesAte(this.hojeISO(), w.criada_em)) : 0,
        /* MADURA = já dormiu as noites e ainda não foi perguntada. Só as maduras geram
           a pergunta; as recentes ficam quietas, porque perguntar no mesmo dia não
           testa nada. */
        madura: !w.resposta && !!w.criada_em
          && this.noitesAte(this.hojeISO(), w.criada_em) >= this.NOITES_DE_SONO,
      }))
      .sort((a, b) => String(b.criada_em || '').localeCompare(String(a.criada_em || '')));
  },

  /* A PRÓXIMA VONTADE A PERGUNTAR, uma de cada vez.

     Perguntar sobre quatro coisas de uma vez transforma a reflexão em formulário, e uma
     criança de seis anos responde qualquer coisa para o formulário acabar. A mais antiga
     primeiro: é a que teve mais tempo de mudar. */
  vontadeAPerguntar(kidId) {
    const maduras = this.vontades(kidId).filter(w => w.madura);
    return maduras.length ? maduras[maduras.length - 1] : null;
  },

  anotarVontade(kidId, nome, icone) {
    const n = String(nome || '').trim();
    if (!n) return { ok: false, motivo: 'vazio' };
    /* SEM REPETIR: anotar a mesma coisa duas vezes faria o app perguntar duas vezes, e a
       segunda pergunta desmente a primeira resposta. */
    const ja = this.vontades(kidId).find(w =>
      !w.resposta && w.name.toLowerCase() === n.toLowerCase());
    if (ja) return { ok: false, motivo: 'repetida' };
    const id = this.upsert('kid_wishes', {
      kid_id: kidId, name: n, icon: icone || '⭐',
      criada_em: this.hojeISO(), resposta: null, respondida_em: null,
    });
    return { ok: true, id };
  },

  /* A RESPOSTA FICA GUARDADA, e não apaga a vontade.

     Apagar o que ela deixou de querer apagaria justamente a lição: a lista das vontades
     que passaram é a prova, na letra dela, de que vontade passa. */
  responderVontade(kidId, id, resposta) {
    const w = this.get('kid_wishes', id);
    if (!w || w.kid_id !== kidId) return false;
    if (resposta !== 'quero' && resposta !== 'passou') return false;
    this.upsert('kid_wishes', { ...w, resposta, respondida_em: this.hojeISO() });
    return true;
  },

  /* O ELOGIO DE CADA RESPOSTA, aqui e não solto no handler da tela.

     AS DUAS SÃO CELEBRADAS, e isso é a regra: aplaudir só quem manteve a vontade
     ensinaria que mudar de ideia é errado -- quando é exatamente a descoberta que a lista
     existe para provocar. Ficou aqui porque uma regra que só existe dentro de um handler
     de clique não pode ser medida, e uma sabotagem que calou um dos dois elogios passou
     verde justamente por isso. */
  elogioDaResposta(resposta) {
    return resposta === 'quero'
      ? 'Você esperou e ainda quer! Isso é uma vontade de verdade 💪'
      : resposta === 'passou'
        ? 'Mudou de ideia! Que bom que você esperou para descobrir 🌟'
        : null;
  },

  esquecerVontade(kidId, id) {
    const w = this.get('kid_wishes', id);
    if (!w || w.kid_id !== kidId) return false;
    this.remove('kid_wishes', id);
    return true;
  },

  /* ---------- OS SONHOS JÁ CONQUISTADOS ----------

     O dado estava guardado e nunca aparecia. Toda meta comprada vira `done: true` com a
     data — o próprio comentário do app do adulto diz "encerrada, não apagada: o histórico
     dela precisa poder contar que este sonho existiu" — e o app da criança nunca contou.

     Aos seis anos a criança vive no presente absoluto. Sem ver o que já conquistou, cada
     meta nova começa do zero emocional, e esperar continua sendo uma coisa difícil que um
     adulto pede — em vez de uma coisa que ela já provou saber fazer.

     QUANTAS SEMANADAS ELA ESPEROU é a medida certa, e não a data: é a mesma unidade da
     barra do sonho e do custo de oportunidade, então a conquista fala a mesma língua da
     espera que a produziu. Sem `done_at` não dá para contar, e aí o sonho aparece sem o
     número — some a medida, não a conquista. */
  conquistas(kidId) {
    /* A ESPERA DE CADA SONHO COMEÇA ONDE O ANTERIOR TERMINOU, e a primeira versão errava
       isto: contava desde o primeiro dinheiro guardado na vida, então o segundo sonho
       herdava a espera do primeiro e o terceiro herdava as duas. Numa foto, um sonho de
       seis semanadas apareceu como onze.

       Errar aqui é pior que não mostrar. O número existe para dizer "você foi capaz de
       esperar tudo isso"; inflado, ele elogia uma espera que não houve — e a criança que
       sabe quanto tempo demorou aprende que o app exagera.

       Do sonho MAIS ANTIGO para o mais novo, cada um começando no fim do anterior. */
    const feitos = this.all('kid_goals')
      .filter(g => g.kid_id === kidId && g.done)
      .map(g => {
        const compra = this.all('kid_entries').find(e =>
          e.kid_id === kidId && e.kid_goal_id === g.id);
        return { meta: g, quando: g.done_at || (compra ? compra.date : null) };
      })
      .sort((a, b) => String(a.quando || '').localeCompare(String(b.quando || '')));

    /* O PRIMEIRO DINHEIRO GUARDADO na vida, marco zero do primeiro sonho. */
    const primeiro = this.all('kid_entries')
      .filter(e => e.kid_id === kidId && e.pote === 'guardar'
        && e.tipo !== 'gasto' && e.tipo !== 'doacao')
      .map(e => String(e.date)).sort()[0] || null;

    let desde = primeiro;
    const saida = feitos.map(f => {
      const dias = (desde && f.quando) ? this.noitesAte(f.quando, desde) : null;
      if (f.quando) desde = f.quando;
      return {
        meta: f.meta,
        quando: f.quando,
        /* Arredonda para cima e nunca abaixo de 1: um sonho conquistado em quatro dias
           ainda foi uma espera, e "esperou 0 semanadas" apagaria o esforço com um zero. */
        semanadas: (dias !== null && dias >= 0) ? Math.max(1, Math.ceil(dias / 7)) : null,
        valor: Number(f.meta.target_amount) || 0,
      };
    });

    /* Do mais novo para o mais velho na tela: a conquista recente é a que ela lembra, e a
       prateleira precisa abrir pelo que ela reconhece. */
    return saida.reverse();  },

  /* ---------- QUANTAS NOITES ATÉ A SEMANADA ----------

     As missões especiais já contam em noites, e foi para dar a ela um motivo de abrir o
     app. O evento mais importante da semana dela não contava nada até o dinheiro cair.

     A antecipação é metade do valor de uma recompensa, e é ela que treina a espera — não
     o recebimento. Uma criança contando as noites até a semanada está praticando de graça
     exatamente a habilidade que o cofrinho existe para ensinar.

     Devolve 0 no próprio dia (é hoje, não "faltam sete") e null sem semanada configurada,
     porque prometer um dia que não existe é pior que não prometer nada. */
  noitesAteSemanada(kidId, refISO) {
    const kid = this.get('kids', kidId);
    if (!kid || !(Number(kid.semanada_valor) > 0)) return null;
    const hoje = refISO || this.hojeISO();
    const d = new Date(hoje + 'T12:00:00');
    const alvo = Math.min(6, Math.max(0, Number(kid.semanada_dia) || 0));
    return (alvo - d.getDay() + 7) % 7;
  },

  /* ---------- O PREÇO EM COISAS QUE ELA CONHECE ----------

     Ela não sabe se R$ 60 é muito. Aos seis anos, R$ 5 e R$ 50 são os dois "um dinheiro",
     e a diferença é abstrata até virar coisa. O app já traduz preço em SEMANADAS, que
     responde "quando"; isto responde "quanto", que é outra pergunta.

     USA O PREÇO REAL DO QUE ELA COMPROU, e não uma tabela inventada: o sorvete da praça
     dela custa o que custa, e um valor de fábrica erraria justamente onde a comparação
     precisa acertar. Sem histórico não há tradução — e aí o app cala, em vez de chutar.

     A MEDIANA e não a média: uma vez que ela gastou R$ 30 num presente de aniversário
     puxaria a média do "brinquedo" para cima e faria o patinete parecer barato. */
  precoTipico(kidId, oque) {
    const vals = this.all('kid_entries')
      .filter(e => e.kid_id === kidId && e.tipo === 'gasto'
        && e.description === oque && Number(e.amount) > 0)
      .map(e => Number(e.amount))
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    return vals[Math.floor(vals.length / 2)];
  },

  /* A COISA MAIS COMPRADA que sirva de régua para um valor.

     Precisa de pelo menos duas compras: uma só pode ter sido um dia atípico, e uma régua
     construída sobre um acaso mede errado com a mesma confiança de uma régua boa.

     E a conta precisa dar um número que ela consiga imaginar. Acima de trinta, "45
     sorvetes" deixa de ser uma quantidade e vira "muitos" — que é o que ela já achava
     antes da tradução. Abaixo de dois, não há comparação nenhuma a fazer. */
  reguaDe(kidId, valor) {
    const v = Number(valor) || 0;
    if (!(v > 0)) return null;
    const conta = {};
    for (const e of this.all('kid_entries')) {
      if (e.kid_id !== kidId || e.tipo !== 'gasto' || !e.description) continue;
      if (!(Number(e.amount) > 0)) continue;
      conta[e.description] = (conta[e.description] || 0) + 1;
    }
    const candidatos = Object.keys(conta)
      .filter(nome => conta[nome] >= 2)
      .sort((a, b) => conta[b] - conta[a]);
    for (const nome of candidatos) {
      const preco = this.precoTipico(kidId, nome);
      if (!(preco > 0)) continue;
      const quantos = Math.round(v / preco);
      if (quantos >= 2 && quantos <= 30) return { nome, preco, quantos };
    }
    return null;
  },

  /* ---------- A MEMÓRIA DO POTE DE DOAR ----------

     Gastar devolve um brinquedo; guardar devolve um patinete. Doar devolve uma coisa que a
     criança não vê acontecer — e o que não se vê, aos seis anos, não existe. Sem memória,
     doar é apenas subtrair, e nenhuma criança aprende a gostar de subtrair.

     Conta apenas o CONFIRMADO: uma doação que o adulto ainda não aprovou pode não ter
     acontecido, e um total que encolhe depois de ter crescido desmente o próprio histórico. */
  doacoes(kidId) {
    const feitas = this.all('kid_entries').filter(e =>
      e.kid_id === kidId && e.tipo === 'doacao' && e.confirmada !== false && Number(e.amount) > 0);
    const porQuem = {};
    for (const e of feitas) {
      const q = e.description || 'quem precisa';
      porQuem[q] = (porQuem[q] || 0) + Number(e.amount);
    }
    return {
      vezes: feitas.length,
      total: +feitas.reduce((s, e) => s + Number(e.amount), 0).toFixed(2),
      quem: Object.keys(porQuem).sort((a, b) => porQuem[b] - porQuem[a]),
      ultima: feitas.map(e => String(e.date)).sort().pop() || null,
    };
  },

  /* ---------- A LIÇÃO DE CADA PRÊMIO ----------

     O prêmio bloqueado mostrava um cadeado e uma linha de texto, e o toque não fazia
     nada. Uma criança de seis anos olhava para "Dividiu a semanada nos potes" sem ter
     como saber o que fazer com aquilo — e o cadeado, sem caminho, é só uma porta fechada.

     CADA LIÇÃO USA O DINHEIRO DELA, e isto é a decisão de projeto mais importante aqui.
     Um exemplo genérico ("imagine que você tem R$ 100") ensina sobre dinheiro de
     brincadeira, e o que se aprende brincando não atravessa sozinho para a vida real —
     é justamente por isso que o cofrinho inteiro trabalha com o dinheiro verdadeiro dela.
     Aqui é a mesma regra: os números vêm dos potes dela, agora.

     E CADA UMA TERMINA NUM CAMINHO. Explicar sem oferecer o que fazer em seguida deixa a
     criança sabendo mais e podendo o mesmo — que é a forma mais elegante de frustração. */
  licaoDoSelo(kidId, id) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const p = this.potes(kidId);
    const meta = this.meta(kidId);
    const ts = this.tarefas(kidId);
    const rotina = ts.filter(t => !t.especial);
    const faltam = rotina.filter(t => !t.feita);
    const moeda = kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0;
    const semanada = Number(kid.semanada_valor) || 0;

    const licoes = {
      /* REPARTIR: a lição é que o mesmo dinheiro faz três trabalhos diferentes. */
      dividiu: {
        titulo: 'Repartir é dar um trabalho para cada moeda',
        oque: 'Todo dinheiro que chega pode ir para três lugares. Cada pote faz uma coisa diferente com ele.',
        pontos: [
          ['🛒', 'Gastar', 'é para usar agora, no que você quiser'],
          ['🏦', 'Guardar', 'fica esperando e vira uma coisa grande'],
          ['💝', 'Doar', 'ajuda alguém que precisa mais que você'],
        ],
        /* SEM SUGERIR PROPORÇÃO. Dizer "guarde metade" seria decidir por ela, e a decisão
           é o que esta tela existe para devolver. */
        comoFaz: 'Quando a semanada chegar, você escolhe quanto vai para cada pote.',
        botao: p.gastar > 0 ? { texto: 'Quero repartir agora', vai: 'ritual' } : null,
      },

      /* AS MISSÕES: a lição é sobre combinado cumprido, não sobre dinheiro. */
      tarefas: {
        titulo: 'Caprichoso é quem faz o que combinou',
        oque: rotina.length
          ? `Você tem ${rotina.length} ${rotina.length === 1 ? 'missão' : 'missões'}.`
            + ' Este prêmio é de quem cuidou de todas elas.'
          : 'Quando um adulto criar missões para você, elas aparecem aqui.',
        pontos: faltam.length
          ? faltam.slice(0, 3).map(t => [t.icon || '⭐', t.name,
              Number(t.amount) > 0 ? 'ainda falta' : 'ainda falta · sem moeda, mas conta'])
          : [['🏆', 'Todas feitas!', 'você já cuidou de tudo esta semana']],
        comoFaz: faltam.length
          ? 'Toque na missão quando você fizer. Um adulto confere depois.'
          : 'Você já fez a sua parte. O prêmio é seu.',
        botao: rotina.length ? { texto: 'Ver minhas missões', vai: 'tarefas' } : null,
      },

      /* A FORMIGUINHA: a única lição que precisa de uma demonstração, porque o efeito de
         "deixar quieto" só aparece no futuro — e o futuro é invisível aos seis anos. */
      guardou: {
        titulo: 'Dinheiro que fica quieto vira dinheiro grande',
        oque: 'Este prêmio é de quem não tirou nada do pote de guardar durante a semana inteira.',
        simulador: true,
        comoFaz: p.guardar > 0
          ? 'Deixe o pote de guardar quieto até a próxima semanada.'
          : 'Coloque um pouquinho no pote de guardar quando repartir.',
        botao: p.gastar > 0 ? { texto: 'Quero guardar um pouco', vai: 'ritual' } : null,
      },

      /* DOAR: a lição é que ajudar não empobrece — e o número dela prova. */
      doou: {
        titulo: 'Ajudar não deixa você com pouco',
        oque: 'Um pouquinho para você é muito para quem não tem nada. E você quase não sente falta.',
        pontos: p.total > 0
          ? [
              ['💰', 'Você tem', fmtMoeda(p.total)],
              ['💝', 'Se doar R$ 2', 'você fica com ' + fmtMoeda(Math.max(0, p.total - 2))],
              ['🙂', 'Quase igual', 'e alguém ficou muito melhor'],
            ]
          : [['💝', 'Doar', 'é dividir um pouco do que você tem']],
        comoFaz: 'Quando a semanada chegar, ponha um pouquinho no pote de doar.',
        botao: p.doar > 0
          ? { texto: 'Quero doar agora', vai: 'doar' }
          : (p.gastar > 0 ? { texto: 'Quero repartir para doar', vai: 'ritual' } : null),
      },

      /* A MOEDA MÁGICA: a lição é que a espera tem prêmio. */
      moeda: {
        titulo: 'Quem espera ganha uma moeda de presente',
        oque: moeda > 0
          ? `Se você não tirar nada do pote de guardar durante a semana, ganha`
            + ` ${fmtMoeda(moeda)} de presente na próxima semanada.`
          : 'A moeda mágica ainda não está ligada. Fale com um adulto!',
        pontos: moeda > 0
          ? [
              ['⏳', 'Você espera', 'a semana inteira sem tirar do guardar'],
              ['✨', 'O cofrinho dá', fmtMoeda(moeda) + ' de presente'],
              ['🎯', 'O seu sonho', 'chega mais rápido sem você fazer nada'],
            ]
          : [],
        comoFaz: 'É só não tirar do pote de guardar. Esperar já é o trabalho.',
        botao: null,
      },

      /* O SONHO: a lição é que uma coisa grande é feita de pedaços pequenos. */
      meta: {
        titulo: 'Uma coisa grande é feita de pedacinhos',
        oque: meta
          ? `O seu ${meta.name} custa ${fmtMoeda(Number(meta.target_amount) || 0)}.`
            + ' Ninguém junta isso de uma vez — junta um pouquinho por semanada.'
          : 'Escolha um sonho com um adulto. Aí você vê a barrinha andar toda semana.',
        pontos: meta
          ? [
              ['🎯', 'Você já tem', fmtMoeda(p.guardar)],
              ['📅', 'Cada semanada', semanada > 0
                ? 'coloca mais um pedaço' : 'vai colocando mais um pedaço'],
              ['🎉', 'E um dia', 'a barrinha enche e ele é seu'],
            ]
          : [],
        comoFaz: meta ? 'Guarde um pouquinho toda semanada. A barrinha mostra o resto.'
          : 'Um adulto cadastra o sonho, e a barrinha começa a andar.',
        botao: meta ? { texto: 'Ver o meu sonho', vai: 'sonho' } : null,
      },
    };

    const l = licoes[id];
    if (!l) return null;
    const selo = this.selos(kidId).find(s => s.id === id);
    return { ...l, id, ganho: !!(selo && selo.ganho), nome: selo ? selo.nome : '' };
  },

  /* ---------- O SIMULADOR DA FORMIGUINHA ----------

     A única lição que precisa de mais que texto: o efeito de deixar o dinheiro quieto só
     aparece no futuro, e o futuro é invisível aos seis anos. Aqui ela mexe num controle e
     vê o próprio dinheiro crescer — a manipulação é o que faz a ligação entre esperar e
     ter mais, que nenhuma frase constrói sozinha.

     COMEÇA DO QUE ELA TEM HOJE, não de um valor bonito. Um exemplo com R$ 100 seria mais
     fácil de ler e ensinaria sobre o dinheiro de outra pessoa. */
  crescimentoDoGuardado(kidId, semanas) {
    const kid = this.get('kids', kidId);
    if (!kid) return null;
    const n = Math.max(0, Math.min(8, Math.round(Number(semanas) || 0)));
    const hoje = this.potes(kidId).guardar;
    const semanada = Number(kid.semanada_valor) || 0;
    const moeda = kid.rendimento_tipo === 'moeda' ? (Number(kid.rendimento_valor) || 0) : 0;

    /* GUARDANDO METADE da semanada, e o app diz isso em voz alta: a proporção é uma
       suposição do exemplo, não uma recomendação. Sugerir quanto guardar seria decidir no
       lugar dela, e a divisão é dela desde o primeiro dia. */
    const porSemana = Math.floor(semanada / 2);
    const passos = [];
    let comMoeda = hoje, semMoeda = hoje;
    for (let k = 1; k <= n; k++) {
      comMoeda = +(comMoeda + porSemana + moeda).toFixed(2);
      semMoeda = +(semMoeda + porSemana).toFixed(2);
      passos.push({ semana: k, com: comMoeda, sem: semMoeda });
    }
    return {
      hoje, porSemana, moeda, semanas: n,
      passos,
      /* O GANHO DA ESPERA é a diferença entre as duas colunas: é o número que responde
         "para que serve esperar?" sem precisar de nenhuma palavra abstrata. */
      ganho: n ? +(comMoeda - semMoeda).toFixed(2) : 0,
      total: n ? comMoeda : hoje,
    };
  },

  /* SELOS DA SEMANA: o que ela conquistou, sem prometer nada em dinheiro.

     Selo é reconhecimento, não pagamento. Recompensa em dinheiro por tudo faz o
     efeito contrário do pretendido (superjustificação): a criança para de fazer
     pelo gosto e passa a fazer pelo preço, e some quando o preço some. */
  selos(kidId) {
    const kid = this.get('kids', kidId);
    if (!kid) return [];
    const inicio = this.inicioDaSemana(kid);
    const tarefas = this.tarefas(kidId);
    const semana = this.all('kid_entries').filter(e => e.kid_id === kidId && String(e.date) >= inicio);
    const p = this.potes(kidId);
    const meta = this.meta(kidId);
    return [
      {
        id: 'dividiu', nome: 'Repartidor', dica: 'Dividiu a semanada nos potes',
        ganho: semana.some(e => e.tipo === 'divisao'),
      },
      {
        id: 'tarefas', nome: 'Caprichoso', dica: 'Fez todas as tarefas da semana',
        ganho: tarefas.length > 0 && tarefas.every(t => t.feita),
      },
      {
        id: 'guardou', nome: 'Formiguinha', dica: 'Não tirou nada do pote de guardar',
        ganho: p.guardar > 0 && !semana.some(e => e.pote === 'guardar' && (e.tipo === 'gasto' || e.tipo === 'doacao')),
      },
      {
        id: 'doou', nome: 'Coração grande', dica: 'Colocou dinheiro no pote de doar',
        ganho: semana.some(e => e.pote === 'doar' && e.amount > 0),
      },
      {
        id: 'moeda', nome: 'Moeda mágica', dica: 'Esperou e o dinheiro rendeu',
        ganho: semana.some(e => e.tipo === 'rendimento'),
      },
      {
        id: 'meta', nome: 'Chegou lá!', dica: 'Alcançou o sonho que estava guardando',
        ganho: !!meta && p.guardar >= (Number(meta.target_amount) || 0),
      },
    ];
  },
};

/* ---------- A nuvem ---------- */

const Nuvem = {
  cfg: null,
  onStatus: null,

  carregar() {
    try { this.cfg = JSON.parse(localStorage.getItem(CHAVE_SYNC)) || {}; } catch (_) { this.cfg = {}; }
    const pre = (typeof window !== 'undefined' && window.FINANCAS_SUPABASE) || {};
    if (!this.cfg.url && pre.url) { this.cfg.url = pre.url.replace(/\/$/, ''); this.cfg.anonKey = pre.anonKey; }
    return this.cfg;
  },

  // Escreve na chave do app da família — ver o comentário do topo sobre rotação
  salvarSessao(d) {
    this.carregar();
    if (d.access_token) this.cfg.access_token = d.access_token;
    if (d.refresh_token) this.cfg.refresh_token = d.refresh_token;
    if (d.expires_in) this.cfg.token_exp = Date.now() + (d.expires_in - 60) * 1000;
    localStorage.setItem(CHAVE_SYNC, JSON.stringify(this.cfg));
  },

  pronta() { return !!(this.cfg && this.cfg.url && this.cfg.anonKey && this.cfg.refresh_token && this.cfg.family_id); },

  cabecalho() {
    const h = { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' };
    if (this.cfg.access_token) h.Authorization = 'Bearer ' + this.cfg.access_token;
    return h;
  },

  /* ---------- A RENOVAÇÃO DA SESSÃO, e por que ela precisa de tanto cuidado ----------

     OS DOIS APPS DIVIDEM O MESMO REFRESH TOKEN, na mesma chave do localStorage. Isso é
     de propósito: quem entra num app entra nos dois, e a criança não tem senha de
     e-mail para digitar.

     Só que o Supabase ROTACIONA o refresh token — cada uso invalida o anterior e devolve
     um novo. Se os dois apps renovarem por perto, o segundo apresenta um token que já
     foi gasto e leva "Invalid Refresh Token: Already Used". Pior: ele tenta de novo, com
     o mesmo token morto, e em poucos segundos chega no "Request rate limit reached" do
     servidor de autenticação.

     TRÊS BARREIRAS, e cada uma resolve um pedaço:

     1. RELER O DISCO ANTES DE RENOVAR. Se o outro app já renovou há dois segundos, o
        token bom está no localStorage e este app estava com uma cópia velha em memória.
        Reler resolve o caso mais comum sem nenhuma chamada de rede.

     2. UMA RENOVAÇÃO POR VEZ dentro do mesmo app. Sem isto, três telas pedindo dados ao
        mesmo tempo disparam três renovações — e duas delas nascem já condenadas.

     3. NÃO INSISTIR NO TOKEN MORTO. Quando o servidor diz que o token já foi usado,
        tentar de novo com o mesmo token só gasta a cota. O app relê o disco uma última
        vez, e se ainda estiver velho, para e pede login. */
  _renovando: null,

  async renovar() {
    /* Se já há uma renovação em andamento, espera a dela em vez de abrir outra. */
    if (this._renovando) return this._renovando;
    this._renovando = this._renovarDeVerdade().finally(() => { this._renovando = null; });
    return this._renovando;
  },

  async _renovarDeVerdade() {
    /* O OUTRO APP PODE TER RENOVADO. A cópia em memória fica velha no instante em que o
       app da família (ou outra aba) grava um token novo — reler é grátis e evita a
       maior parte das colisões. */
    const antes = this.cfg.access_token;
    this.carregar();
    if (this.cfg.access_token && this.cfg.access_token !== antes
        && this.cfg.token_exp && Date.now() < this.cfg.token_exp) {
      return;   // o outro app já renovou por nós
    }

    const res = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.cfg.refresh_token }),
    });
    const d = await res.json().catch(() => ({}));

    if (!res.ok || !d.access_token) {
      /* TOKEN JÁ USADO OU COTA ESTOURADA: o outro app pode ter acabado de renovar entre
         a leitura acima e esta resposta. Uma última olhada no disco antes de desistir —
         insistir com o mesmo token morto só queima a cota de autenticação. */
      const msg = String((d && (d.error_description || d.msg || d.error)) || '');
      this.carregar();
      if (this.cfg.access_token && this.cfg.token_exp && Date.now() < this.cfg.token_exp) return;
      throw new Error(/already used|rate limit/i.test(msg)
        ? 'o outro app renovou a sessão agora — tente de novo em instantes'
        : 'sessão expirada');
    }
    this.salvarSessao(d);
  },

  async garantirToken() {
    /* MARGEM DE 60 SEGUNDOS: um token que vence durante a viagem do pedido volta 401 e
       dispara uma renovação a mais — que é justamente o que estoura a cota. */
    const folga = 60000;
    if (!this.cfg.access_token || !this.cfg.token_exp
        || Date.now() > (this.cfg.token_exp - folga)) await this.renovar();
  },

  async rest(caminho, opcoes = {}) {
    await this.garantirToken();
    let res = await fetch(`${this.cfg.url}/rest/v1/${caminho}`, { ...opcoes, headers: this.cabecalho() });
    if (res.status === 401) {                 // token morreu antes da hora
      await this.renovar();
      res = await fetch(`${this.cfg.url}/rest/v1/${caminho}`, { ...opcoes, headers: this.cabecalho() });
    }
    if (!res.ok) throw new Error(`${res.status} em ${caminho}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : [];
  },

  paraEnvio(tabela, r) {
    const out = { id: r.id, family_id: this.cfg.family_id, updated_at: r.updated_at, deleted: !!r.deleted };
    for (const c of COLUNAS[tabela]) if (r[c] !== undefined) out[c] = r[c];
    return out;
  },

  /* A SINCRONIZAÇÃO, e por que ela é toda tolerante a falha.

     Este app roda no tablet de uma criança de seis anos, provavelmente longe do
     wi-fi e provavelmente com a bateria em 4%. Nada aqui pode travar a tela: o
     cofrinho funciona inteiro offline, e a nuvem é só o encontro com o app do
     adulto quando houver rede. Toda falha vira silêncio, nunca um alerta. */
  async sincronizar() {
    this.carregar();
    if (!this.pronta()) return false;
    let mudou = false;
    try {
      for (const t of TABELAS) {
        const sujos = (Dados.d[t] || []).filter(r => r.dirty);
        if (sujos.length) {
          await this.rest(t, {
            method: 'POST',
            headers: { ...this.cabecalho(), Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(sujos.map(r => this.paraEnvio(t, r))),
          });
          for (const r of sujos) delete r.dirty;
          mudou = true;
        }
      }
      for (const t of TABELAS) {
        const linhas = await this.rest(`${t}?family_id=eq.${this.cfg.family_id}&select=*`);
        const local = Dados.d[t];
        for (const remota of linhas) {
          const i = local.findIndex(r => r.id === remota.id);
          if (i < 0) { local.push({ ...remota, dirty: false }); mudou = true; continue; }
          // Conflito pelo relógio de quem editou: quem escreveu por último vence
          if (!local[i].dirty && String(remota.updated_at || '') >= String(local[i].updated_at || '')) {
            local[i] = { ...remota, dirty: false };
            mudou = true;
          }
        }
      }
      Dados.d.meta.lastSync = Dados.agora();
      Dados.salvar();
      if (this.onStatus) this.onStatus(true);
      return mudou;
    } catch (_) {
      if (this.onStatus) this.onStatus(false);
      return false;
    }
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = { Dados, Nuvem, CHAVE, CHAVE_SYNC, TABELAS, COLUNAS };
