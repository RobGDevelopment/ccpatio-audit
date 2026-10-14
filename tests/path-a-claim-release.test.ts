/**
 * Phase 11 remediation — QCA M5: `claimRelease` must give a single winner.
 * A lost compare-and-set (another run already moved the saga out of AWAITING_DEPOSIT) used to return
 * `resumed`, so BOTH runs proceeded. It must return `not_ready`.
 */
import { describe, expect, it } from "vitest";
import { createReleaseStore } from "@/server/path-a/release-store";

function dbWith(sagaRow: Record<string, unknown> | null, casWins: boolean) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (sagaRow ? [sagaRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            return casWins ? [{ id: "saga-1" }] : [];
          },
        }),
      }),
    }),
  };
  return { db, updates };
}

const base = {
  id: "saga-1",
  release_requested_at: new Date("2026-10-13T10:00:00Z"),
};

describe("claimRelease (M5)", () => {
  it("AWAITING_DEPOSIT + won CAS -> claimed (exactly one winner)", async () => {
    const { db, updates } = dbWith({ ...base, status: "AWAITING_DEPOSIT" }, true);
    const res = await createReleaseStore(() => db as never).claimRelease("opp-1");
    expect(res).toEqual({ outcome: "claimed" });
    expect(updates[0]).toMatchObject({ status: "IN_PROGRESS", current_step: "releasing" });
  });

  it("AWAITING_DEPOSIT + LOST CAS -> not_ready (the other run owns the release)", async () => {
    const { db } = dbWith({ ...base, status: "AWAITING_DEPOSIT" }, false);
    const res = await createReleaseStore(() => db as never).claimRelease("opp-1");
    expect(res).toEqual({ outcome: "not_ready" });
  });

  it("manual-failed + won CAS -> resumed; lost CAS -> not_ready", async () => {
    const won = dbWith({ ...base, status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" }, true);
    expect(await createReleaseStore(() => won.db as never).claimRelease("opp-1")).toEqual({ outcome: "resumed" });
    const lost = dbWith({ ...base, status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" }, false);
    expect(await createReleaseStore(() => lost.db as never).claimRelease("opp-1")).toEqual({ outcome: "not_ready" });
  });

  it("IN_PROGRESS is a crash-resume (no CAS needed)", async () => {
    const { db, updates } = dbWith({ ...base, status: "IN_PROGRESS" }, false);
    expect(await createReleaseStore(() => db as never).claimRelease("opp-1")).toEqual({ outcome: "resumed" });
    expect(updates).toHaveLength(0);
  });

  it.each([
    [null, "no_saga"],
    [{ ...base, release_requested_at: null, status: "AWAITING_DEPOSIT" }, "no_request"],
    [{ ...base, status: "COMPLETED" }, "already_completed"],
    [{ ...base, status: "PENDING" }, "not_ready"],
  ])("static outcomes: %j -> %s", async (row, outcome) => {
    const { db } = dbWith(row as never, true);
    expect(await createReleaseStore(() => db as never).claimRelease("opp-1")).toEqual({ outcome });
  });
});
