
-- ===========================================================================
-- O ASSISTENTE — duas tabelas de escopo pessoal
--
-- Estas são as ÚNICAS tabelas do app que não pertencem à família. Todas as
-- outras filtram por family_id e são compartilhadas de propósito: o dinheiro é
-- da casa. Estas duas filtram por auth.uid(), porque:
--
--   • a chave da API é de quem a comprou, e é ela que paga a conta;
--   • a conversa é de quem conversou.
--
-- Nem pelo app um membro da casa alcança a linha do outro.
--
-- E o conteúdo NÃO É LEGÍVEL AQUI. A coluna `dados` guarda um JSON cifrado no
-- navegador (AES-256-GCM) com uma chave derivada da senha do login, que nunca
-- é enviada. O SQL Editor, um dump de backup e uma service_role vazada mostram
-- todos a mesma coisa: base64 sem sentido. Foi a troca escolhida — para que a
-- chave e o histórico sobrevivam a "apagar os dados deste aparelho" sem que o
-- servidor consiga lê-los. O preço é que trocar a senha do login torna o que
-- está aqui indecifrável; é recolar a chave e recomeçar as conversas.
--
-- Idempotente: pode rodar em projeto que já existe.
-- ===========================================================================

create table if not exists ia_config (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  dados       text not null,              -- JSON cifrado no cliente
  updated_at  timestamptz not null default now()
);

create table if not exists ia_chats (
  id          text primary key,           -- o mesmo id que a conversa tem no app
  user_id     uuid not null references auth.users(id) on delete cascade,
  dados       text not null,              -- JSON cifrado no cliente
  tocada      bigint not null default 0,  -- ordena a lista sem precisar decifrar
  updated_at  timestamptz not null default now()
);

-- A lista abre ordenada pela conversa mais recente; sem o índice, cada abertura
-- varreria tudo.
create index if not exists ia_chats_user_tocada_idx on ia_chats (user_id, tocada desc);

alter table ia_config enable row level security;
alter table ia_chats  enable row level security;

-- `using` filtra o que sai, `with check` filtra o que entra. Os dois são
-- necessários: sem o check, dava para gravar uma linha no nome de outro usuário.
drop policy if exists ia_config_rw on ia_config;
create policy ia_config_rw on ia_config for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ia_chats_rw on ia_chats;
create policy ia_chats_rw on ia_chats for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
