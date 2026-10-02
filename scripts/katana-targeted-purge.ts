/**
 * Option A — Targeted Katana ghost purge.
 *
 * Protects BRA-*, OCE-*, OCN-*, BRO-*, DBT-* products and their recipes.
 * Deletes only sandbox/QA transactional ghosts and miscategorized Hub RM
 * products (plus unused D-* after BOM-child gate).
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/katana-targeted-purge.ts
 *   npx dotenv -e .env.local -- tsx scripts/katana-targeted-purge.ts --confirm-sandbox-txns
 *   npx dotenv -e .env.local -- tsx scripts/katana-targeted-purge.ts --confirm-product-purge
 *   npx dotenv -e .env.local -- tsx scripts/katana-targeted-purge.ts --confirm-sandbox-txns --confirm-product-purge
 *
 * Dry-run is the default. Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY).
 * Optional Hub cleanup uses POSTGRES_URL when present.
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { katanaFetch } from "../src/lib/katana";
import {
  canDeleteProductSku,
  classifyKatanaSku,
  classifySalesOrder,
  isProductPurgeCandidate,
  isProtectedSku,
  isSandboxCustomerName,
  type SkuClass,
} from "../src/lib/katana-targeted-purge";
import { getDb, closeDb } from "../src/server/db/client";
import { sku_mappings } from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const confirmSandboxTxns = process.argv.includes("--confirm-sandbox-txns");
const confirmProductPurge = process.argv.includes("--confirm-product-purge");

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
  material_id?: number | null;
  deleted_at?: string | null;
};

type KatanaProduct = {
  id: number;
  name?: string | null;
  type?: string | null;
  variants?: Array<{ id: number; sku?: string | null }>;
};

type KatanaRecipeRow = {
  id: string;
  product_variant_id: number;
  ingredient_variant_id: number;
};

type KatanaBomRow = {
  id: string;
  product_variant_id: number;
  ingredient_variant_id: number;
};

type KatanaSalesOrder = {
  id: number;
  order_no?: string | null;
  customer_id?: number | null;
  customer?: { id?: number; name?: string | null } | null;
  sales_order_rows?: Array<{
    variant_id?: number | null;
    variant?: { sku?: string | null } | null;
  }>;
};

type KatanaManufacturingOrder = {
  id: number;
  order_no?: string | null;
  sales_order_id?: number | null;
  variant_id?: number | null;
  variant?: { sku?: string | null } | null;
};

type KatanaCustomer = {
  id: number;
  name?: string | null;
};

type InventoryRow = {
  sku: string;
  class: SkuClass;
  variantId: number;
  productId: number | null;
  isMaterial: boolean;
  referencedByProtectedParent: boolean;
  deleteAllowed: boolean;
  hubItemType: string | null;
  hubVariantId: number | null;
};

async function paginate<T>(
  pathBase: string,
  label: string,
): Promise<T[]> {
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

async function loadAllRecipes(): Promise<KatanaRecipeRow[]> {
  return paginate<KatanaRecipeRow>("/recipes", "recipes");
}

async function loadAllBomRows(): Promise<KatanaBomRow[]> {
  // Prefer unfiltered list; fall back empty if endpoint rejects.
  try {
    return await paginate<KatanaBomRow>("/bom_rows", "bom_rows");
  } catch (error: unknown) {
    console.warn(
      `  bom_rows list failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function loadVariants(): Promise<KatanaVariant[]> {
  return paginate<KatanaVariant>("/variants", "variants");
}

async function loadProducts(): Promise<KatanaProduct[]> {
  return paginate<KatanaProduct>("/products", "products");
}

async function loadMaterials(): Promise<Array<{ id: number; variants?: Array<{ id: number; sku?: string | null }> }>> {
  try {
    return await paginate("/materials", "materials");
  } catch {
    return [];
  }
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

async function clearHubKatanaIds(skus: string[]): Promise<void> {
  if (skus.length === 0) return;
  if (!process.env.POSTGRES_URL) {
    console.warn("  POSTGRES_URL missing — skip Hub katana id cleanup");
    return;
  }
  const db = getDb();
  const upper = skus.map((s) => s.trim().toUpperCase());
  await db
    .update(sku_mappings)
    .set({
      katana_variant_id: null,
      katana_material_id: null,
      updated_at: new Date(),
    })
    .where(inArray(sku_mappings.global_sku, upper));
  console.log(`  Cleared Hub Katana IDs for ${upper.length} SKU(s)`);
}

async function loadHubMeta(
  skus: string[],
): Promise<Map<string, { itemType: string; variantId: number | null }>> {
  const map = new Map<string, { itemType: string; variantId: number | null }>();
  if (!process.env.POSTGRES_URL || skus.length === 0) return map;
  try {
    const db = getDb();
    const upper = skus.map((s) => s.trim().toUpperCase());
    // Chunk to avoid oversized IN lists
    for (let i = 0; i < upper.length; i += 200) {
      const chunk = upper.slice(i, i + 200);
      const rows = await db
        .select({
          sku: sku_mappings.global_sku,
          itemType: sku_mappings.item_type,
          variantId: sku_mappings.katana_variant_id,
        })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, chunk));
      for (const row of rows) {
        map.set(row.sku.toUpperCase(), {
          itemType: row.itemType,
          variantId: row.variantId,
        });
      }
    }
  } catch (error: unknown) {
    console.warn(
      `  Hub meta load failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return map;
}

async function phaseSandboxTxns(
  targetSkus: ReadonlySet<string>,
): Promise<{ deletedSo: number; deletedMo: number; deletedCustomers: number }> {
  console.log("\n=== Phase 1 — sandbox transactional ghosts");

  const salesOrders = await paginate<KatanaSalesOrder>(
    "/sales_orders",
    "sales_orders",
  );
  await delay(REQUEST_DELAY_MS);
  const mos = await paginate<KatanaManufacturingOrder>(
    "/manufacturing_orders",
    "manufacturing_orders",
  );
  await delay(REQUEST_DELAY_MS);
  const customers = await paginate<KatanaCustomer>("/customers", "customers");

  let deletedSo = 0;
  let deletedMo = 0;
  let deletedCustomers = 0;

  const soCandidates: KatanaSalesOrder[] = [];
  for (const so of salesOrders) {
    const lineSkus = (so.sales_order_rows ?? []).map(
      (r) => r.variant?.sku ?? "",
    );
    const klass = classifySalesOrder({
      customerName: so.customer?.name,
      orderNo: so.order_no,
      lineSkus,
      targetSkus,
    });
    if (klass === "sandbox" || klass === "blocks_target_sku") {
      soCandidates.push(so);
      console.log(
        `  SO ${so.id} (${so.order_no ?? "?"}) → ${klass} [${lineSkus.filter(Boolean).join(", ") || "no skus"}]`,
      );
    } else if (klass === "protected") {
      console.log(
        `  SO ${so.id} PROTECTED — skip (contains BRA/OCE/… line)`,
      );
    }
  }

  const moCandidates = mos.filter((mo) => {
    const sku = mo.variant?.sku ?? "";
    if (isProtectedSku(sku)) return false;
    const c = classifyKatanaSku(sku);
    return (
      c === "qa" ||
      c === "sandbox" ||
      targetSkus.has(sku.trim().toUpperCase()) ||
      /qa-test|sandbox/i.test(mo.order_no ?? "")
    );
  });

  for (const mo of moCandidates) {
    console.log(
      `  MO ${mo.id} (${mo.order_no ?? "?"}) sku=${mo.variant?.sku ?? "?"}`,
    );
  }

  const customerCandidates = customers.filter((c) =>
    isSandboxCustomerName(c.name),
  );
  for (const c of customerCandidates) {
    console.log(`  Customer ${c.id} "${c.name}"`);
  }

  if (!confirmSandboxTxns) {
    console.log(
      `  DRY-RUN: would delete ${soCandidates.length} SO, ${moCandidates.length} MO, ${customerCandidates.length} customers`,
    );
    console.log("  Pass --confirm-sandbox-txns to delete.");
    return { deletedSo: 0, deletedMo: 0, deletedCustomers: 0 };
  }

  for (const mo of moCandidates) {
    try {
      await katanaFetch(`/manufacturing_orders/${mo.id}`, { method: "DELETE" });
      deletedMo += 1;
      console.log(`  DELETED MO ${mo.id}`);
    } catch (error: unknown) {
      console.warn(
        `  MO ${mo.id} delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  for (const so of soCandidates) {
    try {
      await katanaFetch(`/sales_orders/${so.id}`, { method: "DELETE" });
      deletedSo += 1;
      console.log(`  DELETED SO ${so.id}`);
    } catch (error: unknown) {
      console.warn(
        `  SO ${so.id} delete failed (cancel in UI if Done): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  for (const c of customerCandidates) {
    try {
      await katanaFetch(`/customers/${c.id}`, { method: "DELETE" });
      deletedCustomers += 1;
      console.log(`  DELETED customer ${c.id}`);
    } catch (error: unknown) {
      console.warn(
        `  Customer ${c.id} delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  return { deletedSo, deletedMo, deletedCustomers };
}

async function phaseProductInventory(): Promise<{
  inventory: InventoryRow[];
  deleted: InventoryRow[];
}> {
  console.log("\n=== Phase 2 — product inventory + targeted purge");

  const variants = await loadVariants();
  await delay(REQUEST_DELAY_MS);
  const products = await loadProducts();
  await delay(REQUEST_DELAY_MS);
  const materials = await loadMaterials();
  await delay(REQUEST_DELAY_MS);
  const recipes = await loadAllRecipes();
  await delay(REQUEST_DELAY_MS);
  const bomRows = await loadAllBomRows();

  const materialVariantIds = new Set<number>();
  for (const m of materials) {
    for (const v of m.variants ?? []) {
      materialVariantIds.add(v.id);
    }
  }

  const protectedVariantIds = new Set<number>();
  for (const v of variants) {
    if (v.sku && isProtectedSku(v.sku)) protectedVariantIds.add(v.id);
  }

  /** ingredient variant id → referenced by a protected parent */
  const protectedIngredientRefs = new Set<number>();
  for (const row of recipes) {
    if (protectedVariantIds.has(row.product_variant_id)) {
      protectedIngredientRefs.add(row.ingredient_variant_id);
    }
  }
  for (const row of bomRows) {
    if (protectedVariantIds.has(row.product_variant_id)) {
      protectedIngredientRefs.add(row.ingredient_variant_id);
    }
  }

  const candidateSkus = variants
    .map((v) => v.sku?.trim().toUpperCase() ?? "")
    .filter((s) => s && isProductPurgeCandidate(s));
  const hubMeta = await loadHubMeta(candidateSkus);

  const inventory: InventoryRow[] = [];
  for (const v of variants) {
    const sku = v.sku?.trim().toUpperCase() ?? "";
    if (!sku) continue;
    const klass = classifyKatanaSku(sku);
    if (klass === "protected" || klass === "other") {
      // Still record hub_rm/qa/d/sandbox only in inventory CSV for operators.
      if (!isProductPurgeCandidate(sku)) continue;
    }
    const isMaterial =
      materialVariantIds.has(v.id) ||
      (v.material_id != null && v.product_id == null);
    const referencedByProtectedParent = protectedIngredientRefs.has(v.id);
    const deleteAllowed =
      !isMaterial &&
      canDeleteProductSku({ sku, referencedByProtectedParent });
    const hub = hubMeta.get(sku);
    inventory.push({
      sku,
      class: klass,
      variantId: v.id,
      productId: v.product_id,
      isMaterial,
      referencedByProtectedParent,
      deleteAllowed,
      hubItemType: hub?.itemType ?? null,
      hubVariantId: hub?.variantId ?? null,
    });
  }

  // Also surface products that only appear under /products
  for (const p of products) {
    for (const pv of p.variants ?? []) {
      const sku = pv.sku?.trim().toUpperCase() ?? "";
      if (!sku || !isProductPurgeCandidate(sku)) continue;
      if (inventory.some((r) => r.variantId === pv.id)) continue;
      const referencedByProtectedParent = protectedIngredientRefs.has(pv.id);
      inventory.push({
        sku,
        class: classifyKatanaSku(sku),
        variantId: pv.id,
        productId: p.id,
        isMaterial: false,
        referencedByProtectedParent,
        deleteAllowed: canDeleteProductSku({
          sku,
          referencedByProtectedParent,
        }),
        hubItemType: hubMeta.get(sku)?.itemType ?? null,
        hubVariantId: hubMeta.get(sku)?.variantId ?? null,
      });
    }
  }

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inventoryPath = join(outDir, `katana-targeted-purge-inventory-${stamp}.csv`);
  writeCsv(
    inventoryPath,
    [
      "sku",
      "class",
      "variant_id",
      "product_id",
      "is_material",
      "referenced_by_protected_parent",
      "delete_allowed",
      "hub_item_type",
      "hub_variant_id",
    ],
    inventory.map((r) => [
      r.sku,
      r.class,
      String(r.variantId),
      r.productId == null ? "" : String(r.productId),
      String(r.isMaterial),
      String(r.referencedByProtectedParent),
      String(r.deleteAllowed),
      r.hubItemType ?? "",
      r.hubVariantId == null ? "" : String(r.hubVariantId),
    ]),
  );
  console.log(`  Wrote inventory → ${inventoryPath}`);
  console.log(
    `  Candidates: ${inventory.length}; delete_allowed: ${inventory.filter((r) => r.deleteAllowed).length}`,
  );

  const toDelete = inventory.filter((r) => r.deleteAllowed);
  if (!confirmProductPurge) {
    console.log(
      `  DRY-RUN: would delete ${toDelete.length} product(s). Pass --confirm-product-purge.`,
    );
    for (const row of toDelete.slice(0, 40)) {
      console.log(
        `    would DELETE product ${row.productId} variant ${row.variantId} ${row.sku} (${row.class})`,
      );
    }
    if (toDelete.length > 40) {
      console.log(`    … +${toDelete.length - 40} more`);
    }
    return { inventory, deleted: [] };
  }

  const deleted: InventoryRow[] = [];
  const deletedProductIds = new Set<number>();

  for (const row of toDelete) {
    if (row.productId == null) {
      console.warn(`  skip ${row.sku}: no product_id`);
      continue;
    }
    if (deletedProductIds.has(row.productId)) {
      deleted.push(row);
      continue;
    }
    if (isProtectedSku(row.sku)) {
      console.error(`  ABORT: refused protected SKU ${row.sku}`);
      continue;
    }
    try {
      await katanaFetch(`/products/${row.productId}`, { method: "DELETE" });
      deletedProductIds.add(row.productId);
      deleted.push(row);
      console.log(`  DELETED product ${row.productId} (${row.sku})`);
    } catch (error: unknown) {
      console.warn(
        `  product ${row.productId} (${row.sku}) delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  const deletedPath = join(outDir, `katana-targeted-purge-deleted-${stamp}.csv`);
  writeCsv(
    deletedPath,
    ["sku", "class", "variant_id", "product_id"],
    deleted.map((r) => [
      r.sku,
      r.class,
      String(r.variantId),
      r.productId == null ? "" : String(r.productId),
    ]),
  );
  console.log(`  Wrote deleted → ${deletedPath}`);

  if (deleted.length > 0) {
    await clearHubKatanaIds(deleted.map((r) => r.sku));
  }

  return { inventory, deleted };
}

async function main(): Promise<void> {
  console.log("Katana targeted purge (Option A)");
  console.log(
    `  flags: confirm-sandbox-txns=${confirmSandboxTxns} confirm-product-purge=${confirmProductPurge}`,
  );

  // Seed target SKUs with known live-fire Hub RMs (products tab ghosts).
  const targetSkus = new Set([
    "RM-DKT-GENERIC-SLAB",
    "RM-MET-2X1-TUBING",
    "RM-MET-2X2-TUBING",
    "RM-PWD-GENERIC",
  ]);

  const txn = await phaseSandboxTxns(targetSkus);
  const { deleted } = await phaseProductInventory();

  console.log("\n=== Summary");
  console.log(
    `  SO deleted: ${txn.deletedSo}; MO deleted: ${txn.deletedMo}; customers deleted: ${txn.deletedCustomers}`,
  );
  console.log(`  Products deleted: ${deleted.length}`);
  console.log(
    "  Next: migrate 0025 + dictionary Type column → re-approve RM-* → POST /materials",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
  });
