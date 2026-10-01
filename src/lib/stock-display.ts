export type StockRow = {
  sku: string;
  name: string;
  inStock: number;
  committed: number;
  available: number;
  imageUrl: string | null;
};

export function roundQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = roundQty(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export type StockTone = "green" | "amber" | "red";

/** Green above 10, amber from just above 0 through 10, red at 0 or below. */
export function availableTone(available: number): StockTone {
  if (available > 10) return "green";
  if (available > 0) return "amber";
  return "red";
}

export type StockCatalogItem = {
  variantId: number;
  sku: string;
  name: string;
  imageUrl?: string | null;
};

export const STOCK_PREFIXES = ["FAB-", "STN-DKT-", "FRP-"] as const;
export type StockPrefix = (typeof STOCK_PREFIXES)[number];

export function isStockPrefix(value: string): value is StockPrefix {
  return (STOCK_PREFIXES as readonly string[]).includes(value);
}

/** SA-* or ASM-* sub-assemblies whose code contains a FRAME segment. */
export function isFrameSku(sku: string): boolean {
  const upper = sku.trim().toUpperCase();
  if (!upper.startsWith("SA-") && !upper.startsWith("ASM-")) return false;
  return /(?:^|-)FRAME(?:-|$)/.test(upper);
}

export type StockFamily = "fabrics" | "dekton" | "frames";

export function matchesStockFamily(sku: string, family: StockFamily): boolean {
  const upper = sku.trim().toUpperCase();
  if (family === "fabrics") return upper.startsWith("FAB-");
  if (family === "dekton") return upper.startsWith("STN-DKT-");
  return isFrameSku(upper);
}

export function filterStockCatalog(
  items: StockCatalogItem[],
  input: { query?: string; prefix?: string; family?: StockFamily },
): StockCatalogItem[] {
  if (input.family) {
    return items.filter((item) => matchesStockFamily(item.sku, input.family!)).sort(byName);
  }
  const prefix = input.prefix?.trim().toUpperCase() ?? "";
  if (prefix) {
    return items
      .filter((item) => item.sku.toUpperCase().startsWith(prefix))
      .sort(byName);
  }
  const query = input.query?.trim().toLowerCase() ?? "";
  if (query.length < 2) return [];
  return items
    .filter((item) => {
      const name = item.name.toLowerCase();
      const sku = item.sku.toLowerCase();
      return name.includes(query) || sku.includes(query);
    })
    .sort(byName);
}

function byName(left: StockCatalogItem, right: StockCatalogItem): number {
  const name = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  if (name !== 0) return name;
  return left.sku.localeCompare(right.sku);
}
