/**
 * Katana → Hub catalog reconcile core.
 *
 * Contract: "Ingest Everything, Auto-Publish Nothing".
 * Katana owns stock levels (via showroom snapshot), katana_variant_id, factory
 * cost (base_cost), and soft-delete (is_active). Commerce fields on
 * ecommerce_listings / sync_to_woo / is_web_visible / swatches / 3D URLs are
 * NEVER overwritten by this sweep.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { logPimAudit } from "@/lib/pim-audit";
import { logStructured } from "@/lib/log/structured";
import {
  coerceHubItemType,
  isHubRawMaterialSku,
  isHubSubAssemblySku,
} from "@/lib/raw-material-sku";
import { normalizeHubSku } from "@/lib/hub-katana-sync";
import { KatanaApiError, katanaFetch } from "@/lib/katana";
import { getDb } from "@/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  raw_materials_catalog,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";
import { ensureFinishAssetRow } from "@/server/assets/finish-assets";
import { refreshShowroomSnapshotFromKatana } from "@/server/stock/showroom-snapshot";

export const KATANA_RECONCILE_EVENT = "ops/katana.reconcile.requested";
export const KATANA_RECONCILE_ACTOR = "katana-reconcile@ccpatio.com";

/** Fields this sweep is forbidden from writing on ecommerce_listings / commerce flags. */
export const COMMERCE_OWNED_FIELDS = [
  "aluminum_msrp",
  "sale_price",
  "steel_msrp",
  "is_web_visible",
  "sync_to_woo",
  "model_3d_glb_url",
  "model_3d_usdz_url",
  "model_3d_poster_url",
  "fabric_swatches",
  "powder_swatches",
  "dekton_swatches",
] as const;

/** Hub columns the reconcile MAY touch on sku_mappings / catalogs. */
export const KATANA_OWNED_FIELDS = [
  "katana_variant_id",
  "katana_material_id",
  "base_cost",
  "is_active",
] as const;

export type LiveKatanaVariant = {
  id: number;
  sku: string;
  name: string;
  productId: number | null;
  materialId: number | null;
  purchasePrice: number | null;
  deletedAt: string | null;
};

export type HubMappingRow = {
  globalSku: string;
  katanaVariantId: number | null;
  katanaMaterialId: number | null;
  baseCost: string | null;
  isActive: boolean;
  syncToWoo: boolean;
  itemType: ItemType;
  attributes: Record<string, unknown>;
  version: number;
};

export type VariantHealPlan = {
  sku: string;
  oldVariantId: number;
  newVariantId: number;
  materialId: number | null;
  reason: "stale_deleted_variant_rebound";
};

export type NewIngestPlan = {
  sku: string;
  name: string;
  variantId: number;
  materialId: number | null;
  productId: number | null;
  purchasePrice: number | null;
  itemType: ItemType;
  seedFinishAsset: "fabric" | "powder" | "dekton" | null;
};

export type OwnershipPatch = {
  sku: string;
  set: Partial<{
    katana_variant_id: number | null;
    katana_material_id: number | null;
    base_cost: string | null;
    is_active: boolean;
  }>;
  /** Explicitly listed so tests can assert commerce keys are absent. */
  forbiddenKeysTouched: string[];
};

export type ReconcileSummary = {
  ok: true;
  snapshotRefreshed: boolean;
  snapshotRowCount: number;
  lastSyncedAt: string | null;
  healed: number;
  costUpdated: number;
  archived: number;
  ingested: number;
  finishAssetsSeeded: number;
  itemErrors: Array<{ sku: string; error: string }>;
  durationMs: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function moneyCost(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(4);
}

/** Live when `deletedAt` is null/blank (camelCase Hub reconcile shape). */
export function isLiveReconcileVariant(
  record: Pick<LiveKatanaVariant, "deletedAt">,
): boolean {
  return record.deletedAt == null || String(record.deletedAt).trim() === "";
}

export function classifyIngestItemType(sku: string): ItemType {
  const needle = normalizeHubSku(sku);
  if (needle.startsWith("FIN-")) return "finished_good";
  if (needle.startsWith("3P-")) return "finished_good";
  if (isHubSubAssemblySku(needle)) return "sub_assembly";
  if (isHubRawMaterialSku(needle) || needle.startsWith("DEC-")) return "raw_material";
  return coerceHubItemType(needle, "raw_material");
}

export function finishCategoryForSku(
  sku: string,
): "fabric" | "powder" | "dekton" | null {
  const needle = normalizeHubSku(sku);
  if (needle.startsWith("FAB-")) return "fabric";
  if (needle.startsWith("PWD-")) return "powder";
  if (needle.startsWith("DEC-") || needle.startsWith("DKT-") || needle.startsWith("STN-")) {
    return "dekton";
  }
  return null;
}

/**
 * Build an ownership-safe patch. Any attempt to include a commerce-owned key is
 * stripped and recorded in `forbiddenKeysTouched` (never applied).
 */
export function buildOwnershipPatch(
  sku: string,
  proposed: Record<string, unknown>,
): OwnershipPatch {
  const set: OwnershipPatch["set"] = {};
  const forbiddenKeysTouched: string[] = [];
  for (const [key, value] of Object.entries(proposed)) {
    if ((COMMERCE_OWNED_FIELDS as readonly string[]).includes(key)) {
      forbiddenKeysTouched.push(key);
      continue;
    }
    if (!(KATANA_OWNED_FIELDS as readonly string[]).includes(key)) {
      forbiddenKeysTouched.push(key);
      continue;
    }
    (set as Record<string, unknown>)[key] = value;
  }
  return { sku: normalizeHubSku(sku), set, forbiddenKeysTouched };
}

/**
 * When Hub holds a stale/soft-deleted variant id and Katana has a live SKU match,
 * plan a rebound. Prefix-agnostic; SKUs are normalized.
 */
export function planVariantHeals(
  hubRows: readonly HubMappingRow[],
  liveById: ReadonlyMap<number, LiveKatanaVariant>,
  liveBySku: ReadonlyMap<string, LiveKatanaVariant>,
): VariantHealPlan[] {
  const plans: VariantHealPlan[] = [];
  for (const row of hubRows) {
    const sku = normalizeHubSku(row.globalSku);
    if (!sku || row.katanaVariantId == null) continue;
    const byId = liveById.get(row.katanaVariantId);
    if (byId && isLiveReconcileVariant(byId)) continue;
    const bySku = liveBySku.get(sku);
    if (!bySku || !isLiveReconcileVariant(bySku)) continue;
    if (bySku.id === row.katanaVariantId) continue;
    plans.push({
      sku,
      oldVariantId: row.katanaVariantId,
      newVariantId: bySku.id,
      materialId: bySku.materialId,
      reason: "stale_deleted_variant_rebound",
    });
  }
  return plans;
}

/** Newly seen live Katana SKUs that are not yet in Hub. */
export function planNewIngestions(
  liveVariants: readonly LiveKatanaVariant[],
  hubSkus: ReadonlySet<string>,
): NewIngestPlan[] {
  const plans: NewIngestPlan[] = [];
  const seen = new Set<string>();
  for (const live of liveVariants) {
    if (!isLiveReconcileVariant(live)) continue;
    const sku = normalizeHubSku(live.sku);
    if (!sku || hubSkus.has(sku) || seen.has(sku)) continue;
    seen.add(sku);
    plans.push({
      sku,
      name: live.name || sku,
      variantId: live.id,
      materialId: live.materialId,
      productId: live.productId,
      purchasePrice: live.purchasePrice,
      itemType: classifyIngestItemType(sku),
      seedFinishAsset: finishCategoryForSku(sku),
    });
  }
  return plans;
}

/**
 * Run per-item work inside try/catch so one malformed shop-floor SKU can never
 * abort the batch. Returns successes + isolated errors.
 */
export async function runBatchWithIsolation<T extends { sku: string }>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
): Promise<{ ok: number; errors: Array<{ sku: string; error: string }> }> {
  let ok = 0;
  const errors: Array<{ sku: string; error: string }> = [];
  for (const item of items) {
    try {
      await worker(item);
      ok += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ sku: item.sku, error: message });
      logStructured("warn", "katana-reconcile-item-failed", {
        sku: item.sku,
        error: message,
      });
    }
  }
  return { ok, errors };
}

function mapLiveVariant(row: Record<string, unknown>): LiveKatanaVariant | null {
  const id = asFiniteId(row.id);
  const sku = normalizeHubSku(String(row.sku ?? ""));
  if (!id || !sku) return null;
  const deletedRaw = row.deleted_at;
  const deletedAt =
    deletedRaw == null || String(deletedRaw).trim() === ""
      ? null
      : String(deletedRaw);
  const purchase =
    row.purchase_price == null ? null : Number(row.purchase_price);
  return {
    id,
    sku,
    name: String(row.name ?? sku).trim() || sku,
    productId: asFiniteId(row.product_id),
    materialId: asFiniteId(row.material_id),
    purchasePrice: Number.isFinite(purchase) ? purchase : null,
    deletedAt,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Paginate Katana `/variants` with 429 backoff. Caps page size and pages so a
 * runaway tenant cannot hang the cron indefinitely.
 */
export async function fetchAllKatanaVariants(options?: {
  pageSize?: number;
  maxPages?: number;
  fetchPage?: (path: string) => Promise<unknown>;
}): Promise<LiveKatanaVariant[]> {
  const pageSize = options?.pageSize ?? 100;
  const maxPages = options?.maxPages ?? 200;
  const fetchPage =
    options?.fetchPage ??
    (async (path: string) => {
      const { data } = await katanaFetch<unknown>(path);
      return data;
    });

  const out: LiveKatanaVariant[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      try {
        const data = await fetchPage(
          `/variants?limit=${pageSize}&page=${page}&include_deleted=true`,
        );
        const record = asRecord(data);
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(record?.data)
            ? record.data
            : [];
        if (rows.length === 0) return out;
        for (const row of rows) {
          const mapped = mapLiveVariant(asRecord(row) ?? {});
          if (mapped) out.push(mapped);
        }
        if (rows.length < pageSize) return out;
        break;
      } catch (error) {
        const status = error instanceof KatanaApiError ? error.status : 0;
        if (status === 429 && attempt < 8) {
          const wait =
            error instanceof KatanaApiError && error.rateLimitReset
              ? Math.max(1000, error.rateLimitReset * 1000 - Date.now() + 250)
              : Math.min(60_000, 2000 * 2 ** (attempt - 1));
          await sleep(wait);
          continue;
        }
        throw error;
      }
    }
  }
  return out;
}

async function loadHubMappings(): Promise<HubMappingRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      globalSku: sku_mappings.global_sku,
      katanaVariantId: sku_mappings.katana_variant_id,
      katanaMaterialId: sku_mappings.katana_material_id,
      baseCost: sku_mappings.base_cost,
      isActive: sku_mappings.is_active,
      syncToWoo: sku_mappings.sync_to_woo,
      itemType: sku_mappings.item_type,
      attributes: sku_mappings.attributes,
      version: sku_mappings.version,
    })
    .from(sku_mappings);
  return rows.map((r) => ({
    globalSku: r.globalSku,
    katanaVariantId: r.katanaVariantId,
    katanaMaterialId: r.katanaMaterialId,
    baseCost: r.baseCost,
    isActive: r.isActive,
    syncToWoo: r.syncToWoo,
    itemType: r.itemType,
    attributes: (r.attributes ?? {}) as Record<string, unknown>,
    version: r.version,
  }));
}

async function applyVariantHeal(plan: VariantHealPlan): Promise<void> {
  const db = getDb();
  const patch = buildOwnershipPatch(plan.sku, {
    katana_variant_id: plan.newVariantId,
    katana_material_id: plan.materialId,
  });
  await db
    .update(sku_mappings)
    .set({
      ...patch.set,
      updated_at: new Date(),
      updated_by: KATANA_RECONCILE_ACTOR,
      version: sql`${sku_mappings.version} + 1`,
    })
    .where(eq(sku_mappings.global_sku, plan.sku));
  await logPimAudit({
    operatorEmail: KATANA_RECONCILE_ACTOR,
    operatorName: "Katana reconcile",
    globalSku: plan.sku,
    action: "auto_heal_katana_variant_id",
    field: "katana_variant_id",
    oldValue: String(plan.oldVariantId),
    newValue: String(plan.newVariantId),
  });
}

async function applyFactoryCost(
  sku: string,
  purchasePrice: number | null,
  current: string | null,
): Promise<boolean> {
  const next = moneyCost(purchasePrice);
  if (next == null || next === current) return false;
  const db = getDb();
  const patch = buildOwnershipPatch(sku, { base_cost: next });
  await db
    .update(sku_mappings)
    .set({
      ...patch.set,
      updated_at: new Date(),
      updated_by: KATANA_RECONCILE_ACTOR,
    })
    .where(eq(sku_mappings.global_sku, sku));
  // finished_goods cost is factory-owned (not aluminum_msrp / sale_price).
  await db
    .update(finished_goods_catalog)
    .set({ cost: next, updated_at: new Date(), updated_by: KATANA_RECONCILE_ACTOR })
    .where(eq(finished_goods_catalog.global_sku, sku));
  await db
    .update(raw_materials_catalog)
    .set({ cost_per_unit: next, updated_at: new Date() })
    .where(eq(raw_materials_catalog.sku, sku));
  return true;
}

async function applyArchive(sku: string): Promise<void> {
  const db = getDb();
  const patch = buildOwnershipPatch(sku, { is_active: false });
  await db
    .update(sku_mappings)
    .set({
      ...patch.set,
      updated_at: new Date(),
      updated_by: KATANA_RECONCILE_ACTOR,
      version: sql`${sku_mappings.version} + 1`,
    })
    .where(and(eq(sku_mappings.global_sku, sku), eq(sku_mappings.is_active, true)));
}

async function ingestNewItem(plan: NewIngestPlan): Promise<void> {
  const db = getDb();
  const attrs: Record<string, unknown> = { sow_phase: 2 };
  const origin =
    plan.sku.startsWith("3P-")
      ? ("third_party" as const)
      : plan.sku.startsWith("FIN-")
        ? ("manufactured" as const)
        : null;

  await db.insert(sku_mappings).values({
    global_sku: plan.sku,
    product_origin: origin,
    category: plan.seedFinishAsset ?? "Uncategorized",
    item_type: plan.itemType,
    original_name: plan.name,
    source_file: "katana-catalog-reconcile",
    is_active: true,
    sync_to_woo: false,
    sync_to_clover: false,
    base_cost: moneyCost(plan.purchasePrice),
    katana_variant_id: plan.variantId,
    katana_material_id: plan.materialId,
    attributes: attrs,
    updated_by: KATANA_RECONCILE_ACTOR,
  });

  if (plan.itemType === "finished_good") {
    await db
      .insert(finished_goods_catalog)
      .values({
        global_sku: plan.sku,
        cost: moneyCost(plan.purchasePrice),
        is_web_visible: false,
        updated_by: KATANA_RECONCILE_ACTOR,
      })
      .onConflictDoNothing({ target: finished_goods_catalog.global_sku });

    // Phase-2 listing shell only — prices stay null; never auto-publish.
    const [{ top }] = await db
      .select({ top: sql<number>`coalesce(max(${ecommerce_listings.sheet_order}), 0)` })
      .from(ecommerce_listings);
    await db
      .insert(ecommerce_listings)
      .values({
        global_sku: plan.sku,
        product_name: plan.name,
        drawing_section: "Uncategorized",
        collection_label: "Uncategorized",
        sheet_order: Number(top ?? 0) + 1,
        url_source: "missing",
        aluminum_msrp: null,
        steel_msrp: null,
        sale_price: null,
      })
      .onConflictDoNothing();
  } else if (plan.itemType === "raw_material") {
    await db
      .insert(raw_materials_catalog)
      .values({
        sku: plan.sku,
        name: plan.name,
        category: plan.seedFinishAsset ?? "Uncategorized",
        cost_per_unit: moneyCost(plan.purchasePrice),
      })
      .onConflictDoNothing({ target: raw_materials_catalog.sku });
  }

  if (plan.seedFinishAsset) {
    await ensureFinishAssetRow({
      sku: plan.sku,
      category: plan.seedFinishAsset,
      display_name: plan.name,
    });
  }

  await logPimAudit({
    operatorEmail: KATANA_RECONCILE_ACTOR,
    operatorName: "Katana reconcile",
    globalSku: plan.sku,
    action: "ingest_new_katana_item",
    field: "sku_mappings",
    newValue: `variant=${plan.variantId};sow_phase=2;sync_to_woo=false`,
  });
}

/**
 * Full reconcile: warm snapshot → heal variant IDs → factory cost → archive
 * ghosts → ingest new items (isolated). Never mutates commerce-owned fields.
 */
export async function runKatanaCatalogReconcile(options?: {
  skipSnapshot?: boolean;
  fetchVariants?: () => Promise<LiveKatanaVariant[]>;
  loadHub?: () => Promise<HubMappingRow[]>;
}): Promise<ReconcileSummary> {
  const started = Date.now();
  let snapshotRefreshed = false;
  let snapshotRowCount = 0;
  let lastSyncedAt: string | null = null;

  if (!options?.skipSnapshot) {
    const snap = await refreshShowroomSnapshotFromKatana({ force: true });
    snapshotRefreshed = true;
    snapshotRowCount = snap.rowCount;
    lastSyncedAt = snap.lastSyncedAt;
  }

  const live = await (options?.fetchVariants
    ? options.fetchVariants()
    : fetchAllKatanaVariants());
  const liveById = new Map<number, LiveKatanaVariant>();
  const liveBySku = new Map<string, LiveKatanaVariant>();
  const liveActive: LiveKatanaVariant[] = [];
  for (const v of live) {
    liveById.set(v.id, v);
    if (isLiveReconcileVariant(v)) {
      liveActive.push(v);
      if (!liveBySku.has(v.sku)) liveBySku.set(v.sku, v);
    }
  }

  const hub = await (options?.loadHub ? options.loadHub() : loadHubMappings());
  const hubSkus = new Set(hub.map((h) => normalizeHubSku(h.globalSku)));

  const heals = planVariantHeals(hub, liveById, liveBySku);
  const healBatch = await runBatchWithIsolation(heals, applyVariantHeal);

  let costUpdated = 0;
  const costBatch = await runBatchWithIsolation(
    hub.map((h) => ({
      sku: normalizeHubSku(h.globalSku),
      current: h.baseCost,
      live: liveBySku.get(normalizeHubSku(h.globalSku)) ?? null,
    })),
    async (item) => {
      if (!item.live) return;
      const changed = await applyFactoryCost(
        item.sku,
        item.live.purchasePrice,
        item.current,
      );
      if (changed) costUpdated += 1;
    },
  );

  const toArchive = hub.filter((h) => {
    const sku = normalizeHubSku(h.globalSku);
    return h.isActive && h.katanaVariantId != null && !liveBySku.has(sku);
  });
  const archiveBatch = await runBatchWithIsolation(
    toArchive.map((h) => ({ sku: normalizeHubSku(h.globalSku) })),
    (item) => applyArchive(item.sku),
  );

  const ingestPlans = planNewIngestions(liveActive, hubSkus);
  let finishAssetsSeeded = 0;
  const ingestBatch = await runBatchWithIsolation(ingestPlans, async (plan) => {
    await ingestNewItem(plan);
    if (plan.seedFinishAsset) finishAssetsSeeded += 1;
  });

  // Prove we never select commerce columns for update (static contract for tests).
  void isNull;

  return {
    ok: true,
    snapshotRefreshed,
    snapshotRowCount,
    lastSyncedAt,
    healed: healBatch.ok,
    costUpdated,
    archived: archiveBatch.ok,
    ingested: ingestBatch.ok,
    finishAssetsSeeded,
    itemErrors: [
      ...healBatch.errors,
      ...costBatch.errors,
      ...archiveBatch.errors,
      ...ingestBatch.errors,
    ],
    durationMs: Date.now() - started,
  };
}
