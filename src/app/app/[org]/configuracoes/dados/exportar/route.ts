import { NextResponse } from "next/server";
import { can, getOrgContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Exportação completa dos dados do escritório (RGPD: portabilidade e saída do
 * serviço). Só o administrador; lida com as permissões do próprio utilizador
 * (RLS); nunca inclui segredos (tokens da Meta, chaves). Fica auditada.
 */
const TABLES: [string, string][] = [
  ["organizations", "id, name, slug, legal_name, nif, email, phone, address, timezone, default_locale, retention_months, created_at"],
  ["memberships", "id, user_id, role, status, created_at"],
  ["contacts", "*"],
  ["contact_notes", "*"],
  ["conversations", "*"],
  ["messages", "*"],
  ["internal_notes", "*"],
  ["agent_runs", "*"],
  ["services", "*"],
  ["availability_rules", "*"],
  ["availability_blocks", "*"],
  ["appointments", "*"],
  ["knowledge_documents", "*"],
  ["campaigns", "*"],
  ["campaign_ads", "*"],
  ["campaign_approvals", "*"],
  ["campaign_events", "*"],
  ["campaign_metrics_daily", "*"],
  ["ad_budget_settings", "*"],
  ["subscriptions", "organization_id, plan_id, status, trial_ends_at, current_period_end, cancel_at_period_end, created_at"],
  ["invoices", "*"],
  ["audit_logs", "*"],
];
const PAGE = 1000;
const MAX_PER_TABLE = 100_000;

export async function GET(_req: Request, { params }: RouteContext<"/app/[org]/configuracoes/dados/exportar">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "org.delete")) return new NextResponse("Só o administrador do escritório pode exportar todos os dados.", { status: 403 });

  const supabase = await createClient();
  const out: Record<string, unknown[]> = {};
  const truncated: string[] = [];
  for (const [table, cols] of TABLES) {
    const key = table === "organizations" ? "id" : "organization_id";
    const rows: unknown[] = [];
    for (let from = 0; from < MAX_PER_TABLE; from += PAGE) {
      const { data, error } = await supabase.from(table).select(cols).eq(key, ctx.org.id).range(from, from + PAGE - 1);
      if (error) return new NextResponse(`Não foi possível exportar (${table}).`, { status: 500 });
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
      if (from + PAGE >= MAX_PER_TABLE) truncated.push(table);
    }
    out[table] = rows;
  }

  await supabase.rpc("log_audit_event", {
    p_org: ctx.org.id,
    p_action: "export.organization_data",
    p_entity_type: "organization",
    p_entity_id: ctx.org.id,
    p_metadata: { tables: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), truncated },
  });

  const body = JSON.stringify(
    { exported_at: new Date().toISOString(), organization: ctx.org.slug, format: "patrono-export-v1", truncated, data: out },
    null,
    2,
  );
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="patrono-${ctx.org.slug}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
