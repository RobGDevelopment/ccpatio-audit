/**
 * Cost 2025 material baseline rates (CC Patio Furniture Cost 2025.xlsx headers).
 *
 * These are rate-card fallbacks when sku_mappings.base_cost is null.
 * Prefer Hub DB base_cost for per-SKU truth (especially STN-* slab PO costs).
 *
 * Binding: docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx
 * Analysis: tmp/historical-costing-analysis.md §Material baselines
 */

export type MaterialCostRule = {
  rule: string;
  price: number;
  unitNote: string;
};

/**
 * Rule order matters: namespace prefixes first, then more-specific tubing
 * tokens before shorter ones (2X3 before 2X2 before 2X1).
 */
export function resolveCost2025Price(skuRaw: string): MaterialCostRule | null {
  const sku = skuRaw.trim().toUpperCase();
  if (!sku) return null;

  // Fabric $/yd
  if (sku.startsWith("RM-FAB-") || sku.startsWith("FAB-")) {
    return { rule: "Cost2025 FAB-/RM-FAB-", price: 20.0, unitNote: "$/yd" };
  }
  // Dekton placeholder $/sqft — do NOT apply to STN-* colorways (true PO $ often per slab)
  if (sku.startsWith("RM-DKT-") || sku.startsWith("DKT-")) {
    return { rule: "Cost2025 DKT-/RM-DKT-", price: 8.0, unitNote: "$/sqft" };
  }
  // Primer $/lb — PRM- namespace OR mis-prefixed PWD-*PRIMER* rows
  if (
    sku.startsWith("RM-PRM-") ||
    sku.startsWith("PRM-") ||
    sku.includes("PRIMER")
  ) {
    return { rule: "Cost2025 PRM-/PRIMER", price: 9.45, unitNote: "$/lb" };
  }
  // Powder $/lb (after primer so zinc-epoxy primer is not overwritten)
  if (sku.startsWith("RM-PWD-") || sku.startsWith("PWD-")) {
    return { rule: "Cost2025 PWD-/RM-PWD-", price: 8.64, unitNote: "$/lb" };
  }

  // Hardware caps etc. may contain 2X2 in the name — do not treat as tubing
  if (sku.startsWith("RM-HRD-") || sku.startsWith("HRD-")) {
    return null;
  }

  // Tubing $/LF — normalize separators then match include-tokens
  const compact = sku.replace(/\s+/g, "").replace(/\//g, "X");

  if (compact.includes("1.5X1.5")) {
    return { rule: "Cost2025 includes 1.5X1.5", price: 2.98, unitNote: "$/LF" };
  }
  if (
    compact.includes("1.5X.75") ||
    compact.includes("1.5X0.75") ||
    compact.includes("1.5X075")
  ) {
    return { rule: "Cost2025 includes 1.5X.75", price: 1.0, unitNote: "$/LF" };
  }
  if (compact.includes("2X3")) {
    return { rule: "Cost2025 includes 2X3", price: 3.67, unitNote: "$/LF" };
  }
  if (compact.includes("2X2")) {
    return { rule: "Cost2025 includes 2X2", price: 1.68, unitNote: "$/LF" };
  }
  if (compact.includes("2X1")) {
    return { rule: "Cost2025 includes 2X1", price: 1.44, unitNote: "$/LF" };
  }

  return null;
}
