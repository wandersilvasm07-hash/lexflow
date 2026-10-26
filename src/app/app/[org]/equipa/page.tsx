import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, Table, Td, Th } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { isOrgRole, ROLE_PERMISSIONS } from "@/lib/authz/permissions";
import { createClient } from "@/lib/supabase/server";
import { listMembers } from "@/lib/data/team";
import { formatDate, isPast } from "@/lib/format";
import { t } from "@/i18n";
import { InviteForm, MemberActions, RevokeInvitation, RoleSelect } from "./team-forms";

export const metadata: Metadata = { title: "Equipa" };

export default async function TeamPage({ params }: PageProps<"/app/[org]/equipa">) {
  const ctx = await getOrgContext((await params).org);
  if (!can(ctx, "team.read")) return <PermissionDenied />;
  const manage = can(ctx, "team.manage");
  const supabase = await createClient();

  const [members, invitesRes] = await Promise.all([
    listMembers(ctx.org.id),
    manage
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at, created_at")
          .eq("organization_id", ctx.org.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
  ]);
  const invites = invitesRes.data ?? [];
  const slug = ctx.org.slug;

  return (
    <>
      <PageHeader
        title="Equipa"
        description="Quem tem acesso ao escritório e o que cada pessoa pode fazer."
      />

      <div className="space-y-6">
        {manage ? (
          <Panel>
            <PanelHeader title="Convidar membro" description="A pessoa cria conta (ou entra) com o email convidado." />
            <div className="p-5">
              <InviteForm org={slug} />
            </div>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader title="Membros" description={`${members.length} com acesso`} />
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Papel</Th>
                <Th>Estado</Th>
                <Th>Desde</Th>
                {manage ? <Th className="text-right">Ações</Th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.user_id === ctx.user.id;
                const role = isOrgRole(m.role) ? m.role : "viewer";
                return (
                  <tr key={m.membership_id}>
                    <Td>
                      <p className="font-medium">
                        {m.full_name ?? m.email}
                        {isSelf ? <span className="ml-1.5 text-xs font-normal text-muted">(você)</span> : null}
                      </p>
                      {m.full_name ? <p className="text-xs text-muted">{m.email}</p> : null}
                    </Td>
                    <Td>
                      {manage ? (
                        <RoleSelect org={slug} membershipId={m.membership_id} role={role} />
                      ) : (
                        t.roles[role]
                      )}
                    </Td>
                    <Td>
                      <Badge tone={m.status === "active" ? "ok" : "warn"}>{t.memberStatus[m.status]}</Badge>
                    </Td>
                    <Td className="text-muted">{formatDate(m.joined_at)}</Td>
                    {manage ? (
                      <Td className="text-right">
                        <MemberActions org={slug} membershipId={m.membership_id} status={m.status} isSelf={isSelf} />
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Panel>

        {manage ? (
          <Panel>
            <PanelHeader title="Convites pendentes" />
            {invites.length === 0 ? (
              <EmptyState title="Sem convites pendentes">
                Os convites aceites passam para a lista de membros.
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Papel</Th>
                    <Th>Validade</Th>
                    <Th className="text-right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const expired = isPast(inv.expires_at);
                    return (
                      <tr key={inv.id}>
                        <Td>{inv.email}</Td>
                        <Td>{isOrgRole(inv.role) ? t.roles[inv.role] : inv.role}</Td>
                        <Td>
                          {expired ? (
                            <Badge tone="warn">Expirado</Badge>
                          ) : (
                            <span className="text-muted">até {formatDate(inv.expires_at)}</span>
                          )}
                        </Td>
                        <Td className="text-right">
                          <RevokeInvitation org={slug} id={inv.id} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Papéis e permissões"
            description="Aplicadas no servidor e na base de dados, não apenas escondidas na interface."
          />
          <ul className="divide-y divide-line">
            {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((r) => (
              <li key={r} className="px-5 py-3">
                <p className="text-sm font-medium">{t.roles[r]}</p>
                <p className="text-sm text-muted">{t.roleDescriptions[r]}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
