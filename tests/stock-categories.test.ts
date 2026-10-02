import { describe, expect, it } from "vitest";
import {
  isShowroomStockItem,
  normalizeStockCategory,
  sellableCategoryTabs,
} from "@/lib/stock-categories";
import { filterStockCatalog, type StockCatalogItem } from "@/lib/stock-display";

describe("sellable category tabs", () => {
  it("keeps only the walk-in allowlist, in allowlist order", () => {
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
      { category: "Finished Good" },
      { category: "Finished goods" },
      { category: "Finished Goods" },
      { category: "Bravada" },
      { category: "Bravada Collection" },
      { category: "Fabrics" },
    ];

    expect(sellableCategoryTabs(items)).toEqual(["Fabric", "Dekton", "Umbrellas", "Fire Glass"]);
  });

  it("collapses fabric and finished-good aliases before the allowlist", () => {
    expect(normalizeStockCategory("Fabrics")).toBe("Fabric");
    expect(normalizeStockCategory("Finished goods")).toBe("Finished Good");
    expect(normalizeStockCategory("Finished Goods")).toBe("Finished Good");
    expect(normalizeStockCategory("Bravada Collection")).toBe("Bravada");
    expect(sellableCategoryTabs([{ category: "Finished Goods" }])).toEqual([]);
  });

  it("drops finished goods and MTO rows, and keeps purchased materials", () => {
    expect(
      isShowroomStockItem({ category: "Finished Good", name: "Bravada Club Chair" }),
    ).toBe(false);
    expect(isShowroomStockItem({ category: "Frames", name: "Club Chair Frame" })).toBe(false);
    expect(isShowroomStockItem({ category: "Accessories", name: "Cover" })).toBe(false);
    expect(isShowroomStockItem({ category: "Fabric", name: "Canvas Navy" })).toBe(true);
    expect(isShowroomStockItem({ category: "Fabrics", name: "Canvas Navy" })).toBe(true);
    expect(isShowroomStockItem({ category: "Fire Glass", name: "Bronze" })).toBe(true);
    expect(isShowroomStockItem({ category: "Fabric", name: "Ocean Blue" })).toBe(false);
    expect(isShowroomStockItem({ category: "Dining Tables", name: "Dining Tables 42" })).toBe(
      false,
    );
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
