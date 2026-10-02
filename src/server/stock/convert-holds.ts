import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { inventory_holds } from "@/server/db/schema";
import { deleteHoldSalesOrder } from "@/server/stock/delete-hold-order";

const ABSENT_NOTE = "Dummy sales order was already absent.";

export type ClaimedShowroomHolds = {
  ids: string[];
};

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? message.slice(0, 500) : message;
}

/**
 * Lock active holds for this opportunity so the sweeper and Lost webhook
 * cannot free them while the real sales order is being created.
 * A retry also returns rows this intake already claimed.
 */
export async function claimShowroomHolds(input: {
  opportunityId: string;
  orderIntakeId: string;
}): Promise<ClaimedShowroomHolds> {
  const db = getDb();
  const claimed = await db
    .update(inventory_holds)
    .set({
      status: "converting",
      conversion_order_intake_id: input.orderIntakeId,
      last_error: null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(inventory_holds.ghl_opportunity_id, input.opportunityId),
        or(
          eq(inventory_holds.status, "active"),
          and(
            eq(inventory_holds.status, "converting"),
            eq(inventory_holds.conversion_order_intake_id, input.orderIntakeId),
          ),
        ),
      ),
    )
    .returning({ id: inventory_holds.id });
  return { ids: claimed.map((row) => row.id) };
}

/** Real sales order was never stored. The dummy stays, and the row is active again. */
export async function revertUnconvertedHolds(input: {
  orderIntakeId: string;
  lastError: string | null;
}): Promise<number> {
  const db = getDb();
  const reverted = await db
    .update(inventory_holds)
    .set({
      status: "active",
      conversion_order_intake_id: null,
      last_error: input.lastError,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(inventory_holds.conversion_order_intake_id, input.orderIntakeId),
        eq(inventory_holds.status, "converting"),
      ),
    )
    .returning({ id: inventory_holds.id });
  return reverted.length;
}

async function noteConvertError(id: string, error: unknown): Promise<void> {
  const db = getDb();
  await db
    .update(inventory_holds)
    .set({ last_error: errorText(error), updated_at: new Date() })
    .where(
      and(
        eq(inventory_holds.id, id),
        inArray(inventory_holds.status, ["converting", "active"]),
      ),
    );
}

/**
 * Delete one HOLD- dummy and mark the ledger converted.
 * 404 still converts, with a note that the dummy was already gone.
 */
export async function convertOneHold(input: {
  holdId: string;
  orderNo: string;
  katanaDummySoId: number;
  katanaSalesOrderId: number;
  katanaOrderNo: string;
}): Promise<"converted" | "skipped"> {
  let absent = false;
  try {
    const outcome = await deleteHoldSalesOrder(input.katanaDummySoId, input.orderNo);
    absent = outcome === "absent";
  } catch (error: unknown) {
    await noteConvertError(input.holdId, error);
    throw error;
  }

  const db = getDb();
  const updated = await db
    .update(inventory_holds)
    .set({
      status: "converted",
      converted_katana_so_id: input.katanaSalesOrderId,
      converted_order_no: input.katanaOrderNo,
      last_error: absent ? ABSENT_NOTE : null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(inventory_holds.id, input.holdId),
        inArray(inventory_holds.status, ["converting", "active"]),
      ),
    )
    .returning({ id: inventory_holds.id });
  return updated.length > 0 ? "converted" : "skipped";
}

/**
 * After GHL-{opportunityId} exists. Claimed ids cover a hold the sweeper
 * returned to active during the push. Other converting rows for this intake
 * are included so a retried step finishes a partial batch.
 */
export async function convertClaimedHolds(input: {
  orderIntakeId: string;
  claimedIds: string[];
  katanaSalesOrderId: number;
  katanaOrderNo: string;
}): Promise<{ converted: number }> {
  const db = getDb();
  const claimed =
    input.claimedIds.length > 0
      ? await db
          .select({
            id: inventory_holds.id,
            status: inventory_holds.status,
            orderNo: inventory_holds.order_no,
            katanaDummySoId: inventory_holds.katana_dummy_so_id,
          })
          .from(inventory_holds)
          .where(inArray(inventory_holds.id, input.claimedIds))
      : [];
  const inflight = await db
    .select({
      id: inventory_holds.id,
      status: inventory_holds.status,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(
      and(
        eq(inventory_holds.conversion_order_intake_id, input.orderIntakeId),
        eq(inventory_holds.status, "converting"),
      ),
    );

  const byId = new Map<string, (typeof claimed)[number]>();
  for (const row of claimed) byId.set(row.id, row);
  for (const row of inflight) byId.set(row.id, row);

  const claimedSet = new Set(input.claimedIds);
  let converted = 0;
  for (const row of byId.values()) {
    if (row.status === "converted" || row.status === "released" || row.status === "releasing") {
      continue;
    }
    if (row.status === "active" && !claimedSet.has(row.id)) continue;
    if (row.status !== "converting" && row.status !== "active") continue;
    const outcome = await convertOneHold({
      holdId: row.id,
      orderNo: row.orderNo,
      katanaDummySoId: row.katanaDummySoId,
      katanaSalesOrderId: input.katanaSalesOrderId,
      katanaOrderNo: input.katanaOrderNo,
    });
    if (outcome === "converted") converted += 1;
  }
  return { converted };
}
