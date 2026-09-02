/**
 * Pure helpers for Make-to-Order recipe-row overrides.
 * Network I/O lives in src/lib/katana.ts (applyMtoIngredientOverrides).
 */

export type KatanaMoRecipeRow = {
  id: number;
  manufacturing_order_id: number;
  variant_id: number;
  related_manufacturing_order_id: number | null;
};

export type KatanaMoTreeNode = {
  id: number;
  sales_order_id: number | null;
  sales_order_row_id: number | null;
  order_no: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function parseKatanaListPayload(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  }
  const wrapped = asRecord(data);
  if (Array.isArray(wrapped?.data)) {
    return wrapped.data
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== null);
  }
  const single = asRecord(data);
  return single ? [single] : [];
}

export function parseMoRecipeRow(
  record: Record<string, unknown>,
): KatanaMoRecipeRow | null {
  const id = finiteId(record.id);
  const manufacturingOrderId = finiteId(record.manufacturing_order_id);
  const variantId = finiteId(record.variant_id);
  if (id == null || manufacturingOrderId == null || variantId == null) {
    return null;
  }
  return {
    id,
    manufacturing_order_id: manufacturingOrderId,
    variant_id: variantId,
    related_manufacturing_order_id:
      finiteId(record.related_manufacturing_order_id) ??
      finiteId(record.ingredient_manufacturing_order_id) ??
      finiteId(record.linked_manufacturing_order_id),
  };
}

export function parseMoTreeNode(record: Record<string, unknown>): KatanaMoTreeNode | null {
  const id = finiteId(record.id);
  if (id == null) {
    return null;
  }
  return {
    id,
    sales_order_id: finiteId(record.sales_order_id),
    sales_order_row_id: finiteId(record.sales_order_row_id),
    order_no: typeof record.order_no === "string" ? record.order_no : null,
  };
}

export function findRecipeRowsByVariantId(
  rows: KatanaMoRecipeRow[],
  variantId: number,
): KatanaMoRecipeRow[] {
  return rows.filter((row) => row.variant_id === variantId);
}

export function collectChildMoIdsFromRecipeRows(rows: KatanaMoRecipeRow[]): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    if (row.related_manufacturing_order_id != null) {
      ids.add(row.related_manufacturing_order_id);
    }
  }
  return [...ids];
}

/**
 * Collect nested manufacturing-order ids from a Katana MO / MTO payload
 * without treating every numeric `id` (location, serial, batch) as an MO.
 */
export function collectNestedManufacturingOrderIds(payload: unknown): number[] {
  const ids = new Set<number>();

  const visitArray = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const id = finiteId(record.id);
      const looksLikeMo =
        typeof record.order_no === "string" ||
        record.variant_id != null ||
        record.sales_order_row_id != null;
      if (id != null && looksLikeMo) {
        ids.add(id);
      }
    }
  };

  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  visitArray(root.manufacturing_orders);
  visitArray(root.subassemblies);
  visitArray(root.related_manufacturing_orders);
  visitArray(root.child_manufacturing_orders);

  const related =
    finiteId(root.related_manufacturing_order_id) ??
    finiteId(root.ingredient_manufacturing_order_id);
  if (related != null) {
    ids.add(related);
  }

  return [...ids];
}

/** Child MOs from create_subassemblies use order_no like `{parent} / 1`. */
export function isNestedMoOrderNo(
  parentOrderNo: string,
  candidateOrderNo: string,
): boolean {
  const parent = parentOrderNo.trim();
  const candidate = candidateOrderNo.trim();
  if (!parent || !candidate || parent === candidate) {
    return false;
  }
  return candidate.startsWith(`${parent} /`);
}

export function isMoInParentTree(
  candidate: KatanaMoTreeNode,
  parent: KatanaMoTreeNode,
): boolean {
  if (candidate.id === parent.id) {
    return true;
  }
  if (
    parent.order_no &&
    candidate.order_no &&
    isNestedMoOrderNo(parent.order_no, candidate.order_no)
  ) {
    return true;
  }
  if (
    parent.sales_order_id != null &&
    candidate.sales_order_id === parent.sales_order_id &&
    parent.sales_order_row_id != null &&
    candidate.sales_order_row_id === parent.sales_order_row_id
  ) {
    return true;
  }
  return false;
}

export function resolveCreateSubassemblies(
  options?: { createSubassemblies?: boolean },
): boolean {
  return options?.createSubassemblies === true;
}
