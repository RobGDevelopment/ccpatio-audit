import { describe, expect, it } from "vitest";
import {
  buildOceanBomPlan,
  oceanIngredientBucket,
  oceanOperationBucket,
  pickCanonicalVariantId,
} from "@/lib/ocean-bom";

describe("ocean BOM routing", () => {
  it("sends metals and dekton to FRAME, foam and generic fabric to CUSH", () => {
    expect(oceanIngredientBucket(23143123)).toBe("frame");
    expect(oceanIngredientBucket(23178678)).toBe("frame");
    expect(oceanIngredientBucket(41147406)).toBe("frame");
    expect(oceanIngredientBucket(23178514)).toBe("cushion");
    expect(oceanIngredientBucket(23178511)).toBe("cushion");
    expect(oceanIngredientBucket(999)).toBe("unknown");
  });

  it("splits operations across FRAME, CUSH, and FG", () => {
    expect(oceanOperationBucket("Metal Powder Coating")).toBe("frame");
    expect(oceanOperationBucket("Dekton Cutting")).toBe("frame");
    expect(oceanOperationBucket("Fabric Sewing")).toBe("cushion");
    expect(oceanOperationBucket("Quality Check")).toBe("fg");
  });

  it("picks the majority recipe signature as the canonical variant", () => {
    const canonical = pickCanonicalVariantId(
      [1, 2, 3],
      [
        { product_variant_id: 1, ingredient_variant_id: 10, quantity: 1 },
        { product_variant_id: 2, ingredient_variant_id: 10, quantity: 1 },
        { product_variant_id: 3, ingredient_variant_id: 99, quantity: 9 },
      ],
    );
    expect(canonical === 1 || canonical === 2).toBe(true);
  });

  it("builds FG → SA → RM lines for a sofa and frame-only for a coffee table", () => {
    const plan = buildOceanBomPlan({
      products: [
        {
          id: 10592459,
          name: "Ocean Sofa 96",
          category_name: "Ocean Collection",
          variants: [{ id: 11, sku: "OCE-S-96-GR-Y" }],
        },
        {
          id: 10592475,
          name: "Ocean Coffee Table 72 x 56",
          category_name: "Ocean Collection",
          variants: [{ id: 22, sku: "OCE-CT-72X56-WH" }],
        },
      ],
      recipes: [
        {
          product_variant_id: 11,
          ingredient_variant_id: 23143123,
          quantity: 51.5,
        },
        {
          product_variant_id: 11,
          ingredient_variant_id: 23178514,
          quantity: 5.5,
        },
        {
          product_variant_id: 22,
          ingredient_variant_id: 23178678,
          quantity: 28,
        },
      ],
      operations: [
        {
          product_variant_id: 11,
          operation_name: "Metal Cutting",
          rank: 0,
          planned_time_per_unit: 1500,
        },
        {
          product_variant_id: 11,
          operation_name: "Fabric Cutting",
          rank: 100000,
          planned_time_per_unit: 2100,
        },
        {
          product_variant_id: 11,
          operation_name: "Quality Check",
          rank: 800000,
          planned_time_per_unit: 600,
        },
      ],
      fgSkuByModel: new Map([
        ["OCE-S-96", "FIN-OCN-SOF-96X38"],
        ["OCE-CT-72X56", "FIN-OCN-COF-TAB-72X56"],
      ]),
    });

    expect(plan.bomLines).toEqual(
      expect.arrayContaining([
        {
          parentSku: "FIN-OCN-SOF-96X38",
          childSku: "SA-OCE-S-96-FRAME",
          quantity: 1,
          unitOfMeasure: "ea",
        },
        {
          parentSku: "FIN-OCN-SOF-96X38",
          childSku: "SA-OCE-S-96-CUSH",
          quantity: 1,
          unitOfMeasure: "ea",
        },
        {
          parentSku: "SA-OCE-S-96-FRAME",
          childSku: "RM-MET-2X2-TUBING",
          quantity: 51.5,
          unitOfMeasure: "ft",
        },
        {
          parentSku: "SA-OCE-S-96-CUSH",
          childSku: "RM-FAB-GENERIC",
          quantity: 5.5,
          unitOfMeasure: "yd",
        },
        {
          parentSku: "FIN-OCN-COF-TAB-72X56",
          childSku: "SA-OCE-CT-72X56-FRAME",
          quantity: 1,
          unitOfMeasure: "ea",
        },
        {
          parentSku: "SA-OCE-CT-72X56-FRAME",
          childSku: "RM-DKT-GENERIC-SLAB",
          quantity: 28,
          unitOfMeasure: "slab",
        },
      ]),
    );
    expect(
      plan.bomLines.some(
        (line) =>
          line.parentSku === "FIN-OCN-COF-TAB-72X56" &&
          line.childSku.includes("CUSH"),
      ),
    ).toBe(false);

    expect(plan.operations).toEqual([
      {
        itemSku: "SA-OCE-S-96-FRAME",
        workCenter: "Metal Cutting",
        sequence: 10,
        runTimeMins: 25,
      },
      {
        itemSku: "SA-OCE-S-96-CUSH",
        workCenter: "Fabric Cutting",
        sequence: 10,
        runTimeMins: 35,
      },
      {
        itemSku: "FIN-OCN-SOF-96X38",
        workCenter: "Quality Check",
        sequence: 10,
        runTimeMins: 10,
      },
    ]);
  });
});
