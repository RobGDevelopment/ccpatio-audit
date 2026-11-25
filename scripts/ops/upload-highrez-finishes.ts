/**
 * finishes:upload — gated Supabase uploader for high-rez finish textures.
 * Default: --dry-run (validate 32/32 + dimensions + canonical SKUs).
 * Apply:   --apply   (upload finishes/{sku}/... + persist URLs / scale fields).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ECOMMERCE_32_FINISHES,
  isEcommerce32FinishSku,
} from "../../src/server/ecommerce/ecommerce-32-finish-roster";
import {
  finishTextureObjectPath,
  finishThumbObjectPath,
} from "../../src/server/assets/finish-assets";

const STAGING = "C:\\Workspace\\ccpatio-media-staging";
const MANIFEST_PATH = path.join(STAGING, "processed", "manifest.json");

type ManifestEntry = {
  sku: string;
  display_name: string;
  source_type: "studio_photo" | "synthetic_fallback";
  texture_path: string;
  thumb_path: string;
  repeat_inches: number;
  texture_scale: number;
  sample_width_in: number;
  sample_height_in: number;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
};

type Manifest = {
  count: number;
  entries: ManifestEntry[];
};

export type DryRunResult = {
  ok: boolean;
  count: number;
  errors: string[];
  entries: Array<{
    sku: string;
    source_type: string;
    texture_ok: boolean;
    thumb_ok: boolean;
    storage_texture: string;
    storage_thumb: string;
  }>;
};

export async function validateManifest(manifestPath = MANIFEST_PATH): Promise<DryRunResult> {
  const errors: string[] = [];
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, count: 0, errors: [`manifest missing: ${manifestPath}`], entries: [] };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== 32) {
    errors.push(`Expected 32 entries, got ${manifest.entries?.length ?? 0}`);
  }

  const seen = new Set<string>();
  const roster = new Set(ECOMMERCE_32_FINISHES.map((f) => f.sku));
  const rows: DryRunResult["entries"] = [];

  for (const e of manifest.entries ?? []) {
    if (!isEcommerce32FinishSku(e.sku)) errors.push(`Non-canonical SKU: ${e.sku}`);
    if (seen.has(e.sku)) errors.push(`Duplicate SKU in manifest: ${e.sku}`);
    seen.add(e.sku);
    roster.delete(e.sku);

    let textureOk = false;
    let thumbOk = false;
    if (!fs.existsSync(e.texture_path)) {
      errors.push(`${e.sku}: missing texture ${e.texture_path}`);
    } else {
      const m = await sharp(e.texture_path).metadata();
      textureOk = m.width === 2048 && m.height === 2048;
      if (!textureOk) errors.push(`${e.sku}: texture ${m.width}x${m.height}, need 2048x2048`);
    }
    if (!fs.existsSync(e.thumb_path)) {
      errors.push(`${e.sku}: missing thumb ${e.thumb_path}`);
    } else {
      const m = await sharp(e.thumb_path).metadata();
      thumbOk = m.width === 512 && m.height === 512;
      if (!thumbOk) errors.push(`${e.sku}: thumb ${m.width}x${m.height}, need 512x512`);
    }
    if (!(e.repeat_inches > 0) || !(e.texture_scale > 0)) {
      errors.push(`${e.sku}: invalid repeat_inches/texture_scale`);
    }
    rows.push({
      sku: e.sku,
      source_type: e.source_type,
      texture_ok: textureOk,
      thumb_ok: thumbOk,
      storage_texture: finishTextureObjectPath(e.sku),
      storage_thumb: finishThumbObjectPath(e.sku),
    });
  }

  for (const sku of roster) errors.push(`Missing roster SKU: ${sku}`);

  return {
    ok: errors.length === 0,
    count: manifest.entries?.length ?? 0,
    errors,
    entries: rows,
  };
}

async function applyUpload(manifestPath = MANIFEST_PATH): Promise<void> {
  const dry = await validateManifest(manifestPath);
  if (!dry.ok) {
    throw new Error(`Dry-run validation failed:\n${dry.errors.join("\n")}`);
  }

  // Lazy-load server modules only on --apply (needs env + DB)
  const { getSupabaseAdmin, PRODUCT_IMAGES_BUCKET } = await import("../../src/lib/supabase-storage");
  const { getSupabaseUrl } = await import("../../src/lib/supabase-env");
  const { updateFinishAsset, ensureFinishAssetRow, finishCategoryForSku } = await import(
    "../../src/server/assets/finish-assets"
  );
  const { ecommerceFinishBySku } = await import("../../src/server/ecommerce/ecommerce-32-finish-roster");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
  const supabase = getSupabaseAdmin();
  const base = (getSupabaseUrl() ?? "").replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL required for --apply");

  for (const e of manifest.entries) {
    const def = ecommerceFinishBySku(e.sku);
    const category = finishCategoryForSku(e.sku);
    if (!def || !category) throw new Error(`Unknown finish ${e.sku}`);
    await ensureFinishAssetRow({
      sku: e.sku,
      category,
      display_name: def.displayName,
    });

    const texPath = finishTextureObjectPath(e.sku);
    const thPath = finishThumbObjectPath(e.sku);
    const texBuf = fs.readFileSync(e.texture_path);
    const thBuf = fs.readFileSync(e.thumb_path);

    for (const [objectPath, buf, contentType] of [
      [texPath, texBuf, "image/jpeg"],
      [thPath, thBuf, "image/jpeg"],
    ] as const) {
      const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(objectPath, buf, {
        contentType,
        upsert: true,
      });
      if (error) throw new Error(`Upload ${objectPath}: ${error.message}`);
    }

    const textureUrl = `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${texPath}`;
    const thumbUrl = `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${thPath}`;

    await updateFinishAsset(e.sku, {
      texture_2k_url: textureUrl,
      swatch_thumb_url: thumbUrl,
      sample_width_in: e.sample_width_in,
      sample_height_in: e.sample_height_in,
      pattern_repeat_w_in: e.pattern_repeat_w_in,
      pattern_repeat_h_in: e.pattern_repeat_h_in,
      quality_status: e.source_type === "studio_photo" ? "photoshoot_verified" : "placeholder_lowres",
      uploaded_by: "highrez-swatch-crop-match-upload",
    });
    console.log(`[apply] ${e.sku} → ${texPath}`);
  }
  console.log(`[apply] uploaded ${manifest.entries.length} finishes`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");

  if (apply && process.argv.includes("--dry-run")) {
    console.error("Pass either --dry-run (default) or --apply, not both meaningfully; running apply.");
  }

  if (!apply) {
    const result = await validateManifest();
    console.log(JSON.stringify({ mode: "dry-run", ...result }, null, 2));
    if (!result.ok) process.exit(1);
    console.log(`[dry-run] OK — ${result.count}/32 finishes ready for upload`);
    return;
  }

  // Still validate first
  const result = await validateManifest();
  console.log(JSON.stringify({ mode: "pre-apply-validate", ...result }, null, 2));
  if (!result.ok) process.exit(1);
  await applyUpload();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { MANIFEST_PATH };
