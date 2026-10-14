/**
 * Phase 11 remediation — Path A server actions (QCA M9, m1, m2).
 *
 *  M9: the GHL re-sync event id was the constant `pathAGhlSyncEventId(opp, 1)`, so Inngest's 24h
 *      dedupe silently swallowed every operator re-sync after the first.
 *  m1: `revalidatePath` was wrapped in an empty `catch {}`; errors must surface.
 *  m2: retry sends the recorded request through the validated event schema, not `triggerSource`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  sends: [] as Array<{ id: string; name: string; data: Record<string, unknown> }>,
  session: null as { email: string; name: string; ghl_role?: string | null } | null,
  saga: null as Record<string, unknown> | null,
  revalidate: vi.fn((_path: string) => undefined),
  attempts: 0,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => hoisted.revalidate(p),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(async (payload: { id: string; name: string; data: Record<string, unknown> }) => {
      hoisted.sends.push(payload);
      return { ids: ["x"] };
    }),
  },
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn(async () => hoisted.session),
  isEmbedPrincipal: (s: { email?: string } | null | undefined) => s?.email === "ghl-embed@ccpatio.com",
}));

vi.mock("@/server/path-a/release-store", () => ({
  createReleaseStore: () => ({
    getSaga: vi.fn(async () => hoisted.saga),
    bumpReleaseAttempt: vi.fn(async () => ++hoisted.attempts),
  }),
}));

import { resyncGhlAction, retryReleaseAction } from "@/app/admin/path-a/actions";
import { pathAGhlSyncEventId, pathAReleaseEventSchema } from "@/server/path-a/events";

const ADMIN = { email: "manager@ccpatio.com", name: "Manager", ghl_role: "admin" };

beforeEach(() => {
  hoisted.sends = [];
  hoisted.session = { ...ADMIN };
  hoisted.attempts = 0;
  hoisted.revalidate = vi.fn((_path: string) => undefined);
  hoisted.saga = {
    status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
    current_step: "release_failed:sales_order",
    release_requested_at: new Date("2026-10-13T10:00:00Z"),
    release_source: "management_override",
    release_requested_by: "manager@ccpatio.com",
    release_reason: "Owner requested",
    deposit_cents: null,
    deposit_ref: null,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("M9: resyncGhlAction never reuses a constant dedupe id", () => {
  it("two re-syncs at different times carry different event ids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
    await resyncGhlAction({ ghlOpportunityId: "opp-1" });
    vi.setSystemTime(new Date("2026-10-13T12:05:00.000Z"));
    await resyncGhlAction({ ghlOpportunityId: "opp-1" });

    expect(hoisted.sends).toHaveLength(2);
    expect(hoisted.sends[0].id).not.toBe(hoisted.sends[1].id);
  });

  it("does not use the old fixed attempt=1 id", async () => {
    await resyncGhlAction({ ghlOpportunityId: "opp-1" });
    expect(hoisted.sends[0].id).not.toBe(pathAGhlSyncEventId("opp-1", 1));
  });

  it("still refuses without override authority and sends nothing", async () => {
    hoisted.session = { email: "designer@ccpatio.com", name: "D", ghl_role: "user" };
    const res = await resyncGhlAction({ ghlOpportunityId: "opp-1" });
    expect(res).toEqual({ ok: false, error: "not_authorized" });
    expect(hoisted.sends).toHaveLength(0);
  });
});

describe("m2: retryReleaseAction re-sends the RECORDED request through the validated schema", () => {
  it("emits source/requestedBy from the saga row, a retry id, and no triggerSource", async () => {
    const res = await retryReleaseAction({ ghlOpportunityId: "opp-1" });
    expect(res).toEqual({ ok: true, attempt: 1 });

    const [evt] = hoisted.sends;
    expect(evt.name).toBe("path-a/release-to-production");
    expect(evt.id).toContain("retry:1");
    expect(evt.data.triggerSource).toBeUndefined();
    expect(evt.data.source).toBe("management_override");
    expect(evt.data.requestedBy).toBe("manager@ccpatio.com");
    expect(pathAReleaseEventSchema.safeParse(evt.data).success).toBe(true);
  });

  it("retries a deposit-sourced release with its money fields", async () => {
    hoisted.saga = {
      ...hoisted.saga!,
      release_source: "customer_deposit",
      release_requested_by: "system:deposit",
      deposit_cents: 250000,
      deposit_ref: "QBO-DEP-202",
    };
    await retryReleaseAction({ ghlOpportunityId: "opp-1" });
    expect(hoisted.sends[0].data).toMatchObject({
      source: "customer_deposit",
      depositCents: 250000,
      depositRef: "QBO-DEP-202",
    });
  });

  it("refuses (and sends nothing) when the saga has no recorded request source", async () => {
    hoisted.saga = { ...hoisted.saga!, release_source: null };
    const res = await retryReleaseAction({ ghlOpportunityId: "opp-1" });
    expect(res).toEqual({ ok: false, error: "release_request_incomplete" });
    expect(hoisted.sends).toHaveLength(0);
  });

  it("accepts the manual-failed state produced by markSagaManual (release_failed:<leg>)", async () => {
    hoisted.saga = { ...hoisted.saga!, current_step: "release_failed:mo:JOB-A-SOFA" };
    const res = await retryReleaseAction({ ghlOpportunityId: "opp-1" });
    expect(res.ok).toBe(true);
  });

  it("rejects a saga that is not manual-failed", async () => {
    hoisted.saga = { ...hoisted.saga!, status: "IN_PROGRESS", current_step: "releasing" };
    const res = await retryReleaseAction({ ghlOpportunityId: "opp-1" });
    expect(res.ok).toBe(false);
    expect(hoisted.sends).toHaveLength(0);
  });
});

describe("m1: revalidatePath failures are not swallowed", () => {
  it("retryReleaseAction surfaces a revalidatePath error (after the event was sent)", async () => {
    hoisted.revalidate = vi.fn(() => {
      throw new Error("revalidate boom");
    });
    await expect(retryReleaseAction({ ghlOpportunityId: "opp-1" })).rejects.toThrow("revalidate boom");
    expect(hoisted.sends).toHaveLength(1);
  });

  it("resyncGhlAction surfaces a revalidatePath error", async () => {
    hoisted.revalidate = vi.fn(() => {
      throw new Error("revalidate boom");
    });
    await expect(resyncGhlAction({ ghlOpportunityId: "opp-1" })).rejects.toThrow("revalidate boom");
  });
});
