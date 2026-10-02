import { describe, expect, it } from "vitest";
import {
  RM_MET_15X075,
  RM_MET_2X2,
  RM_MET_FLATBAR,
  RM_PLASTIC_CAP_2X2,
  RM_POWDER_COAT,
  armCountFromSku,
  buildLevel2Plan,
  legCountFromWidth,
  parseSaFrame,
  seatingFlatbarFeet,
  seatingSlatFeet,
  seatingTube2x2Feet,
  tableTube2x2Feet,
} from "@/lib/level2-bom";

describe("armCountFromSku", () => {
  it("zeros ARMLESS and -ARM- SKUs", () => {
    expect(armCountFromSku("ASM-BRV-ARM-SOF-72X34-FRAME")).toBe(0);
    expect(armCountFromSku("SA-BRO-S-72-ARMLESS-FRAME")).toBe(0);
    expect(armCountFromSku("SA-BRO-S-72-A-FRAME")).toBe(0);
  });

  it("counts one arm for handed LS/RS/LAF/RAF", () => {
    expect(armCountFromSku("SA-BRO-C-72X34-LS-FRAME")).toBe(1);
    expect(armCountFromSku("SA-BRO-C-72X34-RS-FRAME")).toBe(1);
    expect(armCountFromSku("SA-BRO-CS-72-LAF-FRAME")).toBe(1);
    expect(armCountFromSku("SA-BRO-CS-72-RAF-FRAME")).toBe(1);
  });

  it("defaults to two arms", () => {
    expect(armCountFromSku("SA-OCE-S-96-FRAME")).toBe(2);
    expect(armCountFromSku("SA-BRA-CC-FRAME")).toBe(2);
  });
});

describe("legCountFromWidth", () => {
  it("adds two center supports at 72in and above", () => {
    expect(legCountFromWidth(34)).toBe(4);
    expect(legCountFromWidth(60)).toBe(4);
    expect(legCountFromWidth(72)).toBe(6);
    expect(legCountFromWidth(96)).toBe(6);
  });
});

describe("seating formulas (Owner lock, scrap 1.08)", () => {
  it("matches the 34x34 club chair 2x2 rollup (358 in) after scrap", () => {
    // 358 in / 12 * 1.08 = 32.22
    expect(seatingTube2x2Feet(34, 34, 2, 4)).toBe(32.22);
    expect(seatingSlatFeet(34, 34)).toBe(10.8);
    expect(seatingFlatbarFeet(34)).toBe(5.4);
  });

  it("scales a 72x34 LS chaise (1 arm, 6 legs)", () => {
    const ft = seatingTube2x2Feet(72, 34, 1, 6);
    // inches = 144+68 + 48 + 32 + 14 + 38 + 136 = 480
    // 480/12*1.08 = 43.2
    expect(ft).toBe(43.2);
    expect(seatingSlatFeet(72, 34)).toBe(21.6);
    expect(seatingFlatbarFeet(72)).toBe(12.24);
  });
});

describe("table formula (42x42 coffee North Star)", () => {
  it("is 380 in of 2x2 * 1.08 scrap", () => {
    expect(tableTube2x2Feet(42, 42, 16)).toBe(34.2);
  });
});

describe("parseSaFrame", () => {
  it("parses the Owner example chaise", () => {
    const p = parseSaFrame("SA-BRO-C-72X34-LS-FRAME");
    expect(p.family).toBe("seating");
    expect(p.widthIn).toBe(72);
    expect(p.depthIn).toBe(34);
    expect(p.armCount).toBe(1);
    expect(p.legCount).toBe(6);
    expect(p.skipReason).toBeNull();
  });

  it("defaults Ocean club chair SA-OCE-CC-FRAME to 34x38", () => {
    const p = parseSaFrame("SA-OCE-CC-FRAME");
    expect(p.family).toBe("seating");
    expect(p.widthIn).toBe(34);
    expect(p.depthIn).toBe(38);
    expect(p.armCount).toBe(2);
    expect(p.legCount).toBe(4);
  });

  it("treats coffee-table CT as table family", () => {
    const p = parseSaFrame("SA-BRA-CT-42X42-FRAME");
    expect(p.family).toBe("table");
    expect(p.heightIn).toBe(16);
    expect(p.legCount).toBe(4);
    expect(p.armCount).toBe(0);
  });

  it("uses dining height on waterfall BASE", () => {
    const p = parseSaFrame("SA-WFT-DIN-TAB-72X28-BASE");
    expect(p.family).toBe("table");
    expect(p.widthIn).toBe(72);
    expect(p.depthIn).toBe(28);
    expect(p.heightIn).toBe(30);
  });

  it("skips CUSH parents", () => {
    const p = parseSaFrame("SA-BRO-C-72X34-LS-CUSH");
    expect(p.family).toBe("skip");
  });
});

describe("buildLevel2Plan", () => {
  it("emits metal + powder + caps for the LS chaise", () => {
    const live = new Set([
      "SA-BRO-C-72X34-LS-FRAME",
      RM_MET_2X2,
      RM_MET_15X075,
      RM_MET_FLATBAR,
      RM_POWDER_COAT,
      RM_PLASTIC_CAP_2X2,
    ]);
    const plan = buildLevel2Plan("SA-BRO-C-72X34-LS-FRAME", live);
    expect(plan.lines.map((l) => l.childSku)).toEqual([
      RM_MET_2X2,
      RM_MET_15X075,
      RM_MET_FLATBAR,
      RM_POWDER_COAT,
      RM_PLASTIC_CAP_2X2,
    ]);
    expect(plan.lines.find((l) => l.role === "cap")?.quantity).toBe(6);
    expect(plan.tubingFeet).toBe(64.8);
    expect(plan.lines.find((l) => l.role === "powder")?.quantity).toBe(5.184);
  });

  it("aliases powder and caps to live Hub SKUs when Owner names are absent", () => {
    const live = new Set(["RM-PWD-GENERIC", "RM-HRD-2X2-METAL-CAP"]);
    const plan = buildLevel2Plan("SA-BRA-CC-FRAME", live);
    expect(plan.powderSku).toBe("RM-PWD-GENERIC");
    expect(plan.capSku).toBe("RM-HRD-2X2-METAL-CAP");
    expect(plan.lines.some((l) => l.childSku === "RM-PWD-GENERIC")).toBe(true);
    expect(plan.lines.some((l) => l.childSku === "RM-HRD-2X2-METAL-CAP")).toBe(
      true,
    );
  });

  it("emits only 2x2 + powder + 4 caps for a coffee table", () => {
    const plan = buildLevel2Plan("SA-BRA-CT-42X42-FRAME", new Set());
    expect(plan.parsed.family).toBe("table");
    expect(plan.lines.map((l) => `${l.childSku}:${l.quantity}`)).toEqual([
      `${RM_MET_2X2}:34.2`,
      `${RM_POWDER_COAT}:2.736`,
      `${RM_PLASTIC_CAP_2X2}:4`,
    ]);
  });
});
