/**
 * Phase 11 Path A Item Store: access to custom_build_job_items.
 * Safe for concurrent callers, no session advisory locks.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_job_items,
  custom_build_jobs,
} from "@/server/db/schema";
import {
  assertLegalItemTransition,
  type PathAItemStatus,
} from "./saga-state";

import type { ReleaseDb } from "./release-store";

export type CustomBuildJobItemRow = typeof custom_build_job_items.$inferSelect;

export type ItemStore = {
  ensureItem(input: {
    jobId: string;
    globalSku: string;
    cadUploadId?: string | null;
    quantity?: number;
  }): Promise<CustomBuildJobItemRow>;
  setItemStatus(input: {
    globalSku: string;
    from: PathAItemStatus | PathAItemStatus[];
    to: PathAItemStatus;
    finalizedDossierHash?: string | null;
    finalizedAt?: Date | null;
    finalizedBy?: string | null;
    katanaSalesOrderRowId?: number | null;
    katanaMoId?: number | null;
    releasedAt?: Date | null;
    quantity?: number;
    cadUploadId?: string | null;
  }): Promise<{ updated: boolean; item?: CustomBuildJobItemRow }>;
  listItemsForJob(jobId: string): Promise<CustomBuildJobItemRow[]>;
  listItemsForOpportunity(oppId: string): Promise<CustomBuildJobItemRow[]>;
  findItemBySku(globalSku: string): Promise<CustomBuildJobItemRow | null>;
  markItemReleased(input: {
    globalSku: string;
    soRowId: number;
    moId: number;
  }): Promise<CustomBuildJobItemRow | null>;
  invalidateItemDesign(globalSku: string): Promise<{ invalidated: boolean }>;
};

export function createItemStore(resolveDb: () => ReleaseDb = getDb): ItemStore {
  return {
    async ensureItem(input) {
      const db = resolveDb();
      const sku = input.globalSku.trim().toUpperCase();

      await db
        .insert(custom_build_job_items)
        .values({
          job_id: input.jobId,
          global_sku: sku,
          cad_upload_id: input.cadUploadId ?? null,
          design_status: "awaiting_cad",
          quantity: input.quantity ?? 1,
        })
        .onConflictDoNothing({ target: [custom_build_job_items.global_sku] });

      const [row] = await db
        .select()
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.global_sku, sku))
        .limit(1);

      if (!row) {
        throw new Error(`ensureItem failed to locate row for ${sku}`);
      }
      return row;
    },

    async setItemStatus(input) {
      const db = resolveDb();
      const sku = input.globalSku.trim().toUpperCase();
      const fromArr = Array.isArray(input.from) ? input.from : [input.from];

      // Validate transitions
      for (const f of fromArr) {
        assertLegalItemTransition(f, input.to);
      }

      const updatePayload: Partial<typeof custom_build_job_items.$inferInsert> = {
        design_status: input.to,
        updated_at: new Date(),
      };
      if (input.finalizedDossierHash !== undefined) {
        updatePayload.finalized_dossier_hash = input.finalizedDossierHash;
      }
      if (input.finalizedAt !== undefined) {
        updatePayload.finalized_at = input.finalizedAt;
      }
      if (input.finalizedBy !== undefined) {
        updatePayload.finalized_by = input.finalizedBy;
      }
      if (input.katanaSalesOrderRowId !== undefined) {
        updatePayload.katana_sales_order_row_id = input.katanaSalesOrderRowId;
      }
      if (input.katanaMoId !== undefined) {
        updatePayload.katana_mo_id = input.katanaMoId;
      }
      if (input.releasedAt !== undefined) {
        updatePayload.released_at = input.releasedAt;
      }
      if (input.quantity !== undefined) {
        updatePayload.quantity = input.quantity;
      }
      if (input.cadUploadId !== undefined) {
        updatePayload.cad_upload_id = input.cadUploadId;
      }

      const [updated] = await db
        .update(custom_build_job_items)
        .set(updatePayload)
        .where(
          and(
            eq(custom_build_job_items.global_sku, sku),
            inArray(custom_build_job_items.design_status, fromArr),
          ),
        )
        .returning();

      return { updated: Boolean(updated), item: updated };
    },

    async listItemsForJob(jobId) {
      const db = resolveDb();
      return db
        .select()
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.job_id, jobId))
        .orderBy(asc(custom_build_job_items.global_sku));
    },

    async listItemsForOpportunity(oppId) {
      const db = resolveDb();
      const [job] = await db
        .select({ id: custom_build_jobs.id })
        .from(custom_build_jobs)
        .where(eq(custom_build_jobs.ghl_opportunity_id, oppId))
        .limit(1);

      if (!job) return [];

      return db
        .select()
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.job_id, job.id))
        .orderBy(asc(custom_build_job_items.global_sku));
    },

    async findItemBySku(globalSku) {
      const db = resolveDb();
      const sku = globalSku.trim().toUpperCase();
      const [row] = await db
        .select()
        .from(custom_build_job_items)
        .where(eq(custom_build_job_items.global_sku, sku))
        .limit(1);
      return row ?? null;
    },

    async markItemReleased(input) {
      const db = resolveDb();
      const sku = input.globalSku.trim().toUpperCase();
      const now = new Date();
      const updatePayload: Partial<typeof custom_build_job_items.$inferInsert> = {
        design_status: "released",
        katana_sales_order_row_id: input.soRowId,
        katana_mo_id: input.moId,
        released_at: now,
        updated_at: now,
      };

      const [updated] = await db
        .update(custom_build_job_items)
        .set(updatePayload)
        .where(eq(custom_build_job_items.global_sku, sku))
        .returning();

      return updated ?? null;
    },

    async invalidateItemDesign(globalSku) {
      const db = resolveDb();
      const sku = globalSku.trim().toUpperCase();
      const updatePayload: Partial<typeof custom_build_job_items.$inferInsert> = {
        design_status: "needs_review",
        finalized_dossier_hash: null,
        finalized_at: null,
        finalized_by: null,
        updated_at: new Date(),
      };
      const [updated] = await db
        .update(custom_build_job_items)
        .set(updatePayload)
        .where(
          and(
            eq(custom_build_job_items.global_sku, sku),
            eq(custom_build_job_items.design_status, "finalized"),
          ),
        )
        .returning();

      return { invalidated: Boolean(updated) };
    },
  };
}
