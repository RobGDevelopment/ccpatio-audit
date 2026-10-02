import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  inventory_holds,
  type InventoryHoldReleaseReason,
} from "@/server/db/schema";
import { deleteHoldSalesOrder } from "@/server/stock/delete-hold-order";

export type OpportunityReleaseResult = {
  released: number;
  alreadyTerminal: number;
  failed: number;
};

type ReleaseTarget = {
  id: string;
  orderNo: string;
  katanaDummySoId: number;
};

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? message.slice(0, 500) : message;
}

async function markReleased(id: string): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(inventory_holds)
    .set({
      status: "released",
      released_at: new Date(),
      last_error: null,
      updated_at: new Date(),
    })
    .where(and(eq(inventory_holds.id, id), eq(inventory_holds.status, "releasing")))
    .returning({ id: inventory_holds.id });
  return updated.length > 0;
}

async function noteReleaseError(id: string, error: unknown): Promise<void> {
  const db = getDb();
  await db
    .update(inventory_holds)
    .set({ last_error: errorText(error), updated_at: new Date() })
    .where(and(eq(inventory_holds.id, id), eq(inventory_holds.status, "releasing")));
}

/** Delete the dummy and close a row that is already `releasing`. */
export async function finishReleasingHold(target: ReleaseTarget): Promise<"released" | "failed"> {
  try {
    await deleteHoldSalesOrder(target.katanaDummySoId, target.orderNo);
    const closed = await markReleased(target.id);
    return closed ? "released" : "failed";
  } catch (error: unknown) {
    await noteReleaseError(target.id, error);
    return "failed";
  }
}

async function claimActiveHold(
  target: ReleaseTarget,
  reason: InventoryHoldReleaseReason,
  releasedBy: string,
): Promise<boolean> {
  const db = getDb();
  const claimed = await db
    .update(inventory_holds)
    .set({
      status: "releasing",
      release_reason: reason,
      released_by: releasedBy,
      updated_at: new Date(),
    })
    .where(and(eq(inventory_holds.id, target.id), eq(inventory_holds.status, "active")))
    .returning({ id: inventory_holds.id });
  return claimed.length > 0;
}

/**
 * Lost and Abandoned. Claims every active hold on the opportunity, deletes the
 * HOLD- sales order, and marks the row released. Rows already converting stay
 * with the factory push. A Katana refusal leaves the row `releasing`.
 */
export async function releaseHold(
  oppId: string,
  reason: "lost" | "abandoned",
): Promise<OpportunityReleaseResult> {
  const opportunityId = oppId.trim();
  if (!opportunityId) {
    throw new Error("Opportunity id is required.");
  }

  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      status: inventory_holds.status,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(eq(inventory_holds.ghl_opportunity_id, opportunityId));

  let released = 0;
  let alreadyTerminal = 0;
  let failed = 0;

  for (const row of rows) {
    if (row.status === "released" || row.status === "converted") {
      alreadyTerminal += 1;
      continue;
    }
    if (row.status === "converting") continue;
    const target = {
      id: row.id,
      orderNo: row.orderNo,
      katanaDummySoId: row.katanaDummySoId,
    };
    if (row.status === "releasing") {
      const outcome = await finishReleasingHold(target);
      if (outcome === "released") released += 1;
      else failed += 1;
      continue;
    }
    const claimed = await claimActiveHold(target, reason, "ghl-webhook");
    if (!claimed) continue;
    const outcome = await finishReleasingHold(target);
    if (outcome === "released") released += 1;
    else failed += 1;
  }

  return { released, alreadyTerminal, failed };
}

/** Sweeper and any later manual release. One active row. */
export async function releaseActiveHold(input: {
  target: ReleaseTarget;
  reason: InventoryHoldReleaseReason;
  releasedBy: string;
}): Promise<"released" | "failed" | "missed"> {
  const claimed = await claimActiveHold(input.target, input.reason, input.releasedBy);
  if (!claimed) return "missed";
  const outcome = await finishReleasingHold(input.target);
  return outcome === "released" ? "released" : "failed";
}
