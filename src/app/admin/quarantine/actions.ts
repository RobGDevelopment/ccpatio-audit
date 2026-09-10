"use server";

/**
 * Quarantine server actions — Approve must NOT call Katana/Woo/Clover HTTP.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 2.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { logPimAudit, resolvePimOperator } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  item_operations,
  product_bom,
  product_intake,
  sku_mappings,
  type ItemType,
} from "@/server/db/schema";
import {
  collectDraftBomEdges,
  flattenDraftBom,
  parseDraftProduct,
} from "@/server/sketchup/draft-bom";

export type ActionResult =
  | { ok: true; globalSku?: string; message?: string }
  | { ok: false; error: string; code?: "conflict" | "validation" | "not_found" };

export type EnrichmentInput = {
  expectedVersion: number;
  canonicalSku: string;
  msrp: string;
  cost: string;
  seoTitle: string;
  seoDescription: string;
  slug: string;
  syncToWoo: boolean;
  syncToClover: boolean;
};

function normalizeSku(value: string): string {
  return value.trim().toUpperCase();
}

export async function rejectIntake(
  exportId: string,
  reason: string,
  expectedVersion: number,
): Promise<ActionResult> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "Reject reason is required.", code: "validation" };
  }

  const operator = await resolvePimOperator();
  const db = getDb();

  const [updated] = await db
    .update(product_intake)
    .set({
      status: "rejected",
      reject_reason: trimmedReason,
      version: expectedVersion + 1,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(product_intake.export_id, exportId),
        eq(product_intake.status, "quarantined"),
        eq(product_intake.version, expectedVersion),
      ),
    )
    .returning({ export_id: product_intake.export_id });

  if (!updated) {
    return {
      ok: false,
      error: "Intake was already processed or version conflict (OCC).",
      code: "conflict",
    };
  }

  await logPimAudit({
    operatorEmail: operator.email,
    action: "intake_reject",
    field: "status",
    oldValue: "quarantined",
    newValue: `rejected: ${trimmedReason}`,
  });

  revalidatePath("/admin/quarantine");
  return { ok: true, message: "Intake rejected." };
}

export async function approveIntake(
  exportId: string,
  enriched: EnrichmentInput,
): Promise<ActionResult> {
  const canonicalSku = normalizeSku(enriched.canonicalSku);
  if (!canonicalSku) {
    return {
      ok: false,
      error: "Canonical SKU is required.",
      code: "validation",
    };
  }

  if (
    (enriched.syncToWoo || enriched.syncToClover) &&
    !enriched.msrp.trim()
  ) {
    return {
      ok: false,
      error: "MSRP is required when syncing to WooCommerce or Clover.",
      code: "validation",
    };
  }

  const operator = await resolvePimOperator();
  const db = getDb();

  const intake = await db.query.product_intake.findFirst({
    where: eq(product_intake.export_id, exportId),
  });

  if (!intake) {
    return { ok: false, error: "Intake not found.", code: "not_found" };
  }
  if (intake.status !== "quarantined") {
    return {
      ok: false,
      error: `Intake is ${intake.status}, not quarantined.`,
      code: "conflict",
    };
  }
  if (intake.version !== enriched.expectedVersion) {
    return {
      ok: false,
      error: "Version conflict — reload the quarantine page and retry.",
      code: "conflict",
    };
  }

  const hubRows = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings);
  const hubSkus = new Set(hubRows.map((r) => r.sku));

  const draft = parseDraftProduct(intake.raw_payload, hubSkus);
  if (!draft) {
    return {
      ok: false,
      error: "Intake payload is missing a product object.",
      code: "validation",
    };
  }

  const flatNodes = flattenDraftBom(draft.subassemblies);
  const edges = collectDraftBomEdges(canonicalSku, draft.subassemblies);

  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(product_intake)
        .set({
          status: "approved",
          proposed_sku: canonicalSku,
          version: enriched.expectedVersion + 1,
          updated_at: new Date(),
          reject_reason: null,
        })
        .where(
          and(
            eq(product_intake.export_id, exportId),
            eq(product_intake.status, "quarantined"),
            eq(product_intake.version, enriched.expectedVersion),
          ),
        )
        .returning({ export_id: product_intake.export_id });

      if (!claimed) {
        throw new Error("OCC_CONFLICT");
      }

      // Supersede other quarantined intakes targeting the same proposed SKU.
      await tx
        .update(product_intake)
        .set({
          status: "superseded",
          version: sql`${product_intake.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(product_intake.status, "quarantined"),
            eq(product_intake.proposed_sku, canonicalSku),
            ne(product_intake.export_id, exportId),
          ),
        );

      await tx
        .insert(sku_mappings)
        .values({
          global_sku: canonicalSku,
          category: draft.category,
          item_type: "finished_good",
          original_name: draft.name,
          source_file: `sketchup:${exportId}`,
          is_active: true,
          sync_to_woo: enriched.syncToWoo,
          sync_to_clover: enriched.syncToClover,
          updated_by: operator.email,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: sku_mappings.global_sku,
          set: {
            category: draft.category,
            item_type: "finished_good",
            original_name: draft.name,
            sync_to_woo: enriched.syncToWoo,
            sync_to_clover: enriched.syncToClover,
            is_active: true,
            updated_by: operator.email,
            updated_at: new Date(),
            version: sql`${sku_mappings.version} + 1`,
          },
        });

      await tx
        .insert(finished_goods_catalog)
        .values({
          global_sku: canonicalSku,
          msrp: enriched.msrp.trim() || null,
          cost: enriched.cost.trim() || null,
          length: draft.dimensions.length ?? null,
          depth: draft.dimensions.depth ?? null,
          height: draft.dimensions.height ?? null,
          arm_height: draft.dimensions.arm_height ?? null,
          sit_height: draft.dimensions.sit_height ?? null,
          weight: draft.dimensions.weight ?? null,
          description: draft.name,
          slug: enriched.slug.trim() || null,
          seo_title: enriched.seoTitle.trim() || null,
          seo_description: enriched.seoDescription.trim() || null,
          updated_by: operator.email,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: finished_goods_catalog.global_sku,
          set: {
            msrp: enriched.msrp.trim() || null,
            cost: enriched.cost.trim() || null,
            length: draft.dimensions.length ?? null,
            depth: draft.dimensions.depth ?? null,
            height: draft.dimensions.height ?? null,
            arm_height: draft.dimensions.arm_height ?? null,
            sit_height: draft.dimensions.sit_height ?? null,
            weight: draft.dimensions.weight ?? null,
            description: draft.name,
            slug: enriched.slug.trim() || null,
            seo_title: enriched.seoTitle.trim() || null,
            seo_description: enriched.seoDescription.trim() || null,
            updated_by: operator.email,
            updated_at: new Date(),
          },
        });

      for (const node of flatNodes) {
        const itemType: ItemType =
          node.itemType === "finished_good" ? "sub_assembly" : node.itemType;
        await tx
          .insert(sku_mappings)
          .values({
            global_sku: node.sku,
            category: draft.category,
            item_type: itemType,
            original_name: node.sku,
            source_file: `sketchup:${exportId}`,
            is_active: true,
            sync_to_woo: false,
            sync_to_clover: false,
            updated_by: operator.email,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: sku_mappings.global_sku,
            set: {
              item_type: itemType,
              is_active: true,
              updated_by: operator.email,
              updated_at: new Date(),
              version: sql`${sku_mappings.version} + 1`,
            },
          });
      }

      for (const edge of edges) {
        await tx
          .insert(product_bom)
          .values({
            parent_sku: edge.parentSku,
            child_sku: edge.childSku,
            quantity: String(edge.quantity),
            scrap_factor: "1.0000",
            unit_of_measure: edge.unitOfMeasure,
            updated_at: new Date(),
          })
          .onConflictDoUpdate({
            target: [product_bom.parent_sku, product_bom.child_sku],
            set: {
              quantity: String(edge.quantity),
              unit_of_measure: edge.unitOfMeasure,
              updated_at: new Date(),
            },
          });
      }

      // Replace operations for FG + each node that carries routing.
      const opTargets: Array<{
        sku: string;
        ops: typeof draft.rootOperations;
      }> = [
        { sku: canonicalSku, ops: draft.rootOperations },
        ...flatNodes.map((n) => ({ sku: n.sku, ops: n.operations })),
      ];

      for (const target of opTargets) {
        if (target.ops.length === 0) continue;
        await tx
          .delete(item_operations)
          .where(eq(item_operations.item_sku, target.sku));
        await tx.insert(item_operations).values(
          target.ops.map((op) => ({
            item_sku: target.sku,
            work_center: op.work_center,
            sequence: op.sequence,
            setup_time_mins:
              op.setup_mins != null ? String(op.setup_mins) : null,
            run_time_mins: op.run_mins != null ? String(op.run_mins) : null,
          })),
        );
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "OCC_CONFLICT") {
      return {
        ok: false,
        error: "Version conflict — reload and retry.",
        code: "conflict",
      };
    }
    console.error("[approveIntake] failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Approve failed",
    };
  }

  // Fire-and-forget hand-off — no Katana/Woo/Clover HTTP here.
  await inngest.send({
    name: "product.approved",
    data: {
      globalSku: canonicalSku,
      exportId,
    },
    id: `product-approved-${exportId}`,
  });

  await logPimAudit({
    operatorEmail: operator.email,
    globalSku: canonicalSku,
    action: "intake_approve",
    field: "status",
    oldValue: "quarantined",
    newValue: "approved",
  });

  revalidatePath("/admin/quarantine");
  revalidatePath("/admin/dictionary");
  revalidatePath(`/admin/dictionary/bom/${encodeURIComponent(canonicalSku)}`);

  return {
    ok: true,
    globalSku: canonicalSku,
    message: "Approved and queued product.approved for fan-out.",
  };
}
