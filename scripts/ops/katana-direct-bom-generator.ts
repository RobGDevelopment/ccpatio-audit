/**
 * Phase 2 — Universal Level 1 link (FIN → monolithic FRAME / CUSH / DKT).
 *
 * SSOT for which SKUs exist: live Katana GET /variants. Local Postgres is
 * never queried.
 *
 * Every live FIN-* product is fanned out onto the monolithic targets using
 * parseFinTwinParts as the identity key:
 *   - color codes (BE/WH/GR/…) and Ocean Y|N flags are stripped
 *   - handedness (LS / RS / LAF / RAF) is KEPT
 *   - club chairs / swivels with no WxD default to 34X34 (Ocean 34X38)
 *
 * Output rules (qty always 1):
 *   seating FIN → 1 FRAME + 1 CUSH
 *   table FIN   → 1 FRAME (+ Dekton slab when applicable)
 *
 * The plan is then diffed against live /bom_rows. Katana's recipe importer
 * APPENDS, so edges already on the parent are dropped (they would duplicate)
 * and legacy ingredients the new tree replaces are written to a purge file.
 *
 * Outputs:
 *   docs/Katana Downloads/5-Add-Universal-Level1.csv     (safe to add)
 *   docs/Katana Downloads/5a-Purge-Conflicting-Level1.csv (qty 0, import first)
 * Headers: Product variant code / SKU, Ingredient variant code / SKU, Quantity
 *
 *   npm run ops:katana-direct-bom-generator
 *   npm run ops:katana-direct-bom-generator -- --limit=25
 *   npm run ops:katana-direct-bom-generator -- --skip-bom-check
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseFinTwinParts } from "../../src/lib/katana-fin-bom";
import {
  classifyFinFamily,
  identityStemCandidates,
  indexLiveMonolithicTwins,
  planUniversalLevel1Import,
  resolveUniversalLevel1,
  type MonolithicLevel1Edge,
} from "../../src/lib/monolithic-builds";
import { toKatanaCsv } from "../../src/lib/katana-bom-csv";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const limit = parseLimit();
const skipBomCheck = hasFlag("--skip-bom-check");
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const DOWNLOADS = join(process.cwd(), "docs", "Katana Downloads");
const OUT_CSV = join(DOWNLOADS, "5-Add-Universal-Level1.csv");
const PURGE_CSV = join(DOWNLOADS, "5a-Purge-Conflicting-Level1.csv");

/** Strict three-column Katana recipe import headers (user lock). */
const HEADERS = [
  "Product variant code / SKU",
  "Ingredient variant code / SKU",
  "Quantity",
] as const;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function csvLine(cells: Array<string | number>): string {
  return cells
    .map((c) => `"${String(c).replace(/"/g, '""')}"`)
    .join(",");
}

async function paginate(
  path: string,
  label: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${path}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<Record<string, unknown>>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for ${path} (${all.length} rows).`,
  );
}

async function fetchAllVariants(): Promise<KatanaVariant[]> {
  return (await paginate(
    "/variants?include_deleted=false",
    "variants",
  )) as unknown as KatanaVariant[];
}

/** parent SKU → live ingredient SKUs, from /bom_rows plus /recipes. */
async function fetchLiveBom(
  skuByVariant: ReadonlyMap<number, string>,
): Promise<Map<string, Set<string>>> {
  const live = new Map<string, Set<string>>();
  const ingest = (row: Record<string, unknown>) => {
    const parent =
      typeof row.product_sku === "string"
        ? normalizeSku(row.product_sku)
        : skuByVariant.get(Number(row.product_variant_id)) ?? "";
    const ingredient =
      typeof row.ingredient_sku === "string"
        ? normalizeSku(row.ingredient_sku)
        : skuByVariant.get(Number(row.ingredient_variant_id)) ?? "";
    if (!parent || !ingredient) return;
    if (!live.has(parent)) live.set(parent, new Set());
    live.get(parent)!.add(ingredient);
  };

  for (const row of await paginate("/bom_rows", "bom_rows")) ingest(row);
  await delay(REQUEST_DELAY_MS);
  try {
    for (const row of await paginate("/recipes", "recipes")) ingest(row);
  } catch (err) {
    console.warn(
      `  /recipes unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return live;
}

async function main(): Promise<void> {
  console.log("Phase 2 — Universal Level 1 (FIN → FRAME / CUSH / DKT)");
  console.log("  SSOT: live Katana /variants (NO Postgres)");
  console.log("  identity: parseFinTwinParts — strip color + Ocean Y/N, KEEP LS/RS/LAF/RAF");
  console.log("  dimless club/swivel default: 34X34 (Ocean 34X38)");
  console.log("  seating → FRAME + CUSH   |   table → FRAME (+ Dekton)");
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariant[];
  try {
    variants = await fetchAllVariants();
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const liveSkus = new Set<string>();
  const skuByVariant = new Map<number, string>();
  const finSkus: string[] = [];
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    liveSkus.add(sku);
    skuByVariant.set(Number(v.id), sku);
    // FIN recipes attach to products — require product_id when present
    const productId = v.product_id != null ? Number(v.product_id) : NaN;
    if (sku.startsWith("FIN-") && Number.isFinite(productId)) {
      if (!finSkus.includes(sku)) finSkus.push(sku);
    }
  }
  finSkus.sort();

  const twins = indexLiveMonolithicTwins(liveSkus);
  const twinCounts = { FRAME: 0, CUSH: 0, DKT: 0 };
  for (const t of twins) twinCounts[t.role] += 1;

  console.log(`  live SKUs: ${liveSkus.size}`);
  console.log(`  live FIN-* products: ${finSkus.length}`);
  console.log(
    `  live monolithic targets: ${twins.length} (FRAME ${twinCounts.FRAME} / CUSH ${twinCounts.CUSH} / DKT ${twinCounts.DKT})`,
  );
  console.log("");
  console.log("→ Fanning out FIN identities");

  const planRows: string[] = [
    "fin_sku,identity_stem,family,ingredient_sku,role,quantity,status",
  ];
  const unmatchedRows: Array<Array<string>> = [];
  const unmatchedHeaders = [
    "FIN SKU",
    "Identity stem",
    "Family",
    "Missing roles",
  ] as const;

  let processed = 0;
  let finsFull = 0;
  let finsUnmatched = 0;
  let finsSkipped = 0;
  const roleCounts = { FRAME: 0, CUSH: 0, DKT: 0 };
  const resolved: MonolithicLevel1Edge[] = [];
  const familyBySku = new Map<string, string>();
  const stemBySku = new Map<string, string>();

  for (const fin of finSkus) {
    if (limit != null && processed >= limit) break;
    processed += 1;

    const parsed = parseFinTwinParts(fin);
    const family = parsed ? classifyFinFamily(parsed) : "skip";
    const stem = identityStemCandidates(fin)[0] ?? "";
    familyBySku.set(fin, family);
    stemBySku.set(fin, stem);

    if (!parsed || family === "skip") {
      finsSkipped += 1;
      planRows.push(csvLine([fin, stem, family, "", "", "", "not_a_bom_family"]));
      continue;
    }

    const edges = resolveUniversalLevel1(fin, liveSkus, twins);
    if (edges.length === 0) {
      finsUnmatched += 1;
      unmatchedRows.push([
        fin,
        stem,
        family,
        family === "table" ? "FRAME" : "FRAME+CUSH",
      ]);
      planRows.push(csvLine([fin, stem, family, "", "", "", "no_live_target"]));
      continue;
    }

    finsFull += 1;
    resolved.push(...edges);
    for (const edge of edges) roleCounts[edge.role] += 1;
    console.log(
      `  ${family.padEnd(7)} ${fin}  →  ${edges
        .map((e) => `${e.role}:${e.ingredientSku}`)
        .join("  +  ")}`,
    );
  }

  console.log("");
  let liveBom = new Map<string, Set<string>>();
  if (skipBomCheck) {
    console.log("→ Skipping live BOM diff (--skip-bom-check)");
  } else {
    console.log("→ Diffing plan against live /bom_rows (importer APPENDS)");
    await delay(REQUEST_DELAY_MS);
    liveBom = await fetchLiveBom(skuByVariant);
  }

  const importPlan = planUniversalLevel1Import(resolved, liveBom);
  for (const row of importPlan.audit) {
    planRows.push(
      csvLine([
        row.productSku,
        stemBySku.get(row.productSku) ?? "",
        familyBySku.get(row.productSku) ?? "",
        row.ingredientSku,
        row.role,
        row.quantity,
        row.verdict,
      ]),
    );
  }

  const matrix: Array<Array<string | number>> = [
    [...HEADERS],
    ...importPlan.addRows.map((r) => [r.productSku, r.ingredientSku, r.quantity]),
  ];
  const purgeMatrix: Array<Array<string | number>> = [
    [...HEADERS],
    ...importPlan.purgeRows.map((r) => [r.parentSku, r.ingredientSku, 0]),
  ];

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, toKatanaCsv(matrix), "utf8");
  writeFileSync(PURGE_CSV, toKatanaCsv(purgeMatrix), "utf8");

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const runStamp = stamp();
  const unmatchedPath = join(tmpDir, `universal-level1-unmatched-${runStamp}.csv`);
  const planPath = join(tmpDir, `universal-level1-plan-${runStamp}.csv`);
  writeFileSync(
    unmatchedPath,
    toKatanaCsv([[...unmatchedHeaders], ...unmatchedRows]),
    "utf8",
  );
  writeFileSync(planPath, `${planRows.join("\r\n")}\r\n`, "utf8");

  const addParents = new Set(importPlan.addRows.map((r) => r.productSku));
  const purgeParents = new Set(importPlan.purgeRows.map((r) => r.parentSku));
  const uniqueIngredients = new Set(importPlan.addRows.map((r) => r.ingredientSku));
  const alreadyLive = importPlan.audit.filter((r) => r.verdict === "already_live");

  console.log("");
  console.log("Summary — identity fan-out");
  console.log(`  FIN products scanned: ${processed}`);
  console.log(`  FIN mapped to live targets: ${finsFull}`);
  console.log(`  FIN with no live target: ${finsUnmatched}`);
  console.log(`  FIN skipped (umbrella/cover/etc): ${finsSkipped}`);
  console.log(
    `  resolved edges: ${resolved.length} (FRAME ${roleCounts.FRAME} / CUSH ${roleCounts.CUSH} / DKT ${roleCounts.DKT})`,
  );
  console.log("");
  console.log("Summary — live BOM diff");
  console.log(`  parents with no live recipe: ${importPlan.stats.parentsClean}`);
  console.log(`  parents already fully linked: ${importPlan.stats.parentsAlreadyLinked}`);
  console.log(`  parents holding legacy rows: ${importPlan.stats.parentsNeedingPurge}`);
  console.log(`  edges already live (dropped): ${alreadyLive.length}`);
  console.log("");
  console.log("Files");
  console.log(
    `  ${OUT_CSV}\n    ${matrix.length - 1} rows across ${addParents.size} FINs, ${uniqueIngredients.size} unique ingredients`,
  );
  console.log(
    `  ${PURGE_CSV}\n    ${purgeMatrix.length - 1} qty-0 rows across ${purgeParents.size} FINs`,
  );
  console.log(`  unmatched: ${unmatchedPath} (${unmatchedRows.length} rows)`);
  console.log(`  plan:  ${planPath}`);
  console.log("");
  console.log("Import order (Katana → Settings → Data import):");
  if (purgeMatrix.length > 1) {
    console.log("  1. Update existing recipes ← 5a-Purge-Conflicting-Level1.csv (qty 0)");
    console.log("     If Katana ignores qty 0, wipe them via ops:katana-wipe-recipes");
    console.log("  2. Add new recipes        ← 5-Add-Universal-Level1.csv");
  } else {
    console.log("  1. Add new recipes ← 5-Add-Universal-Level1.csv");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
