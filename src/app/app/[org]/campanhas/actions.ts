"use server";

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CTAS, LANGUAGES, SUPPORTED_DESTINATIONS, formatCents, parseEuros } from "@/lib/ads/constants";
import { decryptToken, encryptToken } from "@/lib/ads/crypto";
import { generateCampaignPlan } from "@/lib/ads/generate";
import { MetaAds } from "@/lib/ads/meta";
import { CREATIVES_BUCKET, applyStatusChange, runComplianceReview, runPublish, syncCampaign } from "@/lib/ads/service";
import { DEFAULT_MODEL } from "@/lib/agent/run";
import { orgAction } from "@/lib/auth/action";
import type { ActionResult } from "@/lib/errors";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ADS_ERRORS: Record<string, string> = {
  budget_limits_not_set: "O escritório ainda não definiu os limites de orçamento (Tráfego Pago IA › Limites de orçamento).",
  budget_daily_over_limit: "O orçamento diário ultrapassa o limite definido pelo escritório.",
  budget_total_over_limit: "O orçamento total ultrapassa o limite por campanha definido pelo escritório.",
  budget_all_daily_over_limit: "Somando as campanhas em curso, o orçamento diário do escritório seria ultrapassado.",
  budget_mismatch: "O orçamento mudou entretanto. Reveja a campanha e aprove de novo.",
  budget_exhausted: "A campanha já atingiu o orçamento total. Para continuar, crie uma nova campanha.",
  campaign_changed: "A campanha foi alterada depois de a ter visto. Reveja e aprove de novo.",
  compliance_required: "Falta a revisão de conformidade do conteúdo atual.",
  compliance_blocked: "A revisão de conformidade encontrou problemas que impedem a aprovação.",
  missing_images: "Todos os anúncios precisam de imagem antes de aprovar.",
  no_ads: "A campanha não tem anúncios.",
  duplicate_campaign: "Já existe uma campanha igual aprovada ou em curso.",
  statement_required: "Confirme todas as declarações antes de aprovar.",
  start_in_past: "A data de início já passou. Altere-a antes de aprovar.",
  campaign_locked: "A campanha já foi publicada e não pode ser alterada. Pause-a ou crie uma nova.",
  invalid_status: "Essa ação não é possível no estado atual da campanha.",
  not_approved: "A campanha tem de estar aprovada (e sem alterações desde a aprovação).",
  ad_account_not_connected: "Ligue primeiro a conta de anúncios da Meta (Tráfego Pago IA › Conta Meta).",
  invalid_ads_count: "Uma campanha tem entre 1 e 5 anúncios.",
  invalid_service: "Serviço inválido.",
  invalid_locations: "Localizações inválidas.",
  agent_not_configured: "A IA não está configurada neste ambiente (falta a chave do modelo).",
  generator_invalid_output: "A IA não devolveu uma proposta válida. Tente de novo.",
  service_not_configured: "Falta a chave de serviço do Supabase no servidor.",
  ads_not_configured: "A ligação à Meta não está configurada neste ambiente.",
};

function adsError(error: unknown): ActionResult<never> {
  const msg = (error as { message?: string })?.message ?? "";
  for (const [k, text] of Object.entries(ADS_ERRORS)) if (msg.includes(k)) return { ok: false, error: text };
  if (/check constraint|violates check/i.test(msg)) return { ok: false, error: "Há valores inválidos (ex.: total inferior ao diário, datas trocadas)." };
  throw error;
}

const back = (slug: string, id?: string) => {
  revalidatePath(`/app/${slug}/campanhas`, "layout");
  revalidatePath(`/app/${slug}/trafego-pago`, "layout");
  if (id) revalidatePath(`/app/${slug}/campanhas/${id}`);
};

// ------------------------------------------------------------ Dados básicos

const basicsSchema = z
  .object({
    name: z.string().trim().min(2, "Indique um nome.").max(120),
    service_id: z.string().optional(),
    service_label: z.string().trim().min(2, "Indique o serviço a divulgar.").max(200),
    objective: z.enum(["messages", "traffic", "awareness", "leads"]),
    destination: z.enum(["whatsapp", "landing_page", "form"]),
    destination_url: z.string().trim().max(2000).optional(),
    locations: z.string().trim().min(2, "Indique pelo menos uma localização."),
    languages: z.array(z.enum(Object.keys(LANGUAGES) as [keyof typeof LANGUAGES])).min(1, "Escolha pelo menos um idioma."),
    audience_notes: z.string().trim().max(1000).optional(),
    daily: z.string(),
    total: z.string(),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data de início."),
    ends_on: z.string().optional(),
  })
  .superRefine((d, ctx) => {
    if (!SUPPORTED_DESTINATIONS.includes(d.destination)) ctx.addIssue({ code: "custom", path: ["destination"], message: "Este destino ainda não está disponível." });
    if (d.destination === "landing_page" && !/^https:\/\/\S+$/.test(d.destination_url ?? ""))
      ctx.addIssue({ code: "custom", path: ["destination_url"], message: "Indique um endereço que comece por https://." });
    if (d.objective === "leads") ctx.addIssue({ code: "custom", path: ["objective"], message: "Este objetivo ainda não está disponível." });
    const daily = parseEuros(d.daily);
    const total = parseEuros(d.total);
    if (daily === null || daily < 100) ctx.addIssue({ code: "custom", path: ["daily"], message: "Mínimo 1,00 € por dia." });
    if (total === null || (daily !== null && total < daily)) ctx.addIssue({ code: "custom", path: ["total"], message: "O total tem de ser pelo menos igual ao diário." });
    if (d.ends_on && d.ends_on < d.starts_on) ctx.addIssue({ code: "custom", path: ["ends_on"], message: "A data de fim é anterior ao início." });
  });

function readBasics(form: FormData) {
  const parsed = basicsSchema.safeParse({ ...Object.fromEntries(form), languages: form.getAll("languages") });
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
    return { ok: false as const, result: { ok: false as const, error: "Reveja os campos assinalados.", fieldErrors: fe } };
  }
  const d = parsed.data;
  return {
    ok: true as const,
    data: {
      name: d.name,
      service_id: d.service_id || null,
      service_label: d.service_label,
      objective: d.objective,
      destination: d.destination,
      destination_url: d.destination === "landing_page" ? d.destination_url : null,
      locations: d.locations.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 25),
      languages: d.languages,
      audience_notes: d.audience_notes || null,
      daily_budget_cents: parseEuros(d.daily),
      total_budget_cents: parseEuros(d.total),
      starts_on: d.starts_on,
      ends_on: d.ends_on || null,
    },
  };
}

export async function createCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "campaigns.write", async (ctx) => {
    const b = readBasics(form);
    if (!b.ok) return b.result;
    const supabase = await createClient();
    const { data: id, error } = await supabase.rpc("create_campaign", { p_org: ctx.org.id, p_data: b.data });
    if (error) return adsError(error);
    back(ctx.org.slug);
    target = `/app/${ctx.org.slug}/campanhas/${id}?criada=1`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

export async function updateCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const b = readBasics(form);
    if (!b.ok) return b.result;
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_campaign", { p_campaign: id, p_data: b.data });
    if (error) return adsError(error);
    await runComplianceReview(id, ctx.user.id, supabase).catch(() => null);
    back(ctx.org.slug, id);
    target = `/app/${ctx.org.slug}/campanhas/${id}?guardada=1`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

// ------------------------------------------------------------ Plano e anúncios

export async function generatePlanAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const [{ data: c }, { data: limits }] = await Promise.all([
      supabase.from("campaigns").select("service_label, objective, destination, locations, languages, audience_notes, daily_budget_cents, total_budget_cents, status").eq("id", id).single(),
      supabase.from("ad_budget_settings").select("max_daily_cents, max_campaign_total_cents").eq("organization_id", ctx.org.id).maybeSingle(),
    ]);
    if (!c) return { ok: false, error: "Campanha não encontrada." };
    try {
      const { plan, model } = await generateCampaignPlan({
        officeName: ctx.org.name,
        service: c.service_label,
        objective: c.objective,
        destination: c.destination,
        locations: c.locations,
        languages: c.languages,
        audienceNotes: c.audience_notes,
        dailyBudgetCents: c.daily_budget_cents,
        totalBudgetCents: c.total_budget_cents,
        limits: limits ? { maxDailyCents: limits.max_daily_cents, maxTotalCents: limits.max_campaign_total_cents } : null,
      });
      const { variantes, ...rest } = plan;
      const { error } = await supabase.rpc("set_campaign_content", {
        p_campaign: id,
        p_ads: variantes.map((v) => ({ ...v, cta: c.destination === "whatsapp" ? "WHATSAPP_MESSAGE" : v.cta })),
        p_plan: { ...rest, generator: "2026-10-27.1" },
        p_model: model,
      });
      if (error) return adsError(error);
      const review = await runComplianceReview(id, ctx.user.id, supabase);
      back(ctx.org.slug, id);
      const blocking = review.issues.filter((i) => i.severity === "block").length;
      return {
        ok: true,
        message: blocking
          ? `Plano e anúncios gerados. A revisão encontrou ${blocking} problema(s) a corrigir antes de aprovar.`
          : "Plano e anúncios gerados e revistos. Confira os textos e carregue as imagens.",
      };
    } catch (err) {
      return adsError(err);
    }
  });
}

export async function saveAdsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const count = Math.min(5, Math.max(0, Number(form.get("count") ?? 0)));
    const ads: Record<string, unknown>[] = [];
    const fe: Record<string, string> = {};
    for (let i = 0; i < count; i++) {
      if (form.get(`remove_${i}`) === "1") continue;
      const primary = String(form.get(`primary_text_${i}`) ?? "").trim();
      const headline = String(form.get(`headline_${i}`) ?? "").trim();
      const cta = String(form.get(`cta_${i}`) ?? "");
      if (primary.length < 1 || primary.length > 2000) fe[`primary_text_${i}`] = "Entre 1 e 2000 caracteres.";
      if (headline.length < 1 || headline.length > 80) fe[`headline_${i}`] = "Entre 1 e 80 caracteres.";
      if (!(cta in CTAS)) fe[`cta_${i}`] = "Escolha o botão.";
      ads.push({
        primary_text: primary,
        headline,
        description: String(form.get(`description_${i}`) ?? "").trim().slice(0, 200) || null,
        cta,
        image_brief: String(form.get(`image_brief_${i}`) ?? "").trim().slice(0, 1000) || null,
        image_path: String(form.get(`image_path_${i}`) ?? "") || null,
      });
    }
    if (form.get("add") === "1" && ads.length < 5) {
      ads.push({ primary_text: "Novo anúncio — escreva o texto.", headline: "Título", cta: "WHATSAPP_MESSAGE", image_path: null });
    }
    if (Object.keys(fe).length) return { ok: false, error: "Reveja os anúncios assinalados.", fieldErrors: fe };
    if (!ads.length) return { ok: false, error: "A campanha precisa de pelo menos um anúncio." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_campaign_content", { p_campaign: id, p_ads: ads });
    if (error) return adsError(error);
    await runComplianceReview(id, ctx.user.id, supabase);
    back(ctx.org.slug, id);
    return { ok: true, message: "Anúncios guardados e revistos." };
  });
}

function imageKind(buf: Buffer): "jpg" | "png" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

export async function uploadAdImageAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const position = z.coerce.number().int().min(0).max(4).parse(form.get("position"));
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha uma imagem." };
    if (file.size > 4 * 1024 * 1024) return { ok: false, error: "A imagem tem mais de 4 MB." };
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = imageKind(buf);
    if (!kind) return { ok: false, error: "Use uma imagem JPG ou PNG." };

    const supabase = await createClient();
    const { data: ads } = await supabase
      .from("campaign_ads")
      .select("position, primary_text, headline, description, cta, image_brief, image_path")
      .eq("campaign_id", id)
      .order("position");
    if (!ads?.some((a) => a.position === position)) return { ok: false, error: "Anúncio não encontrado." };

    const admin = getAdminClient();
    if (!admin) return adsError(new Error("service_not_configured"));
    const path = `${ctx.org.id}/${id}/${randomUUID()}.${kind}`;
    const { error: upErr } = await admin.storage.from(CREATIVES_BUCKET).upload(path, buf, { contentType: kind === "png" ? "image/png" : "image/jpeg" });
    if (upErr) return { ok: false, error: "Não foi possível guardar a imagem." };

    const next = ads.map((a) => ({ ...a, image_path: a.position === position ? path : a.image_path }));
    const { error } = await supabase.rpc("set_campaign_content", { p_campaign: id, p_ads: next });
    if (error) {
      await admin.storage.from(CREATIVES_BUCKET).remove([path]);
      return adsError(error);
    }
    await runComplianceReview(id, ctx.user.id, supabase);
    back(ctx.org.slug, id);
    return { ok: true, message: "Imagem carregada." };
  });
}

export async function reviewComplianceAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    try {
      const r = await runComplianceReview(id, ctx.user.id, supabase);
      back(ctx.org.slug, id);
      return { ok: true, message: r.issues.length ? `Revisão feita: ${r.issues.length} ponto(s) a ver.` : "Revisão feita: sem problemas encontrados." };
    } catch (err) {
      return adsError(err);
    }
  });
}

// ------------------------------------------------------------ Aprovação e publicação

export async function approveCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const hash = z.string().regex(/^[0-9a-f]{64}$/).parse(form.get("hash"));
    const daily = z.coerce.number().int().parse(form.get("daily"));
    const total = z.coerce.number().int().parse(form.get("total"));
    const checks = ["c_conteudo", "c_deontologia", "c_orcamento"].every((k) => form.get(k) === "on");
    if (!checks) return { ok: false, error: ADS_ERRORS.statement_required };
    const statement = `Revi os anúncios e o plano desta campanha, confirmo que o conteúdo respeita as regras deontológicas da advocacia e as políticas da Meta, e autorizo um gasto máximo de ${formatCents(daily)} por dia e ${formatCents(total)} no total.`;
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_campaign", {
      p_campaign: id,
      p_content_hash: hash,
      p_daily_cents: daily,
      p_total_cents: total,
      p_statement: statement,
    });
    if (error) return adsError(error);
    back(ctx.org.slug, id);
    return { ok: true, message: "Campanha aprovada. A autorização ficou registada." };
  });
}

export async function revokeApprovalAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_campaign_approval", { p_campaign: id, p_reason: "Anulada manualmente." });
    if (error) return adsError(error);
    back(ctx.org.slug, id);
    return { ok: true, message: "Aprovação anulada. A campanha voltou a rascunho." };
  });
}

export async function publishCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_campaign_publish", { p_campaign: id });
    if (error) return adsError(error);
    const req = data as { already: boolean; status: string };
    if (req.already && req.status !== "publishing") {
      back(ctx.org.slug, id);
      return { ok: true, message: "Esta campanha já está publicada. Nada foi duplicado." };
    }
    try {
      const r = await runPublish(id);
      back(ctx.org.slug, id);
      return r.ok
        ? { ok: true, message: `Publicada. Estado na Meta: ${r.status}. Os anúncios passam pela revisão da Meta antes de começarem.` }
        : { ok: false, error: `A publicação não terminou: ${r.error} Pode repetir; o que já foi criado não é duplicado.` };
    } catch (err) {
      back(ctx.org.slug, id);
      return adsError(err);
    }
  });
}

export async function changeStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const target = z.enum(["paused", "active", "ended"]).parse(form.get("target"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("authorize_campaign_status", { p_campaign: id, p_target: target });
    if (error) return adsError(error);
    try {
      const status = await applyStatusChange(id, target, ctx.user.id);
      back(ctx.org.slug, id);
      return { ok: true, message: status === "active" ? "Campanha retomada (confirmado pela Meta)." : status === "ended" ? "Campanha terminada." : "Campanha pausada (confirmado pela Meta)." };
    } catch (err) {
      back(ctx.org.slug, id);
      const m = (err as Error).message;
      return { ok: false, error: `A Meta não confirmou a alteração: ${m.slice(0, 200)}` };
    }
  });
}

export async function syncCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.read", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    try {
      const r = await syncCampaign(id);
      back(ctx.org.slug, id);
      return { ok: true, message: "skipped" in r ? "Nada a sincronizar: a campanha não está publicada." : "Estado e métricas atualizados a partir da Meta." };
    } catch (err) {
      return { ok: false, error: `Não foi possível sincronizar: ${(err as Error).message.slice(0, 200)}` };
    }
  });
}

export async function archiveCampaignAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "campaigns.write", async (ctx) => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("archive_campaign", { p_campaign: id });
    if (error) return adsError(error);
    back(ctx.org.slug, id);
    target = `/app/${ctx.org.slug}/campanhas`;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

// ------------------------------------------------------------ Melhorias (passo 13)

export async function suggestImprovementsAction(_: ActionResult<string> | null, form: FormData): Promise<ActionResult<string>> {
  return orgAction<string>(form, "campaigns.read", async () => {
    const id = z.uuid().parse(form.get("id"));
    const supabase = await createClient();
    const [{ data: c }, { data: m }, { data: ads }] = await Promise.all([
      supabase.from("campaigns").select("name, service_label, objective, daily_budget_cents, total_budget_cents, spend_cents").eq("id", id).single(),
      supabase.from("campaign_metrics_daily").select("day, impressions, reach, clicks, conversations_started, spend_cents").eq("campaign_id", id).order("day"),
      supabase.from("campaign_ads").select("position, headline, primary_text").eq("campaign_id", id).order("position"),
    ]);
    if (!c) return { ok: false, error: "Campanha não encontrada." };
    const days = (m ?? []).filter((r) => r.impressions > 0);
    if (days.length < 3) return { ok: false, error: "Ainda não há dados reais suficientes (mínimo 3 dias com impressões)." };
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return adsError(new Error("agent_not_configured"));
    const client = new Anthropic({ apiKey, timeout: 60_000 });
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `És consultor de anúncios na Meta para um escritório de advocacia em Portugal. Com base APENAS nestes dados reais, propõe 3 a 5 melhorias concretas, em português de Portugal, curtas. Não inventes números, não prometas resultados, não sugiras aumentar o orçamento acima do definido (${formatCents(c.daily_budget_cents)}/dia, ${formatCents(c.total_budget_cents)} total) e respeita as regras de publicidade dos advogados (sem promessas, sem comparações, sem temas políticos). Indica, para cada sugestão, em que dado se baseia. Se os dados forem poucos para concluir, di-lo.

Campanha: ${c.name} — ${c.service_label}
Anúncios: ${(ads ?? []).map((a) => `[${String.fromCharCode(65 + a.position)}] ${a.headline}: ${a.primary_text}`).join(" | ")}
Métricas diárias (Meta): ${JSON.stringify(days)}
Gasto total: ${formatCents(c.spend_cents)}`,
        },
      ],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    return { ok: true, data: text, message: `Sugestões com base em ${days.length} dias de dados reais. Nada é alterado automaticamente.` };
  });
}

// ------------------------------------------------------------ Limites e conta Meta

export async function saveBudgetLimitsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "settings.manage", async (ctx) => {
    const daily = parseEuros(form.get("max_daily"));
    const total = parseEuros(form.get("max_total"));
    const all = parseEuros(form.get("max_all_daily"));
    const pct = Number(form.get("alert_pct"));
    const fe: Record<string, string> = {};
    if (daily === null || daily < 100) fe.max_daily = "Mínimo 1,00 €.";
    if (total === null || (daily !== null && total < daily)) fe.max_total = "Tem de ser pelo menos igual ao limite diário.";
    if (all === null || (daily !== null && all < daily)) fe.max_all_daily = "Tem de ser pelo menos igual ao limite diário por campanha.";
    if (!Number.isInteger(pct) || pct < 50 || pct > 100) fe.alert_pct = "Entre 50 e 100.";
    if (Object.keys(fe).length) return { ok: false, error: "Reveja os campos assinalados.", fieldErrors: fe };
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_ad_budget_settings", {
      p_org: ctx.org.id,
      p_max_daily_cents: daily,
      p_max_campaign_total_cents: total,
      p_max_all_daily_cents: all,
      p_alert_pct: pct,
    });
    if (error) return adsError(error);
    back(ctx.org.slug);
    return { ok: true, message: "Limites guardados. Ficaram no registo de atividade." };
  });
}

type Pending = { token: string; exp: string | null; org: string; uid: string };

async function readPending(slug: string, uid: string): Promise<Pending | null> {
  const raw = (await cookies()).get("meta_pending")?.value;
  if (!raw) return null;
  try {
    const p = JSON.parse(decryptToken(raw)) as Pending;
    return p.org === slug && p.uid === uid ? p : null;
  } catch {
    return null;
  }
}

export async function connectMetaAccountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const pending = await readPending(ctx.org.slug, ctx.user.id);
    if (!pending) return { ok: false, error: "A autorização da Meta expirou. Volte a ligar a conta." };
    const account = String(form.get("account") ?? "");
    const page = String(form.get("page") ?? "");
    const whatsapp = String(form.get("whatsapp") ?? "").replace(/\s/g, "");
    if (whatsapp && !/^\+[1-9]\d{6,14}$/.test(whatsapp)) {
      return { ok: false, error: "Número de WhatsApp inválido (formato +351…).", fieldErrors: { whatsapp: "Formato +351…" } };
    }
    // Confirma junto da Meta que a conta e a Página escolhidas pertencem a este token.
    const meta = new MetaAds(pending.token);
    const [accounts, pages] = await Promise.all([meta.listAdAccounts(), meta.listPages()]);
    const acc = accounts.find((a) => a.id === account);
    if (!acc) return { ok: false, error: "Escolha uma conta de anúncios ativa." };
    if (!pages.some((p) => p.id === page)) return { ok: false, error: "Escolha a Página do Facebook do escritório." };
    const supabase = await createClient();
    const { error } = await supabase.rpc("connect_ad_account", {
      p_org: ctx.org.id,
      p_external_id: acc.id,
      p_name: acc.name,
      p_currency: acc.currency,
      p_page_id: page,
      p_whatsapp_number: whatsapp || null,
      p_token_ciphertext: encryptToken(pending.token),
      p_token_expires_at: pending.exp,
    });
    if (error) return adsError(error);
    (await cookies()).delete("meta_pending");
    back(ctx.org.slug);
    return { ok: true, message: "Conta Meta ligada." };
  });
}

export async function disconnectMetaAccountAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  return orgAction(form, "campaigns.publish", async (ctx) => {
    const id = z.uuid().parse(form.get("account_id"));
    const supabase = await createClient();
    const { error } = await supabase.rpc("disconnect_ad_account", { p_account: id });
    if (error) return adsError(error);
    back(ctx.org.slug);
    return { ok: true, message: "Conta desligada. O token foi apagado." };
  });
}
