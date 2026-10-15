import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpokePingResult } from "@/server/mdm/token-health";

vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/server/mdm/token-health", () => ({ runSpokeTokenHealthCheck: vi.fn() }));

import {
  DLQ_RED_OPEN_THRESHOLD,
  QBO_IDLE_AMBER_DAYS,
  QBO_IDLE_RED_DAYS,
  deriveDlqVerdict,
  deriveGhlVerdict,
  deriveQboVerdict,
  pingGhl,
  readSystemLamps,
  type DlqSnapshot,
  type GhlPing,
  type HealthDeps,
  type QboSnapshot,
} from "@/server/mission-control/health-probes";
import { deriveTrafficMatrix } from "@/server/mission-control/sync-matrix";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const connectedQbo: QboSnapshot = {
  hasTokenRow: true,
  hasRefreshToken: true,
  accessExpiresAt: daysAgo(1),
  failedSagas: 0,
};

describe("QuickBooks lamp", () => {
  it("is green when connected, recently used, and no saga failed", () => {
    expect(deriveQboVerdict(connectedQbo, NOW).lamp).toBe("green");
  });

  it("is red with no token row or no refresh token", () => {
    expect(deriveQboVerdict({ ...connectedQbo, hasTokenRow: false }, NOW).lamp).toBe("red");
    expect(deriveQboVerdict({ ...connectedQbo, hasRefreshToken: false }, NOW).lamp).toBe("red");
  });

  it("is red when a ledger saga needs manual intervention", () => {
    const verdict = deriveQboVerdict({ ...connectedQbo, failedSagas: 2 }, NOW);
    expect(verdict.lamp).toBe("red");
    expect(verdict.detail).toContain("2 ledger sagas need");
  });

  it("goes amber then red as the refresh token nears its 100 day lapse", () => {
    const at = (days: number) =>
      deriveQboVerdict({ ...connectedQbo, accessExpiresAt: daysAgo(days) }, NOW).lamp;
    expect(at(QBO_IDLE_AMBER_DAYS - 1)).toBe("green");
    expect(at(QBO_IDLE_AMBER_DAYS)).toBe("amber");
    expect(at(QBO_IDLE_RED_DAYS - 1)).toBe("amber");
    expect(at(QBO_IDLE_RED_DAYS)).toBe("red");
  });

  it("is amber when the expiry is unknown", () => {
    expect(deriveQboVerdict({ ...connectedQbo, accessExpiresAt: null }, NOW).lamp).toBe("amber");
  });
});

describe("GoHighLevel lamp", () => {
  const base: GhlPing = { configured: true, ok: true, status: 200, authFailed: false };

  it("maps configured/ok/auth/unreachable/other", () => {
    expect(deriveGhlVerdict(base).lamp).toBe("green");
    expect(deriveGhlVerdict({ ...base, configured: false, ok: false, status: null }).lamp).toBe("red");
    expect(deriveGhlVerdict({ ...base, ok: false, status: 401, authFailed: true }).lamp).toBe("red");
    expect(deriveGhlVerdict({ ...base, ok: false, status: null }).lamp).toBe("amber");
    expect(deriveGhlVerdict({ ...base, ok: false, status: 503 }).lamp).toBe("amber");
  });

  it("skips the network call when unconfigured", async () => {
    const doFetch = vi.fn();
    const ping = await pingGhl(doFetch as unknown as typeof fetch, {});
    expect(ping.configured).toBe(false);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it("makes exactly one GET and flags a rejected token", async () => {
    const doFetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const ping = await pingGhl(doFetch as unknown as typeof fetch, {
      GHL_PRIVATE_INTEGRATION_TOKEN: "pit-secret",
      GHL_LOCATION_ID: "loc_1",
    });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(ping).toMatchObject({ configured: true, ok: false, status: 403, authFailed: true });
  });

  it("treats a network failure as unreachable without throwing", async () => {
    const doFetch = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const ping = await pingGhl(doFetch as unknown as typeof fetch, {
      GHL_PRIVATE_INTEGRATION_TOKEN: "pit-secret",
      GHL_LOCATION_ID: "loc_1",
    });
    expect(ping).toMatchObject({ configured: true, ok: false, status: null });
  });
});

describe("Inngest DLQ lamp", () => {
  const dlq = (over: Partial<DlqSnapshot>): DlqSnapshot => ({
    open: 0,
    unalerted: 0,
    oldestOpenAt: null,
    ...over,
  });

  it("is green when empty", () => {
    expect(deriveDlqVerdict(dlq({}), NOW).lamp).toBe("green");
  });

  it("is amber for a few alerted rows and red once the threshold is reached", () => {
    expect(deriveDlqVerdict(dlq({ open: 2, oldestOpenAt: daysAgo(3) }), NOW)).toMatchObject({
      lamp: "amber",
      detail: "2 open, oldest 3d.",
    });
    expect(deriveDlqVerdict(dlq({ open: DLQ_RED_OPEN_THRESHOLD }), NOW).lamp).toBe("red");
  });

  it("is red when nobody was told about an open row", () => {
    expect(deriveDlqVerdict(dlq({ open: 1, unalerted: 1 }), NOW).lamp).toBe("red");
  });
});

describe("readSystemLamps", () => {
  const pings: SpokePingResult[] = (["WordPressCore", "Katana", "WooCommerce", "Clover"] as const).map(
    (spoke) => ({ spoke, ok: true, status: 200, authFailed: false, detail: "ok" }),
  );
  const healthy: Partial<HealthDeps> = {
    now: () => NOW,
    pingSpokes: async () => pings,
    readSyncCounts: async () => [],
    readQbo: async () => connectedQbo,
    pingGhl: async () => ({ configured: true, ok: true, status: 200, authFailed: false }),
    readDlq: async () => ({ open: 0, unalerted: 0, oldestOpenAt: null }),
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("returns the four core lamps then the three channel lamps", async () => {
    const lamps = await readSystemLamps(healthy);
    expect(lamps.filter((l) => l.group === "core").map((l) => l.id)).toEqual(["qbo", "ghl", "katana", "dlq"]);
    expect(lamps.filter((l) => l.group === "channels").map((l) => l.id)).toEqual([
      "wordpress",
      "woocommerce",
      "clover",
    ]);
    expect(lamps.every((l) => l.lamp === "green")).toBe(true);
  });

  it("turns one failed probe amber with a reference and leaves the rest intact", async () => {
    const lamps = await readSystemLamps({
      ...healthy,
      readQbo: async () => {
        throw new Error("connection refused: postgres://user:hunter2@db/host");
      },
    });
    const qbo = lamps.find((l) => l.id === "qbo");
    expect(qbo?.lamp).toBe("amber");
    expect(qbo?.detail).toMatch(/^Probe failed\. Reference [0-9a-f]{12}\.$/);
    expect(JSON.stringify(lamps)).not.toContain("hunter2");
    expect(lamps.find((l) => l.id === "dlq")?.lamp).toBe("green");
  });

  it("marks the spoke lamps amber when the token ping itself fails", async () => {
    const lamps = await readSystemLamps({
      ...healthy,
      pingSpokes: async () => {
        throw new Error("boom");
      },
    });
    for (const id of ["katana", "wordpress", "woocommerce", "clover"]) {
      expect(lamps.find((l) => l.id === id)?.lamp).toBe("amber");
    }
  });

  it("keeps the existing traffic matrix derivation unchanged for channel lamps", async () => {
    const counts = [{ channel: "clover", status: "failed", count: 1 }];
    const lamps = await readSystemLamps({ ...healthy, readSyncCounts: async () => counts });
    const expected = deriveTrafficMatrix(pings, counts).find((e) => e.spoke === "Clover");
    const clover = lamps.find((l) => l.id === "clover");
    expect(clover).toMatchObject({ lamp: expected?.lamp, detail: expected?.detail });
    expect(clover?.lamp).toBe("red");
  });
});
