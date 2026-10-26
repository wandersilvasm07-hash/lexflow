"use server";

import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";
import { t } from "@/i18n";

const demoSchema = z.object({
  fullName: z.string().trim().min(2, "Indique o seu nome.").max(120),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Indique um email válido." })),
  firmName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(32).optional(),
  message: z.string().trim().max(2000).optional(),
  consent: z.literal("on", { error: "Precisa de aceitar para podermos contactá-lo." }),
  // Campo escondido: se vier preenchido, é um robô.
  website: z.string().max(0).optional(),
});

export async function requestDemoAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: t.errors.not_configured };
  const parsed = demoSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    // Robôs recebem a mesma resposta de sucesso, sem gravar nada.
    if (parsed.error.issues.some((i) => i.path[0] === "website")) {
      return { ok: true, message: "Pedido recebido. Entraremos em contacto por email." };
    }
    return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_demo_request", {
    p_full_name: parsed.data.fullName,
    p_email: parsed.data.email,
    p_firm_name: parsed.data.firmName ?? null,
    p_phone: parsed.data.phone ?? null,
    p_message: parsed.data.message ?? null,
    p_consent: true,
  });
  if (error) return fail(error);
  return { ok: true, message: "Pedido recebido. Entraremos em contacto por email." };
}
