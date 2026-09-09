/**
 * Seed Katana finished-good shells for every Phase 1 and Phase 2 SOW product.
 *
 * Master-data only. Reads the relational handoff CSVs from script 04.
 * Does not write sales orders, MOs, or recipes.
 *
 * Usage:
 *   npx tsx scripts/vividworks/05-seed-all-katana-phases.ts
 *   npx tsx scripts/vividworks/05-seed-all-katana-phases.ts --dry-run
 *   npx tsx scripts/vividworks/05-seed-all-katana-phases.ts --live --phase all
 *   npx tsx scripts/vividworks/05-seed-all-katana-phases.ts --live --phase 1 --limit 10
 *
 * Env: KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY)
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

const HANDOFF_DIR = path.resolve(process.cwd(), "docs/Vividworks/Handoff");
const PHASE1_CSV = path.join(HANDOFF_DIR, "vividworks_phase1_products.csv");
const PHASE2_CSV = path.join(HANDOFF_DIR, "vividworks_phase2_products.csv");

type PhaseFlag = 1 | 2 | "all";
type SeedResult = "created" | "skipped_existing" | "failed" | "dry_run";

type HandoffRow = {
  phase: 1 | 2;
  sowName: string;
  canonicalSku: string;
  seedSku: string;
  collection: string;
  msrp: string;
};

const LIVE = process.argv.includes("--live");
const DRY_RUN = process.argv.includes("--dry-run") || !LIVE;

function readArg(name: string): string | null {
  const flag = `--${name}`;
  const idx = process.argv.indexOf(flag);
  if (idx >= 0) {
    const value = process.argv[idx + 1];
    if (value && !value.startsWith("--")) return value;
  }
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

function readLimit(): number | null {
  const raw = readArg("limit");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function readPhase(): PhaseFlag {
  const raw = (readArg("phase") ?? "all").trim().toLowerCase();
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  return "all";
}

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function readPhaseCsv(filePath: string, phase: 1 | 2): HandoffRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Missing ${filePath}. Run npx tsx scripts/vividworks/04-generate-complete-sow-datapack.ts first.`,
    );
  }
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows
    .map((row) => ({
      phase,
      sowName: cellText(row["SOW Product Name"]),
      canonicalSku: cellText(row["Canonical SKU"]).toUpperCase(),
      seedSku: cellText(row["Canonical SKU"]).toUpperCase(),
      collection: cellText(row["Collection"]),
      msrp: cellText(row["MSRP"]),
    }))
    .filter((row) => row.canonicalSku);
}

function slugToken(name: string, sku: string): string {
  const skuBits = new Set(sku.split("-").filter(Boolean));
  const skip = new Set([
    "THE",
    "AND",
    "WITH",
    "FOR",
    "FROM",
    "BRAVADA",
    "BROOKLYN",
    "OCEAN",
    "MILAN",
    "TAYLOR",
    "DAISY",
    "WATERFALL",
    "CABANA",
    "FLEXY",
  ]);
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length >= 3 &&
        !skuBits.has(word) &&
        !skip.has(word) &&
        !/^\d/.test(word),
    );
  const token = words.slice(0, 2).join("").slice(0, 14);
  return token || "DUP";
}

function uniquifySkus(rows: HandoffRow[]): HandoffRow[] {
  const taken = new Set<string>();
  const out: HandoffRow[] = [];
  for (const row of rows) {
    let sku = row.canonicalSku;
    if (taken.has(sku)) {
      const suffix = slugToken(row.sowName, sku);
      let candidate = `${sku}-${suffix}`;
      let n = 2;
      while (taken.has(candidate)) {
        candidate = `${sku}-${suffix}${n}`;
        n += 1;
      }
      console.log(
        `[seed] collision ${sku} ← "${row.sowName}" seeded as ${candidate}`,
      );
      sku = candidate;
    }
    taken.add(sku);
    out.push({ ...row, seedSku: sku });
  }
  return out;
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
      error.details !== undefined
        ? ` details=${JSON.stringify(error.details)}`
        : "";
    return `HTTP ${error.status} ${error.message}${details}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function seedOne(
  row: HandoffRow,
  index: number,
  total: number,
): Promise<SeedResult> {
  const flags = katanaProductSyncFlags("finished_good");
  const salesPrice = parseMoney(row.msrp);
  const payload = {
    name: row.sowName.trim() || row.seedSku,
    uom: "pcs",
    category_name: row.collection.trim() || "Finished Good",
    is_sellable: flags.is_sellable,
    is_producible: flags.is_producible,
    is_purchasable: flags.is_purchasable,
    additional_info: `SOW Phase ${row.phase} | hub ${row.canonicalSku}`,
    variants: [
      {
        sku: row.seedSku,
        ...(salesPrice !== null ? { sales_price: salesPrice } : {}),
      },
    ],
  };

  const prefix = `[${index + 1}/${total}] P${row.phase} ${row.seedSku}`;

  if (DRY_RUN) {
    console.log(`${prefix} DRY-RUN would POST /products`, {
      name: payload.name,
      collection: payload.category_name,
      sales_price: salesPrice,
      flags,
    });
    return "dry_run";
  }

  try {
    const existing = await findVariantBySku(row.seedSku);
    if (existing) {
      console.log(
        `${prefix} [EXISTS] variant #${existing.id} type=${existing.type}`,
      );
      return "skipped_existing";
    }

    const { data, status } = await katanaFetch<Record<string, unknown>>(
      "/products",
      {
        method: "POST",
        body: payload,
        idempotencyKey: `katana-shell-${row.seedSku}`,
      },
    );
    const created = extractCreatedIds(data);
    console.log(
      `${prefix} CREATED HTTP ${status} productId=${created.productId} variantId=${created.variantId}`,
    );
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
  const phase = readPhase();
  const limit = readLimit();

  const phase1 = phase === 2 ? [] : readPhaseCsv(PHASE1_CSV, 1);
  const phase2 = phase === 1 ? [] : readPhaseCsv(PHASE2_CSV, 2);
  const uniquified = uniquifySkus([...phase1, ...phase2]);
  const rows = limit ? uniquified.slice(0, limit) : uniquified;

  console.log("[seed] Katana FG shells", {
    phase1: phase1.length,
    phase2: phase2.length,
    afterDedupe: uniquified.length,
    seeding: rows.length,
    mode: DRY_RUN ? "dry-run" : "LIVE",
    phase,
    limit: limit ?? "none",
  });

  if (!DRY_RUN) {
    const token =
      process.env.KATANA_PERSONAL_ACCESS_TOKEN?.trim() ||
      process.env.KATANA_API_KEY?.trim();
    if (!token) {
      throw new Error(
        "Missing KATANA_PERSONAL_ACCESS_TOKEN (or KATANA_API_KEY).",
      );
    }
    setKatanaRequestPacer(createIntervalPacer(1100));
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

  console.log("[seed] summary", {
    total: rows.length,
    created: counts.created,
    skippedExisting: counts.skipped_existing,
    failed: counts.failed,
    dryRun: counts.dry_run,
  });

  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("[seed] fatal", error);
  process.exit(1);
});
