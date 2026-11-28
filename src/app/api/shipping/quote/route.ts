/**
 * POST /api/shipping/quote
 *
 * Hub LTL palletizer + FedEx Freight (live or deterministic fallback) + showroom
 * pickup rates for WooCommerce checkout (via ccpatio-hub-shipping bridge) and
 * interactive dry-runs in Partner / GHL portals.
 */
import { NextResponse } from "next/server";
import {
  authorizeShippingQuoteRequest,
  buildWooCheckoutQuote,
  parseQuoteRequest,
} from "@/server/shipping/woo-checkout-quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeShippingQuoteRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be valid JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = parseQuoteRequest(json);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const quote = await buildWooCheckoutQuote(parsed.data);
    return NextResponse.json(quote, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        tag: "shipping-quote-failed",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    // Last-resort: still never 500 a checkout — return fallback via force path.
    const quote = await buildWooCheckoutQuote(parsed.data, {
      resolveAliases: async (skus) => {
        const m = new Map<string, string>();
        for (const s of skus) m.set(s, s);
        return m;
      },
      loadDims: async () => new Map(),
      forceFallback: true,
    });
    return NextResponse.json(quote, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
