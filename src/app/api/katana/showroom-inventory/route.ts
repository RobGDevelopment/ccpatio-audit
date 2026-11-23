/**
 * GET  /api/katana/showroom-inventory — Hub snapshot only (&lt;300ms). Never live Katana.
 * POST /api/katana/showroom-inventory — Sync Live from Katana → refresh Hub snapshot.
 *
 * Dual auth: `x-ccpatio-embed-token` header OR `ccpatio-embed-auth` cookie.
 */
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import {
  readShowroomSnapshotFromHub,
  refreshShowroomSnapshotFromKatana,
} from "@/server/stock/showroom-snapshot";
import { matchesTypeFilter } from "@/server/stock/katana-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toPayload(hub: Awaited<ReturnType<typeof readShowroomSnapshotFromHub>>) {
  return {
    ok: true as const,
    items: hub.rows,
    rows: hub.rows,
    lastSyncedAt: hub.lastSyncedAt,
    syncedAt: hub.lastSyncedAt,
    stale: hub.stale,
    error: hub.error,
    warning: hub.error,
    rowCount: hub.rowCount,
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
    const elapsed = Date.now() - started;
    return NextResponse.json({
      ...toPayload({ ...hub, rows }),
      elapsedMs: elapsed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not read Hub inventory snapshot.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await authorizeEmbedRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  try {
    const hub = await refreshShowroomSnapshotFromKatana({ force: true });
    revalidatePath("/embed/showroom");
    revalidatePath("/showroom");
    return NextResponse.json(toPayload(hub));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not sync Katana inventory.";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
