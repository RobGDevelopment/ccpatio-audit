import { KatanaApiError, katanaFetch } from "@/lib/katana";
import { parseKatanaListPayload } from "@/lib/katana-mto";
import { FABRIC_HOLD_ORDER_ID } from "@/server/ghl/hold-order";

const DELIVERED_KEYS = [
  "quantity_delivered",
  "delivered_quantity",
  "total_delivered",
  "quantity_shipped",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positive(value: unknown): boolean {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0;
}

/** Refusal is permanent until a person changes the Katana document. */
export class HoldDeleteRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldDeleteRefused";
  }
}

/**
 * Delete proceeds only for the ledger's own HOLD- order, with nothing delivered
 * and no manufacturing order. The legacy fabric freeze and GHL- orders fail this.
 */
export function holdDeleteBlocker(
  data: Record<string, unknown>,
  salesOrderId: number,
  orderNo: string,
): string | null {
  const liveId = Number(data.id);
  if (
    salesOrderId === FABRIC_HOLD_ORDER_ID ||
    liveId === FABRIC_HOLD_ORDER_ID
  ) {
    return "Refusing to delete the legacy fabric freeze.";
  }
  const liveNo = typeof data.order_no === "string" ? data.order_no : "";
  if (liveNo !== orderNo || !liveNo.startsWith("HOLD-")) {
    return `Refusing to delete sales order ${salesOrderId} (${liveNo || "no order number"}).`;
  }
  const status = typeof data.status === "string" ? data.status : "";
  if (status && status.toUpperCase() !== "NOT_SHIPPED") {
    return `Hold ${orderNo} is ${status}.`;
  }
  const invoicing = typeof data.invoicing_status === "string" ? data.invoicing_status : "";
  if (invoicing && invoicing !== "notInvoiced") {
    return `Hold ${orderNo} is already invoiced.`;
  }
  const rows = Array.isArray(data.sales_order_rows) ? data.sales_order_rows : [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const linked = Number(record.linked_manufacturing_order_id);
    if (Number.isFinite(linked) && linked > 0) {
      return `Hold ${orderNo} has a manufacturing order.`;
    }
    for (const key of DELIVERED_KEYS) {
      if (positive(record[key])) {
        return `Hold ${orderNo} has delivered quantity.`;
      }
    }
  }
  if (positive(data.delivered_quantity) || positive(data.quantity_delivered)) {
    return `Hold ${orderNo} has delivered quantity.`;
  }
  return null;
}

function manufacturingOrderIds(data: unknown, salesOrderId: number): number[] {
  const ids: number[] = [];
  for (const row of parseKatanaListPayload(data)) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (Number(row.sales_order_id) !== salesOrderId) continue;
    ids.push(id);
  }
  return ids;
}

/**
 * Fetch, prove the document is still a showroom hold, then delete it.
 * 404 means the dummy is already gone.
 */
export async function deleteHoldSalesOrder(
  salesOrderId: number,
  orderNo: string,
): Promise<"deleted" | "absent"> {
  if (salesOrderId === FABRIC_HOLD_ORDER_ID || !orderNo.startsWith("HOLD-")) {
    throw new HoldDeleteRefused(
      `Refusing to delete sales order ${salesOrderId} (${orderNo}).`,
    );
  }

  let data: Record<string, unknown>;
  try {
    const fetched = await katanaFetch<Record<string, unknown>>(
      `/sales_orders/${salesOrderId}`,
    );
    data = fetched.data ?? {};
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 404) return "absent";
    throw error;
  }

  const blocker = holdDeleteBlocker(data, salesOrderId, orderNo);
  if (blocker) throw new HoldDeleteRefused(blocker);

  try {
    const listed = await katanaFetch<unknown>(
      `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=5`,
    );
    const moIds = manufacturingOrderIds(listed.data, salesOrderId);
    if (moIds.length > 0) {
      throw new HoldDeleteRefused(`Hold ${orderNo} has a manufacturing order.`);
    }
  } catch (error: unknown) {
    if (error instanceof HoldDeleteRefused) throw error;
    if (!(error instanceof KatanaApiError) || error.status !== 404) throw error;
  }

  try {
    await katanaFetch(`/sales_orders/${salesOrderId}`, { method: "DELETE" });
    return "deleted";
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 404) return "absent";
    throw error;
  }
}
