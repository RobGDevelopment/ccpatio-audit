import { describe, expect, it } from "vitest";
import { matchesFunctionId, resolveDlqContext } from "@/inngest/dlq-context";
import { handleFunctionFailed, type DlqDeps } from "@/inngest/dlq";

/**
 * Frozen copies of what the OLD per-function onFailure hooks sent to `sendOhCrapAlert`
 * (src/inngest/functions.ts before Phase 10). The resolver must reproduce them exactly so
 * removing the hooks (D4) loses no context.
 */
function oldPublishHook(original: { data?: Record<string, unknown> } | undefined, runId: string) {
  const globalSku = String(original?.data?.globalSku ?? "");
  const exportId = String(original?.data?.exportId ?? "");
  return {
    externalId: exportId || globalSku || runId,
    sku: globalSku || undefined,
    resolutionPath: globalSku
      ? `/admin/quarantine?sku=${encodeURIComponent(globalSku)}`
      : "/admin/quarantine",
  };
}

function oldCadHook(original: { data?: Record<string, unknown> } | undefined, runId: string) {
  const globalSku = String(original?.data?.globalSku ?? "");
  const uploadId = String(original?.data?.uploadId ?? "");
  return {
    externalId: uploadId || globalSku || runId,
    sku: globalSku || undefined,
    resolutionPath: globalSku
      ? `/admin/factory-bom?sku=${encodeURIComponent(globalSku)}`
      : "/admin/factory-bom",
  };
}

function oldWooHook(data: { id?: unknown; line_items?: Array<{ sku?: unknown }> } | undefined) {
  const first = data?.line_items?.[0]?.sku;
  const sku = typeof first === "string" && first.trim() ? first.trim() : undefined;
  const externalId = String(data?.id ?? "unknown");
  return {
    externalId,
    sku,
    resolutionPath: sku
      ? `/admin/dictionary?sku=${encodeURIComponent(sku)}`
      : `/admin/dictionary?source=woocommerce&externalId=${encodeURIComponent(externalId)}`,
  };
}

const APP = "ccpatio-middleware-";

describe("matchesFunctionId", () => {
  it("matches the bare and app-prefixed id, and nothing that merely contains it", () => {
    expect(matchesFunctionId("publish-approved-product", "publish-approved-product")).toBe(true);
    expect(matchesFunctionId(`${APP}publish-approved-product`, "publish-approved-product")).toBe(true);
    expect(matchesFunctionId(`${APP}publish-approved-product-failure`, "publish-approved-product")).toBe(false);
    expect(matchesFunctionId("xpublish-approved-product", "publish-approved-product")).toBe(false);
    expect(matchesFunctionId("", "publish-approved-product")).toBe(false);
    expect(matchesFunctionId(undefined, "publish-approved-product")).toBe(false);
  });
});

describe("resolveDlqContext matches the old onFailure hooks (D4: no context lost)", () => {
  const RUN = "run-xyz";

  it.each([
    [{ data: { globalSku: "ABC", exportId: "exp-1" } }],
    [{ data: { globalSku: "ABC" } }],
    [{ data: { exportId: "exp-2" } }],
    [{ data: {} }],
    [{ data: { globalSku: "A B&C" } }],
    [undefined],
  ])("publish-approved-product %j", (original) => {
    for (const id of ["publish-approved-product", `${APP}publish-approved-product`]) {
      const got = resolveDlqContext(id, original);
      const old = oldPublishHook(original, RUN);
      expect(got.externalId ?? RUN).toBe(old.externalId);
      expect(got.sku).toBe(old.sku);
      expect(got.resolutionPath).toBe(old.resolutionPath);
      expect(got.source).toBe("system");
    }
  });

  it.each([
    [{ data: { globalSku: "FIN-1", uploadId: "up-1" } }],
    [{ data: { globalSku: "FIN-1" } }],
    [{ data: { uploadId: "up-2" } }],
    [{ data: {} }],
    [undefined],
  ])("process-cad-upload %j", (original) => {
    const got = resolveDlqContext(`${APP}process-cad-upload`, original);
    const old = oldCadHook(original, RUN);
    expect(got.externalId ?? RUN).toBe(old.externalId);
    expect(got.sku).toBe(old.sku);
    expect(got.resolutionPath).toBe(old.resolutionPath);
    expect(got.source).toBe("system");
  });

  it.each([
    [{ id: 981, line_items: [{ sku: "FIN-ABC" }] }],
    [{ id: 981, line_items: [{ sku: "  FIN-ABC  " }] }],
    [{ id: 981, line_items: [{ sku: "" }] }],
    [{ id: 981, line_items: [] }],
    [{ id: 981 }],
    [{}],
  ])("process-woocommerce-order %j", (orderData) => {
    const got = resolveDlqContext(`${APP}process-woocommerce-order`, { name: "woo.order.validated", data: orderData });
    const old = oldWooHook(orderData);
    expect(got.externalId).toBe(old.externalId);
    expect(got.sku).toBe(old.sku);
    expect(got.resolutionPath).toBe(old.resolutionPath);
    expect(got.source).toBe("woocommerce");
  });

  it("a Woo order with no SKU resolves to the Woo-specific dictionary link", () => {
    const got = resolveDlqContext("process-woocommerce-order", { data: { id: 55 } });
    expect(got.resolutionPath).toBe("/admin/dictionary?source=woocommerce&externalId=55");
    expect(got.externalId).toBe("55");
  });

  it("an unknown function resolves to nothing (generic alert)", () => {
    expect(resolveDlqContext(`${APP}something-else`, { data: { globalSku: "X" } })).toEqual({});
    expect(resolveDlqContext(undefined, { data: {} })).toEqual({});
    expect(resolveDlqContext(`${APP}process-woocommerce-order-failure`, { data: { id: 1 } })).toEqual({});
  });
});

describe("resolveDlqContext never throws", () => {
  const garbage: unknown[] = [
    null,
    undefined,
    42,
    "str",
    [],
    [1, 2],
    { data: null },
    { data: "x" },
    { data: [] },
    { data: { globalSku: { toString: () => { throw new Error("boom"); } } } },
    { data: { id: Symbol("s") } },
    { data: { line_items: "nope" } },
    { data: { line_items: [null] } },
    { data: { line_items: [{ sku: 5 }] } },
  ];
  const fns = [
    "publish-approved-product",
    "process-cad-upload",
    "process-woocommerce-order",
    "path-a-release-to-production",
    "path-a-ghl-sync",
    "other",
    "",
    undefined,
    null,
  ];

  it("resolves path-a-release-to-production DLQ context", () => {
    const got = resolveDlqContext("path-a-release-to-production", {
      data: { ghlOpportunityId: "opp-123" },
    });
    expect(got.externalId).toBe("opp-123");
    expect(got.resolutionPath).toBe("/admin/path-a?opp=opp-123");
    expect(got.source).toBe("katana");

    const appPrefixed = resolveDlqContext(`${APP}path-a-release-to-production`, {
      data: { ghlOpportunityId: "opp-456" },
    });
    expect(appPrefixed.externalId).toBe("opp-456");
    expect(appPrefixed.resolutionPath).toBe("/admin/path-a?opp=opp-456");
  });

  it("resolves path-a-ghl-sync DLQ context", () => {
    const got = resolveDlqContext("path-a-ghl-sync", {
      data: { ghlOpportunityId: "opp-789" },
    });
    expect(got.externalId).toBe("opp-789");
    expect(got.resolutionPath).toBe("/admin/path-a?opp=opp-789");
    expect(got.source).toBe("ghl");
  });

  it.each(garbage.map((g, i) => [i, g] as const))("garbage payload #%i", (_i, payload) => {
    for (const fn of fns) {
      expect(() => resolveDlqContext(fn as never, payload)).not.toThrow();
    }
  });

  it("degrades to the generic alert instead of failing the DLQ handler", async () => {
    const alerts: unknown[] = [];
    const deps: DlqDeps = {
      record: async () => true,
      isAlertSent: async () => false,
      markAlertSent: async () => undefined,
      alert: async (input) => {
        alerts.push(input);
        return { ok: true, emailed: true, resolutionUrl: "u" };
      },
    };
    const out = await handleFunctionFailed(
      {
        function_id: `${APP}process-woocommerce-order`,
        run_id: "run-garbage",
        error: { message: "m" },
        event: { data: { id: { toString: () => { throw new Error("boom"); } } } },
      },
      deps,
    );
    expect(out).toMatchObject({ status: "recorded", alerted: true });
    expect(alerts).toHaveLength(1);
  });
});
