# vendor/

Bibliotecas de terceiros que moram no repositório.

## apexcharts.min.js

ApexCharts v3.54.1 — licença MIT — https://apexcharts.com

Está aqui de propósito, e não vem de CDN: o app é offline-first, e uma tag
`script` apontando para um domínio externo deixaria todos os gráficos em branco
justamente quando o app mais tem valor — sem rede. O service worker (`sw.js`) o
guarda no cache do shell, então é download único por aparelho.

Para atualizar: baixe a versão nova, substitua o arquivo, suba o `VERSAO` em
`sw.js` e os `?v=` em `index.html`, e rode `node tests/smoke.js`.

As decisões de uso estão em `docs/plano-graficos.md`.
