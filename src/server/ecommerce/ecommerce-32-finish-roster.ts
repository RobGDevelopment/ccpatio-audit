/**
 * Exact 32 e-commerce finishes (19932.jpg) — pure helpers, no I/O.
 * Scopes the GHL E-Commerce portal + Woo/PrimeView export filters.
 * Steel frame / +10% steel upcharge stay Hub-reference-only (never storefront).
 */

import { MET_ALUM_SKU, MET_STEEL_SKU } from "@/server/woocommerce/finish-keys";
import { STEEL_DISCONTINUED_REASON } from "@/server/ecommerce/alu10-pricing";

export type EcommerceFinishFamily =
  | "sunbrella"
  | "ultraleather"
  | "dekton"
  | "powder";

export type EcommerceFinishCategory = "fabric" | "powder" | "dekton";

export type EcommerceFinishDefinition = {
  sku: string;
  displayName: string;
  family: EcommerceFinishFamily;
  category: EcommerceFinishCategory;
  /** Approximate hex until photoshoot texture lands. */
  hex: string;
  /** Pattern repeat inches (W×H); null = solid / no repeat. */
  patternRepeatIn: { w: number; h: number } | null;
  /** WooCommerce ACF / APF metadata key for this finish slot. */
  wooMetaKey: "fabric_sku" | "powder_coat" | "dekton";
  /** Prior Hub / Katana SKUs retained as aliases when retired/replaced. */
  aliases: readonly string[];
};

export const ECOMMERCE_FINISH_DISABLED_SENTINEL = "ecommerce:disabled";

/** Roles allowed on the Executive Control Center (in addition to Mia/Kian emails). */
export const ECOMMERCE_PORTAL_ROLES = ["SuperAdmin"] as const;

/** Operator emails (case-insensitive) treated as Mia / Kian merchandisers. */
export const ECOMMERCE_PORTAL_OPERATOR_EMAILS = [
  "mia@ccpatio.com",
  "kian@ccpatio.com",
] as const;

/**
 * Exact 32 e-commerce finishes.
 * Fabrics use live Katana FAB-* SKUs; Black Moor is auto-allocated (FAB-BLA-MOO).
 * Powders keep Hub PWD-* codes with storefront display names.
 * Dekton uses DKT-* e-commerce SKUs (aliases cover DEC-* / D-* / STN-DKT-*).
 */
export const ECOMMERCE_32_FINISHES: readonly EcommerceFinishDefinition[] = [
  // ── Sunbrella Fabrics (16) ───────────────────────────────────────────
  { sku: "FAB-CAN-WHI", displayName: "Canvas White", family: "sunbrella", category: "fabric", hex: "#F5F2EA", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-CAN-BLA", displayName: "Canvas Black", family: "sunbrella", category: "fabric", hex: "#1A1A1A", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-CAN-HEN", displayName: "Canvas Henna", family: "sunbrella", category: "fabric", hex: "#8B4513", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-CAN-NAV", displayName: "Canvas Navy", family: "sunbrella", category: "fabric", hex: "#1B2A4A", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-RIT-NEC", displayName: "Ritsy Nectar", family: "sunbrella", category: "fabric", hex: "#D4A574", patternRepeatIn: { w: 27, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-RIT-ROS", displayName: "Ritsy Rosemary", family: "sunbrella", category: "fabric", hex: "#6B7F5A", patternRepeatIn: { w: 27, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-MET-CLO", displayName: "Metamorphic Cloud", family: "sunbrella", category: "fabric", hex: "#C8C4BC", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-HER-PAP", displayName: "Heritage Papyrus", family: "sunbrella", category: "fabric", hex: "#E8DFC8", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-CAB-CLA", displayName: "Cabana Classic", family: "sunbrella", category: "fabric", hex: "#EDE6D9", patternRepeatIn: { w: 54, h: 7 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-SHE-LIN", displayName: "Shelter Linen", family: "sunbrella", category: "fabric", hex: "#D9D0C0", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-POS-SAP", displayName: "Posh Sapphire", family: "sunbrella", category: "fabric", hex: "#2F4A6E", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-CRU-ASH", displayName: "Crush Ash", family: "sunbrella", category: "fabric", hex: "#A8A29A", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-DUM-STU", displayName: "Dumont Stucco", family: "sunbrella", category: "fabric", hex: "#C4B9A8", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-RUE-COS", displayName: "Rue Coastal", family: "sunbrella", category: "fabric", hex: "#7A9AA8", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-PRE-FAW", displayName: "Precise Fawn", family: "sunbrella", category: "fabric", hex: "#C9B89A", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-KIN-SIL", displayName: "Kindle Silk", family: "sunbrella", category: "fabric", hex: "#E2DDD2", patternRepeatIn: { w: 54, h: 25.25 }, wooMetaKey: "fabric_sku", aliases: [] },

  // ── Ultraleather (4) ─────────────────────────────────────────────────
  { sku: "FAB-BEA-ULT", displayName: "Beacon", family: "ultraleather", category: "fabric", hex: "#E8E4DC", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: ["FAB-BEA-BEA"] },
  { sku: "FAB-SNO-CAP", displayName: "Snowcap", family: "ultraleather", category: "fabric", hex: "#F7F5F0", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-BLA-MOO", displayName: "Black Moor", family: "ultraleather", category: "fabric", hex: "#1C1C1C", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },
  { sku: "FAB-SAV-ULT", displayName: "Savanna", family: "ultraleather", category: "fabric", hex: "#C4A882", patternRepeatIn: null, wooMetaKey: "fabric_sku", aliases: [] },

  // ── Dekton (6) — DKT-* e-commerce SKUs ───────────────────────────────
  { sku: "DKT-ALDEM", displayName: "Aldem", family: "dekton", category: "dekton", hex: "#8C867D", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-ALDEM", "D-ALDEM-1.2CM", "D-ALDEM-2CM", "STN-DKT-ALD"] },
  { sku: "DKT-EDORA", displayName: "Edora", family: "dekton", category: "dekton", hex: "#5E5A56", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-EDORA", "D-EDORA-1.2CM", "D-EDORA-2CM"] },
  { sku: "DKT-AURA", displayName: "Aura", family: "dekton", category: "dekton", hex: "#9A978F", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-AURA", "D-AURA-1.2CM", "D-AURA-2CM"] },
  { sku: "DKT-LUMINA", displayName: "Lumina", family: "dekton", category: "dekton", hex: "#B8B4A8", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-LUMINA", "D-LUMINA-1.2CM", "D-LUMINA-2CM"] },
  { sku: "DKT-NILIUM", displayName: "Nilium", family: "dekton", category: "dekton", hex: "#4A4D52", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-NILIUM", "D-NILIUM-1.2CM", "D-NILIUM-2CM", "STN-DKT-NIL1.2", "STN-DKT-NIL2.0"] },
  { sku: "DKT-STRATO", displayName: "Strato", family: "dekton", category: "dekton", hex: "#7A7D7B", patternRepeatIn: null, wooMetaKey: "dekton", aliases: ["DEC-STRATO", "D-STRATO-1.2CM", "D-STRATO-2CM"] },

  // ── Frame Powder Coat (6) — Aluminum frames only on storefront ───────
  { sku: "PWD-BLACK", displayName: "Black", family: "powder", category: "powder", hex: "#1A1A1A", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: [] },
  { sku: "PWD-WHITE", displayName: "White", family: "powder", category: "powder", hex: "#F4F1EA", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: ["PWD-WILD-RICE"] },
  { sku: "PWD-OIL-RUB-BRONZE", displayName: "Bronze", family: "powder", category: "powder", hex: "#3B2F27", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: [] },
  { sku: "PWD-LITE-BEIGE", displayName: "Beige", family: "powder", category: "powder", hex: "#CDBFA6", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: [] },
  { sku: "PWD-BONE", displayName: "Bone", family: "powder", category: "powder", hex: "#E3DAC9", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: [] },
  { sku: "PWD-FANUC-GRAY", displayName: "Gray", family: "powder", category: "powder", hex: "#7C7F82", patternRepeatIn: null, wooMetaKey: "powder_coat", aliases: [] },
] as const;

export const ECOMMERCE_32_FINISH_COUNT = 32;

const BY_SKU: ReadonlyMap<string, EcommerceFinishDefinition> = new Map(
  ECOMMERCE_32_FINISHES.map((f) => [f.sku, f] as const),
);

const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of ECOMMERCE_32_FINISHES) {
    m.set(f.sku, f.sku);
    for (const a of f.aliases) m.set(a.toUpperCase(), f.sku);
  }
  return m;
})();

export function ecommerceFinishBySku(sku: string): EcommerceFinishDefinition | null {
  return BY_SKU.get(sku.trim().toUpperCase()) ?? null;
}

/** Resolve alias or canonical to the active e-commerce SKU. */
export function resolveEcommerceFinishSku(raw: string): string | null {
  const upper = raw.trim().toUpperCase();
  return ALIAS_TO_CANONICAL.get(upper) ?? null;
}

export function isEcommerce32FinishSku(sku: string): boolean {
  return BY_SKU.has(sku.trim().toUpperCase());
}

export function ecommerceFinishesByCategory(
  category: EcommerceFinishCategory,
): EcommerceFinishDefinition[] {
  return ECOMMERCE_32_FINISHES.filter((f) => f.category === category);
}

export function ecommerceFabricSkus(): string[] {
  return ecommerceFinishesByCategory("fabric").map((f) => f.sku);
}

export function ecommercePowderSkus(): string[] {
  return ecommerceFinishesByCategory("powder").map((f) => f.sku);
}

export function ecommerceDektonSkus(): string[] {
  return ecommerceFinishesByCategory("dekton").map((f) => f.sku);
}

export function ecommerceDektonEntries(): { sku: string; name: string; hex: string }[] {
  return ecommerceFinishesByCategory("dekton").map((f) => ({
    sku: f.sku,
    name: f.displayName,
    hex: f.hex,
  }));
}

export type FinishAssetLike = {
  sku: string;
  uploaded_by?: string | null;
  uploadedBy?: string | null;
};

/** Marker written when an operator mints a finish via the portal (+ Add Finish). */
export const ECOMMERCE_FINISH_OPERATOR_SENTINEL = "ecommerce:operator";

/**
 * Known legacy showroom fabric codes that must never ship in acf_*_swatches_json
 * or export feeds (Action Ash, etc.).
 */
export const LEGACY_SHOWROOM_FINISH_SKUS: ReadonlySet<string> = new Set([
  "FAB-ACT-ASH",
  "FAB-ACT-STO",
  "FAB-ADA-IND",
  "FAB-ADA-STO",
  "FAB-AGR-IND",
  "FAB-ARI-DEW",
  "FAB-ARR-CAR",
  "FAB-ARR-DUN",
  "FAB-ARR-CAL",
  "FAB-ASC-SPA",
  "FAB-ASC-TRO",
  "FAB-ASS-SAN",
  "FAB-ASS-IITEA",
  "FAB-AUT-PEB",
  "FAB-BER-TUX",
  "FAB-BLE-IND",
  "FAB-BLE-LIN",
  "FAB-BLE-SAN",
  "FAB-BLI-ALO",
  "FAB-BLI-DEW",
  "FAB-BLI-GUA",
  "FAB-BLI-LIN",
  "FAB-BLI-SAN",
  "PWD-WILD-RICE",
]);

export function isLegacyShowroomFinishSku(sku: string): boolean {
  return LEGACY_SHOWROOM_FINISH_SKUS.has(sku.trim().toUpperCase());
}

/**
 * Hide showroom / retired swatches from e-commerce views + Woo manifests.
 * Allows the exact 32 roster + operator-minted active finishes; excludes
 * archived (`ecommerce:disabled`) and legacy showroom codes (FAB-ACT-ASH…).
 */
export function isActiveEcommerceFinishAsset(row: FinishAssetLike): boolean {
  const uploaded = (row.uploaded_by ?? row.uploadedBy ?? "").trim().toLowerCase();
  if (uploaded === ECOMMERCE_FINISH_DISABLED_SENTINEL) return false;
  const sku = row.sku.trim().toUpperCase();
  if (isLegacyShowroomFinishSku(sku)) return false;
  if (isEcommerce32FinishSku(sku)) return true;
  // Operator-added active e-commerce finishes (portal mint).
  if (uploaded === ECOMMERCE_FINISH_OPERATOR_SENTINEL) return true;
  return false;
}

export function filterActiveEcommerceFinishes<T extends FinishAssetLike>(rows: T[]): T[] {
  return rows.filter(isActiveEcommerceFinishAsset);
}

/* ───────────────────── aluminum-only frame export ───────────────────── */

export type FrameExportOption = {
  sku: string;
  label: string;
  /** Steel upcharge fraction (0.10 = +10%). Never exported to Woo. */
  steelUpchargePct?: number | null;
};

/**
 * Aluminum-only storefront frame policy: MET-STEEL and any +10% steel upcharge
 * are stripped from Woo/PrimeView exports while Hub may still hold steel rows.
 */
export function filterAluminumOnlyFrameExport<T extends FrameExportOption>(
  options: T[],
): { exported: T[]; quarantined: Array<T & { reason: string }> } {
  const exported: T[] = [];
  const quarantined: Array<T & { reason: string }> = [];
  for (const opt of options) {
    const sku = opt.sku.trim().toUpperCase();
    const isSteel =
      sku === MET_STEEL_SKU ||
      sku.includes("STEEL") ||
      (opt.steelUpchargePct != null && opt.steelUpchargePct > 0 && sku !== MET_ALUM_SKU);
    if (isSteel) {
      quarantined.push({ ...opt, reason: STEEL_DISCONTINUED_REASON });
      continue;
    }
    exported.push({
      ...opt,
      steelUpchargePct: null,
    });
  }
  return { exported, quarantined };
}

/** Storefront frame finishes: Aluminum only. */
export function ecommerceStorefrontFrameSkus(): readonly string[] {
  return [MET_ALUM_SKU];
}

/** Hub retains Aluminum + Steel for factory reference. */
export function ecommerceFactoryFrameSkus(): readonly string[] {
  return [MET_STEEL_SKU, MET_ALUM_SKU];
}

/* ───────────────────── locked / auto-generated finish SKUs ───────────────────── */

export type FinishSkuFamilyInput = {
  category: EcommerceFinishCategory;
  /** Collection / line token (CAN, RIT, ALDEM…). */
  familyCode: string;
  /** Color / variant token (WHI, NEC, MOO…). */
  colorCode: string;
};

const RESERVED_FINISH_TOKENS = new Set([
  "FIN",
  "FAB",
  "PWD",
  "DKT",
  "DEC",
  "MET",
  "RM",
  "ASM",
  "SA",
  "3P",
]);

function cleanToken(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Deterministic finish SKU engine (FAB- / PWD- / DKT-).
 * SKUs are locked in the UI after mint — operators edit display names, not codes.
 */
export function buildFinishAutoSku(input: FinishSkuFamilyInput): string {
  const fam = cleanToken(input.familyCode);
  const col = cleanToken(input.colorCode);
  if (!fam || !col) throw new Error("Family and color codes are required for finish SKUs.");
  if (RESERVED_FINISH_TOKENS.has(fam) || RESERVED_FINISH_TOKENS.has(col)) {
    throw new Error(`Reserved token cannot be used in finish SKU (${fam}/${col}).`);
  }
  if (input.category === "fabric") return `FAB-${fam}-${col}`;
  if (input.category === "powder") {
    // Powders historically use PWD-{COLOR} or PWD-{MOD}-{COLOR}
    return fam === col ? `PWD-${col}` : `PWD-${fam}-${col}`;
  }
  return `DKT-${fam}${col === fam ? "" : `-${col}`}`.replace(/-$/, "");
}

/** Derive family/color tokens from a human display name for + row minting. */
export function tokensFromFinishDisplayName(
  displayName: string,
  category: EcommerceFinishCategory,
): FinishSkuFamilyInput {
  const parts = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Display name is required to mint a finish SKU.");
  }
  if (category === "dekton") {
    const fam = cleanToken(parts[0]!).slice(0, 8);
    return { category, familyCode: fam, colorCode: fam };
  }
  if (category === "powder") {
    const col = cleanToken(parts[parts.length - 1]!).slice(0, 10);
    return { category, familyCode: col, colorCode: col };
  }
  const fam = cleanToken(parts[0]!).slice(0, 3);
  const col = cleanToken(parts.slice(1).join(" ") || parts[0]!)
    .slice(0, 3)
    .padEnd(3, "X");
  return { category, familyCode: fam || "NEW", colorCode: col || "001" };
}

export async function generateCollisionCheckedFinishSku(
  input: FinishSkuFamilyInput,
  exists: (sku: string) => Promise<boolean>,
  maxAttempts = 20,
): Promise<{ sku: string; collided: boolean; attempts: number }> {
  const primary = buildFinishAutoSku(input);
  if (!(await exists(primary))) {
    return { sku: primary, collided: false, attempts: 1 };
  }
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    const alt = buildFinishAutoSku({
      ...input,
      colorCode: `${cleanToken(input.colorCode)}${attempt}`,
    });
    if (!(await exists(alt))) {
      return { sku: alt, collided: true, attempts: attempt };
    }
  }
  throw new Error(`Unable to allocate a free finish SKU after ${maxAttempts} attempts for ${primary}`);
}

/** SKU fields are always locked in the e-commerce UI. */
export function isFinishSkuLocked(_sku: string): boolean {
  return true;
}

export type EcommercePortalAccessInput = {
  email?: string | null;
  role?: string | null;
  /** When true (valid GHL iframe), Mia/Kian operate via the embed principal. */
  embedSession?: boolean;
};

/**
 * Executive Control Center gate: Mia, Kian, SuperAdmin, or a valid
 * executive GHL embed session. Non-executive showroom/floor roles are denied.
 */
export function canAccessEcommercePortal(input: EcommercePortalAccessInput): boolean {
  if (input.embedSession) return true;
  const email = (input.email ?? "").trim().toLowerCase();
  if (
    ECOMMERCE_PORTAL_OPERATOR_EMAILS.includes(
      email as (typeof ECOMMERCE_PORTAL_OPERATOR_EMAILS)[number],
    )
  ) {
    return true;
  }
  const role = (input.role ?? "").trim();
  return (
    role === "SuperAdmin" ||
    ECOMMERCE_PORTAL_ROLES.includes(role as (typeof ECOMMERCE_PORTAL_ROLES)[number])
  );
}

/** SuperAdmin-only jump to full Master Catalog / Mission Control. */
export function canAccessFullMasterCatalog(input: {
  email?: string | null;
  role?: string | null;
}): boolean {
  return (input.role ?? "").trim() === "SuperAdmin";
}

export type SkuAliasRecord = {
  aliasSku: string;
  canonicalSku: string;
  reason: string;
};

/** Flatten roster aliases for sku_aliases seeding / retirement bookkeeping. */
export function ecommerceFinishAliasRecords(): SkuAliasRecord[] {
  const out: SkuAliasRecord[] = [];
  for (const f of ECOMMERCE_32_FINISHES) {
    for (const alias of f.aliases) {
      out.push({
        aliasSku: alias.toUpperCase(),
        canonicalSku: f.sku,
        reason: `ecommerce-32-finish-roster:${f.displayName}`,
      });
    }
  }
  return out;
}

export function assertExact32Roster(): void {
  if (ECOMMERCE_32_FINISHES.length !== ECOMMERCE_32_FINISH_COUNT) {
    throw new Error(
      `E-commerce roster must be exactly ${ECOMMERCE_32_FINISH_COUNT}; got ${ECOMMERCE_32_FINISHES.length}`,
    );
  }
  const skus = new Set<string>();
  for (const f of ECOMMERCE_32_FINISHES) {
    if (skus.has(f.sku)) throw new Error(`Duplicate e-commerce finish SKU: ${f.sku}`);
    skus.add(f.sku);
  }
}
