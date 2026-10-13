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
  // Align saga_runs table columns with schema.ts so store.insertOnce works on this instance,
  // while strictly preserving the 0054 six-value enum check.
  const schemaColumns = [
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "release_requested_at" timestamp with time zone;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "release_source" text;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "release_requested_by" text;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "release_reason" text;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "deposit_cents" integer;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "deposit_ref" text;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "deposit_recorded_at" timestamp with time zone;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "release_attempts" integer;',
    'ALTER TABLE "saga_runs" ADD COLUMN IF NOT EXISTS "released_at" timestamp with time zone;',
  ];
  for (const statement of schemaColumns) {
    await pg.exec(statement);
  }
  const db = drizzle(pg);
  return { pg, db };
}

/** Test-only minimal stubs for FK references not present in the isolated migration set. */
export const PATH_A_STUBS_SQL = `
CREATE TABLE IF NOT EXISTS "sku_mappings" (
  "global_sku" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cad_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
`;

/**
 * Phase 11 PGlite with real 0052, 0054, and 0055 SQL applied.
 * Preserves 0054 test isolation while proving 0055 additive changes.
 */
export async function createPathAPglite() {
  const pg = new PGlite();
  const files = [
    "0005_incoming_webhooks.sql",
  ];
  for (const file of files) {
    const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const statement of statementsOf(text)) {
      await pg.exec(statement);
    }
  }
  for (const statement of statementsOf(PATH_A_STUBS_SQL)) {
    await pg.exec(statement);
  }
  for (const file of ["0052_custom_build_jobs.sql", "0054_sre_dlq_saga_buckets.sql", "0055_path_a_stateless_release.sql"]) {
    const text = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const statement of statementsOf(text)) {
      await pg.exec(statement);
    }
  }
  const db = drizzle(pg);
  return { pg, db };
}

