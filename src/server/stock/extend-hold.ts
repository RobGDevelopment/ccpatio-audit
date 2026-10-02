import { and, eq } from "drizzle-orm";
import {
  HOLD_EXTEND_MAX_DAYS,
  holdExpiresAtFromDays,
  isHoldId,
} from "@/lib/inventory-holds";
import { getDb } from "@/server/db/client";
import { inventory_holds } from "@/server/db/schema";

export async function extendActiveHold(
  holdId: string,
  days: number,
): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string }> {
  const id = holdId.trim();
  if (!isHoldId(id)) return { ok: false, error: "Hold id is required." };
  if (!Number.isInteger(days) || days < 1 || days > HOLD_EXTEND_MAX_DAYS) {
    return {
      ok: false,
      error: `Extension must be a whole number of days from 1 to ${HOLD_EXTEND_MAX_DAYS}.`,
    };
  }

  const expiresAt = holdExpiresAtFromDays(days);
  const db = getDb();
  const updated = await db
    .update(inventory_holds)
    .set({
      expires_at: expiresAt,
      warning_sent_at: null,
      updated_at: new Date(),
    })
    .where(and(eq(inventory_holds.id, id), eq(inventory_holds.status, "active")))
    .returning({ expiresAt: inventory_holds.expires_at });

  const row = updated[0];
  if (!row) return { ok: false, error: "That hold is no longer active." };
  return { ok: true, expiresAt: row.expiresAt.toISOString() };
}
