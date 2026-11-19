/**
 * Phase B1 / pipe-hardening: the finish contract between Primeview (WooCommerce) and the hub.
 *
 * Accepted finish slots (operator decision D2 + Dekton table tops):
 *
 *   fabric       FAB-*   upholstered items
 *   powder_coat  PWD-*   powder-coated frames
 *   frame        MET-*   MET-ALUM (storefront Aluminum-only; MET-STEEL quarantined on web Make)
 *   dekton       DKT-*   table/daybed/swing Dekton tops (swaps RM-DKT-GENERIC-SLAB)
 *
 * Aliases (accepted as the slot): `fabric_sku` → fabric, `frame_material` → frame.
 * Pure module: no I/O, no DB. Hub checks live in `sku-resolver.ts`.
 */

export const MET_ALUM_SKU = "MET-ALUM";
export const MET_STEEL_SKU = "MET-STEEL";

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
 * Accepted aliases for finish slots — canonical ACF keys PLUS human APF
 * (`wc-product-fields`) labels PrimeView may send in `line_items[].meta_data`.
 */
export const FINISH_KEY_ALIASES: Readonly<Record<string, FinishSlot>> = {
  fabric_sku: "fabric",
  frame_material: "frame",
  // Human APF fabric labels
  select_fabric: "fabric",
  choose_fabric: "fabric",
  fabric_swatch: "fabric",
  cushion_fabric: "fabric",
  "cushion-fabric": "fabric",
  // Human APF powder labels
  select_powder_coat: "powder_coat",
  choose_powder_coat: "powder_coat",
  powder_coat_finish: "powder_coat",
  powder_finish: "powder_coat",
  select_finish: "powder_coat",
  powder: "powder_coat",
  "powder-coat": "powder_coat",
  powdercoat: "powder_coat",
  // Human APF frame labels
  select_frame: "frame",
  select_frame_type: "frame",
  choose_frame: "frame",
  frame_type: "frame",
  "frame-type": "frame",
  metal: "frame",
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
 *
 * Human APF fabric/powder/frame labels live in FINISH_KEY_ALIASES (accepted), not here.
 */
const REJECTED_FINISH_KEYS: Readonly<Record<string, string>> = {
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

/** Embedded Hub finish SKU inside a human display string. */
export const EMBEDDED_FINISH_SKU_RE =
  /\b(FAB-[A-Z0-9-]+|PWD-[A-Z0-9-]+|DEC-[A-Z0-9-]+|MET-[A-Z0-9-]+|DKT-[A-Z0-9-]+)\b/i;

/**
 * Phase 1 fabric display-name → Hub SKU (case-insensitive). Includes short
 * color nicknames ("Ash") and full curated labels ("Action Ash").
 */
export const PHASE1_FABRIC_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "FAB-ACT-ASH": "Action Ash",
  "FAB-ACT-STO": "Action Stone",
  "FAB-ADA-IND": "Adaptation Indigo",
  "FAB-ADA-STO": "Adaptation Stone",
  "FAB-AGR-IND": "Agra Indigo",
  "FAB-ARI-DEW": "Ariana Dew",
  "FAB-ARR-CAR": "Array Caribbean",
  "FAB-ARR-DUN": "Array Dune",
  "FAB-ARR-CAL": "Array Calypso",
  "FAB-ASC-SPA": "Ascend Spa",
  "FAB-ASC-TRO": "Ascend Tropical",
  "FAB-ASS-SAN": "Assemble Sand",
  "FAB-ASS-IITEA": "Assemble II Teak",
  "FAB-AUT-PEB": "Authentic Pebble",
  "FAB-BER-TUX": "Berenson Tuxedo",
  "FAB-BEA-ULT": "Beacon Ultraleather",
  "FAB-BLE-IND": "Blend Indigo",
  "FAB-BLE-LIN": "Blend Linen",
  "FAB-BLE-SAN": "Blend Sand",
  "FAB-BLI-ALO": "Bliss Aloe",
  "FAB-BLI-DEW": "Bliss Dew",
  "FAB-BLI-GUA": "Bliss Guava",
  "FAB-BLI-LIN": "Bliss Linen",
  "FAB-BLI-SAN": "Bliss Sand",
};

/** Phase 1 powder-coat display-name → Hub SKU. */
export const PHASE1_POWDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  "PWD-BLACK": "Black",
  "PWD-BONE": "Bone",
  "PWD-FANUC-GRAY": "Fanuc Gray",
  "PWD-LITE-BEIGE": "Lite Beige",
  "PWD-OIL-RUB-BRONZE": "Oil Rubbed Bronze",
  "PWD-WILD-RICE": "Wild Rice",
};

const FABRIC_NAME_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [sku, label] of Object.entries(PHASE1_FABRIC_DISPLAY_NAMES)) {
    m.set(label.toLowerCase(), sku);
    const short = label.split(/\s+/).pop();
    if (short && short.length >= 3) m.set(short.toLowerCase(), sku);
    // Also index "Ash" style from SKU tail for common APF values
    const tail = sku.split("-").pop();
    if (tail && tail.length >= 3) {
      const pretty =
        tail === "ASH"
          ? "ash"
          : tail === "STO"
            ? "stone"
            : tail.toLowerCase();
      if (!m.has(pretty)) m.set(pretty, sku);
    }
  }
  // Explicit short nicknames used in APF tests / storefront
  m.set("ash", "FAB-ACT-ASH");
  m.set("canvas", "FAB-ACT-ASH");
  return m;
})();

const POWDER_NAME_INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [sku, label] of Object.entries(PHASE1_POWDER_DISPLAY_NAMES)) {
    m.set(label.toLowerCase(), sku);
    m.set(`matte ${label.toLowerCase()}`, sku);
  }
  m.set("matte black", "PWD-BLACK");
  m.set("black", "PWD-BLACK");
  return m;
})();

/**
 * Resolve a finish meta value to a Hub SKU:
 * 1. bare Hub SKU (`FAB-ACT-ASH`)
 * 2. embedded parenthetical/hyphenated (`Canvas (FAB-ACT-ASH)`, `Matte Black - PWD-BLACK`)
 * 3. exact case-insensitive Phase 1 display name
 */
export function resolveFinishValueToSku(
  raw: string,
  slotHint?: FinishSlot,
): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const embedded = trimmed.match(EMBEDDED_FINISH_SKU_RE);
  if (embedded?.[1]) return normalizeSku(embedded[1]);

  const upper = normalizeSku(trimmed);
  if (/^(FAB|PWD|MET|DKT|DEC)-[A-Z0-9-]+$/.test(upper)) return upper;

  // Frame human labels (Aluminum / Steel)
  if (!slotHint || slotHint === "frame") {
    const frame = normalizeFrameMaterialValue(trimmed);
    if (frame === MET_ALUM_SKU || frame === MET_STEEL_SKU) return frame;
  }

  const lower = trimmed.toLowerCase().replace(/\s+/g, " ").trim();
  if (!slotHint || slotHint === "fabric") {
    const fab = FABRIC_NAME_INDEX.get(lower);
    if (fab) return fab;
  }
  if (!slotHint || slotHint === "powder_coat") {
    const pwd = POWDER_NAME_INDEX.get(lower);
    if (pwd) return pwd;
  }
  return upper;
}

/**
 * Lowercase, trim, strip WooCommerce attribute prefixes (`attribute_`, `pa_`) repeatedly and a
 * leading underscore. Spaces become underscores so human APF labels (`Select Fabric`) normalize
 * cleanly; hyphens are preserved and aliased explicitly (`powder-coat` → powder_coat slot).
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

/**
 * Map human / ACF frame labels onto Hub MET-* SKUs.
 * "Aluminum" / "Aluminium" → MET-ALUM; "Steel" → MET-STEEL.
 */
export function normalizeFrameMaterialValue(raw: string): string {
  const n = normalizeSku(raw).replace(/\s+/g, "-");
  if (
    n === "ALUMINUM" ||
    n === "ALUMINIUM" ||
    n === "ALU" ||
    n === "MET-ALUM" ||
    n === "MET-ALUMINUM" ||
    n === "MET-ALUMINIUM"
  ) {
    return MET_ALUM_SKU;
  }
  if (n === "STEEL" || n === "MET-STEEL" || n === "MET-STEEL-FRAME") {
    return MET_STEEL_SKU;
  }
  return n;
}

export function isSteelFrameMaterial(raw: string): boolean {
  return normalizeFrameMaterialValue(raw) === MET_STEEL_SKU;
}

export function isAluminumFrameMaterial(raw: string): boolean {
  return normalizeFrameMaterialValue(raw) === MET_ALUM_SKU;
}
