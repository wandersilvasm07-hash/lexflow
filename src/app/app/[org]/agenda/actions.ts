"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { can } from "@/lib/auth/dal";
import { mondayOf, zonedToIso } from "@/lib/crm";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";
import { t } from "@/i18n";

const AGENDA_ERRORS: Record<string, string> = {
  slot_unavailable: "Esse horário já não está livre. Escolha outro.",
  slot_in_past: "Não é possível marcar no passado.",
  service_unavailable: "Esse serviço não está ativo.",
  invalid_professional: "Essa pessoa não pode ter consultas (só administradores e advogados ativos).",
  appointment_closed: "Esta marcação já está fechada (cancelada, realizada ou falta).",
  appointment_not_started: "Só pode registar como realizada ou falta depois da hora marcada.",
  invalid_transition: "Essa mudança de estado não é possível.",
};

function agendaError(error: { message?: string }): ActionResult<never> {
  for (const [k, msg] of Object.entries(AGENDA_ERRORS)) {
    if (error.message?.includes(k)) return { ok: false, error: msg };
  }
  throw error;
}

export async function bookAppointmentAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "calendar.write", async (ctx) => {
    const contact = z.uuid({ error: "Escolha o contacto." }).safeParse(form.get("contact"));
    const service = z.uuid({ error: "Escolha o serviço." }).safeParse(form.get("service"));
    if (!contact.success || !service.success) {
      return {
        ok: false,
        error: "Reveja os campos assinalados.",
        fieldErrors: {
          ...(contact.success ? {} : { contact: "Escolha o contacto." }),
          ...(service.success ? {} : { service: "Escolha o serviço." }),
        },
      };
    }

    // Horário escolhido da lista de livres ("prof|instante") ou marcação manual fora do horário.
    let professional: string;
    let startsAt: string;
    const outside = form.get("outside") === "1";
    if (outside) {
      const prof = z.uuid().safeParse(form.get("manual_professional"));
      const day = String(form.get("manual_day") ?? "");
      const time = String(form.get("manual_time") ?? "");
      if (!prof.success || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) {
        return { ok: false, error: "Indique o profissional, o dia e a hora." };
      }
      professional = prof.data;
      startsAt = zonedToIso(day, time, ctx.org.timezone);
    } else {
      const [prof, at] = String(form.get("slot") ?? "").split("|");
      if (!z.uuid().safeParse(prof).success || Number.isNaN(Date.parse(at))) {
        return { ok: false, error: "Escolha um dos horários livres.", fieldErrors: { slot: "Escolha um horário." } };
      }
      professional = prof;
      startsAt = new Date(at).toISOString();
    }

    const mode = String(form.get("mode") ?? "");
    const supabase = await createClient();
    const { error } = await supabase.rpc("book_appointment", {
      p_org: ctx.org.id,
      p_contact: contact.data,
      p_service: service.data,
      p_professional: professional,
      p_starts_at: startsAt,
      p_mode: mode === "presencial" || mode === "online" ? mode : null,
      p_notes: String(form.get("notes") ?? "").slice(0, 1000) || null,
      p_outside_hours: outside,
    });
    if (error) return agendaError(error);

    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    target = `/app/${ctx.org.slug}/agenda?semana=${mondayOf(new Date(startsAt), ctx.org.timezone)}&marcada=1`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

const STATUS_MSG: Record<string, string> = {
  confirmed: "Marcação confirmada.",
  cancelled: "Marcação cancelada. O horário ficou livre.",
  completed: "Registada como realizada.",
  no_show: "Registada como falta.",
};

export async function setAppointmentStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "calendar.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const status = z.enum(["confirmed", "cancelled", "completed", "no_show"]).parse(form.get("status"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_appointment_status", {
      p_appointment: id,
      p_status: status,
      p_reason: String(form.get("reason") ?? "") || null,
    });
    if (error) return agendaError(error);
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true, message: STATUS_MSG[status] };
  });
}

// --------------------------------------------------------------- Serviços

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Indique o nome.").max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  duration_minutes: z.coerce.number().int().refine((n) => n >= 15 && n <= 240 && n % 15 === 0, "Entre 15 e 240 minutos, em múltiplos de 15."),
  mode: z.enum(["presencial", "online", "presencial_ou_online"]),
  min_notice_hours: z.coerce.number().min(0).max(336),
  bookable_by_ai: z.literal("on").optional(),
  active: z.literal("on").optional(),
});

export async function saveServiceAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "settings.manage", async (ctx) => {
    const parsed = serviceSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const d = parsed.data;
    const row = {
      name: d.name,
      description: d.description,
      duration_minutes: d.duration_minutes,
      mode: d.mode,
      min_notice_minutes: Math.round(d.min_notice_hours * 60),
      bookable_by_ai: d.bookable_by_ai === "on",
      active: d.active === "on",
    };
    const supabase = await createClient();
    const id = form.get("id");
    const { error } = id
      ? await supabase.from("services").update(row).eq("id", z.uuid().parse(id)).eq("organization_id", ctx.org.id)
      : await supabase.from("services").insert({ ...row, organization_id: ctx.org.id });
    if (error?.code === "23505") return { ok: false, error: "Já existe um serviço com esse nome.", fieldErrors: { name: "Nome repetido." } };
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true, message: id ? "Serviço atualizado." : "Serviço criado." };
  });
}

// ------------------------------------------------------ Horários e ausências

/** Cada profissional gere os seus horários; quem gere definições gere os de todos. */
function canManageUser(ctx: Parameters<typeof can>[0], userId: string) {
  return userId === ctx.user.id ? can(ctx, "calendar.write") : can(ctx, "settings.manage");
}

export async function addRuleAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "calendar.write", async (ctx) => {
    const user = z.uuid().parse(form.get("user"));
    if (!canManageUser(ctx, user)) return { ok: false, error: t.errors.forbidden };
    const weekdays = form.getAll("weekday").map(Number).filter((n) => n >= 1 && n <= 7);
    const start = String(form.get("start") ?? "");
    const end = String(form.get("end") ?? "");
    if (!weekdays.length) return { ok: false, error: "Escolha pelo menos um dia." };
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start) {
      return { ok: false, error: "A hora de fim tem de ser depois da hora de início." };
    }
    const supabase = await createClient();
    const { error } = await supabase.from("availability_rules").insert(
      weekdays.map((weekday) => ({ organization_id: ctx.org.id, user_id: user, weekday, start_time: start, end_time: end })),
    );
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true, message: "Horário adicionado." };
  });
}

export async function deleteRuleAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "calendar.write", async (ctx) => {
    const supabase = await createClient();
    // O RLS só deixa apagar os próprios horários (ou todos, com settings.manage).
    const { error, count } = await supabase
      .from("availability_rules")
      .delete({ count: "exact" })
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("organization_id", ctx.org.id);
    if (error) throw error;
    if (!count) return { ok: false, error: t.errors.forbidden };
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true };
  });
}

export async function addBlockAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "calendar.write", async (ctx) => {
    const user = z.uuid().parse(form.get("user"));
    if (!canManageUser(ctx, user)) return { ok: false, error: t.errors.forbidden };
    const from = String(form.get("from") ?? "");
    const to = String(form.get("to") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
      return { ok: false, error: "Indique as datas de início e fim (o fim não pode ser antes do início)." };
    }
    const fromTime = String(form.get("from_time") || "00:00");
    const toTime = String(form.get("to_time") || "23:59");
    const supabase = await createClient();
    const { error } = await supabase.from("availability_blocks").insert({
      organization_id: ctx.org.id,
      user_id: user,
      starts_at: zonedToIso(from, fromTime, ctx.org.timezone),
      ends_at: zonedToIso(to, toTime, ctx.org.timezone),
      reason: String(form.get("reason") ?? "").slice(0, 200) || null,
      created_by: ctx.user.id,
    });
    if (error?.code === "23514") return { ok: false, error: "O fim tem de ser depois do início." };
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true, message: "Ausência registada. Esses horários deixam de ser propostos." };
  });
}

export async function deleteBlockAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "calendar.write", async (ctx) => {
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("availability_blocks")
      .delete({ count: "exact" })
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("organization_id", ctx.org.id);
    if (error) throw error;
    if (!count) return { ok: false, error: t.errors.forbidden };
    revalidatePath(`/app/${ctx.org.slug}/agenda`, "layout");
    return { ok: true };
  });
}
