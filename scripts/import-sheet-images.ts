/**
 * One-off bulk import: Google Sheet HTML export → Supabase product-images + catalog.
 *
 * Prerequisites:
 *   cd middleware
 *   npm install cheerio
 *
 * Usage:
 *   npx tsx scripts/import-sheet-images.ts
 *
 * Env (.env.local):
 *   POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Google Sheets export must include the `resources/` folder (cellImage_*.jpg).
 * Re-export File → Download → Web Page (.html) and copy the whole folder.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { eq, sql } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractProductNameFromMemo,
  finishedGoodSkuCandidates,
  normalizeCatalogText,
} from "../src/lib/finished-good-sku";
import { generateFinishedGoodSku } from "../src/lib/sku-engine";
import { closeDb, getDb } from "../src/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "../src/server/db/schema";

loadEnvConfig(process.cwd());

const BUCKET = "product-images";
const HTML_PATH = path.resolve(
  process.cwd(),
  "..",
  "docs",
  "data_sheets",
  "Website Product Info HTML",
  "Website Products.html",
);
const HTML_DIR = path.dirname(HTML_PATH);
const RESOURCES_DIR = path.join(HTML_DIR, "resources");

const COLLECTION_COL = 2;
const SKU_OR_MEMO_COL = 3;

type ParsedRow = {
  rowIndex: number;
  imageSrc: string;
  collection: string;
  rawSkuOrMemo: string;
};

type SkuLookup = {
  byGlobalSku: Set<string>;
  byOriginalName: Map<string, string>;
  byDescription: Map<string, string>;
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function cellText($: cheerio.CheerioAPI, cell: Element): string {
  return decodeHtmlEntities($(cell).text()).replace(/\s+/g, " ").trim();
}

function formatBaseSku(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) {
    return null;
  }
  if (cleaned.startsWith("FIN-")) {
    return cleaned;
  }
  return `FIN-${cleaned}`;
}

/** Compact E2E token like BRV-SWV-34X34 or FIN-BRV-SWC-34. */
function looksLikeBaseSku(text: string): boolean {
  const compact = text.trim().toUpperCase().replace(/\s+/g, "");
  return /^(FIN-)?[A-Z]{2,4}(-[A-Z]{2,4}){1,4}(-[\dX]+)?$/i.test(compact);
}

function parseDimensionsFromMemo(memo: string): { length: string; depth: string } {
  const normalized = memo.replace(/"/g, "");
  const match = normalized.match(/(\d{2,3})\s*[xX×]\s*(\d{2,3})/);
  if (match) {
    return { length: match[1], depth: match[2] };
  }
  const single = normalized.match(/\b(\d{2,3})\b/);
  return { length: single?.[1] ?? "", depth: "" };
}

function resolveGlobalSku(row: ParsedRow, lookup: SkuLookup): string | null {
  const raw = row.rawSkuOrMemo.trim();
  if (!raw) {
    return null;
  }

  if (looksLikeBaseSku(raw)) {
    const direct = formatBaseSku(raw);
    if (direct && lookup.byGlobalSku.has(direct)) {
      return direct;
    }
  }

  const productName = extractProductNameFromMemo(raw);
  const byOriginalName = lookup.byOriginalName.get(productName);
  if (byOriginalName) {
    return byOriginalName;
  }

  const { length, depth } = parseDimensionsFromMemo(raw);
  const engineSku = generateFinishedGoodSku(raw, row.collection, length, depth);
  if (lookup.byGlobalSku.has(engineSku)) {
    return engineSku;
  }

  for (const candidate of finishedGoodSkuCandidates(productName)) {
    if (lookup.byGlobalSku.has(candidate)) {
      return candidate;
    }
  }

  // Description fallback only when memo is not a dimensional product line (accessories, etc.)
  if (!/\d{2,3}\s*[xX×]\s*\d{2,3}/.test(raw)) {
    const normalizedMemo = normalizeCatalogText(raw);
    const byDescription = lookup.byDescription.get(normalizedMemo);
    if (byDescription) {
      return byDescription;
    }
  }

  if (looksLikeBaseSku(raw)) {
    return formatBaseSku(raw);
  }

  return engineSku ?? finishedGoodSkuCandidates(productName)[0] ?? null;
}

async function buildSkuLookup(): Promise<SkuLookup> {
  const db = getDb();
  const rows = await db
    .select({
      global_sku: sku_mappings.global_sku,
      original_name: sku_mappings.original_name,
      description: finished_goods_catalog.description,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    );

  const byGlobalSku = new Set<string>();
  const byOriginalName = new Map<string, string>();
  const byDescription = new Map<string, string>();

  for (const row of rows) {
    byGlobalSku.add(row.global_sku);
    byOriginalName.set(normalizeCatalogText(row.original_name), row.global_sku);
    if (row.description) {
      byDescription.set(normalizeCatalogText(row.description), row.global_sku);
    }
  }

  return { byGlobalSku, byOriginalName, byDescription };
}

function resolveLocalImagePath(src: string): string {
  const normalized = src.replace(/^\.\//, "").replace(/\\/g, "/");
  const relative = normalized.startsWith("resources/")
    ? normalized
    : path.join("resources", path.basename(normalized));
  return path.join(HTML_DIR, relative);
}

function sanitizeUploadName(globalSku: string, ext: string): string {
  const safeSku = globalSku.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
  return `${safeSku}.${safeExt}`;
}

function contentTypeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "image/jpeg";
  }
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseHtmlRows(html: string): ParsedRow[] {
  const $ = cheerio.load(html);
  const rows: ParsedRow[] = [];

  $("tr").each((rowIndex, tr) => {
    const cells = $(tr).find("td").toArray();
    if (cells.length <= SKU_OR_MEMO_COL) {
      return;
    }

    const img = $(tr).find("img").first();
    const src = img.attr("src")?.trim();
    if (!src || !src.includes("cellImage")) {
      return;
    }

    rows.push({
      rowIndex,
      imageSrc: src,
      collection: cellText($, cells[COLLECTION_COL]),
      rawSkuOrMemo: cellText($, cells[SKU_OR_MEMO_COL]),
    });
  });

  return rows;
}

async function countResourceImages(): Promise<number> {
  try {
    const entries = await readdir(RESOURCES_DIR);
    return entries.filter((name) => /^cellImage_.*\.(jpe?g|png|webp|gif|avif)$/i.test(name))
      .length;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  console.log("Reading HTML:", HTML_PATH);
  const html = await readFile(HTML_PATH, "utf8");
  const parsedRows = parseHtmlRows(html);
  console.log(`Found ${parsedRows.length} rows with images.`);

  if (parsedRows.length === 0) {
    console.log("[SKIPPED] No image rows found — nothing to import.");
    return;
  }

  const resourceImages = await countResourceImages();
  console.log(`Resource images on disk: ${resourceImages}`);
  if (resourceImages === 0) {
    console.log(
      "[WARN] No cellImage_* files in resources/. Re-export the Google Sheet as Web Page (.html) and copy the entire folder including resources/.",
    );
  }

  const lookup = await buildSkuLookup();
  console.log(`Loaded ${lookup.byGlobalSku.size} sku_mappings for lookup.`);

  const supabase = getSupabaseAdmin();
  const db = getDb();

  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of parsedRows) {
    const globalSku = resolveGlobalSku(row, lookup);
    if (!globalSku) {
      skipped++;
      console.log(
        `[SKIPPED] Row ${row.rowIndex}: blank SKU/memo (src=${row.imageSrc})`,
      );
      continue;
    }

    if (!lookup.byGlobalSku.has(globalSku)) {
      skipped++;
      console.log(
        `[SKIPPED] Row ${row.rowIndex} (${globalSku}): SKU not in sku_mappings (memo=${row.rawSkuOrMemo.slice(0, 60)})`,
      );
      continue;
    }

    const localPath = resolveLocalImagePath(row.imageSrc);
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(await readFile(localPath));
    } catch {
      errors++;
      console.log(
        `[ERROR] Row ${row.rowIndex} (${globalSku}): missing local file ${localPath}`,
      );
      continue;
    }

    const ext = path.extname(localPath).slice(1) || "jpg";
    const uploadName = sanitizeUploadName(globalSku, ext);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(uploadName, fileBuffer, {
        upsert: true,
        contentType: contentTypeForExt(ext),
      });

    if (uploadError) {
      errors++;
      console.log(
        `[ERROR] Row ${row.rowIndex} (${globalSku}): upload failed — ${uploadError.message}`,
      );
      continue;
    }

    const { data: publicData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(uploadName);
    const imageUrl = publicData.publicUrl;

    try {
      await db
        .insert(finished_goods_catalog)
        .values({
          global_sku: globalSku,
          image_url: imageUrl,
        })
        .onConflictDoUpdate({
          target: finished_goods_catalog.global_sku,
          set: {
            image_url: sql`excluded.image_url`,
            updated_at: sql`now()`,
          },
        });

      success++;
      console.log(`[SUCCESS] Row ${row.rowIndex} (${globalSku}) → ${imageUrl}`);
    } catch (error: unknown) {
      errors++;
      const message =
        error instanceof Error ? error.message : "Unknown database error";
      console.log(
        `[ERROR] Row ${row.rowIndex} (${globalSku}): catalog upsert failed — ${message}`,
      );
    }
  }

  console.log("\n--- Import summary ---");
  console.log(`[SUCCESS] ${success}`);
  console.log(`[SKIPPED] ${skipped}`);
  console.log(`[ERROR]   ${errors}`);
  console.log(`Resources dir: ${RESOURCES_DIR}`);
}

main()
  .catch((error: unknown) => {
    console.error("[ERROR] Fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
