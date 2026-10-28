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

const PLAN_LIMIT_MESSAGES: Record<string, string> = {
  members: "O plano atual não permite mais membros (incluindo convites pendentes). Mude de plano em Faturação.",
  ai_replies_month: "Atingiu o limite mensal de respostas da IA do plano.",
  ad_generations_month: "Atingiu o limite mensal de propostas de campanha geradas pela IA. Mude de plano em Faturação.",
  active_campaigns: "O plano atual não permite mais campanhas em curso. Pause ou termine uma, ou mude de plano em Faturação.",
  knowledge_docs: "O plano atual não permite mais documentos na base jurídica do escritório. Arquive documentos ou mude de plano.",
  default: "Atingiu um limite do plano atual. Veja os detalhes em Faturação.",
};

/**
 * Converte erros da base de dados (RPC) e do Supabase Auth em mensagens claras
 * para o utilizador, sem expor detalhes internos.
 */
export function toUserMessage(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  const message = e?.message ?? "";
  const code = e?.code ?? "";

  if (message.includes("rate_limited")) return t.errors.rate_limited;
  const limit = message.match(/plan_limit:([a-z_]+)/)?.[1];
  if (limit) return PLAN_LIMIT_MESSAGES[limit] ?? PLAN_LIMIT_MESSAGES.default;
  if (message.includes("subscription_inactive")) {
    return "A subscrição do escritório não está ativa. Os dados continuam disponíveis; regularize em Faturação para voltar a usar esta função.";
  }
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
