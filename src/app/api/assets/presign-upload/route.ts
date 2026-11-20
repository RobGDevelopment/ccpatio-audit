import { NextResponse } from "next/server";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { planPresignedUpload } from "@/server/assets/presign-policy";
import { resolveFinishSubject, resolveListing3dTarget } from "@/server/assets/finish-assets";
import { createSignedUploadUrlUpsert, getPublicObjectUrl } from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * POST /api/assets/presign-upload
 * Body: { kind, sku?, woo_sku?, slot, filename, contentType, byteSize, token? }
 * Returns a server-keyed signed upload URL: { signedUrl, token, bucket, path, publicUrl }.
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
    return bad(400, "Invalid JSON body");
  }

  const auth = await authenticateAssetStudioRequest(request, {
    bodyToken: typeof body.token === "string" ? body.token : null,
  });
  if (!auth.ok) return bad(auth.status, auth.reason);

  const plan = planPresignedUpload({
    kind: body.kind,
    sku: body.sku,
    woo_sku: body.woo_sku,
    slot: body.slot,
    filename: body.filename,
    contentType: body.contentType,
    byteSize: body.byteSize,
  });
  if (!plan.ok) return bad(plan.status, plan.reason);

  try {
    if (plan.kind === "finish_swatch") {
      const subject = await resolveFinishSubject(String(body.sku));
      if (!subject) return bad(404, `Unknown finish SKU ${String(body.sku)}`);
    } else {
      const target = await resolveListing3dTarget({
        woo_sku: typeof body.woo_sku === "string" ? body.woo_sku : null,
        sku: typeof body.sku === "string" ? body.sku : null,
      });
      if (!target.ok) return bad(target.status, target.reason);
    }

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
