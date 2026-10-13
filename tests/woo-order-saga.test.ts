import { NonRetriableError, RetryAfterError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultWooSagaDeps,
  runWooOrderSaga,
  toWooSagaError,
  type WooSagaDeps,
  type WooSagaStep,
} from "@/inngest/woo-order";
import { KatanaApiError, katanaRateLimitStore } from "@/lib/katana";
import { katanaOrderNo } from "@/server/sre/idempotency";
import {
  assertNeverDeletePaid,
  isDeleteAction,
  planCompensation,
  type SagaStatusValue,
} from "@/server/sre/saga";
import type { SagaRunRow, SagaStore } from "@/server/sre/saga-store";
import { isOwnWooSalesOrder, type WooKatanaDeps } from "@/server/woocommerce/katana-deps";
import { runWooLedgerLeg } from "@/server/woocommerce/ledger-leg";

const VALID_SKU = "FIN-ACC-BAS-THU-JAN-16-2025-11";
const DELIVERY = "woo-delivery:d-1";

function wooOrder(lines = 2, overrides: Record<string, unknown> = {}) {
  return {
    id: 1042,
    number: "1042",
    status: "processing",
    currency: "USD",
    date_paid: "2026-10-13T12:00:00",
    _cc_delivery_key: DELIVERY,
    line_items: Array.from({ length: lines }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      product_id: 7,
      quantity: 1,
      sku: VALID_SKU,
      total: "100.00",
    })),
    ...overrides,
  };
}
const ORDER_NO = katanaOrderNo("woo", 1042, { number: "1042" });

type MemRow = Pick<SagaRunRow, "status" | "current_step" | "last_error"> & Record<string, unknown>;

function memStore(seed?: { status: SagaStatusValue; current_step?: string | null }) {
  const rows = new Map<string, MemRow>();
  const key = (t: string, c: string) => `${t}|${c}`;
  if (seed) {
    rows.set(key("path_b_woo", "1042"), {
      status: seed.status,
      current_step: seed.current_step ?? null,
      last_error: null,
    });
  }
  const store: SagaStore = {
    async insertOnce(input) {
      const k = key(input.sagaType, input.correlationKey);
      const existing = rows.get(k);
      if (existing) return { row: existing as unknown as SagaRunRow, inserted: false };
      const row: MemRow = {
        status: input.status ?? "IN_PROGRESS",
        current_step: input.currentStep ?? null,
        last_error: null,
        paid_at: input.paidAt ?? null,
      };
      rows.set(k, row);
      return { row: row as unknown as SagaRunRow, inserted: true };
    },
    async get(t, c) {
      return (rows.get(key(t, c)) as unknown as SagaRunRow) ?? null;
    },
    async setStep(t, c, step) {
      rows.get(key(t, c))!.current_step = step;
    },
    async setStatus(t, c, status, extra = {}) {
      const row = rows.get(key(t, c))!;
      row.status = status;
      if (extra.currentStep !== undefined) row.current_step = extra.currentStep;
      if (extra.lastError !== undefined) row.last_error = extra.lastError;
    },
    async fail(t, c, error, status = "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION") {
      const row = rows.get(key(t, c))!;
      row.status = status;
      row.last_error = error instanceof Error ? error.message : String(error);
    },
  };
  return { store, row: () => rows.get(key("path_b_woo", "1042")) };
}

function memoStep(): WooSagaStep & { ran: string[] } {
  const memo = new Map<string, unknown>();
  const ran: string[] = [];
  return {
    ran,
    run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(id)) return memo.get(id) as T;
      const result = await fn();
      memo.set(id, result);
      ran.push(id);
      return result;
    },
  };
}

function fakeKatana(opts: {
  existingSo?: Record<string, unknown> | null;
  existingSoRows?: number[];
} = {}) {
  const state = {
    created: [] as Array<Record<string, unknown>>,
    moByRow: new Map<number, number>(),
    soLookups: 0,
    moCreates: [] as number[],
    deferPolicies: [] as Array<string | undefined>,
    failMoOnceForRow: null as number | null,
    createSoError: null as Error | null,
    nextMo: 9000,
    so: null as Record<string, unknown> | null,
    soRows: [] as number[],
  };
  const deps: WooKatanaDeps = {
    async findSalesOrderByOrderNo() {
      state.deferPolicies.push(katanaRateLimitStore.getStore());
      state.soLookups += 1;
      return opts.existingSo ?? state.so;
    },
    async getSalesOrderRowIds() {
      return opts.existingSoRows ?? state.soRows;
    },
    async createSalesOrder(payload) {
      state.deferPolicies.push(katanaRateLimitStore.getStore());
      if (state.createSoError) throw state.createSoError;
      state.created.push(payload as unknown as Record<string, unknown>);
      state.soRows = payload.salesOrderRows.map((_, i) => 11 + i);
      // From now on Katana "has" this order: a lookup by order_no finds it.
      state.so = {
        id: 500,
        order_no: payload.orderNo,
        ecommerce_order_id: payload.ecommerceOrderId,
        ecommerce_order_type: payload.ecommerceOrderType,
      };
      return {
        salesOrderId: 500,
        orderNo: payload.orderNo,
        customerId: 1,
        rowCount: payload.salesOrderRows.length,
        salesOrderRowIds: state.soRows,
      };
    },
    async findMoIdForRow(_soId, rowId) {
      state.deferPolicies.push(katanaRateLimitStore.getStore());
      return state.moByRow.get(rowId) ?? null;
    },
    async createMoForRow(rowId) {
      state.deferPolicies.push(katanaRateLimitStore.getStore());
      if (state.failMoOnceForRow === rowId) {
        state.failMoOnceForRow = null;
        throw new KatanaApiError("Katana 503", { status: 503 });
      }
      state.nextMo += 1;
      state.moByRow.set(rowId, state.nextMo);
      state.moCreates.push(rowId);
      return state.nextMo;
    },
  };
  return { deps, state };
}

function makeDeps(opts: {
  store: SagaStore;
  katana: WooKatanaDeps;
  orderMode?: "log" | "approve" | "live";
  ledgerMode?: "log" | "live";
}) {
  const audit: Array<{ key: string; status: string; message?: string }> = [];
  const deps: WooSagaDeps = {
    store: opts.store,
    katana: opts.katana,
    updateAudit: async (key, status, message) => {
      audit.push({ key, status, message });
    },
    getModes: () => ({ orderMode: opts.orderMode ?? "log", ledgerMode: opts.ledgerMode ?? "log" }),
    now: () => new Date("2026-10-13T20:00:00Z"),
  };
  return { deps, audit };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Woo saga: mode gate (ORDER_PIPELINE_MODE)", () => {
  for (const orderMode of ["log", "approve"] as const) {
    it(`${orderMode}: dry run, ZERO Katana calls, saga PENDING/dry_run_logged, not COMPLETED`, async () => {
      const { store, row } = memStore();
      const k = fakeKatana();
      const { deps, audit } = makeDeps({ store, katana: k.deps, orderMode });

      const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });

      expect(result).toMatchObject({ ok: true, dryRun: true, pipelineMode: orderMode, orderNo: ORDER_NO });
      expect(k.state.soLookups).toBe(0);
      expect(k.state.created).toHaveLength(0);
      expect(k.state.moCreates).toHaveLength(0);
      expect(row()).toMatchObject({ status: "PENDING", current_step: "dry_run_logged" });
      expect(audit).toEqual([
        { key: DELIVERY, status: "processed", message: expect.stringContaining("dry run") },
      ]);
      const line = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.includes("woo-order-dry-run"));
      expect(JSON.parse(line!)).toMatchObject({ tag: "woo-order-dry-run", orderId: 1042, orderNo: ORDER_NO, lineCount: 2, mode: orderMode });
    });
  }

  it("a dry run never clobbers a saga that is already further along", async () => {
    const { store, row } = memStore({ status: "IN_PROGRESS", current_step: "mo_created" });
    const { deps } = makeDeps({ store, katana: fakeKatana().deps, orderMode: "log" });
    await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(row()).toMatchObject({ status: "IN_PROGRESS", current_step: "mo_created" });
  });

  it("a PENDING dry-run row is still processable after the live flip (never poisoned)", async () => {
    const { store, row } = memStore();
    const dry = makeDeps({ store, katana: fakeKatana().deps, orderMode: "log" });
    await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps: dry.deps });
    expect(row()?.status).toBe("PENDING");

    const k = fakeKatana();
    const live = makeDeps({ store, katana: k.deps, orderMode: "live" });
    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps: live.deps });
    expect(result).toMatchObject({ ok: true, dryRun: false, katanaSalesOrderId: 500 });
    expect(k.state.created).toHaveLength(1);
  });

  it("defaultWooSagaDeps reads both gates at CALL time, fail closed", () => {
    const keep = { o: process.env.ORDER_PIPELINE_MODE, l: process.env.LEDGER_PIPELINE_MODE };
    try {
      const deps = defaultWooSagaDeps();
      delete process.env.ORDER_PIPELINE_MODE;
      delete process.env.LEDGER_PIPELINE_MODE;
      expect(deps.getModes()).toEqual({ orderMode: "log", ledgerMode: "log" });
      process.env.ORDER_PIPELINE_MODE = " LIVE ";
      process.env.LEDGER_PIPELINE_MODE = "Live";
      expect(deps.getModes()).toEqual({ orderMode: "live", ledgerMode: "live" });
      process.env.ORDER_PIPELINE_MODE = "garbage";
      process.env.LEDGER_PIPELINE_MODE = "";
      expect(deps.getModes()).toEqual({ orderMode: "log", ledgerMode: "log" });
    } finally {
      for (const [name, value] of [["ORDER_PIPELINE_MODE", keep.o], ["LEDGER_PIPELINE_MODE", keep.l]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("Woo saga: live path", () => {
  it("creates the SO with idempotencyKey=orderNo, then ONE MO per row, then parks at the ledger dry-run", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    const { deps, audit } = makeDeps({ store, katana: k.deps, orderMode: "live", ledgerMode: "log" });

    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });

    expect(k.state.created).toHaveLength(1);
    expect(k.state.created[0]).toMatchObject({
      orderNo: ORDER_NO,
      idempotencyKey: ORDER_NO,
      ecommerceOrderId: "1042",
      ecommerceOrderType: "woocommerce",
    });
    expect(k.state.moCreates).toEqual([11, 12]);
    expect(result).toMatchObject({
      ok: true,
      dryRun: false,
      pipelineMode: "live",
      ledgerMode: "log",
      katanaSalesOrderId: 500,
      ledgerMarker: "ledger_dry_run",
    });
    expect((result as { manufacturingOrderIds: number[] }).manufacturingOrderIds).toHaveLength(2);
    expect(row()).toMatchObject({ status: "IN_PROGRESS", current_step: "ledger_dry_run" });
    expect(row()?.status).not.toBe("COMPLETED");
    expect(audit.at(-1)).toMatchObject({ key: DELIVERY, status: "processed" });
  });

  it("every Katana call runs inside runKatanaStep (defer policy active)", async () => {
    const { store } = memStore();
    const k = fakeKatana();
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(k.state.deferPolicies.length).toBeGreaterThan(0);
    expect(new Set(k.state.deferPolicies)).toEqual(new Set(["defer"]));
  });

  it("an existing OWN sales order is adopted: zero create calls", async () => {
    const { store } = memStore();
    const k = fakeKatana({
      existingSo: { id: 500, order_no: ORDER_NO, ecommerce_order_id: "1042", ecommerce_order_type: "woocommerce" },
      existingSoRows: [11, 12],
    });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(k.state.created).toHaveLength(0);
    expect(k.state.moCreates).toEqual([11, 12]);
    expect(result).toMatchObject({ ok: true, katanaSalesOrderId: 500 });
  });

  it("an existing FOREIGN order_no (cross-source collision) is NonRetriable, never adopted, saga manual", async () => {
    const { store, row } = memStore();
    const k = fakeKatana({
      existingSo: { id: 77, order_no: ORDER_NO, additional_info: "GHL Produce Factory Order abc", ecommerce_order_id: "" },
    });
    const { deps, audit } = makeDeps({ store, katana: k.deps, orderMode: "live" });

    await expect(runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    expect(k.state.created).toHaveLength(0);
    expect(k.state.moCreates).toHaveLength(0);
    expect(row()?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
    expect(row()?.last_error).toContain("collision");
    expect(audit.at(-1)).toMatchObject({ status: "failed" });
  });

  it("422 from Katana is NonRetriable + saga manual intervention (no delete exists to run)", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    k.state.createSoError = new KatanaApiError("unknown SKU", { status: 422 });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    expect(row()?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
  });

  it("a transient Katana error (503) propagates as itself (retryable), saga marked manual once exhausted", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    k.state.createSoError = new KatanaApiError("Katana 503", { status: 503 });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    const error = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps }).catch((e) => e);
    expect(error).toBeInstanceOf(KatanaApiError);
    expect(error).not.toBeInstanceOf(NonRetriableError);
    expect(row()?.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
  });

  it("a Katana 429 becomes a RetryAfterError via runKatanaStep", async () => {
    const { store } = memStore();
    const k = fakeKatana();
    k.state.createSoError = new KatanaApiError("slow down", { status: 429 });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      RetryAfterError,
    );
  });

  it("the throttle fail-closed codes are NonRetriable (straight to the DLQ, no silent retries)", async () => {
    const { store } = memStore();
    const k = fakeKatana();
    k.state.createSoError = new KatanaApiError("migration 0054 missing", {
      status: 503,
      code: "RATE_LIMIT_TABLE_MISSING",
    });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      NonRetriableError,
    );
  });

  it("MTO retry after row 1 succeeded creates NO duplicate MO (existing-MO check per row)", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    k.state.failMoOnceForRow = 12;
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });

    await expect(runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      KatanaApiError,
    );
    expect(k.state.moCreates).toEqual([11]);

    // Operator re-drive after the manual flag was cleared; a fresh run with NO memoization is
    // the worst case (everything re-executes).
    row()!.status = "IN_PROGRESS";
    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(k.state.moCreates).toEqual([11, 12]);
    expect(k.state.created).toHaveLength(1);
    expect(result).toMatchObject({ ok: true });
  });

  it("memoized steps are not re-executed on replay (Inngest memoization)", async () => {
    const { store } = memStore();
    const k = fakeKatana();
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    const step = memoStep();
    await runWooOrderSaga({ event: { data: wooOrder() }, step, deps });
    await runWooOrderSaga({ event: { data: wooOrder() }, step, deps });
    expect(k.state.created).toHaveLength(1);
    expect(k.state.moCreates).toEqual([11, 12]);
  });

  it("row count mismatch between Woo lines and Katana rows is NonRetriable", async () => {
    const { store } = memStore();
    const k = fakeKatana({
      existingSo: { id: 500, ecommerce_order_id: "1042", ecommerce_order_type: "woocommerce" },
      existingSoRows: [11],
    });
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(runWooOrderSaga({ event: { data: wooOrder(2) }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    expect(k.state.moCreates).toHaveLength(0);
  });

  it("an order larger than the MO listing page is refused up front (no Katana call)", async () => {
    const { store } = memStore();
    const k = fakeKatana();
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(runWooOrderSaga({ event: { data: wooOrder(51) }, step: memoStep(), deps })).rejects.toBeInstanceOf(
      NonRetriableError,
    );
    expect(k.state.soLookups).toBe(0);
  });
});

describe("Woo saga: ledger seam", () => {
  it("live ledger mode parks at awaiting_ledger_step_8 (IN_PROGRESS, never COMPLETED) and shouts", async () => {
    const { store, row } = memStore();
    const { deps } = makeDeps({ store, katana: fakeKatana().deps, orderMode: "live", ledgerMode: "live" });
    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(result).toMatchObject({ ledgerMode: "live", ledgerMarker: "awaiting_ledger_step_8" });
    expect(row()).toMatchObject({ status: "IN_PROGRESS", current_step: "awaiting_ledger_step_8" });
    const line = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.includes("ledger-not-implemented"));
    expect(JSON.parse(line!)).toMatchObject({ tag: "ledger-not-implemented", fn: "woo-order-saga", mode: "live" });
  });

  it("log/unset/garbage ledger mode writes the dry-run marker + ledger-containment line", async () => {
    const modes = ["log", undefined, "garbage"] as unknown as Array<"log" | undefined>;
    vi.stubEnv("LEDGER_PIPELINE_MODE", ""); // `undefined` mode falls back to the env: pin it to log
    for (const mode of modes) {
      const { store, row } = memStore();
      await store.insertOnce({ sagaType: "path_b_woo", correlationKey: "1042" });
      logSpy.mockClear();
      const result = await runWooLedgerLeg({ order: { id: 1042 }, orderNo: ORDER_NO, mode, store });
      expect(result).toMatchObject({ dryRun: true, marker: "ledger_dry_run" });
      expect(row()?.current_step).toBe("ledger_dry_run");
      const line = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).find((l: string) => l.includes("ledger-containment"));
      expect(JSON.parse(line!)).toMatchObject({ tag: "ledger-containment", fn: "woo-order-saga", dryRun: true, orderId: "1042" });
    }
    vi.unstubAllEnvs();
  });

  it("a ledger-leg failure plans retry_ledger and never contains a delete, paid or not", () => {
    for (const paid of [true, false]) {
      const plan = planCompensation({ paid, failedLeg: "ledger", createdSoId: 500, createdMoIds: [1, 2] });
      expect(plan.actions).toEqual([{ action: "retry_ledger" }]);
      expect(plan.actions.some(isDeleteAction)).toBe(false);
    }
  });

  it("a PAID Woo saga never plans a delete for any failed leg", () => {
    for (const failedLeg of ["ledger", "sales_order", "manufacturing_orders", "other"] as const) {
      const plan = planCompensation({ paid: true, failedLeg, createdSoId: 500, createdMoIds: [1, 2] });
      expect(plan.actions.some(isDeleteAction)).toBe(false);
      expect(() => assertNeverDeletePaid(true, plan)).not.toThrow();
    }
  });
});

describe("Woo saga: guards and idempotency layers", () => {
  it("a COMPLETED saga short-circuits as a duplicate with zero Katana calls", async () => {
    const { store } = memStore({ status: "COMPLETED" });
    const k = fakeKatana();
    const { deps, audit } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(result).toMatchObject({ ok: true, duplicate: true });
    expect(k.state.soLookups).toBe(0);
    expect(audit).toHaveLength(0);
  });

  it("a saga already in manual intervention is not re-run or re-alerted", async () => {
    for (const status of ["SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION", "COMPENSATING", "COMPENSATED"] as const) {
      const { store } = memStore({ status });
      const k = fakeKatana();
      const { deps, audit } = makeDeps({ store, katana: k.deps, orderMode: "live" });
      const result = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
      expect(result).toMatchObject({ ok: true, skipped: true, reason: `saga_${status}` });
      expect(k.state.soLookups).toBe(0);
      expect(audit).toHaveLength(0);
    }
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("a redelivery after a finished run (fresh step memo) creates no second SO and no second MOs", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });

    await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(row()?.status).toBe("IN_PROGRESS"); // ledger leg unbuilt => never COMPLETED

    const again = await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(again).toMatchObject({ ok: true });
    expect(k.state.created).toHaveLength(1);
    expect(k.state.moCreates).toEqual([11, 12]);
  });


  it("an invalid payload is NonRetriable before any store or Katana access", async () => {
    const { store, row } = memStore();
    const k = fakeKatana();
    const { deps } = makeDeps({ store, katana: k.deps, orderMode: "live" });
    await expect(
      runWooOrderSaga({
        event: { data: wooOrder(1, { line_items: [{ name: "x", product_id: 1, quantity: 1, sku: "BAD" }] }) },
        step: memoStep(),
        deps,
      }),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(row()).toBeUndefined();
    expect(k.state.soLookups).toBe(0);
  });

  it("the audit row is addressed by the delivery key carried in the event", async () => {
    const { store } = memStore();
    const { deps, audit } = makeDeps({ store, katana: fakeKatana().deps, orderMode: "log" });
    await runWooOrderSaga({ event: { data: wooOrder() }, step: memoStep(), deps });
    expect(audit[0]!.key).toBe(DELIVERY);

    const noKey = { ...wooOrder() } as Record<string, unknown>;
    delete noKey._cc_delivery_key;
    const second = makeDeps({ store: memStore().store, katana: fakeKatana().deps, orderMode: "log" });
    await runWooOrderSaga({ event: { data: noKey }, step: memoStep(), deps: second.deps });
    expect(second.audit).toHaveLength(0);
  });
});

describe("toWooSagaError", () => {
  it("maps 4xx (except 408/409/429) to NonRetriable; leaves 5xx, 408, 409, 429 and plain errors alone", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(toWooSagaError(new KatanaApiError("x", { status }))).toBeInstanceOf(NonRetriableError);
    }
    for (const status of [408, 409, 429, 500, 502, 503]) {
      const err = new KatanaApiError("x", { status });
      expect(toWooSagaError(err)).toBe(err);
    }
    const plain = new Error("timeout");
    expect(toWooSagaError(plain)).toBe(plain);
    const nre = new NonRetriableError("already");
    expect(toWooSagaError(nre)).toBe(nre);
  });
});

describe("isOwnWooSalesOrder (provenance check)", () => {
  it("accepts ecommerce_order_id match with empty or woocommerce type", () => {
    expect(isOwnWooSalesOrder({ ecommerce_order_id: "1042" }, 1042)).toBe(true);
    expect(isOwnWooSalesOrder({ ecommerce_order_id: 1042, ecommerce_order_type: "WooCommerce" }, "1042")).toBe(true);
  });

  it("accepts additional_info woo_order=<id> with a proper boundary", () => {
    expect(isOwnWooSalesOrder({ additional_info: "source=woocommerce | woo_order=1042" }, 1042)).toBe(true);
    expect(isOwnWooSalesOrder({ additional_info: "woo_order=1042" }, 1042)).toBe(true);
  });

  it("rejects foreign orders: other ecommerce type, other id, prefix id, GHL info, empty", () => {
    expect(isOwnWooSalesOrder({ ecommerce_order_id: "1042", ecommerce_order_type: "shopify" }, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({ ecommerce_order_id: "1043" }, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({ additional_info: "woo_order=10423" }, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({ additional_info: "xwoo_order=1042" }, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({ additional_info: "GHL Produce Factory Order 1042." }, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({}, 1042)).toBe(false);
    expect(isOwnWooSalesOrder({ ecommerce_order_id: "" }, "")).toBe(false);
  });
});
