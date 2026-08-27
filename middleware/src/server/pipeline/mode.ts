/**
 * Order pipeline mutation gate (Crawl / Walk / Run).
 *
 * log     — Crawl: persist webhook + log intent; never POST Katana SO/MTO
 * approve — Walk: same as log until Approve Sync UI ships (Priority 4)
 * live    — Run: create Katana SO + Make-to-Order MOs
 */

export type OrderPipelineMode = "log" | "approve" | "live";

export function getOrderPipelineMode(): OrderPipelineMode {
  const raw = process.env.ORDER_PIPELINE_MODE?.trim().toLowerCase();
  if (raw === "live" || raw === "approve" || raw === "log") {
    return raw;
  }
  return "log";
}

/** True only when Katana sales-order / MTO POSTs are allowed. */
export function canMutateKatanaOrders(
  mode: OrderPipelineMode = getOrderPipelineMode(),
): boolean {
  return mode === "live";
}

export function pipelineModeLabel(mode: OrderPipelineMode): string {
  switch (mode) {
    case "live":
      return "live (SO + MTO)";
    case "approve":
      return "approve (pending Sync UI)";
    default:
      return "log (Crawl dry-run)";
  }
}
