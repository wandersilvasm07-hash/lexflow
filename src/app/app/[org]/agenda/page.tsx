import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Badge, ButtonLink, EmptyState, Panel, Select, buttonClass, cn } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { APPOINTMENT_STATUS, WEEKDAYS, addDays, mondayOf, zonedToIso } from "@/lib/crm";
import { listAppointments, listProfessionals, listRules, listServices } from "@/lib/data/agenda";
import { isPast } from "@/lib/format";
import { t } from "@/i18n";
import { AppointmentActions } from "./agenda-forms";

export const metadata: Metadata = { title: t.nav.calendar };

export default async function AgendaWeekPage({ params, searchParams }: PageProps<"/app/[org]/agenda">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "calendar.read")) return <PermissionDenied />;
  const tz = ctx.org.timezone;

  const today = mondayOf(new Date(), tz);
  const week = typeof sp.semana === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.semana) ? mondayOf(new Date(`${sp.semana}T12:00:00Z`), tz) : today;
  const prof = typeof sp.prof === "string" ? sp.prof : "";
  const from = zonedToIso(week, "00:00", tz);
  const to = zonedToIso(addDays(week, 7), "00:00", tz);

  const [appointments, professionals, services, rules] = await Promise.all([
    listAppointments(ctx.org.id, from, to, prof || undefined),
    listProfessionals(ctx.org.id),
    listServices(ctx.org.id, true),
    listRules(ctx.org.id),
  ]);
  const names = new Map(professionals.map((p) => [p.id, p.name]));
  const base = `/app/${slug}/agenda`;
  const qs = (w: string) => `${base}?${new URLSearchParams({ semana: w, ...(prof && { prof }) })}`;
  const dayFmt = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short", timeZone: "UTC" });
  const timeFmt = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // AAAA-MM-DD
  const todayLocal = localDay.format(new Date());

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay = new Map(days.map((d) => [d, appointments.filter((a) => localDay.format(new Date(a.starts_at)) === d)]));
  const canWrite = can(ctx, "calendar.write");
  const setupMissing = !services.length || !rules.length;

  return (
    <>
      {sp.marcada ? (
        <Alert tone="ok" className="mb-4">
          Consulta marcada.
        </Alert>
      ) : null}
      {setupMissing && canWrite ? (
        <Alert tone="warn" className="mb-4" title="A agenda ainda não está configurada">
          {!services.length ? "Crie pelo menos um serviço (ex.: consulta de imigração). " : ""}
          {!rules.length ? "Defina os horários de atendimento. " : ""}
          Sem isto, o assistente não consegue propor horários.{" "}
          <Link href={`${base}/definicoes`} className="font-medium underline underline-offset-2">
            Configurar agora
          </Link>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={qs(addDays(week, -7))} className={buttonClass("secondary", "sm")} aria-label="Semana anterior">
            ‹
          </Link>
          <Link href={qs(today)} className={buttonClass("secondary", "sm")}>
            Hoje
          </Link>
          <Link href={qs(addDays(week, 7))} className={buttonClass("secondary", "sm")} aria-label="Semana seguinte">
            ›
          </Link>
          <span className="ml-2 text-sm font-medium">
            {dayFmt.format(new Date(`${week}T00:00:00Z`))} – {dayFmt.format(new Date(`${addDays(week, 6)}T00:00:00Z`))}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {professionals.length > 1 ? (
            <form action={base} className="flex items-center gap-2">
              <input type="hidden" name="semana" value={week} />
              <label>
                <span className="sr-only">Profissional</span>
                <Select name="prof" defaultValue={prof} className="h-8 w-44 text-xs">
                  <option value="">Todos</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
              <button type="submit" className={buttonClass("secondary", "sm")}>
                Ver
              </button>
            </form>
          ) : null}
          {canWrite ? (
            <ButtonLink href={`${base}/nova`} size="sm">
              Marcar consulta
            </ButtonLink>
          ) : null}
        </div>
      </div>

      {appointments.length === 0 ? (
        <Panel>
          <EmptyState title="Sem consultas nesta semana" />
        </Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const isToday = d === todayLocal;
            return (
              <section
                key={d}
                aria-label={`${WEEKDAYS[i]} ${d}`}
                className={cn("rounded-card border bg-surface", isToday ? "border-ink" : "border-line", !list.length && "hidden lg:block")}
              >
                <h2 className="border-b border-line px-3 py-2 text-xs font-medium">
                  {WEEKDAYS[i]} <span className="text-muted">{dayFmt.format(new Date(`${d}T00:00:00Z`))}</span>
                </h2>
                <ul className="space-y-2 p-2">
                  {list.map((a) => {
                    const st = APPOINTMENT_STATUS[a.status];
                    const closed = !["booked", "confirmed"].includes(a.status);
                    return (
                      <li
                        key={a.id}
                        className={cn("rounded-control border border-line p-2 text-xs", closed && "opacity-60", a.status === "cancelled" && "line-through")}
                      >
                        <p className="font-semibold">
                          {timeFmt.format(new Date(a.starts_at))}–{timeFmt.format(new Date(a.ends_at))}
                        </p>
                        <Link href={`/app/${slug}/contactos/${a.contact_id}`} className="block truncate font-medium hover:underline">
                          {a.contacts?.full_name ?? a.contacts?.phone_e164 ?? "Contacto"}
                        </Link>
                        <p className="truncate text-muted">{a.services?.name ?? "Consulta"}</p>
                        {professionals.length > 1 ? <p className="truncate text-muted">{names.get(a.professional_id) ?? "—"}</p> : null}
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {a.source === "ai" ? <Badge>Assistente</Badge> : null}
                          {a.mode ? <Badge>{a.mode === "online" ? "Online" : "Presencial"}</Badge> : null}
                        </div>
                        {canWrite ? (
                          <AppointmentActions org={slug} id={a.id} status={a.status} started={isPast(a.starts_at)} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
