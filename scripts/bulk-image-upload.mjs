/**
 * Bulk-upload SKU photos into the public `product-images` bucket.
 *
 * The showroom resolves each card to `{SKU}.jpg` (SKU trimmed and uppercased).
 * This script writes that exact object name so the UI can load it immediately.
 *
 * Usage (from the repo root):
 *   node scripts/bulk-image-upload.mjs
 *   node scripts/bulk-image-upload.mjs path/to/export.csv
 *
 * Default CSV: scripts/image-mapping.csv
 * Columns: sku, imageUrl
 *   imageUrl may be an http(s) URL or a local file path (relative to the working directory).
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (falls back to SUPABASE_SECRET_KEY)
 *
 * Dependencies already in this repo: @supabase/supabase-js, dotenv, sharp.
 * CSV parsing uses Node (no csv-parse package).
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

dotenv.config({ path: path.join(rootDir, ".env.local"), quiet: true });

function isNewSupabaseApiKey(apiKey) {
  return apiKey.startsWith("sb_publishable_") || apiKey.startsWith("sb_secret_");
}

/** Match src/lib/supabase-env.ts — new keys must not ride on Authorization. */
function createSupabaseFetch(apiKey) {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("apikey")) headers.set("apikey", apiKey);
    if (isNewSupabaseApiKey(apiKey)) {
      const auth = headers.get("Authorization");
      if (auth === `Bearer ${apiKey}` || auth === apiKey) headers.delete("Authorization");
    }
    return fetch(input, { ...init, headers });
  };
}

/** RFC 4180-ish parser. Handles quotes, escaped quotes, and CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

export function rowsFromCsv(text) {
  const table = parseCsv(text);
  if (table.length === 0) return [];

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const skuIndex = header.indexOf("sku");
  const urlIndex = header.indexOf("imageurl");
  const hasHeader = skuIndex >= 0 && urlIndex >= 0;
  const body = hasHeader ? table.slice(1) : table;
  const skuCol = hasHeader ? skuIndex : 0;
  const urlCol = hasHeader ? urlIndex : 1;

  return body.map((cells, index) => ({
    line: hasHeader ? index + 2 : index + 1,
    sku: (cells[skuCol] ?? "").trim(),
    imageUrl: (cells[urlCol] ?? "").trim(),
  }));
}

/** Same object name the showroom requests: `{UPPER-SKU}.jpg`. */
export function objectNameForSku(sku) {
  const clean = sku.trim().toUpperCase();
  if (!SKU_PATTERN.test(clean)) return null;
  return `${clean}.jpg`;
}

function isJpeg(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

async function toJpeg(buffer) {
  if (isJpeg(buffer)) return buffer;
  const sharp = (await import("sharp")).default;
  return sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer();
}

async function loadImage(imageUrl) {
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim());
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error(`response was HTML (${contentType})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const filePath = path.isAbsolute(imageUrl) ? imageUrl : path.resolve(imageUrl);
  return readFile(filePath);
}

async function uploadOne(supabase, row) {
  const fileName = objectNameForSku(row.sku);
  if (!fileName) {
    console.error(`❌ Skipping row ${row.line}: invalid SKU "${row.sku}"`);
    return "skipped";
  }
  if (!row.imageUrl) {
    console.error(`❌ Skipping row ${row.line}: missing image URL for ${fileName}`);
    return "skipped";
  }

  let source;
  try {
    source = await loadImage(row.imageUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to fetch image for ${fileName.replace(/\.jpg$/, "")}: ${message}`);
    return "failed";
  }

  if (source.length === 0) {
    console.error(`❌ Failed to fetch image for ${fileName.replace(/\.jpg$/, "")}: empty file`);
    return "failed";
  }

  let jpeg;
  try {
    jpeg = await toJpeg(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to convert ${fileName} to JPEG: ${message}`);
    return "failed";
  }

  if (jpeg.length > MAX_BYTES) {
    console.error(
      `❌ Failed to upload ${fileName}: ${jpeg.length} bytes exceeds the 5 MB bucket limit`,
    );
    return "failed";
  }

  const { error } = await supabase.storage.from(BUCKET).upload(fileName, jpeg, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) {
    console.error(`❌ Failed to upload ${fileName}: ${error.message}`);
    return "failed";
  }

  console.log(`✅ Uploaded ${fileName}`);
  return "uploaded";
}

async function main() {
  const csvArg = process.argv[2];
  const csvPath = csvArg
    ? path.resolve(csvArg)
    : path.join(scriptDir, "image-mapping.csv");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim()
  );
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) in .env.local",
    );
    process.exitCode = 1;
    return;
  }

  let csvText;
  try {
    csvText = await readFile(csvPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Could not read ${csvPath}: ${message}`);
    process.exitCode = 1;
    return;
  }

  const rows = rowsFromCsv(csvText);
  if (rows.length === 0) {
    console.error(`❌ No data rows in ${csvPath}`);
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch(serviceKey) },
  });

  const counts = { uploaded: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    if (!row.sku || !row.imageUrl) {
      console.error(
        `❌ Skipping row ${row.line}: missing SKU or image URL`,
      );
      counts.skipped += 1;
      continue;
    }
    try {
      const result = await uploadOne(supabase, row);
      counts[result] += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const label = objectNameForSku(row.sku) ?? row.sku;
      console.error(`❌ Failed to upload ${label}: ${message}`);
      counts.failed += 1;
    }
  }

  console.log(
    `Done. uploaded=${counts.uploaded} failed=${counts.failed} skipped=${counts.skipped}`,
  );
  if (counts.failed > 0 || counts.skipped > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    process.exitCode = 1;
  });
}
