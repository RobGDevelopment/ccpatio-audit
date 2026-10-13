/**
 * Phase 10 Task 7 — Katana calls for the Woo saga, behind an injectable seam.
 *
 * Every call goes through `katanaFetch` (and therefore the Phase 9 shared token bucket); the
 * saga wraps each one in `runKatanaStep` so a 429 becomes a `RetryAfterError`.
 * No QBO import anywhere in this module.
 */
import {
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  findKatanaSalesOrderByOrderNo,
  KatanaApiError,
  katanaFetch,
  type KatanaSalesOrderCreateResult,
  type KatanaSalesOrderPayload,
} from "@/lib/katana";
import { parseKatanaListPayload, parseMoTreeNode } from "@/lib/katana-mto";

export type WooKatanaDeps = {
  findSalesOrderByOrderNo(orderNo: string): Promise<Record<string, unknown> | null>;
  /** Row ids of an EXISTING Katana sales order (falls back to GET /sales_orders/<id>). */
  getSalesOrderRowIds(salesOrder: Record<string, unknown>): Promise<number[]>;
  createSalesOrder(payload: KatanaSalesOrderPayload): Promise<KatanaSalesOrderCreateResult>;
  /** Manufacturing order already hanging off this sales order row, if any. */
  findMoIdForRow(salesOrderId: number, salesOrderRowId: number): Promise<number | null>;
  createMoForRow(salesOrderRowId: number): Promise<number>;
};

/** `GET /manufacturing_orders?...&limit=` page size; the saga refuses orders larger than this. */
export const WOO_MO_LISTING_LIMIT = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowIdsFrom(record: Record<string, unknown>): number[] {
  const rows = record.sales_order_rows;
  if (!Array.isArray(rows)) return [];
  const ids: number[] = [];
  for (const row of rows) {
    const id = Number(asRecord(row)?.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}

/**
 * Provenance check for an order found by `order_no`: only adopt a Katana sales order that
 * demonstrably came from THIS Woo order. A cross-source `order_no` collision (for example a
 * GHL order that happens to share the number) must never be adopted or modified.
 *
 *   - `ecommerce_order_id === String(wooId)` AND the ecommerce type is empty or "woocommerce", OR
 *   - `additional_info` carries `woo_order=<id>` (non-digit boundary, so 12 never matches 123).
 */
export function isOwnWooSalesOrder(
  salesOrder: Record<string, unknown>,
  wooOrderId: number | string,
): boolean {
  const id = String(wooOrderId).trim();
  if (!id) return false;

  const ecommerceId = String(salesOrder.ecommerce_order_id ?? "").trim();
  const ecommerceType = String(salesOrder.ecommerce_order_type ?? "").trim().toLowerCase();
  if (ecommerceId === id && (ecommerceType === "" || ecommerceType === "woocommerce")) {
    return true;
  }

  const info = String(salesOrder.additional_info ?? "");
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])woo_order=${escaped}(?![0-9])`).test(info);
}

export const defaultWooKatanaDeps: WooKatanaDeps = {
  findSalesOrderByOrderNo: (orderNo) => findKatanaSalesOrderByOrderNo(orderNo),

  async getSalesOrderRowIds(salesOrder) {
    const direct = rowIdsFrom(salesOrder);
    if (direct.length > 0) return direct;
    const id = Number(salesOrder.id);
    if (!Number.isFinite(id) || id <= 0) return [];
    const fetched = await katanaFetch<unknown>(`/sales_orders/${id}`);
    return rowIdsFrom(asRecord(fetched.data) ?? {});
  },

  createSalesOrder: (payload) => createKatanaSalesOrder(payload),

  async findMoIdForRow(salesOrderId, salesOrderRowId) {
    const { data } = await katanaFetch<unknown>(
      `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=${WOO_MO_LISTING_LIMIT}`,
    );
    for (const record of parseKatanaListPayload(data)) {
      const node = parseMoTreeNode(record);
      if (node?.sales_order_row_id === salesOrderRowId && node.id) return node.id;
    }
    return null;
  },

  async createMoForRow(salesOrderRowId) {
    // createSubassemblies stays false: flat MOs until Phase 4 is wired on purpose.
    const created = await createMakeToOrderManufacturingOrders([salesOrderRowId], {
      createSubassemblies: false,
    });
    const moId = created[0]?.manufacturingOrderId;
    if (!moId) {
      throw new KatanaApiError(
        `Katana returned no manufacturing order for sales order row ${salesOrderRowId}.`,
        { status: 422 },
      );
    }
    return moId;
  },
};
