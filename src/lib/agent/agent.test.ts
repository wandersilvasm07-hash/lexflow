import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { detectMandatoryHandoff, buildSystemPrompt } = await import("./prompt");
const { enforceSafety, toModelMessages, runAgent, enforceSources, formatHits, enforceBookingClaims, enforceDisclosure, AI_DISCLOSURE } =
  await import("./run");

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
    // Os modelos atuais não aceitam forçar ferramentas: o pedido usa sempre "auto".
    expect(calls.every((c) => JSON.stringify(c.tool_choice) === '{"type":"auto"}')).toBe(true);
  });

  it("se o modelo responder em texto livre, pede uma vez que use `responder` e nunca envia o texto", async () => {
    const text = { type: "text", text: "Olá! Claro, basta ir à AIMA." } as unknown as Block;
    const { client, calls } = fakeClient([[text], [responder({ reply: "Vou confirmar com a equipa.", decision: "handoff", handoff_reason: "x" })]]);
    const r = await runAgent({ officeName: "E", history, client });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1].lastUser)).toContain("responder");
    expect(r.decision.reply.startsWith("Vou confirmar com a equipa.")).toBe(true);
    expect(r.decision.reply).not.toContain("Olá!");
  });

  it("texto livre duas vezes seguidas é uma falha (a conversa vai para a equipa)", async () => {
    const text = { type: "text", text: "Olá!" } as unknown as Block;
    const { client } = fakeClient([[text]]);
    await expect(runAgent({ officeName: "E", history, client })).rejects.toThrow("agent_invalid_output");
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

describe("agenda: propor e marcar consultas", () => {
  type Block = { type: "tool_use"; id: string; name: string; input: unknown };
  function scripted(script: Block[][]) {
    const calls: { tools: string[]; lastUser: unknown }[] = [];
    let i = 0;
    return {
      calls,
      client: {
        messages: {
          create: (async (req: { tools: { name: string }[]; messages: { content: unknown }[] }) => {
            calls.push({ tools: req.tools.map((t) => t.name), lastUser: req.messages[req.messages.length - 1]?.content });
            return { content: script[Math.min(i++, script.length - 1)], usage: { input_tokens: 1, output_tokens: 1 } };
          }) as never,
        },
      },
    };
  }
  const tool = (name: string, input: unknown = {}, id = name): Block => ({ type: "tool_use", id, name, input });
  const reply = (input: Record<string, unknown>) => tool("responder", { category: "consultation", summary: "Quer marcar.", ...input });
  const slots = [
    { service_id: "svc", service_name: "Consulta de imigração", starts_at: "2026-11-03T10:00:00Z", ends_at: "2026-11-03T11:00:00Z" },
    { service_id: "svc", service_name: "Consulta de imigração", starts_at: "2026-11-03T14:30:00Z", ends_at: "2026-11-03T15:30:00Z" },
  ];
  const history = [{ author: "contact" as const, body: "Pode ser terça às 10h, chamo-me Ana" }];

  function scheduling(bookImpl?: (s: string, at: string, n: string | null) => Promise<never | object>) {
    const booked: { service: string; at: string; name: string | null }[] = [];
    return {
      booked,
      deps: {
        timezone: "Europe/Lisbon",
        freeSlots: async () => slots,
        book: async (service: string, at: string, name: string | null) => {
          if (bookImpl) await bookImpl(service, at, name);
          booked.push({ service, at, name });
          return { appointment_id: "apt-1", starts_at: at, ends_at: at, professional_name: "Dra. Sofia", service_name: "Consulta de imigração" };
        },
      },
    };
  }

  it("só marca horários devolvidos pela agenda, e só depois anuncia", async () => {
    const sch = scheduling();
    const { client, calls } = scripted([
      [tool("ver_horarios_livres")],
      [tool("marcar_consulta", { horario: "H1", nome: "Ana" })],
      [reply({ reply: "Está marcada para terça, 3 de novembro, às 10:00.", decision: "answered" })],
    ]);
    const r = await runAgent({ officeName: "E", history, client, scheduling: sch.deps });
    expect(sch.booked).toEqual([{ service: "svc", at: "2026-11-03T10:00:00Z", name: "Ana" }]);
    expect(r.booking?.appointment_id).toBe("apt-1");
    expect(r.decision.decision).toBe("answered");
    // A lista de horários chega ao modelo formatada em português, no fuso de Lisboa.
    expect(JSON.stringify(calls[1].lastUser)).toMatch(/\[H1\] terça-feira, 3 de novembro.*10:00/);
    // marcar_consulta só aparece depois de ver os horários.
    expect(calls[0].tools).not.toContain("marcar_consulta");
    expect(calls[1].tools).toContain("marcar_consulta");
  });

  it("horário inventado não é marcado", async () => {
    const sch = scheduling();
    const { client, calls } = scripted([
      [tool("ver_horarios_livres")],
      [tool("marcar_consulta", { horario: "H9" })],
      [reply({ reply: "Vou confirmar com a equipa.", decision: "handoff", handoff_reason: "Sem horário" })],
    ]);
    await runAgent({ officeName: "E", history, client, scheduling: sch.deps });
    expect(sch.booked).toHaveLength(0);
    expect(JSON.stringify(calls[2].lastUser)).toContain("Nada foi marcado");
  });

  it("se o horário ficar ocupado entretanto, nada é anunciado como marcado", async () => {
    const sch = scheduling(async () => {
      throw new Error("slot_unavailable");
    });
    const { client, calls } = scripted([
      [tool("ver_horarios_livres")],
      [tool("marcar_consulta", { horario: "H1" })],
      [reply({ reply: "A sua consulta está marcada para terça às 10:00.", decision: "answered" })],
    ]);
    const r = await runAgent({ officeName: "E", history, client, scheduling: sch.deps });
    expect(JSON.stringify(calls[2].lastUser)).toContain("acabou de ficar ocupado");
    expect(r.booking).toBeNull();
    // O modelo tentou anunciar a marcação mesmo assim: é bloqueado.
    expect(r.decision.decision).toBe("handoff");
    expect(r.decision.reply).not.toMatch(/marcada/);
  });

  it("anunciar uma marcação sem ter marcado é bloqueado", () => {
    const d = { reply: "Ficou marcada para amanhã às 9h.", decision: "answered" as const, category: "consultation" as const, summary: "x", fontes: [] };
    expect(enforceBookingClaims(d, false).decision).toBe("handoff");
    expect(enforceBookingClaims(d, true).decision).toBe("answered");
    const negative = { ...d, reply: "Ainda não está marcada; qual destes horários prefere?" };
    expect(enforceBookingClaims(negative, false).decision).toBe("answered");
  });

  it("sem horários livres, o modelo é instruído a não propor datas", async () => {
    const { client, calls } = scripted([
      [tool("ver_horarios_livres")],
      [reply({ reply: "A equipa vai contactá-la para agendar.", decision: "handoff", handoff_reason: "Sem vagas" })],
    ]);
    await runAgent({
      officeName: "E",
      history,
      client,
      scheduling: { timezone: "Europe/Lisbon", freeSlots: async () => [], book: async () => { throw new Error("x"); } },
    });
    expect(JSON.stringify(calls[1].lastUser)).toContain("Não proponhas datas");
  });

  it("só uma marcação por resposta", async () => {
    const sch = scheduling();
    const { client, calls } = scripted([
      [tool("ver_horarios_livres")],
      [tool("marcar_consulta", { horario: "H1" })],
      [reply({ reply: "Está marcada.", decision: "answered" })],
    ]);
    await runAgent({ officeName: "E", history, client, scheduling: sch.deps });
    expect(calls[2].tools).not.toContain("marcar_consulta");
    expect(calls[2].tools).not.toContain("ver_horarios_livres");
  });

  it("o prompt proíbe inventar datas e exige confirmação explícita", () => {
    const withAgenda = buildSystemPrompt({ officeName: "X", knowledgeBaseAvailable: false, schedulingAvailable: true, nowIso: "2026-10-27T00:00:00Z" });
    expect(withAgenda).toContain("confirmar explicitamente");
    expect(withAgenda).toContain("Nunca inventes datas");
    const without = buildSystemPrompt({ officeName: "X", knowledgeBaseAvailable: false, nowIso: "2026-10-27T00:00:00Z" });
    expect(without).toContain("não proponhas datas");
  });
});

describe("transparência sobre IA (Regulamento Europeu da IA, art. 50.º)", () => {
  const d = { reply: "Olá, boa tarde! Em que posso ajudar?", decision: "asked" as const, category: "general" as const, summary: "s", fontes: [] };

  it("acrescenta a informação na primeira resposta se o modelo se esquecer", () => {
    expect(enforceDisclosure(d, true).reply).toContain(AI_DISCLOSURE);
  });

  it("não repete quando o modelo já informou", () => {
    const ok = { ...d, reply: "Olá! Este atendimento é feito com apoio de inteligência artificial." };
    expect(enforceDisclosure(ok, true).reply).toBe(ok.reply);
  });

  it("não acrescenta nas respostas seguintes", () => {
    expect(enforceDisclosure(d, false).reply).toBe(d.reply);
  });

  it("o texto obrigatório não usa palavras que os clientes rejeitam", () => {
    expect(AI_DISCLOSURE).not.toMatch(/rob[oô]|\bbot\b|autom[aá]tic|assistente virtual/i);
  });

  it("o prompt proíbe essas palavras e pede a informação só na primeira resposta", () => {
    const p = buildSystemPrompt({ officeName: "E", knowledgeBaseAvailable: false, nowIso: "2026-10-27T00:00:00Z" });
    expect(p).toMatch(/inteligência artificial/);
    expect(p).toMatch(/Nunca uses as palavras "robô", "bot", "automático", "assistente virtual"/);
    expect(p).not.toMatch(/És o assistente virtual/);
  });

  it("a primeira resposta real do agente inclui sempre a informação, mesmo após encaminhamento forçado", async () => {
    const client = {
      messages: {
        create: (async () => ({
          content: [{ type: "tool_use", id: "r", name: "responder", input: { reply: "Olá!", decision: "asked", category: "general", summary: "s" } }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })) as never,
      },
    };
    const first = await runAgent({ officeName: "E", history: [{ author: "contact", body: "Recebi uma notificação para abandonar o país" }], client });
    expect(first.decision.decision).toBe("handoff");
    expect(first.decision.reply).toContain(AI_DISCLOSURE);
    const second = await runAgent({
      officeName: "E",
      history: [
        { author: "contact", body: "Olá" },
        { author: "ai", body: "Olá! " + AI_DISCLOSURE },
        { author: "contact", body: "Obrigado" },
      ],
      client,
    });
    expect(second.decision.reply).not.toContain(AI_DISCLOSURE);
  });
});
