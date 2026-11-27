/**
 * Direct awaited inbound Katana → Hub inventory pull for Executive CTAs.
 * Inbound GET only — never gated by DOWNSTREAM_MUTATIONS.
 */
import { NextResponse } from "next/server";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import {
  resetBucketAndSyncKatanaNow,
  syncKatanaInventoryNow,
} from "@/server/stock/showroom-snapshot";
import { runWithKatanaPriorityLane } from "@/lib/katana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!(await authorizeEmbedRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  let resetBucket = false;
  try {
    const body = (await request.json().catch(() => ({}))) as { resetBucket?: boolean };
    resetBucket = body.resetBucket === true;
  } catch {
    resetBucket = false;
  }

  const result = await runWithKatanaPriorityLane(() =>
    resetBucket
      ? resetBucketAndSyncKatanaNow({ resetBucket: true })
      : syncKatanaInventoryNow(),
  );

  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    syncedItemsCount: result.syncedItemsCount,
    lastSyncedAt: result.lastSyncedAt,
    durationMs: result.durationMs,
    message: result.message,
    clearedKeys: result.clearedKeys,
  });
}
