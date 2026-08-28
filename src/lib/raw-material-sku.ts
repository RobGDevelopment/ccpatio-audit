import { normalizePimCategory } from "@/server/pim/attributes/schemas";

/** Category prefix tokens for raw-material SKUs (RM-{CODE}-{slug}). */
const CATEGORY_CODES: Record<string, string> = {
  fabric: "FAB",
  metal: "MET",
  aluminum: "ALU",
  powder: "PWR",
  "powder coat": "PWR",
  dekton: "DKT",
  shade: "SHD",
  hardware: "HRD",
  "sub-assembly": "SUB",
  other: "RAW",
};

export function resolveRawMaterialCategoryCode(category: string): string {
  const key = normalizePimCategory(category);
  if (key === "powder coat" || key === "powdercoat") return CATEGORY_CODES.powder!;
  if (key === "aluminum") return CATEGORY_CODES.aluminum!;
  return CATEGORY_CODES[key] ?? "RAW";
}

function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return slug || "ITEM";
}

/** Build base SKU before collision suffix (RM-FAB-SUNBRELLA-NATURAL). */
export function buildRawMaterialSkuBase(category: string, name: string): string {
  const code = resolveRawMaterialCategoryCode(category);
  return `RM-${code}-${slugifyName(name)}`;
}

/** Pick first available SKU by appending -2, -3, … */
export function nextAvailableSku(
  base: string,
  taken: ReadonlySet<string>,
): string {
  const root = base.trim().toUpperCase();
  if (!taken.has(root)) return root;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}-${Date.now().toString(36).toUpperCase()}`;
}

export function resolveAttributeTabKey(category: string): string {
  const key = normalizePimCategory(category);
  if (key === "powder coat" || key === "powdercoat") return "powder";
  if (key === "aluminum") return "metal";
  return key;
}
