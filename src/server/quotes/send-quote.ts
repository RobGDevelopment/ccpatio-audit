import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  logistics_settings,
  order_intake,
  quote_line_items,
  quote_revisions,
  quotes,
  type FreightMethodColumn,
  type QuoteLineKind,
} from "@/server/db/schema";
import type { HoldActor } from "@/server/ghl/hold-actor";
import { updateOpportunityValue } from "@/server/ghl/private-api";
import { isDiscountType, quoteGrandTotal } from "@/lib/quote-financials";
import { merchandiseTotal } from "@/server/quotes/msrp";

const DEFAULT_DEPOSIT_PCT = "50.00";

export type SendQuoteError =
  | "quote_missing"
  | "stale_version"
  | "not_draft"
  | "no_lines"
  | "unpriced_line"
  | "freight_missing"
  | "promise_missing"
  | "dest_zip_invalid"
  | "opportunity_missing"
  | "opportunity_already_ordered";

export type RevertQuoteError = "quote_missing" | "stale_version" | "not_sent";

export type OpportunityValueSync = (
  opportunityId: string,
  value: number,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export type QuoteRevisionLine = {
  id: string;
  lineNo: number;
  lineKind: QuoteLineKind;
  sku: string;
  katanaVariantId: number | null;
  qty: string;
  unitPrice: string;
  description: string;
  inventoryHoldId: string | null;
};

export type QuoteRevisionPayload = {
  lines: QuoteRevisionLine[];
  destZip: string;
  distanceMiles: string | null;
  freightMethod: FreightMethodColumn | null;
  freightSnapshot: unknown;
  promiseDate: string;
  actor: {
    ghlUserId: string;
    ghlUserName: string;
    ghlUserEmail: string | null;
  };
};

export type FrozenQuote = {
  ok: true;
  version: number;
  revisionId: string;
  status: "sent";
  amountDue: string;
  opportunityValue: string;
  ghlSyncError: string | null;
  alreadySent: boolean;
};

/** Deposit in cents. `depositPct` is a percent, defaulting to 50 at the caller. */
export function amountDue(
  merchandiseTotalValue: string,
  freightTotal: string,
  depositPct: string,
): string | null {
  const merchandiseCents = toCents(merchandiseTotalValue);
  const freightCents = toCents(freightTotal);
  const pct = Number(depositPct);
  if (merchandiseCents == null || freightCents == null || !Number.isFinite(pct)) {
    return null;
  }
  if (merchandiseCents < 0 || freightCents < 0 || pct <= 0 || pct > 100) return null;
  const dueCents = Math.round(((merchandiseCents + freightCents) * pct) / 100);
  return (dueCents / 100).toFixed(2);
}

export function opportunityMirrorValue(
  merchandiseTotalValue: string,
  freightTotal: string,
): string | null {
  const merchandiseCents = toCents(merchandiseTotalValue);
  const freightCents = toCents(freightTotal);
  if (merchandiseCents == null || freightCents == null) return null;
  if (merchandiseCents < 0 || freightCents < 0) return null;
  return ((merchandiseCents + freightCents) / 100).toFixed(2);
}

function toCents(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function money(value: string): string {
  return Number(value).toFixed(2);
}

function dateText(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function zip5(value: string | null): string | null {
  const zip = value?.trim() ?? "";
  return /^\d{5}$/.test(zip) ? zip : null;
}

async function resolveDepositPct(
  tx: Pick<ReturnType<typeof getDb>, "select">,
  quotePct: string | null,
): Promise<string> {
  if (quotePct != null && quotePct.trim() !== "") return money(quotePct);
  const [settings] = await tx
    .select({ depositPct: logistics_settings.deposit_pct })
    .from(logistics_settings)
    .where(eq(logistics_settings.id, 1))
    .limit(1);
  if (settings?.depositPct != null && settings.depositPct.trim() !== "") {
    return money(settings.depositPct);
  }
  return DEFAULT_DEPOSIT_PCT;
}

async function rememberSyncError(quoteId: string, message: string): Promise<void> {
  await getDb()
    .update(quotes)
    .set({
      ghl_sync_error: message.slice(0, 500),
      updated_at: new Date(),
    })
    .where(eq(quotes.id, quoteId));
}

/**
 * Freeze a draft into one revision and mirror the grand total onto the
 * opportunity. A second call for a quote that is already `sent` returns
 * that revision and does not insert another.
 */
export async function freezeQuote(input: {
  quoteId: string;
  expectedVersion: number;
  actor: HoldActor;
  syncOpportunityValue?: OpportunityValueSync;
}): Promise<FrozenQuote | { ok: false; error: SendQuoteError }> {
  const sync = input.syncOpportunityValue ?? updateOpportunityValue;
  const db = getDb();

  const prepared = await db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, input.quoteId))
      .for("update")
      .limit(1);
    if (!quote) return { ok: false as const, error: "quote_missing" as const };

    if (quote.status === "sent" && quote.current_revision_id) {
      const [revision] = await tx
        .select()
        .from(quote_revisions)
        .where(eq(quote_revisions.id, quote.current_revision_id))
        .limit(1);
      if (!revision || revision.voided_at) {
        return { ok: false as const, error: "not_draft" as const };
      }
      const mirror = opportunityMirrorValue(
        revision.merchandise_total,
        revision.freight_total,
      );
      return {
        ok: true as const,
        alreadySent: true as const,
        version: quote.version,
        revisionId: revision.id,
        amountDue: revision.amount_due,
        opportunityValue: mirror ?? revision.amount_due,
        ghlSyncError: quote.ghl_sync_error,
      };
    }

    if (quote.status !== "draft") {
      return { ok: false as const, error: "not_draft" as const };
    }
    if (quote.version !== input.expectedVersion) {
      return { ok: false as const, error: "stale_version" as const };
    }
    const opportunityId = quote.ghl_opportunity_id;
    if (!opportunityId) {
      return { ok: false as const, error: "opportunity_missing" as const };
    }

    const lines = await tx
      .select()
      .from(quote_line_items)
      .where(eq(quote_line_items.quote_id, quote.id))
      .orderBy(quote_line_items.line_no);
    if (lines.length === 0) {
      return { ok: false as const, error: "no_lines" as const };
    }

    const priced = merchandiseTotal(
      lines.map((line) => ({ unitPrice: line.unit_price, qty: line.qty })),
    );
    if (!priced) return { ok: false as const, error: "unpriced_line" as const };
    if (quote.freight_total == null) {
      return { ok: false as const, error: "freight_missing" as const };
    }
    const promiseDate = dateText(quote.promise_date);
    if (!promiseDate) return { ok: false as const, error: "promise_missing" as const };
    const destZip = zip5(quote.dest_zip);
    if (!destZip) return { ok: false as const, error: "dest_zip_invalid" as const };

    const [intake] = await tx
      .select({ id: order_intake.id })
      .from(order_intake)
      .where(eq(order_intake.ghl_opportunity_id, opportunityId))
      .limit(1);
    if (intake) {
      return { ok: false as const, error: "opportunity_already_ordered" as const };
    }

    const depositPct = await resolveDepositPct(tx, quote.deposit_pct);
    const discountType = isDiscountType(quote.discount_type) ? quote.discount_type : "FLAT";
    const totals = quoteGrandTotal({
      subtotal: Number(priced),
      discountAmount: Number(quote.discount_amount),
      discountType,
      tax: Number(quote.tax_amount),
      shipping: Number(quote.freight_total),
    });
    const netGoods = (totals.total - totals.shipping).toFixed(2);
    const due = amountDue(netGoods, quote.freight_total, depositPct);
    const mirror = opportunityMirrorValue(netGoods, quote.freight_total);
    if (!due || !mirror) {
      return { ok: false as const, error: "freight_missing" as const };
    }

    const [latest] = await tx
      .select({ revisionNo: quote_revisions.revision_no })
      .from(quote_revisions)
      .where(eq(quote_revisions.quote_id, quote.id))
      .orderBy(desc(quote_revisions.revision_no))
      .limit(1);
    const revisionNo = (latest?.revisionNo ?? 0) + 1;

    const payload: QuoteRevisionPayload = {
      lines: lines.map((line) => ({
        id: line.id,
        lineNo: line.line_no,
        lineKind: line.line_kind,
        sku: line.sku,
        katanaVariantId: line.katana_variant_id,
        qty: line.qty,
        unitPrice: line.unit_price ?? "",
        description: line.description,
        inventoryHoldId: line.inventory_hold_id,
      })),
      destZip,
      distanceMiles: quote.distance_miles,
      freightMethod: quote.freight_method,
      freightSnapshot: quote.freight_snapshot,
      promiseDate,
      actor: {
        ghlUserId: input.actor.ghlUserId,
        ghlUserName: input.actor.ghlUserName,
        ghlUserEmail: input.actor.ghlUserEmail,
      },
    };

    const [revision] = await tx
      .insert(quote_revisions)
      .values({
        quote_id: quote.id,
        revision_no: revisionNo,
        payload,
        merchandise_total: priced,
        freight_total: money(quote.freight_total),
        deposit_pct: depositPct,
        amount_due: due,
      })
      .returning({ id: quote_revisions.id });
    if (!revision) throw new Error("Could not store the quote revision.");

    const [updated] = await tx
      .update(quotes)
      .set({
        status: "sent",
        current_revision_id: revision.id,
        deposit_pct: depositPct,
        merchandise_total: priced,
        ghl_sync_error: null,
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
    if (!updated) return { ok: false as const, error: "stale_version" as const };

    return {
      ok: true as const,
      alreadySent: false as const,
      quoteId: quote.id,
      opportunityId,
      version: updated.version,
      revisionId: revision.id,
      amountDue: due,
      opportunityValue: mirror,
    };
  });

  if (!prepared.ok) return prepared;
  if (prepared.alreadySent) {
    return {
      ok: true,
      version: prepared.version,
      revisionId: prepared.revisionId,
      status: "sent",
      amountDue: prepared.amountDue,
      opportunityValue: prepared.opportunityValue,
      ghlSyncError: prepared.ghlSyncError,
      alreadySent: true,
    };
  }

  let ghlSyncError: string | null = null;
  try {
    const synced = await sync(
      prepared.opportunityId,
      Number(prepared.opportunityValue),
    );
    if (!synced.ok) ghlSyncError = synced.error;
  } catch (error: unknown) {
    ghlSyncError =
      error instanceof Error ? error.message : "GoHighLevel opportunity update failed.";
  }
  if (ghlSyncError) await rememberSyncError(prepared.quoteId, ghlSyncError);

  return {
    ok: true,
    version: prepared.version,
    revisionId: prepared.revisionId,
    status: "sent",
    amountDue: prepared.amountDue,
    opportunityValue: prepared.opportunityValue,
    ghlSyncError,
    alreadySent: false,
  };
}

/** Void the open revision and return a sent quote to draft. */
export async function revertQuoteToDraft(input: {
  quoteId: string;
  expectedVersion: number;
}): Promise<
  { ok: true; version: number; status: "draft" } | { ok: false; error: RevertQuoteError }
> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, input.quoteId))
      .for("update")
      .limit(1);
    if (!quote) return { ok: false, error: "quote_missing" };
    if (quote.status !== "sent") return { ok: false, error: "not_sent" };
    if (quote.version !== input.expectedVersion) {
      return { ok: false, error: "stale_version" };
    }

    if (quote.current_revision_id) {
      await tx
        .update(quote_revisions)
        .set({ voided_at: new Date() })
        .where(
          and(
            eq(quote_revisions.id, quote.current_revision_id),
            sql`${quote_revisions.voided_at} is null`,
          ),
        );
    }

    const [updated] = await tx
      .update(quotes)
      .set({
        status: "draft",
        current_revision_id: null,
        ghl_sync_error: null,
        version: sql`${quotes.version} + 1`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(quotes.id, quote.id),
          eq(quotes.version, input.expectedVersion),
          eq(quotes.status, "sent"),
        ),
      )
      .returning({ version: quotes.version });
    if (!updated) return { ok: false, error: "stale_version" };
    return { ok: true, version: updated.version, status: "draft" };
  });
}
