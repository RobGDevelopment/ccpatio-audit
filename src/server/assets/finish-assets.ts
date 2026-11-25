import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  ecommerce_finish_assets,
  ecommerce_listings,
  sku_mappings,
  type EcommerceFinishAssetRow,
} from "@/server/db/schema";
import { getSupabaseUrl } from "@/lib/supabase-env";
import { PRODUCT_IMAGES_BUCKET } from "@/lib/supabase-storage";
import {
  PHASE1_DEKTONS,
  PHASE1_FABRICS,
  PHASE1_POWDERS,
} from "@/server/ecommerce/phase1-portal";
import {
  ECOMMERCE_32_FINISHES,
  ECOMMERCE_FINISH_DISABLED_SENTINEL,
  filterActiveEcommerceFinishes,
  isEcommerce32FinishSku,
} from "@/server/ecommerce/ecommerce-32-finish-roster";

export { PHASE1_DEKTONS };

export type FinishCategory = "fabric" | "powder" | "dekton";
export type FinishQualityStatus = "placeholder_lowres" | "photoshoot_verified";

/** Hex + label from the exact 32 e-commerce roster. */
const FINISH_META: Readonly<Record<string, { label: string; color: string }>> = Object.fromEntries(
  ECOMMERCE_32_FINISHES.map((f) => [f.sku, { label: f.displayName, color: f.hex }] as const),
);

/**
 * Public URL of the pre-existing low-res fabric swatch:
 * `{SUPABASE}/storage/v1/object/public/product-images/fabrics/{sku.lower}.jpg`.
 * The 24 FAB-* URLs are already referenced by Woo - this path must never change.
 */
export function fabricSwatchPublicUrl(sku: string): string {
  const base = (getSupabaseUrl() ?? "").replace(/\/$/, "");
  if (!base) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for fabric swatch hosting");
  }
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/fabrics/${sku.trim().toLowerCase()}.jpg`;
}

export function finishCategoryForSku(sku: string): FinishCategory | null {
  const upper = sku.trim().toUpperCase();
  if (upper.startsWith("FAB-")) return "fabric";
  if (upper.startsWith("PWD-")) return "powder";
  if (upper.startsWith("DEC-") || upper.startsWith("DKT-")) return "dekton";
  return null;
}

type SeedRow = {
  sku: string;
  finish_category: FinishCategory;
  display_name: string;
  hex_code: string | null;
  swatch_thumb_url: string | null;
  texture_2k_url: string | null;
};

export function buildFinishSeedRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const def of ECOMMERCE_32_FINISHES) {
    const meta = FINISH_META[def.sku];
    const fabricUrl =
      def.category === "fabric"
        ? (() => {
            try {
              return fabricSwatchPublicUrl(def.sku);
            } catch {
              return null;
            }
          })()
        : null;
    rows.push({
      sku: def.sku,
      finish_category: def.category,
      display_name: meta?.label ?? def.displayName,
      hex_code: meta?.color ?? def.hex,
      swatch_thumb_url: fabricUrl,
      texture_2k_url: fabricUrl,
    });
  }
  return rows;
}

export type SeedFinishAssetsResult = {
  attempted: number;
  inserted: number;
  existing: number;
  byCategory: Record<FinishCategory, number>;
};

/**
 * NON-DESTRUCTIVE seed. New rows are inserted (fabrics as `placeholder_lowres`, pointing at the
 * existing `fabrics/{sku.lower}.jpg`). On conflict ONLY empty (NULL / '') hex + URL fields are
 * filled; a non-empty `swatch_thumb_url` / `texture_2k_url`, `quality_status`, `display_name`,
 * `uploaded_by` and physical-scale fields are never overwritten.
 */
export async function seedEcommerceFinishAssets(): Promise<SeedFinishAssetsResult> {
  const db = getDb();
  const rows = buildFinishSeedRows();
  const t = ecommerce_finish_assets;
  const before = await db.select({ sku: t.sku }).from(t);
  const known = new Set(before.map((r) => r.sku));

  for (const row of rows) {
    await db
      .insert(t)
      .values({ ...row, quality_status: "placeholder_lowres" })
      .onConflictDoUpdate({
        target: t.sku,
        set: {
          hex_code: sql`COALESCE(NULLIF(${t.hex_code}, ''), excluded.hex_code)`,
          swatch_thumb_url: sql`COALESCE(NULLIF(${t.swatch_thumb_url}, ''), excluded.swatch_thumb_url)`,
          texture_2k_url: sql`COALESCE(NULLIF(${t.texture_2k_url}, ''), excluded.texture_2k_url)`,
        },
      });
  }

  const byCategory: Record<FinishCategory, number> = { fabric: 0, powder: 0, dekton: 0 };
  for (const r of rows) byCategory[r.finish_category] += 1;
  const inserted = rows.filter((r) => !known.has(r.sku)).length;
  return {
    attempted: rows.length,
    inserted,
    existing: rows.length - inserted,
    byCategory,
  };
}

export type FinishAssetFilter = {
  category?: FinishCategory;
  sku?: string;
  quality_status?: FinishQualityStatus;
};

export async function listFinishAssets(
  filter: FinishAssetFilter = {},
): Promise<EcommerceFinishAssetRow[]> {
  const t = ecommerce_finish_assets;
  const conds = [];
  if (filter.category) conds.push(eq(t.finish_category, filter.category));
  if (filter.sku) conds.push(eq(t.sku, filter.sku.trim().toUpperCase()));
  if (filter.quality_status) conds.push(eq(t.quality_status, filter.quality_status));
  const q = getDb().select().from(t);
  const rows = await (conds.length ? q.where(and(...conds)) : q).orderBy(
    asc(t.finish_category),
    asc(t.sku),
  );
  return rows;
}

export type FinishAssetPatch = Partial<{
  display_name: string;
  hex_code: string | null;
  swatch_thumb_url: string | null;
  texture_2k_url: string | null;
  normal_map_url: string | null;
  roughness_map_url: string | null;
  sample_width_in: number | string | null;
  sample_height_in: number | string | null;
  pattern_repeat_w_in: number | string | null;
  pattern_repeat_h_in: number | string | null;
  quality_status: FinishQualityStatus;
  uploaded_by: string | null;
}>;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function numericOrNull(field: string, v: number | string | null): string | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 10_000_000) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return n.toFixed(3);
}

/** Whitelisted partial update. Throws on invalid input; returns null when the SKU is unknown. */
export async function updateFinishAsset(
  sku: string,
  patch: FinishAssetPatch,
): Promise<EcommerceFinishAssetRow | null> {
  const set: Partial<typeof ecommerce_finish_assets.$inferInsert> = {};
  if (patch.display_name !== undefined) {
    const name = patch.display_name.trim();
    if (!name) throw new Error("display_name cannot be empty");
    set.display_name = name;
  }
  if (patch.hex_code !== undefined) {
    if (patch.hex_code !== null && !HEX_RE.test(patch.hex_code)) {
      throw new Error("hex_code must be #RRGGBB");
    }
    set.hex_code = patch.hex_code;
  }
  for (const key of [
    "swatch_thumb_url",
    "texture_2k_url",
    "normal_map_url",
    "roughness_map_url",
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  for (const key of [
    "sample_width_in",
    "sample_height_in",
    "pattern_repeat_w_in",
    "pattern_repeat_h_in",
  ] as const) {
    if (patch[key] !== undefined) set[key] = numericOrNull(key, patch[key] as number | string | null);
  }
  if (patch.quality_status !== undefined) {
    if (patch.quality_status !== "placeholder_lowres" && patch.quality_status !== "photoshoot_verified") {
      throw new Error("invalid quality_status");
    }
    set.quality_status = patch.quality_status;
  }
  if (patch.uploaded_by !== undefined) set.uploaded_by = patch.uploaded_by;

  const key = sku.trim().toUpperCase();
  const [row] = await getDb()
    .update(ecommerce_finish_assets)
    .set({ ...set, updated_at: new Date() })
    .where(eq(ecommerce_finish_assets.sku, key))
    .returning();
  return row ?? null;
}

/**
 * Resolves a finish SKU for upload: an existing registry row, or an FAB/PWD/DEC `sku_mappings`
 * entry (in which case the registry row is created on first commit). Null if neither.
 */
export async function resolveFinishSubject(
  rawSku: string,
): Promise<{ sku: string; category: FinishCategory; display_name: string; registered: boolean } | null> {
  const sku = rawSku.trim().toUpperCase();
  const db = getDb();
  const [row] = await db
    .select({
      sku: ecommerce_finish_assets.sku,
      category: ecommerce_finish_assets.finish_category,
      display_name: ecommerce_finish_assets.display_name,
    })
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.sku, sku))
    .limit(1);
  if (row) {
    return { sku: row.sku, category: row.category, display_name: row.display_name, registered: true };
  }
  const category = finishCategoryForSku(sku);
  if (!category) return null;
  const [mapped] = await db
    .select({ sku: sku_mappings.global_sku, name: sku_mappings.original_name })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapped) return null;
  return { sku: mapped.sku, category, display_name: mapped.name || mapped.sku, registered: false };
}

/** Insert a registry row for a mapped-but-unregistered finish SKU (no-op if present). */
export async function ensureFinishAssetRow(subject: {
  sku: string;
  category: FinishCategory;
  display_name: string;
}): Promise<void> {
  await getDb()
    .insert(ecommerce_finish_assets)
    .values({
      sku: subject.sku,
      finish_category: subject.category,
      display_name: subject.display_name,
    })
    .onConflictDoNothing({ target: ecommerce_finish_assets.sku });
}

export type Listing3dTarget =
  | { ok: true; id: string; woo_sku: string | null; global_sku: string }
  | { ok: false; status: 400 | 404; reason: string };

/**
 * Resolves the live `ecommerce_listings` row that owns a 3D slot. `woo_sku` (parent or
 * variation storefront SKU) wins; a bare global SKU is accepted only when it maps to exactly
 * one live listing (global SKUs can back several listings).
 */
export async function resolveListing3dTarget(input: {
  woo_sku?: string | null;
  sku?: string | null;
}): Promise<Listing3dTarget> {
  const l = ecommerce_listings;
  const db = getDb();
  const woo = input.woo_sku?.trim();
  if (woo) {
    const [row] = await db
      .select({ id: l.id, woo_sku: l.woo_sku, global_sku: l.global_sku })
      .from(l)
      .where(and(eq(l.woo_sku, woo), isNull(l.archived_at)))
      .limit(1);
    if (!row) return { ok: false, status: 404, reason: `No live listing with woo_sku ${woo}` };
    return { ok: true, ...row };
  }
  const sku = input.sku?.trim();
  if (!sku) return { ok: false, status: 400, reason: "woo_sku or sku is required" };
  const rows = await db
    .select({ id: l.id, woo_sku: l.woo_sku, global_sku: l.global_sku })
    .from(l)
    .where(and(eq(l.global_sku, sku), isNull(l.archived_at)))
    .limit(2);
  if (rows.length === 0) return { ok: false, status: 404, reason: `No live listing with global_sku ${sku}` };
  if (rows.length > 1) {
    return { ok: false, status: 400, reason: `global_sku ${sku} maps to multiple listings; send woo_sku` };
  }
  return { ok: true, ...rows[0]! };
}

type ManifestEntry = {
  label: string;
  color: string;
  image_url: string | null;
  texture_2k_url: string | null;
  normal_map_url: string | null;
  roughness_map_url: string | null;
  sample_width_in: number | null;
  sample_height_in: number | null;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
  quality_status: FinishQualityStatus;
};

const num = (v: string | null): number | null => (v == null ? null : Number(v));

function manifestEntry(r: EcommerceFinishAssetRow): ManifestEntry {
  return {
    label: r.display_name,
    color: r.hex_code ?? "#CCCCCC",
    image_url: r.swatch_thumb_url,
    texture_2k_url: r.texture_2k_url,
    normal_map_url: r.normal_map_url,
    roughness_map_url: r.roughness_map_url,
    sample_width_in: num(r.sample_width_in),
    sample_height_in: num(r.sample_height_in),
    pattern_repeat_w_in: num(r.pattern_repeat_w_in),
    pattern_repeat_h_in: num(r.pattern_repeat_h_in),
    quality_status: r.quality_status,
  };
}

/** Same row order as the curated lists, then any extra registry rows alphabetically. */
function ordered(rows: EcommerceFinishAssetRow[], curated: readonly string[]) {
  const rank = new Map(curated.map((s, i) => [s, i] as const));
  return [...rows].sort(
    (a, b) =>
      (rank.get(a.sku) ?? 10_000) - (rank.get(b.sku) ?? 10_000) || a.sku.localeCompare(b.sku),
  );
}

/** Fabric manifest — exact 32-roster active fabrics only (showroom extras hidden). */
export async function buildFabricSwatchesManifestJson(): Promise<string> {
  const rows = ordered(
    filterActiveEcommerceFinishes(await listFinishAssets({ category: "fabric" })),
    PHASE1_FABRICS,
  );
  return JSON.stringify(rows.map((r) => ({ ...manifestEntry(r), fabric_sku: r.sku })));
}

export async function buildPowderSwatchesManifestJson(): Promise<string> {
  const rows = ordered(
    filterActiveEcommerceFinishes(await listFinishAssets({ category: "powder" })),
    PHASE1_POWDERS,
  );
  return JSON.stringify(rows.map((r) => ({ ...manifestEntry(r), powder_sku: r.sku })));
}

export async function buildDektonSwatchesManifestJson(): Promise<string> {
  const rows = ordered(
    filterActiveEcommerceFinishes(await listFinishAssets({ category: "dekton" })),
    PHASE1_DEKTONS.map((d) => d.sku),
  );
  return JSON.stringify(rows.map((r) => ({ ...manifestEntry(r), dekton_sku: r.sku })));
}

/** Soft-disable a finish from e-commerce views/exports (Hub row retained). */
export async function disableEcommerceFinishAsset(
  sku: string,
): Promise<EcommerceFinishAssetRow | null> {
  return updateFinishAsset(sku, { uploaded_by: ECOMMERCE_FINISH_DISABLED_SENTINEL });
}

/** Re-enable a previously soft-disabled finish for e-commerce. */
export async function enableEcommerceFinishAsset(
  sku: string,
): Promise<EcommerceFinishAssetRow | null> {
  const key = sku.trim().toUpperCase();
  const [row] = await getDb()
    .select()
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.sku, key))
    .limit(1);
  if (!row) return null;
  if ((row.uploaded_by ?? "").toLowerCase() !== ECOMMERCE_FINISH_DISABLED_SENTINEL) {
    return row;
  }
  return updateFinishAsset(sku, { uploaded_by: null });
}

/**
 * Mint + insert a new e-commerce finish row (SKU auto-generated & locked).
 * Collision check is injected for pure unit tests.
 */
export async function addEcommerceFinishAsset(input: {
  category: FinishCategory;
  displayName: string;
  hexCode?: string | null;
  exists?: (sku: string) => Promise<boolean>;
}): Promise<EcommerceFinishAssetRow> {
  const { tokensFromFinishDisplayName, generateCollisionCheckedFinishSku } = await import(
    "@/server/ecommerce/ecommerce-32-finish-roster"
  );
  const tokens = tokensFromFinishDisplayName(input.displayName, input.category);
  const exists =
    input.exists ??
    (async (sku: string) => {
      const [hit] = await getDb()
        .select({ sku: ecommerce_finish_assets.sku })
        .from(ecommerce_finish_assets)
        .where(eq(ecommerce_finish_assets.sku, sku))
        .limit(1);
      return Boolean(hit);
    });
  const minted = await generateCollisionCheckedFinishSku(tokens, exists);
  const fabricUrl =
    input.category === "fabric"
      ? (() => {
          try {
            return fabricSwatchPublicUrl(minted.sku);
          } catch {
            return null;
          }
        })()
      : null;
  const [row] = await getDb()
    .insert(ecommerce_finish_assets)
    .values({
      sku: minted.sku,
      finish_category: input.category,
      display_name: input.displayName.trim(),
      hex_code: input.hexCode ?? null,
      swatch_thumb_url: fabricUrl,
      texture_2k_url: fabricUrl,
      quality_status: "placeholder_lowres",
    })
    .onConflictDoNothing({ target: ecommerce_finish_assets.sku })
    .returning();
  if (row) return row;
  const [existing] = await getDb()
    .select()
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.sku, minted.sku))
    .limit(1);
  if (!existing) throw new Error(`Failed to insert finish asset ${minted.sku}`);
  return existing;
}

export { isEcommerce32FinishSku, filterActiveEcommerceFinishes };

/** Yardi / WebGL physical scale helpers for high-rez finish textures. */
export type FinishPhysicalScale = {
  /** Physical inches spanned by one edge of the 2048 texture tile. */
  repeat_inches: number;
  /**
   * Yardi 3D plugin texture scale: inches-per-texture-unit.
   * Anchored so Cabana Classic vertical stripe period ≈ 7" when known.
   */
  texture_scale: number;
  sample_width_in: number;
  sample_height_in: number;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
};

/**
 * Derive `repeat_inches` / `texture_scale` from measured crop width + optional roster pattern.
 * Cabana Classic anchors ~7" vertical stripe when stripe period is available.
 */
export function deriveFinishPhysicalScale(input: {
  croppedWidthIn: number | null | undefined;
  patternRepeatIn?: { w: number; h: number } | null;
  /** Measured vertical stripe period in inches (e.g. Cabana ≈ 7). */
  stripePeriodIn?: number | null;
  sku?: string;
}): FinishPhysicalScale {
  const cropped =
    input.croppedWidthIn != null && Number.isFinite(input.croppedWidthIn) && input.croppedWidthIn > 0
      ? input.croppedWidthIn
      : 8;
  const stripe =
    input.stripePeriodIn != null && Number.isFinite(input.stripePeriodIn) && input.stripePeriodIn > 0
      ? input.stripePeriodIn
      : null;
  const isCabana = (input.sku ?? "").toUpperCase() === "FAB-CAB-CLA";
  const repeat_inches = stripe ?? (isCabana ? 7 : cropped);
  const texture_scale = repeat_inches;
  const pr = input.patternRepeatIn ?? null;
  return {
    repeat_inches: Number(repeat_inches.toFixed(3)),
    texture_scale: Number(texture_scale.toFixed(3)),
    sample_width_in: Number(cropped.toFixed(3)),
    sample_height_in: Number(cropped.toFixed(3)),
    pattern_repeat_w_in: pr ? Number(pr.w.toFixed(3)) : null,
    pattern_repeat_h_in: pr ? Number(pr.h.toFixed(3)) : null,
  };
}

/** Supabase Storage object prefix for photoshoot-verified finishes. */
export function finishStoragePrefix(sku: string): string {
  return `finishes/${sku.trim().toUpperCase()}`;
}

export function finishTextureObjectPath(sku: string): string {
  return `${finishStoragePrefix(sku)}/texture-2048.jpg`;
}

export function finishThumbObjectPath(sku: string): string {
  return `${finishStoragePrefix(sku)}/thumb-512.jpg`;
}

export type FullFinishesManifest = {
  fabrics: unknown[];
  powders: unknown[];
  dektons: unknown[];
};

export async function buildFullFinishesManifest(): Promise<FullFinishesManifest> {
  const [fabrics, powders, dektons] = await Promise.all([
    buildFabricSwatchesManifestJson(),
    buildPowderSwatchesManifestJson(),
    buildDektonSwatchesManifestJson(),
  ]);
  return {
    fabrics: JSON.parse(fabrics) as unknown[],
    powders: JSON.parse(powders) as unknown[],
    dektons: JSON.parse(dektons) as unknown[],
  };
}
