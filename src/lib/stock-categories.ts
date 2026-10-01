/**
 * Showroom category tabs. Katana `category_name` is free text, so the tab
 * list is whatever the catalog actually contains, minus factory-only groups.
 */

export const EXCLUDED_CATEGORIES = [
  "Metal",
  "Powder",
  "Packaging",
  "Hardware",
  "Consumables",
  "Sub-Assembly",
  "Stone",
  "Wood",
  "Foam",
  "Tubing",
  "Fasteners",
  "Weldment",
  "Raw Material",
  "Raw Materials",
] as const;

/** These stay at the front, in this order, when the catalog contains them. */
const PINNED_CATEGORIES = ["Fabrics", "Dekton", "Frames"] as const;

const EXCLUDED = new Set(EXCLUDED_CATEGORIES.map((name) => name.toLowerCase()));

export function katanaCategoryName(parent: {
  category_name?: unknown;
  category?: unknown;
}): string {
  const raw = parent.category_name ?? parent.category;
  return typeof raw === "string" ? raw.trim() : "";
}

function pinRank(category: string): number {
  const key = category.trim().toLowerCase();
  if (key === "fabric" || key === "fabrics") return 0;
  if (key === "dekton") return 1;
  if (key === "frame" || key === "frames") return 2;
  return PINNED_CATEGORIES.length;
}

/** Unique sellable categories. Pinned names lead; the rest are alphabetical. */
export function sellableCategoryTabs(
  items: readonly { category?: string | null }[],
): string[] {
  const unique = [
    ...new Set(items.map((item) => (item.category ?? "").trim()).filter(Boolean)),
  ];
  return unique
    .filter((name) => !EXCLUDED.has(name.toLowerCase()))
    .sort((left, right) => {
      const rank = pinRank(left) - pinRank(right);
      if (rank !== 0) return rank;
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    });
}
