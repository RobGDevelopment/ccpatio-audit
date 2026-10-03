import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { HoldActor } from "@/server/ghl/hold-actor";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  inventory_holds,
  quote_line_items,
  quotes,
  type QuoteStatus,
} from "@/server/db/schema";
import { lineDescription, merchandiseTotal, snapshotMsrp } from "@/server/quotes/msrp";
import { phoenixToday } from "@/server/quotes/phoenix-date";
import { readFreightOptions, type OrderDeskQuote } from "@/server/quotes/view";

const OPEN_STATUSES = ["draft", "sent"] as const;
const PAID_STATUSES = ["deposit_paid", "paid", "converted"] as const;

type ResolvedOpportunity = {
  id: string;
  name: string;
  contactId: string;
};

export type DraftVersionResult =
  | { ok: true; version: number }
  | { ok: false; error: "stale_version" | "not_draft" };

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && (current as { code?: string }).code === "23505") {
      return true;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function quoteReadOnly(status: QuoteStatus, closedOpportunity: boolean): boolean {
  return closedOpportunity || status !== "draft";
}

async function catalogBySku(
  skus: string[],
): Promise<Map<string, { msrp: string | null; description: string | null }>> {
  const map = new Map<string, { msrp: string | null; description: string | null }>();
  if (skus.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({
      sku: finished_goods_catalog.global_sku,
      msrp: finished_goods_catalog.msrp,
      description: finished_goods_catalog.description,
    })
    .from(finished_goods_catalog)
    .where(inArray(sql<string>`upper(${finished_goods_catalog.global_sku})`, skus));
  for (const row of rows) {
    map.set(row.sku.trim().toUpperCase(), {
      msrp: row.msrp,
      description: row.description,
    });
  }
  return map;
}

export async function loadQuoteDocument(
  opportunityId: string,
  closedOpportunity = false,
): Promise<OrderDeskQuote | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(quotes)
    .where(eq(quotes.ghl_opportunity_id, opportunityId))
    .orderBy(asc(quotes.created_at));

  const open = rows.find((row) =>
    OPEN_STATUSES.includes(row.status as (typeof OPEN_STATUSES)[number]),
  );
  const paid = rows.find((row) =>
    PAID_STATUSES.includes(row.status as (typeof PAID_STATUSES)[number]),
  );
  const voided = [...rows]
    .reverse()
    .find((row) => row.status === "void" || row.status === "expired");
  const quote = open ?? paid ?? (closedOpportunity ? voided : undefined);
  if (!quote) return null;

  const [lines, holds] = await Promise.all([
    db
      .select()
      .from(quote_line_items)
      .where(eq(quote_line_items.quote_id, quote.id))
      .orderBy(asc(quote_line_items.line_no)),
    db
      .select()
      .from(inventory_holds)
      .where(
        and(
          eq(inventory_holds.ghl_opportunity_id, opportunityId),
          eq(inventory_holds.status, "active"),
        ),
      )
      .orderBy(asc(inventory_holds.created_at)),
  ]);

  const attached = new Set(
    lines
      .map((line) => line.inventory_hold_id)
      .filter((id): id is string => Boolean(id)),
  );

  return {
    state: "quote",
    readOnly: quoteReadOnly(quote.status, closedOpportunity),
    closedOpportunity,
    quoteId: quote.id,
    version: quote.version,
    status: quote.status,
    opportunityId: quote.ghl_opportunity_id,
    opportunityName: quote.ghl_opportunity_name,
    destZip: quote.dest_zip?.trim() || null,
    distanceMiles: quote.distance_miles,
    distanceSource: quote.distance_source,
    merchandiseTotal: quote.merchandise_total,
    freightMethod: quote.freight_method,
    freightTotal: quote.freight_total,
    freightError: quote.freight_error,
    freightOptions: readFreightOptions(quote.freight_snapshot),
    executedBy: String(quote.executed_by).slice(0, 10),
    promiseDate: quote.promise_date ? String(quote.promise_date).slice(0, 10) : null,
    calculatedPromiseDate: quote.calculated_promise_date
      ? String(quote.calculated_promise_date).slice(0, 10)
      : null,
    promiseTruckCode: quote.promise_truck_code,
    promiseError: quote.promise_error,
    voidReason: quote.void_reason,
    lines: lines.map((line) => ({
      id: line.id,
      lineNo: line.line_no,
      sku: line.sku,
      qty: line.qty,
      unitPrice: line.unit_price,
      priceError: line.price_error,
      description: line.description,
      holdId: line.inventory_hold_id,
    })),
    suggestions: holds
      .filter((hold) => !attached.has(hold.id))
      .map((hold) => ({
        holdId: hold.id,
        sku: hold.sku,
        qty: hold.qty,
        note: hold.note,
        expiresAt: hold.expires_at.toISOString(),
      })),
  };
}

async function insertDraft(
  actor: HoldActor,
  opportunity: ResolvedOpportunity,
  destZip: string | null,
): Promise<OrderDeskQuote> {
  const db = getDb();
  const holds = await db
    .select()
    .from(inventory_holds)
    .where(
      and(
        eq(inventory_holds.ghl_opportunity_id, opportunity.id),
        eq(inventory_holds.status, "active"),
      ),
    )
    .orderBy(asc(inventory_holds.created_at), asc(inventory_holds.id));

  const catalog = await catalogBySku(
    holds.map((hold) => hold.sku.trim().toUpperCase()),
  );
  const priced = holds.map((hold, index) => {
    const sku = hold.sku.trim().toUpperCase();
    const goods = catalog.get(sku);
    const price = snapshotMsrp(goods?.msrp);
    return {
      lineNo: index + 1,
      sku,
      variantId: hold.katana_variant_id,
      qty: hold.qty,
      unitPrice: price.unitPrice,
      priceError: price.priceError,
      description: lineDescription(sku, goods?.description),
      holdId: hold.id,
    };
  });

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(quotes)
      .values({
        ghl_opportunity_id: opportunity.id,
        ghl_contact_id: opportunity.contactId,
        ghl_opportunity_name: opportunity.name,
        ghl_user_id: actor.ghlUserId,
        ghl_user_name: actor.ghlUserName,
        ghl_user_email: actor.ghlUserEmail,
        status: "draft",
        dest_zip: destZip,
        executed_by: phoenixToday(),
        merchandise_total: merchandiseTotal(priced),
      })
      .returning({ id: quotes.id });

    if (!created) {
      throw new Error("Could not create the quote.");
    }

    if (priced.length > 0) {
      await tx.insert(quote_line_items).values(
        priced.map((line) => ({
          quote_id: created.id,
          line_no: line.lineNo,
          line_kind: "stock_hold" as const,
          sku: line.sku,
          katana_variant_id: line.variantId,
          qty: line.qty,
          unit_price: line.unitPrice,
          price_error: line.priceError,
          description: line.description,
          inventory_hold_id: line.holdId,
        })),
      );
    }
  });

  const loaded = await loadQuoteDocument(opportunity.id);
  if (!loaded) throw new Error("The quote was created and then could not be read.");
  return loaded;
}

/**
 * Insert one draft and a line per active hold. A concurrent insert loses
 * the unique index and returns the quote that won.
 */
export async function createDraftFromResolved(input: {
  actor: HoldActor;
  opportunity: ResolvedOpportunity;
  destZip: string | null;
}): Promise<OrderDeskQuote> {
  try {
    return await insertDraft(input.actor, input.opportunity, input.destZip);
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await loadQuoteDocument(input.opportunity.id);
    if (!existing) throw error;
    return existing;
  }
}

export async function saveDraftVersion(input: {
  quoteId: string;
  version: number;
  patch: {
    ghlOpportunityName: string;
    ghlContactId: string;
    destZip: string | null;
  };
}): Promise<DraftVersionResult> {
  const db = getDb();
  const updated = await db
    .update(quotes)
    .set({
      ghl_opportunity_name: input.patch.ghlOpportunityName,
      ghl_contact_id: input.patch.ghlContactId,
      dest_zip: input.patch.destZip,
      version: sql`${quotes.version} + 1`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(quotes.id, input.quoteId),
        eq(quotes.version, input.version),
        eq(quotes.status, "draft"),
      ),
    )
    .returning({ version: quotes.version });

  const next = updated[0];
  if (next) return { ok: true, version: next.version };

  const [row] = await db
    .select({ status: quotes.status })
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  if (!row || row.status !== "draft") return { ok: false, error: "not_draft" };
  return { ok: false, error: "stale_version" };
}

/** Lost and Abandoned close an open quote. Paid quotes are flagged, not voided. */
export async function voidOpenQuotesForOpportunity(
  opportunityId: string,
  reason: "lost" | "abandoned",
): Promise<{ voided: number; flagged: number }> {
  const db = getDb();
  const now = new Date();
  const voided = await db
    .update(quotes)
    .set({
      status: "void",
      void_reason: reason,
      version: sql`${quotes.version} + 1`,
      updated_at: now,
    })
    .where(
      and(
        eq(quotes.ghl_opportunity_id, opportunityId),
        inArray(quotes.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: quotes.id });

  const flagged = await db
    .update(quotes)
    .set({
      commercial_conflict: "lost_after_payment",
      version: sql`${quotes.version} + 1`,
      updated_at: now,
    })
    .where(
      and(
        eq(quotes.ghl_opportunity_id, opportunityId),
        inArray(quotes.status, [...PAID_STATUSES]),
        sql`${quotes.commercial_conflict} is null`,
      ),
    )
    .returning({ id: quotes.id });

  return { voided: voided.length, flagged: flagged.length };
}
