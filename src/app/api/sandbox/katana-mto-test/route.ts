/**
 * POST /api/sandbox/katana-mto-test
 *
 * Isolated Katana MTO + fabric-override probe. Not a Woo / GHL ingress.
 * Requires header `x-sandbox-secret` (or `Authorization: Bearer`) matching
 * SANDBOX_KATANA_MTO_SECRET. Refuses all requests when that env is unset.
 *
 * Node runtime: Katana + Postgres. Do not run this on Edge.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { KatanaApiError } from "@/lib/katana";
import { runSandboxedKatanaMtoTest } from "@/lib/run-sandbox-katana-mto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sandboxSecretMatches(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function readProvidedSecret(request: Request): string | null {
  const header = request.headers.get("x-sandbox-secret")?.trim();
  if (header) {
    return header;
  }
  const auth = request.headers.get("authorization");
  if (!auth) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1]?.trim() ?? null;
}

export async function POST(request: Request) {
  const expected = process.env.SANDBOX_KATANA_MTO_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        error: "sandbox_disabled",
        message: "SANDBOX_KATANA_MTO_SECRET is not set.",
      },
      { status: 403 },
    );
  }

  if (!sandboxSecretMatches(readProvidedSecret(request), expected)) {
    return NextResponse.json({ error: "invalid_sandbox_secret" }, { status: 401 });
  }

  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const record =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  try {
    const result = await runSandboxedKatanaMtoTest({
      sku: typeof record.sku === "string" ? record.sku : undefined,
      quantity: typeof record.quantity === "number" ? record.quantity : undefined,
      orderNo: typeof record.orderNo === "string" ? record.orderNo : undefined,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof KatanaApiError) {
      return NextResponse.json(
        { ok: false, error: error.message, status: error.status, details: error.details },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
      );
    }
    const message = error instanceof Error ? error.message : "sandbox MTO failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
