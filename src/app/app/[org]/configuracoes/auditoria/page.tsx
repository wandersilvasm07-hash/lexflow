import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { ButtonLink, EmptyState, Panel, PanelHeader, Table, Td, Th } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { isOrgRole } from "@/lib/authz/permissions";
import { listMembers } from "@/lib/data/team";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Registo de atividade" };

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  "organization.created": "Criou o escritório",
  "organization.profile_updated": "Alterou o perfil do escritório",
  "invitation.created": "Criou um convite",
  "invitation.revoked": "Cancelou um convite",
  "invitation.accepted": "Aceitou um convite e entrou na equipa",
  "membership.role_changed": "Alterou o papel de um membro",
  "membership.status_changed": "Alterou o acesso de um membro",
  "membership.removed": "Removeu um membro",
  "membership.left": "Saiu do escritório",
  "security.mfa_policy_changed": "Alterou a política de verificação em dois passos",
};

type AuditRow = {
  id: number;
  actor_user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

function describe(row: AuditRow): string {
  const m = row.metadata ?? {};
  const role = (v: unknown) => (isOrgRole(v) ? t.roles[v] : String(v));
  switch (row.action) {
    case "invitation.created":
    case "invitation.accepted":
      return `Papel: ${role(m.role)}`;
    case "membership.role_changed":
      return `${role(m.from)} → ${role(m.to)}`;
    case "membership.status_changed":
      return m.status === "suspended" ? "Acesso suspenso" : "Acesso reativado";
    case "security.mfa_policy_changed":
      return m.require_mfa ? "Passou a ser obrigatória" : "Deixou de ser obrigatória";
    default:
      return "";
  }
}

export default async function AuditPage({ params, searchParams }: PageProps<"/app/[org]/configuracoes/auditoria">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "audit.read")) return <PermissionDenied />;

  const before = Number(sp.antes);
  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, actor_user_id, action, metadata, created_at")
    .eq("organization_id", ctx.org.id)
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (Number.isFinite(before) && before > 0) query = query.lt("id", before);

  const [{ data, error }, members] = await Promise.all([query.returns<AuditRow[]>(), listMembers(ctx.org.id)]);
  if (error) throw error;

  const rows = (data ?? []).slice(0, PAGE_SIZE);
  const hasMore = (data?.length ?? 0) > PAGE_SIZE;
  const names = new Map(members.map((m) => [m.user_id, m.full_name ?? m.email] as const));

  return (
    <Panel>
      <PanelHeader
        title="Registo de atividade"
        description="Ações importantes no escritório. O registo não pode ser alterado nem apagado."
      />
      {rows.length === 0 ? (
        <EmptyState title="Sem atividade registada" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Quem</Th>
              <Th>Ação</Th>
              <Th>Detalhe</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</Td>
                <Td>{r.actor_user_id ? (names.get(r.actor_user_id) ?? "Ex-membro") : "Sistema"}</Td>
                <Td>{ACTION_LABELS[r.action] ?? r.action}</Td>
                <Td className="text-muted">{describe(r)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {hasMore ? (
        <div className="flex justify-end p-4">
          <ButtonLink
            variant="secondary"
            size="sm"
            href={`/app/${slug}/configuracoes/auditoria?antes=${rows[rows.length - 1].id}`}
          >
            Ver mais antigos
          </ButtonLink>
        </div>
      ) : null}
    </Panel>
  );
}
