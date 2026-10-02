import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { holdWarningWindow } from "@/lib/inventory-holds";
import { inngest } from "@/inngest/client";
import { notifyHoldExpiring } from "@/server/ghl/hold-warning";
import { getDb } from "@/server/db/client";
import { inventory_holds } from "@/server/db/schema";
import { sweepExpiredHolds } from "@/server/stock/sweep-expired-holds";

const WARNING_BATCH = 100;

export type HoldWarningRun = {
  warned: number;
  failed: number;
};

function clip(message: string): string {
  return message.length > 500 ? message.slice(0, 500) : message;
}

/**
 * Active holds whose expiry is 24–48 hours out and have not been warned.
 * A daily 08:00 run lands each 14-day hold in this window once.
 */
export async function sendHoldExpirationWarningsNow(now = new Date()): Promise<HoldWarningRun> {
  const window = holdWarningWindow(now);
  const db = getDb();
  const rows = await db
    .select({
      id: inventory_holds.id,
      sku: inventory_holds.sku,
      ghlUserId: inventory_holds.ghl_user_id,
      contactId: inventory_holds.ghl_contact_id,
      expiresAt: inventory_holds.expires_at,
    })
    .from(inventory_holds)
    .where(
      and(
        eq(inventory_holds.status, "active"),
        isNull(inventory_holds.warning_sent_at),
        gte(inventory_holds.expires_at, window.from),
        lte(inventory_holds.expires_at, window.to),
      ),
    )
    .orderBy(asc(inventory_holds.expires_at))
    .limit(WARNING_BATCH);

  let warned = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const notice = await notifyHoldExpiring({
      contactId: row.contactId,
      ghlUserId: row.ghlUserId,
      sku: row.sku,
      dueAt: row.expiresAt,
    });
    if (!notice.ok) {
      failed += 1;
      errors.push(`${row.sku}: ${notice.error}`);
      await db
        .update(inventory_holds)
        .set({ last_error: clip(notice.error), updated_at: new Date() })
        .where(and(eq(inventory_holds.id, row.id), eq(inventory_holds.status, "active")));
      continue;
    }

    const stamped = await db
      .update(inventory_holds)
      .set({
        warning_sent_at: new Date(),
        last_error: null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(inventory_holds.id, row.id),
          eq(inventory_holds.status, "active"),
          isNull(inventory_holds.warning_sent_at),
        ),
      )
      .returning({ id: inventory_holds.id });
    if (stamped.length > 0) {
      warned += 1;
      console.info("[smart-hold] expiration warning sent", {
        holdId: row.id,
        sku: row.sku,
        ghlUserId: row.ghlUserId,
        channel: notice.channel,
        expiresAt: row.expiresAt.toISOString(),
      });
    }
  }

  if (failed > 0) {
    throw new Error(
      `Hold expiration warnings failed for ${failed} hold(s). ${errors.join(" | ")}`,
    );
  }
  return { warned, failed };
}

/** Daily at 08:00. Warns the owning rep once per hold until it is extended. */
export const sendHoldExpirationWarnings = inngest.createFunction(
  {
    id: "send-hold-expiration-warnings",
    name: "Send inventory hold expiration warnings",
    triggers: [{ cron: "0 8 * * *" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    return step.run("warn-expiring-holds", () => sendHoldExpirationWarningsNow());
  },
);

/**
 * Hourly. Releases holds past expires_at by deleting the HOLD- sales order.
 * Also resumes rows stuck in releasing or converting. The 15-minute sweeper
 * remains registered and uses the same claim.
 */
export const autoReleaseExpiredHolds = inngest.createFunction(
  {
    id: "auto-release-expired-holds",
    name: "Auto-release expired inventory holds",
    triggers: [{ cron: "0 * * * *" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    return step.run("release-expired-holds", async () => {
      const result = await sweepExpiredHolds();
      console.info("[smart-hold] auto-released expired holds", result);
      return result;
    });
  },
);
