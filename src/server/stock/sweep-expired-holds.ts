import { and, asc, eq, lte } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { getDb } from "@/server/db/client";
import { inventory_holds, order_intake } from "@/server/db/schema";
import { ghlFactoryOrderNo } from "@/server/ghl/hold-order";
import { convertOneHold } from "@/server/stock/convert-holds";
import {
  finishReleasingHold,
  releaseActiveHold,
} from "@/server/stock/release-hold";

const BATCH = 50;
const CLAIM_GRACE_MS = 15 * 60 * 1000;

export type SweepExpiredHoldsResult = {
  expired: number;
  resumedReleasing: number;
  converted: number;
  reverted: number;
  failed: number;
};

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? message.slice(0, 500) : message;
}

function claimIsFresh(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() < CLAIM_GRACE_MS;
}

async function sweepExpiredActive(now: Date): Promise<{ expired: number; failed: number }> {
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(and(eq(inventory_holds.status, "active"), lte(inventory_holds.expires_at, now)))
    .orderBy(asc(inventory_holds.expires_at))
    .limit(BATCH);

  let expired = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = await releaseActiveHold({
      target: {
        id: row.id,
        orderNo: row.orderNo,
        katanaDummySoId: row.katanaDummySoId,
      },
      reason: "expired",
      releasedBy: "sweeper",
    });
    if (outcome === "released") expired += 1;
    else if (outcome === "failed") failed += 1;
  }
  return { expired, failed };
}

async function sweepStuckReleasing(): Promise<{ resumedReleasing: number; failed: number }> {
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(eq(inventory_holds.status, "releasing"))
    .orderBy(asc(inventory_holds.updated_at))
    .limit(BATCH);

  let resumedReleasing = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = await finishReleasingHold({
      id: row.id,
      orderNo: row.orderNo,
      katanaDummySoId: row.katanaDummySoId,
    });
    if (outcome === "released") resumedReleasing += 1;
    else failed += 1;
  }
  return { resumedReleasing, failed };
}

async function revertOne(id: string, lastError: string): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(inventory_holds)
    .set({
      status: "active",
      conversion_order_intake_id: null,
      last_error: lastError,
      updated_at: new Date(),
    })
    .where(and(eq(inventory_holds.id, id), eq(inventory_holds.status, "converting")))
    .returning({ id: inventory_holds.id });
  return updated.length > 0;
}

async function noteStuck(id: string, message: string): Promise<void> {
  const db = getDb();
  await db
    .update(inventory_holds)
    .set({ last_error: message, updated_at: new Date() })
    .where(and(eq(inventory_holds.id, id), eq(inventory_holds.status, "converting")));
}

/**
 * Close converting rows the factory push did not finish.
 * Never creates a sales order. Deletes only HOLD- documents, or returns a
 * claim to active when the real order was never stored.
 */
async function sweepStuckConverting(now: Date): Promise<{ converted: number; reverted: number; failed: number }> {
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
      opportunityId: inventory_holds.ghl_opportunity_id,
      claimUpdatedAt: inventory_holds.updated_at,
      intakeId: order_intake.id,
      intakeStatus: order_intake.status,
      salesOrderId: order_intake.katana_sales_order_id,
      katanaOrderNo: order_intake.katana_order_no,
      intakeUpdatedAt: order_intake.updated_at,
    })
    .from(inventory_holds)
    .leftJoin(order_intake, eq(inventory_holds.conversion_order_intake_id, order_intake.id))
    .where(eq(inventory_holds.status, "converting"))
    .orderBy(asc(inventory_holds.updated_at))
    .limit(BATCH);

  let converted = 0;
  let reverted = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.intakeId) {
      await noteStuck(row.id, "Order intake for this claim is missing.");
      failed += 1;
      continue;
    }

    if (row.salesOrderId && row.salesOrderId > 0) {
      try {
        const outcome = await convertOneHold({
          holdId: row.id,
          orderNo: row.orderNo,
          katanaDummySoId: row.katanaDummySoId,
          katanaSalesOrderId: row.salesOrderId,
          katanaOrderNo: row.katanaOrderNo ?? ghlFactoryOrderNo(row.opportunityId),
        });
        if (outcome === "converted") converted += 1;
      } catch (error: unknown) {
        await noteStuck(row.id, errorText(error));
        failed += 1;
      }
      continue;
    }

    if (row.intakeStatus === "failed" || row.intakeStatus === "rejected") {
      const did = await revertOne(
        row.id,
        "Intake ended before a Katana sales order was stored.",
      );
      if (did) reverted += 1;
      continue;
    }

    const stamp = row.claimUpdatedAt ?? row.intakeUpdatedAt;
    if (row.intakeStatus === "approved" && claimIsFresh(stamp, now)) {
      continue;
    }

    if (claimIsFresh(stamp, now)) continue;

    const did = await revertOne(
      row.id,
      "Factory push did not store a sales order within 15 minutes.",
    );
    if (did) reverted += 1;
  }

  return { converted, reverted, failed };
}

export async function sweepExpiredHolds(now = new Date()): Promise<SweepExpiredHoldsResult> {
  const expired = await sweepExpiredActive(now);
  const releasing = await sweepStuckReleasing();
  const converting = await sweepStuckConverting(now);
  return {
    expired: expired.expired,
    resumedReleasing: releasing.resumedReleasing,
    converted: converting.converted,
    reverted: converting.reverted,
    failed: expired.failed + releasing.failed + converting.failed,
  };
}

/** Every 15 minutes. Concurrency 1. Does not create sales orders. */
export const sweepExpiredInventoryHolds = inngest.createFunction(
  {
    id: "sweep-expired-inventory-holds",
    name: "Sweep expired inventory holds",
    triggers: [{ cron: "*/15 * * * *" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    return step.run("sweep-expired-holds", () => sweepExpiredHolds());
  },
);
