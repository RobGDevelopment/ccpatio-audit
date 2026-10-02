import { describe, expect, it } from "vitest";
import {
  FABRIC_SLOT_COUNT,
  SELLABLE_POWDERS,
  type EcommerceWorksheetData,
} from "../scripts/generate-ecommerce-worksheet";
import {
  buildKatanaDataMapRows,
  buildUpchargeMatrixRows,
  buildVendorHandoffWorkbook,
  buildVendorProductRows,
  buildWeb15MaterialRows,
} from "../scripts/generate-vendor-handoff-workbook";
import { SOW_PHASE_1, SOW_PHASE_2 } from "@/lib/sow-phases";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURE: EcommerceWorksheetData = {
  fabrics: [
    { sku: "FAB-CAB-CLA", name: "CABANA CLASSIC", category: "Fabric" },
    { sku: "FAB-CAN-BLA", name: "CANVAS BLACK", category: "Fabric" },
  ],
  powders: SELLABLE_POWDERS.map((sku) => ({
    sku,
    name: sku.replace(/^PWD-/, "").replace(/-/g, " "),
    category: "Powder" as const,
  })),
  dektons: [
    { sku: "STN-DKT-AT2.0", name: "AGED TIMBER 2.0", category: "Dekton" },
  ],
};

describe("buildVendorProductRows", () => {
  it("emits Phase 1 + Phase 2 FIN-* Master SKUs only", () => {
    const rows = buildVendorProductRows();
    expect(rows).toHaveLength(SOW_PHASE_1.length + SOW_PHASE_2.length);
    expect(rows.every((r) => r.masterSku.startsWith("FIN-"))).toBe(true);
  });
});

describe("buildWeb15MaterialRows", () => {
  it("locks Sunbrella web fabrics when provided (can exceed 15)", () => {
    const rows = buildWeb15MaterialRows(FIXTURE, [
      {
        displayName: "CABANA CLASSIC",
        matchName: "CABANA CLASSIC",
        imagePath: null,
        sourceImage: null,
      },
      {
        displayName: "CANVAS BLACK",
        matchName: "CANVAS BLACK",
        imagePath: null,
        sourceImage: null,
      },
      {
        displayName: "SOLVE LINEN",
        matchName: "SOLVE LINEN",
        imagePath: null,
        sourceImage: null,
      },
    ]);
    const upholstery = rows.filter((r) => r.category === "Upholstery");
    expect(upholstery).toHaveLength(3);
    expect(upholstery[0]?.internalId).toBe("FAB-CAB-CLA");
    expect(upholstery[2]?.internalId).toBe("");
    expect(upholstery.length).not.toBe(FABRIC_SLOT_COUNT);
  });
});

describe("buildKatanaDataMapRows", () => {
  it("requires fabric_grade, cushion_fabric, powder_coat as attributes not SKU suffixes", () => {
    const rows = buildKatanaDataMapRows();
    const byAttr = Object.fromEntries(
      rows.map((r) => [r.salesOrderAttribute, r.mappedWooCommerceValue]),
    );
    expect(byAttr["sales_order_rows[].attributes[fabric_grade]"]).toMatch(
      /do NOT append to Master SKU/i,
    );
    expect(byAttr["sales_order_rows[].attributes[cushion_fabric]"]).toMatch(
      /do NOT append to Master SKU/i,
    );
    expect(byAttr["sales_order_rows[].attributes[powder_coat]"]).toMatch(
      /do NOT append to Master SKU/i,
    );
  });
});

describe("buildVendorHandoffWorkbook", () => {
  it("embeds web fabric swatches and website product drawings", async () => {
    const tmpPng = path.join(os.tmpdir(), `ccpatio-vendor-swatch-${Date.now()}.png`);
    fs.writeFileSync(
      tmpPng,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );

    const sowName =
      SOW_PHASE_1.find((n) => /BRAVADA SWIVEL CHAIR 34/i.test(n)) ??
      SOW_PHASE_1[0]!;

    const wb = await buildVendorHandoffWorkbook({
      ...FIXTURE,
      webFabrics: [
        {
          displayName: "CABANA CLASSIC",
          matchName: "CABANA CLASSIC",
          imagePath: tmpPng,
          sourceImage: "image1.png",
        },
      ],
      websiteProducts: [
        {
          sourceRow: 8,
          ecommerce: true,
          shippingFlatRate: "",
          collection: "Bravada",
          code: "",
          armHeight: "",
          sitHeight: "",
          length: '34"',
          depth: '34"',
          height: '31"',
          fullName: sowName,
          memo: sowName,
          msrp: 2080,
          msrpAluminum: 2392,
          description: "Marketing",
          details: "Details",
          weight: "85",
          packagedHeight: "",
          fabricColor: "Y",
          frameColor: "Y",
          dektonColor: "N/A",
          pillowColor: "Y",
          addOns: "Ironwood",
          imageBuffer: fs.readFileSync(tmpPng),
          imageExtension: "png",
        },
      ],
    });

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "00 - EXECUTIVE SUMMARY",
      "01 - PHASE 1 & 2 PRODUCTS",
      "02 - WEB FABRICS & FINISHES",
      "03 - UPCHARGE MATRIX",
      "04 - KATANA DATA MAP",
    ]);

    const products = wb.getWorksheet("01 - PHASE 1 & 2 PRODUCTS")!;
    expect(products.getCell("A1").value).toBe("Product Name");
    expect(products.getImages().length).toBeGreaterThanOrEqual(1);

    const materials = wb.getWorksheet("02 - WEB FABRICS & FINISHES")!;
    expect(materials.getCell("A2").value).toBe("FAB-CAB-CLA");
    expect(buildUpchargeMatrixRows([]).length).toBeGreaterThan(6);

    fs.rmSync(tmpPng, { force: true });
  });
});
