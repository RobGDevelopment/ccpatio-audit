import { randomUUID } from "node:crypto";
import {
  KATANA_HOLD_SALES_ORDER,
  KATANA_HOLD_STOCK_ADJUSTMENT,
  KatanaApiError,
  createKatanaHoldStockAdjustment,
  createKatanaSalesOrder,
  deleteKatanaHoldDocument,
  findVariantById,
  katanaFetch,
  resolveKatanaVariantId,
  type KatanaHoldDocumentKind,
  type KatanaVariantRecord,
} from "@/lib/katana";
import {
  SHOWROOM_HOLD_CUSTOMER_EMAIL,
  SHOWROOM_HOLD_CUSTOMER_NAME,
  showroomHoldExpiresAt,
  showroomHoldOrderNo,
} from "@/lib/inventory-holds";
import { roundQty } from "@/lib/stock-display";
import { eq } from "drizzle-orm";
import { withAdvisoryLock } from "@/server/db/advisory-lock";
import { getDb } from "@/server/db/client";
import { inventory_holds, logistics_profiles, sku_mappings } from "@/server/db/schema";
import { CC_MANUFACTURING_LOCATION_ID } from "@/server/ghl/hold-order";
import type { HoldActor, HoldOpportunity } from "@/server/ghl/hold-actor";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function compensate(
  documentKind: KatanaHoldDocumentKind,
  documentId: number,
  orderNo: string,
  holdId: string,
): Promise<string | null> {
  try {
    if (documentKind === KATANA_HOLD_STOCK_ADJUSTMENT) {
      await deleteKatanaHoldDocument(documentKind, documentId);
    } else {
      await deleteHoldSalesOrder(documentId, orderNo);
    }
    return null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[soft-hold] compensating delete failed", {
      holdId,
      orderNo,
      documentKind,
      documentId,
      message,
    });
    return message;
  }
}

function isMaterialVariant(variant: KatanaVariantRecord): boolean {
  const type = variant.type.trim().toLowerCase();
  if (type === "material") return true;
  if (type === "product") return false;
  return variant.material_id != null && variant.product_id == null;
}

/** Live Katana type wins. The catalog item type is only used when the variant is missing. */
async function resolveHoldDocumentKind(
  variantId: number,
  sku: string,
): Promise<KatanaHoldDocumentKind> {
  const live = await findVariantById(variantId);
  if (live) {
    return isMaterialVariant(live) ? KATANA_HOLD_STOCK_ADJUSTMENT : KATANA_HOLD_SALES_ORDER;
  }
  const [mapping] = await getDb()
    .select({ itemType: sku_mappings.item_type })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!mapping) {
    throw new Error(`Could not tell whether ${sku} is a product or a material.`);
  }
  return mapping.itemType === "raw_material"
    ? KATANA_HOLD_STOCK_ADJUSTMENT
    : KATANA_HOLD_SALES_ORDER;
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

  let documentKind: KatanaHoldDocumentKind;
  try {
    documentKind = await resolveHoldDocumentKind(input.variantId, sku);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not classify the variant.";
    return fail(message);
  }
  if (documentKind === KATANA_HOLD_STOCK_ADJUSTMENT) {
    return createMaterialHold({
      input,
      sku,
      note,
      qty,
      holdId,
      orderNo,
      expiresAt,
    });
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
    const deleteError = await compensate(
      KATANA_HOLD_SALES_ORDER,
      created.salesOrderId,
      orderNo,
      holdId,
    );
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
      const deleteError = await compensate(
        KATANA_HOLD_SALES_ORDER,
        created.salesOrderId,
        orderNo,
        holdId,
      );
      return fail(
        deleteError
          ? `Variant mismatch on ${orderNo}. Compensating delete failed: ${deleteError}`
          : `SKU ${sku} was posted against a different variant. The hold was removed.`,
      );
    }
  } catch (error: unknown) {
    const deleteError = await compensate(
      KATANA_HOLD_SALES_ORDER,
      created.salesOrderId,
      orderNo,
      holdId,
    );
    const message = error instanceof Error ? error.message : "Could not read the hold sales order.";
    return fail(
      deleteError
        ? `${message} Compensating delete failed: ${deleteError}`
        : message,
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
      // Document kind until factory conversion writes the real order number.
      converted_order_no: KATANA_HOLD_SALES_ORDER,
      updated_at: new Date(),
    });
  } catch (error: unknown) {
    const deleteError = await compensate(
      KATANA_HOLD_SALES_ORDER,
      created.salesOrderId,
      orderNo,
      holdId,
    );
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

async function createMaterialHold(ctx: {
  input: CreateHoldInput;
  sku: string;
  note: string;
  qty: number;
  holdId: string;
  orderNo: string;
  expiresAt: Date;
}): Promise<CreateHoldResult> {
  const { input, sku, note, qty, holdId, orderNo, expiresAt } = ctx;
  const notes = additionalInfo({
    actor: input.actor,
    opportunity: input.opportunity,
    holdId,
    expiresAt,
    note,
  });

  let created: Awaited<ReturnType<typeof createKatanaHoldStockAdjustment>>;
  try {
    created = await createKatanaHoldStockAdjustment({
      adjustmentNumber: orderNo,
      locationId: CC_MANUFACTURING_LOCATION_ID,
      variantId: input.variantId,
      quantity: qty,
      customer: {
        name: SHOWROOM_HOLD_CUSTOMER_NAME,
        email: SHOWROOM_HOLD_CUSTOMER_EMAIL,
      },
      customerName: input.opportunity.name,
      notes,
      idempotencyKey: `soft-hold:${holdId}`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof KatanaApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Katana did not create the material hold.";
    return fail(message);
  }

  if (created.adjustmentNumber !== orderNo) {
    const deleteError = await compensate(
      KATANA_HOLD_STOCK_ADJUSTMENT,
      created.stockAdjustmentId,
      orderNo,
      holdId,
    );
    return fail(
      deleteError
        ? `Katana returned adjustment ${created.adjustmentNumber}. Compensating delete failed: ${deleteError}`
        : `Katana returned adjustment ${created.adjustmentNumber} instead of ${orderNo}.`,
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
      katana_dummy_so_id: created.stockAdjustmentId,
      katana_sales_order_row_id: null,
      order_no: orderNo,
      // Document kind until factory conversion writes the real order number.
      converted_order_no: KATANA_HOLD_STOCK_ADJUSTMENT,
      updated_at: new Date(),
    });
  } catch (error: unknown) {
    const deleteError = await compensate(
      KATANA_HOLD_STOCK_ADJUSTMENT,
      created.stockAdjustmentId,
      orderNo,
      holdId,
    );
    const message = error instanceof Error ? error.message : "Could not save the hold.";
    return fail(
      deleteError
        ? `${message} Compensating delete failed for Katana adjustment ${created.stockAdjustmentId}: ${deleteError}`
        : message,
    );
  }

  return {
    ok: true,
    holdId,
    orderNo,
    katanaDummySoId: created.stockAdjustmentId,
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
