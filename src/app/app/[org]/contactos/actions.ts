"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { CONTACT_STATUS_KEYS } from "@/lib/crm";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";

const statusEnum = z.enum(CONTACT_STATUS_KEYS as [string, ...string[]]);

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const phone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.replace(/[\s().-]/g, "") : null))
  .refine((v) => v === null || /^\+[1-9][0-9]{6,14}$/.test(v), "Use o formato internacional, ex.: +351912345678.");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Email inválido.");

const tags = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(/[;,]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 15),
  );

const contactSchema = z.object({
  full_name: optional(160),
  email,
  locale: optional(10),
  status: statusEnum,
  service_interest: optional(160),
  assigned_to: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.uuid().safeParse(v).success, "Responsável inválido."),
  next_action: optional(300),
  next_action_at: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v).toISOString() : null))
    .catch(null),
  tags,
});

export async function updateContactStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "contacts.write", async (ctx) => {
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("contacts")
      .update({ status: statusEnum.parse(form.get("status")) }, { count: "exact" })
      .eq("id", z.uuid().parse(form.get("id")))
      .eq("organization_id", ctx.org.id);
    if (error) throw error;
    if (!count) return { ok: false, error: "Contacto não encontrado." };
    revalidatePath(`/app/${ctx.org.slug}/contactos`);
    return { ok: true };
  });
}

export async function updateContactAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "contacts.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const parsed = contactSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("contacts")
      .update(parsed.data, { count: "exact" })
      .eq("id", id)
      .eq("organization_id", ctx.org.id);
    if (error) throw error;
    if (!count) return { ok: false, error: "Contacto não encontrado." };
    revalidatePath(`/app/${ctx.org.slug}/contactos`, "layout");
    return { ok: true, message: "Contacto atualizado." };
  });
}

const newContactSchema = z
  .object({
    full_name: z.string().trim().min(2, "Indique o nome.").max(160),
    phone_e164: phone,
    email,
    source: z.enum(["manual", "referral", "form"]).default("manual"),
    service_interest: optional(160),
  })
  .refine((v) => v.phone_e164 || v.email, { path: ["phone_e164"], message: "Indique um telefone ou um email." });

export async function createContactAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "contacts.write", async (ctx) => {
    const parsed = newContactSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("contacts")
      .insert({ ...parsed.data, organization_id: ctx.org.id })
      .select("id")
      .single();
    if (error?.code === "23505") {
      return { ok: false, error: "Já existe um contacto com esse telefone.", fieldErrors: { phone_e164: "Telefone já registado." } };
    }
    if (error) throw error;
    target = `/app/${ctx.org.slug}/contactos/${data.id}`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

export async function addContactNoteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "contacts.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { ok: false, error: "Escreva a nota.", fieldErrors: { body: "Escreva a nota." } };
    if (body.length > 4000) return { ok: false, error: "A nota é demasiado longa." };
    const supabase = await createClient();
    const { error } = await supabase
      .from("contact_notes")
      .insert({ organization_id: ctx.org.id, contact_id: id, author_user_id: ctx.user.id, body });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/contactos/${id}`);
    return { ok: true, message: "Nota guardada." };
  });
}

export async function eraseContactAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "contacts.delete", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 3) {
      return { ok: false, error: "Indique o motivo (ex.: pedido do titular por email).", fieldErrors: { reason: "Indique o motivo." } };
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("erase_contact", { p_contact: id, p_reason: reason });
    if (error) throw error;
    target = `/app/${ctx.org.slug}/contactos?eliminado=1`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}
