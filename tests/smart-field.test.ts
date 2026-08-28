import { describe, expect, it } from "vitest";
import type { ProductFieldDescriptor } from "@/app/admin/dictionary/pim-catalog-utils";
import { isSmartFieldComplete } from "@/app/admin/shared/SmartFieldInput";
import { resolveSmartFieldMeta } from "@/app/admin/shared/smart-field-config";

function field(key: string, patchField?: string): ProductFieldDescriptor {
  return {
    key,
    label: key,
    target: "attribute",
    patchField: patchField ?? key,
    allowNa: true,
    section: "attribute",
    initialValue: "",
    isMissing: true,
  };
}

describe("smart-field-config", () => {
  it("resolves numeric fields", () => {
    expect(resolveSmartFieldMeta("roll_width").kind).toBe("number");
    expect(resolveSmartFieldMeta("base_cost").step).toBe("0.01");
  });

  it("resolves constrained selects", () => {
    expect(resolveSmartFieldMeta("grade").kind).toBe("select");
    expect(resolveSmartFieldMeta("grade").options).toContain("A");
    expect(resolveSmartFieldMeta("profile_type").options).toContain("Extrusion");
  });
});

describe("SmartFieldInput helpers", () => {
  it("treats N/A as complete when allowed", () => {
    expect(isSmartFieldComplete(field("roll_width"), "N/A")).toBe(true);
  });

  it("requires valid numeric values", () => {
    expect(isSmartFieldComplete(field("roll_width"), "54")).toBe(true);
    expect(isSmartFieldComplete(field("roll_width"), "wide")).toBe(false);
  });

  it("requires select option match", () => {
    expect(isSmartFieldComplete(field("grade"), "B")).toBe(true);
    expect(isSmartFieldComplete(field("grade"), "Premium")).toBe(false);
  });
});
