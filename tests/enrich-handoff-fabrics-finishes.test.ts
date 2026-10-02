import { describe, expect, it } from "vitest";
import {
  DEKTON_GRADE_ROWS,
  TAB02_HEADERS,
  inferDektonThicknessMm,
  normalizeMaterialRow,
} from "../scripts/enrich-handoff-fabrics-finishes";

describe("inferDektonThicknessMm", () => {
  it("maps Cosentino-style 1.2 / 2.0 name suffixes to mm", () => {
    expect(inferDektonThicknessMm("STN-DKT-ALB1.2", "ALBARIUM 1.2")).toBe("12");
    expect(inferDektonThicknessMm("STN-DKT-AT2.0", "AGED TIMBER 2.0")).toBe("20");
  });
});

describe("normalizeMaterialRow", () => {
  it("repairs swapped Category/ID columns from mangled sheets", () => {
    const swapped = normalizeMaterialRow(
      "STN-DKT-AT2.0",
      "Dekton",
      "AGED TIMBER 2.0",
      "",
      "Cosentino / Dekton",
      50,
    );
    expect(swapped).toMatchObject({
      internalId: "STN-DKT-AT2.0",
      category: "Dekton",
      displayName: "AGED TIMBER 2.0",
      pricingGrade: "",
    });

    const correct = normalizeMaterialRow(
      "Upholstery",
      "FAB-CAB-CLA",
      "CABANA CLASSIC",
      "Sunbrella",
      "B",
      3,
    );
    expect(correct).toMatchObject({
      category: "Upholstery",
      internalId: "FAB-CAB-CLA",
      pricingGrade: "B",
    });

    expect(
      normalizeMaterialRow(
        "CC Patio Internal ID",
        "Material Category",
        "Public Display Name",
        "",
        "",
        3,
      ),
    ).toBeNull();
  });
});

describe("handoff tab02 schema", () => {
  it("exposes e-comm complete headers without wholesale Dictionary Cost", () => {
    expect(TAB02_HEADERS[0]).toBe("Material Category");
    expect(TAB02_HEADERS[1]).toBe("CC Patio Internal ID");
    expect(TAB02_HEADERS).toContain("Hex / Preview");
    expect(TAB02_HEADERS).toContain("Retail Upcharge ($)");
    expect(TAB02_HEADERS).not.toContain("Dictionary Cost");
    expect(DEKTON_GRADE_ROWS.map((g) => g.grade)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
    ]);
  });
});
