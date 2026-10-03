import { describe, expect, it } from "vitest";
import {
  DEKTON_LB_PER_SQFT,
  estimateHeuristicLogistics,
  freightClassFromPcf,
  PACKAGING_TARE_WEIGHT_LB,
  type HeuristicLogisticsEstimate,
} from "@/lib/heuristic-logistics";

function ready(sku: string): HeuristicLogisticsEstimate {
  const result = estimateHeuristicLogistics(sku);
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`${sku} did not resolve`);
  }
  return result.estimate;
}

describe("heuristic logistics", () => {
  it("rates the Bravada club chair as a 34 x 34 x 31 carton plus pad", () => {
    const chair = ready("FIN-BRV-CLB-CHA-34X34");
    expect(chair.lengthIn).toBe(34);
    expect(chair.widthIn).toBe(34);
    expect(chair.heightIn).toBe(31);
    expect(chair.packagedLengthIn).toBe(38);
    expect(chair.packagedWidthIn).toBe(38);
    expect(chair.packagedHeightIn).toBe(35);
    expect(chair.family).toBe("seating");
    expect(chair.breakdown.packaging).toBe(PACKAGING_TARE_WEIGHT_LB);
    expect(chair.weightLb).toBeGreaterThan(PACKAGING_TARE_WEIGHT_LB);
    const cube =
      (chair.packagedLengthIn * chair.packagedWidthIn * chair.packagedHeightIn) /
      1728;
    expect(chair.pcf).toBeCloseTo(chair.weightLb / cube, 8);
    expect(chair.ltlClass).toBe("300");
    expect(chair.leadTimeDays).toBe(14);
  });

  it("uses the Brooklyn bar-table catalog height of 42 in", () => {
    const bar = ready("FIN-BRK-BAR-TAB-120X28");
    expect(bar.family).toBe("table");
    expect(bar.lengthIn).toBe(120);
    expect(bar.widthIn).toBe(28);
    expect(bar.heightIn).toBe(42);
    expect(bar.packagedHeightIn).toBe(46);
  });

  it("uses the coffee-table catalog height of 17 in", () => {
    const coffee = ready("FIN-BRV-COF-TAB-36X36");
    expect(coffee.family).toBe("table");
    expect(coffee.lengthIn).toBe(36);
    expect(coffee.widthIn).toBe(36);
    expect(coffee.heightIn).toBe(17);
    expect(coffee.packagedHeightIn).toBe(21);
  });

  it("strips a colorway suffix before reading the footprint", () => {
    const base = ready("FIN-BRV-CLB-CHA-34X34");
    const colorway = ready("FIN-BRV-CLB-CHA-34X34-BE");
    expect(colorway.lengthIn).toBe(base.lengthIn);
    expect(colorway.widthIn).toBe(base.widthIn);
    expect(colorway.heightIn).toBe(base.heightIn);
    expect(colorway.weightLb).toBe(base.weightLb);
    expect(colorway.ltlClass).toBe(base.ltlClass);
  });

  it("adds the Dekton top and both Waterfall drops on a dining table", () => {
    const table = ready("FIN-WFT-DIN-TAB-120X36");
    expect(table.family).toBe("table");
    expect(table.lengthIn).toBe(120);
    expect(table.widthIn).toBe(36);
    expect(table.heightIn).toBe(30);
    const topSqft = (120 * 36) / 144;
    const dropWidth = Math.min(120, 36);
    const dropSqft = (dropWidth * 30 * 2) / 144;
    expect(topSqft).toBe(30);
    expect(dropSqft).toBe(15);
    expect(table.breakdown.dekton).toBeCloseTo(
      (topSqft + dropSqft) * DEKTON_LB_PER_SQFT,
      4,
    );
    expect(table.breakdown.dekton).toBe(472.5);
    expect(table.weightLb).toBeGreaterThan(table.breakdown.dekton);
    expect(table.ltlClass).not.toBe("400");
    expect(table.ltlClass).not.toBe("500");
    expect(["200", "250", "175"]).toContain(table.ltlClass);
    expect(table.ltlClass).toBe("175");
  });

  it("drops Waterfall stone on the short ends of a 13 x 40 side table", () => {
    const side = ready("FIN-WFT-SID-TAB-13X40");
    expect(side.lengthIn).toBe(13);
    expect(side.widthIn).toBe(40);
    expect(side.heightIn).toBe(17);
    const dropWidth = Math.min(side.lengthIn, side.widthIn);
    expect(dropWidth).toBe(13);
    const sqft =
      (side.lengthIn * side.widthIn + dropWidth * side.heightIn * 2) / 144;
    expect(side.breakdown.dekton).toBeCloseTo(sqft * DEKTON_LB_PER_SQFT, 4);
    expect(side.breakdown.dekton).toBeLessThan(100);
  });

  it("reads a one-digit footprint such as 38X8", () => {
    const fly = ready("FIN-FLY-TAB-38X8");
    expect(fly.lengthIn).toBe(38);
    expect(fly.widthIn).toBe(8);
    expect(fly.heightIn).toBe(21);
    expect(fly.family).toBe("table");
  });

  it("resolves bare table categories that the first dry run skipped", () => {
    expect(ready("FIN-OCC-TAB-56X14").heightIn).toBe(17);
    expect(ready("FIN-FLY-TAB-96X12").heightIn).toBe(21);
    expect(ready("FIN-MIS-TAB-13X30").heightIn).toBe(24);
    expect(ready("FIN-DAI-TAB-42X42").heightIn).toBe(21);
    expect(estimateHeuristicLogistics("FIN-LED-CHA").status).toBe("skipped");
  });

  it("maps the density breakpoints onto NMFC classes", () => {
    expect(freightClassFromPcf(0.5)).toBe("500");
    expect(freightClassFromPcf(4.5)).toBe("200");
    expect(freightClassFromPcf(6.5)).toBe("150");
    expect(freightClassFromPcf(11)).toBe("92.5");
  });
});
