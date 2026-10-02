/**
 * Complete the Vividworks/Primeview handoff workbook in place:
 * - Keep "Copy of Website Products" (+ existing Web Fabrics if present)
 * - Rebuild Phase 1 & 2 Products (enriched) and Upcharge Matrix from that tab
 * - Also refresh ecommerce_catalog_worksheet.xlsx + vendor handoff workbook
 *
 * Usage: npm run ecom:complete-handoff
 */
import { loadEnvConfig } from "@next/env";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEcommerceWorksheet,
  loadWorksheetData,
  writeEcommerceWorksheet,
} from "./generate-ecommerce-worksheet";
import { writeVendorHandoffWorkbook } from "./generate-vendor-handoff-workbook";
import { extractSunbrellaWebFabrics } from "./lib/sunbrella-web-fabrics";
import {
  WEBSITE_PRODUCTS_HANDOFF,
  WEBSITE_PRODUCTS_SHEET,
  extractWebsiteProductsFromWorkbook,
  matchWebsiteProductsToSow,
} from "./lib/website-products-handoff";
import { mintMasterSku } from "./generate-ecommerce-worksheet";
import { SOW_PHASE_1, SOW_PHASE_2 } from "../src/lib/sow-phases";
import { closeDb } from "../src/server/db/client";

loadEnvConfig(process.cwd());

const ECOM_OUT = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/ecommerce_catalog_worksheet.xlsx",
);

async function rebuildHandoffInPlace(handoffPath: string): Promise<{
  matched: number;
  websiteRows: number;
}> {
  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(handoffPath);
  const websiteProducts = extractWebsiteProductsFromWorkbook(source);

  const data = await loadWorksheetData();
  data.websiteProducts = websiteProducts;
  try {
    data.webFabrics = extractSunbrellaWebFabrics();
  } catch {
    data.webFabrics = data.webFabrics ?? [];
  }

  const fresh = await buildEcommerceWorksheet(data);

  // Start from source so Copy of Website Products (+ its images) stay intact.
  for (const name of ["Phase 1 & 2 Products", "Upcharge Matrix", "Web Finishes", "Web Fabrics", "_Lists"]) {
    const sheet = source.getWorksheet(name);
    if (sheet) source.removeWorksheet(sheet.id);
  }

  // Transplant rebuilt sheets (except we keep source's Copy of Website Products).
  for (const sheet of fresh.worksheets) {
    if (sheet.name === WEBSITE_PRODUCTS_SHEET) continue;
    const clone = source.addWorksheet(sheet.name, {
      state: sheet.state,
      views: sheet.views,
      properties: sheet.properties,
    });
    // Copy cell values/styles (lightweight — images re-added below for phase sheet)
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const targetRow = clone.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const target = targetRow.getCell(colNumber);
        target.value = cell.value;
        if (cell.style) target.style = { ...cell.style };
        if (cell.numFmt) target.numFmt = cell.numFmt;
        if (cell.dataValidation) target.dataValidation = cell.dataValidation;
        if (cell.note) target.note = cell.note;
      });
      if (row.height) targetRow.height = row.height;
    });
    sheet.columns?.forEach((col, i) => {
      if (col.width) clone.getColumn(i + 1).width = col.width;
    });
    if (sheet.autoFilter) clone.autoFilter = sheet.autoFilter;

    // Re-embed images from fresh workbook media
    for (const img of sheet.getImages()) {
      const meta = fresh.getImage(Number(img.imageId));
      const rawBuffer =
        meta.buffer ??
        (meta.base64
          ? Buffer.from(
              meta.base64.replace(/^data:image\/\w+;base64,/, ""),
              "base64",
            )
          : null);
      if (!rawBuffer) continue;
      const buffer = Buffer.from(rawBuffer as Uint8Array);
      const newId = source.addImage({
        buffer: buffer as any,
        extension: meta.extension === "png" || meta.extension === "gif" ? meta.extension : "jpeg",
      });
      clone.addImage(newId, img.range as unknown as ExcelJS.ImagePosition);
    }
  }

  // Prefer tab order: _Lists, Copy of Website Products, Web Fabrics, ...
  // ExcelJS order follows add order; move Copy sheet to front if needed is limited —
  // leave as-is (removed sheets + appended rebuild).

  await source.xlsx.writeFile(handoffPath);

  const matched = matchWebsiteProductsToSow(
    [
      ...SOW_PHASE_1.map((name) => ({
        name,
        phase: 1 as const,
        masterSku: mintMasterSku(name),
      })),
      ...SOW_PHASE_2.map((name) => ({
        name,
        phase: 2 as const,
        masterSku: mintMasterSku(name),
      })),
    ],
    websiteProducts,
    mintMasterSku,
  ).size;

  return {
    matched,
    websiteRows: websiteProducts.filter((r) => r.ecommerce).length,
  };
}

async function main(): Promise<void> {
  if (!fs.existsSync(WEBSITE_PRODUCTS_HANDOFF)) {
    throw new Error(`Missing handoff file: ${WEBSITE_PRODUCTS_HANDOFF}`);
  }

  const inPlace = await rebuildHandoffInPlace(WEBSITE_PRODUCTS_HANDOFF);
  const ecom = await writeEcommerceWorksheet(ECOM_OUT);
  const vendor = await writeVendorHandoffWorkbook();

  console.log("[ecom:complete-handoff] updated", WEBSITE_PRODUCTS_HANDOFF);
  console.log("[ecom:complete-handoff] ecommerce", ecom.outPath);
  console.log("[ecom:complete-handoff] vendor", vendor.outPath);
  console.log("[ecom:complete-handoff] match", {
    websiteEcommerceRows: inPlace.websiteRows,
    phaseProductsMatched: inPlace.matched,
    phaseProductsTotal: SOW_PHASE_1.length + SOW_PHASE_2.length,
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main()
    .catch((error: unknown) => {
      console.error("[ecom:complete-handoff] fatal", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb().catch(() => undefined);
    });
}
