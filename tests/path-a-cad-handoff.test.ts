import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { runCadConvertHandoff } from "@/inngest/cad-handoff";
import type { ReleaseDb } from "@/server/path-a/release-store";

describe("Path A CAD Handoff (runCadConvertHandoff)", () => {
  const dummyBuffer = Buffer.from("model-glb-binary-data");
  const dummySha256 = crypto.createHash("sha256").update(dummyBuffer).digest("hex");

  function createMockStep(waitForEventResult: any = null) {
    const executedSteps: string[] = [];
    return {
      executedSteps,
      run: vi.fn(async (id: string, fn: () => Promise<any>) => {
        executedSteps.push(id);
        return fn();
      }),
      waitForEvent: vi.fn(async (id: string, opts: any) => {
        executedSteps.push(id);
        return waitForEventResult;
      }),
    };
  }

  function createMockDb(auditRow: any = null): ReleaseDb {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (auditRow ? [auditRow] : []),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
    } as unknown as ReleaseDb;
  }

  const baseData = {
    uploadId: "upl-blend-1",
    globalSku: "JOB-TEST-123",
    storagePath: "raw/test.blend",
    ext: "blend" as const,
  };

  it("handles successful conversion flow with SHA-256 verification", async () => {
    const step = createMockStep({
      data: {
        status: "succeeded",
        resultSha256: dummySha256,
      },
    });

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;

    const res = await runCadConvertHandoff({
      step,
      data: baseData,
      deps: {
        downloadCadObject: async () => dummyBuffer,
        createCadSignedUpload: async () => ({
          path: "converted/target.glb",
          token: "tok",
          signedUrl: "https://storage.local/target.glb",
        }),
        fetch: mockFetch,
        getAppUrl: () => "https://app.ccpatio.com",
        getConvertUrl: () => "http://converter.local",
        getConvertToken: () => "sec-tok",
        db: createMockDb(),
      },
    });

    expect(res).toEqual({
      ok: true,
      glbStoragePath: "converted/target.glb",
    });
    expect(step.executedSteps).toContain("dispatch-convert");
    expect(step.executedSteps).toContain("wait-cad-callback");
    expect(step.executedSteps).toContain("verify-converted-glb");
  });

  it("handles converter failure callback gracefully", async () => {
    const step = createMockStep({
      data: {
        status: "failed",
        errorCode: "OOM_CRASH",
        errorMessage: "Memory exhausted in blender",
      },
    });

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;

    const res = await runCadConvertHandoff({
      step,
      data: baseData,
      deps: {
        downloadCadObject: async () => dummyBuffer,
        createCadSignedUpload: async () => ({
          path: "converted/target.glb",
          token: "tok",
          signedUrl: "https://storage.local/target.glb",
        }),
        fetch: mockFetch,
        getAppUrl: () => "https://app.ccpatio.com",
        getConvertUrl: () => "http://converter.local",
        getConvertToken: () => "sec-tok",
        db: createMockDb(),
      },
    });

    expect(res).toEqual({
      ok: false,
      error: "OOM_CRASH: Memory exhausted in blender",
    });
    expect(step.executedSteps).toContain("mark-failed-callback");
  });

  it("throws NonRetriableError on SHA-256 mismatch", async () => {
    const step = createMockStep({
      data: {
        status: "succeeded",
        resultSha256: "wrong-hash-00000000000000000000000000000000000000000000000000000000",
      },
    });

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;

    await expect(
      runCadConvertHandoff({
        step,
        data: baseData,
        deps: {
          downloadCadObject: async () => dummyBuffer,
          createCadSignedUpload: async () => ({
            path: "converted/target.glb",
            token: "tok",
            signedUrl: "https://storage.local/target.glb",
          }),
          fetch: mockFetch,
          getAppUrl: () => "https://app.ccpatio.com",
          getConvertUrl: () => "http://converter.local",
          getConvertToken: () => "sec-tok",
          db: createMockDb(),
        },
      }),
    ).rejects.toThrow("SHA256_MISMATCH");
  });

  it("throws CONVERT_TIMEOUT if callback times out and no reconciliation row exists", async () => {
    const step = createMockStep(null); // callback timed out

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;

    await expect(
      runCadConvertHandoff({
        step,
        data: baseData,
        deps: {
          downloadCadObject: async () => dummyBuffer,
          createCadSignedUpload: async () => ({
            path: "converted/target.glb",
            token: "tok",
            signedUrl: "https://storage.local/target.glb",
          }),
          fetch: mockFetch,
          getAppUrl: () => "https://app.ccpatio.com",
          getConvertUrl: () => "http://converter.local",
          getConvertToken: () => "sec-tok",
          db: createMockDb(null), // no audit row
        },
      }),
    ).rejects.toThrow("CONVERT_TIMEOUT");
  });

  it("recovers from timeout if reconciliation audit row is found", async () => {
    const step = createMockStep(null); // callback event arrived before wait registered

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ accepted: true }),
    })) as unknown as typeof fetch;

    const res = await runCadConvertHandoff({
      step,
      data: baseData,
      deps: {
        downloadCadObject: async () => dummyBuffer,
        createCadSignedUpload: async () => ({
          path: "converted/target.glb",
          token: "tok",
          signedUrl: "https://storage.local/target.glb",
        }),
        fetch: mockFetch,
        getAppUrl: () => "https://app.ccpatio.com",
        getConvertUrl: () => "http://converter.local",
        getConvertToken: () => "sec-tok",
        db: createMockDb({
          id: "aud-1",
          payload: {
            status: "succeeded",
            resultSha256: dummySha256,
          },
        }),
      },
    });

    expect(res).toEqual({
      ok: true,
      glbStoragePath: "converted/target.glb",
    });
    expect(step.executedSteps).toContain("reconcile-callback");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Phase 11 remediation -- QCA M4 (re-uploads of ANY extension are guarded) and m3 (no host fallback).
 * ---------------------------------------------------------------------------------------------- */
import { NonRetriableError } from "inngest";
import { runCadIntake } from "@/inngest/cad-handoff";
import { createFakeDb, type FakeTables } from "./helpers/path-a-fake-db";

describe("M4: runCadIntake guards and records EVERY CAD extension, not just .blend", () => {
  const OPP = "opp-cad-1";

  function world(sagaStatus: string | null, opts: { requested?: boolean; itemStatus?: string } = {}) {
    const tables: FakeTables = {
      sku_mappings: [
        { global_sku: "JOB-CAD-1", attributes: { custom_build: true, job_id: "job-1" } },
        { global_sku: "FIN-CATALOG-1", attributes: {} },
      ],
      custom_build_jobs: [{ id: "job-1", ghl_opportunity_id: OPP }],
    };
    const { db } = createFakeDb(tables);
    const calls: string[] = [];
    const itemStore = {
      findItemBySku: vi.fn(async () =>
        opts.itemStatus ? { global_sku: "JOB-CAD-1", design_status: opts.itemStatus } : null,
      ),
      ensureItem: vi.fn(async () => {
        calls.push("ensureItem");
        return {};
      }),
      setItemStatus: vi.fn(async () => {
        calls.push("setItemStatus");
        return { updated: true };
      }),
    };
    const releaseStore = {
      getSaga: vi.fn(async () =>
        sagaStatus
          ? { status: sagaStatus, release_requested_at: opts.requested ? new Date() : null }
          : null,
      ),
      revertToDesigning: vi.fn(async () => {
        calls.push("revertToDesigning");
        return { reverted: true };
      }),
    };
    const sagaStore = {
      insertOnce: vi.fn(async () => {
        calls.push("insertOnce");
      }),
      setStep: vi.fn(async () => {
        calls.push("setStep");
      }),
    };
    const step = {
      run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    };
    const deps = { db, itemStore, releaseStore, sagaStore } as never;
    return { step, deps, itemStore, releaseStore, sagaStore, calls };
  }

  const data = (ext: "blend" | "glb" | "dae" | "skp") => ({
    uploadId: `upl-${ext}`,
    globalSku: "JOB-CAD-1",
    storagePath: `raw/x.${ext}`,
    ext,
  });

  it.each(["blend", "glb", "dae", "skp"] as const)(
    "%s upload on a job-bound SKU creates the saga + item and returns the opportunity",
    async (ext) => {
      const w = world(null);
      const res = await runCadIntake({ step: w.step, data: data(ext), deps: w.deps });
      expect(res).toEqual({ opportunityId: OPP });
      expect(w.sagaStore.insertOnce).toHaveBeenCalledTimes(1);
      expect(w.itemStore.ensureItem).toHaveBeenCalledTimes(1);
      expect(w.sagaStore.setStep).toHaveBeenCalledWith("path_a_cad", OPP, "cad_dispatched");
      expect(w.step.run.mock.calls[0][0]).toBe("cad-intake");
    },
  );

  it.each(["glb", "dae", "skp"] as const)(
    "%s re-upload after release started is rejected as a change order (no writes)",
    async (ext) => {
      for (const status of ["IN_PROGRESS", "COMPLETED"]) {
        const w = world(status, { requested: true });
        await expect(runCadIntake({ step: w.step, data: data(ext), deps: w.deps })).rejects.toBeInstanceOf(
          NonRetriableError,
        );
        await expect(runCadIntake({ step: w.step, data: data(ext), deps: w.deps })).rejects.toThrow(
          /change order/,
        );
        expect(w.itemStore.ensureItem).not.toHaveBeenCalled();
        expect(w.sagaStore.insertOnce).not.toHaveBeenCalled();
      }
    },
  );

  it("a manual-failed saga WITH a release request also rejects a re-upload", async () => {
    const w = world("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION", { requested: true });
    await expect(runCadIntake({ step: w.step, data: data("glb"), deps: w.deps })).rejects.toThrow(/change order/);
  });

  it("re-upload of a FINALIZED design while AWAITING_DEPOSIT reverts the saga and the item", async () => {
    const w = world("AWAITING_DEPOSIT", { itemStatus: "finalized" });
    await runCadIntake({ step: w.step, data: data("dae"), deps: w.deps });
    expect(w.releaseStore.revertToDesigning).toHaveBeenCalledWith(OPP, "cad_dispatched");
    expect(w.itemStore.setItemStatus).toHaveBeenCalledWith(
      expect.objectContaining({ from: "finalized", to: "awaiting_cad" }),
    );
  });

  it("a catalog SKU is untouched: no saga, no item, no opportunity", async () => {
    const w = world(null);
    const res = await runCadIntake({
      step: w.step,
      data: { ...data("glb"), globalSku: "FIN-CATALOG-1" },
      deps: w.deps,
    });
    expect(res).toEqual({ opportunityId: null });
    expect(w.sagaStore.insertOnce).not.toHaveBeenCalled();
    expect(w.itemStore.ensureItem).not.toHaveBeenCalled();
  });
});

describe("M4: processCadUpload runs the intake guard first for every extension", () => {
  it.each(["glb", "dae", "skp", "blend"])("%s: the first step is cad-intake", async (ext) => {
    const { processCadUpload } = await import("@/inngest/functions");
    const handler = (processCadUpload as unknown as { fn: (a: unknown) => Promise<unknown> }).fn;
    const ids: string[] = [];
    const step = {
      run: async (id: string) => {
        ids.push(id);
        throw new Error("STOP_EXECUTION");
      },
    };
    await expect(
      handler({ event: { data: { uploadId: "u", globalSku: "JOB-X", storagePath: "p", ext } }, step }),
    ).rejects.toThrow("STOP_EXECUTION");
    expect(ids[0]).toBe("cad-intake");
  });
});

describe("M4: runCadConvertHandoff no longer owns the item/saga bookkeeping (moved to runCadIntake)", () => {
  it("dispatch-convert does not create items or sagas for a job-bound SKU", async () => {
    const tables: FakeTables = {
      sku_mappings: [{ global_sku: "JOB-TEST-123", attributes: { custom_build: true, job_id: "job-1" } }],
      custom_build_jobs: [{ id: "job-1", ghl_opportunity_id: "opp-9" }],
    };
    const { db } = createFakeDb(tables);
    const itemStore = { ensureItem: vi.fn(), setItemStatus: vi.fn(), findItemBySku: vi.fn(async () => null) };
    const sagaStore = { insertOnce: vi.fn(), setStep: vi.fn() };
    const releaseStore = { getSaga: vi.fn(async () => null), revertToDesigning: vi.fn() };
    const step = {
      run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
      waitForEvent: vi.fn(async () => ({ data: { status: "failed", errorCode: "X", errorMessage: "y" } })),
    };
    await runCadConvertHandoff({
      step,
      data: { uploadId: "u", globalSku: "JOB-TEST-123", storagePath: "raw/t.blend", ext: "blend" },
      deps: {
        downloadCadObject: async () => Buffer.from("x"),
        createCadSignedUpload: async () => ({ path: "p", token: "t", signedUrl: "https://s.local/p" }),
        fetch: (async () => ({ ok: true, status: 202 })) as unknown as typeof fetch,
        getAppUrl: () => "https://app.example.test",
        getConvertUrl: () => "http://converter.local",
        getConvertToken: () => "tok",
        db: db as never,
        itemStore: itemStore as never,
        sagaStore: sagaStore as never,
        releaseStore: releaseStore as never,
      },
    });
    expect(itemStore.ensureItem).not.toHaveBeenCalled();
    expect(sagaStore.insertOnce).not.toHaveBeenCalled();
    expect(releaseStore.getSaga).not.toHaveBeenCalled();
  });
});

describe("m3: runCadConvertHandoff has no hard-coded host fallback", () => {
  const OLD_ENV = { ...process.env };
  it("an unconfigured callback host is a NonRetriableError before any network call", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const fetchSpy = vi.fn();
    const step = {
      run: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
      waitForEvent: vi.fn(),
    };
    await expect(
      runCadConvertHandoff({
        step,
        data: { uploadId: "u", globalSku: "FIN-X", storagePath: "raw/t.blend", ext: "blend" },
        deps: {
          downloadCadObject: async () => Buffer.from("x"),
          createCadSignedUpload: async () => ({ path: "p", token: "t", signedUrl: "https://s.local/p" }),
          fetch: fetchSpy as unknown as typeof fetch,
          getConvertUrl: () => "http://converter.local",
          getConvertToken: () => "tok",
          db: createFakeDb({ sku_mappings: [{ global_sku: "FIN-X", attributes: {} }] }).db as never,
        },
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env = { ...OLD_ENV };
  });
});
