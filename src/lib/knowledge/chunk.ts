/**
 * Normalização e segmentação de texto jurídico para indexação.
 *
 * Estratégia: dividir por parágrafos, reconhecer títulos típicos de diplomas
 * portugueses (Artigo, Capítulo, Secção…) e juntar parágrafos até ~1200
 * caracteres, sem partir artigos a meio quando possível. Cada segmento herda o
 * último título visto, para que a resposta possa citar "Artigo 98.º".
 */

export type Chunk = { heading: string | null; content: string };

const TARGET = 1200;
const MAX = 2400;

const HEADING_RE =
  /^(artigo\s+\d+[.ºo°-]*[a-z]?\.?º?|art\.\s*\d+|cap[ií]tulo\s+[ivxlcdm\d]+|sec[çc][aã]o\s+[ivxlcdm\d]+|subsec[çc][aã]o\s+[ivxlcdm\d]+|t[ií]tulo\s+[ivxlcdm\d]+|anexo\s*[ivxlcdm\d]*|#{1,6}\s)/i;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // remove caracteres de controlo (exceto \n e \t)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isHeading(p: string): boolean {
  return p.length <= 160 && HEADING_RE.test(p);
}

/** Parte um parágrafo demasiado longo em frases, respeitando o limite. */
function splitLong(p: string): string[] {
  if (p.length <= MAX) return [p];
  const sentences = p.split(/(?<=[.;:!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > TARGET) {
      out.push(cur);
      cur = "";
    }
    if (s.length > MAX) {
      for (let i = 0; i < s.length; i += TARGET) out.push(s.slice(i, i + TARGET));
      continue;
    }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkText(raw: string): Chunk[] {
  const text = normalizeText(raw);
  if (!text) return [];
  const paragraphs = text
    .split(/\n{2,}|\n(?=(?:artigo|cap[ií]tulo|sec[çc][aã]o|t[ií]tulo)\s)/i)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  let bufHeading: string | null = null;

  const flush = () => {
    const content = buf.join("\n\n").trim();
    if (content) chunks.push({ heading: bufHeading, content });
    buf = [];
  };

  for (const para of paragraphs) {
    const firstLine = para.split("\n")[0];
    if (isHeading(firstLine)) {
      // Novo artigo/secção: fecha o segmento anterior.
      flush();
      heading = firstLine.replace(/^#+\s*/, "").slice(0, 300);
      bufHeading = heading;
      const rest = para.slice(firstLine.length).trim();
      if (rest) buf.push(...splitLong(rest));
      continue;
    }
    for (const piece of splitLong(para)) {
      const size = buf.reduce((n, b) => n + b.length + 2, 0);
      if (buf.length && size + piece.length > TARGET) {
        flush();
        bufHeading = heading;
      }
      if (!buf.length) bufHeading = heading;
      buf.push(piece);
    }
  }
  flush();
  return chunks;
}
