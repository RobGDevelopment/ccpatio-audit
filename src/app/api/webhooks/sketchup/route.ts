/**
 * POST /api/webhooks/sketchup
 *
 * 1. HMAC `X-CCPatio-Signature` (SKETCHUP_WEBHOOK_SECRET) — 401 on failure
 * 2. Zod `sketchupIngestSchema` — 400 + errors array, no DB write
 * 3. Insert `product_intake` status=quarantined — 202
 * 4. Same `export_id` replay — 200 already accepted
 *
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 1.
 * Node runtime: Postgres + HMAC. Do not run on Edge.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { product_intake } from "@/server/db/schema";
import { parseSketchupIngest } from "@/server/sketchup/ingest.schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signaturesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function verifySketchupHmac(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret?.trim() || !header) return false;

  const given = header.replace(/^sha256=/i, "").trim();
  if (!given) return false;

  const trimmedSecret = secret.trim();
  const hexExpected = createHmac("sha256", trimmedSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const b64Expected = createHmac("sha256", trimmedSecret)
    .update(rawBody, "utf8")
    .digest("base64");

  return (
    signaturesMatch(given, hexExpected) || signaturesMatch(given, b64Expected)
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "23505";
}

export async function POST(req: Request) {
  const secret = process.env.SKETCHUP_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-ccpatio-signature") ??
    req.headers.get("X-CCPatio-Signature");

  if (!verifySketchupHmac(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      {
        errors: [{ path: "(root)", message: "Body must be valid JSON" }],
      },
      { status: 400 },
    );
  }

  const parsed = parseSketchupIngest(parsedJson);
  if (!parsed.ok) {
    return NextResponse.json({ errors: parsed.errors }, { status: 400 });
  }

  const { data } = parsed;
  const db = getDb();

  const existing = await db.query.product_intake.findFirst({
    where: eq(product_intake.export_id, data.export_id),
  });

  if (existing) {
    return NextResponse.json(
      {
        accepted: true,
        already_accepted: true,
        export_id: data.export_id,
        status: existing.status,
      },
      { status: 200 },
    );
  }

  try {
    await db.insert(product_intake).values({
      export_id: data.export_id,
      status: "quarantined",
      raw_payload: parsedJson as Record<string, unknown>,
      zod_issues: null,
      proposed_sku: data.product.proposed_sku ?? null,
      created_by: data.designer_email,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          accepted: true,
          already_accepted: true,
          export_id: data.export_id,
        },
        { status: 200 },
      );
    }
    console.error("[sketchup-webhook] product_intake insert failed", error);
    return NextResponse.json({ error: "intake_unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    {
      accepted: true,
      export_id: data.export_id,
      status: "quarantined",
    },
    { status: 202 },
  );
}
