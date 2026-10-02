/**
 * Direct-to-Katana material cost + supplier CSV for "Update existing materials".
 *
 * SSOT for which materials exist: live Katana GET /variants (material_id set).
 * Local Postgres is never queried.
 *
 * Local price / supplier sources (priority):
 *   1. docs/Katana Downloads/MaterialList-*.csv  (SKU × purchase price)
 *   2. docs/Vividworks/Handoff/vividworks_material_options.csv
 *   3. src/lib/katana-bulk-materials.ts placeholders
 *   4. Cost 2025 rate card via resolveCost2025Price (never invent STN $8)
 *   5. tmp/suppliers.csv for Default supplier (+ optional price override)
 *
 * Output headers (Katana update materials):
 *   Item variant code / SKU, Default purchase price, Default supplier
 *
 *   npm run ops:katana-materials-updater
 *   npm run ops:katana-materials-updater -- --limit=50
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { KATANA_BULK_MATERIALS } from "../../src/lib/katana-bulk-materials";
import { resolveCost2025Price } from "../../src/lib/katana-material-cost";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { toKatanaCsv } from "../../src/lib/katana-bom-csv";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  parseMoney,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

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
const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const OUT_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Update-existing-materials.csv",
);

const HEADERS = [
  "Item variant code / SKU",
  "Default purchase price",
  "Default supplier",
] as const;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  name?: string | null;
  material_id?: number | null;
  product_id?: number | null;
  purchase_price?: number | null;
  deleted_at?: string | null;
};

type LocalTruth = {
  price: number | null;
  priceSource: string;
  supplier: string;
  supplierSource: string;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fetchAllVariants(): Promise<KatanaVariant[]> {
  const all: KatanaVariant[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/variants?include_deleted=false&limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<KatanaVariant>(data);
    all.push(...rows);
    console.log(`  variants page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for /variants (${all.length} rows).`,
  );
}

function latestMaterialListPath(): string | null {
  const dir = join(process.cwd(), "docs", "Katana Downloads");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^MaterialList-.*\.csv$/i.test(f))
    .sort()
    .reverse();
  return files[0] ? join(dir, files[0]) : null;
}

function loadLocalTruth(): Map<string, LocalTruth> {
  const map = new Map<string, LocalTruth>();

  const ensure = (sku: string): LocalTruth => {
    const key = normalizeSku(sku);
    let row = map.get(key);
    if (!row) {
      row = {
        price: null,
        priceSource: "",
        supplier: "",
        supplierSource: "",
      };
      map.set(key, row);
    }
    return row;
  };

  const setPrice = (sku: string, price: number, source: string) => {
    if (!Number.isFinite(price) || price < 0) return;
    const row = ensure(sku);
    // Prefer first non-null from higher-priority callers; callers run in priority order
    if (row.price == null) {
      row.price = price;
      row.priceSource = source;
    }
  };

  const setSupplier = (sku: string, supplier: string, source: string) => {
    const name = supplier.trim();
    if (!name) return;
    const row = ensure(sku);
    if (!row.supplier) {
      row.supplier = name;
      row.supplierSource = source;
    }
  };

  // 1) MaterialList export
  const mlPath = latestMaterialListPath();
  if (mlPath) {
    const rows = readCsvRecords(mlPath);
    console.log(`  loaded MaterialList: ${mlPath} (${rows.length} rows)`);
    for (const r of rows) {
      const sku = normalizeSku(col(r, "Variant code / SKU", "Item variant code / SKU", "SKU"));
      if (!sku) continue;
      const price = parseMoney(col(r, "Default purchase price", "purchase price"));
      if (price != null && price > 0) {
        setPrice(sku, price, "MaterialList");
      }
      setSupplier(
        sku,
        col(r, "Default supplier", "supplier"),
        "MaterialList",
      );
    }
  } else {
    console.log("  MaterialList: (not found)");
  }

  // 2) Vividworks material options (fills STN / sparse costs)
  const vividPath = join(
    process.cwd(),
    "docs",
    "Vividworks",
    "Handoff",
    "vividworks_material_options.csv",
  );
  if (existsSync(vividPath)) {
    const rows = readCsvRecords(vividPath);
    console.log(`  loaded vividworks materials: ${rows.length} rows`);
    for (const r of rows) {
      const sku = normalizeSku(col(r, "Material SKU", "SKU"));
      if (!sku) continue;
      const price = parseMoney(col(r, "Cost Per Unit", "cost"));
      if (price != null && price > 0) {
        // Vivid can override MaterialList $0 STN rows — force if current null OR 0
        const row = ensure(sku);
        if (row.price == null || row.price <= 0) {
          row.price = price;
          row.priceSource = "vividworks_material_options";
        }
      }
    }
  }

  // 3) Bulk material placeholders
  for (const m of KATANA_BULK_MATERIALS) {
    const price = m.baseCost != null ? Number(m.baseCost) : NaN;
    if (Number.isFinite(price) && price > 0) {
      setPrice(m.globalSku, price, "katana-bulk-materials");
    }
  }

  // 4) Cost 2025 rate card — fill remaining blanks (never STN-*)
  // Applied later per live SKU so we only invent for SKUs Katana still has.

  // 5) suppliers.csv
  const suppliersPath = join(process.cwd(), "tmp", "suppliers.csv");
  if (existsSync(suppliersPath)) {
    const rows = readCsvRecords(suppliersPath);
    console.log(`  loaded suppliers.csv: ${rows.length} rows`);
    for (const r of rows) {
      const sku = normalizeSku(col(r, "RM SKU", "SKU"));
      if (!sku) continue;
      setSupplier(sku, col(r, "Supplier Name"), "suppliers.csv");
      const price = parseMoney(col(r, "Purchase Price", "Unit Cost"));
      if (price != null && price > 0) {
        const row = ensure(sku);
        // Explicit supplier PO price wins over rate-card blanks
        row.price = price;
        row.priceSource = "suppliers.csv";
      }
    }
  }

  return map;
}

function resolvePriceForLiveSku(
  sku: string,
  local: LocalTruth | undefined,
): { price: number | null; source: string } {
  if (local?.price != null && local.price > 0) {
    return { price: local.price, source: local.priceSource };
  }
  if (sku.startsWith("STN-")) {
    return { price: null, source: "" };
  }
  const cost2025 = resolveCost2025Price(sku);
  if (cost2025) {
    return { price: cost2025.price, source: cost2025.rule };
  }
  return { price: null, source: "" };
}

async function main(): Promise<void> {
  console.log("Katana Materials Updater (cost + supplier CSV)");
  console.log("  SSOT: live Katana /variants with material_id (NO Postgres)");
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Loading local price/supplier sources");
  const localBySku = loadLocalTruth();
  console.log(`  local SKU keys: ${localBySku.size}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariant[];
  try {
    variants = await fetchAllVariants();
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const materialBySku = new Map<string, KatanaVariant>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    const materialId =
      v.material_id != null ? Number(v.material_id) : NaN;
    if (!Number.isFinite(materialId)) continue;
    if (!materialBySku.has(sku)) materialBySku.set(sku, v);
  }
  console.log(`  live material SKUs: ${materialBySku.size}`);

  const outRows: Array<Array<string | number>> = [[...HEADERS]];
  const plan: string[] = [
    "sku,kat_price,new_price,price_source,supplier,supplier_source,action",
  ];

  let emitted = 0;
  let skippedNoData = 0;

  for (const [sku, variant] of [...materialBySku.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const local = localBySku.get(sku);
    const { price, source } = resolvePriceForLiveSku(sku, local);
    const supplier = local?.supplier ?? "";
    const supplierSource = local?.supplierSource ?? "";

    if ((price == null || price <= 0) && !supplier) {
      skippedNoData += 1;
      continue;
    }

    if (limit != null && emitted >= limit) break;
    emitted += 1;

    outRows.push([
      sku,
      price != null && price > 0 ? price : "",
      supplier,
    ]);

    plan.push(
      [
        sku,
        variant.purchase_price ?? "",
        price ?? "",
        source,
        supplier,
        supplierSource,
        "export",
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    );
  }

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, toKatanaCsv(outRows), "utf8");

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const planPath = join(tmpDir, `katana-materials-updater-${stamp()}.csv`);
  writeFileSync(planPath, `${plan.join("\r\n")}\r\n`, "utf8");

  console.log("");
  console.log("Summary");
  console.log(`  live materials:   ${materialBySku.size}`);
  console.log(`  exported rows:    ${emitted}`);
  console.log(`  skipped no data:  ${skippedNoData}`);
  console.log(`  wrote: ${OUT_CSV}`);
  console.log(`  plan:  ${planPath}`);
  console.log("");
  console.log(
    "Import: Settings → Data import → Update existing materials → Upload",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
