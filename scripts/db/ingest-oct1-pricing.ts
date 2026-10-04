/**
 * Ingest the October 1st pricing sheet into the Master Catalog.
 *
 *  - "Matched" rows + valid Global_SKU → UPDATE finished_goods_catalog.msrp
 *  - "Sheet_Only" rows                 → INSERT quarantine_catalog
 *  - "DB_Only" rows (and anything else) are ignored.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/db/ingest-oct1-pricing.ts [--dry-run] [--file=<path>]
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  quarantine_catalog,
} from "../../src/server/db/schema";

const DEFAULT_CSV = "data_migration/Pricing/master_mapping_review.csv";
const DRY_RUN = process.argv.includes("--dry-run");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const CSV_PATH = path.resolve(process.cwd(), fileArg?.slice(7) ?? DEFAULT_CSV);

/**
 * Tolerant parser for this export: every field is wrapped in quotes and fields
 * are joined by `","`, but descriptions contain UNESCAPED inch marks
 * (e.g. `42" x 42"`), which breaks RFC-4180 parsers. We split each line on the
 * `","` delimiter instead. Unquoted lines fall back to a plain comma split.
 */
function parseCsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((line) => {
      if (line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1).split('","');
      }
      return line.split(",");
    });
}


/** "$7,400" → "7400.00"; returns null when not a valid non-negative number. */
function sanitizeMsrp(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null; // rejects "N/A", "", etc.
  return Number(cleaned).toFixed(2);
}

async function main() {
  console.log(`Reading ${CSV_PATH}${DRY_RUN ? "  (DRY RUN — no writes)" : ""}`);
  const [header, ...body] = parseCsv(readFileSync(CSV_PATH, "utf8"));
  const col = (name: string) => {
    const idx = header.findIndex((h) => h.trim() === name);
    if (idx < 0) throw new Error(`Missing column "${name}" in CSV header`);
    return idx;
  };
  const iStatus = col("Match_Status");
  const iSku = col("Global_SKU");
  const iDesc = col("Sheet_Description");
  const iMsrp = col("New_Oct1_MSRP");

  const db = getDb();

  // Existing quarantine descriptions → keeps re-runs from duplicating rows.
  const existingQuarantine = new Set(
    (
      await db
        .select({ d: quarantine_catalog.sheet_description })
        .from(quarantine_catalog)
    ).map((r) => r.d.trim().toLowerCase()),
  );

  let updated = 0;
  let quarantined = 0;
  const skipped: string[] = [];

  for (const [n, r] of body.entries()) {
    const line = n + 2;
    const status = (r[iStatus] ?? "").trim();
    const sku = (r[iSku] ?? "").trim();
    const description = (r[iDesc] ?? "").trim();
    const msrp = sanitizeMsrp(r[iMsrp]);

    if (status.includes("Matched")) {
      if (!sku || sku.toUpperCase() === "N/A" || msrp === null) {
        skipped.push(`line ${line}: Matched but invalid SKU/MSRP (${sku} / ${r[iMsrp]})`);
        continue;
      }
      if (DRY_RUN) {
        updated++;
        continue;
      }
      const res = await db
        .update(finished_goods_catalog)
        .set({ msrp, updated_at: new Date() })
        .where(eq(finished_goods_catalog.global_sku, sku))
        .returning({ sku: finished_goods_catalog.global_sku });
      if (res.length === 0) {
        skipped.push(`line ${line}: ${sku} not found in finished_goods_catalog`);
        continue;
      }
      updated++;
    } else if (status.includes("Sheet_Only")) {
      if (!description || description.toUpperCase() === "N/A") {
        skipped.push(`line ${line}: Sheet_Only with no description`);
        continue;
      }
      const key = description.toLowerCase();
      if (existingQuarantine.has(key)) {
        skipped.push(`line ${line}: "${description}" already quarantined`);
        continue;
      }
      if (!DRY_RUN) {
        await db.insert(quarantine_catalog).values({
          id: randomUUID(),
          sheet_description: description.slice(0, 255),
          target_msrp: msrp, // null when sheet price is not numeric
        });
      }
      existingQuarantine.add(key);
      quarantined++;
    }
  }

  skipped.forEach((s) => console.warn(`  skipped — ${s}`));
  console.log(`Updated ${updated} items`);
  console.log(`Quarantined ${quarantined} items`);
  if (skipped.length) console.log(`Skipped ${skipped.length} rows (see warnings above)`);
}

main()
  .catch((err) => {
    console.error("Ingestion failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
