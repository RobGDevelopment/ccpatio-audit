/**
 * Seed Katana finished-good product shells from the VividWorks master CSV.
 *
 * Master-data only: POST /v1/products via src/lib/katana.ts `katanaFetch`.
 * Does not create sales orders, manufacturing orders, or recipes.
 *
 * Finished-good flags come from `katanaProductSyncFlags("finished_good")`:
 *   is_sellable=true, is_producible=true, is_purchasable=false
 * There is no `is_make_to_order` field on our Katana product types. MTO in this
 * repo is an order-time call (`POST /manufacturing_order_make_to_order`), not a
 * catalog attribute. `is_producible: true` is the manufacturing shell flag.
 *
 * Existing SKUs (findVariantBySku) are skipped — we do not overwrite live
 * factory variants and we do not remap BRA-* leftovers.
 *
 * Usage:
 *   npx tsx scripts/vividworks/02-seed-katana-shells.ts --dry-run
 *   npx tsx scripts/vividworks/02-seed-katana-shells.ts --live
 *   npx tsx scripts/vividworks/02-seed-katana-shells.ts --live --limit 5
 *
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY) in .env.local
 *
 * Requires `xlsx` (already in package.json) to parse the CSV safely.
 */
import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { katanaProductSyncFlags } from "../../src/lib/katana-product-flags";
import {
  createIntervalPacer,
  findVariantBySku,
  KatanaApiError,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { parseMoney } from "../../src/mappers/types";

loadEnvConfig(process.cwd());

const INPUT_CSV = path.resolve(
  process.cwd(),
  "docs/Vividworks/vividworks_master_skus.csv",
);

type MasterRow = {
  originalName: string;
  hubSku: string;
  msrp: string;
};

type SeedResult = "created" | "skipped_existing" | "failed" | "dry_run";

const LIVE = process.argv.includes("--live");
const DRY_RUN = process.argv.includes("--dry-run") || !LIVE;

function readLimit(): number | null {
  const flagIndex = process.argv.indexOf("--limit");
  if (flagIndex >= 0) {
    const parsed = Number(process.argv[flagIndex + 1]);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }
  const inline = process.argv.find((arg) => arg.startsWith("--limit="));
  if (inline) {
    const parsed = Number(inline.slice("--limit=".length));
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
  }
  return null;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function readMasterCsv(filePath: string): MasterRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Run npx tsx scripts/vividworks/01-generate-master-csv.ts first.`,
    );
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const records: MasterRow[] = [];
  for (const row of rows) {
    const originalName = cellText(
      row["Original Name"] ?? row["original name"] ?? row["OriginalName"],
    );
    const hubSku = cellText(
      row["Canonical Hub SKU"] ??
        row["canonical hub sku"] ??
        row["Canonical Hub Sku"],
    ).toUpperCase();
    const msrp = cellText(row["MSRP"] ?? row["msrp"]);
    if (!hubSku) continue;
    records.push({ originalName, hubSku, msrp });
  }
  return records;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractCreatedIds(data: unknown): {
  productId: number | null;
  variantId: number | null;
} {
  const record = asRecord(data);
  const productId = record?.id != null ? Number(record.id) : NaN;
  const variants = Array.isArray(record?.variants) ? record.variants : [];
  const first = asRecord(variants[0]);
  const variantId = first?.id != null ? Number(first.id) : NaN;
  return {
    productId: Number.isFinite(productId) ? productId : null,
    variantId: Number.isFinite(variantId) ? variantId : null,
  };
}

function formatKatanaFailure(error: unknown): string {
  if (error instanceof KatanaApiError) {
    const details =
      error.details !== undefined ? ` details=${JSON.stringify(error.details)}` : "";
    return `HTTP ${error.status} ${error.message}${details}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function seedOne(row: MasterRow, index: number, total: number): Promise<SeedResult> {
  const flags = katanaProductSyncFlags("finished_good");
  const salesPrice = parseMoney(row.msrp);
  const payload = {
    name: row.originalName.trim() || row.hubSku,
    uom: "pcs",
    category_name: "Finished Good",
    is_sellable: flags.is_sellable,
    is_producible: flags.is_producible,
    is_purchasable: flags.is_purchasable,
    additional_info: row.originalName.trim() || undefined,
    variants: [
      {
        sku: row.hubSku,
        ...(salesPrice !== null ? { sales_price: salesPrice } : {}),
      },
    ],
  };

  const prefix = `[${index + 1}/${total}] ${row.hubSku}`;

  if (DRY_RUN) {
    console.log(`${prefix} DRY-RUN would POST /products`, {
      name: payload.name,
      sales_price: salesPrice,
      flags,
    });
    return "dry_run";
  }

  try {
    const existing = await findVariantBySku(row.hubSku);
    if (existing) {
      console.log(
        `${prefix} SKIP existing Katana variant #${existing.id} type=${existing.type}`,
      );
      return "skipped_existing";
    }

    const { data, status } = await katanaFetch<Record<string, unknown>>(
      "/products",
      {
        method: "POST",
        body: payload,
        idempotencyKey: `vividworks-shell-${row.hubSku}`,
      },
    );
    const created = extractCreatedIds(data);
    console.log(
      `${prefix} CREATED HTTP ${status} productId=${created.productId} variantId=${created.variantId} "${row.originalName}"`,
    );
    if (created.variantId == null) {
      console.warn(`${prefix} WARN Katana returned no variant id`);
    }
    return "created";
  } catch (error: unknown) {
    const status = error instanceof KatanaApiError ? error.status : null;
    const kind =
      status === 429
        ? "RATE LIMIT"
        : status === 400 || status === 422
          ? "VALIDATION"
          : "ERROR";
    console.error(`${prefix} ${kind} ${formatKatanaFailure(error)}`);
    return "failed";
  }
}

async function main(): Promise<void> {
  if (!DRY_RUN) {
    setKatanaRequestPacer(createIntervalPacer(1100));
  }

  const allRows = readMasterCsv(INPUT_CSV);
  const seen = new Set<string>();
  const unique: MasterRow[] = [];
  let duplicateCsvRows = 0;
  for (const row of allRows) {
    if (seen.has(row.hubSku)) {
      duplicateCsvRows += 1;
    console.log(`[vividworks] duplicate CSV SKU skipped: ${row.hubSku}`);
      continue;
    }
    seen.add(row.hubSku);
    unique.push(row);
  }

  const limit = readLimit();
  const rows = limit ? unique.slice(0, limit) : unique;

  console.log("[vividworks] seed Katana FG shells", {
    csvRows: allRows.length,
    uniqueSkus: unique.length,
    duplicateCsvRows,
    seeding: rows.length,
    mode: DRY_RUN ? "dry-run" : "LIVE",
    limit: limit ?? "none",
  });

  if (!DRY_RUN) {
    const token =
      process.env.KATANA_PERSONAL_ACCESS_TOKEN?.trim() ||
      process.env.KATANA_API_KEY?.trim();
    if (!token) {
      throw new Error(
        "Missing KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY). Copy .env.example → .env.local.",
      );
    }
  }

  const counts: Record<SeedResult, number> = {
    created: 0,
    skipped_existing: 0,
    failed: 0,
    dry_run: 0,
  };

  for (let i = 0; i < rows.length; i += 1) {
    const result = await seedOne(rows[i], i, rows.length);
    counts[result] += 1;
  }

  console.log("[vividworks] done", counts);
  if (counts.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[vividworks] fatal", error);
  process.exit(1);
});
