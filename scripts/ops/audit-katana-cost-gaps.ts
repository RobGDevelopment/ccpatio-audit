/**
 * Phase 0 live audit: classify every FIN / FRAME / CUSH vs recipes + ops.
 *
 * SSOT: live Katana GET /variants + /bom_rows + /recipes + /product_operation_rows.
 * No Postgres. Read-only — never writes Katana.
 *
 *   npm run ops:audit-katana-cost-gaps
 *   npm run ops:audit-katana-cost-gaps -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KatanaApiError } from "../../src/lib/katana";
import {
  classifyKatanaCostGap,
  summarizeCostGaps,
  type CostGapClassification,
} from "../../src/lib/katana-cost-gaps";
import { REQUEST_DELAY_MS, delay } from "./lib/csv";
import { loadProductOperationRows, paginateKatana } from "./lib/katana-paginate";

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

type KatanaVariant = {
  id: number;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  purchase_price?: number | null;
  deleted_at?: string | null;
};

type LiveProduct = {
  sku: string;
  name: string;
  variantId: number;
  productId: number;
  purchasePrice: number | null;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function csvEscape(value: string | number | boolean | null): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function mergeCounts(
  a: Map<number, number>,
  b: Map<number, number>,
): Map<number, number> {
  const out = new Map(a);
  for (const [id, n] of b) {
    out.set(id, Math.max(out.get(id) ?? 0, n));
  }
  return out;
}

function collectLiveProducts(variants: readonly KatanaVariant[]): LiveProduct[] {
  const bySku = new Map<string, LiveProduct>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    const productId = v.product_id != null ? Number(v.product_id) : NaN;
    if (!Number.isFinite(productId)) continue;
    if (bySku.has(sku)) continue;
    const purchase =
      v.purchase_price == null ? null : Number(v.purchase_price);
    bySku.set(sku, {
      sku,
      name: String(v.name ?? "").trim(),
      variantId: v.id,
      productId,
      purchasePrice: Number.isFinite(purchase as number) ? purchase : null,
    });
  }
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

function countByVariantId(
  rows: readonly Record<string, unknown>[],
  skuByVariant: ReadonlyMap<number, string>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const qtyRaw = row.quantity;
    if (qtyRaw != null && Number(qtyRaw) === 0) continue;
    const parentId = Number(row.product_variant_id);
    if (Number.isFinite(parentId) && parentId > 0) {
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      continue;
    }
    const parentSku =
      typeof row.product_sku === "string" ? normalizeSku(row.product_sku) : "";
    if (!parentSku) continue;
    for (const [id, sku] of skuByVariant) {
      if (sku === parentSku) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        break;
      }
    }
  }
  return counts;
}

function countOperations(
  rows: readonly Record<string, unknown>[],
): { byVariant: Map<number, number>; byProduct: Map<number, number> } {
  const byVariant = new Map<number, number>();
  const byProduct = new Map<number, number>();
  for (const row of rows) {
    const variantId = Number(
      row.product_variant_id ?? row.variant_id ?? NaN,
    );
    if (Number.isFinite(variantId) && variantId > 0) {
      byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + 1);
      continue;
    }
    const productId = Number(row.product_id ?? NaN);
    if (Number.isFinite(productId) && productId > 0) {
      byProduct.set(productId, (byProduct.get(productId) ?? 0) + 1);
    }
  }
  return { byVariant, byProduct };
}

function operationRowCount(
  product: LiveProduct,
  ops: { byVariant: Map<number, number>; byProduct: Map<number, number> },
): number {
  const fromVariant = ops.byVariant.get(product.variantId) ?? 0;
  if (fromVariant > 0) return fromVariant;
  return ops.byProduct.get(product.productId) ?? 0;
}

function writeAuditCsv(
  path: string,
  rows: Array<
    CostGapClassification & {
      name: string;
      variantId: number;
      productId: number;
      purchasePrice: number | null;
    }
  >,
): void {
  const headers = [
    "sku",
    "name",
    "family",
    "gap_class",
    "ops_presence",
    "track_id",
    "recipe_row_count",
    "operation_row_count",
    "variant_id",
    "product_id",
    "purchase_price",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.sku,
        r.name,
        r.family,
        r.gapClass,
        r.opsPresence,
        r.trackId ?? "",
        r.recipeRowCount,
        r.operationRowCount,
        r.variantId,
        r.productId,
        r.purchasePrice ?? "",
      ]
        .map((c) => csvEscape(c))
        .join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

async function main(): Promise<void> {
  console.log("Katana cost-gap audit (READ-ONLY)");
  console.log("  SSOT: live /variants + /bom_rows + /recipes + /product_operation_rows");
  console.log("  No Postgres. Does not write Katana.");
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariant[];
  try {
    variants = (await paginateKatana(
      "/variants?include_deleted=false",
      "variants",
    )) as unknown as KatanaVariant[];
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const products = collectLiveProducts(variants);
  const skuByVariant = new Map<number, string>();
  for (const p of products) skuByVariant.set(p.variantId, p.sku);
  console.log(`  live product SKUs: ${products.length}`);
  console.log("");

  console.log("→ Fetching live recipes / bom_rows");
  await delay(REQUEST_DELAY_MS);
  let recipePayload: Record<string, unknown>[] = [];
  try {
    recipePayload = await paginateKatana("/recipes", "recipes");
  } catch (err) {
    console.warn(
      `  /recipes failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await delay(REQUEST_DELAY_MS);
  let bomPayload: Record<string, unknown>[] = [];
  try {
    bomPayload = await paginateKatana("/bom_rows", "bom_rows");
  } catch (err) {
    console.warn(
      `  /bom_rows failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const recipeByVariant = mergeCounts(
    countByVariantId(bomPayload, skuByVariant),
    countByVariantId(recipePayload, skuByVariant),
  );
  console.log(
    `  BOM/recipe parent hits: ${[...recipeByVariant.values()].reduce((a, b) => a + b, 0)}`,
  );
  console.log("");

  console.log("→ Fetching live /product_operation_rows");
  const opPayload = await loadProductOperationRows({
    variantIds: products.map((p) => p.variantId),
  });
  if (opPayload.length === 0) {
    throw new Error(
      "FATAL: /product_operation_rows returned 0 rows. Refusing to classify every SKU as missing_ops.",
    );
  }
  const ops = countOperations(opPayload);
  console.log(`  operation rows ingested: ${opPayload.length}`);
  console.log("");

  const classified: Array<
    CostGapClassification & {
      name: string;
      variantId: number;
      productId: number;
      purchasePrice: number | null;
    }
  > = [];

  let scanned = 0;
  for (const product of products) {
    const row = classifyKatanaCostGap({
      sku: product.sku,
      name: product.name,
      recipeRowCount: recipeByVariant.get(product.variantId) ?? 0,
      operationRowCount: operationRowCount(product, ops),
    });
    if (row.family === "other") continue;
    if (limit != null && scanned >= limit) break;
    scanned += 1;
    classified.push({
      ...row,
      name: product.name,
      variantId: product.variantId,
      productId: product.productId,
      purchasePrice: product.purchasePrice,
    });
  }

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const outPath = join(tmpDir, `katana-cost-gaps-${stamp()}.csv`);
  writeAuditCsv(outPath, classified);

  const sum = summarizeCostGaps(classified);

  console.log("========== GATE ==========");
  console.log(`  in-scope FIN/FRAME/CUSH: ${sum.inScope}`);
  console.log(`  FIN-*                  : ${sum.fin}`);
  console.log(`    ok_recipe (has BOM)  : ${sum.finOkRecipe}`);
  console.log(`    ops_only (no BOM)    : ${sum.finOpsOnly}`);
  console.log(`    empty (no BOM/ops)   : ${sum.finEmpty}`);
  console.log(`  SA/ASM-*-FRAME         : ${sum.frame}`);
  console.log(`    ok_recipe            : ${sum.frameOkRecipe}`);
  console.log(`    frame_rm_no_ops      : ${sum.frameRmNoOps}`);
  console.log(`    ops_only             : ${sum.frameOpsOnly}`);
  console.log(`    empty                : ${sum.frameEmpty}`);
  console.log(`    missing_ops          : ${sum.frameMissingOps}`);
  console.log(`  *-CUSH / CUSHION       : ${sum.cush}`);
  console.log(`    ok_recipe            : ${sum.cushOkRecipe}`);
  console.log(`    cush_no_rm           : ${sum.cushNoRm}`);
  console.log(`    missing_ops          : ${sum.cushMissingOps}`);
  console.log("==========================");
  console.log("");
  if (sum.finOkRecipe === 0 && (sum.finOpsOnly > 0 || sum.finEmpty > 0)) {
    console.log(
      "Gate: FIN recipes look wiped (empty/ops-only). Do NOT re-wipe FINs.",
    );
  } else if (sum.finOkRecipe > 0) {
    console.log(
      `Gate: ${sum.finOkRecipe} FIN-* still have BOM rows — inspect before any wipe.`,
    );
  }
  console.log(`Wrote: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
