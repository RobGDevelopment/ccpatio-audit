"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getPimSession } from "@/lib/pim-audit";
import { upsertCatalogImageUrl } from "@/lib/catalog-image";
import { variantImageObjectName, VARIANT_IMAGE_MAX_BYTES } from "@/lib/product-image-url";
import {
  PRODUCT_IMAGES_BUCKET,
  getSupabaseAdmin,
  uploadMaterialImage,
} from "@/lib/supabase-storage";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";
import { fetchHoldOpportunity, resolveHoldActor } from "@/server/ghl/hold-actor";
import { searchHoldTargets, type HoldSearchHit } from "@/server/ghl/search-hold-targets";
import { createHold } from "@/server/stock/create-hold";
import {
  listShowroomCategoryItems as loadShowroomCategoryItems,
  listShowroomCollections as loadShowroomCollections,
  searchShowroomStock as loadShowroomStock,
  type ShowroomStockFilter,
} from "@/server/showroom/stock";

export type { ShowroomStockFilter };

export async function listShowroomCategoryItems() {
  return loadShowroomCategoryItems();
}

export async function listShowroomCollections(filter: ShowroomStockFilter) {
  return loadShowroomCollections(filter);
}

export async function searchShowroomStock(input: {
  query?: string;
  filter?: ShowroomStockFilter;
  collection?: string;
}) {
  return loadShowroomStock(input);
}

export type { HoldSearchHit };

export async function searchGhlHoldTargets(
  query: string,
): Promise<{ ok: true; results: HoldSearchHit[] } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to search opportunities." };
  return searchHoldTargets(query);
}

export async function resolveShowroomHoldActor(input: {
  ghlUserId?: string;
  ghlUserEmail?: string;
}): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const actor = await resolveHoldActor(input);
  if (!actor.ok) return actor;
  return { ok: true, name: actor.ghlUserName };
}

export async function placeShowroomHold(input: {
  variantId: number;
  sku: string;
  qty: number;
  ghlOpportunityId: string;
  note: string;
  ghlUserId?: string;
  ghlUserEmail?: string;
}) {
  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return actor;

  const opportunity = await fetchHoldOpportunity(input.ghlOpportunityId);
  if (!opportunity.ok) return opportunity;

  const result = await createHold({
    variantId: input.variantId,
    sku: input.sku,
    qty: input.qty,
    note: input.note,
    actor,
    opportunity,
  });
  if (result.ok) {
    revalidatePath("/showroom");
    revalidatePath("/embed/showroom");
  }
  return result;
}

const SHOWROOM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function imageExt(file: File): string | null {
  const fromName = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".") + 1)
    : "";
  const ext = fromName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (ext === "jpeg" || ext === "jpg") return "jpg";
  if (ext === "png" || ext === "webp" || ext === "gif") return ext;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return null;
}

export async function uploadShowroomStockImage(
  formData: FormData,
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to upload an image." };

  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required." };

  const image = formData.get("image");
  if (!(image instanceof File) || image.size <= 0) {
    return { ok: false, error: "Choose an image file." };
  }
  if (!image.type.startsWith("image/")) {
    return { ok: false, error: "Only image uploads are allowed." };
  }
  if (image.size > SHOWROOM_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image must be 8 MB or smaller." };
  }
  const ext = imageExt(image);
  if (!ext) return { ok: false, error: "Only image uploads are allowed." };

  const db = getDb();
  const [mapping] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) return { ok: false, error: `SKU not found: ${sku}` };

  const imageUrl = await uploadMaterialImage({
    globalSku: sku,
    buffer: Buffer.from(await image.arrayBuffer()),
    contentType: image.type || "application/octet-stream",
    ext,
  });
  const write = await upsertCatalogImageUrl({
    globalSku: sku,
    imageUrl,
    updatedBy: session.email,
  });
  if (write === "missing-sku") return { ok: false, error: `SKU not found: ${sku}` };

  revalidatePath("/showroom");
  revalidatePath("/embed/showroom");
  return { ok: true, imageUrl };
}

const VARIANT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Signed upload for `{SKU}.jpg` in product-images. The browser client performs the put. */
export async function requestVariantImageUpload(input: {
  sku: string;
  byteSize: number;
  contentType: string;
}): Promise<
  | { ok: true; path: string; token: string }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to upload an image." };

  const path = variantImageObjectName(input.sku);
  if (!path) return { ok: false, error: "SKU is required." };

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "Choose an image file." };
  }
  if (input.byteSize > VARIANT_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller." };
  }
  if (!VARIANT_IMAGE_TYPES.has(input.contentType)) {
    return { ok: false, error: "Use a JPG, PNG, or WebP image." };
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (error || !data?.token) {
      return { ok: false, error: error?.message ?? "Could not start the upload." };
    }
    return { ok: true, path, token: data.token };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not start the upload.";
    return { ok: false, error: message };
  }
}
