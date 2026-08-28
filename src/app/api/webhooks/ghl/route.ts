/**
 * POST /api/webhooks/ghl
 *
 * 1. Verify HMAC / Authorization (GHL_WEBHOOK_SECRET) — 401 on failure
 * 2. Parse Opportunity Won payload + audit log to incoming_webhooks (received)
 * 3. Emit Inngest `ghl/opportunity.won` + 200 immediately
 *
 * Node runtime: HMAC + Postgres + Inngest. Do not run on Edge.
 */
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import {
  captureGhlWebhookHeaders,
  GHL_OPPORTUNITY_WON_EVENT,
  ghlOpportunityIdempotencyKey,
  normalizeGhlOpportunityPayload,
  peekGhlOpportunityId,
  verifyGhlWebhookRequest,
} from "@/server/ghl/ingress";
import { parseGhlOpportunityWon } from "@/server/ghl/ingress.schema";
import { logIncomingWebhook } from "@/server/webhooks/incoming-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  const rawBody = await req.text();

  if (!verifyGhlWebhookRequest(rawBody, req.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = captureGhlWebhookHeaders(req.headers);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    const idempotencyKey = `ghl-opportunity-won-malformed-${Date.now()}`;
    try {
      await logIncomingWebhook({
        source: "ghl",
        eventName: GHL_OPPORTUNITY_WON_EVENT,
        idempotencyKey,
        payload: {
          rawBody: rawBody.slice(0, 4000),
          headers,
        },
        status: "failed",
        errorMessage: "invalid_json",
      });
    } catch (error) {
      console.error("[ghl-webhook] failed to log malformed json", error);
      return NextResponse.json({ error: "audit_unavailable" }, { status: 503 });
    }

    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const normalized = normalizeGhlOpportunityPayload(parsedJson);
  const parsed = parseGhlOpportunityWon(normalized);
  const opportunityId = parsed.ok ? parsed.data.id : peekGhlOpportunityId(normalized);
  const idempotencyKey = ghlOpportunityIdempotencyKey(opportunityId);

  if (!parsed.ok) {
    try {
      await logIncomingWebhook({
        source: "ghl",
        eventName: GHL_OPPORTUNITY_WON_EVENT,
        idempotencyKey,
        payload: {
          raw: parsedJson,
          headers,
          normalized,
        },
        status: "failed",
        errorMessage: parsed.error,
      });
    } catch (error) {
      console.error("[ghl-webhook] failed to log invalid payload", error);
      return NextResponse.json({ error: "audit_unavailable" }, { status: 503 });
    }

    return NextResponse.json(
      { error: "invalid_payload", message: parsed.error },
      { status: 400 },
    );
  }

  const eventPayload = {
    opportunityId: parsed.data.id,
    contactName: parsed.contactName,
    opportunityValue: parsed.opportunityValue,
    lineItems: parsed.data.line_items ?? [],
    pipelineId: parsed.data.pipeline_id ?? null,
    pipelineStageId: parsed.data.pipeline_stage_id ?? null,
    status: parsed.data.status ?? null,
    contact: parsed.data.contact ?? null,
    source: parsed.data.source ?? null,
    opportunity: parsed.data,
    ingress: {
      raw: parsedJson,
      headers,
    },
  };

  try {
    await logIncomingWebhook({
      source: "ghl",
      eventName: GHL_OPPORTUNITY_WON_EVENT,
      idempotencyKey,
      payload: eventPayload,
      status: "received",
    });
  } catch (error) {
    console.error("[ghl-webhook] incoming_webhooks insert failed", error);
    return NextResponse.json({ error: "audit_unavailable" }, { status: 503 });
  }

  try {
    await inngest.send({
      name: GHL_OPPORTUNITY_WON_EVENT,
      data: eventPayload,
      id: idempotencyKey,
    });
  } catch (error) {
    console.error("[ghl-webhook] inngest send failed", error);
    try {
      await logIncomingWebhook({
        source: "ghl",
        eventName: GHL_OPPORTUNITY_WON_EVENT,
        idempotencyKey: `${idempotencyKey}-enqueue-failed`,
        payload: eventPayload,
        status: "failed",
        errorMessage: "inngest_enqueue_failed",
      });
    } catch (logError) {
      console.error("[ghl-webhook] failed to log enqueue error", logError);
    }
    return NextResponse.json({ error: "enqueue_unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    {
      accepted: true,
      opportunityId: parsed.data.id,
      event: GHL_OPPORTUNITY_WON_EVENT,
    },
    { status: 200 },
  );
}
