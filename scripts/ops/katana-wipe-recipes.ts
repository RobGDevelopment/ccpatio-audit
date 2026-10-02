/**
 * Surgical wipe of flawed SA-* recipes on Katana FIN-* parents.
 *
 * Why this exists: Katana bulk "Add new recipes" cannot overwrite an existing
 * BOM. After the ASM- remint, FIN-* variants still hold the first-pass
 * SA-FRAME / SA-CUSH children, which blocks the fresh ASM- spreadsheet.
 *
 * Katana API (verified against developer.katanamrp.com + this tenant):
 *   GET  /bom_rows                 list rows (paginate)
 *   GET  /recipes                  same data, deprecated; filter is ignored
 *   DELETE /bom_rows/{id}          supported wipe (204)
 *   DELETE /recipes/{id}           405 here — do not use
 *   POST /recipes                  cannot clear: `rows` has minItems=1
 *
 * Target (default): FIN-* parents whose current recipe contains ≥1 SA-*
 * ingredient. The entire parent recipe is deleted (not only the SA- lines)
 * so the importer sees an empty BOM.
 *
 * Does NOT delete products, materials, or ASM-* recipes.
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-wipe-recipes
 *   npm run ops:katana-wipe-recipes -- --dry-run
 *   npm run ops:katana-wipe-recipes -- --confirm
 *   npm run ops:katana-wipe-recipes -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";
import {
  saIngredientSkus,
  shouldWipeFinParentRecipe,
} from "../../src/lib/katana-wipe-recipes";

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
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

type KatanaVariant = {
  id: number;
  sku: string | null;
  product_id: number | null;
  deleted_at?: string | null;
};

type KatanaEdge = {
  id: string;
  product_variant_id: number;
  ingredient_variant_id: number;
  quantity: number | null;
  ingredient_sku: string | null;
};

type ParentPlan = {
  parentSku: string;
  parentVariantId: number;
  productId: number | null;
  ingredientSkus: string[];
  saIngredients: string[];
  rowIds: string[];
};

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 80; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

function mapEdge(row: Record<string, unknown>): KatanaEdge | null {
  const id = row.id == null ? "" : String(row.id);
  const productVariantId = Number(row.product_variant_id);
  const ingredientVariantId = Number(row.ingredient_variant_id);
  if (!id || !Number.isFinite(productVariantId) || !Number.isFinite(ingredientVariantId)) {
    return null;
  }
  return {
    id,
    product_variant_id: productVariantId,
    ingredient_variant_id: ingredientVariantId,
    quantity: row.quantity == null ? null : Number(row.quantity),
    ingredient_sku:
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
  console.log("Katana FIN-* SA- recipe wipe");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("  verb: DELETE /bom_rows/{id}  (not DELETE /recipes)");
  console.log("  target: FIN-* parents whose recipe contains ≥1 SA-* ingredient");
  console.log("");

  console.log("→ Loading variants + recipes + bom_rows");
  const variants = await paginate<KatanaVariant>("/variants", "variants");
  await delay(REQUEST_DELAY_MS);
  const recipePayload = await paginate<Record<string, unknown>>(
    "/recipes",
    "recipes",
  );
  await delay(REQUEST_DELAY_MS);
  let bomPayload: Record<string, unknown>[] = [];
  try {
    bomPayload = await paginate<Record<string, unknown>>("/bom_rows", "bom_rows");
  } catch (error: unknown) {
    console.warn(
      `  bom_rows list failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const skuByVariant = new Map<number, string>();
  const productByVariant = new Map<number, number | null>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = (v.sku ?? "").trim().toUpperCase();
    if (!sku) continue;
    skuByVariant.set(v.id, sku);
    productByVariant.set(v.id, v.product_id);
  }

  const edgesByParent = new Map<number, KatanaEdge[]>();
  const ingest = (raw: Record<string, unknown>) => {
    const edge = mapEdge(raw);
    if (!edge) return;
    const list = edgesByParent.get(edge.product_variant_id) ?? [];
    if (list.some((e) => e.id === edge.id)) return;
    list.push(edge);
    edgesByParent.set(edge.product_variant_id, list);
  };
  for (const row of bomPayload) ingest(row);
  for (const row of recipePayload) ingest(row);

  const plans: ParentPlan[] = [];
  for (const [parentVariantId, edges] of edgesByParent) {
    const parentSku = skuByVariant.get(parentVariantId);
    if (!parentSku) continue;
    const ingredientSkus = edges.map(
      (e) =>
        (e.ingredient_sku ?? skuByVariant.get(e.ingredient_variant_id) ?? "").trim().toUpperCase(),
    );
    if (!shouldWipeFinParentRecipe({ parentSku, ingredientSkus })) continue;
    plans.push({
      parentSku,
      parentVariantId,
      productId: productByVariant.get(parentVariantId) ?? null,
      ingredientSkus,
      saIngredients: saIngredientSkus(ingredientSkus),
      rowIds: edges.map((e) => e.id),
    });
  }

  plans.sort((a, b) => a.parentSku.localeCompare(b.parentSku));
  const work = limit != null ? plans.slice(0, limit) : plans;
  const rowCount = work.reduce((n, p) => n + p.rowIds.length, 0);

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(outDir, `katana-wipe-recipes-plan-${stamp}.csv`);
  writeCsv(
    planPath,
    [
      "parent_sku",
      "parent_variant_id",
      "product_id",
      "row_count",
      "sa_ingredients",
      "all_ingredients",
      "action",
    ],
    work.map((p) => [
      p.parentSku,
      String(p.parentVariantId),
      p.productId == null ? "" : String(p.productId),
      String(p.rowIds.length),
      p.saIngredients.join("|"),
      p.ingredientSkus.join("|"),
      dryRun ? "would_delete_bom_rows" : "delete_bom_rows",
    ]),
  );

  console.log(`\n→ FIN-* parents with SA-* recipes: ${plans.length}`);
  console.log(`  in this run: ${work.length} parent(s), ${rowCount} BOM row(s)`);
  console.log(`  CSV: ${planPath}`);

  for (const plan of work.slice(0, 40)) {
    console.log(
      `  ${dryRun ? "would wipe" : "wipe"} ${plan.parentSku}  rows=${plan.rowIds.length}  sa=${plan.saIngredients.join(",")}`,
    );
  }
  if (work.length > 40) console.log(`  … +${work.length - 40} more parents`);

  if (dryRun) {
    console.log("\nDry-run only. Re-run with --confirm to DELETE /bom_rows/{id}.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const plan of work) {
    for (const id of plan.rowIds) {
      try {
        await deleteBomRow(id);
        deleted += 1;
        console.log(`  DELETED bom_row ${id}  parent=${plan.parentSku}`);
      } catch (error: unknown) {
        failed += 1;
        console.warn(
          `  FAIL bom_row ${id} parent=${plan.parentSku}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await delay(REQUEST_DELAY_MS);
    }
  }

  console.log(`\n=== Summary`);
  console.log(`  parents: ${work.length}; rows deleted: ${deleted}; failed: ${failed}`);
  console.log("  Next: re-import the ASM- spreadsheet (Katana will accept empty BOMs).");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
