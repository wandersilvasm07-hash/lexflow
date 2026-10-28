import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { buildGeneratorPrompt, generateCampaignPlan } = await import("./generate");

const input = {
  officeName: "Escritório Teste",
  service: "Reagrupamento familiar",
  objective: "messages" as const,
  destination: "whatsapp" as const,
  locations: ["Lisboa"],
  languages: ["pt", "en"],
  dailyBudgetCents: 1000,
  totalBudgetCents: 20000,
  limits: { maxDailyCents: 2000, maxTotalCents: 50000 },
};

const plan = {
  objetivo: "Conversas no WhatsApp",
  estrutura: "1 campanha, 1 conjunto, 2 variantes",
  publico_sugerido: "Adultos em Lisboa",
  localizacoes: "Lisboa",
  orcamento_sugerido: "10 €/dia durante 20 dias",
  justificacao: "Testar dois ângulos com orçamento contido.",
  estimativas: "Estimativa: alcance local moderado; resultados dependem da Meta.",
  variantes: [
    { primary_text: "Apoio jurídico no reagrupamento familiar.", headline: "Reagrupamento familiar", cta: "WHATSAPP_MESSAGE", image_brief: "Família num ambiente neutro, sem símbolos oficiais." },
    { primary_text: "Legal support for family reunification.", headline: "Family reunification", cta: "WHATSAPP_MESSAGE", image_brief: "Escritório acolhedor, luz natural." },
  ],
};

function fake(responses: unknown[][]) {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    client: {
      messages: {
        create: (async (req: unknown) => {
          calls.push(req);
          return { content: responses[Math.min(i++, responses.length - 1)], usage: { input_tokens: 100, output_tokens: 50 } };
        }) as never,
      },
    },
  };
}

describe("gerador de campanhas", () => {
  it("o prompt contém as regras da profissão, da Meta e os limites de orçamento", () => {
    const p = buildGeneratorPrompt(input);
    expect(p).toMatch(/Nunca prometas resultados/);
    expect(p).toMatch(/temas sociais ou políticos na UE/);
    expect(p).toMatch(/características pessoais/);
    expect(p).toMatch(/nacionalidade, etnia, religião ou situação legal/);
    expect(p).toMatch(/limites do escritório/);
    expect(p).toMatch(/Estimativa:/);
    expect(p).toMatch(/Inglês/);
  });

  it("devolve o plano validado; pede uma vez a ferramenta se vier texto livre", async () => {
    const { client, calls } = fake([[{ type: "text", text: "Aqui vai" }], [{ type: "tool_use", id: "t", name: "propor_campanha", input: plan }]]);
    const r = await generateCampaignPlan(input, { client, model: "m" });
    expect(calls).toHaveLength(2);
    expect(r.plan.variantes).toHaveLength(2);
    expect(r.inputTokens).toBe(200);
    // O resultado não tem campos de orçamento numéricos aplicáveis.
    expect(Object.keys(r.plan)).not.toContain("daily_budget_cents");
  });

  it("saída inválida é recusada (não grava lixo)", async () => {
    const { client } = fake([[{ type: "tool_use", id: "t", name: "propor_campanha", input: { ...plan, variantes: [plan.variantes[0]] } }]]);
    await expect(generateCampaignPlan(input, { client })).rejects.toThrow("generator_invalid_output");
  });
});
