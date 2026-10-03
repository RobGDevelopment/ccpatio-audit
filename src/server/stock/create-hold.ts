import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  KatanaApiError,
  createKatanaSalesOrder,
  katanaFetch,
  resolveKatanaVariantId,
} from "@/lib/katana";
import {
  SHOWROOM_HOLD_CUSTOMER_EMAIL,
  SHOWROOM_HOLD_CUSTOMER_NAME,
  showroomHoldExpiresAt,
  showroomHoldOrderNo,
} from "@/lib/inventory-holds";
import { roundQty } from "@/lib/stock-display";
import { withAdvisoryLock } from "@/server/db/advisory-lock";
import { getDb } from "@/server/db/client";
import { inventory_holds, logistics_profiles } from "@/server/db/schema";
import { CC_MANUFACTURING_LOCATION_ID } from "@/server/ghl/hold-order";
import type { HoldActor, HoldOpportunity } from "@/server/ghl/hold-actor";
import { readCardInventory, readFactoryCommitted } from "@/server/stock/factory-inventory";
import { deleteHoldSalesOrder } from "@/server/stock/delete-hold-order";

const NOTE_MAX = 500;
const CUSTOMER_REF_MAX = 200;
const ADDITIONAL_INFO_MAX = 1000;

export type CreateHoldInput = {
  variantId: number;
  sku: string;
  qty: number;
  note: string;
  actor: HoldActor;
  opportunity: HoldOpportunity;
};

export type CreateHoldResult =
  | {
      ok: true;
      holdId: string;
      orderNo: string;
      katanaDummySoId: number;
      expiresAt: string;
    }
  | { ok: false; error: string };

function fail(error: string): CreateHoldResult {
  return { ok: false, error };
}

function qtyText(qty: number): string {
  return roundQty(qty).toFixed(4);
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function additionalInfo(input: {
  actor: HoldActor;
  opportunity: HoldOpportunity;
  holdId: string;
  expiresAt: Date;
  note: string;
}): string {
  const lines = [
    `Rep: ${input.actor.ghlUserName}${input.actor.ghlUserEmail ? ` <${input.actor.ghlUserEmail}>` : ""}`,
    `Opportunity: ${input.opportunity.name} (${input.opportunity.id})`,
    `Hold: ${input.holdId}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    `Note: ${input.note}`,
  ];
  return clip(lines.join("\n"), ADDITIONAL_INFO_MAX);
}

async function ledgerCommitted(variantId: number): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${inventory_holds.qty}), 0)`,
    })
    .from(inventory_holds)
    .where(
      and(
        eq(inventory_holds.katana_variant_id, variantId),
        inArray(inventory_holds.status, ["active", "converting"]),
      ),
    );
  return roundQty(Number(row?.total ?? 0));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function compensate(
  salesOrderId: number,
  orderNo: string,
  holdId: string,
): Promise<string | null> {
  try {
    await deleteHoldSalesOrder(salesOrderId, orderNo);
    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[soft-hold] compensating delete failed", {
      holdId,
      orderNo,
      salesOrderId,
      message,
    });
    return message;
  }
}

function validate(input: CreateHoldInput): CreateHoldResult | null {
  if (!Number.isInteger(input.variantId) || input.variantId <= 0) {
    return fail("Variant id is required.");
  }
  if (!input.sku.trim()) return fail("SKU is required.");
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return fail("Quantity must be greater than 0.");
  }
  const note = input.note.trim();
  if (!note || note.length > NOTE_MAX) {
    return fail(`Note must be 1–${NOTE_MAX} characters.`);
  }
  if (!input.opportunity.id.trim()) return fail("Opportunity id is required.");
  if (!input.actor.ghlUserId.trim() || !input.actor.ghlUserName.trim()) {
    return fail("Salesperson could not be confirmed.");
  }
  return null;
}

/**
 * Freight and promise dates join logistics_profiles on katana_variant_id.
 * That id can differ from sku_mappings when Katana reissued the variant.
 * A hold for this SKU may use the profile's id so rating finds the real row.
 */
async function logisticsVariantForSku(sku: string, variantId: number): Promise<boolean> {
  const [profile] = await getDb()
    .select({ variantId: logistics_profiles.katana_variant_id })
    .from(logistics_profiles)
    .where(eq(logistics_profiles.variant_sku, sku))
    .limit(1);
  return profile?.variantId === variantId;
}

async function createHoldLocked(input: CreateHoldInput): Promise<CreateHoldResult> {
  const sku = input.sku.trim().toUpperCase();
  const note = input.note.trim();
  const qty = roundQty(input.qty);
  const holdId = randomUUID();
  let orderNo: string;
  try {
    orderNo = showroomHoldOrderNo(holdId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not build the hold number.";
    return fail(message);
  }
  const expiresAt = showroomHoldExpiresAt();

  let resolvedVariantId: number;
  try {
    resolvedVariantId = await resolveKatanaVariantId(sku);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not resolve the SKU.";
    return fail(message);
  }
  if (
    resolvedVariantId !== input.variantId &&
    !(await logisticsVariantForSku(sku, input.variantId))
  ) {
    return fail(`SKU ${sku} resolved to a different Katana variant.`);
  }

  let inventory: Awaited<ReturnType<typeof readCardInventory>>;
  let ledgerQty: number;
  try {
    [inventory, ledgerQty] = await Promise.all([
      readCardInventory(input.variantId),
      ledgerCommitted(input.variantId),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read inventory.";
    return fail(message);
  }

  if (!inventory.atFactory) {
    return fail("Katana has no inventory at CC Manufacturing for this variant.");
  }

  const committed = Math.max(inventory.committed, ledgerQty);
  const available = roundQty(inventory.inStock - committed);
  if (qty > available) {
    return fail(
      `Only ${available} available at CC Manufacturing. ${qty} was requested.`,
    );
  }

  let committedBefore: number;
  try {
    committedBefore = await readFactoryCommitted(input.variantId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read committed stock.";
    return fail(message);
  }

  let created: Awaited<ReturnType<typeof createKatanaSalesOrder>>;
  try {
    created = await createKatanaSalesOrder({
      orderNo,
      locationId: CC_MANUFACTURING_LOCATION_ID,
      customerRef: clip(input.opportunity.name, CUSTOMER_REF_MAX),
      additionalInfo: additionalInfo({
        actor: input.actor,
        opportunity: input.opportunity,
        holdId,
        expiresAt,
        note,
      }),
      idempotencyKey: `soft-hold:${holdId}`,
      customer: {
        name: SHOWROOM_HOLD_CUSTOMER_NAME,
        email: SHOWROOM_HOLD_CUSTOMER_EMAIL,
      },
      salesOrderRows: [
        {
          sku,
          variantId: input.variantId,
          quantity: qty,
          pricePerUnit: 0,
          locationId: CC_MANUFACTURING_LOCATION_ID,
        },
      ],
    });
  } catch (error: unknown) {
    const message =
      error instanceof KatanaApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Katana did not create the hold.";
    return fail(message);
  }

  if (created.orderNo !== orderNo) {
    const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
    return fail(
      deleteError
        ? `Katana returned order ${created.orderNo}. Compensating delete failed: ${deleteError}`
        : `Katana returned order ${created.orderNo} instead of ${orderNo}.`,
    );
  }

  try {
    const { data } = await katanaFetch<Record<string, unknown>>(
      `/sales_orders/${created.salesOrderId}`,
    );
    const rows = Array.isArray(data.sales_order_rows) ? data.sales_order_rows : [];
    const row = asRecord(rows[0]);
    const rowVariant = Number(row?.variant_id);
    if (rowVariant !== input.variantId) {
      const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
      return fail(
        deleteError
          ? `Variant mismatch on ${orderNo}. Compensating delete failed: ${deleteError}`
          : `SKU ${sku} was posted against a different variant. The hold was removed.`,
      );
    }
  } catch (error: unknown) {
    const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
    const message = error instanceof Error ? error.message : "Could not read the hold sales order.";
    return fail(
      deleteError
        ? `${message} Compensating delete failed: ${deleteError}`
        : message,
    );
  }

  let committedAfter: number;
  try {
    committedAfter = await readFactoryCommitted(input.variantId);
  } catch (error: unknown) {
    const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
    const message = error instanceof Error ? error.message : "Could not prove the hold committed stock.";
    return fail(
      deleteError
        ? `${message} Compensating delete failed: ${deleteError}`
        : message,
    );
  }

  if (roundQty(committedAfter - committedBefore) + 0.00005 < qty) {
    const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
    return fail(
      deleteError
        ? `Hold ${orderNo} did not commit stock at CC Manufacturing. Compensating delete failed: ${deleteError}`
        : `Hold ${orderNo} did not commit stock at CC Manufacturing, so it was removed.`,
    );
  }

  try {
    const db = getDb();
    await db.insert(inventory_holds).values({
      id: holdId,
      katana_variant_id: input.variantId,
      sku,
      qty: qtyText(qty),
      ghl_user_id: input.actor.ghlUserId,
      ghl_user_name: input.actor.ghlUserName,
      ghl_user_email: input.actor.ghlUserEmail,
      ghl_contact_id: input.opportunity.contactId,
      ghl_opportunity_id: input.opportunity.id,
      ghl_opportunity_name: input.opportunity.name,
      note,
      expires_at: expiresAt,
      status: "active",
      katana_dummy_so_id: created.salesOrderId,
      katana_sales_order_row_id: created.salesOrderRowIds[0] ?? null,
      order_no: orderNo,
      updated_at: new Date(),
    });
  } catch (error: unknown) {
    const deleteError = await compensate(created.salesOrderId, orderNo, holdId);
    const message = error instanceof Error ? error.message : "Could not save the hold.";
    return fail(
      deleteError
        ? `${message} Compensating delete failed for Katana order ${created.salesOrderId}: ${deleteError}`
        : message,
    );
  }

  return {
    ok: true,
    holdId,
    orderNo,
    katanaDummySoId: created.salesOrderId,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const invalid = validate(input);
  if (invalid) return invalid;
  try {
    return await withAdvisoryLock(input.variantId, () => createHoldLocked(input));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not place the hold.";
    return fail(message);
  }
}
