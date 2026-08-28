import { describe, expect, it } from "vitest";
import {
  buildRawMaterialSkuBase,
  nextAvailableSku,
  resolveAttributeTabKey,
  resolveRawMaterialCategoryCode,
} from "@/lib/raw-material-sku";

describe("raw-material-sku", () => {
  it("builds category-prefixed SKU bases", () => {
    expect(buildRawMaterialSkuBase("Dekton", "Agda 2.0")).toBe("RM-DKT-AGDA-2-0");
    expect(buildRawMaterialSkuBase("Fabric", "Sunbrella Natural")).toBe(
      "RM-FAB-SUNBRELLA-NATURAL",
    );
    expect(resolveRawMaterialCategoryCode("Powder Coat")).toBe("PWR");
  });

  it("resolves attribute tab aliases", () => {
    expect(resolveAttributeTabKey("Powder Coat")).toBe("powder");
    expect(resolveAttributeTabKey("Aluminum")).toBe("metal");
    expect(resolveAttributeTabKey("Dekton")).toBe("dekton");
  });

  it("finds next available SKU when base collides", () => {
    const taken = new Set(["RM-FAB-TEST", "RM-FAB-TEST-2"]);
    expect(nextAvailableSku("RM-FAB-TEST", taken)).toBe("RM-FAB-TEST-3");
  });
});
