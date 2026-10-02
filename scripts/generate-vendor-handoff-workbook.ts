/**
 * Hero Client Vendor Handoff Workbook for PrimeView & VividWorks.
 *
 * Branded, filterable .xlsx that locks Phase 1 & 2 Master SKUs, Web Fabrics
 * (from Sunbrella colors doc + swatches), upcharge math, and Katana line-attribute
 * mapping — zero ambiguity for build.
 *
 * Usage:
 *   npm run vendor:handoff-workbook
 *
 * Output:
 *   docs/Vividworks/Handoff/CC_Patio_Vendor_Handoff_Workbook.xlsx
 *
 * Logo: merged A1:C4 on the Executive Summary is a placeholder — drop the
 * CC Patio logo image into that block after generation.
 */
import { loadEnvConfig } from "@next/env";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ADD_ON_ROWS,
  FABRIC_GRADE_ROWS,
  FABRIC_SLOT_COUNT,
  PHASE_PRODUCTS_HEADERS,
  SELLABLE_POWDERS,
  formatProductDimensions,
  loadMaterialsFromCsv,
  loadWorksheetData,
  mintMasterSku,
  type EcommerceWorksheetData,
} from "./generate-ecommerce-worksheet";
import {
  extractSunbrellaWebFabrics,
  matchFabricSku,
  type WebFabricSelection,
} from "./lib/sunbrella-web-fabrics";
import {
  collectWebsiteAddOns,
  formatWebsiteDimensions,
  loadWebsiteProductsFromHandoff,
  matchWebsiteProductsToSow,
} from "./lib/website-products-handoff";
import { SOW_PHASE_1, SOW_PHASE_2 } from "../src/lib/sow-phases";
import { closeDb } from "../src/server/db/client";

loadEnvConfig(process.cwd());

export const VENDOR_HANDOFF_OUT = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/CC_Patio_Vendor_Handoff_Workbook.xlsx",
);

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF111827" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "Calibri",
};
const TITLE_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 18,
  color: { argb: "FF111827" },
  name: "Calibri",
};
const SUBTITLE_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  size: 12,
  color: { argb: "FF374151" },
  name: "Calibri",
};
const BODY_FONT: Partial<ExcelJS.Font> = {
  size: 11,
  color: { argb: "FF1F2937" },
  name: "Calibri",
};
const ACCENT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF3F4F6" },
};
const LOGO_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: "FF111827" } },
  left: { style: "medium", color: { argb: "FF111827" } },
  bottom: { style: "medium", color: { argb: "FF111827" } },
  right: { style: "medium", color: { argb: "FF111827" } },
};

export type VendorProductRow = {
  masterSku: string;
  productName: string;
  dimensions: string;
  phase: 1 | 2;
};

export type VendorMaterialRow = {
  internalId: string;
  category: "Upholstery" | "Powder Coat" | "Dekton";
  publicDisplayName: string;
  pricingGrade: string;
  imagePath?: string | null;
};

export type VendorUpchargeRow = {
  upgradeType: string;
  upchargeAmount: number | null;
  ruleLogic: string;
};

export type KatanaMapRow = {
  salesOrderAttribute: string;
  mappedWooCommerceValue: string;
};

export function buildVendorProductRows(): VendorProductRow[] {
  const rows: VendorProductRow[] = [
    ...SOW_PHASE_1.map((name) => ({
      masterSku: mintMasterSku(name),
      productName: name,
      dimensions: formatProductDimensions(name),
      phase: 1 as const,
    })),
    ...SOW_PHASE_2.map((name) => ({
      masterSku: mintMasterSku(name),
      productName: name,
      dimensions: formatProductDimensions(name),
      phase: 2 as const,
    })),
  ];
  return rows;
}

/**
 * Web materials: locked Sunbrella e-comm fabrics from the colors docx
 * (typically >15) plus sellable powders and Dekton surfaces.
 */
export function buildWeb15MaterialRows(
  data: EcommerceWorksheetData,
  webFabrics: WebFabricSelection[] = data.webFabrics ?? [],
): VendorMaterialRow[] {
  const fabrics: VendorMaterialRow[] =
    webFabrics.length > 0
      ? webFabrics.map((selection) => {
          const matched = matchFabricSku(selection.displayName, data.fabrics);
          return {
            internalId: matched?.sku ?? "",
            category: "Upholstery" as const,
            publicDisplayName: selection.displayName,
            pricingGrade: "",
            imagePath: selection.imagePath,
          };
        })
      : Array.from({ length: FABRIC_SLOT_COUNT }, (_, i) => ({
          internalId: "",
          category: "Upholstery" as const,
          publicDisplayName: `Web Fabric ${i + 1} — PENDING LOCK`,
          pricingGrade: "",
          imagePath: null as string | null,
        }));

  const powders: VendorMaterialRow[] = data.powders.map((row) => ({
    internalId: row.sku,
    category: "Powder Coat" as const,
    publicDisplayName: row.name,
    pricingGrade: "N/A",
    imagePath: null as string | null,
  }));

  const dektons: VendorMaterialRow[] = data.dektons.map((row) => ({
    internalId: row.sku,
    category: "Dekton" as const,
    publicDisplayName: row.name,
    pricingGrade: "N/A",
    imagePath: null as string | null,
  }));

  return [...fabrics, ...powders, ...dektons];
}

export function buildUpchargeMatrixRows(
  websiteProducts: EcommerceWorksheetData["websiteProducts"] = [],
): VendorUpchargeRow[] {
  const grades: VendorUpchargeRow[] = FABRIC_GRADE_ROWS.map((row) => ({
    upgradeType: `Fabric Grade ${row.grade}`,
    upchargeAmount: row.defaultUpcharge,
    ruleLogic:
      row.grade === "A"
        ? "Baseline — no add to Web Base Price"
        : "Add to Web Base Price when this fabric grade is selected",
  }));

  const websiteAddOns = collectWebsiteAddOns(websiteProducts ?? []);
  const addOnNames = [
    ...DEFAULT_ADD_ON_ROWS,
    ...websiteAddOns.filter(
      (name) =>
        !DEFAULT_ADD_ON_ROWS.some((d) => d.toLowerCase() === name.toLowerCase()),
    ),
  ];

  const addOns: VendorUpchargeRow[] = addOnNames.map((name) => ({
    upgradeType: name,
    upchargeAmount: null,
    ruleLogic: websiteAddOns.includes(name)
      ? "From Website Products — Add to Web Base Price (confirm $)"
      : "Add to Web Base Price per applicable selection (verify with sales)",
  }));

  return [...grades, ...addOns];
}

export function buildKatanaDataMapRows(): KatanaMapRow[] {
  return [
    {
      salesOrderAttribute: "sales_order_rows[].variant_id",
      mappedWooCommerceValue:
        "Resolved via GET /variants?sku={Master SKU}. Never invent IDs. Line sku MUST equal FIN-* only.",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[global_sku]",
      mappedWooCommerceValue: "Woo line sku / Master SKU (e.g. FIN-BRV-SOF-72X34)",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[fabric_grade]",
      mappedWooCommerceValue:
        "Woo cart fabric grade A–F. Pass as Katana line attribute — do NOT append to Master SKU.",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[cushion_fabric]",
      mappedWooCommerceValue:
        "FAB-* Internal ID from Web 15 (e.g. FAB-ACT-ASH). Pass as attribute — do NOT append to Master SKU.",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[powder_coat]",
      mappedWooCommerceValue:
        "PWD-* Internal ID (e.g. PWD-BLACK). Pass as attribute — do NOT append to Master SKU.",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[dekton]",
      mappedWooCommerceValue:
        "STN-DKT-* when tabletop selected. Optional attribute — never a SKU suffix.",
    },
    {
      salesOrderAttribute: "sales_order_rows[].attributes[config_key]",
      mappedWooCommerceValue:
        "Optional quote hash FIN.G{A-F}.PWD-*.FAB-* — engine-internal only, not Katana variant.sku.",
    },
    {
      salesOrderAttribute: "order_no / ecommerce_order_id / customer_ref",
      mappedWooCommerceValue:
        "Woo order id; customer_ref like woo:{id}; Idempotency-Key: woo-{order_id}",
    },
  ];
}

function paintHeaderRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  headers: string[],
): void {
  const row = sheet.getRow(rowNumber);
  headers.forEach((header, i) => {
    const cell = row.getCell(i + 1);
    cell.value = header;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 24;
}

function enableAutoFilter(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  colCount: number,
  lastDataRow: number,
): void {
  if (lastDataRow < headerRow) return;
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastDataRow, column: colCount },
  };
}

function autoSizeColumns(
  sheet: ExcelJS.Worksheet,
  colCount: number,
  min = 12,
  max = 56,
): void {
  for (let c = 1; c <= colCount; c += 1) {
    let widest = min;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const raw = row.getCell(c).value;
      const text =
        typeof raw === "object" && raw !== null && "richText" in raw
          ? (raw as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("")
          : String(raw ?? "");
      widest = Math.min(max, Math.max(widest, text.length + 2));
    });
    sheet.getColumn(c).width = widest;
  }
}

function styleDataBand(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, colCount: number): void {
  for (let r = startRow; r <= endRow; r += 1) {
    if ((r - startRow) % 2 === 1) {
      for (let c = 1; c <= colCount; c += 1) {
        const cell = sheet.getCell(r, c);
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern === "none") {
          cell.fill = ACCENT_FILL;
        }
      }
    }
    for (let c = 1; c <= colCount; c += 1) {
      sheet.getCell(r, c).font = BODY_FONT;
      sheet.getCell(r, c).alignment = { vertical: "middle", wrapText: true };
    }
  }
}

function buildExecutiveSummary(wb: ExcelJS.Workbook, productCount: number, materialCount: number): void {
  const sheet = wb.addWorksheet("00 - EXECUTIVE SUMMARY", {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 },
  });

  // Logo placeholder block A1:C4
  sheet.mergeCells("A1:C4");
  const logo = sheet.getCell("A1");
  logo.value =
    "[ CC PATIO LOGO PLACEHOLDER ]\nDrop brand logo image into this merged block (A1:C4).";
  logo.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  logo.font = { italic: true, size: 11, color: { argb: "FF6B7280" }, name: "Calibri" };
  logo.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF9FAFB" },
  };
  logo.border = LOGO_BORDER;
  for (const addr of ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3", "A4", "B4", "C4"]) {
    sheet.getCell(addr).border = LOGO_BORDER;
  }

  sheet.mergeCells("E1:J1");
  sheet.getCell("E1").value =
    "CC Patio E-Commerce Architecture: Phase 1 & 2 Data Lock";
  sheet.getCell("E1").font = TITLE_FONT;
  sheet.getCell("E1").alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 32;

  sheet.mergeCells("E2:J2");
  sheet.getCell("E2").value = "Vendor Handoff Workbook — PrimeView & VividWorks";
  sheet.getCell("E2").font = SUBTITLE_FONT;

  const meta: Array<[string, string]> = [
    ["Prepared By:", "Enterprise Architecture Team"],
    ["Date:", new Date().toISOString().slice(0, 10)],
    ["Status:", "APPROVED FOR DEVELOPMENT"],
    ["Document Pair:", "docs/CAPITAL_STACK_VENDOR_HANDOFF.md (+ .pdf)"],
    ["Phase 1 + 2 Products:", String(productCount)],
    ["Web Materials Rows:", String(materialCount)],
  ];
  meta.forEach(([label, value], i) => {
    const row = 4 + i;
    sheet.getCell(`E${row}`).value = label;
    sheet.getCell(`E${row}`).font = { bold: true, size: 11, name: "Calibri" };
    sheet.mergeCells(`F${row}:J${row}`);
    sheet.getCell(`F${row}`).value = value;
    sheet.getCell(`F${row}`).font = BODY_FONT;
    if (label === "Status:") {
      sheet.getCell(`F${row}`).font = {
        bold: true,
        size: 11,
        color: { argb: "FF047857" },
        name: "Calibri",
      };
    }
  });

  sheet.mergeCells("A10:J14");
  const message = sheet.getCell("A10");
  message.value =
    "MESSAGE TO VENDORS\n\n" +
    "This workbook represents the immutable, finalized dataset for the CC Patio web configuration. " +
    "It contains the exact Master SKUs, approved materials, pricing matrices, and logistics data required " +
    "to program the VividWorks 3D engine and the WooCommerce cart. " +
    "Refer to CAPITAL_STACK_VENDOR_HANDOFF.md for Katana API webhook schemas.\n\n" +
    "HARD RULE: Woo / Clover line sku MUST equal the Master SKU (FIN-…). " +
    "Fabric grade, cushion fabric, and powder coat are sales-order row attributes — never SKU suffixes. " +
    "Cartesian explosion of FIN × grade × PWD × FAB is forbidden.";
  message.alignment = { vertical: "top", wrapText: true, horizontal: "left" };
  message.font = BODY_FONT;
  message.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFECFDF5" },
  };
  message.border = {
    top: { style: "thin", color: { argb: "FF059669" } },
    left: { style: "thin", color: { argb: "FF059669" } },
    bottom: { style: "thin", color: { argb: "FF059669" } },
    right: { style: "thin", color: { argb: "FF059669" } },
  };
  sheet.getRow(10).height = 28;
  sheet.getRow(11).height = 28;
  sheet.getRow(12).height = 28;
  sheet.getRow(13).height = 28;
  sheet.getRow(14).height = 28;

  sheet.mergeCells("A16:J18");
  sheet.getCell("A16").value =
    "TAB INDEX\n" +
    "01 — PHASE 1 & 2 PRODUCTS  →  PrimeView product pages + VividWorks models (FIN-* Master SKUs)\n" +
    "02 — WEB FABRICS & FINISHES  →  Locked Sunbrella e-comm fabrics (swatches) + powders + Dekton\n" +
    "03 — UPCHARGE MATRIX  →  PrimeView WooCommerce cart math (grades + modular add-ons)\n" +
    "04 — KATANA DATA MAP  →  Exact sales-order attribute mapping (no SKU mangling)";
  sheet.getCell("A16").font = BODY_FONT;
  sheet.getCell("A16").alignment = { vertical: "top", wrapText: true };

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(4).width = 3;
  sheet.getColumn(5).width = 22;
  for (let c = 6; c <= 10; c += 1) sheet.getColumn(c).width = 16;
}

function buildProductsSheet(
  wb: ExcelJS.Workbook,
  products: VendorProductRow[],
  data: EcommerceWorksheetData,
): void {
  const sheet = wb.addWorksheet("01 - PHASE 1 & 2 PRODUCTS", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  paintHeaderRow(sheet, 1, [...PHASE_PRODUCTS_HEADERS]);

  const sowRefs = products.map((row) => ({
    name: row.productName,
    phase: row.phase,
    masterSku: row.masterSku,
  }));
  const matches = matchWebsiteProductsToSow(
    sowRefs,
    data.websiteProducts ?? [],
    mintMasterSku,
  );

  products.forEach((row, i) => {
    const r = i + 2;
    const web = matches.get(row.productName);
    const dims =
      (web ? formatWebsiteDimensions(web) : "") || row.dimensions;
    const weightNum = web?.weight
      ? Number(String(web.weight).replace(/[^0-9.]/g, ""))
      : null;
    const values: Array<string | number | null> = [
      row.productName,
      row.masterSku,
      "",
      web?.collection ?? "",
      web?.msrp ?? null,
      web?.msrpAluminum ?? null,
      dims,
      weightNum != null && Number.isFinite(weightNum) && weightNum > 0
        ? weightNum
        : null,
      web?.description ?? "",
      web?.details ?? "",
      web?.shippingFlatRate ?? "",
      "",
      "",
      web?.packagedHeight && !/^N\/?A$/i.test(web.packagedHeight)
        ? web.packagedHeight
        : "",
      web?.fabricColor ?? "",
      web?.frameColor ?? "",
      web?.dektonColor ?? "",
      web?.pillowColor ?? "",
      web?.addOns ?? "",
      web?.memo ?? "",
      row.phase,
    ];
    values.forEach((value, colIdx) => {
      const cell = sheet.getCell(r, colIdx + 1);
      cell.value = value;
      cell.font = BODY_FONT;
      cell.alignment = { vertical: "middle", wrapText: true };
      if (colIdx === 1) cell.font = { name: "Consolas", size: 10, bold: true };
      if (colIdx === 4 || colIdx === 5) cell.numFmt = "$#,##0.00";
      if (colIdx === 7) cell.numFmt = "0.00";
    });
    if (web?.imageBuffer && web.imageExtension) {
      sheet.getRow(r).height = 72;
      const imageId = wb.addImage({
        buffer: web.imageBuffer as any,
        extension: web.imageExtension,
      });
      sheet.addImage(imageId, {
        tl: { col: 2, row: r - 1 },
        ext: { width: 96, height: 64 },
        editAs: "oneCell",
      });
    }
  });

  const last = products.length + 1;
  enableAutoFilter(sheet, 1, PHASE_PRODUCTS_HEADERS.length, last);
  sheet.getColumn(1).width = 42;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 14;
  sheet.getColumn(9).width = 44;
  sheet.getColumn(10).width = 36;
  sheet.getColumn(19).width = 22;
  sheet.getColumn(20).width = 36;
}

function buildMaterialsSheet(wb: ExcelJS.Workbook, materials: VendorMaterialRow[]): void {
  const sheet = wb.addWorksheet("02 - WEB FABRICS & FINISHES", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 1 }],
  });
  const headers = [
    "CC Patio Internal ID",
    "Material Category",
    "Public Display Name",
    "Pricing Grade (A-F)",
    "Swatch",
  ];
  paintHeaderRow(sheet, 1, headers);

  materials.forEach((row, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = row.internalId;
    sheet.getCell(r, 1).font = { name: "Consolas", size: 10 };
    sheet.getCell(r, 2).value = row.category;
    sheet.getCell(r, 3).value = row.publicDisplayName;
    sheet.getCell(r, 4).value = row.pricingGrade;
    if (row.imagePath && fs.existsSync(row.imagePath)) {
      sheet.getRow(r).height = 64;
      const ext = path.extname(row.imagePath).toLowerCase();
      const extension = ext === ".png" ? "png" : "jpeg";
      const imageId = wb.addImage({
        filename: row.imagePath,
        extension,
      });
      sheet.addImage(imageId, {
        tl: { col: 4, row: r - 1 },
        ext: { width: 72, height: 56 },
        editAs: "oneCell",
      });
    }
  });

  const last = materials.length + 1;
  styleDataBand(sheet, 2, last, 4);
  enableAutoFilter(sheet, 1, 4, last);
  autoSizeColumns(sheet, 4);
  sheet.getColumn(3).width = 40;
  sheet.getColumn(5).width = 14;
}

function buildUpchargeSheet(wb: ExcelJS.Workbook, rows: VendorUpchargeRow[]): void {
  const sheet = wb.addWorksheet("03 - UPCHARGE MATRIX", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const headers = ["Upgrade Type", "Upcharge Amount ($)", "Rule Logic"];
  paintHeaderRow(sheet, 1, headers);

  rows.forEach((row, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = row.upgradeType;
    sheet.getCell(r, 2).value = row.upchargeAmount;
    sheet.getCell(r, 2).numFmt = "$#,##0.00";
    sheet.getCell(r, 3).value = row.ruleLogic;
  });

  const last = rows.length + 1;
  styleDataBand(sheet, 2, last, headers.length);
  enableAutoFilter(sheet, 1, headers.length, last);
  autoSizeColumns(sheet, headers.length);
  sheet.getColumn(1).width = 42;
  sheet.getColumn(3).width = 56;
}

function buildKatanaMapSheet(wb: ExcelJS.Workbook, rows: KatanaMapRow[]): void {
  const sheet = wb.addWorksheet("04 - KATANA DATA MAP", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const headers = ["Sales Order Attribute", "Mapped WooCommerce Value"];
  paintHeaderRow(sheet, 1, headers);

  rows.forEach((row, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = row.salesOrderAttribute;
    sheet.getCell(r, 1).font = { name: "Consolas", size: 10, bold: true };
    sheet.getCell(r, 2).value = row.mappedWooCommerceValue;
  });

  const last = rows.length + 1;
  styleDataBand(sheet, 2, last, headers.length);
  enableAutoFilter(sheet, 1, headers.length, last);
  sheet.getColumn(1).width = 52;
  sheet.getColumn(2).width = 88;
}

export async function buildVendorHandoffWorkbook(
  data?: EcommerceWorksheetData,
): Promise<ExcelJS.Workbook> {
  const materialsData = data ?? loadMaterialsFromCsv();
  const products = buildVendorProductRows();
  const materials = buildWeb15MaterialRows(
    materialsData,
    materialsData.webFabrics,
  );
  const upcharges = buildUpchargeMatrixRows(materialsData.websiteProducts);
  const katanaMap = buildKatanaDataMapRows();

  // Sanity: only FIN-* as Master SKUs
  for (const row of products) {
    if (!row.masterSku.startsWith("FIN-")) {
      throw new Error(`Non-FIN Master SKU in handoff: ${row.masterSku}`);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "CC Patio Enterprise Architecture";
  wb.company = "CC Patio";
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = "CC Patio E-Commerce Architecture: Phase 1 & 2 Data Lock";
  wb.description =
    "Immutable vendor handoff for PrimeView WooCommerce and VividWorks 3D configurator.";

  buildExecutiveSummary(wb, products.length, materials.length);
  buildProductsSheet(wb, products, materialsData);
  buildMaterialsSheet(wb, materials);
  buildUpchargeSheet(wb, upcharges);
  buildKatanaMapSheet(wb, katanaMap);

  return wb;
}

export async function writeVendorHandoffWorkbook(
  outPath = VENDOR_HANDOFF_OUT,
  data?: EcommerceWorksheetData,
): Promise<{ outPath: string; productCount: number; materialCount: number }> {
  const materialsData = data ?? (await loadWorksheetData());
  if (!materialsData.webFabrics) {
    try {
      materialsData.webFabrics = extractSunbrellaWebFabrics();
    } catch (error) {
      console.warn(
        "[vendor:handoff-workbook] Sunbrella colors docx not loaded:",
        error instanceof Error ? error.message : error,
      );
      materialsData.webFabrics = [];
    }
  }
  if (!materialsData.websiteProducts) {
    try {
      materialsData.websiteProducts = await loadWebsiteProductsFromHandoff();
    } catch (error) {
      console.warn(
        "[vendor:handoff-workbook] Website Products handoff not loaded:",
        error instanceof Error ? error.message : error,
      );
      materialsData.websiteProducts = [];
    }
  }
  const wb = await buildVendorHandoffWorkbook(materialsData);
  const products = buildVendorProductRows();
  const materials = buildWeb15MaterialRows(
    materialsData,
    materialsData.webFabrics,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return {
    outPath,
    productCount: products.length,
    materialCount: materials.length,
  };
}

async function main(): Promise<void> {
  const result = await writeVendorHandoffWorkbook();
  console.log("[vendor:handoff-workbook] wrote", result.outPath);
  console.log("[vendor:handoff-workbook] counts", {
    products: result.productCount,
    materials: result.materialCount,
    sellablePowders: SELLABLE_POWDERS.length,
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main()
    .catch((error: unknown) => {
      console.error("[vendor:handoff-workbook] fatal", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb().catch(() => undefined);
    });
}
