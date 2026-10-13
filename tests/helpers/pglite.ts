/**
 * Phase 10 Task 4, Step D: in-process Postgres (PGlite) with the REAL migration SQL applied.
 *
 * Used only because no separate test database exists and the live DB lacks migration 0054.
 * PGlite is a SINGLE in-process session, so it proves tables / enums / indexes / RLS flag and
 * the ATOMIC STATEMENT semantics, but it CANNOT prove cross-connection behaviour (that stays
 * on real Postgres: `qbo-lock-keys`, and the concurrent-connection assertions in
 * `sre-token-bucket` / `woo-saga-store`, which are blocked until a real DB has 0054).
 *
 * The anon/RLS-privilege assertions are skipped: PGlite has no `anon` role.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const MIGRATIONS = path.join(__dirname, "..", "..", "src", "server", "db", "migrations");

/** The exact files that create the tables the Phase 10 DB assertions touch. */
export const PGLITE_MIGRATION_FILES = [
  "0005_incoming_webhooks.sql",
  "0054_sre_dlq_saga_buckets.sql",
] as const;

function statementsOf(sqlText: string): string[] {
  return sqlText
    .split(/-->\s*statement-breakpoint/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

export async function createMigratedPglite() {
  const pg = new PGlite();
  for (const file of PGLITE_MIGRATION_FILES) {
    const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const statement of statementsOf(text)) {
      await pg.exec(statement);
    }
  }
  const db = drizzle(pg);
  return { pg, db };
}
