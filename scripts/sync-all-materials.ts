/**
 * Phase 1: mass-sync fabric colorways (FAB-*) and Dekton slabs (STN-DKT-*)
 * from Supabase into Katana as materials.
 *
 * Source of truth is sku_mappings, not raw_materials_catalog — the catalog
 * only holds the 13 factory bulk placeholders. Each colorway is copied into
 * raw_materials_catalog first because syncRawMaterialToKatana reads from there.
 *
 * Resume-safe: rows that already carry katana_variant_id are skipped, and a
 * single SKU failure never aborts the batch. Re-run until failed is 0.
 *
 * Usage:
 *   npx tsx scripts/sync-all-materials.ts --dry-run
 *   npx tsx scripts/sync-all-materials.ts
 *   npx tsx scripts/sync-all-materials.ts --limit 25
 *   npx tsx scripts/sync-all-materials.ts --prefix STN-DKT-
 *
 * Env: POSTGRES_URL, KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY)
 */
import { loadEnvConfig } from "@next/env";
import { asc, eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/server/db/client";
import { raw_materials_catalog, sku_mappings } from "../src/server/db/schema";
import { syncRawMaterialToKatana } from "../src/lib/katana";

loadEnvConfig(process.cwd());

/** Katana allows 60 requests / 60s; a material sync costs 2-3 calls. */
const REQUEST_DELAY_MS = 1100;

const PREFIXES = ["FAB-", "STN-DKT-"] as const;

const dryRun = process.argv.includes("--dry-run");

function numericFlag(name: string): number | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function stringFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1]?.trim().toUpperCase() ?? null;
}

const limit = numericFlag("--limit");
const onlyPrefix = stringFlag("--prefix");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MaterialRow = {
  globalSku: string;
  name: string;
  category: string;
  uomPurchase: string | null;
  uomConsume: string | null;
  baseCost: string | null;
  katanaVariantId: number | null;
};

async function loadMaterials(): Promise<MaterialRow[]> {
  const db = getDb();
  const prefixes = onlyPrefix
    ? PREFIXES.filter((prefix) => prefix === onlyPrefix)
    : [...PREFIXES];

  if (prefixes.length === 0) {
    throw new Error(`--prefix must be one of ${PREFIXES.join(", ")}`);
  }

  const clause = sql.join(
    prefixes.map((prefix) => sql`${sku_mappings.global_sku} like ${`${prefix}%`}`),
    sql` or `,
  );

  return db
    .select({
      globalSku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      category: sku_mappings.category,
      uomPurchase: sku_mappings.uom_purchase,
      uomConsume: sku_mappings.uom_consume,
      baseCost: sku_mappings.base_cost,
      katanaVariantId: sku_mappings.katana_variant_id,
    })
    .from(sku_mappings)
    .where(clause)
    .orderBy(asc(sku_mappings.global_sku));
}

/** syncRawMaterialToKatana reads raw_materials_catalog, so mirror the row first. */
async function ensureCatalogRow(row: MaterialRow): Promise<void> {
  const db = getDb();
  const uom = row.uomPurchase?.trim() || row.uomConsume?.trim() || "ea";
  const [existing] = await db
    .select({ sku: raw_materials_catalog.sku })
    .from(raw_materials_catalog)
    .where(eq(raw_materials_catalog.sku, row.globalSku))
    .limit(1);

  if (existing) {
    await db
      .update(raw_materials_catalog)
      .set({
        name: row.name || row.globalSku,
        category: row.category || "Raw Material",
        unit_of_measure: uom,
        cost_per_unit: row.baseCost,
        updated_at: new Date(),
      })
      .where(eq(raw_materials_catalog.sku, row.globalSku));
    return;
  }

  await db.insert(raw_materials_catalog).values({
    sku: row.globalSku,
    name: row.name || row.globalSku,
    category: row.category || "Raw Material",
    unit_of_measure: uom,
    cost_per_unit: row.baseCost,
  });
}

async function main(): Promise<void> {
  const all = await loadMaterials();
  const alreadyMapped = all.filter((row) => row.katanaVariantId != null);
  const pending = all.filter((row) => row.katanaVariantId == null);
  const work = limit ? pending.slice(0, limit) : pending;

  console.log(
    dryRun
      ? "[dry-run] Phase 1 material sync — no Katana writes"
      : "Phase 1 material sync → Katana",
  );
  console.log(
    `  candidates=${all.length}  already_mapped=${alreadyMapped.length}  pending=${pending.length}  this_run=${work.length}`,
  );
  const byPrefix = new Map<string, number>();
  for (const row of all) {
    const prefix = row.globalSku.startsWith("STN-DKT-") ? "STN-DKT-" : "FAB-";
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  for (const [prefix, count] of byPrefix) {
    console.log(`  ${prefix}* total=${count}`);
  }

  if (dryRun) {
    console.log(
      `  estimated runtime ≈ ${Math.round((work.length * REQUEST_DELAY_MS) / 1000)}s at ${REQUEST_DELAY_MS}ms pacing`,
    );
    for (const row of work.slice(0, 15)) {
      console.log(
        `    would sync ${row.globalSku}  uom=${row.uomPurchase ?? row.uomConsume ?? "ea"}  cost=${row.baseCost ?? "null"}  ${row.name}`,
      );
    }
    if (work.length > 15) {
      console.log(`    … ${work.length - 15} more`);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  let failed = 0;
  const failures: Array<{ sku: string; error: string }> = [];

  for (const [index, row] of work.entries()) {
    const label = `[${index + 1}/${work.length}] ${row.globalSku}`;
    try {
      await ensureCatalogRow(row);
      const result = await syncRawMaterialToKatana(row.globalSku);
      if (!result.ok) {
        failed += 1;
        failures.push({ sku: row.globalSku, error: result.error });
        console.error(`${label} FAILED — ${result.error}`);
      } else {
        if (result.action === "created") created += 1;
        else updated += 1;
        console.log(
          `${label} ${result.action} variant=${result.variantId} material=${result.materialId ?? "null"}`,
        );
      }
    } catch (error: unknown) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ sku: row.globalSku, error: message });
      console.error(`${label} FAILED — ${message}`);
    }

    await delay(REQUEST_DELAY_MS);
  }

  console.log("---");
  console.log(
    `created=${created} updated=${updated} skipped=${alreadyMapped.length} failed=${failed}`,
  );
  if (failures.length > 0) {
    console.log("failed SKUs (re-run to retry):");
    for (const failure of failures) {
      console.log(`  ${failure.sku} — ${failure.error}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
