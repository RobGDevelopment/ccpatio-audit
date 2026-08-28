import { z } from "zod";

/** Normalize category labels from sku_mappings.category. */
export function normalizePimCategory(category: string): string {
  return category.trim().toLowerCase();
}

const dimsObject = z
  .object({
    l: z.union([z.string(), z.number()]).optional(),
    d: z.union([z.string(), z.number()]).optional(),
    h: z.union([z.string(), z.number()]).optional(),
    w: z.union([z.string(), z.number()]).optional(),
    seat_h: z.union([z.string(), z.number()]).optional(),
    arm_h: z.union([z.string(), z.number()]).optional(),
    clear: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const dektonAttributesSchema = z
  .object({
    slab_dims: dimsObject.optional(),
    thickness_mm: z.union([z.string(), z.number()]).optional(),
    finish: z.string().optional(),
    yield_sqft: z.union([z.string(), z.number()]).optional(),
    routing_factor: z.union([z.string(), z.number()]).optional(),
    supply_chain: z
      .object({
        sku: z.string().optional(),
        moq: z.union([z.string(), z.number()]).optional(),
        cost_sqft: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const fabricAttributesSchema = z
  .object({
    roll_width_in: z.union([z.string(), z.number()]).optional(),
    fabric_grade: z.string().optional(),
    performance: z
      .object({
        double_rubs: z.union([z.string(), z.number()]).optional(),
        uv_rating: z.union([z.string(), z.number()]).optional(),
        water_repel: z.union([z.string(), z.boolean()]).optional(),
      })
      .passthrough()
      .optional(),
    pattern: z
      .object({
        name: z.string().optional(),
        colorway: z.string().optional(),
        repeat_v: z.union([z.string(), z.number()]).optional(),
        repeat_h: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
    yield_factor: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const metalAttributesSchema = z
  .object({
    alloy_temper: z.string().optional(),
    profile_type: z.string().optional(),
    wall_thick: z.union([z.string(), z.number()]).optional(),
    stick_len_in: z.union([z.string(), z.number()]).optional(),
    weight_plf: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const powderAttributesSchema = z
  .object({
    brand_color: z
      .object({
        brand: z.string().optional(),
        color_name: z.string().optional(),
        product_code: z.string().optional(),
      })
      .passthrough()
      .optional(),
    ral_code: z.string().optional(),
    aesthetics: z
      .object({
        gloss: z.string().optional(),
        texture: z.string().optional(),
      })
      .passthrough()
      .optional(),
    coverage_sqft_per_lb: z.union([z.string(), z.number()]).optional(),
    cure_schedule: z
      .object({
        temp_f: z.union([z.string(), z.number()]).optional(),
        time_min: z.union([z.string(), z.number()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const shadeAttributesSchema = z
  .object({
    span_dims: dimsObject.optional(),
    shade_specs: z
      .object({
        wind_load: z.string().optional(),
        mount_cfg: z.string().optional(),
        motor: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const firepitAttributesSchema = z
  .object({
    fire_specs: z
      .object({
        btu: z.union([z.string(), z.number()]).optional(),
        fuel: z.string().optional(),
        burner: z.string().optional(),
        ignition: z.string().optional(),
      })
      .passthrough()
      .optional(),
    components: z
      .object({
        frame_sku: z.string().optional(),
        top_sku: z.string().optional(),
        media: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const furnitureAttributesSchema = z
  .object({
    taxonomy: z
      .object({
        collection: z.string().optional(),
        item_type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    dimensions: dimsObject.optional(),
    config_opts: z
      .object({
        cushion_thk: z.union([z.string(), z.number()]).optional(),
        welt: z.string().optional(),
        kick_finish: z.string().optional(),
      })
      .passthrough()
      .optional(),
    weight_lbs: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** Finished Good shares furniture-shaped attrs (dims / taxonomy / config). */
export const finishedGoodAttributesSchema = furnitureAttributesSchema;

export const categoryAttributeSchemas = {
  dekton: dektonAttributesSchema,
  fabric: fabricAttributesSchema,
  metal: metalAttributesSchema,
  powder: powderAttributesSchema,
  shade: shadeAttributesSchema,
  firepit: firepitAttributesSchema,
  furniture: furnitureAttributesSchema,
  "finished good": finishedGoodAttributesSchema,
} as const;

export type CategoryAttributeKey = keyof typeof categoryAttributeSchemas;

export function getAttributeSchema(category: string) {
  const key = normalizePimCategory(category) as CategoryAttributeKey;
  return categoryAttributeSchemas[key] ?? z.record(z.string(), z.unknown());
}

export function parseCategoryAttributes(
  category: string,
  raw: unknown,
): Record<string, unknown> {
  const schema = getAttributeSchema(category);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    return typeof raw === "object" && raw && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * Set a dotted path on attributes (e.g. "alloy_temper" or "cure_schedule.temp_f").
 */
export function setAttributePath(
  attributes: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return attributes;

  const root: Record<string, unknown> = { ...attributes };
  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    const next = cursor[key];
    const child =
      next && typeof next === "object" && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    cursor[key] = child;
    cursor = child;
  }

  const leaf = parts[parts.length - 1]!;
  if (value === null || value === "") {
    delete cursor[leaf];
  } else {
    cursor[leaf] = value;
  }
  return root;
}

export function getAttributePath(
  attributes: Record<string, unknown> | null | undefined,
  path: string,
): string {
  if (!attributes) return "";
  const parts = path.split(".").filter(Boolean);
  let cursor: unknown = attributes;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  if (cursor === null || cursor === undefined) return "";
  return String(cursor);
}
