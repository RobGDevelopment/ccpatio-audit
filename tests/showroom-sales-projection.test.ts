import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  isShopFloorExcluded,
  isSalesFabric,
  projectShowroomSalesView,
  orderDeskMtoHref,
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

describe("projectShowroomSalesView", () => {
  it("excludes MET-*/ASM-*/SA-*/PWD-* shop-floor SKUs (0 MET-* cards)", () => {
    const rows: KatanaInventoryRow[] = [
      row({
        variantId: 1,
        sku: "MET-STEEL",
        name: "Steel Tube",
        itemType: "Material / Fabric / Powder",
        category: "Metal",
        locationId: 1,
        locationName: "Scottsdale",
      }),
      row({
        variantId: 1,
        sku: "MET-STEEL",
        name: "Steel Tube",
        itemType: "Material / Fabric / Powder",
        category: "Metal",
        locationId: 2,
        locationName: "Solana Beach",
      }),
      row({
        variantId: 2,
        sku: "ASM-FRAME-X",
        name: "Frame Weldment",
        itemType: "Subassembly",
        category: "Sub-Assembly",
      }),
      row({
        variantId: 3,
        sku: "SA-BRV-FRAME",
        name: "Bravada Frame",
        itemType: "Subassembly",
      }),
      row({
        variantId: 4,
        sku: "PWD-BLACK",
        name: "Black Powder Drum",
        itemType: "Material / Fabric / Powder",
        category: "Powder",
      }),
      row({
        variantId: 10,
        sku: "FAB-ACT-ASH",
        name: "Act Soft Ash",
        itemType: "Material / Fabric / Powder",
        category: "Cushion - Fabric",
        locationId: 1,
        locationName: "Scottsdale",
        inStock: 12,
        available: 12,
      }),
      row({
        variantId: 10,
        sku: "FAB-ACT-ASH",
        name: "Act Soft Ash",
        itemType: "Material / Fabric / Powder",
        category: "Cushion - Fabric",
        locationId: 98179,
        locationName: "CC Manufacturing",
        inStock: 3,
        available: 3,
      }),
    ];

    const cards = projectShowroomSalesView({ rows, tab: null });
    expect(cards.every((c) => !c.sku.toUpperCase().startsWith("MET-"))).toBe(true);
    expect(cards.filter((c) => c.sku.startsWith("ASM-") || c.sku.startsWith("SA-") || c.sku.startsWith("PWD-"))).toHaveLength(0);
    expect(isShopFloorExcluded("MET-ALUM")).toBe(true);
    expect(isSalesFabric("MET-STEEL", "Fabric")).toBe(false);
    expect(isSalesFabric("FAB-ACT-ASH", "Cushion - Fabric")).toBe(true);
  });

  it("rolls 3 warehouse rows into 1 card per SKU with location pills", () => {
    const rows: KatanaInventoryRow[] = [
      row({
        variantId: 42,
        sku: "FIN-BRV-CLB-CHA-34X34",
        name: "Bravada Club Chair",
        locationId: 1,
        locationName: "Scottsdale Showroom",
        inStock: 1,
        committed: 0,
        available: 1,
      }),
      row({
        variantId: 42,
        sku: "FIN-BRV-CLB-CHA-34X34",
        name: "Bravada Club Chair",
        locationId: 2,
        locationName: "Solana Beach",
        inStock: 2,
        committed: 1,
        available: 1,
      }),
      row({
        variantId: 42,
        sku: "FIN-BRV-CLB-CHA-34X34",
        name: "Bravada Club Chair",
        locationId: 98179,
        locationName: "CC Manufacturing",
        inStock: 4,
        committed: 0,
        available: 4,
      }),
    ];
    const cards = projectShowroomSalesView({ rows, tab: "floor_ready", inStockOnly: false });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.sku).toBe("FIN-BRV-CLB-CHA-34X34");
    expect(cards[0]!.inStock).toBe(7);
    expect(cards[0]!.committed).toBe(1);
    expect(cards[0]!.available).toBe(6);
    expect(cards[0]!.warehouses.map((w) => w.key).sort()).toEqual([
      "factory",
      "scottsdale",
      "solana",
    ]);
  });

  it("surfaces 3 active Dekton holds and never double-subtracts synced holds", () => {
    const rows: KatanaInventoryRow[] = [
      row({
        variantId: 100,
        sku: "STN-DKT-LUN2.0",
        name: "Lunar 2.0",
        category: "Dekton",
        inStock: 5,
        committed: 2, // already includes HOLD-* in Katana
        available: 3,
        locationName: "Scottsdale",
      }),
      row({
        variantId: 101,
        sku: "STN-DKT-FOS2.0",
        name: "Fossil 2.0",
        category: "Dekton",
        inStock: 3,
        committed: 1,
        available: 2,
        locationName: "Scottsdale",
      }),
      row({
        variantId: 102,
        sku: "STN-DKT-KAI2.0",
        name: "Kairos 2.0",
        category: "Dekton",
        inStock: 4,
        committed: 1,
        available: 3,
        locationName: "Factory",
        locationId: 98179,
      }),
    ];
    const syncedAt = "2026-11-20T00:00:00.000Z";
    const holds: ActiveHoldInput[] = [
      {
        id: "h1",
        variantId: 100,
        sku: "STN-DKT-LUN2.0",
        qty: 2,
        salesperson: "Mia",
        opportunityName: "Customer A",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-19T00:00:00.000Z", // before sync → already in committed
      },
      {
        id: "h2",
        variantId: 101,
        sku: "STN-DKT-FOS2.0",
        qty: 1,
        salesperson: "Mia",
        opportunityName: "Customer B",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-19T00:00:00.000Z",
      },
      {
        id: "h3",
        variantId: 102,
        sku: "STN-DKT-KAI2.0",
        qty: 1,
        salesperson: "Mia",
        opportunityName: "Customer C",
        expiresAt: "2026-12-01T00:00:00.000Z",
        createdAt: "2026-11-19T00:00:00.000Z",
      },
    ];

    const cards = projectShowroomSalesView({
      rows,
      holds,
      lastSyncedAt: syncedAt,
      tab: "dekton",
      inStockOnly: true,
    });
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.sku).sort()).toEqual([
      "STN-DKT-FOS2.0",
      "STN-DKT-KAI2.0",
      "STN-DKT-LUN2.0",
    ]);
    // Synced holds already in committed — available stays inStock - committed (no second subtract).
    const lunar = cards.find((c) => c.sku === "STN-DKT-LUN2.0")!;
    expect(lunar.available).toBe(3);
    expect(lunar.heldQty).toBe(2);
    expect(lunar.holdBadges[0]!.opportunityName).toBe("Customer A");
    expect(lunar.forceVisibleDueToHold).toBe(true);
  });

  it("subtracts only pending holds created after last_synced_at", () => {
    const rows: KatanaInventoryRow[] = [
      row({
        variantId: 200,
        sku: "STN-DKT-LUN2.0",
        name: "Lunar 2.0",
        category: "Dekton",
        inStock: 5,
        committed: 0,
        available: 5,
      }),
    ];
    const cards = projectShowroomSalesView({
      rows,
      lastSyncedAt: "2026-11-20T00:00:00.000Z",
      holds: [
        {
          id: "pending",
          variantId: 200,
          sku: "STN-DKT-LUN2.0",
          qty: 2,
          salesperson: "Rep",
          opportunityName: "New",
          expiresAt: "2026-12-10T00:00:00.000Z",
          createdAt: "2026-11-22T00:00:00.000Z",
        },
      ],
      tab: "dekton",
    });
    expect(cards[0]!.available).toBe(3);
  });

  it("Order Desk MTO deep-link preserves embed token", () => {
    const href = orderDeskMtoHref({
      embedToken: "tok_abc",
      ghlUserId: "u1",
      ghlUserEmail: "rep@ccpatio.com",
      sku: "FIN-BRV-CLB-CHA-34X34",
    });
    expect(href).toContain("/embed/order-desk?");
    expect(href).toContain("embedToken=tok_abc");
    expect(href).toContain("ghlUserId=u1");
    expect(href).toContain("mto=1");
  });

  it("sales modules never couple to ecommerce_listings", () => {
    const files = [
      "src/server/showroom/sales-projection.ts",
      "src/server/showroom/stock.ts",
      "src/app/embed/showroom/page.tsx",
      "src/app/showroom/stock/SalesStockView.tsx",
      "src/app/api/katana/showroom-inventory/route.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // No imports / queries against ecommerce_listings (comments may mention the ban).
      expect(src).not.toMatch(/from\(["'][^"']*schema["']\)[^;]*ecommerce_listings/);
      expect(src).not.toMatch(/\.from\(\s*ecommerce_listings\s*\)/);
      expect(src).not.toMatch(/import\s*\{[^}]*ecommerce_listings/);
    }
  });

  it("projection is CPU-bound (pure function, no I/O) and completes well under 300ms", () => {
    const rows: KatanaInventoryRow[] = [];
    for (let i = 0; i < 2000; i += 1) {
      for (const loc of [
        { id: 1, name: "Scottsdale" },
        { id: 2, name: "Solana" },
        { id: 98179, name: "Factory" },
      ]) {
        rows.push(
          row({
            variantId: i + 1,
            sku: i % 50 === 0 ? `MET-STEEL-${i}` : `FIN-BRV-SOF-${i}`,
            name: `Item ${i}`,
            locationId: loc.id,
            locationName: loc.name,
            inStock: i % 3,
            available: i % 3,
          }),
        );
      }
    }
    const started = Date.now();
    const cards = projectShowroomSalesView({ rows, tab: "floor_ready", inStockOnly: true });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(300);
    expect(cards.every((c) => !c.sku.startsWith("MET-"))).toBe(true);
  });
});

describe("showroom sales restore wiring", () => {
  it("ops inventory lives at /embed/ops-inventory and /admin/ops-inventory", () => {
    expect(existsSync(join(process.cwd(), "src/app/embed/ops-inventory/page.tsx"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/app/admin/ops-inventory/page.tsx"))).toBe(true);
  });
});
