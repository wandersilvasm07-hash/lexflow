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

/** Horário livre devolvido pela base de dados (já filtrado: serviço ativo, sem sobreposições). */
export type FreeSlot = { service_id: string; service_name: string; starts_at: string; ends_at: string };

export type BookingResult = {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  professional_name: string;
  service_name: string;
};

export type Scheduling = {
  timezone: string;
  freeSlots: () => Promise<FreeSlot[]>;
  book: (serviceId: string, startsAt: string, fullName: string | null) => Promise<BookingResult>;
};

const SLOTS_TOOL: Anthropic.Tool = {
  name: "ver_horarios_livres",
  description:
    "Mostra os próximos horários realmente livres para uma consulta no escritório. Devolve identificadores (H1, H2, …) válidos só nesta resposta.",
  input_schema: { type: "object", properties: {} },
};

const BOOK_TOOL: Anthropic.Tool = {
  name: "marcar_consulta",
  description:
    "Marca a consulta no horário escolhido. Usa só depois de o contacto confirmar explicitamente o dia e a hora, e só com um identificador devolvido por ver_horarios_livres nesta resposta.",
  input_schema: {
    type: "object",
    properties: {
      horario: { type: "string", description: "Identificador do horário (ex.: H2)." },
      nome: { type: "string", description: "Nome do contacto, se o disse." },
    },
    required: ["horario"],
  },
};

export function formatSlot(slot: Pick<FreeSlot, "starts_at">, timezone: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(slot.starts_at));
}

const BOOKING_CLAIM = /(?<!não\s)(?<!nao\s)\b(fica|ficou|está|esta|foi)\s+(marcad|agendad|confirmad)/i;

/**
 * Uma marcação só é anunciada depois de gravada. Se o modelo disser que marcou
 * sem uma marcação bem-sucedida nesta execução, a resposta é bloqueada.
 */
export function enforceBookingClaims(decision: AgentDecision, booked: boolean): AgentDecision {
  if (booked || !BOOKING_CLAIM.test(decision.reply)) return decision;
  return {
    ...decision,
    decision: "handoff",
    reply: SAFE_HANDOFF_REPLY,
    handoff_reason: "O assistente anunciou uma marcação que não foi gravada; precisa de confirmação da equipa.",
  };
}

type MessagesClient = { messages: { create: Anthropic["messages"]["create"] } };

const MAX_TOOL_TURNS = 6;
const MAX_BOOKINGS = 1;

export async function runAgent(input: {
  officeName: string;
  history: HistoryMessage[];
  /** Pesquisa na base jurídica. Sem ela, o assistente não dá respostas jurídicas substantivas. */
  search?: (query: string) => Promise<KnowledgeHit[]>;
  /** Agenda real do escritório. Sem ela, o assistente não propõe nem marca horários. */
  scheduling?: Scheduling;
  client?: MessagesClient;
}): Promise<{
  decision: AgentDecision;
  model: string;
  sources: SourceRecord[];
  booking: BookingResult | null;
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
    schedulingAvailable: Boolean(input.scheduling),
    nowIso: new Date().toISOString(),
  });

  const retrieved = new Map<string, { hit: KnowledgeHit; query: string }>();
  const byChunk = new Map<string, string>();
  const offered = new Map<string, FreeSlot>();
  let searches = 0;
  let bookings = 0;
  let booking: BookingResult | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let decision: AgentDecision | null = null;

  for (let turn = 0; turn <= MAX_TOOL_TURNS && !decision; turn++) {
    const tools: Anthropic.Tool[] = [];
    if (turn < MAX_TOOL_TURNS) {
      if (input.search && searches < MAX_SEARCHES) tools.push(SEARCH_TOOL);
      if (input.scheduling && bookings < MAX_BOOKINGS) tools.push(SLOTS_TOOL);
      if (input.scheduling && offered.size && bookings < MAX_BOOKINGS) tools.push(BOOK_TOOL);
    }
    tools.push(RESPONDER_TOOL);
    const onlyRespond = tools.length === 1;

    const res = await client.messages.create({
      model,
      max_tokens: 900,
      system,
      messages,
      tools,
      tool_choice: onlyRespond ? { type: "tool", name: "responder" } : { type: "any" },
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

    const allowed = new Set(tools.map((t) => t.name));
    const calls = toolUses.filter((b) => allowed.has(b.name));
    if (!calls.length) throw new Error("agent_invalid_output");

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of toolUses) {
      if (!allowed.has(call.name)) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: "Ferramenta indisponível.", is_error: true });
        continue;
      }

      if (call.name === "pesquisar_base_juridica" && input.search) {
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
        continue;
      }

      if (call.name === "ver_horarios_livres" && input.scheduling) {
        let slots: FreeSlot[] = [];
        try {
          slots = await input.scheduling.freeSlots();
        } catch (err) {
          console.error("[agent] horários falharam", (err as Error).message);
        }
        if (!slots.length) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Não há horários livres disponíveis neste momento. Não proponhas datas: diz que a equipa entrará em contacto para agendar e encaminha.",
          });
          continue;
        }
        const lines = slots.map((slot) => {
          const ref = `H${offered.size + 1}`;
          offered.set(ref, slot);
          return `[${ref}] ${formatSlot(slot, input.scheduling!.timezone)} — ${slot.service_name}`;
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Horários livres (fuso ${input.scheduling.timezone}):\n${lines.join("\n")}`,
        });
        continue;
      }

      if (call.name === "marcar_consulta" && input.scheduling) {
        bookings++;
        const args = call.input as { horario?: unknown; nome?: unknown };
        const slot = offered.get(String(args?.horario ?? ""));
        if (!slot) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Identificador de horário inválido. Nada foi marcado. Só podes usar horários devolvidos por ver_horarios_livres.",
            is_error: true,
          });
          continue;
        }
        try {
          const name = typeof args.nome === "string" && args.nome.trim() ? args.nome.trim().slice(0, 160) : null;
          booking = await input.scheduling.book(slot.service_id, slot.starts_at, name);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Marcação GRAVADA: ${booking.service_name}, ${formatSlot(booking, input.scheduling.timezone)}, com ${booking.professional_name}. Podes confirmar ao contacto.`,
          });
        } catch (err) {
          const taken = String((err as Error)?.message ?? "").includes("slot_unavailable");
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: taken
              ? "Esse horário acabou de ficar ocupado. Nada foi marcado. Pede desculpa e propõe outros horários."
              : "Não foi possível marcar. Nada foi marcado. Diz que a equipa vai confirmar a marcação e encaminha.",
            is_error: true,
          });
        }
        continue;
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!decision) throw new Error("agent_invalid_output");

  const lastContact = [...input.history].reverse().find((m) => m.author === "contact")?.body ?? "";
  const checked = enforceSafety(enforceBookingClaims(enforceSources(decision, retrieved), Boolean(booking)), lastContact);
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

  return { decision: checked, model, sources, booking, inputTokens, outputTokens };
}
