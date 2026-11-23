import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  getShowroomFeatureFlags,
  type ShowroomFeatureFlags,
} from "@/lib/showroom-feature-flags";
import { displayStockUom } from "@/lib/hold-quantity";
import {
  SHOWROOM_DEFAULT_SALES_TAB,
  SHOWROOM_PRIMARY_SALES_TABS,
  isDektonSku,
  isInternalJobOrOneOff,
  isNonRetailFirepitComponent,
  orderDeskMtoHref,
  projectShowroomSalesView,
  showroomBackHref,
  visibleShowroomSalesTabs,
  type ActiveHoldInput,
} from "@/server/showroom/sales-projection";
import type { KatanaInventoryRow } from "@/server/stock/katana-inventory";

function row(
  partial: Partial<KatanaInventoryRow> & Pick<KatanaInventoryRow, "variantId" | "sku" | "name">,
): KatanaInventoryRow {
  return {
    itemType: "Product / Finished Good",
    category: null,
    uom: "ea",
    locationId: 1,
    locationName: "Scottsdale Showroom",
    inStock: 2,
    committed: 0,
    expected: 0,
    available: 2,
    deleted: false,
    ...partial,
  };
}

const FIXTURE_ROWS: KatanaInventoryRow[] = [
  row({
    variantId: 1,
    sku: "FAB-ACT-ASH",
    name: "Act Soft Ash",
    itemType: "Material / Fabric / Powder",
    category: "Cushion - Fabric",
    uom: "yd",
    inStock: 12,
    available: 12,
  }),
  row({
    variantId: 2,
    sku: "STN-DKT-LUN2.0",
    name: "Lunar 2.0",
    itemType: "Material / Fabric / Powder",
    category: "Dekton - Slabs",
    uom: "slab",
    inStock: 5,
    committed: 2,
    available: 3,
  }),
  row({
    variantId: 3,
    sku: "DEC-FOSSIL",
    name: "Dekton Fossil",
    itemType: "Material / Fabric / Powder",
    category: "Dekton - Slabs",
    uom: null,
    inStock: 2,
    available: 2,
  }),
  row({
    variantId: 4,
    sku: "FIN-TJM-CHAIR",
    name: "Tenjam Lounge Chair",
    category: "Tenjam",
    inStock: 3,
    available: 3,
  }),
  row({
    variantId: 5,
    sku: "FIN-BRV-CLB-CHA",
    name: "Bravada Club Chair",
    inStock: 1,
    available: 1,
  }),
  row({
    variantId: 6,
    sku: "FIN-JOB-1234",
    name: "JOB - NEW BUILD Custom",
    inStock: 4,
    available: 4,
  }),
  row({
    variantId: 7,
    sku: "FIN-GRACE-CUSTOM",
    name: "GRACE STRADON CUSTOMER FABRIC Pavilion Stone",
    category: "Dekton",
    itemType: "Product / Finished Good",
    inStock: 1,
    available: 1,
  }),
  row({
    variantId: 8,
    sku: "FIN-PAV-STONE",
    name: "PAVILION - STONE with Dekton top",
    category: "Finished Goods",
    inStock: 1,
    available: 1,
  }),
  row({
    variantId: 9,
    sku: "RM-FP-BURNER",
    name: "Firepit Burner Pan Build Component",
    category: "Fire Pits",
    itemType: "Material / Fabric / Powder",
    inStock: 10,
    available: 10,
  }),
  row({
    variantId: 10,
    sku: "MET-STEEL-1",
    name: "Steel Tube",
    category: "Metal",
    itemType: "Material / Fabric / Powder",
    inStock: 50,
    available: 50,
  }),
  row({
    variantId: 11,
    sku: "STN-DKT-ZERO",
    name: "Zero Stock Dekton",
    itemType: "Material / Fabric / Powder",
    category: "Dekton - Slabs",
    uom: "yd", // wrong fabric UOM from Katana — must not stick
    inStock: 1,
    committed: 1,
    available: 0,
  }),
];

const DEKTON_HOLDS: ActiveHoldInput[] = [
  {
    id: "h1",
    variantId: 2,
    sku: "STN-DKT-LUN2.0",
    qty: 2,
    salesperson: "Mia",
    opportunityName: "A",
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "h2",
    variantId: 3,
    sku: "DEC-FOSSIL",
    qty: 1,
    salesperson: "Mia",
    opportunityName: "B",
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: "2026-11-19T00:00:00.000Z",
  },
  {
    id: "h3",
    variantId: 11,
    sku: "STN-DKT-ZERO",
    qty: 1,
    salesperson: "Mia",
    opportunityName: "C",
    expiresAt: "2026-12-01T00:00:00.000Z",
    createdAt: "2026-11-19T00:00:00.000Z",
  },
];

describe("showroom-option-a-flagged-polish — flags=false (default)", () => {
  const prevMto = process.env.NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED;
  const prevCta = process.env.NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED;
    delete process.env.NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED;
  });

  afterEach(() => {
    if (prevMto === undefined) delete process.env.NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED;
    else process.env.NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED = prevMto;
    if (prevCta === undefined) delete process.env.NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED;
    else process.env.NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED = prevCta;
  });

  it("defaults both feature flags to false", () => {
    const flags = getShowroomFeatureFlags();
    expect(flags).toEqual({ enableMtoCatalog: false, enableOrderDeskCta: false } satisfies ShowroomFeatureFlags);
  });

  it("renders exactly 5 primary tabs with Fabrics as the default", () => {
    const tabs = visibleShowroomSalesTabs(false);
    expect(tabs).toEqual([...SHOWROOM_PRIMARY_SALES_TABS]);
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toBe("fabrics");
    expect(SHOWROOM_DEFAULT_SALES_TAB).toBe("fabrics");
    expect(tabs).not.toContain("mto_catalog");
  });

  it("excludes FIN-JOB-* / JOB one-offs from Floor & Ready-to-Ship (0 FIN-JOB-*)", () => {
    expect(isInternalJobOrOneOff("FIN-JOB-1234", "JOB - NEW BUILD")).toBe(true);
    const floor = projectShowroomSalesView({
      rows: FIXTURE_ROWS,
      tab: "floor_ready",
      inStockOnly: false,
    });
    expect(floor.every((c) => !c.sku.toUpperCase().startsWith("FIN-JOB-"))).toBe(true);
    expect(floor.filter((c) => c.sku.startsWith("FIN-JOB-"))).toHaveLength(0);
    expect(floor.some((c) => c.sku === "FIN-BRV-CLB-CHA")).toBe(true);
  });

  it("Dekton tab has 0 GRACE STRADON / pavilion product rows", () => {
    expect(isDektonSku("FIN-GRACE-CUSTOM", "Dekton", "GRACE STRADON CUSTOMER FABRIC", "Product / Finished Good")).toBe(
      false,
    );
    const dekton = projectShowroomSalesView({
      rows: FIXTURE_ROWS,
      holds: DEKTON_HOLDS,
      lastSyncedAt: "2026-11-20T00:00:00.000Z",
      tab: "dekton",
      inStockOnly: false,
    });
    expect(dekton.every((c) => !/GRACE STRADON/i.test(c.name))).toBe(true);
    expect(dekton.every((c) => !c.sku.startsWith("FIN-"))).toBe(true);
    expect(dekton.some((c) => c.sku.startsWith("STN-DKT-") || c.sku.startsWith("DEC-"))).toBe(true);
  });

  it("excludes non-retail firepit burners/pans and MET-* from sales projection", () => {
    expect(isNonRetailFirepitComponent("RM-FP-BURNER", "Fire Pits", "Firepit Burner Pan")).toBe(true);
    const all = projectShowroomSalesView({ rows: FIXTURE_ROWS, tab: null });
    expect(all.every((c) => !c.sku.toUpperCase().startsWith("MET-"))).toBe(true);
    expect(all.every((c) => c.sku !== "RM-FP-BURNER")).toBe(true);
  });

  it("disables holds when available<=0 (Fully Held / Out of Stock semantics)", () => {
    const dekton = projectShowroomSalesView({
      rows: FIXTURE_ROWS,
      holds: DEKTON_HOLDS,
      lastSyncedAt: "2026-11-20T00:00:00.000Z",
      tab: "dekton",
      inStockOnly: false,
    });
    const zero = dekton.find((c) => c.sku === "STN-DKT-ZERO");
    expect(zero).toBeTruthy();
    expect(zero!.available).toBeLessThanOrEqual(0);
    expect(zero!.heldQty).toBeGreaterThan(0);
    // UI maps: available<=0 + heldQty>0 → "Fully Held" (never opens PlaceHoldModal)
    const label = zero!.available <= 0 ? (zero!.heldQty > 0 ? "Fully Held" : "Out of Stock") : "Place Hold";
    expect(label).toBe("Fully Held");
  });

  it("uses non-yd Dekton UOM (slab) even when Katana raw uom is yd", () => {
    expect(displayStockUom("STN-DKT-LUN2.0", "yd")).toBe("slab");
    expect(displayStockUom("DEC-FOSSIL", null)).toBe("slab");
    expect(displayStockUom("STN-DKT-LUN2.0", "slab")).toBe("slab");
    expect(displayStockUom("STN-DKT-LUN2.0", "pcs")).toBe("ea");
    const dekton = projectShowroomSalesView({
      rows: FIXTURE_ROWS,
      holds: DEKTON_HOLDS,
      lastSyncedAt: "2026-11-20T00:00:00.000Z",
      tab: "dekton",
    });
    for (const card of dekton) {
      expect(card.uom).not.toBe("yd");
    }
  });

  it("keeps MTO + Order Desk source files present while flags hide them", () => {
    const salesView = readFileSync(join(process.cwd(), "src/app/showroom/stock/SalesStockView.tsx"), "utf8");
    expect(salesView).toContain("mto_catalog");
    expect(salesView).toContain("orderDeskMtoHref");
    expect(salesView).toContain("enableMtoCatalog");
    expect(existsSync(join(process.cwd(), "src/lib/showroom-feature-flags.ts"))).toBe(true);
  });
});

describe("showroom-option-a-flagged-polish — flags=true (dormant MTO preserved)", () => {
  it("enables Make-to-Order Catalog tab + Order Desk deep-link with from=showroom", () => {
    const flags = getShowroomFeatureFlags({
      enableMtoCatalog: true,
      enableOrderDeskCta: true,
    });
    expect(flags.enableMtoCatalog).toBe(true);
    expect(flags.enableOrderDeskCta).toBe(true);

    const tabs = visibleShowroomSalesTabs(true);
    expect(tabs).toContain("mto_catalog");
    expect(tabs).toHaveLength(6);
    expect(tabs[tabs.length - 1]).toBe("mto_catalog");

    const mto = projectShowroomSalesView({
      rows: FIXTURE_ROWS,
      tab: "mto_catalog",
      inStockOnly: false,
    });
    expect(mto.some((c) => c.sku.startsWith("FIN-BRV-") || c.salesTab === "mto_catalog" || c.salesTab === "floor_ready")).toBe(
      true,
    );

    const href = orderDeskMtoHref({
      embedToken: "tok_abc",
      ghlUserId: "u1",
      ghlUserEmail: "rep@ccpatio.com",
      sku: "FIN-BRV-CLB-CHA",
    });
    expect(href).toContain("/embed/order-desk?");
    expect(href).toContain("embedToken=tok_abc");
    expect(href).toContain("mto=1");
    expect(href).toContain("from=showroom");

    const back = showroomBackHref({
      href: "https://hub.ccpatio.com/embed/order-desk?embedToken=tok_abc&from=showroom&mto=1",
      embedToken: "tok_abc",
      ghlUserId: "u1",
    });
    expect(back).toContain("/embed/showroom?");
    expect(back).toContain("embedToken=tok_abc");
    expect(back).not.toContain("from=showroom");
    expect(back).not.toContain("mto=1");
  });

  it("Order Desk portal wires Back to Current Inventory when from=showroom", () => {
    const portal = readFileSync(
      join(process.cwd(), "src/app/embed/order-desk/OrderDeskPortal.tsx"),
      "utf8",
    );
    expect(portal).toContain("Back to Current Inventory");
    expect(portal).toContain("order-desk-back-to-showroom");
    expect(portal).toContain("fromShowroom");
    const page = readFileSync(join(process.cwd(), "src/app/embed/order-desk/page.tsx"), "utf8");
    expect(page).toContain('fromValue === "showroom"');
  });
});

describe("showroom-option-a static guards", () => {
  it("sales modules never couple to ecommerce_listings", () => {
    const files = [
      "src/lib/showroom-feature-flags.ts",
      "src/server/showroom/sales-projection.ts",
      "src/server/showroom/stock.ts",
      "src/app/embed/showroom/page.tsx",
      "src/app/showroom/stock/SalesStockView.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/\.from\(\s*ecommerce_listings\s*\)/);
      expect(src).not.toMatch(/import\s*\{[^}]*ecommerce_listings/);
    }
  });
});
