/**
 * CPU-bound sales curation over Hub `katana_showroom_snapshot` rows + active holds.
 * Zero live Katana HTTP. Zero ecommerce listing table reads.
 */
import { displayStockUom } from "@/lib/hold-quantity";
import { roundQty, type StockRow } from "@/lib/stock-display";
import type { KatanaInventoryRow } from "@/server/stock/katana-inventory";

export const SHOWROOM_SALES_TABS = [
  "floor_ready",
  "third_party",
  "fabrics",
  "dekton",
  "mto_catalog",
  "active_holds",
] as const;

export type ShowroomSalesTab = (typeof SHOWROOM_SALES_TABS)[number];

export const SHOWROOM_SALES_TAB_LABELS: Record<ShowroomSalesTab, string> = {
  floor_ready: "Floor & Ready-to-Ship",
  third_party: "3rd-Party Retail",
  fabrics: "Fabrics",
  dekton: "Dekton Slabs",
  mto_catalog: "Make-to-Order Catalog",
  active_holds: "Active Customer Holds",
};

/** Option A visible order — Fabrics is the default selected tab on load. */
export const SHOWROOM_DEFAULT_SALES_TAB: ShowroomSalesTab = "fabrics";

export const SHOWROOM_PRIMARY_SALES_TABS: readonly ShowroomSalesTab[] = [
  "fabrics",
  "dekton",
  "third_party",
  "floor_ready",
  "active_holds",
] as const;

/** Tabs rendered in the sales embed; MTO stays last and only when flagged on. */
export function visibleShowroomSalesTabs(enableMtoCatalog: boolean): ShowroomSalesTab[] {
  return enableMtoCatalog
    ? [...SHOWROOM_PRIMARY_SALES_TABS, "mto_catalog"]
    : [...SHOWROOM_PRIMARY_SALES_TABS];
}

/** Tabs that default to in-stock-only (0-stock MTO shells hidden unless toggled). */
export const IN_STOCK_DEFAULT_TABS: ReadonlySet<ShowroomSalesTab> = new Set([
  "floor_ready",
  "third_party",
  "fabrics",
  "dekton",
]);

export type WarehouseBadgeKey = "scottsdale" | "solana" | "factory";

export const WAREHOUSE_BADGE_LABELS: Record<WarehouseBadgeKey, string> = {
  scottsdale: "Scottsdale",
  solana: "Solana",
  factory: "Factory",
};

export const FACTORY_LOCATION_ID = 98179;

export type WarehouseQty = {
  key: WarehouseBadgeKey;
  label: string;
  locationName: string;
  inStock: number;
  committed: number;
  expected: number;
  available: number;
};

export type SalesHoldBadge = {
  id: string;
  qty: number;
  salesperson: string;
  opportunityName: string;
  expiresAt: string;
};

export type SalesStockCard = StockRow & {
  warehouses: WarehouseQty[];
  heldQty: number;
  holdBadges: SalesHoldBadge[];
  salesTab: ShowroomSalesTab | null;
  /** True when an active hold keeps a 0-stock Dekton row visible. */
  forceVisibleDueToHold: boolean;
};

export type ActiveHoldInput = {
  id: string;
  variantId: number;
  sku: string;
  qty: string | number;
  salesperson: string;
  opportunityName: string;
  note?: string;
  expiresAt: string | Date;
  orderNo?: string;
  createdAt?: string | Date | null;
};

export type ProjectShowroomSalesInput = {
  rows: readonly KatanaInventoryRow[];
  holds?: readonly ActiveHoldInput[];
  /** Snapshot last_synced_at — pending holds created after this may need local subtract. */
  lastSyncedAt?: string | Date | null;
  tab?: ShowroomSalesTab | null;
  inStockOnly?: boolean;
  query?: string;
};

const SHOP_FLOOR_PREFIXES = ["MET-", "ASM-", "SA-"] as const;

const THIRD_PARTY_CATEGORY_HINTS = [
  "tenjam",
  "umbrella",
  "umbrellas",
  "cabana",
  "flexy",
  "marina",
  "fire glass",
  "firepit accessory",
  "fire pit accessory",
  "fire pits",
  "fire pit",
  "cushion sets",
  "purchased",
  "resale",
  "kindle",
  "hpc",
];

const MTO_COLLECTIONS = [
  "bravada",
  "brooklyn",
  "ocean",
  "milan",
  "taylor",
  "daisy",
  "waterfall",
  "dining tables",
];

/**
 * Internal job placeholders + custom customer one-offs — never sellable floor stock.
 * FIN-JOB-*, JOB - *, FIN-SRV-*, FIN-CUS-*, *- CUSTOMER FABRIC.
 */
export function isInternalJobOrOneOff(sku: string, name?: string | null): boolean {
  const upper = sku.trim().toUpperCase();
  const nm = (name ?? "").trim().toUpperCase();
  if (
    upper.startsWith("FIN-JOB-") ||
    upper.startsWith("FIN-SRV-") ||
    upper.startsWith("FIN-CUS-")
  ) {
    return true;
  }
  if (/^JOB\s*-/.test(nm) || nm.includes("JOB - NEW BUILD") || nm.includes("JOB - OTHER") ||
      nm.includes("JOB - SERVICE") || nm.includes("JOB - MATERIALS")) {
    return true;
  }
  if (nm.includes("- CUSTOMER FABRIC") || nm.endsWith("CUSTOMER FABRIC")) return true;
  return false;
}

/** Raw firepit pans/burners that are not retail-facing Tenjam/HPC/Kindle goods. */
export function isNonRetailFirepitComponent(
  sku: string,
  category?: string | null,
  name?: string | null,
): boolean {
  const upper = sku.trim().toUpperCase();
  if (
    upper.startsWith("3P-") ||
    upper.startsWith("TJM-") ||
    upper.startsWith("FIN-TJM") ||
    upper.startsWith("FIN-HPC-") ||
    upper.startsWith("FIN-CAN-") ||
    upper.startsWith("FIN-MLN-UMB") ||
    upper.startsWith("FIN-CAB-") ||
    upper.startsWith("FIN-FLX-") ||
    upper.startsWith("FIN-MAR-")
  ) {
    return false;
  }
  const nm = (name ?? "").toLowerCase();
  const cat = (category ?? "").toLowerCase();
  const looksLikeComponent =
    /\bburner\b|\bfirepit pan\b|\bfire pit pan\b|\bbuild (kit|component)\b|\bpit pan\b/.test(nm) ||
    ((cat.includes("fire pit") || cat.includes("firepit")) &&
      /\bpan\b|\bburner\b|\bcomponent\b/.test(nm));
  if (!looksLikeComponent) return false;
  if (SHOP_FLOOR_PREFIXES.some((p) => upper.startsWith(p))) return true;
  if (upper.startsWith("RM-") || upper.startsWith("PWD-") || upper.startsWith("HW-")) return true;
  if (!upper.startsWith("FIN-") && !upper.startsWith("3P-")) return true;
  // FIN-* without retail brand cues that are clearly build pans/burners
  if (upper.startsWith("FIN-") && !/\btenjam\b|\bkindle\b|\bhpc\b|\bumbrella\b|\bcabana\b/.test(nm)) {
    return /\bburner\b|\bpan\b/.test(nm);
  }
  return false;
}

/** Strict shop-floor exclusion — never show these on sales embed. */
export function isShopFloorExcluded(sku: string, category?: string | null, name?: string | null): boolean {
  const upper = sku.trim().toUpperCase();
  if (!upper) return true;
  if (SHOP_FLOOR_PREFIXES.some((p) => upper.startsWith(p))) return true;
  // Bulk powder drums (PWD-*), not retail-facing fabrics.
  if (upper.startsWith("PWD-")) return true;
  // Packaging / hardware / consumables by SKU heuristics.
  if (
    upper.startsWith("PKG-") ||
    upper.startsWith("HW-") ||
    upper.startsWith("HWARE-") ||
    upper.startsWith("RM-") ||
    upper.startsWith("FOAM-") ||
    upper.startsWith("WD-")
  ) {
    return true;
  }
  if (isInternalJobOrOneOff(sku, name)) return true;
  if (isNonRetailFirepitComponent(sku, category, name)) return true;
  const cat = (category ?? "").trim().toLowerCase();
  const excludedCats = [
    "metal",
    "powder",
    "packaging",
    "hardware",
    "consumables",
    "sub-assembly",
    "subassembly",
    "wood",
    "foam",
    "tubing",
    "fasteners",
    "weldment",
    "raw material",
    "raw materials",
    "metal - steel",
    "metal - hardware",
    "metal - shop supplies",
    "cushion - parts",
    "shop - delivery",
  ];
  if (excludedCats.some((c) => cat === c || cat.startsWith(c))) return true;
  const nm = (name ?? "").toLowerCase();
  if (/\bweldment\b|\bshop supply\b|\bpackaging\b|\bhardware\b/.test(nm) && !upper.startsWith("FIN-")) {
    return true;
  }
  return false;
}

/** FAB-* / Cushion - Fabric ONLY — never MET-* or powders. */
export function isSalesFabric(sku: string, category?: string | null): boolean {
  const upper = sku.trim().toUpperCase();
  if (upper.startsWith("MET-") || upper.startsWith("PWD-") || upper.startsWith("ASM-") || upper.startsWith("SA-")) {
    return false;
  }
  if (upper.startsWith("FAB-")) return true;
  const cat = (category ?? "").trim().toLowerCase();
  return cat === "cushion - fabric" || cat === "fabric" || cat === "fabrics";
}

/**
 * Genuine stone/slab materials only — STN-DKT-*, DEC-*, or material rows in Dekton - Slabs.
 * Never classify finished furniture/pavilions that merely mention stone/Dekton.
 */
export function isDektonSku(
  sku: string,
  category?: string | null,
  name?: string | null,
  itemType?: string | null,
): boolean {
  const upper = sku.trim().toUpperCase();
  if (upper.startsWith("FIN-")) return false;
  if (upper.startsWith("STN-DKT-") || upper.startsWith("DEC-")) return true;
  const cat = (category ?? "").trim().toLowerCase();
  const t = (itemType ?? "").toLowerCase();
  const dektonCategory =
    cat === "dekton - slabs" || cat === "dekton" || cat.startsWith("dekton -");
  if (!dektonCategory) return false;
  if (t.includes("product") || t.includes("finished")) return false;
  return t.includes("material") || t === "" || t.includes("other");
}

export function isFinishedFloorSku(
  sku: string,
  itemType?: string | null,
  name?: string | null,
): boolean {
  const upper = sku.trim().toUpperCase();
  if (!upper.startsWith("FIN-")) return false;
  if (isInternalJobOrOneOff(sku, name)) return false;
  if (isThirdPartySku(sku, null, name)) return false;
  const t = (itemType ?? "").toLowerCase();
  if (t.includes("subassembl")) return false;
  return true;
}

export function isThirdPartySku(
  sku: string,
  category?: string | null,
  name?: string | null,
): boolean {
  const upper = sku.trim().toUpperCase();
  if (upper.startsWith("3P-") || upper.startsWith("TJM-") || upper.startsWith("FIN-TJM")) return true;
  if (upper.startsWith("FIN-CAN-") || upper.startsWith("FIN-MLN-UMB") || upper.includes("-UMB")) {
    return true;
  }
  if (upper.startsWith("FIN-CAB-") || upper.startsWith("FIN-FLX-") || upper.startsWith("FIN-MAR-")) {
    return true;
  }
  if (upper.startsWith("FIN-HPC-") || upper.includes("FIRE") && upper.startsWith("FIN-")) {
    // Narrow: only when category/name confirms retail fire goods.
  }
  const cat = (category ?? "").trim().toLowerCase();
  if (THIRD_PARTY_CATEGORY_HINTS.some((h) => cat === h || cat.includes(h))) return true;
  const nm = (name ?? "").toLowerCase();
  if (/\btenjam\b|\bkindle\b|\bcabana\b|\bflexy\b|\bmarina\b|\bhpc\b|\bumbrella\b/.test(nm)) {
    return true;
  }
  if (/\bpurchased\b|\bresale\b/.test(cat) || /\bpurchased\b|\bresale\b/.test(nm)) return true;
  return false;
}

export function isMtoCatalogSku(sku: string, name?: string | null, category?: string | null): boolean {
  const upper = sku.trim().toUpperCase();
  if (!upper.startsWith("FIN-")) return false;
  if (isThirdPartySku(sku, category, name)) return false;
  if (isDektonSku(sku, category, name)) return false;
  const nm = (name ?? "").toLowerCase();
  const cat = (category ?? "").toLowerCase();
  for (const label of MTO_COLLECTIONS) {
    if (nm.includes(label) || cat.includes(label)) return true;
  }
  // Collection codes in SKU: BRV, BRK, OCN, MLN, TAY, DSY, WFT
  return /FIN-(BRV|BRK|OCN|MLN|TAY|DSY|WFT)-/.test(upper);
}

export function classifySalesTab(
  row: Pick<KatanaInventoryRow, "sku" | "name" | "category" | "itemType">,
): ShowroomSalesTab | null {
  if (isShopFloorExcluded(row.sku, row.category, row.name)) return null;
  if (isSalesFabric(row.sku, row.category) && !row.sku.toUpperCase().startsWith("MET-")) {
    return "fabrics";
  }
  if (isDektonSku(row.sku, row.category, row.name, row.itemType)) return "dekton";
  if (isThirdPartySku(row.sku, row.category, row.name)) return "third_party";
  if (isFinishedFloorSku(row.sku, row.itemType, row.name)) {
    // In-stock floor items vs full MTO browse is decided by tab filter + stock,
    // but classification prefers floor_ready for FIN-* finished goods.
    return "floor_ready";
  }
  if (isMtoCatalogSku(row.sku, row.name, row.category)) return "mto_catalog";
  return null;
}

export function normalizeWarehouseKey(
  locationName: string | null | undefined,
  locationId?: number | null,
): WarehouseBadgeKey | null {
  if (locationId === FACTORY_LOCATION_ID) return "factory";
  const name = (locationName ?? "").trim().toLowerCase();
  if (!name) return null;
  if (name.includes("scott")) return "scottsdale";
  if (name.includes("solana")) return "solana";
  if (name.includes("factory") || name.includes("manufactur") || name.includes("cc manuf")) {
    return "factory";
  }
  return null;
}

function holdQty(h: ActiveHoldInput): number {
  const n = Number(h.qty);
  return Number.isFinite(n) ? n : 0;
}

function asIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}

/**
 * Pending holds created AFTER last sync are not yet in Katana `committed`.
 * Only those should reduce displayed available. Synced holds already live in committed.
 */
export function pendingHoldQtyForVariant(
  holds: readonly ActiveHoldInput[],
  variantId: number,
  lastSyncedAt?: string | Date | null,
): number {
  const syncedMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : NaN;
  let pending = 0;
  for (const h of holds) {
    if (h.variantId !== variantId) continue;
    const created = h.createdAt ? new Date(h.createdAt).getTime() : NaN;
    if (Number.isFinite(syncedMs) && Number.isFinite(created) && created > syncedMs) {
      pending = roundQty(pending + holdQty(h));
    }
  }
  return pending;
}

function fuzzyIncludes(value: string, needle: string): boolean {
  const haystack = value.toLowerCase();
  if (haystack.includes(needle)) return true;
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

/** Roll 3 warehouse rows → 1 card per variant_id/SKU with location pills. */
export function projectShowroomSalesView(
  input: ProjectShowroomSalesInput,
): SalesStockCard[] {
  const holds = input.holds ?? [];
  const holdsByVariant = new Map<number, ActiveHoldInput[]>();
  for (const h of holds) {
    const list = holdsByVariant.get(h.variantId) ?? [];
    list.push(h);
    holdsByVariant.set(h.variantId, list);
  }

  type Acc = {
    variantId: number;
    sku: string;
    name: string;
    itemType: string | null;
    category: string | null;
    uom: string | null;
    warehouses: Map<WarehouseBadgeKey, WarehouseQty>;
    inStock: number;
    committed: number;
    expected: number;
  };

  const byVariant = new Map<number, Acc>();

  for (const row of input.rows) {
    if (row.deleted) continue;
    if (isShopFloorExcluded(row.sku, row.category, row.name)) continue;

    const tab = classifySalesTab(row);
    if (!tab && !(holdsByVariant.get(row.variantId)?.length)) continue;

    let acc = byVariant.get(row.variantId);
    if (!acc) {
      acc = {
        variantId: row.variantId,
        sku: row.sku,
        name: row.name,
        itemType: row.itemType,
        category: row.category,
        uom: row.uom,
        warehouses: new Map(),
        inStock: 0,
        committed: 0,
        expected: 0,
      };
      byVariant.set(row.variantId, acc);
    }

    acc.inStock = roundQty(acc.inStock + row.inStock);
    acc.committed = roundQty(acc.committed + row.committed);
    acc.expected = roundQty(acc.expected + row.expected);

    const wKey = normalizeWarehouseKey(row.locationName, row.locationId);
    if (wKey) {
      const prev = acc.warehouses.get(wKey) ?? {
        key: wKey,
        label: WAREHOUSE_BADGE_LABELS[wKey],
        locationName: row.locationName,
        inStock: 0,
        committed: 0,
        expected: 0,
        available: 0,
      };
      prev.inStock = roundQty(prev.inStock + row.inStock);
      prev.committed = roundQty(prev.committed + row.committed);
      prev.expected = roundQty(prev.expected + row.expected);
      prev.available = roundQty(prev.inStock - prev.committed);
      prev.locationName = row.locationName;
      acc.warehouses.set(wKey, prev);
    }
  }

  // Ensure active-hold SKUs appear even if shop-floor filter would drop them
  // (Dekton holds must always surface). Never resurrect MET-/ASM-/SA-/PWD-*.
  for (const h of holds) {
    if (byVariant.has(h.variantId)) continue;
    const upper = h.sku.trim().toUpperCase();
    if (isShopFloorExcluded(upper)) continue;
    const seed = input.rows.find((r) => r.variantId === h.variantId);
    byVariant.set(h.variantId, {
      variantId: h.variantId,
      sku: h.sku,
      name: seed?.name ?? h.sku,
      itemType: seed?.itemType ?? null,
      category: seed?.category ?? null,
      uom: displayStockUom(h.sku, seed?.uom),
      warehouses: new Map(),
      inStock: seed?.inStock ?? 0,
      committed: seed?.committed ?? 0,
      expected: seed?.expected ?? 0,
    });
  }

  const cards: SalesStockCard[] = [];
  for (const acc of byVariant.values()) {
    const variantHolds = holdsByVariant.get(acc.variantId) ?? [];
    const heldQty = roundQty(variantHolds.reduce((sum, h) => sum + holdQty(h), 0));
    const pending = pendingHoldQtyForVariant(variantHolds, acc.variantId, input.lastSyncedAt);
    const rawAvailable = roundQty(acc.inStock - acc.committed);
    const available = roundQty(rawAvailable - pending);
    const resolvedUom = displayStockUom(acc.sku, acc.uom);

    const salesTab =
      classifySalesTab({
        sku: acc.sku,
        name: acc.name,
        category: acc.category,
        itemType: (acc.itemType as KatanaInventoryRow["itemType"]) ?? "Other",
      }) ??
      (heldQty > 0 && isDektonSku(acc.sku, acc.category, acc.name, acc.itemType)
        ? "dekton"
        : null);

    const forceVisibleDueToHold = heldQty > 0;
    const holdBadges: SalesHoldBadge[] = variantHolds.map((h) => ({
      id: h.id,
      qty: holdQty(h),
      salesperson: h.salesperson,
      opportunityName: h.opportunityName,
      expiresAt: asIso(h.expiresAt) ?? "",
    }));

    const warehouseOrder: WarehouseBadgeKey[] = ["scottsdale", "solana", "factory"];
    const warehouses = warehouseOrder
      .map((k) => acc.warehouses.get(k))
      .filter((w): w is WarehouseQty => Boolean(w));

    cards.push({
      variantId: acc.variantId,
      sku: acc.sku,
      name: acc.name,
      variantLabel: null,
      inStock: acc.inStock,
      committed: acc.committed,
      expected: acc.expected,
      available,
      uom: resolvedUom,
      imageUrl: null,
      locationName: warehouses.map((w) => w.label).join(" · ") || null,
      itemType: acc.itemType,
      category: acc.category,
      warehouses,
      heldQty,
      holdBadges,
      salesTab,
      forceVisibleDueToHold,
    });
  }

  let filtered = cards;

  if (input.tab === "active_holds") {
    filtered = filtered.filter((c) => c.heldQty > 0);
  } else if (input.tab === "mto_catalog") {
    filtered = filtered.filter(
      (c) =>
        c.salesTab === "mto_catalog" ||
        c.salesTab === "floor_ready" ||
        isMtoCatalogSku(c.sku, c.name, c.category),
    );
  } else if (input.tab) {
    filtered = filtered.filter((c) => {
      if (c.salesTab === input.tab) return true;
      // Dekton with active holds always visible on Dekton tab.
      if (
        input.tab === "dekton" &&
        c.forceVisibleDueToHold &&
        isDektonSku(c.sku, c.category, c.name, c.itemType)
      ) {
        return true;
      }
      // Floor: genuine FIN-* with available > 0 OR an active hold (never job placeholders).
      if (input.tab === "floor_ready" && c.forceVisibleDueToHold && c.salesTab === "floor_ready") {
        return true;
      }
      return false;
    });
  } else {
    filtered = filtered.filter((c) => c.salesTab != null || c.heldQty > 0);
  }

  // Hard purge job/one-off placeholders from floor even if a hold somehow attached.
  if (input.tab === "floor_ready") {
    filtered = filtered.filter((c) => !isInternalJobOrOneOff(c.sku, c.name));
  }

  const inStockOnly = input.inStockOnly ?? false;
  if (inStockOnly) {
    filtered = filtered.filter((c) => c.available > 0 || c.forceVisibleDueToHold);
  }

  const needle = input.query?.trim().toLowerCase() ?? "";
  if (needle) {
    filtered = filtered.filter(
      (c) =>
        fuzzyIncludes(c.sku, needle) ||
        fuzzyIncludes(c.name, needle) ||
        fuzzyIncludes(c.category ?? "", needle),
    );
  }

  return filtered.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.sku.localeCompare(b.sku),
  );
}

/** Build Order Desk deep-link preserving embed auth params (never 401 in iframe). */
export function orderDeskMtoHref(input: {
  href?: string;
  embedToken?: string | null;
  embedKey?: string | null;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
  sku?: string | null;
}): string {
  const params = new URLSearchParams();
  try {
    if (input.href) {
      const url = new URL(input.href, "https://ccpatio.local");
      for (const [k, v] of url.searchParams) params.set(k, v);
    }
  } catch {
    // ignore bad href
  }
  if (input.embedToken) params.set("embedToken", input.embedToken);
  if (input.embedKey) params.set("embedKey", input.embedKey);
  if (input.ghlUserId) params.set("ghlUserId", input.ghlUserId);
  if (input.ghlUserEmail) params.set("ghlUserEmail", input.ghlUserEmail);
  if (input.sku) params.set("sku", input.sku);
  params.set("mto", "1");
  params.set("from", "showroom");
  const q = params.toString();
  return q ? `/embed/order-desk?${q}` : "/embed/order-desk";
}

/** Build Showroom deep-link preserving embed auth params (Order Desk → back). */
export function showroomBackHref(input: {
  href?: string;
  embedToken?: string | null;
  embedKey?: string | null;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): string {
  const params = new URLSearchParams();
  try {
    if (input.href) {
      const url = new URL(input.href, "https://ccpatio.local");
      for (const [k, v] of url.searchParams) {
        if (k === "from" || k === "mto" || k === "sku") continue;
        params.set(k, v);
      }
    }
  } catch {
    // ignore bad href
  }
  if (input.embedToken) params.set("embedToken", input.embedToken);
  if (input.embedKey) params.set("embedKey", input.embedKey);
  if (input.ghlUserId) params.set("ghlUserId", input.ghlUserId);
  if (input.ghlUserEmail) params.set("ghlUserEmail", input.ghlUserEmail);
  const q = params.toString();
  return q ? `/embed/showroom?${q}` : "/embed/showroom";
}
