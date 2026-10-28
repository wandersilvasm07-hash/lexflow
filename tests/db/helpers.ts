import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

/**
 * Ligação ao Postgres de testes. O DB é recriado em globalSetup com o shim do
 * Supabase + todas as migrações de supabase/migrations.
 */
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:54322/lexflow_test";

export const pool = new Pool({ connectionString: TEST_DB_URL, max: 4 });

export type TestUser = { id: string; email: string };

/** Cria um utilizador em auth.users (como o Supabase Auth faria). */
export async function createUser(name = "Utilizador Teste"): Promise<TestUser> {
  const email = `u-${randomUUID().slice(0, 8)}@teste.local`;
  const { rows } = await pool.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: name })],
  );
  return { id: rows[0].id, email };
}

/**
 * Executa `fn` como se fosse um pedido da API com o JWT do utilizador:
 * papel `authenticated` (ou `anon`) + claims, numa transação revertida no fim
 * se `rollback` for true. Igual ao que o PostgREST faz no Supabase.
 */
export async function asUser<T>(
  user: TestUser | null,
  fn: (c: PoolClient) => Promise<T>,
  { rollback = false }: { rollback?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (user) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: user.id, role: "authenticated", email: user.email }),
      ]);
    } else {
      await client.query("set local role anon");
      await client.query("select set_config('request.jwt.claims', '', true)");
    }
    const result = await fn(client);
    await client.query(rollback ? "rollback" : "commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function uniqueSlug(prefix = "esc") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export async function createOrg(owner: TestUser, name = "Escritório Teste") {
  return asUser(owner, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "select public.create_organization($1, $2) as id",
      [name, uniqueSlug()],
    );
    return rows[0].id;
  });
}

/** Convida e aceita, devolvendo o id da membership criada. */
export async function addMember(
  admin: TestUser,
  orgId: string,
  member: TestUser,
  role: string,
): Promise<string> {
  const token = await asUser(admin, async (c) => {
    const { rows } = await c.query<{ token: string }>(
      "select token from public.create_invitation($1, $2, $3::public.org_role)",
      [orgId, member.email, role],
    );
    return rows[0].token;
  });
  await asUser(member, (c) => c.query("select public.accept_invitation($1)", [token]));
  const { rows } = await pool.query<{ id: string }>(
    "select id from public.memberships where organization_id = $1 and user_id = $2",
    [orgId, member.id],
  );
  return rows[0].id;
}

/** Afirma que a promessa falha com uma mensagem/código Postgres esperado. */
export async function expectPgError(p: Promise<unknown>, match: RegExp | string) {
  try {
    await p;
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const text = `${e.code ?? ""} ${e.message ?? ""}`;
    if (typeof match === "string" ? text.includes(match) : match.test(text)) return;
    throw new Error(`Erro inesperado: ${text}`);
  }
  throw new Error(`Era esperado um erro (${match}) mas a operação teve sucesso`);
}

/** Muda o plano/estado de um escritório diretamente (como o webhook do Stripe faria). */
export async function setPlan(orgId: string, plan: string, status = "active") {
  await pool.query("update public.subscriptions set plan_id = $2, status = $3::public.subscription_status where organization_id = $1", [
    orgId,
    plan,
    status,
  ]);
}
