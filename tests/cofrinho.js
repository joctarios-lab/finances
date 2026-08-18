/* Teste de fumaça do app da criança.

   É uma suíte SEPARADA de tests/smoke.js de propósito: os dois apps não
   compartilham código nem armazém, e juntar as duas suítes faria uma quebrar por
   causa da outra sem que nada de verdade tivesse quebrado.

   O que esta suíte protege, em ordem de importância:
   1. As contas do cofrinho batem com as do app da família — o mesmo saldo nas
      duas telas, sempre. Uma diferença aqui é a criança perdendo a confiança.
   2. Não dá para gastar o que não tem. É a lição inteira do app.
   3. A tarefa não paga sozinha: precisa do adulto.
   4. A semanada não some nem duplica no meio do ritual.

   O relógio é congelado pelo mesmo motivo da outra suíte: a semana do cofrinho
   começa no dia da semanada, e sem data fixa metade dos casos muda de resultado
   conforme o dia em que a suíte roda. */
'use strict';

const ANCORA = process.env.HOJE || '2026-08-12T10:00:00-03:00';
const DataReal = Date;
const instante = new DataReal(ANCORA).getTime();
class DataCongelada extends DataReal {
  constructor(...a) { if (a.length === 0) super(instante); else super(...a); }
  static now() { return instante; }
}
DataCongelada.parse = DataReal.parse;
DataCongelada.UTC = DataReal.UTC;
global.Date = DataCongelada;

const fs = require('fs');
const BASE = 'D:/Projetos/meus-projetos/financas/';

// ---- stubs de navegador ----
const armazem = base => ({
  getItem: k => (k in base ? base[k] : null),
  setItem: (k, v) => { base[k] = String(v); },
  removeItem: k => { delete base[k]; },
  key: i => Object.keys(base)[i] ?? null,
  get length() { return Object.keys(base).length; },
});
global.localStorage = armazem({});
global.sessionStorage = armazem({});

/* O WebCrypto do Node é o mesmo do navegador (randomUUID e subtle.digest), e é
   ele que o app usa. Não substituímos por um duplo: o hash do PIN é segurança,
   e testar contra uma imitação não provaria nada. Em Node 24 `globalThis.crypto`
   é um getter — atribuir por cima estoura em modo estrito. */
const nodeCrypto = require('crypto').webcrypto;

const els = {};
function makeEl(sel) {
  return {
    _sel: sel, innerHTML: '', textContent: '', value: '', dataset: {}, style: {
      setProperty() {}, removeProperty() {},
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, remove() {}, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    insertAdjacentHTML(_p, h) { this.innerHTML += h; },
    appendChild() {}, click() { if (this.onclick) this.onclick({}); },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
const elx = sel => els[sel] || (els[sel] = makeEl(sel));
const cliques = [];
global.document = {
  querySelector: sel => elx(sel),
  querySelectorAll: () => [],
  getElementById: id => elx('#' + id),
  createElement: () => makeEl('novo'),
  body: makeEl('body'),
  documentElement: makeEl('html'),
  addEventListener: (ev, fn) => { if (ev === 'click') cliques.push(fn); },
  visibilityState: 'visible',
};
global.window = global;
// navigator e fetch também são getters no Node moderno: define por cima
Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
Object.defineProperty(global, 'fetch', {
  value: async () => { throw new Error('sem rede no teste'); }, configurable: true, writable: true,
});
/* setTimeout roda na hora: o app usa atraso para animar e para juntar gravações
   em lote, e esperar de verdade só faria a suíte levar segundos sem testar nada
   a mais. clearTimeout existe porque a ponte do cofrinho o usa para juntar. */
global.setTimeout = (fn) => { try { fn(); } catch (_) { } return 0; };
global.clearTimeout = () => { };

// ---- carrega os módulos reais do app da criança ----
eval(fs.readFileSync(BASE + 'cofrinho/js/arte.js', 'utf8') + '; global.Arte = Arte;');
eval(fs.readFileSync(BASE + 'cofrinho/js/dados.js', 'utf8') + '; global.Dados = Dados; global.Nuvem = Nuvem; global.COLUNAS_KID = COLUNAS; global.TABELAS_KID = TABELAS;');
eval(fs.readFileSync(BASE + 'cofrinho/js/cofrinho.js', 'utf8') + `; Object.assign(global, {
  App, fmtKid, diaBonito, hashDaSenha, esc, telaQuem, telaSenha, telaCofrinho, telaTarefas,
  telaSonho, telaSelos, telaRitual, telaGastar, telaEscolha, telaExtrato, telaSemCrianca, historico, barraDeAbas,
  render, entrar, sair, clarear, sombrear, Som, aviso, festa,
});`);

let pass = 0, fail = 0;
function check(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (ok) { pass++; console.log(`  OK   | ${nome}`); }
  else { fail++; console.log(` FALHA | ${nome.padEnd(52)} obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`); }
}
const tela = () => elx('#app').innerHTML;

Dados.carregar();
const HOJE = Dados.hojeISO();
const DIA = new Date(HOJE + 'T12:00:00').getDay();

function novaCrianca(extra = {}) {
  const id = Dados.upsert('kids', {
    name: 'Piloto', avatar: '🦖', cor: '#00b894',
    semanada_valor: 8, semanada_dia: DIA,
    rendimento_tipo: 'moeda', rendimento_valor: 1, active: true, ...extra,
  });
  return id;
}
function limpar(id) {
  for (const t of ['kid_entries', 'kid_tasks', 'kid_goals']) {
    for (const r of Dados.all(t).filter(x => x.kid_id === id)) Dados.remove(t, r.id);
  }
  Dados.remove('kids', id);
}

/* ================= Os potes ================= */
console.log('\n=== Os três potes ===');
{
  const id = novaCrianca();
  check('cofrinho novo começa zerado', Dados.potes(id).total, 0);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'presente', pote: 'guardar', amount: 50, date: HOJE, confirmada: true });
  const p = Dados.potes(id);
  check('cada entrada cai no seu pote', [p.gastar, p.guardar, p.doar], [10, 50, 0]);
  check('  e o total é a soma dos três', p.total, 60);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'gasto', pote: 'gastar', amount: 4, date: HOJE, confirmada: true });
  check('gasto tira do pote de onde saiu', Dados.potes(id).gastar, 6);
  check('  sem mexer nos outros', Dados.potes(id).guardar, 50);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'doacao', pote: 'doar', amount: 2, date: HOJE, confirmada: true });
  check('doação também é saída', Dados.potes(id).doar, -2);

  /* TAREFA NÃO CONFIRMADA NÃO CONTA. Se contasse, a criança marcaria a tarefa,
     veria o dinheiro aparecer e depois veria sumir quando o adulto recusasse —
     e o cofrinho teria mentido para ela. */
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'tarefa', pote: 'gastar', amount: 3, date: HOJE, confirmada: false });
  check('tarefa esperando conferência não entra no saldo', Dados.potes(id).gastar, 6);
  limpar(id);
}

/* ================= O mesmo saldo dos dois lados ================= */
console.log('\n=== A conta bate com a do app da família ===');
{
  /* Esta é a razão de o cálculo estar duplicado nos dois apps em vez de
     importado: eles são artefatos separados, com armazéns separados. O que
     garante que não divirjam é este teste, que roda a MESMA cena nas duas
     implementações e compara. Se alguém mexer num lado só, cai aqui. */
  const dbSrc = fs.readFileSync(BASE + 'js/db.js', 'utf8');
  const trecho = nome => {
    const i = dbSrc.indexOf(`  ${nome}(`);
    if (i < 0) throw new Error('não achei ' + nome + ' em js/db.js');
    return dbSrc.slice(i, dbSrc.indexOf('\n  },', i) + 5);
  };
  // Reconstrói só as funções de conta do app da família, sobre os MESMOS dados
  const Familia = eval(`({
    all: t => Dados.all(t),
    get: (t, id) => Dados.get(t, id),
    hojeISO: () => Dados.hojeISO(),
    paraISO: d => Dados.paraISO(d),
    somarDiasISO: (i, n) => Dados.somarDiasISO(i, n),
    ${trecho('kidPotes')}
    ${trecho('kidInicioDaSemana')}
    ${trecho('kidTarefas')}
    ${trecho('kidSemanadasParaMeta')}
    kidMeta(kidId) { return Dados.meta(kidId); },
  })`);

  const id = novaCrianca();
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'divisao', pote: 'gastar', amount: -3, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'divisao', pote: 'guardar', amount: 2, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'divisao', pote: 'doar', amount: 1, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'gasto', pote: 'gastar', amount: 2, date: HOJE, confirmada: true });

  check('os potes dão o mesmo nos dois apps', Dados.potes(id), Familia.kidPotes(id));
  check('a semana começa no mesmo dia nos dois',
    Dados.inicioDaSemana(Dados.get('kids', id)), Familia.kidInicioDaSemana(Dados.get('kids', id)));

  Dados.upsert('kid_tasks', { kid_id: id, name: 'Arrumar a cama', icon: '🛏️', amount: 2, active: true });
  check('a lista de tarefas dá o mesmo nos dois',
    Dados.tarefas(id).map(t => [t.name, t.feita]), Familia.kidTarefas(id).map(t => [t.name, t.feita]));

  Dados.upsert('kid_goals', { kid_id: id, name: 'Lego', icon: '🧱', target_amount: 30, done: false });
  check('as semanadas que faltam dão o mesmo nos dois',
    Dados.semanasParaMeta(id), Familia.kidSemanadasParaMeta(id));
  limpar(id);
}

/* ================= O ritual da semanada ================= */
console.log('\n=== Repartir a semanada ===');
{
  const id = novaCrianca();
  check('sem semanada lançada, não há o que repartir', Dados.semanadaADividir(id), null);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, description: 'Semanada', confirmada: true });
  const r = Dados.semanadaADividir(id);
  check('a semanada da semana pede divisão', r && r.valor, 8);

  Dados.dividir(id, 3, 1);
  const p = Dados.potes(id);
  check('o que ela guardou foi para o pote guardar', p.guardar, 3);
  check('o que ela doou foi para o pote doar', p.doar, 1);
  check('o resto ficou em gastar', p.gastar, 4);
  /* O TOTAL NÃO MUDA na divisão. Repartir não é ganhar nem perder — se o total
     mudasse, o app estaria criando ou sumindo com dinheiro no meio do ritual. */
  check('o total continua o mesmo depois de repartir', p.total, 8);
  check('  e o ritual não pede de novo nesta semana', Dados.semanadaADividir(id), null);

  // Ela pode decidir não repartir, e essa decisão também fica registrada
  const id2 = novaCrianca();
  Dados.upsert('kid_entries', { kid_id: id2, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true });
  Dados.dividir(id2, 0, 0);
  check('deixar tudo em gastar também encerra o ritual', Dados.semanadaADividir(id2), null);
  check('  sem mexer no saldo', Dados.potes(id2).gastar, 8);

  // Semanada da semana passada não reabre o ritual desta
  const id3 = novaCrianca();
  Dados.upsert('kid_entries', {
    kid_id: id3, tipo: 'semanada', pote: 'gastar', amount: 8,
    date: Dados.somarDiasISO(HOJE, -9), confirmada: true,
  });
  check('semanada velha não pede divisão hoje', Dados.semanadaADividir(id3), null);
  limpar(id); limpar(id2); limpar(id3);
}

/* ================= A semana do cofrinho ================= */
console.log('\n=== Onde a semana começa ===');
{
  /* Os cenários acima usam semanada_dia = hoje, o que deixa o RECUO sem
     exercício: com o início da semana caindo sempre no dia de execução, um
     recuo errado dá o mesmo resultado que o certo. Aqui o dia da semanada é
     cada um dos sete, e a conta é conferida contra o calendário. */
  for (let dia = 0; dia < 7; dia++) {
    const id = novaCrianca({ semanada_dia: dia });
    const inicio = Dados.inicioDaSemana(Dados.get('kids', id));
    const d = new Date(inicio + 'T12:00:00');
    check(`semanada no dia ${dia}: a semana começa nesse dia da semana`, d.getDay(), dia);
    check('  e nunca no futuro', inicio <= HOJE, true);
    check('  nem mais de seis dias atrás', inicio >= Dados.somarDiasISO(HOJE, -6), true);
    limpar(id);
  }

  /* A VIRADA DE SEMANA é o caso que quebra na prática: a semanada de sábado, na
     segunda seguinte, já é de OUTRA semana — e o ritual tem que reabrir. Se a
     conta usasse "últimos sete dias" em vez do dia da semanada, a criança
     receberia a semanada nova e o app ainda acharia que a antiga estava por
     repartir. */
  const ontem = new Date(Dados.somarDiasISO(HOJE, -1) + 'T12:00:00').getDay();
  const id = novaCrianca({ semanada_dia: ontem });
  const inicio = Dados.inicioDaSemana(Dados.get('kids', id));
  check('semanada de ontem: a semana começou ontem', inicio, Dados.somarDiasISO(HOJE, -1));

  // Lançada ANTES do início desta semana: é da semana passada, não pede divisão
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8,
    date: Dados.somarDiasISO(inicio, -1), confirmada: true,
  });
  check('  e a semanada de antes dela não pede divisão', Dados.semanadaADividir(id), null);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: inicio, confirmada: true });
  check('  já a desta semana pede', Dados.semanadaADividir(id) !== null, true);

  /* OS SELOS TAMBÉM RECOMEÇAM na virada, e por isso olham só o que aconteceu
     desde o início da semana — um selo que nunca zera deixa de ser da semana. */
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'divisao', pote: 'doar', amount: 2,
    date: Dados.somarDiasISO(inicio, -2), confirmada: true,
  });
  check('  e a doação da semana passada não dá selo esta semana',
    Dados.selos(id).find(s => s.id === 'doou').ganho, false);
  limpar(id);
}

/* ================= O saldo de abertura passa pelo ritual ================= */
console.log('\n=== A criança reparte o que já tinha ===');
{
  /* O saldo de abertura ia direto para o pote que o adulto escolheu, e a criança
     perdia o melhor primeiro contato com o app: decidir onde o dinheiro DELA vai.
     Agora ele passa pelo mesmo ritual da semanada. */
  const idA = novaCrianca({ name: 'Abertura' });
  const semanaPassada = Dados.somarDiasISO(HOJE, -7);
  Dados.upsert('kid_entries', {
    kid_id: idA, tipo: 'inicial', pote: 'gastar', amount: 70,
    date: semanaPassada, description: 'O que ele já tinha', confirmada: true,
  });

  /* DATADO NO PASSADO e ainda assim aparece. É o caso que a janela semanal não
     pegava: o dinheiro que a criança já tinha não chegou hoje, e a busca por
     "desta semana" nunca o encontrava. */
  const r = Dados.aRepartir(idA);
  check('o saldo de abertura pede para ser repartido', !!r, true);
  check('  mesmo datado na semana passada', r.entry.date, semanaPassada);
  check('  com o valor inteiro', r.valor, 70);
  check('  e o app sabe que é a abertura, não a semanada', r.abertura, true);

  /* O TOTAL NÃO MUDA ao repartir: é o mesmo dinheiro trocando de pote. */
  Dados.dividir(idA, 40, 10);
  const p = Dados.potes(idA);
  check('repartir move para os potes escolhidos', [p.gastar, p.guardar, p.doar], [20, 40, 10]);
  check('  sem mudar o total', p.total, 70);

  /* NÃO PEDE DE NOVO. Era o defeito que a marca resolve: sem ela, o app perguntava
     ao calendário e o lançamento datado no passado voltava a pedir para sempre —
     a criança repartia, saía da tela e o ritual reaparecia. */
  check('e não pede de novo depois de repartido', Dados.aRepartir(idA), null);
  const t2 = telaCofrinho ? true : true;
  App.kid = Dados.get('kids', idA);
  /* O CONVITE DESTACADO sai; o botão discreto FICA.

     São dois estados do mesmo caminho, e a diferença importa: o convite dourado
     que pulsa chama a criança quando chega dinheiro novo, e some depois de
     atendido. O botão claro "Quero guardar um pouco" permanece enquanto houver
     dinheiro no pote gastar, porque decidir guardar é válido em qualquer dia — e
     não havia caminho nenhum para isso antes. */
  const depois = telaCofrinho();
  check('  o convite destacado sai da tela', /bt ouro chama[^>]*id="ir-ritual"/.test(depois), false);
  check('  mas o botão de guardar continua', depois.includes('Quero guardar um pouco'), true);

  /* A SEMANADA DEPOIS DA ABERTURA continua funcionando, e vem depois dela: a
     abertura é uma vez na vida do cofrinho, e é o primeiro contato. */
  /* Com a marca explícita, que é como o app da família grava (ver pagarSemanada).
     Sem ela o registro parece LEGADO — de antes da marca existir — e o app cai no
     caminho de compatibilidade, deixando o calendário decidir. */
  Dados.upsert('kid_entries', {
    kid_id: idA, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE,
    confirmada: true, repartido: false,
  });
  const r2 = Dados.aRepartir(idA);
  check('a semanada da semana também pede ritual', !!r2 && r2.valor, 8);
  check('  e agora não é abertura', r2.abertura, false);
  limpar(idA);

/* O LEGADO: semanada gravada ANTES da marca existir.

     Ela não tem o campo — nem true nem false —, e para ela a única resposta
     possível é a pergunta antiga: houve divisão nesta semana? Sem esse caminho,
     toda semanada já repartida em versão anterior voltaria a pedir o ritual, e a
     criança repartiria DE NOVO, tirando mais do pote gastar. */
  const idL = novaCrianca({ name: 'Legado' });
  Dados.upsert('kid_entries', {
    kid_id: idL, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true,
  });
  check('semanada legada, sem a marca, pede o ritual', !!Dados.aRepartir(idL), true);
  check('  e de fato não tem a marca', Dados.aRepartir(idL).entry.repartido, undefined);
  Dados.dividir(idL, 3, 0);
  check('  depois de repartida, não pede de novo', Dados.aRepartir(idL), null);
  /* E aqui está o motivo de o caminho existir: mesmo que a marca não pegue no
     registro legado, a divisão da semana o segura. */
  Dados.upsert('kid_entries', {
    kid_id: idL, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true,
  });
  check('  e outra semanada legada da mesma semana também não', Dados.aRepartir(idL), null);
  limpar(idL);

  /* A TELA DO RITUAL: o passo aparece no botão e o texto muda com o caso.

     Duas sabotagens passaram verdes antes disto: a tela ignorando a regra do passo
     e o balão tratando o saldo de abertura como se fosse semanada. Nada olhava o
     HTML do ritual — só a regra, que a tela podia não usar. */
  const idT2 = novaCrianca({ name: 'Tela Ritual' });
  Dados.upsert('kid_entries', { kid_id: idT2, tipo: 'inicial', pote: 'gastar', amount: 70, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', idT2);
  telaRitual();
  const tr = tela();
  check('no ritual da abertura, o Dino diz que o dinheiro é dela',
    tr.includes('Este dinheiro é todo seu'), true);
  check('  e não fala de semanada', tr.includes('Chegou a sua semanada'), false);
  check('  o botão mostra quanto soma', tr.includes('data-passo="5"'), true);
  check('  com o número à vista, não um "+" solto', tr.includes('+5</button>'), true);

  /* SEMANADA PEQUENA: passo de R$ 1 e o texto da semanada. */
  Dados.dividir(idT2, 0, 0);
  Dados.upsert('kid_entries', { kid_id: idT2, tipo: 'semanada', pote: 'gastar', amount: 8,
    date: HOJE, confirmada: true, repartido: false });
  telaRitual();
  const tr2 = tela();
  check('no ritual da semanada, o texto é o da semanada', tr2.includes('Chegou a sua semanada'), true);
  check('  e o passo volta para R$ 1', tr2.includes('data-passo="1"'), true);
  limpar(idT2);
  /* A ORDEM: com abertura E semanada esperando, a abertura vem primeiro. É o
     dinheiro que já era dela, e é o que explica o cofrinho antes de qualquer
     rotina semanal. */
  const idO = novaCrianca({ name: 'Ordem' });
  Dados.upsert('kid_entries', { kid_id: idO, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true });
  Dados.upsert('kid_entries', { kid_id: idO, tipo: 'inicial', pote: 'gastar', amount: 50, date: HOJE, confirmada: true });
  check('com as duas esperando, a abertura vem primeiro', Dados.aRepartir(idO).abertura, true);
  check('  pelo valor dela', Dados.aRepartir(idO).valor, 50);
  limpar(idO);

  /* O QUE O ADULTO JÁ DESTINOU não volta para o ritual. Se ele lançou a abertura
     direto em "guardar", a decisão foi dele — pedir para a criança repartir de
     novo seria desfazer a escolha do adulto. */
  const idG = novaCrianca({ name: 'Ja Guardado' });
  Dados.upsert('kid_entries', { kid_id: idG, tipo: 'inicial', pote: 'guardar', amount: 60, date: HOJE, confirmada: true });
  check('abertura lançada em guardar não pede ritual', Dados.aRepartir(idG), null);
  check('  e o dinheiro está no pote que o adulto escolheu', Dados.potes(idG).guardar, 60);
  limpar(idG);

  /* O PASSO CRESCE COM O VALOR. Repartir R$ 70 de um em um são 70 toques: a
     criança desiste no meio, ou aprende que repartir é castigo.

     MEDIDO PELA REGRA DO APP, não por uma conta refeita aqui. A primeira versão
     deste teste calculava o passo do próprio lado e comparava consigo mesma — e a
     sabotagem que fixava o passo em R$ 1 passava verde. */
  check('semanada pequena soma de 1 em 1', Dados.passoDoRitual(8), 1);
  check('  valor de centavos soma de 50 em 50', Dados.passoDoRitual(2), 0.5);
  check('  a partir de R$ 20 soma de 2 em 2', Dados.passoDoRitual(20), 2);
  check('  e a partir de R$ 40 soma de 5 em 5', Dados.passoDoRitual(70), 5);
  /* O QUE IMPORTA É O NÚMERO DE TOQUES: é o que a criança sente na mão. */
  check('repartir R$ 70 leva no máximo 14 toques', Dados.toquesDoRitual(70) <= 14, true);
  check('  e nenhum valor até R$ 200 passa de 40 toques',
    [8, 20, 40, 70, 100, 150, 200].every(v => Dados.toquesDoRitual(v) <= 40), true);
  check('  sem virar passo grosso numa semanada pequena', Dados.toquesDoRitual(8), 8);

  const idP = novaCrianca({ name: 'Passo' });
  Dados.upsert('kid_entries', { kid_id: idP, tipo: 'inicial', pote: 'gastar', amount: 70, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', idP);
  telaRitual();
  check('o ritual de valor alto abre com os botões de somar', tela().includes('data-mais="guardar"'), true);
  limpar(idP);
}

/* ================= O extrato dela é imediato ================= */
console.log('\n=== A saída aparece no extrato na hora ===');
{
  /* O pote caía na hora e o histórico não mostrava nada: sumia dinheiro sem uma
     linha explicando por quê. Para quem está aprendendo o que é um extrato, isso é
     o pior ensinamento possível — a tela desmentia a própria tela. */
  const id = novaCrianca({ name: 'Extrato' });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE,
    confirmada: true, repartido: true });

  Dados.gastar(id, 'gastar', 4, 'Doce');
  const hist = Dados.entradas(id);
  check('o gasto pendente aparece no extrato dela', hist.some(e => e.description === 'Doce'), true);
  check('  e o pote já caiu', Dados.potes(id).gastar, 6);

  /* A TELA MOSTRA a linha e diz que está esperando: sem o aviso, ela pensaria que o
     dinheiro já foi e não entenderia se o adulto recusasse depois. */
  App.kid = Dados.get('kids', id);
  const tela1 = telaCofrinho();
  check('a tela do cofrinho mostra a linha', tela1.includes('Doce'), true);
  check('  marcada como esperando um adulto', tela1.includes('esperando um adulto'), true);

  /* RECUSADO, a linha SOME do extrato — que é exatamente o comportamento pedido. */
  const g = Dados.all('kid_entries').find(e => e.description === 'Doce');
  Dados.remove('kid_entries', g.id);
  check('recusado, a linha some do extrato',
    Dados.entradas(id).some(e => e.description === 'Doce'), false);
  check('  e o dinheiro volta ao pote', Dados.potes(id).gastar, 10);

  /* A DOAÇÃO segue a mesma regra: é saída, aparece na hora. */
  Dados.gastar(id, 'gastar', 2, 'Presente');
  check('a doação pendente também aparece',
    Dados.entradas(id).some(e => e.description === 'Presente'), true);

  /* A ENTRADA PENDENTE CONTINUA FORA. Mostrá-la seria dizer que a tarefa já foi
     paga antes de o adulto conferir, e a criança aprenderia a contar com dinheiro
     que ainda não é dela — é a mesma assimetria de `potes`. */
  const tar = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Regar', icon: '🪴', amount: 3, frequencia: 'semanal', active: true });
  Dados.marcarTarefa(id, tar);
  check('a tarefa pendente NÃO aparece no extrato',
    Dados.entradas(id).some(e => e.task_id === tar), false);
  check('  nem soma no pote', Dados.potes(id).gastar, 8);

  /* CONFIRMADA, aparece. */
  const marcada = Dados.all('kid_entries').find(e => e.task_id === tar);
  Dados.upsert('kid_entries', { ...marcada, confirmada: true });
  check('confirmada, a tarefa entra no extrato',
    Dados.entradas(id).some(e => e.task_id === tar), true);
  check('  e soma no pote', Dados.potes(id).gastar, 11);
  limpar(id);
}

/* ================= O sonho na primeira tela ================= */
console.log('\n=== A tela inicial diz o quão perto está o sonho ===');
{
  /* O pote de guardar mostrava um número e mais nada: R$ 30 não diz se ela está
     perto ou longe da bicicleta, e é a DISTÂNCIA que dá sentido a guardar. Sem
     isso o pote vira uma pilha que cresce sem destino. */
  const id = novaCrianca({ name: 'Perto', semanada_valor: 10, rendimento_valor: 0 });
  App.kid = Dados.get('kids', id);
  check('sem sonho, a tela inicial não inventa um', telaCofrinho().includes('sonho-mini'), false);

  Dados.upsert('kid_goals', {
    kid_id: id, name: 'Patinete', icon: '🛴', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });
  const t1 = telaCofrinho();
  check('com sonho, o resumo aparece na inicial', t1.includes('sonho-mini'), true);
  check('  com o nome do sonho', t1.includes('Patinete'), true);
  check('  o desenho dele', t1.includes('🛴'), true);
  /* EM SEMANADAS, a mesma unidade da aba do sonho: dois números diferentes para a
     mesma pergunta fariam ela desconfiar dos dois. */
  check('  e quantas semanadas faltam', t1.includes('Faltam 3 semanadas'), true);
  check('  dizendo também quanto já tem', t1.includes(fmtKid(30)) && t1.includes(fmtKid(60)), true);

  /* A BARRA acompanha o progresso: metade guardada, metade preenchida. */
  check('a barra reflete o progresso', t1.includes('width:50.0%'), true);

  /* CHEGOU: o texto muda para a conquista, e some a contagem. */
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 40, date: HOJE, confirmada: true });
  const t2 = telaCofrinho();
  check('alcançado, a inicial comemora', t2.includes('Já dá para comprar'), true);
  check('  e não fala mais em semanadas que faltam', t2.includes('Faltam'), false);

  /* O RESUMO É TOCÁVEL e leva à aba do sonho: é a pergunta natural depois de ver a
     barra. */
  check('o resumo leva ao sonho', t2.includes('data-ir-sonho'), true);
  limpar(id);
}

console.log('\n=== O extrato tem tela própria ===');
{
  /* A lista inteira empurrava os potes e os botões para fora da dobra: quem abre o
     cofrinho quer ver quanto tem e decidir o que fazer, não ler doze linhas. */
  const id = novaCrianca({ name: 'Extrato Tela' });
  for (let n = 0; n < 8; n++) {
    Dados.upsert('kid_entries', {
      kid_id: id, tipo: 'presente', pote: 'gastar', amount: 1,
      date: Dados.somarDiasISO(HOJE, -n), description: `Mov ${n}`, confirmada: true });
  }
  App.kid = Dados.get('kids', id);
  const ini = telaCofrinho();
  const linhas = (ini.match(/class="figurinha"/g) || []).length;
  check('a tela inicial mostra poucos movimentos', linhas, 3);
  check('  e oferece ver o resto', ini.includes('id="bt-extrato"'), true);

  telaExtrato();
  const tudo = tela();
  check('a tela do extrato mostra todos', (tudo.match(/class="figurinha"/g) || []).length, 8);
  check('  com caminho de volta', tudo.includes('id="ex-volta"'), true);

  /* COM POUCOS MOVIMENTOS o botão nem aparece: um caminho para uma tela que mostra
     o mesmo que a anterior é ruído. */
  limpar(id);
  const idP = novaCrianca({ name: 'Poucos' });
  Dados.upsert('kid_entries', {
    kid_id: idP, tipo: 'presente', pote: 'gastar', amount: 1, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', idP);
  check('com poucos movimentos, o botão não aparece',
    telaCofrinho().includes('id="bt-extrato"'), false);
  limpar(idP);
}

console.log('\n=== Os dois apps instalam lado a lado ===');
{
  /* O app da família tem escopo "/finances/" e o cofrinho "/finances/cofrinho/" —
     que está DENTRO do primeiro. Sem `id` no manifest, o Chrome identifica o app
     instalado pelo start_url e trata qualquer URL do escopo como "já é este app":
     abrir /cofrinho/ não oferecia instalar nada.

     O campo `id` existe para isto — ele, e não o escopo, passa a ser a identidade. */
  const mFam = JSON.parse(fs.readFileSync(BASE + 'manifest.webmanifest', 'utf8'));
  const mCof = JSON.parse(fs.readFileSync(BASE + 'cofrinho/manifest.webmanifest', 'utf8'));

  check('o app da família declara um id', !!mFam.id, true);
  check('  e o cofrinho também', !!mCof.id, true);
  check('  e eles são diferentes', mFam.id !== mCof.id, true);

  /* NOMES E ÍCONES DISTINTOS: dois atalhos iguais na tela inicial do tablet são
     indistinguíveis, e a criança abriria o app do adulto sem querer. */
  check('os nomes são diferentes', mFam.name !== mCof.name, true);
  check('  os nomes curtos também', mFam.short_name !== mCof.short_name, true);
  check('  e os ícones não se repetem',
    mFam.icons.every(a => mCof.icons.every(b => a.src !== b.src)), true);

  /* CADA UM COM O SEU service worker e o seu cache: publicar correção no app do
     adulto não pode reinstalar o app da criança no meio de um sábado. */
  const swFam = fs.readFileSync(BASE + 'sw.js', 'utf8');
  const swCof = fs.readFileSync(BASE + 'cofrinho/sw.js', 'utf8');
  check('cada app tem o seu cache', swFam.includes("'financas-' + VERSAO")
    && swCof.includes("'cofrinho-' + VERSAO"), true);
}

/* ================= O custo de oportunidade ================= */
console.log('\n=== Tirar do guardado adia o sonho, e ela vê antes ===');
{
  /* A consequência é INVISÍVEL: o sorvete acontece hoje e o atraso do patinete só
     se sente daqui a três semanas. Aos seis anos esse intervalo é longo demais para
     a ligação se formar sozinha — então o app faz a conta antes. */
  const id = novaCrianca({ name: 'Escolha', semanada_valor: 10, rendimento_valor: 0 });
  Dados.upsert('kid_goals', {
    kid_id: id, name: 'Patinete', icon: '🛴', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });

  check('faltam três semanadas para o sonho', Dados.semanasParaMeta(id), 3);

  /* A CONTA HIPOTÉTICA: e SE ela tirasse R$ 10? Faltariam 40, que a R$ 10 por semana
     são 4 semanadas — uma a mais. */
  const c = Dados.custoDoSaque(id, 10);
  check('o app calcula o custo do saque', !!c, true);
  check('  dizendo em quantas estava', c.antes, 3);
  check('  em quantas ficaria', c.depois, 4);
  check('  e o atraso em semanadas', c.atraso, 1);
  check('  com o nome do sonho em jogo', c.meta.name, 'Patinete');

  /* O ATRASO CRESCE COM O VALOR: é o que torna a tela uma escolha, e não um aviso
     genérico. Tirar R$ 30 zera o guardado e joga o sonho para 6 semanadas. */
  check('tirar mais adia mais', Dados.custoDoSaque(id, 30).atraso, 3);
  check('  e o total bate com o calendário', Dados.custoDoSaque(id, 30).depois, 6);

  /* NÃO MOSTRA QUANDO NÃO HÁ TROCA. Uma tela extra que não informa nada vira
     obstáculo, e o pote de gastar existe para ser gasto. */
  const idSemMeta = novaCrianca({ name: 'Sem meta' });
  check('sem meta, não há custo a mostrar', Dados.custoDoSaque(idSemMeta, 5), null);
  limpar(idSemMeta);

  const idSobra = novaCrianca({ name: 'Sobra', semanada_valor: 10, rendimento_valor: 0 });
  Dados.upsert('kid_goals', {
    kid_id: idSobra, name: 'Livro', icon: '📚', target_amount: 20, done: false });
  Dados.upsert('kid_entries', {
    kid_id: idSobra, tipo: 'presente', pote: 'guardar', amount: 100, date: HOJE, confirmada: true });
  check('com dinheiro de sobra, o saque não adia nada', Dados.custoDoSaque(idSobra, 10), null);
  limpar(idSobra);

  /* SEM SEMANADA não há ritmo para projetar, e inventar um número seria mentir sobre
     uma data que o app não tem como conhecer. */
  const idSemR = novaCrianca({ name: 'Sem ritmo', semanada_valor: 0, rendimento_valor: 0 });
  Dados.upsert('kid_goals', {
    kid_id: idSemR, name: 'Bola', icon: '⚽', target_amount: 50, done: false });
  Dados.upsert('kid_entries', {
    kid_id: idSemR, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });
  check('sem semanada, não há previsão para comparar', Dados.custoDoSaque(idSemR, 10), null);
  limpar(idSemR);

  /* A MOEDA MÁGICA FICA FORA da conta. Somar as duas coisas daria um número mais
     assustador e menos confiável: a moeda é condicional, o atraso é aritmético. */
  const idM = novaCrianca({ name: 'Com moeda', semanada_valor: 10, rendimento_valor: 2 });
  Dados.upsert('kid_goals', {
    kid_id: idM, name: 'Lego', icon: '🧱', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: idM, tipo: 'presente', pote: 'guardar', amount: 24, date: HOJE, confirmada: true });
  /* Faltam 36, a R$ 12 por semana (semanada + moeda) = 3 semanadas. */
  check('o ritmo inclui a moeda mágica, como no resto do app', Dados.semanasParaMeta(idM), 3);
  limpar(idM);
  limpar(id);
}

console.log('\n=== As duas estradas na tela ===');
{
  const id = novaCrianca({ name: 'Estradas', semanada_valor: 10, rendimento_valor: 0 });
  Dados.upsert('kid_goals', {
    kid_id: id, name: 'Patinete', icon: '🛴', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', id);

  let seguiu = false;
  telaEscolha('guardar', 10, 'Doce', () => { seguiu = true; });
  const t = tela();
  check('a tela mostra as duas estradas', (t.match(/class="estrada /g) || []).length, 2);
  check('  uma para usar agora', t.includes('id="es-agora"'), true);
  check('  outra para esperar', t.includes('id="es-espero"'), true);
  check('  dizendo quanto o sonho atrasa', t.includes('+1 semanada'), true);
  check('  e em quanto ele chega se ela esperar', t.includes('3 semanadas'), true);
  check('  com o nome do sonho', t.includes('Patinete'), true);

  /* O DINO FICA PENSANDO, não triste. Isto é uma decisão, não um erro — e um mascote
     de cara fechada transformaria escolher em culpa. */
  /* A POSE É NEUTRA. Com 'pensando' o Dino fica de sobrancelha franzida e a tela lê
     como desaprovação — o mascote julgando a criança por querer o sorvete. */
  check('o Dino está neutro', t.includes('dino-oi'), true);
  check('  não está triste', t.includes('dino-triste'), false);
  check('  nem de sobrancelha franzida', t.includes('dino-pensando'), false);

  /* O APP NÃO JULGA O DESEJO. Para ela o sorvete não é fútil, é o que ela quer:
     julgar ensinaria que querer coisas é errado. */
  check('a tela não chama o desejo de bobagem', /fútil|bobagem|besteira|errado/i.test(t), false);
  check('  e diz que os dois caminhos valem', t.includes('Os dois caminhos valem'), true);

  /* NÃO SEGUIU SOZINHO: a tela é uma parada de verdade, não um aviso que passa. */
  check('nada foi lançado só por mostrar a tela', seguiu, false);
  check('  e o pote continua intacto', Dados.potes(id).guardar, 30);

  /* ESCOLHER "USO AGORA" segue o fluxo. É uma opção legítima: o dinheiro é dela. */
  els['#es-agora'].onclick();
  check('escolher usar agora segue com o gasto', seguiu, true);

  /* ESCOLHER "ESPERO" volta ao cofrinho sem lançar nada. */
  seguiu = false;
  telaEscolha('guardar', 10, 'Doce', () => { seguiu = true; });
  els['#es-espero'].onclick();
  check('escolher esperar não lança nada', seguiu, false);
  check('  o pote fica intacto', Dados.potes(id).guardar, 30);
  check('  e volta para o cofrinho', App.aba, 'cofrinho');

  /* SEM TROCA A MOSTRAR, a tela nem aparece: segue direto. Uma tela extra que não
     informa nada vira obstáculo. */
  seguiu = false;
  telaEscolha('gastar', 5, 'Doce', () => { seguiu = true; });
  check('sem custo, a tela não interrompe', seguiu, true);

  /* O FLUXO PASSA PELA ESCOLHA — medido no código, e digo por quê.

     Todos os casos acima invocam `telaEscolha` na mão: provam a tela, não o fluxo.
     A sabotagem que arrancava a chamada do botão de confirmar passava verde — a
     criança tocaria em "Usar este dinheiro" e o gasto iria direto, sem escolha
     nenhuma.

     Dirigir o botão de verdade exigiria o DOM falso entregar os chips de valor, e
     ele devolve lista vazia em `querySelectorAll` — o valor vive num closure que o
     teste não alcança. Então esta asserção é ESTRUTURAL, e assumo a fraqueza: ela
     garante que a chamada existe e vem antes de gravar, não que a tela apareceu.
     O comportamento da tela está coberto acima; o que faltava era o elo. */
  const fonte = fs.readFileSync(BASE + 'cofrinho/js/cofrinho.js', 'utf8');
  const iConf = fonte.indexOf("el('#conf').onclick");
  check('o botão de confirmar existe no código', iConf > 0, true);
  const corpo = fonte.slice(iConf, iConf + 700);
  check('  e ele passa pela tela de escolha', corpo.includes('telaEscolha('), true);
  check('  antes de gravar o gasto',
    corpo.indexOf('telaEscolha(') < corpo.indexOf('gravar()'), true);
  check('  só quando o dinheiro sai do guardado', corpo.includes('doGuardado'), true);
  check('  e só quando existe um custo a mostrar', corpo.includes('custoDoSaque'), true);

  /* AS DUAS ESTRADAS TÊM O MESMO PESO. Fazer a de gastar menor, ou vermelha, seria
     dizer qual é a resposta certa — e aí não é escolha, é obediência. O laranja é
     preço; vermelho seria alarme. */
  const css = fs.readFileSync(BASE + 'cofrinho/css/cofrinho.css', 'utf8');
  const grid = (css.match(/\.estradas\s*\{([^}]*)\}/) || [])[1] || '';
  check('as duas estradas dividem a largura em partes iguais',
    /grid-template-columns:\s*1fr\s+1fr/.test(grid), true);
  const agora = (css.match(/\.estrada\.agora\s*\{([^}]*)\}/) || [])[1] || '';
  check('  a de gastar não é vermelha', /#d00|#f00|red/i.test(agora), false);
  check('  e usa o laranja de preço', /--laranja/.test(agora), true);

  limpar(id);
  limpar(id);
}

/* ================= Missão especial, com prazo ================= */
console.log('\n=== A missão especial e o prazo em noites ===');
{
  /* Um combinado pontual — "lavar o carro neste fim de semana" —, diferente da
     rotina semanal. Tem prazo, acontece uma vez, e não volta na semana seguinte. */
  const id = novaCrianca({ name: 'Especial' });
  const daqui = n => Dados.somarDiasISO(HOJE, n);
  const tE = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Lavar o carro', icon: '🚗', amount: 5,
    frequencia: 'especial', expira_em: daqui(2), active: true });

  const dela = () => Dados.tarefas(id).find(x => x.id === tE);
  check('a especial se identifica como especial', dela().especial, true);
  check('  e não é diária', dela().diaria, false);

  /* O PRAZO EM NOITES DE SONO. Uma criança de seis anos não manipula "faltam 34
     horas", mas sabe exatamente quantas vezes ainda vai dormir. */
  check('conta as noites que faltam', dela().noites, 2);
  check('  e diz em palavra', dela().prazo, 'faltam 2 noites');
  check('uma noite fala no singular', Dados.prazoEmNoites(daqui(1)), 'falta 1 noite');
  /* "faltam 0 noites" não quer dizer nada para ninguém. */
  check('o último dia não diz zero', Dados.prazoEmNoites(HOJE), 'só até hoje');
  check('  e o que passou diz que acabou', Dados.prazoEmNoites(daqui(-1)), 'acabou');

  /* SEM RELÓGIO. O prazo dá contorno à missão; não existe para apressar uma criança
     que não tem como administrar pressa. */
  check('a contagem é em dias inteiros, nunca em horas', Number.isInteger(dela().noites), true);

  /* MARCAR e o adulto confirmar — igual à semanal. */
  check('dá para marcar', Dados.marcarTarefa(id, tE), true);
  check('  fica marcada', dela().feita, true);
  check('  esperando o adulto', dela().confirmada, false);
  check('  e o dinheiro ainda não caiu', Dados.potes(id).total, 0);

  /* NÃO VOLTA NA SEMANA SEGUINTE. A semanal reinicia — é rotina. A especial é um
     combinado pontual, e reiniciá-la faria o app cobrar para sempre uma coisa que já
     aconteceu. */
  const marcada = Dados.all('kid_entries').find(e => e.task_id === tE);
  Dados.upsert('kid_entries', { ...marcada, date: Dados.somarDiasISO(HOJE, -10) });
  check('feita há dez dias continua feita', dela().feita, true);
  limpar(id);
}
console.log('\n=== O pergaminho cabe na tela ===');
{
  /* DOIS DEFEITOS QUE SÓ A FOTO MOSTROU, e que teste nenhum pegava porque ambos
     eram de geometria, não de texto. */

  /* 1. O viewBox TEM DE CASAR COM O PATH.

     O path terminava em x=288 e o viewBox declarava 340: 15% da direita era papel
     vazio esticado. O selo de cera, ancorado na borda do botão, caía FORA do
     pergaminho — flutuando no céu, ao lado do card. */
  const pg = Arte.pergaminho();
  const vb = (pg.match(/viewBox="0 0 (\d+) (\d+)"/) || []);
  check('o pergaminho declara um viewBox', vb.length > 0, true);
  const largura = Number(vb[1]);
  /* Soma os avanços do path: o "M" inicial mais o segundo x de cada curva. */
  /* O PATH É MULTILINHA no arquivo, e o primeiro parser parava na primeira quebra —
     somava uma curva só e reprovava com o desenho correto. Pega o atributo inteiro
     entre aspas e depois varre as curvas. */
  const dTodo = (pg.match(/ d="([^"]+)"/) || [])[1] || '';
  /* SÓ A BORDA DE CIMA. O path desenha o topo da esquerda para a direita, desce com
     , e volta pela borda de baixo com curvas NEGATIVAS — somar tudo dá zero,
     porque o traço fecha onde começou. O  é onde o topo termina. */
  const dAttr = dTodo.split(' v')[0];
  check('  e um path com curvas', /q/.test(dAttr), true);
  const mIni = dAttr.match(/M([\d.]+)/);
  let fim = mIni ? Number(mIni[1]) : 0;
  for (const q of dAttr.split('q').slice(1)) {
    const p = q.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (p.length >= 3) fim += p[2];
    else break;   // chegou no v/z do fecho
  }
  check('  sem sobrar papel vazio na direita', fim > largura * 0.9, true);

  /* 2. A ESPECIFICIDADE DO CSS.

     `.missao.especial > *` vale 0,2,0 e `.pergaminho-fundo` valia 0,1,0 — a regra
     genérica ganhava e reescrevia o `position: absolute` do fundo para `relative`.
     O pergaminho virou um bloco vazio ACIMA do conteúdo e o selo foi parar sobre o
     ícone. */
  const css = fs.readFileSync(BASE + 'cofrinho/css/cofrinho.css', 'utf8');
  const pega = sel => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };
  check('o fundo do pergaminho é absoluto',
    /position:\s*absolute/.test(pega('.missao.especial > .pergaminho-fundo')), true);
  check('  e o selo também', /position:\s*absolute/.test(pega('.missao.especial > .pg-selo')), true);
  /* As duas regras precisam ter ao menos o mesmo peso do seletor genérico: duas
     classes mais o filho. Declaradas como `.pergaminho-fundo` solto, perdem. */
  check('  declarados com peso suficiente para vencer o seletor genérico',
    css.includes('.missao.especial > .pergaminho-fundo')
    && css.includes('.missao.especial > .pg-selo'), true);

  /* 3. O CARD DIZ O QUE FAZER. "Descobrir que dá para tocar" não é tarefa de uma
     criança de seis anos: o card inteiro é o botão, mas nada dizia isso. */
  const idL = novaCrianca({ name: 'Layout' });
  Dados.upsert('kid_tasks', { kid_id: idL, name: 'Lavar o carro', icon: '🚗', amount: 5,
    frequencia: 'especial', expira_em: Dados.somarDiasISO(HOJE, 2), active: true });
  App.kid = Dados.get('kids', idL);
  App.aba = 'tarefas';
  const telaL = telaTarefas();
  check('o card convida ao toque por escrito', telaL.includes('Toque aqui quando fizer'), true);
  check('  e o nome fica numa faixa própria, longe da borda rasgada',
    telaL.includes('pg-nome'), true);

  /* FEITA, o convite dá lugar ao estado: continuar dizendo "toque aqui" depois de
     feita mandaria a criança marcar de novo o que já marcou. */
  Dados.marcarTarefa(idL, Dados.tarefas(idL)[0].id);
  const telaF = telaTarefas();
  check('feita, o convite some', telaF.includes('Toque aqui quando fizer'), false);
  check('  e o estado aparece no lugar', telaF.includes('Esperando um adulto conferir'), true);
  limpar(idL);

  /* O CABEÇALHO CONCORDA EM NÚMERO. Duas missões sob o título "Missão especial" é o
     tipo de detalhe que uma criança em alfabetização está justamente aprendendo. */
  const idP = novaCrianca({ name: 'Plural' });
  const dq = n => Dados.somarDiasISO(HOJE, n);
  Dados.upsert('kid_tasks', { kid_id: idP, name: 'Uma', icon: '🚗', amount: 2,
    frequencia: 'especial', expira_em: dq(1), active: true });
  App.kid = Dados.get('kids', idP);
  check('uma missão, título no singular', telaTarefas().includes('Missão especial'), true);
  Dados.upsert('kid_tasks', { kid_id: idP, name: 'Duas', icon: '🧸', amount: 2,
    frequencia: 'especial', expira_em: dq(2), active: true });
  check('  duas missões, título no plural', telaTarefas().includes('Missões especiais'), true);
  limpar(idP);
}


console.log('\n=== A ordem e o limite das luas ===');
{
  /* A QUE VENCE PRIMEIRO VEM PRIMEIRO. Ordenar por outra coisa faria a criança ver
     no topo uma missão que ainda tem cinco noites, enquanto a que acaba amanhã fica
     embaixo — e ela lê de cima para baixo. */
  const id = novaCrianca({ name: 'Ordem Prazo' });
  const daqui = n => Dados.somarDiasISO(HOJE, n);
  Dados.upsert('kid_tasks', { kid_id: id, name: 'Daqui a cinco', icon: '📦', amount: 2,
    frequencia: 'especial', expira_em: daqui(5), active: true });
  Dados.upsert('kid_tasks', { kid_id: id, name: 'Amanhã', icon: '⏳', amount: 3,
    frequencia: 'especial', expira_em: daqui(1), active: true });
  Dados.upsert('kid_tasks', { kid_id: id, name: 'Daqui a tres', icon: '🚗', amount: 4,
    frequencia: 'especial', expira_em: daqui(3), active: true });

  const ordem = Dados.missoesEspeciais(id).map(x => x.name);
  check('a que vence primeiro vem primeiro', ordem[0], 'Amanhã');
  check('  e a mais distante por último', ordem[ordem.length - 1], 'Daqui a cinco');
  check('  na ordem do calendário', ordem, ['Amanhã', 'Daqui a tres', 'Daqui a cinco']);
  limpar(id);

  /* O LIMITE DE CINCO LUAS. Acima disso a contagem exata deixa de significar algo
     para uma criança de seis anos, e a fileira só polui o card — vinte luas numa
     linha viram mancha, não informação. */
  const conta = n => (Arte.luas(n).match(/class="lua /g) || []).length;
  check('duas noites, duas luas', conta(2), 2);
  check('  cinco noites, cinco luas', conta(5), 5);
  check('  vinte noites param em cinco', conta(20), 5);
  check('  com um + dizendo que há mais', Arte.luas(20).includes('lua-mais'), true);
  check('  e cinco exatas não ganham o +', Arte.luas(5).includes('lua-mais'), false);
  check('o último dia mostra uma lua', conta(0), 1);
  check('  e o prazo vencido não mostra nenhuma', Arte.luas(-1), '');
}

console.log('\n=== A especial que expirou sai de cena, sem punir ===');
{
  const id = novaCrianca({ name: 'Expirou' });
  const daqui = n => Dados.somarDiasISO(HOJE, n);
  const tOk = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Lavar o carro', icon: '🚗', amount: 5,
    frequencia: 'especial', expira_em: daqui(2), active: true });
  const tVelha = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Missão antiga', icon: '📦', amount: 3,
    frequencia: 'especial', expira_em: daqui(-3), active: true });

  const velha = () => Dados.tarefas(id).find(x => x.id === tVelha);
  check('a que passou do prazo é marcada como expirada', velha().expirada, true);

  /* SOME SEM ALARDE. A alternativa é um card vermelho dizendo "você perdeu" para uma
     criança de seis anos — e vergonha não ensina compromisso. O plano do projeto já
     recusa "sequência que quebra e pune"; isto é a mesma regra aplicada ao prazo. */
  const vivas = Dados.missoesEspeciais(id);
  check('e sai da lista da criança', vivas.some(x => x.id === tVelha), false);
  check('  enquanto a que vale continua', vivas.some(x => x.id === tOk), true);

  /* NÃO ACEITA MARCAÇÃO DEPOIS DO PRAZO: aceitar esvaziaria o prazo, e o app estaria
     dizendo que o "até domingo" era decoração. */
  check('não dá para marcar o que expirou', Dados.marcarTarefa(id, tVelha), false);

  /* MAS FEITA E NÃO CONFIRMADA CONTINUA VIVA depois do prazo: ela cumpriu, e perder
     o combinado por demora do adulto seria injusto de um jeito que a criança sente. */
  const tFeita = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Feita a tempo', icon: '✅', amount: 4,
    frequencia: 'especial', expira_em: daqui(1), active: true });
  Dados.marcarTarefa(id, tFeita);
  Dados.upsert('kid_tasks', { ...Dados.get('kid_tasks', tFeita), expira_em: daqui(-1) });
  const f = () => Dados.tarefas(id).find(x => x.id === tFeita);
  check('feita antes do prazo não expira depois', f().expirada, false);
  check('  e continua na lista, esperando o adulto',
    Dados.missoesEspeciais(id).some(x => x.id === tFeita), true);
  limpar(id);
}

console.log('\n=== O pergaminho na tela da criança ===');
{
  const id = novaCrianca({ name: 'Tela Especial' });
  const daqui = n => Dados.somarDiasISO(HOJE, n);
  Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Lavar o carro', icon: '🚗', amount: 5,
    frequencia: 'especial', expira_em: daqui(2), active: true });
  Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Regar', icon: '🪴', amount: 1, frequencia: 'semanal', active: true });
  App.kid = Dados.get('kids', id);
  App.aba = 'tarefas';
  const tela = telaTarefas();

  check('a missão especial aparece', tela.includes('Lavar o carro'), true);
  /* O PERGAMINHO diz "isto é diferente" antes de qualquer texto — que é como uma
     criança de seis anos lê uma tela. */
  check('  desenhada como pergaminho', tela.includes('pergaminho-fundo'), true);
  check('  com o selo de cera', tela.includes('selo-cera'), true);
  check('  e uma seção que a separa da rotina', tela.includes('Missão especial'), true);

  /* O PRAZO EM LUAS: uma por noite de sono, com a palavra ao lado. */
  check('mostra as luas do prazo', (tela.match(/class="lua /g) || []).length, 2);
  check('  e a palavra junto', tela.includes('faltam 2 noites'), true);
  /* SEM RELÓGIO na tela: nada de hora, minuto ou segundo. */
  check('  sem relógio correndo', /\d+:\d\d|hora|minuto|segundo/i.test(tela), false);

  /* NÃO ENTRA NA CONTA DO DIA A DIA: somá-la ao "1 de 1 de hoje" faria o contador
     dizer que ela está devendo algo que só precisa acontecer até domingo. */
  /* MEDE O COMPORTAMENTO, não a marcação exata. O primeiro teste procurava o HTML
     literal do contador e reprovava por um detalhe de formatação — sem que nada
     estivesse errado. O que importa é o NÚMERO: com uma semanal e uma especial, o
     contador da semana precisa dizer 1, e não 2. */
  const cab = (tela.match(/desta semana/) || []).length;
  check('a tela tem o contador da semana', cab, 1);
  const antesDoCab = tela.slice(0, tela.indexOf('desta semana'));
  const nums = antesDoCab.split('<span class="n">').slice(1)
    .map(p => p.slice(0, p.indexOf('<')));
  check('  contando só a rotina, sem a especial', nums[nums.length - 1], '1');
  /* LIMPA ANTES do próximo cenário. Deixar para o fim do bloco fez esta criança
     sobreviver ao caso seguinte, e três testes de OUTRAS seções reprovaram por
     encontrar uma criança a mais na lista. */
  limpar(id);

  /* NO ÚLTIMO DIA a lua fica laranja e pulsa — é um aviso, não um alarme. */
  const idH = novaCrianca({ name: 'Hoje' });
  Dados.upsert('kid_tasks', {
    kid_id: idH, name: 'Hoje é o dia', icon: '⏳', amount: 2,
    frequencia: 'especial', expira_em: HOJE, active: true });
  App.kid = Dados.get('kids', idH);
  const telaH = telaTarefas();
  check('no último dia, a lua se destaca', telaH.includes('lua hoje'), true);
  check('  e o texto diz só até hoje', telaH.includes('só até hoje'), true);
  limpar(idH);
}
/* ================= Missão de todo dia ================= */
console.log('\n=== A missão que precisa acontecer todo dia ===');
{
  /* A água do cachorro é o caso que revelou a falta: uma missão diária marcada na
     segunda ficava "feita" o resto da semana, e o cachorro passava seis dias sem
     ninguém cobrar. */
  const id = novaCrianca({ name: 'Diaria' });
  const tD = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Água do Duque', icon: '🐕', amount: 2,
    frequencia: 'diaria', active: true,
  });
  const tS = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Regar as plantas', icon: '🪴', amount: 1,
    frequencia: 'semanal', active: true,
  });

  const dela = () => Dados.tarefas(id).find(x => x.id === tD);
  const semanal = () => Dados.tarefas(id).find(x => x.id === tS);

  check('a diária se identifica como diária', dela().diaria, true);
  check('  e a semanal continua semanal', semanal().diaria, false);
  check('  a diária abre com os sete dias da semana', dela().dias.length, 7);
  check('  nenhum marcado ainda', dela().feitos, 0);

  /* MARCAR HOJE não conclui a semana. Era o defeito: o app dizia "feita" e a
     criança não conseguia marcar amanhã. */
  check('marcar hoje funciona', Dados.marcarTarefa(id, tD), true);
  check('  conta um dia', dela().feitos, 1);
  check('  e hoje está marcado', dela().feita, true);
  check('  mas a semana NÃO está completa', dela().completou, false);
  check('  e marcar hoje de novo não duplica', Dados.marcarTarefa(id, tD), false);
  check('  continua um dia só', dela().feitos, 1);

  /* A MARCAÇÃO DO DIA VALE ZERO: é o que impede a diária de virar 70% da renda
     dela. O dinheiro da semana sai uma vez, no bônus. */
  check('a marcação do dia não põe dinheiro no pote', Dados.potes(id).total, 0);
  const doDia = Dados.all('kid_entries').find(e => e.task_id === tD);
  check('  o lançamento do dia vale zero', doDia.amount, 0);
  check('  e já nasce confirmado, porque não há o que conferir', doDia.confirmada, true);

  /* DESMARCAR HOJE é permitido, mesmo o lançamento estando "confirmado": ele vale
     zero e nasce assim por construção. Tratá-lo como intocável trancaria a criança
     num toque errado. */
  check('desmarcar hoje funciona', Dados.desmarcarTarefa(id, tD), true);
  check('  e volta a zero dias', dela().feitos, 0);

  /* A SEMANA COMPLETA gera o bônus, uma vez. Aqui os sete dias são semeados
     direto, porque a criança só pode marcar HOJE — e o teste não viaja no tempo. */
  const kidD = Dados.get('kids', id);
  const inicio = Dados.inicioDaSemana(kidD);
  for (let i = 0; i < 6; i++) {
    Dados.upsert('kid_entries', {
      kid_id: id, tipo: 'tarefa', pote: 'gastar', amount: 0,
      date: Dados.somarDiasISO(inicio, i), description: 'Água do Duque',
      task_id: tD, confirmada: true,
    });
  }
  check('seis dias marcados: ainda não completou', dela().completou, false);
  /* CHAMA acertarBonus AQUI, com seis dias. Sem a chamada o bônus não existiria de
     qualquer forma, e a asserção media a ausência de uma ação em vez da regra — a
     sabotagem que soltava o bônus sem completar a semana passava verde. */
  Dados.acertarBonus(id, tD);
  check('  e o bônus não é criado com a semana incompleta', dela().bonusId, null);
  check('  nem com um dia só', (() => {
    const doPrimeiro = Dados.all('kid_entries').find(e =>
      e.task_id === tD && e.tipo === 'tarefa' && e.date === Dados.somarDiasISO(inicio, 0));
    Dados.remove('kid_entries', doPrimeiro.id);
    Dados.acertarBonus(id, tD);
    const semBonus = dela().bonusId === null;
    Dados.upsert('kid_entries', {
      kid_id: id, tipo: 'tarefa', pote: 'gastar', amount: 0,
      date: Dados.somarDiasISO(inicio, 0), description: 'Água do Duque',
      task_id: tD, confirmada: true,
    });
    return semBonus;
  })(), true);

  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'tarefa', pote: 'gastar', amount: 0,
    date: Dados.somarDiasISO(inicio, 6), description: 'Água do Duque',
    task_id: tD, confirmada: true,
  });
  check('os sete dias fecham a semana', dela().completou, true);

  /* O BÔNUS nasce PENDENTE: o dinheiro só cai depois que o adulto vê. Sem isso o
     app pagaria por a criança dizer que cuidou. */
  Dados.acertarBonus(id, tD);
  check('  e o bônus é criado', !!dela().bonusId, true);
  check('  pendente, esperando o adulto', dela().bonusPago, false);
  check('  sem dinheiro no pote ainda', Dados.potes(id).total, 0);
  const bonus = Dados.get('kid_entries', dela().bonusId);
  check('  o bônus vale o valor da missão', bonus.amount, 2);
  check('  e não vale sete vezes isso', bonus.amount < 2 * 7, true);

  /* NÃO DUPLICA: acertar de novo não cria um segundo bônus. */
  Dados.acertarBonus(id, tD);
  check('acertar de novo não cria outro bônus',
    Dados.all('kid_entries').filter(e => e.tipo === 'bonus' && e.task_id === tD).length, 1);

  /* A SEQUÊNCIA QUEBRADA desfaz o bônus pendente. Sem isto, bastava marcar os sete
     dias, desmarcar um e ficar com o bônus para sempre. */
  const doUltimo = Dados.all('kid_entries').find(e =>
    e.task_id === tD && e.tipo === 'tarefa' && e.date === Dados.somarDiasISO(inicio, 6));
  Dados.remove('kid_entries', doUltimo.id);
  Dados.acertarBonus(id, tD);
  check('quebrar a sequência tira o bônus pendente', dela().bonusId, null);
  check('  e a semana volta a estar incompleta', dela().completou, false);

  /* BÔNUS JÁ PAGO NÃO É RETIRADO: o dinheiro está no pote, e tomar de volta seria
     o app desfazendo o que já deu. */
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'tarefa', pote: 'gastar', amount: 0,
    date: Dados.somarDiasISO(inicio, 6), description: 'Água do Duque',
    task_id: tD, confirmada: true,
  });
  Dados.acertarBonus(id, tD);
  Dados.upsert('kid_entries', { ...Dados.get('kid_entries', dela().bonusId), confirmada: true });
  check('bônus confirmado entra no pote', Dados.potes(id).total, 2);
  const idPago = dela().bonusId;
  const outroUltimo = Dados.all('kid_entries').find(e =>
    e.task_id === tD && e.tipo === 'tarefa' && e.date === Dados.somarDiasISO(inicio, 5));
  Dados.remove('kid_entries', outroUltimo.id);
  Dados.acertarBonus(id, tD);
  check('  e quebrar a sequência depois não tira o que foi pago',
    !!Dados.get('kid_entries', idPago), true);
  check('  o dinheiro continua no pote', Dados.potes(id).total, 2);

  limpar(id);
}

console.log('\n=== A tela das missões de todo dia ===');
{
  const id = novaCrianca({ name: 'Tela Diaria' });
  const tD = Dados.upsert('kid_tasks', {
    kid_id: id, name: 'Água do Duque', icon: '🐕', amount: 2, frequencia: 'diaria', active: true });
  App.kid = Dados.get('kids', id);
  App.aba = 'tarefas';

  const tela1 = telaTarefas();
  check('a tela mostra a missão diária', tela1.includes('Água do Duque'), true);
  check('  com os sete dias em bolinhas', (tela1.match(/class="dia-pt/g) || []).length, 7);
  check('  dizendo quantos dias faltam', tela1.includes('0 de 7 dias'), true);
  /* O VALOR APARECE COMO DA SEMANA, não do dia: é a diferença entre premiar a
     constância e pagar por balde de água. */
  check('  e que o valor é da semana toda', tela1.includes('a semana toda vale'), true);
  check('  sem prometer valor por dia', /por dia vale/.test(tela1), false);
  /* HOJE tem anel: é como ela acha onde está na semana. */
  check('  com o dia de hoje destacado', tela1.includes('dia-pt hoje') || tela1.includes(' hoje"'), true);

  Dados.marcarTarefa(id, tD);
  const tela2 = telaTarefas();
  check('depois de marcar, conta um dia', tela2.includes('1 de 7 dias'), true);
  check('  e o card mostra que hoje foi feito', tela2.includes('feita-hoje'), true);

  /* O CONTADOR DO TOPO é de HOJE, não da semana: numa segunda com seis dias pela
     frente, dizer "1 de 1 missões desta semana" mentiria sobre o compromisso. */
  /* O CONTADOR É DE HOJE, não da semana. Numa segunda com seis dias pela frente,
     "1 de 1 desta semana" mentiria sobre o compromisso que ainda existe.

     Mede o texto INTEIRO da linha: procurar só o trecho "de hoje" deixava passar a
     troca por "desta semana", porque a palavra sobrevivia em outro lugar da tela. */
  const contador = (tela2.match(/<div class="missao-conta">([\s\S]*?)<\/div>/) || [])[1] || '';
  check('o contador fala de hoje', /de hoje/.test(contador), true);
  check('  e não fala da semana', /desta semana/.test(contador), false);

  limpar(id);
}
/* ================= O mesmo dinheiro repartido duas vezes ================= */
console.log('\n=== Repartir não duplica dinheiro ===');
{
  /* ESTRAGO REAL, numa base de verdade. O histórico ficou assim:

       08-10 | inicial | gastar  |  R$ 60,00
       08-17 | divisao | gastar  | -R$ 60,00   ← repartiu
       08-17 | divisao | guardar |  R$ 60,00
       08-17 | divisao | gastar  | -R$ 60,00   ← repartiu DE NOVO
       08-17 | divisao | guardar |  R$ 60,00

     Resultado: pote gastar em −R$ 54 e guardar em R$ 121 em vez de R$ 61.

     A CAUSA foi de desenho: a marca `repartido` era a única barreira, e ela é uma
     coluna nova em COLUNAS_OPCIONAIS. Num banco sem a coluna o push a descarta e o
     pull traz o registro limpo — o convite reabria e a criança repartia de novo.

     Coluna opcional serve para dado acessório, nunca para a regra que decide se
     dinheiro se move. Agora quem manda é o SALDO, que é derivado. */
  const id = novaCrianca({ name: 'Duplicado' });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'inicial', pote: 'gastar', amount: 60,
    date: Dados.somarDiasISO(HOJE, -7), description: 'O que ele já tinha', confirmada: true,
  });

  check('reparte a abertura', Dados.dividir(id, 60, 0), true);
  check('  o dinheiro foi para guardar', Dados.potes(id).guardar, 60);
  check('  e gastar zerou', Dados.potes(id).gastar, 0);

  /* A MARCA SE PERDE — é o que a sincronização faz num banco sem a coluna. Simula
     removendo o campo, que é exatamente o estado em que o registro volta do pull. */
  for (const e of Dados.all('kid_entries')) {
    if (e.kid_id === id) delete e.repartido;
  }
  Dados.salvar();

  /* Sem a proteção por saldo, o convite reabriria com R$ 60 e a criança repartiria
     de novo. Agora o pote gastar está em zero, então não há nada a repartir. */
  check('com a marca perdida, o convite não reabre', Dados.aRepartir(id), null);
  check('  porque não há dinheiro em gastar', Dados.podeRepartir(id), false);

  /* E MESMO CHAMANDO dividir DIRETO, o dinheiro não se multiplica. É a barreira
     que faltava: a validação não confia em quem chamou. */
  check('repartir de novo é recusado', Dados.dividir(id, 60, 0), false);
  check('  o guardar não dobra', Dados.potes(id).guardar, 60);
  check('  e o gastar não fica negativo', Dados.potes(id).gastar, 0);
  check('  o total continua o mesmo', Dados.potes(id).total, 60);

  /* O POTE NUNCA FICA NEGATIVO. Um cofrinho que deixa o pote no vermelho perdeu o
     direito de ensinar que dinheiro acaba — é a lição inteira do app. */
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE,
    confirmada: true, repartido: false,
  });
  check('com R$ 10 em gastar, repartir R$ 30 é recusado', Dados.dividir(id, 30, 0), false);
  check('  o pote fica intacto', Dados.potes(id).gastar, 10);
  check('repartir exatamente o que tem funciona', Dados.dividir(id, 7, 3), true);
  check('  e zera o pote sem passar', Dados.potes(id).gastar, 0);
  check('  guardar recebeu', Dados.potes(id).guardar, 67);
  check('  doar recebeu', Dados.potes(id).doar, 3);
  check('  e o total nunca mudou', Dados.potes(id).total, 70);


  /* O CONVITE OFERECE O QUE EXISTE, não o que o lançamento dizia.

     Se a criança recebe R$ 10 e gasta R$ 5 antes de repartir, o pote tem R$ 5 — e
     oferecer R$ 10 seria prometer o que não está lá: ela distribuiria dez, o app
     recusaria no fim e o botão pareceria quebrado. */
  const idL = novaCrianca({ name: 'Limite' });
  Dados.upsert('kid_entries', {
    kid_id: idL, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE,
    confirmada: true, repartido: false,
  });
  Dados.gastar(idL, 'gastar', 5, 'Sorvete');
  check('gastou metade antes de repartir', Dados.potes(idL).gastar, 5);
  check('  o convite oferece só o que sobrou', Dados.aRepartir(idL).valor, 5);
  check('  e não o valor cheio da semanada', Dados.aRepartir(idL).valor < 10, true);

  App.kid = Dados.get('kids', idL);
  telaRitual();
  check('  a tela do ritual mostra o que existe', tela().includes(fmtKid(5)), true);
  /* O valor grande da tela é o teto da repartição: mostrar R$ 10 ali seria a mesma
     promessa falsa, agora em corpo 52. */
  const grande = (tela().match(/ritual-valor">([^<]+)/) || [])[1] || '';
  check('  e o número grande é o saldo, não a semanada', grande.includes('5'), true);
  check('  sem mostrar o valor cheio', /10/.test(grande), false);
  limpar(idL);

  /* NENHUM POTE NEGATIVO, em nenhum momento: é a invariante do cofrinho. */
  const p = Dados.potes(id);
  check('nenhum pote está negativo', p.gastar >= 0 && p.guardar >= 0 && p.doar >= 0, true);
  limpar(id);
}

console.log('\n=== Guardar um pouco, em qualquer dia ===');
{
  /* Faltava por completo: se a criança deixasse tudo em gastar, não havia caminho
     nenhum para depois decidir guardar. E "hoje eu quero guardar isso" é exatamente
     a decisão que o app existe para incentivar. */
  const id = novaCrianca({ name: 'Depois' });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE,
    confirmada: true, repartido: false,
  });
  // Ela escolhe deixar tudo em gastar, que é uma decisão legítima
  Dados.dividir(id, 0, 0);
  check('deixou tudo em gastar', Dados.potes(id).gastar, 10);
  check('  e o convite se encerrou', Dados.aRepartir(id), null);

  /* MAS AINDA PODE GUARDAR. Antes o caminho morria aqui. */
  check('ainda pode repartir depois', Dados.podeRepartir(id), true);
  App.kid = Dados.get('kids', id);
  check('  e a tela oferece o botão', telaCofrinho().includes('Quero guardar um pouco'), true);

  telaRitual();
  check('  a tela de repartir abre sem convite pendente', tela().includes('data-mais="guardar"'), true);
  check('  oferecendo o que está no pote', tela().includes(fmtKid(10)), true);

  check('e guardar depois funciona', Dados.dividir(id, 4, 1), true);
  check('  o dinheiro se move', [Dados.potes(id).gastar, Dados.potes(id).guardar, Dados.potes(id).doar], [5, 4, 1]);
  check('  sem mudar o total', Dados.potes(id).total, 10);

  /* GASTOU TUDO: aí o botão some, porque não há o que repartir. */
  Dados.gastar(id, 'gastar', 5, 'Doce');
  check('sem saldo em gastar, não pode repartir', Dados.podeRepartir(id), false);
  check('  e o botão sai da tela', telaCofrinho().includes('Quero guardar um pouco'), false);
  limpar(id);
}
/* ================= Gastar e doar ================= */
console.log('\n=== Gastar só o que tem ===');
{
  const id = novaCrianca();
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE, confirmada: true });

  check('gastar o que tem funciona', Dados.gastar(id, 'gastar', 4, 'Sorvete').ok, true);
  check('  e o pote diminui', Dados.potes(id).gastar, 6);

  /* O CORAÇÃO DO APP: o cofrinho recusa o que não cabe. Não é validação de
     formulário — é a única forma de a criança aprender que dinheiro acaba. */
  const r = Dados.gastar(id, 'gastar', 100, 'Um foguete');
  check('gastar mais do que tem é recusado', r.ok, false);
  check('  dizendo que falta', r.motivo, 'falta');
  check('  e nada foi lançado', Dados.potes(id).gastar, 6);

  check('valor zero é recusado', Dados.gastar(id, 'gastar', 0, '').motivo, 'valor');
  check('valor negativo é recusado', Dados.gastar(id, 'gastar', -5, '').motivo, 'valor');

  // Os potes são independentes: ter no de guardar não libera gastar
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'presente', pote: 'guardar', amount: 100, date: HOJE, confirmada: true });
  check('dinheiro guardado não paga gasto do pote de gastar', Dados.gastar(id, 'gastar', 50, '').ok, false);
  check('doar tira do pote de doar', Dados.gastar(id, 'doar', 1, 'Bichinhos').ok, false);
  limpar(id);
}

/* ================= Tarefas ================= */
console.log('\n=== Tarefas: a criança marca, o adulto confirma ===');
{
  const id = novaCrianca();
  const t1 = Dados.upsert('kid_tasks', { kid_id: id, name: 'Escovar os dentes', icon: '🪥', amount: 1, active: true });
  Dados.upsert('kid_tasks', { kid_id: id, name: 'Guardar os brinquedos', icon: '🧸', amount: 2, active: true });

  check('as tarefas aparecem para ela', Dados.tarefas(id).length, 2);
  check('  nenhuma feita ainda', Dados.tarefas(id).filter(t => t.feita).length, 0);

  check('marcar funciona', Dados.marcarTarefa(id, t1), true);
  check('  a tarefa fica marcada', Dados.tarefas(id).find(t => t.id === t1).feita, true);
  check('  mas ainda não confirmada', Dados.tarefas(id).find(t => t.id === t1).confirmada, false);
  check('  e o dinheiro NÃO caiu no pote', Dados.potes(id).gastar, 0);

  check('marcar duas vezes não duplica', Dados.marcarTarefa(id, t1), false);

  check('ela pode desmarcar o que marcou sem querer', Dados.desmarcarTarefa(id, t1), true);
  check('  e a tarefa volta a ficar em aberto', Dados.tarefas(id).find(t => t.id === t1).feita, false);

  /* CONFIRMADA NÃO SE DESFAZ pela criança: depois que o adulto conferiu e o
     dinheiro entrou, apagar a marcação deixaria o pote com dinheiro sem origem. */
  Dados.marcarTarefa(id, t1);
  const marcada = Dados.tarefas(id).find(t => t.id === t1).entryId;
  Dados.upsert('kid_entries', { ...Dados.get('kid_entries', marcada), confirmada: true });
  check('tarefa já conferida não pode ser desmarcada por ela', Dados.desmarcarTarefa(id, t1), false);
  check('  e agora sim o dinheiro está no pote', Dados.potes(id).gastar, 1);

  // Tarefa desativada pelo adulto some da lista dela
  Dados.upsert('kid_tasks', { id: t1, kid_id: id, name: 'Escovar os dentes', active: false });
  check('tarefa desativada some da lista', Dados.tarefas(id).some(t => t.id === t1), false);
  limpar(id);
}

/* ================= A meta ================= */
console.log('\n=== O sonho ===');
{
  const id = novaCrianca({ semanada_valor: 8, rendimento_tipo: 'moeda', rendimento_valor: 1 });
  Dados.upsert('kid_goals', { kid_id: id, name: 'Patinete', icon: '🛴', target_amount: 90, done: false });
  check('sem nada guardado, faltam todas as semanadas', Dados.semanasParaMeta(id), 10);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'presente', pote: 'guardar', amount: 45, date: HOJE, confirmada: true });
  check('guardar metade corta as semanadas pela metade', Dados.semanasParaMeta(id), 5);

  /* O DINHEIRO DE GASTAR NÃO CONTA para o sonho. Contar seria prometer uma data
     que não vai acontecer — o pote de gastar existe justamente para ser gasto. */
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'presente', pote: 'gastar', amount: 500, date: HOJE, confirmada: true });
  check('o pote de gastar não encurta o sonho', Dados.semanasParaMeta(id), 5);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'presente', pote: 'guardar', amount: 45, date: HOJE, confirmada: true });
  check('alcançou o sonho: zero semanadas', Dados.semanasParaMeta(id), 0);
  limpar(id);
}

/* ================= O gasto espera o adulto ================= */
console.log('\n=== Gastar precisa da confirmação de um adulto ===');
{
  /* A criança está aprendendo e vai tocar sem querer — é o que ela faz com qualquer
     app. Como o gasto dela agora DEBITA A CONTA DA FAMÍLIA, um toque de curiosidade
     mexeria no dinheiro real. */
  const id = novaCrianca({ name: 'Confirma' });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 10, date: HOJE,
    confirmada: true, repartido: true });

  check('gastar funciona', Dados.gastar(id, 'gastar', 4, 'Doce').ok, true);
  const g = Dados.all('kid_entries').find(e => e.kid_id === id && e.tipo === 'gasto');
  check('  mas nasce esperando o adulto', g.confirmada, false);

  /* O POTE CAI JÁ. Aos seis anos, ação sem retorno visível é ação que ela repete
     achando que não funcionou — e mostrar menos do que ela talvez tenha é o lado
     seguro de errar num app que ensina a não gastar o que não tem. */
  check('  e o pote dela já cai na hora', Dados.potes(id).gastar, 6);

  /* NÃO DÁ PARA GASTAR O QUE JÁ FOI RESERVADO por um gasto pendente: senão ela
     gastaria R$ 4 três vezes enquanto o adulto não olha. */
  check('gastar mais do que sobrou é recusado', Dados.gastar(id, 'gastar', 7, 'Outro').ok, false);
  check('  e o pote continua igual', Dados.potes(id).gastar, 6);

  /* RECUSADO, o dinheiro volta inteiro. É o que protege o toque sem querer. */
  Dados.remove('kid_entries', g.id);
  check('recusado, o dinheiro volta ao pote', Dados.potes(id).gastar, 10);
  limpar(id);
}

/* ================= Usar o que está guardado ================= */
console.log('\n=== Tirar dinheiro do pote de guardar ===');
{
  /* Faltava por completo, e a falta tinha um efeito colateral silencioso: a moeda
     mágica premia a semana em que ela NÃO tira do guardado, e sem caminho para tirar
     a moeda caía sempre. Um prêmio que não se pode perder não é prêmio. */
  const id = novaCrianca({ name: 'Guardado' });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 50, date: HOJE, confirmada: true });

  check('dá para gastar do pote guardar', Dados.gastar(id, 'guardar', 20, 'Livro').ok, true);
  check('  o guardado cai', Dados.potes(id).guardar, 30);
  check('  e o pote gastar não é tocado', Dados.potes(id).gastar, 0);
  check('  também espera o adulto',
    Dados.all('kid_entries').find(e => e.tipo === 'gasto').confirmada, false);

  check('não dá para tirar mais do que guardou', Dados.gastar(id, 'guardar', 100, '').ok, false);
  check('  o pote fica intacto', Dados.potes(id).guardar, 30);

  /* A TELA oferece o caminho, com o aviso do que ela perde. */
  App.kid = Dados.get('kids', id);
  check('a tela do cofrinho oferece usar o guardado',
    telaCofrinho().includes('bt-usar-guardado'), true);
  telaGastar('guardar');
  check('  a tela de tirar fala do que está guardado', tela().includes('guardado'), true);
  /* AVISA ANTES sobre a moeda mágica: é a diferença entre uma escolha e uma
     surpresa. Ela pode decidir esperar mais três dias, e é essa decisão que o app
     existe para provocar. */
  check('  e avisa que perde a moeda mágica', tela().includes('moeda mágica'), true);
  limpar(id);

  /* SEM MOEDA MÁGICA configurada, não há o que avisar — o aviso seria uma ameaça
     vazia sobre um prêmio que não existe. */
  const idSem = novaCrianca({ name: 'Sem Moeda', rendimento_valor: 0 });
  Dados.upsert('kid_entries', {
    kid_id: idSem, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', idSem);
  telaGastar('guardar');
  check('sem moeda mágica, não avisa do que não existe',
    tela().includes('não ganha a'), false);
  limpar(idSem);
}

/* ================= Realizar o sonho ================= */
console.log('\n=== Comprar o sonho quando a meta enche ===');
{
  /* Faltava, e a falta esvaziava a lição. O pote guardar existe para virar a
     bicicleta; se o app enche a barra, toca o confete e depois não deixa comprar, o
     que ele ensinou foi a acumular — não a planejar. */
  const id = novaCrianca({ name: 'Sonhador' });
  const meta = Dados.upsert('kid_goals', {
    kid_id: id, name: 'Patinete', icon: '🛴', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 40, date: HOJE, confirmada: true });

  check('com R$ 40 de R$ 60, o sonho não está pronto', Dados.metaAlcancada(id), null);
  check('  e realizar é recusado', Dados.realizarSonho(id), false);
  App.kid = Dados.get('kids', id);
  App.aba = 'sonho';
  check('  a tela não oferece comprar', telaSonho().includes('bt-comprar-sonho'), false);

  Dados.upsert('kid_entries', {
    kid_id: id, tipo: 'presente', pote: 'guardar', amount: 30, date: HOJE, confirmada: true });
  check('com R$ 70, o sonho está pronto', !!Dados.metaAlcancada(id), true);
  check('  a tela oferece comprar', telaSonho().includes('bt-comprar-sonho'), true);
  check('  dizendo o nome do sonho', telaSonho().includes('Patinete'), true);

  /* PEDIR O SONHO NÃO É COMPRÁ-LO. Era a única saída do cofrinho que passava
     direto: criava o lançamento confirmado e, na ponte seguinte, debitava a conta da
     família sem ninguém aprovar — logo no maior valor que a criança movimenta. */
  check('pedir o sonho funciona', Dados.realizarSonho(id), true);
  const pedido = Dados.all('kid_entries').find(e => e.kid_goal_id === meta);
  check('  mas nasce esperando o adulto', pedido.confirmada, false);

  /* O POTE CAI JÁ: é saída, e saída pendente conta. O retorno é imediato para ela,
     e o dinheiro só deixa a conta da família quando o adulto confirma. */
  check('  o pote dela já cai', Dados.potes(id).guardar, 10);

  /* A META NÃO É ENCERRADA AQUI. Fechá-la agora e reabrir numa recusa faria a
     criança ver o sonho conquistado e depois desconquistado. */
  check('  e a meta ainda não é encerrada', Dados.get('kid_goals', meta).done, false);
  check('  ficando marcada como esperando', !!Dados.metaAguardando(id), true);

  /* NÃO PEDE DUAS VEZES: sem isto, dois toques tirariam o valor do pote duas vezes
     e a segunda cobrança sairia de um dinheiro que já não existe. */
  /* PEDIR DUAS VEZES, COM SALDO DE SOBRA — é o caso que expõe a guarda.

     No cenário acima o segundo pedido já falhava sozinho: o pote tinha caído
     abaixo do alvo, então `metaAlcancada` devolvia null e a guarda nunca era
     exercitada. Aqui ela juntou MAIS QUE O DOBRO, o pote continua acima do alvo
     depois do primeiro pedido, e sem a guarda o valor sairia duas vezes. */
  check('pedir de novo é recusado', Dados.realizarSonho(id), false);
  check('  e o pote não cai de novo', Dados.potes(id).guardar, 10);

  const idD = novaCrianca({ name: 'Dobro' });
  const metaD = Dados.upsert('kid_goals', {
    kid_id: idD, name: 'Bicicleta', icon: '🚲', target_amount: 60, done: false });
  Dados.upsert('kid_entries', {
    kid_id: idD, tipo: 'presente', pote: 'guardar', amount: 130, date: HOJE, confirmada: true });
  check('pede o sonho com saldo de sobra', Dados.realizarSonho(idD), true);
  check('  o pote cai o valor da meta', Dados.potes(idD).guardar, 70);
  check('  e ainda estaria acima do alvo', Dados.potes(idD).guardar >= 60, true);
  check('mesmo assim, pedir de novo é recusado', Dados.realizarSonho(idD), false);
  check('  o pote não cai duas vezes', Dados.potes(idD).guardar, 70);
  check('  e existe um pedido só',
    Dados.all('kid_entries').filter(e => e.kid_goal_id === metaD).length, 1);
  limpar(idD);

  /* A TELA DELA diz que está esperando, em vez de oferecer comprar outra vez. */
  App.kid = Dados.get('kids', id);
  App.aba = 'sonho';
  const telaAg = telaSonho();
  check('a tela avisa que já pediu', telaAg.includes('Já pedi'), true);
  check('  e não oferece comprar de novo', telaAg.includes('bt-comprar-sonho'), false);

  /* O ADULTO CONFIRMA — e é aí que a meta se encerra. */
  Dados.upsert('kid_entries', { ...pedido, confirmada: true });
  Dados.upsert('kid_goals', { ...Dados.get('kid_goals', meta), done: true, done_at: HOJE });
  check('confirmado, a meta é encerrada', Dados.get('kid_goals', meta).done, true);
  /* ENCERRADA, NÃO APAGADA: o histórico dela precisa poder contar que este sonho
     existiu e foi conquistado. */
  check('  mas não é apagada', !!Dados.get('kid_goals', meta), true);
  check('  e sai da lista de metas ativas', Dados.meta(id), null);
  check('  o dinheiro saiu do pote', Dados.potes(id).guardar, 10);

  /* NÃO DÁ PARA COMPRAR DUAS VEZES: a meta encerrada não volta. */
  check('realizar de novo é recusado', Dados.realizarSonho(id), false);
  check('  e o pote não cai de novo', Dados.potes(id).guardar, 10);

  /* O HISTÓRICO conta a conquista, com o nome do que ela comprou. */
  const compra = Dados.entradas(id).find(e => /Comprei/.test(e.description || ''));
  check('o histórico registra a conquista', !!compra, true);
  check('  com o nome do sonho', /Patinete/.test(compra.description), true);
  limpar(id);
}
/* ================= Selos ================= */
console.log('\n=== Prêmios da semana ===');
{
  const id = novaCrianca();
  const nomes = Dados.selos(id).map(s => s.id);
  check('a semana tem seis prêmios possíveis', nomes.length, 6);
  check('  e nenhum vem ganho de graça', Dados.selos(id).filter(s => s.ganho).length, 0);

  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true });
  Dados.dividir(id, 3, 1);
  const s = Dados.selos(id);
  const ganho = k => s.find(x => x.id === k).ganho;
  check('repartir ganha o selo de repartidor', ganho('dividiu'), true);
  check('pôr dinheiro no pote de doar ganha o coração grande', ganho('doou'), true);
  check('não tirar do guardado ganha a formiguinha', ganho('guardou'), true);

  Dados.gastar(id, 'guardar', 1, 'tirei');
  check('  e tirar do guardado perde a formiguinha', Dados.selos(id).find(x => x.id === 'guardou').ganho, false);

  /* CAPRICHOSO só com tarefa existindo: um cofrinho sem nenhuma tarefa
     cadastrada daria o selo de "fez todas" de graça, e um prêmio que se ganha
     sem fazer nada não é prêmio. */
  check('sem tarefas cadastradas, o caprichoso não vem de graça', Dados.selos(id).find(x => x.id === 'tarefas').ganho, false);
  const t = Dados.upsert('kid_tasks', { kid_id: id, name: 'Ler', icon: '📚', amount: 1, active: true });
  Dados.marcarTarefa(id, t);
  check('fazer todas as tarefas ganha o caprichoso', Dados.selos(id).find(x => x.id === 'tarefas').ganho, true);
  limpar(id);
}

/* ================= As telas ================= */
console.log('\n=== O que a criança vê ===');
{
  const id = novaCrianca({ name: 'Nina', avatar: '🦕', cor: '#e84393' });
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, description: 'Semanada', confirmada: true });
  App.kid = Dados.get('kids', id);
  App.aba = 'cofrinho';

  const t = telaCofrinho();
  check('a tela mostra o total do jeito que criança lê', t.includes('R$ 8<'), true);
  check('  os três potes, com nome escrito e não só cor',
    ['Gastar', 'Guardar', 'Doar'].every(n => t.includes(`>${n}<`)), true);
  check('  o Dino aparece', t.includes('class="dino'), true);
  check('  com um balão falando com ela', t.includes('class="balao"'), true);
  check('  e o convite para repartir a semanada', t.includes('id="ir-ritual"'), true);
  check('  o histórico já mostra a semanada', t.includes('Semanada'), true);

  Dados.dividir(id, 3, 0);
  const aposRepartir = telaCofrinho();
  check('depois de repartir, o convite destacado some',
    /bt ouro chama[^>]*id="ir-ritual"/.test(aposRepartir), false);
  /* E se sobrou dinheiro em gastar, o botão discreto continua: ela pode voltar e
     guardar mais. Se não sobrou nada, nem o botão aparece — não há o que repartir. */
  check('  e o botão discreto acompanha o saldo do pote',
    aposRepartir.includes('Quero guardar um pouco'), Dados.potes(id).gastar > 0);
  check('  e a divisão aparece no histórico sem sinal de menos',
    telaCofrinho().includes('trocou de pote'), true);


  /* O TIPO "inicial" TEM ÍCONE PRÓPRIO no histórico dela.

     É o saldo de abertura — o que ela já tinha quando o cofrinho começou. Sem
     entrada no mapa, cai no ícone genérico de moeda e fica indistinguível de uma
     semanada, justamente no primeiro registro que ela vai ver. */
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'inicial', pote: 'guardar', amount: 60,
    date: Dados.somarDiasISO(HOJE, -1), description: 'O que eu já tinha', confirmada: true });
  /* NO EXTRATO, e não na tela inicial: ela mostra só os três últimos movimentos, e o
     de abertura ficou de fora quando há semanada e presente na frente. O lugar de
     conferir a lista inteira é a tela que existe para isso. */
  telaExtrato();
  const comInicial = tela();
  check('o saldo de abertura aparece no histórico', comInicial.includes('O que eu já tinha'), true);
  check('  com a bandeira de largada, não a moeda genérica', comInicial.includes('🏁'), true);
  check('  e conta no total', Dados.potes(id).guardar >= 60, true);

  /* NENHUMA TELA PODE FICAR SEM SAÍDA. Uma criança que chega num beco sem botão
     de voltar não sabe fechar app — ela desiste, e o cofrinho fica abandonado. */
  App.aba = 'tarefas';
  check('a barra de abas leva às quatro telas',
    ['cofrinho', 'tarefas', 'sonho', 'selos'].every(a => barraDeAbas().includes(`data-aba="${a}"`)), true);
  check('a tela de tarefas explica que não tem tarefa ainda', telaTarefas().includes('adulto'), true);
  check('a tela do sonho não fica vazia sem meta', telaSonho().includes('sonho'), true);
  check('a tela de prêmios sempre mostra os seis', (telaSelos().match(/class="premio /g) || []).length, 6);

  // O ritual escreve na tela e o botão dele fecha o ciclo
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 8, date: Dados.somarDiasISO(HOJE, 0), confirmada: true });
  limpar(id);
}

/* ================= Tela de gastar ================= */
console.log('\n=== A tela de gastar ===');
{
  const id = novaCrianca();
  Dados.upsert('kid_entries', { kid_id: id, tipo: 'semanada', pote: 'gastar', amount: 6, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', id);
  telaGastar('gastar');
  const t = tela();
  check('a tela diz quanto ela tem para gastar', t.includes('R$ 6'), true);
  check('  oferece valores prontos, sem teclado de adulto', t.includes('data-v="1"'), true);
  check('  e o botão nasce desligado, com valor zero', t.includes('disabled'), true);
  check('  com opções ilustradas do que ela comprou', t.includes('🍭'), true);

  telaGastar('doar');
  check('a tela de doar fala de doação', tela().includes('doar'), true);
  limpar(id);
}

/* ================= Senha ================= */
console.log('\n=== A senha da criança ===');
{
  const salt = 'sal-de-teste';
  const h = eval('(async () => await hashDaSenha("1234", salt))()');
  h.then(hash => {
    check('a senha vira hash, nunca é guardada em texto', hash.includes('1234'), false);
    check('  com 64 caracteres de SHA-256', hash.length, 64);
  });

  const semSenha = novaCrianca({ name: 'Sem senha' });
  App.kid = null;
  telaSenha(Dados.get('kids', semSenha));
  /* SEM SENHA CADASTRADA O COFRINHO ABRE. Pedir uma senha que não existe
     trancaria a criança para fora sem nenhuma forma de entrar. */
  check('criança sem senha entra direto', App.kid && App.kid.id, semSenha);

  const comSenha = novaCrianca({ name: 'Com senha', pin_hash: 'abc', pin_salt: 'x' });
  App.kid = null;
  telaSenha(Dados.get('kids', comSenha));
  check('criança com senha vê o teclado', tela().includes('tecla-grade'), true);
  check('  com o teclado numérico grande, de 0 a 9',
    Array.from({ length: 10 }, (_, i) => tela().includes(`data-t="${i}"`)).every(Boolean), true);
  check('  quatro bolinhas para os quatro números', (tela().match(/class="bolinha"/g) || []).length, 4);
  check('  e uma saída para quem entrou sem querer', tela().includes('id="voltar-quem"'), true);
  check('  sem entrar antes de acertar', App.kid, null);
  limpar(semSenha); limpar(comSenha);
}

/* ================= Escolher de quem é ================= */
console.log('\n=== Mais de uma criança ===');
{
  App.kid = null;
  telaQuem();
  check('sem criança nenhuma, o recado é para o adulto', tela().includes('Recado para o adulto'), true);

  const a = novaCrianca({ name: 'Ana', pin_hash: 'x', pin_salt: 'y' });
  App.kid = null;
  telaQuem();
  check('com uma só, vai direto para a senha dela', tela().includes('tecla-grade'), true);

  const b = novaCrianca({ name: 'Beto', pin_hash: 'x', pin_salt: 'y' });
  App.kid = null;
  telaQuem();
  check('com duas, ela escolhe de quem é o cofrinho', tela().includes('Ana') && tela().includes('Beto'), true);
  check('  tocando no bichinho, não lendo um menu', (tela().match(/quem-av/g) || []).length, 2);
  limpar(a); limpar(b);
}

/* ================= Texto para criança ================= */
console.log('\n=== O jeito de falar ===');
{
  check('valor redondo não mostra centavos', fmtKid(7), 'R$ 7');
  check('valor quebrado mostra', fmtKid(7.5), 'R$ 7,50');
  check('hoje é "hoje"', diaBonito(HOJE), 'hoje');
  check('ontem é "ontem"', diaBonito(Dados.somarDiasISO(HOJE, -1)), 'ontem');
  check('dia da semana recente vem por nome',
    /^(domingo|segunda|terça|quarta|quinta|sexta|sábado)$/.test(diaBonito(Dados.somarDiasISO(HOJE, -3))), true);
  check('data antiga vira número mesmo', /\d\d\/\d\d/.test(diaBonito(Dados.somarDiasISO(HOJE, -40))), true);
}

/* ================= A nuvem ================= */
console.log('\n=== O encontro com o app da família ===');
{
  localStorage.removeItem('financas.sync.v1');
  Nuvem.carregar();
  check('sem configuração, a nuvem fica quieta', Nuvem.pronta(), false);

  localStorage.setItem('financas.sync.v1', JSON.stringify({
    url: 'https://exemplo.supabase.co', anonKey: 'k',
    refresh_token: 'r', family_id: '11111111-1111-4111-8111-111111111111',
  }));
  Nuvem.carregar();
  check('com o app da família configurado, ela está pronta', Nuvem.pronta(), true);

  /* AS COLUNAS TÊM QUE BATER com as do app da família. Uma coluna a mais aqui é
     um 400 do PostgREST a cada envio, e o cofrinho pararia de sincronizar em
     silêncio — a criança marcaria tarefas que o adulto nunca veria. */
  const syncSrc = fs.readFileSync(BASE + 'js/sync.js', 'utf8');
  for (const [tab, cols] of Object.entries(COLUNAS_KID)) {
    const m = syncSrc.match(new RegExp(`\\n  ${tab}: \\[([^\\]]*)\\]`));
    const lá = m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
    const sobrando = cols.filter(c => !lá.includes(c));
    check(`${tab}: nenhuma coluna que o app da família não envia`, sobrando, []);
  }

  /* Sem rede, sincronizar falha em silêncio e o app continua de pé.

     O RETRATO É TIRADO DENTRO DA PROMESSA, não antes dela. Tirado fora, ele
     capturava o estado no meio do arquivo e a comparação só rodava ao fim de
     todo o script síncrono — quando os blocos SEGUINTES já tinham criado e
     apagado crianças. O teste reprovava sem existir defeito, e um teste que
     grita pelo motivo errado ensina a ignorá-lo. */
  Nuvem.sincronizar().then(async r => {
    check('sem rede, a sincronização falha calada', r, false);
    const antes = JSON.stringify(Dados.d);
    await Nuvem.sincronizar();
    check('  e não estraga nada do que estava salvo', JSON.stringify(Dados.d), antes);
  });
}

/* ================= A ponte entre os dois apps ================= */
console.log('\n=== A ponte no mesmo aparelho ===');
{
  /* ESTE É O CASO MAIS COMUM e o que não pode falhar: os dois apps no mesmo
     aparelho, sem nuvem configurada. Sem a ponte, o adulto cadastra a criança e
     o app dela abre vazio — e nada na tela explicaria por quê.

     Carrega o DB do app da família de verdade, sobre o mesmo localStorage que o
     cofrinho usa, e confere que o dado atravessa nos DOIS sentidos. */
  const store = {};
  const antigoLS = global.localStorage;
  const lsPonte = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    key: i => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(global, 'localStorage', { value: lsPonte, configurable: true });

  const dbSrc = fs.readFileSync(BASE + 'js/db.js', 'utf8');
  const Fam = eval(dbSrc + '; DB');
  Fam.load();

  const idF = Fam.upsert('kids', {
    name: 'Ponte', avatar: '🐢', cor: '#0984e3',
    semanada_valor: 5, semanada_dia: DIA, active: true,
  });
  Fam.upsert('kid_tasks', { kid_id: idF, name: 'Regar', icon: '🪴', amount: 1, active: true });
  Fam.ponteDoCofrinho();

  // Agora o app da criança carrega, e tem que encontrar a criança lá
  Dados.carregar();
  check('a criança cadastrada no app da família chega no cofrinho',
    Dados.criancas().map(k => k.name), ['Ponte']);
  check('  com a tarefa dela', Dados.tarefas(idF).map(t => t.name), ['Regar']);
  check('  e a semanada configurada', Dados.get('kids', idF).semanada_valor, 5);

  /* A VOLTA: ela marca a tarefa no app dela, e o adulto precisa ver para poder
     confirmar. Se só fosse de ida, a criança marcaria tarefas para sempre e
     ninguém nunca as confirmaria. */
  Dados.marcarTarefa(idF, Dados.tarefas(idF)[0].id);
  Fam.ponteDoCofrinho();
  check('a tarefa que ela marcou chega para o adulto', Fam.kidTarefasAConfirmar().length, 1);
  check('  ainda sem creditar nada', Fam.kidPotes(idF).gastar, 0);

  // E o adulto confirma: o dinheiro entra e o cofrinho dela vê
  const pendente = Fam.kidTarefasAConfirmar()[0].entry;
  Fam.upsert('kid_entries', { ...pendente, confirmada: true });
  Fam.ponteDoCofrinho();
  Dados.carregar();
  check('confirmada pelo adulto, a moeda aparece no cofrinho dela', Dados.potes(idF).gastar, 1);

  /* QUEM MEXEU DEPOIS VENCE, dos dois lados. Sem isso, uma edição do adulto
     apagaria o gasto que a criança acabou de lançar, ou o contrário. */
  Dados.upsert('kids', { ...Dados.get('kids', idF), avatar: '🦊' });
  Fam.ponteDoCofrinho();
  check('mudança feita no app dela vence a versão antiga daqui', Fam.get('kids', idF).avatar, '🦊');

  Fam.upsert('kids', { ...Fam.get('kids', idF), avatar: '🦁' });
  Fam.ponteDoCofrinho();
  Dados.carregar();
  check('e mudança feita aqui vence lá', Dados.get('kids', idF).avatar, '🦁');

  /* A PONTE RODA SOZINHA. Todos os casos acima a chamam à mão, e isso deixaria
     de fora justamente o que protege contra esquecimento: qualquer fluxo novo do
     app da família — editar a meta, pagar a semanada por outro caminho — tem que
     atravessar sem ninguém lembrar de nada. Nada de ponteDoCofrinho aqui. */
  Fam.upsert('kid_goals', { kid_id: idF, name: 'Bicicleta', icon: '🚲', target_amount: 40, done: false });
  Dados.carregar();
  check('a ponte atravessa sem ser chamada à mão',
    Dados.meta(idF) && Dados.meta(idF).name, 'Bicicleta');
  Fam.remove('kid_goals', Dados.meta(idF).id);
  Dados.carregar();
  check('  e a remoção também atravessa sozinha', Dados.meta(idF), null);

  /* O QUE A PONTE NÃO LEVA: nada da vida financeira da casa. É o motivo de o
     armazém do cofrinho poder ficar em claro, sem PIN. */
  Fam.upsert('transactions', { description: 'Salário', amount: 9000, date: HOJE, type: 'entrada' });
  Fam.ponteDoCofrinho();
  const bruto = localStorage.getItem('financas.cofrinho.v1');
  check('a ponte não leva lançamento da família', bruto.includes('Salário'), false);
  check('  nem tabela de conta, cartão ou categoria',
    ['accounts', 'cards', 'categories', 'transactions'].some(t => bruto.includes(`"${t}"`)), false);

  // Sem criança nenhuma, a ponte não faz nada nem cria armazém do nada
  for (const t of ['kid_entries', 'kid_tasks', 'kid_goals']) {
    for (const r of Fam.all(t)) Fam.remove(t, r.id);
  }
  Fam.remove('kids', idF);
  delete store['financas.cofrinho.v1'];
  Fam.data.kids = []; Fam.data.kid_tasks = []; Fam.data.kid_entries = []; Fam.data.kid_goals = [];
  check('sem criança, a ponte não escreve nada', Fam.ponteDoCofrinho(), 0);
  check('  e não deixa armazém vazio para trás', localStorage.getItem('financas.cofrinho.v1'), null);

  Object.defineProperty(global, 'localStorage', { value: antigoLS, configurable: true });
  Dados.carregar();
}

/* ================= O design que a idade exige ================= */
console.log('\n=== Interface para seis anos ===');
{
  /* Estas não são preferências de gosto: são as regras que fazem a diferença
     entre uma criança de seis anos conseguir usar o app sozinha ou não. Um
     "ajuste rápido" no CSS pode desfazer qualquer uma delas sem que nada pareça
     quebrado na tela — e é por isso que estão medidas aqui. */
  const css = fs.readFileSync(BASE + 'cofrinho/css/cofrinho.css', 'utf8');

  /* ALVO DE TOQUE. O dedo de uma criança acerta mal, e errar o botão numa tela
     de dinheiro frustra de um jeito específico: ela acha que o app não funciona.
     Nenhum alvo abaixo de 76px. */
  const alvos = [...css.matchAll(/(?:min-height|height):\s*(\d+)px/g)].map(m => +m[1]);
  /* O `(?![-\w])` importa: sem ele, `.missao-ico` e `.aba-selo` entram na conta e
     o teste reprova por causa de um círculo de ícone e de um contador — que não
     são alvos de toque. Um teste que grita pelo motivo errado ensina a ignorá-lo. */
  const pequenos = [...css.matchAll(/\.(bt|tecla|missao|aba|chip|quem-bt|pote-bloco)(?![-\w])[^{]*\{[^}]*?(?:min-height|height):\s*(\d+)px/g)]
    .filter(m => +m[2] < 76).map(m => `${m[1]}=${m[2]}px`);
  check('nenhum alvo de toque abaixo de 76px', pequenos.length ? pequenos.join(', ') : true, true);
  check('  e o teclado da senha tem teclas grandes', alvos.some(a => a >= 84), true);

  /* O CLIQUE AFUNDA. É o que faz a tela responder como objeto físico. Sem
     retorno visível, a criança toca de novo — e o app parece quebrado, não
     lento. Vale para botão, tecla, card de missão e pote. */
  for (const sel of ['.bt:active', '.tecla:active', '.missao:active', '.pote-bloco:active', '.chip:active', '.quem-bt:active']) {
    const re = new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}');
    const m = css.match(re);
    check(`  ${sel} afunda ao toque`, !!m && /translateY\(\s*\d/.test(m[1]), true);
  }

  /* AÇÃO LONGE DA BORDA DE BAIXO: ali é onde a mão apoia o tablet, e botão
     colado no canto dispara sozinho o tempo todo. */
  const barra = (css.match(/\.barra\s*\{([^}]*)\}/) || [])[1] || '';
  const folga = +(barra.match(/padding:[^;]*?calc\((\d+)px/) || [])[1];
  check('a barra de abas fica longe da borda de baixo', folga >= 18, true);
  check('  e respeita a área segura do aparelho', /env\(safe-area-inset-bottom\)/.test(barra), true);
  check('  sendo uma pílula flutuante, não uma barra colada',
    /\.barra-in\s*\{[^}]*border-radius:\s*999px/.test(css), true);

  /* A FONTE QUE O CSS PEDE É A QUE O HTML BUSCA.

     Peguei isto acontecendo: troquei a pilha do CSS para Fredoka e o HTML
     continuou carregando Baloo 2. Nada quebra, nada avisa — o app simplesmente
     abre com a letra do sistema, e a tipografia arredondada que a idade pede
     desaparece sem deixar rastro. */
  const html = fs.readFileSync(BASE + 'cofrinho/index.html', 'utf8');
  const pilha = (css.match(/font-family:\s*([^;]+);/) || [])[1] || '';
  const pedidas = [...pilha.matchAll(/'([^']+)'/g)].map(m => m[1]);
  const baixadas = [...html.matchAll(/family=([A-Za-z+0-9]+)/g)].map(m => m[1].replace(/\+/g, ' '));
  check('o CSS pede pelo menos duas fontes, com reserva', pedidas.length >= 2, true);
  check('  e a primeira delas é a que o HTML baixa', baixadas.includes(pedidas[0]), true);
  /* Fontes DO SISTEMA não se baixam — elas já estão no aparelho, e é justamente
     por isso que fecham a pilha. 'Baloo 2' fica de fora por outro motivo: é a
     reserva histórica, de quando o app usava ela, e mantê-la na pilha não custa
     nada para quem já a tem em cache. */
  const doSistema = ['Segoe UI', 'Baloo 2', 'Helvetica Neue', 'Roboto'];
  const semBaixar = pedidas.filter(f => !baixadas.includes(f) && !doSistema.includes(f));
  check('  nenhuma fonte pedida fica sem ser buscada',
    semBaixar.length ? semBaixar.join(', ') : true, true);
  check('  e a pilha termina no sistema, para o app abrir offline',
    /system-ui|sans-serif/.test(pilha), true);

  /* QUEM PREFERE MENOS MOVIMENTO continua com o app inteiro, só quieto. O app é
     cheio de animação de propósito; desligá-la não pode esconder nada. */
  check('quem pede menos movimento tem o app quieto',
    /prefers-reduced-motion: reduce[\s\S]*animation-duration:\s*\.001ms/.test(css), true);

  /* COR NUNCA SOZINHA. Cada pote leva o nome escrito e um ícone, e cada prêmio
     leva nome e desenho próprio. É o que mantém o app legível para quem não
     distingue verde de vermelho — 1 em cada 12 meninos. */
  const idT = novaCrianca({ name: 'Design' });
  Dados.upsert('kid_entries', { kid_id: idT, tipo: 'semanada', pote: 'gastar', amount: 9, date: HOJE, confirmada: true });
  App.kid = Dados.get('kids', idT);
  App.aba = 'cofrinho';
  const tc = telaCofrinho();
  check('cada pote diz o nome por escrito',
    ['>Gastar<', '>Guardar<', '>Doar<'].every(n => tc.includes(n)), true);
  check('  e traz um ícone junto da cor',
    ['🛒', '🏦', '💝'].every(e => tc.includes(e)), true);

  /* CADA PRÊMIO TEM ARTE PRÓPRIA. Seis estrelas amarelas iguais não são uma
     coleção, são uma contagem: a criança precisa distinguir os prêmios de longe
     para querer completar. */
  App.aba = 'selos';
  const artes = new Set();
  for (const s of Dados.selos(idT)) artes.add(Arte.premio(s.id, true));
  check('os seis prêmios têm desenhos diferentes', artes.size, 6);

  const ts = telaSelos();
  check('prêmio bloqueado mostra o cadeado', ts.includes('cad-mini'), true);
  const idT2 = novaCrianca({ name: 'Design2' });
  Dados.upsert('kid_entries', { kid_id: idT2, tipo: 'semanada', pote: 'gastar', amount: 8, date: HOJE, confirmada: true });
  Dados.dividir(idT2, 3, 1);
  App.kid = Dados.get('kids', idT2);
  check('  e o ganho não mostra cadeado nenhum no lugar dele',
    (telaSelos().match(/cad-mini/g) || []).length < (ts.match(/cad-mini/g) || []).length, true);

  /* IDS DE SVG ÚNICOS POR POTE. Três potes na mesma tela usam clipPath, e id
     repetido faz um recorte valer para todos — na prática, dois potes parecendo
     ter o mesmo saldo. É invisível no código e óbvio na tela. */
  App.kid = Dados.get('kids', idT);
  App.aba = 'cofrinho';
  const ids = [...telaCofrinho().matchAll(/id="cp-([^"]+)"/g)].map(m => m[1]);
  check('cada pote tem o seu próprio recorte de SVG', ids.length, new Set(ids).size);
  check('  e são os três da tela', ids.length, 3);

  /* O RITUAL desenha potes DE NOVO, na mesma página: se reaproveitasse os ids da
     tela principal, o recorte de um valeria para o outro. */
  const rit = Arte.pote('gastar', 5, 10, 'rep-gastar') + Arte.pote('gastar', 5, 10, 'gastar');
  const idsRit = [...rit.matchAll(/id="cp-([^"]+)"/g)].map(m => m[1]);
  check('o ritual usa recortes próprios', idsRit.length, new Set(idsRit).size);

  /* AS MOEDAS DENTRO DO POTE CONTAM ALGO: pote mais cheio, mais moedas. É a
     leitura que funciona antes de saber ler número. */
  const conta = v => (Arte.pote('guardar', v, 100).match(/pote-moeda/g) || []).length;
  /* Três níveis, não dois: com dois, uma contagem FIXA de fileiras passava verde,
     porque o corte pela linha do líquido bastava para dar a diferença. A escada
     de 25 → 60 → 100 exige que a quantidade acompanhe o saldo de verdade.

     Nota para quem sabotar isto: fixar as fileiras em 4 continua passando, e está
     certo que passe. O desenho tem duas proteções — o número de fileiras E o
     corte na linha do líquido —, e a segunda sozinha ainda entrega o
     comportamento que importa. Exigir a primeira seria testar a implementação em
     vez do que a criança vê. */
  check('mais dinheiro, mais moedas no pote', conta(25) < conta(60) && conta(60) < conta(100), true);
  check('  e pote vazio não tem moeda nenhuma', conta(0), 0);

  /* O POTE VAZIO NÃO MENTE, e o cheio não transborda: com R$ 0,50 o líquido
     aparece, e no máximo ele para antes da tampa. */
  const alturaDe = svg => +(svg.match(/class="pote-liq" x="\d+" y="([\d.]+)"/) || [])[1];
  const chao = alturaDe(Arte.pote('gastar', 0, 100));
  check('pote sem dinheiro fica no fundo', chao, 138);
  /* "APARECE" TEM QUE SER MEDIDO. `< 138` passava com meio pixel de líquido — e
     meio pixel é exatamente o pote vazio que mente para ela. O mínimo desenhado
     são 8% da altura útil, e é isso que a conta abaixo exige. */
  const util = 138 - 46;
  check('  com R$ 0,50 o líquido aparece de verdade',
    alturaDe(Arte.pote('gastar', 0.5, 100)) <= 138 - util * 0.07, true);
  check('  e cheio não passa da tampa', alturaDe(Arte.pote('gastar', 100, 100)) > 46, true);

  /* A TRILHA DO SONHO enche junto com o guardado, e tem etapas visíveis. */
  const t0 = Arte.trilha(0, '🛴'), t50 = Arte.trilha(50, '🛴'), t100 = Arte.trilha(100, '🛴');
  const largura = svg => +(svg.match(/class="trilha-liq"[^>]*width="([\d.]+)"/) || [])[1];
  check('a trilha começa vazia', largura(t0), 0);
  /* A TRILHA CHEIA TEM QUE TER LARGURA. Sem esta linha, a proporção abaixo
     passava verde com a trilha travada em zero: `0 === 0/2` é verdade, e o teste
     inteiro virava decoração. Teste vazio, encontrado por sabotagem. */
  check('  e a trilha cheia ocupa o tubo', largura(t100) > 200, true);
  check('  enchendo pela metade no meio do caminho', Math.round(largura(t50)), Math.round(largura(t100) / 2));
  check('  e tem bandeirinhas de etapa', (t50.match(/bandeira-ja/g) || []).length >= 2, true);
  check('  com o brinquedo esperando no fim', t50.includes('🛴'), true);

  /* O DINO TROCA DE CARA conforme o que aconteceu — é a informação que a criança
     lê primeiro, antes de qualquer texto. Mesmo corpo, caras diferentes. */
  const poses = ['oi', 'feliz', 'uau', 'pensando', 'dormindo', 'triste'];
  const caras = new Set(poses.map(p => Arte.dino(p, 100)));
  check('o Dino tem seis caras diferentes', caras.size, 6);
  for (const p of poses) {
    check(`  a pose ${p} mantém o mesmo corpo`, Arte.dino(p, 100).includes('class="dino-corpo"'), true);
  }
  check('o Dino aparece grande na tela principal', /width="1[2-9]\d"/.test(tc), true);

  limpar(idT); limpar(idT2);
}

/* ================= O SVG é válido? ================= */
console.log('\n=== SVG bem formado ===');
{
  /* ISTO EXISTE PORQUE EU ERREI. Escrevi `<ellipse cx="86" cy="70" r="0" rx="7.5"
     ry="8">` — um `r` sobrando num ellipse, resto de uma edição. O navegador
     engole calado: a elipse desenha e ninguém percebe. Mas a próxima versão do
     erro pode ser uma tag sem fechar, e aí o Chrome descarta o resto do SVG e a
     criança abre o app com um pedaço da tela faltando, sem nenhum aviso.

     Nada aqui olhava para o desenho. Toda a suíte confere números e strings, e o
     desenho é a metade do app que a criança de fato usa. */
  const tags = { svg: 1, g: 1, defs: 1, clipPath: 1, linearGradient: 1, radialGradient: 1, pattern: 1, text: 1 };
  const vazias = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polygon: 1, stop: 1, use: 1 };

  /* Atributos que NÃO existem em cada forma. Não é a lista completa do SVG — é a
     lista dos que se confundem na mão: r num ellipse, rx num circle, x num
     circle. Cada um destes já é um desenho errado que o navegador não reclama. */
  const proibidos = {
    ellipse: ['r', 'x', 'y', 'width', 'height'],
    circle: ['rx', 'ry', 'x', 'y', 'width', 'height'],
    rect: ['cx', 'cy', 'r'],
    line: ['cx', 'cy', 'r', 'rx', 'ry'],
  };

  const validar = (nome, svg) => {
    const pilha = [];
    let erro = null;

    for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
      const [, fecha, tag, attrs, auto] = m;
      if (fecha) {
        const topo = pilha.pop();
        if (topo !== tag) { erro = erro || `</${tag}> fecha <${topo || 'nada'}>`; }
        continue;
      }
      // Atributo repetido na mesma tag: o navegador usa um e descarta o outro
      const nomes = [...attrs.matchAll(/(\w[\w-]*)\s*=/g)].map(a => a[1]);
      const dup = nomes.find((a, i) => nomes.indexOf(a) !== i);
      if (dup) erro = erro || `<${tag}> tem "${dup}" duas vezes`;
      // Atributo que não existe nesta forma
      for (const p of (proibidos[tag] || [])) {
        if (nomes.includes(p)) erro = erro || `<${tag}> não tem atributo "${p}"`;
      }
      // Aspas desbalanceadas engolem o resto do arquivo
      if ((attrs.match(/"/g) || []).length % 2) erro = erro || `<${tag}> tem aspas ímpares`;
      if (!auto && !vazias[tag]) pilha.push(tag);
      if (!auto && vazias[tag]) pilha.push(tag);   // <rect ...></rect> é válido
    }
    if (pilha.length && !erro) erro = `ficou aberto: <${pilha.join('>, <')}>`;
    check(`${nome}: SVG bem formado`, erro || true, true);
  };

  for (const p of ['oi', 'feliz', 'uau', 'pensando', 'dormindo', 'triste']) validar(`dino ${p}`, Arte.dino(p));
  for (const t of ['gastar', 'guardar', 'doar']) {
    validar(`pote ${t} vazio`, Arte.pote(t, 0, 10));
    validar(`pote ${t} cheio`, Arte.pote(t, 10, 10));
  }
  for (const s of ['dividiu', 'tarefas', 'guardou', 'doou', 'moeda', 'meta']) {
    validar(`prêmio ${s} ganho`, Arte.premio(s, true));
    validar(`prêmio ${s} travado`, Arte.premio(s, false));
  }
  validar('moeda', Arte.moeda());
  validar('check de ouro', Arte.checkOuro());
  validar('ampulheta', Arte.ampulheta());
  validar('cadeado fechado', Arte.cadeado(false));
  validar('cadeado aberto', Arte.cadeado(true));
  validar('cadeado pequeno', Arte.cadeadoMini());
  validar('confete', Arte.confete());
  validar('céu', Arte.cenario());
  for (const pct of [0, 37, 100]) validar(`trilha ${pct}%`, Arte.trilha(pct, '🛴'));

  /* E as TELAS inteiras, que são SVG dentro de HTML: um `<div>` sem fechar leva
     metade da tela com ele, e o app abre pela metade sem dizer nada. */
  const idS = novaCrianca({ name: 'Valida' });
  Dados.upsert('kid_entries', { kid_id: idS, tipo: 'semanada', pote: 'gastar', amount: 12, date: HOJE, confirmada: true });
  Dados.upsert('kid_tasks', { kid_id: idS, name: 'Missão', icon: '🧹', amount: 2, active: true });
  Dados.upsert('kid_goals', { kid_id: idS, name: 'Sonho', icon: '🛴', target_amount: 40, done: false });
  App.kid = Dados.get('kids', idS);
  for (const [nome, fn] of [['cofrinho', telaCofrinho], ['missões', telaTarefas], ['sonho', telaSonho], ['prêmios', telaSelos]]) {
    const html = fn();
    const abre = (html.match(/<div\b/g) || []).length + (html.match(/<button\b/g) || []).length + (html.match(/<span\b/g) || []).length;
    const fecha = (html.match(/<\/div>/g) || []).length + (html.match(/<\/button>/g) || []).length + (html.match(/<\/span>/g) || []).length;
    check(`tela do ${nome}: todo bloco fecha`, abre, fecha);
  }
  limpar(idS);
}

/* ================= Versão dos arquivos ================= */
console.log('\n=== Versão dos arquivos (evita servir o app velho) ===');
{
  /* A armadilha, aqui, é pior do que no app da família. Se eu corrigir um erro
     de conta no cofrinho e esquecer de mover as tags `?v=`, o service worker
     serve o arquivo antigo — e o sintoma é uma criança vendo um saldo errado num
     app que "já foi corrigido". Ninguém liga o sintoma à causa. */
  const html = fs.readFileSync(BASE + 'cofrinho/index.html', 'utf8');
  const sw = fs.readFileSync(BASE + 'cofrinho/sw.js', 'utf8');
  const man = JSON.parse(fs.readFileSync(BASE + 'cofrinho/manifest.webmanifest', 'utf8'));

  const versao = (sw.match(/const VERSAO = '([^']+)'/) || [])[1];
  check('o service worker do cofrinho declara a versão', !!versao, true);

  const proprios = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)(\?v=([^"]+))?"/g)];
  const semVersao = proprios.filter(t => !t[3]).map(t => t[1]);
  check('todo script e CSS dele carrega versionado', semVersao.length ? semVersao.join(', ') : true, true);
  const divergentes = proprios.filter(t => t[3] !== versao).map(t => `${t[1]} (v${t[3]} ≠ v${versao})`);
  check('HTML e service worker na mesma versão', divergentes.length ? divergentes.join(', ') : true, true);

  /* TUDO O QUE O HTML CARREGA TEM QUE ESTAR NA CASCA do service worker, senão o
     app abre offline sem o arquivo que faltou — e um cofrinho sem o CSS é uma
     página branca com texto, que uma criança não sabe interpretar. */
  const carregados = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?v=[^"]*)?)"/g)].map(m => m[1]);
  check('  e o HTML de fato carrega arquivos (senão o teste abaixo é vazio)',
    carregados.length >= 4, true);
  const faltando = carregados.filter(u => !sw.includes(u) && !sw.includes('./' + u));
  check('a casca do cofrinho guarda tudo o que o HTML carrega',
    faltando.length ? faltando.join(', ') : true, true);

  check('o cache dele tem nome próprio, separado do app da família',
    sw.includes("'cofrinho-' + VERSAO"), true);
  check('  e limpa só os caches dele ao atualizar', sw.includes("k.startsWith('cofrinho-')"), true);

  /* O ESCOPO É O DA PASTA. Um escopo de raiz aqui roubaria o controle das páginas
     do app da família — o service worker da criança passaria a responder pelas
     telas do adulto. */
  check('o manifest fica no escopo da pasta', man.scope, './');
  check('  e abre no index do cofrinho', man.start_url, './index.html');
  check('o app dela tem ícone próprio', man.icons.length >= 3, true);
  check('  incluindo um maskable, para o recorte redondo do Android',
    man.icons.some(i => i.purpose === 'maskable'), true);
  for (const i of man.icons) {
    check(`  o arquivo ${i.src} existe`, fs.existsSync(BASE + 'cofrinho/' + i.src), true);
  }
}

/* ================= Encerramento ================= */
setImmediate(() => {
  console.log(`\n${fail === 0 ? '✅ TUDO CERTO' : '❌ PROBLEMAS ENCONTRADOS'} — ${pass} passaram, ${fail} falharam`);
  process.exitCode = fail === 0 ? 0 : 1;
});
