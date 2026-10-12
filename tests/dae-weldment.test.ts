import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/cad-upload/instantiate-from-dae";
import {
  BRAVADA_CLUB_CHAIR_FIN,
  BRAVADA_SHARED_ARM_SKU,
  WATERFALL_DINING_TABLE_FIN,
  classifyExtrusion,
  parseDaeWeldmentFromXml,
  type WalkerExport,
  type WalkerStick,
} from "@/lib/sketchup-cutlist";

function walker(productHint: string, sticks: WalkerStick[] = []): WalkerExport {
  return {
    sourceFile: "other.dae",
    exportedAt: "2026-01-01T00:00:00.000Z",
    productHint,
    overall: { lengthIn: 30, depthIn: 28, heightIn: 29 },
    assemblies: [],
    sticks,
    flags: [],
    auditBucket: "exploded_soup",
  };
}

const tube: WalkerStick = {
  definitionName: "LEG 2X2 30",
  parentAsmName: null,
  instanceCount: 2,
  nameLengthIn: 30,
  obbLengthIn: 30,
  endA: 90,
  endB: 90,
  profile: "SQ2-16",
  profileWidthIn: 2,
  materialName: null,
  confidence: "low",
};

describe("classifyExtrusion (Option B DAE AABB)", () => {
  it("classifies a 2x2x72 box as 2x2 tube", () => {
    const c = classifyExtrusion([2, 2, 72]);
    expect(c?.profile).toBe("2x2");
    expect(c?.length).toBe(72);
    expect(c?.profileCode).toBeTruthy();
  });

  it("classifies 1x2x22 as 2x1 tube", () => {
    const c = classifyExtrusion([1, 22, 2]);
    expect(c?.profile).toBe("2x1");
    expect(c?.length).toBe(22);
  });

  it("rejects short stubby boxes", () => {
    expect(classifyExtrusion([2, 2, 4])).toBeNull();
  });
});

describe("parseDaeWeldmentFromXml CAD scaling", () => {
  it("scales global bounding box by the meter attribute", () => {
    // 0.0254 meters is 1 inch. So if meter="0.0254", the multiplier is 0.0254 * 39.3701 = 1.
    // If meter="1", multiplier is 39.3701
    const xml = `
      <COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
        <asset>
          <unit name="inch" meter="0.0254"/>
        </asset>
        <library_geometries>
          <geometry id="box">
            <mesh>
              <source id="box-positions">
                <float_array id="box-positions-array" count="24">
                  0 0 0
                  10 0 0
                  10 20 0
                  0 20 0
                  0 0 30
                  10 0 30
                  10 20 30
                  0 20 30
                </float_array>
              </source>
            </mesh>
          </geometry>
        </library_geometries>
        <library_visual_scenes>
          <visual_scene id="scene">
            <node id="node1" name="node1">
              <instance_geometry url="#box"/>
            </node>
          </visual_scene>
        </library_visual_scenes>
      </COLLADA>
    `;
    const result = parseDaeWeldmentFromXml(xml, "test.dae");
    // Bounding box size: length (x) = 10, width (y) = 20, height (z) = 30
    // Multiplier for 0.0254 meter is roughly 1.0
    // So globalAabb should be [10, 20, 30] inches.
    expect(result.walker.overall.lengthIn).toBeCloseTo(10, 0);
    expect(result.walker.overall.depthIn).toBeCloseTo(20, 0);
    expect(result.walker.overall.heightIn).toBeCloseTo(30, 0);

    const xmlMeters = xml.replace('meter="0.0254"', 'meter="1"');
    const resultMeters = parseDaeWeldmentFromXml(xmlMeters, "test_meters.dae");
    // Multiplier is 39.3701
    expect(resultMeters.walker.overall.lengthIn).toBeCloseTo(10 * 39.3701, 0);
    expect(resultMeters.walker.overall.depthIn).toBeCloseTo(20 * 39.3701, 0);
    expect(resultMeters.walker.overall.heightIn).toBeCloseTo(30 * 39.3701, 0);
  });
});

describe("buildPlan family gate", () => {
  it("keeps the Waterfall plan when the hint names that family", () => {
    const plan = buildPlan(walker("WATERFALL DINING TABLE 72x28", [tube]));
    expect(plan.finSku).toBe(WATERFALL_DINING_TABLE_FIN);
    expect(plan.lines.some((line) => /Waterfall/i.test(line.notes))).toBe(true);
    expect(plan.lines.some((line) => line.childSku === BRAVADA_SHARED_ARM_SKU)).toBe(false);
  });

  it("does not borrow the Bravada club chair for an unknown hint", () => {
    const plan = buildPlan(walker("FIN-OTHER-CHA-01", [tube]), "FIN-OTHER-CHA-01");
    const serialized = JSON.stringify(plan);
    expect(plan.finSku).toBe("FIN-OTHER-CHA-01");
    expect(plan.finSku).not.toBe(BRAVADA_CLUB_CHAIR_FIN);
    expect(serialized).not.toContain(BRAVADA_SHARED_ARM_SKU);
    expect(serialized).not.toContain(BRAVADA_CLUB_CHAIR_FIN);
    expect(plan.armSku).toBeNull();
    const metal = plan.lines.find((line) => line.childSku === "RM-MET-2X2-TUBING");
    expect(metal?.quantity).toBeCloseTo(5, 4);
    expect(metal?.parentSku).toBe("FIN-OTHER-CHA-01");
  });
});
