/**
 * Phase 15 — pure Katana Sales Order & Manufacturing Order status snapshots,
 * deterministic order-number lane routing, and factory stage derivation.
 *
 * Pure module: zero I/O, zero env reads, zero wall-clock time.
 */

import { FACTORY_STAGES, type FactoryStage } from "@/server/db/schema";
import { asRecord, positiveInt, text } from "@/server/katana/webhook-events";
import { katanaOrderNo } from "@/server/sre/idempotency";

export const KATANA_SO_STATUS_VALUES = [
  "NOT_SHIPPED",
  "PENDING",
  "PACKED",
  "DELIVERED",
] as const;

export const KATANA_SO_PRODUCTION_STATUS_VALUES = [
  "NONE",
  "NOT_STARTED",
  "NOT_APPLICABLE",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
] as const;

export const KATANA_MO_STATUS_VALUES = [
  "NOT_STARTED",
  "BLOCKED",
  "IN_PROGRESS",
  "DONE",
] as const;

export const FACTORY_STAGE_RANK: Record<FactoryStage, number> = {
  in_production: 1,
  build_complete: 2,
  ready_to_ship: 3,
  delivered: 4,
};

const ACTIVE_PRODUCTION_STATUSES: ReadonlySet<string> = new Set([
  "IN_PROGRESS",
  "BLOCKED",
]);

const ACTIVE_MO_STATUSES: ReadonlySet<string> = new Set([
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
]);

const VALID_FACTORY_STAGES: ReadonlySet<string> = new Set(FACTORY_STAGES);

export function rankOfFactoryStage(stage: string | null | undefined): number {
  if (!stage || !VALID_FACTORY_STAGES.has(stage)) return 0;
  return FACTORY_STAGE_RANK[stage as FactoryStage];
}

export function factoryStageFromRank(rank: number): FactoryStage | null {
  switch (rank) {
    case 1:
      return "in_production";
    case 2:
      return "build_complete";
    case 3:
      return "ready_to_ship";
    case 4:
      return "delivered";
    default:
      return null;
  }
}

export type KatanaSoSnapshot = {
  id: number;
  orderNo: string;
  status: string | null;
  productionStatus: string | null;
};

export type KatanaMoSnapshot = {
  id: number;
  status: string | null;
  salesOrderId: number | null;
};

function unwrapEntity(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  if (positiveInt(root.id) !== null) return root;
  return asRecord(root.data) ?? root;
}

export function readSalesOrderSnapshot(raw: unknown): KatanaSoSnapshot {
  const entity = unwrapEntity(raw);
  if (!entity) {
    throw new Error("Katana sales order payload must be an object");
  }
  const id = positiveInt(entity.id);
  if (id === null) {
    throw new Error("Katana sales order payload is missing a positive integer id");
  }
  const orderNo = typeof entity.order_no === "string" ? entity.order_no.trim() : "";
  if (!orderNo) {
    throw new Error(`Katana sales order ${id} is missing order_no`);
  }
  const statusRaw = text(entity.status).toUpperCase();
  const productionRaw = text(entity.production_status).toUpperCase();
  return {
    id,
    orderNo,
    status: statusRaw || null,
    productionStatus: productionRaw || null,
  };
}

export function readManufacturingOrderSnapshot(raw: unknown): KatanaMoSnapshot {
  const entity = unwrapEntity(raw);
  if (!entity) {
    throw new Error("Katana manufacturing order payload must be an object");
  }
  const id = positiveInt(entity.id);
  if (id === null) {
    throw new Error("Katana manufacturing order payload is missing a positive integer id");
  }
  const statusRaw = text(entity.status).toUpperCase();
  const salesOrderId = positiveInt(entity.sales_order_id);
  return {
    id,
    status: statusRaw || null,
    salesOrderId,
  };
}

export type HubLane = "ghl_factory" | "path_a" | "woo" | "unknown";

const PROBE_EXTERNAL_ID = "__phase15_probe__";

function deriveOrderNoPrefix(source: "ghl" | "path_a" | "woo"): string {
  const full = katanaOrderNo(source, PROBE_EXTERNAL_ID);
  return full.slice(0, full.length - PROBE_EXTERNAL_ID.length);
}

const GHL_PREFIX = deriveOrderNoPrefix("ghl");
const PATH_A_PREFIX = deriveOrderNoPrefix("path_a");
const WOO_PREFIX = deriveOrderNoPrefix("woo");

export function parseOrderNoLane(orderNo: string): {
  lane: HubLane;
  externalId: string | null;
} {
  if (typeof orderNo !== "string" || orderNo.length === 0) {
    return { lane: "unknown", externalId: null };
  }
  // Exact closed-prefix, case-sensitive match (§VI R-2.1).
  const candidates: ReadonlyArray<{ prefix: string; lane: Exclude<HubLane, "unknown"> }> = [
    { prefix: GHL_PREFIX, lane: "ghl_factory" },
    { prefix: PATH_A_PREFIX, lane: "path_a" },
    { prefix: WOO_PREFIX, lane: "woo" },
  ];
  for (const candidate of candidates) {
    if (orderNo.startsWith(candidate.prefix)) {
      const rest = orderNo.slice(candidate.prefix.length);
      if (rest.length > 0 && rest.trim() === rest && rest.toLowerCase() !== "unknown") {
        return { lane: candidate.lane, externalId: rest };
      }
      return { lane: "unknown", externalId: null };
    }
  }
  return { lane: "unknown", externalId: null };
}

export function laneForOrderNo(orderNo: string): HubLane {
  return parseOrderNoLane(orderNo).lane;
}

export function opportunityIdFromOrderNo(orderNo: string): {
  lane: "ghl_factory" | "path_a";
  opportunityId: string;
} | null {
  const parsed = parseOrderNoLane(orderNo);
  if (
    (parsed.lane === "ghl_factory" || parsed.lane === "path_a") &&
    parsed.externalId
  ) {
    return { lane: parsed.lane, opportunityId: parsed.externalId };
  }
  return null;
}

/**
 * Precedence (§15.4a + §VI R-9.2/R-12):
 *  1. `so.status === "DELIVERED"` -> `"delivered"`
 *  2. `so.status === "PACKED"`    -> `"ready_to_ship"`
 *  3. `so.productionStatus === "DONE"` OR (`expectedMoIds` non-empty, every expected MO is
 *     present in the SO-linked MOs with `status === "DONE"`, and every SO-linked MO is `"DONE"`)
 *     -> `"build_complete"`
 *  4. `so.productionStatus` in `{"IN_PROGRESS","BLOCKED"}` OR any SO-linked MO in
 *     `{"IN_PROGRESS","BLOCKED","DONE"}` -> `"in_production"`
 *  5. otherwise `null`
 */
export function deriveFactoryStage(
  so: KatanaSoSnapshot,
  mos: readonly KatanaMoSnapshot[],
  expectedMoIds: readonly number[] = [],
): FactoryStage | null {
  const linkedMos = mos.filter((mo) => mo.salesOrderId === so.id);

  if (so.status === "DELIVERED") {
    return "delivered";
  }
  if (so.status === "PACKED") {
    return "ready_to_ship";
  }

  const expectedSet = new Set<number>();
  for (const id of expectedMoIds) {
    if (Number.isInteger(id) && id > 0) {
      expectedSet.add(id);
    }
  }

  if (so.productionStatus === "DONE") {
    return "build_complete";
  }

  if (expectedSet.size > 0 && linkedMos.length > 0) {
    const linkedById = new Map<number, KatanaMoSnapshot>();
    for (const mo of linkedMos) {
      linkedById.set(mo.id, mo);
    }
    let allExpectedDone = true;
    for (const expectedId of expectedSet) {
      const hit = linkedById.get(expectedId);
      if (!hit || hit.status !== "DONE") {
        allExpectedDone = false;
        break;
      }
    }
    if (allExpectedDone && linkedMos.every((mo) => mo.status === "DONE")) {
      return "build_complete";
    }
  }

  if (
    (so.productionStatus !== null && ACTIVE_PRODUCTION_STATUSES.has(so.productionStatus)) ||
    linkedMos.some((mo) => mo.status !== null && ACTIVE_MO_STATUSES.has(mo.status))
  ) {
    return "in_production";
  }

  return null;
}

