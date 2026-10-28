import type { PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createOrg, createUser, expectPgError, pool, type TestUser } from "./helpers";

/**
 * Critérios da Fase 5 (secções 14, 15 e 18):
 *  - orçamentos publicitários não ultrapassam os limites configurados;
 *  - uma campanha não é publicada sem autorização explícita e registada;
 *  - a IA não altera orçamentos; alterações depois de aprovada anulam a aprovação;
 *  - publicação idempotente e sem duplicação;
 *  - métricas só vêm da plataforma; alertas de consumo;
 *  - isolamento entre escritórios e controlo de acesso no servidor.
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

let admin: TestUser;
let marketing: TestUser;
let lawyer: TestUser;
let outsider: TestUser;
let org: string;
let otherOrg: string;

const tomorrow = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

const basics = (over: Record<string, unknown> = {}) => ({
  name: "Reagrupamento familiar — Lisboa",
  service_label: "Consulta de reagrupamento familiar",
  objective: "messages",
  destination: "whatsapp",
  locations: ["Lisboa", "Setúbal"],
  languages: ["pt"],
  daily_budget_cents: 1000,
  total_budget_cents: 10000,
  starts_on: tomorrow(),
  ...over,
});

const ad = (i = 0, over: Record<string, unknown> = {}) => ({
  primary_text: `Precisa de ajuda com o reagrupamento familiar? Fale connosco. (${i})`,
  headline: "Reagrupamento familiar",
  cta: "WHATSAPP_MESSAGE",
  image_path: `org/x/img-${i}.jpg`,
  ...over,
});

const create = (u: TestUser, data = basics(), o = org) =>
  asUser(u, async (c) => (await c.query("select public.create_campaign($1, $2) as id", [o, data])).rows[0].id as string);

const setContent = (u: TestUser, id: string, ads = [ad(0), ad(1)], plan: unknown = null, model: string | null = null) =>
  asUser(u, (c) => c.query("select public.set_campaign_content($1, $2, $3, $4)", [id, JSON.stringify(ads), plan, model]));

const hashOf = (u: TestUser, id: string) =>
  asUser(u, async (c) => (await c.query("select public.campaign_content_hash($1) as h", [id])).rows[0].h as string);

const checkCompliance = async (id: string, issues: unknown[] = []) => {
  const h = await hashOf(admin, id);
  await asService((c) =>
    c.query("select public.record_campaign_compliance($1, $2, $3, null)", [id, h, JSON.stringify({ issues })]),
  );
};

const STATEMENT = "Revi os anúncios e autorizo um gasto máximo de 10,00 €/dia e 100,00 € no total.";

const approve = async (u: TestUser, id: string, over: { hash?: string; daily?: number; total?: number } = {}) => {
  const h = over.hash ?? (await hashOf(u, id));
  return asUser(u, (c) =>
    c.query("select public.approve_campaign($1, $2, $3, $4, $5) as id", [
      id,
      h,
      over.daily ?? 1000,
      over.total ?? 10000,
      STATEMENT,
    ]),
  );
};

const setLimits = (daily = 2000, total = 50000, allDaily = 3000, pct = 80) =>
  asUser(admin, (c) => c.query("select public.update_ad_budget_settings($1, $2, $3, $4, $5)", [org, daily, total, allDaily, pct]));

const status = async (id: string) =>
  (await pool.query("select status from public.campaigns where id = $1", [id])).rows[0].status as string;

const connectAccount = (o = org, u = admin) =>
  asUser(u, async (c) =>
    (
      await c.query("select public.connect_ad_account($1, 'act_123456', 'Conta', 'EUR', '1234567', null, $2, null) as id", [
        o,
        "cifrado:".padEnd(40, "x"),
      ])
    ).rows[0].id as string,
  );

/** Campanha pronta a aprovar (conteúdo, revisão de conformidade). */
async function readyCampaign(data = basics()) {
  const id = await create(marketing, data);
  await setContent(marketing, id);
  await checkCompliance(id);
  return id;
}

beforeAll(async () => {
  admin = await createUser("Admin");
  marketing = await createUser("Marketing");
  lawyer = await createUser("Advogada");
  outsider = await createUser("Outro escritório");
  org = await createOrg(admin, "Escritório A");
  otherOrg = await createOrg(outsider, "Escritório B");
  await addMember(admin, org, marketing, "marketing_manager");
  await addMember(admin, org, lawyer, "lawyer");
});

describe("acesso e isolamento", () => {
  it("só quem tem campaigns.write cria campanhas; outro escritório não vê nada", async () => {
    const id = await create(marketing);
    await expectPgError(create(lawyer), "forbidden");
    await expectPgError(create(outsider, basics(), org), "forbidden");
    const seen = await asUser(outsider, async (c) => (await c.query("select id from public.campaigns where id = $1", [id])).rowCount);
    expect(seen).toBe(0);
    // A advogada pode ver (campaigns.read), mas não escrever diretamente.
    const lawyerSees = await asUser(lawyer, async (c) => (await c.query("select id from public.campaigns where id = $1", [id])).rowCount);
    expect(lawyerSees).toBe(1);
    await expectPgError(
      asUser(marketing, (c) => c.query("update public.campaigns set daily_budget_cents = 999999 where id = $1", [id])),
      "permission denied",
    );
  });

  it("o histórico não pode ser apagado nem forjado", async () => {
    const id = await create(marketing);
    await expectPgError(
      asUser(admin, (c) => c.query("delete from public.campaign_events where campaign_id = $1", [id])),
      "permission denied",
    );
    await expectPgError(
      asUser(admin, (c) =>
        c.query("insert into public.campaign_events (campaign_id, organization_id, kind) values ($1, $2, 'approved')", [id, org]),
      ),
      "permission denied",
    );
  });

  it("o token da conta Meta nunca é legível pelos utilizadores", async () => {
    await connectAccount();
    await expectPgError(
      asUser(admin, (c) => c.query("select token_ciphertext from public.ad_accounts where organization_id = $1", [org])),
      "permission denied",
    );
    const rows = await asUser(admin, async (c) => (await c.query("select external_id, status from public.ad_accounts where organization_id = $1", [org])).rows);
    expect(rows).toEqual([{ external_id: "act_123456", status: "connected" }]);
    await expectPgError(connectAccount(org, lawyer), "forbidden");
  });
});

describe("limites de orçamento", () => {
  it("sem limites definidos pelo escritório, nada é aprovado", async () => {
    const o = await createOrg(admin, "Sem limites");
    const id = await asUser(admin, async (c) => (await c.query("select public.create_campaign($1, $2) as id", [o, basics()])).rows[0].id);
    await asUser(admin, (c) => c.query("select public.set_campaign_content($1, $2, null, null)", [id, JSON.stringify([ad()])]));
    const h = await hashOf(admin, id);
    await asService((c) => c.query("select public.record_campaign_compliance($1, $2, '{\"issues\":[]}', null)", [id, h]));
    await expectPgError(
      asUser(admin, (c) => c.query("select public.approve_campaign($1, $2, 1000, 10000, $3)", [id, h, STATEMENT])),
      "budget_limits_not_set",
    );
  });

  it("só o administrador define limites; acima do limite não se grava nem aprova", async () => {
    await expectPgError(
      asUser(marketing, (c) => c.query("select public.update_ad_budget_settings($1, 99999, 999999, 999999, 80)", [org])),
      "forbidden",
    );
    await setLimits(2000, 50000, 3000);
    await expectPgError(create(marketing, basics({ daily_budget_cents: 2500, total_budget_cents: 30000 })), "budget_daily_over_limit");
    await expectPgError(create(marketing, basics({ daily_budget_cents: 1000, total_budget_cents: 60000 })), "budget_total_over_limit");
    await expectPgError(create(marketing, basics({ daily_budget_cents: 1000, total_budget_cents: 500 })), "check");
    const audit = await pool.query(
      "select count(*)::int as n from public.audit_logs where organization_id = $1 and action = 'ads.budget_limits_updated'",
      [org],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("a soma diária das campanhas em curso respeita o limite global", async () => {
    await setLimits(2000, 50000, 3000);
    const a = await readyCampaign(basics({ name: "Campanha A", daily_budget_cents: 2000, total_budget_cents: 20000 }));
    await approve(admin, a, { daily: 2000, total: 20000 });
    const b = await readyCampaign(basics({ name: "Campanha B", daily_budget_cents: 1500, total_budget_cents: 15000 }));
    await expectPgError(approve(admin, b, { daily: 1500, total: 15000 }), "budget_all_daily_over_limit");
    // Libertar a primeira (anular aprovação) permite aprovar a segunda.
    await asUser(admin, (c) => c.query("select public.revoke_campaign_approval($1, 'teste')", [a]));
    await approve(admin, b, { daily: 1500, total: 15000 });
    expect(await status(b)).toBe("approved");
    await asUser(admin, (c) => c.query("select public.revoke_campaign_approval($1, 'limpeza')", [b]));
  });

  it("baixar os limites depois de aprovar impede a publicação", async () => {
    await setLimits(2000, 50000, 3000);
    const id = await readyCampaign(basics({ name: "Limites baixados" }));
    await approve(admin, id);
    await setLimits(500, 50000, 3000);
    await expectPgError(asUser(admin, (c) => c.query("select public.request_campaign_publish($1)", [id])), "budget_daily_over_limit");
    await setLimits(2000, 50000, 3000);
    await asUser(admin, (c) => c.query("select public.revoke_campaign_approval($1, 'limpeza')", [id]));
  });
});

describe("aprovação explícita", () => {
  beforeAll(() => setLimits(2000, 50000, 5000));

  it("exige revisão de conformidade sobre o conteúdo atual e sem bloqueios", async () => {
    const id = await create(marketing, basics({ name: "Conformidade" }));
    await setContent(marketing, id);
    await expectPgError(approve(admin, id), "compliance_required");
    await checkCompliance(id, [{ severity: "block", code: "promessa", message: "Promete resultados" }]);
    await expectPgError(approve(admin, id), "compliance_blocked");
    await checkCompliance(id, [{ severity: "warn", code: "x", message: "aviso" }]);
    await approve(admin, id);
    expect(await status(id)).toBe("approved");
  });

  it("um resultado de conformidade não pode ser gravado por um utilizador", async () => {
    const id = await create(marketing, basics({ name: "Forjar" }));
    await setContent(marketing, id);
    const h = await hashOf(marketing, id);
    await expectPgError(
      asUser(marketing, (c) => c.query("select public.record_campaign_compliance($1, $2, '{\"issues\":[]}', null)", [id, h])),
      "permission denied",
    );
  });

  it("a revisão feita sobre outro conteúdo não vale", async () => {
    const id = await create(marketing, basics({ name: "Hash antigo" }));
    await setContent(marketing, id);
    const old = await hashOf(admin, id);
    await setContent(marketing, id, [ad(0, { headline: "Outro título" })]);
    await expectPgError(
      asService((c) => c.query("select public.record_campaign_compliance($1, $2, '{\"issues\":[]}', null)", [id, old])),
      "campaign_changed",
    );
  });

  it("o que se aprova é exatamente o que a pessoa viu (conteúdo e orçamento)", async () => {
    const id = await readyCampaign(basics({ name: "Visto" }));
    await expectPgError(approve(admin, id, { hash: "0".repeat(64) }), "campaign_changed");
    await expectPgError(approve(admin, id, { daily: 900 }), "budget_mismatch");
    await expectPgError(
      asUser(admin, async (c) => c.query("select public.approve_campaign($1, $2, 1000, 10000, 'ok')", [id, await hashOf(admin, id)])),
      "statement_required",
    );
    await expectPgError(approve(lawyer, id), "forbidden");
    const r = await approve(admin, id);
    const approval = await pool.query("select * from public.campaign_approvals where id = $1", [r.rows[0].id]);
    expect(approval.rows[0]).toMatchObject({
      approved_by: admin.id,
      daily_budget_cents: 1000,
      total_budget_cents: 10000,
      statement: STATEMENT,
      content_hash: await hashOf(admin, id),
    });
  });

  it("todos os anúncios precisam de imagem antes de aprovar", async () => {
    const id = await create(marketing, basics({ name: "Sem imagem" }));
    await setContent(marketing, id, [ad(0, { image_path: "" })]);
    await checkCompliance(id);
    await expectPgError(approve(admin, id), "missing_images");
  });

  it("alterar depois de aprovada anula a aprovação (incluindo o orçamento)", async () => {
    const id = await readyCampaign(basics({ name: "Alterada" }));
    const r = await approve(admin, id);
    await asUser(marketing, (c) => c.query("select public.update_campaign($1, $2)", [id, basics({ name: "Alterada", daily_budget_cents: 1500, total_budget_cents: 10000 })]));
    expect(await status(id)).toBe("draft");
    const a = await pool.query("select revoked_at from public.campaign_approvals where id = $1", [r.rows[0].id]);
    expect(a.rows[0].revoked_at).not.toBeNull();
    // E a revisão de conformidade antiga já não serve.
    await expectPgError(approve(admin, id, { daily: 1500 }), "compliance_required");
  });

  it("a IA (gravação do plano) não consegue alterar o orçamento", async () => {
    const id = await create(marketing, basics({ name: "IA" }));
    await setContent(
      marketing,
      id,
      [{ ...ad(0), daily_budget_cents: 999999 } as never],
      { estrategia: "x", orcamento_sugerido: "50 €/dia", daily_budget_cents: 999999 },
      "claude-sonnet-5-5",
    );
    const r = await pool.query("select daily_budget_cents, total_budget_cents, plan_model from public.campaigns where id = $1", [id]);
    expect(r.rows[0]).toMatchObject({ daily_budget_cents: 1000, total_budget_cents: 10000, plan_model: "claude-sonnet-5-5" });
    const ev = await pool.query("select kind from public.campaign_events where campaign_id = $1 order by id", [id]);
    expect(ev.rows.map((e) => e.kind)).toEqual(["created", "ai_generated"]);
  });

  it("não aprova em duplicado uma campanha igual já em curso", async () => {
    const a = await readyCampaign(basics({ name: "Gémea" }));
    await approve(admin, a);
    const b = await readyCampaign(basics({ name: "Gémea" }));
    await expectPgError(approve(admin, b), "duplicate_campaign");
    await asUser(admin, (c) => c.query("select public.revoke_campaign_approval($1, 'limpeza')", [a]));
  });
});

describe("publicação idempotente e estado real", () => {
  beforeAll(() => setLimits(2000, 50000, 20000));

  it("plano: campanhas em curso e gerações da IA respeitam os limites; sem subscrição não se publica", async () => {
    await connectAccount();
    const id = await readyCampaign(basics({ name: "Limite do plano", locations: ["Porto"] }));
    await approve(admin, id);
    await pool.query(
      `insert into public.plans (id, name, limits, is_public) values ('teste-camp', 'Teste campanhas', '{"active_campaigns": 0, "ad_generations_month": 0}', false)
       on conflict (id) do update set limits = excluded.limits`,
    );
    const prev = (await pool.query("select plan_id from public.subscriptions where organization_id = $1", [org])).rows[0].plan_id;
    await pool.query("update public.subscriptions set plan_id = 'teste-camp' where organization_id = $1", [org]);
    try {
      await expectPgError(asUser(admin, (c) => c.query("select public.request_campaign_publish($1)", [id])), "plan_limit:active_campaigns");
      await expectPgError(
        asUser(admin, (c) => c.query("select public.set_campaign_content($1, $2::jsonb, '{}'::jsonb, 'm')", [id, JSON.stringify([ad(0)])])),
        "plan_limit:ad_generations_month",
      );
      await pool.query("update public.subscriptions set plan_id = $2, status = 'canceled' where organization_id = $1", [org, prev]);
      await expectPgError(asUser(admin, (c) => c.query("select public.request_campaign_publish($1)", [id])), "subscription_inactive");
    } finally {
      await pool.query("update public.subscriptions set plan_id = $2, status = 'trialing' where organization_id = $1", [org, prev]);
    }
  });

  it("sem aprovação não há publicação", async () => {
    const id = await readyCampaign(basics({ name: "Por aprovar" }));
    await expectPgError(asUser(admin, (c) => c.query("select public.request_campaign_publish($1)", [id])), "not_approved");
    await expectPgError(asUser(marketing, (c) => c.query("select public.request_campaign_publish($1)", [id])), "not_approved");
  });

  it("pedido repetido devolve a mesma chave; só o servidor confirma o estado", async () => {
    await connectAccount();
    const id = await readyCampaign(basics({ name: "Publicar" }));
    await approve(admin, id);
    const r1 = (await asUser(admin, (c) => c.query("select public.request_campaign_publish($1) as r", [id]))).rows[0].r;
    const r2 = (await asUser(admin, (c) => c.query("select public.request_campaign_publish($1) as r", [id]))).rows[0].r;
    expect(r1.already).toBe(false);
    expect(r2).toMatchObject({ already: true, publish_key: r1.publish_key });
    expect(await status(id)).toBe("publishing");

    // O utilizador não consegue marcar como publicada.
    await expectPgError(
      asUser(admin, (c) => c.query("select public.mark_campaign_published($1, $2, 'ACTIVE', '[]')", [id, r1.publish_key])),
      "permission denied",
    );
    // Chave errada (pedido antigo) é recusada.
    await expectPgError(
      asService((c) => c.query("select public.campaign_publish_progress($1, gen_random_uuid(), '{\"campaign\":\"999\"}')", [id])),
      "stale_publish",
    );
    await asService((c) => c.query("select public.campaign_publish_progress($1, $2, '{\"campaign\":\"120200000001\"}')", [id, r1.publish_key]));
    await asService((c) =>
      c.query("select public.mark_campaign_published($1, $2, 'ACTIVE', $3)", [
        id,
        r1.publish_key,
        JSON.stringify([{ position: 0, creative_id: "c0", ad_id: "ad-0" }, { position: 1, creative_id: "c1", ad_id: "ad-1" }]),
      ]),
    );
    // Repetir a confirmação não muda nada nem duplica o histórico.
    await asService((c) => c.query("select public.mark_campaign_published($1, $2, 'ACTIVE', '[]')", [id, r1.publish_key]));
    expect(await status(id)).toBe("active");
    const published = await pool.query("select count(*)::int as n from public.campaign_events where campaign_id = $1 and kind = 'published'", [id]);
    expect(published.rows[0].n).toBe(1);

    // Publicada: o conteúdo fica bloqueado.
    await expectPgError(setContent(marketing, id), "campaign_locked");
  });

  it("falha na publicação permite repetir sem criar outra campanha", async () => {
    const id = await readyCampaign(basics({ name: "Falha" }));
    await approve(admin, id);
    const r1 = (await asUser(admin, (c) => c.query("select public.request_campaign_publish($1) as r", [id]))).rows[0].r;
    await asService((c) => c.query("select public.campaign_publish_progress($1, $2, '{\"campaign\":\"120200000002\"}')", [id, r1.publish_key]));
    await asService((c) => c.query("select public.mark_campaign_publish_failed($1, $2, 'Erro da API', false)", [id, r1.publish_key]));
    expect(await status(id)).toBe("failed");
    const r2 = (await asUser(admin, (c) => c.query("select public.request_campaign_publish($1) as r", [id]))).rows[0].r;
    expect(r2.publish_key).toBe(r1.publish_key);
    const ext = await pool.query("select external_ids from public.campaigns where id = $1", [id]);
    expect(ext.rows[0].external_ids).toEqual({ campaign: "120200000002" }); // retoma do ponto onde ficou
  });

  it("pausar/retomar: pedido autorizado só em estados válidos; retomar exige orçamento disponível", async () => {
    const { rows } = await pool.query("select id from public.campaigns where organization_id = $1 and status = 'active' limit 1", [org]);
    const id = rows[0].id as string;
    await expectPgError(asUser(lawyer, (c) => c.query("select public.authorize_campaign_status($1, 'paused')", [id])), "forbidden");
    await asUser(admin, (c) => c.query("select public.authorize_campaign_status($1, 'paused')", [id]));
    expect(await status(id)).toBe("active"); // só muda quando a plataforma confirmar
    await asService((c) => c.query("select public.confirm_campaign_status($1, 'paused', 'PAUSED', $2)", [id, admin.id]));
    expect(await status(id)).toBe("paused");
    await expectPgError(asUser(admin, (c) => c.query("select public.authorize_campaign_status($1, 'paused')", [id])), "invalid_status");

    await asService((c) => c.query("select public.record_campaign_metrics($1, $2)", [id, JSON.stringify([{ day: tomorrow(), spend_cents: 10000 }])]));
    await expectPgError(asUser(admin, (c) => c.query("select public.authorize_campaign_status($1, 'active')", [id])), "budget_exhausted");
  });
});

describe("métricas e alertas", () => {
  it("só o servidor grava métricas; alerta de consumo uma vez e esgotamento", async () => {
    const id = await readyCampaign(basics({ name: "Métricas" }));
    await approve(admin, id);
    await expectPgError(
      asUser(admin, (c) => c.query("select public.record_campaign_metrics($1, '[]')", [id])),
      "permission denied",
    );
    const rec = async (rows: unknown[]) =>
      (await asService((c) => c.query("select public.record_campaign_metrics($1, $2) as r", [id, JSON.stringify(rows)]))).rows[0].r;

    expect((await rec([{ day: "2026-11-01", impressions: 1000, clicks: 20, spend_cents: 5000 }])).alert).toBeNull();
    expect((await rec([{ day: "2026-11-02", spend_cents: 3500 }])).alert).toBe("budget_alert"); // 85% ≥ 80%
    expect((await rec([{ day: "2026-11-02", spend_cents: 3600 }])).alert).toBeNull(); // não repete
    // Repetir o mesmo dia substitui (não soma em duplicado).
    const spend = await pool.query("select spend_cents from public.campaigns where id = $1", [id]);
    expect(Number(spend.rows[0].spend_cents)).toBe(8600);
    expect((await rec([{ day: "2026-11-03", spend_cents: 1400 }])).alert).toBe("budget_exhausted");
    expect((await rec([{ day: "2026-11-03", spend_cents: 1500 }])).alert).toBeNull();
  });

  it("atribuição só com anúncio conhecido; relatório separa plataforma e números internos", async () => {
    const { rows } = await pool.query("select id from public.campaigns where organization_id = $1 and name = 'Publicar'", [org]);
    const campaign = rows[0].id as string;
    const k = await pool.query(
      "insert into public.contacts (organization_id, full_name, phone_e164, source) values ($1, 'Cliente anúncio', '+351911111111', 'whatsapp') returning id",
      [org],
    );
    const contact = k.rows[0].id as string;
    const unknown = await asService(async (c) => (await c.query("select public.attribute_contact_to_ad($1, 'ad-desconhecido', '{}') as r", [contact])).rows[0].r);
    expect(unknown).toBeNull();
    const ok = await asService(async (c) => (await c.query("select public.attribute_contact_to_ad($1, 'ad-0', '{\"ctwa_clid\":\"abc\"}') as r", [contact])).rows[0].r);
    expect(ok).toBe(campaign);
    const kc = await pool.query("select source, attributed_campaign_id, attribution->>'model' as model from public.contacts where id = $1", [contact]);
    expect(kc.rows[0]).toMatchObject({ source: "ads", attributed_campaign_id: campaign, model: "first_touch_ctwa" });

    await asService((c) => c.query("select public.record_campaign_metrics($1, $2)", [campaign, JSON.stringify([{ day: new Date().toISOString().slice(0, 10), impressions: 500, clicks: 9, conversations_started: 3, spend_cents: 1234 }])]));
    const today = new Date().toISOString().slice(0, 10);
    const report = await asUser(lawyer, async (c) => (await c.query("select public.marketing_report($1, $2::date - 30, $2::date) as r", [org, today])).rows[0].r);
    const row = report.campaigns.find((x: { id: string }) => x.id === campaign);
    expect(row).toMatchObject({ impressions: 500, clicks: 9, conversations_started: 3, spend_cents: 1234, contacts_attributed: 1 });
    await expectPgError(
      asUser(outsider, (c) => c.query("select public.marketing_report($1, current_date - 30, current_date)", [org])),
      "forbidden",
    );
  });
});

describe("rascunhos e arquivo", () => {
  it("só se arquiva o que não está em curso", async () => {
    const id = await create(marketing, basics({ name: "Arquivar" }));
    await asUser(marketing, (c) => c.query("select public.archive_campaign($1)", [id]));
    expect(await status(id)).toBe("archived");
    const { rows } = await pool.query("select id from public.campaigns where organization_id = $1 and status = 'paused' limit 1", [org]);
    await expectPgError(asUser(marketing, (c) => c.query("select public.archive_campaign($1)", [rows[0].id])), "invalid_status");
  });

  it("serviço de outro escritório não pode ser associado", async () => {
    const s = await pool.query("insert into public.services (organization_id, name) values ($1, 'Serviço B') returning id", [otherOrg]);
    await expectPgError(create(marketing, basics({ service_id: s.rows[0].id })), "invalid_service");
  });
});
