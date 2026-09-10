/**
 * Parse SketchUp intake payloads into a draft BOM tree for quarantine UI + Approve.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 2.
 */
import type { ItemType } from "@/server/db/schema";

export type DraftOperation = {
  work_center: string;
  sequence: number;
  setup_mins: number | null;
  run_mins: number | null;
};

export type DraftBomNode = {
  sku: string;
  itemType: ItemType;
  qty: number;
  uom: string;
  existsInHub: boolean;
  operations: DraftOperation[];
  children: DraftBomNode[];
};

export type DraftProductSummary = {
  name: string;
  collection: string | null;
  category: string;
  proposedSku: string | null;
  dimensions: {
    length?: string;
    depth?: string;
    height?: string;
    arm_height?: string;
    sit_height?: string;
    weight?: string;
  };
  rootOperations: DraftOperation[];
  subassemblies: DraftBomNode[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown, fallback = 1): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function parseItemType(value: unknown, fallback: ItemType): ItemType {
  if (
    value === "raw_material" ||
    value === "sub_assembly" ||
    value === "finished_good" ||
    value === "service"
  ) {
    return value;
  }
  return fallback;
}

function parseOperations(value: unknown): DraftOperation[] {
  if (!Array.isArray(value)) return [];
  const out: DraftOperation[] = [];
  for (const [idx, raw] of value.entries()) {
    const row = asRecord(raw);
    if (!row) continue;
    const workCenter = asString(row.work_center);
    if (!workCenter) continue;
    out.push({
      work_center: workCenter,
      sequence:
        typeof row.sequence === "number" && Number.isFinite(row.sequence)
          ? Math.max(1, Math.trunc(row.sequence))
          : (idx + 1) * 10,
      setup_mins:
        typeof row.setup_mins === "number" && Number.isFinite(row.setup_mins)
          ? row.setup_mins
          : null,
      run_mins:
        typeof row.run_mins === "number" && Number.isFinite(row.run_mins)
          ? row.run_mins
          : null,
    });
  }
  return out;
}

function parseNode(
  raw: unknown,
  hubSkus: Set<string>,
  fallbackType: ItemType,
): DraftBomNode | null {
  const row = asRecord(raw);
  if (!row) return null;
  const sku = asString(row.sku_or_name);
  if (!sku) return null;
  const itemType = parseItemType(row.item_type, fallbackType);
  const childrenRaw = Array.isArray(row.children) ? row.children : [];
  const children: DraftBomNode[] = [];
  for (const child of childrenRaw) {
    const parsed = parseNode(
      child,
      hubSkus,
      itemType === "finished_good" ? "sub_assembly" : "raw_material",
    );
    if (parsed) children.push(parsed);
  }
  return {
    sku,
    itemType,
    qty: asNumber(row.qty, 1),
    uom: asString(row.uom) ?? "ea",
    existsInHub: hubSkus.has(sku),
    operations: parseOperations(row.operations),
    children,
  };
}

export function parseDraftProduct(
  rawPayload: unknown,
  hubSkus: Set<string>,
): DraftProductSummary | null {
  const root = asRecord(rawPayload);
  const product = asRecord(root?.product);
  if (!product) return null;

  const name = asString(product.name) ?? "Untitled product";
  const category = asString(product.category) ?? "Furniture";
  const dims = asRecord(product.dimensions) ?? {};
  const subRaw = Array.isArray(product.subassemblies)
    ? product.subassemblies
    : [];
  const subassemblies: DraftBomNode[] = [];
  for (const node of subRaw) {
    const parsed = parseNode(node, hubSkus, "sub_assembly");
    if (parsed) subassemblies.push(parsed);
  }

  return {
    name,
    collection: asString(product.collection),
    category,
    proposedSku: asString(product.proposed_sku),
    dimensions: {
      length: asString(dims.length) ?? undefined,
      depth: asString(dims.depth) ?? undefined,
      height: asString(dims.height) ?? undefined,
      arm_height: asString(dims.arm_height) ?? undefined,
      sit_height: asString(dims.sit_height) ?? undefined,
      weight: asString(dims.weight) ?? undefined,
    },
    rootOperations: parseOperations(product.operations),
    subassemblies,
  };
}

/** Flatten tree for minting / missing-SKU flags. */
export function flattenDraftBom(
  nodes: DraftBomNode[],
): Array<Omit<DraftBomNode, "children"> & { depth: number }> {
  const out: Array<Omit<DraftBomNode, "children"> & { depth: number }> = [];
  const walk = (list: DraftBomNode[], depth: number) => {
    for (const node of list) {
      const { children, ...rest } = node;
      out.push({ ...rest, depth });
      walk(children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

/** Parent→child edges for live `product_bom` (parent is FG or SA). */
export function collectDraftBomEdges(
  finishedGoodSku: string,
  nodes: DraftBomNode[],
): Array<{
  parentSku: string;
  childSku: string;
  quantity: number;
  unitOfMeasure: string;
}> {
  const edges: Array<{
    parentSku: string;
    childSku: string;
    quantity: number;
    unitOfMeasure: string;
  }> = [];

  const walk = (parentSku: string, list: DraftBomNode[]) => {
    for (const node of list) {
      edges.push({
        parentSku,
        childSku: node.sku,
        quantity: node.qty,
        unitOfMeasure: node.uom,
      });
      walk(node.sku, node.children);
    }
  };
  walk(finishedGoodSku, nodes);
  return edges;
}
