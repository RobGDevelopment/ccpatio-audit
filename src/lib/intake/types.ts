import { z } from "zod";
import type { IntakeErrorCode } from "./copy";

export type { IntakeErrorCode };

export type IntakeFailureResult = {
  ok: false;
  code: IntakeErrorCode;
  message: string;
  ref: string;
  fieldErrors?: Record<string, string>;
  retryAfterSeconds?: number;
  details?: unknown;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | IntakeFailureResult;

export const FinishChoiceSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("sku"),
      sku: z.string().min(1, "Item code is required"),
    }).strict(),
    z.object({
      kind: z.literal("tbd"),
      note: z.string().trim().min(5, "Note must be at least 5 characters").max(200, "Note too long"),
    }).strict(),
  ]);

export type FinishChoice = z.infer<typeof FinishChoiceSchema>;

export const FileDescriptorSchema = z.object({
  filename: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().optional(),
}).strict();

export type FileDescriptor = z.infer<typeof FileDescriptorSchema>;

export const IntakeClientInputSchema = z.object({
  mode: z.literal("client_project"),
  intakeKey: z.string().uuid("intakeKey must be a valid UUID v4"),
  opportunityId: z.string().min(1, "Project is required"),
  pieceName: z.string().min(3, "Piece name must be at least 3 characters").max(60, "Piece name must be 60 characters or less"),
  quantity: z.number().int().min(1).max(99).default(1),
  finishes: z.object({
    frame: FinishChoiceSchema,
    powder: FinishChoiceSchema,
    fabric: FinishChoiceSchema,
  }).strict(),
  files: z.object({
    cad: FileDescriptorSchema,
    packet: FileDescriptorSchema.optional(),
  }).strict(),
  duplicateDecision: z.enum(["replace_model", "add_another"]).optional(),
  reportedUserEmail: z.string().email().max(254).optional(),
}).strict();

export type IntakeClientInput = z.infer<typeof IntakeClientInputSchema>;

export const IntakeCatalogInputSchema = z.object({
  mode: z.literal("catalog"),
  intakeKey: z.string().uuid("intakeKey must be a valid UUID v4"),
  productName: z.string().min(3, "Product name must be at least 3 characters").max(60, "Product name must be 60 characters or less"),
  collectionCode: z.string().min(1, "Collection is required"),
  collectionLabel: z.string().min(1, "Collection label is required"),
  categoryCode: z.string().min(1, "Product type is required"),
  categoryLabel: z.string().min(1, "Product type label is required"),
  length: z.number().positive().max(999),
  depth: z.number().positive().max(999),
  collisionDecision: z.enum(["update_model", "different"]).optional(),
  files: z.object({
    cad: FileDescriptorSchema,
    packet: FileDescriptorSchema.optional(),
    images: z.array(FileDescriptorSchema).optional(),
  }).strict(),
  reportedUserEmail: z.string().email().max(254).optional(),
}).strict();

export type IntakeCatalogInput = z.infer<typeof IntakeCatalogInputSchema>;

export const UploadPlanRequestSchema = z.object({
  intakeKey: z.string().uuid(),
  sku: z.string().min(1),
  cad: FileDescriptorSchema,
  packet: FileDescriptorSchema.optional(),
  reportedUserEmail: z.string().email().optional(),
}).strict();

export type UploadPlanRequest = z.infer<typeof UploadPlanRequestSchema>;

export const PacketConfirmInputSchema = z.object({
  sku: z.string().min(1),
  storagePath: z.string().min(1),
  originalFilename: z.string().min(1),
}).strict();

export type PacketConfirmInput = z.infer<typeof PacketConfirmInputSchema>;

export const OpportunitiesQuerySchema = z.object({
  q: z.string().trim().min(2, "Search query must be at least 2 characters").max(80),
}).strict();

export const FinishesQuerySchema = z.object({
  kind: z.enum(["frame", "powder", "fabric"]),
  q: z.string().trim().max(80).optional(),
}).strict();

export const SkuCheckQuerySchema = z.object({
  mode: z.enum(["client", "catalog"]),
  opp: z.string().optional(),
  piece: z.string().optional(),
  col: z.string().optional(),
  cat: z.string().optional(),
  l: z.string().optional(),
  d: z.string().optional(),
}).strict();

export const IntakeFinishesSchema = z.object({
  frame: FinishChoiceSchema,
  powder: FinishChoiceSchema,
  fabric: FinishChoiceSchema,
}).strict();

export type IntakeFinishes = z.infer<typeof IntakeFinishesSchema>;

export const UpdateFinishesInputSchema = z.object({
  sku: z.string().min(1),
  finishes: IntakeFinishesSchema,
  reportedUserEmail: z.string().email().optional(),
}).strict();

export type UpdateFinishesInput = z.infer<typeof UpdateFinishesInputSchema>;

