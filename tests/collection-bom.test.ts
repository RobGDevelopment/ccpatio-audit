import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/collection-catalog";
import { buildCollectionBomPlan } from "@/lib/collection-bom";
import {
  matchFinishedGoodSku,
  resolveFinishedGoodsByModel,
} from "@/lib/collection-fg-match";

const bravadaSofa = {
  id: 1,
  name: "Brooklyn Sofa 96",
  category_name: "Brooklyn Collection",
  variants: [
    { id: 11, sku: "BRO-S-96-BL" },
    { id: 12, sku: "BRO-S-96-GR" },
  ],
};

const brooklynTable = {
  id: 2,
  name: "Brooklyn Table (Dining Height) 36 x 96",
  category_name: "Brooklyn Collection",
  variants: [{ id: 21, sku: "BRO-DT-96X36-BL" }],
};

describe("buildCollectionBomPlan — empty Katana recipe", () => {
  it("links FG to FRAME and CUSH even with no cut-list", () => {
    const plan = buildCollectionBomPlan({
      products: [bravadaSofa],
      recipes: [],
      operations: [],
      config: COLLECTIONS.brooklyn,
      fgSkuByModel: new Map([["BRO-S-96", "FIN-BRK-SOF-96X34"]]),
    });

    expect(plan.bomLines).toEqual([
      {
        parentSku: "FIN-BRK-SOF-96X34",
        childSku: "SA-BRO-S-96-FRAME",
        quantity: 1,
        unitOfMeasure: "ea",
      },
      {
        parentSku: "FIN-BRK-SOF-96X34",
        childSku: "SA-BRO-S-96-CUSH",
        quantity: 1,
        unitOfMeasure: "ea",
      },
    ]);
    expect(plan.operations).toEqual([]);
    expect(plan.models[0]?.canonicalVariantId).toBeNull();
  });

  it("gives a table a FRAME line only", () => {
    const plan = buildCollectionBomPlan({
      products: [brooklynTable],
      recipes: [],
      operations: [],
      config: COLLECTIONS.brooklyn,
      fgSkuByModel: new Map([["BRO-DT-96X36", "FIN-BRK-DIN-TAB-96X36"]]),
    });

    expect(plan.bomLines).toEqual([
      {
        parentSku: "FIN-BRK-DIN-TAB-96X36",
        childSku: "SA-BRO-DT-96X36-FRAME",
        quantity: 1,
        unitOfMeasure: "ea",
      },
    ]);
  });

  it("still authors the sub-assemblies when no finished good matched", () => {
    const plan = buildCollectionBomPlan({
      products: [bravadaSofa],
      recipes: [],
      operations: [],
      config: COLLECTIONS.brooklyn,
      fgSkuByModel: new Map(),
    });

    expect(plan.bomLines).toEqual([]);
    expect(plan.models[0]).toMatchObject({
      frameSku: "SA-BRO-S-96-FRAME",
      cushSku: "SA-BRO-S-96-CUSH",
      fgSku: null,
    });
    expect(plan.warnings.join(" ")).toContain("no FIN-BRK-* finished good matched");
  });

  it("sums duplicate recipe rows for the same material", () => {
    const plan = buildCollectionBomPlan({
      products: [
        {
          id: 4,
          name: "Bravada Armless Sofa 96",
          category_name: "Bravada Collection",
          variants: [{ id: 41, sku: "BRA-AS-96-BL" }],
        },
      ],
      recipes: [
        { product_variant_id: 41, ingredient_variant_id: 23143123, quantity: 4 },
        { product_variant_id: 41, ingredient_variant_id: 23143123, quantity: 44 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: new Map(),
    });

    const tubing = plan.bomLines.filter(
      (line) => line.childSku === "RM-MET-2X2-TUBING",
    );
    expect(tubing).toHaveLength(1);
    expect(tubing[0]?.quantity).toBe(48);
    expect(plan.warnings.join(" ")).toContain("duplicate recipe rows");
  });

  it("routes a Bravada cut-list into FRAME and CUSH", () => {
    const plan = buildCollectionBomPlan({
      products: [
        {
          id: 3,
          name: "Bravada Sofa 96",
          category_name: "Bravada Collection",
          variants: [{ id: 31, sku: "BRA-S-96-BL" }],
        },
      ],
      recipes: [
        { product_variant_id: 31, ingredient_variant_id: 23143123, quantity: 48 },
        { product_variant_id: 31, ingredient_variant_id: 23178514, quantity: 6 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: new Map([["BRA-S-96", "FIN-BRV-SOF-96X34"]]),
    });

    expect(plan.bomLines).toEqual(
      expect.arrayContaining([
        {
          parentSku: "SA-BRA-S-96-FRAME",
          childSku: "RM-MET-2X2-TUBING",
          quantity: 48,
          unitOfMeasure: "ft",
        },
        {
          parentSku: "SA-BRA-S-96-CUSH",
          childSku: "RM-FAB-GENERIC",
          quantity: 6,
          unitOfMeasure: "yd",
        },
      ]),
    );
  });

  it("keeps each hand's cut-list on its own frame", () => {
    const plan = buildCollectionBomPlan({
      products: [
        {
          id: 5,
          name: "Bravada Chaise 42 X 84",
          category_name: "Bravada Collection",
          variants: [
            { id: 51, sku: "BRA-C-42X84-LS-BL" },
            { id: 52, sku: "BRA-C-42X84-RS-BL" },
          ],
        },
      ],
      recipes: [
        { product_variant_id: 51, ingredient_variant_id: 23143123, quantity: 40 },
        { product_variant_id: 52, ingredient_variant_id: 23143123, quantity: 41 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: new Map([
        ["BRA-C-42X84-LS", "FIN-BRV-CHS-42X84-LS"],
        ["BRA-C-42X84-RS", "FIN-BRV-CHS-42X84-RS"],
      ]),
    });

    const tubing = plan.bomLines.filter(
      (line) => line.childSku === "RM-MET-2X2-TUBING",
    );
    expect(tubing).toEqual([
      {
        parentSku: "SA-BRA-C-42X84-LS-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 40,
        unitOfMeasure: "ft",
      },
      {
        parentSku: "SA-BRA-C-42X84-RS-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 41,
        unitOfMeasure: "ft",
      },
    ]);
    expect(plan.warnings.join(" ")).not.toContain("duplicate recipe rows");
  });

  it("does not give the right hand a cut-list the factory only authored for the left", () => {
    const plan = buildCollectionBomPlan({
      products: [
        {
          id: 6,
          name: "Bravada Chaise 34 X 72",
          category_name: "Bravada Collection",
          variants: [
            { id: 61, sku: "BRA-C-34X72-LS-BL" },
            { id: 62, sku: "BRA-C-34X72-RS-BL" },
          ],
        },
      ],
      recipes: [
        { product_variant_id: 61, ingredient_variant_id: 23143123, quantity: 37 },
      ],
      operations: [],
      config: { ...COLLECTIONS.bravada, mirrorHandedCutLists: false },
      fgSkuByModel: new Map([
        ["BRA-C-34X72-LS", "FIN-BRV-CHS-34X72-LS"],
        ["BRA-C-34X72-RS", "FIN-BRV-CHS-34X72-RS"],
      ]),
    });

    expect(
      plan.bomLines.filter(
        (line) => line.parentSku === "SA-BRA-C-34X72-LS-FRAME",
      ),
    ).toHaveLength(1);
    expect(
      plan.bomLines.filter(
        (line) => line.parentSku === "SA-BRA-C-34X72-RS-FRAME",
      ),
    ).toHaveLength(0);

    const rs = plan.models.find((m) => m.modelCode === "BRA-C-34X72-RS");
    expect(rs?.canonicalVariantId).toBeNull();
    expect(rs?.recipeVariantCount).toBe(0);
  });
});

describe("dekton-top ottoman routing", () => {
  const ottoman = {
    id: 9,
    name: "Bravada Ottoman 34X34",
    category_name: "Bravada Collection",
    variants: [
      { id: 91, sku: "BRA-O-34X34-BL" },
      { id: 92, sku: "BRA-O-34X34-WH" },
      { id: 93, sku: "BRA-ODT-34X34-BL" },
      { id: 94, sku: "BRA-ODT-34X34-WH" },
    ],
  };

  const fgByModel = new Map([
    ["BRA-O-34X34", "FIN-BRV-OTT-34X34"],
    ["BRA-ODT-34X34", "FIN-BRV-OTT-DKT-34X34"],
  ]);

  it("keeps the dekton cut-list off the plain ottoman", () => {
    const plan = buildCollectionBomPlan({
      products: [ottoman],
      // Only the dekton variants carry a recipe, as in the live Katana pull.
      recipes: [
        { product_variant_id: 93, ingredient_variant_id: 23143123, quantity: 12 },
        { product_variant_id: 94, ingredient_variant_id: 23143123, quantity: 12 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(
      plan.bomLines.filter(
        (line) => line.parentSku === "SA-BRA-ODT-34X34-FRAME",
      ),
    ).toHaveLength(1);
    expect(
      plan.bomLines.filter((line) => line.parentSku === "SA-BRA-O-34X34-FRAME"),
    ).toHaveLength(0);
  });

  it("does not mirror across the dekton axis", () => {
    const plan = buildCollectionBomPlan({
      products: [ottoman],
      recipes: [
        { product_variant_id: 93, ingredient_variant_id: 23143123, quantity: 12 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(plan.warnings.join(" ")).not.toContain("mirrored");
  });

  it("gives each axis its own finished good and sub-assemblies", () => {
    const plan = buildCollectionBomPlan({
      products: [ottoman],
      recipes: [],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(plan.models.map((model) => model.modelCode).sort()).toEqual([
      "BRA-O-34X34",
      "BRA-ODT-34X34",
    ]);
    expect(
      plan.bomLines
        .filter((line) => line.parentSku.startsWith("FIN-"))
        .map((line) => `${line.parentSku}->${line.childSku}`)
        .sort(),
    ).toEqual([
      "FIN-BRV-OTT-34X34->SA-BRA-O-34X34-CUSH",
      "FIN-BRV-OTT-34X34->SA-BRA-O-34X34-FRAME",
      "FIN-BRV-OTT-DKT-34X34->SA-BRA-ODT-34X34-CUSH",
      "FIN-BRV-OTT-DKT-34X34->SA-BRA-ODT-34X34-FRAME",
    ]);
  });
});

describe("mirrorHandedCutLists", () => {
  const chaise = (variants: Array<{ id: number; sku: string }>) => ({
    id: 7,
    name: "Bravada Chaise 34 X 72",
    category_name: "Bravada Collection",
    variants,
  });

  const fgByModel = new Map([
    ["BRA-C-34X72-LS", "FIN-BRV-CHS-34X72-LS"],
    ["BRA-C-34X72-RS", "FIN-BRV-CHS-34X72-RS"],
  ]);

  it("copies the authored hand's cut-list onto the empty one", () => {
    const plan = buildCollectionBomPlan({
      products: [
        chaise([
          { id: 71, sku: "BRA-C-34X72-LS-BL" },
          { id: 72, sku: "BRA-C-34X72-RS-BL" },
        ]),
      ],
      recipes: [
        { product_variant_id: 71, ingredient_variant_id: 23143123, quantity: 37 },
        { product_variant_id: 71, ingredient_variant_id: 23178514, quantity: 6 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    const rsFrame = plan.bomLines.filter(
      (line) => line.parentSku === "SA-BRA-C-34X72-RS-FRAME",
    );
    expect(rsFrame).toEqual([
      {
        parentSku: "SA-BRA-C-34X72-RS-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 37,
        unitOfMeasure: "ft",
      },
    ]);

    const rsCush = plan.bomLines.filter(
      (line) => line.parentSku === "SA-BRA-C-34X72-RS-CUSH",
    );
    expect(rsCush.map((line) => line.childSku)).toEqual(["RM-FAB-GENERIC"]);
    expect(plan.warnings.join(" ")).toContain("mirrored 1 rows");
  });

  it("leaves an authored hand alone rather than overwriting it", () => {
    const plan = buildCollectionBomPlan({
      products: [
        chaise([
          { id: 71, sku: "BRA-C-34X72-LS-BL" },
          { id: 72, sku: "BRA-C-34X72-RS-BL" },
        ]),
      ],
      recipes: [
        { product_variant_id: 71, ingredient_variant_id: 23143123, quantity: 37 },
        { product_variant_id: 72, ingredient_variant_id: 23143123, quantity: 41 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(
      plan.bomLines.find(
        (line) => line.parentSku === "SA-BRA-C-34X72-RS-FRAME",
      )?.quantity,
    ).toBe(41);
    expect(plan.warnings.join(" ")).not.toContain("mirrored");
  });

  it("leaves both hands empty when neither was authored", () => {
    const plan = buildCollectionBomPlan({
      products: [
        chaise([
          { id: 71, sku: "BRA-C-34X72-LS-BL" },
          { id: 72, sku: "BRA-C-34X72-RS-BL" },
        ]),
      ],
      recipes: [],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(
      plan.bomLines.filter((line) => line.parentSku.startsWith("SA-")),
    ).toEqual([]);
    expect(plan.warnings.join(" ")).not.toContain("mirrored");
  });

  it("does not mirror onto a model that has no opposite hand", () => {
    const plan = buildCollectionBomPlan({
      products: [chaise([{ id: 71, sku: "BRA-C-34X72-LS-BL" }])],
      recipes: [
        { product_variant_id: 71, ingredient_variant_id: 23143123, quantity: 37 },
      ],
      operations: [],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(plan.models.map((m) => m.modelCode)).toEqual(["BRA-C-34X72-LS"]);
    expect(plan.warnings.join(" ")).not.toContain("mirrored");
  });

  it("mirrors routing alongside the cut-list", () => {
    const plan = buildCollectionBomPlan({
      products: [
        chaise([
          { id: 71, sku: "BRA-C-34X72-LS-BL" },
          { id: 72, sku: "BRA-C-34X72-RS-BL" },
        ]),
      ],
      recipes: [
        { product_variant_id: 71, ingredient_variant_id: 23143123, quantity: 37 },
      ],
      operations: [
        {
          product_variant_id: 71,
          operation_name: "Building & Welding",
          planned_time_per_unit: 1800,
          rank: 1,
        },
      ],
      config: COLLECTIONS.bravada,
      fgSkuByModel: fgByModel,
    });

    expect(
      plan.operations.filter(
        (row) => row.itemSku === "SA-BRA-C-34X72-RS-FRAME",
      ),
    ).toEqual([
      {
        itemSku: "SA-BRA-C-34X72-RS-FRAME",
        workCenter: "Building & Welding",
        sequence: 10,
        runTimeMins: 30,
      },
    ]);
    expect(plan.warnings.join(" ")).toContain("mirrored 1 operations");
  });
});

describe("matchFinishedGoodSku", () => {
  const bravada = [
    { globalSku: "FIN-BRV-COF-TAB-42X28", originalName: "BRAVADA COFFEE TABLE 28 X 42" },
    { globalSku: "FIN-BRV-OTT-42X34", originalName: "BRAVADA OTTOMAN 34 X 42" },
    { globalSku: "FIN-BRV-SOF-96X34", originalName: "BRAVADA SOFA 96" },
    { globalSku: "FIN-BRV-DOU-CHS-58X79", originalName: "BRAVADA DOUBLE CHAISE LOUNGE 58 X 79" },
    { globalSku: "FIN-BRV-LOV-SOF-60X34", originalName: "BRAVADA LOVESEAT 60" },
  ];

  it("matches despite reversed dimension order", () => {
    expect(
      matchFinishedGoodSku("Bravada Coffee Table 42 x 28", COLLECTIONS.bravada, bravada),
    ).toEqual({ globalSku: "FIN-BRV-COF-TAB-42X28", reason: "cat-dims" });
  });

  it("matches unspaced dimensions", () => {
    expect(
      matchFinishedGoodSku("Bravada Ottoman 42X34", COLLECTIONS.bravada, bravada),
    ).toEqual({ globalSku: "FIN-BRV-OTT-42X34", reason: "cat-dims" });
  });

  it("matches a partial size against the fuller PIM size", () => {
    expect(
      matchFinishedGoodSku("Bravada Sofa 96", COLLECTIONS.bravada, bravada),
    ).toEqual({ globalSku: "FIN-BRV-SOF-96X34", reason: "exact-name" });
  });

  it("reorders a trailing Single/Double before the chaise noun", () => {
    expect(
      matchFinishedGoodSku("Bravada Chaise Lounge Double", COLLECTIONS.bravada, bravada),
    ).toEqual({ globalSku: "FIN-BRV-DOU-CHS-58X79", reason: "cat-unique" });
  });

  it("returns null rather than inventing a SKU", () => {
    expect(
      matchFinishedGoodSku("Bravada Club Chair", COLLECTIONS.bravada, bravada),
    ).toBeNull();
    expect(
      matchFinishedGoodSku("Bravada Coffee Table 56 x 28", COLLECTIONS.bravada, bravada),
    ).toBeNull();
  });
});

describe("matchFinishedGoodSku — handedness", () => {
  const handed = [
    {
      globalSku: "FIN-BRV-CHS-34X72-LS",
      originalName: "Bravada Chaise 34 X 72 (Left Facing)",
    },
    {
      globalSku: "FIN-BRV-CHS-34X72-RS",
      originalName: "Bravada Chaise 34 X 72 (Right Facing)",
    },
    { globalSku: "FIN-BRV-SOF-96X34", originalName: "BRAVADA SOFA 96" },
  ];

  it("picks the finished good matching the requested hand", () => {
    expect(
      matchFinishedGoodSku(
        "Bravada Chaise 34 X 72",
        COLLECTIONS.bravada,
        handed,
        "LS",
      ),
    ).toEqual({ globalSku: "FIN-BRV-CHS-34X72-LS", reason: "cat-dims" });
    expect(
      matchFinishedGoodSku(
        "Bravada Chaise 34 X 72",
        COLLECTIONS.bravada,
        handed,
        "RS",
      ),
    ).toEqual({ globalSku: "FIN-BRV-CHS-34X72-RS", reason: "cat-dims" });
  });

  it("will not hand an unhanded model a left- or right-facing SKU", () => {
    expect(
      matchFinishedGoodSku("Bravada Chaise 34 X 72", COLLECTIONS.bravada, handed),
    ).toBeNull();
  });

  it("will not hand a handed model an unhanded SKU", () => {
    expect(
      matchFinishedGoodSku("Bravada Sofa 96", COLLECTIONS.bravada, handed, "LS"),
    ).toBeNull();
  });

  it("splits one Katana product into two claims, one per hand", () => {
    const resolution = resolveFinishedGoodsByModel({
      config: COLLECTIONS.bravada,
      candidates: handed,
      products: [
        {
          id: 1,
          name: "Bravada Chaise 34 X 72",
          category_name: "Bravada Collection",
          variants: [
            { id: 11, sku: "BRA-C-34X72-LS-BL" },
            { id: 12, sku: "BRA-C-34X72-RS-BL" },
          ],
        },
      ],
    });

    expect(resolution.unmatched).toEqual([]);
    expect(resolution.fgSkuByModel.get("BRA-C-34X72-LS")).toBe(
      "FIN-BRV-CHS-34X72-LS",
    );
    expect(resolution.fgSkuByModel.get("BRA-C-34X72-RS")).toBe(
      "FIN-BRV-CHS-34X72-RS",
    );
  });
});

describe("FG_BY_MODEL_CODE", () => {
  it("splits one Katana product name across two finished goods", () => {
    const resolution = resolveFinishedGoodsByModel({
      products: [
        {
          id: 9,
          name: "Bravada Ottoman 34X34",
          category_name: "Bravada Collection",
          variants: [
            { id: 91, sku: "BRA-O-34X34-BL" },
            { id: 92, sku: "BRA-ODT-34X34-BL" },
          ],
        },
      ],
      config: COLLECTIONS.bravada,
      candidates: [
        {
          globalSku: "FIN-BRV-OTT-34X34",
          originalName: "BRAVADA OTTOMAN 34 X 34",
        },
        {
          globalSku: "FIN-BRV-OTT-DKT-34X34",
          originalName: "BRAVADA OTTOMAN 34X34 (DEKTON TOP)",
        },
      ],
    });

    expect(resolution.unmatched).toEqual([]);
    expect(resolution.fgSkuByModel.get("BRA-ODT-34X34")).toBe(
      "FIN-BRV-OTT-DKT-34X34",
    );
    expect(resolution.fgSkuByModel.get("BRA-O-34X34")).toBe(
      "FIN-BRV-OTT-34X34",
    );
  });

  it("leaves a mapped model unmatched when its finished good is absent", () => {
    const resolution = resolveFinishedGoodsByModel({
      products: [
        {
          id: 9,
          name: "Bravada Ottoman 34X34",
          category_name: "Bravada Collection",
          variants: [{ id: 92, sku: "BRA-ODT-34X34-BL" }],
        },
      ],
      config: COLLECTIONS.bravada,
      candidates: [
        {
          globalSku: "FIN-BRV-OTT-34X34",
          originalName: "BRAVADA OTTOMAN 34 X 34",
        },
      ],
    });

    // Never falls back to the plain ottoman's finished good.
    expect(resolution.unmatched.map((row) => row.modelCode)).toEqual([
      "BRA-ODT-34X34",
    ]);
    expect(resolution.fgSkuByModel.size).toBe(0);
  });

  it("keeps the two daybed lines on their own finished goods", () => {
    const resolution = resolveFinishedGoodsByModel({
      products: [
        {
          id: 10,
          name: "Bravada Cabana Daybed 72",
          category_name: "Bravada Collection",
          variants: [{ id: 101, sku: "BRA-CADA-72X78-BL" }],
        },
        {
          id: 11,
          name: "Bravada Daybed 72",
          category_name: "Bravada Collection",
          variants: [{ id: 111, sku: "BRA-D-7272-BL" }],
        },
      ],
      config: COLLECTIONS.bravada,
      candidates: [
        {
          globalSku: "FIN-BRV-DYB-72X78",
          originalName: "BRAVADA DAYBED 72 X 78",
        },
        {
          globalSku: "FIN-BRV-DYB-72X72",
          originalName: "BRAVADA DAYBED 72",
        },
      ],
    });

    expect(resolution.unmatched).toEqual([]);
    expect(resolution.fgSkuByModel.get("BRA-CADA-72X78")).toBe(
      "FIN-BRV-DYB-72X78",
    );
    expect(resolution.fgSkuByModel.get("BRA-D-7272")).toBe(
      "FIN-BRV-DYB-72X72",
    );
  });
});

describe("resolveFinishedGoodsByModel", () => {
  it("leaves both products unlinked when they claim one FG at equal confidence", () => {
    const resolution = resolveFinishedGoodsByModel({
      config: COLLECTIONS.bravada,
      // The PIM name matches neither product, so both claim it by cat-dims.
      candidates: [
        { globalSku: "FIN-BRV-OTT-42X34", originalName: "BRAVADA OTTOMAN LARGE" },
      ],
      products: [
        {
          id: 1,
          name: "Bravada Ottoman 34 X 42",
          category_name: "Bravada Collection",
          variants: [{ id: 11, sku: "BRA-O-34X42-BL" }],
        },
        {
          id: 2,
          name: "Bravada Ottoman 42 X 34",
          category_name: "Bravada Collection",
          variants: [{ id: 21, sku: "BRA-O-42X34-BL" }],
        },
      ],
    });

    expect(resolution.fgSkuByModel.size).toBe(0);
    expect(resolution.unmatched.map((row) => row.modelCode).sort()).toEqual([
      "BRA-O-34X42",
      "BRA-O-42X34",
    ]);
    expect(resolution.warnings.join(" ")).toContain("equal confidence");
  });

  it("awards the daybed SKU to Cabana, leaving the retiring plain product unlinked", () => {
    const resolution = resolveFinishedGoodsByModel({
      config: COLLECTIONS.bravada,
      candidates: [
        { globalSku: "FIN-BRV-DYB-84X78", originalName: "BRAVADA DAYBED 84 X 78" },
      ],
      products: [
        {
          id: 1,
          name: "Bravada Daybed 84",
          category_name: "Bravada Collection",
          variants: [{ id: 11, sku: "BRA-D-8478-BL" }],
        },
        {
          id: 2,
          name: "Bravada Cabana Daybed 84",
          category_name: "Bravada Collection",
          variants: [{ id: 21, sku: "BRA-CADA-84X78-BL" }],
        },
      ],
    });

    expect(resolution.fgSkuByModel.get("BRA-CADA-84X78")).toBe(
      "FIN-BRV-DYB-84X78",
    );
    expect(resolution.unmatched.map((row) => row.modelCode)).toEqual([
      "BRA-D-8478",
    ]);
  });

  it("keeps the higher-confidence claim and drops the weaker one", () => {
    const resolution = resolveFinishedGoodsByModel({
      config: COLLECTIONS.bravada,
      candidates: [
        { globalSku: "FIN-BRV-LOV-SOF-60X34", originalName: "BRAVADA LOVESEAT 60" },
      ],
      products: [
        {
          id: 1,
          name: "Bravada Loveseat",
          category_name: "Bravada Collection",
          variants: [{ id: 11, sku: "BRA-L-BL" }],
        },
        {
          id: 2,
          name: "Bravada Armless Loveseat",
          category_name: "Bravada Collection",
          variants: [{ id: 21, sku: "BRA-AL-60-BL" }],
        },
      ],
    });

    expect(resolution.fgSkuByModel.get("BRA-L")).toBe("FIN-BRV-LOV-SOF-60X34");
    expect(resolution.unmatched.map((row) => row.modelCode)).toEqual(["BRA-AL-60"]);
  });
});
