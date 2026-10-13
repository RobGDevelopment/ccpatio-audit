/**
 * Webhook route for CAD converter callbacks (Task 4B).
 * Validates HMAC-SHA256 signature over the raw body, audits incoming payload,
 * verifies upload existence/status, and dispatches cad/convert.completed to Inngest.
 * Zero Katana, QBO, Clover, or converter I/O.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { getDb } from "@/server/db/client";
import { cad_uploads } from "@/server/db/schema";
import { verifyCadCallbackSignature } from "@/server/cad/callback";
import {
  cadConvertCompletedSchema,
  cadConvertCompletedEventId,
  CAD_CONVERT_COMPLETED_EVENT,
} from "@/server/path-a/events";
import { insertIncomingWebhookOnce } from "@/server/webhooks/incoming-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // (1) await req.text() ONCE, never req.json()
  const rawBody = await req.text();

  // (2) CAD_CALLBACK_SECRET unset or blank -> 503
  const secret = process.env.CAD_CALLBACK_SECRET?.trim() ?? "";
  if (!secret) {
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 503 },
    );
  }

  // (3) verify signature -> 401
  const sigHeader = req.headers.get("x-ccpatio-signature");
  if (!verifyCadCallbackSignature(rawBody, sigHeader, secret)) {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 },
    );
  }

  // (4) JSON.parse in try/catch -> 400
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { errors: [{ path: "(root)", message: "Body must be valid JSON" }] },
      { status: 400 },
    );
  }

  // (5) validate with cadConvertCompletedSchema -> 400
  const validation = cadConvertCompletedSchema.safeParse(parsed);
  if (!validation.success) {
    return NextResponse.json(
      { errors: validation.error.issues },
      { status: 400 },
    );
  }

  const data = validation.data;
  const auditKey = `cad-callback:${data.uploadId}:${data.status}`;

  // (6) audit with insertIncomingWebhookOnce
  try {
    await insertIncomingWebhookOnce({
      source: "cad_convert",
      eventName: CAD_CONVERT_COMPLETED_EVENT,
      idempotencyKey: auditKey,
      payload: data,
      status: "received",
    });
  } catch (err) {
    console.error("[cad-callback] audit log error:", err);
  }

  // (7) check if upload exists or is already terminal -> 200 { ignored: true }
  try {
    const db = getDb();
    const [upload] = await db
      .select({
        id: cad_uploads.id,
        status: cad_uploads.status,
      })
      .from(cad_uploads)
      .where(eq(cad_uploads.id, data.uploadId))
      .limit(1);

    if (!upload) {
      return NextResponse.json(
        { ignored: true, reason: "upload_not_found" },
        { status: 200 },
      );
    }

    if (upload.status === "failed" || upload.status === "draft_ready") {
      return NextResponse.json(
        { ignored: true, reason: "already_terminal" },
        { status: 200 },
      );
    }
  } catch (err) {
    console.error("[cad-callback] upload status check failed:", err);
  }

  // (8) send event to Inngest with stable id -> 202; if send throws -> 500
  const eventId = cadConvertCompletedEventId(data.uploadId, data.status);
  try {
    await inngest.send({
      id: eventId,
      name: CAD_CONVERT_COMPLETED_EVENT,
      data,
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (sendErr) {
    console.error("[cad-callback] Inngest send error:", sendErr);
    return NextResponse.json(
      { error: "inngest_send_failed" },
      { status: 500 },
    );
  }
}
