import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ECOMMERCE_32_FINISHES } from "../../src/server/ecommerce/ecommerce-32-finish-roster";
import {
  processStudioPhoto,
  synthesizeSolidTexture,
  TEXTURE_DIR,
  THUMB_DIR,
  OVERLAY_DIR,
  OUT_ROOT,
} from "./lib/swatch-cv-pipeline";

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(OUT_ROOT, "manifest.json"), "utf8"),
  ) as {
    entries: Array<{ sku: string; source_type: string; source_file: string | null }>;
  };

  for (const def of ECOMMERCE_32_FINISHES.filter((d) => d.family === "dekton")) {
    const entry = manifest.entries.find((e) => e.sku === def.sku);
    if (entry?.source_type === "synthetic_fallback" || !entry?.source_file) {
      await synthesizeSolidTexture({ sku: def.sku, hex: def.hex, kind: "dekton" });
      console.log("[synth]", def.sku);
      continue;
    }
    const filePath = path.join(
      "C:\\Workspace\\ccpatio-media-staging\\HighRezImages",
      entry.source_file.replace(/\//g, path.sep),
    );
    if (!fs.existsSync(filePath)) {
      console.warn("[missing]", filePath);
      await synthesizeSolidTexture({ sku: def.sku, hex: def.hex, kind: "dekton" });
      continue;
    }
    const row = await processStudioPhoto({
      filePath,
      relative: entry.source_file,
      categoryFolder: "Dekton",
      tmpId: `dkt_${def.sku}`,
      familyHint: "dekton",
      skuHint: def.sku,
    });
    const texDst = path.join(TEXTURE_DIR, `${def.sku}.jpg`);
    const thDst = path.join(THUMB_DIR, `${def.sku}.jpg`);
    fs.copyFileSync(row.texture_path, texDst);
    fs.copyFileSync(row.thumb_path, thDst);
    if (row.overlay_path && fs.existsSync(row.overlay_path)) {
      fs.copyFileSync(row.overlay_path, path.join(OVERLAY_DIR, `${def.sku}.jpg`));
    }
    // cleanup tmp
    if (fs.existsSync(row.texture_path)) fs.unlinkSync(row.texture_path);
    if (fs.existsSync(row.thumb_path)) fs.unlinkSync(row.thumb_path);
    const meta = await sharp(texDst).metadata();
    console.log("[ok]", def.sku, `${meta.width}x${meta.height}`, fs.statSync(texDst).size, entry.source_file);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
