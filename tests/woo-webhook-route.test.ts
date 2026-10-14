import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_SKU,
  FAB_SKU,
  defaultRecords,
  makeHub,
  makeIncomingLogFake,
  skuRecord,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";

/**
 * Route contract for POST /api/webhooks/woocommerce (roadmap step 6, Phase B1).
 * Everything with I/O is mocked: no database, no Inngest, no email. The route must make zero
 * Katana / QBO / Clover calls (it imports none of them). SKU authority is the (fake) hub.
 */
const SECRET = "test-woo-secret";

const h = vi.hoisted(() => ({
  calls: [] as string[],
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
    throw new Error("the database must not be touched in the route unit test");
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
import { wooBaselineKey } from "@/server/woocommerce/paid-baseline";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function request(
  body: string,
  opts: { secret?: string | null; topic?: string | null; signature?: string | null; delivery?: string | null } = {},
): Request {
  const headers: Record<string, string> = {};
  const signature = opts.signature === undefined ? sign(body, opts.secret ?? SECRET) : opts.signature;
  if (signature !== null) headers["x-wc-webhook-signature"] = signature;
  const topic = opts.topic === undefined ? "order.updated" : opts.topic;
  if (topic !== null) headers["x-wc-webhook-topic"] = topic;
  const delivery = opts.delivery === undefined ? "delivery-1" : opts.delivery;
  if (delivery !== null) headers["x-wc-webhook-delivery-id"] = delivery;
  return new Request("http://localhost/api/webhooks/woocommerce", { method: "POST", body, headers });
}

const post = (order: unknown, opts: Parameters<typeof request>[1] = {}) =>
  POST(request(JSON.stringify(order), opts));

beforeEach(() => {
  h.calls.length = 0;
  h.log = makeIncomingLogFake();
  h.hub = makeHub();
  h.send.mockReset().mockResolvedValue({ ids: ["x"] });
  h.alert.mockReset().mockImplementation(async () => {
    h.calls.push("alert");
    return { ok: true, emailed: true, resolutionUrl: "http://x" };
  });
  h.sagaGet.mockReset().mockResolvedValue(null);
  h.quarantineOnce.mockReset().mockImplementation(async () => {
    h.calls.push("quarantine");
    return "inserted";
  });
  h.resolvePending.mockReset().mockResolvedValue(0);
  vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ORDER_PIPELINE_MODE", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/woocommerce", () => {
  it("503 webhook_not_configured when the secret is unset or blank; nothing is processed", async () => {
    for (const value of ["", "   ", null]) {
      if (value === null) delete process.env.WOOCOMMERCE_WEBHOOK_SECRET;
      else vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", value);
      const res = await post(wooOrder());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "webhook_not_configured" });
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.log.rows.size).toBe(0);
  });

  it("401 invalid_signature for wrong secret, tampered body, missing header, hex digest", async () => {
    const body = JSON.stringify(wooOrder());
    const hex = createHmac("sha256", SECRET).update(body, "utf8").digest("hex");
    const cases = [
      request(body, { secret: "other" }),
      request(body, { signature: sign(`${body} `) }),
      request(body, { signature: null }),
      request(body, { signature: hex }),
    ];
    for (const req of cases) {
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_signature" });
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.log.rows.size).toBe(0);
  });

  it("200 pong for the form-encoded ping (only after the signature passed)", async () => {
    const res = await POST(request("webhook_id=12", { topic: null, delivery: null }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
    const unsigned = await POST(request("webhook_id=12", { signature: "bogus" }));
    expect(unsigned.status).toBe(401);
  });

  it("400 for a validly signed body that is not JSON", async () => {
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      errors: [{ path: "(root)", message: "Body must be valid JSON" }],
    });
  });

  it("200 ignored for topics other than order.created / order.updated", async () => {
    for (const topic of ["order.deleted", "product.updated", null]) {
      const res = await post(wooOrder(), { topic });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true, reason: "topic" });
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  describe("validation against the hub database (no static dictionary)", () => {
    it("a SKU that is not in the hub: 202 quarantined (NOT 400), quarantine persisted BEFORE the alert", async () => {
      const res = await post(wooOrder({ line_items: [wooLine({ sku: "NOT-A-SKU" })] }));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ accepted: true, quarantined: true });

      expect(h.calls).toEqual(["quarantine", "alert"]);
      expect(h.quarantineOnce).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: "1042", status: "pending_review" }),
      );
      const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
      expect(issues.some((i) => /not in the hub/.test(i.message))).toBe(true);
      expect(h.alert).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "validation_failed", source: "woocommerce", externalId: "1042" }),
      );
      expect(h.send).not.toHaveBeenCalled();
    });

    it("a paid order that fails validation marks its audit row failed and pins no baseline", async () => {
      await post(wooOrder({ line_items: [wooLine({ sku: "NOT-A-SKU" })] }));
      expect(h.log.rows.get("woo-delivery:delivery-1")?.status).toBe("failed");
      expect(h.log.rows.get(wooBaselineKey(1042))?.status).toBe("received");
    });

    const rejected: Array<[string, (records: ReturnType<typeof defaultRecords>) => void, object, RegExp]> = [
      [
        "a finished good that is not item_type finished_good",
        (r) => r.set(BASE_SKU, skuRecord(BASE_SKU, { itemType: "sub_assembly", syncToWoo: true, hasCatalogRow: true })),
        {},
        /not a finished_good/,
      ],
      [
        "an inactive finished good",
        (r) => r.set(BASE_SKU, skuRecord(BASE_SKU, { itemType: "finished_good", isActive: false, syncToWoo: true, hasCatalogRow: true })),
        {},
        /inactive/,
      ],
      [
        "a finished good not approved for web (sync_to_woo false, no listing)",
        (r) => r.set(BASE_SKU, skuRecord(BASE_SKU, { itemType: "finished_good", syncToWoo: false, hasCatalogRow: true })),
        {},
        /not approved for web/,
      ],
      [
        "a finished good with no finished_goods_catalog row",
        (r) => r.set(BASE_SKU, skuRecord(BASE_SKU, { itemType: "finished_good", syncToWoo: true, hasCatalogRow: false })),
        {},
        /no finished_goods_catalog row/,
      ],
      [
        "a fabric that is not web_sellable",
        (r) => r.set(FAB_SKU, skuRecord(FAB_SKU, { attributes: { web_sellable: false } })),
        {},
        /not web_sellable/,
      ],
      [
        "a fabric whose web_sellable is the string 'true' (must be boolean true)",
        (r) => r.set(FAB_SKU, skuRecord(FAB_SKU, { attributes: { web_sellable: "true" } })),
        {},
        /not web_sellable/,
      ],
    ];
    it.each(rejected)("quarantines %s", async (_name, mutate, _o, pattern) => {
      mutate(h.hub.records);
      const res = await post(wooOrder());
      expect(res.status).toBe(202);
      const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
      expect(issues.some((i) => pattern.test(i.message))).toBe(true);
      expect(h.send).not.toHaveBeenCalled();
    });

    it("an active ecommerce listing approves a SKU whose sync_to_woo is false", async () => {
      h.hub.records.set(
        BASE_SKU,
        skuRecord(BASE_SKU, { itemType: "finished_good", syncToWoo: false, hasCatalogRow: true, hasActiveListing: true, katanaVariantId: 100 }),
      );
      const res = await post(wooOrder());
      expect(res.status).toBe(202);
      expect(h.send).toHaveBeenCalledTimes(1);
    });

    it("a recipe with no product_bom rows is quarantined (cannot be manufactured)", async () => {
      h.hub.recipes.clear();
      const res = await post(wooOrder());
      expect(res.status).toBe(202);
      const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
      expect(issues.some((i) => /no recipe/.test(i.message))).toBe(true);
    });

    it("a recipe carrying an unsupported placeholder (Dekton) is quarantined", async () => {
      h.hub.recipes.set(BASE_SKU, ["SA-X-FRAME", "RM-FAB-GENERIC", "RM-PWD-GENERIC", "RM-DKT-GENERIC-SLAB"]);
      const res = await post(wooOrder());
      expect(res.status).toBe(202);
      const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
      expect(issues.some((i) => /RM-DKT-GENERIC-SLAB/.test(i.message))).toBe(true);
    });

    it("all SKUs of an order are fetched in ONE batched lookup", async () => {
      await post(wooOrder({ line_items: [wooLine({ id: 1 }), wooLine({ id: 2 })] }));
      expect(h.hub.lookups).toHaveLength(1);
    });
  });

  describe("finish keys", () => {
    it.each(["cushion_fabric", "powder-coat", "frame_type", "dekton", "pillow"])(
      "the near-miss key %s quarantines the order instead of being dropped",
      async (key) => {
        const res = await post(
          wooOrder({
            line_items: [wooLine({ meta_data: [{ key, value: "X-1" }, { key: "fabric", value: FAB_SKU }, { key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })],
          }),
        );
        expect(res.status).toBe(202);
        const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
        expect(issues.some((i) => /only accepted finish keys are fabric, powder_coat, frame/.test(i.message))).toBe(true);
        expect(h.send).not.toHaveBeenCalled();
      },
    );

    it("a missing required fabric quarantines; a pricing-only key like fabric_grade is ignored", async () => {
      const noFabric = await post(
        wooOrder({ line_items: [wooLine({ meta_data: [{ key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })] }),
      );
      expect(noFabric.status).toBe(202);
      expect(h.quarantineOnce).toHaveBeenCalledTimes(1);

      h.quarantineOnce.mockClear();
      const ok = await post(
        wooOrder({
          line_items: [wooLine({ meta_data: [{ key: "fabric_grade", value: "B" }, { key: "fabric", value: FAB_SKU }, { key: "powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })],
        }),
        { delivery: "d-ok" },
      );
      expect(ok.status).toBe(202);
      expect(h.quarantineOnce).not.toHaveBeenCalled();
      expect(h.send).toHaveBeenCalledTimes(1);
    });

    it("Woo attribute prefixes (pa_, attribute_) are normalized for the three accepted keys", async () => {
      const res = await post(
        wooOrder({
          line_items: [wooLine({ meta_data: [{ key: "pa_fabric", value: "fab-sun-123" }, { key: "attribute_pa_powder_coat", value: "PWD-BLK" }, { key: "frame", value: "MET-ALUM" }] })],
        }),
      );
      expect(res.status).toBe(202);
      expect(h.send).toHaveBeenCalledTimes(1);
    });
  });

  it("a redelivery of an invalid order refreshes the row and does NOT re-alert", async () => {
    h.quarantineOnce.mockResolvedValue("unchanged");
    const res = await post(wooOrder({ line_items: [wooLine({ sku: "NOT-A-SKU" })] }));
    expect(res.status).toBe(202);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("a structurally invalid payload with no readable order id quarantines under the delivery key", async () => {
    const res = await post({ status: "processing", line_items: [] }, { delivery: "abc" });
    expect(res.status).toBe(202);
    expect(h.quarantineOnce).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "woo-delivery:abc", status: "pending_review" }),
    );
  });

  it("a quarantine persistence failure is a 500 (so Woo redelivers) and sends no alert", async () => {
    h.quarantineOnce.mockRejectedValue(new Error("db down"));
    const res = await post(wooOrder({ line_items: [wooLine({ sku: "NOT-A-SKU" })] }));
    expect(res.status).toBe(500);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("a hub lookup failure is a 500 (retryable), never a quarantine and never a send", async () => {
    h.hub.lookupSkus = async () => {
      throw new Error("db down");
    };
    const res = await post(wooOrder());
    expect(res.status).toBe(500);
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("unpaid (pending / on-hold): 200 awaiting_payment and NO inngest.send", async () => {
    for (const status of ["pending", "on-hold", "checkout-draft"]) {
      const res = await post(wooOrder({ status, date_paid: null }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: true, awaiting_payment: true });
    }
    expect(h.send).not.toHaveBeenCalled();
  });

  it("an unpaid order with a bad finish is quarantined early (visible before the customer pays)", async () => {
    const res = await post(
      wooOrder({ status: "pending", date_paid: null, line_items: [wooLine({ meta_data: [] })] }),
    );
    expect(res.status).toBe(202);
    expect(h.quarantineOnce).toHaveBeenCalledTimes(1);
  });

  it("cancelled before payment is acknowledged without an event or an alert (not validated)", async () => {
    const res = await post(wooOrder({ status: "cancelled", date_paid: null, line_items: [wooLine({ sku: "GONE" })] }));
    expect(res.status).toBe(200);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.quarantineOnce).not.toHaveBeenCalled();
  });

  it("paid: sends woo.order.validated with id woo:order:<id>:paid, pins the baseline, resolves old review rows", async () => {
    const res = await post(wooOrder());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, orderId: 1042, pipelineMode: "log" });

    expect(h.send).toHaveBeenCalledTimes(1);
    const sent = h.send.mock.calls[0]![0] as { id: string; name: string; data: Record<string, unknown> };
    expect(sent.id).toBe("woo:order:1042:paid");
    expect(sent.name).toBe("woo.order.validated");
    expect(sent.data.id).toBe(1042);
    expect(sent.data._cc_delivery_key).toBe("woo-delivery:delivery-1");

    const baseline = h.log.rows.get(wooBaselineKey(1042));
    expect(baseline?.status).toBe("processed");
    expect(baseline?.payload).toMatchObject({ orderId: "1042", deliveryKey: "woo-delivery:delivery-1" });
    expect(h.resolvePending).toHaveBeenCalledWith("1042");
  });

  it("paid in live mode reports pipelineMode live; the route itself still never mutates anything", async () => {
    vi.stubEnv("ORDER_PIPELINE_MODE", " LIVE ");
    const res = await post(wooOrder());
    expect(await res.json()).toMatchObject({ pipelineMode: "live" });
  });

  it("order.created then a routine order.updated: the update is acknowledged WITHOUT a second send", async () => {
    await post(wooOrder(), { topic: "order.created", delivery: "d-a" });
    const res = await post(wooOrder({ status: "completed" }), { topic: "order.updated", delivery: "d-b" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, unchanged: true });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.log.rows.get("woo-delivery:d-b")?.status).toBe("processed");
  });

  it("the SAME delivery redelivered still re-sends (Inngest dedupes by event id)", async () => {
    await post(wooOrder());
    const res = await post(wooOrder());
    expect(res.status).toBe(202);
    expect(h.send).toHaveBeenCalledTimes(2);
    const ids = h.send.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(ids).toEqual(["woo:order:1042:paid", "woo:order:1042:paid"]);
  });

  it("a DUPLICATE audit row still sends (re-sending is free; skipping would lose the order)", async () => {
    await h.log.insertOnce({
      source: "woocommerce",
      eventName: "order.updated",
      idempotencyKey: "woo-delivery:delivery-1",
      payload: {},
      status: "received",
    });
    const res = await post(wooOrder());
    expect(res.status).toBe(202);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("inngest.send failure: 500, audit row marked failed, baseline NOT pinned (next delivery sends)", async () => {
    h.send.mockRejectedValueOnce(new Error("inngest unreachable"));
    const res = await post(wooOrder());
    expect(res.status).toBe(500);
    expect(h.log.rows.get("woo-delivery:delivery-1")?.status).toBe("failed");
    expect(h.log.rows.get(wooBaselineKey(1042))?.status).toBe("received");

    const retry = await post(wooOrder(), { delivery: "delivery-2" });
    expect(retry.status).toBe(202);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("a baseline pin failure after a successful send is a 500 (Woo redelivers and re-pins)", async () => {
    const original = h.log.set;
    h.log.set = async () => {
      throw new Error("db down");
    };
    const res = await post(wooOrder());
    h.log.set = original;
    expect(res.status).toBe(500);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a failing quarantine auto-resolve is logged loudly and does not change the 202", async () => {
    h.resolvePending.mockRejectedValue(new Error("db down"));
    const res = await post(wooOrder());
    expect(res.status).toBe(202);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("woo-quarantine-autoresolve-failed"),
    );
  });

  it("audit persistence failure is a 500 and nothing is sent", async () => {
    h.log.insertOnce = async () => {
      throw new Error("db down");
    };
    const res = await post(wooOrder());
    expect(res.status).toBe(500);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("paid order later cancelled/refunded: alert, 200, NO send, never a delete", async () => {
    for (const status of ["cancelled", "refunded"]) {
      h.alert.mockClear();
      const res = await post(wooOrder({ status }), { delivery: `d-${status}` });
      expect(res.status).toBe(200);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.alert).toHaveBeenCalledTimes(1);
      const alert = h.alert.mock.calls[0]![0] as { source: string; message: string };
      expect(alert.source).toBe("woocommerce");
      expect(alert.message).toContain(`paid order changed to ${status}`);
      expect(alert.message).toContain("Katana order NOT touched");
    }
  });

  it("cancelled with no date_paid but an existing saga is treated as post-paid (human case)", async () => {
    h.sagaGet.mockResolvedValue({ status: "IN_PROGRESS" });
    const res = await post(wooOrder({ status: "cancelled", date_paid: null }));
    expect(res.status).toBe(200);
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a redelivered post-paid cancel does not alert twice (audit row already exists)", async () => {
    await post(wooOrder({ status: "cancelled" }));
    h.alert.mockClear();
    const res = await post(wooOrder({ status: "cancelled" }));
    expect(res.status).toBe(200);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("an undeliverable alert never turns a persisted delivery into a non-2xx", async () => {
    h.alert.mockResolvedValue({ ok: false, error: "no OH_CRAP_ADMIN_EMAIL" });
    const res = await post(wooOrder({ line_items: [wooLine({ sku: "NOT-A-SKU" })] }));
    expect(res.status).toBe(202);
  });
});
