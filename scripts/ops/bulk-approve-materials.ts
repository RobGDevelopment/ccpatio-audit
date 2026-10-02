/**
 * Bulk Material Approval — coerce Hub material prefixes → raw_material and
 * push each SKU to Katana Materials (`POST /materials` via existing sync).
 *
 * Targets known raw-material namespaces (FAB-/PWD-/STN-/RM-/MET-/…):
 *   1. Rows whose item_type is not raw_material → bulk UPDATE + clear Katana IDs
 *   2. Rows missing katana_material_id → ensure catalog + sync to Katana
 *
 * Dry-run default. Live: --confirm
 * Optional: --force to re-sync even when katana_material_id is already set
 * Optional: --prefix=FAB-  (repeatable) to narrow the default prefix set
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/bulk-approve-materials.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/bulk-approve-materials.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  HUB_RAW_MATERIAL_PREFIXES,
  isHubRawMaterialSku,
} from "../../src/lib/raw-material-sku";
import {
  ensureKatanaVariantForSku,
  type KatanaSyncResult,
} from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  raw_materials_catalog,
  sku_mappings,
} from "../../src/server/db/schema";
import { REQUEST_DELAY_MS, delay } from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const force = process.argv.includes("--force");

function parsePrefixOverrides(): string[] {
  const out: string[] = [];
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--prefix=")) {
      const raw = arg.slice("--prefix=".length).trim().toUpperCase();
      if (!raw) continue;
      out.push(raw.endsWith("-") ? raw : `${raw}-`);
    }
  }
  return out;
}

const PREFIXES =
  parsePrefixOverrides().length > 0
    ? parsePrefixOverrides()
    : [...HUB_RAW_MATERIAL_PREFIXES];

type TargetRow = {
  global_sku: string;
  original_name: string | null;
  category: string;
  item_type: string;
  uom_purchase: string | null;
  uom_consume: string | null;
  base_cost: string | null;
  katana_variant_id: number | null;
  katana_material_id: number | null;
  version: number;
};

type SyncStat = {
  sku: string;
  dbUpdated: boolean;
  sync: "created" | "updated" | "unchanged" | "skipped" | "failed";
  detail: string;
  variantId?: number;
  materialId?: number | null;
};

function matchesPrefix(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return PREFIXES.some((p) => s.startsWith(p));
}

function prefixSqlPattern(prefix: string): string {
  return `${prefix.replace(/%/g, "")}%`;
}

async function loadTargets(): Promise<TargetRow[]> {
  const db = getDb();
  const likes = PREFIXES.map(
    (p) => sql`upper(${sku_mappings.global_sku}) like ${prefixSqlPattern(p)}`,
  );
  const prefixClause =
    likes.length === 1
      ? likes[0]!
      : sql`(${sql.join(likes, sql` or `)})`;

  const needsType = sql`${sku_mappings.item_type} is distinct from 'raw_material'`;
  const needsSync = force
    ? sql`true`
    : sql`${sku_mappings.katana_material_id} is null`;

  const rows = await db
    .select({
      global_sku: sku_mappings.global_sku,
      original_name: sku_mappings.original_name,
      category: sku_mappings.category,
      item_type: sku_mappings.item_type,
      uom_purchase: sku_mappings.uom_purchase,
      uom_consume: sku_mappings.uom_consume,
      base_cost: sku_mappings.base_cost,
      katana_variant_id: sku_mappings.katana_variant_id,
      katana_material_id: sku_mappings.katana_material_id,
      version: sku_mappings.version,
    })
    .from(sku_mappings)
    .where(and(prefixClause, or(needsType, needsSync)))
    .orderBy(sku_mappings.global_sku);

  return rows.filter((r) => matchesPrefix(r.global_sku));
}

async function ensureCatalogRow(row: TargetRow): Promise<void> {
  const db = getDb();
  const sku = row.global_sku.trim().toUpperCase();
  const [existing] = await db
    .select({ sku: raw_materials_catalog.sku })
    .from(raw_materials_catalog)
    .where(eq(raw_materials_catalog.sku, sku))
    .limit(1);
  if (existing) return;

  await db.insert(raw_materials_catalog).values({
    sku,
    name: row.original_name?.trim() || sku,
    category: row.category?.trim() || "Raw Material",
    unit_of_measure: row.uom_purchase || row.uom_consume || "ea",
    cost_per_unit: row.base_cost,
  });
}

async function bulkUpdateTypes(skus: string[]): Promise<number> {
  if (skus.length === 0) return 0;
  const db = getDb();
  const now = new Date();
  // Chunk to stay under parameter limits
  let updated = 0;
  const CHUNK = 200;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK);
    const result = await db
      .update(sku_mappings)
      .set({
        item_type: "raw_material",
        katana_variant_id: null,
        katana_material_id: null,
        updated_at: now,
        updated_by: "ops:bulk-approve-materials",
        version: sql`${sku_mappings.version} + 1`,
      })
      .where(
        and(
          inArray(sku_mappings.global_sku, chunk),
          ne(sku_mappings.item_type, "raw_material"),
        ),
      )
      .returning({ sku: sku_mappings.global_sku });
    updated += result.length;
  }
  return updated;
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeReport(stats: SyncStat[]): string {
  const dir = join(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bulk-approve-materials-results.csv");
  const header =
    "sku,db_updated,sync,detail,katana_variant_id,katana_material_id";
  const lines = [header];
  for (const s of stats) {
    lines.push(
      [
        s.sku,
        String(s.dbUpdated),
        s.sync,
        csvEscape(s.detail),
        s.variantId ?? "",
        s.materialId ?? "",
      ].join(","),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function main(): Promise<void> {
  console.log("Bulk Material Approval");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  force resync: ${force}`);
  console.log(`  prefixes: ${PREFIXES.join(" ")}`);
  console.log("");

  const targets = await loadTargets();
  const typeFix = targets.filter((t) => t.item_type !== "raw_material");
  const syncFix = targets.filter(
    (t) => force || t.katana_material_id == null || t.item_type !== "raw_material",
  );

  const byPrefix = new Map<string, number>();
  for (const t of targets) {
    const p =
      PREFIXES.find((x) => t.global_sku.toUpperCase().startsWith(x)) ?? "other";
    byPrefix.set(p, (byPrefix.get(p) ?? 0) + 1);
  }

  console.log(`  targets (type fix and/or Katana sync): ${targets.length}`);
  console.log(`    · need item_type → raw_material: ${typeFix.length}`);
  console.log(`    · need Katana Materials sync:    ${syncFix.length}`);
  for (const [p, n] of [...byPrefix.entries()].sort()) {
    console.log(`    · ${p.padEnd(6)} ${n}`);
  }

  if (targets.length === 0) {
    console.log("");
    console.log("Nothing to do — all matching prefixes already raw_material");
    console.log("with katana_material_id set. Pass --force to re-push.");
    await closeDb();
    return;
  }

  if (!confirm) {
    console.log("");
    console.log("Sample (first 15):");
    for (const t of targets.slice(0, 15)) {
      console.log(
        `  ${t.global_sku}  type=${t.item_type}  material_id=${t.katana_material_id ?? "null"}  variant_id=${t.katana_variant_id ?? "null"}`,
      );
    }
    if (targets.length > 15) {
      console.log(`  … +${targets.length - 15} more`);
    }
    console.log("");
    console.log(
      `DRY-RUN: would UPDATE ${typeFix.length} row(s) to raw_material and sync ${syncFix.length} SKU(s) to Katana Materials.`,
    );
    console.log("Pass --confirm to execute.");
    await closeDb();
    return;
  }

  // --- Live DB update ---
  const typeFixSkus = typeFix.map((t) => t.global_sku);
  const dbUpdatedCount = await bulkUpdateTypes(typeFixSkus);
  console.log("");
  console.log(`→ Postgres: updated item_type on ${dbUpdatedCount} row(s)`);

  const updatedSet = new Set(typeFixSkus);
  const stats: SyncStat[] = [];
  let syncedOk = 0;
  let syncedFail = 0;
  let skipped = 0;

  console.log(`→ Katana Materials sync (${syncFix.length} SKU(s))…`);
  for (let i = 0; i < syncFix.length; i += 1) {
    const row = syncFix[i]!;
    const sku = row.global_sku.trim().toUpperCase();
    process.stdout.write(`  [${i + 1}/${syncFix.length}] ${sku}… `);

    try {
      if (!isHubRawMaterialSku(sku) && row.item_type !== "raw_material") {
        // Shouldn't happen with our prefix list, but stay defensive.
        console.log("skip (not a material prefix)");
        skipped += 1;
        stats.push({
          sku,
          dbUpdated: updatedSet.has(row.global_sku),
          sync: "skipped",
          detail: "prefix not treated as raw material",
        });
        continue;
      }

      await ensureCatalogRow({
        ...row,
        item_type: "raw_material",
      });
      const result: KatanaSyncResult = await ensureKatanaVariantForSku(sku);
      if (!result.ok) {
        syncedFail += 1;
        console.log(`FAIL ${result.error}`);
        stats.push({
          sku,
          dbUpdated: updatedSet.has(row.global_sku),
          sync: "failed",
          detail: result.error,
        });
      } else {
        syncedOk += 1;
        console.log(
          `OK ${result.action} variant=${result.variantId} material=${result.materialId ?? "—"}`,
        );
        stats.push({
          sku,
          dbUpdated: updatedSet.has(row.global_sku),
          sync: result.action,
          detail: result.message,
          variantId: result.variantId,
          materialId: result.materialId,
        });
      }
    } catch (e) {
      syncedFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${msg}`);
      stats.push({
        sku,
        dbUpdated: updatedSet.has(row.global_sku),
        sync: "failed",
        detail: msg,
      });
    }

    await delay(REQUEST_DELAY_MS);
  }

  const reportPath = writeReport(stats);

  console.log("");
  console.log("========================================");
  console.log("  BULK MATERIAL APPROVAL SUMMARY");
  console.log("========================================");
  console.log(`  Postgres rows type-updated: ${dbUpdatedCount}`);
  console.log(`  Katana sync OK:             ${syncedOk}`);
  console.log(`  Katana sync failed:         ${syncedFail}`);
  console.log(`  Skipped:                    ${skipped}`);
  console.log(`  Results CSV → ${reportPath}`);
  console.log("========================================");

  await closeDb();
  if (syncedFail > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
