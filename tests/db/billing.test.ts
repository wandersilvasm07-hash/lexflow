import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createOrg, createUser, expectPgError, pool, setPlan, type TestUser } from "./helpers";

/**
 * Critérios da Fase 6 (secções 16 e 17):
 *  - planos, preços e limites configuráveis (tabela), editáveis só pela plataforma;
 *  - limites aplicados no servidor (membros, IA, campanhas, documentos);
 *  - subscrição inativa: IA e publicação param, dados continuam acessíveis;
 *  - só o servidor (webhook) muda a subscrição; eventos repetidos não duplicam;
 *  - retenção, eliminação do escritório com confirmação e registo.
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

const overview = (u: TestUser, org: string) =>
  asUser(u, async (c) => (await c.query("select public.org_billing_overview($1) as o", [org])).rows[0].o as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

const entitlement = (org: string) =>
  asService(async (c) => (await c.query("select public.agent_entitlement($1) as e", [org])).rows[0].e as { allowed: boolean; reason?: string });

async function testPlan(id: string, limits: Record<string, number>) {
  await pool.query(
    `insert into public.plans (id, name, limits, is_public) values ($1, 'Plano de teste', $2, false)
     on conflict (id) do update set limits = excluded.limits`,
    [id, JSON.stringify(limits)],
  );
}

let admin: TestUser;
let outsider: TestUser;
let org: string;

beforeAll(async () => {
  admin = await createUser("Admin");
  outsider = await createUser("Outro");
  org = await createOrg(admin);
  await createOrg(outsider);
});

describe("planos e subscrição", () => {
  it("escritório novo começa com 14 dias de teste no Profissional; outros não veem", async () => {
    const o = await overview(admin, org);
    expect(o.plan).toBe("profissional");
    expect(o.status).toBe("trialing");
    expect(o.active).toBe(true);
    const days = (Date.parse(o.trial_ends_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
    await expectPgError(overview(outsider, org), /forbidden/);
    const subs = await asUser(outsider, async (c) => (await c.query("select * from public.subscriptions where organization_id = $1", [org])).rowCount);
    expect(subs).toBe(0);
  });

  it("os planos são lidos por todos mas só a plataforma os altera", async () => {
    const plans = await asUser(admin, async (c) => (await c.query("select id from public.plans order by position")).rows.map((r) => r.id));
    expect(plans).toEqual(["essencial", "profissional", "premium"]);
    // Sem política de escrita: a alteração não toca em nenhuma linha.
    const touched = await asUser(admin, async (c) => (await c.query("update public.plans set price_cents = 0 where id = 'premium'").catch(() => ({ rowCount: 0 }))).rowCount);
    expect(touched).toBe(0);
    expect((await pool.query("select price_cents from public.plans where id = 'premium'")).rows[0].price_cents).toBe(19900);
    const args = ["premium", "Premium", null, 0, null, "{}", "[]", true, 3];
    const call = "select public.admin_upsert_plan($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)";
    await expectPgError(asUser(admin, (c) => c.query(call, args)), /forbidden/);

    const platform = await createUser("Plataforma");
    await pool.query("insert into public.platform_admins (user_id) values ($1)", [platform.id]);
    await expectPgError(
      asUser(platform, (c) => c.query(call, ["x-plan", "Plano X", null, 100, null, '{"inventado": 1}', "[]", false, 9])),
      /invalid_limit_key/,
    );
    await asUser(platform, (c) => c.query(call, ["x-plan", "Plano X", null, 100, "price_ABC123", '{"members": 3}', "[]", false, 9]));
    const { rows } = await pool.query("select price_cents, limits, stripe_price_id from public.plans where id = 'x-plan'");
    expect(rows[0]).toMatchObject({ price_cents: 100, limits: { members: 3 }, stripe_price_id: "price_ABC123" });
    const audit = await pool.query("select 1 from public.audit_logs where action = 'platform.plan_updated' and entity_id = 'x-plan'");
    expect(audit.rowCount).toBe(1);
  });

  it("o utilizador não consegue mudar a própria subscrição", async () => {
    await asUser(admin, (c) =>
      c.query("update public.subscriptions set plan_id = 'premium', status = 'active' where organization_id = $1", [org]).catch(() => null),
    );
    expect((await pool.query("select plan_id, status from public.subscriptions where organization_id = $1", [org])).rows[0]).toEqual({
      plan_id: "profissional",
      status: "trialing",
    });
    await expectPgError(
      asUser(admin, (c) => c.query("select public.billing_sync_subscription('cus_X', 'sub_X', 'price_X', 'active', now(), false, $1)", [org])),
      /permission denied/,
    );
  });
});

describe("limites do plano", () => {
  it("membros: o convite acima do limite é recusado (contando convites pendentes)", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await setPlan(o, "essencial"); // 2 membros
    const m1 = await createUser();
    await addMember(owner, o, m1, "lawyer");
    await expectPgError(
      asUser(owner, (c) => c.query("select public.create_invitation($1, 'novo@teste.local', 'viewer'::public.org_role)", [o])),
      /plan_limit:members/,
    );
    await setPlan(o, "profissional");
    await asUser(owner, (c) => c.query("select public.create_invitation($1, 'novo@teste.local', 'viewer'::public.org_role)", [o]));
  });

  it("respostas da IA: conta só chamadas reais ao modelo neste mês", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await testPlan("teste-ia", { ai_replies_month: 2 });
    await setPlan(o, "teste-ia");
    await asUser(owner, (c) => c.query("select public.enable_whatsapp_simulation($1)", [o]));
    const conv = await asUser(owner, async (c) =>
      (await c.query("select conversation_id from public.simulate_inbound_message($1, '+351910000077', 'Olá', 'T')", [o])).rows[0].conversation_id as string,
    );
    const run = (tokens: number | null, when = "now()") =>
      pool.query(
        `insert into public.agent_runs (organization_id, conversation_id, model, decision, input_tokens, output_tokens, created_at)
         values ($1, $2, 'm', 'asked', $3, 10, ${when})`,
        [o, conv, tokens],
      );
    await run(100);
    await run(null); // falha sem chamada ao modelo: não conta
    await run(100, "now() - interval '40 days'"); // mês anterior: não conta
    expect((await entitlement(o)).allowed).toBe(true);
    await run(100);
    expect(await entitlement(o)).toEqual({ allowed: false, reason: "plan_limit:ai_replies_month" });
    const ov = await overview(owner, o);
    expect(ov.usage.ai_replies_month).toBe(2);
    expect(ov.usage.ai_tokens_month).toBe(230);
  });

  it("documentos jurídicos privados acima do limite são recusados", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await testPlan("teste-docs", { knowledge_docs: 1 });
    await setPlan(o, "teste-docs");
    const doc = (title: string) =>
      asUser(owner, (c) =>
        c.query(
          "select public.create_knowledge_document($1, $2::jsonb, 'Texto do documento de teste.', '[{\"heading\": \"S1\", \"content\": \"Texto do documento de teste.\"}]'::jsonb)",
          [o, JSON.stringify({ title, category: "reagrupamento_familiar", source_name: "Fonte", source_url: "https://exemplo.gov.pt/x" })],
        ),
      );
    await doc("Primeiro");
    await expectPgError(doc("Segundo"), /plan_limit:knowledge_docs/);
  });

  it("subscrição inativa: a IA e os convites param, os dados continuam acessíveis", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await pool.query("update public.subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = $1", [o]);
    expect(await entitlement(o)).toEqual({ allowed: false, reason: "subscription_inactive" });
    const ov = await overview(owner, o);
    expect(ov).toMatchObject({ active: false, reason: "trial_expired" });
    await expectPgError(
      asUser(owner, (c) => c.query("select public.create_invitation($1, 'x@teste.local', 'viewer'::public.org_role)", [o])),
      /subscription_inactive/,
    );
    const read = await asUser(owner, async (c) => (await c.query("select id from public.organizations where id = $1", [o])).rowCount);
    expect(read).toBe(1);

    // Pagamento em atraso: 7 dias de tolerância.
    await pool.query(
      "update public.subscriptions set status = 'past_due', current_period_end = now() - interval '3 days' where organization_id = $1",
      [o],
    );
    expect((await entitlement(o)).allowed).toBe(true);
    await pool.query("update public.subscriptions set current_period_end = now() - interval '8 days' where organization_id = $1", [o]);
    expect((await entitlement(o)).allowed).toBe(false);
  });
});

describe("Stripe (servidor)", () => {
  it("eventos repetidos não se aplicam duas vezes", async () => {
    const first = await asService(async (c) => (await c.query("select public.billing_register_event('evt_1', 'x') as n")).rows[0].n);
    const again = await asService(async (c) => (await c.query("select public.billing_register_event('evt_1', 'x') as n")).rows[0].n);
    expect([first, again]).toEqual([true, false]);
  });

  it("sincroniza plano e estado pelo preço; preço desconhecido é recusado; fica auditado", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await pool.query("update public.plans set stripe_price_id = 'price_Prem1' where id = 'premium'");
    await asService((c) => c.query("select public.billing_set_customer($1, 'cus_Abc1')", [o]));
    await expectPgError(
      asService((c) => c.query("select public.billing_sync_subscription('cus_Abc1', 'sub_1', 'price_Nope', 'active', now(), false)")),
      /unknown_price/,
    );
    await asService((c) =>
      c.query("select public.billing_sync_subscription('cus_Abc1', 'sub_1', 'price_Prem1', 'active', now() + interval '30 days', false)"),
    );
    expect(await overview(owner, o)).toMatchObject({ plan: "premium", status: "active", active: true });
    const audit = await pool.query(
      "select metadata from public.audit_logs where organization_id = $1 and action = 'billing.subscription_changed'",
      [o],
    );
    expect(audit.rows[0].metadata).toMatchObject({ from_plan: "profissional", to_plan: "premium" });

    // Outro escritório não pode "apanhar" este cliente do Stripe.
    const other = await createOrg(owner);
    await expectPgError(asService((c) => c.query("select public.billing_set_customer($1, 'cus_Abc1')", [other])), /duplicate|unique/);
    await expectPgError(
      asService((c) =>
        c.query("select public.billing_sync_subscription('cus_Abc1', 'sub_1', 'price_Prem1', 'active', now(), false, $1)", [other]),
      ),
      /customer_mismatch/,
    );

    // Cancelamento: subscrição inativa.
    await asService((c) => c.query("select public.billing_sync_subscription('cus_Abc1', 'sub_1', 'price_Prem1', 'canceled', now(), false)"));
    expect(await overview(owner, o)).toMatchObject({ status: "canceled", active: false });
  });

  it("faturas só visíveis a quem gere a faturação", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    const viewer = await createUser();
    await addMember(owner, o, viewer, "viewer");
    await asService((c) => c.query("select public.billing_set_customer($1, 'cus_Inv1')", [o]));
    await asService((c) =>
      c.query(
        "select public.billing_record_invoice('cus_Inv1', 'in_1', 'A-001', 'paid', 9900, 9900, 'eur', 'https://pay.stripe.com/x', null, now(), now())",
      ),
    );
    await asService((c) =>
      c.query(
        "select public.billing_record_invoice('cus_Inv1', 'in_1', 'A-001', 'paid', 9900, 9900, 'eur', 'https://pay.stripe.com/x', null, now(), now())",
      ),
    );
    const mine = await asUser(owner, async (c) => (await c.query("select number, amount_paid_cents from public.invoices")).rows);
    expect(mine).toEqual([{ number: "A-001", amount_paid_cents: 9900 }]);
    const theirs = await asUser(viewer, async (c) => (await c.query("select 1 from public.invoices")).rowCount);
    expect(theirs).toBe(0);
  });
});

describe("RGPD", () => {
  it("retenção: apaga só conversas fechadas e antigas, segundo o prazo do escritório", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await asUser(owner, (c) => c.query("select public.enable_whatsapp_simulation($1)", [o]));
    const mk = async (phone: string) =>
      asUser(owner, async (c) =>
        (await c.query("select conversation_id from public.simulate_inbound_message($1, $2, 'Olá', 'T')", [o, phone])).rows[0]
          .conversation_id as string,
      );
    const oldClosed = await mk("+351910000081");
    const oldOpen = await mk("+351910000082");
    const recentClosed = await mk("+351910000083");
    await pool.query(
      "update public.conversations set status = 'closed', last_message_at = now() - interval '7 months' where id = $1",
      [oldClosed],
    );
    await pool.query("update public.conversations set last_message_at = now() - interval '7 months' where id = $1", [oldOpen]);
    await pool.query("update public.conversations set status = 'closed' where id = $1", [recentClosed]);

    await expectPgError(asUser(owner, (c) => c.query("select public.update_retention($1, 3)", [o])), /check/);
    await asUser(owner, (c) => c.query("select public.update_retention($1, 6)", [o]));
    await expectPgError(asUser(owner, (c) => c.query("select public.apply_retention()")), /permission denied/);
    await asService((c) => c.query("select public.apply_retention()"));
    const left = await pool.query("select id from public.conversations where organization_id = $1", [o]);
    expect(left.rows.map((r) => r.id).sort()).toEqual([oldOpen, recentClosed].sort());
  });

  it("eliminar o escritório: só o administrador, com confirmação do endereço; fica registado", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    const lawyer = await createUser();
    await addMember(owner, o, lawyer, "lawyer");
    const slug = (await pool.query("select slug from public.organizations where id = $1", [o])).rows[0].slug as string;
    await expectPgError(asUser(lawyer, (c) => c.query("select public.delete_organization($1, $2, 'x')", [o, slug])), /forbidden|permission/);
    await expectPgError(asUser(owner, (c) => c.query("select public.delete_organization($1, 'outro', 'x')", [o])), /confirmation_mismatch/);
    await asUser(owner, (c) => c.query("select public.delete_organization($1, $2, 'Fecho do escritório')", [o, slug]));
    expect((await pool.query("select 1 from public.organizations where id = $1", [o])).rowCount).toBe(0);
    expect((await pool.query("select 1 from public.subscriptions where organization_id = $1", [o])).rowCount).toBe(0);
    const log = await pool.query("select slug, deleted_by from public.organization_deletions where organization_id = $1", [o]);
    expect(log.rows[0]).toEqual({ slug, deleted_by: owner.id });
  });

  it("não elimina com uma subscrição paga ativa (tem de ser cancelada primeiro)", async () => {
    const owner = await createUser();
    const o = await createOrg(owner);
    await pool.query("update public.subscriptions set stripe_subscription_id = 'sub_live1', status = 'active' where organization_id = $1", [o]);
    const slug = (await pool.query("select slug from public.organizations where id = $1", [o])).rows[0].slug as string;
    await expectPgError(asUser(owner, (c) => c.query("select public.delete_organization($1, $2, 'x')", [o, slug])), /subscription_active/);
  });
});
