/**
 * Inventory Engine — inject opening stock via Katana stock adjustments.
 *
 * Input: tmp/inventory.csv
 *   Columns: SKU, Quantity, Unit Cost
 *
 * Looks up each SKU → variant_id, then POSTs /stock_adjustments against the
 * primary warehouse (GET /locations → is_primary, else first location).
 *
 * Dry-run default. Live: --confirm
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-initial-stock.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/import-initial-stock.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { join } from "node:path";
import { findVariantBySku, katanaFetch } from "../../src/lib/katana";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  parseMoney,
  parseQty,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");
const csvPath = join(process.cwd(), "tmp", "inventory.csv");
const CHUNK = 40;

type LocationHit = {
  id: number;
  name?: string | null;
  is_primary?: boolean | null;
};

type AdjustmentRow = {
  variant_id: number;
  quantity: number;
  cost_per_unit?: number;
};

async function resolvePrimaryLocationId(): Promise<{
  id: number;
  name: string;
}> {
  const { data } = await katanaFetch("/locations?limit=50&page=1");
  const rows = unwrapList<LocationHit>(data);
  if (rows.length === 0) {
    throw new Error("No Katana locations found — create a warehouse in UI first.");
  }
  const primary =
    rows.find((l) => l.is_primary === true) ??
    rows.find((l) => /primary|main|factory/i.test(l.name ?? "")) ??
    rows[0]!;
  return { id: primary.id, name: primary.name ?? `location ${primary.id}` };
}

async function main(): Promise<void> {
  console.log("Import initial stock (Inventory Engine)");
  console.log(`  csv: ${csvPath}`);
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);

  const records = readCsvRecords(csvPath);
  if (records.length === 0) {
    throw new Error(`No data rows in ${csvPath}`);
  }

  const location = await resolvePrimaryLocationId();
  console.log(`  warehouse: ${location.name} (id=${location.id})`);
  await delay(REQUEST_DELAY_MS);

  const rows: AdjustmentRow[] = [];
  let skipped = 0;

  for (const record of records) {
    const sku = col(record, "SKU", "Global SKU").toUpperCase();
    const qty = parseQty(col(record, "Quantity", "Qty"));
    const unitCost = parseMoney(col(record, "Unit Cost", "Cost", "Purchase Price"));

    if (!sku) {
      console.warn("  skip: missing SKU");
      skipped += 1;
      continue;
    }
    if (qty == null || qty === 0) {
      console.warn(`  skip ${sku}: Quantity must be a non-zero number`);
      skipped += 1;
      continue;
    }

    const variant = await findVariantBySku(sku);
    await delay(REQUEST_DELAY_MS);
    if (!variant) {
      console.warn(`  skip ${sku}: not found in Katana variants`);
      skipped += 1;
      continue;
    }

    const row: AdjustmentRow = {
      variant_id: variant.id,
      quantity: qty,
    };
    if (unitCost != null) row.cost_per_unit = unitCost;
    rows.push(row);
    console.log(
      `  mapped ${sku} → variant ${variant.id} qty=${qty} cost=${unitCost ?? "—"}`,
    );
  }

  console.log(`\n  adjustment rows ready: ${rows.length} (skipped ${skipped})`);

  if (rows.length === 0) {
    console.log("  Nothing to post.");
    return;
  }

  let posted = 0;
  let failed = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const payload = {
      location_id: location.id,
      stock_adjustment_date: today,
      reason: "Hub initial stock load",
      additional_info: `ops:import-initial-stock chunk ${i / CHUNK + 1}`,
      stock_adjustment_rows: chunk,
    };

    if (!confirm) {
      console.log(
        `  would POST /stock_adjustments location=${location.id} rows=${chunk.length}`,
      );
      posted += 1;
      continue;
    }

    try {
      const { data } = await katanaFetch<{ id?: number }>("/stock_adjustments", {
        method: "POST",
        body: payload,
      });
      posted += 1;
      console.log(
        `  POSTED stock_adjustment id=${data?.id ?? "?"} rows=${chunk.length}`,
      );
    } catch (error: unknown) {
      failed += 1;
      console.error(
        `  FAIL chunk ${i / CHUNK + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await delay(REQUEST_DELAY_MS);
  }

  console.log("\n=== Summary ===");
  console.log(`  SKUs mapped:     ${rows.length}`);
  console.log(`  adjustments:     ${posted}`);
  console.log(`  skipped rows:    ${skipped}`);
  console.log(`  failed chunks:   ${failed}`);
  if (!confirm) {
    console.log("  Re-run with --confirm to POST live.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
