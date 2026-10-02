import { describe, expect, it } from "vitest";
import {
  coldSawMinPerCut,
  cushionSmvSplit,
  dektonFabricationSmvMin,
  fabPodRunSmvMin,
  grindingSmvMin,
  metalCuttingSmvMin,
  PF_AND_D,
  powderActiveLaborSmvMin,
  powderCurePassiveMin,
  RESEARCH_SMV,
  weldFixturingSmvMin,
} from "@/lib/factory-routing/smv-baselines";

describe("smv-baselines (Build_Time_Estimates research lock)", () => {
  it("encodes ILO PF&D multipliers", () => {
    expect(PF_AND_D.general).toBe(1.15);
    expect(PF_AND_D.heavyFab).toBe(1.2);
  });

  it("locks cold-saw per-cut and club-chair Metal Cutting at 6.9", () => {
    expect(coldSawMinPerCut()).toBe(0.86);
    expect(metalCuttingSmvMin()).toBe(RESEARCH_SMV.metalCuttingClubChairMin);
    expect(metalCuttingSmvMin()).toBe(6.9);
  });

  it("locks TIG weld+fixture at 55.9 and grind at 20.4", () => {
    expect(weldFixturingSmvMin()).toBe(RESEARCH_SMV.weldFixturingClubChairMin);
    expect(weldFixturingSmvMin()).toBe(55.9);
    expect(grindingSmvMin()).toBe(RESEARCH_SMV.grindingClubChairMin);
    expect(grindingSmvMin()).toBe(20.4);
  });

  it("locks FAB POD run as weld+grind = 76.3 (cut is separate feeder)", () => {
    expect(fabPodRunSmvMin()).toBe(RESEARCH_SMV.fabPodClubChairMin);
    expect(fabPodRunSmvMin()).toBe(76.3);
    expect(fabPodRunSmvMin()).toBe(
      RESEARCH_SMV.weldFixturingClubChairMin +
        RESEARCH_SMV.grindingClubChairMin,
    );
  });

  it("locks powder active labor 13.8 and passive cure 20.0", () => {
    expect(powderActiveLaborSmvMin()).toBe(RESEARCH_SMV.powderActiveLaborMin);
    expect(powderActiveLaborSmvMin()).toBe(13.8);
    expect(powderCurePassiveMin()).toBe(RESEARCH_SMV.powderCurePassiveMin);
    expect(powderCurePassiveMin()).toBe(20);
  });

  it("splits cushion SAM across 2nd-floor cells totaling 20.7", () => {
    const split = cushionSmvSplit();
    expect(split.fabricCuttingMin).toBe(RESEARCH_SMV.cushionFabricCuttingMin);
    expect(split.fabricSewingMin).toBe(RESEARCH_SMV.cushionFabricSewingMin);
    expect(split.cushionStuffingMin).toBe(RESEARCH_SMV.cushionStuffingMin);
    expect(split.totalMin).toBe(RESEARCH_SMV.cushionTotalMin);
    expect(split.fabricCuttingMin).toBe(2.9);
    expect(split.fabricSewingMin).toBe(13.8);
    expect(split.cushionStuffingMin).toBe(4.0);
    expect(split.totalMin).toBe(20.7);
    expect(
      Math.round(
        (split.fabricCuttingMin +
          split.fabricSewingMin +
          split.cushionStuffingMin) *
          10,
      ) / 10,
    ).toBe(20.7);
  });

  it("locks Dekton fabrication at 34.5", () => {
    expect(dektonFabricationSmvMin()).toBe(RESEARCH_SMV.dektonFabricationMin);
    expect(dektonFabricationSmvMin()).toBe(34.5);
  });
});
