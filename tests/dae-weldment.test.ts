import { describe, expect, it } from "vitest";
import { classifyExtrusion } from "../scripts/diagnostics/parse-dae-weldment";

describe("classifyExtrusion (Option B DAE AABB)", () => {
  it("classifies a 2x2x72 box as 2x2 tube", () => {
    const c = classifyExtrusion([2, 2, 72]);
    expect(c?.profile).toBe("2x2");
    expect(c?.length).toBe(72);
    expect(c?.isTube).toBe(true);
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
