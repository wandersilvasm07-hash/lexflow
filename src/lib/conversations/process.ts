import "server-only";
import { runAgent, isAgentConfigured, type HistoryMessage } from "@/lib/agent/run";
import { getAdminClient } from "@/lib/supabase/admin";
import { providerFor, WhatsAppApiError } from "@/lib/whatsapp/provider";

/**
 * Pipeline do assistente para uma conversa (corre no servidor, sem utilizador):
 *   histórico → modelo → record_ai_reply (recusa se um humano assumiu) → envio.
 * Falhas nunca deixam a conversa sem dono: se a IA falhar, é encaminhada.
 */
export async function processConversation(conversationId: string): Promise<
  { ok: true; skipped?: string } | { ok: false; error: string }
> {
  const admin = getAdminClient();
  if (!admin) return { ok: true, skipped: "no_service_key" };
  if (!isAgentConfigured()) return { ok: true, skipped: "no_ai_key" };

  const { data: conv, error } = await admin
    .from("conversations")
    .select("id, mode, status, organization_id, contact_id, whatsapp_account_id, organizations(name), contacts(phone_e164)")
    .eq("id", conversationId)
    .single();
  if (error || !conv) return { ok: false, error: "conversation_not_found" };
  if (conv.mode !== "ai" || conv.status === "closed") return { ok: true, skipped: "not_ai_mode" };

  const { data: msgs } = await admin
    .from("messages")
    .select("author, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(30);
  const history: HistoryMessage[] = (msgs ?? [])
    .reverse()
    .filter((m) => m.body)
    .map((m) => ({ author: m.author as HistoryMessage["author"], body: m.body as string }));

  const officeName = (conv.organizations as unknown as { name: string } | null)?.name ?? "o escritório";

  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    result = await runAgent({ officeName, history });
  } catch (err) {
    // Sem resposta da IA: passa a humanos, sem mensagem automática.
    await admin.rpc("record_ai_reply", {
      p_conversation: conversationId,
      p_body: null,
      p_model: process.env.ANTHROPIC_MODEL ?? "desconhecido",
      p_decision: "handoff",
      p_handoff_reason: "O assistente automático não conseguiu responder; precisa de atenção da equipa.",
    });
    console.error("[agent] falhou", (err as Error).message);
    return { ok: false, error: "agent_failed" };
  }

  const d = result.decision;
  const { data: messageId, error: recErr } = await admin.rpc("record_ai_reply", {
    p_conversation: conversationId,
    p_body: d.reply,
    p_model: result.model,
    p_decision: d.decision,
    p_category: d.category,
    p_sources: [],
    p_summary: d.summary,
    p_handoff_reason: d.handoff_reason ?? null,
    p_input_tokens: result.inputTokens ?? null,
    p_output_tokens: result.outputTokens ?? null,
  });
  if (recErr) {
    // Ex.: um profissional assumiu entretanto — correto não responder.
    return recErr.message.includes("conversation_taken_over")
      ? { ok: true, skipped: "taken_over" }
      : { ok: false, error: recErr.message };
  }
  if (!messageId) return { ok: true };

  return deliverMessage(messageId as string);
}

/** Envia uma mensagem já gravada como "queued" e regista o resultado. */
export async function deliverMessage(messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = getAdminClient();
  if (!admin) return { ok: false, error: "no_service_key" };

  const { data: msg } = await admin
    .from("messages")
    .select("id, body, status, conversations(whatsapp_account_id, contacts(phone_e164), whatsapp_accounts(mode, phone_number_id))")
    .eq("id", messageId)
    .single();
  if (!msg || msg.status !== "queued") return { ok: true };

  const conv = msg.conversations as unknown as {
    contacts: { phone_e164: string | null } | null;
    whatsapp_accounts: { mode: string; phone_number_id: string | null } | null;
  } | null;
  const account = conv?.whatsapp_accounts;
  const to = conv?.contacts?.phone_e164;
  const provider = account ? providerFor(account) : null;
  if (!provider || !to) {
    await admin.rpc("mark_message_failed", { p_message: messageId, p_error_code: "not_configured" });
    return { ok: false, error: "whatsapp_not_configured" };
  }

  try {
    const { providerMessageId } = await provider.sendText(to, msg.body ?? "");
    await admin.rpc("mark_message_sent", { p_message: messageId, p_provider_message_id: providerMessageId });
    return { ok: true };
  } catch (err) {
    const code = err instanceof WhatsAppApiError ? err.code : "unknown";
    await admin.rpc("mark_message_failed", { p_message: messageId, p_error_code: code });
    return { ok: false, error: `send_failed_${code}` };
  }
}
