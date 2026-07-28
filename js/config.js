/* Pré-configuração opcional do Supabase.
   Preencha url e anonKey para o app já vir configurado (a família só cria a conta e entra).
   A anon key é pública por design (a segurança real vem do login + RLS).
   NUNCA coloque aqui a service_role key. */
'use strict';

window.FINANCAS_SUPABASE = {
  url: '',      // ex: 'https://abcdefgh.supabase.co'
  anonKey: '',  // ex: 'eyJhbGciOi…'
};
