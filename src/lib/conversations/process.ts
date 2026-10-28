import "server-only";
import { runAgent, isAgentConfigured, type BookingResult, type FreeSlot, type HistoryMessage, type KnowledgeHit } from "@/lib/agent/run";
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
    .select("id, mode, status, organization_id, contact_id, whatsapp_account_id, organizations(name, timezone), contacts(phone_e164)")
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

  const office = conv.organizations as unknown as { name: string; timezone: string } | null;
  const officeName = office?.name ?? "o escritório";

  // Limite do plano / subscrição: sem margem, a conversa passa à equipa sem chamar a IA.
  const { data: ent } = await admin.rpc("agent_entitlement", { p_org: conv.organization_id });
  const entitlement = ent as { allowed: boolean; reason?: string } | null;
  if (entitlement && !entitlement.allowed) {
    await admin.rpc("record_ai_reply", {
      p_conversation: conversationId,
      p_body: null,
      p_model: "nenhum",
      p_decision: "handoff",
      p_handoff_reason:
        entitlement.reason === "plan_limit:ai_replies_month"
          ? "Limite mensal de respostas da IA do plano atingido: responda pela caixa de entrada."
          : "Subscrição inativa: o assistente de IA está em pausa. Responda pela caixa de entrada.",
    });
    return { ok: true, skipped: entitlement.reason ?? "not_entitled" };
  }

  let result: Awaited<ReturnType<typeof runAgent>>;
  try {
    result = await runAgent({
      officeName,
      history,
      // Só fontes aprovadas, em vigor e com revisão em dia (filtro na base de dados).
      search: async (query) => {
        const { data, error: searchErr } = await admin.rpc("agent_search_knowledge", {
          p_org: conv.organization_id,
          p_query: query,
          p_limit: 6,
        });
        if (searchErr) throw searchErr;
        return (data ?? []) as KnowledgeHit[];
      },
      // Agenda real: só horários livres; a marcação é gravada antes de ser anunciada.
      scheduling: {
        timezone: office?.timezone ?? "Europe/Lisbon",
        freeSlots: async () => {
          const { data, error: slotsErr } = await admin.rpc("agent_free_slots", {
            p_org: conv.organization_id,
            p_limit: 6,
          });
          if (slotsErr) throw slotsErr;
          return (data ?? []) as FreeSlot[];
        },
        book: async (serviceId, startsAt, fullName) => {
          const { data, error: bookErr } = await admin
            .rpc("agent_book_appointment", {
              p_conversation: conversationId,
              p_service: serviceId,
              p_starts_at: startsAt,
              p_full_name: fullName,
            })
            .single<BookingResult>();
          if (bookErr || !data) throw bookErr ?? new Error("booking_failed");
          return data;
        },
      },
    });
  } catch (err) {
    // Sem resposta da IA: passa a humanos, sem mensagem automática.
    await admin.rpc("record_ai_reply", {
      p_conversation: conversationId,
      p_body: null,
      p_model: process.env.ANTHROPIC_MODEL ?? "desconhecido",
      p_decision: "handoff",
      p_handoff_reason: "O assistente de IA não conseguiu responder; precisa de atenção da equipa.",
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
    p_sources: result.sources,
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
