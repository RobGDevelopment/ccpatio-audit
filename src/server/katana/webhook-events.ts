/**
 * Pure parsers for Katana webhook envelopes (`{ action, object: { id, ... } }`).
 * No DB, no network: the route and the Inngest sagas share this single source of truth.
 */

export const KATANA_SO_STATUS_EVENT = "katana/sales_order.status_changed";
export const KATANA_MO_DONE_EVENT = "katana/manufacturing_order.done";
export const KATANA_VARIANT_HEAL_EVENT = "katana/variant.heal.requested";

export type KatanaSoStatusEventData = {
  salesOrderId: number;
  action: string;
  source: "webhook" | "mo_done";
};

export type KatanaMoDoneEventData = { manufacturingOrderId: number };

export type KatanaVariantHealEventData = { variantId: number };

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function positiveInt(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(text(value));
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

/**
 * `resource.verb`, lower-cased. Accepts the dotted `action`, the `event` key, the
 * `resource_type` + bare-verb form, and the legacy underscore form (`sales_order_updated`).
 */
function normalizedAction(root: Record<string, unknown>, resource: string): string {
  const action = (text(root.action) || text(root.event)).toLowerCase();
  const resourceType = text(root.resource_type).toLowerCase();
  if (resourceType === resource && action && !action.includes(".")) {
    return `${resource}.${action}`;
  }
  const underscorePrefix = `${resource}_`;
  if (action.startsWith(underscorePrefix)) {
    return `${resource}.${action.slice(underscorePrefix.length)}`;
  }
  return action;
}

function resourceId(root: Record<string, unknown>, resource: string): number | null {
  const object = asRecord(root.object);
  const data = asRecord(root.data);
  return (
    positiveInt(object?.id) ??
    positiveInt(data?.id) ??
    positiveInt(asRecord(object?.[resource])?.id) ??
    positiveInt(asRecord(data?.[resource])?.id)
  );
}

export type KatanaEnvelope = { action: string; objectId: number | null };

/** Action and object id for the per-delivery audit key. Never throws. */
export function readKatanaEnvelope(payload: unknown): KatanaEnvelope {
  const root = asRecord(payload);
  if (!root) return { action: "", objectId: null };
  const object = asRecord(root.object);
  const data = asRecord(root.data);
  return {
    action: (text(root.action) || text(root.event)).toLowerCase(),
    objectId: positiveInt(object?.id) ?? positiveInt(data?.id),
  };
}

export type PurchaseOrderReceiptRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | {
      kind: "received";
      action: "purchase_order.received" | "purchase_order.partially_received";
      purchaseOrderId: number;
      orderNo: string | null;
    };

/**
 * Katana Purchase Order receipt events (`purchase_order.received` and `purchase_order.partially_received`).
 */
export function readPurchaseOrderReceipt(payload: unknown): PurchaseOrderReceiptRead {
  const root = asRecord(payload);
  if (!root) return { kind: "invalid", message: "Body must be a JSON object" };
  const action = (text(root.action) || text(root.event)).toLowerCase();
  if (
    action !== "purchase_order.received" &&
    action !== "purchase_order.partially_received"
  ) {
    return { kind: "ignore" };
  }

  const object = asRecord(root.object);
  const data = asRecord(root.data);
  const purchaseOrderId =
    positiveInt(object?.id) ??
    positiveInt(object?.purchase_order_id) ??
    positiveInt(data?.id) ??
    positiveInt(data?.purchase_order_id);
  if (!purchaseOrderId) {
    return { kind: "invalid", message: `${action} is missing a purchase order id` };
  }

  const orderNo = text(object?.order_no) || text(data?.order_no) || null;
  return {
    kind: "received",
    action: action as "purchase_order.received" | "purchase_order.partially_received",
    purchaseOrderId,
    orderNo,
  };
}

const SALES_ORDER_STATUS_ACTIONS = new Set([
  "sales_order.updated",
  "sales_order.packed",
  "sales_order.delivered",
] as const);

type SalesOrderStatusAction = "sales_order.updated" | "sales_order.packed" | "sales_order.delivered";

export type SalesOrderStatusRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | {
      kind: "sales_order_status";
      action: SalesOrderStatusAction;
      salesOrderId: number;
      /** `object.status`, upper-cased. Advisory only: the saga always re-reads Katana. */
      statusHint: string | null;
    };

/**
 * Sales-order status events. `sales_order.deleted` is ignored here: `readHoldDeletion`
 * owns it and runs first.
 */
export function readSalesOrderStatus(payload: unknown): SalesOrderStatusRead {
  const root = asRecord(payload);
  if (!root) return { kind: "invalid", message: "Body must be a JSON object" };
  const action = normalizedAction(root, "sales_order");
  if (!SALES_ORDER_STATUS_ACTIONS.has(action as SalesOrderStatusAction)) {
    return { kind: "ignore" };
  }
  const salesOrderId = resourceId(root, "sales_order");
  if (!salesOrderId) {
    return { kind: "invalid", message: `${action} is missing a sales order id` };
  }
  const object = asRecord(root.object);
  const statusHint = text(object?.status).toUpperCase() || null;
  return {
    kind: "sales_order_status",
    action: action as SalesOrderStatusAction,
    salesOrderId,
    statusHint,
  };
}

export type ManufacturingOrderDoneRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | { kind: "manufacturing_order_done"; manufacturingOrderId: number };

export function readManufacturingOrderDone(payload: unknown): ManufacturingOrderDoneRead {
  const root = asRecord(payload);
  if (!root) return { kind: "invalid", message: "Body must be a JSON object" };
  const action = normalizedAction(root, "manufacturing_order");
  if (action !== "manufacturing_order.done") return { kind: "ignore" };
  const manufacturingOrderId = resourceId(root, "manufacturing_order");
  if (!manufacturingOrderId) {
    return { kind: "invalid", message: `${action} is missing a manufacturing order id` };
  }
  return { kind: "manufacturing_order_done", manufacturingOrderId };
}
