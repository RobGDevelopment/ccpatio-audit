/**
 * Finish Intake & Media Certification — DDL ensure, list, crop apply, promote, SKU preview.
 * Never overwrites Mia-edited display_name on already-customized ecommerce_finish_assets rows.
 */
import { createHash } from "node:crypto";
import { eq, sql, desc, asc } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/server/db/client";
import {
  finish_intake,
  ecommerce_finish_assets,
  type FinishIntakeRow,
} from "@/server/db/schema";
import {
  ECOMMERCE_32_FINISHES,
  type EcommerceFinishDefinition,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  ensureFinishAssetProvenanceColumns,
  ensureFinishAssetRow,
  isStaleFinishDisplayName,
  updateFinishAsset,
  type FinishCategory,
} from "@/server/assets/finish-assets";
import {
  getPublicObjectUrl,
  getSupabaseAdmin,
  PRODUCT_IMAGES_BUCKET,
} from "@/lib/supabase-storage";

export type MaterialClass =
  | "sunbrella"
  | "ultraleather"
  | "dekton"
  | "powder"
  | "addon";

export type FinishIntakeView = {
  id: string;
  sourceKey: string;
  categoryFolder: string;
  originalFilename: string;
  rawReferenceUrl: string | null;
  texture2048Url: string | null;
  thumb512Url: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  cropX: number | null;
  cropY: number | null;
  cropSidePx: number | null;
  cropXNorm: number | null;
  cropYNorm: number | null;
  cropSideNorm: number | null;
  materialClass: MaterialClass | null;
  displayName: string | null;
  vendorSku: string | null;
  materialDescription: string | null;
  patternMode: "solid" | "striped" | null;
  repeatWIn: number | null;
  repeatHIn: number | null;
  proposedSku: string | null;
  canonicalSku: string | null;
  status: FinishIntakeRow["status"];
  textureSha256: string | null;
  rawSourceFile: string | null;
  certifiedAt: string | null;
  certifiedBy: string | null;
};

const FINISH_INTAKE_DDL = `
CREATE TABLE IF NOT EXISTS "finish_intake" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "category_folder" text NOT NULL,
  "original_filename" text NOT NULL,
  "raw_reference_url" text,
  "texture_2048_url" text,
  "thumb_512_url" text,
  "source_width" integer,
  "source_height" integer,
  "crop_x" integer,
  "crop_y" integer,
  "crop_side_px" integer,
  "crop_x_norm" numeric(12, 8),
  "crop_y_norm" numeric(12, 8),
  "crop_side_norm" numeric(12, 8),
  "material_class" text,
  "display_name" text,
  "vendor_sku" text,
  "material_description" text,
  "pattern_mode" text,
  "repeat_w_in" numeric(10, 3),
  "repeat_h_in" numeric(10, 3),
  "proposed_sku" text,
  "canonical_sku" text,
  "status" text NOT NULL DEFAULT 'pending',
  "texture_sha256" text,
  "raw_source_file" text,
  "certified_at" timestamptz,
  "certified_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "finish_intake_source_key_uidx" ON "finish_intake" ("source_key");
CREATE INDEX IF NOT EXISTS "finish_intake_status_idx" ON "finish_intake" ("status");
CREATE INDEX IF NOT EXISTS "finish_intake_canonical_sku_idx" ON "finish_intake" ("canonical_sku");
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "gallery_image_urls" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "product_video_url" text;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "product_video_external_url" text;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "media_certified_at" timestamptz;
ALTER TABLE "ecommerce_listings" ADD COLUMN IF NOT EXISTS "media_certified_by" text;
`;

export async function ensureFinishIntakeTables(): Promise<void> {
  const db = getDb();
  await ensureFinishAssetProvenanceColumns();
  await db.execute(sql.raw(FINISH_INTAKE_DDL));
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toFinishIntakeView(row: FinishIntakeRow): FinishIntakeView {
  return {
    id: row.id,
    sourceKey: row.source_key,
    categoryFolder: row.category_folder,
    originalFilename: row.original_filename,
    rawReferenceUrl: row.raw_reference_url,
    texture2048Url: row.texture_2048_url,
    thumb512Url: row.thumb_512_url,
    sourceWidth: row.source_width,
    sourceHeight: row.source_height,
    cropX: row.crop_x,
    cropY: row.crop_y,
    cropSidePx: row.crop_side_px,
    cropXNorm: num(row.crop_x_norm),
    cropYNorm: num(row.crop_y_norm),
    cropSideNorm: num(row.crop_side_norm),
    materialClass: (row.material_class as MaterialClass | null) ?? null,
    displayName: row.display_name,
    vendorSku: row.vendor_sku,
    materialDescription: row.material_description,
    patternMode: (row.pattern_mode as "solid" | "striped" | null) ?? null,
    repeatWIn: num(row.repeat_w_in),
    repeatHIn: num(row.repeat_h_in),
    proposedSku: row.proposed_sku,
    canonicalSku: row.canonical_sku,
    status: row.status,
    textureSha256: row.texture_sha256,
    rawSourceFile: row.raw_source_file,
    certifiedAt: row.certified_at ? row.certified_at.toISOString() : null,
    certifiedBy: row.certified_by,
  };
}

export async function listFinishIntake(opts?: {
  status?: FinishIntakeRow["status"] | "all_pending" | "photoshoot" | "recent_certified";
}): Promise<FinishIntakeView[]> {
  await ensureFinishIntakeTables();
  const db = getDb();
  const rows = await db.select().from(finish_intake).orderBy(asc(finish_intake.source_key));
  let filtered = rows;
  const status = opts?.status;
  if (status === "all_pending") {
    filtered = rows.filter((r) => r.status !== "certified");
  } else if (status === "photoshoot") {
    filtered = rows.filter((r) => r.raw_source_file?.includes("HighRezImages") || r.status !== "certified");
  } else if (status === "recent_certified") {
    filtered = rows
      .filter((r) => r.status === "certified")
      .sort((a, b) => (b.certified_at?.getTime() ?? 0) - (a.certified_at?.getTime() ?? 0))
      .slice(0, 40);
  } else if (
    status === "pending" ||
    status === "crop_verified" ||
    status === "classified" ||
    status === "certified"
  ) {
    filtered = rows.filter((r) => r.status === status);
  }
  return filtered.map(toFinishIntakeView);
}

export function defaultUvScale(materialClass: MaterialClass | null | undefined): number {
  switch (materialClass) {
    case "ultraleather":
      return 6;
    case "dekton":
      return 24;
    case "powder":
      return 4;
    case "addon":
      return 8;
    case "sunbrella":
    default:
      return 8;
  }
}

export function apfTargetGroupForMaterial(
  materialClass: MaterialClass | null | undefined,
): "Cushion & Pillow" | "Dekton Tabletop" | "Aluminum Frame" {
  if (materialClass === "dekton") return "Dekton Tabletop";
  if (materialClass === "powder" || materialClass === "addon") return "Aluminum Frame";
  return "Cushion & Pillow";
}

/** Deterministic canonical SKU from display name + material class. */
export function mintCanonicalFinishSku(
  displayName: string,
  materialClass: MaterialClass,
): string {
  const slug = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  const prefix =
    materialClass === "dekton"
      ? "DKT"
      : materialClass === "powder"
        ? "PWD"
        : materialClass === "addon"
          ? "ADD"
          : "FAB";
  return `${prefix}-${slug || "NEW"}`;
}

/** Search Hub/Katana finish roster + aliases (incl. DKT ↔ STN-DKT bridge). */
export function searchFinishSkuMatches(query: string): Array<{
  sku: string;
  displayName: string;
  family: string;
  bridgeSkus: string[];
}> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Array<{ sku: string; displayName: string; family: string; bridgeSkus: string[] }> = [];
  for (const def of ECOMMERCE_32_FINISHES) {
    const hay = [def.sku, def.displayName, ...def.aliases].join(" ").toLowerCase();
    if (!hay.includes(q) && !q.includes(def.sku.toLowerCase())) continue;
    const bridgeSkus: string[] = [];
    if (def.sku.startsWith("DKT-")) {
      bridgeSkus.push(`STN-${def.sku}`);
      for (const a of def.aliases) {
        if (a.startsWith("DEC-") || a.startsWith("STN-")) bridgeSkus.push(a);
      }
    }
    out.push({
      sku: def.sku,
      displayName: def.displayName,
      family: def.family,
      bridgeSkus: [...new Set(bridgeSkus)],
    });
  }
  return out.slice(0, 12);
}

export function resolveFinishDefBySkuOrAlias(skuOrAlias: string): EcommerceFinishDefinition | null {
  const upper = skuOrAlias.trim().toUpperCase();
  const direct = ECOMMERCE_32_FINISHES.find((f) => f.sku === upper);
  if (direct) return direct;
  const viaAlias = ECOMMERCE_32_FINISHES.find((f) =>
    f.aliases.some((a) => a.toUpperCase() === upper),
  );
  if (viaAlias) return viaAlias;
  // STN-DKT-* ↔ DKT-* bridge
  if (upper.startsWith("STN-DKT-")) {
    return ECOMMERCE_32_FINISHES.find((f) => f.sku === upper.replace(/^STN-/, "")) ?? null;
  }
  if (upper.startsWith("DKT-")) {
    return ECOMMERCE_32_FINISHES.find((f) => f.sku === upper) ?? null;
  }
  return null;
}

export function kebabDisplaySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "finish";
}

export function certifiedFinishObjectPaths(sku: string, displayName: string): {
  texture: string;
  thumb: string;
} {
  const slug = kebabDisplaySlug(displayName);
  return {
    texture: `finishes/${sku}/${sku}-${slug}-2048.jpg`,
    thumb: `finishes/${sku}/${sku}-${slug}-512.jpg`,
  };
}

async function uploadBuffer(
  objectPath: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(objectPath, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const sha8 = createHash("sha256").update(buf).digest("hex").slice(0, 8);
  const base = getPublicObjectUrl(PRODUCT_IMAGES_BUCKET, objectPath);
  return `${base}${base.includes("?") ? "&" : "?"}v=${sha8}`;
}

/**
 * Re-crop high-res source bytes with exact pixel square → 2048+512 JPEGs.
 * cropX/Y/SidePx are full-res pixels after EXIF rotate — 1:1 with overlay math:
 *   left% = cropX/sourceW, top% = cropY/sourceH,
 *   width% = cropSidePx/sourceW, height% = cropSidePx/sourceH
 * (height% uses sourceH so the box stays visually square on 3:2 / 4:3 photos).
 */
export async function reCropFinishFromBuffer(input: {
  sourceBytes: Buffer;
  cropX: number;
  cropY: number;
  cropSidePx: number;
  patternMode?: "solid" | "striped" | null;
  materialClass?: MaterialClass | null;
}): Promise<{ texture2048: Buffer; thumb512: Buffer; sha256: string }> {
  const meta = await sharp(input.sourceBytes).rotate().metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const side = Math.max(8, Math.min(input.cropSidePx, w - input.cropX, h - input.cropY));
  const left = Math.max(0, Math.min(input.cropX, w - side));
  const top = Math.max(0, Math.min(input.cropY, h - side));
  void input.patternMode;
  void input.materialClass;
  const texture2048 = await sharp(input.sourceBytes)
    .rotate()
    .extract({ left, top, width: side, height: side })
    .resize(2048, 2048, { fit: "fill", kernel: "lanczos3" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  const thumb512 = await sharp(texture2048).resize(512, 512).jpeg({ quality: 90 }).toBuffer();
  const sha256 = createHash("sha256").update(texture2048).digest("hex");
  return { texture2048, thumb512, sha256 };
}

export async function updateFinishIntakeMeta(
  id: string,
  patch: Partial<{
    materialClass: MaterialClass | null;
    displayName: string | null;
    vendorSku: string | null;
    materialDescription: string | null;
    patternMode: "solid" | "striped" | null;
    repeatWIn: number | null;
    repeatHIn: number | null;
    proposedSku: string | null;
    cropX: number | null;
    cropY: number | null;
    cropSidePx: number | null;
    sourceWidth: number | null;
    sourceHeight: number | null;
    status: FinishIntakeRow["status"];
  }>,
): Promise<FinishIntakeView> {
  await ensureFinishIntakeTables();
  const db = getDb();
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.materialClass !== undefined) set.material_class = patch.materialClass;
  if (patch.displayName !== undefined) set.display_name = patch.displayName?.trim() || null;
  if (patch.vendorSku !== undefined) set.vendor_sku = patch.vendorSku?.trim() || null;
  if (patch.materialDescription !== undefined)
    set.material_description = patch.materialDescription?.trim() || null;
  if (patch.patternMode !== undefined) set.pattern_mode = patch.patternMode;
  if (patch.repeatWIn !== undefined)
    set.repeat_w_in = patch.repeatWIn != null ? String(patch.repeatWIn) : null;
  if (patch.repeatHIn !== undefined)
    set.repeat_h_in = patch.repeatHIn != null ? String(patch.repeatHIn) : null;
  if (patch.proposedSku !== undefined) set.proposed_sku = patch.proposedSku?.trim() || null;
  if (patch.cropX !== undefined) set.crop_x = patch.cropX;
  if (patch.cropY !== undefined) set.crop_y = patch.cropY;
  if (patch.cropSidePx !== undefined) set.crop_side_px = patch.cropSidePx;
  if (patch.sourceWidth !== undefined) set.source_width = patch.sourceWidth;
  if (patch.sourceHeight !== undefined) set.source_height = patch.sourceHeight;
  if (
    patch.cropX != null &&
    patch.cropSidePx != null &&
    patch.sourceWidth != null &&
    patch.sourceWidth > 0
  ) {
    set.crop_x_norm = String(patch.cropX / patch.sourceWidth);
    set.crop_side_norm = String(patch.cropSidePx / patch.sourceWidth);
  }
  if (patch.cropY != null && patch.sourceHeight != null && patch.sourceHeight > 0) {
    set.crop_y_norm = String(patch.cropY / patch.sourceHeight);
  }
  if (patch.status !== undefined) set.status = patch.status;

  const [row] = await db
    .update(finish_intake)
    .set(set)
    .where(eq(finish_intake.id, id))
    .returning();
  if (!row) throw new Error(`finish_intake ${id} not found`);
  return toFinishIntakeView(row);
}

/**
 * Approve & Promote: validate → rename cloud files → upsert certified finish
 * without clobbering Mia-edited display_name.
 */
export async function promoteFinishIntake(input: {
  id: string;
  actor: string;
  sourceBytes?: Buffer | null;
}): Promise<{ ok: true; view: FinishIntakeView; canonicalSku: string } | { ok: false; error: string }> {
  await ensureFinishIntakeTables();
  const db = getDb();
  const [row] = await db.select().from(finish_intake).where(eq(finish_intake.id, input.id)).limit(1);
  if (!row) return { ok: false, error: "Intake item not found" };
  const displayName = (row.display_name ?? "").trim();
  if (!displayName) return { ok: false, error: "Storefront Display Name is required" };
  const materialClass = (row.material_class as MaterialClass | null) ?? null;
  if (!materialClass) return { ok: false, error: "Material Class is required" };

  let canonical =
    (row.proposed_sku ?? row.canonical_sku ?? "").trim().toUpperCase() ||
    mintCanonicalFinishSku(displayName, materialClass);
  const matched = resolveFinishDefBySkuOrAlias(canonical);
  if (matched) canonical = matched.sku;

  if (
    row.crop_side_px == null ||
    row.crop_side_px < 64 ||
    row.source_width == null ||
    row.source_height == null
  ) {
    // Allow promote when seeded 2048 already exists
    if (!row.texture_2048_url) {
      return { ok: false, error: "Crop-verify a 2048×2048 square before promoting" };
    }
  }

  let textureUrl = row.texture_2048_url;
  let thumbUrl = row.thumb_512_url;
  let sha = row.texture_sha256;

  if (input.sourceBytes && row.crop_x != null && row.crop_y != null && row.crop_side_px != null) {
    const cropped = await reCropFinishFromBuffer({
      sourceBytes: input.sourceBytes,
      cropX: row.crop_x,
      cropY: row.crop_y,
      cropSidePx: row.crop_side_px,
      patternMode: (row.pattern_mode as "solid" | "striped" | null) ?? null,
      materialClass,
    });
    const paths = certifiedFinishObjectPaths(canonical, displayName);
    textureUrl = await uploadBuffer(paths.texture, cropped.texture2048, "image/jpeg");
    thumbUrl = await uploadBuffer(paths.thumb, cropped.thumb512, "image/jpeg");
    sha = cropped.sha256;
  } else if (textureUrl && thumbUrl) {
    // Copy existing objects to canonical slug paths when possible
    const paths = certifiedFinishObjectPaths(canonical, displayName);
    try {
      const texRes = await fetch(textureUrl.split("?")[0]!);
      const thRes = await fetch(thumbUrl.split("?")[0]!);
      if (texRes.ok && thRes.ok) {
        const texBuf = Buffer.from(await texRes.arrayBuffer());
        const thBuf = Buffer.from(await thRes.arrayBuffer());
        textureUrl = await uploadBuffer(paths.texture, texBuf, "image/jpeg");
        thumbUrl = await uploadBuffer(paths.thumb, thBuf, "image/jpeg");
        sha = createHash("sha256").update(texBuf).digest("hex");
      }
    } catch {
      // keep existing URLs
    }
  }

  if (!textureUrl || !thumbUrl) {
    return { ok: false, error: "Missing 2048 / 512 assets for promotion" };
  }

  // Upsert certified finish — NEVER overwrite customized Mia display_name
  const [existing] = await db
    .select({ sku: ecommerce_finish_assets.sku, display_name: ecommerce_finish_assets.display_name })
    .from(ecommerce_finish_assets)
    .where(eq(ecommerce_finish_assets.sku, canonical))
    .limit(1);

  const finishCategory: FinishCategory =
    materialClass === "dekton" ? "dekton" : materialClass === "powder" ? "powder" : "fabric";

  const shouldWriteName =
    !existing ||
    !existing.display_name?.trim() ||
    isStaleFinishDisplayName(canonical, existing.display_name);

  await ensureFinishAssetRow({
    sku: canonical,
    category: finishCategory,
    display_name: displayName,
  });

  await updateFinishAsset(canonical, {
    ...(shouldWriteName ? { display_name: displayName } : {}),
    swatch_thumb_url: thumbUrl,
    texture_2k_url: textureUrl,
    texture_sha256: sha ?? undefined,
    source_type: "studio_photo",
    source_filename: row.raw_source_file ?? row.source_key,
    texture_width_px: 2048,
    texture_height_px: 2048,
    quality_status: "photoshoot_verified",
    uploaded_by: input.actor,
    sample_width_in: row.repeat_w_in ?? undefined,
    sample_height_in: row.repeat_h_in ?? String(defaultUvScale(materialClass)),
    pattern_repeat_w_in: row.repeat_w_in ?? undefined,
    pattern_repeat_h_in: row.repeat_h_in ?? undefined,
  });

  // Bridge STN-DKT thumbs for showroom Dekton Slabs
  if (canonical.startsWith("DKT-")) {
    const stn = `STN-${canonical}`;
    try {
      await ensureFinishAssetRow({
        sku: stn,
        category: "dekton",
        display_name: displayName,
      });
      await updateFinishAsset(stn, {
        ...(shouldWriteName ? { display_name: displayName } : {}),
        swatch_thumb_url: thumbUrl,
        texture_2k_url: textureUrl,
        quality_status: "photoshoot_verified",
        uploaded_by: input.actor,
      });
    } catch {
      // STN row may not exist yet — non-fatal
    }
  }

  const [promoted] = await db
    .update(finish_intake)
    .set({
      status: "certified",
      canonical_sku: canonical,
      proposed_sku: canonical,
      texture_2048_url: textureUrl,
      thumb_512_url: thumbUrl,
      texture_sha256: sha,
      certified_at: new Date(),
      certified_by: input.actor,
      updated_at: new Date(),
    })
    .where(eq(finish_intake.id, input.id))
    .returning();

  return { ok: true, view: toFinishIntakeView(promoted!), canonicalSku: canonical };
}

export async function getFinishIntakeById(id: string): Promise<FinishIntakeView | null> {
  await ensureFinishIntakeTables();
  const db = getDb();
  const [row] = await db.select().from(finish_intake).where(eq(finish_intake.id, id)).limit(1);
  return row ? toFinishIntakeView(row) : null;
}

export { desc };
