/**
 * Phase B1: persistence for quarantined WooCommerce orders (`quarantined_orders`).
 *
 * Statuses used for Woo: `pending_review` (validation failed, replayable),
 * `post_payment_edit` (paid order changed after processing, alert only, acknowledge/discard),
 * `resolved`, `discarded`. `quarantined_orders.status` is plain text in the database (no check
 * constraint), so `post_payment_edit` is a TypeScript-enum addition only.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { quarantined_orders } from "@/server/db/schema";
import type { SkuIngressIssue } from "./ingress.schema";

export type WooQuarantineStatus =
  | "pending_review"
  | "post_payment_edit"
  | "resolved"
  | "discarded";

export type QuarantineUpsertResult = "inserted" | "changed" | "unchanged";

/**
 * One open row per (order, status) across redeliveries. The payload is always refreshed.
 * `changed` means the issue set differs from what was last stored (alert-worthy for edits).
 */
export async function quarantineOnce(input: {
  externalId: string;
  rawPayload: unknown;
  issues: SkuIngressIssue[];
  status: "pending_review" | "post_payment_edit";
}): Promise<QuarantineUpsertResult> {
  const db = getDb();
  const [existing] = await db
    .select({ id: quarantined_orders.id, issues: quarantined_orders.issues })
    .from(quarantined_orders)
    .where(
      and(
        eq(quarantined_orders.source, "woocommerce"),
        eq(quarantined_orders.external_id, input.externalId),
        eq(quarantined_orders.status, input.status),
      ),
    )
    .limit(1);

  if (existing) {
    const same = JSON.stringify(existing.issues) === JSON.stringify(input.issues);
    await db
      .update(quarantined_orders)
      .set({
        raw_payload: input.rawPayload as object,
        issues: input.issues,
        updated_at: new Date(),
      })
      .where(eq(quarantined_orders.id, existing.id));
    return same ? "unchanged" : "changed";
  }

  await db.insert(quarantined_orders).values({
    source: "woocommerce",
    external_id: input.externalId,
    raw_payload: input.rawPayload as object,
    issues: input.issues,
    status: input.status,
    updated_at: new Date(),
  });
  return "inserted";
}

/**
 * A valid paid order was just enqueued: close any open `pending_review` rows for it.
 * Returns the number of rows resolved.
 */
export async function resolvePendingReviewForOrder(externalId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(quarantined_orders)
    .set({ status: "resolved", updated_at: new Date() })
    .where(
      and(
        eq(quarantined_orders.source, "woocommerce"),
        eq(quarantined_orders.external_id, externalId),
        eq(quarantined_orders.status, "pending_review"),
      ),
    )
    .returning({ id: quarantined_orders.id });
  return rows.length;
}

export type WooQuarantineRow = {
  id: number;
  externalId: string;
  status: WooQuarantineStatus;
  rawPayload: unknown;
  issues: SkuIngressIssue[];
  createdAt: Date;
  updatedAt: Date;
};

function toRow(row: typeof quarantined_orders.$inferSelect): WooQuarantineRow {
  return {
    id: row.id,
    externalId: row.external_id,
    status: row.status as WooQuarantineStatus,
    rawPayload: row.raw_payload,
    issues: Array.isArray(row.issues) ? (row.issues as SkuIngressIssue[]) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getWooQuarantineRow(id: number): Promise<WooQuarantineRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(quarantined_orders)
    .where(and(eq(quarantined_orders.id, id), eq(quarantined_orders.source, "woocommerce")))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function listOpenWooQuarantine(): Promise<WooQuarantineRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(quarantined_orders)
    .where(
      and(
        eq(quarantined_orders.source, "woocommerce"),
        inArray(quarantined_orders.status, ["pending_review", "post_payment_edit"]),
      ),
    )
    .orderBy(desc(quarantined_orders.updated_at));
  return rows.map(toRow);
}

/** Compare-and-set a status. Returns false when the row was not in `from` (already handled). */
export async function transitionWooQuarantine(input: {
  id: number;
  from: "pending_review" | "post_payment_edit";
  to: "resolved" | "discarded";
  issues?: SkuIngressIssue[];
}): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(quarantined_orders)
    .set({
      status: input.to,
      ...(input.issues ? { issues: input.issues } : {}),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(quarantined_orders.id, input.id),
        eq(quarantined_orders.source, "woocommerce"),
        eq(quarantined_orders.status, input.from),
      ),
    )
    .returning({ id: quarantined_orders.id });
  return rows.length > 0;
}

/** Refresh issues on a still-pending row after a failed replay. */
export async function updatePendingIssues(id: number, issues: SkuIngressIssue[]): Promise<void> {
  const db = getDb();
  await db
    .update(quarantined_orders)
    .set({ issues, updated_at: new Date() })
    .where(
      and(
        eq(quarantined_orders.id, id),
        eq(quarantined_orders.source, "woocommerce"),
        eq(quarantined_orders.status, "pending_review"),
      ),
    );
}
