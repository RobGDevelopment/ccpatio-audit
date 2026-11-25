import { describe, expect, it } from "vitest";
import {
  clampCropBox,
  cropBoxToCssPercent,
  cssPercentToCropBox,
  defaultCenteredCrop,
  titleCaseStorefront,
} from "@/lib/intake-crop-math";

describe("intake crop math (1:1 overlay on non-square photos)", () => {
  it("uses sourceWidth for left/width and sourceHeight for top/height", () => {
    // 3:2 photo 6000×4000, 2000px square at (1000, 500)
    const css = cropBoxToCssPercent({
      cropX: 1000,
      cropY: 500,
      cropSidePx: 2000,
      sourceWidth: 6000,
      sourceHeight: 4000,
    });
    expect(css.left).toBeCloseTo((1000 / 6000) * 100, 10);
    expect(css.top).toBeCloseTo((500 / 4000) * 100, 10);
    expect(css.width).toBeCloseTo((2000 / 6000) * 100, 10);
    expect(css.height).toBeCloseTo((2000 / 4000) * 100, 10);
    // visually square once laid over the 3:2 box: width% * W === height% * H
    expect((css.width / 100) * 6000).toBeCloseTo((css.height / 100) * 4000, 8);
  });

  it("round-trips through cssPercentToCropBox", () => {
    const box = { cropX: 812, cropY: 144, cropSidePx: 1536 };
    const css = cropBoxToCssPercent({ ...box, sourceWidth: 4032, sourceHeight: 3024 });
    expect(
      cssPercentToCropBox({ ...css, sourceWidth: 4032, sourceHeight: 3024 }),
    ).toEqual(box);
  });

  it("returns a zero box for unknown source dimensions", () => {
    expect(
      cropBoxToCssPercent({ cropX: 1, cropY: 1, cropSidePx: 10, sourceWidth: 0, sourceHeight: 0 }),
    ).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it("centers the largest square and clamps into bounds", () => {
    expect(defaultCenteredCrop(6000, 4000)).toEqual({ cropX: 1000, cropY: 0, cropSidePx: 4000 });
    expect(
      clampCropBox({ cropX: 5900, cropY: -20, cropSidePx: 9000 }, 6000, 4000),
    ).toEqual({ cropX: 2000, cropY: 0, cropSidePx: 4000 });
    expect(
      clampCropBox({ cropX: 10, cropY: 10, cropSidePx: 5 }, 6000, 4000).cropSidePx,
    ).toBe(64);
  });
});

describe("titleCaseStorefront", () => {
  it("title-cases words", () => {
    expect(titleCaseStorefront("  canvas   IVORY ")).toBe("Canvas Ivory");
    expect(titleCaseStorefront("")).toBe("");
  });

  it("preserves BH, SH, OD, LED, II, III", () => {
    expect(titleCaseStorefront("bh ii lounge")).toBe("BH II Lounge");
    expect(titleCaseStorefront("sh iii od led")).toBe("SH III OD LED");
    expect(titleCaseStorefront("Led-Lit Sh Table")).toBe("LED-Lit SH Table");
  });
});
