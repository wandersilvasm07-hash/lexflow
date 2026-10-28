import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Panel } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { listServices } from "@/lib/data/agenda";
import { getAdAccount, getBudgetSettings } from "@/lib/data/ads";
import { t } from "@/i18n";
import { CampaignBasicsForm } from "../campanhas/campaign-forms";

export const metadata: Metadata = { title: t.nav.ads };

const FLOW = [
  "Serviço",
  "Objetivo",
  "Localização e idiomas",
  "Orçamento",
  "Destino",
  "Plano com IA",
  "Textos e imagens",
  "Conformidade",
  "Pré-visualização",
  "Aprovação",
  "Publicação",
  "Resultados",
  "Melhorias",
];

export default async function NewCampaignPage({ params }: PageProps<"/app/[org]/trafego-pago">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.write")) return <PermissionDenied />;
  const [services, limits, account] = await Promise.all([
    listServices(ctx.org.id, true),
    getBudgetSettings(ctx.org.id),
    getAdAccount(ctx.org.id),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.org.timezone }).format(new Date());

  return (
    <div className="space-y-6">
      <ol aria-label="Etapas" className="flex flex-wrap gap-x-1 gap-y-2 text-xs">
        {FLOW.map((s, i) => (
          <li key={s} className={i < 5 ? "rounded border border-ink bg-ink-faint px-2 py-1 text-ink" : "rounded border border-line px-2 py-1 text-muted"}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {!limits ? (
        <Alert tone="warn" title="Defina primeiro os limites de orçamento">
          Pode preparar a campanha, mas nenhuma é aprovada sem limites definidos pelo escritório.{" "}
          <Link href={`/app/${slug}/trafego-pago/limites`} className="font-medium underline underline-offset-2">
            Definir limites
          </Link>
        </Alert>
      ) : null}
      {!account ? (
        <Alert tone="neutral">
          A conta de anúncios da Meta ainda não está ligada. Pode preparar, rever e aprovar campanhas; a publicação fica disponível depois de{" "}
          <Link href={`/app/${slug}/trafego-pago/conta`} className="font-medium underline underline-offset-2">
            ligar a conta
          </Link>
          .
        </Alert>
      ) : null}

      <Panel className="p-5">
        <CampaignBasicsForm
          org={slug}
          services={services.map((s) => ({ id: s.id, name: s.name }))}
          limits={limits}
          minDate={today}
        />
      </Panel>
    </div>
  );
}
