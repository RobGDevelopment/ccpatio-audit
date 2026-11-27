/**
 * GET  /api/katana/showroom-inventory — curated sales projection by default (&lt;300ms Hub).
 *      ?mode=ops|raw — full per-warehouse ops dump.
 * POST /api/katana/showroom-inventory — Sync Live from Katana → refresh Hub snapshot.
 *
 * Dual auth: `x-ccpatio-embed-token` header OR `ccpatio-embed-auth` cookie.
 * Never reads/writes the ecommerce listing table.
 */
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { authorizeEmbedRequest } from "@/server/showroom/embed-route-auth";
import {
  awaitShowroomSyncUnderLock,
  readShowroomSnapshotFromHub,
} from "@/server/stock/showroom-snapshot";
import { matchesTypeFilter } from "@/server/stock/katana-inventory";
import { loadShowroomSalesInventory } from "@/server/showroom/stock";
import type { ShowroomSalesTab } from "@/server/showroom/sales-projection";
import { SHOWROOM_SALES_TABS } from "@/server/showroom/sales-projection";
import {
  resolveHubSyncBadge,
  sanitizeShowroomSyncWarning,
} from "@/server/stock/hub-sync-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toOpsPayload(hub: Awaited<ReturnType<typeof readShowroomSnapshotFromHub>>) {
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
    mode: "ops" as const,
  };
}

export async function GET(request: Request) {
  if (!(await authorizeEmbedRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized embed session." }, { status: 401 });
  }

  const started = Date.now();
  try {
    const url = new URL(request.url);
    const mode = (url.searchParams.get("mode") ?? "sales").toLowerCase();
    if (mode === "ops" || mode === "raw") {
      const hub = await readShowroomSnapshotFromHub();
      const typeFilter = url.searchParams.get("typeFilter") ?? "all";
      const filter =
        typeFilter === "finished" ||
        typeFilter === "fabrics_powders" ||
        typeFilter === "subassemblies_materials"
          ? typeFilter
          : "all";
      const rows = hub.rows.filter((row) => matchesTypeFilter(row.itemType, filter));
      return NextResponse.json({
        ...toOpsPayload({ ...hub, rows }),
        elapsedMs: Date.now() - started,
      });
    }

    const tabParam = url.searchParams.get("tab");
    const tab =
      tabParam && (SHOWROOM_SALES_TABS as readonly string[]).includes(tabParam)
        ? (tabParam as ShowroomSalesTab)
        : null;
    const inStockOnly = url.searchParams.get("inStockOnly") !== "false";
    const query = url.searchParams.get("q") ?? undefined;

    const sales = await loadShowroomSalesInventory({ tab, inStockOnly, query });
    if (!sales.ok) {
      return NextResponse.json(
        { ok: false, error: sales.error, elapsedMs: sales.elapsedMs },
        { status: 500 },
      );
    }

    const metCount = sales.cards.filter((c) => c.sku.toUpperCase().startsWith("MET-")).length;
    return NextResponse.json({
      ok: true,
      mode: "sales",
      items: sales.cards,
      rows: sales.cards,
      cards: sales.cards,
      lastSyncedAt: sales.syncedAt,
      syncedAt: sales.syncedAt,
      stale: sales.stale,
      error: sales.warning,
      warning: sales.warning,
      rowCount: sales.cards.length,
      metSkuCount: metCount,
      activeHoldCount: sales.cards.filter((c) => c.heldQty > 0).length,
      elapsedMs: sales.elapsedMs,
      badge: sales.badge,
      backgroundSyncQueued: sales.backgroundSyncQueued,
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
    // Awaited inbound GET under short lock — concurrent viewers share one pull.
    // (Fire-and-forget on serverless previously froze last_synced_at.)
    const result = await awaitShowroomSyncUnderLock({
      priority: true,
      reason: "showroom-inventory-post",
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
    revalidatePath("/embed/ops-inventory");
    revalidatePath("/admin/ops-inventory");
    revalidatePath("/showroom");
    return NextResponse.json({
      ...toOpsPayload(result.hub),
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
