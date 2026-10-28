import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkCompliance, type AdContent } from "./compliance";
import { decryptToken } from "./crypto";
import { MetaAds, MetaApiError } from "./meta";
import { publishCampaign, type PublishCampaign } from "./publish";

/**
 * Operações de servidor sobre campanhas (usam a chave de serviço). As
 * autorizações do utilizador são verificadas ANTES, pelas funções da base de
 * dados chamadas com a sessão dele (approve, request_publish, authorize_status).
 */

function admin(): SupabaseClient {
  const a = getAdminClient();
  if (!a) throw new Error("service_not_configured");
  return a;
}

export const CREATIVES_BUCKET = "ad-creatives";

/** Revisão de conformidade sobre o conteúdo lido pelo servidor, gravada para esse conteúdo exato. */
export async function runComplianceReview(campaignId: string, actor: string, userClient: SupabaseClient) {
  const [{ data: c, error }, { data: ads }, { data: hash }] = await Promise.all([
    userClient.from("campaigns").select("id, destination").eq("id", campaignId).single(),
    userClient.from("campaign_ads").select("primary_text, headline, description, cta, image_brief").eq("campaign_id", campaignId).order("position"),
    userClient.rpc("campaign_content_hash", { p_campaign: campaignId }),
  ]);
  if (error || !c || !hash) throw new Error("not_found");
  const result = checkCompliance((ads ?? []) as AdContent[], { destination: c.destination });
  const { error: recErr } = await admin().rpc("record_campaign_compliance", {
    p_campaign: campaignId,
    p_content_hash: hash,
    p_result: result,
    p_actor: actor,
  });
  if (recErr) throw recErr;
  return result;
}

async function loadForMeta(campaignId: string) {
  const a = admin();
  const { data: c, error } = await a
    .from("campaigns")
    .select(
      "id, organization_id, name, objective, destination, destination_url, locations, daily_budget_cents, total_budget_cents, starts_on, ends_on, external_ids, external_campaign_id, publish_key, status, spend_cents, ad_account_id",
    )
    .eq("id", campaignId)
    .single();
  if (error || !c) throw new Error("not_found");
  const { data: acc } = await a
    .from("ad_accounts")
    .select("external_id, page_id, whatsapp_number, token_ciphertext, status")
    .eq("id", c.ad_account_id)
    .single();
  if (!acc?.token_ciphertext || acc.status !== "connected") throw new Error("ad_account_not_connected");
  return { c, acc, token: decryptToken(acc.token_ciphertext) };
}

export async function runPublish(campaignId: string) {
  const a = admin();
  const { c, acc, token } = await loadForMeta(campaignId);
  if (c.status !== "publishing") return { ok: false as const, error: "invalid_status" };
  const { data: ads } = await a
    .from("campaign_ads")
    .select("position, primary_text, headline, description, cta, image_path")
    .eq("campaign_id", campaignId)
    .order("position");

  const payload: PublishCampaign = {
    ...c,
    external_ids: (c.external_ids ?? {}) as Record<string, string>,
    account: { external_id: acc.external_id, page_id: acc.page_id, whatsapp_number: acc.whatsapp_number, token },
    ads: ads ?? [],
  };
  const key = c.publish_key as string;
  return publishCampaign(payload, {
    progress: async (ids) => {
      const { error } = await a.rpc("campaign_publish_progress", { p_campaign: campaignId, p_publish_key: key, p_external_ids: ids });
      if (error) throw error;
    },
    imageBase64: async (path) => {
      const { data, error } = await a.storage.from(CREATIVES_BUCKET).download(path);
      if (error || !data) throw new Error("Não foi possível ler a imagem do anúncio.");
      return Buffer.from(await data.arrayBuffer()).toString("base64");
    },
    published: async (status, created) => {
      const { error } = await a.rpc("mark_campaign_published", {
        p_campaign: campaignId,
        p_publish_key: key,
        p_external_status: status,
        p_ads: created,
      });
      if (error) throw error;
    },
    failed: async (message, rejected) => {
      await a.rpc("mark_campaign_publish_failed", { p_campaign: campaignId, p_publish_key: key, p_error: message, p_rejected: rejected });
    },
  });
}

/** Pausa/retoma/termina na Meta e só depois confirma na base de dados. */
export async function applyStatusChange(campaignId: string, target: "paused" | "active" | "ended", actor: string) {
  const a = admin();
  const { c, token } = await loadForMeta(campaignId);
  if (!c.external_campaign_id) throw new Error("not_published");
  const meta = new MetaAds(token);
  await meta.setStatus(c.external_campaign_id, target === "active" ? "ACTIVE" : "PAUSED");
  const real = await meta.getCampaign(c.external_campaign_id);
  const status = target === "ended" ? "ended" : real.status === "ACTIVE" ? "active" : "paused";
  const { error } = await a.rpc("confirm_campaign_status", {
    p_campaign: campaignId,
    p_status: status,
    p_external_status: real.effective_status ?? real.status,
    p_actor: actor,
  });
  if (error) throw error;
  return status;
}

/**
 * Sincroniza estado e métricas de uma campanha. Se o orçamento total foi
 * atingido, pausa na Meta (proteção além do teto de gasto da própria Meta).
 */
export async function syncCampaign(campaignId: string) {
  const a = admin();
  const { c, token } = await loadForMeta(campaignId);
  if (!c.external_campaign_id || !["active", "paused"].includes(c.status)) return { skipped: true };
  const meta = new MetaAds(token);
  try {
    const real = await meta.getCampaign(c.external_campaign_id);
    const ads = await meta.getAdStatuses(c.external_campaign_id);
    const disapproved = ads.length > 0 && ads.every((x) => x.effective_status === "DISAPPROVED");
    const status = disapproved ? "rejected" : real.status === "ACTIVE" ? "active" : "paused";
    await a.rpc("confirm_campaign_status", {
      p_campaign: campaignId,
      p_status: status,
      p_external_status: real.effective_status ?? real.status,
      p_actor: null,
    });

    const until = new Date().toISOString().slice(0, 10);
    const since = c.starts_on > until ? until : c.starts_on;
    const rows = await meta.insights(c.external_campaign_id, since, until);
    const { data: rec } = await a.rpc("record_campaign_metrics", { p_campaign: campaignId, p_rows: rows });
    const alert = (rec as { alert?: string | null } | null)?.alert ?? null;
    if (alert === "budget_exhausted" && status === "active") {
      await meta.setStatus(c.external_campaign_id, "PAUSED");
      const after = await meta.getCampaign(c.external_campaign_id);
      await a.rpc("confirm_campaign_status", {
        p_campaign: campaignId,
        p_status: after.status === "ACTIVE" ? "active" : "paused",
        p_external_status: after.effective_status ?? after.status,
        p_actor: null,
      });
    }
    return { ok: true, alert, days: rows.length };
  } catch (err) {
    if (err instanceof MetaApiError && err.isAuth) {
      await a.from("ad_accounts").update({ status: "error", last_error: "Token expirado ou revogado. Volte a ligar a conta Meta." }).eq("id", c.ad_account_id);
    }
    throw err;
  }
}
