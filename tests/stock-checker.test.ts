import { describe, expect, it } from "vitest";
import {
  availableTone,
  filterStockCatalog,
  formatQty,
  matchesStockFamily,
  roundQty,
  type StockCatalogItem,
} from "@/lib/stock-display";
import { stockCheckerAuthorized } from "@/lib/stock-checker-token";

const catalog: StockCatalogItem[] = [
  { variantId: 1, sku: "FAB-CAS-WHI", name: "CASSAVA WHITE" },
  { variantId: 2, sku: "FAB-NUR-WHI", name: "NURTURE WHITE" },
  { variantId: 3, sku: "STN-DKT-AUR1.2", name: "AURA 1.2" },
  { variantId: 4, sku: "FRP-HPC-TORFPPK60TRGHFLEXLP", name: "60\" Trough Flex LP" },
];

describe("stock checker quantities", () => {
  it("subtracts committed from in stock", () => {
    expect(roundQty(5 - 5)).toBe(0);
    expect(roundQty(12.5 - 2.25)).toBe(10.25);
    expect(formatQty(10)).toBe("10");
    expect(formatQty(10.5)).toBe("10.5");
  });
});

describe("stock catalog filters", () => {
  it("matches a Spec label without putting it in the title", () => {
    const rows = filterStockCatalog(
      [
        ...catalog,
        {
          variantId: 8,
          sku: "TJM-BAJA",
          name: "Baja Club Chair",
          variantLabel: "Crystal Topaz",
        },
      ],
      { query: "topaz" },
    );
    expect(rows.map((row) => row.sku)).toEqual(["TJM-BAJA"]);
  });

  it("matches a name fragment such as White", () => {
    const rows = filterStockCatalog(catalog, { query: "White" });
    expect(rows.map((row) => row.sku)).toEqual(["FAB-CAS-WHI", "FAB-NUR-WHI"]);
  });

  it("matches fabrics and dekton by SKU prefix", () => {
    expect(matchesStockFamily("fab-cas-whi", "fabrics")).toBe(true);
    expect(matchesStockFamily("STN-DKT-ZEN2.0", "dekton")).toBe(true);
    expect(matchesStockFamily("FAB-CAS-WHI", "dekton")).toBe(false);
    expect(filterStockCatalog(catalog, { family: "fabrics" }).map((row) => row.sku)).toEqual([
      "FAB-CAS-WHI",
      "FAB-NUR-WHI",
    ]);
    expect(filterStockCatalog(catalog, { query: "WHITE" }).map((row) => row.sku)).toEqual([
      "FAB-CAS-WHI",
      "FAB-NUR-WHI",
    ]);
    expect(filterStockCatalog(catalog, { query: "white" }).map((row) => row.sku)).toEqual([
      "FAB-CAS-WHI",
      "FAB-NUR-WHI",
    ]);
  });

  it("matches a SKU prefix for the quick filters", () => {
    expect(filterStockCatalog(catalog, { prefix: "FAB-" }).map((row) => row.sku)).toEqual([
      "FAB-CAS-WHI",
      "FAB-NUR-WHI",
    ]);
    expect(filterStockCatalog(catalog, { prefix: "STN-DKT-" })).toHaveLength(1);
    expect(filterStockCatalog(catalog, { prefix: "FRP-" })).toHaveLength(1);
  });

  it("keeps SA and ASM frame SKUs for the showroom Frames pill", () => {
    const withFrames: StockCatalogItem[] = [
      ...catalog,
      { variantId: 5, sku: "SA-BRA-FRAME", name: "Bravada Frame" },
      { variantId: 6, sku: "ASM-OCE-FRAME", name: "Ocean Frame" },
      { variantId: 7, sku: "FIN-BRA-CLUB", name: "Bravada Club" },
    ];
    expect(filterStockCatalog(withFrames, { family: "frames" }).map((row) => row.sku)).toEqual([
      "SA-BRA-FRAME",
      "ASM-OCE-FRAME",
    ]);
  });
});

describe("available traffic light", () => {
  it("is green above 10, amber through 10, and red at zero", () => {
    expect(availableTone(11)).toBe("green");
    expect(availableTone(10)).toBe("amber");
    expect(availableTone(1)).toBe("amber");
    expect(availableTone(0)).toBe("red");
    expect(availableTone(-1)).toBe("red");
  });
});

describe("stock checker token", () => {
  it("rejects a missing or mismatched token", () => {
    const previous = process.env.STOCK_CHECKER_TOKEN;
    process.env.STOCK_CHECKER_TOKEN = "expected-token";
    expect(stockCheckerAuthorized("")).toBe(false);
    expect(stockCheckerAuthorized("nope")).toBe(false);
    expect(stockCheckerAuthorized("expected-token")).toBe(true);
    process.env.STOCK_CHECKER_TOKEN = previous;
  });
});
