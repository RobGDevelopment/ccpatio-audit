import { NextResponse } from "next/server";
import { getPimSession } from "@/lib/pim-audit";
import {
  loadLiveHubRecipeLines,
  toKatanaRecipePosts,
} from "@/lib/katana-recipe-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated preview of the Katana `POST /recipes` bodies that would be
 * emitted from live `product_bom` (SKU-keyed). Used by E2E because server
 * actions cannot be intercepted with Playwright `page.route()`.
 */
export async function GET(request: Request) {
  const session = await getPimSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const sku = new URL(request.url).searchParams.get("sku")?.trim().toUpperCase();
  if (!sku) {
    return NextResponse.json({ ok: false, error: "sku is required" }, { status: 400 });
  }

  const lines = await loadLiveHubRecipeLines(sku);
  const posts = toKatanaRecipePosts(lines);

  return NextResponse.json({
    ok: true,
    finishedGoodSku: sku,
    path: "/recipes",
    method: "POST",
    hubLines: lines,
    katanaRecipePosts: posts,
  });
}
