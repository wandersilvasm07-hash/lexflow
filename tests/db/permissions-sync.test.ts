import { afterAll, describe, expect, it } from "vitest";
import { ORG_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/authz/permissions";
import { pool } from "./helpers";

afterAll(async () => {
  await pool.end();
});

describe("matriz de permissões", () => {
  it("o código e a base de dados têm exatamente a mesma matriz", async () => {
    const { rows } = await pool.query<{ role: string; permission: string }>(
      "select role::text, permission from public.role_permissions",
    );
    const db: Record<string, string[]> = {};
    for (const r of rows) (db[r.role] ??= []).push(r.permission);

    for (const role of ORG_ROLES) {
      expect([...(db[role] ?? [])].sort(), `papel ${role}`).toEqual(
        [...ROLE_PERMISSIONS[role]].sort(),
      );
    }
    expect(Object.keys(db).sort()).toEqual([...ORG_ROLES].sort());
  });

  it("o enum org_role na base de dados coincide com ORG_ROLES", async () => {
    const { rows } = await pool.query<{ v: string }>(
      "select unnest(enum_range(null::public.org_role))::text as v",
    );
    expect(rows.map((r) => r.v)).toEqual([...ORG_ROLES]);
  });

  it("todas as permissões existem em pelo menos um papel", () => {
    const used = new Set(Object.values(ROLE_PERMISSIONS).flat());
    for (const p of PERMISSIONS) expect(used.has(p), p).toBe(true);
  });
});
