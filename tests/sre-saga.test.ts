import { describe, expect, it } from "vitest";
import {
  assertNeverDeletePaid,
  planCompensation,
  PaidSagaDeleteError,
  isDeleteAction,
  type CompensationInput,
  type SagaFailedLeg,
} from "@/server/sre/saga";

const legs: SagaFailedLeg[] = ["ledger", "sales_order", "manufacturing_orders", "other"];

describe("planCompensation", () => {
  it("failed ledger leg: retry_ledger, never a rollback (paid or unpaid)", () => {
    for (const paid of [true, false]) {
      const plan = planCompensation({
        paid,
        failedLeg: "ledger",
        createdSoId: 7,
        createdMoIds: [1, 2],
      });
      expect(plan.actions).toEqual([{ action: "retry_ledger" }]);
      expect(plan.actions.some(isDeleteAction)).toBe(false);
    }
  });

  it("paid + any other failure: no deletes, manual intervention", () => {
    for (const failedLeg of legs.filter((l) => l !== "ledger")) {
      const plan = planCompensation({
        paid: true,
        failedLeg,
        createdSoId: 7,
        createdMoIds: [1, 2, 3],
      });
      expect(plan.actions).toEqual([]);
      expect(plan.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
    }
  });

  it("unpaid: deletes MOs first in REVERSE creation order, then the SO", () => {
    const plan = planCompensation({
      paid: false,
      failedLeg: "manufacturing_orders",
      createdSoId: "so-9",
      createdMoIds: ["mo-1", "mo-2", "mo-3"],
    });
    expect(plan.actions).toEqual([
      { action: "delete_mo", moId: "mo-3" },
      { action: "delete_mo", moId: "mo-2" },
      { action: "delete_mo", moId: "mo-1" },
      { action: "delete_so", soId: "so-9" },
    ]);
    expect(plan.status).toBe("COMPENSATING");
  });

  it("unpaid: SO is last even when there are no MOs", () => {
    const plan = planCompensation({
      paid: false,
      failedLeg: "other",
      createdSoId: 5,
      createdMoIds: [],
    });
    expect(plan.actions).toEqual([{ action: "delete_so", soId: 5 }]);
  });

  it("unpaid with nothing created: empty plan, already compensated", () => {
    const plan = planCompensation({ paid: false, failedLeg: "sales_order", createdMoIds: [] });
    expect(plan).toEqual({ actions: [], status: "COMPENSATED" });
  });

  it("does not mutate its input", () => {
    const moIds = [1, 2, 3];
    planCompensation({ paid: false, failedLeg: "other", createdSoId: 1, createdMoIds: moIds });
    expect(moIds).toEqual([1, 2, 3]);
  });

  it("fails safe: a non-boolean paid flag is treated as paid", () => {
    const plan = planCompensation({
      paid: undefined as unknown as boolean,
      failedLeg: "other",
      createdSoId: 1,
      createdMoIds: [1],
    });
    expect(plan.actions).toEqual([]);
    expect(plan.status).toBe("SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION");
  });
});

describe("property: a paid saga never yields a delete", () => {
  it("holds for every leg and a spread of created-document shapes", () => {
    const moShapes: Array<Array<string | number>> = [[], [1], [1, 2, 3], Array.from({ length: 40 }, (_, i) => i)];
    const soShapes: Array<CompensationInput["createdSoId"]> = [undefined, null, "", 0, 1, "so-1"];
    for (const failedLeg of legs) {
      for (const createdMoIds of moShapes) {
        for (const createdSoId of soShapes) {
          const plan = planCompensation({ paid: true, failedLeg, createdSoId, createdMoIds });
          expect(plan.actions.some(isDeleteAction)).toBe(false);
        }
      }
    }
  });
});

describe("assertNeverDeletePaid", () => {
  it("throws when a paid plan contains a delete", () => {
    expect(() =>
      assertNeverDeletePaid(true, {
        actions: [{ action: "delete_so", soId: 1 }],
        status: "COMPENSATING",
      }),
    ).toThrow(PaidSagaDeleteError);
    expect(() =>
      assertNeverDeletePaid(true, {
        actions: [{ action: "retry_ledger" }, { action: "delete_mo", moId: 1 }],
        status: "COMPENSATING",
      }),
    ).toThrow(/never rolled back/);
  });

  it("allows deletes for unpaid sagas and non-delete plans for paid sagas", () => {
    expect(() =>
      assertNeverDeletePaid(false, {
        actions: [{ action: "delete_so", soId: 1 }],
        status: "COMPENSATING",
      }),
    ).not.toThrow();
    expect(() =>
      assertNeverDeletePaid(true, { actions: [{ action: "retry_ledger" }], status: "IN_PROGRESS" }),
    ).not.toThrow();
  });
});
