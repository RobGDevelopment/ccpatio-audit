/** Domestic dim-weight divisor (in³ per lb). */
export const DIM_WEIGHT_DIVISOR = 139;

/** Packaged length above this (inches) defaults ship mode to LTL. */
export const LTL_LENGTH_IN = 90;

/** Actual weight above this (lb) defaults ship mode to LTL. */
export const LTL_WEIGHT_LB = 150;

export function mapDisplayToFreight(display: { length?: string | null, depth?: string | null, height?: string | null, weight?: string | null }) {
  return {
    lengthIn: display.length || "",
    widthIn: display.depth || "", // Note: display depth maps to freight width
    heightIn: display.height || "",
    weightLb: display.weight || "",
  };
}

/** First positive number in a catalog cell (`24''`, `45 lbs`, `34`). */
export function parseMeasure(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const text = raw.trim();
  if (!text || /^n\/?a$/i.test(text)) return null;
  const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function formatMeasure(value: number): string {
  return value.toFixed(2);
}

export type DfmFreightInput = {
  hubLength?: string | number | null;
  hubDepth?: string | number | null;
  hubHeight?: string | number | null;
  hubWeight?: string | number | null;
  packagedLength?: string | number | null;
  packagedWidth?: string | number | null;
  packagedHeight?: string | number | null;
  packagedWeight?: string | number | null;
  shipMode?: string | null;
};

export type DfmFreight = {
  lengthIn: string | null;
  widthIn: string | null;
  heightIn: string | null;
  weightLb: string | null;
  dimWeightLb: string | null;
  billableWeightLb: string | null;
  shipMode: string | null;
  packagedFromHub: boolean;
  shipModeDefaultedLtl: boolean;
};

/**
 * Packaged L/W/H fall back to hub length/depth/height.
 * Dim weight is (L*W*H)/139. Ship mode defaults to LTL when length > 90 or weight > 150
 * and the caller has not already chosen a mode.
 */
export function deriveDfmFreight(input: DfmFreightInput): DfmFreight {
  const hubL = parseMeasure(input.hubLength);
  const hubD = parseMeasure(input.hubDepth);
  const hubH = parseMeasure(input.hubHeight);
  const hubWt = parseMeasure(input.hubWeight);

  const givenL = parseMeasure(input.packagedLength);
  const givenW = parseMeasure(input.packagedWidth);
  const givenH = parseMeasure(input.packagedHeight);
  const givenWt = parseMeasure(input.packagedWeight);

  const length = givenL ?? hubL;
  const width = givenW ?? hubD;
  const height = givenH ?? hubH;
  const weight = givenWt ?? hubWt;
  const packagedFromHub =
    (givenL == null && hubL != null) ||
    (givenW == null && hubD != null) ||
    (givenH == null && hubH != null);

  let dimWeightLb: string | null = null;
  if (length != null && width != null && height != null) {
    dimWeightLb = ((length * width * height) / DIM_WEIGHT_DIVISOR).toFixed(2);
  }

  let billableWeightLb: string | null = null;
  if (weight != null && dimWeightLb != null) {
    billableWeightLb = Math.max(weight, Number(dimWeightLb)).toFixed(2);
  } else if (weight != null) {
    billableWeightLb = formatMeasure(weight);
  }

  const requested = (input.shipMode ?? "").trim();
  let shipMode: string | null = requested || null;
  let shipModeDefaultedLtl = false;
  if (
    !shipMode &&
    ((length != null && length > LTL_LENGTH_IN) ||
      (weight != null && weight > LTL_WEIGHT_LB))
  ) {
    shipMode = "ltl";
    shipModeDefaultedLtl = true;
  }

  return {
    lengthIn: length == null ? null : formatMeasure(length),
    widthIn: width == null ? null : formatMeasure(width),
    heightIn: height == null ? null : formatMeasure(height),
    weightLb: weight == null ? null : formatMeasure(weight),
    dimWeightLb,
    billableWeightLb,
    shipMode,
    packagedFromHub,
    shipModeDefaultedLtl,
  };
}
