import { describe, expect, it } from "vitest";
import {
  BRAVADA_CLUB_CHAIR_FIN,
  BRAVADA_SHARED_ARM_SKU,
  bravadaClubChairFixtureWalker,
  classifyLengthConvention,
  critiqueCutlistPlan,
  instantiateBravadaClubChair,
  longPointFromShort,
  parseComponentName,
  profileToRmSku,
} from "@/lib/sketchup-cutlist";

describe("parseComponentName", () => {
  it("parses Bravada seat frame cut string", () => {
    const p = parseComponentName('BRAVADA SEAT FRAME 2X2 16 GA 34" 45 45');
    expect(p.profile).toBe("SQ2-16");
    expect(p.nameLengthIn).toBe(34);
    expect(p.endA).toBe(45);
    expect(p.endB).toBe(45);
    expect(p.looksLikeCut).toBe(true);
  });

  it("parses flat bar and skips 1/8 thickness token", () => {
    const p = parseComponentName('BRAVADA FLAT BAR HR FLAT 1/8" 30" 90 90');
    expect(p.profile).toBe("FB0.125x1.5");
    expect(p.nameLengthIn).toBe(30);
    expect(profileToRmSku(p.profile)).toBe("RM-MET-FLATBAR");
  });
});

describe("long-point convention", () => {
  it("adds 2.0in per 45° end on 2in tube", () => {
    expect(longPointFromShort(30, 2, 45, 45)).toBe(34);
    expect(longPointFromShort(32, 2, 45, 90)).toBe(34);
  });

  it("flags back-top 30 as short against 34 overall", () => {
    const g = classifyLengthConvention({
      nameLengthIn: 30,
      profileWidthIn: 2,
      endA: 45,
      endB: 45,
      expectedLongPointIn: 34,
      role: "BACK TOP",
    });
    expect(g.convention).toBe("short_point");
    expect(g.longPointIn).toBe(34);
    expect(g.flag).toMatch(/convention_conflict/);
  });

  it("keeps seat 34 as long-point", () => {
    const g = classifyLengthConvention({
      nameLengthIn: 34,
      profileWidthIn: 2,
      endA: 45,
      endB: 45,
      expectedLongPointIn: 34,
      role: "SEAT FRAME",
    });
    expect(g.convention).toBe("long_point");
    expect(g.flag).toBeNull();
  });
});

describe("Bravada club chair family template", () => {
  it("builds nested SEAT / shared ARM x2 / BACK with bulk feet not CUT SKUs", () => {
    const plan = instantiateBravadaClubChair(bravadaClubChairFixtureWalker());
    expect(plan.finSku).toBe(BRAVADA_CLUB_CHAIR_FIN);
    expect(plan.armSku).toBe(BRAVADA_SHARED_ARM_SKU);

    const fgChildren = plan.lines
      .filter((l) => l.parentSku === plan.finSku)
      .map((l) => `${l.childSku}@${l.quantity}`);
    expect(fgChildren).toEqual(
      expect.arrayContaining([
        `${plan.seatSku}@1`,
        `${BRAVADA_SHARED_ARM_SKU}@2`,
        `${plan.backSku}@1`,
        `${plan.cushSku}@1`,
      ]),
    );

    expect(plan.lines.some((l) => l.childSku.startsWith("CUT-"))).toBe(false);

    const seatTube = plan.lines.find(
      (l) =>
        l.parentSku === plan.seatSku && l.childSku === "RM-MET-2X2-TUBING",
    );
    expect(seatTube).toBeTruthy();
    expect(seatTube!.unitOfMeasure).toBe("ft");
    // 4×34" + 4×8" = 168" = 14 ft before scrap
    expect(seatTube!.quantity).toBeCloseTo(14, 1);
    expect(seatTube!.notes).toMatch(/34\.0in/);
    expect(seatTube!.scrapFactor).toBe(1.08);

    const armTube = plan.lines.find(
      (l) => l.parentSku === plan.armSku && l.childSku === "RM-MET-2X2-TUBING",
    );
    // Per-arm: long-point arm top 34 + post 14 = 48" = 4 ft
    expect(armTube!.quantity).toBeCloseTo(4, 1);

    const critic = critiqueCutlistPlan({
      plan,
      walker: bravadaClubChairFixtureWalker(),
    });
    expect(critic.okForDraft).toBe(true);
  });
});
