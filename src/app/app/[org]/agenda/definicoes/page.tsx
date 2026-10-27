import type { Metadata } from "next";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Badge, EmptyState, Panel, PanelHeader } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { SERVICE_MODE, WEEKDAYS } from "@/lib/crm";
import { listProfessionals, listRules, listServices, listUpcomingBlocks } from "@/lib/data/agenda";
import { formatDateTime } from "@/lib/format";
import { BlockForm, DeleteBlock, DeleteRule, RuleForm, ServiceForm } from "../agenda-forms";

export const metadata: Metadata = { title: "Serviços e horários" };

export default async function AgendaSettingsPage({ params }: PageProps<"/app/[org]/agenda/definicoes">) {
  const { org: slug } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "calendar.read")) return <PermissionDenied />;

  const [services, professionals, rules, blocks] = await Promise.all([
    listServices(ctx.org.id),
    listProfessionals(ctx.org.id),
    listRules(ctx.org.id),
    listUpcomingBlocks(ctx.org.id),
  ]);
  const manage = can(ctx, "settings.manage");
  const write = can(ctx, "calendar.write");
  const names = new Map(professionals.map((p) => [p.id, p.name]));
  // Cada um gere o seu horário; quem gere definições gere o de todos.
  const editable = professionals.filter((p) => manage || (write && p.id === ctx.user.id));
  const hhmm = (t: string) => t.slice(0, 5);

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="Serviços" description="As consultas que o escritório oferece e quanto tempo ocupam na agenda." />
        {services.length ? (
          <ul className="divide-y divide-line">
            {services.map((s) => (
              <li key={s.id} className="px-5 py-4">
                {manage ? (
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-sm text-muted">
                        {s.duration_minutes} min · {SERVICE_MODE[s.mode]}
                      </span>
                      {!s.active ? <Badge>Inativo</Badge> : null}
                      {s.active && !s.bookable_by_ai ? <Badge>Só a equipa marca</Badge> : null}
                      <span className="ml-auto text-sm text-ink underline underline-offset-2">Editar</span>
                    </summary>
                    <div className="mt-4">
                      <ServiceForm org={slug} service={s} />
                    </div>
                  </details>
                ) : (
                  <p>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-sm text-muted">
                      {s.duration_minutes} min · {SERVICE_MODE[s.mode]}
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ainda sem serviços">Sem serviços não é possível marcar consultas.</EmptyState>
        )}
        {manage ? (
          <details className="border-t border-line px-5 py-4" open={!services.length}>
            <summary className="cursor-pointer text-sm font-medium text-ink">Novo serviço</summary>
            <div className="mt-4">
              <ServiceForm org={slug} />
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader
          title="Horário de atendimento"
          description={`Horas locais (${ctx.org.timezone}). Pode ter vários períodos por dia, por exemplo manhã e tarde.`}
        />
        {professionals.length === 0 ? (
          <EmptyState title="Sem profissionais">Só administradores e advogados ativos têm agenda.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {professionals.map((p) => {
              const mine = rules.filter((r) => r.user_id === p.id);
              const canEdit = editable.some((e) => e.id === p.id);
              return (
                <li key={p.id} className="px-5 py-4">
                  <p className="font-medium">{p.name}</p>
                  {mine.length ? (
                    <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      {mine.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-paper px-3 py-1.5">
                          <span>
                            {WEEKDAYS[r.weekday - 1]}, {hhmm(r.start_time)}–{hhmm(r.end_time)}
                          </span>
                          {canEdit ? <DeleteRule org={slug} id={r.id} /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">Sem horário definido: não recebe marcações.</p>
                  )}
                  {canEdit ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-ink">Adicionar período</summary>
                      <div className="mt-3">
                        <RuleForm org={slug} user={p.id} />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Ausências" description="Férias, diligências, formação. Durante uma ausência não são propostos horários." />
        {blocks.length ? (
          <ul className="divide-y divide-line">
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium">{names.get(b.user_id) ?? "—"}</span>: {formatDateTime(b.starts_at)} até{" "}
                  {formatDateTime(b.ends_at)}
                  {b.reason ? <span className="text-muted"> ({b.reason})</span> : null}
                </span>
                {editable.some((e) => e.id === b.user_id) ? <DeleteBlock org={slug} id={b.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">Sem ausências futuras.</p>
        )}
        {editable.length ? (
          <div className="border-t border-line p-5">
            <BlockForm org={slug} users={editable} me={editable.some((e) => e.id === ctx.user.id) ? ctx.user.id : editable[0].id} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
