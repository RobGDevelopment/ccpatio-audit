/**
 * Mint Hub sku_mappings (+ companion catalogs) for live Katana SKUs
 * that the reverse-sync skipped because they were missing from Postgres.
 *
 * Why: Katana is SSOT. Colorway FIN-* (and any other live variant) must
 * exist on sku_mappings before item_operations can be attached (FK).
 *
 * FK order:
 *   1. INSERT sku_mappings
 *   2. INSERT finished_goods_catalog for finished_good
 *   3. INSERT raw_materials_catalog for raw_material
 *
 * Does NOT mint BOM edges or operations. Re-run ops:sync-hub-from-katana
 * after confirm to attach SMV tracks.
 *
 *   npm run ops:mint-missing-hub-skus
 *   npm run ops:mint-missing-hub-skus -- --dry-run
 *   npm run ops:mint-missing-hub-skus:confirm
 *   npm run ops:mint-missing-hub-skus -- --confirm --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeKatanaCsvField } from "../../src/lib/katana-bom-csv";
import {
  indexLiveKatanaVariants,
  type KatanaVariantRow,
} from "../../src/lib/hub-katana-sync";
import {
  planMintMissingHubSkus,
  summarizeMintPlan,
  type MintPlanRow,
} from "../../src/lib/mint-missing-hub-skus";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  raw_materials_catalog,
  sku_mappings,
} from "../../src/server/db/schema";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const SOURCE_FILE = "ops:mint-missing-hub-skus";
const PAGE_SIZE = 250;
const MAX_PAGES = 200;
const CHUNK = 100;

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

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size) as T[]);
  }
  return out;
}

function toCsv(headers: readonly string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => escapeKatanaCsvField(row[h] == null ? "" : String(row[h])))
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

async function fetchAllVariants(): Promise<KatanaVariantRow[]> {
  const all: KatanaVariantRow[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/variants?include_deleted=false&limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<KatanaVariantRow>(data);
    all.push(...rows);
    console.log(`  variants page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for /variants (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

async function main(): Promise<void> {
  console.log("Mint missing Hub SKUs from live Katana");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariantRow[];
  try {
    variants = await fetchAllVariants();
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const indexed = indexLiveKatanaVariants(variants);
  console.log(`  live unique SKUs: ${indexed.allSkus.size}`);

  if (indexed.allSkus.size === 0) {
    throw new Error("Katana returned 0 live SKUs. Refusing to mint.");
  }

  const db = getDb();
  const hubRows = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings);
  const hubSkus = new Set(hubRows.map((r) => r.sku));
  console.log(`  Hub sku_mappings: ${hubSkus.size}`);

  const liveList = [...indexed.bySku.values()].sort((a, b) =>
    a.sku.localeCompare(b.sku),
  );
  let plan = planMintMissingHubSkus(liveList, hubSkus).filter(
    (row) => row.action === "mint",
  );
  if (limit != null) {
    plan = plan.slice(0, limit);
  }

  const summary = summarizeMintPlan(plan);
  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `mint-missing-hub-skus-${stamp()}.csv`);
  writeFileSync(
    reportPath,
    toCsv(
      [
        "action",
        "sku",
        "name",
        "itemType",
        "category",
        "uom",
        "kind",
        "needsFinishedGoodsCatalog",
        "needsRawMaterialsCatalog",
        "katanaVariantId",
        "katanaMaterialId",
        "reason",
      ],
      plan.map((r: MintPlanRow) => ({
        action: r.action,
        sku: r.sku,
        name: r.name,
        itemType: r.itemType,
        category: r.category,
        uom: r.uom,
        kind: r.kind,
        needsFinishedGoodsCatalog: r.needsFinishedGoodsCatalog,
        needsRawMaterialsCatalog: r.needsRawMaterialsCatalog,
        katanaVariantId: r.katanaVariantId,
        katanaMaterialId: r.katanaMaterialId ?? "",
        reason: r.reason,
      })),
    ),
    "utf8",
  );

  if (!dryRun) {
    const now = new Date();
    console.log("→ Inserting sku_mappings");
    for (const group of chunk(plan, CHUNK)) {
      await db
        .insert(sku_mappings)
        .values(
          group.map((row) => ({
            global_sku: row.sku,
            category: row.category,
            item_type: row.itemType,
            original_name: row.name,
            source_file: SOURCE_FILE,
            is_active: true,
            sync_to_woo: false,
            sync_to_clover: false,
            uom_purchase: row.uom,
            uom_consume: row.uom,
            katana_variant_id: row.katanaVariantId,
            katana_material_id: row.katanaMaterialId,
            attributes: {},
            version: 1,
            updated_by: SOURCE_FILE,
            updated_at: now,
          })),
        )
        .onConflictDoNothing({ target: sku_mappings.global_sku });
      console.log(`  sku_mappings +${group.length}`);
    }

    const fgRows = plan.filter((r) => r.needsFinishedGoodsCatalog);
    console.log("→ Inserting finished_goods_catalog");
    for (const group of chunk(fgRows, CHUNK)) {
      await db
        .insert(finished_goods_catalog)
        .values(
          group.map((row) => ({
            global_sku: row.sku,
            updated_by: SOURCE_FILE,
            updated_at: now,
          })),
        )
        .onConflictDoNothing({ target: finished_goods_catalog.global_sku });
      console.log(`  finished_goods_catalog +${group.length}`);
    }

    const rmRows = plan.filter((r) => r.needsRawMaterialsCatalog);
    console.log("→ Inserting raw_materials_catalog");
    for (const group of chunk(rmRows, CHUNK)) {
      await db
        .insert(raw_materials_catalog)
        .values(
          group.map((row) => ({
            sku: row.sku,
            name: row.name,
            category: row.category,
            unit_of_measure: row.uom,
            updated_at: now,
          })),
        )
        .onConflictDoNothing({ target: raw_materials_catalog.sku });
      console.log(`  raw_materials_catalog +${group.length}`);
    }
  }

  console.log("");
  console.log("Summary");
  console.log(`  live Katana SKUs:     ${indexed.allSkus.size}`);
  console.log(`  Hub already had:      ${hubSkus.size}`);
  console.log(`  would mint:           ${summary.mint}`);
  console.log(`    finished_good:      ${summary.finishedGood}`);
  console.log(`    sub_assembly:       ${summary.subAssembly}`);
  console.log(`    raw_material:       ${summary.rawMaterial}`);
  console.log(`    service:            ${summary.service}`);
  console.log(`    FG catalog stubs:   ${summary.fgCatalog}`);
  console.log(`    RM catalog stubs:   ${summary.rmCatalog}`);
  console.log(`  report: ${reportPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to insert Hub rows.");
    console.log("After confirm, re-run: npm run ops:sync-hub-from-katana:confirm");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
