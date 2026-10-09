import { describe, it, expect } from "vitest";
import { formatGeomHygieneMessage } from "../src/lib/sketchup-cutlist/component-hygiene";
import { 
  calculatePowder, 
  calculateWeight, 
  calculateJoinery, 
  calculateArgon, 
  calculateSand, 
  calculateFreight, 
  calculateCushionPackage 
} from "../src/lib/sketchup-cutlist/derived-heuristics";

describe("geom hygiene message", () => {
  it("does not tell the designer to rename a File node", () => {
    const msg = formatGeomHygieneMessage([{ name: "File", reason: "Zero structural nodes" }]);
    expect(msg).not.toContain("File");
    expect(msg).toContain("ROLE-MATERIAL-PROFILE");
  });

  it("groups failing nodes by reason", () => {
    const msg = formatGeomHygieneMessage([
      { name: "Leg A", reason: "Invalid role: LEGG" },
      { name: "Leg B", reason: "Invalid role: LEGG" },
      { name: "Rail", reason: "Invalid profile: 3X3" },
    ]);
    expect(msg).toContain("Please group these meshes");
    expect(msg.indexOf("Leg A")).toBeLessThan(msg.indexOf("Rail"));
    expect(msg.indexOf("Leg B")).toBeLessThan(msg.indexOf("Rail"));
  });
});

describe("derived heuristics", () => {
  it("surface area to powder pounds", () => {
    const res = calculatePowder([{ profile: "SQ2-16", lengthIn: 10, qtyEa: 2 }]);
    expect(res.surfaceFt2).toBe(1.1111);
    expect(res.pounds).toBe(0.2778);
  });

  it("volume * 0.098 aluminum weight", () => {
    const res = calculateWeight([
      { material: "ALUM", profile: "SQ2-16", lengthIn: 10, name: "FRM-ALUM-2X2" }
    ]);
    expect(res.aluminumLbs).toBe(0.4563);
    expect(res.excludedNames).toEqual([]);
  });

  it("one real intersection counts as one joint", () => {
    const a = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [0, 0, 0] as [number, number, number], max: [10, 2, 2] as [number, number, number] }
    };
    const b = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [8, 0, 0] as [number, number, number], max: [10, 10, 2] as [number, number, number] }
    };

    const res = calculateJoinery([a, b]);
    expect(res.jointCount).toBe(1);
    expect(res.weldWireLb).toBe(0.0024);
  });

  it("parallel overlapping boxes count as zero joints", () => {
    const a = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [0, 0, 0] as [number, number, number], max: [5, 2, 2] as [number, number, number] }
    };
    const b = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [4.9, 0, 0] as [number, number, number], max: [10, 2, 2] as [number, number, number] }
    };

    const res = calculateJoinery([a, b]);
    expect(res.jointCount).toBe(0);
  });

  it("leg with joints top and bottom gets 0 caps, with joint on top gets 1 cap", () => {
    const leg = {
      role: "LEG",
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [0, 0, 0] as [number, number, number], max: [2, 2, 10] as [number, number, number] },
      endA: "90",
      endB: "90"
    };
    const topRail = {
      role: "RAIL",
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [0, 0, 8] as [number, number, number], max: [10, 2, 10] as [number, number, number] },
      endA: "90",
      endB: "90"
    };
    
    const res = calculateJoinery([leg, topRail]);
    expect(res.jointCount).toBe(1);
    expect(res.capEa).toBe(1);
    expect(res.fastenerEa).toBe(2);
    expect(res.caps).toEqual([{ sku: "RM-PLASTIC-CAP-2X2", ea: 1 }]);
  });

  it("FB0.125x1.5 dead ends add no cap", () => {
    const leg = {
      role: "LEG",
      material: "ALUM",
      profile: "FB0.125x1.5" as const,
      aabb: { min: [0, 0, 0] as [number, number, number], max: [1.5, 0.125, 10] as [number, number, number] },
      endA: "90",
      endB: "90"
    };
    const topRail = {
      role: "RAIL",
      material: "ALUM",
      profile: "FB0.125x1.5" as const,
      aabb: { min: [0, 0, 8] as [number, number, number], max: [10, 1.5, 10] as [number, number, number] },
      endA: "90",
      endB: "90"
    };
    const res = calculateJoinery([leg, topRail]);
    expect(res.jointCount).toBe(1);
    expect(res.capEa).toBe(1); // Sum is 1
    expect(res.caps).toEqual([]); // No cap in map for FB
  });

  it("Zero joints yield argon 0", () => {
    const res = calculateArgon(0);
    expect(res.jointCount).toBe(0);
    expect(res.cubicFeet).toBe(0);
  });

  it("Positive joints yield argon CF", () => {
    const res = calculateArgon(2);
    expect(res.jointCount).toBe(2);
    expect(res.cubicFeet).toBe(0.3);
  });

  it("A metal profile missing from OUTSIDE_PERIMETERS is a sand exclusion", () => {
    // We pass a fake profile cast as any
    const res = calculateSand([
      { profile: "SQ2-16", lengthIn: 10, material: "ALUM", name: "good" },
      { profile: "FAKE" as any, lengthIn: 10, material: "ALUM", name: "bad1" }
    ]);
    expect(res.excludedNames).toEqual(["bad1"]);
    expect(res.pounds).toBe(0.0833);
  });

  it("A degenerate union returns degenerate_aabb", () => {
    const res = calculateFreight(null, 10);
    expect(res.reason).toBe("degenerate_aabb");
    expect(res.grossFreightLbs).toBe(10);
  });

  it("footL > 192 returns oversize_no_single_skid", () => {
    const res = calculateFreight({ min: [0, 0, 0], max: [200, 20, 20] }, 50);
    expect(res.reason).toBe("oversize_no_single_skid");
    expect(res.skidBoardFt).toBe(0);
    expect(res.grossFreightLbs).toBe(50);
  });

  it("Gross freight equals volume aluminum plus skid lumber", () => {
    const res = calculateFreight({ min: [0, 0, 0], max: [10, 10, 10] }, 10);
    expect(res.reason).toBeUndefined();
    expect(res.grossFreightLbs).toBe(21.1111);
  });

  it("standard emits one corrugate each and labor 0 / 4.0", () => {
    const res = calculateCushionPackage("standard", { min: [0, 0, 0], max: [20, 20, 4] });
    expect(res.lines[0].sku).toBe("RM-PKG-CORRUGATE-OS");
    expect(res.lines[0].qty).toBe(1);
    expect(res.labor.setup).toBe(0);
    expect(res.labor.run).toBe(4.0);
  });

  it("vacuum_compressed emits dunnage board-feet and shrink square feet, labor 2 / 6, and a compressed height of at least 2 in", () => {
    const res = calculateCushionPackage("vacuum_compressed", { min: [0, 0, 0], max: [20, 20, 4] });
    expect(res.lines[0].sku).toBe("RM-PKG-DUNNAGE-15");
    expect(res.lines[1].sku).toBe("RM-PKG-SHRINK");
    expect(res.labor.setup).toBe(2);
    expect(res.labor.run).toBe(6);
    expect(res.compressed.h).toBe(2); // 4 * 0.35 = 1.4 -> max(2, 1.4) = 2
  });
});
