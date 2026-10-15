import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { custom_build_jobs, sku_mappings } from "@/server/db/schema";
import {
  PRODUCT_DOCUMENTS_BUCKET,
  createAssetSignedUpload,
  createAssetSignedDownload,
  getVaultStorage,
} from "@/lib/supabase-storage";
import { PACKET_MAX_BYTES } from "@/lib/intake/files";
import { resolveIntakeActor } from "./actor";
import { IntakeDomainError } from "./errors";
import { logPimAudit, GHL_EMBED_PRINCIPAL_EMAIL } from "@/lib/pim-audit";
import type { ReleaseDb } from "@/server/path-a/release-store";

export type PacketStorageAdapter = {
  download(bucket: string, path: string): Promise<{ bytes: Uint8Array; contentType?: string | null }>;
  remove(bucket: string, path: string): Promise<void>;
  createSignedUpload?(input: { bucket: string; path: string }): Promise<{ path: string; token: string; signedUrl: string }>;
  createSignedDownload?(bucket: string, path: string, expiresInSeconds: number): Promise<string | null>;
};

export type RequestPacketUploadInput = {
  intakeKey?: string;
  sku: string;
  filename: string;
  byteSize: number;
  reportedUserEmail?: string;
};

export type RequestPacketUploadResult = {
  uploadUrl: string;
  storagePath: string;
};

export type ConfirmPacketUploadInput = {
  sku: string;
  storagePath: string;
  originalFilename: string;
  reportedUserEmail?: string;
};

export type ConfirmPacketUploadResult = {
  confirmed: boolean;
  path: string;
  sha256?: string;
  bytes?: number;
  replayed?: boolean;
  deduped?: boolean;
};

export type GetPacketDownloadLinkInput = {
  sku: string;
  reportedUserEmail?: string;
};

export type GetPacketDownloadLinkResult = {
  downloadUrl: string;
};

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function isValidPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d    // -
  );
}

function validatePdfExtension(filename: string): void {
  const clean = filename.trim().toLowerCase();
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1 || clean.slice(lastDot) !== ".pdf") {
    throw new IntakeDomainError("PDF_INVALID");
  }
}

const STORAGE_PATH_REGEX = /^factory-packets\/([a-zA-Z0-9_-]+)\/(\d+)-([0-9a-f]{16})\.pdf$/;

export async function requestPacketUpload(
  input: RequestPacketUploadInput,
  options?: {
    db?: ReleaseDb;
    storage?: PacketStorageAdapter;
  }
): Promise<RequestPacketUploadResult> {
  const actorRes = await resolveIntakeActor({ reportedEmail: input.reportedUserEmail });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }

  validatePdfExtension(input.filename);

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    throw new IntakeDomainError("VALIDATION", "Invalid file size");
  }
  if (input.byteSize > PACKET_MAX_BYTES) {
    throw new IntakeDomainError("FILE_TOO_LARGE");
  }

  const db = options?.db ?? getDb();
  const sku = input.sku.trim().toUpperCase();

  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!mapping) {
    throw new IntakeDomainError("VALIDATION", `Piece not found: ${sku}`);
  }

  const rawAttrs = mapping.attributes as Record<string, unknown> | null;
  const jobId = (rawAttrs?.job_id as string) || (rawAttrs?.intake as { jobId?: string })?.jobId;

  if (!jobId) {
    throw new IntakeDomainError("PROJECT_REQUIRED", "No custom build job associated with this piece");
  }

  const random16hex = crypto.randomBytes(8).toString("hex");
  const storagePath = `factory-packets/${jobId}/${Date.now()}-${random16hex}.pdf`;

  // Enforce append-only storage policy (upsert: false)
  if (options?.storage?.createSignedUpload) {
    const signed = await options.storage.createSignedUpload({
      bucket: PRODUCT_DOCUMENTS_BUCKET,
      path: storagePath,
    });
    return {
      uploadUrl: signed.signedUrl,
      storagePath,
    };
  }

  // createAssetSignedUpload internally uses { upsert: false }
  const signed = await createAssetSignedUpload({
    bucket: PRODUCT_DOCUMENTS_BUCKET,
    path: storagePath,
  });

  return {
    uploadUrl: signed.signedUrl,
    storagePath,
  };
}

export async function confirmPacketUpload(
  input: ConfirmPacketUploadInput,
  options?: {
    db?: ReleaseDb;
    storage?: PacketStorageAdapter;
  }
): Promise<ConfirmPacketUploadResult> {
  const actorRes = await resolveIntakeActor({ reportedEmail: input.reportedUserEmail });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }
  const actor = actorRes.actor;
  const isEmbed = actor.source !== "operator";
  const effectiveEmail = isEmbed ? GHL_EMBED_PRINCIPAL_EMAIL : actor.email;

  const db = options?.db ?? getDb();
  const storage = options?.storage ?? getVaultStorage();
  const sku = input.sku.trim().toUpperCase();

  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!mapping) {
    throw new IntakeDomainError("VALIDATION", `Piece not found: ${sku}`);
  }

  const rawAttrs = mapping.attributes as Record<string, unknown> | null;
  const jobId = (rawAttrs?.job_id as string) || (rawAttrs?.intake as { jobId?: string })?.jobId;

  if (!jobId) {
    throw new IntakeDomainError("PROJECT_REQUIRED", "No custom build job associated with this piece");
  }

  // Key format check: must match ^factory-packets/{jobId}/…\.pdf$ for THAT job
  const match = input.storagePath.match(STORAGE_PATH_REGEX);
  if (!match || match[1] !== jobId) {
    throw new IntakeDomainError("PDF_INVALID", "Storage path does not match job");
  }

  // Check replay
  const [job] = await db
    .select()
    .from(custom_build_jobs)
    .where(eq(custom_build_jobs.id, jobId))
    .limit(1);

  if (job?.packet_storage_path === input.storagePath) {
    return {
      confirmed: true,
      path: input.storagePath,
      replayed: true,
    };
  }

  // Download object to verify
  let bytes: Uint8Array;
  try {
    const downloaded = await storage.download(PRODUCT_DOCUMENTS_BUCKET, input.storagePath);
    bytes = downloaded.bytes;
  } catch (err: unknown) {
    console.error(
      JSON.stringify({
        tag: "packet-storage-download-error",
        bucket: PRODUCT_DOCUMENTS_BUCKET,
        path: input.storagePath,
        errorName: err instanceof Error ? err.name : "UnknownError",
      })
    );
    throw new IntakeDomainError("STORAGE_FAILED", "Failed to retrieve uploaded packet");
  }

  // Check size limit
  if (bytes.length > PACKET_MAX_BYTES) {
    await storage.remove(PRODUCT_DOCUMENTS_BUCKET, input.storagePath).catch((err: unknown) => {
      console.error(JSON.stringify({
        tag: "packet-storage-remove-error",
        bucket: PRODUCT_DOCUMENTS_BUCKET,
        path: input.storagePath,
        reason: "file_too_large",
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
    });
    throw new IntakeDomainError("FILE_TOO_LARGE");
  }

  // Check magic bytes %PDF-
  if (!isValidPdfMagicBytes(bytes)) {
    await storage.remove(PRODUCT_DOCUMENTS_BUCKET, input.storagePath).catch((err: unknown) => {
      console.error(JSON.stringify({
        tag: "packet-storage-remove-error",
        bucket: PRODUCT_DOCUMENTS_BUCKET,
        path: input.storagePath,
        reason: "pdf_invalid",
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
    });
    throw new IntakeDomainError("PDF_INVALID");
  }

  const hash = sha256Hex(bytes);

  // Check deduplication against existing packet on this piece
  const existingPacket = (rawAttrs?.intake as { packet?: { path?: string; sha256?: string } })?.packet;
  if (existingPacket?.sha256 === hash && existingPacket.path && existingPacket.path !== input.storagePath) {
    // Redundant duplicate: remove new object and return existing
    await storage.remove(PRODUCT_DOCUMENTS_BUCKET, input.storagePath).catch((err: unknown) => {
      console.error(JSON.stringify({
        tag: "packet-storage-remove-error",
        bucket: PRODUCT_DOCUMENTS_BUCKET,
        path: input.storagePath,
        reason: "deduped",
        errorName: err instanceof Error ? err.name : "UnknownError",
      }));
    });
    return {
      confirmed: true,
      path: existingPacket.path,
      sha256: hash,
      bytes: bytes.length,
      deduped: true,
    };
  }

  // In one transaction: update job and sku_mappings
  await db.transaction(async (tx) => {
    await tx
      .update(custom_build_jobs)
      .set({
        packet_storage_path: input.storagePath,
        updated_at: new Date(),
      })
      .where(eq(custom_build_jobs.id, jobId));

    const currentAttrs = (mapping.attributes as Record<string, unknown>) || {};
    const currentIntake = (currentAttrs.intake as Record<string, unknown>) || {};

    const updatedAttrs = {
      ...currentAttrs,
      intake: {
        ...currentIntake,
        packet: {
          path: input.storagePath,
          sha256: hash,
          bytes: bytes.length,
          filename: input.originalFilename,
          uploadedAt: new Date().toISOString(),
          actor: {
            email: effectiveEmail,
            source: actor.source,
            verified: actor.verified,
          },
        },
      },
    };

    await tx
      .update(sku_mappings)
      .set({
        attributes: updatedAttrs,
        updated_by: effectiveEmail,
      })
      .where(eq(sku_mappings.global_sku, sku));
  });

  return {
    confirmed: true,
    path: input.storagePath,
    sha256: hash,
    bytes: bytes.length,
  };
}

export async function getPacketDownloadLink(
  input: GetPacketDownloadLinkInput,
  options?: {
    db?: ReleaseDb;
    storage?: PacketStorageAdapter;
  }
): Promise<GetPacketDownloadLinkResult> {
  const actorRes = await resolveIntakeActor({ reportedEmail: input.reportedUserEmail });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }
  const actor = actorRes.actor;
  const isEmbed = actor.source !== "operator";
  const effectiveEmail = isEmbed ? GHL_EMBED_PRINCIPAL_EMAIL : actor.email;
  const operatorName = isEmbed ? "Unverified Embed User" : null;

  const db = options?.db ?? getDb();
  const sku = input.sku.trim().toUpperCase();

  const [mapping] = await db
    .select()
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);

  if (!mapping) {
    throw new IntakeDomainError("VALIDATION", `Piece not found: ${sku}`);
  }

  const rawAttrs = mapping.attributes as Record<string, unknown> | null;
  const packetMeta = (rawAttrs?.intake as { packet?: { path?: string; filename?: string } })?.packet;
  const storagePath = packetMeta?.path;

  if (!storagePath) {
    throw new IntakeDomainError("FILE_REQUIRED", "No packet exists for this piece");
  }

  let downloadUrl: string | null = null;
  if (options?.storage?.createSignedDownload) {
    downloadUrl = await options.storage.createSignedDownload(
      PRODUCT_DOCUMENTS_BUCKET,
      storagePath,
      300
    );
  } else {
    downloadUrl = await createAssetSignedDownload(
      PRODUCT_DOCUMENTS_BUCKET,
      storagePath,
      300
    );
  }

  if (!downloadUrl) {
    throw new IntakeDomainError("STORAGE_FAILED", "Failed to generate download link");
  }

  await logPimAudit({
    operatorEmail: effectiveEmail,
    operatorName,
    globalSku: sku,
    action: "intake.packet_viewed",
    newValue: JSON.stringify({
      path: storagePath,
      reportedEmail: isEmbed ? actor.email : undefined,
      verified: !isEmbed,
    }),
  }).catch((err: unknown) => {
    console.error(JSON.stringify({
      tag: "pim-audit-error",
      where: "getPacketDownloadUrl:logPimAudit",
      errorName: err instanceof Error ? err.name : "UnknownError",
    }));
  });

  return { downloadUrl };
}
