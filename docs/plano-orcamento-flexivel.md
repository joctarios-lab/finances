# Orçamento flexível: o padrão e o ajuste do mês

Como um envelope pode valer R$ 500 num mês normal e R$ 800 no mês em que a conta
do carro chega, sem que uma coisa apague a outra.

## O problema

`categories.monthly_budget` é um campo **atemporal**, e `DB.budgetTotal()` não
recebia período. Duas consequências, as duas anteriores a esta mudança:

- o orçamento valia para **todos os meses, inclusive os passados** — subir de 500
  para 800 hoje reescrevia julho, e o relatório de um mês fechado passava a
  comparar o gasto contra um teto que não valia lá;
- não havia como responder *"quanto eu tinha orçado em julho?"*.

Havia ainda uma incoerência visível: a folha do envelope mostrava o **gasto do mês
navegado** contra o **limite atemporal** — dois meses diferentes na mesma frase.

## O modelo

Tabela `budget_overrides`: `category_id`, `period_start`, `amount`.

**A chave é o primeiro dia do CICLO, não um rótulo `"AAAA-MM"`.** O dia de virada
é configurável (`family_settings.month_start_day`), e um rótulo de mês-calendário
cairia no mês errado para quem fecha o ciclo no dia 25.

**Por que tabela e não um JSON dentro da categoria.** O sync compara campo a
campo: dois aparelhos ajustando **meses diferentes** sobrescreveriam o mapa
inteiro um do outro. É exatamente a perda silenciosa que `plano-sync.md` existe
para evitar.

A leitura vive num ponto só:

```
budgetOf(categoria, período) = ajuste(categoria, período) ?? categoria.monthly_budget
budgetTotal(período)         = soma dos budgetOf das raízes de Despesa
```

**Zero é um ajuste legítimo** — "neste mês não se gasta nada aqui". Por isso o
teste é pela EXISTÊNCIA do registro, nunca pela verdade do valor: com `||`, um
ajuste de zero cairia de volta no padrão em silêncio.

## As decisões

| # | Decisão | Por quê |
|---|---|---|
| 1 | O alcance é **escolhido na tela**: "só neste mês" ou "deste mês em diante" | As duas intenções são igualmente comuns; adivinhar erraria metade das vezes |
| 2 | Mudar o padrão **congela o passado** (copy-on-write) | Sem isso o relatório de um mês fechado muda de conclusão sozinho |
| 3 | Só congela onde **houve gasto**, e só na categoria alterada | Materializar o passado inteiro encheria a base para não informar nada |
| 4 | Ajuste **livre**, com atalho de **mover** | O mês do IPVA é aumento real, não troca; mas remanejar precisa conservar o total |
| 5 | O mês ajustado **diz que está ajustado** | Um limite diferente do padrão sem aviso é um número que ninguém explica |
| 6 | A Edge Function foi junto | Um push dizendo "estourou" contra um teto que a tela não usa mais ensina a ignorar os avisos |

## Onde o orçamento é lido

Todos passaram a receber período. Eram 15 pontos:

- `DB.budgetTotal()` — o total do ciclo
- Painel: barras por envelope, rodapé Orçado/Usado/Restante, Conselheiro,
  folha do envelope, notificações locais
- `refLimit` — **só entra quando não há renda cadastrada** (`income > 0 ? income
  : budgetTotal`), então numa família com receita lançada o orçamento não alimenta
  o hero, a trilha do burn-up nem a Projeção do mês
- Relatórios: "Onde isso vai parar"
- Configurações: lista e editor de categoria
- `js/sync.js`: nova entrada em `SYNC_TABLES`
- `supabase/functions/notify/index.ts`: o alerta de estouro

## O que a construção revelou

**Backup antigo deixava de importar.** `importJSON` exigia TODAS as stores, então
qualquer versão que acrescentasse tabela invalidava todos os arquivos salvos até
ali — e um backup só serve se abrir depois. Agora exige as stores que sempre
existiram (`accounts`, `categories`, `transactions`) e normaliza o resto.

**O mapa de tipos do sync é por NOME de coluna, um só para o banco inteiro.** Como
`category_id` é nulável em `transactions` (lançamento sem categoria é legítimo),
a coluna em `budget_overrides` também precisou ser nulável. Quem garante o
preenchimento é o app — `ajustarOrcamento` é o único caminho de escrita — e a
unicidade fica no índice `(family_id, category_id, period_start)`.

**A lista do previsto saiu dos Relatórios.** Ela vive no Painel, na seção "O que
ainda vem". A mesma lista em duas telas envelhece em duas velocidades. Os
Relatórios continuam falando do futuro pelos números e pelos gráficos.

## Pendência de banco

O SQL precisa ser rodado no Supabase: a tabela `budget_overrides`, a policy e o
bloco "CARIMBO DO SERVIDOR", que agora cobre **10 tabelas**. Enquanto não for, o
sync isola a falha **por tabela** — só o ajuste deixa de sincronizar, o resto da
base continua andando.

```sql
select event_object_table, trigger_name from information_schema.triggers
 where trigger_name = 'trg_server_at' order by event_object_table;
```

## O que fica de fora

- **Orçamento por subcategoria** — o limite vive no envelope, e dois níveis de
  teto criariam dois lugares dizendo coisas diferentes sobre o mesmo gasto.
- **Sugerir o ajuste automaticamente** a partir do histórico. O app propõe, a
  pessoa decide — e aqui ela ainda nem pediu proposta.
