/**
 * REAL Postgres (listed in vitest.config `dbIntegrationTests`).
 *
 * Touches NO tables: advisory locks need none, and every lock here lives in a private,
 * per-run namespace so it can never contend with a real QBO token refresh.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { withQboRefreshLock } from "@/server/integrations/qbo/token-refresh";

const url = process.env.POSTGRES_URL_TX?.trim() || process.env.POSTGRES_URL;
const client = postgres(url!, { max: 16, prepare: false, idle_timeout: 5, connect_timeout: 15 });
const db = drizzle(client);
const namespace = `ccpatio:test:${randomUUID()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("withQboRefreshLock (real Postgres)", () => {
  it("serializes callers for the same environment: at most 1 inside the critical section", async () => {
    let inside = 0;
    let maxInside = 0;
    let completed = 0;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        withQboRefreshLock(
          "production",
          async () => {
            inside += 1;
            maxInside = Math.max(maxInside, inside);
            await sleep(40);
            inside -= 1;
            completed += 1;
          },
          { db: db as never, namespace },
        ),
      ),
    );

    expect(completed).toBe(10);
    expect(maxInside).toBe(1);
  }, 60_000);

  it("sandbox and production never block each other", async () => {
    let releaseProd!: () => void;
    const prodHeld = new Promise<void>((r) => (releaseProd = r));
    let prodEntered!: () => void;
    const prodInside = new Promise<void>((r) => (prodEntered = r));

    const prod = withQboRefreshLock(
      "production",
      async () => {
        prodEntered();
        await prodHeld;
      },
      { db: db as never, namespace },
    );

    await prodInside;
    const started = Date.now();
    // Sandbox must acquire immediately while production's lock is still held.
    await withQboRefreshLock("sandbox", async () => undefined, { db: db as never, namespace });
    const sandboxMs = Date.now() - started;
    releaseProd();
    await prod;

    expect(sandboxMs).toBeLessThan(5_000);
  }, 60_000);

  it("a different lock namespace does not contend either", async () => {
    let releaseA!: () => void;
    const held = new Promise<void>((r) => (releaseA = r));
    let enteredA!: () => void;
    const inside = new Promise<void>((r) => (enteredA = r));
    const a = withQboRefreshLock(
      "production",
      async () => {
        enteredA();
        await held;
      },
      { db: db as never, namespace },
    );
    await inside;
    await withQboRefreshLock("production", async () => undefined, {
      db: db as never,
      namespace: `${namespace}:other`,
    });
    releaseA();
    await a;
  }, 60_000);

  it("releases the lock when the callback throws (transaction rolls back)", async () => {
    await expect(
      withQboRefreshLock(
        "production",
        async () => {
          throw new Error("boom");
        },
        { db: db as never, namespace },
      ),
    ).rejects.toThrow("boom");
    await withQboRefreshLock("production", async () => undefined, { db: db as never, namespace });
  }, 60_000);
});
