import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import {
  bindMtoFabric,
  createKatanaSalesOrder,
  createMakeToOrderManufacturingOrders,
  findKatanaSalesOrderByOrderNo,
  findVariantBySku,
  KatanaApiError,
  katanaFetch,
} from "@/lib/katana";
import { KATANA_GENERIC_FABRIC_VARIANT_ID } from "@/lib/katana-bulk-materials";
import { parseKatanaListPayload, parseMoTreeNode } from "@/lib/katana-mto";
import { explodeBomTree } from "@/server/db/queries/bom";
import { getDb } from "@/server/db/client";
import {
  order_intake,
  sku_mappings,
  type OrderIntakeHoldRelief,
  type OrderIntakeMappedLine,
} from "@/server/db/schema";
import { fabricYardsFromEdges, type YardageEdge } from "@/server/ghl/fabric-yardage";
import {
  CC_MANUFACTURING_LOCATION_ID,
  ghlFactoryOrderNo,
} from "@/server/ghl/hold-order";
import { relieveFabricHold } from "@/server/ghl/relieve-hold";
import { canPushGhlFactoryOrders } from "@/server/pipeline/ghl-factory-mode";
import {
  claimShowroomHolds,
  convertClaimedHolds,
  revertUnconvertedHolds,
} from "@/server/stock/convert-holds";

export const ORDER_APPROVED_EVENT = "order.approved";

type StepRunner = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

async function runStep<T>(step: StepRunner, id: string, fn: () => Promise<T>): Promise<T> {
  return (await step.run(id, fn)) as T;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rethrowKatana(error: unknown): never {
  if (
    error instanceof KatanaApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    throw new NonRetriableError(error.message);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function markFailed(id: string, message: string): Promise<void> {
  const db = getDb();
  await db
    .update(order_intake)
    .set({ status: "failed", last_error: message, updated_at: new Date() })
    .where(eq(order_intake.id, id));
}

async function loadIntake(id: string) {
  const db = getDb();
  const [row] = await db.select().from(order_intake).where(eq(order_intake.id, id)).limit(1);
  return row ?? null;
}

async function variantIdForSku(sku: string): Promise<number> {
  const db = getDb();
  const [stored] = await db
    .select({ variantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (stored?.variantId && stored.variantId > 0) return stored.variantId;
  const found = await findVariantBySku(sku);
  if (!found) {
    throw new KatanaApiError(`${sku} has no Katana variant.`, { status: 422 });
  }
  return found.id;
}

function salesOrderRowIds(data: Record<string, unknown>): number[] {
  const rows = data.sales_order_rows;
  if (!Array.isArray(rows)) return [];
  const ids: number[] = [];
  for (const row of rows) {
    const id = Number(asRecord(row)?.id);
    if (Number.isFinite(id) && id > 0) ids.push(id);
  }
  return ids;
}

async function existingMoIdsByRow(salesOrderId: number): Promise<Map<number, number>> {
  const { data } = await katanaFetch<unknown>(
    `/manufacturing_orders?sales_order_id=${salesOrderId}&limit=50`,
  );
  const map = new Map<number, number>();
  for (const record of parseKatanaListPayload(data)) {
    const node = parseMoTreeNode(record);
    if (node?.sales_order_row_id && node.id) {
      map.set(node.sales_order_row_id, node.id);
    }
  }
  return map;
}

export async function runApprovedFactoryOrder(input: {
  orderIntakeId: string;
  version: number;
  step: StepRunner;
}): Promise<Record<string, unknown>> {
  const loaded = await runStep(input.step, "load-intake", () => loadIntake(input.orderIntakeId));
  if (!loaded) {
    throw new NonRetriableError(`order_intake ${input.orderIntakeId} was not found.`);
  }
  if (loaded.status === "pushed") {
    return { ok: true, alreadyPushed: true, orderIntakeId: loaded.id };
  }
  if (loaded.status === "rejected") {
    throw new NonRetriableError(`order_intake ${loaded.id} is rejected.`);
  }
  if (loaded.version !== input.version) {
    return { ok: false, reason: "stale_version", version: loaded.version };
  }
  const lines = loaded.mapped_lines ?? [];
  if (lines.length === 0) {
    throw new NonRetriableError(`order_intake ${loaded.id} has no mapped lines.`);
  }
  if (!canPushGhlFactoryOrders()) {
    return {
      ok: true,
      dryRun: true,
      reason: "GHL_FACTORY_ORDERS=log",
      orderIntakeId: loaded.id,
    };
  }

  try {
    const claimed = await runStep(input.step, "claim-showroom-holds", () =>
      claimShowroomHolds({
        opportunityId: loaded.ghl_opportunity_id,
        orderIntakeId: loaded.id,
      }),
    );
    const sales = await runStep(input.step, "ensure-sales-order", async () => {
      await claimShowroomHolds({
        opportunityId: loaded.ghl_opportunity_id,
        orderIntakeId: loaded.id,
      });
      try {
        return await ensureSalesOrder(
          loaded.id,
          loaded.ghl_opportunity_id,
          loaded.contact_name,
          loaded.contact_email,
          lines,
        );
      } catch (error: unknown) {
        const current = await loadIntake(loaded.id);
        if (!current?.katana_sales_order_id) {
          const message = error instanceof Error ? error.message : String(error);
          await revertUnconvertedHolds({ orderIntakeId: loaded.id, lastError: message });
        }
        throw error;
      }
    });
    await runStep(input.step, "release-showroom-holds", () =>
      convertClaimedHolds({
        orderIntakeId: loaded.id,
        claimedIds: claimed.ids,
        katanaSalesOrderId: sales.salesOrderId,
        katanaOrderNo: sales.orderNo,
      }),
    );
    const moIds = await runStep(input.step, "ensure-manufacturing-orders", () =>
      ensureManufacturingOrders(loaded.id, sales.salesOrderId, sales.salesOrderRowIds),
    );
    await runStep(input.step, "bind-fabric", () => bindFabrics(lines, moIds));
    await runStep(input.step, "relieve-hold", () => relieveHold(loaded.id, lines));
    await runStep(input.step, "mark-pushed", async () => {
      const db = getDb();
      await db
        .update(order_intake)
        .set({ status: "pushed", last_error: null, updated_at: new Date() })
        .where(eq(order_intake.id, loaded.id));
    });
    return {
      ok: true,
      orderIntakeId: loaded.id,
      katanaSalesOrderId: sales.salesOrderId,
      katanaOrderNo: sales.orderNo,
      manufacturingOrderIds: moIds,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(loaded.id, message);
    rethrowKatana(error);
  }
}

async function ensureSalesOrder(
  intakeId: string,
  opportunityId: string,
  contactName: string | null,
  contactEmail: string | null,
  lines: OrderIntakeMappedLine[],
): Promise<{ salesOrderId: number; orderNo: string; salesOrderRowIds: number[] }> {
  const current = await loadIntake(intakeId);
  if (current?.katana_sales_order_id && current.katana_order_no) {
    const fetched = await katanaFetch<unknown>(`/sales_orders/${current.katana_sales_order_id}`);
    const record = asRecord(fetched.data) ?? {};
    const rowIds = salesOrderRowIds(record);
    if (rowIds.length === lines.length) {
      return {
        salesOrderId: current.katana_sales_order_id,
        orderNo: current.katana_order_no,
        salesOrderRowIds: rowIds,
      };
    }
  }

  const orderNo = ghlFactoryOrderNo(opportunityId);
  const existing = await findKatanaSalesOrderByOrderNo(orderNo);
  let salesOrderId = Number(existing?.id);
  let rowIds = existing ? salesOrderRowIds(existing) : [];
  let customerId = Number(existing?.customer_id);

  if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
    const created = await createKatanaSalesOrder({
      orderNo,
      locationId: CC_MANUFACTURING_LOCATION_ID,
      idempotencyKey: orderNo,
      currency: "USD",
      source: "ghl",
      externalId: opportunityId,
      additionalInfo: `GHL Produce Factory Order ${opportunityId}. Intake ${intakeId}.`,
      customer: {
        name: contactName?.trim() || `GHL ${opportunityId}`,
        email: contactEmail,
      },
      salesOrderRows: lines.map((line) => ({
        sku: line.finSku,
        quantity: line.quantity,
        pricePerUnit: 0,
      })),
    });
    salesOrderId = created.salesOrderId;
    customerId = created.customerId;
    rowIds = created.salesOrderRowIds;
  } else if (rowIds.length === 0) {
    const fetched = await katanaFetch<unknown>(`/sales_orders/${salesOrderId}`);
    rowIds = salesOrderRowIds(asRecord(fetched.data) ?? {});
  }

  if (rowIds.length !== lines.length) {
    throw new KatanaApiError(
      `${orderNo} returned ${rowIds.length} rows for ${lines.length} mapped lines.`,
      { status: 422 },
    );
  }

  const db = getDb();
  await db
    .update(order_intake)
    .set({
      katana_sales_order_id: salesOrderId,
      katana_order_no: orderNo,
      katana_customer_id: Number.isFinite(customerId) ? customerId : current?.katana_customer_id,
      updated_at: new Date(),
    })
    .where(eq(order_intake.id, intakeId));

  return { salesOrderId, orderNo, salesOrderRowIds: rowIds };
}

async function ensureManufacturingOrders(
  intakeId: string,
  salesOrderId: number,
  salesOrderRowIds: number[],
): Promise<number[]> {
  const current = await loadIntake(intakeId);
  const stored = current?.katana_mo_ids ?? [];
  if (stored.length === salesOrderRowIds.length) return stored;

  const existing = await existingMoIdsByRow(salesOrderId);
  const missing = salesOrderRowIds.filter((rowId) => !existing.has(rowId));
  if (missing.length > 0) {
    const created = await createMakeToOrderManufacturingOrders(missing, {
      createSubassemblies: false,
    });
    for (const row of created) {
      existing.set(row.salesOrderRowId, row.manufacturingOrderId);
    }
  }

  const moIds = salesOrderRowIds.map((rowId) => {
    const moId = existing.get(rowId);
    if (!moId) {
      throw new KatanaApiError(
        `No manufacturing order for sales order row ${rowId}.`,
        { status: 422 },
      );
    }
    return moId;
  });

  const db = getDb();
  await db
    .update(order_intake)
    .set({ katana_mo_ids: moIds, updated_at: new Date() })
    .where(eq(order_intake.id, intakeId));
  return moIds;
}

async function bindFabrics(lines: OrderIntakeMappedLine[], moIds: number[]): Promise<void> {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const moId = moIds[index];
    if (!moId) {
      throw new KatanaApiError(`Missing manufacturing order for ${line.finSku}.`, { status: 422 });
    }
    const fabricVariantId = await variantIdForSku(line.fabricSku.trim().toUpperCase());
    await bindMtoFabric(moId, fabricVariantId, KATANA_GENERIC_FABRIC_VARIANT_ID);
  }
}

async function relieveHold(intakeId: string, lines: OrderIntakeMappedLine[]): Promise<void> {
  const edges: YardageEdge[] = [];
  const seenRoots = new Set<string>();
  for (const line of lines) {
    const root = line.finSku.trim().toUpperCase();
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    const tree = await explodeBomTree(root);
    for (const row of tree) {
      edges.push({
        parentSku: row.parent_sku,
        childSku: row.child_sku,
        quantity: Number(row.quantity),
        scrapFactor: Number(row.scrap_factor),
      });
    }
  }

  const yards = fabricYardsFromEdges(lines, edges);
  if (!yards.ok) {
    throw new KatanaApiError(yards.error, { status: 422 });
  }

  const requests = [];
  for (const [fabricSku, yardage] of yards.byFabric) {
    requests.push({
      fabricSku,
      yards: yardage,
      variantId: await variantIdForSku(fabricSku),
    });
  }

  const current = await loadIntake(intakeId);
  const holdRelief: OrderIntakeHoldRelief[] = await relieveFabricHold({
    intakeId,
    existing: current?.hold_relief ?? null,
    requests,
  });
  const db = getDb();
  await db
    .update(order_intake)
    .set({ hold_relief: holdRelief, updated_at: new Date() })
    .where(eq(order_intake.id, intakeId));
}
