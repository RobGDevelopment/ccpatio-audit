/**
 * Match a Katana product name to an existing canonical finished-good SKU.
 *
 * Never invents SKUs: candidates come from live sku_mappings. Katana product
 * names and PIM names disagree on dimension order ("42 x 28" vs "28 X 42"),
 * so matching is done on category code + dimension set, not on the raw string.
 *
 * Two Katana products claiming the same finished good is a data question for a
 * human, so the weaker claim is dropped rather than guessed.
 */
import { resolveCatCode } from "@/lib/sku-engine";
import {
  directionOfStem,
  modelCodesFromSkus,
  productsInCollection,
  type CollectionConfig,
  type KatanaProductLike,
} from "@/lib/collection-catalog";

export type FinishedGoodCandidate = {
  globalSku: string;
  originalName: string;
};

export type FgMatchReason = "override" | "exact-name" | "cat-dims" | "cat-unique";

export type FgMatch = {
  globalSku: string;
  reason: FgMatchReason;
};

const REASON_RANK: Record<FgMatchReason, number> = {
  override: 0,
  "exact-name": 1,
  "cat-dims": 2,
  "cat-unique": 3,
};

/**
 * Katana product name -> canonical SKU, for models the generic rules cannot
 * resolve. Keep this list short and justified; unmatched is safer than wrong.
 *
 * BRAVADA LOVESEAT: both "Bravada Loveseat" (BRA-L) and "Bravada Armless
 * Loveseat" (BRA-AL-60) resolve to the single LOV-SOF row; the non-armless
 * product is the real one.
 */
export const FG_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "BRAVADA LOVESEAT": "FIN-BRV-LOV-SOF-60X34",
};

/**
 * Model code -> finished good, for models a product name cannot tell apart.
 *
 * A dekton-topped ottoman and a plain one share a single Katana product, and so
 * do the two chaise lounge arm configurations, so name matching sees one name
 * claimed by two models and correctly refuses to guess. These are the explicit
 * data-dictionary decisions that break the tie.
 *
 * Checked before name matching, so the mapped model is removed from contention
 * and its sibling wins its own name uncontested.
 */
export const FG_BY_MODEL_CODE: Readonly<Record<string, string>> = {
  // Dekton-topped ottomans: Katana's `dekton top: Yes` variants, which hold the
  // real cut-lists. The plain BRA-O-* siblings keep FIN-BRV-OTT-* by name.
  "BRA-ODT-30X22": "FIN-BRV-OTT-DKT-30X22",
  "BRA-ODT-34X34": "FIN-BRV-OTT-DKT-34X34",
  "BRA-ODT-42X22": "FIN-BRV-OTT-DKT-42X22",
  "BRA-ODT-42X34": "FIN-BRV-OTT-DKT-42X34",
  "BRA-ODT-60X22": "FIN-BRV-OTT-DKT-60X22",
  "BRA-ODT-60X34": "FIN-BRV-OTT-DKT-60X34",
  "BRA-ODT-72X22": "FIN-BRV-OTT-DKT-72X22",
  "BRA-ODT-72X34": "FIN-BRV-OTT-DKT-72X34",

  // Chaise lounges with `Metal Arms: No`.
  "BRA-CL-D-A": "FIN-BRV-DOU-CHS-58X79-NOARM",
  "BRA-CL-S-A": "FIN-BRV-SGL-CHS-30X79-NOARM",

  // Daybeds. Cabana and plain are separate lines at different depths: plain 72
  // is 72x72 and plain 78 is 78x72, against Cabana's 78-deep run. Mapping them
  // by model code avoids the "Bravada Daybed 72" / "Bravada Cabana Daybed 72"
  // names competing for the same dimensions.
  "BRA-CADA-72X78": "FIN-BRV-DYB-72X78",
  "BRA-CADA-78X78": "FIN-BRV-DYB-78X78",
  "BRA-CADA-84X78": "FIN-BRV-DYB-84X78",
  "BRA-D-7272": "FIN-BRV-DYB-72X72",
  "BRA-D-7872": "FIN-BRV-DYB-78X72",
};

const SIZE_TOKEN = /^(\d{2,3})(?:X(\d{2,3}))?$/;

const DIRECTION_TOKEN = /^(LS|RS)$/;

export function normalizeProductName(name: string): string {
  return name
    .replace(/[""\u2033'']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Katana writes "Chaise Lounge Double"; the SKU engine expects
 * "Double Chaise Lounge". Move a trailing Single/Double before "Chaise".
 */
export function reorderChaiseModifier(name: string): string {
  const normalized = normalizeProductName(name);
  const match = /^(.*)\s+(SINGLE|DOUBLE)$/.exec(normalized);
  if (!match) {
    return normalized;
  }
  const [, head, modifier] = match;
  if (!/\bCHAISE\b/.test(head!)) {
    return normalized;
  }
  return head!.replace(/\bCHAISE\b/, `${modifier} CHAISE`);
}

/** "Bravada Ottoman 42X34" and "... 28 X 42" both yield sorted [34, 42] / [28, 42]. */
export function dimensionsFromName(name: string): number[] {
  const tokens = normalizeProductName(name).match(/\d{2,3}/g) ?? [];
  return tokens.map(Number).sort((a, b) => a - b);
}

/**
 * FIN-BRV-COF-TAB-42X28    -> { catCode: "COF-TAB", dims: [28, 42], direction: null }
 * FIN-BRV-CHS-34X72-LS     -> { catCode: "CHS", dims: [34, 72], direction: "LS" }
 */
export function parseFinishedGoodSku(
  globalSku: string,
  config: CollectionConfig,
): {
  catCode: string;
  /** Sorted, for order-insensitive comparison against product names. */
  dims: number[];
  /** Literal token as written, preserving length-by-depth order. */
  sizeToken: string;
  direction: string | null;
} | null {
  if (!globalSku.startsWith(config.finPrefix)) {
    return null;
  }
  const tail = globalSku
    .slice(config.finPrefix.length)
    .split("-")
    .filter(Boolean);
  if (tail.length === 0) {
    return null;
  }

  let direction: string | null = null;
  if (DIRECTION_TOKEN.test(tail[tail.length - 1] ?? "")) {
    direction = tail.pop()!;
  }

  const dims: number[] = [];
  let sizeToken = "";
  const size = SIZE_TOKEN.exec(tail[tail.length - 1] ?? "");
  if (size) {
    sizeToken = tail.pop()!;
    dims.push(Number(size[1]));
    if (size[2]) dims.push(Number(size[2]));
  }

  return {
    catCode: tail.join("-"),
    dims: dims.sort((a, b) => a - b),
    sizeToken,
    direction,
  };
}

function sameMultiset(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isSubset(needle: number[], haystack: number[]): boolean {
  const pool = [...haystack];
  for (const value of needle) {
    const index = pool.indexOf(value);
    if (index === -1) return false;
    pool.splice(index, 1);
  }
  return true;
}

/**
 * Katana product names carry no handedness — that lives on the variant SKU —
 * so the caller passes the direction of the model being matched and only
 * candidates with the same handedness are considered.
 */
export function matchFinishedGoodSku(
  productName: string,
  config: CollectionConfig,
  candidates: FinishedGoodCandidate[],
  direction: string | null = null,
): FgMatch | null {
  const normalized = normalizeProductName(productName);
  const scoped = candidates.filter((row) => {
    const parts = parseFinishedGoodSku(row.globalSku, config);
    return parts !== null && parts.direction === direction;
  });

  const overrideKey = direction ? `${normalized}|${direction}` : normalized;
  const override = FG_NAME_OVERRIDES[overrideKey];
  if (override && scoped.some((row) => row.globalSku === override)) {
    return { globalSku: override, reason: "override" };
  }

  const byName = scoped.filter(
    (row) => normalizeProductName(row.originalName) === normalized,
  );
  if (byName.length === 1) {
    return { globalSku: byName[0]!.globalSku, reason: "exact-name" };
  }

  const catCode = resolveCatCode(reorderChaiseModifier(productName));
  if (catCode === "MIS") {
    return null;
  }

  const parsed = scoped
    .map((row) => ({ row, parts: parseFinishedGoodSku(row.globalSku, config) }))
    .filter(
      (
        entry,
      ): entry is {
        row: FinishedGoodCandidate;
        parts: NonNullable<ReturnType<typeof parseFinishedGoodSku>>;
      } => entry.parts !== null && entry.parts.catCode === catCode,
    );

  if (parsed.length === 0) {
    return null;
  }

  const dims = dimensionsFromName(productName);

  const exactDims = parsed.filter((entry) => sameMultiset(dims, entry.parts.dims));
  if (exactDims.length === 1) {
    return { globalSku: exactDims[0]!.row.globalSku, reason: "cat-dims" };
  }

  if (dims.length > 0) {
    const subset = parsed.filter((entry) => isSubset(dims, entry.parts.dims));
    if (subset.length === 1) {
      return { globalSku: subset[0]!.row.globalSku, reason: "cat-dims" };
    }
    return null;
  }

  if (parsed.length === 1) {
    return { globalSku: parsed[0]!.row.globalSku, reason: "cat-unique" };
  }

  return null;
}

export type FgResolution = {
  fgSkuByModel: Map<string, string>;
  matched: Array<{
    modelCode: string;
    productName: string;
    globalSku: string;
    reason: FgMatchReason;
  }>;
  unmatched: Array<{ modelCode: string; productName: string }>;
  warnings: string[];
};

/**
 * Resolve every product in a collection to a finished good, dropping any
 * finished good claimed by more than one product at the same confidence.
 */
export function resolveFinishedGoodsByModel(input: {
  products: KatanaProductLike[];
  config: CollectionConfig;
  candidates: FinishedGoodCandidate[];
}): FgResolution {
  const warnings: string[] = [];
  const claims = new Map<
    string,
    Array<{ modelCode: string; productName: string; reason: FgMatchReason }>
  >();
  const unmatched: FgResolution["unmatched"] = [];

  for (const product of productsInCollection(input.products, input.config)) {
    const skus = (product.variants ?? [])
      .map((variant) => variant.sku?.trim() ?? "")
      .filter(Boolean);
    if (skus.length === 0) continue;

    for (const modelCode of modelCodesFromSkus(skus, input.config.skuPrefix)) {
      const mapped = FG_BY_MODEL_CODE[modelCode];
      const match = mapped
        ? input.candidates.some((row) => row.globalSku === mapped)
          ? ({ globalSku: mapped, reason: "override" } as const)
          : null
        : matchFinishedGoodSku(
            product.name,
            input.config,
            input.candidates,
            directionOfStem(modelCode),
          );
      if (!match) {
        unmatched.push({ modelCode, productName: product.name });
        continue;
      }
      const list = claims.get(match.globalSku) ?? [];
      list.push({ modelCode, productName: product.name, reason: match.reason });
      claims.set(match.globalSku, list);
    }
  }

  const fgSkuByModel = new Map<string, string>();
  const matched: FgResolution["matched"] = [];

  for (const [globalSku, list] of claims) {
    if (list.length === 1) {
      const only = list[0]!;
      fgSkuByModel.set(only.modelCode, globalSku);
      matched.push({ ...only, globalSku });
      continue;
    }

    const bestRank = Math.min(...list.map((row) => REASON_RANK[row.reason]));
    const winners = list.filter((row) => REASON_RANK[row.reason] === bestRank);
    const losers = list.filter((row) => REASON_RANK[row.reason] !== bestRank);

    if (winners.length === 1) {
      const winner = winners[0]!;
      fgSkuByModel.set(winner.modelCode, globalSku);
      matched.push({ ...winner, globalSku });
      for (const loser of losers) {
        unmatched.push({
          modelCode: loser.modelCode,
          productName: loser.productName,
        });
      }
      warnings.push(
        `${globalSku} claimed by ${list.length} products; kept ${winner.productName} (${winner.reason}), dropped ${losers.map((row) => row.productName).join(", ")}`,
      );
      continue;
    }

    for (const row of list) {
      unmatched.push({ modelCode: row.modelCode, productName: row.productName });
    }
    warnings.push(
      `${globalSku} claimed by ${list.length} products at equal confidence (${list.map((row) => row.productName).join(", ")}); all left unlinked`,
    );
  }

  unmatched.sort((a, b) => a.modelCode.localeCompare(b.modelCode));
  matched.sort((a, b) => a.modelCode.localeCompare(b.modelCode));

  return { fgSkuByModel, matched, unmatched, warnings };
}
