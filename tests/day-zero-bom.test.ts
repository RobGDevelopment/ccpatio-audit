import { describe, expect, it } from "vitest";
import {
  buildDayZeroDocument,
  formatCutListNote,
  type DayZeroReviewFile,
} from "@/lib/day-zero-bom";
import { fabricYards, foamBoardFeet, powderPounds } from "@/lib/heuristic-bom";

const CLUB: DayZeroReviewFile = {
  file: "1 BRAVADA club chair.obj",
  finCandidate: "FIN-BRV-CLB-CHA",
  status: "measured",
  draftEligible: true,
  recipes: [
    {
      recipeSku: "MET-TB22060",
      profileCode: "SQ2-16",
      netFt: 29.8333,
      katanaQuantityFt: 32.22,
      cuts: [
        { qtyEa: 1, longPointIn: 34, shortPointIn: 30, endA: 45, endB: 45, compoundLongEdges: false },
        { qtyEa: 2, longPointIn: 32, shortPointIn: null, endA: 45, endB: 45, compoundLongEdges: false },
        { qtyEa: 2, longPointIn: 32, shortPointIn: 30, endA: 45, endB: 90, compoundLongEdges: false },
        { qtyEa: 3, longPointIn: 30, shortPointIn: null, endA: 90, endB: 90, compoundLongEdges: false },
        { qtyEa: 2, longPointIn: 21, shortPointIn: 17, endA: 45, endB: 45, compoundLongEdges: true },
        { qtyEa: 2, longPointIn: 14, shortPointIn: 12, endA: 45, endB: 90, compoundLongEdges: false },
        { qtyEa: 2, longPointIn: 10, shortPointIn: 8, endA: 45, endB: 90, compoundLongEdges: false },
        { qtyEa: 2, longPointIn: 8, shortPointIn: null, endA: 90, endB: 90, compoundLongEdges: false },
      ],
    },
    {
      recipeSku: "MET-FH181",
      profileCode: "FB1x0.125",
      netFt: 12.5,
      katanaQuantityFt: 13.5,
      cuts: [
        { qtyEa: 5, longPointIn: 30, shortPointIn: null, endA: 90, endB: 90, compoundLongEdges: false },
      ],
    },
    {
      recipeSku: "MET-TB11234060",
      profileCode: "RT1.5x0.75-16",
      netFt: 2.5,
      katanaQuantityFt: 2.7,
      cuts: [
        { qtyEa: 1, longPointIn: 30, shortPointIn: null, endA: 90, endB: 90, compoundLongEdges: false },
      ],
    },
  ],
};

describe("buildDayZeroDocument club chair", () => {
  const doc = buildDayZeroDocument(CLUB);

  it("prefers the sized finished good, then the approved base", () => {
    expect(doc.finCandidates).toEqual(["FIN-BRV-CLB-CHA-34X34", "FIN-BRV-CLB-CHA"]);
    expect(doc.dimSource).toBe("catalog_default");
    expect(doc.widthIn).toBe(34);
    expect(doc.depthIn).toBe(34);
    expect(doc.finSku).toBe("FIN-BRV-CLB-CHA-34X34");
    expect(doc.frameSku).toBe("ASM-BRV-CLB-CHA-34X34-FRAME");
    expect(doc.cushionSku).toBe("ASM-BRV-CLB-CHA-34X34-CUSH");
  });

  it("puts scrap-adjusted metal on the frame and soft goods on the cushion", () => {
    const frame = doc.parents.find((parent) => parent.role === "frame");
    const cushion = doc.parents.find((parent) => parent.role === "cushion");
    const fin = doc.parents.find((parent) => parent.role === "finished_good");
    expect(frame?.rows.map((row) => [row.ingredientSku, row.quantity])).toEqual([
      ["MET-TB22060", 32.22],
      ["MET-FH181", 13.5],
      ["MET-TB11234060", 2.7],
      ["RM-HRD-2X2-METAL-CAP", 4],
      ["PWD-BLACK", Math.round(powderPounds(32.3333) * 1.05 * 10000) / 10000],
    ]);
    expect(cushion?.rows.map((row) => [row.ingredientSku, row.quantity])).toEqual([
      ["RM-FAB-GENERIC", Math.round(fabricYards(34, 34, 0, false) * 1.1 * 10000) / 10000],
      ["RM-RAW-FOAM", Math.round(foamBoardFeet(34, 34) * 1.05 * 10000) / 10000],
    ]);
    expect(fin?.rows.map((row) => row.ingredientSku)).toEqual([
      "ASM-BRV-CLB-CHA-34X34-FRAME",
      "ASM-BRV-CLB-CHA-34X34-CUSH",
    ]);
  });

  it("formats the 2x2 chop-saw note", () => {
    const note = formatCutListNote(CLUB.recipes[0]!.cuts);
    expect(note).toBe(
      '1x34" 45/45 short 30; 2x32" 45/45; 2x32" 45/90 short 30; 3x30" 90/90; 2x21" 45/45 short 17 compound; 2x14" 45/90 short 12; 2x10" 45/90 short 8; 2x8" 90/90',
    );
  });
});

describe("fused models", () => {
  it("skips fused_mesh and no_metal", () => {
    expect(
      buildDayZeroDocument({ ...CLUB, status: "fused_mesh", draftEligible: false }).status,
    ).toBe("skipped");
    expect(
      buildDayZeroDocument({ ...CLUB, status: "no_metal", draftEligible: false }).skipReason,
    ).toBe("no_metal");
  });
});
