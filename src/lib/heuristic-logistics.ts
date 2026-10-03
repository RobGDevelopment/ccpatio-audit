/**
 * Packaged dims, mass, and NMFC class for a FIN-* SKU.
 *
 * Footprint comes from the SKU. Height comes from the Phase 1 catalog
 * (collection back heights, table heights). Mass is hollow tube plus
 * cushion, not the bounding cube. The cube is only the freight density.
 */
import { parseFinTwinParts } from "@/lib/katana-fin-bom";
import {
  fabricYards,
  foamBoardFeet,
  RM_FAB_GENERIC,
  RM_FOAM,
} from "@/lib/heuristic-bom";
import type { LtlFreightClass } from "@/lib/logistics-profile";
import {
  armCountFromSku,
  CLUB_CHAIR_WIDTH_IN,
  DEFAULT_SEATING_DEPTH_IN,
  legCountFromWidth,
  OCEAN_SEATING_DEPTH_IN,
  POWDER_LB_PER_TUBE_FT,
  RM_MET_15X075,
  RM_MET_2X2,
  RM_MET_FLATBAR,
  seatingFlatbarFeet,
  seatingSlatFeet,
  seatingTube2x2Feet,
  tableTube2x2Feet,
} from "@/lib/level2-bom";
import {
  DEFAULT_PAD_IN,
  HARDWARE_LB_EACH,
} from "@/lib/secondary-extraction/types";

/** Seeded 2x2x16ga aluminum, lb per foot. */
export const TUBE_2X2_PLF = 0.91;
/**
 * 1.5x0.75 16ga, same wall as the 2x2. Perimeter 4.5 / 8 × 0.91.
 * Used only when material_physics_factors has no row.
 */
export const SLAT_PLF_FALLBACK = 0.51;
/** 1 x 1/8 aluminum flatbar. Used only when physics has no row. */
export const FLATBAR_PLF_FALLBACK = 0.15;
/** Seeded HD seating foam, lb per cubic foot. */
export const FOAM_DENSITY_PCF = 1.8;
export const FABRIC_OZ_PER_YD2 = 11.5;
export const FABRIC_WIDTH_IN = 54;

export const DEFAULT_LEAD_TIME_DAYS = 14;

/**
 * Wooden skid plus shrink wrap, V-boards, and corrugated caps.
 * Added to every finished good before density and NMFC class.
 */
export const PACKAGING_TARE_WEIGHT_LB = 25;

/** 2 cm Dekton, pounds per square foot of stone. */
export const DEKTON_LB_PER_SQFT = 10.5;

/** Catalog back height. Level-2 seating leaves height at 0 and assumes 30. */
const BACK_HEIGHT_IN: Readonly<Record<string, number>> = {
  BRV: 31,
  BRA: 31,
  BRK: 30,
  BRO: 30,
  OCN: 33,
  OCE: 33,
  MLN: 16,
};
const DEFAULT_BACK_HEIGHT_IN = 31;

/** Low chaise seat height. Not the sofa back height. */
const LOW_CHAISE_HEIGHT_IN: Readonly<Record<string, number>> = {
  BRV: 14,
  BRA: 14,
  OCN: 14,
  OCE: 14,
  BRK: 11,
  BRO: 11,
};
const DEFAULT_LOW_CHAISE_HEIGHT_IN = 14;

const OTTOMAN_HEIGHT_IN: Readonly<Record<string, number>> = {
  BRV: 16,
  BRA: 16,
  BRK: 17,
  BRO: 17,
  CUS: 23,
};
const DEFAULT_OTTOMAN_HEIGHT_IN = 17;

const DAYBED_HEIGHT_IN = 27;
const CABANA_DAYBED_HEIGHT_IN = 78;
const SWING_HEIGHT_IN = 23;
const BENCH_HEIGHT_IN = 18;
const DINING_CHAIR_HEIGHT_IN = 35;
const BAR_STOOL_HEIGHT_IN = 42;

/**
 * Catalog table heights. Coffee and side tables are 17 in.
 * `TABLE_COFFEE_HEIGHT_IN` (16) is the BOM leg guess, not the ship height.
 */
const TABLE_HEIGHT_IN: Readonly<Record<string, number>> = {
  "BAR-TAB": 42,
  "CNT-TAB": 36,
  "DIN-TAB": 30,
  "COF-TAB": 17,
  "SID-TAB": 17,
  "OCC-TAB": 17,
  "FLY-TAB": 21,
  "MIS-TAB": 24,
  TAB: 21,
};

/**
 * FIN-OCC-TAB-* parses as collection OCC + category TAB, not category OCC-TAB.
 * Same for FLY and MIS. Any other bare TAB uses 21 in.
 */
const BARE_TAB_COLLECTION_HEIGHT_IN: Readonly<Record<string, number>> = {
  OCC: 17,
  FLY: 21,
  MIS: 24,
};
const GENERIC_TAB_HEIGHT_IN = 21;

const FIRE_PIT_HEIGHT_IN = 21;
const FIRE_PIT_DINING_HEIGHT_IN = 30;
const FIRE_PIT_DINING_MIN_IN = 84;
const U_SIDE_TABLE_HEIGHT_IN = 21;

/** Taylor benches whose SKU has no BAR/CNT token but the catalog states height. */
const TAYLOR_BENCH_HEIGHT_IN: Readonly<Record<string, number>> = {
  "24X23": 42,
  "42X23": 24,
  "72X23": 30,
};

const TABLE_CODES = new Set([
  "BAR-TAB",
  "CNT-TAB",
  "DIN-TAB",
  "COF-TAB",
  "SID-TAB",
  "FIR-TAB",
  "OCC-TAB",
  "FLY-TAB",
  "MIS-TAB",
  "TAB",
]);

const BACK_CODES = new Set([
  "TRA-DOU-CHS",
  "TRA-SGL-CHS",
  "ARM-SOF",
  "ARM-LOV",
  "COR-SOF",
  "COR-CHS",
  "MIN-LOV",
  "LOV-SOF",
  "CLB-CHA",
  "SWV-CHA",
  "OVS-CHS",
  "CHS",
  "SOF",
]);

/** Longest code wins so COR-SOF is not read as SOF. */
const CATEGORY_CODES: readonly string[] = [
  "TRA-DOU-CHS",
  "TRA-SGL-CHS",
  "OTT-DKT",
  "ARM-SOF",
  "ARM-LOV",
  "COR-SOF",
  "COR-CHS",
  "COF-TAB",
  "SID-TAB",
  "DIN-TAB",
  "BAR-TAB",
  "CNT-TAB",
  "FIR-TAB",
  "OCC-TAB",
  "FLY-TAB",
  "MIS-TAB",
  "DIN-CHA",
  "DIN-BCH",
  "CLB-CHA",
  "SWV-CHA",
  "MIN-LOV",
  "LOV-SOF",
  "OVS-CHS",
  "DOU-CHS",
  "SGL-CHS",
  "SOF",
  "OTT",
  "DYB",
  "BCH",
  "CHS",
  "SWG",
  "BST",
  "TAB",
].sort((left, right) => right.length - left.length);

const DIM_TOKEN = /^(\d{1,3})(?:X(\d{1,3}))?$/;

/**
 * Standard density scale. Intervals are half-open on the top:
 * 1 ≤ pcf < 2 is class 400, under 1 is class 500.
 */
const PCF_BANDS: ReadonlyArray<{ min: number; freightClass: LtlFreightClass }> =
  [
    { min: 50, freightClass: "50" },
    { min: 35, freightClass: "55" },
    { min: 30, freightClass: "60" },
    { min: 22.5, freightClass: "65" },
    { min: 15, freightClass: "70" },
    { min: 13.5, freightClass: "77.5" },
    { min: 12, freightClass: "85" },
    { min: 10.5, freightClass: "92.5" },
    { min: 9, freightClass: "100" },
    { min: 8, freightClass: "110" },
    { min: 7, freightClass: "125" },
    { min: 6, freightClass: "150" },
    { min: 5, freightClass: "175" },
    { min: 4, freightClass: "200" },
    { min: 3, freightClass: "250" },
    { min: 2, freightClass: "300" },
    { min: 1, freightClass: "400" },
  ];

export type LogisticsPhysics = {
  tube2x2Plf: number;
  slatPlf: number;
  flatbarPlf: number;
  foamDensityPcf: number;
  fabricOzPerYd2: number;
  fabricWidthIn: number;
  powderLbPerFt: number;
  hardwareLbEach: number;
};

export const DEFAULT_LOGISTICS_PHYSICS: LogisticsPhysics = {
  tube2x2Plf: TUBE_2X2_PLF,
  slatPlf: SLAT_PLF_FALLBACK,
  flatbarPlf: FLATBAR_PLF_FALLBACK,
  foamDensityPcf: FOAM_DENSITY_PCF,
  fabricOzPerYd2: FABRIC_OZ_PER_YD2,
  fabricWidthIn: FABRIC_WIDTH_IN,
  powderLbPerFt: POWDER_LB_PER_TUBE_FT,
  hardwareLbEach: HARDWARE_LB_EACH,
};

export type PhysicsReading = {
  materialSku: string;
  profileCode: string;
  weightPlf: number | null;
  densityPcf: number | null;
  ozPerYd2: number | null;
  fabricWidthIn: number | null;
  attrWeightPlf: number | null;
};

export type WeightBreakdownLb = {
  metal: number;
  foam: number;
  fabric: number;
  powder: number;
  hardware: number;
  packaging: number;
  dekton: number;
};

export type HeuristicLogisticsEstimate = {
  variantSku: string;
  family: "seating" | "table";
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  packagedLengthIn: number;
  packagedWidthIn: number;
  packagedHeightIn: number;
  weightLb: number;
  breakdown: WeightBreakdownLb;
  pcf: number;
  ltlClass: LtlFreightClass;
  leadTimeDays: number;
};

export type HeuristicLogisticsResult =
  | { status: "ready"; estimate: HeuristicLogisticsEstimate }
  | { status: "skipped"; sku: string; reason: string };

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function skipped(sku: string, reason: string): HeuristicLogisticsResult {
  return { status: "skipped", sku, reason };
}

function positive(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function matchCategory(category: string): string | null {
  for (const code of CATEGORY_CODES) {
    if (category === code || category.endsWith(`-${code}`)) return code;
  }
  return null;
}

function isOcean(collection: string): boolean {
  return collection === "OCN" || collection === "OCE";
}

function lookup(
  map: Readonly<Record<string, number>>,
  collection: string,
  fallback: number,
): number {
  return map[collection] ?? fallback;
}

type Footprint = {
  lengthIn: number;
  widthIn: number;
  /** Set when the second SKU number is a height, not a depth. */
  heightOverride: number | null;
};

function readFootprint(
  collection: string,
  code: string | null,
  dimToken: string | null,
): Footprint | null {
  const depthDefault = isOcean(collection)
    ? OCEAN_SEATING_DEPTH_IN
    : DEFAULT_SEATING_DEPTH_IN;
  const table = code != null && TABLE_CODES.has(code);

  if (!dimToken) {
    if (code === "CLB-CHA") {
      return {
        lengthIn: CLUB_CHAIR_WIDTH_IN,
        widthIn: isOcean(collection)
          ? OCEAN_SEATING_DEPTH_IN
          : CLUB_CHAIR_WIDTH_IN,
        heightOverride: null,
      };
    }
    return null;
  }

  const match = DIM_TOKEN.exec(dimToken);
  if (!match) return null;
  const span = Number(match[1]);
  const second = match[2] != null ? Number(match[2]) : null;
  if (!Number.isFinite(span) || span < 8) return null;

  if (second == null) {
    return {
      lengthIn: span,
      widthIn: table ? span : depthDefault,
      heightOverride: null,
    };
  }
  if (!Number.isFinite(second) || second < 8) return null;

  if (code === "SID-TAB") {
    const high = Math.max(span, second);
    const low = Math.min(span, second);
    if (low === 17 && high >= 30) {
      return { lengthIn: high, widthIn: high, heightOverride: 17 };
    }
    if ((span === 13 && second === 30) || (span === 30 && second === 13)) {
      return {
        lengthIn: span,
        widthIn: second,
        heightOverride: U_SIDE_TABLE_HEIGHT_IN,
      };
    }
  }

  return { lengthIn: span, widthIn: second, heightOverride: null };
}

function tokenHeight(category: string): number | null {
  const tokens = category.split("-").filter(Boolean);
  if (tokens.includes("BAR")) return 42;
  if (tokens.includes("CNT") || tokens.includes("COU")) return 36;
  if (tokens.includes("DIN")) return 30;
  if (tokens.includes("BST")) return BAR_STOOL_HEIGHT_IN;
  return null;
}

function productHeightIn(input: {
  collection: string;
  category: string;
  code: string | null;
  dimToken: string | null;
  lengthIn: number;
  widthIn: number;
  heightOverride: number | null;
}): number | null {
  if (input.heightOverride != null && input.heightOverride > 0) {
    return input.heightOverride;
  }

  if (
    input.collection === "TAY" &&
    input.code === "BCH" &&
    input.dimToken &&
    TAYLOR_BENCH_HEIGHT_IN[input.dimToken] != null
  ) {
    return TAYLOR_BENCH_HEIGHT_IN[input.dimToken]!;
  }

  const code = input.code;
  if (code && TABLE_CODES.has(code)) {
    if (code === "TAB") {
      return (
        BARE_TAB_COLLECTION_HEIGHT_IN[input.collection] ?? GENERIC_TAB_HEIGHT_IN
      );
    }
    if (code === "FIR-TAB") {
      const span = Math.max(input.lengthIn, input.widthIn);
      return span >= FIRE_PIT_DINING_MIN_IN
        ? FIRE_PIT_DINING_HEIGHT_IN
        : FIRE_PIT_HEIGHT_IN;
    }
    return TABLE_HEIGHT_IN[code] ?? GENERIC_TAB_HEIGHT_IN;
  }

  if (code === "SGL-CHS" || code === "DOU-CHS") {
    return lookup(
      LOW_CHAISE_HEIGHT_IN,
      input.collection,
      DEFAULT_LOW_CHAISE_HEIGHT_IN,
    );
  }
  if (code === "OTT" || code === "OTT-DKT") {
    return lookup(
      OTTOMAN_HEIGHT_IN,
      input.collection,
      DEFAULT_OTTOMAN_HEIGHT_IN,
    );
  }
  if (code === "DYB") {
    return input.collection === "CAB"
      ? CABANA_DAYBED_HEIGHT_IN
      : DAYBED_HEIGHT_IN;
  }
  if (code === "SWG") return SWING_HEIGHT_IN;
  if (code === "BCH" || code === "DIN-BCH") return BENCH_HEIGHT_IN;
  if (code === "DIN-CHA") return DINING_CHAIR_HEIGHT_IN;
  if (code === "BST") return BAR_STOOL_HEIGHT_IN;
  if (code && BACK_CODES.has(code)) {
    return lookup(BACK_HEIGHT_IN, input.collection, DEFAULT_BACK_HEIGHT_IN);
  }

  return tokenHeight(input.category);
}

function powderLb(tubeFt: number, lbPerFt: number): number {
  return round4(Math.max(0.1, lbPerFt * tubeFt));
}

/** Hard top: table, fire pit, or bar-height table category. */
function isHardTop(category: string, code: string | null): boolean {
  if (code != null && TABLE_CODES.has(code)) return true;
  const tokens = category.split("-").filter(Boolean);
  return (
    tokens.includes("TAB") || tokens.includes("FIR") || tokens.includes("BAR")
  );
}

/**
 * 2 cm Dekton. Waterfall (WFT) drops stone on both short ends.
 * The drop width is the shorter footprint side, so a 13×40 top
 * does not hang stone along the 40 in length.
 */
function dektonLb(
  sku: string,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): number {
  let sqft = (lengthIn * widthIn) / 144;
  if (sku.includes("WFT")) {
    const dropWidth = Math.min(lengthIn, widthIn);
    sqft += (dropWidth * heightIn * 2) / 144;
  }
  return round4(sqft * DEKTON_LB_PER_SQFT);
}

/**
 * parseFinTwinParts only peels a 2–3 digit WxD. A 1-digit side such as
 * 38X8 stays stuck on the category. Pull that token off before matching.
 */
function splitStuckDimension(
  category: string,
  dimToken: string | null,
): { category: string; dimToken: string | null } {
  if (dimToken && DIM_TOKEN.test(dimToken)) {
    return { category, dimToken };
  }
  const parts = category.split("-").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && DIM_TOKEN.test(last)) {
    parts.pop();
    return { category: parts.join("-"), dimToken: last };
  }
  return { category, dimToken };
}

function cushionWeight(
  lengthIn: number,
  widthIn: number,
  heightIn: number,
  physics: LogisticsPhysics,
): { foam: number; fabric: number } {
  const boardFt = foamBoardFeet(lengthIn, widthIn);
  const foam = round4((boardFt / 12) * physics.foamDensityPcf);
  const yards = fabricYards(lengthIn, widthIn, heightIn, false);
  const areaYd2 = yards * (physics.fabricWidthIn / 36);
  const fabric = round4(areaYd2 * (physics.fabricOzPerYd2 / 16));
  return { foam, fabric };
}

function pickPlf(
  readings: readonly PhysicsReading[],
  sku: string,
  fallback: number,
  preferProfile?: string,
): number {
  const rows = readings.filter((row) => row.materialSku === sku);
  const fromAttr = rows.find((row) => positive(row.attrWeightPlf) != null);
  if (fromAttr?.attrWeightPlf != null) return fromAttr.attrWeightPlf;
  if (preferProfile) {
    const profiled = rows.find(
      (row) =>
        row.profileCode === preferProfile && positive(row.weightPlf) != null,
    );
    if (profiled?.weightPlf != null) return profiled.weightPlf;
  }
  const any = rows.find((row) => positive(row.weightPlf) != null);
  return any?.weightPlf ?? fallback;
}

/**
 * Attribute `weight_plf` wins, then a physics row, then the seeded fallback.
 */
export function logisticsPhysicsFromReadings(
  readings: readonly PhysicsReading[],
): LogisticsPhysics {
  const physics: LogisticsPhysics = { ...DEFAULT_LOGISTICS_PHYSICS };
  physics.tube2x2Plf = pickPlf(readings, RM_MET_2X2, TUBE_2X2_PLF, "SQ2-16");
  physics.slatPlf = pickPlf(readings, RM_MET_15X075, SLAT_PLF_FALLBACK);
  physics.flatbarPlf = pickPlf(readings, RM_MET_FLATBAR, FLATBAR_PLF_FALLBACK);

  const foam = readings.find(
    (row) => row.materialSku === RM_FOAM && positive(row.densityPcf) != null,
  );
  if (foam?.densityPcf != null) physics.foamDensityPcf = foam.densityPcf;

  const fabric = readings.find((row) => row.materialSku === RM_FAB_GENERIC);
  if (fabric) {
    const oz = positive(fabric.ozPerYd2);
    const width = positive(fabric.fabricWidthIn);
    if (oz != null) physics.fabricOzPerYd2 = oz;
    if (width != null) physics.fabricWidthIn = width;
  }
  return physics;
}

export function freightClassFromPcf(pcf: number): LtlFreightClass {
  if (!Number.isFinite(pcf) || pcf < 0) {
    throw new Error("PCF must be a non-negative finite number");
  }
  for (const band of PCF_BANDS) {
    if (pcf >= band.min) return band.freightClass;
  }
  return "500";
}

export function estimateHeuristicLogistics(
  skuRaw: string,
  physicsInput?: Partial<LogisticsPhysics>,
): HeuristicLogisticsResult {
  const sku = normalizeSku(skuRaw);
  if (!sku.startsWith("FIN-")) return skipped(sku || skuRaw, "not_fin");

  const parsed = parseFinTwinParts(sku);
  if (!parsed || !parsed.category) return skipped(sku, "unparsed");

  const sized = splitStuckDimension(parsed.category, parsed.dimToken);
  const code = matchCategory(sized.category);
  const hardTop = isHardTop(sized.category, code);
  const family: "seating" | "table" = hardTop ? "table" : "seating";
  const footprint = readFootprint(parsed.collection, code, sized.dimToken);
  if (!footprint) return skipped(sku, "missing_dimensions");

  const heightIn = productHeightIn({
    collection: parsed.collection,
    category: sized.category,
    code,
    dimToken: sized.dimToken,
    lengthIn: footprint.lengthIn,
    widthIn: footprint.widthIn,
    heightOverride: footprint.heightOverride,
  });
  if (heightIn == null || heightIn <= 0) return skipped(sku, "unknown_height");

  const physics: LogisticsPhysics = {
    ...DEFAULT_LOGISTICS_PHYSICS,
    ...physicsInput,
  };
  const span = footprint.lengthIn;
  const depth = footprint.widthIn;
  const legs = legCountFromWidth(span);

  let breakdown: WeightBreakdownLb;
  if (family === "table") {
    const tubeFt = tableTube2x2Feet(span, depth, heightIn);
    breakdown = {
      metal: round4(tubeFt * physics.tube2x2Plf),
      foam: 0,
      fabric: 0,
      powder: powderLb(tubeFt, physics.powderLbPerFt),
      hardware: round4(legs * physics.hardwareLbEach),
      packaging: PACKAGING_TARE_WEIGHT_LB,
      dekton: dektonLb(sku, span, depth, heightIn),
    };
  } else {
    const arms = armCountFromSku(sku);
    const tubeFt = seatingTube2x2Feet(span, depth, arms, legs);
    const slatFt = seatingSlatFeet(span, depth);
    const flatFt = seatingFlatbarFeet(span);
    const cushion = cushionWeight(span, depth, heightIn, physics);
    breakdown = {
      metal: round4(
        tubeFt * physics.tube2x2Plf +
          slatFt * physics.slatPlf +
          flatFt * physics.flatbarPlf,
      ),
      foam: cushion.foam,
      fabric: cushion.fabric,
      powder: powderLb(tubeFt + slatFt, physics.powderLbPerFt),
      hardware: round4(legs * physics.hardwareLbEach),
      packaging: PACKAGING_TARE_WEIGHT_LB,
      dekton: 0,
    };
  }

  const weightLb = round4(
    breakdown.metal +
      breakdown.foam +
      breakdown.fabric +
      breakdown.powder +
      breakdown.hardware +
      breakdown.packaging +
      breakdown.dekton,
  );
  if (weightLb <= 0) return skipped(sku, "non_positive_weight");

  const pad = DEFAULT_PAD_IN * 2;
  const packagedLengthIn = round4(span + pad);
  const packagedWidthIn = round4(depth + pad);
  const packagedHeightIn = round4(heightIn + pad);
  const cubicFeet =
    (packagedLengthIn * packagedWidthIn * packagedHeightIn) / 1728;
  if (cubicFeet <= 0) return skipped(sku, "non_positive_cube");

  const pcf = weightLb / cubicFeet;
  return {
    status: "ready",
    estimate: {
      variantSku: sku,
      family,
      lengthIn: span,
      widthIn: depth,
      heightIn,
      packagedLengthIn,
      packagedWidthIn,
      packagedHeightIn,
      weightLb,
      breakdown,
      pcf,
      ltlClass: freightClassFromPcf(pcf),
      leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
    },
  };
}
