/**
 * GET /api/partner/primeview-handoff/shipping-plugin
 *
 * Returns a dynamically generated ccpatio-hub-shipping.zip (pure Node PKZIP)
 * for PrimeView install on WooCommerce checkout.
 */
import { NextResponse } from "next/server";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import {
  buildCcpatioHubShippingZip,
  hubShippingZipFilename,
} from "@/server/shipping/woo-shipping-plugin-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const studio = await authenticateAssetStudioRequest(request);
  const embedOk = studio.ok ? true : await authorizeEmbedRequest(request);
  if (!studio.ok && !embedOk) {
    return NextResponse.json(
      { error: studio.ok ? "Unauthorized" : studio.reason },
      { status: 401 },
    );
  }

  const zip = buildCcpatioHubShippingZip();
  const filename = hubShippingZipFilename();

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
