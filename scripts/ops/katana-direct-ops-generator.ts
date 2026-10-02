/**
 * Direct-to-Katana Production Operations generator.
 *
 * Why this exists: the Owner sterilized Katana in-app (deleted hundreds of
 * legacy products). Local Postgres (sku_mappings / item_operations) is out of
 * sync and MUST NOT be used as the product list. Katana live variants are the
 * sole SSOT for which SKUs still exist.
 *
 * Pipeline (no DB):
 *   1. GET /variants (paginate, skip deleted)
 *   2. Keep product variants only (product_id set) — materials cannot receive ops
 *   3. assignStandardTrack(sku) → aluminum_frame | cushion | final_assembly | dekton_top
 *   4. Expand STANDARD_TRACKS → setup/process rows via katana-operations-csv
 *   5. Write docs/Katana Downloads/Katana-Direct-Operations.csv (+ .xlsx)
 *
 * --only-missing-ops (Phase 1 File 4):
 *   GET /product_operation_rows and SKIP any SKU with ≥1 operation row.
 *   Katana ops import ADDS rows — re-importing the $13.07 FIN class would
 *   duplicate labor. Writes numbered artifact 4-Add-Missing-Operations.csv.
 *
 *   npm run ops:katana-direct-ops-generator
 *   npm run ops:katana-direct-ops-generator -- --only-missing-ops
 *   npm run ops:katana-direct-ops-generator -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { assignStandardTrack } from "../../src/lib/factory-routing/assign-track";
import {
  getStandardTrack,
  type StandardTrackId,
} from "../../src/lib/factory-routing/resources";
import {
  planMissingOpsExport,
  summarizeMissingOpsPlan,
  type MissingOpsCandidate,
} from "../../src/lib/katana-cost-gaps";
import { KatanaApiError } from "../../src/lib/katana";
import {
  expandHubOperationsToKatanaCsvRows,
  KATANA_OPERATIONS_CSV_HEADERS,
  toKatanaOperationsCsv,
  trackStepsToHubOperations,
  type HubOperationForExport,
  type KatanaOperationCsvRow,
} from "../../src/lib/katana-operations-csv";
import { REQUEST_DELAY_MS, delay } from "./lib/csv";
import {
  loadProductOperationRows,
  paginateKatana,
} from "./lib/katana-paginate";

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

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const limit = parseLimit();
const onlyMissingOps = hasFlag("--only-missing-ops");

type KatanaVariant = {
  id: number;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
};

type LiveProduct = {
  sku: string;
  name: string;
  variantId: number;
  productId: number;
};

const DOWNLOADS = join(process.cwd(), "docs", "Katana Downloads");
const OUT_CSV = join(DOWNLOADS, "Katana-Direct-Operations.csv");
const OUT_XLSX = join(DOWNLOADS, "Katana-Direct-Operations.xlsx");
const FILE4_CSV = join(DOWNLOADS, "4-Add-Missing-Operations.csv");
const TEMPLATE_XLSX = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-operations-advanced-manufacturing.xlsx",
);

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function countOperations(
  rows: readonly Record<string, unknown>[],
): { byVariant: Map<number, number>; byProduct: Map<number, number> } {
  const byVariant = new Map<number, number>();
  const byProduct = new Map<number, number>();
  for (const row of rows) {
    const variantId = Number(row.product_variant_id ?? row.variant_id ?? NaN);
    if (Number.isFinite(variantId) && variantId > 0) {
      byVariant.set(variantId, (byVariant.get(variantId) ?? 0) + 1);
      continue;
    }
    const productId = Number(row.product_id ?? NaN);
    if (Number.isFinite(productId) && productId > 0) {
      byProduct.set(productId, (byProduct.get(productId) ?? 0) + 1);
    }
  }
  return { byVariant, byProduct };
}

function operationRowCount(
  product: LiveProduct,
  ops: { byVariant: Map<number, number>; byProduct: Map<number, number> },
): number {
  const fromVariant = ops.byVariant.get(product.variantId) ?? 0;
  if (fromVariant > 0) return fromVariant;
  return ops.byProduct.get(product.productId) ?? 0;
}

/**
 * Active Katana *products* only — ops import requires an existing product.
 * Material-only variants (material_id, no product_id) are excluded.
 */
function collectLiveProducts(variants: readonly KatanaVariant[]): LiveProduct[] {
  const bySku = new Map<string, LiveProduct>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    const productId = v.product_id != null ? Number(v.product_id) : NaN;
    if (!Number.isFinite(productId)) continue;
    if (bySku.has(sku)) continue;
    bySku.set(sku, {
      sku,
      name: String(v.name ?? "").trim(),
      variantId: v.id,
      productId,
    });
  }
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

function writeXlsx(
  rows: readonly KatanaOperationCsvRow[],
  outPath: string,
): void {
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

  try {
    copyFileSync(TEMPLATE_XLSX, outPath);
    const wb = XLSX.readFile(outPath);
    const sheetName =
      wb.SheetNames.find((n) => /product\s*operations/i.test(n)) ??
      wb.SheetNames[1] ??
      wb.SheetNames[0];
    if (!sheetName) throw new Error("no sheet");
    wb.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.writeFile(wb, outPath);
  } catch {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    XLSX.utils.book_append_sheet(wb, sheet, "Product operations");
    XLSX.writeFile(wb, outPath);
  }
}

function writePlanCsv(
  path: string,
  rows: Array<{
    sku: string;
    name: string;
    track_id: string;
    reason: string;
    steps: number;
    csv_rows: number;
    include?: boolean;
  }>,
): void {
  const headers = [
    "sku",
    "name",
    "include",
    "track_id",
    "reason",
    "steps",
    "csv_rows",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.sku,
        r.name,
        r.include === false ? "skip" : "include",
        r.track_id,
        r.reason,
        r.steps,
        r.csv_rows,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

async function buildFullExport(products: readonly LiveProduct[]): Promise<{
  hubOps: HubOperationForExport[];
  plan: Array<{
    sku: string;
    name: string;
    track_id: string;
    reason: string;
    steps: number;
    csv_rows: number;
    include?: boolean;
  }>;
  assigned: number;
  skipped: number;
  trackCounts: Map<StandardTrackId, number>;
}> {
  const hubOps: HubOperationForExport[] = [];
  const plan: Array<{
    sku: string;
    name: string;
    track_id: string;
    reason: string;
    steps: number;
    csv_rows: number;
    include?: boolean;
  }> = [];
  const trackCounts = new Map<StandardTrackId, number>();
  let assigned = 0;
  let skipped = 0;

  for (const product of products) {
    const resolved = assignStandardTrack({
      sku: product.sku,
      name: product.name,
    });

    if (!resolved.trackId) {
      skipped += 1;
      continue;
    }

    if (limit != null && assigned >= limit) break;
    assigned += 1;
    trackCounts.set(
      resolved.trackId,
      (trackCounts.get(resolved.trackId) ?? 0) + 1,
    );

    const track = getStandardTrack(resolved.trackId);
    const ops = trackStepsToHubOperations(
      product.sku,
      track,
      product.name,
    );
    hubOps.push(...ops);

    const expanded = expandHubOperationsToKatanaCsvRows(ops);
    plan.push({
      sku: product.sku,
      name: product.name,
      track_id: resolved.trackId,
      reason: resolved.reason,
      steps: track.length,
      csv_rows: expanded.length,
      include: true,
    });
  }

  return { hubOps, plan, assigned, skipped, trackCounts };
}

async function buildMissingOpsExport(
  products: readonly LiveProduct[],
): Promise<{
  hubOps: HubOperationForExport[];
  plan: Array<{
    sku: string;
    name: string;
    track_id: string;
    reason: string;
    steps: number;
    csv_rows: number;
    include?: boolean;
  }>;
  assigned: number;
  skipped: number;
  trackCounts: Map<StandardTrackId, number>;
  skipExistingOps: number;
}> {
  console.log("→ Fetching live /product_operation_rows (skip SKUs that already have ops)");
  const opPayload = await loadProductOperationRows({
    variantIds: products.map((p) => p.variantId),
  });
  if (opPayload.length === 0) {
    throw new Error(
      "FATAL: /product_operation_rows returned 0 rows. Refusing File 4 so existing FIN labor cannot be duplicated.",
    );
  }
  const opsIndex = countOperations(opPayload);
  console.log(`  operation rows ingested: ${opPayload.length}`);
  console.log("");

  const candidates: MissingOpsCandidate[] = products.map((product) => ({
    sku: product.sku,
    name: product.name,
    operationRowCount: operationRowCount(product, opsIndex),
  }));

  const { plan: decisions, hubOps: allHubOps } =
    planMissingOpsExport(candidates);

  const includedDecisions = decisions.filter((row) => row.include);
  const limited =
    limit != null ? includedDecisions.slice(0, limit) : includedDecisions;
  const includedSkus = new Set(limited.map((row) => row.sku));

  const hubOps = allHubOps.filter((op) => includedSkus.has(op.itemSku));
  const trackCounts = new Map<StandardTrackId, number>();
  for (const row of limited) {
    if (!row.trackId) continue;
    trackCounts.set(row.trackId, (trackCounts.get(row.trackId) ?? 0) + 1);
  }

  const summary = summarizeMissingOpsPlan(decisions);
  const plan = decisions.map((row) => {
    const csvRows = row.include
      ? expandHubOperationsToKatanaCsvRows(
          allHubOps.filter((op) => op.itemSku === row.sku),
        ).length
      : 0;
    const stillIncluded = includedSkus.has(row.sku);
    return {
      sku: row.sku,
      name: row.name,
      track_id: row.trackId,
      reason: stillIncluded ? row.reason : row.include ? "skip_limit" : row.reason,
      steps: stillIncluded ? row.steps : 0,
      csv_rows: stillIncluded ? csvRows : 0,
      include: stillIncluded,
    };
  });

  return {
    hubOps,
    plan,
    assigned: limited.length,
    skipped: products.length - limited.length,
    trackCounts,
    skipExistingOps: summary.skipExistingOps,
  };
}

async function main(): Promise<void> {
  console.log("Katana Direct Operations Generator");
  console.log("  SSOT: live Katana /variants (NO local Postgres)");
  console.log("  math: assign-track → STANDARD_TRACKS → SMV baselines");
  console.log(`  mode: ${onlyMissingOps ? "--only-missing-ops (File 4)" : "full catalog"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  console.log("→ Fetching live /variants");
  let variants: KatanaVariant[];
  try {
    variants = (await paginateKatana(
      "/variants?include_deleted=false",
      "variants",
    )) as unknown as KatanaVariant[];
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }
  console.log(`  total variant rows: ${variants.length}`);

  const products = collectLiveProducts(variants);
  console.log(`  active product SKUs: ${products.length}`);
  console.log("");

  const built = onlyMissingOps
    ? await buildMissingOpsExport(products)
    : await buildFullExport(products);

  const csvRows = expandHubOperationsToKatanaCsvRows(built.hubOps);
  const csv = toKatanaOperationsCsv(csvRows);

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, csv, "utf8");
  writeXlsx(csvRows, OUT_XLSX);

  if (onlyMissingOps) {
    writeFileSync(FILE4_CSV, csv, "utf8");
  }

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const planPath = join(
    tmpDir,
    onlyMissingOps
      ? `katana-missing-ops-plan-${stamp()}.csv`
      : `katana-direct-ops-plan-${stamp()}.csv`,
  );
  writePlanCsv(planPath, built.plan);
  writeFileSync(
    join(
      tmpDir,
      onlyMissingOps
        ? `katana-missing-ops-export-${stamp()}.csv`
        : `katana-direct-ops-export-${stamp()}.csv`,
    ),
    csv,
    "utf8",
  );

  if (onlyMissingOps) {
    const included = built.plan.filter((r) => r.include !== false);
    console.log(`Included SKUs (${included.length}):`);
    for (const row of included) {
      console.log(`  INCLUDE  ${row.sku}  ${row.track_id}  ${row.reason}`);
    }
    const skippedRows = built.plan.filter((r) => r.include === false);
    const skipCounts = new Map<string, number>();
    for (const row of skippedRows) {
      skipCounts.set(row.reason, (skipCounts.get(row.reason) ?? 0) + 1);
    }
    console.log("Skip reasons:");
    for (const [reason, n] of [...skipCounts.entries()].sort()) {
      console.log(`  SKIP     ${reason}: ${n}`);
    }
    console.log("");
  }

  console.log("Summary");
  console.log(`  live product SKUs:     ${products.length}`);
  console.log(`  assigned (ops export): ${built.assigned}`);
  console.log(`  skipped:               ${built.skipped}`);
  if (onlyMissingOps && "skipExistingOps" in built) {
    console.log(`    skip_existing_ops:   ${built.skipExistingOps}`);
  }
  for (const id of [
    "aluminum_frame",
    "cushion",
    "final_assembly",
    "dekton_top",
  ] as const) {
    console.log(`    ${id}: ${built.trackCounts.get(id) ?? 0}`);
  }
  console.log(`  Hub track steps:       ${built.hubOps.length}`);
  console.log(`  Katana CSV rows:       ${csvRows.length}`);
  console.log("");
  console.log(`Wrote CSV:  ${OUT_CSV}`);
  if (onlyMissingOps) {
    console.log(`Wrote File 4: ${FILE4_CSV}`);
  }
  console.log(`Wrote XLSX: ${OUT_XLSX}`);
  console.log(`Plan:       ${planPath}`);
  console.log("");
  if (onlyMissingOps) {
    console.log(
      "Import: Settings → Data import → Add new product operations ← 4-Add-Missing-Operations.csv",
    );
    console.log(
      "(Ops import ADDS rows. File 4 lists only SKUs with zero existing operations.)",
    );
  } else {
    console.log(
      "Import: Settings → Data import → Add new product operations → Upload",
    );
    console.log(
      "(Full export. Prefer --only-missing-ops so existing labor is not duplicated.)",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
