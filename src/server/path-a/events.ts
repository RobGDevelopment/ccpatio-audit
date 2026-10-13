/**
 * Phase 11 Path A event names, deterministic event id builders, and validation schemas.
 * Pure: no I/O, no env imports. All event IDs flow through inngestEventId.
 */
import { z } from "zod";
import { inngestEventId } from "@/server/sre/idempotency";

export const PATH_A_SAGA_TYPE = "path_a_cad" as const;

// Inngest Event Names
export const CAD_CONVERT_COMPLETED_EVENT = "cad/convert.completed" as const;
export const PATH_A_DESIGN_FINALIZED_EVENT = "path-a/design.finalized" as const;
export const PATH_A_RELEASE_TO_PRODUCTION_EVENT = "path-a/release-to-production" as const;
export const PATH_A_RELEASE_COMPLETED_EVENT = "path-a/release.completed" as const;
export const PATH_A_GHL_SYNC_REQUESTED_EVENT = "path-a/ghl.sync.requested" as const;

export type PathAReleaseSource = "management_override" | "customer_deposit";

// Event ID Builders
export function cadConvertCompletedEventId(uploadId: string, status: string): string {
  return inngestEventId("cad:convert", uploadId, status);
}

export function pathADesignFinalizedEventId(sku: string, dossierHash: string): string {
  return inngestEventId("path-a:finalized", sku, dossierHash);
}

export type PathAReleaseDiscriminator =
  | "override"
  | { depositRef: string }
  | { replay: number }
  | { retry: number };

export function pathAReleaseEventId(
  oppId: string,
  discriminator: PathAReleaseDiscriminator,
): string {
  let disc: string;
  if (discriminator === "override") {
    disc = "override";
  } else if ("depositRef" in discriminator) {
    disc = `deposit:${discriminator.depositRef}`;
  } else if ("replay" in discriminator) {
    disc = `replay:${discriminator.replay}`;
  } else {
    disc = `retry:${discriminator.retry}`;
  }
  return inngestEventId("path-a:release", oppId, disc);
}

export function pathAReleaseCompletedEventId(oppId: string): string {
  return inngestEventId("path-a", oppId, "completed");
}

export function pathAGhlSyncEventId(oppId: string, attempt: number): string {
  return inngestEventId("path-a:ghl-sync", oppId, String(attempt));
}

// Zod Schemas
export const pathAReleaseEventSchema = z
  .object({
    ghlOpportunityId: z.string().trim().min(1, "ghlOpportunityId is required"),
    source: z.enum(["management_override", "customer_deposit"]),
    requestedBy: z.string().trim().min(1, "requestedBy is required"),
    reason: z.string().optional(),
    depositCents: z.number().int().positive().optional(),
    depositRef: z.string().trim().optional(),
    attempt: z.number().int().min(0).default(0),
  })
  .superRefine((data, ctx) => {
    if (data.source === "customer_deposit") {
      if (typeof data.depositCents !== "number" || data.depositCents <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["depositCents"],
          message: "depositCents must be a positive integer for customer_deposit",
        });
      }
      if (!data.depositRef || data.depositRef.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["depositRef"],
          message: "depositRef is required for customer_deposit",
        });
      }
    }
  });

export type PathAReleaseEventPayload = z.infer<typeof pathAReleaseEventSchema>;

export const cadConvertCompletedSchema = z.object({
  jobId: z.string().optional(),
  uploadId: z.string().trim().min(1, "uploadId is required"),
  status: z.enum(["succeeded", "failed"]),
  resultStoragePath: z.string().optional(),
  resultSha256: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  finishedAt: z.string().optional(),
});

export type CadConvertCompletedPayload = z.infer<typeof cadConvertCompletedSchema>;
