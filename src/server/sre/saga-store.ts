/**
 * Phase 10 Task 7 — saga status ledger access (`saga_runs`).
 *
 * A STATUS ledger only (no poller, no claim/lease columns). The pure compensation rules
 * stay in `saga.ts`; this module is just insert-once + status/step writes over `getDb()`.
 * No session-level advisory locks (transaction pooler, `prepare: false`).
 */
import { and, eq } from "drizzle-orm";
import { scrubSecretText } from "@/inngest/dlq";
import { getDb } from "@/server/db/client";
import { saga_runs } from "@/server/db/schema";
import type { SagaStatusValue } from "@/server/sre/saga";

export type SagaRunRow = typeof saga_runs.$inferSelect;

export const SAGA_LAST_ERROR_MAX_CHARS = 2000;

export type SagaInsertInput = {
  sagaType: string;
  correlationKey: string;
  paidAt?: Date | null;
  status?: SagaStatusValue;
  currentStep?: string | null;
};

export type SagaStore = {
  /** INSERT ... ON CONFLICT (saga_type, correlation_key) DO NOTHING, then read the row back. */
  insertOnce(input: SagaInsertInput): Promise<{ row: SagaRunRow; inserted: boolean }>;
  get(sagaType: string, correlationKey: string): Promise<SagaRunRow | null>;
  setStep(sagaType: string, correlationKey: string, currentStep: string): Promise<void>;
  setStatus(
    sagaType: string,
    correlationKey: string,
    status: SagaStatusValue,
    extra?: { currentStep?: string; lastError?: string | null },
  ): Promise<void>;
  /** Records a scrubbed `last_error` and the given status (default: manual intervention). */
  fail(
    sagaType: string,
    correlationKey: string,
    error: unknown,
    status?: SagaStatusValue,
  ): Promise<void>;
};

type SagaDb = Pick<ReturnType<typeof getDb>, "insert" | "select" | "update">;

/** Never persist secrets or a novel-length message. */
export function scrubSagaError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return scrubSecretText(raw).slice(0, SAGA_LAST_ERROR_MAX_CHARS);
}

function where(sagaType: string, correlationKey: string) {
  return and(eq(saga_runs.saga_type, sagaType), eq(saga_runs.correlation_key, correlationKey));
}

export function createSagaStore(resolveDb: () => SagaDb = getDb): SagaStore {
  async function get(sagaType: string, correlationKey: string): Promise<SagaRunRow | null> {
    const [row] = await resolveDb()
      .select()
      .from(saga_runs)
      .where(where(sagaType, correlationKey))
      .limit(1);
    return row ?? null;
  }

  return {
    get,

    async insertOnce(input) {
      const db = resolveDb();
      const inserted = await db
        .insert(saga_runs)
        .values({
          saga_type: input.sagaType,
          correlation_key: input.correlationKey,
          status: input.status ?? "IN_PROGRESS",
          current_step: input.currentStep ?? null,
          paid_at: input.paidAt ?? null,
        })
        .onConflictDoNothing({ target: [saga_runs.saga_type, saga_runs.correlation_key] })
        .returning();
      if (inserted[0]) return { row: inserted[0], inserted: true };

      // Lost the race (or a redelivery): the unique index decided, the row is already there.
      const existing = await get(input.sagaType, input.correlationKey);
      if (!existing) {
        throw new Error(
          `saga_runs insert-once found no row for (${input.sagaType}, ${input.correlationKey}) after a conflict.`,
        );
      }
      return { row: existing, inserted: false };
    },

    async setStep(sagaType, correlationKey, currentStep) {
      await resolveDb()
        .update(saga_runs)
        .set({ current_step: currentStep, updated_at: new Date() })
        .where(where(sagaType, correlationKey));
    },

    async setStatus(sagaType, correlationKey, status, extra = {}) {
      await resolveDb()
        .update(saga_runs)
        .set({
          status,
          ...(extra.currentStep !== undefined ? { current_step: extra.currentStep } : {}),
          ...(extra.lastError !== undefined ? { last_error: extra.lastError } : {}),
          updated_at: new Date(),
        })
        .where(where(sagaType, correlationKey));
    },

    async fail(sagaType, correlationKey, error, status = "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION") {
      await resolveDb()
        .update(saga_runs)
        .set({ status, last_error: scrubSagaError(error), updated_at: new Date() })
        .where(where(sagaType, correlationKey));
    },
  };
}

/** Default store over the shared `getDb()` client (lazy: nothing connects at import). */
export const sagaStore: SagaStore = createSagaStore();
