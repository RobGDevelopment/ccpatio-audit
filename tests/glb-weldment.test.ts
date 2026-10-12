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
});
