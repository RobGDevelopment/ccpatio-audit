/**
 * Remove QA soft-hold sales orders and the legacy fabric freeze.
 *
 * Deletes only:
 *   1. Open sales orders whose order_no is exactly HOLD- plus 8 lowercase hex chars.
 *   2. Sales order 52594042 when its live order_no is MIG-HOLD-FABRIC-20260811.
 *
 * Every other sales order is left alone. Manufacturing orders are never deleted.
 * A candidate with a linked manufacturing order, a delivery, or an invoice is skipped.
 * inventory_holds rows are removed only when order_no matches the same HOLD- pattern
 * and that Katana order was deleted or was already gone.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/clean-inventory-holds.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/clean-inventory-holds.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { and, inArray, sql } from "drizzle-orm";
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  resolveLiveKatanaApiBase,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { parseKatanaListPayload } from "../../src/lib/katana-mto";
import { closeDb, getDb } from "../../src/server/db/client";
import { inventory_holds } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const DUMMY_HOLD_ORDER_NO = /^HOLD-[a-f0-9]{8}$/;
const LEGACY_ORDER_ID = 52594042;
const LEGACY_ORDER_NO = "MIG-HOLD-FABRIC-20260811";
const OPEN_STATUSES = ["NOT_SHIPPED"] as const;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");

setKatanaRequestPacer(createIntervalPacer(350));

type Candidate = {
  id: number;
  orderNo: string;
  reason: "dummy-hold" | "legacy-freeze";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function katanaError(error: unknown): string {
  if (error instanceof KatanaApiError) {
    const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
    return `${error.message}${details}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function liveFetch<T = unknown>(pathname: string, method?: "GET" | "DELETE") {
  return katanaFetch<T>(pathname, {
    method,
    baseUrl: resolveLiveKatanaApiBase(),
  });
}

function orderNoOf(row: Record<string, unknown>): string {
  return typeof row.order_no === "string" ? row.order_no.trim() : "";
}

function orderIdOf(row: Record<string, unknown>): number {
  const id = Number(row.id);
  return Number.isFinite(id) ? id : 0;
}

/** Exact allowlist. A prefix match is not enough. */
function classify(id: number, orderNo: string): Candidate["reason"] | null {
  if (DUMMY_HOLD_ORDER_NO.test(orderNo)) return "dummy-hold";
  if (id === LEGACY_ORDER_ID && orderNo === LEGACY_ORDER_NO) return "legacy-freeze";
  return null;
}

function positive(value: unknown): boolean {
  const qty = Number(value);
  return Number.isFinite(qty) && qty > 0;
}

function deliveryBlocker(data: Record<string, unknown>, orderNo: string): string | null {
  const status = typeof data.status === "string" ? data.status : "";
  if (status && status.toUpperCase() !== "NOT_SHIPPED") {
    return `${orderNo} status is ${status}`;
  }
  const invoicing = typeof data.invoicing_status === "string" ? data.invoicing_status : "";
  if (invoicing && invoicing !== "notInvoiced") {
    return `${orderNo} invoicing status is ${invoicing}`;
  }
  const rows = Array.isArray(data.sales_order_rows) ? data.sales_order_rows : [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    if (
      positive(record.quantity_delivered) ||
      positive(record.delivered_quantity) ||
      positive(record.total_delivered) ||
      positive(record.quantity_shipped)
    ) {
      return `${orderNo} has delivered quantity`;
    }
  }
  if (positive(data.delivered_quantity) || positive(data.quantity_delivered)) {
    return `${orderNo} has delivered quantity`;
  }
  return null;
}

async function paginateSalesOrders(query: string, label: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = query.includes("?") ? "&" : "?";
    const { data } = await liveFetch(
      `/sales_orders${query}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const pageRows = parseKatanaListPayload(data);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
    if (page === MAX_PAGES) {
      throw new Error(
        `${label} did not finish within ${MAX_PAGES} pages. No deletes were attempted.`,
      );
    }
  }
  return rows;
}

/** Unshipped orders, plus anything created since yesterday so a test hold is not missed. */
async function listCandidatePool(): Promise<Record<string, unknown>[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 1);
  const createdMin = encodeURIComponent(since.toISOString());
  const pools: Record<string, unknown>[][] = [];
  for (const status of OPEN_STATUSES) {
    pools.push(
      await paginateSalesOrders(`?status=${status}`, `status ${status}`),
    );
  }
  try {
    pools.push(
      await paginateSalesOrders(
        `?created_at_min=${createdMin}`,
        `created since ${since.toISOString()}`,
      ),
    );
  } catch (error: unknown) {
    console.log(`  created_at_min scan skipped: ${katanaError(error)}`);
  }
  const seen = new Set<number>();
  const unique: Record<string, unknown>[] = [];
  for (const row of pools.flat()) {
    const id = orderIdOf(row);
    if (id > 0 && seen.has(id)) continue;
    if (id > 0) seen.add(id);
    unique.push(row);
  }
  return unique;
}

async function fetchSalesOrder(id: number): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await liveFetch<Record<string, unknown>>(`/sales_orders/${id}`);
    return data ?? null;
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 404) return null;
    throw error;
  }
}

async function manufacturingOrderIds(salesOrderId: number): Promise<number[]> {
  try {
    const { data } = await liveFetch(
      `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=5`,
    );
    const ids: number[] = [];
    for (const row of parseKatanaListPayload(data)) {
      const id = Number(row.id);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (Number(row.sales_order_id) !== salesOrderId) continue;
      ids.push(id);
    }
    return ids;
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 404) return [];
    throw error;
  }
}

async function ledgerRows(): Promise<Array<{ id: string; orderNo: string; katanaId: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      orderNo: inventory_holds.order_no,
      katanaId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(sql`${inventory_holds.order_no} ~ '^HOLD-[a-f0-9]{8}$'`);
  return rows;
}

async function deleteLedgerRows(orderNos: string[]): Promise<number> {
  const allowed = orderNos.filter((orderNo) => DUMMY_HOLD_ORDER_NO.test(orderNo));
  if (allowed.length === 0) return 0;
  const db = getDb();
  const deleted = await db
    .delete(inventory_holds)
    .where(
      and(
        sql`${inventory_holds.order_no} ~ '^HOLD-[a-f0-9]{8}$'`,
        inArray(inventory_holds.order_no, allowed),
      ),
    )
    .returning({ id: inventory_holds.id });
  return deleted.length;
}

async function main(): Promise<void> {
  const liveBase = resolveLiveKatanaApiBase();
  if (liveBase !== "https://api.katanamrp.com/v1") {
    throw new Error(`Refusing to run against ${liveBase}.`);
  }

  console.log("Clean inventory holds");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  katana: ${liveBase}`);
  console.log("  allowlist: HOLD-[a-f0-9]{8} and 52594042 / MIG-HOLD-FABRIC-20260811");

  const openOrders = await listCandidatePool();
  console.log(`  sales orders scanned: ${openOrders.length}`);

  const byId = new Map<number, Candidate>();
  let ignored = 0;
  for (const row of openOrders) {
    const id = orderIdOf(row);
    const orderNo = orderNoOf(row);
    const reason = classify(id, orderNo);
    if (!reason || id <= 0) {
      ignored += 1;
      continue;
    }
    byId.set(id, { id, orderNo, reason });
  }

  const legacy = await fetchSalesOrder(LEGACY_ORDER_ID);
  if (legacy) {
    const id = orderIdOf(legacy);
    const orderNo = orderNoOf(legacy);
    const reason = classify(id, orderNo);
    if (reason === "legacy-freeze") {
      byId.set(id, { id, orderNo, reason });
    } else {
      console.log(
        `  leave ${id || LEGACY_ORDER_ID} untouched (${orderNo || "no order number"} does not match the legacy freeze)`,
      );
    }
  } else {
    console.log(`  legacy sales order ${LEGACY_ORDER_ID} is already absent`);
  }

  const ledger = await ledgerRows();
  for (const row of ledger) {
    if (!DUMMY_HOLD_ORDER_NO.test(row.orderNo) || byId.has(row.katanaId)) continue;
    const live = await fetchSalesOrder(row.katanaId);
    if (!live) {
      console.log(`  ledger ${row.orderNo} has no Katana sales order ${row.katanaId}`);
      continue;
    }
    const reason = classify(orderIdOf(live), orderNoOf(live));
    if (reason === "dummy-hold" && orderNoOf(live) === row.orderNo) {
      byId.set(row.katanaId, { id: row.katanaId, orderNo: row.orderNo, reason });
    } else {
      console.log(`  leave ledger ${row.orderNo} / Katana ${row.katanaId} untouched`);
    }
  }

  const candidates = [...byId.values()].sort((a, b) => a.id - b.id);
  console.log(`  candidates: ${candidates.length}`);
  console.log(`  open orders left untouched by the allowlist: ${ignored}`);
  for (const candidate of candidates) {
    console.log(`  ${candidate.reason} ${candidate.id} ${candidate.orderNo}`);
  }
  console.log(`  matching inventory_holds rows: ${ledger.length}`);
  for (const row of ledger) {
    console.log(`  ledger ${row.orderNo} katana ${row.katanaId} ${row.id}`);
  }

  if (!confirm) {
    console.log("  Re-run with --confirm to delete the allowlisted orders and matching ledger rows.");
    return;
  }

  const removedOrderNos: string[] = [];
  let deleted = 0;
  let absent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const fresh = await fetchSalesOrder(candidate.id);
    if (!fresh) {
      absent += 1;
      if (candidate.reason === "dummy-hold") removedOrderNos.push(candidate.orderNo);
      console.log(`  already absent ${candidate.id} ${candidate.orderNo}`);
      continue;
    }
    const freshId = orderIdOf(fresh);
    const freshNo = orderNoOf(fresh);
    if (freshId !== candidate.id || freshNo !== candidate.orderNo || !classify(freshId, freshNo)) {
      skipped += 1;
      console.log(`  skip ${candidate.id}: live document is ${freshId} ${freshNo || "(blank)"}`);
      continue;
    }
    const blocked = deliveryBlocker(fresh, freshNo);
    if (blocked) {
      skipped += 1;
      console.log(`  skip ${freshId} ${freshNo}: ${blocked}`);
      continue;
    }
    const moIds = await manufacturingOrderIds(freshId);
    if (moIds.length > 0) {
      skipped += 1;
      console.log(`  skip ${freshId} ${freshNo}: manufacturing orders ${moIds.join(", ")} left untouched`);
      continue;
    }
    try {
      await liveFetch(`/sales_orders/${freshId}`, "DELETE");
      deleted += 1;
      if (candidate.reason === "dummy-hold") removedOrderNos.push(freshNo);
      console.log(`  deleted ${freshId} ${freshNo}`);
    } catch (error: unknown) {
      if (error instanceof KatanaApiError && error.status === 404) {
        absent += 1;
        if (candidate.reason === "dummy-hold") removedOrderNos.push(freshNo);
        console.log(`  already absent ${freshId} ${freshNo}`);
        continue;
      }
      skipped += 1;
      console.error(`  failed ${freshId} ${freshNo}: ${katanaError(error)}`);
    }
  }

  const ledgerOrderNos = [
    ...removedOrderNos,
    ...ledger
      .filter((row) => !byId.has(row.katanaId))
      .map((row) => row.orderNo),
  ];
  const ledgerDeleted = await deleteLedgerRows([...new Set(ledgerOrderNos)]);

  console.log("\n=== Summary ===");
  console.log(`  katana deleted: ${deleted}`);
  console.log(`  katana already absent: ${absent}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  inventory_holds deleted: ${ledgerDeleted}`);
  if (skipped > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(katanaError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
