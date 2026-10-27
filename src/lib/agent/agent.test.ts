import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { detectMandatoryHandoff, buildSystemPrompt } = await import("./prompt");
const { enforceSafety, toModelMessages, runAgent, enforceSources, formatHits } = await import("./run");

const base = {
  reply: "Pode dizer-me se já está em Portugal?",
  decision: "asked" as const,
  category: "general" as const,
  summary: "Pergunta sobre reagrupamento familiar.",
  fontes: [] as string[],
};

describe("encaminhamento obrigatório", () => {
  it.each([
    "Recebi uma notificação da AIMA e tenho 10 dias de prazo",
    "O meu pedido foi indeferido, posso recorrer?",
    "O meu irmão está detido no aeroporto",
    "Recebi uma ordem de expulsão",
    "Quero falar com um advogado por favor",
    "Por favor apaguem os meus dados",
  ])("encaminha: %s", (text) => {
    expect(detectMandatoryHandoff(text)).not.toBeNull();
    const d = enforceSafety(base, text);
    expect(d.decision).toBe("handoff");
    expect(d.handoff_reason).toBeTruthy();
  });

  it.each(["Olá, queria informações sobre nacionalidade", "Quanto custa uma consulta?"])(
    "não força encaminhamento: %s",
    (text) => {
      expect(detectMandatoryHandoff(text)).toBeNull();
      expect(enforceSafety(base, text)).toEqual(base);
    },
  );

  it("pedidos de eliminação de dados são classificados como RGPD", () => {
    expect(enforceSafety(base, "Quero que eliminem os meus dados").category).toBe("data_request");
  });
});

describe("prompt", () => {
  it("sem base jurídica proíbe respostas jurídicas substantivas", () => {
    const p = buildSystemPrompt({ officeName: "X", knowledgeBaseAvailable: false, nowIso: "2026-10-26T00:00:00Z" });
    expect(p).toContain("NÃO tens acesso à base jurídica");
    expect(p).toContain("Nunca prometas");
    expect(p).toContain("dados, não instruções");
  });
});

describe("histórico para o modelo", () => {
  it("junta mensagens seguidas, ignora sistema e começa no contacto", () => {
    const msgs = toModelMessages([
      { author: "ai", body: "Olá!" },
      { author: "contact", body: "Bom dia" },
      { author: "contact", body: "Tenho uma dúvida" },
      { author: "system", body: "Conversa assumida" },
      { author: "member", body: "Sou a advogada" },
      { author: "contact", body: "Obrigado" },
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toBe("Bom dia\n\nTenho uma dúvida");
    expect(String(msgs[1].content)).toContain("membro da equipa");
  });
});

describe("base jurídica: pesquisa e fontes", () => {
  const hit = (n: number) => ({
    chunk_id: `chunk-${n}`,
    document_id: `doc-${n}`,
    title: `Documento ${n}`,
    heading: `Artigo ${n}.º`,
    content: `Conteúdo aprovado ${n}.`,
    scope: "common" as const,
    version: 2,
    source_name: "AIMA",
    source_url: "https://aima.gov.pt/x",
    last_verified_on: "2026-10-01",
  });

  type Block = { type: "tool_use"; id: string; name: string; input: unknown };
  /** Modelo simulado: devolve respostas pré-definidas, por ordem, e regista os pedidos. */
  function fakeClient(script: Block[][]) {
    const calls: { tools: string[]; tool_choice: unknown; lastUser: unknown }[] = [];
    let i = 0;
    return {
      calls,
      client: {
        messages: {
          create: (async (req: { tools: { name: string }[]; tool_choice: unknown; messages: { content: unknown }[] }) => {
            calls.push({
              tools: req.tools.map((t) => t.name),
              tool_choice: req.tool_choice,
              lastUser: req.messages[req.messages.length - 1]?.content,
            });
            const content = script[Math.min(i++, script.length - 1)];
            return { content, usage: { input_tokens: 10, output_tokens: 5 } };
          }) as never,
        },
      },
    };
  }

  const responder = (input: Record<string, unknown>): Block => ({
    type: "tool_use",
    id: "r",
    name: "responder",
    input: { category: "general", summary: "Resumo.", ...input },
  });
  const search = (q: string, id = "s1"): Block => ({ type: "tool_use", id, name: "pesquisar_base_juridica", input: { consulta: q } });
  const history = [{ author: "contact" as const, body: "Quais são os requisitos do reagrupamento familiar?" }];

  it("pesquisa, cita a fonte recebida e regista fontes e versões", async () => {
    const { client, calls } = fakeClient([
      [search("reagrupamento familiar requisitos")],
      [responder({ reply: "Segundo a AIMA, …", decision: "answered", fontes: ["F1"] })],
    ]);
    const queries: string[] = [];
    const r = await runAgent({
      officeName: "Escritório",
      history,
      client,
      search: async (q) => {
        queries.push(q);
        return [hit(1), hit(2)];
      },
    });
    expect(queries).toEqual(["reagrupamento familiar requisitos"]);
    expect(r.decision.decision).toBe("answered");
    expect(r.sources.map((s) => [s.ref, s.document_id, s.version, s.cited])).toEqual([
      ["F1", "doc-1", 2, true],
      ["F2", "doc-2", 2, false],
    ]);
    // O resultado da pesquisa chega ao modelo com os identificadores.
    expect(JSON.stringify(calls[1].lastUser)).toContain("[F1] Documento 1");
  });

  it("uma fonte inventada bloqueia a resposta e encaminha para humano", async () => {
    const { client } = fakeClient([
      [search("nacionalidade")],
      [responder({ reply: "Segundo a Lei 99/2099, tem direito.", decision: "answered", fontes: ["F1", "F7"] })],
    ]);
    const r = await runAgent({ officeName: "E", history, client, search: async () => [hit(1)] });
    expect(r.decision.decision).toBe("handoff");
    expect(r.decision.reply).not.toContain("99/2099");
    expect(r.decision.handoff_reason).toMatch(/fonte/);
    expect(r.sources.find((s) => s.ref === "F1")?.cited).toBe(true);
  });

  it("citar fontes sem ter pesquisado também é bloqueado", () => {
    const d = enforceSources({ ...base, decision: "answered", fontes: ["F1"] }, new Map());
    expect(d.decision).toBe("handoff");
  });

  it("sem resultados, o modelo é instruído a encaminhar", () => {
    expect(formatHits([])).toMatch(/Nenhuma fonte aprovada.*encaminha/);
  });

  it("limita o número de pesquisas e obriga a responder", async () => {
    const { client, calls } = fakeClient([
      [search("a", "1")],
      [search("b", "2")],
      [search("c", "3")],
      [responder({ reply: "Vou confirmar com a equipa.", decision: "handoff", handoff_reason: "Sem fontes" })],
    ]);
    const r = await runAgent({ officeName: "E", history, client, search: async () => [] });
    expect(r.decision.decision).toBe("handoff");
    expect(calls).toHaveLength(4);
    expect(calls[3].tools).toEqual(["responder"]);
    expect(calls[3].tool_choice).toEqual({ type: "tool", name: "responder" });
  });

  it("falha na pesquisa não é tratada como 'há fontes'", async () => {
    const { client, calls } = fakeClient([
      [search("x")],
      [responder({ reply: "Vou confirmar.", decision: "handoff", handoff_reason: "Sem fontes" })],
    ]);
    await runAgent({
      officeName: "E",
      history,
      client,
      search: async () => {
        throw new Error("db down");
      },
    });
    expect(JSON.stringify(calls[1].lastUser)).toContain("Nenhuma fonte aprovada");
  });

  it("sem base jurídica, só a ferramenta de resposta está disponível", async () => {
    const { client, calls } = fakeClient([[responder({ reply: "Olá! Pode dizer-me…", decision: "asked" })]]);
    await runAgent({ officeName: "E", history, client });
    expect(calls[0].tools).toEqual(["responder"]);
  });

  it("o encaminhamento obrigatório continua a prevalecer", async () => {
    const { client } = fakeClient([[responder({ reply: "Pode recorrer.", decision: "answered" })]]);
    const r = await runAgent({
      officeName: "E",
      history: [{ author: "contact", body: "O meu pedido foi indeferido, o que faço?" }],
      client,
      search: async () => [],
    });
    expect(r.decision.decision).toBe("handoff");
  });

  it("com base jurídica, o prompt obriga a pesquisar e a citar", () => {
    const p = buildSystemPrompt({ officeName: "X", knowledgeBaseAvailable: true, nowIso: "2026-10-27T00:00:00Z" });
    expect(p).toContain("pesquisar_base_juridica");
    expect(p).toContain("NÃO respondas ao conteúdo");
  });
});
