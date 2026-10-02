/**
 * Classifier for surgical Katana material purge + remint.
 *
 * Binding: do NOT delete all blank-SKU placeholders. Six of them are the
 * missing Hub RM-* materials and must be PATCH-reminted (SKU + UoM).
 *
 * SA-/ASM-/FIN-/CUT- parked as materials are an architectural violation:
 *   - product twin + bom_row_count === 0 → DELETE (duplicate material copy)
 *   - no product twin + bom_row_count === 0 → DELETE (orphaned ghost; SKU
 *     would block future product creation)
 *   - bom_row_count > 0 → SKIP (legacy Phase 3/4 still consuming it)
 */

export type PurgeAction =
  | "delete"
  | "skip"
  | "remint"; // blank Hub canonical — Phase B owns these; purge never deletes

export type PurgeReason =
  | "weldment_with_product_twin"
  | "weldment_orphan_ghost"
  | "weldment_on_bom"
  | "blank_twin_of_reminted_rm"
  | "blank_unused_metal_ring"
  | "blank_hub_remint_target"
  | "blank_unknown"
  | "keep_catalog";

export type ClassifyInput = {
  sku: string | null | undefined;
  name: string | null | undefined;
  /** True when a product variant exists with the same SKU. */
  hasProductTwin: boolean;
  /** Count of bom_rows that reference this material's variant_id. */
  bomRowCount: number;
};

export type ClassifyResult = {
  action: PurgeAction;
  reason: PurgeReason;
};

/** Hub blanks that Phase B remints — never DELETE in Phase A. */
export const HUB_REMINT_TARGETS: ReadonlyArray<{
  name: string;
  sku: string;
}> = [
  { name: "Spacers", sku: "RM-HRD-SPACERS" },
  { name: "Umbrella Holder", sku: "RM-HRD-UMBRELLA-HOLDER" },
  { name: "2x3/4 Tubing", sku: "RM-MET-2X075-TUBING" },
  { name: "Flatbar", sku: "RM-MET-FLATBAR" },
  { name: "Foam", sku: "RM-RAW-FOAM" },
  { name: "Iron Wood", sku: "RM-RAW-IRON-WOOD" },
] as const;

/**
 * Blank-SKU factory twins of already-reminted RM-* (safe to DELETE).
 * Names normalized via normalizeMaterialName before compare.
 */
export const BLANK_TWIN_NAMES: ReadonlySet<string> = new Set(
  [
    "2x2 Tubing",
    "1.5x3/4 Tubing",
    "2x1 Tubing / 20'",
    "2x2 Metal Cap",
    "Fabric",
    "Dekton",
  ].map(normalizeMaterialName),
);

/** Unused blank placeholder — DELETE (or remint separately later). */
export const BLANK_UNUSED_NAMES: ReadonlySet<string> = new Set(
  ["Metal ring"].map(normalizeMaterialName),
);

const HUB_REMINT_NAME_SET: ReadonlySet<string> = new Set(
  HUB_REMINT_TARGETS.map((t) => normalizeMaterialName(t.name)),
);

const HUB_REMINT_BY_NAME: ReadonlyMap<string, string> = new Map(
  HUB_REMINT_TARGETS.map((t) => [normalizeMaterialName(t.name), t.sku]),
);

export function normalizeMaterialName(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeSku(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

export function isWeldmentSku(sku: string): boolean {
  return /^(SA-|ASM-|FIN-|CUT-)/.test(sku);
}

export function isHubRemintName(name: string | null | undefined): boolean {
  return HUB_REMINT_NAME_SET.has(normalizeMaterialName(name));
}

export function hubRemintSkuForName(
  name: string | null | undefined,
): string | null {
  return HUB_REMINT_BY_NAME.get(normalizeMaterialName(name)) ?? null;
}

export function isBlankTwinName(name: string | null | undefined): boolean {
  return BLANK_TWIN_NAMES.has(normalizeMaterialName(name));
}

export function isBlankUnusedName(name: string | null | undefined): boolean {
  return BLANK_UNUSED_NAMES.has(normalizeMaterialName(name));
}

/**
 * Decide purge action for one material row.
 * Callers must supply product-twin + bom_row facts from live Katana.
 */
export function classifyMaterialForPurge(
  input: ClassifyInput,
): ClassifyResult {
  const sku = normalizeSku(input.sku);
  const name = input.name ?? "";

  if (!sku) {
    if (isHubRemintName(name)) {
      return { action: "remint", reason: "blank_hub_remint_target" };
    }
    if (isBlankTwinName(name)) {
      if (input.bomRowCount > 0) {
        return { action: "skip", reason: "weldment_on_bom" };
      }
      return { action: "delete", reason: "blank_twin_of_reminted_rm" };
    }
    if (isBlankUnusedName(name)) {
      if (input.bomRowCount > 0) {
        return { action: "skip", reason: "weldment_on_bom" };
      }
      return { action: "delete", reason: "blank_unused_metal_ring" };
    }
    return { action: "skip", reason: "blank_unknown" };
  }

  if (isWeldmentSku(sku)) {
    // Protect factory floor: anything still on a recipe stays.
    if (input.bomRowCount > 0) {
      return { action: "skip", reason: "weldment_on_bom" };
    }
    if (input.hasProductTwin) {
      return { action: "delete", reason: "weldment_with_product_twin" };
    }
    // Orphaned ghost — material-only weldment with no consumers.
    return { action: "delete", reason: "weldment_orphan_ghost" };
  }

  return { action: "skip", reason: "keep_catalog" };
}
