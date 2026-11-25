/**
 * POST /api/ecommerce/portal-staging-push
 * Staging push actions that respect DOWNSTREAM_MUTATIONS / WOO_LEDGER_MODE
 * without flipping env flags.
 */
import { NextResponse } from "next/server";
import {
  extractEmbedTokenFromHeaders,
  getGhlEmbedSecret,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { getPimSession } from "@/lib/pim-audit";
import { runPortalStagingPush } from "@/app/embed/admin/master-catalog/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorizePortalApi(request: Request): Promise<boolean> {
  if (await getPimSession()) return true;
  const secret = getGhlEmbedSecret();
  const token = extractEmbedTokenFromHeaders((n) => request.headers.get(n));
  return Boolean(await verifyEmbedSessionToken(token, secret));
}

export async function POST(request: Request) {
  if (!(await authorizePortalApi(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: {
    kind?: string;
    preserveWpImages?: boolean;
    mode?: string;
    sku?: string;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const kind =
    body.kind === "swatches_scales" || body.kind === "certified_catalog"
      ? body.kind
      : null;
  if (!kind) {
    return NextResponse.json({ ok: false, error: "kind_required" }, { status: 400 });
  }
  const mode =
    body.mode === "catalog" || body.mode === "finishes" || body.mode === "sku"
      ? body.mode
      : undefined;
  const result = await runPortalStagingPush({
    kind,
    preserveWpImages: body.preserveWpImages !== false,
    mode,
    sku: typeof body.sku === "string" ? body.sku : null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
