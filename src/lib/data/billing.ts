import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PlanLimits = Partial<Record<"members" | "ai_replies_month" | "ad_generations_month" | "active_campaigns" | "knowledge_docs", number>>;

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  billing_interval: "month" | "year";
  stripe_price_id: string | null;
  limits: PlanLimits;
  features: string[];
  is_public: boolean;
  position: number;
};

export type BillingOverview = {
  plan: string;
  plan_name: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid";
  active: boolean;
  reason: "trial_expired" | "payment_overdue" | "subscription_inactive" | "no_subscription" | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  limits: PlanLimits;
  usage: {
    members: number;
    pending_invitations: number;
    ai_replies_month: number;
    ai_tokens_month: number;
    ad_generations_month: number;
    active_campaigns: number;
    knowledge_docs: number;
    month_start: string;
  };
};

export async function getBillingOverview(orgId: string): Promise<BillingOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_billing_overview", { p_org: orgId });
  if (error) throw error;
  return data as BillingOverview;
}

export async function listPlans(includeHidden = false): Promise<Plan[]> {
  const supabase = await createClient();
  let q = supabase
    .from("plans")
    .select("id, name, description, price_cents, currency, billing_interval, stripe_price_id, limits, features, is_public, position")
    .order("position");
  if (!includeHidden) q = q.eq("is_public", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function listInvoices(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, number, status, amount_due_cents, amount_paid_cents, currency, hosted_invoice_url, invoice_pdf, period_start, period_end, issued_at")
    .eq("organization_id", orgId)
    .order("issued_at", { ascending: false })
    .limit(36);
  return data ?? [];
}

export async function getStripeCustomerId(orgId: string): Promise<{ customer: string | null; subscription: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  return { customer: data?.stripe_customer_id ?? null, subscription: data?.stripe_subscription_id ?? null };
}

export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  members: "Membros da equipa",
  ai_replies_month: "Respostas da IA por mês",
  ad_generations_month: "Propostas de campanha pela IA por mês",
  active_campaigns: "Campanhas em curso",
  knowledge_docs: "Documentos na base jurídica do escritório",
};
