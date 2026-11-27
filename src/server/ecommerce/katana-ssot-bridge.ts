/**
 * Stack-wide E-Commerce ↔ Showroom ↔ Katana SSOT helpers (pure + light I/O).
 * Powder factory subtitles, DKT↔STN bridge, freestanding Simple gating,
 * and staged Katana rename summaries (held while DOWNSTREAM_MUTATIONS=false).
 */

import {
  ECOMMERCE_32_FINISHES,
  ecommerceFinishBySku,
  resolveEcommerceFinishSku,
} from "@/server/ecommerce/ecommerce-32-finish-roster";

/** Katana / factory powder labels shown as subtitle under clean storefront names. */
export const POWDER_FACTORY_SUBTITLES: Readonly<Record<string, string>> = {
  "PWD-FANUC-GRAY": "Fanuc Gray",
  "PWD-LITE-BEIGE": "Lite Beige",
  "PWD-BEIGE": "Lite Beige",
  "PWD-OIL-RUB-BRONZE": "Oil Rubbed Bronze",
  "PWD-BLACK": "Black",
  "PWD-WHITE": "White",
  "PWD-BONE": "Bone",
};

/** Known stale powder DB labels that soft-patch may replace (never Mia-customized names). */
export const POWDER_STALE_FACTORY_LABELS: Readonly<Record<string, readonly string[]>> = {
  "PWD-FANUC-GRAY": ["Fanuc Gray", "Gray Powder", "Gray Powder Coat", "Fanuc Gray Powder"],
  "PWD-LITE-BEIGE": [
    "Lite Beige",
    "Beige Powder",
    "Beige Powder Coat",
    "Lite Beige Powder",
    "Beige",
  ],
  "PWD-OIL-RUB-BRONZE": [
    "Oil Rubbed Bronze",
    "Bronze Powder",
    "Bronze Powder Coat",
    "Oil Rub Bronze",
  ],
  "PWD-BLACK": ["Black Powder", "Black Powder Coat"],
  "PWD-WHITE": ["White Powder", "White Powder Coat", "Wild Rice"],
  "PWD-BONE": ["Bone Powder", "Bone Powder Coat"],
};

export function powderFactorySubtitle(sku: string): string | null {
  const upper = sku.trim().toUpperCase();
  const canonical = resolveEcommerceFinishSku(upper) ?? upper;
  return POWDER_FACTORY_SUBTITLES[canonical] ?? POWDER_FACTORY_SUBTITLES[upper] ?? null;
}

/**
 * True when the stored finish display name is a known factory/legacy default
 * (safe to soft-patch to roster storefront name). Custom Mia names return false.
 */
export function isStalePowderFactoryDisplayName(
  sku: string,
  current: string | null | undefined,
): boolean {
  const def = ecommerceFinishBySku(resolveEcommerceFinishSku(sku) ?? sku);
  if (!def || def.family !== "powder") return false;
  const cur = (current ?? "").trim();
  if (!cur) return true;
  if (cur.toLowerCase() === def.displayName.toLowerCase()) return false;
  const stale = POWDER_STALE_FACTORY_LABELS[def.sku] ?? [];
  const needle = cur.toLowerCase();
  if (stale.some((s) => s.toLowerCase() === needle)) return true;
  // Factory subtitle alone (e.g. "Fanuc Gray") is stale relative to "Gray".
  const factory = POWDER_FACTORY_SUBTITLES[def.sku];
  if (factory && factory.toLowerCase() === needle && factory.toLowerCase() !== def.displayName.toLowerCase()) {
    return true;
  }
  // Mis-assigned storefront powder name (e.g. "Beige" on PWD-FANUC-GRAY) — restore roster.
  const storefrontPowderNames = new Set(
    ["Gray", "Beige", "Bronze", "Black", "Bone", "White"].map((s) => s.toLowerCase()),
  );
  if (storefrontPowderNames.has(needle) && needle !== def.displayName.toLowerCase()) {
    return true;
  }
  return false;
}

/** Expand DKT-* ↔ STN-DKT-* and roster aliases for image / name joins. */
export function finishSkuLookupKeys(rawSku: string): string[] {
  const upper = rawSku.trim().toUpperCase();
  if (!upper) return [];
  const keys = new Set<string>([upper]);
  const canonical = resolveEcommerceFinishSku(upper);
  if (canonical) {
    keys.add(canonical);
    const def = ecommerceFinishBySku(canonical);
    if (def) {
      for (const a of def.aliases) keys.add(a.toUpperCase());
    }
  }
  if (upper.startsWith("STN-DKT-")) {
    const stripped = upper.replace(/^STN-/, "");
    keys.add(stripped);
    const viaStrip = resolveEcommerceFinishSku(stripped);
    if (viaStrip) keys.add(viaStrip);
  }
  if (upper.startsWith("DKT-")) {
    keys.add(`STN-${upper}`);
    // Abbreviated Katana forms (STN-DKT-ALD for DKT-ALDEM)
    const def = ecommerceFinishBySku(upper) ?? ecommerceFinishBySku(canonical ?? "");
    if (def) {
      for (const a of def.aliases) {
        if (a.toUpperCase().startsWith("STN-")) keys.add(a.toUpperCase());
      }
    }
  }
  return [...keys];
}

export function bridgeDektonSku(rawSku: string): string | null {
  const upper = rawSku.trim().toUpperCase();
  const resolved = resolveEcommerceFinishSku(upper);
  if (resolved) return resolved;
  if (upper.startsWith("STN-DKT-")) {
    return resolveEcommerceFinishSku(upper.replace(/^STN-/, "")) ?? null;
  }
  return null;
}

/** Freestanding heaters / lamps / loungers — never sectional -LS/-RS badges. */
export function isFreestandingNonSectionalProduct(input: {
  productName?: string | null;
  globalSku?: string | null;
  wooSku?: string | null;
  collectionLabel?: string | null;
}): boolean {
  const hay = `${input.productName ?? ""} ${input.collectionLabel ?? ""} ${input.globalSku ?? ""} ${input.wooSku ?? ""}`.toUpperCase();
  if (/\bSECTIONAL\b|\bARMLESS\b|\bCORNER\b|\bCHAISE SECTIONAL\b/.test(hay)) return false;
  return (
    /\bHEATER\b/.test(hay) ||
    /\bLAMP\b/.test(hay) ||
    /\bLOUNGER\b/.test(hay) ||
    /\bKINDLE LIVING\b/.test(hay) ||
    /\bLAY['’]?D\b/.test(hay)
  );
}

export type KatanaAlignmentSummary = {
  linkedCount: number;
  alignedCount: number;
  stagedRenameCount: number;
  label: string;
};

export type KatanaAlignmentPair = {
  ecommerceSku: string;
  ecommerceName: string;
  katanaVariantId: number | null;
  katanaSku: string | null;
  katanaName: string | null;
};

/**
 * Compare E-Commerce canonical names against synced Katana variant names.
 * Renames are staged only (PATCH by katana_variant_id) — never create items.
 */
export function computeKatanaAlignmentSummary(
  pairs: readonly KatanaAlignmentPair[],
  downstreamMutations = false,
): KatanaAlignmentSummary {
  let linkedCount = 0;
  let alignedCount = 0;
  let stagedRenameCount = 0;
  for (const p of pairs) {
    if (p.katanaVariantId == null && !p.katanaSku) continue;
    linkedCount += 1;
    const left = (p.ecommerceName ?? "").trim().toLowerCase();
    const right = (p.katanaName ?? "").trim().toLowerCase();
    if (left && right && left === right) {
      alignedCount += 1;
    } else if (p.katanaVariantId != null && left && right && left !== right) {
      stagedRenameCount += 1;
    }
  }
  const hold = downstreamMutations
    ? "Mutations enabled"
    : "Safe Hold until DOWNSTREAM_MUTATIONS=true";
  return {
    linkedCount,
    alignedCount,
    stagedRenameCount,
    label: `Katana Alignment: ${linkedCount} Linked · ${stagedRenameCount} Name Updates Staged (${hold})`,
  };
}

/** Active powder coat count from the exact 32 roster (must be 6). */
export function activePowderCoatCount(): number {
  return ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder").length;
}

/** True when product_name is essentially ALL-CAPS factory workbook text. */
export function isAllCapsFactoryTitle(raw: string | null | undefined): boolean {
  // Ignore parenthetical dimension tokens like (d15cm) when judging ALL-CAPS.
  const s = (raw ?? "").trim().replace(/\([^)]*\)/g, " ");
  if (!s || s.length < 3) return false;
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase() && /[A-Z]/.test(letters);
}
