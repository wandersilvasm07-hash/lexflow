import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, PageHeader, Panel } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { listServices } from "@/lib/data/agenda";
import { getBudgetSettings, getCampaign } from "@/lib/data/ads";
import { CampaignBasicsForm } from "../../campaign-forms";

export const metadata: Metadata = { title: "Alterar campanha" };

export default async function EditCampaignPage({ params }: PageProps<"/app/[org]/campanhas/[campaign]/editar">) {
  const { org: slug, campaign: id } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.write")) return <PermissionDenied />;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [data, services, limits] = await Promise.all([getCampaign(ctx.org.id, id), listServices(ctx.org.id, true), getBudgetSettings(ctx.org.id)]);
  if (!data) notFound();
  const c = data.campaign;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.org.timezone }).format(new Date());
  const locked = !["draft", "approved", "failed", "rejected"].includes(c.status);

  return (
    <>
      <Link href={`/app/${slug}/campanhas/${id}`} className="text-xs text-muted hover:underline">
        ← {c.name}
      </Link>
      <PageHeader title="Alterar campanha" description="Serviço, objetivo, público, orçamento e destino." />
      {locked ? (
        <Alert tone="warn">A campanha já foi publicada e não pode ser alterada. Pause-a ou crie uma nova.</Alert>
      ) : (
        <Panel className="p-5">
          {c.status !== "draft" ? <Alert tone="warn" className="mb-5">Ao guardar, a aprovação atual é anulada e a campanha volta a rascunho.</Alert> : null}
          <CampaignBasicsForm
            org={slug}
            services={services.map((s) => ({ id: s.id, name: s.name }))}
            limits={limits}
            minDate={today < c.starts_on ? today : c.starts_on}
            defaults={c}
          />
        </Panel>
      )}
    </>
  );
}
