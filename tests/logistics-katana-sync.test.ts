import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planKatanaLogisticsInserts } from "@/lib/logistics-katana-sync";

const FREIGHT_SOURCES = [
  "src/server/quotes/rate-freight.ts",
  "src/server/quotes/calculate-promise.ts",
  "src/server/actions/freight.ts",
  "src/components/dispatch/DispatchPortal.tsx",
  "src/app/embed/dispatch/DispatchQueue.tsx",
];

describe("Katana logistics sync plan", () => {
  it("inserts only a new SKU and variant id", () => {
    const plan = planKatanaLogisticsInserts(
      [
        { sku: "FIN-KEPT", variantId: 10 },
        { sku: "FIN-NEW", variantId: 11 },
      ],
      [{ variantSku: "FIN-KEPT", katanaVariantId: 10 }],
    );

    expect(plan.pending).toEqual([
      { katana_variant_id: 11, variant_sku: "FIN-NEW" },
    ]);
    expect(plan.skipped).toBe(1);
    expect(plan.conflicts).toEqual([]);
    expect(Object.keys(plan.pending[0] ?? {}).sort()).toEqual([
      "katana_variant_id",
      "variant_sku",
    ]);
  });

  it("does not rewrite an existing profile when Katana changes the variant id", () => {
    const plan = planKatanaLogisticsInserts(
      [{ sku: "FIN-KEPT", variantId: 99 }],
      [{ variantSku: "FIN-KEPT", katanaVariantId: 10 }],
    );

    expect(plan.pending).toEqual([]);
    expect(plan.skipped).toBe(1);
  });

  it("skips a new SKU whose variant id is already on another profile", () => {
    const plan = planKatanaLogisticsInserts(
      [{ sku: "FIN-OTHER", variantId: 10 }],
      [{ variantSku: "FIN-KEPT", katanaVariantId: 10 }],
    );

    expect(plan.pending).toEqual([]);
    expect(plan.conflicts).toEqual(["FIN-OTHER"]);
  });
});

describe("freight sources", () => {
  it("does not rate freight or promise dates from family templates or a fixed pallet", () => {
    for (const file of FREIGHT_SOURCES) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("family-templates");
      expect(source, file).not.toContain("MOCK_SKID");
    }
  });
});
