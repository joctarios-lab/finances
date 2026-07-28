# 💰 Finanças da Família — PWA

Aplicativo de gestão financeira familiar: **offline-first**, instalável no celular, com sincronização em nuvem entre os membros da família. Zero dependências, zero build — HTML/CSS/JS puros, hospedável em qualquer host estático.

## Funcionalidades

- **⚡ Lançamento rápido**: registrar um gasto em segundos (valor, categoria em um toque, data de hoje pré-preenchida).
- **📊 Início**: KPIs do mês, donut de gastos por categoria, barras de orçamento com semáforo, próximos vencimentos.
- **☰ Extrato**: navegação entre meses, filtro Família/Pessoal, edição ao tocar.
- **💳 Cartões**: fatura atribuída **automaticamente** pelo dia de fechamento (compra após o fechamento cai na fatura seguinte); status Aberta → Fechada automático pela data; barra de uso do limite.
- **◎ Metas**: aportes registrados como extrato (nunca edite total na mão), barra de progresso.
- **⚙︎ Configurações**: contas, cartões, categorias/orçamentos, membros, dia de início do mês financeiro (ex: dia do salário), backup JSON e sincronização.
- **☁️ Sincronização familiar** via Supabase (opcional — o app funciona 100% sem ela).

## Como rodar localmente

Qualquer servidor estático serve. Exemplos:

```powershell
# Python
python -m http.server 8080
# ou Node
npx serve .
```

Abra `http://localhost:8080`. Para instalar no celular, o PWA precisa de **HTTPS** (ver hospedagem abaixo).

## Hospedagem (grátis)

Qualquer opção abaixo funciona; todas dão HTTPS automático:

- **GitHub Pages**: suba o repositório e ative Pages na branch principal.
- **Netlify / Vercel / Cloudflare Pages**: arraste a pasta ou conecte o repositório.

Depois abra o endereço no celular → menu do navegador → **"Adicionar à tela de início"** (iPhone: pelo Safari).

## Configurar a sincronização familiar (≈10 minutos, uma vez)

1. Crie uma conta gratuita em [supabase.com](https://supabase.com) e um novo projeto.
2. No painel do projeto: **SQL Editor** → cole o conteúdo de `supabase/schema.sql` → **Run**.
3. Em **Settings → API**, copie a **Project URL** e a **anon public key**.
4. No app: **⚙︎ → Sincronização** → cole URL e chave → crie sua conta (e-mail/senha) → **Criar família**.
5. Copie o **código da família** e envie para o cônjuge; no aparelho dele: mesmos passos 3–4, mas em vez de criar família, **colar o código** e entrar.

Pronto: cada aparelho funciona offline e sincroniza automaticamente ao abrir, ao salvar e ao voltar a ficar online (botão ⇅ força a qualquer momento).

> Dica: em Supabase **Authentication → Providers → Email**, você pode desativar "Confirm email" para simplificar o primeiro acesso da família.

## Estrutura

```
index.html            — shell do app
css/styles.css        — tema "extrato bancário premium"
js/db.js              — dados locais + regras (ciclo de fatura, mês financeiro)
js/sync.js            — sincronização Supabase (REST, sem SDK)
js/app.js             — telas e interações
sw.js                 — service worker (offline)
manifest.webmanifest  — instalação como app
supabase/schema.sql   — banco + segurança (RLS por família)
```

## Modelo de dados

`transactions` (gastos) → `categories` (envelopes com orçamento) · `accounts` (contas/saldos) · `cards` (cartões; faturas são **derivadas** das compras pelo ciclo de fechamento) · `goals` + `goal_entries` (metas e aportes) · `family_settings` (membros, dia de início do mês). Todas as tabelas carregam `updated_at`/`deleted` para sincronização incremental com resolução *last-write-wins*.
