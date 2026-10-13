import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { runCadConvertHandoff } from "@/inngest/cad-handoff";

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

  function createMockDb(auditRow: any = null) {
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
    };
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
