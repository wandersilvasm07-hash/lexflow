"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { orgAction } from "@/lib/auth/action";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";
import type { ActionResult } from "@/lib/errors";
import { getAppUrl } from "@/lib/env";
import { getStripeCustomerId, listPlans } from "@/lib/data/billing";
import { getAdminClient } from "@/lib/supabase/admin";

const NOT_CONFIGURED = "Os pagamentos ainda não estão configurados nesta instalação do Patrono.";

/** Abre o Checkout do Stripe para subscrever um plano (só sem subscrição paga). */
export async function startCheckoutAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "billing.manage", async (ctx) => {
    if (!isStripeConfigured()) return { ok: false, error: NOT_CONFIGURED };
    const planId = z.string().regex(/^[a-z0-9_-]{2,40}$/).parse(form.get("plan"));
    const plan = (await listPlans()).find((p) => p.id === planId);
    if (!plan?.stripe_price_id) return { ok: false, error: "Este plano ainda não está disponível para subscrição." };

    const ids = await getStripeCustomerId(ctx.org.id);
    if (ids.subscription) return { ok: false, error: "O escritório já tem uma subscrição. Use “Gerir subscrição” para mudar de plano." };

    const stripe = getStripe();
    const admin = getAdminClient();
    if (!admin) return { ok: false, error: NOT_CONFIGURED };
    let customer = ids.customer;
    if (!customer) {
      const c = await stripe.customers.create(
        { name: ctx.org.legal_name ?? ctx.org.name, email: ctx.org.email ?? ctx.user.email, metadata: { org: ctx.org.id } },
        { idempotencyKey: `customer-${ctx.org.id}` },
      );
      const { error } = await admin.rpc("billing_set_customer", { p_org: ctx.org.id, p_customer: c.id });
      if (error) throw error;
      customer = c.id;
    }
    const base = `${getAppUrl()}/app/${ctx.org.slug}/faturacao`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: ctx.org.id,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      subscription_data: { metadata: { org: ctx.org.id } },
      metadata: { org: ctx.org.id },
      tax_id_collection: { enabled: true },
      customer_update: { name: "auto", address: "auto" },
      billing_address_collection: "required",
      locale: "pt",
      success_url: `${base}?checkout=ok`,
      cancel_url: `${base}?checkout=cancelado`,
    });
    if (!session.url) return { ok: false, error: "O Stripe não devolveu a página de pagamento. Tente de novo." };
    target = session.url;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}

/** Portal do Cliente do Stripe: mudar de plano, cancelar, pagamento e faturas. */
export async function openPortalAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  let target: string | null = null;
  const result = await orgAction<undefined>(form, "billing.manage", async (ctx) => {
    if (!isStripeConfigured()) return { ok: false, error: NOT_CONFIGURED };
    const { customer } = await getStripeCustomerId(ctx.org.id);
    if (!customer) return { ok: false, error: "Ainda não há subscrição paga. Escolha primeiro um plano." };
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      locale: "pt",
      return_url: `${getAppUrl()}/app/${ctx.org.slug}/faturacao`,
    });
    target = session.url;
    return { ok: true };
  });
  if (result.ok && target) redirect(target);
  return result;
}
