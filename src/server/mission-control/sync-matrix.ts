import { inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { channel_sync } from "@/server/db/schema";
import type { SpokePingResult } from "@/server/mdm/token-health";

/** Catalog spokes that have `channel_sync` rows. WordPress is a core ping only. */
export const CATALOG_CHANNELS = ["katana", "woocommerce", "clover"] as const;

export type CatalogChannel = (typeof CATALOG_CHANNELS)[number];

export type SyncStatusName = "pending" | "success" | "failed";

export type LampColor = "green" | "amber" | "red";

export type SyncCountRow = {
  channel: string;
  status: string;
  count: number;
};

export type StatusCounts = Record<SyncStatusName, number>;

export type TrafficLamp = {
  spoke: SpokePingResult["spoke"];
  label: string;
  lamp: LampColor;
  detail: string;
};

const KNOWN_CHANNELS = new Set<string>(CATALOG_CHANNELS);
const KNOWN_STATUSES = new Set<string>(["pending", "success", "failed"]);

const SPOKES: Array<{
  spoke: SpokePingResult["spoke"];
  label: string;
  channel: CatalogChannel | null;
}> = [
  { spoke: "WordPressCore", label: "WordPress", channel: null },
  { spoke: "Katana", label: "Katana", channel: "katana" },
  { spoke: "WooCommerce", label: "WooCommerce", channel: "woocommerce" },
  { spoke: "Clover", label: "Clover", channel: "clover" },
];

function emptyCounts(): StatusCounts {
  return { pending: 0, success: 0, failed: 0 };
}

/**
 * Fold grouped `channel_sync` counts. Unknown channels and unknown statuses are ignored.
 * This function does not read the network and does not write.
 */
export function foldSyncCounts(rows: readonly SyncCountRow[]): Record<CatalogChannel, StatusCounts> {
  const totals: Record<CatalogChannel, StatusCounts> = {
    katana: emptyCounts(),
    woocommerce: emptyCounts(),
    clover: emptyCounts(),
  };

  for (const row of rows) {
    if (!KNOWN_CHANNELS.has(row.channel) || !KNOWN_STATUSES.has(row.status)) continue;
    const amount = Number(row.count);
    if (!Number.isFinite(amount) || amount < 0) continue;
    totals[row.channel as CatalogChannel][row.status as SyncStatusName] += amount;
  }

  return totals;
}

/**
 * Green: live token and no failed rows.
 * Amber: pending rows, or a ping that is down without an auth failure.
 * Red: authFailed, or any failed row. Red wins over amber.
 */
export function deriveLamp(
  ping: Pick<SpokePingResult, "ok" | "authFailed"> | undefined,
  counts: StatusCounts,
): LampColor {
  const authFailed = ping?.authFailed === true;
  const live = ping?.ok === true && !authFailed;
  if (authFailed || counts.failed > 0) return "red";
  if (counts.pending > 0 || !live) return "amber";
  return "green";
}

/** Status name and count only. Ping detail and row errors stay off this string. */
export function formatStatusCounts(counts: StatusCounts): string {
  return `success ${counts.success}, pending ${counts.pending}, failed ${counts.failed}`;
}

export function deriveTrafficMatrix(
  pings: readonly SpokePingResult[],
  rows: readonly SyncCountRow[],
): TrafficLamp[] {
  const bySpoke = new Map(pings.map((ping) => [ping.spoke, ping]));
  const totals = foldSyncCounts(rows);

  return SPOKES.map((entry) => {
    const counts = entry.channel ? totals[entry.channel] : emptyCounts();
    const lamp = deriveLamp(bySpoke.get(entry.spoke), counts);
    return {
      spoke: entry.spoke,
      label: entry.label,
      lamp,
      detail: entry.channel ? formatStatusCounts(counts) : lamp,
    };
  });
}

/** Read-only grouped counts for the three catalog channels. */
export async function readChannelSyncCounts(): Promise<SyncCountRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      channel: channel_sync.channel,
      status: channel_sync.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(channel_sync)
    .where(inArray(channel_sync.channel, [...CATALOG_CHANNELS]))
    .groupBy(channel_sync.channel, channel_sync.status);

  return rows.map((row) => ({
    channel: row.channel,
    status: row.status,
    count: Number(row.count),
  }));
}
