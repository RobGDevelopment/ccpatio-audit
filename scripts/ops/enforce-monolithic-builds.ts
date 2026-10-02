/**
 * Enforce monolithic (scratch-built) frames: purge ARM/BACK/SEAT weldments,
 * relink affected FIN-* to one dimensioned FRAME + CUSH, inject Level 2 RM.
 *
 * SSOT: live Katana GET /variants + /bom_rows (recipes fallback). No Postgres.
 *
 * Outputs (Katana 3-column recipe import):
 *   docs/Katana Downloads/1-Purge-Modular-BOMs.csv      (qty 0)
 *   docs/Katana Downloads/2-Add-Monolithic-Level1.csv   (FIN → FRAME/CUSH)
 *   docs/Katana Downloads/3-Add-Monolithic-Level2.csv   (FRAME → RM)
 *
 *   npm run ops:enforce-monolithic-builds
 *   npm run ops:enforce-monolithic-builds -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toKatanaCsv } from "../../src/lib/katana-bom-csv";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import {
  buildMonolithicLevel2Lines,
  heuristicClubChairPurgeEdges,
  isClubChairFin,
  isModularWeldmentSku,
  isNonMonolithicIngredient,
  purgeRowsFromEdges,
  resolveMonolithicLevel1,
  uniqueFrameSkus,
  type RecipeEdge,
} from "../../src/lib/monolithic-builds";
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

const limit = parseLimit();
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const DOWNLOADS = join(process.cwd(), "docs", "Katana Downloads");
const PURGE_CSV = join(DOWNLOADS, "1-Purge-Modular-BOMs.csv");
const LEVEL1_CSV = join(DOWNLOADS, "2-Add-Monolithic-Level1.csv");
const LEVEL2_CSV = join(DOWNLOADS, "3-Add-Monolithic-Level2.csv");

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
  deleted_at?: string | null;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function matrixFromEdges(
  edges: Array<{ productSku: string; ingredientSku: string; quantity: number }>,
): Array<Array<string | number>> {
  return [
    [...HEADERS],
    ...edges.map((e) => [e.productSku, e.ingredientSku, e.quantity]),
  ];
}

async function main(): Promise<void> {
  console.log("Enforce monolithic builds (ARM/BACK/SEAT → one FRAME)");
  console.log("  SSOT: live Katana /variants + /bom_rows (NO Postgres)");
  console.log("  Level 1: FIN → dimensioned SA-/ASM-*-FRAME + CUSH");
  console.log("  Level 2: parametric tubing / powder / caps");
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariant[];
  try {
    variants = (await paginate(
      "/variants?include_deleted=false",
      "variants",
    )) as unknown as KatanaVariant[];
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const liveSkus = new Set<string>();
  const skuByVariant = new Map<number, string>();
  const finSkus: string[] = [];
  const modularSkus: string[] = [];

  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    liveSkus.add(sku);
    skuByVariant.set(v.id, sku);
    if (sku.startsWith("FIN-") && !finSkus.includes(sku)) finSkus.push(sku);
    if (isModularWeldmentSku(sku) && !modularSkus.includes(sku)) {
      modularSkus.push(sku);
    }
  }
  finSkus.sort();
  modularSkus.sort();

  console.log(`  live SKUs: ${liveSkus.size}`);
  console.log(`  live FIN-*: ${finSkus.length}`);
  console.log(`  modular ARM/BACK/SEAT assemblies: ${modularSkus.length}`);
  for (const sku of modularSkus.slice(0, 40)) {
    console.log(`    modular  ${sku}`);
  }
  if (modularSkus.length > 40) {
    console.log(`    … +${modularSkus.length - 40} more`);
  }
  console.log("");

  console.log("→ Fetching live recipes / bom_rows");
  await delay(REQUEST_DELAY_MS);
  let recipePayload: Record<string, unknown>[] = [];
  try {
    recipePayload = await paginate("/recipes", "recipes");
  } catch (err) {
    console.warn(
      `  /recipes failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await delay(REQUEST_DELAY_MS);
  let bomPayload: Record<string, unknown>[] = [];
  try {
    bomPayload = await paginate("/bom_rows", "bom_rows");
  } catch (err) {
    console.warn(
      `  /bom_rows failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const liveEdges: RecipeEdge[] = [];
  const ingest = (row: Record<string, unknown>) => {
    const parentId = Number(row.product_variant_id);
    const ingId = Number(row.ingredient_variant_id);
    const parentSku =
      typeof row.product_sku === "string"
        ? normalizeSku(row.product_sku)
        : skuByVariant.get(parentId) ?? "";
    const ingredientSku =
      typeof row.ingredient_sku === "string"
        ? normalizeSku(row.ingredient_sku)
        : skuByVariant.get(ingId) ?? "";
    if (!parentSku || !ingredientSku) return;
    liveEdges.push({
      parentSku,
      ingredientSku,
      quantity: row.quantity == null ? undefined : Number(row.quantity),
    });
  };
  for (const row of bomPayload) ingest(row);
  for (const row of recipePayload) ingest(row);
  console.log(`  live BOM edges ingested: ${liveEdges.length}`);
  console.log("");

  const heuristic: RecipeEdge[] = [];
  for (const fin of finSkus) {
    if (!isClubChairFin(fin)) continue;
    heuristic.push(...heuristicClubChairPurgeEdges(fin, liveSkus));
  }

  const purge = purgeRowsFromEdges([...liveEdges, ...heuristic]);
  const parentsWithModular = new Set(
    liveEdges
      .filter((e) => isNonMonolithicIngredient(e.ingredientSku))
      .map((e) => e.parentSku),
  );

  const affectedFins: string[] = [];
  for (const fin of finSkus) {
    const hit =
      isClubChairFin(fin) ||
      parentsWithModular.has(fin) ||
      liveEdges.some(
        (e) => e.parentSku === fin && isNonMonolithicIngredient(e.ingredientSku),
      );
    if (hit) affectedFins.push(fin);
  }

  const workFins =
    limit != null ? affectedFins.slice(0, limit) : affectedFins;

  console.log("→ Level 1 remap (affected FIN-*)");
  const level1 = [];
  let finsNoStem = 0;
  let framesNotLive = 0;
  for (const fin of workFins) {
    const edges = resolveMonolithicLevel1(fin, liveSkus);
    if (edges.length === 0) {
      finsNoStem += 1;
      console.log(`  skip  ${fin}  (no dimensioned stem)`);
      continue;
    }
    const frame = edges.find((e) => e.role === "FRAME");
    const cush = edges.find((e) => e.role === "CUSH");
    if (frame && !frame.live) framesNotLive += 1;
    console.log(
      `  FIN ${fin}  →  ${frame?.ingredientSku ?? "?"} (${frame?.live ? "live" : "MINT"})  +  ${cush?.ingredientSku ?? "(no cush)"}`,
    );
    level1.push(...edges);
  }

  const frames = uniqueFrameSkus(level1);
  console.log("");
  console.log("→ Level 2 parametric on new monolithic frames");
  const level2 = buildMonolithicLevel2Lines(frames, liveSkus);
  for (const sku of frames) {
    const n = level2.filter((l) => l.parentSku === sku).length;
    console.log(`  FRAME ${sku}  RM rows=${n}`);
  }

  mkdirSync(dirname(PURGE_CSV), { recursive: true });
  writeFileSync(
    PURGE_CSV,
    toKatanaCsv(
      matrixFromEdges(
        purge.map((r) => ({
          productSku: r.parentSku,
          ingredientSku: r.ingredientSku,
          quantity: 0,
        })),
      ),
    ),
    "utf8",
  );
  writeFileSync(
    LEVEL1_CSV,
    toKatanaCsv(
      matrixFromEdges(
        level1.map((e) => ({
          productSku: e.productSku,
          ingredientSku: e.ingredientSku,
          quantity: e.quantity,
        })),
      ),
    ),
    "utf8",
  );
  writeFileSync(
    LEVEL2_CSV,
    toKatanaCsv(
      matrixFromEdges(
        level2.map((l) => ({
          productSku: l.parentSku,
          ingredientSku: l.childSku,
          quantity: l.quantity,
        })),
      ),
    ),
    "utf8",
  );

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, `monolithic-modular-skus-${stamp()}.csv`),
    toKatanaCsv([["sku"], ...modularSkus.map((s) => [s])]),
    "utf8",
  );

  console.log("");
  console.log("Summary");
  console.log(`  modular ARM/BACK/SEAT assemblies: ${modularSkus.length}`);
  console.log(`  live BOM edges: ${liveEdges.length}`);
  console.log(`  purge rows (qty 0): ${purge.length}`);
  console.log(`  affected FIN-* (pre-limit): ${affectedFins.length}`);
  console.log(`  FIN remapped this run: ${workFins.length - finsNoStem}`);
  console.log(`  FIN with no dimensioned stem: ${finsNoStem}`);
  console.log(`  FRAME SKUs not yet live (mint before import): ${framesNotLive}`);
  console.log(`  unique monolithic frames: ${frames.length}`);
  console.log(`  Level 1 rows: ${level1.length}`);
  console.log(`  Level 2 rows: ${level2.length}`);
  console.log(`  wrote: ${PURGE_CSV}`);
  console.log(`  wrote: ${LEVEL1_CSV}`);
  console.log(`  wrote: ${LEVEL2_CSV}`);
  console.log("");
  console.log("Import order (Katana → Settings → Data import):");
  console.log("  1. Update existing recipes ← 1-Purge-Modular-BOMs.csv (qty 0)");
  console.log("     If qty 0 is ignored, wipe those bom_rows via ops:katana-wipe-recipes");
  console.log("  2. Add new recipes ← 2-Add-Monolithic-Level1.csv");
  console.log("  3. Add new recipes ← 3-Add-Monolithic-Level2.csv");
  console.log("  Mint any FRAME flagged MINT before step 2.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
