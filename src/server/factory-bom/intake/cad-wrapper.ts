import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { cad_uploads, type CadUploadStatus } from "@/server/db/schema";
import {
  requestCadUpload,
  confirmCadUpload,
  getLatestCadUpload,
} from "@/app/admin/factory-bom/actions";
import { IntakeDomainError } from "./errors";
import { resolveIntakeActor } from "./actor";
import type { ReleaseDb } from "@/server/path-a/release-store";

export type RequestCadWrapperInput = {
  sku: string;
  filename: string;
  byteSize: number;
  sha256?: string;
  reportedUserEmail?: string;
};

export type RequestCadWrapperResult =
  | {
      reused: true;
      uploadId: string;
      status: CadUploadStatus;
    }
  | {
      reused: false;
      uploadId: string;
      signedUrl: string;
      storagePath: string;
      token: string;
      targetFilename: string;
    };

export type ConfirmCadWrapperInput = {
  uploadId: string;
  reportedUserEmail?: string;
};

export type ConfirmCadWrapperResult = {
  ok: true;
  status?: CadUploadStatus;
};

const REUSABLE_STATUSES: CadUploadStatus[] = [
  "queued",
  "processing",
  "draft_ready",
];

function mapAdminErrorToDomainError(adminError: string): IntakeDomainError {
  const lower = adminError.toLowerCase();
  if (lower.includes("sign in")) {
    return new IntakeDomainError("NOT_SIGNED_IN");
  }
  if (lower.includes("limit") || lower.includes("exceeds") || lower.includes("too large")) {
    return new IntakeDomainError("FILE_TOO_LARGE");
  }
  if (lower.includes("accepted") || lower.includes("extension") || lower.includes("cad file")) {
    return new IntakeDomainError("FILE_TYPE");
  }
  if (lower.includes("sku not found") || lower.includes("finished_good") || lower.includes("required")) {
    return new IntakeDomainError("VALIDATION");
  }
  return new IntakeDomainError("STORAGE_FAILED");
}

export async function requestCadUploadWrapper(
  input: RequestCadWrapperInput,
  options?: {
    db?: ReleaseDb;
  }
): Promise<RequestCadWrapperResult> {
  const actorRes = await resolveIntakeActor({ reportedEmail: input.reportedUserEmail });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }

  const sku = input.sku.trim().toUpperCase();
  const db = options?.db ?? getDb();

  // Idempotency: check if already uploaded with same sha256
  if (input.sha256) {
    const existing = await db
      .select()
      .from(cad_uploads)
      .where(
        and(
          eq(cad_uploads.global_sku, sku),
          eq(cad_uploads.sha256, input.sha256),
          inArray(cad_uploads.status, REUSABLE_STATUSES)
        )
      )
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      return {
        reused: true,
        uploadId: existing[0].id,
        status: existing[0].status,
      };
    }
  }

  const validatedEmail =
    actorRes.actor.source === "embed-reported" ? actorRes.actor.email : undefined;

  const result = await requestCadUpload({
    globalSku: sku,
    filename: input.filename,
    byteSize: input.byteSize,
    sha256: input.sha256,
    forceRename: true,
    actorEmail: validatedEmail,
  });

  if (!result.ok) {
    throw mapAdminErrorToDomainError(result.error);
  }

  return {
    reused: false,
    uploadId: result.uploadId,
    signedUrl: result.signedUrl,
    storagePath: result.path,
    token: result.token,
    targetFilename: result.targetFilename,
  };
}

export async function confirmCadUploadWrapper(
  input: ConfirmCadWrapperInput
): Promise<ConfirmCadWrapperResult> {
  const actorRes = await resolveIntakeActor({ reportedEmail: input.reportedUserEmail });
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }

  const validatedEmail =
    actorRes.actor.source === "embed-reported" ? actorRes.actor.email : undefined;

  const result = await confirmCadUpload(input.uploadId, validatedEmail);
  if (!result.ok) {
    throw mapAdminErrorToDomainError(result.error);
  }

  return {
    ok: true,
    status: result.status,
  };
}

export async function getLatestCadUploadWrapper(sku: string) {
  const actorRes = await resolveIntakeActor();
  if (!actorRes.ok) {
    throw new IntakeDomainError("NOT_SIGNED_IN");
  }
  return getLatestCadUpload(sku);
}
