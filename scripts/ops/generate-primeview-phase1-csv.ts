/**
 * Chunk D (`csv-smoke-live`): build the PrimeView 169-column Phase 1 import CSV
 * and handoff spec from live Hub + SOW + Oct 30 Woo export.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/generate-primeview-phase1-csv.ts
 *
 * Writes (gitignored):
 *   tmp/primeview-phase1-102-import.csv
 *   tmp/PRIMEVIEW_PHASE1_HANDOFF_SPEC.md
 *   tmp/primeview-phase1-csv-report.json
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inArray, like } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_aliases,
  sku_mappings,
  third_party_sources,
} from "../../src/server/db/schema";
import {
  PHASE1_FABRICS,
  PHASE1_RESALE_SKUS,
  correctedDims,
  loadPhase1SowRows,
  parseMoney,
  type SowRow,
} from "./enable-phase1-hub-data";

const TMP = join(process.cwd(), "tmp");
const HEADERS_PATH = join(
  process.cwd(),
  "data_migration/Primeview/product_export_import_headers.csv",
);
const WOO_EXPORT_PATH = join(
  process.cwd(),
  "data_migration/Primeview/wc-product-export-30-10-2026.csv",
);
const OUT_CSV = join(TMP, "primeview-phase1-102-import.csv");
const OUT_HANDOFF = join(TMP, "PRIMEVIEW_PHASE1_HANDOFF_SPEC.md");
const OUT_REPORT = join(TMP, "primeview-phase1-csv-report.json");

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;
const PARCEL_MAX_LB = 50;

const W3D_COLS = [
  "Meta: _w3d_enabled",
  "Meta: _w3d_model_url",
  "Meta: _w3d_model_type",
  "Meta: _w3d_viewer_height",
  "Meta: _w3d_background",
  "Meta: _w3d_camera_position",
  "Meta: _w3d_swatch_material",
  "Meta: _w3d_frame_material",
  "Meta: _w3d_pillow_material",
  "Meta: _w3d_swatch_texture_scale",
  "Meta: _w3d_base_materials",
] as const;

/** SOW canonical → Woo parent product ID (from PRIMEVIEW_25_GOLIVE_PLAN §1). */
const SOW_PARENT_ID: Record<string, string> = {
  // Ready Make
  "FIN-BRV-CLB-CHA-34X34": "9449",
  "FIN-BRV-SWV-CHA-34X34": "27630",
  "FIN-BRV-LOV-SOF-60X34": "9455",
  "FIN-BRV-MIN-LOV-48X34": "9455", // armed mini; armless uses 27660 via name
  "FIN-BRV-SOF-72X34": "27650",
  "FIN-BRV-SOF-84X34": "27650",
  "FIN-BRV-SOF-96X34": "27650",
  "FIN-BRV-ARM-SOF-72X34": "27660",
  "FIN-BRV-ARM-SOF-84X34": "27660",
  "FIN-BRV-ARM-SOF-96X34": "27660",
  "FIN-BRV-COR-SOF-72X34": "27674",
  "FIN-BRV-COR-SOF-84X34": "27674",
  "FIN-BRV-COR-SOF-96X34": "27674",
  "FIN-BRV-COR-CHS-72X34": "27687",
  "FIN-BRV-COR-CHS-84X34": "27687",
  "FIN-BRV-SGL-CHS-30X79": "27703",
  "FIN-BRV-DOU-CHS-58X79": "27703",
  "FIN-BRV-DYB-84X84": "27715", // round default; square daybed remapped by name
  "FIN-BRV-DYB-72X72": "27719",
  "FIN-BRV-DYB-84X72": "27719",
  "FIN-BRK-SGL-CHS-38X79": "8598",
  "FIN-BRK-DOU-CHS-58X79": "8598",
  "FIN-BRK-TRA-DOU-CHS-48X72": "27748",
  "FIN-BRK-TRA-SGL-CHS-36X72": "27748",
  "FIN-OCN-CLB-CHA-34X38": "27787",
  "FIN-OCN-SWV-CHA-34X38": "26791",
  "FIN-OCN-SOF-72X38": "27796",
  "FIN-OCN-SOF-84X38": "27796",
  "FIN-OCN-SOF-96X38": "27796",
  "FIN-OCN-MIN-LOV-48X38": "27813",
  "FIN-OCN-LOV-SOF-60X38": "27813",
  "FIN-OCN-SGL-CHS-36X79": "27816",
  "FIN-OCN-DOU-CHS-58X79": "27816",
  "FIN-MLN-CLB-CHA-32X36": "27824",
  "FIN-MLN-OTT-22X60": "27830",
  "FIN-MLN-OTT-22X72": "27830",
  "FIN-MLN-OTT-34X60": "27830",
  "FIN-MLN-OTT-56X42": "27830",
  "FIN-MLN-SOF-72X36": "27836",
  "FIN-MLN-SOF-84X36": "27836",
  "FIN-MLN-SOF-96X36": "27836",
  "FIN-MLN-SOF-60X62": "27849",
  "FIN-MLN-SOF-62X42": "27836",
  "FIN-OCN-SID-TAB-36X17": "27862",
  "FIN-BRV-COF-TAB-28X42": "27865",
  "FIN-BRV-COF-TAB-36X36": "27865",
  "FIN-BRV-COF-TAB-36X56": "27865",
  "FIN-BRV-COF-TAB-42X42": "27865",
  "FIN-BRV-COF-TAB-42X56": "27865",
  "FIN-BRV-COF-TAB-56X56": "27865",
  "FIN-OCN-COF-TAB-28X56": "27902",
  "FIN-OCN-COF-TAB-36X56": "27902",
  "FIN-OCN-COF-TAB-36X72": "27902",
  "FIN-OCN-COF-TAB-42X42": "27902",
  "FIN-OCN-COF-TAB-42X56": "27902",
  "FIN-OCN-COF-TAB-56X56": "27902",
  "FIN-OCN-COF-TAB-28X42": "27902",
  "FIN-OCN-TAB-34X12": "27930",
  "FIN-OCN-TAB-13X30": "27948",
  "FIN-BRK-BAR-TAB-36X36": "28049",
  "FIN-BRK-BAR-TAB-42X42": "28049",
  "FIN-BRK-CNT-TAB-36X36": "28049",
  "FIN-BRK-CNT-TAB-42X42": "28049",
  "FIN-BRK-DIN-TAB-36X36": "28049",
  "FIN-BRK-DIN-TAB-42X42": "28049",
  "FIN-WFT-DIN-BCH-72X22": "28136",
  "FIN-WFT-DIN-BCH-96X22": "28136",
  "FIN-WFT-FLY-BST-18X18": "28141",
  "FIN-WFT-BCH-42X18": "28147",
  "FIN-WFT-DIN-CHA-18X18": "28147",
  "FIN-WFT-FLY-BST-17X21": "28157",
  "FIN-TAY-BST-19X23": "28164",
  "FIN-TAY-BST-24X23": "28164",
  "FIN-TAY-DIN-CHA-24X23": "28199",
  "FIN-BRV-OTT-22X30": "28206",
  "FIN-BRV-OTT-22X42": "28206",
  "FIN-BRV-OTT-22X60": "28206",
  "FIN-BRV-OTT-22X72": "28206",
  "FIN-OCN-OTT-30X22": "28248",
  "FIN-BRV-SWG-72X12": "28276",
  "FIN-BRV-SWG-66X42": "28276",
  "FIN-BRV-SWG-72X42": "28276",
  "FIN-BRV-SWG-96X32": "28276",
  "FIN-CAB-MIS-17X17": "28296",
  "FIN-CAB-MIS-23X23": "28296",
  "FIN-CAB-MIS-12X24": "28296",
  // Resale
  "FIN-KIN-MIS": "28311", // heater default; lamp remapped by name
  "FIN-TJM-MIS": "28316", // laylo default; shayz/woosah remapped by name
  "FIN-TJM-CHA": "28325", // freelo default; moon remapped by name
  "FIN-TJM-TAB": "28335",
  "FIN-MLN-UMB": "28337",
  "FIN-CAN-UMB": "28343",
};

/** Curated Phase 1 fabric swatches — real PrimeView HTTPS host, never example.com. */
const FABRIC_SWATCH_META: Record<
  string,
  { label: string; color: string }
> = {
  "FAB-ACT-ASH": { label: "Action Ash", color: "#A8A29A" },
  "FAB-ACT-STO": { label: "Action Stone", color: "#C4B9A8" },
  "FAB-ADA-IND": { label: "Adaptation Indigo", color: "#3D4F6F" },
  "FAB-ADA-STO": { label: "Adaptation Stone", color: "#B7AFA3" },
  "FAB-AGR-IND": { label: "Agra Indigo", color: "#2F3E5C" },
  "FAB-ARI-DEW": { label: "Ariana Dew", color: "#D8D2C4" },
  "FAB-ARR-CAR": { label: "Array Caribbean", color: "#4A7C8C" },
  "FAB-ARR-DUN": { label: "Array Dune", color: "#C9B89A" },
  "FAB-ARR-CAL": { label: "Array Calypso", color: "#D4A574" },
  "FAB-ASC-SPA": { label: "Ascend Spa", color: "#8FA9A3" },
  "FAB-ASC-TRO": { label: "Ascend Tropical", color: "#3F6B5A" },
  "FAB-ASS-SAN": { label: "Assemble Sand", color: "#D2C3A8" },
  "FAB-ASS-IITEA": { label: "Assemble II Teak", color: "#B08968" },
  "FAB-AUT-PEB": { label: "Authentic Pebble", color: "#9A958C" },
  "FAB-BER-TUX": { label: "Berenson Tuxedo", color: "#2B2B2B" },
  "FAB-BEA-ULT": { label: "Beacon Ultraleather", color: "#E8E4DC" },
  "FAB-BLE-IND": { label: "Blend Indigo", color: "#44587A" },
  "FAB-BLE-LIN": { label: "Blend Linen", color: "#D9D0C0" },
  "FAB-BLE-SAN": { label: "Blend Sand", color: "#D6C7AE" },
  "FAB-BLI-ALO": { label: "Bliss Aloe", color: "#A8B89A" },
  "FAB-BLI-DEW": { label: "Bliss Dew", color: "#E2DDD2" },
  "FAB-BLI-GUA": { label: "Bliss Guava", color: "#C97B6E" },
  "FAB-BLI-LIN": { label: "Bliss Linen", color: "#DED6C8" },
  "FAB-BLI-SAN": { label: "Bliss Sand", color: "#D4C6B0" },
};

export type CsvRow = Record<string, string>;

/** RFC4180 CSV parse that keeps multiline quoted fields. */
export function parseCsvMultiline(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

export function loadHeaders(): string[] {
  const raw = readFileSync(HEADERS_PATH, "utf8");
  const first = parseCsvMultiline(raw)[0] ?? [];
  return first.map((h) => h.replace(/^\uFEFF/, "").trim());
}

export function loadWooExport(): { headers: string[]; rows: CsvRow[] } {
  const table = parseCsvMultiline(readFileSync(WOO_EXPORT_PATH, "utf8"));
  const headers = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, "").trim());
  const rows = table.slice(1).map((cols) => {
    const o: CsvRow = {};
    for (let i = 0; i < headers.length; i++) o[headers[i]!] = cols[i] ?? "";
    return o;
  });
  return { headers, rows };
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function writeCsv(path: string, headers: string[], rows: CsvRow[]): void {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => headers.map((h) => csvEscape(r[h] ?? "")).join(",")),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

export function lbToKg(lb: number): string {
  return (Math.round(lb * LB_TO_KG * 100) / 100).toFixed(2);
}

export function inToCm(inches: number): string {
  return (Math.round(inches * IN_TO_CM * 100) / 100).toFixed(2);
}

export function shippingClass(weightLb: number): string {
  return weightLb >= PARCEL_MAX_LB ? "freight-ltl" : "parcel";
}

export function buildFabricSwatchesJson(
  fabrics: ReadonlyArray<{ sku: string; name: string }>,
): string {
  const arr = PHASE1_FABRICS.map((sku) => {
    const meta = FABRIC_SWATCH_META[sku];
    const hub = fabrics.find((f) => f.sku === sku);
    const label =
      meta?.label ??
      (hub?.name
        ? hub.name
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase())
        : sku);
    const color = meta?.color ?? "#CCCCCC";
    const image_url = `https://ccpatiodev2.primeview.com/wp-content/uploads/2026/11/fabrics/${sku.toLowerCase()}.jpg`;
    return { label, color, image_url, fabric_sku: sku };
  });
  return JSON.stringify(arr);
}

export function isUpholstered(sow: SowRow, parentName: string): boolean {
  const opts = sow.options.toLowerCase();
  if (opts.includes("fabric")) return true;
  if (sow.sku.startsWith("FIN-CAB-")) return true;
  if (/table|umbrella|heater|lamp|ripple|cantilever|lido/i.test(sow.name)) return false;
  if (/table|umbrella/i.test(parentName)) return false;
  // Resale molded/plastic without fabric options
  if ((PHASE1_RESALE_SKUS as readonly string[]).includes(sow.sku) && !opts.includes("fabric")) {
    return false;
  }
  // Seating / ottoman / swing / pillow / bench / chair / sofa / chaise / daybed
  return /sofa|chair|chaise|loveseat|ottoman|bench|daybed|swing|pillow|barstool|lounger/i.test(
    `${sow.name} ${parentName}`,
  );
}

/** Resolve purchasable Woo SKU (canonical or registered alias) for a SOW row. */
export function resolvePurchasableSku(
  sow: SowRow,
  aliasByCanonical: Map<string, string[]>,
): { wooSku: string; parentId: string; reason: string } {
  const name = sow.name.toUpperCase();
  let parentId = SOW_PARENT_ID[sow.sku] ?? "";
  let wooSku = sow.sku;
  let reason = "canonical";

  const pickAlias = (candidates: string[]): string | null => {
    const registered = aliasByCanonical.get(sow.sku) ?? [];
    for (const c of candidates) {
      if (registered.includes(c)) return c;
    }
    return candidates[0] ?? null;
  };

  // Parent remaps by product name
  if (sow.sku === "FIN-BRV-MIN-LOV-48X34" && name.includes("ARMLESS")) {
    parentId = "27660";
    wooSku = pickAlias(["FIN-BRV-MIN-LOV-48X34-ARMLESS"]) ?? wooSku;
    reason = "armless-mini-alias";
  } else if (sow.sku === "FIN-BRV-DYB-84X84" && name.includes("ROUND")) {
    parentId = "27715";
    wooSku = pickAlias(["FIN-BRV-DYB-84X84-RND", "FIN-BRV-RND-DYB-84"]) ?? wooSku;
    reason = "round-daybed-alias";
  } else if (sow.sku === "FIN-BRV-DYB-84X84" && !name.includes("ROUND")) {
    parentId = "27719";
    reason = "square-daybed-canonical";
  } else if (sow.sku === "FIN-KIN-MIS" && name.includes("LAMP")) {
    parentId = "28315";
    wooSku = pickAlias(["FIN-KIN-MIS-LAMP"]) ?? wooSku;
    reason = "kindle-lamp";
  } else if (sow.sku === "FIN-KIN-MIS") {
    parentId = "28311";
    wooSku = pickAlias(["FIN-KIN-MIS-HEATER"]) ?? wooSku;
    reason = "kindle-heater";
  } else if (sow.sku === "FIN-TJM-CHA" && name.includes("MOON")) {
    parentId = "28332";
    wooSku = pickAlias(["FIN-TJM-CHA-MOON"]) ?? wooSku;
    reason = "moon-chair";
  } else if (sow.sku === "FIN-TJM-CHA") {
    parentId = "28325";
    wooSku = pickAlias(["FIN-TJM-CHA-FREELO"]) ?? wooSku;
    reason = "freelo-chair";
  } else if (sow.sku === "FIN-TJM-MIS" && name.includes("SHAYZ")) {
    parentId = "28326";
    wooSku =
      pickAlias(["FIN-TJM-MIS-SHAYZ-5", "FIN-TJM-MIS-2SHAYZ"]) ?? wooSku;
    reason = "shayz";
  } else if (sow.sku === "FIN-TJM-MIS" && name.includes("WOOSAH")) {
    parentId = "28334";
    wooSku =
      pickAlias(["FIN-TJM-MIS-WOOSAH", "FIN-TJM-MIS-2WOOSAH"]) ?? wooSku;
    reason = "woosah";
  } else if (sow.sku === "FIN-TJM-MIS" && name.includes("LAYLO") && name.includes("4")) {
    parentId = "28316";
    wooSku = pickAlias(["FIN-TJM-MIS-LAYLO-4RISER"]) ?? wooSku;
    reason = "laylo-4riser";
  } else if (sow.sku === "FIN-TJM-MIS" && name.includes("LAYLO")) {
    parentId = "28316";
    wooSku =
      pickAlias(["FIN-TJM-MIS-LAYLO-NORISER", "FIN-TJM-MIS-LAYLO"]) ?? wooSku;
    reason = "laylo-noriser";
  } else if (name.includes("BAR HEIGHT") || /\(BAR HEIGHT\)/.test(name)) {
    const alias = pickAlias([`${sow.sku}-BAR`]);
    if (alias) {
      wooSku = alias;
      reason = "bar-height";
    }
  } else if (name.includes("COUNTER HEIGHT") || /\(COUNTER HEIGHT\)/.test(name)) {
    const alias = pickAlias([`${sow.sku}-CNT`]);
    if (alias) {
      wooSku = alias;
      reason = "counter-height";
    }
  }

  if (!parentId) {
    throw new Error(`No Woo parent mapping for ${sow.sku} (${sow.name})`);
  }
  return { wooSku, parentId, reason };
}

function dimTokens(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
}

function scoreVariation(sow: SowRow, variation: CsvRow): number {
  const hay = `${variation.Name} ${variation["Attribute 1 value(s)"]}`.toUpperCase();
  const dims = correctedDims(sow.sku, sow);
  const want = [dims.length, dims.depth, dims.height].filter(Boolean) as string[];
  const have = dimTokens(hay);
  let score = 0;
  for (const w of want) {
    if (have.includes(w)) score += 3;
  }
  const name = sow.name.toUpperCase();
  if (name.includes("BAR HEIGHT") && hay.includes("BAR")) score += 2;
  if (name.includes("COUNTER HEIGHT") && hay.includes("COUNTER")) score += 2;
  if (name.includes("DINING HEIGHT") && hay.includes("DINING")) score += 2;
  if (name.includes("ROUND") && hay.includes("ROUND")) score += 2;
  if (name.includes("ARMLESS") && hay.includes("ARMLESS")) score += 2;
  if (name.includes("NO RISERS") && hay.includes("NO RISERS")) score += 5;
  if (name.includes('4" RISERS') && hay.includes("4")) score += 4;
  if (name.includes("SHAYZ") && hay.includes("5")) score += 4;
  if (name.includes("LUMBAR") && hay.includes("LUMBAR")) score += 3;
  if (name.includes("SQUARE") && hay.includes("SQUARE")) score += 2;
  // Prefer exact LxDxH substring
  if (dims.length && dims.depth && dims.height) {
    const pattern = `${dims.length}"`;
    if (hay.includes(pattern)) score += 1;
  }
  return score;
}

function blankRow(headers: string[]): CsvRow {
  const o: CsvRow = {};
  for (const h of headers) o[h] = "";
  return o;
}

function projectToHeaders(source: CsvRow, headers: string[]): CsvRow {
  const o = blankRow(headers);
  for (const h of headers) {
    if (h in source) o[h] = source[h] ?? "";
  }
  return o;
}

function forceBlankW3d(row: CsvRow): void {
  for (const col of W3D_COLS) {
    if (col in row) row[col] = "";
  }
}

function applyPurchasableMetrics(
  row: CsvRow,
  opts: {
    sku: string;
    price: string;
    weightLb: number;
    lengthIn: number | null;
    depthIn: number | null;
    heightIn: number | null;
  },
): void {
  row.SKU = opts.sku;
  row["Regular price"] = opts.price;
  row["Weight (kg)"] = lbToKg(opts.weightLb);
  if (opts.lengthIn != null) row["Length (cm)"] = inToCm(opts.lengthIn);
  if (opts.depthIn != null) row["Width (cm)"] = inToCm(opts.depthIn);
  if (opts.heightIn != null) row["Height (cm)"] = inToCm(opts.heightIn);
  row["Shipping class"] = shippingClass(opts.weightLb);
  row.Published = row.Published || "1";
  row["In stock?"] = row["In stock?"] || "1";
}

export type HandoffLine = {
  sowRow: number;
  sowName: string;
  canonicalSku: string;
  wooSku: string;
  parentId: string;
  parentName: string;
  variationId: string;
  attr1: string;
  price: string;
  weightLb: string;
  weightKg: string;
  shipping: string;
  fulfillment: "Make" | "Resale";
  reason: string;
};

async function main() {
  mkdirSync(TMP, { recursive: true });
  const headers = loadHeaders();
  if (headers.length !== 169) {
    throw new Error(`Expected 169 headers, got ${headers.length}`);
  }
  if (headers[0] !== "ID") {
    throw new Error(`First header must be ID (got ${JSON.stringify(headers[0])})`);
  }

  const woo = loadWooExport();
  const parentsById = new Map(
    woo.rows
      .filter((r) => r.Type === "variable" || r.Type === "simple")
      .map((r) => [r.ID, r]),
  );
  const varsByParent = new Map<string, CsvRow[]>();
  for (const r of woo.rows.filter((x) => x.Type === "variation")) {
    const pid = (r.Parent || "").replace(/^id:/i, "");
    const list = varsByParent.get(pid) ?? [];
    list.push(r);
    varsByParent.set(pid, list);
  }

  const sow = loadPhase1SowRows();
  if (sow.length !== 102) throw new Error(`Expected 102 SOW rows, got ${sow.length}`);

  const db = getDb();
  const skus = [...new Set(sow.map((s) => s.sku))];
  const fgc = await db
    .select({
      sku: finished_goods_catalog.global_sku,
      msrp: finished_goods_catalog.msrp,
      weight: finished_goods_catalog.weight,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
    })
    .from(finished_goods_catalog)
    .where(inArray(finished_goods_catalog.global_sku, skus));
  const fgcBySku = new Map(fgc.map((r) => [r.sku, r]));

  const listings = await db
    .select({
      sku: ecommerce_listings.global_sku,
      steel: ecommerce_listings.steel_msrp,
    })
    .from(ecommerce_listings)
    .where(inArray(ecommerce_listings.global_sku, skus));
  const listingBySku = new Map(listings.map((r) => [r.sku, r]));

  const aliases = await db
    .select({
      alias: sku_aliases.alias_sku,
      canonical: sku_aliases.canonical_sku,
    })
    .from(sku_aliases)
    .where(like(sku_aliases.canonical_sku, "FIN-%"));
  const aliasByCanonical = new Map<string, string[]>();
  const aliasToCanonical = new Map<string, string>();
  for (const a of aliases) {
    const list = aliasByCanonical.get(a.canonical) ?? [];
    list.push(a.alias);
    aliasByCanonical.set(a.canonical, list);
    aliasToCanonical.set(a.alias, a.canonical);
  }

  const fabricRows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, [...PHASE1_FABRICS]));

  const tps = await db
    .select({ sku: third_party_sources.global_sku })
    .from(third_party_sources)
    .where(inArray(third_party_sources.global_sku, [...PHASE1_RESALE_SKUS]));
  const tpsSet = new Set(tps.map((t) => t.sku));

  const swatchesJson = buildFabricSwatchesJson(fabricRows);

  const handoff: HandoffLine[] = [];
  const usedVarIds = new Set<string>();
  const usedSkus = new Set<string>();
  const parentIdsNeeded = new Set<string>();
  const variationRows: CsvRow[] = [];
  const simpleParentOverrides = new Map<string, { sku: string; sow: SowRow }>();

  for (const row of sow) {
    const resolved = resolvePurchasableSku(row, aliasByCanonical);
    const parent = parentsById.get(resolved.parentId);
    if (!parent) {
      throw new Error(`Woo parent ${resolved.parentId} missing for ${row.sku}`);
    }
    parentIdsNeeded.add(resolved.parentId);

    const hub = fgcBySku.get(row.sku);
    const dims = correctedDims(row.sku, row);
    const price =
      parseMoney(row.msrp) ??
      listingBySku.get(row.sku)?.steel ??
      hub?.msrp ??
      "";
    if (!price || Number(price) <= 0) {
      throw new Error(`Missing positive price for ${row.sku}`);
    }
    const weightLb = Number(hub?.weight ?? row.baseWeight ?? "0");
    if (!(weightLb > 0)) {
      throw new Error(`Missing positive weight for ${row.sku}`);
    }

    if (parent.Type === "simple") {
      if (usedSkus.has(resolved.wooSku)) {
        throw new Error(`Duplicate purchasable SKU ${resolved.wooSku}`);
      }
      usedSkus.add(resolved.wooSku);
      simpleParentOverrides.set(resolved.parentId, { sku: resolved.wooSku, sow: row });
      handoff.push({
        sowRow: row.sowRow,
        sowName: row.name,
        canonicalSku: row.sku,
        wooSku: resolved.wooSku,
        parentId: resolved.parentId,
        parentName: parent.Name,
        variationId: resolved.parentId,
        attr1: "(simple)",
        price,
        weightLb: weightLb.toFixed(2),
        weightKg: lbToKg(weightLb),
        shipping: shippingClass(weightLb),
        fulfillment: tpsSet.has(row.sku) ? "Resale" : "Make",
        reason: resolved.reason,
      });
      continue;
    }

    // Match existing variation
    const candidates = (varsByParent.get(resolved.parentId) ?? []).filter(
      (v) => !usedVarIds.has(v.ID),
    );
    let best: CsvRow | null = null;
    let bestScore = -1;
    for (const v of candidates) {
      const s = scoreVariation(row, v);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    if (!best || bestScore < 3) {
      // Create new variation row
      best = blankRow(woo.headers);
      best.ID = "";
      best.Type = "variation";
      best.Parent = `id:${resolved.parentId}`;
      best.Name = `${parent.Name} - ${row.name}`;
      best["Attribute 1 name"] = parent["Attribute 1 name"] || "Select Size";
      best["Attribute 1 value(s)"] = row.name;
      best["Attribute 1 visible"] = "1";
      best["Attribute 1 global"] = "0";
      best.Published = "1";
      best["In stock?"] = "1";
      bestScore = 99;
    }

    if (best.ID) usedVarIds.add(best.ID);
    if (usedSkus.has(resolved.wooSku)) {
      throw new Error(`Duplicate purchasable SKU ${resolved.wooSku} on ${row.name}`);
    }
    usedSkus.add(resolved.wooSku);

    const out = projectToHeaders(best, headers);
    out.Type = "variation";
    out.Parent = `id:${resolved.parentId}`;
    forceBlankW3d(out);
    out.acf_fabric_swatches_json = "";
    applyPurchasableMetrics(out, {
      sku: resolved.wooSku,
      price,
      weightLb,
      lengthIn: dims.length ? Number(dims.length) : null,
      depthIn: dims.depth ? Number(dims.depth) : null,
      heightIn: dims.height ? Number(dims.height) : null,
    });
    // Keep Attribute 1 value from matched variation when present
    if (!out["Attribute 1 value(s)"]) {
      out["Attribute 1 value(s)"] = row.name;
    }
    variationRows.push(out);

    handoff.push({
      sowRow: row.sowRow,
      sowName: row.name,
      canonicalSku: row.sku,
      wooSku: resolved.wooSku,
      parentId: resolved.parentId,
      parentName: parent.Name,
      variationId: out.ID || "(new)",
      attr1: out["Attribute 1 value(s)"],
      price,
      weightLb: weightLb.toFixed(2),
      weightKg: lbToKg(weightLb),
      shipping: shippingClass(weightLb),
      fulfillment: tpsSet.has(row.sku) ? "Resale" : "Make",
      reason: resolved.reason,
    });
  }

  // Emit parent rows (Phase 1 parents only)
  const parentRows: CsvRow[] = [];
  for (const pid of [...parentIdsNeeded].sort((a, b) => Number(a) - Number(b))) {
    const parent = parentsById.get(pid)!;
    const out = projectToHeaders(parent, headers);
    forceBlankW3d(out);

    const sampleSow =
      handoff.find((h) => h.parentId === pid) ??
      null;
    const upholstered = sampleSow
      ? isUpholstered(
          sow.find((s) => s.sowRow === sampleSow.sowRow)!,
          parent.Name,
        )
      : false;

    // Any Phase 1 SOW under this parent with fabric → mark upholstered
    const parentUpholstered = handoff
      .filter((h) => h.parentId === pid)
      .some((h) => {
        const s = sow.find((x) => x.sowRow === h.sowRow)!;
        return isUpholstered(s, parent.Name);
      });

    out.acf_fabric_swatches_json = parentUpholstered || upholstered ? swatchesJson : "";

    if (parent.Type === "variable") {
      out.SKU = "";
      // Expand Attribute 1 values to include Phase 1 attr values
      const attrVals = new Set(
        (parent["Attribute 1 value(s)"] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      for (const v of variationRows.filter((r) => r.Parent === `id:${pid}`)) {
        const av = v["Attribute 1 value(s)"];
        if (av) attrVals.add(av);
      }
      if (attrVals.size) {
        out["Attribute 1 value(s)"] = [...attrVals].join(", ");
      }
    } else {
      const override = simpleParentOverrides.get(pid);
      if (override) {
        const dims = correctedDims(override.sow.sku, override.sow);
        const hub = fgcBySku.get(override.sow.sku);
        const price =
          parseMoney(override.sow.msrp) ??
          listingBySku.get(override.sow.sku)?.steel ??
          hub?.msrp ??
          "";
        const weightLb = Number(hub?.weight ?? override.sow.baseWeight ?? "0");
        applyPurchasableMetrics(out, {
          sku: override.sku,
          price,
          weightLb,
          lengthIn: dims.length ? Number(dims.length) : null,
          depthIn: dims.depth ? Number(dims.depth) : null,
          heightIn: dims.height ? Number(dims.height) : null,
        });
      }
    }
    parentRows.push(out);
  }

  const allRows = [...parentRows, ...variationRows];
  writeCsv(OUT_CSV, headers, allRows);

  const makeCount = handoff.filter((h) => h.fulfillment === "Make").length;
  const resaleCount = handoff.filter((h) => h.fulfillment === "Resale").length;

  const handoffMd = `# PrimeView Phase 1 Handoff Spec (102 SOW Items)

**Generated:** ${new Date().toISOString()}
**Import file:** \`tmp/primeview-phase1-102-import.csv\` (169 columns)
**Scope:** All 102 unique Phase 1 SOW rows (${makeCount} Make + ${resaleCount} Resale)

---

## 1. Executive Summary

CC Patio Hub owns catalog authority. This CSV is the turnkey WooCommerce Product CSV Import for PrimeView's WordPress team covering every Phase 1 purchasable SKU with:

- Exact 169 headers from \`product_export_import_headers.csv\` (UTF-8, \`ID\` without BOM corruption)
- Preserved PrimeView parent IDs and existing variation IDs where present
- Globally unique purchasable SKUs on every \`simple\` / \`variation\` row (variable parents keep blank SKU)
- Metric weights/dimensions, shipping class (\`parcel\` < 50 lb, \`freight-ltl\` ≥ 50 lb)
- \`acf_fabric_swatches_json\` on upholstered parents (24 \`web_sellable\` FAB-* swatches, non-placeholder HTTPS URLs)
- Preserved ACF add-on price metas + RankMath/Astra/Brizy from the Oct 30 export
- All \`Meta: _w3d_*\` columns forced blank (3D excluded from Phase 1)

## 2. Import Instructions (PrimeView WP)

1. Backup the staging site (DB + uploads).
2. WooCommerce → Products → Import → upload \`primeview-phase1-102-import.csv\`.
3. Map columns 1:1 (header names already match Woo export/import).
4. Choose **Update existing products** keyed by \`ID\` where ID is present; create when ID blank.
5. After import, spot-check:
   - Bravada Club Chair (\`9449\`) has fabric swatch JSON and blank \`_w3d_enabled\`
   - Fly Leg Chair 18×18×18 (\`FIN-WFT-DIN-CHA-18X18\`) exists under Fly Leg Bench (\`28147\`)
   - Ripple Table (\`28335\`) / Cantilever Umbrella (\`28343\`) have unique simple SKUs
   - No duplicate SKU warnings in the import log
6. Upload the 24 fabric swatch JPGs to the paths referenced in \`acf_fabric_swatches_json\` (or update URLs to the final media library paths).
7. Configure NMI deposit gateway + webhook (see §4–5) before flipping live traffic.

## 3. Parent → Variation SKU Reference (all 102)

| SOW# | Product | Parent ID | Parent | Variation ID | Woo SKU | Canonical | Fulfillment | Price | Wt (lb) | Ship |
| ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | --- |
${handoff
  .map(
    (h) =>
      `| ${h.sowRow} | ${h.sowName.replace(/\|/g, "/")} | ${h.parentId} | ${h.parentName.replace(/\|/g, "/")} | ${h.variationId} | \`${h.wooSku}\` | \`${h.canonicalSku}\` | ${h.fulfillment} | ${h.price} | ${h.weightLb} | ${h.shipping} |`,
  )
  .join("\n")}

### Shared-canonical alias notes

| Alias / Woo SKU | Canonical | When used |
| --- | --- | --- |
| \`FIN-BRV-MIN-LOV-48X34-ARMLESS\` | \`FIN-BRV-MIN-LOV-48X34\` | Armless mini under Armless Sofa parent |
| \`FIN-BRV-DYB-84X84-RND\` | \`FIN-BRV-DYB-84X84\` | Round daybed parent |
| \`…-BAR\` / \`…-CNT\` | matching barstool canonical | Bar vs Counter height |
| \`FIN-KIN-MIS-HEATER\` / \`-LAMP\` | \`FIN-KIN-MIS\` | Kindle heater vs lamp simples |
| \`FIN-TJM-MIS-LAYLO-NORISER\` / \`-LAYLO-4RISER\` | \`FIN-TJM-MIS\` | Laylo riser options |
| \`FIN-TJM-MIS-SHAYZ-5\` / \`-WOOSAH\` | \`FIN-TJM-MIS\` | Shayz / Woosah parents |
| \`FIN-TJM-CHA-FREELO\` / \`-MOON\` | \`FIN-TJM-CHA\` | Freelo / Moon simples |

## 4. Checkout Webhook Contract

\`POST /api/webhooks/woocommerce\`

Headers:

- \`X-WC-Webhook-Topic\`: \`order.created\` or \`order.updated\`
- \`X-WC-Webhook-Signature\`: base64(HMAC-SHA256(secret, raw body))
- \`X-WC-Webhook-Delivery-ID\`: unique delivery id

Body: Woo order JSON. Every purchasable \`line_items[].sku\` must be the **Woo SKU** from §3 (canonical or alias).

| Meta key accepted | Slot | Example |
| --- | --- | --- |
| \`fabric\` **or** \`fabric_sku\` | fabric | \`FAB-ACT-STO\` |
| \`powder_coat\` | powder | \`PWD-BLACK\` |
| \`frame\` **or** \`frame_material\` | frame | \`MET-STEEL\` |
| \`arms\`, \`casters\`, \`dekton_sidearm\`, \`ironwood\`, \`fly_tables\`, \`umbrella_holder\`, \`umbrella_cover\` | add-ons | \`0\`/\`1\` |

Fulfillment routing (Hub authority):

- **Make** (no \`third_party_sources\`): Katana Sales Order **+** Manufacturing Order when \`ORDER_PIPELINE_MODE=live\`
- **Resale** (\`third_party_sources\` present): Katana Sales Order **only** (MO skipped)

Phase 1 launch gate uses \`ORDER_PIPELINE_MODE=log\` (dry-run saga, zero Katana writes) until smoke passes.

## 5. Pre-Launch NMI / Deposit / Webhook QA Checklist

- [ ] NMI keys present in WP + Hub vault; test-mode charge succeeds
- [ ] Deposit percentage matches commercial terms; remainder captured on ship
- [ ] Paid order fires \`order.updated\` with \`date_paid\` set
- [ ] Webhook secret matches Hub \`WOOCOMMERCE_WEBHOOK_SECRET\`
- [ ] Signed smoke order (Make seating + barstool alias + table + pillow + 2 resale) returns 202, zero quarantine
- [ ] \`ORDER_PIPELINE_MODE=log\` dry-run completes; then staged \`live\` flip with Katana SO/MO verification
- [ ] Resale lines never create MOs; Make lines create SO+MO
- [ ] Oh-Crap alert path verified on forced signature failure

---

*End of Phase 1 handoff. Do not begin Phase 2 CSV until Chunk F gate.*
`;

  writeFileSync(OUT_HANDOFF, handoffMd, "utf8");

  const report = {
    headers: headers.length,
    parentRows: parentRows.length,
    variationRows: variationRows.length,
    totalRows: allRows.length,
    sowCovered: handoff.length,
    uniqueSkus: usedSkus.size,
    makeCount,
    resaleCount,
    upholsteredParents: parentRows.filter((p) => p.acf_fabric_swatches_json).length,
    handoff,
  };
  writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        csv: OUT_CSV,
        handoff: OUT_HANDOFF,
        parents: parentRows.length,
        variations: variationRows.length,
        sow: handoff.length,
        uniqueSkus: usedSkus.size,
      },
      null,
      2,
    ),
  );

  await closeDb();
}

const isMain =
  process.argv[1]?.replace(/\\/g, "/").includes("generate-primeview-phase1-csv");

if (isMain) {
  main().catch(async (err) => {
    console.error(err);
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}
