/**
 * Industrial-engineering SMV / SAM baselines from
 * docs/Research Files/Build_Time_Estimates.md.
 *
 * Pure constants + arithmetic only. Standard Tracks consume these totals;
 * do not invent Katana Resource names here (see resources.ts).
 *
 * Floor topology: docs/FACTORY_FLOOR_TOPOLOGY.md
 */

/** ILO Personal / Fatigue / Delay multipliers used in the study. */
export const PF_AND_D = {
  /** General assembly, cold saw, sewing, powder labor, CNC stone. */
  general: 1.15,
  /** Manual TIG welding + mechanical grinding (thermal / vibration). */
  heavyFab: 1.20,
} as const;

/**
 * Research building blocks (Normal Time where noted; Standard Time when marked).
 * Club-chair frame reference: 8 structural cuts, 12 joints, 72 weld inches.
 * Box cushion reference: 24×24. Dekton reference: 72×36 perimeter.
 */
export const SMV_INPUTS = {
  /** Normal minutes: stock advance 0.50 + plunge 0.25. */
  coldSawNormalMinPerCut: 0.75,
  clubChairStructuralCuts: 8,

  /** Pure arc minutes per linear inch at ~7.5 ipm. */
  weldArcMinPerLinearInch: 1 / 7.5,
  /** TIG operating factor (arc / clock). */
  weldOperatingFactor: 0.22,
  clubChairWeldLinearInches: 72,
  /** SMED fixture load/unload (Normal Time, minutes). */
  weldFixtureSetupNormalMin: 3.0,

  grindNormalMinPerJoint: 1.25,
  grindHandlingNormalMin: 2.0,
  clubChairPrimaryJoints: 12,

  /** Powder active labor Normal Time (prep 5 + spray 4 + unhang 3). */
  powderActiveLaborNormalMin: 12.0,
  /** Passive oven dwell — machine time, not labor SMV. */
  powderCurePassiveMin: 20.0,

  cushionNormal: {
    cncKnifeCutMin: 2.5,
    pipingMin: 4.5,
    zipperMin: 2.5,
    finalSewMin: 5.0,
    foamStuffMin: 3.5,
  },

  dektonHandlingNormalMin: 10.0,
  /** CNC cut + polish + tool change for 72×36 reference (~20.0). */
  dektonCncNormalMin: 20.0,
} as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Standard minutes per cold-saw cut (incl. general PF&D). */
export function coldSawMinPerCut(): number {
  return round2(SMV_INPUTS.coldSawNormalMinPerCut * PF_AND_D.general);
}

/** Club-chair Metal Cutting SMV (8 cuts). Research: 6.9. */
export function metalCuttingSmvMin(
  cuts: number = SMV_INPUTS.clubChairStructuralCuts,
): number {
  return round1(cuts * SMV_INPUTS.coldSawNormalMinPerCut * PF_AND_D.general);
}

/**
 * TIG weld + SMED fixture SMV for a frame (heavy PF&D).
 * Research club chair: 55.9
 * (arc 9.6 → clock 43.6 at 22% OF → +3.0 fixture → ×1.20).
 */
export function weldFixturingSmvMin(
  weldLinearInches: number = SMV_INPUTS.clubChairWeldLinearInches,
  fixtureNormalMin: number = SMV_INPUTS.weldFixtureSetupNormalMin,
): number {
  const arcMin = round1(
    weldLinearInches * SMV_INPUTS.weldArcMinPerLinearInch,
  );
  // Match research intermediate rounding (9.6 / 0.22 → 43.6, not 43.636…)
  const clockMin = round1(arcMin / SMV_INPUTS.weldOperatingFactor);
  const base = round1(clockMin + fixtureNormalMin);
  return round1(base * PF_AND_D.heavyFab);
}

/**
 * Mechanical flush grinding SMV (heavy PF&D).
 * Research club chair: 20.4.
 */
export function grindingSmvMin(
  joints: number = SMV_INPUTS.clubChairPrimaryJoints,
): number {
  const active =
    joints * SMV_INPUTS.grindNormalMinPerJoint +
    SMV_INPUTS.grindHandlingNormalMin;
  return round1(active * PF_AND_D.heavyFab);
}

/**
 * FAB POD run = weld + grind (cut is a separate feeder cell).
 * Research club chair: 55.9 + 20.4 = 76.3.
 */
export function fabPodRunSmvMin(
  weldLinearInches: number = SMV_INPUTS.clubChairWeldLinearInches,
  joints: number = SMV_INPUTS.clubChairPrimaryJoints,
): number {
  return round1(
    weldFixturingSmvMin(weldLinearInches) + grindingSmvMin(joints),
  );
}

/** Powder booth active labor SMV. Research: 13.8. */
export function powderActiveLaborSmvMin(): number {
  return round1(
    SMV_INPUTS.powderActiveLaborNormalMin * PF_AND_D.general,
  );
}

/** Passive curing oven minutes (no PF&D — machine dwell). Research: 20.0. */
export function powderCurePassiveMin(): number {
  return SMV_INPUTS.powderCurePassiveMin;
}

export type CushionSmvSplit = {
  fabricCuttingMin: number;
  fabricSewingMin: number;
  cushionStuffingMin: number;
  /** Full box-cushion SAM (research 20.7). */
  totalMin: number;
};

/**
 * Split upholstery SAM across 2nd-floor cells (general PF&D on Normal Times).
 * Cutting ~2.9, Sewing ~13.8, Stuffing ~4.0; total 20.7.
 */
export function cushionSmvSplit(): CushionSmvSplit {
  const { cushionNormal } = SMV_INPUTS;
  const fabricCuttingMin = round1(
    cushionNormal.cncKnifeCutMin * PF_AND_D.general,
  );
  const fabricSewingMin = round1(
    (cushionNormal.pipingMin +
      cushionNormal.zipperMin +
      cushionNormal.finalSewMin) *
      PF_AND_D.general,
  );
  const cushionStuffingMin = round1(
    cushionNormal.foamStuffMin * PF_AND_D.general,
  );
  const totalMin = round1(
    (cushionNormal.cncKnifeCutMin +
      cushionNormal.pipingMin +
      cushionNormal.zipperMin +
      cushionNormal.finalSewMin +
      cushionNormal.foamStuffMin) *
      PF_AND_D.general,
  );
  return {
    fabricCuttingMin,
    fabricSewingMin,
    cushionStuffingMin,
    totalMin,
  };
}

/** Dekton CNC + handling SMV. Research 72×36: 34.5. */
export function dektonFabricationSmvMin(): number {
  return round1(
    (SMV_INPUTS.dektonHandlingNormalMin + SMV_INPUTS.dektonCncNormalMin) *
      PF_AND_D.general,
  );
}

/** Published research totals locked by unit tests. */
export const RESEARCH_SMV = {
  metalCuttingClubChairMin: 6.9,
  weldFixturingClubChairMin: 55.9,
  grindingClubChairMin: 20.4,
  fabPodClubChairMin: 76.3,
  powderActiveLaborMin: 13.8,
  powderCurePassiveMin: 20.0,
  cushionTotalMin: 20.7,
  cushionFabricCuttingMin: 2.9,
  cushionFabricSewingMin: 13.8,
  cushionStuffingMin: 4.0,
  dektonFabricationMin: 34.5,
} as const;
