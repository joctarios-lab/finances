/* PROVA DE PONTA A PONTA DO COFRE.

   Asserção de texto ("o código chama cifrar()") não prova que o resultado é
   ilegível. Isto roda a cifra de verdade, no mesmo WebCrypto do navegador, e
   pergunta as três coisas que importam:

     1. o que sobe é mesmo ilegível?
     2. a mesma senha, num aparelho novo, recupera?
     3. a senha errada falha — sem derrubar o app?
*/
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
DB.data = DB.data || { meta: {} };
DB.data.meta = DB.data.meta || {};

// O app só conhece o id do usuário; a senha passa uma vez, no login.
global.Sync = { cfg: { user_id: '7f3a9c21-4b8e-4d55-9a10-2c6ef0b7d123' } };

const SENHA = 'senha-real-do-login-2026';
const CHAVE_API = 'sk-ant-api03-EXEMPLO-NAO-E-UMA-CHAVE-REAL-0000';

let falhas = 0;
const ok = (rot, cond, extra = '') => {
  console.log((cond ? '  OK   | ' : ' FALHA | ') + rot.padEnd(52) + extra);
  if (!cond) falhas++;
};

(async () => {
  await IA.abrirCofre(SENHA);
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.chave = CHAVE_API;

  const subiu = await IA.cifrar(IA.cfg);

  console.log('\n=== 1. o que o Supabase realmente guarda ===');
  console.log('  ' + subiu.slice(0, 96) + '…\n');
  ok('a chave não aparece no que sobe', !subiu.includes(CHAVE_API));
  ok('nem um pedaço dela', !subiu.includes('sk-ant') && !subiu.includes('api03'));
  ok('nem o prefixo "chave"', !subiu.includes('chave'));
  ok('o que sobe é um blob com iv e ct', /"iv":/.test(subiu) && /"ct":/.test(subiu));

  console.log('\n=== 2. aparelho novo, mesma senha ===');
  // Simula "apagar os dados deste aparelho": tudo zerado, só o login volta.
  IA.cofre = null;
  DB.data.meta = {};
  IA.cfg = IA.padrao();
  ok('sem cofre, não decifra nada', (await IA.decifrar(subiu)) === null);

  await IA.abrirCofre(SENHA);
  const voltou = await IA.decifrar(subiu);
  ok('com a mesma senha, o cofre abre', !!voltou);
  ok('e a chave da API volta inteira', voltou && voltou.chave === CHAVE_API);
  ok('junto com a configuração', voltou && voltou.ligado === true);

  console.log('\n=== 3. senha trocada ===');
  IA.cofre = null;
  DB.data.meta = {};
  await IA.abrirCofre('a-senha-agora-e-outra');
  const nada = await IA.decifrar(subiu);
  ok('senha diferente não abre', nada === null);
  ok('e falha devolvendo null, sem estourar', nada === null);

  console.log('\n=== 4. a conversa também ===');
  IA.cofre = null;
  DB.data.meta = {};
  await IA.abrirCofre(SENHA);
  const conversa = { id: 'c1', titulo: 'Quanto sobra este mês?', tocada: 1, turnos: [{ q: 'Quanto sobra?', r: 'Sobram R$ 1.240,00.' }] };
  const chatSubiu = await IA.cifrar(conversa);
  ok('a pergunta não sobe legível', !chatSubiu.includes('Quanto sobra'));
  ok('nem a resposta com o valor', !chatSubiu.includes('1.240'));
  const chatVoltou = await IA.decifrar(chatSubiu);
  ok('e volta inteira', chatVoltou && chatVoltou.turnos[0].r === 'Sobram R$ 1.240,00.');


  console.log('\n=== 5. o cofre fechado: o aparelho que não sincronizava ===');
  /* O CENÁRIO RELATADO, e que este teste existe para não voltar.

     A chave do cofre nasce da senha do login, e a senha só passa pelo app em
     Sync.signIn. Ninguém faz login toda hora — a sessão se renova sozinha pelo
     refresh token. Então, num aparelho que já estava logado quando o assistente
     foi configurado, o cofre nunca era criado. E aí:

       • cifrar() devolvia null e nuvemSalvarCfg() retornava calado: nunca subiu
         nada, nem a chave nem uma conversa;
       • sincronizar() saía antes de puxar: nunca desceu nada;
       • e a tela afirmava "Cópia na nuvem ligada" — falso.

     Nenhum erro em lugar nenhum. Falha silenciosa é a pior categoria: o app
     parecia estar fazendo backup e não estava. */
  IA.cofre = null;
  DB.data.meta = {};
  IA.cfg = IA.padrao();
  IA.cfg.ligado = true;
  IA.cfg.chaves.anthropic = 'sk-ant-CONFIGURADA-NO-PC';

  /* O stub de Sync precisa existir ANTES: temNuvem() o consulta. */
  global.Sync = { loggedIn: () => true, cfg: { user_email: 'x@y.z', user_id: 'u1', url: 'https://u' } };

  ok('tem chave e está pronto para usar', IA.disponivel() === true);
  ok('mas o cofre não está aberto', IA.cofreAberto() === false);
  ok('  logo, cifrar não produz nada', (await IA.cifrar({ x: 1 })) === null);
  ok('  e nada subiria para a nuvem', (await IA.nuvemSalvarCfg()) === undefined);

  ok('logado e sem cofre => "falta liberar"', IA.estadoDaNuvem() === 'falta-liberar');
  await IA.abrirCofre('a-senha-do-login');
  ok('com o cofre aberto => "ligada"', IA.estadoDaNuvem() === 'ligada');
  ok('  e agora cifrar funciona', typeof (await IA.cifrar({ x: 1 })) === 'string');
  Sync.loggedIn = () => false;
  ok('sem login => "sem nuvem"', IA.estadoDaNuvem() === 'sem-nuvem');

  console.log(falhas ? `\n❌ ${falhas} falharam` : '\n✅ o cofre faz o que promete');
  process.exit(falhas ? 1 : 0);
})();
