/**
 * Normalize Katana / generic rate-limit reset headers into a safe sleep duration.
 * Caps every backoff at 65s so poisoned epoch timestamps can never wedge a worker.
 */

export const KATANA_RETRY_AFTER_CEILING_MS = 65_000;

/**
 * Interpret `X-RateLimit-Reset` / Retry-After style values:
 * - `> 1e12` → epoch milliseconds
 * - `> 1e9`  → epoch seconds
 * - otherwise → delta seconds (Retry-After)
 * Missing / non-finite → full ceiling.
 */
export function resolveKatanaRetryWaitMs(
  resetHeader: number | undefined | null,
  nowMs: number = Date.now(),
): number {
  if (resetHeader == null || !Number.isFinite(resetHeader)) {
    return KATANA_RETRY_AFTER_CEILING_MS;
  }

  let waitMs: number;
  if (resetHeader > 1e12) {
    waitMs = resetHeader - nowMs;
  } else if (resetHeader > 1e9) {
    waitMs = resetHeader * 1000 - nowMs;
  } else {
    waitMs = Math.max(0, resetHeader) * 1000;
  }

  return Math.min(Math.max(0, waitMs) + 250, KATANA_RETRY_AFTER_CEILING_MS);
}

/** Clamp any precomputed wait to the same hard ceiling. */
export function clampKatanaWaitMs(waitMs: number): number {
  if (!Number.isFinite(waitMs) || waitMs < 0) return 0;
  return Math.min(waitMs, KATANA_RETRY_AFTER_CEILING_MS);
}
