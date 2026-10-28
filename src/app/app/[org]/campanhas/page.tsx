import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Badge, ButtonLink, EmptyState, PageHeader, Panel, Table, Td, Th } from "@/components/ui";
import { CAMPAIGN_STATUS, OBJECTIVES, formatCents } from "@/lib/ads/constants";
import { can, getOrgContext } from "@/lib/auth/dal";
import { listCampaigns } from "@/lib/data/ads";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.campaigns };

export default async function CampaignsPage({ params, searchParams }: PageProps<"/app/[org]/campanhas">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.read")) return <PermissionDenied />;
  const archived = sp.arquivadas === "1";
  const campaigns = await listCampaigns(ctx.org.id, archived);
  const canWrite = can(ctx, "campaigns.write");

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Estado de cada campanha. O estado “Ativa” ou “Pausada” só aparece depois de confirmado pela Meta."
        actions={canWrite ? <ButtonLink href={`/app/${slug}/trafego-pago`}>Nova campanha</ButtonLink> : undefined}
      />
      <Panel>
        {campaigns.length === 0 ? (
          <EmptyState
            title={archived ? "Sem campanhas arquivadas" : "Ainda não há campanhas"}
            action={canWrite && !archived ? <ButtonLink href={`/app/${slug}/trafego-pago`}>Preparar a primeira campanha</ButtonLink> : undefined}
          >
            {archived ? null : "Prepare uma campanha em poucos passos: a IA propõe o plano e os textos, e nada é publicado sem a sua aprovação."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campanha</Th>
                <Th>Estado</Th>
                <Th>Orçamento</Th>
                <Th>Gasto (Meta)</Th>
                <Th>Período</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const st = CAMPAIGN_STATUS[c.status];
                return (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/app/${slug}/campanhas/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {c.service_label} · {OBJECTIVES[c.objective].label}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Td>
                    <Td className="tabular-nums">
                      {formatCents(c.daily_budget_cents)}/dia
                      <p className="text-xs text-muted">máx. {formatCents(c.total_budget_cents)}</p>
                    </Td>
                    <Td className="tabular-nums">{["draft", "approved"].includes(c.status) ? "—" : formatCents(c.spend_cents)}</Td>
                    <Td className="text-xs text-muted">
                      {formatDate(c.starts_on)}
                      {c.ends_on ? ` – ${formatDate(c.ends_on)}` : " · sem data de fim"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">
        <Link href={`/app/${slug}/campanhas${archived ? "" : "?arquivadas=1"}`} className="underline underline-offset-2">
          {archived ? "Ver campanhas em curso" : "Ver também as arquivadas"}
        </Link>
      </p>
    </>
  );
}
