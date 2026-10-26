import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createOrg, createUser, expectPgError, pool, type TestUser } from "./helpers";

/**
 * Critérios da Fase 2 (secção 18):
 *  - webhooks repetidos não duplicam mensagens;
 *  - a transferência para humano suspende respostas automáticas;
 *  - um escritório não vê conversas de outro;
 *  - o gestor de marketing não vê conversas.
 */

/** Executa como a chave de serviço (o servidor do webhook). */
async function asService<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

let admin: TestUser;
let org: string;
let phoneId: string;

async function inbound(from: string, wamid = `wamid.${randomUUID()}`, body = "Olá") {
  return asService(async (c) => {
    const { rows } = await c.query(
      "select * from public.ingest_inbound_message($1, $2, $3, $4, now(), 'Cliente Teste')",
      [phoneId, from, wamid, body],
    );
    return rows[0] as {
      conversation_id: string;
      message_id: string | null;
      duplicate: boolean;
      agent_should_reply: boolean;
    };
  });
}

const aiReply = (conv: string, decision = "asked", body: string | null = "Pode indicar-me…") =>
  asService((c) =>
    c.query("select public.record_ai_reply($1, $2, 'modelo-teste', $3)", [conv, body, decision]),
  );

beforeAll(async () => {
  admin = await createUser("Admin");
  org = await createOrg(admin, "Escritório Atendimento");
  await asUser(admin, (c) => c.query("select public.enable_whatsapp_simulation($1)", [org]));
  await asUser(admin, (c) => c.query("select public.set_agent_enabled($1, true)", [org]));
  const { rows } = await pool.query(
    "select phone_number_id from public.whatsapp_accounts where organization_id = $1",
    [org],
  );
  phoneId = rows[0].phone_number_id;
});

afterAll(async () => {
  await pool.end();
});

describe("ingestão de mensagens", () => {
  it("cria contacto e conversa e pede resposta da IA", async () => {
    const r = await inbound("+351910000001");
    expect(r.duplicate).toBe(false);
    expect(r.agent_should_reply).toBe(true);
    const { rows } = await pool.query(
      "select source, phone_e164 from public.contacts c join public.conversations v on v.contact_id = c.id where v.id = $1",
      [r.conversation_id],
    );
    expect(rows[0]).toEqual({ source: "whatsapp", phone_e164: "+351910000001" });
  });

  it("webhook repetido não duplica a mensagem", async () => {
    const wamid = `wamid.${randomUUID()}`;
    const a = await inbound("+351910000002", wamid);
    const b = await inbound("+351910000002", wamid);
    expect(b.duplicate).toBe(true);
    expect(b.agent_should_reply).toBe(false);
    const { rows } = await pool.query(
      "select count(*)::int as n from public.messages where provider_message_id = $1",
      [wamid],
    );
    expect(rows[0].n).toBe(1);
    expect(b.conversation_id).toBe(a.conversation_id);
  });

  it("evento de webhook repetido é detetado", async () => {
    const id = randomUUID();
    const first = await asService(async (c) =>
      (await c.query("select public.register_webhook_event('whatsapp', $1, 'h') as ok", [id])).rows[0].ok,
    );
    const second = await asService(async (c) =>
      (await c.query("select public.register_webhook_event('whatsapp', $1, 'h') as ok", [id])).rows[0].ok,
    );
    expect([first, second]).toEqual([true, false]);
  });

  it("mensagens seguidas do mesmo contacto ficam na mesma conversa", async () => {
    const a = await inbound("+351910000003");
    const b = await inbound("+351910000003");
    expect(b.conversation_id).toBe(a.conversation_id);
  });

  it("utilizadores não conseguem injetar mensagens recebidas", async () => {
    await expectPgError(
      asUser(admin, (c) =>
        c.query("select * from public.ingest_inbound_message($1, '+351910000099', 'x', 'y', now())", [phoneId]),
      ),
      /permission denied/,
    );
    await expectPgError(
      asUser(admin, (c) =>
        c.query(
          "insert into public.messages (organization_id, conversation_id, direction, author, status) select organization_id, id, 'inbound', 'contact', 'received' from public.conversations limit 1",
        ),
      ),
      /permission denied/,
    );
  });
});

describe("transferência para atendimento humano", () => {
  it("assumir a conversa impede a IA de responder", async () => {
    const r = await inbound("+351910000010");
    await aiReply(r.conversation_id);
    await asUser(admin, (c) => c.query("select public.take_over_conversation($1)", [r.conversation_id]));
    await expectPgError(aiReply(r.conversation_id), "conversation_taken_over");

    const next = await inbound("+351910000010");
    expect(next.agent_should_reply).toBe(false);
  });

  it("a IA pode encaminhar e, a partir daí, deixa de responder", async () => {
    const r = await inbound("+351910000011");
    await asService((c) =>
      c.query(
        "select public.record_ai_reply($1, 'Vou passar ao advogado.', 'modelo-teste', 'handoff', 'urgent', '[]', 'Resumo', 'Notificação com prazo')",
        [r.conversation_id],
      ),
    );
    const { rows } = await pool.query("select mode, is_urgent, handoff_reason from public.conversations where id = $1", [
      r.conversation_id,
    ]);
    expect(rows[0]).toEqual({ mode: "human", is_urgent: true, handoff_reason: "Notificação com prazo" });
    await expectPgError(aiReply(r.conversation_id), "conversation_taken_over");
  });

  it("reativar a IA exige autorização (assistente não pode)", async () => {
    const assistant = await createUser("Assistente");
    await addMember(admin, org, assistant, "legal_assistant");
    const r = await inbound("+351910000012");
    await asUser(assistant, (c) => c.query("select public.take_over_conversation($1)", [r.conversation_id]));
    await expectPgError(
      asUser(assistant, (c) => c.query("select public.return_conversation_to_ai($1)", [r.conversation_id])),
      "forbidden",
    );
    await asUser(admin, (c) => c.query("select public.return_conversation_to_ai($1)", [r.conversation_id]));
    await aiReply(r.conversation_id); // volta a poder responder
  });

  it("com o assistente desligado no escritório, a IA não responde", async () => {
    const r = await inbound("+351910000013");
    await asUser(admin, (c) => c.query("select public.set_agent_enabled($1, false)", [org]));
    try {
      await expectPgError(aiReply(r.conversation_id), "agent_disabled");
      const next = await inbound("+351910000013");
      expect(next.agent_should_reply).toBe(false);
    } finally {
      await asUser(admin, (c) => c.query("select public.set_agent_enabled($1, true)", [org]));
    }
  });
});

describe("respostas da equipa", () => {
  it("só depois de assumir e dentro da janela de 24h", async () => {
    const r = await inbound("+351910000020");
    await expectPgError(
      asUser(admin, (c) => c.query("select public.send_member_message($1, 'Olá')", [r.conversation_id])),
      "take_over_first",
    );
    await asUser(admin, (c) => c.query("select public.take_over_conversation($1)", [r.conversation_id]));
    await asUser(admin, (c) => c.query("select public.send_member_message($1, 'Olá, sou a advogada.')", [r.conversation_id]));

    await pool.query("update public.conversations set last_inbound_at = now() - interval '25 hours' where id = $1", [
      r.conversation_id,
    ]);
    await expectPgError(
      asUser(admin, (c) => c.query("select public.send_member_message($1, 'Ainda está aí?')", [r.conversation_id])),
      "outside_service_window",
    );
  });

  it("estado de entrega nunca retrocede", async () => {
    const r = await inbound("+351910000021");
    await aiReply(r.conversation_id);
    const { rows } = await pool.query(
      "select id from public.messages where conversation_id = $1 and author = 'ai' order by created_at desc limit 1",
      [r.conversation_id],
    );
    const wamid = `wamid.${randomUUID()}`;
    await asService((c) => c.query("select public.mark_message_sent($1, $2)", [rows[0].id, wamid]));
    await asService((c) => c.query("select public.update_message_status($1, 'read')", [wamid]));
    await asService((c) => c.query("select public.update_message_status($1, 'delivered')", [wamid]));
    const s = await pool.query("select status from public.messages where id = $1", [rows[0].id]);
    expect(s.rows[0].status).toBe("read");
  });

  it("notas internas: só com permissão e em nome próprio", async () => {
    const r = await inbound("+351910000022");
    await asUser(admin, (c) =>
      c.query("insert into public.internal_notes (organization_id, conversation_id, author_user_id, body) values ($1, $2, $3, 'Cliente já tem processo')", [
        org,
        r.conversation_id,
        admin.id,
      ]),
    );
    const other = await createUser();
    await expectPgError(
      asUser(admin, (c) =>
        c.query("insert into public.internal_notes (organization_id, conversation_id, author_user_id, body) values ($1, $2, $3, 'x')", [
          org,
          r.conversation_id,
          other.id,
        ]),
      ),
      /row-level security/,
    );
  });
});

describe("isolamento e separação de dados", () => {
  it("outro escritório não vê contactos, conversas, mensagens nem notas", async () => {
    await inbound("+351910000030");
    const outsider = await createUser();
    await createOrg(outsider, "Outro escritório");
    const seen = await asUser(outsider, async (c) => {
      const q = (t: string) => c.query(`select 1 from public.${t} where organization_id = $1`, [org]);
      return {
        contacts: (await q("contacts")).rowCount,
        conversations: (await q("conversations")).rowCount,
        messages: (await q("messages")).rowCount,
        notes: (await q("internal_notes")).rowCount,
        whatsapp: (await q("whatsapp_accounts")).rowCount,
      };
    });
    expect(seen).toEqual({ contacts: 0, conversations: 0, messages: 0, notes: 0, whatsapp: 0 });
  });

  it("gestor de marketing do próprio escritório não vê conversas nem contactos", async () => {
    const mkt = await createUser("Marketing");
    await addMember(admin, org, mkt, "marketing_manager");
    const seen = await asUser(mkt, async (c) => ({
      contacts: (await c.query("select 1 from public.contacts where organization_id = $1", [org])).rowCount,
      conversations: (await c.query("select 1 from public.conversations where organization_id = $1", [org])).rowCount,
      messages: (await c.query("select 1 from public.messages where organization_id = $1", [org])).rowCount,
    }));
    expect(seen).toEqual({ contacts: 0, conversations: 0, messages: 0 });
  });

  it("o token do WhatsApp nunca é legível pelos utilizadores", async () => {
    await expectPgError(
      asUser(admin, (c) => c.query("select token_secret_id from public.whatsapp_accounts where organization_id = $1", [org])),
      /permission denied/,
    );
  });
});

describe("eliminação de contacto (RGPD)", () => {
  it("apaga contacto e histórico, exige motivo e audita sem dados pessoais", async () => {
    const r = await inbound("+351910000040", undefined, "Dados sensíveis aqui");
    const { rows } = await pool.query("select contact_id from public.conversations where id = $1", [r.conversation_id]);
    const contact = rows[0].contact_id;
    await expectPgError(
      asUser(admin, (c) => c.query("select public.erase_contact($1, '')", [contact])),
      "reason_required",
    );
    await asUser(admin, (c) => c.query("select public.erase_contact($1, 'Pedido do titular por email')", [contact]));
    const left = await pool.query("select count(*)::int as n from public.messages where conversation_id = $1", [
      r.conversation_id,
    ]);
    expect(left.rows[0].n).toBe(0);
    const audit = await pool.query(
      "select metadata::text as m from public.audit_logs where action = 'contact.erased' and entity_id = $1",
      [contact],
    );
    expect(audit.rows[0].m).not.toContain("+351910000040");
  });

  it("assistente jurídico não pode eliminar contactos", async () => {
    const assistant = await createUser();
    await addMember(admin, org, assistant, "legal_assistant");
    const r = await inbound("+351910000041");
    const { rows } = await pool.query("select contact_id from public.conversations where id = $1", [r.conversation_id]);
    await expectPgError(
      asUser(assistant, (c) => c.query("select public.erase_contact($1, 'teste')", [rows[0].contact_id])),
      "forbidden",
    );
  });
});

describe("modo de simulação", () => {
  it("permite simular mensagens recebidas e envios em modo simulação", async () => {
    const res = await asUser(admin, async (c) =>
      (
        await c.query("select * from public.simulate_inbound_message($1, '+351910000050', 'Olá, preciso de ajuda', 'Teste')", [org])
      ).rows[0],
    );
    expect(res.agent_should_reply).toBe(true);
    await asUser(admin, (c) => c.query("select public.take_over_conversation($1)", [res.conversation_id]));
    const msg = await asUser(admin, async (c) =>
      (await c.query("select public.send_member_message($1, 'Bom dia') as id", [res.conversation_id])).rows[0].id,
    );
    await asUser(admin, (c) => c.query("select public.mark_simulated_sent($1)", [msg]));
    const { rows } = await pool.query("select status from public.messages where id = $1", [msg]);
    expect(rows[0].status).toBe("sent");
  });

  it("não funciona em contas reais nem sem permissão", async () => {
    const assistant = await createUser();
    await addMember(admin, org, assistant, "legal_assistant");
    await expectPgError(
      asUser(assistant, (c) => c.query("select * from public.simulate_inbound_message($1, '+351910000051', 'x')", [org])),
      "forbidden",
    );
    await pool.query("update public.whatsapp_accounts set mode = 'live', token_secret_id = gen_random_uuid() where organization_id = $1", [org]);
    try {
      await expectPgError(
        asUser(admin, (c) => c.query("select * from public.simulate_inbound_message($1, '+351910000052', 'x')", [org])),
        "simulation_only",
      );
    } finally {
      await pool.query("update public.whatsapp_accounts set mode = 'simulation', token_secret_id = null where organization_id = $1", [org]);
    }
  });
});
