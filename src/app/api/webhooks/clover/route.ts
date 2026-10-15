import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { logError, logStructured } from "@/lib/log/structured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time compare of two secrets of any length (digest first, so length does not leak). */
function secretsMatch(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

type CloverEvent = { type?: unknown; objectId?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * POST /api/webhooks/clover
 *
 * 400 invalid JSON (Clover must not retry a body that can never parse).
 * 401 missing or wrong X-Clover-Auth.
 * 500 server fault (secret not configured, Inngest down, anything unexpected). Clover
 *     retries a 5xx, and the event id below makes that retry idempotent.
 */
async function handle(req: Request): Promise<Response> {
  const rawBody = await req.text();

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    const ref = logError("clover-webhook-invalid-json", error, { status: 400 });
    return NextResponse.json({ error: "Invalid JSON", ref }, { status: 400 });
  }
  if (!isRecord(body)) {
    logStructured("warn", "clover-webhook-invalid-body", { status: 400 });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Clover setup verification ping. Logged once so the developer can finish subscribing.
  if (typeof body.verificationCode === "string" && body.verificationCode.length > 0) {
    logStructured("info", "clover-webhook-verification-code", {
      verificationCode: body.verificationCode,
    });
    return NextResponse.json({ success: true }, { status: 200 });
  }

  const secret = process.env.CLOVER_WEBHOOK_SECRET?.trim();
  if (!secret) {
    logStructured("error", "clover-webhook-secret-missing", { status: 500 });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!secretsMatch(req.headers.get("x-clover-auth"), secret)) {
    logStructured("warn", "clover-webhook-unauthorized", { status: 401 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const merchants = body.merchants;
  if (!isRecord(merchants)) {
    // Authenticated but not a payment notification: acknowledge and ignore.
    return NextResponse.json({ success: true, ignored: true }, { status: 200 });
  }

  const eventsToDispatch: Array<{
    id: string;
    name: "clover/payment.created";
    data: { merchantId: string; paymentId: string };
  }> = [];

  for (const [merchantId, events] of Object.entries(merchants)) {
    if (!Array.isArray(events)) continue;
    for (const raw of events as CloverEvent[]) {
      if (!isRecord(raw)) {
        logStructured("warn", "clover-webhook-skipped-event", { reason: "not_object" });
        continue;
      }
      if (
        raw.type === "CREATE" &&
        typeof raw.objectId === "string" &&
        raw.objectId.startsWith("P:")
      ) {
        eventsToDispatch.push({
          // Inngest dedupes on id, so a Clover retry after a 5xx cannot double-post.
          id: `clover:${merchantId}:${raw.objectId}`,
          name: "clover/payment.created",
          data: { merchantId, paymentId: raw.objectId },
        });
      }
    }
  }

  if (eventsToDispatch.length > 0) {
    await inngest.send(eventsToDispatch);
    logStructured("info", "clover-webhook-dispatched", { count: eventsToDispatch.length });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (error) {
    const ref = logError("clover-webhook-failed", error, { status: 500 });
    return NextResponse.json({ error: "internal_error", ref }, { status: 500 });
  }
}
