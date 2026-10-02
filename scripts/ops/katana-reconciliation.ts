/**
 * Hub ↔ Katana reconciliation after adopting the ASM-/CUT- prefix standard.
 *
 * Phase 1 — Katana purge: DELETE empty/orphan SA-* products ONLY.
 *   Filter: sku starts with SA-
 *           created_at within the last 24 hours
 *           zero /recipes children AND zero /bom_rows children
 *   No fuzzy matching to existing Katana items.
 *
 * Phase 2 — Hub wipe: delete archetype clone rows from product_bom and
 *   product_bom_draft (notes `archetype clone from …`). Also drops clone-minted
 *   SA-* sku_mappings (source_file=archetype_clone) and their operations so
 *   `ops:clone-archetype-boms` can remint ASM-* shells.
 *
 * Dry-run is the default. Writes require explicit confirm flags.
 *
 *   npm run ops:katana-reconciliation
 *   npm run ops:katana-reconciliation -- --dry-run
 *   npm run ops:katana-reconciliation -- --confirm-katana-purge
 *   npm run ops:katana-reconciliation -- --confirm-hub-wipe
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, like, or } from "drizzle-orm";
import { katanaFetch } from "../../src/lib/katana";
import {
  ARCHETYPE_CLONE_NOTE_PREFIX,
  ARCHETYPE_CLONE_SOURCE_FILE,
  isKatanaSaOrphanCandidate,
} from "../../src/lib/katana-reconciliation";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirmKatanaPurge =
  process.argv.includes("--confirm-katana-purge") && !explicitDryRun;
const confirmHubWipe =
  process.argv.includes("--confirm-hub-wipe") && !explicitDryRun;

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
  created_at?: string | null;
  deleted_at?: string | null;
  type?: string | null;
};

type KatanaProduct = {
  id: number;
  name?: string | null;
  type?: string | null;
  created_at?: string | null;
  variants?: Array<{
    id: number;
    sku?: string | null;
    created_at?: string | null;
  }>;
};

type KatanaRecipeRow = {
  id: string | number;
  product_variant_id: number;
  ingredient_variant_id: number;
};

type KatanaBomRow = {
  id: string | number;
  product_variant_id: number;
  ingredient_variant_id: number;
};

type OrphanRow = {
  sku: string;
  variantId: number;
  productId: number | null;
  createdAt: string;
  recipeChildCount: number;
  bomChildCount: number;
  isMaterial: boolean;
  deleteAllowed: boolean;
  skipReason: string;
};

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

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

function countByParent(
  rows: Array<{ product_variant_id: number }>,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) {
    const id = Number(row.product_variant_id);
    if (!Number.isFinite(id)) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

async function phaseKatanaPurge(now: Date): Promise<{
  scanned: number;
  candidates: OrphanRow[];
  deleted: OrphanRow[];
}> {
  console.log("\n=== Phase 1 — Katana SA- empty/orphan purge");
  console.log("  filter: SA-* AND created_at <= 24h AND 0 recipe + 0 bom_rows");
  console.log("  no fuzzy matching to existing catalog items");

  const variants = await paginate<KatanaVariant>("/variants", "variants");
  await delay(REQUEST_DELAY_MS);
  const products = await paginate<KatanaProduct>("/products", "products");
  await delay(REQUEST_DELAY_MS);
  const recipes = await paginate<KatanaRecipeRow>("/recipes", "recipes");
  await delay(REQUEST_DELAY_MS);
  let bomRows: KatanaBomRow[] = [];
  try {
    bomRows = await paginate<KatanaBomRow>("/bom_rows", "bom_rows");
  } catch (error: unknown) {
    console.warn(
      `  bom_rows list failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const recipeCounts = countByParent(recipes);
  const bomCounts = countByParent(bomRows);

  const productCreated = new Map<number, string>();
  const variantsByProduct = new Map<number, number[]>();
  for (const p of products) {
    if (p.created_at) productCreated.set(p.id, p.created_at);
    const ids = variantsByProduct.get(p.id) ?? [];
    for (const v of p.variants ?? []) ids.push(v.id);
    variantsByProduct.set(p.id, ids);
  }

  const seen = new Set<number>();
  const inventory: OrphanRow[] = [];

  const consider = (
    skuRaw: string | null | undefined,
    variantId: number,
    productId: number | null,
    createdAtRaw: string | null | undefined,
    isMaterial: boolean,
  ) => {
    if (seen.has(variantId)) return;
    seen.add(variantId);
    const sku = (skuRaw ?? "").trim().toUpperCase();
    if (!sku.startsWith("SA-")) return;
    const createdAt =
      createdAtRaw ||
      (productId != null ? productCreated.get(productId) : undefined) ||
      "";
    const recipeChildCount = recipeCounts.get(variantId) ?? 0;
    const bomChildCount = bomCounts.get(variantId) ?? 0;
    const deleteAllowed = isKatanaSaOrphanCandidate({
      sku,
      createdAt: createdAt || null,
      recipeChildCount,
      bomChildCount,
      isMaterial,
      now,
    });
    let skipReason = "";
    if (isMaterial) skipReason = "material";
    else if (!createdAt) skipReason = "missing_created_at";
    else if (recipeChildCount > 0 || bomChildCount > 0) {
      skipReason = `has_children recipe=${recipeChildCount} bom=${bomChildCount}`;
    } else if (!deleteAllowed) skipReason = "older_than_24h";
    inventory.push({
      sku,
      variantId,
      productId,
      createdAt,
      recipeChildCount,
      bomChildCount,
      isMaterial,
      deleteAllowed,
      skipReason,
    });
  };

  for (const v of variants) {
    if (v.deleted_at) continue;
    const isMaterial =
      v.material_id != null && (v.product_id == null || v.type === "material");
    consider(
      v.sku,
      v.id,
      v.product_id,
      v.created_at,
      isMaterial,
    );
  }

  for (const p of products) {
    for (const pv of p.variants ?? []) {
      consider(pv.sku, pv.id, p.id, pv.created_at ?? p.created_at, false);
    }
  }

  // Refuse to DELETE a product that still has a non-candidate sibling variant.
  const blockedProductIds = new Set<number>();
  for (const row of inventory.filter((r) => r.deleteAllowed)) {
    if (row.productId == null) continue;
    const siblingIds = variantsByProduct.get(row.productId) ?? [];
    const siblingOk = siblingIds.every((id) => {
      if (id === row.variantId) return true;
      const sib = inventory.find((r) => r.variantId === id);
      return sib?.deleteAllowed === true;
    });
    if (!siblingOk && siblingIds.length > 1) {
      blockedProductIds.add(row.productId);
      row.deleteAllowed = false;
      row.skipReason = "sibling_variant_not_orphan";
    }
  }

  const toDelete = inventory.filter((r) => r.deleteAllowed);

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const inventoryPath = join(outDir, `katana-sa-orphan-inventory-${stamp}.csv`);
  writeCsv(
    inventoryPath,
    [
      "sku",
      "variant_id",
      "product_id",
      "created_at",
      "recipe_children",
      "bom_children",
      "is_material",
      "delete_allowed",
      "skip_reason",
    ],
    inventory.map((r) => [
      r.sku,
      String(r.variantId),
      r.productId == null ? "" : String(r.productId),
      r.createdAt,
      String(r.recipeChildCount),
      String(r.bomChildCount),
      String(r.isMaterial),
      String(r.deleteAllowed),
      r.skipReason,
    ]),
  );
  console.log(`  Wrote inventory → ${inventoryPath}`);
  console.log(
    `  SA-* scanned: ${inventory.length}; purge candidates: ${toDelete.length}` +
      (blockedProductIds.size
        ? `; blocked mixed products: ${blockedProductIds.size}`
        : ""),
  );

  if (!confirmKatanaPurge) {
    console.log(
      `  DRY-RUN: would DELETE ${toDelete.length} empty SA-* product(s). Pass --confirm-katana-purge.`,
    );
    for (const row of toDelete.slice(0, 40)) {
      console.log(
        `    would DELETE product ${row.productId} variant ${row.variantId} ${row.sku} created=${row.createdAt}`,
      );
    }
    if (toDelete.length > 40) {
      console.log(`    … +${toDelete.length - 40} more`);
    }
    return { scanned: inventory.length, candidates: toDelete, deleted: [] };
  }

  const deleted: OrphanRow[] = [];
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
    if (!row.sku.startsWith("SA-")) {
      console.error(`  ABORT: refused non-SA SKU ${row.sku}`);
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

  const deletedPath = join(outDir, `katana-sa-orphan-deleted-${stamp}.csv`);
  writeCsv(
    deletedPath,
    ["sku", "variant_id", "product_id", "created_at"],
    deleted.map((r) => [
      r.sku,
      String(r.variantId),
      r.productId == null ? "" : String(r.productId),
      r.createdAt,
    ]),
  );
  console.log(`  Wrote deleted → ${deletedPath}`);
  return { scanned: inventory.length, candidates: toDelete, deleted };
}

async function phaseHubWipe(): Promise<{
  liveBom: number;
  draftBom: number;
  liveOps: number;
  draftOps: number;
  skuMappings: number;
}> {
  console.log("\n=== Phase 2 — Hub wipe of archetype clone rows");
  const db = getDb();
  const notePattern = `${ARCHETYPE_CLONE_NOTE_PREFIX}%`;

  const liveRows = await db
    .select({
      id: product_bom.id,
      parent: product_bom.parent_sku,
      child: product_bom.child_sku,
      notes: product_bom.notes,
    })
    .from(product_bom)
    .where(like(product_bom.notes, notePattern));

  const draftRows = await db
    .select({
      id: product_bom_draft.id,
      parent: product_bom_draft.parent_sku,
      child: product_bom_draft.child_sku,
      notes: product_bom_draft.notes,
    })
    .from(product_bom_draft)
    .where(like(product_bom_draft.notes, notePattern));

  const cloneSkus = await db
    .select({
      sku: sku_mappings.global_sku,
      itemType: sku_mappings.item_type,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.source_file, ARCHETYPE_CLONE_SOURCE_FILE));

  const cloneSkuList = cloneSkus.map((r) => r.sku);

  console.log(`  product_bom clone edges: ${liveRows.length}`);
  console.log(`  product_bom_draft clone edges: ${draftRows.length}`);
  console.log(`  sku_mappings source_file=${ARCHETYPE_CLONE_SOURCE_FILE}: ${cloneSkuList.length}`);

  for (const row of liveRows.slice(0, 15)) {
    console.log(`    live ${row.parent} → ${row.child}`);
  }
  if (liveRows.length > 15) console.log(`    … +${liveRows.length - 15} more live`);

  if (!confirmHubWipe) {
    console.log(
      "  DRY-RUN: would delete those BOM/draft edges, clone ops, and clone sku_mappings.",
    );
    console.log("  Pass --confirm-hub-wipe to write.");
    return {
      liveBom: liveRows.length,
      draftBom: draftRows.length,
      liveOps: 0,
      draftOps: 0,
      skuMappings: cloneSkuList.length,
    };
  }

  const liveBom =
    liveRows.length === 0
      ? []
      : await db
          .delete(product_bom)
          .where(like(product_bom.notes, notePattern))
          .returning({ id: product_bom.id });

  const draftBom =
    draftRows.length === 0
      ? []
      : await db
          .delete(product_bom_draft)
          .where(like(product_bom_draft.notes, notePattern))
          .returning({ id: product_bom_draft.id });

  let liveOps: Array<{ id: string }> = [];
  let draftOps: Array<{ id: string }> = [];
  if (cloneSkuList.length > 0) {
    liveOps = await db
      .delete(item_operations)
      .where(inArray(item_operations.item_sku, cloneSkuList))
      .returning({ id: item_operations.id });
    draftOps = await db
      .delete(item_operations_draft)
      .where(
        or(
          inArray(item_operations_draft.item_sku, cloneSkuList),
          like(item_operations_draft.notes, notePattern),
        ),
      )
      .returning({ id: item_operations_draft.id });
  }

  let deletedMappings: Array<{ sku: string }> = [];
  if (cloneSkuList.length > 0) {
    const remaining = [
      ...(await db
        .select({ sku: product_bom.parent_sku })
        .from(product_bom)
        .where(inArray(product_bom.parent_sku, cloneSkuList))),
      ...(await db
        .select({ sku: product_bom.child_sku })
        .from(product_bom)
        .where(inArray(product_bom.child_sku, cloneSkuList))),
      ...(await db
        .select({ sku: product_bom_draft.parent_sku })
        .from(product_bom_draft)
        .where(inArray(product_bom_draft.parent_sku, cloneSkuList))),
      ...(await db
        .select({ sku: product_bom_draft.child_sku })
        .from(product_bom_draft)
        .where(inArray(product_bom_draft.child_sku, cloneSkuList))),
    ];
    const blocked = new Set(remaining.map((r) => r.sku));
    const deletable = cloneSkuList.filter((s) => !blocked.has(s));
    if (blocked.size > 0) {
      console.warn(
        `  skip ${blocked.size} clone sku_mappings still referenced by BOM: ${[...blocked].slice(0, 8).join(", ")}`,
      );
    }
    if (deletable.length > 0) {
      deletedMappings = await db
        .delete(sku_mappings)
        .where(inArray(sku_mappings.global_sku, deletable))
        .returning({ sku: sku_mappings.global_sku });
    }
  }

  console.log(
    `  deleted live BOM ${liveBom.length}, draft BOM ${draftBom.length}, live ops ${liveOps.length}, draft ops ${draftOps.length}, sku_mappings ${deletedMappings.length}`,
  );

  return {
    liveBom: liveBom.length,
    draftBom: draftBom.length,
    liveOps: liveOps.length,
    draftOps: draftOps.length,
    skuMappings: deletedMappings.length,
  };
}

async function main(): Promise<void> {
  const now = new Date();
  console.log("Katana / Hub reconciliation (ASM- prefix standard)");
  console.log(
    `  flags: confirm-katana-purge=${confirmKatanaPurge} confirm-hub-wipe=${confirmHubWipe} (writes off unless those flags are set)`,
  );
  console.log(`  now: ${now.toISOString()}`);

  const purge = await phaseKatanaPurge(now);
  const wipe = await phaseHubWipe();

  console.log("\n=== Summary");
  console.log(
    `  Katana SA-* scanned: ${purge.scanned}; candidates: ${purge.candidates.length}; deleted: ${purge.deleted.length}`,
  );
  console.log(
    `  Hub clone wipe (live/draft BOM): ${wipe.liveBom}/${wipe.draftBom}; ops ${wipe.liveOps}/${wipe.draftOps}; sku_mappings ${wipe.skuMappings}`,
  );
  console.log(
    "  Next: remint with ASM- via `npm run ops:clone-archetype-boms` (dry-run first). Do not fuzzy-map to existing Katana SKUs.",
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
