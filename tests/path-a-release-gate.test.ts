/**
 * Phase 11 remediation — QCA m1: `resetReleaseGate` wrapped `invalidateFinalization` in
 * `catch {}` carrying only a "best-effort" comment, so a stale finalized design could survive a silent failure.
 */
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  inserted: [] as unknown[],
  invalidate: vi.fn(async (_sku: string) => undefined),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: async () => {
          hoisted.inserted.push(v);
        },
      }),
    }),
  }),
}));

vi.mock("@/server/factory-bom/finalize-design", () => ({
  invalidateFinalization: (sku: string) => hoisted.invalidate(sku),
}));

import { resetReleaseGate } from "@/server/factory-bom/release-gate";

describe("resetReleaseGate (m1)", () => {
  it("resets the gate and then invalidates the finalization for that SKU", async () => {
    hoisted.inserted = [];
    hoisted.invalidate.mockClear();
    await resetReleaseGate("JOB-A", ["CHECKLIST"]);
    expect(hoisted.inserted).toHaveLength(1);
    expect(hoisted.invalidate).toHaveBeenCalledWith("JOB-A");
  });

  it("does NOT swallow an invalidateFinalization failure (a stale finalized design must not survive silently)", async () => {
    hoisted.inserted = [];
    hoisted.invalidate.mockReset().mockRejectedValueOnce(new Error("saga store unavailable"));
    await expect(resetReleaseGate("JOB-A")).rejects.toThrow("saga store unavailable");
    // The gate itself was already reset before the failure surfaced.
    expect(hoisted.inserted).toHaveLength(1);
  });
});
