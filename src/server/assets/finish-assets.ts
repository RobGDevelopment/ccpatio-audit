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
  ECOMMERCE_FINISH_OPERATOR_SENTINEL,
  ecommerceFinishBySku,
  filterActiveEcommerceFinishes,
  isEcommerce32FinishSku,
} from "@/server/ecommerce/ecommerce-32-finish-roster";

export { PHASE1_DEKTONS };

export type FinishCategory = "fabric" | "powder" | "dekton";
export type FinishQualityStatus = "placeholder_lowres" | "photoshoot_verified";
export type FinishSourceType = "studio_photo" | "synthetic_fallback";

/** Hex + label from the exact 32 e-commerce roster. */
const FINISH_META: Readonly<Record<string, { label: string; color: string }>> = Object.fromEntries(
  ECOMMERCE_32_FINISHES.map((f) => [f.sku, { label: f.displayName, color: f.hex }] as const),
);

/** True when URL points at photoshoot-verified finishes/{SKU}/… Storage objects. */
export function isHighRezFinishStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\/storage\/v1\/object\/public\/[^/]+\/finishes\/[A-Z0-9-]+\//i.test(url);
}

/** Legacy low-res / 404-prone paths that must never clobber high-rez Storage URLs. */
export function isStaleLegacyFinishUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    u.includes("_low.jpg") ||
    u.includes("_low.png") ||
    /\/fabrics\/fab-[a-z0-9-]+\.jpg(?:\?|$)/i.test(u)
  );
}

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

/**
 * Additive provenance columns for high-rez uploads. Idempotent — safe on every boot.
 * Never drops columns or rewrites existing URL values.
 */
export async function ensureFinishAssetProvenanceColumns(): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    ALTER TABLE ecommerce_finish_assets ADD COLUMN IF NOT EXISTS texture_sha256 text;
    ALTER TABLE ecommerce_finish_assets ADD COLUMN IF NOT EXISTS source_type text;
    ALTER TABLE ecommerce_finish_assets ADD COLUMN IF NOT EXISTS source_filename text;
    ALTER TABLE ecommerce_finish_assets ADD COLUMN IF NOT EXISTS texture_width_px integer;
    ALTER TABLE ecommerce_finish_assets ADD COLUMN IF NOT EXISTS texture_height_px integer;
  `);
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
  sample_width_in: string | null;
  sample_height_in: string | null;
  pattern_repeat_w_in: string | null;
  pattern_repeat_h_in: string | null;
};

/** Stale Hub labels like "Beacon Ultraleather" that should snap back to canonical. */
export function isStaleFinishDisplayName(sku: string, current: string | null | undefined): boolean {
  const def = ECOMMERCE_32_FINISHES.find((f) => f.sku === sku);
  if (!def) return false;
  const cur = (current ?? "").trim();
  if (!cur) return true;
  if (cur.toLowerCase() === def.displayName.toLowerCase()) return false;
  const suffixes = [" Ultraleather", " Sunbrella", " Dekton", " Powder Coat", " Powder"];
  return suffixes.some(
    (s) => cur.toLowerCase() === `${def.displayName}${s}`.toLowerCase(),
  );
}

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
    const scale = deriveFinishPhysicalScale({
      croppedWidthIn: def.patternRepeatIn?.w ?? null,
      patternRepeatIn: def.patternRepeatIn,
      sku: def.sku,
      stripePeriodIn: def.sku === "FAB-CAB-CLA" ? 7 : null,
    });
    rows.push({
      sku: def.sku,
      finish_category: def.category,
      display_name: meta?.label ?? def.displayName,
      hex_code: meta?.color ?? def.hex,
      swatch_thumb_url: fabricUrl,
      texture_2k_url: fabricUrl,
      sample_width_in: String(scale.sample_width_in),
      sample_height_in: String(scale.texture_scale),
      pattern_repeat_w_in:
        scale.pattern_repeat_w_in != null ? String(scale.pattern_repeat_w_in) : null,
      pattern_repeat_h_in:
        scale.pattern_repeat_h_in != null ? String(scale.pattern_repeat_h_in) : null,
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
 * filled; a non-empty high-rez `finishes/{SKU}/…` URL is NEVER overwritten by legacy fabrics/ or
 * `*_LOW.jpg` paths. `quality_status`, operator `uploaded_by`, and verified scale are preserved.
 */
export async function seedEcommerceFinishAssets(): Promise<SeedFinishAssetsResult> {
  await ensureFinishAssetProvenanceColumns().catch(() => undefined);
  const db = getDb();
  const rows = buildFinishSeedRows();
  const t = ecommerce_finish_assets;
  const before = await db
    .select({
      sku: t.sku,
      display_name: t.display_name,
      swatch_thumb_url: t.swatch_thumb_url,
      texture_2k_url: t.texture_2k_url,
      pattern_repeat_w_in: t.pattern_repeat_w_in,
    })
    .from(t);
  const known = new Set(before.map((r) => r.sku));
  const staleBySku = new Map(
    before
      .filter((r) => isStaleFinishDisplayName(r.sku, r.display_name))
      .map((r) => [r.sku, true] as const),
  );
  const BOLT_WIDTH_SCRUB = new Set([
    "FAB-MET-CLO",
    "FAB-HER-PAP",
    "FAB-SHE-LIN",
    "FAB-POS-SAP",
    "FAB-CRU-ASH",
    "FAB-DUM-STU",
    "FAB-RUE-COS",
    "FAB-PRE-FAW",
    "FAB-KIN-SIL",
    "FAB-RIT-NEC",
    "FAB-RIT-ROS",
  ]);

  for (const row of rows) {
    const refreshName = staleBySku.has(row.sku);
    const isCabana = row.sku.toUpperCase() === "FAB-CAB-CLA";
    const existing = before.find((r) => r.sku === row.sku);
    const keepThumb =
      isHighRezFinishStorageUrl(existing?.swatch_thumb_url) ||
      (!isStaleLegacyFinishUrl(existing?.swatch_thumb_url) &&
        Boolean(existing?.swatch_thumb_url?.trim()));
    const keepTexture =
      isHighRezFinishStorageUrl(existing?.texture_2k_url) ||
      (!isStaleLegacyFinishUrl(existing?.texture_2k_url) &&
        Boolean(existing?.texture_2k_url?.trim()));
    const scrubBoltWidth =
      BOLT_WIDTH_SCRUB.has(row.sku.toUpperCase()) &&
      Number(existing?.pattern_repeat_w_in) === 54;
    await db
      .insert(t)
      .values({ ...row, quality_status: "placeholder_lowres" })
      .onConflictDoUpdate({
        target: t.sku,
        set: {
          hex_code: sql`COALESCE(NULLIF(${t.hex_code}, ''), excluded.hex_code)`,
          // Never replace high-rez Storage URLs with legacy fabrics/*_LOW paths.
          swatch_thumb_url: keepThumb
            ? sql`${t.swatch_thumb_url}`
            : sql`COALESCE(NULLIF(${t.swatch_thumb_url}, ''), excluded.swatch_thumb_url)`,
          texture_2k_url: keepTexture
            ? sql`${t.texture_2k_url}`
            : sql`COALESCE(NULLIF(${t.texture_2k_url}, ''), excluded.texture_2k_url)`,
          sample_width_in: sql`COALESCE(${t.sample_width_in}, excluded.sample_width_in)`,
          sample_height_in: sql`COALESCE(${t.sample_height_in}, excluded.sample_height_in)`,
          pattern_repeat_w_in: isCabana
            ? sql`excluded.pattern_repeat_w_in`
            : scrubBoltWidth
              ? sql`excluded.pattern_repeat_w_in`
              : sql`COALESCE(${t.pattern_repeat_w_in}, excluded.pattern_repeat_w_in)`,
          // Cabana Classic canonical vertical repeat is 7" — always restore.
          pattern_repeat_h_in: isCabana
            ? sql`excluded.pattern_repeat_h_in`
            : scrubBoltWidth
              ? sql`excluded.pattern_repeat_h_in`
              : sql`COALESCE(${t.pattern_repeat_h_in}, excluded.pattern_repeat_h_in)`,
          ...(refreshName ? { display_name: row.display_name } : {}),
          // Zero-accidental-deletion restore: never leave FAB-CAB-CLA soft-disabled.
          ...(isCabana ? { uploaded_by: null } : {}),
        },
      });
  }

  // Explicit restore path if Cabana was soft-disabled outside seed conflict.
  await enableEcommerceFinishAsset("FAB-CAB-CLA").catch(() => null);

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
  texture_sha256: string | null;
  source_type: FinishSourceType | null;
  source_filename: string | null;
  texture_width_px: number | null;
  texture_height_px: number | null;
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
  if (patch.texture_sha256 !== undefined) set.texture_sha256 = patch.texture_sha256;
  if (patch.source_type !== undefined) {
    if (
      patch.source_type !== null &&
      patch.source_type !== "studio_photo" &&
      patch.source_type !== "synthetic_fallback"
    ) {
      throw new Error("invalid source_type");
    }
    set.source_type = patch.source_type;
  }
  if (patch.source_filename !== undefined) set.source_filename = patch.source_filename;
  if (patch.texture_width_px !== undefined) set.texture_width_px = patch.texture_width_px;
  if (patch.texture_height_px !== undefined) set.texture_height_px = patch.texture_height_px;
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
  /** Calibrated inches spanned by one texture edge (Cabana ≈ 7). */
  repeat_inches: number | null;
  repeat_w_in: number | null;
  repeat_h_in: number | null;
  texture_scale: number | null;
  quality_status: FinishQualityStatus;
};

const num = (v: string | null): number | null => (v == null ? null : Number(v));

function manifestEntry(r: EcommerceFinishAssetRow): ManifestEntry {
  const def = ecommerceFinishBySku(r.sku);
  const patternFromRoster = def?.patternRepeatIn ?? null;
  const w = num(r.pattern_repeat_w_in) ?? patternFromRoster?.w ?? null;
  const h = num(r.pattern_repeat_h_in) ?? patternFromRoster?.h ?? null;
  const scale = deriveFinishPhysicalScale({
    croppedWidthIn: num(r.sample_width_in),
    patternRepeatIn: w != null && h != null ? { w, h } : patternFromRoster,
    stripePeriodIn: h,
    sku: r.sku,
  });
  return {
    label: r.display_name,
    color: r.hex_code ?? def?.hex ?? "#CCCCCC",
    image_url: r.swatch_thumb_url,
    texture_2k_url: r.texture_2k_url,
    normal_map_url: r.normal_map_url,
    roughness_map_url: r.roughness_map_url,
    sample_width_in: num(r.sample_width_in) ?? scale.sample_width_in,
    sample_height_in: num(r.sample_height_in) ?? scale.sample_height_in,
    pattern_repeat_w_in: w,
    pattern_repeat_h_in: h,
    repeat_inches: scale.repeat_inches,
    repeat_w_in: w,
    repeat_h_in: h,
    texture_scale: scale.texture_scale,
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
      uploaded_by: ECOMMERCE_FINISH_OPERATOR_SENTINEL,
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
