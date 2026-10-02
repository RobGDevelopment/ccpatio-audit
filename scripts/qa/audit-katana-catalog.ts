/**
 * Read-only Katana catalog diagnostic.
 *
 * Fetches Products + Materials + Variants, then recipes/bom_rows + operations.
 * Reports duplicate SKUs/names, recipe attachment rates, and FIN/SA vs legacy.
 *
 * Does NOT mutate Katana or Postgres.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/qa/audit-katana-catalog.ts
 *   npm run qa:audit-katana-catalog
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";

loadEnvConfig(process.cwd());

const REQUEST_DELAY_MS = 1100;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type KatanaProduct = {
  id: number;
  name?: string | null;
  category_name?: string | null;
  type?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  variants?: Array<{ id: number; sku?: string | null }>;
};

type KatanaVariant = {
  id: number;
  sku?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  type?: string | null;
  deleted_at?: string | null;
  sales_price?: number | null;
  purchase_price?: number | null;
};

type RecipeRow = {
  product_variant_id?: number;
  ingredient_variant_id?: number;
};

type OpRow = {
  product_id?: number | null;
  product_variant_id?: number | null;
  variant_id?: number | null;
};

type Namespace =
  | "FIN"
  | "SA"
  | "RM"
  | "legacy_BRA_OCE_BRO_DBT"
  | "legacy_D"
  | "other";

type AuditRow = {
  variantId: number;
  sku: string;
  itemName: string;
  category: string;
  kind: "product" | "material" | "unknown";
  namespace: Namespace;
  productId: number | null;
  materialId: number | null;
  hasRecipe: boolean;
  recipeRowCount: number;
  hasOperations: boolean;
  operationRowCount: number;
  duplicateSku: boolean;
  duplicateName: boolean;
};

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as T[]) : [];
}

function csvEscape(value: string | number | boolean): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function normalizeName(name: string): string {
  return name
    .replace(/[""\u2033'']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function classifyNamespace(sku: string): Namespace {
  const s = sku.trim().toUpperCase();
  if (s.startsWith("FIN-")) return "FIN";
  if (s.startsWith("SA-")) return "SA";
  if (s.startsWith("RM-")) return "RM";
  if (/^(BRA-|OCE-|OCN-|BRO-|DBT-)/.test(s)) return "legacy_BRA_OCE_BRO_DBT";
  if (/^D-/.test(s) || /^D\d/.test(s)) return "legacy_D";
  return "other";
}

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 100;
  for (let page = 1; page <= 100; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${pageSize}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    process.stdout.write(`  ${label} page ${page}: ${rows.length}\n`);
    if (rows.length < pageSize) break;
    await delay(REQUEST_DELAY_MS);
  }
  return all;
}

async function loadBomParents(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  try {
    const rows = await paginate<RecipeRow>("/bom_rows", "bom_rows");
    for (const row of rows) {
      const parent = Number(row.product_variant_id);
      if (!Number.isFinite(parent) || parent <= 0) continue;
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
  } catch (error: unknown) {
    console.warn(
      `  bom_rows unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return counts;
}

async function loadRecipeParents(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  try {
    const rows = await paginate<RecipeRow>("/recipes", "recipes");
    for (const row of rows) {
      const parent = Number(row.product_variant_id);
      if (!Number.isFinite(parent) || parent <= 0) continue;
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
  } catch (error: unknown) {
    console.warn(
      `  recipes unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return counts;
}

async function loadOperationCounts(input: {
  productIds: Set<number>;
  variantIds: Set<number>;
}): Promise<{ byVariant: Map<number, number>; byProduct: Map<number, number> }> {
  const byVariant = new Map<number, number>();
  const byProduct = new Map<number, number>();
  try {
    const rows = await paginate<OpRow>(
      "/product_operation_rows",
      "product_operation_rows",
    );
    for (const row of rows) {
      const variantId =
        Number(row.product_variant_id ?? row.variant_id ?? NaN) || null;
      const productId = Number(row.product_id ?? NaN) || null;
      if (variantId && input.variantIds.has(variantId)) {
        byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + 1);
      }
      if (productId && input.productIds.has(productId)) {
        byProduct.set(productId, (byProduct.get(productId) ?? 0) + 1);
      }
    }
  } catch (error: unknown) {
    console.warn(
      `  product_operation_rows unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { byVariant, byProduct };
}

function mergeCounts(
  a: Map<number, number>,
  b: Map<number, number>,
): Map<number, number> {
  const out = new Map(a);
  for (const [k, v] of b) {
    out.set(k, Math.max(out.get(k) ?? 0, v));
  }
  return out;
}

async function main(): Promise<void> {
  console.log("Katana catalog audit (READ-ONLY)\n");

  console.log("Fetching catalog…");
  const products = await paginate<KatanaProduct>("/products", "products");
  await delay(REQUEST_DELAY_MS);
  const materials = await paginate<KatanaProduct>("/materials", "materials");
  await delay(REQUEST_DELAY_MS);
  const variants = await paginate<KatanaVariant>("/variants", "variants");

  const activeProducts = products.filter((p) => !p.deleted_at && !p.archived_at);
  const activeMaterials = materials.filter(
    (p) => !p.deleted_at && !(p as { archived_at?: string | null }).archived_at,
  );
  const activeVariants = variants.filter((v) => !v.deleted_at);

  const nameByProductId = new Map<number, { name: string; category: string }>();
  for (const p of [...activeProducts, ...activeMaterials]) {
    nameByProductId.set(p.id, {
      name: (p.name ?? "").trim(),
      category: (p.category_name ?? "").trim(),
    });
  }

  // Prefer product/material name from parent; fall back to SKU
  const productIds = new Set(
    activeVariants
      .map((v) => v.product_id)
      .filter((id): id is number => id != null && id > 0),
  );
  const variantIds = new Set(activeVariants.map((v) => v.id));

  console.log("\nFetching recipes / BOM / operations…");
  const bomParents = await loadBomParents();
  await delay(REQUEST_DELAY_MS);
  const recipeParents = await loadRecipeParents();
  await delay(REQUEST_DELAY_MS);
  const recipeCounts = mergeCounts(bomParents, recipeParents);
  const ops = await loadOperationCounts({ productIds, variantIds });

  // Duplicate detection
  const bySku = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  for (const v of activeVariants) {
    const sku = (v.sku ?? "").trim().toUpperCase();
    if (sku) {
      const list = bySku.get(sku) ?? [];
      list.push(v.id);
      bySku.set(sku, list);
    }
    const parent =
      (v.product_id != null ? nameByProductId.get(v.product_id) : null) ??
      (v.material_id != null ? nameByProductId.get(v.material_id) : null);
    const nameKey = normalizeName(parent?.name ?? "");
    if (nameKey) {
      const list = byName.get(nameKey) ?? [];
      list.push(v.id);
      byName.set(nameKey, list);
    }
  }

  const duplicateSkuIds = new Set<number>();
  const duplicateSkuList: string[] = [];
  for (const [sku, ids] of bySku) {
    if (ids.length > 1) {
      duplicateSkuList.push(`${sku} (${ids.length} variants: ${ids.join(",")})`);
      for (const id of ids) duplicateSkuIds.add(id);
    }
  }

  const duplicateNameList: string[] = [];
  const duplicateNameIds = new Set<number>();
  for (const [name, ids] of byName) {
    // Same product with many color variants shares one name — only flag when
    // the same normalized name spans multiple product/material parents.
    const parentKeys = new Set<string>();
    for (const id of ids) {
      const v = activeVariants.find((x) => x.id === id);
      if (!v) continue;
      parentKeys.add(
        v.product_id != null
          ? `p:${v.product_id}`
          : v.material_id != null
            ? `m:${v.material_id}`
            : `v:${v.id}`,
      );
    }
    if (parentKeys.size > 1) {
      duplicateNameList.push(
        `${name} (${parentKeys.size} parents, ${ids.length} variants)`,
      );
      for (const id of ids) duplicateNameIds.add(id);
    }
  }

  const auditRows: AuditRow[] = [];
  for (const v of activeVariants) {
    const sku = (v.sku ?? "").trim();
    const kind: AuditRow["kind"] =
      v.type === "material" || (v.material_id != null && v.product_id == null)
        ? "material"
        : v.product_id != null
          ? "product"
          : "unknown";
    const parentMeta =
      (v.product_id != null ? nameByProductId.get(v.product_id) : null) ??
      (v.material_id != null ? nameByProductId.get(v.material_id) : null);
    const recipeRowCount = recipeCounts.get(v.id) ?? 0;
    const opFromVariant = ops.byVariant.get(v.id) ?? 0;
    const opFromProduct =
      v.product_id != null ? (ops.byProduct.get(v.product_id) ?? 0) : 0;
    const operationRowCount = Math.max(opFromVariant, opFromProduct);

    auditRows.push({
      variantId: v.id,
      sku,
      itemName: parentMeta?.name ?? "",
      category: parentMeta?.category ?? "",
      kind,
      namespace: classifyNamespace(sku),
      productId: v.product_id ?? null,
      materialId: v.material_id ?? null,
      hasRecipe: recipeRowCount > 0,
      recipeRowCount,
      hasOperations: operationRowCount > 0,
      operationRowCount,
      duplicateSku: duplicateSkuIds.has(v.id),
      duplicateName: duplicateNameIds.has(v.id),
    });
  }

  const productVariants = auditRows.filter((r) => r.kind === "product");
  const materialVariants = auditRows.filter((r) => r.kind === "material");
  const withRecipe = auditRows.filter((r) => r.hasRecipe);
  const noRecipe = auditRows.filter((r) => !r.hasRecipe);
  const withOps = auditRows.filter((r) => r.hasOperations);

  const recipeByNs: Record<string, number> = {};
  const allByNs: Record<string, number> = {};
  for (const row of auditRows) {
    allByNs[row.namespace] = (allByNs[row.namespace] ?? 0) + 1;
  }
  for (const row of withRecipe) {
    recipeByNs[row.namespace] = (recipeByNs[row.namespace] ?? 0) + 1;
  }

  const hubRecipe =
    (recipeByNs.FIN ?? 0) + (recipeByNs.SA ?? 0) + (recipeByNs.RM ?? 0);
  const legacyRecipe =
    (recipeByNs.legacy_BRA_OCE_BRO_DBT ?? 0) +
    (recipeByNs.legacy_D ?? 0) +
    (recipeByNs.other ?? 0);

  // CSV
  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, "katana-catalog-audit.csv");
  const headers = [
    "Variant ID",
    "SKU",
    "Item Name",
    "Category",
    "Kind",
    "Namespace",
    "Product ID",
    "Material ID",
    "Has Recipe",
    "Recipe Row Count",
    "Has Operations",
    "Operation Row Count",
    "Duplicate SKU",
    "Duplicate Name",
  ];
  const lines = [
    headers.join(","),
    ...auditRows
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map((r) =>
        [
          r.variantId,
          r.sku,
          r.itemName,
          r.category,
          r.kind,
          r.namespace,
          r.productId ?? "",
          r.materialId ?? "",
          r.hasRecipe,
          r.recipeRowCount,
          r.hasOperations,
          r.operationRowCount,
          r.duplicateSku,
          r.duplicateName,
        ]
          .map(csvEscape)
          .join(","),
      ),
  ];
  writeFileSync(csvPath, lines.join("\n"), "utf8");

  // Terminal summary
  console.log("\n========================================");
  console.log("  KATANA CATALOG AUDIT SUMMARY");
  console.log("========================================");
  console.log(`  Active products (parents):   ${activeProducts.length}`);
  console.log(`  Active materials (parents):  ${activeMaterials.length}`);
  console.log(`  Total active variants:       ${auditRows.length}`);
  console.log(`    · product-typed:           ${productVariants.length}`);
  console.log(`    · material-typed:          ${materialVariants.length}`);
  console.log("----------------------------------------");
  console.log(`  Variants WITH recipes/BOM:   ${withRecipe.length}`);
  console.log(`  Variants WITHOUT recipes:    ${noRecipe.length}`);
  console.log(
    `  Recipe coverage:              ${auditRows.length ? ((withRecipe.length / auditRows.length) * 100).toFixed(1) : "0"}%`,
  );
  console.log(`  Variants WITH operations:    ${withOps.length}`);
  console.log("----------------------------------------");
  console.log("  All variants by namespace:");
  for (const key of [
    "FIN",
    "SA",
    "RM",
    "legacy_BRA_OCE_BRO_DBT",
    "legacy_D",
    "other",
  ] as const) {
    console.log(`    ${key.padEnd(24)} ${allByNs[key] ?? 0}`);
  }
  console.log("  Variants WITH recipes by namespace:");
  for (const key of [
    "FIN",
    "SA",
    "RM",
    "legacy_BRA_OCE_BRO_DBT",
    "legacy_D",
    "other",
  ] as const) {
    console.log(`    ${key.padEnd(24)} ${recipeByNs[key] ?? 0}`);
  }
  console.log(
    `  Recipe owners Hub (FIN/SA/RM): ${hubRecipe}`,
  );
  console.log(
    `  Recipe owners Legacy/other:    ${legacyRecipe}`,
  );
  console.log("----------------------------------------");
  console.log(`  Duplicate SKU groups:        ${duplicateSkuList.length}`);
  if (duplicateSkuList.length === 0) {
    console.log("    (none)");
  } else {
    for (const line of duplicateSkuList.slice(0, 40)) {
      console.log(`    · ${line}`);
    }
    if (duplicateSkuList.length > 40) {
      console.log(`    … +${duplicateSkuList.length - 40} more (see CSV)`);
    }
  }
  console.log(
    `  Duplicate names (multi-parent): ${duplicateNameList.length}`,
  );
  if (duplicateNameList.length === 0) {
    console.log("    (none)");
  } else {
    for (const line of duplicateNameList.slice(0, 40)) {
      console.log(`    · ${line}`);
    }
    if (duplicateNameList.length > 40) {
      console.log(`    … +${duplicateNameList.length - 40} more (see CSV)`);
    }
  }
  console.log("----------------------------------------");
  console.log(`  CSV → ${csvPath}`);
  console.log("========================================\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
