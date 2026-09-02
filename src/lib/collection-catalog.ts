/**
 * Collection-parameterized FRAME / CUSH derivation from a Katana /products dump.
 * One pair (or FRAME-only) per product model — not per color variant.
 *
 * Ocean shipped first; Bravada and Brooklyn reuse the same rules through
 * COLLECTIONS instead of a second copy of the logic.
 */

export const COLLECTION_SOURCE = "docs/katana_live_state/products.json";

/** Katana color suffixes. WT is a factory typo for WH on one Bravada variant. */
const COLOR_TOKEN = new Set(["BL", "WH", "WT", "BR", "BE", "BO", "GR"]);

/** Ocean dekton-top yes/no suffix. */
const FLAG_TOKEN = new Set(["Y", "N", "YES", "NO"]);

/** Chaise / corner handedness. Preserved in the model code. */
export const DIRECTIONAL_TOKEN = new Set(["LS", "RS"]);

/**
 * Trailing stem token for the no-metal-arms chaise lounge. Confirmed against
 * Katana's `Metal Arms: No` config attribute, and the only stems in the whole
 * catalogue ending in -A are BRA-CL-D-A and BRA-CL-S-A.
 */
const NO_ARM_TOKEN = "A";

/**
 * Category segment the factory writes for a dekton-topped ottoman: BRA-ODT-*
 * against BRA-O-* for the same size, on one shared Katana product. Confirmed
 * against the `dekton top: Yes/No` config attribute.
 */
const DEKTON_SEGMENT = "ODT";
const DEKTON_BASE_SEGMENT = "O";

const CUSHION_NAME = /sofa|loveseat|chair|chaise|ottoman|cushion|daybed/i;

export type CollectionKey = "ocean" | "bravada" | "brooklyn";

export type CollectionConfig = {
  key: CollectionKey;
  /** Katana products[].category_name */
  katanaCategory: string;
  /** Katana variant SKU prefix (model codes must start with this). */
  skuPrefix: string;
  /** Canonical finished-good prefix in live sku_mappings. */
  finPrefix: string;
  /** Human collection word used in logs. */
  label: string;
  /**
   * Give a handed sub-assembly its opposite hand's cut-list when the factory
   * only authored one side. A mirrored frame consumes identical stock, so the
   * material draw is safe to copy even though the geometry is reflected.
   */
  mirrorHandedCutLists?: boolean;
};

export const COLLECTIONS: Record<CollectionKey, CollectionConfig> = {
  ocean: {
    key: "ocean",
    katanaCategory: "Ocean Collection",
    skuPrefix: "OCE",
    finPrefix: "FIN-OCN-",
    label: "Ocean",
  },
  bravada: {
    key: "bravada",
    katanaCategory: "Bravada Collection",
    skuPrefix: "BRA",
    finPrefix: "FIN-BRV-",
    label: "Bravada",
    mirrorHandedCutLists: true,
  },
  brooklyn: {
    key: "brooklyn",
    katanaCategory: "Brooklyn Collection",
    skuPrefix: "BRO",
    finPrefix: "FIN-BRK-",
    label: "Brooklyn",
    mirrorHandedCutLists: true,
  },
};

export type KatanaProductLike = {
  id: number;
  name: string;
  category_name?: string | null;
  variants?: Array<{ id: number; sku?: string | null }>;
};

export type SubAssemblySeed = {
  globalSku: string;
  role: "frame" | "cushion";
  modelCode: string;
  parentName: string;
  katanaParentProductId: number;
  variantCount: number;
  collection: CollectionKey;
};

/**
 * Repair malformed directional tokens before stemming. The factory typed
 * BRA-C-34X84LS-BO and BRA-C-34X72-BL (token dropped entirely); the first is
 * recoverable here, the second is not and is left for the Katana patch.
 */
export function normalizeVariantSku(sku: string): string {
  return sku
    .trim()
    .toUpperCase()
    .replace(/(\d)(LS|RS)(?=-|$)/g, "$1-$2");
}

/**
 * Drop trailing color / dekton-flag tokens. Directional LS|RS survives:
 * BRA-C-34X72-LS-BE -> BRA-C-34X72-LS
 */
export function stripVariantSuffix(sku: string): string {
  const parts = normalizeVariantSku(sku).split("-").filter(Boolean);
  let changed = true;
  while (changed && parts.length > 2) {
    changed = false;
    const last = parts[parts.length - 1]!;
    if (COLOR_TOKEN.has(last) || FLAG_TOKEN.has(last)) {
      parts.pop();
      changed = true;
    }
  }
  return parts.join("-");
}

/**
 * Split a stem into the base it shares with its siblings and the variant axes
 * that make it a genuinely different product.
 *
 * Each axis is a real physical difference the factory records in Katana's
 * config_attributes, so a left frame, a dekton top and a no-arm chaise each get
 * their own model. Anything else that makes two stems disagree — a transposed
 * dimension, a colour typo — leaves the base itself different, and the caller
 * collapses those onto the majority base rather than minting a phantom model.
 *
 * BRA-C-34X72-LS   -> base BRA-C-34X72, axis [LS]
 * BRA-ODT-34X34    -> base BRA-O-34X34, axis [DKT]
 * BRA-CL-D-A       -> base BRA-CL-D,    axis [NOARM]
 * BRA-CT-42X28     -> base BRA-CT-42X28, axis []
 */
export function parseStem(
  stem: string,
  prefix: string,
): { base: string; axis: string[] } {
  const parts = stem.split("-");
  const axis: string[] = [];

  for (;;) {
    const last = parts[parts.length - 1] ?? "";
    if (parts.length > 2 && DIRECTIONAL_TOKEN.has(last)) {
      axis.push(parts.pop()!);
      continue;
    }
    if (parts.length > 2 && last === NO_ARM_TOKEN) {
      parts.pop();
      axis.push("NOARM");
      continue;
    }
    break;
  }

  if (parts[0] === prefix && parts[1] === DEKTON_SEGMENT) {
    parts[1] = DEKTON_BASE_SEGMENT;
    axis.push("DKT");
  }

  return { base: parts.join("-"), axis: axis.sort() };
}

function axisKey(axis: string[]): string {
  return axis.join("|");
}

/** Trailing LS|RS on a stem, or null when the model is symmetric. */
export function directionOfStem(stem: string): string | null {
  for (const part of stem.split("-").reverse()) {
    if (DIRECTIONAL_TOKEN.has(part)) return part;
    if (part !== NO_ARM_TOKEN) break;
  }
  return null;
}

/** BRA-C-34X72-LS -> BRA-C-34X72; symmetric stems pass through unchanged. */
export function baseOfStem(stem: string): string {
  const parts = stem.split("-");
  return DIRECTIONAL_TOKEN.has(parts[parts.length - 1] ?? "")
    ? parts.slice(0, -1).join("-")
    : stem;
}

function stemsForProduct(skus: string[], prefix: string): string[] {
  return skus
    .map((sku) => stripVariantSuffix(sku))
    .filter((stem) => stem.startsWith(prefix));
}

/**
 * Model codes for one Katana product — one per variant axis combination
 * present, after collapsing base-level factory noise onto the majority base.
 *
 * The model code is always a stem the factory actually wrote, so a sub-assembly
 * SKU stays traceable back to the cut-list it came from.
 */
export function modelCodesFromSkus(skus: string[], prefix: string): string[] {
  const stems = stemsForProduct(skus, prefix);
  if (stems.length === 0) {
    throw new Error(`No ${prefix}-* SKUs to derive a model code.`);
  }

  const counts = new Map<string, number>();
  for (const stem of stems) {
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }

  const parsed = [...counts.entries()].map(([stem, count]) => ({
    stem,
    count,
    ...parseStem(stem, prefix),
  }));

  const baseCounts = new Map<string, number>();
  for (const entry of parsed) {
    baseCounts.set(entry.base, (baseCounts.get(entry.base) ?? 0) + entry.count);
  }
  const majorityBase = [...baseCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]![0];

  // One model per axis combination; within an axis, the most-stocked stem wins
  // and ties break alphabetically so reruns are deterministic.
  const byAxis = new Map<string, { stem: string; count: number }>();
  for (const entry of parsed) {
    if (entry.base !== majorityBase) continue;
    const key = axisKey(entry.axis);
    const held = byAxis.get(key);
    if (
      !held ||
      entry.count > held.count ||
      (entry.count === held.count && entry.stem.localeCompare(held.stem) < 0)
    ) {
      byAxis.set(key, { stem: entry.stem, count: entry.count });
    }
  }

  return [...byAxis.values()].map((entry) => entry.stem).sort();
}

/** Single model code. Returns the first when a product splits. */
export function modelCodeFromSkus(skus: string[], prefix: string): string {
  return modelCodesFromSkus(skus, prefix)[0]!;
}

/** Distinct stems on one product — more than one means something collapsed. */
export function distinctStems(skus: string[], prefix: string): string[] {
  return [...new Set(stemsForProduct(skus, prefix))].sort();
}

/**
 * Variant SKUs belonging to one model code. Scoping by axis is what keeps a
 * left frame off a right cut-list and a dekton slab off a plain ottoman.
 */
export function skusForModel(
  skus: string[],
  modelCode: string,
  prefix: string,
): string[] {
  const target = parseStem(modelCode, prefix);
  return skus.filter((sku) => {
    const stem = stripVariantSuffix(sku);
    if (!stem.startsWith(prefix)) return false;
    const parsed = parseStem(stem, prefix);
    return (
      parsed.base === target.base && axisKey(parsed.axis) === axisKey(target.axis)
    );
  });
}

export function productNeedsCushion(name: string): boolean {
  return CUSHION_NAME.test(name);
}

export function productsInCollection(
  products: KatanaProductLike[],
  config: CollectionConfig,
): KatanaProductLike[] {
  return products.filter(
    (product) => product.category_name === config.katanaCategory,
  );
}

export function buildSubAssemblies(
  products: KatanaProductLike[],
  config: CollectionConfig,
): SubAssemblySeed[] {
  const rows: SubAssemblySeed[] = [];

  for (const product of productsInCollection(products, config)) {
    const skus = (product.variants ?? [])
      .map((variant) => variant.sku?.trim() ?? "")
      .filter(Boolean);
    if (skus.length === 0) continue;

    const needsCushion = productNeedsCushion(product.name);

    for (const modelCode of modelCodesFromSkus(skus, config.skuPrefix)) {
      const variantCount = skusForModel(skus, modelCode, config.skuPrefix).length;

      rows.push({
        globalSku: `SA-${modelCode}-FRAME`,
        role: "frame",
        modelCode,
        parentName: product.name,
        katanaParentProductId: product.id,
        variantCount,
        collection: config.key,
      });

      if (needsCushion) {
        rows.push({
          globalSku: `SA-${modelCode}-CUSH`,
          role: "cushion",
          modelCode,
          parentName: product.name,
          katanaParentProductId: product.id,
          variantCount,
          collection: config.key,
        });
      }
    }
  }

  rows.sort((a, b) => a.globalSku.localeCompare(b.globalSku));
  return rows;
}
