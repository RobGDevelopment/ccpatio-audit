import { describe, expect, it } from "vitest";
import { readGlbSummary, sha256Hex } from "@/lib/intake/glb-summary";

/** Helper to build a minimal in-memory GLB buffer */
function buildMockGlb(jsonContent: object): ArrayBuffer {
  const jsonStr = JSON.stringify(jsonContent);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  // 4-byte align JSON chunk
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLength = jsonBytes.length + jsonPadding;

  const totalLength = 12 + 8 + jsonChunkLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  // Header: magic (0x46546C67 "glTF"), version (2), totalLength
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  // Chunk 0: length, type (0x4E4F534A "JSON")
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);

  const uint8 = new Uint8Array(buffer);
  uint8.set(jsonBytes, 20);
  for (let i = 0; i < jsonPadding; i += 1) {
    uint8[20 + jsonBytes.length + i] = 0x20; // space padding
  }

  return buffer;
}

describe("GLB Summary Reader (readGlbSummary & sha256Hex)", () => {
  it("rejects non-GLB files (invalid magic bytes)", async () => {
    const invalidBuffer = new ArrayBuffer(20);
    const file = new File([invalidBuffer], "test.glb");

    const summary = await readGlbSummary(file);
    expect(summary.valid).toBe(false);
    expect(summary.reason).toBe("INVALID_MAGIC");
  });

  it("identifies a valid GLB with meshes, nodes, and materials", async () => {
    const glbData = buildMockGlb({
      asset: { version: "2.0" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      materials: [{ name: "Metal" }],
      accessors: [
        {
          min: [-1.0, 0.0, -0.5],
          max: [1.0, 0.8, 0.5],
        },
      ],
    });

    const file = new File([glbData], "valid.glb");
    const summary = await readGlbSummary(file);

    expect(summary.valid).toBe(true);
    expect(summary.meshCount).toBe(1);
    expect(summary.nodeCount).toBe(1);
    expect(summary.materialCount).toBe(1);
    expect(summary.boundsMeters).toBeDefined();
    // In meters: x = 2.0m, y = 0.8m, z = 1.0m
    expect(summary.boundsMeters?.[0]).toBeCloseTo(2.0, 1);
    expect(summary.boundsInches?.[0]).toBeCloseTo(2.0 / 0.0254, 0);
  });

  it("flags NO_GEOMETRY if meshCount is 0", async () => {
    const glbData = buildMockGlb({
      asset: { version: "2.0" },
      meshes: [],
      nodes: [],
    });

    const file = new File([glbData], "empty.glb");
    const summary = await readGlbSummary(file);

    expect(summary.valid).toBe(false);
    expect(summary.reason).toBe("NO_GEOMETRY");
  });

  it("flags unitsLookOdd when extent is outside realistic furniture dimensions (<0.05m or >20m)", async () => {
    // Model in millimeters instead of meters: 2000mm -> extent 4000
    const glbData = buildMockGlb({
      asset: { version: "2.0" },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      accessors: [
        {
          min: [-2000, 0, 0],
          max: [2000, 1000, 1000],
        },
      ],
    });

    const file = new File([glbData], "giant.glb");
    const summary = await readGlbSummary(file);

    expect(summary.valid).toBe(true);
    expect(summary.unitsLookOdd).toBe(true);
  });

  it("calculates sha256Hex of file", async () => {
    const file = new File([new TextEncoder().encode("hello world")], "test.txt");
    const hash = await sha256Hex(file);
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});
