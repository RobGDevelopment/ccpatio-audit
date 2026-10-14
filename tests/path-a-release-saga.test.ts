/**
 * Phase 11 Task 7 — Function 2 (stateless Katana release), QCA remediation suite.
 *
 * Every case is tagged with the QCA defect id it pins (B1..B5, M1..M5, m2..m4). Fixtures are typed
 * to `typeof custom_build_job_items.$inferSelect`, so a phantom column such as `status` is a
 * compile error here instead of a silently-passing fixture (the original B5 cover-up).
 *
 * Fake DB: tests/helpers/path-a-fake-db.ts (table-aware; no call-count parity tricks).
 * The step stub THROWS on waitForEvent / sleep / sleepUntil (M2 stateless proof, defect m4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetriableError, StepError } from "inngest";
import {
  runPathAReleaseSaga,
  type PathAReleaseDeps,
  type ReleaseDb,
  type ReleaseStep,
} from "@/inngest/path-a-release";
import { KatanaApiError, syncBOMToKatana } from "@/lib/katana";
import { PathAFenceError } from "@/server/path-a/katana-fence";
import { katanaOrderNo } from "@/server/sre/idempotency";
import { pathAGhlSyncEventId } from "@/server/path-a/events";
import type { custom_build_job_items } from "@/server/db/schema";
import { createFakeDb, type FakeTables } from "./helpers/path-a-fake-db";

type ItemRow = typeof custom_build_job_items.$inferSelect;

const OPP = "opp-m1";
const ORDER_NO = katanaOrderNo("path_a", OPP);
const SAVED_ENV = { ...process.env };

function makeItem(
  over: Partial<ItemRow> & Pick<ItemRow, "global_sku">,
): ItemRow {
  return {
    id: `item-${over.global_sku}`,
    job_id: "job-1",
    quantity: 1,
    design_status: "finalized",
    cad_upload_id: null,
    finalized_dossier_hash: `hash-${over.global_sku}`,
    finalized_at: null,
    finalized_by: null,
    katana_sales_order_row_id: null,
    katana_mo_id: null,
    released_at: null,
    created_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

const SKU_A = "JOB-A-SOFA";
const SKU_B = "JOB-B-CHAIR";

function baseTables(items: ItemRow[]): FakeTables {
  return {
    sku_mappings: [
      { global_sku: SKU_A, katana_variant_id: 101 },
      { global_sku: SKU_B, katana_variant_id: 102 },
    ],
    factory_release_gate: [
      { root_sku: SKU_A, dossier_hash: `hash-${SKU_A}` },
      { root_sku: SKU_B, dossier_hash: `hash-${SKU_B}` },
    ],
    channel_sync: [],
    order_intake: [
      {
        ghl_opportunity_id: OPP,
        contact_name: "Alice Smith",
        contact_email: "alice@example.com",
      },
    ],
    custom_build_jobs: [{ id: "job-1", ghl_opportunity_id: OPP }],
    custom_build_job_items: items as unknown as FakeTables[string],
  };
}

type World = ReturnType<typeof buildWorld>;

function buildWorld(opts: {
  items?: ItemRow[];
  existingSalesOrder?: Record<string, unknown> | null;
  existingMos?: Array<{ id: number; sales_order_row_id: number }>;
  claim?: { outcome: string };
  saga?: Record<string, unknown>;
  tables?: Partial<FakeTables>;
  deps?: Partial<PathAReleaseDeps>;
} = {}) {
  const items = opts.items ?? [
    makeItem({ global_sku: SKU_A, quantity: 1 }),
    makeItem({ global_sku: SKU_B, quantity: 2 }),
  ];
  const tables = { ...baseTables(items), ...(opts.tables ?? {}) } as FakeTables;
  const { db, updates } = createFakeDb(tables);
  const stepRuns: string[] = [];
  const sentEvents: Array<{ id: string; name: string; data: Record<string, unknown> }> = [];
  const katanaCalls: Array<{ path: string; method: string; body?: unknown }> = [];

  const saga = {
    status: "AWAITING_DEPOSIT",
    release_requested_at: new Date("2026-10-02T00:00:00Z"),
    release_source: "management_override",
    release_requested_by: "manager@example.test",
    ...(opts.saga ?? {}),
  };

  const releaseStore = {
    getSaga: vi.fn(async () => saga),
    claimRelease: vi.fn(async () => {
      saga.status = "IN_PROGRESS";
      return opts.claim ?? { outcome: "claimed" };
    }),
    markSagaCompleted: vi.fn(async () => {
      saga.status = "COMPLETED";
      return { completed: true };
    }),
    markSagaManual: vi.fn(async () => {
      saga.status = "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION";
      return undefined;
    }),
  };
  const itemStore = {
    listItemsForOpportunity: vi.fn(async () =>
      (tables.custom_build_job_items as unknown as ItemRow[]).map((r) => ({ ...r })),
    ),
    markItemReleased: vi.fn(
      async (input: { globalSku: string; soRowId: number; moId: number }) => {
        const row = (tables.custom_build_job_items as unknown as ItemRow[]).find(
          (r) => r.global_sku === input.globalSku,
        );
        if (row) {
          row.design_status = "released";
          row.katana_sales_order_row_id = input.soRowId;
          row.katana_mo_id = input.moId;
        }
        return row ?? null;
      },
    ),
  };
  const sagaStore = { setStep: vi.fn(async () => undefined) };

  const createSalesOrder = vi.fn(async (_payload: unknown) => ({
    salesOrderId: 7001,
    orderNo: ORDER_NO,
    customerId: 501,
    rowCount: 2,
    salesOrderRowIds: [9001, 9002],
    salesOrderRows: [
      { id: 9001, variant_id: 101, sku: SKU_A },
      { id: 9002, variant_id: 102, sku: SKU_B },
    ],
  }));
  const createMos = vi.fn(async (rowIds: number[]) =>
    rowIds.map((r) => ({
      salesOrderRowId: r,
      manufacturingOrderId: 8000 + (r % 1000),
      orderNo: `MO-${r}`,
      relatedManufacturingOrderIds: [],
    })),
  );
  const syncBom = vi.fn(
    async (
      _sku?: string,
      _options?: {
        allowEmpty?: boolean;
        idempotencyKey?: string;
        fromAirlock?: boolean;
        catalogMode?: "log" | "live";
        db?: unknown;
        katanaFetch?: unknown;
      },
    ) => ({
      ok: true as const,
      finishedGoodSku: SKU_A,
      productVariantId: 101,
      recipeRows: 1,
      operationRows: 0,
      nodesSynced: 1,
      dryRun: false,
      message: "OK",
    }),
  );
  const ensureVariant = vi.fn(async (sku: string) => ({
    ok: true as const,
    action: "unchanged" as const,
    sku,
    variantId: 101,
    message: "OK",
  }));
  const findSalesOrder = vi.fn(async () => opts.existingSalesOrder ?? null);
  const fetchKatana = vi.fn(async (path: string, o?: { method?: string; body?: unknown }) => {
    katanaCalls.push({ path, method: o?.method ?? "GET", body: o?.body });
    if (path.includes("/manufacturing_orders?sales_order_id=")) {
      return { data: opts.existingMos ?? [], status: 200, headers: new Headers() };
    }
    return { data: { id: 1 }, status: 200, headers: new Headers() };
  });

  const deps = {
    releaseStore,
    itemStore,
    sagaStore,
    db: db as unknown as ReleaseDb,
    getCatalogMode: () => "live" as const,
    findSalesOrder,
    createSalesOrder,
    createMos,
    syncBom,
    ensureVariant,
    fetchKatana,
    now: () => new Date("2026-10-13T12:00:00Z"),
    ...(opts.deps ?? {}),
  } as unknown as PathAReleaseDeps;

  function strictStep(overrides: {
    run?: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
  } = {}) {
    const forbid = (name: string) => () => {
      throw new Error(`FORBIDDEN: step.${name} is a wait primitive (M2 stateless)`);
    };
    return {
      run: vi.fn(async (id: string, fn: () => Promise<unknown>) => {
        stepRuns.push(id);
        return overrides.run ? overrides.run(id, fn) : fn();
      }),
      sendEvent: vi.fn(async (id: string, event: { id: string; name: string; data: Record<string, unknown> }) => {
        stepRuns.push(id);
        sentEvents.push(event);
      }),
      waitForEvent: forbid("waitForEvent"),
      sleep: forbid("sleep"),
      sleepUntil: forbid("sleepUntil"),
    };
  }

  const katanaWriteCount = () =>
    createSalesOrder.mock.calls.length +
    createMos.mock.calls.length +
    syncBom.mock.calls.length +
    ensureVariant.mock.calls.length +
    katanaCalls.filter((c) => c.method !== "GET").length;

  return {
    db: db as unknown as ReleaseDb,
    tables,
    updates,
    stepRuns,
    sentEvents,
    katanaCalls,
    saga,
    releaseStore,
    itemStore,
    sagaStore,
    createSalesOrder,
    createMos,
    syncBom,
    ensureVariant,
    findSalesOrder,
    fetchKatana,
    deps,
    strictStep,
    katanaWriteCount,
  };
}

function event(over: Record<string, unknown> = {}) {
  return {
    data: {
      ghlOpportunityId: OPP,
      source: "management_override",
      requestedBy: "manager@example.test",
      attempt: 1,
      ...over,
    },
  };
}

function run(w: World, ev: { data: Record<string, unknown> } = event(), step = w.strictStep()) {
  // The strict stub is untyped (returns unknown); cast it to the saga's minimal step contract.
  return runPathAReleaseSaga({ event: ev, step: step as unknown as ReleaseStep, deps: w.deps });
}

function ownOrder(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: 6001,
    order_no: ORDER_NO,
    additional_info: `path_a_saga=${OPP}`,
    sales_order_rows: [
      { id: 5001, variant_id: 101, quantity: 1 },
      { id: 5002, variant_id: 102, quantity: 2 },
    ],
    ...extra,
  };
}

beforeEach(() => {
  process.env.GHL_FACTORY_ORDERS = "live";
  process.env.ORDER_PIPELINE_MODE = "live";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
});

describe("B1: Function 2 is gated by GHL_FACTORY_ORDERS, never ORDER_PIPELINE_MODE", () => {
  it("ORDER_PIPELINE_MODE=live with GHL_FACTORY_ORDERS unset makes ZERO Katana calls (dry run)", async () => {
    delete process.env.GHL_FACTORY_ORDERS;
    process.env.ORDER_PIPELINE_MODE = "live";
    const w = buildWorld();

    const res = await run(w);

    expect(res.dryRun).toBe(true);
    expect(res.ghlFactoryMode).toBe("log");
    expect(w.katanaWriteCount()).toBe(0);
    expect(w.findSalesOrder).not.toHaveBeenCalled();
    expect(w.releaseStore.claimRelease).not.toHaveBeenCalled();
  });

  it.each([
    [" LIVE ", true],
    ["Live", true],
    ["live", true],
    ["garbage", false],
    ["", false],
    ["log", false],
    [undefined, false],
  ])("GHL_FACTORY_ORDERS=%j resolves live=%s even with ORDER_PIPELINE_MODE=live", async (raw, live) => {
    if (raw === undefined) delete process.env.GHL_FACTORY_ORDERS;
    else process.env.GHL_FACTORY_ORDERS = raw;
    process.env.ORDER_PIPELINE_MODE = "live";
    const w = buildWorld();

    const res = await run(w);

    expect(Boolean(res.dryRun)).toBe(!live);
    expect(w.createSalesOrder.mock.calls.length).toBe(live ? 1 : 0);
  });

  it("GHL_FACTORY_ORDERS=live with ORDER_PIPELINE_MODE=log still releases", async () => {
    process.env.GHL_FACTORY_ORDERS = "live";
    process.env.ORDER_PIPELINE_MODE = "log";
    const w = buildWorld();
    const res = await run(w);
    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(false);
    expect(w.createSalesOrder).toHaveBeenCalledTimes(1);
  });
});

describe("m2: the release event is validated with pathAReleaseEventSchema (no 'unknown' fallback)", () => {
  it("rejects a payload without a valid source before ANY Katana or DB-authority call", async () => {
    const w = buildWorld();
    await expect(
      run(w, { data: { ghlOpportunityId: OPP, attempt: 1 } }),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.releaseStore.getSaga).not.toHaveBeenCalled();
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("rejects customer_deposit without depositCents/depositRef", async () => {
    const w = buildWorld();
    await expect(
      run(w, event({ source: "customer_deposit" })),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("dry run records the validated source in current_step", async () => {
    process.env.GHL_FACTORY_ORDERS = "log";
    const w = buildWorld();
    await run(w, event({ source: "management_override" }));
    expect(w.sagaStore.setStep).toHaveBeenCalledWith(
      "path_a_cad",
      OPP,
      "release_dry_run:management_override",
    );
  });
});

describe("D7 / 3.6: forged or premature events are inert", () => {
  it("no recorded release request -> ignored, zero Katana calls", async () => {
    const w = buildWorld({ saga: { release_requested_at: null } });
    const res = await run(w);
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("no_recorded_request");
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("PENDING saga -> deferred, zero Katana calls", async () => {
    const w = buildWorld({ saga: { status: "PENDING" } });
    const res = await run(w);
    expect(res.reason).toBe("design_not_finalized");
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("COMPLETED saga -> duplicate, zero Katana calls", async () => {
    const w = buildWorld({ saga: { status: "COMPLETED" } });
    const res = await run(w);
    expect(res.ok).toBe(true);
    expect(res.reason).toBe("already_completed");
    expect(w.katanaWriteCount()).toBe(0);
  });

  it.each(["no_request", "not_ready", "no_saga", "already_completed"])(
    "claim outcome %s ends quietly with zero Katana calls",
    async (outcome) => {
      const w = buildWorld({ claim: { outcome } });
      const res = await run(w);
      expect(res.skipped).toBe(true);
      expect(w.katanaWriteCount()).toBe(0);
    },
  );
});

describe("3.6.3 / hash drift, catalog preflight, config preflight", () => {
  it("fails closed on recipe hash mismatch BEFORE any Katana call", async () => {
    const w = buildWorld({
      tables: {
        factory_release_gate: [
          { root_sku: SKU_A, dossier_hash: "drifted" },
          { root_sku: SKU_B, dossier_hash: `hash-${SKU_B}` },
        ],
      },
    });
    await expect(run(w)).rejects.toThrow(/Recipe hash mismatch for JOB-A-SOFA/);
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "recipe_hash_check",
      expect.any(Error),
    );
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("live order mode + catalog log + missing variant -> manual before any Katana call", async () => {
    const w = buildWorld({
      tables: { sku_mappings: [{ global_sku: SKU_A, katana_variant_id: null }, { global_sku: SKU_B, katana_variant_id: 102 }] },
    });
    (w.deps as { getCatalogMode?: () => string }).getCatalogMode = () => "log";
    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "catalog_mode_check",
      expect.any(Error),
    );
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("an item that is not finalized/released is a manual state before any Katana call", async () => {
    const w = buildWorld({
      items: [makeItem({ global_sku: SKU_A, design_status: "needs_review" }), makeItem({ global_sku: SKU_B })],
    });
    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.releaseStore.markSagaManual).toHaveBeenCalled();
    expect(w.katanaWriteCount()).toBe(0);
  });
});

describe("m3: no hard-coded host fallback", () => {
  it("missing NEXT_PUBLIC_APP_URL stops the release as manual BEFORE any Katana write", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const w = buildWorld();
    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "config_app_url",
      expect.any(Error),
    );
    expect(w.katanaWriteCount()).toBe(0);
  });

  it("the cut-card URL uses the configured host (never app.ccpatio.com)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.test";
    const w = buildWorld();
    await run(w);
    const stamps = w.katanaCalls.filter((c) => c.method === "PATCH");
    expect(stamps).toHaveLength(2);
    for (const s of stamps) {
      const info = String((s.body as { additional_info: string }).additional_info);
      expect(info).toContain("https://staging.example.test/factory/cut-cards/");
      expect(info).not.toContain("app.ccpatio.com");
    }
  });
});

describe("happy path: ONE Sales Order, one MO per item, stateless", () => {
  it("publishes per item, creates ONE SO with N sorted rows, one MO per row, completes the saga", async () => {
    const w = buildWorld();
    const res = await run(w);

    expect(res).toMatchObject({
      ok: true,
      dryRun: false,
      itemCount: 2,
      katanaSalesOrderId: 7001,
      orderNo: ORDER_NO,
    });
    expect(res.manufacturingOrderIds).toHaveLength(2);

    expect(w.ensureVariant.mock.calls.map((c) => c[0])).toEqual([SKU_A, SKU_B]);
    expect(w.syncBom).toHaveBeenCalledTimes(2);

    expect(w.createSalesOrder).toHaveBeenCalledTimes(1);
    const so = w.createSalesOrder.mock.calls[0][0] as {
      orderNo: string;
      additionalInfo: string;
      salesOrderRows: Array<{ sku: string; quantity: number; pricePerUnit: number }>;
    };
    expect(so.orderNo).toBe(ORDER_NO);
    expect(so.additionalInfo).toBe(`path_a_saga=${OPP}`);
    expect(so.salesOrderRows).toEqual([
      { sku: SKU_A, quantity: 1, pricePerUnit: 0 },
      { sku: SKU_B, quantity: 2, pricePerUnit: 0 },
    ]);

    expect(w.createMos.mock.calls.map((c) => c[0])).toEqual([[9001], [9002]]);
    expect(w.releaseStore.markSagaCompleted).toHaveBeenCalledWith(OPP);
    expect(w.sentEvents.map((e) => e.name)).toEqual([
      "path-a/release.completed",
      "path-a/ghl.sync.requested",
    ]);
  });

  it("scales to 1 and 5 items: always exactly one SO and one MO per row", async () => {
    for (const n of [1, 5]) {
      const skus = Array.from({ length: n }, (_, i) => `JOB-N${n}-ITEM-${i}`);
      const items = skus.map((s) => makeItem({ global_sku: s }));
      const rows = skus.map((s, i) => ({ id: 9100 + i, variant_id: 200 + i, sku: s }));
      const w = buildWorld({
        items,
        tables: {
          sku_mappings: skus.map((s, i) => ({ global_sku: s, katana_variant_id: 200 + i })),
          factory_release_gate: skus.map((s) => ({ root_sku: s, dossier_hash: `hash-${s}` })),
        },
      });
      w.createSalesOrder.mockImplementation(async () => ({
        salesOrderId: 7100 + n,
        orderNo: ORDER_NO,
        customerId: 1,
        rowCount: n,
        salesOrderRowIds: rows.map((r) => r.id),
        salesOrderRows: rows,
      }));
      const res = await run(w);
      expect(res.itemCount).toBe(n);
      expect(w.createSalesOrder).toHaveBeenCalledTimes(1);
      expect(w.createMos).toHaveBeenCalledTimes(n);
    }
  });

  it("uses a step stub that throws on waitForEvent/sleep/sleepUntil and still completes (M2)", async () => {
    const w = buildWorld();
    const step = w.strictStep();
    await expect(run(w, event(), step)).resolves.toMatchObject({ ok: true });
    expect(w.stepRuns.some((id) => /wait|sleep/i.test(id))).toBe(false);
  });

  it("never issues a Katana DELETE and never writes order_intake (F7)", async () => {
    const w = buildWorld();
    await run(w);
    expect(w.katanaCalls.map((c) => c.method)).not.toContain("DELETE");
    expect(w.updates.map((u) => u.table)).not.toContain("order_intake");
  });
});

describe("B5: design_status is the item status column (no phantom `status`)", () => {
  it("an already-released item is skipped: no variant ensure, no recipe publish, no MO create", async () => {
    const w = buildWorld({
      items: [
        makeItem({
          global_sku: SKU_A,
          design_status: "released",
          katana_sales_order_row_id: 5001,
          katana_mo_id: 8801,
        }),
        makeItem({ global_sku: SKU_B, quantity: 2 }),
      ],
      existingSalesOrder: ownOrder(),
    });

    const res = await run(w);

    expect(w.ensureVariant.mock.calls.map((c) => c[0])).toEqual([SKU_B]);
    expect(w.syncBom).toHaveBeenCalledTimes(1);
    expect(w.createMos.mock.calls.map((c) => c[0])).toEqual([[5002]]);
    expect(w.createSalesOrder).not.toHaveBeenCalled();
    // The released item's MO id is carried into the job's mo id list.
    expect(res.manufacturingOrderIds).toContain(8801);
    expect(res.manufacturingOrderIds).toHaveLength(2);
  });

  it("marks each item released through the item store with the mapped SO row and MO ids", async () => {
    const w = buildWorld();
    await run(w);
    expect(w.itemStore.markItemReleased).toHaveBeenCalledWith({
      globalSku: SKU_A,
      soRowId: 9001,
      moId: expect.any(Number),
    });
    expect(w.itemStore.markItemReleased).toHaveBeenCalledWith({
      globalSku: SKU_B,
      soRowId: 9002,
      moId: expect.any(Number),
    });
  });
});

describe("M1: Sales Order rows map back to items by VARIANT ID, never by position", () => {
  it("maps correctly when Katana returns rows in a different order", async () => {
    const w = buildWorld();
    w.createSalesOrder.mockImplementation(async () => ({
      salesOrderId: 7001,
      orderNo: ORDER_NO,
      customerId: 501,
      rowCount: 2,
      salesOrderRowIds: [9102, 9101],
      salesOrderRows: [
        { id: 9102, variant_id: 102, sku: SKU_B },
        { id: 9101, variant_id: 101, sku: SKU_A },
      ],
    }));
    await run(w);
    expect(w.createMos.mock.calls.map((c) => c[0])).toEqual([[9101], [9102]]);
  });

  it("a returned row set that cannot be matched by variant id is a hard NonRetriableError (no positional fallback)", async () => {
    const w = buildWorld();
    w.createSalesOrder.mockImplementation(async () => ({
      salesOrderId: 7001,
      orderNo: ORDER_NO,
      customerId: 501,
      rowCount: 2,
      salesOrderRowIds: [9001, 9002],
      // ids present, but no variant ids that match the items
      salesOrderRows: [
        { id: 9001, variant_id: 0, sku: "" },
        { id: 9002, variant_id: 0, sku: "" },
      ],
    }));

    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.createMos).not.toHaveBeenCalled();
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "sales_order",
      expect.any(Error),
    );
  });

  it("a missing salesOrderRows array with only salesOrderRowIds is also refused", async () => {
    const w = buildWorld();
    // Deliberately malformed: the real createKatanaSalesOrder always returns salesOrderRows.
    w.createSalesOrder.mockImplementation((async () => ({
      salesOrderId: 7001,
      orderNo: ORDER_NO,
      customerId: 501,
      rowCount: 2,
      salesOrderRowIds: [9001, 9002],
    })) as never);
    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.createMos).not.toHaveBeenCalled();
  });
});

describe("M2: foreign-order detection is exact (marker AND row set)", () => {
  async function expectForeign(existing: Record<string, unknown>) {
    const w = buildWorld({ existingSalesOrder: existing });
    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.createSalesOrder).not.toHaveBeenCalled();
    expect(w.createMos).not.toHaveBeenCalled();
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "sales_order_provenance",
      expect.any(Error),
    );
  }

  it("rejects an order with no marker", async () => {
    await expectForeign(ownOrder({ additional_info: "created manually by operator" }));
  });

  it("rejects a marker for a DIFFERENT opportunity whose id merely starts with ours (substring trap)", async () => {
    await expectForeign(ownOrder({ additional_info: `path_a_saga=${OPP}-extra` }));
  });

  it("rejects a marker embedded inside another token", async () => {
    await expectForeign(ownOrder({ additional_info: `xpath_a_saga=${OPP}` }));
  });

  it("rejects an order that carries two different Path A markers", async () => {
    await expectForeign(
      ownOrder({ additional_info: `path_a_saga=${OPP} path_a_saga=opp-other` }),
    );
  });

  it("rejects an order with EXTRA rows beyond the expected items (not merely a subset)", async () => {
    await expectForeign(
      ownOrder({
        sales_order_rows: [
          { id: 5001, variant_id: 101, quantity: 1 },
          { id: 5002, variant_id: 102, quantity: 2 },
          { id: 5003, variant_id: 103, quantity: 1 },
        ],
      }),
    );
  });

  it("rejects an order with a duplicated variant row", async () => {
    await expectForeign(
      ownOrder({
        sales_order_rows: [
          { id: 5001, variant_id: 101, quantity: 1 },
          { id: 5002, variant_id: 101, quantity: 1 },
        ],
      }),
    );
  });

  it("rejects an order whose row quantity differs from the item quantity", async () => {
    await expectForeign(
      ownOrder({
        sales_order_rows: [
          { id: 5001, variant_id: 101, quantity: 1 },
          { id: 5002, variant_id: 102, quantity: 7 },
        ],
      }),
    );
  });

  it("adopts an exactly-matching own order: zero SO create calls, MOs map to the existing rows", async () => {
    const w = buildWorld({ existingSalesOrder: ownOrder() });
    const res = await run(w);
    expect(res.ok).toBe(true);
    expect(w.createSalesOrder).not.toHaveBeenCalled();
    expect(w.createMos.mock.calls.map((c) => c[0])).toEqual([[5001], [5002]]);
    expect(res.katanaSalesOrderId).toBe(6001);
  });
});

describe("M3: the SO ids are persisted on BOTH the create and the resume/adopt path", () => {
  it("fresh create persists a NUMERIC sales order id, the order no and item row ids", async () => {
    const w = buildWorld();
    await run(w);
    const jobUpdate = w.updates.find(
      (u) => u.table === "custom_build_jobs" && "katana_sales_order_id" in u.values,
    );
    expect(jobUpdate?.values.katana_sales_order_id).toBe(7001);
    expect(typeof jobUpdate?.values.katana_sales_order_id).toBe("number");
    expect(jobUpdate?.values.katana_order_no).toBe(ORDER_NO);
  });

  it("adopting an existing own order (crash after SO create, before DB write) persists the ids", async () => {
    const w = buildWorld({ existingSalesOrder: ownOrder() });
    await run(w);

    const jobUpdate = w.updates.find(
      (u) => u.table === "custom_build_jobs" && "katana_sales_order_id" in u.values,
    );
    expect(jobUpdate?.values.katana_sales_order_id).toBe(6001);
    expect(jobUpdate?.values.katana_order_no).toBe(ORDER_NO);

    const rowIds = w.updates
      .filter((u) => u.table === "custom_build_job_items" && "katana_sales_order_row_id" in u.values)
      .map((u) => u.values.katana_sales_order_row_id);
    expect(rowIds).toEqual(expect.arrayContaining([5001, 5002]));
  });
});

describe("B4: Katana failures after the claim are manual + NonRetriable (never stuck IN_PROGRESS)", () => {
  type Inject = {
    name: string;
    leg: RegExp;
    arrange: (w: World) => void;
  };

  const terminal: Inject[] = [
    {
      name: "ensureVariant 422",
      leg: /^publish_recipe/,
      arrange: (w) =>
        w.ensureVariant.mockRejectedValueOnce(new KatanaApiError("bad variant", { status: 422 })),
    },
    {
      name: "syncBom throws 400",
      leg: /^publish_recipe/,
      arrange: (w) =>
        w.syncBom.mockRejectedValueOnce(new KatanaApiError("bad recipe", { status: 400 })),
    },
    {
      name: "syncBom returns ok:false",
      leg: /^publish_recipe/,
      arrange: (w) =>
        w.syncBom.mockResolvedValueOnce({ ok: false, error: "recipe rejected" } as never),
    },
    {
      name: "ensureVariant returns ok:false",
      leg: /^publish_recipe/,
      arrange: (w) =>
        w.ensureVariant.mockResolvedValueOnce({ ok: false, error: "SKU not found" } as never),
    },
    {
      name: "fence blocks",
      leg: /^publish_recipe/,
      arrange: (w) =>
        w.ensureVariant.mockRejectedValueOnce(new PathAFenceError("blocked")),
    },
    {
      name: "createSalesOrder 422",
      leg: /^sales_order$/,
      arrange: (w) =>
        w.createSalesOrder.mockRejectedValueOnce(new KatanaApiError("invalid order", { status: 422 })),
    },
    {
      name: "createSalesOrder 404",
      leg: /^sales_order$/,
      arrange: (w) =>
        w.createSalesOrder.mockRejectedValueOnce(new KatanaApiError("not found", { status: 404 })),
    },
    {
      name: "createMos 400",
      leg: /^mo:/,
      arrange: (w) =>
        w.createMos.mockRejectedValueOnce(new KatanaApiError("bad mo", { status: 400 })),
    },
  ];

  it.each(terminal)("$name -> markSagaManual(leg) then NonRetriableError", async ({ leg, arrange }) => {
    const w = buildWorld();
    arrange(w);

    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);

    expect(w.releaseStore.markSagaManual).toHaveBeenCalledTimes(1);
    const [oppArg, legArg] = w.releaseStore.markSagaManual.mock.calls[0] as unknown as [string, string];
    expect(oppArg).toBe(OPP);
    expect(legArg).toMatch(leg);
    expect(w.releaseStore.markSagaCompleted).not.toHaveBeenCalled();
    expect(w.katanaCalls.map((c) => c.method)).not.toContain("DELETE");
  });

  it.each([408, 409, 429, 500, 502, 503])(
    "Katana %s is transient: it propagates for Inngest to retry and does NOT mark the saga manual",
    async (status) => {
      const w = buildWorld();
      w.createSalesOrder.mockRejectedValueOnce(
        new KatanaApiError("transient", { status, rateLimitReset: 1 }),
      );
      const err = await run(w).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(NonRetriableError);
      expect(w.releaseStore.markSagaManual).not.toHaveBeenCalled();
    },
  );

  it("a Katana step that exhausts its retries (StepError) is marked manual and ends NonRetriable", async () => {
    const w = buildWorld();
    const step = w.strictStep({
      run: async (id, fn) => {
        if (id === "ensure-katana-sales-order") {
          throw new StepError(id, new Error("Katana 503 after 3 retries"));
        }
        return fn();
      },
    });

    await expect(run(w, event(), step)).rejects.toBeInstanceOf(NonRetriableError);
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      "sales_order",
      expect.any(Error),
    );
  });

  it("the manual state is resumable: a later run with claim=resumed completes from the first missing object", async () => {
    const w = buildWorld({ claim: { outcome: "resumed" }, existingSalesOrder: ownOrder() });
    const res = await run(w);
    expect(res.ok).toBe(true);
    expect(w.createSalesOrder).not.toHaveBeenCalled();
    expect(w.releaseStore.markSagaCompleted).toHaveBeenCalledWith(OPP);
  });

  it("MO retry creates no duplicate: an existing MO for the row is reused and still stamped", async () => {
    const w = buildWorld({
      existingSalesOrder: ownOrder(),
      existingMos: [{ id: 8801, sales_order_row_id: 5001 }],
    });
    const res = await run(w);
    expect(w.createMos.mock.calls.map((c) => c[0])).toEqual([[5002]]);
    expect(res.manufacturingOrderIds).toContain(8801);
    expect(w.katanaCalls.filter((c) => c.method === "PATCH")).toHaveLength(2);
  });
});

describe("M9: the GHL sync event id follows the release attempt (never a constant)", () => {
  it.each([1, 3])("attempt %i -> pathAGhlSyncEventId(opp, attempt)", async (attempt) => {
    const w = buildWorld();
    await run(w, event({ attempt }));
    const sync = w.sentEvents.find((e) => e.name === "path-a/ghl.sync.requested");
    expect(sync?.id).toBe(pathAGhlSyncEventId(OPP, attempt));
  });

  it("a retried release (attempt 2) emits a sync id distinct from the first release", async () => {
    const first = buildWorld();
    await run(first, event({ attempt: 1 }));
    const second = buildWorld();
    await run(second, event({ attempt: 2 }));
    const id = (w: World) => w.sentEvents.find((e) => e.name === "path-a/ghl.sync.requested")?.id;
    expect(id(first)).not.toBe(id(second));
  });
});

describe("D1: Zero Ghost Demand — isolating ORDER_PIPELINE_MODE=live from CATALOG_PUBLISH_MODE", () => {
  it("when ORDER_PIPELINE_MODE=live but CATALOG_PUBLISH_MODE is log/unset, Function 2 explicitly passes catalogMode: 'log'", async () => {
    process.env.ORDER_PIPELINE_MODE = "live";
    delete process.env.CATALOG_PUBLISH_MODE;

    const w = buildWorld({
      deps: {
        getCatalogMode: undefined, // reads getPathACatalogPublishMode() -> "log"
      },
    });

    let passedOptions: { catalogMode?: string } | undefined;
    w.syncBom.mockImplementationOnce(
      async (_sku?: string, options?: { catalogMode?: "log" | "live" }) => {
        passedOptions = options;
        return {
          ok: true,
          finishedGoodSku: SKU_A,
          productVariantId: 101,
          recipeRows: 1,
          operationRows: 0,
          nodesSynced: 1,
          dryRun: true,
          message: "Dry-run",
        };
      },
    );

    await expect(run(w)).rejects.toBeInstanceOf(NonRetriableError);

    // Verify Function 2 explicitly passed catalogMode: "log" to syncBomFn
    expect(passedOptions?.catalogMode).toBe("log");

    // Assert saga was marked manual on publish_recipe leg
    expect(w.releaseStore.markSagaManual).toHaveBeenCalledWith(
      OPP,
      `publish_recipe:${SKU_A}`,
      expect.objectContaining({
        message: expect.stringContaining("refusing to mint live orders against an unpublished recipe"),
      }),
    );
    // Crucial: ZERO live sales orders or MOs minted against unpublished recipe
    expect(w.createSalesOrder).not.toHaveBeenCalled();
    expect(w.createMos).not.toHaveBeenCalled();
    expect(w.releaseStore.markSagaCompleted).not.toHaveBeenCalled();
  });

  it("calling real syncBOMToKatana with ORDER_PIPELINE_MODE=live but passing catalogMode: 'log' executes 0 Katana calls and returns dryRun=true", async () => {
    process.env.ORDER_PIPELINE_MODE = "live";
    delete process.env.CATALOG_PUBLISH_MODE;

    const mockKatanaFetch = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const w = buildWorld({
      tables: {
        sku_mappings: [
          {
            global_sku: SKU_A,
            katana_variant_id: 101,
            attributes: { custom_build: true, job_id: "job-1" },
          },
        ],
        saga_runs: [
          {
            saga_type: "path_a_cad",
            correlation_key: OPP,
            status: "IN_PROGRESS",
            release_requested_at: new Date(),
          },
        ],
      },
    });

    const res = await syncBOMToKatana(SKU_A, {
      catalogMode: "log",
      allowEmpty: true,
      db: w.db,
      katanaFetch: mockKatanaFetch,
    });

    expect(mockKatanaFetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dryRun).toBe(true);
    }
    fetchSpy.mockRestore();
  });

  it("when CATALOG_PUBLISH_MODE=live, mode is live and recipe sync proceeds to SO/MO creation", async () => {
    process.env.ORDER_PIPELINE_MODE = "log";
    process.env.CATALOG_PUBLISH_MODE = "live";

    const w = buildWorld({
      deps: {
        getCatalogMode: undefined, // reads getPathACatalogPublishMode() -> "live"
      },
    });
    w.syncBom.mockResolvedValue({
      ok: true,
      finishedGoodSku: SKU_A,
      productVariantId: 101,
      recipeRows: 1,
      operationRows: 0,
      nodesSynced: 1,
      dryRun: false,
      message: "Live synced",
    });

    const res = await run(w);
    expect(res.ok).toBe(true);
    expect(res.catalogMode).toBe("live");
    expect(w.createSalesOrder).toHaveBeenCalledTimes(1);
    expect(w.createMos).toHaveBeenCalledTimes(2);
    expect(w.releaseStore.markSagaCompleted).toHaveBeenCalledWith(OPP);
  });
});

describe("D3: Protect COMPLETED sagas from post-completion step failures", () => {
  it("send-release-completed-event failure after saga completion raises NonRetriableError without altering COMPLETED status", async () => {
    const w = buildWorld();
    let completedEventThrown = false;
    const step = w.strictStep({
      run: async (id, fn) => fn(),
    });
    const originalSendEvent = step.sendEvent;
    step.sendEvent = vi.fn(async (id: string, ev: { id: string; name: string; data: Record<string, unknown> }) => {
      if (id === "send-release-completed-event") {
        completedEventThrown = true;
        throw new StepError(id, new Error("Inngest event bus timeout on release completed event"));
      }
      return originalSendEvent(id, ev);
    });

    await expect(run(w, event(), step)).rejects.toBeInstanceOf(NonRetriableError);

    expect(completedEventThrown).toBe(true);
    // markSagaCompleted was called
    expect(w.releaseStore.markSagaCompleted).toHaveBeenCalledWith(OPP);
    // Crucial: markSagaManual was NEVER called
    expect(w.releaseStore.markSagaManual).not.toHaveBeenCalled();
  });

  it("send-ghl-sync-event failure after saga completion raises NonRetriableError without altering COMPLETED status", async () => {
    const w = buildWorld();
    let ghlSyncEventThrown = false;
    const step = w.strictStep({
      run: async (id, fn) => fn(),
    });
    const originalSendEvent = step.sendEvent;
    step.sendEvent = vi.fn(async (id: string, ev: { id: string; name: string; data: Record<string, unknown> }) => {
      if (id === "send-ghl-sync-event") {
        ghlSyncEventThrown = true;
        throw new StepError(id, new Error("Inngest event bus timeout on ghl sync event"));
      }
      return originalSendEvent(id, ev);
    });

    await expect(run(w, event(), step)).rejects.toBeInstanceOf(NonRetriableError);

    expect(ghlSyncEventThrown).toBe(true);
    expect(w.releaseStore.markSagaCompleted).toHaveBeenCalledWith(OPP);
    expect(w.releaseStore.markSagaManual).not.toHaveBeenCalled();
  });
});

