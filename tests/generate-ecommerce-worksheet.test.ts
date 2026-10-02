import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADD_ON_ROWS,
  FABRIC_GRADE_ROWS,
  PHASE_PRODUCTS_HEADERS,
  SELLABLE_POWDERS,
  WEB_FABRICS_SHEET_NAME,
  buildEcommerceWorksheet,
  formatProductDimensions,
  loadMaterialsFromCsv,
  mintMasterSku,
  type EcommerceWorksheetData,
} from "../scripts/generate-ecommerce-worksheet";
import {
  matchFabricSku,
  stripFabricCode,
} from "../scripts/lib/sunbrella-web-fabrics";
import {
  collectWebsiteAddOns,
  formatWebsiteDimensions,
  matchWebsiteProductsToSow,
  type WebsiteProductRow,
} from "../scripts/lib/website-products-handoff";
import { SOW_PHASE_1, SOW_PHASE_2 } from "@/lib/sow-phases";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const FIXTURE: EcommerceWorksheetData = {
  fabrics: [
    { sku: "FAB-ACT-ASH", name: "ACTION ASH", category: "Fabric" },
    { sku: "FAB-CAN-BLA", name: "CANVAS BLACK", category: "Fabric" },
    { sku: "FAB-CAB-CLA", name: "CABANA CLASSIC", category: "Fabric" },
    { sku: "FAB-RUE-COS", name: "RUE COSTAL", category: "Fabric" },
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

function websiteRow(
  partial: Partial<WebsiteProductRow> & Pick<WebsiteProductRow, "memo" | "sourceRow">,
): WebsiteProductRow {
  return {
    ecommerce: true,
    shippingFlatRate: "",
    collection: "Bravada",
    code: "",
    armHeight: "",
    sitHeight: "",
    length: '34"',
    depth: '34"',
    height: '31"',
    fullName: partial.memo,
    msrp: 2080,
    msrpAluminum: 2392,
    description: "Marketing copy",
    details: "Built in Phoenix",
    weight: "85",
    packagedHeight: "N/A",
    fabricColor: "Y",
    frameColor: "Y",
    dektonColor: "N/A",
    pillowColor: "Y",
    addOns: "Ironwood/Dekton Sidearm",
    imageBuffer: null,
    imageExtension: null,
    ...partial,
  };
}

describe("mintMasterSku", () => {
  it("mints FIN-* from SOW names via sku-engine", () => {
    expect(mintMasterSku('BRAVADA SOFA 72" x 34" x 31" BH')).toBe(
      "FIN-BRV-SOF-72X34",
    );
  });
});

describe("formatProductDimensions", () => {
  it("formats LxWxH from SOW names when parseable", () => {
    expect(formatProductDimensions('BRAVADA SOFA 72" x 34" x 31" BH')).toBe(
      "72 x 34 x 31",
    );
  });
});

describe("matchFabricSku", () => {
  it("matches display names including (C)/(P) codes and RUE alias", () => {
    expect(stripFabricCode("CASSAVA CORAL (C)")).toBe("CASSAVA CORAL");
    expect(matchFabricSku("RUE COASTAL", FIXTURE.fabrics)?.sku).toBe(
      "FAB-RUE-COS",
    );
  });
});

describe("matchWebsiteProductsToSow", () => {
  it("uniquely matches website memos onto Phase 1 & 2 SOW products", () => {
    const sowName = SOW_PHASE_1.find((n) => /BRAVADA SWIVEL CHAIR 34/i.test(n));
    expect(sowName).toBeTruthy();
    const rows = [
      websiteRow({
        sourceRow: 8,
        memo: 'BRAVADA SWIVEL CHAIR 34" x 34" x 31" BH',
        addOns: "Ironwood",
      }),
    ];
    const matched = matchWebsiteProductsToSow(
      [
        {
          name: sowName!,
          phase: 1,
          masterSku: mintMasterSku(sowName!),
        },
      ],
      rows,
      mintMasterSku,
    );
    expect(matched.get(sowName!)?.msrp).toBe(2080);
    expect(formatWebsiteDimensions(rows[0]!)).toBe("34 x 34 x 31");
    expect(collectWebsiteAddOns(rows)).toContain("Ironwood");
  });
});

describe("buildEcommerceWorksheet", () => {
  it("enriches Phase 1 & 2 Products from website rows and embeds drawings", async () => {
    const tmpPng = path.join(os.tmpdir(), `ccpatio-product-${Date.now()}.png`);
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

    const wb = await buildEcommerceWorksheet({
      ...FIXTURE,
      webFabrics: [
        {
          displayName: "CABANA CLASSIC",
          matchName: "CABANA CLASSIC",
          imagePath: null,
          sourceImage: null,
        },
      ],
      websiteProducts: [
        websiteRow({
          sourceRow: 8,
          memo: sowName,
          imageBuffer: fs.readFileSync(tmpPng),
          imageExtension: "png",
          addOns: "Casters",
        }),
      ],
    });

    expect(wb.worksheets.map((s) => s.name)).toEqual([
      "_Lists",
      WEB_FABRICS_SHEET_NAME,
      "Web Finishes",
      "Phase 1 & 2 Products",
      "Upcharge Matrix",
    ]);

    const products = wb.getWorksheet("Phase 1 & 2 Products")!;
    const headerValues = products.getRow(2).values;
    const headerList = Array.isArray(headerValues)
      ? headerValues.slice(1)
      : [];
    expect(headerList).toEqual([
      ...PHASE_PRODUCTS_HEADERS,
    ]);
    expect(products.actualRowCount - 2).toBe(
      SOW_PHASE_1.length + SOW_PHASE_2.length,
    );
    // First SOW row is Bravada club/swivel family — find matched row by memo col
    let foundPrice: unknown = null;
    products.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;
      if (String(row.getCell(1).value) === sowName) {
        foundPrice = row.getCell(5).value;
      }
    });
    expect(foundPrice).toBe(2080);
    expect(products.getImages().length).toBeGreaterThanOrEqual(1);

    const upcharge = wb.getWorksheet("Upcharge Matrix")!;
    expect(upcharge.getCell("C3").value).toBe(0);
    let hasCasters = false;
    upcharge.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;
      if (String(row.getCell(2).value) === "Casters") hasCasters = true;
    });
    expect(hasCasters).toBe(true);
    expect(FABRIC_GRADE_ROWS[0]?.grade).toBe("A");
    expect(DEFAULT_ADD_ON_ROWS.length).toBeGreaterThan(3);

    fs.rmSync(tmpPng, { force: true });
  });
});

describe("loadMaterialsFromCsv", () => {
  it("loads live handoff CSV when present and keeps only sellable powders", () => {
    const data = loadMaterialsFromCsv();
    expect(data.fabrics.length).toBeGreaterThan(10);
    expect(
      data.powders.every((p) =>
        SELLABLE_POWDERS.includes(p.sku as (typeof SELLABLE_POWDERS)[number]),
      ),
    ).toBe(true);
  });
});
