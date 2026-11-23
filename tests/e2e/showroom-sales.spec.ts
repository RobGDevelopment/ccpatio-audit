import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Wiring smoke for sales restore. Projection math is covered by
 * tests/showroom-sales-projection.test.ts (vitest). This file asserts
 * the App Router pages and module contracts without Node path-alias imports.
 */
test.describe("showroom sales restore", () => {
  test("sales embed uses SalesStockView; ops dump moved off showroom", () => {
    const showroom = readFileSync(
      join(process.cwd(), "src/app/embed/showroom/page.tsx"),
      "utf8",
    );
    expect(showroom).toContain("SalesStockView");
    expect(showroom).toContain("loadShowroomSalesInventory");
    expect(showroom).not.toContain('inventoryMode="katana-ops"');

    expect(existsSync(join(process.cwd(), "src/app/embed/ops-inventory/page.tsx"))).toBe(
      true,
    );
    const ops = readFileSync(
      join(process.cwd(), "src/app/embed/ops-inventory/page.tsx"),
      "utf8",
    );
    expect(ops).toContain('inventoryMode="katana-ops"');

    const projection = readFileSync(
      join(process.cwd(), "src/server/showroom/sales-projection.ts"),
      "utf8",
    );
    expect(projection).toContain("projectShowroomSalesView");
    expect(projection).toContain("isShopFloorExcluded");
    expect(projection).toContain("MET-");
    expect(projection).toContain("orderDeskMtoHref");
  });
});
