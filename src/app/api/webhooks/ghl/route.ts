/**
 * POST /api/webhooks/ghl
 *
 * 1. HMAC (x-ghl-signature) — 401 on failure
 * 2. Normalize opportunity payload
 * 3. Emit Inngest `ghl/opportunity.sync` + 200 immediately
 *
 * Node runtime: HMAC + Inngest. Do not run on Edge.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyGhlHmac(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !header) return false;

  const given = header.replace(/^sha256=/i, "").trim();
  if (!given) return false;

  const hexExpected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const b64Expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  return signaturesMatch(given, hexExpected) || signaturesMatch(given, b64Expected);
}

function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function peekOpportunityId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const root = payload as Record<string, unknown>;
  const candidates = [
    root.id,
    root.opportunityId,
    root.opportunity_id,
    asRecord(root.opportunity)?.id,
    asRecord(root.data)?.id,
    asRecord(asRecord(root.data)?.opportunity)?.id,
  ];
  for (const value of candidates) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      return String(value);
    }
  }
  return "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * GHL custom webhooks vary — unwrap common envelopes into a flat opportunity object
 * that `ghlOpportunitySyncSchema` / Katana mappers already understand.
 */
function normalizeGhlOpportunityPayload(parsedJson: unknown): Record<string, unknown> {
  const root = asRecord(parsedJson) ?? {};
  const nested =
    asRecord(root.opportunity) ??
    asRecord(asRecord(root.data)?.opportunity) ??
    asRecord(root.data) ??
    root;

  const contact =
    asRecord(nested.contact) ??
    asRecord(root.contact) ??
    asRecord(asRecord(root.data)?.contact) ??
    undefined;

  const lineItems =
    nested.line_items ??
    nested.lineItems ??
    root.line_items ??
    root.lineItems;

  return {
    ...nested,
    id: nested.id ?? peekOpportunityId(parsedJson),
    contact: contact ?? nested.contact,
    line_items: Array.isArray(lineItems) ? lineItems : nested.line_items,
    status: nested.status ?? nested.opportunity_status ?? root.status,
    pipeline_id: nested.pipeline_id ?? nested.pipelineId,
    pipeline_stage_id: nested.pipeline_stage_id ?? nested.pipelineStageId,
  };
}

export async function POST(req: Request) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-ghl-signature") ??
    req.headers.get("X-GHL-Signature") ??
    req.headers.get("x-webhook-signature");

  if (!verifyGhlHmac(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const opportunity = normalizeGhlOpportunityPayload(parsedJson);
  const opportunityId = peekOpportunityId(opportunity);

  try {
    await inngest.send({
      name: "ghl/opportunity.sync",
      data: opportunity,
      id: `ghl-opportunity-${opportunityId}`,
    });
  } catch (error) {
    console.error("[ghl-webhook] inngest send failed", error);
    return NextResponse.json({ error: "enqueue_unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { accepted: true, opportunityId },
    { status: 200 },
  );
}
