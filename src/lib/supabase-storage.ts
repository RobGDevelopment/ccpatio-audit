import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseFetch,
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";

export const CAD_MODELS_BUCKET = "cad-models";
export const PRODUCT_IMAGES_BUCKET = "product-images";
export const PRODUCT_DOCUMENTS_BUCKET = "product-documents";
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

/**
 * Signs an upload to a SERVER-generated object key. `upsert: false` so a signed URL
 * can never overwrite an existing object (revisions are append-only).
 */
export async function createAssetSignedUpload(input: {
  bucket: string;
  path: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(input.bucket)
    .createSignedUploadUrl(input.path, { upsert: false });
  if (error || !data) {
    throw new Error(error?.message ?? `Failed to create signed upload URL for ${input.bucket}`);
  }
  return { path: input.path, token: data.token, signedUrl: data.signedUrl };
}

/**
 * Signs an upload with `upsert: true` for Asset Studio (swatch / 3D slots). Object keys are
 * server-generated with a random suffix by `presign-policy`, so overwrite is only possible
 * for a key the caller was just issued.
 */
export async function createSignedUploadUrlUpsert(
  bucket: string,
  path: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? `Failed to create signed upload URL for ${bucket}`);
  }
  return { path, token: data.token, signedUrl: data.signedUrl };
}

/** Public URL for an object in a public bucket (no network call). */
export function getPublicObjectUrl(bucket: string, path: string): string {
  return getSupabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Looks up object metadata (size / mimetype) via a directory listing. Returns null when the
 * object does not exist. Throws on storage errors so callers never mistake an outage for "missing".
 */
export async function getStorageObjectInfo(
  bucket: string,
  path: string,
): Promise<{ size: number | null; contentType: string | null } | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .list(dir, { limit: 100, search: name });
  if (error) throw new Error(error.message);
  const hit = (data ?? []).find((o) => o.name === name);
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
  return {
    size: typeof meta.size === "number" ? meta.size : null,
    contentType: typeof meta.mimetype === "string" ? meta.mimetype : null,
  };
}

/** Service-role storage adapter used by the asset vault confirm step. */
export function getVaultStorage() {
  return {
    async download(bucket: string, path: string) {
      const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(path);
      if (error || !data) throw new Error(error?.message ?? `Failed to download ${path}`);
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        contentType: data.type || null,
      };
    },
    async remove(bucket: string, path: string) {
      const { error } = await getSupabaseAdmin().storage.from(bucket).remove([path]);
      if (error) throw new Error(error.message);
    },
    publicUrl(bucket: string, path: string) {
      return getSupabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

/** Short-lived download link for private (document) buckets. */
export async function createAssetSignedDownload(
  bucket: string,
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
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

export function materialObjectPath(globalSku: string, ext: string): string {
  const sku = globalSku.trim().toUpperCase().replace(/[^A-Z0-9._-]/g, "_");
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  return `materials/${sku}.${cleanExt}`;
}

export async function uploadMaterialImage(input: {
  globalSku: string;
  buffer: Buffer;
  contentType: string;
  ext: string;
}): Promise<string> {
  const supabase = getSupabaseAdmin();
  const path = materialObjectPath(input.globalSku, input.ext);
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, input.buffer, {
      upsert: true,
      contentType: input.contentType,
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
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
