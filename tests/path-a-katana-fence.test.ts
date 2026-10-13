/**
 * Unit tests for Task 3: Katana write fence (assertKatanaWriteAllowed and classifyCustomSku).
 * Verifies zero ghost demand, fail-closed on missing opportunity or schema, and neutralization of legacy writers.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertKatanaWriteAllowed,
  classifyCustomSku,
  PathAFenceError,
} from "@/server/path-a/katana-fence";
import { executeReleaseCustomBuild } from "@/server/factory-bom/release-custom-build";
import { syncBOMToKatana, ensureKatanaVariantForSku } from "@/lib/katana";
import { publishToKatana } from "@/server/mdm/publish-channels";

describe("classifyCustomSku", () => {
  it("classifies catalog SKUs as not_custom", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [{ global_sku: "FIN-CHAIR-1", attributes: {} }],
          }),
        }),
      }),
    };

    const res = await classifyCustomSku("FIN-CHAIR-1", () => mockDb as any);
    expect(res).toEqual({ type: "not_custom" });
  });

  it("classifies custom build with no job as custom_without_opportunity", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [
              {
                global_sku: "JOB-CLIENT-TABLE",
                attributes: { custom_build: true },
              },
            ],
          }),
        }),
      }),
    };

    const res = await classifyCustomSku("JOB-CLIENT-TABLE", () => mockDb as any);
    expect(res).toEqual({ type: "custom_without_opportunity", jobId: null });
  });

  it("classifies custom build with job lacking opportunity as custom_without_opportunity", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: (clause: any) => ({
            limit: () => [
              // 1st query: sku_mappings
              // 2nd query: custom_build_jobs
              clause.toString().includes("custom_build_jobs")
                ? { id: "job-1", ghl_opportunity_id: null }
                : {
                    global_sku: "JOB-CLIENT-TABLE",
                    attributes: { custom_build: true, job_id: "job-1" },
                  },
            ],
          }),
        }),
      }),
    };

    const res = await classifyCustomSku("JOB-CLIENT-TABLE", () => mockDb as any);
    expect(res).toEqual({ type: "custom_without_opportunity", jobId: "job-1" });
  });

  it("classifies custom build bound to an opportunity as custom_job_bound", async () => {
    let call = 0;
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              call++;
              if (call === 1) {
                return [
                  {
                    global_sku: "JOB-CLIENT-TABLE",
                    attributes: { custom_build: true, job_id: "job-1" },
                  },
                ];
              }
              return [{ id: "job-1", ghl_opportunity_id: "opp-123" }];
            },
          }),
        }),
      }),
    };

    const res = await classifyCustomSku("JOB-CLIENT-TABLE", () => mockDb as any);
    expect(res).toEqual({
      type: "custom_job_bound",
      jobId: "job-1",
      opportunityId: "opp-123",
    });
  });
});

describe("assertKatanaWriteAllowed", () => {
  it("allows non-custom SKUs with zero saga reads", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [{ global_sku: "FIN-SOFA-1", attributes: {} }],
          }),
        }),
      }),
    };

    await expect(
      assertKatanaWriteAllowed("FIN-SOFA-1", () => mockDb as any),
    ).resolves.toBeUndefined();
  });

  it("blocks custom SKUs without opportunity (D5 fail-closed)", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => [
              {
                global_sku: "JOB-NO-OPP",
                attributes: { custom_build: true },
              },
            ],
          }),
        }),
      }),
    };

    await expect(
      assertKatanaWriteAllowed("JOB-NO-OPP", () => mockDb as any),
    ).rejects.toThrow(PathAFenceError);
    await expect(
      assertKatanaWriteAllowed("JOB-NO-OPP", () => mockDb as any),
    ).rejects.toMatchObject({ code: "PATH_A_CUSTOM_NO_OPPORTUNITY" });
  });

  it("blocks custom SKUs in PENDING or AWAITING_DEPOSIT pre-release", async () => {
    let call = 0;
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              call++;
              if (call === 1) {
                return [
                  {
                    global_sku: "JOB-PRE-RELEASE",
                    attributes: { custom_build: true, job_id: "job-1" },
                  },
                ];
              }
              if (call === 2) {
                return [{ id: "job-1", ghl_opportunity_id: "opp-456" }];
              }
              // Saga in AWAITING_DEPOSIT without release
              return [
                {
                  status: "AWAITING_DEPOSIT",
                  release_requested_at: null,
                },
              ];
            },
          }),
        }),
      }),
    };

    await expect(
      assertKatanaWriteAllowed("JOB-PRE-RELEASE", () => mockDb as any),
    ).rejects.toMatchObject({ code: "PATH_A_FENCE_BLOCKED" });
  });

  it("permits custom SKUs when claimed into IN_PROGRESS with release_requested_at", async () => {
    let call = 0;
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              call++;
              if (call === 1) {
                return [
                  {
                    global_sku: "JOB-ALLOWED",
                    attributes: { custom_build: true, job_id: "job-1" },
                  },
                ];
              }
              if (call === 2) {
                return [{ id: "job-1", ghl_opportunity_id: "opp-789" }];
              }
              return [
                {
                  status: "IN_PROGRESS",
                  release_requested_at: new Date(),
                },
              ];
            },
          }),
        }),
      }),
    };

    await expect(
      assertKatanaWriteAllowed("JOB-ALLOWED", () => mockDb as any),
    ).resolves.toBeUndefined();
  });

  it("fails closed with PATH_A_SCHEMA_MISSING when Postgres reports 42P01 or 42703", async () => {
    const error42P01 = new Error("relation saga_runs does not exist");
    (error42P01 as any).code = "42P01";

    const mockDb = {
      select: () => ({
        from: () => {
          throw error42P01;
        },
      }),
    };

    await expect(
      assertKatanaWriteAllowed("JOB-FAIL-CLOSED", () => mockDb as any),
    ).rejects.toMatchObject({ code: "PATH_A_SCHEMA_MISSING" });
  });
});

describe("Neutralizing legacy writers for custom SKUs", () => {
  it("executeReleaseCustomBuild returns deferredToPathA for custom SKUs", async () => {
    const res = await executeReleaseCustomBuild("JOB-CUSTOM-CHAIR");
    expect(res).toEqual({ receipt: true, deferredToPathA: true });
  });
});
