import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  factory_airlock_builds,
  factory_airlock_decisions,
} from "@/server/db/schema";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("0058_factory_airlock.sql & schema.ts parity", () => {
  const migration = read("src/server/db/migrations/0058_factory_airlock.sql");
  const codeOnly = migration.replace(/^\s*--.*$/gm, "");

  it("is strictly additive with zero DROP, ALTER COLUMN, ALTER TYPE, RENAME, TRUNCATE, DELETE, or ADD VALUE", () => {
    expect(codeOnly).not.toMatch(/\bDROP\b/i);
    expect(codeOnly).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(codeOnly).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(codeOnly).not.toMatch(/\bADD\s+VALUE\b/i);
    expect(codeOnly).not.toMatch(/\bRENAME\b/i);
    expect(codeOnly).not.toMatch(/\bTRUNCATE\b/i);
    expect(codeOnly).not.toMatch(/\bDELETE\s+FROM\b/i);
    // The only occurrence of DELETE allowed is FK referential `ON DELETE restrict`.
    const withoutFkOnDeleteRestrict = codeOnly.replace(/\bON\s+DELETE\s+restrict\b/gi, "");
    expect(withoutFkOnDeleteRestrict).not.toMatch(/\bDELETE\b/i);
  });

  it("contains only factory_airlock_status, factory_airlock_builds, factory_airlock_decisions, their indexes/FKs/RLS, and guarded REVOKE", () => {
    expect(codeOnly).toContain('CREATE TYPE "public"."factory_airlock_status"');
    expect(codeOnly).toContain('CREATE TABLE "factory_airlock_builds"');
    expect(codeOnly).toContain('CREATE TABLE "factory_airlock_decisions"');
    expect(codeOnly).toContain('ALTER TABLE "factory_airlock_builds" ENABLE ROW LEVEL SECURITY;');
    expect(codeOnly).toContain('ALTER TABLE "factory_airlock_decisions" ENABLE ROW LEVEL SECURITY;');
    expect(codeOnly).toContain('REVOKE ALL ON TABLE "factory_airlock_builds" FROM anon, authenticated;');
    expect(codeOnly).toContain('REVOKE ALL ON TABLE "factory_airlock_decisions" FROM anon, authenticated;');

    const alterTargets = [
      ...codeOnly.matchAll(/\bALTER\s+TABLE\s+"([^"]+)"/gi),
    ].map((m) => m[1]);
    expect(new Set(alterTargets)).toEqual(
      new Set(["factory_airlock_builds", "factory_airlock_decisions"]),
    );
  });

  it("every CHECK SQL string in schema.ts matches 0058_factory_airlock.sql character-for-character", () => {
    const dialect = new PgDialect();
    const schemaChecks = new Map<string, string>();
    for (const tbl of [factory_airlock_builds, factory_airlock_decisions]) {
      const cfg = getTableConfig(tbl);
      for (const chk of cfg.checks) {
        schemaChecks.set(chk.name, dialect.sqlToQuery(chk.value).sql);
      }
    }

    const sqlChecks = new Map<string, string>();
    const re = /CONSTRAINT\s+"([^"]+)"\s+CHECK\s*\((.+)\)\s*,?$/gm;
    for (let m = re.exec(codeOnly); m; m = re.exec(codeOnly)) {
      sqlChecks.set(m[1]!, m[2]!);
    }

    expect(schemaChecks.size).toBe(4);
    expect([...schemaChecks.keys()].sort()).toEqual([
      "factory_airlock_approved_attested",
      "factory_airlock_decisions_action",
      "factory_airlock_reject_comment",
      "factory_airlock_submitted_attested",
    ]);
    expect([...schemaChecks.keys()].sort()).toEqual([...sqlChecks.keys()].sort());
    for (const [name, expectedSql] of sqlChecks.entries()) {
      expect(schemaChecks.get(name), `CHECK mismatch on ${name}`).toBe(expectedSql);
    }
  });

  it("journal ends at idx 60 (0058_factory_airlock, when > 1793289542107) and preserves idx 59 (0057_katana_reverse_flow, when = 1793289542107)", () => {
    const journal = JSON.parse(
      read("src/server/db/migrations/meta/_journal.json"),
    ) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    expect(journal.entries.length).toBe(61);
    const prev = journal.entries[journal.entries.length - 2];
    const last = journal.entries[journal.entries.length - 1];
    expect(prev).toMatchObject({
      idx: 59,
      tag: "0057_katana_reverse_flow",
      when: 1793289542107,
    });
    expect(last).toMatchObject({
      idx: 60,
      tag: "0058_factory_airlock",
    });
    expect(last!.when).toBeGreaterThan(1793289542107);

    const snap = JSON.parse(
      read("src/server/db/migrations/meta/0060_snapshot.json"),
    ) as { tables: Record<string, unknown>; enums: Record<string, unknown> };
    expect(snap.tables).toHaveProperty(["public.factory_airlock_builds"]);
    expect(snap.tables).toHaveProperty(["public.factory_airlock_decisions"]);
    expect(snap.enums).toHaveProperty(["public.factory_airlock_status"]);
  });

  it("applies cleanly on PGlite and enforces RLS, UNIQUE, FK ON DELETE RESTRICT, and all four CHECK constraints", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`
        CREATE TABLE "sku_mappings" (
          "global_sku" text PRIMARY KEY NOT NULL
        );
        CREATE TABLE "custom_build_job_items" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL
        );
      `);

      const statements = migration
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.replace(/^\s*--.*$/gm, "").trim().length > 0);
      for (const stmt of statements) {
        await pg.exec(stmt);
      }

      const rlsRes = await pg.query<{ relname: string; relrowsecurity: boolean }>(`
        SELECT relname, relrowsecurity
        FROM pg_class
        WHERE relname IN ('factory_airlock_builds', 'factory_airlock_decisions')
        ORDER BY relname
      `);
      expect(rlsRes.rows).toEqual([
        { relname: "factory_airlock_builds", relrowsecurity: true },
        { relname: "factory_airlock_decisions", relrowsecurity: true },
      ]);

      await pg.exec(`INSERT INTO "sku_mappings" ("global_sku") VALUES ('JOB-TEST-001');`);
      const itemRes = await pg.query<{ id: string }>(
        `INSERT INTO "custom_build_job_items" DEFAULT VALUES RETURNING "id";`,
      );
      const itemId = itemRes.rows[0]!.id;

      // Reject pending_manager without submitted_by / submitted_at
      await expect(
        pg.query(
          `INSERT INTO "factory_airlock_builds" ("job_item_id", "root_sku", "status") VALUES ($1, 'JOB-TEST-001', 'pending_manager')`,
          [itemId],
        ),
      ).rejects.toThrow(/factory_airlock_submitted_attested/);

      // Reject approved without approved_by / approved_at / dossier_hash
      await expect(
        pg.query(
          `INSERT INTO "factory_airlock_builds" ("job_item_id", "root_sku", "status", "submitted_by", "submitted_at") VALUES ($1, 'JOB-TEST-001', 'approved', 'd@ccpatio.com', now())`,
          [itemId],
        ),
      ).rejects.toThrow(/factory_airlock_approved_attested/);

      // Valid draft insert
      const buildRes = await pg.query<{ id: string }>(
        `INSERT INTO "factory_airlock_builds" ("job_item_id", "root_sku") VALUES ($1, 'JOB-TEST-001') RETURNING "id"`,
        [itemId],
      );
      const buildId = buildRes.rows[0]!.id;

      // Reject short reject comment
      await expect(
        pg.query(
          `INSERT INTO "factory_airlock_decisions" ("build_id", "action", "actor_email", "actor_role", "comment", "dossier_hash")
           VALUES ($1, 'reject', 'mgr@ccpatio.com', 'Ops_Manager', 'too short', repeat('a', 64))`,
          [buildId],
        ),
      ).rejects.toThrow(/factory_airlock_reject_comment/);
    } finally {
      await pg.close();
    }
  });
});
