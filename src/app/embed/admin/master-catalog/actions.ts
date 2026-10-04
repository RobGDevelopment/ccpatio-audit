"use server";

import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
  quarantine_catalog,
  ecommerce_listings,
  ecommerce_roster_gaps,
  cad_uploads,
  product_bom,
  product_bom_draft,
  channel_sync,
  pim_audit_log,
} from "@/server/db/schema";
import { eq, desc, asc, count, and, inArray } from "drizzle-orm";
import {
  buildFactoryEvidence,
  deriveFactoryReadiness,
  relatedParents,
  type FactoryReadiness,
} from "@/server/factory-bom/derive-readiness";
import { mintHubSkuInTx } from "@/server/master-catalog/mint-hub-sku";
import {
  normalizeLegacySku,
  normalizeProductUrl,
  sharedLegacyPatches,
} from "@/lib/ecommerce-roster";
import { revalidatePath } from "next/cache";

/**
 * NOTE: `finished_goods_catalog` is keyed by `global_sku` (no uuid id), and the
 * product name / Katana / Woo IDs live on `sku_mappings`. `id` below is the
 * global SKU.
 */
export interface CatalogItem {
  id: string;
  productName: string;
  globalSku: string;
  msrp: string;
  isWebVisible: boolean;
  imageUrl: string | null;
  dbSynced: boolean;
  katanaSynced: boolean;
  wooSynced: boolean;
}

export interface QuarantineItem {
  id: string;
  sheetDescription: string;
  targetMsrp: string;
  isWebVisible: boolean;
  createdAt: Date | null;
}

function formatMoney(raw: string | number | null | undefined): string {
  const n = Number(String(raw ?? "").replace(/[^0-9.-]+/g, ""));
  if (!raw || Number.isNaN(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function parsePrice(raw: string): number {
  return Number(raw.replace(/[^0-9.-]+/g, ""));
}

// 1. Fetch Active Catalog (Retail Finished Goods)
export async function getActiveCatalog(): Promise<CatalogItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      globalSku: finished_goods_catalog.global_sku,
      productName: sku_mappings.original_name,
      msrp: finished_goods_catalog.msrp,
      isWebVisible: finished_goods_catalog.is_web_visible,
      imageUrl: finished_goods_catalog.image_url,
      katanaVariantId: sku_mappings.katana_variant_id,
      wooProductId: sku_mappings.woo_product_id,
    })
    .from(finished_goods_catalog)
    .innerJoin(
      sku_mappings,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    )
    .orderBy(sku_mappings.original_name);

  return rows.map((r) => ({
    id: r.globalSku,
    productName: r.productName || "Unnamed Product",
    globalSku: r.globalSku,
    msrp: formatMoney(r.msrp),
    isWebVisible: Boolean(r.isWebVisible),
    imageUrl: r.imageUrl ?? null,
    dbSynced: true,
    katanaSynced: Boolean(r.katanaVariantId),
    wooSynced: Boolean(r.wooProductId),
  }));
}

// 2. Fetch Quarantine Queue
export async function getQuarantineQueue(): Promise<QuarantineItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(quarantine_catalog)
    .orderBy(desc(quarantine_catalog.created_at));

  return rows.map((r) => ({
    id: r.id,
    sheetDescription: r.sheet_description,
    targetMsrp: formatMoney(r.target_msrp),
    isWebVisible: Boolean(r.is_web_visible),
    createdAt: r.created_at,
  }));
}

// 3. Update MSRP Inline
export async function updateProductMSRP(id: string, newPriceRaw: string) {
  const db = getDb();
  const sanitized = parsePrice(newPriceRaw);
  if (Number.isNaN(sanitized)) throw new Error("Invalid numeric price");

  await db
    .update(finished_goods_catalog)
    .set({ msrp: sanitized.toFixed(2), updated_at: new Date() })
    .where(eq(finished_goods_catalog.global_sku, id));

  revalidatePath("/embed/admin/master-catalog");
  return { success: true };
}

// 4. Toggle Web Visibility
export async function toggleWebVisibility(id: string, currentStatus: boolean) {
  const db = getDb();
  await db
    .update(finished_goods_catalog)
    .set({ is_web_visible: !currentStatus, updated_at: new Date() })
    .where(eq(finished_goods_catalog.global_sku, id));

  revalidatePath("/embed/admin/master-catalog");
  return { success: true };
}

// 5. Mint New Product from Quarantine
export async function mintProductFromQuarantine(data: {
  quarantineId: string;
  productName: string;
  globalSku: string;
  msrp: string;
  isWebVisible: boolean;
}) {
  const db = getDb();
  const price = parsePrice(data.msrp);
  const sanitizedPrice = Number.isNaN(price) ? 0 : price;
  const globalSku = data.globalSku.toUpperCase().trim();

  await db.transaction(async (tx) => {
    await tx.insert(sku_mappings).values({
      global_sku: globalSku,
      category: "finished_good",
      item_type: "finished_good",
      original_name: data.productName.trim(),
      source_file: "master-catalog-quarantine",
    });

    await tx.insert(finished_goods_catalog).values({
      global_sku: globalSku,
      msrp: sanitizedPrice.toFixed(2),
      is_web_visible: data.isWebVisible,
    });

    await tx
      .delete(quarantine_catalog)
      .where(eq(quarantine_catalog.id, data.quarantineId));
  });

  revalidatePath("/embed/admin/master-catalog");
  return { success: true, newProductId: globalSku };
}

/* ───────────────────── E-Commerce roster ───────────────────── */

export interface EcommerceListing {
  /** Stable listing id (uuid) — row key, expand key, price-editor key. */
  id: string;
  /** Canonical hub SKU (not unique: several listings can share one). */
  globalSku: string;
  productName: string;
  legacyBaseSku: string | null;
  legacySkuShared: boolean;
  canonicalSkuShared: boolean;
  productUrl: string | null;
  urlSource: "row" | "sibling" | "missing";
  /** Product-type facet. */
  drawingSection: string;
  collectionLabel: string;
  /** Steel MSRP from ecommerce_listings.steel_msrp, formatted for display. */
  /** Display string; an em dash when steel_msrp is null. */
  msrp: string;
  /** Numeric steel MSRP for sorting; null sorts last. */
  msrpValue: number | null;
  aluminumMsrp: string | null;
  marketingDescription: string | null;
  constructionDetails: string | null;
  sheetOrder: number;
  /** Read-only factory readiness, computed once per hub SKU. */
  factory: FactoryReadiness;
}

export interface EcommerceRosterGap {
  globalSku: string;
  productName: string;
  reason: string;
}

export interface EcommerceRoster {
  listings: EcommerceListing[];
  gaps: EcommerceRosterGap[];
}

interface ListingFields {
  id: string;
  globalSku: string;
  productName: string;
  legacyBaseSku: string | null;
  legacySkuShared: boolean;
  canonicalSkuShared: boolean;
  productUrl: string | null;
  urlSource: string;
  drawingSection: string;
  collectionLabel: string;
  aluminumMsrp: string | null;
  marketingDescription: string | null;
  constructionDetails: string | null;
  sheetOrder: number;
  msrp: string | null;
}

/** A null steel MSRP displays as an em dash and sorts last (never "$0.00"). */
function toListing(r: ListingFields, factory: FactoryReadiness): EcommerceListing {
  return {
    id: r.id,
    globalSku: r.globalSku,
    productName: r.productName,
    legacyBaseSku: r.legacyBaseSku,
    legacySkuShared: r.legacySkuShared,
    canonicalSkuShared: r.canonicalSkuShared,
    productUrl: r.productUrl,
    urlSource:
      r.urlSource === "row" || r.urlSource === "sibling" ? r.urlSource : "missing",
    drawingSection: r.drawingSection,
    collectionLabel: r.collectionLabel,
    msrp: r.msrp === null ? "—" : formatMoney(r.msrp),
    msrpValue: r.msrp === null ? null : parsePrice(r.msrp) || 0,
    aluminumMsrp: r.aluminumMsrp ? formatMoney(r.aluminumMsrp) : null,
    marketingDescription: r.marketingDescription,
    constructionDetails: r.constructionDetails,
    sheetOrder: r.sheetOrder,
    factory,
  };
}

/** Safe default if a hub SKU is ever missing from the readiness map. */
const UNKNOWN_FACTORY_READINESS: FactoryReadiness = {
  state: "missing_cad",
  sublabel: "Unknown",
  cadFilename: null,
  cadStatus: null,
  draftRollup: "none",
  liveRecipe: false,
  katanaStatus: null,
  recipePublished: false,
};

// 6. E-Commerce roster (listings ⨝ sku_mappings) + gaps. Price is the listing's
// own steel_msrp: finished_goods_catalog.msrp is one number per hub SKU and
// can't represent several listings that share a SKU.
export async function getEcommerceRoster(): Promise<EcommerceRoster> {
  const db = getDb();
  const [rows, gapRows] = await Promise.all([
    db
      .select({
        id: ecommerce_listings.id,
        globalSku: ecommerce_listings.global_sku,
        productName: ecommerce_listings.product_name,
        legacyBaseSku: ecommerce_listings.legacy_base_sku,
        legacySkuShared: ecommerce_listings.legacy_sku_shared,
        canonicalSkuShared: ecommerce_listings.canonical_sku_shared,
        productUrl: ecommerce_listings.product_url,
        urlSource: ecommerce_listings.url_source,
        drawingSection: ecommerce_listings.drawing_section,
        collectionLabel: ecommerce_listings.collection_label,
        aluminumMsrp: ecommerce_listings.aluminum_msrp,
        marketingDescription: ecommerce_listings.marketing_description,
        constructionDetails: ecommerce_listings.construction_details,
        sheetOrder: ecommerce_listings.sheet_order,
        msrp: ecommerce_listings.steel_msrp,
      })
      .from(ecommerce_listings)
      .innerJoin(
        sku_mappings,
        eq(ecommerce_listings.global_sku, sku_mappings.global_sku),
      )
      .orderBy(asc(ecommerce_listings.sheet_order)),
    db
      .select()
      .from(ecommerce_roster_gaps)
      .orderBy(asc(ecommerce_roster_gaps.product_name)),
  ]);

  // Five set queries (read-only), reduced in memory per distinct hub SKU.
  const hubSkus = [...new Set(rows.map((r) => r.globalSku))];
  const parentSkus = [...new Set(hubSkus.flatMap(relatedParents))];
  const [cadRows, draftRows, liveRows, katanaRows, auditRows] =
    hubSkus.length === 0
      ? [[], [], [], [], []]
      : await Promise.all([
          db
            .select({
              global_sku: cad_uploads.global_sku,
              ext: cad_uploads.ext,
              status: cad_uploads.status,
              original_filename: cad_uploads.original_filename,
              created_at: cad_uploads.created_at,
            })
            .from(cad_uploads)
            .where(inArray(cad_uploads.global_sku, hubSkus)),
          db
            .select({
              parent_sku: product_bom_draft.parent_sku,
              status: product_bom_draft.status,
            })
            .from(product_bom_draft)
            .where(inArray(product_bom_draft.parent_sku, parentSkus)),
          db
            .selectDistinct({ parent_sku: product_bom.parent_sku })
            .from(product_bom)
            .where(inArray(product_bom.parent_sku, parentSkus)),
          db
            .select({
              global_sku: channel_sync.global_sku,
              status: channel_sync.status,
            })
            .from(channel_sync)
            .where(
              and(
                eq(channel_sync.channel, "katana"),
                inArray(channel_sync.global_sku, hubSkus),
              ),
            ),
          db
            .selectDistinct({ global_sku: pim_audit_log.global_sku })
            .from(pim_audit_log)
            .where(
              and(
                eq(pim_audit_log.action, "factory_bom_katana_recipes"),
                inArray(pim_audit_log.global_sku, hubSkus),
              ),
            ),
        ]);

  const evidence = buildFactoryEvidence(hubSkus, {
    cadRows,
    draftRows,
    liveParents: liveRows.map((r) => r.parent_sku),
    katanaRows,
    auditSkus: auditRows.flatMap((r) => (r.global_sku ? [r.global_sku] : [])),
  });
  const readiness = new Map<string, FactoryReadiness>();
  for (const [sku, ev] of evidence) readiness.set(sku, deriveFactoryReadiness(ev));

  const listings: EcommerceListing[] = rows.map((r) =>
    toListing(r, readiness.get(r.globalSku) ?? UNKNOWN_FACTORY_READINESS),
  );

  const gaps: EcommerceRosterGap[] = gapRows.map((g) => ({
    globalSku: g.global_sku,
    productName: g.product_name,
    reason: g.reason,
  }));

  return { listings, gaps };
}

// 7. Edit a listing's steel MSRP. Mirrors to finished_goods_catalog.msrp ONLY
// when the hub SKU backs exactly one listing; shared hub SKUs never write there
// (and never go through updateProductMSRP).
export async function updateListingMsrp(id: string, newPriceRaw: string) {
  const db = getDb();
  const price = parsePrice(newPriceRaw);
  if (Number.isNaN(price)) throw new Error("Invalid numeric price");
  const fixed = price.toFixed(2);

  const mirrored = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(ecommerce_listings)
      .set({ steel_msrp: fixed, updated_at: new Date() })
      .where(eq(ecommerce_listings.id, id))
      .returning({ globalSku: ecommerce_listings.global_sku });
    if (!row) throw new Error("Listing not found");

    const [{ n }] = await tx
      .select({ n: count() })
      .from(ecommerce_listings)
      .where(eq(ecommerce_listings.global_sku, row.globalSku));
    if (Number(n) !== 1) return null;

    await tx
      .update(finished_goods_catalog)
      .set({ msrp: fixed, updated_at: new Date() })
      .where(eq(finished_goods_catalog.global_sku, row.globalSku));
    return row.globalSku;
  });

  revalidatePath("/embed/admin/master-catalog");
  return { success: true, mirroredSku: mirrored };
}

// 8. Inline link. Writes product_url + url_source=row + the operator flag so a
// re-seed keeps it. Never copies the URL onto sibling listings.
export async function updateListingUrl(
  id: string,
  raw: string,
): Promise<{ url: string }> {
  const n = normalizeProductUrl(raw);
  if (!n.ok) throw new Error(n.error);
  const db = getDb();
  const [row] = await db
    .update(ecommerce_listings)
    .set({
      product_url: n.value,
      url_source: "row",
      url_operator_set: true,
      updated_at: new Date(),
    })
    .where(eq(ecommerce_listings.id, id))
    .returning({ id: ecommerce_listings.id });
  if (!row) throw new Error("Listing not found");
  revalidatePath("/embed/admin/master-catalog");
  return { url: n.value };
}

// 9. Inline legacy base SKU. Recomputes legacy_sku_shared for every listing and
// returns each flag that changed (including a previous twin that lost its chip).
export async function updateListingLegacySku(
  id: string,
  raw: string,
): Promise<{
  legacyBaseSku: string;
  sharedPatches: { id: string; legacySkuShared: boolean }[];
}> {
  const n = normalizeLegacySku(raw);
  if (!n.ok) throw new Error(n.error);
  const db = getDb();
  const sharedPatches = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(ecommerce_listings)
      .set({
        legacy_base_sku: n.value,
        legacy_operator_set: true,
        updated_at: new Date(),
      })
      .where(eq(ecommerce_listings.id, id))
      .returning({ id: ecommerce_listings.id });
    if (!row) throw new Error("Listing not found");

    const all = await tx
      .select({
        id: ecommerce_listings.id,
        productName: ecommerce_listings.product_name,
        legacyBaseSku: ecommerce_listings.legacy_base_sku,
        legacySkuShared: ecommerce_listings.legacy_sku_shared,
      })
      .from(ecommerce_listings);
    const patches = sharedLegacyPatches(all);
    for (const p of patches) {
      await tx
        .update(ecommerce_listings)
        .set({ legacy_sku_shared: p.legacySkuShared })
        .where(eq(ecommerce_listings.id, p.id));
    }
    return patches;
  });
  revalidatePath("/embed/admin/master-catalog");
  return { legacyBaseSku: n.value, sharedPatches };
}

export interface MintHubSkuResult {
  globalSku: string;
  listings: EcommerceListing[];
  sharedPatches: { id: string; canonicalSkuShared: boolean }[];
  promotedGapNames: string[];
}

// 10. Mint a hub SKU from a gap group in ONE transaction (see mintHubSkuInTx).
// No Katana / WooCommerce / CAD call.
export async function mintHubSkuFromGap(
  globalSku: string,
): Promise<MintHubSkuResult> {
  const db = getDb();
  const result = await db.transaction((tx) => mintHubSkuInTx(tx, globalSku));
  revalidatePath("/embed/admin/master-catalog");

  // A brand-new hub SKU has no CAD, drafts, recipe or Katana row.
  const factory = deriveFactoryReadiness({
    liveRecipe: false,
    draftStatuses: [],
    latestDae: null,
    katanaStatus: null,
    recipePublished: false,
  });
  return {
    globalSku: globalSku.trim().toUpperCase(),
    listings: result.inserted.map((r) =>
      toListing(
        {
          id: r.id,
          globalSku: r.global_sku,
          productName: r.product_name,
          legacyBaseSku: r.legacy_base_sku,
          legacySkuShared: r.legacy_sku_shared,
          canonicalSkuShared: r.canonical_sku_shared,
          productUrl: r.product_url,
          urlSource: r.url_source,
          drawingSection: r.drawing_section,
          collectionLabel: r.collection_label,
          aluminumMsrp: r.aluminum_msrp,
          marketingDescription: r.marketing_description,
          constructionDetails: r.construction_details,
          sheetOrder: r.sheet_order,
          msrp: r.steel_msrp,
        },
        factory,
      ),
    ),
    sharedPatches: result.sharedPatches,
    promotedGapNames: result.promotedGapNames,
  };
}
