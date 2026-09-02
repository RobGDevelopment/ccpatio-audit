import { describe, expect, it } from "vitest";
import {
  buildOceanSubAssemblies,
  oceanModelCodeFromSkus,
  oceanProductNeedsCushion,
  stripOceanVariantSuffix,
} from "@/lib/ocean-subassemblies";
import { KATANA_BULK_MATERIALS } from "@/lib/katana-bulk-materials";

describe("ocean model codes", () => {
  it("strips color and dekton-top flags from variant SKUs", () => {
    expect(stripOceanVariantSuffix("OCE-S-96-GR-Y")).toBe("OCE-S-96");
    expect(stripOceanVariantSuffix("OCE-CT-72X56-BR")).toBe("OCE-CT-72X56");
    expect(stripOceanVariantSuffix("OCE-SC-BL")).toBe("OCE-SC");
  });

  it("picks the majority stem across a product's variants", () => {
    expect(
      oceanModelCodeFromSkus([
        "OCE-S-96-GR-Y",
        "OCE-S-96-BL-Y",
        "OCE-S-96-WH-N",
      ]),
    ).toBe("OCE-S-96");
  });

  it("adds CUSH only for seating names", () => {
    expect(oceanProductNeedsCushion("Ocean Sofa 96")).toBe(true);
    expect(oceanProductNeedsCushion("Ocean Swivel Chair")).toBe(true);
    expect(oceanProductNeedsCushion("Ocean Coffee Table 72 x 56")).toBe(false);
    expect(oceanProductNeedsCushion("Ocean Round Side Table 42")).toBe(false);
  });

  it("emits one FRAME per Ocean product and CUSH for seating", () => {
    const rows = buildOceanSubAssemblies([
      {
        id: 10592459,
        name: "Ocean Sofa 96",
        category_name: "Ocean Collection",
        variants: [
          { id: 1, sku: "OCE-S-96-GR-Y" },
          { id: 2, sku: "OCE-S-96-BL-Y" },
        ],
      },
      {
        id: 10592475,
        name: "Ocean Coffee Table 72 x 56",
        category_name: "Ocean Collection",
        variants: [{ id: 3, sku: "OCE-CT-72X56-BR" }],
      },
      {
        id: 9,
        name: "Bravada Sofa",
        category_name: "Bravada Collection",
        variants: [{ id: 4, sku: "BRA-S-96-BL" }],
      },
    ]);
    expect(rows.map((row) => row.globalSku)).toEqual([
      "SA-OCE-CT-72X56-FRAME",
      "SA-OCE-S-96-CUSH",
      "SA-OCE-S-96-FRAME",
    ]);
  });
});

describe("katana bulk materials", () => {
  it("has 13 unique SKUs with live dump IDs", () => {
    expect(KATANA_BULK_MATERIALS).toHaveLength(13);
    const skus = new Set(KATANA_BULK_MATERIALS.map((row) => row.globalSku));
    const variants = new Set(
      KATANA_BULK_MATERIALS.map((row) => row.katanaVariantId),
    );
    expect(skus.size).toBe(13);
    expect(variants.size).toBe(13);
    expect(
      KATANA_BULK_MATERIALS.find((row) => row.globalSku === "RM-FAB-GENERIC")
        ?.katanaVariantId,
    ).toBe(23178514);
  });
});
