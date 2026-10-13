import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  inngestSends: [] as any[],
  session: { email: "designer@ccpatio.com" } as { email: string } | null,
  itemRows: new Map<string, any>(),
  sagaRuns: new Map<string, any>(),
  releaseAttempts: new Map<string, number>(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: vi.fn(async (payload: any) => {
      hoisted.inngestSends.push(payload);
      return { ids: ["msg-1"] };
    }),
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
  createItemStore: () => ({
    setItemStatus: vi.fn(async (input: any) => {
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

vi.mock("@/server/path-a/release-store", () => ({
  createReleaseStore: () => ({
    advanceSaga: vi.fn(async (oppId: string) => {
      const saga = hoisted.sagaRuns.get(oppId) || { status: "AWAITING_DEPOSIT", releaseRequestedAt: null };
      return {
        moved: true,
        status: saga.status,
        step: "awaiting_deposit",
        releaseRequestedAt: saga.releaseRequestedAt,
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
}));

import { finalizeDesignAction } from "@/app/admin/path-a/actions";
import { publishApprovedRecipeToKatana } from "@/app/admin/factory-bom/actions";
import { invalidateFinalization } from "@/server/factory-bom/finalize-design";

describe("Path A Finalize Design (Task 5)", () => {
  beforeEach(() => {
    hoisted.inngestSends = [];
    hoisted.session = { email: "designer@ccpatio.com" };
    hoisted.itemRows.clear();
    hoisted.sagaRuns.clear();
    hoisted.releaseAttempts.clear();
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

  it("finalizeDesignAction triggers early deposit replay if release was already requested", async () => {
    hoisted.sagaRuns.set("opp-123", {
      status: "AWAITING_DEPOSIT",
      releaseRequestedAt: new Date("2026-10-13T10:00:00Z"),
    });

    const res = await finalizeDesignAction({
      globalSku: "JOB-100-TEST",
    });

    expect(res.ok).toBe(true);
    // Two events sent: path-a/design.finalized AND path-a/release-to-production (replay)
    expect(hoisted.inngestSends).toHaveLength(2);
    expect(hoisted.inngestSends[0].name).toBe("path-a/design.finalized");
    expect(hoisted.inngestSends[1].name).toBe("path-a/release-to-production");
    expect(hoisted.inngestSends[1].data.triggerSource).toBe("early_deposit_replay");
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
