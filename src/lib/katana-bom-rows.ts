/**
 * Katana manufacturing BOM writer path (PR-T2.3).
 * Soft-migrate POST /recipes → POST /bom_rows/batch/create.
 * /recipes remains the fallback when the flag is off or the new contract fails.
 */
export const KATANA_RECIPES_PATH = "/recipes";
export const KATANA_BOM_ROWS_BATCH_PATH = "/bom_rows/batch/create";
export const KATANA_BOM_ROWS_MAX_BATCH = 250;
export const KATANA_BOM_ROW_NOTES_MAX = 255;

/** Default ON (soft-migrate). Set KATANA_USE_BOM_ROWS=false to force /recipes. */
export function isKatanaBomRowsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.KATANA_USE_BOM_ROWS?.trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

export function katanaManufacturingBomPath(
  env: Record<string, string | undefined> = process.env,
): typeof KATANA_BOM_ROWS_BATCH_PATH | typeof KATANA_RECIPES_PATH {
  return isKatanaBomRowsEnabled(env)
    ? KATANA_BOM_ROWS_BATCH_PATH
    : KATANA_RECIPES_PATH;
}

export function shouldFallbackKatanaBomRows(status: number): boolean {
  if (status === 401 || status === 403) return false;
  return (
    status === 404 ||
    status === 405 ||
    status === 410 ||
    status === 422 ||
    status === 501
  );
}

export function truncateKatanaBomRowNotes(
  notes: string | undefined,
): string | null {
  const trimmed = notes?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length <= KATANA_BOM_ROW_NOTES_MAX) return trimmed;
  return trimmed.slice(0, KATANA_BOM_ROW_NOTES_MAX);
}

export function toKatanaBomRowBody(input: {
  productItemId: number;
  productVariantId: number;
  ingredientVariantId: number;
  quantity: number;
  notes?: string;
}): Record<string, unknown> {
  return {
    product_item_id: input.productItemId,
    product_variant_id: input.productVariantId,
    ingredient_variant_id: input.ingredientVariantId,
    quantity: input.quantity,
    notes: truncateKatanaBomRowNotes(input.notes),
  };
}

export function chunkKatanaBomRows<T>(
  rows: T[],
  size: number = KATANA_BOM_ROWS_MAX_BATCH,
): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}
