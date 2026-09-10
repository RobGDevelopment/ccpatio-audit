/**
 * POST /api/webhooks/ghl
 *
 * Retired. GHL Won → Katana sales order / MTO is out of MDM hub scope.
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 0.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "transactional_ingress_retired",
      message:
        "GoHighLevel opportunity webhooks are not processed by the MDM hub. Orders are out of scope.",
      see: "docs/MDM_MASTER_BLUEPRINT.md",
    },
    { status: 410 },
  );
}
