import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPathAReleaseSaga } from "@/inngest/path-a-release";

describe("Path A Release Saga (Function 2: Task 7)", () => {
  let fakeSaga: any;
  let fakeItems: any[];
  let fakeReleaseGate: Map<string, string>;
  let fakeSkuMappings: Map<string, number>;
  let stepRuns: string[];
  let sentEvents: any[];
  let katanaCalls: { path: string; method?: string; body?: any }[];

  beforeEach(() => {
    stepRuns = [];
    sentEvents = [];
    katanaCalls = [];
    fakeReleaseGate = new Map();
    fakeSkuMappings = new Map();

    fakeSaga = {
      status: "AWAITING_DEPOSIT",
      release_requested_at: new Date(),
      release_requested_by: "manager@ccpatio.com",
      release_requested_source: "management_override",
    };

    fakeItems = [
      {
        id: "item-1",
        job_id: "job-1",
        global_sku: "JOB-A-SOFA",
        status: "finalized",
        quantity: 1,
        finalized_dossier_hash: "hash-item-a",
        katana_sales_order_row_id: null,
        katana_mo_id: null,
      },
      {
        id: "item-2",
        job_id: "job-1",
        global_sku: "JOB-B-CHAIR",
        status: "finalized",
        quantity: 2,
        finalized_dossier_hash: "hash-item-b",
        katana_sales_order_row_id: null,
        katana_mo_id: null,
      },
    ];

    fakeReleaseGate.set("JOB-A-SOFA", "hash-item-a");
    fakeReleaseGate.set("JOB-B-CHAIR", "hash-item-b");
    fakeSkuMappings.set("JOB-A-SOFA", 101);
    fakeSkuMappings.set("JOB-B-CHAIR", 102);
  });

  function createMockStep() {
    return {
      run: vi.fn(async (id: string, fn: () => Promise<any>) => {
        stepRuns.push(id);
        return fn();
      }),
      sendEvent: vi.fn(async (id: string, event: any) => {
        stepRuns.push(id);
        sentEvents.push(event);
      }),
    };
  }

  function createMockDeps(overrides: Record<string, any> = {}) {
    const mockReleaseStore: any = {
      getSaga: vi.fn(async () => fakeSaga),
      claimRelease: vi.fn(async () => ({ outcome: "claimed" })),
      markSagaCompleted: vi.fn(async () => ({ completed: true })),
      markSagaManual: vi.fn(async () => {}),
    };

    const mockItemStore: any = {
      listItemsForOpportunity: vi.fn(async () => fakeItems),
      markItemReleased: vi.fn(async () => {}),
    };

    const mockSagaStore: any = {
      setStep: vi.fn(async () => {}),
    };

    let gateCount = 0;
    let variantCount = 0;

    const mockDb: any = {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => {
              const tableName =
                table?.[Symbol.for("drizzle:Name")] ||
                table?._?.name ||
                table?.name;
              if (tableName === "factory_release_gate") {
                gateCount++;
                const hash = gateCount % 2 === 1 ? "hash-item-a" : "hash-item-b";
                return [{ dossierHash: hash }];
              }
              if (tableName === "sku_mappings") {
                variantCount++;
                const vId = variantCount % 2 === 1 ? 101 : 102;
                return [{ variantId: vId }];
              }
              if (tableName === "channel_sync") {
                return [];
              }
              if (tableName === "order_intake") {
                return [{ contactName: "Alice Smith", contactEmail: "alice@example.com" }];
              }
              return [];
            },
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
    };

    return {
      releaseStore: mockReleaseStore,
      itemStore: mockItemStore,
      sagaStore: mockSagaStore,
      db: mockDb,
      getOrderMode: () => "live" as const,
      getCatalogMode: () => "live" as const,
      findSalesOrder: vi.fn(async () => null),
      createSalesOrder: vi.fn(async (payload: any) => ({
        salesOrderId: 7001,
        customerId: 501,
        salesOrderRowIds: [9001, 9002],
        salesOrderRows: [
          { id: 9001, variant_id: 101, sku: "JOB-A-SOFA" },
          { id: 9002, variant_id: 102, sku: "JOB-B-CHAIR" },
        ],
      })),
      createMos: vi.fn(async (rowIds: number[]) =>
        rowIds.map((r) => ({
          salesOrderRowId: r,
          manufacturingOrderId: r === 9001 ? 8001 : 8002,
        })),
      ),
      syncBom: vi.fn(async () => ({ ok: true })),
      ensureVariant: vi.fn(async () => 101),
      fetchKatana: vi.fn(async (path: string, opts?: any) => {
        katanaCalls.push({ path, method: opts?.method, body: opts?.body });
        if (path.includes("/manufacturing_orders?sales_order_id=")) {
          return { data: [] };
        }
        return { data: { id: 8001 } };
      }),
      ...overrides,
    };
  }

  it("skips execution if no release request was recorded in saga (D7)", async () => {
    fakeSaga.release_requested_at = null;
    const step = createMockStep();
    const deps = createMockDeps();

    const res = await runPathAReleaseSaga({
      event: { data: { ghlOpportunityId: "opp-unauth" } },
      step,
      deps,
    });

    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("no_recorded_request");
    expect(deps.createSalesOrder).not.toHaveBeenCalled();
  });

  it("performs dry-run when order pipeline mode is not live (D9)", async () => {
    const step = createMockStep();
    const deps = createMockDeps({
      getOrderMode: () => "log",
    });

    const res = await runPathAReleaseSaga({
      event: { data: { ghlOpportunityId: "opp-dry", triggerSource: "management_override" } },
      step,
      deps,
    });

    expect(res.dryRun).toBe(true);
    expect(stepRuns).toContain("record-dry-run");
    expect(deps.createSalesOrder).not.toHaveBeenCalled();
    expect(deps.releaseStore.claimRelease).not.toHaveBeenCalled();
  });

  it("fails closed on recipe hash mismatch before any Katana call (3.6.3)", async () => {
    // Corrupt gate hash
    fakeReleaseGate.set("JOB-A-SOFA", "mismatched-hash");

    const step = createMockStep();
    const mockDb: any = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ dossierHash: "mismatched-hash" }],
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    };

    const deps = createMockDeps({ db: mockDb });

    await expect(
      runPathAReleaseSaga({
        event: { data: { ghlOpportunityId: "opp-mismatch" } },
        step,
        deps,
      }),
    ).rejects.toThrow(/Recipe hash mismatch for JOB-A-SOFA/);

    expect(deps.releaseStore.markSagaManual).toHaveBeenCalled();
    expect(deps.createSalesOrder).not.toHaveBeenCalled();
  });

  it("fails closed on foreign sales order provenance check", async () => {
    const step = createMockStep();
    const foreignSO = {
      id: 6001,
      order_no: "PA-opp-foreign",
      additional_info: "created manually by operator without tag",
      sales_order_rows: [{ id: 1, variant_id: 101 }],
    };

    const deps = createMockDeps({
      findSalesOrder: vi.fn(async () => foreignSO as any),
    });

    await expect(
      runPathAReleaseSaga({
        event: { data: { ghlOpportunityId: "opp-foreign" } },
        step,
        deps,
      }),
    ).rejects.toThrow(/lacks provenance tag/);

    expect(deps.createSalesOrder).not.toHaveBeenCalled();
  });

  it("successfully completes full release flow with deterministic multi-SKU SO and stamped MOs", async () => {
    const step = createMockStep();
    const deps = createMockDeps();

    const res = await runPathAReleaseSaga({
      event: { data: { ghlOpportunityId: "opp-success", triggerSource: "customer_deposit" } },
      step,
      deps,
    });

    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(res.katanaSalesOrderId).toBe(7001);
    expect(res.manufacturingOrderIds).toEqual([8001, 8002]);

    // Verify 1 sales order created with both items sorted
    expect(deps.createSalesOrder).toHaveBeenCalledTimes(1);
    const soPayload = deps.createSalesOrder.mock.calls[0][0];
    expect(soPayload.additionalInfo).toContain("path_a_saga=opp-success");
    expect(soPayload.salesOrderRows).toHaveLength(2);
    expect(soPayload.salesOrderRows[0].sku).toBe("JOB-A-SOFA");
    expect(soPayload.salesOrderRows[1].sku).toBe("JOB-B-CHAIR");

    // Verify 2 MOs created
    expect(deps.createMos).toHaveBeenCalled();

    // Verify MO stamping calls occurred
    const patchCalls = katanaCalls.filter((c) => c.method === "PATCH");
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0].body.additional_info).toContain("custom_build=1");
    expect(patchCalls[0].body.additional_info).toContain("Cut card:");

    // Verify saga completed
    expect(deps.releaseStore.markSagaCompleted).toHaveBeenCalledWith("opp-success");

    // Verify events sent
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[0].name).toBe("path-a/release.completed");
    expect(sentEvents[1].name).toBe("path-a/ghl.sync.requested");
  });
});
