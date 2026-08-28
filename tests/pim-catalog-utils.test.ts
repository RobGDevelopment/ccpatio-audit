import { describe, expect, it } from "vitest";
import {
  calculateRowHealth,
  computeBatchCompletion,
  getMissingAttributeFields,
  getMissingCatalogFields,
  inferSuggestedNaFields,
  isNaToken,
  isAttributeValueComplete,
} from "@/app/admin/dictionary/pim-catalog-utils";
import { isFinishedGoodCatalogComplete } from "@/app/admin/dictionary/columns";
import type { SkuMappingRow } from "@/app/admin/dictionary/types";

const baseCatalog = {
  msrp: "100",
  cost: null,
  length: "48",
  depth: "24",
  height: "36",
  armHeight: null,
  sitHeight: null,
  weight: null,
  description: null,
  imageUrl: null,
  qboItemCode: null,
  naFields: ["arm_height", "sit_height"] as string[],
  updatedAt: null,
  updatedBy: null,
};

function fgRow(overrides: Partial<SkuMappingRow> = {}): SkuMappingRow {
  return {
    globalSku: "FIN-TEST-SKU",
    category: "Finished Good",
    itemType: "finished_good",
    originalName: "BROOKLYN BAR TABLE 120 X 28",
    sourceFile: "",
    isActive: true,
    syncToWoo: false,
    uomPurchase: "ea",
    uomConsume: "ea",
    baseCost: null,
    katanaVariantId: null,
    katanaMaterialId: null,
    wooAttributeSlug: null,
    ghlDropdownValue: null,
    qboAccounts: {},
    attributes: {},
    version: 1,
    mappingUpdatedAt: null,
    mappingUpdatedBy: null,
    bomComponentCount: 0,
    catalog: baseCatalog,
    ...overrides,
  };
}

describe("pim-catalog-utils", () => {
  it("recognizes N/A tokens", () => {
    expect(isNaToken("N/A")).toBe(true);
    expect(isNaToken("n/a")).toBe(true);
    expect(isNaToken("48")).toBe(false);
    expect(isAttributeValueComplete("N/A")).toBe(true);
    expect(isAttributeValueComplete("")).toBe(false);
  });

  it("does not treat missing image as a health gap", () => {
    const missing = getMissingCatalogFields({
      category: "Finished Good",
      itemType: "finished_good",
      originalName: "BROOKLYN BAR TABLE 120 X 28",
      globalSku: "FIN-TEST",
      catalog: {
        ...baseCatalog,
        imageUrl: null,
      },
    });
    expect(missing).not.toContain("image" as never);
  });

  it("flags blank integration dims but not inferred N/A seating fields on tables", () => {
    const missing = getMissingCatalogFields({
      category: "Finished Good",
      itemType: "finished_good",
      originalName: "BROOKLYN BAR TABLE 120 X 28",
      globalSku: "FIN-BRK-BAR-TAB-120x28",
      catalog: {
        ...baseCatalog,
        msrp: null,
        length: "120",
        depth: "28",
        height: "42",
        armHeight: null,
        sitHeight: null,
        weight: "95",
        naFields: [],
      },
    });
    expect(missing).toContain("msrp");
    expect(missing).not.toContain("arm_height");
    expect(missing).not.toContain("seat_height");
  });

  it("infers arm/sit N/A for bar tables", () => {
    expect(
      inferSuggestedNaFields({
        originalName: "BROOKLYN TABLE (BAR HEIGHT) 120 X 28",
      }),
    ).toEqual(["arm_height", "sit_height"]);
  });

  it("flags missing dekton attribute fields", () => {
    expect(
      getMissingAttributeFields({
        category: "Dekton",
        attributes: {
          slab_length: "120",
          finish: "N/A",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "slab_width",
        "thickness_mm",
        "yield_sqft",
      ]),
    );
    expect(
      getMissingAttributeFields({
        category: "Dekton",
        attributes: {
          slab_length: "120",
          slab_width: "56",
          thickness_mm: "12",
          finish: "Matte",
          yield_sqft: "42",
        },
      }),
    ).toEqual([]);
  });

  it("accepts N/A in attribute fields as complete", () => {
    const missing = getMissingAttributeFields({
      category: "Powder",
      attributes: {
        finish_type: "N/A",
        cure_temp: "n/a",
        cure_time: "400",
        ral_code: "9005",
      },
    });
    expect(missing).not.toContain("finish_type");
    expect(missing).not.toContain("cure_temp");
  });

  it("calculateRowHealth merges catalog and attribute gaps", () => {
    const health = calculateRowHealth({
      category: "Fabric",
      itemType: "raw_material",
      originalName: "SUNBRELLA SOLSTIS",
      globalSku: "FAB-1",
      attributes: { grade: "A" },
      catalog: null,
    });
    expect(health.hasMissingData).toBe(true);
    expect(health.missingAttributeFields).toContain("roll_width");
  });

  it("computeBatchCompletion derives percent from row health", () => {
    const complete = {
      category: "Powder",
      itemType: "raw_material" as const,
      originalName: "Complete powder",
      globalSku: "POW-1",
      attributes: {
        finish_type: "Matte",
        cure_temp: "400",
        cure_time: "20",
        ral_code: "9005",
      },
      catalog: null,
    };
    const incomplete = {
      category: "Powder",
      itemType: "raw_material" as const,
      originalName: "Incomplete powder",
      globalSku: "POW-2",
      attributes: { finish_type: "Matte" },
      catalog: null,
    };
    expect(calculateRowHealth(complete).hasMissingData).toBe(false);
    expect(calculateRowHealth(incomplete).hasMissingData).toBe(true);

    const stats = computeBatchCompletion([complete, incomplete], "Powder");
    expect(stats.total).toBe(2);
    expect(stats.complete).toBe(1);
    expect(stats.percent).toBe(50);
    expect(stats.label).toBe("Powder");
  });
});

describe("isFinishedGoodCatalogComplete", () => {
  it("passes when only image is missing", () => {
    expect(
      isFinishedGoodCatalogComplete(
        fgRow({
          catalog: {
            ...baseCatalog,
            imageUrl: null,
            weight: "80",
          },
        }),
      ),
    ).toBe(true);
  });

  it("fails when msrp is blank and not N/A", () => {
    expect(
      isFinishedGoodCatalogComplete(
        fgRow({
          catalog: {
            ...baseCatalog,
            msrp: null,
            weight: "80",
            naFields: ["arm_height", "sit_height"],
          },
        }),
      ),
    ).toBe(false);
  });
});
