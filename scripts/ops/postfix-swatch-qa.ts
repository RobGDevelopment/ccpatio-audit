/**
 * Fast postfix + pixel QA without re-running full CV.
 * Usage: npx tsx scripts/ops/postfix-swatch-qa.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  ECOMMERCE_32_FINISHES,
  type EcommerceFinishFamily,
} from "../../src/server/ecommerce/ecommerce-32-finish-roster";
import { deriveFinishPhysicalScale } from "../../src/server/assets/finish-assets";
import {
  finalizeSeamlessTexture,
  OUT_ROOT,
  TEXTURE_DIR,
  THUMB_DIR,
  OVERLAY_DIR,
  STAGING_ROOT,
} from "./lib/swatch-cv-pipeline";
import { verifyAllProcessed } from "./lib/swatch-pixel-qa";

async function main() {
  const priorPath = path.join(OUT_ROOT, "manifest.json");
  const prior = fs.existsSync(priorPath)
    ? (JSON.parse(fs.readFileSync(priorPath, "utf8")) as { entries: Array<Record<string, unknown>> })
    : { entries: [] };

  const entries = [];
  for (const def of ECOMMERCE_32_FINISHES) {
    const texture_path = path.join(TEXTURE_DIR, `${def.sku}.jpg`);
    const thumb_path = path.join(THUMB_DIR, `${def.sku}.jpg`);
    if (!fs.existsSync(texture_path)) throw new Error(`missing ${texture_path}`);

    if (def.family !== "dekton" && def.sku !== "FAB-CAB-CLA") {
      const { data } = await sharp(texture_path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const fixed = finalizeSeamlessTexture(Buffer.from(data), 2048);
      await sharp(fixed, { raw: { width: 2048, height: 2048, channels: 3 } })
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(texture_path);
      const thumbRgb = await sharp(fixed, { raw: { width: 2048, height: 2048, channels: 3 } })
        .resize(512, 512, { kernel: "lanczos3" })
        .raw()
        .toBuffer();
      await sharp(thumbRgb, { raw: { width: 512, height: 512, channels: 3 } })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(thumb_path);
      console.log(`[postfix] ${def.sku}`);
    }

    const scale = deriveFinishPhysicalScale({ sku: def.sku, family: def.family as EcommerceFinishFamily });
    const prev = prior.entries.find((e) => e.sku === def.sku) ?? {};
    entries.push({
      sku: def.sku,
      display_name: def.displayName,
      family: def.family,
      category: def.category,
      hex: def.hex,
      source_type: (prev.source_type as string) ?? "studio_photo",
      source_file: (prev.source_file as string | null) ?? null,
      confidence: (prev.confidence as string) ?? "medium",
      lookalikes: [],
      pixels_per_inch: null,
      cropped_width_in: scale.sample_width_in,
      ...scale,
      texture_path,
      thumb_path,
      overlay_path: path.join(OVERLAY_DIR, `${def.sku}.jpg`),
      lab: (prev.lab as number[] | null) ?? null,
      notes: ["postfix_finalize"],
    });
  }

  // Ensure Cabana not bound to PV205084
  const cabana = entries.find((e) => e.sku === "FAB-CAB-CLA")!;
  if (typeof cabana.source_file === "string" && /PV205084/i.test(cabana.source_file)) {
    cabana.source_file = null;
    cabana.source_type = "synthetic_fallback";
  }
  cabana.texture_scale = 7;
  cabana.repeat_inches = 7;

  const qa = await verifyAllProcessed(entries);
  if (!qa.ok) {
    console.error("[pixel-qa] FAILED:");
    for (const i of qa.issues) console.error(`  ${i.sku} ${i.code}: ${i.detail}`);
    process.exit(1);
  }
  console.log("[pixel-qa] PASS — all 32 textures");

  const manifest = {
    generated_at: new Date().toISOString(),
    staging_root: STAGING_ROOT,
    count: 32,
    studio_photo: entries.filter((e) => e.source_type === "studio_photo").length,
    synthetic_fallback: entries.filter((e) => e.source_type === "synthetic_fallback").length,
    entries,
  };
  fs.writeFileSync(path.join(OUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(OUT_ROOT, "match-audit.json"),
    JSON.stringify(
      entries.map((e) => ({
        sku: e.sku,
        source_file: e.source_file,
        source_type: e.source_type,
        texture_scale: e.texture_scale,
        hex_target: e.hex,
      })),
      null,
      2,
    ),
  );
  console.log("manifest written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
