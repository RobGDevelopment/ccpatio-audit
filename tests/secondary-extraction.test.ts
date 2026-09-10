import { describe, expect, it } from "vitest";
import {
  computeLabor,
  computePackaging,
  computeWeight,
  deriveGeometryDrivers,
  parseCutListFromNotes,
  sumCutListFeet,
  type DraftLineInput,
  type PhysicsFactor,
} from "@/lib/secondary-extraction";

const factors: PhysicsFactor[] = [
  {
    materialSku: "RM-MET-2X2-TUBING",
    profileCode: "SQ2-16",
    weightPlf: 0.91,
    densityPcf: null,
    ozPerYd2: null,
    fabricWidthIn: null,
    perimeterIn: 8,
    coverageSqftPerLb: null,
    attrWeightPlf: null,
  },
  {
    materialSku: "RM-RAW-FOAM",
    profileCode: "",
    weightPlf: null,
    densityPcf: 1.8,
    ozPerYd2: null,
    fabricWidthIn: null,
    perimeterIn: null,
    coverageSqftPerLb: null,
    attrWeightPlf: null,
  },
  {
    materialSku: "RM-FAB-GENERIC",
    profileCode: "",
    weightPlf: null,
    densityPcf: null,
    ozPerYd2: 11.5,
    fabricWidthIn: 54,
    perimeterIn: null,
    coverageSqftPerLb: null,
    attrWeightPlf: null,
  },
  {
    materialSku: "RM-PWD-GENERIC",
    profileCode: "",
    weightPlf: null,
    densityPcf: null,
    ozPerYd2: null,
    fabricWidthIn: null,
    perimeterIn: null,
    coverageSqftPerLb: 4,
    attrWeightPlf: null,
  },
];

describe("secondary extraction notes parser", () => {
  it("extracts cut_list trailer from draft notes", () => {
    const notes =
      'Rails + legs\n{"cut_list":[{"lengthIn":24,"qtyEa":12,"profileCode":"SQ2-16"}]}';
    const { plainNotes, cutList } = parseCutListFromNotes(notes);
    expect(plainNotes).toBe("Rails + legs");
    expect(cutList).toEqual([
      { lengthIn: 24, qtyEa: 12, profileCode: "SQ2-16" },
    ]);
    expect(sumCutListFeet(cutList)).toBe(24);
  });
});

describe("secondary extraction weight", () => {
  it("computes ~23.6 lb frame metal from 24 ft tubing @ 1.08 scrap", () => {
    const lines: DraftLineInput[] = [
      {
        parentSku: "SA-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 24,
        scrapFactor: 1.08,
        unitOfMeasure: "ft",
        notes: null,
        cutList: [],
      },
    ];
    const { estWeightLbs, breakdown } = computeWeight({ lines, factors });
    expect(breakdown.metal).toBeCloseTo(24 * 1.08 * 0.91, 1);
    // Powder inferred from metal surface area when no powder qty on draft
    expect(breakdown.powder).toBeGreaterThan(0);
    expect(estWeightLbs).toBeCloseTo(breakdown.metal + breakdown.powder, 1);
  });

  it("prefers cut_list feet over draft qty", () => {
    const lines: DraftLineInput[] = [
      {
        parentSku: "SA-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 99,
        scrapFactor: 1,
        unitOfMeasure: "ft",
        notes: null,
        cutList: Array.from({ length: 12 }, () => ({
          lengthIn: 24,
          qtyEa: 1,
          profileCode: "SQ2-16",
        })),
      },
    ];
    const { breakdown } = computeWeight({ lines, factors });
    expect(breakdown.metal).toBeCloseTo(24 * 0.91, 1);
  });
});

describe("secondary extraction packaging", () => {
  it("pads FG envelope and computes DIM weight", () => {
    const pack = computePackaging({
      envelope: { lengthIn: 34, depthIn: 34, heightIn: 31 },
    });
    expect(pack.cartonIn).toEqual({ l: 38, w: 38, h: 35 });
    expect(pack.dimWeightLbs).toBe(Math.ceil((38 * 38 * 35) / 139));
    expect(pack.lines).toHaveLength(3);
  });
});

describe("secondary extraction labor", () => {
  it("derives metal cutting run time from piece count", () => {
    const lines: DraftLineInput[] = [
      {
        parentSku: "SA-FRAME",
        childSku: "RM-MET-2X2-TUBING",
        quantity: 24,
        scrapFactor: 1,
        unitOfMeasure: "ft",
        notes: null,
        cutList: Array.from({ length: 12 }, () => ({
          lengthIn: 24,
          qtyEa: 1,
          profileCode: "SQ2-16",
        })),
      },
    ];
    const drivers = deriveGeometryDrivers({ lines, factors });
    expect(drivers.nCuts).toBe(12);
    expect(drivers.tubeFt).toBe(24);
    const labor = computeLabor({ drivers, estWeightLbs: 35 });
    const cutting = labor.ops.find((o) => o.workCenter === "Metal Cutting");
    expect(cutting?.runTimeMins).toBeCloseTo(5 + 12 * 0.35, 2);
  });
});
