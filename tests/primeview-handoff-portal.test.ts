import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatePrimeviewHandoffToken,
  derivePrimeviewHandoffTokenFromEmbedSecret,
  PRODUCTION_WOO_WEBHOOK_URL,
  resolveExpectedPrimeviewHandoffToken,
} from "@/lib/primeview-handoff-auth";
import {
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  renderHandoffMarkdownForTest,
} from "@/server/woocommerce/handoff-spec-generator";

describe("PrimeView partner handoff token guard", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects missing token with 401", () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "valid-partner-token");
    const result = authenticatePrimeviewHandoffToken(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toMatch(/missing/i);
    }
  });

  it("rejects invalid token with 403", () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "valid-partner-token");
    const result = authenticatePrimeviewHandoffToken("wrong-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.reason).toMatch(/invalid/i);
    }
  });

  it("accepts explicit PRIMEVIEW_HANDOFF_TOKEN", () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "valid-partner-token");
    const result = authenticatePrimeviewHandoffToken("valid-partner-token");
    expect(result).toEqual({ ok: true, token: "valid-partner-token" });
  });

  it("falls back to deterministic HMAC from GHL_EMBED_SECRET", () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "");
    vi.stubEnv("GHL_EMBED_SECRET", "embed-secret-for-tests");
    const derived = derivePrimeviewHandoffTokenFromEmbedSecret(
      "embed-secret-for-tests",
    );
    expect(derived).toHaveLength(64);
    expect(resolveExpectedPrimeviewHandoffToken()).toBe(derived);
    expect(authenticatePrimeviewHandoffToken(derived).ok).toBe(true);
    expect(authenticatePrimeviewHandoffToken("nope").ok).toBe(false);
  });
});

describe("Live handoff spec markdown contract", () => {
  it("embeds Mia approval count, 107-SKU scope, and production webhook URL", () => {
    const md = renderHandoffMarkdownForTest({
      generatedAtUtc: "2026-11-19T18:00:00.000Z",
      generatedAtMst: "Nov 19, 2026, 11:00:00",
      miaApprovedCount: 42,
      miaLatestApprovedAt: "2026-11-19T17:00:00.000Z",
      variationCount: 100,
      simpleCount: 7,
      uniquePurchasableSkus: PHASE1_PURCHASABLE_SKU_COUNT,
      parentCount: 47,
      sowItemCount: PHASE1_SOW_ITEM_COUNT,
      makeCount: 96,
      resaleCount: 11,
      handoff: [
        {
          sowRow: 1,
          sowName: "BRAVADA CLUB CHAIR",
          canonicalSku: "FIN-BRV-CLB-CHA-34X34",
          wooSku: "FIN-BRV-CLB-CHA-34X34",
          parentId: "9449",
          parentName: "Bravada Club Chair",
          variationId: "27604",
          attr1: "34x34",
          price: "2080.00",
          weightLb: "72.77",
          weightKg: "33.01",
          shipping: "freight-ltl",
          fulfillment: "Make",
          reason: "canonical",
        },
      ],
      storefrontRows: [
        {
          collection: "Bravada",
          productName: "Club Chair 34x34",
          wooSku: "FIN-BRV-CLB-CHA-34X34",
          canonicalSku: "FIN-BRV-CLB-CHA-34X34",
          regularPrice: "2080.00",
          salePrice: "1999.00",
          weightLb: "72.77",
          shippingClass: "freight-ltl",
          options: "Fabric / Powder",
          miaApproved: true,
          miaApprovedAt: "2026-11-19T17:00:00.000Z",
          isWebVisible: true,
          parentId: "9449",
          fulfillment: "Make",
        },
      ],
      swatchSampleUrls: [
        "https://example.supabase.co/storage/v1/object/public/product-images/fabrics/fab-act-ash.jpg",
      ],
    });

    expect(md).toContain("Mia Approval Status");
    expect(md).toContain("**42 / 102 Approved**");
    expect(md).toContain("107");
    expect(md).toContain(PRODUCTION_WOO_WEBHOOK_URL);
    expect(md).toContain("woocommerce_add_cart_item_data");
    expect(md).toContain("woocommerce_checkout_create_order_line_item");
    expect(md).toContain("acf_fabric_swatches_json");
    expect(md).toContain("acf_3d_model_glb_url");
    expect(md).toContain("Native WooCommerce WebGL 3D Configurator");
    expect(md).toContain("frame_metal");
    expect(md).toContain("cushion_fabric");
    expect(md).toContain("wc-product-fields/v1/products");
    expect(md).toContain("FIN-BRV-CLB-CHA-34X34");
    expect(md).toContain("1999.00");
    expect(md).toContain("Katana native WooCommerce plugin must remain disabled");
  });
});

describe("Download route token + live artifact contract", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("GET download returns 401 without token and 403 with bad token", async () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "route-token-abc");
    const { GET } = await import(
      "@/app/api/partner/primeview-handoff/download/route"
    );

    const missing = await GET(
      new Request("http://localhost/api/partner/primeview-handoff/download?artifact=spec"),
    );
    expect(missing.status).toBe(401);

    const bad = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=spec&token=nope",
      ),
    );
    expect(bad.status).toBe(403);
  });

  it("GET download serves live spec/csv reflecting Hub fields + webhook when token valid", async () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "route-token-abc");

    vi.doMock("@/server/woocommerce/handoff-spec-generator", async () => {
      const actual = await vi.importActual<
        typeof import("@/server/woocommerce/handoff-spec-generator")
      >("@/server/woocommerce/handoff-spec-generator");
      return {
        ...actual,
        generateLiveHandoffBundle: vi.fn(async () => ({
          generatedAtUtc: "2026-11-19T18:00:00.000Z",
          generatedAtMst: "Nov 19, 2026, 11:00:00",
          miaApprovedCount: 17,
          miaLatestApprovedAt: "2026-11-19T17:30:00.000Z",
          parentCount: 47,
          variationCount: 100,
          simpleCount: 7,
          uniquePurchasableSkus: 107,
          sowItemCount: 102,
          storefrontRows: [
            {
              collection: "Bravada",
              productName: "Club Chair",
              wooSku: "FIN-BRV-CLB-CHA-34X34",
              canonicalSku: "FIN-BRV-CLB-CHA-34X34",
              regularPrice: "2080.00",
              salePrice: "1900.00",
              weightLb: "72.77",
              shippingClass: "freight-ltl",
              options: "Fabric",
              miaApproved: true,
              miaApprovedAt: "2026-11-19T17:30:00.000Z",
              isWebVisible: true,
              parentId: "9449",
              fulfillment: "Make" as const,
            },
          ],
          handoffMarkdown: actual.renderHandoffMarkdownForTest({
            generatedAtUtc: "2026-11-19T18:00:00.000Z",
            generatedAtMst: "Nov 19, 2026, 11:00:00",
            miaApprovedCount: 17,
            miaLatestApprovedAt: "2026-11-19T17:30:00.000Z",
            variationCount: 100,
            simpleCount: 7,
            uniquePurchasableSkus: 107,
            parentCount: 47,
            sowItemCount: 102,
            makeCount: 96,
            resaleCount: 11,
            handoff: [],
            storefrontRows: [
              {
                collection: "Bravada",
                productName: "Club Chair",
                wooSku: "FIN-BRV-CLB-CHA-34X34",
                canonicalSku: "FIN-BRV-CLB-CHA-34X34",
                regularPrice: "2080.00",
                salePrice: "1900.00",
                weightLb: "72.77",
                shippingClass: "freight-ltl",
                options: "Fabric",
                miaApproved: true,
                miaApprovedAt: "2026-11-19T17:30:00.000Z",
                isWebVisible: true,
                parentId: "9449",
                fulfillment: "Make",
              },
            ],
            swatchSampleUrls: [],
          }),
          csvText:
            "ID,Type,SKU,Regular price,Sale price\n9449,variable,,,\n27604,variation,FIN-BRV-CLB-CHA-34X34,2080.00,1900.00\n",
          csvFilename: "primeview-phase1-102-import.csv",
          swatchesManifest: [
            {
              sku: "FAB-ACT-ASH",
              label: "Action Ash",
              color: "#A8A29A",
              image_url:
                "https://cdn.example/storage/v1/object/public/product-images/fabrics/fab-act-ash.jpg",
            },
          ],
          webhookUrl: PRODUCTION_WOO_WEBHOOK_URL,
        })),
      };
    });

    const { GET } = await import(
      "@/app/api/partner/primeview-handoff/download/route"
    );

    const specRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=spec&token=route-token-abc",
      ),
    );
    expect(specRes.status).toBe(200);
    const specText = await specRes.text();
    expect(specText).toContain("Mia Approval Status");
    expect(specText).toContain("**17 / 102 Approved**");
    expect(specText).toContain(PRODUCTION_WOO_WEBHOOK_URL);
    expect(specText).toContain("1900.00");

    const csvRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=csv&token=route-token-abc",
      ),
    );
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain("FIN-BRV-CLB-CHA-34X34");
    expect(csvText).toContain("1900.00");
    expect(csvRes.headers.get("content-disposition")).toContain(
      "primeview-phase1-102-import.csv",
    );

    const swatchRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=swatches&token=route-token-abc",
      ),
    );
    expect(swatchRes.status).toBe(200);
    const swatchJson = (await swatchRes.json()) as {
      count: number;
      swatches: Array<{ sku: string }>;
    };
    expect(swatchJson.count).toBe(1);
    expect(swatchJson.swatches[0]?.sku).toBe("FAB-ACT-ASH");
  });
});
