import "server-only";
import Stripe from "stripe";

/**
 * Pagamentos com Stripe. O Patrono nunca vê nem guarda dados de cartão:
 * a subscrição é feita no Checkout do Stripe e gerida no Portal do Cliente
 * (mudar de plano, cancelar, métodos de pagamento, faturas).
 * O estado só muda pelo webhook, com assinatura verificada.
 */

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

let cached: Stripe | null = null;
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("billing_not_configured");
  cached ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return cached;
}

/** Operações do servidor sobre a base de dados (injetadas para testes). */
export type BillingStore = {
  registerEvent(id: string, type: string): Promise<boolean>;
  setCustomer(org: string, customer: string): Promise<void>;
  syncSubscription(s: {
    customer: string;
    subscription: string;
    price: string;
    status: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    org: string | null;
  }): Promise<void>;
  recordInvoice(i: {
    customer: string;
    invoice: string;
    number: string | null;
    status: string;
    amountDue: number;
    amountPaid: number;
    currency: string;
    hostedUrl: string | null;
    pdf: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  }): Promise<void>;
};

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));
const iso = (secs: number | null | undefined) => (secs ? new Date(secs * 1000).toISOString() : null);

function subscriptionPayload(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const customer = idOf(sub.customer);
  if (!item?.price?.id || !customer) throw new Error("subscription_without_price");
  return {
    customer,
    subscription: sub.id,
    price: item.price.id,
    status: sub.status,
    periodEnd: iso(item.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || Boolean(sub.cancel_at),
    org: typeof sub.metadata?.org === "string" ? sub.metadata.org : null,
  };
}

/**
 * Aplica um evento do Stripe. Idempotente: um evento já registado é ignorado.
 * Devolve o que foi feito (para registo/testes).
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  store: BillingStore,
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>,
): Promise<"duplicate" | "ignored" | "applied"> {
  const handled = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.finalized",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.voided",
  ];
  if (!handled.includes(event.type)) return "ignored";
  if (!(await store.registerEvent(event.id, event.type))) return "duplicate";

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object as Stripe.Checkout.Session;
      const org = s.client_reference_id ?? s.metadata?.org ?? null;
      const customer = idOf(s.customer);
      const subId = idOf(s.subscription);
      if (!org || !customer || !subId) return "ignored";
      await store.setCustomer(org, customer);
      // Lê o estado atual (o objeto do evento pode estar desatualizado).
      await store.syncSubscription({ ...subscriptionPayload(await retrieveSubscription(subId)), org });
      return "applied";
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const fresh = event.type === "customer.subscription.deleted" ? sub : await retrieveSubscription(sub.id);
      await store.syncSubscription(subscriptionPayload(fresh));
      return "applied";
    }
    default: {
      const inv = event.data.object as Stripe.Invoice;
      const customer = idOf(inv.customer);
      if (!customer || !inv.id) return "ignored";
      await store.recordInvoice({
        customer,
        invoice: inv.id,
        number: inv.number ?? null,
        status: inv.status ?? "open",
        amountDue: inv.amount_due ?? 0,
        amountPaid: inv.amount_paid ?? 0,
        currency: inv.currency ?? "eur",
        hostedUrl: inv.hosted_invoice_url ?? null,
        pdf: inv.invoice_pdf ?? null,
        periodStart: iso(inv.period_start),
        periodEnd: iso(inv.period_end),
      });
      return "applied";
    }
  }
}
