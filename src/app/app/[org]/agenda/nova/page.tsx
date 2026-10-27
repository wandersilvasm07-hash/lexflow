import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/shell/module-placeholder";
import { Alert, Button, Field, Input, Panel, PanelHeader, Select } from "@/components/ui";
import { can, getOrgContext } from "@/lib/auth/dal";
import { addDays, zonedToIso } from "@/lib/crm";
import { availableSlots, listProfessionals, listServices } from "@/lib/data/agenda";
import { createClient } from "@/lib/supabase/server";
import { BookForm, type SlotGroup } from "../agenda-forms";

export const metadata: Metadata = { title: "Marcar consulta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewAppointmentPage({ params, searchParams }: PageProps<"/app/[org]/agenda/nova">) {
  const [{ org: slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(slug);
  if (!can(ctx, "calendar.write")) return <PermissionDenied />;
  const tz = ctx.org.timezone;
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const todayLocal = localDay.format(new Date());

  const contactId = typeof sp.contacto === "string" && UUID.test(sp.contacto) ? sp.contacto : "";
  const serviceId = typeof sp.servico === "string" && UUID.test(sp.servico) ? sp.servico : "";
  const prof = typeof sp.prof === "string" && UUID.test(sp.prof) ? sp.prof : "";
  const day = typeof sp.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) && sp.dia >= todayLocal ? sp.dia : todayLocal;

  const supabase = await createClient();
  const [services, professionals, { data: contacts }] = await Promise.all([
    listServices(ctx.org.id, true),
    listProfessionals(ctx.org.id),
    supabase
      .from("contacts")
      .select("id, full_name, phone_e164, email")
      .eq("organization_id", ctx.org.id)
      .neq("status", "closed")
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  // Garante que o contacto pedido aparece na lista, mesmo que não seja recente.
  let contactList = contacts ?? [];
  if (contactId && !contactList.some((c) => c.id === contactId)) {
    const { data: one } = await supabase
      .from("contacts")
      .select("id, full_name, phone_e164, email")
      .eq("id", contactId)
      .eq("organization_id", ctx.org.id)
      .maybeSingle();
    if (one) contactList = [one, ...contactList];
  }

  const ready = contactId && serviceId && services.some((s) => s.id === serviceId);
  let groups: SlotGroup[] = [];
  if (ready) {
    const slots = await availableSlots(
      ctx.org.id,
      serviceId,
      zonedToIso(day, "00:00", tz),
      zonedToIso(addDays(day, 7), "00:00", tz),
      prof || undefined,
    );
    const names = new Map(professionals.map((p) => [p.id, p.name]));
    const labelFmt = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
    const timeFmt = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    const map = new Map<string, SlotGroup>();
    for (const s of slots) {
      const d = localDay.format(new Date(s.starts_at));
      if (!map.has(d)) map.set(d, { day: d, label: labelFmt.format(new Date(s.starts_at)), slots: [] });
      map.get(d)!.slots.push({
        value: `${s.professional_id}|${s.starts_at}`,
        time: timeFmt.format(new Date(s.starts_at)),
        professional: names.get(s.professional_id) ?? "",
      });
    }
    groups = [...map.values()];
  }

  const base = `/app/${slug}`;
  if (!services.length || !professionals.length) {
    return (
      <Alert tone="warn" title="Falta configurar a agenda">
        Crie um serviço e defina os horários de atendimento antes de marcar.{" "}
        <Link href={`${base}/agenda/definicoes`} className="font-medium underline underline-offset-2">
          Ir para serviços e horários
        </Link>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader title="1. Quem, o quê e quando" />
        <form action={`${base}/agenda/nova`} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field id="contacto" label="Contacto">
            <Select id="contacto" name="contacto" defaultValue={contactId} required>
              <option value="" disabled>
                Escolha…
              </option>
              {contactList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name ?? c.phone_e164 ?? c.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="servico" label="Serviço">
            <Select id="servico" name="servico" defaultValue={serviceId || services[0]?.id} required>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.duration_minutes} min)
                </option>
              ))}
            </Select>
          </Field>
          <Field id="prof" label="Profissional">
            <Select id="prof" name="prof" defaultValue={prof}>
              <option value="">Qualquer</option>
              {professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="dia" label="A partir de">
            <Input id="dia" name="dia" type="date" min={todayLocal} defaultValue={day} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" variant="secondary">
              Ver horários livres
            </Button>
            <Link href={`${base}/contactos/novo`} className="ml-3 text-sm text-muted hover:text-ink">
              O contacto não está na lista? Criar contacto
            </Link>
          </div>
        </form>
      </Panel>

      {ready ? (
        <Panel>
          <PanelHeader title="2. Escolha o horário" description="Mostram-se os próximos 7 dias a partir da data escolhida." />
          <div className="p-5">
            <BookForm
              org={slug}
              contact={contactId}
              service={serviceId}
              groups={groups}
              professionals={professionals}
              defaultDay={day}
            />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
