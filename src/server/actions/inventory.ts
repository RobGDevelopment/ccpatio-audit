"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { SHOWROOM_HOLD_TTL_DAYS } from "@/lib/inventory-holds";
import { getDb } from "@/server/db/client";
import { inventory_holds } from "@/server/db/schema";
import { fetchHoldOpportunity, resolveHoldActor } from "@/server/ghl/hold-actor";
import { createHold as insertHold, type CreateHoldResult } from "@/server/stock/create-hold";
import { extendActiveHold } from "@/server/stock/extend-hold";
import { releaseHoldById } from "@/server/stock/release-hold";

export type HoldActorHint = {
  ghlUserId?: string;
  ghlUserEmail?: string;
};

export type CreateInventoryHoldInput = {
  variantId: number;
  sku: string;
  qty: number;
  ghlOpportunityId: string;
  note: string;
  ghlUserId?: string;
  ghlUserEmail?: string;
};

function revalidateHoldSurfaces() {
  revalidatePath("/showroom");
  revalidatePath("/embed/showroom");
  revalidatePath("/admin/order-triage");
}

/**
 * Place a 14-day hold. `ghlUserId` is required for the embed principal and
 * ignored for a direct showroom login. Expiry is now + 14 days.
 */
export async function createHold(input: CreateInventoryHoldInput): Promise<CreateHoldResult> {
  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return actor;

  const opportunity = await fetchHoldOpportunity(input.ghlOpportunityId);
  if (!opportunity.ok) return opportunity;

  const result = await insertHold({
    variantId: input.variantId,
    sku: input.sku,
    qty: input.qty,
    note: input.note,
    actor,
    opportunity,
  });
  if (result.ok) revalidateHoldSurfaces();
  return result;
}

/**
 * Release one hold and delete its HOLD- sales order.
 * Factory code with no browser session should call `releaseHoldById` directly.
 */
export async function releaseHold(
  holdId: string,
  actorHint?: HoldActorHint,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await resolveHoldActor(actorHint ?? {});
  if (!actor.ok) return actor;

  const outcome = await releaseHoldById(holdId, actor.ghlUserEmail ?? actor.ghlUserId);
  if (outcome === "released") {
    revalidateHoldSurfaces();
    return { ok: true };
  }
  if (outcome === "missed") {
    return { ok: false, error: "That hold is no longer active." };
  }

  const db = getDb();
  const [failed] = await db
    .select({ lastError: inventory_holds.last_error })
    .from(inventory_holds)
    .where(eq(inventory_holds.id, holdId.trim()))
    .limit(1);
  return { ok: false, error: failed?.lastError ?? "Katana did not release that hold." };
}

/** Push expiry to now + `days` and allow the 48-hour warning to fire again. */
export async function extendHold(
  holdId: string,
  days: number = SHOWROOM_HOLD_TTL_DAYS,
  actorHint?: HoldActorHint,
): Promise<{ ok: true; expiresAt: string } | { ok: false; error: string }> {
  const actor = await resolveHoldActor(actorHint ?? {});
  if (!actor.ok) return actor;

  const result = await extendActiveHold(holdId, days);
  if (result.ok) revalidateHoldSurfaces();
  return result;
}
