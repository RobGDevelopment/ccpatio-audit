/**
 * Phase 9 Task 5 — cross-instance token bucket on Postgres.
 *
 * ONE atomic SQL statement decides whether a token is taken, so concurrent callers on
 * different serverless instances cannot both win. Refill is time-based and uses the
 * database clock (`clock_timestamp()`), never the caller's clock, so instance clock skew
 * is irrelevant.
 *
 * Capacity 1 / rate 1 per second means a burst never exceeds 1 request.
 * Priority lanes may require fewer tokens (`minTokensToTake`) so interactive callers can
 * claim a reserved share while bulk crawls wait for a fuller bucket.
 *
 * Only `pg_*_xact_*`-free, session-free SQL: safe on the Supavisor transaction pooler.
 */
import { sql, type SQL } from "drizzle-orm";
import { clampKatanaWaitMs } from "@/lib/katana-rate-limit-wait";

export type BucketDb = {
  execute: (query: SQL) => Promise<unknown>;
};

export type BucketConfig = {
  /** Max tokens stored (burst size). Default 1. */
  capacity?: number;
  /** Refill rate, tokens per second. Default 1. */
  ratePerSec?: number;
  /**
   * Minimum refilled balance required before a take succeeds.
   * Bulk callers use capacity (reserved share for priority); priority uses 1.
   */
  minTokensToTake?: number;
};

export type TakeResult = {
  taken: boolean;
  /** When not taken: ms until a token should be available (a hint, not a reservation). */
  waitMs: number;
  /** Best-effort refilled balance observed when the take was refused (0 when taken). */
  tokensAvailable?: number;
};

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const maybe = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : [];
}

/**
 * Atomically try to take one token.
 *
 * Self-heal: negative / NaN balances and absurd future `updated_at` skews are treated as a
 * full refill to `capacity` before the take decision (never permanently wedged).
 *
 * The INSERT ... ON CONFLICT DO UPDATE ... WHERE only updates (and so only RETURNs a row)
 * when the refilled balance is >= `minTokensToTake`. If the WHERE is false nothing is
 * modified and the row lock is simply released, so a rejected caller never consumes or
 * delays tokens.
 */
export async function takeToken(
  db: BucketDb,
  key: string,
  config: BucketConfig = {},
): Promise<TakeResult> {
  const capacity = config.capacity ?? 1;
  const rate = config.ratePerSec ?? 1;
  const minTokens = Math.min(
    capacity,
    Math.max(1, config.minTokensToTake ?? 1),
  );
  if (!key.trim()) throw new Error("token bucket key must be non-empty");
  if (!(capacity > 0) || !(rate > 0)) throw new Error("token bucket capacity/rate must be > 0");

  // Self-heal: clamp bad balances / future skew before the take attempt.
  await db.execute(sql`
    UPDATE rate_limit_buckets AS b
    SET
      tokens = ${capacity}::double precision,
      updated_at = clock_timestamp()
    WHERE b.key = ${key}
      AND (
        b.tokens IS NULL
        OR b.tokens < 0
        OR b.tokens > ${capacity}::double precision * 4
        OR b.updated_at > clock_timestamp() + interval '5 seconds'
      )
  `);

  const result = await db.execute(sql`
    WITH refilled AS (
      SELECT
        s.key,
        LEAST(
          ${capacity}::double precision,
          GREATEST(
            0::double precision,
            s.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - s.updated_at))::double precision
              * ${rate}::double precision
          )
        ) AS balance
      FROM rate_limit_buckets s
      WHERE s.key = ${key}
    ),
    attempt AS (
      INSERT INTO rate_limit_buckets AS b (key, tokens, updated_at)
      VALUES (${key}, ${capacity}::double precision - 1, clock_timestamp())
      ON CONFLICT (key) DO UPDATE
        SET tokens = LEAST(
              ${capacity}::double precision,
              GREATEST(
                0::double precision,
                b.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - b.updated_at))::double precision
                  * ${rate}::double precision
              )
            ) - 1,
            updated_at = clock_timestamp()
        WHERE LEAST(
              ${capacity}::double precision,
              GREATEST(
                0::double precision,
                b.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - b.updated_at))::double precision
                  * ${rate}::double precision
              )
            ) >= ${minTokens}::double precision
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM attempt) AS taken,
      COALESCE((
        SELECT GREATEST(
          0,
          (${minTokens}::double precision - r.balance) / ${rate}::double precision
        ) * 1000
        FROM refilled r
      ), 0)::double precision AS wait_ms,
      COALESCE((SELECT r.balance FROM refilled r), ${capacity}::double precision)::double precision
        AS tokens_available
  `);

  const row = rowsOf(result)[0];
  if (!row) throw new Error("token bucket statement returned no row");
  const taken = row.taken === true;
  return {
    taken,
    waitMs: clampKatanaWaitMs(Number(row.wait_ms) || 0),
    tokensAvailable: taken ? undefined : Number(row.tokens_available) || 0,
  };
}

export type AcquireOptions = BucketConfig & {
  db: BucketDb;
  key: string;
  /** Give up after roughly this long. Default 30s. */
  maxWaitMs?: number;
  /** Builds the error thrown when the cap is hit (callers choose the error type). */
  onTimeout: (waitedMs: number) => Error;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const MIN_SLEEP_MS = 5;
const SLEEP_SAFETY_MS = 5;

/** Take a token, sleeping the returned wait and retrying until `maxWaitMs`. */
export async function acquireToken(options: AcquireOptions): Promise<void> {
  const maxWaitMs = clampKatanaWaitMs(options.maxWaitMs ?? 30_000);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const started = now();

  for (;;) {
    const { taken, waitMs } = await takeToken(options.db, options.key, {
      capacity: options.capacity,
      ratePerSec: options.ratePerSec,
      minTokensToTake: options.minTokensToTake,
    });
    if (taken) return;

    const waited = now() - started;
    // Small random jitter spreads out waiters that were told the same wait.
    const pause = Math.min(
      clampKatanaWaitMs(Math.max(waitMs, MIN_SLEEP_MS) + SLEEP_SAFETY_MS + Math.random() * 20),
      Math.max(0, maxWaitMs - waited),
    );
    if (waited + pause > maxWaitMs || pause <= 0) {
      throw options.onTimeout(waited);
    }
    await sleep(pause);
  }
}
