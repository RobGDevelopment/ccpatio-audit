import { z } from "zod";
import { KATANA_RESOURCES } from "@/lib/factory-routing/resources";
import type { LengthConvention, ProfileCode } from "@/lib/sketchup-cutlist/types";

// Release units are the factory list plus `cf` (argon). UNKNOWN profiles stay out.
export const UNIT_OPTIONS = ["ea", "ft", "yd", "lb", "lbs", "boardft", "slab", "sqft", "in", "cf"] as const;

const RELEASE_PROFILES = ["SQ2-16", "RT1.5x0.75-16", "FB0.125x1.5", "SQ2x1-16"] as const satisfies readonly ProfileCode[];

const RELEASE_CONVENTIONS = ["long_point", "short_point", "square"] as const satisfies readonly LengthConvention[];

export const AirlockCutLineSchema = z.object({
  role: z.string().min(1).max(80),
  profile: z.enum(RELEASE_PROFILES),
  lengthIn: z.number().finite().positive().max(10000),
  endA: z.union([z.literal(45), z.literal(90)]),
  endB: z.union([z.literal(45), z.literal(90)]),
  qtyEa: z.number().int().min(1).max(10000),
  lengthConvention: z.enum(RELEASE_CONVENTIONS),
  sourceName: z.string().min(1).max(240),
  confidence: z.enum(["stated", "inferred", "inferred_override"]),
  drawingPartNumber: z.string().min(1).max(64).optional().nullable(),
}).strict();

export const AirlockRecipeLineSchema = z.object({
  parentSku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,64}$/),
  childSku: z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,64}$/),
  itemType: z.enum(["raw_material", "sub_assembly"]),
  quantity: z.number().finite().positive().max(1000000),
  scrapFactor: z.number().finite().positive().max(10),
  unitOfMeasure: z.enum(UNIT_OPTIONS),
  status: z.string(),
  source: z.string().optional(),
  notes: z.string().nullable().optional(),
  cutList: z.array(AirlockCutLineSchema).optional(),
  isMetal: z.boolean().optional(), // Metadata allowed by schema to verify metal requirements
}).strict();

export const AirlockOperationSchema = z.object({
  itemSku: z.string(),
  workCenter: z.string(),
  sequence: z.number().int().min(10).max(9990),
  setupTimeMins: z.number().finite().min(0).max(100000).optional(),
  runTimeMins: z.number().finite().min(0).max(100000).optional(),
}).strict();

export const AirlockDossierSchema = z.object({
  rootSku: z.string(),
  identity: z.object({
    itemType: z.enum(["finished_good", "sub_assembly"]),
    originalName: z.string(),
    katanaVariantId: z.number().nullable(),
    cad: z.object({
      uploadId: z.string(),
      ext: z.enum(["dae", "glb"]),
      status: z.enum(["draft_ready", "failed"]),
      sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
      hygiene: z.enum(["pass", "fail"]),
    }).strict().nullable(),
    cadWaived: z.literal(false),
  }).strict(),
  nodes: z.array(z.object({
    sku: z.string(),
    itemType: z.enum(["finished_good", "sub_assembly"]),
    lines: z.array(AirlockRecipeLineSchema),
    operations: z.array(AirlockOperationSchema),
  }).strict()),
  checklist: z.object({
    identityConfirmed: z.literal(true),
    cutListConfirmed: z.literal(true),
    operationsConfirmed: z.literal(true),
    quarantineConfirmed: z.literal(true),
  }).strict(),
}).strict();

// Katana payloads
export const KatanaRecipeReplaceSchema = z.object({
  keep_current_rows: z.literal(false),
  rows: z.array(z.object({
    product_variant_id: z.number().int().positive(),
    ingredient_variant_id: z.number().int().positive(),
    quantity: z.number().positive().finite(),
    notes: z.string().min(1).max(255).optional(),
    product_sku: z.string().min(1),
    ingredient_sku: z.string().min(1),
  })).min(1),
}).strict();

export const KatanaBomRowSchema = z.object({
  product_item_id: z.number().int().positive(),
  product_variant_id: z.number().int().positive(),
  ingredient_variant_id: z.number().int().positive(),
  quantity: z.number().positive().finite(),
  notes: z.string().min(1).max(255).nullable(),
}).strict();

export const KatanaOperationReplaceSchema = z.object({
  keep_current_rows: z.literal(false),
  rows: z.array(z.object({
    product_variant_id: z.number().int().positive(),
    operation_name: z.string().min(1).max(255),
    resource_name: z.enum(KATANA_RESOURCES),
    type: z.enum(["setup", "process"]),
    planned_time_parameter: z.number().int().positive(),
  }).strict()).min(1),
}).strict();

export type AirlockDossier = z.infer<typeof AirlockDossierSchema>;
export type AirlockCutLine = z.infer<typeof AirlockCutLineSchema>;
export type AirlockRecipeLine = z.infer<typeof AirlockRecipeLineSchema>;
export type AirlockOperation = z.infer<typeof AirlockOperationSchema>;
