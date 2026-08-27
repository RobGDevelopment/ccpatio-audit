import { describe, expect, it } from "vitest";
import {
  getMissingCatalogFields,
  inferSuggestedNaFields,
  isNaToken,
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
    expect(missing).not.toContain("image");
    expect(missing).toEqual([]);
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
        naFields: [],
      },
    });
    expect(missing).toContain("msrp");
    expect(missing).not.toContain("arm_height");
    expect(missing).not.toContain("sit_height");
    expect(missing).not.toContain("image");
  });

  it("infers arm/sit N/A for bar tables", () => {
    expect(
      inferSuggestedNaFields({
        originalName: "BROOKLYN TABLE (BAR HEIGHT) 120 X 28",
      }),
    ).toEqual(["arm_height", "sit_height"]);
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
            naFields: ["arm_height", "sit_height"],
          },
        }),
      ),
    ).toBe(false);
  });
});
