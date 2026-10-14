/**
 * Phase 11 Task 8 — Inngest function for GHL Opportunity Build Summary Sync.
 * Triggers:
 *   - path-a/design.finalized
 *   - path-a/release.completed
 *   - path-a/ghl.sync.requested
 * Concurrency: { limit: 1, key: "event.data.ghlOpportunityId" }
 * Retries: 4
 * ZERO Katana calls.
 */
import { inngest } from "@/inngest/client";
import {
  PATH_A_DESIGN_FINALIZED_EVENT,
  PATH_A_GHL_SYNC_REQUESTED_EVENT,
  PATH_A_RELEASE_COMPLETED_EVENT,
} from "@/server/path-a/events";
import { syncOpportunitySummaryToGhl } from "@/server/ghl/opportunity-writeback";

export const pathAGhlSync = inngest.createFunction(
  {
    id: "path-a-ghl-sync",
    name: "Path A GHL Opportunity Summary Sync",
    triggers: [
      { event: PATH_A_DESIGN_FINALIZED_EVENT },
      { event: PATH_A_RELEASE_COMPLETED_EVENT },
      { event: PATH_A_GHL_SYNC_REQUESTED_EVENT },
    ],
    concurrency: {
      limit: 1,
      key: "event.data.ghlOpportunityId",
    },
    retries: 4,
  },
  async ({ event, step }) => {
    const oppId = String(
      event.data?.ghlOpportunityId || event.data?.opportunityId || "",
    ).trim();

    if (!oppId) {
      return { ok: false, skipped: true, reason: "missing_opportunity_id" };
    }

    return step.run("sync-to-ghl", async () => {
      return syncOpportunitySummaryToGhl(oppId);
    });
  },
);
