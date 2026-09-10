import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSkpThumbnail } from "@/lib/cad-upload/skp-thumbnail";
import {
  classifyExtrusion,
  parseDaeWeldmentFromXml,
} from "@/lib/sketchup-cutlist";

const SAMPLE_DAE = path.resolve(
  process.cwd(),
  "docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae",
);

/** PNG with a long tEXt chunk so extractSkpThumbnail length gate (>200) passes. */
function craftedSkpWithPng(): Buffer {
  const sigAndIhdr = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
    "hex",
  );
  const textData = Buffer.alloc(240, 0x41);
  const textChunk = Buffer.alloc(12 + textData.length);
  textChunk.writeUInt32BE(textData.length, 0);
  textChunk.write("tEXt", 4);
  textData.copy(textChunk, 8);
  textChunk.writeUInt32BE(0, 8 + textData.length);
  const iend = Buffer.from("0000000049454e44ae426082", "hex");
  return Buffer.concat([
    Buffer.from("SKP-PREFIX"),
    sigAndIhdr,
    textChunk,
    iend,
    Buffer.from("SKP-SUFFIX"),
  ]);
}

describe("CAD upload pipeline foundations", () => {
  it("classifyExtrusion still maps AABB boxes to tube profiles", () => {
    const c = classifyExtrusion([2, 2, 72]);
    expect(c?.profile).toBe("2x2");
    expect(c?.length).toBe(72);
    expect(c?.profileCode).toBeTruthy();
  });

  it("parseDaeWeldmentFromXml accepts Buffer (Storage download path)", () => {
    expect(fs.existsSync(SAMPLE_DAE)).toBe(true);
    const buf = fs.readFileSync(SAMPLE_DAE);
    const result = parseDaeWeldmentFromXml(buf, "FIN-WFT-DIN-TAB-72X28.dae");
    expect(result.walker.sticks.length).toBeGreaterThan(0);
    expect(result.rollup.length).toBeGreaterThan(0);
  });

  it("extractSkpThumbnail finds embedded PNG signature → IEND", () => {
    const extracted = extractSkpThumbnail(craftedSkpWithPng());
    expect(extracted).not.toBeNull();
    expect(extracted![0]).toBe(0x89);
    expect(extracted![1]).toBe(0x50);
    expect(extracted!.length).toBeGreaterThan(200);
  });
});
