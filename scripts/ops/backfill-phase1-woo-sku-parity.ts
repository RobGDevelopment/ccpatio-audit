/**
 * Backfill ecommerce_listings to true 107/107 Phase 1 woo_sku parity.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/backfill-phase1-woo-sku-parity.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/backfill-phase1-woo-sku-parity.ts --apply
 *
 * - Deletes FIN-BRV-ARM-SOF-72X34 woo_sku IS NULL orphan
 * - Expands 14 facing/BAR/CNT shells into individual woo_sku rows (Mia prices)
 * - Remaps 8 OCN/DYB-linked listings onto Phase 1 canons
 * - Deletes leftover null-woo Phase1 shells that collide with remapped rows
 * Zero product_bom / logistics_profiles / finished_goods_catalog wipe.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_mappings,
} from "../../src/server/db/schema";

const APPLY = process.argv.includes("--apply");
const UPDATED_BY = "phase1-final-10gate-greenlight";

/** Facing / height variants collapsed onto a null-woo canonical shell. */
const EXPAND: Array<{
  canon: string;
  variants: Array<{ wooSku: string; facingLabel?: string; price: string }>;
}> = [
  {
    canon: "FIN-BRV-COR-SOF-72X34",
    variants: [
      { wooSku: "FIN-BRV-COR-SOF-72X34-LS", facingLabel: "Left-Side Facing", price: "4345.00" },
      { wooSku: "FIN-BRV-COR-SOF-72X34-RS", facingLabel: "Right-Side Facing", price: "4345.00" },
    ],
  },
  {
    canon: "FIN-BRV-COR-SOF-84X34",
    variants: [
      { wooSku: "FIN-BRV-COR-SOF-84X34-LS", facingLabel: "Left-Side Facing", price: "4675.00" },
      { wooSku: "FIN-BRV-COR-SOF-84X34-RS", facingLabel: "Right-Side Facing", price: "4675.00" },
    ],
  },
  {
    canon: "FIN-BRV-COR-SOF-96X34",
    variants: [
      { wooSku: "FIN-BRV-COR-SOF-96X34-LS", facingLabel: "Left-Side Facing", price: "4895.00" },
      { wooSku: "FIN-BRV-COR-SOF-96X34-RS", facingLabel: "Right-Side Facing", price: "4895.00" },
    ],
  },
  {
    canon: "FIN-BRV-COR-CHS-72X34",
    variants: [
      { wooSku: "FIN-BRV-COR-CHS-72X34-LS", facingLabel: "Left-Side Facing", price: "4160.00" },
      { wooSku: "FIN-BRV-COR-CHS-72X34-RS", facingLabel: "Right-Side Facing", price: "4160.00" },
    ],
  },
  {
    canon: "FIN-BRV-COR-CHS-84X34",
    variants: [
      { wooSku: "FIN-BRV-COR-CHS-84X34-LS", facingLabel: "Left-Side Facing", price: "4390.00" },
      { wooSku: "FIN-BRV-COR-CHS-84X34-RS", facingLabel: "Right-Side Facing", price: "4390.00" },
    ],
  },
  {
    canon: "FIN-BRK-BAR-TAB-36X36",
    variants: [{ wooSku: "FIN-BRK-BAR-TAB-36X36-BAR", price: "3465.00" }],
  },
  {
    canon: "FIN-BRK-BAR-TAB-42X42",
    variants: [{ wooSku: "FIN-BRK-BAR-TAB-42X42-BAR", price: "3600.00" }],
  },
  {
    canon: "FIN-BRK-CNT-TAB-36X36",
    variants: [{ wooSku: "FIN-BRK-CNT-TAB-36X36-CNT", price: "3395.00" }],
  },
  {
    canon: "FIN-BRK-CNT-TAB-42X42",
    variants: [{ wooSku: "FIN-BRK-CNT-TAB-42X42-CNT", price: "3535.00" }],
  },
];

/** Mis-linked listings that already carry the correct woo_sku + Mia price. */
const REMAP_GLOBAL: Array<{ wooSku: string; toGlobal: string }> = [
  { wooSku: "FIN-TAY-BST-19X23-BAR", toGlobal: "FIN-TAY-BST-19X23" },
  { wooSku: "FIN-TAY-BST-19X23-CNT", toGlobal: "FIN-TAY-BST-19X23" },
  { wooSku: "FIN-TAY-BST-24X23-BAR", toGlobal: "FIN-TAY-BST-24X23" },
  { wooSku: "FIN-WFT-FLY-BST-17X21-BAR", toGlobal: "FIN-WFT-FLY-BST-17X21" },
  { wooSku: "FIN-WFT-FLY-BST-17X21-CNT", toGlobal: "FIN-WFT-FLY-BST-17X21" },
  { wooSku: "FIN-WFT-FLY-BST-18X18-BAR", toGlobal: "FIN-WFT-FLY-BST-18X18" },
  { wooSku: "FIN-WFT-FLY-BST-18X18-CNT", toGlobal: "FIN-WFT-FLY-BST-18X18" },
  { wooSku: "FIN-BRV-DYB-84X84-RND", toGlobal: "FIN-BRV-DYB-84X84" },
];

async function counts(db: ReturnType<typeof getDb>) {
  const rows = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM product_bom) AS product_bom,
      (SELECT COUNT(*)::int FROM logistics_profiles) AS logistics_profiles,
      (SELECT COUNT(*)::int FROM finished_goods_catalog) AS finished_goods_catalog,
      (SELECT COUNT(*)::int FROM ecommerce_listings el
        JOIN sku_mappings sm ON sm.global_sku = el.global_sku
        WHERE coalesce((sm.attributes->>'sow_phase')::int,0)=1
          AND sm.sync_to_woo=true AND el.archived_at IS NULL) AS phase1_listings,
      (SELECT COUNT(DISTINCT el.woo_sku)::int FROM ecommerce_listings el
        JOIN sku_mappings sm ON sm.global_sku = el.global_sku
        WHERE coalesce((sm.attributes->>'sow_phase')::int,0)=1
          AND sm.sync_to_woo=true AND el.archived_at IS NULL
          AND el.woo_sku IS NOT NULL) AS phase1_distinct_woo
  `);
  return (rows as { rows?: unknown[] }).rows?.[0] ?? rows[0];
}

async function main() {
  const db = getDb();
  const report: Record<string, unknown> = { apply: APPLY, steps: [] as unknown[] };
  report.before = await counts(db);

  // 1) Delete BRV orphan null sibling
  const orphans = await db
    .select({ id: ecommerce_listings.id, productName: ecommerce_listings.product_name })
    .from(ecommerce_listings)
    .where(
      and(
        eq(ecommerce_listings.global_sku, "FIN-BRV-ARM-SOF-72X34"),
        isNull(ecommerce_listings.woo_sku),
        isNull(ecommerce_listings.archived_at),
      ),
    );
  (report.steps as unknown[]).push({ deleteOrphans: orphans });
  if (APPLY) {
    for (const row of orphans) {
      await db.delete(ecommerce_listings).where(eq(ecommerce_listings.id, row.id));
    }
  }

  // 2) Expand facing/BAR/CNT shells
  for (const group of EXPAND) {
    const shells = await db
      .select()
      .from(ecommerce_listings)
      .where(
        and(
          eq(ecommerce_listings.global_sku, group.canon),
          isNull(ecommerce_listings.archived_at),
        ),
      );
    const nullShell = shells.find((s) => !s.woo_sku);
    const template = nullShell ?? shells[0];
    if (!template) {
      (report.steps as unknown[]).push({ expand: group.canon, error: "no_shell" });
      continue;
    }

    for (let i = 0; i < group.variants.length; i += 1) {
      const v = group.variants[i]!;
      const existing = shells.find((s) => s.woo_sku === v.wooSku);
      if (existing) {
        (report.steps as unknown[]).push({ expand: v.wooSku, skipped: "exists" });
        continue;
      }
      const productName = v.facingLabel
        ? `${template.product_name.replace(/\s*\[[^\]]+\]\s*$/, "").trim()} (${v.facingLabel})`
        : template.product_name.includes(v.wooSku)
          ? template.product_name
          : `${template.product_name.replace(/\s*\[[^\]]+\]\s*$/, "").trim()} [${v.wooSku}]`;

      if (i === 0 && nullShell) {
        (report.steps as unknown[]).push({
          updateNullShell: nullShell.id,
          wooSku: v.wooSku,
          productName,
          price: v.price,
        });
        if (APPLY) {
          await db
            .update(ecommerce_listings)
            .set({
              woo_sku: v.wooSku,
              product_name: productName,
              aluminum_msrp: v.price,
              canonical_sku_shared: group.variants.length > 1,
              updated_at: new Date(),
            })
            .where(eq(ecommerce_listings.id, nullShell.id));
        }
      } else {
        (report.steps as unknown[]).push({
          insert: v.wooSku,
          globalSku: group.canon,
          productName,
          price: v.price,
        });
        if (APPLY) {
          await db.insert(ecommerce_listings).values({
            global_sku: group.canon,
            woo_sku: v.wooSku,
            product_name: productName,
            steel_msrp: template.steel_msrp,
            legacy_base_sku: template.legacy_base_sku,
            legacy_sku_shared: template.legacy_sku_shared,
            canonical_sku_shared: true,
            product_url: template.product_url,
            url_source: template.url_source,
            url_operator_set: template.url_operator_set,
            legacy_operator_set: template.legacy_operator_set,
            drawing_section: template.drawing_section,
            collection_label: template.collection_label,
            aluminum_msrp: v.price,
            marketing_description: template.marketing_description,
            construction_details: template.construction_details,
            seo_title: template.seo_title,
            seo_description: template.seo_description,
            slug: null, // avoid unique slug collision; operator can set later
            tags: template.tags ?? [],
            sheet_order: template.sheet_order,
            sale_price: template.sale_price,
            sale_ends_at: template.sale_ends_at,
            version: 1,
            updated_at: new Date(),
          });
        }
      }
    }
  }

  // 3) Remap OCN/DYB listings onto Phase 1 canons (preserve woo_sku + Mia price)
  for (const remap of REMAP_GLOBAL) {
    const rows = await db
      .select({
        id: ecommerce_listings.id,
        globalSku: ecommerce_listings.global_sku,
        wooSku: ecommerce_listings.woo_sku,
      })
      .from(ecommerce_listings)
      .where(
        and(
          eq(ecommerce_listings.woo_sku, remap.wooSku),
          isNull(ecommerce_listings.archived_at),
        ),
      );
    for (const row of rows) {
      if (row.globalSku === remap.toGlobal) {
        (report.steps as unknown[]).push({ remap: remap.wooSku, skipped: "already" });
        continue;
      }
      (report.steps as unknown[]).push({
        remap: remap.wooSku,
        from: row.globalSku,
        to: remap.toGlobal,
      });
      if (APPLY) {
        await db
          .update(ecommerce_listings)
          .set({
            global_sku: remap.toGlobal,
            canonical_sku_shared: true,
            updated_at: new Date(),
          })
          .where(eq(ecommerce_listings.id, row.id));
      }
    }
  }

  // 4) Delete leftover null-woo Phase1 shells that are now covered by remapped rows
  const leftoverNulls = await db.execute(sql`
    SELECT el.id, el.global_sku, el.product_name
    FROM ecommerce_listings el
    JOIN sku_mappings sm ON sm.global_sku = el.global_sku
    WHERE el.archived_at IS NULL
      AND el.woo_sku IS NULL
      AND coalesce((sm.attributes->>'sow_phase')::int,0)=1
      AND sm.sync_to_woo=true
      AND el.global_sku IN (
        'FIN-TAY-BST-19X23','FIN-TAY-BST-24X23',
        'FIN-WFT-FLY-BST-17X21','FIN-WFT-FLY-BST-18X18'
      )
  `);
  const leftoverRows = Array.isArray(leftoverNulls)
    ? leftoverNulls
    : ((leftoverNulls as { rows?: unknown[] }).rows ?? []);
  (report.steps as unknown[]).push({ deleteLeftoverNulls: leftoverRows });
  if (APPLY) {
    for (const row of leftoverRows as Array<{ id: string }>) {
      await db.delete(ecommerce_listings).where(eq(ecommerce_listings.id, row.id));
    }
  }

  // 5) Ensure FGC web visibility for remapped canons
  if (APPLY) {
    const canons = [
      ...EXPAND.map((e) => e.canon),
      ...REMAP_GLOBAL.map((r) => r.toGlobal),
    ];
    await db
      .update(finished_goods_catalog)
      .set({ is_web_visible: true, updated_at: new Date(), updated_by: UPDATED_BY })
      .where(inArray(finished_goods_catalog.global_sku, [...new Set(canons)]));

    // Touch sku_mappings version so operators see activity (sow/sync already correct).
    for (const sku of [...new Set(canons)]) {
      const [row] = await db
        .select({ version: sku_mappings.version })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, sku))
        .limit(1);
      if (!row) continue;
      await db
        .update(sku_mappings)
        .set({
          version: row.version + 1,
          updated_at: new Date(),
          updated_by: UPDATED_BY,
        })
        .where(eq(sku_mappings.global_sku, sku));
    }
  }

  report.after = await counts(db);
  console.log(JSON.stringify(report, null, 2));
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
