import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KATANA_BUCKET_KEY,
  KATANA_RATE_LIMIT_NO_DATABASE,
  KATANA_RATE_LIMIT_TABLE_MISSING,
  KATANA_TABLE_MISSING_ALERT_WINDOW_MS,
  KATANA_TENANT_CONCURRENCY,
  createKatanaSharedBucketPacer,
  isKatanaSharedBucketEnabled,
  resetKatanaThrottleAlertState,
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
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  katanaRateLimitStore,
  setKatanaRequestPacer,
} from "@/lib/katana";
import { runKatanaStep } from "@/inngest/katana-step";
import { NonRetriableError } from "inngest";

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

describe("D2: default shared-bucket pacer is restricted to the app runtime (NEXT_RUNTIME)", () => {
  // DB-free proof of the gate: with POSTGRES_URL unset the REAL default pacer throws
  // RATE_LIMIT_NO_DATABASE if (and only if) it is engaged. It can never reach a database.
  const saved = {
    VITEST: process.env.VITEST,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    KATANA_SHARED_BUCKET: process.env.KATANA_SHARED_BUCKET,
    KATANA_E2E_MIRROR: process.env.KATANA_E2E_MIRROR,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };
  const realFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "t";
    delete process.env.KATANA_SHARED_BUCKET;
    delete process.env.KATANA_E2E_MIRROR;
    delete process.env.POSTGRES_URL; // the gate test must never be able to open a connection
    // Pretend we are NOT under Vitest so only the NEXT_RUNTIME gate is being exercised.
    delete process.env.VITEST;
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchSpy as never;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    globalThis.fetch = realFetch;
    setKatanaRequestPacer(null);
  });

  it("NEXT_RUNTIME unset (tsx CLI / plain Node): NO default pacer, so no Postgres client is created", async () => {
    delete process.env.NEXT_RUNTIME;
    await expect(katanaFetch("/x")).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("NEXT_RUNTIME=nodejs (route handlers / Inngest serve route): the shared bucket IS engaged (and fails closed with no database)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await expect(katanaFetch("/x")).rejects.toMatchObject({
      code: KATANA_RATE_LIMIT_NO_DATABASE,
      status: 503,
    });
    expect(fetchSpy).not.toHaveBeenCalled(); // never reached Katana unthrottled
  });

  it("KATANA_SHARED_BUCKET=off still disables it in the app runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.KATANA_SHARED_BUCKET = "off";
    await expect(katanaFetch("/x")).resolves.toMatchObject({ status: 200 });
  });

  it("KATANA_E2E_MIRROR=true (QA mirror) still disables it in the app runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.KATANA_E2E_MIRROR = "true";
    await expect(katanaFetch("/x")).resolves.toMatchObject({ status: 200 });
  });

  it("an explicit setKatanaRequestPacer ALWAYS wins, in every runtime", async () => {
    const explicit = vi.fn(async () => {});
    setKatanaRequestPacer(explicit);
    for (const runtime of [undefined, "nodejs"]) {
      if (runtime === undefined) delete process.env.NEXT_RUNTIME;
      else process.env.NEXT_RUNTIME = runtime;
      await expect(katanaFetch("/x")).resolves.toMatchObject({ status: 200 });
    }
    expect(explicit).toHaveBeenCalledTimes(2);
  });
});

describe("D3: the shared bucket fails CLOSED", () => {
  const env = { POSTGRES_URL: "postgres://user:pw@host:5432/db" };
  const okAlert = { ok: true as const, emailed: true, resolutionUrl: "u" };

  function undefinedTable(): Error {
    return Object.assign(new Error('relation "rate_limit_buckets" does not exist'), { code: "42P01" });
  }
  function wrapped(inner: Error): Error {
    return Object.assign(new Error("Failed query: UPDATE rate_limit_buckets ..."), { cause: inner });
  }
  function pacerWith(over: {
    acquire?: () => Promise<unknown>;
    alert?: ReturnType<typeof vi.fn>;
    now?: () => number;
    env?: Record<string, string | undefined>;
  }) {
    const alert = over.alert ?? vi.fn(async () => okAlert);
    const pacer = createKatanaSharedBucketPacer(over.env ?? env, {
      acquire: (over.acquire ?? (async () => undefined)) as never,
      getDb: (() => ({})) as never,
      alert: alert as never,
      now: over.now,
    });
    return { pacer, alert };
  }

  beforeEach(() => {
    resetKatanaThrottleAlertState();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["42P01 directly", () => undefinedTable()],
    ["42P01 nested under cause", () => wrapped(undefinedTable())],
    ["42P01 two causes deep", () => wrapped(wrapped(undefinedTable()))],
  ])("a missing rate_limit_buckets table (%s) throws KatanaApiError 503, never lets the call through", async (_n, make) => {
    const { pacer, alert } = pacerWith({
      acquire: async () => {
        throw make();
      },
    });
    const error = await pacer().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(KatanaApiError);
    expect((error as KatanaApiError).code).toBe(KATANA_RATE_LIMIT_TABLE_MISSING);
    expect((error as KatanaApiError).status).toBe(503); // non-429: not a 65s RetryAfterError
    expect((error as KatanaApiError).message).toMatch(/migration 0054/);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unknown", source: "katana" }),
    );
  });

  it("alerts at most once per 10 minutes per process, but ALWAYS throws", async () => {
    let t = 1_000_000;
    const { pacer, alert } = pacerWith({
      acquire: async () => {
        throw undefinedTable();
      },
      now: () => t,
    });
    for (let i = 0; i < 5; i += 1) {
      await expect(pacer()).rejects.toMatchObject({ code: KATANA_RATE_LIMIT_TABLE_MISSING });
    }
    expect(alert).toHaveBeenCalledTimes(1);
    t += KATANA_TABLE_MISSING_ALERT_WINDOW_MS - 1;
    await expect(pacer()).rejects.toMatchObject({ code: KATANA_RATE_LIMIT_TABLE_MISSING });
    expect(alert).toHaveBeenCalledTimes(1);
    t += 1;
    await expect(pacer()).rejects.toMatchObject({ code: KATANA_RATE_LIMIT_TABLE_MISSING });
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("an alert that rejects, or returns ok:false, never masks the thrown error", async () => {
    for (const alert of [
      vi.fn(async () => {
        throw new Error("resend exploded");
      }),
      vi.fn(async () => ({ ok: false as const, error: "no admin email" })),
    ]) {
      resetKatanaThrottleAlertState();
      const { pacer } = pacerWith({
        acquire: async () => {
          throw undefinedTable();
        },
        alert,
      });
      await expect(pacer()).rejects.toMatchObject({
        name: "KatanaApiError",
        code: KATANA_RATE_LIMIT_TABLE_MISSING,
      });
      expect(alert).toHaveBeenCalledTimes(1);
    }
  });

  it("a missing POSTGRES_URL throws (no silent skip) and makes no DB call", async () => {
    const acquire = vi.fn(async () => undefined);
    const { pacer } = pacerWith({ acquire, env: {} });
    await expect(pacer()).rejects.toMatchObject({
      name: "KatanaApiError",
      status: 503,
      code: KATANA_RATE_LIMIT_NO_DATABASE,
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("every other acquireToken error still throws unchanged and does not alert", async () => {
    const boom = new Error("connection reset");
    const { pacer, alert } = pacerWith({
      acquire: async () => {
        throw boom;
      },
    });
    await expect(pacer()).rejects.toBe(boom);
    expect(alert).not.toHaveBeenCalled();
  });

  it("a successful acquire resolves and never alerts", async () => {
    const { pacer, alert } = pacerWith({});
    await expect(pacer()).resolves.toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });

  it("inside runKatanaStep a missing table is NON-retriable (goes straight to the DLQ), not a 65s retry", async () => {
    const { pacer } = pacerWith({
      acquire: async () => {
        throw undefinedTable();
      },
    });
    const step = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };
    setKatanaRequestPacer(pacer);
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "t";
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as never;
    try {
      const error = await runKatanaStep(step, "s", () => katanaFetch("/x")).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(NonRetriableError);
      expect((error as Error).message).toMatch(/migration 0054/);
      expect(fetchSpy).not.toHaveBeenCalled(); // Katana was never reached
    } finally {
      setKatanaRequestPacer(null);
      globalThis.fetch = realFetch;
      delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    }
  });

  it("a real 429 inside runKatanaStep is still a RetryAfterError (unchanged)", async () => {
    const step = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };
    const error = await runKatanaStep(step, "s", async () => {
      throw new KatanaApiError("limit", { status: 429, code: "RATE_LIMIT" });
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as Error).name).toBe("RetryAfterError");
    expect(katanaRateLimitStore).toBeDefined();
  });
});
