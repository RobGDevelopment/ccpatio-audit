/**
 * Phase 15b — Factory Airlock event hand-off & completion marker.
 *
 * `factory-airlock-release` validates an approved build, checks OD-1 job readiness,
 * records the release request in a single transaction, and hands off via `step.sendEvent`
 * to the single custom-build writer (`path-a/release-to-production`).
 * `factory-airlock-mark-pushed` transitions `approved -> pushed` on `path-a/release.completed`.
 *
 * Zero direct ERP calls; gated by `GHL_FACTORY_ORDERS` (`canPushGhlFactoryOrders`).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { logStructured } from "@/lib/log/structured";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  factory_airlock_builds,
  pim_audit_log,
} from "@/server/db/schema";
import {
  decideAirlockRelease,
  loadJobAirlockState,
} from "@/server/path-a/airlock-release";
import {
  buildPathAReleaseEventData,
  PATH_A_RELEASE_COMPLETED_EVENT,
  PATH_A_RELEASE_TO_PRODUCTION_EVENT,
  pathAReleaseEventId,
} from "@/server/path-a/events";
import {
  createReleaseStore,
  type PathATx,
  type ReleaseDb,
  type ReleaseStore,
} from "@/server/path-a/release-store";
import { canPushGhlFactoryOrders } from "@/server/pipeline/ghl-factory-mode";
import { IDEMPOTENCY_BY_EVENT_ID } from "@/server/sre/idempotency";

export const FACTORY_AIRLOCK_APPROVED_EVENT = "factory/airlock.approved" as const;

export const factoryAirlockApprovedSchema = z.object({
  buildId: z.string().uuid(),
  jobItemId: z.string().uuid(),
  rootSku: z.string().trim().min(1),
  ghlOpportunityId: z.string().trim().min(1),
  dossierHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  approvedBy: z.string().trim().min(1),
  version: z.number().int().positive(),
});

export type FactoryAirlockApprovedPayload = z.infer<typeof factoryAirlockApprovedSchema>;

export type FactoryAirlockStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  sendEvent: (
    id: string,
    payload: { id?: string; name: string; data: Record<string, unknown> },
  ) => Promise<unknown>;
};

export type FactoryAirlockReleaseDeps = {
  db?: ReleaseDb;
  canPush?: () => boolean;
  createStore?: (resolveDb: () => ReleaseDb) => ReleaseStore;
};

type RecordReleaseTxOutcome =
  | { kind: "recorded" }
  | {
      kind: "skipped";
      skipped: "saga_COMPLETED" | "saga_IN_PROGRESS" | "release_already_requested";
    };

export async function runFactoryAirlockRelease(
  input: {
    event: { data?: unknown };
    step: FactoryAirlockStepLike;
  },
  deps: FactoryAirlockReleaseDeps = {},
) {
  const parsed = factoryAirlockApprovedSchema.safeParse(input.event.data);
  if (!parsed.success) {
    throw new NonRetriableError(
      `Invalid factory/airlock.approved payload: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const data = parsed.data;
  const db = deps.db ?? getDb();
  const canPush = deps.canPush ?? canPushGhlFactoryOrders;
  const buildStore = deps.createStore ?? createReleaseStore;

  const reread = await input.step.run("reread-approved-build", async () => {
    const [build] = await db
      .select({
        status: factory_airlock_builds.status,
        dossierHash: factory_airlock_builds.dossier_hash,
        approvedBy: factory_airlock_builds.approved_by,
        version: factory_airlock_builds.version,
      })
      .from(factory_airlock_builds)
      .where(eq(factory_airlock_builds.id, data.buildId))
      .limit(1);

    const hashMatches =
      (build?.dossierHash ?? "").toLowerCase() === data.dossierHash.toLowerCase();
    if (
      !build ||
      build.status !== "approved" ||
      !hashMatches ||
      build.approvedBy !== data.approvedBy
    ) {
      return { ok: false as const, reason: "not_approved" as const };
    }

    return { ok: true as const, version: build.version };
  });

  if (!reread.ok) {
    return reread;
  }

  if (!canPush()) {
    return {
      ok: true as const,
      dryRun: true as const,
      reason: "ghl_factory_orders_log" as const,
    };
  }

  const decisionStep = await input.step.run("decide-release", async () => {
    const [itemJob] = await db
      .select({
        jobId: custom_build_jobs.id,
        opportunityId: custom_build_jobs.ghl_opportunity_id,
      })
      .from(custom_build_job_items)
      .innerJoin(
        custom_build_jobs,
        eq(custom_build_job_items.job_id, custom_build_jobs.id),
      )
      .where(eq(custom_build_job_items.id, data.jobItemId))
      .limit(1);

    if (!itemJob) {
      throw new NonRetriableError(
        `No custom_build_jobs row found for jobItemId ${data.jobItemId}`,
      );
    }

    const oppId = (itemJob.opportunityId?.trim() || data.ghlOpportunityId).trim();
    if (
      itemJob.opportunityId?.trim() &&
      itemJob.opportunityId.trim() !== data.ghlOpportunityId
    ) {
      throw new NonRetriableError(
        `Opportunity mismatch for job ${itemJob.jobId}: event=${data.ghlOpportunityId} db=${itemJob.opportunityId}`,
      );
    }

    const state = await loadJobAirlockState(itemJob.jobId, db);
    const decision = decideAirlockRelease(state);
    return {
      jobId: itemJob.jobId,
      oppId,
      decision,
    };
  });

  if (decisionStep.decision.kind === "waiting") {
    return {
      ok: true as const,
      waiting: true as const,
      unapprovedItemIds: decisionStep.decision.unapprovedItemIds,
    };
  }

  if (decisionStep.decision.kind === "already_pushed") {
    return {
      ok: true as const,
      alreadyPushed: true as const,
    };
  }

  const oppId = decisionStep.oppId;
  const jobId = decisionStep.jobId;
  const releaseReason = `factory airlock approved ${data.buildId}`;

  const recordOutcome = await input.step.run(
    "record-release-request",
    async (): Promise<RecordReleaseTxOutcome> => {
      return db.transaction(async (tx: PathATx) => {
        const txStore = buildStore(() => tx);
        const existingSaga = await txStore.getSaga(oppId);
        if (!existingSaga) {
          throw new NonRetriableError(
            `No path_a_cad saga row found for opportunity ${oppId}`,
          );
        }
        if (existingSaga.status === "COMPLETED") {
          return { kind: "skipped", skipped: "saga_COMPLETED" };
        }
        if (existingSaga.status === "IN_PROGRESS") {
          return { kind: "skipped", skipped: "saga_IN_PROGRESS" };
        }

        const req = await txStore.requestRelease({
          oppId,
          source: "factory_airlock",
          requestedBy: data.approvedBy,
          reason: releaseReason,
        });

        if (req.outcome === "no_saga") {
          throw new NonRetriableError(
            `No path_a_cad saga row found for opportunity ${oppId}`,
          );
        }

        if (req.outcome === "already_requested" && !req.sameSource) {
          logStructured("warn", "factory-airlock-release-already-requested", {
            oppId,
            jobId,
            buildId: data.buildId,
            existingSource: req.source,
          });
          return { kind: "skipped", skipped: "release_already_requested" };
        }

        await tx.insert(pim_audit_log).values({
          operator_email: data.approvedBy,
          action: "factory_airlock_release",
          global_sku: data.rootSku,
          new_value: releaseReason,
        });

        return { kind: "recorded" };
      });
    },
  );

  if (recordOutcome.kind === "skipped") {
    return {
      ok: true as const,
      skipped: recordOutcome.skipped,
    };
  }

  const attempt = await input.step.run("bump-attempt", () =>
    buildStore(() => db).bumpReleaseAttempt(oppId),
  );

  const eventId =
    attempt === 1
      ? pathAReleaseEventId(oppId, { airlock: jobId })
      : pathAReleaseEventId(oppId, { retry: attempt });

  await input.step.sendEvent("request-path-a-release", {
    id: eventId,
    name: PATH_A_RELEASE_TO_PRODUCTION_EVENT,
    data: buildPathAReleaseEventData({
      ghlOpportunityId: oppId,
      source: "factory_airlock",
      requestedBy: data.approvedBy,
      reason: releaseReason,
      attempt,
    }),
  });

  return {
    ok: true as const,
    released: true as const,
    ghlOpportunityId: oppId,
    jobId,
    attempt,
    eventId,
  };
}

export const factoryAirlockRelease = inngest.createFunction(
  {
    id: "factory-airlock-release",
    name: "Factory Airlock Approved",
    triggers: [{ event: FACTORY_AIRLOCK_APPROVED_EVENT }],
    idempotency: IDEMPOTENCY_BY_EVENT_ID,
  },
  async ({ event, step }) =>
    runFactoryAirlockRelease({
      event,
      step: step as unknown as FactoryAirlockStepLike,
    }),
);

export type MarkPushedStepLike = {
  run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
};

export async function runFactoryAirlockMarkPushed(
  input: {
    event: { data?: Record<string, unknown> | null };
    step: MarkPushedStepLike;
  },
  deps: { db?: ReleaseDb } = {},
) {
  const rawOppId =
    input.event.data?.ghlOpportunityId ?? input.event.data?.opportunityId ?? "";
  const oppId = String(rawOppId).trim();
  if (!oppId) {
    throw new NonRetriableError(
      "path-a/release.completed requires ghlOpportunityId",
    );
  }

  const db = deps.db ?? getDb();

  return input.step.run("mark-airlock-builds-pushed", async () => {
    const updated = await db
      .update(factory_airlock_builds)
      .set({
        status: "pushed",
        version: sql`${factory_airlock_builds.version} + 1`,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(factory_airlock_builds.status, "approved"),
          inArray(
            factory_airlock_builds.job_item_id,
            db
              .select({ id: custom_build_job_items.id })
              .from(custom_build_job_items)
              .innerJoin(
                custom_build_jobs,
                eq(custom_build_job_items.job_id, custom_build_jobs.id),
              )
              .where(eq(custom_build_jobs.ghl_opportunity_id, oppId)),
          ),
        ),
      )
      .returning({ id: factory_airlock_builds.id });

    return {
      ok: true as const,
      ghlOpportunityId: oppId,
      pushedCount: updated.length,
      pushedBuildIds: updated.map((row) => row.id),
    };
  });
}

export const factoryAirlockMarkPushed = inngest.createFunction(
  {
    id: "factory-airlock-mark-pushed",
    name: "Factory Airlock Mark Pushed",
    triggers: [{ event: PATH_A_RELEASE_COMPLETED_EVENT }],
    concurrency: {
      limit: 1,
      key: "event.data.ghlOpportunityId",
    },
  },
  async ({ event, step }) =>
    runFactoryAirlockMarkPushed({
      event: { data: (event.data ?? null) as Record<string, unknown> | null },
      step: step as unknown as MarkPushedStepLike,
    }),
);
