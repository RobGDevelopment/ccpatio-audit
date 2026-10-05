"use server";

import { getDb } from "@/server/db/client";
import { createClient } from "@/utils/supabase/server";
import { commercialOverrideAllowed } from "@/server/quotes/override-role";
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
  product_assets,
  third_party_sources,
  nomenclature_collections,
  nomenclature_categories,
  nomenclature_sku_tokens,
  user_roles,
  catalog_ship_profiles,
} from "@/server/db/schema";
import { eq, desc, asc, count, and, inArray, sql, max, or, not, like, isNull } from "drizzle-orm";
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
import { createAssetSignedUpload, createAssetSignedDownload, getVaultStorage } from "@/lib/supabase-storage";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildCompletenessSnapshot, scoreProduct, batchCompletenessSnapshots } from "@/server/pim/completeness";
import { getPimSession, logPimAudit, isEmbedPrincipal, type PimSession } from "@/lib/pim-audit";
import {
  planAssetUpload,
  confirmAssetCore,
  listVaultAssets,
  KIND_POLICY,
  deleteGalleryAssetCore,
  updateAssetAltTextCore,
  type ConfirmedAsset,
  type VaultAssetView,
} from "@/server/pim/asset-vault";
import type { ProductAssetKind } from "@/server/db/schema";
import { normalizeStoryInput, storyHtmlToPlainText } from "@/server/pim/html-sanitize";
import {
  requestSeoSuggestion,
  seoAssistantConfigured,
  dimensionsForPrompt,
  SEO_NOT_CONFIGURED,
} from "@/server/pim/seo-assistant";
import { SEO_LIMITS, SLUG_RE, normalizeTags } from "@/lib/seo-limits";
import { deriveDfmFreight } from "@/lib/freight-utils";

/** The AI action needs a real @ccpatio.com person; a human session outranks the embed principal. */
function aiOperatorEligible(session: PimSession): boolean {
  return !isEmbedPrincipal(session) && /@ccpatio\.com$/i.test(session.email);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint_name ?? e?.cause?.constraint_name;
  return code === "23505" && (!name || name === constraint);
}

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
  status?: "red" | "amber" | "green";
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
      syncToWoo: sku_mappings.sync_to_woo,
    })
    .from(finished_goods_catalog)
    .innerJoin(
      sku_mappings,
      eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
    )
    .where(
      and(
        eq(sku_mappings.item_type, 'finished_good'),
        inArray(sku_mappings.product_origin, ['manufactured', 'third_party']),
        not(like(sku_mappings.global_sku, 'RM-%')),
        not(like(sku_mappings.global_sku, 'PWD-%')),
        not(like(sku_mappings.global_sku, 'FAB-%')),
        not(like(sku_mappings.global_sku, 'ASM-%')),
        not(like(sku_mappings.global_sku, 'SA-%'))
      )
    )
    .orderBy(sku_mappings.original_name);

  const listingRows = await db
    .select({ globalSku: ecommerce_listings.global_sku, id: ecommerce_listings.id })
    .from(ecommerce_listings);
  const listingsBySku = new Map<string, string>();
  for (const r of listingRows) {
    if (!listingsBySku.has(r.globalSku)) listingsBySku.set(r.globalSku, r.id);
  }

  const itemsForBatch = rows.map(r => ({
    globalSku: r.globalSku,
    listingId: listingsBySku.get(r.globalSku) || "",
    factoryState: "published",
  }));

  const snaps = await batchCompletenessSnapshots(db, itemsForBatch);

  return rows.map((r, idx) => {
    const snap = snaps[idx];
    const { score, canSyncWoo } = scoreProduct(snap);

    let status: "red" | "amber" | "green" | undefined;
    if (canSyncWoo && r.syncToWoo) {
      status = "green";
    } else if (score === 100 && snap.assets.hasPrimary && r.isWebVisible && !r.syncToWoo) {
      status = "amber";
    } else if (r.isWebVisible || r.syncToWoo) {
      status = "red";
    }

    return {
      id: r.globalSku,
      productName: r.productName || "Unnamed Product",
      globalSku: r.globalSku,
      msrp: formatMoney(r.msrp),
      isWebVisible: Boolean(r.isWebVisible),
      imageUrl: r.imageUrl ?? null,
      dbSynced: true,
      katanaSynced: Boolean(r.katanaVariantId),
      wooSynced: Boolean(r.wooProductId),
      status,
    };
  });
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
  version: number;
  hubVersion: number;
  hubLength: string | null;
  hubDepth: string | null;
  hubWeight: string | null;
  hubHeight: string | null;
  hubArmHeight: string | null;
  hubSitHeight: string | null;
  hubNaFields: string[];
  imageUrl: string | null;
  archivedAt: Date | null;
  syncToWoo: boolean;
  syncToClover: boolean;
  cloverItemId: string | null;
  qboItemId: string | null;
  baseCost: string | null;
  cost: string | null;
  salePrice: string | null;
  saleEndsAt: string | null;
  isWebVisible: boolean;
  assemblyRequired: boolean;
  warrantyTermMonths: number | null;
  warrantyCovers: string | null;
  thirdParty: {
    vendorName: string | null;
    vendorSku: string | null;
    wholesaleCost: string | null;
  } | null;
  status?: "red" | "amber" | "green";
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
  version: number;
  hubVersion: number;
  hubLength: string | null;
  hubDepth: string | null;
  hubWeight: string | null;
  hubNaFields: string[];
  imageUrl: string | null;
  archivedAt: Date | null;
  syncToWoo: boolean;
  syncToClover: boolean;
  cloverItemId: string | null;
  qboItemId: string | null;
  baseCost: string | null;
  cost: string | null;
  salePrice: string | null;
  saleEndsAt: Date | null;
  hubHeight: string | null;
  hubArmHeight: string | null;
  hubSitHeight: string | null;
  isWebVisible: boolean;
  assemblyRequired: boolean;
  warrantyTermMonths: number | null;
  warrantyCovers: string | null;
  vendorName: string | null;
  vendorSku: string | null;
  wholesaleCost: string | null;
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
    // Defence in depth: legacy rows may hold plain text or unsanitized HTML.
    marketingDescription: normalizeStoryInput(r.marketingDescription),
    constructionDetails: normalizeStoryInput(r.constructionDetails),
    sheetOrder: r.sheetOrder,
    factory,
    version: r.version,
    hubVersion: r.hubVersion,
    hubLength: r.hubLength,
    hubDepth: r.hubDepth,
    hubWeight: r.hubWeight,
    hubNaFields: r.hubNaFields || [],
    imageUrl: r.imageUrl,
    archivedAt: r.archivedAt,
    syncToWoo: r.syncToWoo,
    syncToClover: r.syncToClover,
    cloverItemId: r.cloverItemId,
    qboItemId: r.qboItemId,
    baseCost: r.baseCost,
    cost: r.cost,
    salePrice: r.salePrice,
    saleEndsAt: r.saleEndsAt ? r.saleEndsAt.toISOString() : null,
    hubHeight: r.hubHeight,
    hubArmHeight: r.hubArmHeight,
    hubSitHeight: r.hubSitHeight,
    isWebVisible: r.isWebVisible,
    assemblyRequired: r.assemblyRequired,
    warrantyTermMonths: r.warrantyTermMonths,
    warrantyCovers: r.warrantyCovers,
    thirdParty: (r.vendorName || r.vendorSku || r.wholesaleCost) ? {
      vendorName: r.vendorName,
      vendorSku: r.vendorSku,
      wholesaleCost: r.wholesaleCost,
    } : null,
  };
}

/**
 * Hub fields for a finished good that has no ecommerce listing.
 * `id` is empty so hub save does not look up a listing row.
 */
export async function getHubProductForDrawer(globalSku: string): Promise<EcommerceListing | null> {
  const db = getDb();
  const [row] = await db
    .select({
      globalSku: sku_mappings.global_sku,
      productName: sku_mappings.original_name,
      hubVersion: sku_mappings.version,
      syncToWoo: sku_mappings.sync_to_woo,
      syncToClover: sku_mappings.sync_to_clover,
      cloverItemId: sku_mappings.clover_item_id,
      qboItemId: sku_mappings.qbo_item_id,
      baseCost: sku_mappings.base_cost,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      armHeight: finished_goods_catalog.arm_height,
      sitHeight: finished_goods_catalog.sit_height,
      weight: finished_goods_catalog.weight,
      naFields: finished_goods_catalog.na_fields,
      imageUrl: finished_goods_catalog.image_url,
      isWebVisible: finished_goods_catalog.is_web_visible,
      assemblyRequired: finished_goods_catalog.assembly_required,
      warrantyTermMonths: finished_goods_catalog.warranty_term_months,
      warrantyCovers: finished_goods_catalog.warranty_covers,
      cost: finished_goods_catalog.cost,
      vendorName: third_party_sources.vendor_name,
      vendorSku: third_party_sources.vendor_sku,
      wholesaleCost: third_party_sources.wholesale_cost,
    })
    .from(sku_mappings)
    .leftJoin(finished_goods_catalog, eq(finished_goods_catalog.global_sku, sku_mappings.global_sku))
    .leftJoin(third_party_sources, eq(third_party_sources.global_sku, sku_mappings.global_sku))
    .where(eq(sku_mappings.global_sku, globalSku))
    .limit(1);
  if (!row) return null;

  const readiness = await getFactoryReadinessMap([globalSku]);
  return {
    id: "",
    globalSku: row.globalSku,
    productName: row.productName || "Unnamed Product",
    legacyBaseSku: null,
    legacySkuShared: false,
    canonicalSkuShared: false,
    productUrl: null,
    urlSource: "missing",
    drawingSection: "",
    collectionLabel: "",
    msrp: "—",
    msrpValue: null,
    aluminumMsrp: null,
    marketingDescription: null,
    constructionDetails: null,
    sheetOrder: 0,
    factory: readiness.get(globalSku) ?? UNKNOWN_FACTORY_READINESS,
    version: 0,
    hubVersion: row.hubVersion,
    hubLength: row.length,
    hubDepth: row.depth,
    hubWeight: row.weight,
    hubHeight: row.height,
    hubArmHeight: row.armHeight,
    hubSitHeight: row.sitHeight,
    hubNaFields: row.naFields ?? [],
    imageUrl: row.imageUrl,
    archivedAt: null,
    syncToWoo: Boolean(row.syncToWoo),
    syncToClover: Boolean(row.syncToClover),
    cloverItemId: row.cloverItemId,
    qboItemId: row.qboItemId,
    baseCost: row.baseCost,
    cost: row.cost,
    salePrice: null,
    saleEndsAt: null,
    isWebVisible: Boolean(row.isWebVisible),
    assemblyRequired: Boolean(row.assemblyRequired),
    warrantyTermMonths: row.warrantyTermMonths,
    warrantyCovers: row.warrantyCovers,
    thirdParty: row.vendorName || row.vendorSku || row.wholesaleCost
      ? {
          vendorName: row.vendorName,
          vendorSku: row.vendorSku,
          wholesaleCost: row.wholesaleCost,
        }
      : null,
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
export async function getFactoryReadinessMap(hubSkus: string[]) {
  const db = getDb();
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
  return readiness;
}

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
        version: ecommerce_listings.version,
        archivedAt: ecommerce_listings.archived_at,
        hubVersion: sku_mappings.version,
        hubLength: finished_goods_catalog.length,
        hubDepth: finished_goods_catalog.depth,
        hubWeight: finished_goods_catalog.weight,
        hubNaFields: finished_goods_catalog.na_fields,
        imageUrl: finished_goods_catalog.image_url,
        syncToWoo: sku_mappings.sync_to_woo,
        syncToClover: sku_mappings.sync_to_clover,
        cloverItemId: sku_mappings.clover_item_id,
        qboItemId: sku_mappings.qbo_item_id,
        baseCost: sku_mappings.base_cost,
        cost: finished_goods_catalog.cost,
        salePrice: ecommerce_listings.sale_price,
        saleEndsAt: ecommerce_listings.sale_ends_at,
        hubHeight: finished_goods_catalog.height,
        hubArmHeight: finished_goods_catalog.arm_height,
        hubSitHeight: finished_goods_catalog.sit_height,
        isWebVisible: finished_goods_catalog.is_web_visible,
        assemblyRequired: finished_goods_catalog.assembly_required,
        warrantyTermMonths: finished_goods_catalog.warranty_term_months,
        warrantyCovers: finished_goods_catalog.warranty_covers,
        vendorName: third_party_sources.vendor_name,
        vendorSku: third_party_sources.vendor_sku,
        wholesaleCost: third_party_sources.wholesale_cost,
      })
      .from(ecommerce_listings)
      .innerJoin(
        sku_mappings,
        eq(ecommerce_listings.global_sku, sku_mappings.global_sku),
      )
      .leftJoin(
        finished_goods_catalog,
        eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
      )
      .leftJoin(
        third_party_sources,
        eq(sku_mappings.global_sku, third_party_sources.global_sku),
      )
      .where(
        and(
          isNull(ecommerce_listings.archived_at),
          eq(sku_mappings.item_type, 'finished_good'),
          inArray(sku_mappings.product_origin, ['manufactured', 'third_party']),
          not(like(sku_mappings.global_sku, 'RM-%')),
          not(like(sku_mappings.global_sku, 'PWD-%')),
          not(like(sku_mappings.global_sku, 'FAB-%')),
          not(like(sku_mappings.global_sku, 'ASM-%')),
          not(like(sku_mappings.global_sku, 'SA-%'))
        )
      )
      .orderBy(asc(ecommerce_listings.sheet_order)),
    db
      .select()
      .from(ecommerce_roster_gaps)
      .where(
        and(
          not(like(ecommerce_roster_gaps.global_sku, 'RM-%')),
          not(like(ecommerce_roster_gaps.global_sku, 'PWD-%')),
          not(like(ecommerce_roster_gaps.global_sku, 'FAB-%')),
          not(like(ecommerce_roster_gaps.global_sku, 'ASM-%')),
          not(like(ecommerce_roster_gaps.global_sku, 'SA-%'))
        )
      )
      .orderBy(asc(ecommerce_roster_gaps.product_name)),
  ]);

  const hubSkus = [...new Set(rows.map((r) => r.globalSku))];
  const readiness = await getFactoryReadinessMap(hubSkus);

  const itemsForBatch = rows.map(r => ({
    globalSku: r.globalSku,
    listingId: r.id,
    factoryState: readiness.get(r.globalSku)?.state ?? "unknown",
  }));

  const snaps = await batchCompletenessSnapshots(db, itemsForBatch);

  const listings: EcommerceListing[] = rows.map((r, idx) => {
    const listing = toListing({ 
      ...r, 
      hubNaFields: r.hubNaFields || [],
      isWebVisible: Boolean(r.isWebVisible),
      assemblyRequired: Boolean(r.assemblyRequired)
    }, readiness.get(r.globalSku) ?? UNKNOWN_FACTORY_READINESS);
    
    const snap = snaps[idx];
    const { score, canSyncWoo } = scoreProduct(snap);
    
    let status: "red" | "amber" | "green" | undefined;
    if (canSyncWoo && r.syncToWoo) {
      status = "green";
    } else if (score === 100 && snap.assets.hasPrimary && r.isWebVisible && !r.syncToWoo) {
      status = "amber";
    } else if (r.isWebVisible || r.syncToWoo) {
      status = "red";
    }

    return { ...listing, status };
  });

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

  const { mirrored, version } = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(ecommerce_listings)
      .set({ 
        steel_msrp: fixed, 
        updated_at: new Date(),
        version: sql`version + 1` 
      })
      .where(eq(ecommerce_listings.id, id))
      .returning({ globalSku: ecommerce_listings.global_sku, version: ecommerce_listings.version });
    if (!row) throw new Error("Listing not found");

    const [{ n }] = await tx
      .select({ n: count() })
      .from(ecommerce_listings)
      .where(eq(ecommerce_listings.global_sku, row.globalSku));
    if (Number(n) !== 1) return { mirrored: null, version: row.version };

    await tx
      .update(finished_goods_catalog)
      .set({ msrp: fixed, updated_at: new Date() })
      .where(eq(finished_goods_catalog.global_sku, row.globalSku));
    return { mirrored: row.globalSku, version: row.version };
  });

  revalidatePath("/embed/admin/master-catalog");
  return { success: true, mirroredSku: mirrored, version };
}

// 8. Inline link. Writes product_url + url_source=row + the operator flag so a
// re-seed keeps it. Never copies the URL onto sibling listings.
export async function updateListingUrl(
  id: string,
  raw: string,
): Promise<{ url: string; version: number }> {
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
      version: sql`version + 1`,
    })
    .where(eq(ecommerce_listings.id, id))
    .returning({ id: ecommerce_listings.id, version: ecommerce_listings.version });
  if (!row) throw new Error("Listing not found");
  revalidatePath("/embed/admin/master-catalog");
  return { url: n.value, version: row.version };
}

// 9. Inline legacy base SKU. Recomputes legacy_sku_shared for every listing and
// returns each flag that changed (including a previous twin that lost its chip).
export async function updateListingLegacySku(
  id: string,
  raw: string,
): Promise<{
  legacyBaseSku: string;
  sharedPatches: { id: string; legacySkuShared: boolean }[];
  version: number;
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
        version: sql`version + 1`,
      })
      .where(eq(ecommerce_listings.id, id))
      .returning({ id: ecommerce_listings.id, version: ecommerce_listings.version });
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
    return { patches, version: row.version };
  });
  revalidatePath("/embed/admin/master-catalog");
  return { legacyBaseSku: n.value, sharedPatches: sharedPatches.patches, version: sharedPatches.version };
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
          version: 1,
          hubVersion: 1,
          hubLength: null,
          hubDepth: null,
          hubWeight: null,
          hubNaFields: [],
          imageUrl: null,
          archivedAt: null,
          syncToWoo: false,
          syncToClover: false,
          cloverItemId: null,
          qboItemId: null,
          baseCost: null,
          cost: null,
          salePrice: null,
          saleEndsAt: null,
          hubHeight: null,
          hubArmHeight: null,
          hubSitHeight: null,
          isWebVisible: false,
          assemblyRequired: false,
          warrantyTermMonths: null,
          warrantyCovers: null,
          vendorName: null,
          vendorSku: null,
          wholesaleCost: null,
        },
        factory,
      ),
    ),
    sharedPatches: result.sharedPatches,
    promotedGapNames: result.promotedGapNames,
  };
}

// 11. Drawer save for listing fields. Uses expectedVersion for optimistic locking.
export async function updateListingInDrawer(
  id: string,
  expectedVersion: number,
  payload: {
    collectionLabel: string;
    steelMsrp: string | null; // formatted or raw, will parse
    aluminumMsrp: string | null;
    legacyBaseSku: string | null;
    productUrl: string | null;
    salePrice: string | null;
    saleEndsAt: string | null;
  }
) {
  const db = getDb();
  const parsedPrice = payload.steelMsrp ? parsePrice(payload.steelMsrp) : null;
  const fixedPrice = parsedPrice !== null && !Number.isNaN(parsedPrice) ? parsedPrice.toFixed(2) : null;
  
  const parsedAlumPrice = payload.aluminumMsrp ? parsePrice(payload.aluminumMsrp) : null;
  
  const parsedSalePrice = payload.salePrice ? parsePrice(payload.salePrice) : null;
  const fixedSalePrice = parsedSalePrice !== null && !Number.isNaN(parsedSalePrice) ? parsedSalePrice.toFixed(2) : null;

  if (parsedSalePrice !== null && !Number.isNaN(parsedSalePrice)) {
    if (parsedSalePrice <= 0) {
      throw new Error("Sale price must be greater than zero.");
    }
    if (!payload.saleEndsAt) {
      throw new Error("Sale price requires an end date.");
    }
    if (parsedPrice !== null && parsedSalePrice >= parsedPrice) {
      throw new Error("Sale price must be less than Steel MSRP.");
    }
    if (parsedAlumPrice !== null && parsedSalePrice >= parsedAlumPrice) {
      throw new Error("Sale price must be less than Aluminum MSRP.");
    }
  } else {
    // If salePrice is cleared, force saleEndsAt to null
    payload.saleEndsAt = null;
  }
  
  const legacyNormal = payload.legacyBaseSku ? normalizeLegacySku(payload.legacyBaseSku) : ({ ok: true, value: null } as const);
  if (!legacyNormal.ok) throw new Error(legacyNormal.error);
  
  const urlNormal = payload.productUrl ? normalizeProductUrl(payload.productUrl) : ({ ok: true, value: null } as const);
  if (!urlNormal.ok) throw new Error(urlNormal.error);

  const sharedPatches = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(ecommerce_listings)
      .set({
        collection_label: payload.collectionLabel,
        steel_msrp: fixedPrice,
        aluminum_msrp: payload.aluminumMsrp ? parsePrice(payload.aluminumMsrp).toFixed(2) : null,
        sale_price: fixedSalePrice,
        sale_ends_at: payload.saleEndsAt ? new Date(payload.saleEndsAt) : null,
        legacy_base_sku: legacyNormal.value,
        legacy_operator_set: legacyNormal.value ? true : false,
        product_url: urlNormal.value,
        url_source: urlNormal.value ? "row" : "missing",
        url_operator_set: urlNormal.value ? true : false,
        updated_at: new Date(),
        version: sql`version + 1`,
      })
      .where(
        and(
          eq(ecommerce_listings.id, id),
          eq(ecommerce_listings.version, expectedVersion)
        )
      )
      .returning({ id: ecommerce_listings.id, version: ecommerce_listings.version, globalSku: ecommerce_listings.global_sku });
      
    if (!row) {
      throw new Error("This product was saved by someone else. Reload.");
    }

    // Mirrors MSRP to finished_goods_catalog if it's the only listing on this hub SKU
    if (fixedPrice !== null) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(ecommerce_listings)
        .where(eq(ecommerce_listings.global_sku, row.globalSku));
      if (Number(n) === 1) {
        await tx
          .update(finished_goods_catalog)
          .set({ msrp: fixedPrice, updated_at: new Date() })
          .where(eq(finished_goods_catalog.global_sku, row.globalSku));
      }
    }

    // Recompute legacy shared flags
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
  return {
    success: true,
    sharedPatches,
  };
}

// 12. Drawer save for hub fields. Uses expectedVersion on sku_mappings.
export async function updateHubInDrawer(
  listingId: string,
  globalSku: string,
  expectedVersion: number,
  payload: {
    length?: string | null;
    depth?: string | null;
    height?: string | null;
    armHeight?: string | null;
    sitHeight?: string | null;
    weight?: string | null;
    imageUrl?: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
    slug?: string | null;
    isWebVisible?: boolean;
    baseCost?: string | null;
    cost?: string | null;
    syncToWoo?: boolean;
    syncToClover?: boolean;
    naFields?: string[];
    publishConfirmed?: boolean;
    assemblyRequired?: boolean;
    warrantyTermMonths?: number | null;
    warrantyCovers?: string | null;
    vendorName?: string | null;
    vendorSku?: string | null;
    wholesaleCost?: string | null;
  }
) {
  const session = await getPimSession();
  if (!session || isEmbedPrincipal(session) || !session.email?.endsWith("@ccpatio.com")) {
    throw new Error("Unauthorized");
  }

  const db = getDb();
  
  try {
    await db.transaction(async (tx) => {
    // 1. Calculate Completeness Score to enforce sync toggles.
    // An empty listing id is hub-only: the finished good has no ecommerce_listings row.
    const hubOnly = listingId.length === 0;
    const [listing] = hubOnly
      ? [undefined]
      : await tx
          .select()
          .from(ecommerce_listings)
          .where(eq(ecommerce_listings.id, listingId));

    if (!hubOnly && !listing) throw new Error("Listing not found");

    const readinessMap = await getFactoryReadinessMap([globalSku]);
    const factoryState = (readinessMap.get(globalSku) ?? UNKNOWN_FACTORY_READINESS).state;

    const snap = await buildCompletenessSnapshot(tx, globalSku, listing?.id ?? "", factoryState, payload);
    const { score, gates, canSyncWoo, canSyncClover } = scoreProduct(snap);
    const isArchived = !!listing?.archived_at;
    const isComplete = score === 100;
    const canSyncW = canSyncWoo && !isArchived;
    const canSyncC = canSyncClover && !isArchived;

    // Check for sync block
    const requestedWoo = "syncToWoo" in payload && payload.syncToWoo === true;
    const requestedClover = "syncToClover" in payload && payload.syncToClover === true;
    
    let wooJustEnabled = false;
    if (requestedWoo) {
      const [currentMapping] = await tx.select({ sync_to_woo: sku_mappings.sync_to_woo }).from(sku_mappings).where(eq(sku_mappings.global_sku, globalSku));
      if (currentMapping && !currentMapping.sync_to_woo) {
        if (!payload.publishConfirmed) {
          throw new Error(JSON.stringify({ ok: false, error: "publish_unconfirmed" }));
        }
        wooJustEnabled = true;
      }
    }

    if ((requestedWoo && !canSyncW) || (requestedClover && !canSyncC)) {
      const failing = gates ? gates.filter((g: any) => !g.passed).map((g: any) => g.id) : [];
      // The Woo sentence is only for a complete product blocked by the hero/visibility mask.
      // A short score stays sync_blocked so the failing gates are what the operator sees.
      const wooMask =
        requestedWoo &&
        !canSyncW &&
        score === 100 &&
        !(requestedClover && !canSyncC) &&
        (!snap.assets.hasPrimary || !snap.isWebVisible);
      if (wooMask) {
        throw new Error("Woo requires a primary image and web visibility.");
      }
      throw new Error(JSON.stringify({ ok: false, error: "sync_blocked", score, failing }));
    }

    // 2. Bump version on sku_mappings
    const mappingSet: any = { version: sql`version + 1`, updated_at: new Date() };
    if ("baseCost" in payload) mappingSet.base_cost = payload.baseCost ? parsePrice(payload.baseCost).toFixed(2) : null;
    if ("syncToWoo" in payload) mappingSet.sync_to_woo = payload.syncToWoo;
    if ("syncToClover" in payload) mappingSet.sync_to_clover = payload.syncToClover;

    const [mappingRow] = await tx
      .update(sku_mappings)
      .set(mappingSet)
      .where(
        and(
          eq(sku_mappings.global_sku, globalSku),
          eq(sku_mappings.version, expectedVersion)
        )
      )
      .returning({ globalSku: sku_mappings.global_sku, version: sku_mappings.version });
      
    if (!mappingRow) {
      throw new Error("This product was saved by someone else. Reload.");
    }

    // 2. Update finished_goods_catalog
    const catalogSet: any = { updated_at: new Date() };
    if ("length" in payload) catalogSet.length = payload.length;
    if ("depth" in payload) catalogSet.depth = payload.depth;
    if ("height" in payload) catalogSet.height = payload.height;
    if ("armHeight" in payload) catalogSet.arm_height = payload.armHeight;
    if ("sitHeight" in payload) catalogSet.sit_height = payload.sitHeight;
    if ("weight" in payload) catalogSet.weight = payload.weight;
    if ("imageUrl" in payload) catalogSet.image_url = payload.imageUrl;
    if ("seoTitle" in payload) catalogSet.seo_title = payload.seoTitle;
    if ("seoDescription" in payload) catalogSet.seo_description = payload.seoDescription;
    if ("slug" in payload) catalogSet.slug = payload.slug;
    if ("isWebVisible" in payload) catalogSet.is_web_visible = payload.isWebVisible;
    if ("cost" in payload) catalogSet.cost = payload.cost ? parsePrice(payload.cost).toFixed(2) : null;
    if ("naFields" in payload) catalogSet.na_fields = payload.naFields;
    if ("assemblyRequired" in payload) catalogSet.assembly_required = payload.assemblyRequired;
    if ("warrantyTermMonths" in payload) catalogSet.warranty_term_months = payload.warrantyTermMonths;
    if ("warrantyCovers" in payload) catalogSet.warranty_covers = payload.warrantyCovers;

    await tx
      .insert(finished_goods_catalog)
      .values({ global_sku: globalSku, ...catalogSet })
      .onConflictDoUpdate({
        target: finished_goods_catalog.global_sku,
        set: catalogSet,
      });

    // 3. Update third_party_sources if vendor fields are present
    if ("vendorName" in payload || "vendorSku" in payload || "wholesaleCost" in payload) {
      const tpSet: any = { updated_at: new Date() };
      if ("vendorName" in payload) tpSet.vendor_name = payload.vendorName;
      if ("vendorSku" in payload) tpSet.vendor_sku = payload.vendorSku;
      if ("wholesaleCost" in payload) tpSet.wholesale_cost = payload.wholesaleCost ? parsePrice(payload.wholesaleCost).toFixed(2) : null;
      
      await tx
        .insert(third_party_sources)
        .values({ global_sku: globalSku, ...tpSet })
        .onConflictDoUpdate({
          target: third_party_sources.global_sku,
          set: tpSet,
        });
    }
      
    if (wooJustEnabled) {
      await tx.insert(pim_audit_log).values({
        operator_email: session.email,
        action: "publish_live_confirmed",
        global_sku: globalSku,
        new_value: JSON.stringify({ score: 100 }),
      });
    }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const wooMask = message === "Woo requires a primary image and web visibility.";
    let auditPayload: string | null = null;
    if (wooMask) {
      auditPayload = JSON.stringify({ score: 100, failing: [], message });
    } else {
      try {
        const parsed = JSON.parse(message) as { error?: string; score?: number; failing?: string[] };
        if (parsed.error === "sync_blocked") {
          auditPayload = JSON.stringify({ score: parsed.score, failing: parsed.failing });
        }
      } catch {
        auditPayload = null;
      }
    }
    if (auditPayload) {
      await db.insert(pim_audit_log).values({
        operator_email: session.email,
        operator_name: session.name,
        global_sku: globalSku,
        action: "sync_blocked",
        new_value: auditPayload,
      });
    }
    throw err;
  }

  revalidatePath("/embed/admin/master-catalog");
  return { success: true };
}

// 13. Create a brand new product from the empty drawer
import { previewSku } from "@/server/master-catalog/sku-preview";
import { matchHubSku } from "@/lib/hub-sku-codes";

export async function previewSkuAction(name: string, collectionLabel: string, categoryCode: string, length: string, depth: string, existingSku?: string | null, origin: "manufactured" | "third_party" = "manufactured", token?: string, collectionCode?: string, categoryLabel?: string) {
  return previewSku(name, collectionLabel, categoryCode, length, depth, existingSku, origin, token, collectionCode, categoryLabel);
}

export async function createNewProduct(payload: {
  productName: string;
  /** Operator-selected label (primary label or alias) for collectionCode. */
  collectionLabel: string;
  categoryCode: string;
  /** Operator-selected label (primary label or alias) for categoryCode. */
  categoryLabel: string;
  length: string;
  depth: string;
  origin: "manufactured" | "third_party";
  token?: string;
  collectionCode?: string;
  thirdPartyFields?: {
    vendorName: string;
    vendorSku: string;
    wholesaleCost: string;
  }
}) {
  const db = getDb();
  
  // 1. Validate SKU
  const preview = await previewSku(
    payload.productName,
    payload.collectionLabel,
    payload.categoryCode,
    payload.length,
    payload.depth,
    null,
    payload.origin,
    payload.token,
    payload.collectionCode,
    payload.categoryLabel
  );
  
  if (preview.isCollision) {
    throw new Error(`SKU ${preview.sku} already exists as ${preview.existingProductName}`);
  }

  if (payload.origin === "third_party") {
    if (!payload.thirdPartyFields?.vendorName || !payload.thirdPartyFields?.vendorSku || !payload.thirdPartyFields?.wholesaleCost) {
      throw new Error("Missing required third party fields: vendor name, sku, or wholesale cost");
    }
    const cost = parseFloat(payload.thirdPartyFields.wholesaleCost);
    if (isNaN(cost) || cost < 0) {
      throw new Error("Invalid wholesale cost");
    }
  }

  const sku = preview.sku;

  const result = await db.transaction(async (tx) => {
    // 2. Insert sku_mappings
    await tx
      .insert(sku_mappings)
      .values({
        global_sku: sku,
        product_origin: payload.origin,
        category: preview.categoryLabel || "Uncategorized",
        item_type: "finished_good",
        original_name: payload.productName,
        source_file: "master-catalog-new-product",
        is_active: true,
      });

    // 2.5 Insert third_party_sources if needed
    if (payload.origin === "third_party" && payload.thirdPartyFields) {
      await tx.insert(third_party_sources).values({
        global_sku: sku,
        vendor_name: payload.thirdPartyFields.vendorName,
        vendor_sku: payload.thirdPartyFields.vendorSku,
        wholesale_cost: payload.thirdPartyFields.wholesaleCost,
      });
    }

    // 3. Insert finished_goods_catalog
    await tx
      .insert(finished_goods_catalog)
      .values({
        global_sku: sku,
        length: payload.length,
        depth: payload.depth,
      });

    const [{ top }] = await tx
      .select({ top: max(ecommerce_listings.sheet_order) })
      .from(ecommerce_listings);
    const base = top ?? 0;

    // 4. Insert ecommerce_listings
    const [row] = await tx
      .insert(ecommerce_listings)
      .values({
        global_sku: sku,
        product_name: payload.productName,
        steel_msrp: null,
        drawing_section: preview.categoryLabel || "Uncategorized",
        collection_label: preview.collectionLabel || "Uncategorized",
        sheet_order: base + 1,
        url_source: "missing",
        url_operator_set: false,
        legacy_operator_set: false,
      })
      .returning();
      
    return row;
  });

  revalidatePath("/embed/admin/master-catalog");
  return result;
}

export async function createDictionaryCode(
  type: "collection" | "category" | "token",
  code: string,
  label: string
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  
  if (!userId || !email) {
    throw new Error("Unauthorized: Session required.");
  }

  const db = getDb();
  const [row] = await db
    .select({ role: user_roles.role })
    .from(user_roles)
    .where(eq(user_roles.id, userId))
    .limit(1);

  if (!commercialOverrideAllowed({ email, role: row?.role ?? null })) {
    throw new Error("Unauthorized: Only Ops Manager or SuperAdmin can add dictionary codes.");
  }

  const safeCode = code.trim().toUpperCase();
  const safeLabel = label.trim();

  if (!safeCode || !safeLabel) {
    throw new Error("Code and label are required");
  }

  const exactReserved = ["FIN", "FAB", "MIS", "RM", "PWD", "3P", "ASM", "SA"];
  const prefixReserved = ["RM-", "PWD-", "FAB-", "ASM-", "SA-"];
  if (exactReserved.includes(safeCode) || prefixReserved.some(p => safeCode.startsWith(p))) {
    throw new Error(`Code ${safeCode} is a reserved system code.`);
  }

  if (type === "collection") {
    if (!/^[A-Z0-9]{2,4}$/.test(safeCode)) {
      throw new Error("Collection code must be 2 to 4 characters (A-Z, 0-9 only, no hyphens).");
    }
    await db.insert(nomenclature_collections).values({
      code: safeCode,
      label: safeLabel,
      created_by: email,
    });
  } else if (type === "category") {
    if (safeCode.length > 24 || !/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(safeCode)) {
      throw new Error("Category code format invalid: use A-Z/0-9 segments separated by hyphens, max 24 characters.");
    }
    await db.insert(nomenclature_categories).values({
      code: safeCode,
      label: safeLabel,
      created_by: email,
    });
  } else if (type === "token") {
    if (safeCode.length > 24 || !/^[A-Z0-9-]+$/.test(safeCode)) {
      throw new Error("Token format invalid: use A-Z, 0-9, and hyphens, max 24 characters.");
    }
    await db.insert(nomenclature_sku_tokens).values({
      code: safeCode,
      label: safeLabel,
      created_by: email,
    }).onConflictDoUpdate({
      target: nomenclature_sku_tokens.code,
      set: { label: safeLabel }
    });
  }
}

export async function canEditDictionary(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  if (!userId || !email) return false;
  
  const db = getDb();
  const [row] = await db
    .select({ role: user_roles.role })
    .from(user_roles)
    .where(eq(user_roles.id, userId))
    .limit(1);

  return commercialOverrideAllowed({ email, role: row?.role ?? null });
}

// 14. Asset Vault actions (zero-trust: server picks bucket + object key; confirm re-verifies bytes)

async function requireOperator() {
  const session = await getPimSession();
  if (!session) throw new Error("Unauthorized: operator session required.");
  return session;
}

export interface SignedAssetUpload {
  path: string;
  token: string;
  signedUrl: string;
  bucket: string;
  kind: ProductAssetKind;
  revision: number;
  filename: string;
}

/**
 * Validates bucket (product-images | product-documents), sanitizes the filename,
 * verifies the extension, and signs an upload to a SERVER-generated key
 * `{sku}/{kind}/{revision}-{random}.{ext}`. The browser never chooses the key.
 */
export async function requestAssetUpload(input: {
  globalSku: string;
  kind: string;
  filename: string;
  /** Optional. If sent, must be allowlisted AND be the bucket this kind lives in. */
  bucket?: string;
  byteSize?: number;
}): Promise<SignedAssetUpload> {
  await requireOperator();
  const plan = await planAssetUpload(input);
  const signed = await createAssetSignedUpload({ bucket: plan.bucket, path: plan.path });
  return {
    path: signed.path,
    token: signed.token,
    signedUrl: signed.signedUrl,
    bucket: plan.bucket,
    kind: plan.kind,
    revision: plan.revision,
    filename: plan.cleanFilename,
  };
}

/**
 * Runs after the browser PUT. Sniffs magic bytes, hashes (sha256), inserts the
 * next revision as current and supersedes the previous current row for
 * (global_sku, kind). Gallery rows skip the revision/supersede logic.
 */
export async function confirmAsset(input: {
  globalSku: string;
  kind: string;
  storagePath: string;
  originalFilename: string;
  altText?: string | null;
}): Promise<ConfirmedAsset> {
  const session = await requireOperator();
  const confirmed = await confirmAssetCore(input, getVaultStorage());

  const sha = `sha256:${confirmed.sha256.slice(0, 12)}`;
  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: confirmed.globalSku,
    action: "asset_confirm",
    field: confirmed.kind,
    newValue: `rev ${confirmed.revision} ${sha} ${confirmed.storagePath}`,
  });
  if (confirmed.supersededId) {
    await logPimAudit({
      operatorEmail: session.email,
      operatorName: session.name,
      globalSku: confirmed.globalSku,
      action: "asset_supersede",
      field: confirmed.kind,
      oldValue: `rev ${confirmed.supersededRevision}`,
      newValue: `rev ${confirmed.revision}`,
    });
  }

  revalidatePath("/embed/admin/master-catalog");
  return confirmed;
}

export interface VaultAssetWithUrl extends VaultAssetView {
  url: string | null;
}

/**
 * Revision history + links for the Asset Vault tab. EVERY revision gets a link, so a
 * superseded warranty/tear sheet can still be opened: images use the public CDN URL,
 * documents get a 5-minute signed URL (the bucket is private).
 */
export async function getProductAssets(globalSku: string): Promise<VaultAssetWithUrl[]> {
  await requireOperator();
  const assets = await listVaultAssets(globalSku);
  const storage = getVaultStorage();
  return Promise.all(
    assets.map(async (a) => {
      try {
        const bucket = KIND_POLICY[a.kind].bucket;
        const url =
          bucket === "product-images"
            ? storage.publicUrl(bucket, a.storagePath)
            : await createAssetSignedDownload(bucket, a.storagePath);
        return { ...a, url };
      } catch {
        return { ...a, url: null };
      }
    }),
  );
}

const assetIdSchema = z.string().uuid("Invalid asset id");

/** Deletes one GALLERY image (row + stored object). Revisioned kinds can't be deleted. */
export async function deleteGalleryAsset(input: { globalSku: string; assetId: string }): Promise<{ id: string }> {
  const session = await requireOperator();
  const assetId = assetIdSchema.parse(input.assetId);
  const deleted = await deleteGalleryAssetCore({ globalSku: input.globalSku, assetId }, getVaultStorage());
  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: input.globalSku,
    action: "asset_delete",
    field: "gallery",
    oldValue: deleted.storagePath,
  });
  revalidatePath("/embed/admin/master-catalog");
  return { id: deleted.id };
}

/** Alt text for a gallery or primary image. Empty string clears it. */
export async function updateAssetAltText(input: {
  globalSku: string;
  assetId: string;
  altText: string;
}): Promise<{ altText: string | null }> {
  const session = await requireOperator();
  const assetId = assetIdSchema.parse(input.assetId);
  const altText = await updateAssetAltTextCore({ globalSku: input.globalSku, assetId, altText: input.altText });
  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: input.globalSku,
    action: "asset_alt_text",
    field: assetId,
    newValue: altText,
  });
  return { altText };
}

/* ───────────────────────── Story + SEO (listing-scoped) ───────────────────────── */

export interface ListingEditorData {
  id: string;
  globalSku: string;
  version: number;
  productName: string;
  collectionLabel: string;
  marketingDescription: string | null;
  constructionDetails: string | null;
  /** Values explicitly saved on THIS listing (null = never saved; hub default may apply). */
  seoTitle: string | null;
  seoDescription: string | null;
  slug: string | null;
  /** Hub (finished_goods_catalog) defaults: display fallbacks only, never written by the SEO tab. */
  hubSeoTitle: string | null;
  hubSeoDescription: string | null;
  hubSlug: string | null;
  tags: string[];
  seoAssistantConfigured: boolean;
  /** False only for the embed principal with no human session (the AI action needs a person). */
  aiOperatorEligible: boolean;
}

export async function getListingEditorData(listingId: string): Promise<ListingEditorData> {
  const session = await requireOperator();
  const db = getDb();
  const [r] = await db
    .select({
      id: ecommerce_listings.id,
      globalSku: ecommerce_listings.global_sku,
      version: ecommerce_listings.version,
      productName: ecommerce_listings.product_name,
      collectionLabel: ecommerce_listings.collection_label,
      marketingDescription: ecommerce_listings.marketing_description,
      constructionDetails: ecommerce_listings.construction_details,
      seoTitle: ecommerce_listings.seo_title,
      seoDescription: ecommerce_listings.seo_description,
      slug: ecommerce_listings.slug,
      tags: ecommerce_listings.tags,
      hubSeoTitle: finished_goods_catalog.seo_title,
      hubSeoDescription: finished_goods_catalog.seo_description,
      hubSlug: finished_goods_catalog.slug,
    })
    .from(ecommerce_listings)
    .leftJoin(finished_goods_catalog, eq(finished_goods_catalog.global_sku, ecommerce_listings.global_sku))
    .where(eq(ecommerce_listings.id, listingId))
    .limit(1);
  if (!r) throw new Error("Listing not found");
  return {
    id: r.id,
    globalSku: r.globalSku,
    version: r.version,
    productName: r.productName,
    collectionLabel: r.collectionLabel,
    marketingDescription: r.marketingDescription,
    constructionDetails: r.constructionDetails,
    // Saved listing values and hub defaults are returned SEPARATELY so the UI can show
    // which is which. Hub columns are display fallbacks; nothing is written until the operator saves.
    seoTitle: r.seoTitle?.trim() ? r.seoTitle : null,
    seoDescription: r.seoDescription?.trim() ? r.seoDescription : null,
    slug: r.slug?.trim() ? r.slug : null,
    hubSeoTitle: r.hubSeoTitle?.trim() ? r.hubSeoTitle : null,
    hubSeoDescription: r.hubSeoDescription?.trim() ? r.hubSeoDescription : null,
    hubSlug: r.hubSlug?.trim() ? r.hubSlug : null,
    tags: r.tags ?? [],
    seoAssistantConfigured: seoAssistantConfigured(),
    aiOperatorEligible: aiOperatorEligible(session),
  };
}

/** Server-side sanitize (p, br, strong, em, ul, ol, li, a[http/https]) then save with an optimistic lock. */
export async function saveListingStory(
  listingId: string,
  expectedVersion: number,
  payload: { marketingDescription: string | null; constructionDetails: string | null },
): Promise<{ version: number; marketingDescription: string | null; constructionDetails: string | null }> {
  const session = await requireOperator();
  const marketing = normalizeStoryInput(payload.marketingDescription);
  const construction = normalizeStoryInput(payload.constructionDetails);

  const db = getDb();
  const [row] = await db
    .update(ecommerce_listings)
    .set({
      marketing_description: marketing,
      construction_details: construction,
      updated_at: new Date(),
      version: sql`version + 1`,
    })
    .where(and(eq(ecommerce_listings.id, listingId), eq(ecommerce_listings.version, expectedVersion)))
    .returning({ version: ecommerce_listings.version, globalSku: ecommerce_listings.global_sku });
  if (!row) throw new Error("This product was saved by someone else. Reload.");

  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: row.globalSku,
    action: "story_save",
    field: "marketing_description,construction_details",
    newValue: `${(marketing ?? "").length} / ${(construction ?? "").length} chars (sanitized)`,
  });
  revalidatePath("/embed/admin/master-catalog");
  return { version: row.version, marketingDescription: marketing, constructionDetails: construction };
}

const seoSaveSchema = z.object({
  seoTitle: z.string().trim().max(SEO_LIMITS.title, `Shorten to ${SEO_LIMITS.title} characters.`),
  seoDescription: z.string().trim().max(SEO_LIMITS.description, `Shorten to ${SEO_LIMITS.description} characters.`),
  slug: z
    .string()
    .trim()
    .max(SEO_LIMITS.slug, `Shorten to ${SEO_LIMITS.slug} characters.`)
    .refine((s) => s === "" || SLUG_RE.test(s), "Slug may only contain lowercase letters, numbers and single hyphens."),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
});

async function findSlugConflict(listingId: string, slug: string): Promise<string | null> {
  if (!slug) return null;
  const db = getDb();
  const [hit] = await db
    .select({ name: ecommerce_listings.product_name })
    .from(ecommerce_listings)
    .where(
      and(
        eq(ecommerce_listings.slug, slug),
        sql`${ecommerce_listings.archived_at} is null`,
        sql`${ecommerce_listings.id} <> ${listingId}`,
      ),
    )
    .limit(1);
  return hit?.name ?? null;
}

export async function saveListingSeo(
  listingId: string,
  expectedVersion: number,
  payload: { seoTitle: string; seoDescription: string; slug: string; tags: string[] },
): Promise<{ version: number; tags: string[] }> {
  const session = await requireOperator();
  const parsed = seoSaveSchema.safeParse({
    seoTitle: payload.seoTitle ?? "",
    seoDescription: payload.seoDescription ?? "",
    slug: payload.slug ?? "",
    tags: normalizeTags(payload.tags ?? []),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid SEO fields");
  const v = parsed.data;

  const conflict = await findSlugConflict(listingId, v.slug);
  if (conflict) throw new Error(`Slug "${v.slug}" is already used by "${conflict}".`);

  const db = getDb();
  let row: { version: number; globalSku: string } | undefined;
  try {
    [row] = await db
      .update(ecommerce_listings)
      .set({
        seo_title: v.seoTitle || null,
        seo_description: v.seoDescription || null,
        slug: v.slug || null,
        tags: v.tags,
        updated_at: new Date(),
        version: sql`version + 1`,
      })
      .where(and(eq(ecommerce_listings.id, listingId), eq(ecommerce_listings.version, expectedVersion)))
      .returning({ version: ecommerce_listings.version, globalSku: ecommerce_listings.global_sku });
  } catch (err) {
    // ecommerce_listings_slug_active_uidx: a concurrent save won the race for this slug.
    if (isUniqueViolation(err, "ecommerce_listings_slug_active_uidx")) {
      const owner = (await findSlugConflict(listingId, v.slug)) ?? "another listing";
      throw new Error(`Slug "${v.slug}" is already used by "${owner}".`);
    }
    throw err;
  }
  if (!row) throw new Error("This product was saved by someone else. Reload.");

  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: row.globalSku,
    action: "seo_save",
    field: "seo_title,seo_description,slug,tags",
    newValue: v.slug || null,
  });
  revalidatePath("/embed/admin/master-catalog");
  return { version: row.version, tags: v.tags };
}

export interface AiSeoSuggestion {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  /** Name of another non-archived listing already using the suggested slug, if any. */
  slugConflict: string | null;
}

/**
 * Human-in-the-loop AI SEO. Reads ONLY committed data (saved marketing copy,
 * collection/category label, dimensions, origin) and returns a suggestion.
 * It NEVER writes the listing: the operator reviews, edits and saves.
 */
export async function generateAiSeoAction(listingId: string): Promise<AiSeoSuggestion> {
  const session = await requireOperator();
  if (!aiOperatorEligible(session)) {
    throw new Error("The SEO assistant requires a signed-in @ccpatio.com operator.");
  }
  if (!seoAssistantConfigured()) throw new Error(SEO_NOT_CONFIGURED);

  const db = getDb();
  const [r] = await db
    .select({
      globalSku: ecommerce_listings.global_sku,
      productName: ecommerce_listings.product_name,
      collectionLabel: ecommerce_listings.collection_label,
      categoryLabel: ecommerce_listings.drawing_section,
      marketing: ecommerce_listings.marketing_description,
      origin: sku_mappings.product_origin,
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      naFields: finished_goods_catalog.na_fields,
    })
    .from(ecommerce_listings)
    .innerJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
    .leftJoin(finished_goods_catalog, eq(finished_goods_catalog.global_sku, ecommerce_listings.global_sku))
    .where(eq(ecommerce_listings.id, listingId))
    .limit(1);
  if (!r) throw new Error("Listing not found");

  const marketingCopy = storyHtmlToPlainText(r.marketing);
  if (!marketingCopy) throw new Error("Save a marketing description before optimizing SEO.");

  // Dimensions flagged N/A (finished_goods_catalog.na_fields) never reach the model.
  const dims = dimensionsForPrompt({
    length: r.length,
    depth: r.depth,
    height: r.height,
    naFields: r.naFields,
  });
  const suggestion = await requestSeoSuggestion({
    productName: r.productName,
    collectionLabel: r.collectionLabel,
    categoryLabel: r.categoryLabel,
    origin: r.origin === "third_party" ? "third_party" : "manufactured",
    ...dims,
    marketingCopy,
  });

  await logPimAudit({
    operatorEmail: session.email,
    operatorName: session.name,
    globalSku: r.globalSku,
    action: "seo_suggest",
    field: listingId,
  });

  // Deliberately no db write here.
  return {
    seoTitle: suggestion.seoTitle,
    metaDescription: suggestion.metaDescription,
    slug: suggestion.slug,
    slugConflict: await findSlugConflict(listingId, suggestion.slug),
  };
}

export async function getDictionaries() {
  const db = getDb();
  const collections = await db.select().from(nomenclature_collections).where(eq(nomenclature_collections.is_active, true));
  const categories = await db.select().from(nomenclature_categories).where(eq(nomenclature_categories.is_active, true));
  const dictionaryTokens = await db.select().from(nomenclature_sku_tokens).where(eq(nomenclature_sku_tokens.is_active, true));

  const live3pMappings = await db.select({ sku: sku_mappings.global_sku }).from(sku_mappings).where(and(eq(sku_mappings.product_origin, "third_party"), sql`global_sku LIKE '3P-%'`));
  const liveTokens = new Set<string>();
  const collectionCodes = collections.map((c) => c.code);
  const categoryCodes = categories.map((c) => c.code);

  for (const m of live3pMappings) {
    const token = matchHubSku(m.sku, collectionCodes, categoryCodes).token;
    if (token) liveTokens.add(token);
  }

  const mergedTokens = new Map<string, typeof dictionaryTokens[0]>();
  for (const t of dictionaryTokens) {
    mergedTokens.set(t.code, t);
  }
  for (const t of liveTokens) {
    if (!mergedTokens.has(t)) {
      mergedTokens.set(t, { id: '', code: t, label: t, is_active: true, created_by: null, created_at: new Date() });
    }
  }

  return { collections, categories, tokens: Array.from(mergedTokens.values()) };
}

export type ShipProfileData = {
  shipMode: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  weightLb: string;
  ltlClass: string;
  stackable: boolean;
};

export async function getFreightProfile(globalSku: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(catalog_ship_profiles)
    .where(eq(catalog_ship_profiles.global_sku, globalSku));
  
  if (!row) return null;
  return {
    shipMode: row.ship_mode || "",
    lengthIn: row.length_in || "",
    widthIn: row.width_in || "",
    heightIn: row.height_in || "",
    weightLb: row.weight_lb || "",
    ltlClass: row.ltl_class || "",
    stackable: row.stackable,
  };
}

export async function saveFreightProfile(globalSku: string, data: ShipProfileData) {
  const session = await getPimSession();
  if (!session || isEmbedPrincipal(session) || !session.email?.endsWith("@ccpatio.com")) {
    throw new Error("Unauthorized");
  }

  const validClasses = ["50", "55", "60", "65", "70", "77.5", "85", "92.5", "100", "110", "125", "150", "175", "200", "250", "300", "400", "500"];
  if (data.ltlClass && !validClasses.includes(data.ltlClass)) {
    throw new Error("Validation Error: Invalid NMFC LTL class.");
  }

  const db = getDb();
  const [hub] = await db
    .select({
      length: finished_goods_catalog.length,
      depth: finished_goods_catalog.depth,
      height: finished_goods_catalog.height,
      weight: finished_goods_catalog.weight,
    })
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, globalSku))
    .limit(1);

  const dfm = deriveDfmFreight({
    hubLength: hub?.length,
    hubDepth: hub?.depth,
    hubHeight: hub?.height,
    hubWeight: hub?.weight,
    packagedLength: data.lengthIn,
    packagedWidth: data.widthIn,
    packagedHeight: data.heightIn,
    packagedWeight: data.weightLb,
    shipMode: data.shipMode,
  });

  const ltlClass = data.ltlClass || null;

  const payload = {
    global_sku: globalSku,
    ship_mode: (dfm.shipMode || null) as any,
    length_in: dfm.lengthIn,
    width_in: dfm.widthIn,
    height_in: dfm.heightIn,
    weight_lb: dfm.weightLb,
    ltl_class: ltlClass,
    stackable: data.stackable ?? false,
    dim_weight_lb: dfm.dimWeightLb,
    billable_weight_lb: dfm.billableWeightLb,
  };

  await db.insert(catalog_ship_profiles).values(payload).onConflictDoUpdate({
    target: catalog_ship_profiles.global_sku,
    set: { ...payload, updated_at: new Date() },
  });
}

import { generateTearSheetPdf } from "@/server/pim/tear-sheet";

export async function generateTearSheetAction(globalSku: string, listingId?: string) {
  return generateTearSheetPdf(globalSku, listingId);
}
export async function getListingScoreAction(globalSku: string, listingId: string, factoryState: string, payload?: any) {
  const db = getDb();
  const snap = await db.transaction(async (tx) => {
    return await buildCompletenessSnapshot(tx, globalSku, listingId, factoryState, payload || {});
  });
  return scoreProduct(snap);
}

import { downloadCadObject } from "@/lib/supabase-storage";
import { parseDaeWeldmentFromXml } from "@/lib/sketchup-cutlist/parse-dae-weldment";

export async function extractCadDimensions(globalSku: string) {
  const session = await getPimSession();
  if (!session || !aiOperatorEligible(session)) throw new Error("Unauthorized");
  
  const db = getDb();
  const uploads = await db.select().from(cad_uploads)
    .where(and(eq(cad_uploads.global_sku, globalSku), eq(cad_uploads.ext, 'dae'), eq(cad_uploads.status, 'draft_ready')))
    .orderBy(desc(cad_uploads.created_at))
    .limit(1);
    
  const upload = uploads[0];
  if (!upload) throw new Error("No processed .dae upload found for this product.");
  
  const buffer = await downloadCadObject(upload.storage_path);
  const parsed = parseDaeWeldmentFromXml(buffer, upload.storage_path);
  
  const aabb = parsed.walker.overall;
  if (!aabb || aabb.lengthIn === null || aabb.depthIn === null || aabb.heightIn === null) {
    throw new Error("Could not compute bounding box.");
  }
  
  await db.update(finished_goods_catalog)
    .set({
       length: String(aabb.lengthIn),
       depth: String(aabb.depthIn),
       height: String(aabb.heightIn),
       updated_at: new Date()
    })
    .where(eq(finished_goods_catalog.global_sku, globalSku));
    
  return { length: String(aabb.lengthIn), depth: String(aabb.depthIn), height: String(aabb.heightIn) };
}
