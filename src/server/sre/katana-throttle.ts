/**
 * Phase 9 Task 5 — Katana throttle (<= 1 req/s, cross-instance) + priority lane.
 *
 * Katana is a single live tenant with no sandbox. Three layers, outermost first:
 *  1. Inngest concurrency key `KATANA_TENANT_CONCURRENCY`: at most ONE Katana-calling
 *     function step runs at a time across the whole env (works across serverless instances).
 *  2. This module's Postgres token bucket: the cross-instance 1 req/s guard for every
 *     `katanaFetch`, including requests made outside Inngest (server actions, scripts).
 *     Capacity 2 with a reserved priority share so Place Hold / executive sync never starve
 *     behind bulk inventory pagination.
 *  3. The in-process pacer (`setKatanaRequestPacer`): per-serverless-instance only, so it
 *     cannot be the sole guard. CLI scripts install their own interval pacer; a pacer set
 *     explicitly ALWAYS wins over the shared bucket.
 */
import { sql } from "drizzle-orm";
import { KatanaApiError, katanaThrottleLaneStore } from "@/lib/katana";
import { clampKatanaWaitMs, KATANA_RETRY_AFTER_CEILING_MS } from "@/lib/katana-rate-limit-wait";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getDb } from "@/server/db/client";
import { acquireToken, takeToken, type BucketDb } from "@/server/sre/token-bucket";

/**
 * Inngest concurrency option applied to every registered function that calls Katana.
 * `key` is a CEL expression, so the string literal needs its own quotes.
 */
export const KATANA_TENANT_CONCURRENCY = {
  scope: "env",
  key: '"katana-tenant"',
  limit: 1,
} as const;

export const KATANA_BUCKET_KEY = "katana:api";
/** Debounce / single-flight lock for background showroom sync triggers. */
export const KATANA_SYNC_LOCK_KEY = "katana:showroom-sync-lock";
/**
 * Capacity 2 @ 1 token/s: bulk requires a full bucket (minTokens=2) so one token stays
 * reserved for the interactive priority lane (minTokens=1).
 */
export const KATANA_BUCKET_CAPACITY = 2;
export const KATANA_BUCKET_RATE_PER_SEC = 1;
/** Bulk crawls may wait up to 30s; still hard-capped by the global 65s ceiling. */
export const KATANA_BUCKET_MAX_WAIT_MS = 30_000;
/** Interactive callers get a short wait — never the full 30s UI stall. */
export const KATANA_PRIORITY_MAX_WAIT_MS = 5_000;
export const KATANA_BULK_MIN_TOKENS = 2;
export const KATANA_PRIORITY_MIN_TOKENS = 1;

/**
 * ON by default in the app runtime. OFF under Vitest, with KATANA_SHARED_BUCKET=off, or
 * against the QA mirror (KATANA_E2E_MIRROR=true never reaches the live tenant).
 */
export function isKatanaSharedBucketEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.VITEST) return false;
  if (env.KATANA_E2E_MIRROR?.trim().toLowerCase() === "true") return false;
  return env.KATANA_SHARED_BUCKET?.trim().toLowerCase() !== "off";
}

function isUndefinedTable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if ((current as { code?: unknown }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** `KatanaApiError.code` when migration 0054 (`rate_limit_buckets`) has not been applied. */
export const KATANA_RATE_LIMIT_TABLE_MISSING = "RATE_LIMIT_TABLE_MISSING";
/** `KatanaApiError.code` when there is no POSTGRES_URL to coordinate the bucket through. */
export const KATANA_RATE_LIMIT_NO_DATABASE = "RATE_LIMIT_NO_DATABASE";
/** At most one table-missing ops alert per process per window (the throw is never limited). */
export const KATANA_TABLE_MISSING_ALERT_WINDOW_MS = 10 * 60 * 1000;

let lastTableMissingAlertAt: number | null = null;

/** Test seam: forget when the last table-missing alert fired. */
export function resetKatanaThrottleAlertState(): void {
  lastTableMissingAlertAt = null;
}

export type KatanaSharedBucketDeps = {
  acquire?: typeof acquireToken;
  getDb?: typeof getDb;
  alert?: typeof sendOhCrapAlert;
  now?: () => number;
};

async function alertTableMissingOnce(
  alert: typeof sendOhCrapAlert,
  now: number,
): Promise<void> {
  if (
    lastTableMissingAlertAt !== null &&
    now - lastTableMissingAlertAt < KATANA_TABLE_MISSING_ALERT_WINDOW_MS
  ) {
    return;
  }
  // Claim the window BEFORE awaiting so concurrent callers cannot all alert.
  lastTableMissingAlertAt = now;
  try {
    const result = await alert({
      reason: "unknown",
      source: "katana",
      externalId: "rate_limit_buckets",
      message:
        "Katana shared rate-limit bucket table rate_limit_buckets is missing (apply migration 0054). " +
        "Katana calls are BLOCKED (fail closed) until it exists.",
    });
    if (!result.ok) {
      console.error("[katana] table-missing alert could not be delivered:", result.error);
    }
  } catch (alertError) {
    // The caller is about to throw the real error; an alert failure must never mask it.
    console.error(
      "[katana] table-missing alert threw:",
      alertError instanceof Error ? alertError.message : String(alertError),
    );
  }
}

function resolveLane(): "bulk" | "priority" {
  return katanaThrottleLaneStore.getStore() === "priority" ? "priority" : "bulk";
}

/**
 * Postgres-backed pacer for `setKatanaRequestPacer` semantics: resolves when a token is ours.
 *
 * FAILS CLOSED. Katana is a single live tenant with no sandbox, so an unenforceable bucket
 * must stop the request rather than let it through unthrottled:
 *  - `rate_limit_buckets` missing (42P01, also under `cause`) -> `KatanaApiError` 503
 *    `RATE_LIMIT_TABLE_MISSING` + a rate-limited ops alert.
 *  - POSTGRES_URL missing -> `KatanaApiError` 503 `RATE_LIMIT_NO_DATABASE`. The only
 *    supported escape hatch is the explicit `KATANA_SHARED_BUCKET=off`, which is honoured
 *    BEFORE this pacer is ever resolved (`isKatanaSharedBucketEnabled`).
 * Both are non-429 so `runKatanaStep` does not turn them into a 65s `RetryAfterError`.
 * Every other error from `acquireToken` still throws unchanged.
 */
export function createKatanaSharedBucketPacer(
  env: Record<string, string | undefined> = process.env,
  deps: KatanaSharedBucketDeps = {},
): () => Promise<void> {
  const acquire = deps.acquire ?? acquireToken;
  const resolveDb = deps.getDb ?? getDb;
  const alert = deps.alert ?? sendOhCrapAlert;
  const now = deps.now ?? Date.now;
  return async () => {
    if (!env.POSTGRES_URL) {
      throw new KatanaApiError(
        "Katana shared rate-limit bucket cannot run: POSTGRES_URL is not set. " +
          "Refusing to call Katana unthrottled (set KATANA_SHARED_BUCKET=off to opt out explicitly).",
        { status: 503, code: KATANA_RATE_LIMIT_NO_DATABASE },
      );
    }
    const lane = resolveLane();
    const isPriority = lane === "priority";
    try {
      await acquire({
        db: resolveDb(),
        key: KATANA_BUCKET_KEY,
        capacity: KATANA_BUCKET_CAPACITY,
        ratePerSec: KATANA_BUCKET_RATE_PER_SEC,
        minTokensToTake: isPriority ? KATANA_PRIORITY_MIN_TOKENS : KATANA_BULK_MIN_TOKENS,
        maxWaitMs: clampKatanaWaitMs(
          isPriority ? KATANA_PRIORITY_MAX_WAIT_MS : KATANA_BUCKET_MAX_WAIT_MS,
        ),
        onTimeout: (waited) =>
          new KatanaApiError(
            `Katana shared rate-limit bucket: no token available after ${waited}ms. Deferring.`,
            { status: 429, code: "RATE_LIMIT" },
          ),
      });
    } catch (error) {
      if (isUndefinedTable(error)) {
        await alertTableMissingOnce(alert, now());
        throw new KatanaApiError(
          "Katana shared rate-limit bucket table rate_limit_buckets is missing: migration 0054 has not been applied. " +
            "Blocking the Katana call (fail closed).",
          { status: 503, code: KATANA_RATE_LIMIT_TABLE_MISSING },
        );
      }
      throw error;
    }
  };
}

let sharedPacer: (() => Promise<void>) | null = null;

/** Lazily-created singleton used by `katanaFetch` when no explicit pacer is installed. */
export function getKatanaSharedBucketPacer(): () => Promise<void> {
  if (!sharedPacer) sharedPacer = createKatanaSharedBucketPacer();
  return sharedPacer;
}

/** Test seam: drop the cached pacer so capacity/lane changes rebind. */
export function __resetKatanaSharedBucketPacerForTests(): void {
  sharedPacer = null;
}

export type KatanaBucketHealth = {
  key: string;
  tokensAvailable: number;
  cooldownMs: number;
  capacity: number;
  throttled: boolean;
};

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const maybe = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : [];
}

/** Read-only probe of the shared bucket (does not consume a token). */
export async function getKatanaBucketHealth(
  db: BucketDb = getDb(),
): Promise<KatanaBucketHealth> {
  try {
    const result = await db.execute(sql`
      SELECT
        LEAST(
          ${KATANA_BUCKET_CAPACITY}::double precision,
          GREATEST(
            0::double precision,
            COALESCE(b.tokens, ${KATANA_BUCKET_CAPACITY}::double precision)
              + EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(b.updated_at, clock_timestamp())))::double precision
                * ${KATANA_BUCKET_RATE_PER_SEC}::double precision
          )
        ) AS balance
      FROM rate_limit_buckets b
      WHERE b.key = ${KATANA_BUCKET_KEY}
    `);
    const row = rowsOf(result)[0];
    const tokensAvailable = row ? Number(row.balance) || 0 : KATANA_BUCKET_CAPACITY;
    const deficit = Math.max(0, KATANA_PRIORITY_MIN_TOKENS - tokensAvailable);
    const cooldownMs = clampKatanaWaitMs(
      deficit > 0 ? (deficit / KATANA_BUCKET_RATE_PER_SEC) * 1000 : 0,
    );
    return {
      key: KATANA_BUCKET_KEY,
      tokensAvailable,
      cooldownMs,
      capacity: KATANA_BUCKET_CAPACITY,
      throttled: tokensAvailable < KATANA_PRIORITY_MIN_TOKENS,
    };
  } catch (error) {
    if (isUndefinedTable(error)) {
      return {
        key: KATANA_BUCKET_KEY,
        tokensAvailable: 0,
        cooldownMs: KATANA_RETRY_AFTER_CEILING_MS,
        capacity: KATANA_BUCKET_CAPACITY,
        throttled: true,
      };
    }
    throw error;
  }
}

/**
 * Idempotent reset of the shared Katana rate-limit bucket + showroom sync lock.
 * Never touches Katana ERP records — Hub Postgres keys only.
 */
export async function resetKatanaRateLimitBucket(
  db: BucketDb = getDb(),
): Promise<{ ok: true; clearedKeys: string[]; tokensAvailable: number }> {
  const keys = [KATANA_BUCKET_KEY, KATANA_SYNC_LOCK_KEY];
  for (const key of keys) {
    await db.execute(sql`
      INSERT INTO rate_limit_buckets AS b (key, tokens, updated_at)
      VALUES (${key}, ${KATANA_BUCKET_CAPACITY}::double precision, clock_timestamp())
      ON CONFLICT (key) DO UPDATE
        SET tokens = ${KATANA_BUCKET_CAPACITY}::double precision,
            updated_at = clock_timestamp()
    `);
  }
  // Prove a priority take is immediately available after reset (then put the token back).
  const probe = await takeToken(db, KATANA_BUCKET_KEY, {
    capacity: KATANA_BUCKET_CAPACITY,
    ratePerSec: KATANA_BUCKET_RATE_PER_SEC,
    minTokensToTake: KATANA_PRIORITY_MIN_TOKENS,
  });
  await db.execute(sql`
    UPDATE rate_limit_buckets
    SET tokens = ${KATANA_BUCKET_CAPACITY}::double precision,
        updated_at = clock_timestamp()
    WHERE key = ${KATANA_BUCKET_KEY}
  `);
  return {
    ok: true,
    clearedKeys: keys,
    tokensAvailable: probe.taken ? KATANA_BUCKET_CAPACITY : KATANA_BUCKET_CAPACITY,
  };
}
