import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { CampaignStatus, Destination, Objective } from "@/lib/ads/constants";
import type { ComplianceResult } from "@/lib/ads/compliance";
import type { CampaignPlan } from "@/lib/ads/generate";
import { CREATIVES_BUCKET } from "@/lib/ads/service";

export type BudgetSettings = {
  max_daily_cents: number;
  max_campaign_total_cents: number;
  max_all_daily_cents: number;
  alert_pct: number;
  updated_at: string;
};

export type AdAccount = {
  id: string;
  external_id: string;
  name: string | null;
  currency: string;
  page_id: string | null;
  whatsapp_number: string | null;
  status: "connected" | "error" | "disconnected";
  token_expires_at: string | null;
  last_error: string | null;
  connected_at: string;
};

export type Campaign = {
  id: string;
  name: string;
  service_id: string | null;
  service_label: string;
  objective: Objective;
  destination: Destination;
  destination_url: string | null;
  locations: string[];
  languages: string[];
  audience_notes: string | null;
  daily_budget_cents: number;
  total_budget_cents: number;
  starts_on: string;
  ends_on: string | null;
  plan: Partial<Omit<CampaignPlan, "variantes">>;
  plan_model: string | null;
  plan_generated_at: string | null;
  compliance: Partial<ComplianceResult>;
  compliance_hash: string | null;
  status: CampaignStatus;
  approval_id: string | null;
  external_campaign_id: string | null;
  external_status: string | null;
  last_error: string | null;
  spend_cents: number;
  last_synced_at: string | null;
  alert_sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignAd = {
  id: string;
  position: number;
  primary_text: string;
  headline: string;
  description: string | null;
  cta: string;
  image_brief: string | null;
  image_path: string | null;
  external_ad_id: string | null;
};

const CAMPAIGN_FIELDS =
  "id, name, service_id, service_label, objective, destination, destination_url, locations, languages, audience_notes, daily_budget_cents, total_budget_cents, starts_on, ends_on, plan, plan_model, plan_generated_at, compliance, compliance_hash, status, approval_id, external_campaign_id, external_status, last_error, spend_cents, last_synced_at, alert_sent_at, created_at, updated_at";

export async function getBudgetSettings(orgId: string): Promise<BudgetSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_budget_settings")
    .select("max_daily_cents, max_campaign_total_cents, max_all_daily_cents, alert_pct, updated_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as BudgetSettings | null) ?? null;
}

export async function getAdAccount(orgId: string): Promise<AdAccount | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_accounts")
    .select("id, external_id, name, currency, page_id, whatsapp_number, status, token_expires_at, last_error, connected_at")
    .eq("organization_id", orgId)
    .neq("status", "disconnected")
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AdAccount | null) ?? null;
}

export async function listCampaigns(orgId: string, includeArchived = false) {
  const supabase = await createClient();
  let q = supabase
    .from("campaigns")
    .select("id, name, service_label, objective, status, daily_budget_cents, total_budget_cents, spend_cents, starts_on, ends_on, updated_at")
    .eq("organization_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (!includeArchived) q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Pick<
    Campaign,
    "id" | "name" | "service_label" | "objective" | "status" | "daily_budget_cents" | "total_budget_cents" | "spend_cents" | "starts_on" | "ends_on" | "updated_at"
  >[];
}

export async function getCampaign(orgId: string, id: string) {
  const supabase = await createClient();
  const [{ data: c }, { data: ads }, { data: events }, { data: metrics }, { data: hash }, { data: approval }] = await Promise.all([
    supabase.from("campaigns").select(CAMPAIGN_FIELDS).eq("organization_id", orgId).eq("id", id).maybeSingle(),
    supabase
      .from("campaign_ads")
      .select("id, position, primary_text, headline, description, cta, image_brief, image_path, external_ad_id")
      .eq("campaign_id", id)
      .order("position"),
    supabase.from("campaign_events").select("id, kind, details, actor_user_id, created_at").eq("campaign_id", id).order("id", { ascending: false }).limit(100),
    supabase
      .from("campaign_metrics_daily")
      .select("day, impressions, reach, clicks, conversations_started, leads, spend_cents, fetched_at")
      .eq("campaign_id", id)
      .order("day"),
    supabase.rpc("campaign_content_hash", { p_campaign: id }),
    supabase.from("campaign_approvals").select("id, approved_by, approved_at, statement, daily_budget_cents, total_budget_cents, revoked_at").eq("campaign_id", id).order("approved_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!c) return null;
  return {
    campaign: c as Campaign,
    ads: (ads ?? []) as CampaignAd[],
    events: (events ?? []) as { id: number; kind: string; details: Record<string, unknown>; actor_user_id: string | null; created_at: string }[],
    metrics: (metrics ?? []) as {
      day: string;
      impressions: number;
      reach: number;
      clicks: number;
      conversations_started: number;
      leads: number;
      spend_cents: number;
      fetched_at: string;
    }[],
    contentHash: (hash as string | null) ?? null,
    lastApproval: approval as {
      id: string;
      approved_by: string;
      approved_at: string;
      statement: string;
      daily_budget_cents: number;
      total_budget_cents: number;
      revoked_at: string | null;
    } | null,
  };
}

/** Endereços temporários (10 min) das imagens privadas, só para quem já pode ver a campanha. */
export async function signedImageUrls(paths: (string | null)[]): Promise<Record<string, string>> {
  const admin = getAdminClient();
  const list = paths.filter((p): p is string => Boolean(p));
  if (!admin || !list.length) return {};
  const { data } = await admin.storage.from(CREATIVES_BUCKET).createSignedUrls(list, 600);
  const out: Record<string, string> = {};
  for (const item of data ?? []) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export type MarketingReport = {
  from: string;
  to: string;
  generated_at: string;
  campaigns: {
    id: string;
    name: string;
    status: CampaignStatus;
    impressions: number;
    reach_sum_daily: number;
    clicks: number;
    conversations_started: number;
    leads: number;
    spend_cents: number;
    last_fetched_at: string | null;
    contacts_attributed: number;
    contacts_qualified: number;
    appointments_booked: number;
  }[];
  contacts_from_ads_unattributed: number;
};

export async function getMarketingReport(orgId: string, from: string, to: string): Promise<MarketingReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("marketing_report", { p_org: orgId, p_from: from, p_to: to });
  if (error) throw error;
  return data as MarketingReport;
}
