import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { buildSystemPrompt, detectMandatoryHandoff } from "./prompt";

export const CATEGORIES = ["general", "consultation", "complex", "urgent", "data_request"] as const;

export const decisionSchema = z.object({
  reply: z.string().max(1500),
  decision: z.enum(["answered", "asked", "handoff", "refused"]),
  category: z.enum(CATEGORIES),
  summary: z.string().max(1500),
  handoff_reason: z.string().max(300).optional().nullable(),
});

export type AgentDecision = z.infer<typeof decisionSchema>;

export type HistoryMessage = { author: "contact" | "ai" | "member" | "system"; body: string };

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * Aplica as regras determinísticas por cima da decisão do modelo:
 * se a última mensagem do contacto exige humano, a conversa é encaminhada.
 */
export function enforceSafety(decision: AgentDecision, lastContactText: string): AgentDecision {
  const mandatory = detectMandatoryHandoff(lastContactText);
  if (!mandatory || decision.decision === "handoff") return decision;
  return {
    ...decision,
    decision: "handoff",
    category: mandatory.includes("RGPD") ? "data_request" : "urgent",
    handoff_reason: mandatory,
    reply:
      "Obrigado. A sua situação precisa da atenção direta de um advogado do escritório, por isso vou passar já a conversa à equipa. Será contactado com a maior brevidade possível.",
  };
}

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Converte o histórico em mensagens alternadas user/assistant para o modelo. */
export function toModelMessages(history: HistoryMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of history) {
    if (m.author === "system") continue;
    const role = m.author === "contact" ? "user" : "assistant";
    const text = m.author === "member" ? `[Mensagem de um membro da equipa] ${m.body}` : m.body;
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${text}`;
    } else {
      out.push({ role, content: text });
    }
  }
  // O modelo tem de terminar com uma mensagem do contacto.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function runAgent(input: {
  officeName: string;
  history: HistoryMessage[];
}): Promise<{ decision: AgentDecision; model: string; inputTokens?: number; outputTokens?: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("agent_not_configured");
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });

  const messages = toModelMessages(input.history);
  if (!messages.length) throw new Error("no_contact_message");

  const res = await client.messages.create({
    model,
    max_tokens: 800,
    system: buildSystemPrompt({
      officeName: input.officeName,
      knowledgeBaseAvailable: false, // Fase 3
      nowIso: new Date().toISOString(),
    }),
    messages,
    tools: [
      {
        name: "responder",
        description: "Resposta ao contacto e classificação da conversa para a equipa.",
        input_schema: {
          type: "object",
          properties: {
            reply: { type: "string", description: "Mensagem a enviar ao contacto no WhatsApp." },
            decision: {
              type: "string",
              enum: ["answered", "asked", "handoff", "refused"],
              description: "asked = fizeste uma pergunta; answered = respondeste a algo geral; handoff = passar a humano; refused = pedido fora do âmbito.",
            },
            category: { type: "string", enum: [...CATEGORIES] },
            summary: { type: "string", description: "Resumo factual e atualizado da conversa para o advogado, sem opiniões." },
            handoff_reason: { type: "string", description: "Motivo do encaminhamento, se decision = handoff." },
          },
          required: ["reply", "decision", "category", "summary"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "responder" },
  });

  const block = res.content.find((b) => b.type === "tool_use");
  const parsed = decisionSchema.safeParse(block && "input" in block ? block.input : null);
  if (!parsed.success) throw new Error("agent_invalid_output");

  const lastContact = [...input.history].reverse().find((m) => m.author === "contact")?.body ?? "";
  return {
    decision: enforceSafety(parsed.data, lastContact),
    model,
    inputTokens: res.usage?.input_tokens,
    outputTokens: res.usage?.output_tokens,
  };
}
