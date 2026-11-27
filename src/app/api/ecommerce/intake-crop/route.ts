import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAssetStudioRequest } from "@/server/assets/asset-studio-auth";
import { applyIntakeCropFromCloud } from "@/server/ecommerce/apply-intake-crop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Cloud master fetch + sharp 2048 encode can exceed default serverless windows. */
export const maxDuration = 60;

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

const bodySchema = z.object({
  id: z.string().uuid(),
  cropX: z.number().finite().nonnegative(),
  cropY: z.number().finite().nonnegative(),
  cropSidePx: z.number().finite().positive().min(64),
  sourceWidth: z.number().finite().positive(),
  sourceHeight: z.number().finite().positive(),
  token: z.string().optional(),
});

/**
 * POST /api/ecommerce/intake-crop
 * Cloud-backed Apply Crop for Tab 1 Intake Studio (works on Vercel — no C:\Workspace reads).
 * Auth: GHL embed token/cookie OR PrimeView partner token (authenticateAssetStudioRequest).
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

  const validated = bodySchema.safeParse(body);
  if (!validated.success) {
    return bad(400, validated.error.issues[0]?.message ?? "Invalid crop body");
  }

  try {
    const result = await applyIntakeCropFromCloud(validated.data);
    if (!result.ok) return bad(400, result.error);
    return NextResponse.json({
      ok: true,
      view: result.view,
      source: result.source,
      actor: auth.actor,
      message: "Applied 2048×2048 square crop ✓",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Crop failed";
    return bad(502, message);
  }
}
