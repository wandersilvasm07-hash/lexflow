import { z } from "zod";

/**
 * Configuração pública (pode chegar ao browser). Segredos NUNCA entram aqui:
 * só variáveis com prefixo NEXT_PUBLIC_ são expostas pelo Next.js.
 *
 * As variáveis são lidas de forma preguiçosa para que o build e as páginas
 * públicas funcionem sem Supabase configurado; as áreas que precisam de
 * autenticação mostram um aviso explícito em vez de falharem em silêncio.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof publicSchema>;

export class ConfigError extends Error {}

function readPublicEnv() {
  return publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Aceita o nome antigo (anon key) para compatibilidade com projetos existentes.
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function isSupabaseConfigured(): boolean {
  return readPublicEnv().success;
}

export function getPublicEnv(): PublicEnv {
  const parsed = readPublicEnv();
  if (!parsed.success) {
    throw new ConfigError(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ver README).",
    );
  }
  return parsed.data;
}

/** URL pública da aplicação, usada em links de email (convites, recuperação). */
export function getAppUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url =
    process.env.NEXT_PUBLIC_APP_URL ?? (vercel ? `https://${vercel}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}
