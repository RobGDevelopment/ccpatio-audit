/**
 * Long-point / short-point cut length math.
 *
 * PART_NUMBERING.md §3 (North Star): stated length = LONG POINT.
 * A 45° mitre on square tube shifts length by profile_width per angled end
 * (2" tube → 2.0" per 45° end). Kerf is NEVER subtracted from length —
 * put kerf in scrap_factor on the bulk RM line.
 */
import type { CutEndAngle, LengthConvention } from "./types";

export const DEFAULT_TUBE_SCRAP_FACTOR = 1.08;

export function mitreOffsetIn(
  profileWidthIn: number,
  end: CutEndAngle,
): number {
  if (end !== 45) return 0;
  return profileWidthIn;
}

export function longPointFromShort(
  shortPointIn: number,
  profileWidthIn: number,
  endA: CutEndAngle,
  endB: CutEndAngle,
): number {
  return (
    shortPointIn +
    mitreOffsetIn(profileWidthIn, endA) +
    mitreOffsetIn(profileWidthIn, endB)
  );
}

export function shortPointFromLong(
  longPointIn: number,
  profileWidthIn: number,
  endA: CutEndAngle,
  endB: CutEndAngle,
): number {
  return (
    longPointIn -
    mitreOffsetIn(profileWidthIn, endA) -
    mitreOffsetIn(profileWidthIn, endB)
  );
}

export type ConventionGuess = {
  convention: LengthConvention;
  longPointIn: number;
  shortPointIn: number;
  flag: string | null;
};

/**
 * Classify a stated name length against the closed envelope.
 * Prefer long-point when the name matches overall OD; flag short-point when
 * name + mitre offsets close the envelope instead.
 */
export function classifyLengthConvention(input: {
  nameLengthIn: number;
  profileWidthIn: number;
  endA: CutEndAngle;
  endB: CutEndAngle;
  /** Expected long-point from product OA (e.g. seat rail = overall width). */
  expectedLongPointIn?: number | null;
  role?: string;
}): ConventionGuess {
  const { nameLengthIn, profileWidthIn, endA, endB } = input;
  const n45 =
    (endA === 45 ? 1 : 0) + (endB === 45 ? 1 : 0);

  if (n45 === 0 || endA == null || endB == null) {
    return {
      convention: "square",
      longPointIn: nameLengthIn,
      shortPointIn: nameLengthIn,
      flag: null,
    };
  }

  const asLongShort = shortPointFromLong(
    nameLengthIn,
    profileWidthIn,
    endA,
    endB,
  );
  const asShortLong = longPointFromShort(
    nameLengthIn,
    profileWidthIn,
    endA,
    endB,
  );

  const expected = input.expectedLongPointIn;
  if (expected != null && Number.isFinite(expected)) {
    if (Math.abs(nameLengthIn - expected) <= 0.1) {
      return {
        convention: "long_point",
        longPointIn: nameLengthIn,
        shortPointIn: asLongShort,
        flag: null,
      };
    }
    if (Math.abs(asShortLong - expected) <= 0.1) {
      return {
        convention: "short_point",
        longPointIn: asShortLong,
        shortPointIn: nameLengthIn,
        flag: `convention_conflict: ${input.role ?? "part"} name ${nameLengthIn}" reads SHORT (long=${asShortLong}"); expected long ${expected}"`,
      };
    }
  }

  // Default North Star: treat stated length as long-point, but flag when
  // short-point interpretation is the more common SketchUp visual habit.
  return {
    convention: "unknown",
    longPointIn: nameLengthIn,
    shortPointIn: asLongShort,
    flag: `convention_unknown: ${input.role ?? "part"} ${nameLengthIn}" 45-count=${n45} — verify long vs short before renumber`,
  };
}

export function inchesToFeet(inches: number): number {
  return Math.round((inches / 12) * 10000) / 10000;
}

export function formatCutNote(input: {
  qtyEa: number;
  lengthIn: number;
  endA: CutEndAngle;
  endB: CutEndAngle;
  convention: LengthConvention;
  role?: string;
}): string {
  const a = input.endA ?? 90;
  const b = input.endB ?? 90;
  const closed = a === 45 && b === 45 ? "C" : "";
  const conv =
    input.convention === "long_point"
      ? "LP"
      : input.convention === "short_point"
        ? "SP"
        : input.convention === "square"
          ? ""
          : "?";
  const role = input.role ? ` ${input.role}` : "";
  const tag = conv ? ` ${conv}` : "";
  return `${input.qtyEa}ea ${input.lengthIn.toFixed(1)}in ${a}/${b}${closed}${tag}${role}`.trim();
}
