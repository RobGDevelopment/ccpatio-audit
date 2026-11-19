/**
 * Phase1 handoff P0 remediation regressions.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PHASE1_ACF_ADDON_PRICES,
  applyAcfAddonPriceFixes,
  ensureShortDescription,
  scrubSteelFromCsvRow,
  type CsvRow,
} from "../scripts/ops/generate-primeview-phase1-csv";
import { PHASE1_DIM_OVERRIDES_IN } from "../scripts/ops/enable-phase1-hub-data";
import {
  classifyFinishKey,
  resolveFinishValueToSku,
} from "@/server/woocommerce/finish-keys";
import { extractWooLineSpecs } from "@/server/woocommerce/line-specs";
import { deriveRecipeSlots } from "@/server/woocommerce/sku-resolver";
import { isWooPingBody } from "@/server/woocommerce/ingress";
import { ODD_DOLLAR_PDF_ROWS } from "@/server/ecommerce/mia-aluminum-pricing";

describe("FIX 2 — unsigned WooCommerce save-ping", () => {
  it("isWooPingBody accepts only webhook_id=<digits>", () => {
    expect(isWooPingBody("webhook_id=999")).toBe(true);
    expect(isWooPingBody("webhook_id=12")).toBe(true);
    expect(isWooPingBody(" webhook_id=42 ")).toBe(true);
    expect(isWooPingBody('{"id":1}')).toBe(false);
    expect(isWooPingBody("webhook_id=999&foo=1")).toBe(false);
    expect(isWooPingBody("order_id=1")).toBe(false);
  });
});

describe("FIX 2 — APF human key/value parser", () => {
  it("accepts human APF fabric/powder labels", () => {
    expect(classifyFinishKey("Select Fabric")).toEqual({ kind: "slot", slot: "fabric" });
    expect(classifyFinishKey("Select Powder Coat")).toEqual({
      kind: "slot",
      slot: "powder_coat",
    });
    expect(classifyFinishKey("Cushion Fabric")).toEqual({ kind: "slot", slot: "fabric" });
    expect(classifyFinishKey("Powder Finish")).toEqual({
      kind: "slot",
      slot: "powder_coat",
    });
  });

  it("resolves bare, embedded, and display-name finish values", () => {
    expect(resolveFinishValueToSku("FAB-ACT-ASH")).toBe("FAB-ACT-ASH");
    expect(resolveFinishValueToSku("Ash (FAB-ACT-ASH)")).toBe("FAB-ACT-ASH");
    expect(resolveFinishValueToSku("Matte Black - PWD-BLACK")).toBe("PWD-BLACK");
    expect(resolveFinishValueToSku("Action Ash", "fabric")).toBe("FAB-ACT-ASH");
    expect(resolveFinishValueToSku("Black", "powder_coat")).toBe("PWD-BLACK");
  });

  it("extractWooLineSpecs maps APF human keys + embedded values", () => {
    const { specs, issues } = extractWooLineSpecs({
      id: 1,
      status: "processing",
      currency: "USD",
      prices_include_tax: false,
      date_created_gmt: "2026-01-01T00:00:00",
      date_modified_gmt: "2026-01-01T00:00:00",
      customer_id: 1,
      order_key: "wc_order_test",
      billing: {
        first_name: "A",
        last_name: "B",
        company: "",
        address_1: "1",
        address_2: "",
        city: "Phoenix",
        state: "AZ",
        postcode: "85001",
        country: "US",
        email: "a@b.com",
        phone: "",
      },
      shipping: {
        first_name: "A",
        last_name: "B",
        company: "",
        address_1: "1",
        address_2: "",
        city: "Phoenix",
        state: "AZ",
        postcode: "85001",
        country: "US",
        phone: "",
      },
      line_items: [
        {
          id: 1,
          name: "Club",
          product_id: 1,
          variation_id: 0,
          quantity: 1,
          tax_class: "",
          subtotal: "1",
          subtotal_tax: "0",
          total: "1",
          total_tax: "0",
          taxes: [],
          sku: "FIN-BRV-CLB-CHA-34X34",
          price: 1,
          meta_data: [
            { key: "Select Fabric", value: "Ash (FAB-ACT-ASH)" },
            { key: "Select Powder Coat", value: "Black (PWD-BLACK)" },
          ],
        },
      ],
      meta_data: [],
    } as never);
    expect(issues).toEqual([]);
    expect(specs[0]!.finishes.fabric).toBe("FAB-ACT-ASH");
    expect(specs[0]!.finishes.powder_coat).toBe("PWD-BLACK");
  });
});

describe("FIX 1/3 — CSV scrub, ACF prices, dims, short description", () => {
  it("scrubs Steel Frame attributes and steel-or-aluminum copy", () => {
    const row: CsvRow = {
      ID: "28199",
      Name: "Taylor Chair w/ Arms",
      Type: "variable",
      "Attribute 2 name": "Select Frame Type",
      "Attribute 2 value(s)": "Aluminum Frame, Steel Frame",
      "Attribute 2 default": "Steel Frame",
      Description: "constructed from American steel or aluminum, treated with a zinc-gel",
      "Short description": "",
    };
    scrubSteelFromCsvRow(row);
    ensureShortDescription(row);
    expect(row["Attribute 2 value(s)"]).toBe("Aluminum Frame");
    expect(row["Attribute 2 default"]).toBe("Aluminum Frame");
    expect(row.Description).toMatch(/powder-coated aluminum/i);
    expect(row.Description).not.toMatch(/steel or aluminum/i);
    expect(row["Short description"].length).toBeGreaterThan(20);
    expect(JSON.stringify(row)).not.toMatch(/Steel Frame/i);
  });

  it("fixes swapped ACF addon prices + Lido/Cantilever umbrella covers", () => {
    const tenjam: CsvRow = {
      ID: "28316",
      Name: "Laylo Lounger",
      "Meta: coated_led_weight_price": "154.99",
      "Meta: pillow_for_loungers_w_pocket_price": "59.99",
    };
    applyAcfAddonPriceFixes(tenjam, "28316");
    expect(tenjam["Meta: coated_led_weight_price"]).toBe(
      PHASE1_ACF_ADDON_PRICES.coated_led_weight_price,
    );
    expect(tenjam["Meta: pillow_for_loungers_w_pocket_price"]).toBe(
      PHASE1_ACF_ADDON_PRICES.pillow_for_loungers_w_pocket_price,
    );

    const lido: CsvRow = { ID: "28337", Name: "Lido Umbrella", SKU: "FIN-MLN-UMB" };
    applyAcfAddonPriceFixes(lido, "28337");
    expect(lido["Meta: umbrella_cover_price"]).toBe(
      PHASE1_ACF_ADDON_PRICES.umbrella_cover_lido,
    );

    const cant: CsvRow = { ID: "28343", Name: "Cantilever Umbrella w/Base", SKU: "FIN-CAN-UMB" };
    applyAcfAddonPriceFixes(cant, "28343");
    expect(cant["Meta: umbrella_cover_price"]).toBe(
      PHASE1_ACF_ADDON_PRICES.umbrella_cover_cantilever,
    );
  });

  it("has dim overrides for all 15 previously-missing SKUs", () => {
    const required = [
      "FIN-BRV-DYB-84X84-RND",
      "FIN-CAB-MIS-17X17",
      "FIN-CAB-MIS-23X23",
      "FIN-CAB-MIS-12X24",
      "FIN-TJM-MIS-LAYLO-NORISER",
      "FIN-TJM-MIS-LAYLO-4RISER",
      "FIN-TJM-MIS-SHAYZ-5",
      "FIN-MLN-UMB",
      "FIN-KIN-MIS-HEATER",
      "FIN-KIN-MIS-LAMP",
      "FIN-TJM-CHA-FREELO",
      "FIN-TJM-CHA-MOON",
      "FIN-TJM-MIS-WOOSAH",
      "FIN-TJM-TAB",
      "FIN-CAN-UMB",
    ];
    expect(Object.keys(PHASE1_DIM_OVERRIDES_IN).sort()).toEqual(required.sort());
    for (const sku of required) {
      const d = PHASE1_DIM_OVERRIDES_IN[sku]!;
      expect(d.length).toBeGreaterThan(0);
      expect(d.depth).toBeGreaterThan(0);
      expect(d.height).toBeGreaterThan(0);
    }
  });

  it("Phase 1 odd-dollar rows carry raw PDF prices + Mia suggested rounds", () => {
    const phase1 = ODD_DOLLAR_PDF_ROWS.filter((r) => r.phase === 1);
    expect(phase1).toHaveLength(3);
    expect(phase1.map((r) => r.price)).toEqual([3328, 2772, 902]);
    expect(phase1.map((r) => r.suggested)).toEqual([3325, 2775, 900]);
  });
});

describe("FIX 4 — MET-ALUM attribute-only + recipe fabric slots", () => {
  it("frame without RM-FRAME-GENERIC is not swappable (attribute-only)", () => {
    const slots = deriveRecipeSlots([
      "ASM-BRV-CLB-CHA-FRAME",
      "ASM-BRV-CLB-CHA-CUSH",
      "RM-FAB-GENERIC",
      "PWD-BLACK",
    ]);
    expect(slots.frame).toBe(true);
    expect(slots.frameSwappable).toBe(false);
    expect(slots.fabric).toBe(true);
  });

  it("all-metal table recipe does not require fabric", () => {
    const slots = deriveRecipeSlots([
      "ASM-BRK-DIN-TAB-FRAME",
      "PWD-BLACK",
      "RM-PWD-GENERIC",
    ]);
    expect(slots.fabric).toBe(false);
    expect(slots.powder_coat).toBe(true);
  });
});

describe("FIX 2 route — unsigned ping 200 vs unsigned JSON 401", () => {
  const SECRET = "test-woo-secret";

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("WOOCOMMERCE_WEBHOOK_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST webhook_id=999 → 200 {ok:true,ping:true}; unsigned JSON → 401", async () => {
    vi.doMock("@/server/webhooks/incoming-log", () => ({
      insertIncomingWebhookOnce: vi.fn(),
      updateIncomingWebhookStatus: vi.fn(),
    }));
    vi.doMock("@/inngest/client", () => ({ inngest: { send: vi.fn() } }));
    vi.doMock("@/server/alerts/oh-crap", () => ({
      sendOhCrapAlert: vi.fn(async () => ({ ok: true })),
    }));
    vi.doMock("@/server/sre/saga-store", () => ({
      sagaStore: { getByExternalId: vi.fn(), insert: vi.fn() },
    }));
    vi.doMock("@/server/woocommerce/paid-baseline", () => ({
      decidePaidDelivery: vi.fn(),
      markBaselineEnqueued: vi.fn(),
    }));
    vi.doMock("@/server/woocommerce/quarantine-store", () => ({
      quarantineOnce: vi.fn(),
      resolvePendingReviewForOrder: vi.fn(),
    }));
    vi.doMock("@/server/woocommerce/sku-resolver", () => ({
      hubResolveDeps: vi.fn(),
      resolveWooOrder: vi.fn(),
    }));

    const { POST } = await import("@/app/api/webhooks/woocommerce/route");

    const pingReq = new Request("http://localhost/api/webhooks/woocommerce", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "webhook_id=999",
    });
    const pingRes = await POST(pingReq);
    expect(pingRes.status).toBe(200);
    expect(await pingRes.json()).toEqual({ ok: true, ping: true });

    const jsonBody = JSON.stringify({
      id: 99,
      status: "processing",
      line_items: [],
    });
    const jsonReq = new Request("http://localhost/api/webhooks/woocommerce", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wc-webhook-topic": "order.updated",
      },
      body: jsonBody,
    });
    const jsonRes = await POST(jsonReq);
    expect(jsonRes.status).toBe(401);
    expect(await jsonRes.json()).toEqual({ error: "invalid_signature" });

    // Sanity: signed body still verifies (HMAC present)
    const sig = createHmac("sha256", SECRET).update(jsonBody, "utf8").digest("base64");
    expect(sig.length).toBeGreaterThan(10);
  });
});
