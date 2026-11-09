import { describe, expect, it } from "vitest";
import {
  EXCLUDED_CATEGORIES,
  SHOWROOM_STOCK_CATEGORIES,
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

  it("pins the showroom allowlist and the factory denylist", () => {
    expect(SHOWROOM_STOCK_CATEGORIES).toEqual([
      "Fabric",
      "Dekton",
      "Tenjam",
      "Umbrellas",
      "Cabana",
      "Flexy",
      "Marina",
      "Fire Glass",
      "Firepit Accessory",
      "Fire Pits",
      "Cushion Sets",
    ]);
    expect(EXCLUDED_CATEGORIES).toEqual([
      "Metal",
      "Powder",
      "Packaging",
      "Hardware",
      "Consumables",
      "Sub-Assembly",
      "Stone",
      "Wood",
      "Foam",
      "Tubing",
      "Fasteners",
      "Weldment",
      "Raw Material",
      "Raw Materials",
      "metal - steel",
      "metal - hardware",
      "metal - shop supplies",
      "cushion - parts",
      "shop - delivery",
    ]);
  });

  it("maps the new Katana categories onto showroom tabs", () => {
    expect(normalizeStockCategory("Cushion - Fabric")).toBe("Fabric");
    expect(normalizeStockCategory("Dekton - Slabs")).toBe("Dekton");
    expect(normalizeStockCategory("Fire Pit")).toBe("Fire Pits");
    expect(normalizeStockCategory("Cushion Sets")).toBe("Cushion Sets");
    expect(normalizeStockCategory("  cushion   sets ")).toBe("Cushion Sets");

    expect(
      sellableCategoryTabs([
        { category: "Cushion Sets" },
        { category: "Fire Pit" },
        { category: "Metal - Steel" },
        { category: "Dekton - Slabs" },
        { category: "Cushion - Parts" },
        { category: "Cushion - Fabric" },
        { category: "Shop - Delivery" },
      ]),
    ).toEqual(["Fabric", "Dekton", "Fire Pits", "Cushion Sets"]);

    expect(isShowroomStockItem({ category: "Cushion - Fabric", name: "Canvas Navy" })).toBe(true);
    expect(isShowroomStockItem({ category: "Dekton - Slabs", name: "Kelya" })).toBe(true);
    expect(isShowroomStockItem({ category: "Fire Pit", name: "Round Burner Table" })).toBe(true);
    expect(isShowroomStockItem({ category: "Cushion Sets", name: "Club Chair Set" })).toBe(true);
  });

  it("strictly denies the Katana raw-material categories", () => {
    for (const category of [
      "Metal - Steel",
      "Metal - Hardware",
      "Metal - Shop Supplies",
      "Cushion - Parts",
      "Shop - Delivery",
      "metal - steel",
      "METAL - HARDWARE",
      "  metal   -   shop supplies ",
    ]) {
      expect(isShowroomStockItem({ category, name: "Any Item" }), category).toBe(false);
      expect(sellableCategoryTabs([{ category }]), category).toEqual([]);
    }
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
