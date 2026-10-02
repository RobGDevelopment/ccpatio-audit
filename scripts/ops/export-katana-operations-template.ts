/**
 * Export Hub live item_operations into Katana's
 * "Add new product operations" bulk-import file.
 *
 * Writes:
 *   1. CSV  — docs/Katana Downloads/Add-new-product-operations.csv
 *   2. XLSX — fills the official Advanced Manufacturing template sheet
 *              "Product operations" (preferred for Katana Data import)
 *
 *   npm run ops:export-katana-operations-template
 *   npm run ops:export-katana-operations-template -- --from-tracks
 *   npm run ops:export-katana-operations-template -- --limit=50
 */
import { loadEnvConfig } from "@next/env";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import { assignStandardTrack } from "../../src/lib/factory-routing/assign-track";
import { getStandardTrack } from "../../src/lib/factory-routing/resources";
import {
  expandHubOperationsToKatanaCsvRows,
  KATANA_OPERATIONS_CSV_HEADERS,
  toKatanaOperationsCsv,
  trackStepsToHubOperations,
  type HubOperationForExport,
  type KatanaOperationCsvRow,
} from "../../src/lib/katana-operations-csv";
import { closeDb, getDb } from "../../src/server/db/client";
import { item_operations, sku_mappings } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const fromTracks = process.argv.includes("--from-tracks");

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

const OUT_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-product-operations.csv",
);
const TEMPLATE_XLSX = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-operations-advanced-manufacturing.xlsx",
);
const OUT_XLSX = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-product-operations.xlsx",
);

async function loadFromLiveOps(): Promise<HubOperationForExport[]> {
  const db = getDb();
  const ops = await db
    .select({
      itemSku: item_operations.item_sku,
      productName: sku_mappings.original_name,
      workCenter: item_operations.work_center,
      sequence: item_operations.sequence,
      setupTimeMins: item_operations.setup_time_mins,
      runTimeMins: item_operations.run_time_mins,
    })
    .from(item_operations)
    .innerJoin(
      sku_mappings,
      eq(sku_mappings.global_sku, item_operations.item_sku),
    )
    .where(
      and(
        inArray(sku_mappings.item_type, ["finished_good", "sub_assembly"]),
        sql`coalesce(${sku_mappings.is_active}, true) = true`,
      ),
    )
    .orderBy(asc(item_operations.item_sku), asc(item_operations.sequence));

  const bySku = new Map<string, HubOperationForExport[]>();
  for (const op of ops) {
    const list = bySku.get(op.itemSku) ?? [];
    list.push({
      itemSku: op.itemSku,
      productName: op.productName ?? "",
      workCenter: op.workCenter,
      sequence: op.sequence,
      setupTimeMins:
        op.setupTimeMins == null ? null : Number(op.setupTimeMins),
      runTimeMins: op.runTimeMins == null ? null : Number(op.runTimeMins),
    });
    bySku.set(op.itemSku, list);
  }

  let skus = [...bySku.keys()].sort();
  if (limit != null) skus = skus.slice(0, limit);

  const out: HubOperationForExport[] = [];
  for (const sku of skus) {
    out.push(...(bySku.get(sku) ?? []));
  }
  return out;
}

async function loadFromTracks(): Promise<HubOperationForExport[]> {
  const db = getDb();
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
    })
    .from(sku_mappings)
    .where(
      and(
        inArray(sku_mappings.item_type, ["finished_good", "sub_assembly"]),
        sql`coalesce(${sku_mappings.is_active}, true) = true`,
      ),
    )
    .orderBy(asc(sku_mappings.global_sku));

  const out: HubOperationForExport[] = [];
  let count = 0;
  for (const row of rows) {
    const resolved = assignStandardTrack({
      sku: row.sku,
      name: row.name,
      itemType: row.itemType,
    });
    if (!resolved.trackId) continue;
    if (limit != null && count >= limit) break;
    count += 1;
    const track = getStandardTrack(resolved.trackId);
    out.push(
      ...trackStepsToHubOperations(resolved.sku, track, row.name ?? ""),
    );
  }
  return out;
}

function writeXlsxFromTemplate(rows: readonly KatanaOperationCsvRow[]): void {
  copyFileSync(TEMPLATE_XLSX, OUT_XLSX);
  const wb = XLSX.readFile(OUT_XLSX);
  const sheetName =
    wb.SheetNames.find((n) => /product\s*operations/i.test(n)) ??
    wb.SheetNames[1] ??
    wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Template has no Product operations sheet");
  }

  const matrix: Array<Array<string | number>> = [
    [...KATANA_OPERATIONS_CSV_HEADERS],
    ...rows.map((row) => [
      row.productSku,
      row.productName,
      row.operationName,
      row.resource,
      row.operationType,
      row.costParameter,
      row.hours,
      row.minutes,
      row.seconds,
    ]),
  ];
  wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.writeFile(wb, OUT_XLSX);
}

async function main(): Promise<void> {
  console.log("Export Katana product operations");
  console.log(
    `  source: ${fromTracks ? "Standard Tracks (assign-track)" : "live item_operations"}`,
  );
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  const hubOps = fromTracks ? await loadFromTracks() : await loadFromLiveOps();
  const skuCount = new Set(hubOps.map((o) => o.itemSku)).size;
  console.log(`→ Hub op rows: ${hubOps.length} across ${skuCount} SKU(s)`);

  const csvRows = expandHubOperationsToKatanaCsvRows(hubOps);
  console.log(`→ Katana rows (setup+process): ${csvRows.length}`);

  const csv = toKatanaOperationsCsv(csvRows);
  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, csv, "utf8");
  writeXlsxFromTemplate(csvRows);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpPath = join(
    process.cwd(),
    "tmp",
    `katana-operations-export-${stamp}.csv`,
  );
  mkdirSync(dirname(tmpPath), { recursive: true });
  writeFileSync(tmpPath, csv, "utf8");

  console.log("");
  console.log(`Wrote CSV:  ${OUT_CSV}`);
  console.log(`Wrote XLSX: ${OUT_XLSX}  ← upload this in Katana`);
  console.log(`Copy:       ${tmpPath}`);
  console.log("");
  console.log(
    "Import: Settings → Data import → Add new production operations → Upload",
  );
  console.log("(Import replaces existing operations on listed SKUs.)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
