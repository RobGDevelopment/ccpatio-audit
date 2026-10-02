/**
 * Reverse-sync Hub Postgres from live Katana (SSOT).
 *
 * Why this exists: the Owner sterilized Katana in-app and uploaded
 * Katana-Direct-Operations / pricing files. Local sku_mappings still
 * holds ghost SKUs; item_operations still holds Hub-era bloat.
 *
 * Pipeline:
 *   1. GET /variants (paginate, skip deleted)
 *   2. Soft-delete Hub sku_mappings whose SKU is absent from Katana
 *      (is_active = false). Reactivate Hub rows that are live in Katana.
 *   3. DELETE all item_operations, then upsert SMV Standard Tracks for
 *      live Katana *products* that already exist on sku_mappings.
 *
 * Does NOT mint missing Hub SKUs (FK-safe). Does NOT touch Katana.
 * Does NOT delete sku_mappings rows (BOM FKs stay intact).
 *
 *   npm run ops:sync-hub-from-katana
 *   npm run ops:sync-hub-from-katana -- --dry-run
 *   npm run ops:sync-hub-from-katana:confirm
 *   npm run ops:sync-hub-from-katana -- --confirm --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inArray, sql } from "drizzle-orm";
import { escapeKatanaCsvField } from "../../src/lib/katana-bom-csv";
import {
  indexLiveKatanaVariants,
  planGhostArchives,
  planOperationSync,
  summarizeGhostPlan,
  summarizeOpsPlan,
  type GhostPlanRow,
  type HubSkuSnapshot,
  type KatanaVariantRow,
  type OpsPlanRow,
} from "../../src/lib/hub-katana-sync";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import { item_operations, sku_mappings } from "../../src/server/db/schema";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const UPDATED_BY = "sync-hub-from-katana";
const PAGE_SIZE = 250;
const MAX_PAGES = 200;
const CHUNK = 200;

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
  console.log("Hub reverse-sync from live Katana");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  ops limit: ${limit ?? "(none)"}`);
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
  console.log(`  total variant rows: ${variants.length}`);

  const indexed = indexLiveKatanaVariants(variants);
  console.log(`  live unique SKUs:   ${indexed.allSkus.size}`);
  console.log(`  live products:      ${indexed.products.length}`);
  console.log("");

  if (indexed.allSkus.size === 0) {
    throw new Error(
      "Katana returned 0 live SKUs. Refusing to archive Hub rows or wipe item_operations.",
    );
  }

  const db = getDb();
  const hubRows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
      isActive: sku_mappings.is_active,
    })
    .from(sku_mappings);

  const hubSnapshots: HubSkuSnapshot[] = hubRows.map((row) => ({
    sku: row.sku,
    name: row.name ?? "",
    itemType: row.itemType,
    isActive: row.isActive,
  }));
  const hubBySku = new Map(
    hubSnapshots.map((row) => [row.sku.trim().toUpperCase(), row]),
  );

  console.log(`→ Hub sku_mappings:   ${hubSnapshots.length}`);

  const ghostPlan = planGhostArchives(hubSnapshots, indexed.allSkus);
  const liveProducts =
    limit != null ? indexed.products.slice(0, limit) : indexed.products;
  const opsPlan = planOperationSync(liveProducts, hubBySku);

  const ghostSummary = summarizeGhostPlan(ghostPlan);
  const opsSummary = summarizeOpsPlan(opsPlan.rows);

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const ts = stamp();
  const ghostPath = join(outDir, `sync-hub-from-katana-ghosts-${ts}.csv`);
  const opsPath = join(outDir, `sync-hub-from-katana-ops-${ts}.csv`);

  writeFileSync(
    ghostPath,
    toCsv(
      ["action", "sku", "name", "itemType", "reason"],
      ghostPlan.map((r: GhostPlanRow) => ({
        action: r.action,
        sku: r.sku,
        name: r.name,
        itemType: r.itemType,
        reason: r.reason,
      })),
    ),
    "utf8",
  );
  writeFileSync(
    opsPath,
    toCsv(
      ["action", "sku", "name", "itemType", "trackId", "reason", "steps"],
      opsPlan.rows.map((r: OpsPlanRow) => ({
        action: r.action,
        sku: r.sku,
        name: r.name,
        itemType: r.itemType,
        trackId: r.trackId,
        reason: r.reason,
        steps: r.steps,
      })),
    ),
    "utf8",
  );

  if (!dryRun) {
    const now = new Date();
    const toArchive = ghostPlan
      .filter((r) => r.action === "archive")
      .map((r) => r.sku);
    const toReactivate = ghostPlan
      .filter((r) => r.action === "reactivate")
      .map((r) => r.sku);

    console.log("→ Archiving Hub ghosts (is_active=false)");
    for (const group of chunk(toArchive, CHUNK)) {
      await db
        .update(sku_mappings)
        .set({
          is_active: false,
          updated_by: UPDATED_BY,
          updated_at: now,
          version: sql`${sku_mappings.version} + 1`,
        })
        .where(inArray(sku_mappings.global_sku, group));
      console.log(`  archived ${group.length}`);
    }

    console.log("→ Reactivating Hub SKUs that are live in Katana");
    for (const group of chunk(toReactivate, CHUNK)) {
      await db
        .update(sku_mappings)
        .set({
          is_active: true,
          updated_by: UPDATED_BY,
          updated_at: now,
          version: sql`${sku_mappings.version} + 1`,
        })
        .where(inArray(sku_mappings.global_sku, group));
      console.log(`  reactivated ${group.length}`);
    }

    console.log("→ Clearing item_operations");
    const deleted = await db
      .delete(item_operations)
      .where(sql`true`)
      .returning({ id: item_operations.id });
    console.log(`  deleted ${deleted.length} legacy ops rows`);

    console.log("→ Inserting SMV Standard Track ops");
    let inserted = 0;
    for (const group of chunk(opsPlan.inserts, CHUNK)) {
      await db.insert(item_operations).values(
        group.map((row) => ({
          item_sku: row.itemSku,
          work_center: row.workCenter,
          sequence: row.sequence,
          setup_time_mins: row.setupTimeMins,
          run_time_mins: row.runTimeMins,
          updated_at: now,
        })),
      );
      inserted += group.length;
      console.log(`  inserted ${inserted}/${opsPlan.inserts.length}`);
    }
  }

  console.log("");
  console.log("Summary");
  console.log(`  live Katana SKUs:     ${indexed.allSkus.size}`);
  console.log(`  live products:        ${indexed.products.length}`);
  console.log(`  Hub SKUs scanned:     ${hubSnapshots.length}`);
  console.log(`  archive ghosts:       ${ghostSummary.archive}`);
  console.log(`  reactivate:           ${ghostSummary.reactivate}`);
  console.log(`  keep active:          ${ghostSummary.keepActive}`);
  console.log(`  already inactive:     ${ghostSummary.alreadyInactive}`);
  console.log(`  ops upsert SKUs:      ${opsSummary.upsert}`);
  console.log(`  ops steps:            ${opsSummary.steps}`);
  console.log(`  skip (no track):      ${opsSummary.skipNoTrack}`);
  console.log(`  skip (missing Hub):   ${opsSummary.skipMissingHub}`);
  console.log(`  ghosts report: ${ghostPath}`);
  console.log(`  ops report:    ${opsPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to write Postgres.");
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
