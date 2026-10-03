import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { roundQty } from "@/lib/stock-display";
import { withAdvisoryLocks } from "@/server/db/advisory-lock";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  inventory_holds,
  quote_line_items,
  quotes,
  type InventoryHoldReleaseReason,
  type InventoryHoldStatus,
} from "@/server/db/schema";
import {
  FABRIC_HOLD_ORDER_ID,
  FABRIC_HOLD_ORDER_NO,
} from "@/server/ghl/hold-order";
import { lineDescription, merchandiseTotal, snapshotMsrp } from "@/server/quotes/msrp";

export type QuoteHoldMutation =
  | { ok: true; version: number }
  | {
      ok: false;
      error: string;
      previousHoldId?: string;
      version?: number;
    };

export type HoldCreateRequest = {
  variantId: number;
  sku: string;
  qty: number;
  opportunityId: string;
  note: string;
};

export type QuoteHoldPorts = {
  createHold: (
    input: HoldCreateRequest,
  ) => Promise<{ ok: true; holdId: string } | { ok: false; error: string }>;
  releaseHold: (holdId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

type QuoteRow = {
  id: string;
  status: string;
  version: number;
  opportunityId: string;
};

type LineRow = {
  id: string;
  holdId: string | null;
  sku: string;
  variantId: number;
  qty: string;
};

type HoldRow = {
  id: string;
  status: InventoryHoldStatus;
  releaseReason: InventoryHoldReleaseReason | null;
  opportunityId: string;
  variantId: number;
  orderNo: string;
  katanaDummySoId: number;
};

class QuoteClaimError extends Error {
  constructor() {
    super("stale_version");
    this.name = "QuoteClaimError";
  }
}

export function isLegacyFabricHold(hold: {
  orderNo: string;
  katanaDummySoId: number;
}): boolean {
  return (
    hold.orderNo === FABRIC_HOLD_ORDER_NO || hold.katanaDummySoId === FABRIC_HOLD_ORDER_ID
  );
}

const LEGACY_FABRIC_ERROR = "Refusing to release the legacy fabric freeze.";

function draftError(quote: QuoteRow | null, expectedVersion: number): string | null {
  if (!quote) return "quote_missing";
  if (quote.status !== "draft") return "not_draft";
  if (quote.version !== expectedVersion) return "stale_version";
  return null;
}

function holdProblem(hold: HoldRow | null, opportunityId: string): string | null {
  if (!hold) return "hold_missing";
  if (isLegacyFabricHold(hold)) return LEGACY_FABRIC_ERROR;
  if (hold.status !== "active") {
    if (hold.status === "released" && hold.releaseReason) return hold.releaseReason;
    return hold.status;
  }
  if (hold.opportunityId !== opportunityId) return "not_on_opportunity";
  return null;
}

async function loadQuote(quoteId: string): Promise<QuoteRow | null> {
  const db = getDb();
  const [quote] = await db
    .select({
      id: quotes.id,
      status: quotes.status,
      version: quotes.version,
      opportunityId: quotes.ghl_opportunity_id,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return quote ?? null;
}

async function loadLine(quoteId: string, lineId: string): Promise<LineRow | null> {
  const db = getDb();
  const [line] = await db
    .select({
      id: quote_line_items.id,
      holdId: quote_line_items.inventory_hold_id,
      sku: quote_line_items.sku,
      variantId: quote_line_items.katana_variant_id,
      qty: quote_line_items.qty,
    })
    .from(quote_line_items)
    .where(and(eq(quote_line_items.id, lineId), eq(quote_line_items.quote_id, quoteId)))
    .limit(1);
  return line ?? null;
}

async function loadHold(holdId: string): Promise<HoldRow | null> {
  const db = getDb();
  const [hold] = await db
    .select({
      id: inventory_holds.id,
      status: inventory_holds.status,
      releaseReason: inventory_holds.release_reason,
      opportunityId: inventory_holds.ghl_opportunity_id,
      variantId: inventory_holds.katana_variant_id,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(eq(inventory_holds.id, holdId))
    .limit(1);
  return hold ?? null;
}

async function snapshotSku(sku: string): Promise<{
  unitPrice: string | null;
  priceError: string | null;
  description: string;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      msrp: finished_goods_catalog.msrp,
      description: finished_goods_catalog.description,
    })
    .from(finished_goods_catalog)
    .where(inArray(sql<string>`upper(${finished_goods_catalog.global_sku})`, [sku]))
    .limit(1);
  const price = snapshotMsrp(row?.msrp);
  return {
    unitPrice: price.unitPrice,
    priceError: price.priceError,
    description: lineDescription(sku, row?.description),
  };
}

async function writeMerchandise(
  tx: Pick<ReturnType<typeof getDb>, "select" | "update">,
  quoteId: string,
  expectedVersion: number,
): Promise<number> {
  const rows = await tx
    .select({
      unitPrice: quote_line_items.unit_price,
      qty: quote_line_items.qty,
    })
    .from(quote_line_items)
    .where(eq(quote_line_items.quote_id, quoteId));
  const claimed = await tx
    .update(quotes)
    .set({
      merchandise_total: merchandiseTotal(rows),
      version: sql`${quotes.version} + 1`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(quotes.id, quoteId),
        eq(quotes.version, expectedVersion),
        eq(quotes.status, "draft"),
      ),
    )
    .returning({ version: quotes.version });
  const next = claimed[0];
  if (!next) throw new QuoteClaimError();
  return next.version;
}

async function deleteLine(input: {
  quoteId: string;
  lineId: string;
  holdId: string | null;
  expectedVersion: number;
}): Promise<QuoteHoldMutation> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const holdMatch = input.holdId
        ? eq(quote_line_items.inventory_hold_id, input.holdId)
        : isNull(quote_line_items.inventory_hold_id);
      const deleted = await tx
        .delete(quote_line_items)
        .where(
          and(
            eq(quote_line_items.id, input.lineId),
            eq(quote_line_items.quote_id, input.quoteId),
            holdMatch,
          ),
        )
        .returning({ id: quote_line_items.id });
      if (deleted.length === 0) return { ok: false, error: "line_changed" };
      const version = await writeMerchandise(tx, input.quoteId, input.expectedVersion);
      return { ok: true, version };
    });
  } catch (error: unknown) {
    if (error instanceof QuoteClaimError) return { ok: false, error: "stale_version" };
    throw error;
  }
}

/**
 * Release a stock line's hold, then delete the line. The line row stays until
 * release succeeds. `removing` is only the request order, not a stored status.
 */
export async function removeHeldQuoteLine(
  input: { quoteId: string; lineId: string; expectedVersion: number },
  ports: QuoteHoldPorts,
): Promise<QuoteHoldMutation> {
  const quote = await loadQuote(input.quoteId);
  const blocked = draftError(quote, input.expectedVersion);
  if (blocked) return { ok: false, error: blocked };
  const line = await loadLine(input.quoteId, input.lineId);
  if (!line) return { ok: false, error: "line_missing" };

  return withAdvisoryLocks([line.variantId], async () => {
    const freshQuote = await loadQuote(input.quoteId);
    const freshBlocked = draftError(freshQuote, input.expectedVersion);
    if (freshBlocked) return { ok: false, error: freshBlocked };
    const freshLine = await loadLine(input.quoteId, input.lineId);
    if (!freshLine) return { ok: false, error: "line_missing" };
    if (freshLine.holdId !== line.holdId) return { ok: false, error: "line_changed" };

    if (freshLine.holdId) {
      const hold = await loadHold(freshLine.holdId);
      if (!hold) return { ok: false, error: "hold_missing" };
      if (isLegacyFabricHold(hold)) return { ok: false, error: LEGACY_FABRIC_ERROR };
      const released = await ports.releaseHold(freshLine.holdId);
      if (!released.ok) {
        const after = await loadHold(freshLine.holdId);
        if (after?.status !== "released") return { ok: false, error: released.error };
      }
    }

    return deleteLine({
      quoteId: input.quoteId,
      lineId: input.lineId,
      holdId: freshLine.holdId,
      expectedVersion: input.expectedVersion,
    });
  });
}

async function attachSwap(input: {
  quoteId: string;
  lineId: string;
  oldHoldId: string;
  expectedVersion: number;
  sku: string;
  variantId: number;
  qty: number;
  unitPrice: string | null;
  priceError: string | null;
  description: string;
  holdId: string;
}): Promise<QuoteHoldMutation> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const updated = await tx
        .update(quote_line_items)
        .set({
          sku: input.sku,
          katana_variant_id: input.variantId,
          qty: input.qty.toFixed(4),
          unit_price: input.unitPrice,
          price_error: input.priceError,
          description: input.description,
          inventory_hold_id: input.holdId,
          line_kind: "stock_hold",
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quote_line_items.id, input.lineId),
            eq(quote_line_items.quote_id, input.quoteId),
            eq(quote_line_items.inventory_hold_id, input.oldHoldId),
          ),
        )
        .returning({ id: quote_line_items.id });
      if (updated.length === 0) return { ok: false, error: "line_changed" };
      const version = await writeMerchandise(tx, input.quoteId, input.expectedVersion);
      return { ok: true, version };
    });
  } catch (error: unknown) {
    if (error instanceof QuoteClaimError) return { ok: false, error: "stale_version" };
    throw error;
  }
}

/**
 * Create the new hold, point the line at it, then release the old hold.
 * Both variant ids are locked in ascending order before create, so two swaps
 * cannot deadlock. A failed release keeps the new hold on the line.
 */
export async function swapHeldQuoteLine(
  input: {
    quoteId: string;
    lineId: string;
    newSku: string;
    newVariantId: number;
    newQty: number;
    expectedVersion: number;
  },
  ports: QuoteHoldPorts,
): Promise<QuoteHoldMutation> {
  const sku = input.newSku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "SKU is required." };
  if (!Number.isInteger(input.newVariantId) || input.newVariantId <= 0) {
    return { ok: false, error: "Variant id is required." };
  }
  if (!Number.isFinite(input.newQty) || input.newQty <= 0) {
    return { ok: false, error: "Quantity must be greater than 0." };
  }
  const qty = roundQty(input.newQty);

  const quote = await loadQuote(input.quoteId);
  const blocked = draftError(quote, input.expectedVersion);
  if (blocked) return { ok: false, error: blocked };
  const line = await loadLine(input.quoteId, input.lineId);
  if (!line) return { ok: false, error: "line_missing" };
  if (!line.holdId) return { ok: false, error: "no_hold" };
  const hold = await loadHold(line.holdId);
  const problem = holdProblem(hold, quote!.opportunityId);
  if (problem) return { ok: false, error: problem };

  return withAdvisoryLocks([line.variantId, input.newVariantId], async () => {
    const freshQuote = await loadQuote(input.quoteId);
    const freshBlocked = draftError(freshQuote, input.expectedVersion);
    if (freshBlocked || !freshQuote) {
      return { ok: false, error: freshBlocked ?? "quote_missing" };
    }
    const freshLine = await loadLine(input.quoteId, input.lineId);
    if (!freshLine) return { ok: false, error: "line_missing" };
    if (!freshLine.holdId) return { ok: false, error: "no_hold" };
    const freshHold = await loadHold(freshLine.holdId);
    const freshProblem = holdProblem(freshHold, freshQuote.opportunityId);
    if (freshProblem) return { ok: false, error: freshProblem };

    const created = await ports.createHold({
      variantId: input.newVariantId,
      sku,
      qty,
      opportunityId: freshQuote.opportunityId,
      note: `Order desk swap from ${freshLine.sku}`.slice(0, 500),
    });
    if (!created.ok) return created;

    const price = await snapshotSku(sku);
    const attached = await attachSwap({
      quoteId: input.quoteId,
      lineId: input.lineId,
      oldHoldId: freshLine.holdId,
      expectedVersion: input.expectedVersion,
      sku,
      variantId: input.newVariantId,
      qty,
      unitPrice: price.unitPrice,
      priceError: price.priceError,
      description: price.description,
      holdId: created.holdId,
    });
    if (!attached.ok) {
      const undone = await ports.releaseHold(created.holdId);
      if (!undone.ok) {
        return {
          ok: false,
          error: `The new hold is still active (${created.holdId}). ${undone.error}`,
        };
      }
      return attached;
    }

    const released = await ports.releaseHold(freshLine.holdId);
    if (!released.ok) {
      const after = await loadHold(freshLine.holdId);
      if (after?.status === "released") return { ok: true, version: attached.version };
      return {
        ok: false,
        error: "previous_hold_still_active",
        previousHoldId: freshLine.holdId,
        version: attached.version,
      };
    }
    return { ok: true, version: attached.version };
  });
}

export async function legacyFabricReleaseError(holdId: string): Promise<string | null> {
  const hold = await loadHold(holdId);
  if (hold && isLegacyFabricHold(hold)) return LEGACY_FABRIC_ERROR;
  return null;
}
