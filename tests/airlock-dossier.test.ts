import { describe, it, expect } from "vitest";
import { evaluateAirlock } from "../src/server/factory-bom/evaluate-airlock";
import { AirlockDossierSchema } from "../src/server/factory-bom/airlock.schema";

describe("Airlock Dossier Validation", () => {
  const getHappyDossier = (): any => ({
    rootSku: "TEST-FG",
    identity: {
      itemType: "finished_good",
      originalName: "Test",
      katanaVariantId: 1,
      cad: {
        uploadId: "u1",
        ext: "glb",
        status: "draft_ready",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        hygiene: "pass",
      },
      cadWaived: false,
    },
    checklist: {
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      quarantineConfirmed: true,
    },
    nodes: [
      {
        sku: "TEST-FG",
        itemType: "finished_good",
        lines: [
          { parentSku: "TEST-FG", childSku: "TEST-FRAME", itemType: "sub_assembly", quantity: 1, scrapFactor: 1, unitOfMeasure: "ea", status: "draft_pending_review", source: "sketchup_geometry" },
          { parentSku: "TEST-FG", childSku: "TEST-CUSH", itemType: "sub_assembly", quantity: 1, scrapFactor: 1, unitOfMeasure: "ea", status: "draft_pending_review", source: "sketchup_geometry" }
        ],
        operations: [
          { itemSku: "TEST-FG", workCenter: "Quality Control", sequence: 10, runTimeMins: 5 },
          { itemSku: "TEST-FG", workCenter: "Assembly & Packaging", sequence: 20, runTimeMins: 5 },
        ]
      },
      {
        sku: "TEST-FRAME",
        itemType: "sub_assembly",
        lines: [
          { 
            parentSku: "TEST-FRAME", 
            childSku: "RM-ALUM-SQ2X1", 
            itemType: "raw_material", 
            quantity: 100, 
            scrapFactor: 1.1, 
            unitOfMeasure: "in", 
            status: "draft_pending_review", 
            source: "sketchup_geometry",
            isMetal: true,
            cutList: [
              {
                role: "FRM",
                profile: "SQ2x1-16",
                lengthIn: 50,
                endA: 90,
                endB: 90,
                qtyEa: 2,
                lengthConvention: "long_point",
                sourceName: "FRM-ALUM-SQ2X1-50",
                confidence: "stated",
                drawingPartNumber: "P-01"
              }
            ]
          }
        ],
        operations: [
          { itemSku: "TEST-FRAME", workCenter: "Metal Cutting", sequence: 10, runTimeMins: 5 },
          { itemSku: "TEST-FRAME", workCenter: "FAB POD A", sequence: 20, runTimeMins: 5 },
          { itemSku: "TEST-FRAME", workCenter: "Sandblasting", sequence: 30, runTimeMins: 5 },
          { itemSku: "TEST-FRAME", workCenter: "Powder Coating Booth", sequence: 40, runTimeMins: 5 },
          { itemSku: "TEST-FRAME", workCenter: "Curing Oven", sequence: 50, runTimeMins: 5 },
        ]
      },
      {
        sku: "TEST-CUSH",
        itemType: "sub_assembly",
        lines: [
          { parentSku: "TEST-CUSH", childSku: "RM-FABRIC-OUTDOOR", itemType: "raw_material", quantity: 2, scrapFactor: 1, unitOfMeasure: "yd", status: "draft_pending_review", source: "sketchup_geometry" }
        ],
        operations: [
          { itemSku: "TEST-CUSH", workCenter: "Fabric Cutting", sequence: 10, runTimeMins: 5 },
          { itemSku: "TEST-CUSH", workCenter: "Fabric Sewing", sequence: 20, runTimeMins: 5 },
          { itemSku: "TEST-CUSH", workCenter: "Cushion Stuffing", sequence: 30, runTimeMins: 5 },
          { itemSku: "TEST-CUSH", workCenter: "Quality Control", sequence: 40, runTimeMins: 5 },
        ]
      }
    ]
  });

  it("happy path for frame+cushion+fin passes", () => {
    const d = getHappyDossier();
    expect(evaluateAirlock(d)).toEqual([]);
    expect(AirlockDossierSchema.safeParse(d).success).toBe(true);
  });

  it("empty cut list on metal throws CUT_UNEXPECTED", () => {
    const d = getHappyDossier();
    d.nodes[1].lines[0].cutList = [];
    expect(evaluateAirlock(d)).toContain("CUT_UNEXPECTED");
  });

  it("UNKNOWN profile throws CUT_PROFILE", () => {
    const d = getHappyDossier();
    d.nodes[1].lines[0].cutList[0].profile = "UNKNOWN";
    expect(evaluateAirlock(d)).toContain("CUT_PROFILE");
  });

  it("256-character note overflow throws NOTE_TOO_LONG", () => {
    const d = getHappyDossier();
    d.nodes[1].lines[0].notes = "a".repeat(256);
    expect(evaluateAirlock(d)).toContain("NOTE_TOO_LONG");
  });

  it("missing cushion tracks throws TRACK_CUSH", () => {
    const d = getHappyDossier();
    d.nodes[2].operations.splice(0, 1); // remove Fabric Cutting
    expect(evaluateAirlock(d)).toContain("TRACK_CUSH");
  });

  it("cyclical BOMs throws CYCLE", () => {
    const d = getHappyDossier();
    d.nodes[1].lines.push({ 
      parentSku: "TEST-FRAME", 
      childSku: "TEST-FG", 
      itemType: "sub_assembly", 
      quantity: 1, 
      scrapFactor: 1, 
      unitOfMeasure: "ea", 
      status: "draft_pending_review", 
      source: "sketchup_geometry" 
    });
    expect(evaluateAirlock(d)).toContain("CYCLE");
  });

  it("hygiene-fail manual dossier passes without GEOM_MIXED", () => {
    const d = getHappyDossier();
    d.identity.cad.hygiene = "fail";
    d.identity.cad.status = "failed";
    // Must remove sketchup_geometry sources
    for (const n of d.nodes) {
      for (const l of n.lines) l.source = "manager";
    }
    expect(evaluateAirlock(d)).toEqual([]);
  });

  it("GEOM_MIXED when hygiene-fail mixes with sketchup_geometry", () => {
    const d = getHappyDossier();
    d.identity.cad.hygiene = "fail";
    d.identity.cad.status = "failed";
    d.nodes[0].lines[0].source = "manager";
    // leaving nodes[1] as sketchup_geometry
    expect(evaluateAirlock(d)).toContain("GEOM_MIXED");
  });

  it("inferred_override passes CUT_CONFIDENCE, invalid string fails", () => {
    const d = getHappyDossier();
    d.nodes[1].lines[0].cutList[0].confidence = "inferred_override";
    expect(evaluateAirlock(d)).toEqual([]);

    d.nodes[1].lines[0].cutList[0].confidence = "invalid_string";
    expect(evaluateAirlock(d)).toContain("CUT_CONFIDENCE");
  });
  
  it("duplicate edge throws DUP_EDGE", () => {
    const d = getHappyDossier();
    d.nodes[0].lines.push({ ...d.nodes[0].lines[0] });
    expect(evaluateAirlock(d)).toContain("DUP_EDGE");
  });
  
  it("legacy resource string fails OP_RESOURCE", () => {
    const d = getHappyDossier();
    d.nodes[0].operations[0].workCenter = "Final Assembly Legacy Alias"; // Assuming it doesn't match the strict isKatanaResource check exactly
    expect(evaluateAirlock(d)).toContain("OP_RESOURCE");
  });
});
