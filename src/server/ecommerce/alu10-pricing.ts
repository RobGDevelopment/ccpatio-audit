/**
 * Aluminum-only (+10% over Steel base MSRP) e-commerce pricing engine.
 * Pure helpers — no I/O. Used by ops scripts, portal actions, CSV/handoff, and tests.
 * Keep free of scripts/ops imports so the App Router bundle stays clean.
 */

export const DEFAULT_ALU_UPCHARGE_PCT = 10;

export const FRAME_POLICY_ALU10 = "aluminum_only_10pct" as const;
export const FRAME_POLICY_NOT_APPLICABLE = "not_applicable" as const;
export const FRAME_POLICY_RESALE = "resale_map" as const;

export type FramePolicy =
  | typeof FRAME_POLICY_ALU10
  | typeof FRAME_POLICY_NOT_APPLICABLE
  | typeof FRAME_POLICY_RESALE;

export const STEEL_DISCONTINUED_REASON = "steel_discontinued_on_ecommerce";

export const WEB_ALUMINUM_ONLY_STAMP =
  "FRAME MATERIAL: ALUMINUM (WEB ALUMINUM-ONLY)" as const;

export const STOREFRONT_POLICY_BANNER =
  "Storefront Policy: Aluminum Only — Website Price from Mia PDF • Disregard Steel MSRP";

/** @deprecated Prefer STOREFRONT_POLICY_BANNER — kept for older imports. */
export const STOREFRONT_POLICY_BANNER_ALU10 =
  "Storefront Policy: Aluminum Only • +10% Over Steel Base MSRP";

/** Mia nearest-$5 rule used by New Product wizard + missing-PDF fallbacks. */
export function roundNearest5AluFromBase(baseCostOrMsrp: number): number {
  if (!Number.isFinite(baseCostOrMsrp) || baseCostOrMsrp < 0) {
    throw new Error(`Invalid base for nearest-$5: ${baseCostOrMsrp}`);
  }
  return Math.round((baseCostOrMsrp * 1.1) / 5) * 5;
}

export const CABANA_PILLOW_SKUS = [
  "FIN-CAB-MIS-17X17",
  "FIN-CAB-MIS-23X23",
  "FIN-CAB-MIS-12X24",
] as const;

/** Canonical Phase 1 resale stems (expand to 11 purchasable Woo SKUs via aliases). */
export const PHASE1_RESALE_CANONICAL = [
  "FIN-KIN-MIS",
  "FIN-TJM-MIS",
  "FIN-TJM-CHA",
  "FIN-TJM-TAB",
  "FIN-MLN-UMB",
  "FIN-CAN-UMB",
] as const;

export const TAYLOR_HALF_CENT_STEEL: ReadonlyArray<{
  sku: string;
  steel: number;
  alu110: number;
}> = [
  { sku: "FIN-TAY-BST-19X23", steel: 855, alu110: 940.5 },
  { sku: "FIN-TAY-BST-19X23", steel: 825, alu110: 907.5 },
  { sku: "FIN-TAY-BST-24X23", steel: 955, alu110: 1050.5 },
  { sku: "FIN-TAY-DIN-CHA-24X23", steel: 895, alu110: 984.5 },
];

export function parseMoneyNumber(
  value: string | number | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const raw = String(value).replace(/[$,\s]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** `round(steel * (1 + pct/100), 2)` — banker's-safe via cents integer. */
export function computeAluMsrp(
  steelMsrp: number,
  upchargePct: number = DEFAULT_ALU_UPCHARGE_PCT,
): number {
  if (!Number.isFinite(steelMsrp) || steelMsrp < 0) {
    throw new Error(`Invalid steel MSRP: ${steelMsrp}`);
  }
  if (!Number.isFinite(upchargePct) || upchargePct < 0) {
    throw new Error(`Invalid upcharge pct: ${upchargePct}`);
  }
  const cents = Math.round(steelMsrp * (1 + upchargePct / 100) * 100);
  return cents / 100;
}

export function roundAluToWholeDollar(aluMsrp: number): number {
  return Math.round(aluMsrp);
}

export function hasHalfCent(amount: number): boolean {
  const cents = Math.round(amount * 100);
  return cents % 100 === 50;
}

export function isCabanaPillowSku(sku: string): boolean {
  const upper = sku.trim().toUpperCase();
  return (
    CABANA_PILLOW_SKUS.includes(upper as (typeof CABANA_PILLOW_SKUS)[number]) ||
    /^FIN-CAB-MIS-/.test(upper)
  );
}

export function isPhase1ResaleCanonical(sku: string): boolean {
  const upper = sku.trim().toUpperCase().replace(/-(LS|RS)$/, "");
  // Strip known variation suffixes for Kindle / Tenjam aliases
  const stem = upper
    .replace(/-HEATER$/, "")
    .replace(/-LAMP$/, "")
    .replace(/-FREELO$/, "")
    .replace(/-MOON$/, "")
    .replace(/-LAYLO(-NORISER|-4RISER)?$/, "")
    .replace(/-2SHAYZ$/, "")
    .replace(/-SHAYZ-5$/, "")
    .replace(/-2WOOSAH$/, "")
    .replace(/-WOOSAH$/, "")
    .replace(/-LAYLO$/, "");
  return (PHASE1_RESALE_CANONICAL as readonly string[]).includes(stem) ||
    (PHASE1_RESALE_CANONICAL as readonly string[]).includes(upper) ||
    upper.startsWith("3P-");
}

export function classifyFramePolicy(input: {
  globalSku: string;
  isThirdParty?: boolean;
  attributes?: Record<string, unknown> | null;
}): FramePolicy {
  const attrs = input.attributes ?? {};
  const locked = attrs.frame_policy;
  if (
    locked === FRAME_POLICY_ALU10 ||
    locked === FRAME_POLICY_NOT_APPLICABLE ||
    locked === FRAME_POLICY_RESALE
  ) {
    return locked;
  }
  if (input.isThirdParty || isPhase1ResaleCanonical(input.globalSku)) {
    return FRAME_POLICY_RESALE;
  }
  if (isCabanaPillowSku(input.globalSku)) {
    return FRAME_POLICY_NOT_APPLICABLE;
  }
  return FRAME_POLICY_ALU10;
}

export function wooEcommercePrice(input: {
  steelMsrp: number | null;
  framePolicy: FramePolicy;
  upchargePct?: number;
  /** Mia manual lock — when true, return override instead of computed. */
  miaPriceLocked?: boolean;
  miaOverridePrice?: number | null;
}): number | null {
  if (input.miaPriceLocked && input.miaOverridePrice != null) {
    return input.miaOverridePrice;
  }
  if (input.steelMsrp == null || !Number.isFinite(input.steelMsrp)) return null;
  if (
    input.framePolicy === FRAME_POLICY_NOT_APPLICABLE ||
    input.framePolicy === FRAME_POLICY_RESALE
  ) {
    return Math.round(input.steelMsrp * 100) / 100;
  }
  return computeAluMsrp(input.steelMsrp, input.upchargePct ?? DEFAULT_ALU_UPCHARGE_PCT);
}

export function framePolicyBadge(policy: FramePolicy): string {
  switch (policy) {
    case FRAME_POLICY_ALU10:
      return "Aluminum +10%";
    case FRAME_POLICY_NOT_APPLICABLE:
      return "Pillow (No Frame)";
    case FRAME_POLICY_RESALE:
      return "3P Resale";
    default:
      return policy;
  }
}

export function readAluUpchargePct(
  attributes: Record<string, unknown> | null | undefined,
  fallback = DEFAULT_ALU_UPCHARGE_PCT,
): number {
  const raw = attributes?.alu_upcharge_pct;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return fallback;
}

export function isMiaPriceLocked(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  return attributes?.mia_price_locked === true;
}

export function buildAluAttributePatch(
  existing: Record<string, unknown> | null | undefined,
  input: {
    sowBaseSteelMsrp: number;
    framePolicy: FramePolicy;
    upchargePct?: number;
    wooAluMsrp: number;
  },
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    sow_base_steel_msrp: input.sowBaseSteelMsrp,
    frame_policy: input.framePolicy,
    alu_upcharge_pct: input.upchargePct ?? DEFAULT_ALU_UPCHARGE_PCT,
    woo_alu_msrp: input.wooAluMsrp,
    frame_material: input.framePolicy === FRAME_POLICY_ALU10 ? "Aluminum" : existing?.frame_material,
    storefront_metal: input.framePolicy === FRAME_POLICY_ALU10 ? "MET-ALUM" : existing?.storefront_metal,
  };
}

/** Bravada Club Chair golden fixture used across docs + tests. */
export const BRAVADA_CLUB_STEEL = 2080;
export const BRAVADA_CLUB_ALU110 = 2288;
export const BRAVADA_SWIVEL_STEEL = 2580;
export const BRAVADA_SWIVEL_ALU110 = 2838;
export const BRAVADA_LOVESEAT_STEEL = 2750;
export const BRAVADA_LOVESEAT_ALU110 = 3025;
