/**
 * POST /api/webhooks/woocommerce
 *
 * Retired. Transactional WooCommerce order ingress is out of MDM hub scope.
 * Use the native Katana WooCommerce connector for sales orders / inventory.
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
        "WooCommerce order webhooks are not processed by the MDM hub. Use the native Katana WooCommerce connector.",
      see: "docs/MDM_MASTER_BLUEPRINT.md",
    },
    { status: 410 },
  );
}
