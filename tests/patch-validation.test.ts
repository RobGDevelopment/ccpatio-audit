import { describe, expect, it } from "vitest";
import {
  validateAttributeFieldPatch,
  validateCatalogFieldPatch,
  validateMappingFieldPatch,
  validateRawMaterialCost,
} from "@/server/pim/patch-validation";

describe("patch-validation", () => {
  it("rejects non-numeric catalog dimensions", () => {
    expect(validateCatalogFieldPatch("length", "abc", true)).toEqual({
      field: "length",
      message: "Enter a valid number or mark N/A.",
    });
    expect(validateCatalogFieldPatch("length", "48", true)).toBeNull();
    expect(validateCatalogFieldPatch("length", "N/A", true)).toBeNull();
  });

  it("rejects invalid MSRP values", () => {
    expect(validateCatalogFieldPatch("msrp", "not-a-price", false)).toEqual({
      field: "msrp",
      message: "Enter a valid number or mark N/A.",
    });
    expect(validateCatalogFieldPatch("msrp", "$1,299.00", false)).toBeNull();
  });

  it("validates mapping base_cost as numeric", () => {
    expect(validateMappingFieldPatch("base_cost", "12.5")).toBeNull();
    expect(validateMappingFieldPatch("base_cost", "free")).toEqual({
      field: "base_cost",
      message: "Base cost must be a valid number.",
    });
  });

  it("validates attribute numeric fields", () => {
    expect(
      validateAttributeFieldPatch({
        category: "Fabric",
        path: "roll_width",
        value: "bad",
        currentAttributes: {},
      }),
    ).toEqual({
      field: "roll_width",
      message: "Enter a valid number or mark N/A.",
    });
    expect(
      validateAttributeFieldPatch({
        category: "Fabric",
        path: "roll_width",
        value: "54",
        currentAttributes: {},
      }),
    ).toBeNull();
  });

  it("validates raw material cost", () => {
    expect(validateRawMaterialCost("")).toBeNull();
    expect(validateRawMaterialCost("4.25")).toBeNull();
    expect(validateRawMaterialCost("TBD")).toEqual({
      field: "base_cost",
      message: "Cost must be a valid number.",
    });
  });
});
