/**
 * Phase 10 Task 4, Step D (PGlite, in-process Postgres with the REAL 0005 + 0054 SQL).
 * Equivalent of the single-session parts of `sre-schema-smoke`, `sre-token-bucket` and
 * `woo-saga-store`. Needs no database server and touches no real data, so it runs in the
 * normal `vitest run` (it is NOT in `dbIntegrationTests`).
 *
 * What this CANNOT prove (single session): cross-connection races. Those assertions stay in
 * the real-Postgres suites, which need a database that has migration 0054.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { incoming_webhooks, rate_limit_buckets, saga_runs } from "@/server/db/schema";
import { createSagaStore } from "@/server/sre/saga-store";
import { acquireToken, takeToken } from "@/server/sre/token-bucket";
import { insertIncomingWebhookOnce } from "@/server/webhooks/incoming-log";
import { createMigratedPglite } from "./helpers/pglite";

type Handle = Awaited<ReturnType<typeof createMigratedPglite>>;
let h: Handle;

beforeAll(async () => {
  h = await createMigratedPglite();
}, 60_000);

afterAll(async () => {
  await h?.pg.close();
});

const TABLES = ["dlq_events", "saga_runs", "rate_limit_buckets"] as const;

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

describe("migration 0054 schema smoke (PGlite)", () => {
  it.each(TABLES)("%s exists with RLS enabled", async (table) => {
    const result = await h.db.execute(sql`
      SELECT c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table} AND c.relkind = 'r'
    `);
    const found = rows<{ rls: boolean }>(result);
    expect(found).toHaveLength(1);
    expect(found[0]!.rls).toBe(true);
  });

  it("saga_status enum has the six agreed values in order", async () => {
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
    ]);
  });

  it("dlq_events.run_id and saga_runs(saga_type, correlation_key) are unique", async () => {
    const result = await h.db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('dlq_events', 'saga_runs')
    `);
    const defs = rows<{ indexdef: string }>(result).map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/UNIQUE INDEX dlq_events_run_id_unique .*\(run_id\)/);
    expect(defs).toMatch(/UNIQUE INDEX saga_runs_type_correlation_uidx .*\(saga_type, correlation_key\)/);
  });
});

describe("Postgres token bucket atomic statement (PGlite)", () => {
  it("the first take is immediate and a second immediate take is refused with a wait hint", async () => {
    const key = `test:bucket:${randomUUID()}`;
    const first = await takeToken(h.db, key, { capacity: 1, ratePerSec: 1 });
    const second = await takeToken(h.db, key, { capacity: 1, ratePerSec: 1 });
    expect(first.taken).toBe(true);
    expect(second.taken).toBe(false);
    expect(second.waitMs).toBeGreaterThan(0);
    expect(second.waitMs).toBeLessThanOrEqual(1000);
  });

  it("never stores more than capacity tokens after an idle period (idle simulated by back-dating)", async () => {
    const key = `test:bucket:${randomUUID()}`;
    await takeToken(h.db, key, { capacity: 1, ratePerSec: 1 });
    await h.db
      .update(rate_limit_buckets)
      .set({ updated_at: sql`now() - interval '10 seconds'` })
      .where(eq(rate_limit_buckets.key, key));
    const a = await takeToken(h.db, key, { capacity: 1, ratePerSec: 1 });
    const b = await takeToken(h.db, key, { capacity: 1, ratePerSec: 1 });
    expect(a.taken).toBe(true);
    expect(b.taken).toBe(false); // 10s idle did NOT bank 10 tokens
  });

  it("5 queued acquirers are spaced ~1s apart (serialized by the single session)", async () => {
    const key = `test:bucket:${randomUUID()}`;
    const stamps: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await acquireToken({
          db: h.db,
          key,
          capacity: 1,
          ratePerSec: 1,
          maxWaitMs: 30_000,
          onTimeout: (w) => new Error(`timed out after ${w}ms`),
        });
        stamps.push(Date.now());
      }),
    );
    stamps.sort((x, y) => x - y);
    expect(stamps).toHaveLength(5);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(850);
    }
  }, 60_000);

  it("keys are independent buckets", async () => {
    const a = `test:bucket:${randomUUID()}`;
    const b = `test:bucket:${randomUUID()}`;
    expect((await takeToken(h.db, a)).taken).toBe(true);
    expect((await takeToken(h.db, b)).taken).toBe(true);
  });
});

describe("saga-store + audit insert-once atomic statements (PGlite)", () => {
  const store = () => createSagaStore(() => h.db as never);

  it("concurrent insertOnce on one (path_b_woo, key) yields exactly one row and no thrown 23505", async () => {
    const key = `test-woo-saga:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store().insertOnce({ sagaType: "path_b_woo", correlationKey: key, status: "IN_PROGRESS", paidAt: new Date() }),
      ),
    );
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(results.filter((r) => !r.inserted)).toHaveLength(7);
    const all = await h.db.select().from(saga_runs).where(eq(saga_runs.correlation_key, key));
    expect(all).toHaveLength(1);
  });

  it("setStep / setStatus / fail persist, and fail scrubs secrets from last_error", async () => {
    const key = `test-woo-saga:${randomUUID()}`;
    const s = store();
    await s.insertOnce({ sagaType: "path_b_woo", correlationKey: key });
    await s.setStep("path_b_woo", key, "so_created");
    expect((await s.get("path_b_woo", key))?.current_step).toBe("so_created");

    await s.setStatus("path_b_woo", key, "PENDING", { currentStep: "dry_run_logged" });
    expect(await s.get("path_b_woo", key)).toMatchObject({ status: "PENDING", current_step: "dry_run_logged" });

    await s.fail("path_b_woo", key, new Error("Bearer abcdef0123456789abcdef0123456789 exploded"));
    const failed = await s.get("path_b_woo", key);
    expect(failed?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
    expect(failed?.last_error).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("insertIncomingWebhookOnce: one inserted + the rest duplicate, and a processed row is never flipped", async () => {
    const key = `test:woo-delivery:${randomUUID()}`;
    const input = {
      source: "woocommerce" as const,
      eventName: "order.updated",
      idempotencyKey: key,
      payload: { id: 1 },
      status: "received" as const,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => insertIncomingWebhookOnce(input, h.db as never)),
    );
    expect(results.filter((r) => r === "inserted")).toHaveLength(1);
    expect(results.filter((r) => r === "duplicate")).toHaveLength(7);

    await h.db.update(incoming_webhooks).set({ status: "processed" }).where(eq(incoming_webhooks.idempotency_key, key));
    expect(await insertIncomingWebhookOnce(input, h.db as never)).toBe("duplicate");
    const [row] = await h.db.select().from(incoming_webhooks).where(eq(incoming_webhooks.idempotency_key, key));
    expect(row?.status).toBe("processed");
  });
});
