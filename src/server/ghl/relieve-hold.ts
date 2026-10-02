import { katanaFetch, KatanaApiError } from "@/lib/katana";
import type { OrderIntakeHoldRelief } from "@/server/db/schema";
import { nextHoldQuantity, roundYards } from "@/server/ghl/fabric-yardage";
import { FABRIC_HOLD_ORDER_ID, FABRIC_HOLD_ORDER_NO } from "@/server/ghl/hold-order";

export type HoldReliefRequest = {
  fabricSku: string;
  variantId: number;
  yards: number;
};

type HoldRow = {
  id: number;
  variantId: number;
  quantity: number;
  notes: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function reliefToken(intakeId: string, fabricSku: string): string {
  return `ghl-relief:${intakeId}:${fabricSku}`;
}

function unwrapOrder(data: unknown): Record<string, unknown> {
  const record = asRecord(data);
  if (!record) return {};
  if (record.id != null || record.sales_order_rows != null) return record;
  return asRecord(record.data) ?? record;
}

function parseHoldRows(data: unknown): HoldRow[] {
  const rows = unwrapOrder(data).sales_order_rows;
  if (!Array.isArray(rows)) return [];
  const parsed: HoldRow[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    const id = Number(record?.id);
    const variantId = Number(record?.variant_id);
    const quantity = Number(record?.quantity);
    if (!Number.isFinite(id) || !Number.isFinite(variantId) || !Number.isFinite(quantity)) {
      continue;
    }
    parsed.push({
      id,
      variantId,
      quantity,
      notes: typeof record?.notes === "string" ? record.notes : "",
    });
  }
  return parsed;
}

async function loadHoldRows(): Promise<HoldRow[]> {
  const { data } = await katanaFetch<unknown>(`/sales_orders/${FABRIC_HOLD_ORDER_ID}`);
  const order = unwrapOrder(data);
  if (String(order.order_no ?? "") !== FABRIC_HOLD_ORDER_NO) {
    throw new KatanaApiError(
      `Sales order ${FABRIC_HOLD_ORDER_ID} is not ${FABRIC_HOLD_ORDER_NO}.`,
      { status: 422 },
    );
  }
  return parseHoldRows(data);
}

/**
 * Reduce MIG-HOLD-FABRIC-20260811 by the yards this factory order consumes.
 * A notes token plus `applied` stops a retry from deducting twice.
 */
export async function relieveFabricHold(input: {
  intakeId: string;
  existing: OrderIntakeHoldRelief[] | null;
  requests: HoldReliefRequest[];
}): Promise<OrderIntakeHoldRelief[]> {
  const relief = [...(input.existing ?? [])];
  let rows = await loadHoldRows();

  for (const request of input.requests) {
    const fabricSku = request.fabricSku.trim().toUpperCase();
    const token = reliefToken(input.intakeId, fabricSku);
    const prior = relief.find((row) => row.fabricSku === fabricSku);
    if (prior?.applied) continue;

    const line = rows.find((row) => row.variantId === request.variantId);
    if (line && line.notes.includes(token)) {
      relief.push({
        fabricSku,
        holdRowId: line.id,
        yardsBefore: roundYards(line.quantity + request.yards),
        yardsRelieved: request.yards,
        applied: true,
      });
      continue;
    }
    if (!line) {
      throw new KatanaApiError(
        `${FABRIC_HOLD_ORDER_NO} has no line for ${fabricSku} (variant ${request.variantId}).`,
        { status: 422 },
      );
    }

    const yardsBefore = line.quantity;
    const decision = nextHoldQuantity(yardsBefore, request.yards);
    if (decision.action === "refuse") {
      throw new KatanaApiError(decision.error, { status: 422 });
    }

    const notes = [line.notes.trim(), token].filter(Boolean).join(" ");
    if (decision.action === "delete") {
      await katanaFetch(`/sales_order_rows/${line.id}`, { method: "DELETE" });
      rows = rows.filter((row) => row.id !== line.id);
    } else {
      await katanaFetch(`/sales_order_rows/${line.id}`, {
        method: "PATCH",
        body: { quantity: decision.quantity, notes },
        idempotencyKey: `${token}:${decision.quantity}`,
      });
      line.quantity = decision.quantity;
      line.notes = notes;
    }

    const nextRelief: OrderIntakeHoldRelief = {
      fabricSku,
      holdRowId: line.id,
      yardsBefore,
      yardsRelieved: request.yards,
      applied: true,
    };
    const index = relief.findIndex((row) => row.fabricSku === fabricSku);
    if (index >= 0) relief[index] = nextRelief;
    else relief.push(nextRelief);
  }

  return relief;
}
