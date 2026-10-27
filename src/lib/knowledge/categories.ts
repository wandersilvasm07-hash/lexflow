/** Categorias da base jurídica (iguais à restrição na base de dados). */
export const KNOWLEDGE_CATEGORIES = {
  vistos: "Tipos de visto",
  entrada_permanencia: "Entrada e permanência",
  autorizacao_residencia: "Autorizações de residência",
  renovacao: "Renovação de títulos",
  reagrupamento_familiar: "Reagrupamento familiar",
  nacionalidade: "Nacionalidade portuguesa",
  trabalho: "Trabalho e atividade independente",
  estudo: "Estudo e formação",
  empreendedorismo_investimento: "Empreendedorismo e investimento",
  documentacao: "Documentação, apostilas e traduções",
  aima_servicos: "AIMA e serviços públicos",
  indeferimentos: "Indeferimentos e notificações",
  integracao: "NIF, NISS e integração",
  outro: "Outro",
} as const;

export type KnowledgeCategory = keyof typeof KNOWLEDGE_CATEGORIES;
export const CATEGORY_KEYS = Object.keys(KNOWLEDGE_CATEGORIES) as KnowledgeCategory[];

export const KNOWLEDGE_STATUS = {
  draft: { label: "Rascunho", tone: "neutral" },
  in_review: { label: "Em revisão", tone: "warn" },
  approved: { label: "Aprovado", tone: "ok" },
  outdated: { label: "Desatualizado", tone: "seal" },
  archived: { label: "Arquivado", tone: "neutral" },
} as const;

export type KnowledgeStatus = keyof typeof KNOWLEDGE_STATUS;

/**
 * Fontes oficiais de onde se pode importar por endereço. Lista fechada: evita
 * que o servidor seja usado para ir buscar páginas arbitrárias.
 */
export const OFFICIAL_SOURCE_DOMAINS = [
  "diariodarepublica.pt",
  "dre.pt",
  "aima.gov.pt",
  "gov.pt",
  "mne.gov.pt",
  "portaldiplomatico.mne.gov.pt",
  "vistos.mne.gov.pt",
  "justica.gov.pt",
  "irn.justica.gov.pt",
  "portaldasfinancas.gov.pt",
  "seg-social.pt",
  "eur-lex.europa.eu",
  "dgsi.pt",
] as const;

export function isOfficialSource(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return OFFICIAL_SOURCE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
