import type { ItemType } from "@/server/db/schema";
import { normalizePimCategory } from "@/server/pim/attributes/schemas";

/**
 * Known Hub / legacy raw-material SKU prefixes.
 * Writers must treat these as Katana materials (`POST /materials`), never
 * products — regardless of a drifted `sku_mappings.item_type`.
 *
 * `RM-*` is the Hub Global E2E namespace; `FAB-` / `PWD-` / `STN-` / etc. are
 * legacy colorway & ingredient namespaces still live in the dictionary.
 */
export const HUB_RAW_MATERIAL_PREFIXES = [
  "RM-",
  "FAB-",
  "PWD-",
  "STN-",
  "MET-",
  "DKT-",
  "HRD-",
  "ALU-",
  "PWR-",
] as const;

/**
 * Hub / legacy raw-material namespaces. Writers must treat these as
 * Katana materials (`POST /materials`), never products — regardless of
 * a drifted `sku_mappings.item_type`.
 */
export function isHubRawMaterialSku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return HUB_RAW_MATERIAL_PREFIXES.some((p) => s.startsWith(p));
}

/** Hub-controlled weldments (`ASM-*`) plus legacy `SA-*` shells. */
export function isHubSubAssemblySku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return s.startsWith("ASM-") || s.startsWith("SA-");
}

/**
 * Coerce PIM item_type for publish / ingest.
 * `RM-*` is always raw_material. `ASM-*` / legacy `SA-*` are always sub_assembly.
 */
export function coerceHubItemType(
  sku: string,
  itemType: ItemType | string | null | undefined,
): ItemType {
  if (isHubRawMaterialSku(sku)) return "raw_material";
  if (isHubSubAssemblySku(sku)) return "sub_assembly";
  const t = String(itemType ?? "raw_material").trim();
  if (
    t === "raw_material" ||
    t === "sub_assembly" ||
    t === "finished_good" ||
    t === "service"
  ) {
    return t;
  }
  return "raw_material";
}

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
