import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, expectPgError, pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const submit = (email: string, consent = true) =>
  asUser(null, (c) =>
    c.query("select public.submit_demo_request('Ana Teste', $1, 'Escritório X', null, null, $2)", [
      email,
      consent,
    ]),
  );

describe("pedidos de demonstração", () => {
  it("visitante anónimo consegue submeter, mas não ler", async () => {
    const email = `demo-${randomUUID().slice(0, 6)}@teste.local`;
    await submit(email);
    await expectPgError(
      asUser(null, (c) => c.query("select * from public.demo_requests")),
      /permission denied/,
    );
  });

  it("utilizadores normais não veem pedidos; só admins da plataforma", async () => {
    const email = `demo-${randomUUID().slice(0, 6)}@teste.local`;
    await submit(email);
    const user = await createUser();
    const seen = await asUser(user, async (c) =>
      (await c.query("select 1 from public.demo_requests where email = $1", [email])).rowCount,
    );
    expect(seen).toBe(0);

    await pool.query("insert into public.platform_admins (user_id) values ($1)", [user.id]);
    const seenAsAdmin = await asUser(user, async (c) =>
      (await c.query("select 1 from public.demo_requests where email = $1", [email])).rowCount,
    );
    expect(seenAsAdmin).toBe(1);
  });

  it("exige consentimento e email válido", async () => {
    await expectPgError(submit("ok@teste.local", false), "consent_required");
    await expectPgError(submit("nao-e-email"), "invalid_email");
  });

  it("limita pedidos repetidos do mesmo email", async () => {
    const email = `demo-${randomUUID().slice(0, 6)}@teste.local`;
    await submit(email);
    await submit(email);
    await submit(email);
    await expectPgError(submit(email), "rate_limited");
  });
});
