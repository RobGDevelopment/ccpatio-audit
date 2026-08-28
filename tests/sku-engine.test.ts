import { describe, expect, it } from "vitest";
import {
  generateFinishedGoodSku,
  resolveCatCode,
  resolveColCode,
} from "@/lib/sku-engine";

describe("sku-engine category codes", () => {
  it("retains modifier + noun tokens for compound products", () => {
    expect(resolveCatCode("BRAVADA SWIVEL CHAIR 34")).toBe("SWV-CHA");
    expect(resolveCatCode("BRAVADA CLUB CHAIR 34")).toBe("CLB-CHA");
    expect(resolveCatCode("BRAVADA DOUBLE CHAISE LOUNGE 58 X 79")).toBe("DOU-CHS");
    expect(resolveCatCode("DAISY BASE ROUND TABLE (DINING HEIGHT) 56")).toBe(
      "DIN-TAB",
    );
    expect(resolveCatCode("BRAVADA COFFEE TABLE 28 X 42")).toBe("COF-TAB");
    expect(resolveCatCode("BRAVADA CORNER SOFA 72 X 34")).toBe("COR-SOF");
    expect(resolveCatCode("BRAVADA ARMLESS SOFA 72 X 34")).toBe("ARM-SOF");
    expect(resolveCatCode("BRAVADA CORNER CHAISE 72 X 34")).toBe("COR-CHS");
  });

  it("prefers specific compound rules before generic fallbacks", () => {
    expect(resolveCatCode("SWIVEL CHAIR")).toBe("SWV-CHA");
    expect(resolveCatCode("CLUB CHAIR")).toBe("CLB-CHA");
    expect(resolveCatCode("GENERIC CHAIR")).toBe("CHA");
    expect(resolveCatCode("GENERIC TABLE")).toBe("TAB");
  });
});

describe("generateFinishedGoodSku", () => {
  it("builds FIN-[COL]-[CAT]-[SIZE] with compact dimensions", () => {
    expect(
      generateFinishedGoodSku(
        "BRAVADA SWIVEL CHAIR 34",
        "Bravada",
        "34",
        "34",
      ),
    ).toBe("FIN-BRV-SWV-CHA-34X34");

    expect(
      generateFinishedGoodSku(
        "BRAVADA CLUB CHAIR 34",
        "Bravada",
        "34",
        "34",
      ),
    ).toBe("FIN-BRV-CLB-CHA-34X34");

    expect(
      generateFinishedGoodSku(
        "BRAVADA COFFEE TABLE 28 X 42",
        "Bravada",
        "28",
        "42",
      ),
    ).toBe("FIN-BRV-COF-TAB-28X42");
  });

  it("resolves collection codes from original factory names", () => {
    expect(resolveColCode("Bravada", "BRAVADA SOFA 72")).toBe("BRV");
    expect(resolveColCode("", "BROOKLYN OTTOMAN 22 X 42")).toBe("BRK");
    expect(resolveColCode("", "OCEAN SWIVEL CHAIR 34")).toBe("OCN");
  });
});
