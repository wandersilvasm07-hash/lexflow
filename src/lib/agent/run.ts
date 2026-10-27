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
  fontes: z.array(z.string().max(10)).max(20).optional().default([]),
});

export type AgentDecision = z.infer<typeof decisionSchema>;

export type HistoryMessage = { author: "contact" | "ai" | "member" | "system"; body: string };

/** Secção devolvida pela pesquisa na base jurídica (aprovada e em vigor). */
export type KnowledgeHit = {
  chunk_id: string;
  document_id: string;
  title: string;
  heading: string | null;
  content: string;
  scope: "common" | "private";
  version: number;
  source_name: string | null;
  source_url: string | null;
  last_verified_on: string | null;
};

/** Registo guardado em agent_runs.sources: o que foi consultado e o que foi citado. */
export type SourceRecord = {
  ref: string;
  document_id: string;
  chunk_id: string;
  title: string;
  version: number;
  scope: "common" | "private";
  source_url: string | null;
  query: string;
  cited: boolean;
};

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const MAX_SEARCHES = 3;

export const SAFE_HANDOFF_REPLY =
  "Obrigado pela sua mensagem. Para lhe dar uma resposta correta, vou passar a conversa a um advogado do escritório, que entrará em contacto consigo com a maior brevidade possível.";

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

/**
 * A IA não pode inventar fontes: cada identificador citado tem de corresponder
 * a uma secção efetivamente devolvida pela pesquisa nesta execução. Se citar
 * algo que não recebeu, a resposta é descartada e a conversa encaminhada.
 */
export function enforceSources(decision: AgentDecision, retrieved: ReadonlyMap<string, unknown>): AgentDecision {
  const cited = decision.fontes ?? [];
  const invented = cited.filter((ref) => !retrieved.has(ref));
  if (invented.length === 0) return decision;
  return {
    ...decision,
    decision: "handoff",
    fontes: cited.filter((ref) => retrieved.has(ref)),
    reply: SAFE_HANDOFF_REPLY,
    handoff_reason: "O assistente citou uma fonte que não consultou; a resposta foi bloqueada para revisão humana.",
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

/** Formata as secções encontradas para o modelo, com identificadores estáveis. */
export function formatHits(hits: { ref: string; hit: KnowledgeHit }[]): string {
  if (!hits.length) {
    return "Nenhuma fonte aprovada e em vigor encontrada para esta pesquisa. Não respondas ao conteúdo jurídico: encaminha.";
  }
  return hits
    .map(({ ref, hit }) =>
      [
        `[${ref}] ${hit.title}${hit.heading ? ` — ${hit.heading}` : ""}`,
        `Fonte: ${hit.source_name ?? hit.source_url ?? "não indicada"} | versão ${hit.version}${
          hit.last_verified_on ? ` | verificado em ${hit.last_verified_on}` : ""
        } | ${hit.scope === "common" ? "base comum" : "documento do escritório"}`,
        hit.content,
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}

const RESPONDER_TOOL: Anthropic.Tool = {
  name: "responder",
  description: "Resposta ao contacto e classificação da conversa para a equipa.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Mensagem a enviar ao contacto no WhatsApp." },
      decision: {
        type: "string",
        enum: ["answered", "asked", "handoff", "refused"],
        description:
          "asked = fizeste uma pergunta; answered = respondeste com base em fontes ou a algo geral não jurídico; handoff = passar a humano; refused = pedido fora do âmbito.",
      },
      category: { type: "string", enum: [...CATEGORIES] },
      summary: { type: "string", description: "Resumo factual e atualizado da conversa para o advogado, sem opiniões." },
      handoff_reason: { type: "string", description: "Motivo do encaminhamento, se decision = handoff." },
      fontes: {
        type: "array",
        items: { type: "string" },
        description: "Identificadores (F1, F2, …) das secções da base jurídica em que a resposta se baseia. Vazio se não usaste nenhuma.",
      },
    },
    required: ["reply", "decision", "category", "summary"],
  },
};

const SEARCH_TOOL: Anthropic.Tool = {
  name: "pesquisar_base_juridica",
  description:
    "Pesquisa nas fontes jurídicas aprovadas e em vigor (base comum e documentos do escritório). Usa palavras-chave em português, ex.: 'reagrupamento familiar requisitos'.",
  input_schema: {
    type: "object",
    properties: { consulta: { type: "string", description: "Palavras-chave da pesquisa." } },
    required: ["consulta"],
  },
};

type MessagesClient = { messages: { create: Anthropic["messages"]["create"] } };

export async function runAgent(input: {
  officeName: string;
  history: HistoryMessage[];
  /** Pesquisa na base jurídica. Sem ela, o assistente não dá respostas jurídicas substantivas. */
  search?: (query: string) => Promise<KnowledgeHit[]>;
  client?: MessagesClient;
}): Promise<{
  decision: AgentDecision;
  model: string;
  sources: SourceRecord[];
  inputTokens?: number;
  outputTokens?: number;
}> {
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  let client = input.client;
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("agent_not_configured");
    client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 2 });
  }

  const messages = toModelMessages(input.history);
  if (!messages.length) throw new Error("no_contact_message");

  const system = buildSystemPrompt({
    officeName: input.officeName,
    knowledgeBaseAvailable: Boolean(input.search),
    nowIso: new Date().toISOString(),
  });

  const retrieved = new Map<string, { hit: KnowledgeHit; query: string }>();
  const byChunk = new Map<string, string>();
  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let decision: AgentDecision | null = null;

  for (let turn = 0; turn < MAX_SEARCHES + 2 && !decision; turn++) {
    const canSearch = Boolean(input.search) && searches < MAX_SEARCHES;
    const res = await client.messages.create({
      model,
      max_tokens: 900,
      system,
      messages,
      tools: canSearch ? [SEARCH_TOOL, RESPONDER_TOOL] : [RESPONDER_TOOL],
      tool_choice: canSearch ? { type: "any" } : { type: "tool", name: "responder" },
    });
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const responder = toolUses.find((b) => b.name === "responder");
    if (responder) {
      const parsed = decisionSchema.safeParse(responder.input);
      if (!parsed.success) throw new Error("agent_invalid_output");
      decision = parsed.data;
      break;
    }

    const searchCalls = toolUses.filter((b) => b.name === "pesquisar_base_juridica");
    if (!searchCalls.length || !input.search) throw new Error("agent_invalid_output");

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of searchCalls) {
      searches++;
      const query = String((call.input as { consulta?: unknown })?.consulta ?? "").slice(0, 300);
      let hits: KnowledgeHit[] = [];
      try {
        hits = query.trim().length >= 2 ? await input.search(query) : [];
      } catch (err) {
        console.error("[agent] pesquisa falhou", (err as Error).message);
        hits = [];
      }
      const numbered = hits.map((hit) => {
        let ref = byChunk.get(hit.chunk_id);
        if (!ref) {
          ref = `F${retrieved.size + 1}`;
          byChunk.set(hit.chunk_id, ref);
          retrieved.set(ref, { hit, query });
        }
        return { ref, hit };
      });
      results.push({ type: "tool_result", tool_use_id: call.id, content: formatHits(numbered) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!decision) throw new Error("agent_invalid_output");

  const lastContact = [...input.history].reverse().find((m) => m.author === "contact")?.body ?? "";
  const checked = enforceSafety(enforceSources(decision, retrieved), lastContact);
  const cited = new Set(checked.fontes ?? []);

  const sources: SourceRecord[] = [...retrieved.entries()].map(([ref, { hit, query }]) => ({
    ref,
    document_id: hit.document_id,
    chunk_id: hit.chunk_id,
    title: hit.title,
    version: hit.version,
    scope: hit.scope,
    source_url: hit.source_url,
    query,
    cited: cited.has(ref),
  }));

  return { decision: checked, model, sources, inputTokens, outputTokens };
}
