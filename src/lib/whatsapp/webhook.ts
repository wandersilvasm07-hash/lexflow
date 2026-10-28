import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Webhook da WhatsApp Business Platform (Cloud API).
 * Só a lógica pura: verificação de assinatura e leitura do payload. Fácil de
 * testar sem rede.
 */

/** Verifica o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") com o App Secret. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const messageSchema = z.object({
  id: z.string().min(1),
  from: z.string().regex(/^[0-9]{7,15}$/),
  timestamp: z.string().regex(/^[0-9]+$/),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  // Presente quando a conversa começa num anúncio "Click to WhatsApp".
  referral: z
    .object({
      source_id: z.string().max(100).optional(),
      source_type: z.string().max(40).optional(),
      source_url: z.string().max(2000).optional(),
      headline: z.string().max(500).optional(),
      ctwa_clid: z.string().max(500).optional(),
    })
    .optional(),
});

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  errors: z.array(z.object({ code: z.union([z.number(), z.string()]) })).optional(),
});

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  contacts: z.array(z.object({ profile: z.object({ name: z.string() }).optional(), wa_id: z.string() })).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

const payloadSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

export type InboundMessage = {
  phoneNumberId: string;
  fromE164: string;
  providerMessageId: string;
  sentAt: Date;
  body: string;
  profileName: string | null;
  supported: boolean;
  /** Anúncio de origem (só quando a Meta o indica). */
  referral: { sourceId: string; sourceType: string; ctwaClid: string | null; headline: string | null } | null;
};

export type StatusUpdate = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorCode: string | null;
};

const UNSUPPORTED_LABEL: Record<string, string> = {
  image: "imagem",
  audio: "áudio",
  video: "vídeo",
  document: "documento",
  sticker: "autocolante",
  location: "localização",
  contacts: "contacto",
};

/**
 * Extrai mensagens e estados de entrega. Ignora entradas malformadas em vez de
 * falhar o webhook inteiro (a Meta reenviaria tudo).
 */
export function parseWebhook(payload: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { messages: [], statuses: [] };

  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;
      const phoneNumberId = value.data.metadata.phone_number_id;
      const names = new Map((value.data.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));

      for (const raw of value.data.messages ?? []) {
        const m = messageSchema.safeParse(raw);
        if (!m.success) continue;
        const isText = m.data.type === "text" && m.data.text;
        messages.push({
          phoneNumberId,
          fromE164: `+${m.data.from}`,
          providerMessageId: m.data.id,
          sentAt: new Date(Number(m.data.timestamp) * 1000),
          body: isText
            ? m.data.text!.body
            : `[O contacto enviou ${UNSUPPORTED_LABEL[m.data.type] ?? "um conteúdo"} — ainda não suportado; ver no WhatsApp]`,
          profileName: names.get(m.data.from) ?? null,
          supported: Boolean(isText),
          referral:
            m.data.referral?.source_id && m.data.referral.source_type
              ? {
                  sourceId: m.data.referral.source_id,
                  sourceType: m.data.referral.source_type,
                  ctwaClid: m.data.referral.ctwa_clid ?? null,
                  headline: m.data.referral.headline ?? null,
                }
              : null,
        });
      }

      for (const raw of value.data.statuses ?? []) {
        const s = statusSchema.safeParse(raw);
        if (!s.success) continue;
        statuses.push({
          providerMessageId: s.data.id,
          status: s.data.status,
          errorCode: s.data.errors?.[0] ? String(s.data.errors[0].code) : null,
        });
      }
    }
  }
  return { messages, statuses };
}
