import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { validateCommitTarget, maxBytesForSlot } from "@/server/assets/presign-policy";
import {
  ensureFinishAssetRow,
  resolveFinishSubject,
  resolveListing3dTarget,
  updateFinishAsset,
} from "@/server/assets/finish-assets";
import { getDb } from "@/server/db/client";
import { ecommerce_listings, sku_mappings } from "@/server/db/schema";
import {
  getPublicObjectUrl,
  getStorageObjectInfo,
  getVaultStorage,
} from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const FINISH_SLOT_COLUMN = {
  thumb: "swatch_thumb_url",
  texture_2k: "texture_2k_url",
  normal_map: "normal_map_url",
  roughness_map: "roughness_map_url",
} as const;

/**
 * POST /api/assets/commit-upload
 * Body: { kind, sku?, woo_sku?, slot, bucket, path, byteSize?, token? }
 * Verifies the object really landed in storage, then records its public URL on
 * `ecommerce_finish_assets` (swatches) or `ecommerce_listings` (3D slots).
 *
 * No `product_assets` audit row: its `product_asset_kind` enum has no swatch/3D value and this
 * phase deliberately does not alter that enum (3D lives on `ecommerce_listings`).
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return bad(400, "JSON object body required");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return bad(400, "Invalid JSON body");
  }

  const auth = await authenticateAssetStudioRequest(request, {
    bodyToken: typeof body.token === "string" ? body.token : null,
  });
  if (!auth.ok) return bad(auth.status, auth.reason);

  const target = validateCommitTarget({
    kind: body.kind,
    sku: body.sku,
    woo_sku: body.woo_sku,
    slot: body.slot,
    bucket: body.bucket,
    path: body.path,
  });
  if (!target.ok) return bad(target.status, target.reason);

  try {
    const info = await getStorageObjectInfo(target.bucket, target.path);
    if (!info) return bad(404, `Object ${target.bucket}/${target.path} was not found in storage; upload first.`);
    const max = maxBytesForSlot(target.slot);
    if (info.size !== null && info.size > max) {
      return bad(400, `Stored object is ${info.size} bytes, over the ${max} byte limit for ${target.slot}`);
    }
    const byteSize = info.size ?? (typeof body.byteSize === "number" ? Math.trunc(body.byteSize) : null);
    const publicUrl = getPublicObjectUrl(target.bucket, target.path);

    // Real crypto sha256 of the landed object — never placeholder hashes.
    let sha256Hex: string | null = null;
    try {
      const downloaded = await getVaultStorage().download(target.bucket, target.path);
      sha256Hex = createHash("sha256").update(downloaded.bytes).digest("hex");
    } catch {
      sha256Hex = null;
    }

    if (target.kind === "finish_swatch") {
      const subject = await resolveFinishSubject(String(body.sku));
      if (!subject) return bad(404, `Unknown finish SKU ${String(body.sku)}`);
      if (!subject.registered) await ensureFinishAssetRow(subject);

      const column = FINISH_SLOT_COLUMN[target.slot as keyof typeof FINISH_SLOT_COLUMN];
      const verified = target.slot === "thumb" || target.slot === "texture_2k";
      const row = await updateFinishAsset(subject.sku, {
        [column]: publicUrl,
        uploaded_by: auth.actor,
        ...(verified ? { quality_status: "photoshoot_verified" as const } : {}),
      });
      if (!row) return bad(404, `Finish asset ${subject.sku} disappeared during commit`);
      return NextResponse.json({
        ok: true,
        kind: target.kind,
        slot: target.slot,
        publicUrl,
        byteSize,
        sha256: sha256Hex,
        asset: row,
        auditRow: "skipped: product_asset_kind enum has no swatch/3D kind",
      });
    }

    const listing = await resolveListing3dTarget({
      woo_sku: typeof body.woo_sku === "string" ? body.woo_sku : null,
      sku: typeof body.sku === "string" ? body.sku : null,
    });
    if (!listing.ok) return bad(listing.status, listing.reason);

    const now = new Date();
    const set: Partial<typeof ecommerce_listings.$inferInsert> = {
      model_3d_uploaded_by: auth.actor,
      model_3d_updated_at: now,
    };
    if (target.slot === "glb") {
      set.model_3d_glb_url = publicUrl;
      set.model_3d_file_size = byteSize;
    } else if (target.slot === "usdz") {
      set.model_3d_usdz_url = publicUrl;
    } else {
      set.model_3d_poster_url = publicUrl;
    }
    const db = getDb();
    const [row] = await db
      .update(ecommerce_listings)
      .set(set)
      .where(eq(ecommerce_listings.id, listing.id))
      .returning({
        id: ecommerce_listings.id,
        woo_sku: ecommerce_listings.woo_sku,
        global_sku: ecommerce_listings.global_sku,
        model_3d_glb_url: ecommerce_listings.model_3d_glb_url,
        model_3d_usdz_url: ecommerce_listings.model_3d_usdz_url,
        model_3d_poster_url: ecommerce_listings.model_3d_poster_url,
        model_3d_file_size: ecommerce_listings.model_3d_file_size,
        model_3d_uploaded_by: ecommerce_listings.model_3d_uploaded_by,
        model_3d_updated_at: ecommerce_listings.model_3d_updated_at,
      });
    if (!row) return bad(404, "Listing disappeared during commit");

    if (sha256Hex && (target.slot === "glb" || target.slot === "usdz")) {
      const [mapping] = await db
        .select({ attributes: sku_mappings.attributes, version: sku_mappings.version })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, listing.global_sku))
        .limit(1);
      if (mapping) {
        const prev = (mapping.attributes as Record<string, unknown> | null) ?? {};
        const digestKey =
          target.slot === "glb" ? "model_3d_glb_sha256" : "model_3d_usdz_sha256";
        await db
          .update(sku_mappings)
          .set({
            attributes: { ...prev, [digestKey]: sha256Hex },
            updated_at: now,
            version: (mapping.version ?? 0) + 1,
          })
          .where(eq(sku_mappings.global_sku, listing.global_sku));
      }
    }

    return NextResponse.json({
      ok: true,
      kind: target.kind,
      slot: target.slot,
      publicUrl,
      byteSize,
      sha256: sha256Hex,
      listing: row,
      auditRow: "skipped: product_asset_kind enum has no swatch/3D kind",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Commit failed";
    return bad(502, message);
  }
}
