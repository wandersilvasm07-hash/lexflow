import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isOfficialSource } from "./categories";
import { chunkText, normalizeText } from "./chunk";

vi.mock("server-only", () => ({}));
const { extractFromFile, extractFromOfficialUrl, htmlToText, ExtractionError } = await import("./extract");

const fixture = (name: string, type: string) => {
  const buf = readFileSync(path.join(process.cwd(), "tests/fixtures", name));
  return new File([buf], name, { type });
};

describe("fontes oficiais", () => {
  it("aceita apenas domínios oficiais por https", () => {
    expect(isOfficialSource("https://diariodarepublica.pt/dr/legislacao-consolidada/lei/2007-34567")).toBe(true);
    expect(isOfficialSource("https://aima.gov.pt/pt/viver/autorizacao-de-residencia")).toBe(true);
    expect(isOfficialSource("https://eportugal.gov.pt/servicos")).toBe(true);
    expect(isOfficialSource("http://aima.gov.pt/")).toBe(false);
    expect(isOfficialSource("https://aima.gov.pt.atacante.com/")).toBe(false);
    expect(isOfficialSource("https://notgov.pt/")).toBe(false);
    expect(isOfficialSource("https://user:pw@aima.gov.pt/")).toBe(false);
    expect(isOfficialSource("https://aima.gov.pt:8443/")).toBe(false);
    expect(isOfficialSource("https://blog-de-imigracao.com/")).toBe(false);
  });

  it("recusa importar de domínios fora da lista sem fazer o pedido", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(extractFromOfficialUrl("https://exemplo.com/lei")).rejects.toBeInstanceOf(ExtractionError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("um redirecionamento para fora da lista é bloqueado", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://malicioso.example/x" } }));
    await expect(extractFromOfficialUrl("https://aima.gov.pt/redir")).rejects.toThrow(/fontes oficiais/);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("segmentação", () => {
  it("separa por artigos e guarda o título de cada segmento", () => {
    const chunks = chunkText(
      "Lei de teste\n\nArtigo 1.º\nObjeto\n\nO presente texto define o objeto.\n\nArtigo 2.º\nÂmbito\n\nAplica-se a todos.",
    );
    expect(chunks.map((c) => c.heading)).toEqual([null, "Artigo 1.º", "Artigo 2.º"]);
    expect(chunks[1].content).toContain("define o objeto");
    expect(chunks[2].content).toContain("Aplica-se a todos");
  });

  it("nenhum segmento ultrapassa o limite e nada se perde", () => {
    const para = "Frase de teste com algum conteúdo jurídico. ".repeat(40);
    const text = Array.from({ length: 12 }, () => para).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(2400);
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    expect(chunks.reduce((n, c) => n + words(c.content), 0)).toBe(words(normalizeText(text)));
  });

  it("normaliza espaços e remove caracteres de controlo", () => {
    expect(normalizeText("a\u0000b  c\r\n\n\n\nd e")).toBe("ab c\n\nd e");
  });
});

describe("extração de texto", () => {
  it("lê PDF com várias páginas, por ordem", async () => {
    const { text, format } = await extractFromFile(fixture("amostra.pdf", "application/pdf"));
    expect(format).toBe("pdf");
    expect(text.indexOf("Artigo 1")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Artigo 2")).toBeGreaterThan(text.indexOf("Artigo 1"));
  });

  it("lê DOCX com acentos", async () => {
    const { text, format } = await extractFromFile(
      fixture("amostra.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    );
    expect(format).toBe("docx");
    expect(text).toContain("extração de texto em DOCX, com acentuação");
  });

  it("HTML: remove menus, scripts e rodapés", () => {
    const text = htmlToText(
      "<html><nav>Menu</nav><script>alert(1)</script><main><h1>Título</h1><p>Conteúdo útil.</p></main><footer>Rodapé</footer></html>",
    );
    expect(text).toContain("Título");
    expect(text).toContain("Conteúdo útil.");
    expect(text).not.toMatch(/Menu|alert|Rodapé/);
  });

  it("recusa ficheiro com extensão PDF que não é PDF", async () => {
    const fake = new File([new TextEncoder().encode("isto não é um pdf, é texto simples")], "falso.pdf", {
      type: "application/pdf",
    });
    await expect(extractFromFile(fake)).rejects.toThrow(/não é um PDF válido/);
  });

  it("recusa formatos não suportados e ficheiros vazios", async () => {
    await expect(extractFromFile(new File(["x"], "foto.png", { type: "image/png" }))).rejects.toThrow(/Formato/);
    await expect(extractFromFile(new File([], "vazio.txt", { type: "text/plain" }))).rejects.toThrow(/vazio/);
  });
});
