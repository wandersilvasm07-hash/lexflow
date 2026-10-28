import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { handleStripeEvent } = await import("./stripe");
type Store = Parameters<typeof handleStripeEvent>[1];

function fakeStore() {
  const seen = new Set<string>();
  const calls: { kind: string; args: unknown }[] = [];
  const store: Store = {
    registerEvent: async (id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    setCustomer: async (org, customer) => void calls.push({ kind: "customer", args: { org, customer } }),
    syncSubscription: async (s) => void calls.push({ kind: "sync", args: s }),
    recordInvoice: async (i) => void calls.push({ kind: "invoice", args: i }),
  };
  return { store, calls };
}

const sub = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { org: "org-1" },
    items: { data: [{ price: { id: "price_Pro" }, current_period_end: 1_800_000_000 }] },
    ...over,
  }) as unknown as Stripe.Subscription;

const event = (type: string, object: unknown, id = `evt_${Math.random()}`) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

describe("webhook do Stripe", () => {
  it("checkout concluído: liga o cliente ao escritório e lê a subscrição atual", async () => {
    const { store, calls } = fakeStore();
    const retrieve = vi.fn(async () => sub({ status: "trialing" }));
    const r = await handleStripeEvent(
      event("checkout.session.completed", { client_reference_id: "org-1", customer: "cus_1", subscription: "sub_1", metadata: {} }),
      store,
      retrieve,
    );
    expect(r).toBe("applied");
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(calls).toEqual([
      { kind: "customer", args: { org: "org-1", customer: "cus_1" } },
      {
        kind: "sync",
        args: {
          customer: "cus_1",
          subscription: "sub_1",
          price: "price_Pro",
          status: "trialing",
          periodEnd: new Date(1_800_000_000_000).toISOString(),
          cancelAtPeriodEnd: false,
          org: "org-1",
        },
      },
    ]);
  });

  it("o mesmo evento entregue duas vezes só é aplicado uma vez", async () => {
    const { store, calls } = fakeStore();
    const e = event("customer.subscription.updated", sub(), "evt_dup");
    expect(await handleStripeEvent(e, store, async () => sub())).toBe("applied");
    expect(await handleStripeEvent(e, store, async () => sub())).toBe("duplicate");
    expect(calls).toHaveLength(1);
  });

  it("cancelamento agendado é registado; eventos desconhecidos são ignorados", async () => {
    const { store, calls } = fakeStore();
    await handleStripeEvent(event("customer.subscription.updated", sub()), store, async () => sub({ cancel_at_period_end: true }));
    expect((calls[0].args as { cancelAtPeriodEnd: boolean }).cancelAtPeriodEnd).toBe(true);
    expect(await handleStripeEvent(event("charge.refunded", {}), store, async () => sub())).toBe("ignored");
  });

  it("faturas: guarda número, valores e ligações do Stripe (sem dados de cartão)", async () => {
    const { store, calls } = fakeStore();
    await handleStripeEvent(
      event("invoice.paid", {
        id: "in_1",
        customer: "cus_1",
        number: "A-001",
        status: "paid",
        amount_due: 9900,
        amount_paid: 9900,
        currency: "eur",
        hosted_invoice_url: "https://invoice.stripe.com/i/x",
        invoice_pdf: "https://pay.stripe.com/invoice/x/pdf",
        period_start: 1_800_000_000,
        period_end: 1_802_592_000,
      }),
      store,
      async () => sub(),
    );
    expect(calls[0]).toMatchObject({ kind: "invoice", args: { invoice: "in_1", number: "A-001", amountPaid: 9900 } });
    expect(JSON.stringify(calls)).not.toMatch(/card|last4|cvc/i);
  });

  it("a assinatura do webhook é verificada (alterar o conteúdo invalida-a)", () => {
    const stripe = new Stripe("sk_test_x");
    const secret = "whsec_teste";
    const payload = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe("evt_1");
    expect(() => stripe.webhooks.constructEvent(payload.replace("evt_1", "evt_2"), header, secret)).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_outro")).toThrow();
  });
});
