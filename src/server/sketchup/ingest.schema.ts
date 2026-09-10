/**
 * SketchUp CAD ingest contract (Zod gateway).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 1.
 */
import { z } from "zod";

export const SKETCHUP_MAX_BOM_DEPTH = 12;

const dimensionsSchema = z
  .object({
    length: z.union([z.string(), z.number()]).optional(),
    depth: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    arm_height: z.union([z.string(), z.number()]).optional(),
    sit_height: z.union([z.string(), z.number()]).optional(),
    weight: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

const operationSchema = z
  .object({
    work_center: z.string().trim().min(1),
    sequence: z.number().int().positive().optional(),
    setup_mins: z.number().nonnegative().optional(),
    run_mins: z.number().nonnegative().optional(),
  })
  .strict();

type SubassemblyInput = {
  sku_or_name: string;
  item_type?: "raw_material" | "sub_assembly" | "finished_good" | "service";
  qty: number;
  uom: string;
  children?: SubassemblyInput[];
  operations?: z.infer<typeof operationSchema>[];
};

function createSubassemblySchema(depth: number): z.ZodType<SubassemblyInput> {
  if (depth >= SKETCHUP_MAX_BOM_DEPTH) {
    return z
      .object({
        sku_or_name: z.string().trim().min(1),
        item_type: z
          .enum(["raw_material", "sub_assembly", "finished_good", "service"])
          .optional(),
        qty: z.number().positive(),
        uom: z.string().trim().min(1),
        children: z
          .array(z.never())
          .max(0, `BOM nesting exceeds max depth of ${SKETCHUP_MAX_BOM_DEPTH}`)
          .optional()
          .default([]),
        operations: z.array(operationSchema).optional().default([]),
      })
      .strict();
  }

  return z
    .object({
      sku_or_name: z.string().trim().min(1),
      item_type: z
        .enum(["raw_material", "sub_assembly", "finished_good", "service"])
        .optional(),
      qty: z.number().positive(),
      uom: z.string().trim().min(1),
      children: z
        .array(z.lazy(() => createSubassemblySchema(depth + 1)))
        .optional()
        .default([]),
      operations: z.array(operationSchema).optional().default([]),
    })
    .strict();
}

const subassemblySchema = createSubassemblySchema(0);

const productSchema = z
  .object({
    name: z.string().trim().min(1),
    collection: z.string().trim().optional(),
    category: z.string().trim().optional(),
    proposed_sku: z.string().trim().min(1).optional(),
    dimensions: dimensionsSchema.optional(),
    subassemblies: z.array(subassemblySchema).optional().default([]),
    operations: z.array(operationSchema).optional().default([]),
  })
  .strict();

export const sketchupIngestSchema = z
  .object({
    export_id: z.uuid(),
    exported_at: z.coerce.date(),
    designer_email: z.email(),
    product: productSchema,
  })
  .strict();

export type SketchupIngestPayload = z.infer<typeof sketchupIngestSchema>;

export type SketchupZodIssue = {
  path: string;
  message: string;
};

export function formatSketchupZodIssues(
  error: z.ZodError,
): SketchupZodIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

export function parseSketchupIngest(payload: unknown):
  | { ok: true; data: SketchupIngestPayload }
  | { ok: false; errors: SketchupZodIssue[] } {
  const parsed = sketchupIngestSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: formatSketchupZodIssues(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
