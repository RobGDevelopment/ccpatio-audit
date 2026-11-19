import { describe, expect, it } from "vitest";
import {
  assertNoRegression,
  coalesceAttributes,
  coalescePositiveNumeric,
  coalesceText,
  deriveBomReadiness,
  evaluateFieldBadges,
  parsePhase2SowCsv,
  parseMoney,
} from "@/server/ecommerce/phase2-hydration";
import {
  buildAutoSku,
  generateCollisionCheckedSku,
} from "@/server/ecommerce/auto-sku-engine";
import {
  buildProvisionalBomEdges,
  buildProvisionalFactoryBomNote,
  isProvisionalShell,
  markProvisionalAttributes,
  PROVISIONAL_RECIPE,
} from "@/server/ecommerce/provisional-shell";
import { resolveWooOrder } from "@/server/woocommerce/sku-resolver";
import { mapWooOrderToKatanaSalesOrder } from "@/lib/katana";
import {
  BASE_SKU,
  FAB_SKU,
  FRAME_ALUM,
  makeHub,
  PWD_SKU,
  skuRecord,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";

describe("phase2 COALESCE hydration", () => {
  it("never overwrites non-null Hub fields with CSV blanks", () => {
    expect(coalesceText("Hub Copy", "")).toBe("Hub Copy");
    expect(coalesceText("Hub Copy", null)).toBe("Hub Copy");
    expect(coalesceText(null, "CSV Copy")).toBe("CSV Copy");
    expect(coalescePositiveNumeric("72", "")).toBe("72");
    expect(coalescePositiveNumeric("72", "0")).toBe("72");
    expect(coalescePositiveNumeric(null, "48")).toBe("48");
    expect(parseMoney("$2,520.00")).toBe("2520.00");
  });

  it("preserves existing attributes and woo ids when incoming blanks", () => {
    const merged = coalesceAttributes(
      { woo_product_id: "27674", sow_phase: 1, title: "Keep" },
      { woo_product_id: "", sow_phase: 2, title: null as unknown as string, allowed_option_categories: ["Fabric"] },
    );
    expect(merged.woo_product_id).toBe("27674");
    expect(merged.sow_phase).toBe(1);
    expect(merged.title).toBe("Keep");
    expect(merged.allowed_option_categories).toEqual(["Fabric"]);
  });

  it("parses the Phase 2 SOW CSV shape", () => {
    const csv = `SOW Product Name,Canonical SKU,Collection,Length,Depth,Height,Arm Height,Sit Height,Base Weight,MSRP,Allowed Option Categories
"BRAVADA ARMLESS SOFA 34"" x 34"" x 31"" BH",FIN-BRV-ARM-SOF-34X34,Bravada,34,34,31,,,,"$2,040.00",Fabric|Powder|Pillow
`;
    const rows = parsePhase2SowCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.canonicalSku).toBe("FIN-BRV-ARM-SOF-34X34");
    expect(rows[0]!.msrp).toBe("2040.00");
    expect(rows[0]!.allowedOptionCategories).toEqual(["Fabric", "Powder", "Pillow"]);
  });

  it("derives bom readiness without mutating trees", () => {
    expect(deriveBomReadiness({ bomEdgeCount: 0, parentKatanaVariantId: 1, childMissingVariantCount: 0 })).toBe("no_bom_yet");
    expect(deriveBomReadiness({ bomEdgeCount: 3, parentKatanaVariantId: null, childMissingVariantCount: 0 })).toBe("needs_variant_heal");
    expect(deriveBomReadiness({ bomEdgeCount: 3, parentKatanaVariantId: 9, childMissingVariantCount: 0 })).toBe("ready");
  });

  it("assertNoRegression catches lost non-null counts", () => {
    const before = {
      finished_goods_catalog: { image_url: 62, msrp: 100 },
      logistics_profiles: { ready_profiles: 930 },
      ecommerce_listings: { steel_msrp: 200 },
      product_bom: { edges: 3300 },
    };
    const after = {
      finished_goods_catalog: { image_url: 61, msrp: 100 },
      logistics_profiles: { ready_profiles: 930 },
      ecommerce_listings: { steel_msrp: 200 },
      product_bom: { edges: 3300 },
    };
    expect(assertNoRegression(before, after)).toEqual([
      "finished_goods_catalog.image_url: 62 → 61",
    ]);
  });
});

describe("auto-sku engine", () => {
  it("builds deterministic FIN SKUs with facing/height suffixes", () => {
    const base = buildAutoSku({
      origin: "manufactured",
      collectionCode: "BRV",
      furnitureTypeCode: "SOF",
      lengthIn: 72,
      depthIn: 34,
      heightIn: 31,
      backHeightIn: 31,
      facing: "LS",
      heightMode: "standard",
      collectionLabel: "Bravada",
      furnitureTypeLabel: "Sofa",
    });
    expect(base.sku).toBe("FIN-BRV-SOF-72X34-LS");
    expect(base.productName).toContain("Bravada");
    expect(base.productName).toContain('72" x 34"');
  });

  it("detects collisions and allocates a free variant", async () => {
    const taken = new Set(["FIN-BRV-CHA-34X34"]);
    const result = await generateCollisionCheckedSku(
      {
        origin: "manufactured",
        collectionCode: "BRV",
        furnitureTypeCode: "CHA",
        lengthIn: 34,
        depthIn: 34,
        collectionLabel: "Bravada",
        furnitureTypeLabel: "Chair",
      },
      async (sku) => taken.has(sku),
    );
    expect(result.collided).toBe(true);
    expect(result.sku).toBe("FIN-BRV-CHA-34X34-V2");
  });
});

describe("provisional_shell order resolution", () => {
  it("resolves empty-BOM provisional shells without quarantine and stamps factory note", async () => {
    const hub = makeHub({
      records: new Map([
        [
          BASE_SKU,
          skuRecord(BASE_SKU, {
            itemType: "finished_good",
            syncToWoo: true,
            hasCatalogRow: true,
            katanaVariantId: 100,
            attributes: markProvisionalAttributes({}),
          }),
        ],
        [FAB_SKU, skuRecord(FAB_SKU, { attributes: { web_sellable: true }, katanaVariantId: 201 })],
        [PWD_SKU, skuRecord(PWD_SKU, { attributes: { web_sellable: true }, katanaVariantId: 301 })],
        [FRAME_ALUM, skuRecord(FRAME_ALUM, { attributes: { web_sellable: true }, katanaVariantId: 401 })],
        ["RM-FAB-GENERIC", skuRecord("RM-FAB-GENERIC", { katanaVariantId: 901 })],
        ["RM-PWD-GENERIC", skuRecord("RM-PWD-GENERIC", { katanaVariantId: 902 })],
      ]),
      recipes: new Map([[BASE_SKU, []]]),
    });

    expect(isProvisionalShell(hub.records.get(BASE_SKU)!.attributes)).toBe(true);
    expect(buildProvisionalBomEdges(BASE_SKU).map((e) => e.child_sku)).toEqual([
      ...PROVISIONAL_RECIPE,
    ]);

    const resolved = await resolveWooOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: PWD_SKU },
            ],
          }),
        ],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.lines[0]!.provisionalShell).toBe(true);

    const payload = mapWooOrderToKatanaSalesOrder(
      wooOrder({ id: 99 }),
      resolved.lines,
    );
    expect(payload.additionalInfo).toContain("[PROVISIONAL SKU — COMPLETE FACTORY BOM]");
    expect(payload.additionalInfo).toContain(`sku=${BASE_SKU}`);
  });

  it("still quarantines empty BOM when not provisional", async () => {
    const hub = makeHub({
      recipes: new Map([[BASE_SKU, []]]),
    });
    const resolved = await resolveWooOrder(
      wooOrder({ line_items: [wooLine()] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(resolved.ok).toBe(false);
  });

  it("leaves full BOM items on standard resolution", async () => {
    const hub = makeHub();
    const resolved = await resolveWooOrder(
      wooOrder({ line_items: [wooLine()] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.lines[0]!.provisionalShell).toBe(false);
  });
});

describe("readiness badges", () => {
  it("requires price/dims/weight for promote", () => {
    const badges = evaluateFieldBadges({
      msrp: "2040",
      length: "34",
      depth: "34",
      height: "31",
      weight: "80",
      optionCategories: ["Fabric"],
      bomReadiness: "ready",
    });
    expect(badges.price && badges.dims && badges.weight && badges.options).toBe(true);
  });
});

describe("provisional note builder", () => {
  it("emits structured factory BOM card", () => {
    const note = buildProvisionalFactoryBomNote({
      sku: "FIN-BRV-CHA-34X34",
      productName: "Bravada Chair",
      lengthIn: 34,
      depthIn: 34,
      heightIn: 31,
      fabricSku: "FAB-ACT-ASH",
      powderSku: "PWD-BLACK",
      frameMetalSku: "MET-STEEL",
      addons: [{ key: "casters", sku: "FIN-ADD-CASTER" }],
    });
    expect(note.startsWith("[PROVISIONAL SKU — COMPLETE FACTORY BOM]")).toBe(true);
    expect(note).toContain("fabric=FAB-ACT-ASH");
  });
});
