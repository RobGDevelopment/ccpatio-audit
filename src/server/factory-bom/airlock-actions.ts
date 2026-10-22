"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
  factory_airlock_builds,
  factory_airlock_decisions,
  sku_mappings,
  user_roles,
} from "@/server/db/schema";
import { getPimSession, isEmbedPrincipal } from "@/lib/pim-audit";
import { createClient } from "@/utils/supabase/server";
import { inngest } from "@/inngest/client";
import { inngestEventId } from "@/server/sre/idempotency";
import { FACTORY_AIRLOCK_APPROVED_EVENT } from "@/inngest/factory-airlock";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import { loadAirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";

const MANAGER_ROLES = ["Ops_Manager", "SuperAdmin"] as const;
type ManagerRole = (typeof MANAGER_ROLES)[number];

export type AirlockActionResult =
  | { ok: true; status: "pending_manager" | "draft" | "approved" }
  | {
      ok: false;
      error: string;
      status?: string;
      blockingCodes?: string[];
    };

export type PendingAirlockBuild = {
  id: string;
  rootSku: string;
  version: number;
  submittedBy: string | null;
  submittedAt: string | null;
  displayName: string;
  opportunityId: string | null;
};

type ManagerSession =
  | { ok: true; email: string; role: ManagerRole }
  | { ok: false; error: "not_authorized" };

function postgresCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function isAirlockSchemaMissing(error: unknown): boolean {
  const code = postgresCode(error);
  return code === "42P01" || code === "42704";
}

function revalidateAirlock() {
  revalidatePath("/admin/factory-airlock");
  revalidatePath("/embed/factory-bom");
}

async function requireAirlockManager(): Promise<ManagerSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.trim().toLowerCase() ?? "";
  if (!user?.id || !email || email === "ghl-embed@ccpatio.com") {
    return { ok: false, error: "not_authorized" };
  }

  const db = getDb();
  const [row] = await db
    .select({ role: user_roles.role })
    .from(user_roles)
    .where(eq(user_roles.id, user.id))
    .limit(1);

  if (row?.role !== "Ops_Manager" && row?.role !== "SuperAdmin") {
    return { ok: false, error: "not_authorized" };
  }
  return { ok: true, email, role: row.role };
}

async function blockingCodesForSubmit(
  rootSku: string,
  checklist: {
    identityConfirmed: boolean;
    cutListConfirmed: boolean;
    operationsConfirmed: boolean;
    reviewConfirmed: boolean;
  },
): Promise<{ ok: true; hash: string } | { ok: false; error: string; blockingCodes?: string[] }> {
  if (
    !checklist.identityConfirmed ||
    !checklist.cutListConfirmed ||
    !checklist.operationsConfirmed ||
    !checklist.reviewConfirmed
  ) {
    return { ok: false, error: "checklist", blockingCodes: ["CHECKLIST"] };
  }

  const snapshot = await loadAirlockSnapshot(rootSku);
  const db = getDb();
  const skus = new Set<string>([rootSku]);
  for (const line of snapshot.lines) {
    skus.add(line.parent_sku);
    skus.add(line.child_sku);
  }

  const mapped = await db
    .select({
      sku: sku_mappings.global_sku,
      itemType: sku_mappings.item_type,
      originalName: sku_mappings.original_name,
      katanaVariantId: sku_mappings.katana_variant_id,
      category: sku_mappings.category,
    })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, [...skus]));
  const skuMap = new Map(mapped.map((row) => [row.sku, row]));
  const rootMeta = skuMap.get(rootSku);
  if (!rootMeta) return { ok: false, error: "root_not_found" };

  const cad = snapshot.cadUpload;
  const geometry = cad?.geometry_snapshot as { hygiene?: string } | null;
  const cadNode =
    cad && (cad.ext === "dae" || cad.ext === "glb")
      ? {
          uploadId: cad.id,
          ext: cad.ext as "dae" | "glb",
          status: (cad.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
          sha256: cad.sha256 || "",
          hygiene: (geometry?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
        }
      : null;

  const parents = [...skus].filter(
    (sku) => sku === rootSku || snapshot.lines.some((line) => line.parent_sku === sku),
  );
  const nodes = parents.map((parentSku) => {
    const parentMeta = skuMap.get(parentSku);
    const lines = snapshot.lines
      .filter((line) => line.parent_sku === parentSku)
      .map((line) => {
        const child = skuMap.get(line.child_sku);
        const cuts = Array.isArray(line.cut_list) ? line.cut_list : [];
        const category = child?.category || "";
        const isMetal = Boolean(
          category.match(/metal|aluminum|tube|flat bar/i) ||
            (cuts.length > 0 && (cuts[0] as { profile?: string }).profile !== "UNKNOWN") ||
            ((line.unit_of_measure === "in" || line.unit_of_measure === "ft") && cuts.length > 0),
        );
        return {
          parentSku: line.parent_sku,
          childSku: line.child_sku,
          itemType: child?.itemType === "sub_assembly" ? "sub_assembly" : "raw_material",
          quantity: Number(line.quantity),
          scrapFactor: Number(line.scrap_factor),
          unitOfMeasure: line.unit_of_measure,
          status: line.status,
          source: line.source,
          notes: line.notes,
          cutList: cuts,
          isMetal,
        };
      });
    const operations = snapshot.operations
      .filter((op) => op.item_sku === parentSku)
      .map((op) => ({
        itemSku: op.item_sku,
        workCenter: op.work_center,
        sequence: op.sequence,
        setupTimeMins: op.setup_time_mins ? Number(op.setup_time_mins) : 0,
        runTimeMins: op.run_time_mins ? Number(op.run_time_mins) : 0,
      }));
    return {
      sku: parentSku,
      itemType:
        parentSku === rootSku
          ? "finished_good"
          : parentMeta?.itemType === "finished_good"
            ? "finished_good"
            : "sub_assembly",
      lines,
      operations,
    };
  });

  const dossier = {
    rootSku,
    identity: {
      itemType: rootMeta.itemType === "sub_assembly" ? "sub_assembly" : "finished_good",
      originalName: rootMeta.originalName || "",
      katanaVariantId: rootMeta.katanaVariantId || null,
      cad: cadNode,
      cadWaived: false,
    },
    nodes,
    checklist: {
      identityConfirmed: true,
      cutListConfirmed: true,
      operationsConfirmed: true,
      reviewConfirmed: true,
      quarantineConfirmed: true,
    },
  };

  const blockingCodes = evaluateAirlock(dossier);
  if (blockingCodes.length > 0) {
    return { ok: false, error: "blocking", blockingCodes };
  }

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        rootSku,
        lines: snapshot.lines.map((line) => ({
          parent: line.parent_sku,
          child: line.child_sku,
          quantity: line.quantity,
          scrap: line.scrap_factor,
          uom: line.unit_of_measure,
          notes: line.notes,
          cuts: line.cut_list,
        })),
        operations: snapshot.operations.map((op) => ({
          sku: op.item_sku,
          workCenter: op.work_center,
          sequence: op.sequence,
          setup: op.setup_time_mins,
          run: op.run_time_mins,
        })),
        cadSha: cad?.sha256 ?? null,
      }),
    )
    .digest("hex");
  return { ok: true, hash };
}

export async function submitAirlockAction(input: {
  rootSku: string;
  identityConfirmed: boolean;
  cutListConfirmed: boolean;
  operationsConfirmed: boolean;
  reviewConfirmed: boolean;
}): Promise<AirlockActionResult> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "not_authenticated" };

  const rootSku = input.rootSku.trim().toUpperCase();
  if (!rootSku) return { ok: false, error: "sku_required" };

  const gate = await blockingCodesForSubmit(rootSku, input);
  if (!gate.ok) return gate;

  const actorRole = isEmbedPrincipal(session) ? "embed" : "Designer";
  const db = getDb();

  try {
    const outcome = await db.transaction(async (tx) => {
      const [item] = await tx
        .select({ id: custom_build_job_items.id, jobId: custom_build_job_items.job_id })
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.global_sku, rootSku))
        .limit(1);
      if (!item) return { kind: "missing_job" as const };

      await tx
        .insert(factory_airlock_builds)
        .values({
          job_item_id: item.id,
          root_sku: rootSku,
          status: "draft",
        })
        .onConflictDoNothing({ target: factory_airlock_builds.job_item_id });

      const [build] = await tx
        .select()
        .from(factory_airlock_builds)
        .where(eq(factory_airlock_builds.job_item_id, item.id))
        .for("update")
        .limit(1);
      if (!build) return { kind: "conflict" as const };
      if (build.status !== "draft") {
        return { kind: "illegal" as const, status: build.status };
      }

      const now = new Date();
      const [updated] = await tx
        .update(factory_airlock_builds)
        .set({
          status: "pending_manager",
          dossier_hash: gate.hash,
          submitted_by: session.email,
          submitted_at: now,
          version: sql`${factory_airlock_builds.version} + 1`,
          updated_at: now,
        })
        .where(
          and(
            eq(factory_airlock_builds.id, build.id),
            eq(factory_airlock_builds.version, build.version),
            eq(factory_airlock_builds.status, "draft"),
          ),
        )
        .returning({ id: factory_airlock_builds.id });
      if (!updated) return { kind: "conflict" as const };

      await tx.insert(factory_airlock_decisions).values({
        build_id: updated.id,
        action: "submit",
        actor_email: session.email,
        actor_role: actorRole,
        dossier_hash: gate.hash,
      });
      return { kind: "ok" as const };
    });

    if (outcome.kind === "missing_job") return { ok: false, error: "no_custom_build" };
    if (outcome.kind === "illegal") {
      return { ok: false, error: "illegal_transition", status: outcome.status };
    }
    if (outcome.kind === "conflict") return { ok: false, error: "conflict" };
    revalidateAirlock();
    return { ok: true, status: "pending_manager" };
  } catch (error) {
    if (isAirlockSchemaMissing(error)) return { ok: false, error: "airlock_schema_pending" };
    throw error;
  }
}

export async function rejectAirlockAction(input: {
  buildId: string;
  version: number;
  comment: string;
}): Promise<AirlockActionResult> {
  const manager = await requireAirlockManager();
  if (!manager.ok) return { ok: false, error: "not_authorized" };

  const comment = input.comment?.trim() ?? "";
  if (comment.length < 10 || comment.length > 2000) {
    return { ok: false, error: "comment_required" };
  }
  if (!input.buildId || !Number.isInteger(input.version)) {
    return { ok: false, error: "invalid_build" };
  }

  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      const [build] = await tx
        .select()
        .from(factory_airlock_builds)
        .where(eq(factory_airlock_builds.id, input.buildId))
        .for("update")
        .limit(1);
      if (!build) return { kind: "missing" as const };
      if (build.status !== "pending_manager" || build.version !== input.version) {
        return { kind: "illegal" as const, status: build.status };
      }
      const hash = build.dossier_hash;
      if (!hash) return { kind: "missing_hash" as const };

      const now = new Date();
      const [updated] = await tx
        .update(factory_airlock_builds)
        .set({
          status: "draft",
          version: sql`${factory_airlock_builds.version} + 1`,
          updated_at: now,
        })
        .where(
          and(
            eq(factory_airlock_builds.id, build.id),
            eq(factory_airlock_builds.version, build.version),
            eq(factory_airlock_builds.status, "pending_manager"),
          ),
        )
        .returning({ id: factory_airlock_builds.id });
      if (!updated) return { kind: "conflict" as const };

      await tx.insert(factory_airlock_decisions).values({
        build_id: updated.id,
        action: "reject",
        actor_email: manager.email,
        actor_role: manager.role,
        comment,
        dossier_hash: hash,
      });
      return { kind: "ok" as const };
    });

    if (outcome.kind === "missing") return { ok: false, error: "not_found" };
    if (outcome.kind === "missing_hash") return { ok: false, error: "missing_hash" };
    if (outcome.kind === "illegal") {
      return { ok: false, error: "illegal_transition", status: outcome.status };
    }
    if (outcome.kind === "conflict") return { ok: false, error: "conflict" };
    revalidateAirlock();
    return { ok: true, status: "draft" };
  } catch (error) {
    if (isAirlockSchemaMissing(error)) return { ok: false, error: "airlock_schema_pending" };
    throw error;
  }
}

export async function approveAirlockAction(input: {
  buildId: string;
  version: number;
}): Promise<AirlockActionResult> {
  const manager = await requireAirlockManager();
  if (!manager.ok) return { ok: false, error: "not_authorized" };
  if (!input.buildId || !Number.isInteger(input.version)) {
    return { ok: false, error: "invalid_build" };
  }

  const db = getDb();
  try {
    const outcome = await db.transaction(async (tx) => {
      const [build] = await tx
        .select()
        .from(factory_airlock_builds)
        .where(eq(factory_airlock_builds.id, input.buildId))
        .for("update")
        .limit(1);
      if (!build) return { kind: "missing" as const };
      if (build.status !== "pending_manager" || build.version !== input.version) {
        return { kind: "illegal" as const, status: build.status };
      }
      if (!build.dossier_hash) return { kind: "missing_hash" as const };

      const [item] = await tx
        .select({
          jobId: custom_build_job_items.job_id,
        })
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.id, build.job_item_id))
        .limit(1);
      if (!item) return { kind: "missing_job" as const };

      const [job] = await tx
        .select({ opportunityId: custom_build_jobs.ghl_opportunity_id })
        .from(custom_build_jobs)
        .where(eq(custom_build_jobs.id, item.jobId))
        .limit(1);
      const opportunityId = job?.opportunityId?.trim() ?? "";
      if (!opportunityId) return { kind: "missing_opportunity" as const };

      const now = new Date();
      const [updated] = await tx
        .update(factory_airlock_builds)
        .set({
          status: "approved",
          approved_by: manager.email,
          approved_at: now,
          version: sql`${factory_airlock_builds.version} + 1`,
          updated_at: now,
        })
        .where(
          and(
            eq(factory_airlock_builds.id, build.id),
            eq(factory_airlock_builds.version, build.version),
            eq(factory_airlock_builds.status, "pending_manager"),
          ),
        )
        .returning({
          id: factory_airlock_builds.id,
          version: factory_airlock_builds.version,
          dossierHash: factory_airlock_builds.dossier_hash,
          rootSku: factory_airlock_builds.root_sku,
          jobItemId: factory_airlock_builds.job_item_id,
        });
      if (!updated?.dossierHash) return { kind: "conflict" as const };

      await tx.insert(factory_airlock_decisions).values({
        build_id: updated.id,
        action: "approve",
        actor_email: manager.email,
        actor_role: manager.role,
        dossier_hash: updated.dossierHash,
      });

      return {
        kind: "ok" as const,
        event: {
          buildId: updated.id,
          jobItemId: updated.jobItemId,
          rootSku: updated.rootSku,
          ghlOpportunityId: opportunityId,
          dossierHash: updated.dossierHash,
          approvedBy: manager.email,
          version: updated.version,
        },
      };
    });

    if (outcome.kind === "missing") return { ok: false, error: "not_found" };
    if (outcome.kind === "missing_job") return { ok: false, error: "no_custom_build" };
    if (outcome.kind === "missing_opportunity") return { ok: false, error: "missing_opportunity" };
    if (outcome.kind === "missing_hash") return { ok: false, error: "missing_hash" };
    if (outcome.kind === "illegal") {
      return { ok: false, error: "illegal_transition", status: outcome.status };
    }
    if (outcome.kind === "conflict") return { ok: false, error: "conflict" };

    try {
      await inngest.send({
        name: FACTORY_AIRLOCK_APPROVED_EVENT,
        id: inngestEventId("factory:airlock", outcome.event.buildId, outcome.event.dossierHash),
        data: outcome.event,
      });
    } catch (error) {
      revalidateAirlock();
      const message = error instanceof Error ? error.message : "Inngest send failed";
      return { ok: false, error: `event_dispatch_failed: ${message}` };
    }
    revalidateAirlock();
    return { ok: true, status: "approved" };
  } catch (error) {
    if (isAirlockSchemaMissing(error)) return { ok: false, error: "airlock_schema_pending" };
    throw error;
  }
}

export async function listPendingAirlockBuilds(): Promise<
  | { ok: true; builds: PendingAirlockBuild[] }
  | { ok: false; error: "airlock_schema_pending" | "not_authorized" }
> {
  const manager = await requireAirlockManager();
  if (!manager.ok) return { ok: false, error: "not_authorized" };

  const db = getDb();
  try {
    const rows = await db
      .select({
        id: factory_airlock_builds.id,
        rootSku: factory_airlock_builds.root_sku,
        version: factory_airlock_builds.version,
        submittedBy: factory_airlock_builds.submitted_by,
        submittedAt: factory_airlock_builds.submitted_at,
        displayName: custom_build_jobs.display_name,
        opportunityId: custom_build_jobs.ghl_opportunity_id,
      })
      .from(factory_airlock_builds)
      .innerJoin(
        custom_build_job_items,
        eq(factory_airlock_builds.job_item_id, custom_build_job_items.id),
      )
      .innerJoin(custom_build_jobs, eq(custom_build_job_items.job_id, custom_build_jobs.id))
      .where(eq(factory_airlock_builds.status, "pending_manager"));

    return {
      ok: true,
      builds: rows.map((row) => ({
        id: row.id,
        rootSku: row.rootSku,
        version: row.version,
        submittedBy: row.submittedBy,
        submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
        displayName: row.displayName,
        opportunityId: row.opportunityId,
      })),
    };
  } catch (error) {
    if (isAirlockSchemaMissing(error)) return { ok: false, error: "airlock_schema_pending" };
    throw error;
  }
}
