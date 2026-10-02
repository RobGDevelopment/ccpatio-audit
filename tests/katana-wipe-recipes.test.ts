import { describe, expect, it } from "vitest";
import {
  isFinParentSku,
  isSaIngredientSku,
  shouldWipeFinParentRecipe,
} from "@/lib/katana-wipe-recipes";

describe("katana FIN-* SA- recipe wipe targeting", () => {
  it("recognizes FIN parents and SA ingredients", () => {
    expect(isFinParentSku("FIN-BRV-SOF-72X34")).toBe(true);
    expect(isFinParentSku("ASM-BRV-SOF-72X34-FRAME")).toBe(false);
    expect(isSaIngredientSku("SA-BRV-SOF-72X34-FRAME")).toBe(true);
    expect(isSaIngredientSku("ASM-BRV-SOF-72X34-FRAME")).toBe(false);
  });

  it("wipes FIN parents that still consume SA-* (full recipe, not SA rows only)", () => {
    expect(
      shouldWipeFinParentRecipe({
        parentSku: "FIN-WFT-DIN-TAB-72X28",
        ingredientSkus: ["SA-WFT-DIN-TAB-72X28-FRAME", "RM-DKT-GENERIC-SLAB"],
      }),
    ).toBe(true);
  });

  it("keeps FIN parents that already consume ASM-* only", () => {
    expect(
      shouldWipeFinParentRecipe({
        parentSku: "FIN-WFT-DIN-TAB-72X28",
        ingredientSkus: ["ASM-WFT-DIN-TAB-72X28-FRAME"],
      }),
    ).toBe(false);
  });

  it("does not wipe SA/ASM/legacy parents even if they have children", () => {
    expect(
      shouldWipeFinParentRecipe({
        parentSku: "SA-OCN-SOF-72X38-FRAME",
        ingredientSkus: ["RM-MET-2X2-TUBING"],
      }),
    ).toBe(false);
    expect(
      shouldWipeFinParentRecipe({
        parentSku: "BRA-C-34X84-LS-BO",
        ingredientSkus: ["SA-BRA-FRAME"],
      }),
    ).toBe(false);
  });
});
