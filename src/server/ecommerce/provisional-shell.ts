/**
 * Zero-quarantine provisional Katana shell helpers.
 * ONLY used when product_bom has 0 edges for a Make SKU.
 */

export const PROVISIONAL_BOM_STATUS = "provisional_shell" as const;
export const PROVISIONAL_RECIPE = ["RM-FAB-GENERIC", "RM-PWD-GENERIC"] as const;

export type ProvisionalShellSpec = {
  sku: string;
  productName: string;
  lengthIn: string | number | null;
  depthIn: string | number | null;
  heightIn: string | number | null;
  frameMetalSku?: string | null;
  fabricSku?: string | null;
  powderSku?: string | null;
  addons?: Array<{ key: string; sku: string }>;
};

export function isProvisionalShell(
  attributes: Record<string, unknown> | null | undefined,
): boolean {
  return attributes?.bom_status === PROVISIONAL_BOM_STATUS;
}

export function markProvisionalAttributes(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    bom_status: PROVISIONAL_BOM_STATUS,
    bom_readiness: "no_bom_yet",
  };
}

export function buildProvisionalFactoryBomNote(spec: ProvisionalShellSpec): string {
  const dims = [
    spec.lengthIn != null ? `L=${spec.lengthIn}` : null,
    spec.depthIn != null ? `D=${spec.depthIn}` : null,
    spec.heightIn != null ? `H=${spec.heightIn}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const addons =
    (spec.addons ?? []).map((a) => `${a.key}=${a.sku}`).join(", ") || "none";
  return [
    "[PROVISIONAL SKU — COMPLETE FACTORY BOM]",
    `sku=${spec.sku}`,
    `name=${spec.productName}`,
    dims ? `dims ${dims}` : "dims=unspecified",
    `frame_metal=${spec.frameMetalSku ?? "unspecified"}`,
    `fabric=${spec.fabricSku ?? "RM-FAB-GENERIC"}`,
    `powder=${spec.powderSku ?? "RM-PWD-GENERIC"}`,
    `addons=${addons}`,
  ].join(" | ");
}

export type ProvisionalBomEdge = {
  parent_sku: string;
  child_sku: string;
  quantity: string;
  unit_of_measure: string;
  notes: string;
};

/** Starter recipe edges — never call when product_bom already has rows. */
export function buildProvisionalBomEdges(parentSku: string): ProvisionalBomEdge[] {
  return PROVISIONAL_RECIPE.map((child) => ({
    parent_sku: parentSku.trim().toUpperCase(),
    child_sku: child,
    quantity: "1",
    unit_of_measure: "ea",
    notes: "provisional_shell starter row",
  }));
}
