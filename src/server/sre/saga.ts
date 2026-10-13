/**
 * Phase 9 Task 6 — saga compensation rules (pure logic).
 *
 * Returns a PLAN only. The executors arrive in steps 6 and 8; nothing here performs I/O.
 *
 * Rules, in order of precedence:
 *  1. The ledger leg failed            -> retry the ledger leg. NEVER roll anything back:
 *                                         the money already moved (or is moving), so
 *                                         undoing the order would orphan a payment.
 *  2. Paid, any other failure          -> no delete action of any kind; escalate to a human
 *                                         (SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION).
 *  3. Unpaid, any other failure        -> delete manufacturing orders FIRST (reverse creation
 *                                         order), THEN the sales order they hang off.
 *
 * Fail safe: a `paid` that is not exactly `false` is treated as paid.
 */

export type SagaFailedLeg = "ledger" | "sales_order" | "manufacturing_orders" | "other";

export type SagaStatusValue =
  | "PENDING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "COMPENSATING"
  | "COMPENSATED"
  | "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION";

export type CompensationAction =
  | { action: "retry_ledger" }
  | { action: "delete_mo"; moId: string | number }
  | { action: "delete_so"; soId: string | number };

export type CompensationPlan = {
  actions: CompensationAction[];
  status: SagaStatusValue;
};

export type CompensationInput = {
  paid: boolean;
  failedLeg: SagaFailedLeg;
  createdSoId?: string | number | null;
  /** In CREATION order (oldest first). */
  createdMoIds: ReadonlyArray<string | number>;
};

export class PaidSagaDeleteError extends Error {
  constructor() {
    super("Refusing to plan a delete for a paid saga (paid orders are never rolled back).");
    this.name = "PaidSagaDeleteError";
  }
}

export function isDeleteAction(action: CompensationAction): boolean {
  return action.action === "delete_mo" || action.action === "delete_so";
}

/** Throws if `plan` contains any delete while the saga is paid. */
export function assertNeverDeletePaid(paid: boolean, plan: CompensationPlan): void {
  // `!== false`: undefined/null/garbage count as paid.
  if (paid !== false && plan.actions.some(isDeleteAction)) {
    throw new PaidSagaDeleteError();
  }
}

export function planCompensation(input: CompensationInput): CompensationPlan {
  const paid = input.paid !== false;
  let plan: CompensationPlan;

  if (input.failedLeg === "ledger") {
    plan = { actions: [{ action: "retry_ledger" }], status: "IN_PROGRESS" };
  } else if (paid) {
    plan = { actions: [], status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" };
  } else {
    const actions: CompensationAction[] = [];
    for (let i = input.createdMoIds.length - 1; i >= 0; i -= 1) {
      actions.push({ action: "delete_mo", moId: input.createdMoIds[i] });
    }
    if (input.createdSoId !== undefined && input.createdSoId !== null && input.createdSoId !== "") {
      actions.push({ action: "delete_so", soId: input.createdSoId });
    }
    plan = { actions, status: actions.length > 0 ? "COMPENSATING" : "COMPENSATED" };
  }

  assertNeverDeletePaid(input.paid, plan);
  return plan;
}
