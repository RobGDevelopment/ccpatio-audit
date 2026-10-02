/**
 * Showroom category tabs for the GHL live-stock iframe.
 * Walk-in customers only see purchased materials and third-party goods.
 * Finished goods and in-house MTO collections never become pills or cards.
 */

import { stockFacet } from "@/lib/stock-facets";

/** Shop consumables. They are not on the showroom allowlist. */
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

/** The only categories this screen may show, in pill order. */
export const SHOWROOM_STOCK_CATEGORIES = [
  "Fabric",
  "Dekton",
  "Tenjam",
  "Umbrellas",
  "Cabana",
  "Flexy",
  "Marina",
  "Fire Glass",
  "Firepit Accessory",
] as const;

const ALLOWED = new Set<string>(
  SHOWROOM_STOCK_CATEGORIES.map((name) => name.toLowerCase()),
);

const FACTORY_CATEGORIES = new Set(
  EXCLUDED_CATEGORIES.map((name) => name.toLowerCase()),
);

const MTO_LABELS = new Set([
  "bravada",
  "brooklyn",
  "ocean",
  "milan",
  "taylor",
  "daisy",
  "waterfall",
  "dining tables",
]);

const ALIASES: Record<string, string> = {
  "finished good": "Finished Good",
  "finished goods": "Finished Good",
  fabric: "Fabric",
  fabrics: "Fabric",
  dekton: "Dekton",
  tenjam: "Tenjam",
  umbrella: "Umbrellas",
  umbrellas: "Umbrellas",
  cabana: "Cabana",
  flexy: "Flexy",
  marina: "Marina",
  "fire glass": "Fire Glass",
  "firepit accessory": "Firepit Accessory",
  "fire pit accessory": "Firepit Accessory",
  "firepit accessories": "Firepit Accessory",
};

function cleanLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/\s+collection$/i, "");
}

/** One display label for Katana's free-text category names. */
export function normalizeStockCategory(raw: string): string {
  const text = cleanLabel(raw);
  if (!text) return "";
  const key = text.toLowerCase();
  const alias = ALIASES[key];
  if (alias) return alias;
  return text
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function isAllowlistedStockCategory(category: string): boolean {
  return ALLOWED.has(normalizeStockCategory(category).toLowerCase());
}

function isMtoLabel(label: string): boolean {
  return MTO_LABELS.has(cleanLabel(label).toLowerCase());
}

function isMtoProductName(name: string): boolean {
  const text = name.trim().replace(/\s+/g, " ");
  if (!text) return false;
  if (isMtoLabel(stockFacet(text).collection)) return true;
  const lower = text.toLowerCase();
  for (const phrase of MTO_LABELS) {
    if (!phrase.includes(" ")) continue;
    if (lower === phrase || lower.startsWith(`${phrase} `)) return true;
  }
  return false;
}

/** True when a Katana variant may appear on the walk-in stock screen. */
export function isShowroomStockItem(item: {
  category?: string | null;
  name?: string | null;
}): boolean {
  const category = normalizeStockCategory(item.category ?? "");
  if (!category || FACTORY_CATEGORIES.has(category.toLowerCase())) return false;
  if (!ALLOWED.has(category.toLowerCase())) return false;
  if (isMtoLabel(category) || isMtoProductName(item.name ?? "")) return false;
  return true;
}

export function katanaCategoryName(parent: {
  category_name?: unknown;
  category?: unknown;
}): string {
  const raw = parent.category_name ?? parent.category;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Allowlisted categories that are actually present, in allowlist order. */
export function sellableCategoryTabs(
  items: readonly { category?: string | null }[],
): string[] {
  const present = new Set<string>();
  for (const item of items) {
    const name = normalizeStockCategory(item.category ?? "");
    if (!name || !ALLOWED.has(name.toLowerCase())) continue;
    present.add(name);
  }
  return SHOWROOM_STOCK_CATEGORIES.filter((name) => present.has(name));
}
