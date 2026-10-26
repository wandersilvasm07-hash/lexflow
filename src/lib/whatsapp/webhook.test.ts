import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhook, verifySignature } from "./webhook";

const secret = "segredo-de-teste";
const sign = (body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const sample = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "351210000000", phone_number_id: "1234567890" },
            contacts: [{ profile: { name: "Maria" }, wa_id: "351910000000" }],
            messages: [
              { from: "351910000000", id: "wamid.A", timestamp: "1761500000", type: "text", text: { body: "Olá" } },
              { from: "351910000000", id: "wamid.B", timestamp: "1761500001", type: "image", image: { id: "x" } },
              { from: "invalido", id: "wamid.C", timestamp: "1", type: "text", text: { body: "?" } },
            ],
            statuses: [
              { id: "wamid.OUT", status: "delivered", timestamp: "1761500002", recipient_id: "351910000000" },
              { id: "wamid.FAIL", status: "failed", errors: [{ code: 131047, title: "Re-engagement" }] },
            ],
          },
        },
      ],
    },
  ],
};

describe("assinatura do webhook", () => {
  it("aceita só assinaturas válidas", () => {
    const body = JSON.stringify(sample);
    expect(verifySignature(body, sign(body), secret)).toBe(true);
    expect(verifySignature(body + " ", sign(body), secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifySignature(body, sign(body), "")).toBe(false);
  });
});

describe("leitura do payload", () => {
  it("extrai mensagens, nomes e estados, e ignora entradas inválidas", () => {
    const { messages, statuses } = parseWebhook(sample);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      phoneNumberId: "1234567890",
      fromE164: "+351910000000",
      providerMessageId: "wamid.A",
      body: "Olá",
      profileName: "Maria",
      supported: true,
    });
    expect(messages[1].supported).toBe(false);
    expect(messages[1].body).toContain("imagem");
    expect(statuses).toEqual([
      { providerMessageId: "wamid.OUT", status: "delivered", errorCode: null },
      { providerMessageId: "wamid.FAIL", status: "failed", errorCode: "131047" },
    ]);
  });

  it("ignora payloads de outros objetos", () => {
    expect(parseWebhook({ object: "page", entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] });
  });
});
