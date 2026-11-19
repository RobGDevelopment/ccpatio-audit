/**
 * Phase1 handoff P0 remediator — Hub data fixes (dims, Taylor BAR alias,
 * odd-dollar mia_pdf_raw_price / suggested stamps). Additive only.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-phase1-handoff-p0.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-phase1-handoff-p0.ts --apply
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  finished_goods_catalog,
  logistics_profiles,
  sku_aliases,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  ODD_DOLLAR_PDF_ROWS,
  PRICE_REVIEW_ODD,
  suggestedNearest5,
} from "../../src/server/ecommerce/mia-aluminum-pricing";
import {
  PHASE1_DIM_OVERRIDES_IN,
  PHASE1_SHARED_ALIASES,
} from "./enable-phase1-hub-data";

const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "phase1-handoff-p0-remediation";

async function main() {
  const db = getDb();
  const report: Record<string, unknown> = { apply: APPLY, dims: [], aliases: [], oddStamps: [] };

  // 1) Dim backfill on FGC (+ logistics_profiles when variant_sku already exists)
  for (const [sku, dims] of Object.entries(PHASE1_DIM_OVERRIDES_IN)) {
    const [fgc] = await db
      .select({
        sku: finished_goods_catalog.global_sku,
        length: finished_goods_catalog.length,
        depth: finished_goods_catalog.depth,
        height: finished_goods_catalog.height,
      })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, sku))
      .limit(1);

    const entry = {
      sku,
      before: fgc
        ? { length: fgc.length, depth: fgc.depth, height: fgc.height }
        : null,
      after: dims,
    };
    (report.dims as unknown[]).push(entry);

    if (APPLY && fgc) {
      await db
        .update(finished_goods_catalog)
        .set({
          length: String(dims.length),
          depth: String(dims.depth),
          height: String(dims.height),
          updated_at: new Date(),
          updated_by: UPDATED_BY,
        })
        .where(eq(finished_goods_catalog.global_sku, sku));

      await db
        .update(logistics_profiles)
        .set({
          length_in: String(dims.length),
          width_in: String(dims.depth),
          height_in: String(dims.height),
          updated_at: new Date(),
        })
        .where(eq(logistics_profiles.variant_sku, sku));
    }
  }

  // 2) Ensure Taylor BAR alias (+ any missing PHASE1_SHARED_ALIASES)
  for (const a of PHASE1_SHARED_ALIASES) {
    const [existing] = await db
      .select({ alias: sku_aliases.alias_sku })
      .from(sku_aliases)
      .where(eq(sku_aliases.alias_sku, a.alias_sku))
      .limit(1);
    (report.aliases as unknown[]).push({
      ...a,
      existed: Boolean(existing),
    });
    if (APPLY && !existing) {
      await db.insert(sku_aliases).values({
        alias_sku: a.alias_sku,
        canonical_sku: a.canonical_sku,
        reason: a.reason,
        created_at: new Date(),
      });
    }
  }

  // 3) Stamp mia_pdf_raw_price + suggested on Phase 1 odd-dollar SKUs
  const oddSkus = ODD_DOLLAR_PDF_ROWS.filter((r) => r.phase === 1 && r.skuHint).map(
    (r) => r.skuHint!,
  );
  if (oddSkus.length) {
    const rows = await db
      .select({
        sku: sku_mappings.global_sku,
        attributes: sku_mappings.attributes,
        version: sku_mappings.version,
      })
      .from(sku_mappings)
      .where(inArray(sku_mappings.global_sku, oddSkus));

    for (const row of rows) {
      const odd = ODD_DOLLAR_PDF_ROWS.find((r) => r.skuHint === row.sku);
      if (!odd) continue;
      const attrs: Record<string, unknown> = {
        ...((row.attributes as Record<string, unknown>) ?? {}),
        price_review_flag: PRICE_REVIEW_ODD,
        mia_pdf_raw_price: odd.price,
        mia_pdf_price: odd.price,
        mia_pdf_suggested_price: odd.suggested ?? suggestedNearest5(odd.price),
      };
      (report.oddStamps as unknown[]).push({
        sku: row.sku,
        raw: odd.price,
        suggested: attrs.mia_pdf_suggested_price,
      });
      if (APPLY) {
        await db
          .update(sku_mappings)
          .set({
            attributes: attrs,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
            version: row.version + 1,
          })
          .where(eq(sku_mappings.global_sku, row.sku));
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
