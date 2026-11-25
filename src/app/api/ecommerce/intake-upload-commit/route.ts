import { NextResponse } from "next/server";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { getPublicObjectUrl, getStorageObjectInfo } from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * POST /api/ecommerce/intake-upload-commit
 * Verifies the object landed in Storage and returns the public CDN URL + size.
 * Client supplies sha256 (Web Crypto) for provenance.
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

  const bucket = typeof body.bucket === "string" ? body.bucket : "";
  const objectPath = typeof body.path === "string" ? body.path : "";
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : null;
  if (!bucket || !objectPath) return bad(400, "bucket and path required");
  if (!objectPath.startsWith("intake/")) {
    return bad(400, "path must be under intake/");
  }

  try {
    const info = await getStorageObjectInfo(bucket, objectPath);
    if (!info) return bad(404, "Uploaded object not found in storage");
    const publicUrl = getPublicObjectUrl(bucket, objectPath);
    const bust = sha256 ? `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${sha256.slice(0, 8)}` : publicUrl;
    return NextResponse.json({
      ok: true,
      bucket,
      path: objectPath,
      publicUrl: bust,
      byteSize: info.size ?? null,
      contentType: info.contentType ?? null,
      sha256,
      actor: auth.actor,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Commit failed";
    return bad(502, message);
  }
}
