/**
 * intake:seed-photoshoot — process + upload all 27 raw studio photos into finish_intake.
 * Default: dry-run. Apply: --apply
 *
 * Uploads:
 *   intake/raw/{folder}/{safe-slug}-orig.jpg  (EXIF-baked, max 2800px, JPEG q92 4:4:4)
 *   finishes/intake/{tmpId}-2048.jpg + -512.jpg (hardware-safe squares; pending only)
 *
 * NEVER overwrites Mia display_name / certified status / customized certified crops.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env.test.local"), override: false });

import { getDb } from "../../src/server/db/client";
import { finish_intake } from "../../src/server/db/schema";
import { ensureFinishIntakeTables } from "../../src/server/ecommerce/finish-intake";
import {
  assertNonBlackSwatch,
  extractProcessedSquareFromMaster,
  inpaintDarkBorderWedges,
  listRawStudioPhotos,
  processStudioPhoto,
  STAGING_ROOT,
} from "./lib/swatch-cv-pipeline";
import {
  getPublicObjectUrl,
  getSupabaseAdmin,
  PRODUCT_IMAGES_BUCKET,
} from "../../src/lib/supabase-storage";

const APPLY = process.argv.includes("--apply");
const MASTER_MAX_EDGE = 2800;

const INTENTIONALLY_DARK = /PV205099|CAN-BLA|CAN-NAV|POS-SAP|BLA-MOO|NILIUM|ENTZO|BLACK/i;

function safeSlug(folder: string, baseName: string): string {
  const folderSlug = folder.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const nameSlug = baseName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${folderSlug}-${nameSlug}`;
}

async function uploadBuf(objectPath: string, buf: Buffer, contentType: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(objectPath, buf, {
    contentType,
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  const sha8 = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
  const base = getPublicObjectUrl(PRODUCT_IMAGES_BUCKET, objectPath);
  return `${base}${base.includes("?") ? "&" : "?"}v=${sha8}`;
}

async function makeCloudMaster(filePath: string): Promise<{
  buf: Buffer;
  width: number;
  height: number;
}> {
  const pipeline = sharp(filePath).rotate().resize({
    width: MASTER_MAX_EDGE,
    height: MASTER_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  const buf = await pipeline
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  const baked = await sharp(buf).metadata();
  return {
    buf,
    width: baked.width ?? 0,
    height: baked.height ?? 0,
  };
}

async function verifyHttp200(url: string): Promise<boolean> {
  try {
    const res = await fetch(url.split("?")[0]!, { method: "HEAD", cache: "no-store" });
    if (res.ok) return true;
    const get = await fetch(url, { method: "GET", cache: "no-store" });
    return get.ok;
  } catch {
    return false;
  }
}

/** Hardware-safe search window on the EXIF-baked master (folder-specific insets). */
function hardwareSearchWindow(
  folder: string,
  w: number,
  h: number,
): { x0: number; y0: number; x1: number; y1: number } {
  if (folder === "Fabrics") {
    // Below top grommets (~22%) and left of right yellow tape (~12%)
    return { x0: Math.floor(w * 0.08), y0: Math.floor(h * 0.22), x1: Math.floor(w * 0.88), y1: Math.floor(h * 0.92) };
  }
  if (folder === "Dekton") {
    // Above bottom stand clips + left of right tape
    return { x0: Math.floor(w * 0.08), y0: Math.floor(h * 0.08), x1: Math.floor(w * 0.88), y1: Math.floor(h * 0.82) };
  }
  // PowderCoat: below top tape, clear of left/right hanging holes
  return { x0: Math.floor(w * 0.18), y0: Math.floor(h * 0.12), x1: Math.floor(w * 0.82), y1: Math.floor(h * 0.9) };
}

async function tryCropCandidate(opts: {
  masterBuf: Buffer;
  cropX: number;
  cropY: number;
  cropSide: number;
  familyHint: "sunbrella" | "ultraleather" | "dekton" | "powder";
  striped: boolean;
  intentionallyDark: boolean;
}): Promise<{
  ok: boolean;
  reason?: string;
  meanL: number;
  textureJpeg?: Buffer;
  thumbJpeg?: Buffer;
}> {
  const extracted = await extractProcessedSquareFromMaster({
    masterPathOrBuf: opts.masterBuf,
    cropX: opts.cropX,
    cropY: opts.cropY,
    cropSide: opts.cropSide,
    familyHint: opts.familyHint,
    striped: opts.striped,
  });
  let rgb = extracted.rgb;
  let qa = assertNonBlackSwatch(rgb, 2048, {
    intentionallyDark: opts.intentionallyDark,
    striped: opts.striped,
    maxDarkBorderFrac: opts.familyHint === "powder" ? 0.015 : 0.005,
  });
  // Extra inpaint pass when mean is healthy but rim wedges remain (tape / table bleed).
  if (!qa.ok && qa.meanL >= 22 && /dark border/i.test(qa.reason)) {
    rgb = inpaintDarkBorderWedges(rgb, 2048, 0.12);
    rgb = inpaintDarkBorderWedges(rgb, 2048, 0.08);
    qa = assertNonBlackSwatch(rgb, 2048, {
      intentionallyDark: opts.intentionallyDark,
      striped: opts.striped,
      maxDarkBorderFrac: 0.02,
    });
    if (qa.ok) {
      const textureJpeg = await sharp(rgb, { raw: { width: 2048, height: 2048, channels: 3 } })
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      const thumbJpeg = await sharp(textureJpeg).resize(512, 512).jpeg({ quality: 90 }).toBuffer();
      return { ok: true, meanL: qa.meanL, textureJpeg, thumbJpeg };
    }
  }
  if (!qa.ok) return { ok: false, reason: qa.reason, meanL: qa.meanL };
  return {
    ok: true,
    meanL: qa.meanL,
    textureJpeg: extracted.textureJpeg,
    thumbJpeg: extracted.thumbJpeg,
  };
}

/**
 * 1) Shrink CV crop toward its center.
 * 2) If still black, grid-search brightest hardware-safe squares on the master.
 */
async function refineCropOnMaster(opts: {
  masterBuf: Buffer;
  masterW: number;
  masterH: number;
  cropX: number;
  cropY: number;
  cropSide: number;
  categoryFolder: string;
  familyHint: "sunbrella" | "ultraleather" | "dekton" | "powder";
  striped: boolean;
  intentionallyDark: boolean;
}): Promise<{
  cropX: number;
  cropY: number;
  cropSide: number;
  textureJpeg: Buffer;
  thumbJpeg: Buffer;
  meanL: number;
  attempts: number;
}> {
  let cropX = opts.cropX;
  let cropY = opts.cropY;
  let cropSide = opts.cropSide;
  let lastReason = "unknown";
  let attempts = 0;

  for (let attempt = 0; attempt < 8; attempt++) {
    attempts++;
    cropSide = Math.max(64, Math.min(cropSide, opts.masterW, opts.masterH));
    cropX = Math.max(0, Math.min(cropX, opts.masterW - cropSide));
    cropY = Math.max(0, Math.min(cropY, opts.masterH - cropSide));

    const hit = await tryCropCandidate({
      masterBuf: opts.masterBuf,
      cropX,
      cropY,
      cropSide,
      familyHint: opts.familyHint,
      striped: opts.striped,
      intentionallyDark: opts.intentionallyDark,
    });
    if (hit.ok && hit.textureJpeg && hit.thumbJpeg) {
      return {
        cropX,
        cropY,
        cropSide,
        textureJpeg: hit.textureJpeg,
        thumbJpeg: hit.thumbJpeg,
        meanL: hit.meanL,
        attempts,
      };
    }
    lastReason = hit.reason ?? lastReason;
    const inset = Math.max(8, Math.round(cropSide * 0.1));
    cropX += inset;
    cropY += inset;
    cropSide -= inset * 2;
    if (cropSide < 160) break;
  }

  // Grid search: pick largest hardware-safe side, walk a coarse grid, keep best mean L*
  const win = hardwareSearchWindow(opts.categoryFolder, opts.masterW, opts.masterH);
  const maxSide = Math.min(win.x1 - win.x0, win.y1 - win.y0);
  const sides = [Math.floor(maxSide * 0.72), Math.floor(maxSide * 0.55)].filter((s) => s >= 200);

  type CropHit = {
    cropX: number;
    cropY: number;
    cropSide: number;
    textureJpeg: Buffer;
    thumbJpeg: Buffer;
    meanL: number;
  };
  let bestHit: CropHit | undefined;

  for (const side of sides) {
    const step = Math.max(80, Math.floor(side * 0.35));
    for (let y = win.y0; y + side <= win.y1; y += step) {
      for (let x = win.x0; x + side <= win.x1; x += step) {
        attempts++;
        const hit = await tryCropCandidate({
          masterBuf: opts.masterBuf,
          cropX: x,
          cropY: y,
          cropSide: side,
          familyHint: opts.familyHint,
          striped: opts.striped,
          intentionallyDark: opts.intentionallyDark,
        });
        if (!(hit.ok && hit.textureJpeg && hit.thumbJpeg)) {
          lastReason = hit.reason ?? lastReason;
          continue;
        }
        const candidate: CropHit = {
          cropX: x,
          cropY: y,
          cropSide: side,
          textureJpeg: hit.textureJpeg,
          thumbJpeg: hit.thumbJpeg,
          meanL: hit.meanL,
        };
        if (!bestHit || candidate.meanL > bestHit.meanL) {
          bestHit = candidate;
        }
        // First healthy hit is enough — stop scanning
        if (candidate.meanL >= 28) {
          return { ...candidate, attempts };
        }
      }
    }
    if (bestHit && bestHit.meanL >= 22) break;
  }

  if (bestHit) {
    return { ...bestHit, attempts };
  }
  throw new Error(`Could not refine non-black crop after grid search: ${lastReason}`);
}

async function main() {
  const photos = await listRawStudioPhotos();
  console.log(`[intake:seed] found ${photos.length} raw studio photos under ${STAGING_ROOT}`);
  if (photos.length !== 27) {
    console.warn(`[intake:seed] expected 27, got ${photos.length}`);
  }

  if (!APPLY) {
    for (const p of photos) console.log(`  dry-run ${p.relative}`);
    console.log(`[intake:seed] dry-run complete — re-run with --apply to upload + upsert finish_intake`);
    return;
  }

  await ensureFinishIntakeTables();
  const db = getDb();
  let ok = 0;
  let fail = 0;
  const httpFails: string[] = [];

  for (const photo of photos) {
    const tmpId = crypto.createHash("sha1").update(photo.relative).digest("hex").slice(0, 12);
    try {
      const sourceKey = photo.relative.replace(/\\/g, "/");
      const existing = await db
        .select()
        .from(finish_intake)
        .where(eq(finish_intake.source_key, sourceKey))
        .limit(1);
      let row = existing[0] ?? null;
      const isCertified = row?.status === "certified";
      const hasMiaName = Boolean(row?.display_name?.trim());
      const mayRefreshCrops = !isCertified && !hasMiaName;

      const familyHint: "sunbrella" | "ultraleather" | "dekton" | "powder" =
        photo.categoryFolder === "Dekton"
          ? "dekton"
          : photo.categoryFolder === "PowderCoat"
            ? "powder"
            : "sunbrella";
      const stripedHint = /PV205022|PV205037|PV205012/i.test(photo.relative);

      const cv = await processStudioPhoto({
        filePath: photo.filePath,
        relative: photo.relative,
        categoryFolder: photo.categoryFolder,
        tmpId: `intake_${tmpId}`,
        familyHint,
        stripedHint,
      });

      const master = await makeCloudMaster(photo.filePath);
      if (master.width <= 0 || master.height <= 0) {
        throw new Error("Cloud master has zero dimensions after EXIF bake");
      }

      const baseName = path.basename(photo.relative).replace(/\.[^.]+$/, "");
      const folder = photo.categoryFolder;
      const slug = safeSlug(folder, baseName);

      // ALWAYS repair raw master URL (fixes pitch-black reference boxes).
      const rawUrl = await uploadBuf(
        `intake/raw/${folder}/${slug}-orig.jpg`,
        master.buf,
        "image/jpeg",
      );

      const sx = master.width / cv.crop_box.sourceWidth;
      const sy = master.height / cv.crop_box.sourceHeight;
      let cropSide = Math.round(cv.crop_box.side * Math.min(sx, sy));
      let cropX = Math.round(cv.crop_box.x * sx);
      let cropY = Math.round(cv.crop_box.y * sy);

      let texUrl = row?.texture_2048_url ?? null;
      let thUrl = row?.thumb_512_url ?? null;
      let sha = row?.texture_sha256 ?? null;
      let meanL = 0;
      let refineAttempts = 0;

      // Persist raw master immediately so pitch-black reference URLs are repaired even if crop refine fails.
      const rawOnlyPatch = {
        category_folder: folder,
        original_filename: path.basename(photo.relative),
        raw_reference_url: rawUrl,
        source_width: master.width,
        source_height: master.height,
        raw_source_file: photo.filePath,
        updated_at: new Date(),
      };
      if (row) {
        await db.update(finish_intake).set(rawOnlyPatch).where(eq(finish_intake.id, row.id));
      } else {
        await db.insert(finish_intake).values({
          source_key: sourceKey,
          ...rawOnlyPatch,
          status: "pending",
        });
        const inserted = await db.select().from(finish_intake).where(eq(finish_intake.source_key, sourceKey)).limit(1);
        row = inserted[0] ?? null;
      }

      if (mayRefreshCrops) {
        const refined = await refineCropOnMaster({
          masterBuf: master.buf,
          masterW: master.width,
          masterH: master.height,
          cropX,
          cropY,
          cropSide,
          categoryFolder: folder,
          familyHint,
          striped: stripedHint || cv.stripe.is_striped || cv.stripe.bimodal,
          intentionallyDark: INTENTIONALLY_DARK.test(photo.relative),
        });
        cropX = refined.cropX;
        cropY = refined.cropY;
        cropSide = refined.cropSide;
        meanL = refined.meanL;
        refineAttempts = refined.attempts;

        fs.mkdirSync(path.dirname(cv.texture_path), { recursive: true });
        fs.writeFileSync(cv.texture_path, refined.textureJpeg);
        fs.writeFileSync(cv.thumb_path, refined.thumbJpeg);

        texUrl = await uploadBuf(
          `finishes/intake/${tmpId}-2048.jpg`,
          refined.textureJpeg,
          "image/jpeg",
        );
        thUrl = await uploadBuf(`finishes/intake/${tmpId}-512.jpg`, refined.thumbJpeg, "image/jpeg");
        sha = crypto.createHash("sha256").update(refined.textureJpeg).digest("hex");

        const cropPatch: Record<string, unknown> = {
          texture_2048_url: texUrl,
          thumb_512_url: thUrl,
          texture_sha256: sha,
          crop_x: cropX,
          crop_y: cropY,
          crop_side_px: cropSide,
          crop_x_norm: String(master.width ? cropX / master.width : 0),
          crop_y_norm: String(master.height ? cropY / master.height : 0),
          crop_side_norm: String(master.width ? cropSide / master.width : 0),
          pattern_mode:
            stripedHint || cv.stripe.is_striped || cv.stripe.bimodal
              ? ("striped" as const)
              : ("solid" as const),
          updated_at: new Date(),
        };
        if (!isCertified) cropPatch.status = "pending";
        await db
          .update(finish_intake)
          .set(cropPatch)
          .where(eq(finish_intake.source_key, sourceKey));
      }

      const httpOk = await verifyHttp200(rawUrl);
      if (!httpOk) httpFails.push(sourceKey);
      ok++;
      console.log(
        `[intake:seed] OK ${photo.relative} master=${master.width}x${master.height} meanL=${meanL.toFixed(1)} refine=${refineAttempts} refreshCrops=${mayRefreshCrops} http=${httpOk ? 200 : "FAIL"}`,
      );
    } catch (err) {
      fail++;
      console.error(`[intake:seed] FAIL ${photo.relative}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[intake:seed] done ok=${ok} fail=${fail} raw_http_fail=${httpFails.length}`);
  if (httpFails.length) {
    console.error(`[intake:seed] raw_reference_url HTTP failures:\n  ${httpFails.join("\n  ")}`);
  }
  if (fail > 0 || httpFails.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
