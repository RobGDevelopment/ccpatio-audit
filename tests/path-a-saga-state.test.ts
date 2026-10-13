/**
 * Unit tests for Path A pure state module: transitions, target derivation, and UI view-model.
 * Zero I/O, zero network, zero env reads.
 */
import { describe, expect, it } from "vitest";
import {
  assertLegalItemTransition,
  assertLegalSagaTransition,
  deriveSagaTarget,
  describePathASaga,
  PathAItemTransitionError,
  PathASagaTransitionError,
  type PathAItemStatus,
} from "@/server/path-a/saga-state";
import type { SagaStatusValue } from "@/server/sre/saga";

describe("Path A Saga Transitions", () => {
  it("allows legal saga transitions", () => {
    expect(() => assertLegalSagaTransition("PENDING", "AWAITING_DEPOSIT")).not.toThrow();
    expect(() => assertLegalSagaTransition("AWAITING_DEPOSIT", "PENDING")).not.toThrow();
    expect(() => assertLegalSagaTransition("AWAITING_DEPOSIT", "IN_PROGRESS")).not.toThrow();
    expect(() => assertLegalSagaTransition("IN_PROGRESS", "COMPLETED")).not.toThrow();
    expect(() =>
      assertLegalSagaTransition("IN_PROGRESS", "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"),
    ).not.toThrow();
    expect(() =>
      assertLegalSagaTransition("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION", "IN_PROGRESS"),
    ).not.toThrow();
    expect(() => assertLegalSagaTransition("AWAITING_DEPOSIT", "AWAITING_DEPOSIT")).not.toThrow();
  });

  it("strictly forbids illegal transitions and compensation states", () => {
    // Cannot skip pause directly from PENDING to IN_PROGRESS or COMPLETED
    expect(() => assertLegalSagaTransition("PENDING", "IN_PROGRESS")).toThrow(
      PathASagaTransitionError,
    );
    expect(() => assertLegalSagaTransition("PENDING", "COMPLETED")).toThrow(
      PathASagaTransitionError,
    );

    // COMPENSATING / COMPENSATED are forbidden in Path A (M1: no compensation/delete)
    expect(() => assertLegalSagaTransition("IN_PROGRESS", "COMPENSATING")).toThrow(
      PathASagaTransitionError,
    );
    expect(() => assertLegalSagaTransition("COMPENSATING", "COMPENSATED")).toThrow(
      PathASagaTransitionError,
    );
    expect(() => assertLegalSagaTransition("AWAITING_DEPOSIT", "COMPENSATING")).toThrow(
      PathASagaTransitionError,
    );
    expect(() => assertLegalSagaTransition("COMPLETED", "PENDING")).toThrow(
      PathASagaTransitionError,
    );
  });
});

describe("Path A Item Transitions", () => {
  it("allows legal item transitions", () => {
    expect(() => assertLegalItemTransition("awaiting_cad", "needs_review")).not.toThrow();
    expect(() => assertLegalItemTransition("awaiting_cad", "cad_failed")).not.toThrow();
    expect(() => assertLegalItemTransition("needs_review", "finalized")).not.toThrow();
    expect(() => assertLegalItemTransition("finalized", "released")).not.toThrow();
    expect(() => assertLegalItemTransition("finalized", "needs_review")).not.toThrow(); // design invalidation
    expect(() => assertLegalItemTransition("finalized", "awaiting_cad")).not.toThrow(); // re-upload
    expect(() => assertLegalItemTransition("cad_failed", "awaiting_cad")).not.toThrow(); // retry upload
  });

  it("forbids illegal item transitions", () => {
    expect(() => assertLegalItemTransition("awaiting_cad", "finalized")).toThrow(
      PathAItemTransitionError,
    );
    expect(() => assertLegalItemTransition("awaiting_cad", "released")).toThrow(
      PathAItemTransitionError,
    );
    expect(() => assertLegalItemTransition("needs_review", "released")).toThrow(
      PathAItemTransitionError,
    );
    expect(() => assertLegalItemTransition("released", "awaiting_cad")).toThrow(
      PathAItemTransitionError,
    );
  });
});

describe("deriveSagaTarget", () => {
  it("returns PENDING / designing when 0 items exist", () => {
    expect(deriveSagaTarget([])).toEqual({
      status: "PENDING",
      step: "designing",
    });
  });

  it("returns PENDING / cad_dispatched when any item is awaiting_cad", () => {
    expect(
      deriveSagaTarget([
        { design_status: "awaiting_cad" },
        { design_status: "finalized" },
      ]),
    ).toEqual({
      status: "PENDING",
      step: "cad_dispatched",
    });
  });

  it("returns PENDING / awaiting_design_review when any item is needs_review", () => {
    expect(
      deriveSagaTarget([
        { design_status: "needs_review" },
        { design_status: "finalized" },
      ]),
    ).toEqual({
      status: "PENDING",
      step: "awaiting_design_review",
    });
  });

  it("returns PENDING / cad_failed when any item is cad_failed", () => {
    expect(
      deriveSagaTarget([
        { design_status: "cad_failed" },
        { design_status: "finalized" },
      ]),
    ).toEqual({
      status: "PENDING",
      step: "cad_failed",
    });
  });

  it("advances to AWAITING_DEPOSIT only when ALL items are finalized or released", () => {
    // 1 item finalized
    expect(deriveSagaTarget([{ design_status: "finalized" }])).toEqual({
      status: "AWAITING_DEPOSIT",
      step: "awaiting_deposit_or_override",
    });

    // 3 items finalized
    expect(
      deriveSagaTarget([
        { design_status: "finalized" },
        { design_status: "finalized" },
        { design_status: "finalized" },
      ]),
    ).toEqual({
      status: "AWAITING_DEPOSIT",
      step: "awaiting_deposit_or_override",
    });

    // Mixed finalized and released
    expect(
      deriveSagaTarget([
        { design_status: "finalized" },
        { design_status: "released" },
      ]),
    ).toEqual({
      status: "AWAITING_DEPOSIT",
      step: "awaiting_deposit_or_override",
    });
  });

  it("preserves status when saga is already IN_PROGRESS or COMPLETED", () => {
    expect(
      deriveSagaTarget([{ design_status: "finalized" }], {
        status: "IN_PROGRESS",
        current_step: "releasing",
      }),
    ).toEqual({
      status: "IN_PROGRESS",
      step: "releasing",
    });

    expect(
      deriveSagaTarget([{ design_status: "released" }], {
        status: "COMPLETED",
        current_step: "released_to_production",
      }),
    ).toEqual({
      status: "COMPLETED",
      step: "released_to_production",
    });
  });
});

describe("describePathASaga", () => {
  const baseTime = new Date("2026-10-13T12:00:00Z");
  const tenDaysAgo = new Date("2026-10-03T12:00:00Z");

  it("calculates ageDays correctly without deadline or countdown", () => {
    const vm = describePathASaga(
      {
        status: "AWAITING_DEPOSIT",
        current_step: "awaiting_deposit_or_override",
        created_at: tenDaysAgo,
        updated_at: tenDaysAgo,
      },
      [],
      baseTime,
    );

    expect(vm.ageDays).toBe(10);
    expect((vm as any).deadline).toBeUndefined();
    expect((vm as any).expiresAt).toBeUndefined();
    expect((vm as any).countdown).toBeUndefined();
    expect(vm.canOverride).toBe(true);
    expect(vm.canRetryRelease).toBe(false);
    expect(vm.tone).toBe("amber");
  });

  it("canOverride is true only for AWAITING_DEPOSIT without release_requested_at", () => {
    // Unrequested AWAITING_DEPOSIT
    const unreq = describePathASaga(
      {
        status: "AWAITING_DEPOSIT",
        created_at: tenDaysAgo,
        updated_at: tenDaysAgo,
      },
      [],
      baseTime,
    );
    expect(unreq.canOverride).toBe(true);

    // Requested AWAITING_DEPOSIT
    const req = describePathASaga(
      {
        status: "AWAITING_DEPOSIT",
        release_requested_at: new Date(),
        release_source: "management_override",
        release_requested_by: "manager@ccpatio.com",
        created_at: tenDaysAgo,
        updated_at: tenDaysAgo,
      },
      [],
      baseTime,
    );
    expect(req.canOverride).toBe(false);
    expect(req.lockedReason).toContain("manager@ccpatio.com");

    // PENDING state
    const pending = describePathASaga(
      {
        status: "PENDING",
        created_at: tenDaysAgo,
        updated_at: tenDaysAgo,
      },
      [],
      baseTime,
    );
    expect(pending.canOverride).toBe(false);
  });

  it("canRetryRelease is true for manual failure with recorded request", () => {
    const failedWithReq = describePathASaga(
      {
        status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        release_requested_at: new Date(),
        last_error: "Katana 500 error",
        created_at: tenDaysAgo,
        updated_at: tenDaysAgo,
      },
      [],
      baseTime,
    );
    expect(failedWithReq.canRetryRelease).toBe(true);
    expect(failedWithReq.tone).toBe("rose");
    expect(failedWithReq.lockedReason).toBe("Katana 500 error");
  });
});
