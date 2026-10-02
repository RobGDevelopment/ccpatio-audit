import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { snapSection } from "@/lib/obj-cutlist/profile-crosswalk";
import { parseObjWeldment } from "@/lib/obj-cutlist/parse-obj-weldment";
import { reviewObjFile } from "../scripts/ops/extract-website-obj-boms";

const OBJ_DIR = path.join(
  process.cwd(),
  "Blender",
  "Website Products",
  "MTL  files for website products",
);

function boxObj(verts: Array<[number, number, number]>): string {
  const body = verts.map((v) => `v ${v[0]} ${v[1]} ${v[2]}`).join("\n");
  return `# File units = inches
g Mesh1
usemtl _Color_M06_4
${body}
f 1 2 3 4
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;
}

describe("snapSection", () => {
  it("maps 2x2 tube to the stocked purchasing variant", () => {
    const snap = snapSection(2, 2);
    expect(snap.purchasingSku).toBe("MET-TB22060");
    expect(snap.profileCode).toBe("SQ2-16");
    expect(snap.rejectedPlaceholderSku).toBe("RM-MET-2X2-TUBING");
  });

  it("maps 1x1/8 flat bar to the minted purchasing variant", () => {
    const snap = snapSection(1, 0.125);
    expect(snap.purchasingSku).toBe("MET-FH181");
    expect(snap.profileCode).toBe("FB1x0.125");
    expect(snap.rejectedPlaceholderSku).toBe("RM-MET-FLATBAR");
    expect(snapSection(1, 0.13).purchasingSku).toBe("MET-FH181");
  });

  it("maps 1.5x0.75 tube and not the placeholder", () => {
    expect(snapSection(0.75, 1.5).purchasingSku).toBe("MET-TB11234060");
  });
});

describe("parseObjWeldment", () => {
  it("reads a square-cut 2x2x30 box as 30 inch edges, not a diagonal", () => {
    const review = reviewObjFile(
      "fixture.obj",
      boxObj([
        [0, 0, 0],
        [30, 0, 0],
        [30, 2, 0],
        [0, 2, 0],
        [0, 0, 2],
        [30, 0, 2],
        [30, 2, 2],
        [0, 2, 2],
      ]),
    );
    expect(review.sticks).toHaveLength(1);
    expect(review.sticks[0]?.longPointIn).toBe(30);
    expect(review.sticks[0]?.endA).toBe(90);
    expect(review.sticks[0]?.endB).toBe(90);
    expect(review.sticks[0]?.recipeSku).toBe("MET-TB22060");
    expect(review.recipes[0]?.netFt).toBe(2.5);
    expect(review.recipes[0]?.scrapAppliedInThisFile).toBe(false);
    expect(review.recipes[0]?.katanaQuantityFt).toBe(2.7);
  });

  it("keeps section 2x2 after the box is rotated in the world", () => {
    const angle = Math.PI / 5;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners: Array<[number, number, number]> = [
      [0, 0, 0],
      [40, 0, 0],
      [40, 2, 0],
      [0, 2, 0],
      [0, 0, 2],
      [40, 0, 2],
      [40, 2, 2],
      [0, 2, 2],
    ].map(([x, y, z]) => [cos * x - sin * y, sin * x + cos * y, z]);
    const parsed = parseObjWeldment(boxObj(corners));
    expect(parsed.sticks[0]?.sectionMajorIn).toBe(2);
    expect(parsed.sticks[0]?.sectionMinorIn).toBe(2);
    expect(parsed.sticks[0]?.longPointIn).toBe(40);
    expect(parsed.sticks[0]?.endA).toBe(90);
  });

  it("reads a 45/45 trapezoid as long point 29 and short point 25", () => {
    const review = reviewObjFile(
      "mitre.obj",
      boxObj([
        [0, 0, 0],
        [29, 0, 0],
        [27, 2, 0],
        [2, 2, 0],
        [0, 0, 2],
        [29, 0, 2],
        [27, 2, 2],
        [2, 2, 2],
      ]),
    );
    const stick = review.sticks[0];
    expect(stick?.longPointIn).toBe(29);
    expect(stick?.shortPointIn).toBe(25);
    expect(stick?.endA).toBe(45);
    expect(stick?.endB).toBe(45);
    expect(stick?.recipeSku).toBe("MET-TB22060");
    expect(stick?.droppedMiterFacesIn).toContain(2.83);
  });
});

describe("website OBJ pilots", () => {
  it("measures the Bravada club chair 2x2 footage inside 5% of 29.84 ft", () => {
    const text = readFileSync(
      path.join(OBJ_DIR, "1 BRAVADA club chair.obj"),
      "utf8",
    );
    const review = reviewObjFile("1 BRAVADA club chair.obj", text);
    const tube = review.recipes.find((row) => row.recipeSku === "MET-TB22060");
    expect(tube?.pieces).toBe(16);
    expect(tube?.netFt).toBe(29.8333);
    expect(tube?.netFt).toBeGreaterThanOrEqual(29.84 * 0.95);
    expect(tube?.netFt).toBeLessThanOrEqual(29.84 * 1.05);
    const backPost = tube?.cuts.find((cut) => cut.longPointIn === 21);
    expect(backPost?.qtyEa).toBe(2);
    expect(backPost?.shortPointIn).toBe(17);
    expect(backPost?.endA).toBe(45);
    expect(backPost?.endB).toBe(45);
    expect(backPost?.compoundLongEdges).toBe(true);
    expect(tube?.rejectedPlaceholderSku).toBe("RM-MET-2X2-TUBING");
    const slat = review.recipes.find((row) => row.recipeSku === "MET-TB11234060");
    expect(slat?.netFt).toBe(2.5);
    const flat = review.recipes.find((row) => row.recipeSku === "MET-FH181");
    expect(flat?.netFt).toBe(12.5);
    expect(flat?.rejectedPlaceholderSku).toBe("RM-MET-FLATBAR");
    expect(review.sticks.every((stick) => stick.recipeSku?.startsWith("MET-"))).toBe(
      true,
    );
    expect(review.draftEligible).toBe(true);
  });

  it("recovers the Ocean sofa 29 inch 45/45 rail on MET-TB22060", () => {
    const text = readFileSync(path.join(OBJ_DIR, "19 OCEAN sofa 72.obj"), "utf8");
    const review = reviewObjFile("19 OCEAN sofa 72.obj", text);
    const mitre = review.sticks.find(
      (stick) =>
        stick.recipeSku === "MET-TB22060" &&
        stick.endA === 45 &&
        stick.endB === 45 &&
        stick.longPointIn === 29,
    );
    expect(mitre?.shortPointIn).toBe(25);
    expect(mitre?.sectionMajorIn).toBe(2);
    expect(mitre?.sectionMinorIn).toBe(2);
    const falseSection = review.sticks.find(
      (stick) => stick.sectionMajorIn > 5 && stick.sectionMinorIn > 5,
    );
    expect(falseSection).toBeUndefined();
    const flat = review.recipes.find((row) => row.recipeSku === "MET-FH181");
    expect(flat?.netFt).toBe(26.6667);
    expect(review.sticks.every((stick) => stick.recipeSku?.startsWith("MET-"))).toBe(
      true,
    );
  });
});
