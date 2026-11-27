"use server";

import { getDb } from "@/server/db/client";
import { createClient } from "@/utils/supabase/server";
import { commercialOverrideAllowed } from "@/server/quotes/override-role";
import {
  finished_goods_catalog,
  sku_mappings,
  quarantine_catalog,
  ecommerce_listings,
  ecommerce_finish_assets,
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
  product_relations,
  logistics_profiles,
  katana_sync_meta,
} from "@/server/db/schema";
import { eq, desc, asc, count, and, inArray, sql, max, or, not, like, isNull } from "drizzle-orm";
import {
  buildFactoryEvidence,
  deriveFactoryReadiness,
  relatedParents,
  type FactoryReadiness,
} from "@/server/factory-bom/derive-readiness";
import { mintHubSkuInTx } from "@/server/master-catalog/mint-hub-sku";
import { createNewProductCore } from "@/server/master-catalog/create-product-core";
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
import {
  deriveWooSyncStatus,
  fetchWooStoreUnits,
  mapWithConcurrency,
  pushParentToWoo,
  resetWooStoreUnitsMemo,
  resolveWooConnection,
  testWooConnection,
  type WooSyncStatus,
  type HubParentInput,
} from "@/server/woocommerce/woo-catalog-sync";
import {
  isFinishOrAddonSku,
  isPhase1StorefrontRow,
  readMiaApproval,
  writeMiaApproval,
  type Phase1PortalView,
} from "@/server/ecommerce/phase1-portal";
import {
  classifyFramePolicy,
  DEFAULT_ALU_UPCHARGE_PCT,
  hasHalfCent,
  isMiaPriceLocked,
  roundAluToWholeDollar,
  wooEcommercePrice,
  buildAluAttributePatch,
} from "@/server/ecommerce/alu10-pricing";
import {
  buildMiaAluminumPriceListCsv,
  spotCheckDrawerNote,
} from "@/server/ecommerce/two-tab-portal";
import {
  addEcommerceFinishAsset,
  disableEcommerceFinishAsset,
  enableEcommerceFinishAsset,
  filterActiveEcommerceFinishes,
  listFinishAssets,
  isStaleFinishDisplayName,
  resolveListing3dTarget,
  seedEcommerceFinishAssets,
  updateFinishAsset,
} from "@/server/assets/finish-assets";
import {
  canAccessEcommercePortal,
  canAccessFullMasterCatalog,
  ecommerceFinishBySku,
  ECOMMERCE_FINISH_DISABLED_SENTINEL,
  isEcommerce32FinishSku,
  isFinishSkuLocked,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import type { ExecutiveStackHealth } from "@/server/ecommerce/executive-stack-health";
import {
  buildWooDiagnosticReport,
  lampFromState,
  type StackLayerPill,
} from "@/server/ecommerce/executive-stack-health";
import { pingGhl, readDlqSnapshot } from "@/server/mission-control/health-probes";
import { isFedExFreightConfigured } from "@/lib/freight/fedex-freight";
import {
  filterExistingFacingChildren,
  pickGroupedSkuRow,
  resolveGroupedSkuCandidates,
} from "@/server/ecommerce/grouped-sku-resolve";
import {
  inferSurfaceProfile,
  stagingPushGuardrailMessage,
  storefrontDisplayTitle,
  type SurfaceProfile,
} from "@/server/ecommerce/portal-readiness";
import {
  formatCanonicalStorefrontPrice,
  loadMiaAluminumFixture,
  parseStorefrontMoney,
  readStorefrontAluminumOverride,
  resolveCanonicalStorefrontPrice,
} from "@/server/ecommerce/canonical-storefront-price";

/**
 * Woo Regular price via single-price Aluminum truth.
 * Never falls back to steel MSRP or +10% steel upcharges.
 */
function wooRegularFromListing(
  s: EcommerceListing,
  attributes?: Record<string, unknown> | null,
): number | null {
  const resolved = resolveCanonicalStorefrontPrice({
    sku: s.globalSku,
    wooSku: s.wooSku,
    sowName: s.productName,
    storefrontAluminumOverride: readStorefrontAluminumOverride(attributes),
    aluminumMsrp: s.aluminumMsrpValue,
    fixture: loadMiaAluminumFixture(),
  });
  return resolved.price;
}

export type { WooSyncStatus, Phase1PortalView };

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
  /** Storefront Woo SKU (1:1); falls back to globalSku when unset. */
  wooSku: string;
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
  /** Numeric Woo Aluminum / Regular price; null when unset. */
  aluminumMsrpValue: number | null;
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
  katanaVariantId: number | null;
  wooProductId: string | null;
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
  /** Native 3D slots (phase 3d-glb-and-hires-swatch-studio). Never sent in Woo images[]. */
  model3dGlbUrl?: string | null;
  model3dUsdzUrl?: string | null;
  model3dPosterUrl?: string | null;
  model3dFileSize?: number | null;
  model3dUploadedBy?: string | null;
  model3dUpdatedAt?: string | null;
  model3dMaterialSlots?: unknown[];
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
  wooSku?: string | null;
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
  katanaVariantId: number | null;
  wooProductId: string | null;
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
  model3dGlbUrl?: string | null;
  model3dUsdzUrl?: string | null;
  model3dPosterUrl?: string | null;
  model3dFileSize?: number | null;
  model3dUploadedBy?: string | null;
  model3dUpdatedAt?: Date | null;
  model3dMaterialSlots?: unknown[] | null;
}

/** A null steel MSRP displays as an em dash and sorts last (never "$0.00"). */
function toListing(r: ListingFields, factory: FactoryReadiness): EcommerceListing {
  return {
    id: r.id,
    globalSku: r.globalSku,
    wooSku: (r.wooSku || r.globalSku || "").trim().toUpperCase() || r.globalSku,
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
    aluminumMsrpValue: r.aluminumMsrp === null ? null : parsePrice(r.aluminumMsrp) || 0,
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
    katanaVariantId: r.katanaVariantId,
    wooProductId: r.wooProductId,
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
    model3dGlbUrl: r.model3dGlbUrl ?? null,
    model3dUsdzUrl: r.model3dUsdzUrl ?? null,
    model3dPosterUrl: r.model3dPosterUrl ?? null,
    model3dFileSize: r.model3dFileSize ?? null,
    model3dUploadedBy: r.model3dUploadedBy ?? null,
    model3dUpdatedAt: r.model3dUpdatedAt ? r.model3dUpdatedAt.toISOString() : null,
    model3dMaterialSlots: Array.isArray(r.model3dMaterialSlots) ? r.model3dMaterialSlots : [],
  };
}

/**
 * Hub fields for a finished good that has no ecommerce listing.
 * `id` is empty so hub save does not look up a listing row.
 */
export async function getHubProductForDrawer(globalSku: string): Promise<EcommerceListing | null> {
  const db = getDb();
  const grouped = resolveGroupedSkuCandidates(globalSku);
  const candidates = [
    ...new Set([grouped.requestedSku, grouped.parentSku, ...grouped.childSkus].filter(Boolean)),
  ];
  const hits = await db
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
      katanaVariantId: sku_mappings.katana_variant_id,
      wooProductId: sku_mappings.woo_product_id,
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
    .where(inArray(sku_mappings.global_sku, candidates))
    .limit(8);
  const picked = pickGroupedSkuRow(hits, globalSku);
  const row = picked.row;
  if (!row) return null;

  const readiness = await getFactoryReadinessMap([row.globalSku]);
  return {
    id: "",
    globalSku: row.globalSku,
    wooSku: row.globalSku,
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
    aluminumMsrpValue: null,
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
    katanaVariantId: row.katanaVariantId,
    wooProductId: row.wooProductId,
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
        wooSku: ecommerce_listings.woo_sku,
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
        katanaVariantId: sku_mappings.katana_variant_id,
        wooProductId: sku_mappings.woo_product_id,
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
        model3dGlbUrl: ecommerce_listings.model_3d_glb_url,
        model3dUsdzUrl: ecommerce_listings.model_3d_usdz_url,
        model3dPosterUrl: ecommerce_listings.model_3d_poster_url,
        model3dFileSize: ecommerce_listings.model_3d_file_size,
        model3dUploadedBy: ecommerce_listings.model_3d_uploaded_by,
        model3dUpdatedAt: ecommerce_listings.model_3d_updated_at,
        model3dMaterialSlots: ecommerce_listings.model_3d_material_slots,
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

// 7. Legacy portal MSRP edit — ALWAYS writes aluminum_msrp (storefront Regular)
// keyed by listing id / woo_sku. Never mutates sibling SKUs that share a
// canonical Resale bucket. steel_msrp is left untouched.
export async function updateListingMsrp(id: string, newPriceRaw: string) {
  const result = await updateListingAluminumMsrp(id, newPriceRaw);
  if (!result.ok) throw new Error(result.error);
  const db = getDb();
  const [row] = await db
    .select({
      version: ecommerce_listings.version,
      wooSku: ecommerce_listings.woo_sku,
      globalSku: ecommerce_listings.global_sku,
    })
    .from(ecommerce_listings)
    .where(eq(ecommerce_listings.id, id))
    .limit(1);
  revalidatePath("/embed/admin/master-catalog");
  return {
    success: true,
    mirroredSku: row?.wooSku || row?.globalSku || null,
    version: row?.version ?? 0,
  };
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
          katanaVariantId: null,
          wooProductId: null,
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
    productName: string;
    drawingSection: string;
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
        product_name: payload.productName,
        drawing_section: payload.drawingSection,
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
    /** Accepted from existing callers. This phase does not write channel sync flags. */
    syncToWoo?: boolean;
    syncToClover?: boolean;
    publishConfirmed?: boolean;
    naFields?: string[];
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
    const hubOnly = listingId.length === 0;
    const [listing] = hubOnly
      ? [undefined]
      : await tx
          .select()
          .from(ecommerce_listings)
          .where(eq(ecommerce_listings.id, listingId));

    if (!hubOnly && !listing) throw new Error("Listing not found");

    // 2. Bump version on sku_mappings
    const mappingSet: any = { version: sql`version + 1`, updated_at: new Date() };
    if ("baseCost" in payload) mappingSet.base_cost = payload.baseCost ? parsePrice(payload.baseCost).toFixed(2) : null;

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
    });
  } catch (err: unknown) {
    throw err;
  }

  revalidatePath("/embed/admin/master-catalog");
  return { success: true };
}

// 13. Create a brand new product from the empty drawer
import { previewSku } from "@/server/master-catalog/sku-preview";

export async function createSuccessorProduct(
  oldGlobalSku: string,
  listingId: string,
  payload: {
    productName: string;
    collectionLabel: string;
    categoryCode: string;
    categoryLabel: string;
    length: string;
    depth: string;
    origin: "manufactured" | "third_party";
    token?: string;
    collectionCode?: string;
  }
) {
  const db = getDb();
  const session = await getPimSession();
  
  if (!session || isEmbedPrincipal(session) || !session.email?.endsWith("@ccpatio.com")) {
    throw new Error("Unauthorized");
  }

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
    throw new Error(`Successor SKU ${preview.sku} already exists as ${preview.existingProductName}`);
  }

  const newSku = preview.sku;

  await db.transaction(async (tx) => {
    const [oldListing] = await tx
      .select()
      .from(ecommerce_listings)
      .where(eq(ecommerce_listings.id, listingId));

    if (!oldListing) throw new Error("Original listing not found");

    await tx.insert(sku_mappings).values({
      global_sku: newSku,
      product_origin: payload.origin,
      category: preview.categoryLabel || "Uncategorized",
      item_type: "finished_good",
      original_name: payload.productName,
      source_file: "master-catalog-successor",
      is_active: true,
    });

    await tx.insert(finished_goods_catalog).values({
      global_sku: newSku,
      length: payload.length,
      depth: payload.depth,
    });

    const { id, created_at, updated_at, ...listingWithoutId } = oldListing as any;
    await tx.insert(ecommerce_listings).values({
      ...listingWithoutId,
      global_sku: newSku,
      version: 1,
    });

    await tx.insert(product_relations).values({
      from_sku: oldGlobalSku,
      to_sku: newSku,
      role: 'successor',
    });
  });

  revalidatePath("/embed/admin/master-catalog");
  return { success: true, newSku };
}
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
    return createNewProductCore(
      tx,
      {
        sku,
        productName: payload.productName,
        origin: payload.origin,
        categoryLabel: preview.categoryLabel,
        collectionLabel: preview.collectionLabel,
        length: payload.length,
        depth: payload.depth,
        thirdPartyFields: payload.thirdPartyFields,
      }
    );
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

export async function getCadExtractAvailability(globalSku: string): Promise<{ ready: boolean }> {
  const session = await getPimSession();
  if (!session || !aiOperatorEligible(session)) return { ready: false };

  const db = getDb();
  const [upload] = await db
    .select({ id: cad_uploads.id })
    .from(cad_uploads)
    .where(
      and(
        eq(cad_uploads.global_sku, globalSku),
        eq(cad_uploads.ext, "dae"),
        eq(cad_uploads.status, "draft_ready"),
      ),
    )
    .limit(1);

  return { ready: Boolean(upload) };
}

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

export async function getLogisticsProfile(katanaVariantId: number) {
  const db = getDb();
  const [row] = await db
    .select({ weightLb: logistics_profiles.weight_lb, ltlClass: logistics_profiles.ltl_class })
    .from(logistics_profiles)
    .where(eq(logistics_profiles.katana_variant_id, katanaVariantId))
    .limit(1);
  return row || null;
}

export async function updateLogisticsProfile(globalSku: string, weightLb: string, ltlClass: string) {
  const session = await getPimSession();
  if (!session || isEmbedPrincipal(session) || !session.email?.endsWith("@ccpatio.com")) {
    throw new Error("Unauthorized");
  }

  const db = getDb();
  const [mapping] = await db.select({ katanaVariantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, globalSku))
    .limit(1);

  if (!mapping || typeof mapping.katanaVariantId !== "number") {
    throw new Error("Cannot update logistics profile: no established Katana variant ID exists.");
  }

  const [updated] = await db.update(logistics_profiles)
    .set({ weight_lb: weightLb, ltl_class: ltlClass, updated_at: new Date() })
    .where(eq(logistics_profiles.katana_variant_id, mapping.katanaVariantId))
    .returning({ id: logistics_profiles.katana_variant_id });

  if (!updated) {
    throw new Error("Cannot update logistics profile: no row exists in logistics_profiles yet.");
  }

  return true;
}

/* ───────────────────── GHL E-Commerce Woo sync portal ───────────────────── */

export async function getWooConnectionBadge(): Promise<{
  configured: boolean;
  label: string;
  host: string | null;
}> {
  const conn = resolveWooConnection();
  if (!conn.configured) {
    return { configured: false, label: conn.reason, host: null };
  }
  return { configured: true, label: `Connected to ${conn.host}`, host: conn.host };
}

export async function testWooConnectionAction(): Promise<
  | { ok: true; host: string }
  | {
      ok: false;
      reason: string;
      critical?: boolean;
      snippet?: string;
      httpStatus?: number;
      diagnosticReport?: string;
    }
> {
  return testWooConnection();
}

export async function getPhase1PortalRows(view: Phase1PortalView = "phase1_parents") {
  const roster = await getEcommerceRoster();
  const db = getDb();
  const attrRows = await db
    .select({
      sku: sku_mappings.global_sku,
      attributes: sku_mappings.attributes,
      updatedAt: sku_mappings.updated_at,
      wooProductId: sku_mappings.woo_product_id,
    })
    .from(sku_mappings);

  const syncRows = await db
    .select({
      sku: channel_sync.global_sku,
      status: channel_sync.status,
      lastError: channel_sync.last_error,
      updatedAt: channel_sync.updated_at,
    })
    .from(channel_sync)
    .where(eq(channel_sync.channel, "woocommerce"));

  const attrsBySku = new Map(attrRows.map((r) => [r.sku, r]));
  const syncBySku = new Map(syncRows.map((r) => [r.sku, r]));

  const miaFixture = loadMiaAluminumFixture();
  const enriched = roster.listings.map((listing) => {
    const attr = attrsBySku.get(listing.globalSku);
    const sync = syncBySku.get(listing.globalSku);
    const attributes = (attr?.attributes as Record<string, unknown>) ?? {};
    const mia = readMiaApproval(attributes);
    const wooStatus = deriveWooSyncStatus({
      wooProductId: listing.wooProductId,
      hubUpdatedAt: attr?.updatedAt?.toISOString?.() ?? null,
      lastSyncedAt: sync?.updatedAt?.toISOString?.() ?? null,
      lastError: sync?.lastError ?? null,
    });
    const canonical = resolveCanonicalStorefrontPrice({
      sku: listing.globalSku,
      wooSku: listing.wooSku,
      sowName: listing.productName,
      storefrontAluminumOverride: readStorefrontAluminumOverride(attributes),
      aluminumMsrp: listing.aluminumMsrpValue,
      fixture: miaFixture,
    });
    return {
      ...listing,
      // Single-price Aluminum truth for Tab 2 / drawer / CSV / Woo parity.
      aluminumMsrpValue: canonical.price,
      aluminumMsrp: formatCanonicalStorefrontPrice(canonical.price),
      miaApproved: mia.approved,
      miaApprovedAt: mia.approvedAt,
      wooSyncStatus: wooStatus as WooSyncStatus,
      attributes,
    };
  });

  if (view === "all_hub") return { view, listings: enriched, gaps: roster.gaps };
  if (view === "finishes_addons") {
    return {
      view,
      listings: enriched.filter((l) => isFinishOrAddonSku(l.globalSku)),
      gaps: roster.gaps,
    };
  }
  const phase1 = enriched.filter((l) =>
    isPhase1StorefrontRow({ globalSku: l.globalSku, msrpValue: l.msrpValue }),
  );
  return { view, listings: phase1, gaps: roster.gaps };
}

export async function toggleMiaApproval(
  globalSku: string,
  approved: boolean,
): Promise<{ ok: true; approvedAt: string | null } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const db = getDb();
  const [row] = await db
    .select({ attributes: sku_mappings.attributes, version: sku_mappings.version })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, globalSku))
    .limit(1);
  if (!row) return { ok: false, error: "SKU not found." };
  const next = writeMiaApproval(row.attributes as Record<string, unknown>, approved);
  await db
    .update(sku_mappings)
    .set({
      attributes: next,
      updated_at: new Date(),
      updated_by: session.email,
      version: row.version + 1,
    })
    .where(eq(sku_mappings.global_sku, globalSku));
  await logPimAudit({
    operatorEmail: session.email,
    globalSku,
    action: approved ? "mia_phase1_approved" : "mia_phase1_unapproved",
    field: "attributes.mia_phase1_approved",
    newValue: String(approved),
  });
  return { ok: true, approvedAt: approved ? String(next.mia_approved_at) : null };
}

export async function approveAllVisibleSkus(
  skus: string[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  let count = 0;
  for (const sku of [...new Set(skus.map((s) => s.trim()).filter(Boolean))]) {
    const result = await toggleMiaApproval(sku, true);
    if (result.ok) count += 1;
  }
  return { ok: true, count };
}

export async function dryRunWooPushForSku(globalSku: string) {
  const session = await getPimSession();
  if (!session) return { ok: false as const, error: "Unauthorized embed session." };
  const roster = await getPhase1PortalRows("phase1_flat");
  const listing = roster.listings.find((l) => l.globalSku === globalSku);
  if (!listing) return { ok: false as const, error: "Listing not found." };
  const siblings = roster.listings.filter(
    (l) =>
      (listing.wooProductId && l.wooProductId === listing.wooProductId) ||
      l.globalSku === globalSku,
  );
  // Simple SKUs: never emit synthetic -LS/-RS variation rows.
  const realFacing = filterExistingFacingChildren(
    listing.globalSku,
    roster.listings.map((l) => l.wooSku || l.globalSku),
  );
  const variationRows =
    realFacing.length >= 2
      ? siblings.filter((s) => {
          const sku = (s.wooSku || s.globalSku).toUpperCase();
          return realFacing.includes(sku) || s.globalSku === listing.globalSku;
        })
      : [listing];
  const { buildFabricSwatchesManifestJson, buildPowderSwatchesManifestJson, buildDektonSwatchesManifestJson } =
    await import("@/server/assets/finish-assets");
  const [fabricSwatchesJson, powderSwatchesJson, dektonSwatchesJson] = await Promise.all([
    buildFabricSwatchesManifestJson(),
    buildPowderSwatchesManifestJson(),
    buildDektonSwatchesManifestJson(),
  ]);
  const parent: HubParentInput = {
    wooProductId: listing.wooProductId,
    sku: listing.globalSku,
    name: storefrontDisplayTitle(listing.productName) || listing.productName,
    shortDescription: listing.marketingDescription,
    description: listing.constructionDetails,
    status: listing.isWebVisible ? "publish" : "draft",
    heroImageUrl: listing.imageUrl,
    preserveExistingImages: true,
    fabricSwatchesJson,
    powderSwatchesJson,
    dektonSwatchesJson,
    model3dGlbUrl: listing.model3dGlbUrl ?? null,
    model3dUsdzUrl: listing.model3dUsdzUrl ?? null,
    variations: variationRows.map((s) => ({
      sku: s.wooSku || s.globalSku,
      regularPrice: wooRegularFromListing(s, s.attributes),
      salePrice: s.salePrice,
      weightLb: s.hubWeight ? Number(s.hubWeight) : null,
      lengthIn: s.hubLength ? Number(s.hubLength) : null,
      widthIn: s.hubDepth ? Number(s.hubDepth) : null,
      heightIn: s.hubHeight ? Number(s.hubHeight) : null,
      sizeLabel: storefrontDisplayTitle(s.productName) || s.productName,
      katanaSku: s.globalSku,
      makeOrResale: s.thirdParty ? "Resale" : "Make",
      model3dGlbUrl: s.model3dGlbUrl ?? null,
      model3dUsdzUrl: s.model3dUsdzUrl ?? null,
    })),
  };
  // Dry-run never sends Brizy copy on existing products.
  const result = await pushParentToWoo(parent, { dryRun: true, includeCopy: false });
  return { ok: true as const, ...result };
}

export async function pushSkuToWoo(globalSku: string) {
  const session = await getPimSession();
  if (!session) return { ok: false as const, error: "Unauthorized embed session." };
  const dry = await dryRunWooPushForSku(globalSku);
  if (!dry.ok) return dry;
  const roster = await getPhase1PortalRows("phase1_flat");
  const listing = roster.listings.find((l) => l.globalSku === globalSku);
  if (!listing) return { ok: false as const, error: "Listing not found." };
  const siblings = roster.listings.filter(
    (l) =>
      (listing.wooProductId && l.wooProductId === listing.wooProductId) ||
      l.globalSku === globalSku,
  );
  const realFacing = filterExistingFacingChildren(
    listing.globalSku,
    roster.listings.map((l) => l.wooSku || l.globalSku),
  );
  const variationRows =
    realFacing.length >= 2
      ? siblings.filter((s) => {
          const sku = (s.wooSku || s.globalSku).toUpperCase();
          return realFacing.includes(sku) || s.globalSku === listing.globalSku;
        })
      : [listing];
  const { buildFabricSwatchesManifestJson, buildPowderSwatchesManifestJson, buildDektonSwatchesManifestJson } =
    await import("@/server/assets/finish-assets");
  const [fabricSwatchesJson, powderSwatchesJson, dektonSwatchesJson] = await Promise.all([
    buildFabricSwatchesManifestJson(),
    buildPowderSwatchesManifestJson(),
    buildDektonSwatchesManifestJson(),
  ]);
  const parent: HubParentInput = {
    wooProductId: listing.wooProductId,
    sku: listing.globalSku,
    name: storefrontDisplayTitle(listing.productName) || listing.productName,
    shortDescription: listing.marketingDescription,
    description: listing.constructionDetails,
    status: listing.isWebVisible ? "publish" : "draft",
    heroImageUrl: null,
    preserveExistingImages: true,
    fabricSwatchesJson,
    powderSwatchesJson,
    dektonSwatchesJson,
    model3dGlbUrl: listing.model3dGlbUrl ?? null,
    model3dUsdzUrl: listing.model3dUsdzUrl ?? null,
    variations: variationRows.map((s) => ({
      sku: s.wooSku || s.globalSku,
      regularPrice: wooRegularFromListing(s, s.attributes),
      salePrice: s.salePrice,
      weightLb: s.hubWeight ? Number(s.hubWeight) : null,
      lengthIn: s.hubLength ? Number(s.hubLength) : null,
      widthIn: s.hubDepth ? Number(s.hubDepth) : null,
      heightIn: s.hubHeight ? Number(s.hubHeight) : null,
      sizeLabel: storefrontDisplayTitle(s.productName) || s.productName,
      katanaSku: s.globalSku,
      makeOrResale: s.thirdParty ? "Resale" : "Make",
      model3dGlbUrl: s.model3dGlbUrl ?? null,
      model3dUsdzUrl: s.model3dUsdzUrl ?? null,
    })),
  };
  try {
    // Never clobber Brizy description on existing Woo products.
    const result = await pushParentToWoo(parent, { dryRun: false, includeCopy: false });
    const db = getDb();
    if (result.productId) {
      await db
        .update(sku_mappings)
        .set({ woo_product_id: result.productId, updated_at: new Date() })
        .where(eq(sku_mappings.global_sku, globalSku));
    }
    await db
      .insert(channel_sync)
      .values({
        global_sku: globalSku,
        channel: "woocommerce",
        status: "success",
        external_id: result.productId,
        last_error: null,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [channel_sync.global_sku, channel_sync.channel],
        set: {
          status: "success",
          external_id: result.productId,
          last_error: null,
          updated_at: new Date(),
        },
      });
    return { ok: true as const, ...result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Woo push failed";
    const db = getDb();
    await db
      .insert(channel_sync)
      .values({
        global_sku: globalSku,
        channel: "woocommerce",
        status: "failed",
        last_error: message,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [channel_sync.global_sku, channel_sync.channel],
        set: { status: "failed", last_error: message, updated_at: new Date() },
      });
    return { ok: false as const, error: message };
  }
}

export async function syncApprovedToWoo(skus: string[]) {
  const session = await getPimSession();
  if (!session) return { ok: false as const, error: "Unauthorized embed session." };
  // One store-units fetch per sync invocation; parents at concurrency 4.
  resetWooStoreUnitsMemo();
  await fetchWooStoreUnits().catch(() => undefined);
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const results = await mapWithConcurrency(unique, 4, async (sku) => {
    const pushed = await pushSkuToWoo(sku);
    return {
      sku,
      ok: pushed.ok,
      error: pushed.ok ? undefined : pushed.error,
    };
  });
  resetWooStoreUnitsMemo();
  return { ok: true as const, results };
}

/** Absolute tokenized PrimeView read-only handoff URL for clipboard copy. */
export async function getPrimeviewPartnerHandoffLink(): Promise<
  { ok: true; url: string; path: string } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const {
    buildPrimeviewHandoffPath,
    resolveExpectedPrimeviewHandoffToken,
  } = await import("@/lib/primeview-handoff-auth");
  const token = resolveExpectedPrimeviewHandoffToken();
  if (!token) {
    return {
      ok: false,
      error: "PRIMEVIEW_HANDOFF_TOKEN / GHL_EMBED_SECRET not configured.",
    };
  }
  const path = buildPrimeviewHandoffPath(token);
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    process.env.VERCEL_URL?.replace(/\/$/, "") ||
    "https://hub.ccpatio.com";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return { ok: true, url: `${origin}${path}`, path };
}

/** Authenticated (embed session) download URLs for live handoff artifacts. */
export async function getPrimeviewHandoffDownloadUrls(): Promise<
  | {
      ok: true;
      csv: string;
      spec: string;
      swatches: string;
      finishes: string;
      partnerPath: string;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const {
    buildPrimeviewHandoffPath,
    downloadUrlForArtifact,
    resolveExpectedPrimeviewHandoffToken,
  } = await import("@/lib/primeview-handoff-auth");
  const token = resolveExpectedPrimeviewHandoffToken();
  if (!token) {
    return {
      ok: false,
      error: "PRIMEVIEW_HANDOFF_TOKEN / GHL_EMBED_SECRET not configured.",
    };
  }
  return {
    ok: true,
    csv: downloadUrlForArtifact("csv", token),
    spec: downloadUrlForArtifact("spec", token),
    swatches: downloadUrlForArtifact("swatches", token),
    finishes: downloadUrlForArtifact("finishes", token),
    partnerPath: buildPrimeviewHandoffPath(token),
  };
}

/** Live E-Commerce tab: sync_to_woo storefront rows only (no QBO $0 noise / add-ons). */
export async function getLiveEcommerceRows() {
  const roster = await getPhase1PortalRows("phase1_flat");
  const { isLiveEcommerceRow } = await import("@/server/ecommerce/two-tab-portal");
  const listings = roster.listings.filter((l) =>
    isLiveEcommerceRow({
      globalSku: l.globalSku,
      syncToWoo: Boolean(l.syncToWoo),
      productName: l.productName,
      msrpValue: l.msrpValue,
    }),
  );
  return { listings, gaps: roster.gaps };
}

/** Phase 2 staging library with sub-filter. */
export async function getPhase2PortalRows(
  filter: "phase2_sow" | "hub_library" | "ready_to_promote" | "needs_fields" = "phase2_sow",
) {
  const roster = await getEcommerceRoster();
  const db = getDb();
  const attrRows = await db
    .select({
      sku: sku_mappings.global_sku,
      attributes: sku_mappings.attributes,
      syncToWoo: sku_mappings.sync_to_woo,
    })
    .from(sku_mappings);
  const attrsBySku = new Map(attrRows.map((r) => [r.sku, r]));
  const { matchesPhase2SubFilter } = await import("@/server/ecommerce/two-tab-portal");

  const enriched = roster.listings.map((listing) => {
    const attr = attrsBySku.get(listing.globalSku);
    return {
      ...listing,
      syncToWoo: attr?.syncToWoo ?? listing.syncToWoo,
      attributes: (attr?.attributes as Record<string, unknown>) ?? {},
    };
  });

  const listings = enriched.filter((row) =>
    matchesPhase2SubFilter(
      {
        globalSku: row.globalSku,
        productName: row.productName,
        syncToWoo: Boolean(row.syncToWoo),
        msrpValue: row.msrpValue,
        hubLength: row.hubLength,
        hubDepth: row.hubDepth,
        hubHeight: row.hubHeight,
        hubWeight: row.hubWeight,
        attributes: row.attributes,
      },
      filter,
    ),
  );
  return { filter, listings };
}

/** Promote a staging FIN/3P into Live E-Commerce (sync_to_woo=true, draft Woo until web visible). */
export async function promoteToLiveEcommerce(
  globalSku: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const sku = globalSku.trim().toUpperCase();
  const db = getDb();
  const [row] = await db
    .select({
      version: sku_mappings.version,
      attributes: sku_mappings.attributes,
      itemType: sku_mappings.item_type,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!row) return { ok: false, error: "SKU not found." };
  if (row.itemType !== "finished_good") {
    return { ok: false, error: "Only finished goods can be promoted." };
  }
  await db
    .update(sku_mappings)
    .set({
      sync_to_woo: true,
      updated_at: new Date(),
      updated_by: session.email,
      version: row.version + 1,
    })
    .where(eq(sku_mappings.global_sku, sku));
  await db
    .update(finished_goods_catalog)
    .set({ is_web_visible: false, updated_at: new Date(), updated_by: session.email })
    .where(eq(finished_goods_catalog.global_sku, sku));
  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: "promote_to_live_ecommerce",
    field: "sync_to_woo",
    newValue: "true",
  });
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true };
}

/**
 * Heal missing katana_variant_id on the parent (and children when possible) without
 * mutating product_bom edges. Seeds provisional shell ONLY when BOM edge count is 0.
 */
export async function healAndLinkKatana(
  globalSku: string,
): Promise<{ ok: true; bomReadiness: string; provisional: boolean } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const sku = globalSku.trim().toUpperCase();
  const db = getDb();
  const edges = await db
    .select({ id: product_bom.id, child: product_bom.child_sku })
    .from(product_bom)
    .where(eq(product_bom.parent_sku, sku));
  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) return { ok: false, error: "SKU not found." };

  const {
    buildProvisionalBomEdges,
    markProvisionalAttributes,
  } = await import("@/server/ecommerce/provisional-shell");
  const { deriveBomReadiness } = await import("@/server/ecommerce/phase2-hydration");

  let provisional = false;
  if (edges.length === 0 && mapping.product_origin !== "third_party") {
    provisional = true;
    const starter = buildProvisionalBomEdges(sku);
    for (const edge of starter) {
      await db
        .insert(product_bom)
        .values({
          parent_sku: edge.parent_sku,
          child_sku: edge.child_sku,
          quantity: edge.quantity,
          unit_of_measure: edge.unit_of_measure,
          notes: edge.notes,
        })
        .onConflictDoNothing({
          target: [product_bom.parent_sku, product_bom.child_sku],
        });
    }
    await db
      .update(sku_mappings)
      .set({
        attributes: markProvisionalAttributes(mapping.attributes as Record<string, unknown>),
        updated_at: new Date(),
        updated_by: session.email,
        version: mapping.version + 1,
      })
      .where(eq(sku_mappings.global_sku, sku));
  }

  // Best-effort: resolve live Katana variant by SKU when hub id is null (no BOM rewrite).
  if (mapping.katana_variant_id == null) {
    try {
      const { resolveKatanaVariantId } = await import("@/lib/katana");
      const vid = await resolveKatanaVariantId(sku);
      if (vid > 0) {
        await db
          .update(sku_mappings)
          .set({
            katana_variant_id: vid,
            updated_at: new Date(),
            updated_by: session.email,
          })
          .where(and(eq(sku_mappings.global_sku, sku), isNull(sku_mappings.katana_variant_id)));
      }
    } catch {
      // Leave readiness as needs_variant_heal when Katana cannot resolve.
    }
  }

  const [fresh] = await db
    .select({
      vid: sku_mappings.katana_variant_id,
      attributes: sku_mappings.attributes,
      version: sku_mappings.version,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  const edgeCount = (
    await db.select({ id: product_bom.id }).from(product_bom).where(eq(product_bom.parent_sku, sku))
  ).length;
  const readiness = deriveBomReadiness({
    bomEdgeCount: edgeCount,
    parentKatanaVariantId: fresh?.vid ?? null,
    childMissingVariantCount: 0,
  });
  const attrs = {
    ...((fresh?.attributes as Record<string, unknown>) ?? {}),
    bom_readiness: readiness,
  };
  await db
    .update(sku_mappings)
    .set({
      attributes: attrs,
      updated_at: new Date(),
      updated_by: session.email,
      version: (fresh?.version ?? mapping.version) + 1,
    })
    .where(eq(sku_mappings.global_sku, sku));

  await logPimAudit({
    operatorEmail: session.email,
    globalSku: sku,
    action: provisional ? "seed_provisional_shell" : "heal_link_katana",
    field: "attributes.bom_readiness",
    newValue: readiness,
  });
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true, bomReadiness: readiness, provisional };
}

/** Recalculate Aluminum Woo prices from Steel base × upcharge% (respects Mia locks). */
export async function recalculateAluminumUpcharge(upchargePct = DEFAULT_ALU_UPCHARGE_PCT): Promise<
  | { ok: true; updated: number; skippedLocked: number; pct: number }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const pct = Number.isFinite(upchargePct) && upchargePct >= 0 ? upchargePct : DEFAULT_ALU_UPCHARGE_PCT;
  const db = getDb();
  const rows = await db
    .select({
      id: ecommerce_listings.id,
      sku: ecommerce_listings.global_sku,
      steel: ecommerce_listings.steel_msrp,
      version: ecommerce_listings.version,
      thirdParty: third_party_sources.global_sku,
      attributes: sku_mappings.attributes,
      mapVersion: sku_mappings.version,
    })
    .from(ecommerce_listings)
    .innerJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
    .leftJoin(third_party_sources, eq(third_party_sources.global_sku, ecommerce_listings.global_sku))
    .where(and(isNull(ecommerce_listings.archived_at), eq(sku_mappings.sync_to_woo, true)));

  let updated = 0;
  let skippedLocked = 0;
  for (const row of rows) {
    const attrs = (row.attributes as Record<string, unknown>) ?? {};
    if (isMiaPriceLocked(attrs)) {
      skippedLocked += 1;
      continue;
    }
    const steel = row.steel != null ? Number(row.steel) : NaN;
    if (!Number.isFinite(steel) || steel <= 0) continue;
    const policy = classifyFramePolicy({
      globalSku: row.sku,
      isThirdParty: Boolean(row.thirdParty),
      attributes: attrs,
    });
    const alu =
      wooEcommercePrice({
        steelMsrp: steel,
        framePolicy: policy,
        upchargePct: pct,
      }) ?? steel;
    const nextAttrs = buildAluAttributePatch(attrs, {
      sowBaseSteelMsrp: steel,
      framePolicy: policy,
      upchargePct: pct,
      wooAluMsrp: alu,
    });
    await db
      .update(ecommerce_listings)
      .set({
        aluminum_msrp: alu.toFixed(2),
        version: row.version + 1,
        updated_at: new Date(),
      })
      .where(eq(ecommerce_listings.id, row.id));
    await db
      .update(sku_mappings)
      .set({
        attributes: nextAttrs,
        version: row.mapVersion + 1,
        updated_at: new Date(),
        updated_by: session.email,
      })
      .where(eq(sku_mappings.global_sku, row.sku));
    updated += 1;
  }
  await logPimAudit({
    operatorEmail: session.email,
    globalSku: "*",
    action: "recalculate_alu_upcharge",
    field: "aluminum_msrp",
    newValue: String(pct),
  });
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true, updated, skippedLocked, pct };
}

/** Round .50 cent Aluminum prices to nearest whole dollar (Taylor 4 SKUs etc.). */
export async function roundHalfCentAluminumPrices(): Promise<
  | { ok: true; rounded: Array<{ sku: string; from: number; to: number }> }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const db = getDb();
  const rows = await db
    .select({
      id: ecommerce_listings.id,
      sku: ecommerce_listings.global_sku,
      alum: ecommerce_listings.aluminum_msrp,
      version: ecommerce_listings.version,
    })
    .from(ecommerce_listings)
    .where(isNull(ecommerce_listings.archived_at));

  const rounded: Array<{ sku: string; from: number; to: number }> = [];
  for (const row of rows) {
    if (row.alum == null) continue;
    const from = Number(row.alum);
    if (!Number.isFinite(from) || !hasHalfCent(from)) continue;
    const to = roundAluToWholeDollar(from);
    await db
      .update(ecommerce_listings)
      .set({
        aluminum_msrp: to.toFixed(2),
        version: row.version + 1,
        updated_at: new Date(),
      })
      .where(eq(ecommerce_listings.id, row.id));
    rounded.push({ sku: row.sku, from, to });
  }
  await logPimAudit({
    operatorEmail: session.email,
    globalSku: "*",
    action: "round_half_cent_alu",
    field: "aluminum_msrp",
    newValue: String(rounded.length),
  });
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true, rounded };
}

/** 1-click Round to Nearest $5 for Mia odd-dollar PDF rows. Clears odd flag. */
export async function roundListingAluminumNearest5(
  listingId: string,
): Promise<
  | { ok: true; from: number; to: number }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const db = getDb();
  const [listing] = await db
    .select({
      id: ecommerce_listings.id,
      sku: ecommerce_listings.global_sku,
      alum: ecommerce_listings.aluminum_msrp,
      version: ecommerce_listings.version,
      attributes: sku_mappings.attributes,
      mapVersion: sku_mappings.version,
    })
    .from(ecommerce_listings)
    .innerJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
    .where(eq(ecommerce_listings.id, listingId))
    .limit(1);
  if (!listing) return { ok: false, error: "Listing not found." };
  const from = listing.alum != null ? Number(listing.alum) : NaN;
  if (!Number.isFinite(from) || from <= 0) {
    return { ok: false, error: "No aluminum price to round." };
  }
  const { suggestedNearest5 } = await import("@/server/ecommerce/mia-aluminum-pricing");
  const to = suggestedNearest5(from);
  const attrs: Record<string, unknown> = {
    ...((listing.attributes as Record<string, unknown>) ?? {}),
    mia_price_locked: true,
    woo_alu_msrp: to,
    mia_pdf_price_before_round: from,
  };
  delete attrs.price_review_flag;
  await db
    .update(ecommerce_listings)
    .set({
      aluminum_msrp: to.toFixed(2),
      version: listing.version + 1,
      updated_at: new Date(),
    })
    .where(eq(ecommerce_listings.id, listingId));
  await db
    .update(sku_mappings)
    .set({
      attributes: attrs,
      version: listing.mapVersion + 1,
      updated_at: new Date(),
      updated_by: session.email,
    })
    .where(eq(sku_mappings.global_sku, listing.sku));
  await logPimAudit({
    operatorEmail: session.email,
    globalSku: listing.sku,
    action: "round_nearest_5_alu",
    field: "aluminum_msrp",
    oldValue: String(from),
    newValue: String(to),
  });
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true, from, to };
}

export async function updateListingAluminumMsrp(
  listingId: string,
  aluminumMsrp: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const parsed = parsePrice(aluminumMsrp);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: "Invalid aluminum price." };
  }
  const db = getDb();
  const [listing] = await db
    .select({
      id: ecommerce_listings.id,
      sku: ecommerce_listings.global_sku,
      version: ecommerce_listings.version,
      attributes: sku_mappings.attributes,
      mapVersion: sku_mappings.version,
    })
    .from(ecommerce_listings)
    .innerJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
    .where(eq(ecommerce_listings.id, listingId))
    .limit(1);
  if (!listing) return { ok: false, error: "Listing not found." };
  const attrs = {
    ...((listing.attributes as Record<string, unknown>) ?? {}),
    mia_price_locked: true,
    woo_alu_msrp: parsed,
  };
  await db
    .update(ecommerce_listings)
    .set({
      aluminum_msrp: parsed.toFixed(2),
      version: listing.version + 1,
      updated_at: new Date(),
    })
    .where(eq(ecommerce_listings.id, listingId));
  await db
    .update(sku_mappings)
    .set({
      attributes: attrs,
      version: listing.mapVersion + 1,
      updated_at: new Date(),
      updated_by: session.email,
    })
    .where(eq(sku_mappings.global_sku, listing.sku));
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true };
}

export async function exportMiaAluminumPriceListCsv(): Promise<
  { ok: true; csv: string } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const roster = await getPhase1PortalRows("phase1_flat");
  const csv = buildMiaAluminumPriceListCsv(
    roster.listings.map((l) => {
      const policy = classifyFramePolicy({
        globalSku: l.globalSku,
        isThirdParty: Boolean(l.thirdParty),
      });
      return {
        collection: l.collectionLabel,
        product: l.productName,
        sku: l.globalSku,
        framePolicy: policy,
        steelBase: l.msrpValue,
        aluPrice: l.aluminumMsrpValue ?? l.msrpValue,
        salePrice: l.salePrice ? parsePrice(l.salePrice) : null,
        miaApproved: Boolean((l as { miaApproved?: boolean }).miaApproved),
      };
    }),
  );
  return { ok: true, csv };
}

/* ───────────── Swatches, Finishes & 3D media (phase 3d-glb-and-hires-swatch-studio) ───────────── */

export type FinishAssetCategory = "fabric" | "powder" | "dekton";

/** Serializable finish registry row for the GHL drawer (numerics are plain numbers). */
export interface FinishAssetView {
  sku: string;
  finishCategory: FinishAssetCategory;
  displayName: string;
  hexCode: string | null;
  swatchThumbUrl: string | null;
  texture2kUrl: string | null;
  normalMapUrl: string | null;
  roughnessMapUrl: string | null;
  sampleWidthIn: number | null;
  sampleHeightIn: number | null;
  patternRepeatWIn: number | null;
  patternRepeatHIn: number | null;
  textureSha256: string | null;
  sourceType: "studio_photo" | "synthetic_fallback" | null;
  sourceFilename: string | null;
  textureWidthPx: number | null;
  textureHeightPx: number | null;
  qualityStatus: "placeholder_lowres" | "photoshoot_verified";
  uploadedBy: string | null;
  updatedAt: string;
}

function toFinishAssetView(r: Awaited<ReturnType<typeof listFinishAssets>>[number]): FinishAssetView {
  const n = (v: string | null) => (v == null ? null : Number(v));
  return {
    sku: r.sku,
    finishCategory: r.finish_category,
    displayName: r.display_name,
    hexCode: r.hex_code,
    swatchThumbUrl: r.swatch_thumb_url,
    texture2kUrl: r.texture_2k_url,
    normalMapUrl: r.normal_map_url,
    roughnessMapUrl: r.roughness_map_url,
    sampleWidthIn: n(r.sample_width_in),
    sampleHeightIn: n(r.sample_height_in),
    patternRepeatWIn: n(r.pattern_repeat_w_in),
    patternRepeatHIn: n(r.pattern_repeat_h_in),
    textureSha256: r.texture_sha256 ?? null,
    sourceType: r.source_type ?? null,
    sourceFilename: r.source_filename ?? null,
    textureWidthPx: r.texture_width_px ?? null,
    textureHeightPx: r.texture_height_px ?? null,
    qualityStatus: r.quality_status,
    uploadedBy: r.uploaded_by,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function getEcommercePortalAccess(): Promise<{
  ok: true;
  canAccess: boolean;
  canFullCatalog: boolean;
  email: string | null;
  role: string | null;
  embedSession: boolean;
} | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  let role: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) {
      const [row] = await getDb()
        .select({ role: user_roles.role })
        .from(user_roles)
        .where(eq(user_roles.id, user.id))
        .limit(1);
      role = row?.role ?? null;
    }
  } catch {
    role = null;
  }
  const embedSession = isEmbedPrincipal(session);
  return {
    ok: true,
    canAccess: canAccessEcommercePortal({
      email: session.email,
      role,
      embedSession,
    }),
    canFullCatalog: canAccessFullMasterCatalog({ email: session.email, role }),
    email: session.email,
    role,
    embedSession,
  };
}

export async function listFinishAssetsForPortal(): Promise<
  | {
      ok: true;
      assets: FinishAssetView[];
      archivedAssets: FinishAssetView[];
      seeded?: { inserted: number; existing: number };
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    // Idempotent hydrate — merge all 32 canonical finishes on first read / boot.
    const seeded = await seedEcommerceFinishAssets();
    const allRows = await listFinishAssets();
    const rows = filterActiveEcommerceFinishes(allRows);
    const archivedAssets = allRows
      .filter(
        (r) =>
          isEcommerce32FinishSku(r.sku) &&
          (r.uploaded_by ?? "").toLowerCase() === ECOMMERCE_FINISH_DISABLED_SENTINEL,
      )
      .map(toFinishAssetView);
    return {
      ok: true,
      assets: rows.map(toFinishAssetView),
      archivedAssets,
      seeded: { inserted: seeded.inserted, existing: seeded.existing },
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load finish assets" };
  }
}

/* ───────────────────────── Tab 1 · Intake & Media Studio ───────────────────────── */

import {
  apfTargetGroupForMaterial,
  defaultUvScale,
  getFinishIntakeById,
  listFinishIntake,
  mintCanonicalFinishSku,
  promoteFinishIntake,
  reCropFinishFromBuffer,
  resolveFinishDefBySkuOrAlias,
  searchFinishSkuMatches,
  updateFinishIntakeMeta,
  type FinishIntakeView,
  type MaterialClass,
} from "@/server/ecommerce/finish-intake";
import { finish_intake } from "@/server/db/schema";
import sharp from "sharp";
import {
  getPublicObjectUrl,
  getSupabaseAdmin,
  PRODUCT_IMAGES_BUCKET,
} from "@/lib/supabase-storage";

export type FinishIntakeListOptions = Parameters<typeof listFinishIntake>[0];
export type FinishIntakePatchInput = Parameters<typeof updateFinishIntakeMeta>[1];
export type FinishSkuSearchResult = {
  matches: ReturnType<typeof searchFinishSkuMatches>;
  /** Deterministic canonical SKU minted from display name + material class (null until both set). */
  mintedSku: string | null;
  /** Existing roster SKU the proposed/minted SKU binds to (alias / STN-DKT bridge aware). */
  boundExistingSku: string | null;
  apfGroup: ReturnType<typeof apfTargetGroupForMaterial> | null;
  uvScale: number | null;
};

const INTAKE_MATERIAL_CLASSES = ["sunbrella", "ultraleather", "dekton", "powder", "addon"] as const;

const intakePatchSchema = z
  .object({
    materialClass: z.enum(INTAKE_MATERIAL_CLASSES).nullable().optional(),
    displayName: z.string().max(120).nullable().optional(),
    vendorSku: z.string().max(80).nullable().optional(),
    materialDescription: z.string().max(500).nullable().optional(),
    patternMode: z.enum(["solid", "striped"]).nullable().optional(),
    repeatWIn: z.number().nonnegative().nullable().optional(),
    repeatHIn: z.number().nonnegative().nullable().optional(),
    proposedSku: z.string().max(64).nullable().optional(),
    cropX: z.number().int().nonnegative().nullable().optional(),
    cropY: z.number().int().nonnegative().nullable().optional(),
    cropSidePx: z.number().int().positive().nullable().optional(),
    sourceWidth: z.number().int().positive().nullable().optional(),
    sourceHeight: z.number().int().positive().nullable().optional(),
    // "certified" is only ever set by promoteFinishIntakeAction.
    status: z.enum(["pending", "crop_verified", "classified"]).optional(),
  })
  .strict();

const intakeCropSchema = z.object({
  id: z.string().uuid(),
  cropX: z.number().int().nonnegative(),
  cropY: z.number().int().nonnegative(),
  cropSidePx: z.number().int().min(64),
  sourceWidth: z.number().int().positive(),
  sourceHeight: z.number().int().positive(),
});

/** Powder coats whose roster display name was shortened to Gray / Beige / Bronze. */
const POWDER_SOFT_PATCH_SKUS = ["PWD-FANUC-GRAY", "PWD-LITE-BEIGE", "PWD-OIL-RUB-BRONZE"] as const;

/**
 * Soft-patch powder display names (Gray / Beige / Bronze) to the roster name.
 * Only writes when the stored name is empty or a known stale roster variant
 * (`isStaleFinishDisplayName`) — a customized name is NEVER overwritten.
 * Throws on DB failure so callers surface it.
 */
async function ensurePowderDisplayNamesCore(operatorEmail: string): Promise<string[]> {
  const rows = await listFinishAssets({ category: "powder" });
  const patched: string[] = [];
  for (const sku of POWDER_SOFT_PATCH_SKUS) {
    const row = rows.find((r) => r.sku === sku);
    const def = ecommerceFinishBySku(sku);
    if (!row || !def) continue;
    if (!isStaleFinishDisplayName(sku, row.display_name)) continue;
    const updated = await updateFinishAsset(sku, { display_name: def.displayName });
    if (!updated) continue;
    patched.push(sku);
    await logPimAudit({
      operatorEmail,
      globalSku: sku,
      action: "ecommerce_finish_powder_display_soft_patch",
      field: "ecommerce_finish_assets.display_name",
      oldValue: row.display_name,
      newValue: updated.display_name,
    });
  }
  return patched;
}

export async function ensurePowderDisplayNamesAction(): Promise<
  { ok: true; patched: string[] } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    return { ok: true, patched: await ensurePowderDisplayNamesCore(session.email) };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not patch powder display names",
    };
  }
}

/** Intake queue (27 photoshoot finishes + ad-hoc). Runs the powder soft-patch first. */
export async function listFinishIntakeAction(opts?: FinishIntakeListOptions): Promise<
  | {
      ok: true;
      items: FinishIntakeView[];
      powderPatched: string[];
      /** Non-fatal: queue loaded but the powder soft-patch failed. Surface to the operator. */
      powderWarning: string | null;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    let powderPatched: string[] = [];
    let powderWarning: string | null = null;
    try {
      powderPatched = await ensurePowderDisplayNamesCore(session.email);
    } catch (error: unknown) {
      powderWarning = `Powder display-name soft-patch failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }
    const items = await listFinishIntake(opts);
    return { ok: true, items, powderPatched, powderWarning };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not load finish intake queue",
    };
  }
}

export async function updateFinishIntakeAction(
  id: string,
  patch: FinishIntakePatchInput,
): Promise<{ ok: true; view: FinishIntakeView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const idOk = z.string().uuid().safeParse(id);
  if (!idOk.success) return { ok: false, error: "Invalid intake id" };
  const parsed = intakePatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid intake patch" };
  }
  try {
    const view = await updateFinishIntakeMeta(id, parsed.data as FinishIntakePatchInput);
    return { ok: true, view };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update intake item" };
  }
}

/** Persist the crop square, re-crop the reference to 2048 + 512 drafts and store them. */
export async function applyFinishIntakeCropAction(input: {
  id: string;
  cropX: number;
  cropY: number;
  cropSidePx: number;
  sourceWidth: number;
  sourceHeight: number;
}): Promise<{ ok: true; view: FinishIntakeView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const parsed = intakeCropSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid crop box" };
  }
  const crop = parsed.data;
  if (
    crop.cropX + crop.cropSidePx > crop.sourceWidth ||
    crop.cropY + crop.cropSidePx > crop.sourceHeight
  ) {
    return { ok: false, error: "Crop square extends outside the source image" };
  }
  try {
    const current = await getFinishIntakeById(crop.id);
    if (!current) return { ok: false, error: "Intake item not found" };
    if (current.status === "certified") {
      return { ok: false, error: "Item is already certified — crop is locked" };
    }
    if (!current.rawReferenceUrl) {
      return { ok: false, error: "No uncropped reference image available for this item" };
    }

    await updateFinishIntakeMeta(crop.id, {
      cropX: crop.cropX,
      cropY: crop.cropY,
      cropSidePx: crop.cropSidePx,
      sourceWidth: crop.sourceWidth,
      sourceHeight: crop.sourceHeight,
    });

    const refRes = await fetch(current.rawReferenceUrl.split("?")[0]!, { cache: "no-store" });
    if (!refRes.ok) {
      return { ok: false, error: `Could not fetch reference image (HTTP ${refRes.status})` };
    }
    const refBytes = Buffer.from(await refRes.arrayBuffer());

    // The reference is a downscaled copy (max ~1400px); crop coords are in SOURCE pixels.
    const refMeta = await sharp(refBytes).metadata();
    const swap = (refMeta.orientation ?? 1) >= 5;
    const refW = (swap ? refMeta.height : refMeta.width) ?? 0;
    const refH = (swap ? refMeta.width : refMeta.height) ?? 0;
    if (refW <= 0 || refH <= 0) return { ok: false, error: "Reference image has no readable size" };
    const scaleX = refW / crop.sourceWidth;
    const scaleY = refH / crop.sourceHeight;
    if (Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > 0.015) {
      return {
        ok: false,
        error: "Reference aspect ratio does not match the source dimensions — re-seed this item",
      };
    }
    const refSide = Math.max(8, Math.round(crop.cropSidePx * scaleX));
    const refX = Math.min(Math.round(crop.cropX * scaleX), Math.max(0, refW - refSide));
    const refY = Math.min(Math.round(crop.cropY * scaleY), Math.max(0, refH - refSide));

    const cropped = await reCropFinishFromBuffer({
      sourceBytes: refBytes,
      cropX: refX,
      cropY: refY,
      cropSidePx: refSide,
      patternMode: current.patternMode,
      materialClass: current.materialClass,
    });

    const supabase = getSupabaseAdmin();
    const sha8 = cropped.sha256.slice(0, 8);
    const put = async (objectPath: string, buf: Buffer): Promise<string> => {
      const { error } = await supabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(objectPath, buf, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      const base = getPublicObjectUrl(PRODUCT_IMAGES_BUCKET, objectPath);
      return `${base}${base.includes("?") ? "&" : "?"}v=${sha8}`;
    };
    const textureUrl = await put(`intake/crops/${crop.id}/${crop.id}-2048.jpg`, cropped.texture2048);
    const thumbUrl = await put(`intake/crops/${crop.id}/${crop.id}-512.jpg`, cropped.thumb512);

    await getDb()
      .update(finish_intake)
      .set({
        texture_2048_url: textureUrl,
        thumb_512_url: thumbUrl,
        texture_sha256: cropped.sha256,
        ...(current.status === "pending" ? { status: "crop_verified" as const } : {}),
        updated_at: new Date(),
      })
      .where(eq(finish_intake.id, crop.id));

    await logPimAudit({
      operatorEmail: session.email,
      globalSku: current.canonicalSku ?? current.proposedSku ?? null,
      action: "finish_intake_crop_applied",
      field: "finish_intake.crop",
      newValue: JSON.stringify({
        id: crop.id,
        cropX: crop.cropX,
        cropY: crop.cropY,
        cropSidePx: crop.cropSidePx,
        sha256: cropped.sha256,
      }),
    });

    const view = await getFinishIntakeById(crop.id);
    if (!view) return { ok: false, error: "Intake item vanished after crop" };
    return { ok: true, view };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not apply crop" };
  }
}

/** Approve & Promote to Certified — delegates to promoteFinishIntake (never clobbers customized names). */
export async function promoteFinishIntakeAction(
  id: string,
): Promise<
  { ok: true; view: FinishIntakeView; canonicalSku: string } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const idOk = z.string().uuid().safeParse(id);
  if (!idOk.success) return { ok: false, error: "Invalid intake id" };
  try {
    const result = await promoteFinishIntake({ id, actor: session.email });
    if (!result.ok) return { ok: false, error: result.error };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: result.canonicalSku,
      action: "finish_intake_promoted",
      field: "finish_intake.status",
      newValue: "certified",
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, view: result.view, canonicalSku: result.canonicalSku };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not promote intake item" };
  }
}

/** Live SKU preview — roster/alias search + the SKU promote would mint/bind. */
export async function searchFinishSkuAction(input: {
  query?: string;
  displayName?: string | null;
  materialClass?: MaterialClass | null;
  proposedSku?: string | null;
}): Promise<({ ok: true } & FinishSkuSearchResult) | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const query = (input.query ?? "").trim().slice(0, 80);
    const displayName = (input.displayName ?? "").trim();
    const materialClass = input.materialClass ?? null;
    const mintedSku =
      displayName && materialClass ? mintCanonicalFinishSku(displayName, materialClass) : null;
    const candidate = (input.proposedSku ?? "").trim() || mintedSku;
    const bound = candidate ? resolveFinishDefBySkuOrAlias(candidate) : null;
    return {
      ok: true,
      matches: searchFinishSkuMatches(query),
      mintedSku,
      boundExistingSku: bound?.sku ?? null,
      apfGroup: materialClass ? apfTargetGroupForMaterial(materialClass) : null,
      uvScale: materialClass ? defaultUvScale(materialClass) : null,
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "SKU search failed" };
  }
}

/** Soft-archived storefront listings for the Tab 2 Archived (N) vault. */
export async function listArchivedEcommerceListingsForPortal(): Promise<
  | {
      ok: true;
      listings: Array<{
        id: string;
        globalSku: string;
        wooSku: string | null;
        productName: string;
        collectionLabel: string;
        archivedAt: string | null;
      }>;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const rows = await getDb()
      .select({
        id: ecommerce_listings.id,
        globalSku: ecommerce_listings.global_sku,
        wooSku: ecommerce_listings.woo_sku,
        productName: ecommerce_listings.product_name,
        collectionLabel: ecommerce_listings.collection_label,
        archivedAt: ecommerce_listings.archived_at,
      })
      .from(ecommerce_listings)
      .where(sql`${ecommerce_listings.archived_at} is not null`)
      .orderBy(desc(ecommerce_listings.archived_at))
      .limit(500);
    return {
      ok: true,
      listings: rows.map((r) => ({
        id: r.id,
        globalSku: r.globalSku,
        wooSku: r.wooSku,
        productName: r.productName,
        collectionLabel: r.collectionLabel,
        archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      })),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not load archived listings",
    };
  }
}

/** Soft-archive a storefront listing in Hub only — never Woo DELETE. */
export async function archiveEcommerceListingForPortal(
  listingId: string,
): Promise<{ ok: true; globalSku: string } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const db = getDb();
    const [row] = await db
      .select({ id: ecommerce_listings.id, globalSku: ecommerce_listings.global_sku })
      .from(ecommerce_listings)
      .where(and(eq(ecommerce_listings.id, listingId), isNull(ecommerce_listings.archived_at)))
      .limit(1);
    if (!row) return { ok: false, error: "Active listing not found." };
    await db
      .update(ecommerce_listings)
      .set({ archived_at: new Date(), updated_at: new Date() })
      .where(eq(ecommerce_listings.id, listingId));
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.globalSku,
      action: "ecommerce_listing_archived",
      field: "ecommerce_listings.archived_at",
      newValue: new Date().toISOString(),
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, globalSku: row.globalSku };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not archive listing",
    };
  }
}

/** Restore a soft-archived listing — Hub-only, no Woo DELETE. */
export async function restoreEcommerceListingForPortal(
  listingId: string,
): Promise<{ ok: true; globalSku: string } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const db = getDb();
    const [row] = await db
      .select({ id: ecommerce_listings.id, globalSku: ecommerce_listings.global_sku })
      .from(ecommerce_listings)
      .where(eq(ecommerce_listings.id, listingId))
      .limit(1);
    if (!row) return { ok: false, error: "Listing not found." };
    await db
      .update(ecommerce_listings)
      .set({ archived_at: null, updated_at: new Date() })
      .where(eq(ecommerce_listings.id, listingId));
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.globalSku,
      action: "ecommerce_listing_restored",
      field: "ecommerce_listings.archived_at",
      newValue: null,
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, globalSku: row.globalSku };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not restore listing",
    };
  }
}

/** Soft-remove (−) a finish from the active e-commerce roster (SKU retained in Hub). */
export async function disableFinishRowForPortal(
  sku: string,
): Promise<{ ok: true; asset: FinishAssetView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const row = await disableEcommerceFinishAsset(sku);
    if (!row) return { ok: false, error: `Unknown finish SKU ${sku}` };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.sku,
      action: "ecommerce_finish_disabled",
      field: "ecommerce_finish_assets.uploaded_by",
      newValue: row.uploaded_by,
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, asset: toFinishAssetView(row) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not disable finish" };
  }
}

/** + add finish row — SKU auto-minted and locked. */
export async function addFinishRowForPortal(input: {
  category: FinishAssetCategory;
  displayName: string;
  hexCode?: string | null;
}): Promise<{ ok: true; asset: FinishAssetView; skuLocked: true } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const name = input.displayName?.trim();
    if (!name) return { ok: false, error: "Display name is required." };
    const row = await addEcommerceFinishAsset({
      category: input.category,
      displayName: name,
      hexCode: input.hexCode ?? null,
    });
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.sku,
      action: "ecommerce_finish_added",
      field: "ecommerce_finish_assets",
      newValue: JSON.stringify({ sku: row.sku, displayName: name, locked: isFinishSkuLocked(row.sku) }),
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, asset: toFinishAssetView(row), skuLocked: true };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add finish" };
  }
}

/** Edit allowed fields (display name / hex) — SKU stays locked. */
export async function updateFinishDisplayForPortal(
  sku: string,
  input: { displayName?: string; hexCode?: string | null },
): Promise<{ ok: true; asset: FinishAssetView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    if (!isFinishSkuLocked(sku)) {
      return { ok: false, error: "SKU lock invariant violated." };
    }
    const row = await updateFinishAsset(sku, {
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.hexCode !== undefined ? { hex_code: input.hexCode } : {}),
    });
    if (!row) return { ok: false, error: `Unknown finish SKU ${sku}` };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.sku,
      action: "ecommerce_finish_display_updated",
      field: "ecommerce_finish_assets.display_name",
      newValue: row.display_name,
    });
    return { ok: true, asset: toFinishAssetView(row) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update finish" };
  }
}

export async function reenableFinishRowForPortal(
  sku: string,
): Promise<{ ok: true; asset: FinishAssetView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const row = await enableEcommerceFinishAsset(sku);
    if (!row) return { ok: false, error: `Unknown finish SKU ${sku}` };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.sku,
      action: "ecommerce_finish_reenabled",
      field: "ecommerce_finish_assets.uploaded_by",
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, asset: toFinishAssetView(row) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not re-enable finish" };
  }
}

export interface FinishCalibrationInput {
  sample_width_in: number | null;
  sample_height_in: number | null;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
}

/** Persists physical sample size + pattern repeat (inches). null clears a field. */
export async function saveFinishCalibration(
  sku: string,
  input: FinishCalibrationInput,
): Promise<{ ok: true; asset: FinishAssetView } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const row = await updateFinishAsset(sku, {
      sample_width_in: input.sample_width_in,
      sample_height_in: input.sample_height_in,
      pattern_repeat_w_in: input.pattern_repeat_w_in,
      pattern_repeat_h_in: input.pattern_repeat_h_in,
    });
    if (!row) return { ok: false, error: `Unknown finish SKU ${sku}` };
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: row.sku,
      action: "finish_calibration_saved",
      field: "ecommerce_finish_assets.calibration",
      newValue: JSON.stringify(input),
    });
    return { ok: true, asset: toFinishAssetView(row) };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save calibration" };
  }
}

const MATERIAL_SLOT_KEYS = [
  "frame_metal",
  "frame_finish",
  "cushion_fabric",
  "stone_top",
  "table_top",
  "accent_pillow",
  "accent_accents",
] as const;
type MaterialSlotKey = (typeof MATERIAL_SLOT_KEYS)[number];

export interface Product3dMaterialSlot {
  slot: MaterialSlotKey;
  /** Optional glTF material / mesh name that the viewer maps this slot to. */
  mesh_name: string | null;
}

export interface Product3dSlots {
  listingId: string;
  wooSku: string | null;
  globalSku: string;
  glbUrl: string | null;
  usdzUrl: string | null;
  posterUrl: string | null;
  fileSize: number | null;
  uploadedBy: string | null;
  updatedAt: string | null;
  materialSlots: Product3dMaterialSlot[];
  /** Real crypto sha256 hex from product_assets, or null when pending upload. */
  sha256: string | null;
}

function normalizeMaterialSlots(raw: unknown): Product3dMaterialSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: Product3dMaterialSlot[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const key =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && typeof (entry as { slot?: unknown }).slot === "string"
          ? (entry as { slot: string }).slot
          : null;
    if (!key || !(MATERIAL_SLOT_KEYS as readonly string[]).includes(key) || seen.has(key)) continue;
    seen.add(key);
    const mesh =
      entry && typeof entry === "object" && typeof (entry as { mesh_name?: unknown }).mesh_name === "string"
        ? (entry as { mesh_name: string }).mesh_name.trim() || null
        : null;
    out.push({ slot: key as MaterialSlotKey, mesh_name: mesh });
  }
  return out;
}

/** Resolves a listing by Woo (storefront) SKU first, then by an unambiguous global SKU. */
async function resolveProduct3dListing(sku: string) {
  const trimmed = sku.trim();
  const byWoo = await resolveListing3dTarget({ woo_sku: trimmed });
  if (byWoo.ok) return byWoo;
  const byGlobal = await resolveListing3dTarget({ sku: trimmed });
  return byGlobal.ok ? byGlobal : byWoo.status === 404 ? byGlobal : byWoo;
}

export async function getProduct3dSlots(
  wooSkuOrGlobalSku: string,
): Promise<{ ok: true; slots: Product3dSlots } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const target = await resolveProduct3dListing(wooSkuOrGlobalSku);
    if (!target.ok) return { ok: false, error: target.reason };
    const l = ecommerce_listings;
    const db = getDb();
    const [row] = await db
      .select({
        glb: l.model_3d_glb_url,
        usdz: l.model_3d_usdz_url,
        poster: l.model_3d_poster_url,
        size: l.model_3d_file_size,
        by: l.model_3d_uploaded_by,
        at: l.model_3d_updated_at,
        slots: l.model_3d_material_slots,
      })
      .from(l)
      .where(eq(l.id, target.id))
      .limit(1);
    if (!row) return { ok: false, error: "Listing not found." };

    // Real sha256 from commit-upload (attributes); never fabricate placeholder hashes.
    const [mapping] = await db
      .select({ attributes: sku_mappings.attributes })
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, target.global_sku))
      .limit(1);
    const attrs = (mapping?.attributes as Record<string, unknown> | null) ?? {};
    const glbHash =
      typeof attrs.model_3d_glb_sha256 === "string" ? attrs.model_3d_glb_sha256 : null;
    const usdzHash =
      typeof attrs.model_3d_usdz_sha256 === "string" ? attrs.model_3d_usdz_sha256 : null;
    const sha256 = glbHash || usdzHash || null;

    return {
      ok: true,
      slots: {
        listingId: target.id,
        wooSku: target.woo_sku,
        globalSku: target.global_sku,
        glbUrl: row.glb,
        usdzUrl: row.usdz,
        posterUrl: row.poster,
        fileSize: row.size,
        uploadedBy: row.by,
        updatedAt: row.at ? row.at.toISOString() : null,
        materialSlots: normalizeMaterialSlots(row.slots),
        sha256,
      },
    };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load 3D slots" };
  }
}

export async function saveProduct3dMaterialSlots(
  wooSkuOrGlobalSku: string,
  slots: { slot: string; mesh_name?: string | null }[],
): Promise<{ ok: true; materialSlots: Product3dMaterialSlot[] } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const invalid = slots.find((s) => !(MATERIAL_SLOT_KEYS as readonly string[]).includes(s.slot));
  if (invalid) {
    return { ok: false, error: `Unknown material slot "${invalid.slot}". Allowed: ${MATERIAL_SLOT_KEYS.join(", ")}` };
  }
  try {
    const target = await resolveProduct3dListing(wooSkuOrGlobalSku);
    if (!target.ok) return { ok: false, error: target.reason };
    const normalized = normalizeMaterialSlots(slots);
    await getDb()
      .update(ecommerce_listings)
      .set({ model_3d_material_slots: normalized, model_3d_updated_at: new Date() })
      .where(eq(ecommerce_listings.id, target.id));
    await logPimAudit({
      operatorEmail: session.email,
      globalSku: target.global_sku,
      action: "model_3d_material_slots_saved",
      field: "ecommerce_listings.model_3d_material_slots",
      newValue: JSON.stringify(normalized),
    });
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true, materialSlots: normalized };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save material slots" };
  }
}

/**
 * Pushes the listing's parent to WooCommerce through the existing `pushSkuToWoo` path
 * (the 3D/finish meta mapping lives in woo-catalog-sync). Requires a stored .glb.
 */
export async function syncProduct3dToWoo(
  wooSkuOrGlobalSku: string,
): Promise<{ ok: true; globalSku: string; productId?: string | null } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const slots = await getProduct3dSlots(wooSkuOrGlobalSku);
  if (!slots.ok) return slots;
  if (!slots.slots.glbUrl) {
    return { ok: false, error: "Upload a .glb before syncing 3D to WooCommerce." };
  }
  const pushed = await pushSkuToWoo(slots.slots.globalSku);
  if (!pushed.ok) return { ok: false, error: pushed.error };
  return {
    ok: true,
    globalSku: slots.slots.globalSku,
    productId: (pushed as { productId?: string | null }).productId ?? null,
  };
}

/* ─── System Health / baton-pass (autonomous-katana-baton-pass) ─── */

export type SystemHealthSnapshot = Awaited<
  ReturnType<typeof import("@/server/ops/keepalive").getSystemHealthSnapshot>
>;

export async function getSystemHealthAction(): Promise<
  { ok: true; snapshot: SystemHealthSnapshot } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { getSystemHealthSnapshot } = await import("@/server/ops/keepalive");
    const snapshot = await getSystemHealthSnapshot();
    return { ok: true, snapshot };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "System health probe failed",
    };
  }
}

export async function requestKatanaSelfHealAction(): Promise<
  { ok: true; eventIds: string[] } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { inngest } = await import("@/inngest/client");
    const { KATANA_RECONCILE_EVENT } = await import("@/server/katana/catalog-reconcile");
    const sent = await inngest.send({
      name: KATANA_RECONCILE_EVENT,
      data: {
        requestedBy: session.email,
        source: "master-catalog-system-health",
      },
    });
    await logPimAudit({
      operatorEmail: session.email,
      action: "request_katana_self_heal",
      field: "katana_reconcile",
      newValue: "ops/katana.reconcile.requested",
    });
    return { ok: true, eventIds: sent.ids ?? [] };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not enqueue self-heal",
    };
  }
}

export async function replayHeldWooOrderAction(
  quarantineId: number,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const { replayWooQuarantinedOrder } = await import(
    "@/app/admin/quarantine/woo-actions"
  );
  const result = await replayWooQuarantinedOrder(quarantineId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/embed/admin/master-catalog");
  return { ok: true, message: result.message };
}

export type PortalProductDetail = {
  listingId: string;
  parentSku: string;
  childSkus: string[];
  requestedSku: string;
  factoryName: string;
  storefrontTitle: string;
  description: string;
  aluminumMsrp: string | null;
  aluminumMsrpValue: number | null;
  surfaceProfile: SurfaceProfile;
  preserveWpGallery: boolean;
  freight: {
    weightLb: string;
    lengthIn: string;
    widthIn: string;
    heightIn: string;
  };
  media: {
    imageUrl: string | null;
    model3dGlbUrl: string | null;
  };
  spotCheckNote: string | null;
  miaApproved: boolean;
};

/** Resolve simple or grouped parent SKUs (-LS/-RS) for the dark Edit Details drawer. */
export async function getPortalProductDetail(
  rawSku: string,
): Promise<{ ok: true; detail: PortalProductDetail } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const sku = rawSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required." };

  try {
    const grouped = resolveGroupedSkuCandidates(sku);
    const candidates = [
      ...new Set([grouped.requestedSku, grouped.parentSku, ...grouped.childSkus].filter(Boolean)),
    ];
    const db = getDb();

    const listingHits = await db
      .select({
        id: ecommerce_listings.id,
        globalSku: ecommerce_listings.global_sku,
        wooSku: ecommerce_listings.woo_sku,
        productName: ecommerce_listings.product_name,
        collectionLabel: ecommerce_listings.collection_label,
        marketingDescription: ecommerce_listings.marketing_description,
        aluminumMsrp: ecommerce_listings.aluminum_msrp,
        steelMsrp: ecommerce_listings.steel_msrp,
        imageUrl: finished_goods_catalog.image_url,
        model3dGlbUrl: ecommerce_listings.model_3d_glb_url,
        attributes: sku_mappings.attributes,
      })
      .from(ecommerce_listings)
      .leftJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
      .leftJoin(
        finished_goods_catalog,
        eq(finished_goods_catalog.global_sku, ecommerce_listings.global_sku),
      )
      .where(
        or(
          inArray(ecommerce_listings.global_sku, candidates),
          inArray(ecommerce_listings.woo_sku, candidates),
        ),
      )
      .limit(12);

    const listingPicked = pickGroupedSkuRow(
      listingHits.map((h) => ({ ...h, globalSku: h.globalSku })),
      sku,
    );

    // Only emit -LS/-RS children that actually exist in Hub — never synthetics.
    const realChildren = filterExistingFacingChildren(
      grouped.parentSku,
      listingHits.map((h) => h.globalSku),
    );

    let detailBase = listingPicked.row;
    if (!detailBase) {
      const hub = await getHubProductForDrawer(sku);
      if (!hub) {
        return {
          ok: false,
          error: `Failed to load ${sku} detail: SKU not found (tried parent + -LS/-RS).`,
        };
      }
      const attrs = null;
      const surface = inferSurfaceProfile({
        productName: hub.productName,
        collectionLabel: hub.collectionLabel,
        attributes: attrs,
      });
      const [ship] = await db
        .select()
        .from(catalog_ship_profiles)
        .where(eq(catalog_ship_profiles.global_sku, hub.globalSku))
        .limit(1);
      const canonical = resolveCanonicalStorefrontPrice({
        sku: hub.globalSku,
        wooSku: hub.wooSku,
        sowName: hub.productName,
        aluminumMsrp: hub.aluminumMsrpValue,
        fixture: loadMiaAluminumFixture(),
      });
      return {
        ok: true,
        detail: {
          listingId: hub.id || "",
          parentSku: grouped.parentSku,
          childSkus: realChildren,
          requestedSku: grouped.requestedSku,
          factoryName: hub.productName,
          storefrontTitle: storefrontDisplayTitle(hub.productName),
          description: hub.marketingDescription ?? "",
          aluminumMsrp: formatCanonicalStorefrontPrice(canonical.price),
          aluminumMsrpValue: canonical.price,
          surfaceProfile: surface,
          preserveWpGallery: true,
          freight: {
            weightLb: ship?.weight_lb?.toString() ?? hub.hubWeight ?? "",
            lengthIn: ship?.length_in?.toString() ?? hub.hubLength ?? "",
            widthIn: ship?.width_in?.toString() ?? hub.hubDepth ?? "",
            heightIn: ship?.height_in?.toString() ?? hub.hubHeight ?? "",
          },
          media: {
            imageUrl: hub.imageUrl,
            model3dGlbUrl: hub.model3dGlbUrl ?? null,
          },
          spotCheckNote: spotCheckDrawerNote({
            globalSku: hub.globalSku,
            wooSku: hub.wooSku,
            attributes: null,
          }),
          miaApproved: false,
        },
      };
    }

    const attrs = (detailBase.attributes as Record<string, unknown> | null) ?? null;
    const surface = inferSurfaceProfile({
      productName: detailBase.productName,
      collectionLabel: detailBase.collectionLabel,
      attributes: attrs,
    });
    const [ship] = await db
      .select()
      .from(catalog_ship_profiles)
      .where(eq(catalog_ship_profiles.global_sku, detailBase.globalSku))
      .limit(1);

    const aluNum = parseStorefrontMoney(detailBase.aluminumMsrp);
    const canonical = resolveCanonicalStorefrontPrice({
      sku: detailBase.globalSku,
      wooSku: detailBase.wooSku,
      sowName: detailBase.productName,
      storefrontAluminumOverride: readStorefrontAluminumOverride(attrs),
      aluminumMsrp: aluNum,
      fixture: loadMiaAluminumFixture(),
    });

    return {
      ok: true,
      detail: {
        listingId: detailBase.id,
        parentSku: grouped.parentSku,
        childSkus: realChildren,
        requestedSku: grouped.requestedSku,
        factoryName: detailBase.productName,
        storefrontTitle: storefrontDisplayTitle(detailBase.productName),
        description: detailBase.marketingDescription ?? "",
        aluminumMsrp: formatCanonicalStorefrontPrice(canonical.price),
        aluminumMsrpValue: canonical.price,
        surfaceProfile: surface,
        preserveWpGallery:
          attrs?.preserve_wp_gallery === false ? false : true,
        freight: {
          weightLb: ship?.weight_lb?.toString() ?? "",
          lengthIn: ship?.length_in?.toString() ?? "",
          widthIn: ship?.width_in?.toString() ?? "",
          heightIn: ship?.height_in?.toString() ?? "",
        },
        media: {
          imageUrl: detailBase.imageUrl,
          model3dGlbUrl: detailBase.model3dGlbUrl,
        },
        spotCheckNote: spotCheckDrawerNote({
          globalSku: detailBase.globalSku,
          wooSku: detailBase.wooSku,
          attributes: attrs,
        }),
        miaApproved: readMiaApproval(attrs).approved,
      },
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: `Failed to load ${sku} detail: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

export async function savePortalProductDetail(input: {
  listingId: string;
  parentSku: string;
  storefrontTitle: string;
  description: string;
  aluminumMsrp: string | null;
  surfaceProfile: SurfaceProfile;
  preserveWpGallery: boolean;
  freight: {
    weightLb: string;
    lengthIn: string;
    widthIn: string;
    heightIn: string;
  };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const db = getDb();
  try {
    if (input.listingId) {
      const [row] = await db
        .select({
          id: ecommerce_listings.id,
          globalSku: ecommerce_listings.global_sku,
          version: ecommerce_listings.version,
          attributes: sku_mappings.attributes,
          skuVersion: sku_mappings.version,
        })
        .from(ecommerce_listings)
        .leftJoin(sku_mappings, eq(sku_mappings.global_sku, ecommerce_listings.global_sku))
        .where(eq(ecommerce_listings.id, input.listingId))
        .limit(1);
      if (!row) return { ok: false, error: "Listing not found." };

      const alu = input.aluminumMsrp
        ? Number(String(input.aluminumMsrp).replace(/[^0-9.-]+/g, ""))
        : null;
      await db
        .update(ecommerce_listings)
        .set({
          product_name: input.storefrontTitle.trim() || undefined,
          marketing_description: input.description,
          aluminum_msrp:
            alu != null && Number.isFinite(alu) ? alu.toFixed(2) : null,
          updated_at: new Date(),
          version: row.version + 1,
        })
        .where(eq(ecommerce_listings.id, input.listingId));

      const prev = (row.attributes as Record<string, unknown> | null) ?? {};
      const nextAttrs: Record<string, unknown> = {
        ...prev,
        surface_profile: input.surfaceProfile,
        preserve_wp_gallery: input.preserveWpGallery,
      };
      // Operator-saved Aluminum becomes the explicit storefront override.
      if (alu != null && Number.isFinite(alu) && alu > 0) {
        nextAttrs.storefront_aluminum_override = alu;
      }
      await db
        .update(sku_mappings)
        .set({
          attributes: nextAttrs,
          updated_at: new Date(),
          updated_by: session.email,
          version: (row.skuVersion ?? 0) + 1,
        })
        .where(eq(sku_mappings.global_sku, row.globalSku));

      await db
        .insert(catalog_ship_profiles)
        .values({
          global_sku: row.globalSku,
          weight_lb: input.freight.weightLb || null,
          length_in: input.freight.lengthIn || null,
          width_in: input.freight.widthIn || null,
          height_in: input.freight.heightIn || null,
        })
        .onConflictDoUpdate({
          target: catalog_ship_profiles.global_sku,
          set: {
            weight_lb: input.freight.weightLb || null,
            length_in: input.freight.lengthIn || null,
            width_in: input.freight.widthIn || null,
            height_in: input.freight.heightIn || null,
          },
        });
    }
    revalidatePath("/embed/admin/master-catalog");
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save product detail",
    };
  }
}

export type StagingPushKind = "swatches_scales" | "certified_catalog";
export type StagingPushMode = "catalog" | "finishes" | "sku";

export type StagingPushBatchSummary = {
  totalProducts: number;
  variationsCount: number;
  wpGalleryPreservedCount: number;
  missingDimsCount: number;
  mutationMode: "simulated" | "live";
  preserveWpGalleryWhenEmpty: true;
  skippedMissing: number;
  mode: StagingPushMode;
  sampleSku?: string | null;
};

/** Staging push under DOWNSTREAM_MUTATIONS / WOO_LEDGER_MODE guardrails (never flips env). */
export async function runPortalStagingPush(input: {
  kind: StagingPushKind;
  preserveWpImages?: boolean;
  /** Batch mode: catalog (all certified), finishes, or single sku. */
  mode?: StagingPushMode;
  sku?: string | null;
}): Promise<
  | {
      ok: true;
      simulated: boolean;
      guardrail: string;
      readiness: { finishes: number; blockers: string[] };
      summary: StagingPushBatchSummary;
      preview?: unknown;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };

  const guard = stagingPushGuardrailMessage();
  const mutationMode: "simulated" | "live" = guard.liveWrite ? "live" : "simulated";
  const preserveWpGalleryWhenEmpty = true as const;
  const seeded = await seedEcommerceFinishAssets();
  const finishes = filterActiveEcommerceFinishes(await listFinishAssets());
  const blockers: string[] = [];
  if (finishes.length < 32) {
    blockers.push(`Active finishes ${finishes.length}/32 — seed incomplete`);
  }

  const mode: StagingPushMode =
    input.mode ??
    (input.kind === "swatches_scales" ? "finishes" : input.sku ? "sku" : "catalog");

  if (mode === "finishes" || input.kind === "swatches_scales") {
    const summary: StagingPushBatchSummary = {
      totalProducts: finishes.length,
      variationsCount: 0,
      wpGalleryPreservedCount: finishes.length,
      missingDimsCount: 0,
      mutationMode,
      preserveWpGalleryWhenEmpty,
      skippedMissing: 0,
      mode: "finishes",
    };
    return {
      ok: true,
      simulated: mutationMode === "simulated",
      guardrail: guard.label,
      readiness: { finishes: finishes.length, blockers },
      summary,
      preview: {
        kind: "swatches_scales",
        finishCount: finishes.length,
        seeded,
        preserveWpImages: input.preserveWpImages !== false,
        mutationMode,
      },
    };
  }

  // Catalog / single-SKU path — HARD GATE: only Mia-certified products (never unapproved Intake).
  const roster = await getPhase1PortalRows("phase1_flat");
  const certified = roster.listings.filter((l) => l.miaApproved === true);
  const targets =
    mode === "sku" && input.sku
      ? certified.filter(
          (l) =>
            l.globalSku === input.sku!.trim().toUpperCase() ||
            (l.wooSku || "").toUpperCase() === input.sku!.trim().toUpperCase(),
        )
      : certified;

  let variationsCount = 0;
  let wpGalleryPreservedCount = 0;
  let missingDimsCount = 0;
  const allSkus = roster.listings.map((l) => l.wooSku || l.globalSku);

  for (const listing of targets) {
    const hasDims = [listing.hubWeight, listing.hubLength, listing.hubDepth, listing.hubHeight].every(
      (v) => v != null && Number(v) > 0,
    );
    if (!hasDims) missingDimsCount += 1;

    // preserveWpGalleryWhenEmpty: omit destructive empty images[] when Hub gallery is empty.
    const hasHubGallery = Boolean(listing.imageUrl);
    if (!hasHubGallery || input.preserveWpImages !== false) {
      wpGalleryPreservedCount += 1;
    }

    const facing = filterExistingFacingChildren(listing.globalSku, allSkus);
    variationsCount += facing.length >= 2 ? facing.length : 1;
  }

  // Pre-flight sample dry-run (or live push) — never abort the batch on one miss.
  let samplePreview: unknown = null;
  let skippedMissing = 0;
  const sampleSku = targets[0]?.globalSku ?? null;
  if (sampleSku) {
    if (mutationMode === "simulated") {
      const dry = await dryRunWooPushForSku(sampleSku);
      if (!dry.ok) skippedMissing += 1;
      else samplePreview = dry;
    } else {
      for (const listing of targets) {
        const live = await pushSkuToWoo(listing.globalSku);
        if (!live.ok) skippedMissing += 1;
        else if (!samplePreview) samplePreview = live;
      }
    }
  }

  const summary: StagingPushBatchSummary = {
    totalProducts: targets.length,
    variationsCount,
    wpGalleryPreservedCount,
    missingDimsCount,
    mutationMode,
    preserveWpGalleryWhenEmpty,
    skippedMissing,
    mode,
    sampleSku,
  };

  return {
    ok: true,
    simulated: mutationMode === "simulated",
    guardrail: guard.label,
    readiness: { finishes: finishes.length, blockers },
    summary,
    preview: {
      batch: true,
      summary,
      sample: samplePreview,
    },
  };
}

/** Seven-layer Executive Control Center health strip (read-only probes). */
export async function getExecutiveStackHealthAction(): Promise<
  { ok: true; health: ExecutiveStackHealth } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const checkedAt = new Date().toISOString();
    const qboLedgerMode = (process.env.QBO_LEDGER_MODE ?? "log").trim() || "log";
    const { getSystemHealthSnapshot } = await import("@/server/ops/keepalive");
    const snapshot = await getSystemHealthSnapshot();
    const dlq = await readDlqSnapshot();
    const ghl = await pingGhl();

    const db = getDb();
    await db.select({ n: count() }).from(user_roles).limit(1);

    const storageReady = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
          process.env.SUPABASE_ANON_KEY?.trim()),
    );
    let finishAssetReady = 0;
    try {
      const finishRows = await db
        .select({
          n: sql<number>`cast(count(*) filter (where ${ecommerce_finish_assets.texture_2k_url} is not null and ${ecommerce_finish_assets.texture_2k_url} <> '') as int)`,
        })
        .from(ecommerce_finish_assets);
      finishAssetReady = Number(finishRows[0]?.n ?? 0);
    } catch {
      finishAssetReady = 0;
    }
    const supabaseLayer: StackLayerPill = {
      id: "supabase",
      label: "Supabase",
      status: storageReady ? "Healthy" : "Degraded",
      detail: storageReady
        ? `PostgreSQL reachable · ${finishAssetReady}/32 Storage assets`
        : "Storage env incomplete",
      actions: [{ id: "layer_reprobe", label: "Re-Probe" }],
    };

    const { getKatanaBucketHealth } = await import("@/server/sre/katana-throttle");
    const { resolveHubSyncBadge, HUB_SYNC_STALE_MS } = await import(
      "@/server/stock/hub-sync-freshness"
    );
    const { SHOWROOM_SYNC_META_ID } = await import("@/server/stock/showroom-snapshot");
    const [syncMeta] = await db
      .select()
      .from(katana_sync_meta)
      .where(eq(katana_sync_meta.id, SHOWROOM_SYNC_META_ID))
      .limit(1);
    const lastSyncedAt = syncMeta?.last_synced_at?.toISOString?.() ?? null;
    const badge = resolveHubSyncBadge(lastSyncedAt);
    let bucketHealth: {
      tokensAvailable: number;
      cooldownMs: number;
      throttled: boolean;
    } = { tokensAvailable: 0, cooldownMs: 0, throttled: false };
    try {
      bucketHealth = await getKatanaBucketHealth();
    } catch {
      bucketHealth = { tokensAvailable: 0, cooldownMs: 0, throttled: true };
    }
    const katanaAge = snapshot.katanaSyncAge;
    const hubStale = badge.tone === "red" || badge.ageMs > HUB_SYNC_STALE_MS;
    const katanaLamp = bucketHealth.throttled || hubStale
      ? "Action Required"
      : badge.tone === "amber" || katanaAge.state === "degraded"
        ? "Degraded"
        : lampFromState(katanaAge.state === "critical" ? "critical" : "healthy");
    const katanaLayer: StackLayerPill = {
      id: "katana",
      label: "Katana MRP",
      status: katanaLamp,
      detail: [
        badge.statusLabel,
        lastSyncedAt ? `lastSyncedAt=${lastSyncedAt}` : "lastSyncedAt=never",
        `tokens=${bucketHealth.tokensAvailable.toFixed(2)}`,
        bucketHealth.throttled ? `cooldownMs=${bucketHealth.cooldownMs}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      actions: [
        { id: "katana_sync_now", label: "Run Katana Sync Now" },
        { id: "katana_reset_bucket_sync", label: "Reset Bucket & Sync Katana Now" },
      ],
    };

    const { probeLiveQboToken } = await import(
      "@/server/integrations/qbo/live-token-probe"
    );
    const qboProbe = await probeLiveQboToken();
    const qboLayer: StackLayerPill = {
      id: "qbo",
      label: "QuickBooks",
      status: qboProbe.status,
      detail: `${qboProbe.detail} · QBO_LEDGER_MODE=${qboLedgerMode} (read-only)`,
      actions: [
        { id: "qbo_reconnect", label: "Reconnect QuickBooks" },
        { id: "qbo_verify_token", label: "Verify Live QBO Token" },
      ],
    };

    const wooProbe = await testWooConnection();
    const wooLayer: StackLayerPill =
      wooProbe.ok
        ? {
            id: "woocommerce",
            label: "WooCommerce",
            status: "Healthy",
            detail: `Connected to ${wooProbe.host}`,
            actions: [
              { id: "woo_retest", label: "Re-Test Connection" },
              { id: "woo_held_orders", label: "Held Orders" },
            ],
          }
        : {
            id: "woocommerce",
            label: "WooCommerce",
            status: wooProbe.critical ? "Action Required" : "Degraded",
            // Plain English on the card — raw JSON/HTML stays in errorSnippet for <details>.
            detail: wooProbe.reason.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            errorSnippet: wooProbe.rawBody ?? wooProbe.snippet ?? null,
            actions: [
              { id: "woo_retest", label: "Re-Test Connection" },
              ...(wooProbe.diagnosticReport
                ? [{ id: "woo_copy_diagnostic", label: "Copy Diagnostic Report for PrimeView" }]
                : []),
              { id: "woo_held_orders", label: "Held Orders" },
            ],
          };

    const ghlLayer: StackLayerPill = {
      id: "ghl",
      label: "GHL CRM",
      status: !ghl.configured
        ? "Degraded"
        : ghl.ok
          ? "Healthy"
          : ghl.authFailed
            ? "Action Required"
            : "Degraded",
      detail: !ghl.configured
        ? "GHL token / location not configured"
        : ghl.ok
          ? `Connected · Location ${process.env.GHL_LOCATION_ID?.trim() || "configured"} · ${session.email ?? "operator"}`
          : ghl.authFailed
            ? `Token rejected (HTTP ${ghl.status ?? "?"})`
            : `HTTP ${ghl.status ?? "unreachable"}`,
      actions: [{ id: "layer_reprobe", label: "Re-Probe" }],
    };

    const fedexConfigured = isFedExFreightConfigured();
    const [dimsRow] = await db
      .select({
        n: sql<number>`cast(count(*) as int)`,
      })
      .from(ecommerce_listings)
      .leftJoin(
        catalog_ship_profiles,
        eq(catalog_ship_profiles.global_sku, ecommerce_listings.global_sku),
      )
      .where(
        and(
          isNull(ecommerce_listings.archived_at),
          or(
            sql`coalesce(${catalog_ship_profiles.weight_lb}, 0) <= 0`,
            sql`coalesce(${catalog_ship_profiles.length_in}, 0) <= 0`,
            sql`coalesce(${catalog_ship_profiles.width_in}, 0) <= 0`,
            sql`coalesce(${catalog_ship_profiles.height_in}, 0) <= 0`,
          ),
        ),
      );
    const missingDimsSkuCount = Number(dimsRow?.n ?? 0);

    // Credentials healthy + only catalog dims missing → Amber (Readiness Warning), not Red.
    const fedexLayer: StackLayerPill = {
      id: "fedex",
      label: "FedEx LTL",
      status: fedexConfigured
        ? missingDimsSkuCount > 0
          ? "Degraded"
          : "Healthy"
        : "Action Required",
      detail: fedexConfigured
        ? missingDimsSkuCount > 0
          ? `Readiness Warning · ${missingDimsSkuCount} SKU(s) missing freight dims`
          : "Freight dims complete"
        : "FedEx Freight credentials incomplete — Action Required",
      actions:
        fedexConfigured && missingDimsSkuCount > 0
          ? [
              {
                id: "fedex_view_missing_dims",
                label: `View ${missingDimsSkuCount} SKUs Missing Dims →`,
              },
            ]
          : undefined,
    };

    const dlqLamp =
      dlq.open === 0
        ? "Healthy"
        : dlq.unalerted > 0 || dlq.open >= 10
          ? "Action Required"
          : "Degraded";
    const inngestLayer: StackLayerPill = {
      id: "inngest_dlq",
      label: "Inngest",
      status: dlqLamp,
      detail:
        dlq.open === 0
          ? "Healthy · 0 open DLQ"
          : `${dlq.open} open DLQ failure(s)${dlq.unalerted ? ` · ${dlq.unalerted} unalerted` : ""}`,
      actions:
        dlq.open > 0
          ? [
              { id: "dlq_archive_stale", label: "Resolve / Archive Stale Test Failures" },
            ]
          : undefined,
    };

    const health: ExecutiveStackHealth = {
      checkedAt,
      layers: [
        supabaseLayer,
        katanaLayer,
        qboLayer,
        wooLayer,
        ghlLayer,
        fedexLayer,
        inngestLayer,
      ],
      heldOrderCount: snapshot.heldOrderRows.length,
      missingDimsSkuCount,
      openDlqCount: dlq.open,
      qboLedgerMode,
    };

    return { ok: true, health };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Executive stack health probe failed",
    };
  }
}

export type KatanaSyncActionOk = {
  ok: true;
  message: string;
  syncedItemsCount: number;
  lastSyncedAt: string;
  durationMs: number;
  rowCount?: number;
  clearedKeys?: string[];
};

/**
 * Inbound read-only Katana → Hub inventory pull (direct awaited).
 * NEVER gated by DOWNSTREAM_MUTATIONS (that flag only blocks outbound writes).
 */
export async function runKatanaSyncNowAction(): Promise<
  KatanaSyncActionOk | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { syncKatanaInventoryNow } = await import("@/server/stock/showroom-snapshot");
    const { runWithKatanaPriorityLane } = await import("@/lib/katana");
    const result = await runWithKatanaPriorityLane(() => syncKatanaInventoryNow());
    if (!result.ok) return result;
    return {
      ok: true,
      message: `Synced ${result.syncedItemsCount} items from Katana · just now`,
      syncedItemsCount: result.syncedItemsCount,
      lastSyncedAt: result.lastSyncedAt,
      durationMs: result.durationMs,
      rowCount: result.syncedItemsCount,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Katana inbound inventory pull failed",
    };
  }
}

/** Reset wedged shared bucket/lock, then direct awaited inbound Hub inventory sync (GET). */
export async function resetKatanaBucketAndSyncAction(): Promise<
  KatanaSyncActionOk | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const { resetBucketAndSyncKatanaNow } = await import("@/server/stock/showroom-snapshot");
  const { runWithKatanaPriorityLane } = await import("@/lib/katana");
  // Inbound GET pull — must not be blocked by DOWNSTREAM_MUTATIONS=false.
  const result = await runWithKatanaPriorityLane(() =>
    resetBucketAndSyncKatanaNow({ resetBucket: true }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `Bucket reset · synced ${result.syncedItemsCount} items from Katana · just now`,
    syncedItemsCount: result.syncedItemsCount,
    lastSyncedAt: result.lastSyncedAt,
    durationMs: result.durationMs,
    rowCount: result.syncedItemsCount,
    clearedKeys: result.clearedKeys,
  };
}

/** Live QBO CompanyInfo / token validity probe (never flips QBO_LEDGER_MODE). */
export async function verifyLiveQboTokenAction(): Promise<
  | { ok: true; message: string; companyName?: string }
  | { ok: false; error: string; reconnectRequired?: boolean }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const {
      createDefaultQboFetchDeps,
      qboFetchWithRefresh,
      QboAuthError,
    } = await import("@/server/integrations/qbo/token-refresh");
    const {
      getQboEnvironment,
      getQboTokenId,
      getQboBaseUrl,
    } = await import("@/server/integrations/qbo/client");
    const { getDb } = await import("@/server/db/client");
    const { qbo_auth_tokens } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");

    const qboEnv = getQboEnvironment();
    const targetId = getQboTokenId(qboEnv);
    const [tokenRow] = await getDb()
      .select({ realm_id: qbo_auth_tokens.realm_id, refresh_token: qbo_auth_tokens.refresh_token })
      .from(qbo_auth_tokens)
      .where(eq(qbo_auth_tokens.id, targetId))
      .limit(1);
    if (!tokenRow?.refresh_token) {
      return {
        ok: false,
        reconnectRequired: true,
        error: "No QBO refresh token stored — Reconnect Required.",
      };
    }
    if (!tokenRow.realm_id) {
      return {
        ok: false,
        reconnectRequired: true,
        error: "QBO realm missing — Reconnect Required.",
      };
    }
    const realmId = tokenRow.realm_id;
    const body = (await qboFetchWithRefresh(
      `/v3/company/${realmId}/companyinfo/${realmId}`,
      { method: "GET" },
      createDefaultQboFetchDeps({
        env: qboEnv,
        targetId,
        baseUrl: getQboBaseUrl(),
      }),
    )) as { CompanyInfo?: { CompanyName?: string } } | null;
    const companyName = body?.CompanyInfo?.CompanyName ?? "QuickBooks Company";
    return { ok: true, message: `Live QBO token valid · ${companyName}`, companyName };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "QBO verify failed — Reconnect Required";
    const reconnectRequired =
      (error instanceof Error && error.name === "QboAuthError") ||
      /401|auth|refresh|reconnect/i.test(msg);
    return { ok: false, reconnectRequired, error: msg };
  }
}

export type DlqOpenRow = {
  id: string;
  runId: string;
  functionId: string;
  eventName: string;
  errorMessage: string;
  createdAt: string;
};

export async function listOpenDlqEventsAction(): Promise<
  { ok: true; rows: DlqOpenRow[] } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { dlq_events } = await import("@/server/db/schema");
    const { desc } = await import("drizzle-orm");
    const { openDlqStatusPredicate } = await import("@/server/sre/dlq-open");
    const rows = await getDb()
      .select({
        id: dlq_events.id,
        runId: dlq_events.run_id,
        functionId: dlq_events.function_id,
        eventName: dlq_events.event_name,
        errorMessage: dlq_events.error_message,
        createdAt: dlq_events.created_at,
      })
      .from(dlq_events)
      .where(openDlqStatusPredicate())
      .orderBy(desc(dlq_events.created_at))
      .limit(50);
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        runId: r.runId,
        functionId: r.functionId,
        eventName: r.eventName,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not list DLQ events",
    };
  }
}

/** Mark a single open DLQ row resolved (operator archive / clear stale test failure). */
export async function resolveDlqEventAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { dlq_events } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb()
      .update(dlq_events)
      .set({ status: "resolved", updated_at: new Date() })
      .where(eq(dlq_events.id, id));
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not resolve DLQ event",
    };
  }
}

/** Resolve all currently open DLQ rows (stale test failures). */
export async function archiveOpenDlqEventsAction(): Promise<
  { ok: true; resolved: number } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { dlq_events } = await import("@/server/db/schema");
    const { openDlqStatusPredicate } = await import("@/server/sre/dlq-open");
    const updated = await getDb()
      .update(dlq_events)
      .set({ status: "resolved", updated_at: new Date() })
      .where(openDlqStatusPredicate())
      .returning({ id: dlq_events.id });
    return { ok: true, resolved: updated.length };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not archive DLQ events",
    };
  }
}

/** Best-effort re-send of the original Inngest event for an open DLQ row. */
export async function retryDlqEventAction(
  id: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  try {
    const { dlq_events } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb()
      .select()
      .from(dlq_events)
      .where(eq(dlq_events.id, id))
      .limit(1);
    if (!row) return { ok: false, error: "DLQ row not found" };
    const { inngest } = await import("@/server/inngest/client");
    const original = row.original_event as { name?: string; data?: unknown } | null;
    if (!original?.name) {
      return { ok: false, error: "DLQ row has no original event payload to retry" };
    }
    await inngest.send({
      name: original.name as `${string}/${string}`,
      data: (original.data as Record<string, unknown>) ?? {},
    });
    return { ok: true, message: `Re-queued ${original.name} for ${row.function_id}` };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "DLQ retry failed",
    };
  }
}

export async function buildWooDiagnosticReportAction(): Promise<
  { ok: true; report: string } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Unauthorized embed session." };
  const probe = await testWooConnection();
  const conn = resolveWooConnection();
  if (!conn.configured) {
    return { ok: false, error: conn.reason };
  }
  const report = buildWooDiagnosticReport({
    host: conn.host,
    httpStatus: probe.ok ? 200 : probe.httpStatus ?? 500,
    label: probe.ok ? "Connected" : probe.reason,
    snippet: probe.ok ? null : probe.snippet ?? null,
    checkedAt: new Date().toISOString(),
  });
  return { ok: true, report };
}
