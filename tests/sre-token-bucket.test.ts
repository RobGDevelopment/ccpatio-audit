/**
 * REAL Postgres (listed in vitest.config `dbIntegrationTests`). Requires migration 0054
 * (`rate_limit_buckets`). Uses a unique bucket key per run and always cleans its row up.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { rate_limit_buckets } from "@/server/db/schema";
import { acquireToken, takeToken } from "@/server/sre/token-bucket";

const client = postgres(process.env.POSTGRES_URL!, { max: 12, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const db = drizzle(client);

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("Postgres token bucket (real)", () => {
  it("5 concurrent acquirers are spaced ~1s apart (a burst never exceeds 1)", async () => {
    const key = `test:bucket:${randomUUID()}`;
    try {
      const stamps: number[] = [];
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          await acquireToken({
            db,
            key,
            capacity: 1,
            ratePerSec: 1,
            maxWaitMs: 30_000,
            onTimeout: (w) => new Error(`timed out after ${w}ms`),
          });
          stamps.push(Date.now());
        }),
      );
      stamps.sort((a, b) => a - b);
      expect(stamps).toHaveLength(5);
      for (let i = 1; i < stamps.length; i += 1) {
        // ~1s with tolerance for network jitter between the DB clock and ours.
        expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(850);
      }
    } finally {
      await db.delete(rate_limit_buckets).where(eq(rate_limit_buckets.key, key));
    }
  }, 60_000);

  it("the first take is immediate and a second immediate take is refused with a wait hint", async () => {
    const key = `test:bucket:${randomUUID()}`;
    try {
      const first = await takeToken(db, key, { capacity: 1, ratePerSec: 1 });
      const second = await takeToken(db, key, { capacity: 1, ratePerSec: 1 });
      expect(first.taken).toBe(true);
      expect(second.taken).toBe(false);
      expect(second.waitMs).toBeGreaterThan(0);
      expect(second.waitMs).toBeLessThanOrEqual(1000);
    } finally {
      await db.delete(rate_limit_buckets).where(eq(rate_limit_buckets.key, key));
    }
  }, 30_000);

  it("never stores more than capacity tokens after an idle period", async () => {
    const key = `test:bucket:${randomUUID()}`;
    try {
      await takeToken(db, key, { capacity: 1, ratePerSec: 1 });
      await new Promise((r) => setTimeout(r, 2500));
      const a = await takeToken(db, key, { capacity: 1, ratePerSec: 1 });
      const b = await takeToken(db, key, { capacity: 1, ratePerSec: 1 });
      expect(a.taken).toBe(true);
      expect(b.taken).toBe(false); // refill is capped at 1: no two-token burst
    } finally {
      await db.delete(rate_limit_buckets).where(eq(rate_limit_buckets.key, key));
    }
  }, 30_000);

  it("gives up with the caller's error after maxWaitMs", async () => {
    const key = `test:bucket:${randomUUID()}`;
    try {
      await takeToken(db, key, { capacity: 1, ratePerSec: 0.01 }); // refills every 100s
      await expect(
        acquireToken({
          db,
          key,
          capacity: 1,
          ratePerSec: 0.01,
          maxWaitMs: 300,
          onTimeout: (w) => new Error(`TIMEOUT:${w >= 0}`),
        }),
      ).rejects.toThrow("TIMEOUT:true");
    } finally {
      await db.delete(rate_limit_buckets).where(eq(rate_limit_buckets.key, key));
    }
  }, 30_000);
});
