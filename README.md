# 💰 Finanças da Família — PWA

Aplicativo de gestão financeira familiar: **offline-first**, instalável no celular, com sincronização em nuvem entre os membros da família. Zero dependências, zero build — HTML/CSS/JS puros, hospedável em qualquer host estático.

No **computador** funciona como um painel administrativo (menu lateral, cards, tabelas); no **celular**, como um aplicativo (abas na base, botão flutuante, folhas deslizantes).

## Funcionalidades

**Dia a dia**
- **⚡ Lançamento rápido** — despesa ou receita em segundos, com máscara de moeda (digite `1500` → `R$ 15,00`), categoria em um toque e data de hoje pré-preenchida.
- **💳 Compras parceladas** — informe o valor total e o número de parcelas: o app cria uma parcela por fatura, com os centavos ajustados na primeira.
- **🔁 Custos fixos em 1 clique** — botão no Extrato lança de uma vez os recorrentes que ainda faltam no mês.
- **📥 Importação OFX** — traga o extrato inteiro do banco ou do cartão de uma vez (ver abaixo).
- **💸 Saldo automático** — despesa paga em conta debita o saldo; receita credita; fatura marcada como paga debita a conta vinculada ao cartão.

**Análise**
- **📊 Painel** — cartão de situação com **disponível para usar** (saldo − comprometido) e selo Saudável/Atenção/Crítico; KPIs; **conselheiro** com alertas automáticos; donut por categoria; barras de orçamento com semáforo.
- **🔮 Preditivo** — projeção de fim de mês por *run-rate*, gráfico de **ritmo do mês** (acumulado vs. trilha ideal), taxa de poupança, **regra 50/30/20**, **reserva de emergência em meses de cobertura** e previsão de conclusão das metas pelo ritmo de aportes.
- **📈 Relatórios** — evolução 12 meses, comparativo de categorias com variação %, gasto por membro e por método, top 10 maiores gastos, custos fixos e **exportação CSV** (abre no Excel).

**Plataforma**
- **☁️ Sincronização familiar** via Supabase (opcional — o app funciona 100% sem ela).
- **🔒 Segurança** — PIN que **criptografa os dados no aparelho** (AES-256-GCM, chave derivada por PBKDF2) e bloqueio progressivo contra tentativas.
- **🔔 Notificações** — avisos locais ao abrir o app e **push automático** com o app fechado (ver abaixo).

## Como rodar localmente

Qualquer servidor estático serve:

```powershell
npx serve .          # ou: python -m http.server 8080
```

Abra `http://localhost:8080`. Para instalar no celular, o PWA precisa de **HTTPS** (ver hospedagem).

## Hospedagem (grátis, com HTTPS)

- **GitHub Pages**: suba o repositório e ative Pages na branch principal.
- **Netlify / Vercel / Cloudflare Pages**: arraste a pasta ou conecte o repositório.

Depois abra o endereço no celular → menu do navegador → **"Adicionar à tela de início"** (iPhone: pelo Safari).

## Importar extrato OFX

O OFX é o formato padrão de extrato que praticamente todo banco e cartão brasileiro exporta (procure por *exportar extrato*, *OFX* ou *Money/Quicken* no app do banco).

1. **⚙︎ → Importar extrato OFX** → escolha o arquivo `.ofx`.
2. O app mostra os lançamentos **novos** (os já importados antes são reconhecidos pelo identificador do banco e ignorados — pode reimportar o mesmo arquivo sem medo).
3. Escolha se o extrato é de uma **conta** ou de um **cartão**, revise as categorias sugeridas automaticamente e desmarque o que não quiser.
4. Se for conta, marque **atualizar saldo** para usar o saldo informado pelo próprio banco.

Compatível com OFX 1.x (SGML) e 2.x (XML); acentuação Windows-1252 dos bancos brasileiros é detectada e corrigida. Saídas viram **despesas**; entradas viram **receitas** (num cartão, um estorno reduz a fatura).

## Configurar a sincronização familiar (≈10 minutos, uma vez)

1. Crie uma conta gratuita em [supabase.com](https://supabase.com) e um novo projeto.
2. No painel: **SQL Editor** → cole o conteúdo de `supabase/schema.sql` → **Run**.
3. Em **Settings → API**, copie a **Project URL** e a **anon public key**.
4. No app: **⚙︎ → Sincronização** → cole URL e chave → crie sua conta (e-mail/senha) → **Criar família**.
5. Copie o **código da família** e envie ao cônjuge; no aparelho dele, mesmos passos, mas **cole o código** em vez de criar família.

> Para já entregar o app configurado (sem ninguém colar nada), preencha `url` e `anonKey` em `js/config.js` antes de publicar.
> Dica: em **Authentication → Providers → Email**, desative "Confirm email" para simplificar o primeiro acesso.

## Push automático (avisos com o app fechado)

Avisa sobre fatura fechando/vencendo/vencida, limite do cartão e orçamento estourado — sem precisar abrir o app. Exige a sincronização já configurada.

**1. Gerar as chaves VAPID** (identificam seu servidor para os navegadores):

```bash
npx web-push generate-vapid-keys
```

**2. Publicar a Edge Function** ([instale a CLI](https://supabase.com/docs/guides/cli) antes):

```bash
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase secrets set VAPID_PUBLIC_KEY=<chave-publica> \
                     VAPID_PRIVATE_KEY=<chave-privada> \
                     VAPID_SUBJECT=mailto:voce@email.com
supabase functions deploy notify --no-verify-jwt
```

**3. Agendar a verificação diária**: abra `supabase/cron.sql`, substitua `<SEU-PROJECT-REF>` e `<SUA-ANON-KEY>` e rode no **SQL Editor**.

**4. Ativar nos aparelhos**: coloque a **chave pública** em `js/config.js` (`vapidPublicKey`), publique o app e, em cada celular, vá em **⚙︎ → Notificações → Ativar push neste aparelho**.

> 📱 **iPhone**: o push só funciona depois de adicionar o app à tela de início (iOS 16.4+).
> A chave **privada** VAPID fica só no servidor (secrets do Supabase) — nunca em `js/config.js`.

Para testar sem esperar o horário agendado, rode o `net.http_post` comentado no fim de `supabase/cron.sql`.

## Estrutura

```
index.html                        — shell (sidebar no desktop, tabbar no mobile)
css/styles.css                    — tema inspirado no Metronic 8
js/config.js                      — URL/chaves públicas do Supabase (opcional)
js/icons.js                       — ícones SVG inline (offline, sem CDN)
js/ofx.js                         — leitor de extratos OFX + sugestão de categoria
js/db.js                          — dados locais, criptografia e regras financeiras
js/sync.js                        — sincronização Supabase (REST, sem SDK)
js/auth.js                        — PIN, criptografia AES-256 e bloqueio
js/app.js                         — telas, gráficos e interações
sw.js                             — service worker (offline + push)
supabase/schema.sql               — banco + segurança (RLS por família)
supabase/functions/notify/        — Edge Function que envia os pushes
supabase/cron.sql                 — agendamento diário (pg_cron)
```

## Modelo de dados

`transactions` (despesas e receitas; parcelas ligadas por `group_id`; `fitid` evita reimportar OFX) → `categories` (envelopes com orçamento e tipo Necessidade/Desejo) · `accounts` (contas e saldos) · `cards` (faturas são **derivadas** das compras pelo ciclo de fechamento) · `goals` + `goal_entries` (metas e aportes) · `family_settings` (membros, dia de início do mês, renda). Todas as tabelas carregam `updated_at`/`deleted` para sincronização incremental com resolução *last-write-wins*.

## Rotina sugerida (menos de 10 min por semana)

1. Lance os gastos no ato pelo celular (ou importe o OFX no fim da semana).
2. Confira o **conselheiro** no painel — ele aponta o que precisa de atenção.
3. Mova as faturas no kanban conforme fecham e são pagas.
4. Registre os aportes das metas.

No início do mês: rode o **lançar custos fixos**, confira o **ritmo do mês** e ajuste orçamentos se necessário.
