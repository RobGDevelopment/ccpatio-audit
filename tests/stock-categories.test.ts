import { describe, expect, it } from "vitest";
import { sellableCategoryTabs } from "@/lib/stock-categories";
import { filterStockCatalog, type StockCatalogItem } from "@/lib/stock-display";

describe("sellable category tabs", () => {
  it("drops factory categories and pins fabrics, dekton, and frames", () => {
    const items = [
      { category: "Umbrellas" },
      { category: "Metal" },
      { category: "Firepits" },
      { category: "powder" },
      { category: "Frames" },
      { category: "Packaging" },
      { category: "Accessories" },
      { category: "Hardware" },
      { category: "Dekton" },
      { category: "Consumables" },
      { category: "Fabric" },
      { category: "Sub-Assembly" },
      { category: "  " },
      { category: "Fire Glass" },
    ];

    expect(sellableCategoryTabs(items)).toEqual([
      "Fabric",
      "Dekton",
      "Frames",
      "Accessories",
      "Fire Glass",
      "Firepits",
      "Umbrellas",
    ]);
  });

  it("filters catalog rows by the Katana category name", () => {
    const catalog: StockCatalogItem[] = [
      { variantId: 1, sku: "UMB-01", name: "Cantilever", category: "Umbrellas" },
      { variantId: 2, sku: "FAB-CAN-NAVY", name: "Canvas Navy", category: "Fabric" },
      { variantId: 3, sku: "RM-MET-2X2", name: "2x2 Tubing", category: "Metal" },
    ];
    expect(filterStockCatalog(catalog, { category: "umbrellas" }).map((row) => row.sku)).toEqual([
      "UMB-01",
    ]);
  });
});
