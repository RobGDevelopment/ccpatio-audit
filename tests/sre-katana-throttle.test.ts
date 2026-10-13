import { describe, expect, it } from "vitest";
import {
  KATANA_BUCKET_KEY,
  KATANA_TENANT_CONCURRENCY,
  isKatanaSharedBucketEnabled,
} from "@/server/sre/katana-throttle";
import {
  archiveKatanaVariant,
  publishApprovedProduct,
  pushApprovedFactoryOrder,
  releaseCustomJob,
  systemHealthPing,
} from "@/inngest/functions";
import { autoReleaseExpiredHolds } from "@/server/inngest/inventory-holds";
import { sweepExpiredInventoryHolds } from "@/server/stock/sweep-expired-holds";
import { createIntervalPacer, katanaFetch, setKatanaRequestPacer } from "@/lib/katana";

function concurrencyOf(fn: unknown): unknown {
  const opts = (fn as { opts?: { concurrency?: unknown } }).opts;
  return opts?.concurrency;
}

function entriesOf(fn: unknown): Array<Record<string, unknown>> {
  const c = concurrencyOf(fn);
  return (Array.isArray(c) ? c : [c]) as Array<Record<string, unknown>>;
}

describe("KATANA_TENANT_CONCURRENCY", () => {
  it("is env-scoped, limit 1, with a CEL string-literal key", () => {
    expect(KATANA_TENANT_CONCURRENCY).toEqual({ scope: "env", key: '"katana-tenant"', limit: 1 });
  });

  it.each([
    ["publishApprovedProduct", publishApprovedProduct],
    ["archiveKatanaVariant", archiveKatanaVariant],
    ["releaseCustomJob", releaseCustomJob],
    ["pushApprovedFactoryOrder", pushApprovedFactoryOrder],
    ["autoReleaseExpiredHolds", autoReleaseExpiredHolds],
    ["sweepExpiredInventoryHolds", sweepExpiredInventoryHolds],
    ["systemHealthPing", systemHealthPing],
  ])("%s carries the tenant limit", (_name, fn) => {
    expect(entriesOf(fn)).toContainEqual(KATANA_TENANT_CONCURRENCY);
  });

  it("publishApprovedProduct keeps per-SKU serialization IN ADDITION to the tenant limit", () => {
    const entries = entriesOf(publishApprovedProduct);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ limit: 1, key: "event.data.globalSku" });
  });

  it("the holds sweepers keep their own fn-scoped limit of 1", () => {
    for (const fn of [autoReleaseExpiredHolds, sweepExpiredInventoryHolds]) {
      expect(entriesOf(fn)).toContainEqual({ limit: 1 });
    }
  });
});

describe("isKatanaSharedBucketEnabled", () => {
  it("is ON by default in the app runtime", () => {
    expect(isKatanaSharedBucketEnabled({})).toBe(true);
    expect(isKatanaSharedBucketEnabled({ KATANA_SHARED_BUCKET: "on" })).toBe(true);
    expect(isKatanaSharedBucketEnabled({ KATANA_SHARED_BUCKET: "garbage" })).toBe(true);
  });

  it("is OFF under Vitest, with KATANA_SHARED_BUCKET=off (any case/whitespace), or on the QA mirror", () => {
    expect(isKatanaSharedBucketEnabled({ VITEST: "true" })).toBe(false);
    expect(isKatanaSharedBucketEnabled({ KATANA_SHARED_BUCKET: "off" })).toBe(false);
    expect(isKatanaSharedBucketEnabled({ KATANA_SHARED_BUCKET: " OFF " })).toBe(false);
    expect(isKatanaSharedBucketEnabled({ KATANA_E2E_MIRROR: "true" })).toBe(false);
  });

  it("uses one stable bucket key", () => {
    expect(KATANA_BUCKET_KEY).toBe("katana:api");
  });
});

describe("katanaFetch pacer precedence", () => {
  it("an explicitly installed pacer always runs (and the shared bucket never does under Vitest)", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "t";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    setKatanaRequestPacer(async () => {
      calls.push("cli-pacer");
    });
    try {
      await katanaFetch("/x");
      await katanaFetch("/y");
      expect(calls).toEqual(["cli-pacer", "cli-pacer"]);
    } finally {
      setKatanaRequestPacer(null);
      globalThis.fetch = realFetch;
      delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    }
  });

  it("with no pacer installed under Vitest, katanaFetch is not delayed by any bucket", async () => {
    const realFetch = globalThis.fetch;
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "t";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
    try {
      const started = Date.now();
      for (let i = 0; i < 5; i += 1) await katanaFetch(`/z${i}`);
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    }
  });

  it("createIntervalPacer is still exported for CLI scripts", () => {
    expect(typeof createIntervalPacer(1)).toBe("function");
  });
});
