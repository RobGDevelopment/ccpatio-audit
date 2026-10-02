/**
 * Strict SKU-prefix → consume UoM for Katana material create payloads.
 *
 * Binding (Manufacturing Data, Phase 1 & 2 import):
 *   RM-MET-*        metals / extrusions → ft
 *   PWD-* / RM-PWD-* powder coat        → lb
 *   FAB-* / RM-FAB-* fabric             → yd
 *   RM-HRD-*        hardware            → ea
 *   RM-RAW-IRON-*   wood                → ea
 *
 * Hub aliases (RM-PWD, MET-, HRD-, Dekton, foam, primer) are included so
 * the next POST /materials step does not invent a second dictionary.
 */
export type InferredMaterialUom = {
  uom: string;
  katanaUom: string;
  rule: string;
};

const KATANA_UOM: Record<string, string> = {
  ea: "pcs",
  pc: "pcs",
  pcs: "pcs",
  ft: "ft",
  yd: "yd",
  lb: "lbs",
  lbs: "lbs",
  slab: "slab",
  boardft: "boardft",
  sqft: "ft2",
};

export function toKatanaMaterialUom(uom: string): string {
  const key = uom.trim().toLowerCase();
  return KATANA_UOM[key] ?? key.slice(0, 7);
}

export function inferMaterialUom(sku: string): InferredMaterialUom {
  const s = sku.trim().toUpperCase();

  if (s.startsWith("RM-RAW-IRON-")) {
    return pack("ea", "RM-RAW-IRON-*");
  }
  if (s.startsWith("RM-MET-") || s.startsWith("MET-")) {
    return pack("ft", s.startsWith("MET-") ? "MET-*" : "RM-MET-*");
  }
  if (s.startsWith("RM-HRD-") || s.startsWith("HRD-")) {
    return pack("ea", s.startsWith("HRD-") ? "HRD-*" : "RM-HRD-*");
  }
  if (
    s.startsWith("RM-PRM-") ||
    s.startsWith("PRM-") ||
    s.includes("PRIMER")
  ) {
    return pack("lb", "PRM-/PRIMER");
  }
  if (s.startsWith("PWD-") || s.startsWith("RM-PWD-")) {
    return pack("lb", s.startsWith("RM-PWD-") ? "RM-PWD-*" : "PWD-*");
  }
  if (s.startsWith("FAB-") || s.startsWith("RM-FAB-")) {
    return pack("yd", s.startsWith("RM-FAB-") ? "RM-FAB-*" : "FAB-*");
  }
  if (
    s.startsWith("RM-DKT-") ||
    s.startsWith("DKT-") ||
    s.startsWith("STN-")
  ) {
    return pack("slab", "RM-DKT-/DKT-/STN-*");
  }
  if (s.includes("FOAM")) {
    return pack("boardft", "FOAM");
  }
  if (s.startsWith("RM-RAW-")) {
    return pack("ea", "RM-RAW-* default ea");
  }
  return pack("ea", "default ea");
}

function pack(uom: string, rule: string): InferredMaterialUom {
  return { uom, katanaUom: toKatanaMaterialUom(uom), rule };
}
