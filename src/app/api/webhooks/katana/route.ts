/**
 * POST /api/webhooks/katana
 *
 * Retired. The MDM hub is not a transactional Katana order listener.
 * Catalog publish is outbound-only (Approve → Inngest → mappers).
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 0 / §5B Tier 2.1.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "transactional_ingress_retired",
      message:
        "Katana webhooks are not processed by the MDM hub. Outbound catalog sync only.",
      see: "docs/MDM_MASTER_BLUEPRINT.md",
    },
    { status: 410 },
  );
}
