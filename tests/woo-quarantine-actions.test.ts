import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeHub, makeIncomingLogFake, wooLine, wooOrder } from "./helpers/woo-fakes";

/** /admin/quarantine Server Actions for Woo orders (operator decision D10). */
const h = vi.hoisted(() => ({
  send: vi.fn(),
  sagaGet: vi.fn(),
  revalidate: vi.fn(),
  pimAudit: vi.fn(),
  getRow: vi.fn(),
  transition: vi.fn(),
  updateIssues: vi.fn(),
  log: null as unknown as ReturnType<typeof import("./helpers/woo-fakes").makeIncomingLogFake>,
  hub: null as unknown as ReturnType<typeof import("./helpers/woo-fakes").makeHub>,
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/inngest/client", () => ({ inngest: { send: h.send } }));
vi.mock("@/lib/pim-audit", () => ({
  resolvePimOperator: async () => ({ email: "ops@ccpatio.com", label: "ops@ccpatio.com" }),
  logPimAudit: h.pimAudit,
}));
vi.mock("@/server/sre/saga-store", () => ({ sagaStore: { get: h.sagaGet } }));
vi.mock("@/server/db/client", () => ({
  getDb: () => {
    throw new Error("the database must not be touched in this unit test");
  },
}));
vi.mock("@/server/webhooks/incoming-log", () => ({
  insertIncomingWebhookOnce: (input: Parameters<typeof h.log.insertOnce>[0]) => h.log.insertOnce(input),
  getIncomingWebhook: (key: string) => h.log.get(key),
  setIncomingWebhookPayload: (key: string, status: "received" | "processed" | "failed", payload: unknown) =>
    h.log.set(key, status, payload),
  updateIncomingWebhookStatus: (key: string, status: "processed" | "failed") => h.log.updateStatus(key, status),
}));
vi.mock("@/server/woocommerce/quarantine-store", () => ({
  getWooQuarantineRow: h.getRow,
  transitionWooQuarantine: h.transition,
  updatePendingIssues: h.updateIssues,
}));
vi.mock("@/server/woocommerce/sku-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/woocommerce/sku-resolver")>()),
  hubResolveDeps: () => h.hub,
}));

import {
  acknowledgeWooPostPaymentEdit,
  discardWooQuarantine,
  replayWooQuarantinedOrder,
} from "@/app/admin/quarantine/woo-actions";
import { wooBaselineKey } from "@/server/woocommerce/paid-baseline";

function row(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    externalId: "1042",
    status: "pending_review",
    rawPayload: wooOrder(),
    issues: [{ path: "line_items.0.sku", message: "SKU X is not in the hub (sku_mappings)." }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  h.log = makeIncomingLogFake();
  h.hub = makeHub();
  h.send.mockReset().mockResolvedValue({ ids: ["x"] });
  h.sagaGet.mockReset().mockResolvedValue(null);
  h.revalidate.mockReset();
  h.pimAudit.mockReset().mockResolvedValue(undefined);
  h.getRow.mockReset().mockResolvedValue(row());
  h.transition.mockReset().mockResolvedValue(true);
  h.updateIssues.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("replayWooQuarantinedOrder", () => {
  it("re-validates against the hub, enqueues the paid event, pins the baseline, closes the row, audits", async () => {
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toEqual({ ok: true, message: "Order 1042 validated and queued." });

    expect(h.send).toHaveBeenCalledTimes(1);
    const sent = h.send.mock.calls[0]![0] as { id: string; name: string; data: Record<string, unknown> };
    expect(sent.id).toBe("woo:order:1042:paid");
    expect(sent.name).toBe("woo.order.validated");
    expect(sent.data._cc_delivery_key).toBe("woo-replay:9");

    expect(h.log.rows.get("woo-replay:9")?.status).toBe("received");
    expect(h.log.rows.get(wooBaselineKey(1042))?.status).toBe("processed");
    expect(h.transition).toHaveBeenCalledWith({ id: 9, from: "pending_review", to: "resolved" });
    expect(h.pimAudit).toHaveBeenCalledWith(
      expect.objectContaining({ operatorEmail: "ops@ccpatio.com", action: "woo_quarantine_replay" }),
    );
    expect(h.revalidate).toHaveBeenCalledWith("/admin/quarantine");
  });

  it("a double click is idempotent (same delivery key, same Inngest event id)", async () => {
    await replayWooQuarantinedOrder(9);
    const again = await replayWooQuarantinedOrder(9);
    expect(again.ok).toBe(true);
    const ids = h.send.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
  });

  it("refuses an unknown row, and a row that is not pending_review", async () => {
    h.getRow.mockResolvedValue(null);
    expect(await replayWooQuarantinedOrder(9)).toMatchObject({ ok: false, code: "not_found" });
    h.getRow.mockResolvedValue(row({ status: "post_payment_edit" }));
    expect(await replayWooQuarantinedOrder(9)).toMatchObject({ ok: false, code: "conflict" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses an unpaid order", async () => {
    h.getRow.mockResolvedValue(row({ rawPayload: wooOrder({ status: "pending", date_paid: null }) }));
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses when a saga run already exists for the order", async () => {
    h.sagaGet.mockResolvedValue({ status: "COMPLETED" });
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toMatchObject({ ok: false, code: "conflict", error: expect.stringContaining("already has a saga") });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses when a webhook delivery already enqueued the order", async () => {
    await h.log.insertOnce({
      source: "woocommerce",
      eventName: "baseline:order.updated",
      idempotencyKey: wooBaselineKey(1042),
      payload: { orderId: "1042", deliveryKey: "woo-delivery:w1", fingerprint: "anything" },
      status: "processed",
    });
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toMatchObject({ ok: false, code: "conflict" });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
  });

  it("a still-invalid order stays pending with refreshed issues and sends nothing", async () => {
    h.hub.records.delete("FIN-TST-CHA-001");
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toMatchObject({ ok: false, code: "validation" });
    expect(result.ok === false && result.issues?.length).toBeGreaterThan(0);
    expect(h.updateIssues).toHaveBeenCalledWith(9, expect.any(Array));
    expect(h.send).not.toHaveBeenCalled();
    expect(h.transition).not.toHaveBeenCalled();
  });

  it("a structurally invalid stored payload cannot be replayed", async () => {
    h.getRow.mockResolvedValue(row({ rawPayload: { id: 1, line_items: [] } }));
    expect(await replayWooQuarantinedOrder(9)).toMatchObject({ ok: false, code: "validation" });
  });

  it("an enqueue failure is returned as a structured error and the row stays pending", async () => {
    h.send.mockRejectedValue(new Error("inngest unreachable"));
    const result = await replayWooQuarantinedOrder(9);
    expect(result).toEqual({ ok: false, code: "failed", error: "Replay failed: inngest unreachable" });
    expect(h.transition).not.toHaveBeenCalled();
  });

  it("a hub failure is returned as a structured error, not thrown to the client", async () => {
    h.hub.lookupSkus = async () => {
      throw new Error("db down");
    };
    expect(await replayWooQuarantinedOrder(9)).toMatchObject({ ok: false, code: "failed" });
  });

  it("replays a corrected order (fabric fixed) end to end", async () => {
    h.getRow.mockResolvedValue(
      row({ rawPayload: wooOrder({ line_items: [wooLine({ quantity: 1 })] }) }),
    );
    expect((await replayWooQuarantinedOrder(9)).ok).toBe(true);
  });
});

describe("acknowledgeWooPostPaymentEdit", () => {
  it("closes a post_payment_edit row and audits", async () => {
    h.getRow.mockResolvedValue(row({ status: "post_payment_edit" }));
    const result = await acknowledgeWooPostPaymentEdit(9);
    expect(result).toEqual({ ok: true, message: "Edit on order 1042 acknowledged." });
    expect(h.transition).toHaveBeenCalledWith({ id: 9, from: "post_payment_edit", to: "resolved" });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses a pending_review row and a row already handled", async () => {
    expect(await acknowledgeWooPostPaymentEdit(9)).toMatchObject({ ok: false, code: "conflict" });
    h.getRow.mockResolvedValue(row({ status: "post_payment_edit" }));
    h.transition.mockResolvedValue(false);
    expect(await acknowledgeWooPostPaymentEdit(9)).toMatchObject({ ok: false, code: "conflict" });
  });
});

describe("discardWooQuarantine", () => {
  it("requires a reason", async () => {
    expect(await discardWooQuarantine(9, "   ")).toMatchObject({ ok: false, code: "validation" });
    expect(h.transition).not.toHaveBeenCalled();
  });

  it("discards either status, recording who and why in the issues", async () => {
    for (const status of ["pending_review", "post_payment_edit"] as const) {
      h.transition.mockClear();
      h.getRow.mockResolvedValue(row({ status }));
      const result = await discardWooQuarantine(9, "duplicate test order");
      expect(result.ok).toBe(true);
      const call = h.transition.mock.calls[0]![0] as { from: string; to: string; issues: Array<{ path: string; message: string }> };
      expect(call).toMatchObject({ id: 9, from: status, to: "discarded" });
      expect(call.issues.at(-1)).toEqual({
        path: "(resolution)",
        message: "Discarded by ops@ccpatio.com: duplicate test order",
      });
    }
  });

  it("refuses a row that is already resolved", async () => {
    h.getRow.mockResolvedValue(row({ status: "resolved" }));
    expect(await discardWooQuarantine(9, "x")).toMatchObject({ ok: false, code: "conflict" });
  });
});
