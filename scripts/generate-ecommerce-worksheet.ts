/**
 * E-commerce catalog worksheet for the CC Patio business team.
 *
 * Builds a Google-Sheets-ready .xlsx with:
 *   1. Web Fabrics — locked Sunbrella e-comm set from the colors docx (+ swatches)
 *   2. Web Finishes — sellable powders + Dekton + Yes/No + retail upcharge ($)
 *   3. Phase 1 & 2 Products — SOW names + FIN-* + PrimeView product-data fields
 *   4. Upcharge Matrix — fabric grade B–F flat $ and modular add-on upcharges
 *
 * Fabric dropdowns use a hidden `_Lists` sheet (Excel inline lists cap at 255 chars).
 * Sheet protection password (Excel only; Google Sheets drops it on import): `ccpatio-ecom`
 *
 * Usage:
 *   npm run ecom:worksheet
 *
 * Env: POSTGRES_URL optional — when set, FAB-/STN- come from sku_mappings;
 * otherwise falls back to docs/Vividworks/Handoff/vividworks_material_options.csv
 *
 * Web fabric source of truth:
 *   "CC Patio Core Sunbrella Fabric Colors.docx" (name + swatch images)
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, like, or } from "drizzle-orm";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNamedDimensions } from "../src/lib/heuristic-bom";
import { generateFinishedGoodSku } from "../src/lib/sku-engine";
import { SOW_PHASE_1, SOW_PHASE_2 } from "../src/lib/sow-phases";
import { closeDb, getDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";
import {
  extractSunbrellaWebFabrics,
  matchFabricSku,
  type WebFabricSelection,
} from "./lib/sunbrella-web-fabrics";
import {
  WEBSITE_PRODUCTS_HANDOFF,
  collectWebsiteAddOns,
  formatWebsiteDimensions,
  loadWebsiteProductsFromHandoff,
  matchWebsiteProductsToSow,
  type WebsiteProductRow,
} from "./lib/website-products-handoff";

loadEnvConfig(process.cwd());

export const WORKSHEET_PROTECT_PASSWORD = "ccpatio-ecom";
/** @deprecated Web fabric count is now driven by the Sunbrella colors docx. */
export const FABRIC_SLOT_COUNT = 15;
export const WEB_FABRICS_SHEET_NAME = "Web Fabrics";

export const SELLABLE_POWDERS = [
  "PWD-BLACK",
  "PWD-BONE",
  "PWD-FANUC-GRAY",
  "PWD-LITE-BEIGE",
  "PWD-OIL-RUB-BRONZE",
  "PWD-WILD-RICE",
] as const;

/** Pre-seeded modular add-ons for Tab 4 (team fills Retail Upcharge $). */
export const DEFAULT_ADD_ON_ROWS = [
  "Ironwood Arms (per applicable arm)",
  "Casters (per set)",
  "Square Pillow 17x17",
  "Square Pillow 23x23",
  "Lumbar Pillow 12x24",
  "Dekton Sidearm (when not a finish row)",
  "Metal Arms upgrade",
] as const;

export const FABRIC_GRADE_ROWS = [
  { grade: "A", defaultUpcharge: 0, lockedDefault: true },
  { grade: "B", defaultUpcharge: null, lockedDefault: false },
  { grade: "C", defaultUpcharge: null, lockedDefault: false },
  { grade: "D", defaultUpcharge: null, lockedDefault: false },
  { grade: "E", defaultUpcharge: null, lockedDefault: false },
  { grade: "F", defaultUpcharge: null, lockedDefault: false },
] as const;

/** Format L×W×H inches from SOW-parsed dims when available. */
export function formatProductDimensions(sowName: string): string {
  const dims = parseNamedDimensions(sowName);
  if (dims.length && dims.depth && dims.height) {
    return `${dims.length} x ${dims.depth} x ${dims.height}`;
  }
  if (dims.length && dims.depth) {
    return `${dims.length} x ${dims.depth}`;
  }
  if (dims.length) {
    return dims.length;
  }
  return "";
}

const DEFAULT_OUT = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/ecommerce_catalog_worksheet.xlsx",
);

const CSV_FALLBACK = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/vividworks_material_options.csv",
);

const COLLECTION_LABELS: ReadonlyArray<[string, string]> = [
  ["WATERFALL", "Waterfall"],
  ["BRAVADA", "Bravada"],
  ["BROOKLYN", "Brooklyn"],
  ["OCEAN", "Ocean"],
  ["MILAN", "Milan"],
  ["MARINA", "Marina"],
  ["TAYLOR", "Taylor"],
  ["DAISY", "Daisy"],
  ["CABANA", "Cabana"],
  ["FLEXY", "Flexy"],
  ["TENJAM", "Tenjam"],
  ["FLY", "Fly"],
];

export type MaterialRow = {
  sku: string;
  name: string;
  category: "Fabric" | "Powder" | "Dekton";
};

export type EcommerceWorksheetData = {
  fabrics: MaterialRow[];
  powders: MaterialRow[];
  dektons: MaterialRow[];
  /** Locked e-comm fabric set from the Sunbrella colors doc (optional in unit tests). */
  webFabrics?: WebFabricSelection[];
  /** Website product enrichments from Copy of Website Products (Phase 1 & 2 only). */
  websiteProducts?: WebsiteProductRow[];
};

export const PHASE_PRODUCTS_HEADERS = [
  "Product Name",
  "Master SKU",
  "Drawing",
  "Collection",
  "Web Base Price ($)",
  "MSRP Aluminum ($)",
  "Dimensions (LxWxH)",
  "Weight (lbs)",
  "Marketing Description",
  "Details",
  "Shipping Flat Rate",
  "Freight Class",
  "Lead Time",
  "Packaged Dimensions",
  "Fabric Color",
  "Frame Color",
  "Dekton Color",
  "Pillow Color",
  "Add-Ons",
  "Website Memo",
  "Phase",
] as const;

function extractCollectionLabel(name: string): string {
  const upper = name.toUpperCase();
  for (const [needle, label] of COLLECTION_LABELS) {
    if (upper.includes(needle)) return label;
  }
  return "";
}

/**
 * Same mint rule as vividworks datapack: when the SOW title already names the
 * collection, pass the name as haystack so sku-engine does not pick a stale label.
 */
export function mintMasterSku(sowName: string): string {
  const dims = parseNamedDimensions(sowName);
  const namedCollection = extractCollectionLabel(sowName);
  const haystack = namedCollection ? sowName : namedCollection || sowName;
  return generateFinishedGoodSku(sowName, haystack, dims.length, dims.depth);
}

function displayLabel(sku: string, name: string): string {
  const clean = name.trim() || sku;
  return `${sku} — ${clean}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

export function loadMaterialsFromCsv(
  csvPath = CSV_FALLBACK,
): EcommerceWorksheetData {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Material CSV not found: ${csvPath}`);
  }
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const fabrics: MaterialRow[] = [];
  const powderBySku = new Map<string, MaterialRow>();
  const dektons: MaterialRow[] = [];

  for (const line of lines.slice(1)) {
    const [skuRaw, categoryRaw, nameRaw] = parseCsvLine(line);
    const sku = (skuRaw ?? "").trim().toUpperCase();
    const category = (categoryRaw ?? "").trim();
    const name = (nameRaw ?? "").trim() || sku;
    if (!sku) continue;
    if (category === "Fabric" || sku.startsWith("FAB-")) {
      fabrics.push({ sku, name, category: "Fabric" });
    } else if (category === "Powder" || sku.startsWith("PWD-")) {
      powderBySku.set(sku, { sku, name, category: "Powder" });
    } else if (category === "Dekton" || sku.startsWith("STN-")) {
      dektons.push({ sku, name, category: "Dekton" });
    }
  }

  const powders = SELLABLE_POWDERS.map((sku) => {
    const hit = powderBySku.get(sku);
    return (
      hit ?? {
        sku,
        name: sku.replace(/^PWD-/, "").replace(/-/g, " "),
        category: "Powder" as const,
      }
    );
  });

  fabrics.sort((a, b) => a.sku.localeCompare(b.sku));
  dektons.sort((a, b) => a.sku.localeCompare(b.sku));
  return { fabrics, powders, dektons };
}

export async function loadMaterialsFromDb(): Promise<EcommerceWorksheetData> {
  const db = getDb();
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(
      and(
        eq(sku_mappings.is_active, true),
        or(
          like(sku_mappings.global_sku, "FAB-%"),
          like(sku_mappings.global_sku, "PWD-%"),
          like(sku_mappings.global_sku, "STN-%"),
        ),
      ),
    );

  const fabrics: MaterialRow[] = [];
  const powderBySku = new Map<string, MaterialRow>();
  const dektons: MaterialRow[] = [];

  for (const row of rows) {
    const sku = row.sku.trim().toUpperCase();
    const name = (row.name || sku).trim();
    if (sku.startsWith("FAB-")) {
      fabrics.push({ sku, name, category: "Fabric" });
    } else if (sku.startsWith("PWD-")) {
      powderBySku.set(sku, { sku, name, category: "Powder" });
    } else if (sku.startsWith("STN-")) {
      dektons.push({ sku, name, category: "Dekton" });
    }
  }

  const powders = SELLABLE_POWDERS.map((sku) => {
    const hit = powderBySku.get(sku);
    return (
      hit ?? {
        sku,
        name: sku.replace(/^PWD-/, "").replace(/-/g, " "),
        category: "Powder" as const,
      }
    );
  });

  fabrics.sort((a, b) => a.sku.localeCompare(b.sku));
  dektons.sort((a, b) => a.sku.localeCompare(b.sku));
  return { fabrics, powders, dektons };
}

export async function loadWorksheetData(): Promise<EcommerceWorksheetData> {
  if (process.env.POSTGRES_URL?.trim()) {
    try {
      return await loadMaterialsFromDb();
    } catch (error) {
      console.warn(
        "[ecom:worksheet] DB load failed, falling back to CSV:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return loadMaterialsFromCsv();
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};
const LOCKED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE5E7EB" },
};
const NOTE_FONT: Partial<ExcelJS.Font> = {
  italic: true,
  size: 9,
  color: { argb: "FF6B7280" },
};

function paintHeaderRow(sheet: ExcelJS.Worksheet, rowNumber: number, colCount: number): void {
  const row = sheet.getRow(rowNumber);
  for (let c = 1; c <= colCount; c += 1) {
    const cell = row.getCell(c);
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.protection = { locked: true };
  }
  row.height = 22;
}

function unlockCell(cell: ExcelJS.Cell): void {
  cell.protection = { locked: false };
}

function lockCell(cell: ExcelJS.Cell, gray = false): void {
  cell.protection = { locked: true };
  if (gray) cell.fill = LOCKED_FILL;
}

function writeNoteRow(sheet: ExcelJS.Worksheet, text: string, colSpan: number): void {
  sheet.getCell("A1").value = text;
  sheet.mergeCells(1, 1, 1, colSpan);
  sheet.getCell("A1").font = NOTE_FONT;
  sheet.getCell("A1").protection = { locked: true };
  sheet.getRow(1).height = 32;
}

/**
 * Build the workbook in memory. Exported for unit tests.
 */
export async function buildEcommerceWorksheet(
  data: EcommerceWorksheetData,
): Promise<ExcelJS.Workbook> {
  if (data.fabrics.length === 0) {
    throw new Error("No FAB-* fabrics found — cannot build fabric dropdown.");
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "CC Patio MDM";
  wb.created = new Date();

  // --- _Lists (very hidden) ---
  const lists = wb.addWorksheet("_Lists", {
    state: "veryHidden",
  });
  lists.getCell("A1").value = "FabricDisplay";
  lists.getCell("B1").value = "Grade";
  lists.getCell("C1").value = "YesNo";

  data.fabrics.forEach((row, i) => {
    lists.getCell(`A${i + 2}`).value = displayLabel(row.sku, row.name);
  });
  ["A", "B", "C", "D", "E", "F"].forEach((grade, i) => {
    lists.getCell(`B${i + 2}`).value = grade;
  });
  lists.getCell("C2").value = "Yes";
  lists.getCell("C3").value = "No";

  const gradeRange = "'_Lists'!$B$2:$B$7";
  const yesNoRange = "'_Lists'!$C$2:$C$3";

  // --- Tab 1: Web Fabrics (locked from Sunbrella colors doc) ---
  const webFabrics = data.webFabrics ?? [];
  const fabricsSheet = wb.addWorksheet(WEB_FABRICS_SHEET_NAME, {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });
  writeNoteRow(
    fabricsSheet,
    webFabrics.length > 0
      ? `LOCKED e-comm fabric set (${webFabrics.length}) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet.`
      : "No Sunbrella colors doc loaded — fill fabrics manually from the FAB-* dictionary dropdown.",
    5,
  );
  fabricsSheet.getRow(2).values = [
    "E-Comm Slot",
    "CC Patio Internal ID",
    "Public Display Name",
    "Fabric Grade",
    "Swatch",
  ];
  paintHeaderRow(fabricsSheet, 2, 5);

  const slotCount = Math.max(webFabrics.length, webFabrics.length === 0 ? FABRIC_SLOT_COUNT : 0);

  for (let i = 0; i < slotCount; i += 1) {
    const rowNum = i + 3;
    const selection = webFabrics[i];
    const matched = selection
      ? matchFabricSku(selection.displayName, data.fabrics)
      : null;

    const slotCell = fabricsSheet.getCell(`A${rowNum}`);
    slotCell.value = `Web Fabric ${i + 1}`;
    lockCell(slotCell, true);

    const idCell = fabricsSheet.getCell(`B${rowNum}`);
    idCell.value = matched?.sku ?? "";
    idCell.font = { name: "Consolas", size: 10 };
    if (matched) {
      lockCell(idCell, true);
    } else {
      unlockCell(idCell);
      // Unmatched colorways (e.g. SOLVE LINEN) — enter FAB-* manually once minted
    }

    const nameCell = fabricsSheet.getCell(`C${rowNum}`);
    nameCell.value = selection
      ? selection.displayName
      : matched
        ? displayLabel(matched.sku, matched.name)
        : "";
    lockCell(nameCell, Boolean(selection));

    const gradeCell = fabricsSheet.getCell(`D${rowNum}`);
    gradeCell.value = "";
    unlockCell(gradeCell);
    gradeCell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [gradeRange],
      showErrorMessage: true,
      errorTitle: "Invalid grade",
      error: "Grade must be A, B, C, D, E, or F.",
    };

    fabricsSheet.getRow(rowNum).height = selection?.imagePath ? 64 : 18;

    if (selection?.imagePath && fs.existsSync(selection.imagePath)) {
      const ext = path.extname(selection.imagePath).toLowerCase();
      const extension = ext === ".png" ? "png" : "jpeg";
      const imageId = wb.addImage({
        filename: selection.imagePath,
        extension,
      });
      fabricsSheet.addImage(imageId, {
        tl: { col: 4, row: rowNum - 1 },
        ext: { width: 72, height: 56 },
        editAs: "oneCell",
      });
    }
  }

  fabricsSheet.getColumn(1).width = 14;
  fabricsSheet.getColumn(2).width = 18;
  fabricsSheet.getColumn(3).width = 36;
  fabricsSheet.getColumn(4).width = 14;
  fabricsSheet.getColumn(5).width = 14;
  fabricsSheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: Math.max(2, slotCount + 2), column: 4 },
  };

  await fabricsSheet.protect(WORKSHEET_PROTECT_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  // --- Tab 2: Web Finishes ---
  const finishesSheet = wb.addWorksheet("Web Finishes", {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  writeNoteRow(
    finishesSheet,
    "Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary.",
    4,
  );
  finishesSheet.getRow(2).values = [
    "Material Type",
    "Finish Name",
    "E-Comm Approved?",
    "Retail Upcharge ($)",
  ];
  paintHeaderRow(finishesSheet, 2, 4);

  const finishRows: Array<{ type: string; label: string }> = [
    ...data.powders.map((row) => ({
      type: "Powder",
      label: displayLabel(row.sku, row.name),
    })),
    ...data.dektons.map((row) => ({
      type: "Dekton",
      label: displayLabel(row.sku, row.name),
    })),
  ];

  finishRows.forEach((row, i) => {
    const rowNum = i + 3;
    const typeCell = finishesSheet.getCell(`A${rowNum}`);
    typeCell.value = row.type;
    lockCell(typeCell, true);

    const nameCell = finishesSheet.getCell(`B${rowNum}`);
    nameCell.value = row.label;
    lockCell(nameCell, true);

    const approvedCell = finishesSheet.getCell(`C${rowNum}`);
    approvedCell.value = "";
    unlockCell(approvedCell);
    approvedCell.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [yesNoRange],
      showErrorMessage: true,
      errorTitle: "Invalid",
      error: "Choose Yes or No.",
    };

    const upchargeCell = finishesSheet.getCell(`D${rowNum}`);
    upchargeCell.value = null;
    upchargeCell.numFmt = "$#,##0.00";
    unlockCell(upchargeCell);
  });

  finishesSheet.getColumn(1).width = 14;
  finishesSheet.getColumn(2).width = 48;
  finishesSheet.getColumn(3).width = 18;
  finishesSheet.getColumn(4).width = 18;

  await finishesSheet.protect(WORKSHEET_PROTECT_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  // --- Tab 3: Phase 1 & 2 Products (enriched from Website Products) ---
  const productsSheet = wb.addWorksheet("Phase 1 & 2 Products", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });
  writeNoteRow(
    productsSheet,
    "Phase 1 & 2 SOW list only. Master SKU is sku-engine locked. Price, copy, dims, flags, and drawings are filled from 'Copy of Website Products' when matched; blank fields need sales/ops input.",
    PHASE_PRODUCTS_HEADERS.length,
  );
  productsSheet.getRow(2).values = [...PHASE_PRODUCTS_HEADERS];
  paintHeaderRow(productsSheet, 2, PHASE_PRODUCTS_HEADERS.length);

  const productRows: Array<{ name: string; phase: 1 | 2 }> = [
    ...SOW_PHASE_1.map((name) => ({ name, phase: 1 as const })),
    ...SOW_PHASE_2.map((name) => ({ name, phase: 2 as const })),
  ];

  const sowRefs = productRows.map((row) => ({
    name: row.name,
    phase: row.phase,
    masterSku: mintMasterSku(row.name),
  }));
  const websiteMatches = matchWebsiteProductsToSow(
    sowRefs,
    data.websiteProducts ?? [],
    mintMasterSku,
  );

  productRows.forEach((row, i) => {
    const rowNum = i + 3;
    const sku = mintMasterSku(row.name);
    const web = websiteMatches.get(row.name);
    const dims =
      (web ? formatWebsiteDimensions(web) : "") || formatProductDimensions(row.name);
    const weightNum = web?.weight
      ? Number(String(web.weight).replace(/[^0-9.]/g, ""))
      : null;

    const values: Array<string | number | null> = [
      row.name,
      sku,
      "", // Drawing — image overlay
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
      const cell = productsSheet.getCell(rowNum, colIdx + 1);
      cell.value = value;
      if (colIdx === 0 || colIdx === 1 || colIdx === 20) {
        lockCell(cell, true);
      } else {
        unlockCell(cell);
      }
      if (colIdx === 1) cell.font = { name: "Consolas", size: 10 };
      if (colIdx === 4 || colIdx === 5) cell.numFmt = "$#,##0.00";
      if (colIdx === 7) cell.numFmt = "0.00";
      if (colIdx === 8 || colIdx === 9) {
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    });

    if (web?.imageBuffer && web.imageExtension) {
      productsSheet.getRow(rowNum).height = 72;
      const imageId = wb.addImage({
        buffer: web.imageBuffer as any,
        extension: web.imageExtension,
      });
      productsSheet.addImage(imageId, {
        tl: { col: 2, row: rowNum - 1 },
        ext: { width: 96, height: 64 },
        editAs: "oneCell",
      });
    }
  });

  const colWidths = [
    42, 24, 14, 14, 16, 16, 18, 12, 44, 36, 16, 12, 12, 16, 10, 10, 10, 10, 22,
    36, 8,
  ];
  colWidths.forEach((w, i) => {
    productsSheet.getColumn(i + 1).width = w;
  });
  productsSheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: productRows.length + 2, column: PHASE_PRODUCTS_HEADERS.length },
  };

  await productsSheet.protect(WORKSHEET_PROTECT_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  // --- Tab 4: Upcharge Matrix ---
  const upchargeSheet = wb.addWorksheet("Upcharge Matrix", {
    views: [{ state: "frozen", ySplit: 2 }],
  });
  writeNoteRow(
    upchargeSheet,
    "Define flat dollar upcharges for fabric grades (maps Tab 1 Grade → retail delta) and modular add-ons. Add-ons seeded from Website Products + defaults. Grade A is $0 baseline.",
    4,
  );
  upchargeSheet.getRow(2).values = [
    "Category",
    "Option / Grade",
    "Retail Upcharge ($)",
    "Notes",
  ];
  paintHeaderRow(upchargeSheet, 2, 4);

  let upchargeRow = 3;
  for (const grade of FABRIC_GRADE_ROWS) {
    const catCell = upchargeSheet.getCell(`A${upchargeRow}`);
    catCell.value = "Fabric Grade";
    lockCell(catCell, true);

    const optCell = upchargeSheet.getCell(`B${upchargeRow}`);
    optCell.value = `Grade ${grade.grade}`;
    lockCell(optCell, true);

    const dollarCell = upchargeSheet.getCell(`C${upchargeRow}`);
    dollarCell.numFmt = "$#,##0.00";
    if (grade.lockedDefault && grade.defaultUpcharge === 0) {
      dollarCell.value = 0;
      lockCell(dollarCell, true);
    } else {
      dollarCell.value = null;
      unlockCell(dollarCell);
    }

    const notesCell = upchargeSheet.getCell(`D${upchargeRow}`);
    notesCell.value =
      grade.grade === "A"
        ? "Baseline — no upcharge"
        : "Enter flat $ added to Web Base Price when this grade is selected";
    unlockCell(notesCell);
    upchargeRow += 1;
  }

  const websiteAddOns = collectWebsiteAddOns(data.websiteProducts ?? []);
  const addOnRows = [
    ...DEFAULT_ADD_ON_ROWS,
    ...websiteAddOns.filter(
      (name) =>
        !DEFAULT_ADD_ON_ROWS.some(
          (d) => d.toLowerCase() === name.toLowerCase(),
        ),
    ),
  ];

  for (const addOn of addOnRows) {
    const catCell = upchargeSheet.getCell(`A${upchargeRow}`);
    catCell.value = "Add-On";
    lockCell(catCell, true);

    const optCell = upchargeSheet.getCell(`B${upchargeRow}`);
    optCell.value = addOn;
    lockCell(optCell, true);

    const dollarCell = upchargeSheet.getCell(`C${upchargeRow}`);
    dollarCell.value = null;
    dollarCell.numFmt = "$#,##0.00";
    unlockCell(dollarCell);

    const notesCell = upchargeSheet.getCell(`D${upchargeRow}`);
    notesCell.value = websiteAddOns.includes(addOn)
      ? "From Website Products Add-Ons — confirm retail $"
      : "Verify with sales — e.g. $100 per applicable arm";
    unlockCell(notesCell);
    upchargeRow += 1;
  }

  // Extra blank add-on rows for team to extend
  for (let i = 0; i < 5; i += 1) {
    const catCell = upchargeSheet.getCell(`A${upchargeRow}`);
    catCell.value = "Add-On";
    unlockCell(catCell);

    const optCell = upchargeSheet.getCell(`B${upchargeRow}`);
    optCell.value = "";
    unlockCell(optCell);

    const dollarCell = upchargeSheet.getCell(`C${upchargeRow}`);
    dollarCell.value = null;
    dollarCell.numFmt = "$#,##0.00";
    unlockCell(dollarCell);

    const notesCell = upchargeSheet.getCell(`D${upchargeRow}`);
    notesCell.value = "";
    unlockCell(notesCell);
    upchargeRow += 1;
  }

  upchargeSheet.getColumn(1).width = 14;
  upchargeSheet.getColumn(2).width = 40;
  upchargeSheet.getColumn(3).width = 18;
  upchargeSheet.getColumn(4).width = 52;

  await upchargeSheet.protect(WORKSHEET_PROTECT_PASSWORD, {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  return wb;
}

export async function writeEcommerceWorksheet(
  outPath = DEFAULT_OUT,
  data?: EcommerceWorksheetData,
): Promise<{ outPath: string; data: EcommerceWorksheetData; matchedProducts: number }> {
  const resolved = data ?? (await loadWorksheetData());
  if (!resolved.webFabrics) {
    try {
      resolved.webFabrics = extractSunbrellaWebFabrics();
    } catch (error) {
      console.warn(
        "[ecom:worksheet] Sunbrella colors docx not loaded:",
        error instanceof Error ? error.message : error,
      );
      resolved.webFabrics = [];
    }
  }
  if (!resolved.websiteProducts) {
    try {
      resolved.websiteProducts = await loadWebsiteProductsFromHandoff();
    } catch (error) {
      console.warn(
        "[ecom:worksheet] Website Products handoff not loaded:",
        error instanceof Error ? error.message : error,
      );
      resolved.websiteProducts = [];
    }
  }

  const sowRefs = [
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
  ];
  const matchedProducts = matchWebsiteProductsToSow(
    sowRefs,
    resolved.websiteProducts,
    mintMasterSku,
  ).size;

  const wb = await buildEcommerceWorksheet(resolved);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await wb.xlsx.writeFile(outPath);
  return { outPath, data: resolved, matchedProducts };
}

async function main(): Promise<void> {
  const { outPath, data, matchedProducts } = await writeEcommerceWorksheet();
  const matchedFabrics =
    data.webFabrics?.filter((row) => matchFabricSku(row.displayName, data.fabrics))
      .length ?? 0;
  console.log("[ecom:worksheet] wrote", outPath);
  console.log("[ecom:worksheet] counts", {
    fabrics: data.fabrics.length,
    powders: data.powders.length,
    dektons: data.dektons.length,
    products: SOW_PHASE_1.length + SOW_PHASE_2.length,
    webFabricsLocked: data.webFabrics?.length ?? 0,
    webFabricsSkuMatched: matchedFabrics,
    websiteProducts: data.websiteProducts?.length ?? 0,
    websiteProductsEcommerce:
      data.websiteProducts?.filter((r) => r.ecommerce).length ?? 0,
    phaseProductsMatched: matchedProducts,
    sourceHandoff: WEBSITE_PRODUCTS_HANDOFF,
  });
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main()
    .catch((error: unknown) => {
      console.error("[ecom:worksheet] fatal", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb().catch(() => undefined);
    });
}
