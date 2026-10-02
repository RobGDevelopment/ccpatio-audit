import { describe, expect, it } from "vitest";
import type { LiveKatanaSku } from "@/lib/hub-katana-sync";
import {
  classifyMintCategory,
  classifyMintItemType,
  planMintMissingHubSkus,
  summarizeMintPlan,
} from "@/lib/mint-missing-hub-skus";

function live(
  sku: string,
  opts: Partial<LiveKatanaSku> = {},
): LiveKatanaSku {
  return {
    sku,
    name: opts.name ?? sku,
    variantId: opts.variantId ?? 1,
    productId: opts.productId === undefined ? 10 : opts.productId,
    materialId: opts.materialId ?? null,
  };
}

describe("classifyMintItemType", () => {
  it("maps FIN-* products to finished_good (including colorways)", () => {
    expect(classifyMintItemType("FIN-BRK-CHS-72X34-LS-BE", "product")).toBe(
      "finished_good",
    );
    expect(classifyMintCategory("FIN-BRK-CHS-72X34-LS-BE", "finished_good")).toBe(
      "Finished Good",
    );
  });

  it("maps ASM-/SA- to sub_assembly and CUT- drawing shells too", () => {
    expect(classifyMintItemType("ASM-BRK-BAR-TAB-36X72-FRAME", "product")).toBe(
      "sub_assembly",
    );
    expect(classifyMintItemType("SA-OCN-SOF-72-CUSH", "product")).toBe(
      "sub_assembly",
    );
    expect(classifyMintItemType("CUT-SQ2-16-12.5-0000", "product")).toBe(
      "sub_assembly",
    );
  });

  it("forces material prefixes to raw_material even if Katana parked them as products", () => {
    expect(classifyMintItemType("RM-MET-2X2-TUBING", "product")).toBe(
      "raw_material",
    );
    expect(classifyMintItemType("FAB-ACT-ASH", "material")).toBe("raw_material");
    expect(classifyMintItemType("PWD-BLACK", "material")).toBe("raw_material");
  });

  it("falls back to Katana kind for unknown prefixes", () => {
    expect(classifyMintItemType("BRA-C-34X84-LS-BO", "product")).toBe(
      "finished_good",
    );
    expect(classifyMintItemType("MISC-TAPE", "material")).toBe("raw_material");
  });
});

describe("planMintMissingHubSkus", () => {
  it("emits only Katana SKUs absent from Hub, with companion catalog flags", () => {
    const plan = planMintMissingHubSkus(
      [
        live("FIN-BRK-CHS-72X34-LS-BE", { name: "Brooklyn chaise LS BE" }),
        live("ASM-X-FRAME", { productId: 11 }),
        live("FAB-ACT-ASH", { productId: null, materialId: 50 }),
        live("FIN-ALREADY", { productId: 12 }),
        live("fin-brk-chs-72x34-ls-be", { name: "dup" }),
      ],
      new Set(["FIN-ALREADY", "ASM-KEEP"]),
    );

    expect(plan.map((r) => r.sku)).toEqual([
      "ASM-X-FRAME",
      "FAB-ACT-ASH",
      "FIN-BRK-CHS-72X34-LS-BE",
    ]);

    const bySku = Object.fromEntries(plan.map((r) => [r.sku, r]));
    expect(bySku["FIN-BRK-CHS-72X34-LS-BE"]).toMatchObject({
      action: "mint",
      itemType: "finished_good",
      needsFinishedGoodsCatalog: true,
      needsRawMaterialsCatalog: false,
    });
    expect(bySku["ASM-X-FRAME"]).toMatchObject({
      itemType: "sub_assembly",
      category: "Sub-Assembly",
      needsFinishedGoodsCatalog: false,
      needsRawMaterialsCatalog: false,
    });
    expect(bySku["FAB-ACT-ASH"]).toMatchObject({
      itemType: "raw_material",
      category: "Fabric",
      uom: "yd",
      needsRawMaterialsCatalog: true,
      needsFinishedGoodsCatalog: false,
    });

    expect(summarizeMintPlan(plan)).toMatchObject({
      mint: 3,
      finishedGood: 1,
      subAssembly: 1,
      rawMaterial: 1,
      fgCatalog: 1,
      rmCatalog: 1,
    });
  });
});
