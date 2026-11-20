/**
 * POST /api/ecommerce/woo-sync
 * Authenticated bulk WooCommerce catalog sync entrypoint.
 * Bounded parent concurrency + single store-units fetch; never overwrites Brizy copy.
 */
import { NextResponse } from "next/server";
import { syncApprovedToWoo } from "@/app/embed/admin/master-catalog/actions";
import { getPimSession } from "@/lib/pim-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await getPimSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { skus?: string[] } = {};
  try {
    body = (await request.json()) as { skus?: string[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const skus = Array.isArray(body.skus) ? body.skus : [];
  if (skus.length === 0) {
    return NextResponse.json({ error: "skus_required" }, { status: 400 });
  }
  const result = await syncApprovedToWoo(skus);
  return NextResponse.json(result);
}
