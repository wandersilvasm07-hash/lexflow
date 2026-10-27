import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Usa a sessão do utilizador (cookies), por isso TODAS as consultas passam
 * pelo Row Level Security: nunca usa a chave secreta.
 */
export async function createClient() {
  // Ler os cookies primeiro marca o pedido como dinâmico (nunca pré-renderizado).
  const cookieStore = await cookies();
  // A biblioteca de autenticação lê o relógio (Date.now) ao carregar a sessão;
  // `connection()` garante que isso só acontece em tempo de pedido.
  await connection();
  const env = getPublicEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado a partir de um Server Component (sem permissão para escrever
          // cookies). O proxy renova a sessão em cada pedido, por isso é seguro.
        }
      },
    },
  });
}
