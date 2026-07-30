# vendor/

Bibliotecas de terceiros que moram no repositório.

## apexcharts.min.js + apexcharts.css

ApexCharts v3.54.1 — licença MIT — https://apexcharts.com

**São dois arquivos, e os dois são obrigatórios.** O `.min.js` não injeta o CSS
da biblioteca: sem o `.css`, a dica de valor perde a caixa e perde o
`.apexcharts-canvas { position: relative }` que a ancora — ela é
`position: absolute` e vai para o canto da página em vez de ficar sobre o
gráfico. No `index.html` o `.css` vem **antes** do nosso `styles.css`, para o
nosso poder sobrepor.

Estão aqui de propósito, e não vêm de CDN: o app é offline-first, e uma tag
apontando para um domínio externo deixaria todos os gráficos em branco justamente
quando o app mais tem valor — sem rede. O service worker (`sw.js`) guarda os dois
no cache do shell, então é download único por aparelho.

Para atualizar: baixe as duas versões novas, substitua os arquivos, suba o
`VERSAO` em `sw.js` e os `?v=` em `index.html`, e rode `node tests/smoke.js`.

As decisões de uso estão em `docs/plano-graficos.md`.
