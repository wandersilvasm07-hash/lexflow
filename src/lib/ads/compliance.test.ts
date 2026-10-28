import { describe, expect, it } from "vitest";
import { checkCompliance, hasBlocking } from "./compliance";
import { daysBetween, formatCents, parseEuros } from "./constants";

const ad = (primary_text: string, headline = "Reagrupamento familiar", cta = "WHATSAPP_MESSAGE") => ({ primary_text, headline, cta });
const codes = (text: string) => checkCompliance([ad(text)]).issues.map((i) => i.code);

describe("revisão de conformidade", () => {
  it("um anúncio sóbrio sobre o serviço passa sem bloqueios", () => {
    const r = checkCompliance([ad("Apoio jurídico no pedido de reagrupamento familiar. Fale connosco pelo WhatsApp.")], { destination: "whatsapp" });
    expect(r.issues).toEqual([]);
    expect(hasBlocking(r)).toBe(false);
  });

  it.each([
    ["Visto garantido em 30 dias!", "promessa_resultado"],
    ["98% de sucesso nos pedidos de nacionalidade", "taxa_sucesso"],
    ["Nunca perdemos um caso.", "taxa_sucesso"],
    ["Ao contrário de outros advogados, respondemos sempre.", "comparacao_colegas"],
    ["Veja o testemunho dos nossos clientes satisfeitos.", "testemunho_cliente"],
    ["Somos parceiros oficiais da AIMA.", "entidade_oficial"],
    ["Vote no partido certo para mudar a lei.", "tema_politico"],
    ["Envie o seu passaporte por WhatsApp e tratamos de tudo.", "dados_sensiveis"],
  ])("bloqueia: %s", (text, code) => {
    const r = checkCompliance([ad(text)]);
    expect(r.issues.map((i) => i.code)).toContain(code);
    expect(hasBlocking(r)).toBe(true);
  });

  it.each([
    ["Consiga a sua autorização de residência connosco.", "promessa_documento"],
    ["Somos o melhor escritório de imigração.", "superlativo"],
    ["Últimas vagas para consultas este mês!", "pressao"],
    ["Primeira consulta gratuita.", "gratuito"],
    ["Está em situação irregular? Podemos ajudar.", "atributo_pessoal"],
    ["O governo mudou as regras.", "opiniao_social"],
  ])("avisa (sem bloquear): %s", (text, code) => {
    const r = checkCompliance([ad(text)]);
    expect(r.issues.map((i) => i.code)).toContain(code);
    expect(r.issues.find((i) => i.code === code)?.severity).toBe("warn");
  });

  it("identifica o anúncio e o campo, com excerto", () => {
    const r = checkCompliance([ad("Texto normal."), ad("Resultado garantido.", "Título")]);
    expect(r.issues[0]).toMatchObject({ where: "Anúncio B · texto", code: "promessa_resultado" });
    expect(r.issues[0].excerpt).toContain("garantido");
  });

  it("avisa sobre comprimentos e botão inadequado ao destino", () => {
    const long = "a".repeat(130);
    const c = checkCompliance([ad(long, "b".repeat(45), "LEARN_MORE")], { destination: "whatsapp" }).issues.map((i) => i.code);
    expect(c).toEqual(expect.arrayContaining(["texto_longo", "titulo_longo", "cta_destino"]));
  });

  it("não confunde palavras parecidas", () => {
    expect(codes("Garantimos atendimento em português e inglês.")).toContain("promessa_resultado"); // "garantimos" é promessa
    expect(codes("Atendimento personalizado e confidencial.")).toEqual([]);
    expect(codes("Apoio em processos de autorização de residência.")).toEqual([]);
  });

  it("sem anúncios bloqueia", () => {
    expect(hasBlocking(checkCompliance([]))).toBe(true);
  });
});

describe("valores", () => {
  it("converte euros escritos em pt-PT para cêntimos", () => {
    expect(parseEuros("12,50")).toBe(1250);
    expect(parseEuros("12.5")).toBe(1250);
    expect(parseEuros("10 €")).toBe(1000);
    expect(parseEuros("-5")).toBeNull();
    expect(parseEuros("1,234")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
  });

  it("formata cêntimos e conta dias", () => {
    expect(formatCents(1250).replace(/\s/g, " ")).toMatch(/12,50\s?€/);
    expect(daysBetween("2026-11-01", "2026-11-30")).toBe(30);
  });
});
