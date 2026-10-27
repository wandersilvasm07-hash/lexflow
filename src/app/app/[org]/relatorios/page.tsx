import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, PageHeader, Panel, PanelHeader, cn } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { CONTACT_SOURCE, CONTACT_STATUS, type ContactSource, type ContactStatus } from "@/lib/crm";
import { PERIODS, getReport, periodRange, type PeriodKey } from "@/lib/data/reports";
import { formatDateTime } from "@/lib/format";
import { t } from "@/i18n";

export const metadata: Metadata = { title: t.nav.reports };

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

export default async function ReportsPage({ params, searchParams }: PageProps<"/app/[org]/relatorios">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "reports.read")) return <PermissionDenied />;

  const period = (typeof sp.periodo === "string" && sp.periodo in PERIODS ? sp.periodo : "30") as PeriodKey;
  const range = periodRange(period, ctx.org.timezone);
  const r = await getReport(ctx.org.id, range.from, range.to);
  const base = `/app/${slug}/relatorios`;

  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Resultados do atendimento e das consultas. Só números agregados: nenhum dado individual de contactos."
      />
      <nav aria-label="Período" className="mb-6 flex flex-wrap gap-1">
        {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
          <Link
            key={k}
            href={`${base}?periodo=${k}`}
            aria-current={k === period ? "true" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              k === period ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-muted hover:text-ink",
            )}
          >
            {PERIODS[k]}
          </Link>
        ))}
      </nav>

      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Atendimento" description="Conversas iniciadas no período." />
          <Stats
            items={[
              { label: "Novas conversas", value: r.conversations_new },
              { label: "Atendidas pelo assistente", value: r.conversations_ai_attended },
              {
                label: "Encaminhadas para a equipa",
                value: r.conversations_handed_off,
                note: `${pct(r.conversations_handed_off, r.conversations_ai_attended)} das atendidas pelo assistente`,
              },
              { label: "Urgentes", value: r.conversations_urgent },
              { label: "Pendentes agora", value: r.conversations_pending_now, note: "Com mensagens por ler, neste momento" },
            ]}
          />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Novos contactos" description={`${r.contacts_new} no período, por origem.`} />
            <Breakdown
              rows={Object.entries(r.contacts_by_source).map(([k, v]) => [CONTACT_SOURCE[k as ContactSource] ?? k, v])}
              total={r.contacts_new}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Onde estão hoje" description="Estado atual dos contactos que entraram no período." />
            <Breakdown
              rows={Object.entries(r.contacts_by_status).map(([k, v]) => [CONTACT_STATUS[k as ContactStatus] ?? k, v])}
              total={r.contacts_new}
            />
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Consultas" />
          <Stats
            items={[
              { label: "Marcadas no período", value: r.appointments_booked },
              {
                label: "Marcadas pelo assistente",
                value: r.appointments_booked_by_ai,
                note: pct(r.appointments_booked_by_ai, r.appointments_booked) + " das marcações",
              },
              { label: "Realizadas", value: r.appointments_held, note: "Com data no período" },
              { label: "Faltas", value: r.appointments_no_show },
              { label: "Canceladas", value: r.appointments_cancelled },
            ]}
          />
          {Object.keys(r.appointments_by_service).length ? (
            <div className="border-t border-line">
              <p className="px-5 pt-4 text-sm font-medium">Marcações por serviço</p>
              <Breakdown rows={Object.entries(r.appointments_by_service)} total={r.appointments_booked} />
            </div>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader title="Publicidade" />
          <p className="px-5 py-4 text-sm text-muted">
            Investimento, custo por contacto e custo por consulta aparecem quando as campanhas da Meta estiverem ligadas
            (fase 5). Nessa altura, os números fornecidos pela Meta e os calculados aqui serão mostrados em separado.
          </p>
        </Panel>

        <Alert tone="neutral">
          Números calculados internamente a partir dos registos do escritório, no fuso {ctx.org.timezone}. Gerado em{" "}
          {formatDateTime(r.generated_at)}.
        </Alert>
      </div>
    </>
  );
}

function Stats({ items }: { items: { label: string; value: number; note?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="bg-surface px-5 py-4">
          <dt className="text-sm text-muted">{it.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{it.value.toLocaleString("pt-PT")}</dd>
          {it.note ? <dd className="mt-0.5 text-xs text-muted">{it.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function Breakdown({ rows, total }: { rows: [string, number][]; total: number }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-muted">Sem dados no período.</p>;
  const sorted = [...rows].sort((a, b) => b[1] - a[1]);
  const max = Math.max(...sorted.map(([, v]) => v), 1);
  return (
    <ul className="space-y-2.5 p-5">
      {sorted.map(([label, v]) => (
        <li key={label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span>{label}</span>
            <span className="tabular-nums text-muted">
              {v} <span className="text-xs">({pct(v, total)})</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-paper">
            <div className="h-1.5 rounded-full bg-ink" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
