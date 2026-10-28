/** Constantes e utilitários de publicidade partilhados entre servidor e interface. */

export const OBJECTIVES = {
  messages: { label: "Conversas no WhatsApp", hint: "Pessoas iniciam uma conversa com o escritório." },
  traffic: { label: "Visitas à página", hint: "Pessoas visitam a página do serviço." },
  leads: { label: "Pedidos de contacto", hint: "Formulário instantâneo da Meta (ainda não disponível)." },
  awareness: { label: "Notoriedade", hint: "Mostrar o escritório ao maior número de pessoas da zona." },
} as const;
export type Objective = keyof typeof OBJECTIVES;

export const DESTINATIONS = {
  whatsapp: "WhatsApp do escritório",
  landing_page: "Página de destino",
  form: "Formulário da Meta",
} as const;
export type Destination = keyof typeof DESTINATIONS;

/** O formulário instantâneo exige configuração adicional na Meta; não se publica ainda. */
export const SUPPORTED_DESTINATIONS: readonly Destination[] = ["whatsapp", "landing_page"];

export const CTAS = {
  WHATSAPP_MESSAGE: "Enviar mensagem",
  LEARN_MORE: "Saber mais",
  CONTACT_US: "Contacte-nos",
  BOOK_NOW: "Marcar agora",
  SIGN_UP: "Registar",
  GET_QUOTE: "Pedir orçamento",
} as const;
export type Cta = keyof typeof CTAS;

export const LANGUAGES = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
} as const;

export const CAMPAIGN_STATUS = {
  draft: { label: "Rascunho", tone: "neutral" },
  approved: { label: "Aprovada", tone: "ink" },
  publishing: { label: "A publicar", tone: "warn" },
  active: { label: "Ativa", tone: "ok" },
  paused: { label: "Pausada", tone: "neutral" },
  failed: { label: "Falhou", tone: "seal" },
  rejected: { label: "Rejeitada", tone: "seal" },
  ended: { label: "Terminada", tone: "neutral" },
  archived: { label: "Arquivada", tone: "neutral" },
} as const;
export type CampaignStatus = keyof typeof CAMPAIGN_STATUS;

export const EVENT_LABELS: Record<string, string> = {
  created: "Campanha criada",
  updated: "Dados alterados",
  ai_generated: "Plano e anúncios gerados pela IA",
  ads_updated: "Anúncios editados",
  compliance_checked: "Revisão de conformidade",
  approved: "Aprovada",
  approval_revoked: "Aprovação anulada",
  publish_requested: "Publicação pedida",
  published: "Publicada na Meta",
  publish_failed: "Falha na publicação",
  rejected: "Rejeitada pela Meta",
  status_change_requested: "Mudança de estado pedida",
  status_confirmed: "Estado confirmado pela Meta",
  budget_alert: "Alerta de consumo",
  budget_exhausted: "Orçamento total atingido",
  archived: "Arquivada",
};

/** Formata cêntimos como euros em pt-PT. */
export function formatCents(cents: number | bigint | null | undefined, currency = "EUR"): string {
  const n = Number(cents ?? 0) / 100;
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(n);
}

/** "12,50" | "12.5" | "12" → 1250. Devolve null se não for um valor válido. */
export function parseEuros(input: unknown): number | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const s = String(input).trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Número de dias entre duas datas (inclusive). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86400000) + 1;
}
