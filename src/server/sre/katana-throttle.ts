/**
 * Phase 9 Task 5 — Katana throttle (<= 1 req/s, cross-instance).
 *
 * Katana is a single live tenant with no sandbox. Three layers, outermost first:
 *  1. Inngest concurrency key `KATANA_TENANT_CONCURRENCY`: at most ONE Katana-calling
 *     function step runs at a time across the whole env (works across serverless instances).
 *  2. This module's Postgres token bucket: the cross-instance 1 req/s guard for every
 *     `katanaFetch`, including requests made outside Inngest (server actions, scripts).
 *  3. The in-process pacer (`setKatanaRequestPacer`): per-serverless-instance only, so it
 *     cannot be the sole guard. CLI scripts install their own interval pacer; a pacer set
 *     explicitly ALWAYS wins over the shared bucket.
 */
import { KatanaApiError } from "@/lib/katana";
import { sendOhCrapAlert } from "@/server/alerts/oh-crap";
import { getDb } from "@/server/db/client";
import { acquireToken } from "@/server/sre/token-bucket";

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
export const KATANA_BUCKET_CAPACITY = 1;
export const KATANA_BUCKET_RATE_PER_SEC = 1;
export const KATANA_BUCKET_MAX_WAIT_MS = 30_000;

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
    try {
      await acquire({
        db: resolveDb(),
        key: KATANA_BUCKET_KEY,
        capacity: KATANA_BUCKET_CAPACITY,
        ratePerSec: KATANA_BUCKET_RATE_PER_SEC,
        maxWaitMs: KATANA_BUCKET_MAX_WAIT_MS,
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
