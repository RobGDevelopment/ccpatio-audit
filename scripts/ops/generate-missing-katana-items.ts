/**
 * Katana "Add new products" CSV for missing monolithic FRAME/CUSH shells.
 *
 * Reads docs/Katana Downloads/2-Add-Monolithic-Level1.csv, diffs ingredient
 * SA-/ASM-*-FRAME and *-CUSH SKUs against live GET /variants, writes:
 *   docs/Katana Downloads/0-Add-Missing-Monolithic-Items.csv
 *
 *   npm run ops:generate-missing-katana-items
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toKatanaCsv } from "../../src/lib/katana-bom-csv";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { humanNameForSaSku } from "../../src/lib/sa-display-name";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const LEVEL1_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "2-Add-Monolithic-Level1.csv",
);

const OUT_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "0-Add-Missing-Monolithic-Items.csv",
);

const HEADERS = [
  "Product name",
  "Variant code / SKU",
  "Category",
  "Unit of measure",
  "Make",
] as const;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  deleted_at?: string | null;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function isFrameOrCushSku(sku: string): boolean {
  const s = normalizeSku(sku);
  if (!s.startsWith("SA-") && !s.startsWith("ASM-")) return false;
  return (
    s.endsWith("-FRAME") ||
    s.endsWith("-CUSH") ||
    s.endsWith("-CUSHION")
  );
}

async function fetchLiveSkus(): Promise<Set<string>> {
  const live = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch(
      `/variants?include_deleted=false&limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<KatanaVariant>(data);
    console.log(`  variants page ${page}: ${rows.length}`);
    for (const v of rows) {
      if (v.deleted_at) continue;
      const sku = normalizeSku(String(v.sku ?? ""));
      if (sku) live.add(sku);
    }
    if (rows.length < PAGE_SIZE) return live;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(`Pagination hit ${MAX_PAGES} full pages for /variants.`);
}

function loadLevel1Ingredients(): string[] {
  if (!existsSync(LEVEL1_CSV)) {
    throw new Error(`Missing Level 1 file: ${LEVEL1_CSV}`);
  }
  const rows = readCsvRecords(LEVEL1_CSV);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const sku = normalizeSku(
      col(
        row,
        "Ingredient variant code / SKU",
        "Ingredient variant code / SKU (required)",
      ),
    );
    if (!isFrameOrCushSku(sku) || seen.has(sku)) continue;
    seen.add(sku);
    out.push(sku);
  }
  out.sort();
  return out;
}

async function main(): Promise<void> {
  console.log("Generate missing monolithic Katana product shells");
  console.log(`  source: ${LEVEL1_CSV}`);
  console.log("");

  const wanted = loadLevel1Ingredients();
  console.log(`  unique FRAME/CUSH ingredients: ${wanted.length}`);
  for (const sku of wanted) {
    console.log(`    need  ${sku}`);
  }
  console.log("");

  console.log("→ Fetching live /variants");
  let live: Set<string>;
  try {
    live = await fetchLiveSkus();
  } catch (err) {
    if (err instanceof KatanaApiError) {
      console.error(`Katana API ${err.status}: ${err.message}`);
    }
    throw err;
  }
  console.log(`  live SKUs: ${live.size}`);
  console.log("");

  const missing = wanted.filter((sku) => !live.has(sku));
  const already = wanted.filter((sku) => live.has(sku));
  console.log("→ Delta");
  for (const sku of already) {
    console.log(`    live   ${sku}`);
  }
  for (const sku of missing) {
    console.log(`    MINT   ${sku}  →  ${humanNameForSaSku(sku)}`);
  }

  const matrix: Array<Array<string | number>> = [
    [...HEADERS],
    ...missing.map((sku) => [
      humanNameForSaSku(sku),
      sku,
      "Sub-Assembly",
      "pcs",
      "Yes",
    ]),
  ];

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, toKatanaCsv(matrix), "utf8");

  console.log("");
  console.log("Summary");
  console.log(`  Level 1 FRAME/CUSH SKUs: ${wanted.length}`);
  console.log(`  already live: ${already.length}`);
  console.log(`  missing (to mint): ${missing.length}`);
  console.log(`  wrote: ${OUT_CSV}`);
  console.log("");
  console.log(
    "Import: Settings → Data import → Add new products → Upload this file",
  );
  console.log("Then import 2-Add-Monolithic-Level1.csv and 3-Add-Monolithic-Level2.csv");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
