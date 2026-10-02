/**
 * Geometric section → stocked Katana purchasing variant.
 * Recipes consume these SKUs. RM-MET-* placeholders are recorded only as
 * rejected aliases so a review file can show they were not selected.
 *
 * 16 gauge is assumed for every match. 11 gauge is never inferred from a mesh.
 * 1.00 × 0.125 flat bar is the minted purchasing variant MET-FH181.
 */

export const OBJ_METAL_SCRAP_FACTOR = 1.08;
export const OBJ_ASSUMED_GAUGE = "16 GA" as const;

export type StockedSection = {
  profileCode: string;
  majorIn: number;
  minorIn: number;
  purchasingSku: string;
  rejectedPlaceholderSku: string | null;
};

export const STOCKED_SECTIONS: readonly StockedSection[] = [
  {
    profileCode: "SQ2-16",
    majorIn: 2,
    minorIn: 2,
    purchasingSku: "MET-TB22060",
    rejectedPlaceholderSku: "RM-MET-2X2-TUBING",
  },
  {
    profileCode: "SQ2x1-16",
    majorIn: 2,
    minorIn: 1,
    purchasingSku: "MET-TB21060",
    rejectedPlaceholderSku: "RM-MET-2X1-TUBING",
  },
  {
    profileCode: "RT2x0.75-16",
    majorIn: 2,
    minorIn: 0.75,
    purchasingSku: "MET-TB234060",
    rejectedPlaceholderSku: "RM-MET-2X075-TUBING",
  },
  {
    profileCode: "RT1.5x0.75-16",
    majorIn: 1.5,
    minorIn: 0.75,
    purchasingSku: "MET-TB11234060",
    rejectedPlaceholderSku: "RM-MET-15X075-TUBING",
  },
  {
    profileCode: "SQ1-16",
    majorIn: 1,
    minorIn: 1,
    purchasingSku: "MET-TB11060",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "RT3x2-16",
    majorIn: 3,
    minorIn: 2,
    purchasingSku: "MET-TB32060",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "RT4x2-16",
    majorIn: 4,
    minorIn: 2,
    purchasingSku: "MET-TB42060",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "FB1x0.125",
    majorIn: 1,
    minorIn: 0.125,
    purchasingSku: "MET-FH181",
    rejectedPlaceholderSku: "RM-MET-FLATBAR",
  },
  {
    profileCode: "FB1x0.25",
    majorIn: 1,
    minorIn: 0.25,
    purchasingSku: "MET-FH141",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "FB1.5x0.1875",
    majorIn: 1.5,
    minorIn: 0.1875,
    purchasingSku: "MET-FH316112",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "FB2x0.1875",
    majorIn: 2,
    minorIn: 0.1875,
    purchasingSku: "MET-FH3162",
    rejectedPlaceholderSku: null,
  },
  {
    profileCode: "FB1.5x0.125",
    majorIn: 1.5,
    minorIn: 0.125,
    purchasingSku: "MET-FH18112",
    rejectedPlaceholderSku: null,
  },
] as const;

export type SectionSnap = {
  profileCode: string;
  purchasingSku: string | null;
  rejectedPlaceholderSku: string | null;
  assumedGauge: typeof OBJ_ASSUMED_GAUGE;
  flag: string | null;
};

function within(measured: number, nominal: number): boolean {
  const tol = nominal < 0.2 ? 0.02 : 0.08;
  return Math.abs(measured - nominal) <= tol;
}

/**
 * Snap an unordered cross-section to one stocked profile.
 * Closest total error wins when two nominals both sit inside tolerance.
 */
export function snapSection(majorIn: number, minorIn: number): SectionSnap {
  const major = Math.max(majorIn, minorIn);
  const minor = Math.min(majorIn, minorIn);
  let best: StockedSection | null = null;
  let bestErr = Infinity;

  for (const row of STOCKED_SECTIONS) {
    if (!within(major, row.majorIn) || !within(minor, row.minorIn)) continue;
    const err = Math.abs(major - row.majorIn) + Math.abs(minor - row.minorIn);
    if (err < bestErr) {
      best = row;
      bestErr = err;
    }
  }

  if (best) {
    return {
      profileCode: best.profileCode,
      purchasingSku: best.purchasingSku,
      rejectedPlaceholderSku: best.rejectedPlaceholderSku,
      assumedGauge: OBJ_ASSUMED_GAUGE,
      flag: null,
    };
  }

  return {
    profileCode: "UNMAPPED",
    purchasingSku: null,
    rejectedPlaceholderSku: null,
    assumedGauge: OBJ_ASSUMED_GAUGE,
    flag: "unmapped_section",
  };
}

export function netFeetFromInches(totalInches: number): number {
  if (!Number.isFinite(totalInches) || totalInches <= 0) return 0;
  return Math.round((totalInches / 12) * 10000) / 10000;
}

/** Informational publish quantity. Callers must not store this as net feet. */
export function katanaFeetFromNet(netFt: number): number {
  return Math.round(netFt * OBJ_METAL_SCRAP_FACTOR * 10000) / 10000;
}
