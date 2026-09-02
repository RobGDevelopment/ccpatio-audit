import { describe, expect, it } from "vitest";
import {
  baseOfStem,
  buildSubAssemblies,
  COLLECTIONS,
  directionOfStem,
  distinctStems,
  modelCodeFromSkus,
  modelCodesFromSkus,
  normalizeVariantSku,
  productNeedsCushion,
  skusForModel,
  stripVariantSuffix,
} from "@/lib/collection-catalog";

describe("stripVariantSuffix", () => {
  it("drops color tokens but keeps LS/RS handedness", () => {
    expect(stripVariantSuffix("BRA-C-34X72-LS-BE")).toBe("BRA-C-34X72-LS");
    expect(stripVariantSuffix("BRA-C-34X72-RS-BL")).toBe("BRA-C-34X72-RS");
    expect(stripVariantSuffix("BRO-CS-96-LS-GR")).toBe("BRO-CS-96-LS");
  });

  it("drops every trailing color for the collections in scope", () => {
    for (const color of ["BL", "WH", "BR", "BE", "BO", "GR"]) {
      expect(stripVariantSuffix(`BRA-S-96-${color}`)).toBe("BRA-S-96");
      expect(stripVariantSuffix(`BRO-S-72-${color}`)).toBe("BRO-S-72");
    }
  });

  it("still strips the Ocean dekton flag ahead of the color", () => {
    expect(stripVariantSuffix("OCE-S-96-GR-Y")).toBe("OCE-S-96");
    expect(stripVariantSuffix("OCE-CT-72X56-WH-N")).toBe("OCE-CT-72X56");
  });

  it("leaves a bare stem untouched", () => {
    expect(stripVariantSuffix("BRA-CL-D")).toBe("BRA-CL-D");
  });
});

describe("modelCodeFromSkus", () => {
  it("takes the majority stem across a product's variants", () => {
    expect(
      modelCodeFromSkus(
        ["BRA-CT-36X36-BL", "BRA-CT-36X36-WT", "BRA-CT-36X36-BR"],
        "BRA",
      ),
    ).toBe("BRA-CT-36X36");
  });

  it("breaks LS/RS ties alphabetically so reruns are stable", () => {
    const skus = [
      "BRO-CS-96-LS-BL",
      "BRO-CS-96-LS-WH",
      "BRO-CS-96-RS-BL",
      "BRO-CS-96-RS-WH",
    ];
    expect(modelCodeFromSkus(skus, "BRO")).toBe("BRO-CS-96-LS");
    expect(modelCodeFromSkus([...skus].reverse(), "BRO")).toBe("BRO-CS-96-LS");
  });

  it("reports the collapsed stems so factory data drift stays visible", () => {
    expect(
      distinctStems(["BRA-O-34X34-BL", "BRA-ODT-34X34-BL"], "BRA"),
    ).toEqual(["BRA-O-34X34", "BRA-ODT-34X34"]);
  });
});

describe("normalizeVariantSku", () => {
  it("reinserts the hyphen the factory dropped before LS/RS", () => {
    expect(normalizeVariantSku("BRA-C-34X84LS-BO")).toBe("BRA-C-34X84-LS-BO");
    expect(normalizeVariantSku("BRA-C-34X84RS-WH")).toBe("BRA-C-34X84-RS-WH");
  });

  it("normalizes a trailing directional token with no color", () => {
    expect(normalizeVariantSku("BRA-C-34X84LS")).toBe("BRA-C-34X84-LS");
  });

  it("leaves well-formed SKUs and color tokens alone", () => {
    expect(normalizeVariantSku("BRA-C-34X84-LS-BO")).toBe("BRA-C-34X84-LS-BO");
    expect(normalizeVariantSku("OCE-CT-72X56-WH-N")).toBe("OCE-CT-72X56-WH-N");
    expect(normalizeVariantSku("BRA-CL-D-A")).toBe("BRA-CL-D-A");
  });

  it("feeds stripVariantSuffix so a malformed SKU still stems correctly", () => {
    expect(stripVariantSuffix("BRA-C-34X84LS-BO")).toBe("BRA-C-34X84-LS");
  });
});

describe("directionOfStem / baseOfStem", () => {
  it("reads and removes the directional token", () => {
    expect(directionOfStem("BRA-C-34X72-LS")).toBe("LS");
    expect(directionOfStem("BRA-C-34X72-RS")).toBe("RS");
    expect(baseOfStem("BRA-C-34X72-LS")).toBe("BRA-C-34X72");
  });

  it("treats a symmetric stem as unhanded", () => {
    expect(directionOfStem("BRA-CT-42X28")).toBeNull();
    expect(baseOfStem("BRA-CT-42X28")).toBe("BRA-CT-42X28");
  });
});

describe("modelCodesFromSkus", () => {
  it("splits a handed product into one model per direction", () => {
    expect(
      modelCodesFromSkus(
        [
          "BRA-C-34X72-LS-BL",
          "BRA-C-34X72-LS-WH",
          "BRA-C-34X72-RS-BL",
          "BRA-C-34X72-RS-WH",
        ],
        "BRA",
      ),
    ).toEqual(["BRA-C-34X72-LS", "BRA-C-34X72-RS"]);
  });

  it("is order-independent so reruns are deterministic", () => {
    const skus = ["BRO-CS-96-RS-WH", "BRO-CS-96-LS-BL", "BRO-CS-96-RS-BL"];
    expect(modelCodesFromSkus(skus, "BRO")).toEqual(
      modelCodesFromSkus([...skus].reverse(), "BRO"),
    );
  });

  it("emits only the directions actually stocked", () => {
    expect(
      modelCodesFromSkus(["BRA-C-42X84-LS-BL", "BRA-C-42X84-LS-GR"], "BRA"),
    ).toEqual(["BRA-C-42X84-LS"]);
  });

  it("splits the dekton-top ottoman from the plain one", () => {
    expect(
      modelCodesFromSkus(
        [
          "BRA-O-34X34-BL",
          "BRA-O-34X34-WH",
          "BRA-O-34X34-GR",
          "BRA-ODT-34X34-BL",
        ],
        "BRA",
      ),
    ).toEqual(["BRA-O-34X34", "BRA-ODT-34X34"]);
  });

  it("splits the no-metal-arms chaise lounge from the standard one", () => {
    expect(
      modelCodesFromSkus(
        ["BRA-CL-D-BL", "BRA-CL-D-WH", "BRA-CL-D-GR", "BRA-CL-D-A-BL"],
        "BRA",
      ),
    ).toEqual(["BRA-CL-D", "BRA-CL-D-A"]);
  });

  it("still collapses base-level noise so a typo cannot mint a model", () => {
    // A transposed dimension changes the base, not an axis, so it is absorbed.
    expect(
      modelCodesFromSkus(
        [
          "BRA-CT-42X28-BL",
          "BRA-CT-42X28-WH",
          "BRA-CT-42X28-GR",
          "BRA-CT-28X42-BR",
        ],
        "BRA",
      ),
    ).toEqual(["BRA-CT-42X28"]);
  });

  it("reads the dekton segment only in the category position", () => {
    // ODT anywhere but immediately after the prefix is part of the base.
    expect(modelCodesFromSkus(["BRA-CT-ODT-BL"], "BRA")).toEqual([
      "BRA-CT-ODT",
    ]);
  });

  it("keeps handedness while collapsing a transposed-dimension typo", () => {
    expect(
      modelCodesFromSkus(
        [
          "BRA-C-42X84-LS-BL",
          "BRA-C-42X84-LS-WH",
          "BRA-C-42X84-RS-BL",
          "BRA-C-84X42-LS-BR",
        ],
        "BRA",
      ),
    ).toEqual(["BRA-C-42X84-LS", "BRA-C-42X84-RS"]);
  });

  it("normalizes a malformed token into the right handed model", () => {
    expect(
      modelCodesFromSkus(["BRA-C-34X84LS-BO", "BRA-C-34X84-LS-BL"], "BRA"),
    ).toEqual(["BRA-C-34X84-LS"]);
  });
});

describe("skusForModel", () => {
  const skus = [
    "BRA-C-34X72-LS-BL",
    "BRA-C-34X72-LS-WH",
    "BRA-C-34X72-RS-BL",
    "BRA-C-34X72-BL",
  ];

  it("returns only the variants of the requested hand", () => {
    expect(skusForModel(skus, "BRA-C-34X72-LS", "BRA")).toEqual([
      "BRA-C-34X72-LS-BL",
      "BRA-C-34X72-LS-WH",
    ]);
    expect(skusForModel(skus, "BRA-C-34X72-RS", "BRA")).toEqual([
      "BRA-C-34X72-RS-BL",
    ]);
  });

  it("returns every variant for a symmetric model", () => {
    const table = ["BRA-CT-42X28-BL", "BRA-CT-42X28-WH"];
    expect(skusForModel(table, "BRA-CT-42X28", "BRA")).toEqual(table);
  });
});

describe("productNeedsCushion", () => {
  it("is true for seating", () => {
    for (const name of [
      "Bravada Sofa 96",
      "Bravada Corner Sofa 72",
      "Bravada Loveseat",
      "Bravada Club Chair",
      "Bravada Chaise 34 X 72",
      "Bravada Ottoman 34X34",
      "Bravada Daybed 84",
      "Brooklyn Transitional Chaise Double",
    ]) {
      expect(productNeedsCushion(name), name).toBe(true);
    }
  });

  it("is false for tables", () => {
    for (const name of [
      "Bravada Coffee Table 42 x 28",
      "Bravada Side Table 20 x 20",
      "Brooklyn Table (Bar Height) 28 x 120",
    ]) {
      expect(productNeedsCushion(name), name).toBe(false);
    }
  });
});

describe("buildSubAssemblies", () => {
  const products = [
    {
      id: 1,
      name: "Bravada Chaise 34 X 72",
      category_name: "Bravada Collection",
      variants: [
        { id: 11, sku: "BRA-C-34X72-LS-BL" },
        { id: 12, sku: "BRA-C-34X72-LS-BE" },
      ],
    },
    {
      id: 2,
      name: "Bravada Coffee Table 42 x 28",
      category_name: "Bravada Collection",
      variants: [{ id: 21, sku: "BRA-CT-42X28-BL" }],
    },
    {
      id: 3,
      name: "Brooklyn Sofa 96",
      category_name: "Brooklyn Collection",
      variants: [{ id: 31, sku: "BRO-S-96-BL" }],
    },
  ];

  it("emits FRAME + CUSH for seating and FRAME only for tables", () => {
    const rows = buildSubAssemblies(products, COLLECTIONS.bravada);
    expect(rows.map((row) => row.globalSku)).toEqual([
      "SA-BRA-C-34X72-LS-CUSH",
      "SA-BRA-C-34X72-LS-FRAME",
      "SA-BRA-CT-42X28-FRAME",
    ]);
  });

  it("emits a separate FRAME/CUSH pair per hand, counting variants per hand", () => {
    const rows = buildSubAssemblies(
      [
        {
          id: 4,
          name: "Bravada Chaise 42 X 84",
          category_name: "Bravada Collection",
          variants: [
            { id: 41, sku: "BRA-C-42X84-LS-BL" },
            { id: 42, sku: "BRA-C-42X84-LS-WH" },
            { id: 43, sku: "BRA-C-42X84-RS-BL" },
          ],
        },
      ],
      COLLECTIONS.bravada,
    );
    expect(rows.map((row) => row.globalSku)).toEqual([
      "SA-BRA-C-42X84-LS-CUSH",
      "SA-BRA-C-42X84-LS-FRAME",
      "SA-BRA-C-42X84-RS-CUSH",
      "SA-BRA-C-42X84-RS-FRAME",
    ]);
    expect(
      rows.find((row) => row.globalSku === "SA-BRA-C-42X84-LS-FRAME")
        ?.variantCount,
    ).toBe(2);
    expect(
      rows.find((row) => row.globalSku === "SA-BRA-C-42X84-RS-FRAME")
        ?.variantCount,
    ).toBe(1);
  });

  it("ignores products outside the configured Katana category", () => {
    const rows = buildSubAssemblies(products, COLLECTIONS.brooklyn);
    expect(rows.map((row) => row.globalSku)).toEqual([
      "SA-BRO-S-96-CUSH",
      "SA-BRO-S-96-FRAME",
    ]);
    expect(rows.every((row) => row.collection === "brooklyn")).toBe(true);
  });
});
