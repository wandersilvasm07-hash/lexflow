import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  asUser,
  createOrg,
  setPlan,
  createUser,
  expectPgError,
  pool,
  type TestUser,
} from "./helpers";

/**
 * Critério de aceitação central (secção 18): um escritório não consegue
 * consultar nem alterar dados de outro, e os acessos são controlados no
 * servidor — mesmo que alguém chame a API diretamente, sem a interface.
 */

let alice: TestUser; // admin do escritório A
let bruno: TestUser; // admin do escritório B
let orgA: string;
let orgB: string;

beforeAll(async () => {
  alice = await createUser("Alice");
  bruno = await createUser("Bruno");
  orgA = await createOrg(alice, "Escritório A");
  orgB = await createOrg(bruno, "Escritório B");
  await setPlan(orgA, "premium");
});

afterAll(async () => {
  await pool.end();
});

describe("isolamento entre escritórios", () => {
  it("cada admin só vê o seu escritório", async () => {
    const seen = await asUser(alice, async (c) =>
      (await c.query("select id from public.organizations")).rows.map((r) => r.id),
    );
    expect(seen).toContain(orgA);
    expect(seen).not.toContain(orgB);
  });

  it("não vê membros, convites nem auditoria de outro escritório", async () => {
    await asUser(bruno, (c) =>
      c.query("select * from public.create_invitation($1, 'x@teste.local', 'lawyer')", [orgB]),
    );
    const leaked = await asUser(alice, async (c) => ({
      memberships: (
        await c.query("select 1 from public.memberships where organization_id = $1", [orgB])
      ).rowCount,
      invitations: (
        await c.query("select 1 from public.invitations where organization_id = $1", [orgB])
      ).rowCount,
      audit: (await c.query("select 1 from public.audit_logs where organization_id = $1", [orgB]))
        .rowCount,
    }));
    expect(leaked).toEqual({ memberships: 0, invitations: 0, audit: 0 });
  });

  it("não consegue alterar outro escritório por update direto", async () => {
    const updated = await asUser(alice, async (c) =>
      (await c.query("update public.organizations set name = 'Hackeado' where id = $1", [orgB]))
        .rowCount,
    );
    expect(updated).toBe(0);
    const { rows } = await pool.query("select name from public.organizations where id = $1", [
      orgB,
    ]);
    expect(rows[0].name).toBe("Escritório B");
  });

  it("não consegue entrar noutro escritório inserindo uma membership", async () => {
    await expectPgError(
      asUser(alice, (c) =>
        c.query(
          "insert into public.memberships (organization_id, user_id, role) values ($1, $2, 'org_admin')",
          [orgB, alice.id],
        ),
      ),
      /permission denied|42501/,
    );
  });

  it("não consegue usar RPCs de equipa sobre outro escritório", async () => {
    await expectPgError(
      asUser(alice, (c) =>
        c.query("select * from public.create_invitation($1, 'y@teste.local', 'org_admin')", [
          orgB,
        ]),
      ),
      "forbidden",
    );
    await expectPgError(
      asUser(alice, (c) => c.query("select * from public.list_members($1)", [orgB])),
      "forbidden",
    );
    const perms = await asUser(alice, async (c) =>
      (await c.query("select * from public.my_permissions($1)", [orgB])).rowCount,
    );
    expect(perms).toBe(0);
  });

  it("não vê o perfil de quem não partilha escritório", async () => {
    const rows = await asUser(alice, async (c) =>
      (await c.query("select id from public.profiles where id = $1", [bruno.id])).rowCount,
    );
    expect(rows).toBe(0);
  });

  it("utilizador anónimo não lê nenhuma tabela", async () => {
    await expectPgError(
      asUser(null, (c) => c.query("select * from public.organizations")),
      /permission denied/,
    );
    await expectPgError(
      asUser(null, (c) => c.query("select public.create_organization('X', 'xpto-anon')")),
      /permission denied/,
    );
  });
});

describe("organizações", () => {
  it("criar escritório torna o criador administrador e audita", async () => {
    const u = await createUser();
    const org = await createOrg(u);
    const { rows } = await pool.query(
      "select role from public.memberships where organization_id = $1 and user_id = $2",
      [org, u.id],
    );
    expect(rows[0].role).toBe("org_admin");
    const audit = await pool.query(
      "select action from public.audit_logs where organization_id = $1",
      [org],
    );
    expect(audit.rows.map((r) => r.action)).toContain("organization.created");
  });

  it("slug duplicado devolve erro de negócio claro", async () => {
    const u = await createUser();
    await asUser(u, (c) => c.query("select public.create_organization('Um', 'slug-repetido')"));
    await expectPgError(
      asUser(u, (c) => c.query("select public.create_organization('Dois', 'slug-repetido')")),
      "slug_taken",
    );
  });

  it("slug inválido é rejeitado", async () => {
    const u = await createUser();
    await expectPgError(
      asUser(u, (c) => c.query("select public.create_organization('Mau', 'Com Espaços!')")),
      /check constraint/,
    );
  });

  it("colunas protegidas (slug, created_by) não podem ser alteradas por update direto", async () => {
    await expectPgError(
      asUser(alice, (c) =>
        c.query("update public.organizations set slug = 'outro-slug' where id = $1", [orgA]),
      ),
      /permission denied/,
    );
  });

  it("advogado não pode editar o perfil do escritório", async () => {
    const lawyer = await createUser("Advogada");
    await addMember(alice, orgA, lawyer, "lawyer");
    const n = await asUser(lawyer, async (c) =>
      (await c.query("update public.organizations set name = 'X' where id = $1", [orgA])).rowCount,
    );
    expect(n).toBe(0);
  });
});

describe("convites", () => {
  it("só quem gere a equipa pode convidar", async () => {
    const assistant = await createUser();
    await addMember(alice, orgA, assistant, "legal_assistant");
    await expectPgError(
      asUser(assistant, (c) =>
        c.query("select * from public.create_invitation($1, 'z@teste.local', 'org_admin')", [orgA]),
      ),
      "forbidden",
    );
  });

  it("o token não é guardado em claro", async () => {
    const token = await asUser(alice, async (c) =>
      (
        await c.query("select token from public.create_invitation($1, 'claro@teste.local', 'viewer')", [
          orgA,
        ])
      ).rows[0].token as string,
    );
    const { rowCount } = await pool.query(
      "select 1 from public.invitations where token_hash = $1",
      [token],
    );
    expect(rowCount).toBe(0);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("convite só pode ser aceite pelo email convidado, uma única vez", async () => {
    const invitee = await createUser();
    const intruder = await createUser();
    const token = await asUser(alice, async (c) =>
      (
        await c.query("select token from public.create_invitation($1, $2, 'lawyer')", [
          orgA,
          invitee.email,
        ])
      ).rows[0].token as string,
    );

    await expectPgError(
      asUser(intruder, (c) => c.query("select public.accept_invitation($1)", [token])),
      "invitation_email_mismatch",
    );
    await asUser(invitee, (c) => c.query("select public.accept_invitation($1)", [token]));
    await expectPgError(
      asUser(invitee, (c) => c.query("select public.accept_invitation($1)", [token])),
      "invitation_invalid",
    );

    const { rows } = await pool.query(
      "select role from public.memberships where organization_id = $1 and user_id = $2",
      [orgA, invitee.id],
    );
    expect(rows[0].role).toBe("lawyer");
  });

  it("convite expirado ou revogado não é aceite", async () => {
    const late = await createUser();
    const token = await asUser(alice, async (c) =>
      (
        await c.query("select token from public.create_invitation($1, $2, 'viewer')", [
          orgA,
          late.email,
        ])
      ).rows[0].token as string,
    );
    await pool.query(
      "update public.invitations set expires_at = now() - interval '1 minute' where organization_id = $1 and email = $2",
      [orgA, late.email],
    );
    await expectPgError(
      asUser(late, (c) => c.query("select public.accept_invitation($1)", [token])),
      "invitation_expired",
    );

    const revokedUser = await createUser();
    const r = await asUser(alice, async (c) =>
      (
        await c.query("select invitation_id, token from public.create_invitation($1, $2, 'viewer')", [
          orgA,
          revokedUser.email,
        ])
      ).rows[0] as { invitation_id: string; token: string },
    );
    await asUser(alice, (c) => c.query("select public.revoke_invitation($1)", [r.invitation_id]));
    await expectPgError(
      asUser(revokedUser, (c) => c.query("select public.accept_invitation($1)", [r.token])),
      "invitation_invalid",
    );
  });

  it("pré-visualização pública não revela nada com token errado", async () => {
    const n = await asUser(null, async (c) =>
      (await c.query("select * from public.get_invitation_preview('nao-existe')")).rowCount,
    );
    expect(n).toBe(0);
  });
});

describe("gestão de membros", () => {
  it("não é possível remover nem despromover o último administrador", async () => {
    const u = await createUser();
    const org = await createOrg(u);
    const { rows } = await pool.query(
      "select id from public.memberships where organization_id = $1 and user_id = $2",
      [org, u.id],
    );
    const mid = rows[0].id;
    await expectPgError(
      asUser(u, (c) => c.query("select public.change_member_role($1, 'lawyer')", [mid])),
      "last_admin",
    );
    await expectPgError(
      asUser(u, (c) => c.query("select public.remove_member($1)", [mid])),
      "last_admin",
    );
    await expectPgError(
      asUser(u, (c) => c.query("select public.set_member_status($1, 'suspended')", [mid])),
      "last_admin",
    );
  });

  it("membro suspenso perde imediatamente o acesso", async () => {
    const u = await createUser();
    const mid = await addMember(alice, orgA, u, "lawyer");
    await asUser(alice, (c) => c.query("select public.set_member_status($1, 'suspended')", [mid]));
    const visible = await asUser(u, async (c) =>
      (await c.query("select 1 from public.organizations where id = $1", [orgA])).rowCount,
    );
    expect(visible).toBe(0);
  });

  it("um membro pode sair do escritório, mas não remover outros sem permissão", async () => {
    const a = await createUser();
    const b = await createUser();
    const ma = await addMember(alice, orgA, a, "viewer");
    const mb = await addMember(alice, orgA, b, "viewer");
    await expectPgError(
      asUser(a, (c) => c.query("select public.remove_member($1)", [mb])),
      "forbidden",
    );
    await asUser(a, (c) => c.query("select public.remove_member($1)", [ma]));
    const { rowCount } = await pool.query("select 1 from public.memberships where id = $1", [ma]);
    expect(rowCount).toBe(0);
  });
});

describe("auditoria", () => {
  it("é só de acréscimo, até para o superutilizador", async () => {
    await expectPgError(pool.query("update public.audit_logs set action = 'x.y'"), "append-only");
    await expectPgError(pool.query("delete from public.audit_logs"), "append-only");
  });

  it("utilizadores não escrevem diretamente na auditoria", async () => {
    await expectPgError(
      asUser(alice, (c) =>
        c.query(
          "insert into public.audit_logs (organization_id, action) values ($1, 'fake.event')",
          [orgA],
        ),
      ),
      /permission denied/,
    );
  });

  it("log_audit_event aceita só ações permitidas e membros do escritório", async () => {
    await asUser(alice, (c) =>
      c.query("select public.log_audit_event($1, 'settings.updated')", [orgA]),
    );
    await expectPgError(
      asUser(alice, (c) => c.query("select public.log_audit_event($1, 'membership.removed')", [orgA])),
      "invalid_action",
    );
    await expectPgError(
      asUser(alice, (c) => c.query("select public.log_audit_event($1, 'settings.updated')", [orgB])),
      "forbidden",
    );
  });

  it("gestor de marketing não lê a auditoria", async () => {
    const mkt = await createUser();
    await addMember(alice, orgA, mkt, "marketing_manager");
    const n = await asUser(mkt, async (c) =>
      (await c.query("select 1 from public.audit_logs where organization_id = $1", [orgA]))
        .rowCount,
    );
    expect(n).toBe(0);
  });
});

describe("endereços reservados", () => {
  it("não permite criar escritório com endereço de rota da aplicação", async () => {
    const u = await createUser();
    await expectPgError(
      asUser(u, (c) => c.query("select public.create_organization('Conta', 'conta')")),
      /check constraint/,
    );
  });
});
