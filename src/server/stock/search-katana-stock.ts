import { katanaFetch, resolveLiveKatanaApiBase } from "@/lib/katana";
import { stockFacet, type StockCollection } from "@/lib/stock-facets";
import {
  isAllowlistedStockCategory,
  isShowroomStockItem,
  katanaCategoryName,
  normalizeStockCategory,
} from "@/lib/stock-categories";
import {
  filterStockCatalog,
  isStockPrefix,
  matchesStockFamily,
  readSpecLabel,
  roundQty,
  type StockCatalogItem,
  type StockFamily,
  type StockRow,
} from "@/lib/stock-display";
import { displayStockUom } from "@/lib/hold-quantity";

/** CC Manufacturing. Inventory at this location wins when Katana has a row there. */
const FACTORY_LOCATION_ID = 98179;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const INVENTORY_BATCH = 40;
const CATALOG_TTL_MS = 5 * 60 * 1000;

export type StockSearchResult =
  | { ok: true; rows: StockRow[] }
  | { ok: false; error: string };

export type StockCollectionResult =
  | { ok: true; collections: StockCollection[] }
  | { ok: false; error: string };

type CatalogCache = { at: number; items: StockCatalogItem[] };
let catalogCache: CatalogCache | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listPayload(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  }
  const wrapped = asRecord(data);
  if (Array.isArray(wrapped?.data)) {
    return wrapped.data
      .map(asRecord)
      .filter((row): row is Record<string, unknown> => row !== null);
  }
  return [];
}

async function listResource(path: "/materials" | "/products"): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let previousFirstId: number | null = null;
  const baseUrl = resolveLiveKatanaApiBase();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch<unknown>(`${path}?limit=${PAGE_SIZE}&page=${page}`, {
      baseUrl,
    });
    const pageRows = listPayload(data);
    if (pageRows.length === 0) break;
    const firstId = Number(pageRows[0]?.id);
    if (page > 1 && firstId > 0 && firstId === previousFirstId) break;
    previousFirstId = firstId > 0 ? firstId : previousFirstId;
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function imageFromRecord(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of ["image_url", "image", "thumbnail_url", "picture_url", "photo_url"]) {
    const url = httpUrl(record[key]);
    if (url) return url;
  }
  if (!Array.isArray(record.images)) return null;
  for (const image of record.images) {
    const direct = httpUrl(image);
    if (direct) return direct;
    const nested = asRecord(image);
    const url = httpUrl(nested?.url) ?? httpUrl(nested?.image_url) ?? httpUrl(nested?.src);
    if (url) return url;
  }
  return null;
}

function rawUom(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const value = record.uom;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function itemsFromParents(parents: Record<string, unknown>[]): StockCatalogItem[] {
  const items: StockCatalogItem[] = [];
  const seen = new Set<number>();
  for (const parent of parents) {
    if (parent.deleted_at) continue;
    const name = String(parent.name ?? "").trim();
    const parentImage = imageFromRecord(parent);
    const variants = Array.isArray(parent.variants) ? parent.variants : [];
    for (const variant of variants) {
      const record = asRecord(variant);
      if (!record || record.deleted_at) continue;
      const variantId = Number(record.id);
      const sku = String(record.sku ?? "").trim().toUpperCase();
      if (!Number.isFinite(variantId) || variantId <= 0 || !sku || seen.has(variantId)) continue;
      seen.add(variantId);
      items.push({
        variantId,
        sku,
        name: name || sku,
        variantLabel: readSpecLabel(record.config_attributes),
        imageUrl: imageFromRecord(record) ?? parentImage,
        category: katanaCategoryName(parent),
        uom: displayStockUom(sku, rawUom(record) ?? rawUom(parent)),
      });
    }
  }
  return items;
}

async function loadCatalog(): Promise<StockCatalogItem[]> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.items;
  }
  const materials = await listResource("/materials");
  let products: Record<string, unknown>[] = [];
  try {
    products = await listResource("/products");
  } catch (error) {
    console.error("[showroom-stock] products fetch failed", error);
  }
  const byId = new Map<number, StockCatalogItem>();
  for (const item of itemsFromParents([...materials, ...products])) {
    byId.set(item.variantId, item);
  }
  const items = [...byId.values()];
  console.log("[showroom-stock] raw catalog", {
    materials: materials.length,
    products: products.length,
    variants: items.length,
    fabrics: items.filter((item) => matchesStockFamily(item.sku, "fabrics")).length,
    dekton: items.filter((item) => matchesStockFamily(item.sku, "dekton")).length,
    frames: items.filter((item) => matchesStockFamily(item.sku, "frames")).length,
  });
  catalogCache = { at: Date.now(), items };
  return items;
}

function foldInventory(rows: Record<string, unknown>[]): Map<number, { inStock: number; committed: number }> {
  const grouped = new Map<number, Record<string, unknown>[]>();
  for (const row of rows) {
    const variantId = Number(row.variant_id);
    if (!Number.isFinite(variantId) || variantId <= 0) continue;
    const list = grouped.get(variantId) ?? [];
    list.push(row);
    grouped.set(variantId, list);
  }
  const totals = new Map<number, { inStock: number; committed: number }>();
  for (const [variantId, list] of grouped) {
    const atFactory = list.filter((row) => Number(row.location_id) === FACTORY_LOCATION_ID);
    const used = atFactory.length > 0 ? atFactory : list;
    let inStock = 0;
    let committed = 0;
    for (const row of used) {
      inStock += Number(row.quantity_in_stock ?? 0);
      committed += Number(row.quantity_committed ?? 0);
    }
    totals.set(variantId, { inStock: roundQty(inStock), committed: roundQty(committed) });
  }
  return totals;
}

async function inventoryForVariants(
  ids: number[],
): Promise<Map<number, { inStock: number; committed: number }>> {
  const totals = new Map<number, { inStock: number; committed: number }>();
  for (let index = 0; index < ids.length; index += INVENTORY_BATCH) {
    const chunk = ids.slice(index, index + INVENTORY_BATCH);
    const params = new URLSearchParams();
    params.set("limit", "250");
    for (const id of chunk) params.append("variant_id", String(id));
    const { data } = await katanaFetch<unknown>(`/inventory?${params.toString()}`, {
      baseUrl: resolveLiveKatanaApiBase(),
    });
    for (const [variantId, qty] of foldInventory(listPayload(data))) {
      totals.set(variantId, qty);
    }
  }
  return totals;
}

function familyMatches(
  catalog: StockCatalogItem[],
  input: { query?: string; prefix?: string; family?: StockFamily; category?: string },
): StockCatalogItem[] | { error: string } {
  const prefix = input.prefix?.trim().toUpperCase() ?? "";
  const query = input.query?.trim().toLowerCase() ?? "";
  const category = input.category?.trim() ?? "";
  if (!input.family && !category && prefix && !isStockPrefix(prefix)) {
    return { error: "Unknown stock filter." };
  }
  const visible = catalog.filter((item) => isShowroomStockItem(item));
  const wanted = category ? normalizeStockCategory(category) : "";
  const scoped =
    wanted && isAllowlistedStockCategory(wanted)
      ? visible.filter((item) => normalizeStockCategory(item.category ?? "") === wanted)
      : wanted
        ? []
        : visible;
  const matches = wanted
    ? scoped
    : filterStockCatalog(scoped, {
        family: input.family,
        prefix: prefix || undefined,
        query,
      });
  console.log("[showroom-stock] filter", {
    family: input.family ?? null,
    category: wanted || null,
    prefix: prefix || null,
    query: query || null,
    rawVariants: catalog.length,
    matched: matches.length,
  });
  return matches;
}

function groupCollections(items: StockCatalogItem[]): StockCollection[] {
  const groups = new Map<string, { name: string; variants: Set<string>; count: number }>();
  for (const item of items) {
    const facet = stockFacet(item.name);
    const key = facet.collection.toLowerCase();
    const group = groups.get(key) ?? { name: facet.collection, variants: new Set<string>(), count: 0 };
    group.variants.add(facet.variant);
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      variants: [...group.variants].sort((left, right) => left.localeCompare(right)),
      count: group.count,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** One row per allowlisted Katana category, using the normalized label. */
export async function listCatalogCategoryItems(): Promise<{ category: string }[]> {
  const catalog = await loadCatalog();
  const seen = new Set<string>();
  const items: { category: string }[] = [];
  for (const item of catalog) {
    if (!isShowroomStockItem(item)) continue;
    const category = normalizeStockCategory(item.category ?? "");
    const key = category.toLowerCase();
    if (!category || seen.has(key)) continue;
    seen.add(key);
    items.push({ category });
  }
  return items;
}

export async function listStockCollections(input: {
  prefix?: string;
  family?: StockFamily;
  category?: string;
}): Promise<StockCollectionResult> {
  const prefix = input.prefix?.trim().toUpperCase() ?? "";
  const category = input.category?.trim() ?? "";
  if (!input.family && !prefix && !category) return { ok: false, error: "Choose a stock family." };
  const catalog = await loadCatalog();
  const matches = familyMatches(catalog, input);
  if ("error" in matches) return { ok: false, error: matches.error };
  return { ok: true, collections: groupCollections(matches) };
}

/**
 * Read-only Katana lookup. Names come from materials and products.
 * Matching is case-insensitive. Inventory is batched so a collection
 * filter does not call once per SKU.
 */
export async function searchKatanaStock(input: {
  query?: string;
  prefix?: string;
  family?: StockFamily;
  category?: string;
  collection?: string;
}): Promise<StockSearchResult> {
  const prefix = input.prefix?.trim().toUpperCase() ?? "";
  const query = input.query?.trim().toLowerCase() ?? "";
  const collection = input.collection?.trim().toLowerCase() ?? "";
  const category = input.category?.trim() ?? "";
  const browsingFamily = Boolean(input.family || category);
  if (!browsingFamily && prefix && !isStockPrefix(prefix)) {
    return { ok: false, error: "Unknown stock filter." };
  }
  if (!browsingFamily && !prefix && !collection && query.replace(/[%_]/g, "").trim().length < 2) {
    return { ok: false, error: "Enter at least 2 characters." };
  }

  const catalog = await loadCatalog();
  const matched = familyMatches(catalog, {
    query,
    prefix: prefix || undefined,
    family: input.family,
    category: category || undefined,
  });
  if ("error" in matched) return { ok: false, error: matched.error };
  const matches = collection
    ? matched.filter((item) => stockFacet(item.name).collection.toLowerCase() === collection)
    : matched;
  if (matches.length === 0) return { ok: true, rows: [] };

  const quantities = await inventoryForVariants(matches.map((item) => item.variantId));
  const rows: StockRow[] = matches.map((item) => {
    const qty = quantities.get(item.variantId) ?? { inStock: 0, committed: 0 };
    return {
      variantId: item.variantId,
      sku: item.sku,
      name: item.name,
      variantLabel: item.variantLabel ?? null,
      imageUrl: item.imageUrl ?? null,
      inStock: qty.inStock,
      committed: qty.committed,
      available: roundQty(qty.inStock - qty.committed),
      uom: item.uom?.trim() || displayStockUom(item.sku),
    };
  });
  return { ok: true, rows };
}
