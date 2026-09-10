import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { inngestFunctions } from "@/inngest/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MDM hub registry. Do not re-register `processWooCommerceOrder` or
 * `syncGhlOpportunity` (V8 transactional bus — retired).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 0.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
