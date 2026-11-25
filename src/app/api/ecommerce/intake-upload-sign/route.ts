import { NextResponse } from "next/server";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { planIntakeUpload } from "@/server/ecommerce/intake-upload-policy";
import { createSignedUploadUrlUpsert, getPublicObjectUrl } from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * POST /api/ecommerce/intake-upload-sign
 * Direct-to-Supabase signed upload (bypasses Vercel 4.5MB body limit).
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return bad(400, "JSON object body required");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return bad(400, "Invalid JSON");
  }

  const auth = await authenticateAssetStudioRequest(request, {
    bodyToken: typeof body.token === "string" ? body.token : null,
  });
  if (!auth.ok) return bad(auth.status, auth.reason);

  const plan = planIntakeUpload({
    kind: body.kind,
    filename: body.filename,
    contentType: body.contentType,
    byteSize: body.byteSize,
    sku: body.sku,
    woo_sku: body.woo_sku,
  });
  if (!plan.ok) return bad(plan.status, plan.reason);

  try {
    const signed = await createSignedUploadUrlUpsert(plan.bucket, plan.path);
    return NextResponse.json({
      ok: true,
      signedUrl: signed.signedUrl,
      token: signed.token,
      bucket: plan.bucket,
      path: plan.path,
      publicUrl: getPublicObjectUrl(plan.bucket, plan.path),
      contentType: plan.contentType,
      actor: auth.actor,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not create signed upload URL";
    return bad(502, message);
  }
}
