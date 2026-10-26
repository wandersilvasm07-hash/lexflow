import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente com a chave SECRETA do Supabase (ignora o RLS).
 * Usado APENAS em processos de servidor sem utilizador: webhook do WhatsApp e
 * execução do agente de IA. Nunca importar em código que corra no browser.
 * Devolve null quando a chave não está configurada, para o chamador decidir.
 */
let cached: SupabaseClient | null | undefined;

export function getAdminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    cached = null;
    return cached;
  }
  cached = createClient(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
