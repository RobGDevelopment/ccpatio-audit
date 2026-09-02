/**
 * Ocean-specific wrappers over the collection-parameterized BOM planner.
 * New collections should use src/lib/collection-bom.ts directly.
 */
import { generateFinishedGoodSku } from "@/lib/sku-engine";
import { COLLECTIONS, type KatanaProductLike } from "@/lib/collection-catalog";
import {
  buildCollectionBomPlan,
  ingredientBucket,
  operationBucket,
  pickCanonicalVariantId,
  type BomLinePlan,
  type KatanaOperationLike,
  type KatanaRecipeLike,
  type OperationPlan,
} from "@/lib/collection-bom";

export type {
  BomLinePlan,
  KatanaOperationLike,
  KatanaRecipeLike,
  OperationPlan,
};
export { pickCanonicalVariantId };

export type OceanBomPlan = {
  bomLines: BomLinePlan[];
  operations: OperationPlan[];
  models: Array<{
    modelCode: string;
    parentName: string;
    frameSku: string;
    cushSku: string | null;
    fgSkuHint: string;
    canonicalVariantId: number | null;
    recipeVariantCount: number;
  }>;
  warnings: string[];
};

export function oceanIngredientBucket(
  ingredientVariantId: number,
): "frame" | "cushion" | "unknown" {
  return ingredientBucket(ingredientVariantId);
}

export function oceanOperationBucket(
  operationName: string,
): "frame" | "cushion" | "fg" | "unknown" {
  return operationBucket(operationName);
}

export function oceanFgSkuHint(productName: string): string {
  return generateFinishedGoodSku(productName, "Ocean", "", "");
}

export function buildOceanBomPlan(input: {
  products: KatanaProductLike[];
  recipes: KatanaRecipeLike[];
  operations: KatanaOperationLike[];
  fgSkuByModel: ReadonlyMap<string, string>;
}): OceanBomPlan {
  const plan = buildCollectionBomPlan({
    ...input,
    config: COLLECTIONS.ocean,
  });

  return {
    bomLines: plan.bomLines,
    operations: plan.operations,
    warnings: plan.warnings,
    models: plan.models.map((model) => ({
      modelCode: model.modelCode,
      parentName: model.parentName,
      frameSku: model.frameSku,
      cushSku: model.cushSku,
      fgSkuHint: model.fgSku ?? oceanFgSkuHint(model.parentName),
      canonicalVariantId: model.canonicalVariantId,
      recipeVariantCount: model.recipeVariantCount,
    })),
  };
}
