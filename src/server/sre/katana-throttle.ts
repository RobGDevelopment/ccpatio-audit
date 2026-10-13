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

let warnedNoDb = false;
let warnedNoTable = false;

/** Postgres-backed pacer for `setKatanaRequestPacer` semantics: resolves when a token is ours. */
export function createKatanaSharedBucketPacer(
  env: Record<string, string | undefined> = process.env,
): () => Promise<void> {
  return async () => {
    if (!env.POSTGRES_URL) {
      // No database to coordinate through (e.g. a read-only CLI script). We cannot enforce
      // the shared bucket, so do not block the request; Katana's own 429 handling remains.
      if (!warnedNoDb) {
        warnedNoDb = true;
        console.warn("[katana] POSTGRES_URL unset: shared rate-limit bucket disabled for this process.");
      }
      return;
    }
    try {
      await acquireToken({
        db: getDb(),
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
      // Deploy-order safety: if migration 0054 has not been applied yet, do not take every
      // Katana call down with it. Loud, once per process. Any OTHER error still throws.
      if (isUndefinedTable(error)) {
        if (!warnedNoTable) {
          warnedNoTable = true;
          console.error(
            "[katana] rate_limit_buckets table is missing (apply migration 0054). Shared bucket disabled until then.",
          );
        }
        return;
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
