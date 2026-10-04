import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  product_assets,
  sku_mappings,
  type ProductAssetKind,
} from "@/server/db/schema";

/* ───────────────────────── Kind / bucket policy (blueprint §7.1, §7.3) ───────────────────────── */

export const VAULT_BUCKETS = ["product-images", "product-documents"] as const;
export type VaultBucket = (typeof VAULT_BUCKETS)[number];

export type ImageFormat = "jpeg" | "png" | "webp";
export type VaultFormat = ImageFormat | "pdf";

const MB = 1024 * 1024;

type KindPolicy = {
  bucket: VaultBucket;
  exts: readonly string[];
  maxBytes: number;
  /** Gallery = many rows, no revision uniqueness / supersede. */
  multi: boolean;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"] as const;
const PDF_EXTS = ["pdf"] as const;

export const KIND_POLICY: Record<ProductAssetKind, KindPolicy> = {
  primary_image: { bucket: "product-images", exts: IMAGE_EXTS, maxBytes: 15 * MB, multi: false },
  gallery: { bucket: "product-images", exts: IMAGE_EXTS, maxBytes: 15 * MB, multi: true },
  tear_sheet: { bucket: "product-documents", exts: PDF_EXTS, maxBytes: 25 * MB, multi: false },
  assembly: { bucket: "product-documents", exts: PDF_EXTS, maxBytes: 25 * MB, multi: false },
  care_guide: { bucket: "product-documents", exts: PDF_EXTS, maxBytes: 25 * MB, multi: false },
  warranty: { bucket: "product-documents", exts: PDF_EXTS, maxBytes: 25 * MB, multi: false },
};

export const VAULT_KINDS = Object.keys(KIND_POLICY) as ProductAssetKind[];

const FORMAT_FOR_EXT: Record<string, VaultFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  pdf: "pdf",
};

const MIME_FOR_FORMAT: Record<VaultFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

const SKU_RE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

/* ───────────────────────── Pure validators ───────────────────────── */

export function assertKind(kind: string): ProductAssetKind {
  if (!Object.prototype.hasOwnProperty.call(KIND_POLICY, kind)) {
    throw new Error("Invalid asset kind");
  }
  return kind as ProductAssetKind;
}

export function normalizeVaultSku(raw: string): string {
  const sku = String(raw ?? "").trim().toUpperCase();
  if (sku.includes("\0") || sku.includes("..") || /[\\/]/.test(sku) || !SKU_RE.test(sku)) {
    throw new Error("Invalid SKU for asset path");
  }
  return sku;
}

/** Strips `/`, `\`, `..` and NULs; keeps only the final path segment. */
export function sanitizeAssetFilename(filename: string): string {
  const last = String(filename ?? "")
    .replace(/\0/g, "")
    .split(/[\\/]/)
    .pop() ?? "";
  return last.replace(/\.\./g, "").trim();
}

/** Extension comes from the FINAL segment only, so `manual.pdf.exe` yields `exe`. */
export function extensionOf(cleanFilename: string): string {
  const idx = cleanFilename.lastIndexOf(".");
  if (idx <= 0 || idx === cleanFilename.length - 1) return "";
  return cleanFilename.slice(idx + 1).toLowerCase();
}

export function assertBucketAllowed(bucket: string, expected: VaultBucket): VaultBucket {
  if (!(VAULT_BUCKETS as readonly string[]).includes(bucket) || bucket !== expected) {
    throw new Error("Invalid bucket requested");
  }
  return bucket as VaultBucket;
}

/** Magic-byte sniff. Returns the real format or null. */
export function sniffFormat(buf: Uint8Array): VaultFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return "webp";
  }
  if (
    buf.length >= 5 &&
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d // %PDF-
  ) {
    return "pdf";
  }
  return null;
}

export function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** `{sku}/{kind}/{revision}-{random}.{ext}` — the browser never picks this. */
export function buildStorageKey(sku: string, kind: ProductAssetKind, revision: number, ext: string): string {
  return `${sku}/${kind}/${revision}-${randomBytes(8).toString("hex")}.${ext}`;
}

/* ───────────────────────── Upload planning ───────────────────────── */

export type PlannedUpload = {
  sku: string;
  kind: ProductAssetKind;
  bucket: VaultBucket;
  path: string;
  ext: string;
  cleanFilename: string;
  revision: number;
};

export async function planAssetUpload(input: {
  globalSku: string;
  kind: string;
  filename: string;
  /** Optional legacy hint; if sent it must be allowlisted AND match the kind's bucket. */
  bucket?: string;
  byteSize?: number;
}): Promise<PlannedUpload> {
  const kind = assertKind(input.kind);
  const policy = KIND_POLICY[kind];
  const bucket = assertBucketAllowed(input.bucket ?? policy.bucket, policy.bucket);

  const sku = normalizeVaultSku(input.globalSku);
  const cleanFilename = sanitizeAssetFilename(input.filename);
  const ext = extensionOf(cleanFilename);
  if (!ext || !policy.exts.includes(ext)) {
    throw new Error("Invalid file extension");
  }
  if (input.byteSize !== undefined) {
    if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) throw new Error("Invalid file size");
    if (input.byteSize > policy.maxBytes) {
      throw new Error(`File exceeds the ${Math.round(policy.maxBytes / MB)} MB limit`);
    }
  }

  const db = getDb();
  const [mapping] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) throw new Error(`Unknown product SKU ${sku}`);

  const [top] = await db
    .select({ revision: product_assets.revision })
    .from(product_assets)
    .where(and(eq(product_assets.global_sku, sku), eq(product_assets.kind, kind)))
    .orderBy(desc(product_assets.revision))
    .limit(1);
  const revision = policy.multi ? 1 : (top?.revision ?? 0) + 1;

  return {
    sku,
    kind,
    bucket,
    ext,
    cleanFilename,
    revision,
    path: buildStorageKey(sku, kind, revision, ext),
  };
}

/* ───────────────────────── Confirm + revision engine ───────────────────────── */

export type VaultStorage = {
  download(bucket: VaultBucket, path: string): Promise<{ bytes: Uint8Array; contentType?: string | null }>;
  remove(bucket: VaultBucket, path: string): Promise<void>;
  publicUrl(bucket: VaultBucket, path: string): string;
};

export type ConfirmAssetInput = {
  globalSku: string;
  kind: string;
  /** Object key returned by requestAssetUpload. Re-validated against the exact key shape. */
  storagePath: string;
  originalFilename: string;
  altText?: string | null;
};

export type ConfirmedAsset = {
  id: string;
  globalSku: string;
  kind: ProductAssetKind;
  revision: number;
  sha256: string;
  storagePath: string;
  contentType: string;
  byteSize: number;
  isCurrent: boolean;
  /** Row that this revision superseded (null for first revision / gallery). */
  supersededId: string | null;
  supersededRevision: number | null;
  publicUrl: string | null;
};

function keyPattern(sku: string, kind: string, exts: readonly string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc(sku)}/${esc(kind)}/\\d{1,6}-[a-f0-9]{16}\\.(${exts.join("|")})$`);
}

/**
 * Runs AFTER the browser upload. Reads the object, checks size + magic bytes +
 * content-type, hashes it, then (in one transaction, serialized per sku+kind)
 * inserts the next revision as current and supersedes the previous current row.
 * The uploaded object is deleted if ANY check or the transaction fails; a row never
 * exists for a file that failed the sniff. Previous revisions' objects are kept.
 */
export async function confirmAssetCore(
  input: ConfirmAssetInput,
  storage: VaultStorage,
): Promise<ConfirmedAsset> {
  const kind = assertKind(input.kind);
  const policy = KIND_POLICY[kind];
  const sku = normalizeVaultSku(input.globalSku);
  const cleanFilename = sanitizeAssetFilename(input.originalFilename);
  const ext = extensionOf(cleanFilename);
  if (!ext || !policy.exts.includes(ext)) throw new Error("Invalid file extension");

  const path = String(input.storagePath ?? "");
  if (!keyPattern(sku, kind, policy.exts).test(path)) {
    // Not a key we issued — never touch (or delete) an object we can't vouch for.
    throw new Error("Invalid storage path for this asset");
  }
  const bucket = policy.bucket;

  const reject = async (message: string): Promise<never> => {
    try {
      await storage.remove(bucket, path);
    } catch {
      /* best effort */
    }
    throw new Error(message);
  };

  let downloaded: Awaited<ReturnType<VaultStorage["download"]>>;
  try {
    downloaded = await storage.download(bucket, path);
  } catch {
    throw new Error("Uploaded file was not found in storage");
  }
  const bytes = downloaded.bytes;

  if (bytes.length === 0) return reject("Uploaded file is empty");
  if (bytes.length > policy.maxBytes) {
    return reject(`File exceeds the ${Math.round(policy.maxBytes / MB)} MB limit`);
  }

  // 1. Magic bytes must match the extension (a .pdf must be a PDF, an image an image).
  const expectedFormat = FORMAT_FOR_EXT[ext];
  const actualFormat = sniffFormat(bytes);
  if (!actualFormat || actualFormat !== expectedFormat) {
    return reject(
      actualFormat
        ? `File contents are ${actualFormat.toUpperCase()}, which does not match the .${ext} extension`
        : `File contents are not a valid ${expectedFormat.toUpperCase()}`,
    );
  }

  // 1b. Declared content-type may not disagree with the extension. Generic or absent
  // types are tolerated because storage does not always echo the browser's type.
  const declared = (downloaded.contentType ?? "").split(";")[0].trim().toLowerCase();
  const canonicalMime = MIME_FOR_FORMAT[actualFormat];
  if (declared && declared !== "application/octet-stream" && declared !== canonicalMime) {
    if (!(actualFormat === "jpeg" && declared === "image/jpg")) {
      return reject(`Content type ${declared} does not match the .${ext} extension`);
    }
  }

  // 2. Hash
  const sha256 = sha256Hex(bytes);

  // 3. Revision logic
  const db = getDb();
  let confirmed: Omit<ConfirmedAsset, "publicUrl">;
  try {
    confirmed = await db.transaction(async (tx) => {
      // Serialize concurrent confirms for this (sku, kind).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${sku}:${kind}`}, 0))`,
      );

      const [mapping] = await tx
        .select({ sku: sku_mappings.global_sku })
        .from(sku_mappings)
        .where(eq(sku_mappings.global_sku, sku))
        .limit(1);
      if (!mapping) throw new Error(`Unknown product SKU ${sku}`);

      const now = new Date();
      let revision = 1;
      let supersededId: string | null = null;
      let supersededRevision: number | null = null;
      let sortOrder: number | null = null;

      if (!policy.multi) {
        const [top] = await tx
          .select({ revision: product_assets.revision })
          .from(product_assets)
          .where(and(eq(product_assets.global_sku, sku), eq(product_assets.kind, kind)))
          .orderBy(desc(product_assets.revision))
          .limit(1);
        revision = (top?.revision ?? 0) + 1;

        const superseded = await tx
          .update(product_assets)
          .set({ is_current: false, superseded_at: now, updated_at: now })
          .where(
            and(
              eq(product_assets.global_sku, sku),
              eq(product_assets.kind, kind),
              eq(product_assets.is_current, true),
            ),
          )
          .returning({ id: product_assets.id, revision: product_assets.revision });
        if (superseded[0]) {
          supersededId = superseded[0].id;
          supersededRevision = superseded[0].revision;
        }
      } else {
        const [top] = await tx
          .select({ sort: sql<number | null>`max(${product_assets.sort_order})` })
          .from(product_assets)
          .where(and(eq(product_assets.global_sku, sku), eq(product_assets.kind, kind)));
        sortOrder = (top?.sort ?? 0) + 1;
      }

      const [row] = await tx
        .insert(product_assets)
        .values({
          global_sku: sku,
          kind,
          storage_path: path,
          original_filename: cleanFilename,
          content_type: canonicalMime,
          byte_size: bytes.length,
          revision,
          sha256,
          is_current: true,
          superseded_at: null,
          sort_order: sortOrder,
          alt_text: input.altText?.trim() || null,
        })
        .returning({ id: product_assets.id });

      if (kind === "primary_image") {
        const url = storage.publicUrl(bucket, path);
        await tx
          .insert(finished_goods_catalog)
          .values({ global_sku: sku, image_url: url })
          .onConflictDoUpdate({
            target: finished_goods_catalog.global_sku,
            set: { image_url: url, updated_at: now },
          });
      }

      return {
        id: row.id,
        globalSku: sku,
        kind,
        revision,
        sha256,
        storagePath: path,
        contentType: canonicalMime,
        byteSize: bytes.length,
        isCurrent: true,
        supersededId,
        supersededRevision,
      };
    });
  } catch (err) {
    // Roll back the object too; a failed confirm must not leave an orphan.
    try {
      await storage.remove(bucket, path);
    } catch {
      /* best effort */
    }
    throw err;
  }

  return { ...confirmed, publicUrl: policy.bucket === "product-images" ? storage.publicUrl(bucket, path) : null };
}

/* ───────────────────────── Read model ───────────────────────── */

export type VaultAssetView = {
  id: string;
  kind: ProductAssetKind;
  revision: number;
  filename: string;
  sha256: string | null;
  byteSize: number;
  contentType: string;
  effectiveOn: string;
  isCurrent: boolean;
  supersededAt: string | null;
  createdAt: string;
  sortOrder: number | null;
  altText: string | null;
  storagePath: string;
};

export async function listVaultAssets(globalSku: string): Promise<VaultAssetView[]> {
  const sku = normalizeVaultSku(globalSku);
  const db = getDb();
  const rows = await db
    .select()
    .from(product_assets)
    .where(eq(product_assets.global_sku, sku))
    // Gallery rows are ordered by sort_order (NULLs last for the revisioned kinds), then newest revision.
    .orderBy(asc(product_assets.sort_order), desc(product_assets.revision), desc(product_assets.created_at));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    revision: r.revision,
    filename: r.original_filename,
    sha256: r.sha256,
    byteSize: r.byte_size,
    contentType: r.content_type,
    effectiveOn: r.effective_on,
    isCurrent: r.is_current,
    supersededAt: r.superseded_at ? r.superseded_at.toISOString() : null,
    createdAt: r.created_at.toISOString(),
    sortOrder: r.sort_order,
    altText: r.alt_text,
    storagePath: r.storage_path,
  }));
}

/* ───────────────────────── Gallery maintenance ───────────────────────── */

export const ALT_TEXT_MAX = 300;

/** Hard-deletes ONE gallery image (row + object). Revisioned kinds are append-only and cannot be deleted. */
export async function deleteGalleryAssetCore(
  input: { globalSku: string; assetId: string },
  storage: Pick<VaultStorage, "remove">,
): Promise<{ id: string; storagePath: string }> {
  const sku = normalizeVaultSku(input.globalSku);
  const db = getDb();
  const [row] = await db
    .select({ id: product_assets.id, storagePath: product_assets.storage_path })
    .from(product_assets)
    .where(
      and(
        eq(product_assets.id, input.assetId),
        eq(product_assets.global_sku, sku),
        eq(product_assets.kind, "gallery"),
      ),
    );
  if (!row) throw new Error("Gallery image not found");
  
  await storage.remove(KIND_POLICY.gallery.bucket, row.storagePath);
  
  await db
    .delete(product_assets)
    .where(eq(product_assets.id, input.assetId));
  return row;
}

/** Alt text for gallery / primary images only. Empty string clears it. */
export async function updateAssetAltTextCore(input: {
  globalSku: string;
  assetId: string;
  altText: string;
}): Promise<string | null> {
  const sku = normalizeVaultSku(input.globalSku);
  const alt = String(input.altText ?? "").replace(/\s+/g, " ").trim();
  if (alt.length > ALT_TEXT_MAX) throw new Error(`Alt text is limited to ${ALT_TEXT_MAX} characters.`);
  const db = getDb();
  const [row] = await db
    .update(product_assets)
    .set({ alt_text: alt || null, updated_at: new Date() })
    .where(
      and(
        eq(product_assets.id, input.assetId),
        eq(product_assets.global_sku, sku),
        sql`${product_assets.kind} in ('gallery', 'primary_image')`,
      ),
    )
    .returning({ alt: product_assets.alt_text });
  if (!row) throw new Error("Image not found");
  return row.alt;
}
