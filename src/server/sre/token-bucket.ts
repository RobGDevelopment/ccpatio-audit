/**
 * Phase 9 Task 5 — cross-instance token bucket on Postgres.
 *
 * ONE atomic SQL statement decides whether a token is taken, so concurrent callers on
 * different serverless instances cannot both win. Refill is time-based and uses the
 * database clock (`clock_timestamp()`), never the caller's clock, so instance clock skew
 * is irrelevant.
 *
 * Capacity 1 / rate 1 per second means a burst never exceeds 1 request.
 *
 * Only `pg_*_xact_*`-free, session-free SQL: safe on the Supavisor transaction pooler.
 */
import { sql, type SQL } from "drizzle-orm";

export type BucketDb = {
  execute: (query: SQL) => Promise<unknown>;
};

export type BucketConfig = {
  /** Max tokens stored (burst size). Default 1. */
  capacity?: number;
  /** Refill rate, tokens per second. Default 1. */
  ratePerSec?: number;
};

export type TakeResult = {
  taken: boolean;
  /** When not taken: ms until a token should be available (a hint, not a reservation). */
  waitMs: number;
};

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const maybe = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : [];
}

/**
 * Atomically try to take one token.
 *
 * The INSERT ... ON CONFLICT DO UPDATE ... WHERE only updates (and so only RETURNs a row)
 * when the refilled balance is >= 1. If the WHERE is false nothing is modified and the
 * row lock is simply released, so a rejected caller never consumes or delays tokens.
 * `wait_ms` is computed from the pre-statement snapshot in the same statement.
 */
export async function takeToken(
  db: BucketDb,
  key: string,
  config: BucketConfig = {},
): Promise<TakeResult> {
  const capacity = config.capacity ?? 1;
  const rate = config.ratePerSec ?? 1;
  if (!key.trim()) throw new Error("token bucket key must be non-empty");
  if (!(capacity > 0) || !(rate > 0)) throw new Error("token bucket capacity/rate must be > 0");

  const result = await db.execute(sql`
    WITH attempt AS (
      INSERT INTO rate_limit_buckets AS b (key, tokens, updated_at)
      VALUES (${key}, ${capacity}::double precision - 1, clock_timestamp())
      ON CONFLICT (key) DO UPDATE
        SET tokens = LEAST(
              ${capacity}::double precision,
              b.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - b.updated_at))::double precision * ${rate}::double precision
            ) - 1,
            updated_at = clock_timestamp()
        WHERE LEAST(
              ${capacity}::double precision,
              b.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - b.updated_at))::double precision * ${rate}::double precision
            ) >= 1
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM attempt) AS taken,
      COALESCE((
        SELECT GREATEST(
          0,
          (1 - LEAST(
                 ${capacity}::double precision,
                 s.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - s.updated_at))::double precision * ${rate}::double precision
               )) / ${rate}::double precision
        ) * 1000
        FROM rate_limit_buckets s
        WHERE s.key = ${key}
      ), 0)::double precision AS wait_ms
  `);

  const row = rowsOf(result)[0];
  if (!row) throw new Error("token bucket statement returned no row");
  return { taken: row.taken === true, waitMs: Number(row.wait_ms) || 0 };
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
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const started = now();

  for (;;) {
    const { taken, waitMs } = await takeToken(options.db, options.key, {
      capacity: options.capacity,
      ratePerSec: options.ratePerSec,
    });
    if (taken) return;

    const waited = now() - started;
    // Small random jitter spreads out waiters that were told the same wait.
    const pause = Math.max(waitMs, MIN_SLEEP_MS) + SLEEP_SAFETY_MS + Math.random() * 20;
    if (waited + pause > maxWaitMs) {
      throw options.onTimeout(waited);
    }
    await sleep(pause);
  }
}
