import { describe, expect, it } from "vitest";
import {
  BRAVADA_CLUB_MODULAR_SKUS,
  canonicalMonolithicCushSku,
  canonicalMonolithicFrameSku,
  classifyFinFamily,
  heuristicClubChairPurgeEdges,
  identityStemCandidates,
  isDimlessCollectionSa,
  isModularWeldmentSku,
  monolithicStem,
  planLevel1ConflictPurge,
  planUniversalLevel1Import,
  type MonolithicLevel1Edge,
  purgeRowsFromEdges,
  resolveMonolithicLevel1,
  resolveUniversalLevel1,
  uniqueFrameSkus,
} from "@/lib/monolithic-builds";
import { parseFinTwinParts } from "@/lib/katana-fin-bom";
import { buildLevel2Plan } from "@/lib/level2-bom";

describe("isModularWeldmentSku", () => {
  it("flags shared ARM / BACK / SEAT weldments", () => {
    expect(isModularWeldmentSku("SA-BRV-ARM")).toBe(true);
    expect(isModularWeldmentSku("ASM-BRV-ARM")).toBe(true);
    expect(isModularWeldmentSku("SA-BRV-CLB-CHA-34X34-BACK")).toBe(true);
    expect(isModularWeldmentSku("SA-BRV-CLB-CHA-34X34-SEAT")).toBe(true);
  });

  it("does not flag dimensioned FRAME/CUSH or ARM-SOF products", () => {
    expect(isModularWeldmentSku("SA-BRV-CLB-CHA-34X34-FRAME")).toBe(false);
    expect(isModularWeldmentSku("SA-BRV-CLB-CHA-34X34-CUSH")).toBe(false);
    expect(isModularWeldmentSku("ASM-BRV-ARM-SOF-72X34-FRAME")).toBe(false);
  });
});

describe("isDimlessCollectionSa", () => {
  it("flags legacy club-chair CC shells", () => {
    expect(isDimlessCollectionSa("SA-BRA-CC-FRAME")).toBe(true);
    expect(isDimlessCollectionSa("SA-BRA-CC-CUSH")).toBe(true);
    expect(isDimlessCollectionSa("SA-OCE-CC-FRAME")).toBe(true);
  });

  it("leaves dimensioned frames alone", () => {
    expect(isDimlessCollectionSa("SA-BRO-C-72X34-LS-FRAME")).toBe(false);
    expect(isDimlessCollectionSa("SA-OCE-S-96-FRAME")).toBe(false);
  });
});

describe("monolithicStem / canonical SKUs", () => {
  it("maps the Bravada club chair colorway to a dimensioned SA-BRV frame", () => {
    expect(monolithicStem("FIN-BRV-CLB-CHA-BE")).toBe("BRV-CLB-CHA-34X34");
    expect(canonicalMonolithicFrameSku("FIN-BRV-CLB-CHA-BE")).toBe(
      "SA-BRV-CLB-CHA-34X34-FRAME",
    );
    expect(canonicalMonolithicCushSku("FIN-BRV-CLB-CHA-BE")).toBe(
      "SA-BRV-CLB-CHA-34X34-CUSH",
    );
  });

  it("keeps Ocean club-chair 34x38 and handedness", () => {
    expect(monolithicStem("FIN-OCN-CLB-CHA-34X38-LS-BE-N")).toBe(
      "OCN-CLB-CHA-34X38-LS",
    );
  });

  it("defaults dimless swivels to 34X34 (Ocean tries 34X38 first)", () => {
    expect(monolithicStem("FIN-BRV-SWV-CHA")).toBe("BRV-SWV-CHA-34X34");
    expect(identityStemCandidates("FIN-OCN-SWV-CHA")).toEqual([
      "OCN-SWV-CHA-34X38",
      "OCN-SWV-CHA-34X34",
    ]);
  });
});

describe("parseFinTwinParts identity (Phase 2)", () => {
  it("strips color and Ocean Y/N but keeps LS/RS/LAF/RAF", () => {
    expect(parseFinTwinParts("FIN-BRK-CHS-72X34-LS-BE")).toEqual(
      expect.objectContaining({
        collection: "BRK",
        category: "CHS",
        dimToken: "72X34",
        hand: "LS",
      }),
    );
    expect(parseFinTwinParts("FIN-OCN-CLB-CHA-34X38-WH-Y")).toEqual(
      expect.objectContaining({
        collection: "OCN",
        category: "CLB-CHA",
        dimToken: "34X38",
        hand: null,
      }),
    );
  });

  it("classifies seating vs table", () => {
    expect(classifyFinFamily(parseFinTwinParts("FIN-BRV-SOF-72X34-BE")!)).toBe(
      "seating",
    );
    expect(classifyFinFamily(parseFinTwinParts("FIN-OCN-COF-TAB-42X28-GR")!)).toBe(
      "table",
    );
    expect(classifyFinFamily(parseFinTwinParts("FIN-BRK-BAR-TAB-36X72")!)).toBe(
      "table",
    );
    expect(classifyFinFamily(parseFinTwinParts("FIN-MAR-3M-UMB-NO-BAS")!)).toBe(
      "skip",
    );
  });

  it("treats a bare -TAB- SKU as a table", () => {
    for (const sku of [
      "FIN-DAI-TAB-72X42",
      "FIN-FLY-TAB-60X12",
      "FIN-OCN-TAB-13X30",
      "FIN-MLN-TAB-56X14",
      "FIN-OCC-TAB-56X14",
    ]) {
      expect(classifyFinFamily(parseFinTwinParts(sku)!)).toBe("table");
    }
  });

  it("keeps dining chairs and benches as seating despite the DIN token", () => {
    for (const sku of [
      "FIN-TAY-DIN-CHA-19X23",
      "FIN-WFT-DIN-BCH-96X22",
      "FIN-TAY-BEN-DIN-HEI-42",
      "FIN-FLY-LEG-BEN-DIN-HEI-42",
      "FIN-WFT-FLY-BST-18X18",
    ]) {
      expect(classifyFinFamily(parseFinTwinParts(sku)!)).toBe("seating");
    }
    expect(classifyFinFamily(parseFinTwinParts("FIN-WFT-DIN-TAB-72X36")!)).toBe(
      "table",
    );
  });
});

describe("resolveMonolithicLevel1", () => {
  it("prefers a live ASM dimensioned twin", () => {
    const live = new Set([
      "FIN-BRV-CLB-CHA-BE",
      "ASM-BRV-CLB-CHA-34X34-FRAME",
      "ASM-BRV-CLB-CHA-34X34-CUSH",
      "SA-BRA-CC-FRAME",
    ]);
    const edges = resolveMonolithicLevel1("FIN-BRV-CLB-CHA-BE", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "ASM-BRV-CLB-CHA-34X34-FRAME",
      "ASM-BRV-CLB-CHA-34X34-CUSH",
    ]);
    expect(edges.every((e) => e.live)).toBe(true);
  });

  it("does not pick dim-less SA-BRA-CC-FRAME when the dimensioned SKU is absent", () => {
    const live = new Set(["FIN-BRV-CLB-CHA", "SA-BRA-CC-FRAME", "SA-BRA-CC-CUSH"]);
    const edges = resolveMonolithicLevel1("FIN-BRV-CLB-CHA", live);
    expect(edges[0]?.ingredientSku).toBe("SA-BRV-CLB-CHA-34X34-FRAME");
    expect(edges[0]?.live).toBe(false);
    expect(edges[1]?.ingredientSku).toBe("SA-BRV-CLB-CHA-34X34-CUSH");
  });
});

describe("purgeRowsFromEdges", () => {
  it("zeroes modular ingredients on the FIN and the modular parent's own BOM", () => {
    const rows = purgeRowsFromEdges([
      { parentSku: "FIN-BRV-CLB-CHA", ingredientSku: "SA-BRV-ARM", quantity: 2 },
      { parentSku: "FIN-BRV-CLB-CHA", ingredientSku: "SA-BRV-CLB-CHA-34X34-BACK" },
      { parentSku: "FIN-BRV-CLB-CHA", ingredientSku: "SA-BRA-CC-CUSH" },
      { parentSku: "FIN-BRV-CLB-CHA", ingredientSku: "SA-BRV-CLB-CHA-34X34-FRAME" },
      { parentSku: "SA-BRV-ARM", ingredientSku: "RM-MET-2X2-TUBING" },
    ]);
    expect(rows).toEqual([
      { parentSku: "FIN-BRV-CLB-CHA", ingredientSku: "SA-BRA-CC-CUSH", quantity: 0 },
      {
        parentSku: "FIN-BRV-CLB-CHA",
        ingredientSku: "SA-BRV-ARM",
        quantity: 0,
      },
      {
        parentSku: "FIN-BRV-CLB-CHA",
        ingredientSku: "SA-BRV-CLB-CHA-34X34-BACK",
        quantity: 0,
      },
      { parentSku: "SA-BRV-ARM", ingredientSku: "RM-MET-2X2-TUBING", quantity: 0 },
    ]);
  });
});

describe("heuristicClubChairPurgeEdges", () => {
  it("emits live Bravada ARM/BACK/SEAT zeros for club-chair FINs", () => {
    const live = new Set<string>([...BRAVADA_CLUB_MODULAR_SKUS, "FIN-BRV-CLB-CHA-WH"]);
    const rows = heuristicClubChairPurgeEdges("FIN-BRV-CLB-CHA-WH", live);
    expect(rows.length).toBe(BRAVADA_CLUB_MODULAR_SKUS.length);
    expect(rows.every((r) => r.quantity === 0)).toBe(true);
  });
});

describe("resolveUniversalLevel1", () => {
  it("fans a colorway club chair onto one live FRAME + CUSH", () => {
    const live = new Set([
      "FIN-BRV-CLB-CHA-BE",
      "SA-BRV-CLB-CHA-34X34-FRAME",
      "SA-BRV-CLB-CHA-34X34-CUSH",
      "SA-BRA-CC-FRAME",
    ]);
    const edges = resolveUniversalLevel1("FIN-BRV-CLB-CHA-BE", live);
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:SA-BRV-CLB-CHA-34X34-FRAME",
      "CUSH:SA-BRV-CLB-CHA-34X34-CUSH",
    ]);
    expect(edges.every((e) => e.quantity === 1 && e.live)).toBe(true);
  });

  it("keeps handedness on chaise colorways and uses the live Hub twin", () => {
    const live = new Set([
      "FIN-BRK-CHS-72X34-LS-BE",
      "SA-BRK-CHS-72X34-LS-FRAME",
      "SA-BRK-CHS-72X34-LS-CUSH",
      "SA-BRO-C-72X34-LS-FRAME",
    ]);
    const edges = resolveUniversalLevel1("FIN-BRK-CHS-72X34-LS-BE", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "SA-BRK-CHS-72X34-LS-FRAME",
      "SA-BRK-CHS-72X34-LS-CUSH",
    ]);
  });

  it("falls back to a dimensioned legacy SA twin when Hub grammar is absent", () => {
    const live = new Set([
      "FIN-BRK-CHS-72X34-LS-BE",
      "SA-BRO-C-72X34-LS-FRAME",
      "SA-BRO-C-72X34-LS-CUSH",
    ]);
    const edges = resolveUniversalLevel1("FIN-BRK-CHS-72X34-LS-BE", live);
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:SA-BRO-C-72X34-LS-FRAME",
      "CUSH:SA-BRO-C-72X34-LS-CUSH",
    ]);
  });

  it("maps a table FIN to FRAME only plus a live Dekton slab", () => {
    const live = new Set([
      "FIN-OCN-COF-TAB-42X28-GR",
      "SA-OCN-COF-TAB-42X28-FRAME",
      "SA-OCN-COF-TAB-42X28-CUSH",
      "RM-DKT-GENERIC-SLAB",
    ]);
    const edges = resolveUniversalLevel1("FIN-OCN-COF-TAB-42X28-GR", live);
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:SA-OCN-COF-TAB-42X28-FRAME",
      "DKT:RM-DKT-GENERIC-SLAB",
    ]);
  });

  it("maps a table with a live DKT twin instead of the generic slab", () => {
    const live = new Set([
      "FIN-WFT-DIN-TAB-72X28",
      "SA-WFT-DIN-TAB-72X28-FRAME",
      "SA-WFT-DIN-TAB-72X28-DKT",
      "RM-DKT-GENERIC-SLAB",
    ]);
    const edges = resolveUniversalLevel1("FIN-WFT-DIN-TAB-72X28", live);
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:SA-WFT-DIN-TAB-72X28-FRAME",
      "DKT:SA-WFT-DIN-TAB-72X28-DKT",
    ]);
  });

  it("gives bar and side tables a stone top alongside the frame", () => {
    const bar = resolveUniversalLevel1(
      "FIN-BRK-BAR-TAB-120X28",
      new Set([
        "FIN-BRK-BAR-TAB-120X28",
        "ASM-BRK-BAR-TAB-120X28-FRAME",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(bar.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:ASM-BRK-BAR-TAB-120X28-FRAME",
      "DKT:RM-DKT-GENERIC-SLAB",
    ]);

    const side = resolveUniversalLevel1(
      "FIN-WFT-SID-TAB-13X40",
      new Set([
        "FIN-WFT-SID-TAB-13X40",
        "ASM-WFT-SID-TAB-13X40-FRAME",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(side.map((e) => e.role)).toEqual(["FRAME", "DKT"]);
  });

  it("gives a bare -TAB- table its stone top", () => {
    const edges = resolveUniversalLevel1(
      "FIN-DAI-TAB-72X42-BE",
      new Set([
        "FIN-DAI-TAB-72X42-BE",
        "ASM-DAI-TAB-72X42-FRAME",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:ASM-DAI-TAB-72X42-FRAME",
      "DKT:RM-DKT-GENERIC-SLAB",
    ]);
  });

  it("keeps a dining chair on frame + cushion with no stone top", () => {
    const edges = resolveUniversalLevel1(
      "FIN-TAY-DIN-CHA-19X23",
      new Set([
        "FIN-TAY-DIN-CHA-19X23",
        "ASM-TAY-DIN-CHA-19X23-FRAME",
        "ASM-TAY-DIN-CHA-19X23-CUSH",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(edges.map((e) => `${e.role}:${e.ingredientSku}`)).toEqual([
      "FRAME:ASM-TAY-DIN-CHA-19X23-FRAME",
      "CUSH:ASM-TAY-DIN-CHA-19X23-CUSH",
    ]);
  });

  it("does not purge a dining bench's live cushion", () => {
    const live = new Set([
      "FIN-WFT-DIN-BCH-96X22",
      "ASM-WFT-DIN-BCH-96X22-FRAME",
      "ASM-WFT-DIN-BCH-96X22-CUSH",
    ]);
    const edges = resolveUniversalLevel1("FIN-WFT-DIN-BCH-96X22", live);
    const plan = planUniversalLevel1Import(
      edges,
      new Map([["FIN-WFT-DIN-BCH-96X22", new Set(["ASM-WFT-DIN-BCH-96X22-CUSH"])]]),
    );
    expect(plan.purgeRows).toEqual([]);
    expect(plan.addRows.map((r) => r.ingredientSku)).toEqual([
      "ASM-WFT-DIN-BCH-96X22-FRAME",
    ]);
  });

  it("does not put a stone top on barstools or bar benches", () => {
    const stool = resolveUniversalLevel1(
      "FIN-TAY-BST-24X23",
      new Set([
        "FIN-TAY-BST-24X23",
        "ASM-TAY-BST-24X23-FRAME",
        "ASM-TAY-BST-24X23-CUSH",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(stool.map((e) => e.role)).toEqual(["FRAME", "CUSH"]);

    const bench = resolveUniversalLevel1(
      "FIN-TAY-BEN-BAR",
      new Set([
        "FIN-TAY-BEN-BAR",
        "ASM-TAY-BEN-BAR-FRAME",
        "ASM-TAY-BEN-BAR-CUSH",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(bench.some((e) => e.role === "DKT")).toBe(false);
  });

  it("keeps the hybrid Dekton ottoman on frame + cushion + slab", () => {
    const edges = resolveUniversalLevel1(
      "FIN-BRV-OTT-DKT-30X22-BE",
      new Set([
        "FIN-BRV-OTT-DKT-30X22-BE",
        "SA-BRA-ODT-30X22-FRAME",
        "SA-BRA-ODT-30X22-CUSH",
        "RM-DKT-GENERIC-SLAB",
      ]),
    );
    expect(edges.map((e) => e.role)).toEqual(["FRAME", "CUSH", "DKT"]);
  });

  it("matches a dimless Ocean swivel to the live 34X34 frame", () => {
    const live = new Set([
      "FIN-OCN-SWV-CHA",
      "SA-OCN-SWV-CHA-34X34-FRAME",
      "SA-OCN-SWV-CHA-34X34-CUSH",
    ]);
    const edges = resolveUniversalLevel1("FIN-OCN-SWV-CHA", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "SA-OCN-SWV-CHA-34X34-FRAME",
      "SA-OCN-SWV-CHA-34X34-CUSH",
    ]);
  });

  it("resolves a dimless mini-loveseat colorway to the unique live WxD", () => {
    const live = new Set([
      "FIN-OCN-MIN-LOV-BL-Y",
      "SA-OCN-MIN-LOV-60X48-FRAME",
      "SA-OCN-MIN-LOV-60X48-CUSH",
    ]);
    const edges = resolveUniversalLevel1("FIN-OCN-MIN-LOV-BL-Y", live);
    expect(edges.map((e) => e.ingredientSku)).toEqual([
      "SA-OCN-MIN-LOV-60X48-FRAME",
      "SA-OCN-MIN-LOV-60X48-CUSH",
    ]);
  });

  it("never emits a lone Dekton slab or cushion when no frame is live", () => {
    expect(
      resolveUniversalLevel1(
        "FIN-WFT-DIN-TAB-72X28",
        new Set(["FIN-WFT-DIN-TAB-72X28", "RM-DKT-GENERIC-SLAB"]),
      ),
    ).toEqual([]);
    expect(
      resolveUniversalLevel1(
        "FIN-BRV-CLB-CHA-BE",
        new Set(["FIN-BRV-CLB-CHA-BE", "SA-BRV-CLB-CHA-34X34-CUSH"]),
      ),
    ).toEqual([]);
  });

  it("does not emit rows for umbrellas or missing live children", () => {
    expect(
      resolveUniversalLevel1(
        "FIN-MAR-3M-UMB-NO-BAS",
        new Set(["FIN-MAR-3M-UMB-NO-BAS", "SA-MAR-3M-UMB-NO-BAS-FRAME"]),
      ),
    ).toEqual([]);
    expect(
      resolveUniversalLevel1("FIN-BRV-SOF-72X34-BE", new Set(["FIN-BRV-SOF-72X34-BE"])),
    ).toEqual([]);
  });
});

describe("planUniversalLevel1Import", () => {
  const edges = [
    {
      productSku: "FIN-A",
      ingredientSku: "SA-A-FRAME",
      quantity: 1,
      role: "FRAME" as const,
      live: true,
    },
    {
      productSku: "FIN-A",
      ingredientSku: "SA-A-CUSH",
      quantity: 1,
      role: "CUSH" as const,
      live: true,
    },
  ];

  it("emits add rows when the live parent has no recipe", () => {
    const plan = planUniversalLevel1Import(edges, new Map());
    expect(plan.addRows.map((r) => r.ingredientSku)).toEqual([
      "SA-A-FRAME",
      "SA-A-CUSH",
    ]);
    expect(plan.purgeRows).toEqual([]);
    expect(plan.stats.parentsClean).toBe(1);
  });

  it("drops ingredients the parent already has so Katana cannot duplicate them", () => {
    const plan = planUniversalLevel1Import(
      edges,
      new Map([["FIN-A", new Set(["SA-A-FRAME", "SA-A-CUSH"])]]),
    );
    expect(plan.addRows).toEqual([]);
    expect(plan.purgeRows).toEqual([]);
    expect(plan.stats.parentsAlreadyLinked).toBe(1);
    expect(plan.audit.every((r) => r.verdict === "already_live")).toBe(true);
  });

  it("purges a legacy flat RM tree and flags the adds as blocked until purge", () => {
    const plan = planUniversalLevel1Import(
      edges,
      new Map([["FIN-A", new Set(["RM-RAW-FOAM", "RM-MET-FLATBAR"])]]),
    );
    expect(plan.purgeRows).toEqual([
      { parentSku: "FIN-A", ingredientSku: "RM-MET-FLATBAR", quantity: 0 },
      { parentSku: "FIN-A", ingredientSku: "RM-RAW-FOAM", quantity: 0 },
    ]);
    expect(plan.addRows.map((r) => r.verdict)).toEqual([
      "blocked_until_purge",
      "blocked_until_purge",
    ]);
    expect(plan.stats.parentsNeedingPurge).toBe(1);
  });

  it("keeps a half-linked parent's missing half and purges only the stale row", () => {
    const plan = planUniversalLevel1Import(
      edges,
      new Map([["FIN-A", new Set(["SA-A-FRAME", "ASM-OLD-DIMLESS-CUSH"])]]),
    );
    expect(plan.purgeRows).toEqual([
      { parentSku: "FIN-A", ingredientSku: "ASM-OLD-DIMLESS-CUSH", quantity: 0 },
    ]);
    expect(plan.addRows.map((r) => r.ingredientSku)).toEqual(["SA-A-CUSH"]);
  });
});

describe("uniqueFrameSkus + Level 2", () => {
  it("injects club-chair parametric metal on the new monolithic frame", () => {
    const level1 = resolveMonolithicLevel1(
      "FIN-BRV-CLB-CHA-34X34",
      new Set(["SA-BRV-CLB-CHA-34X34-FRAME", "SA-BRV-CLB-CHA-34X34-CUSH"]),
    );
    const frames = uniqueFrameSkus(level1);
    expect(frames).toEqual(["SA-BRV-CLB-CHA-34X34-FRAME"]);
    const plan = buildLevel2Plan(frames[0]!, new Set());
    expect(plan.parsed.widthIn).toBe(34);
    expect(plan.parsed.depthIn).toBe(34);
    expect(plan.parsed.armCount).toBe(2);
    expect(plan.lines.find((l) => l.role === "2x2")?.quantity).toBe(32.22);
  });
});

describe("planLevel1ConflictPurge", () => {
  const wantedEdges: MonolithicLevel1Edge[] = [
    {
      productSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
      ingredientSku: "ASM-OCN-CLB-CHA-34X38-FRAME",
      quantity: 1,
      role: "FRAME",
      live: true,
    },
    {
      productSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
      ingredientSku: "ASM-OCN-CLB-CHA-34X38-CUSH",
      quantity: 1,
      role: "CUSH",
      live: true,
    },
  ];

  const liveRows = [
    {
      rowId: "row-1",
      parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
      ingredientSku: "RM-MET-FLATBAR",
    },
    {
      rowId: "row-2",
      parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
      ingredientSku: "RM-RAW-FOAM",
    },
  ];

  it("resolves qty-0 purge rows onto live bom row ids", () => {
    const plan = planLevel1ConflictPurge({
      purgeRows: [
        { parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N", ingredientSku: "RM-MET-FLATBAR", quantity: 0 },
        { parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N", ingredientSku: "RM-RAW-FOAM", quantity: 0 },
      ],
      liveRows,
      wantedEdges,
    });
    expect(plan.targets.map((t) => t.rowId)).toEqual(["row-1", "row-2"]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.refused).toEqual([]);
  });

  it("refuses to delete a row the new tree still wants", () => {
    const plan = planLevel1ConflictPurge({
      purgeRows: [
        {
          parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
          ingredientSku: "ASM-OCN-CLB-CHA-34X38-FRAME",
          quantity: 0,
        },
      ],
      liveRows: [
        {
          rowId: "row-keep",
          parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N",
          ingredientSku: "ASM-OCN-CLB-CHA-34X38-FRAME",
        },
      ],
      wantedEdges,
    });
    expect(plan.targets).toEqual([]);
    expect(plan.refused.map((r) => r.rowId)).toEqual(["row-keep"]);
  });

  it("reports purge rows that have no live row to delete", () => {
    const plan = planLevel1ConflictPurge({
      purgeRows: [
        { parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N", ingredientSku: "RM-GONE", quantity: 0 },
      ],
      liveRows,
      wantedEdges,
    });
    expect(plan.targets).toEqual([]);
    expect(plan.unresolved.map((r) => r.ingredientSku)).toEqual(["RM-GONE"]);
  });

  it("never deletes the same row id twice", () => {
    const plan = planLevel1ConflictPurge({
      purgeRows: [
        { parentSku: "FIN-OCN-CLB-CHA-34X38-BE-N", ingredientSku: "RM-MET-FLATBAR", quantity: 0 },
        { parentSku: "fin-ocn-clb-cha-34x38-be-n", ingredientSku: "rm-met-flatbar", quantity: 0 },
      ],
      liveRows,
      wantedEdges,
    });
    expect(plan.targets.map((t) => t.rowId)).toEqual(["row-1"]);
  });
});
