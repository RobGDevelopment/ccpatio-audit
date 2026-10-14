import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_SKU,
  FAB_SKU,
  makeHub,
  makeIncomingLogFake,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";

/**
 * Operator decision D9: an `order.updated` after the paid delivery was processed is alert-only
 * when it changes what is manufactured or shipped, and a plain acknowledgement otherwise.
 */
const SECRET = "test-woo-secret";

const h = vi.hoisted(() => ({
  send: vi.fn(),
  alert: vi.fn(),
  sagaGet: vi.fn(),
  quarantineOnce: vi.fn(),
  resolvePending: vi.fn(),
  log: null as unknown as ReturnType<typeof import("./helpers/woo-fakes").makeIncomingLogFake>,
  hub: null as unknown as ReturnType<typeof import("./helpers/woo-fakes").makeHub>,
}));

vi.mock("@/inngest/client", () => ({ inngest: { send: h.send } }));
vi.mock("@/server/alerts/oh-crap", () => ({ sendOhCrapAlert: h.alert }));
vi.mock("@/server/sre/saga-store", () => ({ sagaStore: { get: h.sagaGet } }));
vi.mock("@/server/db/client", () => ({
  getDb: () => {
    throw new Error("the database must not be touched in this unit test");
  },
}));
vi.mock("@/server/webhooks/incoming-log", () => ({
  insertIncomingWebhookOnce: (input: Parameters<typeof h.log.insertOnce>[0]) => h.log.insertOnce(input),
  updateIncomingWebhookStatus: (key: string, status: "processed" | "failed") =>
    h.log.updateStatus(key, status),
  getIncomingWebhook: (key: string) => h.log.get(key),
  setIncomingWebhookPayload: (key: string, status: "received" | "processed" | "failed", payload: unknown) =>
    h.log.set(key, status, payload),
}));
vi.mock("@/server/woocommerce/quarantine-store", () => ({
  quarantineOnce: h.quarantineOnce,
  resolvePendingReviewForOrder: h.resolvePending,
}));
vi.mock("@/server/woocommerce/sku-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/woocommerce/sku-resolver")>()),
  hubResolveDeps: () => h.hub,
}));

import { POST } from "@/app/api/webhooks/woocommerce/route";
import { fingerprintWooOrder } from "@/server/woocommerce/order-fingerprint";
import { decidePaidDelivery, markBaselineEnqueued, wooBaselineKey } from "@/server/woocommerce/paid-baseline";

function req(order: unknown, delivery: string): Request {
  const body = JSON.stringify(order);
  return new Request("http://localhost/api/webhooks/woocommerce", {
    method: "POST",
    body,
    headers: {
      "x-wc-webhook-signature": createHmac("sha256", SECRET).update(body, "utf8").digest("base64"),
      "x-wc-webhook-topic": "order.updated",
      "x-wc-webhook-delivery-id": delivery,
    },
  });
}
const post = (order: unknown, delivery: string) => POST(req(order, delivery));

beforeEach(() => {
  h.log = makeIncomingLogFake();
  h.hub = makeHub();
  h.send.mockReset().mockResolvedValue({ ids: ["x"] });
  h.alert.mockReset().mockResolvedValue({ ok: true, emailed: true, resolutionUrl: "http://x" });
  h.sagaGet.mockReset().mockResolvedValue(null);
  h.quarantineOnce.mockReset().mockResolvedValue("inserted");
  h.resolvePending.mockReset().mockResolvedValue(0);
  vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("manufacturing fingerprint", () => {
  it("ignores status, notes, totals and timestamps", () => {
    const base = wooOrder();
    const noisy = wooOrder({
      status: "completed",
      customer_note: "leave at door",
      total: "999.00",
      date_modified: "2026-10-14T00:00:00",
      transaction_id: "ch_123",
    });
    expect(fingerprintWooOrder(noisy)).toBe(fingerprintWooOrder(base));
  });

  it("ignores whitespace and case in address and name fields", () => {
    const a = wooOrder({ shipping: { first_name: "Ada", address_1: "1 Main St", city: "Austin" } });
    const b = wooOrder({ shipping: { first_name: " ada ", address_1: "1  main st", city: "AUSTIN" } });
    expect(fingerprintWooOrder(a)).toBe(fingerprintWooOrder(b));
  });

  it.each([
    ["quantity", { line_items: [wooLine({ quantity: 3 })] }],
    ["base SKU", { line_items: [wooLine({ sku: "FIN-OTHER-1" })] }],
    ["fabric", { line_items: [wooLine({ meta_data: [{ key: "fabric", value: "FAB-OTHER" }, { key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })] }],
    ["frame", { line_items: [wooLine({ meta_data: [{ key: "fabric", value: FAB_SKU }, { key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-STEEL" }] })] }],
    ["an added line", { line_items: [wooLine(), wooLine({ id: 2 })] }],
    ["shipping address", { shipping: { first_name: "Ada", address_1: "9 Elm St", city: "Austin" } }],
    ["customer email", { billing: { first_name: "Ada", last_name: "Lovelace", email: "other@example.com" } }],
  ])("changes when the %s changes", (_what, overrides) => {
    expect(fingerprintWooOrder(wooOrder(overrides))).not.toBe(fingerprintWooOrder(wooOrder()));
  });
});

describe("decidePaidDelivery", () => {
  it("first -> redelivery -> unchanged -> edited, driven by the baseline row", async () => {
    const log = makeIncomingLogFake();
    const deps = { insertOnce: log.insertOnce, get: log.get, set: log.set };
    const base = { orderId: "7", topic: "order.updated" };

    expect(await decidePaidDelivery({ ...base, deliveryKey: "d1", fingerprint: "fp1" }, deps)).toEqual({ kind: "first" });
    // Not enqueued yet: a second delivery takes over, even with different content.
    expect(await decidePaidDelivery({ ...base, deliveryKey: "d2", fingerprint: "fp2" }, deps)).toEqual({ kind: "first" });

    await markBaselineEnqueued({ orderId: "7", deliveryKey: "d2", fingerprint: "fp2" }, deps);
    expect(await decidePaidDelivery({ ...base, deliveryKey: "d2", fingerprint: "fp2" }, deps)).toEqual({ kind: "redelivery" });
    expect(await decidePaidDelivery({ ...base, deliveryKey: "d3", fingerprint: "fp2" }, deps)).toEqual({ kind: "unchanged" });
    expect(await decidePaidDelivery({ ...base, deliveryKey: "d4", fingerprint: "fp9" }, deps)).toEqual({
      kind: "edited",
      previousFingerprint: "fp2",
    });
  });
});

describe("route: order.updated after the paid delivery was processed", () => {
  it.each([
    ["quantity", { line_items: [wooLine({ quantity: 5 })] }],
    ["fabric", { line_items: [wooLine({ meta_data: [{ key: "fabric", value: "FAB-OTHER" }, { key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })] }],
    ["shipping address", { shipping: { first_name: "Ada", address_1: "9 Elm St", city: "Austin" } }],
  ])("an edited %s is quarantined as post_payment_edit and alerted; nothing is re-sent", async (_what, edit) => {
    await post(wooOrder(), "d-paid");
    expect(h.send).toHaveBeenCalledTimes(1);

    const res = await post(wooOrder(edit), "d-edit");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, quarantined: true, reason: "post_payment_edit" });

    expect(h.send).toHaveBeenCalledTimes(1); // NOT reprocessed
    expect(h.quarantineOnce).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "1042", status: "post_payment_edit" }),
    );
    const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ path: string }>;
    expect(issues.map((i) => i.path)).toEqual(["(order)", "(fingerprint)"]);
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect(h.alert.mock.calls[0]![0]).toMatchObject({
      source: "woocommerce",
      externalId: "1042",
      message: expect.stringContaining("edited AFTER payment"),
    });
    expect(h.log.rows.get("woo-delivery:d-edit")?.status).toBe("processed");
  });

  it("the same edit delivered again does not alert twice", async () => {
    await post(wooOrder(), "d-paid");
    await post(wooOrder({ line_items: [wooLine({ quantity: 5 })] }), "d-edit-1");
    h.alert.mockClear();
    h.quarantineOnce.mockResolvedValue("unchanged");
    const res = await post(wooOrder({ line_items: [wooLine({ quantity: 5 })] }), "d-edit-2");
    expect(res.status).toBe(202);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("a second, different edit alerts again (the quarantine issues changed)", async () => {
    await post(wooOrder(), "d-paid");
    await post(wooOrder({ line_items: [wooLine({ quantity: 5 })] }), "d-edit-1");
    h.alert.mockClear();
    h.quarantineOnce.mockResolvedValue("changed");
    await post(wooOrder({ line_items: [wooLine({ quantity: 6 })] }), "d-edit-2");
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it("routine updates (status completed, note, totals) are acknowledged with no quarantine and no alert", async () => {
    await post(wooOrder(), "d-paid");
    const res = await post(
      wooOrder({ status: "completed", customer_note: "gift", total: "1.00", date_modified: "2026-10-20T00:00:00" }),
      "d-routine",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, unchanged: true });
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("an edit is detected even if the hub data has since changed (no validation on edited deliveries)", async () => {
    await post(wooOrder(), "d-paid");
    h.hub.records.delete(BASE_SKU);
    const res = await post(wooOrder({ line_items: [wooLine({ quantity: 5 })] }), "d-edit");
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ reason: "post_payment_edit" });
  });

  it("an order whose first delivery was never enqueued is NOT an edit: the latest content is sent", async () => {
    h.send.mockRejectedValueOnce(new Error("inngest unreachable"));
    const first = await post(wooOrder(), "d-1");
    expect(first.status).toBe(500);

    const second = await post(wooOrder({ line_items: [wooLine({ quantity: 4 })] }), "d-2");
    expect(second.status).toBe(202);
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(2);
    const baseline = h.log.rows.get(wooBaselineKey(1042));
    expect(baseline?.payload).toMatchObject({ deliveryKey: "woo-delivery:d-2" });
  });
});
