"use server";

import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
  quarantine_catalog,
  ecommerce_listings,
  ecommerce_roster_gaps,
} from "@/server/db/schema";
import { eq, desc, asc, count } from "drizzle-orm";
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
  msrp: string;
  /** Numeric steel MSRP for sorting. */
  msrpValue: number;
  aluminumMsrp: string | null;
  marketingDescription: string | null;
  constructionDetails: string | null;
  sheetOrder: number;
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

  const listings: EcommerceListing[] = rows.map((r) => ({
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
    msrp: formatMoney(r.msrp),
    msrpValue: parsePrice(r.msrp ?? "") || 0,
    aluminumMsrp: r.aluminumMsrp ? formatMoney(r.aluminumMsrp) : null,
    marketingDescription: r.marketingDescription,
    constructionDetails: r.constructionDetails,
    sheetOrder: r.sheetOrder,
  }));

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
