/**
 * Phase B1 / pipe-hardening: dynamic SKU authority for WooCommerce orders.
 *
 * Every SKU on an order is checked against the LIVE hub database (`sku_mappings`,
 * `finished_goods_catalog`, `ecommerce_listings`, `product_bom`, `sku_aliases`,
 * `third_party_sources`). Lookups are batched and injectable so the pure rules are
 * testable without a database.
 *
 * Pipe-hardening upgrades:
 *   - `sku_aliases` pre-resolution (alias_sku → canonical_sku) before Hub authority
 *   - `^FRM-` frame recognition + Dekton slot (`RM-DKT-GENERIC-SLAB` / `dekton` meta)
 *   - structured ACF add-on resolution (mapped SKU → SO line; unmapped → quarantine)
 *   - `third_party_sources` resale: empty BOM allowed; MO/finish-bind skipped downstream
 */
import { eq, getTableName, inArray, sql, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db/client";
import { explodeBomTree } from "@/server/db/queries/bom";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_aliases,
  sku_mappings,
  third_party_sources,
} from "@/server/db/schema";
import {
  FINISH_RULES,
  FINISH_SLOTS,
  FRAME_PLACEHOLDER_SKU,
  isGenericPlaceholderSku,
  normalizeSku,
  skuPrefix,
  SUPPORTED_PLACEHOLDER_SKUS,
  type FinishSlot,
} from "./finish-keys";
import type { SkuIngressIssue, WooOrderWebhook } from "./ingress.schema";
import {
  ACF_ADDON_DEFAULT_SKUS,
  extractWooLineSpecs,
  type WooLineAddon,
  type WooLineSpec,
} from "./line-specs";
import {
  isProvisionalShell,
  PROVISIONAL_RECIPE,
} from "@/server/ecommerce/provisional-shell";

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

export type ResolvedAddon = {
  key: string;
  sku: string;
  variantId: number | null;
};

export type WooResolveDeps = {
  /** Batched `sku_mappings` lookup. Keys are upper-case SKUs; unknown SKUs are absent. */
  lookupSkus(skus: string[]): Promise<Map<string, SkuRecord>>;
  /** Every descendant child SKU in `product_bom` under a finished good (empty = no recipe). */
  recipeSkus(finishedGoodSku: string): Promise<string[]>;
  /**
   * Map alias SKUs → canonical Hub SKUs (`sku_aliases`). Missing keys stay as-sent.
   * Optional for legacy fakes; live deps always provide it.
   */
  resolveAliases?(skus: string[]): Promise<Map<string, string>>;
  /** True when a `third_party_sources` row exists for the canonical SKU (resale / no MO). */
  isThirdParty?(sku: string): Promise<boolean>;
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
  /** Mapped ACF add-ons that become extra Katana SO rows. */
  addons: ResolvedAddon[];
  /** Resale: `third_party_sources` present — create SO, skip MO + finish binding. */
  skipMo: boolean;
  /**
   * Make SKU with `attributes.bom_status = provisional_shell` and an empty
   * `product_bom` tree — resolves against RM-FAB-GENERIC / RM-PWD-GENERIC
   * instead of quarantining.
   */
  provisionalShell: boolean;
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

/** Legacy FRAME segment OR modular `FRM-*` children (Star Leg / Waterfall frames). */
const FRAME_SEGMENT = /(^|-)FRAME(-|$)/;
const FRM_PREFIX = /^FRM-/;

export function isFrameBearingSku(sku: string): boolean {
  const upper = sku.trim().toUpperCase();
  return FRAME_SEGMENT.test(upper) || FRM_PREFIX.test(upper);
}

/** Slots a recipe offers, derived from its descendant SKUs. */
export type RecipeSlots = {
  fabric: boolean;
  powder_coat: boolean;
  frame: boolean;
  dekton: boolean;
  frameSwappable: boolean;
  /**
   * Powder row to swap on the MO tree: prefer `RM-PWD-GENERIC`, else the first hardcoded
   * `PWD-*` Ready-Make component (66 legacy recipes). `null` when no powder slot.
   */
  powderPlaceholderSku: string | null;
  unsupportedPlaceholders: string[];
};

/** First hardcoded `PWD-*` recipe row (excludes `RM-PWD-GENERIC`). */
export function findHardcodedPowderSku(recipe: readonly string[]): string | null {
  for (const raw of recipe) {
    const sku = raw.trim().toUpperCase();
    if (/^PWD-/.test(sku)) return sku;
  }
  return null;
}

export function deriveRecipeSlots(recipe: readonly string[]): RecipeSlots {
  const set = new Set(recipe.map((sku) => sku.trim().toUpperCase()));
  const frameSwappable = set.has(FRAME_PLACEHOLDER_SKU);
  const powderGeneric = FINISH_RULES.powder_coat.placeholderSku ?? "";
  const hasPowderGeneric = Boolean(powderGeneric && set.has(powderGeneric));
  const hardcodedPowder = findHardcodedPowderSku([...set]);
  return {
    fabric: set.has(FINISH_RULES.fabric.placeholderSku ?? ""),
    powder_coat: hasPowderGeneric || hardcodedPowder !== null,
    frame: frameSwappable || [...set].some((sku) => isFrameBearingSku(sku)),
    dekton: set.has(FINISH_RULES.dekton.placeholderSku ?? ""),
    frameSwappable,
    powderPlaceholderSku: hasPowderGeneric
      ? powderGeneric
      : hardcodedPowder,
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
  const aliasCache = new Map<string, string>();

  // Pre-resolve every line SKU (and finish SKUs) through sku_aliases before Hub authority.
  const aliasNeedles = new Set<string>();
  for (const spec of specs) {
    aliasNeedles.add(spec.sku);
    for (const sku of Object.values(spec.finishes)) if (sku) aliasNeedles.add(sku);
    for (const addon of spec.addons) if (addon.sku) aliasNeedles.add(addon.sku);
  }
  if (deps.resolveAliases && aliasNeedles.size > 0) {
    const map = await deps.resolveAliases([...aliasNeedles]);
    for (const [alias, canonical] of map) aliasCache.set(alias, canonical);
  }

  const rewritten: WooLineSpec[] = specs.map((spec) => {
    const finishes: WooLineSpec["finishes"] = {};
    for (const slot of FINISH_SLOTS) {
      const raw = spec.finishes[slot];
      if (raw) finishes[slot] = aliasCache.get(raw) ?? raw;
    }
    const addons: WooLineAddon[] = spec.addons.map((a) => {
      // Truthy ACF checkboxes may arrive as sku:null; map through defaults before Hub lookup.
      const mapped =
        a.sku ??
        (ACF_ADDON_DEFAULT_SKUS[a.key]
          ? normalizeSku(ACF_ADDON_DEFAULT_SKUS[a.key]!)
          : null);
      if (!mapped) return { ...a, sku: null };
      const canonical = aliasCache.get(mapped) ?? mapped;
      return { ...a, sku: canonical };
    });
    return {
      ...spec,
      sku: aliasCache.get(spec.sku) ?? spec.sku,
      finishes,
      addons,
    };
  });

  const wanted = new Set<string>();
  for (const spec of rewritten) {
    wanted.add(spec.sku);
    for (const sku of Object.values(spec.finishes)) if (sku) wanted.add(sku);
    for (const addon of spec.addons) if (addon.sku) wanted.add(addon.sku);
  }
  for (const slot of FINISH_SLOTS) {
    const placeholder = FINISH_RULES[slot].placeholderSku;
    if (placeholder) wanted.add(placeholder);
  }
  const records = await deps.lookupSkus([...wanted]);

  const recipeCache = new Map<string, RecipeSlots | "empty">();
  const tpsCache = new Map<string, boolean>();
  const lines: ResolvedWooLine[] = [];

  const isResale = async (sku: string): Promise<boolean> => {
    if (tpsCache.has(sku)) return tpsCache.get(sku)!;
    const flag = deps.isThirdParty ? await deps.isThirdParty(sku) : false;
    tpsCache.set(sku, flag);
    return flag;
  };

  for (const spec of rewritten) {
    const skuPath = `line_items.${spec.index}.sku`;
    const base = records.get(spec.sku);
    const lineIssuesBefore = issues.length;
    let baseOk = false;
    const skipMo = await isResale(spec.sku);

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
    let provisionalShell = false;
    if (baseOk && !skipMo) {
      let cached = recipeCache.get(spec.sku);
      if (cached === undefined) {
        const recipe = await deps.recipeSkus(spec.sku);
        cached = recipe.length === 0 ? "empty" : deriveRecipeSlots(recipe);
        recipeCache.set(spec.sku, cached);
      }
      if (cached === "empty" && base && isProvisionalShell(base.attributes)) {
        provisionalShell = true;
        cached = deriveRecipeSlots([...PROVISIONAL_RECIPE]);
        recipeCache.set(spec.sku, cached);
        const extra = await deps.lookupSkus([...PROVISIONAL_RECIPE]);
        for (const [k, v] of extra) records.set(k, v);
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
        // Hardcoded Ready-Make powder rows need their katana_variant_id for swaps.
        const powderPh = slots.powderPlaceholderSku;
        if (powderPh && !records.has(powderPh)) {
          const extra = await deps.lookupSkus([powderPh]);
          for (const [k, v] of extra) records.set(k, v);
        }
      }
    }

    const finishes: ResolvedFinish[] = [];
    if (!skipMo) {
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

        // Effective placeholder: powder prefers RM-PWD-GENERIC, else hardcoded PWD-* on Ready Makes.
        const effectivePlaceholderSku =
          slot === "powder_coat"
            ? (slots?.powderPlaceholderSku ?? null)
            : slot === "frame"
              ? slots?.frameSwappable
                ? FRAME_PLACEHOLDER_SKU
                : null
              : rule.placeholderSku;

        // Identical selection vs hardcoded powder (or generic already bound) → no MO write.
        const identicalToPlaceholder =
          effectivePlaceholderSku !== null && chosen === effectivePlaceholderSku;
        const swappable = effectivePlaceholderSku !== null && !identicalToPlaceholder;
        const placeholderRecord = effectivePlaceholderSku
          ? records.get(effectivePlaceholderSku)
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
              message: `Placeholder ${effectivePlaceholderSku} has no katana_variant_id in the hub; ${slot} cannot be swapped.`,
            });
            continue;
          }
        }

        finishes.push({
          slot,
          sku: chosen,
          variantId: finish.katanaVariantId,
          placeholderSku: swappable ? effectivePlaceholderSku : null,
          genericVariantId: swappable ? genericVariantId : null,
          mode: swappable ? "swap" : "attribute_only",
        });
      }
    }

    const resolvedAddons: ResolvedAddon[] = [];
    for (const addon of spec.addons) {
      const addonPath = `line_items.${spec.index}.addons.${addon.key}`;
      if (!addon.sku) {
        issues.push({
          path: addonPath,
          message: `Add-on "${addon.key}" is selected but has no mapped add-on SKU. Send the add-on SKU in meta_data (not only "1").`,
        });
        continue;
      }
      const rec = records.get(addon.sku);
      if (!rec) {
        issues.push({
          path: addonPath,
          message: `Add-on "${addon.key}" SKU ${addon.sku} is not in the hub (sku_mappings).`,
        });
        continue;
      }
      if (!rec.isActive) {
        issues.push({ path: addonPath, message: `Add-on SKU ${addon.sku} is inactive in the hub.` });
        continue;
      }
      if (rec.itemType !== "finished_good") {
        issues.push({
          path: addonPath,
          message: `Add-on SKU ${addon.sku} is item_type "${rec.itemType}", not a finished_good.`,
        });
        continue;
      }
      resolvedAddons.push({
        key: addon.key,
        sku: addon.sku,
        variantId: rec.katanaVariantId,
      });
    }

    if (issues.length === lineIssuesBefore) {
      // Parent line (addons cleared — each mapped add-on becomes its own SO row below).
      lines.push({
        spec: { ...spec, addons: [] },
        baseVariantId: base?.katanaVariantId ?? null,
        finishes,
        addons: [],
        skipMo,
        provisionalShell,
      });
      // Append mapped ACF add-ons as extra resolved lines (Katana SO rows). Unmapped already issued.
      for (const addon of resolvedAddons) {
        const addonSkipMo = await isResale(addon.sku);
        lines.push({
          spec: {
            index: spec.index,
            wooLineItemId: spec.wooLineItemId,
            sku: addon.sku,
            quantity: spec.quantity,
            finishes: {},
            addons: [],
            addonKey: addon.key,
          },
          baseVariantId: addon.variantId,
          finishes: [],
          addons: [{ key: addon.key, sku: addon.sku, variantId: addon.variantId }],
          skipMo: addonSkipMo,
          provisionalShell: false,
        });
      }
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

export async function resolveAliasesFromHub(skus: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (skus.length === 0) return out;
  const db = getDb();
  const rows = await db
    .select({
      alias: sku_aliases.alias_sku,
      canonical: sku_aliases.canonical_sku,
    })
    .from(sku_aliases)
    .where(inArray(sku_aliases.alias_sku, skus));
  for (const row of rows) {
    out.set(row.alias.toUpperCase(), row.canonical.toUpperCase());
  }
  return out;
}

export async function isThirdPartyFromHub(sku: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ sku: third_party_sources.global_sku })
    .from(third_party_sources)
    .where(eq(third_party_sources.global_sku, sku))
    .limit(1);
  return Boolean(row);
}

export function hubResolveDeps(): WooResolveDeps {
  return {
    lookupSkus: lookupSkusFromHub,
    recipeSkus: recipeSkusFromHub,
    resolveAliases: resolveAliasesFromHub,
    isThirdParty: isThirdPartyFromHub,
  };
}
