/**
 * Airlock approval scaffold.
 * The designer never emits this event. approveAirlockAction emits it only after
 * a compare-and-swap from pending_manager to approved returns a row.
 * This function re-reads that row and stops. It does not call Katana.
 * The Katana sales order and manufacturing order stay on the existing Path A
 * writer and are wired in a later change, still gated by GHL_FACTORY_ORDERS=live.
 */
import { eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { getDb } from "@/server/db/client";
import { factory_airlock_builds } from "@/server/db/schema";
import { canPushGhlFactoryOrders } from "@/server/pipeline/ghl-factory-mode";
import { IDEMPOTENCY_BY_EVENT_ID } from "@/server/sre/idempotency";

export const FACTORY_AIRLOCK_APPROVED_EVENT = "factory/airlock.approved" as const;

const factoryAirlockApprovedSchema = z.object({
  buildId: z.string().uuid(),
  jobItemId: z.string().uuid(),
  rootSku: z.string().trim().min(1),
  ghlOpportunityId: z.string().trim().min(1),
  dossierHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
  approvedBy: z.string().trim().min(1),
  version: z.number().int().positive(),
});

export const factoryAirlockRelease = inngest.createFunction(
  {
    id: "factory-airlock-release",
    name: "Factory Airlock Approved",
    triggers: [{ event: FACTORY_AIRLOCK_APPROVED_EVENT }],
    idempotency: IDEMPOTENCY_BY_EVENT_ID,
  },
  async ({ event, step }) => {
    const parsed = factoryAirlockApprovedSchema.safeParse(event.data);
    if (!parsed.success) {
      throw new NonRetriableError(
        `Invalid factory/airlock.approved payload: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    const data = parsed.data;

    return step.run("reread-approved-build", async () => {
      const db = getDb();
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

      if (!canPushGhlFactoryOrders()) {
        return { ok: true as const, dryRun: true as const, reason: "ghl_factory_orders_log" as const };
      }

      return {
        ok: true as const,
        deferred: true as const,
        reason: "katana_push_not_wired" as const,
        ghlOpportunityId: data.ghlOpportunityId,
        rootSku: data.rootSku,
        version: build.version,
      };
    });
  },
);
