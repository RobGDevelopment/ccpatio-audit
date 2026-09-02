/**
 * One-off: push a real fabric colorway into Katana so the sandbox MTO
 * ingredient swap has a target variant.
 *
 * Usage:
 *   npx tsx scripts/sync-test-fabric.ts
 *   npx tsx scripts/sync-test-fabric.ts FAB-ACT-ASH
 *
 * Env: POSTGRES_URL, KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY)
 */
import { loadEnvConfig } from "@next/env";
import { eq, like } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import {
  raw_materials_catalog,
  sku_mappings,
} from "../src/server/db/schema";
import { syncRawMaterialToKatana } from "../src/lib/katana";

loadEnvConfig(process.cwd());

const DEFAULT_SKU = "FAB-ACT-ASH";

async function resolveFabricSku(requested: string): Promise<string> {
  const db = getDb();
  const needle = requested.trim().toUpperCase();

  const [exact] = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      uom: sku_mappings.uom_consume,
      cost: sku_mappings.base_cost,
      variantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, needle))
    .limit(1);

  if (exact) {
    await ensureCatalogRow({
      sku: exact.sku,
      name: exact.name || exact.sku,
      category: exact.category || "Fabric",
      uom: exact.uom || "yd",
      cost: exact.cost,
    });
    return exact.sku;
  }

  const [fallback] = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      uom: sku_mappings.uom_consume,
      cost: sku_mappings.base_cost,
    })
    .from(sku_mappings)
    .where(like(sku_mappings.global_sku, "FAB-%"))
    .limit(1);

  if (!fallback) {
    throw new Error(
      `No fabric SKU in sku_mappings (looked for ${needle} and FAB-%).`,
    );
  }

  console.warn(
    `${needle} not in sku_mappings; using ${fallback.sku} instead.`,
  );
  await ensureCatalogRow({
    sku: fallback.sku,
    name: fallback.name || fallback.sku,
    category: fallback.category || "Fabric",
    uom: fallback.uom || "yd",
    cost: fallback.cost,
  });
  return fallback.sku;
}

async function ensureCatalogRow(input: {
  sku: string;
  name: string;
  category: string;
  uom: string;
  cost: string | null;
}): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ sku: raw_materials_catalog.sku })
    .from(raw_materials_catalog)
    .where(eq(raw_materials_catalog.sku, input.sku))
    .limit(1);

  if (existing) {
    return;
  }

  await db.insert(raw_materials_catalog).values({
    sku: input.sku,
    name: input.name,
    category: input.category,
    unit_of_measure: input.uom,
    cost_per_unit: input.cost,
  });
  console.log(`Inserted ${input.sku} into raw_materials_catalog`);
}

async function main(): Promise<void> {
  const requested = process.argv[2]?.trim() || DEFAULT_SKU;
  const sku = await resolveFabricSku(requested);
  console.log(`Syncing ${sku} to Katana as a material…`);

  const result = await syncRawMaterialToKatana(sku);
  if (!result.ok) {
    throw new Error(result.error);
  }

  console.log(`ok=${result.ok}`);
  console.log(`sku=${result.sku}`);
  console.log(`action=${result.action}`);
  console.log(`katana_material_id=${result.materialId ?? "null"}`);
  console.log(`katana_variant_id=${result.variantId}`);
  console.log(result.message);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
