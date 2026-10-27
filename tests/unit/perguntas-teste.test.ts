import { describe, expect, it, vi } from "vitest";
import { CATEGORY_KEYS } from "@/lib/knowledge/categories";
import { PERGUNTAS_TESTE } from "../legal/perguntas-teste";

vi.mock("server-only", () => ({}));
const { detectMandatoryHandoff } = await import("@/lib/agent/prompt");

describe("conjunto de perguntas jurídicas de teste", () => {
  it("ids únicos e categorias de fonte válidas", () => {
    const ids = PERGUNTAS_TESTE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PERGUNTAS_TESTE) {
      if (p.comportamento === "responder_com_fonte") {
        expect(CATEGORY_KEYS, p.id).toContain(p.categoriaFonte);
      }
    }
  });

  it.each(PERGUNTAS_TESTE.filter((p) => p.id.startsWith("urg") || p.id.startsWith("rgpd")))(
    "a rede de segurança determinística encaminha $id",
    (p) => {
      expect(detectMandatoryHandoff(p.pergunta)).not.toBeNull();
    },
  );

  it("ainda não foi revisto por advogado (critério de aceitação pendente)", () => {
    // Este teste existe para lembrar que o conjunto é um rascunho. Quando o
    // advogado preencher respostaReferencia e revistoPor, troque por:
    //   expect(PERGUNTAS_TESTE.every((p) => p.revistoPor)).toBe(true)
    expect(PERGUNTAS_TESTE.some((p) => p.revistoPor === null)).toBe(true);
  });
});
