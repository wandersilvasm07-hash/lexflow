import { createHash } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { processConversation } from "@/lib/conversations/process";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseWebhook, verifySignature } from "@/lib/whatsapp/webhook";

/**
 * Webhook da WhatsApp Business Platform.
 *  GET  — verificação da subscrição (hub.challenge).
 *  POST — mensagens recebidas e estados de entrega.
 * Responde rápido (a Meta repete se demorar) e processa a IA depois, com after().
 */

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const admin = getAdminClient();
  if (!appSecret || !admin) {
    // Integração não configurada: nunca fingimos que processámos.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const hash = createHash("sha256").update(raw).digest("hex");
  const { data: isNew, error: regErr } = await admin.rpc("register_webhook_event", {
    p_provider: "whatsapp",
    p_event_id: hash,
    p_payload_hash: hash,
  });
  if (regErr) return NextResponse.json({ error: "storage_error" }, { status: 500 });
  if (!isNew) return NextResponse.json({ ok: true, duplicate: true });

  const { messages, statuses } = parseWebhook(payload);
  const toReply: string[] = [];

  for (const m of messages) {
    const { data, error } = await admin
      .rpc("ingest_inbound_message", {
        p_phone_number_id: m.phoneNumberId,
        p_from_e164: m.fromE164,
        p_provider_message_id: m.providerMessageId,
        p_body: m.body,
        p_sent_at: m.sentAt.toISOString(),
        p_profile_name: m.profileName,
      })
      .single<{ conversation_id: string; duplicate: boolean; agent_should_reply: boolean }>();
    if (error) {
      console.error("[webhook] ingestão falhou", error.message);
      // 500 faz a Meta reenviar; a idempotência por id de mensagem evita duplicados.
      return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
    }
    if (data?.agent_should_reply && m.supported) toReply.push(data.conversation_id);
  }

  for (const s of statuses) {
    await admin.rpc("update_message_status", {
      p_provider_message_id: s.providerMessageId,
      p_status: s.status,
      p_error_code: s.errorCode,
    });
  }

  if (toReply.length) {
    after(async () => {
      for (const id of new Set(toReply)) await processConversation(id);
    });
  }

  await admin.from("webhook_events").update({ processed_at: new Date().toISOString() }).eq("event_id", hash);
  return NextResponse.json({ ok: true });
}
