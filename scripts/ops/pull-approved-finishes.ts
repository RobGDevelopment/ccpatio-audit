/**
 * finishes:pull-approved — download Mia-approved renamed finish files + manifest
 * into C:\Workspace\ccpatio-media-staging\approved\
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env.local") });

import { eq } from "drizzle-orm";
import { getDb } from "../../src/server/db/client";
import { ecommerce_finish_assets, finish_intake } from "../../src/server/db/schema";
import { ensureFinishIntakeTables } from "../../src/server/ecommerce/finish-intake";
import { STAGING_ROOT } from "./lib/swatch-cv-pipeline";

const OUT = path.join(STAGING_ROOT, "approved");

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function main() {
  await ensureFinishIntakeTables();
  const db = getDb();
  fs.mkdirSync(OUT, { recursive: true });

  const certified = await db
    .select()
    .from(finish_intake)
    .where(eq(finish_intake.status, "certified"));

  const assets = await db
    .select()
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.quality_status, "photoshoot_verified"));

  const manifest: Array<Record<string, unknown>> = [];

  for (const row of certified) {
    const sku = row.canonical_sku ?? row.proposed_sku ?? "UNKNOWN";
    const folder = path.join(OUT, sku);
    fs.mkdirSync(folder, { recursive: true });
    if (row.texture_2048_url) {
      await download(row.texture_2048_url, path.join(folder, `${sku}-2048.jpg`));
    }
    if (row.thumb_512_url) {
      await download(row.thumb_512_url, path.join(folder, `${sku}-512.jpg`));
    }
    if (row.raw_reference_url) {
      await download(row.raw_reference_url, path.join(folder, `${sku}-orig.jpg`));
    }
    manifest.push({
      source: "finish_intake",
      sku,
      display_name: row.display_name,
      raw_source_file: row.raw_source_file,
      texture_2048_url: row.texture_2048_url,
      thumb_512_url: row.thumb_512_url,
      certified_at: row.certified_at,
      certified_by: row.certified_by,
    });
  }

  for (const a of assets) {
    if (manifest.some((m) => m.sku === a.sku)) continue;
    const folder = path.join(OUT, a.sku);
    fs.mkdirSync(folder, { recursive: true });
    if (a.texture_2k_url) {
      await download(a.texture_2k_url, path.join(folder, `${a.sku}-2048.jpg`));
    }
    if (a.swatch_thumb_url) {
      await download(a.swatch_thumb_url, path.join(folder, `${a.sku}-512.jpg`));
    }
    manifest.push({
      source: "ecommerce_finish_assets",
      sku: a.sku,
      display_name: a.display_name,
      texture_2k_url: a.texture_2k_url,
      swatch_thumb_url: a.swatch_thumb_url,
      quality_status: a.quality_status,
    });
  }

  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ count: manifest.length, entries: manifest }, null, 2));
  console.log(`[finishes:pull-approved] wrote ${manifest.length} entries → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
