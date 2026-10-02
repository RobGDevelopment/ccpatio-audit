/**
 * Targeting rules for wiping flawed SA-* recipes off Katana FIN-* parents.
 *
 * Katana contract (developer.katanamrp.com):
 *   - DELETE /bom_rows/{id} is the supported wipe (204).
 *   - DELETE /recipes/{id} is gone (405 in this tenant).
 *   - POST /recipes requires rows.minItems=1, so it cannot clear a BOM.
 */

export function isFinParentSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith("FIN-");
}

export function isSaIngredientSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith("SA-");
}

export function isAsmIngredientSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith("ASM-");
}

/**
 * Wipe the entire parent recipe when a FIN-* product still consumes SA-*.
 * ASM-only (or RM-only) recipes are left alone so a successful remint is kept.
 */
export function shouldWipeFinParentRecipe(input: {
  parentSku: string;
  ingredientSkus: readonly string[];
}): boolean {
  if (!isFinParentSku(input.parentSku)) return false;
  return input.ingredientSkus.some(isSaIngredientSku);
}

export function saIngredientSkus(ingredientSkus: readonly string[]): string[] {
  return ingredientSkus.filter(isSaIngredientSku);
}
