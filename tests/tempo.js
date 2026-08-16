/* Roda a suíte de fumaça em várias datas de calendário.

   Por que existe: `tests/smoke.js` congela o relógio numa âncora para ser
   determinística. Sozinho, isso trocaria um defeito por outro — a suíte deixaria
   de apodrecer e passaria a nunca mais olhar para o calendário. Aqui ela roda em
   datas escolhidas justamente pelas bordas que já quebraram alguma coisa neste
   app:

   - dia 1  — o mês não tem passado nenhum
   - dia 12 — âncora padrão, meio de um mês de 31 dias
   - penúltimo e ÚLTIMO dia — o mês não tem futuro; foi aqui que a curva do
     extrato ficou sem a metade prevista e a duplicata de contrato sumiu
   - fevereiro — o mês curto, e o dia 31 que não existe
   - 29/02 de ano bissexto
   - virada de ano — o "mês seguinte" muda de ano junto

   Um teste que só passa em algumas dessas datas está contando com o acaso, e é o
   tipo de coisa que só aparece meses depois, num dia em que ninguém mexeu em nada.
*/
const { execFileSync } = require('child_process');
const path = require('path');

const SMOKE = path.join(__dirname, 'smoke.js');

const DATAS = [
  ['primeiro dia do mês', '2026-08-01T10:00:00-03:00'],
  ['meio do mês (âncora)', '2026-08-12T10:00:00-03:00'],
  // Dia 20: a data em que caem as ocorrências mensais do cenário. Rodar
  // exatamente NO dia da ocorrência separa "vence hoje" de "vence amanhã", e foi
  // aí que o contador do teste passou a divergir do app.
  ['dia da ocorrência', '2026-08-20T10:00:00-03:00'],
  ['penúltimo dia', '2026-08-30T10:00:00-03:00'],
  ['último dia do mês', '2026-08-31T10:00:00-03:00'],
  ['fevereiro, mês curto', '2026-02-27T10:00:00-03:00'],
  ['29 de fevereiro', '2028-02-29T10:00:00-03:00'],
  ['virada de ano', '2026-12-31T10:00:00-03:00'],
  ['primeiro dia do ano', '2027-01-01T10:00:00-03:00'],
];

let piores = 0;
for (const [rotulo, quando] of DATAS) {
  let saida = '';
  try {
    saida = execFileSync(process.execPath, [SMOKE], {
      env: { ...process.env, HOJE: quando },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // A suíte sai com código 1 quando reprova; a saída dela é o que interessa
    saida = (e.stdout || '') + (e.stderr || '');
  }
  const falhas = saida.split('\n').filter(l => l.startsWith(' FALHA'));
  piores += falhas.length;
  const dia = quando.slice(0, 10);
  console.log(`${falhas.length === 0 ? '  OK  ' : ' FALHA'} | ${dia}  ${rotulo.padEnd(24)} ${falhas.length === 0 ? '' : falhas.length + ' reprovaram'}`);
  for (const f of falhas) console.log('         ' + f.replace(/^ FALHA \| /, ''));
}

console.log(piores === 0
  ? `\n✅ A suíte é verde nas ${DATAS.length} datas`
  : `\n❌ ${piores} reprovações somadas nas ${DATAS.length} datas`);
process.exit(piores ? 1 : 0);
