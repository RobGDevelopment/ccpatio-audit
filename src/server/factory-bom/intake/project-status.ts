import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  custom_build_jobs,
  custom_build_job_items,
  sku_mappings,
} from "@/server/db/schema";
import { createReleaseStore } from "@/server/path-a/release-store";

export type ProjectPieceSummary = {
  sku: string;
  name: string;
  quantity: number;
};

export type ProjectStatus = {
  jobExists: boolean;
  clientCode?: string;
  pieces: ProjectPieceSummary[];
  packet?: {
    filename: string;
    uploadedAt?: string;
  };
  locked: boolean;
};

export async function loadProjectStatus(opportunityId: string): Promise<ProjectStatus> {
  const db = getDb();
  const releaseStore = createReleaseStore(() => db);

  const [job, saga] = await Promise.all([
    db.query.custom_build_jobs.findFirst({
      where: eq(custom_build_jobs.ghl_opportunity_id, opportunityId),
    }),
    releaseStore.getSaga(opportunityId),
  ]);

  const isLocked =
    saga?.status === "IN_PROGRESS" ||
    saga?.status === "COMPLETED" ||
    (saga?.status === "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION" &&
      Boolean(saga.release_requested_at));

  if (!job) {
    return {
      jobExists: false,
      pieces: [],
      locked: Boolean(isLocked),
    };
  }

  // Load items under this job
  const items = await db.query.custom_build_job_items.findMany({
    where: eq(custom_build_job_items.job_id, job.id),
  });

  const pieces: ProjectPieceSummary[] = [];
  for (const item of items) {
    const mapping = await db.query.sku_mappings.findFirst({
      where: eq(sku_mappings.global_sku, item.global_sku),
    });
    pieces.push({
      sku: item.global_sku,
      name: mapping?.original_name || item.global_sku,
      quantity: item.quantity,
    });
  }

  let packet: ProjectStatus["packet"];
  if (job.packet_storage_path) {
    const segments = job.packet_storage_path.split("/");
    const filename = segments[segments.length - 1] || "factory-order.pdf";
    packet = {
      filename,
      uploadedAt: job.updated_at ? job.updated_at.toISOString() : undefined,
    };
  }

  return {
    jobExists: true,
    clientCode: job.client_slug,
    pieces,
    packet,
    locked: Boolean(isLocked),
  };
}
