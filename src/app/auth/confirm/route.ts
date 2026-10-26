import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation";

/**
 * Destino dos links enviados por email (confirmação de conta, recuperação de
 * palavra-passe). Suporta os dois formatos do Supabase:
 *  - token_hash + type (recomendado; ver README para o modelo de email)
 *  - code (fluxo PKCE por defeito)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = ok
    ? new URL(next, request.nextUrl.origin)
    : new URL("/entrar?erro=link-invalido", request.nextUrl.origin);
  return NextResponse.redirect(target);
}
