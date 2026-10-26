import { t } from "@/i18n";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const KNOWN_DB_ERRORS = [
  "not_authenticated",
  "forbidden",
  "not_found",
  "slug_taken",
  "organization_limit_reached",
  "invalid_email",
  "already_member",
  "invitation_invalid",
  "invitation_expired",
  "invitation_email_mismatch",
  "last_admin",
  "consent_required",
] as const;

/**
 * Converte erros da base de dados (RPC) e do Supabase Auth em mensagens claras
 * para o utilizador, sem expor detalhes internos.
 */
export function toUserMessage(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  const message = e?.message ?? "";
  const code = e?.code ?? "";

  if (message.includes("rate_limited")) return t.errors.rate_limited;
  for (const key of KNOWN_DB_ERRORS) {
    if (message.includes(key)) return t.errors[key];
  }

  // Códigos do Supabase Auth
  const authMap: Record<string, string> = {
    invalid_credentials: t.errors.invalid_credentials,
    email_not_confirmed: t.errors.email_not_confirmed,
    weak_password: t.errors.weak_password,
    user_already_exists: t.errors.user_already_exists,
    email_exists: t.errors.user_already_exists,
    over_request_rate_limit: t.errors.rate_limited,
    over_email_send_rate_limit: t.errors.rate_limited,
    mfa_verification_failed: t.errors.mfa_invalid_code,
  };
  if (authMap[code]) return authMap[code];
  if (code === "42501") return t.errors.forbidden;

  return t.errors.generic;
}

export function fail(error: unknown): ActionResult<never> {
  // Regista o erro técnico no servidor (sem dados pessoais do pedido).
  console.error("[action-error]", (error as { code?: string })?.code, (error as Error)?.message);
  return { ok: false, error: toUserMessage(error) };
}
