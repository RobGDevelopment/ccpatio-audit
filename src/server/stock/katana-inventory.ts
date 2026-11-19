/**
 * Live Katana inventory aggregation for the GHL Current Inventory tab.
 * Single-flight cache: 60s fresh + 15m stale-while-revalidate; 429 backoff.
 */
import { katanaFetch, KatanaApiError, resolveLiveKatanaApiBase } from "@/lib/katana";
import { roundQty } from "@/lib/stock-display";

const PAGE_SIZE = 250;
const MAX_PAGES = 40;
const FRESH_TTL_MS = 60_000;
const STALE_TTL_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 25_000;

export type KatanaItemType =
  | "Product / Finished Good"
  | "Subassembly"
  | "Material / Fabric / Powder"
  | "Other";

export type KatanaInventoryRow = {
  variantId: number;
  sku: string;
  name: string;
  itemType: KatanaItemType;
  category: string | null;
  uom: string | null;
  locationId: number | null;
  locationName: string;
  inStock: number;
  committed: number;
  expected: number;
  available: number;
  deleted: boolean;
};

export type KatanaInventorySnapshot = {
  rows: KatanaInventoryRow[];
  syncedAt: string;
  stale: boolean;
  error: string | null;
};

type CacheEntry = {
  at: number;
  snapshot: KatanaInventorySnapshot;
  inflight: Promise<KatanaInventorySnapshot> | null;
};

let cache: CacheEntry | null = null;

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

async function listResource(
  path: "/materials" | "/products" | "/variants" | "/locations" | "/inventory",
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let previousFirstId: number | null = null;
  const baseUrl = resolveLiveKatanaApiBase();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await katanaFetch<unknown>(`${path}?limit=${PAGE_SIZE}&page=${page}`, {
      baseUrl,
    });
    const pageRows = listPayload(data);
    if (pageRows.length === 0) break;
    const firstId = Number(pageRows[0]?.id ?? pageRows[0]?.variant_id);
    if (page > 1 && firstId > 0 && firstId === previousFirstId) break;
    previousFirstId = firstId > 0 ? firstId : previousFirstId;
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) break;
  }
  return rows;
}

function classifyItemType(parent: Record<string, unknown>, sku: string): KatanaItemType {
  const type = String(parent.type ?? parent.item_type ?? "").toLowerCase();
  const isMaterial = parent.is_material === true || type === "material";
  const name = String(parent.name ?? "").toLowerCase();
  const upper = sku.toUpperCase();
  if (upper.startsWith("SA-") || upper.startsWith("ASM-") || /sub.?assembl/i.test(name) || type.includes("subassembl")) {
    return "Subassembly";
  }
  if (
    isMaterial ||
    upper.startsWith("FAB-") ||
    upper.startsWith("PWD-") ||
    upper.startsWith("MET-") ||
    type === "material"
  ) {
    return "Material / Fabric / Powder";
  }
  if (type === "product" || upper.startsWith("FIN-") || upper.startsWith("3P-")) {
    return "Product / Finished Good";
  }
  return "Other";
}

export function isDeletedRecord(record: Record<string, unknown> | null | undefined): boolean {
  if (!record) return true;
  const deletedAt = record.deleted_at;
  return deletedAt != null && String(deletedAt).trim() !== "";
}

export function aggregateInventoryQuantities(
  rows: ReadonlyArray<{
    variant_id?: unknown;
    location_id?: unknown;
    quantity_in_stock?: unknown;
    quantity_committed?: unknown;
    quantity_expected?: unknown;
    deleted_at?: unknown;
  }>,
): Map<
  string,
  { variantId: number; locationId: number | null; inStock: number; committed: number; expected: number }
> {
  const totals = new Map<
    string,
    { variantId: number; locationId: number | null; inStock: number; committed: number; expected: number }
  >();
  for (const row of rows) {
    if (isDeletedRecord(row as Record<string, unknown>)) continue;
    const variantId = Number(row.variant_id);
    if (!Number.isFinite(variantId) || variantId <= 0) continue;
    const locationId = Number(row.location_id);
    const loc = Number.isFinite(locationId) && locationId > 0 ? locationId : null;
    const key = `${variantId}:${loc ?? "all"}`;
    const prev = totals.get(key) ?? {
      variantId,
      locationId: loc,
      inStock: 0,
      committed: 0,
      expected: 0,
    };
    prev.inStock = roundQty(prev.inStock + Number(row.quantity_in_stock ?? 0));
    prev.committed = roundQty(prev.committed + Number(row.quantity_committed ?? 0));
    prev.expected = roundQty(prev.expected + Number(row.quantity_expected ?? 0));
    totals.set(key, prev);
  }
  return totals;
}

export function availableQty(inStock: number, committed: number): number {
  return roundQty(inStock - committed);
}

type TypeFilter = "all" | "finished" | "fabrics_powders" | "subassemblies_materials";

export function matchesTypeFilter(itemType: KatanaItemType, filter: TypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "finished") return itemType === "Product / Finished Good";
  if (filter === "fabrics_powders") {
    return itemType === "Material / Fabric / Powder";
  }
  return itemType === "Subassembly" || itemType === "Material / Fabric / Powder";
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function loadFreshSnapshot(): Promise<KatanaInventorySnapshot> {
  const [materials, products, locations, inventory] = await withTimeout(
    Promise.all([
      listResource("/materials"),
      listResource("/products").catch(() => [] as Record<string, unknown>[]),
      listResource("/locations").catch(() => [] as Record<string, unknown>[]),
      listResource("/inventory"),
    ]),
    FETCH_TIMEOUT_MS,
    "Katana inventory sync",
  );

  const locationNames = new Map<number, string>();
  for (const loc of locations) {
    if (isDeletedRecord(loc)) continue;
    const id = Number(loc.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    locationNames.set(id, String(loc.name ?? loc.display_name ?? `Location ${id}`).trim() || `Location ${id}`);
  }

  const variantMeta = new Map<
    number,
    { sku: string; name: string; itemType: KatanaItemType; category: string | null; uom: string | null }
  >();

  for (const parent of [...materials, ...products]) {
    if (isDeletedRecord(parent)) continue;
    const parentName = String(parent.name ?? "").trim();
    const category =
      typeof parent.category_name === "string"
        ? parent.category_name
        : typeof parent.category === "string"
          ? parent.category
          : null;
    const parentUom = typeof parent.uom === "string" ? parent.uom : null;
    const variants = Array.isArray(parent.variants) ? parent.variants : [];
    for (const variant of variants) {
      const record = asRecord(variant);
      if (!record || isDeletedRecord(record)) continue;
      const variantId = Number(record.id);
      const sku = String(record.sku ?? "").trim().toUpperCase();
      if (!Number.isFinite(variantId) || variantId <= 0 || !sku) continue;
      const uom =
        (typeof record.uom === "string" && record.uom.trim()) || parentUom || null;
      variantMeta.set(variantId, {
        sku,
        name: parentName || sku,
        itemType: classifyItemType(parent, sku),
        category,
        uom,
      });
    }
  }

  // Standalone /variants fill gaps when parents omit nested variants.
  try {
    const variants = await listResource("/variants");
    for (const record of variants) {
      if (isDeletedRecord(record)) continue;
      const variantId = Number(record.id);
      const sku = String(record.sku ?? "").trim().toUpperCase();
      if (!Number.isFinite(variantId) || variantId <= 0 || !sku) continue;
      if (variantMeta.has(variantId)) continue;
      const parent = asRecord(record.product) ?? asRecord(record.material) ?? {};
      variantMeta.set(variantId, {
        sku,
        name: String(record.name ?? parent.name ?? sku).trim() || sku,
        itemType: classifyItemType(parent, sku),
        category:
          typeof parent.category_name === "string"
            ? parent.category_name
            : typeof record.category_name === "string"
              ? record.category_name
              : null,
        uom: typeof record.uom === "string" ? record.uom : null,
      });
    }
  } catch {
    // variants endpoint optional when parents already nested them
  }

  const qty = aggregateInventoryQuantities(inventory);
  const rows: KatanaInventoryRow[] = [];
  for (const entry of qty.values()) {
    const meta = variantMeta.get(entry.variantId);
    if (!meta) continue;
    rows.push({
      variantId: entry.variantId,
      sku: meta.sku,
      name: meta.name,
      itemType: meta.itemType,
      category: meta.category,
      uom: meta.uom,
      locationId: entry.locationId,
      locationName:
        entry.locationId != null
          ? locationNames.get(entry.locationId) ?? `Location ${entry.locationId}`
          : "All Locations",
      inStock: entry.inStock,
      committed: entry.committed,
      expected: entry.expected,
      available: availableQty(entry.inStock, entry.committed),
      deleted: false,
    });
  }

  rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.sku.localeCompare(b.sku) ||
      a.locationName.localeCompare(b.locationName),
  );

  return {
    rows,
    syncedAt: new Date().toISOString(),
    stale: false,
    error: null,
  };
}

/**
 * Single-flight inventory read with fresh/stale TTLs.
 * `force` bypasses fresh TTL but still collapses concurrent refreshers.
 */
export async function getKatanaInventorySnapshot(options?: {
  force?: boolean;
}): Promise<KatanaInventorySnapshot> {
  const force = options?.force === true;
  const now = Date.now();

  if (cache) {
    const age = now - cache.at;
    if (!force && age < FRESH_TTL_MS) {
      return { ...cache.snapshot, stale: false, error: null };
    }
    if (cache.inflight) {
      try {
        return await cache.inflight;
      } catch (err) {
        if (age < STALE_TTL_MS) {
          return {
            ...cache.snapshot,
            stale: true,
            error: err instanceof Error ? err.message : "Katana refresh failed; showing cached stock.",
          };
        }
        throw err;
      }
    }
    if (!force && age < STALE_TTL_MS) {
      // SWR: return stale immediately and refresh in background.
      const inflight = loadFreshSnapshot()
        .then((snapshot) => {
          cache = { at: Date.now(), snapshot, inflight: null };
          return snapshot;
        })
        .catch((err) => {
          if (cache) cache.inflight = null;
          throw err;
        });
      cache.inflight = inflight;
      return {
        ...cache.snapshot,
        stale: true,
        error: null,
      };
    }
  }

  if (cache?.inflight) {
    return cache.inflight;
  }

  const inflight = loadFreshSnapshot()
    .then((snapshot) => {
      cache = { at: Date.now(), snapshot, inflight: null };
      return snapshot;
    })
    .catch((err) => {
      if (cache) {
        cache.inflight = null;
        const age = Date.now() - cache.at;
        if (age < STALE_TTL_MS) {
          const message =
            err instanceof KatanaApiError && err.status === 429
              ? "Katana rate-limited (429). Showing last synced stock."
              : err instanceof Error
                ? err.message
                : "Katana sync failed.";
          return {
            ...cache.snapshot,
            stale: true,
            error: message,
          };
        }
      }
      throw err;
    });

  cache = cache
    ? { ...cache, inflight }
    : {
        at: 0,
        snapshot: { rows: [], syncedAt: new Date(0).toISOString(), stale: true, error: null },
        inflight,
      };

  return inflight;
}

/** Test helper — clears the module cache. */
export function __resetKatanaInventoryCacheForTests(): void {
  cache = null;
}

export const KATANA_INVENTORY_CACHE = {
  FRESH_TTL_MS,
  STALE_TTL_MS,
  FETCH_TIMEOUT_MS,
} as const;
