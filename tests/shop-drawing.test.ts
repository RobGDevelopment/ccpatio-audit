import { describe, it, expect } from "vitest";
import { renderShopDrawingPdf, type ShopDrawingInput } from "../src/server/factory-bom/shop-drawing";
import { type AirlockCutLine } from "../src/server/factory-bom/airlock.schema";

describe("Shop Drawing PDF Renderer", () => {
  const getTestInput = (): ShopDrawingInput => ({
    rootSku: "TEST-CHAIR-01",
    originalName: "Test Chair Assembly",
    cadExt: "glb",
    cadSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    cutList: [
      {
        role: "FRM",
        profile: "SQ2x1-16",
        lengthIn: 50.25,
        endA: 90,
        endB: 90,
        qtyEa: 2,
        lengthConvention: "long_point",
        sourceName: "FRM-ALUM-SQ2X1-50",
        confidence: "stated",
      } as AirlockCutLine,
      {
        role: "LEG",
        profile: "SQ2-16",
        lengthIn: 18.5,
        endA: 45,
        endB: 45,
        qtyEa: 4,
        lengthConvention: "long_point",
        sourceName: "LEG-ALUM-SQ2-18",
        confidence: "inferred",
      } as AirlockCutLine,
    ],
    geometrySnapshot: {
      components: [
        { name: "FRM-ALUM-SQ2X1-50", lengthIn: 50.25 },
        { name: "LEG-ALUM-SQ2-18", lengthIn: 18.5 },
      ],
    },
  });

  it("yields identical bytes for identical inputs (deterministic generation)", () => {
    const input1 = getTestInput();
    const input2 = getTestInput();

    const pdf1 = renderShopDrawingPdf(input1);
    const pdf2 = renderShopDrawingPdf(input2);

    expect(pdf1.length).toBeGreaterThan(100);
    expect(pdf1.length).toEqual(pdf2.length);
    
    // Check byte by byte
    for (let i = 0; i < pdf1.length; i++) {
      if (pdf1[i] !== pdf2[i]) {
        throw new Error(`Byte mismatch at index ${i}: ${pdf1[i]} !== ${pdf2[i]}`);
      }
    }
  });

  it("generates correctly when cut list and components are empty", () => {
    const input = getTestInput();
    input.cutList = [];
    input.geometrySnapshot.components = [];

    const pdf1 = renderShopDrawingPdf(input);
    const pdf2 = renderShopDrawingPdf(input);

    expect(pdf1.length).toBeGreaterThan(100);
    expect(pdf1).toEqual(pdf2);
  });
});
