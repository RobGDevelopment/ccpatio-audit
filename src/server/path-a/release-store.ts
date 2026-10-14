/**
 * Phase 11 Path A Release Store: saga status transitions and release request management.
 * Strictly adheres to first-writer-wins, zero wait compute, and fail-closed idempotency.
 * No session-level advisory locks (transaction pooler compatible).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  saga_runs,
} from "@/server/db/schema";
import { scrubSagaError, type SagaRunRow } from "@/server/sre/saga-store";
import type { SagaStatusValue } from "@/server/sre/saga";
import {
  assertLegalSagaTransition,
  deriveSagaTarget,
  PATH_A_SAGA_TYPE,
} from "./saga-state";
import type { PathAReleaseSource } from "./events";

export class SagaDesignLockedError extends Error {
  constructor(
    readonly oppId: string,
    readonly status: string,
  ) {
    super(
      `advanceSaga aborted: saga ${oppId} is in status "${status}" (design locked / past pause)`,
    );
    this.name = "SagaDesignLockedError";
  }
}

export type ReleaseRequestResult =
  | { outcome: "recorded" }
  | {
      outcome: "already_requested";
      sameSource: boolean;
      requestedBy: string | null;
      source: string | null;
    }
  | { outcome: "no_saga" };

export type ClaimReleaseResult =
  | { outcome: "claimed" }
  | { outcome: "resumed" }
  | { outcome: "already_completed" }
  | { outcome: "not_ready" }
  | { outcome: "no_request" }
  | { outcome: "no_saga" };

export type ReleaseStore = {
  getSaga(oppId: string): Promise<SagaRunRow | null>;
  advanceSaga(oppId: string): Promise<{
    moved: boolean;
    status: SagaStatusValue;
    step: string;
    releaseRequestedAt?: Date | null;
  }>;
  revertToDesigning(oppId: string, step?: string): Promise<{ reverted: boolean }>;
  requestRelease(input: {
    oppId: string;
    source: PathAReleaseSource;
    requestedBy: string;
    reason?: string | null;
    depositCents?: number | null;
    depositRef?: string | null;
  }): Promise<ReleaseRequestResult>;
  bumpReleaseAttempt(oppId: string): Promise<number>;
  claimRelease(oppId: string): Promise<ClaimReleaseResult>;
  markSagaCompleted(oppId: string): Promise<{ completed: boolean }>;
  markSagaManual(oppId: string, leg: string, error: unknown): Promise<void>;
};

export type PathATx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export type ReleaseDb = ReturnType<typeof getDb> | PathATx;

export function createReleaseStore(resolveDb: () => ReleaseDb = getDb): ReleaseStore {
  async function getSaga(oppId: string): Promise<SagaRunRow | null> {
    const db = resolveDb();
    const [row] = await db
      .select()
      .from(saga_runs)
      .where(
        and(
          eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
          eq(saga_runs.correlation_key, oppId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  return {
    getSaga,

    async advanceSaga(oppId) {
      const db = resolveDb();

      // Run inside a transaction with row lock
      return db.transaction(async (tx: PathATx) => {
        // Lock the saga row
        const [lockedSaga] = await tx
          .select()
          .from(saga_runs)
          .where(
            and(
              eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
              eq(saga_runs.correlation_key, oppId),
            ),
          )
          .for("update");

        if (!lockedSaga) {
          throw new Error(`advanceSaga: no saga row found for opportunity ${oppId}`);
        }

        // Abort if the saga is locked or already past the pause (AWAITING_DEPOSIT)
        if (
          lockedSaga.status === "IN_PROGRESS" ||
          lockedSaga.status === "COMPLETED" ||
          lockedSaga.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"
        ) {
          throw new SagaDesignLockedError(oppId, lockedSaga.status);
        }

        // Find the custom build job
        const [job] = await tx
          .select({ id: custom_build_jobs.id })
          .from(custom_build_jobs)
          .where(eq(custom_build_jobs.ghl_opportunity_id, oppId))
          .limit(1);

        const items = job
          ? await tx
              .select()
              .from(custom_build_job_items)
              .where(eq(custom_build_job_items.job_id, job.id))
          : [];

        const target = deriveSagaTarget(items, lockedSaga);

        if (target.status !== lockedSaga.status || target.step !== lockedSaga.current_step) {
          assertLegalSagaTransition(lockedSaga.status as SagaStatusValue, target.status);

          const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
            status: target.status,
            current_step: target.step,
            updated_at: new Date(),
          };

          const [updated] = await tx
            .update(saga_runs)
            .set(updatePayload)
            .where(
              and(
                eq(saga_runs.id, lockedSaga.id),
                eq(saga_runs.status, lockedSaga.status),
              ),
            )
            .returning();

          if (updated) {
            return {
              moved: true,
              status: target.status,
              step: target.step,
              releaseRequestedAt: updated.release_requested_at,
            };
          }
        }

        return {
          moved: false,
          status: lockedSaga.status as SagaStatusValue,
          step: lockedSaga.current_step ?? target.step,
          releaseRequestedAt: lockedSaga.release_requested_at,
        };
      });
    },

    async revertToDesigning(oppId, step = "design_changed") {
      const db = resolveDb();
      const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
        status: "PENDING",
        current_step: step,
        updated_at: new Date(),
      };
      const [updated] = await db
        .update(saga_runs)
        .set(updatePayload)
        .where(
          and(
            eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
            eq(saga_runs.correlation_key, oppId),
            eq(saga_runs.status, "AWAITING_DEPOSIT"),
          ),
        )
        .returning({ id: saga_runs.id });

      return { reverted: Boolean(updated) };
    },

    async requestRelease(input) {
      const db = resolveDb();
      const now = new Date();

      // Check existence first
      const existing = await getSaga(input.oppId);
      if (!existing) {
        return { outcome: "no_saga" };
      }

      // If deposit is being recorded, ensure money fields are recorded regardless of request race (COALESCE)
      if (input.source === "customer_deposit" && input.depositCents != null) {
        await db
          .update(saga_runs)
          .set({
            deposit_cents: sql`COALESCE(${saga_runs.deposit_cents}, ${input.depositCents})`,
            deposit_ref: sql`COALESCE(${saga_runs.deposit_ref}, ${input.depositRef ?? null})`,
            deposit_recorded_at: sql`COALESCE(${saga_runs.deposit_recorded_at}, ${now})`,
            paid_at: sql`COALESCE(${saga_runs.paid_at}, ${now})`,
            updated_at: now,
          })
          .where(
            and(
              eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
              eq(saga_runs.correlation_key, input.oppId),
            ),
          );
      }

      // First-writer-wins attempt on release_requested_*
      const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
        release_requested_at: now,
        release_source: input.source,
        release_requested_by: input.requestedBy,
        release_reason: input.reason ?? null,
        updated_at: now,
      };

      if (input.source === "customer_deposit" && input.depositCents != null) {
        updatePayload.deposit_cents = input.depositCents;
        updatePayload.deposit_ref = input.depositRef ?? null;
        updatePayload.deposit_recorded_at = now;
        updatePayload.paid_at = now;
      }

      const [won] = await db
        .update(saga_runs)
        .set(updatePayload)
        .where(
          and(
            eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
            eq(saga_runs.correlation_key, input.oppId),
            sql`${saga_runs.release_requested_at} IS NULL`,
          ),
        )
        .returning();

      if (won) {
        return { outcome: "recorded" };
      }

      // Read current state to return accurate outcome
      const current = await getSaga(input.oppId);
      return {
        outcome: "already_requested",
        sameSource: current?.release_source === input.source,
        requestedBy: current?.release_requested_by ?? null,
        source: current?.release_source ?? null,
      };
    },

    async bumpReleaseAttempt(oppId) {
      const db = resolveDb();
      const [updated] = await db
        .update(saga_runs)
        .set({
          release_attempts: sql`COALESCE(${saga_runs.release_attempts}, 0) + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
            eq(saga_runs.correlation_key, oppId),
          ),
        )
        .returning({ attempts: saga_runs.release_attempts });

      return updated?.attempts ?? 1;
    },

    async claimRelease(oppId) {
      const db = resolveDb();
      const current = await getSaga(oppId);
      if (!current) return { outcome: "no_saga" };
      if (!current.release_requested_at) return { outcome: "no_request" };
      if (current.status === "COMPLETED") return { outcome: "already_completed" };
      if (current.status === "PENDING") return { outcome: "not_ready" };
      if (current.status === "IN_PROGRESS") return { outcome: "resumed" };

      if (current.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION") {
        const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
          status: "IN_PROGRESS",
          current_step: "releasing",
          updated_at: new Date(),
        };
        const [resumed] = await db
          .update(saga_runs)
          .set(updatePayload)
          .where(
            and(
              eq(saga_runs.id, current.id),
              eq(saga_runs.status, "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"),
            ),
          )
          .returning();
        return resumed ? { outcome: "resumed" } : { outcome: "not_ready" };
      }

      if (current.status === "AWAITING_DEPOSIT") {
        const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
          status: "IN_PROGRESS",
          current_step: "releasing",
          updated_at: new Date(),
        };
        const [claimed] = await db
          .update(saga_runs)
          .set(updatePayload)
          .where(
            and(
              eq(saga_runs.id, current.id),
              eq(saga_runs.status, "AWAITING_DEPOSIT"),
              sql`${saga_runs.release_requested_at} IS NOT NULL`,
            ),
          )
          .returning();

        // A lost CAS means another run already moved the saga out of AWAITING_DEPOSIT:
        // that run owns the release, so this one must not proceed (single winner).
        return claimed ? { outcome: "claimed" } : { outcome: "not_ready" };
      }

      return { outcome: "not_ready" };
    },

    async markSagaCompleted(oppId) {
      const db = resolveDb();
      const now = new Date();
      const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
        status: "COMPLETED",
        current_step: "released_to_production",
        released_at: now,
        updated_at: now,
      };
      const [updated] = await db
        .update(saga_runs)
        .set(updatePayload)
        .where(
          and(
            eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
            eq(saga_runs.correlation_key, oppId),
            eq(saga_runs.status, "IN_PROGRESS"),
          ),
        )
        .returning({ id: saga_runs.id });

      return { completed: Boolean(updated) };
    },

    async markSagaManual(oppId, leg, error) {
      const db = resolveDb();
      const scrubbed = scrubSagaError(error);
      const updatePayload: Partial<typeof saga_runs.$inferInsert> = {
        status: "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION",
        current_step: `release_failed:${leg}`,
        last_error: scrubbed,
        updated_at: new Date(),
      };
      await db
        .update(saga_runs)
        .set(updatePayload)
        .where(
          and(
            eq(saga_runs.saga_type, PATH_A_SAGA_TYPE),
            eq(saga_runs.correlation_key, oppId),
            ne(saga_runs.status, "COMPLETED"),
          ),
        );
    },
  };
}
