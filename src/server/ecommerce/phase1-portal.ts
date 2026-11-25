/**
 * Phase 1 E-Commerce portal view helpers for the GHL master-catalog UI.
 * Keep this free of scripts/ops imports so the App Router bundle stays clean.
 *
 * Active e-commerce finishes are the exact 32 from `ecommerce-32-finish-roster`
 * (Sunbrella 16 + Ultraleather 4 + Dekton 6 + Powder 6). Non-matching showroom
 * swatches stay in Hub but are hidden from e-commerce views / Woo exports.
 */

import {
  ecommerceDektonEntries,
  ecommerceFabricSkus,
  ecommerceFactoryFrameSkus,
  ecommercePowderSkus,
  ecommerceStorefrontFrameSkus,
  isEcommerce32FinishSku,
} from "./ecommerce-32-finish-roster";

export type Phase1PortalView =
  | "phase1_parents"
  | "phase1_flat"
  | "finishes_addons"
  | "all_hub";

export const PHASE1_VIEW_LABELS: Record<Phase1PortalView, string> = {
  phase1_parents: "Phase 1 Storefront Parents (47)",
  phase1_flat: "Phase 1 Flat Sheet Grid (107 Variations / 102 SOW)",
  finishes_addons: "Global Finishes & Add-Ons (32)",
  all_hub: "All Hub SKUs",
};

export const PHASE1_LAUNCH_BANNER =
  "Phase 1 Launch (47 Products • 102 SOW Items • 107 Variations • 32 Finishes)";

export { STOREFRONT_POLICY_BANNER } from "./alu10-pricing";

/** Exact 20 e-commerce fabrics (16 Sunbrella + 4 Ultraleather). */
export const PHASE1_FABRICS = ecommerceFabricSkus() as readonly string[] & { readonly length: 20 };

/** Exact 6 e-commerce powder coats (Aluminum frames only on storefront). */
export const PHASE1_POWDERS = ecommercePowderSkus() as readonly string[] & { readonly length: 6 };

/**
 * Exact 6 e-commerce Dekton (DKT-*) swatches. Hex values are visual
 * approximations until photoshoot-grade textures are uploaded.
 */
export const PHASE1_DEKTONS = ecommerceDektonEntries() as readonly {
  sku: string;
  name: string;
  hex: string;
}[];

/** Storefront is Aluminum-only; Steel remains a factory material but is hidden on web. */
export const PHASE1_FRAME_FINISHES = ecommerceStorefrontFrameSkus();
export const PHASE1_FRAME_FINISHES_FACTORY = ecommerceFactoryFrameSkus();

/** Woo parent IDs that require Select Facing L/R variation pairs. */
export const FACING_PARENT_IDS = new Set(["27674", "27687"]);

export const FACING_OPTIONS = [
  { code: "LS", label: "Left-Side Facing" },
  { code: "RS", label: "Right-Side Facing" },
] as const;

export const PHASE1_ADDON_ACF_KEYS = [
  "ironwood",
  "dekton_sidearm",
  "arms",
  "arms_8_thick_textile-wrapped",
  "casters",
  "fly_tables",
  "fly_table_13_x_30",
  "fly_table_12_x_36_welded_on_back",
  "fly_table_12_x_48_welded_on_back",
  "umbrella_holder",
  "umbrella_cover",
  "coated_led_weight",
  "pillow_for_loungers_w_pocket",
  "base_w_wheels",
  "base",
  "wheels",
] as const;

/** Drop $0.00 QBO noise and non-launch rows for the default Phase 1 view. */
export function isPhase1StorefrontRow(input: {
  globalSku: string;
  msrpValue: number | null;
}): boolean {
  const sku = input.globalSku.trim().toUpperCase();
  if (!sku.startsWith("FIN-") && !sku.startsWith("3P-")) return false;
  if (input.msrpValue != null && input.msrpValue <= 0) return false;
  return true;
}

export function isFinishOrAddonSku(sku: string): boolean {
  const upper = sku.trim().toUpperCase();
  if (isEcommerce32FinishSku(upper)) return true;
  if (PHASE1_FRAME_FINISHES.includes(upper as (typeof PHASE1_FRAME_FINISHES)[number])) {
    return true;
  }
  return (
    upper.startsWith("FAB-") ||
    upper.startsWith("PWD-") ||
    upper.startsWith("DKT-") ||
    upper.startsWith("DEC-") ||
    upper.startsWith("MET-") ||
    upper.includes("-ADDIRONWOOD") ||
    upper.includes("FLYTBL") ||
    upper.includes("WEATHERPROOF")
  );
}

export function shippingClassFromLb(weightLb: number): "parcel" | "freight-ltl" {
  return weightLb >= 50 ? "freight-ltl" : "parcel";
}

export function readMiaApproval(attributes: Record<string, unknown> | null | undefined): {
  approved: boolean;
  approvedAt: string | null;
} {
  const attrs = attributes ?? {};
  return {
    approved: attrs.mia_phase1_approved === true,
    approvedAt:
      typeof attrs.mia_approved_at === "string" ? attrs.mia_approved_at : null,
  };
}

export function writeMiaApproval(
  attributes: Record<string, unknown> | null | undefined,
  approved: boolean,
  now = new Date(),
): Record<string, unknown> {
  const next = { ...(attributes ?? {}) };
  next.mia_phase1_approved = approved;
  next.mia_approved_at = approved ? now.toISOString() : null;
  return next;
}

export function groupParentsByWooId<T extends { wooProductId: string | null; globalSku: string }>(
  listings: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of listings) {
    const key = row.wooProductId?.trim() || `sku:${row.globalSku}`;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}
