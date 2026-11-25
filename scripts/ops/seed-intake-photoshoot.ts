/**
 * intake:seed-photoshoot — process + upload all 27 raw studio photos into finish_intake.
 * Default: dry-run. Apply: --apply
 *
 * Uploads BOTH:
 *   intake/raw/{folder}/{file}-orig.jpg  (max 1400px uncropped reference)
 *   finishes/intake/{tmpId}-2048.jpg + -512.jpg (hardware-safe squares)
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

async function uploadBuf(objectPath: string, buf: Buffer, contentType: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(objectPath, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`${objectPath}: ${error.message}`);
  const sha8 = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
  const base = getPublicObjectUrl(PRODUCT_IMAGES_BUCKET, objectPath);
  return `${base}${base.includes("?") ? "&" : "?"}v=${sha8}`;
}

async function makeOrigReference(filePath: string): Promise<Buffer> {
  return sharp(filePath)
    .rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
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

  for (const photo of photos) {
    const tmpId = crypto
      .createHash("sha1")
      .update(photo.relative)
      .digest("hex")
      .slice(0, 12);
    try {
      const cv = await processStudioPhoto({
        filePath: photo.filePath,
        relative: photo.relative,
        categoryFolder: photo.categoryFolder,
        tmpId: `intake_${tmpId}`,
        familyHint:
          photo.categoryFolder === "Dekton"
            ? "dekton"
            : photo.categoryFolder === "PowderCoat"
              ? "powder"
              : "sunbrella",
        stripedHint: /PV205022|PV205037|PV205012/i.test(photo.relative),
      });

      const origBuf = await makeOrigReference(photo.filePath);
      const textureBuf = fs.readFileSync(cv.texture_path);
      const thumbBuf = fs.readFileSync(cv.thumb_path);
      const baseName = path.basename(photo.relative).replace(/\.[^.]+$/, "");
      const folder = photo.categoryFolder;

      const rawUrl = await uploadBuf(
        `intake/raw/${folder}/${baseName}-orig.jpg`,
        origBuf,
        "image/jpeg",
      );
      const texUrl = await uploadBuf(
        `finishes/intake/${tmpId}-2048.jpg`,
        textureBuf,
        "image/jpeg",
      );
      const thUrl = await uploadBuf(
        `finishes/intake/${tmpId}-512.jpg`,
        thumbBuf,
        "image/jpeg",
      );
      const sha = crypto.createHash("sha256").update(textureBuf).digest("hex");

      const values = {
        source_key: photo.relative.replace(/\\/g, "/"),
        category_folder: folder,
        original_filename: path.basename(photo.relative),
        raw_reference_url: rawUrl,
        texture_2048_url: texUrl,
        thumb_512_url: thUrl,
        source_width: cv.crop_box.sourceWidth,
        source_height: cv.crop_box.sourceHeight,
        crop_x: cv.crop_box.x,
        crop_y: cv.crop_box.y,
        crop_side_px: cv.crop_box.side,
        crop_x_norm: String(cv.crop_box.cropX),
        crop_y_norm: String(cv.crop_box.cropY),
        crop_side_norm: String(cv.crop_box.cropSide),
        pattern_mode: cv.stripe.is_striped || cv.stripe.bimodal ? ("striped" as const) : ("solid" as const),
        status: "pending" as const,
        texture_sha256: sha,
        raw_source_file: photo.filePath,
        updated_at: new Date(),
      };

      const existing = await db
        .select({ id: finish_intake.id, status: finish_intake.status })
        .from(finish_intake)
        .where(eq(finish_intake.source_key, values.source_key))
        .limit(1);

      if (existing[0]) {
        // Never demote certified rows; refresh media URLs + crop math only
        await db
          .update(finish_intake)
          .set({
            ...values,
            status: existing[0].status === "certified" ? "certified" : values.status,
          })
          .where(eq(finish_intake.id, existing[0].id));
      } else {
        await db.insert(finish_intake).values(values);
      }

      ok++;
      console.log(`[intake:seed] OK ${photo.relative} → ${texUrl.slice(0, 80)}…`);
    } catch (err) {
      fail++;
      console.error(`[intake:seed] FAIL ${photo.relative}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[intake:seed] done ok=${ok} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
