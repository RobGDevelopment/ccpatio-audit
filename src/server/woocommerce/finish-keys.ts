/**
 * Phase B1: the finish contract between Primeview (WooCommerce) and the hub.
 *
 * The ONLY accepted finish keys are `fabric`, `powder_coat` and `frame` (operator decision D2).
 * Primeview sends them as line-item `meta_data` entries whose value is a hub SKU:
 *
 *   fabric       FAB-*   upholstered items, 20-30 fabrics
 *   powder_coat  PWD-*   powder-coated frames
 *   frame        MET-*   MET-ALUM or MET-STEEL (strict metadata mapping)
 *
 * Pure module: no I/O, no DB. The DB-backed checks (does the SKU exist, is it `web_sellable`)
 * live in `sku-resolver.ts`.
 */

export const FINISH_SLOTS = ["fabric", "powder_coat", "frame"] as const;
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

export const FINISH_RULES: Readonly<Record<FinishSlot, FinishRule>> = {
  fabric: { requiredPrefix: "FAB", placeholderSku: "RM-FAB-GENERIC" },
  powder_coat: { requiredPrefix: "PWD", placeholderSku: "RM-PWD-GENERIC" },
  frame: { requiredPrefix: "MET", placeholderSku: FRAME_PLACEHOLDER_SKU },
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
 * Keys that SELECT A PHYSICAL MATERIAL under a name B1 does not accept. Silently dropping them
 * would build the wrong item, so an order carrying one is quarantined with the hint below.
 * Keys that are not here and are not a finish slot are ignored (they do not pick a material).
 */
const REJECTED_FINISH_KEYS: Readonly<Record<string, string>> = {
  cushion_fabric: "fabric",
  "cushion-fabric": "fabric",
  fabric_sku: "fabric",
  powder: "powder_coat",
  "powder-coat": "powder_coat",
  powdercoat: "powder_coat",
  frame_type: "frame",
  "frame-type": "frame",
  metal: "frame",
  stone: "(not supported in Phase B1)",
  dekton: "(not supported in Phase B1)",
  shade: "(not supported in Phase B1)",
  umbrella: "(not supported in Phase B1)",
  scolaro: "(not supported in Phase B1)",
  furniture: "(not supported in Phase B1)",
  tenjam: "(not supported in Phase B1)",
  finished_good: "(not supported in Phase B1)",
  "finished-good": "(not supported in Phase B1)",
  firepit: "(not supported in Phase B1)",
  pillow: "(pillow fabrics are deferred)",
  pillow_fabric: "(pillow fabrics are deferred)",
  "pillow-fabric": "(pillow fabrics are deferred)",
};

/**
 * Lowercase, trim, strip WooCommerce attribute prefixes (`attribute_`, `pa_`) and a leading
 * underscore. Hyphens are NOT rewritten: `powder-coat` must stay distinguishable from
 * `powder_coat` so a near-miss is rejected rather than silently accepted.
 */
export function normalizeFinishKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^attribute_/, "")
    .replace(/^pa_/, "")
    .replace(/^_/, "")
    .replace(/\s+/g, "_");
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
