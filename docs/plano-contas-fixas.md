# Editar uma conta fixa

A tela "Contas fixas" (Configurações → Contas fixas) e o que dá para mudar num
contrato depois de criado.

## O que faltava

Relatado por quem usa: *"não tenho a opção de alterar as configurações de um
contrato"*. Confirmado — a tela oferecia três ações e nenhuma delas mexia na
configuração:

| ação | mudava |
|---|---|
| **Valor** | o valor e se ele é média |
| **Pausar / Reativar** | o status |
| **Cancelar / Apagar** | encerra o contrato |

**Descrição, periodicidade, dia do vencimento, prazo, categoria, conta e forma de
pagamento não tinham caminho nenhum.** Um aluguel que passou do dia 10 para o 15
só podia ser cancelado e recriado — e isso custa:

- o **histórico de ocorrências** (`geradas`), que é como o app sabe quantas
  faltam num parcelamento;
- o **vínculo** dos lançamentos já gerados, que passariam a contar como gasto
  variável e a inflar o ritmo do mês;
- a contagem de prazo, que recomeçaria do zero.

## O editor

O botão "Valor" virou **"Editar"**, e o valor continua lá dentro — um botão a
menos e um lugar só. Os campos são os que mudam na prática:

```
Editar — Aluguel
Vale das próximas ocorrências em diante. O que já
foi lançado continua como está. Já nasceram 3.

Descrição            [ Aluguel ]
Valor                [ R$ 3.300,00 ]
O valor muda?        [ Não, é sempre o mesmo ▾ ]
Com que frequência?  [ Todo mês ▾ ]
Em que dia?          [ 10 ]
Até quando?          [ Até eu cancelar ▾ ]
Categoria            [ Moradia › Aluguel ▾ ]
Forma de pagamento   [ Boleto ▾ ]
Conta                [ Nubank PJ ▾ ]

              [ Salvar ]
```

**Vale das próximas em diante.** O que já foi lançado fica como está: lançamento
pago é histórico, e reescrever o passado mexeria em saldos já conciliados. O aviso
está na folha porque a expectativa natural de quem corrige o dia é que "agora está
certo" — e está, para as próximas.

**Prazo e cartão só aparecem quando fazem sentido**, como no formulário de
lançamento: os campos de "quantas vezes" e "até que data" ficam escondidos até o
prazo pedir um deles, e o seletor de cartão só surge com a forma de pagamento em
crédito. Cartão e conta se excluem — a compra no cartão pesa na fatura, não sai da
conta direto, e guardar os dois deixaria o app decidindo sozinho qual vale.

## O tipo fica fora, de propósito

Despesa ou receita não é editável. Invertê-lo depois de o contrato ter gerado
ocorrências trocaria o sinal do que já entrou no saldo, e sobraria um contrato de
receita com lançamentos de despesa vinculados. Quem errou o tipo cria outro
contrato: é raro, e o estrago do contrário é grande.

## O defeito que o teste pegou antes de sair

`fim_vezes` é o **total** de ocorrências que o contrato gera, e o que falta é
derivado: `restamDaRecorrencia` calcula `fim_vezes − geradas`.

A primeira versão do editor descontava `geradas` **antes de gravar** — e o desconto
passava a acontecer duas vezes. Um contrato de 12x com 3 nascidas dizia que faltavam
**6** em vez de 9, e ninguém veria até ele terminar antes da hora. Pior: cada
abertura da folha encolheria o número de novo.

Agora a tela pergunta o total (dizendo quantas já nasceram e quantas faltariam),
grava direto em `fim_vezes`, e ao reabrir mostra o total outra vez.

## O que os testes travam

- a folha abre com periodicidade, dia e prazo **atuais** selecionados;
- salvar muda descrição, periodicidade, dia, categoria, método e tipo de valor;
- e **preserva** `geradas`, `inicio` e `type` — o histórico é exatamente o que se
  perderia ao recriar o contrato;
- `fim_vezes` guarda o total, e o que falta sai por subtração;
- reabrir mostra o total, não o que falta;
- contrato no cartão solta a conta;
- descrição vazia não salva;
- o tipo não tem campo na folha;
- o botão "Editar" existe e o antigo "Valor" não.

Nove sabotagens confirmaram que cada uma reprova quando revertida.
