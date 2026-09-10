/**
 * Family weldment templates — Bravada club chair North Star.
 * Collapses CUT-* drawing identities into bulk RM feet + chop-saw notes.
 * Shared ASM-BRV-ARM is collection-scoped (qty 2 on FG, children qty 1).
 */
import {
  DEFAULT_TUBE_SCRAP_FACTOR,
  classifyLengthConvention,
  formatCutNote,
  inchesToFeet,
} from "./long-point";
import {
  formatDrawingPartNumber,
  parseComponentName,
  profileToRmSku,
} from "./parse-component-name";
import type {
  CutLine,
  DraftBomLine,
  InstantiatedPlan,
  LengthConvention,
  WalkerExport,
  WalkerStick,
} from "./types";
import {
  RM_DKT_GENERIC,
  RM_FAB_GENERIC,
  RM_FOAM,
  RM_PWD_GENERIC,
  fabricYards,
  foamBoardFeet,
  powderPounds,
} from "@/lib/heuristic-bom";

export const BRAVADA_CLUB_CHAIR_FIN = "FIN-BRV-CLB-CHA-34X34";
export const BRAVADA_SHARED_ARM_SKU = "SA-BRV-ARM";

const TUBE_SCRAP = DEFAULT_TUBE_SCRAP_FACTOR;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function seatSku(finSku: string): string {
  return `SA-${finSku.replace(/^FIN-/, "")}-SEAT`;
}

function backSku(finSku: string): string {
  return `SA-${finSku.replace(/^FIN-/, "")}-BACK`;
}

function cushSku(finSku: string): string {
  return `SA-${finSku.replace(/^FIN-/, "")}-CUSH`;
}

function assignWeldment(stick: WalkerStick): "SEAT" | "ARM" | "BACK" | null {
  const parent = (stick.parentAsmName ?? "").toUpperCase();
  const name = stick.definitionName.toUpperCase();
  if (parent.includes("ARM") || /\bARM\b/.test(name)) return "ARM";
  if (parent.includes("BACK") || /\bBACK\b/.test(name)) return "BACK";
  if (
    parent.includes("SEAT") ||
    /\bSEAT\b/.test(name) ||
    /\bLEG\b/.test(name) ||
    /\bMIDDLE FRAME\b/.test(name) ||
    /\bFLAT BAR\b/.test(name)
  ) {
    return "SEAT";
  }
  return null;
}

function expectedLongForRole(
  role: string,
  overallWidth: number,
  profileWidth: number,
): number | null {
  const r = role.toUpperCase();
  if (r.includes("SEAT FRAME") || r.includes("SEAT RAIL")) return overallWidth;
  // Back top / arm top names in BravadaSample often state SHORT point.
  // Expected long-point closes against overall width (arm: OA; back: OA).
  if (r.includes("BACK TOP")) return overallWidth;
  if (r.includes("ARM TOP")) return overallWidth;
  void profileWidth;
  return null;
}

function toCutLine(
  stick: WalkerStick,
  overallWidth: number,
): { cut: CutLine; flag: string | null } {
  const parsed = parseComponentName(stick.definitionName);
  const lengthIn = stick.nameLengthIn ?? parsed.nameLengthIn ?? 0;
  const endA = stick.endA ?? parsed.endA;
  const endB = stick.endB ?? parsed.endB;
  const profile = stick.profile !== "UNKNOWN" ? stick.profile : parsed.profile;
  const profileWidthIn =
    stick.profileWidthIn || parsed.profileWidthIn || 2;

  const guess = classifyLengthConvention({
    nameLengthIn: lengthIn,
    profileWidthIn,
    endA,
    endB,
    expectedLongPointIn: expectedLongForRole(
      stick.definitionName,
      overallWidth,
      profileWidthIn,
    ),
    role: stick.definitionName,
  });

  // North Star: mill to long-point. When name is short_point, promote length
  // and label the saw note as long_point (conflict stays in plan.flags).
  const statedLong =
    guess.convention === "short_point" ? guess.longPointIn : lengthIn;
  const convention: LengthConvention =
    guess.convention === "short_point"
      ? "long_point"
      : guess.convention === "unknown" && endA === 45
        ? "unknown"
        : guess.convention;

  const cut: CutLine = {
    role: stick.definitionName,
    profile,
    lengthIn: statedLong,
    endA,
    endB,
    qtyEa: stick.instanceCount,
    lengthConvention: convention,
    sourceName: stick.definitionName,
    confidence: stick.confidence,
    drawingPartNumber: formatDrawingPartNumber({
      profile,
      lengthIn: statedLong,
      endA,
      endB,
    }),
  };
  return { cut, flag: guess.flag };
}

function collapseCutsToRmLines(
  parentSku: string,
  cuts: CutLine[],
): DraftBomLine[] {
  const byRm = new Map<
    string,
    { feet: number; notes: string[]; cutList: CutLine[] }
  >();

  for (const cut of cuts) {
    const rm = profileToRmSku(cut.profile);
    const feet = inchesToFeet(cut.lengthIn) * cut.qtyEa;
    const bucket = byRm.get(rm) ?? { feet: 0, notes: [], cutList: [] };
    bucket.feet += feet;
    bucket.notes.push(
      formatCutNote({
        qtyEa: cut.qtyEa,
        lengthIn: cut.lengthIn,
        endA: cut.endA,
        endB: cut.endB,
        convention: cut.lengthConvention,
        role: cut.drawingPartNumber ?? undefined,
      }),
    );
    bucket.cutList.push(cut);
    byRm.set(rm, bucket);
  }

  return [...byRm.entries()].map(([childSku, bucket]) => ({
    parentSku,
    childSku,
    quantity: round4(bucket.feet),
    scrapFactor: TUBE_SCRAP,
    unitOfMeasure: "ft",
    notes: bucket.notes.join("; "),
    cutList: bucket.cutList,
  }));
}

/**
 * Gold-fixture walker export matching BravadaSample.jpeg + BOM CSV quantities.
 * Used when no live Ruby export is available (Phase 0 / unit proofs).
 */
export function bravadaClubChairFixtureWalker(): WalkerExport {
  const sticks: WalkerStick[] = [
    {
      definitionName: 'BRAVADA SEAT FRAME 2X2 16 GA 34" 45 45',
      parentAsmName: "BRAVADA CLUB CHAIR SEAT",
      instanceCount: 4,
      nameLengthIn: 34,
      obbLengthIn: 34,
      endA: 45,
      endB: 45,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA LEG 2X2 16 GA 8"',
      parentAsmName: "BRAVADA CLUB CHAIR SEAT",
      instanceCount: 4,
      nameLengthIn: 8,
      obbLengthIn: 8,
      endA: 90,
      endB: 90,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA MIDDLE FRAME 1.5X.75 16 GA 30"',
      parentAsmName: "BRAVADA CLUB CHAIR SEAT",
      instanceCount: 4,
      nameLengthIn: 30,
      obbLengthIn: 30,
      endA: 90,
      endB: 90,
      profile: "RT1.5x0.75-16",
      profileWidthIn: 1.5,
      materialName: null,
      confidence: "inferred",
    },
    {
      definitionName: 'BRAVADA FLAT BAR HR FLAT 1/8" 30" 90 90',
      parentAsmName: "BRAVADA CLUB CHAIR SEAT",
      instanceCount: 2,
      nameLengthIn: 30,
      obbLengthIn: 30,
      endA: 90,
      endB: 90,
      profile: "FB0.125x1.5",
      profileWidthIn: 1.5,
      materialName: null,
      confidence: "inferred",
    },
    {
      definitionName: 'BRAVADA ARM TOP 2X2 16 GA 32" 45 90',
      parentAsmName: "BRAVADA CLUB CHAIR ARM",
      instanceCount: 1,
      nameLengthIn: 32,
      obbLengthIn: 32,
      endA: 45,
      endB: 90,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA ARM VERTICAL 2X2 16 GA 14" 90 90',
      parentAsmName: "BRAVADA CLUB CHAIR ARM",
      instanceCount: 1,
      nameLengthIn: 14,
      obbLengthIn: 14,
      endA: 90,
      endB: 90,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA BACK SIDE 2X2 16 GA 19" 90 45',
      parentAsmName: "BRAVADA CLUB CHAIR BACK",
      instanceCount: 2,
      nameLengthIn: 19,
      obbLengthIn: 19,
      endA: 90,
      endB: 45,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA BACK TOP 2X2 16 GA 30" 45 45',
      parentAsmName: "BRAVADA CLUB CHAIR BACK",
      instanceCount: 1,
      nameLengthIn: 30,
      obbLengthIn: 30,
      endA: 45,
      endB: 45,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
    {
      definitionName: 'BRAVADA BACK CENTER 2X2 16GA 30" 90 90',
      parentAsmName: "BRAVADA CLUB CHAIR BACK",
      instanceCount: 1,
      nameLengthIn: 30,
      obbLengthIn: 30,
      endA: 90,
      endB: 90,
      profile: "SQ2-16",
      profileWidthIn: 2,
      materialName: null,
      confidence: "stated",
    },
  ];

  return {
    sourceFile: "docs/BOM_Examples/BravadaSample.jpeg (fixture)",
    exportedAt: new Date().toISOString(),
    productHint: "BRAVADA CLUB CHAIR 34x34",
    overall: { lengthIn: 34, depthIn: 34, heightIn: 31 },
    assemblies: [
      { name: "BRAVADA CLUB CHAIR SEAT", instanceCount: 1 },
      { name: "BRAVADA CLUB CHAIR ARM", instanceCount: 2 },
      { name: "BRAVADA CLUB CHAIR BACK", instanceCount: 1 },
    ],
    sticks,
    flags: [
      "arm_top_and_back_top_names_read_short_point_vs_PART_NUMBERING_long_point",
    ],
    auditBucket: "named_cut_strings",
  };
}

export function instantiateBravadaClubChair(
  walker: WalkerExport,
  options?: { finSku?: string; includeCush?: boolean },
): InstantiatedPlan {
  const finSku = (options?.finSku ?? BRAVADA_CLUB_CHAIR_FIN).toUpperCase();
  const includeCush = options?.includeCush !== false;
  const overallWidth = walker.overall.lengthIn ?? 34;
  const overallDepth = walker.overall.depthIn ?? 34;
  const overallHeight = walker.overall.heightIn ?? 31;

  const seat = seatSku(finSku);
  const arm = BRAVADA_SHARED_ARM_SKU;
  const back = backSku(finSku);
  const cush = includeCush ? cushSku(finSku) : null;

  const flags = [...walker.flags];
  const seatCuts: CutLine[] = [];
  const armCuts: CutLine[] = [];
  const backCuts: CutLine[] = [];

  for (const stick of walker.sticks) {
    const weld = assignWeldment(stick);
    if (!weld) {
      flags.push(`unassigned_stick: ${stick.definitionName}`);
      continue;
    }
    const { cut, flag } = toCutLine(stick, overallWidth);
    if (flag) flags.push(flag);
    if (weld === "SEAT") seatCuts.push(cut);
    else if (weld === "ARM") armCuts.push(cut);
    else backCuts.push(cut);
  }

  const lines: DraftBomLine[] = [
    {
      parentSku: finSku,
      childSku: seat,
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
      notes: "Seat frame weldment",
      cutList: [],
    },
    {
      parentSku: finSku,
      childSku: arm,
      quantity: 2,
      scrapFactor: 1,
      unitOfMeasure: "ea",
      notes: "Shared Bravada arm — not handed; qty 2 per chair",
      cutList: [],
    },
    {
      parentSku: finSku,
      childSku: back,
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
      notes: "Back weldment",
      cutList: [],
    },
    ...collapseCutsToRmLines(seat, seatCuts),
    ...collapseCutsToRmLines(arm, armCuts),
    ...collapseCutsToRmLines(back, backCuts),
  ];

  const tubingFt = lines
    .filter(
      (l) =>
        l.childSku.startsWith("RM-MET-") &&
        (l.parentSku === seat || l.parentSku === arm || l.parentSku === back),
    )
    .reduce((sum, l) => {
      // Arm footage is per-arm; chair consumes 2 arms — powder on all metal
      const mult = l.parentSku === arm ? 2 : 1;
      return sum + l.quantity * mult;
    }, 0);

  // Powder on each metal weldment proportional to its footage
  for (const parent of [seat, arm, back]) {
    const ft = lines
      .filter((l) => l.parentSku === parent && l.childSku.startsWith("RM-MET-"))
      .reduce((s, l) => s + l.quantity, 0);
    if (ft > 0) {
      lines.push({
        parentSku: parent,
        childSku: RM_PWD_GENERIC,
        quantity: powderPounds(ft),
        scrapFactor: 1,
        unitOfMeasure: "lb",
        notes: `Powder estimate from ${round4(ft)} ft metal`,
        cutList: [],
      });
    }
  }

  const hubSkus: InstantiatedPlan["hubSkus"] = [
    {
      globalSku: finSku,
      itemType: "finished_good",
      originalName: walker.productHint ?? "Bravada Club Chair",
      category: "Bravada",
    },
    {
      globalSku: seat,
      itemType: "sub_assembly",
      originalName: "Bravada Club Chair Seat Frame",
      category: "Bravada",
    },
    {
      globalSku: arm,
      itemType: "sub_assembly",
      originalName: "Bravada Arm Assembly (shared, not handed)",
      category: "Bravada",
    },
    {
      globalSku: back,
      itemType: "sub_assembly",
      originalName: "Bravada Club Chair Back",
      category: "Bravada",
    },
  ];

  if (cush) {
    hubSkus.push({
      globalSku: cush,
      itemType: "sub_assembly",
      originalName: "Bravada Club Chair Cushion",
      category: "Bravada",
    });
    lines.push({
      parentSku: finSku,
      childSku: cush,
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
      notes: "Cushion sub-assembly",
      cutList: [],
    });
    lines.push({
      parentSku: cush,
      childSku: RM_FAB_GENERIC,
      quantity: fabricYards(overallWidth, overallDepth, overallHeight, false),
      scrapFactor: 1.1,
      unitOfMeasure: "yd",
      notes: "Fabric from overall cushion envelope",
      cutList: [],
    });
    lines.push({
      parentSku: cush,
      childSku: RM_FOAM,
      quantity: foamBoardFeet(overallWidth, overallDepth),
      scrapFactor: 1.05,
      unitOfMeasure: "boardft",
      notes: "Foam board-feet from seat plan",
      cutList: [],
    });
  }

  void tubingFt;
  return {
    finSku,
    seatSku: seat,
    armSku: arm,
    backSku: back,
    cushSku: cush,
    baseSku: null,
    hubSkus,
    lines,
    flags,
  };
}

export const WATERFALL_DINING_TABLE_FIN = "FIN-WFT-DIN-TAB-72X28";

function baseSkuFor(finSku: string): string {
  return `SA-${finSku.replace(/^FIN-/, "")}-BASE`;
}

/**
 * Option B — Waterfall dining table from DAE AABB WalkerExport.
 * FG → BASE (all metal footage) + optional Dekton top. No CUSH / ARM / BACK.
 */
export function instantiateWaterfallDiningTable(
  walker: WalkerExport,
  options?: { finSku?: string; includeDekton?: boolean },
): InstantiatedPlan {
  const finSku = (options?.finSku ?? WATERFALL_DINING_TABLE_FIN).toUpperCase();
  const includeDekton = options?.includeDekton !== false;
  const base = baseSkuFor(finSku);
  const flags = [...walker.flags, "option_b_dae_table_template"];

  const cuts: CutLine[] = [];
  for (const stick of walker.sticks) {
    const { cut, flag } = toCutLine(
      stick,
      walker.overall.lengthIn ?? stick.nameLengthIn ?? 72,
    );
    if (flag) flags.push(flag);
    // Expand instanceCount into cut qty (walker may already set qtyEa)
    cuts.push({
      ...cut,
      qtyEa: stick.instanceCount > 0 ? stick.instanceCount : cut.qtyEa,
      lengthConvention: "square",
      endA: stick.endA ?? 90,
      endB: stick.endB ?? 90,
    });
  }

  const lines: DraftBomLine[] = [
    {
      parentSku: finSku,
      childSku: base,
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "ea",
      notes: "Waterfall dining table base weldment (Option B DAE AABB)",
      cutList: [],
    },
    ...collapseCutsToRmLines(base, cuts),
  ];

  const metalFt = lines
    .filter((l) => l.parentSku === base && l.childSku.startsWith("RM-MET-"))
    .reduce((s, l) => s + l.quantity, 0);
  if (metalFt > 0) {
    lines.push({
      parentSku: base,
      childSku: RM_PWD_GENERIC,
      quantity: powderPounds(metalFt),
      scrapFactor: 1,
      unitOfMeasure: "lb",
      notes: `Powder estimate from ${round4(metalFt)} ft metal`,
      cutList: [],
    });
  }

  if (includeDekton) {
    lines.push({
      parentSku: finSku,
      childSku: RM_DKT_GENERIC,
      quantity: 1,
      scrapFactor: 1,
      unitOfMeasure: "slab",
      notes: "Dekton / stone top placeholder (table-top mesh excluded from tube rollup)",
      cutList: [],
    });
  }

  const hubSkus: InstantiatedPlan["hubSkus"] = [
    {
      globalSku: finSku,
      itemType: "finished_good",
      originalName: walker.productHint ?? "Waterfall Dining Table 72x28",
      category: "Waterfall",
    },
    {
      globalSku: base,
      itemType: "sub_assembly",
      originalName: "Waterfall Dining Table Base Frame",
      category: "Waterfall",
    },
  ];

  return {
    finSku,
    seatSku: base,
    armSku: null,
    backSku: null,
    cushSku: null,
    baseSku: base,
    hubSkus,
    lines,
    flags,
  };
}
