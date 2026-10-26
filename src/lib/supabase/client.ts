"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente para componentes no browser (ex.: inscrição MFA). Usa apenas a chave
 * pública; o acesso a dados continua limitado pelo RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  );
}
