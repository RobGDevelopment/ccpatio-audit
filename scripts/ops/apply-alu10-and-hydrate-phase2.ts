/**
 * Idempotent Aluminum-only +10% pricing + zero-data-loss Phase 2 COALESCE hydration.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/ops/apply-alu10-and-hydrate-phase2.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/apply-alu10-and-hydrate-phase2.ts --apply
 *
 * NEVER nulls out or overwrites existing product_bom trees or logistics_profiles.
 * COALESCE fill-missing-only for weights, dims, descriptions, images, woo ids.
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
  third_party_sources,
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
import {
  buildAluAttributePatch,
  classifyFramePolicy,
  computeAluMsrp,
  DEFAULT_ALU_UPCHARGE_PCT,
  FRAME_POLICY_ALU10,
  parseMoneyNumber,
  wooEcommercePrice,
  type FramePolicy,
} from "../../src/server/ecommerce/alu10-pricing";
import {
  loadPhase1SowRows,
  PHASE1_RESALE_SKUS,
} from "./enable-phase1-hub-data";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
const UPDATED_BY = "apply-alu10-and-hydrate-phase2";
const UPCHARGE = DEFAULT_ALU_UPCHARGE_PCT;

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
      COUNT(*) FILTER (WHERE aluminum_msrp IS NOT NULL)::int AS aluminum_msrp,
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

function moneyFixed(n: number): string {
  return n.toFixed(2);
}

async function applyPricingToSku(input: {
  sku: string;
  steelMsrp: number;
  framePolicy: FramePolicy;
  sowPhase: 1 | 2;
  isThirdParty: boolean;
}): Promise<{ alu: number; patched: boolean }> {
  const db = getDb();
  const alu =
    wooEcommercePrice({
      steelMsrp: input.steelMsrp,
      framePolicy: input.framePolicy,
      upchargePct: UPCHARGE,
    }) ?? input.steelMsrp;

  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, input.sku))
    .limit(1);
  if (!mapping) {
    return { alu, patched: false };
  }

  const attrs = buildAluAttributePatch(
    mapping.attributes as Record<string, unknown>,
    {
      sowBaseSteelMsrp: input.steelMsrp,
      framePolicy: input.framePolicy,
      upchargePct: UPCHARGE,
      wooAluMsrp: alu,
    },
  );
  attrs.sow_phase = input.sowPhase;

  const listings = await db
    .select()
    .from(ecommerce_listings)
    .where(
      and(
        eq(ecommerce_listings.global_sku, input.sku),
        isNull(ecommerce_listings.archived_at),
      ),
    );

  if (!DRY_RUN) {
    await db
      .update(sku_mappings)
      .set({
        attributes: attrs,
        updated_at: new Date(),
        updated_by: UPDATED_BY,
        version: mapping.version + 1,
      })
      .where(eq(sku_mappings.global_sku, input.sku));

    for (const listing of listings) {
      const patch: Record<string, unknown> = {
        updated_at: new Date(),
        version: listing.version + 1,
      };
      // Preserve existing steel_msrp when already set; fill when blank.
      if (listing.steel_msrp == null) {
        patch.steel_msrp = moneyFixed(input.steelMsrp);
      } else {
        // Authoritative SOW steel baseline — only overwrite when it matches blank/zero.
        const existing = Number(listing.steel_msrp);
        if (!Number.isFinite(existing) || existing <= 0) {
          patch.steel_msrp = moneyFixed(input.steelMsrp);
        }
      }
      // Aluminum / Woo Regular: always align to policy (idempotent).
      if (input.framePolicy === FRAME_POLICY_ALU10) {
        patch.aluminum_msrp = moneyFixed(alu);
      } else {
        // 1.00x — aluminum column mirrors steel for pillows/resale (no upcharge).
        patch.aluminum_msrp = moneyFixed(alu);
      }
      await db
        .update(ecommerce_listings)
        .set(patch)
        .where(eq(ecommerce_listings.id, listing.id));
    }

    // Do NOT clobber finished_goods_catalog.msrp when already present (steel baseline reference).
    const [fg] = await db
      .select()
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, input.sku))
      .limit(1);
    if (fg && (fg.msrp == null || String(fg.msrp).trim() === "")) {
      await db
        .update(finished_goods_catalog)
        .set({
          msrp: moneyFixed(input.steelMsrp),
          updated_at: new Date(),
          updated_by: UPDATED_BY,
        })
        .where(eq(finished_goods_catalog.global_sku, input.sku));
    }
  }

  return { alu, patched: true };
}

async function applyPhase1Pricing(tpsSet: Set<string>): Promise<{
  metal: number;
  pillow: number;
  resale: number;
  samples: Array<{ sku: string; steel: number; alu: number; policy: FramePolicy }>;
}> {
  const sow = loadPhase1SowRows();
  let metal = 0;
  let pillow = 0;
  let resale = 0;
  const samples: Array<{ sku: string; steel: number; alu: number; policy: FramePolicy }> = [];

  for (const row of sow) {
    const steel = parseMoneyNumber(row.msrp);
    if (steel == null || steel <= 0) {
      throw new Error(`Phase 1 SOW missing price for ${row.sku}`);
    }
    const isTps =
      tpsSet.has(row.sku) ||
      (PHASE1_RESALE_SKUS as readonly string[]).includes(row.sku);
    const policy = classifyFramePolicy({
      globalSku: row.sku,
      isThirdParty: isTps,
    });
    if (policy === "aluminum_only_10pct") metal += 1;
    else if (policy === "not_applicable") pillow += 1;
    else resale += 1;

    const { alu } = await applyPricingToSku({
      sku: row.sku,
      steelMsrp: steel,
      framePolicy: policy,
      sowPhase: 1,
      isThirdParty: isTps,
    });
    if (
      row.sku === "FIN-BRV-CLB-CHA-34X34" ||
      row.sku === "FIN-BRV-SWV-CHA-34X34" ||
      row.sku === "FIN-BRV-LOV-SOF-60X34" ||
      row.sku.startsWith("FIN-CAB-") ||
      row.sku.startsWith("FIN-TAY-")
    ) {
      samples.push({ sku: row.sku, steel, alu, policy });
    }
  }

  return { metal, pillow, resale, samples };
}

async function hydratePhase2(
  sowRows: Phase2SowRow[],
  wooRows: ReturnType<typeof parseWooProductExportCsv>,
  aliasMap: Map<string, string>,
  imageMap: Map<string, string>,
  tpsSet: Set<string>,
): Promise<{
  touchedFg: number;
  touchedListings: number;
  touchedAttrs: number;
  readiness: Record<string, number>;
  priced: number;
}> {
  const db = getDb();
  let touchedFg = 0;
  let touchedListings = 0;
  let touchedAttrs = 0;
  let priced = 0;
  const readiness = { ready: 0, needs_variant_heal: 0, no_bom_yet: 0 };

  for (const sow of sowRows) {
    const raw = sow.canonicalSku.trim().toUpperCase();
    const canonical = aliasMap.get(raw) ?? raw;
    if (!canonical) continue;

    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, canonical))
      .limit(1);
    if (!mapping) {
      console.warn(`[alu10] skip missing hub sku ${canonical}`);
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
      .where(
        and(
          eq(ecommerce_listings.global_sku, canonical),
          isNull(ecommerce_listings.archived_at),
        ),
      );

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
      .select({ child: product_bom.child_sku })
      .from(product_bom)
      .where(eq(product_bom.parent_sku, canonical));

    let childMissing = 0;
    if (bomEdges.length > 0) {
      const children = await db
        .select({
          sku: sku_mappings.global_sku,
          vid: sku_mappings.katana_variant_id,
        })
        .from(sku_mappings)
        .where(
          inArray(
            sku_mappings.global_sku,
            bomEdges.map((e) => e.child),
          ),
        );
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

    const steel = parseMoneyNumber(sow.msrp) ?? parseMoneyNumber(fg?.msrp);
    const isTps = tpsSet.has(canonical);
    const policy = classifyFramePolicy({
      globalSku: canonical,
      isThirdParty: isTps,
      attributes: mapping.attributes as Record<string, unknown>,
    });

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
    attrs.sow_phase = 2;
    attrs.bom_readiness = bomReadiness;

    if (steel != null && steel > 0) {
      const alu =
        wooEcommercePrice({
          steelMsrp: steel,
          framePolicy: policy,
          upchargePct: UPCHARGE,
        }) ?? steel;
      Object.assign(
        attrs,
        buildAluAttributePatch(attrs, {
          sowBaseSteelMsrp: steel,
          framePolicy: policy,
          upchargePct: UPCHARGE,
          wooAluMsrp: alu,
        }),
      );
      priced += 1;
    }

    if (!DRY_RUN) {
      if (fg) {
        const patch: Record<string, unknown> = {
          updated_by: UPDATED_BY,
          updated_at: new Date(),
        };
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
        const steelFill = coalescePositiveNumeric(listing.steel_msrp, sow.msrp);
        if (listing.steel_msrp == null && steelFill != null) patch.steel_msrp = steelFill;
        if (steel != null && steel > 0) {
          patch.aluminum_msrp = moneyFixed(
            policy === FRAME_POLICY_ALU10 ? computeAluMsrp(steel, UPCHARGE) : steel,
          );
        }
        const marketing = coalesceText(
          listing.marketing_description,
          woo?.shortDescription,
        );
        if (!listing.marketing_description && marketing) {
          patch.marketing_description = marketing;
        }
        const details = coalesceText(listing.construction_details, woo?.description);
        if (!listing.construction_details && details) {
          patch.construction_details = details;
        }
        if (
          sow.collection &&
          (!listing.collection_label || listing.collection_label === "Uncategorized")
        ) {
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

  // Tag hub library readiness without clobbering existing attrs/BOM.
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
            and(
              isNotNull(finished_goods_catalog.msrp),
              sql`NULLIF(regexp_replace(${finished_goods_catalog.msrp}, '[^0-9.]', '', 'g'), '')::numeric > 0`,
            ),
            sql`EXISTS (SELECT 1 FROM ecommerce_listings el WHERE el.global_sku = ${sku_mappings.global_sku} AND el.steel_msrp IS NOT NULL AND el.steel_msrp > 0 AND el.archived_at IS NULL)`,
          ),
        ),
      )
      .limit(5000);

    for (const row of library) {
      const attrs = (row.attributes as Record<string, unknown>) ?? {};
      if (attrs.sow_phase === 2) continue;
      if (attrs.bom_readiness) continue;
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

  return { touchedFg, touchedListings, touchedAttrs, readiness, priced };
}

async function main() {
  requireFile(PHASE2_CSV);
  requireFile(WOO_CSV);

  console.log(
    `[alu10] mode=${DRY_RUN ? "dry-run" : "apply"} upcharge=${UPCHARGE}%`,
  );

  const before = await snapshotNonNull();
  console.log("[alu10] BEFORE snapshot", JSON.stringify(before, null, 2));

  const db = getDb();
  const tpsRows = await db
    .select({ sku: third_party_sources.global_sku })
    .from(third_party_sources);
  const tpsSet = new Set(tpsRows.map((r) => r.sku.toUpperCase()));

  const phase1 = await applyPhase1Pricing(tpsSet);
  console.log(
    `[alu10] Phase 1 policies metal=${phase1.metal} pillow=${phase1.pillow} resale=${phase1.resale}`,
  );
  console.log("[alu10] samples", JSON.stringify(phase1.samples, null, 2));

  const sowRows = parsePhase2SowCsv(fs.readFileSync(PHASE2_CSV, "utf8"));
  const wooRows = parseWooProductExportCsv(fs.readFileSync(WOO_CSV, "utf8"));
  const aliases = await db.select().from(sku_aliases);
  const aliasMap = new Map(
    aliases.map((a) => [a.alias_sku.toUpperCase(), a.canonical_sku.toUpperCase()]),
  );
  const imageMap = await listStorageImageMap();

  const phase2 = await hydratePhase2(sowRows, wooRows, aliasMap, imageMap, tpsSet);
  console.log(
    `[alu10] Phase 2 hydrate priced=${phase2.priced} fg=${phase2.touchedFg} listings=${phase2.touchedListings}`,
  );

  const after = await snapshotNonNull();
  console.log("[alu10] AFTER snapshot", JSON.stringify(after, null, 2));
  const regressions = assertNoRegression(before, after);
  if (regressions.length) {
    console.error("[alu10] ZERO-DATA-LOSS VIOLATIONS", regressions);
    process.exitCode = 2;
  } else {
    console.log("[alu10] zero-data-loss OK");
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        upchargePct: UPCHARGE,
        phase1,
        phase2,
        regressions,
        before,
        after,
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
  process.exitCode = 1;
});
