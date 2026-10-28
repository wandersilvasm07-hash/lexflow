import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingStore } from "./stripe";

/** Implementação real do BillingStore (chave de serviço; só no servidor). */
export function supabaseBillingStore(admin: SupabaseClient): BillingStore {
  const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    registerEvent: async (id, type) => Boolean(await must(admin.rpc("billing_register_event", { p_event_id: id, p_type: type }))),
    setCustomer: async (org, customer) => {
      await must(admin.rpc("billing_set_customer", { p_org: org, p_customer: customer }));
    },
    syncSubscription: async (s) => {
      await must(
        admin.rpc("billing_sync_subscription", {
          p_customer: s.customer,
          p_subscription: s.subscription,
          p_price: s.price,
          p_status: s.status,
          p_period_end: s.periodEnd,
          p_cancel_at_period_end: s.cancelAtPeriodEnd,
          p_org: s.org,
        }),
      );
    },
    recordInvoice: async (i) => {
      await must(
        admin.rpc("billing_record_invoice", {
          p_customer: i.customer,
          p_invoice: i.invoice,
          p_number: i.number,
          p_status: i.status,
          p_amount_due: i.amountDue,
          p_amount_paid: i.amountPaid,
          p_currency: i.currency,
          p_hosted_url: i.hostedUrl,
          p_pdf: i.pdf,
          p_period_start: i.periodStart,
          p_period_end: i.periodEnd,
        }),
      );
    },
  };
}
