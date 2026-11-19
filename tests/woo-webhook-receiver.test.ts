import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_SKU,
  FAB_SKU,
  PWD_SKU,
  makeHub,
  makeIncomingLogFake,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";

/**
 * Phase 4 acceptance contract for POST /api/webhooks/woocommerce, written against the existing
 * route. Four scenarios: valid signed order with fabric / powder_coat metadata, invalid
 * signature, malformed or missing metadata, and a duplicate delivery id.
 *
 * Contract facts these tests pin (they are deliberate, not accidents):
 *   - An accepted paid order answers 202. WooCommerce treats every 2xx as delivered.
 *   - In `log` mode the order is recorded in the audit log (`incoming_webhooks`) and enqueued
 *     for a dry run. Valid orders never go to the quarantine table, which is the human review
 *     queue and alerts on every new row.
 *   - A redelivery is recorded once and re-sends the SAME Inngest event id, which Inngest dedupes.
 */
const SECRET = "phase4-acceptance-secret";
const DELIVERY = "wc-delivery-77";
/** A recipe that needs exactly the PrimeView contract keys: fabric and powder_coat, no frame. */
const CONTRACT_RECIPE = ["SA-TST-CHA-CUSH", "RM-FAB-GENERIC", "RM-PWD-GENERIC", "RM-TUBE-1"];

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
    throw new Error("the database must not be touched in the receiver acceptance test");
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

type SendArg = { id: string; name: string; data: { line_items: Array<{ meta_data: unknown }> } };

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function deliver(
  body: string,
  opts: { signature?: string | null; topic?: string; delivery?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "X-WC-Webhook-Topic": opts.topic ?? "order.created",
    "X-WC-Webhook-Delivery-ID": opts.delivery ?? DELIVERY,
  };
  const signature = opts.signature === undefined ? sign(body) : opts.signature;
  if (signature !== null) headers["X-WC-Webhook-Signature"] = signature;
  return POST(new Request("https://hub.ccpatio.com/api/webhooks/woocommerce", { method: "POST", body, headers }));
}

const deliverOrder = (order: unknown, opts: Parameters<typeof deliver>[1] = {}) =>
  deliver(JSON.stringify(order), opts);

const contractMeta = () => [
  { key: "fabric", value: FAB_SKU },
  { key: "powder_coat", value: PWD_SKU },
];

beforeEach(() => {
  h.log = makeIncomingLogFake();
  h.hub = makeHub({ recipes: new Map([[BASE_SKU, CONTRACT_RECIPE]]) });
  h.send.mockReset().mockResolvedValue({ ids: ["evt"] });
  h.alert.mockReset().mockResolvedValue({ ok: true, emailed: true, resolutionUrl: "http://x" });
  h.sagaGet.mockReset().mockResolvedValue(null);
  h.quarantineOnce.mockReset().mockResolvedValue("inserted");
  h.resolvePending.mockReset().mockResolvedValue(0);
  vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ORDER_PIPELINE_MODE", "log");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Phase 4 acceptance: valid signature + fabric / powder_coat metadata", () => {
  it.each(["order.created", "order.updated"])(
    "%s: 202 accepted in log mode, audit row holds the raw line-item metadata, nothing quarantined",
    async (topic) => {
      const order = wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] });
      const res = await deliverOrder(order, { topic });

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ accepted: true, orderId: 1042, pipelineMode: "log" });

      const audit = h.log.rows.get(`woo-delivery:${DELIVERY}`);
      expect(audit?.eventName).toBe(topic);
      expect(audit?.status).toBe("received");
      const logged = audit?.payload as { line_items: Array<{ sku: string; meta_data: unknown }> };
      expect(logged.line_items[0]!.sku).toBe(BASE_SKU);
      expect(logged.line_items[0]!.meta_data).toEqual(contractMeta());

      expect(h.quarantineOnce).not.toHaveBeenCalled();
      expect(h.alert).not.toHaveBeenCalled();
    },
  );

  it("the dry-run event carries the parsed fabric / powder_coat metadata under a deterministic id", async () => {
    await deliverOrder(wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] }));

    expect(h.send).toHaveBeenCalledTimes(1);
    const sent = h.send.mock.calls[0]![0] as SendArg;
    expect(sent.id).toBe("woo:order:1042:paid");
    expect(sent.name).toBe("woo.order.validated");
    expect(sent.data.line_items[0]!.meta_data).toEqual(contractMeta());
  });

  it("the route itself imports no Katana, QBO or Clover client (log mode cannot leak a write)", () => {
    const source = readFileSync("src/app/api/webhooks/woocommerce/route.ts", "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b|from\s+["']/.test(line));
    for (const line of imports) {
      expect(line).not.toMatch(/katana|qbo|quickbooks|clover/i);
    }
  });
});

describe("Phase 4 acceptance: invalid signature", () => {
  const body = JSON.stringify(wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] }));

  it.each([
    ["signed with another secret", sign(body, "not-the-secret")],
    ["signature of a different body", sign(`${body} `)],
    ["hex digest instead of base64", createHmac("sha256", SECRET).update(body, "utf8").digest("hex")],
    ["empty header", ""],
    ["missing header", null],
  ])("%s: 401 and nothing is recorded, quarantined or sent", async (_label, signature) => {
    const res = await deliver(body, { signature });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(h.log.rows.size).toBe(0);
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("Phase 4 acceptance: malformed or missing metadata is handled gracefully", () => {
  it.each([
    ["no meta_data at all", { meta_data: undefined }],
    ["meta_data is not an array", { meta_data: "fabric=FAB-SUN-123" }],
    ["fabric key missing", { meta_data: [{ key: "powder_coat", value: PWD_SKU }] }],
    ["powder_coat key missing", { meta_data: [{ key: "fabric", value: FAB_SKU }] }],
    ["fabric value is an object", { meta_data: [{ key: "fabric", value: { sku: FAB_SKU } }, { key: "powder_coat", value: PWD_SKU }] }],
    ["fabric value is empty", { meta_data: [{ key: "fabric", value: "" }, { key: "powder_coat", value: PWD_SKU }] }],
    ["fabric value is a powder-coat SKU", { meta_data: [{ key: "fabric", value: PWD_SKU }, { key: "powder_coat", value: PWD_SKU }] }],
    ["fabric SKU unknown to the hub", { meta_data: [{ key: "fabric", value: "FAB-DOES-NOT-EXIST" }, { key: "powder_coat", value: PWD_SKU }] }],
    ["near-miss key powder-coat", { meta_data: [{ key: "fabric", value: FAB_SKU }, { key: "powder-coat", value: PWD_SKU }] }],
  ])("%s: 202 quarantined for review, never a 4xx/5xx, nothing enqueued", async (_label, lineOverrides) => {
    const res = await deliverOrder(wooOrder({ line_items: [wooLine(lineOverrides)] }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, quarantined: true });
    expect(h.quarantineOnce).toHaveBeenCalledTimes(1);
    expect(h.quarantineOnce.mock.calls[0]![0]).toMatchObject({ externalId: "1042", status: "pending_review" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a product whose recipe needs no finish is accepted without fabric / powder_coat keys", async () => {
    h.hub = makeHub({ recipes: new Map([[BASE_SKU, ["SA-TST-CHA-CUSH", "RM-TUBE-1"]]]) });

    const res = await deliverOrder(wooOrder({ line_items: [wooLine({ meta_data: [] })] }));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, pipelineMode: "log" });
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a recipe with a FRAME component defaults omitted frame_material to MET-ALUM (Aluminum-only storefront)", async () => {
    h.hub = makeHub({ recipes: new Map([[BASE_SKU, ["SA-TST-CHA-FRAME", ...CONTRACT_RECIPE]]]) });

    const res = await deliverOrder(wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] }));

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, pipelineMode: "log" });
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("explicit Steel / MET-STEEL on a framed Make recipe is quarantined as steel_discontinued_on_ecommerce", async () => {
    h.hub = makeHub({ recipes: new Map([[BASE_SKU, ["SA-TST-CHA-FRAME", ...CONTRACT_RECIPE]]]) });

    const res = await deliverOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              ...contractMeta(),
              { key: "frame_material", value: "MET-STEEL" },
            ],
          }),
        ],
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, quarantined: true });
    const issues = h.quarantineOnce.mock.calls[0]![0].issues as Array<{ message: string }>;
    expect(issues.some((i) => i.message.includes("steel_discontinued_on_ecommerce"))).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("unrelated metadata keys are ignored, not treated as finishes", async () => {
    const meta = [
      { key: "_reduced_stock", value: "2" },
      { key: "fabric_grade", value: "B" },
      ...contractMeta(),
    ];

    const res = await deliverOrder(wooOrder({ line_items: [wooLine({ meta_data: meta })] }));

    expect(res.status).toBe(202);
    expect(h.quarantineOnce).not.toHaveBeenCalled();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 4 acceptance: duplicate webhook delivery id", () => {
  it("the same delivery twice: both 2xx, one audit row, one Inngest event id (deduped downstream)", async () => {
    const order = wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] });

    const first = await deliverOrder(order);
    const second = await deliverOrder(order);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect([...h.log.rows.keys()].filter((k) => k === `woo-delivery:${DELIVERY}`)).toHaveLength(1);
    const ids = h.send.mock.calls.map((call) => (call[0] as SendArg).id);
    expect(new Set(ids)).toEqual(new Set(["woo:order:1042:paid"]));
    expect(h.quarantineOnce).not.toHaveBeenCalled();
  });

  it("a later routine update of the same paid order is acknowledged 200 without a second event", async () => {
    const order = wooOrder({ line_items: [wooLine({ meta_data: contractMeta() })] });
    await deliverOrder(order, { topic: "order.created", delivery: "d-1" });

    const res = await deliverOrder({ ...order, status: "completed" }, { topic: "order.updated", delivery: "d-2" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, unchanged: true });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a duplicate of an invalid order refreshes its review row without a second alert", async () => {
    const bad = wooOrder({ line_items: [wooLine({ meta_data: [] })] });
    await deliverOrder(bad);
    h.quarantineOnce.mockResolvedValue("unchanged");

    const res = await deliverOrder(bad);

    expect(res.status).toBe(202);
    expect(h.alert).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});
