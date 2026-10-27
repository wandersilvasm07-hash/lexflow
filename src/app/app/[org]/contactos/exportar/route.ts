import { NextResponse, type NextRequest } from "next/server";
import { can, getOrgContext } from "@/lib/auth/dal";
import { CONTACT_SOURCE, CONTACT_STATUS, toCsv, type ContactSource, type ContactStatus } from "@/lib/crm";
import { createClient } from "@/lib/supabase/server";

/**
 * Exportação controlada de contactos (secção 12): exige permissão própria,
 * exporta só os campos necessários (sem notas nem conversas) e fica no
 * registo de atividade com os filtros e o número de linhas.
 */
const MAX_ROWS = 5000;

export async function GET(request: NextRequest, { params }: RouteContext<"/app/[org]/contactos/exportar">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "contacts.export")) {
    return new NextResponse("Sem permissão para exportar contactos.", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get("estado") ?? "";
  const search = (sp.get("q") ?? "").trim().slice(0, 80);

  const supabase = await createClient();
  let q = supabase
    .from("contacts")
    .select("full_name, phone_e164, email, locale, source, status, service_interest, next_action, next_action_at, tags, created_at")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (status in CONTACT_STATUS) q = q.eq("status", status);
  if (search) {
    const safe = search.replace(/[,()%*\\]/g, " ");
    q = q.or(`full_name.ilike.%${safe}%,phone_e164.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) return new NextResponse("Não foi possível exportar.", { status: 500 });

  const rows = data ?? [];
  await supabase.rpc("log_audit_event", {
    p_org: ctx.org.id,
    p_action: "export.contacts",
    p_entity_type: "contacts",
    p_metadata: { rows: rows.length, filters: { status: status || null, search: search ? "sim" : null } },
  });

  const csv = toCsv([
    ["Nome", "Telefone", "Email", "Idioma", "Origem", "Estado", "Serviço pretendido", "Próxima ação", "Até", "Etiquetas", "Entrada"],
    ...rows.map((c) => [
      c.full_name,
      c.phone_e164,
      c.email,
      c.locale,
      CONTACT_SOURCE[c.source as ContactSource] ?? c.source,
      CONTACT_STATUS[c.status as ContactStatus] ?? c.status,
      c.service_interest,
      c.next_action,
      c.next_action_at ? new Date(c.next_action_at).toLocaleString("pt-PT", { timeZone: ctx.org.timezone }) : "",
      (c.tags ?? []).join(", "),
      new Date(c.created_at).toLocaleDateString("pt-PT", { timeZone: ctx.org.timezone }),
    ]),
  ]);

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contactos-${ctx.org.slug}-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
