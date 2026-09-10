import { describe, expect, it } from "vitest";
import {
  bottomUpSkuOrder,
  buildKatanaPublishPlan,
  formatKatanaRecipeRowsForParent,
  formatSingleBomEdgeRecipe,
} from "@/mappers/katana";
import { mapFinishedGoodToWooCommerce } from "@/mappers/woocommerce";
import { mapFinishedGoodToClover } from "@/mappers/clover";
import { OCEAN_SOFA_GRAPH } from "./fixtures/ocean-sofa-graph";

describe("Katana mapper (Ocean Sofa fixture)", () => {
  it("orders SKUs bottom-up: materials before SAs before FG", () => {
    const order = bottomUpSkuOrder(OCEAN_SOFA_GRAPH);
    expect(order.indexOf("RM-MET-EXT-2X2")).toBeLessThan(
      order.indexOf("SA-OCN-SOF-FRAME"),
    );
    expect(order.indexOf("RM-FAB-GENERIC")).toBeLessThan(
      order.indexOf("SA-OCN-SOF-CUSH"),
    );
    expect(order.indexOf("SA-OCN-SOF-FRAME")).toBeLessThan(
      order.indexOf("FIN-OCN-SOF-96X38"),
    );
    expect(order[order.length - 1]).toBe("FIN-OCN-SOF-96X38");
  });

  it("applies quantity * scrap_factor on recipe rows", () => {
    const frame = formatKatanaRecipeRowsForParent(
      OCEAN_SOFA_GRAPH,
      "SA-OCN-SOF-FRAME",
    );
    expect(frame.rows).toHaveLength(1);
    expect(frame.rows[0].quantity).toBeCloseTo(24 * 1.05);
    expect(frame.rows[0].child_sku).toBe("RM-MET-EXT-2X2");
  });

  it("builds a publish plan with Idempotency-Key hooks and no HTTP side effects", () => {
    const plan = buildKatanaPublishPlan(OCEAN_SOFA_GRAPH);

    expect(plan.map((r) => r.kind)).toEqual([
      "material",
      "material",
      "product",
      "product",
      "product",
      "recipes",
      "recipes",
      "recipes",
      "product_operation_rows",
      "product_operation_rows",
    ]);

    const materials = plan.filter((r) => r.kind === "material");
    expect(materials[0].path).toBe("/materials");
    expect(materials[0].idempotencyKey).toMatch(/^katana-material-/);
    expect(materials[0].body.variants).toEqual([
      expect.objectContaining({ sku: expect.any(String) }),
    ]);

    const fgProduct = plan.find(
      (r) => r.kind === "product" && r.sku === "FIN-OCN-SOF-96X38",
    );
    expect(fgProduct?.body).toMatchObject({
      name: "Ocean Sofa 96x38",
      is_sellable: true,
      is_producible: true,
      variants: [{ sku: "FIN-OCN-SOF-96X38", sales_price: 4850 }],
    });

    const frameRecipes = plan.find(
      (r) => r.kind === "recipes" && r.sku === "SA-OCN-SOF-FRAME",
    );
    expect(frameRecipes?.body).toMatchObject({
      keep_current_rows: false,
      rows: [
        expect.objectContaining({
          quantity: 24 * 1.05,
          product_variant_id: 2001,
          ingredient_variant_id: 1001,
        }),
      ],
    });

    const frameOps = plan.find(
      (r) =>
        r.kind === "product_operation_rows" && r.sku === "SA-OCN-SOF-FRAME",
    );
    expect(frameOps?.path).toBe("/product_operation_rows");
    expect(frameOps?.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "setup",
          resource_name: "Welding",
          planned_time_parameter: 15 * 60,
        }),
        expect.objectContaining({
          type: "process",
          resource_name: "Welding",
          planned_time_parameter: 45 * 60,
        }),
      ]),
    );

    for (const req of plan) {
      expect(req.idempotencyKey.length).toBeGreaterThan(0);
      expect(req.method).toBe("POST");
    }
  });

  it("formats a single edge recipe with scrap (orchestrator merge)", () => {
    expect(
      formatSingleBomEdgeRecipe({
        parentVariantId: 10,
        childVariantId: 20,
        quantity: 2,
        scrapFactor: 1.5,
        unitOfMeasure: "ea",
      }),
    ).toEqual({
      product_variant_id: 10,
      ingredient_variant_id: 20,
      quantity: 3,
      notes: "ea",
    });
  });
});

describe("WooCommerce mapper", () => {
  it("maps MSRP/SEO/slug/image when sync_to_woo is true", () => {
    const result = mapFinishedGoodToWooCommerce(OCEAN_SOFA_GRAPH.commerce);
    expect(result.skip).toBe(false);
    if (result.skip) return;
    expect(result.idempotencyKey).toBe("woo-product-FIN-OCN-SOF-96X38");
    expect(result.payload).toEqual({
      name: "Ocean Sofa 96x38",
      type: "simple",
      sku: "FIN-OCN-SOF-96X38",
      regular_price: "4850.00",
      description: "Luxury fully-welded outdoor sofa with wood-grain finish.",
      short_description: "Ocean Sofa 96x38 | CC Patio",
      slug: "ocean-sofa-96x38",
      status: "publish",
      manage_stock: false,
      images: [
        {
          src: "https://cdn.example.com/ocean-sofa.jpg",
          name: "FIN-OCN-SOF-96X38",
        },
      ],
      meta_data: [{ key: "_ccpatio_global_sku", value: "FIN-OCN-SOF-96X38" }],
    });
  });

  it("skips when sync_to_woo is false", () => {
    const result = mapFinishedGoodToWooCommerce({
      ...OCEAN_SOFA_GRAPH.commerce,
      syncToWoo: false,
    });
    expect(result).toEqual({ skip: true, reason: "sync_to_woo_false" });
  });
});

describe("Clover mapper", () => {
  it("maps price to integer cents when retail flag is true", () => {
    const result = mapFinishedGoodToClover(OCEAN_SOFA_GRAPH.commerce);
    expect(result.skip).toBe(false);
    if (result.skip) return;
    expect(result.idempotencyKey).toBe("clover-item-FIN-OCN-SOF-96X38");
    expect(result.payload).toEqual({
      name: "Ocean Sofa 96x38",
      sku: "FIN-OCN-SOF-96X38",
      price: 485000,
      priceType: "FIXED",
      hidden: false,
      available: true,
      autoManage: false,
    });
  });

  it("skips when sync_to_clover is false", () => {
    const result = mapFinishedGoodToClover({
      ...OCEAN_SOFA_GRAPH.commerce,
      syncToClover: false,
    });
    expect(result).toEqual({ skip: true, reason: "sync_to_clover_false" });
  });
});
