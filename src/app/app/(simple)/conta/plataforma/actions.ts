"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseEuros } from "@/lib/ads/constants";
import { isPlatformAdmin, requireUser } from "@/lib/auth/dal";
import { fail, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

const LIMIT_KEYS = ["members", "ai_replies_month", "ad_generations_month", "active_campaigns", "knowledge_docs"] as const;

/** Edita um plano (só administradores da plataforma; verificado também na base de dados). */
export async function savePlanAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireUser("/app/conta/plataforma");
  if (!(await isPlatformAdmin())) return { ok: false, error: "Só administradores da plataforma podem alterar planos." };

  const fe: Record<string, string> = {};
  const id = z.string().regex(/^[a-z0-9_-]{2,40}$/).safeParse(form.get("id"));
  if (!id.success) return { ok: false, error: "Identificador inválido." };
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 60) fe.name = "Entre 2 e 60 caracteres.";
  const priceRaw = String(form.get("price") ?? "").trim();
  const price = priceRaw ? parseEuros(priceRaw) : null;
  if (priceRaw && price === null) fe.price = "Valor inválido (ex.: 99,00).";
  const stripePrice = String(form.get("stripe_price_id") ?? "").trim();
  if (stripePrice && !/^price_[A-Za-z0-9]+$/.test(stripePrice)) fe.stripe_price_id = "Deve começar por price_.";
  const limits: Record<string, number> = {};
  for (const k of LIMIT_KEYS) {
    const v = String(form.get(`limit_${k}`) ?? "").trim();
    if (!v) continue; // vazio = sem limite
    if (!/^\d{1,7}$/.test(v)) fe[`limit_${k}`] = "Número inteiro, ou vazio para sem limite.";
    else limits[k] = Number(v);
  }
  const features = String(form.get("features") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (Object.keys(fe).length) return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fe };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_upsert_plan", {
    p_id: id.data,
    p_name: name,
    p_description: String(form.get("description") ?? "").trim().slice(0, 500),
    p_price_cents: price,
    p_stripe_price_id: stripePrice || null,
    p_limits: limits,
    p_features: features,
    p_is_public: form.get("is_public") === "on",
    p_position: Number(form.get("position") ?? 0) || 0,
  });
  if (error) return fail(error);
  revalidatePath("/app", "layout");
  return { ok: true, message: `Plano ${name} guardado. Fica no registo de atividade.` };
}
