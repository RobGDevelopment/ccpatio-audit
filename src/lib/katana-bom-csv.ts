/**
 * RFC 4180 CSV for Katana "Add new recipes" bulk import.
 * Quotes any field that contains comma, quote, CR, or LF; doubles inner quotes.
 *
 * Also provides recipe-row aggregation: Katana rejects a parent recipe that
 * lists the same ingredient SKU more than once. Cut-list / clone pipelines can
 * emit multiple (parent, ingredient) rows — sum qty and join notes before export.
 */

export type KatanaRecipeRow = {
  productSku: string;
  productName: string;
  ingredientSku: string;
  ingredientName: string;
  notes: string;
  quantity: number;
};

export function escapeKatanaCsvField(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toKatanaCsv(rows: Array<Array<string | number>>): string {
  const body = rows.map((row) => row.map(escapeKatanaCsvField).join(",")).join("\r\n");
  return body.length > 0 ? `${body}\r\n` : "";
}

function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Collapse duplicate (productSku, ingredientSku) pairs:
 *   - quantity = sum
 *   - notes = distinct non-empty notes joined with " | " (preserve cut-list geometry)
 *   - names = first non-empty
 * Rows with empty SKUs or non-positive qty after sum are dropped.
 */
export function aggregateKatanaRecipeRows(
  rows: readonly KatanaRecipeRow[],
): KatanaRecipeRow[] {
  type Acc = {
    productSku: string;
    productName: string;
    ingredientSku: string;
    ingredientName: string;
    quantity: number;
    notes: string[];
    noteSeen: Set<string>;
  };

  const merged = new Map<string, Acc>();

  for (const row of rows) {
    const productSku = normalizeSku(row.productSku);
    const ingredientSku = normalizeSku(row.ingredientSku);
    if (!productSku || !ingredientSku) continue;

    const key = `${productSku}|${ingredientSku}`;
    const existing = merged.get(key);
    if (!existing) {
      const note = row.notes.trim();
      const notes: string[] = [];
      const noteSeen = new Set<string>();
      if (note) {
        notes.push(note);
        noteSeen.add(note);
      }
      merged.set(key, {
        productSku,
        productName: row.productName.trim(),
        ingredientSku,
        ingredientName: row.ingredientName.trim(),
        quantity: roundQty(row.quantity),
        notes,
        noteSeen,
      });
      continue;
    }

    existing.quantity = roundQty(existing.quantity + row.quantity);
    if (!existing.productName && row.productName.trim()) {
      existing.productName = row.productName.trim();
    }
    if (!existing.ingredientName && row.ingredientName.trim()) {
      existing.ingredientName = row.ingredientName.trim();
    }
    const note = row.notes.trim();
    if (note && !existing.noteSeen.has(note)) {
      existing.notes.push(note);
      existing.noteSeen.add(note);
    }
  }

  return [...merged.values()]
    .filter((r) => r.quantity > 0)
    .map((r) => ({
      productSku: r.productSku,
      productName: r.productName,
      ingredientSku: r.ingredientSku,
      ingredientName: r.ingredientName,
      notes: r.notes.join(" | "),
      quantity: r.quantity,
    }))
    .sort((a, b) => {
      const byParent = a.productSku.localeCompare(b.productSku);
      if (byParent !== 0) return byParent;
      return a.ingredientSku.localeCompare(b.ingredientSku);
    });
}
