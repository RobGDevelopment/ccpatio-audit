/**
 * phase1-redteam-closeout remediator — additive only, zero BOM/logistics wipe.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-phase1-redteam-closeout.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/remediate-phase1-redteam-closeout.ts --apply
 *
 * 1) ADD COLUMN woo_sku (if missing)
 * 2) Stamp woo_sku + aluminum_msrp 1:1 for Phase 1 purchasables (Mia PDF ground truth)
 * 3) is_web_visible=true / sow_phase=1 / sync_to_woo=true for Phase 1 cohort
 * 4) Force sow_phase=2 AND sync_to_woo=true → 0 (true Phase-2 backlog stays false)
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_mappings,
} from "../../src/server/db/schema";
import { NON_METAL_PDF_PRICES } from "../../src/server/ecommerce/mia-aluminum-pricing";
import {
  buildPhase1ImportBundle,
} from "./generate-primeview-phase1-csv";
import { loadPhase1SowRows } from "./enable-phase1-hub-data";

const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "phase1-redteam-closeout";

/** Explicit listing product_name → woo_sku when SOW/canonical collapses. */
const NAME_TO_WOO: Array<{ match: RegExp; wooSku: string; price?: number }> = [
  { match: /KINDLE.*HEATER/i, wooSku: "FIN-KIN-MIS-HEATER", price: 5695 },
  { match: /KINDLE.*LAMP/i, wooSku: "FIN-KIN-MIS-LAMP", price: 5595 },
  { match: /FREELO/i, wooSku: "FIN-TJM-CHA-FREELO", price: 499.99 },
  { match: /MOON CHAIR/i, wooSku: "FIN-TJM-CHA-MOON", price: 749.99 },
  { match: /LAYLO.*NO RISER/i, wooSku: "FIN-TJM-MIS-LAYLO-NORISER", price: 599.99 },
  { match: /LAYLO.*4/i, wooSku: "FIN-TJM-MIS-LAYLO-4RISER", price: 729.99 },
  { match: /SHAYZ/i, wooSku: "FIN-TJM-MIS-SHAYZ-5", price: 1599.99 },
  { match: /WOOSAH/i, wooSku: "FIN-TJM-MIS-WOOSAH", price: 1759.99 },
  { match: /ROUND DAYBED|DAYBED.*DIAMETER/i, wooSku: "FIN-BRV-DYB-84X84-RND", price: 8415 },
  { match: /ARMLESS MINI LOVESEAT|ARMLESS.*48/i, wooSku: "FIN-BRV-MIN-LOV-48X34-ARMLESS", price: 2680 },
  { match: /MINI LOVESEAT 48.*34/i, wooSku: "FIN-BRV-MIN-LOV-48X34", price: 2915 },
  { match: /TAYLOR BARSTOOL w\/ARMS|BARSTOOL w\/ARMS/i, wooSku: "FIN-TAY-BST-24X23-BAR", price: 1095 },
  { match: /FLY LEG BARSTOOL.*COUNTER|FLY LEG BARSTOOL.*24\" SH/i, wooSku: "FIN-WFT-FLY-BST-18X18-CNT", price: 902 },
  { match: /FLY LEG BARSTOOL.*BAR HEIGHT|FLY LEG BARSTOOL.*30\" SH/i, wooSku: "FIN-WFT-FLY-BST-18X18-BAR", price: 935 },
  { match: /HALF BACK BARSTOOL.*COUNTER|HALF BACK.*24\" SH/i, wooSku: "FIN-WFT-FLY-BST-17X21-CNT", price: 925 },
  { match: /HALF BACK BARSTOOL.*BAR HEIGHT|HALF BACK.*30\" SH/i, wooSku: "FIN-WFT-FLY-BST-17X21-BAR", price: 965 },
  { match: /TAYLOR BARSTOOL \(COUNTER|TAYLOR BARSTOOL.*24\" SH/i, wooSku: "FIN-TAY-BST-19X23-CNT", price: 955 },
  { match: /TAYLOR BARSTOOL \(BAR|TAYLOR BARSTOOL.*30\" SH/i, wooSku: "FIN-TAY-BST-19X23-BAR", price: 985 },
];

function money(n: number): string {
  return n.toFixed(2);
}

async function ensureWooSkuColumn(db: ReturnType<typeof getDb>) {
  await db.execute(sql`
    ALTER TABLE ecommerce_listings ADD COLUMN IF NOT EXISTS woo_sku text
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS ecommerce_listings_woo_sku_active_uidx
      ON ecommerce_listings (woo_sku)
      WHERE archived_at IS NULL AND woo_sku IS NOT NULL
  `);
}

async function main() {
  const db = getDb();
  const report: Record<string, unknown> = {
    apply: APPLY,
    before: {},
    listings: [] as unknown[],
    visibility: {},
    phase2: {},
    after: {},
  };

  const beforeCounts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM product_bom) AS product_bom,
      (SELECT COUNT(*)::int FROM logistics_profiles) AS logistics_profiles,
      (SELECT COUNT(*)::int FROM finished_goods_catalog) AS finished_goods_catalog,
      (SELECT COUNT(*)::int FROM ecommerce_listings) AS ecommerce_listings,
      (SELECT COUNT(*)::int FROM sku_mappings
        WHERE coalesce((attributes->>'sow_phase')::int,0)=2 AND sync_to_woo=true) AS phase2_sync_true
  `);
  report.before = (beforeCounts as { rows?: unknown[] }).rows?.[0] ?? beforeCounts[0];

  // Always ensure column exists (idempotent) before any SELECT of woo_sku.
  await ensureWooSkuColumn(db);

  const bundle = await buildPhase1ImportBundle({ hostSwatches: false });
  const priceByWoo = new Map<string, string>();
  for (const h of bundle.handoff) {
    priceByWoo.set(h.wooSku.toUpperCase(), money(Number(h.price)));
  }
  for (const n of NON_METAL_PDF_PRICES) {
    if (n.sku) priceByWoo.set(n.sku.toUpperCase(), money(n.price));
  }
  for (const n of NAME_TO_WOO) {
    if (n.price != null) priceByWoo.set(n.wooSku.toUpperCase(), money(n.price));
  }

  // Square 84 daybed (canonical) must stay 8140 even if a ROUND listing shares family.
  priceByWoo.set("FIN-BRV-DYB-84X84", "8140.00");
  priceByWoo.set("FIN-BRV-DYB-84X84-RND", "8415.00");

  const listings = await db
    .select({
      id: ecommerce_listings.id,
      globalSku: ecommerce_listings.global_sku,
      productName: ecommerce_listings.product_name,
      aluminum: ecommerce_listings.aluminum_msrp,
      wooSku: ecommerce_listings.woo_sku,
    })
    .from(ecommerce_listings);

  const usedWoo = new Set<string>();
  for (const row of listings) {
    const name = row.productName || "";
    let wooSku = (row.wooSku || "").trim().toUpperCase();
    for (const rule of NAME_TO_WOO) {
      if (rule.match.test(name)) {
        wooSku = rule.wooSku.toUpperCase();
        break;
      }
    }
    if (!wooSku) {
      // Prefer exact handoff match by trailing [SKU] in product_name.
      const bracket = name.match(/\[(FIN-[A-Z0-9-]+)\]/i);
      if (bracket?.[1] && priceByWoo.has(bracket[1].toUpperCase())) {
        wooSku = bracket[1].toUpperCase();
      } else if (priceByWoo.has(row.globalSku.toUpperCase())) {
        wooSku = row.globalSku.toUpperCase();
      }
    }
    if (!wooSku) continue;
    if (usedWoo.has(wooSku)) {
      // Duplicate name collision — keep first assignment.
      (report.listings as unknown[]).push({
        id: row.id,
        productName: name,
        skipped: "woo_sku_already_assigned",
        wooSku,
      });
      continue;
    }
    usedWoo.add(wooSku);
    const nextPrice = priceByWoo.get(wooSku) ?? null;
    const entry = {
      id: row.id,
      productName: name,
      globalSku: row.globalSku,
      wooSku,
      aluminumBefore: row.aluminum,
      aluminumAfter: nextPrice,
    };
    (report.listings as unknown[]).push(entry);
    if (APPLY) {
      await db
        .update(ecommerce_listings)
        .set({
          woo_sku: wooSku,
          ...(nextPrice
            ? { aluminum_msrp: nextPrice, updated_at: new Date() }
            : { updated_at: new Date() }),
        })
        .where(eq(ecommerce_listings.id, row.id));
    }
  }

  // Phase 1 cohort SKUs from SOW + handoff woo aliases.
  // Distinct wooSkus without a dedicated listing keep Mia/SOW CSV prices
  // (handoff overlay no longer copies collided canonical siblings).
  const sow = loadPhase1SowRows();
  const phase1Canonicals = [...new Set(sow.map((s) => s.sku))];
  const phase1Woo = [...new Set(bundle.handoff.map((h) => h.wooSku))];
  const phase1All = [...new Set([...phase1Canonicals, ...phase1Woo])];

  if (APPLY) {
    // FGC visibility for every Phase 1 canonical AND every listing global_sku
    // that carries a Phase 1 woo_sku (covers OCN alias shells / FIN-BRV-DYB-84).
    const wooLinked = await db
      .select({ sku: ecommerce_listings.global_sku })
      .from(ecommerce_listings)
      .where(sql`${ecommerce_listings.woo_sku} IS NOT NULL`);
    const visibleSkus = [
      ...new Set([
        ...phase1Canonicals,
        ...wooLinked.map((r) => r.sku),
      ]),
    ];
    await db
      .update(finished_goods_catalog)
      .set({
        is_web_visible: true,
        updated_at: new Date(),
        updated_by: UPDATED_BY,
      })
      .where(inArray(finished_goods_catalog.global_sku, visibleSkus));

    // sku_mappings: sow_phase=1, sync_to_woo=true for Phase 1 canonicals.
    const phase1Maps = await db
      .select({
        sku: sku_mappings.global_sku,
        attributes: sku_mappings.attributes,
        version: sku_mappings.version,
        sync: sku_mappings.sync_to_woo,
      })
      .from(sku_mappings)
      .where(inArray(sku_mappings.global_sku, phase1Canonicals));

    for (const row of phase1Maps) {
      const attrs = {
        ...((row.attributes as Record<string, unknown>) ?? {}),
        sow_phase: 1,
      };
      await db
        .update(sku_mappings)
        .set({
          attributes: attrs,
          sync_to_woo: true,
          version: row.version + 1,
          updated_at: new Date(),
          updated_by: UPDATED_BY,
        })
        .where(eq(sku_mappings.global_sku, row.sku));
    }

    // Phase 2 leak cleanup: anything still sow_phase=2 with sync_to_woo=true.
    const leaks = await db.execute(sql`
      SELECT global_sku, attributes, version
      FROM sku_mappings
      WHERE coalesce((attributes->>'sow_phase')::int,0)=2 AND sync_to_woo=true
    `);
    type LeakRow = {
      global_sku: string;
      attributes: Record<string, unknown>;
      version: number;
    };
    const leakRows: LeakRow[] = Array.isArray(leaks)
      ? (leaks as unknown as LeakRow[])
      : (((leaks as unknown as { rows?: LeakRow[] }).rows) ?? []);
    report.phase2 = { leakedBefore: leakRows.map((r) => r.global_sku) };

    for (const row of leakRows) {
      const sku = String(row.global_sku);
      const isPhase1 = phase1All.includes(sku) || phase1Canonicals.includes(sku);
      if (isPhase1) {
        const attrs = { ...((row.attributes as Record<string, unknown>) ?? {}), sow_phase: 1 };
        await db
          .update(sku_mappings)
          .set({
            attributes: attrs,
            sync_to_woo: true,
            version: Number(row.version) + 1,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
          })
          .where(eq(sku_mappings.global_sku, sku));
        await db
          .update(finished_goods_catalog)
          .set({
            is_web_visible: true,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
          })
          .where(eq(finished_goods_catalog.global_sku, sku));
      } else {
        await db
          .update(sku_mappings)
          .set({
            sync_to_woo: false,
            version: Number(row.version) + 1,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
          })
          .where(eq(sku_mappings.global_sku, sku));
        await db
          .update(finished_goods_catalog)
          .set({
            is_web_visible: false,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
          })
          .where(eq(finished_goods_catalog.global_sku, sku));
      }
    }
  }

  const afterCounts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM product_bom) AS product_bom,
      (SELECT COUNT(*)::int FROM logistics_profiles) AS logistics_profiles,
      (SELECT COUNT(*)::int FROM finished_goods_catalog) AS finished_goods_catalog,
      (SELECT COUNT(*)::int FROM ecommerce_listings) AS ecommerce_listings,
      (SELECT COUNT(*)::int FROM sku_mappings
        WHERE coalesce((attributes->>'sow_phase')::int,0)=2 AND sync_to_woo=true) AS phase2_sync_true,
      (SELECT COUNT(*)::int FROM finished_goods_catalog f
        JOIN sku_mappings s ON s.global_sku=f.global_sku
        WHERE coalesce((s.attributes->>'sow_phase')::int,0)=1 AND coalesce(f.is_web_visible,false)=true
      ) AS phase1_visible,
      (SELECT COUNT(*)::int FROM ecommerce_listings WHERE woo_sku IS NOT NULL) AS listings_with_woo_sku
  `);
  report.after = (afterCounts as { rows?: unknown[] }).rows?.[0] ?? afterCounts[0];
  report.visibility = {
    phase1Canonicals: phase1Canonicals.length,
    phase1Woo: phase1Woo.length,
  };

  console.log(JSON.stringify(report, null, 2));
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
