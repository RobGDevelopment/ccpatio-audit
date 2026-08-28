/**
 * POST /api/webhooks/woocommerce
 *
 * 1. HMAC (x-wc-webhook-signature) — 401 on failure
 * 2. Zod parseWooOrderWebhook
 * 3. Invalid → quarantine + 202 (no Woo retry storm, no Katana)
 * 4. Valid → Inngest woo.order.validated + 200
 *
 * Node runtime: Postgres + HMAC. Do not run this on Edge.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { quarantined_orders } from "@/server/db/schema";
import { inngest } from "@/server/inngest/client";
import { parseWooOrderWebhook } from "@/server/woocommerce/ingress.schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyWooHmac(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const given = header.trim();
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function peekExternalId(parsedJson: unknown): string {
  if (parsedJson && typeof parsedJson === "object" && "id" in parsedJson) {
    const id = (parsedJson as { id: unknown }).id;
    if (id !== null && id !== undefined && String(id).length > 0) {
      return String(id);
    }
  }
  return "unparseable";
}

export async function POST(req: Request) {
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const signature = req.headers.get("x-wc-webhook-signature");

  if (!verifyWooHmac(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown = null;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    parsedJson = { _unparseable: true, raw: rawBody.slice(0, 2000) };
  }

  const parsed = parseWooOrderWebhook(parsedJson);

  if (!parsed.ok) {
    try {
      await getDb().insert(quarantined_orders).values({
        source: "woocommerce",
        external_id: peekExternalId(parsedJson),
        raw_payload: parsedJson as object,
        issues: parsed.issues,
        status: "pending_review",
      });
    } catch (error) {
      console.error("quarantine insert failed", error);
      return NextResponse.json({ error: "quarantine_unavailable" }, { status: 503 });
    }

    return NextResponse.json(
      { accepted: true, quarantined: true, issues: parsed.issues },
      { status: 202 },
    );
  }

  try {
    await inngest.send({
      name: "woo.order.validated",
      data: parsed.data,
      id: `woo-order-${parsed.data.id}`,
    });
  } catch (error) {
    console.error("inngest send failed", error);
    return NextResponse.json({ error: "enqueue_unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { accepted: true, quarantined: false },
    { status: 200 },
  );
}
