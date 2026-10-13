/**
 * Phase 11 Task 1: Migration 0055 schema smoke test on PGlite.
 * Verifies real 0055 SQL applies after 0054, enum extension, column shapes,
 * constraints, partial index, RLS, DDL whitelist, and D1 constraint preservation.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPathAPglite } from "./helpers/pglite";

type Handle = Awaited<ReturnType<typeof createPathAPglite>>;
let h: Handle;

beforeAll(async () => {
  h = await createPathAPglite();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

describe("migration 0055 schema smoke (PGlite)", () => {
  it("saga_status enum has the seven agreed values in order", async () => {
    const result = await h.db.execute(sql`
      SELECT e.enumlabel AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'saga_status' ORDER BY e.enumsortorder
    `);
    expect(rows<{ label: string }>(result).map((r) => r.label)).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "COMPLETED",
      "COMPENSATING",
      "COMPENSATED",
      "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
      "AWAITING_DEPOSIT",
    ]);
  });

  it("custom_build_job_items exists with RLS enabled", async () => {
    const result = await h.db.execute(sql`
      SELECT c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'custom_build_job_items' AND c.relkind = 'r'
    `);
    const found = rows<{ rls: boolean }>(result);
    expect(found).toHaveLength(1);
    expect(found[0]!.rls).toBe(true);
  });

  it("new nullable columns on saga_runs exist", async () => {
    const result = await h.db.execute(sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'saga_runs'
      AND column_name IN (
        'release_requested_at', 'release_source', 'release_requested_by',
        'release_reason', 'deposit_cents', 'deposit_ref',
        'deposit_recorded_at', 'release_attempts', 'released_at'
      )
    `);
    const cols = rows<{ column_name: string; is_nullable: string; data_type: string }>(result);
    expect(cols).toHaveLength(9);
    for (const c of cols) {
      expect(c.is_nullable).toBe("YES");
    }
  });

  it("new nullable columns on custom_build_jobs exist", async () => {
    const result = await h.db.execute(sql`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_name = 'custom_build_jobs'
      AND column_name IN (
        'katana_sales_order_id', 'katana_order_no', 'katana_mo_ids',
        'ghl_sync_hash', 'ghl_synced_at'
      )
    `);
    const cols = rows<{ column_name: string; is_nullable: string; data_type: string }>(result);
    expect(cols).toHaveLength(5);
    for (const c of cols) {
      expect(c.is_nullable).toBe("YES");
    }
  });

  it("custom_build_job_items constraints and default status", async () => {
    // 1. Check default design_status is 'awaiting_cad'
    const result = await h.db.execute(sql`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'custom_build_job_items' AND column_name = 'design_status'
    `);
    const col = rows<{ column_default: string; is_nullable: string }>(result)[0];
    expect(col.column_default).toContain("awaiting_cad");
    expect(col.is_nullable).toBe("NO");

    // 2. CHECK quantity > 0 rejects quantity <= 0
    // Insert a valid job first
    const [job] = rows<{ id: string }>(await h.db.execute(sql`
      INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
      VALUES ('client-1', 'Job 1', 'opp-1', 'test@ccpatio.com')
      RETURNING id
    `));
    // Insert valid sku_mappings
    await h.db.execute(sql`
      INSERT INTO sku_mappings (global_sku) VALUES ('JOB-SKU-TEST-1')
    `);

    // Quantity 0 should fail check
    await expect(h.db.execute(sql`
      INSERT INTO custom_build_job_items (job_id, global_sku, quantity)
      VALUES (${job.id}, 'JOB-SKU-TEST-1', 0)
    `)).rejects.toThrow();

    // Valid insert
    await h.db.execute(sql`
      INSERT INTO custom_build_job_items (job_id, global_sku, quantity)
      VALUES (${job.id}, 'JOB-SKU-TEST-1', 2)
    `);

    // Unique global_sku constraint rejects duplicate global_sku
    await expect(h.db.execute(sql`
      INSERT INTO custom_build_job_items (job_id, global_sku, quantity)
      VALUES (${job.id}, 'JOB-SKU-TEST-1', 1)
    `)).rejects.toThrow();
  });

  it("partial index saga_runs_awaiting_deposit_idx exists with WHERE predicate", async () => {
    const result = await h.db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'saga_runs' AND indexname = 'saga_runs_awaiting_deposit_idx'
    `);
    const idxs = rows<{ indexname: string; indexdef: string }>(result);
    expect(idxs).toHaveLength(1);
    expect(idxs[0]!.indexdef).toContain("WHERE");
    expect(idxs[0]!.indexdef).toContain("AWAITING_DEPOSIT");
  });

  it("0055 migration file contains only whitelisted additive DDL statements", () => {
    const migPath = path.join(
      __dirname,
      "..",
      "src",
      "server",
      "db",
      "migrations",
      "0055_path_a_stateless_release.sql"
    );
    const content = fs.readFileSync(migPath, "utf8");

    // Strictly forbidden operations
    expect(content).not.toMatch(/\bDROP\b/i);
    expect(content).not.toMatch(/\bRENAME\b/i);
    expect(content).not.toMatch(/\bTRUNCATE\b/i);
    expect(content).not.toMatch(/ALTER\s+TABLE\s+.*ALTER\s+COLUMN/i);
    expect(content).not.toMatch(/SET\s+NOT\s+NULL/i);
    expect(content).not.toMatch(/DROP\s+CONSTRAINT/i);

    // Permitted statements
    expect(content).toMatch(/ALTER\s+TYPE\s+"public"\."saga_status"\s+ADD\s+VALUE/i);
    expect(content).toMatch(/CREATE\s+TABLE\s+"custom_build_job_items"/i);
    expect(content).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(content).toMatch(/ALTER\s+TABLE\s+"custom_build_jobs"\s+ADD\s+COLUMN/i);
    expect(content).toMatch(/ALTER\s+TABLE\s+"saga_runs"\s+ADD\s+COLUMN/i);
    expect(content).toMatch(/CREATE\s+INDEX/i);
  });

  it("documents D1: custom_build_jobs.ghl_opportunity_id UNIQUE constraint is preserved", async () => {
    // opp-d1 is already in use
    await h.db.execute(sql`
      INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
      VALUES ('client-d1', 'Job D1', 'opp-d1', 'test@ccpatio.com')
    `);

    // A second job with the same ghl_opportunity_id must be rejected
    await expect(h.db.execute(sql`
      INSERT INTO custom_build_jobs (client_slug, display_name, ghl_opportunity_id, created_by)
      VALUES ('client-d1-b', 'Job D1-b', 'opp-d1', 'test@ccpatio.com')
    `)).rejects.toThrow();
  });
});
