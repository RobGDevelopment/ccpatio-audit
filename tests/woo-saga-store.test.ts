/**
 * REAL Postgres (listed in vitest.config `dbIntegrationTests`). Requires migration 0054
 * (`saga_runs`) and the existing `incoming_webhooks` table.
 *
 * Every row uses a unique per-run key and is deleted in `finally`; no real order row is ever
 * read, written or deleted.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { incoming_webhooks, saga_runs } from "@/server/db/schema";
import { createSagaStore } from "@/server/sre/saga-store";
import { insertIncomingWebhookOnce } from "@/server/webhooks/incoming-log";

const client = postgres(process.env.POSTGRES_URL!, { max: 12, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const db = drizzle(client);
const store = createSagaStore(() => db as never);

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("saga-store insertOnce (real Postgres)", () => {
  it("8 concurrent inserts on one (path_b_woo, key) yield exactly one row and no thrown 23505", async () => {
    const key = `test-woo-saga:${randomUUID()}`;
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.insertOnce({ sagaType: "path_b_woo", correlationKey: key, status: "IN_PROGRESS", paidAt: new Date() }),
        ),
      );
      expect(results.filter((r) => r.inserted)).toHaveLength(1);
      expect(results.filter((r) => !r.inserted)).toHaveLength(7);
      for (const r of results) expect(r.row.correlation_key).toBe(key);

      const rows = await db.select().from(saga_runs).where(eq(saga_runs.correlation_key, key));
      expect(rows).toHaveLength(1);
    } finally {
      await db.delete(saga_runs).where(eq(saga_runs.correlation_key, key));
    }
  }, 30_000);

  it("setStep / setStatus / fail persist, and fail scrubs the error", async () => {
    const key = `test-woo-saga:${randomUUID()}`;
    try {
      await store.insertOnce({ sagaType: "path_b_woo", correlationKey: key });
      await store.setStep("path_b_woo", key, "so_created");
      expect((await store.get("path_b_woo", key))?.current_step).toBe("so_created");

      await store.setStatus("path_b_woo", key, "PENDING", { currentStep: "dry_run_logged" });
      expect(await store.get("path_b_woo", key)).toMatchObject({ status: "PENDING", current_step: "dry_run_logged" });

      await store.fail("path_b_woo", key, new Error("Bearer abcdef0123456789abcdef0123456789 exploded"));
      const failed = await store.get("path_b_woo", key);
      expect(failed?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
      expect(failed?.last_error).not.toContain("abcdef0123456789abcdef0123456789");
    } finally {
      await db.delete(saga_runs).where(eq(saga_runs.correlation_key, key));
    }
  }, 30_000);
});

describe("insertIncomingWebhookOnce (real Postgres)", () => {
  it("concurrent duplicates yield one inserted + the rest duplicate, and never flip a processed row", async () => {
    const key = `test:woo-delivery:${randomUUID()}`;
    const input = {
      source: "woocommerce" as const,
      eventName: "order.updated",
      idempotencyKey: key,
      payload: { id: 1 },
      status: "received" as const,
    };
    try {
      const results = await Promise.all(Array.from({ length: 8 }, () => insertIncomingWebhookOnce(input)));
      expect(results.filter((r) => r === "inserted")).toHaveLength(1);
      expect(results.filter((r) => r === "duplicate")).toHaveLength(7);

      await db
        .update(incoming_webhooks)
        .set({ status: "processed" })
        .where(eq(incoming_webhooks.idempotency_key, key));
      expect(await insertIncomingWebhookOnce(input)).toBe("duplicate");

      const [row] = await db.select().from(incoming_webhooks).where(eq(incoming_webhooks.idempotency_key, key));
      expect(row?.status).toBe("processed");
    } finally {
      await db.delete(incoming_webhooks).where(eq(incoming_webhooks.idempotency_key, key));
    }
  }, 30_000);
});
