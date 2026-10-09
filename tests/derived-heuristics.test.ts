import { describe, it, expect } from "vitest";
import { calculatePowder, calculateWeight, calculateJoinery } from "../src/lib/sketchup-cutlist/derived-heuristics";

describe("derived heuristics", () => {
  it("surface area to powder pounds", () => {
    // profile SQ2-16 -> perimeter 8
    // 2 pieces, length 10 -> total 20 inches
    // area = 8 * 20 / 144 = 1.1111 sqft
    // default coverage 4 sqft/lb -> 1.1111 / 4 = 0.2778 lb
    const res = calculatePowder([{ profile: "SQ2-16", lengthIn: 10, qtyEa: 2 }]);
    expect(res.surfaceFt2).toBe(1.1111);
    expect(res.pounds).toBe(0.2778);
  });

  it("volume * 0.098 aluminum weight", () => {
    // profile SQ2-16 -> area 0.4656
    // 1 piece, length 10 -> volume 4.656
    // weight = 4.656 * 0.098 = 0.4563 lb
    const res = calculateWeight([
      { material: "ALUM", profile: "SQ2-16", lengthIn: 10, name: "FRM-ALUM-2X2" }
    ]);
    expect(res.aluminumLbs).toBe(0.4563);
    expect(res.excludedNames).toEqual([]);
  });

  it("one real intersection counts as one joint", () => {
    // Two boxes intersecting at a corner, different axes
    const a = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [0, 0, 0] as [number, number, number], max: [10, 2, 2] as [number, number, number] } // long axis X
    };
    const b = {
      material: "ALUM",
      profile: "SQ2-16" as const,
      aabb: { min: [8, 0, 0] as [number, number, number], max: [10, 10, 2] as [number, number, number] } // long axis Y
    };

    const res = calculateJoinery([a, b]);
    expect(res.jointCount).toBe(1);
    // weld wire = min(perimA, perimB) * 0.0003 = 8 * 0.0003 = 0.0024
    expect(res.weldWireLb).toBe(0.0024);
  });

  it("parallel overlapping boxes count as zero joints", () => {
    // Two boxes split along X
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
    // leg long axis is Z
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
    
    // Top rail intersects at the Z=10 max endpoint
    const res = calculateJoinery([leg, topRail]);
    expect(res.jointCount).toBe(1);
    expect(res.capEa).toBe(1); // Bottom is un-jointed
    expect(res.fastenerEa).toBe(2); // LEG + RAIL both 90 = 2 fasteners
  });
});
