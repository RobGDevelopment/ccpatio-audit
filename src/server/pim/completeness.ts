import { type FactoryReadiness } from "@/server/factory-bom/derive-readiness";
import { getDb } from "@/server/db/client";
import { eq, inArray } from "drizzle-orm";
import {
  sku_mappings,
  finished_goods_catalog,
  ecommerce_listings,
  product_assets,
  third_party_sources,
  catalog_ship_profiles,
} from "@/server/db/schema";
import { getVaultStorage } from "@/lib/supabase-storage";
import sharp from "sharp";

/** Hero gate: longest side at least 1200px. A failed download does not count. */
async function primaryImageQualifies(storagePath: string): Promise<boolean> {
  try {
    const storage = getVaultStorage();
    const res = await storage.download("product-images", storagePath);
    if (!("bytes" in res) || !res.bytes) return false;
    const meta = await sharp(Buffer.from(res.bytes)).metadata();
    return Math.max(meta.width || 0, meta.height || 0) >= 1200;
  } catch (err) {
    console.error("Failed to check primary image size", err);
    return false;
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  if (items.length === 0) return out;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export type CompletenessSnapshot = {
  globalSku: string;
  origin: "manufactured" | "third_party" | null;
  productName: string | null;
  collectionLabel: string | null;
  steelMsrp: string | null;
  aluminumMsrp: string | null;
  retailMsrp: string | null;
  marketingDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  slug: string | null;
  isWebVisible: boolean;
  length: string | null;
  depth: string | null;
  height: string | null;
  armHeight: string | null;
  sitHeight: string | null;
  assemblyRequired: boolean;
  warrantyTermMonths: number | null;
  naFields: string[];
  shipProfile: {
    weightLb: string | null;
    ltlClass: string | null;
    shipMode: string | null;
    lengthIn: string | null;
    widthIn: string | null;
    heightIn: string | null;
  } | null;
  thirdParty: {
    vendorName: string | null;
    vendorSku: string | null;
    wholesaleCost: string | null;
  } | null;
  factoryState: string;
  assets: {
    hasPrimary: boolean;
    hasCare: boolean;
    hasWarranty: boolean;
    hasAssembly: boolean;
  };
}

export async function buildCompletenessSnapshot(tx: any, globalSku: string, listingId: string, factoryState: string, payload: any = {}): Promise<CompletenessSnapshot> {
  const [[map], [cat], [list], [ship], [tp], assets] = await Promise.all([
    tx.select().from(sku_mappings).where(eq(sku_mappings.global_sku, globalSku)),
    tx.select().from(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, globalSku)),
    listingId
      ? tx.select().from(ecommerce_listings).where(eq(ecommerce_listings.id, listingId))
      : Promise.resolve([]),
    tx.select().from(catalog_ship_profiles).where(eq(catalog_ship_profiles.global_sku, globalSku)),
    tx.select().from(third_party_sources).where(eq(third_party_sources.global_sku, globalSku)),
    tx.select().from(product_assets).where(eq(product_assets.global_sku, globalSku)),
  ]);

  // Merge payload overrides for things that change in the same request
  const mergedCat = { ...cat, ...payload }; // naFields, height, weight etc might be in payload

  const primaryImage = assets.find((a: any) => a.kind === "primary_image" && a.is_current);
  const hasPrimary = primaryImage ? await primaryImageQualifies(primaryImage.storage_path) : false;

  return {
    globalSku,
    origin: map?.product_origin ?? null,
    productName: list?.product_name ?? null,
    collectionLabel: list?.collection_label ?? null,
    steelMsrp: list?.steel_msrp ?? null,
    aluminumMsrp: list?.aluminum_msrp ?? null,
    retailMsrp: list?.steel_msrp ?? null,
    marketingDescription: list?.marketing_description ?? null,
    seoTitle: payload?.seoTitle ?? list?.seo_title ?? null,
    seoDescription: payload?.seoDescription ?? list?.seo_description ?? null,
    slug: payload?.slug ?? list?.slug ?? null,
    isWebVisible: mergedCat?.is_web_visible ?? cat?.is_web_visible ?? false,
    length: mergedCat?.length ?? null,
    depth: mergedCat?.depth ?? null,
    height: mergedCat?.height ?? null,
    armHeight: mergedCat?.arm_height ?? null,
    sitHeight: mergedCat?.sit_height ?? null,
    assemblyRequired: mergedCat?.assembly_required ?? false,
    warrantyTermMonths: mergedCat?.warranty_term_months ?? null,
    naFields: mergedCat?.naFields ?? mergedCat?.na_fields ?? [],
    shipProfile: ship ? {
      weightLb: ship.weight_lb,
      ltlClass: ship.ltl_class,
      shipMode: ship.ship_mode,
      lengthIn: ship.length_in,
      widthIn: ship.width_in,
      heightIn: ship.height_in,
    } : null,
    thirdParty: tp ? {
      vendorName: tp.vendor_name,
      vendorSku: tp.vendor_sku,
      wholesaleCost: tp.wholesale_cost,
    } : null,
    factoryState,
    assets: {
      hasPrimary,
      hasCare: assets.some((a: any) => a.kind === "care_guide" && a.is_current),
      hasWarranty: assets.some((a: any) => a.kind === "warranty" && a.is_current),
      hasAssembly: assets.some((a: any) => a.kind === "assembly" && a.is_current),
    },
  };
}

export async function batchCompletenessSnapshots(
  tx: any,
  items: { globalSku: string, listingId: string, factoryState: string, payload?: any }[]
): Promise<CompletenessSnapshot[]> {
  if (items.length === 0) return [];
  const skus = items.map(i => i.globalSku);
  const listingIds = items.map(i => i.listingId).filter(Boolean);

  const [maps, cats, lists, ships, tps, assets] = await Promise.all([
    tx.select().from(sku_mappings).where(inArray(sku_mappings.global_sku, skus)),
    tx.select().from(finished_goods_catalog).where(inArray(finished_goods_catalog.global_sku, skus)),
    listingIds.length ? tx.select().from(ecommerce_listings).where(inArray(ecommerce_listings.id, listingIds)) : Promise.resolve([]),
    tx.select().from(catalog_ship_profiles).where(inArray(catalog_ship_profiles.global_sku, skus)),
    tx.select().from(third_party_sources).where(inArray(third_party_sources.global_sku, skus)),
    tx.select().from(product_assets).where(inArray(product_assets.global_sku, skus)),
  ]);

  const mapBySku = new Map(maps.map((m: any) => [m.global_sku, m]));
  const catBySku = new Map(cats.map((c: any) => [c.global_sku, c]));
  const listById = new Map(lists.map((l: any) => [l.id, l]));
  const shipBySku = new Map(ships.map((s: any) => [s.global_sku, s]));
  const tpBySku = new Map(tps.map((t: any) => [t.global_sku, t]));
  const assetsBySku = new Map<string, any[]>();
  for (const a of assets) {
    if (!assetsBySku.has(a.global_sku)) assetsBySku.set(a.global_sku, []);
    assetsBySku.get(a.global_sku)!.push(a);
  }

  const heroOk = await mapPool(items, 8, async (item) => {
    const itemAssets = assetsBySku.get(item.globalSku) || [];
    const primaryImage = itemAssets.find((a: any) => a.kind === "primary_image" && a.is_current);
    return primaryImage ? primaryImageQualifies(primaryImage.storage_path) : false;
  });

  const results: CompletenessSnapshot[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const map = mapBySku.get(item.globalSku) || {} as any;
    const cat = catBySku.get(item.globalSku) || {} as any;
    const list = listById.get(item.listingId) || {} as any;
    const ship = shipBySku.get(item.globalSku) || {} as any;
    const tp = tpBySku.get(item.globalSku) || {} as any;
    const itemAssets = assetsBySku.get(item.globalSku) || [];

    const payload = item.payload || {};
    const mergedCat = { ...cat, ...payload };
    const hasPrimary = heroOk[index];

    results.push({
      globalSku: item.globalSku,
      origin: map?.product_origin ?? null,
      productName: list?.product_name ?? null,
      collectionLabel: list?.collection_label ?? null,
      steelMsrp: list?.steel_msrp ?? null,
      aluminumMsrp: list?.aluminum_msrp ?? null,
      retailMsrp: list?.steel_msrp ?? null,
      marketingDescription: list?.marketing_description ?? null,
      seoTitle: list?.seo_title ?? null,
      seoDescription: list?.seo_description ?? null,
      slug: list?.slug ?? null,
      isWebVisible: Boolean(mergedCat?.is_web_visible),
      length: mergedCat?.length ?? null,
      depth: mergedCat?.depth ?? null,
      height: mergedCat?.height ?? null,
      armHeight: mergedCat?.arm_height ?? null,
      sitHeight: mergedCat?.sit_height ?? null,
      assemblyRequired: Boolean(mergedCat?.assembly_required),
      warrantyTermMonths: mergedCat?.warranty_term_months ?? null,
      naFields: Array.isArray(mergedCat?.na_fields) ? mergedCat.na_fields : [],
      shipProfile: Object.keys(ship).length ? {
        weightLb: ship.weight_lb ?? null,
        ltlClass: ship.ltl_class ?? null,
        shipMode: ship.ship_mode ?? null,
        lengthIn: ship.length_in ?? null,
        widthIn: ship.width_in ?? null,
        heightIn: ship.height_in ?? null,
      } : null,
      thirdParty: Object.keys(tp).length ? {
        vendorName: tp.vendor_name ?? null,
        vendorSku: tp.vendor_sku ?? null,
        wholesaleCost: tp.wholesale_cost ?? null,
      } : null,
      factoryState: item.factoryState,
      assets: {
        hasPrimary,
        hasCare: itemAssets.some((a: any) => a.kind === "care_guide" && a.is_current),
        hasWarranty: itemAssets.some((a: any) => a.kind === "warranty" && a.is_current),
        hasAssembly: itemAssets.some((a: any) => a.kind === "assembly" && a.is_current),
      }
    });
  }

  return results;
}

export function scoreProduct(snap: CompletenessSnapshot): {
  score: number;
  gates: { id: string; passed: boolean; reason?: string }[];
  canSyncWoo: boolean;
  canSyncClover: boolean;
  /** Hero N/A is legal only for a third-party product that is not web-visible. */
  heroNaAllowed: boolean;
} {
  const is3P = snap.origin === "third_party";
  const na = new Set(snap.naFields || []);
  const heroNaAllowed = is3P && snap.isWebVisible === false;

  const gates = [
    // 1. Identity
    {
      id: "identity",
      passed: is3P
        ? snap.globalSku.startsWith("3P-") && !!snap.productName && !!snap.collectionLabel
        : snap.globalSku.startsWith("FIN-") && !!snap.productName && !!snap.collectionLabel,
    },
    // 2. Origin contract
    {
      id: "origin",
      passed: is3P
        ? !!snap.thirdParty?.vendorName && !!snap.thirdParty?.vendorSku && !!snap.thirdParty?.wholesaleCost
        : snap.origin === "manufactured",
    },
    // 3. Retail price
    {
      id: "price",
      passed: is3P
        ? !!snap.retailMsrp
        : ((!!snap.steelMsrp || na.has("steel_msrp")) && (!!snap.aluminumMsrp || na.has("aluminum_msrp"))) && (!!snap.steelMsrp || !!snap.aluminumMsrp),
    },
    // 4. Story
    {
      id: "story",
      passed: !!snap.marketingDescription,
    },
    // 5. SEO
    {
      id: "seo",
      passed: !!snap.seoTitle && snap.seoTitle.length <= 60 && !!snap.seoDescription && snap.seoDescription.length <= 160 && !!snap.slug,
    },
    // 6. Hero
    {
      id: "hero",
      passed: snap.assets.hasPrimary || (na.has("primary_image") && heroNaAllowed),
    },
    // 7. Display specs
    {
      id: "specs",
      passed: !!snap.length && !!snap.depth && (!!snap.height || na.has("height")) && (!!snap.armHeight || na.has("arm_height")) && (!!snap.sitHeight || na.has("sit_height")),
    },
    // 8. Freight
    {
      id: "freight",
      passed: snap.shipProfile?.shipMode === "not_shipped" || (
        !!snap.shipProfile &&
        !!snap.shipProfile.shipMode &&
        ["ltl", "parcel", "white_glove_only"].includes(snap.shipProfile.shipMode) &&
        !!snap.shipProfile.weightLb &&
        !!snap.shipProfile.ltlClass &&
        !!snap.shipProfile.lengthIn &&
        !!snap.shipProfile.widthIn &&
        !!snap.shipProfile.heightIn
      ),
    },
    // 9. Factory
    {
      id: "factory",
      passed: is3P || ["draft_pending", "factory_approved", "published"].includes(snap.factoryState),
    },
    // 10. Customer packet
    {
      id: "customer_packet",
      passed: (() => {
        if (!snap.assets.hasCare && snap.shipProfile?.shipMode !== "not_shipped") return false;
        if (!snap.assets.hasWarranty && !na.has("warranty")) return false;
        if (snap.assets.hasWarranty && snap.warrantyTermMonths == null) return false;
        if (snap.assemblyRequired && !snap.assets.hasAssembly) return false;
        if (!snap.assemblyRequired && !na.has("assembly")) return false;
        return true;
      })(),
    }
  ];

  const passedCount = gates.filter((g) => g.passed).length;
  const score = passedCount * 10;

  // Channel Mask
  const canSyncClover = score === 100;
  const canSyncWoo = score === 100 && snap.assets.hasPrimary && snap.isWebVisible;

  return { score, gates, canSyncWoo, canSyncClover, heroNaAllowed };
}
