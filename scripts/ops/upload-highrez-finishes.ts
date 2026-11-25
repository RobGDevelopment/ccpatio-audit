/**
 * finishes:upload — gated Supabase uploader for high-rez finish textures.
 * Default: --dry-run (validate 32/32 + dimensions + canonical SKUs).
 * Apply:   --apply   (upload finishes/{sku}/... + persist cache-busted URLs / scale / provenance).
 */
import crypto from "node:crypto";
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
  withCacheBustQuery,
  deriveFinishPhysicalScale,
} from "../../src/server/assets/finish-assets";
import { verifyAllProcessed } from "./lib/swatch-pixel-qa";

const STAGING = "C:\\Workspace\\ccpatio-media-staging";
const MANIFEST_PATH = path.join(STAGING, "processed", "manifest.json");

type ManifestEntry = {
  sku: string;
  display_name: string;
  family: string;
  source_type: "studio_photo" | "synthetic_fallback";
  source_file?: string | null;
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
    const scale = deriveFinishPhysicalScale({ sku: e.sku });
    if (e.texture_scale !== scale.texture_scale) {
      errors.push(
        `${e.sku}: texture_scale ${e.texture_scale} != uniform family scale ${scale.texture_scale}`,
      );
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

  // Pixel QA gate
  if (manifest.entries?.length === 32) {
    const qa = await verifyAllProcessed(
      manifest.entries.map((e) => ({
        sku: e.sku,
        texture_path: e.texture_path,
        thumb_path: e.thumb_path,
        family: e.family,
      })),
    );
    for (const issue of qa.issues) {
      errors.push(`pixel-qa ${issue.sku} ${issue.code}: ${issue.detail}`);
    }
  }

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

  const { getSupabaseAdmin, PRODUCT_IMAGES_BUCKET } = await import("../../src/lib/supabase-storage");
  const { getSupabaseUrl } = await import("../../src/lib/supabase-env");
  const {
    updateFinishAsset,
    ensureFinishAssetRow,
    ensureFinishAssetProvenanceColumns,
    finishCategoryForSku,
  } = await import("../../src/server/assets/finish-assets");
  const { ecommerceFinishBySku } = await import("../../src/server/ecommerce/ecommerce-32-finish-roster");

  await ensureFinishAssetProvenanceColumns();

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

    const scale = deriveFinishPhysicalScale({ sku: e.sku, family: def.family });
    const texPath = finishTextureObjectPath(e.sku);
    const thPath = finishThumbObjectPath(e.sku);
    const texBuf = fs.readFileSync(e.texture_path);
    const thBuf = fs.readFileSync(e.thumb_path);
    const sha256 = crypto.createHash("sha256").update(texBuf).digest("hex");
    const texMeta = await sharp(texBuf).metadata();

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

    const textureUrl = withCacheBustQuery(
      `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${texPath}`,
      sha256,
    );
    const thumbUrl = withCacheBustQuery(
      `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${thPath}`,
      sha256,
    );

    const quality =
      e.source_type === "studio_photo" || (texMeta.width === 2048 && texMeta.height === 2048)
        ? "photoshoot_verified"
        : "placeholder_lowres";

    await updateFinishAsset(e.sku, {
      texture_2k_url: textureUrl,
      swatch_thumb_url: thumbUrl,
      sample_width_in: scale.sample_width_in,
      sample_height_in: scale.sample_height_in,
      pattern_repeat_w_in: scale.pattern_repeat_w_in,
      pattern_repeat_h_in: scale.pattern_repeat_h_in,
      texture_sha256: sha256,
      source_type: e.source_type,
      source_filename: e.source_file ?? null,
      texture_width_px: texMeta.width ?? 2048,
      texture_height_px: texMeta.height ?? 2048,
      quality_status: quality,
      uploaded_by: "swatch-cv-recrop-scale-lightbox",
    });

    // /embed/showroom Current Inventory resolves FAB-/DKT- thumbs via ecommerce_finish_assets
    // (cache-busted swatch_thumb_url / texture_2k_url written above).

    console.log(
      `[apply] ${e.sku} → ${texPath}?v=${sha256.slice(0, 8)} sha256=${sha256.slice(0, 12)}… ${texMeta.width}x${texMeta.height}`,
    );
  }
  console.log(`[apply] uploaded ${manifest.entries.length} finishes with cache-bust ?v=`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  if (!apply) {
    const result = await validateManifest();
    console.log(JSON.stringify({ mode: "dry-run", ...result }, null, 2));
    if (!result.ok) process.exit(1);
    console.log(`[dry-run] OK — ${result.count}/32 finishes ready for upload`);
    return;
  }

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
