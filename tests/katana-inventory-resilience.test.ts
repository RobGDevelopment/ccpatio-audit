import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  clampKatanaWaitMs,
  KATANA_RETRY_AFTER_CEILING_MS,
  resolveKatanaRetryWaitMs,
} from "@/lib/katana-rate-limit-wait";
import {
  HUB_SYNC_FRESH_MS,
  HUB_SYNC_STALE_MS,
  resolveHubSyncBadge,
  sanitizeShowroomSyncWarning,
} from "@/server/stock/hub-sync-freshness";
import {
  KATANA_BUCKET_CAPACITY,
  KATANA_BUCKET_KEY,
  KATANA_BUCKET_MAX_WAIT_MS,
  KATANA_BULK_MIN_TOKENS,
  KATANA_PRIORITY_MAX_WAIT_MS,
  KATANA_PRIORITY_MIN_TOKENS,
  KATANA_SYNC_LOCK_KEY,
  createKatanaSharedBucketPacer,
  resetKatanaRateLimitBucket,
} from "@/server/sre/katana-throttle";
import { katanaFetch, katanaRateLimitStore, runWithKatanaPriorityLane } from "@/lib/katana";
import { runKatanaStep } from "@/inngest/katana-step";
import { RetryAfterError } from "inngest";

const root = (...parts: string[]) => join(process.cwd(), ...parts);

describe("katana retry wait clamp", () => {
  it("clamps poisoned epoch-ms X-RateLimit-Reset to <= 65s", () => {
    const poisonedMs = Date.now() + 86_400_000 * 365; // ~1 year ahead in ms
    expect(resolveKatanaRetryWaitMs(poisonedMs)).toBeLessThanOrEqual(KATANA_RETRY_AFTER_CEILING_MS);
  });

  it("clamps poisoned epoch-seconds far in the future to <= 65s", () => {
    const poisonedSec = Math.floor(Date.now() / 1000) + 86_400 * 30;
    expect(resolveKatanaRetryWaitMs(poisonedSec)).toBeLessThanOrEqual(KATANA_RETRY_AFTER_CEILING_MS);
  });

  it("treats small Retry-After deltas as seconds and still clamps", () => {
    expect(resolveKatanaRetryWaitMs(60)).toBeLessThanOrEqual(KATANA_RETRY_AFTER_CEILING_MS);
    expect(resolveKatanaRetryWaitMs(60)).toBeGreaterThanOrEqual(60_000);
  });

  it("clampKatanaWaitMs never exceeds the ceiling", () => {
    expect(clampKatanaWaitMs(999_999_999)).toBe(KATANA_RETRY_AFTER_CEILING_MS);
    expect(clampKatanaWaitMs(-5)).toBe(0);
  });

  it("katanaFetch sleep path uses the clamped wait (fake timers)", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "test-token";
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce({
      status: 429,
      ok: false,
      headers: new Headers({
        "X-Ratelimit-Reset": String(Date.now() + 3_600_000_000),
      }),
      text: async () => JSON.stringify({ message: "Rate limit" }),
    });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => JSON.stringify({ data: "ok" }),
    });

    const pending = katanaFetch("/clamp-test");
    await vi.advanceTimersByTimeAsync(KATANA_RETRY_AFTER_CEILING_MS);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    globalThis.fetch = realFetch;
    delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runKatanaStep RetryAfterError wait is clamped", async () => {
    const mockFetch = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    process.env.KATANA_PERSONAL_ACCESS_TOKEN = "test-token";
    mockFetch.mockResolvedValueOnce({
      status: 429,
      ok: false,
      headers: new Headers({
        "X-Ratelimit-Reset": String(Math.floor(Date.now() / 1000) + 86_400 * 10),
      }),
      text: async () => JSON.stringify({ message: "Rate limit" }),
    });

    const mockStep = { run: async (_id: string, fn: () => Promise<unknown>) => fn() };
    try {
      await runKatanaStep(mockStep, "clamp-step", () => katanaFetch("/defer-clamp"));
      expect.fail("expected RetryAfterError");
    } catch (error) {
      expect(error).toBeInstanceOf(RetryAfterError);
      const retryAfter = (error as { retryAfter?: number | string }).retryAfter;
      const n = typeof retryAfter === "number" ? retryAfter : Number(retryAfter);
      expect(n).toBeLessThanOrEqual(KATANA_RETRY_AFTER_CEILING_MS);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.KATANA_PERSONAL_ACCESS_TOKEN;
    }
  });
});

describe("Hub synced badge freshness", () => {
  it("is green under 30 minutes, amber 30m–2h, red over 2h", () => {
    const now = Date.now();
    expect(resolveHubSyncBadge(new Date(now - 5 * 60_000).toISOString(), now).tone).toBe("green");
    expect(
      resolveHubSyncBadge(new Date(now - HUB_SYNC_FRESH_MS - 1).toISOString(), now).tone,
    ).toBe("amber");
    expect(
      resolveHubSyncBadge(new Date(now - HUB_SYNC_STALE_MS - 1).toISOString(), now).statusLabel,
    ).toMatch(/Snapshot Stale/i);
    expect(
      resolveHubSyncBadge(new Date(now - HUB_SYNC_STALE_MS - 1).toISOString(), now).tone,
    ).toBe("red");
    expect(
      resolveHubSyncBadge(new Date(now - HUB_SYNC_STALE_MS - 1).toISOString(), now).showRefreshButton,
    ).toBe(true);
  });

  it("sanitizes raw rate-limit developer strings", () => {
    expect(
      sanitizeShowroomSyncWarning(
        "Katana shared rate-limit bucket: no token available after 30221ms. Deferring.",
      ),
    ).toBeNull();
    expect(sanitizeShowroomSyncWarning("Warehouse B is offline")).toBe("Warehouse B is offline");
  });
});

describe("priority lane + bucket self-heal contracts", () => {
  it("reserves capacity 2 with bulk minTokens=2 and priority minTokens=1", () => {
    expect(KATANA_BUCKET_CAPACITY).toBe(2);
    expect(KATANA_BULK_MIN_TOKENS).toBe(2);
    expect(KATANA_PRIORITY_MIN_TOKENS).toBe(1);
    expect(KATANA_PRIORITY_MAX_WAIT_MS).toBeLessThan(KATANA_BUCKET_MAX_WAIT_MS);
    expect(KATANA_BUCKET_MAX_WAIT_MS).toBeLessThanOrEqual(KATANA_RETRY_AFTER_CEILING_MS);
  });

  it("priority lane acquire uses shorter maxWait and lower minTokens", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const pacer = createKatanaSharedBucketPacer(
      { POSTGRES_URL: "postgres://x" },
      {
        acquire: (async (opts: Record<string, unknown>) => {
          calls.push(opts);
        }) as never,
        getDb: (() => ({})) as never,
      },
    );

    await pacer(); // bulk default
    await runWithKatanaPriorityLane(() => pacer());

    expect(calls).toHaveLength(2);
    expect(calls[0]?.minTokensToTake).toBe(KATANA_BULK_MIN_TOKENS);
    expect(calls[0]?.maxWaitMs).toBe(KATANA_BUCKET_MAX_WAIT_MS);
    expect(calls[1]?.minTokensToTake).toBe(KATANA_PRIORITY_MIN_TOKENS);
    expect(calls[1]?.maxWaitMs).toBe(KATANA_PRIORITY_MAX_WAIT_MS);
  });

  it("reset helper targets bucket + sync-lock keys", () => {
    const src = readFileSync(root("src/server/sre/katana-throttle.ts"), "utf8");
    expect(src).toContain("export async function resetKatanaRateLimitBucket");
    expect(src).toContain(KATANA_BUCKET_KEY);
    expect(src).toContain(KATANA_SYNC_LOCK_KEY);
    expect(typeof resetKatanaRateLimitBucket).toBe("function");
  });
});

describe("showroom decoupling static guards", () => {
  it("SalesStockView uses tone-aware Hub synced badge (no forever-green)", () => {
    const src = readFileSync(root("src/app/showroom/stock/SalesStockView.tsx"), "utf8");
    expect(src).toContain("hub-synced-badge");
    expect(src).toContain("data-tone");
    expect(src).toContain("badge.statusLabel");
    expect(src).toContain("hub-sync-refresh");
    expect(src).not.toMatch(/stale \? "bg-amber-50/);
    const freshness = readFileSync(root("src/server/stock/hub-sync-freshness.ts"), "utf8");
    expect(freshness).toContain("Refreshing in background");
    expect(freshness).toContain("Snapshot Stale");
  });

  it("embed showroom page loads Hub sales projection only", () => {
    const page = readFileSync(root("src/app/embed/showroom/page.tsx"), "utf8");
    expect(page).toContain("loadShowroomSalesInventory");
    expect(page).not.toMatch(/refreshShowroomSnapshotFromKatana|getKatanaInventorySnapshot/);
  });

  it("showroom inventory GET/POST never awaits live Katana refresh", () => {
    const route = readFileSync(root("src/app/api/katana/showroom-inventory/route.ts"), "utf8");
    expect(route).toContain("enqueueBackgroundShowroomSync");
    expect(route).toContain("readShowroomSnapshotFromHub");
    expect(route).not.toMatch(/await refreshShowroomSnapshotFromKatana/);
    expect(route).toContain("sanitizeShowroomSyncWarning");
  });

  it("sales inventory loader enqueues background sync and sanitizes warnings", () => {
    const stock = readFileSync(root("src/server/showroom/stock.ts"), "utf8");
    expect(stock).toContain("enqueueBackgroundShowroomSync");
    expect(stock).toContain("sanitizeShowroomSyncWarning");
    expect(stock).toContain("resolveHubSyncBadge");
    expect(stock).not.toMatch(/await refreshShowroomSnapshotFromKatana/);
  });

  it("checkpointed inventory sync + reset helper exist", () => {
    const snap = readFileSync(root("src/server/stock/showroom-snapshot.ts"), "utf8");
    expect(snap).toContain("persistShowroomCheckpoint");
    expect(snap).toContain("loadKatanaInventoryWithCheckpoints");
    expect(snap).toContain("resetBucketAndSyncKatanaNow");
    expect(snap).toContain("tryClaimShowroomSyncLock");
    const inv = readFileSync(root("src/server/stock/katana-inventory.ts"), "utf8");
    expect(inv).toContain("loadKatanaInventoryWithCheckpoints");
    expect(inv).toContain("onCheckpoint");
  });

  it("Executive Control Center wires Reset Bucket & Sync Katana Now", () => {
    const strip = readFileSync(
      root("src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain("katana_reset_bucket_sync");
    expect(strip).toContain("resetKatanaBucketAndSyncAction");
    const actions = readFileSync(root("src/app/embed/admin/master-catalog/actions.ts"), "utf8");
    expect(actions).toContain("Reset Bucket & Sync Katana Now");
    expect(actions).toContain("getKatanaBucketHealth");
    expect(actions).toContain("resolveHubSyncBadge");
  });

  it("Place Hold uses the priority lane", () => {
    const hold = readFileSync(root("src/server/stock/create-hold.ts"), "utf8");
    expect(hold).toContain("runWithKatanaPriorityLane");
  });
});

describe("showroom load under exhausted bucket (0ms Katana wait)", () => {
  it("sales path composes Hub badge + sanitized warning without rate-limit leak", () => {
    const syncedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const badge = resolveHubSyncBadge(syncedAt);
    const warning = sanitizeShowroomSyncWarning(
      "Katana shared rate-limit bucket: no token available after 30221ms. Deferring.",
    );
    expect(badge.tone).toBe("red");
    expect(warning).toBeNull();
    expect(badge.statusLabel).not.toMatch(/30221ms|token available/);
  });

  it("shared bucket pacer is the sole 30s wait emitter — showroom reads never import it", () => {
    const stock = readFileSync(root("src/server/showroom/stock.ts"), "utf8");
    const page = readFileSync(root("src/app/embed/showroom/page.tsx"), "utf8");
    const sales = readFileSync(root("src/app/showroom/stock/SalesStockView.tsx"), "utf8");
    for (const src of [stock, page, sales]) {
      expect(src).not.toMatch(/katana-throttle|acquireToken|KATANA_BUCKET_MAX_WAIT/);
    }
    const throttle = readFileSync(root("src/server/sre/katana-throttle.ts"), "utf8");
    expect(throttle).toContain("no token available after");
    expect(throttle).toContain("KATANA_BUCKET_MAX_WAIT_MS");
  });
});

describe("katanaRateLimitStore still exports defer policy", () => {
  it("keeps defer ALS for Inngest", () => {
    expect(katanaRateLimitStore).toBeTruthy();
  });
});
