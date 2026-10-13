import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { inngestFunctions } from "@/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * MDM hub registry. `processWooCommerceOrder` IS registered (roadmap step 6, dry-run unless
 * ORDER_PIPELINE_MODE=live). Do not re-register `syncGhlOpportunity` (legacy GHL Won bus, retired).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 0.
 * Smart holds: `sendHoldExpirationWarnings` (08:00) and
 * `autoReleaseExpiredHolds` (hourly) are registered via `inngestFunctions`.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
