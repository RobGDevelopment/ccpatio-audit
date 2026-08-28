/**
 * Backfill missing jsonb_attributes on sku_mappings from local spreadsheets.
 *
 * Matches rows by Global SKU or Original Factory Name, then merges attribute
 * values only into paths that are currently empty/incomplete (never overwrites
 * operator-entered data).
 *
 * Sources (docs/data_sheets/):
 *   - Website Product Info.xlsx → Finished Good taxonomy/dimensions
 *   - CC Patio - Purchasing Database → Metal/Powder UOM hints + spec parsing
 *   - CURRENT DEKTON UPDATED 7.23.26.xlsx → thickness_mm
 *   - CURRENT Fabric Control Inventory 2026-CURRENT.xlsx → pattern + vendor SKU
 *
 * Usage:
 *   npx tsx scripts/backfill-attributes.ts
 *   npx tsx scripts/backfill-attributes.ts --dry-run
 *   npm run db:backfill-attributes
 *
 * Requires DATABASE_URL in .env.local (same as other db scripts).
 */
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { closeDb, getDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";
import {
  getMissingAttributeFields,
  isAttributeValueComplete,
  CATEGORY_REQUIRED_ATTRIBUTES,
} from "../src/server/pim/attributes/health";
import {
  normalizePimCategory,
  parseCategoryAttributes,
} from "../src/server/pim/attributes";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run");
const UPDATED_BY = "backfill-attributes";
const DATA_SHEETS = path.resolve(process.cwd(), "docs", "data_sheets");

const FILES = {
  website: "Website Product Info.xlsx",
  purchasing: "CC Patio - Purchasing Database (v2 2026-08-19).xlsx",
  dekton: "CURRENT DEKTON UPDATED 7.23.26.xlsx",
  fabric: "CURRENT Fabric Control Inventory 2026-CURRENT.xlsx",
} as const;

type MappingRow = {
  global_sku: string;
  category: string;
  original_name: string;
  version: number;
  attributes: Record<string, unknown>;
};

type Stats = {
  examined: number;
  updated: number;
  skippedComplete: number;
  skippedNoMatch: number;
  skippedNoFill: number;
};

function requireFile(fileName: string): string {
  const full = path.join(DATA_SHEETS, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing spreadsheet: ${full}`);
  }
  return full;
}

function cellStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t.length > 0 ? t : null;
}

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/['"]+/g, "")
    .replace(/\s+/g, " ");
}

function cleanDim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim().replace(/['"]+/g, "").replace(/\s+/g, "");
  return t.length > 0 ? t : null;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !isAttributeValueComplete(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).length === 0;
  }
  return false;
}

function mergeAttributesFillMissing(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, nextVal] of Object.entries(incoming)) {
    const curVal = out[key];
    if (
      nextVal &&
      typeof nextVal === "object" &&
      !Array.isArray(nextVal) &&
      curVal &&
      typeof curVal === "object" &&
      !Array.isArray(curVal)
    ) {
      out[key] = mergeAttributesFillMissing(
        curVal as Record<string, unknown>,
        nextVal as Record<string, unknown>,
      );
      continue;
    }
    if (isEmptyValue(curVal) && !isEmptyValue(nextVal)) {
      out[key] = nextVal;
    }
  }
  return out;
}

function sheetRows(
  filePath: string,
  sheetName: string,
  opts?: { range?: number },
): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in ${path.basename(filePath)}`);
  }
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
    ...(opts?.range != null ? { range: opts.range } : {}),
  });
}

function matchFgBaseSku(globalSku: string, baseSku: string): boolean {
  const g = globalSku.replace(/^FIN-/i, "").toUpperCase();
  const b = baseSku.toUpperCase().trim();
  if (!b) return false;
  if (g === b || g.endsWith(b) || g.includes(b)) return true;
  const gt = g.split("-").filter(Boolean);
  const bt = b.split("-").filter(Boolean);
  if (bt.length < 2 || gt.length < 2) return false;
  return (
    gt[0] === bt[0] &&
    gt[1] === bt[1] &&
    gt[gt.length - 1] === bt[bt.length - 1]
  );
}

function nameLooksLike(a: string | null, b: string): boolean {
  const left = normalizeKey(a).split(":")[0]?.trim() ?? "";
  const right = normalizeKey(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

type FgExcel = {
  baseSku: string;
  collection: string | null;
  armHeight: string | null;
  sitHeight: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  productName: string | null;
  memo: string | null;
};

function loadFinishedGoodsExcel(): FgExcel[] {
  const rows = sheetRows(requireFile(FILES.website), "Website Products w Links", {
    range: 4,
  });
  const out: FgExcel[] = [];
  for (const r of rows) {
    const baseSku = cellStr(r["Base SKU"]);
    if (!baseSku || !/[A-Z0-9]+-[A-Z0-9]+/i.test(baseSku)) continue;
    out.push({
      baseSku: baseSku.toUpperCase(),
      collection: cellStr(r.Collections),
      armHeight: cellStr(r["Arm Height"]),
      sitHeight: cellStr(r["Sit Height"]),
      length: cellStr(r.Length),
      depth: cellStr(r.Depth),
      height: cellStr(r.Height),
      productName: cellStr(r["Product/Service full name"]),
      memo: cellStr(r["Memo/Description"]),
    });
  }
  return out;
}

function pickFgExcel(mapping: MappingRow, rows: FgExcel[]): FgExcel | null {
  const byBase = rows.filter((e) => matchFgBaseSku(mapping.global_sku, e.baseSku));
  const candidates =
    byBase.length > 0
      ? byBase
      : rows.filter(
          (e) =>
            nameLooksLike(e.productName, mapping.original_name) ||
            nameLooksLike(e.memo, mapping.original_name),
        );
  return candidates[0] ?? null;
}

function buildFgAttributes(excel: FgExcel): Record<string, unknown> {
  const dimensions: Record<string, unknown> = {};
  const l = cleanDim(excel.length);
  const d = cleanDim(excel.depth);
  const h = cleanDim(excel.height);
  const seat = cleanDim(excel.sitHeight);
  const arm = cleanDim(excel.armHeight);
  if (l) dimensions.l = l;
  if (d) dimensions.d = d;
  if (h) dimensions.h = h;
  if (seat) dimensions.seat_h = seat;
  if (arm) dimensions.arm_h = arm;
  const attrs: Record<string, unknown> = {};
  if (excel.collection) attrs.taxonomy = { collection: excel.collection.trim() };
  if (Object.keys(dimensions).length > 0) attrs.dimensions = dimensions;
  return attrs;
}

type PurchaseExcel = {
  itemName: string;
  description: string | null;
  skuSpec: string | null;
  department: string | null;
};

function loadPurchasingExcel(): PurchaseExcel[] {
  const rows = sheetRows(requireFile(FILES.purchasing), "Item Catalog");
  return rows
    .map((r) => ({
      itemName: cellStr(r["Item Name"]) ?? "",
      description: cellStr(r.Description) ?? cellStr(r["Item / Description"]),
      skuSpec: cellStr(r["SKU / Spec"]),
      department: cellStr(r.Department),
    }))
    .filter((r) => r.itemName.length > 0);
}

function pickPurchaseExcel(
  mapping: MappingRow,
  rows: PurchaseExcel[],
): PurchaseExcel | null {
  const nameKey = normalizeKey(mapping.original_name);
  const byName = rows.find((e) => normalizeKey(e.itemName) === nameKey);
  if (byName) return byName;
  const sku = mapping.global_sku.toUpperCase();
  for (const e of rows) {
    const spec = cellStr(e.skuSpec);
    if (!spec) continue;
    const compact = spec.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (compact.length < 3) continue;
    if (sku === `MET-${compact}` || sku.endsWith(`-${compact}`)) return e;
  }
  return null;
}

/** Heuristic metal attribute extraction from purchasing description/spec. */
function parseMetalAttributes(row: PurchaseExcel): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const blob = `${row.description ?? ""} ${row.skuSpec ?? ""}`.trim();
  if (!blob) return attrs;

  const profileMatch = blob.match(
    /\b(extrusion|tube|angle|channel|flat bar|round bar|sheet|rect(?:angular)? tube|square tube)\b/i,
  );
  if (profileMatch?.[1]) {
    attrs.profile_type =
      profileMatch[1].charAt(0).toUpperCase() +
      profileMatch[1].slice(1).toLowerCase();
  }

  const alloyMatch = blob.match(/\b(6063|6061|6005|7075)(?:-T\d)?\b/i);
  if (alloyMatch?.[0]) attrs.alloy = alloyMatch[0].toUpperCase();

  const dimMatch = blob.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i,
  );
  if (dimMatch) {
    attrs.dimensions = dimMatch[3]
      ? `${dimMatch[1]}x${dimMatch[2]}x${dimMatch[3]}`
      : `${dimMatch[1]}x${dimMatch[2]}`;
    if (dimMatch[3]) attrs.wall_thickness = dimMatch[3];
  }

  const lengthMatch = blob.match(/(\d+(?:\.\d+)?)\s*(?:in|"|inch|ft|')\b/i);
  if (lengthMatch?.[1]) attrs.stock_length = lengthMatch[1];

  return attrs;
}

function loadDektonThicknessByMaterial(): Map<string, number> {
  const rows = sheetRows(requireFile(FILES.dekton), "Slab Locations");
  const map = new Map<string, number>();
  for (const r of rows) {
    const material = cellStr(r.Material);
    const thickCm = cellStr(r["Thickness (cm)"]);
    if (!material || !thickCm) continue;
    const cm = Number(String(thickCm).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(cm) || cm <= 0) continue;
    const key = normalizeKey(material);
    if (!map.has(key)) map.set(key, cm);
  }
  return map;
}

type FabricExcel = { fabric: string; vendorSku: string | null };

function loadFabricExcel(): FabricExcel[] {
  const rows = sheetRows(requireFile(FILES.fabric), "CATALOGO");
  return rows
    .map((r) => ({
      fabric: cellStr(r.FABRIC) ?? "",
      vendorSku: cellStr(r.SKU),
    }))
    .filter((r) => r.fabric.length > 0);
}

function pickFabricExcel(
  mapping: MappingRow,
  rows: FabricExcel[],
): FabricExcel | null {
  return rows.find((e) => normalizeKey(e.fabric) === normalizeKey(mapping.original_name)) ?? null;
}

function buildFabricAttributes(excel: FabricExcel): Record<string, unknown> {
  const toks = excel.fabric.trim().split(/\s+/).filter(Boolean);
  const brand = toks[0] ?? excel.fabric;
  const colorway = toks.slice(1).join(" ") || undefined;
  const attrs: Record<string, unknown> = {
    pattern: {
      name: brand,
      ...(colorway ? { colorway } : {}),
    },
  };
  if (excel.vendorSku) attrs.supply_chain = { sku: excel.vendorSku };
  return attrs;
}

function buildDektonAttributes(thicknessCm: number): Record<string, unknown> {
  return { thickness_mm: String(Math.round(thicknessCm * 10)) };
}

function resolveIncomingAttributes(
  mapping: MappingRow,
  sources: {
    fgExcel: FgExcel[];
    purchaseExcel: PurchaseExcel[];
    dektonByMaterial: Map<string, number>;
    fabricExcel: FabricExcel[];
  },
): Record<string, unknown> | null {
  const cat = normalizePimCategory(mapping.category);

  if (cat === "finished good") {
    const excel = pickFgExcel(mapping, sources.fgExcel);
    return excel ? buildFgAttributes(excel) : null;
  }
  if (cat === "metal" || cat === "aluminum") {
    const excel = pickPurchaseExcel(mapping, sources.purchaseExcel);
    return excel ? parseMetalAttributes(excel) : null;
  }
  if (cat === "dekton") {
    const cm = sources.dektonByMaterial.get(normalizeKey(mapping.original_name));
    return cm != null ? buildDektonAttributes(cm) : null;
  }
  if (cat === "fabric") {
    const excel = pickFabricExcel(mapping, sources.fabricExcel);
    return excel ? buildFabricAttributes(excel) : null;
  }
  return null;
}

function listStillMissing(
  category: string,
  attributes: Record<string, unknown>,
): string[] {
  return getMissingAttributeFields({
    category,
    attributes,
  });
}

async function main(): Promise<void> {
  console.log(`[backfill-attributes] data_sheets=${DATA_SHEETS} dryRun=${DRY_RUN}`);

  for (const file of Object.values(FILES)) {
    requireFile(file);
  }

  const sources = {
    fgExcel: loadFinishedGoodsExcel(),
    purchaseExcel: loadPurchasingExcel(),
    dektonByMaterial: loadDektonThicknessByMaterial(),
    fabricExcel: loadFabricExcel(),
  };

  console.log("[backfill-attributes] spreadsheets loaded", {
    finishedGoods: sources.fgExcel.length,
    purchasing: sources.purchaseExcel.length,
    dektonMaterials: sources.dektonByMaterial.size,
    fabric: sources.fabricExcel.length,
  });

  const db = getDb();
  const rows = await db
    .select({
      global_sku: sku_mappings.global_sku,
      category: sku_mappings.category,
      original_name: sku_mappings.original_name,
      item_type: sku_mappings.item_type,
      version: sku_mappings.version,
      attributes: sku_mappings.attributes,
    })
    .from(sku_mappings);

  const stats: Stats = {
    examined: 0,
    updated: 0,
    skippedComplete: 0,
    skippedNoMatch: 0,
    skippedNoFill: 0,
  };

  for (const raw of rows) {
    stats.examined += 1;
    const mapping: MappingRow = {
      global_sku: raw.global_sku,
      category: raw.category,
      original_name: raw.original_name,
      version: raw.version,
      attributes:
        raw.attributes && typeof raw.attributes === "object"
          ? (raw.attributes as Record<string, unknown>)
          : {},
    };

    const missingBefore = listStillMissing(mapping.category, mapping.attributes);
    if (missingBefore.length === 0) {
      stats.skippedComplete += 1;
      continue;
    }

    const incoming = resolveIncomingAttributes(mapping, sources);
    if (!incoming) {
      stats.skippedNoMatch += 1;
      continue;
    }

    const merged = parseCategoryAttributes(
      mapping.category,
      mergeAttributesFillMissing(mapping.attributes, incoming),
    );

    if (JSON.stringify(merged) === JSON.stringify(mapping.attributes)) {
      stats.skippedNoFill += 1;
      continue;
    }

    const missingAfter = listStillMissing(mapping.category, merged);
    stats.updated += 1;

    if (DRY_RUN && stats.updated <= 15) {
      console.log(`[dry-run] ${mapping.global_sku}`, {
        category: mapping.category,
        missingBefore,
        missingAfter,
        patch: incoming,
      });
    }

    if (!DRY_RUN) {
      await db
        .update(sku_mappings)
        .set({
          attributes: merged,
          updated_by: UPDATED_BY,
          updated_at: new Date(),
        })
        .where(eq(sku_mappings.global_sku, mapping.global_sku));
    }
  }

  console.log("[backfill-attributes] complete", {
    dryRun: DRY_RUN,
    ...stats,
    categoriesTracked: Object.keys(CATEGORY_REQUIRED_ATTRIBUTES).length,
  });
}

main()
  .catch((error) => {
    console.error("[backfill-attributes] failed", error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
