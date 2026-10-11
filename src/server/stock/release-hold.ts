import { and, eq, sql } from "drizzle-orm";
import {
  KATANA_HOLD_SALES_ORDER,
  KATANA_HOLD_STOCK_ADJUSTMENT,
  KatanaApiError,
  deleteKatanaHoldDocument,
  type KatanaHoldDocumentKind,
} from "@/lib/katana";
import { isHoldId } from "@/lib/inventory-holds";
import { getDb } from "@/server/db/client";
import {
  inventory_holds,
  type InventoryHoldReleaseReason,
} from "@/server/db/schema";
import { FABRIC_HOLD_ORDER_ID } from "@/server/ghl/hold-order";

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

function recordedDocumentKind(value: string | null): KatanaHoldDocumentKind {
  if (value === KATANA_HOLD_STOCK_ADJUSTMENT) return KATANA_HOLD_STOCK_ADJUSTMENT;
  if (value === KATANA_HOLD_SALES_ORDER || value == null) return KATANA_HOLD_SALES_ORDER;
  throw new Error(`Hold document kind "${value}" is not sales_order or stock_adjustment.`);
}

/**
 * Read the ledger flag and DELETE that one Katana document.
 * A 404 from the chosen endpoint means it is already gone. It does not select the other endpoint.
 */
async function deleteRecordedHoldDocument(
  holdId: string,
  documentId: number,
  orderNo: string,
): Promise<void> {
  if (documentId === FABRIC_HOLD_ORDER_ID || !orderNo.startsWith("HOLD-")) {
    throw new Error(`Refusing to delete ${orderNo}.`);
  }
  const [row] = await getDb()
    .select({ kind: inventory_holds.converted_order_no })
    .from(inventory_holds)
    .where(eq(inventory_holds.id, holdId))
    .limit(1);
  const kind = recordedDocumentKind(row?.kind ?? null);
  try {
    await deleteKatanaHoldDocument(kind, documentId);
  } catch (error: unknown) {
    if (error instanceof KatanaApiError && error.status === 404) return;
    throw error;
  }
}

/** Delete the recorded Katana document and close a row that is already `releasing`. */
export async function finishReleasingHold(target: ReleaseTarget): Promise<"released" | "failed"> {
  try {
    await deleteRecordedHoldDocument(target.id, target.katanaDummySoId, target.orderNo);
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

/**
 * Manual release of one hold, including a designer swap in the factory BOM.
 * Deletes the HOLD- sales order, then marks the row released.
 * `releasedBy` is the actor id or email. Pass `factory-bom` when no browser session exists.
 */
export async function releaseHoldById(
  holdId: string,
  releasedBy: string,
): Promise<"released" | "failed" | "missed"> {
  const id = holdId.trim();
  const actor = releasedBy.trim();
  if (!isHoldId(id) || !actor) return "missed";

  const db = getDb();
  const [row] = await db
    .select({
      id: inventory_holds.id,
      status: inventory_holds.status,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
    })
    .from(inventory_holds)
    .where(eq(inventory_holds.id, id))
    .limit(1);
  if (!row) return "missed";

  const target = {
    id: row.id,
    orderNo: row.orderNo,
    katanaDummySoId: row.katanaDummySoId,
  };
  if (row.status === "releasing") return finishReleasingHold(target);
  if (row.status !== "active") return "missed";
  return releaseActiveHold({ target, reason: "manual", releasedBy: actor });
}

const HOLD_ADJUSTMENT_NO = /^hold-[0-9a-f]{8}$/;
const CONVERTING_DELETE_NOTE = "Katana deleted this hold while it was converting.";

export type DeletedHoldDecision = "release" | "ignore" | "note";

/** Pure match for a Katana delete. `note` keeps `converting` and records last_error. */
export function decideDeletedHoldRelease(input: {
  status: string;
  orderNo: string;
  documentId: number;
  storedKind: string | null;
  eventKind: KatanaHoldDocumentKind;
  eventNumber: string | null;
  eventId: number | null;
}): DeletedHoldDecision {
  const orderNo = input.orderNo.trim().toLowerCase();
  const eventNumber = input.eventNumber?.trim().toLowerCase() ?? "";
  const numberHit = HOLD_ADJUSTMENT_NO.test(eventNumber) && eventNumber === orderNo;
  const idHit =
    input.eventId != null &&
    input.eventId === input.documentId &&
    HOLD_ADJUSTMENT_NO.test(orderNo);
  if (!numberHit && !idHit) return "ignore";
  const kindMatches =
    input.eventKind === KATANA_HOLD_STOCK_ADJUSTMENT
      ? input.storedKind === KATANA_HOLD_STOCK_ADJUSTMENT
      : input.storedKind === KATANA_HOLD_SALES_ORDER || input.storedKind == null;
  if (!kindMatches) return "ignore";
  if (input.status === "converting") return "note";
  if (input.status === "active" || input.status === "releasing") return "release";
  return "ignore";
}

/**
 * Katana already deleted the HOLD- stock adjustment. Close the ledger row
 * without sending another DELETE. Sales-order holds and factory conversions stay put.
 */
export async function releaseDeletedStockAdjustmentHold(
  stockAdjustmentNumber: string,
): Promise<"released" | "ignored" | "failed"> {
  return releaseDeletedHoldDocument({
    documentKind: KATANA_HOLD_STOCK_ADJUSTMENT,
    number: stockAdjustmentNumber,
    documentId: null,
  });
}

/**
 * Katana already deleted the HOLD- document. Close the ledger row without
 * sending another DELETE. A converting row keeps its status and records last_error.
 */
export async function releaseDeletedHoldDocument(input: {
  documentKind: KatanaHoldDocumentKind;
  number: string | null;
  documentId: number | null;
}): Promise<"released" | "ignored" | "failed"> {
  const eventNumber = input.number?.trim().toLowerCase() ?? "";
  const numberLookup = HOLD_ADJUSTMENT_NO.test(eventNumber) ? eventNumber : null;
  const idLookup =
    input.documentId != null && Number.isInteger(input.documentId) && input.documentId > 0
      ? input.documentId
      : null;
  if (!numberLookup && idLookup == null) return "ignored";

  const db = getDb();
  const [row] = await db
    .select({
      id: inventory_holds.id,
      status: inventory_holds.status,
      orderNo: inventory_holds.order_no,
      katanaDummySoId: inventory_holds.katana_dummy_so_id,
      kind: inventory_holds.converted_order_no,
    })
    .from(inventory_holds)
    .where(
      numberLookup
        ? sql`lower(${inventory_holds.order_no}) = ${numberLookup}`
        : eq(inventory_holds.katana_dummy_so_id, idLookup as number),
    )
    .limit(1);
  if (!row) return "ignored";
  if (row.status === "released" || row.status === "converted") return "released";

  const decision = decideDeletedHoldRelease({
    status: row.status,
    orderNo: row.orderNo,
    documentId: row.katanaDummySoId,
    storedKind: row.kind,
    eventKind: input.documentKind,
    eventNumber: input.number,
    eventId: input.documentId,
  });
  if (decision === "ignore") return "ignored";
  if (decision === "note") {
    await db
      .update(inventory_holds)
      .set({ last_error: CONVERTING_DELETE_NOTE, updated_at: new Date() })
      .where(and(eq(inventory_holds.id, row.id), eq(inventory_holds.status, "converting")));
    return "ignored";
  }

  if (row.status === "active") {
    const claimed = await claimActiveHold(
      { id: row.id, orderNo: row.orderNo, katanaDummySoId: row.katanaDummySoId },
      "manual",
      "katana-webhook",
    );
    if (!claimed) return "failed";
  } else if (row.status !== "releasing") {
    return "ignored";
  }

  const closed = await markReleased(row.id);
  return closed ? "released" : "failed";
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
