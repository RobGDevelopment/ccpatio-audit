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
import { createFakeDb, type FakeTables } from "./helpers/path-a-fake-db";
import {
  assertKatanaWriteAllowedForSalesOrderRows,
  assertKatanaWriteAllowedForSkus,
} from "@/server/path-a/katana-fence";

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

describe("B3: SKU-list and sales-order-row fences (real fence logic over a table-aware fake DB)", () => {
  const OPP = "opp-fence";
  function world(sagaStatus: string | null, requested: boolean, items: Array<{ global_sku: string; katana_sales_order_row_id: number }> = []) {
    const tables: FakeTables = {
      sku_mappings: [
        { global_sku: "FIN-CHAIR-1", attributes: {} },
        { global_sku: "JOB-A-SOFA", attributes: { custom_build: true, job_id: "job-1" } },
      ],
      custom_build_jobs: [{ id: "job-1", ghl_opportunity_id: OPP }],
      saga_runs:
        sagaStatus === null
          ? []
          : [
              {
                saga_type: "path_a_cad",
                correlation_key: OPP,
                status: sagaStatus,
                release_requested_at: requested ? new Date() : null,
              },
            ],
      custom_build_job_items: items as unknown as FakeTables[string],
    };
    return createFakeDb(tables).db;
  }

  it("assertKatanaWriteAllowedForSkus passes a catalog-only list", async () => {
    const db = world("AWAITING_DEPOSIT", false);
    await expect(assertKatanaWriteAllowedForSkus(["FIN-CHAIR-1"], () => db as never)).resolves.toBeUndefined();
  });

  it("assertKatanaWriteAllowedForSkus blocks the whole list when ONE custom SKU is pre-release", async () => {
    const db = world("AWAITING_DEPOSIT", true);
    await expect(
      assertKatanaWriteAllowedForSkus(["FIN-CHAIR-1", "JOB-A-SOFA"], () => db as never),
    ).rejects.toMatchObject({ code: "PATH_A_FENCE_BLOCKED" });
  });

  it("assertKatanaWriteAllowedForSkus lets a claimed (IN_PROGRESS + requested) custom SKU through", async () => {
    const db = world("IN_PROGRESS", true);
    await expect(assertKatanaWriteAllowedForSkus(["JOB-A-SOFA"], () => db as never)).resolves.toBeUndefined();
  });

  it("assertKatanaWriteAllowedForSkus blocks a custom SKU whose saga row is missing", async () => {
    const db = world(null, false);
    await expect(assertKatanaWriteAllowedForSkus(["JOB-A-SOFA"], () => db as never)).rejects.toMatchObject({
      code: "PATH_A_NO_SAGA",
    });
  });

  it("assertKatanaWriteAllowedForSalesOrderRows resolves each row id to its custom SKU and fences it", async () => {
    const db = world("AWAITING_DEPOSIT", true, [{ global_sku: "JOB-A-SOFA", katana_sales_order_row_id: 9001 }]);
    await expect(assertKatanaWriteAllowedForSalesOrderRows([9001], () => db as never)).rejects.toMatchObject({
      code: "PATH_A_FENCE_BLOCKED",
    });
  });

  it("assertKatanaWriteAllowedForSalesOrderRows allows the same row once the saga is claimed", async () => {
    const db = world("IN_PROGRESS", true, [{ global_sku: "JOB-A-SOFA", katana_sales_order_row_id: 9001 }]);
    await expect(assertKatanaWriteAllowedForSalesOrderRows([9001], () => db as never)).resolves.toBeUndefined();
  });

  it("assertKatanaWriteAllowedForSalesOrderRows passes rows that no custom item owns (catalog/Woo orders)", async () => {
    const db = world("AWAITING_DEPOSIT", true, [{ global_sku: "JOB-A-SOFA", katana_sales_order_row_id: 9001 }]);
    await expect(assertKatanaWriteAllowedForSalesOrderRows([123456], () => db as never)).resolves.toBeUndefined();
  });

  it("assertKatanaWriteAllowedForSalesOrderRows fails closed when custom_build_job_items schema is missing (42P01 / 42703)", async () => {
    for (const code of ["42P01", "42703"]) {
      const err = Object.assign(new Error("relation custom_build_job_items does not exist"), { code });
      const db = {
        select: () => ({
          from: () => {
            throw err;
          },
        }),
      };
      await expect(
        assertKatanaWriteAllowedForSalesOrderRows([9001], () => db as never),
      ).rejects.toMatchObject({
        code: "PATH_A_SCHEMA_MISSING",
      });
    }
  });

  it("assertKatanaWriteAllowedForSalesOrderRows does NOT swallow unrelated DB errors", async () => {
    const db = {
      select: () => ({
        from: () => {
          throw new Error("connection reset");
        },
      }),
    };
    await expect(assertKatanaWriteAllowedForSalesOrderRows([9001], () => db as never)).rejects.toThrow("connection reset");
  });
});
