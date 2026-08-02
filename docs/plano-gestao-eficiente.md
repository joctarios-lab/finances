# Auditoria das telas e as seis perguntas que faltavam

Nasceu de um pedido de avaliação: *"simule todos os cenários, valide tudo que está
implementado e me mostre o que é importante e eu não consigo ver em lugar nenhum"*.

## O que a auditoria cobriu

Contra a base real (274 lançamentos, 4 contas, 2 cartões, 117 categorias, 2 metas,
11 contratos):

| frente | cobertura | resultado |
|---|---|---|
| todas as telas | 13 meses (−6 a +6) × 5 telas | 0 exceções, 0 `undefined`/`NaN` |
| filtros do Extrato | 11 cenários × 3 meses | a conta da tela fecha em todos |
| cenários de dados | base vazia, sem contas, sem categorias, sem cartões, sem metas, sem contratos, um lançamento só, saldo negativo, tudo a pagar, tudo pago × 5 telas × 3 meses | 0 exceções |
| identidades entre telas | gasto do Painel = `Rel.gasto` dos Relatórios, mês a mês | batem |

A estrutura passou. Os defeitos estavam nos **números**, não no código quebrando.

## Os três números errados que estavam em tela

### 1. "Projeção do mês: R$ 162.807,82"

`statsFor` projetava `gasto do mês ÷ dias decorridos × dias do mês`. Como aluguel,
escola e parcelas caem no começo do ciclo, o "ritmo" dos primeiros dias é o custo
fixo inteiro. Em 2 de agosto de 2026: R$ 10.503,73 viravam **R$ 162.807,82**, e daí
saía **"Poupança projetada: −671%"**, que o Conselheiro repetia como alerta.

Pior do que o número: o app já tinha a resposta certa na tela ao lado —
`previsaoDoMes` dizia R$ 8.729,22 de saídas conhecidas. **Eram duas projeções
contraditórias no mesmo painel.**

`DB.projecaoDeGasto` conta cada coisa uma vez e do jeito que ela é:

```
gasto até hoje            R$ 306      ← o que aconteceu
+ agendado no resto do mês R$ 10.198  ← lançado + contrato + custo fixo
+ variável no ritmo atual  R$ 4.436   ← só isto se extrapola
= fechamento projetado     R$ 14.940
```

Fixo é `recurrence_id`, `recurring` ou parcela: as três coisas que acontecem uma
vez por ciclo, com dia marcado. Fatura não entra — a compra no cartão já contou
como gasto no dia em que foi feita.

### 2. "Reserva de emergência — maio de 2138"

Alvo R$ 60.000, R$ 134 juntados, ritmo R$ 44,67/mês → 1.340 meses. Aritmeticamente
correto, informativamente inútil: ninguém planeja 112 anos.

Acima de **10 anos** a resposta deixa de ser a data e passa a ser o que falta para
ela existir: *"No ritmo de R$ 45/mês seriam 112 anos. Para fechar em 5, seriam
R$ 998/mês."* Vale para o Painel e para a tela de Metas, pela mesma função.

### 3. A base das porcentagens era uma constante

Renda declarada uma vez em Configurações: R$ 17.000. Realidade: R$ 31.239 em
junho, R$ 22.453 em julho, R$ 17.981 em agosto. `DB.rendaDoMes` passou a ser
**o que já entrou mais o que ainda entra neste ciclo**, com a média dos ciclos
recentes e a renda declarada como fallbacks — nessa ordem.

> **Armadilha que me pegou aqui:** `realizedIncome` conta o que está LANÇADO, pago
> ou a pagar — o nome engana. Somar `previsaoDoMes().entra` por cima contava o
> salário duas vezes: R$ 35.813 num mês de R$ 17.981. E em mês inteiramente futuro
> essas ocorrências já vêm como transações virtuais, então somá-las dobraria de
> novo. Os dois casos estão sob teste.

## As seis perguntas que a base respondia e nenhuma tela fazia

### Vale de caixa — `DB.valeDeCaixa(meses)`

Fechar o mês no azul não impede o boleto do dia 12 de não passar. O dado já
existia: é a mesma varredura que desenha a linha do Extrato. O Conselheiro avisa
em vermelho quando o saldo previsto fica negativo (com a data e quantos dias no
vermelho) e em âmbar quando a folga do dia mais apertado é menor que uma semana de
gasto. Só no mês corrente: repetir o aviso em todo mês o transformaria em paisagem.

### Patrimônio líquido — `DB.patrimonio()`

A tela de Contas listava saldos e faturas em blocos separados e a subtração não era
feita em lugar nenhum: R$ 169,70 em conta contra R$ 2.179,22 de cartão, patrimônio
de **−R$ 2.009,52**. A dívida vem partida em duas porque doem em momentos
diferentes: o que vence neste ciclo já pesa no disponível; **o que já foi comprado
e ainda vai faturar (R$ 1.800 até maio de 2027) não aparecia em número nenhum**.

### Custo fixo mensal — `DB.custoFixoMensal()`

R$ 6.438/mês em 10 contratos. Periodicidades normalizadas (semanal × 52/12), e —
o que faz planejar — **quando cada pedaço acaba**: *"Escola Thomaz acaba em 4 meses
e libera R$ 540/mês. Parcela FordKa acaba em 9 meses e libera R$ 500/mês."*

### Vigia dos contratos — `DB.duplicatasDeContrato()` e `DB.contratosAtrasados()`

O gerador criou a parcela do Fiat 500 **duas vezes** e quem percebeu foi o dono da
casa, no olho, um mês depois — R$ 1.560 a mais de comprometido. Com 11 contratos
rodando sozinhos, isso é manutenção, não luxo.

- **Duplicata**: mesmo nome, **mesmo valor**, dentro da janela de uma ocorrência, e
  **com contrato por trás**. As três condições juntas são o que separa "a parcela
  veio duas vezes" de "fui ao mercado duas vezes na semana". Sem isso o aviso vira
  ruído e ninguém lê mais nenhum.
- **Atrasado**: sai de graça de `previstosNaoLancados` — é o que já venceu e não
  tem lançamento. O contrato que devia ter rodado e não rodou.

### O alerta do Conselheiro que sobrou do modelo antigo

*"Compromissos superam o saldo em R$ 10.254"* aparecia em 2 de agosto num mês que
fecha com R$ 5.799 sobrando: comparava o comprometido do mês inteiro com um saldo
de antes do salário. É o mesmo engano que o hero já tinha deixado para trás. Agora
o alerta é sobre **o fim do ciclo**, com a mesma régua do hero.

## O que já estava bem e não foi tocado

Hero, extrato, relatórios e gráficos contam a mesma história e as identidades entre
telas batem nos 13 meses. Comparação com a média por categoria, "Quem gastou",
"Como pagou", cascata, burn-up, orçamento por envelope e projeção de 6 meses já
existiam e funcionam.
