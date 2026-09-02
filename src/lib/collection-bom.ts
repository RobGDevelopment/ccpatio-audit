/**
 * Collection-parameterized multi-level BOM + routing planner.
 *
 * FRAME gets metals / hardware / dekton / iron wood.
 * CUSH gets foam + RM-FAB-GENERIC (the MTO swap placeholder).
 * FG consumes 1 FRAME and 1 CUSH (seating only).
 *
 * Products with no Katana recipe still get the FG -> SA architecture so the
 * factory can fill the cut-list later.
 */
import {
  KATANA_BULK_MATERIALS,
  type KatanaBulkMaterialSeed,
} from "@/lib/katana-bulk-materials";
import {
  baseOfStem,
  buildSubAssemblies,
  directionOfStem,
  distinctStems,
  modelCodesFromSkus,
  productNeedsCushion,
  productsInCollection,
  skusForModel,
  type CollectionConfig,
  type KatanaProductLike,
} from "@/lib/collection-catalog";

export type KatanaRecipeLike = {
  product_variant_id: number;
  ingredient_variant_id: number;
  quantity: number;
};

export type KatanaOperationLike = {
  product_variant_id: number;
  operation_name: string;
  rank: number;
  planned_time_per_unit: number;
};

export type BomLinePlan = {
  parentSku: string;
  childSku: string;
  quantity: number;
  unitOfMeasure: string;
};

export type OperationPlan = {
  itemSku: string;
  workCenter: string;
  sequence: number;
  runTimeMins: number;
};

export type ModelPlan = {
  modelCode: string;
  parentName: string;
  frameSku: string;
  cushSku: string | null;
  /** Resolved finished good, or null when no PIM row matched. */
  fgSku: string | null;
  canonicalVariantId: number | null;
  recipeVariantCount: number;
};

export type CollectionBomPlan = {
  bomLines: BomLinePlan[];
  operations: OperationPlan[];
  models: ModelPlan[];
  warnings: string[];
};

const CUSHION_MATERIALS = new Set(["RM-FAB-GENERIC", "RM-RAW-FOAM"]);

const FRAME_OPS = new Set([
  "Metal Cutting",
  "Building & Welding",
  "Metal Grinding",
  "Metal Sandblasting",
  "Metal Powder Coating",
  "Dekton Cutting",
  "Dekton Grinding",
  "Dekton Polishing",
  "Material Handling",
]);

const CUSH_OPS = new Set(["Fabric Cutting", "Fabric Sewing", "Cushion Stuffing"]);

const FG_OPS = new Set(["Quality Check"]);

const materialByVariantId = new Map<number, KatanaBulkMaterialSeed>(
  KATANA_BULK_MATERIALS.map((row) => [row.katanaVariantId, row]),
);

export function ingredientBucket(
  ingredientVariantId: number,
): "frame" | "cushion" | "unknown" {
  const material = materialByVariantId.get(ingredientVariantId);
  if (!material) return "unknown";
  if (CUSHION_MATERIALS.has(material.globalSku)) return "cushion";
  return "frame";
}

export function operationBucket(
  operationName: string,
): "frame" | "cushion" | "fg" | "unknown" {
  if (FRAME_OPS.has(operationName)) return "frame";
  if (CUSH_OPS.has(operationName)) return "cushion";
  if (FG_OPS.has(operationName)) return "fg";
  return "unknown";
}

function recipeSignature(rows: KatanaRecipeLike[]): string {
  return rows
    .map((row) => `${row.ingredient_variant_id}:${row.quantity}`)
    .sort()
    .join("|");
}

/**
 * Most common recipe among a product's variants (factory data is messy:
 * dekton-top Y/N and a few color outliers). Ties prefer more ingredient rows.
 */
export function pickCanonicalVariantId(
  variantIds: number[],
  recipes: KatanaRecipeLike[],
): number | null {
  const byVariant = new Map<number, KatanaRecipeLike[]>();
  for (const row of recipes) {
    if (!variantIds.includes(row.product_variant_id)) continue;
    const list = byVariant.get(row.product_variant_id) ?? [];
    list.push(row);
    byVariant.set(row.product_variant_id, list);
  }
  if (byVariant.size === 0) return null;

  const groups = new Map<
    string,
    { variantId: number; count: number; rows: number }
  >();
  for (const [variantId, rows] of byVariant) {
    const key = recipeSignature(rows);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { variantId, count: 1, rows: rows.length });
    } else {
      existing.count += 1;
      if (rows.length > existing.rows) {
        existing.variantId = variantId;
        existing.rows = rows.length;
      }
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.rows - a.rows || a.variantId - b.variantId,
  )[0]!.variantId;
}

function secondsToMins(seconds: number): number {
  return Math.round((seconds / 60) * 10000) / 10000;
}

/**
 * product_bom is unique on (parent, child), but a Katana recipe can list the
 * same material on two rows (Bravada Armless Sofa 96 has the 2x2 cap at 4 and
 * 44). Sum them the way Katana consumes them and surface the duplicate.
 */
function aggregateBomLines(lines: BomLinePlan[], warnings: string[]): BomLinePlan[] {
  const merged = new Map<string, BomLinePlan>();

  for (const line of lines) {
    const key = `${line.parentSku}|${line.childSku}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...line });
      continue;
    }
    const total = Math.round((existing.quantity + line.quantity) * 10000) / 10000;
    warnings.push(
      `${line.parentSku} → ${line.childSku}: duplicate recipe rows (${existing.quantity} + ${line.quantity}) summed to ${total}`,
    );
    existing.quantity = total;
  }

  return [...merged.values()];
}

export function buildCollectionBomPlan(input: {
  products: KatanaProductLike[];
  recipes: KatanaRecipeLike[];
  operations: KatanaOperationLike[];
  config: CollectionConfig;
  /** model code -> canonical FIN-* SKU. Missing entries skip FG linking. */
  fgSkuByModel: ReadonlyMap<string, string>;
}): CollectionBomPlan {
  const warnings: string[] = [];
  const bomLines: BomLinePlan[] = [];
  const operations: OperationPlan[] = [];
  const models: ModelPlan[] = [];

  const scoped = productsInCollection(input.products, input.config);
  const saByModel = new Map(
    buildSubAssemblies(scoped, input.config).map((row) => [
      `${row.katanaParentProductId}:${row.modelCode}:${row.role}`,
      row,
    ]),
  );

  for (const product of scoped) {
    const variants = product.variants ?? [];
    const skus = variants.map((variant) => variant.sku ?? "");
    const modelCodes = modelCodesFromSkus(skus, input.config.skuPrefix);

    const stems = distinctStems(skus, input.config.skuPrefix);
    const unclaimed = stems.filter((stem) => !modelCodes.includes(stem));
    if (unclaimed.length > 0) {
      warnings.push(
        `${product.name}: stems (${unclaimed.join(", ")}) collapsed into ${modelCodes.join(" + ")}`,
      );
    }

    for (const modelCode of modelCodes) {
      const frame = saByModel.get(`${product.id}:${modelCode}:frame`);
      if (!frame) {
        warnings.push(`No FRAME SA for ${product.name} (${modelCode})`);
        continue;
      }

      // A left-facing frame must never inherit a right-facing cut-list, so
      // recipes are scoped to the variants of this model only.
      const modelSkus = new Set(
        skusForModel(skus, modelCode, input.config.skuPrefix),
      );
      const variantIds = variants
        .filter((variant) => modelSkus.has(variant.sku ?? ""))
        .map((variant) => variant.id);

      const cush = saByModel.get(`${product.id}:${modelCode}:cushion`) ?? null;
      const needsCush = productNeedsCushion(product.name);
      const fgSku = input.fgSkuByModel.get(modelCode) ?? null;
      const canonicalVariantId = pickCanonicalVariantId(variantIds, input.recipes);

      models.push({
        modelCode,
        parentName: product.name,
        frameSku: frame.globalSku,
        cushSku: cush?.globalSku ?? null,
        fgSku,
        canonicalVariantId,
        recipeVariantCount: new Set(
          input.recipes
            .filter((row) => variantIds.includes(row.product_variant_id))
            .map((row) => row.product_variant_id),
        ).size,
      });

      if (fgSku) {
        bomLines.push({
          parentSku: fgSku,
          childSku: frame.globalSku,
          quantity: 1,
          unitOfMeasure: "ea",
        });
        if (needsCush) {
          if (!cush) {
            warnings.push(`${product.name} needs CUSH but no SA was generated`);
          } else {
            bomLines.push({
              parentSku: fgSku,
              childSku: cush.globalSku,
              quantity: 1,
              unitOfMeasure: "ea",
            });
          }
        }
      } else {
        warnings.push(
          `${product.name} (${modelCode}): no ${input.config.finPrefix}* finished good matched — SA created without FG link`,
        );
      }

      if (canonicalVariantId == null) {
        continue;
      }

      const recipeRows = input.recipes.filter(
        (row) => row.product_variant_id === canonicalVariantId,
      );
      for (const row of recipeRows) {
        const material = materialByVariantId.get(row.ingredient_variant_id);
        const bucket = ingredientBucket(row.ingredient_variant_id);
        if (!material || bucket === "unknown") {
          warnings.push(
            `${product.name}: unknown ingredient_variant_id ${row.ingredient_variant_id}`,
          );
          continue;
        }
        if (bucket === "cushion") {
          if (!cush) {
            warnings.push(
              `${product.name}: cushion ingredient ${material.globalSku} but no CUSH SA`,
            );
            continue;
          }
          bomLines.push({
            parentSku: cush.globalSku,
            childSku: material.globalSku,
            quantity: row.quantity,
            unitOfMeasure: material.uomConsume,
          });
          continue;
        }
        bomLines.push({
          parentSku: frame.globalSku,
          childSku: material.globalSku,
          quantity: row.quantity,
          unitOfMeasure: material.uomConsume,
        });
      }

      const opRows = input.operations
        .filter((row) => row.product_variant_id === canonicalVariantId)
        .sort(
          (a, b) =>
            a.rank - b.rank || a.operation_name.localeCompare(b.operation_name),
        );

      const seq = { frame: 10, cushion: 10, fg: 10 };
      for (const row of opRows) {
        const bucket = operationBucket(row.operation_name);
        if (bucket === "unknown") {
          warnings.push(
            `${product.name}: unmapped operation ${row.operation_name}`,
          );
          continue;
        }
        if (bucket === "fg" && !fgSku) {
          warnings.push(
            `${product.name}: FG operation ${row.operation_name} skipped — no finished good matched`,
          );
          continue;
        }
        let itemSku = fgSku!;
        let sequence = seq.fg;
        if (bucket === "frame") {
          itemSku = frame.globalSku;
          sequence = seq.frame;
          seq.frame += 10;
        } else if (bucket === "cushion") {
          if (!cush) {
            warnings.push(
              `${product.name}: cushion op ${row.operation_name} but no CUSH SA`,
            );
            continue;
          }
          itemSku = cush.globalSku;
          sequence = seq.cushion;
          seq.cushion += 10;
        } else {
          seq.fg += 10;
        }
        operations.push({
          itemSku,
          workCenter: row.operation_name,
          sequence,
          runTimeMins: secondsToMins(row.planned_time_per_unit),
        });
      }
    }
  }

  const aggregated = aggregateBomLines(bomLines, warnings);

  if (input.config.mirrorHandedCutLists) {
    mirrorHandedCutLists(models, aggregated, operations, warnings);
  }

  return {
    bomLines: aggregated,
    operations,
    models,
    warnings,
  };
}

/**
 * Copy a cut-list onto the opposite hand when the factory only authored one
 * side. Reflecting a frame does not change how much tubing, flatbar or hardware
 * it consumes, so the quantities carry over exactly; only the geometry differs,
 * and geometry is not what a BOM records.
 *
 * Runs as a distinct pass, after the per-model scoping, so a mirrored line is
 * always traceable to a warning rather than looking like factory-authored data.
 * Nothing is invented: a hand with no sibling cut-list stays empty.
 */
function mirrorHandedCutLists(
  models: ModelPlan[],
  bomLines: BomLinePlan[],
  operations: OperationPlan[],
  warnings: string[],
): void {
  const bomByParent = new Map<string, BomLinePlan[]>();
  for (const line of bomLines) {
    const list = bomByParent.get(line.parentSku) ?? [];
    list.push(line);
    bomByParent.set(line.parentSku, list);
  }
  const opsByItem = new Map<string, OperationPlan[]>();
  for (const row of operations) {
    const list = opsByItem.get(row.itemSku) ?? [];
    list.push(row);
    opsByItem.set(row.itemSku, list);
  }

  // Pair models by their unhanded base so LS and RS sit side by side.
  const pairs = new Map<string, Map<string, ModelPlan>>();
  for (const model of models) {
    const direction = directionOfStem(model.modelCode);
    if (!direction) continue;
    const base = baseOfStem(model.modelCode);
    const byDirection = pairs.get(base) ?? new Map<string, ModelPlan>();
    byDirection.set(direction, model);
    pairs.set(base, byDirection);
  }

  for (const [base, byDirection] of pairs) {
    const present = [...byDirection.entries()];
    if (present.length < 2) continue;

    for (const [direction, model] of present) {
      const sibling = present.find(([other]) => other !== direction)?.[1];
      if (!sibling) continue;

      for (const role of ["frameSku", "cushSku"] as const) {
        const target = model[role];
        const source = sibling[role];
        if (!target || !source) continue;

        const targetLines = bomByParent.get(target) ?? [];
        const sourceLines = bomByParent.get(source) ?? [];
        if (targetLines.length > 0 || sourceLines.length === 0) continue;

        for (const line of sourceLines) {
          bomLines.push({ ...line, parentSku: target });
        }
        warnings.push(
          `${base}: ${target} had no cut-list; mirrored ${sourceLines.length} rows from ${source}`,
        );

        const sourceOps = opsByItem.get(source) ?? [];
        if (sourceOps.length > 0 && (opsByItem.get(target) ?? []).length === 0) {
          for (const row of sourceOps) {
            operations.push({ ...row, itemSku: target });
          }
          warnings.push(
            `${base}: ${target} had no routing; mirrored ${sourceOps.length} operations from ${source}`,
          );
        }
      }
    }
  }
}
