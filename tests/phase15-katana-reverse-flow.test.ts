import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import moFixture from "./fixtures/katana/manufacturing-order-done.json";
import moListFixture from "./fixtures/katana/manufacturing-orders-by-so.json";
import poPartialFixture from "./fixtures/katana/purchase-order-partially-received.json";
import poFixture from "./fixtures/katana/purchase-order-received.json";
import soGhlFixture from "./fixtures/katana/sales-order-ghl.json";
import soFixture from "./fixtures/katana/sales-order-legacy-deleted.json";
import supplierFixture from "./fixtures/katana/supplier.json";

const sendMock = vi.hoisted(() => vi.fn(async (_event: { id: string }) => ({ ids: ["evt"] })));
vi.mock("@/inngest/client", () => ({
  inngest: { send: sendMock, createFunction: vi.fn(() => ({})) },
}));

const katanaFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/katana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/katana")>()),
  katanaFetch: katanaFetchMock,
}));

type AuditRow = { source: string; event_name: string; idempotency_key: string; status: string };
const fakeDb = vi.hoisted(() => {
  const state = {
    rows: [] as AuditRow[],
    updates: [] as Array<Record<string, unknown>>,
    insertError: null as Error | null,
  };
  const db = {
    insert: () => ({
      values: (values: AuditRow) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.insertError) throw state.insertError;
            state.rows.push(values);
            return [{ id: state.rows.length }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(values);
        },
      }),
    }),
  };
  return { state, db };
});
vi.mock("@/server/db/client", () => ({ getDb: () => fakeDb.db }));
vi.mock("@/server/stock/release-hold", () => ({ releaseDeletedHoldDocument: vi.fn() }));
vi.mock("@/lib/pim-audit", () => ({ logPimAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  KATANA_MO_DONE_EVENT,
  KATANA_SO_STATUS_EVENT,
  KATANA_VARIANT_HEAL_EVENT,
  readManufacturingOrderDone,
  readPurchaseOrderReceipt,
  readSalesOrderStatus,
} from "@/server/katana/webhook-events";
import {
  deriveFactoryStage,
  readManufacturingOrderSnapshot,
  readSalesOrderSnapshot,
} from "@/server/katana/order-status";
import {
  parseQboVendorIdFromSupplier,
  readPoReceiptRows,
} from "@/server/katana/po-receipt-ledger";

const ROOT = path.resolve(__dirname, "..");
const SECRET = "phase15-test-secret";
const DRIVER_TEXT = 'relation "incoming_webhooks" password=hunter2';

const SO_ID = soFixture.listed.id;
const MO_ID = moFixture.id;
const PO_ID = poFixture.id;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("webhook-events parsers (QA-15.3-01/02)", () => {
  it("readPurchaseOrderReceipt has exactly one definition, in webhook-events.ts", () => {
    const candidates = [
      "src/server/katana/webhook-events.ts",
      "src/server/katana/variant-webhook.ts",
      "src/inngest/katana-po-received.ts",
      "src/app/api/webhooks/katana/route.ts",
    ];
    const hits = candidates.filter((file) =>
      source(file).includes("export function readPurchaseOrderReceipt"),
    );
    expect(hits).toEqual(["src/server/katana/webhook-events.ts"]);
    expect(source("src/server/katana/variant-webhook.ts")).not.toContain("PurchaseOrderReceiptRead");
    expect(source("src/inngest/katana-po-received.ts")).not.toContain("PurchaseOrderReceiptRead");
  });

  it("exports the Inngest event names", () => {
    expect(KATANA_SO_STATUS_EVENT).toBe("katana/sales_order.status_changed");
    expect(KATANA_MO_DONE_EVENT).toBe("katana/manufacturing_order.done");
    expect(KATANA_VARIANT_HEAL_EVENT).toBe("katana/variant.heal.requested");
  });

  it("reads PO receipts from the fixture id", () => {
    expect(
      readPurchaseOrderReceipt({
        action: "purchase_order.partially_received",
        object: { id: PO_ID, order_no: poFixture.order_no },
      }),
    ).toEqual({
      kind: "received",
      action: "purchase_order.partially_received",
      purchaseOrderId: PO_ID,
      orderNo: poFixture.order_no,
    });
  });

  it("reads SO status from dotted action, event key, resource_type form, and nested id", () => {
    expect(
      readSalesOrderStatus({ action: "sales_order.updated", object: { id: SO_ID, status: "delivered" } }),
    ).toEqual({
      kind: "sales_order_status",
      action: "sales_order.updated",
      salesOrderId: SO_ID,
      statusHint: "DELIVERED",
    });
    expect(readSalesOrderStatus({ event: "SALES_ORDER.PACKED", data: { id: String(SO_ID) } })).toMatchObject({
      kind: "sales_order_status",
      action: "sales_order.packed",
      salesOrderId: SO_ID,
      statusHint: null,
    });
    expect(
      readSalesOrderStatus({ resource_type: "sales_order", action: "delivered", object: { id: SO_ID } }),
    ).toMatchObject({ kind: "sales_order_status", action: "sales_order.delivered", salesOrderId: SO_ID });
    expect(
      readSalesOrderStatus({ action: "sales_order.updated", object: { sales_order: { id: SO_ID } } }),
    ).toMatchObject({ kind: "sales_order_status", salesOrderId: SO_ID });
  });

  it("SO: missing id is invalid; unrelated actions and sales_order.deleted are ignored", () => {
    expect(readSalesOrderStatus({ action: "sales_order.updated", object: {} }).kind).toBe("invalid");
    expect(readSalesOrderStatus({ action: "sales_order.updated", object: { id: 0 } }).kind).toBe("invalid");
    expect(readSalesOrderStatus({ action: "variant.updated", object: { id: 1 } })).toEqual({ kind: "ignore" });
    expect(readSalesOrderStatus({ action: "sales_order.deleted", object: { id: SO_ID } })).toEqual({
      kind: "ignore",
    });
    expect(
      readSalesOrderStatus({ resource_type: "sales_order", action: "deleted", object: { id: SO_ID } }),
    ).toEqual({ kind: "ignore" });
    expect(readSalesOrderStatus([]).kind).toBe("invalid");
  });

  it("reads MO done from the fixture id in every envelope form", () => {
    const expected = { kind: "manufacturing_order_done", manufacturingOrderId: MO_ID };
    expect(readManufacturingOrderDone({ action: "manufacturing_order.done", object: { id: MO_ID } })).toEqual(expected);
    expect(readManufacturingOrderDone({ event: "manufacturing_order.done", data: { id: MO_ID } })).toEqual(expected);
    expect(
      readManufacturingOrderDone({ resource_type: "manufacturing_order", action: "done", object: { id: MO_ID } }),
    ).toEqual(expected);
    expect(
      readManufacturingOrderDone({
        action: "manufacturing_order.done",
        data: { manufacturing_order: { id: MO_ID } },
      }),
    ).toEqual(expected);
    expect(readManufacturingOrderDone({ action: "manufacturing_order.done", object: {} }).kind).toBe("invalid");
    expect(readManufacturingOrderDone({ action: "manufacturing_order.updated", object: { id: MO_ID } })).toEqual({
      kind: "ignore",
    });
  });
});

describe("Katana route makes zero Katana calls (QA-R10-01)", () => {
  it("route.ts imports neither loadKatanaVariantSku nor @/lib/katana", () => {
    const route = source("src/app/api/webhooks/katana/route.ts");
    expect(route).not.toContain("loadKatanaVariantSku");
    expect(route).not.toContain("katanaFetch");
    expect(route).not.toMatch(/from\s+["']@\/lib\/katana/);
  });
});

describe("POST /api/webhooks/katana audit + routing (QA-15.3-03/04/05)", () => {
  beforeEach(() => {
    process.env.KATANA_WEBHOOK_SECRET = SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    fakeDb.state.rows = [];
    fakeDb.state.updates = [];
    fakeDb.state.insertError = null;
    sendMock.mockClear();
    katanaFetchMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  async function deliver(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    const sig = signature ?? createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");
    const { POST } = await import("@/app/api/webhooks/katana/route");
    return POST(
      new Request("http://localhost/api/webhooks/katana", {
        method: "POST",
        body: raw,
        headers: { "x-sha2-signature": sig },
      }),
    );
  }

  it("bad signature: 401 and no audit row", async () => {
    const res = await deliver({ action: "sales_order.updated", object: { id: SO_ID } }, "00ff");
    expect(res.status).toBe(401);
    expect(fakeDb.state.rows).toHaveLength(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("SO status: one katana audit row, enqueues katana/sales_order.status_changed, marks processed", async () => {
    const res = await deliver({ action: "sales_order.updated", object: { id: SO_ID } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true, action: "sales_order.updated" });
    expect(fakeDb.state.rows).toHaveLength(1);
    expect(fakeDb.state.rows[0]).toMatchObject({
      source: "katana",
      event_name: "sales_order.updated",
      status: "received",
    });
    expect(fakeDb.state.rows[0]!.idempotency_key).toMatch(new RegExp(`^katana:sales_order\\.updated:${SO_ID}:`));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: KATANA_SO_STATUS_EVENT,
        data: { salesOrderId: SO_ID, action: "sales_order.updated", source: "webhook" },
      }),
    );
    expect(fakeDb.state.updates).toEqual([expect.objectContaining({ status: "processed" })]);
    expect(katanaFetchMock).not.toHaveBeenCalled();
  });

  it("MO done: enqueues katana/manufacturing_order.done", async () => {
    const res = await deliver({ action: "manufacturing_order.done", object: { id: MO_ID } });
    expect(res.status).toBe(200);
    expect(fakeDb.state.rows).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: KATANA_MO_DONE_EVENT, data: { manufacturingOrderId: MO_ID } }),
    );
  });

  it("variant.updated without SKU: enqueues the heal, zero Katana calls", async () => {
    const res = await deliver({ action: "variant.updated", object: { id: 42561748 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true, variantId: 42561748 });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: KATANA_VARIANT_HEAL_EVENT, data: { variantId: 42561748 } }),
    );
    expect(katanaFetchMock).not.toHaveBeenCalled();
  });

  it("SO event with no id: 400, audit row marked failed, no enqueue", async () => {
    const res = await deliver({ action: "sales_order.updated", object: {} });
    expect(res.status).toBe(400);
    expect(fakeDb.state.rows).toHaveLength(1);
    expect(fakeDb.state.updates).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("unrelated action: audit row, ignored, processed", async () => {
    const res = await deliver({ action: "customer.created", object: { id: 5 } });
    expect(await res.json()).toEqual({ ok: true, ignored: true });
    expect(fakeDb.state.rows).toHaveLength(1);
    expect(fakeDb.state.updates).toEqual([expect.objectContaining({ status: "processed" })]);
  });

  it("identical SO bodies delivered twice: two audit rows, two sends with different ids", async () => {
    const body = { action: "sales_order.delivered", object: { id: SO_ID } };
    await deliver(body);
    await deliver(body);
    expect(fakeDb.state.rows).toHaveLength(2);
    expect(fakeDb.state.rows[0]!.idempotency_key).not.toBe(fakeDb.state.rows[1]!.idempotency_key);
    const ids = sendMock.mock.calls.map((call) => call[0].id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("identical PO-receipt bodies twice: two audit rows, two sends with distinct per-delivery event ids (QA-15.3-04)", async () => {
    const body = { action: "purchase_order.partially_received", object: { id: PO_ID } };
    await deliver(body);
    await deliver(body);
    expect(fakeDb.state.rows).toHaveLength(2);
    expect(sendMock).toHaveBeenCalledTimes(2);
    const ids = sendMock.mock.calls.map((call) => call[0].id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("audit insert throws: 500 persistence_failed with a ref, never driver text, no enqueue", async () => {
    fakeDb.state.insertError = new Error(DRIVER_TEXT);
    const res = await deliver({ action: "sales_order.updated", object: { id: SO_ID } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("incoming_webhooks");
    const body = JSON.parse(text) as { error: string; ref: string };
    expect(body.error).toBe("persistence_failed");
    expect(body.ref).toMatch(/^[0-9a-f]{12}$/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("inngest.send failure: audit marked failed and 500", async () => {
    sendMock.mockRejectedValueOnce(new Error(DRIVER_TEXT));
    const res = await deliver({ action: "manufacturing_order.done", object: { id: MO_ID } });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("hunter2");
    expect(fakeDb.state.updates).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});

describe("Katana fixtures PII & schema verification (QA-15.0-01)", () => {
  it("all required Phase 15 fixtures exist and contain zero email, phone, or street PII", () => {
    const fixtureDir = path.join(ROOT, "tests", "fixtures", "katana");
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".json"));
    expect(files).toEqual(
      expect.arrayContaining([
        "manufacturing-order-done.json",
        "manufacturing-orders-by-so.json",
        "purchase-order-partially-received.json",
        "purchase-order-received.json",
        "sales-order-ghl.json",
        "supplier.json",
      ]),
    );

    const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
    const phoneRe = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/;
    const streetRe = /\b\d{2,5}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane)\b/;

    for (const file of files) {
      const content = readFileSync(path.join(fixtureDir, file), "utf8");
      expect(content, `${file} contains email`).not.toMatch(emailRe);
      expect(content, `${file} contains phone`).not.toMatch(phoneRe);
      expect(content, `${file} contains street`).not.toMatch(streetRe);
    }
  });

  it("parses real SO, MO, PO, and supplier fixtures through domain readers", () => {
    const soSnap = readSalesOrderSnapshot(soGhlFixture);
    expect(soSnap).toEqual({
      id: 53609101,
      orderNo: "GHL-opp_fixture_01",
      status: "NOT_SHIPPED",
      productionStatus: "IN_PROGRESS",
    });

    const moSnaps = moListFixture.data.map(readManufacturingOrderSnapshot);
    expect(moSnaps).toEqual([
      { id: 19833041, status: "DONE", salesOrderId: 53609101 },
      { id: 19833042, status: "IN_PROGRESS", salesOrderId: 53609101 },
    ]);

    const poRows = readPoReceiptRows(poPartialFixture as Record<string, unknown>);
    expect(poRows).toHaveLength(2);
    expect(poRows[0]?.receivedQtyCumulative).toBe(4);
    expect(poRows[1]?.receivedQtyCumulative).toBe(0);

    expect(parseQboVendorIdFromSupplier(supplierFixture as Record<string, unknown>)).toEqual({
      ok: true,
      qboVendorId: "145",
    });
  });
});

describe("deriveFactoryStage truth table (QA-15.4-01, QA-R12-01/02)", () => {
  const baseSo = readSalesOrderSnapshot(soGhlFixture);

  it("precedence 1: DELIVERED wins over everything", () => {
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "DELIVERED", productionStatus: "NOT_STARTED" },
        [],
        [10],
      ),
    ).toBe("delivered");
  });

  it("precedence 2: PACKED yields ready_to_ship", () => {
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "PACKED", productionStatus: "IN_PROGRESS" },
        [],
        [10],
      ),
    ).toBe("ready_to_ship");
  });

  it("precedence 3a: productionStatus DONE yields build_complete even with empty expectedMoIds", () => {
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "NOT_SHIPPED", productionStatus: "DONE" },
        [],
        [],
      ),
    ).toBe("build_complete");
  });

  it("precedence 3b: all expected MOs present and DONE yields build_complete before SO production_status catches up", () => {
    const mos = moListFixture.data.map((m) => ({
      ...readManufacturingOrderSnapshot(m),
      status: "DONE",
    }));
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "NOT_SHIPPED", productionStatus: "IN_PROGRESS" },
        mos,
        [19833041, 19833042],
      ),
    ).toBe("build_complete");
  });

  it("precedence 4: mixed MO statuses or IN_PROGRESS/BLOCKED yields in_production", () => {
    const mos = moListFixture.data.map(readManufacturingOrderSnapshot);
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "NOT_SHIPPED", productionStatus: "NOT_STARTED" },
        mos,
        [19833041, 19833042],
      ),
    ).toBe("in_production");
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "PENDING", productionStatus: "BLOCKED" },
        [],
        [],
      ),
    ).toBe("in_production");
  });

  it("precedence 5: NOT_STARTED / NONE / unknown strings yield null", () => {
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "NOT_SHIPPED", productionStatus: "NOT_STARTED" },
        [{ id: 19833041, status: "NOT_STARTED", salesOrderId: baseSo.id }],
        [19833041],
      ),
    ).toBeNull();
    expect(
      deriveFactoryStage(
        { ...baseSo, status: "MYSTERY_STATUS", productionStatus: "MYSTERY_PROD" },
        [{ id: 19833041, status: "MYSTERY_MO", salesOrderId: baseSo.id }],
        [19833041],
      ),
    ).toBeNull();
  });
});
