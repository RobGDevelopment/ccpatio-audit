/**
 * Phase 10 Task 7 / Phase B1: Katana calls for the Woo saga, behind an injectable seam.
 *
 * Every call goes through `katanaFetch` (and therefore the Phase 9 shared token bucket); the
 * saga wraps each one in `runKatanaStep` so a 429 becomes a `RetryAfterError`.
 * No QBO import anywhere in this module.
 *
 * Phase B1: MOs are created with `createSubassemblies: true`; the saga then walks the MO tree
 * and swaps the nested generic placeholder recipe rows for the customer's finishes
 * (`bindPlaceholder` -> `bindMtoPlaceholderStrict`, which never swallows an error).
 */
import {
  bindMtoPlaceholderStrict,
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  findKatanaSalesOrderByOrderNo,
  KatanaApiError,
  katanaFetch,
  listKatanaManufacturingOrderNodesForSalesOrder,
  pickRootMoNodeForRow,
  readRowAttribute,
  WOO_LINE_KEY_ATTRIBUTE,
  type KatanaSalesOrderCreateResult,
  type KatanaSalesOrderPayload,
} from "@/lib/katana";
import { wooLineKey } from "./line-specs";
import type { ResolvedWooLine } from "./sku-resolver";

/** A row of an existing or freshly created Katana sales order. */
export type KatanaSoRow = {
  id: number;
  sku: string | null;
  /** `woo_line_key` attribute, when the row carries one. */
  lineKey: string | null;
};

export type WooKatanaDeps = {
  findSalesOrderByOrderNo(orderNo: string): Promise<Record<string, unknown> | null>;
  /** Rows of an EXISTING Katana sales order (falls back to GET /sales_orders/<id>). */
  getSalesOrderRows(salesOrder: Record<string, unknown>): Promise<KatanaSoRow[]>;
  createSalesOrder(payload: KatanaSalesOrderPayload): Promise<KatanaSalesOrderCreateResult>;
  /** Parent manufacturing order already hanging off this sales order row, if any. */
  findMoIdForRow(salesOrderId: number, salesOrderRowId: number): Promise<number | null>;
  /** Make-to-order WITH sub-assemblies. Returns the parent MO id. */
  createMoForRow(salesOrderRowId: number): Promise<number>;
  /** Swap one generic placeholder for the customer's variant across the MO tree. Strict. */
  bindPlaceholder(input: {
    moId: number;
    genericVariantId: number;
    specificVariantId: number;
    label: string;
  }): Promise<{ patchedCount: number; alreadyBound: boolean }>;
};

/**
 * The saga refuses orders with more line items than this. Each line can fan out into several
 * sub-assembly MOs and the MO listing is paged (10 pages x 50), so the cap keeps the duplicate
 * check provably exhaustive.
 */
export const WOO_MAX_LINE_ITEMS = 25;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rowsFrom(record: Record<string, unknown>): KatanaSoRow[] {
  const rows = record.sales_order_rows;
  if (!Array.isArray(rows)) return [];
  const out: KatanaSoRow[] = [];
  for (const row of rows) {
    const id = Number(asRecord(row)?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    out.push({
      id,
      sku: readRowAttribute(row, "global_sku"),
      lineKey: readRowAttribute(row, WOO_LINE_KEY_ATTRIBUTE),
    });
  }
  return out;
}

/**
 * Pair every Woo line with its Katana sales-order row. Pairing by the `woo_line_key` attribute
 * is exact. If the rows carry no keys (an order created before B1), fall back to position and
 * REQUIRE the SKU on each row to match, so a misaligned pair can never bind a finish to the
 * wrong row. Any mismatch throws.
 */
export function matchSalesOrderRowsToLines(
  rows: KatanaSoRow[],
  lines: ResolvedWooLine[],
): Array<{ line: ResolvedWooLine; rowId: number }> {
  if (rows.length !== lines.length) {
    throw new KatanaApiError(
      `Katana sales order has ${rows.length} rows for ${lines.length} Woo line items.`,
      { status: 422 },
    );
  }

  if (rows.every((row) => row.lineKey !== null)) {
    const byKey = new Map<string, KatanaSoRow>();
    for (const row of rows) {
      if (byKey.has(row.lineKey as string)) {
        throw new KatanaApiError(`Katana sales order has two rows with ${WOO_LINE_KEY_ATTRIBUTE}=${row.lineKey}.`, {
          status: 422,
        });
      }
      byKey.set(row.lineKey as string, row);
    }
    return lines.map((line) => {
      const row = byKey.get(wooLineKey(line.spec));
      if (!row) {
        throw new KatanaApiError(
          `No Katana sales order row carries ${WOO_LINE_KEY_ATTRIBUTE}=${wooLineKey(line.spec)}.`,
          { status: 422 },
        );
      }
      return { line, rowId: row.id };
    });
  }

  return lines.map((line, index) => {
    const row = rows[index];
    if (!row.sku || row.sku.toUpperCase() !== line.spec.sku) {
      throw new KatanaApiError(
        `Katana sales order row ${row.id} (sku ${row.sku ?? "unknown"}) does not match Woo line ${index + 1} (${line.spec.sku}).`,
        { status: 422 },
      );
    }
    return { line, rowId: row.id };
  });
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

  async getSalesOrderRows(salesOrder) {
    const direct = rowsFrom(salesOrder);
    if (direct.length > 0 && direct.every((row) => row.lineKey !== null)) return direct;
    const id = Number(salesOrder.id);
    if (!Number.isFinite(id) || id <= 0) return direct;
    const fetched = await katanaFetch<unknown>(`/sales_orders/${id}`);
    const full = rowsFrom(asRecord(fetched.data) ?? {});
    return full.length > 0 ? full : direct;
  },

  createSalesOrder: (payload) => createKatanaSalesOrder(payload),

  async findMoIdForRow(salesOrderId, salesOrderRowId) {
    const nodes = await listKatanaManufacturingOrderNodesForSalesOrder(salesOrderId);
    return pickRootMoNodeForRow(nodes, salesOrderRowId);
  },

  async createMoForRow(salesOrderRowId) {
    const created = await createMakeToOrderManufacturingOrders([salesOrderRowId], {
      createSubassemblies: true,
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

  async bindPlaceholder({ moId, genericVariantId, specificVariantId, label }) {
    const result = await bindMtoPlaceholderStrict(moId, {
      genericVariantId,
      specificVariantId,
      label,
    });
    return { patchedCount: result.patched.length, alreadyBound: result.alreadyBound };
  },
};
