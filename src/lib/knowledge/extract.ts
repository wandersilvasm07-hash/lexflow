import "server-only";
import { convert } from "html-to-text";
import { isOfficialSource } from "./categories";
import { normalizeText } from "./chunk";

export type ImportFormat = "text" | "html" | "pdf" | "docx" | "url";

export class ExtractionError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // limite das funções na Vercel (~4,5 MB)
const MAX_TEXT_CHARS = 2_000_000;

function finish(text: string): string {
  const t = normalizeText(text);
  if (t.length < 20) {
    throw new ExtractionError(
      "Não foi possível extrair texto do documento. Se for um PDF digitalizado (imagem), é preciso uma versão com texto.",
    );
  }
  if (t.length > MAX_TEXT_CHARS) throw new ExtractionError("O documento é demasiado grande para importar de uma vez.");
  return t;
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "header", format: "skip" },
      { selector: "footer", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "form", format: "skip" },
      { selector: "h1", options: { uppercase: false } },
      { selector: "h2", options: { uppercase: false } },
      { selector: "h3", options: { uppercase: false } },
      { selector: "table", options: { uppercaseHeaderCells: false } },
    ],
  });
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).join("\n\n");
}

async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return value;
}

function detectFormat(name: string, type: string): Exclude<ImportFormat, "url"> | null {
  const n = name.toLowerCase();
  if (type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (type.includes("wordprocessingml") || n.endsWith(".docx")) return "docx";
  if (type === "text/html" || n.endsWith(".html") || n.endsWith(".htm")) return "html";
  if (type.startsWith("text/") || n.endsWith(".txt") || n.endsWith(".md")) return "text";
  return null;
}

export async function extractFromFile(file: File): Promise<{ text: string; format: ImportFormat }> {
  if (file.size === 0) throw new ExtractionError("O ficheiro está vazio.");
  if (file.size > MAX_FILE_BYTES) throw new ExtractionError("O ficheiro tem mais de 4 MB.");
  const format = detectFormat(file.name, file.type);
  if (!format) throw new ExtractionError("Formato não suportado. Use PDF, DOCX, HTML ou texto.");
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    switch (format) {
      case "pdf":
        if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
          throw new ExtractionError("O ficheiro não é um PDF válido.");
        }
        return { text: finish(await pdfToText(bytes)), format };
      case "docx":
        if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ExtractionError("O ficheiro não é um DOCX válido.");
        return { text: finish(await docxToText(bytes)), format };
      case "html":
        return { text: finish(htmlToText(new TextDecoder().decode(bytes))), format };
      default:
        return { text: finish(new TextDecoder().decode(bytes)), format };
    }
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    console.error("[knowledge] extração falhou", (err as Error).message);
    throw new ExtractionError("Não foi possível ler o ficheiro. Confirme que não está protegido ou danificado.");
  }
}

/**
 * Importa uma página ou PDF de uma fonte oficial (lista fechada de domínios).
 * Redirecionamentos são seguidos manualmente e voltam a ser validados.
 */
export async function extractFromOfficialUrl(url: string): Promise<{ text: string; format: ImportFormat; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isOfficialSource(current)) {
      throw new ExtractionError("Só é possível importar de fontes oficiais (Diário da República, AIMA, gov.pt, MNE, …).");
    }
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "Patrono/1.0 (importacao de fontes oficiais)", accept: "text/html,application/pdf" },
      });
    } catch {
      throw new ExtractionError("Não foi possível contactar a fonte. Tente novamente mais tarde.");
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new ExtractionError(`A fonte respondeu com erro (${res.status}).`);

    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES) throw new ExtractionError("O documento da fonte tem mais de 4 MB.");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_FILE_BYTES) throw new ExtractionError("O documento da fonte tem mais de 4 MB.");

    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/pdf")) {
      return { text: finish(await pdfToText(buf)), format: "url", finalUrl: current };
    }
    if (type.includes("text/html") || type.includes("application/xhtml")) {
      return { text: finish(htmlToText(new TextDecoder().decode(buf))), format: "url", finalUrl: current };
    }
    throw new ExtractionError("A fonte não devolveu uma página nem um PDF.");
  }
  throw new ExtractionError("Demasiados redirecionamentos na fonte.");
}
