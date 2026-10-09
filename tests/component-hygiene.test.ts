import { describe, it, expect } from "vitest";
import { evaluateComponentHygiene } from "../src/lib/sketchup-cutlist/component-hygiene";

describe("component hygiene grammar", () => {
  it("passes FRM-ALUM-2X2 as inferred", () => {
    const res = evaluateComponentHygiene("FRM-ALUM-2X2", 34);
    expect(res.isStructural).toBe(true);
    expect(res.isValid).toBe(true);
    expect(res.role).toBe("FRM");
    expect(res.material).toBe("ALUM");
    expect(res.profile).toBe("SQ2-16");
    expect(res.confidence).toBe("inferred");
    expect(res.lengthIn).toBe(34);
    expect(res.statedLengthIn).toBe(null);
  });

  it("stated length within 0.25 in stays stated", () => {
    const res = evaluateComponentHygiene("FRM-ALUM-2X2-34.125", 34);
    expect(res.isStructural).toBe(true);
    expect(res.isValid).toBe(true);
    expect(res.confidence).toBe("stated");
    expect(res.lengthIn).toBe(34.125);
    expect(res.statedLengthIn).toBe(34.125);
  });

  it("stated length 34 against an AABB of 40 passes as inferred_override with cut length 40", () => {
    const res = evaluateComponentHygiene("FRM-ALUM-2X2-34", 40);
    expect(res.isStructural).toBe(true);
    expect(res.isValid).toBe(true);
    expect(res.confidence).toBe("inferred_override");
    expect(res.lengthIn).toBe(40);
    expect(res.statedLengthIn).toBe(34);
  });

  it("decorative node ignored", () => {
    const res = evaluateComponentHygiene("Cushion Support", 20);
    expect(res.isStructural).toBe(false);
    expect(res.isValid).toBe(true);
  });

  it("bad structural name fails", () => {
    const res = evaluateComponentHygiene("FRM-WOOD-2X2", 34);
    expect(res.isStructural).toBe(true);
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("Invalid material");
  });

  it("valid structural name with ends", () => {
    const res = evaluateComponentHygiene("LEG-STL-2X1-20-45-90", 20.1);
    expect(res.isValid).toBe(true);
    expect(res.confidence).toBe("stated");
    expect(res.lengthIn).toBe(20);
    expect(res.endA).toBe("45");
    expect(res.endB).toBe("90");
    expect(res.lengthConvention).toBe("long_point");
  });
});
