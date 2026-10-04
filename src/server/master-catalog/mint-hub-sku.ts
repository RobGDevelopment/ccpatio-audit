/**
 * Mint a hub SKU from an E-Commerce roster gap (Master Catalog inline-editing
 * blueprint). Runs entirely inside the caller's transaction so a failure at any
 * step leaves nothing behind. Writes ONLY to the local hub tables: no Katana,
 * no WooCommerce, no CAD upload, no product_bom.
 */
import { asc, eq, inArray, max, sql } from "drizzle-orm";
import type { getDb } from "@/server/db/client";
import {
  ecommerce_listings,
  ecommerce_roster_gaps,
  finished_goods_catalog,
  sku_mappings,
  type EcommerceListingRow,
} from "@/server/db/schema";
import { deriveCollection, sharedCanonicalPatches } from "@/lib/ecommerce-roster";

type Db = ReturnType<typeof getDb>;
export type HubTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface MintResult {
  /** Newly created listings, with their final canonical_sku_shared value. */
  inserted: EcommerceListingRow[];
  /** Shared-flag changes for listings that already existed on this hub SKU. */
  sharedPatches: { id: string; canonicalSkuShared: boolean }[];
  /** Every gap name that was promoted (and deleted). */
  promotedGapNames: string[];
}

export async function mintHubSkuInTx(
  tx: HubTx,
  globalSkuRaw: string,
): Promise<MintResult> {
  // 1. Normalize and load every gap sharing this SKU.
  const sku = globalSkuRaw.trim().toUpperCase();
  const gaps = sku
    ? await tx
        .select()
        .from(ecommerce_roster_gaps)
        .where(sql`upper(${ecommerce_roster_gaps.global_sku}) = ${sku}`)
        .orderBy(asc(ecommerce_roster_gaps.product_name))
    : [];
  if (gaps.length === 0) throw new Error("Gap not found");
  const names = gaps.map((g) => g.product_name);
  const firstName = names[0];

  // 2. sku_mappings (finished_good) if absent.
  await tx
    .insert(sku_mappings)
    .values({
      global_sku: sku,
      category: deriveCollection(firstName, sku),
      item_type: "finished_good",
      original_name: firstName,
      source_file: "master-catalog-gap-mint",
      is_active: true,
    })
    .onConflictDoNothing();

  // 3. finished_goods_catalog if absent. msrp stays null (never "$0.00").
  await tx
    .insert(finished_goods_catalog)
    .values({ global_sku: sku })
    .onConflictDoNothing();

  // 4. One listing per gap name that is not already a listing.
  const already = await tx
    .select({ name: ecommerce_listings.product_name })
    .from(ecommerce_listings)
    .where(inArray(ecommerce_listings.product_name, names));
  const alreadySet = new Set(already.map((r) => r.name));
  const toInsert = names.filter((n) => !alreadySet.has(n));

  const [{ top }] = await tx
    .select({ top: max(ecommerce_listings.sheet_order) })
    .from(ecommerce_listings);
  const base = top ?? 0;

  let inserted: EcommerceListingRow[] = [];
  if (toInsert.length > 0) {
    inserted = await tx
      .insert(ecommerce_listings)
      .values(
        toInsert.map((name, i) => ({
          global_sku: sku,
          product_name: name,
          steel_msrp: null,
          drawing_section: "Uncategorized",
          collection_label: deriveCollection(name, sku),
          sheet_order: base + 1 + i,
          url_source: "missing",
          url_operator_set: false,
          legacy_operator_set: false,
        })),
      )
      .returning();
  }

  // canonical_sku_shared across the new rows plus listings already on this SKU.
  const onSku = await tx
    .select({
      id: ecommerce_listings.id,
      productName: ecommerce_listings.product_name,
      globalSku: ecommerce_listings.global_sku,
      canonicalSkuShared: ecommerce_listings.canonical_sku_shared,
    })
    .from(ecommerce_listings)
    .where(eq(ecommerce_listings.global_sku, sku));
  const patches = sharedCanonicalPatches(onSku);
  for (const p of patches) {
    await tx
      .update(ecommerce_listings)
      .set({ canonical_sku_shared: p.canonicalSkuShared, updated_at: new Date() })
      .where(eq(ecommerce_listings.id, p.id));
  }
  const patchById = new Map(patches.map((p) => [p.id, p.canonicalSkuShared]));
  const insertedIds = new Set(inserted.map((r) => r.id));
  inserted = inserted.map((r) => ({
    ...r,
    canonical_sku_shared: patchById.get(r.id) ?? r.canonical_sku_shared,
  }));

  // 5. Promote: delete the gap rows.
  await tx
    .delete(ecommerce_roster_gaps)
    .where(inArray(ecommerce_roster_gaps.product_name, names));

  // 6. Result.
  return {
    inserted,
    sharedPatches: patches.filter((p) => !insertedIds.has(p.id)),
    promotedGapNames: names,
  };
}
