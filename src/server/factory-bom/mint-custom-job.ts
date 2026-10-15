import { getDb } from "@/server/db/client";
import { custom_build_jobs, sku_mappings } from "@/server/db/schema";
import type { ReleaseDb } from "@/server/path-a/release-store";
import { eq, like, desc } from "drizzle-orm";

export type MintCustomJobInput = {
  clientSlug: string;
  itemSlug: string;
  displayName: string;
  ghlOpportunityId?: string | null;
  architectName?: string | null;
  designerName?: string | null;
  packetStoragePath?: string | null;
  createdBy: string;
  category?: string;
  frameNote?: string;
  frameColor?: string;
  dektonColor?: string;
  dektonCut?: string;
  cushionNotes?: string;
};

/**
 * @deprecated Legacy Path A mint function. Use createIntake on the embed path.
 * Retained for backward-compatibility with tests.
 */
export async function mintCustomJob(input: MintCustomJobInput, dbTx?: ReleaseDb) {
  const db = (dbTx ?? getDb()) as any;

  if (input.clientSlug.startsWith("FIN-") || input.itemSlug.startsWith("FIN-")) {
    throw new Error("Cannot mint a FIN- SKU on Path A.");
  }

  if (!input.ghlOpportunityId) {
    throw new Error("A client project (ghlOpportunityId) is required to mint a custom job.");
  }

  const cleanClient = input.clientSlug.replace(/[^A-Z0-9]/gi, "").toUpperCase().substring(0, 16);
  const cleanItem = input.itemSlug.replace(/[^A-Z0-9-]/gi, "").toUpperCase().substring(0, 24);
  
  if (!cleanClient || !cleanItem) {
    throw new Error("Invalid client or item slug.");
  }

  const baseSku = `JOB-${cleanClient}-${cleanItem}`.substring(0, 60); // leave room for -XX

  // We need to find if there's a collision.
  const existingSkus = await db.query.sku_mappings.findMany({
    where: like(sku_mappings.global_sku, `${baseSku}%`),
    orderBy: [desc(sku_mappings.global_sku)],
  });

  let finalSku = baseSku;
  if (existingSkus.length > 0) {
    const exactMatch = existingSkus.find((s: any) => s.global_sku === baseSku);
    if (exactMatch) {
      let maxSuffix = 1;
      for (const row of existingSkus) {
        const match = row.global_sku.match(/-(\d{2})$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxSuffix) {
            maxSuffix = num;
          }
        }
      }
      finalSku = `${baseSku}-${(maxSuffix + 1).toString().padStart(2, "0")}`;
    }
  }

  // Validate regex
  const regex = /^[A-Z0-9][A-Z0-9-]{2,64}$/;
  if (!regex.test(finalSku)) {
    throw new Error(`Generated SKU ${finalSku} violates length or character rules.`);
  }

  // Mint the job header if it doesn't exist for this opportunity.
  let jobId: string;
  const existingJob = db.query?.custom_build_jobs?.findFirst
    ? await db.query.custom_build_jobs.findFirst({
        where: eq(custom_build_jobs.ghl_opportunity_id, input.ghlOpportunityId),
      })
    : (
        await db
          .select({ id: custom_build_jobs.id })
          .from(custom_build_jobs)
          .where(eq(custom_build_jobs.ghl_opportunity_id, input.ghlOpportunityId))
          .limit(1)
      )[0];
  if (existingJob) {
    jobId = existingJob.id;
  } else {
    const [inserted] = await db
      .insert(custom_build_jobs)
      .values({
        client_slug: cleanClient,
        display_name: input.displayName,
        ghl_opportunity_id: input.ghlOpportunityId,
        architect_name: input.architectName,
        designer_name: input.designerName,
        packet_storage_path: input.packetStoragePath,
        created_by: input.createdBy,
      })
      .returning();
    jobId = inserted.id;
  }

  // Insert sku_mappings
  await db.insert(sku_mappings).values({
    global_sku: finalSku,
    original_name: input.displayName || `${cleanClient} ${cleanItem}`,
    source_file: "factory-bom-intake",
    product_origin: null,
    category: input.category || "Custom",
    item_type: "finished_good",
    sync_to_woo: false,
    sync_to_clover: false,
    attributes: {
      custom_build: true,
      job_id: jobId,
      frameNote: input.frameNote,
      frameColor: input.frameColor,
      dektonColor: input.dektonColor,
      dektonCut: input.dektonCut,
      cushionNotes: input.cushionNotes,
    },
    updated_by: input.createdBy,
  });

  return {
    globalSku: finalSku,
    jobId,
  };
}
