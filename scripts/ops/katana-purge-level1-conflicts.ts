/**
 * Phase 2 purge — remove legacy ingredients blocking the Universal Level 1 link.
 *
 * Katana's recipe importer APPENDS and cannot clear a BOM (`POST /recipes` has
 * `rows.minItems=1`), so the qty-0 rows in 5a-Purge-Conflicting-Level1.csv only
 * work if the tenant honours qty 0. This script does it deterministically
 * instead: recompute the Level 1 plan against live Katana, resolve each
 * conflicting ingredient to its live BOM row, and DELETE /bom_rows/{id}.
 *
 * Safety:
 *   - dry-run is the default; --confirm is required to delete
 *   - a row the new tree still wants is REFUSED, never deleted
 *   - refusals abort the run before any delete is issued
 *   - only FIN-* parents already flagged `blocked_until_purge` are touched
 *
 *   npm run ops:katana-purge-level1-conflicts
 *   npm run ops:katana-purge-level1-conflicts -- --limit=25
 *   npm run ops:katana-purge-level1-conflicts:confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFinTwinParts } from "../../src/lib/katana-fin-bom";
import {
  classifyFinFamily,
  indexLiveMonolithicTwins,
  planLevel1ConflictPurge,
  planUniversalLevel1Import,
  resolveUniversalLevel1,
  type LiveBomRowRef,
  type MonolithicLevel1Edge,
} from "../../src/lib/monolithic-builds";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm") && !explicitDryRun;
const dryRun = !confirm;

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

/** `--json=<path>` writes the full review manifest (parents, row ids, replacements). */
function parseJsonPath(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--json=")) {
      const raw = arg.slice("--json=".length).trim();
      if (raw) return raw;
    }
  }
  return null;
}

const limit = parseLimit();
const jsonPath = parseJsonPath();
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  product_id?: number | null;
  deleted_at?: string | null;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function csvLine(cells: Array<string | number>): string {
  return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
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
  throw new Error(`Pagination hit ${MAX_PAGES} full pages for ${path}.`);
}

/** Live BOM rows WITH their ids, plus the parent → ingredient index for diffing. */
async function fetchLiveBomRows(
  skuByVariant: ReadonlyMap<number, string>,
): Promise<{ rows: LiveBomRowRef[]; byParent: Map<string, Set<string>> }> {
  const rows: LiveBomRowRef[] = [];
  const byParent = new Map<string, Set<string>>();
  const seenRowIds = new Set<string>();

  const ingest = (raw: Record<string, unknown>) => {
    const rowId = raw.id == null ? "" : String(raw.id);
    const parent =
      typeof raw.product_sku === "string"
        ? normalizeSku(raw.product_sku)
        : skuByVariant.get(Number(raw.product_variant_id)) ?? "";
    const ingredient =
      typeof raw.ingredient_sku === "string"
        ? normalizeSku(raw.ingredient_sku)
        : skuByVariant.get(Number(raw.ingredient_variant_id)) ?? "";
    if (!parent || !ingredient) return;

    if (!byParent.has(parent)) byParent.set(parent, new Set());
    byParent.get(parent)!.add(ingredient);

    if (!rowId || seenRowIds.has(rowId)) return;
    seenRowIds.add(rowId);
    rows.push({ rowId, parentSku: parent, ingredientSku: ingredient });
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
  return { rows, byParent };
}

async function main(): Promise<void> {
  console.log("Phase 2 purge — clear legacy ingredients blocking Level 1");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  verb: DELETE /bom_rows/{id}");
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
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    liveSkus.add(sku);
    skuByVariant.set(Number(v.id), sku);
    const productId = v.product_id != null ? Number(v.product_id) : NaN;
    if (sku.startsWith("FIN-") && Number.isFinite(productId)) {
      if (!finSkus.includes(sku)) finSkus.push(sku);
    }
  }
  finSkus.sort();
  console.log(`  live SKUs: ${liveSkus.size} / FIN-* products: ${finSkus.length}`);

  const twins = indexLiveMonolithicTwins(liveSkus);
  const resolved: MonolithicLevel1Edge[] = [];
  for (const fin of finSkus) {
    const parsed = parseFinTwinParts(fin);
    if (!parsed || classifyFinFamily(parsed) === "skip") continue;
    resolved.push(...resolveUniversalLevel1(fin, liveSkus, twins));
  }
  console.log(`  planned Level 1 edges: ${resolved.length}`);

  console.log("");
  console.log("→ Loading live BOM rows (with ids)");
  await delay(REQUEST_DELAY_MS);
  const { rows: liveRows, byParent } = await fetchLiveBomRows(skuByVariant);
  console.log(`  live BOM rows: ${liveRows.length}`);

  const importPlan = planUniversalLevel1Import(resolved, byParent);
  const purgePlan = planLevel1ConflictPurge({
    purgeRows: importPlan.purgeRows,
    liveRows,
    wantedEdges: resolved,
  });

  const parents = new Set(purgePlan.targets.map((t) => t.parentSku));
  console.log("");
  console.log("=== Purge plan");
  console.log(`  parents holding legacy rows: ${importPlan.stats.parentsNeedingPurge}`);
  console.log(`  rows to delete: ${purgePlan.targets.length} across ${parents.size} parents`);
  console.log(`  purge rows with no live row: ${purgePlan.unresolved.length}`);
  console.log(`  REFUSED (still wanted): ${purgePlan.refused.length}`);

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(outDir, `katana-purge-level1-${stamp}.csv`);
  writeFileSync(
    planPath,
    [
      "parent_sku,ingredient_sku,bom_row_id,action",
      ...purgePlan.targets.map((t) =>
        csvLine([
          t.parentSku,
          t.ingredientSku,
          t.rowId,
          dryRun ? "would_delete" : "delete",
        ]),
      ),
    ].join("\r\n") + "\r\n",
    "utf8",
  );
  console.log(`  plan CSV: ${planPath}`);

  if (jsonPath) {
    const replacementsByParent = new Map<
      string,
      Array<{ ingredientSku: string; role: string; quantity: number }>
    >();
    for (const row of importPlan.audit) {
      if (row.verdict !== "blocked_until_purge") continue;
      const list = replacementsByParent.get(row.productSku) ?? [];
      list.push({
        ingredientSku: row.ingredientSku,
        role: row.role,
        quantity: row.quantity,
      });
      replacementsByParent.set(row.productSku, list);
    }

    const targetsByParent = new Map<string, typeof purgePlan.targets>();
    for (const t of purgePlan.targets) {
      const list = targetsByParent.get(t.parentSku) ?? [];
      list.push(t);
      targetsByParent.set(t.parentSku, list);
    }

    const byIngredient: Record<string, number> = {};
    for (const t of purgePlan.targets) {
      byIngredient[t.ingredientSku] = (byIngredient[t.ingredientSku] ?? 0) + 1;
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      mode: dryRun ? "dry-run" : "live",
      verb: "DELETE /bom_rows/{id}",
      source: "live Katana /variants + /bom_rows + /recipes",
      totals: {
        parents: targetsByParent.size,
        rowsToDelete: purgePlan.targets.length,
        unresolvedPurgeRows: purgePlan.unresolved.length,
        refusedStillWanted: purgePlan.refused.length,
        liveBomRowsScanned: liveRows.length,
      },
      safetyChecks: {
        noRefusals: purgePlan.refused.length === 0,
        noUnresolved: purgePlan.unresolved.length === 0,
      },
      deletionsByIngredient: byIngredient,
      parents: [...targetsByParent.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([parentSku, rows]) => ({
          parentSku,
          deleteRows: rows.map((r) => ({
            bomRowId: r.rowId,
            ingredientSku: r.ingredientSku,
          })),
          replacedBy: replacementsByParent.get(parentSku) ?? [],
        })),
      allBomRowIds: purgePlan.targets.map((t) => t.rowId),
    };

    const resolvedJsonPath = join(process.cwd(), jsonPath);
    mkdirSync(join(resolvedJsonPath, ".."), { recursive: true });
    writeFileSync(
      resolvedJsonPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    console.log(`  review JSON: ${resolvedJsonPath}`);
  }

  if (purgePlan.refused.length > 0) {
    console.error("");
    console.error("ABORT — these live rows are still wanted by the new tree:");
    for (const row of purgePlan.refused.slice(0, 20)) {
      console.error(`  ${row.parentSku}  ${row.ingredientSku}  (row ${row.rowId})`);
    }
    process.exitCode = 1;
    return;
  }

  const work = limit != null ? purgePlan.targets.slice(0, limit) : purgePlan.targets;
  for (const t of work.slice(0, 30)) {
    console.log(
      `  ${dryRun ? "would delete" : "delete"} ${t.parentSku}  ${t.ingredientSku}  (row ${t.rowId})`,
    );
  }
  if (work.length > 30) console.log(`  … +${work.length - 30} more rows`);

  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to DELETE /bom_rows/{id}.");
    return;
  }

  console.log("");
  let deleted = 0;
  let failed = 0;
  for (const t of work) {
    try {
      await katanaFetch(`/bom_rows/${t.rowId}`, { method: "DELETE" });
      deleted += 1;
      console.log(`  DELETED ${t.parentSku}  ${t.ingredientSku}  (row ${t.rowId})`);
    } catch (err) {
      failed += 1;
      console.warn(
        `  FAIL ${t.parentSku} ${t.ingredientSku} row=${t.rowId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  console.log("");
  console.log("=== Summary");
  console.log(`  rows deleted: ${deleted}; failed: ${failed}`);
  console.log("  Next: re-run ops:katana-direct-bom-generator, then import 5-Add-Universal-Level1.csv");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
