import { describe, expect, it } from "vitest";
import { buildKatanaPublishPlan } from "@/mappers/katana";
import {
  GENERIC_FABRIC_SKU,
  KatanaCatalogPublishError,
  draftDefaultKatanaRecipe,
  isColorwaySku,
  stageKatanaCatalogGraph,
} from "@/mappers/katana-catalog-guard";
import type { HubProductGraph } from "@/mappers/types";
import { OCEAN_SOFA_GRAPH } from "./fixtures/ocean-sofa-graph";

function cloneGraph(overrides: Partial<HubProductGraph> = {}): HubProductGraph {
  return {
    ...OCEAN_SOFA_GRAPH,
    skus: [...OCEAN_SOFA_GRAPH.skus],
    edges: [...OCEAN_SOFA_GRAPH.edges],
    operations: [...OCEAN_SOFA_GRAPH.operations],
    commerce: { ...OCEAN_SOFA_GRAPH.commerce },
    ...overrides,
  };
}

describe("isColorwaySku", () => {
  it("treats FAB-/PWD-/STN- as colorways and RM placeholders as not", () => {
    expect(isColorwaySku("FAB-ACT-ASH")).toBe(true);
    expect(isColorwaySku("PWD-BLACK")).toBe(true);
    expect(isColorwaySku("STN-DKT-AT2")).toBe(true);
    expect(isColorwaySku(GENERIC_FABRIC_SKU)).toBe(false);
    expect(isColorwaySku("RM-PWD-GENERIC")).toBe(false);
    expect(isColorwaySku("RM-MET-2X2-TUBING")).toBe(false);
  });
});

describe("stageKatanaCatalogGraph", () => {
  it("accepts the Ocean sofa default FRAME/CUSH recipe", () => {
    const staged = stageKatanaCatalogGraph(OCEAN_SOFA_GRAPH);
    expect(staged.strippedColorwaySkus).toEqual([]);
    expect(staged.graph.rootSku).toBe("FIN-OCN-SOF-96X38");
    const draft = draftDefaultKatanaRecipe(OCEAN_SOFA_GRAPH);
    expect(draft.finishedGoodSku).toBe("FIN-OCN-SOF-96X38");
    expect(draft.frameSku).toBe("SA-OCN-SOF-FRAME");
    expect(draft.cushSku).toBe("SA-OCN-SOF-CUSH");
    expect(draft.finishedGoodProduct).toMatchObject({
      is_sellable: true,
      variants: [{ sku: "FIN-OCN-SOF-96X38" }],
    });
    expect(draft.recipes.map((row) => row.parentSku)).toEqual([
      "FIN-OCN-SOF-96X38",
      "SA-OCN-SOF-FRAME",
      "SA-OCN-SOF-CUSH",
    ]);
    expect(
      draft.recipes
        .find((row) => row.parentSku === "SA-OCN-SOF-CUSH")
        ?.rows.map((line) => line.child_sku),
    ).toEqual([GENERIC_FABRIC_SKU]);
  });

  it("rejects a non-FIN root", () => {
    expect(() =>
      stageKatanaCatalogGraph(
        cloneGraph({ rootSku: "SA-OCN-SOF-FRAME" }),
      ),
    ).toThrow(KatanaCatalogPublishError);
  });

  it("rejects a second finished good (cartesian FG explosion)", () => {
    const graph = cloneGraph({
      skus: [
        ...OCEAN_SOFA_GRAPH.skus,
        {
          globalSku: "FIN-OCN-SOF-96X38-GA-BLK",
          itemType: "finished_good",
          originalName: "Ocean Sofa 96x38 Grade A Black",
          category: "Furniture",
        },
      ],
    });
    expect(() => stageKatanaCatalogGraph(graph)).toThrow(/Cartesian explosion/);
  });

  it("strips FAB-* from CUSH and keeps RM-FAB-GENERIC", () => {
    const graph = cloneGraph({
      skus: [
        ...OCEAN_SOFA_GRAPH.skus,
        {
          globalSku: "FAB-ACT-ASH",
          itemType: "raw_material",
          originalName: "Action Ash",
          category: "Fabric",
        },
      ],
      edges: [
        ...OCEAN_SOFA_GRAPH.edges,
        {
          parentSku: "SA-OCN-SOF-CUSH",
          childSku: "FAB-ACT-ASH",
          quantity: 6,
          scrapFactor: 1,
          unitOfMeasure: "yd",
        },
      ],
    });
    const staged = stageKatanaCatalogGraph(graph);
    expect(staged.strippedColorwaySkus).toEqual(["FAB-ACT-ASH"]);
    expect(
      staged.graph.edges.some((edge) => edge.childSku === "FAB-ACT-ASH"),
    ).toBe(false);
    expect(
      staged.graph.edges.some((edge) => edge.childSku === GENERIC_FABRIC_SKU),
    ).toBe(true);
  });

  it("fails when CUSH only has FAB-* and no generic placeholder", () => {
    const graph = cloneGraph({
      skus: [
        ...OCEAN_SOFA_GRAPH.skus.filter(
          (node) => node.globalSku !== GENERIC_FABRIC_SKU,
        ),
        {
          globalSku: "FAB-ACT-ASH",
          itemType: "raw_material",
          originalName: "Action Ash",
          category: "Fabric",
        },
      ],
      edges: OCEAN_SOFA_GRAPH.edges.map((edge) =>
        edge.childSku === GENERIC_FABRIC_SKU
          ? { ...edge, childSku: "FAB-ACT-ASH" }
          : edge,
      ),
    });
    expect(() => stageKatanaCatalogGraph(graph)).toThrow(/RM-FAB-GENERIC/);
  });

  it("rejects colorways hanging directly off the FIN", () => {
    const graph = cloneGraph({
      edges: [
        ...OCEAN_SOFA_GRAPH.edges,
        {
          parentSku: "FIN-OCN-SOF-96X38",
          childSku: "PWD-BLACK",
          quantity: 1,
          scrapFactor: 1,
          unitOfMeasure: "lb",
        },
      ],
    });
    expect(() => stageKatanaCatalogGraph(graph)).toThrow(/SA-\*-FRAME/);
  });
});

describe("buildKatanaPublishPlan cartesian guard", () => {
  it("publishes exactly one sellable FIN variant and never a FAB product", () => {
    const plan = buildKatanaPublishPlan(OCEAN_SOFA_GRAPH);
    const products = plan.filter((row) => row.kind === "product");
    const sellable = products.filter((row) => row.body.is_sellable === true);
    expect(sellable).toHaveLength(1);
    expect(sellable[0]?.sku).toBe("FIN-OCN-SOF-96X38");
    expect(sellable[0]?.body.variants).toEqual([
      expect.objectContaining({ sku: "FIN-OCN-SOF-96X38" }),
    ]);
    expect(products.every((row) => Array.isArray(row.body.variants) && row.body.variants.length === 1)).toBe(
      true,
    );
    expect(plan.some((row) => String(row.sku ?? "").startsWith("FAB-"))).toBe(
      false,
    );
  });

  it("does not POST stripped colorways as materials", () => {
    const graph = cloneGraph({
      skus: [
        ...OCEAN_SOFA_GRAPH.skus,
        {
          globalSku: "FAB-ACT-ASH",
          itemType: "raw_material",
          originalName: "Action Ash",
          category: "Fabric",
        },
        {
          globalSku: "PWD-BLACK",
          itemType: "raw_material",
          originalName: "Black powder",
          category: "Powder",
        },
      ],
      edges: [
        ...OCEAN_SOFA_GRAPH.edges,
        {
          parentSku: "SA-OCN-SOF-CUSH",
          childSku: "FAB-ACT-ASH",
          quantity: 6,
          scrapFactor: 1,
          unitOfMeasure: "yd",
        },
        {
          parentSku: "SA-OCN-SOF-FRAME",
          childSku: "PWD-BLACK",
          quantity: 2,
          scrapFactor: 1,
          unitOfMeasure: "lb",
        },
      ],
    });
    const plan = buildKatanaPublishPlan(graph);
    const materialSkus = plan
      .filter((row) => row.kind === "material")
      .map((row) => row.sku);
    expect(materialSkus).not.toContain("FAB-ACT-ASH");
    expect(materialSkus).not.toContain("PWD-BLACK");
    expect(materialSkus).toContain(GENERIC_FABRIC_SKU);
  });
});
