/**
 * Hub inventory sync freshness + operator-facing badge copy for Current Inventory.
 */

export const HUB_SYNC_FRESH_MS = 30 * 60 * 1000;
export const HUB_SYNC_STALE_MS = 2 * 60 * 60 * 1000;

export type HubSyncBadgeTone = "green" | "amber" | "red";

export type HubSyncBadge = {
  tone: HubSyncBadgeTone;
  ageMs: number;
  label: string;
  /** Short status line shown beside / instead of raw timestamps when not green. */
  statusLabel: string;
  showRefreshButton: boolean;
  /** True when a background sync should be (re)queued. */
  shouldQueueBackgroundSync: boolean;
};

export function hubSyncAgeMs(
  lastSyncedAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (lastSyncedAt == null) return Number.POSITIVE_INFINITY;
  const ms =
    typeof lastSyncedAt === "number"
      ? lastSyncedAt
      : new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - ms);
}

export function resolveHubSyncBadge(
  lastSyncedAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): HubSyncBadge {
  const ageMs = hubSyncAgeMs(lastSyncedAt, nowMs);
  if (ageMs < HUB_SYNC_FRESH_MS) {
    return {
      tone: "green",
      ageMs,
      label: "Hub synced",
      statusLabel: "Fresh",
      showRefreshButton: false,
      shouldQueueBackgroundSync: false,
    };
  }
  if (ageMs <= HUB_SYNC_STALE_MS) {
    return {
      tone: "amber",
      ageMs,
      label: "Hub synced",
      statusLabel: "Refreshing in background…",
      showRefreshButton: false,
      shouldQueueBackgroundSync: true,
    };
  }
  return {
    tone: "red",
    ageMs,
    label: "Hub synced",
    statusLabel: "Snapshot Stale — Background Sync Queued",
    showRefreshButton: true,
    shouldQueueBackgroundSync: true,
  };
}

const RATE_LIMIT_LEAK_RE =
  /rate-limit bucket|no token available after|Deferring\.|Katana API rate limit|RATE_LIMIT/i;

/** Strip developer / throttle strings so sales reps never see raw deferral errors. */
export function sanitizeShowroomSyncWarning(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (RATE_LIMIT_LEAK_RE.test(trimmed)) return null;
  return trimmed;
}
