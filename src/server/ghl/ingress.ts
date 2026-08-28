import { createHmac, timingSafeEqual } from "node:crypto";

export const GHL_OPPORTUNITY_WON_EVENT = "ghl/opportunity.won";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifyHmacSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;

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

function verifyBearerAuth(
  authorization: string | null,
  secret: string,
): boolean {
  if (!authorization) return false;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  return signaturesMatch(match[1].trim(), secret);
}

/**
 * Verify GHL webhook via HMAC signature and/or Authorization bearer token.
 */
export function verifyGhlWebhookRequest(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
): boolean {
  if (!secret?.trim()) return false;

  const trimmedSecret = secret.trim();
  const signature =
    headers.get("x-ghl-signature") ??
    headers.get("X-GHL-Signature") ??
    headers.get("x-webhook-signature");

  if (verifyHmacSignature(rawBody, signature, trimmedSecret)) {
    return true;
  }

  return verifyBearerAuth(headers.get("authorization"), trimmedSecret);
}

export function peekGhlOpportunityId(payload: unknown): string {
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

/**
 * GHL custom webhooks vary — unwrap common envelopes into a flat opportunity object.
 */
export function normalizeGhlOpportunityPayload(
  parsedJson: unknown,
): Record<string, unknown> {
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
    id: nested.id ?? peekGhlOpportunityId(parsedJson),
    contact: contact ?? nested.contact,
    line_items: Array.isArray(lineItems) ? lineItems : nested.line_items,
    status: nested.status ?? nested.opportunity_status ?? root.status,
    pipeline_id: nested.pipeline_id ?? nested.pipelineId,
    pipeline_stage_id: nested.pipeline_stage_id ?? nested.pipelineStageId,
    monetary_value:
      nested.monetary_value ??
      nested.monetaryValue ??
      nested.value ??
      root.monetary_value,
  };
}

export function captureGhlWebhookHeaders(headers: Headers): Record<string, string> {
  const captured: Record<string, string> = {};
  for (const key of [
    "x-ghl-signature",
    "x-webhook-signature",
    "content-type",
    "user-agent",
  ]) {
    const value = headers.get(key);
    if (value) captured[key] = value;
  }
  if (headers.get("authorization")) {
    captured.authorization = "[redacted]";
  }
  return captured;
}

export function ghlOpportunityIdempotencyKey(opportunityId: string): string {
  return `ghl-opportunity-won-${opportunityId}`;
}
