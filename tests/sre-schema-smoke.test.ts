/**
 * REAL Postgres (listed in vitest.config `dbIntegrationTests`). Requires migration 0054.
 * Read-only: only inspects the catalog.
 */
import { afterAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

const client = postgres(process.env.POSTGRES_URL!, { max: 2, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const db = drizzle(client);

afterAll(async () => {
  await client.end({ timeout: 5 });
});

const TABLES = ["dlq_events", "saga_runs", "rate_limit_buckets"] as const;

describe("migration 0054 schema smoke (real)", () => {
  it.each(TABLES)("%s exists with RLS enabled", async (table) => {
    const rows = (await db.execute(sql`
      SELECT c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table} AND c.relkind = 'r'
    `)) as unknown as Array<{ rls: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rls).toBe(true);
  });

  it.each(TABLES)("anon has no SELECT on %s", async (table) => {
    const roles = (await db.execute(sql`SELECT 1 AS present FROM pg_roles WHERE rolname = 'anon'`)) as unknown as unknown[];
    if (roles.length === 0) return; // non-Supabase database: nothing to revoke from
    const rows = (await db.execute(
      sql`SELECT has_table_privilege('anon', ${`public.${table}`}, 'SELECT') AS can_select`,
    )) as unknown as Array<{ can_select: boolean }>;
    expect(rows[0]!.can_select).toBe(false);
  });

  it("saga_status enum has the six agreed values in order", async () => {
    const rows = (await db.execute(sql`
      SELECT e.enumlabel AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'saga_status' ORDER BY e.enumsortorder
    `)) as unknown as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "COMPLETED",
      "COMPENSATING",
      "COMPENSATED",
      "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
    ]);
  });

  it("dlq_events.run_id and saga_runs(saga_type, correlation_key) are unique", async () => {
    const rows = (await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('dlq_events', 'saga_runs')
    `)) as unknown as Array<{ indexdef: string }>;
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/UNIQUE INDEX dlq_events_run_id_unique .*\(run_id\)/);
    expect(defs).toMatch(/UNIQUE INDEX saga_runs_type_correlation_uidx .*\(saga_type, correlation_key\)/);
  });
});
