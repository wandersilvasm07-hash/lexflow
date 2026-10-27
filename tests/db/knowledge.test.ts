import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, asUser, createOrg, createUser, expectPgError, pool, type TestUser } from "./helpers";

/**
 * Critérios da secção 18 para a base jurídica:
 *  - documentos privados não contaminam pesquisas de outros escritórios;
 *  - conteúdos desatualizados/fora de vigência não são apresentados como vigentes;
 *  - só documentos aprovados (com fonte e revisão em dia) chegam ao assistente.
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

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function meta(over: Record<string, unknown> = {}) {
  return {
    category: "reagrupamento_familiar",
    title: "Reagrupamento familiar — documento de teste",
    source_name: "Fonte oficial de teste",
    source_url: "https://exemplo.gov.pt/teste",
    last_verified_on: iso(-1),
    next_review_on: iso(90),
    ...over,
  };
}

async function createDoc(user: TestUser, org: string | null, content: string, over: Record<string, unknown> = {}) {
  return asUser(user, async (c) => {
    const { rows } = await c.query("select public.create_knowledge_document($1, $2, $3, $4) as id", [
      org,
      JSON.stringify(meta(over)),
      content,
      JSON.stringify([{ heading: "Secção 1", content }]),
    ]);
    return rows[0].id as string;
  });
}

const setStatus = (user: TestUser, doc: string, status: string) =>
  asUser(user, (c) => c.query("select public.set_knowledge_status($1, $2)", [doc, status]));

async function approve(user: TestUser, doc: string) {
  await setStatus(user, doc, "in_review");
  await setStatus(user, doc, "approved");
}

const agentSearch = (org: string, q: string) =>
  asService(async (c) => (await c.query("select * from public.agent_search_knowledge($1, $2)", [org, q])).rows);

let adminA: TestUser;
let adminB: TestUser;
let platform: TestUser;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  adminA = await createUser("Admin A");
  adminB = await createUser("Admin B");
  platform = await createUser("Plataforma");
  orgA = await createOrg(adminA, "Escritório A");
  orgB = await createOrg(adminB, "Escritório B");
  await pool.query("insert into public.platform_admins (user_id) values ($1)", [platform.id]);
});

afterAll(async () => {
  await pool.end();
});

describe("fluxo editorial", () => {
  it("documentos novos entram em rascunho e não são pesquisáveis", async () => {
    const doc = await createDoc(adminA, orgA, "Texto sobre zarabatana rascunho.");
    const { rows } = await pool.query("select status from public.knowledge_documents where id = $1", [doc]);
    expect(rows[0].status).toBe("draft");
    expect(await agentSearch(orgA, "zarabatana")).toHaveLength(0);
    await setStatus(adminA, doc, "in_review");
    expect(await agentSearch(orgA, "zarabatana")).toHaveLength(0);
  });

  it("aprovado e em vigor é pesquisável, também sem acentos", async () => {
    const doc = await createDoc(adminA, orgA, "A autorização de residência para trabalho exige requisitos de teste.");
    await approve(adminA, doc);
    const hits = await agentSearch(orgA, "autorizacao de residencia");
    expect(hits.map((h) => h.document_id)).toContain(doc);
    expect(hits[0].source_url).toBe("https://exemplo.gov.pt/teste");
  });

  it("aprovar exige fonte e datas de verificação e revisão", async () => {
    const semFonte = await createDoc(adminA, orgA, "Sem fonte.", { source_name: null, source_url: null });
    await setStatus(adminA, semFonte, "in_review");
    await expectPgError(setStatus(adminA, semFonte, "approved"), "approval_requires_source");

    const semDatas = await createDoc(adminA, orgA, "Sem datas.", { last_verified_on: null, next_review_on: null });
    await setStatus(adminA, semDatas, "in_review");
    await expectPgError(setStatus(adminA, semDatas, "approved"), "approval_requires_review_dates");
  });

  it("transições inválidas são recusadas", async () => {
    const doc = await createDoc(adminA, orgA, "Transição.");
    await expectPgError(setStatus(adminA, doc, "approved"), "invalid_transition");
    await expectPgError(setStatus(adminA, doc, "outdated"), "invalid_transition");
  });

  it("assistente jurídico escreve mas não aprova", async () => {
    const assistant = await createUser("Assistente");
    await addMember(adminA, orgA, assistant, "legal_assistant");
    const doc = await createDoc(assistant, orgA, "Escrito pela assistente.");
    await setStatus(assistant, doc, "in_review");
    await expectPgError(setStatus(assistant, doc, "approved"), "forbidden");
    await setStatus(adminA, doc, "approved");
  });

  it("documento aprovado não pode ser editado; muda por nova versão", async () => {
    const doc = await createDoc(adminA, orgA, "Versão um do quintal.");
    await approve(adminA, doc);
    await expectPgError(
      asUser(adminA, (c) => c.query("select public.update_knowledge_document($1, '{\"title\": \"Outro\"}')", [doc])),
      "not_editable",
    );

    const v2 = await asUser(adminA, async (c) =>
      (await c.query("select public.new_knowledge_version($1) as id", [doc])).rows[0].id as string,
    );
    await asUser(adminA, (c) =>
      c.query("select public.update_knowledge_document($1, $2, $3, $4)", [
        v2,
        JSON.stringify({ last_verified_on: iso(0), next_review_on: iso(120) }),
        "Versão dois do quintal.",
        JSON.stringify([{ content: "Versão dois do quintal." }]),
      ]),
    );
    // Enquanto a v2 não for aprovada, a v1 continua a ser a vigente.
    let hits = await agentSearch(orgA, "quintal");
    expect(hits.map((h) => h.version)).toEqual([1]);

    await approve(adminA, v2);
    hits = await agentSearch(orgA, "quintal");
    expect(hits.map((h) => h.version)).toEqual([2]);
    const old = await pool.query("select status from public.knowledge_documents where id = $1", [doc]);
    expect(old.rows[0].status).toBe("outdated");
  });
});

describe("aplicabilidade temporal", () => {
  it("documento fora de vigência ou com revisão em atraso não chega ao assistente", async () => {
    const futuro = await createDoc(adminA, orgA, "Regra futura sobre gaivotas.", { effective_from: iso(30) });
    await approve(adminA, futuro);
    expect(await agentSearch(orgA, "gaivotas")).toHaveLength(0);

    const caducado = await createDoc(adminA, orgA, "Regra antiga sobre pelicanos.");
    await approve(adminA, caducado);
    expect(await agentSearch(orgA, "pelicanos")).toHaveLength(1);
    await pool.query("update public.knowledge_documents set effective_until = $2 where id = $1", [caducado, iso(-1)]);
    expect(await agentSearch(orgA, "pelicanos")).toHaveLength(0);

    const atrasado = await createDoc(adminA, orgA, "Regra sobre flamingos.");
    await approve(adminA, atrasado);
    await pool.query("update public.knowledge_documents set next_review_on = $2 where id = $1", [atrasado, iso(-1)]);
    expect(await agentSearch(orgA, "flamingos")).toHaveLength(0);
  });

  it("documento marcado como desatualizado deixa de ser usado", async () => {
    const doc = await createDoc(adminA, orgA, "Regra sobre albatrozes.");
    await approve(adminA, doc);
    await setStatus(adminA, doc, "outdated");
    expect(await agentSearch(orgA, "albatrozes")).toHaveLength(0);
  });
});

describe("base comum vs documentos privados", () => {
  it("documento privado de um escritório nunca aparece a outro", async () => {
    const doc = await createDoc(adminA, orgA, "Estratégia interna do escritório A sobre tucanos.");
    await approve(adminA, doc);
    expect((await agentSearch(orgA, "tucanos")).length).toBe(1);
    expect(await agentSearch(orgB, "tucanos")).toHaveLength(0);

    const seenByB = await asUser(adminB, async (c) => ({
      docs: (await c.query("select 1 from public.knowledge_documents where id = $1", [doc])).rowCount,
      chunks: (await c.query("select 1 from public.knowledge_chunks where document_id = $1", [doc])).rowCount,
      search: (await c.query("select * from public.search_knowledge($1, 'tucanos')", [orgB])).rowCount,
    }));
    expect(seenByB).toEqual({ docs: 0, chunks: 0, search: 0 });

    await expectPgError(
      asUser(adminB, (c) => c.query("select * from public.search_knowledge($1, 'tucanos')", [orgA])),
      "forbidden",
    );
  });

  it("base comum aprovada serve todos os escritórios; rascunhos só a plataforma vê", async () => {
    const doc = await createDoc(platform, null, "Informação comum sobre colibris.");
    const draftSeen = await asUser(adminB, async (c) =>
      (await c.query("select 1 from public.knowledge_documents where id = $1", [doc])).rowCount,
    );
    expect(draftSeen).toBe(0);

    await approve(platform, doc);
    expect((await agentSearch(orgA, "colibris")).map((h) => h.scope)).toEqual(["common"]);
    expect((await agentSearch(orgB, "colibris")).length).toBe(1);
  });

  it("só administradores da plataforma escrevem ou aprovam na base comum", async () => {
    await expectPgError(createDoc(adminA, null, "Tentativa."), "forbidden");
    const doc = await createDoc(platform, null, "Comum em revisão.");
    await setStatus(platform, doc, "in_review");
    await expectPgError(setStatus(adminA, doc, "approved"), "forbidden");
  });

  it("gestor de marketing não lê a base do escritório", async () => {
    const mkt = await createUser("Marketing");
    await addMember(adminA, orgA, mkt, "marketing_manager");
    const n = await asUser(mkt, async (c) =>
      (await c.query("select 1 from public.knowledge_documents where organization_id = $1", [orgA])).rowCount,
    );
    expect(n).toBe(0);
  });

  it("utilizadores não chamam a pesquisa do assistente nem escrevem diretamente", async () => {
    await expectPgError(
      asUser(adminA, (c) => c.query("select * from public.agent_search_knowledge($1, 'x')", [orgA])),
      /permission denied/,
    );
    await expectPgError(
      asUser(adminA, (c) =>
        c.query(
          "insert into public.knowledge_documents (organization_id, category, title, content, content_hash) values ($1, 'outro', 'Direto', 'x', 'x')",
          [orgA],
        ),
      ),
      /permission denied/,
    );
  });

  it("transições ficam no registo de atividade", async () => {
    const doc = await createDoc(adminA, orgA, "Auditado.");
    await approve(adminA, doc);
    const { rows } = await pool.query(
      "select action, metadata->>'to' as to from public.audit_logs where entity_id = $1 order by id",
      [doc],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "knowledge.created",
      "knowledge.status_changed",
      "knowledge.status_changed",
    ]);
    expect(rows.at(-1)?.to).toBe("approved");
  });
});
