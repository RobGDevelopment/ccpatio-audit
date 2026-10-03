import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@/utils/supabase/server";
import { getDb } from "@/server/db/client";
import { quote_overrides, quotes, user_roles } from "@/server/db/schema";
import { commercialOverrideAllowed } from "@/server/quotes/override-role";
import { isIsoDate } from "@/server/quotes/promise-formula";
import { rateQuoteById, type RateQuoteFreightResult } from "@/server/quotes/rate-freight";

export type OverrideActor = {
  actorId: string;
  role: "Ops_Manager" | "SuperAdmin";
};

export async function requireCommercialOverride(): Promise<
  { ok: true } & OverrideActor | { ok: false; error: string }
> {
  let userId: string | null = null;
  let email: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    email = user?.email ?? null;
  } catch {
    userId = null;
  }
  if (!userId || !email) {
    return { ok: false, error: "A manager session is required." };
  }
  const db = getDb();
  const [row] = await db
    .select({ role: user_roles.role })
    .from(user_roles)
    .where(eq(user_roles.id, userId))
    .limit(1);
  if (!commercialOverrideAllowed({ email, role: row?.role ?? null })) {
    return {
      ok: false,
      error: "Only an Ops Manager or Super Admin can override a quote.",
    };
  }
  return { ok: true, actorId: userId, role: row?.role as OverrideActor["role"] };
}

function reasonText(reason: string): string | null {
  const text = reason.trim();
  if (text.length < 1 || text.length > 500) return null;
  return text;
}

/**
 * Shown freight becomes the typed amount. The snapshot and calculated total stay.
 * Inserts a new override row. Does not update a previous one.
 */
export async function overrideQuoteFreightTotal(input: {
  quoteId: string;
  expectedVersion: number;
  amount: number | null;
  reason: string;
  actor: OverrideActor;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const reason = reasonText(input.reason);
  if (!reason) return { ok: false, error: "A reason of 1 to 500 characters is required." };
  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0)) {
    return { ok: false, error: "Freight override must be zero or greater." };
  }

  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "Freight can be overridden on a draft only." };
  }

  const overrideValue = input.amount == null ? null : input.amount.toFixed(2);
  const shown =
    overrideValue ?? quote.calculated_freight_total;

  try {
    const updated = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(quote_overrides)
        .values({
          quote_id: quote.id,
          field: "freight_total",
          calculated_value: quote.calculated_freight_total ?? "",
          override_value: overrideValue,
          reason,
          actor_id: input.actor.actorId,
          actor_role: input.actor.role,
        })
        .returning({ id: quote_overrides.id });
      if (!created) throw new Error("STALE_QUOTE");
      const rows = await tx
        .update(quotes)
        .set({
          freight_total: shown,
          freight_override_id: created.id,
          version: sql`${quotes.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quotes.id, quote.id),
            eq(quotes.version, input.expectedVersion),
            eq(quotes.status, "draft"),
          ),
        )
        .returning({ version: quotes.version });
      if (!rows[0]) throw new Error("STALE_QUOTE");
      return rows[0];
    });
    return { ok: true, version: updated.version };
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_QUOTE") {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }
}

/**
 * Re-rates with the typed miles. The dock distance cache is left alone.
 */
export async function overrideQuoteDistanceMiles(input: {
  quoteId: string;
  expectedVersion: number;
  miles: number;
  reason: string;
  actor: OverrideActor;
}): Promise<RateQuoteFreightResult> {
  const reason = reasonText(input.reason);
  if (!reason) return { ok: false, error: "A reason of 1 to 500 characters is required." };
  if (!Number.isFinite(input.miles) || input.miles < 0) {
    return { ok: false, error: "Miles must be zero or greater." };
  }

  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "Miles can be overridden on a draft only." };
  }

  const previous = quote.distance_miles ?? "";
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(quote_overrides)
        .values({
          quote_id: quote.id,
          field: "distance_miles",
          calculated_value: previous,
          override_value: input.miles.toFixed(2),
          reason,
          actor_id: input.actor.actorId,
          actor_role: input.actor.role,
        })
        .returning({ id: quote_overrides.id });
      if (!created) throw new Error("STALE_QUOTE");
      const rows = await tx
        .update(quotes)
        .set({
          distance_miles: input.miles.toFixed(2),
          distance_source: "manual_override",
          version: sql`${quotes.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quotes.id, quote.id),
            eq(quotes.version, input.expectedVersion),
            eq(quotes.status, "draft"),
          ),
        )
        .returning({ version: quotes.version });
      if (!rows[0]) throw new Error("STALE_QUOTE");
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_QUOTE") {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }
  return rateQuoteById(quote.id);
}

/**
 * Shown delivery date becomes the typed date. The calculated date stays.
 * Does not book a truck day.
 */
export async function overrideQuotePromiseDate(input: {
  quoteId: string;
  expectedVersion: number;
  promiseDate: string | null;
  reason: string;
  actor: OverrideActor;
}): Promise<
  { ok: true; version: number; promiseDate: string | null } | { ok: false; error: string }
> {
  const reason = reasonText(input.reason);
  if (!reason) return { ok: false, error: "A reason of 1 to 500 characters is required." };
  const typed = input.promiseDate?.trim() ?? "";
  if (input.promiseDate != null && !isIsoDate(typed)) {
    return { ok: false, error: "Promise date must be a real date." };
  }

  const db = getDb();
  const [quote] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  if (!quote) return { ok: false, error: "That quote could not be found." };
  if (quote.status !== "draft") {
    return { ok: false, error: "A delivery date can be overridden on a draft only." };
  }

  const overrideValue = input.promiseDate == null ? null : typed;
  const shown = overrideValue ?? quote.calculated_promise_date;
  try {
    const updated = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(quote_overrides)
        .values({
          quote_id: quote.id,
          field: "promise_date",
          calculated_value: quote.calculated_promise_date ?? "",
          override_value: overrideValue,
          reason,
          actor_id: input.actor.actorId,
          actor_role: input.actor.role,
        })
        .returning({ id: quote_overrides.id });
      if (!created) throw new Error("STALE_QUOTE");
      const rows = await tx
        .update(quotes)
        .set({
          promise_date: shown,
          promise_override_id: created.id,
          version: sql`${quotes.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quotes.id, quote.id),
            eq(quotes.version, input.expectedVersion),
            eq(quotes.status, "draft"),
          ),
        )
        .returning({ version: quotes.version });
      if (!rows[0]) throw new Error("STALE_QUOTE");
      return rows[0];
    });
    return { ok: true, version: updated.version, promiseDate: shown };
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_QUOTE") {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }
}
