/**
 * Cloud-backed Apply Crop — fetches high-res raw_reference_url from Supabase,
 * extracts the operator's 1:1 square, post-processes, uploads 2048+512 with ?v=sha8.
 * Optional local-file fallback is DEV ONLY (never required on Vercel).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/server/db/client";
import { finish_intake } from "@/server/db/schema";
import {
  ensureFinishIntakeTables,
  getFinishIntakeById,
  reCropFinishFromBuffer,
  toFinishIntakeView,
  updateFinishIntakeMeta,
  type FinishIntakeView,
} from "@/server/ecommerce/finish-intake";
import {
  getPublicObjectUrl,
  getSupabaseAdmin,
  PRODUCT_IMAGES_BUCKET,
} from "@/lib/supabase-storage";

export type ApplyIntakeCropInput = {
  id: string;
  cropX: number;
  cropY: number;
  cropSidePx: number;
  sourceWidth: number;
  sourceHeight: number;
};

async function loadMasterBytes(opts: {
  rawReferenceUrl: string | null;
  rawSourceFile: string | null;
}): Promise<{ bytes: Buffer; from: "cloud" | "local" }> {
  const url = opts.rawReferenceUrl?.trim() || null;
  if (url) {
    const clean = url.split("?")[0]!;
    // Prefer storage.download when URL is our public bucket object
    try {
      const marker = `/object/public/${PRODUCT_IMAGES_BUCKET}/`;
      const idx = clean.indexOf(marker);
      if (idx >= 0) {
        const objectPath = decodeURIComponent(clean.slice(idx + marker.length));
        const { data, error } = await getSupabaseAdmin()
          .storage.from(PRODUCT_IMAGES_BUCKET)
          .download(objectPath);
        if (!error && data) {
          return { bytes: Buffer.from(await data.arrayBuffer()), from: "cloud" };
        }
      }
    } catch {
      // fall through to fetch
    }
    const res = await fetch(clean, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Could not fetch reference image (HTTP ${res.status})`);
    }
    return { bytes: Buffer.from(await res.arrayBuffer()), from: "cloud" };
  }

  // DEV-ONLY fallback — never available on Vercel Linux serverless
  if (
    process.env.NODE_ENV !== "production" &&
    opts.rawSourceFile &&
    fs.existsSync(opts.rawSourceFile)
  ) {
    return { bytes: fs.readFileSync(opts.rawSourceFile), from: "local" };
  }

  throw new Error("No uncropped reference image available for this item");
}

async function uploadCropJpeg(objectPath: string, buf: Buffer, sha8: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(objectPath, buf, {
    contentType: "image/jpeg",
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  const base = getPublicObjectUrl(PRODUCT_IMAGES_BUCKET, objectPath);
  return `${base}${base.includes("?") ? "&" : "?"}v=${sha8}`;
}

/**
 * Apply a 1:1 crop against the cloud master. Crop coords are in the same pixel
 * space as `sourceWidth`×`sourceHeight` (the uploaded EXIF-baked master).
 */
export async function applyIntakeCropFromCloud(
  input: ApplyIntakeCropInput,
): Promise<{ ok: true; view: FinishIntakeView; source: "cloud" | "local" } | { ok: false; error: string }> {
  await ensureFinishIntakeTables();
  const current = await getFinishIntakeById(input.id);
  if (!current) return { ok: false, error: "Intake item not found" };
  if (current.status === "certified") {
    return { ok: false, error: "Item is already certified — crop is locked" };
  }
  if (
    input.cropX + input.cropSidePx > input.sourceWidth ||
    input.cropY + input.cropSidePx > input.sourceHeight
  ) {
    return { ok: false, error: "Crop square extends outside the source image" };
  }

  let master: { bytes: Buffer; from: "cloud" | "local" };
  try {
    master = await loadMasterBytes({
      rawReferenceUrl: current.rawReferenceUrl,
      rawSourceFile: current.rawSourceFile,
    });
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to load master" };
  }

  const oriented = sharp(master.bytes).rotate();
  const meta = await oriented.metadata();
  const refW = meta.width ?? 0;
  const refH = meta.height ?? 0;
  if (refW <= 0 || refH <= 0) {
    return { ok: false, error: "Reference image has no readable size" };
  }

  // Map operator coords (sourceWidth/Height space) → actual master pixels.
  const scaleX = refW / input.sourceWidth;
  const scaleY = refH / input.sourceHeight;
  if (Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > 0.02) {
    return {
      ok: false,
      error: "Reference aspect ratio does not match the source dimensions — re-seed this item",
    };
  }
  const refSide = Math.max(8, Math.round(input.cropSidePx * scaleX));
  const refX = Math.min(Math.round(input.cropX * scaleX), Math.max(0, refW - refSide));
  const refY = Math.min(Math.round(input.cropY * scaleY), Math.max(0, refH - refSide));

  const cropped = await reCropFinishFromBuffer({
    sourceBytes: master.bytes,
    cropX: refX,
    cropY: refY,
    cropSidePx: refSide,
    patternMode: current.patternMode,
    materialClass: current.materialClass,
  });

  const sha8 = cropped.sha256.slice(0, 8);
  const textureUrl = await uploadCropJpeg(
    `intake/crops/${input.id}/${input.id}-2048.jpg`,
    cropped.texture2048,
    sha8,
  );
  const thumbUrl = await uploadCropJpeg(
    `intake/crops/${input.id}/${input.id}-512.jpg`,
    cropped.thumb512,
    sha8,
  );

  await updateFinishIntakeMeta(input.id, {
    cropX: input.cropX,
    cropY: input.cropY,
    cropSidePx: input.cropSidePx,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    ...(current.status === "pending" ? { status: "crop_verified" as const } : {}),
  });

  const db = getDb();
  const [row] = await db
    .update(finish_intake)
    .set({
      texture_2048_url: textureUrl,
      thumb_512_url: thumbUrl,
      texture_sha256: cropped.sha256,
      ...(current.status === "pending" ? { status: "crop_verified" as const } : {}),
      updated_at: new Date(),
    })
    .where(eq(finish_intake.id, input.id))
    .returning();

  if (!row) return { ok: false, error: "Failed to persist crop URLs" };
  return { ok: true, view: toFinishIntakeView(row), source: master.from };
}

/** Pure helper used by tests — proves crop path never requires a Windows staging root. */
export function assertCloudCropPathIsPortable(sourcePathUsed: string | null | undefined): boolean {
  if (!sourcePathUsed) return true;
  // Production path must not depend on local staging.
  return !/^[A-Za-z]:\\/.test(sourcePathUsed) && !sourcePathUsed.includes("ccpatio-media-staging");
}

export function cacheBustHasSha8(url: string): boolean {
  return /[?&]v=[a-f0-9]{8}\b/i.test(url);
}

export { createHash };
