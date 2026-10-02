/**
 * Parametric Level 2 recipes for live SA-/ASM- frames.
 *
 * SSOT for which SKUs exist: live Katana GET /variants. Local Postgres is
 * never queried. Math lives in src/lib/level2-bom.ts.
 *
 * Output: docs/Katana Downloads/Add-Level2-Recipes.csv
 * Headers: Product variant code / SKU, Ingredient variant code / SKU, Quantity
 *
 *   npm run ops:generate-level2-boms
 *   npm run ops:generate-level2-boms -- --limit=25
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { toKatanaCsv } from "../../src/lib/katana-bom-csv";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import {
  RM_PLASTIC_CAP_2X2,
  RM_POWDER_COAT,
  buildLevel2Plan,
  isLevel2FrameCandidate,
  isSaOrAsmSku,
} from "../../src/lib/level2-bom";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

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
  "Add-Level2-Recipes.csv",
);

const HEADERS = [
  "Product variant code / SKU",
  "Ingredient variant code / SKU",
  "Quantity",
] as const;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  name?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
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

function formatParseLine(
  sku: string,
  plan: ReturnType<typeof buildLevel2Plan>,
): string {
  const p = plan.parsed;
  if (p.family === "skip") {
    return `  skip  ${sku}  (${p.skipReason})`;
  }
  const bits = [
    p.family.padEnd(7),
    sku,
    `W=${p.widthIn}`,
    `D=${p.depthIn}`,
    p.family === "table" ? `H=${p.heightIn}` : `arms=${p.armCount}`,
    `legs=${p.legCount}`,
    `dim=${p.dimSource}`,
    `2x2=${plan.lines.find((l) => l.role === "2x2")?.quantity ?? 0}ft`,
    `pwd=${plan.lines.find((l) => l.role === "powder")?.quantity ?? 0}lb`,
    `caps=${plan.lines.find((l) => l.role === "cap")?.quantity ?? 0}`,
  ];
  return `  ${bits.join("  ")}`;
}

async function main(): Promise<void> {
  console.log("Katana Level 2 BOM generator (SA-/ASM- FRAME → RM)");
  console.log("  SSOT: live Katana /variants (NO Postgres)");
  console.log("  seating: club-chair parametric + scrap 1.08");
  console.log("  tables: coffee-table parametric (H=16 coffee / H=30 dining)");
  console.log(
    `  powder/caps requested: ${RM_POWDER_COAT} / ${RM_PLASTIC_CAP_2X2}`,
  );
  console.log(`  limit: ${limit ?? "(none)"}`);
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

  const liveSkus = new Set<string>();
  const frameSkus: string[] = [];
  const saAsmCount = { sa: 0, asm: 0 };
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(String(v.sku ?? ""));
    if (!sku || !Number.isFinite(v.id)) continue;
    liveSkus.add(sku);
    if (!isSaOrAsmSku(sku)) continue;
    if (sku.startsWith("SA-")) saAsmCount.sa += 1;
    if (sku.startsWith("ASM-")) saAsmCount.asm += 1;
    const productId = v.product_id != null ? Number(v.product_id) : NaN;
    if (!Number.isFinite(productId)) continue;
    if (isLevel2FrameCandidate(sku) && !frameSkus.includes(sku)) {
      frameSkus.push(sku);
    }
  }
  frameSkus.sort();
  console.log(`  live SKUs: ${liveSkus.size}`);
  console.log(`  live SA-*: ${saAsmCount.sa}`);
  console.log(`  live ASM-*: ${saAsmCount.asm}`);
  console.log(`  FRAME/BASE candidates: ${frameSkus.length}`);
  console.log("");

  const powderProbe = buildLevel2Plan(
    frameSkus[0] ?? "SA-BRO-C-72X34-LS-FRAME",
    liveSkus,
  );
  if (powderProbe.powderSku !== RM_POWDER_COAT) {
    console.log(
      `  powder alias: ${RM_POWDER_COAT} → ${powderProbe.powderSku} (Owner SKU not live)`,
    );
  } else {
    console.log(`  powder live: ${powderProbe.powderSku}`);
  }
  if (powderProbe.capSku !== RM_PLASTIC_CAP_2X2) {
    console.log(
      `  cap alias: ${RM_PLASTIC_CAP_2X2} → ${powderProbe.capSku} (Owner SKU not live)`,
    );
  } else {
    console.log(`  cap live: ${powderProbe.capSku}`);
  }
  console.log("");
  console.log("→ Parsing frames");

  const matrix: Array<Array<string | number>> = [[...HEADERS]];
  const planRows: string[] = [
    "parent_sku,family,width,depth,height,arm_count,leg_count,dim_source,ingredient_sku,quantity,role,status",
  ];

  let processed = 0;
  let seating = 0;
  let tables = 0;
  let skipped = 0;
  const skipReasons = new Map<string, number>();
  const roleCounts = { "2x2": 0, slat: 0, flatbar: 0, powder: 0, cap: 0 };

  for (const sku of frameSkus) {
    if (limit != null && processed >= limit) break;
    processed += 1;
    const plan = buildLevel2Plan(sku, liveSkus);
    console.log(formatParseLine(sku, plan));

    if (plan.parsed.family === "skip" || plan.lines.length === 0) {
      skipped += 1;
      const reason = plan.parsed.skipReason ?? "empty_lines";
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      planRows.push(
        [
          sku,
          "skip",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          reason,
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      );
      continue;
    }

    if (plan.parsed.family === "table") tables += 1;
    else seating += 1;

    for (const line of plan.lines) {
      matrix.push([line.parentSku, line.childSku, line.quantity]);
      roleCounts[line.role] += 1;
      planRows.push(
        [
          line.parentSku,
          plan.parsed.family,
          plan.parsed.widthIn,
          plan.parsed.depthIn,
          plan.parsed.heightIn,
          plan.parsed.armCount,
          plan.parsed.legCount,
          plan.parsed.dimSource,
          line.childSku,
          line.quantity,
          line.role,
          "export",
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(","),
      );
    }
  }

  mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, toKatanaCsv(matrix), "utf8");

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const planPath = join(tmpDir, `level2-bom-plan-${stamp()}.csv`);
  writeFileSync(planPath, `${planRows.join("\r\n")}\r\n`, "utf8");
  writeFileSync(
    join(tmpDir, `level2-bom-export-${stamp()}.csv`),
    toKatanaCsv(matrix),
    "utf8",
  );

  console.log("");
  console.log("Summary");
  console.log(`  FRAME/BASE scanned: ${processed}`);
  console.log(`  seating recipes: ${seating}`);
  console.log(`  table recipes: ${tables}`);
  console.log(`  skipped: ${skipped}`);
  for (const [reason, n] of [...skipReasons.entries()].sort()) {
    console.log(`    ${reason}: ${n}`);
  }
  console.log(`  2x2 rows: ${roleCounts["2x2"]}`);
  console.log(`  slat rows: ${roleCounts.slat}`);
  console.log(`  flatbar rows: ${roleCounts.flatbar}`);
  console.log(`  powder rows: ${roleCounts.powder}`);
  console.log(`  cap rows: ${roleCounts.cap}`);
  console.log(`  recipe rows: ${matrix.length - 1}`);
  console.log(`  wrote: ${OUT_CSV}`);
  console.log(`  plan:  ${planPath}`);
  console.log("");
  console.log(
    "Import: Settings → Data import → Add new recipes → Upload",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
