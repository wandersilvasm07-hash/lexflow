import { NextResponse, type NextRequest } from "next/server";
import { getStripe, handleStripeEvent, isStripeConfigured } from "@/lib/billing/stripe";
import { supabaseBillingStore } from "@/lib/billing/store";
import { getAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook do Stripe. Só aceita eventos com assinatura válida; cada evento é
 * aplicado uma única vez. Em caso de erro devolve 500 para o Stripe repetir
 * (a repetição é segura porque o registo do evento só fica se tudo correu bem
 * ou se o evento já tinha sido aplicado).
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const admin = getAdminClient();
  if (!admin) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const stripe = getStripe();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event, supabaseBillingStore(admin), (id) => stripe.subscriptions.retrieve(id));
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error("[stripe] evento falhou", event.type, event.id, (err as Error).message);
    // Permite que o Stripe repita: anula o registo do evento.
    await admin.from("billing_events").delete().eq("event_id", event.id);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
