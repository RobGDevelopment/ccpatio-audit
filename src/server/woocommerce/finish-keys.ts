/**
 * Phase B1 / pipe-hardening: the finish contract between Primeview (WooCommerce) and the hub.
 *
 * Accepted finish slots (operator decision D2 + Dekton table tops):
 *
 *   fabric       FAB-*   upholstered items
 *   powder_coat  PWD-*   powder-coated frames
 *   frame        MET-*   MET-ALUM or MET-STEEL
 *   dekton       DKT-*   table/daybed/swing Dekton tops (swaps RM-DKT-GENERIC-SLAB)
 *
 * Aliases (accepted as the slot): `fabric_sku` → fabric, `frame_material` → frame.
 * Pure module: no I/O, no DB. Hub checks live in `sku-resolver.ts`.
 */

export const FINISH_SLOTS = ["fabric", "powder_coat", "frame", "dekton"] as const;
export type FinishSlot = (typeof FINISH_SLOTS)[number];

export type FinishRule = {
  /** Required `<PREFIX>-` of the finish SKU (the segment before the first dash). */
  requiredPrefix: string;
  /**
   * Generic placeholder recipe row in Katana that the customer's SKU replaces on the MO tree.
   * `null` means B1 cannot swap a recipe row for this slot (attribute-only until provisioned).
   */
  placeholderSku: string | null;
};

/**
 * `frame` has no Katana placeholder yet (no `RM-FRAME-GENERIC` is provisioned). The swap is
 * automatic once a recipe contains this SKU; until then the frame is validated, written to the
 * SO row attributes / additional_info, and NOT swapped on the MO.
 */
export const FRAME_PLACEHOLDER_SKU = "RM-FRAME-GENERIC";

export const DEKTON_PLACEHOLDER_SKU = "RM-DKT-GENERIC-SLAB";

export const FINISH_RULES: Readonly<Record<FinishSlot, FinishRule>> = {
  fabric: { requiredPrefix: "FAB", placeholderSku: "RM-FAB-GENERIC" },
  powder_coat: { requiredPrefix: "PWD", placeholderSku: "RM-PWD-GENERIC" },
  frame: { requiredPrefix: "MET", placeholderSku: FRAME_PLACEHOLDER_SKU },
  dekton: { requiredPrefix: "DKT", placeholderSku: DEKTON_PLACEHOLDER_SKU },
};

/**
 * Accepted aliases for finish slots. These SELECT a physical material under a PrimeView ACF
 * name that is not the canonical slot key — accept them, do not quarantine.
 */
export const FINISH_KEY_ALIASES: Readonly<Record<string, FinishSlot>> = {
  fabric_sku: "fabric",
  frame_material: "frame",
};

/** Placeholder SKUs B1 knows how to bind. Any other `RM-*-GENERIC` in a recipe is unsupported. */
export const SUPPORTED_PLACEHOLDER_SKUS: ReadonlySet<string> = new Set(
  FINISH_SLOTS.map((slot) => FINISH_RULES[slot].placeholderSku).filter(
    (sku): sku is string => sku !== null,
  ),
);

export function isGenericPlaceholderSku(sku: string): boolean {
  return /^RM-.*-GENERIC/.test(sku);
}

/**
 * Corner Sofa / Corner Chaise facing attributes from WooCommerce.
 * Facing is encoded in the variation SKU (`-LS` / `-RS`); these meta keys must never
 * quarantine as unknown finish selectors.
 */
export const FACING_META_KEYS: ReadonlySet<string> = new Set([
  "facing",
  "select_facing",
  "select-facing",
]);

/**
 * Keys that SELECT A PHYSICAL MATERIAL under a name B1 does not accept. Silently dropping them
 * would build the wrong item, so an order carrying one is quarantined with the hint below.
 * Keys that are not here and are not a finish slot are ignored (they do not pick a material).
 */
const REJECTED_FINISH_KEYS: Readonly<Record<string, string>> = {
  cushion_fabric: "fabric",
  "cushion-fabric": "fabric",
  powder: "powder_coat",
  "powder-coat": "powder_coat",
  powdercoat: "powder_coat",
  frame_type: "frame",
  "frame-type": "frame",
  metal: "frame",
  stone: "(not supported)",
  shade: "(not supported)",
  umbrella: "(not supported)",
  scolaro: "(not supported)",
  furniture: "(not supported)",
  tenjam: "(not supported)",
  finished_good: "(not supported)",
  "finished-good": "(not supported)",
  firepit: "(not supported)",
  pillow: "(pillow fabrics are deferred)",
  pillow_fabric: "(pillow fabrics are deferred)",
  "pillow-fabric": "(pillow fabrics are deferred)",
};

/**
 * Lowercase, trim, strip WooCommerce attribute prefixes (`attribute_`, `pa_`) repeatedly and a
 * leading underscore. Hyphens are NOT rewritten: `powder-coat` must stay distinguishable from
 * `powder_coat` so a near-miss is rejected rather than silently accepted.
 */
export function normalizeFinishKey(raw: string): string {
  let key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  // Strip nested Woo prefixes cleanly: attribute_pa_fabric → fabric, pa_attribute_frame → frame.
  let prev = "";
  while (key !== prev) {
    prev = key;
    key = key.replace(/^attribute_/, "").replace(/^pa_/, "").replace(/^_/, "");
  }
  return key;
}

export type FinishKeyClass =
  | { kind: "slot"; slot: FinishSlot }
  | { kind: "rejected"; normalizedKey: string; use: string }
  | { kind: "ignored" };

export function classifyFinishKey(rawKey: string): FinishKeyClass {
  const key = normalizeFinishKey(rawKey);
  if ((FINISH_SLOTS as readonly string[]).includes(key)) {
    return { kind: "slot", slot: key as FinishSlot };
  }
  const alias = FINISH_KEY_ALIASES[key];
  if (alias !== undefined) return { kind: "slot", slot: alias };
  // Facing dropdown meta (attribute_pa_select-facing → select-facing) is informational.
  if (FACING_META_KEYS.has(key)) return { kind: "ignored" };
  const use = REJECTED_FINISH_KEYS[key];
  if (use !== undefined) return { kind: "rejected", normalizedKey: key, use };
  return { kind: "ignored" };
}

export function normalizeSku(value: string): string {
  return value.trim().toUpperCase();
}

export function skuPrefix(sku: string): string {
  const dash = sku.indexOf("-");
  return dash === -1 ? sku : sku.slice(0, dash);
}
