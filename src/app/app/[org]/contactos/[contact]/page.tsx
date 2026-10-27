import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Badge, ButtonLink, EmptyState, Panel, PanelHeader } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { APPOINTMENT_STATUS, CONTACT_SOURCE, CONTACT_STATUS, type AppointmentStatus, type ContactSource, type ContactStatus } from "@/lib/crm";
import { listMembers } from "@/lib/data/team";
import { formatDate, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ContactForm, EraseContact, NoteForm } from "../contact-forms";

export const metadata: Metadata = { title: "Contacto" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Contact = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  locale: string | null;
  source: ContactSource;
  source_campaign: string | null;
  status: ContactStatus;
  service_interest: string | null;
  assigned_to: string | null;
  next_action: string | null;
  next_action_at: string | null;
  tags: string[];
  consents: Record<string, { granted?: boolean; at?: string; channel?: string }>;
  created_at: string;
};

export default async function ContactPage({ params }: PageProps<"/app/[org]/contactos/[contact]">) {
  const { org: slug, contact: id } = await params;
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "contacts.read")) return <PermissionDenied />;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle<Contact>();
  if (!contact) notFound();

  const [members, { data: notes }, conversations, appointments] = await Promise.all([
    listMembers(ctx.org.id),
    supabase
      .from("contact_notes")
      .select("id, body, author_user_id, created_at")
      .eq("contact_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    can(ctx, "conversations.read")
      ? supabase
          .from("conversations")
          .select("id, status, mode, category, is_urgent, last_message_at, created_at")
          .eq("contact_id", id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
    can(ctx, "calendar.read")
      ? supabase
          .from("appointments")
          .select("id, starts_at, status, source, professional_id, services(name)")
          .eq("contact_id", id)
          .order("starts_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
  ]);

  const names = new Map(members.map((m) => [m.user_id, m.full_name ?? m.email]));
  const assignable = members
    .filter((m) => m.status === "active" && ["org_admin", "lawyer", "legal_assistant"].includes(m.role))
    .map((m) => ({ id: m.user_id, name: m.full_name ?? m.email }));
  const base = `/app/${slug}`;
  const consents = Object.entries(contact.consents ?? {});

  return (
    <>
      <Link href={`${base}/contactos`} className="text-sm text-muted hover:text-ink">
        Contactos
      </Link>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{contact.full_name ?? "Contacto sem nome"}</h1>
          <p className="mt-1 text-sm text-muted">
            {[contact.phone_e164, contact.email].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="ink">{CONTACT_STATUS[contact.status]}</Badge>
            <Badge>{CONTACT_SOURCE[contact.source] ?? contact.source}</Badge>
            {contact.source_campaign ? <Badge>Campanha: {contact.source_campaign}</Badge> : null}
            <Badge>Desde {formatDate(contact.created_at)}</Badge>
          </div>
        </div>
        {can(ctx, "calendar.write") ? (
          <ButtonLink href={`${base}/agenda/nova?contacto=${contact.id}`}>Marcar consulta</ButtonLink>
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Ficha" />
            <div className="p-5">
              {can(ctx, "contacts.write") ? (
                <ContactForm org={slug} contact={contact} members={assignable} />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Serviço pretendido</dt>
                    <dd>{contact.service_interest ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Responsável</dt>
                    <dd>{contact.assigned_to ? (names.get(contact.assigned_to) ?? "—") : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Próxima ação</dt>
                    <dd>{contact.next_action ?? "—"}</dd>
                  </div>
                </dl>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Notas internas" description="Só a equipa de atendimento vê estas notas. Nunca são enviadas ao contacto." />
            <div className="space-y-4 p-5">
              {can(ctx, "contacts.write") ? <NoteForm org={slug} id={contact.id} /> : null}
              {notes?.length ? (
                <ul className="divide-y divide-line">
                  {notes.map((n) => (
                    <li key={n.id} className="py-3 text-sm">
                      <p className="whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {names.get(n.author_user_id) ?? "Ex-membro"} · {formatDateTime(n.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Sem notas.</p>
              )}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          {appointments.data ? (
            <Panel>
              <PanelHeader title="Consultas" />
              {appointments.data.length ? (
                <ul className="divide-y divide-line">
                  {appointments.data.map((a) => {
                    const st = APPOINTMENT_STATUS[a.status as AppointmentStatus];
                    return (
                      <li key={a.id} className="px-5 py-3 text-sm">
                        <p className="font-medium">{formatDateTime(a.starts_at)}</p>
                        <p className="text-xs text-muted">
                          {(a.services as unknown as { name: string } | null)?.name ?? "Consulta"} ·{" "}
                          {names.get(a.professional_id) ?? "—"}
                          {a.source === "ai" ? " · marcada pelo assistente" : ""}
                        </p>
                        <Badge tone={st.tone} className="mt-1">
                          {st.label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState title="Sem consultas" />
              )}
            </Panel>
          ) : null}

          {conversations.data ? (
            <Panel>
              <PanelHeader title="Conversas" />
              {conversations.data.length ? (
                <ul className="divide-y divide-line">
                  {conversations.data.map((c) => (
                    <li key={c.id}>
                      <Link href={`${base}/caixa-de-entrada?c=${c.id}`} className="block px-5 py-3 text-sm hover:bg-paper">
                        <span className="font-medium">{formatDateTime(c.last_message_at ?? c.created_at)}</span>
                        <span className="block text-xs text-muted">
                          {c.status === "closed" ? "Fechada" : c.mode === "ai" ? "Com o assistente" : "Com a equipa"}
                          {c.is_urgent ? " · urgente" : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Sem conversas" />
              )}
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Consentimentos" />
            {consents.length ? (
              <ul className="divide-y divide-line text-sm">
                {consents.map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between px-5 py-2.5">
                    <span>{k}</span>
                    <Badge tone={v.granted ? "ok" : "neutral"}>
                      {v.granted ? `Dado${v.at ? ` em ${formatDate(v.at)}` : ""}` : "Não dado"}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">
                Nenhum consentimento registado. Sem consentimento, os dados deste contacto não são usados para publicidade.
              </p>
            )}
          </Panel>

          {can(ctx, "contacts.delete") ? (
            <Panel>
              <PanelHeader title="Proteção de dados" description="Para pedidos de eliminação ao abrigo do RGPD." />
              <div className="p-5">
                <EraseContact org={slug} id={contact.id} />
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
