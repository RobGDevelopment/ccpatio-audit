/**
 * Targeted wipe of Katana recipe lines for Phase 1 & 2 SOW parents only.
 *
 * Why this exists: Katana's bulk "Add new recipes" importer will not overwrite
 * an existing BOM. Phase 1 & 2 FIN-/ASM-/CUT- parents still hold legacy
 * recipe rows, which blocks the spreadsheet. A tenant-wide wipe would also
 * destroy Phase 3/4 and custom showroom recipes — this script does not.
 *
 * Katana API (verified against developer.katanamrp.com + this tenant):
 *   GET  /variants                 map product_variant_id → SKU (read-only)
 *   GET  /bom_rows                 list recipe lines (paginate)
 *   DELETE /bom_rows/{id}          supported wipe (204)
 *
 * Scope:
 *   - DELETE /bom_rows/{id} ONLY when the parent variant SKU is in the
 *     Phase 1 & 2 target list (unique "Product variant code / SKU" from
 *     docs/Katana Downloads/Add-new-recipes.csv; fallback =
 *     tmp/archetype-clone-plan.csv target_fg + frame_sku + cush_sku).
 *   - Never DELETE /items, /products, /materials, or /variants.
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-wipe-sow-recipes
 *   npm run ops:katana-wipe-sow-recipes -- --dry-run
 *   npm run ops:katana-wipe-sow-recipes -- --confirm
 *   npm run ops:katana-wipe-sow-recipes -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";
import { col, readCsvRecords } from "./lib/csv";

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

const limit = parseLimit();

/** Katana allows ~60 requests / 60s. */
const REQUEST_DELAY_MS = 1100;
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RECIPES_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-recipes.csv",
);
const CLONE_PLAN_CSV = join(process.cwd(), "tmp", "archetype-clone-plan.csv");

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

type BomRow = {
  id: string;
  productVariantId: number | null;
  productItemId: number | null;
  ingredientVariantId: number | null;
  quantity: number | null;
  ingredientSku: string | null;
};

type KatanaVariant = {
  id: number;
  sku: string | null;
  deleted_at?: string | null;
};

function loadSowTargetSkus(): { skus: Set<string>; source: string } {
  if (existsSync(RECIPES_CSV)) {
    const rows = readCsvRecords(RECIPES_CSV);
    const skus = new Set<string>();
    for (const row of rows) {
      const sku = normalizeSku(
        col(row, "Product variant code / SKU (required)", "Product variant code / SKU"),
      );
      if (sku) skus.add(sku);
    }
    if (skus.size === 0) {
      throw new Error(
        `No parent SKUs in ${RECIPES_CSV}. Expected column "Product variant code / SKU (required)".`,
      );
    }
    return { skus, source: RECIPES_CSV };
  }

  if (existsSync(CLONE_PLAN_CSV)) {
    const rows = readCsvRecords(CLONE_PLAN_CSV);
    const skus = new Set<string>();
    for (const row of rows) {
      for (const key of ["target_fg", "frame_sku", "cush_sku"] as const) {
        const sku = normalizeSku(row[key] ?? "");
        if (sku) skus.add(sku);
      }
    }
    if (skus.size === 0) {
      throw new Error(`No SKUs in fallback ${CLONE_PLAN_CSV}.`);
    }
    return { skus, source: CLONE_PLAN_CSV };
  }

  throw new Error(
    `Missing Phase 1 & 2 target list. Expected ${RECIPES_CSV} or ${CLONE_PLAN_CSV}.`,
  );
}

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for ${label} (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

function mapBomRow(row: Record<string, unknown>): BomRow | null {
  const id = row.id == null ? "" : String(row.id).trim();
  if (!id) return null;
  const productVariantId = Number(row.product_variant_id);
  const productItemId = Number(row.product_item_id);
  const ingredientVariantId = Number(row.ingredient_variant_id);
  const quantity = Number(row.quantity);
  return {
    id,
    productVariantId: Number.isFinite(productVariantId) ? productVariantId : null,
    productItemId: Number.isFinite(productItemId) ? productItemId : null,
    ingredientVariantId: Number.isFinite(ingredientVariantId)
      ? ingredientVariantId
      : null,
    quantity: Number.isFinite(quantity) ? quantity : null,
    ingredientSku:
      typeof row.ingredient_sku === "string" ? row.ingredient_sku : null,
  };
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

async function deleteBomRow(id: string): Promise<void> {
  await katanaFetch(`/bom_rows/${id}`, { method: "DELETE" });
}

function prefixCounts(skus: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const sku of skus) {
    const prefix = sku.split("-")[0] || sku;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
}

async function main(): Promise<void> {
  const { skus: targetSkus, source } = loadSowTargetSkus();

  console.log("Katana Phase 1 & 2 SOW recipe wipe (targeted)");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  verb: DELETE /bom_rows/{id}  (not DELETE /recipes)");
  console.log(`  target list: ${source}`);
  console.log(`  SOW parent SKUs: ${targetSkus.size}  (${prefixCounts(targetSkus)})`);
  console.log("  preserved: Phase 3/4 + showroom recipes; /items /variants /UoM /costs");
  console.log("");

  console.log("→ Loading /variants (read-only SKU map) + /bom_rows");
  const variants = await paginate<KatanaVariant>("/variants", "variants");
  await delay(REQUEST_DELAY_MS);
  const bomPayload = await paginate<Record<string, unknown>>("/bom_rows", "bom_rows");

  const skuByVariant = new Map<number, string>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(v.sku ?? "");
    if (!sku || !Number.isFinite(v.id)) continue;
    skuByVariant.set(v.id, sku);
  }

  const seenRowIds = new Set<string>();
  const rows: BomRow[] = [];
  for (const raw of bomPayload) {
    const mapped = mapBomRow(raw);
    if (!mapped || seenRowIds.has(mapped.id)) continue;
    seenRowIds.add(mapped.id);
    rows.push(mapped);
  }

  type WorkRow = BomRow & { parentSku: string };
  const matched: WorkRow[] = [];
  const skipped: WorkRow[] = [];
  const unmatchedVariantIds = new Set<number>();

  for (const row of rows) {
    if (row.productVariantId == null) {
      skipped.push({ ...row, parentSku: "" });
      continue;
    }
    const parentSku = skuByVariant.get(row.productVariantId) ?? "";
    if (!parentSku) {
      unmatchedVariantIds.add(row.productVariantId);
      skipped.push({ ...row, parentSku: "" });
      continue;
    }
    if (targetSkus.has(parentSku)) {
      matched.push({ ...row, parentSku });
    } else {
      skipped.push({ ...row, parentSku });
    }
  }

  const matchedParents = [...new Set(matched.map((r) => r.parentSku))].sort();
  const skippedParents = [
    ...new Set(skipped.map((r) => r.parentSku).filter(Boolean)),
  ].sort();
  const workParents =
    limit != null ? matchedParents.slice(0, limit) : matchedParents;
  const workParentSet = new Set(workParents);
  const work = matched.filter((r) => workParentSet.has(r.parentSku));

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(outDir, `katana-wipe-sow-recipes-plan-${stamp}.csv`);
  const skipPath = join(outDir, `katana-wipe-sow-recipes-skipped-${stamp}.csv`);

  writeCsv(
    planPath,
    [
      "parent_sku",
      "parent_variant_id",
      "bom_row_id",
      "ingredient_variant_id",
      "ingredient_sku",
      "quantity",
      "action",
    ],
    work.map((r) => [
      r.parentSku,
      r.productVariantId == null ? "" : String(r.productVariantId),
      r.id,
      r.ingredientVariantId == null ? "" : String(r.ingredientVariantId),
      r.ingredientSku ?? "",
      r.quantity == null ? "" : String(r.quantity),
      dryRun ? "would_delete_bom_row" : "delete_bom_row",
    ]),
  );

  const skippedByParent = new Map<string, number>();
  for (const row of skipped) {
    const key = row.parentSku || `(unresolved variant ${row.productVariantId ?? "?"})`;
    skippedByParent.set(key, (skippedByParent.get(key) ?? 0) + 1);
  }
  writeCsv(
    skipPath,
    ["parent_sku", "row_count", "reason"],
    [...skippedByParent.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([sku, n]) => [
        sku,
        String(n),
        sku.startsWith("(") ? "unresolved_parent_sku" : "not_in_sow_target",
      ]),
  );

  const sowWithNoBom = [...targetSkus].filter((sku) => !matchedParents.includes(sku));

  console.log(`\n→ Tenant BOM rows: ${rows.length}`);
  console.log(`  SOW parents with existing recipes (blocking): ${matchedParents.length}`);
  console.log(`  SOW BOM rows queued for deletion: ${work.length}`);
  console.log(`  in this run: ${workParents.length} parent(s)  (${prefixCounts(workParents)})`);
  console.log(`  skipped (Phase 3/4 / showroom / other): ${skipped.length} row(s) on ${skippedParents.length} parent(s)`);
  console.log(`  SOW target SKUs already empty: ${sowWithNoBom.length}`);
  if (unmatchedVariantIds.size > 0) {
    console.log(`  unresolved parent variant ids: ${unmatchedVariantIds.size} (not deleted)`);
  }
  console.log(`  plan CSV: ${planPath}`);
  console.log(`  skipped CSV: ${skipPath}`);
  if (!dryRun) {
    const etaMin = Math.ceil((work.length * REQUEST_DELAY_MS) / 60000);
    console.log(`  estimated live runtime: ~${etaMin} min at ${REQUEST_DELAY_MS}ms/row`);
  }

  for (const parentSku of workParents.slice(0, 40)) {
    const n = work.filter((r) => r.parentSku === parentSku).length;
    console.log(
      `  ${dryRun ? "would wipe" : "wipe"} ${parentSku}  rows=${n}`,
    );
  }
  if (workParents.length > 40) {
    console.log(`  … +${workParents.length - 40} more SOW parents`);
  }

  if (dryRun) {
    console.log("\nDry-run only. Re-run with --confirm to DELETE matching /bom_rows/{id}.");
    console.log("Phase 3/4, showroom, products, materials, variants, UoM, and costs are untouched.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const row of work) {
    try {
      await deleteBomRow(row.id);
      deleted += 1;
      console.log(
        `  DELETED bom_row ${row.id}  parent=${row.parentSku}`,
      );
    } catch (error: unknown) {
      failed += 1;
      console.warn(
        `  FAIL bom_row ${row.id} parent=${row.parentSku}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  console.log(`\n=== Summary`);
  console.log(`  SOW parents: ${workParents.length}; rows deleted: ${deleted}; failed: ${failed}`);
  console.log("  items/variants were not mutated. Non-SOW recipes were not deleted.");
  console.log("  Next: re-import the Phase 1 & 2 ASM-/CUT- spreadsheet.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
