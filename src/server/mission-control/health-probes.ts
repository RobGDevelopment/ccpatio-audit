/**
 * Mission Control system matrix: QuickBooks, GoHighLevel, Katana and the Inngest dead-letter
 * queue on top, then the commerce channels (WordPress, WooCommerce, Clover).
 *
 * Everything here is READ-ONLY.
 *  - QuickBooks is judged from our own tables (token row + saga ledger). Intuit is never called,
 *    so a dashboard refresh cannot rotate a refresh token or touch the books.
 *  - GoHighLevel gets one GET on the location record.
 *  - The DLQ lamp is a count of open `dlq_events`. It is a gauge, not a DLQ browser: there is no
 *    list of events and no redrive.
 * A probe that throws becomes an amber lamp with a log reference. One dead probe never blanks
 * the board.
 */
import { eq, sql } from "drizzle-orm";
import { logError } from "@/lib/log/structured";
import { getDb } from "@/server/db/client";
import { dlq_events, qbo_auth_tokens, saga_runs } from "@/server/db/schema";
import { runSpokeTokenHealthCheck, type SpokePingResult } from "@/server/mdm/token-health";
import {
  deriveTrafficMatrix,
  readChannelSyncCounts,
  type LampColor,
  type SyncCountRow,
} from "@/server/mission-control/sync-matrix";

export type SystemLampId =
  | "qbo"
  | "ghl"
  | "katana"
  | "dlq"
  | "wordpress"
  | "woocommerce"
  | "clover";

export type SystemLamp = {
  id: SystemLampId;
  group: "core" | "channels";
  label: string;
  lamp: LampColor;
  detail: string;
};

type Verdict = { lamp: LampColor; detail: string };

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// QuickBooks (database only)
// ---------------------------------------------------------------------------

export type QboSnapshot = {
  hasTokenRow: boolean;
  hasRefreshToken: boolean;
  accessExpiresAt: Date | null;
  failedSagas: number;
};

/** Intuit refresh tokens lapse after 100 days without use; the access-token expiry marks last use. */
export const QBO_IDLE_AMBER_DAYS = 60;
export const QBO_IDLE_RED_DAYS = 90;

export function deriveQboVerdict(snapshot: QboSnapshot, now: Date): Verdict {
  if (!snapshot.hasTokenRow || !snapshot.hasRefreshToken) {
    return { lamp: "red", detail: "Not connected. Reconnect QuickBooks." };
  }
  if (snapshot.failedSagas > 0) {
    return {
      lamp: "red",
      detail: `${snapshot.failedSagas} ledger ${snapshot.failedSagas === 1 ? "saga needs" : "sagas need"} manual intervention.`,
    };
  }
  if (!snapshot.accessExpiresAt) {
    return { lamp: "amber", detail: "Connected. Token expiry unknown." };
  }
  const idleDays = Math.floor((now.getTime() - snapshot.accessExpiresAt.getTime()) / DAY_MS);
  if (idleDays >= QBO_IDLE_RED_DAYS) {
    return {
      lamp: "red",
      detail: `No QuickBooks activity for ${idleDays} days. The refresh token lapses at 100.`,
    };
  }
  if (idleDays >= QBO_IDLE_AMBER_DAYS) {
    return {
      lamp: "amber",
      detail: `No QuickBooks activity for ${idleDays} days. The refresh token lapses at 100.`,
    };
  }
  return { lamp: "green", detail: "Connected. Ledger sagas clear." };
}

export async function readQboSnapshot(): Promise<QboSnapshot> {
  const db = getDb();
  const [token] = await db
    .select({
      hasRefresh: sql<boolean>`coalesce(length(${qbo_auth_tokens.refresh_token}) > 0, false)`,
      expiresAt: qbo_auth_tokens.expires_at,
    })
    .from(qbo_auth_tokens)
    .limit(1);
  const [failed] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(saga_runs)
    .where(eq(saga_runs.status, "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"));
  return {
    hasTokenRow: Boolean(token),
    hasRefreshToken: Boolean(token?.hasRefresh),
    accessExpiresAt: token?.expiresAt ?? null,
    failedSagas: Number(failed?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// GoHighLevel (one read-only GET)
// ---------------------------------------------------------------------------

export type GhlPing = {
  configured: boolean;
  ok: boolean;
  status: number | null;
  authFailed: boolean;
};

export function deriveGhlVerdict(ping: GhlPing): Verdict {
  if (!ping.configured) {
    return { lamp: "red", detail: "Private integration is not configured." };
  }
  if (ping.authFailed) {
    return { lamp: "red", detail: `Token rejected (HTTP ${ping.status}). Rotate the integration token.` };
  }
  if (ping.ok) return { lamp: "green", detail: "Connected." };
  if (ping.status === null) return { lamp: "amber", detail: "GoHighLevel did not answer." };
  return { lamp: "amber", detail: `GoHighLevel returned HTTP ${ping.status}.` };
}

export async function pingGhl(
  doFetch: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<GhlPing> {
  const token = env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim() ?? "";
  const locationId = env.GHL_LOCATION_ID?.trim() ?? "";
  if (!token || !locationId) {
    return { configured: false, ok: false, status: null, authFailed: false };
  }
  try {
    const response = await doFetch(
      `https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    return {
      configured: true,
      ok: response.ok,
      status: response.status,
      authFailed: response.status === 401 || response.status === 403,
    };
  } catch (error) {
    logError("mission-control-ghl-ping-failed", error);
    return { configured: true, ok: false, status: null, authFailed: false };
  }
}

// ---------------------------------------------------------------------------
// Inngest dead-letter queue (counts only)
// ---------------------------------------------------------------------------

export type DlqSnapshot = {
  open: number;
  /** Open rows whose Oh-Crap alert never went out. Nobody has been told. */
  unalerted: number;
  oldestOpenAt: Date | null;
};

export const DLQ_RED_OPEN_THRESHOLD = 10;

export function deriveDlqVerdict(snapshot: DlqSnapshot, now: Date): Verdict {
  if (snapshot.open === 0) return { lamp: "green", detail: "Queue empty." };
  const age =
    snapshot.oldestOpenAt === null
      ? ""
      : `, oldest ${Math.max(0, Math.floor((now.getTime() - snapshot.oldestOpenAt.getTime()) / DAY_MS))}d`;
  if (snapshot.unalerted > 0) {
    return {
      lamp: "red",
      detail: `${snapshot.open} open, ${snapshot.unalerted} without an alert sent${age}.`,
    };
  }
  if (snapshot.open >= DLQ_RED_OPEN_THRESHOLD) {
    return { lamp: "red", detail: `${snapshot.open} open${age}.` };
  }
  return { lamp: "amber", detail: `${snapshot.open} open${age}.` };
}

export async function readDlqSnapshot(): Promise<DlqSnapshot> {
  const db = getDb();
  const [row] = await db
    .select({
      open: sql<number>`cast(count(*) filter (where ${dlq_events.status} = 'open') as int)`,
      unalerted: sql<number>`cast(count(*) filter (where ${dlq_events.status} = 'open' and ${dlq_events.alert_sent} = false) as int)`,
      oldest: sql<Date | null>`min(${dlq_events.created_at}) filter (where ${dlq_events.status} = 'open')`,
    })
    .from(dlq_events);
  return {
    open: Number(row?.open ?? 0),
    unalerted: Number(row?.unalerted ?? 0),
    oldestOpenAt: row?.oldest ? new Date(row.oldest) : null,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type HealthDeps = {
  now: () => Date;
  pingSpokes: () => Promise<SpokePingResult[]>;
  readSyncCounts: () => Promise<SyncCountRow[]>;
  readQbo: () => Promise<QboSnapshot>;
  pingGhl: () => Promise<GhlPing>;
  readDlq: () => Promise<DlqSnapshot>;
};

const defaultDeps: HealthDeps = {
  now: () => new Date(),
  // `silent` is fixed so a dashboard refresh can never raise an alert.
  pingSpokes: async () => (await runSpokeTokenHealthCheck(true)).results,
  readSyncCounts: readChannelSyncCounts,
  readQbo: readQboSnapshot,
  pingGhl: () => pingGhl(),
  readDlq: readDlqSnapshot,
};

type Settled<T> = { ok: true; value: T } | { ok: false; ref: string };

async function settle<T>(probe: string, run: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, ref: logError("mission-control-probe-failed", error, { probe }) };
  }
}

function probeFailed(
  id: SystemLampId,
  group: SystemLamp["group"],
  label: string,
  ref: string,
): SystemLamp {
  return { id, group, label, lamp: "amber", detail: `Probe failed. Reference ${ref}.` };
}

const SPOKE_IDS: Array<{
  spoke: SpokePingResult["spoke"];
  id: SystemLampId;
  group: SystemLamp["group"];
}> = [
  { spoke: "Katana", id: "katana", group: "core" },
  { spoke: "WordPressCore", id: "wordpress", group: "channels" },
  { spoke: "WooCommerce", id: "woocommerce", group: "channels" },
  { spoke: "Clover", id: "clover", group: "channels" },
];

const SPOKE_LABEL: Record<SpokePingResult["spoke"], string> = {
  Katana: "Katana",
  WordPressCore: "WordPress",
  WooCommerce: "WooCommerce",
  Clover: "Clover",
};

export async function readSystemLamps(overrides: Partial<HealthDeps> = {}): Promise<SystemLamp[]> {
  const deps = { ...defaultDeps, ...overrides };
  const now = deps.now();

  const [qbo, ghl, dlq, pings, counts] = await Promise.all([
    settle("qbo", deps.readQbo),
    settle("ghl", deps.pingGhl),
    settle("dlq", deps.readDlq),
    settle("spokes", deps.pingSpokes),
    settle("sync-counts", deps.readSyncCounts),
  ]);

  const lamps: SystemLamp[] = [];

  lamps.push(
    qbo.ok
      ? { id: "qbo", group: "core", label: "QuickBooks", ...deriveQboVerdict(qbo.value, now) }
      : probeFailed("qbo", "core", "QuickBooks", qbo.ref),
  );
  lamps.push(
    ghl.ok
      ? { id: "ghl", group: "core", label: "GoHighLevel", ...deriveGhlVerdict(ghl.value) }
      : probeFailed("ghl", "core", "GoHighLevel", ghl.ref),
  );

  const matrix =
    pings.ok && counts.ok ? deriveTrafficMatrix(pings.value, counts.value) : null;
  const spokeLamp = (spoke: SpokePingResult["spoke"], id: SystemLampId, group: SystemLamp["group"]): SystemLamp => {
    if (matrix) {
      const found = matrix.find((entry) => entry.spoke === spoke);
      if (found) {
        return { id, group, label: found.label, lamp: found.lamp, detail: found.detail };
      }
    }
    const ref = !pings.ok ? pings.ref : !counts.ok ? counts.ref : "unavailable";
    return probeFailed(id, group, SPOKE_LABEL[spoke], ref);
  };

  lamps.push(spokeLamp("Katana", "katana", "core"));
  lamps.push(
    dlq.ok
      ? { id: "dlq", group: "core", label: "Inngest DLQ", ...deriveDlqVerdict(dlq.value, now) }
      : probeFailed("dlq", "core", "Inngest DLQ", dlq.ref),
  );
  for (const entry of SPOKE_IDS.filter((item) => item.group === "channels")) {
    lamps.push(spokeLamp(entry.spoke, entry.id, entry.group));
  }
  return lamps;
}
