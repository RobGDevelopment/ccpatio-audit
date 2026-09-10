import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseFetch,
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";

export const CAD_MODELS_BUCKET = "cad-models";
export const PRODUCT_IMAGES_BUCKET = "product-images";
/** Soft gate for v1 CAD uploads (25 MiB). */
export const CAD_MAX_BYTES = 25 * 1024 * 1024;

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = getSupabaseUrl();
  const key = getSupabaseSecretKey();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createSupabaseFetch(key) },
  });
  return adminClient;
}

export function cadObjectPath(globalSku: string, ext: string): string {
  const sku = globalSku.trim().toUpperCase();
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  return `${sku}/${sku}.${cleanExt}`;
}

export async function createCadSignedUpload(input: {
  globalSku: string;
  ext: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const path = cadObjectPath(input.globalSku, input.ext);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(CAD_MODELS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed CAD upload URL");
  }
  return { path, token: data.token, signedUrl: data.signedUrl };
}

export async function downloadCadObject(storagePath: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(CAD_MODELS_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? `Failed to download ${storagePath}`);
  }
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

export async function uploadProductImage(input: {
  globalSku: string;
  buffer: Buffer;
  contentType: string;
  ext: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const safeSku = input.globalSku.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${safeSku}-cad-${Date.now()}.${input.ext}`;
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(fileName, input.buffer, {
      upsert: true,
      contentType: input.contentType,
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(fileName);
  return data.publicUrl;
}
