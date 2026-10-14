import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  inngestSends: [] as any[],
  session: { email: "designer@ccpatio.com" } as { email: string } | null,
  itemRows: new Map<string, any>(),
  sagaRuns: new Map<string, any>(),
  releaseAttempts: new Map<string, number>(),
  /** The object handed to transaction callbacks; stores bound to it are "inside" the tx. */
  tx: { __tx: true } as Record<string, unknown>,
  txStarted: 0,
  bound: [] as Array<{ store: string; op: string; db: unknown }>,
  failAdvance: false,
  advanceError: null as Error | null,
  revalidate: vi.fn((_path: string) => undefined),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => hoisted.revalidate(p),
}));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    __base: true,
    // Faithful-enough transaction semantics for the Path A state this suite tracks:
    // snapshot, run, roll back on throw.
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      hoisted.txStarted += 1;
      const items = new Map(hoisted.itemRows);
      const sagas = new Map(hoisted.sagaRuns);
      try {
        return await cb(hoisted.tx);
      } catch (err) {
        hoisted.itemRows = items;
        hoisted.sagaRuns = sagas;
        throw err;
      }
    },
  }),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(async (payload: any) => {
      hoisted.inngestSends.push(payload);
      return { ids: ["msg-1"] };
    }),
    createFunction: vi.fn(() => ({})),
  },
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn(async () => hoisted.session),
  logPimAudit: vi.fn(async () => true),
}));

// Strictly mock Katana to throw on ANY invocation (Zero Katana writes in Finalize)
vi.mock("@/lib/katana", () => ({
  syncBOMToKatana: vi.fn(() => {
    throw new Error("FATAL: Katana called during finalize!");
  }),
  ensureKatanaVariantForSku: vi.fn(() => {
    throw new Error("FATAL: Katana variant created during finalize!");
  }),
}));

vi.mock("@/server/path-a/katana-fence", () => ({
  classifyCustomSku: vi.fn(async (sku: string) => {
    if (sku.startsWith("JOB-")) {
      return {
        type: "custom_job_bound",
        jobId: "job-123",
        opportunityId: "opp-123",
        isAdhoc: false,
      };
    }
    return { type: "not_custom" };
  }),
}));

vi.mock("@/server/factory-bom/finalize-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/factory-bom/finalize-design")>();
  return {
    ...actual,
    finalizeDesignCore: vi.fn(async (sku: string, actor: { email: string }) => {
      if (sku === "JOB-INVALID") {
        return { ok: false, error: "Airlock validation failed", blockingCodes: ["CHECKLIST"] };
      }
      return {
        ok: true,
        dossierHash: "dossier-sha-999",
        dossier: { rootSku: sku } as any,
        skuMap: new Map(),
      };
    }),
  };
});

vi.mock("@/server/path-a/item-store", () => ({
  createItemStore: (resolveDb?: () => unknown) => ({
    setItemStatus: vi.fn(async (input: any) => {
      hoisted.bound.push({ store: "item", op: "setItemStatus", db: resolveDb?.() });
      hoisted.itemRows.set(input.globalSku, {
        status: input.to,
        finalizedDossierHash: input.finalizedDossierHash,
        finalizedBy: input.finalizedBy,
        quantity: input.quantity,
      });
      return { updated: true, item: hoisted.itemRows.get(input.globalSku) };
    }),
  }),
}));

vi.mock("@/server/path-a/release-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/path-a/release-store")>();
  return {
    ...actual,
    createReleaseStore: (resolveDb?: () => unknown) => ({
      getSaga: vi.fn(async (oppId: string) => hoisted.sagaRuns.get(oppId) ?? null),
      advanceSaga: vi.fn(async (oppId: string) => {
        hoisted.bound.push({ store: "release", op: "advanceSaga", db: resolveDb?.() });
        if (hoisted.failAdvance) {
          throw new Error("advanceSaga crashed");
        }
        if (hoisted.advanceError) {
          throw hoisted.advanceError;
        }
        const saga = hoisted.sagaRuns.get(oppId) || { status: "AWAITING_DEPOSIT", releaseRequestedAt: null };
        return {
          moved: true,
          status: saga.status,
          step: "awaiting_deposit",
          releaseRequestedAt: saga.releaseRequestedAt ?? saga.release_requested_at ?? null,
        };
      }),
    bumpReleaseAttempt: vi.fn(async (oppId: string) => {
      const current = hoisted.releaseAttempts.get(oppId) || 0;
      hoisted.releaseAttempts.set(oppId, current + 1);
      return current + 1;
    }),
    revertToDesigning: vi.fn(async (oppId: string, step = "design_invalidated") => {
      const saga = hoisted.sagaRuns.get(oppId);
      if (saga && saga.status === "AWAITING_DEPOSIT") {
        saga.status = "PENDING";
        saga.step = step;
        return { reverted: true };
      }
      return { reverted: false };
    }),
  }),
};
});

import { finalizeDesignAction } from "@/app/admin/path-a/actions";
import { publishApprovedRecipeToKatana } from "@/app/admin/factory-bom/actions";
import {
  finalizeDesignCore,
  invalidateFinalization,
} from "@/server/factory-bom/finalize-design";
import { pathAReleaseEventSchema } from "@/server/path-a/events";
import { SagaDesignLockedError } from "@/server/path-a/release-store";

describe("Path A Finalize Design (Task 5)", () => {
  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.session = { email: "designer@ccpatio.com" };
    hoisted.itemRows = new Map();
    hoisted.sagaRuns = new Map();
    hoisted.releaseAttempts.clear();
    hoisted.txStarted = 0;
    hoisted.bound = [];
    hoisted.failAdvance = false;
    hoisted.advanceError = null;
    hoisted.revalidate = vi.fn((_path: string) => undefined);
    vi.mocked(finalizeDesignCore).mockClear();
  });

  it("publishApprovedRecipeToKatana refuses custom SKU with PATH_A_USE_FINALIZE", async () => {
    const res = await publishApprovedRecipeToKatana("JOB-100-TEST");
    expect(res).toEqual({
      ok: false,
      error: "PATH_A_USE_FINALIZE",
      message: "Custom orders must be finalized via Path A, not released directly to Katana.",
    });
  });

  it("finalizeDesignAction fails closed when not authenticated", async () => {
    hoisted.session = null;
    const res = await finalizeDesignAction({ globalSku: "JOB-100-TEST" });
    expect(res).toEqual({ ok: false, error: "not_authenticated" });
  });

  it("finalizeDesignAction refuses catalog SKUs", async () => {
    const res = await finalizeDesignAction({ globalSku: "CATALOG-SKU" });
    expect(res).toEqual({
      ok: false,
      error: "Only custom_job_bound SKUs can be finalized via Path A",
    });
  });

  it("finalizeDesignAction advances item to finalized, emits path-a/design.finalized, and makes zero Katana calls", async () => {
    hoisted.sagaRuns.set("opp-123", {
      status: "AWAITING_DEPOSIT",
      releaseRequestedAt: null,
    });

    const res = await finalizeDesignAction({
      globalSku: "JOB-100-TEST",
      quantity: 2,
    });

    expect(res.ok).toBe(true);
    expect(res.dossierHash).toBe("dossier-sha-999");

    const item = hoisted.itemRows.get("JOB-100-TEST");
    expect(item).toBeDefined();
    expect(item.status).toBe("finalized");
    expect(item.finalizedDossierHash).toBe("dossier-sha-999");
    expect(item.finalizedBy).toBe("designer@ccpatio.com");
    expect(item.quantity).toBe(2);

    expect(hoisted.inngestSends).toHaveLength(1);
    expect(hoisted.inngestSends[0].name).toBe("path-a/design.finalized");
    expect(hoisted.inngestSends[0].data.globalSku).toBe("JOB-100-TEST");
  });

  it("finalizeDesignAction triggers early deposit replay with the RECORDED request (schema-valid payload)", async () => {
    hoisted.sagaRuns.set("opp-123", {
      status: "AWAITING_DEPOSIT",
      releaseRequestedAt: new Date("2026-10-13T10:00:00Z"),
      release_requested_at: new Date("2026-10-13T10:00:00Z"),
      release_source: "customer_deposit",
      release_requested_by: "system:deposit",
      release_reason: null,
      deposit_cents: 250000,
      deposit_ref: "QBO-DEP-202",
    });

    const res = await finalizeDesignAction({
      globalSku: "JOB-100-TEST",
    });

    expect(res.ok).toBe(true);
    // Two events sent: path-a/design.finalized AND path-a/release-to-production (replay)
    expect(hoisted.inngestSends).toHaveLength(2);
    expect(hoisted.inngestSends[0].name).toBe("path-a/design.finalized");
    expect(hoisted.inngestSends[1].name).toBe("path-a/release-to-production");
    const data = hoisted.inngestSends[1].data;
    expect(data.triggerSource).toBeUndefined();
    expect(data).toMatchObject({
      source: "customer_deposit",
      requestedBy: "system:deposit",
      depositCents: 250000,
      depositRef: "QBO-DEP-202",
    });
    expect(pathAReleaseEventSchema.safeParse(data).success).toBe(true);
    expect(hoisted.inngestSends[1].id).toContain("replay:1");
  });

  it("invalidateFinalization reverts item to needs_review and saga to designing", async () => {
    hoisted.sagaRuns.set("opp-123", {
      status: "AWAITING_DEPOSIT",
      step: "awaiting_deposit",
    });

    await invalidateFinalization("JOB-100-TEST");

    const item = hoisted.itemRows.get("JOB-100-TEST");
    expect(item?.status).toBe("needs_review");

    const saga = hoisted.sagaRuns.get("opp-123");
    expect(saga?.status).toBe("PENDING");
    expect(saga?.step).toBe("design_invalidated");
  });
});

describe("M8: Finalize is one transaction and is refused once the saga is past the pause", () => {
  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.session = { email: "designer@ccpatio.com" };
    hoisted.itemRows = new Map();
    hoisted.sagaRuns = new Map();
    hoisted.releaseAttempts.clear();
    hoisted.txStarted = 0;
    hoisted.bound = [];
    hoisted.failAdvance = false;
    hoisted.revalidate = vi.fn((_path: string) => undefined);
    vi.mocked(finalizeDesignCore).mockClear();
    hoisted.sagaRuns.set("opp-123", { status: "AWAITING_DEPOSIT", releaseRequestedAt: null });
  });

  it("runs item finalize + saga advance inside ONE db.transaction, both stores bound to the tx", async () => {
    const res = await finalizeDesignAction({ globalSku: "JOB-100-TEST" });
    expect(res.ok).toBe(true);

    expect(hoisted.txStarted).toBe(1);
    const item = hoisted.bound.find((b) => b.op === "setItemStatus");
    const advance = hoisted.bound.find((b) => b.op === "advanceSaga");
    expect(item?.db).toBe(hoisted.tx);
    expect(advance?.db).toBe(hoisted.tx);
  });

  it("a crash in advanceSaga rolls the item back (never finalized-item + PENDING-saga) and emits NO events", async () => {
    hoisted.failAdvance = true;

    await expect(finalizeDesignAction({ globalSku: "JOB-100-TEST" })).rejects.toThrow("advanceSaga crashed");

    expect(hoisted.itemRows.get("JOB-100-TEST")).toBeUndefined();
    expect(hoisted.inngestSends).toHaveLength(0);
  });

  it.each(["IN_PROGRESS", "COMPLETED", "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"])(
    "refuses to finalize when the saga is %s (design is locked) and never touches the recipe",
    async (status) => {
      hoisted.sagaRuns.set("opp-123", {
        status,
        releaseRequestedAt: new Date(),
        release_requested_at: new Date(),
      });

      const res = await finalizeDesignAction({ globalSku: "JOB-100-TEST" });

      expect(res).toEqual({ ok: false, error: "design_locked_release_started" });
      expect(finalizeDesignCore).not.toHaveBeenCalled();
      expect(hoisted.txStarted).toBe(0);
      expect(hoisted.inngestSends).toHaveLength(0);
    },
  );

  it("still allows finalize while PENDING or AWAITING_DEPOSIT", async () => {
    for (const status of ["PENDING", "AWAITING_DEPOSIT"]) {
      hoisted.sagaRuns.set("opp-123", { status, releaseRequestedAt: null });
      const res = await finalizeDesignAction({ globalSku: "JOB-100-TEST" });
      expect(res.ok).toBe(true);
    }
  });

  it("when advanceSaga throws SagaDesignLockedError during transaction, finalizeDesignAction returns design_locked_release_started", async () => {
    hoisted.sagaRuns.set("opp-123", { status: "PENDING", releaseRequestedAt: null });
    hoisted.advanceError = new SagaDesignLockedError("opp-123", "IN_PROGRESS");
    const res = await finalizeDesignAction({ globalSku: "JOB-100-TEST" });
    expect(res).toEqual({ ok: false, error: "design_locked_release_started" });
  });
});

describe("m1: finalizeDesignAction does not swallow revalidatePath errors", () => {
  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.session = { email: "designer@ccpatio.com" };
    hoisted.itemRows = new Map();
    hoisted.sagaRuns = new Map();
    hoisted.releaseAttempts.clear();
    hoisted.txStarted = 0;
    hoisted.bound = [];
    hoisted.failAdvance = false;
    hoisted.advanceError = null;
    hoisted.sagaRuns.set("opp-123", { status: "AWAITING_DEPOSIT", releaseRequestedAt: null });
  });

  it("surfaces the error, but only after the events were sent", async () => {
    hoisted.revalidate = vi.fn(() => {
      throw new Error("revalidate boom");
    });
    await expect(finalizeDesignAction({ globalSku: "JOB-100-TEST" })).rejects.toThrow("revalidate boom");
    expect(hoisted.inngestSends.map((e) => e.name)).toContain("path-a/design.finalized");
  });
});
