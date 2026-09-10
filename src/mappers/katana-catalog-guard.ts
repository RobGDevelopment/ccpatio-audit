/**
 * Catalog publish guard — one FIN-* sellable variant, nested SA recipe,
 * no fabric/powder cartesian explosion.
 *
 * Binding: docs/CAPITAL_STACK_VENDOR_HANDOFF.md + MDM Phase 3/4.
 */
import type { HubBomEdge, HubProductGraph, HubSkuNode } from "@/mappers/types";

export const GENERIC_FABRIC_SKU = "RM-FAB-GENERIC";
export const GENERIC_POWDER_SKU = "RM-PWD-GENERIC";
export const GENERIC_DEKTON_SKU = "RM-DKT-GENERIC-SLAB";

export type KatanaCatalogErrorCode = "IDENTITY" | "COLORWAY" | "RECIPE";

export class KatanaCatalogPublishError extends Error {
  readonly code: KatanaCatalogErrorCode;

  constructor(code: KatanaCatalogErrorCode, message: string) {
    super(message);
    this.name = "KatanaCatalogPublishError";
    this.code = code;
  }
}

export type StagedKatanaCatalog = {
  graph: HubProductGraph;
  strippedColorwaySkus: string[];
  warnings: string[];
};

const GENERIC_PLACEHOLDERS = new Set([
  GENERIC_FABRIC_SKU,
  GENERIC_POWDER_SKU,
  GENERIC_DEKTON_SKU,
]);

export function isGenericPlaceholderSku(sku: string): boolean {
  return GENERIC_PLACEHOLDERS.has(sku.trim().toUpperCase());
}

/**
 * Colorway SKUs must never become Katana finished-good variants or
 * standard recipe ingredients. Vendors send them as SO attributes / MTO swaps.
 */
export function isColorwaySku(sku: string): boolean {
  const value = sku.trim().toUpperCase();
  if (!value || isGenericPlaceholderSku(value)) return false;
  if (value.startsWith("RM-")) return false;
  return (
    value.startsWith("FAB-") ||
    value.startsWith("PWD-") ||
    value.startsWith("STN-")
  );
}

export function isFrameSubAssemblySku(sku: string): boolean {
  const value = sku.trim().toUpperCase();
  return value.startsWith("SA-") && value.endsWith("-FRAME");
}

export function isCushSubAssemblySku(sku: string): boolean {
  const value = sku.trim().toUpperCase();
  return value.startsWith("SA-") && value.endsWith("-CUSH");
}

function bySku(graph: HubProductGraph): Map<string, HubSkuNode> {
  return new Map(graph.skus.map((node) => [node.globalSku.toUpperCase(), node]));
}

function childrenOf(graph: HubProductGraph, parentSku: string): HubBomEdge[] {
  const parent = parentSku.toUpperCase();
  return graph.edges.filter((edge) => edge.parentSku.toUpperCase() === parent);
}

export function assertKatanaCatalogIdentity(graph: HubProductGraph): void {
  const root = graph.rootSku.trim().toUpperCase();
  if (!root.startsWith("FIN-")) {
    throw new KatanaCatalogPublishError(
      "IDENTITY",
      `Catalog root must be a Master SKU (FIN-*). Got ${root || "(empty)"}.`,
    );
  }

  const map = bySku(graph);
  const rootNode = map.get(root);
  if (!rootNode) {
    throw new KatanaCatalogPublishError(
      "IDENTITY",
      `Hub graph is missing the root node ${root}.`,
    );
  }
  if (rootNode.itemType !== "finished_good") {
    throw new KatanaCatalogPublishError(
      "IDENTITY",
      `${root} must be item_type=finished_good (got ${rootNode.itemType}).`,
    );
  }

  const extraFinishedGoods = graph.skus.filter(
    (node) =>
      node.itemType === "finished_good" &&
      node.globalSku.toUpperCase() !== root,
  );
  if (extraFinishedGoods.length > 0) {
    throw new KatanaCatalogPublishError(
      "IDENTITY",
      `Cartesian explosion blocked: extra finished goods ${extraFinishedGoods
        .map((node) => node.globalSku)
        .join(", ")}. Publish only ${root}.`,
    );
  }

  const colorwayProducts = graph.skus.filter(
    (node) =>
      isColorwaySku(node.globalSku) &&
      (node.itemType === "finished_good" || node.itemType === "sub_assembly"),
  );
  if (colorwayProducts.length > 0) {
    throw new KatanaCatalogPublishError(
      "COLORWAY",
      `Colorway SKUs cannot be products: ${colorwayProducts
        .map((node) => node.globalSku)
        .join(", ")}. Use SO attributes / MTO swap.`,
    );
  }

  const finChildren = childrenOf(graph, root);
  const illegalFinChildren = finChildren.filter((edge) => {
    const child = edge.childSku.toUpperCase();
    return (
      isColorwaySku(child) ||
      child.startsWith("FIN-") ||
      child.startsWith("FAB-") ||
      child.startsWith("PWD-") ||
      child.startsWith("STN-")
    );
  });
  if (illegalFinChildren.length > 0) {
    throw new KatanaCatalogPublishError(
      "RECIPE",
      `${root} may only consume SA-*-FRAME / SA-*-CUSH. Illegal children: ${illegalFinChildren
        .map((edge) => edge.childSku)
        .join(", ")}.`,
    );
  }
}

export function stripColorwayIngredients(graph: HubProductGraph): StagedKatanaCatalog {
  const stripped = new Set<string>();
  const keptEdges = graph.edges.filter((edge) => {
    if (isColorwaySku(edge.childSku) || isColorwaySku(edge.parentSku)) {
      if (isColorwaySku(edge.childSku)) stripped.add(edge.childSku.toUpperCase());
      if (isColorwaySku(edge.parentSku)) stripped.add(edge.parentSku.toUpperCase());
      return false;
    }
    return true;
  });

  const referenced = new Set<string>([graph.rootSku.toUpperCase()]);
  for (const edge of keptEdges) {
    referenced.add(edge.parentSku.toUpperCase());
    referenced.add(edge.childSku.toUpperCase());
  }

  const keptSkus = graph.skus.filter((node) => {
    const sku = node.globalSku.toUpperCase();
    if (isColorwaySku(sku)) {
      stripped.add(sku);
      return false;
    }
    return referenced.has(sku);
  });

  const keptOps = graph.operations.filter((op) =>
    referenced.has(op.itemSku.toUpperCase()),
  );

  const warnings: string[] = [];
  if (stripped.size > 0) {
    warnings.push(
      `Stripped colorway SKUs from catalog recipe (MTO/SO attributes only): ${[...stripped].join(", ")}`,
    );
  }

  return {
    graph: {
      ...graph,
      skus: keptSkus,
      edges: keptEdges,
      operations: keptOps,
    },
    strippedColorwaySkus: [...stripped].sort(),
    warnings,
  };
}

export function assertDefaultKatanaRecipe(graph: HubProductGraph): string[] {
  const warnings: string[] = [];
  const root = graph.rootSku.toUpperCase();
  const finChildren = childrenOf(graph, root);
  if (finChildren.length === 0) {
    warnings.push(
      `${root} has no BOM edges — Katana will receive a sellable variant with no recipe.`,
    );
    return warnings;
  }

  const frames = finChildren.filter((edge) => isFrameSubAssemblySku(edge.childSku));
  const cushes = finChildren.filter((edge) => isCushSubAssemblySku(edge.childSku));
  const other = finChildren.filter(
    (edge) =>
      !isFrameSubAssemblySku(edge.childSku) &&
      !isCushSubAssemblySku(edge.childSku),
  );

  if (frames.length !== 1) {
    throw new KatanaCatalogPublishError(
      "RECIPE",
      `${root} must consume exactly one SA-*-FRAME (found ${frames.length}).`,
    );
  }
  if (other.length > 0) {
    throw new KatanaCatalogPublishError(
      "RECIPE",
      `${root} has non-FRAME/CUSH children: ${other.map((edge) => edge.childSku).join(", ")}.`,
    );
  }

  const frameSku = frames[0]!.childSku.toUpperCase();
  const frameKids = childrenOf(graph, frameSku);
  const hasTube = frameKids.some((edge) => {
    const child = edge.childSku.toUpperCase();
    return child.startsWith("RM-MET-") || child.startsWith("MET-");
  });
  if (!hasTube) {
    throw new KatanaCatalogPublishError(
      "RECIPE",
      `${frameSku} must include a tube / metal RM (RM-MET-*) for the default FRAME recipe.`,
    );
  }

  const powders = frameKids.filter(
    (edge) =>
      edge.childSku.toUpperCase() === GENERIC_POWDER_SKU ||
      edge.childSku.toUpperCase().startsWith("RM-PWD-"),
  );
  if (powders.length === 0) {
    warnings.push(
      `${frameSku} has no ${GENERIC_POWDER_SKU} — factory powder will be swapped at MTO time only if you add the placeholder.`,
    );
  }

  if (cushes.length > 1) {
    throw new KatanaCatalogPublishError(
      "RECIPE",
      `${root} must consume at most one SA-*-CUSH (found ${cushes.length}).`,
    );
  }

  if (cushes.length === 1) {
    const cushSku = cushes[0]!.childSku.toUpperCase();
    const hasGenericFabric = childrenOf(graph, cushSku).some(
      (edge) => edge.childSku.toUpperCase() === GENERIC_FABRIC_SKU,
    );
    if (!hasGenericFabric) {
      throw new KatanaCatalogPublishError(
        "COLORWAY",
        `${cushSku} must include ${GENERIC_FABRIC_SKU} (not FAB-* colorways) so MTO can swap fabric.`,
      );
    }
  }

  return warnings;
}

/**
 * Validate identity, drop colorways, require FRAME/CUSH default recipe.
 */
export function stageKatanaCatalogGraph(graph: HubProductGraph): StagedKatanaCatalog {
  assertKatanaCatalogIdentity(graph);
  const staged = stripColorwayIngredients(graph);
  assertKatanaCatalogIdentity(staged.graph);
  const recipeWarnings = assertDefaultKatanaRecipe(staged.graph);
  return {
    ...staged,
    warnings: [...staged.warnings, ...recipeWarnings],
  };
}

export type KatanaDefaultRecipeDraft = {
  finishedGoodSku: string;
  frameSku: string | null;
  cushSku: string | null;
  /** Katana POST /products body for the sellable Master SKU (one variant). */
  finishedGoodProduct: Record<string, unknown>;
  /** Katana POST /recipes bodies keyed by parent SKU. */
  recipes: Array<{
    parentSku: string;
    keep_current_rows: false;
    rows: Array<{
      parent_sku: string;
      child_sku: string;
      quantity: number;
      notes: string;
    }>;
  }>;
};

/**
 * Exact recipe shape vendors' MTO swap expects: FIN → SA-FRAME + SA-CUSH;
 * FRAME → tube (+ optional generic powder); CUSH → RM-FAB-GENERIC.
 */
export function draftDefaultKatanaRecipe(graph: HubProductGraph): KatanaDefaultRecipeDraft {
  const staged = stageKatanaCatalogGraph(graph).graph;
  const root = staged.rootSku.toUpperCase();
  const finChildren = childrenOf(staged, root);
  const frameSku =
    finChildren.find((edge) => isFrameSubAssemblySku(edge.childSku))?.childSku ??
    null;
  const cushSku =
    finChildren.find((edge) => isCushSubAssemblySku(edge.childSku))?.childSku ??
    null;

  const recipeParents = [root, frameSku, cushSku].filter(
    (sku): sku is string => Boolean(sku),
  );

  return {
    finishedGoodSku: root,
    frameSku,
    cushSku,
    finishedGoodProduct: {
      is_sellable: true,
      is_producible: true,
      is_purchasable: false,
      variants: [{ sku: root }],
    },
    recipes: recipeParents.map((parentSku) => ({
      parentSku,
      keep_current_rows: false as const,
      rows: childrenOf(staged, parentSku).map((edge) => ({
        parent_sku: edge.parentSku.toUpperCase(),
        child_sku: edge.childSku.toUpperCase(),
        quantity:
          edge.quantity *
          (Number.isFinite(edge.scrapFactor) && edge.scrapFactor > 0
            ? edge.scrapFactor
            : 1),
        notes: edge.notes?.trim() || edge.unitOfMeasure,
      })),
    })),
  };
}
