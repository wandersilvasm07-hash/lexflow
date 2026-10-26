import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * Recria a base de dados de testes a partir de zero:
 *   shim Supabase  →  todas as migrações em supabase/migrations (por ordem).
 * Assim, os testes validam exatamente o SQL que vai para produção.
 */
export default async function setup() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:54322/lexflow_test",
  );
  const dbName = url.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const root = process.cwd();
  await db.query(readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(path.join(dir, file), "utf8"));
  }
  await db.end();
}
