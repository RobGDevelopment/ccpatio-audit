import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeShippingQuoteRequest,
  buildWooCheckoutQuote,
  computeFallbackLtlRate,
  consolidatePallets,
  LTL_PALLET_MAX_HEIGHT_IN,
  LTL_PALLET_MAX_LENGTH_IN,
  LTL_PALLET_MAX_WIDTH_IN,
  LTL_PALLET_TARE_LB,
  parseQuoteRequest,
  RATE_ID_FEDEX_LTL,
  RATE_ID_PICKUP_SCOTTSDALE,
  RATE_ID_PICKUP_SOLANA,
  resolveCartItems,
  shippingSecretMatches,
  type CatalogDimRow,
  type ResolvedShipItem,
} from "@/server/shipping/woo-checkout-quote";
import {
  buildCcpatioHubShippingZip,
  CCPATIO_HUB_SHIPPING_PHP,
  crc32,
  hubShippingZipContainsPhp,
} from "@/server/shipping/woo-shipping-plugin-zip";
import {
  assertPennyExactOrderBalance,
  buildQboTaxPassthroughPayload,
  buildTaxExemptionSyncPayload,
  extractTaxJarTelemetry,
  round2,
} from "@/server/woocommerce/taxjar-passthrough";
import { POST as shippingQuotePost } from "@/app/api/shipping/quote/route";
import { GET as shippingPluginGet } from "@/app/api/partner/primeview-handoff/shipping-plugin/route";
import { ECOMMERCE_32_FINISH_COUNT } from "@/server/ecommerce/ecommerce-32-finish-roster";
import { PHASE1_PURCHASABLE_SKU_COUNT } from "@/server/ecommerce/phase1-portal";

const ROOT = process.cwd();

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function dim(
  sku: string,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
  weightLb: number,
  extras: Partial<CatalogDimRow> = {},
): CatalogDimRow {
  return {
    globalSku: sku,
    lengthIn,
    widthIn,
    heightIn,
    weightLb,
    shipMode: "ltl",
    ltlClass: "175",
    ...extras,
  };
}

describe("woo-shipping-bridge-and-taxjar · auth + secret", () => {
  it("shippingSecretMatches is constant-time and trims quotes/CRLF", () => {
    expect(shippingSecretMatches('  "abc"\r\n', "abc")).toBe(true);
    expect(shippingSecretMatches("abc", "xyz")).toBe(false);
    expect(shippingSecretMatches("", "abc")).toBe(false);
  });

  it("POST /api/shipping/quote rejects unauthorized callers with 401", async () => {
    const prevSecret = process.env.WOO_SHIPPING_QUOTE_SECRET;
    const prevWoo = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
    const prevPartner = process.env.PRIMEVIEW_HANDOFF_TOKEN;
    const prevEmbed = process.env.GHL_EMBED_SECRET;
    process.env.WOO_SHIPPING_QUOTE_SECRET = "test-ship-secret-xyz";
    process.env.WOOCOMMERCE_WEBHOOK_SECRET = "test-ship-secret-xyz";
    delete process.env.PRIMEVIEW_HANDOFF_TOKEN;
    delete process.env.GHL_EMBED_SECRET;

    try {
      const req = new Request("http://localhost/api/shipping/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: { postcode: "85254", state: "AZ" },
          items: [{ sku: "FIN-TEST", quantity: 1 }],
        }),
      });
      const res = await shippingQuotePost(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.ok).toBe(false);
    } finally {
      if (prevSecret === undefined) delete process.env.WOO_SHIPPING_QUOTE_SECRET;
      else process.env.WOO_SHIPPING_QUOTE_SECRET = prevSecret;
      if (prevWoo === undefined) delete process.env.WOOCOMMERCE_WEBHOOK_SECRET;
      else process.env.WOOCOMMERCE_WEBHOOK_SECRET = prevWoo;
      if (prevPartner === undefined) delete process.env.PRIMEVIEW_HANDOFF_TOKEN;
      else process.env.PRIMEVIEW_HANDOFF_TOKEN = prevPartner;
      if (prevEmbed === undefined) delete process.env.GHL_EMBED_SECRET;
      else process.env.GHL_EMBED_SECRET = prevEmbed;
    }
  });

  it("authorizeShippingQuoteRequest accepts X-CCPatio-Shipping-Secret", async () => {
    const prev = process.env.WOO_SHIPPING_QUOTE_SECRET;
    process.env.WOO_SHIPPING_QUOTE_SECRET = "hub-ship-secret";
    try {
      const req = new Request("http://localhost/api/shipping/quote", {
        headers: { "X-CCPatio-Shipping-Secret": "hub-ship-secret" },
      });
      const auth = await authorizeShippingQuoteRequest(req);
      expect(auth.ok).toBe(true);
      if (auth.ok) expect(auth.via).toBe("shipping_secret");
    } finally {
      if (prev === undefined) delete process.env.WOO_SHIPPING_QUOTE_SECRET;
      else process.env.WOO_SHIPPING_QUOTE_SECRET = prev;
    }
  });
});

describe("woo-shipping-bridge-and-taxjar · pallet math + quote", () => {
  it("enforces 90×40×45 envelope and 45 lb tare on multi-item carts", () => {
    const items: ResolvedShipItem[] = [
      {
        sku: "FIN-A",
        canonicalSku: "FIN-A",
        quantity: 1,
        lengthIn: 84,
        widthIn: 36,
        heightIn: 30,
        weightLb: 100,
        freightClass: "175",
        shipMode: "ltl",
        usedFallbackDims: false,
        volumeIn3: 84 * 36 * 30,
      },
      {
        sku: "FIN-B",
        canonicalSku: "FIN-B",
        quantity: 1,
        lengthIn: 84,
        widthIn: 36,
        heightIn: 30,
        weightLb: 110,
        freightClass: "175",
        shipMode: "ltl",
        usedFallbackDims: false,
        volumeIn3: 84 * 36 * 30,
      },
      {
        sku: "RTL-CVR-1",
        canonicalSku: "RTL-CVR-1",
        quantity: 1,
        lengthIn: 12,
        widthIn: 10,
        heightIn: 4,
        weightLb: 6,
        freightClass: "100",
        shipMode: "parcel",
        usedFallbackDims: false,
        volumeIn3: 480,
      },
    ];
    const { pallets, parcelItemCount } = consolidatePallets(items);
    expect(parcelItemCount).toBe(1);
    expect(pallets.length).toBeGreaterThanOrEqual(1);
    for (const p of pallets) {
      expect(p.lengthIn).toBeLessThanOrEqual(LTL_PALLET_MAX_LENGTH_IN);
      expect(p.widthIn).toBeLessThanOrEqual(LTL_PALLET_MAX_WIDTH_IN);
      expect(p.heightIn).toBeLessThanOrEqual(LTL_PALLET_MAX_HEIGHT_IN);
      expect(p.tareLb).toBe(LTL_PALLET_TARE_LB);
    }
  });

  it("applies category fallback dims when SKU missing freight profile", () => {
    const alias = new Map([["FIN-KINDLE-X", "FIN-KINDLE-X"]]);
    const dims = new Map<string, CatalogDimRow>();
    const resolved = resolveCartItems(
      [{ sku: "FIN-KINDLE-X", quantity: 1 }],
      alias,
      dims,
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.usedFallbackDims).toBe(true);
    expect(resolved[0]!.weightLb).toBeGreaterThan(0);
    expect(resolved[0]!.lengthIn).toBeLessThanOrEqual(LTL_PALLET_MAX_LENGTH_IN);
  });

  it("returns taxable LTL + $0 Scottsdale/Solana pickup with deterministic fallback", async () => {
    const dimMap = new Map<string, CatalogDimRow>([
      ["FIN-SOFA-84", dim("FIN-SOFA-84", 84, 36, 32, 140)],
    ]);
    const quote = await buildWooCheckoutQuote(
      {
        destination: { postcode: "10001", state: "NY", city: "New York", residential: true },
        items: [{ sku: "FIN-SOFA-84", quantity: 2 }],
      },
      {
        resolveAliases: async (skus) => {
          const m = new Map<string, string>();
          for (const s of skus) m.set(s, s);
          return m;
        },
        loadDims: async () => dimMap,
        forceFallback: true,
        originZip: "85043",
      },
    );

    expect(quote.ok).toBe(true);
    expect(quote.originZip).toBe("85043");
    expect(quote.palletSummary.palletCount).toBeGreaterThanOrEqual(1);
    expect(quote.rates.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        RATE_ID_FEDEX_LTL,
        RATE_ID_PICKUP_SCOTTSDALE,
        RATE_ID_PICKUP_SOLANA,
      ]),
    );
    const ltl = quote.rates.find((r) => r.id === RATE_ID_FEDEX_LTL)!;
    expect(ltl.taxable).toBe(true);
    expect(ltl.cost).toBeGreaterThan(0);
    expect(ltl.rateSource).toBe("fallback_zone_matrix");
    expect(ltl.label).toContain("FedEx LTL");
    expect(ltl.label).toContain("Residential");
    expect(ltl.label).toContain("Liftgate");

    const scottsdale = quote.rates.find((r) => r.id === RATE_ID_PICKUP_SCOTTSDALE)!;
    const solana = quote.rates.find((r) => r.id === RATE_ID_PICKUP_SOLANA)!;
    expect(scottsdale.cost).toBe(0);
    expect(scottsdale.taxable).toBe(false);
    expect(solana.cost).toBe(0);
    expect(solana.taxable).toBe(false);

    const expected = computeFallbackLtlRate({
      state: "NY",
      palletCount: quote.palletSummary.palletCount,
      totalWeightLbs: quote.palletSummary.totalWeightLbs,
    });
    expect(ltl.cost).toBe(expected.cost);
  });

  it("parseQuoteRequest validates destination.postcode + items", () => {
    expect(parseQuoteRequest({ destination: {}, items: [] }).ok).toBe(false);
    const ok = parseQuoteRequest({
      destination: { postcode: "85254", state: "AZ" },
      items: [{ sku: "FIN-X", quantity: 1 }],
    });
    expect(ok.ok).toBe(true);
  });
});

describe("woo-shipping-bridge-and-taxjar · plugin ZIP", () => {
  it("builds a valid PKZIP with WC_Shipping_Method bridge PHP", () => {
    const zip = buildCcpatioHubShippingZip();
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    expect(hubShippingZipContainsPhp(zip)).toBe(true);
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("WC_Shipping_Method");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("X-CCPatio-Shipping-Secret");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("ccp_ship_");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("_ccpatio_quote_id");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("WC()->session");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("set_transient");
    expect(CCPATIO_HUB_SHIPPING_PHP).toContain("emergency_fallback_cost");
    // IEEE CRC-32 of "123456789" is the classic check value 0xCBF43926.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("GET shipping-plugin returns 200 ZIP when partner token valid", async () => {
    const prev = process.env.PRIMEVIEW_HANDOFF_TOKEN;
    process.env.PRIMEVIEW_HANDOFF_TOKEN = "partner-zip-token-test";
    try {
      const req = new Request(
        "http://localhost/api/partner/primeview-handoff/shipping-plugin?token=partner-zip-token-test",
      );
      const res = await shippingPluginGet(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toMatch(/application\/zip/);
      expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
      expect(res.headers.get("Content-Disposition")).toContain("ccpatio-hub-shipping.zip");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
      expect(hubShippingZipContainsPhp(buf)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PRIMEVIEW_HANDOFF_TOKEN;
      else process.env.PRIMEVIEW_HANDOFF_TOKEN = prev;
    }
  });

  it("GET shipping-plugin rejects unauthorized with 401", async () => {
    const prev = process.env.PRIMEVIEW_HANDOFF_TOKEN;
    const prevEmbed = process.env.GHL_EMBED_SECRET;
    process.env.PRIMEVIEW_HANDOFF_TOKEN = "expected-token";
    delete process.env.GHL_EMBED_SECRET;
    try {
      const req = new Request(
        "http://localhost/api/partner/primeview-handoff/shipping-plugin?token=wrong",
      );
      const res = await shippingPluginGet(req);
      expect(res.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.PRIMEVIEW_HANDOFF_TOKEN;
      else process.env.PRIMEVIEW_HANDOFF_TOKEN = prev;
      if (prevEmbed === undefined) delete process.env.GHL_EMBED_SECRET;
      else process.env.GHL_EMBED_SECRET = prevEmbed;
    }
  });
});

describe("woo-shipping-bridge-and-taxjar · TaxJar pass-through + QBO", () => {
  it("extracts TaxJar taxes + shipping_lines quote meta and asserts penny balance", () => {
    const telemetry = extractTaxJarTelemetry({
      total: "1295.87",
      total_tax: "95.87",
      cart_tax: "82.50",
      shipping_tax: "13.37",
      shipping_total: "365.00",
      discount_total: "0",
      line_items: [{ subtotal: "835.00" }],
      tax_lines: [
        {
          rate_code: "AZ-STATE",
          label: "AZ State Tax",
          rate_percent: "5.6",
          tax_total: "82.50",
          shipping_tax_total: "13.37",
        },
      ],
      shipping_lines: [
        {
          method_id: "ccpatio_hub_shipping",
          method_title: "FedEx LTL Curbside Freight (Residential & Liftgate Included)",
          total: "365.00",
          total_tax: "13.37",
          meta_data: [
            { key: "_ccpatio_quote_id", value: "ccp-ship-abc" },
            { key: "_ccpatio_pallet_count", value: "2" },
            { key: "_ccpatio_total_weight_lbs", value: "410" },
            { key: "_ccpatio_rate_source", value: "fallback_zone_matrix" },
          ],
        },
      ],
      meta_data: [],
    });

    expect(telemetry.cart_tax).toBe(82.5);
    expect(telemetry.shipping_tax).toBe(13.37);
    expect(telemetry.total_tax).toBe(95.87);
    expect(telemetry.shipping_lines[0]?.quote_id).toBe("ccp-ship-abc");
    expect(telemetry.shipping_lines[0]?.pallet_count).toBe(2);
    expect(telemetry.shipping_lines[0]?.rate_source).toBe("fallback_zone_matrix");

    const balance = assertPennyExactOrderBalance(telemetry);
    expect(balance.ok).toBe(true);
    expect(round2(835 - 0 + 365 + 95.87)).toBe(1295.87);

    const qbo = buildQboTaxPassthroughPayload(telemetry);
    expect(qbo.GlobalTaxCalculation).toBe("NotApplicable");
    expect(qbo.TxnTaxDetail.TotalTax).toBe(95.87);
    expect(qbo.ShippingLine?.Amount).toBe(365);
    expect(qbo.CcPatioTaxTelemetry.balance.ok).toBe(true);
  });

  it("buildTaxExemptionSyncPayload formats Woo meta + TaxJar customer", () => {
    const payload = buildTaxExemptionSyncPayload({
      email: "designer@example.com",
      first_name: "Ava",
      last_name: "Trade",
      tax_exemption_type: "wholesale",
      tax_exempt_regions: ["AZ", "CA"],
      resale_certificate: "AZ-RESALE-99",
      ghl_contact_id: "ghl_123",
    });
    expect(payload.woo_meta_data.some((m) => m.key === "tax_exemption_type")).toBe(true);
    expect(payload.woo_meta_data.some((m) => m.key === "tax_exempt_regions")).toBe(true);
    expect(payload.taxjar_customer.customer_id).toBe("ghl_123");
    expect(payload.taxjar_customer.exemption_type).toBe("wholesale");
    expect(payload.taxjar_customer.exempt_regions).toEqual([
      { country: "US", state: "AZ" },
      { country: "US", state: "CA" },
    ]);
  });
});

describe("woo-shipping-bridge-and-taxjar · partner + portal surfaces", () => {
  it("partner page stays force-dynamic and wires shipping console", () => {
    const page = read("src/app/partner/primeview-handoff/page.tsx");
    const client = read("src/app/partner/primeview-handoff/PartnerHandoffClient.tsx");
    const consoleUi = read("src/components/shipping/ShippingTaxjarConsole.tsx");
    const portal = read(
      "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx",
    );
    expect(page).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
    expect(page).toMatch(/export const revalidate\s*=\s*0/);
    expect(client).toContain("ShippingTaxjarConsole");
    expect(client).toContain("partner-shipping-taxjar");
    expect(consoleUi).toContain("ccpatio-hub-shipping.zip");
    expect(consoleUi).toContain("Simulate Checkout Quote");
    expect(client).not.toContain("portal-tab-intake");
    expect(client).not.toContain("onSaveCalibration");
    expect(client).not.toMatch(/Full 38 Finishes/);
    expect(portal).toContain("ShippingTaxjarConsole");
    expect(portal).toContain("portal-shipping-taxjar");
    expect(ECOMMERCE_32_FINISH_COUNT).toBe(32);
    expect(PHASE1_PURCHASABLE_SKU_COUNT).toBe(107);
  });

  it("webhook + ledger-leg wire TaxJar telemetry without importing QBO client", () => {
    const route = read("src/app/api/webhooks/woocommerce/route.ts");
    const ledger = read("src/server/woocommerce/ledger-leg.ts");
    const schema = read("src/server/woocommerce/ingress.schema.ts");
    expect(route).toContain("extractTaxJarTelemetry");
    expect(route).toContain("buildQboTaxPassthroughPayload");
    expect(route).toContain("_ccpatio_taxjar");
    expect(ledger).toContain("buildQboTaxPassthroughPayload");
    expect(ledger).toContain("GlobalTaxCalculation");
    expect(schema).toContain("cart_tax");
    expect(schema).toContain("shipping_tax");
    // Import graph only (comments may name the forbidden QBO path).
    const importRe = /(?:from|import\()\s*["']([^"']+)["']/g;
    for (const src of [route, ledger]) {
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src))) {
        expect(m[1]).not.toMatch(/integrations\/qbo/i);
        expect(m[1]).not.toMatch(/qbo\/client/i);
      }
    }
  });
});

// Keep vi import used (future mocks).
void vi;
