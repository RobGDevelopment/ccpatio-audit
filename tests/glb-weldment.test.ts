import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { parseGlbWeldment } from "@/lib/sketchup-cutlist/parse-glb-weldment";
import { formatKatanaIngredientNote } from "@/lib/sketchup-cutlist/notes-codec";

describe("parseGlbWeldment", () => {
  it("extracts a named node and formats the Katana cut card note", async () => {
    const doc = new Document();
    
    const buffer = new Float32Array([
      0, 0, 0,
      0, 0, 72 / 39.37007874,
      2 / 39.37007874, 2 / 39.37007874, 72 / 39.37007874
    ]);
    const position = doc.createAccessor().setType("VEC3").setArray(buffer).setBuffer(doc.createBuffer());
    
    const prim = doc.createPrimitive().setAttribute("POSITION", position);
    const mesh = doc.createMesh().addPrimitive(prim);
    
    const node = doc.createNode().setName("FRM-ALUM-2X2-72-90-90").setMesh(mesh);
    const scene = doc.createScene().addChild(node);
    doc.getRoot().setDefaultScene(scene);
    
    const io = new NodeIO();
    const glb = await io.writeBinary(doc);
    
    const snapshot = await parseGlbWeldment(glb);
    
    expect(snapshot.hygiene).toBe("pass");
    expect(snapshot.components.length).toBe(1);
    
    const comp = snapshot.components[0];
    expect(comp.profile).toBe("SQ2-16");
    expect(comp.lengthIn).toBeCloseTo(72, 1);
    
    const note = formatKatanaIngredientNote([
      {
        role: comp.role,
        profile: comp.profile,
        lengthIn: comp.lengthIn,
        endA: comp.endA === "45" ? 45 : 90,
        endB: comp.endB === "45" ? 45 : 90,
        qtyEa: 1,
        lengthConvention: "square",
        sourceName: comp.name,
        confidence: comp.confidence,
        drawingPartNumber: comp.name
      }
    ]);
    
    expect(note).toContain("1 pcs @ 72.0 in · square");
  });

  it("measures a rotated 2x2 miter from boundary edges, not the miter face", async () => {
    const inchesToMeters = 1 / 39.37007874;
    const s = 2;
    const long = 29;
    const inset = 2;
    const corners = [
      [0, s, 0],
      [long, s, 0],
      [long, s, s],
      [0, s, s],
      [inset, 0, 0],
      [long - inset, 0, 0],
      [long - inset, 0, s],
      [inset, 0, s],
    ].map(([x, y, z]) => [x! * inchesToMeters, y! * inchesToMeters, z! * inchesToMeters]);
    const quads = [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
    ];
    const triangles: number[] = [];
    for (const [a, b, c, d] of quads) {
      triangles.push(a!, b!, c!, a!, c!, d!);
    }

    const doc = new Document();
    const buffer = doc.createBuffer();
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(corners.flat()))
      .setBuffer(buffer);
    const indices = doc
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Uint32Array(triangles))
      .setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", position).setIndices(indices);
    const mesh = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setName("Mesh13").setMesh(mesh);
    doc.getRoot().setDefaultScene(doc.createScene().addChild(node));

    const snapshot = await parseGlbWeldment(await new NodeIO().writeBinary(doc));
    expect(snapshot.hygiene).toBe("pass");
    expect(snapshot.components).toHaveLength(1);
    const comp = snapshot.components[0];
    expect(comp.profile).toBe("SQ2-16");
    expect(comp.lengthIn).toBeCloseTo(29, 1);
    expect(comp.endA).toBe("45");
    expect(comp.endB).toBe("45");
    expect(comp.lengthConvention).toBe("long_point");
    expect(comp.droppedMiterFacesIn.some((edge: number) => Math.abs(edge - 2 * Math.SQRT2) < 0.08)).toBe(true);
    expect(comp.profile).not.toBe("UNMAPPED");
  });
});
