import { NextResponse } from "next/server";
import { connection } from "next/server";
import { getPublicEnv } from "@/lib/env";

/**
 * Verificação de saúde para monitorização externa: confirma que a aplicação
 * responde e que a base de dados está acessível. Não expõe dados nem segredos.
 */
export async function GET() {
  await connection();
  const started = Date.now();
  let database: "ok" | "error" = "error";
  try {
    const env = getPublicEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    database = res.ok ? "ok" : "error";
  } catch {
    database = "error";
  }
  const ok = database === "ok";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks: { database },
      configured: {
        ai: Boolean(process.env.ANTHROPIC_API_KEY),
        service_key: Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
        payments: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
        meta_ads: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.ADS_TOKEN_KEY),
        cron: Boolean(process.env.CRON_SECRET),
      },
      ms: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
