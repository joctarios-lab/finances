/* Pré-configuração opcional do Supabase.
   Preencha para o app já vir apontado para o projeto da família (ninguém precisa colar nada).
   A anon key e a chave VAPID pública são públicas por design — a segurança vem do login + RLS.
   NUNCA coloque aqui a service_role key nem a VAPID privada (essas ficam só no servidor). */
'use strict';

window.FINANCAS_SUPABASE = {
  url: '',              // ex: 'https://abcdefgh.supabase.co'
  anonKey: '',          // ex: 'eyJhbGciOi…'
  vapidPublicKey: '',   // gerada com: npx web-push generate-vapid-keys  (chave PÚBLICA)
};
