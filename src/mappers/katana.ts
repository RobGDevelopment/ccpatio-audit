/**
 * Katana MRP payload mapper — pure TypeScript, no HTTP.
 * Bottom-up: materials → sub-assemblies → finished good → recipes → operations.
 * Caller (Phase 4) attaches `Idempotency-Key` from each request's idempotencyKey.
 *
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 3.
 */
import {
  katanaIsSellableProduct,
  katanaProductSyncFlags,
} from "@/lib/katana-product-flags";
import { stageKatanaCatalogGraph } from "@/mappers/katana-catalog-guard";
import type {
  HubBomEdge,
  HubProductGraph,
  HubSkuNode,
} from "@/mappers/types";
import { parseMoney } from "@/mappers/types";

export type KatanaMappedRequest = {
  method: "POST";
  path: "/materials" | "/products" | "/recipes" | "/product_operation_rows";
  body: Record<string, unknown>;
  /** Attach as HTTP header `Idempotency-Key` on the mutating call. */
  idempotencyKey: string;
  kind: "material" | "product" | "recipes" | "product_operation_rows";
  sku?: string;
};

function mapUomToKatana(uom: string | null | undefined): string {
  const normalized = (uom ?? "ea").trim().toLowerCase();
  const table: Record<string, string> = {
    ea: "pcs",
    pc: "pcs",
    pcs: "pcs",
    in: "in",
    ft: "ft",
    yd: "yd",
    lbs: "lbs",
    lb: "lbs",
    sqft: "ft2",
    oz: "oz",
    gal: "gal",
  };
  return table[normalized] ?? normalized.slice(0, 7);
}

function minsToSeconds(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw * 60);
}

function bySku(graph: HubProductGraph): Map<string, HubSkuNode> {
  return new Map(graph.skus.map((s) => [s.globalSku.toUpperCase(), s]));
}

function childrenOf(
  graph: HubProductGraph,
  parentSku: string,
): HubBomEdge[] {
  const parent = parentSku.toUpperCase();
  return graph.edges.filter((e) => e.parentSku.toUpperCase() === parent);
}

/**
 * Post-order walk: children before parent (bottom-up).
 */
export function bottomUpSkuOrder(graph: HubProductGraph): string[] {
  const map = bySku(graph);
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(sku: string) {
    const key = sku.toUpperCase();
    if (done.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(`BOM cycle detected at ${key}`);
    }
    visiting.add(key);
    for (const edge of childrenOf(graph, key)) {
      visit(edge.childSku);
    }
    visiting.delete(key);
    done.add(key);
    if (map.has(key)) {
      ordered.push(key);
    }
  }

  visit(graph.rootSku);
  return ordered;
}

export function formatKatanaMaterialPayload(node: HubSkuNode): Record<string, unknown> {
  const purchasePrice = parseMoney(node.baseCost ?? null);
  const attrs = node.attributes ?? {};
  return {
    name: node.originalName || node.globalSku,
    uom: mapUomToKatana(node.uomPurchase ?? node.uomConsume),
    category_name: node.category || "Uncategorized",
    is_sellable: false,
    ...(typeof attrs.description === "string"
      ? { additional_info: attrs.description }
      : {}),
    variants: [
      {
        sku: node.globalSku,
        ...(purchasePrice !== null ? { purchase_price: purchasePrice } : {}),
      },
    ],
  };
}

export function formatKatanaProductPayload(
  node: HubSkuNode,
  salesPrice: number | null = null,
): Record<string, unknown> {
  const flags = katanaProductSyncFlags(node.itemType);
  const attrs = node.attributes ?? {};
  return {
    name: node.originalName || node.globalSku,
    uom: mapUomToKatana(node.uomConsume ?? node.uomPurchase),
    category_name: node.category || "Finished Good",
    is_sellable: katanaIsSellableProduct(node.itemType, node.globalSku),
    is_producible: flags.is_producible,
    is_purchasable: flags.is_purchasable,
    ...(typeof attrs.description === "string"
      ? { additional_info: attrs.description }
      : {}),
    variants: [
      {
        sku: node.globalSku,
        ...(salesPrice !== null ? { sales_price: salesPrice } : {}),
      },
    ],
  };
}

export function formatKatanaRecipeRowsForParent(
  graph: HubProductGraph,
  parentSku: string,
): {
  parentSku: string;
  parentVariantId: number | null;
  rows: Array<{
    product_variant_id: number | null;
    ingredient_variant_id: number | null;
    parent_sku: string;
    child_sku: string;
    quantity: number;
    notes: string;
  }>;
} {
  const map = bySku(graph);
  const parent = map.get(parentSku.toUpperCase());
  const parentVariantId = parent?.katanaVariantId ?? null;
  const rows = childrenOf(graph, parentSku).map((edge) => {
    const child = map.get(edge.childSku.toUpperCase());
    const scrap =
      Number.isFinite(edge.scrapFactor) && edge.scrapFactor > 0
        ? edge.scrapFactor
        : 1;
    return {
      product_variant_id: parentVariantId,
      ingredient_variant_id: child?.katanaVariantId ?? null,
      parent_sku: edge.parentSku.toUpperCase(),
      child_sku: edge.childSku.toUpperCase(),
      quantity: edge.quantity * scrap,
      notes: edge.notes?.trim() || edge.unitOfMeasure,
    };
  });
  return { parentSku: parentSku.toUpperCase(), parentVariantId, rows };
}

export function formatKatanaOperationRowsForSku(
  graph: HubProductGraph,
  itemSku: string,
): Array<Record<string, unknown>> {
  const map = bySku(graph);
  const node = map.get(itemSku.toUpperCase());
  const productVariantId = node?.katanaVariantId ?? null;
  const ops = graph.operations
    .filter((o) => o.itemSku.toUpperCase() === itemSku.toUpperCase())
    .slice()
    .sort((a, b) => a.sequence - b.sequence);

  const payload: Array<Record<string, unknown>> = [];
  for (const op of ops) {
    const setupSec = minsToSeconds(op.setupTimeMins ?? null);
    const runSec = minsToSeconds(op.runTimeMins ?? null);
    if (setupSec != null && setupSec > 0) {
      payload.push({
        product_variant_id: productVariantId,
        item_sku: itemSku.toUpperCase(),
        operation_name: `${op.workCenter} Setup`,
        resource_name: op.workCenter,
        type: "setup",
        planned_time_parameter: setupSec,
      });
    }
    if (runSec != null && runSec > 0) {
      payload.push({
        product_variant_id: productVariantId,
        item_sku: itemSku.toUpperCase(),
        operation_name: op.workCenter,
        resource_name: op.workCenter,
        type: "process",
        planned_time_parameter: runSec,
      });
    }
  }
  return payload;
}

/**
 * Full Katana publish plan for an approved hub graph.
 * Requests are ordered materials → products (SAs then FG) → recipes → operations.
 */
export function buildKatanaPublishPlan(
  graph: HubProductGraph,
): KatanaMappedRequest[] {
  const staged = stageKatanaCatalogGraph(graph).graph;
  const map = bySku(staged);
  const order = bottomUpSkuOrder(staged);
  const requests: KatanaMappedRequest[] = [];
  const salesPrice = parseMoney(staged.commerce.msrp ?? null);

  const materials = order.filter(
    (sku) => map.get(sku)?.itemType === "raw_material",
  );
  const products = order.filter((sku) => {
    const t = map.get(sku)?.itemType;
    return t === "sub_assembly" || t === "finished_good" || t === "service";
  });

  for (const sku of materials) {
    const node = map.get(sku);
    if (!node) continue;
    requests.push({
      method: "POST",
      path: "/materials",
      kind: "material",
      sku,
      idempotencyKey: `katana-material-${sku}`,
      body: formatKatanaMaterialPayload(node),
    });
  }

  for (const sku of products) {
    const node = map.get(sku);
    if (!node) continue;
    const price =
      node.itemType === "finished_good" && sku === staged.rootSku.toUpperCase()
        ? salesPrice
        : null;
    const body = formatKatanaProductPayload(node, price);
    const variants = body.variants;
    if (!Array.isArray(variants) || variants.length !== 1) {
      throw new Error(
        `Katana product ${sku} must publish exactly one variant (no colorway explosion).`,
      );
    }
    requests.push({
      method: "POST",
      path: "/products",
      kind: "product",
      sku,
      idempotencyKey: `katana-product-${sku}`,
      body,
    });
  }

  for (const sku of products) {
    const recipe = formatKatanaRecipeRowsForParent(staged, sku);
    if (recipe.rows.length === 0) continue;
    requests.push({
      method: "POST",
      path: "/recipes",
      kind: "recipes",
      sku,
      idempotencyKey: `katana-recipes-${sku}`,
      body: {
        keep_current_rows: false,
        rows: recipe.rows.map((r) => ({
          product_variant_id: r.product_variant_id,
          ingredient_variant_id: r.ingredient_variant_id,
          quantity: r.quantity,
          notes: r.notes,
          _parent_sku: r.parent_sku,
          _child_sku: r.child_sku,
        })),
      },
    });
  }

  for (const sku of products) {
    const opRows = formatKatanaOperationRowsForSku(staged, sku);
    if (opRows.length === 0) continue;
    requests.push({
      method: "POST",
      path: "/product_operation_rows",
      kind: "product_operation_rows",
      sku,
      idempotencyKey: `katana-ops-${sku}`,
      body: {
        keep_current_rows: false,
        rows: opRows,
      },
    });
  }

  return requests;
}

/** @deprecated Prefer buildKatanaPublishPlan — kept for edge-level callers. */
export function formatSingleBomEdgeRecipe(input: {
  parentVariantId: number;
  childVariantId: number;
  quantity: number;
  scrapFactor?: number;
  unitOfMeasure?: string;
}): Record<string, unknown> {
  const scrap =
    input.scrapFactor != null &&
    Number.isFinite(input.scrapFactor) &&
    input.scrapFactor > 0
      ? input.scrapFactor
      : 1;
  return {
    product_variant_id: input.parentVariantId,
    ingredient_variant_id: input.childVariantId,
    quantity: input.quantity * scrap,
    ...(input.unitOfMeasure ? { notes: input.unitOfMeasure } : {}),
  };
}
