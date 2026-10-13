import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route contract for POST /api/webhooks/woocommerce (roadmap step 6).
 * Everything with I/O is mocked: no database, no Inngest, no email. The route must make zero
 * Katana / QBO / Clover calls (it imports none of them).
 */
const SECRET = "test-woo-secret";
const VALID_SKU = "FIN-ACC-BAS-THU-JAN-16-2025-11";

const hoisted = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    send: vi.fn(),
    alert: vi.fn(),
    insertOnce: vi.fn(),
    updateStatus: vi.fn(),
    sagaGet: vi.fn(),
    quarantine: {
      existing: [] as Array<{ id: number }>,
      inserted: [] as Array<Record<string, unknown>>,
      updated: [] as Array<Record<string, unknown>>,
      failInsert: false,
    },
  };
});

vi.mock("@/inngest/client", () => ({ inngest: { send: hoisted.send } }));
vi.mock("@/server/alerts/oh-crap", () => ({ sendOhCrapAlert: hoisted.alert }));
vi.mock("@/server/webhooks/incoming-log", () => ({
  insertIncomingWebhookOnce: hoisted.insertOnce,
  updateIncomingWebhookStatus: hoisted.updateStatus,
}));
vi.mock("@/server/sre/saga-store", () => ({ sagaStore: { get: hoisted.sagaGet } }));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            hoisted.calls.push("quarantine:select");
            return hoisted.quarantine.existing;
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          hoisted.calls.push("quarantine:update");
          hoisted.quarantine.updated.push(values);
        },
      }),
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        hoisted.calls.push("quarantine:insert");
        if (hoisted.quarantine.failInsert) throw new Error("db down");
        hoisted.quarantine.inserted.push(values);
      },
    }),
  }),
}));

import { POST } from "@/app/api/webhooks/woocommerce/route";

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 1042,
    number: "1042",
    status: "processing",
    currency: "USD",
    date_paid: "2026-10-13T12:00:00",
    line_items: [{ id: 1, name: "Sofa", product_id: 7, quantity: 1, sku: VALID_SKU }],
    ...overrides,
  };
}

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

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.quarantine.existing = [];
  hoisted.quarantine.inserted = [];
  hoisted.quarantine.updated = [];
  hoisted.quarantine.failInsert = false;
  hoisted.send.mockReset().mockResolvedValue({ ids: ["x"] });
  hoisted.alert.mockReset().mockImplementation(async () => {
    hoisted.calls.push("alert");
    return { ok: true, emailed: true, resolutionUrl: "http://x" };
  });
  hoisted.insertOnce.mockReset().mockResolvedValue("inserted");
  hoisted.updateStatus.mockReset().mockResolvedValue(undefined);
  hoisted.sagaGet.mockReset().mockResolvedValue(null);
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
      const res = await POST(request(JSON.stringify(order())));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "webhook_not_configured" });
    }
    expect(hoisted.send).not.toHaveBeenCalled();
    expect(hoisted.insertOnce).not.toHaveBeenCalled();
  });

  it("401 invalid_signature for wrong secret, tampered body, missing header, hex digest", async () => {
    const body = JSON.stringify(order());
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
    expect(hoisted.send).not.toHaveBeenCalled();
    expect(hoisted.insertOnce).not.toHaveBeenCalled();
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
      const res = await POST(request(JSON.stringify(order()), { topic }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true, reason: "topic" });
    }
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it("invalid SKU: 202 quarantined (NOT 400), quarantine insert happens BEFORE the alert", async () => {
    const bad = order({ line_items: [{ name: "Sofa", product_id: 7, quantity: 1, sku: "NOT-A-SKU" }] });
    const res = await POST(request(JSON.stringify(bad)));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, quarantined: true });

    expect(hoisted.calls).toEqual(["quarantine:select", "quarantine:insert", "alert"]);
    expect(hoisted.quarantine.inserted[0]).toMatchObject({ source: "woocommerce", external_id: "1042" });
    expect(hoisted.alert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "validation_failed", source: "woocommerce", externalId: "1042" }),
    );
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it("invalid order redelivery refreshes the pending_review row instead of piling up and does not re-alert", async () => {
    hoisted.quarantine.existing = [{ id: 9 }];
    const bad = order({ line_items: [{ name: "Sofa", product_id: 7, quantity: 1, sku: "NOT-A-SKU" }] });
    const res = await POST(request(JSON.stringify(bad)));
    expect(res.status).toBe(202);
    expect(hoisted.calls).toEqual(["quarantine:select", "quarantine:update"]);
    expect(hoisted.alert).not.toHaveBeenCalled();
  });

  it("invalid payload with no readable order id quarantines under the delivery key", async () => {
    const res = await POST(request(JSON.stringify({ status: "processing", line_items: [] }), { delivery: "abc" }));
    expect(res.status).toBe(202);
    expect(hoisted.quarantine.inserted[0]).toMatchObject({ external_id: "woo-delivery:abc" });
  });

  it("a quarantine persistence failure is a 500 (so Woo redelivers) and sends no alert", async () => {
    hoisted.quarantine.failInsert = true;
    const bad = order({ line_items: [{ name: "Sofa", product_id: 7, quantity: 1, sku: "NOT-A-SKU" }] });
    const res = await POST(request(JSON.stringify(bad)));
    expect(res.status).toBe(500);
    expect(hoisted.alert).not.toHaveBeenCalled();
  });

  it("unpaid (pending / on-hold): 200 awaiting_payment and NO inngest.send", async () => {
    for (const status of ["pending", "on-hold", "checkout-draft"]) {
      const res = await POST(request(JSON.stringify(order({ status, date_paid: null }))));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ accepted: true, awaiting_payment: true });
    }
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it("cancelled before payment is acknowledged without an event or an alert", async () => {
    const res = await POST(request(JSON.stringify(order({ status: "cancelled", date_paid: null }))));
    expect(res.status).toBe(200);
    expect(hoisted.send).not.toHaveBeenCalled();
    expect(hoisted.alert).not.toHaveBeenCalled();
  });

  it("paid: sends woo.order.validated with id woo:order:<id>:paid and 202 with the pipeline mode (default log)", async () => {
    const res = await POST(request(JSON.stringify(order())));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, orderId: 1042, pipelineMode: "log" });

    expect(hoisted.send).toHaveBeenCalledTimes(1);
    const sent = hoisted.send.mock.calls[0]![0] as { id: string; name: string; data: Record<string, unknown> };
    expect(sent.id).toBe("woo:order:1042:paid");
    expect(sent.name).toBe("woo.order.validated");
    expect(sent.data.id).toBe(1042);
    expect(sent.data._cc_delivery_key).toBe("woo-delivery:delivery-1");
  });

  it("paid in live mode reports pipelineMode live; the route itself still never mutates anything", async () => {
    vi.stubEnv("ORDER_PIPELINE_MODE", " LIVE ");
    const res = await POST(request(JSON.stringify(order())));
    expect(await res.json()).toMatchObject({ pipelineMode: "live" });
  });

  it("order.created AND order.updated for one order use the same event id (Inngest dedupes)", async () => {
    await POST(request(JSON.stringify(order()), { topic: "order.created", delivery: "d-a" }));
    await POST(request(JSON.stringify(order()), { topic: "order.updated", delivery: "d-b" }));
    const ids = hoisted.send.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(ids).toEqual(["woo:order:1042:paid", "woo:order:1042:paid"]);
  });

  it("a DUPLICATE audit row still sends (re-sending is free; skipping would lose the order)", async () => {
    hoisted.insertOnce.mockResolvedValue("duplicate");
    const res = await POST(request(JSON.stringify(order())));
    expect(res.status).toBe(202);
    expect(hoisted.send).toHaveBeenCalledTimes(1);
  });

  it("inngest.send failure: 500, audit row marked failed with the error text", async () => {
    hoisted.send.mockRejectedValue(new Error("inngest unreachable"));
    const res = await POST(request(JSON.stringify(order())));
    expect(res.status).toBe(500);
    expect(hoisted.updateStatus).toHaveBeenCalledWith(
      "woo-delivery:delivery-1",
      "failed",
      expect.stringContaining("inngest unreachable"),
    );
  });

  it("audit persistence failure is a 500 and nothing is sent", async () => {
    hoisted.insertOnce.mockRejectedValue(new Error("db down"));
    const res = await POST(request(JSON.stringify(order())));
    expect(res.status).toBe(500);
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it("paid order later cancelled/refunded: alert, 200, NO send, never a delete", async () => {
    for (const status of ["cancelled", "refunded"]) {
      hoisted.alert.mockClear();
      const res = await POST(
        request(JSON.stringify(order({ status })), { delivery: `d-${status}` }),
      );
      expect(res.status).toBe(200);
      expect(hoisted.send).not.toHaveBeenCalled();
      expect(hoisted.alert).toHaveBeenCalledTimes(1);
      const alert = hoisted.alert.mock.calls[0]![0] as { source: string; message: string };
      expect(alert.source).toBe("woocommerce");
      expect(alert.message).toContain(`paid order changed to ${status}`);
      expect(alert.message).toContain("Katana order NOT touched");
    }
  });

  it("cancelled with no date_paid but an existing saga is treated as post-paid (human case)", async () => {
    hoisted.sagaGet.mockResolvedValue({ status: "IN_PROGRESS" });
    const res = await POST(request(JSON.stringify(order({ status: "cancelled", date_paid: null }))));
    expect(res.status).toBe(200);
    expect(hoisted.alert).toHaveBeenCalledTimes(1);
    expect(hoisted.send).not.toHaveBeenCalled();
  });

  it("a redelivered post-paid cancel does not alert twice (audit row already exists)", async () => {
    hoisted.insertOnce.mockResolvedValue("duplicate");
    const res = await POST(request(JSON.stringify(order({ status: "cancelled" }))));
    expect(res.status).toBe(200);
    expect(hoisted.alert).not.toHaveBeenCalled();
  });

  it("an undeliverable alert never turns a persisted delivery into a non-2xx", async () => {
    hoisted.alert.mockResolvedValue({ ok: false, error: "no OH_CRAP_ADMIN_EMAIL" });
    const bad = order({ line_items: [{ name: "Sofa", product_id: 7, quantity: 1, sku: "NOT-A-SKU" }] });
    const res = await POST(request(JSON.stringify(bad)));
    expect(res.status).toBe(202);
  });
});
