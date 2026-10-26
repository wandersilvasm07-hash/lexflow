import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Envio de mensagens. Duas implementações com a mesma interface:
 *  - CloudApiProvider: WhatsApp Business Platform oficial (Meta);
 *  - SimulationProvider: não envia nada; devolve um id "sim." para a interface
 *    mostrar claramente que é uma simulação.
 */
export interface WhatsAppProvider {
  readonly mode: "live" | "simulation";
  sendText(toE164: string, body: string): Promise<{ providerMessageId: string }>;
}

export class SimulationProvider implements WhatsAppProvider {
  readonly mode = "simulation" as const;
  async sendText(): Promise<{ providerMessageId: string }> {
    return { providerMessageId: `sim.${randomUUID()}` };
  }
}

export class WhatsAppApiError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(`whatsapp_api_${code}`);
  }
}

export class CloudApiProvider implements WhatsAppProvider {
  readonly mode = "live" as const;

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0",
  ) {}

  async sendText(toE164: string, body: string): Promise<{ providerMessageId: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: toE164.replace(/^\+/, ""),
            type: "text",
            text: { body, preview_url: false },
          }),
          signal: controller.signal,
        },
      );
      const json = (await res.json().catch(() => null)) as
        | { messages?: { id: string }[]; error?: { code?: number } }
        | null;
      if (!res.ok || !json?.messages?.[0]?.id) {
        const code = String(json?.error?.code ?? res.status);
        // 429 e 5xx podem ser repetidos; 4xx (ex.: fora da janela de 24h) não.
        throw new WhatsAppApiError(code, res.status === 429 || res.status >= 500);
      }
      return { providerMessageId: json.messages[0].id };
    } catch (err) {
      if (err instanceof WhatsAppApiError) throw err;
      throw new WhatsAppApiError("network", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Provider para uma conta. Nesta fase o token "live" vem da variável de servidor
 * WHATSAPP_ACCESS_TOKEN (um único número); a Fase 6 passa a ler o token de cada
 * escritório do cofre (Supabase Vault).
 */
export function providerFor(account: { mode: string; phone_number_id: string | null }): WhatsAppProvider | null {
  if (account.mode === "simulation") return new SimulationProvider();
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token || !account.phone_number_id) return null;
  return new CloudApiProvider(account.phone_number_id, token);
}
