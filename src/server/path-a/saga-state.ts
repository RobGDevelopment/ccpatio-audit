/**
 * Pure state module for Path A CAD / Design Loop saga.
 * Single source of truth for saga transitions, item transitions, target derivation, and UI view-model.
 * Pure: no I/O, no environment imports.
 */
import type { SagaStatusValue } from "@/server/sre/saga";

export const PATH_A_SAGA_TYPE = "path_a_cad" as const;

export type PathAItemStatus =
  | "awaiting_cad"
  | "needs_review"
  | "cad_failed"
  | "finalized"
  | "released";

export const PATH_A_ITEM_STATUSES: readonly PathAItemStatus[] = [
  "awaiting_cad",
  "needs_review",
  "cad_failed",
  "finalized",
  "released",
] as const;

export class PathASagaTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Illegal Path A saga transition from "${from}" to "${to}".`);
    this.name = "PathASagaTransitionError";
  }
}

export class PathAItemTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Illegal Path A item transition from "${from}" to "${to}".`);
    this.name = "PathAItemTransitionError";
  }
}

const LEGAL_SAGA_TRANSITIONS: Partial<Record<SagaStatusValue, readonly SagaStatusValue[]>> = {
  PENDING: ["PENDING", "AWAITING_DEPOSIT"],
  AWAITING_DEPOSIT: ["AWAITING_DEPOSIT", "PENDING", "IN_PROGRESS"],
  IN_PROGRESS: ["IN_PROGRESS", "COMPLETED", "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"],
  SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION: [
    "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
    "IN_PROGRESS",
  ],
  COMPLETED: ["COMPLETED"],
};

export function assertLegalSagaTransition(
  from: SagaStatusValue,
  to: SagaStatusValue,
): void {
  const allowed = LEGAL_SAGA_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new PathASagaTransitionError(from, to);
  }
}

const LEGAL_ITEM_TRANSITIONS: Record<PathAItemStatus, readonly PathAItemStatus[]> = {
  awaiting_cad: ["awaiting_cad", "needs_review", "cad_failed"],
  needs_review: ["needs_review", "finalized", "awaiting_cad"],
  cad_failed: ["cad_failed", "awaiting_cad"],
  finalized: ["finalized", "needs_review", "awaiting_cad", "released"],
  released: ["released"],
};

export function assertLegalItemTransition(
  from: PathAItemStatus,
  to: PathAItemStatus,
): void {
  const allowed = LEGAL_ITEM_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new PathAItemTransitionError(from, to);
  }
}

export type ItemStatusHolder = {
  design_status: string;
};

export type SagaRowHolder = {
  status: string;
  current_step?: string | null;
  release_requested_at?: Date | string | null;
};

/**
 * Derives the target status and step the saga should hold based on its child items.
 * Blueprint guard: item count >= 1 AND every item `finalized` AND no item in `awaiting_cad` / `needs_review` / `cad_failed`.
 */
export function deriveSagaTarget(
  items: readonly ItemStatusHolder[],
  currentSaga?: SagaRowHolder | null,
): { status: SagaStatusValue; step: string } {
  // If saga is already in release or completed, keep its status
  if (
    currentSaga?.status === "IN_PROGRESS" ||
    currentSaga?.status === "COMPLETED" ||
    currentSaga?.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"
  ) {
    return {
      status: currentSaga.status as SagaStatusValue,
      step: currentSaga.current_step ?? "releasing",
    };
  }

  if (items.length === 0) {
    return { status: "PENDING", step: "designing" };
  }

  const allFinalizedOrReleased = items.every(
    (i) => i.design_status === "finalized" || i.design_status === "released",
  );
  const nonePendingCad = items.every(
    (i) =>
      i.design_status !== "awaiting_cad" &&
      i.design_status !== "needs_review" &&
      i.design_status !== "cad_failed",
  );

  if (allFinalizedOrReleased && nonePendingCad) {
    return { status: "AWAITING_DEPOSIT", step: "awaiting_deposit_or_override" };
  }

  if (items.some((i) => i.design_status === "awaiting_cad")) {
    return { status: "PENDING", step: "cad_dispatched" };
  }

  if (items.some((i) => i.design_status === "needs_review")) {
    return { status: "PENDING", step: "awaiting_design_review" };
  }

  if (items.some((i) => i.design_status === "cad_failed")) {
    return { status: "PENDING", step: "cad_failed" };
  }

  return { status: "PENDING", step: "designing" };
}

export type SagaViewModel = {
  label: string;
  tone: "neutral" | "emerald" | "amber" | "rose" | "indigo";
  ageDays: number;
  awaitingSince: string | null;
  canOverride: boolean;
  canRetryRelease: boolean;
  lockedReason?: string;
};

export type DescribeSagaInputRow = {
  status: string;
  current_step?: string | null;
  release_requested_at?: Date | string | null;
  release_source?: string | null;
  release_requested_by?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_error?: string | null;
};

/**
 * Pure view-model generator for the UI dashboard.
 * MANDATE D6: NO deadline, NO overdue, NO countdown anywhere.
 */
export function describePathASaga(
  row: DescribeSagaInputRow,
  items: readonly ItemStatusHolder[],
  now: Date = new Date(),
): SagaViewModel {
  const createdAt = new Date(row.created_at);
  const updatedAt = new Date(row.updated_at);
  const ageMs = Math.max(0, now.getTime() - createdAt.getTime());
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  const hasRequest = Boolean(row.release_requested_at);

  let label = "Designing";
  let tone: SagaViewModel["tone"] = "neutral";
  let awaitingSince: string | null = null;
  let canOverride = false;
  let canRetryRelease = false;
  let lockedReason: string | undefined;

  switch (row.status) {
    case "PENDING": {
      tone = "neutral";
      if (row.current_step === "cad_dispatched") {
        label = "Converting CAD";
      } else if (row.current_step === "awaiting_design_review") {
        label = "Needs Design Review";
      } else if (row.current_step?.startsWith("cad_failed")) {
        label = "CAD Failed";
        tone = "rose";
      } else if (row.current_step === "design_changed") {
        label = "Design Changed";
      } else if (row.current_step === "deposit_received_early") {
        label = "Deposit Received (Designing)";
        tone = "amber";
      } else {
        label = "Designing";
      }
      lockedReason = "Design must be finalized before release.";
      break;
    }
    case "AWAITING_DEPOSIT": {
      awaitingSince = updatedAt.toISOString();
      if (hasRequest) {
        label = row.release_source === "management_override"
          ? "Release Requested (Override)"
          : "Deposit Recorded (Queued)";
        tone = "indigo";
        canOverride = false;
        lockedReason = `Release already requested by ${row.release_requested_by ?? "system"}.`;
      } else {
        label = "Awaiting Deposit";
        tone = "amber";
        canOverride = true;
      }
      break;
    }
    case "IN_PROGRESS": {
      label = "Releasing to Katana";
      tone = "indigo";
      lockedReason = "Order release is currently in progress.";
      break;
    }
    case "COMPLETED": {
      label = "Released to Production";
      tone = "emerald";
      lockedReason = "Order has already been released to Katana.";
      break;
    }
    case "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION": {
      label = "Release Failed (Manual)";
      tone = "rose";
      canRetryRelease = hasRequest;
      lockedReason = row.last_error ?? "Manual intervention required.";
      break;
    }
    default: {
      label = row.status;
      tone = "neutral";
      lockedReason = "Unknown status.";
    }
  }

  return {
    label,
    tone,
    ageDays,
    awaitingSince,
    canOverride,
    canRetryRelease,
    lockedReason,
  };
}
