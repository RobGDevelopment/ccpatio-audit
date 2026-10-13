import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestManagementOverride,
  recordDepositAndRequestRelease,
} from "@/server/path-a/release-request";
import { canOverrideDesign } from "@/app/admin/path-a/actions";
import { type PimSession } from "@/lib/pim-audit";

const hoisted = vi.hoisted(() => ({
  inngestSends: [] as any[],
  auditLogs: [] as any[],
  session: null as PimSession | null,
  failAuditInsert: false,
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn(async () => hoisted.session),
  isEmbedPrincipal: (s: any) => s?.email === "ghl-embed@ccpatio.com",
}));

describe("Path A Release Request & Deposit Seam (Task 6)", () => {
  let fakeSagas: Map<string, any>;
  let attempts: Map<string, number>;

  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.auditLogs = [];
    hoisted.session = null;
    hoisted.failAuditInsert = false;
    fakeSagas = new Map();
    attempts = new Map();
  });

  function createMockStores() {
    const releaseStore: any = {
      getSaga: vi.fn(async (oppId: string) => fakeSagas.get(oppId) || null),
      bumpReleaseAttempt: vi.fn(async (oppId: string) => {
        const cur = attempts.get(oppId) || 0;
        attempts.set(oppId, cur + 1);
        return cur + 1;
      }),
      requestRelease: vi.fn(async (input: any) => {
        const saga = fakeSagas.get(input.oppId);
        if (!saga) return { outcome: "no_saga" };
        if (saga.releaseRequestedAt) {
          return {
            outcome: "already_requested",
            sameSource: saga.releaseRequestedSource === input.source,
            requestedBy: saga.releaseRequestedBy,
            source: saga.releaseRequestedSource,
          };
        }
        saga.releaseRequestedAt = new Date();
        saga.releaseRequestedBy = input.requestedBy;
        saga.releaseRequestedSource = input.source;
        saga.releaseRequestedReason = input.reason;
        if (input.depositCents != null) {
          saga.depositAmountCents = input.depositCents;
          saga.depositRef = input.depositRef;
        }
        return { outcome: "recorded" };
      }),
    };

    const sagaStore: any = {
      insertOnce: vi.fn(async (type: string, key: string, status: string, opts: any) => {
        if (!fakeSagas.has(key)) {
          fakeSagas.set(key, {
            status,
            current_step: opts?.step,
            releaseRequestedAt: null,
          });
        }
      }),
    };

    const mockDb: any = {
      transaction: async (cb: any) => {
        if (hoisted.failAuditInsert) {
          throw new Error("Audit log insert DB crash");
        }
        return cb(mockDb);
      },
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              const saga = fakeSagas.get("opp-1");
              return saga ? [saga] : [];
            },
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [fakeSagas.get("opp-1")],
          }),
        }),
      }),
      insert: () => ({
        values: async (val: any) => {
          hoisted.auditLogs.push(val);
        },
      }),
    };

    const sendFn = vi.fn(async (payload: any) => {
      hoisted.inngestSends.push(payload);
      return { ids: ["msg-1"] };
    });

    return { releaseStore, sagaStore, db: mockDb, sendFn };
  }

  describe("canOverrideDesign UI hint", () => {
    it("returns allowed: false when unauthenticated", async () => {
      hoisted.session = null;
      const res = await canOverrideDesign();
      expect(res).toEqual({ allowed: false });
    });

    it("returns allowed: false for human session without admin role", async () => {
      hoisted.session = { email: "designer@ccpatio.com", name: "Designer", ghl_role: "salesperson" };
      const res = await canOverrideDesign();
      expect(res).toEqual({ allowed: false });
    });

    it("returns allowed: true only when session has valid admin role", async () => {
      hoisted.session = { email: "manager@ccpatio.com", name: "Manager", ghl_role: "admin" };
      const res = await canOverrideDesign();
      expect(res).toEqual({ allowed: true });
    });
  });

  describe("requestManagementOverride", () => {
    const adminSession: PimSession = {
      email: "manager@ccpatio.com",
      name: "Manager",
      ghl_role: "admin",
    };

    it("rejects unauthorized session", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      const unauthorizedSession: PimSession = {
        email: "designer@ccpatio.com",
        name: "Designer",
        ghl_role: "user",
      };

      const res = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "Valid reason override text here",
          session: unauthorizedSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ ok: false, error: "not_authorized" });
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("validates reason length (10 to 500 characters)", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();

      const shortRes = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "Too short",
          session: adminSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );
      expect(shortRes.ok).toBe(false);
      expect(shortRes.error).toContain("between 10 and 500 characters");

      const longRes = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "a".repeat(501),
          session: adminSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );
      expect(longRes.ok).toBe(false);
      expect(longRes.error).toContain("between 10 and 500 characters");
    });

    it("rejects override when saga is not in AWAITING_DEPOSIT", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      fakeSagas.set("opp-1", { status: "PENDING", releaseRequestedAt: null });

      const res = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "Customer has approved via phone verbal confirmation",
          session: adminSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ ok: false, error: "Design is not finalized yet" });
      expect(sendFn).not.toHaveBeenCalled();
    });

    it("successfully records override, writes audit log, and emits release event", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      fakeSagas.set("opp-1", { status: "AWAITING_DEPOSIT", releaseRequestedAt: null });

      const res = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "Owner requested immediate fabrication start",
          session: adminSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ ok: true });
      expect(hoisted.auditLogs).toHaveLength(1);
      expect(hoisted.auditLogs[0]).toMatchObject({
        operator_email: "manager@ccpatio.com",
        action: "path_a_override",
        new_value: "Owner requested immediate fabrication start",
      });

      expect(hoisted.inngestSends).toHaveLength(1);
      expect(hoisted.inngestSends[0].name).toBe("path-a/release-to-production");
      expect(hoisted.inngestSends[0].data.triggerSource).toBe("management_override");
      expect(hoisted.inngestSends[0].id).toContain("override");
    });

    it("rolls back request if audit log insert fails", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      fakeSagas.set("opp-1", { status: "AWAITING_DEPOSIT", releaseRequestedAt: null });
      hoisted.failAuditInsert = true;

      const res = await requestManagementOverride(
        {
          ghlOpportunityId: "opp-1",
          reason: "Owner requested immediate fabrication start",
          session: adminSession,
        },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res.ok).toBe(false);
      expect(sendFn).not.toHaveBeenCalled();
    });
  });

  describe("recordDepositAndRequestRelease", () => {
    it("validates depositCents > 0 and non-blank depositRef", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();

      const res1 = await recordDepositAndRequestRelease(
        { ghlOpportunityId: "opp-1", depositCents: 0, depositRef: "DEP-1" },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );
      expect(res1.outcome).toBe("invalid_input");

      const res2 = await recordDepositAndRequestRelease(
        { ghlOpportunityId: "opp-1", depositCents: 5000, depositRef: "   " },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );
      expect(res2.outcome).toBe("invalid_input");
    });

    it("records deposit early while order is still designing and sends NO event", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      // Saga does not exist yet (early deposit D8)
      const res = await recordDepositAndRequestRelease(
        { ghlOpportunityId: "opp-early", depositCents: 100000, depositRef: "QBO-DEP-101" },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ outcome: "recorded_early" });
      expect(sendFn).not.toHaveBeenCalled();

      const createdSaga = fakeSagas.get("opp-early");
      expect(createdSaga).toBeDefined();
      expect(createdSaga.status).toBe("PENDING");
      expect(createdSaga.current_step).toBe("deposit_received_early");
    });

    it("triggers release when deposit arrives for saga at AWAITING_DEPOSIT", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      fakeSagas.set("opp-ready", {
        status: "AWAITING_DEPOSIT",
        releaseRequestedAt: null,
      });

      const res = await recordDepositAndRequestRelease(
        { ghlOpportunityId: "opp-ready", depositCents: 250000, depositRef: "QBO-DEP-202" },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ outcome: "released", attempt: 1 });
      expect(sendFn).toHaveBeenCalledTimes(1);
      expect(hoisted.inngestSends[0].name).toBe("path-a/release-to-production");
      expect(hoisted.inngestSends[0].data.triggerSource).toBe("customer_deposit");
      expect(hoisted.inngestSends[0].data.depositRef).toBe("QBO-DEP-202");
    });

    it("records deposit post-completion without emitting new release event", async () => {
      const { releaseStore, sagaStore, db, sendFn } = createMockStores();
      fakeSagas.set("opp-done", {
        status: "COMPLETED",
        releaseRequestedAt: new Date(),
      });

      const res = await recordDepositAndRequestRelease(
        { ghlOpportunityId: "opp-done", depositCents: 50000, depositRef: "QBO-DEP-303" },
        { releaseStore, sagaStore, db, inngestSend: sendFn },
      );

      expect(res).toEqual({ outcome: "recorded_post_completion" });
      expect(sendFn).not.toHaveBeenCalled();
    });
  });
});
