/**
 * GET /api/ecommerce/portal-product?sku=FIN-…
 * Cookie-independent product detail for GHL cross-origin iframes.
 * Accepts x-ccpatio-embed-token / Authorization Bearer alongside cookies.
 */
import { NextResponse } from "next/server";
import {
  extractEmbedTokenFromHeaders,
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { getPimSession } from "@/lib/pim-audit";
import { getPortalProductDetail } from "@/app/embed/admin/master-catalog/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizePortalApi(request: Request): Promise<boolean> {
  if (await getPimSession()) return true;
  const secret = getGhlEmbedSecret();
  const token = extractEmbedTokenFromHeaders((n) => request.headers.get(n));
  return Boolean(await verifyEmbedSessionToken(token, secret));
}

export async function GET(request: Request) {
  if (!(await authorizePortalApi(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sku = new URL(request.url).searchParams.get("sku")?.trim() ?? "";
  if (!sku) {
    return NextResponse.json({ ok: false, error: "sku_required" }, { status: 400 });
  }
  const result = await getPortalProductDetail(sku);
  if (!result.ok) {
    const status = result.error.toLowerCase().includes("unauthorized") ? 401 : 404;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}
