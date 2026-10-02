import { describe, expect, it } from "vitest";
import { inferMaterialUom } from "@/lib/katana-material-uom";

describe("inferMaterialUom prefix dictionary", () => {
  it("maps metals / extrusions to ft", () => {
    expect(inferMaterialUom("RM-MET-2X2-TUBING")).toEqual({
      uom: "ft",
      katanaUom: "ft",
      rule: "RM-MET-*",
    });
  });

  it("maps powder to lb and fabric to yd", () => {
    expect(inferMaterialUom("PWD-BLACK").uom).toBe("lb");
    expect(inferMaterialUom("PWD-BLACK").katanaUom).toBe("lbs");
    expect(inferMaterialUom("RM-PWD-GENERIC").uom).toBe("lb");
    expect(inferMaterialUom("FAB-ACT-ASH").uom).toBe("yd");
    expect(inferMaterialUom("RM-FAB-GENERIC").uom).toBe("yd");
  });

  it("maps hardware and iron wood to ea", () => {
    expect(inferMaterialUom("RM-HRD-SPACERS")).toEqual({
      uom: "ea",
      katanaUom: "pcs",
      rule: "RM-HRD-*",
    });
    expect(inferMaterialUom("RM-RAW-IRON-WOOD")).toEqual({
      uom: "ea",
      katanaUom: "pcs",
      rule: "RM-RAW-IRON-*",
    });
  });

  it("keeps primer in the lb family and Dekton as slab", () => {
    expect(inferMaterialUom("PWD-GRAY-ZINC-EPOXY-PRIMER").uom).toBe("lb");
    expect(inferMaterialUom("RM-DKT-GENERIC-SLAB").uom).toBe("slab");
  });
});
