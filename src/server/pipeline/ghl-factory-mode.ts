/**
 * Gate for the scoped GHL factory-order pipeline (§2.4).
 * Distinct from ORDER_PIPELINE_MODE, which must not enable these POSTs.
 *
 * log  — persist order_intake; Approve saves the mapping and does not call Katana
 * live — Approve & Push may send order.approved, which POSTs the sales order, MTO, and hold relief
 */

export type GhlFactoryOrderMode = "log" | "live";

export function getGhlFactoryOrderMode(): GhlFactoryOrderMode {
  const raw = process.env.GHL_FACTORY_ORDERS?.trim().toLowerCase();
  return raw === "live" ? "live" : "log";
}

export function canPushGhlFactoryOrders(
  mode: GhlFactoryOrderMode = getGhlFactoryOrderMode(),
): boolean {
  return mode === "live";
}
