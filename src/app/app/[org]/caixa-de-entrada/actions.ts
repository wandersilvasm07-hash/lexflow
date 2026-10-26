"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { deliverMessage } from "@/lib/conversations/process";
import type { ActionResult } from "@/lib/errors";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

function done(slug: string, message?: string): ActionResult {
  revalidatePath(`/app/${slug}/caixa-de-entrada`);
  return { ok: true, message };
}

export async function takeOverAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.reply", async (ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("take_over_conversation", { p_conversation: uuid.parse(form.get("id")) });
    if (error) throw error;
    return done(ctx.org.slug, "Assumiu a conversa. O assistente foi pausado nesta conversa.");
  });
}

export async function returnToAiAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.assign", async (ctx) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("return_conversation_to_ai", { p_conversation: uuid.parse(form.get("id")) });
    if (error) throw error;
    return done(ctx.org.slug, "O assistente voltou a acompanhar esta conversa.");
  });
}

export async function setStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.reply", async (ctx) => {
    const status = z.enum(["open", "waiting", "closed"]).parse(form.get("status"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_conversation_status", {
      p_conversation: uuid.parse(form.get("id")),
      p_status: status,
    });
    if (error) throw error;
    return done(ctx.org.slug);
  });
}

export async function assignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.assign", async (ctx) => {
    const raw = String(form.get("user") ?? "");
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_conversation", {
      p_conversation: uuid.parse(form.get("id")),
      p_user: raw ? uuid.parse(raw) : null,
    });
    if (error) throw error;
    return done(ctx.org.slug, "Responsável atualizado.");
  });
}

const replySchema = z.string().trim().min(1, "Escreva a mensagem.").max(4096);

export async function sendReplyAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.reply", async (ctx) => {
    const body = replySchema.safeParse(form.get("body"));
    if (!body.success) return { ok: false, error: body.error.issues[0].message };
    const supabase = await createClient();
    const { data: messageId, error } = await supabase.rpc("send_member_message", {
      p_conversation: uuid.parse(form.get("id")),
      p_body: body.data,
    });
    if (error) {
      if (error.message.includes("outside_service_window")) {
        return {
          ok: false,
          error:
            "Passaram mais de 24 horas desde a última mensagem do contacto. Pelas regras da Meta, só é possível escrever com um modelo de mensagem aprovado (disponível numa próxima versão).",
        };
      }
      if (error.message.includes("take_over_first")) {
        return { ok: false, error: "Assuma a conversa antes de responder, para o assistente parar." };
      }
      throw error;
    }

    // Simulação: marca como enviada. Real: envia pela API depois de responder ao utilizador.
    const sim = await supabase.rpc("mark_simulated_sent", { p_message: messageId });
    if (sim.error && sim.error.message.includes("simulation_only")) {
      if (getAdminClient()) {
        after(() => deliverMessage(messageId as string));
      } else {
        return { ok: true, message: "Mensagem guardada, mas o envio real ainda não está configurado no servidor." };
      }
    } else if (sim.error) {
      throw sim.error;
    }
    return done(ctx.org.slug);
  });
}

export async function addNoteAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "conversations.reply", async (ctx) => {
    const body = z.string().trim().min(1, "Escreva a nota.").max(4000).safeParse(form.get("body"));
    if (!body.success) return { ok: false, error: body.error.issues[0].message };
    const supabase = await createClient();
    const { error } = await supabase.from("internal_notes").insert({
      organization_id: ctx.org.id,
      conversation_id: uuid.parse(form.get("id")),
      author_user_id: ctx.user.id,
      body: body.data,
    });
    if (error) throw error;
    return done(ctx.org.slug, "Nota adicionada.");
  });
}
