import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Panel, PanelHeader } from "@/components/ui";
import { formatCents } from "@/lib/ads/constants";
import { can, getOrgContext } from "@/lib/auth/dal";
import { getBudgetSettings } from "@/lib/data/ads";
import { formatDateTime } from "@/lib/format";
import { BudgetLimitsForm } from "../../campanhas/campaign-forms";

export const metadata: Metadata = { title: "Limites de orçamento" };

export default async function BudgetLimitsPage({ params }: PageProps<"/app/[org]/trafego-pago/limites">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "campaigns.read")) return <PermissionDenied />;
  const current = await getBudgetSettings(ctx.org.id);
  const canEdit = can(ctx, "settings.manage");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel>
        <PanelHeader
          title="Limites de orçamento do escritório"
          description="Verificados na base de dados quando se cria, altera, aprova e publica uma campanha. A IA nunca os altera."
        />
        <div className="p-5">
          {canEdit ? (
            <BudgetLimitsForm org={slug} current={current} />
          ) : current ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Diário por campanha</dt><dd className="font-medium">{formatCents(current.max_daily_cents)}</dd></div>
              <div><dt className="text-muted">Total por campanha</dt><dd className="font-medium">{formatCents(current.max_campaign_total_cents)}</dd></div>
              <div><dt className="text-muted">Diário, todas as campanhas</dt><dd className="font-medium">{formatCents(current.max_all_daily_cents)}</dd></div>
              <div><dt className="text-muted">Alerta de consumo</dt><dd className="font-medium">{current.alert_pct}%</dd></div>
            </dl>
          ) : (
            <Alert tone="warn">Ainda não há limites. Só o administrador do escritório os pode definir.</Alert>
          )}
          {current ? <p className="mt-4 text-xs text-muted">Última alteração: {formatDateTime(current.updated_at)} (fica no registo de atividade).</p> : null}
        </div>
      </Panel>
      <Panel className="self-start p-5 text-sm">
        <p className="font-semibold">Como funcionam</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted">
          <li>Nenhuma campanha é criada ou aprovada acima destes valores.</li>
          <li>A soma dos orçamentos diários das campanhas aprovadas ou ativas não passa do máximo conjunto.</li>
          <li>Se baixar os limites, campanhas já aprovadas acima deles deixam de poder ser publicadas.</li>
          <li>Quando o gasto real (dado pela Meta) chega à percentagem de alerta, fica registado um aviso na campanha; ao atingir o total, a campanha é pausada.</li>
        </ul>
      </Panel>
    </div>
  );
}
