/**
 * PAUSED 2026-09-14 — tenant-wide wipe would destroy Phase 3/4 + showroom
 * recipes. Use scripts/ops/katana-wipe-sow-recipes.ts instead.
 *
 * Blank-slate wipe of EVERY Katana recipe line (bom_rows).
 *
 * Why this exists: Katana's bulk "Add new recipes" importer will not overwrite
 * an existing BOM. Hundreds of legacy products still hold old recipe rows,
 * which blocks the Phase 1 & 2 ASM-/CUT- spreadsheet. This script deletes
 * every /bom_rows record in the tenant so the importer sees empty recipes.
 *
 * Katana API (verified against developer.katanamrp.com + this tenant):
 *   GET  /bom_rows                 list every recipe line (paginate, no SKU filter)
 *   DELETE /bom_rows/{id}          supported wipe (204)
 *   DELETE /recipes/{id}           405 here — do not use
 *
 * Scope:
 *   - ALL bom_rows. No FIN-*, SA-*, ASM-*, or CUT-* filter.
 *   - Never DELETE (or PATCH) /items, /products, /materials, or /variants.
 *     Products and materials stay put so UoM and costs survive.
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-wipe-all-recipes
 *   npm run ops:katana-wipe-all-recipes -- --dry-run
 *   npm run ops:katana-wipe-all-recipes -- --confirm
 *   npm run ops:katana-wipe-all-recipes -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";

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

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

type BomRow = {
  id: string;
  productVariantId: number | null;
  productItemId: number | null;
  ingredientVariantId: number | null;
  quantity: number | null;
  ingredientSku: string | null;
};

async function paginateAllBomRows(): Promise<BomRow[]> {
  const seen = new Set<string>();
  const all: BomRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/bom_rows?limit=${PAGE_SIZE}&page=${page}`,
    );
    const raw = unwrapList<Record<string, unknown>>(data);
    console.log(`  bom_rows page ${page}: ${raw.length}`);
    for (const row of raw) {
      const mapped = mapBomRow(row);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      all.push(mapped);
    }
    if (raw.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
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

async function main(): Promise<void> {
  console.log("Katana ALL-recipes wipe (blank slate)");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  verb: DELETE /bom_rows/{id}  (not DELETE /recipes)");
  console.log("  target: EVERY bom_row in the tenant (no FIN-*/SA-* filter)");
  console.log("  preserved: /items, /products, /materials, /variants (UoM + costs)");
  console.log("");

  console.log("→ Loading all /bom_rows (unfiltered)");
  const rows = await paginateAllBomRows();
  const work = limit != null ? rows.slice(0, limit) : rows;

  const parents = new Set(
    work
      .map((r) => r.productVariantId)
      .filter((id): id is number => id != null),
  );

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(outDir, `katana-wipe-all-recipes-plan-${stamp}.csv`);
  writeCsv(
    planPath,
    [
      "bom_row_id",
      "product_variant_id",
      "product_item_id",
      "ingredient_variant_id",
      "ingredient_sku",
      "quantity",
      "action",
    ],
    work.map((r) => [
      r.id,
      r.productVariantId == null ? "" : String(r.productVariantId),
      r.productItemId == null ? "" : String(r.productItemId),
      r.ingredientVariantId == null ? "" : String(r.ingredientVariantId),
      r.ingredientSku ?? "",
      r.quantity == null ? "" : String(r.quantity),
      dryRun ? "would_delete_bom_row" : "delete_bom_row",
    ]),
  );

  console.log(`\n→ BOM rows queued for deletion: ${work.length}`);
  console.log(`  unique parent variants: ${parents.size}`);
  console.log(`  tenant total (pre-limit): ${rows.length}`);
  console.log(`  CSV: ${planPath}`);
  if (!dryRun) {
    const etaMin = Math.ceil((work.length * REQUEST_DELAY_MS) / 60000);
    console.log(`  estimated live runtime: ~${etaMin} min at ${REQUEST_DELAY_MS}ms/row`);
  }

  for (const row of work.slice(0, 40)) {
    console.log(
      `  ${dryRun ? "would delete" : "delete"} bom_row ${row.id}  parent_variant=${row.productVariantId ?? "?"}  ingredient=${row.ingredientSku || row.ingredientVariantId || "?"}`,
    );
  }
  if (work.length > 40) console.log(`  … +${work.length - 40} more rows`);

  if (dryRun) {
    console.log("\nDry-run only. Re-run with --confirm to DELETE /bom_rows/{id}.");
    console.log("Products, materials, variants, UoM, and costs are untouched.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const row of work) {
    try {
      await deleteBomRow(row.id);
      deleted += 1;
      console.log(
        `  DELETED bom_row ${row.id}  parent_variant=${row.productVariantId ?? "?"}`,
      );
    } catch (error: unknown) {
      failed += 1;
      console.warn(
        `  FAIL bom_row ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  console.log(`\n=== Summary`);
  console.log(`  rows deleted: ${deleted}; failed: ${failed}; queued: ${work.length}`);
  console.log("  items/variants were not mutated.");
  console.log("  Next: re-import the Phase 1 & 2 ASM-/CUT- spreadsheet.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
