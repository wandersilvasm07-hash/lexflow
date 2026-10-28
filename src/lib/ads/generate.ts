import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DEFAULT_MODEL } from "@/lib/agent/run";
import { CTAS, DESTINATIONS, LANGUAGES, OBJECTIVES, formatCents, type Destination, type Objective } from "./constants";

/**
 * Gera o plano e as variantes de anúncios de uma campanha (passos 6 e 7).
 * A IA propõe; não decide orçamento nem publica. O orçamento sugerido é só
 * texto e nunca é aplicado automaticamente.
 */

export const GENERATOR_VERSION = "2026-10-27.1";

const adSchema = z.object({
  primary_text: z.string().min(10).max(600),
  headline: z.string().min(3).max(80),
  description: z.string().max(200).optional().nullable(),
  cta: z.enum(Object.keys(CTAS) as [keyof typeof CTAS, ...(keyof typeof CTAS)[]]),
  image_brief: z.string().min(10).max(1000),
});

export const planSchema = z.object({
  objetivo: z.string().min(5).max(600),
  estrutura: z.string().min(5).max(1500),
  publico_sugerido: z.string().min(5).max(1000),
  localizacoes: z.string().min(2).max(600),
  orcamento_sugerido: z.string().min(5).max(600),
  justificacao: z.string().min(10).max(2000),
  estimativas: z.string().min(10).max(800),
  variantes: z.array(adSchema).min(2).max(3),
});
export type CampaignPlan = z.infer<typeof planSchema>;
export type GeneratedAd = z.infer<typeof adSchema>;

const TOOL: Anthropic.Tool = {
  name: "propor_campanha",
  description: "Devolve o plano da campanha e 2 a 3 variantes de anúncio.",
  input_schema: {
    type: "object",
    properties: {
      objetivo: { type: "string", description: "Objetivo da campanha, em linguagem simples." },
      estrutura: { type: "string", description: "Estrutura: 1 campanha, conjuntos de anúncios, variantes em teste." },
      publico_sugerido: { type: "string", description: "Público sugerido (idade, zona, interesses gerais). Nunca por nacionalidade, etnia, religião ou situação legal." },
      localizacoes: { type: "string" },
      orcamento_sugerido: { type: "string", description: "Sugestão em texto. Não pode exceder os limites indicados." },
      justificacao: { type: "string", description: "Porque é que esta estratégia faz sentido." },
      estimativas: { type: "string", description: "Começa por 'Estimativa:'. Sem números de clientes ou resultados prometidos." },
      variantes: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            primary_text: { type: "string", description: "Texto principal, idealmente até 125 caracteres." },
            headline: { type: "string", description: "Título até 40 caracteres." },
            description: { type: "string" },
            cta: { type: "string", enum: Object.keys(CTAS) },
            image_brief: { type: "string", description: "Briefing da imagem para o designer: o que mostrar e o que evitar." },
          },
          required: ["primary_text", "headline", "cta", "image_brief"],
        },
      },
    },
    required: ["objetivo", "estrutura", "publico_sugerido", "localizacoes", "orcamento_sugerido", "justificacao", "estimativas", "variantes"],
  },
};

export type GenerateInput = {
  officeName: string;
  service: string;
  objective: Objective;
  destination: Destination;
  locations: string[];
  languages: string[];
  audienceNotes?: string | null;
  dailyBudgetCents: number;
  totalBudgetCents: number;
  limits?: { maxDailyCents: number; maxTotalCents: number } | null;
};

export function buildGeneratorPrompt(input: GenerateInput): string {
  const langs = input.languages.map((l) => LANGUAGES[l as keyof typeof LANGUAGES] ?? l).join(", ");
  return `Preparas campanhas de anúncios na Meta (Facebook e Instagram) para o escritório de advocacia "${input.officeName}", em Portugal. O utilizador não tem experiência em publicidade.

Campanha:
- Serviço a divulgar: ${input.service}
- Objetivo: ${OBJECTIVES[input.objective].label}
- Destino: ${DESTINATIONS[input.destination]}
- Localizações: ${input.locations.join(", ")}
- Idiomas dos anúncios: ${langs}
- Notas sobre o público: ${input.audienceNotes || "—"}
- Orçamento definido pelo escritório: ${formatCents(input.dailyBudgetCents)}/dia, ${formatCents(input.totalBudgetCents)} no total${
    input.limits ? ` (limites do escritório: ${formatCents(input.limits.maxDailyCents)}/dia, ${formatCents(input.limits.maxTotalCents)} por campanha)` : ""
  }

Regras obrigatórias (profissão e Meta):
- Anúncios informativos e sóbrios sobre o serviço. Nunca prometas resultados, vistos, autorizações, nacionalidade ou prazos. Nada de "garantido", percentagens de sucesso, "o melhor", "nº 1" ou comparações com outros advogados.
- Não refiras clientes, casos concretos ou testemunhos (segredo profissional).
- Não te apresentes como entidade oficial nem sugiras ligação à AIMA, ao Governo ou a consulados.
- Nada de política ou opinião sobre imigração: a Meta não entrega anúncios de temas sociais ou políticos na UE. Fala só do serviço jurídico.
- Não afirmes nem insinues características pessoais de quem lê ("Está ilegal?", "É imigrante?"). Escreve na terceira pessoa ou de forma geral ("Para quem pretende reunir a família em Portugal…").
- Sem pressão comercial ("últimas vagas", "só hoje"). Não peças documentos no anúncio.
- Público: nunca segmentar por nacionalidade, etnia, religião ou situação legal; usa localização, idade e interesses gerais.
- Orçamento: a tua sugestão é só texto e não pode exceder o orçamento e os limites indicados. Não inventes resultados: as estimativas são qualitativas e começam por "Estimativa:". Não indiques números de clientes, contactos ou consultas esperados.
- Escreve os anúncios nos idiomas indicados (se houver mais do que um, distribui as variantes). Português de Portugal.
- Variantes diferentes entre si (ângulo, título, primeira frase) para testar.

Responde usando a ferramenta "propor_campanha".`;
}

type Client = { messages: { create: Anthropic["messages"]["create"] } };

export async function generateCampaignPlan(
  input: GenerateInput,
  opts: { client?: Client; model?: string } = {},
): Promise<{ plan: CampaignPlan; model: string; inputTokens: number; outputTokens: number }> {
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  let client = opts.client;
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("agent_not_configured");
    client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildGeneratorPrompt(input) }];
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      messages,
      tools: [TOOL],
      tool_choice: { type: "auto" },
    });
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
    if (call) {
      const parsed = planSchema.safeParse(call.input);
      if (!parsed.success) throw new Error("generator_invalid_output");
      return { plan: parsed.data, model, inputTokens, outputTokens };
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: "Usa a ferramenta \"propor_campanha\" para responder." });
  }
  throw new Error("generator_invalid_output");
}
