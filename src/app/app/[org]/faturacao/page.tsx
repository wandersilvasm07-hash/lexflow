import { Check } from "lucide-react";
import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, EmptyState, PageHeader, Panel, PanelHeader, Table, Td, Th, cn } from "@/components/ui";
import { formatCents } from "@/lib/ads/constants";
import { can, getOrgContext } from "@/lib/auth/dal";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { LIMIT_LABELS, getBillingOverview, getStripeCustomerId, listInvoices, listPlans, type PlanLimits } from "@/lib/data/billing";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import { CheckoutButton, PortalButton } from "./billing-forms";

export const metadata: Metadata = { title: t.nav.billing };

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "seal" | "info" | "neutral" }> = {
  trialing: { label: "Período de teste", tone: "info" },
  active: { label: "Ativa", tone: "ok" },
  past_due: { label: "Pagamento em atraso", tone: "warn" },
  unpaid: { label: "Por pagar", tone: "seal" },
  incomplete: { label: "Incompleta", tone: "warn" },
  canceled: { label: "Cancelada", tone: "neutral" },
};

const INVOICE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "seal" | "neutral" }> = {
  paid: { label: "Paga", tone: "ok" },
  open: { label: "Por pagar", tone: "warn" },
  uncollectible: { label: "Incobrável", tone: "seal" },
  void: { label: "Anulada", tone: "neutral" },
  draft: { label: "Rascunho", tone: "neutral" },
};

function Meter({ label, used, limit }: { label: string; used: number; limit: number | undefined }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold text-ink">{used.toLocaleString("pt-PT")}</span>
          <span className="text-muted"> / {limit === undefined ? "sem limite" : limit.toLocaleString("pt-PT")}</span>
        </span>
      </div>
      {limit !== undefined ? (
        <div className="mt-1.5 h-1.5 rounded-full bg-ink-faint" role="meter" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={label}>
          <div className={cn("h-1.5 rounded-full", pct >= 100 ? "bg-seal" : pct >= 80 ? "bg-warn" : "bg-ink")} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default async function BillingPage({ params, searchParams }: PageProps<"/app/[org]/faturacao">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "billing.manage")) return <PermissionDenied />;
  const [o, plans, invoices, ids] = await Promise.all([
    getBillingOverview(ctx.org.id),
    listPlans(),
    listInvoices(ctx.org.id),
    getStripeCustomerId(ctx.org.id),
  ]);
  const configured = isStripeConfigured();
  const st = STATUS[o.status] ?? STATUS.canceled;
  const limits = o.limits as PlanLimits;
  const paid = Boolean(ids.subscription);

  return (
    <>
      <PageHeader title="Faturação" description="Plano, consumo e pagamentos do escritório. Os pagamentos são processados pelo Stripe; o Patrono não guarda dados de cartão." />

      {sp.checkout === "ok" ? (
        <Alert tone="ok" className="mb-5">
          Pagamento concluído. A subscrição fica ativa assim que o Stripe a confirmar (normalmente em segundos).
        </Alert>
      ) : null}
      {!o.active ? (
        <Alert tone="seal" className="mb-5" title={o.reason === "trial_expired" ? "O período de teste terminou" : o.reason === "payment_overdue" ? "Pagamento em atraso" : "Subscrição inativa"}>
          O assistente de IA e a publicação de campanhas estão em pausa. Todos os dados continuam disponíveis e exportáveis. Escolha um plano para retomar.
        </Alert>
      ) : o.status === "past_due" ? (
        <Alert tone="warn" className="mb-5" title="Pagamento em atraso">
          Tem 7 dias para regularizar antes de o assistente e as campanhas entrarem em pausa.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel>
          <PanelHeader
            title={`Plano ${o.plan_name}`}
            description={
              o.status === "trialing" && o.trial_ends_at
                ? `Teste gratuito até ${formatDate(o.trial_ends_at)}.`
                : o.current_period_end
                  ? `${o.cancel_at_period_end ? "Termina" : "Renova"} a ${formatDate(o.current_period_end)}.`
                  : undefined
            }
            actions={<Badge tone={st.tone}>{st.label}</Badge>}
          />
          <div className="space-y-4 p-5">
            <Meter label={LIMIT_LABELS.members} used={o.usage.members + o.usage.pending_invitations} limit={limits.members} />
            <Meter label={LIMIT_LABELS.ai_replies_month} used={o.usage.ai_replies_month} limit={limits.ai_replies_month} />
            <Meter label={LIMIT_LABELS.ad_generations_month} used={o.usage.ad_generations_month} limit={limits.ad_generations_month} />
            <Meter label={LIMIT_LABELS.active_campaigns} used={o.usage.active_campaigns} limit={limits.active_campaigns} />
            <Meter label={LIMIT_LABELS.knowledge_docs} used={o.usage.knowledge_docs} limit={limits.knowledge_docs} />
            <p className="pt-1 text-xs text-muted">
              Contagem mensal desde {formatDate(o.usage.month_start)}. Os membros incluem convites pendentes. Tokens de IA este mês:{" "}
              {o.usage.ai_tokens_month.toLocaleString("pt-PT")}.
            </p>
          </div>
        </Panel>

        <Panel className="self-start p-5 text-sm">
          <p className="font-semibold text-ink">Gestão da subscrição</p>
          <p className="mt-1 text-muted">Mudar de plano, cancelar, atualizar o método de pagamento e descarregar recibos, no portal seguro do Stripe.</p>
          <div className="mt-4">
            {!configured ? (
              <Alert tone="neutral">Os pagamentos ainda não estão configurados nesta instalação.</Alert>
            ) : paid ? (
              <PortalButton org={slug} />
            ) : (
              <p className="text-muted">Escolha um plano abaixo para subscrever.</p>
            )}
          </div>
        </Panel>
      </div>

      <h2 className="mt-10 mb-4 text-lg font-semibold text-ink">Planos</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const current = p.id === o.plan;
          return (
            <Panel key={p.id} className={cn("flex flex-col p-5", current && "border-ink ring-1 ring-ink")}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-base font-semibold text-ink">{p.name}</p>
                {current ? <Badge tone="ink">Atual</Badge> : null}
              </div>
              {p.description ? <p className="mt-1 text-sm text-muted">{p.description}</p> : null}
              <p className="mt-4">
                {p.price_cents !== null ? (
                  <>
                    <span className="font-display text-[1.75rem] leading-none font-semibold text-ink tabular-nums">{formatCents(p.price_cents, p.currency)}</span>
                    <span className="text-sm text-muted"> /{p.billing_interval === "year" ? "ano" : "mês"} + IVA</span>
                  </>
                ) : (
                  <span className="text-sm text-muted">Preço sob consulta</span>
                )}
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-gold-deep" aria-hidden="true" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {paid ? (
                  current ? null : <p className="text-xs text-muted">Para mudar para este plano, use “Gerir subscrição”.</p>
                ) : configured && p.stripe_price_id ? (
                  <CheckoutButton org={slug} plan={p.id} variant={current ? "primary" : "secondary"}>
                    {current && o.status === "trialing" ? "Subscrever este plano" : `Escolher ${p.name}`}
                  </CheckoutButton>
                ) : (
                  <p className="text-xs text-muted">Subscrição disponível em breve.</p>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-10">
        <PanelHeader title="Histórico de faturação" description="Recibos emitidos pelo Stripe." />
        {invoices.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Período</Th>
                <Th>Valor</Th>
                <Th>Estado</Th>
                <Th>
                  <span className="sr-only">Ligações</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const s = INVOICE_STATUS[i.status] ?? { label: i.status, tone: "neutral" as const };
                return (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.number ?? "—"}</Td>
                    <Td className="text-muted">{i.period_start ? `${formatDate(i.period_start)} – ${formatDate(i.period_end ?? i.period_start)}` : formatDate(i.issued_at)}</Td>
                    <Td className="tabular-nums">{formatCents(i.amount_due_cents, i.currency)}</Td>
                    <Td><Badge tone={s.tone}>{s.label}</Badge></Td>
                    <Td className="text-right text-sm">
                      {i.invoice_pdf ? <a href={i.invoice_pdf} className="font-medium text-ink underline-offset-2 hover:underline">PDF</a> : null}
                      {i.hosted_invoice_url ? <a href={i.hosted_invoice_url} className="ml-3 font-medium text-ink underline-offset-2 hover:underline">Ver</a> : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Sem pagamentos registados">Os recibos aparecem aqui depois do primeiro pagamento.</EmptyState>
        )}
      </Panel>
    </>
  );
}
