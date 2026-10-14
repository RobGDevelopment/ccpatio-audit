/**
 * Phase 11 remediation — release event payload contract (QCA m2) and GHL re-sync id (QCA M9).
 *
 * `pathAReleaseEventSchema` existed but was never applied: senders emitted a free-form
 * `triggerSource` and Function 2 defaulted a missing one to "unknown". Every sender now builds its
 * payload through `buildPathAReleaseEventData`, which validates against the schema.
 */
import { describe, expect, it } from "vitest";
import {
  buildPathAReleaseEventData,
  buildPathAReleaseEventDataFromSaga,
  pathAGhlSyncEventId,
  pathAReleaseEventSchema,
} from "@/server/path-a/events";

describe("buildPathAReleaseEventData (m2)", () => {
  it("builds a schema-valid management_override payload", () => {
    const data = buildPathAReleaseEventData({
      ghlOpportunityId: " opp-1 ",
      source: "management_override",
      requestedBy: "manager@ccpatio.com",
      reason: "Owner requested immediate fabrication start",
      attempt: 2,
    });
    expect(data).toMatchObject({
      ghlOpportunityId: "opp-1",
      source: "management_override",
      requestedBy: "manager@ccpatio.com",
      attempt: 2,
    });
    expect(pathAReleaseEventSchema.safeParse(data).success).toBe(true);
    expect(data).not.toHaveProperty("triggerSource");
  });

  it("requires deposit fields for customer_deposit", () => {
    expect(() =>
      buildPathAReleaseEventData({
        ghlOpportunityId: "opp-1",
        source: "customer_deposit",
        requestedBy: "system:deposit",
        attempt: 1,
      }),
    ).toThrow();
    const ok = buildPathAReleaseEventData({
      ghlOpportunityId: "opp-1",
      source: "customer_deposit",
      requestedBy: "system:deposit",
      depositCents: 250000,
      depositRef: "QBO-DEP-202",
      attempt: 1,
    });
    expect(ok.depositCents).toBe(250000);
  });

  it("rejects an unknown source or blank requester (no 'unknown' fallback)", () => {
    expect(() =>
      buildPathAReleaseEventData({
        ghlOpportunityId: "opp-1",
        source: "operator_retry" as never,
        requestedBy: "x",
        attempt: 1,
      }),
    ).toThrow();
    expect(() =>
      buildPathAReleaseEventData({
        ghlOpportunityId: "opp-1",
        source: "management_override",
        requestedBy: "  ",
        attempt: 1,
      }),
    ).toThrow();
  });
});

describe("buildPathAReleaseEventDataFromSaga (retry / replay re-use the RECORDED request)", () => {
  it("rebuilds an override payload from the saga row", () => {
    const data = buildPathAReleaseEventDataFromSaga(
      "opp-1",
      {
        release_source: "management_override",
        release_requested_by: "manager@ccpatio.com",
        release_reason: "Owner requested",
        deposit_cents: null,
        deposit_ref: null,
      },
      3,
    );
    expect(data.source).toBe("management_override");
    expect(data.requestedBy).toBe("manager@ccpatio.com");
    expect(data.attempt).toBe(3);
  });

  it("rebuilds a deposit payload including money fields", () => {
    const data = buildPathAReleaseEventDataFromSaga(
      "opp-1",
      {
        release_source: "customer_deposit",
        release_requested_by: "system:deposit",
        release_reason: null,
        deposit_cents: 250000,
        deposit_ref: "QBO-DEP-202",
      },
      1,
    );
    expect(data).toMatchObject({ source: "customer_deposit", depositCents: 250000, depositRef: "QBO-DEP-202" });
  });

  it("throws when the saga row carries no recorded source (never invents one)", () => {
    expect(() =>
      buildPathAReleaseEventDataFromSaga(
        "opp-1",
        { release_source: null, release_requested_by: null, release_reason: null, deposit_cents: null, deposit_ref: null },
        1,
      ),
    ).toThrow();
  });
});

describe("pathAGhlSyncEventId (M9)", () => {
  it("differs per attempt discriminator so Inngest dedupe cannot swallow a re-sync", () => {
    expect(pathAGhlSyncEventId("opp-1", 1)).not.toBe(pathAGhlSyncEventId("opp-1", 2));
    expect(pathAGhlSyncEventId("opp-1", 1)).toBe(pathAGhlSyncEventId("opp-1", 1));
  });
});
