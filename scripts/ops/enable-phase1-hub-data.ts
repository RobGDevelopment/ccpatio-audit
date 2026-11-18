/**
 * Chunk C (`hub-phase1-data`): additive Hub enablement for all 102 unique
 * Phase 1 SOW rows.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/enable-phase1-hub-data.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/enable-phase1-hub-data.ts --apply
 *
 * Writes reports under gitignored tmp/. Never POSTs/PUTs/PATCHes Katana.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  catalog_ship_profiles,
  ecommerce_listings,
  finished_goods_catalog,
  logistics_profiles,
  product_bom,
  sku_aliases,
  sku_mappings,
  third_party_sources,
} from "../../src/server/db/schema";
import { parseCsvLine } from "./lib/csv";
import { paginateKatana } from "./lib/katana-paginate";

loadEnvConfig(process.cwd());

const PHASE1_CSV = join(
  process.cwd(),
  "data_migration/Primeview/E-Commerce - Website Product Info - vividworks_phase1_products.csv",
);
const TMP = join(process.cwd(), "tmp");
const ACTOR = "hub-phase1-data";

export const PHASE1_FABRICS = [
  "FAB-ACT-ASH", "FAB-ACT-STO", "FAB-ADA-IND", "FAB-ADA-STO", "FAB-AGR-IND",
  "FAB-ARI-DEW", "FAB-ARR-CAR", "FAB-ARR-DUN", "FAB-ASC-SPA", "FAB-ASC-TRO",
  "FAB-ASS-SAN", "FAB-AUT-PEB", "FAB-BER-TUX", "FAB-BLE-IND", "FAB-BLE-LIN",
  "FAB-BLE-SAN", "FAB-BLI-ALO", "FAB-BLI-DEW", "FAB-BLI-GUA", "FAB-BLI-LIN",
  "FAB-BLI-SAN", "FAB-BEA-ULT", "FAB-ASS-IITEA", "FAB-ARR-CAL",
] as const;

export const PHASE1_POWDERS = [
  "PWD-BLACK", "PWD-BONE", "PWD-FANUC-GRAY", "PWD-LITE-BEIGE",
  "PWD-OIL-RUB-BRONZE", "PWD-WILD-RICE",
] as const;

export const PHASE1_FRAME_FINISHES = ["MET-STEEL", "MET-ALUM"] as const;

export const PHASE1_RESALE_SKUS = [
  "FIN-KIN-MIS",
  "FIN-TJM-MIS",
  "FIN-TJM-CHA",
  "FIN-TJM-TAB",
  "FIN-MLN-UMB",
  "FIN-CAN-UMB",
] as const;

/** Shared-canonical variation aliases (handoff §d + plan §1.E). */
export const PHASE1_SHARED_ALIASES: ReadonlyArray<{
  alias_sku: string;
  canonical_sku: string;
  reason: string;
}> = [
  { alias_sku: "FIN-BRV-DYB-84X84-RND", canonical_sku: "FIN-BRV-DYB-84X84", reason: "round vs square daybed" },
  { alias_sku: "FIN-BRV-RND-DYB-84", canonical_sku: "FIN-BRV-DYB-84X84", reason: "round daybed orientation alias" },
  { alias_sku: "FIN-BRV-MIN-LOV-48X34-ARMLESS", canonical_sku: "FIN-BRV-MIN-LOV-48X34", reason: "armless vs armed mini loveseat" },
  { alias_sku: "FIN-BRV-ARM-SOF-48X34", canonical_sku: "FIN-BRV-MIN-LOV-48X34", reason: "armless mini naming mismatch" },
  { alias_sku: "FIN-WFT-FLY-BST-18X18-BAR", canonical_sku: "FIN-WFT-FLY-BST-18X18", reason: "fly leg bar height" },
  { alias_sku: "FIN-WFT-FLY-BST-18X18-CNT", canonical_sku: "FIN-WFT-FLY-BST-18X18", reason: "fly leg counter height" },
  { alias_sku: "FIN-WFT-FLY-BST-17X21-BAR", canonical_sku: "FIN-WFT-FLY-BST-17X21", reason: "half-back bar height" },
  { alias_sku: "FIN-WFT-FLY-BST-17X21-CNT", canonical_sku: "FIN-WFT-FLY-BST-17X21", reason: "half-back counter height" },
  { alias_sku: "FIN-TAY-BST-19X23-BAR", canonical_sku: "FIN-TAY-BST-19X23", reason: "taylor bar height" },
  { alias_sku: "FIN-TAY-BST-19X23-CNT", canonical_sku: "FIN-TAY-BST-19X23", reason: "taylor counter height" },
  { alias_sku: "FIN-KIN-MIS-HEATER", canonical_sku: "FIN-KIN-MIS", reason: "kindle heater variation" },
  { alias_sku: "FIN-KIN-MIS-LAMP", canonical_sku: "FIN-KIN-MIS", reason: "kindle lamp variation" },
  { alias_sku: "FIN-TJM-CHA-FREELO", canonical_sku: "FIN-TJM-CHA", reason: "freelo chair variation" },
  { alias_sku: "FIN-TJM-CHA-MOON", canonical_sku: "FIN-TJM-CHA", reason: "moon chair variation" },
  { alias_sku: "FIN-TJM-MIS-LAYLO", canonical_sku: "FIN-TJM-MIS", reason: "laylo no risers" },
  { alias_sku: "FIN-TJM-MIS-LAYLO-NORISER", canonical_sku: "FIN-TJM-MIS", reason: "laylo no risers (plan spelling)" },
  { alias_sku: "FIN-TJM-MIS-LAYLO-4RISER", canonical_sku: "FIN-TJM-MIS", reason: "laylo 4in risers" },
  { alias_sku: "FIN-TJM-MIS-2SHAYZ", canonical_sku: "FIN-TJM-MIS", reason: "two shayz" },
  { alias_sku: "FIN-TJM-MIS-SHAYZ-5", canonical_sku: "FIN-TJM-MIS", reason: "two shayz 5in depth (plan spelling)" },
  { alias_sku: "FIN-TJM-MIS-2WOOSAH", canonical_sku: "FIN-TJM-MIS", reason: "two woosah" },
  { alias_sku: "FIN-TJM-MIS-WOOSAH", canonical_sku: "FIN-TJM-MIS", reason: "two woosah (plan spelling)" },
];

/** Orientation / size naming mismatches. */
export const PHASE1_ORIENTATION_ALIASES: ReadonlyArray<{
  alias_sku: string;
  canonical_sku: string;
  reason: string;
}> = [
  { alias_sku: "FIN-BRV-OTT-30X22", canonical_sku: "FIN-BRV-OTT-22X30", reason: "ottoman orientation swap" },
  { alias_sku: "FIN-OCN-OTT-22X30", canonical_sku: "FIN-OCN-OTT-30X22", reason: "ocean ottoman orientation swap" },
];

export const NEEDS_BOM_SKUS = [
  "FIN-MLN-SOF-72X36", "FIN-MLN-SOF-84X36", "FIN-MLN-SOF-96X36",
  "FIN-MLN-SOF-60X62", "FIN-MLN-SOF-62X42",
  "FIN-BRK-BAR-TAB-36X36", "FIN-BRK-BAR-TAB-42X42",
  "FIN-BRK-CNT-TAB-36X36", "FIN-BRK-CNT-TAB-42X42",
  "FIN-BRK-DIN-TAB-36X36", "FIN-BRK-DIN-TAB-42X42",
  "FIN-WFT-DIN-BCH-72X22", "FIN-WFT-DIN-BCH-96X22",
  "FIN-WFT-FLY-BST-18X18", "FIN-WFT-BCH-42X18", "FIN-WFT-DIN-CHA-18X18",
  "FIN-WFT-FLY-BST-17X21",
  "FIN-TAY-BST-19X23", "FIN-TAY-BST-24X23",
  "FIN-CAB-MIS-17X17", "FIN-CAB-MIS-23X23", "FIN-CAB-MIS-12X24",
] as const;

export const RESALE_VENDOR: Record<
  (typeof PHASE1_RESALE_SKUS)[number],
  { vendor_name: string; vendor_sku: string; wholesale_cost: string }
> = {
  "FIN-KIN-MIS": { vendor_name: "Kindle Living", vendor_sku: "ALLISON", wholesale_cost: "2500.0000" },
  "FIN-TJM-MIS": { vendor_name: "Tenjam", vendor_sku: "TJM-MIS", wholesale_cost: "200.0000" },
  "FIN-TJM-CHA": { vendor_name: "Tenjam", vendor_sku: "TJM-CHA", wholesale_cost: "180.0000" },
  "FIN-TJM-TAB": { vendor_name: "Tenjam Baja Furniture", vendor_sku: "RIPPLE", wholesale_cost: "232.5000" },
  "FIN-MLN-UMB": { vendor_name: "Scolaro", vendor_sku: "LIDO", wholesale_cost: "400.0000" },
  "FIN-CAN-UMB": { vendor_name: "FIM Shade Systems", vendor_sku: "CANTILEVER", wholesale_cost: "600.0000" },
};

/**
 * Canonical Hub SKUs for PrimeView ACF checkbox `"1"` / `"yes"` / `"true"` values.
 * Empty-BOM / SO-only add-ons also get `third_party_sources` so the Woo saga skips MO.
 */
export const PHASE1_ADDON_DEFAULTS: ReadonlyArray<{
  acfKey: string;
  sku: string;
  name: string;
  /** SO-only add-on (no factory MO). */
  tps: boolean;
  vendor_name: string;
  vendor_sku: string;
  wholesale_cost: string;
}> = [
  {
    acfKey: "ironwood",
    sku: "FIN-ESY-MIS-ADDIRONWOOD",
    name: "ADD IRONWOOD (2 ARMS)",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "ADDIRONWOOD",
    wholesale_cost: "100.0000",
  },
  {
    acfKey: "umbrella_cover",
    sku: "FIN-ESY-MIS-WEATHERPROOFCO",
    name: "WEATHERPROOF COVERS",
    tps: true,
    vendor_name: "CC Patio Cover Add-On",
    vendor_sku: "WEATHERPROOFCO",
    wholesale_cost: "50.0000",
  },
  {
    acfKey: "casters",
    sku: "FIN-ESY-CHS",
    name: "ADD-ON WHEELS FOR CHAISE LOUNGERS",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "CHS-WHEELS",
    wholesale_cost: "100.0000",
  },
  {
    acfKey: "wheels",
    sku: "FIN-ESY-CHS",
    name: "ADD-ON WHEELS FOR CHAISE LOUNGERS",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "CHS-WHEELS",
    wholesale_cost: "100.0000",
  },
  {
    acfKey: "fly_tables",
    sku: "FIN-OCN-TAB-34X12",
    name: "FLY TABLE 34X12",
    tps: false,
    vendor_name: "CC Patio Factory",
    vendor_sku: "FLY-34X12",
    wholesale_cost: "200.0000",
  },
  {
    acfKey: "fly_table",
    sku: "FIN-OCN-TAB-34X12",
    name: "FLY TABLE 34X12",
    tps: false,
    vendor_name: "CC Patio Factory",
    vendor_sku: "FLY-34X12",
    wholesale_cost: "200.0000",
  },
  {
    acfKey: "fly_table_13_x_30",
    sku: "FIN-OCN-TAB-13X30",
    name: "FLY TABLE 13X30",
    tps: false,
    vendor_name: "CC Patio Factory",
    vendor_sku: "FLY-13X30",
    wholesale_cost: "200.0000",
  },
  {
    acfKey: "fly_table_12_x_36_welded_on_back",
    sku: "FIN-ESY-MIS-FLYTBL-12X36-WLD",
    name: "FLY TABLE 12X36 WELDED ON BACK",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "FLYTBL-12X36-WLD",
    wholesale_cost: "250.0000",
  },
  {
    acfKey: "fly_table_12_x_48_welded_on_back",
    sku: "FIN-ESY-MIS-FLYTBL-12X48-WLD",
    name: "FLY TABLE 12X48 WELDED ON BACK",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "FLYTBL-12X48-WLD",
    wholesale_cost: "275.0000",
  },
  {
    acfKey: "arms",
    sku: "FIN-ESY-MIS-ARMS",
    name: "ADD METAL ARMS",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "ARMS",
    wholesale_cost: "150.0000",
  },
  {
    acfKey: "arms_8_thick_textile-wrapped",
    sku: "FIN-ESY-MIS-ARMS-8TEXTILE",
    name: "8IN TEXTILE-WRAPPED ARMS",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "ARMS-8TEXTILE",
    wholesale_cost: "200.0000",
  },
  {
    acfKey: "dekton_sidearm",
    sku: "FIN-ESY-MIS-DKT-SIDEARM",
    name: "DEKTON SIDEARM",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "DKT-SIDEARM",
    wholesale_cost: "350.0000",
  },
  {
    acfKey: "umbrella_holder",
    sku: "FIN-ESY-MIS-UMBHOLDER",
    name: "UMBRELLA HOLDER",
    tps: true,
    vendor_name: "CC Patio Factory Add-On",
    vendor_sku: "UMBHOLDER",
    wholesale_cost: "75.0000",
  },
  {
    acfKey: "coated_led_weight",
    sku: "FIN-TJM-MIS-ONECOATED",
    name: "ONE 4 LB. COATED LEAD WEIGHT",
    tps: true,
    vendor_name: "Tenjam",
    vendor_sku: "ONECOATED",
    wholesale_cost: "13.0700",
  },
  {
    acfKey: "pillow_for_loungers_w_pocket",
    sku: "FIN-TJM-MIS-PILLOWLOUNGERS",
    name: "PILLOW FOR LOUNGERS W/POCKET",
    tps: true,
    vendor_name: "Tenjam",
    vendor_sku: "PILLOWLOUNGERS",
    wholesale_cost: "13.0700",
  },
  {
    acfKey: "base_w_wheels",
    sku: "FIN-ESY-MIS-ZENBASE",
    name: "UMBRELLA BASE W/WHEELS",
    tps: true,
    vendor_name: "CC Patio Umbrella Base",
    vendor_sku: "ZENBASE",
    wholesale_cost: "100.0000",
  },
  {
    acfKey: "base_price",
    sku: "FIN-ESY-MIS-ZENBASE",
    name: "UMBRELLA BASE",
    tps: true,
    vendor_name: "CC Patio Umbrella Base",
    vendor_sku: "ZENBASE",
    wholesale_cost: "100.0000",
  },
];

export const PHASE1_ADDON_SKUS = [
  ...new Set(PHASE1_ADDON_DEFAULTS.map((a) => a.sku)),
] as const;

export type SowRow = {
  sowRow: number;
  name: string;
  sku: string;
  collection: string;
  length: string;
  depth: string;
  height: string;
  armHeight: string;
  sitHeight: string;
  baseWeight: string;
  msrp: string;
  options: string;
};

export function parseMoney(raw: string): string | null {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function normalizeDim(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Strip trailing inch marks / collection typos like "Bravada"
  const num = s.replace(/['"″''\s]/g, "");
  if (!num || !/^\d+(\.\d+)?$/.test(num)) return null;
  return String(Number(num));
}

/** SOW typo corrections applied when writing FGC dims. */
export function correctedDims(sku: string, row: SowRow): {
  length: string | null;
  depth: string | null;
  height: string | null;
  arm_height: string | null;
  sit_height: string | null;
} {
  let height = normalizeDim(row.height);
  let arm = normalizeDim(row.armHeight);
  if (sku === "FIN-OCN-TAB-34X12") {
    // SOW height "2''" is a typo — fly/side tables match 17" coffee-table family.
    height = "17";
  }
  if (sku === "FIN-BRV-SWG-72X12") {
    // SOW height "60''" is the hang height; arm "Bravada" is non-numeric.
    height = "60";
    arm = null;
  }
  return {
    length: normalizeDim(row.length) ?? null,
    depth: normalizeDim(row.depth) ?? null,
    height,
    arm_height: arm,
    sit_height: normalizeDim(row.sitHeight),
  };
}

export function loadPhase1SowRows(csvPath = PHASE1_CSV): SowRow[] {
  const raw = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const headers = parseCsvLine(lines[0]!);
  const rows: SowRow[] = [];
  const seen = new Set<string>();
  let sowRow = 0;
  for (const line of lines.slice(1)) {
    sowRow += 1;
    const cols = parseCsvLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cols[i] ?? "").trim();
    });
    const name = rec["SOW Product Name"] ?? "";
    const sku = rec["Canonical SKU"] ?? "";
    const msrp = rec["MSRP"] ?? "";
    const key = `${name}|${sku}|${msrp}`;
    if (seen.has(key)) continue; // drop exact duplicate row 10
    seen.add(key);
    rows.push({
      sowRow,
      name,
      sku,
      collection: rec["Collection"] ?? "",
      length: rec["Length"] ?? "",
      depth: rec["Depth"] ?? "",
      height: rec["Height"] ?? "",
      armHeight: rec["Arm Height"] ?? "",
      sitHeight: rec["Sit Height"] ?? "",
      baseWeight: rec["Base Weight"] ?? "",
      msrp,
      options: rec["Allowed Option Categories"] ?? "",
    });
  }
  return rows;
}

export function uniqueCanonicalSkus(rows: SowRow[]): string[] {
  return [...new Set(rows.map((r) => r.sku).filter(Boolean))];
}

export function makeAluAliases(skus: string[]): Array<{
  alias_sku: string;
  canonical_sku: string;
  reason: string;
}> {
  return skus
    .filter((s) => s.startsWith("FIN-") && !PHASE1_RESALE_SKUS.includes(s as (typeof PHASE1_RESALE_SKUS)[number]))
    .map((sku) => ({
      alias_sku: `${sku}-ALU`,
      canonical_sku: sku,
      reason: "aluminum frame variation",
    }));
}

export function scaleWeightFromSister(
  targetArea: number,
  sisterArea: number,
  sisterWeight: number,
): number {
  if (!(targetArea > 0) || !(sisterArea > 0) || !(sisterWeight > 0)) {
    throw new Error("scaleWeightFromSister requires positive areas and weight");
  }
  return Math.round((sisterWeight * (targetArea / sisterArea)) * 100) / 100;
}

export function parseArea(length: string | null, depth: string | null): number | null {
  const l = length ? Number(length) : NaN;
  const d = depth ? Number(depth) : NaN;
  if (!Number.isFinite(l) || !Number.isFinite(d) || l <= 0 || d <= 0) return null;
  return l * d;
}

type PlanAction =
  | { kind: "set_web_sellable"; sku: string }
  | { kind: "upsert_frame_finish"; sku: string; name: string }
  | { kind: "relink_variant"; sku: string; from: number | null; to: number }
  | { kind: "upsert_tps"; sku: string }
  | {
      kind: "upsert_addon_tps";
      sku: string;
      vendor_name: string;
      vendor_sku: string;
      wholesale_cost: string;
    }
  | { kind: "ensure_addon_active"; sku: string; name: string }
  | { kind: "upsert_alias"; alias_sku: string; canonical_sku: string; reason: string }
  | { kind: "set_sync_to_woo"; sku: string }
  | {
      kind: "upsert_fgc";
      sku: string;
      weight: string;
      msrp: string;
      dims: ReturnType<typeof correctedDims>;
    }
  | {
      kind: "upsert_listing";
      sku: string;
      product_name: string;
      steel_msrp: string;
      collection: string;
    };

function isApply(): boolean {
  return process.argv.includes("--apply");
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run") || !isApply();
}

async function fetchLiveVariantMap(): Promise<Map<string, number>> {
  const variants = await paginateKatana(
    "/variants?include_deleted=true",
    "variants",
  );
  const live = new Map<string, number>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = String(v.sku ?? "")
      .trim()
      .toUpperCase();
    if (!sku || live.has(sku)) continue;
    live.set(sku, Number(v.id));
  }
  return live;
}

async function loadBomTree(
  db: ReturnType<typeof getDb>,
  roots: string[],
): Promise<Record<string, Array<{ child: string; qty: string; uom: string; notes: string | null }>>> {
  const out: Record<
    string,
    Array<{ child: string; qty: string; uom: string; notes: string | null }>
  > = {};
  const queue = [...roots];
  const seen = new Set<string>();
  while (queue.length) {
    const batch = queue.splice(0, 50).filter((s) => !seen.has(s));
    if (!batch.length) continue;
    batch.forEach((s) => seen.add(s));
    const rows = await db
      .select()
      .from(product_bom)
      .where(inArray(product_bom.parent_sku, batch));
    for (const r of rows) {
      (out[r.parent_sku] ??= []).push({
        child: r.child_sku,
        qty: String(r.quantity),
        uom: r.unit_of_measure,
        notes: r.notes,
      });
      if (!seen.has(r.child_sku)) queue.push(r.child_sku);
    }
  }
  return out;
}

function pickWeight(opts: {
  sku: string;
  sowWeight: string;
  fgcWeight: string | null;
  shipWeight: string | null;
  logiWeight: string | null;
  dims: { length: string | null; depth: string | null };
  sisterWeights: Map<string, { weight: number; length: string | null; depth: string | null }>;
}): { weight: string; source: string } {
  const sow = opts.sowWeight.replace(/[,\s]/g, "").trim();
  if (sow && Number(sow) > 0) return { weight: Number(sow).toFixed(2), source: "sow" };
  if (opts.fgcWeight && Number(opts.fgcWeight) > 0) {
    return { weight: Number(opts.fgcWeight).toFixed(2), source: "fgc" };
  }
  if (opts.shipWeight && Number(opts.shipWeight) > 0) {
    return { weight: Number(opts.shipWeight).toFixed(2), source: "ship_profile" };
  }
  if (opts.logiWeight && Number(opts.logiWeight) > 0) {
    return { weight: Number(opts.logiWeight).toFixed(2), source: "logistics_profile" };
  }

  // Deterministic sister scaling by family prefix + area.
  const area = parseArea(opts.dims.length, opts.dims.depth);
  const family = opts.sku.split("-").slice(0, 3).join("-"); // FIN-BRV-COF etc rough
  let best: { sku: string; weight: number; area: number } | null = null;
  for (const [sisSku, sis] of opts.sisterWeights) {
    if (sisSku === opts.sku) continue;
    if (!sisSku.startsWith(family.slice(0, 7))) continue; // FIN-BRV / FIN-OCN…
    const sisArea = parseArea(sis.length, sis.depth);
    if (!sisArea || !area) continue;
    if (!best || Math.abs(sisArea - area) < Math.abs(best.area - area)) {
      best = { sku: sisSku, weight: sis.weight, area: sisArea };
    }
  }
  if (best && area) {
    const scaled = scaleWeightFromSister(area, best.area, best.weight);
    return { weight: scaled.toFixed(2), source: `scaled:${best.sku}` };
  }

  // Resale / accessory defaults (lbs) — deterministic placeholders until logistics filled.
  const defaults: Record<string, number> = {
    "FIN-KIN-MIS": 45,
    "FIN-TJM-MIS": 28,
    "FIN-TJM-CHA": 22,
    "FIN-TJM-TAB": 18,
    "FIN-MLN-UMB": 35,
    "FIN-CAN-UMB": 55,
    "FIN-CAB-MIS-17X17": 3.5,
    "FIN-CAB-MIS-23X23": 5.5,
    "FIN-CAB-MIS-12X24": 4.0,
    "FIN-WFT-FLY-BST-18X18": 28,
    "FIN-WFT-FLY-BST-17X21": 30,
    "FIN-WFT-DIN-CHA-18X18": 26,
    "FIN-WFT-BCH-42X18": 40,
    "FIN-WFT-DIN-BCH-72X22": 55,
    "FIN-WFT-DIN-BCH-96X22": 70,
    "FIN-TAY-BST-19X23": 32,
    "FIN-TAY-BST-24X23": 36,
    "FIN-TAY-DIN-CHA-24X23": 34,
    "FIN-BRV-DYB-72X72": 180,
    "FIN-BRV-DYB-84X72": 200,
    "FIN-BRV-DYB-84X84": 220,
    "FIN-OCN-SWV-CHA-34X38": 82,
    "FIN-OCN-MIN-LOV-48X38": 95,
    "FIN-OCN-SID-TAB-36X17": 55,
  };
  if (defaults[opts.sku]) {
    return { weight: defaults[opts.sku]!.toFixed(2), source: "deterministic_default" };
  }
  // Last resort: scale from any weighted sister with same collection token.
  for (const [sisSku, sis] of opts.sisterWeights) {
    if (sis.weight > 0) {
      return { weight: sis.weight.toFixed(2), source: `fallback_copy:${sisSku}` };
    }
  }
  return { weight: "25.00", source: "absolute_fallback" };
}

async function main() {
  const dryRun = isDryRun();
  mkdirSync(TMP, { recursive: true });
  console.log(dryRun ? "=== DRY-RUN ===" : "=== APPLY ===");

  const sow = loadPhase1SowRows();
  if (sow.length !== 102) {
    throw new Error(`Expected 102 unique Phase 1 rows, got ${sow.length}`);
  }
  const unique = uniqueCanonicalSkus(sow);
  const db = getDb();

  console.log("Fetching live Katana variants (read-only)...");
  const liveVariants = await fetchLiveVariantMap();

  const hubRows = await db
    .select({
      sku: sku_mappings.global_sku,
      sync: sku_mappings.sync_to_woo,
      vid: sku_mappings.katana_variant_id,
      attrs: sku_mappings.attributes,
      origin: sku_mappings.product_origin,
      itemType: sku_mappings.item_type,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      weight: finished_goods_catalog.weight,
      msrp: finished_goods_catalog.msrp,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      arm: finished_goods_catalog.arm_height,
      sit: finished_goods_catalog.sit_height,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    )
    .where(inArray(sku_mappings.global_sku, unique));

  const hubBySku = new Map(hubRows.map((h) => [h.sku, h]));

  const finishSkus = [
    ...PHASE1_FABRICS,
    ...PHASE1_POWDERS,
    ...PHASE1_FRAME_FINISHES,
  ];
  const finishRows = await db
    .select({
      sku: sku_mappings.global_sku,
      attrs: sku_mappings.attributes,
      name: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, finishSkus));
  const finishBySku = new Map(finishRows.map((f) => [f.sku, f]));

  const existingAliases = await db.select().from(sku_aliases);
  const aliasSet = new Set(existingAliases.map((a) => a.alias_sku));

  const existingTps = await db
    .select({ sku: third_party_sources.global_sku })
    .from(third_party_sources)
    .where(
      inArray(third_party_sources.global_sku, [
        ...PHASE1_RESALE_SKUS,
        ...PHASE1_ADDON_SKUS,
      ]),
    );
  const tpsSet = new Set(existingTps.map((t) => t.sku));

  const addonHubRows = await db
    .select({
      sku: sku_mappings.global_sku,
      isActive: sku_mappings.is_active,
      itemType: sku_mappings.item_type,
      name: sku_mappings.original_name,
      vid: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, [...PHASE1_ADDON_SKUS]));
  const addonBySku = new Map(addonHubRows.map((r) => [r.sku, r]));

  const listings = await db
    .select({
      id: ecommerce_listings.id,
      sku: ecommerce_listings.global_sku,
      name: ecommerce_listings.product_name,
      steel: ecommerce_listings.steel_msrp,
    })
    .from(ecommerce_listings)
    .where(inArray(ecommerce_listings.global_sku, unique));
  const listingsBySku = new Map<string, typeof listings>();
  for (const l of listings) {
    const arr = listingsBySku.get(l.sku) ?? [];
    arr.push(l);
    listingsBySku.set(l.sku, arr);
  }

  const ship = await db
    .select({
      sku: catalog_ship_profiles.global_sku,
      w: catalog_ship_profiles.weight_lb,
    })
    .from(catalog_ship_profiles)
    .where(inArray(catalog_ship_profiles.global_sku, unique));
  const shipBySku = new Map(ship.map((s) => [s.sku, s.w]));

  const logi = await db
    .select({
      sku: logistics_profiles.variant_sku,
      w: logistics_profiles.weight_lb,
    })
    .from(logistics_profiles)
    .where(inArray(logistics_profiles.variant_sku, unique));
  const logiBySku = new Map(logi.map((l) => [l.sku, l.w]));

  const sisterWeights = new Map<
    string,
    { weight: number; length: string | null; depth: string | null }
  >();
  for (const h of hubRows) {
    if (h.weight && Number(h.weight) > 0) {
      sisterWeights.set(h.sku, {
        weight: Number(h.weight),
        length: h.length,
        depth: h.depth,
      });
    }
  }
  for (const [sku, w] of shipBySku) {
    if (w && Number(w) > 0 && !sisterWeights.has(sku)) {
      const h = hubBySku.get(sku);
      sisterWeights.set(sku, {
        weight: Number(w),
        length: h?.length ?? null,
        depth: h?.depth ?? null,
      });
    }
  }
  for (const [sku, w] of logiBySku) {
    if (w && Number(w) > 0 && !sisterWeights.has(sku)) {
      const h = hubBySku.get(sku);
      sisterWeights.set(sku, {
        weight: Number(w),
        length: h?.length ?? null,
        depth: h?.depth ?? null,
      });
    }
  }

  const actions: PlanAction[] = [];

  // a) Katana variant relink
  for (const sku of unique) {
    const hub = hubBySku.get(sku);
    if (!hub) throw new Error(`Missing Hub sku_mappings row for ${sku}`);
    const liveId = liveVariants.get(sku);
    if (liveId && hub.vid !== liveId) {
      actions.push({
        kind: "relink_variant",
        sku,
        from: hub.vid,
        to: liveId,
      });
    }
  }

  // b) Web-sellable finishes
  for (const sku of [...PHASE1_FABRICS, ...PHASE1_POWDERS]) {
    const row = finishBySku.get(sku);
    if (!row) throw new Error(`Missing finish SKU ${sku}`);
    const ws = (row.attrs as Record<string, unknown> | null)?.web_sellable;
    if (ws !== true) actions.push({ kind: "set_web_sellable", sku });
  }
  for (const sku of PHASE1_FRAME_FINISHES) {
    const name = sku === "MET-STEEL" ? "Steel Frame" : "Aluminum Frame";
    actions.push({ kind: "upsert_frame_finish", sku, name });
  }

  // c) Resale TPS
  for (const sku of PHASE1_RESALE_SKUS) {
    if (!hubBySku.has(sku) && !unique.includes(sku)) {
      throw new Error(`Resale SKU ${sku} not in Phase 1 set`);
    }
    actions.push({ kind: "upsert_tps", sku });
  }

  // c2) ACF checkbox default add-on SKUs (activate + SO-only TPS where needed)
  for (const addon of PHASE1_ADDON_DEFAULTS) {
    const hub = addonBySku.get(addon.sku);
    if (!hub) {
      throw new Error(
        `Missing Hub sku_mappings for ACF default add-on ${addon.acfKey}=${addon.sku}`,
      );
    }
    actions.push({ kind: "ensure_addon_active", sku: addon.sku, name: addon.name });
    if (addon.tps) {
      actions.push({
        kind: "upsert_addon_tps",
        sku: addon.sku,
        vendor_name: addon.vendor_name,
        vendor_sku: addon.vendor_sku,
        wholesale_cost: addon.wholesale_cost,
      });
    }
  }

  // d) Aliases
  const makeSkus = unique.filter(
    (s) => !PHASE1_RESALE_SKUS.includes(s as (typeof PHASE1_RESALE_SKUS)[number]),
  );
  const allAliases = [
    ...PHASE1_SHARED_ALIASES,
    ...PHASE1_ORIENTATION_ALIASES,
    ...makeAluAliases(makeSkus),
    // Corner sofa / chaise default facing
    ...makeSkus
      .filter((s) => /FIN-BRV-COR-(SOF|CHS)-/.test(s) || /FIN-OCN-COR-/.test(s))
      .map((s) => ({
        alias_sku: `${s}-LS`,
        canonical_sku: s,
        reason: "default left-facing corner orientation",
      })),
  ];
  // Ocean coffee table size naming already canonical; ensure ALU covered above.
  for (const a of allAliases) {
    if (!unique.includes(a.canonical_sku) && !hubBySku.has(a.canonical_sku)) {
      // orientation aliases may point at phase1 skus already in hub
      const hub = await db
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, a.canonical_sku))
        .limit(1);
      if (!hub.length) {
        console.warn(`skip alias ${a.alias_sku}: canonical ${a.canonical_sku} missing`);
        continue;
      }
    }
    actions.push({
      kind: "upsert_alias",
      alias_sku: a.alias_sku,
      canonical_sku: a.canonical_sku,
      reason: a.reason,
    });
  }

  // e) Commercial completeness
  const sowBySku = new Map<string, SowRow>();
  for (const r of sow) {
    if (!sowBySku.has(r.sku)) sowBySku.set(r.sku, r);
  }

  for (const sku of unique) {
    const hub = hubBySku.get(sku)!;
    const row = sowBySku.get(sku)!;
    const dims = correctedDims(sku, row);
    // Prefer existing FGC dims when SOW blank
    const mergedDims = {
      length: dims.length ?? normalizeDim(hub.length),
      depth: dims.depth ?? normalizeDim(hub.depth),
      height: dims.height ?? normalizeDim(hub.height),
      arm_height: dims.arm_height ?? normalizeDim(hub.arm),
      sit_height: dims.sit_height ?? normalizeDim(hub.sit),
    };
    const picked = pickWeight({
      sku,
      sowWeight: row.baseWeight,
      fgcWeight: hub.weight,
      shipWeight: shipBySku.get(sku) ?? null,
      logiWeight: logiBySku.get(sku) ?? null,
      dims: mergedDims,
      sisterWeights,
    });
    const msrp = parseMoney(row.msrp) ?? (hub.msrp ? Number(hub.msrp).toFixed(2) : null);
    if (!msrp) throw new Error(`No MSRP for ${sku}`);
    actions.push({
      kind: "upsert_fgc",
      sku,
      weight: picked.weight,
      msrp,
      dims: mergedDims,
    });
    if (!hub.sync) actions.push({ kind: "set_sync_to_woo", sku });

    const existing = listingsBySku.get(sku) ?? [];
    if (existing.length === 0) {
      actions.push({
        kind: "upsert_listing",
        sku,
        product_name: row.name,
        steel_msrp: msrp,
        collection: row.collection || "Phase1",
      });
    } else {
      // Update steel_msrp on first listing if blank/mismatched
      actions.push({
        kind: "upsert_listing",
        sku,
        product_name: existing[0]!.name,
        steel_msrp: msrp,
        collection: row.collection || "Phase1",
      });
    }
  }

  // ---- Apply or report ----
  const report = {
    mode: dryRun ? "dry-run" : "apply",
    sowRows: sow.length,
    uniqueSkus: unique.length,
    actionCounts: {} as Record<string, number>,
    actions,
    weightSources: {} as Record<string, string>,
  };
  for (const a of actions) {
    report.actionCounts[a.kind] = (report.actionCounts[a.kind] ?? 0) + 1;
  }
  for (const a of actions) {
    if (a.kind === "upsert_fgc") {
      // recompute source label for report
      const row = sowBySku.get(a.sku)!;
      const hub = hubBySku.get(a.sku)!;
      const picked = pickWeight({
        sku: a.sku,
        sowWeight: row.baseWeight,
        fgcWeight: hub.weight,
        shipWeight: shipBySku.get(a.sku) ?? null,
        logiWeight: logiBySku.get(a.sku) ?? null,
        dims: a.dims,
        sisterWeights,
      });
      report.weightSources[a.sku] = picked.source;
    }
  }

  if (!dryRun) {
    await db.transaction(async (tx) => {
      for (const a of actions) {
        if (a.kind === "relink_variant") {
          await tx
            .update(sku_mappings)
            .set({
              katana_variant_id: a.to,
              updated_by: ACTOR,
              updated_at: new Date(),
            })
            .where(eq(sku_mappings.global_sku, a.sku));
        } else if (a.kind === "set_web_sellable") {
          const row = finishBySku.get(a.sku)!;
          const attrs = {
            ...((row.attrs as Record<string, unknown>) ?? {}),
            web_sellable: true,
          };
          await tx
            .update(sku_mappings)
            .set({
              attributes: attrs,
              updated_by: ACTOR,
              updated_at: new Date(),
            })
            .where(eq(sku_mappings.global_sku, a.sku));
        } else if (a.kind === "upsert_frame_finish") {
          const existing = finishBySku.get(a.sku);
          if (!existing) {
            await tx.insert(sku_mappings).values({
              global_sku: a.sku,
              product_origin: null,
              category: "Frame Finish",
              item_type: "raw_material",
              original_name: a.name,
              source_file: ACTOR,
              is_active: true,
              sync_to_woo: false,
              attributes: { web_sellable: true },
              updated_by: ACTOR,
            });
          } else {
            const attrs = {
              ...((existing.attrs as Record<string, unknown>) ?? {}),
              web_sellable: true,
            };
            await tx
              .update(sku_mappings)
              .set({
                attributes: attrs,
                item_type: "raw_material",
                original_name: existing.name || a.name,
                updated_by: ACTOR,
                updated_at: new Date(),
              })
              .where(eq(sku_mappings.global_sku, a.sku));
          }
        } else if (a.kind === "upsert_tps") {
          const meta = RESALE_VENDOR[a.sku as (typeof PHASE1_RESALE_SKUS)[number]];
          // Keep product_origin manufactured/null for FIN-* (origin_check).
          // Only upsert third_party_sources for MO bypass.
          if (tpsSet.has(a.sku)) {
            await tx
              .update(third_party_sources)
              .set({
                vendor_name: meta.vendor_name,
                vendor_sku: meta.vendor_sku,
                wholesale_cost: meta.wholesale_cost,
                updated_at: new Date(),
              })
              .where(eq(third_party_sources.global_sku, a.sku));
          } else {
            await tx.insert(third_party_sources).values({
              global_sku: a.sku,
              vendor_name: meta.vendor_name,
              vendor_sku: meta.vendor_sku,
              wholesale_cost: meta.wholesale_cost,
            });
            tpsSet.add(a.sku);
          }
        } else if (a.kind === "upsert_addon_tps") {
          if (tpsSet.has(a.sku)) {
            await tx
              .update(third_party_sources)
              .set({
                vendor_name: a.vendor_name,
                vendor_sku: a.vendor_sku,
                wholesale_cost: a.wholesale_cost,
                updated_at: new Date(),
              })
              .where(eq(third_party_sources.global_sku, a.sku));
          } else {
            await tx.insert(third_party_sources).values({
              global_sku: a.sku,
              vendor_name: a.vendor_name,
              vendor_sku: a.vendor_sku,
              wholesale_cost: a.wholesale_cost,
            });
            tpsSet.add(a.sku);
          }
        } else if (a.kind === "ensure_addon_active") {
          await tx
            .update(sku_mappings)
            .set({
              is_active: true,
              item_type: "finished_good",
              original_name: a.name,
              updated_by: ACTOR,
              updated_at: new Date(),
            })
            .where(eq(sku_mappings.global_sku, a.sku));
          const fgcExists = await tx
            .select({ sku: finished_goods_catalog.global_sku })
            .from(finished_goods_catalog)
            .where(eq(finished_goods_catalog.global_sku, a.sku))
            .limit(1);
          if (!fgcExists.length) {
            await tx.insert(finished_goods_catalog).values({
              global_sku: a.sku,
              updated_by: ACTOR,
            });
          }
        } else if (a.kind === "upsert_alias") {
          if (aliasSet.has(a.alias_sku)) {
            await tx
              .update(sku_aliases)
              .set({
                canonical_sku: a.canonical_sku,
                reason: a.reason,
              })
              .where(eq(sku_aliases.alias_sku, a.alias_sku));
          } else {
            await tx.insert(sku_aliases).values({
              alias_sku: a.alias_sku,
              canonical_sku: a.canonical_sku,
              reason: a.reason,
            });
            aliasSet.add(a.alias_sku);
          }
        } else if (a.kind === "set_sync_to_woo") {
          await tx
            .update(sku_mappings)
            .set({
              sync_to_woo: true,
              updated_by: ACTOR,
              updated_at: new Date(),
            })
            .where(eq(sku_mappings.global_sku, a.sku));
        } else if (a.kind === "upsert_fgc") {
          const payload = {
            msrp: a.msrp,
            weight: a.weight,
            length: a.dims.length,
            depth: a.dims.depth,
            height: a.dims.height,
            arm_height: a.dims.arm_height,
            sit_height: a.dims.sit_height,
            updated_by: ACTOR,
            updated_at: new Date(),
          };
          const fgcExists = await tx
            .select({ sku: finished_goods_catalog.global_sku })
            .from(finished_goods_catalog)
            .where(eq(finished_goods_catalog.global_sku, a.sku))
            .limit(1);
          if (fgcExists.length) {
            await tx
              .update(finished_goods_catalog)
              .set(payload)
              .where(eq(finished_goods_catalog.global_sku, a.sku));
          } else {
            await tx.insert(finished_goods_catalog).values({
              global_sku: a.sku,
              ...payload,
            });
          }
        } else if (a.kind === "upsert_listing") {
          const existing = listingsBySku.get(a.sku) ?? [];
          if (existing.length === 0) {
            const [{ top }] = await tx
              .select({
                top: sql<number>`coalesce(max(${ecommerce_listings.sheet_order}), 0)`,
              })
              .from(ecommerce_listings);
            // product_name is unique — suffix SKU when the SOW name already exists.
            const nameTaken = await tx
              .select({ name: ecommerce_listings.product_name })
              .from(ecommerce_listings)
              .where(eq(ecommerce_listings.product_name, a.product_name))
              .limit(1);
            const productName = nameTaken.length
              ? `${a.product_name} [${a.sku}]`
              : a.product_name;
            const [inserted] = await tx
              .insert(ecommerce_listings)
              .values({
                global_sku: a.sku,
                product_name: productName,
                steel_msrp: a.steel_msrp,
                drawing_section: "Phase1",
                collection_label: a.collection,
                sheet_order: Number(top) + 1,
                url_source: "missing",
              })
              .returning({
                id: ecommerce_listings.id,
                sku: ecommerce_listings.global_sku,
                name: ecommerce_listings.product_name,
                steel: ecommerce_listings.steel_msrp,
              });
            listingsBySku.set(a.sku, [inserted!]);
          } else {
            await tx
              .update(ecommerce_listings)
              .set({
                steel_msrp: a.steel_msrp,
                updated_at: new Date(),
              })
              .where(eq(ecommerce_listings.id, existing[0]!.id));
          }
        }
      }
    });
  }

  writeFileSync(
    join(TMP, "phase1-hub-enable-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("actionCounts", report.actionCounts);
  console.log("wrote tmp/phase1-hub-enable-report.json");

  // ---- BOM restore blueprint (read-only) ----
  const templates = [
    "FIN-MLN-CLB-CHA-32X36",
    "FIN-MLN-OTT-22X60",
    "FIN-MLN-OTT-22X72",
    "FIN-MLN-OTT-34X60",
    "FIN-MLN-OTT-56X42",
    "FIN-WFT-FLY-BST-18X18",
    "FIN-TAY-DIN-CHA-24X23",
    "FIN-BRK-SGL-CHS-38X79",
    "FIN-BRK-DOU-CHS-58X79",
    "FIN-CAB-MIS-10X10",
    "FIN-BRV-COF-TAB-36X36",
  ];
  const templateTrees = await loadBomTree(db, templates);

  const needsBomPlan: {
    generatedAt: string;
    note: string;
    targetCount: number;
    targets: Array<{
      sku: string;
      group: string;
      templateSku: string;
      approach: string;
      componentRows: Array<{
        parent: string;
        child: string;
        qty: string;
        uom: string;
        notes: string | null;
        level: number;
      }>;
    }>;
    templates: typeof templateTrees;
  } = {
    generatedAt: new Date().toISOString(),
    note: "Dry-run blueprint for Chunk C2 (phase1-katana-bom-restore). No Katana writes in Chunk C.",
    targetCount: 0,
    targets: [],
    templates: templateTrees,
  };

  const groupOf = (sku: string): { group: string; template: string; approach: string } => {
    if (sku.startsWith("FIN-MLN-SOF-")) {
      return {
        group: "Milan Sofas",
        template: "FIN-MLN-CLB-CHA-32X36",
        approach: "Clone/scale modular FRAME+CUSH tree from Milan club chair / ottoman sisters",
      };
    }
    if (sku.startsWith("FIN-BRK-") && sku.includes("-TAB-")) {
      return {
        group: "Star Leg Tables",
        template: "FIN-BRV-COF-TAB-36X36",
        approach: "FRM-BRK-* base + DKT / RM-DKT-GENERIC-SLAB scaled from coffee-table modular pattern",
      };
    }
    if (sku.startsWith("FIN-WFT-DIN-BCH-")) {
      return {
        group: "Dining Benches",
        template: "FIN-WFT-FLY-BST-18X18",
        approach: "Clone/scale Waterfall bench FRAME+CUSH from fly-leg seating family",
      };
    }
    if (sku === "FIN-WFT-FLY-BST-18X18" || sku === "FIN-WFT-FLY-BST-17X21") {
      return {
        group: sku.includes("17X21") ? "Half Back Barstools" : "Fly Leg Barstools",
        template: "FIN-WFT-FLY-BST-18X18",
        approach: "Clone/scale live FIN-WFT-FLY-BST-18X18 FRAME+CUSH (height band via -BAR/-CNT aliases)",
      };
    }
    if (sku === "FIN-WFT-BCH-42X18" || sku === "FIN-WFT-DIN-CHA-18X18") {
      return {
        group: sku.includes("CHA") ? "Fly Leg Chair" : "Fly Leg Bench",
        template: "FIN-WFT-FLY-BST-18X18",
        approach: "Clone/scale from FIN-WFT-FLY-BST-18X18 family",
      };
    }
    if (sku.startsWith("FIN-TAY-BST-")) {
      return {
        group: "Taylor Barstools",
        template: "FIN-TAY-DIN-CHA-24X23",
        approach: "Clone/scale from live FIN-TAY-DIN-CHA-24X23 FRAME+CUSH",
      };
    }
    if (sku.startsWith("FIN-CAB-MIS-")) {
      return {
        group: "Cabana Pillows",
        template: "FIN-CAB-MIS-10X10",
        approach: "RM-FAB-GENERIC + insert/dacron from FIN-CAB-MIS-10X10 pillow template (replace archetype frame noise)",
      };
    }
    return {
      group: "Unknown",
      template: "FIN-MLN-CLB-CHA-32X36",
      approach: "manual review",
    };
  };

  const flattenTree = (
    root: string,
    trees: typeof templateTrees,
    level = 0,
    acc: Array<{
      parent: string;
      child: string;
      qty: string;
      uom: string;
      notes: string | null;
      level: number;
    }> = [],
  ) => {
    for (const line of trees[root] ?? []) {
      acc.push({
        parent: root,
        child: line.child,
        qty: line.qty,
        uom: line.uom,
        notes: line.notes,
        level,
      });
      flattenTree(line.child, trees, level + 1, acc);
    }
    return acc;
  };

  // All 25 NEEDS_BOM SOW rows (shared canonicals appear once per variation).
  const needsBomSowRows: Array<{
    sku: string;
    variation: string;
    wooAlias: string | null;
  }> = [
    { sku: "FIN-MLN-SOF-72X36", variation: "one-sided-72", wooAlias: null },
    { sku: "FIN-MLN-SOF-84X36", variation: "one-sided-84", wooAlias: null },
    { sku: "FIN-MLN-SOF-96X36", variation: "one-sided-96", wooAlias: null },
    { sku: "FIN-MLN-SOF-60X62", variation: "double-sided-60x62", wooAlias: null },
    { sku: "FIN-MLN-SOF-62X42", variation: "t-shaped-62x42", wooAlias: null },
    { sku: "FIN-BRK-BAR-TAB-36X36", variation: "star-bar-36", wooAlias: null },
    { sku: "FIN-BRK-BAR-TAB-42X42", variation: "star-bar-42", wooAlias: null },
    { sku: "FIN-BRK-CNT-TAB-36X36", variation: "star-counter-36", wooAlias: null },
    { sku: "FIN-BRK-CNT-TAB-42X42", variation: "star-counter-42", wooAlias: null },
    { sku: "FIN-BRK-DIN-TAB-36X36", variation: "star-dining-36", wooAlias: null },
    { sku: "FIN-BRK-DIN-TAB-42X42", variation: "star-dining-42", wooAlias: null },
    { sku: "FIN-WFT-DIN-BCH-72X22", variation: "dining-bench-72", wooAlias: null },
    { sku: "FIN-WFT-DIN-BCH-96X22", variation: "dining-bench-96", wooAlias: null },
    { sku: "FIN-WFT-FLY-BST-18X18", variation: "fly-bar", wooAlias: "FIN-WFT-FLY-BST-18X18-BAR" },
    { sku: "FIN-WFT-FLY-BST-18X18", variation: "fly-counter", wooAlias: "FIN-WFT-FLY-BST-18X18-CNT" },
    { sku: "FIN-WFT-BCH-42X18", variation: "fly-bench", wooAlias: null },
    { sku: "FIN-WFT-DIN-CHA-18X18", variation: "fly-chair", wooAlias: null },
    { sku: "FIN-WFT-FLY-BST-17X21", variation: "halfback-bar", wooAlias: "FIN-WFT-FLY-BST-17X21-BAR" },
    { sku: "FIN-WFT-FLY-BST-17X21", variation: "halfback-counter", wooAlias: "FIN-WFT-FLY-BST-17X21-CNT" },
    { sku: "FIN-TAY-BST-19X23", variation: "taylor-bar", wooAlias: "FIN-TAY-BST-19X23-BAR" },
    { sku: "FIN-TAY-BST-19X23", variation: "taylor-counter", wooAlias: "FIN-TAY-BST-19X23-CNT" },
    { sku: "FIN-TAY-BST-24X23", variation: "taylor-arms-bar", wooAlias: null },
    { sku: "FIN-CAB-MIS-17X17", variation: "pillow-17", wooAlias: null },
    { sku: "FIN-CAB-MIS-23X23", variation: "pillow-23", wooAlias: null },
    { sku: "FIN-CAB-MIS-12X24", variation: "pillow-lumbar-12x24", wooAlias: null },
  ];

  if (needsBomSowRows.length !== 25) {
    throw new Error(`NEEDS_BOM plan must list 25 SOW rows, got ${needsBomSowRows.length}`);
  }

  for (const target of needsBomSowRows) {
    const meta = groupOf(target.sku);
    const componentRows = flattenTree(meta.template, templateTrees);
    needsBomPlan.targets.push({
      sku: target.sku,
      group: meta.group,
      templateSku: meta.template,
      approach: `${meta.approach}${target.wooAlias ? `; Woo alias ${target.wooAlias}` : ""}`,
      componentRows: componentRows.map(({ parent, child, qty, uom, notes, level }) => ({
        parent,
        child,
        qty,
        uom,
        notes,
        level,
      })),
    });
  }

  needsBomPlan.targetCount = needsBomPlan.targets.length;
  writeFileSync(
    join(TMP, "phase1-25-bom-restore-plan.json"),
    JSON.stringify(needsBomPlan, null, 2),
  );
  console.log(
    `wrote tmp/phase1-25-bom-restore-plan.json (${needsBomPlan.targets.length} targets)`,
  );

  await closeDb();
  console.log(dryRun ? "Dry-run complete (no Hub writes)." : "Apply complete.");
}

const isMain =
  process.argv[1]?.includes("enable-phase1-hub-data") ||
  process.argv[1]?.endsWith("enable-phase1-hub-data.ts");

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
