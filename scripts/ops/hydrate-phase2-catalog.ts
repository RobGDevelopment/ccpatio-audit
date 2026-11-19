/**
 * Non-destructive Phase 2 catalog hydration.
 *
 * COALESCE priority (existing Hub non-null always wins):
 *   1) ecommerce_listings + finished_goods_catalog + sku_mappings
 *   2) logistics_profiles (ready packaged dims/weight)
 *   3) PrimeView Woo export CSV (woo ids, images, copy, ACF meta)
 *   4) Phase 2 SOW CSV + Pricing hints
 *   5) Supabase Storage product-images / product-documents (image_url fill-only)
 *   6) product_bom readiness tagging (never mutates BOM edges)
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/ops/hydrate-phase2-catalog.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/hydrate-phase2-catalog.ts --apply
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  logistics_profiles,
  product_bom,
  sku_aliases,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  assertNoRegression,
  coalesceAttributes,
  coalescePositiveNumeric,
  coalesceText,
  deriveBomReadiness,
  firstImageUrl,
  matchWooRowToSku,
  parsePhase2SowCsv,
  parseWooProductExportCsv,
  type NonNullSnapshot,
  type Phase2SowRow,
} from "../../src/server/ecommerce/phase2-hydration";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
const UPDATED_BY = "hydrate-phase2-catalog";

const PHASE2_CSV = path.resolve(
  process.cwd(),
  "data_migration/Primeview/E-Commerce - Website Product Info - vividworks_phase2_products.csv",
);
const WOO_CSV = path.resolve(
  process.cwd(),
  "data_migration/Primeview/wc-product-export-30-10-2026.csv",
);

function requireFile(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
}

async function snapshotNonNull(): Promise<NonNullSnapshot> {
  const db = getDb();
  const fg = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE msrp IS NOT NULL AND length(trim(msrp)) > 0)::int AS msrp,
      COUNT(*) FILTER (WHERE length IS NOT NULL AND length(trim(length)) > 0)::int AS length,
      COUNT(*) FILTER (WHERE depth IS NOT NULL AND length(trim(depth)) > 0)::int AS depth,
      COUNT(*) FILTER (WHERE height IS NOT NULL AND length(trim(height)) > 0)::int AS height,
      COUNT(*) FILTER (WHERE arm_height IS NOT NULL AND length(trim(arm_height)) > 0)::int AS arm_height,
      COUNT(*) FILTER (WHERE sit_height IS NOT NULL AND length(trim(sit_height)) > 0)::int AS sit_height,
      COUNT(*) FILTER (WHERE weight IS NOT NULL AND length(trim(weight)) > 0)::int AS weight,
      COUNT(*) FILTER (WHERE image_url IS NOT NULL AND length(trim(image_url)) > 0)::int AS image_url,
      COUNT(*)::int AS rows
    FROM finished_goods_catalog
  `);
  const lp = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE length_in IS NOT NULL)::int AS length_in,
      COUNT(*) FILTER (WHERE width_in IS NOT NULL)::int AS width_in,
      COUNT(*) FILTER (WHERE height_in IS NOT NULL)::int AS height_in,
      COUNT(*) FILTER (WHERE weight_lb IS NOT NULL)::int AS weight_lb,
      COUNT(*) FILTER (WHERE ltl_class IS NOT NULL)::int AS ltl_class,
      COUNT(*) FILTER (WHERE lead_time_days IS NOT NULL)::int AS lead_time_days,
      COUNT(*) FILTER (
        WHERE length_in IS NOT NULL AND width_in IS NOT NULL AND height_in IS NOT NULL AND weight_lb IS NOT NULL
      )::int AS ready_profiles,
      COUNT(*)::int AS rows
    FROM logistics_profiles
  `);
  const el = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE steel_msrp IS NOT NULL)::int AS steel_msrp,
      COUNT(*) FILTER (WHERE marketing_description IS NOT NULL AND length(trim(marketing_description)) > 0)::int AS marketing_description,
      COUNT(*) FILTER (WHERE construction_details IS NOT NULL AND length(trim(construction_details)) > 0)::int AS construction_details,
      COUNT(*) FILTER (WHERE product_url IS NOT NULL AND length(trim(product_url)) > 0)::int AS product_url,
      COUNT(*) FILTER (WHERE slug IS NOT NULL AND length(trim(slug)) > 0)::int AS slug,
      COUNT(*)::int AS rows
    FROM ecommerce_listings
  `);
  const bom = await db.execute(sql`
    SELECT
      COUNT(*)::int AS edges,
      COUNT(DISTINCT parent_sku)::int AS parents,
      COUNT(DISTINCT child_sku)::int AS children
    FROM product_bom
  `);
  return {
    finished_goods_catalog: asCountMap(fg),
    logistics_profiles: asCountMap(lp),
    ecommerce_listings: asCountMap(el),
    product_bom: asCountMap(bom),
  };
}

function asCountMap(result: unknown): Record<string, number> {
  const row = Array.isArray(result)
    ? (result[0] as Record<string, unknown> | undefined)
    : ((result as { rows?: Record<string, unknown>[] })?.rows?.[0] as
        | Record<string, unknown>
        | undefined);
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)]),
  );
}

async function resolveCanonicalSku(
  sow: Phase2SowRow,
  aliasMap: Map<string, string>,
): Promise<string | null> {
  const raw = sow.canonicalSku.trim().toUpperCase();
  if (!raw) return null;
  if (aliasMap.has(raw)) return aliasMap.get(raw)!;
  return raw;
}

async function listStorageImageMap(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return out;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  for (const prefix of ["", "fabrics"]) {
    const { data } = await sb.storage.from("product-images").list(prefix, { limit: 1000 });
    for (const item of data ?? []) {
      if (!item.id) continue;
      const name = item.name.replace(/\.[^.]+$/, "").toUpperCase();
      const pathName = prefix ? `${prefix}/${item.name}` : item.name;
      const { data: pub } = sb.storage.from("product-images").getPublicUrl(pathName);
      if (pub?.publicUrl) out.set(name, pub.publicUrl);
    }
  }
  return out;
}

async function main() {
  requireFile(PHASE2_CSV);
  requireFile(WOO_CSV);
  const sowRows = parsePhase2SowCsv(fs.readFileSync(PHASE2_CSV, "utf8"));
  const wooRows = parseWooProductExportCsv(fs.readFileSync(WOO_CSV, "utf8"));
  console.log(`[hydrate-phase2] mode=${DRY_RUN ? "dry-run" : "apply"} sow=${sowRows.length} woo=${wooRows.length}`);

  const before = await snapshotNonNull();
  console.log("[hydrate-phase2] BEFORE snapshot", JSON.stringify(before, null, 2));

  const db = getDb();
  const aliases = await db.select().from(sku_aliases);
  const aliasMap = new Map(aliases.map((a) => [a.alias_sku.toUpperCase(), a.canonical_sku.toUpperCase()]));

  const imageMap = await listStorageImageMap();

  let touchedFg = 0;
  let touchedListings = 0;
  let touchedAttrs = 0;
  let readiness = { ready: 0, needs_variant_heal: 0, no_bom_yet: 0 };

  for (const sow of sowRows) {
    const canonical = await resolveCanonicalSku(sow, aliasMap);
    if (!canonical) continue;

    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, canonical))
      .limit(1);
    if (!mapping) {
      console.warn(`[hydrate-phase2] skip missing hub sku ${canonical} (${sow.sowProductName})`);
      continue;
    }

    const [fg] = await db
      .select()
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, canonical))
      .limit(1);

    const listingRows = await db
      .select()
      .from(ecommerce_listings)
      .where(and(eq(ecommerce_listings.global_sku, canonical), isNull(ecommerce_listings.archived_at)));

    const [logistics] = await db
      .select()
      .from(logistics_profiles)
      .where(
        or(
          eq(logistics_profiles.variant_sku, canonical),
          mapping.katana_variant_id != null
            ? eq(logistics_profiles.katana_variant_id, mapping.katana_variant_id)
            : sql`false`,
        ),
      )
      .limit(1);

    const bomEdges = await db
      .select({
        child: product_bom.child_sku,
      })
      .from(product_bom)
      .where(eq(product_bom.parent_sku, canonical));

    let childMissing = 0;
    if (bomEdges.length > 0) {
      const childSkus = bomEdges.map((e) => e.child);
      const children = await db
        .select({
          sku: sku_mappings.global_sku,
          vid: sku_mappings.katana_variant_id,
        })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, childSkus));
      childMissing = children.filter((c) => c.vid == null).length;
    }

    const bomReadiness = deriveBomReadiness({
      bomEdgeCount: bomEdges.length,
      parentKatanaVariantId: mapping.katana_variant_id,
      childMissingVariantCount: childMissing,
    });
    readiness[bomReadiness] += 1;

    const woo = matchWooRowToSku(wooRows, {
      sku: canonical,
      productName: sow.sowProductName || mapping.original_name,
      length: sow.length,
      depth: sow.depth,
    });

    const storageImage =
      imageMap.get(canonical) ??
      imageMap.get(canonical.replace(/^FIN-/, "")) ??
      null;
    const wooImage = firstImageUrl(woo?.images ?? null);

    const nextFg = {
      msrp: coalesceText(fg?.msrp, sow.msrp),
      length: coalescePositiveNumeric(
        fg?.length,
        coalescePositiveNumeric(logistics?.length_in, sow.length),
      ),
      depth: coalescePositiveNumeric(
        fg?.depth,
        coalescePositiveNumeric(logistics?.width_in, sow.depth),
      ),
      height: coalescePositiveNumeric(
        fg?.height,
        coalescePositiveNumeric(logistics?.height_in, sow.height),
      ),
      arm_height: coalesceText(fg?.arm_height, sow.armHeight),
      sit_height: coalesceText(fg?.sit_height, sow.sitHeight),
      weight: coalescePositiveNumeric(
        fg?.weight,
        coalescePositiveNumeric(logistics?.weight_lb, sow.baseWeight),
      ),
      image_url: coalesceText(fg?.image_url, coalesceText(wooImage, storageImage)),
    };

    const attrs = coalesceAttributes(mapping.attributes as Record<string, unknown>, {
      sow_product_name: sow.sowProductName,
      allowed_option_categories: sow.allowedOptionCategories,
      woo_variation_id: woo && woo.type === "variation" ? woo.id : undefined,
      primeview_woo_product_id: woo?.id,
      primeview_categories: woo?.categories,
      acf_price_meta: woo
        ? Object.fromEntries(
            Object.entries(woo.meta).filter(([k]) => k.includes("price")),
          )
        : undefined,
    });
    // Phase 2 SOW membership + readiness are authoritative tags for these 162 rows.
    attrs.sow_phase = 2;
    attrs.bom_readiness = bomReadiness;

    if (!DRY_RUN) {
      if (fg) {
        const patch: Record<string, unknown> = { updated_by: UPDATED_BY, updated_at: new Date() };
        for (const [k, v] of Object.entries(nextFg)) {
          const cur = (fg as Record<string, unknown>)[k];
          if ((cur == null || String(cur).trim() === "") && v != null) patch[k] = v;
        }
        if (Object.keys(patch).length > 2) {
          await db
            .update(finished_goods_catalog)
            .set(patch)
            .where(eq(finished_goods_catalog.global_sku, canonical));
          touchedFg += 1;
        }
      }

      for (const listing of listingRows) {
        const patch: Record<string, unknown> = {
          updated_at: new Date(),
          version: listing.version + 1,
        };
        const steel = coalescePositiveNumeric(listing.steel_msrp, sow.msrp);
        if (listing.steel_msrp == null && steel != null) patch.steel_msrp = steel;
        const marketing = coalesceText(listing.marketing_description, woo?.shortDescription);
        if (!listing.marketing_description && marketing) patch.marketing_description = marketing;
        const details = coalesceText(listing.construction_details, woo?.description);
        if (!listing.construction_details && details) patch.construction_details = details;
        if (sow.collection && (!listing.collection_label || listing.collection_label === "Uncategorized")) {
          patch.collection_label = sow.collection;
        }
        if (Object.keys(patch).length > 2) {
          await db
            .update(ecommerce_listings)
            .set(patch)
            .where(eq(ecommerce_listings.id, listing.id));
          touchedListings += 1;
        }
      }

      // Fill-missing woo_product_id only
      const wooParentId =
        woo?.type === "variation"
          ? (woo.parent.match(/id:(\d+)/i)?.[1] ??
            (woo.parent.replace(/\D/g, "") || null))
          : (woo?.id ?? null);
      const mappingPatch: Record<string, unknown> = {
        attributes: attrs,
        updated_at: new Date(),
        updated_by: UPDATED_BY,
        version: mapping.version + 1,
      };
      if (!mapping.woo_product_id && wooParentId) {
        mappingPatch.woo_product_id = String(wooParentId);
      }
      await db
        .update(sku_mappings)
        .set(mappingPatch)
        .where(eq(sku_mappings.global_sku, canonical));
      touchedAttrs += 1;
    } else {
      touchedAttrs += 1;
      if (fg) touchedFg += 1;
      touchedListings += listingRows.length;
    }
  }

  // Tag remaining priced hub FIN goods that are not Phase 2 SOW (library visibility only — no overwrites).
  if (!DRY_RUN) {
    const library = await db
      .select({
        sku: sku_mappings.global_sku,
        attributes: sku_mappings.attributes,
        version: sku_mappings.version,
      })
      .from(sku_mappings)
      .innerJoin(
        finished_goods_catalog,
        eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
      )
      .where(
        and(
          eq(sku_mappings.item_type, "finished_good"),
          eq(sku_mappings.is_active, true),
          or(
            and(isNotNull(finished_goods_catalog.msrp), sql`NULLIF(regexp_replace(${finished_goods_catalog.msrp}, '[^0-9.]', '', 'g'), '')::numeric > 0`),
            sql`EXISTS (SELECT 1 FROM ecommerce_listings el WHERE el.global_sku = ${sku_mappings.global_sku} AND el.steel_msrp IS NOT NULL AND el.steel_msrp > 0 AND el.archived_at IS NULL)`,
          ),
        ),
      )
      .limit(5000);

    for (const row of library) {
      const attrs = (row.attributes as Record<string, unknown>) ?? {};
      if (attrs.sow_phase === 2) continue;
      const edges = await db
        .select({ id: product_bom.id })
        .from(product_bom)
        .where(eq(product_bom.parent_sku, row.sku))
        .limit(1);
      const [map] = await db
        .select({ vid: sku_mappings.katana_variant_id })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, row.sku))
        .limit(1);
      const readinessValue = deriveBomReadiness({
        bomEdgeCount: edges.length,
        parentKatanaVariantId: map?.vid ?? null,
        childMissingVariantCount: 0,
      });
      if (attrs.bom_readiness) continue;
      await db
        .update(sku_mappings)
        .set({
          attributes: { ...attrs, bom_readiness: readinessValue },
          updated_at: new Date(),
          updated_by: UPDATED_BY,
          version: row.version + 1,
        })
        .where(eq(sku_mappings.global_sku, row.sku));
    }
  }

  const after = await snapshotNonNull();
  console.log("[hydrate-phase2] AFTER snapshot", JSON.stringify(after, null, 2));
  const regressions = assertNoRegression(before, after);
  if (regressions.length) {
    console.error("[hydrate-phase2] ZERO-DATA-LOSS VIOLATIONS", regressions);
    process.exitCode = 2;
  } else {
    console.log("[hydrate-phase2] zero-data-loss OK");
  }
  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        sowRows: sowRows.length,
        touchedFg,
        touchedListings,
        touchedAttrs,
        readiness,
        regressions,
      },
      null,
      2,
    ),
  );
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
