"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { processConversation } from "@/lib/conversations/process";
import type { ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";

export async function enableSimulationAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "whatsapp.manage", async (ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("enable_whatsapp_simulation", { p_org: ctx.org.id });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/whatsapp`);
    return { ok: true, message: "Ambiente de simulação criado." };
  });
}

export async function setAgentEnabledAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "whatsapp.manage", async (ctx) => {
    const enabled = form.get("enabled") === "true";
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_agent_enabled", { p_org: ctx.org.id, p_enabled: enabled });
    if (error) throw error;
    revalidatePath(`/app/${ctx.org.slug}/whatsapp`);
    return { ok: true, message: enabled ? "Assistente ativado." : "Assistente pausado." };
  });
}

const simulateSchema = z.object({
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => /^\+[1-9][0-9]{6,14}$/.test(v), "Use o formato internacional, ex.: +351912345678."),
  name: z.string().trim().max(80).optional(),
  body: z.string().trim().min(1, "Escreva a mensagem.").max(2000),
});

export async function simulateInboundAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "whatsapp.manage", async (ctx) => {
    const parsed = simulateSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc("simulate_inbound_message", {
        p_org: ctx.org.id,
        p_from_e164: parsed.data.phone,
        p_body: parsed.data.body,
        p_profile_name: parsed.data.name || null,
      })
      .single<{ conversation_id: string; agent_should_reply: boolean }>();
    if (error) throw error;

    if (data?.agent_should_reply) {
      after(() => processConversation(data.conversation_id));
    }
    revalidatePath(`/app/${ctx.org.slug}/caixa-de-entrada`);
    return {
      ok: true,
      message: data?.agent_should_reply
        ? "Mensagem simulada recebida. O assistente está a preparar a resposta."
        : "Mensagem simulada recebida. O assistente não vai responder (pausado ou conversa assumida).",
    };
  });
}
