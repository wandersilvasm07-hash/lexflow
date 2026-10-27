import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createOrg, createUser, expectPgError, pool, type TestUser } from "./helpers";

/**
 * Critérios da Fase 4 (secção 13):
 *  - prevenção de marcações duplicadas (na base de dados, mesmo em simultâneo);
 *  - a IA só propõe e marca horários realmente livres;
 *  - não há marcação confirmada antes de estar gravada;
 *  - relatórios só com agregados; isolamento entre escritórios.
 */

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

/** Instante para "daqui a N dias, às HH:MM em Lisboa". */
async function lisbon(days: number, hhmm: string): Promise<string> {
  const { rows } = await pool.query(
    "select (((current_date + $1::int) + $2::time) at time zone 'Europe/Lisbon') as ts",
    [days, hhmm],
  );
  return (rows[0].ts as Date).toISOString();
}

let admin: TestUser;
let lawyer: TestUser;
let org: string;
let service: string;
let contact: string;

async function newContact(o = org) {
  const { rows } = await pool.query(
    "insert into public.contacts (organization_id, full_name, phone_e164) values ($1, 'Cliente', $2) returning id",
    [o, `+3519${Math.floor(10000000 + Math.random() * 89999999)}`],
  );
  return rows[0].id as string;
}

const book = (u: TestUser, c: string, prof: string, at: string, outside = false) =>
  asUser(u, async (cl) =>
    (
      await cl.query("select public.book_appointment($1, $2, $3, $4, $5, null, null, $6) as id", [
        org,
        c,
        service,
        prof,
        at,
        outside,
      ])
    ).rows[0].id as string,
  );

const slots = (u: TestUser, from: string, to: string, prof: string | null = null) =>
  asUser(u, async (c) =>
    (
      await c.query("select * from public.available_slots($1, $2, $3, $4, $5)", [org, service, from, to, prof])
    ).rows.map((r) => ({ prof: r.professional_id as string, at: (r.starts_at as Date).toISOString() })),
  );

beforeAll(async () => {
  admin = await createUser("Admin");
  lawyer = await createUser("Advogada");
  org = await createOrg(admin, "Escritório Agenda");
  await addMember(admin, org, lawyer, "lawyer");
  await pool.query("update public.organizations set timezone = 'Europe/Lisbon' where id = $1", [org]);

  service = await asUser(admin, async (c) =>
    (
      await c.query(
        "insert into public.services (organization_id, name, duration_minutes, min_notice_minutes) values ($1, 'Consulta de imigração', 60, 0) returning id",
        [org],
      )
    ).rows[0].id as string,
  );
  // Ambos disponíveis todos os dias das 09:00 às 13:00 (independente do dia da semana do teste).
  for (const u of [admin, lawyer]) {
    for (let d = 1; d <= 7; d++) {
      await asUser(u, (c) =>
        c.query(
          "insert into public.availability_rules (organization_id, user_id, weekday, start_time, end_time) values ($1, $2, $3, '09:00', '13:00')",
          [org, u.id, d],
        ),
      );
    }
  }
  contact = await newContact();
});

afterAll(async () => {
  await pool.end();
});

describe("horários livres", () => {
  it("gera inícios de 30 em 30 minutos dentro do horário, no fuso de Lisboa", async () => {
    const from = await lisbon(3, "00:00");
    const to = await lisbon(4, "00:00");
    const free = await slots(admin, from, to, admin.id);
    const expected = await Promise.all(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"].map((h) => lisbon(3, h)));
    expect(free.map((s) => s.at)).toEqual(expected);
  });

  it("uma marcação retira o horário e os que se sobrepõem", async () => {
    const at = await lisbon(4, "10:00");
    await book(admin, contact, admin.id, at);
    const free = await slots(admin, await lisbon(4, "00:00"), await lisbon(5, "00:00"), admin.id);
    const taken = await Promise.all(["09:30", "10:00", "10:30"].map((h) => lisbon(4, h)));
    for (const t of taken) expect(free.map((s) => s.at)).not.toContain(t);
    expect(free.map((s) => s.at)).toContain(await lisbon(4, "11:00"));
  });

  it("um bloqueio (ausência) retira horários", async () => {
    await asUser(lawyer, (c) =>
      c.query(
        "insert into public.availability_blocks (organization_id, user_id, starts_at, ends_at, reason) values ($1, $2, $3, $4, 'Tribunal')",
        [org, lawyer.id, `${new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)}T00:00:00Z`, `${new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10)}T00:00:00Z`],
      ),
    );
    const free = await slots(admin, await lisbon(5, "08:00"), await lisbon(5, "14:00"), lawyer.id);
    expect(free).toHaveLength(0);
    await expectPgError(book(admin, contact, lawyer.id, await lisbon(5, "10:00")), "slot_unavailable");
  });
});

describe("prevenção de marcações duplicadas", () => {
  it("o mesmo horário não pode ser marcado duas vezes, nem forçando fora do horário", async () => {
    const at = await lisbon(6, "09:00");
    await book(admin, contact, lawyer.id, at);
    await expectPgError(book(admin, await newContact(), lawyer.id, at), "slot_unavailable");
    await expectPgError(book(admin, await newContact(), lawyer.id, at, true), "slot_unavailable");
  });

  it("sobreposição parcial também é recusada pela base de dados", async () => {
    await book(admin, contact, lawyer.id, await lisbon(7, "10:00"));
    await expectPgError(book(admin, await newContact(), lawyer.id, await lisbon(7, "10:30"), true), "slot_unavailable");
  });

  it("duas marcações em simultâneo: só uma fica gravada", async () => {
    const at = await lisbon(8, "11:00");
    const results = await Promise.allSettled([
      book(admin, await newContact(), admin.id, at, true),
      book(lawyer, await newContact(), admin.id, at, true),
      book(admin, await newContact(), admin.id, at, true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await pool.query(
      "select count(*)::int as n from public.appointments where professional_id = $1 and starts_at = $2 and status in ('booked','confirmed')",
      [admin.id, at],
    );
    expect(rows[0].n).toBe(1);
  });

  it("outro profissional pode ter marcação à mesma hora", async () => {
    const at = await lisbon(9, "09:00");
    await book(admin, contact, admin.id, at);
    await book(admin, await newContact(), lawyer.id, at);
  });

  it("cancelar liberta o horário", async () => {
    const at = await lisbon(10, "12:00");
    const id = await book(admin, contact, admin.id, at);
    await expectPgError(book(admin, await newContact(), admin.id, at), "slot_unavailable");
    await asUser(admin, (c) => c.query("select public.set_appointment_status($1, 'cancelled', 'Cliente pediu')", [id]));
    await book(admin, await newContact(), admin.id, at);
  });

  it("não se marca no passado nem se dá como realizada antes de acontecer", async () => {
    await expectPgError(book(admin, contact, admin.id, new Date(Date.now() - 36e5).toISOString(), true), "slot_in_past");
    const id = await book(admin, contact, admin.id, await lisbon(11, "09:00"));
    await expectPgError(
      asUser(admin, (c) => c.query("select public.set_appointment_status($1, 'completed')", [id])),
      "appointment_not_started",
    );
  });

  it("só membros com calendar.write marcam; viewer não", async () => {
    const viewer = await createUser("Consulta");
    await addMember(admin, org, viewer, "viewer");
    await expectPgError(book(viewer, contact, admin.id, await lisbon(12, "09:00")), "forbidden");
    await expectPgError(
      asUser(admin, (c) =>
        c.query(
          "insert into public.appointments (organization_id, contact_id, professional_id, starts_at, ends_at) values ($1, $2, $3, now() + interval '30 days', now() + interval '30 days 1 hour')",
          [org, contact, admin.id],
        ),
      ),
      /permission denied/,
    );
  });
});

describe("assistente: só horários livres e só depois de gravado", () => {
  let conv: string;

  beforeAll(async () => {
    await asUser(admin, (c) => c.query("select public.enable_whatsapp_simulation($1)", [org]));
    await asUser(admin, (c) => c.query("select public.set_agent_enabled($1, true)", [org]));
    const { rows } = await pool.query("select phone_number_id from public.whatsapp_accounts where organization_id = $1", [org]);
    conv = await asService(async (c) =>
      (
        await c.query("select * from public.ingest_inbound_message($1, '+351910009999', $2, 'Quero marcar consulta', now())", [
          rows[0].phone_number_id,
          `wamid.${randomUUID()}`,
        ])
      ).rows[0].conversation_id as string,
    );
  });

  it("propõe horários livres, um por hora, e marca", async () => {
    const free = await asService(async (c) => (await c.query("select * from public.agent_free_slots($1, null, 4)", [org])).rows);
    expect(free.length).toBe(4);
    expect(new Set(free.map((f) => (f.starts_at as Date).toISOString())).size).toBe(4);
    expect(free[0].service_name).toBe("Consulta de imigração");

    const at = free[0].starts_at as Date;
    const r = await asService(async (c) =>
      (await c.query("select * from public.agent_book_appointment($1, $2, $3, 'Ana Cliente')", [conv, service, at])).rows[0],
    );
    expect(r.appointment_id).toBeTruthy();
    const { rows } = await pool.query(
      `select a.source, a.conversation_id, k.status as contact_status, k.full_name, v.category
         from public.appointments a join public.contacts k on k.id = a.contact_id
         join public.conversations v on v.id = a.conversation_id where a.id = $1`,
      [r.appointment_id],
    );
    expect(rows[0]).toEqual({
      source: "ai",
      conversation_id: conv,
      contact_status: "consultation_booked",
      full_name: "Ana Cliente", // o contacto não tinha nome; o assistente preencheu o indicado
      category: "consultation",
    });
  });

  it("não marca num horário que não está livre", async () => {
    const taken = await lisbon(4, "10:00"); // admin ocupado; advogada livre → escolhe a advogada
    const ok = await asService(async (c) =>
      (await c.query("select * from public.agent_book_appointment($1, $2, $3)", [conv, service, taken])).rows[0],
    );
    expect(ok.appointment_id).toBeTruthy();
    // Agora ambos estão ocupados a essa hora.
    await expectPgError(
      asService((c) => c.query("select * from public.agent_book_appointment($1, $2, $3)", [conv, service, taken])),
      "slot_unavailable",
    );
    // Fora do horário de trabalho.
    await expectPgError(
      asService(async (c) => c.query("select * from public.agent_book_appointment($1, $2, $3)", [conv, service, await lisbon(13, "20:00")])),
      "slot_unavailable",
    );
  });

  it("não marca depois de um profissional assumir a conversa", async () => {
    await asUser(admin, (c) => c.query("select public.take_over_conversation($1)", [conv]));
    await expectPgError(
      asService(async (c) => c.query("select * from public.agent_book_appointment($1, $2, $3)", [conv, service, await lisbon(14, "09:00")])),
      "conversation_taken_over",
    );
  });

  it("serviços marcados como 'não marcável pela IA' ficam de fora", async () => {
    await pool.query("update public.services set bookable_by_ai = false where id = $1", [service]);
    try {
      const free = await asService(async (c) => (await c.query("select * from public.agent_free_slots($1)", [org])).rows);
      expect(free).toHaveLength(0);
    } finally {
      await pool.query("update public.services set bookable_by_ai = true where id = $1", [service]);
    }
  });

  it("utilizadores não chamam as funções do assistente", async () => {
    await expectPgError(
      asUser(admin, (c) => c.query("select * from public.agent_free_slots($1)", [org])),
      /permission denied/,
    );
  });
});

describe("isolamento, contactos e relatórios", () => {
  it("outro escritório não vê marcações, horários nem serviços", async () => {
    const outsider = await createUser();
    await createOrg(outsider, "Outro");
    const seen = await asUser(outsider, async (c) => ({
      appointments: (await c.query("select 1 from public.appointments where organization_id = $1", [org])).rowCount,
      rules: (await c.query("select 1 from public.availability_rules where organization_id = $1", [org])).rowCount,
      services: (await c.query("select 1 from public.services where organization_id = $1", [org])).rowCount,
    }));
    expect(seen).toEqual({ appointments: 0, rules: 0, services: 0 });
    await expectPgError(
      asUser(outsider, async (c) => c.query("select * from public.available_slots($1, $2, now(), now() + interval '7 days')", [org, service])),
      "forbidden",
    );
  });

  it("não se marca com um contacto de outro escritório", async () => {
    const outsider = await createUser();
    const otherOrg = await createOrg(outsider, "Outro 2");
    const foreignContact = await newContact(otherOrg);
    await expectPgError(book(admin, foreignContact, admin.id, await lisbon(15, "09:00")), "not_found");
  });

  it("um profissional não altera o horário de outro (exceto quem gere definições)", async () => {
    const n = await asUser(lawyer, async (c) =>
      (await c.query("delete from public.availability_rules where user_id = $1", [admin.id])).rowCount,
    );
    expect(n).toBe(0);
  });

  it("o escritório e o telefone de origem de um contacto não se alteram por update direto", async () => {
    await expectPgError(
      asUser(admin, (c) => c.query("update public.contacts set organization_id = gen_random_uuid() where id = $1", [contact])),
      /permission denied/,
    );
    const ok = await asUser(admin, async (c) =>
      (await c.query("update public.contacts set next_action = 'Ligar amanhã' where id = $1", [contact])).rowCount,
    );
    expect(ok).toBe(1);
  });

  it("relatório devolve agregados e o gestor de marketing não vê marcações individuais", async () => {
    const mkt = await createUser("Marketing");
    await addMember(admin, org, mkt, "marketing_manager");
    const report = await asUser(mkt, async (c) =>
      (
        await c.query("select public.report_overview($1, now() - interval '1 day', now() + interval '1 day') as r", [org])
      ).rows[0].r as Record<string, unknown>,
    );
    expect(Number(report.appointments_booked)).toBeGreaterThan(0);
    expect(Number(report.appointments_booked_by_ai)).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("+351");
    const visible = await asUser(mkt, async (c) =>
      (await c.query("select 1 from public.appointments where organization_id = $1", [org])).rowCount,
    );
    expect(visible).toBe(0);
  });
});
