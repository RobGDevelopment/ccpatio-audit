/**
 * Legacy alias → Hub-backed showroom inventory (same handlers as
 * /api/katana/showroom-inventory). Kept so older clients keep working.
 */
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import {
  awaitShowroomSyncUnderLock,
  readShowroomSnapshotFromHub,
} from "@/server/stock/showroom-snapshot";
import { matchesTypeFilter } from "@/server/stock/katana-inventory";
import {
  resolveHubSyncBadge,
  sanitizeShowroomSyncWarning,
} from "@/server/stock/hub-sync-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toPayload(hub: Awaited<ReturnType<typeof readShowroomSnapshotFromHub>>) {
  const badge = resolveHubSyncBadge(hub.lastSyncedAt);
  const warning = sanitizeShowroomSyncWarning(hub.error);
  return {
    ok: true as const,
    items: hub.rows,
    rows: hub.rows,
    lastSyncedAt: hub.lastSyncedAt,
    syncedAt: hub.lastSyncedAt,
    stale: badge.tone !== "green",
    error: warning,
    warning,
    rowCount: hub.rowCount,
    badge,
  };
}

export async function GET(request: Request) {
  if (!(await authorizeEmbedRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  const started = Date.now();
  try {
    const hub = await readShowroomSnapshotFromHub();
    const typeFilter = new URL(request.url).searchParams.get("typeFilter") ?? "all";
    const filter =
      typeFilter === "finished" ||
      typeFilter === "fabrics_powders" ||
      typeFilter === "subassemblies_materials"
        ? typeFilter
        : "all";
    const rows = hub.rows.filter((row) => matchesTypeFilter(row.itemType, filter));
    return NextResponse.json({
      ...toPayload({ ...hub, rows }),
      elapsedMs: Date.now() - started,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read Hub inventory snapshot.";
    return NextResponse.json(
      { ok: false, error: sanitizeShowroomSyncWarning(message) ?? "Could not read Hub inventory snapshot." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await authorizeEmbedRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  try {
    const result = await awaitShowroomSyncUnderLock({
      priority: true,
      reason: "embed-katana-inventory-post",
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            sanitizeShowroomSyncWarning(result.error) ?? "Could not sync Katana inventory.",
        },
        { status: 502 },
      );
    }
    revalidatePath("/embed/showroom");
    revalidatePath("/showroom");
    return NextResponse.json({
      ...toPayload(result.hub),
      backgroundSyncQueued: false,
      syncStatus: result.reason,
      syncedItemsCount: result.hub.rowCount,
      claimed: result.claimed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not sync Katana inventory.";
    return NextResponse.json(
      { ok: false, error: sanitizeShowroomSyncWarning(message) ?? "Could not sync inventory." },
      { status: 502 },
    );
  }
}
