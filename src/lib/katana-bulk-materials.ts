/**
 * The 13 Katana bulk materials from docs/katana_live_state (pull 2026-09-01).
 * IDs are copied from the live dump — never invented.
 *
 * These are factory cut-list placeholders (empty Katana SKU). They are not
 * FAB-* colorways or STN-DKT-* slabs.
 */

export type KatanaBulkMaterialSeed = {
  globalSku: string;
  name: string;
  category: string;
  /** PIM consume UOM (sku_mappings.uom_consume). */
  uomConsume: string;
  /** Native Katana UOM string. */
  katanaUom: string;
  katanaMaterialId: number;
  katanaVariantId: number;
  baseCost: string | null;
  notes: string;
};

export const KATANA_LIVE_PULL_AT = "2026-09-01T01:00:23.665Z";
export const KATANA_IDENTITY_SOURCE = "docs/katana_live_state/materials.json";

export const KATANA_BULK_MATERIALS: readonly KatanaBulkMaterialSeed[] = [
  {
    globalSku: "RM-MET-2X2-TUBING",
    name: "2x2 Tubing",
    category: "Metal",
    uomConsume: "ft",
    katanaUom: "Ft",
    katanaMaterialId: 10592485,
    katanaVariantId: 23143123,
    baseCost: "1.8300",
    notes: "16 Gauge. Purchasing cousins: MET-SQT20016, MET-TB22060.",
  },
  {
    globalSku: "RM-MET-2X1-TUBING",
    name: "2x1 Tubing",
    category: "Metal",
    uomConsume: "ft",
    katanaUom: "Ft",
    katanaMaterialId: 10592707,
    katanaVariantId: 23143509,
    baseCost: "1.3900",
    notes: "Katana config Length=20'. Purchasing cousin: MET-TB21060.",
  },
  {
    globalSku: "RM-MET-15X075-TUBING",
    name: "1.5x3/4 Tubing",
    category: "Metal",
    uomConsume: "ft",
    katanaUom: "Ft",
    katanaMaterialId: 10592490,
    katanaVariantId: 23143128,
    baseCost: "1.0000",
    notes: "16 Gauge. Purchasing cousin: MET-TB11234060.",
  },
  {
    globalSku: "RM-MET-2X075-TUBING",
    name: "2x3/4 Tubing",
    category: "Metal",
    uomConsume: "ft",
    katanaUom: "Ft",
    katanaMaterialId: 10592711,
    katanaVariantId: 23143516,
    baseCost: "2.1400",
    notes: "Purchasing cousin: MET-TB234060.",
  },
  {
    globalSku: "RM-MET-FLATBAR",
    name: "Flatbar",
    category: "Metal",
    uomConsume: "ft",
    katanaUom: "Ft",
    katanaMaterialId: 10592493,
    katanaVariantId: 23143136,
    baseCost: "0.4800",
    notes: "Katana additional_info: 1x1/8.",
  },
  {
    globalSku: "RM-FAB-GENERIC",
    name: "Fabric (generic placeholder)",
    category: "Fabric",
    uomConsume: "yd",
    katanaUom: "Yards",
    katanaMaterialId: 10609851,
    katanaVariantId: 23178514,
    baseCost: "30.0000",
    notes: "MTO swap target. Do not replace with FAB-* on the standard CUSH recipe.",
  },
  {
    globalSku: "RM-RAW-FOAM",
    name: "Foam",
    category: "Foam",
    uomConsume: "boardft",
    katanaUom: "BoardFt",
    katanaMaterialId: 10609849,
    katanaVariantId: 23178511,
    baseCost: "0.7000",
    notes: "Katana UOM BoardFt.",
  },
  {
    globalSku: "RM-DKT-GENERIC-SLAB",
    name: "Dekton (generic slab)",
    category: "Dekton",
    uomConsume: "slab",
    katanaUom: "Slab",
    katanaMaterialId: 10609927,
    katanaVariantId: 23178678,
    baseCost: "7.6000",
    notes: "Cut-list placeholder. Colorway SKUs are STN-DKT-*.",
  },
  {
    globalSku: "RM-HRD-SPACERS",
    name: "Spacers",
    category: "Hardware",
    uomConsume: "ea",
    katanaUom: "pcs",
    katanaMaterialId: 17465332,
    katanaVariantId: 41147406,
    baseCost: null,
    notes: "",
  },
  {
    globalSku: "RM-HRD-2X2-METAL-CAP",
    name: "2x2 Metal Cap",
    category: "Hardware",
    uomConsume: "ea",
    katanaUom: "pcs",
    katanaMaterialId: 17465339,
    katanaVariantId: 41147427,
    baseCost: null,
    notes: "",
  },
  {
    globalSku: "RM-HRD-UMBRELLA-HOLDER",
    name: "Umbrella Holder",
    category: "Hardware",
    uomConsume: "ea",
    katanaUom: "pcs",
    katanaMaterialId: 17594967,
    katanaVariantId: 41339591,
    baseCost: null,
    notes: "",
  },
  {
    globalSku: "RM-HRD-METAL-RING",
    name: "Metal ring",
    category: "Hardware",
    uomConsume: "ea",
    katanaUom: "pcs",
    katanaMaterialId: 17595618,
    katanaVariantId: 41341491,
    baseCost: null,
    notes: "Defined in Katana but unused by any recipe in the 2026-09-01 pull.",
  },
  {
    globalSku: "RM-RAW-IRON-WOOD",
    name: "Iron Wood",
    category: "Wood",
    uomConsume: "ea",
    katanaUom: "pcs",
    katanaMaterialId: 10592547,
    katanaVariantId: 23143214,
    baseCost: "10.4200",
    notes: "",
  },
] as const;

export const KATANA_GENERIC_FABRIC_SKU = "RM-FAB-GENERIC";

/** Katana variant id of RM-FAB-GENERIC — the CUSH placeholder swapped at MTO time. */
export const KATANA_GENERIC_FABRIC_VARIANT_ID: number = KATANA_BULK_MATERIALS.find(
  (row) => row.globalSku === KATANA_GENERIC_FABRIC_SKU,
)!.katanaVariantId;
