/**
 * Phase B1: dynamic SKU authority for WooCommerce orders.
 *
 * Replaces the deleted static SKU dictionary file. Every SKU on an order is checked
 * against the LIVE hub database (`sku_mappings`, `finished_goods_catalog`, `ecommerce_listings`,
 * `product_bom`). Lookups are batched (one `sku_mappings` query per order, plus one recursive BOM
 * query per distinct base SKU) and injectable so the pure rules are testable without a database.
 *
 * Rules (operator decisions D3, D5, D6):
 *   base SKU     active, item_type finished_good, has a finished_goods_catalog row, and approved
 *                for web (sku_mappings.sync_to_woo OR a non-archived ecommerce_listings row)
 *   finish SKU   active, item_type raw_material, prefix matches the slot, attributes.web_sellable
 *   required     fabric / powder_coat / frame are REQUIRED when the base SKU's recipe carries the
 *                matching slot, and REJECTED when it does not
 *   recipe       must exist in product_bom and may contain no placeholder B1 cannot bind
 */
import { getTableName, inArray, sql, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import { explodeBomTree } from "@/server/db/queries/bom";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_mappings,
} from "@/server/db/schema";
import {
  FINISH_RULES,
  FINISH_SLOTS,
  FRAME_PLACEHOLDER_SKU,
  isGenericPlaceholderSku,
  skuPrefix,
  SUPPORTED_PLACEHOLDER_SKUS,
  type FinishSlot,
} from "./finish-keys";
import type { SkuIngressIssue, WooOrderWebhook } from "./ingress.schema";
import { extractWooLineSpecs, type WooLineSpec } from "./line-specs";

export type SkuRecord = {
  sku: string;
  itemType: string;
  isActive: boolean;
  syncToWoo: boolean;
  katanaVariantId: number | null;
  attributes: Record<string, unknown>;
  hasCatalogRow: boolean;
  hasActiveListing: boolean;
};

export type WooResolveDeps = {
  /** Batched `sku_mappings` lookup. Keys are upper-case SKUs; unknown SKUs are absent. */
  lookupSkus(skus: string[]): Promise<Map<string, SkuRecord>>;
  /** Every descendant child SKU in `product_bom` under a finished good (empty = no recipe). */
  recipeSkus(finishedGoodSku: string): Promise<string[]>;
};

export type ResolvedFinish = {
  slot: FinishSlot;
  sku: string;
  variantId: number | null;
  /** Generic recipe row the finish replaces. */
  placeholderSku: string | null;
  genericVariantId: number | null;
  /** `swap` = replace the placeholder row on the MO tree; `attribute_only` = recorded, no MO write. */
  mode: "swap" | "attribute_only";
};

export type ResolvedWooLine = {
  spec: WooLineSpec;
  baseVariantId: number | null;
  finishes: ResolvedFinish[];
};

export type WooResolution =
  | { ok: true; lines: ResolvedWooLine[] }
  | { ok: false; issues: SkuIngressIssue[] };

export type ResolveOptions = {
  /**
   * Live saga: every FINISH that will be bound on a Katana MO (and its generic placeholder) must
   * carry a `katana_variant_id`. The base SKU is exempt: the Katana SO writer resolves it via
   * `sku_mappings` and then a Katana variant lookup. Ingress validation leaves this false so a
   * not-yet-synced variant does not bounce the webhook.
   */
  requireKatanaIds: boolean;
};

const FRAME_SEGMENT = /(^|-)FRAME(-|$)/;

/** Slots a recipe offers, derived from its descendant SKUs. */
export type RecipeSlots = {
  fabric: boolean;
  powder_coat: boolean;
  frame: boolean;
  frameSwappable: boolean;
  unsupportedPlaceholders: string[];
};

export function deriveRecipeSlots(recipe: readonly string[]): RecipeSlots {
  const set = new Set(recipe.map((sku) => sku.trim().toUpperCase()));
  const frameSwappable = set.has(FRAME_PLACEHOLDER_SKU);
  return {
    fabric: set.has(FINISH_RULES.fabric.placeholderSku ?? ""),
    powder_coat: set.has(FINISH_RULES.powder_coat.placeholderSku ?? ""),
    frame: frameSwappable || [...set].some((sku) => FRAME_SEGMENT.test(sku)),
    frameSwappable,
    unsupportedPlaceholders: [...set].filter(
      (sku) => isGenericPlaceholderSku(sku) && !SUPPORTED_PLACEHOLDER_SKUS.has(sku),
    ),
  };
}

function webSellable(record: SkuRecord): boolean {
  return record.attributes?.web_sellable === true;
}

export async function resolveWooOrder(
  order: WooOrderWebhook,
  deps: WooResolveDeps,
  options: ResolveOptions,
): Promise<WooResolution> {
  const { specs, issues } = extractWooLineSpecs(order);

  const wanted = new Set<string>();
  for (const spec of specs) {
    wanted.add(spec.sku);
    for (const sku of Object.values(spec.finishes)) if (sku) wanted.add(sku);
  }
  for (const slot of FINISH_SLOTS) {
    const placeholder = FINISH_RULES[slot].placeholderSku;
    if (placeholder) wanted.add(placeholder);
  }
  const records = await deps.lookupSkus([...wanted]);

  const recipeCache = new Map<string, RecipeSlots | "empty">();
  const lines: ResolvedWooLine[] = [];

  for (const spec of specs) {
    const skuPath = `line_items.${spec.index}.sku`;
    const base = records.get(spec.sku);
    const lineIssuesBefore = issues.length;
    let baseOk = false;

    if (!base) {
      issues.push({ path: skuPath, message: `SKU ${spec.sku} is not in the hub (sku_mappings).` });
    } else if (!base.isActive) {
      issues.push({ path: skuPath, message: `SKU ${spec.sku} is inactive in the hub.` });
    } else if (base.itemType !== "finished_good") {
      issues.push({
        path: skuPath,
        message: `SKU ${spec.sku} is item_type "${base.itemType}", not a finished_good.`,
      });
    } else if (!base.hasCatalogRow) {
      issues.push({
        path: skuPath,
        message: `SKU ${spec.sku} has no finished_goods_catalog row.`,
      });
    } else if (!base.syncToWoo && !base.hasActiveListing) {
      issues.push({
        path: skuPath,
        message: `SKU ${spec.sku} is not approved for web sales (sync_to_woo is false and there is no active ecommerce listing).`,
      });
    } else {
      baseOk = true;
    }

    let slots: RecipeSlots | null = null;
    if (baseOk) {
      let cached = recipeCache.get(spec.sku);
      if (cached === undefined) {
        const recipe = await deps.recipeSkus(spec.sku);
        cached = recipe.length === 0 ? "empty" : deriveRecipeSlots(recipe);
        recipeCache.set(spec.sku, cached);
      }
      if (cached === "empty") {
        issues.push({
          path: skuPath,
          message: `SKU ${spec.sku} has no recipe in the hub (product_bom is empty); it cannot be manufactured.`,
        });
      } else if (cached.unsupportedPlaceholders.length > 0) {
        issues.push({
          path: skuPath,
          message: `SKU ${spec.sku} recipe contains placeholder(s) Phase B1 cannot bind: ${cached.unsupportedPlaceholders.join(", ")}.`,
        });
      } else {
        slots = cached;
      }
    }

    const finishes: ResolvedFinish[] = [];
    for (const slot of FINISH_SLOTS) {
      const chosen = spec.finishes[slot];
      const finishPath = `line_items.${spec.index}.finishes.${slot}`;
      const rule = FINISH_RULES[slot];

      if (slots) {
        const offered = slots[slot];
        if (!offered && chosen) {
          issues.push({
            path: finishPath,
            message: `SKU ${spec.sku} has no ${slot} slot in its recipe, but ${slot}=${chosen} was sent.`,
          });
          continue;
        }
        if (offered && !chosen) {
          issues.push({
            path: finishPath,
            message: `SKU ${spec.sku} requires a ${slot} finish. None was sent.`,
          });
          continue;
        }
      }
      if (!chosen) continue;

      const finish = records.get(chosen);
      if (!finish) {
        issues.push({ path: finishPath, message: `${slot} ${chosen} is not in the hub (sku_mappings).` });
        continue;
      }
      if (!finish.isActive) {
        issues.push({ path: finishPath, message: `${slot} ${chosen} is inactive in the hub.` });
        continue;
      }
      if (finish.itemType !== "raw_material") {
        issues.push({
          path: finishPath,
          message: `${slot} ${chosen} is item_type "${finish.itemType}", not a raw_material.`,
        });
        continue;
      }
      if (skuPrefix(chosen) !== rule.requiredPrefix) {
        issues.push({
          path: finishPath,
          message: `${slot} must be a ${rule.requiredPrefix}-* SKU. Received ${chosen}.`,
        });
        continue;
      }
      if (!webSellable(finish)) {
        issues.push({
          path: finishPath,
          message: `${slot} ${chosen} is not web_sellable (attributes.web_sellable is not true).`,
        });
        continue;
      }

      const swappable =
        slot === "frame" ? Boolean(slots?.frameSwappable) : rule.placeholderSku !== null;
      const placeholderRecord = rule.placeholderSku
        ? records.get(rule.placeholderSku)
        : undefined;
      const genericVariantId = placeholderRecord?.katanaVariantId ?? null;

      if (options.requireKatanaIds) {
        if (finish.katanaVariantId === null) {
          issues.push({
            path: finishPath,
            message: `${slot} ${chosen} has no katana_variant_id; it cannot be bound to the MO.`,
          });
          continue;
        }
        if (swappable && genericVariantId === null) {
          issues.push({
            path: finishPath,
            message: `Placeholder ${rule.placeholderSku} has no katana_variant_id in the hub; ${slot} cannot be swapped.`,
          });
          continue;
        }
      }

      finishes.push({
        slot,
        sku: chosen,
        variantId: finish.katanaVariantId,
        placeholderSku: swappable ? rule.placeholderSku : null,
        genericVariantId: swappable ? genericVariantId : null,
        mode: swappable ? "swap" : "attribute_only",
      });
    }

    if (issues.length === lineIssuesBefore) {
      lines.push({
        spec,
        baseVariantId: base?.katanaVariantId ?? null,
        finishes,
      });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, lines };
}

// ---------------------------------------------------------------------------
// Live database dependencies
// ---------------------------------------------------------------------------

/** `"table"."column"`, always qualified (see the correlation note in `lookupSkusFromHub`). */
function qualified(table: PgTable, column: AnyColumn) {
  return sql.raw(`"${getTableName(table)}"."${column.name}"`);
}

export async function lookupSkusFromHub(skus: string[]): Promise<Map<string, SkuRecord>> {
  const out = new Map<string, SkuRecord>();
  if (skus.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      itemType: sku_mappings.item_type,
      isActive: sku_mappings.is_active,
      syncToWoo: sku_mappings.sync_to_woo,
      katanaVariantId: sku_mappings.katana_variant_id,
      attributes: sku_mappings.attributes,
      // Columns are qualified explicitly: in a single-table select Drizzle renders interpolated
      // columns UNQUALIFIED, which would turn the correlation into `global_sku = global_sku` on
      // the inner table (always true). Proven against real Postgres in woo-sku-resolver-pglite.
      hasCatalogRow: sql<boolean>`exists (select 1 from ${finished_goods_catalog} where ${qualified(finished_goods_catalog, finished_goods_catalog.global_sku)} = ${qualified(sku_mappings, sku_mappings.global_sku)})`,
      hasActiveListing: sql<boolean>`exists (select 1 from ${ecommerce_listings} where ${qualified(ecommerce_listings, ecommerce_listings.global_sku)} = ${qualified(sku_mappings, sku_mappings.global_sku)} and ${qualified(ecommerce_listings, ecommerce_listings.archived_at)} is null)`,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, skus));

  for (const row of rows) {
    out.set(row.sku.toUpperCase(), {
      sku: row.sku,
      itemType: row.itemType,
      isActive: row.isActive,
      syncToWoo: row.syncToWoo,
      katanaVariantId: row.katanaVariantId ?? null,
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
      hasCatalogRow: Boolean(row.hasCatalogRow),
      hasActiveListing: Boolean(row.hasActiveListing),
    });
  }
  return out;
}

export async function recipeSkusFromHub(finishedGoodSku: string): Promise<string[]> {
  const rows = await explodeBomTree(finishedGoodSku);
  return rows.map((row) => row.child_sku);
}

export function hubResolveDeps(): WooResolveDeps {
  return { lookupSkus: lookupSkusFromHub, recipeSkus: recipeSkusFromHub };
}
