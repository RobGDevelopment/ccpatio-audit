import { describe, expect, it, beforeEach } from "vitest";
import {
  EMBED_TOKEN_HEADER,
  embedAuthCookieAttributeString,
  embedAuthCookieOptions,
  mintEmbedSessionToken,
  verifyEmbedSessionToken,
  timingSafeEqualString,
} from "@/lib/embed-auth";
import {
  __resetKatanaInventoryCacheForTests,
  aggregateInventoryQuantities,
  availableQty,
  isDeletedRecord,
  matchesTypeFilter,
  KATANA_INVENTORY_CACHE,
} from "@/server/stock/katana-inventory";
import {
  ACF_ADDON_PRICE_KEYS,
  buildSurgicalWooPayload,
  convertDimensionForStore,
  convertWeightForStore,
  isProtectedMetaKey,
  parseWooStoreUnits,
  shippingClassFromWeightLb,
  type HubParentInput,
} from "@/server/woocommerce/woo-catalog-sync";

describe("GHL embed session token + Partitioned cookie", () => {
  const secret = "test-embed-secret-key-1234";

  it("mints and verifies a short-lived HMAC embed token", async () => {
    const token = await mintEmbedSessionToken(secret, 1_700_000_000);
    expect(token.startsWith("ccpatio-embed-sess.")).toBe(true);
    const claims = await verifyEmbedSessionToken(token, secret, 1_700_000_000);
    expect(claims?.iat).toBe(1_700_000_000);
    expect(claims?.exp).toBeGreaterThan(1_700_000_000);
  });

  it("rejects expired or tampered tokens", async () => {
    const token = await mintEmbedSessionToken(secret, 1_700_000_000);
    expect(await verifyEmbedSessionToken(token, secret, 1_700_000_000 + 10_000)).toBeNull();
    const tampered = `${token.slice(0, -4)}dead`;
    expect(await verifyEmbedSessionToken(tampered, secret, 1_700_000_000)).toBeNull();
  });

  it("sets SameSite=None; Secure; Partitioned cookie attributes (CHIPS)", () => {
    const opts = embedAuthCookieOptions();
    expect(opts.sameSite).toBe("none");
    expect(opts.secure).toBe(true);
    expect(opts.partitioned).toBe(true);
    expect(opts.path).toBe("/");
    const serialized = embedAuthCookieAttributeString();
    expect(serialized).toContain("SameSite=None");
    expect(serialized).toContain("Secure");
    expect(serialized).toContain("Partitioned");
    expect(serialized).toContain("ccpatio-embed-auth");
    expect(EMBED_TOKEN_HEADER).toBe("x-ccpatio-embed-token");
  });

  it("timing-safe compare rejects unequal secrets", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
  });
});

describe("Katana inventory aggregation + deleted_at exclusion", () => {
  beforeEach(() => {
    __resetKatanaInventoryCacheForTests();
  });

  it("aggregates in_stock, committed, expected, available and skips deleted rows", () => {
    const totals = aggregateInventoryQuantities([
      {
        variant_id: 10,
        location_id: 1,
        quantity_in_stock: 5,
        quantity_committed: 2,
        quantity_expected: 3,
      },
      {
        variant_id: 10,
        location_id: 1,
        quantity_in_stock: 1,
        quantity_committed: 0,
        quantity_expected: 1,
      },
      {
        variant_id: 11,
        location_id: 2,
        quantity_in_stock: 9,
        quantity_committed: 1,
        quantity_expected: 0,
        deleted_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const live = totals.get("10:1");
    expect(live).toEqual({
      variantId: 10,
      locationId: 1,
      inStock: 6,
      committed: 2,
      expected: 4,
    });
    expect(availableQty(live!.inStock, live!.committed)).toBe(4);
    expect(totals.has("11:2")).toBe(false);
  });

  it("treats deleted_at != null as soft-deleted", () => {
    expect(isDeletedRecord({ deleted_at: null })).toBe(false);
    expect(isDeletedRecord({ deleted_at: "2024-01-01" })).toBe(true);
    expect(isDeletedRecord({ deleted_at: "" })).toBe(false);
  });

  it("filters type pills for finished / fabrics / subassemblies", () => {
    expect(matchesTypeFilter("Product / Finished Good", "finished")).toBe(true);
    expect(matchesTypeFilter("Material / Fabric / Powder", "fabrics_powders")).toBe(true);
    expect(matchesTypeFilter("Subassembly", "subassemblies_materials")).toBe(true);
    expect(matchesTypeFilter("Product / Finished Good", "fabrics_powders")).toBe(false);
  });

  it("exposes 60s fresh + 15m stale cache TTLs", () => {
    expect(KATANA_INVENTORY_CACHE.FRESH_TTL_MS).toBe(60_000);
    expect(KATANA_INVENTORY_CACHE.STALE_TTL_MS).toBe(15 * 60_000);
  });
});

describe("WooCommerce REST v3 surgical payload builder", () => {
  const parent: HubParentInput = {
    wooProductId: "27674",
    sku: "FIN-BRV-COR-SOF",
    name: "Bravada Corner Sofa",
    status: "publish",
    shortDescription: "Short",
    description: "Full",
    fabricSwatchesJson: '[{"sku":"FAB-ACT-ASH"}]',
    addonPrices: {
      ironwood_price: 250,
      arms_price: 180,
      casters_price: 100,
      umbrella_cover_price: 75,
      fly_tables_price: 200,
      fly_table_13_x_30_price: 220,
      fly_table_12_x_36_welded_on_back_price: 250,
      fly_table_12_x_48_welded_on_back_price: 275,
      dekton_sidearm_price: 300,
      "arms_8_thick_textile-wrapped_price": 320,
      umbrella_holder_price: 90,
      coated_led_weight_price: 110,
      pillow_for_loungers_w_pocket_price: 95,
      base_w_wheels_price: 140,
      base_price: 120,
      wheels_price: 80,
    },
    optionBadges: { lrFacing: true, fabrics24: true },
    existingMeta: [
      { key: "_brizy_post_uid", value: "keep-me" },
      { key: "rank_math_title", value: "SEO" },
      { key: "astra-settings", value: "{}" },
    ],
    existingImages: [{ id: 99, src: "https://example.com/gallery.jpg" }],
    preserveExistingImages: true,
    variations: [
      {
        sku: "FIN-BRV-COR-SOF-72X34-LS",
        regularPrice: 4200,
        salePrice: 3999,
        weightLb: 65,
        lengthIn: 72,
        widthIn: 34,
        heightIn: 31,
        sizeLabel: '72"',
        facing: "Left-Side Facing",
        katanaSku: "FIN-BRV-COR-SOF-72X34",
        makeOrResale: "Make",
      },
      {
        sku: "FIN-BRV-COR-SOF-72X34-RS",
        regularPrice: 4200,
        weightLb: 40,
        lengthIn: 72,
        widthIn: 34,
        heightIn: 31,
        sizeLabel: '72"',
        facing: "Right-Side Facing",
        katanaSku: "FIN-BRV-COR-SOF-72X34",
        makeOrResale: "Make",
      },
    ],
  };

  it("auto-converts lb/in to kg/cm when the store is metric", () => {
    const metric = parseWooStoreUnits([
      { id: "woocommerce_weight_unit", value: "kg" },
      { id: "woocommerce_dimension_unit", value: "cm" },
    ]);
    expect(metric).toEqual({ weightUnit: "kg", dimensionUnit: "cm" });
    expect(convertWeightForStore(100, metric)).toBe("45.36");
    expect(convertDimensionForStore(10, metric)).toBe("25.40");

    const imperial = parseWooStoreUnits([
      { id: "woocommerce_weight_unit", value: "lbs" },
      { id: "woocommerce_dimension_unit", value: "in" },
    ]);
    expect(convertWeightForStore(100, imperial)).toBe("100.00");
    expect(convertDimensionForStore(10, imperial)).toBe("10.00");
  });

  it("preserves non-owned meta/images and batches Select Facing variations", () => {
    const metric = { weightUnit: "kg" as const, dimensionUnit: "cm" as const };
    const built = buildSurgicalWooPayload(parent, metric);
    expect(built.product).not.toHaveProperty("images");
    expect(built.dryRunPreview.imagesOmitted).toBe(true);
    expect(built.dryRunPreview.protectedMetaOmitted).toEqual(
      expect.arrayContaining(["_brizy_post_uid", "rank_math_title", "astra-settings"]),
    );
    expect(isProtectedMetaKey("_brizy_post_uid")).toBe(true);
    expect(isProtectedMetaKey("ironwood_price")).toBe(false);

    const attrs = built.product.attributes as Array<{ name: string; options: string[] }>;
    expect(attrs.find((a) => a.name === "Select Facing")?.options).toEqual([
      "Left-Side Facing",
      "Right-Side Facing",
    ]);
    expect(built.variationBatch.create).toHaveLength(2);
    expect(built.variationBatch.create[0]?.shipping_class).toBe("freight-ltl");
    expect(built.variationBatch.create[1]?.shipping_class).toBe("parcel");
    expect(shippingClassFromWeightLb(50)).toBe("freight-ltl");
    expect(shippingClassFromWeightLb(49.9)).toBe("parcel");
  });

  it("includes acf_fabric_swatches_json, _w3d_enabled, and all 16 ACF add-on price keys", () => {
    const built = buildSurgicalWooPayload(parent, {
      weightUnit: "lb",
      dimensionUnit: "in",
    });
    const meta = built.product.meta_data as Array<{ key: string; value: string }>;
    expect(meta.find((m) => m.key === "_w3d_enabled")?.value).toBe("");
    expect(meta.find((m) => m.key === "acf_fabric_swatches_json")?.value).toContain("FAB-ACT-ASH");
    for (const key of ACF_ADDON_PRICE_KEYS) {
      expect(meta.some((m) => m.key === key), key).toBe(true);
    }
    expect(ACF_ADDON_PRICE_KEYS).toHaveLength(16);
  });
});
