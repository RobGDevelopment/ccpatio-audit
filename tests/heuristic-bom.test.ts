import { describe, expect, it } from "vitest";
import {
  buildHeuristicPlan,
  fabricYards,
  foamBoardFeet,
  parseNamedDimensions,
  powderPounds,
  subAssemblySku,
  tubingFeet,
} from "@/lib/heuristic-bom";

describe("heuristic BOM volumes", () => {
  it("parses 72 x 34 x 31 from a Bravada sofa name", () => {
    expect(
      parseNamedDimensions('BRAVADA SOFA 72" x 34" x 31" BH'),
    ).toEqual({ length: "72", depth: "34", height: "31" });
  });

  it("estimates ~8 yards of fabric for a 72x34x31 sofa before scrap", () => {
    const yards = fabricYards(72, 34, 31, false);
    expect(yards).toBeGreaterThan(7);
    expect(yards).toBeLessThan(8.5);
  });

  it("builds FRAME + CUSH for seating with MTO placeholders", () => {
    const plan = buildHeuristicPlan({
      sowName: 'BRAVADA SOFA 72" x 34" x 31" BH',
      canonicalSku: "FIN-BRV-SOF-72X34",
      collection: "Bravada",
      length: "72",
      depth: "34",
      height: "31",
      slots: { fabric: true, powder: true, dekton: false, pillow: true },
    });

    expect(plan.family).toBe("seating");
    expect(plan.frameSku).toBe("SA-BRV-SOF-72X34-FRAME");
    expect(plan.cushSku).toBe("SA-BRV-SOF-72X34-CUSH");
    expect(plan.lines.map((row) => `${row.parentSku}->${row.childSku}`)).toEqual(
      expect.arrayContaining([
        "FIN-BRV-SOF-72X34->SA-BRV-SOF-72X34-FRAME",
        "FIN-BRV-SOF-72X34->SA-BRV-SOF-72X34-CUSH",
        "SA-BRV-SOF-72X34-FRAME->RM-MET-2X2-TUBING",
        "SA-BRV-SOF-72X34-FRAME->RM-PWD-GENERIC",
        "SA-BRV-SOF-72X34-CUSH->RM-FAB-GENERIC",
        "SA-BRV-SOF-72X34-CUSH->RM-RAW-FOAM",
      ]),
    );
    expect(plan.lines.some((row) => row.childSku.startsWith("FAB-"))).toBe(false);
    const fabric = plan.lines.find((row) => row.childSku === "RM-FAB-GENERIC");
    expect(fabric?.unitOfMeasure).toBe("yd");
    expect(Number(fabric?.quantity)).toBeGreaterThan(7);
  });

  it("gives tables a FRAME only plus dekton placeholder when slotted", () => {
    const plan = buildHeuristicPlan({
      sowName: 'WATERFALL TABLE (DINING HEIGHT) 36" x 72" x 30"',
      canonicalSku: "FIN-WFT-DIN-TAB-36X72",
      collection: "Waterfall",
      length: "36",
      depth: "72",
      height: "30",
      slots: { fabric: false, powder: true, dekton: true, pillow: false },
    });
    expect(plan.family).toBe("table");
    expect(plan.cushSku).toBeNull();
    expect(plan.lines.some((row) => row.childSku === "RM-DKT-GENERIC-SLAB")).toBe(
      true,
    );
    expect(plan.lines.some((row) => row.childSku === "RM-FAB-GENERIC")).toBe(
      false,
    );
  });

  it("skips covers and unspecified accessories", () => {
    const plan = buildHeuristicPlan({
      sowName: "WEATHERPROOF COVERS",
      canonicalSku: "FIN-ESY-MIS-WEATHERPROOFCO",
      collection: "Flexy",
      length: "",
      depth: "",
      height: "",
      slots: { fabric: false, powder: false, dekton: false, pillow: false },
    });
    expect(plan.family).toBe("skip");
    expect(plan.lines).toEqual([]);
  });

  it("mints SA SKUs from the FIN stem", () => {
    expect(subAssemblySku("FIN-BRV-ARM-SOF-72X34", "FRAME")).toBe(
      "SA-BRV-ARM-SOF-72X34-FRAME",
    );
  });

  it("keeps tubing / foam / powder formulas stable", () => {
    expect(tubingFeet(72, 34, 31)).toBe(28);
    expect(foamBoardFeet(72, 34)).toBe(68);
    expect(powderPounds(28)).toBe(2.24);
  });
});
